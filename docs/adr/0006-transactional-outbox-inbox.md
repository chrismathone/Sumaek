# ADR-0006 — Transactional Outbox와 Inbox

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [event-catalog.md](../phase0/event-catalog.md) · [architecture.md](../phase0/architecture.md) · [ADR-0004](./0004-database-and-object-storage.md) · [ADR-0010](./0010-job-queue-and-ai-abstraction.md) |

---

## 맥락

수맥의 핵심 자동 순환은 이벤트 사슬이다.

```
루트 게시 → 수업 생성 → 테스트 생성 → 응시 → 채점 → 숙련도 → 일정 재계산 → 수업 변경
```

이 사슬에는 **절대 잃으면 안 되는 지점**이 있다.

| 지점 | 요구 |
|---|---|
| 답안 제출 접수 | 200을 응답했으면 채점이 반드시 실행되어야 한다 (SLO O-08: 접수 완료 비동기 작업 유실 0건) |
| 최종 채점 | 숙련도 증거에 **정확히 한 번** 반영 (불변 I-10) |
| 문항 격리 | 미완료 배정에서 반드시 제외 |

순진한 구현의 문제:

```ts
await db.commit();              // 상태 변경 커밋
await queue.publish(event);      // ← 여기서 프로세스가 죽으면 이벤트 유실
```

반대 순서면 이벤트는 갔는데 상태가 롤백되는 유령 이벤트가 생긴다. **DB 커밋과 메시지 발행을 원자적으로 묶는 방법이 없다** — 서로 다른 시스템이기 때문이다.

## 결정

**Transactional Outbox + Consumer Inbox. 전달 의미는 at-least-once.**

### 1. Outbox — 발행 원자성

상태 변경과 **같은 PostgreSQL 트랜잭션**에서 `outbox_events`에 INSERT한다.

```sql
BEGIN;
  UPDATE attempts SET status='submitted', submitted_at=now(), version=version+1
   WHERE id=$1 AND status='in_progress' AND version=$2;
  INSERT INTO outbox_events (id, organization_id, aggregate_type, aggregate_id,
                             aggregate_version, event_type, schema_version,
                             occurred_at, correlation_id, causation_id, payload, status)
  VALUES (uuidv7(), $org, 'Attempt', $1, $newVersion, 'AttemptSubmitted', 1,
          now(), $trace, $cause, $payload, 'pending');
  INSERT INTO jobs (...);            -- 채점 작업도 같은 커밋
COMMIT;
```

**커밋되면 이벤트도 반드시 존재한다. 롤백되면 이벤트도 없다.** 이것이 유일한 원자성 보장 방법이다.

### 2. 릴레이 — 발행

`apps/worker`의 릴레이 루프가 배달한다.

| 항목 | 값 |
|---|---|
| 배치 | 200건 |
| 사이클 | 50 ms |
| 클레임 | `FOR UPDATE SKIP LOCKED` |
| 인덱스 | `(status, next_attempt_at, id) WHERE status IN ('pending','failed')` 부분 인덱스 |
| 처리 능력 | 4,000 이벤트/초 (피크 388/초의 10배 여유) |
| 재시도 | `attempt_count++`, `next_attempt_at = now() + 2^n × 5s` (전체 지터) |
| 최종 실패 | `attempt_count >= 8` → `status='failed'` + SEV3 알림 |
| 보존 | `sent` 후 7일 (월 파티션 DROP) |

```sql
WITH claimed AS (
  SELECT id FROM outbox_events
  WHERE status IN ('pending','failed') AND next_attempt_at <= now()
  ORDER BY next_attempt_at, id
  LIMIT 200 FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events o SET status='sent', updated_at=now()
FROM claimed c WHERE o.id = c.id
RETURNING o.*;
```

**클레임과 배달의 순서**: 먼저 배달하고 `sent`로 표시하면 배달 후 크래시 시 재배달된다(at-least-once — 허용). 먼저 `sent`로 표시하고 배달하면 표시 후 크래시 시 **유실**된다(허용 안 됨). 따라서 **트랜잭션 안에서 `sent`로 표시하고 배달은 같은 트랜잭션의 커밋 후**에 한다 — 커밋 후 크래시는 재배달로 이어지지 않는다. 이를 막기 위해 `sent` 표시는 **배달 성공 후 별도 UPDATE**로 한다:

```sql
-- 1) 클레임만 (lease)
UPDATE outbox_events SET relay_lease_until = now() + interval '30 seconds', relay_holder = $worker
WHERE id IN (...) AND (relay_lease_until IS NULL OR relay_lease_until < now())
RETURNING *;
-- 2) 핸들러 실행 (Inbox INSERT + 처리, 소비자 트랜잭션)
-- 3) 성공 후
UPDATE outbox_events SET status='sent' WHERE id = ANY($ids);
```

lease가 만료되면 다른 워커가 재배달한다 → **at-least-once**. 중복은 Inbox가 막는다.

### 3. Inbox — 소비 멱등성

소비자는 **처리와 Inbox INSERT를 같은 트랜잭션**에서 한다.

