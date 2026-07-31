/**
 * HWPX(OWPML) 최소 유효 골격.
 *
 * 출처: `D:\시험지 한글화\data\골든셋기준_조암중_hwpx해제본\` — 한컴오피스 한글이
 * 실제로 저장한 .hwpx 를 압축 해제한 것. 아래 상수들은 그 해제본의 XML 을
 * **구조 그대로** 옮기되, 학교명·작성자 등 개인정보성 텍스트를 제거하고
 * 문서 하나를 만드는 데 필요 없는 항목(미사용 글자모양 6종·문단모양 20종·
 * 스타일 22종)을 덜어낸 것이다.
 *
 * 손대지 말 것:
 * - 네임스페이스 URI 와 접두사(hp/hs/hh/hc/ha/hpf/opf/ocf/odf) — 한글이
 *   접두사까지 문자열로 비교하는 경로가 있다.
 * - `itemCnt` 는 실제 자식 수와 반드시 일치해야 한다. 아래 상수를 늘리거나
 *   줄이면 itemCnt 도 같이 고칠 것.
 * - `<hh:charPr>` 자식 순서(fontRef→ratio→spacing→relSz→offset→underline→
 *   strikeout→outline→shadow)는 OWPML 스키마가 강제하는 순서다.
 */

/** ZIP 첫 엔트리에 무압축으로 들어가야 하는 컨테이너 식별자. */
export const MIMETYPE = "application/hwp+zip";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* ─────────────────────────────────────────────────────────────
 * 패키지 수준 파일
 * ───────────────────────────────────────────────────────────── */

/**
 * 해제본 version.xml 그대로. `application`/`appVersion` 은 이 문서를 만든
 * 프로그램을 표시할 뿐 한글이 열 때 검증하지 않으므로 수맥 이름으로 바꿨다.
 */
export const VERSION_XML =
  XML_DECL +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"' +
  ' tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1"' +
  ' buildNumber="0" os="1" xmlVersion="1.5" application="Su-Maek"' +
  ' appVersion="0.1.0"/>';

/** 해제본 settings.xml 그대로 — 캐럿 위치만 담은 앱 설정. */
export const SETTINGS_XML =
  XML_DECL +
  '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">' +
  '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>' +
  "</ha:HWPApplicationSetting>";

/** 해제본 META-INF/container.xml 그대로. rootfile 3종을 모두 유지한다. */
export const CONTAINER_XML =
  XML_DECL +
  '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"' +
  ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>' +
  '<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>' +
  '<ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/>' +
  '<ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/>' +
  "</ocf:rootfiles></ocf:container>";

/** 해제본 META-INF/manifest.xml 그대로 — 원본도 빈 매니페스트다. */
export const MANIFEST_XML =
  XML_DECL +
  '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

/** 해제본 META-INF/container.rdf 그대로 — header/section0 을 패키지 부품으로 선언. */
export const CONTAINER_RDF =
  XML_DECL +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about=""><ns0:hasPart' +
  ' xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#"' +
  ' rdf:resource="Contents/header.xml"/></rdf:Description>' +
  '<rdf:Description rdf:about="Contents/header.xml"><rdf:type' +
  ' rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about=""><ns0:hasPart' +
  ' xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#"' +
  ' rdf:resource="Contents/section0.xml"/></rdf:Description>' +
  '<rdf:Description rdf:about="Contents/section0.xml"><rdf:type' +
  ' rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about=""><rdf:type' +
  ' rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/>' +
  "</rdf:Description></rdf:RDF>";

/**
 * content.hpf 의 공통 네임스페이스 선언 — 해제본에서 그대로 가져왔다.
 * 실제로 쓰이는 것은 opf 뿐이지만 한글이 저장할 때 전부 붙이므로 유지한다.
 */
const HPF_NAMESPACES =
  ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
  ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"' +
  ' xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"' +
  ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"' +
  ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"' +
  ' xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"' +
  ' xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"' +
  ' xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"' +
  ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
  ' xmlns:opf="http://www.idpf.org/2007/opf/"' +
  ' xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"' +
  ' xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"' +
  ' xmlns:epub="http://www.idpf.org/2007/ops"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

/**
 * Contents/content.hpf — 패키지 목차.
 *
 * 해제본과 다른 점: creator/lastsaveby 의 실제 사용자명과 저장 시각을 지웠다.
 * 시각을 넣으면 같은 입력이 다른 바이트를 내므로(불변 조건 12) 비워 둔다.
 *
 * @param escapedTitle **이미 XML 이스케이프된** 문서 제목
 */
