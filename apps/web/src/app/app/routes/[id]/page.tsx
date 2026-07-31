import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import type { RouteValidationReport } from "@su-maek/core/routes";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MaterializeButton } from "../MaterializeButton";
import {
  AddNodeForm,
  NewVersionButton,
  NodeRowActions,
  ValidatePublishControls,
} from "../RouteBuilderForms";

export const metadata: Metadata = { title: "루트 빌더" };

/* 루트 빌더 (13장) — 노드 편집 → 검증 → 게시.
 * 게시된 버전은 불변이며 편집은 초안 버전에서만 한다 (불변 조건 2). */

const NODE_KIND_LABEL: Record<string, string> = {
  concept_lesson: "개념 수업",
  problem_solving: "문제 풀이",
  book_range: "교재 범위",
  homework: "숙제",
  daily_test: "일일테스트",
  confirmation_test: "확인테스트",
  wrong_answer_review: "오답 복습",
  remediation: "보충",
  cumulative_review: "누적 복습",
  buffer: "버퍼",
  break: "휴강 구간",
  custom: "사용자 정의",
};

const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  validating: "검증 중",
  needs_fix: "수정 필요",
  publishable: "게시 가능",
  published: "게시됨",
  superseded: "대체됨",
  archived: "보관",
};

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
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [plan] = await sql<
    {
      id: string;
      kind: string;
      name: string;
      status: string;
      target_end_date: string | null;
      active_version_id: string | null;
      group_id: string | null;
      group_name: string | null;
      learner_name: string | null;
    }[]
  >`
    select p.id, p.kind, p.name, p.status, p.target_end_date::text as target_end_date,
           p.active_version_id,
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
                    <NodeRowActions planId={plan.id} nodeId={n.id} />
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 border-t border-rule-soft pt-4">
            <h3 className="text-sm font-semibold">노드 추가</h3>
            <AddNodeForm planId={plan.id} concepts={concepts} />
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