```sql
BEGIN;
  INSERT INTO inbox_messages (id, consumer_name, event_id, organization_id, processed_at, outcome)
  VALUES (uuidv7(), 'mastery-engine', $eventId, $org, now(), 'applied');
  -- UNIQUE (consumer_name, event_id) 위반 → 23505 → 전체 롤백 → 이미 처리됨, skip
  INSERT INTO mastery_evidences (...);
  UPDATE concept_masteries SET ...;
  INSERT INTO outbox_events (... MasteryUpdated ...);
COMMIT;
```

**Inbox INSERT를 먼저** 한다. 처리 후에 넣으면 처리 성공 + Inbox 실패 시 재처리된다.

### 4. 순서 보장 범위

| 보장 | 범위 |
|---|---|
| 보장함 | 같은 `(aggregate_type, aggregate_id)` 안에서 `aggregate_version` 오름차순 |
| 보장 안 함 | 전역 순서, 다른 aggregate 간 순서, 같은 aggregate라도 병렬 소비자 간 |

**역행 방지**는 소비자가 한다.

```ts
// 소비자 테이블에 last_applied_version 보유
if (event.aggregate_version <= state.lastAppliedVersion) {
  await recordInbox(event, 'skipped_stale');
  return;   // 지연·역순 이벤트가 최신 상태를 되돌리지 않는다
}
```

### 5. 페이로드 원칙

| 규칙 | 이유 |
|---|---|
| 소비자가 **재조회 없이 라우팅·중복 판정·기본 처리**를 할 수 있는 최소 필드 | 재조회는 지연·부하 |
| 대용량 본문은 **참조 ID만** (문항 내용 대신 `question_version_id`) | Outbox 크기·로그 오염 |
| **답안 원문·학생 이름·수식 원문을 담지 않는다** | 로그·큐를 통한 개인정보·저작권 유출 방지 |
| `renderer_versions` 같은 **역추적용 버전 정보는 담는다** | 이벤트 이력만으로 롤백 영향 추적 |

### 6. 스키마 버전

| 변경 | `schema_version` | 절차 |
|---|---|---|
| 선택 필드 추가 | 유지 | 배포만 |
| 필수 필드 추가·삭제·타입 변경 | +1 | **이중 발행 최소 30일** |
| 의미 변경 | **새 `event_type`** | 이름을 바꾼다 |

소비자 방어:
- 모르는 `event_type` → **무시**하고 `skipped_unknown` 기록 (실패로 만들면 릴레이가 막힌다)
- 더 높은 `schema_version` → **실패로 처리해 재시도** (소비자 배포 후 자동 처리)
- 소비자 zod는 `.passthrough()`, 발행자는 `.strict()`

### 7. 논리적 중복의 최종 차단

Inbox는 **같은 이벤트의 중복 배달**만 막는다. **의미상 중복**은 DB 고유 제약이 막는다.

| 중복 | 제약 |
|---|---|
| 채점 → 증거 2회 반영 | `mastery_evidences UNIQUE (grade_decision_id, canonical_concept_id)` |
| 같은 날짜 테스트 중복 생성 | `assessment_instances UNIQUE (organization_id, learning_group_id, student_id, kind, scheduled_on)` |
| 같은 작업 중복 등록 | `jobs UNIQUE (organization_id, job_type, idempotency_key)` |

**세 겹**이다: 멱등성 키(클라이언트) → Inbox(이벤트) → 고유 제약(의미).

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. 커밋 후 직접 발행** | 가장 단순, 인프라 없음 | 커밋과 발행 사이 크래시 시 **이벤트 유실**. SLO O-08(유실 0건) 위반. 채택 불가 |
| **B. 2단계 커밋(XA)** | 진짜 원자성 | ① PostgreSQL + 외부 브로커 XA는 운영 난이도가 매우 높다 ② 코디네이터 장애 시 in-doubt 트랜잭션 ③ 성능 저하 ④ Supabase에서 지원 제약 |
| **C. PostgreSQL LISTEN/NOTIFY** | 지연 낮음, 폴링 없음 | ① 페이로드 8,000 bytes 제한 ② **전달 보장 없음** — 리스너가 없으면 사라진다 ③ 재시도·DLQ 없음 ④ 커넥션 끊기면 유실 |
| **D. 논리 복제(CDC, Debezium 등)** | 애플리케이션 코드 변경 없음, 진짜 변경 캡처 | ① WAL 슬롯 운영 부담 ② 도메인 이벤트가 아니라 테이블 변경이 나옴 — 소비자가 의미를 재구성해야 함 ③ Supabase에서 슬롯 제어 제약 ④ 스키마 변경이 곧 이벤트 스키마 변경 |
| **E. 외부 브로커(Kafka·RabbitMQ·SQS)** | 검증된 처리량, 파티션 순서, 소비자 그룹 | ① 여전히 Outbox가 필요하다(원자성은 브로커가 못 준다) ② 운영 컴포넌트 +1 ③ 골프롬프트 "실측 병목 전 도입 금지" ④ 현재 피크 388/s는 PostgreSQL로 충분 ⑤ 조직별 공정성을 브로커에서 구현하기 어렵다 |
| **F. Inbox 없이 소비자 멱등 로직만** | 테이블 1개 절약 | 소비자마다 멱등 로직을 다시 구현해야 함. 누락 시 조용히 중복 반영. `(consumer_name, event_id)` UNIQUE 한 줄이 훨씬 싸다 |
| **G. 전역 순서 보장** | 소비자 로직 단순 | 단일 파티션·단일 소비자가 필요 → 처리량 병목. 골프롬프트가 명시적으로 "전역 이벤트 순서를 가정하지 않는다" |
| **H. exactly-once 전달 추구** | 이상적 | 분산 시스템에서 불가능하다. **at-least-once + 멱등 소비**가 실질적 exactly-once다 |

