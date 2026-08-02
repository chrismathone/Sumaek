# RB-04 큐 적체·워커·DLQ

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (실시간 채점 적체) / SEV2 (Outbox 적체) / SEV3 (DLQ 증가) |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 15분 미확인 → 담당자 / 실시간 채점 적체 30분 지속 → **SEV1 승격** + IC |
| 관련 SLO | O-08 접수 완료 작업 유실 0건 · O-03·O-04·O-05·O-06·O-07 전 비동기 SLO |
| 관련 kill switch | `ai_provider:<name>`, `document_export` (자원 회수용) |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-03·F-06·F-09 · [../phase0/event-catalog.md](../phase0/event-catalog.md) · [../adr/0006-transactional-outbox-inbox.md](../adr/0006-transactional-outbox-inbox.md) |

---

## 0. 이 런북의 어휘 = 실제 스키마

**「큐」라는 컬럼은 없다.** 아래가 실제 이름이다. 여기 없는 이름이 본문에
나오면 그건 결함이니 고쳐라 (예전 판에는 `queue`·`locked_by`·`lease_until`·
`attempt_count`·`job_type`·`inbox_messages`·`relay_lease_until`이 있었고
**전부 존재하지 않는 컬럼**이라 4·5·6장이 통째로 실행 불가였다).

| 개념 | 실제 위치 | 비고 |
|---|---|---|
| 큐 | `jobs.topic` | `schedule.recalculate`, `notification.dispatch` 등 |
| 우선순위 | `jobs.priority` | 낮을수록 먼저. 실시간 채점 10, 기본 100 |
| 워커 소유 | `jobs.worker_id` | |
| 리스 | `jobs.lease_expires_at` | 만료되면 다른 워커가 회수 |
| 시도 수 | `jobs.attempts` / `jobs.max_attempts` | |
| 실패 사유 | `jobs.last_error` | **jobs에만 있다** |
| 작업 상태 | `jobs.status` | queued · running · waiting_review · succeeded · failed_retryable · retry_scheduled · failed_final · dead_lettered · cancel_requested · cancelled |
| Outbox 상태 | `outbox_events.status` | pending · delivering · delivered · failed |
| Outbox 재시도 | `outbox_events.attempts` / `next_attempt_at` | `delivering` 동안 next_attempt_at이 리스 만료 시각이다 |
| Outbox 실패 사유 | **없다** | 컬럼이 없다. 이유는 워커 로그와 코드에서 찾는다 (아래 4-4) |
| 소비자 처리 기록 | `inbox_events` (consumer_name, event_id, processed_at) | `outcome` 컬럼 없음 |
| 워커 생존 | `worker_heartbeats` | 마이그레이션 0011a. 없으면 `pnpm worker:status`가 그렇다고 말한다 |

**Outbox 격리**: `status='failed' AND attempts >= 8`. 디스패처가 **다시 집지
않는다**. 이 상태가 곧 이벤트 사슬의 정지다 — 사람이 `pnpm requeue-outbox`로
되살려야 한다. 한도는 `OUTBOX_MAX_ATTEMPTS`(기본 8) 환경변수.

운영 명령 세 개면 대부분 끝난다:

```bash
pnpm worker:status    # 워커가 살아 있는가
pnpm queue:status     # 무엇이 얼마나 밀렸는가 (jobs·outbox·inbox·박동)
pnpm verify:recovery  # 불변 조건 위반이 있는가 (R-04 이벤트 사슬 포함)
```

---

## 1. 탐지 조건

