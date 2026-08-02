"use server";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseYouTubeId, youTubeWatchUrl } from "@/lib/youtube";

/* ─────────────────────────────────────────────────────────────
 * 학습 자료 저작 (개념 공부 · 인강 · 연습문제).
 *
 * 학생 화면은 오래전부터 이 데이터를 읽고 있었는데 **넣는 경로가 없었다** —
 * SQL이 유일한 입력 수단이었다. 여기가 그 문이다.
 *
 * 검증은 DB의 `learning_materials_kind_payload_ck`와 **같은 기준**을 쓴다
 * (읽기엔 본문, 인강엔 URL). 폼이 먼저 막고 DB를 최후 방어선으로 둔다 —
 * 순서가 바뀌면 선생님이 보는 건 사람 문구가 아니라 Postgres 오류다.
 * ───────────────────────────────────────────────────────────── */

export interface MaterialResult {
  ok: boolean;
  message: string;
}

const KINDS = ["reading", "video", "practice"] as const;

/** 자료를 붙일 수 있는 개념 상태 — 화면 드롭다운과 **같은 기준**이다 */
const USABLE_CONCEPT_STATUS = ["reviewed", "active"];

const payloadFields = {
  conceptId: z.uuid("개념을 선택하세요."),
  title: z.string().trim().min(1, "제목을 입력하세요.").max(200),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  body: z.string().default(""),
  videoUrl: z.string().default(""),
  videoMinutes: z.coerce.number().int().min(0).max(600).default(0),
  videoSeconds: z.coerce.number().int().min(0).max(59).default(0),
  disclosure: z.string().max(300).default(""),
  sourceJobId: z.string().trim().max(120).default(""),
} as const;

const createSchema = z.object({ ...payloadFields, kind: z.enum(KINDS) });

/* 종류별 필수값 정리 — DB CHECK(learning_materials_kind_payload_ck)와 같은
 * 기준이다. 만들기와 고치기가 같은 규칙을 써야 "만들 땐 됐는데 고칠 땐
 * 안 된다"가 생기지 않는다. */
type PayloadInput = {
  kind: (typeof KINDS)[number];
  body: string;
  videoUrl: string;
  videoMinutes: number;
  videoSeconds: number;
};
type PayloadOut =
  | { ok: true; body: unknown; videoUrl: string | null; seconds: number | null }
  | { ok: false; message: string };

function buildPayload(d: PayloadInput): PayloadOut {
  if (d.kind === "reading") {
    const text = d.body.trim();
    if (!text) return { ok: false, message: "개념 설명 본문을 입력하세요." };
    /* 현재 실사용 형식 그대로 — 텍스트 한 블록. 수식은 $…$로 본문에 섞어 쓴다
     * (시드·반입 파이프라인이 만드는 모양과 동일해야 렌더 경로가 갈리지 않는다). */
    return { ok: true, body: [{ type: "text", text }], videoUrl: null, seconds: null };
  }
  if (d.kind === "video") {
    const id = parseYouTubeId(d.videoUrl);
    if (!id) {
      return {
        ok: false,
        message: d.videoUrl.trim()
          ? "유튜브 주소만 등록할 수 있습니다 (youtube.com 또는 youtu.be)."
          : "강의 영상 주소를 입력하세요.",
      };
    }
    const total = d.videoMinutes * 60 + d.videoSeconds;
    return {
      ok: true,
      body: null,
      videoUrl: youTubeWatchUrl(id),
      seconds: total > 0 ? total : null,
    };
  }
  return { ok: true, body: null, videoUrl: null, seconds: null };
}

/**
 * 개념 존재 + **상태**까지 본다.
 *
 * 화면 드롭다운은 이미 reviewed·active만 싣는데 서버는 id 존재만 봤다.
 * 폼을 우회하면 draft·deprecated 개념에도 자료가 붙고, 그런 자료는 루트에
 * 실리지 않는 개념에 매달려 **학생에게 영원히 보이지 않는다** — 만든 사람은
 * 만들었다고 믿는데 아무도 못 보는 자료가 조용히 쌓인다. 서버에서 막는다.
 */
async function findUsableConcept(
  conceptId: string,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const sql = getSharedSql();
  const [concept] = await sql<{ name: string; status: string }[]>`
    select name, status::text as status from canonical_concepts
    where id = ${conceptId}
  `;
  if (!concept) return { ok: false, message: "개념을 찾을 수 없습니다." };
  if (!USABLE_CONCEPT_STATUS.includes(concept.status)) {
    return {
      ok: false,
      message: `«${concept.name}»은 아직 검토가 끝나지 않았거나 폐기된 개념입니다. 자료를 붙여도 학생에게 보이지 않습니다.`,
    };
  }
  return { ok: true, name: concept.name };
}

