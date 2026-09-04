/**
 * 뉴니콘 라벨 인식 API — Claude 비전으로 영양성분표를 구조화 추출
 * POST /api/ocr  { image: <base64 jpeg/png, data: 접두어 없이>, userId?: uuid }
 * → { productName, brand, servingSize, nutrients: { vitD: { amount, unit }, ... }, found, quotaLeft }
 *
 * - 이미지는 저장하지 않음 (Anthropic API 호출 후 폐기)
 * - 하루 스캔 횟수 제한 (operation_settings.scan_daily_quota)
 * - 결과 요약만 scan_events 에 기록 (성공률·비용 모니터링)
 */
export const config = { runtime: 'edge' };

import { getSettings, userKey, getQuotaCount, incrementQuota, restInsert, supaReady } from './_lib/supa.js';

// 앱이 다루는 영양소 키 (2차에서 index.html도 이 목록으로 확장)
export const NUTRIENT_KEYS = {
  vitA:     { label: '비타민A',   unit: 'mcg', aliases: ['비타민A', 'Vitamin A', '레티놀', 'RAE'] },
  vitD:     { label: '비타민D',   unit: 'IU',  aliases: ['비타민D', 'Vitamin D', 'D3', '콜레칼시페롤'] },
  vitE:     { label: '비타민E',   unit: 'mg',  aliases: ['비타민E', 'Vitamin E', 'α-TE', '토코페롤'] },
  vitK:     { label: '비타민K',   unit: 'mcg', aliases: ['비타민K', 'Vitamin K', 'K2', 'K1'] },
  vitC:     { label: '비타민C',   unit: 'mg',  aliases: ['비타민C', 'Vitamin C', '아스코르브산'] },
  vitB1:    { label: '비타민B1',  unit: 'mg',  aliases: ['비타민B1', '티아민', 'Thiamin'] },
  vitB2:    { label: '비타민B2',  unit: 'mg',  aliases: ['비타민B2', '리보플라빈', 'Riboflavin'] },
  vitB6:    { label: '비타민B6',  unit: 'mg',  aliases: ['비타민B6', '피리독신', 'Pyridoxine'] },
  vitB12:   { label: '비타민B12', unit: 'mcg', aliases: ['비타민B12', '코발라민', 'Cobalamin'] },
  folate:   { label: '엽산',      unit: 'mcg', aliases: ['엽산', 'Folate', 'Folic acid', 'DFE'] },
  calcium:  { label: '칼슘',      unit: 'mg',  aliases: ['칼슘', 'Calcium'] },
  iron:     { label: '철분',      unit: 'mg',  aliases: ['철', '철분', 'Iron'] },
  zinc:     { label: '아연',      unit: 'mg',  aliases: ['아연', 'Zinc'] },
  mg:       { label: '마그네슘',  unit: 'mg',  aliases: ['마그네슘', 'Magnesium'] },
  iodine:   { label: '요오드',    unit: 'mcg', aliases: ['요오드', 'Iodine'] },
  selenium: { label: '셀레늄',    unit: 'mcg', aliases: ['셀레늄', 'Selenium'] },
  omega3:   { label: '오메가3',   unit: 'mg',  aliases: ['오메가3', 'Omega-3', 'EPA', 'DHA', 'EPA 및 DHA의 합'] },
  probiotic:{ label: '유산균',    unit: 'CFU', aliases: ['유산균', '프로바이오틱스', 'CFU', '생균'] },
};

const KEY_LIST = Object.keys(NUTRIENT_KEYS);

const EXTRACT_PROMPT = `당신은 어린이 영양제 라벨(영양성분표) 판독기입니다. 사진에서 아래 정보를 JSON으로만 출력하세요. 설명 문장 금지.

출력 형식:
{
  "productName": "제품명 또는 null",
  "brand": "제조사/브랜드 또는 null",
  "servingSize": "1회 섭취량 표기 (예: '1포(2g)', '2정') 또는 null",
  "nutrients": {
    "<key>": { "amount": <숫자>, "unit": "<라벨에 적힌 단위 그대로>" }
  },
  "confidence": "high" | "medium" | "low",
  "notes": "판독이 애매한 부분 한 줄 또는 null"
}

nutrients의 key는 반드시 다음 중에서만 사용: ${KEY_LIST.join(', ')}
- 각 key의 의미: ${KEY_LIST.map(k => `${k}=${NUTRIENT_KEYS[k].label}`).join(', ')}
- 1회 섭취량(1회 분량) 기준 함량을 적으세요. "1일 섭취량" 기준만 있으면 그 값을 쓰고 notes에 "1일 기준"이라고 적으세요.
- 단위는 라벨 표기 그대로 (IU, mg, mcg, μg, ㎍, g, 억 CFU 등). 변환하지 마세요.
- 오메가3는 EPA+DHA 합계가 있으면 그 값을, 없으면 DHA 값을 쓰고 notes에 명시.
- 유산균은 균수(CFU)를 쓰세요. "100억 CFU"면 amount=100, unit="억 CFU".
- 라벨에 없는 영양소는 넣지 마세요. 추측 금지.
- 영양성분표가 아니거나 읽을 수 없으면 {"productName":null,"brand":null,"servingSize":null,"nutrients":{},"confidence":"low","notes":"영양성분표를 찾지 못함"}`;

