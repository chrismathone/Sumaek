# RB-04 큐 적체·워커·DLQ

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (`realtime` 적체) / SEV2 (Outbox 적체) / SEV3 (DLQ 증가) |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 15분 미확인 → 담당자 / `realtime` 큐 30분 지속 → **SEV1 승격** + IC |
| 관련 SLO | O-08 접수 완료 작업 유실 0건 · O-03·O-04·O-05·O-06·O-07 전 비동기 SLO |
| 관련 kill switch | `ai_provider:<name>`, `document_export` (자원 회수용) |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-03·F-06·F-09 · [../phase0/event-catalog.md](../phase0/event-catalog.md) · [../adr/0006-transactional-outbox-inbox.md](../adr/0006-transactional-outbox-inbox.md) |

---

## 1. 탐지 조건

| 알림 | 메트릭 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `queue_wait_exceeded_realtime` | `sumaek_queue_oldest_wait_seconds{queue="realtime"}` | > 60 s | 5분 | **SEV2** |
| `queue_wait_exceeded` | 동일 (`schedule`·`render`·`ai`·`default`) | > 600 s | 10분 | SEV2 |
| `queue_depth_growth` | `sumaek_queue_depth{status="queued"}` 증가율 | 1시간 내 3배 | 1시간 | SEV3 |
| `outbox_backlog` | `sumaek_outbox_pending_age_seconds` | > 300 s | 5분 | SEV2 |
| `outbox_backlog_warn` | 동일 | > 60 s | 5분 | SEV3 |
| `outbox_failed` | `outbox_events.status='failed'` 건수 | > 0 | 5분 | SEV3 |
| `dlq_growth` | `jobs.status='dead_lettered'` 신규 | > 20건/시간 | 1시간 | SEV3 |
| `worker_heartbeat_lost` | 워커 heartbeat 미수신 | 60초 | — | SEV2 |
| `inbox_skipped_stale_rate` | `inbox_messages.outcome='skipped_stale'` 비율 | > 5% | 30분 | SEV3 |
| `job_orphaned` | `status='running' AND lease_until < now()` | > 50건 | 10분 | SEV3 |
| `grading_deadline_violation` | 제출 후 30분 경과 미채점 응시 | > 50건 | 10분 | **SEV2** |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| `realtime` 큐 적체 30분 이상 지속 (채점 마비) | **SEV1** |
| 시험 시간대 + `realtime` 큐 적체 | **SEV1** |
| 제출 후 30분 경과 미채점 > 50건 | **SEV2** |
| Outbox 적체 > 300초 (이벤트 사슬 정지) | **SEV2** |
| 워커 전면 중단 | **SEV2** |
| `schedule`·`render` 큐 적체 (SLO 위반) | SEV2 |
| `ai`·`default` 큐 적체 | SEV3 |
| DLQ 증가만, 처리량은 정상 | SEV3 |
| 고아 작업(lease 만료) 존재하나 재클레임 중 | SEV3 |

---

## 3. 즉시 중지할 기능

**적체 자체를 kill switch로 해결하지 않는다.** 자원 경쟁이 원인일 때만 저우선 큐를 끈다.

```bash
# realtime 큐를 살리기 위한 자원 회수 (우선순위 순)
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-04 realtime 큐 자원 회수" --actor <이메일>

pnpm --filter @su-maek/db kill-switch enable document_export \
  --reason "RB-04 Chromium CPU 회수" --actor <이메일>

pnpm --filter @su-maek/db kill-switch enable auto_schedule_recalc \
  --reason "RB-04 schedule 큐 자원 회수" --actor <이메일>
```

**중지해도 반드시 되는 것**:

- 답안 제출·저장 (web 경로. 워커와 무관)
- 자동 채점 (`realtime` 큐 — **절대 끄지 않는다**)
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

### 4-1. 큐 전반 상태

```sql
SELECT queue, status,
       count(*)                          AS jobs,
       max(now() - created_at)           AS oldest,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (now() - created_at)))::int AS p95_wait_s,
       count(DISTINCT organization_id)   AS orgs,
       avg(attempt_count)::numeric(4,2)  AS avg_attempts
FROM jobs
WHERE created_at > now() - interval '12 hours'
GROUP BY 1,2
ORDER BY 1,2;
```

### 4-2. 워커 상태 (고아 작업 = 워커 죽음 신호)

