# RB-08 콘텐츠 권한 만료·긴급 게시 중단

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (침해 신고·긴급 중단) / SEV3 (예정된 만료) |
| 1차 담당 | 콘텐츠 관리자 + 운영 엔지니어(OE) |
| 에스컬레이션 | 침해 신고 접수 시 **즉시 법률 검토** / 24시간 내 `suspended` 전환 필수 / 대량 영향 시 IC |
| 관련 SLO | 불변 I-07(권한 유효 문항만 평가에 포함) · I-13(격리해도 과거 기록 보존) |
| 관련 kill switch | `auto_question_publish` |
| 관련 문서 | [../phase0/threat-model.md](../phase0/threat-model.md) 9장 · [../phase0/sequences.md](../phase0/sequences.md) S-8 · [../adr/0014-content-rights-enforcement.md](../adr/0014-content-rights-enforcement.md) |

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `rights_takedown_notice` | 침해 신고 접수 (`/content-policy` 폼) | 1건 | 즉시 | **SEV2** |
| `rights_expiry_impact` | `ContentRightsRevoked`로 영향받는 미완료 평가 | > 0 | 실시간 | SEV2 |
| `rights_expiring_soon` | `valid_to`가 30일 이내 | > 0 | 일 배치 | SEV3 |
| `rights_expired_auto` | 일 배치가 `expired`로 전환한 건수 | > 0 | 일 배치 | SEV3 |
| `insufficient_questions_spike` | `INSUFFICIENT_QUESTIONS` 응답 | > 20건 | 1시간 | SEV2 |
| `unverified_rights_publish_attempt` | 권한 미확인 문항 게시 시도 (`RIGHTS_NOT_ALLOWED`) | > 10건 | 1시간 | SEV3 |
| `eligible_pool_shrink` | `eligible_question_versions` 행 수 급감 | 24시간 내 20% 감소 | 일 배치 | SEV2 |
| 불변 I-07 위반 | 권한 무효 문항이 게시된 평가에 존재 | > 0 | 일 배치 | **SEV1** |
| 출판사 직접 연락 | 이메일·전화 | 1건 | 즉시 | **SEV2** |

---

## 2. 심각도 판정

| 조건 | 심각도 | 대응 시한 |
|---|---|---|
| 불변 I-07 위반 (권한 없는 문항이 게시된 평가에 존재) | **SEV1** | 즉시 |
| 침해 신고 접수 | **SEV2** | **24시간 내 `suspended`** |
| 출판사 직접 중단 요구 | **SEV2** | 24시간 내 |
| 대량 만료로 자동 출제 불가 (3개 조직 이상) | SEV2 | 4시간 |
| 단일 조직 만료, 대체 문항 있음 | SEV3 | 영업일 |
| 만료 30일 전 경고 | SEV3 | 영업일 |
| 권한 미확인 문항 게시 시도 차단됨 (정상 동작) | SEV4 | — |

---

## 3. 즉시 중지할 기능

### 3.1 침해 신고·긴급 중단

**24시간 내 `suspended` 전환이 계약이다. 검토는 나중에 한다.**

```sql
-- 1. 권한 상태 즉시 중지
UPDATE content_rights
SET status = 'suspended',
    suspend_reason = 'RB-08: 침해 신고 접수 ({접수번호})',
    updated_at = now(), version = version + 1
WHERE id = $1;
```

이 UPDATE가 `ContentRightsRevoked` 이벤트를 발행하고, `content-gatekeeper` 소비자가 자동으로:

1. 자동 출제 풀 제외 (`eligible_question_versions` 뷰 자동 반영)
2. 미완료 평가에서 문항 제외·대체
3. 활성 서명 URL 폐기
4. 캐시된 출력 산출물 삭제 (메타·체크섬 보존)
5. 검색 인덱스에서 제외

### 3.2 대량 영향 시 보조

