-- ============================================================
-- 0010a — 복습 항목에 망각곡선 상태 (에빙하우스)
--
-- `review_items`에 안정성·반복 회차·실패 횟수·마지막 복습일을 더한다.
--
-- 왜 필요한가: 지금까지 간격 반복은 **작동한 적이 없다.** `nextReviewDate`가
-- 돌려주던 `stage`를 저장할 컬럼이 없어(ERD의 repetition_no 미구현) 호출부가
-- 언제나 stage=0으로만 불렀고, 결과적으로 모든 복습이 `interval_days = 1`,
-- `due_on = 다음날`로만 태어났다. 단계가 오를 수 없는 구조였다.
--
-- 왜 concept_masteries가 아니라 여기인가: **복습 결과는 숙련도 증거가 아니다**
-- (불변 조건 10 — "평가 1건 = 증거 1건"). 복습 성패로 숙련도를 움직이면 그
-- 규칙이 깨진다. 복습 스케줄 상태는 복습 항목이 갖는 것이 맞다.
--
-- 전부 nullable/기본값이라 기존 행이 깨지지 않는다. drizzle 정의는
-- packages/db/src/schema/learning.ts. 멱등.
-- ============================================================

alter table public.review_items
  add column if not exists stability_days numeric(6,2),
  add column if not exists repetition_no integer not null default 0,
  add column if not exists lapse_count integer not null default 0,
  add column if not exists last_reviewed_on date;

comment on column public.review_items.stability_days is
  '망각곡선 안정성 S(일) — 지금 복습하면 목표 유지율까지 버티는 일수. R(t)=exp(-t·ln(1/θ)/S)';
comment on column public.review_items.repetition_no is
  '몇 번째 복습인가 (0 = 아직 한 번도 안 봄)';
comment on column public.review_items.lapse_count is
  '이 항목을 놓친 누적 횟수 — 틀릴 때마다 증가';
comment on column public.review_items.last_reviewed_on is
  '마지막으로 실제 복습한 날 — 예측 기억률 계산의 기준점. null이면 아직 안 봄';

/* 안정성은 양수여야 한다. 0이나 음수가 들어오면 R 계산이 발산하거나
 * 간격이 과거가 된다 — 코드가 막지만 DB도 최후 방어선을 둔다. */
alter table public.review_items
  drop constraint if exists review_items_stability_positive_ck;
alter table public.review_items
  add constraint review_items_stability_positive_ck
  check (stability_days is null or stability_days > 0);

/* 기존 행 보정 — 전부 `interval_days = 1`로 태어났으므로 안정성 1일로 본다.
 * 지어내지 않는다: 실제로 그 값이 그 항목의 유일한 이력이다. */
update public.review_items
set stability_days = coalesce(interval_days, 1)::numeric
where stability_days is null;

/* 출제·복습 조회가 기한 도래분을 안정성과 함께 읽는다 — 기존 인덱스에
 * 얹지 않고 별도로 둔다(기존 인덱스는 status·due_on 순서가 다르다). */
create index if not exists review_items_due_stability_idx
  on public.review_items (organization_id, learner_id, due_on)
  where status = 'scheduled';
