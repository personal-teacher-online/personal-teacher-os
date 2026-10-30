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
4. Ficam como estão: a trava da CI que barra mudança no scanner e nos hooks
   sem o label `dono-liberou` (agente nunca põe o label; o `deny` do
   `settings.json` recusa `gh pr edit`/`gh label` com ele, mas não a forma
   `gh api`, que cai num `ask`; desde 30/10 ela mora no workflow
   `scanner-protegido.yml`, ver Consequências); uma PR com migration aberta
   por vez; deploy manual com `/code-review xhigh` antes (ADR-040). Na
   sessão manual, o merge segue com o dono.

## Consequências

- Migration entra na `main` sem clique do dono (o item 3 do comparativo com
  o lotufo, de 27/10). Produção continua atrás do gate de deploy.
- Regra afrouxada por engano é barrada por duas máquinas de fornecedores
  diferentes, que procuram isso de propósito, em vez de um clique às cegas.
- Quem decide afrouxar uma regra é o dono, numa sessão manual; o revisor
  barra a mudança vinda de rodada.
- Ainda não há trava do GitHub sobre caminho (o ruleset não exige revisão,
  e todas as sessões usam a conta do dono): o gate é das skills. Se uma
  rodada pular o gate, nada mecânico segura, salvo no scanner (abaixo).
- Scanner, hooks e regra de dados (30/10, etapa seguinte a esta ADR): o
  passo saiu do `ci.yml` (que a PR pode reescrever, porque `pull_request`
  roda a versão da própria PR) e foi para `.github/workflows/scanner-protegido.yml`,
  disparado por `pull_request_target`, que roda a versão da `main`. Ele não
  faz checkout nem executa nada da PR: lê pela API a lista de arquivos e
  barra os do scanner, dos hooks, da regra de dados, a configuração do
  gitleaks (`.gitleaks.toml`, `.gitleaksignore`, inclusive criados) e o
  próprio workflow. O label `dono-liberou` é lido na API e só vale se o
  último a pô-lo foi uma pessoa: o token do Actions de uma PR que reescreve
  o próprio `ci.yml` consegue pôr o label (medido), mas aparece como robô.
  Na fila de merge o workflow confere de novo a diferença do grupo.
  Vira trava só com o check "scanner protegido" obrigatório no ruleset
  "main protegida", mudança que é do dono (`scripts/fase2/ruleset-main.json`
  já traz a linha; aplicar com `PUT` no ruleset existente, depois do merge).
- Medido num repositório de prova, com o check obrigatório: o check fica no
  head da PR; ficam bloqueadas a PR que apaga o workflow e mexe no scanner,
  a que renomeia o scanner, a que cria `.gitleaksignore`, a que tem o label
  posto pelo robô, e a que cria um job falso com o mesmo nome, noutro
  arquivo ou no próprio workflow (com evento `pull_request`), mesmo
  terminando por último. Passam a PR só com arquivo novo e a que recebe o
  label de uma pessoa (vermelho, label, verde: a rodada nova vale).
- O que ele não fecha, por decisão do dono (30/10): desligar a varredura
  sem tocar no scanner, mudando como o `ci.yml` o chama ou com o comentário
  `gitleaks:allow` na linha. Isso fica com o gate reforçado de `.github/`
  (revisor e Sol). Caminho para fechar depois: rodar o scanner da `main`
  sobre o conteúdo da PR neste mesmo workflow, sem executar código da PR.
  Também fica aberto: o label vale para os pushes seguintes da PR, como
  antes, e a forma `gh api` de pô-lo cai num `ask`, não num `deny`.
