-- ============================================================
-- 0016a — 학생 하루 실행 계획 (ADR-0017 · ADR-0018)
--
-- 두 테이블을 만든다:
--   learner_day_plans        학생 1명 × 날짜 1일의 실행 계획
--   learner_day_plan_items   그 날의 항목 (노드를 펼친 결과)
--
-- drizzle 정의는 packages/db/src/schema/instruction.ts에 있다. 이 저장소는
-- drizzle-kit generate를 쓰지 않는다 — 스냅샷이 수기 마이그레이션(0006a~)이
-- 만든 테이블을 모르기 때문에 generate가 그것들을 통째로 재생성하려 든다.
-- 테이블·RLS·FK·트리거를 여기서 함께 관리한다 (2갈래 규약). 전부 멱등.
--
-- **이 마이그레이션은 기존 테이블을 하나도 바꾸지 않는다.** sessions와
-- learner_schedule_items는 계획층(①②)이고 여기 것은 실행층(③)이다.
-- 롤백은 아래 두 테이블 DROP으로 끝난다 — 그것이 3층 분리의 실무적 이득이다.
--
-- 백필하지 않는다: 과거 하루의 완주 여부는 어디에도 기록돼 있지 않아
-- 역산하면 추정치인데, completed_at은 불변으로 숙련도·일정 엔진까지
-- 흘러간다. 추정치를 불변 사실로 굳히는 것이 백필의 실제 의미다.
-- ============================================================

-- ── 1. enum ────────────────────────────────────────────────
do $$ begin
  create type public.learner_day_plan_source as enum
    ('learner_schedule', 'group_session', 'review_only');
exception when duplicate_object then null; end $$;