```sql
SELECT queue,
       locked_by,
       count(*)                              AS running,
       max(now() - lease_until)              AS lease_overdue,
       count(*) FILTER (WHERE lease_until < now()) AS orphaned
FROM jobs
WHERE status = 'running'
GROUP BY 1,2
ORDER BY orphaned DESC NULLS LAST;
```

```bash
pnpm --filter @su-maek/worker status
```

### 4-3. 조직별 점유 (공정 스케줄러 확인)

```sql
SELECT j.queue, j.organization_id,
       count(*) FILTER (WHERE j.status = 'running') AS running,
       count(*) FILTER (WHERE j.status = 'queued')  AS queued,
       round(100.0 * count(*) FILTER (WHERE j.status = 'running')
             / NULLIF(sum(count(*) FILTER (WHERE j.status = 'running')) OVER (PARTITION BY j.queue), 0), 1) AS pct_of_queue
FROM jobs j
WHERE j.status IN ('running','queued')
GROUP BY 1,2
ORDER BY running DESC NULLS LAST
LIMIT 30;
```

**`pct_of_queue`가 40%를 넘는 조직이 있으면 공정 스케줄러가 작동하지 않는 것이다.**

### 4-4. Outbox 적체

```sql
SELECT status,
       count(*)                        AS events,
       max(now() - created_at)         AS oldest,
       min(created_at)                 AS earliest,
       count(DISTINCT event_type)      AS event_types,
       avg(attempt_count)::numeric(4,2) AS avg_attempts
FROM outbox_events
WHERE status IN ('pending','failed')
GROUP BY 1;

-- 이벤트 타입별 적체
SELECT event_type, status, count(*), max(now() - created_at) AS oldest,
       max(last_error) AS sample_error
FROM outbox_events
WHERE status IN ('pending','failed') AND created_at > now() - interval '24 hours'
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;
```

### 4-5. 소비자별 처리 상태

```sql
SELECT consumer_name, outcome, count(*),
       max(processed_at) AS last_processed,
       now() - max(processed_at) AS since_last
FROM inbox_messages
WHERE processed_at > now() - interval '2 hours'
GROUP BY 1,2 ORDER BY 1,2;
```

**`since_last`가 10분을 넘는 소비자는 멈춘 것이다.**

### 4-6. DLQ 분석

```sql
SELECT queue, job_type,
       count(*)                         AS dead_lettered,
       count(*) FILTER (WHERE retryable) AS retryable,
       min(updated_at)                  AS earliest,
       max(updated_at)                  AS latest,
       (array_agg(last_error ORDER BY updated_at DESC))[1] AS sample_error
FROM jobs
WHERE status = 'dead_lettered'
  AND updated_at > now() - interval '7 days'
GROUP BY 1,2
ORDER BY dead_lettered DESC
LIMIT 30;
```

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
SELECT count(*) FILTER (WHERE state = 'active')              AS active,
       count(*) FILTER (WHERE state = 'idle in transaction')  AS idle_in_tx,
       count(*)                                              AS total
FROM pg_stat_activity WHERE datname = current_database();
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 4-1·4-2로 어느 큐·워커가 문제인지 특정 | 4장 | 3분 |
| 2 | 원인 분기 판단 (5.1) | — | 5분 |
| 3 | 원인별 조치 | 5.2~5.6 | 10~60분 |
| 4 | 고아 작업 재클레임 확인 | 5.3 | 5분 |
| 5 | 검증(6장) | — | 15분 |
| 6 | kill switch 해제 + 지터 | 5.7 | 3분 |

### 5.1 원인 분기

| 진단 | 원인 | 조치 |
|---|---|---|
| 4-2에서 `orphaned` > 0, `pnpm worker status` 응답 없음 | 워커 프로세스 사망 | 5.2 |
| 4-3에서 단일 조직 점유율 > 40% | 공정 스케줄러 미작동 또는 조직 한도 초과 | 5.4 |
| 4-1에서 `avg_attempts` 높고 `oldest` 증가 | 작업이 반복 실패 중 | 5.5 |
| 4-4에서 Outbox `pending` 증가, `failed` 0 | 릴레이 중단 | 5.6 |
| 4-4에서 `failed` 증가 | 특정 소비자 실패 | 5.6 |
| 4-8에서 `idle_in_tx` > 20 | DB 커넥션·잠금 문제 | [RB-05](./05-db-failure-pitr.md) |
| 처리량은 정상인데 유입이 급증 | 정상 부하 | 워커 증설 (5.2) |
| 4-6에서 DLQ 급증, 같은 `job_type` | 특정 작업 유형 버그 | 5.5 + 코드 수정 배포 |

