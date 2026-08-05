# RB-01 시험 시작·제출 장애

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 5분 미확인 → IC 자동 호출 / 15분 진전 없음 → 도메인 소유자(응시·채점) 소집 / 30분 → 고객 공지 |
| 관련 SLO | O-02 시험 시간대 시작·제출 99.95% · L-02 제출 접수 p95 1초/p99 2.5초 · O-08 접수 완료 작업 유실 0건 |
| 관련 kill switch | **없음.** 이 런북의 목표는 기능을 끄는 것이 아니라 **유지**하는 것이다 |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-17 · [../phase0/sequences.md](../phase0/sequences.md) S-4 · [../phase0/slo.md](../phase0/slo.md) |

---

## 1. 탐지 조건

| 알림 | 메트릭 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `exam_submit_failure_spike` | `sumaek_api_requests_total{route="/api/v1/attempts/:id:submit",outcome="server_error"}` 비율 | > 0.05% | 5분 (최소 100건) | SEV1 |
| `exam_start_failure_spike` | `sumaek_api_requests_total{route="/api/v1/attempts",outcome="server_error"}` 비율 | > 0.05% | 5분 (최소 100건) | SEV1 |
| `submit_latency_breach` | `sumaek_api_duration_seconds{route=".../:submit"}` p95 | > 1.0 s | 10분 | SEV2 |
| `submit_latency_breach_p99` | 동일 p99 | > 2.5 s | 10분 | SEV2 |
| `snapshot_checksum_failure` | `SNAPSHOT_ASSET_CHECKSUM_MISMATCH` 응답 수 | > 5건 | 5분 | SEV1 |
| `SYN-1` 합성 모니터링 | 시험 제출 왕복 (응시 시작 → 답안 3건 → 제출 → 채점) | 실패 2회 연속 또는 > 60초 | 5분 주기 | SEV1 |
| 사용자 신고 | 교사 문의 "학생이 제출을 못 한다" | 2건 이상 | 15분 | SEV1 |

**시험 시간대 판정**: `assessment_instances.opens_at <= now() <= closes_at`인 인스턴스가 1건 이상 존재.

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 시험 시간대 + 제출 실패율 > 0.05% | **SEV1** |
| 시험 시간대 + 시작 실패율 > 0.05% | **SEV1** |
| 제출 성공 응답 후 `attempts.status` 미전환 확인 (유실 의심) | **SEV1** (즉시 IC + 경영진) |
| 시험 시간대 아님 + 제출 실패율 > 0.5% | SEV2 |
| 제출 p95 > 1초, 실패율 정상 | SEV2 |
| 단일 조직만 영향 + 우회 가능(마감 연장) | SEV2 |
| 특정 문항만 렌더 실패, 나머지 정상 | SEV3 (→ [RB-10](./10-formula-render-rollback.md) 병행) |

---

## 3. 즉시 중지할 기능

**이 런북에서는 kill switch를 켜지 않는다.** 시험 시작·제출은 어떤 상황에서도 유지되어야 하는 최상위 기능이다.

부하 경감이 필요하면 **낮은 우선순위부터** 끈다.

```bash
# 1순위: AI 반입 중단 (render·ai 큐가 DB·CPU를 점유하고 있을 때)
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-01 SEV1 부하 경감" --actor <이메일>

# 2순위: 문서 출력 중단 (Chromium CPU 회수)
pnpm --filter @su-maek/db kill-switch enable document_export \
  --reason "RB-01 SEV1 부하 경감" --actor <이메일>

# 3순위: 자동 일정 재계산 중단 (schedule 큐 회수)
pnpm --filter @su-maek/db kill-switch enable auto_reschedule \
  --reason "RB-01 SEV1 부하 경감" --actor <이메일>
```

**중지해도 반드시 유지되어야 하는 것**:

- 시험 시작(`POST /attempts`)과 답안 임시 저장·제출
- 이미 제출된 답안의 자동 채점 (`realtime` 큐, 우선순위 100)
- 교사의 수동 채점과 채점 예외 처리
- 오늘 운영실·기존 일정 조회
- 이미 생성된 PDF·HWPX 산출물 다운로드

