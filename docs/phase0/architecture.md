# 아키텍처 — C4 컨텍스트·컨테이너·컴포넌트

> 골프롬프트 2B(목표 논리 아키텍처) 이행 문서.
> 상위 결정: [decisions.md](./decisions.md) · 근거 수치: [assumptions.md](./assumptions.md)

관련 문서: [domain-map.md](./domain-map.md) · [failure-modes.md](./failure-modes.md) · [ADR-0002 모듈형 모놀리스](../adr/0002-modular-monolith.md)

---

## 1. 한 줄 요약

**도메인 경계가 명확한 모듈형 모놀리스**. 배포 단위는 `web`(Next.js 16, 사용자 요청)과 `worker`(tsx, 비동기 작업) **2개**이며, 둘 다 같은 `packages/core` 도메인 코드와 같은 PostgreSQL을 사용한다. 서비스 분리는 4장 기준을 실측으로 충족하기 전까지 하지 않는다.

---

## 2. C4 Level 1 — 시스템 컨텍스트

```mermaid
flowchart TB
    subgraph People["사람"]
        Visitor["방문자<br/>공개 웹·샘플 데모"]
        Owner["워크스페이스 소유자"]
        Director["수학 프로그램 책임자"]
        Teacher["선생님"]
        Grader["평가 조교·채점자"]
        ContentMgr["콘텐츠 관리자·검수자"]
        Student["학생"]
        Operator["수맥 운영자<br/>break-glass"]
    end

    SuMaek["<b>수맥 (Su-Maek)</b><br/>수학 수업 설계·평가 자동화 플랫폼<br/>루트 설계 → 오늘 수업 → 자동 출제 → 응시<br/>→ 자동 채점 → 숙련도 → 재계산"]

    subgraph External["외부 시스템"]
        Supabase["Supabase<br/>PostgreSQL · Auth · Storage"]
        AIProv["AI·OCR 공급자<br/>AI_PROVIDER=mock 기본<br/>anthropic 선택"]
        Authority["교육과정 권위 소스<br/>교육부 · NCIC"]
        SIS["외부 SIS·LMS·학원 ERP<br/>얇은 어댑터"]
        Mail["이메일 발송 공급자"]
    end

    Visitor -->|"랜딩·데모·도입 문의<br/>합성 데이터만"| SuMaek
    Owner -->|"사용자·보안·연동·사용량"| SuMaek
    Director -->|"교육과정·루트·평가 정책·게시 승인"| SuMaek
    Teacher -->|"오늘 수업·루트 초안·테스트·채점"| SuMaek
    Grader -->|"배정된 채점·예외 처리"| SuMaek
    ContentMgr -->|"교재 반입·수식 검수·권한 관리"| SuMaek
    Student -->|"오늘 학습·응시·오답 복습"| SuMaek
    Operator -.->|"시간 제한·사유·승인·감사"| SuMaek

    SuMaek -->|"트랜잭션 데이터·인증·객체 저장"| Supabase
    SuMaek -->|"OCR·수식 추출·해설 검증·분류<br/>최소 데이터만 전송"| AIProv
    SuMaek -->|"원문 수집·체크섬 검증<br/>읽기 전용"| Authority
    SIS -->|"최소 명단 · 학습 불참 이벤트<br/>허용 목록 밖 필드 폐기"| SuMaek
    SuMaek -->|"평가 결과 내보내기·오늘 학습 링크"| SIS
    SuMaek -->|"앱 내 업무함 보조 알림"| Mail

    classDef sys fill:#162338,stroke:#162338,color:#F3F6F6
    classDef ext fill:#F3F6F6,stroke:#AAB8C2,color:#162338
    class SuMaek sys
    class Supabase,AIProv,Authority,SIS,Mail ext
```

### 2.1 경계에서 하지 않는 일

| 외부 시스템 | 받는 것 | 절대 저장하지 않는 것 |
|---|---|---|
| SIS·LMS·ERP | 학생 불변 ID, 표시명, 소속 그룹, 학습 불참 이벤트 | 결제·수납, 상담 이력, 전자출결 원장, 보호자 연락처, 주소, 생활기록 |
| AI 공급자 | 구조화 스키마 응답만 | 학생 이름·연락처, 조직 식별 정보 (문항 처리 시 학생 데이터 미전송) |
| 권위 소스 | 원문 체크섬, 인용 위치, 발행 메타 | 원문 전문 재배포 (Q-02) |

