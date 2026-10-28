import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { ptosPlugin } from "./tools/eslint/no-client-timezone.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Onda 1 · M1 (item 6): fuso não se calcula no cliente (Lei 1). A regra só
  // acorda em arquivo cuja PRIMEIRA diretiva é "use client"; a exceção exige
  // motivo escrito (`// fuso-ok: …`).
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { ptos: ptosPlugin },
    rules: { "ptos/no-client-timezone": "error" },
  },
]);

export default eslintConfig;
