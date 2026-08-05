# RB-07 계정 탈취·비밀 유출·악성 업로드

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** (관리자 계정 탈취·비밀 유출) / SEV2 (일반 계정) / SEV3 (악성 업로드 격리 성공) |
| 1차 담당 | 보안 담당 + 운영 엔지니어(OE) |
| 에스컬레이션 | 즉시 IC / 15분 내 법률 검토 착수(개인정보 접근 시) / 30분 내 경영진 |
| 관련 SLO | 불변 I-01·I-15 · SEV1 탐지 5분 |
| 관련 kill switch | `ai_provider:<name>`, `auto_publish_questions` (악성 업로드 시) |
| 관련 문서 | [../phase0/threat-model.md](../phase0/threat-model.md) 3.1·3.6·7장 · [../adr/0010-job-queue-and-ai-abstraction.md](../adr/0010-job-queue-and-ai-abstraction.md) |

---

## 1. 탐지 조건

### 1.1 계정 탈취

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `auth_anomaly_geo` | 동일 계정의 서로 다른 지역 로그인 | ≥ 5개 지역 | 1시간 | SEV1 |
| `auth_bruteforce` | 로그인 실패 | > 10회 / IP+이메일 | 15분 | SEV2 |
| `auth_bruteforce_wide` | 단일 IP에서 여러 계정 실패 | > 50회 | 15분 | SEV1 |
| `mfa_bypass_attempt` | MFA 미완료 상태의 쓰기 API 호출 | > 0 | 실시간 | **SEV1** |
| `privileged_action_spike` | 고위험 명령(역할 변경·전체 재채점·내보내기) | > 5건 / 계정 | 1시간 | **SEV1** |
| `mass_export` | `privacy.export` 감사 기록 | > 3건 / 계정 | 1시간 | **SEV1** |
| `role_escalation` | `ROLE_ASSIGN_FORBIDDEN` 시도 | > 3건 | 30분 | SEV2 |
| `session_anomaly` | 동일 계정 동시 활성 세션 | > 10 | 실시간 | SEV2 |

### 1.2 비밀 유출

| 알림 | 조건 | 심각도 |
|---|---|---|
| `secret_in_repo` | 시크릿 스캐너(CI·저장소) 탐지 | **SEV1** |
| `secret_in_log` | 로그에 토큰·키 패턴 탐지 | **SEV1** |
| `ai_key_unexpected_usage` | 등록되지 않은 IP·리전에서 AI 키 사용 | **SEV1** |
| `service_token_expired_use` | 만료 토큰 사용 시도 | SEV3 |
| 외부 제보 | 공급자·연구자 통지 | **SEV1** |

### 1.3 악성 업로드

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `malicious_upload` | `source_files.status='quarantined'` 신규 | > 0 | 실시간 | SEV3 |
| `malicious_upload_burst` | 동일 | > 5건 / 조직 | 1시간 | SEV2 |
| `ai_schema_violation` | zod `.strict()` 파싱 실패 | > 20건 | 30분 | SEV2 |
| `prompt_injection_suspect` | 같은 `source_file_id`에서 스키마 위반 반복 | ≥ 3회 | — | **SEV1** |
| `svg_sanitize_failure` | `diagram_assets.sanitize_status='failed'` | > 10건 | 1시간 | SEV2 |
| `mime_signature_mismatch` | `415 MIME_SIGNATURE_MISMATCH` | > 10건 | 30분 | SEV3 |
| `worker_egress_blocked` | AI 워커의 내부망·메타데이터 접근 차단 로그 | > 0 | 실시간 | **SEV1** |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 워크스페이스 소유자·운영자 계정 탈취 의심 | **SEV1** |
| AI 키·`service_role` 키 유출 확인 | **SEV1** |
| 프롬프트 인젝션이 시스템 동작을 변경한 정황 | **SEV1** |
| AI 워커의 내부망 접근 시도 탐지 | **SEV1** |
| 개인정보 대량 내보내기 실행됨 | **SEV1** + [RB-06](./06-cross-tenant-exposure.md) 병행 |
| 교사·콘텐츠 관리자 계정 탈취 의심 | SEV2 |
| 악성 파일이 격리에 성공 (파이프라인 진입 못 함) | SEV3 |
| 로그인 무차별 대입, 성공 없음 | SEV3 |
| 서비스 토큰 만료 사용 | SEV3 |

