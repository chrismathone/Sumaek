# RB-10 학생 화면의 수식 깨짐·렌더러 긴급 롤백

| 항목 | 값 |
|---|---|
| 심각도 | **SEV1** (학생 게시 콘텐츠에서 깨짐) / SEV2 (골든 회귀 실패·승격 중) |
| 1차 담당 | 운영 엔지니어(OE) + 콘텐츠 관리자 |
| 에스컬레이션 | 5분 미확인 → IC / 시험 시간대면 [RB-01](./01-exam-start-submit-failure.md) 병행 / 30분 → 고객 공지 |
| 관련 SLO | **O-11 게시 콘텐츠 원시 LaTeX·`katex-error`·필수 수식 누락 0건** · O-06 KaTeX 검증 95% 5초 |
| 관련 kill switch | **`formula_autofix`**, `auto_publish_questions`, `document_export` |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-12 · [../adr/0013-renderer-versions-and-publish-gate.md](../adr/0013-renderer-versions-and-publish-gate.md) · [../adr/0012-structured-math-content-and-latex.md](../adr/0012-structured-math-content-and-latex.md) |

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `formula_broken_in_student_view` | 게시 콘텐츠에서 `katex-error`·원시 LaTeX·빈 수식 노드 탐지 | > 0 | 실시간 | **SEV1** |
| `render_regression` | 골든 코퍼스 회귀 실패 (승격 중) | > 0 | 승격 시 | SEV2 |
| `formula_parse_failure_spike` | `sumaek_formula_parse_failures_total` 비율 | > 5% | 30분 | SEV2 |
| `render_mismatch` | web·pdf·hwpx 의미 지문 불일치 | > 10건 | 1시간 | SEV2 |
| `render_validation_failure` | `math_render_artifacts.validation_status='failed'` | > 20건 | 1시간 | SEV2 |
| `unsupported_command_spike` | 미지원 명령 발생 | > 50건 | 1시간 | SEV3 |
| `formula_review_backlog` | `formula_reviews.status='open'` | > 500건 | 일 배치 | SEV3 |
| `attempt_render_failure` | 응시 중 렌더 실패 보고 | > 0 | 실시간 | **SEV1** |
| 불변 I-18 위반 | 게시 게이트 미통과 문항이 게시된 평가에 존재 | > 0 | 일 배치 | **SEV1** |
| 사용자 신고 | "학생 화면에 수식이 깨져 보인다" | 1건 | 즉시 | **SEV1** |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| **진행 중인 시험**의 학생 화면에서 수식 깨짐 | **SEV1** (+ [RB-01](./01-exam-start-submit-failure.md) 병행) |
| 게시된 콘텐츠에서 원시 LaTeX·`katex-error` 노출 | **SEV1** |
| 불변 I-18 위반 (게이트 미통과 문항이 게시됨) | **SEV1** |
| 렌더러 승격 중 골든 회귀 실패 | SEV2 (승격 중단으로 해결) |
| PDF·HWPX 산출물만 깨짐, 온라인 응시 정상 | SEV2 (→ [RB-11](./11-document-export-failure.md)) |
| 검수 대기 문항의 렌더 실패 (게시 전) | SEV3 (정상 동작) |
| 미지원 명령 급증, 검수로 처리 중 | SEV3 |

---

## 3. 즉시 중지할 기능

### 3.1 학생 화면 깨짐 (SEV1)

```bash
# 1. 자동 보정 규칙 중단 (새 보정이 원인일 때)
pnpm --filter @su-maek/db kill-switch enable formula_autofix \
  --reason "RB-10 SEV1 학생 화면 수식 깨짐" --actor <이메일>

# 2. 자동 게시 중단 (더 이상 깨진 문항이 게시되지 않게)
pnpm --filter @su-maek/db kill-switch enable auto_publish_questions \
  --reason "RB-10 SEV1" --actor <이메일>

# 3. 문서 출력 중단 (같은 원인이면 산출물도 깨진다)
pnpm --filter @su-maek/db kill-switch enable document_export \
  --reason "RB-10 SEV1" --actor <이메일>
```

