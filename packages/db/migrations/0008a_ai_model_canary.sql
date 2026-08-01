-- ============================================================
-- 0008a — AI 모델 버전 레지스트리 + 섀도 평가 (인수 36)
--
-- 두 테이블을 만든다:
--   ai_model_versions      무엇이 실사용(active)이고 무엇이 카나리(canary)인가
--   ai_shadow_evaluations  카나리 호출 1회의 관측 (일치도·지연·비용·실패)
--
-- drizzle 정의는 packages/db/src/schema/support.ts에 있다. 부분 유니크
-- 인덱스와 RLS는 drizzle이 표현하지 못하므로 여기서 관리한다 (2갈래 규약).
-- 전부 멱등.
-- ============================================================

-- ── 1. 모델 버전 레지스트리 ─────────────────────────────────
create table if not exists public.ai_model_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  operation text not null,
  provider text not null,
  model text not null,
  role text not null default 'candidate',
  notes text,
  promoted_at timestamptz,
  halted_at timestamptz,
  halt_reason text,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_model_versions_role_allowed'
  ) then
    alter table public.ai_model_versions
      add constraint ai_model_versions_role_allowed
      check (role in ('candidate','canary','active','halted','retired'));
  end if;

  -- 사유 없는 중단은 없다. 사후에 "왜 멈췄더라"를 묻지 않기 위해서다
  -- (operator_access_grants_reason_not_blank와 같은 규율).
  if not exists (
    select 1 from pg_constraint where conname = 'ai_model_versions_halt_reason'
  ) then
    alter table public.ai_model_versions
      add constraint ai_model_versions_halt_reason
      check (
        role <> 'halted'
        or (halted_at is not null and btrim(coalesce(halt_reason, '')) <> '')
      );
  end if;
end $$;

create unique index if not exists ai_model_versions_identity_uq
  on public.ai_model_versions (organization_id, operation, provider, model);

create index if not exists ai_model_versions_role_idx
  on public.ai_model_versions (organization_id, operation, role);

-- 조직·작업당 실사용 1개, 카나리 1개. 부분 유니크 인덱스로 강제한다 —
-- 애플리케이션 선택 로직(selectModels)이 결정론적으로 하나를 고르긴 하지만,
-- "어느 모델이 사용자 트래픽을 받는가"를 코드의 정렬 순서에 맡기지 않는다.
create unique index if not exists ai_model_versions_active_uq
  on public.ai_model_versions (organization_id, operation)
  where role = 'active';

create unique index if not exists ai_model_versions_canary_uq
  on public.ai_model_versions (organization_id, operation)
  where role = 'canary';

-- ── 2. 섀도 평가 관측 ───────────────────────────────────────
create table if not exists public.ai_shadow_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  operation text not null,
  baseline_provider text not null,
  baseline_model text not null,
  canary_provider text not null,
  canary_model text not null,
  ok boolean not null,
  error_kind text,
  error_message text,
  agreement numeric(4,3),
  baseline_latency_ms integer not null,
  canary_latency_ms integer not null,
  baseline_cost_usd numeric(10,6),
  canary_cost_usd numeric(10,6),
  canary_input_tokens integer not null default 0,
  canary_output_tokens integer not null default 0,
  detail jsonb,
  related_type text,
  related_id uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  -- 성공 표본에는 일치도가 반드시 있고, 실패 표본에는 반드시 없다.
  -- 실패를 일치도 0으로 기록하면 "완전히 다른 답을 냈다"와 구분되지 않아
  -- 평균 일치도가 실패 횟수에 오염된다.
  if not exists (
    select 1 from pg_constraint where conname = 'ai_shadow_agreement_pairs_ok'
  ) then
    alter table public.ai_shadow_evaluations
      add constraint ai_shadow_agreement_pairs_ok
      check ((ok and agreement is not null) or ((not ok) and agreement is null));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_shadow_error_kind_pairs_ok'
  ) then
    alter table public.ai_shadow_evaluations
      add constraint ai_shadow_error_kind_pairs_ok
      check ((ok and error_kind is null) or ((not ok) and error_kind is not null));
  end if;
end $$;

create index if not exists ai_shadow_org_model_idx
  on public.ai_shadow_evaluations
     (organization_id, operation, canary_model, created_at);

-- ── 3. RLS (0004a_ai_usage_rls.sql와 같은 모양) ─────────────
-- 조회는 조직 격리 + 학생 차단. 쓰기 정책은 두지 않는다 — 등록·승격·중단·
-- 기록은 전부 서버(service_role)의 몫이고, 사용자 세션이 모델 롤아웃을
-- 바꿀 수 있으면 카나리 통제 자체가 무의미해진다.
alter table public.ai_model_versions enable row level security;
drop policy if exists ai_model_versions_org_select on public.ai_model_versions;
create policy ai_model_versions_org_select on public.ai_model_versions
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
  );

alter table public.ai_shadow_evaluations enable row level security;
drop policy if exists ai_shadow_evaluations_org_select
  on public.ai_shadow_evaluations;
create policy ai_shadow_evaluations_org_select on public.ai_shadow_evaluations
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and coalesce(public.auth_role_in_org(organization_id), '') <> 'student'
  );
