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
/**
 * E2E가 저작 화면에서 만드는 학습 자료 — 제목으로 고른다.
 *
 * 남겨 두면 실행마다 **게시된** 자료가 시드 개념에 쌓이고, 그 개념을 배우는
 * 날 데모 학생의 「오늘 학습」에 테스트 쓰레기가 그대로 나온다 (실측: 세 번
 * 돌리자 게시 자료 3건이 학생 화면에 실렸다). 자료는 불변 데이터가 아니므로
 * 진도와 함께 지운다.
 */
const MATERIAL_TITLE_PATTERN = "E2E자료-%";
/** 시드가 만든 고정 ID 접두사 — 절대 지우지 않는다 */
const SEED_ID_PREFIX = "00000000-";
/**
 * 데모 학생 계정과 그 계정이 붙어 있어야 할 시드 학습자.
 *
 * learner-flow 통합 테스트가 이 계정을 잠시 **빌려** 쓴다(학생 로그인 경로를
 * 검증할 다른 방법이 없다). 그 스펙은 afterAll에서 무조건 돌려주지만,
 * 프로세스가 중간에 죽거나 두 실행이 겹치면 계정이 테스트 학습자에게 붙은
 * 채로 남는다 — 실측으로 겪었다. 그러면 학생 화면이 통째로 빈 상태가 되어
 * E2E가 로그인부터가 아니라 **한참 뒤 엉뚱한 단언에서** 깨져 원인을 찾기
 * 어렵다. 뒷정리가 돌 때마다 제자리로 돌려놓는다.
 */
const DEMO_STUDENT_EMAIL = "demo-student@su-maek.app";
const DEMO_STUDENT_LEARNER = "00000000-0000-7000-8000-000000000101";

export interface PurgeResult {
  learnersDeleted: number;
  learnersArchived: number;
  /** 데모 학생 계정을 시드 학습자에게 되돌렸는가 (빌린 채 죽은 실행 복구) */
  demoAccountRestored: boolean;
  groupsDeleted: number;
  routePlansDeleted: number;
  conceptsDeleted: number;
  /**
   * 지울 수 없어서 **폐기 처리**한 개념 — 증거·문항이 걸려 삭제가 막힌 것들.
   * 그냥 두면 조직 스코프가 없는 canonical_concepts라 모든 학원의 개념
   * 선택 목록을 덮는다 (실측: 190건이 쌓여 교사 드롭다운 기본 20개가
   * 전부 테스트 찌꺼기였다). 지울 수 없으면 최소한 목록에서는 빼야 한다.
   */
  conceptsDeprecated: number;
  contentRightsDeleted: number;
  /** E2E가 시드 학습자에게 붙인 개별 경로 오버라이드 (딸린 학습자 일정 포함) */
  learnerOverridesDeleted: number;
  /** E2E가 저작 화면에서 만든 학습 자료 (딸린 진도 포함) */
  materialsDeleted: number;
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

    /* ── 4c. E2E가 저작 화면에서 만든 학습 자료 ── */
    const purgeableMaterials = await tx<{ id: string }[]>`
      select m.id from learning_materials m
      where m.organization_id = ${organizationId}
        and m.id::text not like ${`${SEED_ID_PREFIX}%`}
        and m.title like ${MATERIAL_TITLE_PATTERN}
    `;

    /* 데모 학생 계정이 시드 학습자를 떠나 있으면 되돌린다 (빌린 채 죽은 실행) */
    const [strayDemo] = await tx<{ id: string; user_id: string }[]>`
      select l.id, l.user_id::text as user_id
      from learners l
      join users u on u.id = l.user_id
      where l.organization_id = ${organizationId}
        and u.email = ${DEMO_STUDENT_EMAIL}
        and l.id <> ${DEMO_STUDENT_LEARNER}
      limit 1
    `;

