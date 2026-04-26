import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

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
];
