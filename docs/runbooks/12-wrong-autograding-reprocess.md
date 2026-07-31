# RB-12 잘못된 자동 채점과 영향 학생 재처리

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** (골드셋 정확도 미달·대량 오채점) / SEV2 (예외율 급증) |
| 1차 담당 | 운영 엔지니어(OE) + 수학 프로그램 책임자(도메인 소유자) |
| 에스컬레이션 | 5분 미확인 → IC / 성적이 이미 학생에게 공개됐으면 즉시 경영진 + 법률 검토 |
| 관련 SLO | **O-09 자동 채점 정확도 골드셋 99.99%** · 불변 I-09(한 번 제출)·I-10(증거 정확히 한 번)·I-13(과거 기록 보존) |
| 관련 kill switch | **`auto_grading`** |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-15 · [../phase0/sequences.md](../phase0/sequences.md) S-5·S-8 · [../adr/0009-grading-mastery-regrade.md](../adr/0009-grading-mastery-regrade.md) |

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `autograde_accuracy_drop` | 골드셋(1만 건) 정확도 | < 99.99% | 모델·정규화기·정책 변경 시 | **SEV1** |
| `grading_exception_rate` | 자동 채점 예외 발생 비율 | > 15% | 1시간 | SEV3 |
| `grading_exception_rate_high` | 동일 | > 30% | 30분 | SEV2 |
| `grading_confidence_drop` | `grade_decisions.confidence` 평균 | < 0.90 | 1시간 | SEV2 |
| `answer_key_error_reports` | `grading_exceptions.exception_type='question_error'` | > 10건 | 1시간 | **SEV2** |
| `score_distribution_anomaly` | 시험별 평균 점수가 직전 동일 유형 대비 | ±30% 이탈 | 시험 종료 시 | SEV2 |
| `mass_zero_score` | 만점 대비 0점 비율 | > 40% (30명 이상 시험) | 실시간 | **SEV1** |
| `grading_deadline_violation` | 제출 후 30분 경과 미채점 | > 50건 | 10분 | SEV2 (→ [RB-04](./04-queue-backlog-dlq.md)) |
| 불변 I-10 위반 | 채점 1건이 증거 2건 이상 | > 0 | 일 배치 | **SEV1** |
| 교사 신고 | "채점이 틀렸다" | 3건 이상 (동일 시험) | 즉시 | **SEV1** |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 골드셋 정확도 < 99.99% | **SEV1** |
| 30명 이상 시험에서 0점 비율 40% 초과 | **SEV1** |
| 오채점 성적이 이미 학생·학부모에게 공개됨 | **SEV1** (+ 법률 검토) |
| 불변 I-10 위반 (숙련도 중복 반영) | **SEV1** |
| 문항 정답 오류로 다수 학생 오채점 | **SEV2** (→ [RB-08](./08-content-rights-emergency-stop.md) 격리 절차 병행) |
| 예외율 30% 초과 (검수 마비) | SEV2 |
| 예외율 15~30% | SEV3 |
| 단일 문항·소수 학생 영향 | SEV3 (개별 정정) |

---

## 3. 즉시 중지할 기능

```bash
pnpm --filter @su-maek/db kill-switch enable auto_grading \
  --reason "RB-12 SEV1 자동 채점 정확도 미달" --actor <이메일>
```

**중지되는 것**: 자동 채점 워커 실행. 제출된 응시는 `submitted` 상태로 대기한다.

**중지해도 반드시 되는 것**:

- **답안 제출·임시 저장** (web 경로, 워커와 무관)
- 시험 시작·응시 전체
- **수동 채점** — 교사가 채점 화면에서 직접 판정
- 채점 예외 처리
- **기존 확정 점수 조회** — 학생·교사 모두
- 오늘 수업 운영, 일정 관리
- 리포트 조회 (기존 확정 데이터 기준)

**절대 하지 않는 것**:

- 기존 `grade_decisions` 행 삭제·수정 — **append-only**
- `responses` 원본 답안 수정
- 자동 재채점 실행 — **항상 사람 승인**
- 성적 일괄 초기화

