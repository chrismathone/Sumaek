/**
 * 최소 XML 파서 — HWPX 산출물 형식 검증용.
 *
 * writer 가 문자열 조립으로 section0.xml 을 만들므로, "잘 만들어졌다"는 주장은
 * 조립 코드와 무관한 파서가 통째로 읽어낼 수 있을 때만 성립한다. Node 에 내장
 * XML 파서가 없고 이것 하나 때문에 의존성을 늘리고 싶지 않아 직접 쓴다.
 *
 * 일부러 엄격하다 — 닫히지 않은 태그, 짝이 안 맞는 종료 태그, 이스케이프되지
 * 않은 `<`·`&`, 따옴표 없는 속성값에서 모두 throw 한다. 관대한 파서는 writer 의
 * 버그를 덮어버려 검증을 무의미하게 만든다.
 *
 * 네임스페이스는 접두사 그대로 다룬다(`hp:equation`). HWPX 의 접두사는 한글이
 * 고정해서 쓰므로 URI 로 정규화할 실익이 없다.
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | { readonly text: string };

export function isElement(node: XmlNode): node is XmlElement {
  return "name" in node;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const KNOWN_ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/;

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseDocument(): XmlElement {
    this.skipProlog();
    const root = this.parseElement();
    this.skipWhitespace();
    if (this.pos < this.src.length) {
      throw new Error(`루트 요소 뒤에 내용이 남았다: ${this.snippet()}`);
    }
    return root;
  }

  /** XML 선언·주석·처리 명령을 건너뛴다. */
  private skipProlog(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.src.startsWith("<?", this.pos)) {
        const end = this.src.indexOf("?>", this.pos);
        if (end < 0) throw new Error("닫히지 않은 처리 명령");
        this.pos = end + 2;
        continue;
      }
      if (this.src.startsWith("<!--", this.pos)) {
        const end = this.src.indexOf("-->", this.pos);
        if (end < 0) throw new Error("닫히지 않은 주석");
        this.pos = end + 3;
        continue;
      }
      return;
    }
  }

  private parseElement(): XmlElement {
    if (this.src[this.pos] !== "<") {
      throw new Error(`요소 시작을 기대했다: ${this.snippet()}`);
    }
    this.pos += 1;
    const name = this.parseName();
    const attrs = this.parseAttributes();

    if (this.src.startsWith("/>", this.pos)) {
      this.pos += 2;
      return { name, attrs, children: [] };
    }
    if (this.src[this.pos] !== ">") {
      throw new Error(`'${name}' 시작 태그가 닫히지 않았다: ${this.snippet()}`);
    }
    this.pos += 1;

    const children = this.parseChildren(name);
    return { name, attrs, children };
  }

  private parseChildren(parentName: string): XmlNode[] {
    const children: XmlNode[] = [];
    for (;;) {
      if (this.pos >= this.src.length) {
        throw new Error(`'${parentName}' 가 닫히지 않은 채 문서가 끝났다`);
      }
      if (this.src.startsWith("</", this.pos)) {
        this.pos += 2;
        const closing = this.parseName();
        this.skipWhitespace();
        if (this.src[this.pos] !== ">") {
          throw new Error(`'${closing}' 종료 태그가 닫히지 않았다`);
        }
        this.pos += 1;
        if (closing !== parentName) {
          throw new Error(`태그 짝이 안 맞는다: <${parentName}> ... </${closing}>`);
        }
        return children;
      }
      if (this.src.startsWith("<!--", this.pos)) {
        const end = this.src.indexOf("-->", this.pos);
        if (end < 0) throw new Error("닫히지 않은 주석");
        this.pos = end + 3;
        continue;
      }
      if (this.src[this.pos] === "<") {
        children.push(this.parseElement());
        continue;
      }
      children.push({ text: this.parseText() });
    }
  }

  private parseText(): string {
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== "<") {
      if (this.src[this.pos] === "&") this.requireEntity();
      else this.pos += 1;
    }
    return decodeEntities(this.src.slice(start, this.pos));
  }

  private parseAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (;;) {
      const hadSpace = this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === undefined || ch === ">" || this.src.startsWith("/>", this.pos)) {
        return attrs;
      }
      if (!hadSpace) {
        throw new Error(`속성 앞에 공백이 없다: ${this.snippet()}`);
      }
      const name = this.parseName();
      this.skipWhitespace();
      if (this.src[this.pos] !== "=") {
        throw new Error(`속성 '${name}' 에 '=' 가 없다: ${this.snippet()}`);
      }
      this.pos += 1;
      this.skipWhitespace();
      const quote = this.src[this.pos];
      if (quote !== '"' && quote !== "'") {
        throw new Error(`속성 '${name}' 값에 따옴표가 없다: ${this.snippet()}`);
      }
      this.pos += 1;
      const start = this.pos;
      while (this.pos < this.src.length && this.src[this.pos] !== quote) {
        const c = this.src[this.pos] as string;
        if (c === "<") {
          throw new Error(`속성 '${name}' 값에 이스케이프되지 않은 '<' 가 있다`);
        }
        if (c === "&") this.requireEntity();
        else this.pos += 1;
      }
      if (this.src[this.pos] !== quote) {
        throw new Error(`속성 '${name}' 값이 닫히지 않았다`);
      }
      if (name in attrs) throw new Error(`속성 '${name}' 이 중복됐다`);
      attrs[name] = decodeEntities(this.src.slice(start, this.pos));
      this.pos += 1;
    }
  }

  /** `&` 를 만났을 때 알려진 엔티티인지 확인하고 통과시킨다. */
  private requireEntity(): void {
    const match = KNOWN_ENTITY.exec(this.src.slice(this.pos));
    if (!match) {
      throw new Error(`이스케이프되지 않은 '&' 가 있다: ${this.snippet()}`);
    }
    this.pos += match[0].length;
  }

  private parseName(): string {
    const start = this.pos;
    if (!NAME_START.test(this.src[this.pos] ?? "")) {
      throw new Error(`이름을 기대했다: ${this.snippet()}`);
    }
    this.pos += 1;
    while (NAME_CHAR.test(this.src[this.pos] ?? "")) this.pos += 1;
    return this.src.slice(start, this.pos);
  }

  /** 공백을 건너뛰고 하나라도 건너뛰었는지 알린다. */
  private skipWhitespace(): boolean {
    const start = this.pos;
    while (/\s/.test(this.src[this.pos] ?? "")) this.pos += 1;
    return this.pos > start;
  }

  private snippet(): string {
    return JSON.stringify(this.src.slice(this.pos, this.pos + 40));
  }
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9A-Fa-f]+));/g,
    (_all, named?: string, dec?: string, hex?: string) => {
      if (named) {
        return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named] as string;
      }
      const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex as string, 16);
      return String.fromCodePoint(code);
    },
  );
}

/** 문서 전체를 읽는다. 조금이라도 어긋나면 throw — 그 자체가 well-formed 검사다. */
export function parseXml(source: string): XmlElement {
  return new Parser(source).parseDocument();
}

/** 트리에서 이름이 같은 요소를 문서 순서대로 모은다. */
export function findElements(root: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (element: XmlElement): void => {
    if (element.name === name) found.push(element);
    for (const child of element.children) if (isElement(child)) walk(child);
  };
  walk(root);
  return found;
}

/** 있어야 할 요소를 찾지 못했으면 그 자리에서 실패시킨다 (테스트 가독성용). */
export function requireElement(
  element: XmlElement | undefined,
  what: string,
): XmlElement {
  if (!element) throw new Error(`요소를 찾지 못했다: ${what}`);
  return element;
}

/** 요소 아래 모든 텍스트를 이어 붙인다. */
export function textOf(element: XmlElement): string {
  let out = "";
  for (const child of element.children) {
    out += isElement(child) ? textOf(child) : child.text;
  }
  return out;
}
