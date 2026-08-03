import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata: Metadata = { title: "수직 진행 탐색" };

/* 수직 진행 탐색 (인수 45 · 2L).
 *
 * 한 개념을 골라 학습 진행 방향의 계통을 본다 — 이전 학교급의 선수
 * 사슬(초등까지), 이 개념을 선수로 갖는 다음 개념, 다음 학년·학교급으로의
 * 확장(extends)·전이(transfer_to), 그리고 그 개념의 표상·대표 오개념·학습
 * 목표.
 *
 * 계통 질의는 승인된 간선만 쓴다 — status reviewed·active + AI 미제안
 * (2L: AI 제안은 승인 전 자동 계획·표시 계통에 넣지 않는다. 화면도 자동
 * 계획의 소비자다).
 *
 * 2K 규칙 3: 이 계통은 내부 해석이다 — 공식 성취기준 체계처럼 보이지
 * 않게 고지를 붙인다.
 */

const SCHOOL_LEVEL_LABEL: Record<string, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

const EDGE_KIND_LABEL: Record<string, string> = {
  prerequisite: "선수",
  soft_prerequisite: "약한 선수",
  extends: "확장",
  transfer_to: "전이",
  equivalent_to: "동치·복습",
  contrasts_with: "대조",
  part_of: "부분",
  special_case_of: "특수화",
};

/** 계통 질의가 따르는 승인 간선 조건 (planningEdges와 같은 방향) */
const APPROVED = `e.status in ('reviewed', 'active') and e.provenance <> 'ai_suggested'`;

interface ConceptRow {
  id: string;
  slug: string;
  name: string;
  school_level: string | null;
  grade_band: string | null;
  domain_name: string | null;
  question_count: number;
}

interface ChainRow extends ConceptRow {
  kind: string;
  depth: number;
  rationale: string | null;
}

