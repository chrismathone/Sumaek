# ADR-0010 — 비동기 작업 큐와 AI 공급자 추상화

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [architecture.md](../phase0/architecture.md) 5.2 · [assumptions.md](../phase0/assumptions.md) 3.4 · [ADR-0006](./0006-transactional-outbox-inbox.md) · [ADR-0004](./0004-database-and-object-storage.md) |

---

## 맥락

### 큐

수맥의 비동기 작업은 특성이 크게 다르다.

| 작업 | 지연 요구 | 실행 시간 | 1일 건수 |
|---|---|---|---|
| 자동 채점 | 즉시 (30초) | 2~15초 | 480,000 |
| 일정 재계산 | 60초 (SLO O-03) | 5~300초 | 1,200 |
| 자동 출제 | 2분 (O-04) | 10~120초 | 16,700 |
| KaTeX 검증 | 5초 (O-06) | 0.2~3초 | 672,000 |
| PDF·HWPX 출력 | 2분 (O-07) | 20~120초 | 50,000 |
| OCR 반입 | 20분 (O-05) | 300~1,800초 | 50,000 페이지 |

**핵심 요구**: "실시간 채점이 대량 OCR보다 높은 우선순위", "한 조직의 대량 작업이 다른 조직을 막지 않게", "접수 완료 비동기 작업 유실 0건".

### AI

사용자 확정: **목 어댑터 우선.** `AI_PROVIDER=mock|anthropic`, 키는 환경변수. **키 없이 E2E가 통과해야 한다.**

비용 상한 계산([assumptions.md](../phase0/assumptions.md) 3.4): 1일 5만 페이지 반입 시 **USD 14,730/일**. 예산 게이트 없이는 운영 불가.

## 결정 A — PostgreSQL 기반 자체 작업 큐

### 1. 테이블과 클레임

```sql
CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  queue           text NOT NULL CHECK (queue IN ('realtime','schedule','render','ai','default')),
  job_type        text NOT NULL,
  priority        integer NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','waiting_review','succeeded',
                                    'failed','cancelled','dead_lettered')),
  run_after       timestamptz NOT NULL DEFAULT now(),
  attempt_count   integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL,
  lease_until     timestamptz,
  locked_by       text,
  idempotency_key text NOT NULL,
  input_hash      text NOT NULL,
  input           jsonb NOT NULL,
  output          jsonb,
  last_error      text,
  retryable       boolean,
  cost_cents      integer NOT NULL DEFAULT 0,
  cancel_requested_by text,
  pipeline_version    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jobs_idem ON jobs (organization_id, job_type, idempotency_key)
  WHERE status <> 'cancelled';
CREATE INDEX jobs_claim ON jobs (queue, priority DESC, run_after, id)
  WHERE status = 'queued';
```

**클레임 — 공정 스케줄러 포함**:

```sql
WITH candidate AS (
  SELECT id, organization_id,
         row_number() OVER (PARTITION BY organization_id ORDER BY priority DESC, run_after, id) AS org_rank
  FROM jobs
  WHERE queue = $1 AND status = 'queued' AND run_after <= now()
  ORDER BY priority DESC, run_after, id
  LIMIT 500
),
fair AS (
  -- 단일 조직이 배치의 40%를 넘지 못하게 한다
  SELECT id FROM candidate WHERE org_rank <= GREATEST(1, ($2 * 40 / 100))
  ORDER BY org_rank, id LIMIT $2
),
locked AS (
  SELECT j.id FROM jobs j JOIN fair f ON f.id = j.id
  WHERE j.status = 'queued'
  FOR UPDATE OF j SKIP LOCKED
)
UPDATE jobs SET status='running', lease_until = now() + $3::interval,
                locked_by = $4, attempt_count = attempt_count + 1, updated_at = now()
FROM locked WHERE jobs.id = locked.id
RETURNING jobs.*;
```

`FOR UPDATE SKIP LOCKED`가 워커 간 경합을 해결하고, `row_number() OVER (PARTITION BY organization_id)`가 조직별 공정성을 만든다.

