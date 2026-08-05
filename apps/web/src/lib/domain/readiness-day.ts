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

/* 학생 투영을 몇 명씩 겹쳐 돌릴지.
 *
 * 투영 한 번은 DB 왕복 7~9회이고 그 대부분이 **직렬**이다 — 앞 질의의 결과가
 * 다음 질의의 인자다. 그래서 이 화면의 시간은 「DB가 일한 시간」이 아니라
 * 「왕복 횟수 × 지연」이다. 실측: 학생 5명 · 질의 47회 · DB 실행 합계 13ms에
 * 페이지 11.3초(함수 iad1 · DB 서울). 학생을 한 명씩 줄 세우면 그 47회가
 * 전부 한 줄이 된다.
 *
 * 상한을 두는 이유는 공유 풀이 max 10이기 때문이다(client.ts). 투영 하나가
 * 한때 3건까지 동시에 물으므로 6명이면 최대 18건 — 풀을 넘는 만큼은
 * postgres.js가 큐에 세우니 안전하지만, 더 올려도 이득이 없다.
 * 무제한으로 풀면 반 하나(30명)가 풀을 통째로 점거해 같은 순간의 다른
 * 요청을 굶긴다. */
const PROJECTION_CONCURRENCY = 6;

/** 순서를 지키면서 최대 `limit`명씩 겹쳐 돌린다. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await run(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
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

  /* 투영은 학생마다 한 번이다. 반이 크면 그만큼 돈다 — 그래서 이 화면은
   * 날짜·반을 **골라서** 본다(전체를 한 번에 훑지 않는다). 다만 골라 본
   * 뒤에도 학생 사이에는 의존이 없다: A의 준비도는 B의 결과를 쓰지 않는다.
   * 줄 세울 이유가 없어 겹쳐 돌린다. */
  const views = await mapWithLimit(rows, PROJECTION_CONCURRENCY, (r) =>
    projectToday({
      learner: { organizationId: input.organizationId, learnerId: r.learner_id },
      today: input.date,
      persist: false,
    }),
  );

  const byGroup = new Map<string, DayReadiness>();
  for (const [i, r] of rows.entries()) {
    const view = views[i]!;

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