---

## 3. 즉시 중지할 기능

### 3.1 계정 탈취

**kill switch가 아니라 계정 단위로 차단한다.**

```sql
-- 1. 멤버십 정지 (권한 즉시 무효화)
UPDATE memberships
SET status = 'suspended', updated_at = now(), version = version + 1
WHERE user_id = $1;

-- 2. 감사 기록
INSERT INTO audit_events (organization_id, actor_user_id, actor_kind, action,
                          target_type, target_id, before, after, reason,
                          permission_basis, occurred_at)
VALUES ($org, $ops_user, 'system', 'membership.suspend',
        'user', $1,
        jsonb_build_object('status','active'),
        jsonb_build_object('status','suspended'),
        'RB-07 계정 탈취 의심', 'incident_response', now());
```

```bash
# 3. Supabase Auth 세션 폐기 (관리 API)
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users/$USER_ID/logout" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "apikey: $SERVICE_ROLE_KEY"
```

**증거를 지우지 않는다.** 계정을 삭제하지 말고 정지만 한다.

### 3.2 비밀 유출

| 유출 대상 | 즉시 조치 |
|---|---|
| AI 공급자 키 | 공급자 콘솔에서 즉시 폐기 → 새 키 발급 → 비밀 관리 시스템 갱신 → 워커 재배포. 그 사이 `ai_provider:<name>` kill switch ON |
| Supabase `service_role` 키 | Supabase 콘솔에서 키 회전 → 전 배포 갱신. **회전 중 관리자 경로가 끊기므로 순서 주의** |
| Supabase `anon` 키 | 회전. 클라이언트 번들 재배포 필요 |
| 서비스 계정 토큰 | 해당 `integration_connections` 비활성 → 새 토큰 발급 → 파트너 통지 |
| DB 자격 증명 | Supabase에서 비밀번호 변경 → 전 배포 갱신 |

```bash
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-07 SEV1 AI 키 유출 의심" --actor <이메일>
```

### 3.3 악성 업로드

```bash
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-07 프롬프트 인젝션 의심" --actor <이메일>

pnpm --filter @su-maek/db kill-switch enable auto_publish_questions \
  --reason "RB-07 악성 업로드 — 미검증 결과 게시 차단" --actor <이메일>
```

**중지해도 반드시 되는 것**:

- 게시된 일정, 오늘 수업 운영
- 학생 응시·답안 저장·제출
- 자동 채점·수동 채점
- 검수 완료 문제은행 조회·출제
- 이미 반입된 문항의 검수 작업
- 수식 파싱·KaTeX 검증 (AI 무관)

---

## 4. 진단

### 4-1. 계정 활동 이력

```sql
SELECT ae.occurred_at, ae.organization_id, ae.action, ae.target_type, ae.target_id,
       ae.permission_basis, ae.reason, ae.correlation_id
FROM audit_events ae
WHERE ae.actor_user_id = $1
  AND ae.occurred_at > now() - interval '30 days'
ORDER BY ae.occurred_at DESC
LIMIT 300;
```

### 4-2. 고위험 명령 실행 여부

```sql
SELECT ae.actor_user_id, u.email, ae.action, count(*) AS n,
       min(ae.occurred_at) AS first_at, max(ae.occurred_at) AS last_at,
       array_agg(DISTINCT ae.organization_id) AS orgs
FROM audit_events ae
LEFT JOIN users u ON u.id = ae.actor_user_id
WHERE ae.occurred_at > now() - interval '7 days'
  AND ae.action IN ('membership.change_role','grading.regrade','content.quarantine',
                    'privacy.export','privacy.erase','organization.request_close',
                    'ops.kill_switch','ops.break_glass_start','rights.suspend',
                    'route.publish','assessment.publish')
GROUP BY 1,2,3
ORDER BY n DESC
LIMIT 50;
```

