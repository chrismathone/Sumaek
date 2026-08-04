import Link from "next/link";
import {
  blockReasonText,
  type BlockCategory,
  type GroupDayProgress,
  type LearnerDayStatus,
} from "@/lib/domain/day-progress";

/* ─────────────────────────────────────────────────────────────
 * 반별 오늘 진행 (T4.4).
 *
 * 서른 줄을 그냥 늘어놓지 않는다. 완주한 스물여덟 명이 막힌 두 명을 덮기
 * 때문이다 — 화면이 커도 정보는 줄어든다. 그래서 **수는 한 줄로 접고,
 * 먼저 볼 학생만 이름으로 편다.**
 *
 * 반 수업 마감과 학생 완료를 나란히 두되 **다른 칸**에 둔다. 서른 명이 다
 * 끝냈어도 교사가 마감하지 않았으면 반 수업은 끝나지 않은 것이고, 반이
 * 마감됐어도 학생 하루는 각자다 (I-21 · ADR-0017 §1).
 * ───────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<LearnerDayStatus, string> = {
  completed: "완료",
  in_progress: "진행 중",
  blocked: "막힘",
  not_started: "미시작",
  no_record: "기록 없음",
};

/** 갈래마다 교사가 갈 곳이 다르다 — 「막힘 2명」만으로는 아무것도 못 한다. */
const CATEGORY_HREF: Record<BlockCategory, string | null> = {
  material: "/app/content/materials",
  question: "/app/content/questions",
  assessment: "/app/tests",
  account: "/app/students",
  rights: "/app/content/books",
  unknown: null,
};

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="font-mono text-xs text-ink-soft">
      {label} <span className="font-bold text-ink">{value}</span>
    </span>
  );
}

function GroupCard({ group }: { group: GroupDayProgress }) {
  const { summary, session } = group;
  const needsAttention = summary.attention.length > 0;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={`/app/classes/${group.learningGroupId}`}
          className="font-medium break-keep underline underline-offset-4"
        >
          {group.learningGroupName}
        </Link>
        {/* 반 수업은 학생 완료와 다른 칸이다 */}
        <span className="font-mono text-xs text-ink-soft">
          {session === null
            ? "오늘 수업 없음"
            : session.status === "completed"
              ? "수업 마감됨"
              : "수업 미마감"}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        <Count label="완료" value={summary.counts.completed} />
        <Count label="진행" value={summary.counts.in_progress} />
        <Count label="막힘" value={summary.counts.blocked} />
        <Count label="미시작" value={summary.counts.not_started} />
        {/* 기록 없음을 미시작에 합치지 않는다 — 대개 로그인 문제다 */}
        <Count label="기록 없음" value={summary.counts.no_record} />
      </div>

      {summary.blocked.length > 0 && (
        <ul className="mt-2 space-y-1">
          {summary.blocked.map((b) => {
            const href = CATEGORY_HREF[b.category];
            return (
              <li key={b.code} className="text-sm break-keep">
                <span className="font-mono text-xs text-grade">
                  {b.learners}명
                </span>{" "}
                {blockReasonText(b.code)}
                {href && (
                  <>
                    {" "}
                    <Link href={href} className="text-pen underline underline-offset-4">
                      고치러 가기
                    </Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {needsAttention && (
        <p className="mt-2 text-sm break-keep text-ink-soft">
          먼저 볼 학생:{" "}
          {summary.attention.slice(0, 5).map((r, i) => (
            <span key={r.learnerId}>
              {i > 0 && " · "}
              <Link
                href={`/app/students/${r.learnerId}`}
                className="underline underline-offset-4"
              >
                {r.displayName}
              </Link>
              <span className="ml-1 font-mono text-xs">
                {STATUS_LABEL[r.status]}
              </span>
            </span>
          ))}
          {summary.attention.length > 5 &&
            ` 외 ${summary.attention.length - 5}명`}
        </p>
      )}
    </li>
  );
}

export function DayProgress({ groups }: { groups: GroupDayProgress[] }) {
  if (groups.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-rule bg-surface p-5 text-sm text-ink-soft">
        운영 중인 반에 등록된 학생이 없습니다.
      </p>
    );
  }

  return (
    <>
      <p className="mt-1 text-sm text-ink-soft">
        학생이 오늘 화면을 열면 그날 계획이 확정되고, 필수를 모두 마치면 서버가
        완료를 기록합니다. <strong>「기록 없음」은 미시작과 다릅니다</strong> —
        그 학생은 오늘 화면을 한 번도 열지 않았습니다.
      </p>
      <ul className="mt-3 divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
        {groups.map((g) => (
          <GroupCard key={g.learningGroupId} group={g} />
        ))}
      </ul>
    </>
  );
}
