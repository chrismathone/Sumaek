import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  GRADING_EXCEPTION_KIND_LABEL,
  NOTIFICATION_KIND_LABEL,
  PROPOSAL_TRIGGER_LABEL,
  formatDateTime,
  label,
} from "@/lib/format";

export const metadata: Metadata = { title: "알림·업무함" };

/* 알림·업무함 (22장) — 알림은 "무슨 일이·왜·영향 대상·권장 행동·기한"을
 * 담는다. 알림 저장이 비어 있어도, 실제로 처리해야 할 미해결 채점 예외와
 * 승인 대기 일정 변경안은 원본 테이블에서 직접 읽어 함께 보여준다.
 * (알림 파이프라인 장애 시에도 업무함은 유지되어야 한다.) */

const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  unread: "안 읽음",
  read: "읽음",
  in_progress: "처리 중",
  done: "완료",
  snoozed: "미룸",
};

const BODY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "what", label: "무슨 일" },
  { key: "why", label: "이유" },
  { key: "impact", label: "영향 대상" },
  { key: "action", label: "권장 행동" },
  { key: "deadline", label: "기한" },
];

export default async function InboxPage() {
  const user = (await getCurrentUser())!;
  const sql = getSharedSql();

  const [notifications, exceptions, proposals] = await Promise.all([
    sql<
      {
        id: string;
        kind: string;
        title: string;
        body: unknown;
        link_path: string | null;
        status: string;
        due_at: Date | null;
        created_at: Date;
      }[]
    >`
      select n.id, n.kind, n.title, n.body, n.link_path, n.status, n.due_at, n.created_at
      from notifications n
      where n.organization_id = ${user.organizationId}
        and n.recipient_user_id = ${user.userId}
        and n.status <> 'done'
      order by n.due_at asc nulls last, n.created_at desc
      limit 50
    `,
    sql<
      {
        id: string;
        kind: string;
        status: string;
        created_at: Date;
        due_at: Date | null;
        learner_name: string;
        assessment_title: string;
      }[]
    >`
      select ge.id, ge.kind, ge.status, ge.created_at, ge.due_at,
             l.display_name as learner_name,
             a.title as assessment_title
      from grading_exceptions ge
      join attempts t on t.id = ge.attempt_id
      join learners l on l.id = t.learner_id
      join assessment_instances a on a.id = t.assessment_id
      where ge.organization_id = ${user.organizationId}
        and ge.status <> 'resolved'
      order by ge.created_at asc
      limit 20
    `,
    sql<
      {
        id: string;
        scope_type: string;
        scope_name: string | null;
        trigger_type: string;
        created_at: Date;
        engine_version: string;
      }[]
    >`
      select p.id, p.scope_type, p.trigger_type, p.created_at, p.engine_version,
             coalesce(g.name, l.display_name) as scope_name
      from schedule_change_proposals p
      left join learning_groups g
        on p.scope_type = 'learning_group'
       and g.id = p.scope_id
       and g.organization_id = ${user.organizationId}
      left join learners l
        on p.scope_type = 'learner'
       and l.id = p.scope_id
       and l.organization_id = ${user.organizationId}
      where p.organization_id = ${user.organizationId}
        and p.status = 'proposed'
      order by p.created_at asc
      limit 20
    `,
  ]);

  const taskCount = exceptions.length + proposals.length;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-[MaruBuri] text-2xl font-semibold">알림·업무함</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {user.displayName}님에게 온 알림 {notifications.length}건 · 오늘 처리할
        일 {taskCount}건
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">오늘 처리할 일</h2>
        {taskCount === 0 ? (
          <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
            미해결 채점 예외와 승인 대기 일정 변경안이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {exceptions.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-rule bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      채점 예외 — {e.learner_name} · {e.assessment_title}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {label(GRADING_EXCEPTION_KIND_LABEL, e.kind)}. 자동 채점이
                      확정하지 않은 답안이므로 사람이 판정해야 점수·숙련도·복습이
                      갱신됩니다.
                    </p>
                    <p className="mt-1 font-mono text-xs text-ink-soft">
                      접수 {formatDateTime(e.created_at, user.timezone)}
                      {e.due_at &&
                        ` · 기한 ${formatDateTime(e.due_at, user.timezone)}`}
                    </p>
                  </div>
                  <Link
                    href="/app/grading"
                    className="shrink-0 rounded-[var(--radius-control)] bg-pen px-3 py-1.5 text-sm font-medium text-white"
                  >
                    판정하기
                  </Link>
                </div>
              </li>
            ))}
            {proposals.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-highlight bg-highlight-soft p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      일정 변경안 승인 대기 —{" "}
                      {p.scope_name ??
                        (p.scope_type === "learner" ? "학습자" : "반")}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      원인: {label(PROPOSAL_TRIGGER_LABEL, p.trigger_type)}. 승인
                      전에는 일정이 바뀌지 않으며, 완료된 과거와 잠긴 수업은
                      변경 대상이 아닙니다.
                    </p>
                    <p className="mt-1 font-mono text-xs text-ink-soft">
                      계산 {formatDateTime(p.created_at, user.timezone)} · 엔진{" "}
                      {p.engine_version}
                    </p>
                  </div>
                  <Link
                    href="/app/calendar"
                    className="shrink-0 rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm font-medium text-pen"
                  >
                    캘린더에서 확인
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">알림</h2>
        {notifications.length === 0 ? (
          <div className="mt-3 rounded-lg border border-rule bg-surface p-6 text-center">
            <p className="font-medium">받은 알림이 없습니다.</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              테스트 생성 실패, 일정 충돌, 콘텐츠 검수 요청처럼 사람이 결정해야
              하는 일이 생기면 여기로 옵니다.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {notifications.map((n) => {
              const lines = bodyLines(n.body);
              return (
                <li
                  key={n.id}
                  className={`rounded-lg border bg-surface p-4 ${
                    n.status === "unread" ? "border-pen" : "border-rule"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{n.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink-soft">
                        {label(NOTIFICATION_KIND_LABEL, n.kind)} ·{" "}
                        {NOTIFICATION_STATUS_LABEL[n.status] ?? n.status} ·{" "}
                        {formatDateTime(n.created_at, user.timezone)}
                        {n.due_at &&
                          ` · 기한 ${formatDateTime(n.due_at, user.timezone)}`}
                      </p>
                      {lines.length > 0 && (
                        <dl className="mt-2 space-y-1 text-sm">
                          {lines.map((line) => (
                            <div key={line.label} className="flex gap-2">
                              <dt className="shrink-0 text-xs text-ink-soft">
                                {line.label}
                              </dt>
                              <dd>{line.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    {n.link_path && (
                      <Link
                        href={n.link_path}
                        className="shrink-0 rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm font-medium text-pen"
                      >
                        바로 가기
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 알림 body(jsonb)의 알려진 필드만 표시한다 — 없는 항목을 지어내지 않는다 */
function bodyLines(body: unknown): Array<{ label: string; value: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const lines: Array<{ label: string; value: string }> = [];
  for (const field of BODY_FIELDS) {
    const value = record[field.key];
    if (typeof value === "string" && value.trim() !== "") {
      lines.push({ label: field.label, value });
    } else if (typeof value === "number") {
      lines.push({ label: field.label, value: String(value) });
    }
  }
  return lines;
}
