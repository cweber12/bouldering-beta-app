import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored WASM bundle — not our code.
    "public/opencv.js",
    // Generated coverage report files.
    "coverage/**",
    // Legacy Web Worker files (kept for reference, not actively maintained).
    "workers/**",
    // Legacy Web Worker files (kept for reference, not actively maintained).
    "workers/**",
  ]),
  {
    rules: {
      // CV code accumulates unused vars fast — catch them early.
      "no-unused-vars": "off", // base rule off; TS rule handles it
      "@typescript-eslint/no-unused-vars": [
        "error",
        { vars: "all", args: "after-used", argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
]);

export default eslintConfig;
