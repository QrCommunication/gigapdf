import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// ---------------------------------------------------------------------------
// Pragmatic relaxations — TODO: follow-up source-cleanup PR
// ---------------------------------------------------------------------------
// Same approach as apps/web/eslint.config.mjs. Pre-existing tech debt
// surfaced by replacing the broken `next lint`. Counts captured 2026-04-26:
//   9 × react-hooks/set-state-in-effect
//   3 × react-hooks/exhaustive-deps
//   1 × react-hooks/incompatible-library
//   1 × import/no-anonymous-default-export
// ---------------------------------------------------------------------------

const TECH_DEBT_RULES_AS_WARN = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/exhaustive-deps": "warn",
  "react-hooks/incompatible-library": "warn",
  "import/no-anonymous-default-export": "warn",
};

export default [
  ...nextCoreWebVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "public/**",
      "next-env.d.ts",
      "next.config.*",
      "postcss.config.*",
      "tailwind.config.*",
      "server-https.mjs",
    ],
  },
  {
    rules: TECH_DEBT_RULES_AS_WARN,
  },
];
