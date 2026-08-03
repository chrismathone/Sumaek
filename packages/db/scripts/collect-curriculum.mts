/* ─────────────────────────────────────────────────────────────
 * 교육과정 권위 데이터 수집·적재 (인수 41·42·48의 선행 조건).
 *
 *   pnpm curriculum:collect
 *   pnpm curriculum:collect -- --text=본문.txt --hwp=별책8.hwp   # 오프라인 재적재
 *
 * 하는 일 (전부 멱등):
 *   1. 교육부 고시 제2022-33호 붙임2 zip 다운로드 (직링크 — 로그인 없음)
 *   2. [별책8] 수학과 교육과정.hwp 추출 + sha256 기록 (역추적 근거, 불변 16)
 *   3. HWP 본문에서 중학교 성취기준(9수XX-XX) 코드·문장 구조화
 *   4. 적재: 권위 소스 → 버전(KR-MATH-2022) → 릴리스(1, parsed) →
 *      공식 계층(중학교·영역 4) → 성취기준 60 → 적용 규칙(2026 중1·중2)
 *   5. RPM 1단원 개념 5개 ↔ 성취기준 사람 큐레이션 매핑 (인수 48 사슬)
 *
 * 정직성 원칙:
 *   - 릴리스는 published가 아니라 **parsed**다 — 발행 게이트(순환·중복·고아
 *     검사, 인수 43)는 별도 절차이고, 사람 원문 대조(verified)도 아직이다.
 *   - 2026학년도 중3은 2015 개정 적용인데 그 버전 데이터가 없으므로
 *     적용 규칙을 넣지 않는다 — 없는 것을 있다고 적지 않는다.
 *   - 파싱 이상(문장 미종결 등)은 건너뛰지 않고 목록으로 보고한다.
 *
 * HWP 해석은 packages/ingest/python/hwp-text.py가 담당 (olefile 필요).
 * ───────────────────────────────────────────────────────────── */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client.ts";
import {
  CATALOG_CONCEPTS,
  CATALOG_MAPPINGS,
} from "./data/middle-math-concept-catalog.mts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── 원문 좌표 (교육부 고시 제2022-33호) ── */
const NOTICE_PAGE_URL =
  "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=141&lev=0&statusYN=W&s=moe&m=0404&opType=N&boardSeq=93458";
const ATTACHMENT_URL =
  "https://www.moe.go.kr/boardCnts/fileDown.do?m=0404&s=moe&fileSeq=1512facbda6c234a1641ac7e9c156ca2";
const ZIP_MEMBER = "별책8";

/* ── 고정 ID — 전역 참조 데이터의 멱등 적재 (시드 관례) ── */
const SOURCE_ID = "00000000-0000-7000-8000-0000000c1001";
const VERSION_ID = "00000000-0000-7000-8000-0000000c1002";
const RELEASE_ID = "00000000-0000-7000-8000-0000000c1003";
const NODE_MIDDLE_ID = "00000000-0000-7000-8000-0000000c1010";
const DOMAIN_NODE_IDS: Record<string, string> = {
  "01": "00000000-0000-7000-8000-0000000c1011",
  "02": "00000000-0000-7000-8000-0000000c1012",
  "03": "00000000-0000-7000-8000-0000000c1013",
  "04": "00000000-0000-7000-8000-0000000c1014",
};
const DOMAIN_NAMES: Record<string, string> = {
  "01": "수와 연산",
  "02": "변화와 관계",
  "03": "도형과 측정",
  "04": "자료와 가능성",
};

/**
 * 개념 ↔ 성취기준 매핑은 사람 큐레이션 카탈로그가 담당한다 —
 * ./data/middle-math-concept-catalog.mts (성취기준 60개 전체 커버).
 * 카탈로그에 고정 ID가 없는 매핑은 code+slug에서 결정론적으로 만들어
 * 재실행이 같은 행을 갱신하게 한다.
 */