### 5.2 워커 재시작·증설

```bash
# 상태 확인
pnpm --filter @su-maek/worker status

# 재시작 (배포 플랫폼 명령. 예)
# graceful: SIGTERM → 새 클레임 중단, 진행 작업 최대 120초 완료 대기
```

**증설 판단**:

| 큐 | 현재 | 증설 상한 | 근거 |
|---|---|---|---|
| `realtime` | 2 프로세스 | 6 | DB 커넥션 여유 |
| `render` | 2 (4 vCPU) | 4 | Chromium 메모리 |
| `ai` | 2 | 4 | 공급자 rate limit |
| `schedule` | 2 | 4 | lease 경합 |
| `default` | 2 | 4 | — |

증설 후 **DB 커넥션 총합이 180을 넘지 않는지** 확인한다(워커당 pool max 8).

### 5.3 고아 작업 재클레임

lease가 만료되면 자동으로 재클레임된다. **수동 개입은 lease가 비정상적으로 긴 경우에만.**

```sql
-- 확인
SELECT queue, count(*), max(now() - lease_until) AS overdue
FROM jobs WHERE status = 'running' AND lease_until < now()
GROUP BY 1;

-- lease가 2시간 이상 만료됐는데도 재클레임 안 되면 강제 해제
UPDATE jobs
SET status = 'queued', lease_until = NULL, locked_by = NULL,
    run_after = now() + (random() * interval '60 seconds'), updated_at = now()
WHERE status = 'running'
  AND lease_until < now() - interval '2 hours';
```

`attempt_count`는 이미 증가한 상태다. 멱등성 키가 중복 산출물을 막는다.

### 5.4 조직 점유 제한

```sql
-- 특정 조직의 대기 작업을 뒤로 미룸 (삭제하지 않는다)
UPDATE jobs
SET run_after = now() + interval '30 minutes', updated_at = now()
WHERE organization_id = $1
  AND queue IN ('ai','render','default')
  AND status = 'queued';
```

```sql
-- 조직 동시 실행 한도 하향
UPDATE organizations
SET quota = jsonb_set(quota, '{worker_concurrency,ai}', to_jsonb(1)),
    updated_at = now()
WHERE id = $1;
```

공정 스케줄러 자체가 작동하지 않으면(4-3에서 40% 초과) 클레임 쿼리의 `row_number() OVER (PARTITION BY organization_id)` 로직을 확인한다. 코드 버그면 배포 필요.

### 5.5 반복 실패 작업 정리

```sql
-- 반복 실패 원인 파악
SELECT job_type, last_error, count(*), max(attempt_count)
FROM jobs
WHERE status IN ('queued','running') AND attempt_count >= 3
  AND updated_at > now() - interval '2 hours'
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;

-- 회복 불가능한 작업을 DLQ로 (원인 기록 필수)
UPDATE jobs
SET status = 'dead_lettered',
    last_error = COALESCE(last_error, '') || ' | RB-04: 반복 실패로 DLQ 이관',
    retryable = false, updated_at = now()
WHERE id = ANY($1::uuid[]);
```

### 5.6 Outbox 릴레이 복구

```sql
-- 릴레이 lease 확인
SELECT count(*) FILTER (WHERE relay_lease_until > now()) AS leased,
       count(*) FILTER (WHERE relay_lease_until < now()) AS lease_expired,
       count(*)                                          AS total_pending
FROM outbox_events WHERE status = 'pending';

-- lease가 오래 만료됐는데 재배달이 안 되면 해제
UPDATE outbox_events
SET relay_lease_until = NULL, relay_holder = NULL, updated_at = now()
WHERE status = 'pending' AND relay_lease_until < now() - interval '10 minutes';

-- failed 이벤트를 재시도 대상으로 (원인 수정 후에만)
UPDATE outbox_events
SET status = 'pending', attempt_count = 0,
    next_attempt_at = now() + (random() * interval '300 seconds'), updated_at = now()
WHERE status = 'failed' AND id = ANY($1::uuid[]);
```

