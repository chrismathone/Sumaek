-- ============================================================
-- 0001a — RLS 핵심, 불변 트리거, 시간 충돌 제약, 핵심 FK
-- 전부 멱등. drizzle-kit push 금지 (alpha 객체를 drift로 오인).
-- 설계 근거: docs/phase0/survey/eywa-allinone.md (RLS 3계층),
--            골프롬프트 2E 불변 조건, 2J 인덱스 계약.
-- ============================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ── 1. 테넌트 해석 함수 ──────────────────────────────────────
-- 사용자는 여러 워크스페이스에 소속될 수 있다 (7장).
-- JWT app_metadata가 아니라 public.memberships가 항상 authoritative.
create or replace function public.auth_org_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id
  from public.memberships
  where user_id = auth.uid() and status = 'active'
$$;

revoke all on function public.auth_org_ids() from public;
grant execute on function public.auth_org_ids() to authenticated, service_role;

-- 역할 조회 (RESTRICTIVE 역할 게이트의 기반)
create or replace function public.auth_role_in_org(p_org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select role::text
  from public.memberships
  where user_id = auth.uid() and organization_id = p_org and status = 'active'
  limit 1
$$;

revoke all on function public.auth_role_in_org(uuid) from public;
grant execute on function public.auth_role_in_org(uuid) to authenticated, service_role;

-- ── 2. 테넌트 격리 정책 (전 테넌트 테이블 일괄) ──────────────
-- organization_id NOT NULL 테이블: 소속 조직 데이터만 접근.
do $$
declare
  t text;
  tenant_tables text[] := array[
    -- workspace
    'memberships','membership_scopes','invitations','external_identities',
    'integration_connections','integration_sync_cursors',
    -- instruction
    'course_periods','holidays','calendar_rules','learners','learning_groups',
    'learning_group_memberships','sessions','learning_availability_events','makeup_sessions',
    -- content
    'publishers','books','book_editions','content_rights','source_files','source_pages',
    'questions','question_versions','question_alignments','math_expressions',
    'math_normalization_runs','math_render_artifacts','formula_reviews','diagram_assets',
    'question_assets','duplicate_groups','content_reviews','document_exports',
    -- route
    'route_plans','route_versions','route_nodes','route_dependencies',
    'student_route_overrides','route_publications','schedule_change_proposals',
    'schedule_revisions','progress_events',
    -- assessment
    'assessment_policies','assessment_blueprints','assessment_instances',
    'assessment_questions','assignments','attempts','responses','grade_decisions',
    'grading_exceptions',
    -- learning
    'mastery_policy_versions','mastery_evidences','concept_masteries','review_items','retry_plans',
    -- support
    'notifications','reports','import_jobs','operator_access_grants'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (organization_id in (select public.auth_org_ids()))
         with check (organization_id in (select public.auth_org_ids()))',
      t || '_org_isolation', t
    );
  end loop;
end $$;

-- organizations: 소속 조직만 조회. 생성·설정 변경은 서버 경유(service_role).
alter table public.organizations enable row level security;
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations
  for select to authenticated
  using (id in (select public.auth_org_ids()));

-- users: 본인 행 + 같은 조직 구성원의 표시명 조회.
alter table public.users enable row level security;
drop policy if exists users_self on public.users;
create policy users_self on public.users
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
drop policy if exists users_same_org_select on public.users;
create policy users_same_org_select on public.users
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = users.id
      and m.organization_id in (select public.auth_org_ids())
  ));

-- kill_switches: org 행은 소속만 조회, 전역(null) 행은 모두 조회. 변경은 서버만.
alter table public.kill_switches enable row level security;
drop policy if exists kill_switches_select on public.kill_switches;
create policy kill_switches_select on public.kill_switches
  for select to authenticated
  using (organization_id is null or organization_id in (select public.auth_org_ids()));

-- 서버 전용 인프라 테이블: RLS 활성화 + authenticated 정책 없음(전부 차단).
-- service_role은 RLS를 우회한다.
do $$
declare
  t text;