function stableMappingId(code: string, slug: string): string {
  const digest = createHash("sha256")
    .update(`su-maek:curriculum-mapping:${code}:${slug}`)
    .digest("hex");
  return (
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-` +
    `7${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  );
}

interface Args {
  text?: string;
  hwp?: string;
  python: string;
}

function parseArgs(): Args {
  const args: Args = { python: process.env.PYTHON ?? "python" };
  for (const raw of process.argv.slice(2)) {
    const match = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!match) {
      console.error(`알 수 없는 인자: ${raw} — --이름=값 형식만 받습니다`);
      process.exit(1);
    }
    if (match[1] === "text") args.text = match[2];
    if (match[1] === "hwp") args.hwp = match[2];
    if (match[1] === "python") args.python = match[2];
  }
  return args;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 다운로드 → HWP 추출 → 본문 텍스트. 오프라인 인자가 있으면 그걸 쓴다 */
async function acquire(args: Args): Promise<{
  text: string;
  hwpChecksum: string;
  zipChecksum: string | null;
}> {
  if (args.text && args.hwp) {
    return {
      text: readFileSync(args.text, "utf8"),
      hwpChecksum: sha256(readFileSync(args.hwp)),
      zipChecksum: null,
    };
  }

  console.log(`다운로드: ${ATTACHMENT_URL}`);
  const response = await fetch(ATTACHMENT_URL, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`고시 첨부 다운로드 실패: HTTP ${response.status}`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  if (zip.length < 1_000_000 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    throw new Error(
      `zip이 아닙니다 (${zip.length} bytes) — 교육부 게시글에서 fileSeq가 바뀌었는지 확인: ${NOTICE_PAGE_URL}`,
    );
  }
  const workDir = mkdtempSync(join(tmpdir(), "su-maek-curriculum-"));
  const zipPath = join(workDir, "notice.zip");
  const hwpPath = join(workDir, "math.hwp");
  const textPath = join(workDir, "math.txt");
  writeFileSync(zipPath, zip);
  console.log(`zip ${(zip.length / 1e6).toFixed(1)}MB, sha256 ${sha256(zip).slice(0, 16)}…`);

  const script = resolve(__dirname, "..", "..", "ingest", "python", "hwp-text.py");
  const run = spawnSync(
    args.python,
    [script, `--zip`, zipPath, `--member`, ZIP_MEMBER, `-o`, textPath, `-e`, hwpPath],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(
      `HWP 추출 실패 (${args.python}):\n${run.stderr || run.stdout}\n` +
        `파이썬과 olefile이 필요합니다: python -m pip install olefile`,
    );
  }
  console.log(run.stderr.trim());
  return {
    text: readFileSync(textPath, "utf8"),
    hwpChecksum: sha256(readFileSync(hwpPath)),
    zipChecksum: sha256(zip),
  };
}

interface ParsedStandard {
  code: string; // 9수01-01
  domainKey: string; // 01
  statement: string;
}

/** 본문에서 중학교 성취기준을 구조화 — 이상은 건너뛰지 않고 보고한다 */
function parseMiddleStandards(text: string): {
  standards: ParsedStandard[];
  anomalies: string[];
} {
  const codes = [...new Set(text.match(/\[9수\d{2}-\d{2}\]/g) ?? [])].sort();
  const standards: ParsedStandard[] = [];
  const anomalies: string[] = [];

  for (const bracketed of codes) {
    const code = bracketed.slice(1, -1);
    const domainKey = code.slice(2, 4);
    if (!DOMAIN_NAMES[domainKey]) {
      anomalies.push(`${code}: 모르는 영역 접두 ${domainKey}`);
      continue;
    }
    // 첫 등장 = 성취기준 본문 절 (해설 절은 뒤에 나온다)
    const start = text.indexOf(bracketed);
    const after = text.slice(start + bracketed.length);
    const nextBracket = after.search(/\[\d{1,2}[수공]/);
    const segment = (nextBracket === -1 ? after : after.slice(0, nextBracket)).trim();
    // 문장 끝(…다.)까지만 — 뒤에 붙는 소단원 머리글 조각을 버린다
    const lastEnd = segment.lastIndexOf("다.");
    if (lastEnd === -1) {
      anomalies.push(`${code}: 종결어미를 찾지 못함 — ${JSON.stringify(segment.slice(0, 60))}`);
      continue;
    }
    const statement = segment.slice(0, lastEnd + 2).replace(/\s+/g, " ").trim();
    if (statement.length < 10 || statement.length > 300) {
      anomalies.push(`${code}: 문장 길이 이상 (${statement.length}자)`);
      continue;
    }
    standards.push({ code, domainKey, statement });
  }
  return { standards, anomalies };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const { text, hwpChecksum, zipChecksum } = await acquire(args);
  const { standards, anomalies } = parseMiddleStandards(text);

  console.log(`\n중학교 성취기준 구조화: ${standards.length}개, 이상 ${anomalies.length}건`);
  for (const anomaly of anomalies) console.log(`  ! ${anomaly}`);
  if (standards.length < 50) {
    throw new Error(
      `성취기준이 ${standards.length}개뿐입니다 — 원문 형식이 바뀌었을 가능성. 적재를 중단합니다.`,
    );
  }

  const sql = createSql();
  try {
    await sql.begin(async (tx) => {
      /* 1. 권위 소스 — 체크섬은 취득한 실물 기준 (불변 16) */
      await tx`
        insert into curriculum_authority_sources (
          id, document_name, publisher_name, notice_number, original_url,
          file_checksum, acquired_at, effective_from, applies_to, review_status
        ) values (
          ${SOURCE_ID}, '[별책8] 수학과 교육과정', '교육부',
          '교육부 고시 제2022-33호', ${ATTACHMENT_URL},
          ${hwpChecksum}, now(), '2022-12-22', '초·중·고 수학과', 'registered'
        )
        on conflict (id) do update
        set file_checksum = excluded.file_checksum, acquired_at = now(),
            updated_at = now()
      `;

      /* 2. 버전·릴리스 — 릴리스는 parsed (발행 게이트는 별도 절차) */
      await tx`
        insert into curriculum_versions (id, code, name, status, primary_source_id)
        values (${VERSION_ID}, 'KR-MATH-2022', '2022 개정 수학과 교육과정', 'active', ${SOURCE_ID})
        on conflict (id) do nothing
      `;
      await tx`
        insert into curriculum_releases (
          id, curriculum_version_id, release_number, status, notes
        ) values (
          ${RELEASE_ID}, ${VERSION_ID}, 1, 'parsed',
          ${`고시문 자동 구조화 (zip sha256 ${zipChecksum ?? "오프라인 재적재"})`}
        )
        on conflict (id) do update set updated_at = now()
      `;

      /* 3. 공식 계층: 중학교 → 영역 4 */
      await tx`
        insert into official_curriculum_nodes (
          id, curriculum_version_id, release_id, parent_id, kind, official_name,
          sort_order, source_id, source_location
        ) values (
          ${NODE_MIDDLE_ID}, ${VERSION_ID}, ${RELEASE_ID}, null, 'school_level',
          '중학교', 1, ${SOURCE_ID}, '별책8 중학교 수학'
        )
        on conflict (id) do nothing
      `;
      for (const [key, nodeId] of Object.entries(DOMAIN_NODE_IDS)) {
        await tx`
          insert into official_curriculum_nodes (
            id, curriculum_version_id, release_id, parent_id, kind, official_name,
            sort_order, source_id, source_location
          ) values (
            ${nodeId}, ${VERSION_ID}, ${RELEASE_ID}, ${NODE_MIDDLE_ID}, 'domain',
            ${DOMAIN_NAMES[key]!}, ${Number(key)}, ${SOURCE_ID},
            ${`별책8 중학교 (${Number(key)}) ${DOMAIN_NAMES[key]}`}
          )
          on conflict (id) do nothing
        `;
      }

      /* 4. 성취기준 — 릴리스 내 코드 유니크가 중복을 강제 차단 */
      for (const standard of standards) {
        await tx`
          insert into achievement_standards (
            id, curriculum_version_id, release_id, official_node_id, code,
            statement, source_id, source_location
          ) values (
            ${uuidv7()}, ${VERSION_ID}, ${RELEASE_ID},
            ${DOMAIN_NODE_IDS[standard.domainKey]!}, ${standard.code},
            ${standard.statement}, ${SOURCE_ID}, '별책8 중학교 성취기준'
          )
          on conflict (release_id, code) do update
          set statement = excluded.statement, updated_at = now()
        `;
      }

      /* 5. 적용 규칙 — 2022 개정의 중학교 적용은 2025 중1부터 연차 확대.
       * 2026학년도: 중1·중2. **중3은 2015 개정인데 그 버전 데이터가 없어
       * 넣지 않는다** — 코드 상수 대신 이 규칙 테이블이 판정 근거다 (2K-5). */
      for (const [applicabilityId, gradeBand] of [
        ["00000000-0000-7000-8000-0000000c1021", "middle-1"],
        ["00000000-0000-7000-8000-0000000c1022", "middle-2"],
      ] as const) {
        await tx`
          insert into curriculum_applicabilities (
            id, curriculum_version_id, academic_year, school_level, grade_band, subject_code
          ) values (
            ${applicabilityId}, ${VERSION_ID}, 2026, 'middle', ${gradeBand}, 'math'
          )
          on conflict (academic_year, school_level, grade_band, subject_code) do nothing
        `;
      }

      /* 6a. 개념 카탈로그 — 기존 slug(RPM·시드)는 건드리지 않는다 */
      for (const concept of CATALOG_CONCEPTS) {
        await tx`
          insert into canonical_concepts (
            id, slug, name, description, curriculum_version_id,
            school_level, grade_band, domain_name, status, evidence
          ) values (
            ${uuidv7()}, ${concept.slug}, ${concept.name}, ${concept.description},
            ${VERSION_ID}, 'middle', ${concept.gradeBand}, ${concept.domainName},
            'active',
            ${tx.json([
              {
                kind: "document",
                source: "교육부 고시 제2022-33호 별책8",
                note: "성취기준 대응 교수 단위 개념 (사람 큐레이션 카탈로그)",
              },
            ] as never)}
          )
          on conflict (slug) do nothing
        `;
      }

      /* 6b. 개념 ↔ 성취기준 매핑 (사람 큐레이션) — 대상이 없으면 보고만 */
      for (const mapping of CATALOG_MAPPINGS) {
        const [concept] = await tx<{ id: string }[]>`
          select id from canonical_concepts where slug = ${mapping.conceptSlug}
        `;
        const [standard] = await tx<{ id: string }[]>`
          select id from achievement_standards
          where release_id = ${RELEASE_ID} and code = ${mapping.standardCode}
        `;
        if (!concept || !standard) {
          console.log(
            `  ! 매핑 건너뜀: ${mapping.conceptSlug} ↔ ${mapping.standardCode} (${!concept ? "개념 없음" : "성취기준 없음"})`,
          );
          continue;
        }
        const mappingId =
          mapping.mappingId ??
          stableMappingId(mapping.standardCode, mapping.conceptSlug);
        await tx`
          insert into curriculum_mappings (
            id, organization_id, official_type, official_id, internal_type,
            internal_id, relation_type, confidence, evidence, source_id,
            provenance, status
          ) values (
            ${mappingId}, null, 'achievement_standard', ${standard.id},
            'canonical_concept', ${concept.id}, ${mapping.relation}, 1.0,
            ${tx.json([
              {
                kind: "document",
                note: mapping.note,
                source:
                  "교육부 고시 제2022-33호 별책8 ↔ middle-math-concept-catalog.mts",
              },
            ] as never)},
            ${SOURCE_ID}, 'human', 'active'
          )
          on conflict (id) do update
          set relation_type = excluded.relation_type,
              evidence = excluded.evidence, updated_at = now()
        `;
      }
    });

    /* ── 검증 출력 — 적재 결과와 사슬을 실측으로 보여준다 ── */
    const byDomain = await sql<{ official_name: string; cnt: number }[]>`
      select n.official_name, count(s.id)::int as cnt
      from achievement_standards s
      join official_curriculum_nodes n on n.id = s.official_node_id
      where s.release_id = ${RELEASE_ID}
      group by n.official_name, n.sort_order order by n.sort_order
    `;
    console.log("\n영역별 성취기준:");
    for (const row of byDomain) console.log(`  ${row.official_name}: ${row.cnt}개`);

    const coverage = await sql<
      { total: number; mapped: number; concepts: number }[]
    >`
      select count(*)::int as total,
             count(*) filter (where exists (
               select 1 from curriculum_mappings m
               where m.official_type = 'achievement_standard'
                 and m.official_id = s.id and m.status = 'active'
             ))::int as mapped,
             (select count(distinct m.internal_id)::int from curriculum_mappings m
               join achievement_standards s2 on s2.id = m.official_id
               where m.official_type = 'achievement_standard'
                 and m.status = 'active' and s2.release_id = ${RELEASE_ID}) as concepts
      from achievement_standards s
      where s.release_id = ${RELEASE_ID}
    `;
    const cov = coverage[0]!;
    console.log(
      `\n매핑 커버리지: 성취기준 ${cov.mapped}/${cov.total} · 연결 개념 ${cov.concepts}개`,
    );
    if (cov.mapped < cov.total) {
      const unmapped = await sql<{ code: string }[]>`
        select code from achievement_standards s
        where s.release_id = ${RELEASE_ID}
          and not exists (
            select 1 from curriculum_mappings m
            where m.official_type = 'achievement_standard'
              and m.official_id = s.id and m.status = 'active'
          )
        order by code
      `;
      console.log(`  ! 미매핑: ${unmapped.map((u) => u.code).join(", ")}`);
    }

    const chain = await sql<
      { code: string; concepts: number; questions: number }[]
    >`
      select s.code,
             count(distinct m.internal_id)::int as concepts,
             count(distinct qa.question_id)::int as questions
      from achievement_standards s
      join curriculum_mappings m
        on m.official_type = 'achievement_standard' and m.official_id = s.id
       and m.status = 'active'
      join question_alignments qa on qa.concept_id = m.internal_id
      where s.release_id = ${RELEASE_ID}
      group by s.code order by s.code
    `;
    console.log("\n문항까지 잇긴 성취기준 (반입 문항 보유분):");
    for (const row of chain) {
      console.log(`  [${row.code}] 개념 ${row.concepts} · 문항 ${row.questions}`);
    }
    console.log(
      `\n원문 역추적: ${ATTACHMENT_URL}\n  hwp sha256 ${hwpChecksum}\n` +
        `릴리스 상태: parsed — 발행 게이트·사람 원문 대조(verified)는 별도 절차`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[curriculum:collect] 실패:", error instanceof Error ? error.message : error);
  process.exit(1);
});
