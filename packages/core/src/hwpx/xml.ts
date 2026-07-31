/**
 * HWPX 조립용 XML 안전 유틸.
 *
 * section0.xml 은 문자열로 조립하므로 이스케이프가 유일한 방어선이다.
 * 문항 본문·수식 스크립트에는 부등호(`<`, `>`), 행렬 구분자(`&`), 텍스트
 * 리터럴 따옴표(`"`)가 일상적으로 들어오므로 빠뜨리면 곧바로 깨진 XML 이 된다.
 */

/**
 * XML 1.0 이 문서에 담을 수 없는 문자.
 * 허용 범위는 #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF].
 *
 * 문자 클래스를 리터럴 정규식이 아니라 이스케이프 문자열로 쓰는 이유: 소스 파일에
 * 실제 제어 문자가 들어가면 편집기·git diff 에서 보이지 않아 되레 사고를 부른다.
 */
const INVALID_XML_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]",
  "g",
);

/**
 * 텍스트·속성값 양쪽에 안전한 이스케이프.
 *
 * 다섯 문자를 모두 바꾸므로 결과 문자열은 요소 내용으로도, 따옴표 안 속성값으로도
 * 그대로 쓸 수 있다. `&` 를 가장 먼저 바꿔야 이중 이스케이프가 나지 않는다.
 *
 * XML 1.0 에서 표현 불가능한 제어 문자는 제거한다 — 남겨두면 한글이 파일 전체를
 * 거부한다. 정상 콘텐츠에는 나타날 수 없는 문자다.
 */
export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
