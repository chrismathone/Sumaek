# RB-11 PDF·HWP/HWPX 대량 출력 오류와 산출물 폐기

| 항목 | 값 |
|---|---|
| 심각도 | **SEV3** (출력 실패) / SEV2 (배포된 산출물이 손상) / SEV1 (원시 LaTeX가 학생 배포 문서에 포함) |
| 1차 담당 | 운영 엔지니어(OE) + 콘텐츠 관리자 |
| 에스컬레이션 | 1시간 미확인 → 담당자 / 배포된 산출물 손상 확인 → SEV2 + IC |
| 관련 SLO | **O-07 30문항 PDF·HWPX 출력 95% 2분 / 99% 10분** · O-11 원시 LaTeX 0건 |
| 관련 kill switch | **`document_export`** |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-13 · [../adr/0013-renderer-versions-and-publish-gate.md](../adr/0013-renderer-versions-and-publish-gate.md) |

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `export_failure_rate` | `document_exports.status='failed'` 비율 | > 10% | 1시간 | SEV3 |
| `export_failure_rate_high` | 동일 | > 40% | 30분 | SEV2 |
| `export_latency_breach` | `queued → ready` p95 | > 2분 | 30분 | SEV3 |
| `export_latency_breach_p99` | 동일 p99 | > 10분 | 30분 | SEV3 |
| `export_review_required` | `status='review_required'` 신규 | > 20건 | 1시간 | SEV3 |
| `hwpx_object_count_mismatch` | HWPX 수식 객체 수 ≠ `math_expressions` 수 | > 0 | 실시간 | SEV2 |
| `hwpx_zero_width_object` | 폭 0 수식 객체 | > 0 | 실시간 | SEV2 |
| `pdf_text_layer_missing` | PDF 텍스트 추출 실패 | > 5건 | 1시간 | SEV2 |
| `raw_latex_in_export` | 산출물에 `[원문]`·원시 LaTeX 패턴 탐지 | > 0 | 실시간 | **SEV1** |
| `render_worker_cpu` | render 큐 워커 CPU | > 90% 지속 | 15분 | SEV3 |
| `queue_wait_exceeded` | `sumaek_queue_oldest_wait_seconds{queue="render"}` | > 600 s | 10분 | SEV2 |
| 사용자 신고 | "시험지가 안 만들어진다"·"한글에서 안 열린다" | 2건 | 영업일 | SEV3 |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| **배포된 산출물에 원시 LaTeX·`[원문]` 포함** | **SEV1** |
| 이미 다운로드된 산출물이 손상 (수식 누락·잘림) | **SEV2** |
| HWPX가 대상 앱에서 열리지 않음 (ZIP 손상) | **SEV2** |
| 출력 실패율 > 40% | SEV2 |
| 출력 실패율 10~40%, 재시도로 처리됨 | SEV3 |
| 출력 지연 (SLO 초과), 결과는 정상 | SEV3 |
| 검수 필요(`review_required`) 증가 | SEV3 |
| **온라인 응시에 영향** | 해당 없음 — 응시는 web 렌더 산출물을 쓰므로 무관 |

---

## 3. 즉시 중지할 기능

```bash
pnpm --filter @su-maek/db kill-switch enable document_export \
  --reason "RB-11 SEV2 출력 실패율 40% 초과" --actor <이메일>
```

**중지되는 것**: 신규 PDF·HWPX 출력 작업.

**중지해도 반드시 되는 것**:

- **온라인 응시 전체** (게시 스냅샷의 web 렌더 산출물 사용, PDF·HWPX와 무관)
- 답안 저장·제출·자동 채점·수동 채점
- 웹 미리보기 (문항 상세, 시험 미리보기)
- **이미 생성 완료된 산출물 다운로드** (손상이 확인되지 않은 것)
- 오늘 수업 운영, 일정 관리
- 문제은행 조회·검수·게시

**원시 LaTeX 노출(SEV1) 시 추가**:

```bash
pnpm --filter @su-maek/db kill-switch enable auto_question_publish \
  --reason "RB-11 SEV1 산출물에 원시 LaTeX" --actor <이메일>
```

그리고 [RB-10](./10-formula-render-rollback.md)을 병행한다 — 같은 원인이 web 렌더에도 영향을 줄 수 있다.

