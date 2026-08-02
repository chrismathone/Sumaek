# 수맥 백그라운드 워커 — 상시 실행 프로세스의 배포 단위.
#
# 왜 컨테이너인가: 웹은 Next.js라 서버리스 플랫폼에 얹히지만, 워커는 **죽지 않고
# 계속 도는 프로세스**여야 한다(요청이 없어도 outbox를 디스패치해야 한다).
# 배포 플랫폼은 아직 정하지 않았고 저장소에 자격 증명도 없다. 그래서 특정
# 플랫폼 매니페스트 대신 어느 플랫폼이든 그대로 받는 이미지 정의를 둔다.
# 로컬에서는 이것 없이 `pnpm dev:all`로 웹과 함께 띄운다.
#
#   docker build -f apps/worker/Dockerfile -t su-maek-worker .   # 컨텍스트는 저장소 루트
#   docker run --rm --env-file .env su-maek-worker
#
# 살아 있는지 확인: `docker exec <id> pnpm status`
# 또는 어디서든 `pnpm worker:status` (같은 DB를 본다).

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# 의존성 층 — 소스가 바뀌어도 lockfile이 그대로면 재사용된다.
# 워크스페이스 매니페스트를 먼저 복사한다(pnpm이 그래프를 여기서 읽는다).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/contracts/package.json packages/contracts/
COPY e2e/package.json e2e/
# 워커가 쓰는 워크스페이스만 설치한다 — 웹의 Next.js·Playwright 브라우저는 필요 없다.
RUN pnpm install --frozen-lockfile --filter @su-maek/worker...

FROM base AS runtime
ENV NODE_ENV=production
# 먼저 설치 결과(node_modules 심볼릭 링크 포함)를, 그다음 소스를 얹는다.
# COPY는 병합이라 뒤의 소스 복사가 앞의 node_modules를 지우지 않는다.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages ./packages
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# tsx로 TypeScript를 그대로 실행한다 — 저장소 전체가 그렇게 돈다(빌드 산출물 없음).
# 워커는 요청을 받지 않으므로 콜드스타트·번들 크기가 문제되지 않는다.
WORKDIR /app/apps/worker

# `pnpm start`가 아니라 node를 직접 부른다 — PID 1이 node여야 SIGTERM이
# main.ts의 핸들러에 그대로 닿는다. 중간에 pnpm이 끼면 시그널 전달이
# 구현에 좌우되고, 그러면 "새 클레임 중단 → 진행 중 작업 완료 → 종료"라는
# 약속이 조용히 깨진다(그 약속은 README·RB-04 5.2에 적혀 있다).
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "src/main.ts"]
