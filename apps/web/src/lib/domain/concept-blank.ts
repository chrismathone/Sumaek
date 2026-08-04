import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { keywordCoverage, matchesTermAnswer } from "@su-maek/core/grading";

/* ─────────────────────────────────────────────────────────────
 * 개념 빈칸 — 인강을 보고 넘어가는 것이 아니라 인출하게.
 *
 * 단계는 발판을 걷어내는 순서다:
 *   one   핵심어 한둘만 뚫린 문장
 *   two   정의문의 뼈대까지 뚫린 문장
 *   full  본문 없이 개념을 통째로 다시 쓰기 (핵심어 포함 여부로 채점)
 *
 * 정답 권한은 DB의 blanks 하나뿐이고, **정답은 화면으로 내려보내지 않는다.**
 * 채점은 서버에서만 한다 — 내려보내면 개발자도구로 답이 보인다. 우회를 막는
 * 것이 목표는 아니지만(소유자 결정), 답을 화면에 실어 보내는 것은 우회가
 * 아니라 그냥 알려 주는 것이다.
 * ───────────────────────────────────────────────────────────── */

export type BlankStage = "one" | "two" | "full";

export interface BlankItem {
  position: number;
  /** 정답 — 학생 화면으로 내려가지 않는다 */
  answer: string;
  hint: string;
  alternatives: string[];
}

/** 화면에 내려보내는 빈칸 — 정답이 빠져 있다 */
export interface BlankPrompt {
  position: number;
  hint: string;
}

export interface BlankSetView {
  id: string;
  conceptId: string;
  conceptName: string;
  stage: BlankStage;
  /** one·two에만 있다. {{1}} 자리에 입력칸이 들어간다 */
  templateText: string | null;
  prompts: BlankPrompt[];
  /** full 단계에서 학생에게 보여 줄 핵심어 개수 — 목표를 숨기지 않는다 */
  keywordCount: number;
  status: "in_progress" | "completed" | "none";
  bestCorrect: number;
  totalCount: number;
}

function parseBlanks(raw: unknown): BlankItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b) => {
    if (typeof b !== "object" || b === null) return [];
    const o = b as Record<string, unknown>;
    const position = Number(o.position);
    const answer = typeof o.answer === "string" ? o.answer : "";
    if (!Number.isInteger(position) || position < 1 || answer.length === 0) {
      return [];
    }
    return [
      {
        position,
        answer,
        hint: typeof o.hint === "string" ? o.hint : "",
        alternatives: Array.isArray(o.alternatives)
          ? o.alternatives.filter((a): a is string => typeof a === "string")
          : [],
      },
    ];
  });
}

/** 오늘 개념들의 게시된 빈칸 묶음 + 이 학습자의 진도 */
export async function listBlankSets(input: {
  organizationId: string;
  learnerId: string;
  conceptIds: string[];
}): Promise<BlankSetView[]> {
  if (input.conceptIds.length === 0) return [];
  const sql = getSharedSql();
  const rows = await sql<
    {
      id: string;
      concept_id: string;
      concept_name: string;
      stage: string;
      template_text: string | null;
      blanks: unknown;
      status: string | null;
      best_correct: number | null;
      total_count: number | null;
    }[]
  >`
    select s.id::text, s.concept_id::text as concept_id, c.name as concept_name,
           s.stage::text as stage, s.template_text, s.blanks,
           p.status::text as status, p.best_correct, p.total_count
    from concept_blank_sets s
    join canonical_concepts c on c.id = s.concept_id
    left join learner_blank_progress p
      on p.blank_set_id = s.id and p.learner_id = ${input.learnerId}
    where s.organization_id = ${input.organizationId}
      and s.concept_id = any(${input.conceptIds}::uuid[])
      and s.status = 'published'
    /* 단계 순서를 이름순에 맡기지 않는다 — full·one·two가 되어 3단계가
     * 맨 앞에 온다. 배우는 순서를 명시한다. */
    order by c.name,
      case s.stage when 'one' then 1 when 'two' then 2 else 3 end
  `;
  return rows.map((r) => {
    const blanks = parseBlanks(r.blanks);
    return {
      id: r.id,
      conceptId: r.concept_id,
      conceptName: r.concept_name,
      stage: r.stage as BlankStage,
      templateText: r.template_text,
      prompts: blanks.map((b) => ({ position: b.position, hint: b.hint })),
      keywordCount: blanks.length,
      status: (r.status as "in_progress" | "completed") ?? "none",
      bestCorrect: r.best_correct ?? 0,
      totalCount: r.total_count ?? blanks.length,
    };
  });
}

