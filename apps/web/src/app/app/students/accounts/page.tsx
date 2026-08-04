import type { Metadata } from "next";
import { capabilityScope } from "@su-maek/core/authz";
import { requireAccess } from "@/lib/auth/require-access";
import { listManageableLearners } from "@/lib/domain/learner-account";
import { AccountsForm } from "./AccountsForm";

export const metadata: Metadata = { title: "학생 계정" };

/* 학생 로그인 계정 (T5.2 · G-07).
 *
 * 읽기 게이트는 `learners` 메뉴다. 그 안에서 계정을 만들 수 있는지는 작업
 * 단위 권한이 따로 정한다 — `settings`를 요구하면 담당 교사가 자기 반
 * 학생에게 로그인을 만들어 줄 수 없다. */
export default async function StudentAccountsPage() {
  const user = await requireAccess("learners");
  const scope = capabilityScope(user.role, "student_account.manage");
  const learners =
    scope === "none"
      ? []
      : await listManageableLearners({
          organizationId: user.organizationId,
          actorUserId: user.userId,
          scope,
        });

  const missing = learners.filter((l) => !l.hasAccount).length;

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        학생 로그인 계정
      </h1>
      <p className="mt-1.5 font-mono text-xs text-ink-soft">
        {scope === "assigned" ? "담당 반" : "학원 전체"} · 학생 {learners.length}명 ·
        미발급 {missing}명
      </p>

      {scope === "none" ? (
        <p className="mt-4 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
          학생 계정을 발급할 권한이 없습니다.
        </p>
      ) : (
        <AccountsForm learners={learners} />
      )}
    </div>
  );
}
