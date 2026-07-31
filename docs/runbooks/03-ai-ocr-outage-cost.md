# RB-03 AI·OCR 중단과 비용 폭주

| 항목 | 값 |
|---|---|
| 심각도 | **SEV2** (중단) / **SEV2** (전체 예산 폭주) / SEV3 (단일 조직 예산) |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 15분 미확인 → 담당자 호출 / 1시간 → 도메인 소유자(교육과정·콘텐츠) + 경영진(비용) |
| 관련 SLO | O-05 100페이지 OCR 초벌 95% 20분 · O-08 접수 완료 작업 유실 0건 |
| 관련 kill switch | **`ai_provider:<name>`** (예: `ai_provider:anthropic`), 보조 `auto_question_publish` |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-01·F-02 · [../adr/0010-job-queue-and-ai-abstraction.md](../adr/0010-job-queue-and-ai-abstraction.md) · [../phase0/assumptions.md](../phase0/assumptions.md) 3.4 |

---

## 1. 탐지 조건

| 알림 | 메트릭 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `ai_provider_error_rate` | `sumaek_ai_calls_total{outcome="failed"}` 비율 | > 20% | 10분 | SEV2 |
| `ai_provider_timeout` | 연속 타임아웃 횟수 | ≥ 5회 | — | SEV2 |
| `ai_budget_burn_org` | 조직 일 누적 `cost_cents` / 한도(USD 20 = 2,000 cents) | ≥ 80% | 실시간 | SEV3 |
| `ai_budget_burn_global` | 전체 일 누적 / 한도(USD 4,000 = 400,000 cents) | ≥ 80% | 실시간 | **SEV2** |
| `ai_budget_exceeded` | 동일 | ≥ 100% | 실시간 | SEV2 |
| `ai_cost_spike` | 시간당 비용 증가율 | 직전 24시간 평균의 5배 | 1시간 | **SEV2** |
| `ai_quality_drop` | `content_reviews` 생성 비율(검수 전환율) | > 40% (기준 22%) | 1시간 | SEV2 |
| `ai_schema_violation` | zod `.strict()` 파싱 실패 수 | > 20건 | 30분 | SEV2 |
| `SYN-3` 합성 모니터링 | 1페이지 반입 → `waiting_review` | 실패 2회 연속 또는 > 300초 | 5분 주기 | SEV2 |
| 공급자 상태 페이지 | 외부 공지 | 장애 선언 | — | SEV2 |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 전체 AI 예산 100% 소진 + 비용 급증 진행 중 | **SEV2** (경영진 즉시 통지) |
| 시간당 비용이 평균의 5배 초과 | **SEV2** |
| AI 공급자 전면 중단 (에러율 100%) | SEV2 |
| AI 품질 저하로 검수 전환율 > 40% | SEV2 |
| 스키마 위반 출력 급증 (프롬프트 인젝션 의심) | **SEV1** → [RB-07](./07-account-takeover-malicious-upload.md) 병행 |
| 단일 조직 예산 100% | SEV3 |
| 부분 중단 (에러율 20~50%), 재시도로 처리됨 | SEV3 |
| OCR SLO(20분) 초과, 결과는 정상 | SEV3 |

**중요**: AI 중단만으로는 SEV1이 아니다. 게시된 일정, 검수 완료 문제은행, 응시, 수동 채점이 모두 정상 동작하기 때문이다.

---

## 3. 즉시 중지할 기능

### 중단 시나리오

```bash
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-03 SEV2 공급자 중단" --actor <이메일>
```

### 비용 폭주 시나리오

```bash
# 1. 공급자 즉시 차단
pnpm --filter @su-maek/db kill-switch enable ai_provider:anthropic \
  --reason "RB-03 SEV2 비용 폭주 — 시간당 평균 5배" --actor <이메일>

# 2. 자동 게시도 함께 중단 (품질 미검증 결과가 게시되는 것 방지)
pnpm --filter @su-maek/db kill-switch enable auto_question_publish \
  --reason "RB-03 SEV2" --actor <이메일>
```