---

## 4. 진단

### 4-1. 골드셋 회귀 실행

```bash
pnpm --filter @su-maek/core test:grading-golden
pnpm --filter @su-maek/core test:grading-golden -- --tier=normalized
pnpm --filter @su-maek/core test:grading-golden -- --tier=equivalence
```

계층별 정확도를 확인해 어느 채점 계층이 무너졌는지 특정한다.

### 4-2. 채점 계층별 신뢰도·정확도

```sql
SELECT gd.grading_tier,
       gd.decided_by,
       count(*)                                          AS decisions,
       avg(gd.confidence)::numeric(5,4)                  AS avg_confidence,
       percentile_cont(0.05) WITHIN GROUP (ORDER BY gd.confidence)::numeric(5,4) AS p05_confidence,
       count(*) FILTER (WHERE gd.confidence < 0.95)      AS below_threshold,
       count(*) FILTER (WHERE gd.score = 0)              AS zero_scores,
       gd.policy_version
FROM grade_decisions gd
WHERE gd.is_current AND gd.decided_at > now() - interval '24 hours'
GROUP BY 1,2,7
ORDER BY decisions DESC;
```

### 4-3. 점수 분포 이상 탐지

```sql
SELECT ai.id AS assessment_instance_id, ai.organization_id, ai.kind, ai.scheduled_on,
       count(DISTINCT a.id)                                              AS attempts,
       avg(a.total_score / NULLIF(a.max_score,0))::numeric(5,3)          AS avg_ratio,
       count(*) FILTER (WHERE a.total_score = 0)                         AS zero_count,
       round(100.0 * count(*) FILTER (WHERE a.total_score = 0)
             / NULLIF(count(*),0), 1)                                    AS zero_pct,
       count(*) FILTER (WHERE a.total_score = a.max_score)               AS full_count
FROM assessment_instances ai
JOIN attempts a ON a.assessment_instance_id = ai.id
WHERE a.status IN ('auto_graded','finalized')
  AND a.finalized_at > now() - interval '48 hours'
GROUP BY 1,2,3,4
HAVING count(DISTINCT a.id) >= 10
   AND (round(100.0 * count(*) FILTER (WHERE a.total_score = 0) / NULLIF(count(*),0), 1) > 40
        OR avg(a.total_score / NULLIF(a.max_score,0)) < 0.25)
ORDER BY zero_pct DESC
LIMIT 30;
```

### 4-4. 문항별 정답률 이상 (정답 오류 신호)

```sql
SELECT aq.id AS assessment_question_id, aq.assessment_instance_id, aq.ordinal,
       aq.question_version_id, aq.selection_reason,
       count(*)                                                 AS responses,
       count(*) FILTER (WHERE gd.score > 0)                     AS correct,
       round(100.0 * count(*) FILTER (WHERE gd.score > 0)
             / NULLIF(count(*),0), 1)                           AS correct_pct,
       avg(gd.confidence)::numeric(5,4)                         AS avg_confidence
FROM assessment_questions aq
JOIN responses r        ON r.assessment_question_id = aq.id
JOIN grade_decisions gd ON gd.response_id = r.id AND gd.is_current
JOIN attempts a         ON a.id = r.attempt_id
WHERE a.finalized_at > now() - interval '48 hours'
GROUP BY 1,2,3,4,5
HAVING count(*) >= 20
   AND round(100.0 * count(*) FILTER (WHERE gd.score > 0) / NULLIF(count(*),0), 1) < 10
ORDER BY responses DESC
LIMIT 50;
```

**정답률 10% 미만인 문항은 정답 오류를 의심한다.**

### 4-5. 예외 유형별 분포

```sql
SELECT ge.exception_type, ge.status,
       count(*)                          AS exceptions,
       count(DISTINCT ge.assigned_to)    AS assignees,
       min(ge.created_at)                AS earliest,
       count(*) FILTER (WHERE ge.due_at < now() AND ge.status <> 'resolved') AS overdue
FROM grading_exceptions ge
WHERE ge.created_at > now() - interval '24 hours'
GROUP BY 1,2
ORDER BY exceptions DESC;
```