### 4-3. 개인정보 내보내기 이력

```sql
SELECT ae.occurred_at, ae.organization_id, ae.actor_user_id, u.email,
       ae.after -> 'scope'  AS export_scope,
       ae.after -> 'row_count' AS rows_exported,
       ae.after ->> 'storage_path' AS artifact
FROM audit_events ae
LEFT JOIN users u ON u.id = ae.actor_user_id
WHERE ae.action = 'privacy.export'
  AND ae.occurred_at > now() - interval '30 days'
ORDER BY ae.occurred_at DESC
LIMIT 50;
```

### 4-4. 권한 변경 이력

```sql
SELECT ae.occurred_at, ae.organization_id, ae.actor_user_id,
       ae.target_id AS affected_user,
       ae.before ->> 'role_code' AS from_role,
       ae.after  ->> 'role_code' AS to_role,
       ae.permission_basis
FROM audit_events ae
WHERE ae.action = 'membership.change_role'
  AND ae.occurred_at > now() - interval '30 days'
ORDER BY ae.occurred_at DESC
LIMIT 50;
```

### 4-5. MFA 미설정 교직원 (사고 확대 위험)

```sql
SELECT m.organization_id, m.role_code, count(*) AS members_without_mfa,
       array_agg(u.email ORDER BY u.email) AS emails
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.status = 'active'
  AND m.role_code IN ('owner','program_director','teacher','grader',
                      'content_manager','content_reviewer')
  AND NOT u.mfa_enabled
GROUP BY 1,2
ORDER BY members_without_mfa DESC;
```

### 4-6. 악성 업로드 — 격리된 원본

```sql
SELECT sf.id, sf.organization_id, sf.uploaded_by, u.email,
       sf.sha256, sf.byte_size, sf.mime_detected, sf.page_count,
       sf.status, sf.quarantine_reason, sf.created_at
FROM source_files sf
LEFT JOIN users u ON u.id = sf.uploaded_by
WHERE sf.status = 'quarantined'
  AND sf.created_at > now() - interval '7 days'
ORDER BY sf.created_at DESC
LIMIT 50;
```

### 4-7. 프롬프트 인젝션 신호

```sql
SELECT j.organization_id,
       j.input ->> 'source_file_id' AS source_file_id,
       jr.step, jr.error_code, count(*) AS violations,
       min(jr.started_at) AS first_at, max(jr.started_at) AS last_at
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE jr.outcome = 'failed_final'
  AND jr.error_code IN ('SCHEMA_VIOLATION','ALLOWLIST_VIOLATION','UNEXPECTED_FIELD')
  AND jr.started_at > now() - interval '7 days'
GROUP BY 1,2,3,4
HAVING count(*) >= 3
ORDER BY violations DESC
LIMIT 30;
```

### 4-8. SVG 정제 실패

```sql
SELECT da.organization_id, da.id, da.kind, da.sanitize_status,
       da.sanitize_report, da.created_at
FROM diagram_assets da
WHERE da.sanitize_status = 'failed'
  AND da.created_at > now() - interval '7 days'
ORDER BY da.created_at DESC
LIMIT 50;
```

### 4-9. break-glass 사용 이력

```sql
SELECT bg.id, bg.operator_user_id, bg.organization_id, bg.reason,
       bg.approved_by, bg.approved_by_2, bg.created_at, bg.expires_at, bg.revoked_at,
       (SELECT count(*) FROM audit_events ae
        WHERE ae.actor_user_id = bg.operator_user_id
          AND ae.organization_id = bg.organization_id
          AND ae.occurred_at BETWEEN bg.created_at AND COALESCE(bg.revoked_at, bg.expires_at)
       ) AS actions_taken
FROM break_glass_grants bg
WHERE bg.created_at > now() - interval '30 days'
ORDER BY bg.created_at DESC;
```

---

## 5. 복구 절차