```bash
pnpm --filter @su-maek/db kill-switch enable auto_question_publish \
  --reason "RB-08 권한 대량 철회 — 게시 일시 중단" --actor <이메일>
```

**중지해도 반드시 되는 것**:

- 이미 게시된 평가의 응시·제출·채점 (게시 스냅샷은 불변)
- 완료된 응시의 성적·감사 조회
- 다른 판본 기반 문항의 자동 출제
- 문제은행 조회 (권한 상태 표시와 함께)
- 오늘 수업 운영, 일정 관리
- 수동 문항 편집·검수

**절대 하지 않는 것**:

- 완료된 응시의 점수·감사·출처 식별 기록 삭제 (불변 I-13)
- `assessment_questions` 게시 스냅샷 삭제
- 원본 파일 즉시 삭제 (분쟁 대응·재검토를 위해 30일 보존)

---

## 4. 진단

### 4-1. 영향 범위 — 문항·평가·학생

```sql
WITH target AS (SELECT $1::uuid AS right_id)
SELECT
  (SELECT count(*) FROM question_versions qv, target t
    WHERE qv.content_right_id = t.right_id)                              AS total_versions,
  (SELECT count(*) FROM question_versions qv, target t
    WHERE qv.content_right_id = t.right_id AND qv.status = 'published')  AS published_versions,
  (SELECT count(DISTINCT ai.id)
     FROM assessment_questions aq
     JOIN question_versions qv ON qv.id = aq.question_version_id
     JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id, target t
    WHERE qv.content_right_id = t.right_id
      AND ai.status IN ('generating','draft','ready'))                   AS pending_assessments,
  (SELECT count(DISTINCT ai.id)
     FROM assessment_questions aq
     JOIN question_versions qv ON qv.id = aq.question_version_id
     JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id, target t
    WHERE qv.content_right_id = t.right_id
      AND ai.status IN ('published','open','closed','grading','finalized')) AS published_assessments,
  (SELECT count(DISTINCT a.student_id)
     FROM assessment_questions aq
     JOIN question_versions qv ON qv.id = aq.question_version_id
     JOIN attempts a ON a.assessment_instance_id = aq.assessment_instance_id, target t
    WHERE qv.content_right_id = t.right_id)                              AS affected_students;
```

### 4-2. 미완료 평가 (즉시 조치 대상)

```sql
SELECT ai.id AS assessment_instance_id, ai.organization_id, ai.kind,
       ai.status, ai.scheduled_on,
       count(*)                                              AS total_questions,
       count(*) FILTER (WHERE qv.content_right_id = $1)      AS affected_questions
FROM assessment_instances ai
JOIN assessment_questions aq ON aq.assessment_instance_id = ai.id
JOIN question_versions qv    ON qv.id = aq.question_version_id
WHERE ai.status IN ('generating','draft','ready')
GROUP BY 1,2,3,4,5
HAVING count(*) FILTER (WHERE qv.content_right_id = $1) > 0
ORDER BY ai.scheduled_on;
```

### 4-3. 게시된 평가 (영향 분석 대상 — 건드리지 않는다)

```sql
SELECT ai.id, ai.organization_id, ai.kind, ai.status, ai.published_at,
       count(*) FILTER (WHERE qv.content_right_id = $1) AS affected_questions,
       count(DISTINCT a.id)                             AS attempts,
       count(DISTINCT a.student_id)                     AS students
FROM assessment_instances ai
JOIN assessment_questions aq ON aq.assessment_instance_id = ai.id
JOIN question_versions qv    ON qv.id = aq.question_version_id
LEFT JOIN attempts a         ON a.assessment_instance_id = ai.id
WHERE ai.status IN ('published','open','closed','grading','finalized')
GROUP BY 1,2,3,4,5
HAVING count(*) FILTER (WHERE qv.content_right_id = $1) > 0
ORDER BY ai.published_at DESC;
```

### 4-4. 활성 산출물·서명 URL