**절대 하지 않는 것**: `auto_grading`을 끄지 않는다. 채점이 밀리면 후속 SLO가 연쇄로 무너진다. 채점 자체가 원인일 때만 [RB-12](./12-wrong-autograding-reprocess.md)로 간다.

---

## 4. 진단

### 4-1. 지금 영향받는 시험과 학생 수

```sql
SELECT ai.id                       AS assessment_instance_id,
       ai.organization_id,
       ai.kind,
       ai.opens_at, ai.closes_at,
       count(DISTINCT a.id)                                        AS attempts_total,
       count(DISTINCT a.id) FILTER (WHERE a.status = 'in_progress') AS in_progress,
       count(DISTINCT a.id) FILTER (WHERE a.status = 'submitted')   AS submitted,
       count(DISTINCT asg.student_id)                               AS assigned_students
FROM assessment_instances ai
LEFT JOIN assignments asg ON asg.assessment_instance_id = ai.id
LEFT JOIN attempts a      ON a.assessment_instance_id = ai.id
WHERE ai.status = 'open'
  AND now() BETWEEN ai.opens_at AND ai.closes_at
GROUP BY 1,2,3,4,5
ORDER BY assigned_students DESC;
```

### 4-2. 제출 유실 여부 (가장 중요)

```sql
-- 임시 저장은 있는데 attempts가 in_progress로 남아 있고
-- 마지막 저장 후 10분 이상 경과한 응시 = 제출 실패 후 이탈 의심
SELECT a.id AS attempt_id, a.organization_id, a.student_id,
       a.assessment_instance_id, a.status,
       max(r.saved_at)                    AS last_saved_at,
       now() - max(r.saved_at)            AS since_last_save,
       count(r.id)                        AS saved_responses,
       (SELECT count(*) FROM assessment_questions aq
        WHERE aq.assessment_instance_id = a.assessment_instance_id) AS total_questions
FROM attempts a
JOIN responses r ON r.attempt_id = a.id
WHERE a.status = 'in_progress'
  AND a.started_at > now() - interval '6 hours'
GROUP BY 1,2,3,4,5
HAVING now() - max(r.saved_at) > interval '10 minutes'
ORDER BY since_last_save DESC
LIMIT 100;
```

```sql
-- 제출됐는데 채점 작업이 없는 응시 = Outbox/jobs 커밋 불일치 (SEV1)
SELECT a.id AS attempt_id, a.organization_id, a.submitted_at
FROM attempts a
WHERE a.status = 'submitted'
  AND a.submitted_at > now() - interval '3 hours'
  AND NOT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.organization_id = a.organization_id
      AND j.job_type = 'grading.autograde'
      AND j.idempotency_key = a.id::text
  )
ORDER BY a.submitted_at
LIMIT 100;
```

### 4-3. 스냅샷 자산 무결성 (시작 실패 원인)

```sql
SELECT aq.assessment_instance_id,
       count(*)                                                        AS questions,
       count(*) FILTER (WHERE aq.content_checksum IS NULL)             AS missing_checksum,
       count(*) FILTER (WHERE qv.publish_gate_status <> 'passed')      AS gate_failed
FROM assessment_questions aq
JOIN question_versions qv ON qv.id = aq.question_version_id
JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id
WHERE ai.status = 'open' AND now() BETWEEN ai.opens_at AND ai.closes_at
GROUP BY 1
HAVING count(*) FILTER (WHERE aq.content_checksum IS NULL) > 0
    OR count(*) FILTER (WHERE qv.publish_gate_status <> 'passed') > 0;
```

### 4-4. DB 포화 여부

