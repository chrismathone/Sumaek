import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "../src/client.ts";
import {
  CurriculumProcedureError,
  publishCurriculumRelease,
  verifyAuthoritySource,
  type PublishGateFindings,
} from "../src/domain/curriculum-release.ts";

/**
 * 교육과정 릴리스 운영 CLI (인수 41 잔여 · 43).
 *
 *   pnpm curriculum:release status
 *   pnpm curriculum:release verify-source --checksum <sha256 앞 12자 이상> --by <이메일>
 *   pnpm curriculum:release publish [--dry-run] --by <이메일>
 *
 * verify-source는 **사람 절차의 기록**이다 — 도구가 원문 대조를 대신하지
 * 않는다. 절차: ① status로 저장된 sha256과 원문 URL을 확인 ② 원문을 열어
 * 성취기준 표본을 화면(콘텐츠→교육과정)과 대조 ③ 취득 실물의 sha256
 * 앞자리를 --checksum으로 입력. 앞자리가 저장값과 다르면 거부된다.
 *
 * publish는 발행 게이트(순환·고아·근거 없는 개념·AI 위장·중복 코드·
 * 원문 verified·매핑 커버리지·kill switch)를 전부 통과해야 전이한다.
 * 실패해도 리포트는 릴리스 행에 남는다 — 화면과 다음 시도의 근거.
 */

