-- ============================================================
-- 뉴니콘 Supabase 최종 설정 SQL (통합본)
-- ============================================================
-- 사용법:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. 이 파일 전체를 붙여넣고 Run
--   3. 맨 아래 "완료 확인" 결과에 테이블 17개가 나오면 성공
--
-- 포함 내용 (순서 중요):
--   [A] 사용자 앱 테이블   ← supabase_setup.sql
--   [B] 관리자 테이블      ← admin_migration_v2.sql
--   [C] GREEN/YELLOW/RED   ← admin_migration_v3.sql
--   [D] 관리자 계정 등록 (이메일 수정 후 별도 실행)
--
-- 재실행 안전: 전체가 하나의 트랜잭션. 중간 오류 시 전부 롤백.
-- 생성일: 2026-09-04
-- ============================================================

BEGIN;

-- ############################################################
-- [A] 사용자 앱 테이블
-- ############################################################

-- 1. user_children — 아이 프로필 (로그인 후 마이그레이션 대상)
create table if not exists public.user_children (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default '',
  birthdate   date,
  gender      text default '',
  months      int  default 18,
  emoji       text default '👶',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id)   -- 계정당 아이 1명 (향후 다자녀 확장 가능)
);

alter table public.user_children enable row level security;

drop policy if exists "user_children: 본인만 읽기" on public.user_children;
create policy "user_children: 본인만 읽기" on public.user_children
  for select using (auth.uid() = user_id);

drop policy if exists "user_children: 본인만 쓰기" on public.user_children;
create policy "user_children: 본인만 쓰기" on public.user_children
  for all using (auth.uid() = user_id);

-- 2. scan_history — 스캔 이력 (로그인 후 마이그레이션 + 이후 실시간 저장)
create table if not exists public.scan_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  product_name  text default '',
  age_label     text default '',
  nutrient_keys text[] default '{}',
  inputs        jsonb  default '{}',
  timing        text   default '',
  scanned_at    timestamptz default now()
);

alter table public.scan_history enable row level security;

drop policy if exists "scan_history: 본인만 읽기" on public.scan_history;
create policy "scan_history: 본인만 읽기" on public.scan_history
  for select using (auth.uid() = user_id);

drop policy if exists "scan_history: 본인만 쓰기" on public.scan_history;
create policy "scan_history: 본인만 쓰기" on public.scan_history
  for all using (auth.uid() = user_id);

-- 3. 기존 profiles 테이블이 없으면 생성 (호환)
create table if not exists public.profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  name    text default '',
  months  int  default 18,
  emoji   text default '👶'
);
alter table public.profiles enable row level security;
drop policy if exists "profiles: 본인만" on public.profiles;
create policy "profiles: 본인만" on public.profiles
  for all using (auth.uid() = id);

-- 4. supplements 테이블
create table if not exists public.supplements (
  id        text primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  emoji     text default '💊',
  timing    text default '아침 식후',
  memo      text default ''
);
alter table public.supplements enable row level security;
drop policy if exists "supplements: 본인만" on public.supplements;
create policy "supplements: 본인만" on public.supplements
  for all using (auth.uid() = user_id);

-- 5. daily_logs 테이블
create table if not exists public.daily_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  supplement_id  text not null,
  log_date       date not null,
  done           boolean default true,
  unique(user_id, supplement_id, log_date)
);
alter table public.daily_logs enable row level security;
drop policy if exists "daily_logs: 본인만" on public.daily_logs;
create policy "daily_logs: 본인만" on public.daily_logs
  for all using (auth.uid() = user_id);

-- 6. feedback 테이블 (기존)
create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  rating        int,
  tags          text[],
  message       text,
  age_label     text,
  child_months  int,
  created_at    timestamptz default now()
);


-- profiles: 신규 회원 통계용 (관리자 대시보드에서 사용)
alter table public.profiles add column if not exists created_at timestamptz default now();

-- ############################################################
-- [B] 관리자 테이블
-- ############################################################

