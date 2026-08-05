import { hideOverriddenMaterials } from "@su-maek/core/learning";
import { contentOrganizationIds } from "@su-maek/db";
import "server-only";
import { getSharedSql } from "@su-maek/db";
import { resolveAssessmentPolicy } from "@su-maek/db/domain";
import { BLOCK_REASONS, executeNodes } from "@su-maek/core/learning";

/* ─────────────────────────────────────────────────────────────
 * 학습 준비도 게이트 (T2.4).
 *
 * 결손이 **학생 화면에서 처음 드러나면 이미 수업 당일이다.** 문항 0개
 * 연습 자료를 게시할 수 있었고(G-06), 자료가 없는 개념 차시를 담은 루트를
 * 게시할 수 있었다. 학생은 「할 차례」를 눌러 빈 화면을 보고 자기가
 * 잘못한 줄 안다.
 *
 * 그래서 같은 판정을 **게시 전에** 돌린다. 판정 규칙을 새로 쓰지 않고
 * 노드 실행기(T2.2)를 그대로 부르는 것이 핵심이다 — 교사가 게시 전에 보는
 * 사유와 학생이 당일 만나는 사유가 다른 말이면 복구 링크를 이을 수 없다.
 * ───────────────────────────────────────────────────────────── */

/** 준비도·차단 사유의 **단일 레지스트리**. 학생 화면도 여기서 문구를 얻는다. */
export const READINESS_CODES = {
  [BLOCK_REASONS.materialMissing]: {
    student: "오늘 개념에 연결된 자료가 아직 없습니다.",
    teacher: "이 차시의 개념에 게시된 자료가 없습니다.",
    action: "개념에 읽기·인강·연습 자료를 붙이고 게시하세요.",
    href: "/app/content/materials",
  },
  [BLOCK_REASONS.noQuestions]: {
    student: "연습문제나 시험에 문항이 아직 등록되지 않았습니다.",
    teacher: "연습 자료에 문항이 0개입니다.",
    action: "문항을 연결하거나 자료를 초안으로 되돌리세요.",
    href: "/app/content/materials",
  },
  [BLOCK_REASONS.bookRangeIncomplete]: {
    student: "교재 범위가 아직 정해지지 않았습니다.",
    teacher: "교재 판본 또는 쪽 범위가 비어 있습니다.",
    action: "루트 빌더에서 교재와 시작·끝 쪽을 채우세요.",
    href: "/app/routes",
  },
  [BLOCK_REASONS.homeworkModeMissing]: {
    student: "숙제 방식이 아직 정해지지 않았습니다.",
    teacher: "숙제 노드에 방식(교재 쪽·연습문제)이 없습니다.",
    action: "루트 빌더에서 숙제 방식을 고르세요.",
    href: "/app/routes",
  },
  [BLOCK_REASONS.assessmentNotGenerated]: {
    student: "오늘 시험이 아직 만들어지지 않았습니다.",
    teacher: "예정된 평가가 아직 생성되지 않았습니다.",
    action: "생성 실패라면 재실행하세요.",
    href: "/app/tests",
  },
  [BLOCK_REASONS.unknownNodeKind]: {
    student: "지금 열 수 없는 항목이 있습니다.",
    teacher: "학생이 무엇을 해야 하는지 정의되지 않은 노드입니다.",
    action: "노드를 지우거나 알려진 종류로 바꾸세요.",
    href: "/app/routes",
  },
  /* 「블루프린트가 없다」는 사유는 **없앴다** (T3.3).
   *
   * 블루프린트는 생성기가 만드는 **산출물**이다 — 무엇을 왜 재려 했는지의
   * 기록. 교사가 고를 목록도, 만들 화면도 없다(실측: DB의 블루프린트 283건은
   * 전부 생성 결과이고, 평가 노드 1건은 blueprint_id가 NULL이다). 그런데
   * 게이트가 그것을 요구하면서 "루트 빌더에서 블루프린트를 고르세요"라고
   * 안내했다 — 있지도 않은 목록을 가리킨 것이다. 게다가 교사가 UUID를
   * 넣어도 생성기는 읽지 않았다.
   *
   * 없는 것을 요구하는 게이트는 막을 자격이 없다. 생성이 실제로 필요로 하는
   * 것(정책)만 남긴다. */
  no_assessment_policy: {
    student: "오늘 시험이 아직 만들어지지 않았습니다.",
    teacher:
      "이 반에 적용할 평가 정책이 없어 자동 생성이 돌 수 없습니다 (반 지정도, 학원 기본도 없음).",
    action: "반 설정에서 평가 정책을 지정하거나 학원 기본 정책을 만드세요.",
    href: "/app/classes",
  },
  account_unlinked: {
    student: "학습자 계정 연결이 끝나지 않았습니다.",
    teacher: "로그인 계정이 연결되지 않은 학생이 있습니다.",
    action: "학생 계정을 발급·연결하세요.",
    href: "/app/students",
  },
  rights_expired: {
    student: "교재 사용 권한이 만료되어 열 수 없습니다.",
    teacher: "사용 권한이 만료·중지된 교재를 참조합니다.",
    action: "권한을 갱신하거나 대체 자료로 바꾸세요.",
    href: "/app/content/books",
  },
} as const;

