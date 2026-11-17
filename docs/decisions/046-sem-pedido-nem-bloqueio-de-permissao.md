# ADR-046 — A configuração do agente deixa de pedir e de bloquear, e o merge deixa de esperar OK em chat

**Data:** 17/11/2026 · **Status:** aceita com o merge desta PR (decisão do dono em chat, em 17/11/2026, depois de ver item a item o que cada trava protege)

## Contexto

Em 16 e 17/11/2026 o dono juntou 46 capturas de tela de pedidos "Permitir uma
vez" do Claude Code, neste projeto e em outro dele, e pediu que acabassem.

A causa foi medida nas transcrições das sessões, não deduzida:

- as sessões já rodavam em modo automático;
- nesse modo, o pedido de clique só aparece quando o comando casa com uma
  regra da lista `ask` do `.claude/settings.json`;
- basta um trecho de um comando composto casar, nenhuma regra `allow` de
  nenhum arquivo vence uma `ask`, e o pedido não oferece "permitir sempre".

Neste projeto, os 14 pedidos vieram de duas regras: `gh api * -f *`, que pega
também consulta de leitura (toda consulta GraphQL usa `-f query=`), e
`npx supabase *`.

O dono já tinha dito em 30/10/2026 que clica nesses pedidos sem ler (ADR-041):
o clique dele é atraso, não conferência. O OK de merge em chat, de 09/11/2026,
parava a sessão do mesmo jeito à espera de uma resposta que ele dá sem reler
a PR.

Antes de decidir, o dono viu o que cada item protege. A sessão recomendou
manter a lista `deny`, porque ela nunca pergunta nada e não atrasa o fluxo.
Ele escolheu tirar também.

## Decisão

1. **Lista `ask`: apagada inteira** (70 regras, 35 em `Bash` e 35 em
   `PowerShell`). Nenhum comando pede mais clique por regra do projeto.
2. **Lista `deny`: apagada inteira** (142 regras, 71 em `Bash` e 71 em
   `PowerShell`): force push, push direto na `main`, `--no-verify`,
   `core.hooksPath`, `git -C * -c *` e pôr o label `dono-liberou` por linha de
   comando.
3. **O merge deixa de esperar OK do dono em chat.** A sessão que abriu a PR
   liga o merge quando a conferência fecha: sem rascunho, sem conflito, sem
   comentário nem review do dono, CI rodando ou verde e, onde
   `.claude/rules/mudanca-de-risco.md` exige, a revisão do Codex sem achado em
   aberto. O texto está em `docs/agents/issue-tracker.md`, "Como o trabalho
   fecha", e troca a decisão de 09/11/2026.
4. **O que não muda:** plano aprovado pelo dono antes do primeiro arquivo;
   deploy manual, com o gate de `/code-review` (ADR-040); revisão do Codex em
   caminho protegido e em mudança de risco; o check "scanner protegido"; a
   lista `allow`; os hooks. As regras escritas ("`--no-verify`, `--force` e
   push direto não existem", "a sessão nunca põe o label `dono-liberou`")
   continuam valendo como regra: o que saiu foi o bloqueio na configuração.

## Consequência

- **Fluxo:** as sessões não param mais por pedido de clique nem à espera do
  "pode mesclar".
- **Passa a rodar sem pergunta e sem bloqueio do projeto:** `supabase db
  reset` (apaga a bancada local, que é uma só e compartilhada),
  `git reset --hard`, `git clean`, `git checkout -- .`, `gh api` com escrita,
  `gh pr close`, `gh repo`. O que segura esses comandos agora é a regra escrita
  ("bancada livre", por exemplo) e o classificador do modo automático, que só
  julga o que não casa com uma regra `allow`. Comando que casa com `allow`
  (`git push *`, por exemplo, inclusive com `--force`) roda sem passar por ele.
- **Também deixam de ser barrados ou perguntados**, porque casam com uma regra
  `allow` que ficou: `git push --mirror`, `--all`, `--delete` e `--prune`
  (apagam ou reescrevem branches remotas); `git branch -f` e
  `git branch --delete --force`; `git switch -f` e
  `git switch --discard-changes` (descartam mudança não commitada);
  `git worktree remove --force` (pode remover a worktree de outra frente);
  `git rebase`; `gh issue delete`; e desligar os hooks por
  `core.hooksPath` ou por `git -C <pasta> -c <chave>=<valor>`.
- **O que o GitHub continua barrando na `main`:** force push, apagar a branch,
  push sem PR e merge sem os checks obrigatórios (regras da proteção da
  branch). Em qualquer outra branch, force push deixa de ter barreira.
  **Essa proteção não é independente do agente:** as sessões usam a conta do
  dono, que administra o repositório, e `gh api *` está no `allow`. Uma
  chamada de escrita à API pode alterar ou apagar a proteção da branch, e
  depois disso push direto e force push na `main` também passam. O que impede
  isso hoje é só a regra escrita.
- **O merge não fica preso ao commit conferido.** A sessão confere o commit na
  hora de ligar, e um push posterior entra junto se ninguém desarmar antes.
  Era assim com o OK em chat; a diferença é que não há mais uma pessoa entre a
  conferência e o merge.
- **`--no-verify` deixa de ser barrado.** O scanner de dado real continua no
  hook de commit e de push e na CI; um commit feito com `--no-verify` pula o
  hook local e só é pego na CI, depois de o push já ter saído. O repositório é
  público: o que sai no push não se apaga.
- **O label `dono-liberou` deixa de ser barrado por linha de comando.** As
  sessões usam a conta do dono, então o check "scanner protegido" (ADR-041)
  passa a depender só da regra escrita de que a sessão não põe o label. A
  garantia técnica do ADR-041 nesse ponto deixa de existir.
- **Merge sem OK em chat:** uma PR com CI verde e conferência fechada entra na
  `main` sem o dono ter lido a mensagem final da sessão. O que ele decide
  continua sendo o plano, antes, e o deploy, depois; merge na `main` não
  publica.
- **Fila de merge: fora desta decisão.** O dono pediu para tirá-la também, e
  ela continua ligada por enquanto: na conferência apareceu que a lista de
  nomes reais (`PT_NOMES_PROIBIDOS`) só entra na CI em `push` e na fila, não em
  `pull_request`. Sem a fila, essa parte da varredura deixa de rodar antes de
  o commit entrar na `main`. Fica para decisão dele com esse dado.
- **Voltar atrás:** as duas listas estão no histórico do
  `.claude/settings.json` (commit anterior a esta PR).