-- ============================================================
-- 뉴니콘 관리자 패널 DB 마이그레이션 v2
-- API 파일과 컬럼명 일치 버전
-- ============================================================

-- 1. user_roles
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin', 'moderator')),
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz default now(),
  is_active   boolean default true,
  note        text default '',
  unique(user_id, role)
);
alter table public.user_roles enable row level security;
drop policy if exists "user_roles: 서비스 롤만 접근" on public.user_roles;
create policy "user_roles: 서비스 롤만 접근" on public.user_roles for all using (false);

-- 2. admin_audit_logs
create table if not exists public.admin_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  admin_user_id  uuid not null,
  action_type    text not null,
  target_type    text,
  target_id      text,
  before_value   jsonb,
  after_value    jsonb,
  metadata       jsonb default '{}',
  success        boolean default true,
  error_message  text,
  created_at     timestamptz default now()
);
alter table public.admin_audit_logs enable row level security;
drop policy if exists "audit_logs: 서비스 롤만 접근" on public.admin_audit_logs;
create policy "audit_logs: 서비스 롤만 접근" on public.admin_audit_logs for all using (false);
create index if not exists audit_logs_admin_idx on public.admin_audit_logs(admin_user_id, created_at desc);

-- 3. chat_logs
create table if not exists public.chat_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete set null,
  question            text not null,
  answer              text,
  child_age_label     text,
  child_months        int,
  supplements_context text,
  status              text not null default 'pending'
                        check (status in ('success','failed','timeout','empty_reply','pending')),
  error_code          text,
  quota_deducted      boolean default false,
  risk_level          text default 'normal'
                        check (risk_level in ('normal','caution','high')),
  risk_flags          text[] default '{}',
  review_status       text default 'pending'
                        check (review_status in ('pending','reviewing','normal','needs_revision','dangerous','completed')),
  reviewer_id         uuid references auth.users(id) on delete set null,
  reviewer_note       text,
  disclaimer_shown    boolean default true,
  user_agent          text,
  created_at          timestamptz default now()
);
alter table public.chat_logs enable row level security;
drop policy if exists "chat_logs: 본인만 읽기" on public.chat_logs;
create policy "chat_logs: 본인만 읽기" on public.chat_logs for select using (auth.uid() = user_id);
drop policy if exists "chat_logs: 서비스 롤만 쓰기" on public.chat_logs;
create policy "chat_logs: 서비스 롤만 쓰기" on public.chat_logs for insert with check (false);
create index if not exists chat_logs_user_idx on public.chat_logs(user_id, created_at desc);
create index if not exists chat_logs_risk_idx on public.chat_logs(risk_level, review_status, created_at desc);
create index if not exists chat_logs_status_idx on public.chat_logs(status, created_at desc);

