import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import {
  DEFAULT_PROMOTION_CRITERIA,
  type ModelRole,
} from "@su-maek/core/ai";
import { getSharedSql } from "../src/client";
import {
  EXTRACT_QUESTIONS_OPERATION,
  evaluateCanaryPromotion,
  haltCanary,
  listModelVersions,
  promoteCanary,
  registerModelVersion,
} from "../src/domain/ai-canary";

/**
 * AI 모델 카나리 운영 CLI (인수 36).
 *
 *   pnpm ai-canary list     --org <uuid>
 *   pnpm ai-canary register --org <uuid> --provider mock --model mock-extractor-v2 --role canary
 *   pnpm ai-canary status   --org <uuid>
 *   pnpm ai-canary promote  --org <uuid> --actor ops@example.com
 *   pnpm ai-canary halt     --org <uuid> --reason "정답 불일치 급증" --actor ops@example.com
 *
 * 화면이 아니라 CLI인 이유: 모델 롤아웃은 조직 관리자가 아니라 플랫폼
 * 운영자의 일이다 (`pnpm kill-switch`·`pnpm requeue-dlq`와 같은 계열).
 * 섀도 자체를 급히 멈춰야 하면 `pnpm kill-switch stop ai_model_canary`가 있다.
 *
 * **승격 우회 플래그는 없다.** 게이트가 막으면 막힌 것이다.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  org: string | null;
  operation: string;
  provider: string;
  model: string | null;
  role: string;
  reason: string | null;
  actor: string | null;
  notes: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    org: null,
    operation: EXTRACT_QUESTIONS_OPERATION,
    provider: "mock",
    model: null,
    role: "canary",
    reason: null,
    actor: null,
    notes: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    switch (argv[i]) {
      case "--org":
        options.org = next ?? null;
        i++;
        break;
      case "--operation":
        options.operation = next ?? options.operation;
        i++;
        break;
      case "--provider":
        options.provider = next ?? options.provider;
        i++;
        break;
      case "--model":
        options.model = next ?? null;
        i++;
        break;
      case "--role":
        options.role = next ?? options.role;
        i++;
        break;
      case "--reason":
        options.reason = next ?? null;
        i++;
        break;
      case "--actor":
        options.actor = next ?? null;
        i++;
        break;
      case "--notes":
        options.notes = next ?? null;
        i++;
        break;
      default:
        break;
    }
  }
  return options;
}

function usage(): void {
  console.log("사용:");
  console.log("  pnpm ai-canary list     --org <uuid>");
  console.log(
    "  pnpm ai-canary register --org <uuid> --provider <이름> --model <모델> [--role candidate|canary|active] [--notes <메모>]",
  );
  console.log("  pnpm ai-canary status   --org <uuid> [--operation <작업>]");
  console.log("  pnpm ai-canary promote  --org <uuid> [--actor <이메일|uuid>]");
  console.log(
    "  pnpm ai-canary halt     --org <uuid> --reason <사유> [--actor <이메일|uuid>]",
  );
  console.log("");
  console.log(`  기본 --operation 은 ${EXTRACT_QUESTIONS_OPERATION} 입니다.`);
  console.log("");
  console.log("승격 기준 (전부 통과해야 승격):");
  console.log(`  표본        ≥ ${DEFAULT_PROMOTION_CRITERIA.minSamples}건`);
  console.log(`  평균 일치도 ≥ ${DEFAULT_PROMOTION_CRITERIA.minAgreement}`);
  console.log(
    `  실패율      ≤ ${(DEFAULT_PROMOTION_CRITERIA.maxErrorRate * 100).toFixed(1)}%`,
  );
  console.log(
    `  p95 지연    ≤ 기준선 × ${DEFAULT_PROMOTION_CRITERIA.maxLatencyP95Ratio} + ${DEFAULT_PROMOTION_CRITERIA.latencyToleranceMs}ms`,
  );
  console.log(`  비용        ≤ 기준선 × ${DEFAULT_PROMOTION_CRITERIA.maxCostRatio}배`);
  console.log("");
  console.log("섀도 자체를 멈추려면: pnpm kill-switch stop ai_model_canary");
}

async function resolveActor(
  sql: ReturnType<typeof getSharedSql>,
  actor: string | null,
): Promise<string | null> {
  if (!actor) return null;
  if (UUID_RE.test(actor)) return actor;
  const [user] = await sql<{ id: string }[]>`
    select id from users where lower(email) = lower(${actor}) limit 1
  `;
  // 못 찾아도 실패시키지 않는다 — 감사 기록의 actor_id만 비운다.
  return user?.id ?? null;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  const options = parseOptions(rest);
  if (options.org === null || !UUID_RE.test(options.org)) {
    throw new Error("--org <uuid> 가 필요합니다.");
  }
  const org = options.org;

  // 도메인 함수들과 같은 공유 풀을 쓴다 — CLI라 프로세스 끝에서 닫는다.
  const sql = getSharedSql();
  try {
    const actorUserId = await resolveActor(sql, options.actor);

    switch (command) {
      case "list": {
        const rows = await listModelVersions({
          organizationId: org,
          operation: options.operation,
        });
        if (rows.length === 0) {
          console.log("등록된 모델 버전이 없습니다.");
          console.log(
            "레지스트리가 비어 있으면 공급자 기본 모델로 동작합니다 (섀도 없음).",
          );
          break;
        }
        console.log(
          `  ${"role".padEnd(10)} ${"provider".padEnd(14)} ${"model".padEnd(24)} 사유`,
        );
        for (const row of rows) {
          console.log(
            `  ${row.role.padEnd(10)} ${row.provider.padEnd(14)} ${row.model.padEnd(24)} ${row.haltReason ?? "-"}`,
          );
        }
        break;
      }

      case "register": {
        if (!options.model) throw new Error("--model 이 필요합니다.");
        const result = await registerModelVersion({
          organizationId: org,
          operation: options.operation,
          provider: options.provider,
          model: options.model,
          role: options.role as ModelRole,
          actorUserId,
          notes: options.notes ?? undefined,
        });
        console.log(result.ok ? `완료: ${result.message}` : `실패: ${result.message}`);
        if (!result.ok) process.exitCode = 1;
        break;
      }

      case "status": {
        const evaluation = await evaluateCanaryPromotion({
          organizationId: org,
          operation: options.operation,
        });
        if (!evaluation.canary) {
          console.log("카나리가 없습니다 — 섀도 표본이 쌓이지 않습니다.");
          break;
        }
        const { canary, metrics, decision } = evaluation;
        console.log(`카나리: ${canary.provider}:${canary.model}`);
        console.log(`  표본        : ${metrics.samples}건 (실패 ${metrics.errorCount}건)`);
        console.log(
          `  평균 일치도 : ${metrics.meanAgreement === null ? "-" : metrics.meanAgreement.toFixed(3)}`,
        );
        console.log(
          `  p95 지연    : 카나리 ${Math.round(metrics.canaryLatencyP95Ms)}ms / 기준선 ${Math.round(metrics.baselineLatencyP95Ms)}ms`,
        );
        console.log(
          `  비용        : 카나리 $${metrics.canaryCostUsd.toFixed(4)} / 기준선 $${metrics.baselineCostUsd.toFixed(4)}${metrics.costPriced ? "" : "  ※ 가격표에 없는 모델"}`,
        );
        console.log("");
        console.log(decision.summary);
        for (const failure of decision.failures) {
          console.log(`  - [${failure.criterion}] ${failure.message}`);
        }
        break;
      }

      case "promote": {
        const result = await promoteCanary({
          organizationId: org,
          operation: options.operation,
          actorUserId,
        });
        console.log(result.ok ? `완료: ${result.message}` : `차단: ${result.message}`);
        if (!result.ok) process.exitCode = 1;
        break;
      }

      case "halt": {
        if (!options.reason) throw new Error("--reason <사유> 가 필요합니다.");
        const result = await haltCanary({
          organizationId: org,
          operation: options.operation,
          reason: options.reason,
          actorUserId,
        });
        console.log(result.ok ? `완료: ${result.message}` : `실패: ${result.message}`);
        if (!result.ok) process.exitCode = 1;
        break;
      }

      default:
        usage();
        throw new Error(`알 수 없는 명령입니다: ${command}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[ai-canary] 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});
