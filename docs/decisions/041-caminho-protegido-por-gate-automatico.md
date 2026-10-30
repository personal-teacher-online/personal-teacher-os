# ADR-041 — Caminho protegido entra por gate automático, não por merge do dono

**Data:** 30/10/2026 · **Status:** aceita (decisão do dono, 30/10/2026)

## Contexto

Desde 14/10/2026, PR que toca caminho protegido (`.github/`, `.claude/`,
`.githooks/`, `supabase/migrations/`, `supabase/seed.sql`, runbook,
`Dockerfile`, `next.config.ts`, `CLAUDE.md`, `AGENTS.md`, `Design.md`,
`scripts/vazamento*`) não entrava em auto-merge: "fica para o dono mesclar".
Em paralelo, o `gh pr merge` pedia permissão a cada PR.

Em 30/10 o dono disse que não lê esses pedidos nem as PRs: aprova sem ler.
O clique dele, portanto, não era trava, só espera (na rodada de fumaça de
15/10, ~49 min de 1h33 parados em pedido de permissão). A PR #97 tirou o
pedido de permissão do `gh pr merge`; sem outra mudança, o caminho protegido
ficaria guardado só pela leitura da lista de arquivos pela orquestradora.

O risco que importa não é a falta do clique, é um agente afrouxar as próprias
regras (liberar uma permissão, desligar um passo da CI, amolecer uma Lei) ou
uma migration errada chegar à `main` sem revisão forte.

## Decisão

1. Caminho protegido continua com a mesma lista, mas passa a entrar em
   auto-merge com **gate reforçado**: gate Sol obrigatório (outro fornecedor)
   e o revisor adversarial sem achado do item 10, "regra afrouxada". Achado
   desse item é sempre Crítico, nos dois revisores.
2. Gate Sol que não rodou, ou com Crítico/Aviso em aberto, segura a PR com
   `precisa-do-leo`, como já era.
3. O resumo da rodada ganha o bloco "Mudou regra ou estrutura": uma linha em
   linguagem de negócio por PR desse tipo. É o que o dono lê.
4. Ficam como estão: o passo da CI que trava mudança no scanner e nos hooks
   sem o label `dono-liberou` (trava mecânica; agente nunca põe o label);
   uma PR com migration aberta por vez; deploy manual com `/code-review
   xhigh` antes (ADR-040). Na sessão manual, o merge segue com o dono.

## Consequências

- Migration entra na `main` sem clique do dono (o item 3 do comparativo com
  o lotufo, de 27/10). Produção continua atrás do gate de deploy.
- Regra afrouxada por engano é barrada por duas máquinas de fornecedores
  diferentes, que procuram isso de propósito, em vez de um clique às cegas.
- Quem decide afrouxar uma regra é o dono, numa sessão manual; o revisor
  barra a mudança vinda de rodada.
- Ainda não há trava do GitHub sobre caminho (o ruleset não exige revisão,
  e todas as sessões usam a conta do dono): o gate é das skills. Se uma
  rodada pular o gate, nada mecânico segura, salvo o scanner.
