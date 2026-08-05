# RB-13 알림 제공자 장애

| 항목 | 값 |
|---|---|
| 심각도 | **SEV3** (기본) / SEV2 (기한 있는 승인 알림이 4시간 이상 미발송) |
| 1차 담당 | 운영 엔지니어(OE) |
| 에스컬레이션 | 1시간 미확인 → 담당자 / 4시간 지속 → SEV2 승격 + 영향 조직 공지 |
| 관련 SLO | 최종 일관성 반영 시간 — 알림 30초 이내 |
| 관련 kill switch | **`external_notifications`** |
| 관련 문서 | [../phase0/failure-modes.md](../phase0/failure-modes.md) F-08 · [../phase0/event-catalog.md](../phase0/event-catalog.md) |

---

## 0. 이 사고의 성격

**앱 내부 업무함은 알림 공급자와 무관하게 동작한다.** `notifications` 테이블은 Outbox 소비자가 직접 INSERT하며, 외부 발송(이메일)은 그 뒤에 오는 별도 작업이다.

따라서 이 장애는 **"알림이 안 왔다"**이지 **"업무가 멈췄다"**가 아니다. 심각도가 낮은 이유다.

단, 기한이 있는 승인 요청(일정 변경안·채점 예외)이 외부 알림으로만 전달되는 사용자에게는 실질 영향이 있다.

---

## 1. 탐지 조건

| 알림 | 조건 | 임계값 | 관측 창 | 심각도 |
|---|---|---|---|---|
| `notification_provider_down` | 발송 실패율 | > 30% | 15분 | SEV3 |
| `notification_provider_down_high` | 동일 | > 80% | 15분 | SEV2 |
| `notification_queue_backlog` | `jobs{queue='default', job_type='notification.send'}` 대기 | > 1,000건 | 30분 | SEV3 |
| `notification_delay` | 생성 → 발송 완료 p95 | > 300 s | 30분 | SEV3 |
| `overdue_approval_unnotified` | `due_at`이 4시간 이내인데 미발송 알림 | > 20건 | 30분 | **SEV2** |
| `notification_dlq` | 알림 작업 DLQ 진입 | > 50건 | 1시간 | SEV3 |
| `bounce_rate_spike` | 반송률 | > 10% | 1시간 | SEV3 |
| 공급자 상태 페이지 | 외부 공지 | 장애 선언 | — | SEV3 |

---

## 2. 심각도 판정

| 조건 | 심각도 |
|---|---|
| 기한 4시간 이내 승인 요청이 미발송 > 20건 | **SEV2** |
| 발송 실패율 > 80% 지속 4시간 | **SEV2** |
| 발송 실패율 30~80%, 재시도로 일부 처리 | SEV3 |
| 지연만 (5분 이내 발송) | SEV4 |
| 반송률 급증 (도메인 평판 문제) | SEV3 |
| **앱 내 업무함이 안 보임** | 해당 없음 — 이건 [RB-04](./04-queue-backlog-dlq.md) 또는 [RB-05](./05-db-failure-pitr.md) |

---

## 3. 즉시 중지할 기능

```bash
pnpm --filter @su-maek/db kill-switch enable external_notification \
  --reason "RB-13 SEV3 알림 공급자 장애" --actor <이메일>
```

**중지되는 것**: 외부 알림 발송(이메일). 발송 작업은 `queued` 상태로 대기한다.

**중지해도 반드시 되는 것**:

- **앱 내 업무함 전체** — 알림 생성·조회·처리·담당자 지정·기한 설정·일괄 완료
- 오늘 운영실의 예외 업무함
- 일정 변경안 승인·거절
- 채점 예외 처리
- 콘텐츠 검수 배정
- 모든 도메인 기능

**kill switch를 켜는 이유**: 실패하는 발송을 계속 시도하면 큐가 적체되고 공급자 평판이 악화된다. 대기시켜 두었다가 복구 후 일괄 발송한다.

**알림 행은 삭제하지 않는다.** `notifications` 테이블의 항목은 이미 생성되어 업무함에 보인다.

---

## 4. 진단

### 4-1. 발송 작업 상태

```sql
SELECT status, count(*),
       max(now() - created_at)          AS oldest,
       avg(attempt_count)::numeric(4,2) AS avg_attempts,
       count(DISTINCT organization_id)  AS orgs
FROM jobs
WHERE queue = 'default' AND job_type = 'notification.send'
  AND created_at > now() - interval '24 hours'
GROUP BY 1;
```

### 4-2. 실패 원인 분포

