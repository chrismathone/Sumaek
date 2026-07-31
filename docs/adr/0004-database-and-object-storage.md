# ADR-0004 — 데이터베이스와 객체 스토리지

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [assumptions.md](../phase0/assumptions.md) · [erd.md](../phase0/erd.md) · [backup-recovery.md](../phase0/backup-recovery.md) · [ADR-0003](./0003-tenant-isolation.md) |

---

## 맥락

용량 추정([assumptions.md](../phase0/assumptions.md) 3장)에서 나온 수치:

| 항목 | 값 |
|---|---|
| 답안 쓰기 피크 | 875 RPS (설계 수용 1,000, 부하시험 2,000) |
| 1일 답안 | 500만 건, 8.15 GB/일 |
| 온라인(핫) DB | 약 2.1 TB (파티션 아카이브 후) |
| 객체 스토리지 1년차 | 약 7.34 TB |
| 문항 버전 | 1,000만 개 (DB 187 GB) |
| Outbox | 1일 335만 이벤트 |

요구사항:

1. **강한 일관성**이 필요한 트랜잭션 10종(골프롬프트 2D).
2. RLS로 테넌트 격리(ADR-0003) — DB 레벨 정책이 필수.
3. PITR로 RPO 5분.
4. 객체 스토리지에 **체크섬과 함께** 원본 저장, 경로 기반 RLS.
5. 외부 검색 엔진·분석 DB·분산 캐시는 **실측 병목 전 도입 금지**(골프롬프트 2J).
6. 큐도 PostgreSQL 기반(ADR-0010).

사용자 확정 사항: **Supabase 클라우드**(프로젝트 `tovtbmhmemjyixgstmse`).

## 결정

### 1. PostgreSQL을 트랜잭션 데이터의 단일 진실 공급원으로 한다

**Supabase 클라우드 PostgreSQL 17.**

| 항목 | 결정 |
|---|---|
| 리전 | ap-northeast-2(서울) 우선. 미가용 시 ap-northeast-1(도쿄) |
| 커넥션 | **transaction mode pooler** 고정. session mode는 마이그레이션 러너만 |
| 풀 크기 | web 인스턴스당 max 10, worker 프로세스당 max 8. 총 상한 200 |
| 확장 | `pgcrypto`, `pg_trgm`, `btree_gist`(EXCLUDE 제약), `uuid-ossp` 대체로 UUIDv7 자체 함수 |
| PITR | 활성, 보존 35일 |

### 2. 데이터 계층: Drizzle은 타입 소스, 런타임은 postgres.js

| 역할 | 도구 |
|---|---|
| 스키마 정의·타입 생성 | `drizzle-orm ^0.45` (`packages/db/src/schema/*.ts`) |
| 마이그레이션 SQL 생성 | `drizzle-kit generate` → `NNNN_*.sql` |
| **런타임 쿼리** | **`postgres.js`** — 서버 전용 데이터 계층 |
| 마이그레이션 실행 | 자체 러너 `packages/db/src/migrate.ts` |

이유: Drizzle의 쿼리 빌더는 RLS·`SET LOCAL ROLE`·복잡한 CTE·`FOR UPDATE SKIP LOCKED`·EXCLUDE 제약 조합에서 제어가 어렵다. **스키마 정의와 타입은 Drizzle에서 얻고, 쿼리는 파라미터 바인딩된 SQL로 직접 쓴다.**

**`drizzle-kit push` 금지.** 운영 DB에 직접 반영하는 경로를 만들지 않는다.

### 3. 마이그레이션 2갈래 규약

| 유형 | 파일 | 내용 |
|---|---|---|
| 생성 | `NNNN_<name>.sql` | Drizzle 생성 DDL |
| 수기 | `NNNNa_<name>.sql` | RLS 정책, 트리거, EXCLUDE 제약, 함수, 뷰, `state_transitions` INSERT |
| 역방향 | `NNNN_<name>.down.sql` | 필수 (제거 단계 제외) |

**전부 멱등**. 러너가 재실행 가능해야 한다.

### 4. 파티셔닝

무한 증가 테이블은 **월 단위 RANGE 파티션**:

| 테이블 | 파티션 키 | 핫 보존 |
|---|---|---|
| `responses` | `saved_at` | 180일 |
| `attempts` | `started_at` | 180일 |
| `mastery_evidences` | `occurred_at` | 180일 |
| `progress_events` | `occurred_at` | 180일 |
| `audit_events` | `occurred_at` | 1년 |
| `outbox_events` | `created_at` | 7일 |
| `job_runs` | `started_at` | 90일 |

3개월치 파티션을 선행 생성한다. 보존 경계를 넘긴 파티션은 `pg_dump` → Storage 아카이브 후 `DETACH CONCURRENTLY`, 콜드 보존 후 `DROP`.

### 5. 식별자: UUIDv7

```sql
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ts_ms bytea; uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10'   || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;
```

