-- ─────────────────────────────────────────────────────────────
-- 개인정보 삭제 요청 RLS (ADR-0015 §5 · 인수 39)
-- 0002_clever_bishop.sql(data_deletion_requests 생성)의 수기 후속.
-- 패턴은 0001a_rls_core.sql과 동일: 조직 격리 + 학생 차단(RESTRICTIVE).
-- ─────────────────────────────────────────────────────────────

alter table public.data_deletion_requests enable row level security;

drop policy if exists data_deletion_requests_org_isolation on public.data_deletion_requests;
create policy data_deletion_requests_org_isolation on public.data_deletion_requests
  for all to authenticated
  using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- 삭제 요청 기록은 교직원 전용 — 학생 역할 차단
drop policy if exists data_deletion_requests_staff_only on public.data_deletion_requests;
create policy data_deletion_requests_staff_only on public.data_deletion_requests
  as restrictive for all to authenticated
  using (coalesce(public.auth_role_in_org(organization_id), '') <> 'student');
