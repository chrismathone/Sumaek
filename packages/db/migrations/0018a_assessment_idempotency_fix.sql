-- ============================================================
-- 0018a — 반 공통 평가의 생성 멱등 (G-15)
--
-- 문제: `assessments_idempotent_uq`는 (조직·반·학습자·날짜·목적)에 걸려
-- 있는데 `learning_group_id`와 `learner_id`가 둘 다 nullable이다.
-- PostgreSQL은 유니크 인덱스에서 NULL을 서로 다른 값으로 보므로,
-- **반 공통 평가(learner_id IS NULL)는 같은 조합으로 몇 개든 들어간다.**
-- 자동 생성이 가장 많이 만들 바로 그 평가에 인덱스가 아무 일도 하지 않는다.
--
-- 지금 사고로 안 보이는 이유는 생성 코드가 INSERT 전에 SELECT로 확인하기
-- 때문이다(assessment-generation.ts). 그것은 SELECT-then-INSERT 경합이라,
-- 워커에 재시도·재시작이 붙는 순간(T3.2) 같은 경로가 동시에 두 번 돈다.
--
-- ── 왜 coalesce로 전체를 덮지 않는가 ────────────────────────
-- 처음에는 NULL을 고정 UUID로 접어 인덱스 하나로 덮으려 했다. 그렇게 하면
-- **한 학생에게 같은 날 서로 다른 평가 둘**도 막힌다. 실측으로 그런 행이
-- 40건 있었고(개별 학습자 대상, 반 없음), 그것은 결손이 아니라 정당한
-- 사용이다 — 보충·재시험은 학생 단위로 여러 개가 나올 수 있다.
--
-- 막아야 할 것은 **반 공통 생성물의 중복** 하나다. 그래서 그 경우에만
-- 걸리는 부분 유니크를 더한다. 기존 인덱스는 (반·학생이 모두 있는) 경우를
-- 여전히 덮으므로 그대로 둔다.
--
-- 근거: ADR-0018 §5, docs/phase0/sequences.md S-3.
-- 멱등하다.
-- ============================================================

-- ── 1. 기존 반 공통 중복 확인 ──────────────────────────────
-- 데이터를 자동으로 지우지 않는다. 평가는 학습 이력이고 응시·채점이 매여
-- 있어, 어느 쪽이 진짜인지는 사람이 판단해야 한다.
do $$
declare
  dup record;
  dup_count int := 0;
  detail text := '';
begin
  for dup in
    select organization_id, learning_group_id, scheduled_date, purpose, count(*) as cnt
    from public.assessment_instances
    where status <> 'cancelled'
      and scheduled_date is not null
      and learner_id is null
      and learning_group_id is not null
    group by 1, 2, 3, 4
    having count(*) > 1
  loop
    dup_count := dup_count + 1;
    detail := detail || format(E'\n  반=%s 날짜=%s 목적=%s → %s건',
                               dup.learning_group_id, dup.scheduled_date,
                               dup.purpose, dup.cnt);
  end loop;

  if dup_count > 0 then
    raise exception E'반 공통 중복 평가 %건이 있어 멱등 인덱스를 만들 수 없다.%\n\n남길 것 외에는 status=''cancelled''로 바꾼 뒤 다시 실행하세요 — 삭제하지 마세요(응시·채점이 매여 있습니다).',
      dup_count, detail
      using errcode = '23505';
  end if;
end $$;

-- ── 2. 반 공통 생성물의 유일성 ─────────────────────────────
create unique index if not exists assessments_group_idempotent_uq
  on public.assessment_instances (
    organization_id, learning_group_id, scheduled_date, purpose
  )
  where status <> 'cancelled'
    and scheduled_date is not null
    and learner_id is null
    and learning_group_id is not null;

comment on index public.assessments_group_idempotent_uq is
  '반 공통 평가 자동 생성의 둘째 겹 멱등 (G-15). 기존 assessments_idempotent_uq는 learner_id가 nullable이라 NULL끼리 서로 다르게 취급되어 이 경우를 전혀 막지 못한다. 학생 단위 평가(보충·재시험)는 같은 날 여럿이 정당하므로 여기 포함하지 않는다 — ADR-0018 §5.';