export async function createMaterialAction(
  _prev: MaterialResult | null,
  formData: FormData,
): Promise<MaterialResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "materials")) {
    return { ok: false, message: "학습 자료를 만들 권한이 없습니다." };
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "입력을 확인하세요.",
    };
  }
  const d = parsed.data;

  const payload = buildPayload(d);
  if (!payload.ok) return { ok: false, message: payload.message };

  const concept = await findUsableConcept(d.conceptId);
  if (!concept.ok) return concept;

  const sql = getSharedSql();
  const materialId = uuidv7();
  const disclosure = d.disclosure.trim() || null;
  const sourceJobId = d.sourceJobId || null;
  await sql.begin(async (tx) => {
    await tx`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, body,
        video_url, video_seconds, question_ids, sort_order, status,
        disclosure, source_job_id, created_by
      ) values (
        ${materialId}, ${user.organizationId}, ${d.conceptId}, ${d.kind},
        ${d.title}, ${payload.body === null ? null : tx.json(payload.body as never)},
        ${payload.videoUrl}, ${payload.seconds}, '[]'::jsonb, ${d.sortOrder}, 'draft',
        ${disclosure}, ${sourceJobId}, ${user.userId}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'material.create', 'learning_material', ${materialId},
        ${`${concept.name} — ${d.title}`},
        ${tx.json({ kind: d.kind, conceptId: d.conceptId } as never)}
      )
    `;
  });

  revalidatePath("/app/content/materials");
  return {
    ok: true,
    message:
      d.kind === "practice"
        ? `«${d.title}»을 초안으로 만들었습니다. 목록에서 열어 낼 문항을 고르고, 게시해야 학생에게 보입니다.`
        : `«${d.title}»을 초안으로 만들었습니다. 게시해야 학생에게 보입니다.`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 자료 수정.
 *
 * 지금까지 쓰기 액션은 만들기와 상태 전환뿐이었다. 제목 오탈자·잘못 붙인
 * 유튜브 주소·본문 오류·순서·개념 — 어느 것도 고칠 수 없었고 유일한 수단이
 * 「보관 후 재생성」이었다. 그러면 새 material_id가 생기고
 * learner_material_progress는 **옛 id에 남아** 학생이 찍은 「다 봤어요」가
 * 통째로 사라진다. 그 손실을 없애려고 제자리 수정을 연다.
 *
 * **kind는 못 바꾼다.** 두 가지 이유다.
 *  1. DB CHECK(learning_materials_kind_payload_ck)가 kind에 걸려 있어
 *     종류를 바꾸면 payload 컬럼이 통째로 갈아엎여야 한다 — 읽기 본문을
 *     버리고 영상 주소를 요구하는 식이다.
 *  2. 더 큰 이유는 진도의 뜻이 바뀐다는 것이다. 「다 읽었어요」로 찍힌
 *     완료가 종류만 바꾸면 「다 봤어요」로 둔갑한다. 진도는 남는데 그 진도가
 *     가리키던 행위가 사라진다. 종류가 다르면 다른 자료다.
 * ───────────────────────────────────────────────────────────── */

const updateSchema = z.object({
  ...payloadFields,
  materialId: z.uuid(),
  /** 지정 문항 — 콤마로 이은 uuid 목록. 비면 자동 선정으로 돌아간다 */
  questionIds: z.string().default(""),
});

export async function updateMaterialAction(
  _prev: MaterialResult | null,
  formData: FormData,
): Promise<MaterialResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "materials")) {
    return { ok: false, message: "학습 자료를 고칠 권한이 없습니다." };
  }
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "입력을 확인하세요.",
    };
  }
  const d = parsed.data;

  const sql = getSharedSql();
  const [material] = await sql<
    { id: string; kind: string; title: string; status: string; concept_id: string }[]
  >`
    select id::text, kind::text as kind, title, status::text as status,
           concept_id::text as concept_id
    from learning_materials
    where id = ${d.materialId} and organization_id = ${user.organizationId}
  `;
  if (!material) return { ok: false, message: "학습 자료를 찾을 수 없습니다." };

  const kind = material.kind as (typeof KINDS)[number];
  const payload = buildPayload({ ...d, kind });
  if (!payload.ok) return { ok: false, message: payload.message };

  const concept = await findUsableConcept(d.conceptId);
  if (!concept.ok) return concept;

  /* 지정 문항 검증 — 폼이 고른 것만 통과시키지 않고 서버가 다시 본다.
   * 검수 미완·권한 막힌 문항이 들어오면 학생 화면에서 조용히 사라져
   * 교사가 만든 묶음과 학생이 받는 묶음이 달라진다. */
  let questionIds: string[] = [];
  if (kind === "practice") {
    const requested = [
      ...new Set(
        d.questionIds
          .split(",")
          .map((v) => v.trim())
          .filter((v) => /^[0-9a-fA-F-]{36}$/.test(v)),
      ),
    ];
    if (requested.length > 0) {
      const usable = await sql<{ id: string }[]>`
        select q.id::text from questions q
        join content_rights r on r.id = q.content_right_id and r.status = 'usable'
        where q.organization_id = ${user.organizationId}
          and q.review_status = 'published'
          and q.id = any(${requested}::uuid[])
      `;
      const usableIds = new Set(usable.map((r) => r.id));
      const rejected = requested.filter((id) => !usableIds.has(id));
      if (rejected.length > 0) {
        return {
          ok: false,
          message: `고른 문항 ${rejected.length}개가 검수 완료·사용 권한 조건을 만족하지 않습니다. 목록을 새로 고치고 다시 고르세요.`,
        };
      }
      // 고른 순서 그대로 저장한다 — 그 순서가 학생이 푸는 순서다
      questionIds = requested;
    }
  }

  const disclosure = d.disclosure.trim() || null;
  const sourceJobId = d.sourceJobId || null;
  await sql.begin(async (tx) => {
    await tx`
      update learning_materials set
        concept_id = ${d.conceptId},
        title = ${d.title},
        body = ${payload.body === null ? null : tx.json(payload.body as never)},
        video_url = ${payload.videoUrl},
        video_seconds = ${payload.seconds},
        question_ids = ${tx.json(questionIds as never)},
        sort_order = ${d.sortOrder},
        disclosure = ${disclosure},
        source_job_id = ${sourceJobId},
        updated_at = now()
      where id = ${material.id} and organization_id = ${user.organizationId}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, before, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'material.update', 'learning_material', ${material.id},
        ${`${concept.name} — ${d.title}`},
        ${tx.json({ title: material.title, conceptId: material.concept_id } as never)},
        ${tx.json({
          title: d.title,
          conceptId: d.conceptId,
          questionCount: questionIds.length,
        } as never)}
      )
    `;
  });

  revalidatePathsForMaterial();
  return {
    ok: true,
    message:
      material.status === "published"
        ? `«${d.title}»을 고쳤습니다. 게시 중이라 학생 화면에 바로 반영됩니다 — 이미 찍힌 진도는 그대로 남습니다.`
        : `«${d.title}»을 고쳤습니다. 아직 ${material.status === "draft" ? "초안" : "보관"}이라 학생에게는 보이지 않습니다.`,
  };
}