| 알림 | 근거 질의·메트릭 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `queue_wait_exceeded_realtime` | 4-1 실시간 채점 대기(`priority <= 10`) | > 60 s | 5분 | **SEV2** |
| `queue_wait_exceeded` | 4-1 나머지 토픽 대기 | > 600 s | 10분 | SEV2 |
| `queue_depth_growth` | 4-1 `queued` 건수 증가율 | 1시간 내 3배 | 1시간 | SEV3 |
| `outbox_backlog` | 4-4 `pending` 최고령 | > 300 s | 5분 | SEV2 |
| `outbox_backlog_warn` | 동일 | > 60 s | 5분 | SEV3 |
| `outbox_failed` | 4-4 `status='failed'` 건수 | > 0 | 5분 | SEV3 |
| `outbox_quarantined` | 4-4 `status='failed' AND attempts >= 8` | > 0 | 5분 | **SEV2** |
| `dlq_growth` | 4-6 `status='dead_lettered'` 신규 | > 20건/시간 | 1시간 | SEV3 |
| `worker_heartbeat_lost` | 4-2 `now() - last_beat_at > 3 × beat_interval_seconds` | — | — | SEV2 |
| `job_orphaned` | 4-2 `status='running' AND lease_expires_at < now()` | > 50건 | 10분 | SEV3 |
| `grading_deadline_violation` | 4-7 제출 후 30분 경과 미채점 | > 50건 | 10분 | **SEV2** |

`outbox_quarantined`가 SEV2인 이유: 격리는 **자동 복구되지 않는다.** 다른
적체는 워커가 따라잡으면 사라지지만 이건 사람이 손대기 전까지 영원히 그대로다.

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 실시간 채점 적체 30분 이상 지속 (채점 마비) | **SEV1** |
| 시험 시간대 + 실시간 채점 적체 | **SEV1** |
| 제출 후 30분 경과 미채점 > 50건 | **SEV2** |
| Outbox 적체 > 300초 (이벤트 사슬 정지) | **SEV2** |
| Outbox 격리 발생 (자동 복구 불가) | **SEV2** |
| 워커 전면 중단 | **SEV2** |
| `schedule`·`render` 토픽 적체 (SLO 위반) | SEV2 |
| `ai`·기본 토픽 적체 | SEV3 |
| DLQ 증가만, 처리량은 정상 | SEV3 |
| 고아 작업(lease 만료) 존재하나 재클레임 중 | SEV3 |

---

## 3. 즉시 중지할 기능

**적체 자체를 kill switch로 해결하지 않는다.** 자원 경쟁이 원인일 때만 저우선
토픽을 끈다.

```bash
# 실시간 채점을 살리기 위한 자원 회수 (우선순위 순)
pnpm kill-switch stop ai_provider:anthropic \
  --reason "RB-04 실시간 채점 자원 회수" --actor <이메일>

pnpm kill-switch stop document_export \
  --reason "RB-04 Chromium CPU 회수" --actor <이메일>

pnpm kill-switch stop auto_reschedule \
  --reason "RB-04 일정 토픽 자원 회수" --actor <이메일>
```

표준 동사는 **stop / resume**이다 (`enable`은 설정 화면과 정반대 뜻이라
CLI가 경고한다 — packages/db/scripts/kill-switch.mts).

> `document_export`는 지금 **아무것도 멈추지 않는다.** 매핑된 토픽
> `export.pdf`·`export.hwpx`에 핸들러도 발행부도 없다(렌더러
> `apps/worker/src/export/pdf-renderer.ts`는 있으나 배선되지 않았다).
> 자원 회수 목적으로 이 스위치를 끄고 "이제 CPU가 돌아온다"고 기대하지 마라.
> 근거와 현황: `apps/worker/src/registry.ts`의 `TOPICS_WITHOUT_HANDLER`.

**중지해도 반드시 되는 것**:

- 답안 제출·저장 (web 경로. 워커와 무관)
- 자동 채점 (**절대 끄지 않는다**)
- 수동 채점·예외 처리
- 오늘 운영실·일정·문제은행 조회
- 온라인 응시 전체
- 이미 생성된 산출물 다운로드

**절대 하지 않는 것**:

- `auto_grading` kill switch — 채점이 밀리면 후속 SLO가 연쇄로 무너진다
- `jobs` 행 삭제 — 접수된 작업의 유실은 SLO O-08 위반
- `outbox_events` 행 삭제 — 이벤트 사슬이 영구 끊긴다

---

## 4. 진단

먼저 `pnpm queue:status` 하나로 4-1·4-2·4-4·4-5를 한 화면에 본다. 아래
SQL은 그보다 자세히 보거나 psql만 있는 상황을 위한 것이다.