**소비자가 멱등하므로 재배달은 안전하다.** Inbox UNIQUE가 중복을 막는다.

특정 소비자만 멈췄다면 해당 핸들러 로그를 확인하고, 코드 문제면 배포 후 재배달한다.

### 5.7 DLQ 재처리

```bash
# 개별
curl -s -X POST "$BASE/api/v1/ops/dlq/$JOB_ID:reprocess" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)"
```

```sql
-- 일괄 (원인 수정 확인 후)
UPDATE jobs
SET status = 'queued', attempt_count = 0,
    run_after = now() + (random() * interval '600 seconds'),
    last_error = NULL, updated_at = now()
WHERE status = 'dead_lettered'
  AND retryable = true
  AND job_type = $1
  AND updated_at BETWEEN $2 AND $3;
```

**같은 멱등성 키를 유지하므로 중복 산출물이 생기지 않는다.** 재처리는 원 작업의 `organization_id` 컨텍스트로 실행된다.

### 5.8 kill switch 해제

```bash
pnpm --filter @su-maek/db kill-switch disable auto_schedule_recalc --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable document_export --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable ai_provider:anthropic --actor <이메일>
```

```sql
UPDATE jobs
SET run_after = now() + (random() * interval '900 seconds')
WHERE status = 'queued' AND queue IN ('ai','render','schedule','default');
```

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | `realtime` 큐 | 4-1 | `oldest` < 60초 |
| V-2 | 기타 큐 | 4-1 | `oldest` < 600초 |
| V-3 | 워커 정상 | 4-2 + `pnpm worker status` | `orphaned` 0, 전 워커 heartbeat 정상 |
| V-4 | 조직 공정성 | 4-3 | 단일 조직 `pct_of_queue` ≤ 40% |
| V-5 | Outbox | 4-4 | `pending` oldest < 60초, `failed` 0건 |
| V-6 | 소비자 | 4-5 | 전 소비자 `since_last` < 5분 |
| V-7 | 채점 지연 | 4-7 | **0행** |
| V-8 | 작업 유실 0 | 아래 쿼리 | **0행** |
| V-9 | 중복 산출물 없음 | 아래 쿼리 | **0행** |
| V-10 | 불변 조건 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-11 | 합성 모니터링 | SYN-1·SYN-2·SYN-3 | 전부 성공 |

```sql
-- V-8: 제출됐는데 채점 작업이 없는 응시
SELECT count(*) FROM attempts a
WHERE a.status = 'submitted' AND a.submitted_at > now() - interval '24 hours'
  AND NOT EXISTS (SELECT 1 FROM jobs j
                  WHERE j.organization_id = a.organization_id
                    AND j.job_type = 'grading.autograde'
                    AND j.idempotency_key = a.id::text);

-- V-9: 같은 멱등성 키로 성공한 작업이 2건 이상
SELECT organization_id, job_type, idempotency_key, count(*)
FROM jobs WHERE status = 'succeeded' AND updated_at > now() - interval '24 hours'
GROUP BY 1,2,3 HAVING count(*) > 1;
```

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
> {UTC 시각}부터 **{채점 / 시험 생성 / 문제집 반입 / 일정 재계산}** 처리가 평소보다 지연되고 있습니다.
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
> {UTC 시각}부로 모든 자동 처리가 정상 속도로 복구되었습니다.
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
- [ ] `realtime` 큐 우선순위(100)와 워커 배분이 실제로 채점을 보호했는가
- [ ] 공정 스케줄러 40% 상한이 작동했는가. 4-3 쿼리를 대시보드 패널로 추가했는가
- [ ] lease 기간(큐별 60~900초)이 적절했는가. 고아 작업이 많았다면 조정
- [ ] `queue_wait_exceeded` 임계값(realtime 60초)이 적절했는가
- [ ] Outbox 릴레이가 SPOF였다면 인스턴스를 늘렸는가
- [ ] DLQ 원인 상위 유형에 대해 코드 수정 또는 재시도 정책을 조정했는가
- [ ] 워커 증설 후 DB 커넥션 총합이 안전 범위인지 재계산했는가
- [ ] 유입 급증이 원인이면 용량 추정([../phase0/assumptions.md](../phase0/assumptions.md))을 갱신했는가
- [ ] 카오스 테스트 CH-01(워커 SIGKILL)·CH-02(중복 이벤트)로 재현 가능한가
