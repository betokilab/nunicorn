/**
 * 회원 본인 계정 삭제 (개인정보보호법상 손쉬운 탈퇴 제공)
 * POST /api/account  { action: 'delete' }   Authorization: Bearer <사용자 JWT>
 *
 * 1) JWT로 본인 확인 (GoTrue /auth/v1/user)
 * 2) 사용량 기록(chat_quota) 삭제
 * 3) auth.users 삭제 → user_children / supplements / daily_logs / scan_history / profiles 는 FK cascade,
 *    chat_logs.user_id 는 set null (상담 내용은 익명화되어 품질 검토용으로만 남음)
 */
import { SUPA_URL, SUPA_SERVICE_KEY, supaReady } from './_lib/supa.js';

export const config = { runtime: 'edge' };

const ORIGIN = 'https://www.nunicorn.co.kr';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 204);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!supaReady()) return json({ error: '서버 설정이 완료되지 않았어요.' }, 503);

  const auth = req.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return json({ error: '로그인이 필요해요.' }, 401);

  let body = {};
  try { body = await req.json(); } catch {}
  if (body.action !== 'delete') return json({ error: 'unknown action' }, 400);

  // 1) 본인 확인
  const me = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!me.ok) return json({ error: '로그인 정보가 만료됐어요. 다시 로그인해 주세요.' }, 401);
  const user = await me.json();
  const uid = user?.id;
  if (!uid) return json({ error: '사용자 확인 실패' }, 401);

  const h = { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // 2) 사용량 기록 삭제 (키: user:<uuid>, scan:user:<uuid>)
  await fetch(`${SUPA_URL}/rest/v1/chat_quota?user_key=in.(${encodeURIComponent(`"user:${uid}","scan:user:${uid}"`)})`, { method: 'DELETE', headers: h }).catch(() => {});

  // 3) 계정 삭제 (연결 데이터는 FK cascade)
  const del = await fetch(`${SUPA_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: h });
  if (!del.ok) {
    const t = await del.text().catch(() => '');
    return json({ error: '계정 삭제에 실패했어요. heechco@gmail.com 으로 문의해 주세요.', detail: t.slice(0, 200) }, 500);
  }
  return json({ ok: true });
}