### 4-1. 큐 전반 상태

```sql
SELECT j.topic,
       j.status,
       count(*)                                  AS jobs,
       max(now() - j.created_at)                 AS oldest,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (now() - j.created_at)))::int AS p95_wait_s,
       count(DISTINCT j.organization_id)         AS orgs,
       round(avg(j.attempts), 2)                 AS avg_attempts
FROM jobs j
WHERE j.created_at > now() - interval '12 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

```sql
-- 실시간 채점(priority <= 10)만 따로. 이것이 SEV1 판정선이다
SELECT count(*) FILTER (WHERE status IN ('queued', 'retry_scheduled'))         AS waiting,
       max(now() - run_at) FILTER (WHERE status IN ('queued', 'retry_scheduled')) AS oldest_wait,
       count(*) FILTER (WHERE status = 'running')                              AS running
FROM jobs
WHERE priority <= 10;
```

### 4-2. 워커 상태

```bash
pnpm worker:status          # = pnpm --filter @su-maek/worker status
```

살아 있는 워커가 없거나 박동이 끊긴 워커가 있으면 **종료 코드 1**이다.
박동 테이블(0011a)이 아직 적용되지 않았으면 그렇다고 말하고 1로 끝난다 —
그 상태에서는 아래 고아 작업 질의가 유일한 신호다.

```sql
-- 박동 (마이그레이션 0011a 적용 후에만 존재한다)
SELECT worker_id, hostname, pid,
       now() - last_beat_at            AS since_last_beat,
       beat_interval_seconds,
       stopped_at, stop_reason,
       last_result
FROM worker_heartbeats
ORDER BY last_beat_at DESC;
```

`stopped_at`이 차 있으면 **정상 종료**다(사건이 아니다). `stopped_at`이 비어
있는데 `since_last_beat`가 `beat_interval_seconds`의 3배를 넘으면 죽은 것이다.

```sql
-- 고아 작업 = 워커가 죽었다는 간접 신호 (박동 없이도 보인다)
SELECT topic,
       worker_id,
       count(*)                                            AS running,
       max(now() - lease_expires_at)                       AS lease_overdue,
       count(*) FILTER (WHERE lease_expires_at < now())    AS orphaned
FROM jobs
WHERE status = 'running'
GROUP BY 1, 2
ORDER BY orphaned DESC NULLS LAST;
```

### 4-3. 조직별 점유 (공정 스케줄러 확인)

```sql
SELECT j.topic, j.organization_id,
       count(*) FILTER (WHERE j.status = 'running')                       AS running,
       count(*) FILTER (WHERE j.status IN ('queued', 'retry_scheduled'))  AS queued,
       round(100.0 * count(*) FILTER (WHERE j.status = 'running')
             / NULLIF(sum(count(*) FILTER (WHERE j.status = 'running'))
                      OVER (PARTITION BY j.topic), 0), 1)                 AS pct_of_topic
FROM jobs j
WHERE j.status IN ('running', 'queued', 'retry_scheduled')
GROUP BY 1, 2
ORDER BY running DESC NULLS LAST
LIMIT 30;
```

**`pct_of_topic`이 40%를 넘는 조직이 있으면 공정 스케줄러가 작동하지 않는 것이다.**
집행 지점은 `claimJobs`의 `maxPerOrganization`(기본 4, packages/db/src/queue.ts)이다.

### 4-4. Outbox 적체

```sql
SELECT status,
       count(*)                                                      AS events,
       count(*) FILTER (WHERE status = 'failed' AND attempts >= 8)    AS quarantined,
       count(*) FILTER (WHERE next_attempt_at <= now())               AS due_now,
       max(now() - created_at)                                        AS oldest,
       min(created_at)                                                AS earliest,
       count(DISTINCT event_type)                                     AS event_types,
       round(avg(attempts), 2)                                        AS avg_attempts