### 2. 큐 5종 (확정)

| 큐 | 우선순위 | 가시성(lease) | 최대 시도 | 백오프 기본 | 조직 동시 한도 |
|---|---|---|---|---|---|
| `realtime` | 100 | 60 s | 5 | 2 s | 20 |
| `schedule` | 80 | 600 s | 3 | 30 s | 4 |
| `render` | 60 | 300 s | 4 | 15 s | 8 |
| `ai` | 40 | 900 s | 5 | 60 s (상한 15분) | 3 |
| `default` | 20 | 300 s | 3 | 30 s | 6 |

백오프: `min(base × 2^(n-1), cap) × random(0, 1)` — **전체 지터**(thundering herd 방지).

워커는 `WORKER_QUEUES` 환경변수로 담당 큐를 받는다. 큐 조합 변경에 코드 수정이 필요 없다.

### 3. lease와 재개

| 상황 | 처리 |
|---|---|
| 워커가 정상 완료 | `status='succeeded'`, lease 해제 |
| 워커가 크래시 | `lease_until` 만료 후 다른 워커가 재클레임. `attempt_count`는 이미 증가함 |
| 처리 중 갱신 | 30초마다 `lease_until` 연장 (장시간 작업) |
| `SIGTERM` | **새 클레임만 중단**, 진행 중 작업은 최대 120초 완료 대기 |

### 4. 체크포인트와 멱등성

콘텐츠 파이프라인은 **페이지·문항 단위 체크포인트**를 `job_runs`에 기록한다.

```
idempotency_key = H(organization_id, source_sha256, book_edition_id, pipeline_version, step)
```

재개는 마지막 성공 단계 다음부터. 같은 키로 재실행해도 **중복 산출물이 생기지 않는다.**

### 5. 재시도 분류

| 오류 | 재시도 | 결과 |
|---|---|---|
| 408, 429, 502, 503, 504 | O | `retry_scheduled` |
| 공급자 타임아웃 | O | 동일 |
| lease 만료 | O | 즉시 재클레임 |
| 401, 403 (권한·인증) | **X** | `failed` → `dead_lettered` |
| 400, 422 (입력 오류) | **X** | `failed` → `dead_lettered` |
| AI 스키마 검증 실패 | X | `waiting_review` (사람 검수) |
| `max_attempts` 초과 | — | `dead_lettered` |
| 최대 경과 시간 초과 (큐별 lease × max_attempts × 4) | — | `dead_lettered` |

### 6. DLQ

`dead_lettered` 작업은 **원인·이력·`input_hash`·`retryable` 여부·마지막 `job_runs` 단계**를 보존한다.

재처리(`POST /api/v1/ops/dlq/{jobId}:reprocess`)는 **같은 멱등성 키**를 사용한다. 중복 산출물이 생기지 않는다. 재처리는 원 작업의 `organization_id` 컨텍스트로 실행한다 — 관리자 세션의 조직이 아니다(교차 테넌트 방지).

### 7. 취소와 완료 경합

```
1. 사용자가 :cancel → cancel_requested_by 설정 (status는 그대로)
2. 워커가 체크포인트에서 확인 → status='cancelled'
3. 이미 succeeded로 커밋됐으면 → 409 JOB_ALREADY_COMPLETED
```

**게시 상태 일관성은 게시 게이트가 보장한다.** 취소된 작업의 부분 산출물은 게시되지 않는다.

### 8. 한도

| 대상 | 한도 |
|---|---|
| 파일 크기 | 200 MB |
| 페이지 수 | 1,500/파일 |
| 작업당 최대 실행 시간 | 큐별 lease × max_attempts |
| 조직 동시 실행 | 큐별 표 |
| 조직 배치 점유율 | ≤ 40% |
| AI 비용 | 조직 1일 USD 20, 전체 1일 USD 4,000 |
| 예산 80% | 경고 알림 |
| 예산 100% | 신규 `ai` 작업 클레임 보류 (`queued` 유지) |