```sql
SELECT count(*) FILTER (WHERE state = 'active')            AS active,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
       count(*)                                            AS total,
       max(now() - query_start) FILTER (WHERE state = 'active') AS longest_active
FROM pg_stat_activity
WHERE datname = current_database();

-- 잠금 대기
SELECT bl.pid AS blocked_pid, bl.query AS blocked_query,
       kl.pid AS blocking_pid, kl.query AS blocking_query,
       now() - bl.query_start AS blocked_for
FROM pg_stat_activity bl
JOIN pg_locks blk ON blk.pid = bl.pid AND NOT blk.granted
JOIN pg_locks klk ON klk.locktype = blk.locktype
                 AND klk.relation IS NOT DISTINCT FROM blk.relation
                 AND klk.granted
JOIN pg_stat_activity kl ON kl.pid = klk.pid
ORDER BY blocked_for DESC LIMIT 20;
```

### 4-5. 채점 큐 적체

```sql
SELECT status, count(*),
       max(now() - created_at) AS oldest,
       avg(attempt_count)::numeric(5,2) AS avg_attempts
FROM jobs
WHERE queue = 'realtime' AND created_at > now() - interval '3 hours'
GROUP BY 1;
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 영향 시험 목록 확보 후 IC에게 보고 | 4-1 쿼리 | 2분 |
| 2 | **제출 유실 여부 확인** — 4-2 두 번째 쿼리가 0행이어야 함 | 4-2 | 3분 |
| 3 | 원인 분기 판단 (아래 5.1) | 4-3·4-4·4-5 | 5분 |
| 4 | 원인별 조치 수행 | 5.1 | 5~30분 |
| 5 | 영향 시험의 마감 시각 연장 | 5.2 | 3분 |
| 6 | 미제출 응시 구제 | 5.3 | 5분 |
| 7 | 검증(6장) 전부 통과 | — | 10분 |
| 8 | 부하 경감용 kill switch 해제 (지터 적용) | 5.4 | 2분 |

### 5.1 원인 분기

| 진단 결과 | 원인 | 조치 |
|---|---|---|
| 4-4에서 `idle in transaction` > 20 또는 잠금 대기 > 30초 | DB 커넥션·잠금 포화 | 장기 트랜잭션 종료 → `SELECT pg_terminate_backend(pid)`. 이후 web 인스턴스 pool max 하향 배포 |
| 4-4에서 `total` > 180 | 커넥션 고갈 | web 인스턴스 축소 또는 pooler 모드 확인. [RB-05](./05-db-failure-pitr.md) 병행 |
| 4-5에서 `realtime` 큐 `oldest` > 5분 | 채점 워커 부족 | 워커 증설. `ai`·`render` 큐 kill switch로 자원 회수 |
| 4-3에서 `missing_checksum` 또는 `gate_failed` > 0 | 게시 게이트 우회로 잘못된 스냅샷 게시 | 해당 시험 일시 마감 → [RB-10](./10-formula-render-rollback.md) |
| 4-2 두 번째 쿼리 > 0행 | **제출 커밋 불일치 (SEV1)** | 5.5 |
| 지표 정상인데 사용자 신고 | 클라이언트·네트워크 문제 | 브라우저 콘솔 로그 수집. CDN·프록시 상태 확인 |
| 배포 15분 이내 발생 | 배포 회귀 | [RB-14](./14-deploy-migration-rollback.md) 즉시 롤백 |

### 5.2 마감 시각 연장

```sql
-- 영향 시험의 마감을 60분 연장 (조직·시험 ID를 명시적으로 지정)
UPDATE assessment_instances
SET closes_at = closes_at + interval '60 minutes',
    updated_at = now(), version = version + 1
WHERE organization_id = $1
  AND id = ANY($2::uuid[])
  AND status = 'open';
```

연장 후 `audit_events`에 기록:

```sql
INSERT INTO audit_events (organization_id, actor_user_id, actor_kind, action,
                          target_type, target_id, before, after, reason,
                          permission_basis, occurred_at)
SELECT $1, $3, 'system', 'assessment.extend_deadline',
       'assessment_instance', id,
       jsonb_build_object('closes_at', closes_at - interval '60 minutes'),
       jsonb_build_object('closes_at', closes_at),
       'RB-01 SEV1 장애 대응', 'incident_response', now()
