import type { Metadata } from "next";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime, label } from "@/lib/format";

export const metadata: Metadata = { title: "감사 로그" };

/* 감사 로그 (23장) — 읽기 전용. 누가·언제·무엇을·왜 했는지만 보여준다.
 * 이 화면에서 로그를 고치거나 지울 수 있는 경로는 없다 (RLS로도 차단). */

const ACTOR_TYPE_LABEL: Record<string, string> = {
  user: "사용자",
  system: "시스템",
  automation: "자동화",
  operator: "운영자(승인 접근)",
};

const ACTION_LABEL: Record<string, string> = {
  "assessment.generate-publish": "테스트 생성·게시",
  "grading.resolve-exception": "채점 예외 판정",
  "schedule.materialize": "일정 생성",
  "schedule.apply-proposal": "일정 변경안 적용",
  "route.publish": "루트 게시",
  "curriculum.release-publish": "교육과정 릴리스 게시",
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  assessment: "평가",
  response: "답안",
  attempt: "응시",
  learning_group: "반",
  learner: "학습자",
  session: "수업",
  route_version: "루트 버전",
  curriculum_release: "교육과정 릴리스",
  question: "문항",
  membership: "멤버십",
};

export default async function AuditPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const events = await sql<
    {
      id: string;
      created_at: Date;
      actor_type: string;
      actor_name: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      reason: string | null;
      rule_version: string | null;
    }[]
  >`
    select e.id, e.created_at, e.actor_type, e.action,
           e.target_type, e.target_id, e.reason, e.rule_version,
           u.display_name as actor_name
    from audit_events e
    left join users u on u.id = e.actor_id
    where e.organization_id = ${user.organizationId}
    order by e.created_at desc
    limit 100
  `;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">감사 로그</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        최근 100건입니다. 감사 기록은 읽기 전용이며 앱에서 수정·삭제할 수
        없습니다. 자동화가 수행한 변경에는 적용된 규칙 버전이 함께 남습니다.
      </p>

      {events.length === 0 ? (
        <div className="mt-6 rounded-lg border border-rule bg-surface p-6 text-center">
          <p className="font-medium">아직 기록된 감사 이벤트가 없습니다.</p>
          <p className="mt-1.5 text-sm text-ink-soft">
            테스트 게시, 채점 판정, 일정 생성처럼 결과를 바꾸는 작업이
            일어나면 여기에 남습니다.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
                <th className="px-4 py-2 font-medium">시각</th>
                <th className="px-4 py-2 font-medium">수행자</th>
                <th className="px-4 py-2 font-medium">작업</th>
                <th className="px-4 py-2 font-medium">대상</th>
                <th className="px-4 py-2 font-medium">사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-soft">
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-ink-soft">
                    {formatDateTime(e.created_at, user.timezone)}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.actor_type === "user" ? (
                      <span>{e.actor_name ?? "삭제된 사용자"}</span>
                    ) : (
                      <span className="text-ink-soft">
                        {label(ACTOR_TYPE_LABEL, e.actor_type)}
                        {e.rule_version && (
                          <span className="ml-1 font-mono text-xs">
                            ({e.rule_version})
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">
                      {ACTION_LABEL[e.action] ?? e.action}
                    </span>
                    {ACTION_LABEL[e.action] && (
                      <span className="ml-2 font-mono text-[11px] text-ink-soft">
                        {e.action}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">
                    {label(TARGET_TYPE_LABEL, e.target_type)}
                    {e.target_id && (
                      <span className="ml-1">{e.target_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
