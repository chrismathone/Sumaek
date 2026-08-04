import { getSharedSql } from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 단계형 온보딩 (T5.1 · G-07).
 *
 * 새 학원이 로그인하면 빈 화면 열두 개를 만난다. 무엇부터 해야 하는지는
 * 어디에도 없고, 순서를 틀리면 「반을 먼저 만드세요」 같은 오류가 화면
 * 깊숙한 곳에서 나온다 — 사용자는 자기가 틀렸다고 느낀다.
 *
 * 진행률은 **전부 서버 상태에서 파생한다.** 세션이나 로컬 저장소에 두면
 * 새로고침·로그아웃으로 사라지고, 사라진 진행률은 「처음부터 다시」로
 * 보인다. 파생이면 어디서 로그인하든 같은 자리로 돌아온다 — 「중단 후
 * 재개」를 위해 따로 저장할 것이 없다는 뜻이다.
 *
 * 판정과 질의를 나눠 둔다: 위쪽 순수 함수는 DB 없이 테스트되고, 아래쪽은
 * 그 함수가 먹을 수치를 세는 일만 한다.
 * ───────────────────────────────────────────────────────────── */

export type SetupStepId =
  | "course_period"
  | "learning_group"
  | "learners"
  | "accounts"
  | "route"
  | "materials"
  | "assessment_policy"
  | "readiness";

/** 배우는 순서가 아니라 **만드는 순서**다 — 앞이 없으면 뒤를 만들 수 없다. */
export const SETUP_STEP_ORDER: readonly SetupStepId[] = [
  "course_period",
  "learning_group",
  "learners",
  "accounts",
  "route",
  "materials",
  "assessment_policy",
  "readiness",
];

/** 서버에서 센 수치. 판정에 필요한 것만 — 화면이 쓸 값은 각 화면이 따로 읽는다. */
export interface SetupFacts {
  coursePeriods: number;
  learningGroups: number;
  learners: number;
  learnersWithAccount: number;
  publishedRoutes: number;
  materials: number;
  assessmentPolicies: number;
  /** 준비도 게이트(T2.4)가 잡은 차단 건수 */
  readinessBlocking: number;
}

export interface SetupStep {
  id: SetupStepId;
  title: string;
  done: boolean;
  /** 왜 아직인지 — 수치로 말한다. 「미완료」로 끝내면 무엇을 더 해야 할지 모른다. */
  detail: string;
  href: string;
  /** 앞 단계가 안 끝나 지금은 할 수 없다. 눌러서 실패하기 전에 말한다. */
  blockedBy: SetupStepId | null;
}

export interface SetupProgress {
  steps: SetupStep[];
  /** 지금 할 차례. 전부 끝났으면 null. */
  next: SetupStep | null;
  doneCount: number;
  complete: boolean;
}

/** 이 단계를 하려면 먼저 끝나 있어야 하는 단계. */
const REQUIRES: Readonly<Partial<Record<SetupStepId, SetupStepId>>> = {
  learning_group: "course_period",
  learners: "learning_group",
  accounts: "learners",
  route: "learning_group",
  materials: "route",
  assessment_policy: "learning_group",
  readiness: "materials",
};

