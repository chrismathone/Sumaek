import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { formatTime, todayInTimeZone, trimScore } from "@/lib/format";
import {
  conceptIdsForNodes,
  listMaterials,
} from "@/lib/domain/learning-material";

export const metadata: Metadata = { title: "오늘 학습" };

/* ─────────────────────────────────────────────────────────────
 * 학생의 하루 (18장) — **순서 있는 단계**로 낸다.
 *
 * 예전에는 「오늘 수업 / 테스트 / 복습」 세 덩어리가 나란히 놓여 있을
 * 뿐이라, 지금 무엇을 할 차례인지·다 끝났는지를 학생이 목록을 훑어
 * 스스로 판단해야 했다. 끝난 테스트가 맨 위를 차지해 할 일이 묻히기도 했다.
 *
 * 그래서 세 가지를 지킨다.
 *   1. 한 번에 **한 단계만** 「할 차례」다. 나머지는 완료이거나 대기다.
 *   2. **끝난 것은 접는다** — 지난 기록은 접힌 채로 아래에 둔다.
 *   3. 다 마치면 **끝났다고 말한다**. 말하지 않으면 학생은 계속 찾는다.
 *
 * 오늘 수업은 개별 일정(learner_schedule_items)을 먼저 보고, 없을 때만
 * 반 공통(sessions)으로 물러선다 — 보충·재합류로 반과 달라진 학생에게
 * 반 공통을 보여 주면 화면이 거짓말을 한다.
 * ───────────────────────────────────────────────────────────── */

interface ScheduleRow {
  starts_at: Date;
  ends_at: Date;
  planned_node_ids: unknown;
  matches_group: boolean | null;
  is_rejoin: boolean | null;
}

function nodeIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

type StepState = "todo" | "done" | "none";

function StepBadge({ state, label }: { state: StepState; label: string }) {
  const style =
    state === "todo"
      ? "border-pen bg-pen text-white"
      : state === "done"
        ? "border-rule bg-paper text-ink-soft"
        : "border-rule bg-paper text-ink-soft";
  return (
    <span
      className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[11px] ${style}`}
    >
      {label}
    </span>
  );
}

/* 자료 기반 단계 (개념 공부·인강·연습문제) — 셋의 구조가 같아 한 곳에 둔다.
 * 자료가 0건이어도 단계를 지우지 않는다: 없다는 사실도 알아야 하고,
 * 선생님이 올리는 순간 같은 자리에 나타나야 학생이 헤매지 않는다. */
function MaterialStep({
  number,
  title,
  href,
  cta,
  state,
  active,
  count,
  emptyText,
}: {
  number: number;
  title: string;
  href: string;
  cta: string;
  state: StepState;
  active: boolean;
  count: number;
  emptyText: string;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink-soft">{number}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <StepBadge
          state={state}
          label={
            state === "todo" ? `할 차례 ${count}건` : state === "done" ? "완료" : "없음"
          }
        />
      </div>
      {state === "none" ? (
        <p className="mt-2 rounded-lg border border-rule bg-surface p-4 text-sm text-ink-soft">
          {emptyText}
        </p>
      ) : (
        <div
          className={`mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4 ${
            active ? "border-pen" : "border-rule"
          }`}
        >
          <p className="text-sm">
            {state === "done" ? `${count}건을 모두 마쳤습니다.` : `${count}건이 있습니다.`}
          </p>
          <Link
            href={href}
            className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium ${
              state === "done"
                ? "border border-rule text-ink"
                : "bg-pen text-white"
            }`}
          >
            {state === "done" ? "다시 보기" : cta}
          </Link>
        </div>
      )}
    </section>
  );
}

