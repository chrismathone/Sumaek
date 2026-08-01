import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { firstAccessibleHref } from "@/lib/nav";

/* /app 진입 — 역할이 열 수 있는 첫 화면으로 보낸다.
 * /app/today로 고정하면 그 메뉴가 none인 역할이 곧바로 거부 화면으로 튄다. */
export default async function AppIndex() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/today");
  if (user.role === "student") redirect("/learn/today");
  redirect(firstAccessibleHref(user.role) ?? "/app/no-access");
}
