import { contentOrganizationIds } from "@su-maek/db";
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
  /** AI 생성 고지 — **검수·감사용 기록이다.** 학생 화면에는 싣지 않는다
   *  (소유자 결정 2026-08-04). 교사 자료 상세가 이 값을 그대로 보여 준다. */
  disclosure: string | null;
  /** 이 학습자의 진도 — 없으면 아직 시작하지 않은 것 */
  progress: "none" | "in_progress" | "completed";
  /** 인강 시청률(0–100)·지점(초). 영상이 아니거나 기록이 없으면 0 */
  watchedPercent: number;
  watchedSeconds: number;
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
      watched_percent: number | null;
      watched_seconds: number | null;
    }[]
  >`
    select m.id::text, m.concept_id::text as concept_id, c.name as concept_name,
           m.kind::text as kind, m.title, m.body, m.video_url,
           m.video_seconds, m.question_ids, m.disclosure,
           p.status::text as progress,
           (p.result ->> 'watchedPercent')::int as watched_percent,
           (p.result ->> 'watchedSeconds')::int as watched_seconds
    from learning_materials m
    join canonical_concepts c on c.id = m.concept_id
    left join learner_material_progress p
      on p.material_id = m.id and p.learner_id = ${input.learnerId}
    where m.organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
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
    /* 연습 자료의 result는 채점 결과라 watchedPercent가 없다 — 그때는 0이다 */
    watchedPercent: r.watched_percent ?? 0,
    watchedSeconds: r.watched_seconds ?? 0,
  }));
}

/** 인강 시청 진도 — 플레이어가 실제로 본 지점을 주기적으로 보낸다.
 *
 * **뒤로만 간다.** 저장된 %가 더 크면 그대로 둔다 — 학생이 되감아 다시
 * 보는 동안 진도가 깎이면 「본 것」이 사라지는 셈이다. 화면은 앞으로 감기를
 * 막지만, 그 판정을 서버가 다시 하지는 않는다(소유자 결정: 우회 방지는
 * 목표가 아니다 — 목표는 스킵 없이 끝까지 보게 하는 것이다).
 *
 * 완료는 임계치를 넘을 때 이 함수가 스스로 찍는다. 인강에는 「다 봤어요」
 * 버튼이 없다 — 눌러서 넘길 수 있으면 시청 강제가 뜻을 잃는다. */
export const WATCH_COMPLETE_PERCENT = 95;

export async function recordVideoWatch(input: {
  organizationId: string;
  learnerId: string;
  materialId: string;
  /** 이어서 본 최대 지점(초) */
  seconds: number;
  /** 0–100 */
  percent: number;
}): Promise<{ ok: boolean; percent: number; completed: boolean }> {
  const sql = getSharedSql();
  const [material] = await sql<{ id: string }[]>`
    select id::text from learning_materials
    where id = ${input.materialId} and organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
      and kind = 'video' and status = 'published'
  `;
  if (!material) return { ok: false, percent: 0, completed: false };

  const percent = Math.max(0, Math.min(100, Math.round(input.percent)));
  const seconds = Math.max(0, Math.round(input.seconds));
  const completed = percent >= WATCH_COMPLETE_PERCENT;

  /* greatest로 올려 쓴다 — 되감기 중에 보낸 낮은 값이 최고 기록을 덮지
   * 않게. 완료 시각도 한 번 찍히면 그대로 둔다(coalesce). */
  const [row] = await sql<{ percent: number; status: string }[]>`
    insert into learner_material_progress (
      id, organization_id, learner_id, material_id, status, result, completed_at
    ) values (
      ${uuidv7()}, ${input.organizationId}, ${input.learnerId}, ${material.id},
      ${completed ? "completed" : "in_progress"},
      ${sql.json({ watchedPercent: percent, watchedSeconds: seconds } as never)},
      ${completed ? sql`now()` : null}
    )
    on conflict (learner_id, material_id) do update
      set result = jsonb_build_object(
            'watchedPercent', greatest(
              ${percent}::int,
              coalesce((learner_material_progress.result ->> 'watchedPercent')::int, 0)
            ),
            'watchedSeconds', greatest(
              ${seconds}::int,
              coalesce((learner_material_progress.result ->> 'watchedSeconds')::int, 0)
            )
          ),
          /* 한 번 완료면 완료로 남는다 — 되감아 다시 볼 때 미완료로 돌아가면
           * 다음 단계가 도로 잠긴다 */
          /* ::material_progress_status — case의 분기 값은 text라 그대로 넣으면
           * enum 컬럼과 타입이 안 맞아 통째로 실패한다(실측: 진도가 하나도
           * 저장되지 않았다). */
          status = (case
            when learner_material_progress.status = 'completed' then 'completed'
            when ${completed} then 'completed'
            else 'in_progress' end)::material_progress_status,
          completed_at = coalesce(
            learner_material_progress.completed_at,
            ${completed ? sql`now()` : null}
          ),
          updated_at = now()
    returning (result ->> 'watchedPercent')::int as percent, status::text as status
  `;
  return {
    ok: true,
    percent: row?.percent ?? percent,
    completed: (row?.status ?? "") === "completed",
  };
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
    where id = ${input.materialId} and organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
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

/* 자동 선별에서 빼는 문항 — 연습 화면의 「한 칸 입력 + 즉시 채점」과 맞지
 * 않는 것들이다. 문제은행에는 그대로 남는다(시험지·지정 출제에는 쓸 수 있다).
 * ① 정답 정보가 없는 문항 — 채점이 건너뛰어 「채점할 수 없었습니다」가 된다.
 * ② 다항 나열형(⑴⑵…)·줄바꿈·긴 서술 정답 — 정확 일치 채점으로는 학생이
 *    맞혀도 맞다고 판정할 수 없다 (RPM #0105·#0119에서 실측). */
function autoPickable(row: PracticeQuestionRow): boolean {
  if (row.kind === "multiple_choice") {
    /* 복수 정답 객관식은 화면이 라디오(단일 선택)라 맞힐 방법이 없다 —
     * 체크박스 UI가 생기기 전에는 자동 선별에서 뺀다 */
    const correct = (row.answer as { correctChoiceIds?: unknown[] } | null)
      ?.correctChoiceIds;
    return Array.isArray(correct) && correct.length === 1;
  }
  const accepted = (row.answer as { accepted?: { value?: unknown }[] } | null)
    ?.accepted;
  if (!Array.isArray(accepted) || accepted.length === 0) return false;
  return accepted.every((a) => {
    const value = a?.value;
    if (typeof value !== "string" || value.length === 0) return false;
    if (/[⑴⑵⑶⑷⑸⑹\n]/.test(value)) return false;
    /* 분수·근호 꼴 정답은 일반 텍스트 입력으로 같은 표기를 만들 수 없다 —
     * 수식 입력 UI가 생기기 전에는 자동 선별에서 뺀다 */
    if (/\\frac|\\sqrt/.test(value)) return false;
    return value.length <= 40;
  });
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
    where id = ${input.materialId} and organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
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
        where q.organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
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
        /* 미검수 AI 제안으로는 학생에게 문항을 내보내지 않는다 */
        join question_alignments a
          on a.question_id = q.id and a.concept_id = ${material.concept_id}
         and a.provenance <> 'ai_suggested'
        where q.organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
          and q.review_status = 'published'
        group by q.id, v.id
        /* 전담 정렬(weight 1.0) 우선 — 한 문항이 여러 개념에 걸치면 weight가
         * 분산되어(0.33…) 뒤로 밀린다. 이 정렬이 없으면 교재 맨 앞 문항이
         * 개념과 무관하게 모든 개념의 연습에 나온다 — 소인수분해 연습에
         * 소수 판별 문항이 나오는 것을 실제 화면에서 확인했다(2026-08-04). */
        order by max(a.weight) desc nulls last, q.created_at
        /* 아래 autoPickable로 걸러낼 몫까지 넉넉히 가져와 개수를 채운다 */
        limit ${(input.limit ?? 5) * 4}
      `;

  /* 지정 순서 복원 — SQL의 any()는 배열 순서를 지켜 주지 않는다.
   * 검수에서 빠지거나 권한이 막힌 문항은 조용히 사라진다(위 where가 거른다).
   * 그것이 맞다: 낼 수 없는 문항을 순서 맞추자고 낼 수는 없다.
   *
   * 자동 선별에는 autoPickable을 한 겹 더 건다 — 문항이 나빠서가 아니라
   * 이 화면과 안 맞아서다. 교사 지정(questionIds)은 거르지 않는다:
   * 지정은 교사의 선택이고, 지정 화면이 그 결과를 함께 보여 준다. */
  const ordered =
    curated.length > 0
      ? curated
          .map((id) => rows.find((r) => r.question_id === id))
          .filter((r): r is PracticeQuestionRow => r !== undefined)
      : rows.filter(autoPickable).slice(0, input.limit ?? 5);

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