집행: `scripts/boundary-check.mjs` 빌드 게이트 + 어댑터 zod `.strict()` + 폐기 필드 카운터 메트릭.

---

## 3. C4 Level 2 — 컨테이너

```mermaid
flowchart TB
    subgraph Clients["클라이언트"]
        Browser["브라우저<br/>교사·학생·방문자"]
    end

    subgraph Deploy["수맥 배포 단위"]
        Web["<b>apps/web</b><br/>Next.js 16 App Router<br/>RSC + Server Actions + Route Handlers<br/>proxy.ts 세션 갱신<br/><i>사용자 요청 전담</i>"]
        Worker["<b>apps/worker</b><br/>tsx 상시 프로세스<br/>Outbox 릴레이 · 큐 소비 · 스케줄러<br/><i>독립 배포·확장</i>"]
    end

    subgraph Shared["공유 패키지 (배포 아님)"]
        Core["<b>packages/core</b><br/>순수 도메인<br/>일정 엔진 · 채점 · 숙련도<br/>수식 정규화 · 권한 판정<br/>I/O 없음 · 결정론"]
        Contracts["<b>packages/contracts</b><br/>zod 4 · API/이벤트/작업 스키마<br/>이벤트 schema_version"]
        Db["<b>packages/db</b><br/>Drizzle 스키마(타입 소스)<br/>postgres.js 런타임 데이터 계층<br/>마이그레이션 러너"]
    end

    subgraph Data["데이터 계층 (Supabase 클라우드)"]
        PG[("<b>PostgreSQL 17</b><br/>단일 진실 공급원<br/>RLS 3계층 · 월 파티션")]
        Outbox[("outbox_events<br/>inbox_messages")]
        Jobs[("jobs · job_runs<br/>SKIP LOCKED 큐")]
        Storage[("Supabase Storage<br/>{organization_id}/... 경로<br/>원본·산출물·체크섬")]
        Auth["Supabase Auth<br/>refresh 회전 ON"]
    end

    subgraph Derived["파생 계층 (재생성 가능)"]
        ReadModel[("읽기 모델<br/>오늘 운영실 집계<br/>검색 인덱스<br/>materialized view + 증분 테이블")]
    end

    subgraph Ext["외부"]
        AI["AI·OCR 어댑터<br/>mock | anthropic"]
        Chromium["Chromium<br/>Playwright 인쇄 CSS"]
        Mail2["이메일 공급자"]
    end

    Obs["관측성<br/>구조화 로그 · 메트릭 · 트레이스<br/>audit_events (별도 저장·불변)"]

    Browser -->|HTTPS| Web
    Web --> Core
    Web --> Contracts
    Web --> Db
    Worker --> Core
    Worker --> Contracts
    Worker --> Db
    Db --> PG
    Web -->|세션| Auth
    Web -->|서명 URL| Storage
    PG --- Outbox
    PG --- Jobs
    Worker -->|"릴레이: pending → sent"| Outbox
    Worker -->|"claim: FOR UPDATE SKIP LOCKED"| Jobs
    Web -->|"작업 등록(같은 TX)"| Jobs
    Worker --> AI
    Worker --> Chromium
    Worker --> Storage
    Worker --> Mail2
    Worker -->|증분 갱신| ReadModel
    ReadModel --> Web
    Web --> Obs
    Worker --> Obs

    classDef dep fill:#2257D7,stroke:#162338,color:#FFFFFF
    classDef data fill:#F3F6F6,stroke:#2257D7,color:#162338
    classDef der fill:#F3F6F6,stroke:#F1D66A,color:#162338
    class Web,Worker dep
    class PG,Outbox,Jobs,Storage,Auth data
    class ReadModel der
```

### 3.1 컨테이너 계약