```sql
SELECT jr.error_code, jr.outcome, count(*),
       min(jr.started_at) AS first_at, max(jr.started_at) AS last_at
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE j.job_type = 'notification.send'
  AND jr.started_at > now() - interval '6 hours'
GROUP BY 1,2
ORDER BY 3 DESC
LIMIT 20;
```

| `error_code` | 의미 | 조치 |
|---|---|---|
| `PROVIDER_5XX` | 공급자 장애 | 대기·재시도 |
| `PROVIDER_TIMEOUT` | 공급자 지연 | 대기·재시도 |
| `RATE_LIMITED` | 발송 한도 초과 | 발송 속도 조절 |
| `INVALID_RECIPIENT` | 잘못된 주소 | 재시도 불가. 사용자 확인 요청 |
| `BOUNCED` | 반송 | 재시도 불가 |
| `AUTH_FAILED` | 자격 증명 문제 | [RB-07](./07-account-takeover-malicious-upload.md) 병행 검토 |

### 4-3. 기한 임박 미발송 알림 (SEV2 판정)

```sql
SELECT n.organization_id, n.kind, n.due_at,
       count(*)                        AS pending_notifications,
       count(DISTINCT n.recipient_user_id) AS recipients,
       min(n.due_at)                   AS earliest_due
FROM notifications n
WHERE n.status = 'unread'
  AND n.due_at IS NOT NULL
  AND n.due_at < now() + interval '4 hours'
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.job_type = 'notification.send'
      AND j.status IN ('queued','failed','dead_lettered')
      AND (j.input ->> 'notification_id')::uuid = n.id)
GROUP BY 1,2,3
ORDER BY earliest_due
LIMIT 50;
```

### 4-4. 알림 유형별 적체

```sql
SELECT n.kind,
       count(*) FILTER (WHERE n.status = 'unread')  AS unread,
       count(*) FILTER (WHERE n.status = 'done')    AS done,
       count(*) FILTER (WHERE n.due_at < now() AND n.status = 'unread') AS overdue,
       max(now() - n.created_at)                    AS oldest
FROM notifications n
WHERE n.created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY unread DESC;
```

### 4-5. 발송 지연 (SLO 대조)

```sql
SELECT percentile_cont(0.50) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (jr.ended_at - j.created_at)))::int AS p50_seconds,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(epoch FROM (jr.ended_at - j.created_at)))::int AS p95_seconds,
       count(*) AS sent
FROM jobs j
JOIN job_runs jr ON jr.job_id = j.id AND jr.outcome = 'succeeded'
WHERE j.job_type = 'notification.send'
  AND jr.ended_at > now() - interval '6 hours';
```

목표: p95 30초.

### 4-6. 업무함 정상 동작 확인 (가장 중요)

```sql
-- 알림은 생성되고 있는가 (외부 발송과 무관)
SELECT date_trunc('hour', created_at) AS hour_utc, count(*), count(DISTINCT organization_id) AS orgs
FROM notifications
WHERE created_at > now() - interval '12 hours'
GROUP BY 1 ORDER BY 1 DESC;
```

**이 쿼리가 정상 추이를 보이면 업무함은 살아 있다.** 사용자에게 안내할 근거다.

### 4-7. 반송·수신 거부

```sql
SELECT j.input ->> 'channel' AS channel,
       jr.error_code,
       count(*) AS occurrences,
       count(DISTINCT j.input ->> 'recipient_ref') AS distinct_recipients
FROM job_runs jr
JOIN jobs j ON j.id = jr.job_id
WHERE j.job_type = 'notification.send'
  AND jr.error_code IN ('BOUNCED','INVALID_RECIPIENT','UNSUBSCRIBED')
  AND jr.started_at > now() - interval '7 days'
GROUP BY 1,2
ORDER BY 3 DESC;
```

---

## 5. 복구 절차

| # | 조치 | 명령·SQL | 예상 소요 |
|---|---|---|---|
| 1 | 4-6으로 **업무함이 정상인지 먼저 확인** | 4-6 | 3분 |
| 2 | 4-2로 원인 분류 | 4-2 | 5분 |
| 3 | 원인별 조치 (5.1) | — | 10~60분 |
| 4 | 기한 임박 알림 대체 전달 (5.2) | — | 15분 |
| 5 | 공급자 복구 확인 | 상태 페이지 + 테스트 발송 | 5분 |
| 6 | kill switch 해제 + 속도 조절 재개 (5.3) | — | 5분 |
| 7 | 적체 발송 모니터링 | 4-1 | 30~120분 |
| 8 | 검증 (6장) | — | 10분 |

