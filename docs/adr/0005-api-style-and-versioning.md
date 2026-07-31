# ADR-0005 — API 스타일과 버전 전략

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [api-contract.md](../phase0/api-contract.md) · [event-catalog.md](../phase0/event-catalog.md) · [ADR-0006](./0006-transactional-outbox-inbox.md) |

---

## 맥락

수맥의 API 소비자는 셋이다.

| 소비자 | 특성 |
|---|---|
| 교사·학생 웹 앱 (Next.js) | 같은 저장소. RSC + Server Actions 사용 가능. 타입 공유 |
| 외부 SIS·LMS·ERP 어댑터 | 안정된 계약 필요. 버전 호환 중요. 허용 목록 4종으로 제한 |
| 모바일·향후 클라이언트 | 아직 없음. 열어둬야 함 |

골프롬프트 2G 요구:

- 업무 행위를 표현하는 REST/JSON + OpenAPI 계약. **DB CRUD를 그대로 노출하지 않는다**
- 조회는 커서 페이지네이션
- 모든 응답에 `trace_id`와 주요 데이터 버전
- 모든 쓰기에 `Idempotency-Key`
- 편집 명령에 낙관적 잠금
- 대량·장시간 작업은 작업 ID 즉시 반환 + 상태 조회·SSE·취소·재시도
- 안정된 오류 코드, 해결 방법, 재시도 가능 여부

Next.js 16 App Router는 Server Actions를 제공한다. 이것을 쓰면 타입 안전하고 빠르지만, **HTTP 계약이 명시적이지 않아** 멱등성·잠금·오류 코드 규약이 흐트러지기 쉽다.

## 결정

### 1. 이중 표면, 단일 계약

| 표면 | 대상 | 구현 |
|---|---|---|
| **Server Actions** | 교사·학생 웹 앱 | `apps/web/src/features/<X>/server/actions.ts` |
| **`/api/v1/**` REST** | 외부 연동, 모바일, SSE | `apps/web/src/app/api/v1/**/route.ts` |

**핵심 규약: 두 표면이 같은 명령 계약을 따른다.**

```ts
// packages/contracts/src/commands/publish-route.ts — 단일 정의
export const PublishRouteCommand = defineCommand({
  operation: 'route.publish',
  input: z.object({ routeVersionId: Uuid, impactAcknowledged: z.boolean() }).strict(),
  output: z.object({ routeVersionId: Uuid, versionNo: z.number().int(), publishedAt: Iso8601 }),
  idempotent: true,          // Idempotency-Key 필수
  optimisticLock: 'version', // If-Match 필수
  reauth: true,              // X-Reauth-Token 필수
  errors: ['ROUTE_NOT_READY', 'VERSION_CONFLICT', 'FORBIDDEN', 'KILL_SWITCH_ENABLED'],
});
```

Server Action과 Route Handler는 **같은 `defineCommand` 결과를 얇게 감싼다**. 멱등성 게이트·낙관적 잠금·감사·오류 매핑은 래퍼가 처리한다. 개별 액션이 이를 잊을 수 없다.

```ts
// Server Action
export const publishRoute = toServerAction(PublishRouteCommand, publishRouteHandler);
// Route Handler
export const POST = toRouteHandler(PublishRouteCommand, publishRouteHandler);
```

### 2. 계약 소스는 zod, OpenAPI는 생성물

| 항목 | 결정 |
|---|---|
| 단일 정의 | `packages/contracts`의 zod 4 스키마 |
| OpenAPI 3.1 | `pnpm contracts:openapi`로 **생성**. 손으로 쓰지 않음 |
| 검증 | 요청은 `.strict()`, 이벤트 소비는 `.passthrough()` |
| 타입 공유 | 웹 앱은 zod 타입 직접 사용. 외부는 OpenAPI에서 생성 |
| CI 게이트 | 생성된 OpenAPI가 커밋본과 다르면 실패 |

OpenAPI를 손으로 쓰면 반드시 드리프트한다. 생성물로 두면 zod가 진실이 된다.

### 3. 리소스가 아니라 업무 행위

```
❌ PUT /api/v1/route-versions/{id}          { status: "published" }
✅ POST /api/v1/routes/versions/{id}:publish
```

**동사는 경로 끝에 `:verb`로 표기**한다(Google AIP-136 스타일). 이유:

| 이유 | 설명 |
|---|---|
| 의도가 명시적 | `status: "published"`는 게시인지 상태 정정인지 구분되지 않는다 |
| 상태 머신과 1:1 | 각 명령이 [state-machines.md](../phase0/state-machines.md)의 전이 하나에 대응 |
| 감사 로그 액션명과 일치 | `audit_events.action = 'route.publish'` |
| 멱등성 키 범위 | `operation` = 명령 이름. 다른 명령의 같은 키가 충돌하지 않음 |
| 권한 코드와 일치 | 권한 매트릭스가 명령 단위로 정의됨 |

조회는 표준 REST: `GET /api/v1/routes/versions/{id}`, `GET /api/v1/students?cursor=...`

