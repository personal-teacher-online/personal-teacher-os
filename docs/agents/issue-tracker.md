# Onde ficam as issues: GitHub

As issues e as especificações deste repositório são issues do GitHub. Todas as operações usam o `gh`.

## O repositório é público

Tudo o que se escreve em issue, especificação, ticket ou PR sai na hora e não se apaga. Dado real (nome de
pessoa, e-mail, telefone, CPF ou CNPJ, IP e usuário da VPS, segredo) não entra no texto: papel no lugar do
nome ("a dona", "a professora", "a aluna"), `<servidor>` no lugar da máquina, valor inventado no lugar do
real. As formas aceitas estão em `.claude/rules/dados-de-teste.md`. Texto em português.

Toda issue que mexe numa Lei do `CLAUDE.md` leva o label `risco:*` correspondente: `risco:dinheiro`,
`risco:ledger`, `risco:fuso`, `risco:rls`, `risco:migration`, `risco:envio`. Só uma PR aberta pode conter
migration por vez; issue com `risco:migration` espera a anterior entrar.

Comentário em PR é do dono: agente registra no corpo da PR ou na issue.

## Convenções

- **Criar uma issue**: `gh issue create --title "..." --body-file <arquivo>`, com o corpo num arquivo da pasta
  temporária da sessão. O modelo da casa é `.github/ISSUE_TEMPLATE/tarefa.md`.
- **Ler uma issue**: `gh issue view <número> --json number,title,body,labels,comments`.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, com os filtros `--label` e `--state` que couberem.
- **Tornar uma issue filha de outra**: `gh issue create --parent <mãe> ...`, ou depois `gh issue edit <mãe> --add-sub-issue <filha>`.
- **Comentar**: `gh issue comment <número> --body-file <arquivo>`.
- **Pôr ou tirar label**: `gh issue edit <número> --add-label "..."` / `--remove-label "..."`. O label
  `dono-liberou` é só do dono, pela interface do GitHub.
- **Fechar**: `gh issue close <número> --comment "..."`.

O repositório vem de `git remote -v`; o `gh` faz isso sozinho dentro do clone.

## PR como fila de pedidos

**PR como pedido: não.** Este repositório não recebe PR de fora.

O GitHub usa uma numeração só para issue e PR: um `#42` solto pode ser qualquer um dos dois. Resolver com
`gh pr view 42` e, se não for, `gh issue view 42`.

## Quando uma skill diz "publicar no rastreador de issues"

Criar uma issue no GitHub.

## Quando uma skill diz "buscar o ticket"

Ler como em **Ler uma issue**, acima.

## Regras da casa que valem sobre o texto das skills

- **Spec e ticket** levam os campos do modelo da casa (`.github/ISSUE_TEMPLATE/tarefa.md`): objetivo, regra de
  negócio com a fonte, critérios de aceite verificáveis, testes esperados e risco. `gh issue create` não aplica
  o modelo sozinho: quem cria escreve os campos. O risco é dito no corpo e o label `risco:*` é posto na criação.
- **`pronta`** só depois de o dono aprovar a especificação. Os cinco labels de triagem não convivem na mesma
  issue, e `precisa-do-leo` também exclui `pronta`: agente só pega issue que tem `pronta`, nenhum dos outros quatro de triagem e não tem `precisa-do-leo`. Labels de
  risco e de assunto (`risco:*`, `bug`, `divida`, `ui`) convivem com `pronta`.
- **PR** no modelo da casa (`.github/pull_request_template.md`), com "Migration" e "Conferência". O formato da
  skill `/pr` (resumo, evidência, perigo do merge) entra dentro dessas seções, não no lugar delas.
- **Testes**: local, só os focados (`.claude/rules/testes.md`). Onde uma skill mandar rodar a suíte completa
  ao final, quem roda é a CI da PR: a bancada é uma só e compartilhada.
- **Migration**: tickets com migration não rodam em paralelo. Um por vez, com timestamp posterior ao último;
  só uma PR aberta pode conter migration.
- **Worktree**: cada agente que edita trabalha na própria worktree, nunca na pasta principal nem na de outro.

## Como o trabalho fecha