---

## 4. 진단

### 4-1. 출력 실패 분포

```sql
SELECT de.format, de.document_kind, de.status, de.renderer_version,
       count(*)                                   AS exports,
       max(de.updated_at)                         AS last_at,
       (array_agg(de.failure_reason ORDER BY de.updated_at DESC)
        FILTER (WHERE de.failure_reason IS NOT NULL))[1] AS sample_reason
FROM document_exports de
WHERE de.created_at > now() - interval '6 hours'
GROUP BY 1,2,3,4
ORDER BY exports DESC;
```

### 4-2. 출력 지연 (SLO 대조)

```sql
SELECT de.format,
       count(*)                                                       AS total,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (de.updated_at - de.created_at)))::int AS p95_seconds,
       percentile_cont(0.99) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (de.updated_at - de.created_at)))::int AS p99_seconds
FROM document_exports de
WHERE de.status = 'ready' AND de.created_at > now() - interval '6 hours'
GROUP BY 1;
```

목표: p95 120초, p99 600초.

### 4-3. 검증 실패 상세

```sql
SELECT de.id, de.organization_id, de.assessment_instance_id,
       de.format, de.document_kind, de.status,
       de.page_count, de.byte_size, de.renderer_version,
       de.validation_report
FROM document_exports de
WHERE de.status IN ('failed','review_required')
  AND de.updated_at > now() - interval '6 hours'
ORDER BY de.updated_at DESC
LIMIT 50;
```

### 4-4. HWPX 수식 객체 수 대조

```sql
SELECT de.id AS export_id, de.assessment_instance_id,
       (de.validation_report ->> 'math_object_count')::int AS hwpx_objects,
       (SELECT count(*)
          FROM assessment_questions aq
          JOIN question_versions qv          ON qv.id = aq.question_version_id
          JOIN structured_content_blocks scb ON scb.question_version_id = qv.id
          JOIN math_expressions me           ON me.block_id = scb.id
         WHERE aq.assessment_instance_id = de.assessment_instance_id) AS expected_objects,
       (de.validation_report ->> 'zero_width_objects')::int AS zero_width,
       (de.validation_report ->> 'baseline_error_pt')::numeric AS baseline_error
FROM document_exports de
WHERE de.format = 'hwpx' AND de.created_at > now() - interval '24 hours'
  AND (de.validation_report ->> 'math_object_count') IS NOT NULL
ORDER BY de.created_at DESC
LIMIT 50;
```

**`hwpx_objects <> expected_objects`이면 수식이 누락된 것이다.**

### 4-5. 원시 LaTeX 노출 확인 (SEV1 판정)

```sql
SELECT de.id, de.organization_id, de.assessment_instance_id,
       de.format, de.storage_path, de.checksum, de.created_at,
       de.validation_report -> 'raw_latex_detected' AS raw_latex
FROM document_exports de
WHERE de.status = 'ready'
  AND (de.validation_report -> 'raw_latex_detected')::text NOT IN ('null','0','false')
  AND de.created_at > now() - interval '30 days'
ORDER BY de.created_at DESC;
```

**1행이라도 반환하면 SEV1.**

### 4-6. 렌더 워커 상태

```sql
SELECT status, count(*),
       max(now() - created_at) AS oldest,
       count(DISTINCT locked_by) AS workers,
       count(DISTINCT organization_id) AS orgs
FROM jobs
WHERE queue = 'render' AND created_at > now() - interval '6 hours'
GROUP BY 1;
```

```bash
pnpm --filter @su-maek/worker status --queue=render
```

### 4-7. 배포된(다운로드된) 산출물 범위

```sql
SELECT de.id, de.organization_id, de.assessment_instance_id,
       de.format, de.document_kind, de.storage_path, de.checksum,
       de.created_at, de.expires_at
FROM document_exports de
WHERE de.status = 'ready'
  AND de.renderer_version = $1        -- 문제 렌더러 버전
  AND de.created_at > $2              -- 문제 배포 시작 시각
ORDER BY de.created_at DESC;
```

다운로드 여부는 Storage 접근 로그로 확인한다.

### 4-8. 렌더러 버전별 실패율

