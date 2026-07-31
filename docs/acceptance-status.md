# 수맥(Su-Maek) — 인수 시나리오 62개 현재 상태

> 골프롬프트 31장 「최종 인수 시나리오」 62개에 대한 **정직한 회계**.
> 기준 시각: 2026-08-01 00:20 (커밋 `332ef1e`)
> 완료 기준: `docs/phase0/decisions.md` — "코드 완결 + 로컬 검증", 실환경 전용 항목은 스크립트·런북으로 갈음
>
> **이 문서의 존재 이유는 정직한 회계다.** 근거 없는 ✅는 없다. 확실하지 않은 것은 낮은 등급으로 적었다.

## 판정 분류

| 기호 | 뜻 | 개수 |
|---|---|---|
| ✅ | **검증됨** — 자동 테스트 또는 실행 검증이 존재하고 통과한다 | **17** |
| 🟡 | **구현됨·부분 검증** — 코드는 있으나 전용 테스트가 없거나 일부 조건만 만족한다 | **35** |
| 📋 | **준비됨** — 실환경 전용이라 스크립트·런북·어댑터로 준비했다 | **5** |
| ❌ | **미구현** — 아직 코드가 없다 | **5** |

## 총평

이전 회계의 최대 격차 두 갈래가 이번 구간에 크게 닫혔다. **"앱이 스스로 데이터를 만들 수 없다"**는 문장은 더 이상 사실이 아니다 — 반·학습자 등록(설정), 루트 작성·검증 게이트·게시(빌더), 일정 실체화, 불참·휴강 접수→재계산, 학생 오버라이드, 개인정보 삭제 요청까지 시드 없이 E2E 29건이 완주한다. **운영 안전장치**도 표시가 아닌 집행이 됐다: kill switch가 워커 클레임을 실제로 막고(작업은 큐에 보존), 일정 검증 실패는 이전 리비전을 유지하며, 낙관적 잠금이 VERSION_CONFLICT를 실제로 던지고, 회로 차단기·AI 비용 한도·DLQ 재처리·복구 검증 하네스(불변 29검사, 위반 0행)가 실DB에서 돈다.

남은 ❌ 5건은 전부 한 뿌리다 — **교육과정 권위 실데이터가 없다**(28 break-glass 집행 제외). 성취기준→개념→목표→증거→블루프린트 사슬(48), 수직 진행 화면(45), 릴리스 diff(50), 모델 카나리(36)는 권위 소스 수집(스키마·검사는 완비)이 선행 조건이다.

---

## 62개 시나리오 판정표

