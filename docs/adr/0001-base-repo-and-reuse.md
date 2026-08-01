# ADR-0001 — 기준 저장소와 재사용 전략

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 결정자 | 수맥 팀 |
| 관련 | [decisions.md](../phase0/decisions.md) · [survey/eywa-allinone.md](../phase0/survey/eywa-allinone.md) · [ADR-0003](./0003-tenant-isolation.md) |

---

## 맥락

수맥이 참고할 수 있는 기존 프로젝트가 10개 있다(골프롬프트 3장). 이 중 `D:\eywa_refactoring`은 커밋 1,742개의 **실운영 중인** Next.js 16 + Supabase 멀티테넌트 SaaS이고, 나머지는 프로토타입·부분 구현·단일 커밋 스캐폴드다.

선택지는 셋이다.

1. eywa를 포크해 도메인만 갈아끼운다.
2. 새 저장소를 만들고 **검증된 패턴만 이식**한다.
3. 전부 새로 만든다.

골프롬프트 원칙 10은 "한 프로젝트에 모든 기존 코드를 무작정 합치지 않는다. 하나의 표준 도메인 모델과 계약을 만든 뒤 필요한 기능만 어댑터 또는 모듈로 재사용한다"고 못박는다. 동시에 eywa에는 **실운영에서 사고를 겪고 고친** 인증·RLS·권한 패턴이 있다. 이것을 버리고 다시 만들면 같은 사고를 다시 겪는다(eywa 실사고 5건).

기존 프로젝트의 문제도 확인됐다.

- 목차 데이터는 폭넓지만 교육과정 버전·공식 성취기준 코드·안정 ID가 일관되지 않다.
- 숙련 임계값 60/70/80/90%가 서로 다른 위치에 혼재한다.
- `edutrix`는 847개 소단원을 같은 크기의 한 칸으로 계산한다.
- `mathg-gen`의 `topic`은 이름 기반 문자열이다.
- eywa·allinone에는 수맥 경계 밖 도메인(출결·수납·상담·급여)이 섞여 있다.

## 결정

**새 저장소 `D:\Su-Maek`를 기준으로 하고, eywa에서는 코드가 아니라 검증된 패턴을 이식한다.**

### 1. 저장소 구조 (확정)

pnpm workspace 모노레포:

```
apps/web        Next.js 16 App Router — 사용자 요청
apps/worker     tsx 상시 프로세스 — 비동기 작업
packages/core   순수 도메인 (I/O 없음, 결정론)
packages/db     Drizzle 스키마(타입 소스) + postgres.js 런타임 + 마이그레이션 러너
packages/contracts  zod 4 — API·이벤트·작업 스키마 단일 정의
e2e             Playwright
scripts         boundary-check · verify-recovery · dr-drill 등
```

### 2. 재사용 판정 (프로젝트별 확정)

| 프로젝트 | 판정 | 구체 |
|---|---|---|
| `eywa_refactoring` | **패턴 이식** | 아래 3절 |
| `ijw-calander` | 구조 참고 재구현 | 연간·월·주·일 뷰, 반복 일정, 휴일, 충돌 처리 UX. 데이터 모델은 수맥 도메인으로 재설계 |
| `edutrix` | 구조 참고 재구현 | 진도 컨테이너·진도 이벤트 이력·수업일 기반 속도. **847개 소단원 단일 순번과 버전 혼합은 채택하지 않는다** |
| `math_test` | 구조 참고 재구현 | 선수 관계·오개념·표상·교수전략. **문자열 ID 체계는 canonical concept + `source_aliases`로 교체.** 임계값은 `mastery_policy_versions`로 통합 |
| `mathlab` | 아이디어 참고 | 교육과정·문항 필드, 문제은행, 시험·숙제·분석. **스키마와 시드 코드의 드리프트를 먼저 감사**한 뒤 필드 아이디어만 |
| `mathg-gen` | **노하우 이식** | 아래 4절 |
| `mathgen-ai-(2022-revised)` | 초벌 별칭만 | 이름 기반 목차. **공식 코드·출처·버전이 없으므로 기준 데이터로 사용 금지.** `source_aliases`의 후보로만 |
| `시험지 한글화` | **어댑터 이식** | LaTeX→HWP 수식 변환, 글꼴 메트릭, 폭·높이·기준선, 표·선택지 레이아웃, HWPX 골든 회귀. **원본 시험지·학생 데이터는 가져오지 않는다** |
| `allinone-academy` | **폐기** | 단일 커밋 스캐폴드. `student_teachers`/`student_parents` 관계 스코프 아이디어만 참고(단 DB 강제 필수) |
| `06_웹개발_코드` | 아이디어 참고 | 문항·단원·유형·배점·난이도 분석 프로토타입. 출결 포털은 비범위 |

### 3. eywa에서 이식하는 패턴 (11개)

