/**
 * HWPX 생성기 — 문항 목록을 한글이 여는 .hwpx 바이트로 조립한다.
 *
 * 설계 원칙 두 가지가 나머지를 결정한다.
 *
 * 1. **미지원 수식은 내보내지 않는다.** `latexToHwpEq` 가 변환하지 못한 LaTeX
 *    명령을 하나라도 보고하면 빌드 전체를 실패시킨다. 원문 LaTeX 를 그대로
 *    본문에 흘리거나 해당 수식만 빼고 내보내는 폴백은 없다 — 조용히 뜻이 바뀐
 *    시험지가 인쇄되는 쪽이 실패보다 훨씬 비싸다(골프롬프트 2P-6, 그리고
 *    원본 `latex_to_hwpeq.py:1196` 의 무언 삭제 결함을 되풀이하지 않기 위함).
 *
 * 2. **같은 입력은 같은 바이트.** 문단·수식 id 는 난수가 아니라 등장 순서에서
 *    유도하고, 문서 메타데이터에 저장 시각을 넣지 않는다(불변 조건 12).
 *
 * 수식 객체의 width/height 는 `estimateEquationSize` 가 준다. HWPX 는 이 값을
 * 문서에 직접 적어야 하고 한글은 열 때 다시 재지 않으므로, 추정이 틀리면 그대로
 * 레이아웃이 틀어진다 — 추정기 회귀 게이트(test/hwp/metrics.test.ts)가 그래서 있다.
 */

import { type Zippable, zipSync } from "fflate";

import { latexToHwpEq } from "../hwp/convert";
import { estimateEquationSize } from "../hwp/metrics";
import {
  CHAR_PR_BODY,
  CHAR_PR_TITLE,
  COL_PR_CTRL,
  CONTAINER_RDF,
  CONTAINER_XML,
  EQUATION_BASE_LINE,
  EQUATION_FONT,
  EQUATION_OUT_MARGIN,
  HEADER_XML,
  LINE_SEG_ARRAY,
  MANIFEST_XML,
  MIMETYPE,
  PARA_PR_BODY,
  PARA_PR_TITLE,
  PREVIEW_TEXT,
  SECTION_CLOSE,
  SECTION_OPEN,
  SEC_PR,
  SETTINGS_XML,
  VERSION_XML,
  buildContentHpf,
} from "./template";
import { escapeXml } from "./xml";

/* ─────────────────────────────────────────────────────────────
 * 입력 타입
 * ───────────────────────────────────────────────────────────── */

/** 문단을 이루는 조각. 텍스트와 수식이 한 줄에 섞인다. */
export type HwpxRun =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "equation"; readonly latex: string };

export interface HwpxQuestion {
  /** 시험지에 인쇄되는 문항 번호. `1.` 형태로 본문 앞에 붙는다. */
  readonly number: number;
  /** 발문 — 텍스트·수식 조각의 나열. */
  readonly runs: readonly HwpxRun[];
  /** 선택지. 없으면 서술형으로 간주해 발문만 쓴다. */
  readonly choices?: readonly (readonly HwpxRun[])[];
}

export interface HwpxExamDoc {
  readonly title: string;
  readonly questions: readonly HwpxQuestion[];
}

export interface HwpxBuildOptions {
  /**
   * `latexToHwpEq` 의 같은 이름 옵션으로 그대로 넘어간다.
   * 이미 확통 이탤릭 전처리를 거친 본문이라면 false 로 줘서 `\mathrm{P}`
   * (기하의 점 P)가 이탤릭으로 되돌아가는 것을 막는다.
   */
  readonly italicizeStat?: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * 실패 보고
 * ───────────────────────────────────────────────────────────── */

/** 변환에 실패한 수식 하나 — 어느 문항 어디였는지까지 짚어준다. */
export interface UnsupportedEquation {
  /** 원본 LaTeX. 사용자가 이 문자열로 문항을 찾을 수 있어야 한다. */
  readonly latex: string;
  /** `latexToHwpEq` 가 변환하지 못한 명령들. */
  readonly unsupported: readonly string[];
  /** 문항 번호. 제목 등 문항 밖 수식이면 undefined. */
  readonly questionNumber?: number;
  /** 사람이 읽는 위치 설명 (예: "3번 문항 발문", "3번 문항 ② 선택지"). */
  readonly location: string;
}

/**
 * 미지원 LaTeX 명령 때문에 빌드를 중단했을 때 던진다.
 *
 * 첫 실패에서 멈추지 않고 문서 전체를 훑어 모든 실패를 모은다 — 한 번 고치고
 * 다시 돌렸더니 다음 수식에서 또 막히는 일을 피하기 위함이다.
 */
export class HwpxUnsupportedEquationError extends Error {
  readonly equations: readonly UnsupportedEquation[];

