# RB-09 잘못된 교육과정 매핑·릴리스 롤백

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (잘못된 릴리스 발행) / SEV3 (권위 소스 접근 불가) |
| 1차 담당 | 수학 프로그램 책임자(도메인 소유자) + 운영 엔지니어(OE) |
| 에스컬레이션 | 30분 미확인 → 담당자 / 활성 루트·평가에 영향이 확인되면 IC + SEV2 유지 |
| 관련 SLO | O-12 권위 소스 역추적 누락 0건 · 불변 I-16(역추적)·I-17(순환 없음) |
| 관련 kill switch | **`curriculum_release`** |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-14 · [../adr/0011-curriculum-authority-and-releases.md](../adr/0011-curriculum-authority-and-releases.md) · [../phase0/state-machines.md](../phase0/state-machines.md) 5절 |

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `curriculum_gate_failure` | 릴리스 품질 게이트 6종 중 실패 | > 0 | 발행 시도 | SEV2 |
| `curriculum_cycle_detected` | 강한 `PREREQUISITE` 순환 (I-17) | > 0 | 일 배치 | **SEV2** |
| `curriculum_untraceable` | 권위 소스 역추적 누락 (I-16) | > 0 | 일 배치 | **SEV2** |
| `curriculum_orphan_mapping` | 존재하지 않는 노드로 향하는 매핑 | > 0 | 일 배치 | SEV2 |
| `curriculum_source_unreachable` | 권위 소스 수집 실패 | 연속 3회 | 일 배치 | SEV3 |
| `curriculum_checksum_mismatch` | 원문 체크섬 불일치 | > 0 | 일 배치 | SEV3 |
| `deprecated_concept_in_use` | 폐기 개념을 쓰는 활성 루트·평가 | > 0 | 일 배치 | SEV2 |
| `mapping_confidence_drop` | 승인된 매핑의 평균 신뢰도 | < 0.75 | 일 배치 | SEV3 |
| `bulk_approve_spike` | 매핑 일괄 승인 건수 | > 500건 / 1회 | 실시간 | SEV3 (검토 요구) |
| 사용자 신고 | "개념이 잘못 연결됐다" | 2건 이상 | 영업일 | SEV2 |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 잘못된 릴리스가 발행되어 **활성 루트·평가 생성에 사용 중** | **SEV2** |
| 강한 선수 관계 순환으로 일정 엔진 위상 정렬 실패 | **SEV2** |
| 권위 소스 역추적 누락 (I-16 위반) | **SEV2** |
| 매핑 오류로 숙련도 계산이 잘못됨 | **SEV2** |
| 발행 전 게이트에서 차단됨 (정상 동작) | SEV4 |
| 권위 소스 일시 접근 불가, 활성 릴리스 정상 | SEV3 |
| 원문 체크섬 불일치 (원문 개정 가능성) | SEV3 |
| 폐기 개념이 활성 루트에 사용 중 | SEV2 |

**중요**: 게시된 루트·평가는 자기 `curriculum_release_id`를 고정 참조한다([ADR-0008](../adr/0008-route-assessment-question-snapshots.md)). 릴리스 롤백이 이미 게시된 것을 바꾸지 않는다. 영향은 **신규 생성**에만 미친다.

---

## 3. 즉시 중지할 기능

```bash
pnpm --filter @su-maek/db kill-switch enable curriculum_release_publish \
  --reason "RB-09 SEV2 잘못된 릴리스 발행" --actor <이메일>
```

**중지되는 것**: 교육과정 릴리스 발행(`validated → published`).

**중지해도 반드시 되는 것**:

- **활성 릴리스 읽기 전용 사용** — 개념 그래프 탐색, 성취기준 조회, 커리큘럼 스튜디오 전 탭
- 기존 루트·평가의 운영 (자기 릴리스를 고정 참조하므로 무영향)
- 일정 재계산, 시험 생성, 응시, 채점
- 매핑 검수 작업 (승인·수정·거절)
- 새 릴리스의 `imported → validated` 단계 진행