### 4-6. 불변 I-10 — 증거 중복 반영

```sql
SELECT grade_decision_id, canonical_concept_id, count(*) AS duplicates
FROM mastery_evidences
GROUP BY 1,2 HAVING count(*) > 1
LIMIT 50;
```

### 4-7. 영향 범위 (재채점 대상)

```sql
-- 특정 문항 버전의 영향
SELECT aq.assessment_instance_id, ai.organization_id, ai.kind, ai.status,
       count(DISTINCT a.id)          AS attempts,
       count(DISTINCT a.student_id)  AS students,
       count(DISTINCT r.id)          AS responses,
       min(a.finalized_at)           AS earliest_finalized,
       max(a.finalized_at)           AS latest_finalized
FROM assessment_questions aq
JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id
JOIN responses r             ON r.assessment_question_id = aq.id
JOIN attempts a              ON a.id = r.attempt_id
WHERE aq.question_version_id = $1
GROUP BY 1,2,3,4
ORDER BY students DESC;
```

### 4-8. 정책·모델 버전 변경 이력

```sql
SELECT gd.policy_version, gd.grading_tier,
       min(gd.decided_at) AS first_seen, max(gd.decided_at) AS last_seen,
       count(*) AS decisions, avg(gd.confidence)::numeric(5,4) AS avg_conf
FROM grade_decisions gd
WHERE gd.decided_by = 'auto' AND gd.decided_at > now() - interval '7 days'
GROUP BY 1,2 ORDER BY first_seen DESC;
```

버전이 바뀐 시점과 정확도 하락 시점이 일치하면 원인이다.

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | `auto_grading` kill switch ON | 3장 | 1분 |
| 2 | 골드셋 회귀로 계층 특정 (4-1) | — | 10분 |
| 3 | 영향 범위 산출 (4-3·4-4·4-7) | 4장 | 15분 |
| 4 | 원인별 조치 (5.1) | — | 15~60분 |
| 5 | 재채점 영향 분석 (5.2) — **부작용 없음** | — | 10분 |
| 6 | **도메인 소유자 승인** | — | 가변 |
| 7 | 재채점 실행 (5.3) | — | 30분~수시간 |
| 8 | 숙련도·복습·일정 연쇄 확인 (5.4) | — | 30분 |
| 9 | 검증 (6장) | — | 20분 |
| 10 | kill switch 해제 (5.5) | — | 3분 |

### 5.1 원인별 조치

| 진단 | 원인 | 조치 |
|---|---|---|
| 4-1에서 `normalized` 계층 실패 | 정답 정규화 규칙 회귀 | `GRADING_POLICY_VERSION` 롤백 |
| 4-1에서 `equivalence` 계층 실패 | 동치 판정 범위 오류 | 안전 범위를 좁힌다 (모호하면 사람에게) + 롤백 |
| 4-4에서 특정 문항 정답률 10% 미만 | **문항 정답 오류** | 문항 격리 ([RB-08](./08-content-rights-emergency-stop.md) 5.A) + 재채점 |
| 4-8에서 정책 버전 변경과 시점 일치 | 정책 회귀 | 이전 `mastery_policy_versions`·`assessment_policies` 활성화 |
| 4-2에서 `avg_confidence` 정상인데 오채점 | 스냅샷 정답 자체가 잘못됨 | 문항 격리 + 재채점 |
| 4-6에서 증거 중복 | Inbox 중복 차단 실패 | 중복 증거 정리 (5.6) + 소비자 코드 확인 |
| 4-5에서 예외율 급증 | AI·OCR 품질 저하 | [RB-03](./03-ai-ocr-outage-cost.md) 병행 |

```sql
-- 문항 격리 (정답 오류)
UPDATE questions
SET lifecycle = 'quarantined',
    quarantine_reason = 'RB-12: 정답 오류 (정답률 {N}%)',
    quarantined_at = now(), updated_at = now()
WHERE id = (SELECT question_id FROM question_versions WHERE id = $1);
```