export default async function LearnTodayPage() {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();
  const tz = learner.user.timezone;
  const today = todayInTimeZone(tz);

  const [assessments, dueReviews, learnerItems] = await Promise.all([
    sql<
      {
        id: string;
        title: string;
        scheduled_date: string | null;
        time_limit_minutes: number | null;
        question_count: number;
        attempt_id: string | null;
        attempt_status: string | null;
        total_score: string | null;
        max_score: string | null;
      }[]
    >`
      select a.id, a.title, a.scheduled_date::text as scheduled_date,
             a.time_limit_minutes,
             (select count(*)::int from assessment_questions q where q.assessment_id = a.id) as question_count,
             t.id as attempt_id, t.status as attempt_status,
             t.total_score::text, t.max_score::text
      from assignments s
      join assessment_instances a on a.id = s.assessment_id
      left join attempts t on t.assessment_id = a.id and t.learner_id = s.learner_id
      where s.learner_id = ${learner.learnerId}
        and s.status <> 'cancelled'
        and a.status in ('published', 'open', 'closed', 'grading', 'finalized')
      order by a.scheduled_date desc nulls last, a.created_at desc
    `,
    /* 기한이 온 복습만 — 교사 화면(app/students)과 같은 기준(due_on)이다 */
    sql<{ cnt: number }[]>`
      select count(*)::int as cnt from review_items
      where learner_id = ${learner.learnerId} and status = 'scheduled'
        and due_on <= ${today}::date
    `,
    sql<ScheduleRow[]>`
      select li.starts_at, li.ends_at, li.planned_node_ids,
             li.matches_group, li.is_rejoin
      from learner_schedule_items li
      where li.organization_id = ${learner.user.organizationId}
        and li.learner_id = ${learner.learnerId}
        and li.item_date = ${today}::date
      order by li.starts_at
    `,
  ]);

  const groupItems =
    learnerItems.length > 0
      ? []
      : await sql<ScheduleRow[]>`
          select s.starts_at, s.ends_at, s.planned_node_ids,
                 null::boolean as matches_group, null::boolean as is_rejoin
          from sessions s
          join learning_group_memberships m
            on m.learning_group_id = s.learning_group_id
           and m.learner_id = ${learner.learnerId}
           and m.status = 'active'
          where s.organization_id = ${learner.user.organizationId}
            and s.session_date = ${today}::date
            and s.status <> 'cancelled'
          order by s.starts_at
        `;
  const schedule = learnerItems.length > 0 ? learnerItems : groupItems;

  /* 차시 노드 이름 — 반 루트 노드는 route_nodes, 보충 노드는 오버라이드 안 */
  const nodeIds = schedule.flatMap((s) => nodeIdList(s.planned_node_ids));
  const routeNodeIds = nodeIds.filter((n) => !n.startsWith("override:"));
  const nodeTitle = new Map<string, string>();
  if (routeNodeIds.length > 0) {
    const titles = await sql<{ id: string; title: string }[]>`
      select id::text, title from route_nodes where id = any(${routeNodeIds}::uuid[])
    `;
    for (const t of titles) nodeTitle.set(t.id, t.title);
  }
  if (nodeIds.some((n) => n.startsWith("override:"))) {
    const overrides = await sql<{ id: string; delta: unknown }[]>`
      select id::text, delta from student_route_overrides
      where organization_id = ${learner.user.organizationId}
        and learner_id = ${learner.learnerId}
    `;
    for (const o of overrides) {
      const inserted =
        ((o.delta ?? {}) as {
          insertBefore?: { nodes?: Array<{ title?: string }> };
        }).insertBefore?.nodes ?? [];
      inserted.forEach((n, i) =>
        nodeTitle.set(`override:${o.id}:${i}`, n.title ?? "보충"),
      );
    }
  }
  const titleOf = (id: string) =>
    nodeTitle.get(id) ?? (id.startsWith("override:") ? "보충" : "이름 없는 항목");

  /* 오늘 개념의 학습 자료 — 개념 공부·인강·연습문제 단계의 상태를 정한다.
   * 자료가 0건인 종류는 「없음」으로 두고 단계 자체를 없애지는 않는다:
   * 없다는 사실도 학생이 알아야 하고, 자료가 생기면 그 자리에 나타난다. */
  const conceptIds = await conceptIdsForNodes(nodeIds);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds,
  });
  const byKind = (k: "reading" | "video" | "practice") =>
    materials.filter((m) => m.kind === k);
  const materialState = (k: "reading" | "video" | "practice"): StepState => {
    const list = byKind(k);
    if (list.length === 0) return "none";
    return list.every((m) => m.progress === "completed") ? "done" : "todo";
  };
  const readingState = materialState("reading");
  const videoState = materialState("video");
  const practiceState = materialState("practice");

  /* ── 단계 판정 ── */
  const isDone = (s: string | null) =>
    Boolean(s) &&
    ["submitted", "auto_graded", "review_required", "finalized"].includes(s!);

  const openTests = assessments.filter(
    (a) =>
      !isDone(a.attempt_status) &&
      !(a.scheduled_date !== null && a.scheduled_date > today),
  );
  const upcomingTests = assessments.filter(
    (a) =>
      !isDone(a.attempt_status) &&
      a.scheduled_date !== null &&
      a.scheduled_date > today,
  );
  const finishedTests = assessments.filter((a) => isDone(a.attempt_status));
  const reviewCount = dueReviews[0]?.cnt ?? 0;

  const testState: StepState =
    openTests.length > 0 ? "todo" : finishedTests.length > 0 ? "done" : "none";
  const reviewState: StepState = reviewCount > 0 ? "todo" : "none";
  /* 「할 차례」는 한 번에 하나 — 배우는 순서 그대로다.
   * 공부 → 인강 → 연습 → 테스트 → 복습. 앞 단계가 남아 있으면 그것이 먼저다. */
  const activeStep: string | null =
    readingState === "todo"
      ? "reading"
      : videoState === "todo"
        ? "video"
        : practiceState === "todo"
          ? "practice"
          : openTests.length > 0
            ? "test"
            : reviewCount > 0
              ? "review"
              : null;
  const allDone = activeStep === null;

  return (
    <div>
      <h1 className="font-[MaruBuri] text-2xl font-semibold">
        {learner.displayName}님의 오늘 학습
      </h1>

      {allDone && (
        <div className="mt-4 rounded-lg border border-pen bg-pen-soft/40 p-4">
          <p className="font-medium">오늘 할 일을 모두 마쳤습니다.</p>
          <p className="mt-1 text-sm text-ink-soft">
            새 테스트나 복습이 생기면 여기에 다시 표시됩니다.
          </p>
        </div>
      )}

      {/* ── 1단계: 오늘 배울 것 ── */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-ink-soft">1</span>
          <h2 className="text-lg font-semibold">오늘 배울 것</h2>
          <StepBadge
            state={schedule.length > 0 ? "done" : "none"}
            label={schedule.length > 0 ? "확인" : "수업 없음"}
          />
        </div>
        {schedule.length === 0 ? (
          <p className="mt-2 rounded-lg border border-rule bg-surface p-4 text-sm text-ink-soft">
            오늘은 예정된 수업이 없습니다.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {schedule.map((s, i) => {
              const ids = nodeIdList(s.planned_node_ids);
              return (
                <li
                  key={`${s.starts_at.toISOString()}-${i}`}
                  className="rounded-lg border border-rule bg-surface p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="font-mono text-sm">
                      {formatTime(s.starts_at, tz)}–{formatTime(s.ends_at, tz)}
                    </p>
                    {s.matches_group === false && (
                      <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 font-mono text-[11px]">
                        내 진도
                      </span>
                    )}
                    {s.is_rejoin && (
                      <span className="rounded-[var(--radius-control)] border border-pen bg-pen-soft/50 px-1.5 py-0.5 font-mono text-[11px] text-pen">
                        반 진도 합류
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">
                    {ids.length === 0 ? (
                      <span className="text-ink-soft">배정된 학습 내용 없음</span>
                    ) : (
                      ids.map(titleOf).join(" · ")
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 2단계: 개념 공부 ── */}
      <MaterialStep
        number={2}
        title="개념 공부"
        href="/learn/study"
        cta="읽으러 가기"
        state={readingState}
        active={activeStep === "reading"}
        count={byKind("reading").length}
        emptyText="오늘 개념에 등록된 설명 자료가 아직 없습니다."
      />

      {/* ── 3단계: 개념 인강 ── */}
      <MaterialStep
        number={3}
        title="개념 인강"
        href="/learn/watch"
        cta="보러 가기"
        state={videoState}
        active={activeStep === "video"}
        count={byKind("video").length}
        emptyText="오늘 개념에 등록된 강의 영상이 아직 없습니다."
      />

      {/* ── 4단계: 연습문제 ── */}
      <MaterialStep
        number={4}
        title="연습문제"
        href="/learn/practice"
        cta="풀러 가기"
        state={practiceState}
        active={activeStep === "practice"}
        count={byKind("practice").length}
        emptyText="오늘 개념에 등록된 연습문제가 아직 없습니다."
      />

      {/* ── 2단계: 테스트 ── */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-ink-soft">5</span>
          <h2 className="text-lg font-semibold">테스트</h2>
          <StepBadge
            state={testState}
            label={
              testState === "todo"
                ? "할 차례"
                : testState === "done"
                  ? "완료"
                  : "없음"
            }
          />
        </div>

        {openTests.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {openTests.map((a) => (
              <li
                key={a.id}
                className={`rounded-lg border bg-surface p-4 ${
                  activeStep === "test" ? "border-pen" : "border-rule"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-soft">
                      {a.question_count}문항
                      {a.time_limit_minutes && ` · 제한 ${a.time_limit_minutes}분`}
                    </p>
                  </div>
                  <Link
                    href={`/learn/tests/${a.id}`}
                    className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
                  >
                    {a.attempt_status === "in_progress" ? "이어서 풀기" : "응시하기"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg border border-rule bg-surface p-4 text-sm text-ink-soft">
            {finishedTests.length > 0
              ? "오늘 볼 테스트를 마쳤습니다."
              : "배정된 테스트가 없습니다. 선생님이 배정하면 여기에 표시됩니다."}
          </p>
        )}

        {upcomingTests.length > 0 && (
          <ul className="mt-2 space-y-2">
            {upcomingTests.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule-soft bg-paper px-4 py-3"
              >
                <span className="text-sm text-ink-soft">
                  {a.title}
                  <span className="ml-2 font-mono text-xs">
                    {a.question_count}문항
                  </span>
                </span>
                <span className="font-mono text-xs text-ink-soft">
                  {a.scheduled_date}부터
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 3단계: 복습 ── */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-ink-soft">6</span>
          <h2 className="text-lg font-semibold">복습</h2>
          <StepBadge
            state={reviewState}
            label={reviewState === "todo" ? `할 차례 ${reviewCount}건` : "없음"}
          />
        </div>
        {reviewCount > 0 ? (
          <div
            className={`mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4 ${
              activeStep === "review" ? "border-pen" : "border-rule"
            }`}
          >
            <p className="text-sm">
              전에 틀렸던 개념 {reviewCount}건이 기다리고 있습니다. 맞히면
              목록에서 사라집니다.
            </p>
            <Link
              href="/learn/review"
              className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white"
            >
              복습 시작
            </Link>
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-rule bg-surface p-4 text-sm text-ink-soft">
            오늘 할 복습이 없습니다. 틀린 개념은 간격을 두고 여기에 다시 올라옵니다.
          </p>
        )}
      </section>

      {/* ── 지난 기록 — 접어 둔다 ── */}
      {finishedTests.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-ink-soft">
            지난 테스트 {finishedTests.length}건 보기
          </summary>
          <ul className="mt-3 space-y-2">
            {finishedTests.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule-soft bg-paper px-4 py-3"
              >
                <span className="text-sm">
                  {a.title}
                  <span className="ml-2 font-mono text-xs text-ink-soft">
                    {a.question_count}문항
                  </span>
                </span>
                <Link
                  href={`/learn/results/${a.attempt_id}`}
                  className="rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm text-pen"
                >
                  {a.total_score !== null
                    ? `결과 보기 (${trimScore(a.total_score)}/${trimScore(a.max_score)}점)`
                    : "결과 보기"}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