### 3.2 렌더러 버전 롤백 (배포 없이)

```bash
# 워커·web 환경변수 (핫 리로드 또는 재배포)
KATEX_VERSION=0.16.11
NORMALIZER_VERSION=2026.07.1
MACRO_POLICY_VERSION=3
PDF_RENDERER_VERSION=chromium-131
HWPX_RENDERER_VERSION=hwpx-2026.07.0
```

**중지해도 반드시 되는 것**:

- 학생 응시·답안 저장·제출 (수식이 깨져 보여도 답안은 보존)
- 자동 채점·수동 채점
- 오늘 수업 운영, 일정 관리
- 문제은행 조회 (검수 화면은 `.math-raw` 폴백 허용)
- 이미 생성된 PDF·HWPX 다운로드
- 수식 파싱·KaTeX 검증 (보정만 중단, 검증은 계속)

**절대 하지 않는 것**:

- 게시된 `assessment_questions` 스냅샷 수정 — **불변**([ADR-0008](../adr/0008-route-assessment-question-snapshots.md))
- 응시 중인 학생의 답안 삭제
- CSS로 오류를 숨기거나 빨간색만 제거해 통과시키기

---

## 4. 진단

### 4-1. 불변 I-18 — 게이트 미통과 문항이 게시됨

```sql
SELECT aq.id AS assessment_question_id, aq.assessment_instance_id,
       ai.status AS assessment_status, ai.opens_at, ai.closes_at,
       qv.id AS question_version_id, qv.publish_gate_status,
       aq.renderer_version, aq.katex_version, aq.normalizer_version
FROM assessment_questions aq
JOIN assessment_instances ai ON ai.id = aq.assessment_instance_id
JOIN question_versions qv    ON qv.id = aq.question_version_id
WHERE ai.status IN ('published','open','closed','grading','finalized')
  AND qv.publish_gate_status <> 'passed'
LIMIT 100;
```

**1행이라도 반환하면 SEV1이다.**

### 4-2. 파싱 실패 수식이 게시 콘텐츠에 존재

```sql
SELECT me.id AS expression_id, me.parse_status, me.review_status,
       me.has_semantic_risk, me.normalizer_version, me.katex_version,
       qv.id AS question_version_id, ai.id AS assessment_instance_id, ai.status
FROM math_expressions me
JOIN structured_content_blocks scb ON scb.id = me.block_id
JOIN question_versions qv          ON qv.id = scb.question_version_id
JOIN assessment_questions aq       ON aq.question_version_id = qv.id
JOIN assessment_instances ai       ON ai.id = aq.assessment_instance_id
WHERE ai.status IN ('published','open','closed','grading','finalized')
  AND (me.parse_status <> 'parsed'
       OR (me.has_semantic_risk AND me.review_status <> 'approved'))
LIMIT 100;
```

### 4-3. 렌더 산출물 3-target 누락·실패

```sql
SELECT me.id AS expression_id,
       count(*) FILTER (WHERE mra.target = 'web'  AND mra.validation_status = 'passed') AS web_ok,
       count(*) FILTER (WHERE mra.target = 'pdf'  AND mra.validation_status = 'passed') AS pdf_ok,
       count(*) FILTER (WHERE mra.target = 'hwpx' AND mra.validation_status = 'passed') AS hwpx_ok,
       array_agg(DISTINCT mra.renderer_version) AS renderer_versions
FROM math_expressions me
LEFT JOIN math_render_artifacts mra ON mra.expression_id = me.id
JOIN structured_content_blocks scb  ON scb.id = me.block_id
JOIN question_versions qv           ON qv.id = scb.question_version_id
WHERE qv.status = 'published'
GROUP BY 1
HAVING count(*) FILTER (WHERE mra.target='web'  AND mra.validation_status='passed') = 0
    OR count(*) FILTER (WHERE mra.target='pdf'  AND mra.validation_status='passed') = 0
    OR count(*) FILTER (WHERE mra.target='hwpx' AND mra.validation_status='passed') = 0
LIMIT 100;
```