### 5.2 재채점 영향 분석 (부작용 없음 — 반드시 먼저)

```bash
curl -s -X POST "$BASE/api/v1/assessments/$ASSESSMENT_ID:regrade-impact" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"question_version_id":"'"$QV_ID"'","corrected_answer_key":{...}}'
```

응답에 포함되는 것:

| 항목 | 내용 |
|---|---|
| 영향 학생 수 | 점수가 바뀌는 학생 |
| 점수 변화 분포 | 상승·하락·불변 건수 |
| 숙련도 변화 | 상태 전이 예상 |
| 확인테스트 통과 여부 변경 | 통과 → 미통과, 미통과 → 통과 |
| 재계산될 일정 수 | 보충 경로 생성·취소 |
| 리포트 영향 | 재생성 필요 건수 |

**이 결과를 도메인 소유자가 검토하고 승인한다.**

### 5.3 재채점 실행

```bash
curl -s -X POST "$BASE/api/v1/assessments/$ASSESSMENT_ID:regrade" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Reauth-Token: $REAUTH" \
  -d '{"reason":"RB-12: 정답 오류 정정","question_version_id":"'"$QV_ID"'"}'
```

내부 동작:

```sql
-- 각 영향 response에 대해 (append-only)
UPDATE grade_decisions SET is_current = false WHERE response_id = $1 AND is_current;

INSERT INTO grade_decisions (id, organization_id, response_id, version, is_current,
                             decided_by, grading_tier, score, confidence, rationale,
                             normalized_answer, policy_version, correction_reason, decided_at)
VALUES (uuidv7(), $org, $1,
        (SELECT COALESCE(max(version),0)+1 FROM grade_decisions WHERE response_id = $1),
        true, 'reprocess', $tier, $score, $confidence, $rationale,
        $normalized, $policy, 'RB-12: 정답 오류 정정', now());
```

**기존 행을 수정·삭제하지 않는다.** 새 버전을 만든다.

멱등성 키: `H(assessment_id, question_version_id, decision_version)` — 같은 재채점 요청 반복 시 1회만.

### 5.4 숙련도·복습·일정 연쇄

`GradeFinalized` 이벤트(`correction_of_grade_decision_ids` 포함)가 자동 연쇄를 일으킨다.

```sql
-- 연쇄 진행 확인
SELECT im.consumer_name, im.outcome, count(*), max(im.processed_at)
FROM inbox_messages im
JOIN outbox_events oe ON oe.id = im.event_id
WHERE oe.event_type = 'GradeFinalized'
  AND oe.occurred_at > $regrade_start
GROUP BY 1,2 ORDER BY 1;
```

`mastery-engine`은 기존 증거를 **삭제하지 않고** 상쇄 증거(`evidence_kind='correction'`)를 추가한 뒤 재계산한다.

### 5.5 kill switch 해제

```bash
pnpm --filter @su-maek/db kill-switch disable auto_grading --actor <이메일>
```

```sql
-- 대기 중이던 채점 작업 재개 (realtime 큐는 지터를 짧게)
UPDATE jobs
SET run_after = now() + (random() * interval '60 seconds')
WHERE status = 'queued' AND queue = 'realtime';
```

### 5.6 중복 증거 정리 (I-10 위반 시)

```sql
-- 중복 확인 후 최초 1건만 남기고 나머지 제거
-- mastery_evidences는 append-only지만, 제약 위반 정리는 예외적으로 수행하고 감사에 남긴다.
WITH dups AS (
  SELECT id, row_number() OVER (
           PARTITION BY grade_decision_id, canonical_concept_id ORDER BY created_at, id) AS rn
  FROM mastery_evidences
)
DELETE FROM mastery_evidences me
USING dups WHERE me.id = dups.id AND dups.rn > 1;
```

