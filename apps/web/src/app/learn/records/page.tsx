import type { Metadata } from "next";
import Link from "next/link";
import { getSharedSql } from "@su-maek/db";
import { KST } from "@su-maek/core/shared";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import {
  HOLIDAY_KIND_LABEL,
  formatIsoDay,
  formatTime,
  label,
  todayInKst,
  trimScore,
} from "@/lib/format";
import {
  WEEKDAYS,
  resolveMonth,
  weekdayIndex,
  type MonthView,
} from "@/lib/calendar/month";
import {
  describeDay,
  readRecordDay,
  type DayBucket,
  type RecordKind,
} from "@/lib/learn/record-days";
import { nodeIdList, nodeTitleMap, titleOf } from "@/lib/learn/node-titles";
import { LearnTabs } from "@/components/learn/LearnTabs";
import { OrbitStop } from "../today/OrbitRail";

export const metadata: Metadata = { title: "지난 기록" };

/* ─────────────────────────────────────────────────────────────
 * 지난 기록 — 학생이 「이 날 뭘 했지」를 되짚는 곳.
 *
 * 오늘 학습 화면이 「지금 할 것」만 말하도록 두려면 지난 것을 둘 곳이
 * 있어야 한다. 예전에는 끝난 테스트가 오늘 화면 맨 아래 <details>로
 * 접혀 있었는데, 그건 「접었다」기보다 **갈 곳이 없어서 거기 둔 것**에
 * 가까웠다. 여기가 그 목적지다.
 *
 * ## 이 화면이 말하는 것
 * 그 달에 **수업이 있던 날**(학원이 정한 것), 그 날 **내가 남긴 기록이
 * 있는지**(내가 한 것), 그리고 칸을 누르면 **무엇을 남겼는지**.
 *
 * ## 말하지 않는 것 — 전부 넣을 수 있었지만 잘라낸 것이다
 * - 점수 평균·정답률·완료율·진행률·숙련도·연속 학습일·전월 대비.
 * - **월 집계 수치 자체를 두지 않는다.** 「기록 12일」이라고만 써도 8월
 *   옆에서 31은 상수라 학생이 분모를 스스로 만든다. 개별 사실만 낸다.
 * - 기록이 없는 날에 ×·「미완료」 같은 표식을 찍지 않는다. 빈 칸에 표식을
 *   찍는 순간 달력이 벌점표가 된다. 「다 봤어요」를 안 눌렀을 뿐 공부한
 *   날일 수도 있다 — 화면은 아는 것만 말한다.
 * - **학습 불참(learning_availability_events)은 조회조차 하지 않는다.**
 *   날짜 격자에 결석을 찍으면 이 제품이 출결부가 된다. 휴일(holidays)은
 *   학원 운영의 사실이라 남긴다 — 이 둘의 분리가 이 화면의 경계선이다.
 * - 「빠짐」·「안 했습니다」 같은 평가 어휘 대신 「남은 기록이 없습니다」.
 *
 * ## 상태는 URL에 있다
 * ?month=YYYY-MM · ?day=YYYY-MM-DD. 자바스크립트가 0줄이고, 깊은 링크·
 * 뒤로 가기·새로고침이 공짜로 따라온다. 교사 달력의 「+N개 더」 팝오버를
 * 가져오지 않은 이유이기도 하다 — 그 창은 224px이라 46px 칸 옆에 붙이면
 * 360px 화면 밖으로 나간다.
 * ───────────────────────────────────────────────────────────── */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ClassRow {
  source: string;
  day: string;
  starts_at: Date;
  ends_at: Date;
  planned_node_ids: unknown;
  matches_group: boolean | null;
  is_rejoin: boolean | null;
  group_name: string | null;
}

interface ActivityRow {
  kind: RecordKind;
  day: string;
  ref_id: string;
  title: string;
  seq: number | null;
  status: string | null;
  v1: string | null;
  v2: string | null;
  at: Date | null;
}

interface HolidayRow {
  id: string;
  name: string;
  kind: string;
  starts_on: string;
  ends_on: string;
}

interface RecentTestRow {
  id: string;
  title: string;
  day: string;
  attempt_no: number;
  status: string;
  total_score: string | null;
  max_score: string | null;
}

const MATERIAL_LABEL: Record<string, string> = {
  reading: "개념 공부",
  video: "개념 인강",
  practice: "연습문제",
};