### 4-4. 렌더러 버전별 실패 분포 (원인 특정)

```sql
SELECT mra.target, mra.renderer_version, mra.validation_status,
       count(*)                                    AS artifacts,
       count(*) FILTER (WHERE (mra.validation_report ->> 'clipping')::int > 0)     AS clipping,
       count(*) FILTER (WHERE (mra.validation_report ->> 'overlap')::int > 0)      AS overlap,
       count(*) FILTER (WHERE (mra.validation_report ->> 'missing_glyph')::int > 0) AS missing_glyph
FROM math_render_artifacts mra
WHERE mra.created_at > now() - interval '24 hours'
GROUP BY 1,2,3
ORDER BY 1,2,3;
```

### 4-5. 정규화기 버전별 의미 위험 발생

```sql
SELECT me.normalizer_version, me.macro_policy_version,
       count(*)                                        AS expressions,
       count(*) FILTER (WHERE me.has_semantic_risk)    AS semantic_risk,
       count(*) FILTER (WHERE me.parse_status = 'failed') AS parse_failed,
       round(100.0 * count(*) FILTER (WHERE me.has_semantic_risk)
             / NULLIF(count(*),0), 2)                  AS risk_pct
FROM math_expressions me
WHERE me.created_at > now() - interval '7 days'
GROUP BY 1,2
ORDER BY 1 DESC, 2 DESC;
```

### 4-6. 정규화 멱등성 위반

```sql
SELECT mnr.expression_id, mnr.normalizer_version,
       mnr.input_hash, mnr.output_hash, mnr.idempotent_verified,
       mnr.applied_rules, mnr.ran_at
FROM math_normalization_runs mnr
WHERE mnr.idempotent_verified = false
  AND mnr.ran_at > now() - interval '7 days'
ORDER BY mnr.ran_at DESC
LIMIT 50;
```

### 4-7. 미지원 명령 상위 목록

```sql
SELECT cmd, count(*) AS occurrences
FROM math_expressions me,
     LATERAL jsonb_array_elements_text(COALESCE(me.unsupported_commands,'[]'::jsonb)) AS cmd
WHERE me.created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 30;
```

### 4-8. 영향받은 시험·학생

```sql
SELECT ai.id AS assessment_instance_id, ai.organization_id, ai.kind, ai.status,
       ai.opens_at, ai.closes_at,
       count(DISTINCT aq.id)                       AS total_questions,
       count(DISTINCT aq.id) FILTER (
         WHERE qv.publish_gate_status <> 'passed')  AS broken_questions,
       count(DISTINCT a.id)                        AS attempts,
       count(DISTINCT a.student_id)                AS students
FROM assessment_instances ai
JOIN assessment_questions aq ON aq.assessment_instance_id = ai.id
JOIN question_versions qv    ON qv.id = aq.question_version_id
LEFT JOIN attempts a         ON a.assessment_instance_id = ai.id
WHERE ai.status IN ('published','open','closed','grading','finalized')
GROUP BY 1,2,3,4,5,6
HAVING count(DISTINCT aq.id) FILTER (WHERE qv.publish_gate_status <> 'passed') > 0
ORDER BY students DESC;
```

### 4-9. 골든 코퍼스 회귀

