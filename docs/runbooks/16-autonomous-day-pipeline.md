# RB-16 자율 하루 파이프라인 — 학생 화면에 오늘이 뜨지 않는다

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (수업 당일 학생 다수) / SEV3 (한 반·다음 수업 전에 여유 있음) |
| 1차 담당 | 운영 엔지니어(OE). 원인이 콘텐츠·정책이면 교사·콘텐츠 담당 |
| 에스컬레이션 | 수업 시작 60분 전까지 미해결 → 담당 교사에게 통보(수동 대체 준비) |
| 관련 SLO | O-08 작업 유실 0건 · L-01 오늘 학습 지연 |
| 관련 kill switch | `auto_assessment_generation`, `auto_reschedule` |
| 관련 문서 | [04-queue-backlog-dlq.md](./04-queue-backlog-dlq.md) · [../adr/0018-daily-plan-projection-and-assessment-scheduler.md](../adr/0018-daily-plan-projection-and-assessment-scheduler.md) · [../adr/0017-learner-day-and-session-completion.md](../adr/0017-learner-day-and-session-completion.md) |

---

## 0. 이 런북이 다루는 것

RB-04는 **큐**를 본다: 작업이 쌓였는가, 워커가 사는가. 이 런북은 그 위층을
본다: **오늘 수업이 실제로 성립하는가.**

둘은 자주 어긋난다. 워커가 멀쩡히 살아 있고 큐도 비어 있는데 학생 화면에는
시험이 없는 경우가 있다 — 생성이 **정상적으로** 실패했을 때다(정책이 없거나
문항이 모자라거나). RB-04의 화면은 그때 전부 초록이다. 「이상 없음」과
「수업이 성립한다」는 다른 말이고, 그 차이를 메우려고 이 런북이 있다.

### 파이프라인 다섯 칸

한 칸이 막히면 그 뒤가 전부 멈춘다. 증상은 늘 맨 끝(학생 화면)에서 보이므로
**앞에서부터** 확인한다.

```
① 루트 게시    →  ② 일정 실체화  →  ③ 평가 생성   →  ④ 하루 투영    →  ⑤ 하루 완료
   route_versions    sessions          assessment_      learner_day_     learner_day_plans
   .status=published .status=planned   instances        plans            .completed_at
                                       (워커·주기 생산자) (학생 첫 열람)   (필수 전부 완료)
```

| 칸 | 누가 움직이나 | 안 움직이면 학생이 보는 것 |
|---|---|---|
| ① | 교사 (게시 버튼) | 「오늘은 배정된 학습이 없습니다」 |
| ② | 교사 (일정 생성) 또는 워커(`schedule.recalculate`) | 같음 |
| ③ | **워커** (주기 생산자 → `assessment.generate`) | 「오늘 시험이 아직 만들어지지 않았습니다」 |
| ④ | 학생 (오늘 화면 첫 열람) | 화면이 비거나 오류 |
| ⑤ | 자동 (필수를 다 마치면 재투영이 굳힌다) | 다 했는데 완료로 안 바뀜 |

---

## 1. 첫 명령 — 어디가 막혔는지 한 줄로

```bash
pnpm --filter @su-maek/worker status -- --flow
# 한 학원만:
pnpm --filter @su-maek/worker status -- --flow --org=<organization_id>
```

출력이 곧 분류다.

```
자율 하루 흐름 (2026-08-05 · 전체)

  평가 누락 2건 · 차단 학생 5명 · 미배달 이벤트 19건(최고령 29분)
    · 중2 정규 A — 확인테스트 (42분 뒤 시작)
    · 차단 5명 — assessment_not_generated

  [attention] 오늘 평가 노드 2건에 시험이 없습니다.
      → 생성이 실패했는지 먼저 봅니다: `pnpm queue:status`의 …
```

종료 코드는 이상이 있으면 1이다 — 모니터링에서 그대로 쓴다.

**아무것도 안 나오면** (`✓ 오늘 수업은 성립합니다`) 파이프라인은 정상이다.
그런데도 특정 학생이 못 본다면 그 학생 개인의 문제다 → 4장.

---

## 2. `[down] 살아 있는 워커가 없습니다`

**먼저 이것부터.** 워커가 없으면 ③·⑤가 전부 따라 멈추고, 아래의 다른 증상은
그 그림자다. 증상 셋을 각각 쫓지 말고 원인 하나를 고친다.

```bash
pnpm --filter @su-maek/worker start     # 또는 배포 환경의 프로세스 매니저
```

띄우면 **밀린 것부터 처리한다** — 유실은 없다(작업은 DB에 있다). 5분 뒤 다시
`--flow`를 돌려 남은 것이 있는지 본다.