**그대로 이식**:

| # | 패턴 | 출처 | 수맥 적용 |
|---|---|---|---|
| 1 | `proxy.ts` 세션 갱신 | `src/lib/supabase/proxy.ts:29-112` | 동일. matcher는 api·`_next`·robots·폰트 제외 |
| 2 | **인증 게이트 = 쿠키 존재만** | 실사고 2 | 동일. 검증은 `(shell)/layout.tsx` |
| 3 | Supabase 클라이언트 4종 | server/browser/proxy/admin | 동일. admin은 `"server-only"` + service_role |
| 4 | `getCurrentUser()` — **조직·역할은 JWT가 아니라 DB 조회** | `src/lib/auth/current-user.ts:25-62` | `tenant_id` → `organization_id` 개명 |
| 5 | `auth_tenant_id()` SECURITY DEFINER + DO 루프 전 테이블 정책 | `0001a_rls_constraints_triggers.sql` | `auth_organization_id()`로 개명 |
| 6 | RESTRICTIVE 역할 게이트 | `0158a:34-56` | 역할을 SQL에 하드코딩하지 않고 `organizations.permission_overrides` jsonb → DEFAULTS 순 해석 |
| 7 | Storage RLS 경로 선두 세그먼트 | `0007a:6-12` | `{organization_id}/...` |
| 8 | **RLS 회귀 테스트 하네스** | `tests/integration/rls-isolation.test.ts:52-66` | `set local role authenticated` 필수. 안 하면 false-green |
| 9 | 마이그레이션 2갈래 규약 | — | `NNNN_*.sql`(생성) + `NNNNa_*.sql`(수기 RLS·트리거), `drizzle-kit push` 금지. 재실행 안전성은 **`su_maek_migrations` 원장**이 준다 — 멱등 가드가 있는 것은 `NNNNa_*.sql`뿐이다 (2026-08-01 정정) |
| 10 | 3-게이트 소비 패턴 | `requireAccess`/`apiAccess`/`getPermMatrix` | 동일. `getPermMatrix`는 **fail-open**(실사고 3) |
| 11 | 피처 폴더 규약 | `src/features/<도메인>/server/{queries,actions}.ts` | 동일 |

**구조 참고 재구현**:

| # | 패턴 | 재구현 이유 |
|---|---|---|
| 12 | 권한 매트릭스 엔진 | 메뉴 목록이 수맥 도메인으로 완전히 다름 |
| 13 | 역할 위계 `canAssignRole` | 역할 7종이 다름 |
| 14 | 데이터 스코프 `getTeacherScope()` | 스코프 대상이 학습 그룹·학생으로 다름 |
| 15 | 뷰 모드(겸직) | 권한 판정은 실 role이라는 규칙만 이식 |
| 16 | 운영실 4패턴 | 권한 사전해석 → 권한 없는 쿼리는 실행 안 함 / 카드 단위 부분 실패 격리 / 패널 노출 조건 = 액션 게이트 조건 / 셸 3분기 |

**폐기**: 출결·수납·상담·급여 도메인, makeedu 동기화 구현(교훈만), allinone 전체.

### 4. mathg-gen에서 이식하는 수식 노하우 (9개)

| # | 노하우 | 수맥 모듈 |
|---|---|---|
| 1 | `fixLatexEscaping` 계열 JSON 백슬래시 복구 | `packages/core/src/math/repair.ts` |
| 2 | `cleanMalformedLatex`·`preprocessMathText` 중앙 정규화 | `packages/core/src/math/normalize.ts` |
| 3 | `$` 없이 흘러나온 LaTeX-heavy 구간 탐지, 한글·수식 경계 | 동일 모듈 |
| 4 | 블록 우선, 인라인 다음의 결정적 구분자 스캔 | `packages/core/src/math/tokenize.ts` |
| 5 | 모든 화면이 하나의 `renderKatexSafe`로 수렴 | `packages/core/src/math/render.ts` — 이 함수 외 KaTeX 직접 호출 ESLint 금지 |
| 6 | 높은 수식(`cases`·`matrix`·`aligned`·`array`)이 있으면 5지선다 세로 배치 | `packages/core/src/math/layout.ts` |
| 7 | 표 안 수식과 KaTeX 내부 SVG의 사전 렌더 | `render.ts` |
| 8 | 본문 수식과 도형 SVG의 점 라벨·변수·단위 글꼴 규칙 일치 | `packages/core/src/math/typography.ts` |
| 9 | 실제 오류를 재현하는 KaTeX 회귀 하네스와 골든 픽스처 | `packages/core/src/math/__fixtures__/golden/` |

**예외**: mathg-gen의 중립 `.math-raw` 폴백은 **저작·검수 화면에서만** 허용한다. 학생 게시물·PDF·HWPX에는 0건이어야 한다.