```sql
SELECT de.id, de.organization_id, de.assessment_instance_id,
       de.format, de.status, de.storage_path, de.expires_at
FROM document_exports de
JOIN assessment_questions aq ON aq.assessment_instance_id = de.assessment_instance_id
JOIN question_versions qv    ON qv.id = aq.question_version_id
WHERE qv.content_right_id = $1
  AND de.status = 'ready'
  AND (de.expires_at IS NULL OR de.expires_at > now())
GROUP BY de.id
ORDER BY de.created_at DESC;
```

### 4-5. 만료 임박 (예방)

```sql
SELECT cr.id, cr.organization_id, cr.book_edition_id,
       p.name AS publisher, b.title AS book, be.edition_label,
       cr.status, cr.valid_to,
       (cr.valid_to - current_date)                              AS days_left,
       count(DISTINCT qv.id) FILTER (WHERE qv.status='published') AS published_questions,
       count(DISTINCT aq.assessment_instance_id)                  AS used_in_assessments
FROM content_rights cr
JOIN book_editions be ON be.id = cr.book_edition_id
JOIN books b          ON b.id = be.book_id
JOIN publishers p     ON p.id = b.publisher_id
LEFT JOIN question_versions qv ON qv.content_right_id = cr.id
LEFT JOIN assessment_questions aq ON aq.question_version_id = qv.id
WHERE cr.status IN ('allowed','restricted')
  AND cr.valid_to IS NOT NULL
  AND cr.valid_to <= current_date + interval '30 days'
GROUP BY 1,2,3,4,5,6,7,8
ORDER BY cr.valid_to;
```

### 4-6. 자동 출제 풀 잔량 (대체 가능성)

```sql
SELECT qa.canonical_concept_id, cc.label AS concept,
       count(*) FILTER (WHERE cr.status = 'allowed')                    AS available_now,
       count(*) FILTER (WHERE cr.id = $1)                               AS losing,
       count(*) FILTER (WHERE cr.status = 'allowed' AND cr.id <> $1)    AS remaining
FROM question_versions qv
JOIN questions q                ON q.id = qv.question_id
JOIN question_alignments qa     ON qa.question_version_id = qv.id
JOIN canonical_concepts cc      ON cc.id = qa.canonical_concept_id
JOIN content_rights cr          ON cr.id = qv.content_right_id
WHERE qv.status = 'published' AND qv.publish_gate_status = 'passed'
  AND q.lifecycle = 'active' AND qa.review_status = 'approved'
GROUP BY 1,2
HAVING count(*) FILTER (WHERE cr.id = $1) > 0
ORDER BY remaining ASC
LIMIT 50;
```

**`remaining`이 5 미만인 개념은 자동 출제가 실패한다.**

### 4-7. 불변 I-07 검증

```sql
-- 권한이 무효인데 게시된 평가에 포함된 문항
SELECT aq.id AS assessment_question_id, aq.assessment_instance_id,
       ai.status AS assessment_status, ai.published_at,
       qv.id AS question_version_id, cr.status AS rights_status, cr.valid_to
FROM assessment_questions aq
JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id
JOIN question_versions qv    ON qv.id = aq.question_version_id
JOIN content_rights cr       ON cr.id = qv.content_right_id
WHERE ai.status IN ('generating','draft','ready')     -- 미완료만 대상
  AND (cr.status <> 'allowed' OR (cr.valid_to IS NOT NULL AND cr.valid_to < current_date))
LIMIT 100;
```

> 게시 완료(`published` 이상)된 평가는 스냅샷이므로 이 검사 대상이 아니다. 게시 시점에 권한이 유효했다면 정상이다.

---

## 5. 복구 절차

### 5.A 침해 신고·긴급 중단

