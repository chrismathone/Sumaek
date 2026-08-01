import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  AiProviderUnavailableError,
  CircuitOpenError,
  DEFAULT_BREAKER_OPTIONS,
  FAILING_PROVIDER_NAME,
  getSharedBreaker,
} from "@su-maek/core/ai";
import { createSql } from "../src/client";
import { processSourceFile } from "../src/domain/ingestion";

/* ─────────────────────────────────────────────────────────────
 * 추출 실패 시 원본 파일 uploaded 복귀 (인수 23) — 라이브 DB.
 *
 * 인수 23의 근거란은 "실패 시 파일 uploaded 복귀"를 주장했지만 그것을
 * 확인하는 테스트가 0건이었다. 유일한 공급자 MockAiProvider가 절대
 * 실패하지 않아 실연할 수단 자체가 없었기 때문이다. 이제 실패를 주입하는
 * FailingAiProvider(AI_PROVIDER=mock-failing)가 있으므로, 실제 DB에서
 * ingestion.ts의 복귀 경로가 도는지를 직접 확인한다.
 *
 * 확인하는 것:
 *  1) 공급자가 던지면 status가 extracting이 아니라 uploaded로 돌아온다
 *  2) 회로가 열려 빠른 실패(CircuitOpenError)일 때도 마찬가지다
 *  3) 공급자 **생성** 단계에서 던져도 마찬가지다 — 이 예외가 try 밖에
 *     있던 동안 파일은 extracting에 영구히 갇혔다 (재시도 불가)
 *
 * 연결은 beforeAll에서 만든다 — 최상단 createSql()은 skip 판정 전에 던진다.
 * 다른 에이전트가 같은 DB를 쓰므로 고유 ID로 자기 픽스처만 만들고 정리한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const ORG = uuidv7();
const UPLOADER = uuidv7();

/** 원래 설정을 되돌려 다른 테스트 파일에 새지 않게 한다 */
const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

interface FileState {
  status: string;
  /** created_at 이후 update가 실제로 돌았는가 — extracting 왕복의 흔적 */
  touched: boolean;
}

/** 테스트마다 새 파일 — checksum은 (조직, checksum) 유니크라 매번 달라야 한다 */
async function newSourceFile(): Promise<string> {
  const id = uuidv7();
  await sql`
    insert into source_files (
      id, organization_id, storage_path, file_name, mime_type,
      byte_size, checksum, page_count, status, uploaded_by
    ) values (
      ${id}, ${ORG}, ${`${ORG}/sources/${id}/원본.pdf`}, '단원평가.pdf',
      'application/pdf', 1024, ${`sha256:${id}`}, 2, 'uploaded', ${UPLOADER}
    )
  `;
  return id;
}

async function fileState(id: string): Promise<FileState> {
  const [row] = await sql<{ status: string; touched: boolean }[]>`
    select status, (updated_at > created_at) as touched
    from source_files where id = ${id}
  `;
  return { status: row!.status, touched: row!.touched };
}

async function questionCount(sourceFileId: string): Promise<number> {
  const [row] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from questions
    where source_file_id = ${sourceFileId}
  `;
  return row?.cnt ?? 0;
}

describe.skipIf(!hasDb)("추출 실패 시 원본 파일 uploaded 복귀 (인수 23)", () => {
  beforeAll(async () => {
    sql = createSql();
    await sql`
      insert into organizations (id, name, slug)
      values (${ORG}, '반입 실패 테스트', ${`ingest-fail-${ORG.slice(0, 8)}`})
    `;
    await sql`
      insert into users (id, email, display_name)
      values (${UPLOADER}, ${`u-${UPLOADER.slice(0, 8)}@test.local`}, '업로더')
    `;
  });

  afterEach(() => {
    if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  });

  afterAll(async () => {
    /* 실패 경로만 타므로 questions·audit_events·ai_usage_events는 생기지
     * 않는다. 불변 트리거가 걸린 테이블은 건드리지 않는다. */
    await sql`delete from source_files where organization_id = ${ORG}`;
    await sql`delete from users where id = ${UPLOADER}`;
    await sql`delete from organizations where id = ${ORG}`;
    await sql.end({ timeout: 5 });
  });

  it("갓 올린 파일은 아직 손대지 않은 상태다 (대조군)", async () => {
    const fileId = await newSourceFile();
    const state = await fileState(fileId);
    expect(state.status).toBe("uploaded");
    // touched=false 여야 아래 테스트의 touched=true가 "왕복했다"는 증거가 된다
    expect(state.touched).toBe(false);
  });

  it("공급자가 실패하면 uploaded로 복귀한다 — extracting에 갇히지 않는다", async () => {
    process.env.AI_PROVIDER = FAILING_PROVIDER_NAME;
    const fileId = await newSourceFile();

    await expect(
      processSourceFile({
        organizationId: ORG,
        sourceFileId: fileId,
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);

    const state = await fileState(fileId);
    expect(state.status).toBe("uploaded");
    expect(state.touched).toBe(true); // extracting까지 갔다가 되돌아왔다
    expect(await questionCount(fileId)).toBe(0);
  });

  it("회로가 열린 뒤 빠른 실패에서도 uploaded로 복귀한다", async () => {
    process.env.AI_PROVIDER = FAILING_PROVIDER_NAME;
    const breaker = getSharedBreaker(FAILING_PROVIDER_NAME);

    // 임계까지 실패시켜 연다. 앞 테스트가 이미 몇 번 실패시켰을 수 있으므로
    // 횟수를 가정하지 않고 상태를 보고 멈춘다.
    for (
      let i = 0;
      i < DEFAULT_BREAKER_OPTIONS.failureThreshold + 1 &&
      breaker.currentState() !== "open";
      i++
    ) {
      const id = await newSourceFile();
      await expect(
        processSourceFile({
          organizationId: ORG,
          sourceFileId: id,
          actorUserId: null,
        }),
      ).rejects.toThrow();
    }
    expect(breaker.currentState()).toBe("open");

    // 회로가 열린 상태의 새 요청 — 공급자에 도달조차 못 한다
    const fileId = await newSourceFile();
    await expect(
      processSourceFile({
        organizationId: ORG,
        sourceFileId: fileId,
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);

    const state = await fileState(fileId);
    expect(state.status).toBe("uploaded");
    expect(state.touched).toBe(true);
    expect(await questionCount(fileId)).toBe(0);
  });

  it("공급자 생성 단계의 실패도 uploaded로 복귀한다 (AI_PROVIDER=anthropic)", async () => {
    /* 회귀 방지: createAiProvider가 try 블록 밖에 있던 동안, 미구현
     * anthropic 설정에서 던진 예외는 복귀 코드를 건너뛰어 파일을
     * extracting에 결정론적으로 가뒀다. */
    process.env.AI_PROVIDER = "anthropic";
    const fileId = await newSourceFile();

    await expect(
      processSourceFile({
        organizationId: ORG,
        sourceFileId: fileId,
        actorUserId: null,
      }),
    ).rejects.toThrow(/anthropic/);

    const state = await fileState(fileId);
    expect(state.status).toBe("uploaded");
    expect(state.touched).toBe(true);
  });
});
