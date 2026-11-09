---
name: abrir-pr
description: Fecha o trabalho de uma issue (ou de uma etapa aprovada) e abre a PR em português no modelo .github/pull_request_template.md, depois dos testes focados, tsc, lint e /code-review triado. Numa sessão manual roda também o revisor-adversarial em toda PR e o gate Sol nas de risco; numa trabalhadora da orquestradora, esses dois ficam como "pendente (orquestradora)". Usada ao fim de uma tarefa, quando a implementação está pronta.
---

# Abrir a PR

Dentro do recorte (aprovado pelo dono numa sessão manual, ou a própria issue numa trabalhadora), a sessão
decide sozinha; cada decisão vai na seção `## Suposições` da PR, com o motivo. Numa sessão manual, o que sai
do recorte volta para aprovação antes de ser feito; numa trabalhadora, vira pergunta na issue com label
`decisao`.

## Antes de abrir (nesta ordem)

1. **Commits feitos** na branch da worktree, em português, assunto sem acento no padrão `tipo: descricao`
   (feat/fix/docs/test/chore). O pre-commit do projeto roda `tsc` e `eslint` nos arquivos do commit; erro
   recusa o commit e é da sessão corrigir, nunca `--no-verify`.
2. **Testes focados verdes.** Só o que a mudança tocou:

   ```bash
   node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/<arquivo>.test.ts
   npx tsc --noEmit
   ```

   A bancada (Supabase em 54321/54322) é UMA e compartilhada por todas as worktrees: **nunca** `npm test`
   completo nem `supabase db reset` sem o dono dizer "bancada livre". A suíte inteira roda no CI da PR,
   que é a prova oficial. Teste novo segue os vizinhos em `tests/` (banco real, `daysFromToday`,
   `createInstanceAt`, nunca data cravada; limpeza só do que o próprio teste criou).
3. **`/code-review`** sobre o diff da branch (skill `code-review`, alvo = número da PR depois de aberta, ou
   a branch), em toda PR. Triar os achados: corrigir o que for defeito real e registrar em `## Gates` o que
   foi corrigido e o que foi refutado, com motivo. Pode ser rodado logo depois do passo "Abrir", com o
   número da PR; o corpo é atualizado em seguida (`gh pr edit`).
4. **Numa trabalhadora da orquestradora: parar aqui.** O `revisor-adversarial` e o gate Sol são rodados pela
   orquestradora depois que a PR existe; em `## Gates` entram como "pendente (orquestradora)".
   **Numa sessão manual:** rodar o agente `revisor-adversarial` (Agent tool, `subagent_type:
   revisor-adversarial`, com o número da issue ou o recorte no prompt) em toda PR, e depois o **gate Sol**
   (skill `gate-sol`) se a issue tem label `risco:*` ou se o diff toca `supabase/migrations/`, ledger de
   créditos, políticas RLS, materialização de horários, o outbox ou qualquer caminho protegido (ADR-041). A
   revisão é bloqueante: cada Crítico e Aviso é corrigido (com teste) ou refutado com motivo na PR; Sugestão
   só fica registrada em `## Gates`.
5. Se alguma correção dos passos 3 e 4 mudou código, rodar de novo os testes focados e o `tsc`.

## Abrir

