import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "../src/client";

/**
 * 테스트가 남긴 **불변 조건 위반** 잔재 정리 (T6.4).
 *
 *   pnpm --filter @su-maek/db exec tsx scripts/purge-invariant-residue.mts --dry-run
 *   pnpm --filter @su-maek/db exec tsx scripts/purge-invariant-residue.mts
 *
 * `purge-test-data`와 다른 일을 한다. 그쪽은 「테스트가 만든 행」을 이름
 * 규칙으로 지운다. 여기서 지우는 것은 **불변 조건을 어기는 상태**다 —
 * 대개 테스트가 제품 코드를 우회해 만든 것이고, 남아 있으면
 * `pnpm verify:recovery`가 영구히 빨간불이 된다.
 *
 * 늘 빨간 게이트는 아무도 읽지 않는다. 그래서 원인은 각 테스트에서 고치고
 * (픽스처를 유효하게, 뒷정리를 빠짐없이), 이미 쌓인 것은 이 스크립트가
 * 한 번 치운다. 다시 쌓이면 그때는 **새로 생긴 원인**이라는 뜻이다.
 *
 * ── 지우지 않는 것 ────────────────────────────────────────
 * 증거는 건드리지 않는다. `mastery_evidences`·`grade_decisions`·
 * `progress_events`·`audit_events`는 append-only이고, 그것이 옳다. 응답이나
 * 채점 결정이 붙은 응시도 지우지 않는다 — 그건 잔재가 아니라 기록이다.
 */

const dryRun = process.argv.includes("--dry-run");
/** 데모 워크스페이스 — 개발기에서 테스트가 가장 많이 드나드는 조직 */
const DEMO_ORG = "00000000-0000-7000-8000-000000000001";
const sql = createSql();

interface Step {
  id: string;
  what: string;
  count: () => Promise<number>;
  run: () => Promise<number>;
}