/* 자국 — 종류를 나누지 않는다.
 *
 * 칸 폭이 46px이라 「테」·「학」·「복」 같은 10px 한글은 라벨이 아니라
 * 질감이 된다. 무엇을 남겼는지는 한 번의 클릭 아래(하루 상세)와
 * aria-label 문장이 말한다. 크기는 전부 rem이라 글꼴을 키우면 상자도
 * 함께 자란다 — 고정 px 상자에 글자를 넣으면 확대에서 글자가 뚫고 나간다. */
function Mark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] border border-solid border-ink bg-ink font-mono text-[0.625rem] leading-none text-white"
    >
      ✓
    </span>
  );
}

function MonthNav({ view }: { view: MonthView }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="월 이동">
      <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-rule bg-surface">
        <Link
          href={`/learn/records?month=${view.prevMonth}`}
          aria-label={`이전 달 (${view.prevMonth})`}
          className="px-2.5 py-1.5 text-sm"
        >
          ‹
        </Link>
        <span className="min-w-28 border-x border-rule px-3 py-1.5 text-center text-sm font-semibold">
          {Number(view.key.slice(0, 4))}년 {Number(view.key.slice(5, 7))}월
        </span>
        <Link
          href={`/learn/records?month=${view.nextMonth}`}
          aria-label={`다음 달 (${view.nextMonth})`}
          className="px-2.5 py-1.5 text-sm"
        >
          ›
        </Link>
      </div>
      <Link
        href="/learn/records"
        className="rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-1.5 text-sm"
      >
        이번 달
      </Link>
    </nav>
  );
}