1. `git push -u origin HEAD`
2. Escrever o corpo num arquivo da pasta temporária da sessão, com EXATAMENTE as seções do modelo
   `.github/pull_request_template.md`, nesta ordem:
   - `## O que mudou`: 3 a 6 linhas em português, sem jargão, do ponto de vista de quem usa (dona,
     professora, aluno, dono). Nada de nome de função, arquivo ou tabela.
   - `## Por quê`: link da issue e `Closes #N`. PR sem issue (etapa aprovada numa sessão manual): escrever
     `Sem issue: <motivo em uma linha>` no lugar de `Closes #`.
   - `## Como testar no navegador`: passos numerados que o dono segue na bancada visual (rito em
     `CLAUDE.md` › Armadilhas da bancada) ou em produção depois do deploy, com a URL da tela, o que clicar
     e o que deve aparecer. Um passo por critério de aceite. Sem tela: o comando ou a RPC e o resultado.
   - `## Suposições`: o que foi decidido sem perguntar e por quê; "Nenhuma" se não houve. O que foi visto
     fora do recorte entra aqui como "fora do recorte", não no diff.
   - `## Migration`: "Não", ou "Sim: `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`" e se só acrescenta
     (coluna, tabela, índice, função) ou mexe em dados (explicar o quê). Toda função nova revoga EXECUTE
     nominalmente (`tests/acl-higiene.test.ts` vigia).
   - `## Gates`: checklist com o resumo de cada um:
     ```
     - [ ] CI (tsc + lint + suíte): (preenchido quando o check "tsc + lint + suíte" ficar verde)
     - [x] Testes focados do que tocou: N verdes em tests/x.test.ts; tsc ok
     - [x] /code-review: N achados, M corrigidos, K refutados com motivo
     - [x] revisor-adversarial: N achados, M corrigidos, K refutados (ou "OK"; numa trabalhadora, "pendente (orquestradora)")
     - [x] Gate Sol (com risco:* ou caminho protegido): N achados, M corrigidos, K refutados (ou "não se aplica"; numa trabalhadora com risco ou caminho protegido, "pendente (orquestradora)")
     ```
   - Última linha do corpo: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
3. `gh pr create --base main --title "tipo: descricao (#N)" --body-file "<scratchpad>/pr-<N>.md"`
   O título repete o título da issue e termina com o número dela. PR com migration diz isso no título
   (ex.: `feat: entregue no outbox (migration M3-1) (#N)`).

## Depois de abrir

Se a PR veio de uma issue (PR sem issue pula este comando):

```bash
M=$(gh pr view --json number -q .number)
gh issue comment <N> --body "PR #$M aberta"
```

Responder na sessão com o link da PR e as linhas de "Como testar no navegador". **Nunca comentar na PR**
(todo agente posta com a conta do dono, e comentário na PR é a trava que a tira do auto-merge): o que
precisar registrar vai no corpo da PR (`gh pr edit`) ou na issue. Numa trabalhadora, quem liga o auto-merge
é a orquestradora, depois dos gates dela (skill `orquestrar`); a trabalhadora para aqui.

## Merge numa sessão manual (decisão do dono, 09/11/2026, #164)

O dono autoriza **em chat, por PR** ("pode mesclar a #M", "mescla", "merge when ready"). Sem essa frase, a
sessão não liga nada. Com ela:

1. **Caminho protegido** (`git diff --name-only origin/main...HEAD` toca `.github/`, `.claude/`, `.githooks/`,
   `supabase/migrations/`, `supabase/seed.sql`, `docs/ops/runbook-vps.md`, `Dockerfile`, `next.config.ts`,
   `CLAUDE.md`, `AGENTS.md`, `Design.md`, `scripts/vazamento*`): **não ligar**. Dizer ao dono que o clique em
   "Merge when ready" é dele (ADR-041: ali estão as regras que governam os agentes, e a única barreira é a
   mão dele).
2. Fora de caminho protegido, conferir as travas, todas: `gh pr view <M> --json isDraft,mergeable,comments,reviews`
   sem draft, `MERGEABLE` (`UNKNOWN`: esperar 20 s e reconsultar, até 3 vezes), **zero comentários e zero
   reviews**; `## Gates` da PR com revisor e gate Sol (quando se aplica) registrados e sem Crítico/Aviso em
   aberto; `gh pr checks <M>` com a CI existindo e rodando ou verde (CI ausente é recusa; logo depois de um
   push o GitHub responde "no checks reported" por ~30 s, esperar e reconsultar). Faltou uma: dizer qual e não
   ligar.
3. Gravar a hora (`date -u +%Y-%m-%dT%H:%M:%SZ`), `gh pr merge <M> --auto --squash`, e comentar na issue
   "PR #M com auto-merge ligado às AAAA-MM-DDTHH:MM:SSZ (autorizado pelo dono em chat)". A fila de merge roda a
   CI sobre a `main` atual e mescla; as travas do GitHub (ruleset: PR, 3 checks, fila `ALLGREEN`) continuam
   valendo e não dependem desta skill.
4. Depois, `git pull --ff-only` na pasta principal quando a PR constar `MERGED`, como no passo 10 da skill
   `orquestrar`. Se o dono comentar na PR enquanto ela espera a fila, converter em draft (`gh pr ready --undo
   <M>`) e avisar.
