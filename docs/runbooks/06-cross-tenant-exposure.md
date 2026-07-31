# RB-06 교차 테넌트 노출 의심

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** (예외 없음) |
| 1차 담당 | 운영 엔지니어(OE) + 보안 담당 |
| 에스컬레이션 | **즉시 IC + 경영진.** 15분 내 법률 검토 착수 / 30분 내 초기 판단 |
| 관련 SLO | 불변 I-01(테넌트 격리) · 교차 테넌트 노출 0건 |
| 관련 kill switch | **없음 — 증거 보존이 최우선이다** |
| 관련 문서 | [../phase0/threat-model.md](../phase0/threat-model.md) 3.4·4.1 · [../adr/0003-tenant-isolation.md](../adr/0003-tenant-isolation.md) |

---

## 0. 가장 먼저 읽을 것

> **이 런북에서는 확산 차단보다 증거 보존이 우선이다.**
>
> 하지 않는 것: 로그 정리, 임시 데이터 삭제, 테이블 `TRUNCATE`, 읽기 모델 재생성, DB 재시작, 세션 일괄 폐기(대상 특정 전).
>
> 이 조치들은 **누가 무엇을 봤는지**를 지운다. 통지 의무와 법적 대응의 근거가 사라진다.
>
> 예외: 노출이 **현재 진행 중**인 것이 확실하면 해당 조직·계정만 정지한다(5.2).

---

## 1. 탐지 조건

| 알림 | 메트릭·조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `cross_tenant_suspicion` | 불변 I-01 검증 쿼리 위반 | > 0 | 일 배치 | **SEV1** |
| `rls_policy_violation` | RLS 정책 위반 예외(`42501`) 발생 | > 0 | 실시간 | **SEV1** |
| `rls_policy_missing` | `organization_id` 있는 테이블 중 RLS 미적용 | > 0 | 일 배치 | **SEV1** |
| `cursor_org_mismatch` | `INVALID_CURSOR`(조직 불일치) 응답 | > 10건 | 30분 | SEV2 |
| `storage_path_violation` | Storage 경로 선두 세그먼트 불일치 접근 시도 | > 0 | 실시간 | **SEV1** |
| `exam_answer_key_access` | 학생 역할의 `answer_key_snapshot` 조회 성공 | > 0 | 실시간 | **SEV1** |
| `admin_search_scope_breach` | break-glass 없이 타 조직 데이터 조회 | > 0 | 실시간 | **SEV1** |
| 보안 테스트 실패 | CI의 교차 테넌트 테스트 | 실패 | 배포마다 | **SEV1** (배포 차단) |
| 사용자 신고 | "다른 학원 데이터가 보인다" | 1건 | 즉시 | **SEV1** |

---

## 2. 심각도 판정

**모든 교차 테넌트 노출 의심은 SEV1이다.** 아래는 대응 강도와 통지 범위를 나누는 기준이다.

| 조건 | 등급 | 통지 |
|---|---|---|
| 학생 개인정보가 타 조직에 노출된 정황 | SEV1-A | **법률 검토 + 개인정보 침해 신고 검토 + 전체 통지** |
| 시험 전 문항·정답이 학생에게 노출 | SEV1-A | 영향 조직 즉시 통지 + 시험 무효화 판단 |
| 성적·답안이 타 조직에 노출 | SEV1-A | 법률 검토 + 영향 조직 통지 |
| 콘텐츠(문항 본문)만 타 조직에 노출 | SEV1-B | 영향 조직 통지 + 저작권 검토 |
| 메타데이터(조직명·반명)만 노출 | SEV1-B | 영향 조직 통지 |
| 취약점 발견, 실제 노출 증거 없음 | SEV1-C | 내부 수정 + 사후 분석. 통지는 법률 판단 |
| CI 보안 테스트 실패 (배포 전 차단) | SEV2 | 통지 불필요 |

---

## 3. 즉시 중지할 기능

### 3.1 원칙

kill switch를 켜지 않는다. **끄면 로그가 남지 않고 증거가 사라진다.**

### 3.2 노출이 진행 중인 경우에만

대상이 **특정된** 경우에만 국소 차단한다.

