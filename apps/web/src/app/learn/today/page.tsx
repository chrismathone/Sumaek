import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { formatIsoDay, formatTime, todayInKst } from "@/lib/format";
import {
  conceptIdsForNodes,
  listMaterials,
  type MaterialRow,
} from "@/lib/domain/learning-material";
import { listDueReviewConcepts } from "@/lib/domain/review";
import { projectToday } from "@/lib/domain/day-plan";
import { studentBlockText } from "@/lib/domain/learning-readiness";
import {
  badgeLabel,
  conceptSpan,
  orbitOf,
  planToDayInput,
  readDay,
  solidBelow,
  type StepState,
} from "@/lib/learn/today-steps";
import { nodeIdList, nodeTitleMap, titleOf } from "@/lib/learn/node-titles";
import { LearnTabs } from "@/components/learn/LearnTabs";
import { OrbitStop, StepBadge } from "./OrbitRail";

/** 「응시가 끝났다」의 정의. SQL 필터와 화면 분류가 **같은 목록**을 봐야 한다 —
 *  갈리면 질의는 오래된 것을 지우는데 화면은 안 끝났다고 세는 상태가 된다. */
const DONE_ATTEMPT_STATUSES = [
  "submitted",
  "auto_graded",
  "review_required",
  "finalized",
];

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
 * 여섯 단계를 같은 크기의 상자 여섯 개로 늘어놓던 것이 이 세 가지를
 * 말로만 지키게 만들었다 — 「할 차례」 표시가 테두리 색 하나뿐이라
 * 나머지 다섯과 무게가 같았고, 상자들은 하나같이 「몇 건이 있습니다」만
 * 말했다. 정작 학생이 알아야 할 개념명·자료 제목·건별 진도는 이미
 * 메모리에 실려 와 있는데 kind와 progress만 쓰고 버려졌다(그래서 이
 * 화면은 「할 차례 3건」, /learn/study는 「3건 중 2건」이라 서로 다른
 * 사실을 말했다).
 *
 * 지금은 **크기 자체가 정보다.** 할 차례 한 단계만 실제 자료 제목을 담은
 * 카드로 펼치고 나머지 다섯은 한 줄로 접되, 여섯을 하나의 세로 궤도
 * 레일로 꿴다 (OrbitRail.tsx).
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

type StopKey = "session" | "reading" | "video" | "practice" | "test" | "review";

interface Stop {
  key: StopKey;
  no: number;
  title: string;
  state: StepState;
  badge: string;
  /** 「없음」일 때의 이유 — 접혀도 지우지 않는다 */
  empty: string;
  href?: string;
  /** 할 차례이지만 활성이 아닐 때의 링크 라벨 */
  cta?: string;
  /** 완료한 뒤의 링크 라벨 */
  again?: string;
}

/* 히어로 카드 껍데기 — 화면에서 유일하게 큰 것.
 *
 * 상단 pen 캡션 바 때문에 이 카드만 실루엣이 다르다. 「여섯 중 하나」가
 * 아니라 「오늘의 한 가지」임을 색이 아니라 **형태**로 말한다. 좌측 굵은
 * 선은 개념 공부 화면의 핵심 정리 블록과 같은 어휘라, 학생이 이미
 * 배운 문법이다.
 *
 * MaruBuri를 쓰지 않는다 — 이 페이지의 MaruBuri는 h1 한 곳뿐이다.
 * 위계는 text-lg/semibold(히어로) 대 text-sm/medium(접힌 줄) + 캡션 바 +
 * 카드 부피가 만든다. */