FROM outbox_events
WHERE status <> 'delivered'
GROUP BY 1;
```

```sql
-- 이벤트 타입별 적체
SELECT event_type, status, count(*),
       max(now() - created_at) AS oldest,
       max(attempts)           AS max_attempts
FROM outbox_events
WHERE status <> 'delivered'
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 20;
```

**`last_error` 컬럼은 없다.** 실패 이유는 두 곳에서 찾는다:

1. **워커 로그** — `[outbox:transient]` / `[outbox:routing_gap]` 줄에 이벤트 ID와
   사유가 그대로 찍힌다.
2. **코드** — `attempts`가 한 번에 8로 뛰었으면 라우팅 결손이다(재시도해도
   낫지 않아 즉시 격리한다). `packages/db/src/queue.ts`의 `EVENT_CONSUMERS`에
   그 `event_type`이 있는지 보면 끝난다. `pnpm queue:status`가
   「← 라우팅표에 없음」으로 표시해 준다.

### 4-5. 소비자별 처리 상태

```sql
SELECT consumer_name,
       count(*) FILTER (WHERE processed_at > now() - interval '2 hours') AS last_2h,
       count(*)                                                          AS total,
       max(processed_at)                                                 AS last_processed,
       now() - max(processed_at)                                         AS since_last
FROM inbox_events
GROUP BY 1
ORDER BY 1;
```

**`since_last`가 10분을 넘는 소비자는 멈춘 것이다** — 단, 그 이벤트가 애초에
발행되지 않는 중이면 정상이다. 4-4의 `event_type`별 적체와 함께 본다.

### 4-6. DLQ 분석

```sql
SELECT topic,
       status,
       count(*)                                            AS jobs,
       min(updated_at)                                     AS earliest,
       max(updated_at)                                     AS latest,
       max(attempts)                                       AS max_attempts_seen,
       (array_agg(last_error ORDER BY updated_at DESC))[1] AS sample_error
FROM jobs
WHERE status IN ('dead_lettered', 'failed_final')
  AND updated_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY jobs DESC
LIMIT 30;
```

`dead_lettered` = 재시도를 다 쓰고 죽었다(다시 넣으면 될 수도 있다).
`failed_final` = 재시도 불가로 판정됐다(코드가 바뀌기 전에는 다시 넣어도 소용없다).

### 4-7. 채점 지연 (사용자 영향 직결)

```sql
SELECT a.organization_id,
       count(*)                                          AS ungraded,
       max(now() - a.submitted_at)                       AS worst_delay,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (now() - a.submitted_at)))::int AS p95_delay_s
FROM attempts a
WHERE a.status = 'submitted'
  AND a.submitted_at < now() - interval '30 minutes'
GROUP BY 1
ORDER BY ungraded DESC
LIMIT 20;
```

### 4-8. DB 자원 (적체 원인이 DB일 때)

```sql
SELECT count(*) FILTER (WHERE state = 'active')             AS active,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
       count(*)                                             AS total
FROM pg_stat_activity WHERE datname = current_database();
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 4-1·4-2로 어느 토픽·워커가 문제인지 특정 | 4장 | 3분 |
| 2 | 원인 분기 판단 (5.1) | — | 5분 |
| 3 | 원인별 조치 | 5.2~5.7 | 10~60분 |
| 4 | 고아 작업 재클레임 확인 | 5.3 | 5분 |
| 5 | 검증(6장) | — | 15분 |
| 6 | kill switch 해제 + 지터 | 5.8 | 3분 |

### 5.1 원인 분기

