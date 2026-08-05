"use server";
import { contentOrganizationIds } from "@su-maek/db";

import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getSharedSql } from "@su-maek/db";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";

/* 사용 권한 상태 집행 (27장·인수 30) — 중지 즉시 신규 출제 풀에서 빠지고
 * (출제 필터가 status='usable'만 허용), 같은 트랜잭션의 Outbox 이벤트로
 * 워커가 영향 자료 목록을 만든다. 이미 배정·응시된 과거는 소급하지 않는다. */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const schema = z.object({
  rightId: z.uuid(),
  action: z.enum(["block", "restore"]),
  reason: z.string().default(""),
});

export async function changeRightStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWrite(DEFAULT_MATRIX, user.role, "books")) {
    return { ok: false, message: "사용 권한을 변경할 권한이 없습니다." };
  }
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: "대상 권한이 지정되지 않았습니다." };
  }
  const reason = parsed.data.reason.trim();
  if (parsed.data.action === "block" && !reason) {
    return { ok: false, message: "중지 사유를 입력하세요 (감사 기록에 남습니다)." };
  }

  const sql = getSharedSql();
  const [right] = await sql<
    { id: string; status: string; book_edition_id: string | null; rights_holder: string | null }[]
  >`
    select id, status::text as status, book_edition_id, rights_holder
    from content_rights
    where id = ${parsed.data.rightId} and organization_id = ${user.organizationId}
  `;
  if (!right) return { ok: false, message: "사용 권한을 찾을 수 없습니다." };

  if (parsed.data.action === "block") {
    if (right.status === "blocked") {
      return { ok: false, message: "이미 중지된 권한입니다." };
    }
    const [count] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from questions
      where organization_id = any(${contentOrganizationIds(user.organizationId)}::uuid[])
        and (content_right_id = ${right.id}
             or (${right.book_edition_id}::uuid is not null
                 and book_edition_id = ${right.book_edition_id}))
    `;
    const affected = count?.cnt ?? 0;

    await sql.begin(async (tx) => {
      await tx`
        update content_rights
        set status = 'blocked', status_changed_by = ${user.userId},
            status_changed_at = now(), updated_at = now()
        where id = ${right.id}
      `;
      await tx`
        insert into outbox_events (
          id, organization_id, aggregate_type, aggregate_id, aggregate_version,
          event_type, occurred_at, payload
        ) values (
          ${uuidv7()}, ${user.organizationId}, 'content_right', ${right.id}, 1,
          'ContentRightsRevoked', now(),
          ${tx.json({
            contentRightId: right.id,
            bookEditionId: right.book_edition_id,
            affectedQuestionCount: affected,
          } as never)}
        )
      `;
      await tx`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action, target_type, target_id,
          reason, after
        ) values (
          ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
          'content.rights-revoke', 'content_right', ${right.id}, ${reason},
          ${tx.json({ affectedQuestionCount: affected } as never)}
        )
      `;
    });

    revalidatePath("/app/content/books");
    revalidatePath("/app/content/questions");
    return {
      ok: true,
      message: `사용을 중지했습니다. 영향 문항 ${affected}개는 신규 출제에서 즉시 제외되며, 열려 있는 테스트 영향 목록은 업무함으로 전달됩니다.`,
    };
  }

  /* restore */
  if (right.status !== "blocked") {
    return { ok: false, message: "중지 상태의 권한만 다시 사용 가능으로 바꿀 수 있습니다." };
  }
  await sql.begin(async (tx) => {
    await tx`
      update content_rights
      set status = 'usable', status_changed_by = ${user.userId},
          status_changed_at = now(), updated_at = now()
      where id = ${right.id}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason
      ) values (
        ${uuidv7()}, ${user.organizationId}, 'user', ${user.userId},
        'content.rights-restore', 'content_right', ${right.id}, ${reason || null}
      )
    `;
  });
  revalidatePath("/app/content/books");
  revalidatePath("/app/content/questions");
  return { ok: true, message: "다시 사용 가능으로 바꿨습니다. 신규 출제 풀에 복귀합니다." };
}
