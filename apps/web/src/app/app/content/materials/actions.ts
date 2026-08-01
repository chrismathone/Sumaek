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

const createSchema = z.object({
  conceptId: z.uuid("개념을 선택하세요."),
  kind: z.enum(KINDS),
  title: z.string().trim().min(1, "제목을 입력하세요.").max(200),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  body: z.string().default(""),
  videoUrl: z.string().default(""),
  videoMinutes: z.coerce.number().int().min(0).max(600).default(0),
  videoSeconds: z.coerce.number().int().min(0).max(59).default(0),
});

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

  /* 종류별 필수값 — DB CHECK와 같은 기준 */
  let bodyBlocks: unknown = null;
  let videoUrl: string | null = null;
  let seconds: number | null = null;

  if (d.kind === "reading") {
    const text = d.body.trim();
    if (!text) return { ok: false, message: "개념 설명 본문을 입력하세요." };
    /* 현재 실사용 형식 그대로 — 텍스트 한 블록. 수식은 $…$로 본문에 섞어 쓴다
     * (시드·반입 파이프라인이 만드는 모양과 동일해야 렌더 경로가 갈리지 않는다). */
    bodyBlocks = [{ type: "text", text }];
  } else if (d.kind === "video") {
    const id = parseYouTubeId(d.videoUrl);
    if (!id) {
      return {
        ok: false,
        message: d.videoUrl.trim()
          ? "유튜브 주소만 등록할 수 있습니다 (youtube.com 또는 youtu.be)."
          : "강의 영상 주소를 입력하세요.",
      };
    }
    videoUrl = youTubeWatchUrl(id);
    const total = d.videoMinutes * 60 + d.videoSeconds;
    seconds = total > 0 ? total : null;
  }

  const sql = getSharedSql();
  const [concept] = await sql<{ id: string; name: string }[]>`
    select id::text, name from canonical_concepts where id = ${d.conceptId}
  `;
  if (!concept) return { ok: false, message: "개념을 찾을 수 없습니다." };

  const materialId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, body,
        video_url, video_seconds, question_ids, sort_order, status, created_by
      ) values (
        ${materialId}, ${user.organizationId}, ${d.conceptId}, ${d.kind},
        ${d.title}, ${bodyBlocks === null ? null : tx.json(bodyBlocks as never)},
        ${videoUrl}, ${seconds}, '[]'::jsonb, ${d.sortOrder}, 'draft', ${user.userId}
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
    message: `«${d.title}»을 초안으로 만들었습니다. 게시해야 학생에게 보입니다.`,
  };
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
  revalidatePath("/app/content/materials");
  for (const p of ["/learn/today", "/learn/study", "/learn/watch", "/learn/practice"]) {
    revalidatePath(p);
  }

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