**추가 조치**: 잘못된 릴리스로 신규 루트·평가가 만들어지는 것을 막으려면 롤백(5.2)이 우선이다. kill switch는 **더 이상의 잘못된 발행**만 막는다.

---

## 4. 진단

### 4-1. 릴리스 상태와 활성 여부

```sql
SELECT cr.id, cr.organization_id, cr.curriculum_version_id,
       cv.code AS version_code, cr.release_no, cr.status,
       cr.release_hash, cr.published_at, cr.superseded_by,
       cr.quality_gate_report
FROM curriculum_releases cr
JOIN curriculum_versions cv ON cv.id = cr.curriculum_version_id
WHERE cr.status IN ('published','validated','expert_review')
ORDER BY cr.published_at DESC NULLS LAST
LIMIT 20;
```

### 4-2. 품질 게이트 6종 재실행

```sql
-- G1: 성취기준 코드 중복
SELECT curriculum_version_id, standard_code, count(*) AS dup
FROM achievement_standards
GROUP BY 1,2 HAVING count(*) > 1;

-- G2: 강한 선수 관계 순환 (재귀 CTE)
WITH RECURSIVE walk(start_id, current_id, path, depth) AS (
  SELECT ce.from_concept_id, ce.to_concept_id,
         ARRAY[ce.from_concept_id, ce.to_concept_id], 1
  FROM concept_edges ce
  WHERE ce.relation_type = 'PREREQUISITE' AND ce.review_status = 'approved'
    AND (ce.valid_to IS NULL OR ce.valid_to >= current_date)
  UNION ALL
  SELECT w.start_id, ce.to_concept_id, w.path || ce.to_concept_id, w.depth + 1
  FROM walk w
  JOIN concept_edges ce ON ce.from_concept_id = w.current_id
   AND ce.relation_type = 'PREREQUISITE' AND ce.review_status = 'approved'
   AND (ce.valid_to IS NULL OR ce.valid_to >= current_date)
  WHERE w.depth < 30 AND NOT ce.to_concept_id = ANY(w.path[1:array_length(w.path,1)-1])
)
SELECT DISTINCT start_id, path
FROM walk WHERE current_id = start_id
LIMIT 20;

-- G3: 고아 매핑
SELECT cm.id, cm.curriculum_release_id, cm.official_node_id, cm.canonical_concept_id
FROM curriculum_mappings cm
LEFT JOIN official_curriculum_nodes ocn ON ocn.id = cm.official_node_id
LEFT JOIN canonical_concepts cc         ON cc.id = cm.canonical_concept_id
WHERE cm.curriculum_release_id = $1
  AND (ocn.id IS NULL OR cc.id IS NULL)
LIMIT 50;

-- G4: 근거·검토 상태 없는 내부 개념
SELECT id, slug, label, status, evidence, reviewed_by
FROM canonical_concepts
WHERE status <> 'draft' AND (evidence IS NULL OR reviewed_by IS NULL)
LIMIT 50;

-- G5: 적용 범위 모순 (문항이 적용 범위 밖 개념에 연결)
SELECT qa.id, qa.question_version_id, qa.canonical_concept_id, qa.curriculum_release_id
FROM question_alignments qa
JOIN curriculum_releases cr ON cr.id = qa.curriculum_release_id
LEFT JOIN curriculum_concept_alignments cca
       ON cca.canonical_concept_id = qa.canonical_concept_id
WHERE qa.review_status = 'approved'
  AND cca.id IS NULL
LIMIT 50;

-- G6: 권위 소스 역추적 누락 (I-16)
SELECT 'official_curriculum_nodes' AS tbl, id, official_code AS code
FROM official_curriculum_nodes
WHERE source_id IS NULL OR checksum IS NULL
UNION ALL
SELECT 'achievement_standards', id, standard_code
FROM achievement_standards
WHERE source_id IS NULL OR checksum IS NULL
LIMIT 100;
```

### 4-3. 영향 범위 — 신규 생성에 사용 중인 릴리스

