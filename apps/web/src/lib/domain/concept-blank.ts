import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { matchesTermAnswer } from "@su-maek/core/grading";

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
  /** 학생이 쓴 답 — 채점 뒤 입력칸을 되살리는 데 쓴다 */
  submitted?: Record<number, string>;
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
  /** 글자가 어긋난 칸을 **뜻으로** 다시 보는 판정자. 네트워크를 쓰는 일이라
   *  도메인이 직접 하지 않는다 — 호출자가 넣는다. 없으면 글자 판정만 쓴다.
   *  돌려주는 것은 「맞은 것으로 볼 칸의 자리 번호」다. */
  resolveNear?: (
    pairs: Array<{ position: number; answer: string; submitted: string }>,
  ) => Promise<number[]>;
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
  const found: string[] = [];
  let missing: string[] = [];
  let correct = 0;

  /* 글자로 먼저 본다 — 대부분 여기서 끝나고 공짜다 */
  const near: Array<{ position: number; answer: string; submitted: string }> = [];
  for (const b of blanks) {
    const submitted = (input.answers[b.position] ?? "").trim();
    const isRight = matchesTermAnswer(submitted, b.answer, b.alternatives);
    graded[b.position] = isRight;
    if (isRight) {
      correct += 1;
      found.push(b.answer);
    } else if (submitted.length > 0) {
      near.push({ position: b.position, answer: b.answer, submitted });
    }
  }

  /* 글자가 어긋난 것만 **뜻으로** 다시 본다 — 「소인수들의 곱으로 나타내는
   * 것」이라 제대로 쓴 학생이 낱말이 다르다는 이유로 틀리면 인출이 아니라
   * 받아쓰기가 된다. 안 쓴 칸은 묻지 않는다(빈 답은 언제나 오답이다). */
  if (near.length > 0 && input.resolveNear) {
    const ok = await input.resolveNear(near);
    for (const pos of ok) {
      if (graded[pos] === false) {
        graded[pos] = true;
        correct += 1;
        const b = blanks.find((x) => x.position === pos);
        if (b) found.push(b.answer);
      }
    }
  }
  missing = blanks.filter((b) => !graded[b.position]).map((b) => b.answer);
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
      : `${total}칸 중 ${correct}칸을 맞혔습니다.`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 빈칸 단계 화면에 줄 것 — **개념 섹션과 똑같은 본문**에 자리만 뚫어서.
 *
 * 정답은 여기서 나가지 않는다. 본문에 심는 것은 자리 번호와 글자 수뿐이고
 * (blank-render의 표식), 채점은 서버가 한다.
 * ───────────────────────────────────────────────────────────── */

export interface BlankStageView {
  setId: string;
  conceptId: string;
  conceptName: string;
  stage: BlankStage;
  /** one·two — 빈칸이 뚫린 읽기 자료 본문들 (개념 섹션과 같은 블록) */
  bodies: Array<{ id: string; title: string; body: unknown }>;
  /** 본문에서 자리를 못 찾아 따로 물어야 하는 빈칸 */
  orphans: number[];
  total: number;
  status: "in_progress" | "completed" | "none";
  bestCorrect: number;
}

export async function getBlankStage(input: {
  organizationId: string;
  learnerId: string;
  conceptId: string;
  stage: BlankStage;
}): Promise<BlankStageView | null> {
  const sql = getSharedSql();
  const [set] = await sql<
    {
      id: string;
      concept_name: string;
      blanks: unknown;
      status: string | null;
      best_correct: number | null;
    }[]
  >`
    select s.id::text, c.name as concept_name, s.blanks,
           p.status::text as status, p.best_correct
    from concept_blank_sets s
    join canonical_concepts c on c.id = s.concept_id
    left join learner_blank_progress p
      on p.blank_set_id = s.id and p.learner_id = ${input.learnerId}
    where s.organization_id = ${input.organizationId}
      and s.concept_id = ${input.conceptId}
      and s.stage = ${input.stage}::concept_blank_stage
      and s.status = 'published'
  `;
  if (!set) return null;
  const blanks = parseBlanks(set.blanks);

  const readings = await sql<{ id: string; title: string; body: unknown }[]>`
    select id::text, title, body from learning_materials
    where organization_id = ${input.organizationId}
      and concept_id = ${input.conceptId}
      and kind = 'reading' and status = 'published'
    order by sort_order, created_at
  `;
  /* 자료 여러 건에 걸쳐 자리를 찾는다 — 앞 자료에서 찾은 답은 뒤 자료에서
   * 다시 뚫지 않는다(같은 낱말이 두 번 비면 한쪽을 보고 베낀다). */
  const { applyBlanks } = await import("@/lib/learn/blank-render");
  let pending = blanks.map((b) => ({ position: b.position, answer: b.answer }));
  const bodies: Array<{ id: string; title: string; body: unknown }> = [];
  for (const r of readings) {
    const applied = applyBlanks(r.body, pending);
    bodies.push({ id: r.id, title: r.title, body: applied.body });
    pending = applied.missing;
  }
  return {
    setId: set.id,
    conceptId: input.conceptId,
    conceptName: set.concept_name,
    stage: input.stage,
    bodies,
    orphans: pending.map((p) => p.position),
    total: blanks.length,
    status: (set.status as "in_progress" | "completed") ?? "none",
    bestCorrect: set.best_correct ?? 0,
  };
}

/** 이 개념에 게시된 단계들 — 화면 이동(다음 단계)을 정한다 */
export async function listStagesForConcept(input: {
  organizationId: string;
  conceptId: string;
}): Promise<BlankStage[]> {
  const sql = getSharedSql();
  const rows = await sql<{ stage: string }[]>`
    select stage::text as stage from concept_blank_sets
    where organization_id = ${input.organizationId}
      and concept_id = ${input.conceptId} and status = 'published'
    order by case stage when 'one' then 1 when 'two' then 2 else 3 end
  `;
  return rows.map((r) => r.stage as BlankStage);
}