```sql
-- 특정 사용자 세션 폐기 (Supabase Auth 관리 API 병행)
UPDATE memberships
SET status = 'suspended', updated_at = now(), version = version + 1
WHERE user_id = $1;

-- 특정 조직 일시 정지 (최후 수단 — 해당 조직의 정상 사용도 막힌다)
UPDATE organizations
SET status = 'suspended', updated_at = now()
WHERE id = $1;
```

**반드시 유지되어야 하는 것**:

- `audit_events` 전체 (절대 손대지 않는다)
- 애플리케이션 접근 로그 (보존 기간 즉시 연장)
- 웹 서버·프록시 접근 로그
- `inbox_messages`·`outbox_events` (이벤트 흐름 증거)
- Storage 접근 로그

### 3.3 증거 보존 조치 (즉시)

```bash
# 1. 로그 보존 기간 즉시 연장 (기본 30일 → 1년)
# 로그 백엔드 콘솔에서 해당 기간 아카이브 잠금

# 2. 감사 로그 스냅샷 (읽기 전용 사본)
pg_dump "$DATABASE_URL" -Fc -t audit_events \
  --where="occurred_at > now() - interval '30 days'" \
  -f /secure/evidence/audit_events_$(date +%Y%m%dT%H%M%SZ).dump

# 3. 체크섬 기록
sha256sum /secure/evidence/*.dump >> /secure/evidence/CHECKSUMS
```

증거 파일은 **운영 계정과 분리된 저장소**에 둔다.

---

## 4. 진단

### 4-1. 불변 I-01 — RLS 미적용 테이블

```sql
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0)
  AND NOT c.relrowsecurity;
```

```sql
-- 테넌트 격리 정책이 없는 테이블
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0)
  AND NOT EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = c.relname || '_tenant_isolation');
```

### 4-2. 역할 게이트(RESTRICTIVE) 누락

```sql
SELECT c.relname,
       count(*) FILTER (WHERE p.polpermissive)      AS permissive_policies,
       count(*) FILTER (WHERE NOT p.polpermissive)  AS restrictive_policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND c.relname IN ('assessment_questions','students','responses','grade_decisions',
                    'mastery_evidences','audit_events','content_rights')
GROUP BY 1
HAVING count(*) FILTER (WHERE NOT p.polpermissive) = 0;
```

**민감 테이블에 RESTRICTIVE 정책이 없으면 eywa 실사고 1의 재현이다.**

### 4-3. 복합 FK로 교차 테넌트 참조 검출

```sql
-- responses ↔ attempts 조직 불일치
SELECT r.id AS response_id, r.organization_id AS resp_org,
       a.organization_id AS attempt_org, r.attempt_id
FROM responses r JOIN attempts a ON a.id = r.attempt_id
WHERE r.organization_id <> a.organization_id LIMIT 50;

-- attempts ↔ assessment_instances
SELECT a.id, a.organization_id, ai.organization_id, a.assessment_instance_id
FROM attempts a JOIN assessment_instances ai ON ai.id = a.assessment_instance_id
WHERE a.organization_id <> ai.organization_id LIMIT 50;

-- sessions ↔ learning_groups
SELECT s.id, s.organization_id, lg.organization_id
FROM sessions s JOIN learning_groups lg ON lg.id = s.learning_group_id
WHERE s.organization_id <> lg.organization_id LIMIT 50;

-- assessment_questions ↔ question_versions
SELECT aq.id, aq.organization_id, qv.organization_id
FROM assessment_questions aq JOIN question_versions qv ON qv.id = aq.question_version_id
WHERE aq.organization_id <> qv.organization_id LIMIT 50;
```

### 4-4. 다중 조직 소속 사용자 (오판 위험 구간)

```sql
SELECT m.user_id, u.email, count(*) AS org_count,
       array_agg(m.organization_id) AS orgs,
       array_agg(m.role_code)       AS roles
FROM memberships m JOIN users u ON u.id = m.user_id
WHERE m.status = 'active'
GROUP BY 1,2 HAVING count(*) > 1
ORDER BY 3 DESC LIMIT 50;
```

`auth_organization_id()`가 다중 소속에서 잘못된 조직을 반환하면 노출이 발생한다.

### 4-5. 접근 이력 (누가 무엇을 봤는가)