-- 4. reviewed_answers (API 컬럼명 기준)
create table if not exists public.reviewed_answers (
  id                uuid primary key default gen_random_uuid(),
  topic             text not null,
  sub_topic         text,
  trigger_keywords  text not null,
  answer_text       text not null,
  source_chat_id    uuid references public.chat_logs(id) on delete set null,
  notes             text,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  version           int default 1,
  is_active         boolean default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.reviewed_answers enable row level security;
drop policy if exists "reviewed_answers: 활성 읽기" on public.reviewed_answers;
create policy "reviewed_answers: 활성 읽기" on public.reviewed_answers
  for select using (is_active = true);
drop policy if exists "reviewed_answers: 서비스 롤만 쓰기" on public.reviewed_answers;
create policy "reviewed_answers: 서비스 롤만 쓰기" on public.reviewed_answers for all using (false);

-- 5. reviewed_answer_versions (API 컬럼명 기준)
create table if not exists public.reviewed_answer_versions (
  id                   uuid primary key default gen_random_uuid(),
  reviewed_answer_id   uuid not null references public.reviewed_answers(id) on delete cascade,
  version              int not null,
  answer_text          text,
  changed_by           uuid references auth.users(id) on delete set null,
  change_note          text,
  created_at           timestamptz default now()
);
alter table public.reviewed_answer_versions enable row level security;
drop policy if exists "rav: 서비스 롤만" on public.reviewed_answer_versions;
create policy "rav: 서비스 롤만" on public.reviewed_answer_versions for all using (false);
create index if not exists rav_answer_idx on public.reviewed_answer_versions(reviewed_answer_id, version desc);

-- 6. products
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  brand               text not null,
  product_name        text not null,
  product_type        text,
  is_children         boolean default true,
  is_active           boolean default false,
  version             int default 1,
  data_review_status  text default 'draft'
                        check (data_review_status in ('draft','reviewed','published')),
  last_reviewed_at    timestamptz,
  internal_note       text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique(brand, product_name, version)
);
alter table public.products enable row level security;
drop policy if exists "products: 활성 읽기" on public.products;
create policy "products: 활성 읽기" on public.products for select using (is_active = true);
drop policy if exists "products: 서비스 롤만 쓰기" on public.products;
create policy "products: 서비스 롤만 쓰기" on public.products for all using (false);
create index if not exists products_brand_idx on public.products(brand, is_active);

-- 7. product_nutrients
create table if not exists public.product_nutrients (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id) on delete cascade,
  nutrient_name       text not null,
  amount_per_serving  numeric not null check (amount_per_serving >= 0),
  unit                text not null,
  created_at          timestamptz default now()
);
alter table public.product_nutrients enable row level security;
drop policy if exists "product_nutrients: 활성 제품 읽기" on public.product_nutrients;
create policy "product_nutrients: 활성 제품 읽기" on public.product_nutrients
  for select using (
    exists (select 1 from public.products p where p.id = product_id and p.is_active = true)
  );
drop policy if exists "product_nutrients: 서비스 롤만 쓰기" on public.product_nutrients;
create policy "product_nutrients: 서비스 롤만 쓰기" on public.product_nutrients for all using (false);
create index if not exists pn_product_idx on public.product_nutrients(product_id);

-- 8. product_versions
create table if not exists public.product_versions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  version     int not null,
  snapshot    jsonb not null,
  changed_by  uuid references auth.users(id) on delete set null,
  change_note text,
  created_at  timestamptz default now()
);
alter table public.product_versions enable row level security;
drop policy if exists "product_versions: 서비스 롤만" on public.product_versions;
create policy "product_versions: 서비스 롤만" on public.product_versions for all using (false);
create index if not exists pv_product_idx on public.product_versions(product_id, version desc);

-- 9. nutrition_references (API 컬럼명 기준)
create table if not exists public.nutrition_references (
  id                  uuid primary key default gen_random_uuid(),
  nutrient_key        text not null,
  age_group_label     text not null,
  age_min_months      int,
  age_max_months      int,
  recommended_intake  numeric,
  upper_limit         numeric,
  unit                text not null,
  kdri_year           int default 2025,
  notes               text,
  updated_at          timestamptz default now(),
  created_at          timestamptz default now(),
  unique(nutrient_key, age_group_label)
);
alter table public.nutrition_references enable row level security;
drop policy if exists "nutrition_references: 읽기" on public.nutrition_references;
create policy "nutrition_references: 읽기" on public.nutrition_references for select using (true);
drop policy if exists "nutrition_references: 서비스 롤만 쓰기" on public.nutrition_references;
create policy "nutrition_references: 서비스 롤만 쓰기" on public.nutrition_references for all using (false);

-- 10. operation_settings (API 컬럼명 기준)
create table if not exists public.operation_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.operation_settings enable row level security;
drop policy if exists "settings: 읽기" on public.operation_settings;
create policy "settings: 읽기" on public.operation_settings for select using (true);
drop policy if exists "settings: 서비스 롤만 쓰기" on public.operation_settings;
create policy "settings: 서비스 롤만 쓰기" on public.operation_settings for all using (false);

