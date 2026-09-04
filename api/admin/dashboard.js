/**
 * 뉴니콘 관리자 대시보드 API
 * GET /api/admin/dashboard
 */
export const config = { runtime: 'edge' };

import { verifyAdmin, ok, err, handleOptions, CORS_HEADERS } from './auth.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET') return err(405, '허용되지 않는 메서드');

  const { adminUser, supaAdmin, errorResponse } = await verifyAdmin(req);
  if (errorResponse) return errorResponse;

  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const d7 = new Date(now - 7 * 86400000).toISOString();
    const d30 = new Date(now - 30 * 86400000).toISOString();
    // 관리자가 마지막으로 회원 목록을 확인한 시각 (없으면 7일 전)
    const sinceRaw = new URL(req.url).searchParams.get('since');
    const since = sinceRaw && !isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : d7;

    // 병렬 조회
    const [
      chatToday, chat7d, chat30d,
      successToday, failedToday,
      riskHigh, riskCaution,
      pendingReview,
      newUsers7d, childProfiles, newUsersSince, totalUsers,
      scanHistory7d,
      recentChats, recentFailed, riskQueue,
      scansToday, scans7d, scansOk7d, draftProducts, tokenChat30d, tokenScan30d,
    ] = await Promise.all([
      // 오늘 상담 수
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today),
      // 7일 상담 수
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', d7),
      // 30일 상담 수
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', d30),
      // 오늘 성공
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'success')
        .gte('created_at', today),
      // 오늘 실패
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['failed','timeout','empty_reply'])
        .gte('created_at', today),
      // 위험 상담 (high)
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .eq('risk_level', 'high')
        .eq('review_status', 'pending'),
      // 주의 상담 (caution)
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .eq('risk_level', 'caution')
        .eq('review_status', 'pending'),
      // 검토 대기
      supaAdmin.from('chat_logs')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending')
        .neq('risk_level', 'normal'),
      // 신규 회원 7일
      supaAdmin.from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', d7)
        .catch(() => ({ count: 0 })), // profiles에 created_at 없을 수 있음
      // 아이 프로필 전체
      supaAdmin.from('user_children')
        .select('*', { count: 'exact', head: true }),
      // 미확인 신규 회원 (since 이후 가입)
      supaAdmin.from('profiles')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', since)
        .catch(() => ({ count: 0 })),
      // 전체 회원
      supaAdmin.from('profiles')
        .select('*', { count: 'exact', head: true })
        .catch(() => ({ count: 0 })),
      // 스캔 이력 7일
      supaAdmin.from('scan_history')
        .select('*', { count: 'exact', head: true })
        .gte('scanned_at', d7),
      // 최근 상담 10건
      supaAdmin.from('chat_logs')
        .select('id,question,status,risk_level,review_status,quota_deducted,child_age_label,created_at,user_id')
        .order('created_at', { ascending: false })
        .limit(10),
      // 최근 실패 상담 5건
      supaAdmin.from('chat_logs')
        .select('id,question,status,error_code,child_age_label,created_at')
        .in('status', ['failed','timeout','empty_reply'])
        .order('created_at', { ascending: false })
        .limit(5),
      // 위험 상담 검토 대기 5건
      supaAdmin.from('chat_logs')
        .select('id,question,risk_level,risk_flags,review_status,child_age_label,created_at')
        .neq('risk_level', 'normal')
        .eq('review_status', 'pending')
        .order('risk_level', { ascending: false }) // high 먼저
        .order('created_at', { ascending: false })
        .limit(5),
      // ── 스캔(라벨 인식) 지표 ──
      supaAdmin.from('scan_events').select('*', { count: 'exact', head: true }).gte('created_at', today).catch(() => ({ count: 0 })),
      supaAdmin.from('scan_events').select('*', { count: 'exact', head: true }).gte('created_at', d7).catch(() => ({ count: 0 })),
      supaAdmin.from('scan_events').select('*', { count: 'exact', head: true }).gte('created_at', d7).eq('success', true).catch(() => ({ count: 0 })),
      // 스캔에서 온 제품 후보 (승인 대기)
      supaAdmin.from('products').select('*', { count: 'exact', head: true }).eq('data_review_status', 'draft').eq('is_active', false).catch(() => ({ count: 0 })),
      // ── AI 비용: 30일 토큰 (최근 2000건 샘플) ──
      supaAdmin.from('chat_logs').select('input_tokens,output_tokens,model').gte('created_at', d30).order('created_at', { ascending: false }).limit(2000).catch(() => ({ data: [] })),
      supaAdmin.from('scan_events').select('input_tokens,output_tokens,model').gte('created_at', d30).order('created_at', { ascending: false }).limit(2000).catch(() => ({ data: [] })),
    ]);

    // 토큰 합산 + 비용 추정 (USD): Haiku 4.5 기준 입력 $1/M, 출력 $5/M (다른 모델은 Sonnet 기준 $3/$15)
    const PRICE = (model) => /haiku/i.test(model || '') ? { i: 1, o: 5 } : { i: 3, o: 15 };
    const sumTokens = (rows) => (rows ?? []).reduce((a, r) => {
      const pr = PRICE(r.model);
      a.input += r.input_tokens || 0; a.output += r.output_tokens || 0;
      a.usd += ((r.input_tokens || 0) * pr.i + (r.output_tokens || 0) * pr.o) / 1_000_000;
      a.calls += 1; return a;
    }, { input: 0, output: 0, usd: 0, calls: 0 });
    const costChat = sumTokens(tokenChat30d.data);
    const costScan = sumTokens(tokenScan30d.data);

    const totalToday = chatToday.count ?? 0;
    const successRate = totalToday > 0
      ? Math.round(((successToday.count ?? 0) / totalToday) * 100)
      : null;

    return ok({
      consultations: {
        today: totalToday,
        last7d: chat7d.count ?? 0,
        last30d: chat30d.count ?? 0,
        successToday: successToday.count ?? 0,
        failedToday: failedToday.count ?? 0,
        successRate,
      },
      risk: {
        highPending: riskHigh.count ?? 0,
        cautionPending: riskCaution.count ?? 0,
        totalPendingReview: pendingReview.count ?? 0,
      },
      scans: {
        today: scansToday.count ?? 0,
        last7d: scans7d.count ?? 0,
        successRate7d: (scans7d.count ?? 0) > 0 ? Math.round(((scansOk7d.count ?? 0) / scans7d.count) * 100) : null,
        draftProducts: draftProducts.count ?? 0,
      },
      cost30d: {
        chat: { calls: costChat.calls, inputTokens: costChat.input, outputTokens: costChat.output, usd: Math.round(costChat.usd * 100) / 100 },
        scan: { calls: costScan.calls, inputTokens: costScan.input, outputTokens: costScan.output, usd: Math.round(costScan.usd * 100) / 100 },
        totalUsd: Math.round((costChat.usd + costScan.usd) * 100) / 100,
      },
      funnel7d: {
        scans: scans7d.count ?? 0,
        chats: chat7d.count ?? 0,
        signups: newUsers7d.count ?? 0,
      },
      users: {
        newLast7d: newUsers7d.count ?? 0,
        newUnseen: newUsersSince.count ?? 0,
        total: totalUsers.count ?? 0,
        childProfiles: childProfiles.count ?? 0,
        scansLast7d: scanHistory7d.count ?? 0,
      },
      recentChats: (recentChats.data ?? []).map(maskUserData),
      recentFailed: recentFailed.data ?? [],
      riskQueue: riskQueue.data ?? [],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[admin/dashboard] error:', e.message);
    return err(500, '데이터 조회 중 오류가 발생했습니다');
  }
}

/** 목록에서 개인정보 최소화 */
function maskUserData(row) {
  return {
    ...row,
    user_id: row.user_id ? row.user_id.slice(0, 8) + '...' : null,
    question: row.question?.slice(0, 50) + (row.question?.length > 50 ? '…' : ''),
  };
}