export function buildSetupProgress(facts: SetupFacts): SetupProgress {
  const remainingAccounts = Math.max(
    0,
    facts.learners - facts.learnersWithAccount,
  );

  const spec: Record<SetupStepId, Omit<SetupStep, "id" | "blockedBy">> = {
    course_period: {
      title: "과정 기간 만들기",
      done: facts.coursePeriods > 0,
      detail:
        facts.coursePeriods > 0
          ? `기간 ${facts.coursePeriods}개`
          : "학기·분기처럼 반이 속할 기간이 먼저 있어야 합니다.",
      href: "/app/calendar",
    },
    learning_group: {
      title: "반 만들기",
      done: facts.learningGroups > 0,
      detail:
        facts.learningGroups > 0
          ? `반 ${facts.learningGroups}개`
          : "학생과 일정이 붙을 자리입니다.",
      href: "/app/classes",
    },
    learners: {
      title: "학생 등록",
      done: facts.learners > 0,
      detail: facts.learners > 0 ? `학생 ${facts.learners}명` : "아직 없습니다.",
      href: "/app/students",
    },
    accounts: {
      /* 「발급함」이 아니라 「전부 발급됨」이다. 한 명이 로그인 못 하는 것은
       * 그 학생에게 100%다. */
      title: "학생 로그인 계정 연결",
      done: facts.learners > 0 && remainingAccounts === 0,
      detail:
        facts.learners === 0
          ? "학생을 먼저 등록하세요."
          : remainingAccounts === 0
            ? `${facts.learners}명 전부 연결됨`
            : `${remainingAccounts}명이 아직 로그인할 수 없습니다.`,
      href: "/app/students",
    },
    route: {
      title: "학습 루트 게시",
      done: facts.publishedRoutes > 0,
      detail:
        facts.publishedRoutes > 0
          ? `게시된 루트 ${facts.publishedRoutes}개`
          : "무엇을 어떤 순서로 나갈지 정하고 게시해야 일정이 생깁니다.",
      href: "/app/routes",
    },
    materials: {
      title: "학습 자료 등록",
      done: facts.materials > 0,
      detail:
        facts.materials > 0
          ? `자료 ${facts.materials}건`
          : "자료가 없으면 학생 화면이 빈 채로 열립니다.",
      href: "/app/content/materials",
    },
    assessment_policy: {
      /* 정책이 없으면 자동 생성이 첫 실행에서 실패한다 (T3.3에서 실측).
       * 기본 정책은 반을 만들 때 함께 만들어지므로 대개 이미 끝나 있다. */
      title: "평가 정책 확인",
      done: facts.assessmentPolicies > 0,
      detail:
        facts.assessmentPolicies > 0
          ? `정책 ${facts.assessmentPolicies}개`
          : "일일·확인테스트 자동 생성에 필요합니다.",
      href: "/app/settings",
    },
    readiness: {
      title: "학생 화면 준비도 확인",
      done: facts.materials > 0 && facts.readinessBlocking === 0,
      detail:
        facts.readinessBlocking > 0
          ? `학생이 할 수 없는 항목 ${facts.readinessBlocking}건이 남아 있습니다.`
          : facts.materials > 0
            ? "차단 항목 없음"
            : "자료를 먼저 등록하세요.",
      href: "/app/routes",
    },
  };

  const doneById = new Map<SetupStepId, boolean>();
  for (const id of SETUP_STEP_ORDER) doneById.set(id, spec[id].done);

  const steps: SetupStep[] = SETUP_STEP_ORDER.map((id) => {
    const required = REQUIRES[id] ?? null;
    return {
      id,
      ...spec[id],
      blockedBy: required && !doneById.get(required) ? required : null,
    };
  });

  /* 다음 할 일은 **차단되지 않은 첫 미완료**다. 순서대로 첫 미완료를 고르면
   * 앞이 막힌 단계를 「할 차례」라고 말하게 된다. */
  const next = steps.find((s) => !s.done && s.blockedBy === null) ?? null;
  const doneCount = steps.filter((s) => s.done).length;

  return {
    steps,
    next,
    doneCount,
    /* 뒤 단계가 먼저 충족돼도 앞이 비면 완료가 아니다 — 시드나 손으로 만든
     * 자료 때문에 그런 상태가 실제로 생긴다. */
    complete: doneCount === steps.length,
  };
}

/** 서버 상태에서 수치를 센다. 진행률을 어디에도 저장하지 않는 이유다. */
export async function loadSetupFacts(
  organizationId: string,
): Promise<SetupFacts> {
  const sql = getSharedSql();
  const [row] = await sql<
    {
      course_periods: number;
      learning_groups: number;
      learners: number;
      learners_with_account: number;
      published_routes: number;
      materials: number;
      assessment_policies: number;
    }[]
  >`
    select
      (select count(*)::int from course_periods
        where organization_id = ${organizationId}) as course_periods,
      (select count(*)::int from learning_groups
        where organization_id = ${organizationId} and status <> 'archived')
        as learning_groups,
      (select count(*)::int from learners
        where organization_id = ${organizationId} and status = 'active') as learners,
      (select count(*)::int from learners
        where organization_id = ${organizationId} and status = 'active'
          and user_id is not null) as learners_with_account,
      (select count(*)::int from route_plans
        where organization_id = ${organizationId} and active_version_id is not null)
        as published_routes,
      (select count(*)::int from learning_materials
        where organization_id = ${organizationId} and status = 'published') as materials,
      (select count(*)::int from assessment_policies
        where organization_id = ${organizationId} and is_active = true)
        as assessment_policies
  `;

  return {
    coursePeriods: row?.course_periods ?? 0,
    learningGroups: row?.learning_groups ?? 0,
    learners: row?.learners ?? 0,
    learnersWithAccount: row?.learners_with_account ?? 0,
    publishedRoutes: row?.published_routes ?? 0,
    materials: row?.materials ?? 0,
    assessmentPolicies: row?.assessment_policies ?? 0,
    /* 준비도는 루트별로 도는 무거운 검사다(T2.4). 설정 화면에서 전부 돌리면
     * 반이 스물이면 스물 번 돈다 — 여기서는 자료 유무만 보고, 실제 차단
     * 목록은 그 화면에서 본다. */
    readinessBlocking: 0,
  };
}
