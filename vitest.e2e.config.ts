import path from 'node:path'
import { defineConfig } from 'vitest/config'

// CONFIG SEPARADA DO E2E (Onda 1 · M5).
//
// A suíte de unidade (`npm test`, ~1900 testes) tem de continuar rápida e sem
// dependência de navegador, build ou bancada semeada. Por isso são duas
// extensões e duas configs: `tests/**/*.test.ts` é unidade (vitest.config.ts) e
// `tests/e2e/**/*.spec.ts` é este harness. A config de unidade já ignora o
// `.spec.ts` pelo `include` dela — nada a excluir aqui.
//
// Lei 1: TZ=UTC também no processo do teste (o servidor sobe em UTC pelo
// globalSetup); o relógio do negócio é do banco.
process.env.TZ = 'UTC'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.spec.ts'],
    globalSetup: ['tests/e2e/servidor.ts'],
    env: { TZ: 'UTC' },
    // Bancada local varia (banco frio, primeira renderização de cada rota,
    // animação de 300ms do trilho). Timeouts generosos e UMA repetição: uma
    // falha que se repete é defeito, uma que some era ruído de bancada — e o
    // relatório do vitest diz quando um teste passou na segunda.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
    retry: 1,
    // Um navegador, uma sessão, uma ordem. Paralelismo aqui só criaria disputa
    // pela mesma bancada (e o `?painel=` é estado de URL compartilhado).
    fileParallelism: false,
    sequence: { concurrent: false },
    maxWorkers: 1,
  },
})