### 5.A 계정 탈취

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 계정 정지 + 세션 폐기 | 3.1 | 3분 |
| 2 | 활동 이력 확보 (4-1~4-4) | 4장 | 15분 |
| 3 | 피해 범위 확정 (5.1) | — | 30~120분 |
| 4 | 수행된 변경 되돌리기 (5.2) | — | 가변 |
| 5 | 동일 IP·패턴의 다른 계정 확인 | 4-2 | 15분 |
| 6 | 계정 복구 (5.3) | — | 15분 |
| 7 | MFA 미설정 계정 일괄 강제 (5.4) | — | 10분 |

#### 5.1 피해 범위 확정

| 확인 | 방법 |
|---|---|
| 개인정보 내보내기 | 4-3. 산출물 다운로드 여부(Storage 접근 로그) |
| 성적 변경 | 4-2의 `grading.regrade` + `grade_decisions` 이력 |
| 권한 부여 | 4-4 |
| 콘텐츠 격리·권한 변경 | 4-2의 `content.quarantine`·`rights.suspend` |
| 루트·평가 게시 | 4-2의 `route.publish`·`assessment.publish` |
| 조직 탈퇴 요청 | 4-2의 `organization.request_close` |

#### 5.2 수행된 변경 되돌리기

| 변경 | 되돌리기 |
|---|---|
| 역할 부여 | `memberships.role_code` 원복 + 감사 |
| 잘못된 재채점 | [RB-12](./12-wrong-autograding-reprocess.md) — 새 `grade_decisions` 버전으로 원복 |
| 문항 격리 | `questions.lifecycle='active'` 복귀 |
| 권한 중지 | `content_rights.status` 원복 |
| 루트 게시 | [RB-02](./02-mass-wrong-schedule.md) — `rollback_token` |
| 조직 탈퇴 요청 | `organizations.status='active'` (30일 유예 내) |
| 내보내기 산출물 | Storage 객체 즉시 삭제 + 서명 URL 폐기 |

#### 5.3 계정 복구

```sql
-- 비밀번호 재설정·MFA 재등록 확인 후
UPDATE memberships
SET status = 'active', updated_at = now(), version = version + 1
WHERE user_id = $1;
```

복구 조건: ① 비밀번호 변경 ② MFA 재등록 ③ 본인 확인 ④ 감사 기록.

#### 5.4 MFA 강제

```sql
-- 4-5 대상에게 강제 등록 플래그 (다음 로그인 시 등록 화면)
UPDATE users SET mfa_enabled = false, updated_at = now()
WHERE id = ANY($1::uuid[]);
```

교직원 6개 역할은 MFA 미설정 시 **쓰기 API 전면 차단**(`403 MFA_REQUIRED`)이 이미 적용되어 있다.

### 5.B 비밀 유출

| # | 조치 | 예상 소요 |
|---|---|---|
| 1 | 유출 대상 특정 (3.2 표) | 5분 |
| 2 | **즉시 폐기** (회전보다 폐기가 먼저) | 5분 |
| 3 | 새 자격 증명 발급 + 비밀 관리 시스템 갱신 | 10분 |
| 4 | 전 배포 갱신·재배포 | 15분 |
| 5 | 유출 기간의 사용 이력 조사 (공급자 콘솔 + 4-1) | 30~120분 |
| 6 | 저장소·로그에서 비밀 제거 (히스토리 포함) | 30분 |
| 7 | 시크릿 스캐너 재실행 | 10분 |

```bash
# 저장소 히스토리에서 비밀 제거 후 강제 푸시 (팀 전체 통지 필수)
# git filter-repo 사용. 제거해도 이미 유출된 것으로 간주하고 반드시 폐기·회전한다.
```

**중요**: 비밀을 저장소에서 지워도 **이미 유출된 것으로 간주**한다. 제거는 재발 방지이지 사고 대응이 아니다.

### 5.C 악성 업로드·프롬프트 인젝션

| # | 조치 | 예상 소요 |
|---|---|---|
| 1 | kill switch ON (3.3) | 2분 |
| 2 | 4-6·4-7·4-8로 대상 특정 | 15분 |
| 3 | 해당 원본·파생 데이터 격리 (5.5) | 10분 |
| 4 | 업로더 계정 검토 (탈취인가 내부자인가) | 30분 |
| 5 | 워커 egress 로그 확인 — 내부망 접근 시도 여부 | 15분 |
| 6 | AI 출력이 실제로 저장·게시됐는지 확인 (5.6) | 30분 |
| 7 | 방어 계층 검증 (6장 V-8~V-11) | 30분 |
| 8 | kill switch 해제 | 5분 |