const DEFAULT_SOURCE_ID = "00000000-0000-7000-8000-0000000c1001";
const DEFAULT_RELEASE_ID = "00000000-0000-7000-8000-0000000c1003";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  source: string;
  release: string;
  checksum: string | null;
  by: string | null;
  dryRun: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    source: DEFAULT_SOURCE_ID,
    release: DEFAULT_RELEASE_ID,
    checksum: null,
    by: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    // pnpm 중첩 실행(run → exec)이 구분자 --를 그대로 넘긴다
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (["--source", "--release", "--checksum", "--by"].includes(arg)) {
      if (value === undefined || value.startsWith("--")) {
        throw new CurriculumProcedureError(`${arg} 에 값이 없습니다.`);
      }
      if (arg === "--source") options.source = value;
      if (arg === "--release") options.release = value;
      if (arg === "--checksum") options.checksum = value;
      if (arg === "--by") options.by = value;
      i += 1;
      continue;
    }
    throw new CurriculumProcedureError(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

async function resolveActor(
  sql: ReturnType<typeof createSql>,
  actor: string | null,
): Promise<{ actorId: string | null; label: string }> {
  if (!actor) return { actorId: null, label: "(미지정)" };
  if (UUID_RE.test(actor)) return { actorId: actor, label: actor };
  const [user] = await sql<{ id: string }[]>`
    select id from users where lower(email) = lower(${actor}) limit 1
  `;
  return { actorId: user?.id ?? null, label: actor };
}

function usage(): void {
  console.log("사용:");
  console.log("  pnpm curriculum:release status  [--source <uuid>] [--release <uuid>]");
  console.log("  pnpm curriculum:release verify-source --checksum <sha256 앞 12자+> --by <이메일> [--source <uuid>]");
  console.log("  pnpm curriculum:release publish [--dry-run] --by <이메일> [--release <uuid>]");
  console.log("");
  console.log("기본 대상: 교육부 고시 제2022-33호 별책8 소스 · KR-MATH-2022 릴리스 1");
}

async function runStatus(
  sql: ReturnType<typeof createSql>,
  options: Options,
): Promise<void> {
  const [source] = await sql<
    {
      document_name: string;
      original_url: string;
      file_checksum: string | null;
      review_status: string;
      acquired_at: Date | null;
    }[]
  >`
    select document_name, original_url, file_checksum,
           review_status::text as review_status, acquired_at
    from curriculum_authority_sources where id = ${options.source}
  `;
  const [release] = await sql<
    {
      status: string;
      release_number: number;
      published_at: Date | null;
      validation_report: {
        checkedAt?: string;
        dryRun?: boolean;
        findings?: PublishGateFindings;
      } | null;
      version_code: string;
    }[]
  >`
    select r.status::text as status, r.release_number, r.published_at,
           r.validation_report, v.code as version_code
    from curriculum_releases r
    join curriculum_versions v on v.id = r.curriculum_version_id
    where r.id = ${options.release}
  `;

  console.log("── 권위 소스 ──");
  if (!source) {
    console.log(`  없음 (${options.source}) — pnpm curriculum:collect 먼저`);
  } else {
    console.log(`  문서   : ${source.document_name}`);
    console.log(`  원문   : ${source.original_url}`);
    console.log(`  sha256 : ${source.file_checksum ?? "(체크섬 없음)"}`);
    console.log(`  취득   : ${source.acquired_at?.toISOString() ?? "-"}`);
    console.log(`  대조   : ${source.review_status}${source.review_status === "registered" ? " — 사람 원문 대조 전 (verify-source)" : ""}`);
  }
  console.log("── 릴리스 ──");
  if (!release) {
    console.log(`  없음 (${options.release})`);
    return;
  }
  console.log(`  버전   : ${release.version_code} 릴리스 ${release.release_number}`);
  console.log(`  상태   : ${release.status}${release.published_at ? ` (발행 ${release.published_at.toISOString()})` : ""}`);
  const report = release.validation_report;
  if (report?.findings) {
    const f = report.findings;
    console.log(`  게이트 : ${f.ok ? "통과" : "실패"} (${report.checkedAt ?? "?"}${report.dryRun ? ", dry-run" : ""})`);
    const blockers: string[] = [];
    if (f.sourcesNotVerified.length) blockers.push(`원문 미대조 ${f.sourcesNotVerified.length}`);
    if (f.unmappedStandardCodes.length) blockers.push(`미매핑 성취기준 ${f.unmappedStandardCodes.length}`);
    if (f.duplicateStandardCodes.length) blockers.push(`중복 코드 ${f.duplicateStandardCodes.length}`);
    if (f.prerequisiteCycles.length) blockers.push(`선수 순환 ${f.prerequisiteCycles.length}`);
    if (f.orphanEdges.length) blockers.push(`고아 간선 ${f.orphanEdges.length}`);
    if (f.conceptsWithoutEvidence.length) blockers.push(`근거 없는 개념 ${f.conceptsWithoutEvidence.length}`);
    if (f.aiEdgesMasqueradingAsActive.length) blockers.push(`AI 위장 간선 ${f.aiEdgesMasqueradingAsActive.length}`);
    if (f.deprecatedConceptsInUse.length) blockers.push(`사용 중 폐기 개념 ${f.deprecatedConceptsInUse.length}`);
    if (f.killSwitchBlocked) blockers.push("kill switch 중지 중");
    if (blockers.length) console.log(`  차단   : ${blockers.join(" · ")}`);
    console.log(`  범위   : 성취기준 ${f.scope.standards} · 개념 ${f.scope.concepts} · 간선 ${f.scope.edges}`);
  } else {
    console.log("  게이트 : 아직 실행 전 (publish --dry-run)");
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    usage();
    process.exit(command ? 0 : 2);
  }

  const sql = createSql();
  try {
    const options = parseOptions(rest);

    if (command === "status") {
      await runStatus(sql, options);
      return;
    }

    if (command === "verify-source") {
      if (!options.checksum) {
        throw new CurriculumProcedureError(
          "--checksum 이 필요합니다 — 실물과 대조한 sha256 앞 12자 이상.",
        );
      }
      if (!options.by) {
        throw new CurriculumProcedureError(
          "--by 가 필요합니다 — 대조를 수행한 사람 (이메일 또는 uuid).",
        );
      }
      const { actorId, label } = await resolveActor(sql, options.by);
      if (!actorId) {
        throw new CurriculumProcedureError(
          `수행자를 users에서 찾을 수 없습니다: ${options.by} — 대조 기록에는 실계정이 필요합니다.`,
        );
      }
      const result = await verifyAuthoritySource(sql, {
        sourceId: options.source,
        checksumConfirmation: options.checksum,
        reviewerId: actorId,
        reviewerLabel: label,
      });
      if (result.alreadyVerified) {
        console.log(`${result.documentName} — 이미 verified 입니다 (변경 없음).`);
      } else {
        console.log(`${result.documentName} — verified로 승격했습니다.`);
        console.log(`  sha256 : ${result.fileChecksum}`);
        console.log(`  수행자 : ${label}`);
        console.log("  audit_events에 action='curriculum.source_verify'로 기록했습니다.");
      }
      return;
    }

    if (command === "publish") {
      const { actorId, label } = await resolveActor(sql, options.by);
      if (!options.dryRun && !actorId) {
        throw new CurriculumProcedureError(
          "발행에는 --by (users의 실계정) 가 필요합니다. 게이트만 보려면 --dry-run.",
        );
      }
      const outcome = await publishCurriculumRelease(sql, {
        releaseId: options.release,
        publishedBy: actorId,
        actorLabel: label,
        dryRun: options.dryRun,
      });
      console.log(
        outcome.transitioned
          ? `발행 완료: ${outcome.statusBefore} → published`
          : outcome.ok
            ? `게이트 통과 (dry-run — 상태 유지: ${outcome.statusAfter})`
            : `발행 차단 — 상태 유지: ${outcome.statusAfter}`,
      );
      const f = outcome.findings;
      console.log(`  범위: 성취기준 ${f.scope.standards} · 개념 ${f.scope.concepts} · 간선 ${f.scope.edges}`);
      const failures: string[] = [];
      if (f.sourcesNotVerified.length) {
        failures.push(
          `원문 미대조: ${f.sourcesNotVerified.map((s) => `${s.documentName}(${s.reviewStatus})`).join(", ")} → verify-source 먼저`,
        );
      }
      if (f.unmappedStandardCodes.length) failures.push(`미매핑 성취기준: ${f.unmappedStandardCodes.join(", ")}`);
      if (f.duplicateStandardCodes.length) failures.push(`중복 코드: ${f.duplicateStandardCodes.join(", ")}`);
      if (f.prerequisiteCycles.length) failures.push(`선수 순환: ${f.prerequisiteCycles.map((c) => c.path.join("→")).join(" / ")}`);
      if (f.orphanEdges.length) failures.push(`고아 간선 ${f.orphanEdges.length}건 (존재하지 않는 개념을 가리킴)`);
      if (f.conceptsWithoutEvidence.length) failures.push(`근거 없는 개념 ${f.conceptsWithoutEvidence.length}건`);
      if (f.aiEdgesMasqueradingAsActive.length) failures.push(`AI 제안이 active로 위장한 간선 ${f.aiEdgesMasqueradingAsActive.length}건`);
      if (f.deprecatedConceptsInUse.length) failures.push(`사용 중인 폐기 개념 ${f.deprecatedConceptsInUse.length}건`);
      if (f.killSwitchBlocked) failures.push("kill switch curriculum_release 가 중지 중 (pnpm kill-switch resume curriculum_release)");
      for (const failure of failures) console.log(`  ✗ ${failure}`);
      console.log("  리포트를 릴리스 validation_report에 저장했습니다 (status로 확인).");
      if (!outcome.ok) process.exit(1);
      return;
    }

    throw new CurriculumProcedureError(`알 수 없는 명령입니다: ${command}`);
  } catch (error) {
    if (error instanceof CurriculumProcedureError) {
      console.error(`[curriculum:release] ${error.message}`);
      process.exit(1);
    }
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[curriculum:release] 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});
