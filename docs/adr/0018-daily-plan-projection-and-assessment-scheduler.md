# ADR-0018 — 하루 계획 투영과 평가 자동 생성 스케줄러

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-08-04) |
| 결정자 | 수맥 팀 |
| 관련 | `docs/planning/06-tasks.md` T0.2 · [ADR-0017](./0017-learner-day-and-session-completion.md) · `docs/phase0/erd.md` §2 · `docs/phase0/event-catalog.md` E-16·E-17 · `packages/db/src/domain/learner-schedule.ts` |

---

## 맥락

ADR-0017이 "학습자 하루 완료"를 제품 개념으로 정의했다. 이제 그것을 **어디에 어떻게 저장하는지**가 남았고, 여기에 두 개의 함정이 있다.

**함정 1 — 학생별 날짜 투영은 이미 존재한다.** `learner_schedule_items`(`packages/db/src/schema/instruction.ts:269`)가 학생 1명 × 날짜 1일 × 노드 목록을 이미 저장한다. `packages/db/src/domain/learner-schedule.ts`가 이 테이블로 오버라이드·재합류·과거 보존을 지킨다. 이걸 모르고 `learner_day_plans`를 만들면 **같은 질문에 답하는 테이블이 둘**이 되고, ADR-0017이 내건 "단일 진실"이 첫 마이그레이션에서 깨진다.

**함정 2 — 평가 생성은 지금 교사 버튼뿐이다.** `apps/worker/src/registry.ts:27-39`에 등록된 핸들러는 `schedule.*`, `notification.dispatch`, `content.rights-impact`가 전부다. `assessment.*`가 없다. 그런데 `docs/phase0/event-catalog.md` §1.2 소비자 등록부에는 `assessment-generator`가 이미 **설계상 존재하는 것으로** 적혀 있다. 설계와 코드가 어긋난 채로 있었다.

## 결정

### 1. 3층으로 나눈다 — ②를 ③으로 대체하지 않는다

| 층 | 테이블 | 답하는 질문 | 성질 |
|---|---|---|---|
| ① 반 계획 | `sessions` | 이 반은 언제 어떤 노드를 하나 | 엔진 산출물 · 재계산 가능 (완료·잠금 제외) |
| ② 학생 계획 | `learner_schedule_items` | 이 학생은 언제 어떤 노드를 하나 | 엔진 산출물 · 재계산 가능 (과거·완료 보존) |
| ③ 학생 실행 | `learner_day_plans` + `_items` | 이 학생이 오늘 **무엇을** 하고 **끝냈나** | 스냅샷 · 완료 이력 불변 |

**②와 ③을 한 테이블에 합치지 않는 이유**는 두 층의 요구가 정면으로 부딪히기 때문이다. ②는 일정이 바뀔 때마다 **덮어써야** 한다(엔진 결정론 — `I-12`). ③은 완료 이력이 **절대 역행하면 안 된다**(`I-22`). 한 테이블에 두면 재계산할 때마다 "덮어써도 되는 행"과 "건드리면 안 되는 행"을 런타임에 구분해야 하고, 그 구분이 틀리는 순간 학생의 완료 기록이 사라진다.

**②는 노드까지만 안다.** `planned_node_ids`가 전부다. 노드 하나가 자료 3개 + 일일테스트 1개 + 숙제 1개로 펼쳐지는 규칙은 ②에 없다. 그 펼치기가 ③이고, 규칙이 노드 실행기(T2.2)다.

**③의 입력 우선순위**는 지금 `apps/web/src/app/learn/today/page.tsx:273-289`가 쓰는 규칙을 그대로 승격한다.

```
learner_schedule_items(오늘) 이 있으면  → 그것
없으면                                  → sessions(오늘) ∩ 내가 속한 반
둘 다 없으면                            → 복습만 (있으면), 없으면 empty
```

`②가 있으면 ①을 섞지 않는다.` 개인 오버라이드가 있는 학생에게 반 공통 노드를 덧붙이면 그 학생이 건너뛰기로 뺀 노드가 되살아난다.

### 2. 스키마