export default async function LearnRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();
  const org = learner.user.organizationId;
  const lid = learner.learnerId;
  const today = todayInKst();

  const { month, day: rawDay } = await searchParams;
  /* 파라미터가 없으면 언제나 **이번 달**이다 — 파라미터 없는 경로의 정체가
   * 날마다 바뀌면 안 된다(교사 달력 「오늘」과 같은 계약). */
  const view = resolveMonth(month, today.slice(0, 7));
  /* 형식이 맞고 **보고 있는 달 안**일 때만 유효. 아니면 조용히 무시한다. */
  const openDay =
    rawDay && DAY_RE.test(rawDay) && rawDay.slice(0, 7) === view.key
      ? rawDay
      : null;

  const [classes, activities, holidays] = await Promise.all([
    /* Q1 — 차시. date 컬럼만 쓰므로 시간대 변환이 없다.
     *
     * 「개별 우선, 없으면 반 공통」을 **날짜 단위**로 적용한다. 오늘 화면의
     * `learnerItems.length > 0 ? [] : …` 형태를 한 달에 그대로 베끼면
     * 달에 개별 항목이 하루만 있어도 반 공통 수업이 통째로 사라진다.
     *
     * 반 소속 기간(joined_on·left_on)도 건다 — 오늘 하루만 그릴 때는
     * 드러나지 않지만, 한 달을 그리면 중간에 반을 옮긴 학생에게 들어오기
     * 전·나간 뒤의 수업이 그려진다. */
    sql<ClassRow[]>`
      select 'learner'::text as source, li.item_date::text as day,
             li.starts_at, li.ends_at, li.planned_node_ids,
             li.matches_group, li.is_rejoin, null::text as group_name
      from learner_schedule_items li
      where li.organization_id = ${org} and li.learner_id = ${lid}
        and li.item_date between ${view.firstDay}::date and ${view.lastDay}::date
      union all
      select 'group', s.session_date::text, s.starts_at, s.ends_at,
             s.planned_node_ids, null::boolean, null::boolean, g.name
      from sessions s
      join learning_groups g on g.id = s.learning_group_id
      join learning_group_memberships m
        on  m.learning_group_id = s.learning_group_id
        and m.organization_id   = ${org}
        and m.learner_id        = ${lid}
        and m.status            = 'active'
        and s.session_date     >= m.joined_on
        and (m.left_on is null or s.session_date <= m.left_on)
      where s.organization_id = ${org}
        and s.session_date between ${view.firstDay}::date and ${view.lastDay}::date
        and s.status <> 'cancelled'
        and not exists (
          select 1 from learner_schedule_items li2
          where li2.organization_id = ${org} and li2.learner_id = ${lid}
            and li2.item_date = s.session_date)
      order by day, starts_at
    `,
    /* Q2 — 내가 남긴 것. timestamptz를 **KST 벽시계로 옮긴 뒤** 날짜로 자른다.
     * UTC 기준 ::date를 쓰면 오전 9시 이전에 한 일이 전날 칸에 들어간다.
     *
     * WHERE는 반대 방향으로 쓴다(날짜 → timestamptz 반열린 구간) — 컬럼에
     * 함수를 씌우면 결과는 같아도 인덱스에 얹힐 여지가 영영 사라진다.
     *
     * **`::timestamp`를 지우지 말 것.** `at time zone`은 timezone(zone, ts)
     * 함수이고, 좌변이 date면 date→timestamp와 date→timestamptz가 둘 다
     * implicit이라 후보가 갈린다. Postgres는 datetime 카테고리의 preferred
     * type인 timestamptz 쪽을 골라서, 세션 시간대로 한 번 KST로 한 번 —
     * 두 번 변환한다. 세션이 UTC인 우리 Supabase에서 **18시간**이 밀려
     * 매달 1일 18:00 KST 이전 기록이 통째로 사라졌다(실측 후 수리).
     * 로컬 세션이 KST면 두 변환이 상쇄되어 영영 드러나지 않는다.
     *
     * 앞날은 span이 잘라 낸다: 미래 달을 보면 d0 > d1이라 활동 행이 하나도
     * 들어오지 않는다. 경계를 화면이 아니라 쿼리에서 못 박는다. */
    sql<ActivityRow[]>`
      with span as (
        select ${view.firstDay}::date as d0,
               (least(${view.lastDay}::date, ${today}::date) + 1) as d1
      )
      select 'test'::text as kind,
             (t.submitted_at at time zone ${KST})::date::text as day,
             t.id::text as ref_id, a.title as title,
             t.attempt_no as seq, t.status::text as status,
             t.total_score::text as v1, t.max_score::text as v2,
             t.submitted_at as at
      from attempts t
      join assessment_instances a on a.id = t.assessment_id
      cross join span
      where t.organization_id = ${org} and t.learner_id = ${lid}
        /* 버킷 기준은 submitted_at이다 — 교사가 채점을 확정한 날이 아니라
         * 학생이 낸 날이다. 끝나지 않은 응시는 null이라 저절로 빠진다.
         * invalidated도 빼지 않는다: 과거를 조용히 지우지 않는다. */
        and t.submitted_at >= span.d0::timestamp at time zone ${KST}
        and t.submitted_at <  span.d1::timestamp at time zone ${KST}
      union all
      select 'material',
             (p.completed_at at time zone ${KST})::date::text,
             p.material_id::text, m.title,
             null::int, m.kind::text,
             (p.result ->> 'correct'), (p.result ->> 'total'),
             p.completed_at
      from learner_material_progress p
      join learning_materials m on m.id = p.material_id
      cross join span
      where p.organization_id = ${org} and p.learner_id = ${lid}
        and p.status = 'completed'
        and p.completed_at >= span.d0::timestamp at time zone ${KST}
        and p.completed_at <  span.d1::timestamp at time zone ${KST}
      union all
      /* 복습은 completed_at이 아니라 last_reviewed_on으로 버킷한다 —
       * 졸업하지 않은 복습은 completed_at이 null로 되돌아가므로, 그걸로
       * 세면 복습이 화면에서 거의 다 사라진다.
       *
       * closedBy = 'learner_review'를 반드시 함께 건다: 채점이 밀린 복습을
       * 닫으면서 last_reviewed_on을 찍는다(closedBy가 graded_response·
       * grading_exception이다). 그것까지 세면 학생이 손대지 않은 날에
       * 「복습 마침」이 찍힌다.
       *
       * 이 필터가 성립하려면 채점이 학생의 흔적을 **덮지 말아야** 한다.
       * 예전에는 덮었다 — 학생이 복습한 뒤 같은 개념을 채점으로 맞히면
       * outcome이 통째로 치환되면서 이 필터에서 탈락해 복습이 화면에서
       * 아예 사라졌다. lib/domain/attempt.ts가 이제 learner_review 행의
       * 날짜와 closedBy를 지키고 채점 정보를 gradedClose로 곁에 얹는다.
       *
       * **남은 한계**: 같은 항목을 두 번 복습하면 last_reviewed_on이 뒤 날짜로
       * 밀려 첫 복습일이 사라진다. review_items가 이력이 아니라 예정 행이라
       * 그렇다 — 진짜 수리는 복습 사건을 append-only로 빼는 것이고 스키마
       * 변경이라 별건이다.
       *
       * last_reviewed_on은 이미 KST 기준 date라 변환하지 않는다. */
      select 'review', r.last_reviewed_on::text,
             r.id::text, c.name,
             r.repetition_no, r.status::text,
             (r.outcome ->> 'correct'), null::text, null::timestamptz
      from review_items r
      join canonical_concepts c on c.id = r.concept_id
      where r.organization_id = ${org} and r.learner_id = ${lid}
        and r.outcome ->> 'closedBy' = 'learner_review'
        and r.last_reviewed_on between ${view.firstDay}::date
                                   and least(${view.lastDay}::date, ${today}::date)
      order by day, at nulls last
    `,
    /* Q3 — 휴일. 빈 칸이 왜 비었는지를 학생 탓이 아닌 것으로 되돌린다. */
    sql<HolidayRow[]>`
      select h.id, h.name, h.kind::text as kind,
             h.starts_on::text as starts_on, h.ends_on::text as ends_on
      from holidays h
      where h.organization_id = ${org}
        and h.starts_on <= ${view.lastDay}::date
        and h.ends_on   >= ${view.firstDay}::date
        and (h.learning_group_id is null
             or exists (select 1 from learning_group_memberships m
                        where m.organization_id = ${org} and m.learner_id = ${lid}
                          and m.learning_group_id = h.learning_group_id
                          and m.status = 'active'))
      order by h.starts_on
    `,
  ]);

  /* ── 날짜별 버킷 ── */
  const byDay = new Map<string, DayBucket>();
  const bucket = (d: string): DayBucket => {
    let b = byDay.get(d);
    if (!b) {
      b = { classCount: 0, kinds: new Set<RecordKind>() };
      byDay.set(d, b);
    }
    return b;
  };
  for (const c of classes) bucket(c.day).classCount += 1;
  for (const a of activities) bucket(a.day).kinds.add(a.kind);

  const holidayOn = (d: string) =>
    holidays.find((h) => h.starts_on <= d && h.ends_on >= d) ?? null;

  /* ?day가 있으면 그 날의 노드 이름을, 없으면 최근 테스트를 읽는다.
   * 격자 칸은 차시 **수**만 쓰므로 제목 왕복이 필요 없다. */
  const dayClasses = openDay ? classes.filter((c) => c.day === openDay) : [];
  const [nodeTitles, recentTests] = await Promise.all([
    openDay
      ? nodeTitleMap({
          organizationId: org,
          learnerId: lid,
          nodeIds: dayClasses.flatMap((c) => nodeIdList(c.planned_node_ids)),
        })
      : Promise.resolve(new Map<string, string>()),
    /* Q4 — 최근 테스트. **보고 있는 달과 무관한** 최근 5건이다.
     * 이 화면을 여는 1순위 동기(「지난번 몇 점이었지」)를 클릭 0회로 답한다. */
    openDay
      ? Promise.resolve([] as RecentTestRow[])
      : sql<RecentTestRow[]>`
          select t.id::text as id, a.title,
                 (t.submitted_at at time zone ${KST})::date::text as day,
                 t.attempt_no, t.status::text as status,
                 t.total_score::text as total_score,
                 t.max_score::text as max_score
          from attempts t
          join assessment_instances a on a.id = t.assessment_id
          where t.organization_id = ${org} and t.learner_id = ${lid}
            and t.submitted_at is not null
          order by t.submitted_at desc
          limit 5
        `,
  ]);

  const dayActivities = openDay
    ? activities.filter((a) => a.day === openDay)
    : [];
  const openRead = openDay
    ? readRecordDay(byDay.get(openDay), openDay, today)
    : null;

  const cells: (string | null)[] = [
    ...Array.from({ length: view.leadingBlanks }, () => null),
    ...view.days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const emptyMonth = classes.length === 0 && activities.length === 0;
  const futureMonth = view.key > today.slice(0, 7);

  return (
    <div>
      <LearnTabs current="records" />

      <h1 className="font-[MaruBuri] text-2xl font-semibold break-keep">
        지난 기록
      </h1>
      <p className="mt-1 text-sm break-keep text-ink-soft">
        수업이 있는 날은 왼쪽에 선이, 기록을 남긴 날에는 ✓가 붙습니다. 날짜를
        누르면 그 날 무엇을 했는지 볼 수 있습니다.
      </p>

      <div className="mt-4">
        <MonthNav view={view} />
      </div>

      {/* 범례 — 색만으로 구분되지 않도록 모양과 말을 함께 둔다 */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-4 w-0 border-l-2 border-ink" />
          수업이 있는 날
        </li>
        <li className="flex items-center gap-1.5">
          <Mark />
          내가 남긴 기록
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-[2px] bg-pen-soft"
          />
          오늘
        </li>
      </ul>

      {/* 격자에 min-w를 두지 않는다 — grid-cols-7은 1fr 일곱이라 폭을 넘길
       * 수 없고, 360px에서 열이 46px이라 iOS 최소 타깃 44px를 넘긴다.
       * **누가 나중에 min-w를 넣으면 그 순간 ScrollableRegion이 필요해진다**
       * (항목 없는 달이 흔한데, 키보드로 밀 수 없는 가로 스크롤 상자는
       * 접근성 위반이다). ARIA도 얹지 않는다: 교사 달력이 무-ARIA
       * div 격자로 axe를 통과하고 있고, 어설픈 role=grid가 오히려 깨진다. */}
      <div
        id="grid"
        className="mt-3 scroll-mt-16 overflow-hidden rounded-lg border border-rule bg-surface"
      >
        <div className="grid grid-cols-7 border-b border-rule-soft">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`py-1.5 text-center text-[11px] font-semibold ${
                i === 0 ? "text-grade" : "text-ink-soft"
              }`}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, index) => {
            if (!day) {
              return (
                <div
                  key={`blank-${index}`}
                  aria-hidden
                  className="min-h-14 border-r border-b border-rule-soft bg-paper sm:min-h-20"
                />
              );
            }
            const d = readRecordDay(byDay.get(day), day, today);
            const box =
              `min-h-14 border-r border-b border-l-2 border-rule-soft p-1 text-left sm:min-h-20 ` +
              (d.hasClass ? "border-l-ink " : "border-l-transparent ") +
              (d.isToday ? "bg-pen-soft " : "") +
              (day === openDay ? "ring-2 ring-inset ring-pen " : "");

            const body = (
              <>
                <span className="flex items-baseline gap-1">
                  <span
                    className={`font-mono text-xs leading-none ${
                      d.isToday
                        ? "font-bold text-pen"
                        : d.ahead
                          ? "text-ink-soft"
                          : "font-bold text-ink"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {d.isToday && (
                    <span className="font-mono text-[0.625rem] leading-none text-pen">
                      오늘
                    </span>
                  )}
                </span>
                {d.hasMark && (
                  <span className="mt-1 block">
                    <Mark />
                  </span>
                )}
              </>
            );

            /* 볼 것이 있는 날만 링크다 — 빈 달에 탭 정지를 31개 만들지
             * 않는다. 링크가 아닌 칸에는 aria-label을 붙이지 않는다:
             * 일반 div의 aria-label은 스크린리더가 무시하고, 볼 것이 없는
             * 칸에는 말할 사실도 없다. */
            return d.hasClass || d.hasMark ? (
              <Link
                key={day}
                href={`/learn/records?month=${view.key}&day=${day}#day-detail`}
                aria-label={describeDay(d, formatIsoDay(day))}
                aria-current={d.isToday ? "date" : undefined}
                className={`${box} block focus:outline-none focus-visible:ring-2 focus-visible:ring-pen`}
              >
                {body}
              </Link>
            ) : (
              <div
                key={day}
                aria-current={d.isToday ? "date" : undefined}
                className={box}
              >
                {body}
              </div>
            );
          })}
        </div>
      </div>

      {/* 46px 칸에 읽히는 휴일 라벨을 넣을 자리가 없다 — 읽히지 않는 표식은
       * 정보가 아니다. 한 줄로 낸다. */}
      {holidays.length > 0 && (
        <p className="mt-2 text-xs break-keep text-ink-soft">
          이 달의 휴일 —{" "}
          {holidays
            .map(
              (h) =>
                `${formatIsoDay(h.starts_on)}${
                  h.ends_on !== h.starts_on ? `–${formatIsoDay(h.ends_on)}` : ""
                } ${h.name}(${label(HOLIDAY_KIND_LABEL, h.kind)})`,
            )
            .join(" · ")}
        </p>
      )}

      {emptyMonth && (
        <div className="mt-4 rounded-lg border border-dashed border-rule bg-paper p-4 text-sm break-keep">
          {futureMonth
            ? "아직 오지 않은 달입니다. 수업이 잡히면 그 날짜에 선이 표시됩니다."
            : "이 달에는 남은 기록이 없습니다. 수업이 없었거나, 아직 수맥을 쓰기 전입니다."}
        </div>
      )}

      <section id="day-detail" className="mt-6 scroll-mt-16">
        {openDay && openRead ? (
          <>
            <h2 className="text-lg font-semibold break-keep">
              {formatIsoDay(openDay)} ({WEEKDAYS[weekdayIndex(view, openDay)]}
              요일)
            </h2>

            {dayClasses.length === 0 && dayActivities.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-rule bg-paper p-4 text-sm break-keep">
                {(() => {
                  const h = holidayOn(openDay);
                  if (h)
                    return `이 날은 ${h.name}(${label(HOLIDAY_KIND_LABEL, h.kind)})입니다.`;
                  if (openRead.ahead) return "아직 오지 않은 날입니다.";
                  if (openRead.hasClass)
                    return "수업은 있었지만 남은 기록이 없습니다.";
                  return "이 날 남은 기록이 없습니다. 예정된 수업도 없었습니다.";
                })()}
              </p>
            ) : (
              <ol className="mt-4">
                {(() => {
                  /* 순서: 차시 → 테스트 → 자료 → 복습. 하루 안에서 같은
                   * 종류가 언제나 같은 자리에 온다. */
                  const order: RecordKind[] = ["test", "material", "review"];
                  const events = [
                    ...dayClasses.map((c) => ({ t: "class" as const, c })),
                    ...order.flatMap((k) =>
                      dayActivities
                        .filter((a) => a.kind === k)
                        .map((a) => ({ t: "act" as const, a })),
                    ),
                  ];
                  return events.map((e, i) => (
                    <OrbitStop
                      key={e.t === "class" ? `c-${i}` : `a-${e.a.kind}-${e.a.ref_id}`}
                      no={i + 1}
                      /* 지난 날의 사건은 전부 past — 일어난 일이다.
                       * orbitOf()는 쓰지 않는다(레일 순번 기준이다). */
                      orbit={openRead.ahead ? "ahead" : "past"}
                      solidBelow={!openRead.ahead}
                      last={i === events.length - 1}
                    >
                      {e.t === "class" ? (
                        <div>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <p className="font-mono text-sm">
                              {formatTime(e.c.starts_at)}–{formatTime(e.c.ends_at)}
                            </p>
                            {e.c.matches_group === false && (
                              <span className="rounded-[var(--radius-control)] border border-highlight bg-highlight-soft px-1.5 py-0.5 font-mono text-[11px]">
                                내 진도
                              </span>
                            )}
                            {e.c.is_rejoin && (
                              <span className="rounded-[var(--radius-control)] border border-pen bg-pen-soft px-1.5 py-0.5 font-mono text-[11px] text-ink">
                                반 진도 합류
                              </span>
                            )}
                            {e.c.group_name && (
                              <span className="font-mono text-[11px] text-ink-soft">
                                {e.c.group_name}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm break-keep">
                            {nodeIdList(e.c.planned_node_ids).length === 0 ? (
                              <span className="text-ink-soft">
                                배정된 학습 내용 없음
                              </span>
                            ) : (
                              nodeIdList(e.c.planned_node_ids)
                                .map((id) => titleOf(nodeTitles, id))
                                .join(" · ")
                            )}
                          </p>
                        </div>
                      ) : e.a.kind === "test" ? (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="min-w-0 text-sm break-keep">
                            {e.a.title}
                            {(e.a.seq ?? 1) > 1 && (
                              <span className="ml-2 font-mono text-xs text-ink-soft">
                                {e.a.seq}차 응시
                              </span>
                            )}
                            {e.a.status === "invalidated" && (
                              <span className="ml-2 rounded-[var(--radius-control)] border border-grade px-1.5 py-0.5 font-mono text-[11px] text-grade">
                                무효
                              </span>
                            )}
                          </span>
                          <Link
                            href={`/learn/results/${e.a.ref_id}`}
                            className="shrink-0 text-sm text-pen underline underline-offset-4"
                          >
                            {e.a.v1 !== null
                              ? `결과 보기 (${trimScore(e.a.v1)}/${trimScore(e.a.v2)}점)`
                              : "결과 보기"}
                          </Link>
                        </div>
                      ) : e.a.kind === "material" ? (
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-[11px] text-ink-soft">
                            {MATERIAL_LABEL[e.a.status ?? ""] ?? "자료"}
                          </span>
                          <span className="min-w-0 text-sm break-keep">
                            {e.a.title}
                          </span>
                          {e.a.at && (
                            <span className="font-mono text-[11px] text-ink-soft">
                              {formatTime(e.a.at)}
                            </span>
                          )}
                          {/* 연습문제만 채점 결과가 있다. 숫자만 두면 성적으로
                            * 읽히므로 「점수로 남지 않습니다」를 같은 줄에 둔다. */}
                          {e.a.status === "practice" && e.a.v1 !== null && (
                            <span className="font-mono text-[11px] text-ink-soft">
                              {e.a.v1}/{e.a.v2} · 점수로 남지 않습니다
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-[11px] text-ink-soft">
                            복습
                          </span>
                          <span className="min-w-0 text-sm break-keep">
                            {e.a.title}
                          </span>
                          {(e.a.seq ?? 0) > 1 && (
                            <span className="font-mono text-[11px] text-ink-soft">
                              {e.a.seq}회차
                            </span>
                          )}
                        </div>
                      )}
                    </OrbitStop>
                  ));
                })()}
              </ol>
            )}

            {/* 자료 진도는 (학습자, 자료) 한 행뿐이라 다시 완료하면 날짜가
             * 옮겨 간다. 화면 코드로는 못 고치므로 사실을 적는다 — 조용히
             * 넘기면 학생이 「내 기록이 지워졌다」로 경험한다. */}
            {dayActivities.some((a) => a.kind === "material") && (
              <p className="mt-3 border-t border-rule-soft pt-2 text-xs break-keep text-ink-soft">
                자료는 마지막으로 「다 봤어요」를 누른 날에 남습니다. 다시 보면
                그 날짜로 옮겨 갑니다.
              </p>
            )}

            <Link
              href={`/learn/records?month=${view.key}#grid`}
              className="mt-4 inline-block text-sm text-pen underline underline-offset-4"
            >
              달력으로
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">최근 테스트</h2>
            <p className="mt-0.5 font-mono text-[11px] text-ink-soft">
              보고 있는 달과 무관한 최근 5건입니다.
            </p>
            {recentTests.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-rule bg-paper p-4 text-sm break-keep">
                아직 본 테스트가 없습니다. 테스트를 보면 여기에 결과가 쌓입니다.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recentTests.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-rule-soft bg-surface px-4 py-3"
                  >
                    <span className="min-w-0 text-sm break-keep">
                      {t.title}
                      <Link
                        href={`/learn/records?month=${t.day.slice(0, 7)}&day=${t.day}#day-detail`}
                        className="ml-2 font-mono text-xs text-pen underline underline-offset-4"
                      >
                        {formatIsoDay(t.day)}
                      </Link>
                      {t.attempt_no > 1 && (
                        <span className="ml-2 font-mono text-xs text-ink-soft">
                          {t.attempt_no}차 응시
                        </span>
                      )}
                      {t.status === "invalidated" && (
                        <span className="ml-2 rounded-[var(--radius-control)] border border-grade px-1.5 py-0.5 font-mono text-[11px] text-grade">
                          무효
                        </span>
                      )}
                    </span>
                    <Link
                      href={`/learn/results/${t.id}`}
                      className="shrink-0 rounded-[var(--radius-control)] border border-pen px-3 py-1.5 text-sm text-pen"
                    >
                      {t.total_score !== null
                        ? `결과 보기 (${trimScore(t.total_score)}/${trimScore(t.max_score)}점)`
                        : "결과 보기"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
