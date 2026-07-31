# Phase 0 조사 — D:\eywa_refactoring · D:\allinone-academy

> 조사일: 2026-07-31. 읽기 전용. `.env*`·비밀키·학생 개인정보·상담/수납/출결 실데이터 미열람.

**결론**: eywa는 커밋 1,742개·실운영 중인 Next.js 16 + Supabase 멀티테넌트 SaaS로, 인증·RLS·권한 기반을 거의 그대로 이식 가능. allinone-academy는 단일 커밋 스캐폴드로 폐기 (보호자↔학생 연결 모델 아이디어만 참고).

## eywa_refactoring 핵심 자산

### 스택 (수맥이 채택한 버전 근거)
Next.js 16.2.6 / React 19.2.4 / TS 5 / Tailwind 4 / drizzle-orm 0.45(마이그레이션 생성기+타입 소스로만) / @supabase/ssr 0.10.3 / supabase-js 2.106 / zod 4 / Vitest 4 + Playwright.

### 인증 (이식 대상)
- Next.js 16은 `middleware.ts` → **`proxy.ts`** 개명. matcher는 api·_next·robots·폰트 확장자 전부 제외 (`eywa src/proxy.ts:22-26`).
- `updateSession()` — `getClaims()`로 refresh 유도, `setAll`에서 요청·응답 쿠키 동시 갱신 후 `NextResponse.next({ request })` (`eywa src/lib/supabase/proxy.ts:29-112`).
- **인증 게이트는 쿠키 존재 여부로만** 판정 (getUser 검증 실패→로그인 무한루프 실사고). 진짜 검증은 shell layout의 `getCurrentUser`.
- 클라이언트 4종: server(`cache()`+setAll no-op) / browser / proxy / admin(`"server-only"`+service_role).
- `getCurrentUser()` — getClaims 로컬 검증, **tenant_id·역할은 JWT가 아니라 public.users에서 항상 조회** (`eywa src/lib/auth/current-user.ts:25-62`).
- refresh 토큰 회전: 멀티 iframe 경합으로 껐음. **외부 SaaS는 회전 켜고 reuse_interval 60~120s** (`eywa docs/auth-session-policy.md`) → 수맥은 멀티고객이므로 회전 ON.

### RLS 3계층 (이식 대상)
1. **테넌트 격리**: `auth_tenant_id()` SECURITY DEFINER 함수 + DO 루프로 전 테이블 `*_tenant_isolation` 정책 (`eywa 0001a_rls_constraints_triggers.sql:21-31,151-176`). 자식 테이블은 부모 경유 EXISTS.
2. **역할 게이트**: 기존 PERMISSIVE 위에 **RESTRICTIVE 추가** (둘 다 통과해야 통과). 역할을 SQL 하드코딩하지 않고 `auth_menu_access(p_menu)`가 tenant_settings의 override jsonb → DEFAULTS jsonb 순으로 해석, master는 항상 full(락아웃 방지) (`eywa 0158a:34-56`). TS 미러와의 드리프트는 SQL 파싱 테스트로 검증 (`permissions-sql-mirror.test.ts`).
3. **Storage RLS**: 경로 규약 `{tenant_id}/...` 선두 세그먼트 비교 (`eywa 0007a:6-12`).

- **RLS 회귀 테스트 하네스**: 트랜잭션 안 `set_config('request.jwt.claims',{sub},true)` + `set local role authenticated` → 교차 테넌트 count=0 검증. DATABASE_URL은 소유자라 role 안 낮추면 false-green (`eywa tests/integration/rls-isolation.test.ts:52-66`).
- 마이그레이션 2갈래 규약: drizzle 생성 `000N_*.sql` + 수기 `000Na_*.sql`(RLS·트리거·EXCLUDE, 멱등). `drizzle-kit push` 금지.