| 컨테이너 | 책임 | 하지 않는 것 | 확장 축 |
|---|---|---|---|
| `apps/web` | 사용자 요청 처리, 권한 판정, 트랜잭션 커밋, Outbox·작업 등록 | 외부 AI 호출, PDF·HWPX 렌더, 30초 초과 작업 | 수평 (무상태). 인스턴스당 DB pool max 10 |
| `apps/worker` | 큐 소비, Outbox 릴레이, 스케줄러, AI·렌더 호출, 읽기 모델 증분 갱신 | 사용자 HTTP 요청 처리 | 큐별 수평. `render` 큐 4 vCPU×2, `ai` 큐 2 vCPU×2, `default` 큐 2 vCPU×2 |
| `packages/core` | 결정론적 순수 로직 | DB·네트워크·`Date.now()`·`Math.random()` 접근 | — (라이브러리) |
| `packages/db` | 스키마 정의, 쿼리, 마이그레이션 | 도메인 규칙 | — |
| `packages/contracts` | zod 스키마 = API·이벤트·작업 페이로드의 단일 정의 | — | — |

**web과 worker를 나눈 이유**: 확장 특성이 다르다. web은 요청 동시성(수평, 짧은 수명), worker는 CPU·외부 IO 대기(Chromium 4 vCPU 고정, AI 호출 대기). 같은 프로세스에 두면 대량 OCR이 답안 제출 지연을 만든다(골프롬프트 28장: "실시간 채점이 대량 OCR보다 높은 우선순위"). **데이터는 분리하지 않는다** — 같은 DB, 같은 트랜잭션 경계.

### 3.2 `packages/core`의 순수성 강제

```ts
// packages/core/src/shared/clock.ts — 시간·난수는 반드시 주입
export interface DeterministicContext {
  readonly now: Date;            // 호출자가 고정
  readonly seed: string;         // 엔진 시드
  readonly timezoneId: string;   // IANA
  readonly engineVersion: string;
}
```

- ESLint 규칙: `packages/core/**`에서 `Date.now`, `new Date()` (인자 없음), `Math.random`, `crypto.randomUUID`, `process.env`, `fetch` 금지.
- 단위 테스트: 같은 `DeterministicContext` + 같은 입력 → 같은 출력 해시 (fast-check 속성 테스트).

---

## 4. 서비스 분리 기준

골프롬프트 2B의 6개 조건 중 **2개 이상이 실측으로 확인될 때만** 분리를 검토한다. 추측은 근거가 아니다.

| # | 조건 | 측정 지표 | 분리 검토 임계값 |
|---|---|---|---|
| S-1 | 다른 모듈과 현저히 다른 확장·자원 특성 | 큐별 CPU-초/요청, 메모리 상주 | 특정 큐가 전체 워커 CPU의 60% 이상을 30일 연속 점유 |
| S-2 | 반드시 격리해야 하는 장애 영향 | 해당 모듈 장애로 인한 타 모듈 SLO 위반 횟수 | 90일 내 3회 이상 |
| S-3 | 독립 런타임(Python·GPU)의 지속적 필요 | 해당 런타임 없이 대체 불가한 기능 수 | 2개 이상이 6개월 이상 지속 |
| S-4 | 별도 보안·데이터 지역·배포 주기 | 규제 요구 문서 | 계약상 요구 발생 시 즉시 |
| S-5 | 독립 소유 팀과 안정된 공개 계약 | 팀 수, 계약 변경 빈도 | 전담 팀 2개 이상 + 계약 6개월 무변경 |
| S-6 | 단일 DB로 해결 불가한 실측 병목 | p99 지연, 락 대기, IO 포화 | 파티션·인덱스·풀 튜닝 후에도 SLO 미달이 30일 지속 |

### 4.1 분리 후보 우선순위 (조건 충족 시)

| 순위 | 후보 | 예상 충족 조건 | 분리 시 소유 데이터 | 계약 |
|---|---|---|---|---|
| 1 | **콘텐츠 반입 OCR·AI 워커** | S-1, S-3 (Python 기반 레이아웃 모델 도입 시) | `source_files`, `source_pages`, 추출 중간 산출물 | 작업 등록 API + `ContentApproved` 이벤트 |
| 2 | **문서 출력 워커 (PDF·HWPX)** | S-1 (Chromium CPU 독점) | `document_exports` (메타는 코어 유지) | 작업 등록 API + `RenderArtifactValidated` |
| 3 | **알림 워커** | S-2 (외부 공급자 장애 격리) | 없음 (읽기만) | Outbox 소비만 |
| 4 | **대용량 리포트 워커** | S-1 | 없음 | 작업 등록 API |

### 4.2 절대 분리하지 않는 영역