| # | 조치 | 명령·SQL | 시한 |
|---|---|---|---|
| 1 | 신고 접수 기록 (접수번호 발급) | — | 즉시 |
| 2 | **법률 검토 착수 통지** | — | 즉시 |
| 3 | 4-1로 영향 범위 산출 | 4장 | 30분 |
| 4 | **`suspended` 전환** | 3.1 | **24시간 이내** |
| 5 | 전파 확인 (5.1) | — | 1시간 |
| 6 | 미완료 평가 문항 대체 (5.2) | — | 4시간 |
| 7 | 산출물·서명 URL 폐기 확인 (5.3) | — | 1시간 |
| 8 | 영향 조직 통지 | 7장 | 24시간 |
| 9 | 법률 검토 결과에 따라 `reviewing` → 복귀 또는 영구 중지 | — | 가변 |

### 5.1 전파 확인

`ContentRightsRevoked` 이벤트가 소비됐는지 확인한다.

```sql
SELECT o.id, o.event_type, o.status, o.created_at, o.attempt_count, o.last_error
FROM outbox_events o
WHERE o.event_type = 'ContentRightsRevoked'
  AND o.aggregate_id = $1
ORDER BY o.created_at DESC LIMIT 5;

SELECT im.consumer_name, im.outcome, im.processed_at
FROM inbox_messages im
WHERE im.event_id = $2   -- 위 쿼리의 event id
ORDER BY im.processed_at;
```

소비자 `content-gatekeeper`·`assessment-generator`·`read-model`이 전부 처리했어야 한다.

### 5.2 미완료 평가 문항 대체

```sql
-- 자동 대체 작업 등록 (평가별)
INSERT INTO jobs (id, organization_id, queue, job_type, priority, status,
                  run_after, attempt_count, max_attempts,
                  idempotency_key, input_hash, input, created_at, updated_at)
SELECT uuidv7(), ai.organization_id, 'schedule', 'assessment.replace_questions', 80, 'queued',
       now() + (random() * interval '120 seconds'), 0, 3,
       'rb08:' || ai.id::text || ':' || $1::text,
       encode(digest(ai.id::text || $1::text, 'sha256'), 'hex'),
       jsonb_build_object('assessment_instance_id', ai.id, 'excluded_content_right_id', $1),
       now(), now()
FROM assessment_instances ai
WHERE ai.id = ANY($2::uuid[])
ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING;
```

대체 문항이 없으면 `assessment_instances.status='review_required'`가 되고 교사에게 알림이 간다(정상 동작).

### 5.3 산출물·서명 URL 폐기

```sql
-- 산출물 만료 처리 (메타는 보존)
UPDATE document_exports
SET expires_at = now(), updated_at = now()
WHERE id = ANY($1::uuid[]);
```

```bash
# Storage 객체 삭제
node scripts/purge-exports.mjs --export-ids="$EXPORT_IDS" --reason="RB-08"
```

### 5.B 예정된 만료

| # | 조치 | 시한 |
|---|---|---|
| 1 | 4-5로 30일 이내 만료 목록 확보 | 일 배치 |
| 2 | 4-6으로 대체 가능성 확인 | 30일 전 |
| 3 | 콘텐츠 관리자에게 갱신 요청 알림 | 30일 전 |
| 4 | 계약 갱신 시 `valid_to` 연장 (5.4) | 만료 전 |
| 5 | 갱신 불가 시 대체 문항 확보 또는 블루프린트 조정 | 만료 전 |
| 6 | 만료 당일 자동 전환 확인 | 만료일 |

```sql
-- 5.4 계약 갱신
UPDATE content_rights
SET valid_to = $2, status = 'allowed',
    reviewed_by = $3, reviewed_at = now(),
    updated_at = now(), version = version + 1
WHERE id = $1;
```

감사 기록 필수:

```sql
INSERT INTO audit_events (organization_id, actor_user_id, actor_kind, action,
                          target_type, target_id, before, after, reason,
                          permission_basis, occurred_at)
VALUES ($org, $actor, 'user', 'rights.allow', 'content_right', $1,
        jsonb_build_object('valid_to', $old_valid_to, 'status', $old_status),
        jsonb_build_object('valid_to', $2, 'status', 'allowed'),
        '계약 갱신 ({계약번호})', 'content_manager', now());
```

