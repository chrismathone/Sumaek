# 수맥(Su-Maek) — 인수 시나리오 62개 현재 상태

> 골프롬프트 31장 「최종 인수 시나리오」 62개에 대한 **정직한 회계**.
> 기준 시각: 2026-08-01 16:30 (커밋 `65eb5c2` 이후 작업분 반영)
> 완료 기준: `docs/phase0/decisions.md` — "코드 완결 + 로컬 검증", 실환경 전용 항목은 스크립트·런북으로 갈음
>
> **이 문서의 존재 이유는 정직한 회계다.** 근거 없는 ✅는 없다. 확실하지 않은 것은 낮은 등급으로 적었다.

## 판정 분류

| 기호 | 뜻 | 개수 |
|---|---|---|
| ✅ | **검증됨** — 자동 테스트 또는 실행 검증이 존재하고 통과한다 | **21** |
| 🟡 | **구현됨·부분 검증** — 코드는 있으나 전용 테스트가 없거나 일부 조건만 만족한다 | **34** |
| 📋 | **준비됨** — 실환경 전용이라 스크립트·런북·어댑터로 준비했다 | **4** |
| ❌ | **미구현** — 아직 코드가 없다 | **3** |

> 2026-08-01 독립 검증(에이전트 32개가 근거 파일을 직접 대조 + 반박 검증)으로
> **5·23·35를 강등**했다가, 같은 날 3순위 작업으로 **5·15·23을 검증 완료(✅)**로
> 올렸다. 근거로 인용된 파일·라인은 사실상 전부 실재했고 ❌ 5건도 전부 타당했다 —
> 없는 것을 있다고 적은 거짓은 없었다. 문제는 한 방향이었다:
> **코드는 있는데 그 코드를 실행하는 테스트가 없거나, 제품 안에서 도달할 수 없는
> 분기이거나, 근거로 든 테스트가 해당 인수를 실제로 검증하지 않았다.**
>
> 이번에 올린 세 건은 **변이 검증**을 거쳤다 — 검증 대상 코드를 일부러 망가뜨려
> 테스트가 실제로 실패하는지 확인하고 원복했다. "테스트를 썼다"와 "그 테스트가
> 무언가를 붙잡고 있다"는 다르고, 이 표가 반복해서 헛짚은 지점이 바로 그 차이였다.
> 21(워커 재개)과 35(런북)는 작업했지만 🟡을 유지한다 — 각각 SIGKILL 리허설과
> 롤링 배포 실체가 여전히 없기 때문이다.

## 총평

**이번 구간(2026-08-01)에 닫힌 것.** 독립 검증이 세 종류의 결손을 드러냈고 모두 수리했다 — (1) **권한**: 읽기 게이트가 내비 링크 숨김뿐이어서 URL 직접 입력으로 학습자 개인정보에 도달할 수 있었다(인수 13). (2) **도달 불가 분기**: `ai_budgets`에 쓰는 경로가 없어 100% 차단이 죽은 코드였다(인수 37). (3) **배포 결손**: `katex.min.css`가 일부 라우트에만 로드돼 학생 응시 화면에서 수식이 두 번 보였다(인수 51) — 문자열만 보던 기존 검사는 전부 통과했기에, 렌더된 DOM의 박스 크기로 판정하는 하네스를 새로 세웠다. 검증 인프라도 결손을 메웠다: **ESLint·CI 신설**(인수 17), E2E 날짜 하드코딩 제거, DB 없이도 전체 스위트가 깨끗하게 skip되도록 수리.

**목록 UI 규약**(ADR-0016)으로 14개 화면을 정렬·필터·페이지네이션·행 링크가 있는 표로 통일했다. 이 과정에서 E2E 스펙 11개가 깨졌고 고치면서 **기존 거짓 통과 2건**을 발견했다(1쪽만 보고 통과하던 "목록에 없다" 단언, 엉뚱한 칸을 읽던 "추출 문항 ≥1"). 테스트 잔재가 데모 워크스페이스를 뒤덮던 문제는 `purgeTestData` + Playwright 티어다운으로 재발을 막았다 — 불변 증거를 가진 행은 삭제하지 않고 보관 처리한다.

**"앱이 스스로 데이터를 만들 수 없다"**는 문장은 더 이상 사실이 아니다 — 반·학습자 등록(설정), 루트 작성·검증 게이트·게시(빌더), 일정 실체화, 불참·휴강 접수→재계산, 학생 오버라이드, 개인정보 삭제 요청까지 E2E 32건이 완주한다(시드된 조직·교사 계정·과정 기간 위에서). **운영 안전장치**도 표시가 아닌 집행이 됐다: kill switch가 워커 클레임을 실제로 막고(작업은 큐에 보존), 일정 검증 실패는 이전 리비전을 유지하며, 낙관적 잠금이 VERSION_CONFLICT를 실제로 던지고, 회로 차단기·AI 비용 한도·DLQ 재처리·복구 검증 하네스(불변 29검사, 위반 0행)가 실DB에서 돈다.

**break-glass가 집행이 됐다**(인수 28). 컬럼만 있던 `operator_access_grants`에 판정·발급·회수·감사·소유자 고지를 붙였다. 판정은 `grantState` 한 곳에만 두고 SQL where 절에 복제하지 않았다 — 두 곳에 두면 느슨한 쪽이 이긴다. 만료는 배경 작업이 아니라 요청마다 다시 판정된다(승인이 죽으면 `operator` 역할이 아예 만들어지지 않는다). 승인이 권한을 넓히지 않는다는 사실은 매트릭스 자체에 적혀 있어(operator 열에 full·scoped 0칸) 앞으로 추가될 쓰기 액션도 `canWrite` 게이트만 지키면 자동으로 닫힌다. 남은 것은 **2인 승인**이다 — 스키마의 `approved_by`가 단수라 지금 승인자는 워크스페이스 소유자 1인이다.

