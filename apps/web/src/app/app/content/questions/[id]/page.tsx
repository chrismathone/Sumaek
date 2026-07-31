import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { renderMixedText } from "@su-maek/core/math";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "문항 상세" };

/* 문항 상세 (16장) — 저작·검수 화면.
 * 여기서는 renderMixedText('authoring')을 쓴다. 실패한 수식을 붉은 오류가 아니라
 * 중립 표시로 보여줘야 검수자가 무엇이 깨졌는지 볼 수 있기 때문이다 (2P).
 * 학생 응시 경로는 'publish' 모드만 쓴다 — 아래 게시 게이트 표시로 그 결과를
 * 함께 보여준다. */

/** 표본이 이보다 적으면 정답률을 지표로 쓰지 않는다. */
const MIN_RELIABLE_SAMPLE = 20;

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  extracting: "추출 중",
  review_required: "검수 필요",
  formula_review_required: "수식 검수 필요",
  layout_review_required: "레이아웃 검수 필요",
  approved: "승인",
  rejected: "반려",
  quarantined: "격리",
  published: "게시",
};

const KIND_LABEL: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "단답형",
  multi_blank: "다중 빈칸",
  essay: "서술형",
};

const RIGHT_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  under_review: "확인 중",
  usable: "사용 가능",
  restricted: "제한적 사용",
  expired: "만료",
  blocked: "차단",
};

const BAND_LABEL: Record<string, string> = {
  low: "기초",
  mid: "표준",
  high: "심화",
};

const PROVENANCE_LABEL: Record<string, string> = {
  human: "사람 작성",
  ai_suggested: "AI 제안",
  imported: "가져옴",
};

/* ── 구조화 블록 → 혼합 텍스트 (learn/tests/[id] 변환 규칙과 동일) ── */

interface ContentRun {
  kind: "text" | "math";
  text?: string;
  math?: { latex: string };
}

interface BodyBlock {
  type?: string;
  text?: string;
  runs?: ContentRun[];
  math?: { latex: string };
  content?: ContentRun[];
  stepNumber?: number;
  label?: string;
  items?: Array<{ marker?: string; content?: ContentRun[] }>;
  unit?: string;
}