루트 게시, 실제 수업 생성·충돌 확정, 평가 게시·스냅샷, 응시·답안·채점 확정. **강한 트랜잭션 관계**(2D 강한 일관성 목록)가 있어 분리하면 분산 트랜잭션 또는 사가가 필요해진다. 이 영역은 S-6이 증명되어도 먼저 DB 수직 확장·파티셔닝을 시도한다.

---

## 5. C4 Level 3 — 핵심 컴포넌트

### 5.1 `apps/web` 내부

```mermaid
flowchart TB
    subgraph Edge["요청 진입"]
        Proxy["proxy.ts<br/>세션 쿠키 갱신만<br/>matcher: api·_next·정적 제외<br/><b>게이트 = 쿠키 존재 여부</b>"]
    end

    subgraph Groups["App Router 경로 그룹 = 인증 경계"]
        Mkt["(marketing)<br/>/ /demo /product /security"]
        AuthG["(auth)<br/>/login /invite /recover"]
        Shell["(shell)<br/>/app/** 교사·관리자"]
        Learn["(learn)<br/>/learn/** 학생"]
        Print["(print)<br/>인쇄 전용 레이아웃"]
    end

    subgraph Guards["3-게이트 소비 패턴"]
        RequireAccess["requireAccess()<br/>페이지 → redirect"]
        ApiAccess["apiAccess()<br/>API → 401·403"]
        PermMatrix["getPermMatrix()<br/>요청당 cache · fail-open"]
        Scope["getTeacherScope()<br/>담당 반 → 학생 ID 필터"]
    end

    subgraph Features["src/features/<도메인>"]
        Queries["server/queries.ts<br/>읽기"]
        Actions["server/actions.ts<br/>명령 = 트랜잭션 경계"]
        Comps["components/"]
    end

    subgraph AppSvc["애플리케이션 서비스"]
        Idem["멱등성 게이트<br/>idempotency_keys"]
        Lock["낙관적 잠금<br/>If-Match ↔ aggregate_version"]
        TxRunner["트랜잭션 러너<br/>쓰기 + Outbox + jobs 원자 커밋"]
    end

    CoreRef["packages/core<br/>순수 도메인 호출"]
    DbRef["packages/db<br/>postgres.js"]

    Proxy --> Groups
    Shell --> RequireAccess
    Learn --> RequireAccess
    RequireAccess --> PermMatrix
    ApiAccess --> PermMatrix
    PermMatrix --> Scope
    Shell --> Features
    Learn --> Features
    Actions --> Idem
    Idem --> Lock
    Lock --> TxRunner
    TxRunner --> CoreRef
    TxRunner --> DbRef
    Queries --> DbRef

    classDef guard fill:#F1D66A,stroke:#162338,color:#162338
    class RequireAccess,ApiAccess,PermMatrix,Scope guard
```

핵심 규약 (eywa 실측 이식):

1. **인증 게이트는 쿠키 존재만 확인**한다. `proxy.ts`에서 `getUser()` 검증 실패를 로그아웃으로 처리하면 로그인 무한루프가 난다(eywa 실사고 2). 실제 검증은 `(shell)/layout.tsx`의 `getCurrentUser()`.
2. **`organization_id`와 역할은 JWT가 아니라 `users`·`memberships`에서 항상 조회**한다. JWT 클레임은 신선도를 보장하지 않는다.
3. **`canAccess`(읽기)와 `canWrite`(쓰기)를 분리**한다. 변경 액션에 `canAccess`를 쓰면 readonly 권한이 샌다(eywa 실사고).
4. **`getPermMatrix`는 fail-open**(조회 실패 시 최고 역할 통과). 관리자 락아웃 방지. 단, **DB RLS는 fail-closed**로 최종 차단한다(eywa 실사고 1·3).
5. 명령은 반드시 `멱등성 게이트 → 낙관적 잠금 → 트랜잭션 러너` 순서를 거친다.

### 5.2 `apps/worker` 내부

