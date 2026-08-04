import "server-only";
import { getSharedSql } from "@su-maek/db";
import type { IsoDate } from "@su-maek/core/shared";
import { projectToday } from "./day-plan";
import {
  buildPreviewRow,
  summarizePreview,
  type LearnerPreviewRow,
  type PreviewSummary,
} from "./readiness-preview";

/* 날짜별 준비도 읽기 모델 (T5.4).
 *
 * 학생마다 투영기를 `persist: false`로 돌린다 — 계산은 학생 화면과 **같은
 * 함수**이고, 다른 것은 계획을 남기지 않는다는 점뿐이다. 여기서 따로 계산
 * 하면 교사가 미리 본 화면과 학생이 보는 화면이 갈린다. */

export interface DayReadiness {
  learningGroupId: string;
  learningGroupName: string;
  learners: LearnerPreviewRow[];
  summary: PreviewSummary;
}

export async function loadDayReadiness(input: {
  organizationId: string;
  date: IsoDate;
  learningGroupId?: string | null;
  /** 담당 범위 밖의 반을 빼기 위한 목록. null이면 조직 전체. */
  allowedGroupIds?: string[] | null;
}): Promise<DayReadiness[]> {
  const sql = getSharedSql();
  const rows = await sql<
    {
      group_id: string;
      group_name: string;
      learner_id: string;
      display_name: string;
      has_account: boolean;
    }[]
  >`
    select g.id::text as group_id, g.name as group_name,
           l.id::text as learner_id, l.display_name,
           (l.user_id is not null) as has_account
    from learning_group_memberships m
    join learning_groups g on g.id = m.learning_group_id
    join learners l on l.id = m.learner_id
    where m.organization_id = ${input.organizationId}
      and m.status = 'active' and g.status = 'operating' and l.status = 'active'
      and (${input.learningGroupId ?? null}::uuid is null
           or g.id = ${input.learningGroupId ?? null}::uuid)
      and (${input.allowedGroupIds ?? null}::uuid[] is null
           or g.id = any(${input.allowedGroupIds ?? null}::uuid[]))
    order by g.name, l.display_name, l.id
  `;

  const byGroup = new Map<string, DayReadiness>();
  for (const r of rows) {
    /* 투영은 학생마다 한 번이다. 반이 크면 그만큼 돈다 — 그래서 이 화면은
     * 날짜·반을 **골라서** 본다(전체를 한 번에 훑지 않는다). */
    const view = await projectToday({
      learner: { organizationId: input.organizationId, learnerId: r.learner_id },
      today: input.date,
      persist: false,
    });

    let entry = byGroup.get(r.group_id);
    if (!entry) {
      entry = {
        learningGroupId: r.group_id,
        learningGroupName: r.group_name,
        learners: [],
        summary: summarizePreview([]),
      };
      byGroup.set(r.group_id, entry);
    }
    entry.learners.push(
      buildPreviewRow({
        learnerId: r.learner_id,
        displayName: r.display_name,
        hasAccount: r.has_account,
        plan: {
          status: view.plan.status,
          requiredTotal: view.plan.required.total,
          requiredSatisfied: view.plan.required.satisfied,
          blockedReasons: view.plan.blockedReasons,
          itemCount: view.plan.items.length,
        },
      }),
    );
  }

  for (const entry of byGroup.values()) {
    entry.summary = summarizePreview(entry.learners);
  }
  return [...byGroup.values()];
}