```
learner_day_plans
  id                  uuid PK
  organization_id     uuid NOT NULL
  learner_id          uuid NOT NULL
  plan_date           date NOT NULL          -- KST 조직 날짜
  timezone            text NOT NULL          -- I-14: 시간대 ID 병행 보존
  learning_group_id   uuid                   -- null 가능 (복습만 있는 날)
  source              text NOT NULL          -- learner_schedule | group_session | review_only
  source_ref_id       uuid                   -- learner_schedule_items.id | sessions.id
  status              text NOT NULL          -- not_started | in_progress | blocked | completed
  materialized_at     timestamptz NOT NULL   -- 학생이 그날 처음 연 시각 (ADR-0017 §4)
  completed_at        timestamptz            -- 설정 후 불변 (I-22)
  reopened_at         timestamptz            -- 교사 완료 취소. completed_at은 지우지 않는다
  reopened_by         uuid
  reopen_reason       text
  projection_hash     text NOT NULL          -- 결정론 검증 (I-12 계열)
  created_at/updated_at

  UNIQUE (organization_id, learner_id, plan_date)
  INDEX (organization_id, plan_date, status)          -- 교사 현황판 (T4.4)
  INDEX (organization_id, learning_group_id, plan_date)

learner_day_plan_items
  id                       uuid PK
  organization_id          uuid NOT NULL
  learner_day_plan_id      uuid NOT NULL FK
  ordinal                  integer NOT NULL       -- 학생 화면 순서
  kind                     text NOT NULL          -- reading | video | practice | assessment
                                                  --  | review | book_range | homework
  required                 boolean NOT NULL
  route_node_id            uuid                   -- 어느 노드에서 나왔나 (null = 복습)
  ref_type                 text                   -- learning_material | assessment_instance | review_batch
  ref_id                   uuid
  title_snapshot           text NOT NULL          -- 그날 학생이 본 문구를 보존
  status                   text NOT NULL          -- pending | in_progress | completed | blocked | exempted
  blocked_reason           text                   -- 준비도 게이트와 같은 코드 레지스트리 (T2.4)
  completed_at             timestamptz
  added_after_materialization boolean NOT NULL DEFAULT false
  created_at/updated_at

  UNIQUE (learner_day_plan_id, kind, ref_id)       -- 멱등 재투영의 핵심
  INDEX (learner_day_plan_id, ordinal)
```

`title_snapshot`이 필요한 이유: 자료 제목이 나중에 바뀌어도 그날의 기록은 학생이 실제로 본 문구여야 한다. `I-08`(게시 스냅샷)과 같은 성질이다.

`added_after_materialization`이 필요한 이유: ADR-0017 §4의 "확정 후 추가분은 선택"을 **데이터로 남겨야** 교사가 "왜 이건 선택이지?"를 물었을 때 답할 수 있다.

**RLS**: 두 테이블 모두 `organization_id NOT NULL` + `*_tenant_isolation` PERMISSIVE + `*_role_gate` RESTRICTIVE (`I-01` 규약 그대로). 학생은 자기 `learner_id` 행만, 교사는 담당 반 스코프(T5.3)만.

### 3. 재투영 규칙 — 완료된 것은 건드리지 않는다

②가 재계산되거나 자료가 바뀌면 ③을 다시 투영한다. 병합 규칙:

| 계획 상태 | 처리 |
|---|---|
| `completed` | **아무것도 하지 않는다.** 재투영 대상에서 제외 |
| 그 밖 | 항목 단위로 아래 병합 |

| 항목 상황 | 처리 |
|---|---|
| 새 투영에 있고 기존에도 있음 · 기존이 `completed`/`in_progress` | **보존** (상태·`completed_at` 유지) |
| 새 투영에 있고 기존에도 있음 · 기존이 `pending`/`blocked` | 갱신 (`title_snapshot`·`required`·`blocked_reason` 재계산) |
| 새 투영에만 있음 · `materialized_at` 이후 | `required=false`, `added_after_materialization=true`로 추가 |
| 기존에만 있음 · `pending` | 삭제 |
| 기존에만 있음 · 그 밖 | `exempted`로 전환 (**삭제하지 않는다** — 학생이 이미 손댄 기록이다) |

재투영은 `UNIQUE (learner_day_plan_id, kind, ref_id)` 위의 UPSERT라 **몇 번을 돌려도 행이 늘지 않는다.**

### 4. 이벤트는 둘만 추가한다 — 작업과 이벤트를 구분한다

T0.2의 원안은 `LearnerDayCompleted`, `DailyAssessmentGenerationRequested`, `DailyAssessmentGenerationFailed` **셋**을 요구했다. 그중 하나를 뺀다.

| 원안 | 결정 | 이유 |
|---|---|---|
| `LearnerDayCompleted` | **E-16으로 추가** | ③의 완료를 나르는 유일한 경로 |
| `DailyAssessmentGenerationRequested` | **추가하지 않는다** | 이건 이벤트가 아니라 **작업**이다. `jobs` 테이블의 `assessment.generate` 행이 이미 "요청됐다"는 사실과 멱등 키·재시도 횟수·상태를 전부 담는다. 이벤트를 따로 두면 같은 사실이 두 곳에 남고 둘이 어긋날 수 있다 |
| `DailyAssessmentGenerationFailed` | **E-17로 추가** | 실패는 `jobs`에만 남으면 교사에게 닿지 않는다. `notifier` 소비자가 필요하다 |

**성공은 새 이벤트가 필요 없다.** 생성이 성공하면 이미 있는 E-04 `AssessmentPublished`가 발행된다.

### 5. 워커의 due-session 발견과 멱등 키

```
주기 생산자 (loop.ts, 기본 60초):
  대상  sessions
         where status = 'planned'
           and session_date between today and today + lookahead_days
           and planned_node_ids 에 daily_test | confirmation_test 노드가 있음
  시점  노드의 generate_before_hours (없으면 평가 정책 기본값) 만큼
        수업 시작 전에 도달했을 때
  발행  job  assessment.generate
        키   (organization_id, learning_group_id, plan_date, purpose)
```

