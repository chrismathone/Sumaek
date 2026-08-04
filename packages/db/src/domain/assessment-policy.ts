import { v7 as uuidv7 } from "uuid";
import type postgres from "postgres";

/* ─────────────────────────────────────────────────────────────
 * 평가 정책 해석 — **게이트와 생성이 같은 답을 본다** (T3.3).
 *
 * 실측으로 확인한 어긋남이 여기 있었다.
 *
 *  - 준비도 게이트(T2.4)는 `learning_groups.assessment_policy_id`가 비면
 *    「평가 정책 없음」으로 게시를 막았다. 그런데 그 컬럼을 **쓰는 코드가
 *    한 줄도 없었고**(모든 조직에서 100% NULL), 생성기는 그 컬럼을 보지도
 *    않은 채 조직의 활성 정책을 골랐다. 그래서 게이트는 아무도 만족시킬 수
 *    없는 조건으로 평가 노드를 전부 막으면서, 정작 생성이 무엇으로 낼지는
 *    검사하지 않았다.
 *
 * 판정을 한 곳으로 모은다. 게이트가 「막힌다」고 말하는 이유와 생성이 실제로
 * 실패하는 이유가 다르면, 교사는 게이트가 시킨 일을 하고도 여전히 실패한다.
 *
 * 해석 순서는 **반 → 조직**이다. 반 지정은 선택이고(보충반만 다른 정책을
 * 쓰는 경우), 비어 있으면 조직 기본으로 내려간다. 노드 단위 지정은 두지
 * 않는다 — 그 값을 넣을 화면도, 읽을 이유도 아직 없다. 필요해지면 컬럼과
 * 폼을 함께 더한다.
 * ───────────────────────────────────────────────────────────── */

export interface AssessmentPolicyRow {
  id: string;
  version: number;
  questionCount: number;
  timeLimitMinutes: number | null;
  poolWeights: Record<string, number>;
  constraints: {
    difficultyDistribution?: { low: number; mid: number; high: number };
    noRepeatWithinDays?: number;
    generateBeforeHours?: number;
  };
  passingRules: { passRatio?: number; maxAttempts?: number } | null;
}

/** 어디서 온 정책인가 — 감사·생성 맥락에 그대로 남는다 */
export type AssessmentPolicySource = "group" | "organization";

export interface ResolvedAssessmentPolicy {
  policy: AssessmentPolicyRow;
  source: AssessmentPolicySource;
}

interface PolicyDbRow {
  id: string;
  version: number;
  question_count: number;
  time_limit_minutes: number | null;
  pool_weights: Record<string, number>;
  constraints: AssessmentPolicyRow["constraints"];
  passing_rules: AssessmentPolicyRow["passingRules"];
}

function toPolicy(row: PolicyDbRow): AssessmentPolicyRow {
  return {
    id: row.id,
    version: row.version,
    questionCount: row.question_count,
    timeLimitMinutes: row.time_limit_minutes,
    poolWeights: row.pool_weights ?? {},
    constraints: row.constraints ?? {},
    passingRules: row.passing_rules ?? null,
  };
}

/**
 * 이 반·목적으로 실제 출제에 쓰일 정책.
 *
 * 반이 가리키는 정책이 **꺼져 있거나 목적이 다르면** 없는 것으로 보고 조직
 * 기본으로 내려간다. 꺼진 정책으로 계속 내는 것보다 낫고, 목적이 다른 정책을
 * 그대로 쓰면 확인테스트가 일일테스트 규칙으로 난다.
 *
 * 후보가 없으면 `null`. 그 답이 곧 준비도 게이트의 `no_assessment_policy`다.
 */
export async function resolveAssessmentPolicy(
  sql: postgres.Sql | postgres.TransactionSql,
  input: {
    organizationId: string;
    learningGroupId: string | null;
    purpose: string;
  },
): Promise<ResolvedAssessmentPolicy | null> {
  const { organizationId, learningGroupId, purpose } = input;

  if (learningGroupId) {
    const [row] = await sql<PolicyDbRow[]>`
      select p.id::text as id, p.version, p.question_count, p.time_limit_minutes,
             p.pool_weights, p.constraints, p.passing_rules
      from learning_groups g
      join assessment_policies p on p.id = g.assessment_policy_id
      where g.id = ${learningGroupId}
        and g.organization_id = ${organizationId}
        and p.organization_id = ${organizationId}
        and p.purpose::text = ${purpose}
        and p.is_active = true
      limit 1
    `;
    if (row) return { policy: toPolicy(row), source: "group" };
  }

  const [row] = await sql<PolicyDbRow[]>`
    select id::text as id, version, question_count, time_limit_minutes,
           pool_weights, constraints, passing_rules
    from assessment_policies
    where organization_id = ${organizationId}
      and purpose::text = ${purpose}
      and is_active = true
    order by version desc
    limit 1
  `;
  return row ? { policy: toPolicy(row), source: "organization" } : null;
}

