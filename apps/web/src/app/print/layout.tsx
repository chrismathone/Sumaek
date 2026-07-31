import "katex/dist/katex.min.css";
import "./print.css";

/**
 * 인쇄 전용 레이아웃 — 앱 크롬 없음.
 * PDF 출력 워커(Playwright)가 이 경로를 A4로 인쇄한다 (2P PDF·인쇄).
 * 웹 폰트·KaTeX 자산 로드 완료 후 캡처하도록 워커가 networkidle을 대기한다.
 */
export default function PrintLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="print-root">{children}</div>;
}
