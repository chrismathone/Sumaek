import type { Metadata } from "next";
import Link from "next/link";
import type { IsoDate } from "@su-maek/core/shared";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { projectToday } from "@/lib/domain/day-plan";
import { LearnTabs } from "@/components/learn/LearnTabs";
import { HomeworkForm } from "./HomeworkForm";

export const metadata: Metadata = { title: "숙제·교재 범위" };

/* ─────────────────────────────────────────────────────────────
 * 숙제와 교재 범위 (T2.3).
 *
 * 그동안 교사가 이 노드들을 만들어도 학생 화면에는 아무것도 나타나지
 * 않았다 — 교사는 배정했다고 믿고 학생은 그런 것이 있는 줄도 몰랐다.
 *
 * 이 화면은 **오늘 계획**만 읽는다. 노드에서 항목으로 펴는 규칙은
 * 실행기(packages/core)에 있고, 여기서 다시 정하지 않는다.
 *
 * 파일 업로드·자유 서술 제출은 MVP 비범위다. 그 사실을 화면에 적어 둔다 —
 * 적지 않으면 학생은 낼 곳을 찾다가 못 찾고, 교사는 안 냈다고 읽는다.
 * ───────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  book_range: "교재 범위",
  homework: "숙제",
};

export default async function LearnHomeworkPage() {
  const learner = (await getCurrentLearner())!;
  const today = todayInKst() as IsoDate;

  const view = await projectToday({
    learner: {
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
    },
    today,
  });

  const items = view.plan.items.filter(
    (i) => i.kind === "homework" || i.kind === "book_range",
  );

  return (
    <div>
      <LearnTabs current="today" />
      <h1 className="text-xl font-semibold break-keep">오늘의 숙제·교재 범위</h1>

      {items.length === 0 && (
        <section className="mt-4 rounded-lg border border-dashed border-rule bg-paper p-4">
          <p className="font-medium break-keep">오늘은 배정된 숙제가 없습니다.</p>
          <p className="mt-1 text-sm break-keep text-ink-soft">
            선생님이 교재 범위나 숙제를 배정하면 여기에 표시됩니다.
          </p>
          <Link
            href="/learn/today"
            className="mt-3 inline-block text-sm text-pen underline-offset-2 hover:underline"
          >
            오늘 학습으로 돌아가기
          </Link>
        </section>
      )}

      <ul className="mt-4 space-y-3">
        {items.map((item) => {
          const done = item.status === "completed" || item.status === "exempted";
          const blocked = item.status === "blocked";
          return (
            <li
              key={item.key}
              className="rounded-lg border border-rule bg-surface p-4"
            >
              <p className="text-xs text-ink-soft">
                {KIND_LABEL[item.kind ?? ""] ?? "할 일"}
                {item.required ? " · 필수" : " · 선택"}
              </p>
              <p className="mt-1 font-medium break-keep">{item.titleSnapshot}</p>

              {blocked ? (
                <p className="mt-2 text-sm break-keep text-ink-soft">
                  지금 열 수 없습니다 — 선생님께 알려 주세요.
                </p>
              ) : done ? (
                <p className="mt-2 text-sm break-keep text-ink-soft">완료했습니다.</p>
              ) : (
                <HomeworkForm
                  itemKey={item.key}
                  materialId={
                    item.refType === "learning_material" ? (item.refId ?? null) : null
                  }
                />
              )}
            </li>
          );
        })}
      </ul>

      {items.length > 0 && (
        <p className="mt-4 text-xs break-keep text-ink-soft">
          숙제는 교재 범위를 확인했다고 표시하거나 시스템 연습문제를 푸는 방식만
          지원합니다. 사진·파일 제출은 받지 않습니다.
        </p>
      )}
    </div>
  );
}
