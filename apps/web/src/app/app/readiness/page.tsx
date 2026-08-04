import type { Metadata } from "next";
import Link from "next/link";
import type { IsoDate } from "@su-maek/core/shared";
import { requireAccess } from "@/lib/auth/require-access";
import { assignedGroupIds, resolveMenuScope } from "@/lib/auth/require-scope";
import { blockReasonText } from "@/lib/domain/day-progress";
import { loadDayReadiness } from "@/lib/domain/readiness-day";
import { todayInKst } from "@/lib/format";
import type { RawSearchParams } from "@/lib/table";

export const metadata: Metadata = { title: "날짜별 준비도" };

/* ─────────────────────────────────────────────────────────────
 * 날짜별 준비도 (T5.4 · G-08).
 *
 * 준비도 게이트(T2.4)는 게시 시점에 돈다. 결손은 그 뒤에도 생긴다 —
 * 자료를 내리거나, 평가 생성이 실패하거나, 계정을 아직 안 만들었거나.
 * 지금까지 교사가 그것을 아는 시점은 학생이 「빈 화면」을 보고 말해 줄
 * 때였고, 그때는 이미 수업 당일이다.
 *
 * 이 화면은 학생이 로그인하기 전에 그날을 미리 본다. 계산은 학생 화면과
 * 같은 투영기를 쓰되 계획을 남기지 않는다 — 남기면 **교사가 미리 본 순간**이
 * 확정 시점이 되고, 그 순간의 자료 상태로 필수 분모가 굳는다.
 * ───────────────────────────────────────────────────────────── */

const CATEGORY_HREF: Record<string, string> = {
  material: "/app/content/materials",
  question: "/app/content/questions",
  assessment: "/app/tests",
  account: "/app/students/accounts",
  rights: "/app/content/books",
};

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAccess("today");
  const params = await searchParams;
  const raw = String(params.date ?? "");
  const date = (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayInKst()) as IsoDate;

  /* 담당 밖 반은 미리보기에도 나오지 않는다 (T5.3) — 목록과 집행이 같은
   * 정의를 쓴다. */
  const scope = resolveMenuScope(user.role, "today");
  const allowed =
    scope === "assigned"
      ? await assignedGroupIds(user.organizationId, user.userId)
      : null;

  const groups =
    scope === "none"
      ? []
      : await loadDayReadiness({
          organizationId: user.organizationId,
          date,
          allowedGroupIds: allowed,
        });

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        날짜별 준비도
      </h1>
      <p className="mt-1.5 text-sm break-keep text-ink-soft">
        학생이 로그인하기 전에 그날 화면을 미리 봅니다. 이 화면은{" "}
        <strong>아무것도 만들지 않습니다</strong> — 계획은 학생이 오늘 학습을
        처음 열 때 확정됩니다.
      </p>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="date" className="text-sm">
          날짜
        </label>
        <input
          id="date"
          type="date"
          name="date"
          defaultValue={date}
          className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-sm font-medium"
        >
          보기
        </button>
      </form>

      {groups.length === 0 ? (
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
          담당 반에 등록된 학생이 없습니다.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {groups.map((g) => (
            <li
              key={g.learningGroupId}
              className="rounded-lg border border-rule bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link
                  href={`/app/classes/${g.learningGroupId}`}
                  className="font-medium break-keep underline underline-offset-4"
                >
                  {g.learningGroupName}
                </Link>
                <span className="font-mono text-xs text-ink-soft">
                  준비됨 {g.summary.ready} / {g.summary.total}
                </span>
              </div>

              {g.summary.blockers.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {g.summary.blockers.map((b) => (
                    <li key={b.code} className="text-sm break-keep">
                      <span className="font-mono text-xs text-grade">
                        {b.learners}명
                      </span>{" "}
                      {blockReasonText(b.code)}
                      {CATEGORY_HREF[b.category] && (
                        <>
                          {" "}
                          <Link
                            href={CATEGORY_HREF[b.category]!}
                            className="text-pen underline underline-offset-4"
                          >
                            고치러 가기
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {g.summary.attention.length === 0 ? (
                <p className="mt-2 text-sm break-keep text-ink-soft">
                  이 반은 그날 학습을 시작할 수 있습니다.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-rule-soft border-t border-rule-soft">
                  {g.summary.attention.map((r) => (
                    <li
                      key={r.learnerId}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                    >
                      <Link
                        href={`/app/students/${r.learnerId}`}
                        className="text-sm break-keep underline underline-offset-4"
                      >
                        {r.displayName}
                      </Link>
                      <span className="font-mono text-xs text-ink-soft">
                        필수 {r.requiredSatisfied}/{r.requiredTotal}
                      </span>
                      <span className="text-sm break-keep text-grade">
                        {r.blockers.map((b) => blockReasonText(b.code)).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
