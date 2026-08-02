import "server-only";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 학습 자료 조회·진도 (개념 공부 · 인강 · 연습문제).
 *
 * 자료는 **개념**에 붙어 있고, 학생 화면은 "오늘 차시의 노드 → 그 노드의
 * 개념 → 그 개념의 자료" 순으로 찾아 온다. 오늘 배우는 것과 무관한 자료가
 * 섞이지 않게 하는 유일한 연결 고리다.
 *
 * 진도는 학습자별로 따로 쌓고, `완료`는 학생이 명시적으로 누를 때만 찍힌다 —
 * "열어 봤다"를 "공부했다"로 세지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface MaterialRow {
  id: string;
  conceptId: string;
  conceptName: string;
  kind: "reading" | "video" | "practice";
  title: string;
  body: unknown | null;
  videoUrl: string | null;
  videoSeconds: number | null;
  questionIds: string[];
  /** AI 생성 고지 — 있으면 학생 화면에 반드시 그대로 보여 준다 */
  disclosure: string | null;
  /** 이 학습자의 진도 — 없으면 아직 시작하지 않은 것 */
  progress: "none" | "in_progress" | "completed";
}

/** 오늘 차시의 노드가 가리키는 개념들 (자료·연습문제의 범위) */
export async function conceptIdsForNodes(
  nodeIds: string[],
): Promise<string[]> {
  const routeNodeIds = nodeIds.filter((n) => !n.startsWith("override:"));
  if (routeNodeIds.length === 0) return [];
  const sql = getSharedSql();
  const rows = await sql<{ concept_id: string }[]>`
    select distinct jsonb_array_elements_text(concept_ids) as concept_id
    from route_nodes where id = any(${routeNodeIds}::uuid[])
  `;
  return rows.map((r) => r.concept_id);
}

