# RB-02 잘못된 일정 대량 생성

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** (5,000건 초과) / SEV2 (1,000~5,000건) |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 5분 미확인 → IC / 15분 → 도메인 소유자(학습 경로·계획) / 30분 → 고객 공지 |
| 관련 SLO | O-03 반 재계산 95% 60초·99% 5분 · 불변 I-05(완료·잠금 보존)·I-06(하드 제약)·I-12(결정론) |
| 관련 kill switch | **`auto_schedule_recalc`** |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-04 · [../phase0/sequences.md](../phase0/sequences.md) S-2 · [../adr/0007-deterministic-schedule-engine.md](../adr/0007-deterministic-schedule-engine.md) |

---

## 1. 탐지 조건

| 알림 | 메트릭 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `mass_schedule_change` | 1시간 내 `sessions` INSERT/UPDATE 건수 | > 5,000건 | 1시간 | SEV1 |
| `mass_schedule_change_warn` | 동일 | > 1,000건 | 1시간 | SEV2 |
| `schedule_recalc_failure` | `schedule_change_proposals.status='failed'` 비율 | > 5% | 1시간 | SEV2 |
| `schedule_conflict_spike` | `HARD_CONSTRAINT_VIOLATION` 응답 수 | > 50건 | 30분 | SEV2 |
| `schedule_engine_determinism` | 같은 `(input_hash, engine_version, seed)`에 서로 다른 `output_hash` | > 0건 | 일 배치 | **SEV1** |
| `locked_session_modified` | 불변 I-05 검증 쿼리 위반 | > 0건 | 일 배치 | **SEV1** |
| `SYN-2` 합성 모니터링 | 일정 재계산 preview → apply | 실패 2회 연속 또는 > 120초 | 5분 주기 | SEV2 |
| 사용자 신고 | "일정이 이상하게 바뀌었다" | 2건 이상 | 30분 | SEV1 |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 1시간 내 `sessions` 변경 > 5,000건 | **SEV1** |
| 완료·잠금 수업이 변경됨 (불변 I-05 위반) | **SEV1** |
| 하드 제약 위반 일정이 실제 생성됨 (I-06 위반) | **SEV1** |
| 엔진 결정론 깨짐 (같은 입력 → 다른 결과) | **SEV1** |
| 3개 조직 이상에 잘못된 일정 적용 | **SEV1** |
| 단일 조직, 1,000~5,000건 | SEV2 |
| 재계산 실패율 > 5%, 기존 일정은 정상 유지 | SEV2 |
| 재계산이 SLO(60초)를 넘지만 결과는 정확 | SEV3 |

---

## 3. 즉시 중지할 기능

```bash
pnpm --filter @su-maek/db kill-switch enable auto_schedule_recalc \
  --reason "RB-02 SEV1 잘못된 일정 대량 생성" --actor <이메일>
```

**중지되는 것**: 일정 변경안 자동 생성, 자동 적용(정책이 `auto`인 조직 포함).

**중지해도 반드시 되는 것**:

- 기존 활성 일정 조회와 오늘 운영실
- 교사의 **수동** 일정 편집 (드래그 이동, 휴강 지정, 보강 지정)
- 수동 preview 생성과 수동 apply (교사가 검토 후 적용)
- 수업 시작·종료·진도 기록
- 시험 응시·제출·채점 전체
- 루트 조회·편집 (게시는 별도 판단)

부하가 원인이면 함께:

```bash
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic --reason "RB-02 부하 경감" --actor <이메일>
```

**진행 중인 `applying` 제안 처리**: 강제 중단하지 않는다. 적용은 단일 트랜잭션이므로 완료되거나 롤백된다. 중단하면 부분 적용 상태가 생길 수 있다.

---

## 4. 진단

### 4-1. 무엇이 얼마나 바뀌었나