  constructor(equations: readonly UnsupportedEquation[]) {
    const detail = equations
      .map((e) => `  - ${e.location}: ${e.latex} (미지원: ${e.unsupported.join(", ")})`)
      .join("\n");
    super(
      `HWPX 를 만들 수 없다 — HWP 수식으로 옮기지 못한 LaTeX 명령이 ` +
        `${equations.length}개 수식에 있다.\n${detail}`,
    );
    this.name = "HwpxUnsupportedEquationError";
    this.equations = equations;
  }
}

/* ─────────────────────────────────────────────────────────────
 * 수식 변환 (조립 전 일괄 검사)
 * ───────────────────────────────────────────────────────────── */

/** 변환이 끝난 수식 — 조립 단계는 이것만 본다. */
interface ConvertedEquation {
  readonly script: string;
  readonly width: number;
  readonly height: number;
}

/**
 * 문서의 모든 수식을 먼저 변환한다. 하나라도 미지원이면 던진다.
 *
 * run 객체를 키로 하는 Map 을 돌려주는 이유: 같은 LaTeX 가 여러 번 나와도
 * 조립 단계에서 위치별로 정확히 되찾기 위함이다(문자열 키는 충돌한다).
 */
function convertEquations(
  doc: HwpxExamDoc,
  options: HwpxBuildOptions,
): Map<HwpxRun, ConvertedEquation> {
  const converted = new Map<HwpxRun, ConvertedEquation>();
  const failures: UnsupportedEquation[] = [];

  const visit = (
    runs: readonly HwpxRun[],
    questionNumber: number,
    location: string,
  ): void => {
    for (const run of runs) {
      if (run.kind !== "equation") continue;
      // exactOptionalPropertyTypes: undefined 를 넘기지 말고 키 자체를 빼야
      // latexToHwpEq 의 기본값(true)이 살아난다.
      const result = latexToHwpEq(
        run.latex,
        options.italicizeStat === undefined
          ? {}
          : { italicizeStat: options.italicizeStat },
      );
      if (result.unsupported.length > 0) {
        failures.push({
          latex: run.latex,
          unsupported: result.unsupported,
          questionNumber,
          location,
        });
        continue;
      }
      const size = estimateEquationSize(result.script);
      converted.set(run, {
        script: result.script,
        width: size.width,
        height: size.height,
      });
    }
  };

  for (const question of doc.questions) {
    visit(question.runs, question.number, `${question.number}번 문항 발문`);
    question.choices?.forEach((choice, index) => {
      visit(
        choice,
        question.number,
        `${question.number}번 문항 ${choiceMarker(index)} 선택지`,
      );
    });
  }

  if (failures.length > 0) throw new HwpxUnsupportedEquationError(failures);
  return converted;
}

/* ─────────────────────────────────────────────────────────────
 * section0.xml 조립
 * ───────────────────────────────────────────────────────────── */

/** 원문자 ①..⑳ (U+2460 기준). 그 밖은 `(21)` 처럼 괄호 숫자로 떨어뜨린다. */
function choiceMarker(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : `(${index + 1})`;
}

/**
 * 문서 안에서 유일한 id 를 등장 순서로 발급한다.
 *
 * HWPX 의 id 는 uint32 이기만 하면 되고 값 자체에 의미가 없다. 한글은 난수를
 * 쓰지만 우리는 재현성을 위해 단조 증가 수열을 쓴다. 0 은 한글이 "미지정"으로
 * 취급하는 자리가 있어 1 부터 시작한다.
 */
function createIdSequence(start: number): () => number {
  let next = start;
  return () => next++;
}

function renderEquation(
  eq: ConvertedEquation,
  id: number,
  zOrder: number,
): string {
  return (
    `<hp:equation id="${id}" zOrder="${zOrder}" numberingType="EQUATION"` +
    ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"' +
    ' version="Equation Version 60"' +
    ` baseLine="${EQUATION_BASE_LINE}" textColor="#000000" baseUnit="1000"` +
    ` lineMode="CHAR" font="${EQUATION_FONT}">` +
    `<hp:sz width="${eq.width}" height="${eq.height}" widthRelTo="ABSOLUTE"` +
    ' heightRelTo="ABSOLUTE" protect="0"/>' +
    // treatAsChar=1 이 핵심: 수식이 글자처럼 줄 안에 흐른다. 0 이면 떠다니는
    // 개체가 되어 본문과 따로 논다.
    '<hp:pos treatAsChar="1" affectLSpacing="1" flowWithText="1" allowOverlap="0"' +
    ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP"' +
    ' horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    `<hp:outMargin left="${EQUATION_OUT_MARGIN}" right="${EQUATION_OUT_MARGIN}"` +
    ' top="0" bottom="0"/>' +
    "<hp:shapeComment>수식입니다.</hp:shapeComment>" +
    `<hp:script>${escapeXml(eq.script)}</hp:script>` +
    "</hp:equation>"
  );
}

/** 조립 도중 유지되는 id 발급기 묶음. */
interface RenderContext {
  readonly converted: Map<HwpxRun, ConvertedEquation>;
  readonly nextParaId: () => number;
  readonly nextEquationId: () => number;
  /** zOrder 는 문서 내 개체의 그리기 순서 — 해제본처럼 1 부터 센다. */
  nextZOrder: number;
}

/**
 * run 목록을 `<hp:run>` 문자열로.
 *
 * 수식은 제 run 을 갖지만(해제본도 수식마다 run 을 나눈다), 서식이 같은 연속
 * 텍스트는 하나의 `<hp:t>` 로 합친다. 한글도 같은 서식의 글자를 run 으로 쪼개
 * 저장하지 않고, 쪼개 두면 문항 번호와 발문이 딴 조각이 되어 문서를 다시 읽는
 * 쪽(채점·검수 도구)이 매번 이어 붙여야 한다.
 */
function renderRuns(
  runs: readonly HwpxRun[],
  charPrId: number,
  ctx: RenderContext,
): string {
  let out = "";
  let pendingText = "";

  const flushText = (): void => {
    if (pendingText === "") return;
    out += `<hp:run charPrIDRef="${charPrId}"><hp:t>${escapeXml(pendingText)}</hp:t></hp:run>`;
    pendingText = "";
  };

  for (const run of runs) {
    if (run.kind === "text") {
      pendingText += run.text;
      continue;
    }
    flushText();
    const eq = ctx.converted.get(run);
    // convertEquations 가 모든 equation run 을 채웠으므로 여기서 비는 일은
    // 없다. 방어적으로 남겨 두되 조용히 건너뛰지 않고 터뜨린다.
    if (!eq) {
      throw new Error(
        `내부 오류: 변환되지 않은 수식 run 이 조립 단계에 도달했다 (${run.latex})`,
      );
    }
    out +=
      `<hp:run charPrIDRef="${charPrId}">` +
      renderEquation(eq, ctx.nextEquationId(), ctx.nextZOrder++) +
      "</hp:run>";
  }
  flushText();
  return out;
}

function renderParagraph(
  inner: string,
  paraPrId: number,
  ctx: RenderContext,
): string {
  return (
    `<hp:p id="${ctx.nextParaId()}" paraPrIDRef="${paraPrId}" styleIDRef="0"` +
    ' pageBreak="0" columnBreak="0" merged="0">' +
    inner +
    LINE_SEG_ARRAY +
    "</hp:p>"
  );
}

function buildSectionXml(
  doc: HwpxExamDoc,
  converted: Map<HwpxRun, ConvertedEquation>,
): string {
  const ctx: RenderContext = {
    converted,
    nextParaId: createIdSequence(1),
    nextEquationId: createIdSequence(1),
    nextZOrder: 1,
  };

  // 구역 설정은 첫 문단의 첫 run 안에 있어야 한다(OWPML 규칙). 해제본도 이
  // 문단에는 본문을 넣지 않으므로 같은 형태를 유지한다.
  let body = renderParagraph(
    `<hp:run charPrIDRef="${CHAR_PR_BODY}">${SEC_PR}${COL_PR_CTRL}</hp:run>`,
    PARA_PR_BODY,
    ctx,
  );

  body += renderParagraph(
    renderRuns([{ kind: "text", text: doc.title }], CHAR_PR_TITLE, ctx),
    PARA_PR_TITLE,
    ctx,
  );
  body += renderParagraph("", PARA_PR_BODY, ctx);

  for (const question of doc.questions) {
    const stem: HwpxRun[] = [
      { kind: "text", text: `${question.number}. ` },
      ...question.runs,
    ];
    body += renderParagraph(renderRuns(stem, CHAR_PR_BODY, ctx), PARA_PR_BODY, ctx);

    question.choices?.forEach((choice, index) => {
      const line: HwpxRun[] = [
        { kind: "text", text: `  ${choiceMarker(index)} ` },
        ...choice,
      ];
      body += renderParagraph(
        renderRuns(line, CHAR_PR_BODY, ctx),
        PARA_PR_BODY,
        ctx,
      );
    });

    // 문항 사이 빈 줄
    body += renderParagraph("", PARA_PR_BODY, ctx);
  }

  return SECTION_OPEN + body + SECTION_CLOSE;
}

/* ─────────────────────────────────────────────────────────────
 * ZIP 조립
 * ───────────────────────────────────────────────────────────── */

/** ZIP 안에서 무압축·첫 엔트리여야 하는 파일 경로. */
export const MIMETYPE_PATH = "mimetype";

/**
 * ZIP 엔트리의 고정 수정 시각 — 2020-01-01T00:00:00Z.
 * 재현 가능한 빌드를 위해 현재 시각을 쓰지 않는다(불변 조건 12).
 */
const HWPX_FIXED_MTIME = Date.UTC(2020, 0, 1);

/**
 * HWPX 문서를 이루는 파일들. **순서가 규약이다** — mimetype 이 첫 엔트리여야
 * 하고 무압축이어야 한다(OCF 규약. 한글은 이 바이트를 보고 파일 종류를 판정한다).
 */
export function buildHwpxEntries(
  doc: HwpxExamDoc,
  options: HwpxBuildOptions = {},
): Record<string, string> {
  const converted = convertEquations(doc, options);
  return {
    [MIMETYPE_PATH]: MIMETYPE,
    "version.xml": VERSION_XML,
    "settings.xml": SETTINGS_XML,
    "META-INF/container.xml": CONTAINER_XML,
    "META-INF/manifest.xml": MANIFEST_XML,
    "META-INF/container.rdf": CONTAINER_RDF,
    "Contents/content.hpf": buildContentHpf(escapeXml(doc.title)),
    "Contents/header.xml": HEADER_XML,
    "Contents/section0.xml": buildSectionXml(doc, converted),
    "Preview/PrvText.txt": PREVIEW_TEXT,
  };
}

/**
 * 문항 문서를 .hwpx 바이트로 만든다.
 *
 * @throws {HwpxUnsupportedEquationError} 어느 수식이든 HWP 수식으로 온전히
 *   옮기지 못하면 아무것도 만들지 않고 실패한다.
 */
export function buildHwpxSync(
  doc: HwpxExamDoc,
  options: HwpxBuildOptions = {},
): Uint8Array {
  const entries = buildHwpxEntries(doc, options);
  const encoder = new TextEncoder();

  // 삽입 순서 = ZIP 엔트리 순서. mimetype 을 먼저 넣고 level 0(무압축)으로
  // 지정하는 것이 OCF 규약의 전부다.
  const zipInput: Zippable = {};
  for (const [path, content] of Object.entries(entries)) {
    zipInput[path] =
      path === MIMETYPE_PATH
        ? [encoder.encode(content), { level: 0 }]
        : encoder.encode(content);
  }

  // mtime 고정 — 안 그러면 같은 문서가 실행할 때마다 다른 바이트가 된다.
  return zipSync(zipInput, { level: 6, mtime: HWPX_FIXED_MTIME });
}

/** `buildHwpxSync` 의 비동기 표면. 호출부(워커·라우트)가 await 로 쓰기 편하다. */
export async function buildHwpx(
  doc: HwpxExamDoc,
  options: HwpxBuildOptions = {},
): Promise<Uint8Array> {
  return buildHwpxSync(doc, options);
}
