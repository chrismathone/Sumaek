import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

/* ─────────────────────────────────────────────────────────────
 * ESLint flat config (인수 17).
 *
 * `next lint`는 Next 16에서 제거됐고 이 저장소에는 린트 설정이 아예 없었다
 * ("pnpm lint는 실체가 없다" — docs/acceptance-status.md 인수 17).
 * 타입 검사가 잡지 못하는 것만 고른다 — 서식은 규칙으로 다투지 않는다.
 *
 * 타입 정보를 쓰는 규칙(projectService)은 켜지 않았다. 모노레포 6개 패키지에
 * 전부 붙이면 린트 한 번이 타입 검사 한 번과 맞먹어 CI가 두 배로 느려진다.
 * 타입은 이미 `pnpm typecheck`가 전 패키지에서 본다.
 * ───────────────────────────────────────────────────────────── */

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      // 서브에이전트 워크트리 사본 — 원본을 두 번 검사하게 된다
      ".claude/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.tsbuildinfo",
      "apps/web/next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // 워커·스크립트·서버 코드는 Node에서 돈다. 브라우저 전용 코드도
    // Next가 같은 파일에서 서버/클라이언트를 나누므로 둘 다 열어둔다.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 미사용 변수 — _ 접두사는 의도적 무시로 본다 (서버 액션의 _prev 등)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // any는 경고로 — 기존 코드의 sql 태그 경계에 남아 있다
      "@typescript-eslint/no-explicit-any": "warn",
      // 빈 catch로 오류를 삼키는 것을 막는다 (주석이 있으면 통과)
      "no-empty": ["error", { allowEmptyCatch: false }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
      // 제어문자 정규식은 이 코드베이스에서 의도적이다 —
      // HWPX/XML 출력과 수식 정규화가 제어문자를 걸러낸다
      "no-control-regex": "off",
      // try 안에서 재대입하는 초기값 패턴에 오탐이 잦다
      "no-useless-assignment": "off",
    },
  },

  /* ── 웹앱: React·Next 규칙 ── */
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // React Compiler 계열 규칙은 클라이언트 컴포넌트를 전제한다.
      // 서버 컴포넌트에서 Date.now()를 쓰는 것은 하이드레이션 문제가 없고,
      // sessionStorage 복원을 effect에서 setState하는 것도 정착된 패턴이다.
      // 신호는 남기되 빌드를 막지는 않는다.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  /* ── k6 부하 스크립트: k6 런타임 전역 ── */
  {
    files: ["scripts/load/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
  },

  /* ── 테스트·스크립트: 실용 우선 ── */
  {
    files: [
      "**/test/**/*.ts",
      "**/tests/**/*.ts",
      "**/*.test.ts",
      "**/*.spec.ts",
      "e2e/**/*.ts",
      "scripts/**/*.{mjs,js}",
      "packages/db/scripts/**/*.mts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