```sql
SELECT de.renderer_version, de.format,
       count(*)                                              AS total,
       count(*) FILTER (WHERE de.status = 'ready')            AS ready,
       count(*) FILTER (WHERE de.status = 'failed')           AS failed,
       count(*) FILTER (WHERE de.status = 'review_required')  AS review_required,
       round(100.0 * count(*) FILTER (WHERE de.status = 'failed')
             / NULLIF(count(*),0), 1)                         AS fail_pct
FROM document_exports de
WHERE de.created_at > now() - interval '7 days'
GROUP BY 1,2
ORDER BY 1 DESC, 2;
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 원시 LaTeX 노출 확인 (4-5) — 있으면 SEV1 | 4-5 | 3분 |
| 2 | 실패율 40% 초과면 kill switch ON | 3장 | 1분 |
| 3 | 원인 특정 (5.1) | 4-1·4-3·4-4·4-6·4-8 | 10분 |
| 4 | 원인별 조치 (5.2~5.5) | — | 15~60분 |
| 5 | 손상 산출물 폐기 (5.6) | — | 15분 |
| 6 | 재생성 (5.7) | — | 30분~수시간 |
| 7 | 검증 (6장) | — | 20분 |
| 8 | kill switch 해제 | 5.8 | 3분 |

### 5.1 원인 분기

| 진단 | 원인 | 조치 |
|---|---|---|
| 4-8에서 특정 `renderer_version`에 실패 집중 | 렌더러 회귀 | 5.2 |
| 4-3의 `validation_report`에 `font_not_ready` | 폰트 로드 경합 | 5.3 |
| 4-4에서 객체 수 불일치 | HWPX 변환기 버그 | 5.4 |
| 4-6에서 워커 CPU 90% + 큐 적체 | 자원 부족 | 5.5 |
| 4-3에서 `clipping`·`overlap` 다수 | 레이아웃 규칙 문제 | 5.2 (롤백) 또는 규칙 수정 |
| 4-5에서 원시 LaTeX 탐지 | **게이트 우회** | SEV1. [RB-10](./10-formula-render-rollback.md) 병행 |
| 특정 조직·시험만 실패 | 해당 콘텐츠 문제 | 문항 단위 검수 |
| Storage 5xx | 스토리지 장애 | [RB-05](./05-db-failure-pitr.md)와 별개 — Storage 상태 확인 |

### 5.2 렌더러 버전 롤백

```bash
PDF_RENDERER_VERSION=chromium-131
HWPX_RENDERER_VERSION=hwpx-2026.07.0
```

롤백 후 골든 회귀:

```bash
pnpm --filter @su-maek/core test:math-golden -- --renderer=pdf
pnpm --filter @su-maek/core test:math-golden -- --renderer=hwpx
```

### 5.3 폰트 로드 경합

PDF 렌더는 **폰트와 KaTeX 자산 준비 완료 후** 캡처해야 한다.

```
확인: 렌더 워커 로그에서 document.fonts.ready 대기 여부
조치: 폰트 대기 타임아웃 상향(기본 5초 → 10초). 타임아웃 시 렌더 실패 처리(부분 결과 노출 금지)
```

### 5.4 HWPX 변환기 문제

| 증상 | 조치 |
|---|---|
| 수식 객체 수 불일치 | 누락된 `expression_id` 특정 → 해당 수식의 LaTeX→HWP 매핑 확인 → 매핑 추가 또는 검수 격리 |
| 폭 0 객체 | 글꼴 메트릭 테이블 확인. 골든 문서 대비 폭·높이 편차 재측정 |
| 기준선 오차 > 2pt | 메트릭 보정값 조정 |
| ZIP 손상 | 생성 코드의 스트림 종료 확인. 부분 쓰기 방지 |
| 글꼴 대체 발생 | 대상 앱에 없는 글꼴 사용. 허용 글꼴 목록으로 제한 |

**이미지 폴백까지 실패한 LaTeX를 `[원문]` 형태로 내보내지 않는다. 산출물 전체를 실패시킨다.**

### 5.5 워커 자원

| 조치 | 상세 |
|---|---|
| 렌더 워커 증설 | 4 vCPU × 2 → × 4 (상한) |
| 브라우저 컨텍스트 재사용 확인 | 워커 프로세스당 브라우저 1개, 페이지 컨텍스트만 회전 (콜드 스타트 1.8초 회피) |
| 동시 렌더 수 제한 | 워커당 동시 3개 이하 |
| 저우선 작업 지연 | `ai` 큐 kill switch로 CPU 회수 |

### 5.6 손상 산출물 폐기

```sql
-- 1. 만료 처리 (메타·체크섬은 보존)
UPDATE document_exports
SET expires_at = now(),
    status = 'failed',
    failure_reason = COALESCE(failure_reason,'') || ' | RB-11: 손상 확인으로 폐기',
    updated_at = now()