**중지해도 반드시 되는 것**:

- 게시된 일정과 오늘 수업 운영 전체
- 검수 완료된 문제은행 조회·자동 출제
- 학생 응시·답안 저장·제출
- 자동 채점(AI를 쓰지 않는 계층 1~5)과 수동 채점
- 교육과정 조회·개념 그래프 탐색
- 이미 반입된 문항의 검수 작업
- 수식 파싱·KaTeX 검증 (AI 무관)
- PDF·HWPX 출력

**중지되는 것**: 신규 원본 반입(OCR), 자동 해설 생성·검증, 교육과정 자동 분류, AI 변형 문항 생성.

**큐 작업은 삭제하지 않는다.** `queued` 상태로 남아 재개 시 처리된다.

---

## 4. 진단

### 4-1. 공급자 상태와 실패 분포

```sql
SELECT jr.model_version,
       jr.step,
       jr.outcome,
       jr.error_code,
       count(*)                                   AS calls,
       avg(EXTRACT(epoch FROM (jr.ended_at - jr.started_at)))::numeric(8,2) AS avg_seconds,
       sum(jr.cost_cents)                         AS cost_cents
FROM job_runs jr
WHERE jr.started_at > now() - interval '1 hour'
GROUP BY 1,2,3,4
ORDER BY calls DESC
LIMIT 40;
```

### 4-2. 비용 — 조직별 (오늘)

```sql
SELECT j.organization_id,
       sum(jr.cost_cents)                      AS cost_cents_today,
       (sum(jr.cost_cents) / 100.0)::numeric(10,2) AS cost_usd,
       sum(jr.tokens_in)                       AS tokens_in,
       sum(jr.tokens_out)                      AS tokens_out,
       count(DISTINCT j.id)                    AS jobs,
       count(*)                                AS calls,
       round(100.0 * sum(jr.cost_cents) / 2000, 1) AS pct_of_org_cap
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE jr.started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
GROUP BY 1
ORDER BY cost_cents_today DESC
LIMIT 30;
```

### 4-3. 비용 — 시간대별 급증 확인

```sql
SELECT date_trunc('hour', jr.started_at) AS hour_utc,
       sum(jr.cost_cents)                AS cost_cents,
       count(*)                          AS calls,
       count(DISTINCT j.organization_id) AS orgs,
       (sum(jr.cost_cents)::numeric / NULLIF(count(*),0))::numeric(8,2) AS cents_per_call
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE jr.started_at > now() - interval '48 hours'
GROUP BY 1 ORDER BY 1 DESC LIMIT 48;
```

### 4-4. 폭주 원인 — 재시도 루프 확인

```sql
SELECT j.id, j.organization_id, j.job_type, j.status,
       j.attempt_count, j.max_attempts,
       j.cost_cents,
       count(jr.id)      AS runs,
       sum(jr.cost_cents) AS run_cost_cents,
       j.last_error
FROM jobs j
LEFT JOIN job_runs jr ON jr.job_id = j.id
WHERE j.queue = 'ai'
  AND j.created_at > now() - interval '24 hours'
GROUP BY j.id
HAVING count(jr.id) > j.max_attempts OR sum(jr.cost_cents) > 5000
ORDER BY run_cost_cents DESC NULLS LAST
LIMIT 30;
```

**`runs > max_attempts`이면 재시도 제어가 깨진 것이다.**

### 4-5. 품질 저하 — 검수 전환율

```sql
SELECT qv.ai_model_version,
       qv.ai_prompt_version,
       count(DISTINCT qv.id)                                              AS versions,
       count(DISTINCT cr.question_version_id)                             AS sent_to_review,
       round(100.0 * count(DISTINCT cr.question_version_id)
             / NULLIF(count(DISTINCT qv.id), 0), 1)                       AS review_rate_pct,
       count(*) FILTER (WHERE cr.review_type = 'formula')                 AS formula_reviews,
       count(*) FILTER (WHERE cr.review_type = 'answer')                  AS answer_reviews,
       count(*) FILTER (WHERE cr.review_type = 'ocr')                     AS ocr_reviews
FROM question_versions qv
LEFT JOIN content_reviews cr ON cr.question_version_id = qv.id
WHERE qv.created_at > now() - interval '24 hours'
GROUP BY 1,2
ORDER BY versions DESC;
```