function Hero({
  no,
  eyebrow,
  title,
  children,
}: {
  no: number;
  eyebrow: string | null;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-l-4 border-pen bg-surface">
      <p className="bg-pen px-4 py-1.5 font-mono text-[11px] text-white">
        지금 할 차례 · {no}단계
      </p>
      <div className="p-4">
        {eyebrow && (
          <p className="font-mono text-xs break-keep text-ink-soft">{eyebrow}</p>
        )}
        <h2 className="mt-0.5 text-lg font-semibold break-keep">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function HeroButton({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="mt-3 block w-full rounded-[var(--radius-control)] bg-pen px-5 py-2.5 text-center text-sm font-medium text-white sm:inline-block sm:w-auto"
    >
      {children}
    </Link>
  );
}

/* 자료 단계(개념 공부·인강·연습문제)의 히어로.
 *
 * 「3건이 있습니다」가 아니라 **실제 제목**을 낸다 — 하위 화면은 전부
 * 「무엇을」을 보여 주는데 이 화면만 「몇 건」이라 추상화가 한 칸 높았다.
 * 완료한 자료는 싣지 않는다(건수는 메타 줄이 말한다) — 히어로는 「지금
 * 할 것」의 자리다. */
function MaterialHero({
  no,
  title,
  href,
  cta,
  resumeCta,
  all,
  meta,
}: {
  no: number;
  title: string;
  href: string;
  cta: string;
  /** 손댄 자료가 있을 때의 문구 — 하위 화면이 이어 주는 사실을 말로도 낸다 */
  resumeCta: string;
  all: MaterialRow[];
  meta: string | null;
}) {
  const rest = all.filter((m) => m.progress !== "completed");
  const shown = rest.slice(0, 3);
  const more = rest.length - shown.length;
  const done = all.length - rest.length;
  /* 「읽으러 가기」와 「이어서 읽기」는 다른 말이다. 하위 화면은 첫 미완료
   * 자료로 이어 주는데(study의 firstUnread) 문구가 그 사실을 숨기면, 다섯
   * 건을 읽고 돌아온 학생은 처음부터 다시 찾아야 하는 줄 안다. 완료뿐 아니라
   * 「보던 중」도 손댄 것으로 센다. */
  const started = all.some((m) => m.progress !== "none");
  return (
    <Hero no={no} eyebrow={conceptSpan(rest.map((m) => m.conceptName))} title={title}>
      <ul className="mt-3 space-y-1.5 border-t border-rule-soft pt-3">
        {shown.map((m) => (
          <li key={m.id} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden className="font-mono text-xs text-ink-soft">
              {m.progress === "in_progress" ? "▸" : "·"}
            </span>
            <span className="min-w-0 flex-1 break-keep">{m.title}</span>
            {/* in_progress를 none과 같이 취급하지 않는다 — 반쯤 읽은 자료를
                손도 안 댄 것으로 되돌리면 학생이 한 일을 지우는 셈이다. */}
            {m.progress === "in_progress" && (
              <span className="shrink-0 font-mono text-[11px] text-pen">
                보던 중
              </span>
            )}
          </li>
        ))}
        {more > 0 && (
          <li className="font-mono text-[11px] text-ink-soft">외 {more}건</li>
        )}
      </ul>
      <p className="mt-3 font-mono text-xs break-keep text-ink-soft">
        자료 {all.length}건 중 {done}건 완료
        {meta && ` · ${meta}`}
      </p>
      <HeroButton href={href}>{started ? resumeCta : cta}</HeroButton>
    </Hero>
  );
}

export default async function LearnTodayPage() {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();
  const today = todayInKst();

  /* 오늘의 계획은 투영기가 만든다 (lib/domain/day-plan.ts).
   *
   * 예전에는 이 화면이 배정을 직접 훑으면서 `scheduled_date >= today - 90`
   * 으로 최근 90일을 통째로 긁어 왔다. 두 달 전에 끝낸 테스트가 「끝남」으로
   * 목록에 앉으면, 오늘 할 일이 하나도 없는 날에도 화면이 완주한 것처럼
   * 보인다. 날짜 규칙을 화면에 두는 한 그 규칙은 화면마다 갈린다 —
   * 그래서 규칙과 질의를 통째로 투영기로 옮겼다.
   *
   * 투영기는 계산만 하는 것이 아니라 learner_day_plans에 **확정**까지 한다.
   * 학생이 그날 처음 이 화면을 여는 순간이 스냅샷 시점이다 (ADR-0017 §4). */
  const view = await projectToday({
    learner: {
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
    },
    today,
  });
  const assessments = view.assignments;

  const [dueConcepts, learnerItems] = await Promise.all([
    /* 기한이 온 복습 — 교사 화면(app/students)과 같은 기준(due_on)이다.
     * 개념별로 묶어서 받는다: 히어로가 「몇 건」이 아니라 **무엇을** 복습할지
     * 말해야 하고, 총건수·기한 지난 수는 이 묶음을 더하면 나온다. */
    listDueReviewConcepts({
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
      today,
    }),
    /* 차시의 시각·재합류 표시는 계획 항목에 없다 — 화면 전용 값이라
     * 여기서만 읽는다. 어느 쪽(개별/반 공통)을 읽을지는 투영기가 이미
     * 정했으므로 그 판단(view.source)을 그대로 따른다. */
    view.source === "learner_schedule"
      ? sql<ScheduleRow[]>`
          select li.starts_at, li.ends_at, li.planned_node_ids,
                 li.matches_group, li.is_rejoin
          from learner_schedule_items li
          where li.organization_id = ${learner.user.organizationId}
            and li.learner_id = ${learner.learnerId}
            and li.item_date = ${today}::date
          order by li.starts_at
        `
      : sql<ScheduleRow[]>`
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
        `,
  ]);
  const schedule = learnerItems;


  /* 차시 노드 이름 — 지난 기록의 하루 상세와 **같은 규칙**을 써야 해서
   * lib/learn/node-titles.ts에 있다. 두 화면이 각자 풀면 보충 차시 이름이
   * 한쪽에서만 뭉개지는 식으로 갈린다. */
  const nodeIds = view.scope.nodeIds;
  const nodeTitle = await nodeTitleMap({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    nodeIds,
  });

  /* 오늘 개념의 학습 자료 — 개념 공부·인강·연습문제 단계의 상태를 정한다.
   * 자료가 0건인 종류는 「없음」으로 두고 단계 자체를 없애지는 않는다:
   * 없다는 사실도 학생이 알아야 하고, 자료가 생기면 그 자리에 나타난다. */
  const conceptIds = await conceptIdsForNodes(nodeIds);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds,
  });
  const byKind = (k: MaterialRow["kind"]) => materials.filter((m) => m.kind === k);
  /* 총건수가 아니라 **남은 건수**를 센다. 3건 중 2건을 읽은 학생에게
   * 「할 차례 3건」이라 말하면 /learn/study의 「3건 중 2건을 읽었습니다」와
   * 사실이 갈린다 — 같은 데이터로 두 화면이 다른 말을 하게 된다. */
  const undone = (k: MaterialRow["kind"]) =>
    byKind(k).filter((m) => m.progress !== "completed");
  const materialState = (k: MaterialRow["kind"]): StepState => {
    const list = byKind(k);
    if (list.length === 0) return "none";
    return undone(k).length === 0 ? "done" : "todo";
  };
  const readingState = materialState("reading");
  const videoState = materialState("video");
  const practiceState = materialState("practice");

  /* 남은 영상 길이 — 하나라도 값이 없으면 아무 말도 하지 않는다.
   * 일부만 더한 합계는 「약 5분」이라 말하면서 실제로는 20분일 수 있다. */
  const restVideo = undone("video");
  const videoMeta =
    restVideo.length > 0 && restVideo.every((m) => m.videoSeconds !== null)
      ? `남은 영상 약 ${Math.round(
          restVideo.reduce((a, m) => a + (m.videoSeconds ?? 0), 0) / 60,
        )}분`
      : null;

  /* 연습 문항 수 — 지정이 비면 개념에서 자동으로 골라 오므로 0은
   * 「문항 없음」이 아니라 「지정 없음」이다. 0이면 아무 수치도 적지 않는다. */
  const practiceQ = undone("practice").reduce(
    (a, m) => a + m.questionIds.length,
    0,
  );
  const practiceMeta =
    practiceQ > 0 ? `${practiceQ}문항 · 점수로 남지 않습니다` : "점수로 남지 않습니다";

  /* ── 단계 판정 ── */
  const isDone = (s: string | null) =>
    Boolean(s) && DONE_ATTEMPT_STATUSES.includes(s!);

  const openTests = assessments.filter(
    (a) =>
      !isDone(a.attempt_status) &&
      !(a.scheduled_date !== null && a.scheduled_date > today),
  );
  /* 예정 테스트는 **가까운 것부터** 낸다. 질의는 목록 전체를 최신순
   * (scheduled_date desc)으로 주므로 그대로 쓰면 「8월 12일부터」가 「8월
   * 5일부터」보다 위에 온다 — 아직 오지 않은 것을 먼 것부터 늘어놓는 셈이다. */
  const upcomingTests = assessments
    .filter(
      (a) =>
        !isDone(a.attempt_status) &&
        a.scheduled_date !== null &&
        a.scheduled_date > today,
    )
    .sort((x, y) => x.scheduled_date!.localeCompare(y.scheduled_date!));
  /** 다음 테스트가 열리는 날 — 정렬이 오름차순이므로 맨 앞이 가장 가깝다 */
  const nextTestDay = upcomingTests[0]?.scheduled_date ?? null;
  const finishedTests = assessments.filter((a) => isDone(a.attempt_status));
  const reviewCount = dueConcepts.reduce((a, c) => a + c.count, 0);
  const overdueCount = dueConcepts.reduce((a, c) => a + c.overdueCount, 0);
  /* 자료 히어로와 같은 셈법(앞 3개 + 「외 N개」) — 두 히어로가 같은 규칙으로
   * 접혀야 학생이 한 번 배운 읽는 법을 그대로 쓴다. */
  const shownConcepts = dueConcepts.slice(0, 3);
  const moreConcepts = dueConcepts.length - shownConcepts.length;

  /* 예정 테스트를 상태에 넣지 않던 것이 화면을 두 줄 사이에서 모순시켰다:
   * 열린 것도 끝난 것도 없으면 `none`이 되어 「배정된 테스트가 없습니다」를
   * 찍고, 바로 아래에서 예정 테스트 목록을 냈다. 「있지만 오늘 것이 아니다」를
   * 상태로 갖는다 — 순위는 지금 할 것 > 마친 것 > 예정 > 없음. */
  const testState: StepState =
    openTests.length > 0
      ? "todo"
      : finishedTests.length > 0
        ? "done"
        : upcomingTests.length > 0
          ? "upcoming"
          : "none";
  const reviewState: StepState = reviewCount > 0 ? "todo" : "none";
  /* 「할 차례」는 한 번에 하나이고, 활성 단계가 없다는 사실만으로 완주를
   * 선언하지 않는다 — 판정과 그 이유는 today-steps.ts에 있다. */
  /* 단계 상태는 **서버가 확정한 계획**에서 접는다. 화면이 raw 행을 따로
   * 세면 「완료」의 뜻이 화면과 DB에서 갈리고, 그때 학생이 보는 것과 교사
   * 현황판이 보는 것이 달라진다. 위에서 센 값들(readingState 등)은 카드
   * 안의 건수·문구에만 쓴다. */
  const { active: activeStep, verdict } = readDay({
    ...planToDayInput(view.plan),
    hasSession: schedule.length > 0,
  });
  /** 학생이 할 수 없는 항목의 사유 — 화면이 「왜」를 말할 수 있게 */
  const blockedReasons = view.plan.blockedReasons;

  const stops: Stop[] = [
    {
      key: "session",
      no: 1,
      title: "오늘 배울 것",
      state: schedule.length > 0 ? "done" : "none",
      badge: schedule.length > 0 ? `${schedule.length}차시` : "수업 없음",
      empty: "오늘은 예정된 수업이 없습니다.",
    },
    {
      key: "reading",
      no: 2,
      title: "개념 공부",
      state: readingState,
      badge: badgeLabel(readingState, undone("reading").length),
      empty: "오늘 개념에 등록된 설명 자료가 아직 없습니다.",
      href: "/learn/study",
      cta: "읽으러 가기",
      again: "다시 보기",
    },
    {
      key: "video",
      no: 3,
      title: "개념 인강",
      state: videoState,
      badge: badgeLabel(videoState, undone("video").length),
      empty: "오늘 개념에 등록된 강의 영상이 아직 없습니다.",
      href: "/learn/watch",
      cta: "보러 가기",
      again: "다시 보기",
    },
    {
      key: "practice",
      no: 4,
      title: "연습문제",
      state: practiceState,
      badge: badgeLabel(practiceState, undone("practice").length),
      empty: "오늘 개념에 등록된 연습문제가 아직 없습니다.",
      href: "/learn/practice",
      cta: "풀러 가기",
      again: "다시 보기",
    },
    {
      key: "test",
      no: 5,
      title: "테스트",
      state: testState,
      badge: badgeLabel(
        testState,
        testState === "upcoming" ? upcomingTests.length : openTests.length,
      ),
      empty: "배정된 테스트가 없습니다. 선생님이 배정하면 여기에 표시됩니다.",
      /* 끝난 테스트 목록은 「지난 기록」으로 옮겼다. 접힌 줄에서 그리로
       * 가는 길만 남긴다 — 상단 탭을 우연히 누른 학생에게만 존재하는
       * 목적지가 되지 않게 한다. cta가 없으므로 「할 차례」일 때는 이
       * 링크가 나지 않고, 그 자리는 아래 「응시하기」 목록이 지킨다. */
      href: "/learn/records",
      again: "기록에서 보기",
    },
    {
      key: "review",
      no: 6,
      title: "복습",
      state: reviewState,
      badge: badgeLabel(reviewState, reviewCount),
      empty:
        "오늘 할 복습이 없습니다. 틀린 개념은 간격을 두고 여기에 다시 올라옵니다.",
      href: "/learn/review",
      cta: "복습 시작",
    },
  ];

  const hereIndex = stops.findIndex((s) => s.key === activeStep);
  const here = hereIndex >= 0 ? stops[hereIndex] : undefined;

  return (
    <div>
      <LearnTabs current="today" />

      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        {learner.displayName}님의 오늘 학습
      </h1>

      {/* 궤도의 텍스트 동등물이자 좌표 노트의 눈금.
       * **분모는 언제나 6(단계 수)이다** — 「없음이 아닌 단계」를 분모로 쓰면
       * 오후에 선생님이 자료를 올렸을 때 3/3이 3/4로 후퇴한다. 진행률이 뒤로
       * 가는 것은 성취 표현이 아니라 벌이다. 이 줄은 성취가 아니라 위치를
       * 말한다. */}
      <p className="mt-1.5 font-mono text-xs text-ink-soft">
        현재 위치{" "}
        <span className="font-bold text-ink">
          {here ? hereIndex + 1 : verdict === "finished" ? 6 : "–"}
        </span>{" "}
        / 6 ·{" "}
        {here
          ? here.title
          : verdict === "finished"
            ? "오늘 단계를 모두 지났습니다"
            : "배정된 학습 없음"}
      </p>

      {/* 잉크 반전은 이 페이지에서 여기 한 번뿐이다 — 히어로와 구조적으로
       * 배타적이므로(완주면 활성 단계가 없다) 1회 한도가 코드로 보장된다. */}
      {verdict === "finished" && (
        <section className="mt-4 rounded-lg bg-ink p-4 text-white">
          <p className="font-medium break-keep">오늘 할 일을 모두 마쳤습니다.</p>
          {/* 다음이 언제인지 아는 날에는 말해 준다 — 「생기면 표시됩니다」는
              이미 잡혀 있는 테스트를 모르는 척하는 말이 된다.
              (upcomingTests는 가까운 것부터라 [0]이 다음 것이다) */}
          <p className="mt-1 text-sm break-keep text-wash">
            {nextTestDay
              ? `다음 테스트는 ${formatIsoDay(nextTestDay)}부터입니다.`
              : "새 테스트나 복습이 생기면 여기에 다시 표시됩니다."}
          </p>
        </section>
      )}

      {/* 배정이 없는 날을 완주로 축하하지 않는다 — 반전을 쓰지 않는다.
       * 수업이 잡혀 있는데 자료만 없는 날은 또 다른 사실이다: 「배정된
       * 학습이 없습니다」라고만 하면 오늘 수업이 있다는 것과 어긋난다. */}
      {/* 막힌 날 — 완주로 축하하지 않고, 학생이 무엇을 해야 하는지 말한다.
       * 「선생님께 알려 주세요」까지 있어야 학생이 다음 행동을 안다: 자기
       * 잘못이 아니고 기다린다고 풀리지도 않는다는 것을 화면이 말해야 한다. */}
      {verdict === "blocked" && (
        <section className="mt-4 rounded-lg border border-dashed border-rule bg-paper p-4">
          <p className="font-medium break-keep">
            오늘 학습 중 지금 할 수 없는 항목이 있습니다.
          </p>
          <p className="mt-1 text-sm break-keep text-ink-soft">
            {blockedReasons.map(studentBlockText).join(" · ")}
          </p>
          <p className="mt-1 text-sm break-keep text-ink-soft">
            학생이 해결할 수 있는 문제가 아닙니다 — 선생님께 알려 주세요.
          </p>
        </section>
      )}

      {(verdict === "empty" || verdict === "sessionOnly") && (
        <section className="mt-4 rounded-lg border border-dashed border-rule bg-paper p-4">
          <p className="font-medium break-keep">
            {verdict === "sessionOnly"
              ? "오늘 수업은 있지만, 배정된 자료·테스트는 아직 없습니다."
              : "오늘은 배정된 학습이 없습니다."}
          </p>
          {/* 예정 테스트가 있는 날 「배정하면 표시됩니다」라고 하면, 이미
              배정된 것을 아직 없는 것처럼 말하는 셈이다. 단계 번호를 문장에
              박지 않는다 — 단계가 늘거나 순서가 바뀌면 조용히 틀린 말이 된다. */}
          <p className="mt-1 text-sm break-keep text-ink-soft">
            {nextTestDay
              ? `아직 열리지 않은 테스트가 ${formatIsoDay(nextTestDay)}부터 있습니다.`
              : "선생님이 자료나 테스트를 배정하면 아래 단계에 표시됩니다."}
          </p>
        </section>
      )}

      <ol className="mt-5" aria-label="오늘 학습 6단계">
        {stops.map((s, i) => {
          const active = activeStep === s.key;
          /* 접혀도 행동은 남는다 — 큰 채운 버튼 대신 밑줄 링크로
           * 성량만 낮춘다. 「조용하게」와 「길은 남긴다」가 부딪히면
           * 후자가 이긴다. */
          const link =
            !active && s.href
              ? s.state === "done" && s.again
                ? { href: s.href, label: s.again }
                : s.state === "todo" && s.cta
                  ? { href: s.href, label: s.cta }
                  : null
              : null;

          return (
            <OrbitStop
              key={s.key}
              no={s.no}
              orbit={orbitOf(s.state, i, hereIndex)}
              solidBelow={solidBelow(i, hereIndex, verdict === "finished")}
              last={i === stops.length - 1}
            >
              {active && s.key === "reading" && (
                <MaterialHero
                  no={s.no}
                  title={s.title}
                  href="/learn/study"
                  cta="읽으러 가기"
                  resumeCta="이어서 읽기"
                  all={byKind("reading")}
                  meta={null}
                />
              )}
              {active && s.key === "video" && (
                <MaterialHero
                  no={s.no}
                  title={s.title}
                  href="/learn/watch"
                  cta="보러 가기"
                  resumeCta="이어서 보기"
                  all={byKind("video")}
                  meta={videoMeta}
                />
              )}
              {active && s.key === "practice" && (
                <MaterialHero
                  no={s.no}
                  title={s.title}
                  href="/learn/practice"
                  cta="풀러 가기"
                  resumeCta="이어서 풀기"
                  all={byKind("practice")}
                  meta={practiceMeta}
                />
              )}

              {active && s.key === "test" && (
                <Hero no={s.no} eyebrow="오늘 볼 테스트" title={s.title}>
                  <ul className="mt-3 space-y-2 border-t border-rule-soft pt-3">
                    {openTests.map((a, k) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="min-w-0 break-keep">
                          <span className="text-sm font-medium">{a.title}</span>
                          <span className="ml-2 font-mono text-xs text-ink-soft">
                            {a.question_count}문항
                            {a.time_limit_minutes &&
                              ` · 제한 ${a.time_limit_minutes}분`}
                          </span>
                        </span>
                        <Link
                          href={`/learn/tests/${a.id}`}
                          className={`shrink-0 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium ${
                            k === 0
                              ? "bg-pen text-white"
                              : "border border-pen text-pen"
                          }`}
                        >
                          {a.attempt_status === "in_progress"
                            ? "이어서 풀기"
                            : "응시하기"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Hero>
              )}

              {active && s.key === "review" && (
                <Hero no={s.no} eyebrow="전에 틀렸던 개념" title={s.title}>
                  {/* 복습만 「몇 건」에 머물러 있었다 — 자료 히어로가 제목을
                      내는 옆에서 이 카드는 개념 이름을 손에 쥐고도 버렸다.
                      무엇을 복습하는지 알아야 학생이 지금 할지 정할 수 있다. */}
                  <ul className="mt-3 space-y-1.5 border-t border-rule-soft pt-3">
                    {shownConcepts.map((c) => (
                      <li
                        key={c.conceptId}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <span
                          aria-hidden
                          className="font-mono text-xs text-ink-soft"
                        >
                          {c.overdueCount > 0 ? "!" : "·"}
                        </span>
                        <span className="min-w-0 flex-1 break-keep">
                          {c.conceptName}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-soft">
                          {c.count}건{c.overdueCount > 0 && " · 기한 지남"}
                        </span>
                      </li>
                    ))}
                    {moreConcepts > 0 && (
                      <li className="font-mono text-[11px] text-ink-soft">
                        외 개념 {moreConcepts}개
                      </li>
                    )}
                  </ul>
                  <p className="mt-3 font-mono text-xs break-keep text-ink-soft">
                    복습 {reviewCount}건
                    {overdueCount > 0 && ` · 그중 ${overdueCount}건은 기한이 지났습니다`}
                  </p>
                  {/* 「맞히면 목록에서 사라집니다」였다. 사실이 아니다 —
                      맞혀도 닫히지 않고 간격이 늘어 뒤로 밀릴 뿐이다
                      (lib/domain/review.ts의 「맞혔다고 닫지 않는다」).
                      복습 화면은 이미 이 문구를 고쳤는데 오늘 화면만 옛말을
                      들고 있었다. 두 화면이 같은 것을 다르게 말하면 안 된다. */}
                  <p className="mt-2 text-sm break-keep">
                    맞히면 다음 복습이 더 뒤로 밀리고, 틀리면 더 빨리 다시
                    올라옵니다.
                  </p>
                  <HeroButton href="/learn/review">복습 시작</HeroButton>
                </Hero>
              )}

              {!active && (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h2
                      className={`text-sm font-medium break-keep ${
                        s.state === "done" ? "text-ink-soft" : ""
                      }`}
                    >
                      {s.title}
                    </h2>
                    <StepBadge state={s.state} label={s.badge} />
                    {link && (
                      <Link
                        href={link.href}
                        className="ml-auto shrink-0 text-sm text-pen underline underline-offset-4"
                      >
                        {link.label}
                      </Link>
                    )}
                  </div>

                  {/* 「없음」의 이유 문장은 지우지 않는다 — 없다는 사실만
                   * 남기면 학생이 그 공백을 자기 탓으로 채운다. */}
                  {s.state === "none" && (
                    <p className="mt-1 text-sm break-keep text-ink-soft">
                      {s.empty}
                    </p>
                  )}

                  {s.key === "session" && schedule.length > 0 && (
                    <ul className="mt-1.5 space-y-1.5">
                      {schedule.map((row, k) => {
                        const ids = nodeIdList(row.planned_node_ids);
                        return (
                          <li
                            key={`${row.starts_at.toISOString()}-${k}`}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                          >
                            {/* 시각은 사실 진술로만 쓴다. 「지금 수업 중」 같은
                             * 렌더 시점 판정은 넣지 않는다 — 탭을 열어 두면
                             * 수업이 끝난 뒤에도 남아 화면이 틀린 상태를
                             * 자신 있게 말하게 된다. */}
                            <p className="font-mono text-sm">
                              {formatTime(row.starts_at)}–
                              {formatTime(row.ends_at)}
                            </p>
                            <p className="min-w-0 text-sm break-keep">
                              {ids.length === 0 ? (
                                <span className="text-ink-soft">
                                  배정된 학습 내용 없음
                                </span>
                              ) : (
                                ids.map((id) => titleOf(nodeTitle, id)).join(" · ")
                              )}
                            </p>
                            {row.matches_group === false && (
                              <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 font-mono text-[11px]">
                                내 진도
                              </span>
                            )}
                            {row.is_rejoin && (
                              <span className="rounded-[var(--radius-control)] border border-pen bg-pen-soft px-1.5 py-0.5 font-mono text-[11px] text-ink">
                                반 진도 합류
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* 개념 공부가 활성인 날(=대부분의 날) 테스트는 접힌다.
                   * 여기서 링크를 빼면 「응시하기」가 화면에서 통째로 사라져
                   * 학생이 시험에 갈 길이 없어진다. 두 번째 시험도 마찬가지라
                   * 첫 건만 내지 않고 **전부** 낸다. */}
                  {s.key === "test" && openTests.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {openTests.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                        >
                          <span className="min-w-0 text-sm break-keep">
                            {a.title}
                            <span className="ml-2 font-mono text-xs text-ink-soft">
                              {a.question_count}문항
                            </span>
                          </span>
                          <Link
                            href={`/learn/tests/${a.id}`}
                            className="shrink-0 text-sm text-pen underline underline-offset-4"
                          >
                            {a.attempt_status === "in_progress"
                              ? "이어서 풀기"
                              : "응시하기"}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {/* 예정 테스트는 히어로든 접힘이든 테스트 정거장 맨 아래에
               * 붙는다 — 아직 열리지 않았으므로 링크가 아니다. */}
              {s.key === "test" && upcomingTests.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {upcomingTests.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-[var(--radius-control)] border border-dashed border-rule px-3 py-1.5"
                    >
                      <span className="min-w-0 text-sm break-keep text-ink-soft">
                        {a.title}
                        <span className="ml-2 font-mono text-xs">
                          {a.question_count}문항
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink-soft">
                        {formatIsoDay(a.scheduled_date!)}부터
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </OrbitStop>
          );
        })}
      </ol>

      {/* 끝난 테스트 목록은 여기 있었다. 「지난 기록」(/learn/records)으로
       * 옮겼다 — 접어 두었다기보다 갈 곳이 없어서 이 화면 바닥에 두고 있던
       * 것에 가까웠고, 달력이 생기면서 제자리가 생겼다. 이 화면에서 그리로
       * 가는 길은 위쪽 탭과 5단계(테스트)의 「기록에서 보기」 링크다. */}
    </div>
  );
}