```sql
-- 5.5 원본과 파생 데이터 격리
UPDATE source_files SET status = 'quarantined',
       quarantine_reason = 'RB-07: 악성 업로드 의심', updated_at = now()
WHERE id = ANY($1::uuid[]);

UPDATE questions q SET lifecycle = 'quarantined',
       quarantine_reason = 'RB-07: 악성 원본에서 추출', quarantined_at = now(), updated_at = now()
FROM source_pages sp
WHERE q.source_page_id = sp.id AND sp.source_file_id = ANY($1::uuid[])
  AND q.lifecycle = 'active';

-- 관련 작업 중단
UPDATE jobs SET status = 'cancelled',
       cancel_requested_by = 'RB-07 incident response', updated_at = now()
WHERE queue = 'ai' AND status IN ('queued','running')
  AND (input ->> 'source_file_id')::uuid = ANY($1::uuid[]);
```

```sql
-- 5.6 AI 출력이 게시까지 갔는가 (방어 실패 여부)
SELECT qv.id, qv.status, qv.publish_gate_status, qv.ai_model_version,
       qv.created_at, q.lifecycle
FROM question_versions qv
JOIN questions q ON q.id = qv.question_id
JOIN source_pages sp ON sp.id = q.source_page_id
WHERE sp.source_file_id = ANY($1::uuid[])
  AND qv.status = 'published';
```

**이 쿼리가 1행이라도 반환하면 검수 게이트가 뚫린 것이다. SEV1로 승격한다.**

---

## 6. 검증

| # | 항목 | 검증 명령·쿼리 | 통과 조건 |
|---|---|---|---|
| V-1 | 대상 계정 세션 폐기 | 해당 토큰으로 API 호출 | 401 |
| V-2 | 권한 변경 원복 | 4-4 | 정상 역할 복귀 |
| V-3 | 내보내기 산출물 폐기 | 서명 URL 접근 시도 | 403/404 |
| V-4 | MFA 강제 | 4-5 | 교직원 미설정 0명 (또는 강제 플래그 적용) |
| V-5 | 새 자격 증명 동작 | 워커·web 헬스체크 | 정상 |
| V-6 | 구 자격 증명 폐기 | 구 키로 API 호출 | 401/403 |
| V-7 | 시크릿 스캐너 | CI 스캔 | 탐지 0건 |
| V-8 | 악성 원본 격리 | 4-6 | 대상 전부 `quarantined` |
| V-9 | **AI 출력이 게시되지 않음** | 5.6 | **0행** |
| V-10 | SVG 정제 | 4-8 | 신규 실패 0건, 기존 실패는 격리됨 |
| V-11 | 워커 egress 차단 | 워커 컨테이너에서 `169.254.169.254` 접근 시도 | 차단 |
| V-12 | 프롬프트 인젝션 픽스처 | `pnpm --filter @su-maek/core test:security` | 통과 |
| V-13 | 감사 로그 무결성 | `psql -f packages/db/src/checks/invariants.sql` (I-15) | 0행 |
| V-14 | kill switch 해제 | `kill-switch list` | 관련 항목 `false` |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 | 법률 검토 |
|---|---|---|
| 개인정보 열람·내보내기가 실행됨 | **필수** | **필수 — 발송 전** |
| 성적이 무단 변경됨 | **필수** (영향 조직) | 필수 |
| 조직 계정 탈취 (해당 조직) | **필수** | 필수 |
| AI 키 유출, 고객 데이터 미영향 | 불필요 (내부 처리) | 검토 권장 |
| 악성 업로드 격리 성공, 영향 없음 | 불필요 | 불필요 |
| 프롬프트 인젝션이 게시까지 도달 | **필수** | 필수 |

### 초기 공지 (계정 탈취)