begin
  foreach t in array array['outbox_events','inbox_events','jobs','idempotency_keys','schedule_leases','demo_requests'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 교육과정 전역 참조 데이터: 읽기는 로그인 사용자 전체, 쓰기는 서버만 (ADR-0011).
do $$
declare
  t text;
begin
  foreach t in array array[
    'curriculum_authority_sources','curriculum_versions','curriculum_applicabilities',
    'curriculum_releases','official_curriculum_nodes','achievement_standards',
    'competency_definitions','canonical_concepts','learning_objectives','concept_edges',
    'representations','misconceptions','instructional_profiles','assessment_evidences'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_all', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read_all', t
    );
  end loop;
end $$;

-- org-nullable 매핑·별칭: 전역 행은 읽기 전용, org 행은 격리.
do $$
declare
  t text;
begin
  foreach t in array array['source_aliases','curriculum_mappings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_scoped', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (organization_id is null or organization_id in (select public.auth_org_ids()))
         with check (organization_id in (select public.auth_org_ids()))',
      t || '_scoped', t
    );
  end loop;
end $$;

-- ── 3. RESTRICTIVE 역할 게이트 (민감 테이블) ─────────────────
-- 학생 역할은 문항 원본·정답·타 학생 데이터에 접근 불가.
-- PERMISSIVE 격리 위에 얹는다 — 둘 다 통과해야 접근된다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'questions','question_versions','question_alignments','content_rights',
    'source_files','source_pages','grading_exceptions','assessment_blueprints',
    'assessment_policies','audit_events','import_jobs','reports'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_only', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (coalesce(public.auth_role_in_org(organization_id), '''') <> ''student'')',
      t || '_staff_only', t
    );
  end loop;
end $$;

-- 학생의 응시·답안은 본인 것만 (교직원은 조직 격리 정책으로 접근).
drop policy if exists attempts_student_own on public.attempts;
create policy attempts_student_own on public.attempts
  as restrictive for all to authenticated
  using (
    coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
    or exists (
      select 1 from public.learners l
      where l.id = attempts.learner_id and l.user_id = auth.uid()
    )
  );

drop policy if exists responses_student_own on public.responses;
create policy responses_student_own on public.responses
  as restrictive for all to authenticated
  using (
    coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
    or exists (
      select 1 from public.attempts a
      join public.learners l on l.id = a.learner_id
      where a.id = responses.attempt_id and l.user_id = auth.uid()
    )
  );

-- ── 4. 감사 로그·학습 증거 불변 (불변 조건 15) ───────────────
alter table public.audit_events enable row level security;

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% 테이블은 append-only입니다 — 수정·삭제할 수 없습니다 (불변 조건 15)', tg_table_name
    using errcode = 'raise_exception';
end $$;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.forbid_mutation();

drop trigger if exists mastery_evidences_immutable on public.mastery_evidences;
create trigger mastery_evidences_immutable
  before update or delete on public.mastery_evidences
  for each row execute function public.forbid_mutation();

drop trigger if exists progress_events_immutable on public.progress_events;
create trigger progress_events_immutable
  before update or delete on public.progress_events
  for each row execute function public.forbid_mutation();

-- ── 5. 시간 충돌 하드 제약 (불변 조건 6) ─────────────────────
-- 교사·학습 그룹의 활성 수업 시간 겹침을 DB에서 차단.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_teacher_no_overlap'
  ) then
    alter table public.sessions add constraint sessions_teacher_no_overlap
      exclude using gist (
        organization_id with =,
        teacher_user_id with =,
        tstzrange(starts_at, ends_at) with &&
      ) where (teacher_user_id is not null
               and status in ('planned', 'confirmed', 'in_progress'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sessions_group_no_overlap'
  ) then
    alter table public.sessions add constraint sessions_group_no_overlap
      exclude using gist (
        organization_id with =,
        learning_group_id with =,
        tstzrange(starts_at, ends_at) with &&
      ) where (status in ('planned', 'confirmed', 'in_progress'));
  end if;
end $$;

-- ── 6. updated_at 자동 갱신 ──────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name = c.table_name and t.table_schema = 'public'
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and t.table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists %I on public.%I',
      r.table_name || '_set_updated_at', r.table_name);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()',
      r.table_name || '_set_updated_at', r.table_name);
  end loop;
end $$;

-- ── 7. 핵심 FK (참조 무결성 — 대표 경로) ─────────────────────
do $$
begin
  -- workspace
  if not exists (select 1 from pg_constraint where conname = 'memberships_org_fk') then
    alter table public.memberships
      add constraint memberships_org_fk foreign key (organization_id)
      references public.organizations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memberships_user_fk') then
    alter table public.memberships
      add constraint memberships_user_fk foreign key (user_id)
      references public.users(id);
  end if;

  -- instruction
  if not exists (select 1 from pg_constraint where conname = 'sessions_group_fk') then
    alter table public.sessions
      add constraint sessions_group_fk foreign key (learning_group_id)
      references public.learning_groups(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lg_memberships_group_fk') then
    alter table public.learning_group_memberships
      add constraint lg_memberships_group_fk foreign key (learning_group_id)
      references public.learning_groups(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lg_memberships_learner_fk') then
    alter table public.learning_group_memberships
      add constraint lg_memberships_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;

  -- content
  if not exists (select 1 from pg_constraint where conname = 'question_versions_question_fk') then
    alter table public.question_versions
      add constraint question_versions_question_fk foreign key (question_id)
      references public.questions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'question_alignments_question_fk') then
    alter table public.question_alignments
      add constraint question_alignments_question_fk foreign key (question_id)
      references public.questions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'question_alignments_concept_fk') then
    alter table public.question_alignments
      add constraint question_alignments_concept_fk foreign key (concept_id)
      references public.canonical_concepts(id);
  end if;

  -- route
  if not exists (select 1 from pg_constraint where conname = 'route_versions_plan_fk') then
    alter table public.route_versions
      add constraint route_versions_plan_fk foreign key (route_plan_id)
      references public.route_plans(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'route_nodes_version_fk') then
    alter table public.route_nodes
      add constraint route_nodes_version_fk foreign key (route_version_id)
      references public.route_versions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'overrides_base_version_fk') then
    alter table public.student_route_overrides
      add constraint overrides_base_version_fk foreign key (base_route_version_id)
      references public.route_versions(id);
  end if;

  -- assessment
  if not exists (select 1 from pg_constraint where conname = 'assessment_questions_assessment_fk') then
    alter table public.assessment_questions
      add constraint assessment_questions_assessment_fk foreign key (assessment_id)
      references public.assessment_instances(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_questions_qv_fk') then
    alter table public.assessment_questions
      add constraint assessment_questions_qv_fk foreign key (question_version_id)
      references public.question_versions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attempts_assessment_fk') then
    alter table public.attempts
      add constraint attempts_assessment_fk foreign key (assessment_id)
      references public.assessment_instances(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attempts_learner_fk') then
    alter table public.attempts
      add constraint attempts_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'responses_attempt_fk') then
    alter table public.responses
      add constraint responses_attempt_fk foreign key (attempt_id)
      references public.attempts(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'responses_aq_fk') then
    alter table public.responses
      add constraint responses_aq_fk foreign key (assessment_question_id)
      references public.assessment_questions(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grade_decisions_response_fk') then
    alter table public.grade_decisions
      add constraint grade_decisions_response_fk foreign key (response_id)
      references public.responses(id);
  end if;

  -- learning
  if not exists (select 1 from pg_constraint where conname = 'mastery_evidences_learner_fk') then
    alter table public.mastery_evidences
      add constraint mastery_evidences_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mastery_evidences_concept_fk') then
    alter table public.mastery_evidences
      add constraint mastery_evidences_concept_fk foreign key (concept_id)
      references public.canonical_concepts(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'concept_masteries_learner_fk') then
    alter table public.concept_masteries
      add constraint concept_masteries_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;

  -- curriculum (전역)
  if not exists (select 1 from pg_constraint where conname = 'achievement_standards_release_fk') then
    alter table public.achievement_standards
      add constraint achievement_standards_release_fk foreign key (release_id)
      references public.curriculum_releases(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'official_nodes_release_fk') then
    alter table public.official_curriculum_nodes
      add constraint official_nodes_release_fk foreign key (release_id)
      references public.curriculum_releases(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'concept_edges_from_fk') then
    alter table public.concept_edges
      add constraint concept_edges_from_fk foreign key (from_concept_id)
      references public.canonical_concepts(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'concept_edges_to_fk') then
    alter table public.concept_edges
      add constraint concept_edges_to_fk foreign key (to_concept_id)
      references public.canonical_concepts(id);
  end if;
end $$;

-- ── 8. auth.users → public.users 동기화 트리거 ───────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
