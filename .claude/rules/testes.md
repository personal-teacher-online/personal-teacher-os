---
paths:
  - "tests/**"
---

# Testes

- **Toda mudança de comportamento sai com teste** ao lado dos existentes em `tests/`, e o teste tem de falhar
  sem a mudança. Regra do banco se testa no banco (RPC, constraint, trigger), como os vizinhos fazem.
- **Teste que consulta o relógio real ou o banco não usa data cravada.** Datas relativas (`daysFromToday`,
  `proximaVirada`) e instantes fixos (`createInstanceAt`), todos em `tests/helpers/db.ts`; nunca "agora + N
  dias" pareado com hora fixa no mesmo dia (medido em 10/10/2026: dois casos assim derrubaram o CI). Calendário
  fixo vale quando o relógio é simulado (`vi.setSystemTime`) ou a conta não consulta "hoje", como nos casos
  de DST: esses não se trocam por data relativa.
- **Limpeza só do que o próprio teste criou**: filtrar pelo aluno, aula ou encontro do caso, nunca por prefixo
  que alcança dado de outro teste rodando em paralelo.
- **Local, só o que você tocou**: `node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/<arquivo>.test.ts`
  e `npx tsc --noEmit`. A bancada é uma só: suíte completa, `supabase db reset` e `supabase start/stop` só com
  "bancada livre" dita pelo dono (`CLAUDE.md`, "Convivência e travas"). A suíte inteira roda no CI da PR.
- **CI vermelha**: ler o passo que falhou (`gh run view <id> --log-failed`) antes de mexer, e separar ambiente
  de teste de produto. Se o teste achou um bug, o bug é o problema, não o teste.
