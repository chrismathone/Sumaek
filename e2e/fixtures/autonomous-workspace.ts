import { config } from "dotenv";
import {
  accountsOfOrganization,
  createSql,
  dropAccounts,
  purgeOrganizationRows,
  AUTONOMOUS_SLUG_PREFIX,
  type Sql,
} from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * 자율 E2E 워크스페이스 (T6.2 · G-10).
 *
 * 「빈 학원이 스스로 학생의 하루까지 도달하는가」를 보려면 **시드가 없는
 * 조직**에서 출발해야 한다. 데모 조직으로 확인하면 이 스펙은 아무것도
 * 증명하지 못한다 — 과정 기간·반·루트·평가가 이미 다 있기 때문이다.
 *
 * 여기서 만드는 것은 **제품에 만들 화면이 없는 것들뿐**이다:
 *
 *   1. 조직           — 가입 화면이 없다 (운영자가 계약과 함께 연다)
 *   2. 원장 계정      — 같은 이유. 학생 계정은 **교사가 화면에서 발급한다**
 *                       (T5.2)이므로 여기서 만들지 않는다 — 스펙이 그 화면을
 *                       실제로 눌러야 발급 경로가 검증된다.
 *   3. 문제은행       — 실제 경로는 교재 반입(OCR·AI)이다. E2E가 돌릴 수
 *                       없으므로 「학원이 이미 가진 문항」으로 놓는다.
 *
 * 그 밖의 모든 것 — 과정 기간·반·학생·계정·자료·루트·일정·평가 — 은
 * 스펙이 **화면에서** 만든다. 픽스처가 대신 만들면 그 화면은 검증되지 않는다.
 *
 * ── 개념을 새로 만들지 않는 이유 ──────────────────────────
 * `canonical_concepts`에는 조직 컬럼이 없다(국가 교육과정이라 학원마다
 * 다르지 않다). 실행마다 개념을 만들면 **모든 학원의** 개념 선택 목록에
 * 테스트 찌꺼기가 쌓인다 — 실측으로 190건까지 간 적이 있다. 새 학원이
 * 공용 교육과정을 쓰는 것이 실제 제품 동작이므로, 이미 있는 개념 중
 * 하나를 골라 쓴다.
 *
 * ── 뒷정리의 한계 ────────────────────────────────────────
 * 조직 행 자체는 지울 수 없다. 학생이 하루를 마치면 `progress_events`·
 * `audit_events`가 남고 그것들은 삭제가 트리거로 금지돼 있다(불변 조건 15).
 * 지울 수 있는 것만 지우고, 남는 조직은 `purgeTestData`가 세어 보고한다.
 * ───────────────────────────────────────────────────────────── */

/* 조직 표식과 회수 절차는 `@su-maek/db`의 purge-workspace가 갖는다 —
 * `pnpm purge:test-data`와 이 픽스처가 **같은 코드**로 치워야 한다. 각자
 * 적으면 한쪽만 고쳐지고, 그 차이는 조직 목록이 늘어난 뒤에야 드러난다. */
export { AUTONOMOUS_SLUG_PREFIX };

export interface AutonomousQuestion {
  /** 본문에 답이 적혀 있다 — 스펙이 화면에서 읽어 그대로 답한다 */
  ordinal: number;
  answer: string;
}

export interface AutonomousWorkspace {
  organizationId: string;
  /** 이번 실행을 다른 실행과 가르는 짧은 꼬리표 — 이름 충돌을 막는다 */
  stamp: string;
  teacher: { email: string; password: string; userId: string };
  /** 오늘 배울 개념 — 루트 노드·자료·문항이 전부 이 개념에 붙는다 */
  concept: { id: string; name: string };
  questions: AutonomousQuestion[];
}

/** 개발 시드와 같은 형식의 비밀번호 (Supabase 기본 정책을 통과한다) */
const TEACHER_PASSWORD = "1234@@@@";

