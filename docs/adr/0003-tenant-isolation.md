# ADR-0003 — 테넌트 격리 방식

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [threat-model.md](../phase0/threat-model.md) · [erd.md](../phase0/erd.md) · [ADR-0001](./0001-base-repo-and-reuse.md) · [ADR-0015](./0015-data-retention-audit.md) |

---

## 맥락

수맥은 워크스페이스 2,500개, 활성 학생 20만 명의 멀티테넌트 SaaS다. 보호 자산에는 미성년자 개인정보, 시험 전 문항·정답, 학생 성적이 포함된다.

**결정적 사실**: Supabase 구조에서 브라우저는 anon key와 자기 access token으로 **PostgREST에 직접 접속할 수 있다.** 애플리케이션 게이트만으로는 막을 수 없다.

eywa 실사고 1이 정확히 이것이다.

> 앱 게이트만 있고 RLS 역할 게이트가 없으면 사용자가 자기 access token으로 PostgREST에 직접 접속해 우회한다. 실제 계좌번호가 노출됐다.

수맥에서 이에 해당하는 자산은 **시험 전 문항과 정답**이다. 학생이 자기 토큰으로 `assessment_questions`를 직접 조회하면 시험이 무의미해진다.

격리 모델 선택지는 셋이다: 테넌트별 DB / 테넌트별 스키마 / 공유 스키마 + RLS.

## 결정

**공유 스키마 + `organization_id` 컬럼 + RLS 3계층.** 컬럼 이름은 골프롬프트 용어를 따라 `organization_id`로 한다(eywa의 `tenant_id` 아님).

### 1. 계층 1 — 테넌트 격리 (PERMISSIVE)

```sql
-- SECURITY DEFINER 함수: 세션의 조직을 확정. JWT 클레임이 아니라 DB 조회.
CREATE OR REPLACE FUNCTION auth_organization_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.organization_id
  FROM memberships m
  WHERE m.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
    AND m.status = 'active'
  ORDER BY m.created_at
  LIMIT 1;
$$;

-- 전 테넌트 테이블에 DO 루프로 생성
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='organization_id' AND a.attnum>0)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL TO authenticated
       USING (organization_id = auth_organization_id())
       WITH CHECK (organization_id = auth_organization_id())',
      t||'_tenant_isolation', t);
  END LOOP;
END $$;
```

**자식 테이블**(예: `responses`)도 `organization_id`를 **비정규화해 직접 보유**한다. 부모 경유 EXISTS는 인덱스가 없으면 느리고, 파티션 프루닝을 막는다.

### 2. 계층 2 — 역할 게이트 (RESTRICTIVE)

PERMISSIVE 정책 위에 **RESTRICTIVE를 추가**한다. 둘 다 통과해야 통과한다.

```sql
CREATE POLICY assessment_questions_role_gate ON assessment_questions
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  auth_menu_access('assessment.questions') IN ('full','scoped','readonly')
  OR EXISTS (  -- 학생: 자기에게 배정되고 open 상태인 시험만
    SELECT 1 FROM assignments a
    JOIN assessment_instances ai ON ai.id = a.assessment_instance_id
    WHERE a.assessment_instance_id = assessment_questions.assessment_instance_id
      AND a.student_id = auth_student_id()
      AND ai.status = 'open'
  )
);
```

**역할을 SQL에 하드코딩하지 않는다.** `auth_menu_access(p_menu)`가 `organizations.permission_overrides` jsonb → 플랫폼 DEFAULTS jsonb 순으로 해석한다. `owner`는 항상 `full`을 반환한다(락아웃 방지, eywa 실사고 3).

**시험 전 정답 차단**(수맥의 "계좌번호"):