```sql
SELECT cr.id AS release_id, cr.release_no, cr.status,
       count(DISTINCT rv.id) FILTER (WHERE rv.status = 'published') AS published_routes,
       count(DISTINCT rv.id) FILTER (WHERE rv.status IN ('draft','validating','ready')) AS draft_routes,
       count(DISTINCT ai.id) FILTER (WHERE ai.status IN ('generating','draft','ready')) AS pending_assessments,
       count(DISTINCT ai.id) FILTER (WHERE ai.status IN ('published','open','closed','grading','finalized')) AS published_assessments,
       count(DISTINCT qa.question_version_id)                       AS aligned_questions
FROM curriculum_releases cr
LEFT JOIN route_versions rv        ON rv.curriculum_release_id = cr.id
LEFT JOIN assessment_instances ai  ON ai.curriculum_release_id = cr.id
LEFT JOIN question_alignments qa   ON qa.curriculum_release_id = cr.id
WHERE cr.id = $1
GROUP BY 1,2,3;
```

### 4-4. 잘못된 매핑 특정

```sql
SELECT cm.id, cm.target_type, cm.target_id,
       ocn.official_code, ocn.official_label,
       cc.slug AS concept_slug, cc.label AS concept_label,
       cm.relation_type, cm.confidence, cm.evidence,
       cm.reviewed_by, cm.version
FROM curriculum_mappings cm
LEFT JOIN official_curriculum_nodes ocn ON ocn.id = cm.official_node_id
LEFT JOIN canonical_concepts cc         ON cc.id = cm.canonical_concept_id
WHERE cm.curriculum_release_id = $1
  AND cm.confidence < 0.80
ORDER BY cm.confidence
LIMIT 100;
```

### 4-5. AI 제안이 승인 없이 사용됐는가

```sql
SELECT ce.id, ce.from_concept_id, ce.to_concept_id, ce.relation_type,
       ce.origin, ce.review_status, ce.confidence, ce.reviewed_by
FROM concept_edges ce
WHERE ce.origin = 'ai_suggested'
  AND ce.review_status <> 'approved'
  AND EXISTS (
    -- 자동 계획에서 실제로 사용된 흔적
    SELECT 1 FROM route_nodes rn
    WHERE rn.canonical_concept_id IN (ce.from_concept_id, ce.to_concept_id))
LIMIT 50;
```

### 4-6. 폐기 개념 사용 중

```sql
SELECT cc.id, cc.slug, cc.label, cc.status, cc.deprecated_by,
       count(DISTINCT rn.route_version_id)  AS used_in_routes,
       count(DISTINCT qa.question_version_id) AS used_in_questions
FROM canonical_concepts cc
LEFT JOIN route_nodes rn        ON rn.canonical_concept_id = cc.id
LEFT JOIN question_alignments qa ON qa.canonical_concept_id = cc.id
WHERE cc.status = 'deprecated'
GROUP BY 1,2,3,4,5
HAVING count(DISTINCT rn.route_version_id) > 0 OR count(DISTINCT qa.question_version_id) > 0
ORDER BY used_in_routes DESC;
```

### 4-7. 권위 소스 상태

```sql
SELECT cas.id, cas.document_title, cas.issuing_body, cas.notice_number,
       cas.source_url, cas.checksum, cas.fetched_at, cas.review_status,
       cas.priority, cas.effective_from, cas.effective_to,
       now() - cas.fetched_at AS since_fetch
FROM curriculum_authority_sources cas
WHERE cas.review_status IN ('verified','reviewing')
ORDER BY cas.priority, cas.fetched_at DESC;
```

### 4-8. 적용 판정 누락 학생