export default async function ProgressionPage({
  searchParams,
}: {
  searchParams: Promise<{ concept?: string }>;
}) {
  const user = await requireAccess("curriculum_studio");
  const sql = getSharedSql();
  const params = await searchParams;

  /* 계통에 참여하는 개념만 선택지로 — 간선 없는 개념은 이 화면에 볼 것이 없다 */
  const selectable = await sql<ConceptRow[]>`
    select c.id, c.slug, c.name, c.school_level, c.grade_band, c.domain_name,
           (select count(*)::int from question_alignments qa
             where qa.concept_id = c.id and qa.organization_id = ${user.organizationId}) as question_count
    from canonical_concepts c
    where exists (
      select 1 from concept_edges e
      where (e.from_concept_id = c.id or e.to_concept_id = c.id)
        and e.status in ('reviewed', 'active') and e.provenance <> 'ai_suggested'
    )
    order by case c.school_level when 'elementary' then 0 when 'middle' then 1 else 2 end,
             c.grade_band nulls last, c.slug
  `;

  const requested = params.concept ?? "";
  const current =
    selectable.find((c) => c.slug === requested) ??
    selectable.find((c) => c.slug === "m1-prime-factorization") ??
    selectable[0] ??
    null;

  if (!current) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">수직 진행 탐색</h1>
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-sm">
          <p className="font-medium">계통에 연결된 개념이 아직 없습니다.</p>
          <p className="mt-1.5 text-ink-soft">
            개념 간 선수·확장 간선은 플랫폼 공유 참조 데이터입니다. 큐레이터가
            등록한 뒤 이곳에 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  const [ancestors, nexts, contrasts, representations, misconceptions, objectives] =
    await Promise.all([
      /* 이전 계통 — 선수 사슬을 거슬러 올라간다 (초등까지). depth 6 제한:
       * 발행 게이트가 순환을 막지만, 게이트 전 데이터에서도 멈추게 한다. */
      sql<ChainRow[]>`
        with recursive up as (
          select e.from_concept_id, e.kind::text as kind, e.rationale, 1 as depth
          from concept_edges e
          where e.to_concept_id = ${current.id}
            and e.kind in ('prerequisite', 'soft_prerequisite', 'equivalent_to')
            and ${sql.unsafe(APPROVED)}
          union all
          select e.from_concept_id, e.kind::text, e.rationale, up.depth + 1
          from concept_edges e
          join up on e.to_concept_id = up.from_concept_id
          where e.kind in ('prerequisite', 'soft_prerequisite', 'equivalent_to')
            and ${sql.unsafe(APPROVED)} and up.depth < 6
        )
        select distinct on (c.id) c.id, c.slug, c.name, c.school_level,
               c.grade_band, c.domain_name, up.kind, up.depth, up.rationale,
               (select count(*)::int from question_alignments qa
                 where qa.concept_id = c.id and qa.organization_id = ${user.organizationId}) as question_count
        from up join canonical_concepts c on c.id = up.from_concept_id
        order by c.id, up.depth
      `,
      /* 다음 — 이 개념을 선수로 갖는 개념 + 확장·전이 사슬 (고등까지) */
      sql<ChainRow[]>`
        with recursive down as (
          select e.to_concept_id, e.kind::text as kind, e.rationale, 1 as depth
          from concept_edges e
          where e.from_concept_id = ${current.id}
            and e.kind in ('prerequisite', 'extends', 'transfer_to')
            and ${sql.unsafe(APPROVED)}
          union all
          select e.to_concept_id, e.kind::text, e.rationale, down.depth + 1
          from concept_edges e
          join down on e.from_concept_id = down.to_concept_id
          where e.kind in ('extends', 'transfer_to')
            and ${sql.unsafe(APPROVED)} and down.depth < 6
        )
        select distinct on (c.id) c.id, c.slug, c.name, c.school_level,
               c.grade_band, c.domain_name, down.kind, down.depth, down.rationale,
               (select count(*)::int from question_alignments qa
                 where qa.concept_id = c.id and qa.organization_id = ${user.organizationId}) as question_count
        from down join canonical_concepts c on c.id = down.to_concept_id
        order by c.id, down.depth
      `,
      /* 대조 개념 — 양방향 */
      sql<ChainRow[]>`
        select c.id, c.slug, c.name, c.school_level, c.grade_band, c.domain_name,
               'contrasts_with' as kind, 1 as depth, e.rationale,
               (select count(*)::int from question_alignments qa
                 where qa.concept_id = c.id and qa.organization_id = ${user.organizationId}) as question_count
        from concept_edges e
        join canonical_concepts c
          on c.id = case when e.from_concept_id = ${current.id} then e.to_concept_id else e.from_concept_id end
        where (e.from_concept_id = ${current.id} or e.to_concept_id = ${current.id})
          and e.kind = 'contrasts_with' and ${sql.unsafe(APPROVED)}
      `,
      sql<{ kind: string; description: string; example: { text?: string } | null }[]>`
        select kind, description, example from representations
        where concept_id = ${current.id} order by kind
      `,
      sql<
        {
          name: string;
          error_pattern: string;
          confused_with_name: string | null;
          remediation_strategy: { steps?: string[] } | null;
        }[]
      >`
        select m.name, m.error_pattern, cw.name as confused_with_name,
               m.remediation_strategy
        from misconceptions m
        left join canonical_concepts cw on cw.id = m.confused_with_concept_id
        where m.concept_id = ${current.id} and m.status <> 'deprecated'
        order by m.name
      `,
      sql<{ statement: string }[]>`
        select statement from learning_objectives
        where concept_id = ${current.id} and status = 'active' order by id
      `,
    ]);

  const sortedAncestors = [...ancestors].sort(
    (a, b) => b.depth - a.depth || a.slug.localeCompare(b.slug),
  );
  const sortedNexts = [...nexts].sort(
    (a, b) => a.depth - b.depth || a.slug.localeCompare(b.slug),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">수직 진행 탐색</h1>
        <Link
          href="/app/content/curriculum"
          className="text-sm text-pen underline underline-offset-2"
        >
          ← 커리큘럼 스튜디오
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        내부 개념 계통입니다 — 공식 성취기준 체계가 아닙니다. 승인된 관계만
        표시합니다 (AI 제안·미승인 관계 제외).
      </p>

      {/* 개념 선택 — 계통에 참여하는 개념만 */}
      <nav aria-label="개념 선택" className="mt-4 flex flex-wrap gap-1.5">
        {selectable.map((c) => (
          <Link
            key={c.id}
            href={`/app/content/curriculum/progression?concept=${encodeURIComponent(c.slug)}`}
            aria-current={c.id === current.id ? "page" : undefined}
            className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs ${
              c.id === current.id
                ? "border-pen bg-pen-soft font-medium text-pen"
                : "border-rule bg-surface text-ink-soft hover:border-pen"
            }`}
          >
            {c.name}
          </Link>
        ))}
      </nav>

      {/* 수직 계통 — 이전(위) → 현재 → 다음(아래) */}
      <section className="mt-6" aria-label="수직 계통">
        <ol className="space-y-1.5">
          {sortedAncestors.map((c) => (
            <ChainItem key={c.id} concept={c} direction="ancestor" />
          ))}
          <li className="rounded-lg border-2 border-pen bg-pen-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge level={current.school_level} band={current.grade_band} />
              <span className="font-[MaruBuri] text-lg font-semibold">
                {current.name}
              </span>
              <span className="font-mono text-xs text-ink-soft">{current.slug}</span>
              {current.question_count > 0 && (
                <span className="ml-auto font-mono text-xs text-ink-soft">
                  연결 문항 {current.question_count}
                </span>
              )}
            </div>
            {objectives.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {objectives.map((o) => (
                  <li key={o.statement} className="flex gap-2">
                    <span aria-hidden="true" className="text-pen">
                      ◎
                    </span>
                    <span>{o.statement}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
          {sortedNexts.map((c) => (
            <ChainItem key={c.id} concept={c} direction="descendant" />
          ))}
        </ol>
        {sortedAncestors.length === 0 && sortedNexts.length === 0 && (
          <p className="mt-2 text-sm text-ink-soft">
            이 개념에 등록된 선수·확장 관계가 없습니다.
          </p>
        )}
      </section>

      {/* 대조 개념 */}
      {contrasts.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">함께 대조할 개념</h2>
          <ul className="mt-2 space-y-1.5">
            {contrasts.map((c) => (
              <li key={c.id} className="rounded-lg border border-highlight bg-highlight-soft p-3 text-sm">
                <Link
                  href={`/app/content/curriculum/progression?concept=${encodeURIComponent(c.slug)}`}
                  className="font-medium text-pen underline underline-offset-2"
                >
                  {c.name}
                </Link>
                {c.rationale && <span className="ml-2 text-ink-soft">{c.rationale}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {/* 표상 */}
        <section>
          <h2 className="text-lg font-semibold">표상</h2>
          {representations.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">등록된 표상이 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {representations.map((r) => (
                <li key={`${r.kind}-${r.description}`} className="rounded-lg border border-rule bg-surface p-3 text-sm">
                  <p>
                    <span className="mr-2 inline-block rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                      {r.kind}
                    </span>
                    {r.description}
                  </p>
                  {r.example?.text && (
                    <p className="mt-1 font-mono text-xs text-ink-soft">
                      예: {r.example.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 대표 오개념 */}
        <section>
          <h2 className="text-lg font-semibold">대표 오개념</h2>
          {misconceptions.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">등록된 오개념이 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {misconceptions.map((m) => (
                <li key={m.name} className="rounded-lg border border-rule bg-surface p-3 text-sm">
                  <p className="font-medium">{m.name}</p>
                  <p className="mt-1 text-ink-soft">{m.error_pattern}</p>
                  {m.confused_with_name && (
                    <p className="mt-1 text-xs text-ink-soft">
                      혼동 대상: {m.confused_with_name}
                    </p>
                  )}
                  {m.remediation_strategy?.steps &&
                    m.remediation_strategy.steps.length > 0 && (
                      <p className="mt-1 text-xs text-ink-soft">
                        교정: {m.remediation_strategy.steps.join(" → ")}
                      </p>
                    )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ChainItem({
  concept,
  direction,
}: {
  concept: ChainRow;
  direction: "ancestor" | "descendant";
}) {
  return (
    <li className="rounded-lg border border-rule bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <LevelBadge level={concept.school_level} band={concept.grade_band} />
        <Link
          href={`/app/content/curriculum/progression?concept=${encodeURIComponent(concept.slug)}`}
          className="font-medium text-pen underline underline-offset-2"
        >
          {concept.name}
        </Link>
        <span className="rounded-[var(--radius-control)] border border-rule px-1.5 py-0.5 font-mono text-xs text-ink-soft">
          {direction === "ancestor" ? "" : "→ "}
          {EDGE_KIND_LABEL[concept.kind] ?? concept.kind}
          {direction === "ancestor" ? " →" : ""}
        </span>
        {concept.question_count > 0 && (
          <span className="ml-auto font-mono text-xs text-ink-soft">
            문항 {concept.question_count}
          </span>
        )}
      </div>
      {concept.rationale && (
        <p className="mt-1 text-xs text-ink-soft">{concept.rationale}</p>
      )}
    </li>
  );
}

function LevelBadge({ level, band }: { level: string | null; band: string | null }) {
  const label = level ? (SCHOOL_LEVEL_LABEL[level] ?? level) : "미지정";
  const tone =
    level === "elementary"
      ? "border-highlight bg-highlight-soft text-ink"
      : level === "high"
        ? "border-grade bg-grade-soft text-grade"
        : "border-pen bg-pen-soft text-pen";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-xs ${tone}`}
    >
      {label}
      {band ? ` ${band}` : ""}
    </span>
  );
}
