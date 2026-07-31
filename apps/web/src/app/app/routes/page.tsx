import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MaterializeButton } from "./MaterializeButton";

export const metadata: Metadata = { title: "학습 루트" };

/* 학습 루트 목록 (13장 축소판) — 게시 상태·노드·일정 실체화.
 * 루트 빌더 편집 화면은 후속 단계. */

export default async function RoutesPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const routes = await sql<
    {
      plan_id: string;
      name: string;
      status: string;
      group_id: string | null;
      group_name: string | null;
      version_number: number | null;
      node_count: number;
      target_end_date: string | null;
      future_sessions: number;
    }[]
  >`
    select p.id as plan_id, p.name, p.status,
           g.id as group_id, g.name as group_name,
           v.version_number,
           (select count(*)::int from route_nodes n where n.route_version_id = v.id) as node_count,
           p.target_end_date::text as target_end_date,
           (select count(*)::int from sessions s
             where s.learning_group_id = g.id and s.session_date >= current_date) as future_sessions
    from route_plans p
    left join route_versions v on v.id = p.active_version_id
    left join learning_groups g on g.id = p.learning_group_id
    where p.organization_id = ${user.organizationId}
    order by p.updated_at desc
  `;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">학습 루트</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        게시된 루트에서 수업일·휴일을 반영한 미래 일정을 생성합니다. 완료된
        과거와 잠긴 일정은 변경되지 않습니다.
      </p>

      {routes.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">아직 학습 루트가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            루트 템플릿에서 반 루트를 만들어 게시하세요.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {routes.map((r) => (
            <li key={r.plan_id} className="rounded-lg border border-rule bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{r.name}</p>
                  <p className="mt-1 font-mono text-xs text-ink-soft">
                    {r.group_name ?? "그룹 미지정"} ·{" "}
                    {r.version_number !== null ? `v${r.version_number} 게시됨` : "미게시"} ·
                    노드 {r.node_count}개
                    {r.target_end_date && ` · 목표 ${r.target_end_date}`}
                  </p>
                  <p className="mt-1 font-mono text-xs text-ink-soft">
                    예정된 미래 수업 {r.future_sessions}건
                  </p>
                </div>
                {r.status === "published" && r.group_id && (
                  <MaterializeButton learningGroupId={r.group_id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