-- 'empty'는 저장하지 않는다 — 항목이 0건인 날은 화면이 파생으로 읽는다.
do $$ begin
  create type public.learner_day_plan_status as enum
    ('not_started', 'in_progress', 'blocked', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.learner_day_plan_item_kind as enum
    ('reading', 'video', 'practice', 'assessment', 'review', 'book_range', 'homework');
exception when duplicate_object then null; end $$;

-- blocked(고쳐야 할 사고)와 exempted(교사의 판단)를 합치지 않는다.
-- 합치면 자료를 안 올린 사고가 「면제됨」으로 위장된다 (ADR-0017 §2).
do $$ begin
  create type public.learner_day_plan_item_status as enum
    ('pending', 'in_progress', 'completed', 'blocked', 'exempted');
exception when duplicate_object then null; end $$;

-- ── 2. 테이블 ──────────────────────────────────────────────
create table if not exists public.learner_day_plans (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  learner_id        uuid not null,
  plan_date         date not null,
  timezone          text not null,
  learning_group_id uuid,
  source            public.learner_day_plan_source not null,
  source_ref_id     uuid,
  status            public.learner_day_plan_status not null default 'not_started',
  materialized_at   timestamptz not null default now(),
  completed_at      timestamptz,
  reopened_at       timestamptz,
  reopened_by       uuid,
  reopen_reason     text,
  projection_hash   text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.learner_day_plan_items (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null,
  learner_day_plan_id         uuid not null,
  item_key                    text not null,
  ordinal                     integer not null default 0,
  kind                        public.learner_day_plan_item_kind not null,
  required                    boolean not null,
  route_node_id               uuid,
  ref_type                    text,
  ref_id                      uuid,
  title_snapshot              text not null,
  status                      public.learner_day_plan_item_status not null default 'pending',
  blocked_reason              text,
  completed_at                timestamptz,
  added_after_materialization boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ── 3. 인덱스 ──────────────────────────────────────────────
-- 한 학생·한 날짜 계획은 하나. 재투영 경합에서 두 행이 생기는 것을 DB가 막는다.
create unique index if not exists learner_day_plans_uq
  on public.learner_day_plans (organization_id, learner_id, plan_date);

-- 교사 현황판(T4.4)이 날짜·상태로 훑는다.
create index if not exists learner_day_plans_date_status_idx
  on public.learner_day_plans (organization_id, plan_date, status);
create index if not exists learner_day_plans_group_date_idx
  on public.learner_day_plans (organization_id, learning_group_id, plan_date);

-- 재투영 멱등의 핵심 — UPSERT 대상 키.
create unique index if not exists learner_day_plan_items_uq
  on public.learner_day_plan_items (learner_day_plan_id, item_key);
create index if not exists learner_day_plan_items_order_idx
  on public.learner_day_plan_items (learner_day_plan_id, ordinal);

-- ── 4. FK ──────────────────────────────────────────────────
-- source_ref_id에는 FK를 걸지 않는다. 그것은 learner_schedule_items 또는
-- sessions 둘 중 하나를 가리키는 다형 참조이고, 반 일정 재실체화가 미래의
-- planned 수업을 지우고 다시 만들기 때문에(domain/schedule.ts) FK를 걸면
-- 실행층이 계획층의 재계산을 막게 된다 — 그것이 바로 3층을 나눈 이유에
-- 정면으로 어긋난다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'learner_day_plans_org_fk') then
    alter table public.learner_day_plans
      add constraint learner_day_plans_org_fk foreign key (organization_id)
      references public.organizations(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'learner_day_plans_learner_fk') then
    alter table public.learner_day_plans
      add constraint learner_day_plans_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'learner_day_plans_group_fk') then
    alter table public.learner_day_plans
      add constraint learner_day_plans_group_fk foreign key (learning_group_id)
      references public.learning_groups(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'learner_day_plan_items_org_fk') then
    alter table public.learner_day_plan_items
      add constraint learner_day_plan_items_org_fk foreign key (organization_id)
      references public.organizations(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'learner_day_plan_items_plan_fk') then
    alter table public.learner_day_plan_items
      add constraint learner_day_plan_items_plan_fk foreign key (learner_day_plan_id)
      references public.learner_day_plans(id) on delete cascade;
  end if;
end $$;

-- ── 5. 정합 제약 ───────────────────────────────────────────
do $$
begin
  -- 완료 상태와 완료 시각은 함께 간다. 한쪽만 있는 행은 만들지 않는다.
  if not exists (select 1 from pg_constraint where conname = 'learner_day_plans_completed_pair') then
    alter table public.learner_day_plans
      add constraint learner_day_plans_completed_pair
      check (status <> 'completed' or completed_at is not null);
  end if;

  -- 완료 취소는 완료된 적이 있어야 가능하다.
  if not exists (select 1 from pg_constraint where conname = 'learner_day_plans_reopen_needs_completion') then
    alter table public.learner_day_plans
      add constraint learner_day_plans_reopen_needs_completion
      check (reopened_at is null or completed_at is not null);
  end if;

  -- 차단이면 사유가 있어야 한다. 사유 없는 차단은 학생에게 「왜」를 못 준다.
  if not exists (select 1 from pg_constraint where conname = 'learner_day_plan_items_blocked_reason') then
    alter table public.learner_day_plan_items
      add constraint learner_day_plan_items_blocked_reason
      check (status <> 'blocked' or btrim(coalesce(blocked_reason, '')) <> '');
  end if;

  -- 항목 완료도 시각과 함께 간다.
  if not exists (select 1 from pg_constraint where conname = 'learner_day_plan_items_completed_pair') then
    alter table public.learner_day_plan_items
      add constraint learner_day_plan_items_completed_pair
      check (status <> 'completed' or completed_at is not null);
  end if;
end $$;

-- ── 6. 완료 불변 (I-22) ────────────────────────────────────
-- completed_at은 설정 후 변경·삭제되지 않는다. 교사의 완료 취소는
-- reopened_at을 더할 뿐 completed_at을 지우지 않는다 (ADR-0017 §6).
--
-- 왜 지우지 못하게 하는가: LearnerDayCompleted는 계획 1건당 최대 1회
-- 발행돼야 하고(I-22), 그 판정의 근거가 completed_at이다. 지우고 다시
-- 채우는 설계는 소비자(숙련도·일정 엔진)에게 같은 날을 두 번 흘려보낸다.
create or replace function public.forbid_learner_day_completion_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.completed_at is not null then
      raise exception '완료된 하루 계획은 삭제할 수 없다 (I-22) — plan %', old.id
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.completed_at is not null then
    if new.completed_at is distinct from old.completed_at then
      raise exception 'completed_at은 설정 후 변경할 수 없다 (I-22) — plan %', old.id
        using errcode = '42501';
    end if;
    -- 완료 상태에서 벗어나려면 반드시 완료 취소 기록을 남겨야 한다.
    if new.status <> 'completed' and new.reopened_at is null then
      raise exception '완료 취소는 reopened_at을 남겨야 한다 (ADR-0017 §6) — plan %', old.id
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists learner_day_plans_completion_immutable on public.learner_day_plans;
create trigger learner_day_plans_completion_immutable
before update or delete on public.learner_day_plans
for each row execute function public.forbid_learner_day_completion_mutation();

-- ── 7. 테넌트 격리 (0001a 2장과 같은 정책 모양) ────────────
alter table public.learner_day_plans enable row level security;
drop policy if exists learner_day_plans_org_isolation on public.learner_day_plans;
create policy learner_day_plans_org_isolation
  on public.learner_day_plans for all to authenticated
  using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

alter table public.learner_day_plan_items enable row level security;
drop policy if exists learner_day_plan_items_org_isolation on public.learner_day_plan_items;
create policy learner_day_plan_items_org_isolation
  on public.learner_day_plan_items for all to authenticated
  using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

comment on table public.learner_day_plans is
  '학생 하루 실행 계획(③). learner_schedule_items(②)를 대체하지 않는다 — ②는 재계산 가능한 계획층, ③은 완료 이력이 불변인 실행층. ADR-0018.';
comment on table public.learner_day_plan_items is
  '하루 계획 항목 — 루트 노드를 자료·평가·복습·숙제로 펼친 결과. (learner_day_plan_id, item_key)가 재투영 멱등 키.';
