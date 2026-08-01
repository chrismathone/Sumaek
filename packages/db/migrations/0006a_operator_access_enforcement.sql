-- ─────────────────────────────────────────────────────────────
-- break-glass 운영자 접근 집행 (27장 · 인수 28).
--
-- 지금까지 operator_access_grants에는 컬럼만 있었다 — 사유가 비어 있어도,
-- 만료가 1년 뒤여도, 만료가 발급보다 앞서도 저장됐다. 애플리케이션이
-- 아무리 검증해도 SQL 한 줄이면 우회되므로 불변식을 테이블에 박는다.
--
-- 상한 4시간은 threat-model Q-11(2인 승인 · 최대 4시간 · 자동 만료)의 값이다.
-- ─────────────────────────────────────────────────────────────

-- 사유 필수 — notNull만으로는 ''(빈 문자열)이 통과한다.
alter table public.operator_access_grants
  drop constraint if exists operator_access_grants_reason_not_blank;
alter table public.operator_access_grants
  add constraint operator_access_grants_reason_not_blank
  check (btrim(reason) <> '');

-- 만료는 발급 뒤여야 하고, 4시간을 넘을 수 없다.
-- (무기한은 expires_at이 notNull이라 이미 불가능하다.)
alter table public.operator_access_grants
  drop constraint if exists operator_access_grants_window;
alter table public.operator_access_grants
  add constraint operator_access_grants_window
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '4 hours'
  );

-- 승인 시각과 승인자는 함께 있거나 함께 없다 — 승인자 없는 승인은 승인이 아니다.
alter table public.operator_access_grants
  drop constraint if exists operator_access_grants_approval_pair;
alter table public.operator_access_grants
  add constraint operator_access_grants_approval_pair
  check ((approved_by is null) = (approved_at is null));

-- 회수는 발급 이후에만.
alter table public.operator_access_grants
  drop constraint if exists operator_access_grants_revocation;
alter table public.operator_access_grants
  add constraint operator_access_grants_revocation
  check (revoked_at is null or revoked_at >= created_at);

-- 세션 해석 경로(운영자 한 명의 살아있는 승인 찾기)의 인덱스.
-- 기존 operator_grants_org_idx는 (organization_id, expires_at)이라
-- 운영자 기준 조회에는 쓰이지 않는다.
create index if not exists operator_grants_operator_idx
  on public.operator_access_grants (operator_user_id, expires_at desc);

-- 감사 이벤트 → 승인 역추적. 승인 하나가 만든 조회·변경을 모아 소유자에게
-- 활동 요약으로 보여준다(고지). 부분 인덱스라 일반 감사 쓰기에는 부담이 없다.
create index if not exists audit_events_access_grant_idx
  on public.audit_events (access_grant_id)
  where access_grant_id is not null;

-- RLS 주석: operator_access_grants는 0001a_rls_core.sql의 조직 격리 정책
-- 대상이다. 운영자는 멤버십이 없으므로 auth_org_ids()에 대상 조직이 들어오지
-- 않는다 — 즉 운영자가 authenticated 커넥션으로 직접 이 표를 읽거나
-- 자기 승인을 만들 수는 없다. 발급·회수는 서버 경로(서비스 커넥션)에서만
-- 일어나고, 그 경로가 canWrite(settings) 게이트와 감사 기록을 통과한다.