export function buildContentHpf(escapedTitle: string): string {
  return (
    XML_DECL +
    "<opf:package" +
    HPF_NAMESPACES +
    ' version="" unique-identifier="" id="">' +
    "<opf:metadata>" +
    `<opf:title>${escapedTitle}</opf:title>` +
    "<opf:language>ko</opf:language>" +
    '<opf:meta name="creator" content="text"/>' +
    '<opf:meta name="subject" content="text"/>' +
    '<opf:meta name="description" content="text"/>' +
    '<opf:meta name="lastsaveby" content="text"/>' +
    '<opf:meta name="keyword" content="text"/>' +
    "</opf:metadata>" +
    "<opf:manifest>" +
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
    '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>' +
    "</opf:manifest>" +
    "<opf:spine>" +
    '<opf:itemref idref="header" linear="yes"/>' +
    '<opf:itemref idref="section0" linear="yes"/>' +
    "</opf:spine>" +
    "</opf:package>"
  );
}

/**
 * Preview/PrvText.txt — container.xml 이 rootfile 로 참조하므로 파일 자체는
 * 있어야 한다. 해제본의 실제 내용도 CRLF 두 바이트뿐이라 그대로 둔다
 * (한글이 저장할 때 다시 채운다).
 */
export const PREVIEW_TEXT = "\r\n";

/* ─────────────────────────────────────────────────────────────
 * Contents/header.xml
 * ───────────────────────────────────────────────────────────── */

/** 해제본이 쓰는 기본 글꼴 2종. id 0/1 은 charPr 의 fontRef 가 가리키는 번호다. */
const FONT_FACES = ["함초롬돋움", "함초롬바탕"] as const;

/** OWPML 이 요구하는 언어 분류 7종 — 하나라도 빠지면 한글이 글꼴을 못 찾는다. */
const FONT_LANGS = [
  "HANGUL",
  "LATIN",
  "HANJA",
  "JAPANESE",
  "OTHER",
  "SYMBOL",
  "USER",
] as const;

const TYPE_INFO =
  '<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4"' +
  ' contrast="0" strokeVariation="1" armStyle="1" letterform="1"' +
  ' midline="1" xHeight="1"/>';