```bash
pnpm --filter @su-maek/core test:math-golden
pnpm --filter @su-maek/core test:math-golden -- --renderer=pdf
pnpm --filter @su-maek/core test:math-golden -- --renderer=hwpx
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | kill switch ON (3.1) | 3장 | 2분 |
| 2 | 진행 중 시험 확인 (4-8) | 4장 | 3분 |
| 3 | 진행 중이면 문항 차단 (5.1) | 5.1 | 5분 |
| 4 | 원인 특정 (5.2) | 4-4·4-5·4-6 | 10분 |
| 5 | 렌더러 버전 롤백 (3.2) | 3.2 | 5분 |
| 6 | 골든 회귀로 롤백 검증 (4-9) | — | 10분 |
| 7 | 영향 문항 재검증·재게시 (5.3) | — | 30분~수시간 |
| 8 | 검증 (6장) | — | 20분 |
| 9 | kill switch 해제 | 5.5 | 3분 |

### 5.1 진행 중 시험의 문항 차단

**답안을 보존하면서 해당 문항만 잠시 차단한다.** 시험 전체를 중단하지 않는다.

```sql
-- 문제 문항을 응시 화면에서 차단 (답안은 보존)
UPDATE assessment_questions
SET blocked_at = now(), block_reason = 'RB-10: 렌더 오류로 일시 차단'
WHERE id = ANY($1::uuid[]);
```

> `blocked_at`·`block_reason`은 스냅샷 내용이 아니라 운영 플래그다. 트리거의 불변 대상에서 제외된 두 컬럼만 갱신한다.

교사·운영자에게 **문항 버전 + 렌더러 버전 + 오류 ID**를 알린다. **원시 LaTeX는 학생에게 표시하지 않는다.**

차단된 문항은 채점에서 제외하고 배점을 재조정하거나, 해당 시험을 무효화 후 재배정한다(교사 판단).

### 5.2 원인 특정

| 진단 | 원인 | 조치 |
|---|---|---|
| 4-4에서 특정 `renderer_version`에만 실패 집중 | 렌더러 업그레이드 회귀 | 3.2 롤백 |
| 4-5에서 특정 `normalizer_version`에서 `risk_pct` 급증 | 정규화 규칙 회귀 | `NORMALIZER_VERSION` 롤백 |
| 4-5에서 `macro_policy_version` 변경 후 `parse_failed` 급증 | 허용 목록 축소 | `MACRO_POLICY_VERSION` 롤백 |
| 4-6에서 멱등성 위반 | 정규화 규칙 상호작용 버그 | 규칙 순서 수정 + 롤백 |
| 4-1에서 게이트 미통과 문항이 게시됨 | **게시 게이트 우회** | 게이트 코드 검토 + 5.4 |
| 4-7에서 새 명령 급증 | 새 콘텐츠 유형 유입 | 허용 목록 확장 검토 (게이트는 유지) |
| 특정 조직·교재에만 발생 | 원본 품질 문제 | 해당 원본 재검수 |

### 5.3 영향 문항 재검증·재게시

```sql
-- 영향 문항을 검수 격리로 전환 (미게시 상태만)
UPDATE question_versions
SET publish_gate_status = 'formula_review_required',
    status = 'review_required',
    updated_at = now()
WHERE id = ANY($1::uuid[])
  AND status <> 'published';

-- 검수 항목 생성
INSERT INTO formula_reviews (id, organization_id, expression_id, trigger, severity,
                             status, due_at, created_at, updated_at)
SELECT uuidv7(), me.organization_id, me.id, 'render_mismatch', 'block',
       'open', now() + interval '24 hours', now(), now()
FROM math_expressions me
JOIN structured_content_blocks scb ON scb.id = me.block_id
WHERE scb.question_version_id = ANY($1::uuid[])
  AND NOT EXISTS (SELECT 1 FROM formula_reviews fr
                  WHERE fr.expression_id = me.id AND fr.status IN ('open','assigned','reviewing'));
```

**재렌더 배치** (롤백한 버전으로):

```sql
INSERT INTO jobs (id, organization_id, queue, job_type, priority, status,
                  run_after, attempt_count, max_attempts,
                  idempotency_key, input_hash, input, created_at, updated_at)
