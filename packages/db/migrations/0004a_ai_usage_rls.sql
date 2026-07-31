-- ─────────────────────────────────────────────────────────────
-- AI 사용량·예산 RLS (인수 37)
-- 0004_broken_yellowjacket.sql(ai_usage_events·ai_budgets 생성)의 수기 후속.
-- 조회는 조직 격리(학생 차단), 기록·예산 변경은 서버(service_role)만.
-- ─────────────────────────────────────────────────────────────

alter table public.ai_usage_events enable row level security;
drop policy if exists ai_usage_events_org_select on public.ai_usage_events;
create policy ai_usage_events_org_select on public.ai_usage_events
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
  );

alter table public.ai_budgets enable row level security;
drop policy if exists ai_budgets_org_select on public.ai_budgets;
create policy ai_budgets_org_select on public.ai_budgets
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
  );