```mermaid
flowchart TB
    subgraph Loops["상시 루프"]
        Relay["Outbox 릴레이<br/>배치 200 · 50ms 사이클<br/>pending → sent"]
        Claimer["작업 클레이머<br/>FOR UPDATE SKIP LOCKED<br/>lease_until = now()+visibility"]
        Sched["스케줄러<br/>일 배치 · 파티션 정리<br/>만료 산출물 삭제"]
        Budget["예산 감시<br/>조직별 cost_cents 집계<br/>80% 경고 · 100% 게이트"]
    end

    subgraph Queues["큐 (priority DESC, run_after ASC)"]
        Q1["realtime<br/>우선순위 100<br/>자동 채점 · 제출 후처리"]
        Q2["schedule<br/>우선순위 80<br/>일정 재계산 · 평가 생성"]
        Q3["render<br/>우선순위 60<br/>KaTeX 검증 · PDF · HWPX"]
        Q4["ai<br/>우선순위 40<br/>OCR · 추출 · 분류"]
        Q5["default<br/>우선순위 20<br/>리포트 · 알림 · 내보내기"]
    end

    subgraph Handlers["핸들러"]
        H1["채점 핸들러"]
        H2["일정 엔진 러너"]
        H3["평가 생성기"]
        H4["수식 파이프라인"]
        H5["문서 출력 어댑터"]
        H6["콘텐츠 반입 파이프라인"]
        H7["숙련도 재계산기"]
        H8["읽기 모델 갱신기"]
        H9["알림 발송기"]
    end

    Inbox["Inbox 중복 차단<br/>(consumer_name, event_id) UNIQUE"]
    Fair["공정 스케줄러<br/>조직별 동시 실행 한도<br/>라운드로빈 + 가중치"]
    CB["회로 차단기<br/>공급자별 5xx·타임아웃"]
    DLQ["DLQ<br/>원인·이력·해시·재처리 가능 여부"]

    Relay --> Inbox
    Inbox --> Handlers
    Claimer --> Fair
    Fair --> Queues
    Queues --> Handlers
    H4 --> CB
    H6 --> CB
    Handlers -->|max_attempts 초과| DLQ
    Budget -.->|한도 초과 시 claim 보류| Q4

    classDef q fill:#2257D7,stroke:#162338,color:#FFFFFF
    class Q1,Q2,Q3,Q4,Q5 q
```

큐 계약:

| 큐 | 우선순위 | 가시성 타임아웃 | 최대 시도 | 백오프 | 조직별 동시 한도 |
|---|---|---|---|---|---|
| `realtime` | 100 | 60 s | 5 | 지수 2^n × 2s, 전체 지터 | 20 |
| `schedule` | 80 | 600 s | 3 | 지수 2^n × 30s | 4 |
| `render` | 60 | 300 s | 4 | 지수 2^n × 15s | 8 |
| `ai` | 40 | 900 s | 5 (408·429·일시적 5xx만) | 지수 2^n × 60s, 상한 15분 | 3 |
| `default` | 20 | 300 s | 3 | 지수 2^n × 30s | 6 |

**공정 스케줄러**: 한 클레임 배치(최대 50건)에서 단일 조직의 점유율을 40% 이하로 제한한다. 초과분은 다음 사이클로 미룬다. 이것이 "한 조직의 대량 작업이 다른 조직을 막지 않게 한다"의 구현이다.

### 5.3 수식 파이프라인 컴포넌트 (`packages/core/src/math`)

모든 화면·출력이 **하나의 파이프라인**을 통과한다. 별도 수식 처리기를 만드는 것을 금지한다.

```mermaid
flowchart LR
    In["구조화 블록<br/>+ 원본 자산"] --> P1["1. 비수식 블록 보호<br/>SVG·표·이미지 → 자리표시자"]
    P1 --> P2["2. 무손실 복구<br/>백슬래시·구분자·유니코드"]
    P2 --> P3["3. 토큰화·균형 검사<br/>괄호·중괄호·환경"]
    P3 --> P4["4. 허용 목록 구문 검증<br/>macro_policy_version"]
    P4 --> P5["5. KaTeX 서버 사전 파싱<br/>오류 명시 수집"]
    P5 --> P6["6. HTML+MathML 생성<br/>render_hash 저장"]
    P6 --> P7["7. 블록 재조립<br/>표·조건·선택지·도형"]
    P7 --> P8["8. 시각 회귀<br/>web 1280 · mobile 360 · print A4"]
    P8 --> P9["9. PDF·HWPX 변환<br/>의미·레이아웃 동등성"]
    P9 --> Gate{"10. 게시 게이트<br/>10개 조건 전부 통과?"}
    Gate -->|통과| Pub["게시 가능"]
    Gate -->|실패| Quar["FORMULA_REVIEW_REQUIRED<br/>LAYOUT_REVIEW_REQUIRED<br/>검수 격리"]

    classDef gate fill:#C9453D,stroke:#162338,color:#FFFFFF
    class Gate,Quar gate
```