```sql
-- 특정 사용자가 자기 조직 밖 대상에 접근한 감사 기록
SELECT ae.occurred_at, ae.organization_id, ae.actor_user_id, ae.actor_kind,
       ae.action, ae.target_type, ae.target_id, ae.permission_basis
FROM audit_events ae
WHERE ae.actor_user_id = $1
  AND ae.organization_id <> $2   -- 사용자의 정상 조직
  AND ae.occurred_at > now() - interval '30 days'
ORDER BY ae.occurred_at DESC LIMIT 200;

-- break-glass 없이 운영자 접근이 있었는가
SELECT ae.*
FROM audit_events ae
WHERE ae.actor_kind = 'operator'
  AND ae.occurred_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM break_glass_grants bg
    WHERE bg.operator_user_id = ae.actor_user_id
      AND bg.organization_id = ae.organization_id
      AND ae.occurred_at BETWEEN bg.created_at AND bg.expires_at
      AND bg.revoked_at IS NULL)
ORDER BY ae.occurred_at DESC LIMIT 100;
```

### 4-6. 시험 전 정답 노출 확인

```sql
-- 학생 역할 사용자가 미개시 시험의 정답에 접근한 흔적
SELECT ae.occurred_at, ae.actor_user_id, ae.target_id, ae.action
FROM audit_events ae
JOIN memberships m ON m.user_id = ae.actor_user_id AND m.role_code = 'student'
WHERE ae.action LIKE 'assessment.%'
  AND ae.occurred_at > now() - interval '30 days'
ORDER BY ae.occurred_at DESC LIMIT 100;
```

```sql
-- 학생 전용 뷰가 정답 컬럼을 노출하는지 정의 확인
SELECT pg_get_viewdef('assessment_questions_student_view'::regclass, true);
```

### 4-7. Storage 경로 정책

```sql
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy WHERE polrelid = 'storage.objects'::regclass;
```

### 4-8. RLS 하네스 재실행 (가장 확실한 검증)

```bash
pnpm --filter @su-maek/db test:rls
```

이 테스트가 통과하는데 노출이 발생했다면 **테스트가 false-green**이다. `SET LOCAL ROLE authenticated`가 있는지 코드로 확인한다.

---

## 5. 복구 절차

| # | 조치 | 상세 | 예상 소요 |
|---|---|---|---|
| 1 | **증거 보존** (3.3) — 다른 무엇보다 먼저 | 3.3 | 10분 |
| 2 | IC + 경영진 + 법률 검토 착수 통지 | — | 5분 |
| 3 | 노출 경로 특정 (5.1) | 4장 | 15~60분 |
| 4 | 진행 중이면 국소 차단 (3.2) | — | 5분 |
| 5 | 취약점 수정 배포 | 5.3 | 30~120분 |
| 6 | 영향 범위 확정 (5.4) | — | 30~120분 |
| 7 | 검증 (6장) | — | 30분 |
| 8 | 통지 (7장) — 법률 검토 후 | — | 법률 판단 |

### 5.1 노출 경로 특정

| 진단 결과 | 경로 | 확인 방법 |
|---|---|---|
| 4-1에서 RLS 미적용 테이블 | **DB 정책 누락** | 마이그레이션 이력에서 DO 루프 실행 여부 |
| 4-2에서 RESTRICTIVE 없음 | **역할 게이트 누락** (eywa 실사고 1) | PostgREST 직결 재현 테스트 |
| 4-3에서 조직 불일치 행 | **애플리케이션 버그** — 복합 FK 미적용 | 해당 테이블 FK 정의 확인 |
| 4-4에서 다중 소속 + 4-5 접근 | **`auth_organization_id()` 오판** | 활성 조직 세션 설정 로직 확인 |
| 4-6에서 학생의 정답 접근 | **학생 뷰 정의 오류** | 뷰 정의 검토 |
| 4-7에서 Storage 정책 부재 | **Storage 경로 정책 누락** | 마이그레이션 확인 |
| 캐시·읽기 모델에서 노출 | **파생 계층 격리 누락** | `read_model_*` RLS 확인 |
| API 커서 조작 | **커서 서명 검증 누락** | HMAC 검증 코드 확인 |
| break-glass 없는 운영자 접근 | **운영자 통제 실패** | 4-5 두 번째 쿼리 |

### 5.2 PostgREST 직결 재현 (경로 확인용)

```bash
# 조직 A 사용자의 access token으로 조직 B 데이터를 조회 시도
curl -s "$SUPABASE_URL/rest/v1/students?select=id,display_name&limit=5" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $USER_A_ACCESS_TOKEN"
```