```sql
SELECT s.organization_id, count(*) AS students_without_applicability
FROM students s
WHERE s.status = 'active' AND s.curriculum_applicability_id IS NULL
GROUP BY 1 ORDER BY 2 DESC;
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | kill switch ON | 3장 | 1분 |
| 2 | 4-1·4-3으로 영향 확정 | 4장 | 15분 |
| 3 | 4-2로 어느 게이트가 뚫렸는지 특정 | 4장 | 15분 |
| 4 | 릴리스 롤백 (5.2) | — | 10분 |
| 5 | 잘못된 매핑 정정 (5.3) | — | 30분~수시간 |
| 6 | 영향받은 신규 루트·평가 처리 (5.4) | — | 30분 |
| 7 | 순환 제거 (필요 시, 5.5) | — | 30분 |
| 8 | 게이트 재실행 + 재발행 (5.6) | — | 30분 |
| 9 | 검증 (6장) | — | 20분 |
| 10 | kill switch 해제 | — | 2분 |

### 5.1 롤백 필요 여부 판단

| 상황 | 조치 |
|---|---|
| 발행 전 게이트 실패 | 롤백 불필요. 매핑 수정 후 재검증 |
| 발행 후, 신규 루트·평가 0건 | **즉시 롤백** (5.2). 영향 없음 |
| 발행 후, 신규 초안 루트·평가 존재 | 롤백 + 해당 초안 재생성 (5.4) |
| 발행 후, 신규 **게시** 루트·평가 존재 | 롤백 + 영향 목록 제공. **게시된 것은 자동 변경하지 않는다** |
| 순환 존재로 일정 엔진 실패 | 순환 제거(5.5)가 롤백보다 우선 |

### 5.2 릴리스 롤백 (활성 포인터 전환)

```sql
BEGIN;

-- 1) 잘못된 릴리스를 superseded로
UPDATE curriculum_releases
SET status = 'superseded', superseded_by = $prev_release_id, updated_at = now()
WHERE id = $bad_release_id AND status = 'published';

-- 2) 이전 릴리스를 다시 published로
UPDATE curriculum_releases
SET status = 'published', superseded_by = NULL, updated_at = now()
WHERE id = $prev_release_id;

-- 3) 감사
INSERT INTO audit_events (organization_id, actor_user_id, actor_kind, action,
                          target_type, target_id, before, after, reason,
                          permission_basis, occurred_at)
VALUES ($org, $actor, 'user', 'curriculum.release_rollback',
        'curriculum_release', $bad_release_id,
        jsonb_build_object('status','published'),
        jsonb_build_object('status','superseded','rolled_back_to',$prev_release_id),
        'RB-09: {구체 사유}', 'program_director', now());

COMMIT;
```

**롤백은 포인터 전환 하나로 끝난다.** 이것이 릴리스를 원자적 발행 단위로 만든 실용적 가치다.

### 5.3 잘못된 매핑 정정

```sql
-- 매핑 무효화 (삭제하지 않고 valid_to 설정 + 새 버전)
UPDATE curriculum_mappings
SET valid_to = current_date, updated_at = now()
WHERE id = ANY($1::uuid[]);

-- 간선 승인 철회
UPDATE concept_edges
SET review_status = 'rejected',
    valid_to = current_date,
    updated_at = now()
WHERE id = ANY($2::uuid[]);
```

**삭제하지 않는다.** 과거 판단의 이력을 남긴다.

### 5.4 영향받은 신규 루트·평가 처리

```sql
-- 초안 상태 루트를 검증 필요로 되돌림
UPDATE route_versions
SET status = 'needs_fix',
    validation_report = COALESCE(validation_report, '{}'::jsonb)
      || jsonb_build_object('rb09_note','교육과정 릴리스 롤백으로 재검증 필요'),
    updated_at = now()
WHERE curriculum_release_id = $bad_release_id
  AND status IN ('draft','validating','ready');

-- 미완료 평가를 검토 필요로
UPDATE assessment_instances
SET status = 'review_required', updated_at = now(), version = version + 1
WHERE curriculum_release_id = $bad_release_id
  AND status IN ('generating','draft','ready');
```

**게시된 루트·평가는 건드리지 않는다.** 자기 릴리스를 고정 참조하므로 정상 동작하며, 영향 목록만 담당자에게 제공한다.

```sql
-- 게시된 것의 영향 목록 (통지용)
SELECT rv.id AS route_version_id, rv.route_plan_id, rp.learning_group_id,
       rv.version_no, rv.published_at
FROM route_versions rv
JOIN route_plans rp ON rp.id = rv.route_plan_id
WHERE rv.curriculum_release_id = $bad_release_id
  AND rv.status = 'published';
