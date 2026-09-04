# 뉴니콘 관리자 페이지 설정 가이드

관리자 페이지 주소: **https://www.nunicorn.co.kr/admin**

아래 5단계를 순서대로 진행하면 됩니다. 소요 시간 약 15분.
🔑 표시가 있는 값은 **절대 채팅이나 코드에 붙여넣지 마세요.** Supabase·Vercel 화면에서만 복사·붙여넣기 합니다.

---

## 1단계. Supabase 프로젝트 만들기 (5분)

1. https://supabase.com 접속 → 로그인
2. **New project** 클릭
3. 입력:
   - Name: `nunicorn`
   - Database Password: 강한 비밀번호 생성 (🔑 메모해 두기 — 나중에 거의 안 쓰지만 복구용)
   - Region: **Northeast Asia (Seoul)**
   - Plan: Free 로 시작해도 됨 (Pro는 필요할 때 전환)
4. **Create new project** → 1~2분 대기

### 완료되면 값 3개 확인해 두기

왼쪽 메뉴 **Project Settings → API** 에서:

| 항목 | 위치 | 어디에 쓰나 |
|---|---|---|
| Project URL | `https://xxxxxxxx.supabase.co` | Vercel + index.html + admin.html |
| anon public key | `eyJ...` (공개키, 노출돼도 됨) | index.html + admin.html |
| 🔑 service_role key | `eyJ...` (**비밀**) | Vercel 환경변수만 |

---

## 2단계. 테이블 만들기 (2분)

1. Supabase 왼쪽 메뉴 **SQL Editor** → **New query**
2. 프로젝트 폴더의 **`supabase_final.sql`** 파일을 메모장으로 열어 **전체 복사**
3. SQL Editor에 붙여넣고 **Run** (Ctrl+Enter)
4. 아래쪽 결과창에 테이블 이름 **17개**가 나오면 성공

> 오류가 나면 아무것도 만들어지지 않고 전부 되돌아갑니다(트랜잭션). 오류 메시지를 그대로 저에게 알려주세요.

---

## 3단계. 관리자 계정 만들기 (2분)

1. Supabase 왼쪽 메뉴 **Authentication → Users → Add user → Create new user**
2. Email: `ayakmain@gmail.com` / Password: 관리자용 비밀번호 🔑
3. **Auto Confirm User** 체크 → **Create user**
4. 다시 **SQL Editor → New query** 로 가서 아래 붙여넣고 Run:

```sql
insert into public.user_roles (user_id, role, note)
select id, 'admin', '초기 관리자'
from auth.users
where email = 'ayakmain@gmail.com'
on conflict (user_id, role) do update set is_active = true;
```

5. 확인용으로 아래 실행 → `admin / true` 한 줄이 나오면 성공:

```sql
select u.email, r.role, r.is_active
from public.user_roles r join auth.users u on u.id = r.user_id;
```

### (선택) Google 로그인 유지하려면

기존 사용자 앱이 Google 로그인을 쓰고 있으니, **Authentication → Providers → Google** 에서 기존 Client ID / Secret 을 다시 등록해야 합니다.
Redirect URL 은 새 프로젝트 것(`https://xxxxxxxx.supabase.co/auth/v1/callback`)으로 Google Cloud Console에도 추가하세요.

---

## 4단계. Vercel 환경변수 넣기 (3분)

1. https://vercel.com → nunicorn 프로젝트 → **Settings → Environment Variables**
2. 아래 3개를 추가 (Environment 는 **Production, Preview, Development 모두** 체크):

| Key | Value |
|---|---|
| `SUPA_URL` | 1단계 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔑 1단계 service_role key |
| `ANTHROPIC_API_KEY` | 기존 값 그대로 (이미 있으면 건너뛰기) |

3. 기존에 옛 Supabase 값이 남아 있으면 **Edit** 으로 교체

---

## 5단계. 코드 연결 + 배포 (저에게 맡기기)

1~4단계가 끝나면 저에게 **Project URL 과 anon key 두 개만** 알려주세요.
(service_role key 는 절대 알려주지 마세요 — Vercel에만 있으면 됩니다.)

그러면 제가:
- `index.html`, `admin.html` 의 Supabase 주소/anon key 교체
- `push_now.bat` 로 배포
- https://www.nunicorn.co.kr/admin 로그인 → 대시보드 표시 확인

까지 진행합니다.

---

## 관리자 페이지 기능

| 메뉴 | 기능 |
|---|---|
| 대시보드 | 오늘/7일/30일 상담 수, 실패율, 위험 답변 큐, 신규 회원 |
| 상담 로그 | 전체 AI 상담 내역 검색·열람 |
| 위험 검토 | RED 등급 답변 승인/수정/거절 (사용자에겐 승인 전까지 미노출) |
| 검수 답변 | 자주 묻는 질문에 대한 사전 검수 답변 관리 (버전 이력) |
| 제품 DB | 영양제 제품·성분 등록 (draft → reviewed → published) |
| 영양 기준 | 2025 KDRIs 권장량·상한량 관리 |
| 사용자 | 회원 목록, 아이 프로필, 상담 횟수 조정 |
| 설정 | 무료 횟수, AI 모델, 위험 키워드, 점검 모드, 면책 문구 |

모든 관리자 조작은 `admin_audit_logs` 에 기록됩니다.

---

## 문제가 생기면

| 증상 | 원인 | 조치 |
|---|---|---|
| 로그인 후 "관리자 권한이 없는 계정입니다" | 3단계 4번 SQL 미실행 | 3단계 4번 다시 실행 |
| "서버 설정 오류" (503) | Vercel 환경변수 누락 | 4단계 확인 후 **Redeploy** |
| 로그인 자체가 안 됨 | admin.html 의 URL/anon key 가 옛 프로젝트 | 5단계 (저에게 알려주기) |
| 대시보드 숫자가 전부 0 | 정상 — 새 DB라 데이터 없음 | 사용자 앱에서 상담 1건 해보기 |
