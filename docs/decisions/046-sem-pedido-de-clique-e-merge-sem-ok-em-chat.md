# ADR-046 — A configuração do agente deixa de pedir clique, e o merge deixa de esperar OK em chat

**Data:** 17/11/2026 · **Status:** aceita com o merge desta PR (decisão do dono em chat, em 17/11/2026, depois de ver item a item o que cada trava protege e o veredito da revisão independente)

## Contexto

Em 16 e 17/11/2026 o dono juntou 46 capturas de tela de pedidos "Permitir uma
vez" do Claude Code, neste projeto e em outro dele, e pediu que acabassem.

A causa foi medida nas transcrições das sessões, não deduzida:

- as sessões já rodavam em modo automático;
- nesse modo, o pedido de clique imposto pelo projeto só aparece quando o
  comando casa com uma regra da lista `ask` do `.claude/settings.json`;
- basta um trecho de um comando composto casar, nenhuma regra `allow` de
  nenhum arquivo vence uma `ask`, e o pedido não oferece "permitir sempre".

Neste projeto, os 14 pedidos vieram de duas regras: `gh api * -f *`, que pega
também consulta de leitura (toda consulta GraphQL usa `-f query=`), e
`npx supabase *`.

O dono já tinha dito em 30/10/2026 que clica nesses pedidos sem ler (ADR-041):
o clique dele é atraso, não conferência. O OK de merge em chat, de 09/11/2026,
parava a sessão do mesmo jeito.

O primeiro pedido dele foi tirar também a lista `deny`. A revisão do Codex
sobre essa versão apontou como crítico que, sem ela, commit e push podiam
pular o scanner de dado real e a sessão podia pôr em si mesma o label
`dono-liberou`. A `deny` nunca pergunta nada e não atrasa o fluxo: recusa o
comando sozinha. Com isso na mão, o dono decidiu mantê-la.

## Decisão

1. **Lista `ask`: apagada inteira** (70 regras, 35 em `Bash` e 35 em
   `PowerShell`). O projeto não impõe mais nenhum pedido de clique.
2. **Lista `deny`: fica como estava** (142 regras: force push, push direto na
   `main`, `--no-verify`, `core.hooksPath`, `git -C * -c *` e o label
   `dono-liberou`), **com duas regras a mais**: `gh api *dono-liberou*`, em
   `Bash` e em `PowerShell`. Essa forma de pôr o label caía no `ask`
   (ADR-041); sem `ask` ela passaria direto. A regra nova recusa a chamada
   que traz o nome do label na linha de comando, e só essa (ver
   Consequência).
3. **O merge deixa de esperar OK do dono em chat.** A sessão que abriu a PR
   liga o merge quando a conferência dela fecha: sem rascunho, sem conflito,
   sem comentário nem review do dono, CI rodando ou verde (ligar com a CI
   ainda rodando é habilitar antes da hora: o GitHub só mescla com os checks
   obrigatórios verdes) e, onde
   `.claude/rules/mudanca-de-risco.md` exige, a revisão do Codex sem achado em
   aberto. PR em que o dono comentou ou fez review volta a depender de ordem
   dele em chat. O texto está em `docs/agents/issue-tracker.md`, "Como o
   trabalho fecha", e troca a decisão de 09/11/2026.
4. **O que não muda:** plano aprovado pelo dono antes do primeiro arquivo;
   deploy manual, com o gate de `/code-review` (ADR-040); revisão do Codex em
   caminho protegido e em mudança de risco; o check "scanner protegido" e a
   regra de que o label `dono-liberou` é só do dono; a lista `allow`; os
   hooks; a fila de merge.

## Consequência

- **Fluxo:** as sessões não param mais por pedido de clique do projeto nem à
  espera do "pode mesclar". O modo automático tem um classificador próprio,
  que ainda pode recusar um comando ou, depois de recusas seguidas, voltar a
  perguntar; isso não vem das regras do projeto.