```

### 5.5 순환 제거

4-2의 G2 쿼리로 순환 경로를 확보한 뒤, 경로 위의 간선 중 **근거가 가장 약한 것**을 `SOFT_PREREQUISITE`로 강등하거나 승인 철회한다.

```sql
-- 순환 경로 위 간선의 근거 강도 확인
SELECT ce.id, ce.from_concept_id, ce.to_concept_id,
       ce.confidence, ce.evidence, ce.origin, ce.reviewed_by, ce.reviewed_on
FROM concept_edges ce
WHERE ce.relation_type = 'PREREQUISITE'
  AND ce.review_status = 'approved'
  AND ce.from_concept_id = ANY($1::uuid[])
  AND ce.to_concept_id = ANY($1::uuid[])
ORDER BY ce.confidence;

-- 강등
UPDATE concept_edges
SET relation_type = 'SOFT_PREREQUISITE',
    evidence = COALESCE(evidence,'') || ' | RB-09: 순환 제거를 위해 강한 선수에서 강등',
    updated_at = now()
WHERE id = $2;
```

**임의로 지우지 않는다.** 어느 간선이 잘못됐는지 도메인 소유자가 판단한다.

### 5.6 재발행

```bash
# 게이트 재실행
curl -s -X POST "$BASE/api/v1/curriculum/releases/$RELEASE_ID:validate" \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)"

# 통과 후 kill switch 해제하고 발행
pnpm --filter @su-maek/db kill-switch disable curriculum_release_publish --actor <이메일>