```sql
-- 학생 역할은 정답·루브릭 컬럼을 조회할 수 없다.
-- 컬럼 단위 차단은 뷰 + 권한으로 구현한다.
REVOKE SELECT ON assessment_questions FROM authenticated;
GRANT SELECT ON assessment_questions_student_view TO authenticated;
-- assessment_questions_student_view는 answer_key_snapshot·rubric_snapshot을 제외한다.
-- 교직원 경로는 서버(service_role 아님, authenticated + 역할 게이트)로 전체 테이블 조회.
```

### 3. 계층 3 — Storage 경로 RLS

모든 객체 경로의 **선두 세그먼트가 `organization_id`**다.

```
{organization_id}/sources/{sha256}.pdf
{organization_id}/pages/{source_file_id}/{page_no}.jpg
{organization_id}/questions/{question_version_id}/{asset_id}.svg
{organization_id}/exports/{document_export_id}.pdf
```

```sql
CREATE POLICY storage_tenant_isolation ON storage.objects
FOR ALL TO authenticated
USING ((storage.foldername(name))[1] = auth_organization_id()::text)
WITH CHECK ((storage.foldername(name))[1] = auth_organization_id()::text);
```

경로는 **서버가 조립**한다. 사용자 입력을 경로에 직접 쓰지 않는다(경로 이동 방어).

### 4. 스키마 레벨 강제

| # | 강제 | 구현 |
|---|---|---|
| T-1 | 전 테넌트 테이블에 `organization_id uuid NOT NULL` | 스키마 스냅샷 테스트 (불변 I-01) |
| T-2 | **복합 FK** — 교차 테넌트 참조를 DB가 차단 | 모든 테넌트 테이블에 `UNIQUE (organization_id, id)`. FK는 `(organization_id, x_id) REFERENCES t(organization_id, id)` |
| T-3 | 논리적 고유 제약에 `organization_id` 포함 | 예: `UNIQUE (organization_id, learning_group_id, student_id, kind, scheduled_on)` |
| T-4 | 인덱스 선두 컬럼이 `organization_id` | 격리 + 성능 동시 확보 |

복합 FK가 핵심이다. `responses.attempt_id`가 다른 조직의 `attempts`를 가리키는 것을 **애플리케이션 버그로도 만들 수 없다.**

### 5. 파생 계층에도 같은 경계

골프롬프트 27장이 요구하는 전 경로:

| 경로 | 격리 |
|---|---|
| 읽기 모델 (`read_model_*`) | `organization_id` 컬럼 + RLS 적용 |
| 검색 인덱스 | 같은 테이블(PostgreSQL GIN)이므로 RLS 자동 적용 |
| 캐시 키 | 키 프리픽스에 `organization_id` |
| 큐 메시지 (`jobs`, `outbox_events`) | `organization_id` 컬럼 + 핸들러가 조직 컨텍스트로 실행 |
| 분석·리포트 | `reports.organization_id` + RLS |
| 내보내기 | 조직 범위 쿼리 + 서명 URL 권한 재검사 |
| 관리자 검색 | break-glass 경로에서도 조직 경계 유지 |
| **DLQ 재처리** | 원 작업의 `organization_id`로 실행. 관리자 세션 조직이 아님 |

### 6. 조직별 한도

| 자원 | 한도 |
|---|---|
| API 쓰기 | 3,000 req/분/조직 |
| AI 비용 | 1일 USD 20 (기본), 콘텐츠 플랜 상향 가능 |
| Storage | 플랜별 (`organizations.quota.storage_bytes`) |
| 워커 동시 실행 | 큐별 (`realtime` 20, `schedule` 4, `render` 8, `ai` 3, `default` 6) |
| 큐 배치 점유율 | 단일 조직 ≤ 40% (공정 스케줄러) |

### 7. 검증 하네스 (필수)

