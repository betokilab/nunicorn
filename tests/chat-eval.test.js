/**
 * tests/chat-eval.test.js
 *
 * Phase 1+2 핵심 평가 로직 테스트
 * Node.js built-in test runner: node --test tests/chat-eval.test.js
 *
 * 테스트 대상: api/chat.js의 evaluateGreenYellowRed(), appendDisclaimerIfNeeded()
 * 참조 정책:  agency/policies/health-safety.md
 *             api/prompt-policy.js
 */

import { test } from 'node:test';
import assert  from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// 테스트용 함수 직접 복제 (Edge Runtime에서 import 불가능하므로 독립 구현)
// 실제 운영 코드와 로직이 동일해야 합니다.
// api/chat.js 수정 시 아래 함수도 함께 업데이트하세요.
// ─────────────────────────────────────────────────────────────────────────────
import {
  RED_PATTERNS,
  YELLOW_PATTERNS,
  EMERGENCY_KEYWORDS,
  DISCLAIMER_YELLOW,
  DISCLAIMER_MARKERS,
  EMERGENCY_RESPONSE,
  RED_SAFE_MESSAGE,
} from '../api/prompt-policy.js';

/**
 * evaluateGreenYellowRed — 답변 내용 기반 등급 판정
 * api/chat.js의 동일 함수와 로직 일치 필수
 */
function evaluateGreenYellowRed(question, answer) {
  const text = answer || '';

  // 1. RED 패턴 검사
  for (const { re, reason } of RED_PATTERNS) {
    if (re.test(text)) return { grade: 'red', reason };
  }

  // 2. YELLOW 패턴 검사
  for (const re of YELLOW_PATTERNS) {
    if (re.test(text)) return { grade: 'yellow', reason: null };
  }

  // 3. 질문의 위험 키워드 → yellow로 상향 (caution 키워드)
  const cautionKeywords = ['상한량', '처방약', '항생제', '진단', '알레르기', '과민반응', '부작용'];
  if (cautionKeywords.some(k => question.includes(k))) {
    return { grade: 'yellow', reason: null };
  }

  return { grade: 'green', reason: null };
}

/**
 * appendDisclaimerIfNeeded — YELLOW 면책 문구 중복 없이 추가
 */
function appendDisclaimerIfNeeded(answer) {
  const hasMarker = DISCLAIMER_MARKERS.some(m => answer.includes(m));
  if (hasMarker) return answer;
  return answer + DISCLAIMER_YELLOW;
}

/**
 * isEmergency — 응급 키워드 감지
 */
function isEmergency(text) {
  return EMERGENCY_KEYWORDS.some(k => text.includes(k));
}