function runsToText(runs: ContentRun[] | undefined): string {
  return (runs ?? [])
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

/** 미리보기로 옮길 수 없는 블록 종류 — 감추지 않고 세어서 알린다. */
const UNSUPPORTED_BLOCK_LABEL: Record<string, string> = {
  math_table: "표",
  diagram: "도형",
  image_crop: "원본 이미지 크롭",
};

function bodyToText(body: unknown): { text: string; unsupported: string[] } {
  if (!Array.isArray(body)) return { text: "", unsupported: [] };
  const unsupported: string[] = [];
  const lines: string[] = [];
  for (const raw of body as BodyBlock[]) {
    switch (raw.type) {
      case "text":
        lines.push(raw.text ?? "");
        break;
      case "paragraph":
        lines.push(runsToText(raw.runs));
        break;
      case "inline_math":
        lines.push(`$${raw.math?.latex ?? ""}$`);
        break;
      case "display_math":
        lines.push(`$$${raw.math?.latex ?? ""}$$`);
        break;
      case "worked_step":
        lines.push(
          `${raw.stepNumber ? `${raw.stepNumber}. ` : ""}${runsToText(raw.content)}`,
        );
        break;
      case "condition_box":
        lines.push(`<${raw.label ?? "조건"}>`);
        for (const item of raw.items ?? []) {
          lines.push(
            `${item.marker ? `${item.marker} ` : ""}${runsToText(item.content)}`,
          );
        }
        break;
      case "answer_blank":
        lines.push(`____${raw.unit ? ` ${raw.unit}` : ""}`);
        break;
      case "choice_group":
      case "page_break_hint":
        // 선택지는 choices 컬럼에서 따로 렌더한다. 분할 힌트는 표시 대상이 아니다.
        break;
      default:
        if (raw.type && UNSUPPORTED_BLOCK_LABEL[raw.type]) {
          unsupported.push(UNSUPPORTED_BLOCK_LABEL[raw.type]!);
        }
    }
  }
  return { text: lines.join("\n"), unsupported };
}

/* ── 정답 계약 표시 ── */

interface AnswerKeyLike {
  kind?: string;
  correctChoiceIds?: string[];
  accepted?: Array<{
    value?: string;
    form?: string;
    unit?: string;
    allowEquivalence?: boolean;
    equivalenceAssumptions?: string;
  }>;
  ambiguityNote?: string;
  blanks?: Array<{
    blankId?: string;
    points?: number;
    key?: { accepted?: Array<{ value?: string; unit?: string }> };
  }>;
  rubric?: Array<{ rubricKey?: string; description?: string; points?: number }>;
}

interface ChoiceRow {
  choiceId: string;
  order: number;
  content?: ContentRun[];
}

interface QuestionRow {
  id: string;
  kind: string;
  review_status: string;
  is_auto_assignable: boolean;
  printed_number: string | null;
  quarantine_reason: string | null;
  created_at: Date;
  version_id: string | null;
  version_number: number | null;
  body: unknown;
  choices: unknown;
  answer: unknown;
  explanation: unknown;
  points: string | null;
  expected_seconds: number | null;
  difficulty: unknown;
  content_checksum: string | null;
  extraction: unknown;
  right_status: string | null;
  rights_holder: string | null;
  evidence_ref: string | null;
  allowed_uses: unknown;
  expires_on: Date | null;
  book_title: string | null;
  edition_label: string | null;
  source_file_name: string | null;
  source_page_number: number | null;
}

export default async function QuestionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  // uuid가 아닌 경로 세그먼트는 캐스팅 오류 대신 404로 끝낸다.
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();

  const [question] = await sql<QuestionRow[]>`
    select q.id, q.kind::text as kind, q.review_status::text as review_status,
           q.is_auto_assignable, q.printed_number, q.quarantine_reason, q.created_at,
           v.id as version_id, v.version_number, v.body, v.choices, v.answer,
           v.explanation, v.points::text as points, v.expected_seconds,
           v.difficulty, v.content_checksum, v.extraction,
           cr.status::text as right_status, cr.rights_holder, cr.evidence_ref,
           cr.allowed_uses, cr.expires_on,
           b.title as book_title, be.edition_label,
           sf.file_name as source_file_name, sp.page_number as source_page_number
    from questions q
    left join question_versions v on v.id = q.current_version_id
    left join content_rights cr on cr.id = q.content_right_id
      and cr.organization_id = q.organization_id
    left join book_editions be on be.id = q.book_edition_id
      and be.organization_id = q.organization_id
    left join books b on b.id = be.book_id and b.organization_id = q.organization_id
    left join source_files sf on sf.id = q.source_file_id
      and sf.organization_id = q.organization_id
    left join source_pages sp on sp.id = q.source_page_id
      and sp.organization_id = q.organization_id
    where q.id = ${id} and q.organization_id = ${user.organizationId}
  `;
  if (!question) notFound();

  const [alignments, versions, usage, outcome] = await Promise.all([
    sql<
      {
        name: string;
        slug: string;
        grade_band: string | null;
        domain_name: string | null;
        weight: string;
        confidence: string | null;
        provenance: string;
        reviewer_name: string | null;
      }[]
    >`
      select c.name, c.slug, c.grade_band, c.domain_name,
             qa.weight::text as weight, qa.confidence::text as confidence,
             qa.provenance, u.display_name as reviewer_name
      from question_alignments qa
      join canonical_concepts c on c.id = qa.concept_id
      left join users u on u.id = qa.reviewed_by
      where qa.question_id = ${id} and qa.organization_id = ${user.organizationId}
      order by qa.weight desc, c.name
    `,
    sql<
      {
        version_number: number;
        created_at: Date;
        change_reason: string | null;
        content_checksum: string;
        author_name: string | null;
        is_current: boolean;
      }[]
    >`
      select v.version_number, v.created_at, v.change_reason, v.content_checksum,
             u.display_name as author_name,
             (v.id = q.current_version_id) as is_current
      from question_versions v
      join questions q on q.id = v.question_id
      left join users u on u.id = v.created_by
      where v.question_id = ${id} and v.organization_id = ${user.organizationId}
      order by v.version_number desc
    `,
    sql<{ assessment_count: number; snapshot_count: number }[]>`
      select count(distinct aq.assessment_id)::int as assessment_count,
             count(*)::int as snapshot_count
      from assessment_questions aq
      where aq.question_id = ${id} and aq.organization_id = ${user.organizationId}
    `,
    sql<{ sample: number; correct: number }[]>`
      select count(*)::int as sample,
             count(*) filter (where gd.is_correct)::int as correct
      from grade_decisions gd
      join responses r on r.id = gd.response_id
      join assessment_questions aq on aq.id = r.assessment_question_id
      where aq.question_id = ${id}
        and aq.organization_id = ${user.organizationId}
        and gd.organization_id = ${user.organizationId}
        and gd.is_final = true
    `,
  ]);

  const { text: bodyText, unsupported } = bodyToText(question.body);
  const bodyHtml = renderMixedText(bodyText, "authoring").html;

  const choices: ChoiceRow[] = Array.isArray(question.choices)
    ? [...(question.choices as ChoiceRow[])].sort((a, b) => a.order - b.order)
    : [];
  const renderedChoices = choices.map((c) => ({
    ...c,
    html: renderMixedText(runsToText(c.content), "authoring").html,
  }));

  const explanation = bodyToText(question.explanation);
  const explanationHtml = explanation.text
    ? renderMixedText(explanation.text, "authoring").html
    : null;

  /* 게시 게이트 재확인 — 저작 미리보기는 통과해도 학생 경로는 막힐 수 있다. */
  const gateFailures = [
    ...renderMixedText(bodyText, "publish").failures,
    ...choices.flatMap(
      (c) => renderMixedText(runsToText(c.content), "publish").failures,
    ),
  ];

  const answer = (question.answer ?? {}) as AnswerKeyLike;
  const correctIds = new Set(answer.correctChoiceIds ?? []);
  const band =
    question.difficulty && typeof question.difficulty === "object"
      ? ((question.difficulty as { band?: string }).band ?? null)
      : null;

  const sample = outcome[0]?.sample ?? 0;
  const correct = outcome[0]?.correct ?? 0;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/content/questions"
        className="font-mono text-xs text-ink-soft hover:text-pen"
      >
        ← 문제은행
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">
          문항 {question.id.replace(/-/g, "").slice(-8)}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge label={KIND_LABEL[question.kind] ?? question.kind} tone="muted" />
          <Badge
            label={
              REVIEW_STATUS_LABEL[question.review_status] ?? question.review_status
            }
            tone={
              question.review_status === "published" ||
              question.review_status === "approved"
                ? "ok"
                : question.review_status === "rejected" ||
                    question.review_status === "quarantined"
                  ? "bad"
                  : "warn"
            }
          />
          <Badge
            label={question.is_auto_assignable ? "자동 출제 가능" : "자동 출제 불가"}
            tone={question.is_auto_assignable ? "ok" : "muted"}
          />
          {question.version_number !== null && (
            <Badge label={`v${question.version_number}`} tone="muted" />
          )}
        </div>
      </div>
      <p className="mt-1 font-mono text-xs text-ink-soft" title={question.id}>
        {question.id}
      </p>

      {question.quarantine_reason && (
        <p className="mt-3 rounded-lg border border-grade bg-grade-soft p-3 text-sm text-grade">
          격리 사유: {question.quarantine_reason}
        </p>
      )}

      {gateFailures.length > 0 && (
        <p className="mt-3 rounded-lg border border-grade bg-grade-soft p-3 text-sm text-grade">
          게시 게이트: 수식 {gateFailures.length}건이 게시 모드 렌더에
          실패합니다. 아래 미리보기는 검수용 표시이며, 이 상태로는 학생에게
          출제할 수 없습니다.
        </p>
      )}

      {/* 본문 */}
      <section className="mt-6 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">본문</h2>
        {question.version_id === null ? (
          <p className="mt-2 text-sm text-ink-soft">
            활성 버전이 없습니다. 문항 버전을 만들어야 출제할 수 있습니다.
          </p>
        ) : (
          <div
            className="mt-2 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}

        {renderedChoices.length > 0 && (
          <ol className="mt-4 space-y-2">
            {renderedChoices.map((c) => (
              <li
                key={c.choiceId}
                className={`flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 ${
                  correctIds.has(c.choiceId)
                    ? "border-pen bg-pen-soft"
                    : "border-rule-soft"
                }`}
              >
                <span className="font-mono text-xs text-ink-soft">{c.order}</span>
                <span
                  className="min-w-0 flex-1"
                  dangerouslySetInnerHTML={{ __html: c.html }}
                />
                {correctIds.has(c.choiceId) && (
                  <span className="font-mono text-xs font-medium text-pen">정답</span>
                )}
              </li>
            ))}
          </ol>
        )}

        {unsupported.length > 0 && (
          <p className="mt-3 font-mono text-xs text-ink-soft">
            이 미리보기에서 표시하지 않는 블록: {unsupported.join(", ")} (
            {unsupported.length}개)
          </p>
        )}
      </section>

      {/* 정답·배점 */}
      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">정답·배점</h2>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="정답">{formatAnswerKey(answer, choices)}</Field>
          <Field label="배점">
            {question.points ? `${Number(question.points)}점` : "미지정"}
          </Field>
          <Field label="난이도 밴드">
            {band ? (BAND_LABEL[band] ?? band) : "미지정"}
          </Field>
          <Field label="예상 소요">
            {question.expected_seconds ? `${question.expected_seconds}초` : "미지정"}
          </Field>
        </dl>
        {answer.ambiguityNote && (
          <p className="mt-3 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft p-2 text-sm">
            모호성 메모: {answer.ambiguityNote} — 자동 확정 대신 채점 예외로
            보냅니다.
          </p>
        )}
        {explanationHtml && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink-soft">해설</h3>
            <div
              className="mt-1.5 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: explanationHtml }}
            />
          </div>
        )}
      </section>

      {/* 개념 매핑 */}
      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">개념 매핑</h2>
        {alignments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            연결된 개념이 없습니다. 개념 연결이 없으면 숙련도 증거로 쓰이지
            않습니다.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {alignments.map((a) => (
              <li
                key={a.slug}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="font-mono text-xs text-ink-soft">
                    {a.slug}
                    {a.domain_name && ` · ${a.domain_name}`}
                    {a.grade_band && ` · ${a.grade_band}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={`가중치 ${Number(a.weight)}`} tone="muted" />
                  {a.confidence && (
                    <Badge label={`신뢰도 ${Number(a.confidence)}`} tone="muted" />
                  )}
                  <Badge
                    label={PROVENANCE_LABEL[a.provenance] ?? a.provenance}
                    tone={a.provenance === "ai_suggested" ? "warn" : "muted"}
                  />
                  <span className="font-mono text-xs text-ink-soft">
                    검토자 {a.reviewer_name ?? "없음"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 출처·권한 */}
      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">출처·사용 권한</h2>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="교재·판본">
            {question.book_title
              ? `${question.book_title}${question.edition_label ? ` (${question.edition_label})` : ""}`
              : "연결된 교재 없음"}
          </Field>
          <Field label="원본 파일">
            {question.source_file_name
              ? `${question.source_file_name}${question.source_page_number ? ` · ${question.source_page_number}p` : ""}`
              : "원본 파일 없음 (직접 등록)"}
          </Field>
          <Field label="인쇄 문항 번호">{question.printed_number ?? "—"}</Field>
          <Field label="권리자">{question.rights_holder ?? "—"}</Field>
          <Field label="권한 상태">
            {question.right_status ? (
              <Badge
                label={
                  RIGHT_STATUS_LABEL[question.right_status] ?? question.right_status
                }
                tone={question.right_status === "usable" ? "ok" : "warn"}
              />
            ) : (
              <Badge label="권한 레코드 미연결" tone="warn" />
            )}
          </Field>
          <Field label="증빙">{question.evidence_ref ?? "—"}</Field>
          <Field label="허용 용도">{formatAllowedUses(question.allowed_uses)}</Field>
          <Field label="만료일">
            {question.expires_on
              ? new Date(question.expires_on).toLocaleDateString("ko-KR")
              : "없음"}
          </Field>
        </dl>
        {!question.right_status && (
          <p className="mt-3 text-sm text-ink-soft">
            사용 권한 레코드가 연결되지 않은 문항은 자동 출제 풀에 들어가지
            않습니다 (원칙 9).
          </p>
        )}
      </section>

      {/* 버전 이력 */}
      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">버전 이력</h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">버전 기록이 없습니다.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {versions.map((v) => (
              <li key={v.version_number} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">v{v.version_number}</span>
                  {v.is_current && <Badge label="현재" tone="ok" />}
                  <span className="font-mono text-xs text-ink-soft">
                    {formatDateTime(v.created_at)} · {v.author_name ?? "작성자 미상"}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-ink-soft">
                  체크섬 {v.content_checksum}
                  {v.change_reason && ` · 정정 사유: ${v.change_reason}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {question.extraction != null && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-soft">
              추출·AI 관여 기록
            </summary>
            <pre className="mt-1 overflow-x-auto rounded bg-paper p-2 font-mono text-xs">
              {JSON.stringify(question.extraction, null, 2)}
            </pre>
          </details>
        )}
      </section>

      {/* 출제·응시 통계 */}
      <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">출제·응시 통계</h2>
        <dl className="mt-2 grid gap-3 sm:grid-cols-3">
          <Field label="포함된 평가">
            {usage[0]?.assessment_count ?? 0}개
          </Field>
          <Field label="문항 스냅샷">{usage[0]?.snapshot_count ?? 0}건</Field>
          <Field label="최종 채점 표본">{sample}건</Field>
        </dl>
        {sample === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            아직 최종 채점된 응답이 없습니다. 정답률은 응시·채점이 확정된 뒤에
            계산됩니다.
          </p>
        ) : (
          <div className="mt-3">
            <p className="font-mono text-xl font-bold">
              정답률 {Math.round((correct / sample) * 100)}%
              <span className="ml-2 text-sm font-normal text-ink-soft">
                ({correct}/{sample})
              </span>
            </p>
            {sample < MIN_RELIABLE_SAMPLE && (
              <p className="mt-1.5 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft p-2 text-sm">
                표본 {sample}건 — 통계 불안정. 난이도 판단의 근거로 쓰기에는
                표본이 부족합니다 (기준 {MIN_RELIABLE_SAMPLE}건).
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
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

function formatAnswerKey(answer: AnswerKeyLike, choices: ChoiceRow[]): string {
  if (answer.kind === "multiple_choice") {
    const orderById = new Map(choices.map((c) => [c.choiceId, c.order]));
    const ids = answer.correctChoiceIds ?? [];
    if (ids.length === 0) return "정답 미지정";
    return ids
      .map((cid) => {
        const order = orderById.get(cid);
        return order ? `${order}번 (${cid})` : cid;
      })
      .join(", ");
  }
  if (answer.kind === "short_answer") {
    const accepted = answer.accepted ?? [];
    if (accepted.length === 0) return "정답 미지정";
    return accepted
      .map((a) => {
        const unit = a.unit ? ` ${a.unit}` : "";
        const eq = a.allowEquivalence ? " · 동치 허용" : "";
        return `${a.value ?? ""}${unit}${eq}`;
      })
      .join(" 또는 ");
  }
  if (answer.kind === "multi_blank") {
    const blanks = answer.blanks ?? [];
    return blanks
      .map((b) => {
        const values = (b.key?.accepted ?? [])
          .map((a) => `${a.value ?? ""}${a.unit ? ` ${a.unit}` : ""}`)
          .join(" 또는 ");
        return `${b.blankId ?? "빈칸"}: ${values || "미지정"}${
          b.points !== undefined ? ` (${b.points}점)` : ""
        }`;
      })
      .join(" / ");
  }
  if (answer.kind === "essay") {
    const rubric = answer.rubric ?? [];
    return `루브릭 채점 — 항목 ${rubric.length}개${
      rubric.length > 0
        ? ` (${rubric.map((r) => `${r.description ?? r.rubricKey ?? ""} ${r.points ?? 0}점`).join(", ")})`
        : ""
    }`;
  }
  return "정답 정보 없음";
}

const USE_LABEL: Record<string, string> = {
  transform: "변형",
  ai: "AI 처리",
  print: "인쇄",
  online: "온라인 제공",
};

function formatAllowedUses(uses: unknown): string {
  if (!uses || typeof uses !== "object") return "—";
  const entries = Object.entries(uses as Record<string, unknown>).filter(
    ([, v]) => v === true,
  );
  if (entries.length === 0) return "허용 용도 미기재";
  return entries.map(([k]) => USE_LABEL[k] ?? k).join(", ");
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  });
}