### 5. 이식 규칙

| # | 규칙 |
|---|---|
| R-1 | **코드를 복사하지 않는다.** 패턴을 읽고 수맥 도메인 이름으로 다시 쓴다. 복사하면 tenant_id·출결 개념이 함께 들어온다 |
| R-2 | 이식한 각 패턴에 출처 주석 대신 **이 ADR 링크**를 둔다. 코드 주석에 "eywa에서 가져옴"이라고 쓰지 않는다 |
| R-3 | 기존 프로젝트의 `.env`·비밀키·실제 학생 연락처·상담 기록·원본 개인정보는 조사하지 않는다 |
| R-4 | 실제 운영 데이터를 테스트 시드로 복사하지 않는다. **합성 데이터로 먼저 검증**한다 |
| R-5 | 기존 목차·개념 ID는 `source_aliases`를 통해서만 canonical concept에 연결한다. 직접 매핑 금지 |
| R-6 | 임계값·상수를 코드로 복사하지 않는다. 정책 버전 테이블로 통합한다 |

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. eywa 포크** | 인증·RLS·운영실이 즉시 동작. 초기 속도 최대 | ① 출결·수납·상담 도메인이 함께 온다 — 제품 경계(C-01) 위반을 코드에서 계속 방어해야 함 ② `tenant_id` 명명이 골프롬프트의 `organization_id`와 충돌 ③ 1,742커밋의 도메인 결합을 풀어내는 비용이 재작성보다 크다 ④ 삭제한 도메인이 마이그레이션 이력에 남아 스키마가 지저분해진다 |
| **B. 전부 새로 작성** | 가장 깨끗함 | eywa 실사고 5건(화면만 잠금, 로그인 무한루프, fail-open 락아웃, refresh 회전 경합, 침묵 orphan)을 다시 겪는다. 실운영에서 검증된 것을 버릴 이유가 없다 |
| **C. 멀티 저장소 + 런타임 연결** | 기존 자산 즉시 활용 | 골프롬프트 3장이 명시적으로 금지("여러 저장소의 런타임을 화면에서 직접 이어 붙이는 방식은 피한다"). 배포·버전·인증이 각각 다름 |
| **D. 모노레포에 기존 프로젝트를 패키지로 흡수** | 점진적 이식 가능 | 각 프로젝트의 스키마·ID 체계가 충돌한다. 하나의 표준 도메인 모델을 만들라는 원칙 10 위반 |

## 비용

| 항목 | 비용 |
|---|---|
| 초기 개발 | 인증·RLS·권한 기반 재구성 약 2주 (포크 대비 +1.5주) |
| 학습 | eywa 코드 정독 필요 (완료 — survey 문서) |
| 유지 | eywa가 개선되어도 자동으로 따라오지 않음. 중요 개선은 수동 반영 |
| 리스크 | 이식 과정에서 패턴을 잘못 이해할 가능성 → RLS 하네스와 권한 매트릭스 테스트로 방어 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | 이식이 아니라 복사가 되어 출결·수납 개념이 유입 | `scripts/boundary-check.mjs` 실패, `tenant_id` 문자열 발견 | 빌드 게이트가 막는다. 발견 즉시 되돌린다 |
| F-2 | 이식한 RLS 패턴이 미묘하게 달라 격리가 깨짐 | RLS 하네스 테스트 실패 | `set local role authenticated` 없이 테스트하면 false-green — 하네스 자체를 먼저 검증 |
| F-3 | eywa 실사고 교훈을 이식 과정에서 흘림 | 로그인 무한루프·관리자 락아웃 재현 | [threat-model.md](../phase0/threat-model.md) 4장의 5건을 테스트로 고정 |
| F-4 | 기존 목차 데이터를 기준 데이터로 승격 | 성취기준 코드 없는 노드가 활성 릴리스에 존재 | 불변 I-16 검증 쿼리 (권위 소스 역추적 0건) |
| F-5 | 재사용 범위가 계속 늘어나 결국 포크와 같아짐 | 이 ADR의 3·4절 목록 밖 패턴이 유입 | 목록에 없는 이식은 이 ADR 갱신 필요 |

## 되돌리기

| 되돌릴 대상 | 방법 | 비용 |
|---|---|---|
| 개별 이식 패턴 | 해당 모듈만 재작성. 인터페이스가 고정되어 있어 국소적 | 낮음 |
| eywa 패턴 전체 포기 | 인증·RLS 레이어 재작성. `packages/core`·도메인 테이블은 무관 | 중간 (2주) |
| 저장소 결정 자체 | **되돌리지 않는다.** 포크로 전환하려면 사실상 처음부터 | — |

이 ADR의 결정 중 되돌리기 어려운 것은 **저장소 선택**뿐이다. 개별 이식 항목은 언제든 재작성할 수 있도록 인터페이스로 감싼다.