```sql
SELECT p.organization_id,
       p.scope_type, p.scope_id,
       p.engine_version, p.seed,
       p.status,
       p.approved_at, p.updated_at,
       jsonb_array_length(COALESCE(p.diff -> 'moved', '[]'::jsonb))     AS moved,
       jsonb_array_length(COALESCE(p.diff -> 'created', '[]'::jsonb))   AS created,
       jsonb_array_length(COALESCE(p.diff -> 'cancelled', '[]'::jsonb)) AS cancelled,
       p.reason_codes
FROM schedule_change_proposals p
WHERE p.status = 'applied'
  AND p.updated_at > now() - interval '3 hours'
ORDER BY (jsonb_array_length(COALESCE(p.diff -> 'moved', '[]'::jsonb))
        + jsonb_array_length(COALESCE(p.diff -> 'created', '[]'::jsonb))) DESC
LIMIT 50;
```

### 4-2. 완료·잠금 수업이 변경됐는가 (불변 I-05)

```sql
SELECT s.id AS session_id, s.organization_id, s.learning_group_id,
       s.status, s.locked_at, s.completed_at,
       s.starts_at, s.updated_at, s.version
FROM sessions s
WHERE (s.status = 'completed' OR s.locked_at IS NOT NULL)
  AND s.updated_at > now() - interval '6 hours'
  AND s.updated_at > s.completed_at
ORDER BY s.updated_at DESC
LIMIT 100;
```

**이 쿼리가 1행이라도 반환하면 SEV1이다.** 트리거가 뚫렸다는 뜻이다.

### 4-3. 하드 제약 위반이 실제 존재하는가 (불변 I-06)

```sql
-- 교사 시간 충돌
SELECT a.organization_id, a.teacher_id,
       a.id AS session_a, b.id AS session_b,
       a.starts_at, a.ends_at, b.starts_at, b.ends_at
FROM sessions a
JOIN sessions b
  ON b.organization_id = a.organization_id
 AND b.teacher_id      = a.teacher_id
 AND b.id <> a.id
 AND tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)
WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
  AND a.starts_at > now() - interval '1 day'
LIMIT 50;

-- 휴일에 배치된 수업
SELECT s.id, s.organization_id, s.learning_group_id, s.starts_at, h.holiday_on, h.kind
FROM sessions s
JOIN learning_groups lg ON lg.id = s.learning_group_id
JOIN holidays h
  ON h.organization_id = s.organization_id
 AND h.course_period_id = lg.course_period_id
 AND h.holiday_on = (s.starts_at AT TIME ZONE s.timezone_id)::date
WHERE s.status <> 'cancelled' AND s.starts_at > now()
LIMIT 50;

-- 하루 학습량 상한 초과
SELECT s.organization_id, s.learning_group_id,
       (s.starts_at AT TIME ZONE s.timezone_id)::date AS on_date,
       sum(EXTRACT(epoch FROM (s.ends_at - s.starts_at)) / 60)::int AS total_minutes,
       max(cr.max_daily_load_minutes) AS cap
FROM sessions s
JOIN learning_groups lg ON lg.id = s.learning_group_id
JOIN calendar_rules cr
  ON cr.organization_id = s.organization_id
 AND cr.course_period_id = lg.course_period_id
 AND (cr.learning_group_id = s.learning_group_id OR cr.learning_group_id IS NULL)
WHERE s.status <> 'cancelled' AND s.starts_at > now()
GROUP BY 1,2,3
HAVING sum(EXTRACT(epoch FROM (s.ends_at - s.starts_at)) / 60) > max(cr.max_daily_load_minutes)
LIMIT 50;
```

### 4-4. 엔진 결정론 검증 (불변 I-12)

```sql
SELECT input_hash, engine_version, seed,
       count(DISTINCT output_hash) AS distinct_outputs,
       array_agg(DISTINCT output_hash) AS outputs,
       array_agg(id) AS proposal_ids
FROM schedule_change_proposals
WHERE status IN ('proposed','approved','applied')
  AND created_at > now() - interval '7 days'
GROUP BY 1,2,3
HAVING count(DISTINCT output_hash) > 1;
```