남은 ❌ 3건은 전부 한 뿌리다 — **교육과정 권위 실데이터가 없다**. 성취기준→개념→목표→증거→블루프린트 사슬(48), 수직 진행 화면(45), 릴리스 diff(50)는 권위 소스 수집(스키마·검사는 완비)이 선행 조건이다. 카나리(36)는 이 뿌리와 무관해 이번에 닫혔다.

---

## 62개 시나리오 판정표

| # | 시나리오 요약 | 판정 | 근거·경로 |
|---|---|---|---|
| 1 | 랜딩 ERP 오인 없음 | ✅ | `e2e/tests/marketing.spec.ts:5,22` 「히어로 카피와 CTA」·「학원 ERP 오인 문구가 없다」 + `e2e/tests/smoke.spec.ts` + `scripts/boundary-check.mjs` 금지 카피 7종 |
| 2 | 데모 불참·점수 반영 | 🟡 | 마케팅 데모(`OrbitBoard.tsx`)는 여전히 미리 그린 SVG 토글. 다만 **실동작은 앱에서 검증됨** — 인수 5의 휴강 왕복 E2E가 같은 시나리오를 실DB로 완주한다. 데모를 실엔진에 연결하는 일만 남음 |
| 3 | 온보딩·첫 루트 게시 | ✅ | **문구 정정(2026-08-01)** — 검증 게이트→게시→일정 실체화는 `route-builder.spec.ts:20-119`가 강하게 단언한다(빈 루트 거부, 검증 전 게시 버튼 부재, 실체화 건수). 다만 이전 서술의 "시드 없이 완주"는 사실이 아니었다 — 두 스펙 모두 **시드된 조직·교사 계정·과정 기간** 위에서 돈다(과정 기간이 없으면 반 만들기 폼 자체가 렌더되지 않는다: `settings/page.tsx:114`). 자립 생성 범위는 반·학습자·루트다. `createCoursePeriod`는 UI 폼에만 있고 테스트 호출 0건. 마법사형 안내 UI는 없다 |
| 4 | 반 공통·학생 독립 루트 | 🟡 | 학생 독립 루트 생성(빌더 `kind=learner_route`) + 학생 오버라이드 생성·격리·취소 E2E(`route-builder.spec.ts:125`). **학습자 스코프 실체화 구현됨** — `db/src/domain/learner-schedule.ts`가 오버라이드를 소비해 `learner_schedule_items`를 만든다. 재합류는 엔진(`applyOverrides`)에 구현(`core/test/scheduling/engine.test.ts` 재합류 6건, 변이 3회 검증). 라이브 DB 통합 `db/test/learner-scope-schedule.test.ts` 21건 — 반 일정 비영향·불참 반영·완료 보존, 변이 6회 검증. **🟡을 유지하는 이유: 제품 안에서 도달할 수 없다** — 이 함수를 부르는 화면·워커 배선이 없다 |
| 5 | 불참 시 과거 보존 | ✅ | **복구(2026-08-01)** — 강등 사유였던 "가드를 지워도 깨지는 테스트가 없다"가 해소됐다. `packages/db/test/schedule-history-preservation.test.ts` 7건이 DELETE 가드(`domain/schedule.ts:313-321`)의 조건을 하나씩 겨눈다 — 과거 planned·완료·잠긴 미래·취소·다른 반은 재실체화 후에도 남고, 미래의 잠기지 않은 planned만 교체된다. 실체화를 두 번 돌려 반복 검증한다. **변이 검증으로 실효성을 입증**: `status='planned'` 제거 → 3건 실패, `locked_at is null` 제거 → 2건, `session_date >= today` 제거 → 2건, `learning_group_id` 제거 → 1건. 원복 후 7/7 통과(프로덕션 코드 diff 0줄). `organization_id` 조건만 변이 불가 — group id가 전역 유일이라 그 조건을 지워도 삭제 범위가 넓어지지 않는다. 휴강 재계산 왕복은 `availability.spec.ts`가 그대로 덮는다 |
| 6 | 오늘 수업 화면 | 🟡 | `app/today/page.tsx` 실 DB 조회, `auth.spec.ts:31`은 **빈 상태만** 검증. 교재 범위·학생별 차이·숙제·예외 표시는 미검증이며 숙제 도메인 자체가 없음 |
| 7 | 검수·권한 통과 문항만 | 🟡 | `lib/domain/assessment.ts`가 `review_status='published' AND is_auto_assignable AND content_rights.status='usable'`로 풀을 좁힘 + `assessment/select.test.ts` 8건(선정 엔진). **제외되어야 할 문항이 실제로 제외되는 부정 케이스 테스트 없음** |
| 8 | 자동 채점·예외함 분기 | ✅ | `grading/grade.test.ts` 13건(동치·단위 불일치·모호·서술형 분기) + `e2e/tests/full-loop.spec.ts` + `runner.spec.ts` 3건 + `apps/web/test/integration/grading-exception.test.ts` |
| 9 | 예외 판정 후 일관 갱신 | 🟡 | `apps/web/test/integration/grading-exception.test.ts:103`이 점수·숙련도 갱신까지 검증. **복습·재시험·미래 일정 갱신은 미검증** |
| 10 | 확인테스트 분기·재합류 | 🟡 | `lib/domain/attempt.ts`에 확인테스트 재시험 계획 코드 존재. 전용 테스트 없고 보충 경로 분기·재합류 지점 지정은 미검증 |
| 11 | mathg-gen PDF 반입 | 🟡 | 반입 파이프라인 커밋·E2E 1건 + 회로 차단기·비용 한도 연결. 실 PDF 파싱이 아닌 결정론적 목이며 **도형(SVG) 보존 경로 없음** |
| 12 | 중복·출처불명 게시 차단 | 🟡 | 검수 상태·`is_auto_assignable`·권한 게이트는 존재. **중복 탐지 해시 컬럼·계산 코드 없음**(`duplicate_groups` 테이블은 빈 채로 존재), 정답 불일치 교차검증 없음 |
| 13 | 역할별 접근 제한 | ✅ | **결손 발견·수리(2026-08-01)** — `canAccess`가 내비 링크 숨김 1곳에서만 쓰여 **URL 직접 입력으로 학습자 개인정보 화면에 도달할 수 있었다**. `lib/auth/require-access.ts`를 만들어 `/app` 하위 22개 페이지에 읽기 게이트를 걸고, 거부 시 역할이 열 수 있는 화면으로 보낸다(`/app/no-access`). 회귀 검사 `apps/web/test/authz/read-gate.test.ts` 7건이 게이트 누락·메뉴 키 불일치·착지 경로 루프를 소스 수준에서 막는다 + 기존 `authz/matrix.test.ts`·RLS 9건 |
| 14 | 감사 로그 추적 | ✅ | `audit_events`에 actor·reason·rule_version·before/after 전부 존재(`schema/workspace.ts:250-274`), 불변 트리거(`0001a_rls_core.sql:211-223`), 쓰기 3경로, `e2e/tests/teacher-app.spec.ts:52` 자동·수동 기록 확인 |
| 15 | 360px~1440px·키보드 | ✅ | **axe 도입(2026-08-01)** — `e2e/tests/a11y.spec.ts`가 공개 5화면 + 로그인 오류 상태 + 교사 앱 4화면을 `wcag2a`·`wcag2aa`로 검사하고 데스크톱·태블릿·모바일 3폭 전부 통과(21건). **규칙을 하나도 끄지 않았다** — 발견된 위반은 전부 앱을 고쳤다: `FlowTabs`의 `ol[role=tablist]>li` 구조 위반 3종(roving tabindex·aria-controls 추가), 좁은 폭에서 키보드로 밀 수 없던 가로 스크롤 영역 6곳(`ScrollableRegion` 신설), `--color-grade` 대비 미달(#c9453d 3.87:1 → #b53430 4.87:1). `visual-check.mjs`에 교사 앱 6화면을 추가했고 **그 확장이 실제 회귀를 잡았다**(mobile `/app/settings` 가로 스크롤 — 요일 7칸 366px > 360px, `flex-wrap`으로 수정). 한계: 기준이 WCAG 2.0 A·AA라 2.1 추가 규칙은 미포함(보조 스캔은 0건), axe `incomplete`는 단언하지 않음(장식 기호·SVG 배경 미확정), 초기 렌더 + 로그인 오류 상태만 본다 |
| 16 | 재시도·중복·부분 실패 | 🟡 | 멱등 3종 동작: 큐 `jobs_idempotency_uq`, Inbox `(consumer,event_id)`, `assessments_idempotent_uq`. E2E 2건(`schedule.spec.ts` 재생성 동수, `assessment.spec.ts` 중복 생성 차단). **부분 실패·장시간 재접속 시나리오 미검증** |
| 17 | 빌드·린트·테스트 통과 | 🟡 | **린트 결손 해소(2026-08-01)** — `eslint.config.mjs`(flat, typescript-eslint + react-hooks + @next/next) 신설, `pnpm lint` 실동작(0 오류). CI도 생겼다 — `.github/workflows/ci.yml`이 boundary→lint→typecheck→test→build를 돌리며 시크릿 없이 통과함을 실측했다. 단위·통합 435건, E2E 32건 통과. **접근성 자동 검사(axe)는 여전히 0건** |
| 18 | 가짜 데이터·TODO 없음 | 🟡 | `TODO`/`FIXME` 문자열 0건, `/app/**` 하드코딩 데이터 0건(전부 실 DB). 빈 상태 CTA는 이제 실제 등록 폼(설정)과 빌더로 이어진다. "준비 중" 문구 2곳 잔존(reports·settings의 정책 편집·휴일 달력·교직원 초대) |
| 19 | 10회 중복 제출 1회 처리 | 🟡 | `lib/domain/attempt.ts:145-166` 조건부 UPDATE로 원자적 1회 전이 + 재제출 시 동일 결과 반환. **10회 동시 전송 부하 테스트 없음** |
| 20 | 동시 수정 충돌 표시 | ✅ | **완결(2026-08-01)** — 거부만 하던 자리에 **비교 화면**을 붙였다. `route_plans.lock_version` 불일치는 그대로 VERSION_CONFLICT로 거부하고(마지막 저장이 조용히 이기지 않음), 이제 그 거부에 항목 단위 diff가 실려 온다 — 노드 추가·삭제·순서·제목·종류·시수(`packages/core/src/routes/conflict.ts`). 화면(`apps/web/src/app/app/routes/ConflictPanel.tsx`)은 **내 변경(저장 안 됨) vs 저장된 최신 상태**를 나란히 놓고, 같은 노드를 양쪽이 건드린 지점을 따로 집어내며, **내 변경을 최신 상태 위에 그대로 다시 적용**하는 버튼을 준다 — 새로 고침만이 답이 아니다. 다시 적용이 불가능한 경우(남이 먼저 지운 노드를 지우려던 경우, 최신 상태에서 끝자리가 된 노드를 더 밀려던 경우)에는 버튼 대신 이유를 말한다. 비교 기준인 "내가 읽었던 상태"는 **폼에 실린 스냅샷**으로 확보한다 — 노드 이력 테이블이 없고 route_nodes가 제자리 수정이라 서버가 사후 복원할 수 없다(대안 셋의 비교와 채택 이유는 `conflict.ts` 머리 주석). 검증: 단위 26건(`packages/core/test/routes/conflict.test.ts`) + 라이브 DB 통합 6건이 **실제 서버 액션에 두 사람의 편집을 태워** 확인(`apps/web/test/integration/route-conflict.test.ts` — 거부·항목 비교·다시 적용 후 양쪽 변경 생존·삭제 충돌 차단·스냅샷 부재 시 비교 안 함·정상 경로 대조군) + E2E가 **탭 두 개로 진짜 동시 편집**을 만들어 화면까지 확인(`e2e/tests/route-builder.spec.ts` 4c, desktop·mobile 통과). **변이 검증 6종**: MOVED 판정 제거 → 단위 1·통합 1 실패, 순서를 절대 sort_order로 판정 → 단위 3, 폼 스냅샷을 읽지 않게 → 통합 3·E2E 1, 삭제 재적용 가드 제거 → 단위 1·통합 1, 깨진 스냅샷을 부분 복원 → 단위 1, 화면에서 패널 제거 → E2E 1. 원복 후 전부 통과. **한계**: 스냅샷은 표시 전용이라 위조해도 쓰기 판정(서버 lock_version 비교)에는 영향이 없지만 자기 화면의 diff는 틀어진다. lock_version과 노드를 한 트랜잭션으로 읽지 않아 둘이 어긋난 드문 경우에는 "달라진 항목을 찾지 못했다"고 정직하게 말하는 데서 멈춘다. `validateDraft`는 lock_version을 올리지 않으므로 "남이 검증만 한" 변화는 비교 대상이 아니다 |
| 21 | 워커 종료 후 재개 | 🟡 | **재개 경로 검증(2026-08-01), 등급 유지.** `apps/worker/test/handlers/schedule-resume.test.ts` 9건이 "중단 → 리스 만료 회수 → 재개"를 라이브 DB로 검증한다 — 체크포인트 보존, 소유자 교체·attempts 증가, 완료 그룹 건너뜀, **재작업 없음**(완료 그룹의 세션 ID 집합이 재개 전후 동일 — 실체화가 지우고 새 uuid로 다시 넣으므로 ID가 같으면 그 경로를 타지 않았다는 뜻), inbox 중복 대조군. 변이 3종으로 실효성 입증(건너뛰기 제거 → 2건 실패, 체크포인트 예외 제거 → 3건, `checkpointJob` 제거 → 5건). 6회 연속 실행 전부 통과. **여전히 없는 것**: 실제 SIGKILL 리허설. "체크포인트 이후·완료 이전"을 맞히는 타이밍 경주라 플레이키를 피할 수 없어 넣지 않았다 — 따라서 **커넥션 강제 절단 시 열린 트랜잭션 롤백 경로는 미검증**이다. 그래서 ✅로 올리지 않는다 |
| 22 | 리비전 검증 실패 시 이전 유지 | ✅ | 검증 게이트 — 배치 불가 충돌 시 세션 무변경·이전 활성 리비전 유지·실패 변경안만 기록. 라이브 DB 통합 2건(`schedule-gate.test.ts`): 슬롯 0 → 세션·리비전 0 + failed 기록 / 성공 일정 위 전 기간 휴강 → 리비전·세션 불변 |
| 23 | AI·OCR 장애 회로 차단 | ✅ | **복구(2026-08-01)** — 강등 사유 둘을 다 덮었다. 근본 원인은 `MockAiProvider`가 절대 실패하지 않아 장애 실연 수단이 없었던 것 — `FailingAiProvider`(`mock-failing`, 명시 설정 시에만 선택. `.env`·CI·문서 어디에도 없음을 확인)를 만들었다. **공급자별 독립 차단** 4건 추가(7→11건)를 변이로 입증: `getSharedBreaker`가 이름을 무시하도록 바꾸면 새 4건만 실패하고 기존 7건은 통과 — 기존 테스트가 이 주장을 검증하지 못했다는 강등 사유가 그대로 재현된다. **파일 uploaded 복귀**는 `packages/db/test/ingestion-failure-live.test.ts` 4건이 라이브 경로로 확인(대조군으로 `updated_at`을 비교해 "extracting까지 갔다 돌아왔다"를 증명). **부수 발견을 실측하고 고쳤다**: `createAiProvider`가 try 밖에 있어 `AI_PROVIDER=anthropic`이면 catch에 닿지 못하고 파일이 `extracting`에 갇혔다 — 수정 전 코드로 재현(`expected 'extracting' to be 'uploaded'`) 후 try 안으로 이동 |
| 24 | DLQ 이력·재처리 | 🟡 | `pnpm requeue-dlq` — --dry-run·topic/limit 필터·last_error 보존·감사 기록. 실행 검증됨(현재 DLQ 0건이라 재처리 실동작은 미확인). UI는 없음 |
| 25 | 골드셋 채점 정확도 | 🟡 | `grading/grade.test.ts:119` 모호한 답 미확정, `:101` 단위 불일치 예외함 이동 등 판정 규칙은 검증. **정확도 99.99% 목표를 측정하는 골드셋 하네스 없음**(SLO 문서에만 존재) |
| 26 | 저품질 AI 결과 유입 0건 | 🟡 | 출제 풀 필터에 `is_auto_assignable` + 권한 `usable` 조건 존재, 반입이 저신뢰(`confidence < 임계`)를 검수함으로 보냄 (I-07·I-13 검사가 상시 감시). **유입 0건을 지키는 회귀 테스트 없음** |
| 27 | 교차 테넌트 노출 0건 | 🟡 | `packages/db/test/rls-isolation.test.ts` 9건이 ID 직접 조회·WITH CHECK·학생 격리·인프라 테이블 차단까지 검증(격리 자체는 강함). **"시도가 감사된다"는 미구현**이고 캐시·검색·내보내기 표면은 존재하지 않음 |
| 28 | break-glass 사유·승인·만료 | ✅ | 판정은 `core/authz/break-glass.ts`의 `grantState` 하나(SQL에 복제하지 않음, 절대 시각 기준·DB 시계 사용). 집행 자리는 `lib/auth/current-user.ts` — 승인이 살아 있어야 `operator` 역할이 만들어지고, 매트릭스의 operator 열에 full·scoped가 없어 전 메뉴 쓰기가 닫힌다(학습자 개인정보 메뉴는 읽기도 none). 발급·회수·감사·소유자 고지는 한 트랜잭션(`db/domain/operator-access.ts`), 조회는 `requireAccess`가 `ops.break_glass_access`로 기록. 불변식은 DB CHECK(사유 비어있지 않음·만료 필수·최대 4시간·승인자 짝)로도 강제(`0006a_operator_access_enforcement.sql`). UI `/app/settings/operator-access`. 검증: core 17 + db 라이브 9 + web 세션·게이트 라이브 7, **변이 검증 5종 통과**(만료 판정 삭제/세션 필터 삭제/조회 감사 삭제/operator 쓰기 개방/DB CHECK 삭제 — 각각 해당 테스트가 실패). **미구현: 2인 승인**(스키마의 `approved_by`가 단수라 승인자는 소유자 1인), 운영자 계정 선택 UI(UUID 직접 입력), E2E 없음 |
| 29 | 악성 업로드·인젝션 격리 | 🟡 | MIME 화이트리스트·PDF 매직바이트·크기 상한·SHA256 중복 차단(`content/ingestion/actions.ts`). **압축 폭탄 방어 없음**, 프롬프트 인젝션은 주석상 원칙만(`ai/provider.ts:4-6`) |
| 30 | 사용권 중지 5분 내 반영 | ✅ | 교재 화면 중지(사유 필수)→같은 트랜잭션 `ContentRightsRevoked` 발행→워커 `content.rights-impact`가 영향 문항·열린 테스트 목록을 업무함에 전달(실DB 검증: 문항 8·테스트 1·알림 2). 신규 출제 제외는 풀 필터가 즉시 집행. E2E 중지→복구→감사. 5분 SLA "측정"은 실환경 몫 |
| 31 | 알림 공급자 중단 내성 | 🟡 | 앱 내부 알림은 `handlers/schedule.ts:72-148`이 `notifications` 테이블에 생성하며 오늘 할 일·배정과 독립. **외부 알림 공급자 어댑터가 아예 없어** 중단 시나리오 자체가 성립하지 않고, `notifications.group_key`에 유니크 인덱스가 없어 중복 방지도 미보장 |
| 32 | 캐시·검색 재구축 | 🟡 | `scripts/rebuild-read-models.mjs` 실동작 — 유일한 파생 읽기 모델(숙련도)을 증거+활성 정책에서 재생성, 이벤트 미발행(연쇄 방지), --dry-run 정합 검사. 실행 검증됨(동일 6건). **검색 인덱스·캐시 계층은 애초에 없음** — 재구축 대상이 생기면 확장 |
| 33 | DB 장애 후 유실 0·RTO | 📋 | 런북 + `scripts/verify-recovery.mjs` + `packages/db/src/checks/invariants.sql`(29검사) **실작성·실행 완료 — 현 DB 위반 0행**. PITR 복원 실훈련만 실환경 몫 |
| 34 | 백업 복구 검증 | 📋 | 검증 스크립트 결손 해소(33과 동일 하네스, RECOVERY_DATABASE_URL 대상 전환 지원). 실제 격리 복구 리허설은 실환경 몫 |
| 35 | 롤링 배포·스키마 되돌리기 | 🟡 | **강등(2026-08-01) → 런북 정정 완료(2026-08-01), 등급 유지.** 거짓 서술 11건을 실측으로 확인해 고쳤다(RB-14 0장에 "무엇이 왜 틀렸나" 전체 기록): `schema_migrations`→`su_maek_migrations`(컬럼도 `name`·`applied_at` 둘뿐), `inbox_messages.outcome`→`inbox_events`(outcome 컬럼 자체가 없어 `skipped_unknown` 판정은 애초에 불가), 존재하지 않는 `*.down.sql` "필수 첨부" 단언, 실행되어 버리는 `migrate --dry-run`(argv 미독), 없는 스크립트 3종(`test:rls`·`test:smoke`·`test:compat`), 없는 트리거명 4종, `jobs.run_after`·`queue` 컬럼 부재, V-14 kill switch 판정 반전. **가장 중대한 정정**: "미지 event_type은 Outbox에 남아 소비자 배포 후 자동 해소"는 거짓 — 디스패처가 작업 0건인 채 `delivered`로 표시해 **영구 유실**된다(`queue.ts:340-344`). 배포 순서 규칙을 "소비자 먼저"로 뒤집고 수기 복구 절차(5.8.1)를 신설. "전 SQL `if not exists` 가드"(가드 0건 / TABLE 89·INDEX 141)는 원발점인 ADR-0004·assumptions C-06·backup-recovery 8.2까지 정정. **문서만 고쳤다** — `*.down.sql` 0건, CI 게이트 2종(역방향·드리프트), 계약 테스트, 합성 모니터링 SYN-1~5, 롤링 배포 실체(Dockerfile·health 엔드포인트)는 여전히 없다. RB-14 9.1에 미구현 목록으로 명시 |
| 36 | AI 모델 카나리 승격 중단 | ✅ | **신설(2026-08-01)** — 레지스트리(`ai_model_versions`: candidate→canary→active, 악화 시 halted, 승격 시 retired. active·canary는 조직·작업당 1행을 부분 유니크 인덱스로 강제)와 섀도 관측(`ai_shadow_evaluations`)을 `0008a_ai_model_canary.sql`로 신설. 판정은 `core/src/ai/model-registry.ts` 한 곳(승격 게이트·중단 임계를 같은 파일에 둔 이유: 두 곳에 두면 느슨한 쪽이 이긴다). **실사용 경로에 배선됐다** — `domain/ingestion.ts`가 레지스트리의 active 모델로 추출하고, 직후 카나리를 같은 입력으로 한 번 더 불러 일치도·지연·비용만 기록한다. 섀도는 **던지지 않고**, 관측 타입에 questions가 없어 카나리 산출물이 저장될 경로 자체가 없다. 카나리는 실사용과 다른 회로 차단기를 쓰고(`shadow:` 접두사), 섀도 비용은 `ai_usage_events`에 넣지 않는다 — 실험이 조직 월 한도를 소진해 실사용을 막으면 인수 37과 충돌한다. kill switch `ai_model_canary`가 섀도만 끈다(반입은 계속). 승격은 표본 20·일치도 0.95·실패율 2%·p95 1.25배+50ms·비용 1.5배를 **전부** 넘어야 하고 우회 플래그가 없다. 운영 중 악화는 섀도 기록마다 최근 50건을 다시 보고 자동 중단(사유 필수 — DB CHECK로도 강제, 소유자 업무함 고지). 운영 CLI `pnpm ai-canary`(list·register·status·promote·halt) 실행 검증. 검증: core 39건 + 라이브 DB 9건, **변이 검증 12종 통과**(레지스트리 active 무시/kill switch 무력화/자동 중단 삭제/승격 게이트 삭제/섀도 예외 재던짐/카나리가 실사용 차단기 공유/공급자 일치 검사 삭제/게이트 조기 반환/관측에 산출물 노출/지연 완충 삭제/가격표 검사 삭제/중단 임계를 승격 임계로 — 각각 해당 테스트가 실패). **한계**: 화면 없음(CLI 전용)·E2E 없음, 실공급자가 없어 비교 대상은 목 모델 두 버전이고 지연·비용 수치는 실측이 아니다, 승격 **성공** 경로는 시드 표본 25건으로 검증했다(차단 경로는 실제 반입 표본으로 검증), 섀도가 트래픽 100%에 붙고 **사용자 요청 안에서 동기로 돈다** — 결과는 안 쓰지만 기다리는 시간은 사용자의 것이다(카나리 전용 차단기로 3회 실패·10초 제한·5분 휴지를 걸어 완화했을 뿐, 워커 큐로 옮기는 것이 근본 해결), 배선된 작업은 `extract_questions` 1종, 카나리는 배포 공급자와 같은 공급자여야 한다(교차 벤더 카나리는 의도적 미지원) |
| 37 | 조직 AI 비용 한도 | ✅ | **도달 불가 분기 수리(2026-08-01)** — `ai_budgets`에 **쓰는 코드가 0건**이라 `limit_usd`가 항상 null이었고 100% 차단은 죽은 코드였다. `setAiBudget` 서버 액션(권한 게이트·감사 before/after)과 설정 화면 폼(`AiBudgetForm.tsx`)을 붙였다. 실DB 통합 4건(`packages/db/test/ai-budget-live.test.ts`)이 **한도 없음→경고→차단→해제** 전 구간이 실제로 도달함을 증명한다. 월 경계는 조직 시간대 기준으로 교정 |
| 38 | 2배 피크 부하 SLO | 📋 | `scripts/load/submit-answers.k6.js`(875 RPS ramping-arrival-rate) + README(서버 액션 제약·대안 명시). 합의상 "스크립트 준비"가 완료 기준 — 실행은 실환경 몫 |
| 39 | 개인정보 삭제 요청 | ✅ | `data_deletion_requests`(0002) + 익명화 도메인(멱등: 토큰 치환·소속 종료·서술 본문만 삭제·점수·증거 보존·백업 만료일 고지) + 소유자 전용 접수→이름 재입력 확인→집행 UI. E2E 전 과정 + R-09 검사가 처리 정합을 상시 감시. 유령 테이블을 조회하던 런북 문제 해소 |
| 40 | SEV1 5분 탐지·안정화 | 🟡 | 안정화 도구는 실동작 — kill switch가 워커 클레임에서 토픽을 실제 제외(작업 큐 보존·복구 시 재개, 조직 스코프는 연기)하고 `pnpm kill-switch` CLI·설정 토글(사유 필수·감사) E2E 검증. **탐지(경보 파이프라인·SLO 프로브)는 미구현** — 5분 탐지는 아직 사람 몫 |
| 41 | 교육과정 원문 역추적 | 🟡 | 스키마 완비 — `curriculum_authority_sources.original_url`/`file_checksum`/`reviewed_by`(`schema/curriculum.ts:37-59`) + `source_location`. **실 데이터 0건**(시드가 권위 소스·성취기준을 넣지 않음), 수집 스크립트 없음 |
| 42 | 2015·2022 미혼재 | 🟡 | `curriculum_versions` + `curriculum_applicabilities`(학년도×학교급 유니크) + 도메인 6개 테이블의 `curriculum_version_id` 존재. **데이터·화면 구분·혼재 방지 테스트 전부 없음** |
| 43 | 선수 그래프 릴리스 차단 | ✅ | `curriculum/graph.test.ts` 11건 — `:108` 「순환이 있으면 전체 릴리스가 차단된다 (인수 43)」, `:79` 고아 간선, `:117` 근거 없는 개념, `:126` AI 제안 위장 차단. (게이트 함수 검증이며 릴리스 발행 파이프라인은 미연결) |
| 44 | 공식 vs 내부 구분 | 🟡 | 스키마 분리 명확(`official_curriculum_nodes`/`achievement_standards` ↔ `canonical_concepts`, 연결은 `curriculum_mappings`) + 화면 고지 E2E 검증(`teacher-app.spec.ts:78` "공식 성취기준이 아닙니다"). **API·내보내기 표면은 미검증** |
| 45 | 수직 진행 탐색 화면 | ❌ | `content/curriculum/page.tsx`는 평평한 표 + `A → B` 텍스트 목록. 이전 학교급·다음 확장·표상·대표 오개념 데이터와 화면 전부 없음. 필요: 수직 계통 뷰 + 오개념 데이터 |
| 46 | AI 제안 승인 전 사용 0건 | 🟡 | `graph.test.ts:54` 「AI 제안 간선은 자동 계획에서 제외된다」·`:126` active 위장 차단으로 **사용 차단은 단위 검증**. 화면에 provenance·confidence 표시(`questions/[id]`). **승인 버튼·영향 범위 표시 없음** |
| 47 | 다증거 숙련 판정 | ✅ | `mastery/engine.test.ts` 13건 — `:41` 한 번 정답 미확정, `:51` 같은 날 반복 배제, `:80` 필수 차원, `:94` 전이, `:107` 재확인 필요, `:143` 결정론 + `students/[id]` 불확실성·증거수 표시 + `runner.spec.ts:44` |
| 48 | 성취기준→문항 추적 사슬 | ❌ | 사슬 6단계 중 문항→개념(`question_alignments`)만 존재. **성취기준 데이터 0건, 학습 목표·평가 증거·블루프린트 도메인이 앱에 없다.** 필요: 권위 데이터 적재(41) + 블루프린트 도메인 |
| 49 | 매핑 정정 영향 목록 | 🟡 | `graph.test.ts:135` 개념 폐기 영향 분석 함수 + `mastery_evidences` 불변 트리거(`0001a:225`)로 과거 덮어쓰기 차단. **정정 흐름·영향 목록 생성 코드 없음** |
| 50 | 릴리스 차이 계산 | ❌ | 추가·삭제·이동·분할·통합 diff 코드 0건. `route_versions.curriculum_release_id`로 게시 루트 고정만 존재. 필요: 릴리스 diff 엔진 + 마이그레이션 초안 생성 |
| 51 | 골든 코퍼스 렌더 무결 | ✅ | **배포 결손 발견·수리(2026-08-01)** — 골든 33건은 유효했으나 `katex.min.css`가 문항 상세·인쇄 레이아웃 2곳에만 import돼 있어 **학생 응시 화면(/learn)을 포함한 앱 대부분에서 수식이 두 번 보였다**(MathML이 숨겨지지 않음). 루트 레이아웃에서 로드하도록 고치고 하네스를 2층으로 신설: `apps/web/test/ui/katex-css.test.ts`(브라우저 없이)와 `e2e/tests/math-render.spec.ts`(렌더된 DOM의 **계산된 박스 크기**로 MathML 노출·이중 표시·katex-error·원시 LaTeX 유출 판정). CSS를 도로 빼서 하네스가 실제로 잡는 것까지 확인했다 |
| 52 | 정규화 멱등성·토큰 보존 | 🟡 | 멱등성(`pipeline.test.ts:132`)·JSON 백슬래시 손상(`:49`)·유니코드 기호(`:56`)·의미 토큰 속성(`:170`) 있음. **LaTeX-heavy 평문 전용 케이스 없음**(퍼즈만), 중첩 구분자는 `$A$$B$` 글루만, `NESTED_DOLLAR` 플래그는 push되지 않는 죽은 코드 |
| 53 | 단일 렌더 계약 | 🟡 | `math/mixed.ts:27` `renderMixedText()` 단일 진입점을 웹·인쇄·응시·문항 상세가 공유. 한글 혼합·5지선다 다행 수식은 검증(`pipeline.test.ts:234,227`). **원시 HTML 표는 escapeHtml이 차단해 경로 자체가 없고, SVG 도형은 `ExamPaper`가 출력하지 않는다** |
| 54 | expression_id 형식 간 유지 | 🟡 | `export/cross-format.ts` + 단위 테스트 12건(누락·불일치·초과). **프로덕션 호출부 0곳**이고 `math_expressions` 행 생성 코드가 없어 실제 3형식 대조가 일어나지 않는다 |
| 55 | HWP/HWPX 수식 조판 | 📋 | 자동 검증 89건 — `hwpx/writer.test.ts` 48(0폭 0건·height 1200/2400·baseLine 85·결정성), `hwpx/validate.test.ts` 26(ZIP·기준선·골든 3% 편차), `hwp/metrics.test.ts` 15(골든 84 실측 대비 MAPE 8%). **실제 한글 앱 재열기는 실환경 전용** — 표본 생성 스위치 `test/hwpx/emit-sample.test.ts`(`HWPX_SAMPLE_OUT`), 아직 미실시 |
| 56 | 폴백 금지·검수함 이동 | ✅ | `pipeline.test.ts:109` 미지원 명령 보고, `:116` 불균형 괄호 위치 보고, `:91` 빈 분모 자동 채우기 금지 + `hwpx/writer.test.ts:339-401` 미지원 시 빌드 전체 실패·원문 폴백 없음 + `ExamPaper.tsx:35` 인쇄 중단 + `e2e/export-pdf.mjs:25` + 반입의 게이트 실패 격리 |
| 57 | SVG·KaTeX 공격 격리 | 🟡 | KaTeX 측은 이중 방어 — 허용 목록 약 300개(`math/constants.ts:75`)에 href·url·includegraphics 미포함 + `trust`를 `\htmlClass` 하나로 제한, 테스트 `pipeline.test.ts:190`. **SVG 위생 처리 코드가 0줄**(`svgPath`·`sanitizeReport` 컬럼만 존재) |
| 58 | 렌더 해시 스냅샷 불변 | 🟡 | `math/render.ts:215`가 `stableHash(html + katexVersion())` 계산, 결정성 테스트(`pipeline.test.ts:140`)는 동일 프로세스 내 재현만 확인. **katex가 캐럿 범위(`^0.16.22`)라 패치 업그레이드만으로 기존 render_hash가 전부 바뀐다.** 과거 스냅샷 고정 코드·테스트 없음 |
| 59 | 수식 접근성 | 🟡 | MathML 동시 출력은 실제 검증됨(`output:"htmlAndMathml"`, `marketing.spec.ts:109` `.katex math` 존재). **대체 텍스트·200% 확대·고대비·스크린리더 검사 전부 없음**(`altText` 컬럼은 비어 있음) |
| 60 | ERP 없이 E2E 완주 | ✅ | 외부 연동 0건 상태에서 `full-loop.spec.ts`(응시→채점→복습→교사 확인) + `schedule.spec.ts`(일정 생성·멱등) + `assessment.spec.ts`(테스트 생성·배정) 통과, `teacher-app.spec.ts:64` "연결된 외부 시스템이 없습니다" 확인. 루트 생성도 이제 앱 안에서 완주한다(인수 3 ✅) |
| 61 | 외부 연동 필드 제한 | 🟡 | `integration_connections.allowed_fields` 컬럼 + 금지 필드가 스키마에 애초에 없음(`boundary-check.mjs`가 보장). **연동 어댑터 자체가 없어 거부·폐기 동작이 존재하지 않고**, `allowed_fields`에 대한 DB 제약도 없다 |
| 62 | 경계 회귀 빌드 실패 | ✅ | `pnpm build`가 boundary-check를 먼저 실행 — 검사 실패 시 빌드가 실제로 실패한다 (게이트 연결 완료·실행 검증). 금지 식별자 10종·카피 7종 + DB 측 잔존 검사(I-20) + E2E `marketing.spec.ts:22` |

---

## 남은 작업 우선순위

### 1순위 — 교육과정 권위 사슬 (인수 48·45·50·41·42의 공통 뿌리)

1. **권위 소스 실수집** — 교육부 고시·NCIC 원문 수집 스크립트(URL·체크섬 기록)와 성취기준 적재. 스키마·역추적 검사(I-16)·화면 구분 고지는 완비 — **데이터만 없다.** 이것이 풀리면 블루프린트 도메인(48), 수직 진행 화면(45), 릴리스 diff(50)가 차례로 열린다.

### 2순위 — 남은 안전장치·경로

2. **break-glass 2인 승인** (인수 28 완결) — 발급·만료 집행·회수·감사·소유자 고지는 끝났다(라이브 통합 16건 + 변이 검증 5종). 남은 것은 **승인자 수**: `operator_access_grants.approved_by`가 단수라 지금은 소유자 1인 승인이다. threat-model Q-11의 2인 승인을 지키려면 승인자 테이블(또는 `approvals jsonb`)이 필요하고, 그때 `grantState`의 `pending_approval` 분기가 실제로 쓰인다(지금은 방어적으로만 존재). 운영자 계정을 고르는 UI(현재 UUID 직접 입력)와 E2E도 함께.
3. **학습자 스코프 일정의 제품 배선** (인수 4 완결) — 계산·저장·검증은 끝났다(`domain/learner-schedule.ts`, 통합 21건). 남은 것은 **도달 경로**: ① 학생 상세에서 실체화를 실행하는 쓰기 액션, ② 학생 일정을 보여 주는 읽기 화면(반 공통과 다른 차시·재합류 차시 표시), ③ 오버라이드 생성·취소 시 자동 재계산(워커). 배선 전까지는 인수 4를 ✅로 올릴 수 없다.
4. **AI 모델 카나리 잔여** (인수 36 완결) — 레지스트리·섀도·승격 게이트·자동 중단은 끝났다(라이브 9건 + 변이 12종). 남은 것은 ① **섀도를 워커 큐로** — 지금은 사용자 요청 안에서 동기로 돌고 트래픽 100%에 붙어 AI 호출이 두 배다(샘플링 비율도 없다), ② 실공급자 어댑터(지금은 목 모델 두 버전 비교라 지연·비용이 실측이 아니다), ③ 운영 화면·E2E(현재 `pnpm ai-canary` CLI 전용), ④ 표본 20건을 실제로 쌓아 승격시키는 경로의 E2E.

### 3순위 — 검증 인프라 잔여 (인수 15·59)

5. **접근성 자동 검사** — axe 연동 + 교사 앱을 `visual-check.mjs` 대상에 추가 (모바일 내비·스킵 링크는 완료). ESLint·CI는 이번 구간에 신설됐다.
6. **워커 강제 종료 재개 자동 테스트** (인수 21 완결) — 체크포인트 로직은 연결됨, SIGKILL 리허설만 없다.
7. **과거 보존 통합 테스트** (인수 5 복구) — 과거·완료·잠금 세션을 만든 뒤 재실체화해 DB DELETE 가드가 실제로 지키는지 확인한다. 지금은 그 가드를 지워도 깨지는 테스트가 없다.
8. **회로 차단 실연 수단** (인수 23 복구) — 실패하는 목 공급자를 만들어 "공급자별 독립 차단"과 "실패 시 파일 uploaded 복귀"를 검증한다.
9. **런북 정정** (인수 35) — `docs/runbooks/14-deploy-migration-rollback.md`의 죽은 객체명·존재하지 않는 `*.down.sql` 서술을 사실에 맞게 고친다.

### 실환경 전용 (합의상 준비 완료 상태 유지)

- PITR 복원 리허설(33·34 — `verify-recovery` 하네스 완비), 부하 실행(38 — k6 스크립트 완비), 한글 앱 재열기(55 — 표본 생성 스위치 완비), SEV1 경보 파이프라인(40 — 안정화 도구 완비).
