import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deploy via Docker/Coolify (runbook §K): server mínimo autocontido em .next/standalone.
  output: "standalone",
  // ADR-027 (26/07): o `outputFileTracingIncludes` de `brand/slides/**` existia
  // só para a tela da Fábrica (/admin/slides), que lia os assets da marca do
  // disco em runtime. Removida a tela, nenhuma rota do app monta deck de aula —
  // o motor roda por CLI, a partir do repo, onde `brand/` está inteiro. Se algum
  // dia uma rota voltar a desenhar slides, o include volta junto.
};

export default nextConfig;