    const result: PurgeResult = {
      learnersDeleted: learnerIds.length,
      learnersArchived: archivable.length,
      demoAccountRestored: Boolean(strayDemo),
      groupsDeleted: groupIds.length,
      routePlansDeleted: planIds.length,
      conceptsDeleted: 0,
      conceptsDeprecated: 0,
      contentRightsDeleted: 0,
      learnerOverridesDeleted: purgeableOverrides.length,
      materialsDeleted: purgeableMaterials.length,
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

    /* 지울 수 없는 테스트 개념 — 증거(불변)나 문항이 걸려 있다. 삭제 대신
     * 폐기 처리한다. 화면의 개념 선택은 status in ('reviewed','active')로
     * 좁히므로 이것만으로 목록에서 사라지고, 증거는 그대로 남는다. */
    const deprecatableConcepts = await tx<{ id: string }[]>`
      select c.id from canonical_concepts c
      where c.slug like any(${CONCEPT_SLUG_PATTERNS}::text[])
        and c.status <> 'deprecated'
        and not (c.id = any(${purgeableConcepts.map((r) => r.id)}::uuid[]))
    `;
    result.conceptsDeprecated = deprecatableConcepts.length;

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
      /* 고정 ID 시드 행은 남긴다 — 이 파일의 원칙 그대로(위 머리말: 고정 ID
       * 시드 행은 데모 워크스페이스의 실제 데이터다). 지워야 하는 것은 스펙이
       * 계산으로 만든 항목(uuidv7)이지 시드가 심은 항목이 아니다.
       *
       * 다만 이것만으로 시드 항목이 안전해지지는 않는다: 「개별 일정 계산」은
       * 오늘 이후의 미배정 항목을 교체하므로 시드 항목도 정상적으로 지운다
       * (materializeLearnerSchedule의 과거 보존 가드 참고). 여기서 하는 일은
       * **뒷정리가 그것까지 대신 지우지는 않게** 하는 것뿐이다. */
      await tx`
        delete from learner_schedule_items
        where organization_id = ${organizationId}
          and learner_id = any(${overrideLearnerIds}::uuid[])
          and id::text not like ${`${SEED_ID_PREFIX}%`}
      `;
      await tx`
        delete from student_route_overrides
        where id = any(${purgeableOverrides.map((r) => r.id)}::uuid[])
      `;
    }

    /* 자료보다 진도를 먼저 — 진도가 자료를 참조한다 (R-01 고아 참조 방지) */
    if (purgeableMaterials.length > 0) {
      const materialIds = purgeableMaterials.map((r) => r.id);
      await tx`delete from learner_material_progress
               where material_id = any(${materialIds}::uuid[])`;
      await tx`delete from learning_materials where id = any(${materialIds}::uuid[])`;
    }

    if (archivable.length > 0) {
      await tx`
        update learners set status = 'archived', updated_at = now()
        where id = any(${archivable.map((r) => r.id)}::uuid[])`;
    }

    if (strayDemo) {
      // 떼어 내고 → 붙인다. 한 계정이 두 학습자에 걸리지 않게 순서가 중요하다.
      await tx`
        update learners set user_id = null, updated_at = now()
        where id = ${strayDemo.id}`;
      await tx`
        update learners set user_id = ${strayDemo.user_id}, updated_at = now()
        where id = ${DEMO_STUDENT_LEARNER} and organization_id = ${organizationId}`;
      await tx`
        update memberships set status = 'active', updated_at = now()
        where organization_id = ${organizationId} and user_id = ${strayDemo.user_id}`;
    }

    if (purgeableConcepts.length > 0) {
      await tx`delete from canonical_concepts
               where id = any(${purgeableConcepts.map((r) => r.id)}::uuid[])`;
    }

    if (deprecatableConcepts.length > 0) {
      await tx`
        update canonical_concepts set status = 'deprecated', updated_at = now()
        where id = any(${deprecatableConcepts.map((r) => r.id)}::uuid[])`;
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
