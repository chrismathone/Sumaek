import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSharedSql } from "@su-maek/db";
import { studentAnswer, type StudentAnswer } from "@su-maek/contracts";
import { renderMixedText } from "@su-maek/core/math";
import { getCurrentLearner } from "@/lib/auth/current-learner";
import { todayInKst } from "@/lib/format";
import { startAttempt } from "@/lib/domain/attempt";
import {
  AttemptRunner,
  type AttemptQuestion,
} from "@/components/runner/AttemptRunner";

export const metadata: Metadata = { title: "테스트 응시" };

/* 응시 화면 (18장) — 게시 스냅샷 기준. 시작 전 수식이 전부 게시 게이트를
 * 통과했는지 재확인하고, 실패 수식이 있으면 시험을 시작시키지 않는다. */

interface ContentRun {
  kind: "text" | "math";
  text?: string;
  math?: { latex: string };
}

function runsToText(runs: ContentRun[]): string {
  return runs
    .map((r) => (r.kind === "math" ? `$${r.math?.latex ?? ""}$` : (r.text ?? "")))
    .join("");
}

function bodyToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return body
    .map((block: { type?: string; text?: string; runs?: ContentRun[] }) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "paragraph") return runsToText(block.runs ?? []);
      return "";
    })
    .join("\n");
}

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: assessmentId } = await params;
  const learner = (await getCurrentLearner())!;
  const sql = getSharedSql();

  const started = await startAttempt({
    organizationId: learner.user.organizationId,
    assessmentId,
    learnerId: learner.learnerId,
    // 응시일 판정은 조직 시간대 기준 (UTC로 뽑으면 KST 00~09시에 하루 밀린다)
    today: todayInKst(),
  });
  if ("error" in started) {
    return (
      <div className="rounded-lg border border-rule bg-surface p-6 text-center">
        <p className="font-medium">{started.error}</p>
        <Link
          href="/learn/today"
          className="mt-3 inline-block text-sm text-pen underline underline-offset-4"
        >
          오늘 학습으로 돌아가기
        </Link>
      </div>
    );
  }
  if (started.status !== "in_progress") {
    redirect(`/learn/results/${started.attemptId}`);
  }

  const [assessment] = await sql<
    { title: string; time_limit_minutes: number | null }[]
  >`
    select title, time_limit_minutes from assessment_instances
    where id = ${assessmentId} and organization_id = ${learner.user.organizationId}
  `;
  if (!assessment) notFound();

  const rows = await sql<
    {
      aq_id: string;
      sort_order: number;
      points: string;
      body: unknown;
      choices: unknown;
      kind: string;
      saved_answer: unknown;
    }[]
  >`
    select aq.id as aq_id, aq.sort_order, aq.points::text,
           v.body, v.choices, q.kind, r.answer as saved_answer
    from assessment_questions aq
    join question_versions v on v.id = aq.question_version_id
    join questions q on q.id = aq.question_id
    left join responses r on r.assessment_question_id = aq.id
      and r.attempt_id = ${started.attemptId}
    where aq.assessment_id = ${assessmentId}
    order by aq.sort_order
  `;

  /* 게시 모드 렌더 — 실패 수식이 있으면 시험을 시작시키지 않는다 (18장) */
  const failures: string[] = [];
  const questions: AttemptQuestion[] = rows.map((row) => {
    const bodyResult = renderMixedText(bodyToText(row.body), "publish");
    failures.push(...bodyResult.failures);

    let choices: AttemptQuestion["choices"];
    if (Array.isArray(row.choices)) {
      choices = (row.choices as Array<{
        choiceId: string;
        order: number;
        content?: ContentRun[];
      }>).map((c) => {
        const rendered = renderMixedText(runsToText(c.content ?? []), "publish");
        failures.push(...rendered.failures);
        return { choiceId: c.choiceId, order: c.order, html: rendered.html };
      });
    }

    const savedParsed = studentAnswer.safeParse(row.saved_answer);
    return {
      assessmentQuestionId: row.aq_id,
      number: row.sort_order,
      kind: row.kind === "multiple_choice" ? "multiple_choice" : "short_answer",
      bodyHtml: bodyResult.html,
      ...(choices ? { choices } : {}),
      points: Number(row.points),
      savedAnswer: savedParsed.success ? (savedParsed.data as StudentAnswer) : null,
    };
  });

  if (failures.length > 0) {
    // 렌더 실패 감지 — 답안 보존, 문항 차단, 운영 알림 (18장)
    return (
      <div className="rounded-lg border border-grade bg-grade-soft p-6 text-center">
        <p className="font-medium text-grade">
          일부 문항의 수식 표시에 문제가 있어 시험을 시작할 수 없습니다.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          선생님과 운영팀에 자동으로 전달되었습니다. 잠시 후 다시 시도하세요.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-[MaruBuri] text-xl font-semibold">{assessment.title}</h1>
      <div className="mt-4">
        <AttemptRunner
          attemptId={started.attemptId}
          questions={questions}
          timeLimitMinutes={assessment.time_limit_minutes}
          startedAt={
            (
              await sql<{ started_at: Date | null }[]>`
                select started_at from attempts where id = ${started.attemptId}
              `
            )[0]?.started_at?.toISOString() ?? null
          }
        />
      </div>
    </div>
  );
}