### 4-6. 스키마 위반 (프롬프트 인젝션 신호)

```sql
SELECT j.organization_id, j.id AS job_id, jr.step, jr.error_code, jr.outcome,
       j.input -> 'source_file_id' AS source_file_id,
       jr.started_at
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE jr.outcome = 'failed_final'
  AND jr.error_code IN ('SCHEMA_VIOLATION','ALLOWLIST_VIOLATION','UNEXPECTED_FIELD')
  AND jr.started_at > now() - interval '2 hours'
ORDER BY jr.started_at DESC
LIMIT 50;
```

**같은 `source_file_id`에서 반복되면 악성 업로드 가능성.** → [RB-07](./07-account-takeover-malicious-upload.md)

### 4-7. 큐 적체

```sql
SELECT status, count(*),
       max(now() - created_at) AS oldest,
       count(DISTINCT organization_id) AS orgs
FROM jobs
WHERE queue = 'ai' AND created_at > now() - interval '24 hours'
GROUP BY 1;
```

---

## 5. 복구 절차

### 5.A 공급자 중단 시나리오

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 공급자 상태 페이지 확인 + 4-1 실행 | — | 3분 |
| 2 | 회로 차단기가 작동 중인지 확인 | 워커 로그 `circuit_breaker=OPEN` | 2분 |
| 3 | 일시 장애면 대기 (회로 차단기 자동 복구) | — | 5~30분 |
| 4 | 30분 이상 지속 시 kill switch ON | 3장 | 1분 |
| 5 | 사용자에게 대기 시간 표시 확인 | 반입 화면 배너 | 2분 |
| 6 | 공급자 복구 후 kill switch OFF + 지터 | 5.1 | 3분 |
| 7 | 적체 처리 모니터링 | 4-7 | 30~120분 |

```bash
# 5.1 재개 (지터 필수 — 적체된 작업이 한꺼번에 몰리면 즉시 재폭주)
pnpm --filter @su-maek/db kill-switch disable ai_provider:anthropic --actor <이메일>
```

```sql
UPDATE jobs
SET run_after = now() + (random() * interval '900 seconds')
WHERE status = 'queued' AND queue = 'ai';
```

### 5.B 비용 폭주 시나리오

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | **즉시 kill switch ON** (진단보다 먼저) | 3장 | 1분 |
| 2 | 4-2·4-3·4-4로 원인 특정 | 4장 | 5분 |
| 3 | 원인별 조치 (5.2) | — | 10~30분 |
| 4 | 예산 한도 재설정 필요 시 | 5.3 | 3분 |
| 5 | 재개는 원인 제거 확인 후 | 5.1 | 3분 |

#### 5.2 폭주 원인별 조치

| 원인 (진단) | 조치 |
|---|---|
| 단일 조직이 대량 반입 (4-2에서 한 조직이 80% 이상) | 해당 조직 작업 일시 취소 → 조직에 연락 → 예산 상향 협의 후 재개 |
| 재시도 루프 (4-4에서 `runs > max_attempts`) | 해당 작업 `dead_lettered` 처리 → 재시도 제어 버그 수정 배포 |
| 프롬프트 변경으로 토큰 급증 (4-3에서 `cents_per_call` 급증) | `AI_PROMPT_VERSION` 롤백 |
| 모델 변경 (4-1에서 `model_version` 변화) | 이전 모델로 롤백 |
| 대형 파일 반복 처리 | 파일 크기·페이지 한도 재확인. `source_files.byte_size` 상위 확인 |
| 악의적 대량 업로드 | [RB-07](./07-account-takeover-malicious-upload.md) |