export type ReadinessCode = keyof typeof READINESS_CODES;

/** 학생 화면이 쓰는 문구 — 교사와 같은 표에서 얻는다 */
export function studentBlockText(code: string): string {
  return (
    READINESS_CODES[code as ReadinessCode]?.student ??
    READINESS_CODES[BLOCK_REASONS.unknownNodeKind].student
  );
}

/**
 * 교사 화면의 사유 문구 — 학생 문구와 **다른 말**을 쓴다.
 *
 * 학생에게는 「지금 열 수 없다」가 전부이고 조치가 없다. 교사에게는 무엇이
 * 비어 있는지가 곧 할 일이다. 같은 코드를 두 문구로 나눠 두는 이유가 그것이고,
 * 두 문구가 같은 레지스트리에 있어야 코드를 늘릴 때 한쪽만 빠뜨리지 않는다.
 */
export function teacherBlockText(code: string): string {
  return (
    READINESS_CODES[code as ReadinessCode]?.teacher ??
    READINESS_CODES[BLOCK_REASONS.unknownNodeKind].teacher
  );
}

export interface ReadinessFinding {
  code: ReadinessCode;
  /** `blocking`이면 게시를 막는다. `warning`은 남기되 막지 않는다. */
  severity: "blocking" | "warning";
  /** 무엇이 문제인지 — 화면에 그대로 보여 준다 */
  label: string;
  message: string;
  action: string;
  href: string;
}

export interface ReadinessReport {
  ok: boolean;
  blocking: ReadinessFinding[];
  warnings: ReadinessFinding[];
}

function finding(
  code: ReadinessCode,
  label: string,
  severity: ReadinessFinding["severity"] = "blocking",
): ReadinessFinding {
  const entry = READINESS_CODES[code];
  return {
    code,
    severity,
    label,
    message: entry.teacher,
    action: entry.action,
    href: entry.href,
  };
}

function report(findings: ReadinessFinding[]): ReadinessReport {
  const blocking = findings.filter((f) => f.severity === "blocking");
  return { ok: blocking.length === 0, blocking, warnings: findings.filter((f) => f.severity === "warning") };
}

/**
 * 자료 하나를 게시해도 되는가.
 *
 * 문항 0개 연습 자료가 게시되면 학생은 「할 차례」를 눌러 빈 화면을 본다.
 * 그 자료는 하루 완료를 영원히 막는다 — 학생이 손쓸 방법이 없다.
 */
export async function checkMaterialReadiness(input: {
  organizationId: string;
  materialId: string;
}): Promise<ReadinessReport> {
  const sql = getSharedSql();
  const [material] = await sql<
    { title: string; kind: string; question_ids: unknown }[]
  >`
    select title, kind::text as kind, question_ids
    from learning_materials
    where id = ${input.materialId} and organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
  `;
  if (!material) return report([]);

  const findings: ReadinessFinding[] = [];
  const questionCount = Array.isArray(material.question_ids)
    ? material.question_ids.length
    : 0;
  if (material.kind === "practice" && questionCount === 0) {
    findings.push(finding(BLOCK_REASONS.noQuestions, material.title));
  }
  return report(findings);
}