| 진단 | 원인 | 조치 |
|---|---|---|
| `pnpm worker:status`가 「박동 끊김」·「박동 기록 없음」 | 워커 프로세스 사망·미기동 | 5.2 |
| 4-2에서 `orphaned` > 0인데 박동은 정상 | 이전 세대 워커가 죽었다 (자동 회수 중) | 5.3 |
| 4-3에서 단일 조직 점유율 > 40% | 공정 스케줄러 미작동 또는 조직 한도 초과 | 5.4 |
| 4-1에서 `avg_attempts` 높고 `oldest` 증가 | 작업이 반복 실패 중 | 5.5 |
| 4-4에서 `pending` 증가, `failed` 0 | 디스패처 중단 = 워커가 안 돈다 | 5.2 |
| 4-4에서 `failed`(격리 아님) 증가 | 작업 삽입이 일시적으로 실패 중 (DB 압박 등) | 5.6 |
| 4-4에서 `quarantined` > 0 | 라우팅 결손 또는 반복 실패 — **자동 복구 안 됨** | 5.6 |
| 4-4에서 `delivering`이 오래 남아 있음 | 디스패치 도중 워커 사망 (리스 만료 후 자동 회수) | 5.6 |
| 4-8에서 `idle_in_tx` > 20 | DB 커넥션·잠금 문제 | [RB-05](./05-db-failure-pitr.md) |
| 처리량은 정상인데 유입이 급증 | 정상 부하 | 워커 증설 (5.2) |
| 4-6에서 DLQ 급증, 같은 `topic` | 특정 작업 유형 버그 | 5.5 + 코드 수정 배포 |

### 5.2 워커 기동·재시작·증설

```bash
pnpm worker:status            # 먼저 확인
```

**로컬·개발**

```bash
pnpm dev:all                  # 웹 + 워커를 함께 띄운다 (한쪽이 죽으면 둘 다 내린다)
pnpm dev:worker               # 워커만
```

**배포**

워커는 요청이 없어도 계속 도는 프로세스라 웹과 같은 곳에 얹을 수 없다.
배포 단위는 `apps/worker/Dockerfile`이다.

```bash
docker build -f apps/worker/Dockerfile -t su-maek-worker .   # 컨텍스트는 저장소 루트
docker run -d --env-file .env --restart unless-stopped su-maek-worker
```

- 재시작은 컨테이너 재시작이다. `SIGTERM` → 새 클레임 중단 → 진행 중 작업
  완료 대기 → 종료(기본 유예 30초, `WORKER_SHUTDOWN_GRACE_MS`). 유예를 넘기면
  강제 종료되고 남은 작업은 lease 만료로 다른 워커가 회수한다(유실 0).
- 두 번째 `SIGTERM`은 "지금 당장"이다 — 즉시 종료한다.
- 정상 종료는 `worker_heartbeats.stopped_at`에 남는다. 그 표시가 없는 침묵은
  비정상 종료다.

**증설 판단**: 프로세스를 더 띄우면 된다(같은 이미지, 같은 DB).

| 대상 | 현재 | 증설 상한 | 근거 |
|---|---|---|---|
| 실시간 채점(priority 10) | 2 프로세스 | 6 | DB 커넥션 여유 |
| 렌더·출력 | 2 (4 vCPU) | 4 | Chromium 메모리 |
| AI·OCR | 2 | 4 | 공급자 rate limit |
| 일정 | 2 | 4 | lease 경합 |

지금은 한 프로세스가 모든 토픽을 처리한다(`WORKER_CONCURRENCY`, 기본 4).
토픽별 분리 배포는 아직 없다 — 증설은 전체 프로세스 수를 늘리는 것이다.
증설 후 **DB 커넥션 총합이 180을 넘지 않는지** 확인한다(워커당 pool max 4).

### 5.3 고아 작업 재클레임

lease가 만료되면 자동으로 재클레임된다. **수동 개입은 lease가 비정상적으로
긴 경우에만.**

```sql
-- 확인
SELECT topic, count(*), max(now() - lease_expires_at) AS overdue
FROM jobs
WHERE status = 'running' AND lease_expires_at < now()
GROUP BY 1;
```

```sql
-- lease가 2시간 이상 만료됐는데도 재클레임 안 되면 강제 해제
UPDATE jobs
SET status = 'queued',
    lease_expires_at = NULL,
    worker_id = NULL,
    run_at = now() + (random() * interval '60 seconds'),
    updated_at = now()
WHERE status = 'running'
  AND lease_expires_at < now() - interval '2 hours';
```

`attempts`는 이미 증가한 상태다. 멱등성 키가 중복 산출물을 막는다.

### 5.4 조직 점유 제한