```sql
-- 특정 조직의 대기 중 AI 작업 취소
UPDATE jobs
SET status = 'cancelled',
    cancel_requested_by = 'RB-03 incident response',
    updated_at = now()
WHERE organization_id = $1 AND queue = 'ai' AND status = 'queued';

-- 재시도 루프 작업 강제 종료
UPDATE jobs
SET status = 'dead_lettered',
    last_error = 'RB-03: 재시도 제어 이상으로 강제 종료',
    updated_at = now()
WHERE id = ANY($1::uuid[]);
```

#### 5.3 예산 한도 조정

```sql
-- 조직별 한도 (기본 2,000 cents = USD 20)
UPDATE organizations
SET quota = jsonb_set(quota, '{ai_daily_cents}', to_jsonb($2::int)),
    updated_at = now()
WHERE id = $1;
```

전체 한도는 환경변수 `AI_GLOBAL_DAILY_CENTS`로 관리한다. 변경 시 재배포 필요.

### 5.C 품질 저하 시나리오

| # | 조치 |
|---|---|
| 1 | `auto_question_publish` kill switch ON |
| 2 | 4-5로 어느 모델·프롬프트 버전에서 시작됐는지 특정 |
| 3 | `AI_MODEL_VERSION` / `AI_PROMPT_VERSION` 이전 버전으로 롤백 |
| 4 | 골드 데이터셋 회귀 실행: `pnpm --filter @su-maek/core test:ai-golden` |
| 5 | 해당 기간 생성된 문항을 일괄 재검수 대상으로 전환 (5.4) |
| 6 | 검수 전환율이 22% 이하로 회복되면 kill switch OFF |

```sql
-- 5.4 문제 버전으로 만들어진 미게시 문항을 재검수 대상으로
UPDATE question_versions
SET status = 'review_required',
    publish_gate_status = 'pending',
    updated_at = now()
WHERE ai_model_version = $1
  AND status IN ('draft','extracting','approved')
  AND created_at BETWEEN $2 AND $3;
```

**이미 게시된 문항은 건드리지 않는다.** 게시 스냅샷은 불변이며, 문제가 확인되면 [RB-08](./08-content-rights-emergency-stop.md)·격리 절차를 따른다.

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | 공급자 성공률 | 4-1 | `outcome='succeeded'` 비율 > 95% (30분) |
| V-2 | 시간당 비용 정상화 | 4-3 | 직전 24시간 평균의 2배 이내 |
| V-3 | 재시도 루프 없음 | 4-4 | `runs > max_attempts` 0행 |
| V-4 | 검수 전환율 | 4-5 | ≤ 22% |
| V-5 | 스키마 위반 | 4-6 | 0행 (또는 명백한 원본 품질 문제로 설명됨) |
| V-6 | 큐 적체 해소 | 4-7 | `queued` oldest < 30분 |
| V-7 | 합성 모니터링 | SYN-3 | 3회 연속 성공, 300초 이내 |
| V-8 | 골드 데이터셋 | `pnpm --filter @su-maek/core test:ai-golden` | 통과 |
| V-9 | 핵심 기능 무영향 확인 | 응시·제출·채점·일정 조회 | 정상 |
| V-10 | kill switch 해제 | `kill-switch list` | 관련 항목 `false` |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 반입 대기가 4시간 초과 (RTO) | **필수** (영향 조직) |
| 조직 예산 한도로 작업 중단 | **필수** (해당 조직) |
| 품질 저하로 재검수가 필요한 문항 발생 | **필수** (해당 조직) |
| 30분 이내 자동 복구 | 불필요 |
| 응시·채점·일정에 영향 없음 | 전체 공지 불필요 |

### 초기 공지 (중단)

