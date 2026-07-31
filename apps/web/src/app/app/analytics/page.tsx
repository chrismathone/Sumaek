import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MASTERY_STATE_LABEL, MASTERY_STATES } from "@/lib/format";

export const metadata: Metadata = { title: "개념 숙련도" };

/* 개념 숙련도 개요 — 개념별 학습자 상태 분포.
 * 취약(탐색 중·부분 이해·재점검 필요) 학생 수가 많은 개념부터 보여준다.
 * 집계는 concept_masteries 행을 그대로 센 것이며 추정·보정하지 않는다. */

interface ConceptRow {
  concept_id: string;
  name: string;
  domain_name: string | null;
  grade_band: string | null;
  learner_count: number;
  weak_count: number;
  n_no_evidence: number;
  n_exploring: number;
  n_partial: number;
  n_stable: number;
  n_transfer_confirmed: number;
  n_recheck_needed: number;
}

export default async function AnalyticsPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const concepts = await sql<ConceptRow[]>`
    select c.id as concept_id, c.name, c.domain_name, c.grade_band,
           count(*)::int as learner_count,
           count(*) filter (
             where cm.state in ('exploring', 'partial', 'recheck_needed')
           )::int as weak_count,
           count(*) filter (where cm.state = 'no_evidence')::int as n_no_evidence,
           count(*) filter (where cm.state = 'exploring')::int as n_exploring,
           count(*) filter (where cm.state = 'partial')::int as n_partial,
           count(*) filter (where cm.state = 'stable')::int as n_stable,
           count(*) filter (where cm.state = 'transfer_confirmed')::int as n_transfer_confirmed,
           count(*) filter (where cm.state = 'recheck_needed')::int as n_recheck_needed
    from concept_masteries cm
    join canonical_concepts c on c.id = cm.concept_id
    where cm.organization_id = ${user.organizationId}
    group by c.id, c.name, c.domain_name, c.grade_band
    order by weak_count desc, learner_count desc, c.name
    limit 100
  `;

  const totals: Record<string, number> = {
    no_evidence: 0,
    exploring: 0,
    partial: 0,
    stable: 0,
    transfer_confirmed: 0,
    recheck_needed: 0,
  };
  for (const c of concepts) {
    totals["no_evidence"]! += c.n_no_evidence;
    totals["exploring"]! += c.n_exploring;
    totals["partial"]! += c.n_partial;
    totals["stable"]! += c.n_stable;
    totals["transfer_confirmed"]! += c.n_transfer_confirmed;
    totals["recheck_needed"]! += c.n_recheck_needed;
  }
  const totalRows = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 숙련도</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        개념별 학습자 상태 분포입니다. 취약(탐색 중·부분 이해·재점검 필요)
        학생이 많은 개념이 위에 옵니다.
      </p>

      {totalRows === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">아직 집계할 숙련도 근거가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            테스트 채점이 확정되면 개념별 증거가 쌓이고 상태가 계산됩니다.
          </p>
          <Link
            href="/app/tests"
            className="mt-4 inline-block rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
          >
            일일·확인테스트로 이동
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {MASTERY_STATES.map((s) => (
              <div
                key={s}
                className={`rounded-lg border p-3 ${
                  s === "recheck_needed"
                    ? "border-highlight bg-highlight-soft"
                    : "border-rule bg-surface"
                }`}
              >
                <p className="text-xs text-ink-soft">{MASTERY_STATE_LABEL[s]}</p>
                <p className="mt-1 font-mono text-lg font-bold">
                  {totals[s] ?? 0}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-xs text-ink-soft">
            개념 {concepts.length}개 · 학습자·개념 조합 {totalRows}건
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
                  <th className="px-4 py-2 font-medium">개념</th>
                  <th className="px-4 py-2 text-right font-medium">학습자</th>
                  <th className="px-4 py-2 text-right font-medium">취약</th>
                  {MASTERY_STATES.map((s) => (
                    <th key={s} className="px-3 py-2 text-right font-medium">
                      {MASTERY_STATE_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft">
                {concepts.map((c) => (
                  <tr key={c.concept_id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{c.name}</span>
                      {(c.domain_name || c.grade_band) && (
                        <span className="ml-2 text-xs text-ink-soft">
                          {[c.grade_band, c.domain_name].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink-soft">
                      {c.learner_count}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono ${
                        c.weak_count > 0 ? "font-bold text-grade" : "text-ink-soft"
                      }`}
                    >
                      {c.weak_count}
                    </td>
                    {MASTERY_STATES.map((s) => (
                      <td
                        key={s}
                        className="px-3 py-2.5 text-right font-mono text-ink-soft"
                      >
                        {stateCount(c, s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function stateCount(row: ConceptRow, state: (typeof MASTERY_STATES)[number]): number {
  switch (state) {
    case "recheck_needed":
      return row.n_recheck_needed;
    case "exploring":
      return row.n_exploring;
    case "partial":
      return row.n_partial;
    case "stable":
      return row.n_stable;
    case "transfer_confirmed":
      return row.n_transfer_confirmed;
    case "no_evidence":
      return row.n_no_evidence;
  }
}