- 의미 변경 가능 보정은 **저작 화면의 제안으로만** 제공하고, 게시 파이프라인에서는 **실패**로 처리한다.
- `.math-raw` 중립 폴백은 **저작·검수 화면에서만** 허용한다. 학생 게시물·PDF·HWPX에는 0건.

---

## 6. 일관성 경계

```mermaid
flowchart LR
    subgraph Strong["강한 일관성 — 단일 트랜잭션 또는 원자적 포인터 전환"]
        S1["조직 권한 확인·쓰기"]
        S2["루트 버전 게시·활성 전환"]
        S3["수업 배정·시간 충돌 확정"]
        S4["평가 문항 스냅샷·게시"]
        S5["답안 제출·응시 상태 전환"]
        S6["최종 채점·교사 재판정"]
        S7["일정 변경안 승인·활성 전환"]
        S8["문항 검수·권한 상태 전환"]
        S9["교육과정 릴리스 발행"]
        S10["문항 버전·렌더 산출물·수식 검수 게시 전환"]
    end

    subgraph Eventual["최종 일관성 — 확정 원본에서 재생성 가능"]
        E1["숙련도·복습 추천<br/>60초"]
        E2["미래 일정 변경안 계산<br/>비동기"]
        E3["오늘 운영실 집계<br/>30초"]
        E4["검색 인덱스<br/>30초"]
        E5["분석·리포트<br/>비동기"]
        E6["알림<br/>30초"]
    end

    Strong -->|"Outbox 이벤트<br/>at-least-once"| Eventual
```

**규칙**:
- 화면에는 `계산 중`, `마지막 반영 시각`, `기준 데이터 버전`을 항상 표시한다.
- **파생 데이터가 확정 원본보다 먼저 노출되어서는 안 된다.** 읽기 모델 갱신 시각이 원본 `updated_at`보다 이르면 원본을 직접 조회한다.
- 이벤트 소싱은 전면 채택하지 않는다. 버전·정정 이벤트·감사 로그를 쓰는 영역은 **루트, 채점, 숙련도, 일정 변경** 4개로 한정한다.

---

## 7. 장애 시 유지 동작

전체 표는 [failure-modes.md](./failure-modes.md). 여기서는 **아키텍처가 보장하는 구조적 이유**만 적는다.

| 장애 | 유지되는 것 | 구조적 이유 |
|---|---|---|
| AI·OCR 공급자 전면 중단 | 게시된 일정, 검수 완료 문제은행, 학생 응시, 자동·수동 채점 | AI는 `ai` 큐에서만 호출된다. `web`의 동기 경로에 AI 의존이 없다(C-11). 게시된 콘텐츠는 스냅샷이라 재호출 불필요 |
| 워커 전면 중단 | 로그인, 조회, 답안 임시 저장·제출, 수업 기록, 수동 채점 | 제출은 `web`의 단일 트랜잭션에서 완결되고 후처리만 `jobs`에 적재된다. 접수된 작업은 DB에 남아 유실 0 |
| Chromium·렌더 워커 중단 | 온라인 응시 전체 | 응시는 웹 KaTeX 사전 파싱 결과(게시 스냅샷)를 사용한다. PDF·HWPX는 별도 큐 |
| 읽기 모델·검색 중단 | 모든 권한 판정, 원본 조회 기반 화면 | 권한 검사는 캐시 성공 여부에 의존하지 않는다. 읽기 모델은 파생 계층이며 원본 조회로 폴백 |
| Supabase Storage 중단 | 기존 응시(스냅샷 자산은 게시 시 검증·CDN 캐시), 조회, 채점 | 게시 게이트가 "원본·산출물 완전 저장 전 게시 금지"를 강제하므로 게시된 것은 이미 완결 상태 |
| PostgreSQL 쓰기 불가 | 없음 — **쓰기를 성공으로 응답하지 않는다** | 단일 진실 공급원. 성공 응답한 제출의 유실 0을 위해 큐를 업무 기록 저장소로 쓰지 않는다 |
| 알림 공급자 중단 | 앱 내 업무함 전체 | 알림은 Outbox 소비자이며 업무함은 원본 테이블 조회 |
| 교육과정 권위 소스 접근 불가 | 마지막 검증 릴리스 읽기 전용 사용 | 릴리스는 원자적 발행 스냅샷. 새 발행만 차단 |