### 5.1 원인별 조치

| 원인 (4-2) | 조치 |
|---|---|
| `PROVIDER_5XX`·`PROVIDER_TIMEOUT` | kill switch ON → 대기. 공급자 상태 페이지 확인. 회로 차단기 자동 복구 대기 |
| `RATE_LIMITED` | 발송 속도 하향 (5.4). kill switch 불필요 |
| `AUTH_FAILED` | 자격 증명 확인·회전. 유출 의심이면 [RB-07](./07-account-takeover-malicious-upload.md) |
| `INVALID_RECIPIENT`·`BOUNCED` 급증 | 주소 품질 문제. 해당 사용자에게 앱 내 안내. 재시도 불가 처리 |
| 큐 적체만 (실패 없음) | [RB-04](./04-queue-backlog-dlq.md) — 워커 문제 |

### 5.2 기한 임박 알림 대체 전달

4시간 이내 기한이 있는 승인 요청은 **다른 경로로 알린다.**

| 방법 | 대상 |
|---|---|
| 조직 담당자에게 직접 연락 (전화·기존 채널) | 4-3에서 확인된 조직 |
| 앱 내 상단 배너 (전역 공지) | 전체 |
| 오늘 운영실 예외 업무함 강조 표시 | 자동 (이미 표시됨) |

```sql
-- 대체 전달 대상 목록 (조직·담당자별)
SELECT n.organization_id, o.name AS org_name,
       u.email AS recipient_email, u.display_name,
       n.kind, n.title, n.due_at
FROM notifications n
JOIN organizations o ON o.id = n.organization_id
JOIN users u         ON u.id = n.recipient_user_id
WHERE n.status = 'unread'
  AND n.due_at < now() + interval '4 hours'
  AND n.kind IN ('schedule_approval','grading_exception','route_publish_approval')
ORDER BY n.due_at
LIMIT 200;
```

**보호자 대상 채널은 만들지 않는다.** 대체 전달도 교직원 대상만이다.

### 5.3 kill switch 해제

```bash
# 테스트 발송으로 공급자 확인
node scripts/notification-test.mjs --to=ops@example.com

# 정상이면 해제
pnpm --filter @su-maek/db kill-switch disable external_notification --actor <이메일>
```

```sql
-- 적체 발송을 서서히 재개 (공급자 rate limit 회피)
UPDATE jobs
SET run_after = now() + (random() * interval '1800 seconds')
WHERE status = 'queued' AND job_type = 'notification.send';
```

**30분에 걸쳐 분산**한다. 한꺼번에 보내면 공급자가 다시 rate limit을 건다.

### 5.4 발송 속도 조절

```sql
-- 조직별 알림 동시 실행 한도 하향
UPDATE organizations
SET quota = jsonb_set(quota, '{worker_concurrency,notification}', to_jsonb(1)),
    updated_at = now()
WHERE id = $1;
```

전역 발송 속도는 환경변수 `NOTIFICATION_RATE_PER_MINUTE`로 조절한다(기본 600).

### 5.5 오래된 알림 정리

24시간 이상 발송되지 못한 알림은 **발송을 포기**한다. 업무함에는 남아 있으므로 정보 손실이 아니다.

```sql
UPDATE jobs
SET status = 'cancelled',
    cancel_requested_by = 'RB-13: 24시간 초과 발송 포기 (업무함에는 유지됨)',
    updated_at = now()
WHERE job_type = 'notification.send'
  AND status IN ('queued','failed')
  AND created_at < now() - interval '24 hours';
```

---

## 6. 검증

| # | 항목 | 검증 쿼리·명령 | 통과 조건 |
|---|---|---|---|
| V-1 | **업무함 정상** | 4-6 | 알림 생성 추이 정상 |
| V-2 | 발송 성공률 | 4-2 | 실패율 < 5% (30분) |
| V-3 | 발송 지연 | 4-5 | p95 < 30초 |
| V-4 | 큐 적체 해소 | 4-1 | `queued` oldest < 10분 |
| V-5 | 기한 임박 미발송 | 4-3 | **0행** |
| V-6 | DLQ | `SELECT count(*) FROM jobs WHERE job_type='notification.send' AND status='dead_lettered' AND updated_at > now() - interval '6 hours'` | 0 |
| V-7 | 테스트 발송 | `node scripts/notification-test.mjs` | 수신 확인 |
| V-8 | 반송률 | 4-7 | < 3% |
| V-9 | 도메인 기능 무영향 | 일정 승인·채점 예외 처리 표본 | 정상 |
| V-10 | kill switch | `kill-switch list` | `external_notifications` = `false` |