/** 개념들에 붙은 게시된 자료 + 이 학습자의 진도 */
export async function listMaterials(input: {
  organizationId: string;
  learnerId: string;
  conceptIds: string[];
  kinds?: Array<"reading" | "video" | "practice">;
}): Promise<MaterialRow[]> {
  if (input.conceptIds.length === 0) return [];
  const sql = getSharedSql();
  const kinds = input.kinds ?? ["reading", "video", "practice"];
  const rows = await sql<
    {
      id: string;
      concept_id: string;
      concept_name: string;
      kind: string;
      title: string;
      body: unknown | null;
      video_url: string | null;
      video_seconds: number | null;
      question_ids: unknown;
      disclosure: string | null;
      progress: string | null;
    }[]
  >`
    select m.id::text, m.concept_id::text as concept_id, c.name as concept_name,
           m.kind::text as kind, m.title, m.body, m.video_url,
           m.video_seconds, m.question_ids, m.disclosure,
           p.status::text as progress
    from learning_materials m
    join canonical_concepts c on c.id = m.concept_id
    left join learner_material_progress p
      on p.material_id = m.id and p.learner_id = ${input.learnerId}
    where m.organization_id = ${input.organizationId}
      and m.concept_id = any(${input.conceptIds}::uuid[])
      and m.status = 'published'
      and m.kind::text = any(${kinds}::text[])
    order by c.name, m.sort_order, m.created_at
  `;
  return rows.map((r) => ({
    id: r.id,
    conceptId: r.concept_id,
    conceptName: r.concept_name,
    kind: r.kind as MaterialRow["kind"],
    title: r.title,
    body: r.body,
    videoUrl: r.video_url,
    videoSeconds: r.video_seconds,
    questionIds: Array.isArray(r.question_ids)
      ? (r.question_ids as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    disclosure: r.disclosure,
    progress: (r.progress as MaterialRow["progress"]) ?? "none",
  }));
}

/** 학생이 「다 봤어요」를 누른 지점 — 열람만으로는 완료가 되지 않는다 */
export async function markMaterialProgress(input: {
  organizationId: string;
  learnerId: string;
  materialId: string;
  status: "in_progress" | "completed";
  result?: unknown;
}): Promise<{ ok: boolean; message: string }> {
  const sql = getSharedSql();
  /* 자료가 이 조직 것인지 확인한다 — materialId를 폼에서 받으므로 */
  const [material] = await sql<{ id: string; title: string }[]>`
    select id::text, title from learning_materials
    where id = ${input.materialId} and organization_id = ${input.organizationId}
      and status = 'published'
  `;
  if (!material) return { ok: false, message: "학습 자료를 찾을 수 없습니다." };

  await sql`
    insert into learner_material_progress (
      id, organization_id, learner_id, material_id, status, result, completed_at
    ) values (
      ${uuidv7()}, ${input.organizationId}, ${input.learnerId}, ${material.id},
      ${input.status}, ${input.result === undefined ? null : sql.json(input.result as never)},
      ${input.status === "completed" ? sql`now()` : null}
    )
    on conflict (learner_id, material_id) do update
      set status = excluded.status,
          result = coalesce(excluded.result, learner_material_progress.result),
          completed_at = coalesce(excluded.completed_at, learner_material_progress.completed_at),
          updated_at = now()
  `;
  return {
    ok: true,
    message:
      input.status === "completed"
        ? `«${material.title}»을 완료로 표시했습니다.`
        : "이어서 볼 수 있습니다.",
  };
}

interface PracticeQuestionRow {
  question_id: string;
  version_id: string;
  body: unknown;
  choices: unknown;
  kind: string;
  points: string;
  answer: unknown;
}

export interface PracticeQuestion {
  assessmentQuestionId: string; // 연습에서는 question_version_id를 키로 쓴다
  questionId: string;
  body: unknown;
  choices: unknown;
  kind: string;
  points: number;
  answerKey: unknown;
}

/**
 * 연습문제 목록.
 * 자료에 questionIds가 지정돼 있으면 그것을, 비어 있으면 그 개념의 출제
 * 가능 문항에서 고른다 — 연습은 무반복 정책의 대상이 아니다(같은 문제를
 * 여러 번 푸는 것이 연습이다).
 *
 * 지정이 있으면 **지정한 순서 그대로** 낸다. 교사가 순서를 정하는 이유가
 * "쉬운 것부터"인데 DB 생성순으로 뒤집어 내면 지정한 의미가 사라진다.
 * 개수도 지정 개수를 따른다 — limit로 잘라 내면 뒤쪽 지정 문항이 조용히
 * 사라져 교사가 만든 묶음과 학생이 받는 묶음이 달라진다.
 */
export async function listPracticeQuestions(input: {
  organizationId: string;
  materialId: string;
  limit?: number;
}): Promise<PracticeQuestion[]> {
  const sql = getSharedSql();
  const [material] = await sql<
    { concept_id: string; question_ids: unknown }[]
  >`
    select concept_id::text as concept_id, question_ids
    from learning_materials
    where id = ${input.materialId} and organization_id = ${input.organizationId}
      and kind = 'practice' and status = 'published'
  `;
  if (!material) return [];
  const curated = Array.isArray(material.question_ids)
    ? (material.question_ids as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];

  /* 지정·자동을 한 문장에 섞어 넣으면 and/or 우선순위에 기대게 된다.
   * 갈래를 눈에 보이게 나눈다 — 어느 쪽이 도는지가 곧 교사가 본 화면이다. */
  const rows = curated.length > 0
    ? await sql<PracticeQuestionRow[]>`
        select q.id::text as question_id, v.id::text as version_id,
               v.body, v.choices, q.kind::text as kind,
               v.points::text as points, v.answer
        from questions q
        join question_versions v on v.id = q.current_version_id
        join content_rights r on r.id = q.content_right_id and r.status = 'usable'
        where q.organization_id = ${input.organizationId}
          and q.review_status = 'published'
          and q.id = any(${curated}::uuid[])
      `
    : await sql<PracticeQuestionRow[]>`
        select q.id::text as question_id, v.id::text as version_id,
               v.body, v.choices, q.kind::text as kind,
               v.points::text as points, v.answer
        from questions q
        join question_versions v on v.id = q.current_version_id
        join content_rights r on r.id = q.content_right_id and r.status = 'usable'
        where q.organization_id = ${input.organizationId}
          and q.review_status = 'published'
          and exists (
            select 1 from question_alignments a
            where a.question_id = q.id and a.concept_id = ${material.concept_id}
          )
        order by q.created_at
        limit ${input.limit ?? 5}
      `;

  /* 지정 순서 복원 — SQL의 any()는 배열 순서를 지켜 주지 않는다.
   * 검수에서 빠지거나 권한이 막힌 문항은 조용히 사라진다(위 where가 거른다).
   * 그것이 맞다: 낼 수 없는 문항을 순서 맞추자고 낼 수는 없다. */
  const ordered =
    curated.length > 0
      ? curated
          .map((id) => rows.find((r) => r.question_id === id))
          .filter((r): r is PracticeQuestionRow => r !== undefined)
      : rows;

  return ordered.map((r) => ({
    assessmentQuestionId: r.version_id,
    questionId: r.question_id,
    body: r.body,
    choices: r.choices,
    kind: r.kind,
    points: Number(r.points),
    answerKey: r.answer,
  }));
}
