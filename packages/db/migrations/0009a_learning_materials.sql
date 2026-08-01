-- ============================================================
-- 0009a — 학습 자료 (개념 공부 · 인강 · 연습문제)
--
-- 두 테이블을 만든다:
--   learning_materials         개념에 붙는 읽기·영상·연습문제 (조직 공유물)
--   learner_material_progress  누가 어디까지 봤는가 (학습자 데이터)
--
-- drizzle 정의는 packages/db/src/schema/learning.ts에 있다. RLS 정책은
-- drizzle이 표현하지 못하므로 여기서 관리한다 (2갈래 규약). 전부 멱등.
--
-- 왜 개념에 붙이는가: 같은 개념은 반·학년이 달라도 같은 자료를 쓰고,
-- 루트가 바뀌어도 자료가 따라 죽지 않는다.
-- 왜 문항을 복제하지 않는가: 정답·검수 상태가 두 곳에서 갈라지면 어느 쪽이
-- 진짜인지 알 수 없다 (불변 조건 8의 정신). question_ids로 참조만 한다.
-- ============================================================

-- ── 1. enum ────────────────────────────────────────────────
do $$ begin
  create type public.learning_material_kind as enum ('reading', 'video', 'practice');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.learning_material_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.material_progress_status as enum ('in_progress', 'completed');
exception when duplicate_object then null; end $$;

-- ── 2. 학습 자료 ───────────────────────────────────────────
create table if not exists public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  concept_id uuid not null references public.canonical_concepts(id),
  kind public.learning_material_kind not null,
  title text not null,
  body jsonb,
  video_url text,
  video_seconds integer,
  question_ids jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  status public.learning_material_status not null default 'draft',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_materials_concept_idx
  on public.learning_materials (organization_id, concept_id, status, sort_order);

/* 종류별 최소 조건 — 영상 자료에 주소가 없으면 학생 화면에서 빈 카드가 된다.
 * 읽기 자료에 본문이 없어도 마찬가지다. 만들 때 막는다. */
alter table public.learning_materials
  drop constraint if exists learning_materials_kind_payload_ck;
alter table public.learning_materials
  add constraint learning_materials_kind_payload_ck check (
    (kind = 'reading' and body is not null)
    or (kind = 'video' and video_url is not null)
    or (kind = 'practice')
  );

-- ── 3. 학습자 진도 ─────────────────────────────────────────
create table if not exists public.learner_material_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  learner_id uuid not null references public.learners(id),
  material_id uuid not null references public.learning_materials(id) on delete cascade,
  status public.material_progress_status not null default 'in_progress',
  result jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* 한 학습자 × 한 자료 = 한 행. 진도를 중복으로 쌓으면 "다 봤는가"를
 * 셀 수 없다. upsert의 충돌 대상이기도 하다. */
create unique index if not exists learner_material_progress_uq
  on public.learner_material_progress (learner_id, material_id);
create index if not exists learner_material_progress_learner_idx
  on public.learner_material_progress (organization_id, learner_id, status);

-- ── 4. RLS ─────────────────────────────────────────────────
alter table public.learning_materials enable row level security;
alter table public.learner_material_progress enable row level security;

drop policy if exists learning_materials_tenant on public.learning_materials;
create policy learning_materials_tenant on public.learning_materials
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

drop policy if exists learner_material_progress_tenant on public.learner_material_progress;
create policy learner_material_progress_tenant on public.learner_material_progress
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