| # | 시나리오 요약 | 판정 | 근거·경로 |
|---|---|---|---|
| 1 | 랜딩 ERP 오인 없음 | ✅ | `e2e/tests/marketing.spec.ts:5,22` 「히어로 카피와 CTA」·「학원 ERP 오인 문구가 없다」 + `e2e/tests/smoke.spec.ts` + `scripts/boundary-check.mjs` 금지 카피 7종 |
| 2 | 데모 불참·점수 반영 | 🟡 | 마케팅 데모(`OrbitBoard.tsx`)는 여전히 미리 그린 SVG 토글. 다만 **실동작은 앱에서 검증됨** — 인수 5의 휴강 왕복 E2E가 같은 시나리오를 실DB로 완주한다. 데모를 실엔진에 연결하는 일만 남음 |
| 3 | 온보딩·첫 루트 게시 | ✅ | 시드 없이 완주하는 E2E 2건 — `roster.spec.ts`(기간→반→학습자 등록→목록·감사) + `route-builder.spec.ts`(반→노드 작성→검증 게이트→게시→일정 실체화). 마법사 형태의 안내 UI는 아니며 설정·빌더 화면 조합이다 |
| 4 | 반 공통·학생 독립 루트 | 🟡 | 학생 독립 루트 생성(빌더 `kind=learner_route`) + 학생 오버라이드 생성·격리·취소 E2E(`route-builder.spec.ts:125` — 반 일정 비영향 검증, 불변 4 트리거·검사 I-03·I-04 존재). **오버라이드를 소비하는 학습자 스코프 실체화는 미구현** — 엔진(`applyOverrides`)은 준비됨 |
| 5 | 불참 시 과거 보존 | ✅ | `availability.spec.ts` 휴강 왕복 — 접수→같은 트랜잭션 Outbox 발행→실체화가 날짜를 비우고 미래를 밈→무시(정정)→변경 최소화로 안정. 불참은 반 일정 비영향 E2E. 과거·잠금 불변은 엔진 단위(`engine.test.ts:118`) + 워커 재계산 연결 |
| 6 | 오늘 수업 화면 | 🟡 | `app/today/page.tsx` 실 DB 조회, `auth.spec.ts:31`은 **빈 상태만** 검증. 교재 범위·학생별 차이·숙제·예외 표시는 미검증이며 숙제 도메인 자체가 없음 |
| 7 | 검수·권한 통과 문항만 | 🟡 | `lib/domain/assessment.ts`가 `review_status='published' AND is_auto_assignable AND content_rights.status='usable'`로 풀을 좁힘 + `assessment/select.test.ts` 8건(선정 엔진). **제외되어야 할 문항이 실제로 제외되는 부정 케이스 테스트 없음** |
| 8 | 자동 채점·예외함 분기 | ✅ | `grading/grade.test.ts` 13건(동치·단위 불일치·모호·서술형 분기) + `e2e/tests/full-loop.spec.ts` + `runner.spec.ts` 3건 + `apps/web/test/integration/grading-exception.test.ts` |
| 9 | 예외 판정 후 일관 갱신 | 🟡 | `apps/web/test/integration/grading-exception.test.ts:103`이 점수·숙련도 갱신까지 검증. **복습·재시험·미래 일정 갱신은 미검증** |
| 10 | 확인테스트 분기·재합류 | 🟡 | `lib/domain/attempt.ts`에 확인테스트 재시험 계획 코드 존재. 전용 테스트 없고 보충 경로 분기·재합류 지점 지정은 미검증 |
| 11 | mathg-gen PDF 반입 | 🟡 | 반입 파이프라인 커밋·E2E 1건 + 회로 차단기·비용 한도 연결. 실 PDF 파싱이 아닌 결정론적 목이며 **도형(SVG) 보존 경로 없음** |
| 12 | 중복·출처불명 게시 차단 | 🟡 | 검수 상태·`is_auto_assignable`·권한 게이트는 존재. **중복 탐지 해시 컬럼·계산 코드 없음**(`duplicate_groups` 테이블은 빈 채로 존재), 정답 불일치 교차검증 없음 |
| 13 | 역할별 접근 제한 | ✅ | `authz/matrix.test.ts` 7건 + `packages/db/test/rls-isolation.test.ts` 9건 + `e2e/tests/auth.spec.ts` 3건 + 서버 액션 `canWrite()` 게이트 |
| 14 | 감사 로그 추적 | ✅ | `audit_events`에 actor·reason·rule_version·before/after 전부 존재(`schema/workspace.ts:250-274`), 불변 트리거(`0001a_rls_core.sql:211-223`), 쓰기 3경로, `e2e/tests/teacher-app.spec.ts:52` 자동·수동 기록 확인 |
| 15 | 360px~1440px·키보드 | 🟡 | 1024px 미만 메뉴 부재 해소 — details 디스클로저 내비(JS 없이 키보드 동작) + 스킵 링크, 390px E2E(`teacher-app.spec.ts:81`) 검증. **axe 자동 검사·라디오 포커스 표시·교사 앱 시각 회귀는 여전히 없음** |
| 16 | 재시도·중복·부분 실패 | 🟡 | 멱등 3종 동작: 큐 `jobs_idempotency_uq`, Inbox `(consumer,event_id)`, `assessments_idempotent_uq`. E2E 2건(`schedule.spec.ts` 재생성 동수, `assessment.spec.ts` 중복 생성 차단). **부분 실패·장시간 재접속 시나리오 미검증** |
| 17 | 빌드·린트·테스트 통과 | 🟡 | 빌드·타입검사·단위(≈351)·통합·E2E(19)·RLS(9) 통과. **린트는 실체가 없다** — ESLint 설정·의존성 0건이고 `next lint`는 Next 16에서 제거됨. **접근성 자동 검사 없음**(axe 0건) |
| 18 | 가짜 데이터·TODO 없음 | 🟡 | `TODO`/`FIXME` 문자열 0건, `/app/**` 하드코딩 데이터 0건(전부 실 DB). 빈 상태 CTA는 이제 실제 등록 폼(설정)과 빌더로 이어진다. "준비 중" 문구 2곳 잔존(reports·settings의 정책 편집·휴일 달력·교직원 초대) |
| 19 | 10회 중복 제출 1회 처리 | 🟡 | `lib/domain/attempt.ts:145-166` 조건부 UPDATE로 원자적 1회 전이 + 재제출 시 동일 결과 반환. **10회 동시 전송 부하 테스트 없음** |
| 20 | 동시 수정 충돌 표시 | 🟡 | `route_plans.lock_version` + 편집·게시 액션의 토큰 검증 — 불일치는 VERSION_CONFLICT로 명시 거부(마지막 저장이 조용히 이기지 않음), E2E가 낡은 토큰 조작으로 검증. **충돌 diff(양쪽 변경 비교) 화면은 없음** — 메시지·새로 고침 안내까지만 |
| 21 | 워커 종료 후 재개 | 🟡 | `checkpointJob()` 실사용 — 재계산 핸들러가 그룹 경계마다 기록하고, 회수된 작업은 완료 그룹을 건너뛴다(Inbox 중복 판정이 체크포인트를 재개로 해석). **프로세스 강제 종료 후 재개를 겨냥한 자동 테스트는 없음** |
| 22 | 리비전 검증 실패 시 이전 유지 | ✅ | 검증 게이트 — 배치 불가 충돌 시 세션 무변경·이전 활성 리비전 유지·실패 변경안만 기록. 라이브 DB 통합 2건(`schedule-gate.test.ts`): 슬롯 0 → 세션·리비전 0 + failed 기록 / 성공 일정 위 전 기간 휴강 → 리비전·세션 불변 |
| 23 | AI·OCR 장애 회로 차단 | ✅ | `CircuitBreaker`(closed→open 빠른 실패→half-open 시험→복귀, 타임아웃 포함) 주입 시계 단위 7건 + 반입 경로 실연결(실패 시 파일 uploaded 복귀 — extracting에 갇히지 않음). 공급자 이름별 독립 차단 |
| 24 | DLQ 이력·재처리 | 🟡 | `pnpm requeue-dlq` — --dry-run·topic/limit 필터·last_error 보존·감사 기록. 실행 검증됨(현재 DLQ 0건이라 재처리 실동작은 미확인). UI는 없음 |
| 25 | 골드셋 채점 정확도 | 🟡 | `grading/grade.test.ts:119` 모호한 답 미확정, `:101` 단위 불일치 예외함 이동 등 판정 규칙은 검증. **정확도 99.99% 목표를 측정하는 골드셋 하네스 없음**(SLO 문서에만 존재) |
| 26 | 저품질 AI 결과 유입 0건 | 🟡 | 출제 풀 필터에 `is_auto_assignable` + 권한 `usable` 조건 존재, 반입이 저신뢰(`confidence < 임계`)를 검수함으로 보냄 (I-07·I-13 검사가 상시 감시). **유입 0건을 지키는 회귀 테스트 없음** |
| 27 | 교차 테넌트 노출 0건 | 🟡 | `packages/db/test/rls-isolation.test.ts` 9건이 ID 직접 조회·WITH CHECK·학생 격리·인프라 테이블 차단까지 검증(격리 자체는 강함). **"시도가 감사된다"는 미구현**이고 캐시·검색·내보내기 표면은 존재하지 않음 |
| 28 | break-glass 사유·승인·만료 | ❌ | `operator_access_grants`에 reason·approved_by·expires_at **컬럼만** 존재(`schema/support.ts:161-179`). 만료 검사·발급·회수·감사 연결 코드 0건, UI 없음. 필요: 접근 발급·집행 미들웨어 |
| 29 | 악성 업로드·인젝션 격리 | 🟡 | MIME 화이트리스트·PDF 매직바이트·크기 상한·SHA256 중복 차단(`content/ingestion/actions.ts`). **압축 폭탄 방어 없음**, 프롬프트 인젝션은 주석상 원칙만(`ai/provider.ts:4-6`) |
| 30 | 사용권 중지 5분 내 반영 | ✅ | 교재 화면 중지(사유 필수)→같은 트랜잭션 `ContentRightsRevoked` 발행→워커 `content.rights-impact`가 영향 문항·열린 테스트 목록을 업무함에 전달(실DB 검증: 문항 8·테스트 1·알림 2). 신규 출제 제외는 풀 필터가 즉시 집행. E2E 중지→복구→감사. 5분 SLA "측정"은 실환경 몫 |
| 31 | 알림 공급자 중단 내성 | 🟡 | 앱 내부 알림은 `handlers/schedule.ts:72-148`이 `notifications` 테이블에 생성하며 오늘 할 일·배정과 독립. **외부 알림 공급자 어댑터가 아예 없어** 중단 시나리오 자체가 성립하지 않고, `notifications.group_key`에 유니크 인덱스가 없어 중복 방지도 미보장 |
| 32 | 캐시·검색 재구축 | 🟡 | `scripts/rebuild-read-models.mjs` 실동작 — 유일한 파생 읽기 모델(숙련도)을 증거+활성 정책에서 재생성, 이벤트 미발행(연쇄 방지), --dry-run 정합 검사. 실행 검증됨(동일 6건). **검색 인덱스·캐시 계층은 애초에 없음** — 재구축 대상이 생기면 확장 |
| 33 | DB 장애 후 유실 0·RTO | 📋 | 런북 + `scripts/verify-recovery.mjs` + `packages/db/src/checks/invariants.sql`(29검사) **실작성·실행 완료 — 현 DB 위반 0행**. PITR 복원 실훈련만 실환경 몫 |
| 34 | 백업 복구 검증 | 📋 | 검증 스크립트 결손 해소(33과 동일 하네스, RECOVERY_DATABASE_URL 대상 전환 지원). 실제 격리 복구 리허설은 실환경 몫 |
| 35 | 롤링 배포·스키마 되돌리기 | 📋 | `docs/runbooks/14-deploy-migration-rollback.md` + 멱등 마이그레이션 러너(`packages/db/src/migrate.ts`, 전 SQL `if not exists` 가드). 롤백 SQL은 런북 절차로만 존재 |
| 36 | AI 모델 카나리 승격 중단 | ❌ | 카나리·섀도·모델 평가 코드 0건. 필요: 모델 버전 레지스트리 + 정확도·지연·비용 게이트 |
| 37 | 조직 AI 비용 한도 | ✅ | `ai_usage_events`(가격표 버전 포함)·`ai_budgets` 신설. 판정 단위 6건 — 미설정=기록만, 80%=월 1회 업무함 경고, 100%=차단(반입이 추출 전 확인, 파일 uploaded 복귀). 목 공급자도 같은 경로로 기록. 설정 화면에 월 사용액 표시 |
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
| 51 | 골든 코퍼스 렌더 무결 | ✅ | `math/pipeline.test.ts` 골든 33건(유효 18·복구 10·검수 5) + `:205` 게시 렌더 폴백 금지 + `:211` katex-error·원시 LaTeX 0건 + E2E `marketing.spec.ts:100` + `e2e/visual-check.mjs`. **코퍼스 33건은 규모 확대가 필요하다** |
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

