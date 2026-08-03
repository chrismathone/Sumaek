import { renderMixedText } from "@su-maek/core/math";

/* ─────────────────────────────────────────────────────────────
 * 읽기 자료 본문 렌더러 — readingContent 블록 어휘의 화면 쪽 절반.
 * (계약: packages/contracts/src/content/reading.ts · 설계: docs/refine-design.md)
 *
 * 학생 「개념 공부」와 교사 자료 상세가 같은 컴포넌트를 쓴다 — 검수자가
 * 본 것과 학생이 보는 것이 달라지면 검수가 무의미해진다.
 *
 * 두 가지 원칙:
 * - **모르는 블록은 조용히 버리지 않는다.** authoring 모드에서는 종류를
 *   표시해 검수자가 알게 한다. publish 모드에서는 뺀다(깨진 것을 학생에게
 *   보이는 것보다 낫다) — 단, 게이트가 이미 계약 검증을 했으므로 실제로
 *   여기 오는 일은 계약 위반 데이터뿐이다.
 * - **표시 문자는 여기서 붙인다.** ❶·정의·예 같은 마커는 데이터에 없다.
 * ───────────────────────────────────────────────────────────── */

type Mode = "publish" | "authoring";

interface Run {
  kind?: string;
  text?: string;
  math?: { latex?: string };
}

interface Cell {
  kind?: string;
  text?: string;
  math?: { latex?: string };
  isHeader?: boolean;
  emphasis?: "bold" | "struck";
  colspan?: number;
  rowspan?: number;
}

interface Block {
  type?: string;
  text?: string;
  runs?: Run[];
  level?: number;
  term?: string;
  content?: unknown;
  title?: string;
  items?: unknown;
  math?: { latex?: string };
  rows?: Cell[][];
  caption?: string;
  variant?: string;
  tone?: string;
  label?: string;
  altText?: string;
}

/** 톤별 표시 — 라벨 기본값과 색. 데이터에는 tone만 있다. */
const TONES: Record<
  string,
  { label: string; box: string; chip: string }
> = {
  example: {
    label: "예",
    box: "border-rule bg-paper",
    chip: "bg-ink-soft text-white",
  },
  note: {
    label: "참고",
    box: "border-pen/40 bg-pen-soft/40",
    chip: "bg-pen text-white",
  },
  caution: {
    label: "주의",
    box: "border-grade/50 bg-grade-soft",
    chip: "bg-grade text-white",
  },
  supplement: {
    label: "보충",
    box: "border-highlight bg-highlight-soft",
    chip: "bg-highlight text-ink",
  },
};

function runsToMixed(runs: Run[] | undefined): string {
  /* 이웃한 수식 런 사이에는 공백을 끼운다 — 그냥 이어 붙이면 `$a$$b$`가
   * 되어 혼합 텍스트 스캐너가 $$ 블록으로 오독한다. 다행 수식이 끼면
   * 글루 복구도 안 돼 두 수식이 통째로 사라진다 (적대 검토 D1 실증). */
  const parts: string[] = [];
  let prevMath = false;
  for (const r of runs ?? []) {
    if (r.kind === "math") {
      if (prevMath) parts.push(" ");
      parts.push(`$${r.math?.latex ?? ""}$`);
      prevMath = true;
    } else {
      parts.push(r.text ?? "");
      prevMath = false;
    }
  }
  return parts.join("");
}

/** 혼합 텍스트 한 조각 — 기존 단일 렌더 계약(renderMixedText) 그대로 */
function Mixed({ content, mode }: { content: string; mode: Mode }) {
  const rendered = renderMixedText(content, mode);
  return <span dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

export function ReadingBody({
  body,
  mode = "publish",
}: {
  body: unknown;
  mode?: Mode;
}) {
  if (!Array.isArray(body)) return null;
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {(body as Block[]).map((block, i) => (
        <BlockView key={i} block={block} mode={mode} />
      ))}
    </div>
  );
}