```ts
// tests/integration/rls-isolation.test.ts
await sql.begin(async (tx) => {
  await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userA })}, true)`;
  await tx`SET LOCAL ROLE authenticated`;   // ← 이 줄이 없으면 false-green
  const rows = await tx`SELECT count(*) FROM responses WHERE organization_id = ${orgB}`;
  expect(Number(rows[0].count)).toBe(0);
});
```

**`SET LOCAL ROLE authenticated`가 없으면 `DATABASE_URL`이 소유자 역할이라 RLS가 우회되고 테스트가 항상 통과한다.** eywa에서 확인된 함정이다.

테스트 범위: **전 역할(7종) × 전 테넌트 테이블 × (SELECT·INSERT·UPDATE·DELETE)**. 새 테이블 추가 시 자동으로 목록에 포함되도록 카탈로그 쿼리로 생성한다.

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. 테넌트별 데이터베이스** | 물리적 격리. 유출 위험 최소. 조직 단위 복구·삭제가 깔끔 | ① 2,500개 DB의 마이그레이션 운영이 불가능에 가깝다 ② Supabase는 프로젝트 단위 과금 — 비용 폭증 ③ 커넥션 풀이 조직 수만큼 필요 ④ 플랫폼 공용 데이터(교육과정 릴리스)를 복제해야 함 ⑤ 조직 간 집계(플랫폼 지표)가 어렵다 |
| **B. 테넌트별 스키마** | 논리적 격리. 마이그레이션이 DB별보다 쉬움 | ① 2,500 스키마 × 100 테이블 = 25만 객체. PostgreSQL 카탈로그 성능 저하 ② `search_path` 설정 실수가 곧 유출 ③ 커넥션 재사용 시 `search_path` 오염 위험 ④ 마이그레이션이 여전히 2,500회 |
| **C. 공유 스키마 + 애플리케이션 필터만** | 가장 단순 | **eywa 실사고 1이 정확히 이 실패다.** PostgREST 직결로 우회 가능. 채택 불가 |
| **D. 공유 스키마 + RLS 1계층(테넌트만)** | 구현 단순 | 같은 조직 안에서 학생이 정답을 조회할 수 있다. 시험 전 문항 유출(P-2) 방어 불가 |
| **E. RLS 없이 뷰만으로 격리** | 뷰 정의가 명시적 | 뷰를 우회한 직접 테이블 접근을 막지 못한다. `GRANT` 관리가 테이블 수만큼 복잡 |
| **F. `organization_id` 대신 `tenant_id`** | eywa 코드 재사용 용이 | 골프롬프트가 `organization_id`를 쓴다. 문서·코드·DB 용어를 하나로 유지하는 것이 장기적으로 더 싸다 |

## 비용

| 항목 | 비용 |
|---|---|
| 쿼리 오버헤드 | RLS 정책 평가 — `auth_organization_id()`는 `STABLE`이라 쿼리당 1회. 인덱스 선두가 `organization_id`이므로 프루닝 효과가 오버헤드를 상쇄 |
| 복합 FK | 모든 테넌트 테이블에 `UNIQUE (organization_id, id)` 인덱스 추가 → 테이블당 약 30 bytes/행. 전체 약 +8% 저장 |
| 개발 | 모든 쿼리에 `organization_id` 의식. 신규 테이블마다 정책 생성(DO 루프가 자동화) |
| 테스트 | 전 역할 × 전 테이블 RLS 테스트 실행 시간 (약 90초) |
| 운영 | 조직 삭제가 논리 DELETE. 물리 격리보다 검증이 필요 |
| **얻는 것** | 마이그레이션 1회, 커넥션 풀 1개, 플랫폼 공용 데이터 공유, 조직 간 집계 가능 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | 새 테이블에 RLS 정책을 안 붙임 | 불변 I-01 검증 쿼리 위반 | DO 루프가 자동 생성 + 일 배치 검증 + 스키마 스냅샷 테스트 |
| F-2 | **RLS 테스트가 false-green** (`SET LOCAL ROLE` 누락) | 없음 — 이것이 위험한 이유 | 하네스 자체를 테스트한다: 일부러 격리를 깬 픽스처로 테스트가 **실패하는지** 확인 |
| F-3 | `service_role` 클라이언트를 무심코 사용해 RLS 우회 | `"server-only"` import 위반 | admin 클라이언트는 `"server-only"` + 사용처를 화이트리스트로 제한 + 코드 리뷰 |
| F-4 | 역할 게이트 TS 미러와 SQL 정책이 드리프트 | 권한 매트릭스 테스트 불일치 | SQL 파싱 테스트로 정책 내용과 TS 상수 대조 |
| F-5 | 읽기 모델·캐시에 조직 경계 누락 | 교차 테넌트 자동 테스트 실패 | 파생 계층도 테스트 범위에 포함 |
| F-6 | 다중 조직 소속 사용자의 조직 선택 오류 | `auth_organization_id()`가 `LIMIT 1`로 첫 조직 반환 | **워크스페이스 전환 시 세션에 활성 조직을 명시 저장**하고 함수가 그 값을 우선 사용. 미설정 시 첫 조직 |
| F-7 | 성능 저하로 RLS를 끄고 싶은 유혹 | 쿼리 p95 상승 | RLS를 끄지 않는다. 인덱스·파티션으로 해결. 이 ADR 갱신 없이 정책 삭제 금지 |
| F-8 | 조직 삭제 후 잔여 데이터 | 파기 검증 쿼리 위반 | `scripts/purge-organization.mjs`가 역순 의존 삭제 + 0건 검증 |

### F-6 상세 — 다중 조직 사용자

`auth_organization_id()`의 `LIMIT 1`은 정확하지 않다. 확정 구현:

```sql
CREATE OR REPLACE FUNCTION auth_organization_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_user uuid;
BEGIN
  v_user := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
  -- 1) 세션이 명시한 활성 조직 (앱이 set_config로 설정)
  BEGIN v_org := current_setting('app.active_organization_id', true)::uuid; EXCEPTION WHEN OTHERS THEN v_org := NULL; END;
  -- 2) 명시 값이 실제 활성 멤버십인지 검증. 아니면 거부(NULL)
  IF v_org IS NOT NULL THEN
    PERFORM 1 FROM memberships WHERE user_id=v_user AND organization_id=v_org AND status='active';
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN v_org;
  END IF;
  -- 3) 미설정이면 단일 소속일 때만 자동 결정
  SELECT organization_id INTO v_org FROM memberships
  WHERE user_id=v_user AND status='active' LIMIT 2;
  IF (SELECT count(*) FROM memberships WHERE user_id=v_user AND status='active') = 1 THEN
    RETURN v_org;
  END IF;
  RETURN NULL;  -- 다중 소속인데 미선택 → 아무것도 못 본다 (안전 방향)
END $$;
```

**클라이언트가 보낸 조직 ID를 그대로 믿지 않는다.** 2)에서 멤버십을 재검증한다.

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| RLS 정책 개별 수정 | 마이그레이션 `NNNNa_*.sql` (멱등) | 낮음 |
| 역할 게이트 완화·강화 | `permission_overrides` jsonb 조정 — **배포 없이 가능** | 매우 낮음 |
| RLS → 애플리케이션 필터만 | **되돌리지 않는다.** 보안 후퇴 | — |
| 공유 스키마 → 테넌트별 DB | 조직별 논리 덤프 → 개별 프로젝트 복원. 데이터는 이미 `organization_id`로 분할 가능 | 높음 (조직당 1시간, 전체 수개월) |
| 특정 대형 조직만 전용 DB로 분리 | 위와 동일하되 1개 조직만. **S-4 조건(별도 데이터 지역·보안 요구) 충족 시 현실적 경로** | 중간 |

가장 큰 조직이 전용 DB를 요구하는 시나리오(Q-15)는 열려 있다. `organization_id` 기반 설계가 그 경로를 막지 않는다.