WHERE id = ANY($1::uuid[]);
```

```bash
# 2. Storage 객체 삭제 + 서명 URL 폐기
node scripts/purge-exports.mjs --export-ids="$EXPORT_IDS" --reason="RB-11 손상 산출물"
```

**메타 행은 삭제하지 않는다.** 어떤 산출물이 배포됐는지 추적할 수 있어야 한다.

### 5.7 재생성

게시 스냅샷이 고정되어 있으므로 **결정론적으로 재생성**된다.

```sql
INSERT INTO jobs (id, organization_id, queue, job_type, priority, status,
                  run_after, attempt_count, max_attempts,
                  idempotency_key, input_hash, input, created_at, updated_at)
SELECT uuidv7(), de.organization_id, 'render', 'document.export', 60, 'queued',
       now() + (random() * interval '600 seconds'), 0, 4,
       'rb11:' || de.assessment_instance_id::text || ':' || de.format || ':' || de.document_kind,
       encode(digest(de.assessment_instance_id::text || de.format || de.document_kind, 'sha256'), 'hex'),
       jsonb_build_object('assessment_instance_id', de.assessment_instance_id,
                          'format', de.format,
                          'document_kind', de.document_kind),
       now(), now()
FROM document_exports de
WHERE de.id = ANY($1::uuid[])
ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING;
```

**재생성 후 체크섬을 이전 정상 산출물과 비교**해 결정론이 유지되는지 확인한다.

### 5.8 kill switch 해제

```bash
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
| V-1 | **원시 LaTeX 노출** | 4-5 | **0행** |
| V-2 | 출력 실패율 | 4-1 | < 5% (1시간) |
| V-3 | 출력 지연 | 4-2 | p95 < 120초, p99 < 600초 |
| V-4 | HWPX 객체 수 일치 | 4-4 | 불일치 0행 |
| V-5 | 폭 0 객체 | 4-4 | `zero_width` 전부 0 |
| V-6 | 기준선 오차 | 4-4 | `baseline_error` ≤ 2 pt |
| V-7 | PDF 텍스트 레이어 | 표본 5건 텍스트 추출 | 전부 성공 |
| V-8 | 골든 회귀 (pdf) | `test:math-golden -- --renderer=pdf` | 통과 |
| V-9 | 골든 회귀 (hwpx) | `test:math-golden -- --renderer=hwpx` | 통과 |
| V-10 | 손상 산출물 폐기 | 폐기 URL 접근 시도 | 403/404 |
| V-11 | 재생성 결정론 | 재생성 산출물 체크섬 vs 이전 정상본 | 일치 |
| V-12 | **온라인 응시 무영향** | 표본 시험 응시 | 정상 |
| V-13 | 렌더 큐 정상 | 4-6 | `oldest` < 600초 |
| V-14 | **HWPX 재열기 체크리스트** | `node scripts/hwpx-verify.mjs --file=<산출물>` | ZIP 무결성·XML 스키마·객체 수·폭 0·기준선 전부 통과 |
| V-15 | kill switch | `kill-switch list` | `document_export` = `false` |

> V-14의 실제 한글 앱 재열기는 실환경 전용이다([../phase0/assumptions.md](../phase0/assumptions.md) C-14). 자동 검증 6종으로 대체하고, 수동 체크리스트는 별도 확인한다.

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 배포된 산출물에 원시 LaTeX 포함 | **필수** (영향 조직 즉시) + 회수 안내 |
| 다운로드된 산출물이 손상 | **필수** (영향 조직) |
| 출력 실패율 40% 초과 | **필수** (영향 조직) |
| 출력 지연만, 결과 정상 | 필요 시 |
| 검수 필요 증가 | 불필요 |

### 초기 공지 (출력 실패)