**1행이라도 나오면 엔진이 비결정론적이다. SEV1.**

### 4-5. 영향 조직·학생 범위

```sql
SELECT p.organization_id,
       count(DISTINCT p.id) AS proposals,
       count(DISTINCT sid)  AS affected_students,
       min(p.updated_at)    AS first_applied,
       max(p.updated_at)    AS last_applied
FROM schedule_change_proposals p
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(p.affected -> 'studentIds', '[]'::jsonb)) AS sid
WHERE p.status = 'applied' AND p.updated_at > now() - interval '6 hours'
GROUP BY 1 ORDER BY 3 DESC;
```

### 4-6. 트리거 존재 확인 (I-05가 뚫렸을 때)

```sql
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'sessions'::regclass AND NOT tgisinternal;
```

`tgenabled`가 `'D'`(disabled)면 마이그레이션에서 비활성화된 뒤 복구되지 않은 것이다.

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | `auto_schedule_recalc` kill switch ON | 3장 | 1분 |
| 2 | 영향 범위 확정 (4-1·4-5) | 4장 | 5분 |
| 3 | 불변 위반 확인 (4-2·4-3·4-4) | 4장 | 5분 |
| 4 | 롤백 대상 선정 (5.1) | — | 5분 |
| 5 | `rollback_token`으로 역방향 적용 | 5.2 | 10~30분 |
| 6 | 역방향 실패 시 PITR 판단 | 5.3 | 60분 |
| 7 | 트리거 복구 (필요 시) | 5.4 | 5분 |
| 8 | 엔진 버전 롤백 (필요 시) | 5.5 | 5분 |
| 9 | 검증(6장) | — | 15분 |
| 10 | kill switch 해제 | 5.6 | 2분 |

### 5.1 롤백 대상 선정 기준

| 상황 | 조치 |
|---|---|
| 특정 제안 1~수십 건만 잘못됨 | `rollback_token` 역방향 적용 (5.2) |
| 특정 엔진 버전 배포 이후 전부 의심 | 해당 버전으로 만들어진 `applied` 제안 전부 롤백 |
| 완료·잠금 수업이 변경됨 | **역방향 적용으로 복구 불가** → PITR (5.3) |
| 하드 제약 위반 일정 존재 | 해당 제안 롤백 + EXCLUDE 제약 재검증 |
| 결정론 깨짐 | 엔진 롤백(5.5) + 영향 제안 전부 롤백 |

### 5.2 역방향 적용 (`rollback_token`)

각 `ScheduleProposalApplied` 이벤트는 `rollback_token`(역방향 제안 ID)을 담고 있다.

```sql
-- 롤백 토큰 조회
SELECT o.aggregate_id      AS applied_proposal_id,
       o.payload ->> 'rollback_token' AS rollback_proposal_id,
       o.organization_id,
       o.occurred_at
FROM outbox_events o
WHERE o.event_type = 'ScheduleProposalApplied'
  AND o.occurred_at > now() - interval '6 hours'
  AND o.organization_id = $1
ORDER BY o.occurred_at DESC;
```

```bash
# 역방향 제안 적용 (최신 → 과거 순, 역순으로)
for RB in $ROLLBACK_IDS; do
  curl -s -X POST "$BASE/api/v1/schedule/proposals/$RB:apply" \
    -H "Authorization: Bearer $OPS_TOKEN" \
    -H "Idempotency-Key: $(uuidgen)" \
    -H "X-Reauth-Token: $REAUTH" \
    -d "{\"expected_input_hash\":\"$IN\",\"expected_output_hash\":\"$OUT\"}"
done
```

**순서가 중요하다.** 적용의 역순으로 되돌린다. 순서를 틀리면 `409 STALE_PROPOSAL`이 난다(정상 동작 — 안전장치가 작동한 것).

`409`가 나면 해당 범위를 **재계산**해서 올바른 상태를 새로 만든다.

### 5.3 PITR (완료·잠금 수업이 손상된 경우)

