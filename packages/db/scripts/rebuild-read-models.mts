import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { v7 as uuidv7 } from "uuid";
import {
  DEFAULT_MASTERY_POLICY,
  estimateMastery,
  type MasteryEvidenceInput,
  type MasteryPolicySpec,
} from "@su-maek/core/mastery";
import { createSql } from "../src/client";

/**
 * 읽기 모델 재생성.
 *
 *   node scripts/rebuild-read-models.mjs
 *   node scripts/rebuild-read-models.mjs --dry-run
 *   node scripts/rebuild-read-models.mjs --org <uuid> --learner <uuid>
 *
 * 근거: docs/phase0/backup-recovery.md 2.1(재생성 가능 계층)·3.1 R-7·5.1 V-10,
 *       docs/runbooks/05-db-failure-pitr.md 6장 V-9,
 *       docs/runbooks/README.md 10장
 *
 * 이 저장소의 유일한 파생 읽기 모델은 **개념 숙련도**(concept_masteries)다.
 * MasteryEvidence(불변 원본) + 활성 정책 + cutoff으로 언제든 재현된다 (불변 조건 11).
 * 다른 파생물(math_render_artifacts·document_exports)은 각자의 파이프라인이
 * 재생성하며 이 스크립트의 범위가 아니다.
 *
 * 설계 결정 두 가지:
 * 1. **cutoff은 DB 시계(now())로 잡는다.** 로컬 시계와 DB 시계가 어긋나면 방금
 *    들어온 증거가 조용히 빠진다 — apps/web의 recomputeMastery와 같은 규약이다.
 * 2. **MasteryUpdated 이벤트를 발행하지 않는다.** 대량 재생성에서 이벤트를 쏘면
 *    schedule.recalculate·review.plan이 연쇄로 터진다(EVENT_CONSUMERS 참고).
 *    재생성은 파생값을 원본과 맞추는 작업이지 새로운 사실이 아니다.
 */