자세한 절차는 [RB-04 5.2](./04-queue-backlog-dlq.md).

---

## 3. `[attention] 오늘 평가 노드 N건에 시험이 없습니다`

가장 흔한 증상이고, 원인이 넷으로 갈린다. 순서대로 배제한다.

### 3-1. 생성이 시도되기는 했나

```bash
pnpm queue:status
```

`assessment.generate` 줄을 본다.

| 보이는 것 | 뜻 | 다음 |
|---|---|---|
| 작업이 아예 없다 | 주기 생산자가 아직 안 돌았거나 창 밖이다 | 3-2 |
| `queued`로 쌓여 있다 | 워커가 못 집고 있다 | 2장 · kill switch 확인 |
| `failed_final`·`dead_lettered` | 생성이 **판단해서** 실패했다 | 3-3 |
| `succeeded`인데 평가가 없다 | 멱등 반환일 수 있다 | 3-4 |

### 3-2. 아직 창이 아니다 (정상일 수 있다)

생성은 **수업 24시간 전부터** 돈다(`ASSESSMENT_GENERATE_BEFORE_HOURS`).
모레 수업에 시험이 없는 것은 사고가 아니다 — `--flow`가 「N분 뒤 시작」을
함께 내는 이유가 그것이다. 음수(이미 시작)가 아니고 1,440분보다 크면 기다린다.

주기 생산자 간격은 기본 60초(`ASSESSMENT_PRODUCER_INTERVAL_MS`). 워커를 방금
띄웠다면 첫 회차는 즉시 돈다.

kill switch가 껐을 수도 있다:

```bash
pnpm kill-switch list | grep auto_assessment_generation
```

꺼져 있으면 생산자가 **작업을 만들지 않고 건너뛴다**(쌓아 두지 않는다 — 복구
순간에 몇백 건이 한꺼번에 도는 것을 막기 위해서다). 켜면 다음 회차부터 정상.

### 3-3. 생성이 판단해서 실패했다 — 사람이 고쳐야 낫는다

이 실패들은 **재시도로 낫지 않는다.** 그래서 재시도를 소모하지 않고 바로
최종 실패로 가고, E-17이 교사 업무함(`/app/inbox`)으로 간다.

| 사유 코드 | 무엇이 없나 | 고치는 곳 |
|---|---|---|
| `no_policy` | 이 반·목적에 적용할 평가 정책 | 반 설정 또는 학원 기본 정책 |
| `no_session` | 그날 예정된 수업 | 루트에서 일정 생성 (칸 ②) |
| `no_route` | 게시된 루트 (확인테스트의 단원 범위) | 루트 게시 (칸 ①) |
| `insufficient_questions` | 출제 가능한 문항 | 문항의 개념 정렬·검수·사용권 |
| `no_repeat_window` | 최근 안 쓴 문항 | 정책의 무반복 기간을 줄이거나 문항을 늘린다 |
| `difficulty_unsatisfiable` | 난이도 배분을 만족하는 조합 | 정책의 난이도 배분 |

사유를 확인한다:

```sql
select j.last_error, j.attempts, j.payload->>'planDate' as plan_date
from jobs j
where j.topic = 'assessment.generate' and j.status in ('failed_final','dead_lettered')
order by j.updated_at desc limit 20;
```

**고친 뒤 재실행**은 교사 화면(`/app/tests`의 재실행)이나:

```bash
pnpm requeue-dead-letters --topic=assessment.generate
```

재실행은 안전하다 — 생성은 멱등이고(작업 키 + 유니크 인덱스 + 「이미 있으면
그대로 반환」), 겹쳐 들어와도 하나만 만들어진다.

### 3-4. 만들어졌는데 학생에게 안 보인다

평가는 있는데 학생 화면의 그 **차시**가 여전히 막혀 있다면, 평가가 루트
노드에 연결되지 않은 것이다.

```sql
select id, title, scheduled_date, route_node_id
from assessment_instances
where learning_group_id = '<group>' and scheduled_date = current_date;
```

`route_node_id`가 NULL이면 그 평가는 노드에 붙지 못한다 — 학생 화면은 그
노드를 「예정된 평가가 아직 생성되지 않았습니다」로 막고, 같은 시험을 노드
없는 항목으로 한 번 더 낸다. **필수 항목이 막혀 있으므로 그 학생의 하루는
완료될 수 없다.**

교사가 화면에서 직접 만든 평가는 NULL이 정상이다(부른 노드가 없다). 워커가
만든 것이 NULL이면 결함이니 보고한다.

---

## 4. `[attention] 지금 할 수 없는 항목이 있는 학생 N명`

사유마다 고치러 갈 곳이 다르다. **화면에서 본다:**