insert into public.operation_settings (key, value, description) values
  ('free_daily_quota',      '3',           '비회원 하루 무료 상담 횟수'),
  ('member_daily_quota',    '10',          '회원 하루 상담 횟수'),
  ('ai_model',              '"claude-haiku-4-5-20251001"', 'AI 모델명'),
  ('ai_max_tokens',         '512',         'AI 최대 토큰'),
  ('risk_keywords_high',    '["과다복용","과용량","중독","응급","경련","의식","쓰러","호흡","알레르기 쇼크","아나필락시","실신","너무 많이 먹","한꺼번에 먹","실수로 먹","잘못 먹"]', '위험 키워드 (high)'),
  ('risk_keywords_caution', '["상한량","최대용량","용량 초과","여러 개 동시","약이랑 같이","처방약","항생제","스테로이드","진단","치료","처방"]', '주의 키워드 (caution)'),
  ('maintenance_mode',      'false',       '점검 모드'),
  ('maintenance_message',   '""',          '점검 안내 메시지'),
  ('ai_disclaimer_text',    '"뉴니콘의 AI 안내는 참고용 정보이며, 의료진의 진단·처방을 대신하지 않습니다."', 'AI 면책 문구'),
  ('min_app_version',       '"1.0.0"',     '최소 지원 앱 버전')
on conflict (key) do nothing;

-- 11. quota_adjustments (API 컬럼명 기준)
create table if not exists public.quota_adjustments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  adjustment   int not null,
  reason       text not null default '',
  adjusted_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz default now()
);
alter table public.quota_adjustments enable row level security;
drop policy if exists "quota_adjustments: 서비스 롤만" on public.quota_adjustments;
create policy "quota_adjustments: 서비스 롤만" on public.quota_adjustments for all using (false);
create index if not exists qa_user_idx on public.quota_adjustments(user_id, created_at desc);

-- ############################################################
-- [C] GREEN / YELLOW / RED 등급 + RED 승인 큐
-- ############################################################

-- ──────────────────────────────────────────────────────────
-- 1. chat_logs 테이블에 컬럼 추가
--    모두 nullable 또는 DEFAULT 있음 → 기존 데이터 영향 없음
-- ──────────────────────────────────────────────────────────

-- 1-1. eval_grade: GREEN/YELLOW/RED 판정 결과
alter table public.chat_logs
  add column if not exists eval_grade text
    default 'green'
    check (eval_grade in ('green','yellow','red'));

comment on column public.chat_logs.eval_grade is
  'agency/evals/health-answer-evaluation.md 기준 AI 답변 등급. green=정상, yellow=면책추가, red=사전차단';

-- 1-2. held_for_review: RED 판정으로 사용자 노출 차단 여부
alter table public.chat_logs
  add column if not exists held_for_review boolean
    default false;

comment on column public.chat_logs.held_for_review is
  'RED 판정 시 true. 원본 답변이 사용자에게 표시되지 않고 관리자 승인 대기 중임을 표시';

-- 1-3. eval_reason: RED 판정 사유 (어떤 패턴에 매칭됐는지)
alter table public.chat_logs
  add column if not exists eval_reason text;

comment on column public.chat_logs.eval_reason is
  'RED 판정 사유. RED_PATTERNS 중 어떤 패턴에 매칭됐는지 기록';

-- 1-4. red_review_status: 관리자 검토 상태 (RED 답변 전용)
alter table public.chat_logs
  add column if not exists red_review_status text
    check (red_review_status in ('pending','approved','rejected','edited') or red_review_status is null);

comment on column public.chat_logs.red_review_status is
  'RED 답변의 관리자 검토 상태. NULL=비RED, pending=검토대기, approved=승인, rejected=거절, edited=수정승인';

-- 1-5. red_approved_answer: 관리자가 수정·승인한 최종 답변
alter table public.chat_logs
  add column if not exists red_approved_answer text;