```sql
-- 특정 조직의 대기 작업을 뒤로 미룸 (삭제하지 않는다)
UPDATE jobs
SET run_at = now() + interval '30 minutes',
    updated_at = now()
WHERE organization_id = $1
  AND status IN ('queued', 'retry_scheduled')
  AND priority > 10;          -- 실시간 채점은 미루지 않는다
```

**조직별 동시 실행 한도를 DB에서 바꿀 수 없다.** `organizations`에 quota
컬럼이 없다 — 한도는 `claimJobs`의 `maxPerOrganization`(기본 4)이고 코드 상수다.
낮추려면 배포가 필요하다. 지금 할 수 있는 것은 위처럼 그 조직 작업을 미루는
것뿐이다.

공정 스케줄러 자체가 작동하지 않으면(4-3에서 40% 초과) `claimJobs`의 조직별
누적 로직을 확인한다(packages/db/src/queue.ts). 코드 버그면 배포 필요.

### 5.5 반복 실패 작업 정리

```sql
-- 반복 실패 원인 파악
SELECT topic, last_error, count(*), max(attempts) AS max_attempts_seen
FROM jobs
WHERE status IN ('queued', 'running', 'retry_scheduled')
  AND attempts >= 3
  AND updated_at > now() - interval '2 hours'
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 20;
```

```sql
-- 회복 불가능한 작업을 DLQ로 (원인 기록 필수)
UPDATE jobs
SET status = 'dead_lettered',
    last_error = COALESCE(last_error, '') || ' | RB-04: 반복 실패로 DLQ 이관',
    updated_at = now()
WHERE id = ANY($1::uuid[]);
```

### 5.6 Outbox 복구

```sql
-- 지금 이벤트 사슬이 어디서 멈췄는가
SELECT count(*) FILTER (WHERE status = 'pending')                            AS pending,
       count(*) FILTER (WHERE status = 'delivering' AND next_attempt_at > now())  AS in_flight,
       count(*) FILTER (WHERE status = 'delivering' AND next_attempt_at <= now()) AS lease_expired,
       count(*) FILTER (WHERE status = 'failed' AND attempts < 8)            AS retrying,
       count(*) FILTER (WHERE status = 'failed' AND attempts >= 8)           AS quarantined
FROM outbox_events
WHERE status <> 'delivered';
```

- `pending`만 쌓인다 → 디스패처가 안 돈다. **워커를 띄우면 된다** (5.2).
  손으로 상태를 건드릴 것이 없다.
- `lease_expired`가 있다 → 디스패치 도중 워커가 죽었다. 다음 디스패처가
  그대로 회수한다. **수동 개입 불필요** (예전 판의 `relay_lease_until` 해제
  SQL은 존재하지 않는 컬럼을 건드리려 했다).
- `retrying` → 백오프 중이다. 기다린다.
- `quarantined` → **자동 복구되지 않는다.** 아래로 되살린다.

```bash
pnpm requeue-outbox --dry-run                        # 무엇이 격리됐는지 먼저 본다
pnpm requeue-outbox --event-type ContentRightsRevoked \
  --reason "RB-04 소비자 수정 배포 후" --actor <이메일>
```

dry-run은 **지금 코드에서도 라우팅 결손인 이벤트**를 따로 경고한다. 그 경고가
남아 있는 채로 되살리면 같은 자리에서 다시 격리된다 — 먼저 `EVENT_CONSUMERS`에
소비자를 넣거나 `EVENT_WITHOUT_CONSUMER`에 근거를 적고 배포해야 한다.

SQL로 직접 해야 한다면(도구를 못 쓰는 상황):

```sql
UPDATE outbox_events
SET status = 'pending',
    attempts = 0,
    next_attempt_at = now() + (random() * interval '300 seconds')
WHERE status = 'failed'
  AND id = ANY($1::uuid[]);
```

**소비자가 멱등하므로 재배달은 안전하다.** Inbox의 (consumer_name, event_id)
기본키와 작업 멱등성 키 `{topic}:{event_id}`가 중복을 막는다.

### 5.7 DLQ 재처리

