"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { processSourceFile, type ProcessResult } from "@su-maek/db/domain";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME = new Set(["application/pdf"]);
const BUCKET = "sources";

export interface UploadState {
  ok: boolean;
  message: string;
  result?: ProcessResult;
}

/**
 * 원본 업로드 → 저장 → (mock 공급자) 즉시 추출 → 검수 대기.
 * 실제 AI 공급자에서는 추출이 비동기 작업 큐로 격리된다.
 */
export async function uploadSourceFile(
  _prev: UploadState | null,
  formData: FormData,
): Promise<UploadState> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "ingestion")) {
    return { ok: false, message: "문제집 변환 권한이 없습니다." };
  }

  const file = formData.get("file");
  const rightsHolder = String(formData.get("rightsHolder") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "PDF 파일을 선택하세요." };
  }
  if (!rightsHolder) {
    return {
      ok: false,
      message: "권리자·출처를 입력하세요. 출처 불명 파일은 반입할 수 없습니다.",
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "파일이 20MB 제한을 초과합니다." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // 확장자가 아니라 실제 파일 서명 검사 (27장)
  const isPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  if (!isPdf || !ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      message: "PDF 형식이 아닙니다. 파일 서명 검사에 실패했습니다.",
    };
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const sql = getSharedSql();

  /* 중복 원본 — 같은 해시는 재등록하지 않는다 */
  const [dup] = await sql<{ id: string }[]>`
    select id from source_files
    where organization_id = ${user.organizationId} and checksum = ${checksum}
  `;
  if (dup) {
    return {
      ok: false,
      message: "이미 등록된 원본입니다 (동일 해시). 기존 파일의 검수를 진행하세요.",
    };
  }

  /* 객체 스토리지 업로드 — {organization_id}/sources/{id} 경로 규약 */
  const sourceFileId = uuidv7();
  const storagePath = `${user.organizationId}/sources/${sourceFileId}.pdf`;
  const admin = createAdminClient();
  await admin.storage
    .createBucket(BUCKET, { public: false })
    .catch(() => undefined); // 이미 있으면 무시
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "application/pdf" });
  if (uploadError && !/already exists/i.test(uploadError.message)) {
    return {
      ok: false,
      message: `원본 저장에 실패했습니다: ${uploadError.message}. 다시 시도하세요.`,
    };
  }

  const rightId = uuidv7();
  await sql.begin(async (tx) => {
    await tx`
      insert into content_rights (
        id, organization_id, rights_holder, status, evidence_ref
      ) values (
        ${rightId}, ${user.organizationId}, ${rightsHolder}, 'under_review',
        ${sourceFileId}
      )
    `;
    await tx`
      insert into source_files (
        id, organization_id, storage_path, file_name, mime_type, byte_size,
        checksum, page_count, status, uploaded_by, scan_result
      ) values (
        ${sourceFileId}, ${user.organizationId}, ${storagePath}, ${file.name},
        'application/pdf', ${file.size}, ${checksum}, 1, 'uploaded',
        ${user.userId},
        ${tx.json({ signature: "pdf", sizeOk: true } as never)}
      )
    `;
    /* 배치 작업 기록 — mock은 동기 처리지만 이력은 남긴다 */
    await tx`
      insert into jobs (organization_id, topic, priority, payload, status, idempotency_key, meta)
      values (
        ${user.organizationId}, 'ingestion.process', 300,
        ${tx.json({ sourceFileId } as never)}, 'succeeded',
        ${`ingestion.process:${checksum}`},
        ${tx.json({ mode: "sync-mock" } as never)}
      )
      on conflict (topic, idempotency_key) where idempotency_key is not null do nothing
    `;
  });

  const result = await processSourceFile({
    organizationId: user.organizationId,
    sourceFileId,
    actorUserId: user.userId,
  });

  revalidatePath("/app/content/ingestion");
  revalidatePath("/app/content/questions");
  revalidatePath("/app/content/review");
  return { ok: result.ok, message: result.message, result };
}

export async function approveQuestionAction(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "content_review")) {
    return { ok: false, message: "검수 권한이 없습니다." };
  }
  const { approveQuestion } = await import("@su-maek/db/domain");
  const result = await approveQuestion({
    organizationId: user.organizationId,
    questionId: String(formData.get("questionId") ?? ""),
    reviewerUserId: user.userId,
    note: String(formData.get("note") ?? "") || undefined,
  } as Parameters<typeof approveQuestion>[0]);
  revalidatePath("/app/content/review");
  revalidatePath("/app/content/questions");
  return result;
}