/** 자료 한 건이 바뀌면 저작 목록·상세와 학생의 네 화면이 함께 낡는다 */
function revalidatePathsForMaterial(): void {
  revalidatePath("/app/content/materials");
  revalidatePath("/app/content/materials/[id]", "page");
  for (const p of ["/learn/today", "/learn/study", "/learn/watch", "/learn/practice"]) {
    revalidatePath(p);
  }
}

const statusSchema = z.object({
  materialId: z.uuid(),
  status: z.enum(["draft", "published", "archived"]),
});

export async function setMaterialStatusAction(
  _prev: MaterialResult | null,
  formData: FormData,
): Promise<MaterialResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "materials")) {
    return { ok: false, message: "학습 자료를 관리할 권한이 없습니다." };
  }
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "대상이 지정되지 않았습니다." };
  const { materialId, status } = parsed.data;

  const sql = getSharedSql();
  const [material] = await sql<{ title: string; status: string }[]>`
    select title, status::text as status from learning_materials
    where id = ${materialId} and organization_id = ${user.organizationId}
  `;
  if (!material) return { ok: false, message: "학습 자료를 찾을 수 없습니다." };
  if (material.status === status) {
    return { ok: false, message: "이미 그 상태입니다." };
  }

  await sql.begin(async (tx) => {
    await tx`
      update learning_materials set status = ${status}, updated_at = now()
      where id = ${materialId} and organization_id = ${user.organizationId}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, before, after
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        ${status === "published" ? "material.publish" : status === "archived" ? "material.archive" : "material.unpublish"},
        'learning_material', ${materialId}, ${material.title},
        ${tx.json({ status: material.status } as never)},
        ${tx.json({ status } as never)}
      )
    `;
  });

  /* 학생 화면이 이 상태로 갈린다 — 게시/보관은 즉시 반영되어야 한다 */
  revalidatePathsForMaterial();

  return {
    ok: true,
    message:
      status === "published"
        ? `«${material.title}»을 게시했습니다. 해당 개념을 배우는 학생에게 보입니다.`
        : status === "archived"
          ? `«${material.title}»을 보관했습니다. 학생 화면에서 사라집니다.`
          : `«${material.title}»을 초안으로 되돌렸습니다.`,
  };
}