### 4. 버전 전략

| 항목 | 결정 |
|---|---|
| 위치 | **URL 경로** `/api/v1/...` |
| 증가 조건 | **파괴적 변경만** major 증가 |
| 하위 호환 추가 | 버전 유지 (선택 필드 추가, 새 엔드포인트, 새 오류 코드) |
| 파괴적 변경 | 필수 필드 추가, 필드 삭제·이름 변경, 타입 변경, 의미 변경, 오류 코드 삭제 |
| 병행 운영 | 새 major 출시 후 **구 버전 최소 12개월** 유지 |
| 폐기 절차 | ① `Deprecation` + `Sunset` 헤더(RFC 8594) ② 6개월 전 통지 ③ 사용량 0 확인 ④ 제거 |
| Server Actions | **버전 없음.** 웹 앱과 서버가 같이 배포되므로 항상 동일 버전 |

URL 경로를 선택한 이유: 헤더 기반(`Accept: application/vnd.sumaek.v2+json`)은 캐시·로그·디버깅이 어렵고, 외부 연동 담당자가 실수하기 쉽다.

### 5. 커서 페이지네이션 (인코딩 확정)

```
cursor = base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(secret, payload))

payload = {
  "v": 1,                                    // 커서 스키마 버전
  "k": ["2026-08-03T05:00:00Z", "01J8..."],  // 정렬 키 값 (마지막은 항상 id)
  "d": "asc",
  "f": "3f9a1c2e",                            // 필터 해시
  "o": "01J0..."                              // organization_id
}
```

| 규칙 | 이유 |
|---|---|
| 정렬은 항상 `(정렬 컬럼..., id)` 복합 | UUIDv7이 안정적 타이브레이커 |
| `o` ≠ 세션 조직 → `400 INVALID_CURSOR` | 커서 재사용을 통한 교차 테넌트 차단 |
| `f` ≠ 현재 필터 해시 → `400 CURSOR_FILTER_MISMATCH` | 필터가 바뀐 커서로 잘못된 결과를 주지 않음 |
| HMAC 불일치 → `400 INVALID_CURSOR` | 조작 방지 |
| 만료 없음, `v`로 일괄 무효화 | 장시간 스크롤 세션 지원 |
| 쿼리는 튜플 비교 | `WHERE (saved_at, id) > ($1, $2) ORDER BY saved_at, id LIMIT $3` |

offset/limit은 제공하지 않는다. 깊은 offset은 대형 테이블에서 O(n)이고, 삽입 중 중복·누락이 생긴다.

### 6. 오류 코드

`SCREAMING_SNAKE_CASE` 안정 상수. **한 번 배포한 코드는 의미를 바꾸지 않는다.**

| 필수 필드 | 규칙 |
|---|---|
| `code` | 안정 상수 |
| `message` | 한국어, 무엇이 실패했는지 구체적으로. "오류가 발생했습니다" 금지 |
| `resolution` | 사용자가 다음에 할 행동 |
| `retryable` | boolean. true면 `Retry-After` 동반 |
| `details` | 구조화 정보. **개인정보·비밀·스택 금지** |

전체 목록은 [api-contract.md](../phase0/api-contract.md) 8장. 스냅샷 테스트로 고정하며, 삭제·의미 변경 시 CI 실패.

### 7. 장시간 작업

```
POST /api/v1/content/sources/{id}:ingest  → 202 { job_id, status, estimated_seconds }
GET  /api/v1/jobs/{jobId}                 → 상태·단계·진행률·비용·재시도
GET  /api/v1/jobs/{jobId}/events          → SSE (progress·step·done·error, 15초 heartbeat)
POST /api/v1/jobs/{jobId}:cancel
POST /api/v1/jobs/{jobId}:retry
POST /api/v1/jobs/{jobId}/retry-failed    → 부분 실패 항목만
```

**SSE를 선택하고 WebSocket을 쓰지 않는다**(Q-09). 단방향이면 충분하고, 프록시·인증·재연결이 단순하다.

### 8. 외부 연동 어댑터

허용 범위 4종으로 고정. `.strict()` 파싱.