// 단위 정규화 → 앱 내부 단위로 변환
function normalize(key, amount, unit) {
  const u = String(unit || '').toLowerCase().replace(/\s+/g, '');
  let a = Number(amount);
  if (!Number.isFinite(a) || a < 0) return null;
  const target = NUTRIENT_KEYS[key].unit;

  const isMcg = /mcg|μg|µg|㎍|ug/.test(u);
  const isMg  = /^mg/.test(u) || u === 'mg';
  const isG   = /^g$|^g\b|그램/.test(u);
  const isIU  = /iu/.test(u);

  if (target === 'IU') {                      // 비타민D: 1 μg = 40 IU
    if (isMcg) a = a * 40;
    else if (isMg) a = a * 40000;
  } else if (target === 'mcg') {
    if (isMg) a = a * 1000;
    else if (isG) a = a * 1_000_000;
    else if (isIU && key === 'vitA') a = a * 0.3;   // 비타민A 1 IU ≈ 0.3 μg RAE (레티놀 기준)
    else if (isIU && key === 'vitE') a = a * 0.67;  // (mcg 타깃 아님 — 안전장치)
  } else if (target === 'mg') {
    if (isMcg) a = a / 1000;
    else if (isG) a = a * 1000;
    else if (isIU && key === 'vitE') a = a * 0.67;  // 비타민E 1 IU ≈ 0.67 mg α-TE
  } else if (target === 'CFU') {
    if (/억/.test(u)) a = a * 1e8;
    else if (/만/.test(u)) a = a * 1e4;
    else if (/billion|b$/.test(u)) a = a * 1e9;
    else if (/million|m$/.test(u)) a = a * 1e6;
  }
  return Math.round(a * 100) / 100;
}

export default async function handler(req) {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://www.nunicorn.co.kr',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: '잘못된 요청이에요.' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: '잘못된 요청 형식이에요.' }, 400); }
  const { image, userId, mediaType } = body || {};
  if (!image || typeof image !== 'string' || image.length < 100) return json({ error: '이미지가 비어 있어요.' }, 400);
  if (image.length > 6_000_000) return json({ error: '이미지가 너무 커요. 다시 촬영해 주세요.' }, 413);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: '지금은 라벨 인식이 원활하지 않아요.' }, 503);

  const settings = await getSettings();
  if (settings.maintenance_mode === true) return json({ error: settings.maintenance_message || '점검 중이에요.' }, 503);

  // 스캔 한도 (chat_quota 테이블 공유, 키에 scan: 접두어)
  const { key, member } = await userKey(req, userId);
  const limit = parseInt(settings.scan_daily_quota) || 20;
  const used = supaReady() ? await getQuotaCount(key, 'scan:') : 0;
  if (used >= limit) return json({ error: '오늘 라벨 스캔 횟수를 모두 사용했어요. 성분을 직접 입력해 주세요.', quotaLeft: 0 }, 429);

  const model = String(settings.ocr_model || 'claude-haiku-4-5-20251001');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);

  let usage = {};
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType === 'image/png' ? 'image/png' : 'image/jpeg', data: image } },
            { type: 'text', text: EXTRACT_PROMPT },
          ],
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    usage = { input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, model: data.model || model };

    if (!res.ok) {
      await restInsert('scan_events', { user_id: member ? userId : null, success: false, error_code: data?.error?.type || `http_${res.status}`, duration_ms: Date.now() - started, ...usage });
      return json({ error: '지금은 라벨 인식이 원활하지 않아요. 직접 입력해 주세요.' }, 502);
    }

    const text = data.content?.[0]?.text || '';
    let parsed = null;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch {}
    if (!parsed || typeof parsed !== 'object') {
      await restInsert('scan_events', { user_id: member ? userId : null, success: false, error_code: 'parse_error', duration_ms: Date.now() - started, ...usage });
      return json({ error: '라벨을 읽지 못했어요. 성분표가 잘 보이게 다시 찍어 주세요.', found: 0 }, 200);
    }

    const nutrients = {};
    for (const [k, v] of Object.entries(parsed.nutrients || {})) {
      if (!NUTRIENT_KEYS[k] || !v) continue;
      const amt = normalize(k, v.amount, v.unit);
      if (amt != null && amt > 0) nutrients[k] = { amount: amt, unit: NUTRIENT_KEYS[k].unit, raw: `${v.amount} ${v.unit || ''}`.trim() };
    }
    const found = Object.keys(nutrients).length;

    await incrementQuota(key, 'scan:');
    await restInsert('scan_events', {
      user_id: member ? userId : null, success: found > 0, nutrients_found: found,
      product_name: parsed.productName ? String(parsed.productName).slice(0, 120) : null,
      brand: parsed.brand ? String(parsed.brand).slice(0, 80) : null,
      duration_ms: Date.now() - started, ...usage,
    });

    return json({
      productName: parsed.productName || null,
      brand: parsed.brand || null,
      servingSize: parsed.servingSize || null,
      nutrients, found,
      confidence: parsed.confidence || 'medium',
      notes: parsed.notes || null,
      quotaLeft: Math.max(0, limit - used - 1),
    });
  } catch (e) {
    clearTimeout(timer);
    await restInsert('scan_events', { user_id: member ? userId : null, success: false, error_code: e.name === 'AbortError' ? 'timeout' : (e.name || 'error'), duration_ms: Date.now() - started, ...usage });
    return json({ error: e.name === 'AbortError' ? '인식 시간이 초과됐어요. 다시 시도해 주세요.' : '라벨 인식 중 오류가 났어요. 직접 입력해 주세요.' }, 500);
  }
}