> **[수맥] 시험지·해설지 출력 지연 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}부터 **PDF·한글(HWPX) 출력**에 문제가 발생하고 있습니다.
>
> - 영향: 시험지·답안지·해설지 파일 생성
> - 실패율: {N}%
> - **영향 없음**: 온라인 시험 응시와 제출, 채점, 웹 미리보기, 이미 만들어 둔 파일 다운로드
>
> **지금 하실 일**
> - 온라인 응시로 시험을 진행하실 수 있습니다.
> - 인쇄가 꼭 필요하시면 브라우저의 인쇄 미리보기를 이용해 주세요.
> - 이미 다운로드하신 파일은 정상입니다.
>
> 복구 예상: {시각}

### 초기 공지 (산출물 손상 — SEV1/SEV2)

> **[수맥] 출력 파일 오류 안내 — 확인 부탁드립니다 (중요)**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {기간}에 생성된 일부 **시험지·해설지 파일에 수식 오류**가 있음을 확인했습니다.
>
> **영향 파일**
> - 생성 기간: {시작} ~ {종료}
> - 형식: {PDF / HWPX}
> - 영향 파일 수: {N}건
> - 문제: {구체적으로. 예: "일부 수식이 누락되거나 원본 코드가 그대로 표시됨"}
>
> **첨부 파일**에 영향받은 시험 목록을 담았습니다.
>
> **지금 하실 일 (중요)**
> 1. **첨부 목록의 파일을 학생에게 배포하지 말아 주세요.**
> 2. 이미 배포하셨다면 회수하시거나, 정정본을 재배포해 주세요.
> 3. 정정된 파일을 {시각}까지 다시 생성해 드리겠습니다. 완료되면 알려드립니다.
>
> **영향 없는 것**
> - 온라인 시험 응시와 제출
> - 채점 결과와 성적
> - 문제은행의 원본 문항
>
> 불편을 드려 죄송합니다.

### 해소 공지

> **[수맥] 출력 파일 정정 완료 안내**
>
> {UTC 시각}부로 출력 기능이 정상화되었고, 영향받은 파일을 모두 재생성했습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 발생 기간 | {시작} ~ {종료} |
> | 영향 파일 | {N}건 |
> | 재생성 완료 | {N}건 |
> | 폐기된 손상 파일 | {N}건 |
> | 온라인 응시 영향 | 없음 |
>
> **확인 부탁드립니다**
> - 시험 상세 → 출력 탭에서 새 파일을 다운로드해 주세요.
> - 이전 다운로드 링크는 폐기되었습니다.
> - 한글 파일은 열어서 수식 표시를 한 번 확인해 주세요.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 손상된 시험지가 실제 시험에 사용됨 | **필요** | 평가 공정성. 재시험 여부 |
| 원시 LaTeX가 학생 배포 문서에 포함 | **필요** | 품질 보증 위반. 계약 조항 |
| 해설지 오류로 학습에 실질 피해 | 검토 권장 | — |
| 출력 지연만 | 불필요 | — |
| 검수 단계 실패 (배포 전) | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성
- [ ] **게이트 G-08(PDF·HWPX 변환 실패 0건)이 왜 통과시켰는가**
- [ ] 골든 코퍼스에 이 케이스가 있었는가. 없으면 최소 재현 사례로 추가
- [ ] HWPX 검증 6종(ZIP·스키마·객체 수·폭 0·기준선·골든 편차)이 충분한가
- [ ] `시험지 한글화` 실측 메트릭이 최신인가. 대상 앱 버전이 바뀌었는가
- [ ] PDF 폰트 대기(`document.fonts.ready`)가 실제로 작동했는가
- [ ] 렌더러 승격 절차가 지켜졌는가 (골든 A/B → 그림자 7일 → 카나리)
- [ ] 재생성 결정론이 확인됐는가 (V-11)
- [ ] 손상 산출물 폐기 시 메타가 보존됐는가 (추적 가능성)
- [ ] 렌더 워커 자원이 부족했다면 용량 추정([../phase0/assumptions.md](../phase0/assumptions.md) 3.5)을 갱신했는가
- [ ] 브라우저 컨텍스트 재사용이 실제로 적용되어 있는가
- [ ] `document_export` kill switch가 온라인 응시에 영향을 주지 않았는가 (V-12)
