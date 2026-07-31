import "server-only";

/** 일정 실체화 — 구현은 웹·워커 공유 도메인 모듈에 있다. */
export {
  materializeGroupSchedule,
  type MaterializeResult,
} from "@su-maek/db/domain";
