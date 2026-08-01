import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import {
  encodeRouteSnapshot,
  type RouteValidationReport,
} from "@su-maek/core/routes";
import { requireAccess } from "@/lib/auth/require-access";
import { MaterializeButton } from "../MaterializeButton";
import {
  AddNodeForm,
  NewVersionButton,
  NodeRowActions,
  ValidatePublishControls,
} from "../RouteBuilderForms";
import { NODE_KIND_LABEL, PLAN_STATUS_LABEL } from "../shared";

export const metadata: Metadata = { title: "루트 빌더" };

/* 루트 빌더 (13장) — 노드 편집 → 검증 → 게시.
 * 게시된 버전은 불변이며 편집은 초안 버전에서만 한다 (불변 조건 2). */

interface NodeRow {
  id: string;
  kind: string;
  title: string;
  sort_order: number;
  concept_ids: unknown;
  expected_minutes: number | null;
}

export default async function RouteBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAccess("routes");
  const sql = getSharedSql();

  const [plan] = await sql<
    {
      id: string;
      kind: string;
      name: string;
      status: string;
      target_end_date: string | null;
      active_version_id: string | null;
      lock_version: number;
      group_id: string | null;
      group_name: string | null;
      learner_name: string | null;
    }[]
  >`
    select p.id, p.kind, p.name, p.status, p.target_end_date::text as target_end_date,
           p.active_version_id, p.lock_version,
           g.id as group_id, g.name as group_name,
           l.display_name as learner_name
    from route_plans p
    left join learning_groups g on g.id = p.learning_group_id
    left join learners l on l.id = p.learner_id
    where p.id = ${id} and p.organization_id = ${user.organizationId}
  `;
  if (!plan) notFound();

  const [draftVersion] = await sql<
    { id: string; version_number: number; status: string; validation_report: RouteValidationReport | null }[]
  >`
    select id, version_number, status, validation_report from route_versions
    where organization_id = ${user.organizationId} and route_plan_id = ${plan.id}
      and status in ('draft', 'needs_fix', 'publishable')
    order by version_number desc limit 1
  `;

  const [draftNodes, activeNodes, concepts] = await Promise.all([
    draftVersion
      ? sql<NodeRow[]>`
          select id, kind, title, sort_order, concept_ids, expected_minutes
          from route_nodes where route_version_id = ${draftVersion.id}
          order by sort_order
        `
      : Promise.resolve([] as NodeRow[]),
    plan.active_version_id
      ? sql<NodeRow[]>`
          select id, kind, title, sort_order, concept_ids, expected_minutes
          from route_nodes where route_version_id = ${plan.active_version_id}
          order by sort_order
        `
      : Promise.resolve([] as NodeRow[]),
    sql<{ id: string; name: string }[]>`
      select id, name from canonical_concepts
      where status in ('reviewed', 'active')
      order by name limit 100
    `,
  ]);

  const conceptNameById = new Map(concepts.map((c) => [c.id, c.name]));
  const report = draftVersion?.validation_report ?? null;

  /* 편집 폼이 함께 실어 보낼 "읽은 시점"의 노드 목록 (인수 20 충돌 diff).
   * 충돌이 나면 서버가 이 스냅샷과 저장된 최신 상태를 비교해 무엇이 달라졌는지
   * 항목 단위로 돌려준다 — 왜 폼에 싣는지는 core/routes/conflict.ts 참고.
   *
   * lock_version을 노드보다 **먼저** 읽는 순서가 중요하다: 그 사이에 남이
   * 저장하면 토큰만 낡은 쪽으로 어긋나므로 최악이 "이미 반영된 변경까지
   * 충돌로 보고"이고, 순서를 뒤집으면 지나간 상태를 최신으로 착각한다.
   * 쓰기 허용 여부는 어차피 서버의 조건부 UPDATE가 정한다. */
  const baselineNodes = encodeRouteSnapshot(
    draftNodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      sortOrder: n.sort_order,
      expectedMinutes: n.expected_minutes ?? 60,
    })),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-mono text-xs text-ink-soft">
        <Link href="/app/routes" className="hover:underline">학습 루트</Link>
        {" / "}{plan.name}
      </p>
      <h1 className="mt-1 font-[MaruBuri] text-2xl font-semibold">{plan.name}</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {plan.kind === "learner_route"
          ? `학생 독립 루트 · ${plan.learner_name ?? "학생 미지정"} — 이 루트는 반 공통 루트와 다른 학생에게 영향을 주지 않습니다`
          : `반 공통 루트 · ${plan.group_name ?? "반 미지정"}`}
        {" · "}{PLAN_STATUS_LABEL[plan.status] ?? plan.status}
        {plan.target_end_date && ` · 목표 ${plan.target_end_date}`}
      </p>

      {draftVersion ? (
        <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              v{draftVersion.version_number} 초안 편집
            </h2>
            <span className="rounded-[var(--radius-control)] border border-rule px-2 py-1 font-mono text-xs">
              {PLAN_STATUS_LABEL[draftVersion.status] ?? draftVersion.status}
            </span>
          </div>

          {draftNodes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              아직 노드가 없습니다. 아래에서 수업·테스트 노드를 추가하세요.
            </p>
          ) : (
            <ol className="mt-3 divide-y divide-rule-soft border-t border-rule-soft">
              {draftNodes.map((n) => {
                const ids = Array.isArray(n.concept_ids)
                  ? (n.concept_ids as string[])
                  : [];
                return (
                  <li key={n.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-ink-soft">
                        {n.sort_order}.
                      </span>{" "}
                      <span className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 text-xs">
                        {NODE_KIND_LABEL[n.kind] ?? n.kind}
                      </span>{" "}
                      <span className="font-medium">{n.title}</span>
                      <span className="ml-2 font-mono text-xs text-ink-soft">
                        {n.expected_minutes ?? 60}분
                      </span>
                      {ids.length > 0 && (
                        <span className="ml-2 text-xs text-ink-soft">
                          {ids.map((cid) => conceptNameById.get(cid) ?? "개념").join(", ")}
                        </span>
                      )}
                    </p>
                    <NodeRowActions
                      planId={plan.id}
                      nodeId={n.id}
                      lockVersion={plan.lock_version}
                      baselineNodes={baselineNodes}
                    />
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 border-t border-rule-soft pt-4">
            <h3 className="text-sm font-semibold">노드 추가</h3>
            <AddNodeForm
              planId={plan.id}
              lockVersion={plan.lock_version}
              baselineNodes={baselineNodes}
              concepts={concepts}
            />
          </div>

          {report && (
            <div className="mt-4 rounded-[var(--radius-control)] border border-rule bg-paper p-4">
              <h3 className="text-sm font-semibold">
                검증 결과 — {report.ok ? "통과" : `문제 ${report.issues.length}건`}
              </h3>
              <p className="mt-1 font-mono text-xs text-ink-soft">
                총 {report.summary.totalMinutes}분 / 가용 {report.summary.availableMinutes}분
                · 개념 {report.summary.conceptsCovered}개 커버
                {report.summary.conceptsMissing > 0 &&
                  ` · 누락 ${report.summary.conceptsMissing}개`}
              </p>
              {report.issues.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-grade">
                  {report.issues.map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>
                      <span className="font-mono text-xs">{issue.code}</span>{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ValidatePublishControls
            planId={plan.id}
            canPublish={draftVersion.status === "publishable" && report?.ok === true}
            lockVersion={plan.lock_version}
            baselineNodes={baselineNodes}
          />
        </section>
      ) : (
        <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">게시된 활성 버전</h2>
            <div className="flex items-center gap-3">
              <NewVersionButton planId={plan.id} />
              {plan.status === "published" && plan.group_id && (
                <MaterializeButton learningGroupId={plan.group_id} />
              )}
            </div>
          </div>
          {activeNodes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">게시된 노드가 없습니다.</p>
          ) : (
            <ol className="mt-3 divide-y divide-rule-soft border-t border-rule-soft">
              {activeNodes.map((n) => (
                <li key={n.id} className="py-2.5 text-sm">
                  <span className="font-mono text-xs text-ink-soft">
                    {n.sort_order}.
                  </span>{" "}
                  <span className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 text-xs">
                    {NODE_KIND_LABEL[n.kind] ?? n.kind}
                  </span>{" "}
                  <span className="font-medium">{n.title}</span>
                  <span className="ml-2 font-mono text-xs text-ink-soft">
                    {n.expected_minutes ?? 60}분
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            게시된 버전은 변경할 수 없습니다. 수정하려면 새 버전을 만들어
            검증·게시하세요.
          </p>
        </section>
      )}
    </div>
  );
}
