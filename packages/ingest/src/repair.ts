/**
 * 깨진 LaTeX 후보정 — **화면에 그려지게 만들되, 뜻을 지어내지 않는다.**
 *
 * 반입기가 낸 수식 중 154개가 KaTeX 렌더에 실패하고 있었다(6151문항 전수검사).
 * 실패한 식은 학생 화면에 빨간 오류 글자로 나간다 — 그 문항은 사실상 없는
 * 문항이다. 그런데 실패 원인의 대부분은 **뜻이 아니라 형식**이었다.
 * 여는 괄호만 있고 닫는 짝이 없거나, 지수가 두 번 서거나, 중괄호 개수가
 * 안 맞는다. 조각이 span 경계에서 잘려 오기 때문에 생기는 일이다.
 *
 * ## 여기서 하지 않는 것
 *
 * **없는 내용을 채우지 않는다.** `\frac{1}{}`의 빈 분모에 숫자를 넣거나,
 * `\surd`의 근호 범위를 짐작하는 일은 하지 않는다. 그것은 뜻을 지어내는
 * 것이고, 지어낸 뜻은 화면 어디에도 드러나지 않은 채 학생이 틀린 채점을
 * 받는 것으로만 나타난다. 형식만 고치고, 못 고치는 것은 그대로 둔다.
 *
 * ## 왜 반입 때 고치는가
 *
 * 화면에서 고치면 DB에는 깨진 채로 남아 검사가 계속 빨간불이고, 다른
 * 소비자(인쇄·내보내기)는 여전히 깨진 것을 받는다. 반입 때 고치면 원문
 * (raw_source)은 그대로 보존되면서 파생물만 성해진다 — 원칙 2O가 지키라는
 * 것은 원문이지 파생물이 아니다.
 */

/** 후보정 결과 — 무엇을 고쳤는지 부르는 쪽이 알아야 한다 */
export interface RepairResult {
  latex: string;
  /** 적용된 보정 이름. 비어 있으면 손대지 않았다는 뜻이다. */
  applied: string[];
}

/**
 * 지수가 두 번 선 것을 하나로 합친다.
 *
 * `2^{1}^{1}`은 KaTeX에서 「Double superscript」로 실패한다. 별책이 지수를
 * 조각으로 흘려 보내서(`Ú` 따로, `` `ß` `` 따로) 생기는데, 조각마다 `^{}`를
 * 씌우면 이 꼴이 된다. 안이 단순한 글자·부호일 때만 합친다 — 구조가 든
 * 지수(`^{\frac{1}{2}}`)를 합치면 없는 식이 만들어진다.
 */
function mergeDoubleSuperscript(latex: string): string {
  let out = latex;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(
      /\^\{([0-9A-Za-z+\-.,]*)\}\^\{([0-9A-Za-z+\-.,]*)\}/g,
      (_m, a: string, b: string) => `^{${a}${b}}`,
    );
    if (next === out) break;
    out = next;
  }
  /* 아래첨자도 같은 이유로 두 번 선다 */
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(
      /_\{([0-9A-Za-z+\-.,]*)\}_\{([0-9A-Za-z+\-.,]*)\}/g,
      (_m, a: string, b: string) => `_{${a}${b}}`,
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * 홀로 선 `^`·`_`를 지운다.
 *
 * 뒤에 올 것이 span 경계에서 잘려 나간 자리다. KaTeX는 「Expected group
 * after '^'」로 실패한다. 지수 자리에 무엇이 있었는지는 알 수 없으므로
 * 짐작해 채우지 않고, 연산자만 걷어 낸다 — 남은 식이라도 보이게.
 */
function dropDanglingScript(latex: string): string {
  return latex
    .replace(/([\^_])\s*$/g, "")
    .replace(/([\^_])(?=[\s)}\],]|$)/g, "")
    .replace(/([\^_])([\^_])/g, "$2");
}

