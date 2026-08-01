-- ============================================================
-- 0006a — 학습자 스코프 일정 항목의 RLS·FK·시간 충돌 제약 (인수 4)
-- 0005_modern_iron_patriot.sql이 만든 learner_schedule_items를 보강한다.
-- drizzle이 표현하지 못하는 것(RLS·EXCLUDE·FK)만 여기서 관리한다 (2갈래 규약).
-- 전부 멱등.
-- ============================================================

-- ── 1. 테넌트 격리 (0001a 2장과 같은 정책 모양) ──────────────
alter table public.learner_schedule_items enable row level security;
drop policy if exists learner_schedule_items_org_isolation
  on public.learner_schedule_items;
create policy learner_schedule_items_org_isolation
  on public.learner_schedule_items for all to authenticated
  using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- ── 2. FK ────────────────────────────────────────────────────
-- session_id만 on delete set null이다. 반 공통 재실체화는 미래의 잠기지 않은
-- planned 수업을 지우고 다시 만드는데(domain/schedule.ts), 기본 NO ACTION이면
-- 학생 항목 하나 때문에 반 일정 재계산이 통째로 실패한다. 학생 스코프가 반
-- 스코프를 막는 것은 불변 조건 4(오버라이드는 반에 영향이 없다) 위반이다.
-- 링크가 끊긴 항목은 학생 일정을 다시 계산할 때 복구된다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'learner_schedule_items_org_fk'
  ) then
    alter table public.learner_schedule_items
      add constraint learner_schedule_items_org_fk foreign key (organization_id)
      references public.organizations(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'learner_schedule_items_learner_fk'
  ) then
    alter table public.learner_schedule_items
      add constraint learner_schedule_items_learner_fk foreign key (learner_id)
      references public.learners(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'learner_schedule_items_group_fk'
  ) then
    alter table public.learner_schedule_items
      add constraint learner_schedule_items_group_fk foreign key (learning_group_id)
      references public.learning_groups(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'learner_schedule_items_session_fk'
  ) then
    alter table public.learner_schedule_items
      add constraint learner_schedule_items_session_fk foreign key (session_id)
      references public.sessions(id) on delete set null;
  end if;
end $$;

-- ── 3. 학습자 시간 충돌 하드 제약 (불변 조건 6) ──────────────
-- sessions_group_no_overlap은 반 단위라 학생 단위 겹침을 잡지 못한다
-- (invariants.sql I-06 주석: "학생 충돌은 DB 제약이 없다"). 학습자 스코프
-- 일정에는 학생 단위로 걸 수 있다 — 한 학생이 같은 시각에 두 곳에 있을 수 없다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'learner_schedule_items_no_overlap'
  ) then
    alter table public.learner_schedule_items
      add constraint learner_schedule_items_no_overlap
      exclude using gist (
        organization_id with =,
        learner_id with =,
        tstzrange(starts_at, ends_at) with &&
      );
  end if;
end $$;
