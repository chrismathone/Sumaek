import { config } from "dotenv";

// 라이브 DB 테스트가 DATABASE_URL을 읽는다. 없으면 describe.skipIf로 건너뛴다.
config({ path: ["../../.env", ".env"] });
