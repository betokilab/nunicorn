/**
 * 뉴니콘 서버 공용 헬퍼 (Edge Runtime)
 * - Supabase REST 호출 (service_role)
 * - 운영 설정 읽기 (operation_settings)
 * - 사용자 키(회원 ID 또는 IP 해시) 및 일일 한도
 *
 * 파일명이 _ 로 시작하므로 Vercel이 API 라우트로 노출하지 않습니다.
 */

export const SUPA_URL = process.env.SUPA_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function supaReady() {
  return Boolean(SUPA_URL && SUPA_SERVICE_KEY);
}

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPA_SERVICE_KEY,
    'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
    ...extra,
  };
}

/** REST GET — 결과 배열 또는 [] */
export async function restGet(path) {
  if (!supaReady()) return [];
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: headers() });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/** REST INSERT — 실패해도 조용히 무시 (로깅 용도) */
export async function restInsert(table, row) {
  if (!supaReady()) return false;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch { return false; }
}

/** REST INSERT — 생성된 행 반환 (배열) */
export async function restInsertReturning(table, row) {
  if (!supaReady()) return null;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** RPC 호출 */
export async function rpc(fn, args) {
  if (!supaReady()) return { data: null, error: 'not configured' };
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { data, error: null } : { data: null, error: data?.message || `HTTP ${res.status}` };
  } catch (e) { return { data: null, error: e.message }; }
}

// ─────────────────────────────────────────────────────────────
// 운영 설정 (operation_settings) — 짧은 메모리 캐시
// ─────────────────────────────────────────────────────────────
let _settingsCache = { at: 0, map: {} };
const DEFAULTS = {
  free_daily_quota: 3,
  member_daily_quota: 10,
  scan_daily_quota: 20,
  ai_model: 'claude-haiku-4-5-20251001',
  ai_max_tokens: 512,
  ocr_model: 'claude-haiku-4-5-20251001',
  maintenance_mode: false,
  maintenance_message: '',
  red_hold_enabled: true,
};

export async function getSettings() {
  const now = Date.now();
  if (now - _settingsCache.at < 60_000 && Object.keys(_settingsCache.map).length) return _settingsCache.map;
  const rows = await restGet('operation_settings?select=key,value');
  const map = { ...DEFAULTS };
  for (const r of rows) {
    if (r?.key) map[r.key] = r.value; // value는 jsonb → 이미 파싱된 값
  }
  _settingsCache = { at: now, map };
  return map;
}

// ─────────────────────────────────────────────────────────────
// 사용자 키: 회원이면 user:<uuid>, 아니면 ip:<sha256 앞 16자>
// ─────────────────────────────────────────────────────────────
export function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || req.headers.get('x-real-ip') || 'unknown';
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function userKey(req, userId) {
  if (userId && UUID_RE.test(String(userId))) return { key: `user:${userId}`, member: true };
  const ip = clientIp(req);
  return { key: `ip:${(await sha256Hex('nunicorn|' + ip)).slice(0, 16)}`, member: false };
}

export function todayKST() {
  // 한국 시간 기준 날짜 (YYYY-MM-DD)
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 오늘 사용량 조회 */
export async function getQuotaCount(key, prefix = '') {
  const day = todayKST();
  const rows = await restGet(`chat_quota?user_key=eq.${encodeURIComponent(prefix + key)}&day=eq.${day}&select=count`);
  return rows?.[0]?.count ?? 0;
}

/** 사용량 +1 (원자적) → 증가 후 값 */
export async function incrementQuota(key, prefix = '') {
  const { data } = await rpc('increment_chat_quota', { p_key: prefix + key, p_day: todayKST() });
  return typeof data === 'number' ? data : null;
}