curl -s -X POST "$BASE/api/v1/curriculum/releases/$RELEASE_ID:publish" \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H "If-Match: \"$VERSION\"" -H "X-Reauth-Token: $REAUTH"
```

### 5.7 권위 소스 접근 불가 (SEV3)

| # | 조치 |
|---|---|
| 1 | 4-7로 마지막 성공 수집 시각 확인 |
| 2 | 원문 URL 직접 접근 테스트 (URL 변경 여부) |
| 3 | URL이 바뀌었으면 새 `curriculum_authority_sources` 행 추가. **기존 행은 `superseded`로 두고 삭제하지 않는다** |
| 4 | 체크섬이 다르면 원문 개정 가능성 → 차이 분석 → 새 릴리스 절차 |
| 5 | **활성 릴리스는 계속 읽기 전용으로 동작한다.** 새 발행만 차단 |

---

## 6. 검증

| # | 항목 | 검증 쿼리 | 통과 조건 |
|---|---|---|---|
| V-1 | 활성 릴리스 1개 | `SELECT organization_id, curriculum_version_id, count(*) FROM curriculum_releases WHERE status='published' GROUP BY 1,2 HAVING count(*)>1` | **0행** |
| V-2 | 성취기준 코드 중복 | 4-2 G1 | 0행 |
| V-3 | 선수 관계 순환 | 4-2 G2 | **0행** |
| V-4 | 고아 매핑 | 4-2 G3 | 0행 |
| V-5 | 근거 없는 개념 | 4-2 G4 | 0행 |
| V-6 | 적용 범위 모순 | 4-2 G5 | 0행 |
| V-7 | 권위 소스 역추적 | 4-2 G6 | **0행** |
| V-8 | AI 제안 무단 사용 | 4-5 | 0행 |
| V-9 | 폐기 개념 사용 | 4-6 | 0행 또는 마이그레이션 계획 존재 |
| V-10 | 게시된 루트·평가 불변 | 5.4 마지막 쿼리 실행 전후 비교 | 상태·해시 변화 없음 |
| V-11 | 일정 엔진 정상 | SYN-2 합성 모니터링 | 3회 연속 성공 |
| V-12 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-13 | 표본 개념 검토 | 도메인 소유자가 영향 개념 10건 육안 확인 | 이상 없음 |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 잘못된 릴리스로 **게시된** 루트·평가가 생성됨 | **필수** (영향 조직) |
| 매핑 오류로 숙련도 계산이 잘못됨 | **필수** (영향 조직) |
| 초안 루트·평가만 영향, 재생성으로 해결 | 필요 시 (해당 조직) |
| 발행 전 게이트에서 차단 | 불필요 |
| 권위 소스 일시 접근 불가, 활성 릴리스 정상 | 불필요 |

### 초기 공지

> **[수맥] 교육과정 데이터 오류 안내 — {조직명}**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}, 교육과정 릴리스 {버전}에서 **개념 연결 오류**를 확인했습니다.
>
> **확인된 문제**
> - {구체적으로. 예: "'일차함수의 그래프' 개념이 중2가 아닌 중3 성취기준에 잘못 연결됨"}
> - 영향받은 개념: {N}개
>
> **영향 범위**
> - 이 릴리스로 새로 만든 루트 초안: {N}건 → 재검증 필요 상태로 전환
> - 새로 만든 시험 (미게시): {N}건 → 검토 필요 상태로 전환
> - **이미 게시된 루트와 시험**: {N}건 — 각자 발행 당시 교육과정을 고정 참조하므로 **변경되지 않습니다**
> - **완료된 응시와 성적**: 영향 없음
>
> **조치 완료**
> - 문제 릴리스를 이전 버전으로 되돌렸습니다.
> - 신규 교육과정 발행을 일시 중단했습니다.
>
> **지금 하실 일**
> 1. 업무함에서 "재검증 필요" 상태의 루트를 확인해 주세요.
> 2. 검토 필요 상태의 시험은 문항 구성을 확인 후 다시 게시해 주세요.
> 3. 이미 진행 중인 수업과 시험은 그대로 진행하셔도 됩니다.
>
> 정정된 릴리스는 검증 후 {예상 시각}에 발행할 예정입니다.

### 해소 공지

> **[수맥] 교육과정 데이터 정정 완료 안내**
>
> {UTC 시각}부로 교육과정 릴리스 {새 버전}을 발행했습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 정정된 개념 연결 | {N}건 |
> | 영향받은 루트 초안 | {N}건 (재검증 완료) |
> | 영향받은 시험 | {N}건 (재게시 완료) |
> | 게시된 루트·시험 | 변경 없음 |
> | 완료된 성적·학습 기록 | 영향 없음 |
>
> **확인 부탁드립니다**
> - 커리큘럼 스튜디오 → 버전 비교 탭에서 변경 내역을 보실 수 있습니다.
> - 재검증된 루트의 개념 순서가 의도대로인지 확인해 주세요.
>
> 상세 원인과 재발 방지 대책은 별도로 안내드리겠습니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 공식 성취기준 문구가 원문과 다르게 표시됨 | **필요** | 교육과정 정보의 정확성. 교육 당국 관련 |
| 권위 소스 원문을 재배포한 정황 | **필요** | 저작·이용 범위 (Q-02) |
| 잘못된 교육과정 정보로 조직이 대외 홍보 | **필요** | 표시·광고 |
| 내부 개념·매핑 오류만 | 불필요 | — |
| 권위 소스 접근 불가 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV2 기준)
- [ ] **품질 게이트 6종 중 무엇이 오류를 못 잡았는가.** 게이트를 보강했는가
- [ ] 전문가 검토 단계에서 왜 놓쳤는가. 표본 검토 비율이 충분했는가
- [ ] 매핑 일괄 승인(500건 초과)이 원인이었다면 표본 검토 요구를 강화했는가
- [ ] AI 제안 매핑이 승인 없이 사용된 경로가 있었는가 (4-5)
- [ ] `approved_concept_edges` 뷰를 우회한 쿼리가 있었는가
- [ ] 순환 검사가 발행 전에 실행됐는가. 실행됐는데 못 잡았다면 쿼리를 수정
- [ ] 권위 소스 체크섬 검증이 작동했는가
- [ ] 롤백이 포인터 전환만으로 끝났는가. 부수 작업이 필요했다면 왜인가
- [ ] 게시된 루트·평가가 실제로 영향받지 않았는지 확인했는가 (V-10)
- [ ] 폐기 개념 사용 탐지(4-6)를 일 배치에 포함했는가
- [ ] 적용 판정 누락 학생(4-8)이 있으면 온보딩 필수 입력을 점검했는가
- [ ] 새 오류 유형을 골든 시나리오로 고정했는가
