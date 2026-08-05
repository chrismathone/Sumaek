-- ============================================================
-- 0019b — 플랫폼 조직 한 곳 (ADR-0020 1단계 뒤쪽). 멱등.
--
-- 콘텐츠(문항·자료·교재)는 조직별이 아니라 DB 전체 자산이고 마스터만
-- 넣는다(소유자 결정 2026-08-05). 그 콘텐츠가 사는 조직을 만든다.
--
-- **이 마이그레이션은 아무 동작도 바꾸지 않는다.** 행 하나가 생길 뿐,
-- 아직 아무 질의도 이 조직을 보지 않는다. 콘텐츠 이전은 3단계다 —
-- 옮기는 일과 보는 곳을 바꾸는 일은 같은 배포에 있어야 하고, 지금
-- 옮기면 질의가 아직 데모 조직을 보고 있어 화면이 그 순간 빈다.
--
-- 전제: 0019a가 먼저 돌아야 한다 (enum 값). 파일명 정렬이 그것을 보장한다.
-- ============================================================

-- 플랫폼은 **정확히 하나**다. 둘이 되면 콘텐츠가 두 곳에 갈라져 살고,
-- 그때부터 "어느 쪽이 진짜인가"를 코드가 매번 물어야 한다.
create unique index if not exists organizations_single_platform
  on public.organizations ((kind)) where kind = 'platform';

insert into public.organizations (id, name, slug, kind, status, timezone)
values (
  '00000000-0000-7000-8000-0000000000ff',
  '수맥 콘텐츠',
  'platform-content',
  'platform',
  'active',
  'Asia/Seoul'
)
on conflict (slug) do nothing;

-- RLS 정책과 SQL에서 플랫폼 조직을 부를 이름. 값을 하드코딩해 흩뿌리면
-- 나중에 옮길 수 없다.
create or replace function public.platform_org_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.organizations where kind = 'platform' limit 1
$$;

revoke all on function public.platform_org_id() from public;
grant execute on function public.platform_org_id() to authenticated, service_role;

-- 플랫폼 조직 행 자체는 누구나 읽을 수 있어야 한다 — 콘텐츠 조인이
-- organizations를 거칠 때 소속이 아니라고 가려지면 화면이 빈다.
-- (쓰기는 열지 않는다. 기존 정책이 그대로 막는다.)
drop policy if exists organizations_platform_select on public.organizations;
create policy organizations_platform_select on public.organizations
  for select to authenticated
  using (kind = 'platform');