> **[수맥] 계정 보안 관련 긴급 안내 — {조직명}**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}, 귀 조직의 계정 {일부 마스킹된 이메일}에서 **비정상적인 접근**이 감지되어 즉시 해당 계정을 정지하고 모든 세션을 종료했습니다.
>
> **확인된 사실**
> - 감지 시각: {시각}
> - 비정상 접근 기간: {시작} ~ {종료}
> - 수행된 작업: {구체적으로. 예: "학생 명단 내보내기 1건"} / 또는 "확인된 변경 작업 없음"
>
> **조치 완료**
> - 해당 계정 정지 및 전체 세션 종료
> - {수행된 변경이 있으면: "변경 사항 원복 완료"}
> - {내보내기가 있으면: "생성된 파일 삭제 및 다운로드 링크 폐기"}
>
> **지금 하실 일 (중요)**
> 1. 해당 계정 사용자에게 **다른 서비스에서도 같은 비밀번호를 쓰지 않았는지** 확인해 주세요.
> 2. 조직 내 모든 교직원 계정의 **2단계 인증 설정**을 확인해 주세요. 미설정 계정은 다음 로그인 시 등록을 요청합니다.
> 3. 계정 복구를 원하시면 회신해 주세요. 비밀번호 재설정과 2단계 인증 재등록 후 복구해 드립니다.
>
> 추가 확인 결과를 {시각}까지 안내드리겠습니다.

### 해소 공지

> **[수맥] 계정 보안 사안 — 조치 완료 안내**
>
> | 항목 | 내용 |
> |---|---|
> | 발생 기간 | {시작} ~ {종료} |
> | 영향 계정 | {N}개 |
> | 데이터 열람·유출 | {구체적} / 또는 "확인되지 않음" |
> | 무단 변경 | {구체적} / 또는 "없음" |
> | 원복 완료 | {날짜} |
>
> **재발 방지 조치**
> 1. 교직원 계정 2단계 인증 필수 적용
> 2. 비정상 접근 탐지 기준 강화
> 3. {추가 조치}
>
> 불편과 우려를 드려 죄송합니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| **개인정보 열람·내보내기 실행** | **필수** | 개인정보 침해 신고·통지 의무 판단 |
| 미성년자 데이터 관련 | **필수** | 법정대리인 통지 특례 |
| 성적 무단 변경 | **필수** | 학사 기록 무결성 |
| 프롬프트 인젝션이 게시·저장까지 도달 | **필수** | 콘텐츠 무결성. 저작권 |
| 시크릿 유출이 고객 데이터에 도달 | **필수** | — |
| AI 키 유출, 고객 데이터 미영향 | 검토 권장 | 공급자 계약 |
| 악성 업로드 격리 성공 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (영업일 5일 이내)
- [ ] **어떻게 계정이 탈취됐는가** — 피싱·비밀번호 재사용·세션 탈취·XSS 중 무엇인가
- [ ] MFA가 있었다면 막았는가. 없었다면 왜 미설정이었나
- [ ] 탐지가 5분 이내였는가. 아니면 어떤 신호를 놓쳤나
- [ ] 고위험 명령의 재인증(`X-Reauth-Token`)이 실제로 요구됐는가
- [ ] 감사 로그로 피해 범위를 완전히 재구성할 수 있었는가
- [ ] 비밀 유출이면: 왜 저장소·로그에 들어갔는가. 시크릿 스캐너가 CI에 있었는가
- [ ] 키 회전 절차가 실제로 동작했는가. 회전 중 서비스 중단이 있었나
- [ ] 악성 업로드면: 어느 방어 계층에서 막혔는가 (MIME·크기·악성코드·샌드박스·스키마)
- [ ] 프롬프트 인젝션이면: 스키마 강제·허용 목록·네트워크 차단 중 무엇이 작동했나
- [ ] AI 워커의 내부망·메타데이터 차단이 실제로 적용되어 있었는가
- [ ] SVG 정제 허용 목록이 최신인가
- [ ] 새 공격 패턴을 **보안 테스트 픽스처**로 추가했는가
- [ ] 로그인 속도 제한(10회/15분)이 적절했는가