조직 A의 데이터만 나와야 정상. 조직 B 데이터가 나오면 **RLS가 뚫린 것이다.**

### 5.3 취약점 수정

| 경로 | 수정 |
|---|---|
| RLS 정책 누락 | `NNNNa_*.sql` 마이그레이션 재실행 (멱등). DO 루프가 전 테이블 커버 |
| RESTRICTIVE 누락 | 해당 테이블에 역할 게이트 정책 추가 |
| 복합 FK 누락 | `UNIQUE (organization_id, id)` + 복합 FK 추가 마이그레이션 |
| `auth_organization_id()` 오판 | 활성 조직 명시 + 멤버십 재검증 로직 배포 ([ADR-0003](../adr/0003-tenant-isolation.md) F-6) |
| 학생 뷰 정의 | 뷰 재생성 + `REVOKE SELECT ON assessment_questions FROM authenticated` |
| 커서 서명 | HMAC 검증 + `o`(조직) 필드 검사 배포 |
| 읽기 모델 격리 | `read_model_*`에 RLS 적용 |

```sql
-- RLS 일괄 재적용 (마이그레이션 재실행과 동일)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='organization_id' AND a.attnum>0)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL TO authenticated
       USING (organization_id = auth_organization_id())
       WITH CHECK (organization_id = auth_organization_id())',
      t||'_tenant_isolation', t);
  END LOOP;
END $$;
```

### 5.4 영향 범위 확정

| 질문 | 답을 얻는 방법 |
|---|---|
| **누가** 접근했는가 | 4-5 감사 로그 + 애플리케이션 접근 로그 |
| **무엇을** 봤는가 | 접근 로그의 경로·응답 크기·쿼리 파라미터 |
| **얼마나** 봤는가 | 응답 행 수(로그에 기록된 경우) 또는 API 호출 수로 추정 |
| **언제부터** 가능했는가 | 취약점을 도입한 배포·마이그레이션 시점 |
| **다운로드**됐는가 | Storage 접근 로그, 내보내기 감사 기록 |
| **영향 조직·학생** | 노출 데이터의 `organization_id`·`student_id` 집합 |

**추정과 확정을 구분해 기록한다.** 통지 문안에서 "확인된 것"과 "가능성이 있는 것"을 나눠 쓴다.

---

## 6. 검증

| # | 항목 | 검증 명령·쿼리 | 통과 조건 |
|---|---|---|---|
| V-1 | RLS 전 테이블 적용 | 4-1 두 쿼리 | **0행** |
| V-2 | 민감 테이블 RESTRICTIVE | 4-2 | **0행** |
| V-3 | 교차 테넌트 참조 | 4-3 전 쿼리 | **0행** |
| V-4 | RLS 하네스 | `pnpm --filter @su-maek/db test:rls` | 통과 |
| V-5 | **하네스 자체 검증** | 일부러 격리를 깬 픽스처로 실행 | **실패해야 한다** (통과하면 false-green) |
| V-6 | PostgREST 직결 재현 | 5.2 | 자기 조직 데이터만 반환 |
| V-7 | 학생 정답 차단 | 학생 토큰으로 `answer_key_snapshot` 조회 | 0행 또는 컬럼 없음 |
| V-8 | Storage 경로 정책 | 4-7 + 타 조직 경로 접근 시도 | 거부 |
| V-9 | 커서 조작 | 조작된 커서로 요청 | `400 INVALID_CURSOR` |
| V-10 | 파생 계층 | 읽기 모델·검색·캐시·내보내기·큐 교차 테넌트 테스트 | 전부 통과 |
| V-11 | break-glass 무단 접근 | 4-5 두 번째 쿼리 | **0행** |
| V-12 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-13 | 증거 보존 | 증거 파일 체크섬 확인 | 일치 |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 | 법률 검토 |
|---|---|---|
| 개인정보 노출 확인 | **필수** (법정 기한 내) | **필수 — 발송 전** |
| 성적·답안 노출 확인 | **필수** | **필수 — 발송 전** |
| 시험 전 문항·정답 노출 | **필수** (영향 조직 즉시) | 필수 |
| 콘텐츠·메타데이터만 노출 | **필수** (영향 조직) | 필수 |
| 취약점만 발견, 노출 증거 없음 | 법률 판단에 따름 | **필수** |

**모든 공지는 법률 검토 후 발송한다.** 이 런북의 템플릿은 초안이다.

