-- ============================================================
-- 0011a — 워커 박동(heartbeat)
--
-- 왜 필요한가: 워커가 살아 있는지 확인할 방법이 저장소에 없었다.
--   · 접속이 Supavisor 풀러를 거쳐 pg_stat_activity에는 워커의
--     application_name이 남지 않는다 (실측 — 풀러 자기 이름만 보인다).
--   · 큐 지표(적체·고아 작업)는 **일이 있을 때만** 죽음을 드러낸다.
--     유휴 상태로 죽으면 아무 흔적도 남지 않는다.
-- RB-04 1장의 `worker_heartbeat_lost` 알림이 가리키던 대상이 이 테이블이다
-- (알림은 문서에만 있었고 실체가 없었다).
--
-- 정상 종료는 stopped_at을 남긴다 — "내려간 것"과 "죽은 것"은 다른 사건이다.
-- 죽은 워커의 행은 지우지 않는다. 마지막 박동이 "언제 죽었는가"의 유일한
-- 증거다. 정리는 운영자가 판단한다 (pnpm queue:status가 보여준다).
--
-- drizzle 정의는 packages/db/src/schema/infra.ts. jobs·outbox_events와 같이
-- 조직 스코프가 없는 플랫폼 테이블이라 RLS를 켜되 정책을 두지 않는다
-- (서비스 롤만 접근). 멱등.
-- ============================================================

create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  hostname text,
  pid integer,
  topics text[] not null default '{}'::text[],
  beat_interval_seconds integer not null default 15,
  started_at timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  stopped_at timestamptz,
  stop_reason text,
  last_result jsonb
);

comment on table public.worker_heartbeats is
  '워커 프로세스의 생존 신고. 행이 없거나 last_beat_at이 beat_interval_seconds의 3배를 넘으면 죽은 것으로 본다 (RB-04 4-2)';
comment on column public.worker_heartbeats.beat_interval_seconds is
  '박동 주기(초) — 관측자가 임계값을 이 값에서 유도한다. 런북에 숫자를 박지 않기 위해 행이 스스로 들고 있다';
comment on column public.worker_heartbeats.stopped_at is
  '정상 종료 시각. null이면서 박동이 끊겼으면 비정상 종료다';

/* 박동이 끊긴 워커 조회 경로 — 행 수가 워커 수라 작지만, status 도구가
 * 매번 정렬해 읽으므로 인덱스를 둔다. */
create index if not exists worker_heartbeats_beat_idx
  on public.worker_heartbeats (last_beat_at desc);

alter table public.worker_heartbeats enable row level security;