```
/app/readiness?date=YYYY-MM-DD
```

학생별 사유와 「고치러 가기」 링크가 함께 나온다. 이 화면은 학생 화면과
**같은 투영기**를 계획을 남기지 않고 돌리므로, 여기서 보이는 것이 곧 그
학생이 로그인했을 때 만날 것이다.

| 사유 코드 | 뜻 | 고치는 곳 |
|---|---|---|
| `material_missing` | 개념 차시에 게시된 자료가 없다 | `/app/content/materials` |
| `no_questions` | 연습 자료의 문항이 0개 | `/app/content/questions` |
| `assessment_not_generated` | 3장으로 | `/app/tests` |
| `book_range_incomplete` | 교재·쪽 범위가 비었다 | 루트 빌더 |
| `homework_mode_missing` | 숙제 방식이 없다 | 루트 빌더 |
| `account_unlinked` | 로그인 계정이 없다 | `/app/students/accounts` |
| `rights_expired` | 교재 사용권 만료 | `/app/content/books` |

SQL로 세려면:

```sql
select i.blocked_reason, count(distinct p.learner_id) as learners
from learner_day_plan_items i
join learner_day_plans p on p.id = i.learner_day_plan_id
where p.plan_date = current_date and i.status = 'blocked'
group by 1 order by 2 desc;
```

---

## 5. `[attention] 배달되지 않은 이벤트 N건`

워커 생존을 먼저 본다(2장). 살아 있는데도 쌓이면 [RB-04 4-1·4-3](./04-queue-backlog-dlq.md).

**적체 자체는 위반이 아니다.** 워커가 잠깐 내려가면 쌓이고, 올라오면 빠진다.
나이를 함께 보는 이유가 그것이다 — 15분을 넘으면 그때부터 말한다.

---

## 6. 학생이 「다 했는데」 완료가 안 된다

하루 완료에는 **버튼이 없다.** 필수 항목을 전부 마치면 재투영이 완료로
굳힌다(ADR-0017). 그러니 「다 했다」와 「필수를 다 했다」가 다른 경우다.

```sql
select i.item_key, i.kind, i.required, i.status, i.blocked_reason
from learner_day_plan_items i
join learner_day_plans p on p.id = i.learner_day_plan_id
where p.learner_id = '<learner>' and p.plan_date = current_date
order by i.ordinal;
```

`required = true`인데 `completed`가 아닌 항목이 답이다. 대개 `blocked`이고,
그러면 4장으로 간다.

**완료를 손으로 만들지 않는다.** `learner_day_plans.completed_at`은 설정 후
변경할 수 없고(I-22, DB 트리거), 잘못 넣으면 되돌릴 방법이 없다. 원인을
고치면 학생이 화면을 여는 순간 재투영이 완료를 기록한다.

교사가 완료를 **취소**해야 하는 경우(잘못 완료된 하루)는 학생 상세 화면의
「완료 취소」를 쓴다 — `reopened_at`을 남기며 내려간다.

---

## 7. 확인 (V)

| # | 확인 | 방법 | 기대 |
|---|---|---|---|
| V-1 | 흐름 정상 | `pnpm --filter @su-maek/worker status -- --flow` | `✓ 오늘 수업은 성립합니다` · 종료 코드 0 |
| V-2 | 워커 생존 | 같은 명령의 위쪽 | 살아 있는 워커 ≥ 1 |
| V-3 | 큐 위생 | `pnpm queue:status` | DLQ 증가 없음 |
| V-4 | 학생 화면 | 대상 반 학생 하나로 `/learn/today` | 단계가 보이고 막힘 없음 |
| V-5 | 불변 조건 | `pnpm verify:recovery` | 검사 31건 전부 0행 |

V-5는 사고 처리 **후에** 돌린다. 동시성 결함은 지연 그래프가 아니라 불변
조건 위반으로 드러난다.

---

## 8. 이 런북이 못 하는 것

정직하게 적어 둔다.

- **자동 복구는 없다.** 위 명령은 전부 진단이고, 고치는 것은 사람이다.
  자동 재실행을 붙이지 않은 이유는 3-3의 실패들이 재시도로 낫지 않기
  때문이다 — 재시도를 돌리면 같은 실패를 반복하며 로그만 늘어난다.
- **`--flow`는 오늘만 본다.** 내일 수업의 결손을 미리 보려면
  `/app/readiness?date=`로 날짜를 넘긴다.
- **알림이 자동으로 가지 않는다.** E-17(생성 실패)은 교사 업무함으로 가지만,
  「차단 학생 5명」은 아무에게도 안 간다. 지금은 사람이 이 명령을 돌려야
  안다.
