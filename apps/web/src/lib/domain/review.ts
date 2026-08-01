import "server-only";
import { getSharedSql } from "@su-maek/db";
import { answerKey, studentAnswer } from "@su-maek/contracts";
import { gradeAnswer } from "@su-maek/core/grading";

/* ─────────────────────────────────────────────────────────────
 * 복습 수행 (20장).
 *
 * review_items는 오답에서 만들어지기만 하고 **학생이 그것을 할 수단이
 * 없었다** — 화면에 건수만 떴다. 여기가 그 수단이다.
 *
 * 설계 결정 셋:
 *  1. **틀렸던 그 문항을 다시 낸다.** 개념이 같은 새 문항을 뽑는 편이
 *     이상적이지만, 그러면 출제 풀·무반복 정책과 얽혀 복습이 또 막힌다
 *     (실측: 무반복 창 때문에 오늘 테스트조차 못 만들었다). 같은 문항
 *     재제시는 간격 반복의 표준 형태이기도 하다.
 *  2. **복습 결과는 숙련도 증거로 쓰지 않는다.** 증거는 grade_decisions →
 *     responses → attempts 사슬에 묶여 있고(불변 조건 10), 복습을 그 사슬에
 *     끼우면 "평가 1건 = 증거 1건" 규칙이 깨진다. 복습은 review_items.outcome에만
 *     남는다 — 숙련도는 여전히 채점된 평가에서만 움직인다. 이 한계는 의도된
 *     것이고, 복습이 숙련도에 반영되어야 한다면 별도 증거 종류를 먼저 정해야 한다.
 *  3. **틀리면 지우지 않고 다시 잡는다.** 못 맞힌 복습을 완료 처리하면
 *     "복습했다"가 거짓이 된다. 기한을 미뤄 다시 올라오게 한다.
 * ───────────────────────────────────────────────────────────── */

export interface DueReview {
  id: string;
  conceptName: string;
  dueOn: string;
  overdue: boolean;
  questionId: string | null;
  /** 문항 본문 — 없으면(문항 참조가 끊긴 항목) 풀 수 없다 */
  body: unknown | null;
  choices: unknown | null;
  kind: string | null;
}

/** 기한이 온 복습 목록 (오래된 것부터) */
export async function listDueReviews(input: {
  organizationId: string;
  learnerId: string;
  today: string;
  limit?: number;
}): Promise<DueReview[]> {
  const sql = getSharedSql();
  const rows = await sql<
    {
      id: string;
      concept_name: string;
      due_on: string;
      overdue: boolean;
      question_id: string | null;
      body: unknown | null;
      choices: unknown | null;
      kind: string | null;
    }[]
  >`
    select r.id::text, c.name as concept_name, r.due_on::text as due_on,
           (r.due_on < ${input.today}::date) as overdue,
           r.question_id::text as question_id,
           v.body, v.choices, q.kind::text as kind
    from review_items r
    join canonical_concepts c on c.id = r.concept_id
    left join questions q on q.id = r.question_id
    left join question_versions v on v.id = q.current_version_id
    where r.organization_id = ${input.organizationId}
      and r.learner_id = ${input.learnerId}
      and r.status = 'scheduled'
      and r.due_on <= ${input.today}::date
    order by r.due_on asc, r.created_at asc
    limit ${input.limit ?? 20}
  `;
  return rows.map((r) => ({
    id: r.id,
    conceptName: r.concept_name,
    dueOn: r.due_on,
    overdue: r.overdue,
    questionId: r.question_id,
    body: r.body,
    choices: r.choices,
    kind: r.kind,
  }));
}

export interface ReviewAnswerResult {
  ok: boolean;
  correct: boolean;
  message: string;
  /** 남은 기한 도래 복습 수 — 화면이 다음 항목으로 넘어갈지 판단한다 */
  remaining: number;
}

/** 복습 한 건 제출 — 맞히면 닫고, 틀리면 기한을 미뤄 다시 잡는다 */
export async function answerReview(input: {
  organizationId: string;
  learnerId: string;
  reviewItemId: string;
  answer: unknown;
  today: string;
}): Promise<ReviewAnswerResult> {
  const sql = getSharedSql();
  const parsedAnswer = studentAnswer.safeParse(input.answer);
  if (!parsedAnswer.success) {
    return {
      ok: false,
      correct: false,
      message: "답안 형식이 올바르지 않습니다.",
      remaining: await countDue(input),
    };
  }

  /* learner_id를 반드시 조건에 둔다 — 남의 복습을 닫을 수 있으면 안 된다
   * (같은 실수를 saveResponse에서 한 번 했다). */
  const [item] = await sql<
    { id: string; concept_id: string; answer_key: unknown; points: string | null }[]
  >`
    select r.id::text, r.concept_id::text as concept_id,
           v.answer as answer_key, v.points::text as points
    from review_items r
    left join questions q on q.id = r.question_id
    left join question_versions v on v.id = q.current_version_id
    where r.id = ${input.reviewItemId}
      and r.organization_id = ${input.organizationId}
      and r.learner_id = ${input.learnerId}
      and r.status = 'scheduled'
  `;
  if (!item) {
    return {
      ok: false,
      correct: false,
      message: "복습 항목을 찾을 수 없습니다.",
      remaining: await countDue(input),
    };
  }

  const parsedKey = answerKey.safeParse(item.answer_key);
  if (!parsedKey.success) {
    /* 정답 정보가 없으면 채점하지 않는다. 맞았다고 넘기면 거짓 완료가 되고,
     * 틀렸다고 하면 학생을 억울하게 만든다 — 그냥 못 한다고 말한다. */
    return {
      ok: false,
      correct: false,
      message: "이 항목은 정답 정보가 없어 채점할 수 없습니다. 선생님께 알려 주세요.",
      remaining: await countDue(input),
    };
  }

  const outcome = gradeAnswer(
    parsedKey.data,
    parsedAnswer.data,
    Number(item.points ?? 10),
    { minAutoConfidence: 0.9 },
  );
  // needs_review·partial은 정답으로 치지 않는다 — 복습은 확실히 맞혀야 닫힌다
  const correct = outcome.verdict === "correct";

  await sql`
    update review_items
    set status = ${correct ? "completed" : "scheduled"},
        completed_at = ${correct ? sql`now()` : null},
        due_on = ${correct ? sql`due_on` : sql`(${input.today}::date + 1)`},
        outcome = ${sql.json({
          closedBy: "learner_review",
          correct,
          scoreRatio: outcome.maxScore > 0 ? (outcome.score ?? 0) / outcome.maxScore : 0,
          answeredOn: input.today,
        } as never)},
        updated_at = now()
    where id = ${item.id}
      and organization_id = ${input.organizationId}
      and learner_id = ${input.learnerId}
  `;

  return {
    ok: true,
    correct,
    message: correct
      ? "맞았습니다. 이 개념의 복습을 마쳤습니다."
      : "아직 틀립니다. 내일 다시 올라옵니다.",
    remaining: await countDue(input),
  };
}

async function countDue(input: {
  organizationId: string;
  learnerId: string;
  today: string;
}): Promise<number> {
  const sql = getSharedSql();
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from review_items
    where organization_id = ${input.organizationId}
      and learner_id = ${input.learnerId}
      and status = 'scheduled'
      and due_on <= ${input.today}::date
  `;
  return row?.cnt ?? 0;
}