const steps: Step[] = [
  {
    id: "I-09",
    what: "같은 평가·학습자에 둘 이상 남은 미제출 응시 → invalidated",
    /* 제품 코드는 이 상태를 만들지 않는다 — `startAttempt`가 기존 응시를
     * 돌려주기 때문이다. 남아 있는 것은 응시 행을 직접 넣는 테스트의 흔적이다.
     *
     * 지우지 않고 `invalidated`로 내린다: 제품이 「시작했다가 만 응시」를
     * 부르는 이름이 그것이고, 기록을 없애는 것보다 상태를 맞추는 편이 맞다.
     * 채점 결정이 붙은 응시는 손대지 않는다(그건 기록이다). 테스트 조직으로
     * 범위를 좁힌다 — 운영 데이터를 스크립트가 고치는 일은 없어야 한다. */
    count: async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from attempts a
          join organizations o on o.id = a.organization_id
          where a.status = 'in_progress'
            and (o.slug like 'itest-%' or o.slug like 'e2e-auto-%'
                 or o.status = 'archived' or o.id = ${DEMO_ORG})
            and exists (
              select 1 from attempts b
              where b.assessment_id = a.assessment_id
                and b.learner_id = a.learner_id and b.id <> a.id
            )
            and not exists (
              select 1 from grade_decisions d
              join responses r on r.id = d.response_id
              where r.attempt_id = a.id
            )
        `
      )[0]!.n,
    run: async () =>
      (
        await sql`
          update attempts a
          set status = 'invalidated', updated_at = now()
          from organizations o
          where o.id = a.organization_id
            and a.status = 'in_progress'
            and (o.slug like 'itest-%' or o.slug like 'e2e-auto-%'
                 or o.status = 'archived' or o.id = ${DEMO_ORG})
            and exists (
              select 1 from attempts b
              where b.assessment_id = a.assessment_id
                and b.learner_id = a.learner_id and b.id <> a.id
            )
            and not exists (
              select 1 from grade_decisions d
              join responses r on r.id = d.response_id
              where r.attempt_id = a.id
            )
        `
      ).count,
  },
  {
    id: "I-08a",
    what: "게시 상태인데 게시 시각이 없는 평가 — 시각을 채운다",
    /* 지우지 않고 **채운다.** 응시·응답이 붙어 있을 수 있고, 그것은 기록이다.
     * 게시된 것은 사실이므로 빠진 시각을 만들어 준 시각으로 둔다. */
    count: async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from assessment_instances
          where status in ('published','open','closed','grading','finalized')
            and published_at is null
        `
      )[0]!.n,
    run: async () =>
      (
        await sql`
          update assessment_instances
          set published_at = coalesce(published_at, created_at, now())
          where status in ('published','open','closed','grading','finalized')
            and published_at is null
        `
      ).count,
  },
  {
    id: "I-08b",
    what: "원본 버전과 다른 스냅샷 체크섬 — 원본 값으로 맞춘다",
    /* 문항 버전은 불변이므로 원본이 정답이다. 스냅샷 쪽이 틀린 값을 들고
     * 있는 경우뿐이고(테스트가 아무 문자열을 넣었다), 실제 출제 내용은
     * `question_version_id`가 가리키는 그대로다. */
    count: async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n
          from assessment_questions aq
          join question_versions qv on qv.id = aq.question_version_id
          join assessment_instances ai on ai.id = aq.assessment_id
          where ai.status in ('published','open','closed','grading','finalized')
            and aq.content_checksum <> qv.content_checksum
        `
      )[0]!.n,
    run: async () =>
      (
        await sql`
          update assessment_questions aq
          set content_checksum = qv.content_checksum
          from question_versions qv, assessment_instances ai
          where qv.id = aq.question_version_id
            and ai.id = aq.assessment_id
            and ai.status in ('published','open','closed','grading','finalized')
            and aq.content_checksum <> qv.content_checksum
        `
      ).count,
  },
  {
    id: "I-11",
    what: "증거는 있는데 숙련도 행이 없는 (학습자·개념) — 파생을 다시 만든다",
    /* 파생이 지워진 것이므로 다시 만든다. 정확한 재계산은
     * `pnpm rebuild:readmodels`가 하고, 여기서는 **행이 없는 것**만 센다.
     * 지우는 것이 아니라 보고만 한다 — 잘못된 값을 넣느니 비어 있는 편이 낫다. */
    count: async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from (
            select e.learner_id, e.concept_id
            from mastery_evidences e
            left join grade_decisions d on d.id = e.grade_decision_id
            where (e.grade_decision_id is null or d.is_final = true)
              and not exists (
                select 1 from concept_masteries cm
                where cm.learner_id = e.learner_id and cm.concept_id = e.concept_id
              )
            group by 1, 2
          ) t
        `
      )[0]!.n,
    run: async () => 0,
  },
  {
    id: "R-04",
    what: "소비자 작업 없이 배달 완료로 남은 이벤트 (작업이 지워진 흔적)",
    /* 이벤트를 지운다. 작업이 이미 없으므로 재배달할 대상도 없고, 남겨 두면
     * 「사슬이 끊겼다」는 신호가 영구히 켜진 채로 진짜 단절을 가린다.
     * 살아 있는 조직의 이벤트는 건드리지 않는다 — 테스트 조직만. */
    count: async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from outbox_events e
          join organizations o on o.id = e.organization_id
          where e.status = 'delivered' and e.delivered_at is not null
            and (o.slug like 'itest-%' or o.slug like 'e2e-auto-%' or o.status = 'archived')
            and not exists (
              select 1 from jobs j where j.idempotency_key like '%:' || e.id::text
            )
        `
      )[0]!.n,
    run: async () =>
      (
        await sql`
          delete from outbox_events e
          using organizations o
          where o.id = e.organization_id
            and e.status = 'delivered' and e.delivered_at is not null
            and (o.slug like 'itest-%' or o.slug like 'e2e-auto-%' or o.status = 'archived')
            and not exists (
              select 1 from jobs j where j.idempotency_key like '%:' || e.id::text
            )
        `
      ).count,
  },
];

try {
  console.log(
    dryRun
      ? "[불변 잔재] DRY RUN — 세기만 한다"
      : "[불변 잔재] 정리 실행",
  );
  console.log("");
  for (const step of steps) {
    const before = await step.count();
    if (before === 0) {
      console.log(`  ${step.id.padEnd(6)} 0건 — ${step.what}`);
      continue;
    }
    if (dryRun) {
      console.log(`  ${step.id.padEnd(6)} ${before}건 — ${step.what}`);
      continue;
    }
    const touched = await step.run();
    const after = await step.count();
    console.log(
      `  ${step.id.padEnd(6)} ${before}건 → ${after}건 (처리 ${touched}행) — ${step.what}`,
    );
    if (after > 0 && touched === 0) {
      console.log(`         ↳ 이 검사는 자동으로 고치지 않는다. 아래 안내 참고.`);
    }
  }
  console.log("");
  console.log("숙련도 파생(I-11)이 남아 있으면: pnpm rebuild:readmodels");
  console.log("정리 후 확인: pnpm verify:recovery");
} finally {
  await sql.end();
}