```sql
-- UNIQUE 제약 존재 확인 (없으면 추가)
SELECT conname FROM pg_constraint
WHERE conrelid = 'mastery_evidences'::regclass AND contype = 'u';
```

정리 후 영향 학생의 숙련도를 재계산한다.

---

## 6. 검증

| # | 항목 | 검증 명령·쿼리 | 통과 조건 |
|---|---|---|---|
| V-1 | 골드셋 정확도 | 4-1 | **≥ 99.99%** |
| V-2 | 계층별 신뢰도 | 4-2 | `avg_confidence` ≥ 0.95 (auto) |
| V-3 | 점수 분포 | 4-3 | 이상 시험 0행 |
| V-4 | 문항 정답률 | 4-4 | 10% 미만 문항 0행 (또는 격리됨) |
| V-5 | 예외율 | 4-5 | ≤ 15% |
| V-6 | 불변 I-10 | 4-6 | **0행** |
| V-7 | 채점 이력 보존 | 아래 쿼리 | 이전 버전 전부 존재 |
| V-8 | 현재 채점 1건 | 아래 쿼리 | 0행 |
| V-9 | 숙련도 재계산 | 영향 학생 표본 20건 `computed_hash` 재현 | 일치 |
| V-10 | 연쇄 완료 | 5.4 쿼리 | 전 소비자 처리 완료 |
| V-11 | 채점 지연 | [RB-04](./04-queue-backlog-dlq.md) 4-7 | 0행 |
| V-12 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-13 | 교사 표본 확인 | 영향 시험 3건을 담당 교사가 육안 확인 | 이상 없음 |
| V-14 | kill switch | `kill-switch list` | `auto_grading` = `false` |

```sql
-- V-7: 재채점 후에도 이전 버전이 남아 있는가
SELECT response_id, count(*) AS versions,
       array_agg(version ORDER BY version) AS version_list,
       count(*) FILTER (WHERE is_current) AS current_count
FROM grade_decisions
WHERE response_id = ANY($1::uuid[])
GROUP BY 1
HAVING count(*) < 2;   -- 재채점했는데 버전이 1개면 이상

-- V-8: is_current가 2건 이상인 response
SELECT response_id, count(*) FROM grade_decisions
WHERE is_current GROUP BY 1 HAVING count(*) > 1;
```

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 성적이 변경됨 (재채점 실행) | **필수** (영향 조직 + 영향 학생) |
| 오채점 성적이 이미 학생·학부모에게 공개됨 | **필수** + 법률 검토 |
| 확인테스트 통과 여부가 바뀜 | **필수** (해당 학생 개별) |
| 자동 채점 중단으로 결과가 지연 | **필수** (영향 조직) |
| 예외율 증가로 검수 지연 | 필요 시 |
| 발견 즉시 중단, 성적 미공개 | 필요 시 (조직 판단 지원) |

### 초기 공지

> **[수맥] 자동 채점 오류 확인 안내 — 중요**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}, **자동 채점에서 오류**를 확인하고 즉시 자동 채점을 중단했습니다.
>
> **확인된 문제**
> - 내용: {구체적으로. 예: "'{시험명}' 8번 문항의 정답이 잘못 등록되어 정답을 오답으로 처리"}
> - 영향 기간: {시작} ~ {종료}
> - 영향 시험: {N}건
> - 영향 학생: {N}명
>
> **즉시 조치한 것**
> - 자동 채점 중단 (제출된 답안은 대기 상태로 보존)
> - 문제 문항 격리
> - 영향 범위 분석 진행 중
>
> **영향 없는 것**
> - 학생의 답안 원본 (전부 보존)
> - 시험 응시와 제출
> - 다른 시험의 채점 결과
>
> **지금 하실 일 (중요)**
> 1. **영향 시험의 성적을 학생·학부모에게 안내하지 말아 주세요.**
> 2. 이미 안내하셨다면, 정정 예정임을 알려주시기 바랍니다.
> 3. 급한 채점은 채점 화면에서 **수동 채점**으로 진행하실 수 있습니다.
>
> 재채점 계획을 {시각}까지 안내드리겠습니다.