/* ─────────────────────────────────────────────────────────────
 * 새 학원의 기본 정책.
 *
 * 정책을 만드는 곳이 **데모 시드 하나뿐**이었다(하드코딩된 UUID 두 개).
 * 새 학원은 `assessment_policies`가 0건이라 자동 생성이 첫 실행부터
 * "활성 일일테스트 정책이 없습니다. 설정에서 평가 정책을 만드세요"로
 * 실패한다 — 그리고 그 설정 화면은 정책을 만들지 않는다. 목록만 보여 준다.
 *
 * 편집 화면은 아직 없다(T5.1의 온보딩이 가져간다). 그래도 **기본값이
 * 데이터로 존재하는 것**과 코드 상수로 숨어 있는 것은 다르다 — 값은 여기서
 * 한 번 넣고, 그 뒤로는 정책 행이 정본이다 (ADR-0009: 임계값을 코드 상수로
 * 두지 않는다).
 * ───────────────────────────────────────────────────────────── */

/** 기본값의 근거는 데모 시드가 쓰던 값 그대로다 — 새 학원도 같은 자리에서 시작한다 */
const DEFAULT_POLICIES = [
  {
    purpose: "formative",
    name: "일일테스트 기본",
    poolWeights: { today_concept: 50, weakness: 30, review: 20 },
    questionCount: 8,
    timeLimitMinutes: 15,
    constraints: {
      difficultyDistribution: { low: 2, mid: 5, high: 1 },
      noRepeatWithinDays: 14,
    },
    passingRules: null as Record<string, unknown> | null,
  },
  {
    purpose: "confirmation",
    name: "확인테스트 기본",
    poolWeights: { anchor: 70, cumulative: 30 },
    questionCount: 5,
    timeLimitMinutes: 20,
    constraints: { noRepeatWithinDays: 7 },
    passingRules: {
      passRatio: 0.7,
      maxAttempts: 2,
      // 재시험은 동일 문항 재노출 금지 — 같은 개념의 동등 문항 (2N)
      retryExcludesSameQuestions: true,
    } as Record<string, unknown> | null,
  },
] as const;

export interface EnsureDefaultPoliciesResult {
  /** 이번 호출로 만든 목적 — 이미 있던 것은 건드리지 않는다 */
  created: string[];
}

/**
 * 조직에 일일·확인테스트 기본 정책을 보장한다. **멱등**이다.
 *
 * 이미 그 목적의 활성 정책이 있으면 아무것도 하지 않는다 — 학원이 손봐 둔
 * 값을 기본값으로 덮지 않는다.
 */
export async function ensureDefaultAssessmentPolicies(
  sql: postgres.Sql,
  organizationId: string,
): Promise<EnsureDefaultPoliciesResult> {
  const created: string[] = [];
  for (const spec of DEFAULT_POLICIES) {
    const [existing] = await sql<{ id: string }[]>`
      select id from assessment_policies
      where organization_id = ${organizationId}
        and purpose::text = ${spec.purpose}
        and is_active = true
      limit 1
    `;
    if (existing) continue;

    const inserted = await sql<{ id: string }[]>`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, time_limit_minutes, constraints, passing_rules,
        automation_level, is_active
      ) values (
        ${uuidv7()}, ${organizationId}, ${spec.name}, ${spec.purpose}::assessment_purpose,
        1, ${sql.json(spec.poolWeights as never)}, ${spec.questionCount},
        ${spec.timeLimitMinutes}, ${sql.json(spec.constraints as never)},
        ${spec.passingRules === null ? null : sql.json(spec.passingRules as never)},
        'approve_first', true
      )
      /* 같은 이름·버전이 이미 있으면(비활성으로 꺼 둔 것) 되살리지 않는다 —
       * 껐다는 사실이 의도다. */
      on conflict (organization_id, name, version) do nothing
      returning id
    `;
    /* 충돌로 아무것도 안 들어갔으면 만들었다고 하지 않는다 — 시드 로그와
     * 온보딩 화면이 「기본 정책을 넣었다」고 말하는데 실제로는 꺼진 정책이
     * 그대로인 상황이 가장 헷갈린다. */
    if (inserted.length > 0) created.push(spec.purpose);
  }
  return { created };
}
