import js from "@eslint/js";

// Mobile (Expo / React Native) — minimal lint config.
// The Expo CLI provides its own type-checking via TypeScript; ESLint here
// is a basic safety net. Expand later with `expo-config-eslint` if needed.

export default [
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "dist/**",
      "ios/**",
      "android/**",
      "*.config.{js,mjs,ts,cjs}",
      "**/*.d.ts",
    ],
  },
  // TypeScript files: skipped here — Expo's tsc provides type-checking.
  // Adding typescript-eslint to lint .ts/.tsx is tracked as tech debt
  // for a follow-up PR (would also enable react-native specific rules).
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
    },
  },
];