---

## 8. 배포 토폴로지

```mermaid
flowchart TB
    subgraph Prod["운영 환경"]
        LB["HTTPS 진입<br/>TLS 1.3"]
        W1["web ×N<br/>무상태 · 오토스케일"]
        WK1["worker: realtime+schedule<br/>2 vCPU × 2"]
        WK2["worker: render<br/>4 vCPU × 2"]
        WK3["worker: ai+default<br/>2 vCPU × 2"]
        SB[("Supabase 운영 프로젝트<br/>PITR 활성")]
    end
    subgraph Stg["스테이징 (운영의 1/10)"]
        S1["web ×1"]
        S2["worker ×1 (모든 큐)"]
        SB2[("Supabase 스테이징<br/>합성 데이터만")]
    end
    subgraph Dev["개발"]
        D1["로컬 pnpm dev<br/>AI_PROVIDER=mock"]
        SB3[("Supabase 개발 또는 로컬 PG")]
    end

    LB --> W1
    W1 --> SB
    WK1 --> SB
    WK2 --> SB
    WK3 --> SB
    S1 --> SB2
    S2 --> SB2
    D1 --> SB3
```

- 운영·스테이징·개발은 **계정과 데이터가 완전히 분리**된다. 실제 학생 개인정보를 스테이징·개발에 복사하지 않는다.
- 배포는 **블루·그린**. 전환 전 스모크(로그인 → 오늘 운영실 → 답안 1건 제출 → 채점 확정)를 통과해야 트래픽 전환.
- 롤링 중에는 구·신 버전이 공존하므로 DB 변경은 `확장 → 백필 → 전환 → 검증 → 구 구조 제거` 5단계를 지킨다.
- 워커는 `SIGTERM` 수신 시 진행 중 작업의 lease를 유지한 채 **새 claim만 중단**하고 최대 120초 대기 후 종료한다. 미완료 작업은 lease 만료 후 다른 워커가 이어받는다.

---

## 9. 관측성 배선

| 신호 | 내용 | 저장 |
|---|---|---|
| 구조화 로그 | `trace_id`, `correlation_id`, `causation_id`, `organization_id`, `route`, `outcome` | 로그 백엔드. **학생 이름·연락처·답안 원문·문제집 페이지·토큰 금지** |
| 메트릭 | API RED, 인프라 USE, 큐 깊이·최고 대기, 단계별 처리량·재시도·DLQ | **레이블에 학생 ID 등 고카디널리티 개인정보 금지** |
| 트레이스 | web 요청 → 트랜잭션 → Outbox → worker 핸들러까지 `correlation_id`로 연결 | |
| 감사 | `audit_events` — 행위자, 대상, 변경 전후, 사유, 시각, 권한 근거 | **애플리케이션 로그와 분리된 DB 테이블. 일반 수정 API로 변경·삭제 불가** |

합성 모니터링 3종: ① 시험 시작→제출 왕복 ② 일정 재계산 preview→apply ③ 반입 1페이지 OCR→검수 대기. 각 5분 주기.

---

## 10. 이 문서가 코드에 강제하는 것

| 규약 | 강제 수단 |
|---|---|
| `packages/core` 순수성 | ESLint no-restricted-globals + 결정성 속성 테스트 |
| 컨텍스트 간 직접 테이블 수정 금지 | `packages/db` export를 컨텍스트별 네임스페이스로 분리 + import 경계 ESLint 규칙 |
| 명령의 멱등성 게이트 통과 | `Actions` 래퍼 타입 강제 (`defineCommand()` 없이는 쓰기 불가) |
| 수식은 단일 파이프라인 통과 | `renderMath()` 외 KaTeX 직접 호출 금지 ESLint 규칙 |
| 큐 우선순위 | `jobs.queue` CHECK 제약 + 핸들러 등록 시 큐 명시 필수 |
| 제품 경계 | `scripts/boundary-check.mjs` (빌드 게이트) |