### 재채점 사전 안내

> **[수맥] 재채점 실행 안내 — {조직명}**
>
> 확인된 오류에 대해 재채점을 실행하려 합니다. **실행 전 확인 부탁드립니다.**
>
> | 항목 | 값 |
> |---|---|
> | 영향 시험 | {N}건 |
> | 영향 학생 | {N}명 |
> | 점수 상승 | {N}명 (평균 +{N}점) |
> | 점수 하락 | {N}명 (평균 −{N}점) |
> | 확인테스트 통과 여부 변경 | {N}명 |
> | 재계산될 학습 일정 | {N}건 |
>
> **첨부 파일**에 학생별 예상 변경 내역을 담았습니다.
>
> **동의하시면 회신해 주세요.** 회신 후 재채점을 실행합니다.
> 이전 채점 결과는 삭제되지 않고 이력으로 보존됩니다.

### 해소 공지

> **[수맥] 재채점 완료 안내**
>
> {UTC 시각}부로 재채점이 완료되고 자동 채점을 재개했습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 발생 기간 | {시작} ~ {종료} |
> | 원인 | {구체적} |
> | 재채점 대상 | 학생 {N}명 / 응시 {N}건 |
> | 점수 변경 | 상승 {N}명 / 하락 {N}명 / 불변 {N}명 |
> | 학습 일정 재계산 | {N}건 |
> | 답안 원본 | 전부 보존 |
> | 이전 채점 이력 | 전부 보존 (채점 이력 탭에서 확인 가능) |
>
> **확인 부탁드립니다**
> - 학생 상세 → 테스트 탭에서 정정된 점수를 확인해 주세요.
> - 확인테스트 통과 여부가 바뀐 학생 {N}명은 학습 경로가 조정되었습니다.
> - 성적표를 이미 발송하셨다면 정정본을 다시 생성해 주세요.
>
> 성적 정정으로 불편을 드려 죄송합니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| **오채점 성적이 학생·학부모에게 공개됨** | **필수** | 성적 정정 절차. 조직-학부모 분쟁 |
| 확인테스트 통과 여부가 바뀜 | **필요** | 진급·과정 이수 판정에 영향 |
| 성적이 외부(SIS·LMS)로 내보내진 후 | **필요** | 외부 시스템 정정 협조 |
| 재시험·추가 시험이 필요한 경우 | **필요** | 학사 처리 |
| 발견 즉시 중단, 미공개 | 불필요 | — |
| 예외율 증가만 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV1 기준, 영업일 5일)
- [ ] **골드셋(1만 건)에 이 케이스가 있었는가.** 없으면 추가
- [ ] 골드셋 회귀가 배포 전에 실행됐는가. CI 게이트인가
- [ ] 정답 오류였다면: 게시 게이트의 "정답 존재"·"해설과 정답 일치" 검사가 왜 통과시켰는가
- [ ] AI 생성 정답의 독립 재풀이·복수 모델 비교가 수행됐는가
- [ ] 동치 판정 안전 범위가 적절했는가. 모호한 케이스를 사람에게 보냈는가
- [ ] 자동 확정 임계(`confidence >= 0.95`)가 적절했는가
- [ ] `score_distribution_anomaly` 알림이 충분히 빨랐는가. `mass_zero_score`(40%)가 작동했는가
- [ ] 재채점이 **사람 승인**을 거쳤는가. 자동 실행 경로가 있었나
- [ ] 재채점 영향 분석(`:regrade-impact`)이 실제 결과와 일치했는가
- [ ] `grade_decisions` append-only가 지켜졌는가 (V-7·V-8)
- [ ] 숙련도 상쇄 증거 처리가 올바르게 됐는가
- [ ] 불변 I-10 UNIQUE 제약이 실제로 존재하는가
- [ ] 재채점 연쇄(숙련도 → 복습 → 일정)가 완료됐는가
- [ ] 교사가 오류를 먼저 발견했다면, 왜 시스템이 못 잡았는지 탐지 항목을 보강
