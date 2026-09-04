/**
 * 뉴니콘 관리자 위험 상담 검토함 API
 * GET   /api/admin/risk            검토 대기 목록 (위험도 우선순위)
 * POST  /api/admin/risk/flag       상담 위험 플래그 수동 업데이트
 * PATCH /api/admin/risk/resolve    검토 완료 처리 (검토 결과 기록)
 *
 * RED 사전 차단 승인 큐 (Phase 2)
 * GET   /api/admin/risk/held       held_for_review=true 목록 (status 필터)
 * POST  /api/admin/risk/approve    원본 승인 또는 수정 후 승인
 * POST  /api/admin/risk/reject     거절 (사유 필수)
 *
 * 하위 경로는 vercel.json rewrite로 ?action= 로 전달됨 (Vercel은 /api/x/y 를 x.js로 라우팅하지 않음)
 */
export const config = { runtime: 'edge' };

import { verifyAdmin, ok, err, handleOptions, parsePagination, logAudit } from './auth.js';

function getAction(url) {
  const q = url.searchParams.get('action');
  if (q) return q;
  const seg = url.pathname.replace(/\/+$/, '').split('/').pop();
  return seg === 'risk' ? '' : seg;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();

  const { adminUser, supaAdmin, errorResponse } = await verifyAdmin(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const action = getAction(url);

  if (req.method === 'GET'   && action === '')        return getRiskQueue(supaAdmin, url);
  if (req.method === 'GET'   && action === 'held')    return getHeldQueue(supaAdmin, url);
  if (req.method === 'POST'  && action === 'flag')    return flagChat(supaAdmin, adminUser, req);
  if (req.method === 'PATCH' && action === 'resolve') return resolveRisk(supaAdmin, adminUser, req);
  if (req.method === 'POST'  && action === 'approve') return approveHeld(supaAdmin, adminUser, req);
  if (req.method === 'POST'  && action === 'reject')  return rejectHeld(supaAdmin, adminUser, req);

  return err(405, '허용되지 않는 메서드');
}

// ─────────────────────────────────────────────────────────────────
// RED 사전 차단 큐
// ─────────────────────────────────────────────────────────────────

async function getHeldQueue(supaAdmin, url) {
  const { limit, offset } = parsePagination(url.toString());
  const p = url.searchParams;

  let query = supaAdmin
    .from('chat_logs')
    .select(
      'id,question,answer,eval_reason,red_review_status,red_approved_answer,red_approved_at,' +
      'risk_level,risk_flags,child_age_label,child_months,created_at,user_id',
      { count: 'exact' }
    )
    .eq('held_for_review', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const status = p.get('status') || 'pending';
  if (status !== 'all') query = query.eq('red_review_status', status);
  if (p.get('from')) query = query.gte('created_at', p.get('from'));
  if (p.get('to'))   query = query.lte('created_at', p.get('to') + 'T23:59:59');

  const { data, count, error } = await query;
  if (error) return err(500, '조회 오류: ' + error.message);

  return ok({
    items: (data ?? []).map(item => ({
      ...item,
      user_id: item.user_id ? item.user_id.slice(0, 8) + '...' : null,
    })),
    total: count ?? 0, limit, offset,
  });
}

async function loadHeld(supaAdmin, chatId) {
  const { data } = await supaAdmin
    .from('chat_logs')
    .select('id,question,answer,eval_reason,red_review_status,held_for_review,child_age_label')
    .eq('id', chatId)
    .maybeSingle();
  return data;
}

async function approveHeld(supaAdmin, adminUser, req) {
  let body;
  try { body = await req.json(); } catch { return err(400, '잘못된 요청 형식'); }

  const { chat_id, approved_answer, note } = body;
  if (!chat_id) return err(400, 'chat_id가 필요합니다');

  const before = await loadHeld(supaAdmin, chat_id);
  if (!before) return err(404, '상담 기록을 찾을 수 없습니다');
  if (!before.held_for_review) return err(400, 'RED 차단 건이 아닙니다');
  if (before.red_review_status !== 'pending') return err(409, '이미 처리된 건입니다');

  const edited = typeof approved_answer === 'string' && approved_answer.trim().length > 0
    && approved_answer.trim() !== (before.answer || '').trim();
  const finalAnswer = edited ? approved_answer.trim() : before.answer;

  const updateData = {
    red_review_status: edited ? 'edited' : 'approved',
    red_approved_answer: finalAnswer,
    red_approved_at: new Date().toISOString(),
    red_approver_id: adminUser.id,
    review_status: 'completed',
    reviewer_id: adminUser.id,
    reviewer_note: note || '',
  };

  const { error } = await supaAdmin.from('chat_logs').update(updateData).eq('id', chat_id);
  if (error) return err(500, '승인 처리 오류: ' + error.message);

  // 수정 승인 → 검수 답변 DB에 저장 (향후 참고용)
  if (edited) {
    await supaAdmin.from('reviewed_answers').insert({
      topic: (before.child_age_label || '일반') + ' / RED 수정승인',
      sub_topic: before.eval_reason || null,
      trigger_keywords: before.question.slice(0, 200),
      answer_text: finalAnswer,
      source_chat_id: chat_id,
      notes: note || 'RED 차단 건 관리자 수정 승인',
      reviewed_by: adminUser.id,
      reviewed_at: new Date().toISOString(),
      is_active: true,
    });
  }

  await logAudit(supaAdmin, {
    adminUserId: adminUser.id,
    actionType: edited ? 'red_approve_edited' : 'red_approve',
    targetType: 'chat_log',
    targetId: chat_id,
    beforeValue: { red_review_status: before.red_review_status, eval_reason: before.eval_reason },
    afterValue: { red_review_status: updateData.red_review_status, note: note || '' },
  });

  return ok({ success: true, status: updateData.red_review_status });
}

async function rejectHeld(supaAdmin, adminUser, req) {
  let body;
  try { body = await req.json(); } catch { return err(400, '잘못된 요청 형식'); }

  const { chat_id, reason } = body;
  if (!chat_id) return err(400, 'chat_id가 필요합니다');
  if (!reason || !String(reason).trim()) return err(400, '거절 사유가 필요합니다');

  const before = await loadHeld(supaAdmin, chat_id);
  if (!before) return err(404, '상담 기록을 찾을 수 없습니다');
  if (!before.held_for_review) return err(400, 'RED 차단 건이 아닙니다');
  if (before.red_review_status !== 'pending') return err(409, '이미 처리된 건입니다');

  const updateData = {
    red_review_status: 'rejected',
    red_approved_at: new Date().toISOString(),
    red_approver_id: adminUser.id,
    review_status: 'dangerous',
    reviewer_id: adminUser.id,
    reviewer_note: String(reason).trim(),
  };

  const { error } = await supaAdmin.from('chat_logs').update(updateData).eq('id', chat_id);
  if (error) return err(500, '거절 처리 오류: ' + error.message);

  await logAudit(supaAdmin, {
    adminUserId: adminUser.id,
    actionType: 'red_reject',
    targetType: 'chat_log',
    targetId: chat_id,
    beforeValue: { red_review_status: before.red_review_status, eval_reason: before.eval_reason },
    afterValue: { red_review_status: 'rejected', reason: String(reason).trim() },
  });

  return ok({ success: true, status: 'rejected' });
}

async function getRiskQueue(supaAdmin, url) {
  const { limit, offset } = parsePagination(url.toString());
  const p = url.searchParams;

  let query = supaAdmin
    .from('chat_logs')
    .select(
      'id,question,answer,risk_level,risk_flags,review_status,reviewer_note,' +
      'child_age_label,child_months,disclaimer_shown,created_at,user_id',
      { count: 'exact' }
    )
    .order('risk_level', { ascending: true })  // high가 먼저 (h < n, caution between)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // 기본: pending만 (필터 없을 때)
  const reviewStatus = p.get('review_status') || 'pending';
  if (reviewStatus !== 'all') query = query.eq('review_status', reviewStatus);

  // 위험도 필터
  if (p.get('risk_level')) query = query.eq('risk_level', p.get('risk_level'));
  else query = query.neq('risk_level', 'normal'); // normal 제외

  const { data, count, error } = await query;
  if (error) return err(500, '조회 오류: ' + error.message);

  return ok({
    items: (data ?? []).map(item => ({
      ...item,
      user_id: item.user_id ? item.user_id.slice(0, 8) + '...' : null,
      question: item.question,   // 위험 검토는 전문 노출
      answer: item.answer?.slice(0, 200) + (item.answer?.length > 200 ? '…' : ''),
    })),
    total: count ?? 0,
    limit,
    offset,
  });
}

async function flagChat(supaAdmin, adminUser, req) {
  let body;
  try { body = await req.json(); } catch { return err(400, '잘못된 요청 형식'); }

  const { chat_id, risk_level, risk_flags, note } = body;
  if (!chat_id) return err(400, 'chat_id가 필요합니다');

  const VALID_RISK = ['normal', 'caution', 'high'];
  if (risk_level && !VALID_RISK.includes(risk_level)) {
    return err(400, '유효하지 않은 risk_level');
  }

  const { data: before } = await supaAdmin
    .from('chat_logs')
    .select('risk_level, risk_flags, review_status')
    .eq('id', chat_id)
    .maybeSingle();
  if (!before) return err(404, '상담 기록을 찾을 수 없습니다');

  const updateData = { reviewer_id: adminUser.id };
  if (risk_level) updateData.risk_level = risk_level;
  if (risk_flags) updateData.risk_flags = Array.isArray(risk_flags) ? risk_flags : [risk_flags];
  if (typeof note === 'string') updateData.reviewer_note = note;
  // 플래그 변경 시 pending으로 리셋 (재검토 필요)
  updateData.review_status = risk_level === 'normal' ? 'completed' : 'reviewing';

  const { error } = await supaAdmin.from('chat_logs').update(updateData).eq('id', chat_id);
  if (error) return err(500, '플래그 업데이트 오류: ' + error.message);

  await logAudit(supaAdmin, {
    adminUserId: adminUser.id,
    actionType: 'risk_flag',
    targetType: 'chat_log',
    targetId: chat_id,
    beforeValue: { risk_level: before.risk_level, risk_flags: before.risk_flags },
    afterValue: updateData,
  });

  return ok({ success: true });
}

async function resolveRisk(supaAdmin, adminUser, req) {
  let body;
  try { body = await req.json(); } catch { return err(400, '잘못된 요청 형식'); }

  const { chat_id, resolution, reviewer_note, final_risk_level } = body;
  if (!chat_id || !resolution) return err(400, 'chat_id와 resolution이 필요합니다');

  const VALID_RESOLUTIONS = ['normal', 'needs_revision', 'dangerous', 'false_positive'];
  if (!VALID_RESOLUTIONS.includes(resolution)) {
    return err(400, `resolution은 [${VALID_RESOLUTIONS.join(', ')}] 중 하나여야 합니다`);
  }

  const updateData = {
    review_status: 'completed',
    reviewer_id: adminUser.id,
    reviewer_note: reviewer_note || '',
  };
  if (final_risk_level) updateData.risk_level = final_risk_level;

  const { error } = await supaAdmin.from('chat_logs').update(updateData).eq('id', chat_id);
  if (error) return err(500, '검토 완료 오류: ' + error.message);

  await logAudit(supaAdmin, {
    adminUserId: adminUser.id,
    actionType: 'risk_resolve',
    targetType: 'chat_log',
    targetId: chat_id,
    afterValue: { resolution, final_risk_level, reviewer_note },
  });

  return ok({ success: true });
}