### 권한 모델 (구조 참고)
- 역할 위계 + `canAssignRole`(actor > newRole && actor > target) (`eywa src/lib/auth/role-hierarchy.ts:5-71`).
- 메뉴 매트릭스 `full|scoped|readonly|none` + 테넌트 override + `isPermissionLocked` 가드레일. **`canAccess`(읽기)와 `canWrite`(쓰기) 분리** — 변경 액션에 canAccess 쓰면 readonly가 샌다 (`eywa src/lib/permissions.ts:134-237`).
- 소비 3종: 페이지 `requireAccess`(redirect) / API `apiAccess`(401·403 — redirect는 client fetch 깨뜨림) / `getPermMatrix` 요청당 cache, **fail-open**(fail-closed면 관리자 복구불능 락아웃).
- 데이터 스코프: scoped 권한은 메뉴만 열 뿐 — `getTeacherScope()`가 담당 반→학생 ID로 쿼리 필터 (`eywa src/lib/auth/teacher-scope.ts:18-33`).
- 뷰 모드(겸직): 뷰는 스코프·크롬만 바꾸고 **권한 판정은 실 role** (`eywa src/lib/auth/view-mode.ts:31-76`).

### 운영실 4패턴 (오늘 운영실 청사진)
1. 권한 사전해석 `resolveDashboardAccess` → **권한 없는 쿼리는 실행 자체를 안 함** (`eywa src/features/dashboard/dashboard-access.ts:42-67`).
2. 카드 단위 부분 실패 격리 `{data, unavailable}` (`eywa dashboard/page.tsx:63-70`).
3. 패널 노출 조건 = 액션 게이트 조건 (죽은 패널 방지).
4. 셸 3분기: 임베드(x-embed) / 미니셸 / 풀셸 + 뷰-경로 정합성 가드 (`eywa (shell)/layout.tsx:33-236`).

### 구조 규약 (채택)
- App Router route group을 인증 경계로: `(shell)` `(auth)` `(marketing)` `(print)` 등.
- `src/features/<도메인>/server/{queries,actions}.ts` + `components/` 피처 폴더 규약.

## 위협 모델에 항목화할 실사고 5건
1. **화면에서만 잠갔다**: 앱 게이트만 있고 RLS 역할 게이트 없으면 사용자 access token으로 PostgREST 직접 접속해 우회 (실제 계좌번호 노출).
2. **로그인 무한루프**: 미들웨어에서 getUser() 검증 실패 = 로그아웃이 됨. 게이트는 쿠키 존재로, 검증은 레이아웃에서.
3. **fail-open vs 락아웃**: 권한 설정 조회 실패 시 fail-closed면 관리자가 설정 화면에 못 들어가 복구 불능. DB 레벨에서도 최고 역할은 항상 통과.
4. **refresh 회전 경합**: 멀티 창 + 회전 + 짧은 reuse interval → 정상 사용자를 탈취범 오인, 세션 폐기.
5. **write-only 동기화 orphan**: status='ok'인데 error 필드에만 이슈 축적 → 유령 데이터 침묵 누적. 동기화 상태는 UI 배지로 노출.

## allinone-academy
단일 커밋(2026-01-28) FastAPI+React 스캐폴드. 테넌트 격리·외부 동기화 부재. JWT 자체 구현은 Supabase Auth로 대체. 유일한 참고: `student_teachers`/`student_parents` 관계 기반 스코프 모델 (`allinone models/student_teacher.py:19-59`) — 단 DB 강제(RLS) 필수.

## 재사용 판정 요약
- **재사용 가능(이식)**: 프록시 세션 갱신, 4-클라이언트, getCurrentUser, auth_tenant_id+DO 루프, Storage RLS, RLS 테스트 하네스, RESTRICTIVE 역할 게이트, 마이그레이션 2갈래 규약, 3-게이트 소비 패턴, 피처 폴더 규약, 세션 정책 문서.
- **구조 참고 재구현**: 권한 매트릭스 엔진(테이블은 수맥 도메인으로), 역할 위계, 데이터 스코프, 뷰 모드, super_admin, 운영실 4패턴.
- **폐기·비범위**: 출결·수납·상담·급여 도메인, makeedu 동기화(교훈만), allinone 전체(관계 스코프 아이디어 제외).