> **[수맥] 문제집 반입(OCR·AI) 처리 지연 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}부터 외부 AI·OCR 처리 공급자의 장애로 **문제집 반입 작업이 지연**되고 있습니다.
>
> - 영향: 신규 원본 반입, 자동 해설 생성, 교육과정 자동 분류
> - **영향 없음**: 오늘 수업, 학생 응시·제출, 자동 채점, 기존 문제은행 출제, 일정 관리
>
> **접수하신 반입 작업은 유실되지 않습니다.** 공급자가 복구되면 중단된 단계부터 자동으로 이어서 처리됩니다.
>
> **지금 하실 일**
> - 오늘 시험 출제는 기존 문제은행으로 정상 진행하실 수 있습니다.
> - 급한 반입 건이 있으면 회신해 주세요. 우선순위를 조정해 드립니다.
>
> 복구 예상 시각: {시각} (공급자 공지 기준)
> 다음 안내: {시각}

### 초기 공지 (조직 예산 초과)

> **[수맥] AI 처리 사용량 한도 도달 안내 — {조직명}**
>
> 오늘 사용하신 AI·OCR 처리량이 일일 한도({N} USD 상당)에 도달해 **신규 반입 작업이 대기 상태**로 전환되었습니다.
>
> - 오늘 처리한 페이지: {N}페이지
> - 대기 중인 작업: {N}건
> - 한도 초기화: 한국 시각 매일 00:00
>
> **영향 없는 기능**: 오늘 수업, 응시·제출·채점, 기존 문제은행 출제, 일정 관리, 이미 반입된 문항의 검수
>
> **지금 하실 일**
> - 오늘 안에 처리가 필요하시면 회신해 주세요. 한도 상향을 도와드리겠습니다.
> - 급하지 않다면 내일 자동으로 이어서 처리됩니다.

### 해소 공지

> **[수맥] 문제집 반입 처리 정상화 안내**
>
> {UTC 시각}부로 AI·OCR 처리가 정상 재개되었습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 지연 시간 | {시작} ~ {종료} (총 {N}시간) |
> | 대기했던 작업 | {N}건 |
> | 유실된 작업 | 0건 |
> | 재처리 완료 예상 | {시각} |
>
> 대기 중이던 작업은 순차 처리 중이며, 반입 화면에서 진행률을 확인하실 수 있습니다.
> {품질 저하가 있었다면: "이 기간에 처리된 문항 {N}건은 재검수 대상으로 전환했습니다. 검수 화면에서 확인해 주세요."}

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| AI 공급자에게 예상 밖 데이터가 전송된 정황 | **필요** | 개인정보 처리 위탁 범위 위반 가능 |
| 프롬프트 인젝션으로 시스템 동작이 변경됨 | **필요** | 보안 사고. [RB-07](./07-account-takeover-malicious-upload.md) 병행 |
| 비용 폭주가 계약상 한도를 초과 | **필요** (계약 검토) | 공급자 계약 조건 |
| 단순 공급자 장애·대기 | 불필요 | — |
| 조직 예산 한도 도달 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV2 기준 영업일 5일)
- [ ] 회로 차단기가 예상대로 작동했는가. 임계값(20%/10분, 연속 5회)이 적절했는가
- [ ] 예산 게이트가 100%에서 실제로 막았는가. 넘어간 비용이 있다면 왜인가
- [ ] `ai_cost_spike` 알림(5배)이 충분히 빨랐는가. 더 이른 신호가 있었는가
- [ ] 재시도 제어(`max_attempts`, 백오프 상한)가 지켜졌는가
- [ ] 프롬프트·모델 승격 절차(골드셋 → 비용·지연 비교 → 그림자 7일 → 카나리)가 지켜졌는가
- [ ] `mock` 어댑터로 동일 시나리오를 재현할 수 있는가. 못 하면 픽스처를 추가했는가
- [ ] 조직별 기본 한도(USD 20/일)가 실사용과 맞는가. 상향이 필요한 조직 유형이 있는가
- [ ] 적체 재개 시 지터가 실제로 몰림을 막았는가
- [ ] 검수 인력 부담이 급증했다면 우선순위·배정 규칙을 조정했는가