역방향 적용으로는 되돌릴 수 없다. [RB-05](./05-db-failure-pitr.md) 절차를 따르되, 이 사고 특유의 판단:

| 판단 | 내용 |
|---|---|
| 복원 시점 | 첫 잘못된 적용 시각 − 60초 (4-1의 `min(updated_at)`) |
| 전면 vs 부분 | `sessions`·`schedule_change_proposals`만 손상됐다면 **부분 병합 가능** — 단 `sessions`는 EXCLUDE 제약이 있어 병합이 까다롭다. 전면 복원을 우선 검토 |
| 손실 | 복원 시점 이후의 정상 데이터(응시·채점 등)도 사라진다. 영향 계산 후 결정 |

### 5.4 트리거 복구

```sql
ALTER TABLE sessions ENABLE TRIGGER sessions_immutable_when_locked;

-- 확인
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'sessions'::regclass AND NOT tgisinternal;
```

트리거가 아예 없다면 해당 마이그레이션(`NNNNa_*.sql`)을 재실행한다(멱등하므로 안전).

### 5.5 엔진 버전 롤백

```bash
# 워커 환경변수 변경 후 재배포
SCHEDULE_ENGINE_VERSION=2026.07.2   # 직전 안정 버전
```

롤백 후 기존 `proposed` 제안 무효화:

```sql
UPDATE schedule_change_proposals
SET status = 'rejected',
    failure_reason = 'RB-02: 엔진 버전 롤백으로 무효화. 재계산 필요',
    updated_at = now()
WHERE status = 'proposed'
  AND engine_version = $1;   -- 문제 버전
```

### 5.6 kill switch 해제

해제 전 반드시 6장 검증을 전부 통과해야 한다.

```bash
pnpm --filter @su-maek/db kill-switch disable auto_schedule_recalc --actor <이메일>
```

```sql
-- 대기 중인 일정 작업 몰림 방지
UPDATE jobs
SET run_after = now() + (random() * interval '600 seconds')
WHERE status = 'queued' AND queue = 'schedule';
```

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | 완료·잠금 수업 불변 | 4-2 | **0행** |
| V-2 | 교사 시간 충돌 | 4-3 첫 쿼리 | **0행** |
| V-3 | 휴일 배치 | 4-3 두 번째 쿼리 | **0행** |
| V-4 | 하루 학습량 상한 | 4-3 세 번째 쿼리 | **0행** |
| V-5 | 엔진 결정론 | 4-4 | **0행** |
| V-6 | 트리거 활성 | 4-6 | 전부 `tgenabled='O'` |
| V-7 | 활성 일정 버전 정합 | 아래 쿼리 | 0행 |
| V-8 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-9 | 합성 모니터링 | SYN-2 | 3회 연속 성공 |
| V-10 | 표본 교사 확인 | 영향 조직 3곳의 담당 교사에게 일정 확인 요청 | 이상 없음 |

```sql
-- V-7: 활성 루트 버전 정합
SELECT rp.id AS route_plan_id, rp.active_version_id, rv.status
FROM route_plans rp
LEFT JOIN route_versions rv ON rv.id = rp.active_version_id
WHERE rp.active_version_id IS NOT NULL
  AND (rv.id IS NULL OR rv.status <> 'published');
```

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 3개 조직 이상 영향 | **필수** (전체 공지) |
| 단일 조직 영향 | **필수** (해당 조직 개별) |
| 완료 수업 기록 손상 | **필수** + 법률 검토 |
| 롤백으로 완전 복구, 교사가 인지하기 전 | **필수** (변경 이력이 남으므로 숨길 수 없다) |
| 재계산 지연만, 결과는 정확 | 불필요 |

### 초기 공지

