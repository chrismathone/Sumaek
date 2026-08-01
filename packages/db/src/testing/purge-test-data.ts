import type { Sql } from "postgres";

/* ─────────────────────────────────────────────────────────────
 * 테스트 잔재 정리 — E2E·통합 테스트가 만든 행을 지운다.
 *
 * 앱에 삭제 UI가 없어(감사 기록이 append-only라 조직·학습 이력을 지우지
 * 않는 것이 제품 결정) E2E는 UI로 자기 뒷정리를 할 수 없다. 그래서 DB에서
 * 직접 정리하되, **불변 데이터를 건드리지 않는 범위**로 엄격히 제한한다.
 *
 * 지우지 않는 것 (설계상 불가):
 * - mastery_evidences·progress_events·audit_events — before update/delete
 *   트리거로 변경이 금지돼 있다. 그 부모(학습자·반)를 지우면 R-01 고아 참조가
 *   생기므로, **증거가 있는 학습자·반은 대상에서 제외한다.**
 * - 고정 ID 시드 행(00000000-…) — 데모 워크스페이스의 실제 데이터다.
 *
 * 대신 증거를 남긴 테스트 학습자는 status='archived'로 내려 목록 기본 화면에서
 * 빠지게 한다 (학습자 상태는 불변이 아니다).
 * ───────────────────────────────────────────────────────────── */

/** 테스트가 만든 행을 식별하는 이름 규칙 */
const LEARNER_NAME_PATTERNS = ["E2E%", "통합테스트%", "확인테스트%"];
const GROUP_NAME_PATTERN = "E2E%";
const CONCEPT_SLUG_PATTERNS = ["itest-%", "ctest-%"];
/**
 * E2E가 **시드 학습자**에게 붙이는 개별 경로 오버라이드 — 이름 규칙으로는
 * 잡히지 않는다(학습자 자체는 시드라 지우지 않으므로). 사유 문구로 고른다.
 *
 * 남겨 두면 실행마다 쌓여 다음 실행의 학생 경로를 오염시킨다. 화면의
 * 오버라이드 목록은 최근 10건만 보여 주므로 스펙이 UI로 다 취소할 수도
 * 없다 (실측: 31건이 활성으로 누적되어 학생 경로가 보충으로만 채워졌다).
 */
const OVERRIDE_REASON_PATTERNS = ["E2E%", "ITEST%", "%확인테스트 미통과 보충%"];
/** 시드가 만든 고정 ID 접두사 — 절대 지우지 않는다 */
const SEED_ID_PREFIX = "00000000-";

export interface PurgeResult {
  learnersDeleted: number;
  learnersArchived: number;
  groupsDeleted: number;
  routePlansDeleted: number;
  conceptsDeleted: number;
  contentRightsDeleted: number;
  /** E2E가 시드 학습자에게 붙인 개별 경로 오버라이드 (딸린 학습자 일정 포함) */
  learnerOverridesDeleted: number;
  /** dry-run이면 실제로 지우지 않고 셈만 한다 */
  dryRun: boolean;
}

/**
 * 테스트 잔재 정리. 같은 입력에 대해 몇 번 돌려도 결과가 같다(멱등).
 * @param organizationId 데모 워크스페이스 조직
 */