| 처리 | 조건 |
|---|---|
| 필드 폐기 + 계속 | 알 수 없는 필드만 |
| `400 FIELD_NOT_ALLOWED` + 전체 거부 + SEV3 | 금지 계열 필드(`payment*`, `guardian_contact*` 등) |

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. GraphQL** | 클라이언트가 필요한 필드만. 오버페치 없음 | ① 업무 행위 중심 명령과 맞지 않음(뮤테이션이 결국 명령이 됨) ② 필드 단위 권한이 복잡 ③ N+1과 쿼리 복잡도 제한 필요 ④ 외부 연동 파트너에게 진입 장벽 ⑤ 캐시·SSE와 궁합 나쁨 |
| **B. tRPC** | 완전한 타입 안전, 코드 생성 없음 | ① 외부 연동에 표준 계약이 필요 ② OpenAPI 산출이 어색 ③ **Server Actions가 같은 이점을 이미 제공** |
| **C. Server Actions만 사용** | 가장 단순, 타입 안전 | ① 외부 SIS 연동 불가 ② 모바일 클라이언트 경로 없음 ③ SSE 불가 ④ HTTP 계약이 명시적이지 않아 규약이 흐트러짐 |
| **D. REST만 사용 (Server Actions 미사용)** | 표면 1개, 규약 일관 | ① Next.js 16의 이점 포기 ② 웹 앱에서 불필요한 직렬화·네트워크 왕복 ③ 폼 처리·낙관적 UI가 번거로움 |
| **E. 헤더 기반 버전** | URL이 깨끗 | 캐시·로그·디버깅 어려움, 외부 파트너 실수 유발 |
| **F. 버전 없음 (항상 하위 호환)** | 단순 | 파괴적 변경이 언젠가 필요하다. 그때 경로가 없다 |
| **G. offset/limit 페이지네이션** | 구현·이해 쉬움, 총 개수 표시 가능 | 대형 테이블에서 깊은 offset이 O(n). 삽입 중 중복·누락 |
| **H. 불투명 문자열 커서 (DB 커서 ID)** | 조작 불가 | 서버에 상태 저장 필요. 무상태 확장과 충돌 |
| **I. OpenAPI를 손으로 작성** | 세밀한 제어 | 반드시 드리프트한다. 생성물로 두면 zod가 진실 |

## 비용

| 항목 | 비용 |
|---|---|
| 이중 표면 | Server Action + Route Handler 래퍼 2종. 단 `defineCommand`가 공통이라 명령당 추가 2줄 |
| 계약 유지 | zod 스키마 작성, OpenAPI 생성 CI |
| 커서 구현 | HMAC 서명·검증, 필터 해시 계산 (약 60줄) |
| 버전 병행 | 파괴적 변경 시 12개월 두 버전 유지 |
| 오류 코드 관리 | 스냅샷 테스트, 코드 추가 시 리뷰 |
| **얻는 것** | 웹 앱 속도 + 외부 연동 안정성 + 규약을 잊을 수 없는 구조 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | Server Action이 `defineCommand`를 우회해 직접 DB 쓰기 | 트랜잭션 러너의 컨텍스트 태그 누락, 감사 로그 공백 | 타입 시스템: 쓰기 트랜잭션 러너가 `CommandContext`를 요구. 이 컨텍스트는 `defineCommand`만 생성 |
| F-2 | REST와 Server Action의 동작이 갈라짐 | 계약 테스트 불일치 | 두 표면에 **같은 테스트 스위트**를 실행 |
| F-3 | OpenAPI 드리프트 | CI diff 실패 | 생성물 커밋 + CI 게이트 |
| F-4 | 오류 코드가 무분별하게 늘어남 | 코드 수 > 80 | 분기 리뷰에서 통합·정리. `details`로 세분화 가능한 것은 새 코드를 만들지 않음 |
| F-5 | 오류 메시지가 "오류가 발생했습니다"로 회귀 | 문구 린트 | 금지 문구 목록 테스트 |
| F-6 | 커서 필터 해시 계산이 불안정(키 순서 등) | 정상 페이징 중 `CURSOR_FILTER_MISMATCH` | 정규화된 JSON(키 정렬) 후 해시. 속성 테스트 |
| F-7 | 멱등성 키를 클라이언트가 재사용 | `IDEMPOTENCY_KEY_CONFLICT` 급증 | 클라이언트 SDK가 요청마다 새 UUID 생성. 재시도 시에만 동일 키 |
| F-8 | v2 출시 후 v1 사용량이 안 줄어듦 | `Sunset` 후에도 v1 호출 지속 | 사용량 대시보드 + 파트너 개별 통지. 강제 종료는 통지 6개월 후 |
| F-9 | SSE 연결 누수 | 동시 연결 수 증가 | 사용자당 5개 제한, 15초 heartbeat, 유휴 5분 종료 |

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| 오류 코드 추가 | 새 코드 추가는 하위 호환 | 없음 |
| 오류 코드 제거 | 파괴적 — major 증가 필요 | 높음 |
| Server Actions 포기 → REST만 | 래퍼가 이미 분리되어 있어 Server Action 파일만 제거 | 낮음 (웹 앱 호출부 수정) |
| REST 포기 → Server Actions만 | 외부 연동을 잃는다. 실질적으로 불가 | — |
| REST → GraphQL | 명령 표면 전체 재작성 | 매우 높음 |
| 커서 → offset | 클라이언트·서버 수정. 성능 후퇴 | 중간 |
| 커서 스키마 변경 | `v` 증가로 기존 커서 무효화. 클라이언트는 첫 페이지부터 | 낮음 |
| v1 → v2 | 12개월 병행 후 폐기 | 중간 |

`defineCommand` 추상화가 이 ADR의 되돌리기 비용을 낮춘다. 표면(Server Action / REST)을 바꿔도 명령 로직은 그대로다.