/**
 * 문항 난이도 — 기본 일일테스트 정책의 배분(low 2 · mid 5 · high 1)을
 * 흉내 낸다. 배분은 **soft** 제약이라 못 맞춰도 생성은 되지만, 맞춰 두면
 * 「배분 때문에 못 골랐다」는 다른 실패와 섞이지 않는다.
 */
const QUESTION_BANDS = ["low", "low", "mid", "mid", "mid", "high"] as const;

function loadEnv(): void {
  config({ path: ["../.env", ".env"] });
}

/** Supabase admin REST — supabase-js를 e2e에 들이지 않기 위해 fetch로 직접 */
async function supabaseAdmin<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "자율 E2E에는 Supabase URL과 service_role 키가 필요합니다 (.env).",
    );
  }
  const response = await fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Supabase admin ${path} 실패 (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * 화면에서 **이름으로 집을 수 있고**, 혼자서도 루트가 되는 개념을 고른다.
 *
 * 세 조건이 있다.
 *   ① 루트 빌더의 개념 목록은 이름순 100개로 잘린다 — 그 안에 있어야 한다.
 *   ② 그 목록 안에서 이름이 **유일**해야 한다. 같은 이름이 둘이면
 *      Playwright가 strict mode로 죽는다.
 *   ③ 승인된 **강한 선수 개념이 없어야** 한다. 있으면 루트 검증이
 *      PREREQUISITE_GAP으로 막아 게시까지 갈 수 없다 — 실측으로 첫 실행이
 *      「가감법」을 골라 여기서 멈췄다. 선수를 함께 넣어 루트를 키우는
 *      길도 있지만, 그러면 픽스처가 교육과정 모양에 따라 커진다.
 *
 * 이름을 스펙에 박지 않고 여기서 골라 돌려주므로 교육과정이 바뀌어도
 * 스펙은 그대로다.
 */
async function pickConcept(sql: Sql): Promise<{ id: string; name: string }> {
  const rows = await sql<{ id: string; name: string }[]>`
    select c.id::text as id, c.name from canonical_concepts c
    where c.status in ('reviewed', 'active')
      and not exists (
        select 1 from concept_edges e
        where e.to_concept_id = c.id
          and e.kind = 'prerequisite'
          and e.status in ('reviewed', 'active')
          and e.provenance <> 'ai_suggested'
      )
    order by c.name limit 100
  `;
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  const unique = rows.find(
    (r) => seen.get(r.name) === 1 && /^[가-힣a-zA-Z0-9 ()·]+$/.test(r.name),
  );
  if (!unique) {
    throw new Error(
      "루트 빌더 목록(이름순 100개) 안에 이름이 유일한 개념이 없습니다 — 교육과정을 먼저 반입하세요.",
    );
  }
  return unique;
}

/**
 * 빈 워크스페이스를 연다. 조직·원장 계정·문제은행만 만든다.
 *
 * 실행마다 **새 조직**이다. 고정 조직을 재사용하면 두 번째 실행부터는
 * 「빈 학원」이 아니고(증거 행은 지울 수 없다), `--repeat-each`가 검증하는
 * 것이 첫 실행과 달라진다.
 */
export async function createAutonomousWorkspace(): Promise<AutonomousWorkspace> {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("자율 E2E에는 DATABASE_URL이 필요합니다 (.env).");
  }
  const sql = createSql();
  try {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const organizationId = crypto.randomUUID();
    const email = `e2e-auto-${stamp}@su-maek.test`;

    const concept = await pickConcept(sql);

    const created = await supabaseAdmin<{ id: string }>("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: TEACHER_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: "자율 E2E 원장" },
      }),
    });

    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${organizationId}, ${`E2E자율-${stamp}`},
              ${`${AUTONOMOUS_SLUG_PREFIX}${stamp}`}, 'Asia/Seoul')
    `;
    /* auth 트리거가 public.users를 만들지만 기본 워크스페이스는 비어 있다 —
     * 채우지 않으면 로그인 직후 「소속 워크스페이스가 없습니다」로 끝난다. */
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${created.id}, ${email}, '자율 E2E 원장', ${organizationId})
      on conflict (id) do update
        set default_organization_id = excluded.default_organization_id
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status, joined_at)
      values (${crypto.randomUUID()}, ${organizationId}, ${created.id},
              'owner', 'active', now())
    `;

    /* 문제은행 — 사용권 한 건 아래 문항 여섯 개. 전부 같은 개념에 붙는다.
     * 생성기의 `maxPerConcept: 3` 때문에 실제로 출제되는 것은 셋이다. */
    const contentRightId = crypto.randomUUID();
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${contentRightId}, ${organizationId}, '자율 E2E', 'usable')
    `;

    const questions: AutonomousQuestion[] = [];
    for (const [index, band] of QUESTION_BANDS.entries()) {
      const ordinal = index + 1;
      const answer = String(ordinal);
      const questionId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      await sql`
        insert into questions (
          id, organization_id, kind, review_status, content_right_id,
          is_auto_assignable, current_version_id)
        values (${questionId}, ${organizationId}, 'short_answer', 'published',
                ${contentRightId}, true, ${versionId})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer,
          points, difficulty, content_checksum)
        values (
          ${versionId}, ${organizationId}, ${questionId}, 1,
          ${sql.json([
            { type: "text", text: `자율 E2E 문항 ${ordinal} — 답은 ${answer}입니다.` },
          ] as never)},
          ${sql.json({
            kind: "short_answer",
            accepted: [{ value: answer, form: "number" }],
          } as never)},
          '10', ${sql.json({ band } as never)},
          ${`e2e-auto-${stamp}-${ordinal}`})
      `;
      await sql`
        insert into question_alignments (
          id, organization_id, question_id, concept_id, weight)
        values (${crypto.randomUUID()}, ${organizationId}, ${questionId},
                ${concept.id}, 1)
      `;
      questions.push({ ordinal, answer });
    }

    return {
      organizationId,
      stamp,
      teacher: { email, password: TEACHER_PASSWORD, userId: created.id },
      concept,
      questions,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * 워크스페이스를 접는다 — **지울 수 있는 것만**.
 *
 * 조직 행은 남는다. 학생이 하루를 마치면 `progress_events`·`audit_events`가
 * 남고, 그 삭제는 트리거가 막는다(불변 조건 15). 로그인 계정은 지운다 —
 * 그것이 유일하게 조직 밖으로 새는 것이기 때문이다(전역 auth 테이블).
 *
 * 실패해도 던지지 않는다. 뒷정리가 테스트 결과를 뒤집으면 무엇이 깨졌는지
 * 알 수 없게 된다.
 */
export async function dropAutonomousWorkspace(
  workspace: Pick<AutonomousWorkspace, "organizationId">,
): Promise<void> {
  loadEnv();
  if (!process.env.DATABASE_URL) return;
  const sql = createSql();
  try {
    /* 계정을 **먼저** 찾아 둔다 — 아래 정리가 소속을 지우고 나면 못 찾는다 */
    const authIds = await accountsOfOrganization(sql, workspace.organizationId);
    await purgeOrganizationRows(sql, workspace.organizationId);
    await dropAccounts(sql, authIds);
    /* 조직 행까지 지워 본다 — 증거가 남지 않은 실행(픽스처만 세우고 끝난
     * 경우)은 흔적 없이 사라진다. 학생이 하루를 마친 실행은 감사·진도
     * 기록이 참조하고 있어 여기서 막힌다. 막히는 것이 맞다. */
    try {
      await sql`delete from organizations where id = ${workspace.organizationId}`;
    } catch {
      /* 증거가 남았다 — 조직은 그대로 둔다 (purge:test-data가 센다) */
    }
  } catch (error) {
    console.error("[autonomous] 정리 실패:", (error as Error).message);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
