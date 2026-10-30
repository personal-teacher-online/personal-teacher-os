---
name: nova-tarefa
description: Transforma um pedido do dono em uma ou mais issues no GitHub, no modelo .github/ISSUE_TEMPLATE/tarefa.md (objetivo, regra de negócio com fonte, critérios de aceite, testes esperados, risco, arquivos prováveis, origem). Usar quando o dono pedir "transforme isto em issues", "carregue a fila" ou equivalente.
---

# Nova tarefa: pedido do dono → issue

Entender o pedido, ler o que precisa no repositório (código, `CLAUDE.md`, `docs/goals/` da onda ativa,
`docs/decisions/`, `AJUSTES.md`) e escrever issues que uma trabalhadora executa sozinha, sem perguntar.

## Regras

- **Uma issue = uma PR = uma worktree.** No máximo meio dia de trabalho. Pedido maior vira várias issues,
  cada uma entregável sozinha; se uma depende de outra, dizer em "Origem" numa frase que COMEÇA com
  "Depende da #N" (o `listar-issues` só lê frase que começa assim; "a #N depende desta" não conta).
- **Regra de negócio com fonte.** Lei do `CLAUDE.md`, ADR (`docs/decisions/NNN`), goal da onda, decisão do
  dono com data (DD/MM/AAAA). Regra sem fonte não vira issue: vira pergunta ao dono, antes.
- **Critérios de aceite verificáveis no navegador** (URL, o que clicar, o que deve aparecer) ou na API/RPC
  quando não há tela. Nada de "o código fica limpo".
- **Testes esperados** nomeiam o arquivo em `tests/` e o comportamento (ex.: `tests/m3-mensagens.test.ts`:
  a aba Entregues lista só linhas com `delivered_at`). Cada critério de aceite tem pelo menos um teste.
  Teste de regra do banco (RPC, constraint, trigger) é teste contra o Postgres, como os vizinhos fazem.
- **Risco**: um ou mais labels deste domínio, ou nenhum:
  - `risco:dinheiro`: centavos, Asaas, extrato, cobrança (Lei 9);
  - `risco:ledger`: créditos de reposição ou mentoria, saldo derivado (Lei 2);
  - `risco:fuso`: recorrência, DST, materialização de horários (Lei 1);
  - `risco:rls`: políticas, `app_metadata`, `service_role`, permissões, ACL de função (Lei 4);
  - `risco:migration`: migration nova em `supabase/migrations/` (Lei 7). Caminho protegido: a PR passa pelo
    gate reforçado (gate Sol obrigatório; ADR-041), e só uma PR com migration fica aberta por vez;
  - `risco:envio`: outbox, WhatsApp, e-mail, webhooks (Lei 6).
  Com `risco:*` a trabalhadora roda em Opus e a PR passa pelo gate Sol (skill `gate-sol`).
- **Migration é escopo próprio.** Mudança de tela que depende de migration vira duas issues: a migration
  (com `risco:migration`) e a tela ("depende da #N").
- **Perguntar ao dono só o que a issue não decide sozinha** (regra de negócio sem fonte, escolha entre dois
  comportamentos que a dona ou o aluno veria). Tudo de uma vez, numerado, com a opção recomendada primeiro.
  Escolha técnica não é pergunta: decidir e escrever em "Regra de negócio" ou "Arquivos prováveis".
- Nada de nome de pessoa nem de máquina no texto: papel ("dona", "professora", "aluno", "dono") e `<VPS>`.
- Datas em DD/MM/AAAA. Tudo em português. Título curto no formato `tipo: descricao` (sem acento no
  assunto; vira o título da PR).

## Passo a passo

1. Montar o rascunho das issues, cada uma com EXATAMENTE as seções do modelo
   `.github/ISSUE_TEMPLATE/tarefa.md`, nesta ordem: `## Objetivo`, `## Regra de negócio`,
   `## Critérios de aceite`, `## Testes esperados`, `## Risco`, `## Arquivos prováveis`, `## Origem`.
2. Mostrar a lista ao dono (número provisório, título, risco) e fazer as perguntas todas juntas, antes de
   criar qualquer issue. Esperar o OK.
3. Criar cada issue com o corpo num arquivo da pasta temporária da sessão (não no repositório):

   ```bash
   gh issue create --title "tipo: descricao" --body-file "<scratchpad>/issue-1.md" --label "risco:fuso"
   ```

   Sem risco, omitir `--label`. Labels de tipo quando couber: `bug`, `ui`, `divida`. Os labels já existem
   no repositório (criados na etapa a do fluxo, 14/10/2026).
4. Responder ao dono com a lista final: número, título e risco.
