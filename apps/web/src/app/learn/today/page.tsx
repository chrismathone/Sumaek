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
import {
  badgeLabel,
  conceptSpan,
  orbitOf,
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

type StopKey = "session" | "concept" | "test" | "review";

/** 개념 하나의 오늘 진행 — 히어로와 배지가 같은 셈을 쓰도록 한 곳에 모은다 */
interface ConceptProgress {
  conceptId: string;
  name: string;
  /** 이 개념의 자료를 다 봤나 */
  done: boolean;
  /** 하나라도 손을 댔나 — 「이어서」 문구의 근거 */
  started: boolean;
  /** 남은 갈래 이름 (예: 「설명·인강」) */
  remainLabel: string;
}

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

/* 개념 학습 단계의 히어로 — 목록의 단위가 **개념**이다.
 *
 * 「자료 9건」이 아니라 개념 이름을 낸다. 하위 화면(/learn/study)이 한 쪽에
 * 한 개념을 내므로, 여기서 자료를 세면 두 화면의 단위가 어긋난다 — 예전에
 * 이 화면은 「할 차례 5건」, study는 「3건 중 2건」이라 같은 데이터로 서로
 * 다른 사실을 말했다.
 *
 * 마친 개념은 싣지 않는다(수치는 메타 줄이 말한다) — 히어로는 「지금 할
 * 것」의 자리다. 개념마다 무엇이 남았는지(설명·인강·연습)를 함께 적는다:
 * 학생이 그 쪽에 가서 무엇을 하게 되는지가 곧 갈지 말지의 판단 근거다. */
function ConceptHero({
  no,
  concepts,
  started,
}: {
  no: number;
  concepts: ConceptProgress[];
  /** 손댄 자료가 있으면 「이어서」 — 하위 화면이 이어 주는 사실을 말로도 낸다 */
  started: boolean;
}) {
  const rest = concepts.filter((c) => !c.done);
  const shown = rest.slice(0, 3);
  const more = rest.length - shown.length;
  const done = concepts.length - rest.length;
  return (
    <Hero
      no={no}
      eyebrow={conceptSpan(rest.map((c) => c.name))}
      title="개념 학습"
    >
      <ul className="mt-3 space-y-1.5 border-t border-rule-soft pt-3">
        {shown.map((c) => (
          <li key={c.conceptId} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden className="font-mono text-xs text-ink-soft">
              {c.started ? "▸" : "·"}
            </span>
            <span className="min-w-0 flex-1 break-keep">{c.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-soft">
              {c.remainLabel}
            </span>
          </li>
        ))}
        {more > 0 && (
          <li className="font-mono text-[11px] text-ink-soft">외 {more}개</li>
        )}
      </ul>
      <p className="mt-3 font-mono text-xs break-keep text-ink-soft">
        개념 {concepts.length}개 중 {done}개 완료
      </p>
      <HeroButton href="/learn/study">
        {started ? "이어서 하기" : "개념 학습 시작"}
      </HeroButton>
    </Hero>
  );
}

export default async function LearnTodayPage() {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();
  const today = todayInKst();

  const [assessments, dueConcepts, learnerItems] = await Promise.all([
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
             (select count(*)::int from assessment_questions q
               where q.assessment_id = a.id) as question_count,
             t.id as attempt_id, t.status as attempt_status,
             t.total_score, t.max_score
      from assignments s
      join assessment_instances a on a.id = s.assessment_id
      /* 재응시가 생기면 한 평가에 attempts 행이 여럿이다(고유 키가
       * assessment·learner·attempt_no다). 그냥 join하면 같은 테스트가
       * 목록에 두 줄로 나온다 — 최신 응시 한 건만 붙인다. */
      left join lateral (
        select at.id::text as id, at.status::text as status,
               at.total_score::text as total_score,
               at.max_score::text as max_score
        from attempts at
        where at.assessment_id = a.id and at.learner_id = s.learner_id
        order by at.attempt_no desc
        limit 1
      ) t on true
      where s.organization_id = ${learner.user.organizationId}
        and s.learner_id = ${learner.learnerId}
        and s.status <> 'cancelled'
        and a.status in ('published', 'open', 'closed', 'grading', 'finalized')
        /* 상한이 없으면 학기가 지날수록 이 배정 스캔이 끝없이 자란다.
         * 90일보다 오래된 끝난 테스트는 「지난 기록」(/learn/records)이
         * 달 단위로 낸다 — 여기서 다 이고 갈 필요가 없다.
         *
         * **끝난 것에만 건다.** 지난 기록은 제출된 응시만 내므로
         * (submitted_at 기준), 아직 응시하지 않은 배정을 여기서 빼면
         * 학생 앱 어디에도 그 테스트로 가는 길이 남지 않는다 — 서버
         * startAttempt는 여전히 허용하는데 화면만 길을 닫는 꼴이다.
         * 게다가 그 건이 유일한 배정이면 화면이 「배정된 학습이 없습니다」
         * 라고 말한다. */
        and (
          a.scheduled_date is null
          or a.scheduled_date >= ${today}::date - 90
          or t.status is null
          or not (t.status = any(${DONE_ATTEMPT_STATUSES}))
        )
      order by a.scheduled_date desc nulls last, a.created_at desc
    `,
    /* 기한이 온 복습 — 교사 화면(app/students)과 같은 기준(due_on)이다.
     * 개념별로 묶어서 받는다: 히어로가 「몇 건」이 아니라 **무엇을** 복습할지
     * 말해야 하고, 총건수·기한 지난 수는 이 묶음을 더하면 나온다. 집계 질의를
     * 따로 두면 두 정의가 갈릴 자리가 하나 더 생긴다. */
    listDueReviewConcepts({
      organizationId: learner.user.organizationId,
      learnerId: learner.learnerId,
      today,
    }),
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

  /* 차시 노드 이름 — 지난 기록의 하루 상세와 **같은 규칙**을 써야 해서
   * lib/learn/node-titles.ts에 있다. 두 화면이 각자 풀면 보충 차시 이름이
   * 한쪽에서만 뭉개지는 식으로 갈린다. */
  const nodeIds = schedule.flatMap((s) => nodeIdList(s.planned_node_ids));
  const nodeTitle = await nodeTitleMap({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    nodeIds,
  });

  /* 오늘 개념의 학습 자료 — 개념 학습 단계의 상태를 정한다.
   * 자료가 0건이면 「없음」으로 두고 단계 자체를 없애지는 않는다:
   * 없다는 사실도 학생이 알아야 하고, 자료가 생기면 그 자리에 나타난다. */
  const conceptIds = await conceptIdsForNodes(nodeIds);
  const materials = await listMaterials({
    organizationId: learner.user.organizationId,
    learnerId: learner.learnerId,
    conceptIds,
  });

  /* ── 개념 단위 진행 ──
   *
   * 하위 화면(/learn/study)이 한 쪽에 한 개념을 내므로 이 화면도 개념을
   * 센다. 자료를 세면 두 화면의 단위가 어긋나 같은 데이터로 서로 다른
   * 사실을 말하게 된다.
   *
   * 개념 순서는 listMaterials의 정렬(개념명)이다 — study의 쪽 순서와 같아야
   * 「첫 번째로 보이는 개념」이 「들어가면 열리는 쪽」과 일치한다. */
  const conceptOrder: string[] = [];
  const conceptBucket = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    let bucket = conceptBucket.get(m.conceptId);
    if (!bucket) {
      bucket = [];
      conceptBucket.set(m.conceptId, bucket);
      conceptOrder.push(m.conceptId);
    }
    bucket.push(m);
  }
  const KIND_LABEL: Record<MaterialRow["kind"], string> = {
    reading: "설명",
    video: "인강",
    practice: "연습",
  };
  const concepts: ConceptProgress[] = conceptOrder.map((id) => {
    const list = conceptBucket.get(id)!;
    const rest = list.filter((m) => m.progress !== "completed");
    /* 남은 것을 갈래 이름으로 적는다 — 「3건」보다 「설명·인강」이 학생이
     * 그 쪽에서 무엇을 하게 되는지를 그대로 말한다. 순서는 화면의 순서
     * (설명 → 인강 → 연습)를 따른다. */
    const kinds = (["reading", "video", "practice"] as const).filter((k) =>
      rest.some((m) => m.kind === k),
    );
    return {
      conceptId: id,
      name: list[0]!.conceptName,
      done: rest.length === 0,
      started: list.some((m) => m.progress !== "none"),
      remainLabel: kinds.map((k) => KIND_LABEL[k]).join("·"),
    };
  });
  const conceptState: StepState =
    concepts.length === 0
      ? "none"
      : concepts.every((c) => c.done)
        ? "done"
        : "todo";
  const undoneConcepts = concepts.filter((c) => !c.done).length;

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
  const { active: activeStep, verdict } = readDay({
    hasSession: schedule.length > 0,
    concept: conceptState,
    test: testState,
    review: reviewState,
  });

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
      /* 설명·인강·연습이 한 단계다 — 셋을 갈라 두면 학생이 같은 개념을
       * 배우면서 세 단계와 세 화면을 오간다. 배지 단위도 개념이다. */
      key: "concept",
      no: 2,
      title: "개념 학습",
      state: conceptState,
      badge:
        conceptState === "todo"
          ? `남은 ${undoneConcepts}개`
          : badgeLabel(conceptState, undoneConcepts),
      empty: "오늘 개념에 등록된 자료가 아직 없습니다.",
      href: "/learn/study",
      cta: "개념 학습 시작",
      again: "다시 보기",
    },
    {
      key: "test",
      no: 3,
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
      no: 4,
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
       * **분모는 언제나 단계 수(stops.length)다** — 「없음이 아닌 단계」를
       * 분모로 쓰면 오후에 선생님이 자료를 올렸을 때 3/3이 3/4로 후퇴한다.
       * 진행률이 뒤로 가는 것은 성취 표현이 아니라 벌이다. 이 줄은 성취가
       * 아니라 위치를 말한다. 숫자를 박아 두지 않는 이유는 단계가 6에서 4로
       * 줄던 날 이 자리와 아래 aria-label이 함께 틀린 말이 됐기 때문이다. */}
      <p className="mt-1.5 font-mono text-xs text-ink-soft">
        현재 위치{" "}
        <span className="font-bold text-ink">
          {here ? hereIndex + 1 : verdict === "finished" ? stops.length : "–"}
        </span>{" "}
        / {stops.length} ·{" "}
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

      <ol className="mt-5" aria-label={`오늘 학습 ${stops.length}단계`}>
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
              {active && s.key === "concept" && (
                <ConceptHero
                  no={s.no}
                  concepts={concepts}
                  started={materials.some((m) => m.progress !== "none")}
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