### 5.C 복구 (분쟁 해소 후)

```sql
-- suspended → reviewing → allowed
UPDATE content_rights
SET status = 'reviewing', suspend_reason = NULL,
    updated_at = now(), version = version + 1
WHERE id = $1;

-- 검토 완료 후
UPDATE content_rights
SET status = 'allowed', reviewed_by = $2, reviewed_at = now(),
    updated_at = now(), version = version + 1
WHERE id = $1;
```

**격리된 문항 복구**:

```sql
UPDATE questions
SET lifecycle = 'active', quarantine_reason = NULL, quarantined_at = NULL, updated_at = now()
WHERE id IN (
  SELECT DISTINCT q.id FROM questions q
  JOIN question_versions qv ON qv.question_id = q.id
  WHERE qv.content_right_id = $1
    AND q.lifecycle = 'quarantined'
    AND q.quarantine_reason LIKE 'RB-08%'
);
```

삭제된 산출물은 **스냅샷이 고정되어 있으므로 결정론적으로 재생성**된다. 재요청 시 같은 체크섬이 나오는지 검증한다.

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | 권한 상태 전환 | `SELECT status FROM content_rights WHERE id=$1` | `suspended` (또는 목표 상태) |
| V-2 | 자동 출제 풀 제외 | `SELECT count(*) FROM eligible_question_versions WHERE content_right_id=$1` | **0** |
| V-3 | 이벤트 전파 | 5.1 | 전 소비자 `applied` |
| V-4 | 미완료 평가 처리 | 4-2 | 대체 완료 또는 `review_required` |
| V-5 | 불변 I-07 | 4-7 | **0행** |
| V-6 | 산출물 폐기 | 4-4 | 0행 |
| V-7 | 서명 URL 무효 | 폐기된 URL로 접근 시도 | 403/404 |
| V-8 | **게시된 평가 스냅샷 불변** | 아래 쿼리 | 행 수·해시 변화 없음 |
| V-9 | **완료 응시 기록 보존** (I-13) | 아래 쿼리 | 행 수 변화 없음 |
| V-10 | 문항 부족 여부 | 4-6 | `remaining` ≥ 5 인 개념 비율 확인 |
| V-11 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |

```sql
-- V-8: 게시 스냅샷 불변 확인 (사고 전 기록과 대조)
SELECT ai.id, ai.snapshot_hash, count(aq.id) AS question_count
FROM assessment_instances ai
JOIN assessment_questions aq ON aq.assessment_instance_id = ai.id
WHERE ai.status IN ('published','open','closed','grading','finalized')
  AND ai.id = ANY($1::uuid[])
GROUP BY 1,2;

-- V-9: 완료 응시·채점 기록 보존
SELECT count(*) AS attempts, count(DISTINCT student_id) AS students
FROM attempts WHERE assessment_instance_id = ANY($1::uuid[]);

SELECT count(*) AS grade_decisions
FROM grade_decisions gd
JOIN responses r ON r.id = gd.response_id
JOIN attempts a ON a.id = r.attempt_id
WHERE a.assessment_instance_id = ANY($1::uuid[]);
```

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 침해 신고로 긴급 중단 | **필수** (영향 조직) + 법률 검토 |
| 대량 만료로 자동 출제 불가 | **필수** (영향 조직) |
| 미완료 시험의 문항이 교체됨 | **필수** (해당 조직) |
| 예정된 만료, 대체 확보됨 | 30일 전 사전 안내 |
| 게시된 시험만 영향, 응시 정상 | 불필요 (내부 처리) |

### 사전 안내 (만료 30일 전)