SELECT uuidv7(), qv.organization_id, 'render', 'math.revalidate', 60, 'queued',
       now() + (random() * interval '600 seconds'), 0, 4,
       'rb10:' || qv.id::text || ':' || $2::text,
       encode(digest(qv.id::text || $2::text, 'sha256'), 'hex'),
       jsonb_build_object('question_version_id', qv.id, 'renderer_version', $2),
       now(), now()
FROM question_versions qv
WHERE qv.id = ANY($1::uuid[])
ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING;
```

### 5.4 게시 게이트 우회 경로 차단

게이트를 통과하지 않은 문항이 게시됐다면 코드 경로에 구멍이 있다.

```sql
-- 게이트 뷰 정의 확인
SELECT pg_get_viewdef('question_publish_gate'::regclass, true);

-- 게시 트리거 존재 확인
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'assessment_questions'::regclass AND NOT tgisinternal;
```

트리거가 없거나 비활성이면 마이그레이션 재실행(멱등).

### 5.5 kill switch 해제

해제 전 6장 검증 전부 통과 필수.

```bash
pnpm --filter @su-maek/db kill-switch disable formula_autofix --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable auto_publish_questions --actor <이메일>
pnpm --filter @su-maek/db kill-switch disable document_export --actor <이메일>
```

```sql
UPDATE jobs
SET run_after = now() + (random() * interval '600 seconds')
WHERE status = 'queued' AND queue = 'render';
```

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | 불변 I-18 | 4-1 | **0행** |
| V-2 | 게시 콘텐츠 파싱 실패 | 4-2 | **0행** |
| V-3 | 3-target 산출물 완비 | 4-3 | 0행 |
| V-4 | 골든 코퍼스 (web) | `pnpm --filter @su-maek/core test:math-golden` | 통과 |
| V-5 | 골든 코퍼스 (pdf) | `... -- --renderer=pdf` | 통과 |
| V-6 | 골든 코퍼스 (hwpx) | `... -- --renderer=hwpx` | 통과 |
| V-7 | 멱등성 | 4-6 | 0행 |
| V-8 | 시각 회귀 | `pnpm --filter @su-maek/core test:visual` (1280·360·A4) | 통과 |
| V-9 | DOM 검사 | 게시 콘텐츠에 `.katex-error`·`.math-raw`·빈 KaTeX 노드 | **0건** |
| V-10 | **게시 스냅샷 불변** | `snapshot_hash` 사고 전후 비교 | 변화 없음 |
| V-11 | 학생 화면 표본 | 영향 시험 3건을 학생 계정으로 직접 확인 | 수식 정상 |
| V-12 | 렌더러 버전 일치 | `SELECT DISTINCT renderer_version, katex_version FROM assessment_questions WHERE created_at > now() - interval '1 day'` | 롤백 버전과 일치 |
| V-13 | 불변 조건 전체 | `psql -f packages/db/src/checks/invariants.sql` | 전부 0행 |
| V-14 | kill switch | `kill-switch list` | 전부 `false` |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 진행 중인 시험에서 학생이 깨진 수식을 봄 | **필수** (영향 조직 즉시) |
| 게시된 콘텐츠에서 깨짐 확인 | **필수** (영향 조직) |
| 문항 차단으로 배점이 조정됨 | **필수** (해당 조직) |
| PDF·HWPX만 영향 | [RB-11](./11-document-export-failure.md) 공지 |
| 검수 대기 문항만 영향 (게시 전) | 불필요 |
| 승격 중 골든 회귀로 중단 | 불필요 |

### 초기 공지

> **[수맥] 시험 화면 수식 표시 오류 안내 — 중요**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각} (한국 시각 {KST})부터 일부 시험에서 **수식이 정상적으로 표시되지 않는 문제**가 확인되었습니다.
>
> - 영향 시험: {N}건
> - 영향 학생: {N}명
> - 영향 문항: {N}개
>
> **즉시 조치한 것**
> - 문제가 확인된 문항을 응시 화면에서 일시 차단했습니다. **학생이 작성한 답안은 모두 보존됩니다.**
> - 수식 처리 버전을 이전 안정 버전으로 되돌렸습니다.
> - 새 문항 게시와 시험지 출력을 일시 중단했습니다.
>
> **영향 없는 것**
> - 이미 완료된 시험의 성적과 채점 결과
> - 다른 문항의 응시와 제출
> - 오늘 수업 운영과 일정
>
> **지금 하실 일**
> 1. 진행 중인 시험은 차단된 문항을 제외하고 계속 응시하도록 안내해 주세요.
> 2. 차단된 문항의 배점 처리 방법을 결정해 주세요 (제외 / 재시험 / 만점 처리).
> 3. 시험 상세 화면에서 차단된 문항 목록을 확인하실 수 있습니다.
>
> 다음 안내: {30분 후 시각}

### 해소 공지

> **[수맥] 수식 표시 오류 해소 안내**
>
> {UTC 시각}부로 수식 표시가 정상 복구되었습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 발생 시간 | {시작} ~ {종료} |
> | 영향 시험 | {N}건 |
> | 영향 문항 | {N}개 |
> | 학생 답안 | **전부 보존** |
> | 완료된 성적 | 영향 없음 |
> | 원인 | {수식 처리 버전 업그레이드 회귀 등} |
>
> **확인 부탁드립니다**
> - 차단했던 문항을 해제했습니다. 시험 상세에서 확인해 주세요.
> - 배점 조정이 필요한 시험은 채점 화면에서 재채점하실 수 있습니다.
> - 문제집 반입과 시험지 출력을 재개했습니다.
>
> **참고**: 이미 게시된 시험은 게시 당시의 수식 처리 버전으로 고정되어 있어, 앞으로 버전이 올라가도 표시가 바뀌지 않습니다.
>
> 상세 원인과 재발 방지 대책은 영업일 5일 이내에 안내드리겠습니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 깨진 수식으로 학생이 오답 처리됨 | **필요** | 평가 공정성. 성적 정정 절차 |
| 시험 무효화·재시험 결정 | **필요** | 학사 처리 |
| 배점 조정으로 성적이 변경됨 | **필요** | 성적 정정 |
| 문항 차단으로 시험 난이도가 실질 변경 | 검토 권장 | 평가 타당성 |
| 게시 전 검수 단계 오류 | 불필요 | — |
| 승격 중단 (사용자 미노출) | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV1 기준, 영업일 5일)
- [ ] **어느 게이트 조건이 이 오류를 못 잡았는가.** G-01~G-10 중 무엇인가
- [ ] 골든 코퍼스에 이 케이스가 없었는가. **최소 재현 사례로 추가**했는가 (특정 문항 번호 하드코딩 금지)
- [ ] 렌더러 승격 절차(골든 전량 A/B → 사람 승인 → 그림자 7일 → 카나리 10% → 전면)가 지켜졌는가
- [ ] 의존성 자동 업데이트가 KaTeX 버전을 올렸는가. 무시 목록에 있는가
- [ ] 시각 회귀 테스트(1280·360·A4)가 이 케이스를 덮었는가
- [ ] 게시 게이트 우회 경로가 있었다면 트리거·뷰를 보강했는가
- [ ] `renderMath()` 외 KaTeX 직접 호출 ESLint 규칙이 작동했는가
- [ ] 응시 중 렌더 실패 감지·문항 차단이 실제로 동작했는가
- [ ] **원시 LaTeX가 학생에게 노출되지 않았는가** (가장 중요한 확인)
- [ ] 롤백이 환경변수만으로 됐는가. 배포가 필요했다면 왜인가
- [ ] 게시 스냅샷이 실제로 불변이었는가 (V-10)
- [ ] 골든 코퍼스 크기·영역 커버리지를 재점검했는가 (출시 목표 1만 건)