interface MaterialRow {
  /** 가리기 판정용 — 공용(플랫폼) 자료인지 우리 것인지 */
  organization_id: string;
  id: string;
  concept_id: string;
  kind: string;
  title: string;
  question_ids: unknown;
}

interface NodeRow {
  id: string;
  kind: string;
  title: string;
  concept_ids: unknown;
  book_edition_id: string | null;
  page_range: unknown;
  homework: unknown;
  blueprint_id: string | null;
}

/**
 * 루트 버전을 게시해도 되는가.
 *
 * 판정을 새로 쓰지 않고 **노드 실행기를 그대로 돌린다.** 실행기가 학생
 * 당일에 내는 차단과 여기서 교사가 보는 차단이 같은 코드여야 복구 링크가
 * 이어진다.
 *
 * 평가 노드만 예외다 — 게시 시점에 평가가 아직 없는 것은 정상이므로
 * (워커가 나중에 만든다) 실행기 대신 **참조가 갖춰졌는지**만 본다.
 */
export async function checkRouteReadiness(input: {
  organizationId: string;
  routeVersionId: string;
  /** 이 루트를 쓰는 반 — 평가 정책·계정 연결을 함께 본다 */
  learningGroupId?: string | null;
}): Promise<ReadinessReport> {
  const sql = getSharedSql();
  const nodes = await sql<NodeRow[]>`
    select id::text, kind::text as kind, title, concept_ids,
           book_edition_id::text, page_range, homework, blueprint_id::text
    from route_nodes
    where organization_id = ${input.organizationId}
      and route_version_id = ${input.routeVersionId}
    order by sort_order
  `;

  const conceptIds = [
    ...new Set(
      nodes.flatMap((n) =>
        Array.isArray(n.concept_ids)
          ? (n.concept_ids as unknown[]).filter((v): v is string => typeof v === "string")
          : [],
      ),
    ),
  ];

  const materials: MaterialRow[] =
    conceptIds.length === 0
      ? []
      : await sql<MaterialRow[]>`
          select id::text, concept_id::text, organization_id::text,
                 kind::text as kind, title, question_ids
          from learning_materials
          where organization_id = any(${contentOrganizationIds(input.organizationId)}::uuid[])
            and status = 'published'
            and concept_id = any(${conceptIds}::uuid[])
        `;

  /* 학원이 덮어쓴 개념·종류는 공용 자료를 뺀다 — **학생 화면과 같은 함수**다
   * (ADR-0020 갈래 C). 여기서 따로 세면 교사가 미리 본 필수 분모와 학생이
   * 만나는 필수 분모가 갈린다. */
  const visible = hideOverriddenMaterials(
    materials.map((m) => ({ ...m, organizationId: m.organization_id, conceptId: m.concept_id })),
    input.organizationId,
  );

  const byConcept = new Map<string, MaterialRow[]>();
  for (const m of visible) {
    const list = byConcept.get(m.concept_id) ?? [];
    list.push(m);
    byConcept.set(m.concept_id, list);
  }

  const findings: ReadinessFinding[] = [];
  const assessmentNodes = nodes.filter(
    (n) => n.kind === "daily_test" || n.kind === "confirmation_test",
  );

  /* 평가 노드 — 게시 시점에 평가가 **없는 것은 정상이다** (수업 하루 전에
   * 워커가 만든다). 검사하는 것은 그때 생성이 실제로 돌 수 있는가 하나다.
   *
   * 예전에는 `learning_groups.assessment_policy_id`가 비었는지만 봤다.
   * 그 컬럼은 실측으로 **모든 조직에서 100% NULL**이고 쓰는 코드도 없었으니,
   * 평가 노드가 든 루트는 무조건 막혔다. 그러면서 정작 생성기가 무엇으로
   * 낼지는 검사하지 않았다 — 막는 이유와 실패하는 이유가 달랐다.
   *
   * 이제 생성기와 **같은 함수**로 묻는다. 여기서 통과한 반은 그 목적의
   * 정책을 실제로 갖고 있다. */
  const purposes = new Set(
    assessmentNodes.map((n) =>
      n.kind === "daily_test" ? "formative" : "confirmation",
    ),
  );
  for (const purpose of [...purposes].sort()) {
    const resolved = await resolveAssessmentPolicy(sql, {
      organizationId: input.organizationId,
      learningGroupId: input.learningGroupId ?? null,
      purpose,
    });
    if (!resolved) {
      findings.push(
        finding(
          "no_assessment_policy",
          purpose === "formative" ? "일일테스트 정책" : "확인테스트 정책",
        ),
      );
    }
  }

  /* 나머지 — 실행기가 학생 당일에 낼 판정을 그대로 미리 돌린다. */
  const executable = nodes
    .filter((n) => !assessmentNodes.includes(n))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      bookEditionId: n.book_edition_id,
      pageRange: n.page_range as { startPage: number; endPage: number } | null,
      homework: n.homework as { mode: string; practiceMaterialId?: string } | null,
      blueprintId: n.blueprint_id,
      conceptIds: Array.isArray(n.concept_ids)
        ? (n.concept_ids as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    }));

  const executed = executeNodes(executable, (node) => {
    const own = executable.find((e) => e.id === node.id);
    const mine = (own?.conceptIds ?? []).flatMap((c) => byConcept.get(c) ?? []);
    return {
      materials: mine.map((m) => ({
        id: m.id,
        kind: m.kind as "reading" | "video" | "practice",
        title: m.title,
        questionCount: Array.isArray(m.question_ids) ? m.question_ids.length : 0,
        progress: "none" as const,
      })),
      assessment: null,
      /* 복습 노드는 그날의 기한에 달렸다 — 게시 시점에는 판단할 수 없으므로
       * 있다고 보고 넘긴다. 없는 날은 결손이 아니다(실행기 §복습). */
      dueReviewCount: 1,
      ordinalFrom: 0,
    };
  });

  for (const b of executed.blocked) {
    findings.push(finding(b.reason as ReadinessCode, b.title));
  }

  /* 자료의 문항 0개는 노드가 막히지 않아도 잡아야 한다 — 필수 항목 하나가
   * 차단으로 남으면 그 학생은 하루를 끝낼 수 없다. */
  for (const m of materials) {
    const count = Array.isArray(m.question_ids) ? m.question_ids.length : 0;
    if (m.kind === "practice" && count === 0) {
      findings.push(finding(BLOCK_REASONS.noQuestions, m.title));
    }
  }

  /* 계정 미연결은 **경고**다. 루트는 계정보다 먼저 준비될 수 있고, 게시를
   * 막으면 교사가 순서를 강제당한다. 다만 보이지 않으면 학생 로그인 날
   * 처음 안다. */
  if (input.learningGroupId) {
    const unlinked = await sql<{ display_name: string }[]>`
      select l.display_name
      from learning_group_memberships m
      join learners l on l.id = m.learner_id
      where m.organization_id = ${input.organizationId}
        and m.learning_group_id = ${input.learningGroupId}
        and m.status = 'active'
        and l.user_id is null
    `;
    for (const u of unlinked) {
      findings.push(finding("account_unlinked", u.display_name, "warning"));
    }
  }

  return report(dedupe(findings));
}

/** 같은 (코드, 대상)이 여러 노드에서 나오면 한 번만 말한다 */
function dedupe(findings: ReadinessFinding[]): ReadinessFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.code}:${f.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 게시 거부 문구 — 무엇이·왜·어디서 고치는지 한 줄에 담는다 */
export function blockingMessage(report: ReadinessReport): string {
  const first = report.blocking[0];
  if (!first) return "";
  const more =
    report.blocking.length > 1 ? ` 외 ${report.blocking.length - 1}건` : "";
  return `«${first.label}» ${first.message}${more} — ${first.action}`;
}