이유: 시간순 정렬 가능 → B-tree 삽입이 오른쪽 끝에 집중(페이지 분할 감소), 커서 페이지네이션의 타이브레이커로 안정적, 파티션 프루닝과 궁합.

### 6. 객체 스토리지: Supabase Storage

| 항목 | 결정 |
|---|---|
| 경로 규약 | `{organization_id}/<kind>/<...>` — 선두 세그먼트가 조직 |
| 버킷 | `sources`(원본 PDF·이미지), `assets`(문항 자산·도형), `exports`(PDF·HWPX), `archive`(파티션 덤프, 조직 없음) |
| 접근 | **전부 private.** 서명 URL만. 발급 시 권한 재검사 |
| 서명 URL 만료 | 문항 자산 15분, 내보내기 24시간 |
| 체크섬 | 모든 객체에 `sha256`을 DB에 저장. 업로드 완료 후 검증 |
| 버전 관리 | ON. 삭제 후 35일 |
| 불변 보존 | `archive` 버킷은 객체 잠금(retention) |

**DB와 Storage의 분담**:

| DB에 두는 것 | Storage에 두는 것 |
|---|---|
| 문항 본문·구조화 블록·수식 메타 (jsonb) | 원본 PDF, 페이지 이미지 |
| 답안 payload (8KB 이하) | 답안 payload (8KB 초과), 손글씨 스캔 |
| 렌더 산출물 메타·해시 | PDF·HWPX 산출물, 도형 SVG |
| 도형 구조화 파라미터 | 도형 SVG 파일 |
| 체크섬·경로 | 실제 바이트 |

### 7. 도입하지 않는 것 (실측 병목 전까지)

| 미도입 | 대체 | 도입 조건 |
|---|---|---|
| 외부 검색 엔진 (Elasticsearch 등) | PostgreSQL `pg_trgm` GIN + 복합 인덱스 | 문제 검색 p95 > 400ms가 인덱스 튜닝 후에도 30일 지속 |
| 별도 분석 저장소 | 읽기 모델 테이블 + materialized view | 분석 쿼리가 운영 워크로드에 5% 이상 영향 |
| 분산 캐시 (Redis) | PostgreSQL 읽기 모델 + Next.js 요청 캐시 | 읽기 모델 갱신이 SLO(30초)를 30일 초과 |
| 외부 메시지 브로커 | `jobs` + `outbox_events` (ADR-0010) | 큐 처리량 4,000/s 초과 또는 락 경합 실측 |
| 읽기 복제본 | 없음 | 읽기 부하가 주 노드 CPU 60% 초과 30일 지속 |

**"실측"의 정의**: 30일 이상의 지표 데이터. 예측·직감은 조건 충족이 아니다.

### 8. 인덱스 전략

[erd.md](../phase0/erd.md) 11장 참조. 원칙:

| # | 원칙 |
|---|---|
| I-1 | 인덱스 선두 컬럼은 `organization_id` (RLS 프루닝 + 격리) |
| I-2 | 부분 인덱스를 우선 (`WHERE status='queued'` 등) — 크기와 유지 비용 절감 |
| I-3 | 파티션 테이블의 인덱스는 로컬 인덱스 |
| I-4 | 대형 테이블 인덱스 생성은 `CONCURRENTLY` |
| I-5 | GIN은 검색 요구가 확인된 컬럼에만 (`structured_content_blocks.payload`, 본문 tsvector) |
| I-6 | 쓰기 집중 테이블(`responses`)은 `fillfactor=85` |

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. 자체 호스팅 PostgreSQL** | 완전한 제어, 확장 자유, 비용 절감 가능 | ① 사용자가 Supabase 클라우드로 확정 ② PITR·백업·페일오버를 직접 운영해야 함 ③ Auth·Storage를 별도 구축해야 함 ④ 팀 규모 대비 운영 부담 과다 |
| **B. PostgreSQL + 별도 S3** | 스토리지 비용 절감, 리전 선택 자유 | ① Storage RLS를 직접 구현해야 함(경로 정책) ② 서명 URL 발급·만료를 직접 관리 ③ Supabase Storage가 이미 PostgreSQL RLS와 통합 ④ 초기 규모에서 비용 차이가 작음 |
| **C. MySQL·MariaDB** | 운영 인력 확보 용이 | ① RLS 없음 — ADR-0003의 격리 모델이 불가능 ② EXCLUDE 제약(시간 충돌) 없음 ③ jsonb 기능·인덱싱 열세 ④ `FOR UPDATE SKIP LOCKED`는 있으나 파티션·CTE 기능이 약함 |
| **D. 문서 DB (MongoDB)** | 구조화 콘텐츠 저장 자연스러움 | ① 강한 일관성 10종을 위한 다문서 트랜잭션이 비싸다 ② 참조 무결성 없음 — 불변 조건 대부분을 애플리케이션으로 ③ RLS 없음 |
| **E. Drizzle 쿼리 빌더 런타임 사용** | 타입 안전, 코드 일관성 | ① `SET LOCAL ROLE`·`FOR UPDATE SKIP LOCKED`·EXCLUDE·복잡 CTE 제어가 어렵다 ② eywa 실운영에서 postgres.js 직접 사용이 더 나았다는 실측 ③ **타입은 Drizzle에서 그대로 얻으므로 손해가 없다** |
| **F. `drizzle-kit push` 사용** | 개발 속도 | 운영 DB에 검토 없이 반영되는 경로. RLS·트리거는 push가 관리하지 않아 드리프트 발생. eywa에서 금지 규약으로 확립 |
| **G. UUIDv4** | 표준, 간단 | 랜덤 삽입으로 B-tree 페이지 분할 심각. 1,000만 행 규모에서 인덱스 팽창 |
| **H. bigserial** | 가장 작고 빠름 | ① 조직 간 ID 추측 가능(열거 공격) ② 분산 생성 불가 ③ 마이그레이션·병합 시 충돌 |

