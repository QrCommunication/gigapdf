// Flat ESLint v9 config for internal monorepo packages.
// Minimal, opinionated, only basic safety nets — internal packages are
// best linted via the consuming app's config (apps/web, apps/admin).

import js from "@eslint/js";

export const sharedFlatConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/__tests__/fixtures/**",
      "**/*.config.{js,mjs,ts,cjs}",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // Pragmatic: TypeScript strict mode + the consuming app's lint cover
      // most issues. Keep ESLint here only as a safety net, not a gate.
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
    },
  },
];

export default sharedFlatConfig;