function buildFontFaces(): string {
  const fonts = FONT_FACES.map(
    (face, id) =>
      `<hh:font id="${id}" face="${face}" type="TTF" isEmbedded="0">` +
      TYPE_INFO +
      "</hh:font>",
  ).join("");
  const faces = FONT_LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="${FONT_FACES.length}">` +
      fonts +
      "</hh:fontface>",
  ).join("");
  return `<hh:fontfaces itemCnt="${FONT_LANGS.length}">${faces}</hh:fontfaces>`;
}

/**
 * 테두리/채우기 2종. id=1 은 secPr 의 `pageBorderFill` 이, id=2 는 charPr·paraPr 의
 * `borderFillIDRef` 가 가리킨다 — 둘 다 실제 참조가 있으므로 지우면 안 된다.
 */
const BORDER_FILLS =
  '<hh:borderFills itemCnt="2">' +
  '<hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
  '<hh:slash type="NONE" Crooked="0" isCounter="0"/>' +
  '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
  '<hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
  "</hh:borderFill>" +
  '<hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
  '<hh:slash type="NONE" Crooked="0" isCounter="0"/>' +
  '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
  '<hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>' +
  '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
  "<hc:fillBrush>" +
  '<hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/>' +
  "</hc:fillBrush>" +
  "</hh:borderFill>" +
  "</hh:borderFills>";

const ALL_LANG_ATTRS =
  'hangul="%v" latin="%v" hanja="%v" japanese="%v" other="%v" symbol="%v" user="%v"';

function langAttrs(value: string | number): string {
  return ALL_LANG_ATTRS.replaceAll("%v", String(value));
}

/** fontfaces 의 id — 1 = 함초롬바탕(해제본 본문 글꼴). */
const CHARPR_FONT_ID = 1;

/**
 * 글자모양. height 는 1/100 pt — 1000 = 10pt.
 * 해제본에는 굵게/기울임을 쓰는 charPr 이 없었으므로 여기서도 쓰지 않고,
 * 제목은 글자 크기만 키운다(검증되지 않은 요소를 새로 넣지 않기 위함).
 */
function buildCharPr(id: number, height: number): string {
  return (
    `<hh:charPr id="${id}" height="${height}" textColor="#000000"` +
    ' shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE"' +
    ' borderFillIDRef="2">' +
    `<hh:fontRef ${langAttrs(CHARPR_FONT_ID)}/>` +
    `<hh:ratio ${langAttrs(100)}/>` +
    `<hh:spacing ${langAttrs(0)}/>` +
    `<hh:relSz ${langAttrs(100)}/>` +
    `<hh:offset ${langAttrs(0)}/>` +
    '<hh:underline type="NONE" shape="SOLID" color="#000000"/>' +
    '<hh:strikeout shape="NONE" color="#000000"/>' +
    '<hh:outline type="NONE"/>' +
    '<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>' +
    "</hh:charPr>"
  );
}

/** 본문 글자모양 id — 모든 hp:run 의 charPrIDRef 기본값. */
export const CHAR_PR_BODY = 0;
/** 제목 글자모양 id — 14pt. */
export const CHAR_PR_TITLE = 1;

const CHAR_PROPERTIES =
  '<hh:charProperties itemCnt="2">' +
  buildCharPr(CHAR_PR_BODY, 1000) +
  buildCharPr(CHAR_PR_TITLE, 1400) +
  "</hh:charProperties>";

/** 해제본 그대로 — 자동 탭 3종. paraPr 의 tabPrIDRef 가 0 을 가리킨다. */
const TAB_PROPERTIES =
  '<hh:tabProperties itemCnt="3">' +
  '<hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/>' +
  '<hh:tabPr id="1" autoTabLeft="1" autoTabRight="0"/>' +
  '<hh:tabPr id="2" autoTabLeft="0" autoTabRight="1"/>' +
  "</hh:tabProperties>";

function paraHead(level: number, numFormat: string, checkable: 0 | 1, label: string): string {
  return (
    `<hh:paraHead start="1" level="${level}" align="LEFT" useInstWidth="1"` +
    ' autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50"' +
    ` numFormat="${numFormat}" charPrIDRef="4294967295" checkable="${checkable}">` +
    `${label}</hh:paraHead>`
  );
}

/**
 * 문단 번호 정의 1종 — 해제본 그대로. 이 문서는 자동 번호를 쓰지 않지만
 * (문항 번호는 본문 텍스트로 직접 적는다) 한글이 새 문서에 항상 하나를
 * 넣으므로 유지한다.
 */
const NUMBERINGS =
  '<hh:numberings itemCnt="1"><hh:numbering id="1" start="0">' +
  paraHead(1, "DIGIT", 0, "^1.") +
  paraHead(2, "HANGUL_SYLLABLE", 0, "^2.") +
  paraHead(3, "DIGIT", 0, "^3)") +
  paraHead(4, "HANGUL_SYLLABLE", 0, "^4)") +
  paraHead(5, "DIGIT", 0, "(^5)") +
  paraHead(6, "HANGUL_SYLLABLE", 0, "(^6)") +
  paraHead(7, "CIRCLED_DIGIT", 1, "^7") +
  paraHead(8, "CIRCLED_HANGUL_SYLLABLE", 1, "^8") +
  paraHead(9, "HANGUL_JAMO", 0, "") +
  paraHead(10, "ROMAN_SMALL", 1, "") +
  "</hh:numbering></hh:numberings>";

const PARA_MARGIN_AND_SPACING =
  "<hh:margin>" +
  '<hc:intent value="0" unit="HWPUNIT"/>' +
  '<hc:left value="0" unit="HWPUNIT"/>' +
  '<hc:right value="0" unit="HWPUNIT"/>' +
  '<hc:prev value="0" unit="HWPUNIT"/>' +
  '<hc:next value="0" unit="HWPUNIT"/>' +
  "</hh:margin>" +
  '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>';

/**
 * 문단모양. `hp:switch` 로 HwpUnitChar 네임스페이스를 아는 버전과 모르는 버전에
 * 같은 여백을 각각 주는 구조는 해제본 그대로다 — 한글이 이 형태로만 저장한다.
 */
function buildParaPr(id: number, horizontal: "JUSTIFY" | "CENTER"): string {
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0"` +
    ' snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="LTR">' +
    `<hh:align horizontal="${horizontal}" vertical="BASELINE"/>` +
    '<hh:heading type="NONE" idRef="0" level="0"/>' +
    '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD"' +
    ' widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
    '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
    "<hp:switch>" +
    '<hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">' +
    PARA_MARGIN_AND_SPACING +
    "</hp:case>" +
    "<hp:default>" +
    PARA_MARGIN_AND_SPACING +
    "</hp:default>" +
    "</hp:switch>" +
    '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0"' +
    ' offsetBottom="0" connect="0" ignoreMargin="0"/>' +
    "</hh:paraPr>"
  );
}

/** 본문 문단모양 id — 양쪽 정렬. */
export const PARA_PR_BODY = 0;
/** 제목 문단모양 id — 가운데 정렬. */
export const PARA_PR_TITLE = 1;

const PARA_PROPERTIES =
  '<hh:paraProperties itemCnt="2">' +
  buildParaPr(PARA_PR_BODY, "JUSTIFY") +
  buildParaPr(PARA_PR_TITLE, "CENTER") +
  "</hh:paraProperties>";