## 비용

| 항목 | 예상 |
|---|---|
| Supabase 컴퓨트 (Large, 8 vCPU / 32 GB) | USD 410/월 |
| DB 저장 (온라인 2.1 TB) | USD 250/월 (USD 0.125/GB) |
| Storage (7.34 TB, 1년차) | USD 155/월 (USD 0.021/GB) |
| Storage 전송 | USD 200/월 (추정) |
| PITR 35일 | 컴퓨트 요금에 포함 (Large 이상) |
| **소계** | **약 USD 1,015/월** (예산 A-36 USD 3,000 이내) |
| 1년차 실사용 (학생 5,000명) | 약 USD 180/월 |
| 개발 비용 | 파티션 운영 스크립트, UUIDv7 함수, 아카이브 파이프라인 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | 답안 쓰기 IO 포화 | `responses` INSERT p99 > 200ms, WAL 생성률 급증 | ① 월 파티션(이미 적용) ② `fillfactor=85` ③ 임시 저장 배치 창 10s→20s ④ 컴퓨트 상향 |
| F-2 | 커넥션 고갈 | `db_connection_saturation` > 85% | pool max 하향, transaction pooler 확인, 워커 풀 분리 |
| F-3 | 파티션 관리 누락으로 기본 파티션 폭증 | 기본 파티션 행 수 > 0 | 3개월 선행 생성 + 일 배치 검증 + 기본 파티션 행 수 알림 |
| F-4 | 아카이브 후 조회 요구 발생 | 180일 초과 데이터 조회 요청 | 아카이브는 삭제가 아니라 DETACH. 필요 시 재ATTACH 가능(1시간) |
| F-5 | Storage 체크섬 불일치 | 체크섬 스냅샷 대조 실패 | 해당 객체 격리 + 재업로드 요청. 게시 게이트가 이미 차단 |
| F-6 | 검색 성능 저하로 외부 엔진 유혹 | 문제 검색 p95 > 400ms | **먼저 인덱스·쿼리 튜닝.** 30일 지속 시에만 이 ADR 갱신 |
| F-7 | Supabase 리전·기능 제약 발견 | 서울 리전 미가용, PITR 제약 | 도쿄 리전 폴백. 데이터 지역 요구 발생 시 Q-15 재검토 |
| F-8 | 마이그레이션이 대형 테이블을 락 | 배포 중 쓰기 중단 | 스테이징에서 잠금 시간 사전 측정(1/10 규모 × 10). 5초 초과 시 `CONCURRENTLY`·배치 전환 |
| F-9 | Drizzle 스키마와 실제 DB 드리프트 | 스키마 스냅샷 테스트 실패 | `drizzle-kit generate` 후 diff가 비어야 CI 통과 |

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| 인덱스 추가·제거 | 마이그레이션 (`CONCURRENTLY`) | 낮음 |
| 파티션 정책 변경 | 새 파티션부터 적용. 기존은 유지 | 낮음 |
| postgres.js → Drizzle 쿼리 빌더 | 모듈 단위 점진 전환 가능 (스키마 공유) | 중간 |
| Supabase Storage → 외부 S3 | 경로 규약이 같으므로 복사 + 서명 URL 어댑터 교체 | 중간 (7 TB 전송) |
| Supabase → 자체 호스팅 PostgreSQL | 논리 덤프 + 복원. Auth·Storage 대체 구축 필요 | 높음 (수 주) |
| PostgreSQL → 다른 DBMS | **되돌리지 않는다.** RLS·EXCLUDE·jsonb·파티션 의존이 깊다 | — |
| 외부 검색 엔진 도입 | 추가는 쉽다(읽기 전용 인덱스). **제거도 쉽다**(폴백 경로 유지) | 낮음 |

가장 되돌리기 어려운 것은 **PostgreSQL 선택**이다. 이는 의도한 결합이다 — RLS(ADR-0003), EXCLUDE 제약(불변 I-06), SKIP LOCKED 큐(ADR-0010), Outbox(ADR-0006)가 전부 PostgreSQL 기능에 의존한다. 이 결합이 아키텍처를 단순하게 유지하는 대가다.