> **[수맥] 교재 사용 권한 만료 예정 안내 — {조직명}**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> 아래 교재의 사용 권한이 **{만료일}에 만료**될 예정입니다.
>
> | 교재 | 판본 | 만료일 | 게시 문항 | 사용 중인 시험 |
> |---|---|---|---|---|
> | {교재명} | {판본} | {날짜} | {N}개 | {N}건 |
>
> **만료 후 변경되는 것**
> - 해당 교재 문항이 **자동 출제 풀에서 제외**됩니다.
> - 새 시험지·해설지 출력이 중단됩니다.
> - **이미 게시된 시험과 완료된 응시·성적은 그대로 유지됩니다.**
>
> **지금 하실 일**
> 1. 계약 갱신을 계획하고 계시면 회신해 주세요. 갱신 정보를 등록해 드립니다.
> 2. 갱신 계획이 없으시면 대체 교재를 등록해 주세요.
> 3. 만료 후 문항이 부족해질 개념: {개념 목록} — 미리 확인해 주세요.

### 긴급 중단 공지

> **[수맥] 교재 사용 권한 긴급 중단 안내 — 중요**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}부로 아래 교재의 사용 권한을 **긴급 중단**했습니다.
>
> | 교재 | 판본 | 사유 |
> |---|---|---|
> | {교재명} | {판본} | 권리자 요청에 따른 사용 중단 |
>
> **즉시 적용된 조치**
> - 해당 교재 문항의 자동 출제 중단
> - 생성 중이던 시험 {N}건에서 해당 문항 제외·대체
> - 시험지·해설지 다운로드 링크 폐기
>
> **영향받지 않는 것**
> - 이미 게시된 시험의 응시·제출·채점
> - 완료된 응시의 성적과 학습 기록
> - 다른 교재 기반 문항의 출제
>
> **지금 하실 일**
> 1. 생성 중이던 시험 {N}건의 문항 구성이 바뀌었습니다. 시험 상세에서 확인해 주세요.
> 2. 문항이 부족해 생성이 중단된 시험이 {N}건 있습니다. 업무함에서 확인 후 대체 문항을 지정해 주세요.
> 3. 이미 인쇄하신 시험지는 그대로 사용하실 수 있습니다.
>
> 문의사항은 회신해 주세요.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| **침해 신고 접수** | **필수 — 즉시** | 대응 방침·통지 문안·복구 조건 |
| 출판사 직접 중단 요구 | **필수** | 계약 해석 |
| 계약 분쟁 | **필수** | — |
| 이미 배포된 인쇄물의 회수 요구 | **필수** | 실행 가능성·의무 범위 |
| AI 변형 문항의 침해 주장 | **필수** | 계보·유사도 근거 제출 |
| 예정된 만료, 갱신 진행 | 불필요 | — |

**주의**: 수맥은 권한을 **기록하고 집행**할 뿐, 권리 확보 자체를 보증하지 않는다. 공지에서 "저작권 문제 없음" 같은 표현을 쓰지 않는다.

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV2 기준)
- [ ] **24시간 내 `suspended` 전환을 지켰는가**
- [ ] 만료 30일 전 경고가 실제로 발송됐는가. 놓쳤다면 왜인가
- [ ] `eligible_question_versions` 뷰가 자동으로 반영했는가. 우회 경로는 없었나
- [ ] 미완료 평가 대체가 자동으로 됐는가. 실패율은
- [ ] 서명 URL·캐시 산출물 폐기가 완전했는가
- [ ] 게시 스냅샷과 완료 응시 기록이 보존됐는가 (V-8·V-9)
- [ ] 문항 부족으로 시험 생성이 실패한 조직에 대체 방안을 제공했는가
- [ ] 특정 판본 의존도가 너무 높은 개념이 있는가. 다변화 필요성 검토
- [ ] AI 변형 문항의 계보(`derived_from_version_id`)가 전부 기록되어 있었는가
- [ ] 침해 신고 접수 창구(`/content-policy`)가 실제로 작동했는가
- [ ] 계약 증빙(`contract_evidence_path`) 검토 절차가 형식적이지 않았는가