/**
 * `\left`와 `\right`의 짝을 맞춘다.
 *
 * 큰 괄호는 여는 조각과 닫는 조각이 서로 다른 span으로 와서, 한쪽만 담긴
 * 채 문항이 잘리는 일이 잦다(중2-1 「12/100\right)(x+y)=25760」). KaTeX는
 * 짝이 없으면 통째로 실패한다. **보이지 않는 짝**(`\right.`·`\left.`)으로
 * 맞추면 지면에 없던 괄호를 그리지 않으면서 렌더는 성공한다.
 */
function balanceLeftRight(latex: string): string {
  const lefts = latex.match(/\\left(?![a-zA-Z])/g)?.length ?? 0;
  const rights = latex.match(/\\right(?![a-zA-Z])/g)?.length ?? 0;
  if (lefts === rights) return latex;
  if (lefts > rights) return `${latex}${"\\right.".repeat(lefts - rights)}`;
  return `${"\\left.".repeat(rights - lefts)}${latex}`;
}

/**
 * 중괄호 짝을 맞춘다.
 *
 * 근호 가구가 여닫이 두 조각으로 오는데(`\sqrt{` · `}`) 한쪽만 살아남는
 * 자리가 있다. 모자라면 끝에 채우고, 남으면 **짝 없는 닫는 괄호만** 지운다
 * — 앞에서부터 세면서 깊이가 음수가 되는 자리가 그 자리다.
 */
function balanceBraces(latex: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < latex.length; i += 1) {
    const ch = latex[i]!;
    const escaped = i > 0 && latex[i - 1] === "\\";
    if (ch === "{" && !escaped) depth += 1;
    else if (ch === "}" && !escaped) {
      if (depth === 0) continue; // 짝 없는 닫는 괄호 — 버린다
      depth -= 1;
    }
    out += ch;
  }
  return depth > 0 ? out + "}".repeat(depth) : out;
}

/**
 * 이름 있는 명령 뒤에 글자가 바로 붙은 것을 띄운다.
 *
 * `40\degree x`는 그려지는데 `40\degreex`는 실패한다 — KaTeX가 `\degreex`를
 * 하나의 명령 이름으로 읽고 그런 명령이 없다고 한다. 해독기는 뒤에 공백을
 * 붙여 내보내지만 조각을 이어 붙이는 과정에서 그 공백이 사라지는 자리가
 * 있다(중1-2 0268의 표 안).
 *
 * **우리가 내보내는 명령만** 다룬다. 모든 `\명령`을 띄우면 `\frac{1}{2}`
 * 같은 인자 있는 명령까지 건드려 식이 부서진다.
 */
const EMITTED_COMMAND =
  /(\\(?:degree|square|times|div|surd|parallel|equiv|backsim|triangle|frown|cdotp))([a-zA-Z])/g;

function spaceAfterCommand(latex: string): string {
  return latex.replace(EMITTED_COMMAND, "$1 $2");
}

/** 빈 껍데기만 남은 식인가 — 고쳐 봐야 화면에 아무것도 없다 */
const isHollow = (latex: string): boolean =>
  latex.replace(/[\s{}]|\\square|\\left\.|\\right\./g, "") === "";

/**
 * 형식이 깨진 LaTeX를 고친다. 뜻은 건드리지 않는다.
 *
 * 순서가 중요하다 — 홀로 선 `^`를 먼저 걷어 내야 지수 합치기가 제 짝을
 * 찾고, 괄호는 마지막에 세어야 앞 단계가 만든 변화까지 반영된다.
 */
export function repairLatex(latex: string): RepairResult {
  const applied: string[] = [];
  let out = latex;

  const step = (name: string, fn: (s: string) => string): void => {
    const next = fn(out);
    if (next !== out) {
      applied.push(name);
      out = next;
    }
  };

  step("명령-뒤-공백", spaceAfterCommand);
  step("홀로-선-지수", dropDanglingScript);
  step("이중-지수-합침", mergeDoubleSuperscript);
  step("중괄호-짝", balanceBraces);
  step("큰괄호-짝", balanceLeftRight);

  /* 고치고 났더니 아무것도 안 남았으면 되돌린다 — 빈 식이 나가느니
   * 깨진 채로 검수함에 가는 편이 낫다. 무엇이 있었는지는 남아야 한다. */
  if (isHollow(out) && !isHollow(latex)) return { latex, applied: [] };

  return { latex: out, applied };
}