## 비용

| 항목 | 비용 |
|---|---|
| 저장 | Outbox 9.7 GB/일, 7일 보존 68 GB. Inbox는 이벤트당 1행 × 소비자 수 |
| 쓰기 부하 | 상태 변경 트랜잭션마다 INSERT 1회 추가 (약 +8% 트랜잭션 시간) |
| 릴레이 부하 | 배치 200 × 20 사이클/초 = 워커 1개로 4,000/s. CPU 약 0.3 코어 |
| 지연 | 커밋 → 배달까지 평균 25 ms (50 ms 사이클의 절반) |
| 개발 | 릴레이 루프, Inbox 래퍼, 역행 방지 로직 (약 400줄) |
| 운영 | `outbox_pending_age`·`inbox_skipped_stale_rate` 모니터링 |
| **얻는 것** | 이벤트 유실 0. 외부 브로커 없음. 이벤트가 DB 안에 있어 트랜잭션·백업·RLS가 그대로 적용 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | 릴레이 중단으로 이벤트 적체 | `outbox_pending_age` > 300s (SEV2) | 릴레이 재시작. 이벤트는 DB에 남아 있어 유실 없음. 재개 후 배치 처리 |
| F-2 | 특정 이벤트가 소비자를 반복 실패시켜 적체 | `outbox_failed_count` > 0 | 8회 후 `failed`로 격리되어 다른 이벤트는 진행. 원인 수정 후 `pending`으로 되돌려 재시도 |
| F-3 | Inbox 테이블 무한 증가 | 행 수 급증 | 이벤트와 같은 7일 파티션 보존. 소비자별 파티션 프루닝 |
| F-4 | 소비자가 Inbox INSERT를 처리 후에 함 | 중복 처리 발생 | 코드 리뷰 + `withInbox()` 래퍼 강제. 래퍼 없이 이벤트 핸들러 등록 불가 |
| F-5 | 역행 방지 누락으로 오래된 이벤트가 최신 상태를 덮음 | `inbox_skipped_stale_rate` = 0인데 상태 이상 | 소비자마다 `last_applied_version` 검증 테스트 필수 |
| F-6 | 페이로드에 개인정보·답안 유입 | 로그 스캔 테스트 실패 | 페이로드 스키마에 금지 필드 검증. 계약 테스트 |
| F-7 | 이중 발행 기간에 소비자 전환을 잊음 | `inbox_messages`의 `schema_version` 분포에 구 버전 잔존 | 30일 후 자동 알림. 전환 완료 확인 후 v1 중단 |
| F-8 | 릴레이가 단일 인스턴스라 SPOF | 릴레이 워커 중단 | 릴레이도 lease 기반이라 여러 인스턴스 가능. 현재는 1개, 필요 시 증설 |
| F-9 | `sent` 표시 실패로 무한 재배달 | 같은 `event_id`의 `skipped_duplicate`가 계속 증가 | Inbox가 막으므로 부작용은 없다. 알림으로 릴레이 버그 감지 |
| F-10 | 처리량이 4,000/s를 넘음 | 릴레이 지연 증가 | ① 배치 크기 상향 ② 릴레이 인스턴스 증설 ③ 소비자별 릴레이 분리 ④ 그래도 부족하면 외부 브로커 검토(이 ADR 갱신) |

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| 배치·사이클 조정 | 환경변수 | 없음 |
| 소비자 추가·제거 | `consumer_name` 등록. Inbox가 자동 분리 | 낮음 |
| 이벤트 재생(replay) | `outbox_events`를 `pending`으로 되돌림. 소비자가 멱등하므로 안전 | 낮음 |
| 특정 소비자만 재생 | 해당 `inbox_messages` 삭제 후 이벤트 재생 | 낮음 |
| Outbox → 외부 브로커 | **Outbox는 유지**하고 릴레이의 배달 대상만 브로커로 변경. 소비자는 브로커에서 읽음 | 중간 — Outbox 패턴이 이 전환을 쉽게 만든다 |
| Outbox 제거 → 직접 발행 | **되돌리지 않는다.** 유실 위험 복귀 | — |
| Inbox 제거 | **되돌리지 않는다.** 중복 반영 위험 | — |

**Outbox 패턴 자체가 브로커 도입의 어댑터 역할을 한다.** 나중에 Kafka가 필요해져도 발행 측 코드는 바뀌지 않는다 — 릴레이의 배달 구현만 교체하면 된다. 이것이 지금 브로커를 도입하지 않아도 되는 이유다.