> **[수맥] 자동 일정 재계산 오류 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각} (한국 시각 {KST})부터 자동 일정 재계산 기능에서 **의도하지 않은 대량 일정 변경**이 발생한 것을 확인했습니다.
>
> - 영향 범위: {N}개 조직, {N}개 반, 학생 {N}명
> - 변경된 수업: 이동 {N}건 / 신규 {N}건 / 취소 {N}건
> - **완료된 과거 수업 기록과 잠금 처리한 일정은 변경되지 않았습니다.**
> - 시험 응시·채점·성적에는 영향이 없습니다.
>
> **지금 조치한 것**
> - 자동 일정 재계산 기능을 일시 중단했습니다.
> - 수동 일정 편집, 오늘 수업 운영, 시험·채점은 정상 사용하실 수 있습니다.
>
> **지금 하실 일**
> - 다음 주 일정을 학생·학부모에게 안내하기 전에 잠시 기다려 주세요.
> - 이미 안내하셨다면 캘린더 화면에서 변경 이력을 확인해 주세요.
>
> 복구 진행 상황을 {30분 후 시각}에 다시 안내드리겠습니다.

### 진행 중 공지

> **[수맥] 자동 일정 재계산 오류 — 진행 상황 ({N}차)**
>
> - 원인: {확인된 사실만}
> - 조치: 잘못 적용된 일정 변경 {N}건 중 {N}건 되돌리기 완료
> - 남은 작업: {N}건
> - 완료 수업·잠금 일정 손상: 없음 (또는 {구체 내용})
>
> 자동 재계산은 검증이 끝날 때까지 중단 상태를 유지합니다. 수동 편집은 정상 사용 가능합니다.
>
> 다음 안내: {시각}

### 해소 공지

> **[수맥] 자동 일정 재계산 오류 해소 안내**
>
> {UTC 시각}부로 일정이 정상 상태로 복구되었고, 자동 재계산 기능을 재개했습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 발생 시간 | {시작} ~ {종료} |
> | 영향 조직 | {N}개 |
> | 되돌린 일정 변경 | {N}건 |
> | 완료 수업 기록 손상 | 없음 |
> | 성적·채점 영향 | 없음 |
>
> **확인 부탁드립니다**
> - 반 상세 → 일정 탭에서 다음 4주 일정이 의도한 대로인지 확인해 주세요.
> - 변경 이력 탭에서 이번 되돌리기 내역을 보실 수 있습니다.
> - 이상이 있으면 회신해 주세요. 개별 확인해 드리겠습니다.
>
> 상세 원인과 재발 방지 대책은 영업일 5일 이내에 안내드리겠습니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 완료된 수업 기록이 변경·손실됨 | **필요** | 학사 기록 무결성. 조직의 수업 증빙에 영향 |
| 학생에게 잘못된 일정이 통지되어 실제 결석 발생 | **필요** | 조직-학부모 간 분쟁 가능 |
| 시험 일정이 잘못 변경되어 응시 기회 상실 | **필요** | 평가 공정성 |
| 미래 일정만 변경, 롤백 완료 | 불필요 | — |
| 재계산 지연만 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (영업일 5일 이내)
- [ ] 잘못된 결과를 만든 입력을 **골든 시나리오**로 고정했는가 (특정 조직 ID 하드코딩 금지, 최소 재현 형태로)
- [ ] 4-2·4-3·4-4 쿼리가 **일 배치 검증**에 포함되어 있는가
- [ ] 엔진 결정론 속성 테스트가 이 케이스를 잡는가. 못 잡았다면 속성을 추가했는가
- [ ] `mass_schedule_change` 임계값(5,000건/시간)이 적절했는가. 더 빨리 잡을 수 있었는가
- [ ] 트리거가 비활성화됐다면 마이그레이션 절차에 **트리거 복구 검증 단계**를 추가했는가
- [ ] `rollback_token` 역방향 적용이 실제로 동작했는가. 안 됐다면 왜인가
- [ ] 자동 적용(정책 `auto`) 조직 비율을 재검토했는가 — 승인 필요로 전환할 조직이 있는가
- [ ] 엔진 버전 승격 절차(골든 200건 + 그림자 7일 + 카나리)가 지켜졌는가
- [ ] 오류 예산 소진율 기록
