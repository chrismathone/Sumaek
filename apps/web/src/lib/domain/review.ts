import "server-only";
import { getSharedSql } from "@su-maek/db";
import { answerKey, studentAnswer } from "@su-maek/contracts";
import { gradeAnswer } from "@su-maek/core/grading";
import { forgettingParams, scheduleNextReview } from "@su-maek/core/mastery";
import type { IsoDate } from "@su-maek/core/shared";

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

/** 기한이 온 복습을 개념으로 묶은 것 — 오늘 화면이 「무엇을」 말하기 위한 것 */
export interface DueReviewConcept {
  conceptId: string;
  conceptName: string;
  count: number;
  /** 그중 기한이 지난 것 */
  overdueCount: number;
}

/**
 * 기한이 온 복습 — 개념별 묶음.
 *
 * 오늘 화면은 예전에 건수만 세는 집계 질의를 따로 갖고 있었다. 개념 이름이
 * 필요해진 김에 그 집계를 여기로 합친다 — 같은 사실("기한이 온 복습")을
 * 두 곳에서 각자 정의하면 조건이 갈리는 순간 두 화면이 다른 수를 말한다.
 * 총건수는 이 묶음을 더해서 얻는다.
 *
 * `canonical_concepts` 안쪽 조인도 **일부러** listDueReviews와 같게 두었다.
 * 한쪽만 바깥 조인으로 세면 「5건 기다립니다」라고 해 놓고 복습 화면에는
 * 4건만 나오는 어긋남이 생긴다.
 *
 * 정렬은 복습 화면과 같은 기준(오래된 기한 먼저) — 학생이 오늘 화면에서 본
 * 첫 개념이 복습을 눌렀을 때 실제로 처음 나오는 개념이어야 한다.
 */
export async function listDueReviewConcepts(input: {
  organizationId: string;
  learnerId: string;
  today: string;
}): Promise<DueReviewConcept[]> {
  const sql = getSharedSql();
  const rows = await sql<
    {
      concept_id: string;
      concept_name: string;
      cnt: number;
      overdue_cnt: number;
    }[]
  >`
    select c.id::text as concept_id, c.name as concept_name,
           count(*)::int as cnt,
           count(*) filter (where r.due_on < ${input.today}::date)::int
             as overdue_cnt
    from review_items r
    join canonical_concepts c on c.id = r.concept_id
    where r.organization_id = ${input.organizationId}
      and r.learner_id = ${input.learnerId}
      and r.status = 'scheduled'
      and r.due_on <= ${input.today}::date
    group by c.id, c.name
    order by min(r.due_on) asc, c.name asc
  `;
  return rows.map((r) => ({
    conceptId: r.concept_id,
    conceptName: r.concept_name,
    count: r.cnt,
    overdueCount: r.overdue_cnt,
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
    {
      id: string;
      concept_id: string;
      answer_key: unknown;
      points: string | null;
      stability_days: string | null;
      repetition_no: number;
      lapse_count: number;
      due_on: string;
      policy_spec: unknown;
    }[]
  >`
    select r.id::text, r.concept_id::text as concept_id,
           v.answer as answer_key, v.points::text as points,
           r.stability_days::text as stability_days,
           r.repetition_no, r.lapse_count, r.due_on::text as due_on,
           (select spec from mastery_policy_versions
             where organization_id = r.organization_id and is_active = true
             order by version desc limit 1) as policy_spec
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

  /* 망각곡선으로 다음 일정을 정한다.
   *
   * 예전에는 `today + 1`이 하드코딩돼 있었다 — 맞히면 그냥 닫히고 끝이라
   * **간격이 자라지 않았고**, 틀리면 언제나 내일이었다. 이제 맞히면 안정성이
   * 늘어 다음이 멀어지고, 틀리면 줄어 가까워진다. 상한은 정책이 정한다. */
  const maxInterval = forgettingParams(
    (item.policy_spec ?? undefined) as never,
  ).maxIntervalDays;
  const next = scheduleNextReview({
    policy: (item.policy_spec ?? undefined) as never,
    stabilityDays: item.stability_days === null ? null : Number(item.stability_days),
    repetitionNo: item.repetition_no,
    lapseCount: item.lapse_count,
    wasCorrect: correct,
    dueOn: item.due_on as IsoDate,
    reviewedOn: input.today as IsoDate,
  });

  /* **맞혔다고 닫지 않는다.** 닫으면 늘어난 간격이 영영 쓰이지 않아 간격
   * 반복이 성립하지 않는다 — 한 번 맞히면 끝나는 것은 복습이 아니다.
   * 상한(정책의 최대 간격)에 도달하면 그때 졸업시킨다: "한 달 간격까지
   * 버텼으면 익힌 것으로 본다"는 것이 사용자가 정한 최대 1달의 뜻이다. */
  const graduated = correct && next.intervalDays >= maxInterval;

  await sql`
    update review_items
    set status = ${graduated ? "completed" : "scheduled"},
        completed_at = ${graduated ? sql`now()` : null},
        due_on = ${next.dueOn},
        stability_days = ${next.stabilityDays},
        repetition_no = ${next.repetitionNo},
        lapse_count = ${next.lapseCount},
        interval_days = ${next.intervalDays},
        last_reviewed_on = ${input.today}::date,
        outcome = ${sql.json({
          closedBy: "learner_review",
          correct,
          scoreRatio: outcome.maxScore > 0 ? (outcome.score ?? 0) / outcome.maxScore : 0,
          answeredOn: input.today,
          stabilityDays: next.stabilityDays,
          explanation: next.explanation,
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
      ? graduated
        ? "맞았습니다. 이 개념은 충분히 익힌 것으로 보고 복습을 마칩니다."
        : `맞았습니다. 다음에는 ${next.intervalDays}일 뒤에 확인합니다.`
      : `아직 틀립니다. ${next.dueOn}에 다시 올라옵니다.`,
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