export async function purgeTestData(
  sql: Sql,
  organizationId: string,
  options: { dryRun?: boolean } = {},
): Promise<PurgeResult> {
  const dryRun = options.dryRun ?? false;

  return (await sql.begin(async (tx) => {
    /* ── 1. 지워도 되는 학습자 — 불변 증거가 전혀 없는 테스트 학습자 ── */
    const purgeableLearners = await tx<{ id: string }[]>`
      select l.id from learners l
      where l.organization_id = ${organizationId}
        and l.id::text not like ${`${SEED_ID_PREFIX}%`}
        and l.display_name like any(${LEARNER_NAME_PATTERNS}::text[])
        and not exists (select 1 from attempts a where a.learner_id = l.id)
        and not exists (select 1 from mastery_evidences e where e.learner_id = l.id)
        and not exists (select 1 from progress_events p where p.learner_id = l.id)
    `;
    const learnerIds = purgeableLearners.map((r) => r.id);

    /* ── 2. 지워도 되는 반 — 평가·불변 이벤트가 전혀 없는 E2E 반 ── */
    const purgeableGroups = await tx<{ id: string }[]>`
      select g.id from learning_groups g
      where g.organization_id = ${organizationId}
        and g.id::text not like ${`${SEED_ID_PREFIX}%`}
        and g.name like ${GROUP_NAME_PATTERN}
        and not exists (
          select 1 from assessment_instances i where i.learning_group_id = g.id)
        and not exists (
          select 1 from progress_events p where p.learning_group_id = g.id)
    `;
    const groupIds = purgeableGroups.map((r) => r.id);

    /* ── 3. 증거가 있어 지울 수 없는 테스트 학습자는 보관 처리 ── */
    const archivable = await tx<{ id: string }[]>`
      select l.id from learners l
      where l.organization_id = ${organizationId}
        and l.id::text not like ${`${SEED_ID_PREFIX}%`}
        and l.display_name like any(${LEARNER_NAME_PATTERNS}::text[])
        and l.status <> 'archived'
        and (exists (select 1 from attempts a where a.learner_id = l.id)
             or exists (select 1 from mastery_evidences e where e.learner_id = l.id)
             or exists (select 1 from progress_events p where p.learner_id = l.id))
    `;

    /* ── 4. 지울 루트 — 대상 반·학습자에 매인 것만 ── */
    const purgeablePlans =
      groupIds.length + learnerIds.length === 0
        ? []
        : await tx<{ id: string }[]>`
            select p.id from route_plans p
            where p.organization_id = ${organizationId}
              and (p.learning_group_id = any(${groupIds}::uuid[])
                   or p.learner_id = any(${learnerIds}::uuid[]))
          `;
    const planIds = purgeablePlans.map((r) => r.id);

    /* ── 4b. E2E가 시드 학습자에게 붙인 오버라이드 ── */
    const purgeableOverrides = await tx<{ id: string; learner_id: string }[]>`
      select o.id, o.learner_id from student_route_overrides o
      where o.organization_id = ${organizationId}
        and o.reason like any(${OVERRIDE_REASON_PATTERNS}::text[])
    `;

    const result: PurgeResult = {
      learnersDeleted: learnerIds.length,
      learnersArchived: archivable.length,
      groupsDeleted: groupIds.length,
      routePlansDeleted: planIds.length,
      conceptsDeleted: 0,
      contentRightsDeleted: 0,
      learnerOverridesDeleted: purgeableOverrides.length,
      dryRun,
    };

    /* ── 5. 지울 개념·사용권 — 증거·문항이 걸리지 않은 것만 ── */
    const purgeableConcepts = await tx<{ id: string }[]>`
      select c.id from canonical_concepts c
      where c.slug like any(${CONCEPT_SLUG_PATTERNS}::text[])
        and not exists (select 1 from mastery_evidences e where e.concept_id = c.id)
        and not exists (select 1 from question_alignments qa where qa.concept_id = c.id)
        and not exists (select 1 from concept_edges e
                         where e.from_concept_id = c.id or e.to_concept_id = c.id)
    `;
    result.conceptsDeleted = purgeableConcepts.length;

    if (dryRun) return result;

    /* ── 실행: 자식 → 부모 순서 (R-01 고아 참조 방지) ── */
    if (planIds.length > 0) {
      const versions = await tx<{ id: string }[]>`
        select id from route_versions where route_plan_id = any(${planIds}::uuid[])`;
      const versionIds = versions.map((v) => v.id);
      if (versionIds.length > 0) {
        await tx`delete from route_dependencies where route_version_id = any(${versionIds}::uuid[])`;
        await tx`delete from route_nodes where route_version_id = any(${versionIds}::uuid[])`;
        await tx`delete from student_route_overrides where base_route_version_id = any(${versionIds}::uuid[])`;
      }
      await tx`delete from route_publications where route_plan_id = any(${planIds}::uuid[])`;
      await tx`delete from route_versions where route_plan_id = any(${planIds}::uuid[])`;
      await tx`delete from route_plans where id = any(${planIds}::uuid[])`;
    }

    if (groupIds.length > 0) {
      await tx`delete from learning_availability_events where learning_group_id = any(${groupIds}::uuid[])`;
      // sessions보다 먼저 — 학생 항목이 수업을 참조한다 (R-01 고아 참조 방지)
      await tx`delete from learner_schedule_items where learning_group_id = any(${groupIds}::uuid[])`;
      await tx`delete from sessions where learning_group_id = any(${groupIds}::uuid[])`;
      await tx`delete from learning_group_memberships where learning_group_id = any(${groupIds}::uuid[])`;
      await tx`delete from holidays where learning_group_id = any(${groupIds}::uuid[])`;
      await tx`delete from calendar_rules where subject_type = 'learning_group' and subject_id = any(${groupIds}::uuid[])`;
      await tx`delete from learning_groups where id = any(${groupIds}::uuid[])`;
    }

    if (learnerIds.length > 0) {
      await tx`delete from review_items where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from retry_plans where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from makeup_sessions where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from concept_masteries where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from assignments where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from student_route_overrides where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from learner_schedule_items where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from learning_availability_events where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from data_deletion_requests where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from learning_group_memberships where learner_id = any(${learnerIds}::uuid[])`;
      await tx`delete from learners where id = any(${learnerIds}::uuid[])`;
    }

    /* E2E 오버라이드와 그것으로 만들어진 학생 일정. 항목을 함께 지워야
     * 다음 실행이 "아직 계산하지 않았습니다"에서 시작한다 — 오버라이드만
     * 지우면 옛 보충 차시가 남아 다음 실행의 표를 오염시킨다. */
    if (purgeableOverrides.length > 0) {
      const overrideLearnerIds = [
        ...new Set(purgeableOverrides.map((r) => r.learner_id)),
      ];
      await tx`
        delete from learner_schedule_items
        where organization_id = ${organizationId}
          and learner_id = any(${overrideLearnerIds}::uuid[])
      `;
      await tx`
        delete from student_route_overrides
        where id = any(${purgeableOverrides.map((r) => r.id)}::uuid[])
      `;
    }

    if (archivable.length > 0) {
      await tx`
        update learners set status = 'archived', updated_at = now()
        where id = any(${archivable.map((r) => r.id)}::uuid[])`;
    }

    if (purgeableConcepts.length > 0) {
      await tx`delete from canonical_concepts
               where id = any(${purgeableConcepts.map((r) => r.id)}::uuid[])`;
    }

    /* 사용권 — 문항이 하나도 걸리지 않은 테스트 사용권만 */
    const rights = await tx<{ id: string }[]>`
      delete from content_rights r
      where r.organization_id = ${organizationId}
        and r.id::text not like ${`${SEED_ID_PREFIX}%`}
        and (r.rights_holder like '%테스트%' or r.rights_holder like '%통합%')
        and not exists (select 1 from questions q where q.content_right_id = r.id)
      returning r.id`;
    result.contentRightsDeleted = rights.length;

    return result;
  })) as PurgeResult;
}