---

## 결정 B — AI 공급자 추상화

### 1. 인터페이스

```ts
// packages/core/src/ai/provider.ts
export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  readonly modelVersion: string;
  readonly promptVersion: string;

  /** 구조화 스키마만 반환한다. 자유 텍스트 없음. */
  extract<T>(req: {
    step: AiStep;                    // ocr | segment | structure | answer_verify | classify
    input: AiInput;                  // 이미지 참조 또는 텍스트
    schema: z.ZodType<T>;            // 출력 계약 (.strict())
    maxTokens: number;
    timeoutMs: number;
  }): Promise<AiResult<T>>;
}

export interface AiResult<T> {
  value: T;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  modelVersion: string;
  promptVersion: string;
}
```

### 2. `mock` 어댑터가 기본이다

| 규칙 | 내용 |
|---|---|
| 기본값 | `AI_PROVIDER=mock` |
| 결정론 | 같은 입력 → 같은 출력 (입력 해시 기반 픽스처 조회) |
| 픽스처 | `packages/core/src/ai/__fixtures__/` — 골든 코퍼스와 공유 |
| 미등록 입력 | 스키마를 만족하는 **저신뢰 결과**(confidence 0.3) 반환 → 검수 경로로 감 |
| 비용 | `costCents = 0` |
| **E2E** | **키 없이 전 시나리오 통과.** CI 기본 설정 |

이것이 "완료 기준 = 코드 완결 + 로컬 검증"을 가능하게 하는 장치다.

### 3. `anthropic` 어댑터

| 항목 | 값 |
|---|---|
| 활성 조건 | `AI_PROVIDER=anthropic` **AND** `ANTHROPIC_API_KEY` 존재. 키 없으면 기동 실패(조용한 폴백 금지) |
| 키 보관 | 비밀 관리 시스템. 서버 전용. 클라이언트 번들·이미지·설정 파일에 넣지 않음 |
| 회전 | 90일 |
| 출력 강제 | 구조화 스키마만. 자유 텍스트 응답을 파싱하지 않음 |
| 검증 | zod `.strict()` → 허용 목록 → 수학 검증 → 권한 검사. 전부 통과해야 저장 |
| 네트워크 | AI 워커는 내부망·클라우드 메타데이터(`169.254.169.254`) 접근 차단 |
| 전송 데이터 | **학생 데이터 미전송.** 조직 식별 정보 제거 |
| 회로 차단기 | 공급자별. 실패율 20%(10분 창) 또는 연속 타임아웃 5회 → OPEN 30초, 지수 증가 최대 5분 |
| 기록 | `job_runs`에 `model_version`·`prompt_version`·`tokens_in`·`tokens_out`·`cost_cents` |

### 4. 프롬프트·모델 버전 관리

| 항목 | 규칙 |
|---|---|
| 프롬프트 | `packages/core/src/ai/prompts/<step>/<version>.ts` — 코드로 버전 관리 |
| 버전 형식 | `YYYY.MM.N` |
| 승격 절차 | ① 골드 데이터셋 회귀 ② 비용·지연 비교 ③ 그림자 실행 7일 ④ 카나리 10% ⑤ 전면 |
| 롤백 | 환경변수 `AI_PROMPT_VERSION` 고정으로 즉시 |
| 기록 | 산출물마다 사용한 버전이 `question_versions.ai_prompt_version`·`job_runs`에 남음 |

### 5. 프롬프트 인젝션 방어

| 계층 | 조치 |
|---|---|
| 입력 | PDF·이미지 안의 지시문은 **데이터로만** 처리. 시스템 프롬프트와 콘텐츠를 구조적으로 분리 |
| 도구 | AI 워커에 도구 호출 권한 없음. 순수 JSON 응답만 |
| 출력 | `.strict()` + 명령 허용 목록 + 수학 검증. 스키마 밖 필드는 저장 실패 |
| 권한 | AI 출력이 `content_rights`·`publish_gate_status`·권한 테이블을 바꿀 수 없다 (해당 컬럼은 AI 경로에서 쓰기 불가) |
| 네트워크 | 샌드박스, 내부망 차단 |