### 초기 공지 (법률 검토 후)

> **[수맥] 데이터 접근 권한 관련 보안 사안 안내 — 중요**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}, 일부 데이터에 대한 접근 권한 설정에 문제가 있었음을 확인하고 즉시 조치했습니다.
>
> **확인된 사실**
> - 발생 기간: {시작} ~ {종료}
> - 영향받은 데이터 종류: {구체적으로. 예: "학생 표시명과 소속 반 정보"}
> - 접근 가능했던 범위: {구체적으로}
> - **실제 접근이 확인된 건**: {N}건 / 또는 "현재까지 실제 접근 기록은 확인되지 않았습니다"
>
> **조치 완료**
> - 권한 설정을 수정하고 전체 데이터 접근 경로를 재검증했습니다.
> - 관련 접근 기록을 보존하고 정밀 분석 중입니다.
>
> **귀 조직 영향**
> {영향 있음: "귀 조직의 {데이터 종류}가 포함되어 있습니다. 상세 내역을 첨부합니다."}
> {영향 없음: "현재까지 확인된 범위에서 귀 조직 데이터는 포함되지 않았습니다."}
>
> **문의**
> 이 사안에 대한 질문은 {연락처}로 회신해 주세요. 우선 응대해 드리겠습니다.
>
> 상세 분석 결과를 {기한}까지 안내드리겠습니다.

### 최종 공지

> **[수맥] 데이터 접근 권한 사안 — 최종 분석 결과**
>
> | 항목 | 내용 |
> |---|---|
> | 발생 기간 | {시작} ~ {종료} |
> | 원인 | {기술적 원인. 은폐하지 않는다} |
> | 실제 노출 확인 | {건수·범위} |
> | 귀 조직 영향 | {구체적} |
> | 조치 완료일 | {날짜} |
>
> **재발 방지 조치**
> 1. {구체적 기술 조치}
> 2. {검증 체계 강화}
> 3. {배포 전 검사 추가}
>
> **관계 기관 신고**: {수행 여부와 결과}
>
> 신뢰를 저해하는 일이 발생한 점 깊이 사과드립니다.

---

## 8. 법률·규제 검토

**이 런북은 항상 법률 검토를 요구한다.** 검토 착수는 SEV1 선언 후 15분 이내.

| 검토 항목 | 내용 |
|---|---|
| 개인정보 침해 신고 의무 | 개인정보보호법상 신고 대상·기한 판단 |
| 정보주체 통지 의무 | 통지 대상·방법·기한 |
| 미성년자 데이터 특례 | 법정대리인 통지 필요 여부 |
| 계약상 통지 의무 | 조직과의 계약 조항 |
| 통지 문안 | **발송 전 반드시 검토** |
| 증거 보존 범위·기간 | 소송 대비 |
| 저작권 (콘텐츠 노출 시) | 출판사 통지 필요 여부 |
| 대외 커뮤니케이션 | 언론·소셜 대응 방침 |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (영업일 5일 이내, 비난 없이)
- [ ] **취약점이 언제 도입됐는가.** 배포·마이그레이션 이력으로 특정
- [ ] **왜 배포 전에 못 잡았는가.** CI 보안 테스트가 이 경로를 덮었는가
- [ ] RLS 하네스가 false-green이었다면 **하네스 자체 검증**(V-5)을 CI에 추가했는가
- [ ] 전 역할 × 전 테이블 권한 매트릭스 테스트에 이 경로가 포함됐는가
- [ ] 파생 계층(읽기 모델·캐시·검색·큐·내보내기)이 테스트 범위에 있었는가
- [ ] 신규 테이블 추가 시 RLS 정책이 자동 생성되는가. DO 루프가 커버하는가
- [ ] 복합 FK가 전 테넌트 테이블에 적용됐는가
- [ ] `auth_organization_id()`의 다중 소속 처리가 안전한가
- [ ] 감사 로그로 "누가 무엇을 봤는지"를 실제로 재구성할 수 있었는가. 부족했다면 감사 항목을 보강
- [ ] 접근 로그 보존 기간이 조사에 충분했는가
- [ ] break-glass 통제가 작동했는가
- [ ] 증거 보존 절차(3.3)가 실제로 실행 가능했는가
- [ ] 오류 예산과 무관하게 **다음 스프린트를 보안 강화에 배정**했는가