```bash
pnpm requeue-dlq --dry-run                       # 먼저 대상 확인
pnpm requeue-dlq --topic notification.dispatch --limit 50 \
  --reason "RB-04 공급자 복구 후" --actor <이메일>
```

`attempts`를 0으로 되돌리고 `run_at`에 0~600초 지터를 준다. `last_error`와
`payload`는 남긴다(왜 죽었는지가 유일한 단서다). 감사 기록은
`audit_events.action='ops.requeue_dlq'`.

**REST 엔드포인트는 없다.** 예전 판의 `POST /api/v1/ops/dlq/…:reprocess`는
존재한 적이 없다 — `apps/web`에 `api/` 라우트 자체가 없다.

SQL로 직접 해야 한다면:

```sql
UPDATE jobs
SET status = 'queued',
    attempts = 0,
    worker_id = NULL,
    lease_expires_at = NULL,
    run_at = now() + (random() * interval '600 seconds'),
    updated_at = now()
WHERE status = 'dead_lettered'
  AND topic = $1
  AND updated_at BETWEEN $2 AND $3;
```

**같은 멱등성 키를 유지하므로 중복 산출물이 생기지 않는다.**

### 5.8 kill switch 해제

```bash
pnpm kill-switch resume auto_reschedule --actor <이메일>
pnpm kill-switch resume document_export --actor <이메일>
pnpm kill-switch resume ai_provider:anthropic --actor <이메일>
```

```sql
-- 한꺼번에 몰리지 않게 지터를 준다 (실시간 채점은 건드리지 않는다)
UPDATE jobs
SET run_at = now() + (random() * interval '900 seconds'),
    updated_at = now()
WHERE status IN ('queued', 'retry_scheduled')
  AND priority > 10;
```

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | 실시간 채점 대기 | 4-1 두 번째 질의 | `oldest_wait` < 60초 |
| V-2 | 기타 토픽 대기 | 4-1 | `oldest` < 600초 |
| V-3 | 워커 정상 | `pnpm worker:status` | 종료 코드 0, 「박동 끊김」 0명 |
| V-4 | 조직 공정성 | 4-3 | 단일 조직 `pct_of_topic` ≤ 40% |
| V-5 | Outbox | 4-4 | `pending` 최고령 < 60초, `quarantined` 0건 |
| V-6 | 소비자 | 4-5 | 발행이 있는 소비자의 `since_last` < 5분 |
| V-7 | 채점 지연 | 4-7 | **0행** |
| V-8 | 이벤트 유실 0 | 아래 두 질의 | **0행** |
| V-9 | 중복 산출물 없음 | 아래 질의 | **0행** |
| V-10 | 불변 조건 | `pnpm verify:recovery` (R-04 포함) | 전부 0행 |
| V-11 | 합성 모니터링 | SYN-1·SYN-2·SYN-3 | 전부 성공 |

```sql
-- V-8a: 아무도 다시 집지 않는 격리 이벤트 (사슬이 여기서 끊긴다)
SELECT event_type, count(*), min(created_at) AS earliest
FROM outbox_events
WHERE status = 'failed' AND attempts >= 8
GROUP BY 1
ORDER BY 2 DESC;

-- V-8b: 배달됐다고 표시됐는데 소비자 작업이 없는 이벤트
--       (전수 검사는 invariants.sql R-04 = pnpm verify:recovery)
SELECT e.event_type, count(*) AS delivered_without_job
FROM outbox_events e
WHERE e.status = 'delivered'
  AND e.delivered_at > now() - interval '24 hours'
  AND e.event_type NOT IN ('RenderArtifactValidated', 'CurriculumReleasePublished')
  AND NOT EXISTS (
    SELECT 1 FROM jobs j WHERE j.idempotency_key LIKE '%:' || e.id::text
  )
GROUP BY 1;

-- V-9: 같은 멱등성 키로 성공한 작업이 2건 이상
SELECT organization_id, topic, idempotency_key, count(*)
FROM jobs
WHERE status = 'succeeded'
  AND idempotency_key IS NOT NULL
  AND updated_at > now() - interval '24 hours'
GROUP BY 1, 2, 3
HAVING count(*) > 1;
```