FROM assessment_instances
WHERE organization_id = $1 AND id = ANY($2::uuid[]);
```

### 5.3 미제출 응시 구제

**자동으로 제출 처리하지 않는다.** 학생이 답안을 더 쓰려 했을 수 있다. 대신:

1. 4-2 첫 번째 쿼리로 대상 목록을 뽑아 담당 교사에게 전달.
2. 마감 연장 안내를 학생에게 통지(교사 경유).
3. 학생이 재접속하면 임시 저장 답안이 그대로 복원되어 정상 제출 가능.
4. 재접속하지 못한 학생은 **교사가 개별 판단**해 응시 무효화 후 재배정(`POST /attempts/{id}:invalidate` + 재배정).

### 5.4 kill switch 해제

```bash
pnpm --filter @su-maek/db kill-switch disable auto_reschedule --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable document_export --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable ai_provider:anthropic --actor <이메일>
```

대기 작업 몰림 방지:

```sql
UPDATE jobs
SET run_after = now() + (random() * interval '600 seconds')
WHERE status = 'queued' AND queue IN ('ai','render','schedule');
```

### 5.5 제출 커밋 불일치 (SEV1 특수 경로)

`attempts.status='submitted'`인데 채점 작업이 없다면 트랜잭션 원자성이 깨진 것이다.

1. **즉시 IC + 경영진 통지.** 신뢰성 최상위 사고다.
2. 코드 경로 확인: 제출 트랜잭션에서 `outbox_events`·`jobs` INSERT가 같은 커밋인가.
3. 누락된 채점 작업을 **멱등 키로 보정 등록**:

```sql
INSERT INTO jobs (id, organization_id, queue, job_type, priority, status,
                  run_after, attempt_count, max_attempts,
                  idempotency_key, input_hash, input, created_at, updated_at)
SELECT uuidv7(), a.organization_id, 'realtime', 'grading.autograde', 100, 'queued',
       now(), 0, 5,
       a.id::text,
       encode(digest(a.id::text, 'sha256'), 'hex'),
       jsonb_build_object('attempt_id', a.id),
       now(), now()