O trabalho entra na `main` por PR. A `main` tem fila de merge, que roda a CI de novo no commit que entra.
Merge na `main` não publica: deploy é manual, pelo runbook.

Quem liga o merge é a sessão que abriu a PR, **sem esperar OK do dono em chat** (decisão de 17/11/2026,
ADR-046, que troca a de 09/11/2026). As regras:

1. **Antes de ligar, recalcular** (não ler do corpo da PR): `gh pr view <M> --json isDraft,mergeable,comments,reviews,headRefOid`
   sem draft, `MERGEABLE`, nenhum comentário nem review do dono em aberto (ver item 3), e `headRefOid` igual ao `git rev-parse HEAD`
   da worktree; `gh pr checks <M>` rodando ou verde; a seção "Conferência" com veredito, inclusive a revisão do
   Codex quando `.claude/rules/mudanca-de-risco.md` a exige. Faltou uma: dizer qual e não ligar.
2. **Ligar amarrado ao commit**: `gh pr merge <M> --match-head-commit <os 40 caracteres do head, por extenso> --auto --squash`.
   Nunca variável de shell no lugar do SHA: ela não sobrevive entre chamadas, e a flag vazia liga o merge sem
   amarrar a commit nenhum, sem erro. Registrar no corpo da PR ou na issue a hora e o commit. O
   `--match-head-commit` só confere o SHA na hora da chamada: ele **não** prende o merge àquele commit, e um
   push posterior feito com a conta do dono (qualquer sessão) entra junto. A única defesa é a do item 3.
3. **Todo push depois de ligar desarma.** Antes do push, `gh pr merge <M> --disable-auto`; depois, conferência
   de novo (item 1) e ligar de novo no commit novo. CI vermelha, ou comentário ou review do dono: desarmar
   primeiro (`--disable-auto`) e avisar o dono. Comentário ou review dele fica em aberto, e segura o merge,
   até ele dizer em chat, nomeando a PR, que pode seguir; atender ao que ele pediu não fecha o comentário
   sozinho.
   Se a PR já estiver na fila de merge, o `gh pr` não a tira de lá (`gh pr ready --undo` só a vira em
   rascunho): usar a mutação GraphQL `dequeuePullRequest` pelo `gh api graphql` e **conferir que saiu** antes
   de seguir.
4. **Acompanhar até `MERGED`**; só então o trabalho está entregue. No resumo da rodada, dizer ao dono em
   linguagem de negócio o que entrou.

## Operações do wayfinder

Usadas pela `/wayfinder`. O **mapa** é uma issue só, e os tickets são issues **filhas** dela.

- Os labels `wayfinder:*` ainda não existem neste repositório: criar com `gh label create` no primeiro uso.
- **Mapa**: uma issue com o label `wayfinder:map`, com o corpo Destino / Notas / Decisões até aqui.
  `gh issue create --label wayfinder:map`.
- **Ticket filho**: issue ligada ao mapa como sub-issue (ver **Tornar uma issue filha de outra**). Labels:
  `wayfinder:<tipo>` (`research`, `prototype`, `grilling`, `task`). Quem pega o ticket vira o responsável.
- **Bloqueio**: as dependências nativas do GitHub. Acrescentar com
  `gh api --method POST repos/<dono>/<repo>/issues/<filha>/dependencies/blocked_by -F issue_id=<id-do-banco-da-que-bloqueia>`,
  onde o id é o numérico do banco (`gh api repos/<dono>/<repo>/issues/<n> --jq .id`), não o `#número`. Onde isso não
  estiver disponível, uma linha `Bloqueada por: #<n>, #<n>` no topo do corpo da filha. O ticket está livre quando
  todas as que o bloqueiam estão fechadas.
- **Fronteira**: listar as filhas abertas do mapa, tirar as que têm bloqueio aberto ou responsável; a primeira na
  ordem do mapa vence.
- **Pegar**: `gh issue edit <n> --add-assignee @me`, a primeira escrita da sessão.
- **Resolver**: `gh issue comment <n> --body-file <resposta>`, depois `gh issue close <n>`, depois acrescentar uma
  linha (resumo e link) em "Decisões até aqui" do mapa.
