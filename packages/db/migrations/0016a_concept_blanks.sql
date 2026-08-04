-- ============================================================
-- 0016a — 개념 빈칸 (인강을 보고 넘어가는 것이 아니라 인출하게)
--
-- 두 테이블을 만든다:
--   concept_blank_sets      개념 × 단계로 큐레이션된 빈칸 묶음 (조직 공유물)
--   learner_blank_progress  누가 어느 묶음을 몇 개 맞혔는가 (학습자 데이터)
--
-- drizzle 정의는 packages/db/src/schema/learning.ts에 있다. RLS 정책은
-- drizzle이 표현하지 못하므로 여기서 관리한다 (2갈래 규약). 전부 멱등.
--
-- **왜 자료에서 파생하지 않고 따로 저장하는가.**
-- 읽기 자료의 정의 블록에서 용어만 뚫으면 데이터는 공짜지만, 뚫린 자리가
-- 「그 강의가 가르치려는 것」이라는 보장이 없다. 빈칸은 적은 수를 정확한
-- 자리에 놓아야 인출이 되고, 많으면 받아쓰기가 된다. 그 판단은 사람(또는
-- 사람이 검수한 제안)의 것이므로 검수 가능한 행으로 남긴다 — 자료와 같은
-- draft → published 흐름을 탄다.
--
-- **왜 template_text를 저장하는가** (자료 본문을 실시간으로 읽지 않고).
-- 자료를 고치면 학생이 풀던 빈칸이 조용히 다른 문장이 된다. 스냅샷을 두고
-- source_material_id로 출처만 남겨, 원본이 바뀌었는지는 검수에서 본다.
-- 문항 복제 금지(불변 조건 8)와 어긋나지 않는다 — 이것은 문항이 아니라
-- 빈칸 묶음 자체의 본문이고, 정답 권한도 여기 하나뿐이다.
--
-- 3단계(full)는 template_text가 없다. 학생이 개념을 통째로 다시 쓴다.
-- 채점은 blanks의 answer를 핵심어로 보고 포함 여부를 센다.
-- ============================================================

-- ── 1. enum ────────────────────────────────────────────────
/* 1단계: 핵심어 한둘만 · 2단계: 정의문의 뼈대까지 · 3단계: 통째로 재현.
 * 이름에 개수를 넣지 않는다 — 개수는 큐레이션의 결과이지 단계의 정의가
 * 아니다. 단계의 정의는 「발판을 얼마나 걷어냈는가」다. */
do $$ begin
  create type public.concept_blank_stage as enum ('one', 'two', 'full');
exception when duplicate_object then null; end $$;

-- 자료와 같은 낱말을 쓴다 — 검수 흐름이 같기 때문이다
do $$ begin
  create type public.concept_blank_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

-- ── 2. 빈칸 묶음 ───────────────────────────────────────────
create table if not exists public.concept_blank_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  concept_id uuid not null references public.canonical_concepts(id),
  stage public.concept_blank_stage not null,
  /* 빈칸이 뚫린 본문. 자리는 {{1}}·{{2}}로 적는다 — 화면이 그 자리에
   * 입력칸을 그린다. full 단계에는 없다(통째로 쓰므로). */
  template_text text,
  /* [{position, answer, hint, alternatives[]}] — alternatives는 표기 변이
   * (소인수분해 / 소인수 분해)를 정답으로 받기 위한 것이다. 채점은
   * core의 정규화를 먼저 태운다. */
  blanks jsonb not null default '[]'::jsonb,
  /* 어느 자료에서 왔는가 — 원본이 바뀌었는지 검수에서 대조할 근거.
   * 자료가 지워져도 빈칸은 남는다(set null): 학생 진도가 매달려 있다. */
  source_material_id uuid references public.learning_materials(id) on delete set null,
  status public.concept_blank_status not null default 'draft',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* 개념 × 단계 = 하나. 둘이면 학생이 어느 것을 푸는지가 순서에 달리고,
 * 「1단계를 마쳤다」가 무엇을 뜻하는지 알 수 없게 된다. */
create unique index if not exists concept_blank_sets_uq
  on public.concept_blank_sets (organization_id, concept_id, stage);
create index if not exists concept_blank_sets_concept_idx
  on public.concept_blank_sets (organization_id, concept_id, status);

/* 단계별 최소 조건 — one·two는 뚫린 본문과 빈칸이 있어야 하고, full은
 * 본문 없이 핵심어만 있으면 된다. 빈 묶음을 게시하면 학생이 빈 화면을 본다. */
alter table public.concept_blank_sets
  drop constraint if exists concept_blank_sets_stage_payload_ck;
alter table public.concept_blank_sets
  add constraint concept_blank_sets_stage_payload_ck check (
    (stage in ('one', 'two') and template_text is not null
      and jsonb_array_length(blanks) > 0)
    or (stage = 'full' and jsonb_array_length(blanks) > 0)
  );

-- ── 3. 학습자 진도 ─────────────────────────────────────────
create table if not exists public.learner_blank_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  learner_id uuid not null references public.learners(id),
  blank_set_id uuid not null references public.concept_blank_sets(id) on delete cascade,
  status public.material_progress_status not null default 'in_progress',
  /* 최고 기록 — 다시 풀어 더 틀려도 내려가지 않는다. 되풀이가 벌이 되면
   * 학생은 다시 풀지 않는다. */
  best_correct integer not null default 0,
  total_count integer not null default 0,
  attempts integer not null default 0,
  /* 마지막 제출 상세 — 무엇을 틀렸는지 교사가 본다 */
  result jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* 한 학습자 × 한 묶음 = 한 행 (upsert 충돌 대상) */
create unique index if not exists learner_blank_progress_uq
  on public.learner_blank_progress (learner_id, blank_set_id);
create index if not exists learner_blank_progress_learner_idx
  on public.learner_blank_progress (organization_id, learner_id, status);

-- ── 4. RLS ─────────────────────────────────────────────────
alter table public.concept_blank_sets enable row level security;
alter table public.learner_blank_progress enable row level security;

drop policy if exists concept_blank_sets_tenant on public.concept_blank_sets;
create policy concept_blank_sets_tenant on public.concept_blank_sets
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

drop policy if exists learner_blank_progress_tenant on public.learner_blank_progress;
create policy learner_blank_progress_tenant on public.learner_blank_progress
  for all using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