interface Options {
  org: string | null;
  learner: string | null;
  dryRun: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(): void {
  console.log("사용: node scripts/rebuild-read-models.mjs [--org <uuid>] [--learner <uuid>] [--dry-run]");
  console.log("");
  console.log("  --dry-run  다시 계산만 하고 쓰지 않는다. 저장값과 다른 건수를 보고한다");
  console.log("             (backup-recovery.md V-10 '원본과 표본 대조'를 이걸로 한다)");
}

function parseOptions(argv: string[]): Options {
  const options: Options = { org: null, learner: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "help") {
      usage();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (arg === "--org" || arg === "--learner") {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} 에 값이 없습니다.`);
      }
      if (!UUID_RE.test(value)) {
        throw new Error(`${arg} 값이 UUID가 아닙니다: ${value}`);
      }
      if (arg === "--org") options.org = value;
      else options.learner = value;
      i += 1;
      continue;
    }
    throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

interface Pair {
  organization_id: string;
  learner_id: string;
  concept_id: string;
}

interface EvidenceRow {
  id: string;
  evidence_date: string;
  occurred_at: Date;
  signal: MasteryEvidenceInput["signal"];
  mapping_confidence: string | null;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sql = createSql();

  try {
    // cutoff은 DB 시계 기준. +1초 여유는 같은 순간에 들어온 증거를 포함시키기 위한 것.
    const [clock] = await sql<{ as_of: Date }[]>`select now() + interval '1 second' as as_of`;
    const asOf = (clock?.as_of ?? new Date()).toISOString();

    console.log("─".repeat(72));
    console.log("읽기 모델 재생성 — 개념 숙련도 (concept_masteries)");
    console.log(`범위    : org=${options.org ?? "전체"}  learner=${options.learner ?? "전체"}`);
    console.log(`cutoff  : ${asOf} (DB 시계)`);
    console.log(`모드    : ${options.dryRun ? "dry-run (쓰지 않음)" : "실제 갱신"}`);
    console.log("─".repeat(72));

    const pairs = await sql<Pair[]>`
      select distinct e.organization_id, e.learner_id, e.concept_id
      from mastery_evidences e
      where (${options.org}::uuid is null or e.organization_id = ${options.org}::uuid)
        and (${options.learner}::uuid is null or e.learner_id = ${options.learner}::uuid)
      order by e.organization_id, e.learner_id, e.concept_id
    `;

    if (pairs.length === 0) {
      console.log("재계산 대상 증거가 없습니다.");
      return;
    }
    console.log(`대상 (학습자 × 개념) 조합: ${pairs.length}건`);
    console.log("");

    /* 정책은 조직당 한 번만 읽는다 — 조합마다 읽으면 쿼리 수가 선형으로 는다. */
    const policyCache = new Map<string, { id: string | null; spec: MasteryPolicySpec }>();
    async function policyFor(organizationId: string) {
      const cached = policyCache.get(organizationId);
      if (cached) return cached;
      const [row] = await sql<{ id: string; spec: MasteryPolicySpec }[]>`
        select id, spec from mastery_policy_versions
        where organization_id = ${organizationId} and is_active = true
        order by version desc limit 1
      `;
      const policy = row ?? { id: null, spec: DEFAULT_MASTERY_POLICY };
      policyCache.set(organizationId, policy);
      return policy;
    }

    let changed = 0;
    let created = 0;
    let unchanged = 0;
    let skipped = 0;
    const stateCounts = new Map<string, number>();
    const changes: string[] = [];

    for (const pair of pairs) {
      const policy = await policyFor(pair.organization_id);

      /* 최종 확정된 채점에서 나온 증거만 반영한다 (불변 조건 10). */
      const evidences = await sql<EvidenceRow[]>`
        select e.id, e.evidence_date::text, e.occurred_at, e.signal,
               e.mapping_confidence::text
        from mastery_evidences e
        left join grade_decisions d on d.id = e.grade_decision_id
        where e.organization_id = ${pair.organization_id}
          and e.learner_id = ${pair.learner_id}
          and e.concept_id = ${pair.concept_id}
          and e.occurred_at <= ${asOf}
          and (e.grade_decision_id is null or d.is_final = true)
      `;

      const inputs: MasteryEvidenceInput[] = evidences.map((e) => ({
        evidenceId: e.id,
        evidenceDate: e.evidence_date,
        occurredAt: new Date(e.occurred_at).toISOString(),
        signal: e.signal,
        mappingConfidence: e.mapping_confidence ? Number(e.mapping_confidence) : 1,
      }));
      const [current] = await sql<
        { state: string; evidence_count: number; point_estimate: string | null }[]
      >`
        select state::text, evidence_count, point_estimate::text
        from concept_masteries
        where learner_id = ${pair.learner_id} and concept_id = ${pair.concept_id}
      `;

      /*
       * 쓸 수 있는 증거가 하나도 없고 기존 행도 없으면 건너뛴다.
       * 대상 목록은 mastery_evidences에서 뽑지만 최종 확정된 채점의 증거만
       * 반영하므로(불변 조건 10), 확정 전이거나 채점 결정이 사라진 증거만 가진
       * 조합이 여기로 온다. 그런 조합에 no_evidence 행을 새로 만들면 "근거 없음"이
       * 실제 판단인 것처럼 보인다 — 아무것도 모른다는 사실은 행이 없는 것으로 둔다.
       * (증거가 사라져 0이 된 기존 행은 아래에서 정상적으로 no_evidence로 갱신된다.)
       */
      if (inputs.length === 0 && !current) {
        skipped += 1;
        continue;
      }

      const estimate = estimateMastery(inputs, policy.spec, asOf);
      stateCounts.set(estimate.state, (stateCounts.get(estimate.state) ?? 0) + 1);

      const differs =
        !current ||
        current.state !== estimate.state ||
        current.evidence_count !== estimate.evidenceCount;

      if (!current) created += 1;
      else if (differs) changed += 1;
      else unchanged += 1;

      if (differs && changes.length < 20) {
        changes.push(
          `  ${pair.learner_id.slice(-8)} × ${pair.concept_id.slice(-8)}: ` +
            `${current ? `${current.state}(증거 ${current.evidence_count})` : "(행 없음)"}` +
            ` → ${estimate.state}(증거 ${estimate.evidenceCount})`,
        );
      }

      if (options.dryRun) continue;

      await sql`
        insert into concept_masteries (
          id, organization_id, learner_id, concept_id, state, point_estimate,
          uncertainty, evidence_count, distinct_days, last_evidence_at,
          dimensions, next_check, policy_version_id, evidence_cutoff_at
        ) values (
          ${uuidv7()}, ${pair.organization_id}, ${pair.learner_id}, ${pair.concept_id},
          ${estimate.state}, ${estimate.pointEstimate}, ${estimate.uncertainty},
          ${estimate.evidenceCount}, ${estimate.distinctDays},
          ${estimate.lastEvidenceAt ? new Date(estimate.lastEvidenceAt) : null},
          ${sql.json(estimate.dimensions as never)},
          ${sql.json(estimate.nextCheck as never)},
          ${policy.id}, ${new Date(asOf)}
        )
        on conflict (learner_id, concept_id) do update set
          state = excluded.state,
          point_estimate = excluded.point_estimate,
          uncertainty = excluded.uncertainty,
          evidence_count = excluded.evidence_count,
          distinct_days = excluded.distinct_days,
          last_evidence_at = excluded.last_evidence_at,
          dimensions = excluded.dimensions,
          next_check = excluded.next_check,
          policy_version_id = excluded.policy_version_id,
          evidence_cutoff_at = excluded.evidence_cutoff_at,
          updated_at = now()
      `;
    }

    console.log("결과");
    console.log("");
    console.log(`  신규 생성 : ${created}`);
    console.log(`  값 변경   : ${changed}`);
    console.log(`  동일      : ${unchanged}`);
    if (skipped > 0) {
      console.log(`  건너뜀    : ${skipped} (확정 채점 증거가 없는 조합 — 행을 만들지 않는다)`);
    }
    console.log("");
    console.log("  상태 분포:");
    for (const [state, count] of [...stateCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${state.padEnd(20)} ${String(count).padStart(6)}`);
    }

    if (changes.length > 0) {
      console.log("");
      console.log(`  달라진 항목 (최대 20건):`);
      for (const line of changes) console.log(line);
    }

    console.log("");
    if (options.dryRun) {
      const drift = created + changed;
      console.log(
        drift === 0
          ? "✓ dry-run — 저장된 읽기 모델이 원본 증거와 일치합니다 (V-10 통과)."
          : `✗ dry-run — ${drift}건이 원본과 어긋납니다. --dry-run 없이 다시 실행하세요.`,
      );
      process.exit(drift === 0 ? 0 : 1);
    }
    console.log("✓ 재생성 완료. MasteryUpdated 이벤트는 발행하지 않았습니다 (연쇄 재계산 방지).");
    console.log("  검증: node scripts/rebuild-read-models.mjs --dry-run 이 0건이면 정합입니다.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`[rebuild-read-models] ${error instanceof Error ? error.message : String(error)}`);
  console.error("");
  usage();
  process.exit(1);
});
