import { hasTallMath, renderMixedText } from "@su-maek/core/math";

/* ─────────────────────────────────────────────────────────────
 * 시험지 인쇄 템플릿 — 게시 스냅샷 데이터를 받아 A4 2단으로 조판.
 * 수식 렌더는 단일 렌더 계약(renderMixedText publish 모드) — 실패 수식이
 * 있으면 이 컴포넌트를 호출하기 전에 게이트가 차단해야 한다.
 * dangerouslySetInnerHTML은 KaTeX 결과 + 이스케이프된 텍스트에만 사용 (2P).
 * ───────────────────────────────────────────────────────────── */

export interface ExamPaperChoice {
  choiceId: string;
  order: number;
  text: string;
}

export interface ExamPaperQuestion {
  number: number;
  body: string; // 혼합 텍스트 (한글 + $수식$)
  points?: number;
  choices?: ExamPaperChoice[];
  kind: "multiple_choice" | "short_answer" | "essay" | "multi_blank";
}

export interface ExamPaperProps {
  organizationName: string;
  title: string;
  subtitle?: string;
  timeLimitMinutes?: number;
  questions: ExamPaperQuestion[];
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"] as const;

/** 게시 모드 렌더 — 실패가 있으면 예외 (게이트 위반은 조용히 넘기지 않는다) */
function publishHtml(text: string): string {
  const { html, failures } = renderMixedText(text, "publish");
  if (failures.length > 0) {
    throw new Error(
      `수식 게이트 위반 — 게시 불가 수식 ${failures.length}건: ${failures[0]}`,
    );
  }
  return html;
}

function choiceColumns(choices: ExamPaperChoice[]): 1 | 2 | 5 {
  // 단일 규칙 (#9·#14 공유): 다행·키 큰 수식이 있으면 세로 1열
  if (choices.some((c) => hasTallMath(c.text))) return 1;
  const maxLen = Math.max(...choices.map((c) => c.text.length));
  if (maxLen > 25) return 1;
  if (maxLen > 8) return 2;
  return 5;
}

export function ExamPaper({
  organizationName,
  title,
  subtitle,
  timeLimitMinutes,
  questions,
}: ExamPaperProps) {
  return (
    <div className="exam-sheet">
      <header className="exam-header">
        <div className="exam-meta">
          <span>{organizationName}</span>
          {timeLimitMinutes !== undefined && (
            <span>제한 시간 {timeLimitMinutes}분</span>
          )}
        </div>
        <h1>{title}</h1>
        {subtitle && (
          <p style={{ textAlign: "center", fontSize: "9.5pt", color: "#444" }}>
            {subtitle}
          </p>
        )}
        <div className="name-line">
          <span>반: ____________</span>
          <span>이름: ____________</span>
        </div>
      </header>

      <main className="exam-body">
        {questions.map((q) => (
          <section key={q.number} className="exam-question">
            <div className="q-head">
              <span className="q-number">{q.number}.</span>
              <div>
                <span
                  // KaTeX 출력 + 이스케이프된 본문만 — 외부 HTML 주입 없음
                  dangerouslySetInnerHTML={{ __html: publishHtml(q.body) }}
                />
                {q.points !== undefined && (
                  <span className="q-points"> [{q.points}점]</span>
                )}
              </div>
            </div>

            {q.choices && q.choices.length > 0 && (
              <div className={`choice-grid cols-${choiceColumns(q.choices)}`}>
                {[...q.choices]
                  .sort((a, b) => a.order - b.order)
                  .map((choice, i) => (
                    <div key={choice.choiceId} className="choice-item">
                      <span className="choice-marker">{CIRCLED[i]}</span>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: publishHtml(choice.text),
                        }}
                      />
                    </div>
                  ))}
              </div>
            )}

            {q.kind === "short_answer" && (
              <p style={{ marginTop: "2.5mm" }}>
                답: <span className="answer-blank-line" />
              </p>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
