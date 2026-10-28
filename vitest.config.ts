import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Lei 1 (CLAUDE.md): servidor/containers/CI sempre com TZ=UTC.
// Forçado aqui para que nenhum teste dependa do fuso da máquina local.
process.env.TZ = 'UTC'

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig/Next — os testes importam as queries reais do portal.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      TZ: 'UTC',
    },
  },
})
