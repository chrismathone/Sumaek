import type { Metadata } from "next";
import Link from "next/link";
import { renderMixedText } from "@su-maek/core/math";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInTimeZone } from "@/lib/format";
import { listMaterials } from "@/lib/domain/learning-material";
import { getTodayScope } from "@/lib/learn/today-context";
import { CompleteMaterialButton } from "@/components/learn/MaterialCard";

export const metadata: Metadata = { title: "개념 공부" };

/* 개념 공부 — 오늘 차시의 개념에 붙은 읽기 자료.
 * 자료가 없으면 "없다"고 말한다. 학생이 뭘 잘못한 게 아니라는 것까지 적는다. */

interface ContentRun {
  kind: "text" | "math";
  text?: string;
  math?: { latex: string };
}

function runsToText(runs: ContentRun[]): string {
  return runs
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

function blocksToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return body
    .map((block: { type?: string; text?: string; runs?: ContentRun[] }) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "paragraph") return runsToText(block.runs ?? []);
      return "";
    })
    .join("\n\n");
}

export default async function StudyPage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInTimeZone(learner.user.timezone);
  const scope = await getTodayScope(learner, today);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds: scope.conceptIds,
    kinds: ["reading"],
  });

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">개념 공부</h1>
      <p className="mt-1 text-sm text-ink-soft">
        오늘 배우는 개념의 설명입니다. 다 읽었으면 「다 봤어요」를 눌러 주세요.
      </p>

      {materials.length === 0 ? (
        <div className="mt-4 rounded-lg border border-rule bg-surface p-5">
          <p className="font-medium">
            {!scope.hasSession
              ? "오늘은 수업이 없어 공부할 개념이 없습니다."
              : "오늘 개념에 등록된 설명 자료가 아직 없습니다."}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            {scope.hasSession &&
              "선생님이 자료를 올리면 여기에 표시됩니다. 그동안 연습문제와 테스트는 그대로 할 수 있습니다."}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {materials.map((m) => {
            const rendered = renderMixedText(blocksToText(m.body), "publish");
            return (
              <li key={m.id} className="rounded-lg border border-rule bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-ink-soft">{m.conceptName}</p>
                    <h2 className="mt-0.5 font-medium">{m.title}</h2>
                  </div>
                  <CompleteMaterialButton
                    materialId={m.id}
                    done={m.progress === "completed"}
                  />
                </div>
                {/* AI 고지 — 읽기 자료도 AI가 쓸 수 있다. 본문 위에 둔다:
                    읽고 난 뒤에 알리는 것은 알린 것이 아니다. */}
                {m.disclosure && (
                  <p className="mt-3 rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-3 py-2 text-sm">
                    {m.disclosure}
                  </p>
                )}
                <div
                  className="mt-3 space-y-2 text-[15px] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: rendered.html }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/learn/today"
        className="mt-6 inline-block text-sm text-pen underline underline-offset-4"
      >
        오늘 학습으로 돌아가기
      </Link>
    </div>
  );
}
