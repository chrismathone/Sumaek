import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { renderMixedText } from "@su-maek/core/math";
import { hasStructuredBlocks } from "@su-maek/contracts/content";
import { DEFAULT_MATRIX, canWrite } from "@su-maek/core/authz";
import { ReadingBody } from "@/components/materials/ReadingBody";
import { requireAccess } from "@/lib/auth/require-access";
import { formatDate } from "@/lib/format";
import { parseYouTubeId } from "@/lib/youtube";
import type { RawSearchParams } from "@/lib/table";
import { MaterialStatusButton } from "../MaterialForms";
import { KIND_LABEL, STATUS_LABEL, type ConceptOption } from "../shared";
import { MaterialEditForm, type QuestionOption } from "./MaterialEditForm";

export const metadata: Metadata = { title: "학습 자료 상세" };

/* ─────────────────────────────────────────────────────────────
 * 학습 자료 상세 — 고치는 곳.
 *
 * 이 화면이 없던 동안 자료를 고칠 유일한 수단은 「보관 후 재생성」이었고,
 * 그러면 새 material_id가 생겨 learner_material_progress가 옛 id에 남았다 —
 * 학생이 찍은 「다 봤어요」가 통째로 사라졌다는 뜻이다. 제자리 수정은 그
 * 손실을 없앤다.
 *
 * 연습문제의 문항 고르기도 여기 있다. 행 안 액션으로 끝낼 수 있는 크기가
 * 아니고(문항 미리보기·순서 바꾸기), 무엇보다 지금까지 question_ids에 값을
 * 넣는 지점이 **코드베이스에 하나도 없었다**.
 * ───────────────────────────────────────────────────────────── */

/** 미리보기에 싣는 본문 길이 — 문항을 알아볼 만큼만, 목록을 덮지 않을 만큼만 */
const PREVIEW_CHARS = 140;

interface ContentRun {
  kind: "text" | "math";
  text?: string;
  math?: { latex: string };
}

function runsToText(runs: ContentRun[] | undefined): string {
  return (runs ?? [])
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

interface BodyBlock {
  type?: string;
  text?: string;
  runs?: ContentRun[];
  math?: { latex: string };
  content?: ContentRun[];
  stepNumber?: number;
  unit?: string;
}

/**
 * 저장된 블록 → 평문.
 *
 * 두 곳에서 쓴다. 자료 본문은 이 평문을 고쳐 저장하면 다시 블록이 되고,
 * 문항 미리보기는 이것을 잘라 보여 준다. 문항 본문은 반입 파이프라인이 만든
 * 것이라 블록 종류가 다양하다 — 「text만 읽는」 변환은 미리보기를 통째로
 * 비워 버려서 교사가 어떤 문항인지 알아볼 수 없게 만든다
 * (문항 상세 화면의 bodyToText와 같은 규칙을 쓴다).
 */
function blocksToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return (body as BodyBlock[])
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text ?? "";
        case "paragraph":
          return runsToText(block.runs);
        case "inline_math":
          return `$${block.math?.latex ?? ""}$`;
        case "display_math":
          return `$$${block.math?.latex ?? ""}$$`;
        case "worked_step":
          return `${block.stepNumber ? `${block.stepNumber}. ` : ""}${runsToText(block.content)}`;
        case "answer_blank":
          return `____${block.unit ? ` ${block.unit}` : ""}`;
        default:
          return "";
      }
    })
    .filter((t) => t !== "")
    .join("\n\n");
}

/**
 * 미리보기 자르기 — `$`가 홀수로 끝나면 수식이 반토막 난다.
 * 마지막 여는 `$` 앞에서 끊어 반토막 수식을 아예 만들지 않는다.
 */
function clipForPreview(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text;
  let cut = text.slice(0, PREVIEW_CHARS);
  const dollars = (cut.match(/\$/g) ?? []).length;
  if (dollars % 2 === 1) cut = cut.slice(0, cut.lastIndexOf("$"));
  return `${cut.trimEnd()}…`;
}

interface MaterialDetail {
  id: string;
  concept_id: string;
  concept_name: string;
  concept_status: string;
  kind: string;
  title: string;
  body: unknown;
  video_url: string | null;
  video_seconds: number | null;
  question_ids: unknown;
  sort_order: number;
  status: string;
  disclosure: string | null;
  source_job_id: string | null;
  derived_from_material_id: string | null;
  source_ref: unknown;
  updated_at: Date;
  /** 낙관적 동시성 토큰 — updated_at의 ::text 원문. Date를 거치면 마이크로초가
   * 잘려 서버 대조가 영영 실패하므로 문자열 그대로 폼에 싣는다 */
  updated_at_token: string;
  created_at: Date;
  author_name: string | null;
}

