-- ─────────────────────────────────────────────────────────────
-- 무결성 가드 보강 + 일회성 복구
-- 근거: packages/db/src/checks/invariants.sql (I-15·R-01·R-06) 실측 위반.
-- verify-recovery 하네스가 실DB에서 발견한 세 가지를 고친다.
-- ─────────────────────────────────────────────────────────────

-- 1) grade_decisions append-only 가드 (ADR-0015 — audit·evidences와 동급).
--    유일한 허용 변경: 새 결정으로 대체될 때 is_final true→false 해제
--    (grade_decisions_final_uq 부분 유니크 때문에 대체 전 해제가 필수다).
--    그 밖의 UPDATE·모든 DELETE는 거부한다.
create or replace function public.forbid_grade_decision_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'grade_decisions is append-only — 삭제 금지 (ADR-0015)'
      using errcode = '42501';
  end if;
  if old.is_final = true and new.is_final = false
     and new.id is not distinct from old.id
     and new.organization_id is not distinct from old.organization_id
     and new.response_id is not distinct from old.response_id
     and new.version is not distinct from old.version
     and new.source is not distinct from old.source
     and new.is_correct is not distinct from old.is_correct
     and new.score is not distinct from old.score
     and new.max_score is not distinct from old.max_score
     and new.rubric_breakdown is not distinct from old.rubric_breakdown
     and new.confidence is not distinct from old.confidence
     and new.rationale is not distinct from old.rationale
     and new.decided_by is not distinct from old.decided_by
     and new.grader_version is not distinct from old.grader_version
     and new.supersedes_id is not distinct from old.supersedes_id
     and new.change_reason is not distinct from old.change_reason
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;
  raise exception 'grade_decisions는 대체(is_final 해제) 외 수정 금지 (ADR-0015)'
    using errcode = '42501';
end $$;

drop trigger if exists grade_decisions_immutable on public.grade_decisions;
create trigger grade_decisions_immutable
before update or delete on public.grade_decisions
for each row execute function public.forbid_grade_decision_mutation();

-- 2) 일회성 복구 — 통합 테스트 잔재 고아 증거 제거.
--    과거 통합 테스트가 grade_decisions를 지우면서 불변 mastery_evidences가
--    고아가 됐다 (R-01 실측 9행). 파기는 마이그레이션 경로로만 한다는
--    ADR-0015 §3 원칙에 따라 여기서만 트리거를 잠시 내린다.
--    (테스트는 이제 append-only 사슬을 지우지 않도록 고쳐졌다.)
alter table public.mastery_evidences disable trigger mastery_evidences_immutable;
delete from public.mastery_evidences e
where e.grade_decision_id is not null
  and not exists (
    select 1 from public.grade_decisions d where d.id = e.grade_decision_id
  );
alter table public.mastery_evidences enable trigger mastery_evidences_immutable;

-- 3) 일회성 복구 — 로컬 시계 혼용이 남긴 시각 역행 정정 (R-06 실측 1행).
--    submitted_at은 DB now(), finalized_at은 앱 로컬 시각으로 기록되던 시기의
--    잔재다 (도메인은 이미 DB 시계로 통일됨). 확정 시각을 제출 시각으로 맞춘다.
update public.attempts
set finalized_at = submitted_at
where submitted_at is not null
  and finalized_at is not null
  and finalized_at < submitted_at;
