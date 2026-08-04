import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  buildSetupProgress,
  loadSetupFacts,
  type SetupStep,
} from "@/lib/domain/setup-progress";

export const metadata: Metadata = { title: "설정 시작하기" };

/* ─────────────────────────────────────────────────────────────
 * 단계형 온보딩 (T5.1 · G-07).
 *
 * 새 학원이 로그인하면 빈 화면 열두 개를 만난다. 이 화면은 그중 **지금 할
 * 하나**만 크게 보이고 나머지는 한 줄로 접힌다 — 학생의 오늘 화면과 같은
 * 문법이다(OrbitRail). 두 화면이 같은 규칙으로 접히면 사용자가 한 번 배운
 * 읽는 법을 그대로 쓴다.
 *
 * 진행률을 저장하지 않는다. 전부 서버 상태에서 파생하므로 새로고침·
 * 로그아웃·다른 기기 어디서든 같은 자리로 돌아온다 — 「중단 후 재개」를
 * 위해 따로 만들 것이 없다는 뜻이다.
 * ───────────────────────────────────────────────────────────── */

function StepRow({ step, active }: { step: SetupStep; active: boolean }) {
  if (active) {
    return (
      <li className="overflow-hidden rounded-lg border border-l-4 border-pen bg-surface">
        <p className="bg-pen px-4 py-1.5 font-mono text-[11px] text-white">
          지금 할 차례
        </p>
        <div className="p-4">
          <h2 className="text-lg font-semibold break-keep">{step.title}</h2>
          <p className="mt-1 text-sm break-keep text-ink-soft">{step.detail}</p>
          <Link
            href={step.href}
            className="mt-3 block w-full rounded-[var(--radius-control)] bg-pen px-5 py-2.5 text-center text-sm font-medium text-white sm:inline-block sm:w-auto"
          >
            하러 가기
          </Link>
        </div>
      </li>
    );
  }

  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden className="font-mono text-xs text-ink-soft">
          {step.done ? "✓" : step.blockedBy ? "·" : "○"}
        </span>
        <span
          className={`text-sm font-medium break-keep ${
            step.done ? "text-ink-soft" : ""
          }`}
        >
          {step.title}
        </span>
        <span className="font-mono text-xs text-ink-soft">{step.detail}</span>
        {/* 앞이 안 끝난 단계는 링크를 주지 않는다 — 눌러서 「먼저 …하세요」를
            만나는 것보다 애초에 못 누르는 편이 낫다. */}
        {!step.done && step.blockedBy === null && (
          <Link
            href={step.href}
            className="ml-auto shrink-0 text-sm text-pen underline underline-offset-4"
          >
            하러 가기
          </Link>
        )}
      </div>
    </li>
  );
}

export default async function SetupPage() {
  const user = await requireAccess("today");
  const progress = buildSetupProgress(await loadSetupFacts(user.organizationId));

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        설정 시작하기
      </h1>
      <p className="mt-1.5 font-mono text-xs text-ink-soft">
        {progress.doneCount} / {progress.steps.length} 단계 ·{" "}
        {progress.complete ? "설정을 마쳤습니다" : (progress.next?.title ?? "—")}
      </p>

      {progress.complete ? (
        <section className="mt-4 rounded-lg bg-ink p-4 text-white">
          <p className="font-medium break-keep">
            학생이 오늘 학습을 시작할 수 있습니다.
          </p>
          <p className="mt-1 text-sm break-keep text-wash">
            이후 운영은 <Link href="/app/today" className="underline">오늘 수업</Link>에서
            봅니다.
          </p>
        </section>
      ) : (
        <p className="mt-3 text-sm break-keep text-ink-soft">
          아래 순서대로 하면 됩니다. 진행 상태는 <strong>서버에서 계산</strong>하므로
          중간에 나갔다 돌아와도 같은 자리에서 이어집니다.
        </p>
      )}

      <ol className="mt-5 space-y-2" aria-label="설정 단계">
        {progress.steps.map((s) => (
          <li key={s.id} className="list-none">
            <ul className="divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
              <StepRow step={s} active={progress.next?.id === s.id} />
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