---

## 7. 고객 공지

### 공지 필요 여부

| 조건 | 공지 |
|---|---|
| 4시간 이상 발송 중단 + 기한 있는 승인 존재 | **필수** (영향 조직) |
| 8시간 이상 발송 중단 | **필수** (전체) |
| 1~4시간 중단, 자동 복구 | 불필요 |
| 지연만 (5분 이내) | 불필요 |
| 반송률 문제 (개별 주소) | 해당 사용자에게 앱 내 안내 |

### 초기 공지

> **[수맥] 이메일 알림 발송 지연 안내**
>
> 안녕하세요. 수맥 운영팀입니다.
>
> {UTC 시각}부터 외부 이메일 공급자의 장애로 **알림 이메일 발송이 지연**되고 있습니다.
>
> **중요: 앱 안에서는 모든 알림이 정상적으로 보입니다.**
>
> - 영향: 이메일 알림 발송만
> - **영향 없음**: 앱 내 업무함, 오늘 운영실 예외 목록, 일정 승인, 채점 예외 처리, 모든 도메인 기능
>
> **지금 하실 일**
> 1. **수맥에 로그인해 업무함을 확인해 주세요.** 처리할 항목이 모두 표시됩니다.
> 2. 기한이 있는 승인 요청은 오늘 운영실 상단에 강조 표시됩니다.
> 3. 대기 중인 알림은 공급자 복구 후 순차 발송됩니다. (24시간 이상 지연된 알림은 발송하지 않습니다. 업무함에는 그대로 남아 있습니다.)
>
> 복구 예상: {시각}

### 기한 임박 개별 연락

> **[수맥] 처리 기한이 임박한 승인 요청이 있습니다 — {조직명}**
>
> 이메일 알림 발송에 문제가 있어 직접 안내드립니다.
>
> | 항목 | 기한 |
> |---|---|
> | {알림 제목} | {기한} |
>
> 수맥에 로그인하신 뒤 **오늘 운영실 → 예외 업무함**에서 처리해 주세요.
>
> 처리가 어려우시면 회신해 주세요. 기한을 조정해 드리겠습니다.

### 해소 공지

> **[수맥] 알림 발송 정상화 안내**
>
> {UTC 시각}부로 이메일 알림 발송이 정상화되었습니다.
>
> | 항목 | 내용 |
> |---|---|
> | 지연 시간 | {시작} ~ {종료} (총 {N}시간) |
> | 대기했던 알림 | {N}건 |
> | 발송 완료 | {N}건 |
> | 발송 포기 (24시간 초과) | {N}건 — **업무함에는 그대로 남아 있습니다** |
> | 도메인 기능 영향 | 없음 |
>
> 대기했던 알림이 한꺼번에 도착할 수 있습니다. 양해 부탁드립니다.

---

## 8. 법률·규제 검토

| 조건 | 검토 필요 | 사유 |
|---|---|---|
| 알림 미발송으로 기한을 놓쳐 실질 피해 발생 | 검토 권장 | 조직 손해 주장 가능 |
| 알림 내용에 개인정보가 포함된 채 잘못된 수신자에게 발송 | **필요** | 개인정보 유출. [RB-06](./06-cross-tenant-exposure.md) 병행 |
| 공급자 자격 증명 유출 | **필요** | [RB-07](./07-account-takeover-malicious-upload.md) |
| 단순 발송 지연 | 불필요 | — |

---

## 9. 사후 조치

- [ ] 사후 분석 작성 (SEV2였던 경우)
- [ ] **업무함이 실제로 정상 동작했는가.** 사용자가 업무를 계속할 수 있었는가
- [ ] 알림 내용이 "무엇이·왜·영향 대상·권장 행동·처리 기한"을 담고 있어 이메일 없이도 충분했는가
- [ ] 기한 임박 알림의 대체 전달 경로가 실제로 작동했는가
- [ ] 회로 차단기·재시도 정책이 공급자 평판을 보호했는가
- [ ] 재개 시 지터(30분 분산)가 rate limit 재발을 막았는가
- [ ] 24시간 초과 발송 포기 정책이 적절했는가
- [ ] 반송률이 높은 주소를 정리했는가
- [ ] 공급자 이중화가 필요한 수준인가 (현재는 단일. 도입 조건을 검토)
- [ ] 오늘 운영실의 기한 임박 강조 표시가 충분히 눈에 띄는가
- [ ] 이 사고가 SEV3에 머물렀는가. 승격됐다면 왜인가