**멱등은 두 겹이다.**
1. `jobs`의 dedupe 키가 같은 작업의 중복 enqueue를 막는다.
2. `assessment_instances`의 `UNIQUE (organization_id, learning_group_id, scheduled_date, purpose)`가 작업이 중복 실행돼도 평가가 둘 생기는 것을 막는다 — 이 유니크는 `apps/web/src/lib/domain/assessment.ts`가 이미 전제하고 있다.

한 겹으로 줄이지 않는 이유: ①만 있으면 워커 재시작 중 claim된 작업이 다시 돌 때 평가가 둘 생긴다. ②만 있으면 중복 작업이 매번 DB까지 가서 충돌하고 실패 로그를 남긴다.

**kill switch**: 기존 `kill_switches` 메커니즘을 그대로 쓴다. 꺼져 있는 동안 생산자는 작업을 만들지 **않고**, 이미 만들어진 작업은 `pending`으로 남아 재개 후 실행된다(작업을 버리지 않는다).

**생성 시점의 신선도**: 평가 생성은 **작업이 실행되는 시점의** 숙련도·복습을 읽는다. 학기 초에 미리 계산해 두지 않는다 — 그래야 T3.3의 "학기 초 미리 누른 결과가 아니라 생성 시점의 숙련도를 사용함"이 성립한다.

### 6. 백필하지 않는다

배포된 조직에 이미 학생·수업·응시 기록이 있다. 그럼에도 **과거 날짜의 `learner_day_plans`를 만들지 않는다.**

근거: 과거 하루의 "완주 여부"는 지금 어디에도 기록돼 있지 않다. 응시·진도 기록에서 역산하면 그건 **추정치**인데, `completed_at`은 불변이고 `LearnerDayCompleted`는 소비자에게 흘러간다. 추정치를 불변 사실로 굳혀서 숙련도 엔진에 흘려보내는 것이 백필의 실제 의미다.

- 투영은 **마이그레이션 적용일 이후** 학생이 처음 `/learn/today`를 여는 날부터 시작한다.
- 그 이전 날짜를 조회하면 `empty`가 아니라 **`no_record`**(기록 이전)로 구분해 표시한다. 교사 현황판이 "안 했다"와 "기록이 없다"를 섞지 않게 한다.
- **롤백**은 두 테이블 DROP으로 끝난다. 기존 테이블을 하나도 바꾸지 않기 때문이다 — 이것이 3층 분리의 실무적 이득이다.

### 7. `/learn/records`는 그대로 둔다

`apps/web/src/lib/learn/record-days.ts`가 응시·진도 이력으로 지난 기록을 낸다. 이걸 하루 계획 기반으로 바꾸지 않는다 — §6 때문에 마이그레이션 이전 날짜에는 계획이 없고, 바꾸면 학생의 지난 기록이 통째로 사라져 보인다.

대신 **경계를 명확히 한다.**

| 화면 | 읽는 것 | 답하는 질문 |
|---|---|---|
| `/learn/today` 등 오늘 화면 | `learner_day_plans` | 오늘 무엇을 하고 끝냈나 |
| `/learn/records` | 응시·진도 이력 | 그동안 무엇을 했나 |
| `/learn/records`의 **하루 완주 뱃지** | `learner_day_plans.status` | 그날 완주했나 |

"그날 완주했나"의 답은 계획층에만 있다. 이력에서 역산하지 않는다.

노드 이름은 지금처럼 `apps/web/src/lib/learn/node-titles.ts` 한 곳에서 푼다.

## 결과

### 이 결정이 막는 것

- 학생별 날짜 투영이 둘이 되는 일 (§1)
- 재계산이 학생의 완료 기록을 지우는 일 (§3)
- 같은 사실이 `jobs`와 `outbox_events`에 따로 남아 어긋나는 일 (§4)
- 워커 재시작이 평가를 둘 만드는 일 (§5)
- 추정한 과거 완료가 불변 사실로 굳어 숙련도에 흘러드는 일 (§6)
- 마이그레이션 이전 날짜가 "안 했다"로 보이는 일 (§6)

### 후속 태스크에 넘기는 것

| 항목 | 태스크 |
|---|---|
| 테이블·마이그레이션·RLS·불변 트리거 | T1.2 (`0016a_learner_day_plans.sql`) |
| `invariants.sql`에 I-21·I-22 추가 | T1.2 |
| 투영기 구현과 90일 제거 | T1.3 |
| 노드 → 항목 펼치기 규칙 | T2.2 |
| `blocked_reason` 코드 레지스트리 | T2.4 |
| 워커 생산자·핸들러 | T3.2 |
| `no_record` 표시 | T4.4 |

### 열어 둔 것

- **`lookahead_days`·`generate_before_hours` 기본값**은 T3.2의 운영 파라미터로 넘긴다. 수업 하루 전 생성이 출발점이다.
- **보존 정책**: 하루 계획은 학습 이력이므로 `course_periods` 보존 정책을 따른다. 구체적 기간은 `docs/phase0/erd.md` §10.2에 T1.2가 채운다.