FROM attempts a
WHERE a.status = 'submitted'
  AND a.submitted_at > now() - interval '24 hours'
  AND NOT EXISTS (SELECT 1 FROM jobs j
                  WHERE j.organization_id = a.organization_id
                    AND j.job_type = 'grading.autograde'
                    AND j.idempotency_key = a.id::text)
ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING;
```

4. 사후 분석에서 **왜 원자성이 깨졌는지**를 반드시 규명한다.

---

## 6. 검증

| # | 항목 | 검증 명령·쿼리 | 통과 조건 |
|---|---|---|---|
| V-1 | 제출 성공률 회복 | 대시보드 `sumaek_api_requests_total{route=".../:submit"}` | 실패율 < 0.01% (10분) |
| V-2 | 제출 지연 회복 | `sumaek_api_duration_seconds` p95/p99 | p95 < 1s, p99 < 2.5s |
| V-3 | 제출 유실 0 | 4-2 두 번째 쿼리 | **0행** |
| V-4 | 채점 큐 정상 | 4-5 쿼리 | `realtime` oldest < 60초 |
| V-5 | 스냅샷 무결성 | 4-3 쿼리 | 0행 |
| V-6 | 합성 모니터링 | SYN-1 | 3회 연속 성공, 60초 이내 |
| V-7 | DB 커넥션 | 4-4 첫 쿼리 | `total` < 150, `idle_in_tx` < 5 |
| V-8 | 불변 조건 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-9 | kill switch 해제 | `pnpm --filter @su-maek/db kill-switch list` | 전부 `false` |
| V-10 | 표본 확인 | 합성 조직에서 응시 시작 → 답안 → 제출 → 채점 | 성공 |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| SEV1 | **필수.** 30분 이내 초기 공지 |
| 시험 마감을 연장했다 | **필수** (영향 조직 개별) |
| 학생 답안 유실 가능성 | **필수** + 법률 검토 |
| SEV2 + 단일 조직 | 해당 조직에만 |
| SEV3 | 불필요 (해소 후 요약만) |

### 초기 공지

> **[수맥] 시험 응시·제출 장애 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각} (한국 시각 {KST})부터 일부 학생의 **시험 시작과 답안 제출**이 정상적으로 처리되지 않는 문제가 확인되었습니다.
>
> - 영향 범위: {영향 조직 수}개 조직, 진행 중인 시험 {N}건
> - 현재 상태: 원인 조사 및 복구 진행 중
> - **임시 저장된 답안은 보존되어 있습니다.** 학생이 다시 접속하면 작성 중이던 답안이 그대로 복원됩니다.
>
> **지금 하실 일**
> 1. 영향받은 시험의 마감 시각을 {N}분 연장했습니다. 추가 연장이 필요하시면 회신해 주세요.
> 2. 학생에게 "다시 접속해 이어서 작성"을 안내해 주세요.
> 3. 제출이 계속 실패하면 화면을 새로 고침한 뒤 재시도하도록 안내해 주세요.
>
> 다음 안내는 {30분 후 시각}에 드리겠습니다.

### 진행 중 공지

> **[수맥] 시험 응시·제출 장애 — 진행 상황 안내 ({N}차)**
>
> {UTC 시각} 기준 현황입니다.
>
> - 원인: {확인된 사실만. 예: "데이터베이스 연결 포화"}
> - 조치: {수행한 것. 예: "장기 실행 쿼리 정리 및 연결 한도 조정 완료"}
> - 현재: 제출 성공률 {X}% (정상 99.95% 이상)
> - **답안 유실은 확인되지 않았습니다.** / 또는 {확인된 사실}
>
> 다음 안내는 {시각}에 드리겠습니다.

### 해소 공지

> **[수맥] 시험 응시·제출 장애 해소 안내**
>
> {UTC 시각}부로 시험 시작·제출 기능이 정상 복구되었습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 장애 시간 | {시작} ~ {종료} (총 {N}분) |
> | 영향 조직 | {N}개 |
> | 영향 시험 | {N}건 |
> | 답안 유실 | 없음 (또는 {구체 내용}) |
> | 마감 연장 | {N}건, 각 {N}분 |
>
> **확인 부탁드립니다**
> - 연장된 시험의 마감 시각이 수업 일정과 맞는지 확인해 주세요.
> - 제출하지 못한 학생이 있다면 학생 상세 화면에서 응시 상태를 확인하실 수 있습니다.
>
> 상세한 원인과 재발 방지 대책은 영업일 5일 이내에 별도로 안내드리겠습니다.
> 불편을 드려 죄송합니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 학생 답안 유실 확인 | **필요** | 학습 기록 손실. 조직의 학사 처리에 영향 |
| 시험 문항·정답이 노출됐을 가능성 | **필요** | 평가 공정성. [RB-06](./06-cross-tenant-exposure.md) 병행 |
| 성적이 잘못 기록됨 | **필요** | 성적 정정 절차 |
| 단순 지연·일시 실패, 유실 없음 | 불필요 | — |
| 마감 연장으로 해결 | 불필요 | — |

법률 검토가 필요하면 **공지 발송 전에** 문안을 검토받는다.

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (영업일 5일 이내)
- [ ] 4-2 유실 확인 쿼리를 **일 배치 검증**에 추가했는가
- [ ] 원인이 커넥션 포화였다면 pool max·pooler 설정을 조정하고 부하시험으로 검증했는가
- [ ] 원인이 큐 적체였다면 `realtime` 큐 우선순위·워커 수를 재산정했는가
- [ ] 원인이 배포 회귀였다면 배포 전 스모크(제출 왕복)에 해당 케이스를 추가했는가
- [ ] 합성 모니터링 SYN-1이 실제보다 늦게 감지했다면 주기·판정 기준을 조정했는가
- [ ] 이 런북의 진단 쿼리가 부족했다면 보강했는가
- [ ] 마감 연장 절차를 UI 기능으로 만들 가치가 있는지 검토했는가
- [ ] 오류 예산 소진율을 기록하고, 50% 초과 시 배포 제동을 적용했는가
- [ ] 클라이언트 로컬(IndexedDB) 답안 보존이 실제로 동작했는지 확인했는가