comment on column public.chat_logs.red_approved_answer is
  '관리자가 approved 또는 edited 상태로 승인한 답변 텍스트. 향후 reviewed_answers 등록 소스로 활용 가능';

-- 1-6. red_approved_at: 승인/거절 처리 시각
alter table public.chat_logs
  add column if not exists red_approved_at timestamptz;

-- 1-7. red_approver_id: 승인/거절 처리한 관리자
alter table public.chat_logs
  add column if not exists red_approver_id uuid
    references auth.users(id) on delete set null;

-- ──────────────────────────────────────────────────────────
-- 2. 인덱스 추가
--    CREATE INDEX IF NOT EXISTS: 재실행 안전
--    ※ CONCURRENTLY 미사용 → 트랜잭션 안에서 실행 가능
-- ──────────────────────────────────────────────────────────

-- RED 검토 큐 조회용
create index if not exists chat_logs_held_idx
  on public.chat_logs(held_for_review, red_review_status, created_at desc)
  where held_for_review = true;

-- eval_grade별 통계용
create index if not exists chat_logs_eval_grade_idx
  on public.chat_logs(eval_grade, created_at desc);

-- ──────────────────────────────────────────────────────────
-- 3. 기존 데이터 backfill (선택 사항)
--    기존 레코드에 eval_grade를 채우려면 주석 해제 후 실행.
--    risk_level=high → red, caution → yellow, normal → green
-- ──────────────────────────────────────────────────────────
/*
update public.chat_logs
set eval_grade = case
  when risk_level = 'high'    then 'red'
  when risk_level = 'caution' then 'yellow'
  else 'green'
end
where eval_grade is null or eval_grade = 'green';
*/

-- ──────────────────────────────────────────────────────────
-- 4. operation_settings에 RED 차단 설정 추가
--    ON CONFLICT DO NOTHING: 재실행 안전
-- ──────────────────────────────────────────────────────────

insert into public.operation_settings (key, value, description) values
  ('red_hold_enabled',      'true',  'RED 판정 답변 사용자 노출 차단 활성화'),
  ('red_disclaimer_text',   '"💜 전문가 검토 후 안내드릴게요. 일반 질문을 남겨주세요."',
                                     'RED 차단 시 사용자에게 표시할 메시지'),
  ('yellow_disclaimer_text','"⚠️ 이 내용은 참고용 영양 정보예요. 소아과 전문의와 상담해 주세요."',
                                     'YELLOW 자동 면책 문구')
on conflict (key) do nothing;

COMMIT;

-- ############################################################
-- 완료 확인 — 아래 결과에 17개 테이블이 보이면 성공
-- ############################################################
select table_name from information_schema.tables
where table_schema = 'public' and table_name in (
  'user_children','scan_history','profiles','supplements','daily_logs','feedback',
  'user_roles','admin_audit_logs','chat_logs','reviewed_answers','reviewed_answer_versions',
  'products','product_nutrients','product_versions','nutrition_references',
  'operation_settings','quota_adjustments'
)
order by table_name;


-- ############################################################
-- [D] 관리자 계정 등록  ※ 위 SQL 성공 후, 별도로 실행
-- ############################################################
-- 순서:
--   1. Supabase Dashboard → Authentication → Users → "Add user"
--      → 이메일 + 비밀번호 입력, "Auto Confirm User" 체크 → Create
--      (또는 www.nunicorn.co.kr 에서 해당 이메일로 먼저 가입)
--   2. 아래 이메일을 본인 것으로 바꾼 뒤 이 블록만 선택해서 Run
--
-- insert into public.user_roles (user_id, role, note)
-- select id, 'admin', '초기 관리자'
-- from auth.users
-- where email = 'ayakmain@gmail.com'
-- on conflict (user_id, role) do update set is_active = true;
--
-- 확인:
-- select u.email, r.role, r.is_active
-- from public.user_roles r join auth.users u on u.id = r.user_id;