### 6. 예산 게이트

```
1. 작업 등록 시: 조직 일 누적 cost_cents 조회 → 100% 초과면 429 BUDGET_EXCEEDED
2. 클레임 시: 재확인 (등록 후 다른 작업이 소진했을 수 있음) → 초과면 run_after 미룸
3. 실행 후: job_runs.cost_cents 기록 → 누적 갱신
4. 80% 도달: 경고 알림 (SEV3, 전체 예산이면 SEV2)
5. 100% 도달: 신규 ai 작업 클레임 보류. 큐에는 남아 있음 (삭제하지 않음)
```

---

## 대안

### 큐

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. Redis 기반 (BullMQ 등)** | 성숙, 대시보드, 지연 낮음 | ① 인프라 컴포넌트 +1 ② **작업 등록과 도메인 트랜잭션이 원자적이지 않다** — 유실 위험(SLO O-08 위반) ③ Redis 영속성 설정 실수 시 유실 ④ 조직별 공정 스케줄링 구현이 번거로움 |
| **B. SQS·Cloud Tasks** | 관리형, 무한 확장 | ① 원자성 문제 동일 ② 지연 시간 ③ 조직별 공정성·우선순위 제어 어려움 ④ 비용 |
| **C. Kafka** | 높은 처리량, 순서 보장 | ① 작업 큐가 아니라 로그 — 개별 작업 취소·재시도 모델이 어색 ② 운영 부담 ③ 현재 처리량에 과함 |
| **D. `pg_cron` + 폴링 테이블** | 단순 | 우선순위·공정성·lease·DLQ를 직접 만들어야 함. 결국 지금 설계와 같아짐 |
| **E. PostgreSQL `SKIP LOCKED` (채택)** | ① **작업 등록이 도메인 트랜잭션과 같은 커밋** ② RLS·백업·PITR이 그대로 적용 ③ 인프라 0개 추가 ④ SQL로 공정 스케줄링 표현 | — |
| **F. 큐 없이 동기 처리** | 가장 단순 | OCR 20분, PDF 2분을 동기로 할 수 없다 |

**PostgreSQL 큐의 한계와 도입 조건**: 처리량 4,000 작업/초를 넘거나, 클레임 쿼리의 락 경합이 실측 병목이 되면 외부 브로커를 검토한다. 현재 피크는 `realtime` 기준 약 20 작업/초다.

### AI

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **G. 단일 공급자 직접 호출 (추상화 없음)** | 단순 | ① 키 없이 E2E 불가 — 사용자 확정 요구 위반 ② 공급자 교체 비용 ③ 테스트에서 실제 호출 발생 |
| **H. LangChain 등 프레임워크** | 체인·에이전트 추상화 | ① 우리가 필요한 것은 "구조화 출력 1회 호출"뿐 ② 추상화가 프롬프트 버전 관리를 가림 ③ 의존성 크기 |
| **I. 자유 텍스트 응답 후 파싱** | 유연 | 프롬프트 인젝션 방어가 어렵다. 스키마 강제가 방어의 핵심 |
| **J. AI에 도구 호출 권한 부여** | 자동화 범위 확대 | E-06(프롬프트 인젝션으로 권한 상승) 위험. 도구 없이도 필요한 기능이 다 된다 |
| **K. mock 없이 스텁 서버** | 실제 HTTP 경로 검증 | 별도 프로세스 필요. `mock` 어댑터가 같은 인터페이스를 구현하면 충분 |

## 비용

