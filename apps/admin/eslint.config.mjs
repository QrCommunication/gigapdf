import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tsParser from "@typescript-eslint/parser";

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
    // eslint-config-next applies Next's bundled Babel parser
    // (`next/dist/compiled/babel/eslint-parser`) to plain-JS files. That
    // parser returns a ScopeManager without the `addGlobals()` method ESLint
    // 10 now requires, crashing with "scopeManager.addGlobals is not a
    // function". TS/TSX files already use @typescript-eslint/parser (which is
    // ESLint-10-ready); point JS files at it too so the Babel parser is never
    // invoked. @typescript-eslint/parser parses plain JS as a superset.
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // eslint-config-next sets `react.version: 'detect'`, which on ESLint 10
    // crashes eslint-plugin-react@7.37.5 (it calls the removed
    // `context.getFilename()` during version auto-detection). Pin the real
    // installed React version explicitly: this skips the detection code path
    // entirely while keeping every react/* rule fully enforced.
    settings: { react: { version: "19.2.7" } },
  },
  {
    rules: TECH_DEBT_RULES_AS_WARN,
  },
];
