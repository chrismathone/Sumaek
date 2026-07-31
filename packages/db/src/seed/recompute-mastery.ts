import { config } from "dotenv";
config({ path: [".env", "../../.env"] });
import { v7 as uuidv7 } from "uuid";
import {
  DEFAULT_MASTERY_POLICY,
  estimateMastery,
  type MasteryEvidenceInput,
  type MasteryPolicySpec,
} from "@su-maek/core/mastery";
import { createSql } from "../client";

/**
 * 숙련도 전체 재계산 백필 — ConceptMastery는 증거+정책으로 언제든 재현
 * 가능한 파생이다 (불변 조건 11). 실행: pnpm --filter @su-maek/db recompute-mastery
 */
async function main(): Promise<void> {
  const sql = createSql();
  const asOf = new Date(Date.now() + 1000).toISOString();

  const pairs = await sql<
    { organization_id: string; learner_id: string; concept_id: string }[]
  >`
    select distinct organization_id, learner_id, concept_id from mastery_evidences
  `;

  for (const pair of pairs) {
    const [policyRow] = await sql<{ id: string; spec: MasteryPolicySpec }[]>`
      select id, spec from mastery_policy_versions
      where organization_id = ${pair.organization_id} and is_active = true
      order by version desc limit 1
    `;
    const policy = policyRow ?? { id: null, spec: DEFAULT_MASTERY_POLICY };

    const evidences = await sql<
      {
        id: string;
        evidence_date: string;
        occurred_at: Date;
        signal: MasteryEvidenceInput["signal"];
        mapping_confidence: string | null;
      }[]
    >`
      select e.id, e.evidence_date::text, e.occurred_at, e.signal, e.mapping_confidence::text
      from mastery_evidences e
      left join grade_decisions d on d.id = e.grade_decision_id
      where e.learner_id = ${pair.learner_id} and e.concept_id = ${pair.concept_id}
        and (e.grade_decision_id is null or d.is_final = true)
    `;
    const inputs: MasteryEvidenceInput[] = evidences.map((e) => ({
      evidenceId: e.id,
      evidenceDate: e.evidence_date,
      occurredAt: new Date(e.occurred_at).toISOString(),
      signal: e.signal,
      mappingConfidence: e.mapping_confidence ? Number(e.mapping_confidence) : 1,
    }));
    const est = estimateMastery(inputs, policy.spec, asOf);

    await sql`
      insert into concept_masteries (
        id, organization_id, learner_id, concept_id, state, point_estimate,
        uncertainty, evidence_count, distinct_days, last_evidence_at,
        dimensions, next_check, policy_version_id, evidence_cutoff_at
      ) values (
        ${uuidv7()}, ${pair.organization_id}, ${pair.learner_id}, ${pair.concept_id},
        ${est.state}, ${est.pointEstimate}, ${est.uncertainty},
        ${est.evidenceCount}, ${est.distinctDays},
        ${est.lastEvidenceAt ? new Date(est.lastEvidenceAt) : null},
        ${sql.json(est.dimensions as never)}, ${sql.json(est.nextCheck as never)},
        ${policy.id}, ${new Date(asOf)}
      )
      on conflict (learner_id, concept_id) do update set
        state = excluded.state, point_estimate = excluded.point_estimate,
        uncertainty = excluded.uncertainty, evidence_count = excluded.evidence_count,
        distinct_days = excluded.distinct_days, last_evidence_at = excluded.last_evidence_at,
        dimensions = excluded.dimensions, next_check = excluded.next_check,
        policy_version_id = excluded.policy_version_id,
        evidence_cutoff_at = excluded.evidence_cutoff_at, updated_at = now()
    `;
    console.log(`[recompute] ${pair.learner_id.slice(-4)} × ${pair.concept_id.slice(-4)} → ${est.state} (증거 ${est.evidenceCount})`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
