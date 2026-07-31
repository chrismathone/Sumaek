import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "커리큘럼 스튜디오" };

/* 커리큘럼 스튜디오 축소판 (14장).
 *
 * canonical_concepts·concept_edges는 워크스페이스 소유가 아니라 플랫폼 공유
 * 참조 데이터다 (ADR-0011) — organization_id 필터가 없다. 반면 "연결 문항 수"는
 * 워크스페이스의 문항이므로 org로 좁힌다.
 *
 * 2K 규칙 3: 내부 개념 체계를 공식 성취기준처럼 표시하지 않는다. */

const CONCEPT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  reviewed: "검토 완료",
  active: "활성",
  deprecated: "폐기",
};

const SCHOOL_LEVEL_LABEL: Record<string, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

export default async function CurriculumStudioPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [concepts, edges, authority] = await Promise.all([
    sql<
      {
        id: string;
        name: string;
        slug: string;
        school_level: string | null;
        grade_band: string | null;
        domain_name: string | null;
        status: string;
        evidence_count: number;
        question_count: number;
      }[]
    >`
      select c.id, c.name, c.slug, c.school_level, c.grade_band, c.domain_name,
             c.status::text as status,
             case when jsonb_typeof(c.evidence) = 'array'
                  then jsonb_array_length(c.evidence) else 0 end as evidence_count,
             (select count(*)::int from question_alignments qa
               where qa.concept_id = c.id
                 and qa.organization_id = ${user.organizationId}) as question_count
      from canonical_concepts c
      order by c.school_level nulls last, c.grade_band nulls last, c.name
    `,
    sql<
      {
        id: string;
        from_name: string;
        to_name: string;
        provenance: string;
        status: string;
        confidence: string | null;
        rationale: string | null;
        required_depth: string | null;
        can_teach_concurrently: boolean | null;
        reviewed_at: Date | null;
      }[]
    >`
      select e.id, f.name as from_name, t.name as to_name,
             e.provenance::text as provenance, e.status::text as status,
             e.confidence::text as confidence, e.rationale, e.required_depth,
             e.can_teach_concurrently, e.reviewed_at
      from concept_edges e
      join canonical_concepts f on f.id = e.from_concept_id
      join canonical_concepts t on t.id = e.to_concept_id
      where e.kind = 'prerequisite'
      order by t.name, f.name
    `,
    sql<{ cnt: number; verified: number }[]>`
      select count(*)::int as cnt,
             count(*) filter (where review_status = 'verified')::int as verified
      from curriculum_authority_sources
    `,
  ]);

  const sourceCount = authority[0]?.cnt ?? 0;
  const verifiedCount = authority[0]?.verified ?? 0;
  const unapproved = edges.filter(
    (e) => e.provenance === "ai_suggested" && e.reviewed_at === null,
  ).length;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">커리큘럼 스튜디오</h1>

      {/* 2K 규칙 3 — 공식·내부 구분 고지 */}
      <div className="mt-3 rounded-lg border border-highlight bg-highlight-soft p-4 text-sm">
        <p className="font-medium">
          공식 성취기준 데이터는 권위 소스 등록 후 표시됩니다 — 내부 개념 체계는
          공식 성취기준이 아닙니다.
        </p>
        <p className="mt-1.5 text-ink-soft">
          아래 개념·선수 관계는 수업 설계와 숙련도 계산에 쓰는 내부 해석입니다.
          현재 등록된 권위 문서 {sourceCount}건 (원문 대조 완료 {verifiedCount}건).
          성취기준 코드·문구는 원문 대조가 끝난 릴리스에서만 노출합니다.
        </p>
      </div>

      {/* 개념 목록 */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">내부 개념 (canonical)</h2>
          <p className="font-mono text-xs text-ink-soft">{concepts.length}개</p>
        </div>
        {concepts.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
            <p className="font-medium">등록된 개념이 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              개념 체계는 플랫폼 공유 참조 데이터입니다. 큐레이터가 등록한 뒤
              이곳에 표시됩니다.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="border-b border-rule-soft text-left text-xs text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">개념</th>
                  <th className="px-4 py-2 font-medium">학교급</th>
                  <th className="px-4 py-2 font-medium">학년군</th>
                  <th className="px-4 py-2 font-medium">영역</th>
                  <th className="px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2 text-right font-medium">근거</th>
                  <th className="px-4 py-2 text-right font-medium">연결 문항</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft">
                {concepts.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{c.name}</p>
                      <p className="font-mono text-xs text-ink-soft">{c.slug}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.school_level
                        ? (SCHOOL_LEVEL_LABEL[c.school_level] ?? c.school_level)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {c.grade_band ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">{c.domain_name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge
                        label={CONCEPT_STATUS_LABEL[c.status] ?? c.status}
                        tone={
                          c.status === "active"
                            ? "ok"
                            : c.status === "deprecated"
                              ? "bad"
                              : "warn"
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {c.evidence_count === 0 ? (
                        <span className="text-grade">0</span>
                      ) : (
                        c.evidence_count
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {c.question_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          근거 0건인 개념은 발행 게이트를 통과하지 못합니다 (2L — 최소 1개 근거와
          검토 상태 보유). 연결 문항 수는 이 워크스페이스의 문항만 셉니다.
        </p>
      </section>

      {/* 선수 관계 */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">선수 관계 (prerequisite)</h2>
          <p className="font-mono text-xs text-ink-soft">
            {edges.length}개{unapproved > 0 && ` · 미승인 AI 제안 ${unapproved}개`}
          </p>
        </div>
        {edges.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
            <p className="font-medium">등록된 선수 관계가 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              선수 관계가 없으면 학습 루트의 순서 검증과 약점 추적 경로가
              비어 있게 됩니다.
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
            {edges.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{e.from_name}</span>
                    <span className="mx-2 font-mono text-ink-soft">→</span>
                    <span className="font-medium">{e.to_name}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {e.provenance === "ai_suggested" ? (
                      <Badge
                        label={
                          e.reviewed_at ? "AI 제안 (승인됨)" : "AI 제안 (미승인)"
                        }
                        tone={e.reviewed_at ? "muted" : "warn"}
                      />
                    ) : (
                      <Badge
                        label={e.provenance === "imported" ? "가져옴" : "사람 작성"}
                        tone="muted"
                      />
                    )}
                    <Badge
                      label={CONCEPT_STATUS_LABEL[e.status] ?? e.status}
                      tone={e.status === "active" ? "ok" : "warn"}
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {e.rationale ?? "근거 설명 없음"}
                  {e.required_depth && ` · 필요 숙련 깊이: ${e.required_depth}`}
                  {e.can_teach_concurrently !== null &&
                    ` · 동시 학습 ${e.can_teach_concurrently ? "가능" : "불가"}`}
                  {e.confidence && ` · 신뢰도 ${Number(e.confidence)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {unapproved > 0 && (
          <p className="mt-2 text-xs text-ink-soft">
            미승인 AI 제안 관계는 자동 계획(루트 순서·출제)에 사용되지 않습니다.
            사람이 승인해야 반영됩니다.
          </p>
        )}
      </section>

      <p className="mt-8 text-sm text-ink-soft">
        개념별 문항은{" "}
        <Link href="/app/content/questions" className="text-pen underline">
          문제은행
        </Link>
        에서 확인할 수 있습니다.
      </p>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const cls =
    tone === "ok"
      ? "border-pen bg-pen-soft text-pen"
      : tone === "warn"
        ? "border-highlight bg-highlight-soft text-ink"
        : tone === "bad"
          ? "border-grade bg-grade-soft text-grade"
          : "border-rule bg-surface text-ink-soft";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${cls}`}
    >
      {label}
    </span>
  );
}