/** 정제 잡이 source_ref에 남기는 보고 — 검수 화면이 읽는다 */
interface RefineReport {
  model?: string;
  promptVersion?: string;
  warnings?: { kind: string; detail: string }[];
}

const WARNING_LABEL: Record<string, string> = {
  fabricated_number: "원본에 없는 수치",
  copied_span: "원문과 연속 일치",
};

export default async function MaterialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const user = await requireAccess("materials");
  const raw = await searchParams;
  const conceptQuery = typeof raw.cq === "string" ? raw.cq.trim() : "";
  const sql = getSharedSql();

  // uuid가 아닌 경로 세그먼트는 캐스팅 오류 대신 404로 끝낸다
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();

  const [material] = await sql<MaterialDetail[]>`
    select m.id::text, m.concept_id::text as concept_id, c.name as concept_name,
           c.status::text as concept_status, m.kind::text as kind, m.title, m.body,
           m.video_url, m.video_seconds, m.question_ids, m.sort_order,
           m.status::text as status, m.disclosure, m.source_job_id,
           m.derived_from_material_id::text as derived_from_material_id,
           m.source_ref, m.updated_at, m.updated_at::text as updated_at_token,
           m.created_at, u.display_name as author_name
    from learning_materials m
    join canonical_concepts c on c.id = m.concept_id
    left join users u on u.id = m.created_by
    where m.id = ${id} and m.organization_id = ${user.organizationId}
  `;
  if (!material) notFound();

  /* 정제본이면 원본(추출본)을 불러 나란히 보인다 — 검수자가 보는 질문은
   * "예뻐졌나"가 아니라 「지면의 뜻과 같나, 표현은 우리 것인가」다. */
  const [refineSource] = material.derived_from_material_id
    ? await sql<{ id: string; title: string; body: unknown; status: string }[]>`
        select id::text, title, body, status::text as status
        from learning_materials
        where id = ${material.derived_from_material_id}
          and organization_id = ${user.organizationId}
      `
    : [];
  const refineReport =
    ((material.source_ref as { refineReport?: RefineReport } | null)
      ?.refineReport as RefineReport | undefined) ?? null;

  const questionIds = Array.isArray(material.question_ids)
    ? (material.question_ids as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];

  const usableCount = sql`(
    select count(*)::int from questions q
    join content_rights r on r.id = q.content_right_id and r.status = 'usable'
    join question_alignments a on a.question_id = q.id and a.concept_id = c.id
      and a.provenance <> 'ai_suggested'
    where q.organization_id = ${user.organizationId}
      and q.review_status = 'published'
  ) as usable_questions`;

  const [concepts, progress] = await Promise.all([
    conceptQuery
      ? sql<ConceptOption[]>`
          select c.id::text, c.name, ${usableCount}
          from canonical_concepts c
          where c.status in ('reviewed', 'active')
            and (c.name ilike ${"%" + conceptQuery + "%"}
                 or c.slug ilike ${"%" + conceptQuery + "%"})
          order by c.name limit 50
        `
      : sql<ConceptOption[]>`
          select c.id::text, c.name, ${usableCount}
          from canonical_concepts c
          where c.status in ('reviewed', 'active')
          order by c.updated_at desc limit 20
        `,
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_material_progress
      where material_id = ${material.id}
        and organization_id = ${user.organizationId}
    `,
  ]);

  /* 고를 수 있는 문항 — 학생 화면의 자동 선정과 **같은 게이트**를 쓴다
   * (검수 완료 + 사용 권한 유효). 기준이 갈리면 여기서 고른 문항이 학생
   * 화면에서 조용히 사라진다.
   *
   * 이미 지정된 문항은 다른 개념 것이어도 싣는다 — 개념을 옮긴 뒤에도
   * 무엇이 지정돼 있는지 보여야 교사가 판단할 수 있다. */
  const candidateRows =
    material.kind === "practice"
      ? await sql<{ id: string; body: unknown; kind: string; aligned: boolean }[]>`
          select q.id::text, v.body, q.kind::text as kind,
                 exists (
                   select 1 from question_alignments a
                   where a.question_id = q.id
                     and a.concept_id = ${material.concept_id}
                     and a.provenance <> 'ai_suggested'
                 ) as aligned
          from questions q
          join question_versions v on v.id = q.current_version_id
          join content_rights r on r.id = q.content_right_id and r.status = 'usable'
          where q.organization_id = ${user.organizationId}
            and q.review_status = 'published'
            and (
              exists (
                select 1 from question_alignments a
                where a.question_id = q.id
                  and a.concept_id = ${material.concept_id}
                  and a.provenance <> 'ai_suggested'
              )
              -- 빈 배열은 [null]로 — postgres.js가 빈 JS 배열의 원소 타입을 모른다
              or q.id = any(${questionIds.length > 0 ? questionIds : [null]}::uuid[])
            )
          order by aligned desc, q.created_at
          limit 100
        `
      : [];

  const candidates: QuestionOption[] = candidateRows.map((q) => {
    const clipped = clipForPreview(blocksToText(q.body));
    return {
      id: q.id,
      // 저작 화면이므로 'authoring' — 깨진 수식을 붉은 오류가 아니라 중립 표시로
      previewHtml: renderMixedText(clipped || "(본문 없음)", "authoring").html,
      kind: q.kind,
      aligned: q.aligned,
    };
  });

  const canAuthor = canWrite(DEFAULT_MATRIX, user.role, "materials");
  const progressCount = progress[0]?.cnt ?? 0;
  const seconds = material.video_seconds ?? 0;
  /* 저장된 주소가 유튜브로 안 읽히면 학생 화면은 임베드 대신 새 탭 링크로
   * 물러선다. 그 사실을 저작 화면에서 미리 말한다 — 학생이 알려 주기 전에. */
  const videoOk = material.video_url ? parseYouTubeId(material.video_url) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/content/materials"
        className="font-mono text-xs text-ink-soft hover:text-pen"
      >
        ← 학습 자료
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-[MaruBuri] text-2xl font-semibold">{material.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="border-rule bg-paper">
            {KIND_LABEL[material.kind] ?? material.kind}
          </Badge>
          <Badge
            tone={
              material.status === "published"
                ? "border-pen bg-pen-soft/50 text-pen"
                : material.status === "archived"
                  ? "border-rule bg-paper text-ink-soft"
                  : "border-highlight bg-highlight-soft"
            }
          >
            {STATUS_LABEL[material.status] ?? material.status}
          </Badge>
          {canAuthor && (
            <span className="flex flex-wrap gap-1">
              {material.status !== "published" && (
                <MaterialStatusButton
                  materialId={material.id}
                  status="published"
                  label="게시"
                  primary
                />
              )}
              {material.status === "published" && (
                <MaterialStatusButton
                  materialId={material.id}
                  status="draft"
                  label="게시 취소"
                />
              )}
              {material.status !== "archived" && (
                <MaterialStatusButton
                  materialId={material.id}
                  status="archived"
                  label="보관"
                />
              )}
            </span>
          )}
        </div>
      </div>

      <p className="mt-1 text-sm text-ink-soft">
        개념 «{material.concept_name}» · 순서 {material.sort_order} ·{" "}
        {material.author_name ?? "작성자 미상"}가 만듦 ·{" "}
        {formatDate(material.created_at, user.timezone)} 생성 ·{" "}
        {formatDate(material.updated_at, user.timezone)} 수정
      </p>

      {/* 붙어 있는 개념이 더 이상 쓸 수 있는 상태가 아니면 학생에게 영원히
          보이지 않는다 — 조용히 두지 않는다 */}
      {!["reviewed", "active"].includes(material.concept_status) && (
        <p className="mt-3 rounded-lg border border-grade bg-grade-soft p-3 text-sm text-grade">
          붙어 있는 개념 «{material.concept_name}»이 검토 전이거나 폐기된
          상태입니다. 이 자료는 게시해도 학생에게 보이지 않습니다. 다른 개념으로
          옮기세요.
        </p>
      )}

      {material.kind === "video" && material.video_url && !videoOk && (
        <p className="mt-3 rounded-lg border border-highlight bg-highlight-soft p-3 text-sm">
          저장된 영상 주소를 유튜브로 알아보지 못했습니다. 학생 화면에서는
          임베드 대신 새 탭 링크로 열립니다. 주소를 다시 확인하세요.
        </p>
      )}

      {material.disclosure ? (
        <p className="mt-3 rounded-lg border border-rule bg-paper p-3 text-sm">
          <span className="font-medium">학생에게 보이는 고지</span> —{" "}
          {material.disclosure}
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">
          AI 고지가 없습니다. AI가 만든 자료라면 아래에 고지를 적으세요 — 학생이
          그 사실을 알아야 합니다.
        </p>
      )}

      {/* 정제 보고 — 게이트가 남긴 경고. 게시를 막지는 않지만 검수자 눈에
          반드시 띄어야 한다 (refine-design.md 결정 3). */}
      {refineReport && (refineReport.warnings?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-highlight bg-highlight-soft p-3 text-sm">
          <p className="font-medium">
            정제 검사 경고 {refineReport.warnings!.length}건 — 지면과 대조해
            확인하세요
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {refineReport.warnings!.map((w, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-ink-soft">
                  [{WARNING_LABEL[w.kind] ?? w.kind}]
                </span>{" "}
                {w.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 정제본인데 원본이 사라졌다 — 침묵하면 검수자는 "정제본이 아니구나"로
          읽고 지면 대조 없이 게시하게 된다. 말한다. */}
      {material.derived_from_material_id && !refineSource && (
        <p className="mt-3 rounded-lg border border-grade bg-grade-soft p-3 text-sm text-grade">
          이 자료는 정제본인데 원본 추출본을 찾을 수 없습니다(삭제·이관).
          지면과 대조할 수 없으니 게시 전에 내용을 다른 근거로 확인하세요.
        </p>
      )}

      {/* 본문 미리보기 — 학생 화면과 같은 렌더러(ReadingBody). 정제본이면
          원본 추출본을 나란히 둔다. */}
      {material.kind === "reading" &&
        Array.isArray(material.body) &&
        (refineSource ? (
          <section className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-rule bg-paper p-4">
              <p className="text-xs font-semibold text-ink-soft">
                원본 추출본 — «{refineSource.title}» (
                {STATUS_LABEL[refineSource.status] ?? refineSource.status}
                · 게시 대상 아님)
              </p>
              <div className="mt-2 opacity-80">
                <ReadingBody body={refineSource.body} mode="authoring" />
              </div>
            </div>
            <div className="rounded-lg border border-pen bg-surface p-4">
              <p className="text-xs font-semibold text-pen">
                정제본 — 학생이 보게 될 모습
                {refineReport?.model && (
                  <span className="ml-2 font-mono font-normal text-ink-soft">
                    {refineReport.model} · {refineReport.promptVersion}
                  </span>
                )}
              </p>
              <div className="mt-2">
                <ReadingBody body={material.body} mode="authoring" />
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
            <h2 className="font-semibold">본문 미리보기</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              학생 「개념 공부」 화면과 같은 렌더러로 그린 것입니다.
            </p>
            <div className="mt-3">
              <ReadingBody body={material.body} mode="authoring" />
            </div>
          </section>
        ))}

      {canAuthor ? (
        <section className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <h2 className="font-semibold">자료 고치기</h2>

          {/* 개념 찾기 — 편집 폼 밖의 GET 폼 (폼 중첩 금지) */}
          <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <label htmlFor="cq" className="text-sm">
              <span className="block text-xs text-ink-soft">개념 찾기</span>
              <input
                id="cq"
                name="cq"
                type="search"
                defaultValue={conceptQuery}
                placeholder="개념 이름 또는 slug"
                className="mt-1 w-64 rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-[var(--radius-control)] border border-rule px-3 py-2 text-sm"
            >
              찾기
            </button>
          </form>

          <MaterialEditForm
            material={{
              id: material.id,
              conceptId: material.concept_id,
              conceptName: material.concept_name,
              kind: material.kind,
              title: material.title,
              status: material.status,
              sortOrder: material.sort_order,
              bodyText: blocksToText(material.body),
              videoUrl: material.video_url ?? "",
              videoMinutes: Math.floor(seconds / 60),
              videoSeconds: seconds % 60,
              disclosure: material.disclosure ?? "",
              sourceJobId: material.source_job_id ?? "",
              questionIds,
              updatedAtToken: material.updated_at_token,
            }}
            concepts={concepts}
            conceptQuery={conceptQuery}
            candidates={candidates}
            progressCount={progressCount}
            bodyLocked={
              material.kind === "reading" &&
              (material.source_ref !== null ||
                material.derived_from_material_id !== null ||
                hasStructuredBlocks(material.body))
            }
          />
        </section>
      ) : (
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
          자료 수정은 쓰기 권한이 있는 구성원만 할 수 있습니다.
        </p>
      )}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: string;
}) {
  return (
    <span
      className={`rounded-[var(--radius-control)] border px-1.5 py-0.5 font-mono text-[11px] ${tone}`}
    >
      {children}
    </span>
  );
}
