"use server";

import { revalidatePath } from "next/cache";
import { capabilityScope } from "@su-maek/core/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  issueLearnerAccounts,
  type BulkIssueResult,
} from "@/lib/domain/learner-account";

/* 일괄 계정 발급 (T5.2 · G-07).
 *
 * `settings` 쓰기를 요구하지 않는다 — 그것을 요구하면 담당 교사가 자기 반
 * 학생에게 로그인을 만들어 줄 수 없다. 대신 작업 단위 권한을 보고, 그
 * 권한이 돌려준 **범위**를 서비스에 그대로 넘긴다. 화면이 범위를 다시
 * 해석하지 않는 것이 요점이다: 목록과 집행이 같은 조건을 쓴다. */

export async function issueAccountsAction(
  _prev: BulkIssueResult | null,
  formData: FormData,
): Promise<BulkIssueResult> {
  const deny = (message: string): BulkIssueResult => ({
    outcomes: [{ learnerId: "", displayName: "", ok: false, message }],
    succeeded: 0,
    failed: 1,
  });

  const user = await getCurrentUser();
  if (!user) return deny("로그인이 필요합니다.");
  const scope = capabilityScope(user.role, "student_account.manage");
  if (scope === "none") return deny("학생 계정을 발급할 권한이 없습니다.");

  /* `email:<learnerId>` 키로 온다 — 비어 있는 칸은 발급 대상이 아니다.
   * 빈 칸을 「이메일 없음」 실패로 보고하면 서른 줄짜리 실패 목록이 나오고,
   * 그 안에서 진짜 실패가 묻힌다. */
  const targets: Array<{ learnerId: string; email: string }> = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("email:")) continue;
    const email = String(raw).trim();
    if (email.length === 0) continue;
    targets.push({ learnerId: key.slice(6), email });
  }
  if (targets.length === 0) return deny("발급할 학생의 이메일을 입력하세요.");

  const result = await issueLearnerAccounts({
    organizationId: user.organizationId,
    actorUserId: user.userId,
    scope,
    targets,
  });
  revalidatePath("/app/students/accounts");
  revalidatePath("/app/setup");
  return result;
}