V-8b의 제외 목록은 `EVENT_WITHOUT_CONSUMER`(packages/db/src/queue.ts) —
**소비자를 두지 않기로 선언한** 이벤트다. 작업 0건으로 배달되는 것이 정상인
유일한 경우이고, 선언되지 않은 미매핑 이벤트는 배달되지 않고 격리된다.

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 채점 지연 30분 초과 + 시험 시간대 | **필수** |
| 반입 처리 4시간 초과 (RTO) | **필수** (영향 조직) |
| 일정 재계산 지연 1시간 초과 | **필수** (영향 조직) |
| 작업 유실 확인 | **필수** + 법률 검토 |
| 자체 복구 30분 이내 | 불필요 |
| DLQ 증가만 | 불필요 |

### 초기 공지

> **[수맥] 자동 처리 지연 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {시각}부터 **{채점 / 시험 생성 / 문제집 반입 / 일정 재계산}** 처리가 평소보다 지연되고 있습니다.
>
> - 현재 대기: {N}건
> - 예상 처리 완료: {시각}
> - **접수된 작업은 유실되지 않습니다.** 순차적으로 처리됩니다.
>
> **정상 사용 가능한 기능**
> - 학생 시험 응시와 답안 제출
> - 오늘 수업 운영과 진도 기록
> - 기존 일정·성적·문제은행 조회
> - 교사의 수동 채점
>
> **지금 하실 일**
> - 채점 결과가 늦어도 학생 응시는 정상 진행하실 수 있습니다.
> - 오늘 안에 결과가 꼭 필요하시면 수동 채점을 이용해 주세요.
>
> 다음 안내: {시각}

### 해소 공지

> **[수맥] 자동 처리 지연 해소 안내**
>
> {시각}부로 모든 자동 처리가 정상 속도로 복구되었습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 지연 시간 | {시작} ~ {종료} (총 {N}분) |
> | 대기했던 작업 | {N}건 |
> | **유실된 작업** | **0건** |
> | 중복 처리 | 없음 |
>
> 지연 기간에 접수된 작업은 모두 처리 완료되었습니다. 채점 결과와 시험 생성 상태를 확인해 주세요.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 접수 완료 작업의 유실 확인 (V-8 위반) | **필요** | SLO 명시 위반. 계약상 책임 |
| 채점 지연으로 학사 일정에 실질 피해 | **필요** | 조직 손해 주장 가능 |
| DLQ 재처리 과정에서 중복 성적 반영 | **필요** | 성적 정정 절차 |
| 단순 지연, 유실·중복 없음 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성
- [ ] **워커가 왜 안 떠 있었는가** — 배포된 적이 없는가, 죽었는데 아무도 몰랐는가.
      후자면 박동 알림(`worker_heartbeat_lost`)이 실제로 울렸는지 확인한다
- [ ] 실시간 채점 우선순위(10)와 워커 배분이 실제로 채점을 보호했는가
- [ ] 공정 스케줄러 40% 상한이 작동했는가. 4-3 쿼리를 대시보드 패널로 추가했는가
- [ ] lease 기간(기본 300초)이 적절했는가. 고아 작업이 많았다면 조정
- [ ] Outbox 격리가 발생했다면 그 `event_type`의 라우팅을 코드에서 고쳤는가
- [ ] `OUTBOX_MAX_ATTEMPTS`(기본 8)가 적절했는가 — 너무 작으면 일시적 장애가 격리로 굳는다
- [ ] DLQ 원인 상위 유형에 대해 코드 수정 또는 재시도 정책을 조정했는가
- [ ] 워커 증설 후 DB 커넥션 총합이 안전 범위인지 재계산했는가
- [ ] 유입 급증이 원인이면 용량 추정([../phase0/assumptions.md](../phase0/assumptions.md))을 갱신했는가
- [ ] 카오스 테스트 CH-01(워커 SIGKILL)·CH-02(중복 이벤트)로 재현 가능한가
