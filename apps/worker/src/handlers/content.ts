import { v7 as uuidv7 } from "uuid";
import { getSharedSql, tryMarkInbox, type ClaimedJob } from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 사용 권한 회수 영향 분석 (27장·인수 30).
 * ContentRightsRevoked → 영향 문항·열려 있는 테스트 목록을 만들어
 * 업무함으로 전달한다. 신규 출제 제외는 출제 풀 필터가 이미 담당하므로
 * (status='usable'만 진입) 여기서는 "이미 노출된 표면"만 알린다.
 * 과거 확정 응시는 소급하지 않는다.
 * ───────────────────────────────────────────────────────────── */

interface EventJobPayload {
  eventId: string;
  eventType: string;
  payload: {
    contentRightId?: string;
    bookEditionId?: string | null;
    affectedQuestionCount?: number;
  };
}

export async function handleRightsImpact(job: ClaimedJob): Promise<unknown> {
  const sql = getSharedSql();
  const data = job.payload as EventJobPayload;
  const organizationId = job.organization_id;
  if (!organizationId) return { skipped: "조직 없음" };

  const fresh = await sql.begin((tx) =>
    tryMarkInbox(tx as never, "content.rights-impact", data.eventId),
  );
  if (!fresh) return { skipped: "중복 이벤트 (inbox)" };

  const rightId = data.payload?.contentRightId;
  if (!rightId) return { skipped: "contentRightId 없음" };
  const editionId = data.payload?.bookEditionId ?? null;

  /* 영향 문항: 이 권한에 직접 묶였거나 같은 판본에 속한 문항 */
  const affected = await sql<{ id: string }[]>`
    select id from questions
    where organization_id = ${organizationId}
      and (content_right_id = ${rightId}
           or (${editionId}::uuid is not null and book_edition_id = ${editionId}))
  `;
  const affectedIds = affected.map((q) => q.id);

  /* 이미 노출된 표면: 아직 닫히지 않은 테스트에 스냅샷으로 들어간 문항 */
  const openAssessments = affectedIds.length
    ? await sql<{ id: string; title: string; status: string }[]>`
        select distinct a.id, a.title, a.status::text as status
        from assessment_instances a
        join assessment_questions aq on aq.assessment_id = a.id
        where a.organization_id = ${organizationId}
          and aq.question_id = any(${affectedIds}::uuid[])
          and a.status in ('published', 'open', 'grading')
        order by a.title
      `
    : [];

  const recipients = await sql<{ user_id: string }[]>`
    select user_id from memberships
    where organization_id = ${organizationId}
      and status = 'active'
      and role in ('owner', 'program_director', 'content_manager')
  `;
  for (const r of recipients) {
    await sql`
      insert into notifications (
        id, organization_id, recipient_user_id, kind, title, body, link_path,
        related_type, related_id, group_key
      ) values (
        ${uuidv7()}, ${organizationId}, ${r.user_id}, 'content_review',
        '사용 권한 회수 — 영향 자료 목록',
        ${sql.json({
          what: `영향 문항 ${affectedIds.length}개, 열려 있는 테스트 ${openAssessments.length}건`,
          why: "ContentRightsRevoked",
          action:
            openAssessments.length > 0
              ? "열려 있는 테스트의 문항을 교체하거나 테스트를 닫으세요"
              : "신규 출제는 이미 자동 제외되었습니다",
          openAssessments: openAssessments
            .slice(0, 10)
            .map((a) => ({ id: a.id, title: a.title, status: a.status })),
        } as never)},
        '/app/content/books', 'content_right', ${rightId},
        ${`rights-impact:${rightId}`}
      )
    `;
  }

  return {
    affectedQuestions: affectedIds.length,
    openAssessments: openAssessments.length,
    notified: recipients.length,
  };
}