- **Passam a rodar sem pergunta, porque casam com uma regra `allow` que
  ficou** e nada mais os examina: `git branch -f` e
  `git branch --delete --force`; `git switch -f` e
  `git switch --discard-changes` (descartam mudança não commitada);
  `git worktree remove --force` (pode remover a worktree de outra frente);
  `gh pr close`; `gh issue delete`; e `gh api` com escrita (por exemplo, tirar
  uma PR da fila ou mudar configuração do repositório).
- **Deixam de ter regra do projeto e ficam com o classificador do modo
  automático** (ou com uma regra `allow` da configuração local de cada
  máquina, que não é versionada):
  - na bancada local, que é uma só e compartilhada: `supabase db reset`,
    `npm test`, `npx vitest`, `npm run e2e:bancada`, `npm run dev` e
    `npm run build`. O que segura é a regra "bancada livre" do `CLAUDE.md`;
  - comandos do Supabase que alcançam um projeto remoto quando há um
    vinculado: `db push`, `migration repair`, `functions deploy`,
    `secrets set`;
  - na árvore de trabalho: `git reset --hard`, `git clean`,
    `git checkout -- .`, `git checkout -f` e `git rebase`;
  - no repositório do GitHub: `gh repo` inteiro, o que inclui apagar,
    arquivar, renomear e mudar a visibilidade.
- **A proteção da `main` no GitHub não é independente do agente.** As sessões
  usam a conta do dono, que administra o repositório, e `gh api *` está no
  `allow`. Uma chamada de escrita à API pode alterar ou apagar a proteção da
  branch. A lista `deny` recusa os comandos de push direto e force push, mas
  não essa chamada: o que a impede é só a regra escrita. Separar a credencial
  do agente da do dono fecharia isso e fica fora desta decisão.
- **O label `dono-liberou` continua ao alcance da sessão por caminho
  indireto.** A `deny` recusa `gh pr edit`, `gh issue edit`, `gh label` e
  `gh api` quando o nome do label aparece no comando. Uma chamada `gh api`
  que leve o nome num arquivo (`--input`) ou use o identificador do label
  não casa com nenhuma delas, e antes caía no `ask`. Como a sessão usa a
  conta do dono, o check "scanner protegido" não distingue os dois. O que
  impede é a regra escrita; a trava de verdade seria a credencial separada
  do item anterior. A regra nova também recusa consulta de leitura que cite
  o nome do label.
- **A segunda aprovação do dono, a do resultado, deixa de existir.** Até
  aqui o `CLAUDE.md` dizia que o plano era a primeira aprovação e a PR a
  segunda. Fica só a do plano.
- **Merge sem OK em chat:** a mesma sessão que escreveu confere e liga o
  merge. Uma PR com CI verde e conferência fechada entra na `main` sem o dono
  ter lido a mensagem final da sessão. O que ele decide continua sendo o
  plano, antes, e o deploy, depois; merge na `main` não publica.
- **O merge não fica preso ao commit conferido.** A sessão confere o commit na
  hora de ligar; push, comentário ou review que cheguem depois só seguram o
  merge se a sessão perceber e desarmar a tempo. A fila repete a CI, não a
  conferência nem a revisão do Codex. Era assim com o OK em chat; a diferença
  é que não há mais uma pessoa entre a conferência e o merge.
- **Fila de merge: fora desta decisão.** O dono pediu para tirá-la também, e
  ela continua ligada: na conferência apareceu que a lista de nomes reais
  (`PT_NOMES_PROIBIDOS`) só entra na CI em `push` e na fila, não em
  `pull_request`. Sem a fila, essa parte da varredura deixaria de rodar antes
  de o commit entrar na `main`. Fica para decisão dele com esse dado.
- **Voltar atrás:** a lista `ask` está no histórico do
  `.claude/settings.json` (commit anterior a esta PR).