2. **break-glass 집행** (인수 28) — `operator_access_grants` 컬럼은 완비. 발급·만료 검사 미들웨어·소유자 고지·감사 연결.
3. **학습자 스코프 실체화** (인수 4 완결) — 오버라이드(`applyOverrides` 엔진 준비됨)를 소비하는 learner-scope 일정 계산. 반 공통과 병합·재합류 지점 처리.
4. **충돌 diff 화면** (인수 20 완결) — VERSION_CONFLICT 시 양쪽 변경 비교 표시 (현재는 메시지·새로 고침 안내).
5. **AI 모델 카나리** (인수 36) — 모델 버전 레지스트리 + 섀도 평가. 회로 차단기·비용 집계가 생겨 얹을 자리는 마련됨.

### 3순위 — 검증 인프라 잔여 (인수 17·15·59)

6. **ESLint 도입** — `pnpm lint`는 여전히 실체가 없다.
7. **접근성 자동 검사** — axe 연동 + 교사 앱을 `visual-check.mjs` 대상에 추가 (모바일 내비·스킵 링크는 완료).
8. **워커 강제 종료 재개 자동 테스트** (인수 21 완결) — 체크포인트 로직은 연결됨, SIGKILL 리허설만 없다.

### 실환경 전용 (합의상 준비 완료 상태 유지)

- PITR 복원 리허설(33·34 — `verify-recovery` 하네스 완비), 부하 실행(38 — k6 스크립트 완비), 한글 앱 재열기(55 — 표본 생성 스위치 완비), SEV1 경보 파이프라인(40 — 안정화 도구 완비).