/**
 * 스타일 1종(바탕글). 문단이 paraPrIDRef 를 직접 지정하므로 스타일은
 * 하나면 충분하다 — 해제본의 나머지 22종(개요 1~7, 쪽 번호, 캡션 …)은 뺐다.
 */
const STYLES =
  '<hh:styles itemCnt="1">' +
  '<hh:style id="0" type="PARA" name="바탕글" engName="Normal"' +
  ' paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>' +
  "</hh:styles>";

const HEAD_NAMESPACES =
  ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
  ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"' +
  ' xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"' +
  ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"' +
  ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"' +
  ' xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"' +
  ' xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"' +
  ' xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"' +
  ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
  ' xmlns:opf="http://www.idpf.org/2007/opf/"' +
  ' xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"' +
  ' xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"' +
  ' xmlns:epub="http://www.idpf.org/2007/ops"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

/** Contents/header.xml — 문서 전역 서식 정의. 본문과 달리 내용에 의존하지 않는다. */
export const HEADER_XML =
  XML_DECL +
  "<hh:head" +
  HEAD_NAMESPACES +
  ' version="1.5" secCnt="1">' +
  '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
  "<hh:refList>" +
  buildFontFaces() +
  BORDER_FILLS +
  CHAR_PROPERTIES +
  TAB_PROPERTIES +
  NUMBERINGS +
  PARA_PROPERTIES +
  STYLES +
  "</hh:refList>" +
  '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
  '<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>' +
  '<hh:metaTag>{"name":""}</hh:metaTag>' +
  '<hh:trackchageConfig flags="56"/>' +
  "</hh:head>";

/* ─────────────────────────────────────────────────────────────
 * Contents/section0.xml 골격
 * ───────────────────────────────────────────────────────────── */

/** section0.xml 여는 태그까지. 본문 문단은 writer 가 이어 붙인다. */
export const SECTION_OPEN =
  XML_DECL +
  '<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"' +
  ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">';

export const SECTION_CLOSE = "</hs:sec>";

/**
 * 구역 설정 — 반드시 첫 문단의 첫 run 안에 들어간다(OWPML 규칙).
 * A4 세로(59528 × 84186 hwpunit), 여백은 해제본 시험지 값 그대로.
 */
export const SEC_PR =
  '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000"' +
  ' tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0"' +
  ' textVerticalWidthHead="0" masterPageCnt="0">' +
  '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
  '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
  '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0"' +
  ' border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0"' +
  ' showLineNumber="0"/>' +
  '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
  '<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">' +
  '<hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504"' +
  ' top="5668" bottom="4252"/>' +
  "</hp:pagePr>" +
  "<hp:footNotePr>" +
  '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
  '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>' +
  '<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>' +
  '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
  '<hp:placement place="EACH_COLUMN" beneathText="0"/>' +
  "</hp:footNotePr>" +
  "<hp:endNotePr>" +
  '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
  '<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>' +
  '<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>' +
  '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
  '<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>' +
  "</hp:endNotePr>" +
  ["BOTH", "EVEN", "ODD"]
    .map(
      (type) =>
        `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER"` +
        ' headerInside="0" footerInside="0" fillArea="PAPER">' +
        '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>' +
        "</hp:pageBorderFill>",
    )
    .join("") +
  "</hp:secPr>";

/** 단 설정 — secPr 바로 뒤에 같은 run 안에서 따라온다(해제본 구조). */
export const COL_PR_CTRL =
  '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1"' +
  ' sameSz="1" sameGap="0"/></hp:ctrl>';

/**
 * 줄 배치 정보. 한글은 문서를 열 때 다시 계산하지만, 해제본의 모든 문단이
 * 이 요소를 갖고 있어 형태를 맞춘다. horzsize 42520 = 본문 폭(59528 - 좌우 8504).
 */
export const LINE_SEG_ARRAY =
  "<hp:linesegarray>" +
  '<hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000"' +
  ' baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/>' +
  "</hp:linesegarray>";

/* ─────────────────────────────────────────────────────────────
 * 수식 객체 상수 — 해제본 84개 <hp:equation> 실측에서 확정
 * ───────────────────────────────────────────────────────────── */

/** 수식 기준선 비율(%). 해제본 84개가 모두 85. */
export const EQUATION_BASE_LINE = 85;
/** 수식 좌우 바깥 여백(hwpunit). 해제본 84개가 모두 170/170, 상하는 0. */
export const EQUATION_OUT_MARGIN = 170;
/** 수식 편집기 글꼴 — 폭 추정치(estimateEquationSize)가 이 글꼴 메트릭 기준이다. */
export const EQUATION_FONT = "HYhwpEQ";
