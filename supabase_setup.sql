-- ============================================================
-- 뉴니콘 Supabase 테이블 설정
-- Supabase Dashboard → SQL Editor에서 실행하세요
-- ============================================================

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

create policy "user_children: 본인만 읽기" on public.user_children
  for select using (auth.uid() = user_id);

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

create policy "scan_history: 본인만 읽기" on public.scan_history
  for select using (auth.uid() = user_id);

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