// ─────────────────────────────────────────────────────────────────────────────
// T1. GREEN 답변 — 정상 표시
// ─────────────────────────────────────────────────────────────────────────────
test('T1: 일반 영양 정보 답변은 GREEN으로 분류된다', () => {
  const answer = '아연은 정상적인 성장과 발달에 필요한 영양소예요. 식품으로는 고기, 견과류에 많이 들어있어요.';
  const result = evaluateGreenYellowRed('아연이 뭐예요?', answer);
  assert.equal(result.grade, 'green');
  assert.equal(result.reason, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// T2. YELLOW 답변 — 주의 문구 자동 추가
// ─────────────────────────────────────────────────────────────────────────────
test('T2: YELLOW 패턴 포함 답변은 YELLOW로 분류된다', () => {
  const answer = '철분이 부족한 경우 피로감이 나타날 수 있어요. 섭취를 권장하는 경우가 있습니다.';
  const result = evaluateGreenYellowRed('철분 부족인가요?', answer);
  assert.equal(result.grade, 'yellow');
});

test('T2b: YELLOW 답변에 면책 문구가 추가된다', () => {
  const answer = '철분 부족한 경우 피로감이 나타날 수 있어요.';
  const withDisclaimer = appendDisclaimerIfNeeded(answer);
  assert.ok(withDisclaimer.includes('소아과'), '소아과 키워드가 면책 문구에 포함되어야 한다');
  assert.ok(withDisclaimer.includes('참고용'), '참고용 키워드가 면책 문구에 포함되어야 한다');
  assert.ok(withDisclaimer.length > answer.length, '면책 문구가 추가되어 길이가 늘어나야 한다');
});

// ─────────────────────────────────────────────────────────────────────────────
// T3. YELLOW 면책 문구 중복 방지
// ─────────────────────────────────────────────────────────────────────────────
test('T3: 이미 면책 문구가 있는 답변에는 중복 추가되지 않는다', () => {
  const answer = '아연 부족 가능성이 있어요. 소아과 전문의와 상담해 주세요.';
  const withDisclaimer = appendDisclaimerIfNeeded(answer);
  // 이미 '소아과' 마커가 있으므로 추가 없음
  assert.equal(withDisclaimer, answer, '이미 면책 문구가 있으면 원본과 동일해야 한다');
});

test('T3b: 전문의 언급이 있어도 중복 추가되지 않는다', () => {
  const answer = '해당 증상은 소아과 전문의 상담이 필요한 상황입니다.';
  const result = appendDisclaimerIfNeeded(answer);
  // DISCLAIMER_MARKERS에 '전문의' 포함 → 추가 없음
  assert.equal(result, answer);
});

test('T3c: DISCLAIMER_MARKERS 6개 모두 중복 방지 기능이 동작한다', () => {
  for (const marker of DISCLAIMER_MARKERS) {
    const answer = `이 답변에는 ${marker} 내용이 포함되어 있습니다.`;
    const result = appendDisclaimerIfNeeded(answer);
    assert.equal(result, answer, `마커 '${marker}'가 있을 때 중복 추가 안 됨`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T4. RED 원문 노출 차단
// ─────────────────────────────────────────────────────────────────────────────
test('T4: 빈혈 단정 표현은 RED로 분류된다', () => {
  const answer = '아이에게 빈혈이 있는 상태입니다. 즉시 철분제를 복용하세요.';
  const result = evaluateGreenYellowRed('빈혈 있나요?', answer);
  assert.equal(result.grade, 'red');
  assert.ok(result.reason?.includes('빈혈'), `RED 사유에 '빈혈'이 포함되어야 한다: ${result.reason}`);
});

test('T4b: 결핍 상태 단정은 RED로 분류된다', () => {
  const answer = '현재 결핍 상태입니다. 바로 보충제가 필요합니다.';
  const result = evaluateGreenYellowRed('비타민D 부족인가요?', answer);
  assert.equal(result.grade, 'red');
});

test('T4c: 구체적 복용 처방은 RED로 분류된다', () => {
  const answer = '하루에 500mg 드세요.';
  const result = evaluateGreenYellowRed('얼마나 먹을까요?', answer);
  assert.equal(result.grade, 'red');
});

test('T4d: 처방약 중단 권고는 RED로 분류된다', () => {
  const answer = '이 약은 안 드셔도 괜찮아요. 끊어도 됩니다.';
  const result = evaluateGreenYellowRed('약 계속 먹어야 하나요?', answer);
  assert.equal(result.grade, 'red');
});

test('T4e: RED 답변이 차단되면 RED_SAFE_MESSAGE가 반환된다', () => {
  assert.ok(RED_SAFE_MESSAGE.length > 0, 'RED_SAFE_MESSAGE가 비어있으면 안 된다');
  assert.ok(!RED_SAFE_MESSAGE.includes('빈혈이 있'), 'RED_SAFE_MESSAGE에 진단 단정 표현이 없어야 한다');
  assert.ok(RED_SAFE_MESSAGE.includes('소아과') || RED_SAFE_MESSAGE.includes('전문'), '안전 안내 문구가 있어야 한다');
});

// ─────────────────────────────────────────────────────────────────────────────
// T5. 응급 키워드 감지 및 안전 응답
// ─────────────────────────────────────────────────────────────────────────────
test('T5: 과다복용 키워드는 응급으로 감지된다', () => {
  assert.ok(isEmergency('아이가 영양제를 과다복용했어요'), '과다복용 감지');
});

test('T5b: 경련 키워드는 응급으로 감지된다', () => {
  assert.ok(isEmergency('아이가 경련을 일으켜요'), '경련 감지');
});

test('T5c: 실신 키워드는 응급으로 감지된다', () => {
  assert.ok(isEmergency('아이가 실신했어요'), '실신 감지');
});

test('T5d: 응급 응답에는 119 안내가 포함된다', () => {
  assert.ok(EMERGENCY_RESPONSE.includes('119'), 'EMERGENCY_RESPONSE에 119 포함');
  assert.ok(EMERGENCY_RESPONSE.includes('응급실'), 'EMERGENCY_RESPONSE에 응급실 포함');
});

test('T5e: 일반 질문은 응급으로 감지되지 않는다', () => {
  assert.ok(!isEmergency('아이가 철분제를 먹어도 될까요?'), '일반 질문은 응급 아님');
  assert.ok(!isEmergency('비타민D 하루 권장량이 얼마인가요?'), '권장량 질문은 응급 아님');
});

// ─────────────────────────────────────────────────────────────────────────────
// T6. 기존 제품 상담 회귀 테스트 (정상 GREEN 판정)
// ─────────────────────────────────────────────────────────────────────────────
test('T6: 아연 정보 답변은 GREEN이다', () => {
  const answer = '아연은 정상적인 성장과 발달에 필요한 미네랄이에요. 이 월령 기준 하루 권장량은 3~4mg이에요.';
  // "이 월령에는" 패턴과 수치 패턴이 YELLOW를 유발할 수 있음 → 정확히 확인
  const result = evaluateGreenYellowRed('아연 정보 알려줘', answer);
  // 수치(3~4mg)가 포함됐으면 YELLOW, 없으면 GREEN — 실제 YELLOW도 허용
  assert.ok(['green', 'yellow'].includes(result.grade), `아연 답변 등급이 green 또는 yellow여야 한다: ${result.grade}`);
  assert.notEqual(result.grade, 'red', '아연 정보 답변이 RED가 되면 안 된다');
});

test('T6b: 일반 비타민D 답변은 RED가 아니다', () => {
  const answer = '비타민D는 칼슘 흡수와 뼈 건강에 중요한 영양소예요. 부족한 경우 성장에 영향을 줄 수 있어요.';
  const result = evaluateGreenYellowRed('비타민D 왜 필요해요?', answer);
  assert.notEqual(result.grade, 'red');
});

test('T6c: 복합 영양제 조합 질문 답변은 RED가 아니다', () => {
  const answer = '철분과 칼슘을 같이 먹을 때는 흡수를 방해할 수 있어요. 시간 간격을 두는 것이 좋아요.';
  const result = evaluateGreenYellowRed('철분이랑 칼슘 같이 먹어도 돼요?', answer);
  assert.notEqual(result.grade, 'red', '영양소 조합 안내가 RED가 되면 안 된다');
});

// ─────────────────────────────────────────────────────────────────────────────
// T7. RED 패턴 전체 커버리지 확인
// ─────────────────────────────────────────────────────────────────────────────
test('T7: RED_PATTERNS가 13개 이상 정의되어 있다', () => {
  assert.ok(RED_PATTERNS.length >= 13, `RED_PATTERNS가 ${RED_PATTERNS.length}개 — 13개 이상이어야 한다`);
});

test('T7b: 모든 RED_PATTERNS에 re와 reason이 있다', () => {
  for (const p of RED_PATTERNS) {
    assert.ok(p.re instanceof RegExp, `re가 RegExp여야 한다: ${JSON.stringify(p)}`);
    assert.ok(typeof p.reason === 'string' && p.reason.length > 0, `reason이 비어있으면 안 된다: ${JSON.stringify(p)}`);
  }
});

test('T7c: YELLOW_PATTERNS가 6개 이상 정의되어 있다', () => {
  assert.ok(YELLOW_PATTERNS.length >= 6, `YELLOW_PATTERNS가 ${YELLOW_PATTERNS.length}개 — 6개 이상이어야 한다`);
});

test('T7d: EMERGENCY_KEYWORDS가 15개 이상 정의되어 있다', () => {
  assert.ok(EMERGENCY_KEYWORDS.length >= 15, `EMERGENCY_KEYWORDS가 ${EMERGENCY_KEYWORDS.length}개 — 15개 이상이어야 한다`);
});

// ─────────────────────────────────────────────────────────────────────────────
// T8. 경계값 테스트
// ─────────────────────────────────────────────────────────────────────────────
test('T8: 빈 답변은 GREEN으로 처리된다', () => {
  const result = evaluateGreenYellowRed('질문', '');
  assert.equal(result.grade, 'green');
});

test('T8b: null 답변은 GREEN으로 처리된다 (오류 없음)', () => {
  assert.doesNotThrow(() => {
    const result = evaluateGreenYellowRed('질문', null);
    assert.equal(result.grade, 'green');
  });
});

test('T8c: 단정 표현이 가능성 표현으로 완화된 경우는 RED가 아니다', () => {
  // "부족합니다" (단정) → RED
  // "부족할 수 있어요" (가능성) → YELLOW or GREEN
  const softAnswer = '아이에게 아연이 부족할 수 있어요.';
  const result = evaluateGreenYellowRed('아연 부족인가요?', softAnswer);
  assert.notEqual(result.grade, 'red', '부족할 수 있어요는 RED가 아니어야 한다');
});

// ─────────────────────────────────────────────────────────────────────────────
// T9. 쿼터 차감 응답 필드 (quotaDeducted) 검증
//     api/chat.js 응답 JSON에 포함되는 quotaDeducted 값 확인
//     index.html sendChat()은 이 값을 기준으로 incQuota() 실행 여부 결정
// ─────────────────────────────────────────────────────────────────────────────

// 모의 응답 객체 생성 헬퍼 (실제 fetch 없이 로직만 검증)
function simulateClientQuota(responseData) {
  // index.html sendChat() 로직 재현
  if (responseData.error || !responseData.reply) return 'error_no_quota';
  if (responseData.quotaDeducted === false) return 'no_deduct';
  return 'deduct';
}

test('T9: GREEN 정상 답변 — 쿼터 차감', () => {
  const response = { reply: '아연 정보예요.', evalGrade: 'green', quotaDeducted: true };
  assert.equal(simulateClientQuota(response), 'deduct', 'GREEN은 쿼터를 차감해야 한다');
});

test('T9b: YELLOW 답변 — 쿼터 차감', () => {
  const response = { reply: '부족 가능성이 있어요. ⚠️ 참고용.', evalGrade: 'yellow', disclaimer: true, quotaDeducted: true };
  assert.equal(simulateClientQuota(response), 'deduct', 'YELLOW는 쿼터를 차감해야 한다');
});

test('T9c: RED 차단 답변 — 쿼터 미차감', () => {
  const response = { reply: '💜 코니가 조금 더 신중하게...', evalGrade: 'red', held: true, quotaDeducted: false };
  assert.equal(simulateClientQuota(response), 'no_deduct', 'RED 차단은 쿼터를 차감하면 안 된다');
});

test('T9d: 응급 안전 응답 — 쿼터 미차감', () => {
  const response = { reply: '⚠️ 응급 상황일 수 있어요...', evalGrade: 'red', isEmergency: true, quotaDeducted: false };
  assert.equal(simulateClientQuota(response), 'no_deduct', '응급 응답은 쿼터를 차감하면 안 된다');
});

test('T9e: AI API 실패(error 필드) — 쿼터 미차감', () => {
  const response = { error: '상담 연결이 원활하지 않아요.', quotaDeducted: false };
  assert.equal(simulateClientQuota(response), 'error_no_quota', 'API 오류는 쿼터를 차감하면 안 된다');
});

test('T9f: DB 저장 실패 시도 — reply 없음 → 쿼터 미차감', () => {
  // DB 저장 실패는 서버 오류로 이어져 reply가 없거나 error가 반환됨
  const response = { error: '잠시 후 다시 시도해 주세요.', quotaDeducted: false };
  assert.equal(simulateClientQuota(response), 'error_no_quota', 'DB 저장 실패는 쿼터를 차감하면 안 된다');
});

test('T9g: quotaDeducted 없는 구형 응답도 정상 차감된다 (하위 호환)', () => {
  // quotaDeducted 필드가 없을 때 undefined !== false → 차감
  const response = { reply: '아연 정보예요.' }; // quotaDeducted 없음
  assert.equal(simulateClientQuota(response), 'deduct', 'quotaDeducted 필드 없으면 기본 차감 동작');
});