| 항목 | 비용 |
|---|---|
| DB 부하 (클레임 쿼리) | 큐당 초당 20회 × 5큐 = 100 쿼리/초. 부분 인덱스로 각 1 ms 이하 |
| `jobs` 저장 | 1일 약 60만 행 × 1.5 KB = 900 MB/일. 성공 후 7일 보존 |
| `job_runs` 저장 | 1일 약 200만 행 × 0.4 KB = 800 MB/일. 90일 = 72 GB |
| 워커 인프라 | 6 프로세스, 월 약 USD 380 |
| AI 비용 (상한) | USD 14,730/일 — **예산 게이트 필수** |
| AI 비용 (1년차) | USD 589/일 |
| 개발 | 큐 러너·공정 스케줄러·DLQ·AI 어댑터 2종·예산 게이트 (약 2,000줄) |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | 큐 적체로 SLO 위반 | `queue_wait_exceeded` | 워커 증설. 저우선 큐 일시 중단(kill switch) |
| F-2 | 클레임 쿼리 락 경합 | 클레임 지연 상승 | `LIMIT` 하향, 워커 폴링 간격 지터, 큐별 워커 분리 |
| F-3 | 한 조직이 큐 독점 | 타 조직 대기 시간 급증 | 공정 스케줄러 40% 상한. 초과 시 조직 동시 한도 하향 |
| F-4 | lease 만료 전 완료되지 않아 중복 실행 | 같은 작업의 `attempt_count` 급증 | 장시간 작업은 30초마다 lease 갱신. 갱신 실패 시 작업 자체 중단 |
| F-5 | DLQ 폭증 | `dlq_growth` > 20건/시간 | 원인 분류. 입력 오류면 어댑터 수정, 공급자 문제면 회로 차단기 |
| F-6 | AI 비용 폭주 | 예산 80% 알림 | 100%에서 자동 게이트. `ai_provider:<name>` kill switch |
| F-7 | 키 없이 `anthropic` 모드 기동 | 기동 실패(의도됨) | 조용한 mock 폴백을 만들지 않는다 — 운영에서 mock 결과가 게시되면 재앙 |
| F-8 | mock 픽스처가 실제와 괴리 | 운영 전환 시 대량 검수 전환 | 골드 데이터셋으로 mock·실제 결과를 주기 비교 |
| F-9 | 프롬프트 인젝션 성공 | 스키마 밖 출력, 이상 요청 | `.strict()` 실패 → `waiting_review`. 네트워크 차단이 2차 방어 |
| F-10 | 취소와 완료 경합으로 부분 산출물 게시 | 게시 게이트 실패 | 게이트가 필수 산출물 존재를 요구. 부분 결과는 게시 불가 |
| F-11 | 워커 배포 중 진행 작업 손실 | 작업 재시도 급증 | `SIGTERM` 후 120초 graceful. lease 유지 |

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| 큐 우선순위·한도 조정 | 환경변수·설정 | 없음 |
| 큐 추가·분할 | `CHECK` 제약 확장 + 워커 설정 | 낮음 |
| 워커 큐 조합 변경 | `WORKER_QUEUES` 환경변수 | 없음 |
| AI 공급자 전환 | `AI_PROVIDER` 환경변수. 인터페이스 동일 | 매우 낮음 |
| 프롬프트 버전 롤백 | `AI_PROMPT_VERSION` 환경변수 | 매우 낮음 |
| 새 AI 공급자 추가 | `AiProvider` 구현 1개 | 낮음 |
| PostgreSQL 큐 → 외부 브로커 | ① `jobs` 테이블은 **작업 원장으로 유지** ② 브로커는 알림 채널로만 사용 ③ 클레임 로직만 교체 | 중간 |
| 큐 제거 → 동기 처리 | **되돌리지 않는다.** 장시간 작업이 불가능 | — |
| AI 추상화 제거 | **되돌리지 않는다.** 키 없는 E2E가 깨진다 | — |

`jobs` 테이블을 **작업 원장**으로 유지하는 설계가 브로커 전환의 여지다. 브로커를 도입해도 "무엇을 처리해야 하는가"의 진실은 DB에 남는다 — 큐를 유일한 업무 기록 저장소로 쓰지 않는다는 원칙과 같다.
