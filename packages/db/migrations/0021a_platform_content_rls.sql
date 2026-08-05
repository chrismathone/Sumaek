-- ============================================================
-- 0021a — 플랫폼 콘텐츠 RLS (ADR-0020 5단계). 멱등.
--
-- **이 마이그레이션은 지금 화면을 바꾸지 않는다.** 서버 질의는 postgres
-- 롤(rolbypassrls=true)로 나가므로 정책이 한 줄도 평가되지 않는다. 여기는
-- 사용자 access token으로 PostgREST에 직접 붙는 경로를 막는 이중 방어다
-- (eywa 실사고 1번: 화면에서만 잠갔더니 토큰으로 우회당했다).
--
-- 규칙은 질의와 같아야 한다:
--   읽기 — 플랫폼 콘텐츠는 로그인한 누구나 본다 (자기 조직 것은 기존 정책)
--   쓰기 — 플랫폼 행은 **콘텐츠 마스터만** 만들고 고치고 지운다
--
-- 기존 `*_org_isolation`(조직 격리)과 `*_staff_only`(학생 차단)는 그대로 둔다.
-- 학생이 문항 원본을 직접 긁는 경로는 계속 막혀 있어야 한다.
-- ============================================================

-- 콘텐츠 마스터 = 플랫폼 조직의 owner 또는 content_manager.
-- 아직 그런 계정이 없다 — 만들기 전까지는 아무도 플랫폼 콘텐츠를 쓰지
-- 못한다는 뜻이고, 그것이 맞다(서버는 service_role/postgres로 쓴다).
create or replace function public.is_content_master()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organization_id = public.platform_org_id()
      and m.status = 'active'
      and m.role in ('owner', 'content_manager')
  )
$$;

revoke all on function public.is_content_master() from public;
grant execute on function public.is_content_master() to authenticated, service_role;

/* 학생인가 — **자기 조직에서의 역할**로 본다.
 *
 * 기존 `*_staff_only`는 `auth_role_in_org(organization_id) <> 'student'`로
 * 막는데, 그 organization_id가 플랫폼이면 학생은 그 조직의 멤버가 아니라
 * 역할이 null이 되고, coalesce(null,'') <> 'student'가 참이 되어 **통과한다.**
 * 즉 콘텐츠를 플랫폼으로 옮기는 순간 학생이 문항 원본·정답을 읽을 수 있다
 * (실측: 984건이 열렸다. rls-isolation 테스트가 잡았다).
 *
 * 그래서 「이 사람이 학생이냐」를 행의 조직이 아니라 **사람 기준**으로 묻는다.
 * 학생 아닌 멤버십이 하나도 없으면 학생이다. */
create or replace function public.is_student_only()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role <> 'student'
  )
$$;

revoke all on function public.is_student_only() from public;
grant execute on function public.is_student_only() to authenticated, service_role;

do $$
declare
  t text;
  /* 학생에게 원본을 열면 안 되는 표 — 기존 *_staff_only와 같은 목록이다.
   * 나머지(학습 자료 등)는 학생이 봐야 하는 것이라 그대로 연다. */
  staff_only text[] := array[
    'content_rights','question_alignments','question_versions',
    'questions','source_files','source_pages'
  ];
  content_tables text[] := array[
    'publishers','books','book_editions','content_rights',
    'source_files','source_pages',
    'questions','question_versions','question_alignments','math_expressions',
    'math_normalization_runs','math_render_artifacts','formula_reviews',
    'diagram_assets','question_assets','duplicate_groups','content_reviews',
    'learning_materials','concept_blank_sets'
  ];
begin
  foreach t in array content_tables loop
    -- 읽기: 플랫폼 콘텐츠는 모두에게 (PERMISSIVE — 기존 조직 정책과 OR)
    execute format('drop policy if exists %I on public.%I', t || '_platform_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (organization_id = public.platform_org_id()%s)',
      t || '_platform_read', t,
      case when t = any(staff_only) then ' and not public.is_student_only()' else '' end
    );

    /* 쓰기: 플랫폼 행은 마스터만. RESTRICTIVE라 다른 정책과 **AND**로 묶인다.
     * `for all`을 쓰지 않는 이유는 그러면 USING이 SELECT에도 걸려 위의
     * 읽기 개방을 도로 막기 때문이다 — 명령별로 나눈다. */
    execute format('drop policy if exists %I on public.%I', t || '_platform_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated
         with check (organization_id <> public.platform_org_id()
                     or public.is_content_master())',
      t || '_platform_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_platform_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated
         using (organization_id <> public.platform_org_id()
                or public.is_content_master())
         with check (organization_id <> public.platform_org_id()
                     or public.is_content_master())',
      t || '_platform_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_platform_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated
         using (organization_id <> public.platform_org_id()
                or public.is_content_master())',
      t || '_platform_delete', t
    );
  end loop;
end $$;