function BlockView({ block, mode }: { block: Block; mode: Mode }) {
  switch (block.type) {
    case "text":
      return (
        <p>
          <Mixed content={block.text ?? ""} mode={mode} />
        </p>
      );

    case "paragraph":
      return (
        <p>
          <Mixed content={runsToMixed(block.runs)} mode={mode} />
        </p>
      );

    case "heading": {
      const content = <Mixed content={runsToMixed(block.runs)} mode={mode} />;
      return block.level === 3 ? (
        <h4 className="mt-3 text-[15px] font-semibold">{content}</h4>
      ) : (
        <h3 className="mt-4 text-base font-bold">{content}</h3>
      );
    }

    case "definition":
      return (
        <div className="rounded-lg border-[1.5px] border-pen bg-pen-soft/40 px-4 py-3">
          <p className="font-semibold text-pen">
            <span className="mr-2 rounded bg-pen px-1.5 py-0.5 align-[2px] text-[11px] font-semibold text-white">
              정의
            </span>
            <Mixed content={block.term ?? ""} mode={mode} />
          </p>
          <p className="mt-1">
            <Mixed
              content={runsToMixed(block.content as Run[] | undefined)}
              mode={mode}
            />
          </p>
        </div>
      );

    case "key_point": {
      const items = Array.isArray(block.items) ? (block.items as Run[][]) : [];
      return (
        <div className="rounded-lg border border-rule border-l-4 border-l-pen bg-surface px-4 py-3">
          {block.title && (
            <p className="font-semibold">
              <Mixed content={block.title} mode={mode} />
            </p>
          )}
          <ul className="mt-1 list-disc space-y-1 pl-5 marker:text-pen">
            {items.map((runs, i) => (
              <li key={i}>
                <Mixed content={runsToMixed(runs)} mode={mode} />
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case "steps": {
      const items = Array.isArray(block.items)
        ? (block.items as { content?: Run[] }[])
        : [];
      return (
        <div className="rounded-lg border border-rule px-4 py-3">
          {block.title && (
            <p className="mb-2 font-semibold">
              <Mixed content={block.title} mode={mode} />
            </p>
          )}
          <ol className="space-y-1.5">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                {/* 번호는 여기서 붙는다 — 데이터는 순서만 안다 */}
                <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <Mixed content={runsToMixed(item.content)} mode={mode} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      );
    }

    case "display_math":
      return (
        <div className="my-1">
          <Mixed content={`$$${block.math?.latex ?? ""}$$`} mode={mode} />
        </div>
      );

    case "math_table": {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      /* division: 공약수로 나누는 세로셈. 격자를 그리면 계산이 아니라 자료
       * 표로 읽힌다 — 지면처럼 나누는 수(첫 칸) 오른쪽 세로줄과 단계 사이
       * 가로줄만 긋는다. */
      const division = block.variant === "division";
      return (
        <div className="overflow-x-auto">
          <table className="mx-auto border-collapse">
            {block.caption && (
              <caption className="mb-1 caption-top text-xs text-ink-soft">
                <Mixed content={block.caption} mode={mode} />
              </caption>
            )}
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const Tag = !division && cell.isHeader ? "th" : "td";
                    const shape = division
                      ? `px-3 py-0.5 text-center ${c === 0 ? "border-r border-ink pr-2" : ""} ${
                          r < rows.length - 1 ? "border-b border-ink" : ""
                        }`
                      : `border border-rule px-2.5 py-1 text-center ${
                          cell.isHeader ? "bg-paper font-semibold" : ""
                        }`;
                    return (
                      <Tag
                        key={c}
                        colSpan={cell.colspan && cell.colspan > 1 ? cell.colspan : undefined}
                        rowSpan={cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined}
                        className={`${shape} ${
                          cell.emphasis === "bold"
                            ? "bg-pen-soft/40 font-bold text-pen"
                            : ""
                        } ${cell.emphasis === "struck" ? "text-ink-soft" : ""}`}
                        style={
                          cell.emphasis === "struck"
                            ? {
                                /* 지워진 셀 — 사선은 CSS가 긋는다 (계약 주석 참조) */
                                backgroundImage:
                                  "linear-gradient(to top right, transparent 46%, var(--color-grade) 46%, var(--color-grade) 54%, transparent 54%)",
                              }
                            : undefined
                        }
                      >
                        {/* kind가 뜻을 정한다 — empty 셀에 text가 실려
                            있어도 그리지 않는다 (계약 밖 유령 값) */}
                        {cell.kind === "math" && cell.math?.latex ? (
                          <Mixed content={`$${cell.math.latex}$`} mode={mode} />
                        ) : cell.kind === "text" ? (
                          <Mixed content={cell.text ?? ""} mode={mode} />
                        ) : null}
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "callout": {
      /* hasOwnProperty — TONES["constructor"] 같은 프로토타입 키가 폴백을
       * 뚫고 undefined 클래스를 만들지 않게 (적대 검토 D14) */
      const tone =
        block.tone && Object.prototype.hasOwnProperty.call(TONES, block.tone)
          ? TONES[block.tone]!
          : TONES.note!;
      const children = Array.isArray(block.content)
        ? (block.content as Block[])
        : [];
      return (
        <div className={`rounded-lg border px-4 py-3 ${tone.box}`}>
          <span
            className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}
          >
            <Mixed content={block.label ?? tone.label} mode={mode} />
          </span>
          <div className="mt-1.5 space-y-2">
            {children.map((child, i) => (
              <BlockView key={i} block={child} mode={mode} />
            ))}
          </div>
        </div>
      );
    }

    case "image_crop":
      /* 자산 파이프라인 전 — altText가 곧 내용이다. 빈 상자보다 낫다. */
      return (
        <p className="rounded-lg border border-dashed border-rule px-4 py-3 text-sm text-ink-soft">
          [그림] <Mixed content={block.altText ?? ""} mode={mode} />
        </p>
      );

    default:
      /* 계약 밖 블록 — 검수자에게는 보이게, 학생에게는 빼고 */
      return mode === "authoring" ? (
        <p className="rounded border border-grade bg-grade-soft px-3 py-1.5 font-mono text-xs text-grade">
          알 수 없는 블록: {String(block.type)}
        </p>
      ) : null;
  }
}