export interface BlankGradeResult {
  ok: boolean;
  message: string;
  /** position → 맞았는가. full 단계에서는 비어 있다 */
  graded: Record<number, boolean>;
  /** full 단계 — 담은 핵심어와 빠진 핵심어 */
  found: string[];
  missing: string[];
  correct: number;
  total: number;
  completed: boolean;
}

/**
 * 제출 채점.
 *
 * **완료 기준은 전부 맞히기다.** 빈칸은 인출을 확인하는 자리이고, 절반만
 * 맞혀도 넘어가면 확인이 되지 않는다. 다만 진도의 best_correct는 내려가지
 * 않으므로 다시 풀어 더 틀려도 잃는 것은 없다.
 */
export async function submitBlankAnswers(input: {
  organizationId: string;
  learnerId: string;
  blankSetId: string;
  /** one·two: position → 답. full: 자유 서술 한 덩어리 */
  answers: Record<number, string>;
  essay?: string;
}): Promise<BlankGradeResult> {
  const sql = getSharedSql();
  const [set] = await sql<
    { id: string; stage: string; blanks: unknown }[]
  >`
    select id::text, stage::text as stage, blanks
    from concept_blank_sets
    where id = ${input.blankSetId}
      and organization_id = ${input.organizationId}
      and status = 'published'
  `;
  const empty = { graded: {}, found: [], missing: [], correct: 0, total: 0 };
  if (!set) {
    return { ok: false, message: "빈칸을 찾을 수 없습니다.", completed: false, ...empty };
  }

  const blanks = parseBlanks(set.blanks);
  const graded: Record<number, boolean> = {};
  let found: string[] = [];
  let missing: string[] = [];
  let correct = 0;

  if (set.stage === "full") {
    const cover = keywordCoverage(input.essay ?? "", blanks.map((b) => b.answer));
    found = cover.found;
    missing = cover.missing;
    correct = cover.found.length;
  } else {
    for (const b of blanks) {
      const isRight = matchesTermAnswer(
        input.answers[b.position] ?? "",
        b.answer,
        b.alternatives,
      );
      graded[b.position] = isRight;
      if (isRight) correct += 1;
    }
  }
  const total = blanks.length;
  const completed = total > 0 && correct === total;

  /* best_correct는 greatest로만 올린다 — 다시 풀어 더 틀렸다고 기록이 깎이면
   * 학생은 다시 풀지 않는다. 한 번 완료면 완료로 남는 것도 같은 이유다. */
  await sql`
    insert into learner_blank_progress (
      id, organization_id, learner_id, blank_set_id, status,
      best_correct, total_count, attempts, result, completed_at
    ) values (
      ${uuidv7()}, ${input.organizationId}, ${input.learnerId}, ${set.id},
      ${completed ? "completed" : "in_progress"}::material_progress_status,
      ${correct}, ${total}, 1,
      ${sql.json({ graded, found, missing, correct, total } as never)},
      ${completed ? sql`now()` : null}
    )
    on conflict (learner_id, blank_set_id) do update
      set best_correct = greatest(learner_blank_progress.best_correct, ${correct}),
          total_count = ${total},
          attempts = learner_blank_progress.attempts + 1,
          result = excluded.result,
          status = (case
            when learner_blank_progress.status = 'completed' then 'completed'
            when ${completed} then 'completed'
            else 'in_progress' end)::material_progress_status,
          completed_at = coalesce(
            learner_blank_progress.completed_at,
            ${completed ? sql`now()` : null}
          ),
          updated_at = now()
  `;

  return {
    ok: true,
    graded,
    found,
    missing,
    correct,
    total,
    completed,
    message: completed
      ? "모두 맞혔습니다."
      : set.stage === "full"
        ? `핵심어 ${total}개 중 ${correct}개를 담았습니다.`
        : `${total}칸 중 ${correct}칸을 맞혔습니다.`,
  };
}
