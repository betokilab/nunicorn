# Resend DNS 레코드 — 가비아에 등록

가비아 → My가비아 → 도메인 → `nunicorn.co.kr` **DNS 관리(설정)** → 레코드 추가

| 타입 | 호스트(이름) | 값 | TTL |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCfwKQhjk29tbjrHnWVBkemrdeo7UR3vDUx2hLbofbeINXW2J/OvqMPZkm4T43zASANX32wlyAHkes1NveSn8vS/Gl2F0QxWkG/G+nBPOTs8uOfYlzWLB93LbI1PDehHBkqia4rKbD2PrltvCk3AzFDnZdPIOACJKVXCV/FA8ltVQIDAQAB` | 3600 |
| CNAME | `send` | `send.forge.rmta.net` | 3600 |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | 3600 |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | 3600 |

주의
- 가비아 호스트 칸에는 `resend._domainkey`, `send`, `rsend`, `_dmarc`처럼 **도메인 뒤를 뺀 앞부분만** 입력 (`.nunicorn.co.kr` 붙이지 않기)
- CNAME 값 끝에 점(`.`)이 자동으로 붙어도 정상
- Resend 화면의 **MX 레코드(@ → inbound-smtp…)는 등록하지 않음** — 메일 *수신*용이라 불필요하고, 나중에 회사 메일을 쓸 때 충돌함
- 등록 후 5~30분 뒤 Resend → Domains → **Verify DNS Records** 클릭 → 전부 Verified 되면 완료

---

# Supabase SMTP 설정 (DNS 인증 후)

Supabase → Project Settings → Authentication → **SMTP Settings** → Enable Custom SMTP

| 항목 | 값 |
|---|---|
| Sender email | `no-reply@nunicorn.co.kr` |
| Sender name | `뉴니콘` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 🔑 Resend API 키 (히치님이 직접 입력) |

저장 후 Authentication → Rate Limits 에서 이메일 발송 한도를 시간당 30 정도로 올릴 수 있음.
