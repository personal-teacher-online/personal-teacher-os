---
name: orquestrar
description: Rodada da orquestradora: escolhe issues abertas do GitHub, abre uma trabalhadora por issue em worktree, roda o revisor-adversarial em toda PR e o gate Sol nas de risco, manda os achados de volta, liga o auto-merge quando as travas passam e resume ao dono. Usar quando o dono disser "rodada de N" (uma rodada com N issues) ou "até acabar" (emenda rodadas até esvaziar a fila). Não faz deploy.
---

# Orquestrar uma rodada

A orquestradora é a sessão fixa do dono, aberta na **pasta principal** do projeto, em `main`, com o modelo
Opus escolhido no app. Ela **não edita código**: escolhe, abre trabalhadoras, julga os gates, liga o
auto-merge e relata. Deploy continua manual, pelo runbook (`docs/ops/runbook-vps.md`), quando o dono pedir.

Modelos: trabalhadora em `sonnet` (padrão do agente) ou `opus` quando a issue tem label `risco:*` ou toca caminho protegido;
`revisor-adversarial` em `opus` (fixo no agente); `listar-issues` em `haiku`; gate Sol no codex.

## Regras deste projeto (vêm do CLAUDE.md e valem por cima de tudo)

- **Quantas por rodada: o dono diz** ("rodada de 4"). Sem número, perguntar antes de abrir.
- **Bancada única.** Nenhuma trabalhadora roda `supabase db reset` nem a suíte completa; só testes focados.
  O CI é o juiz (~11 min por rodada do check "tsc + lint + suíte").
- **Uma migration por vez.** No máximo UMA issue com `risco:migration` por rodada, e nenhuma enquanto houver
  PR aberta que toque `supabase/migrations/` (`gh pr list --state open --json number,files -q
  '.[] | select(any(.files[]; .path | startswith("supabase/migrations/"))) | .number'`).
- **Caminhos protegidos** (PR que toca neles só entra em auto-merge com gate reforçado: gate Sol obrigatório
  e revisor sem achado do item 10, "regra afrouxada"; ADR-041): `.github/`,
  `.claude/`, `.githooks/`, `supabase/migrations/`, `supabase/seed.sql`, `docs/ops/runbook-vps.md`,
  `Dockerfile`, `next.config.ts`, `CLAUDE.md`, `AGENTS.md`, `Design.md`, `scripts/vazamento*`.
- **`main` verde.** A última rodada do CI na `main` precisa estar verde; vermelha = parar, abrir issue `bug`
  com `precisa-do-leo` e não abrir rodada.

## Pré-condições (todas; se uma falhar, parar e dizer ao dono qual)

1. Sessão na pasta principal (`git rev-parse --show-toplevel` sem `.claude/worktrees`), em `main`, sem
   mudança pendente em arquivo versionado (`git status --short` só com `??`).
2. `git fetch origin` e `git pull --ff-only`: `main` igual a `origin/main`.
3. `gh run list --branch main --limit 1 --json status,conclusion,databaseId`: `conclusion` = `success`.
   Se `status` ainda é `in_progress` ou `queued` (a `main` acabou de receber um merge), esperar **dentro
   do mesmo turno** com `gh run watch <databaseId>` (Bash com timeout de 900000 ms; se o timeout estourar,
   reconsultar o status e repetir o watch) e reconsultar; não
   encerrar o turno para "esperar" (medido em 15/10: a rodada ficou parada 10 min até alguém cutucar).
   Só `failure` (ou `cancelled`) para a rodada.
4. Nenhuma issue aberta com label `parar` (o agente `listar-issues` avisa).
5. O dono disse quantas issues pegar.

## Rodada

1. **Listar.** Agent `listar-issues` (`subagent_type: listar-issues`). Guardar a tabela.
2. **Escolher** as N primeiras da tabela, respeitando "uma migration por vez". Antes de abrir, ler cada issue
   (`gh issue view <N>`); se o texto não diz o que o dono quer ver na tela nem dá para deduzir dos documentos
   (`CLAUDE.md`, `docs/goals/`, `docs/decisions/`), não abrir trabalhadora: comentar a pergunta na issue, pôr
   `decisao` e pegar a próxima. Se a leitura mostrar label `decisao`, `parar`, `precisa-do-leo` ou
   `sessao-manual` posto depois da listagem, pular a issue. Conferir a coluna `espera` da tabela: issue com
   `espera` preenchida não abre trabalhadora (o lugar dela é o bloco de excluídas).
   Issue cujo trabalho toca caminho protegido (pelo `## Arquivos prováveis` ou pelo título) abre trabalhadora
   em `opus`, como as de `risco:*`: a PR vai passar pelo gate reforçado.
3. **Abrir as trabalhadoras**, todas na mesma mensagem (rodam em paralelo), com
   `subagent_type: trabalhadora`, `isolation: "worktree"`, `run_in_background: true`, e `model: "opus"` se a
   issue tem label `risco:*` ou toca caminho protegido (senão deixar o padrão, `sonnet`). Prompt: `Issue #N` e nada mais. Guardar o
   nome do agente para o passo 6. O hook `SubagentStart` instala as dependências na worktree (`npm ci`,
   ~40 s) e liga o pre-commit.
4. **Quando uma trabalhadora termina**, ler a resposta dela:
   - `PAROU`: a pergunta já está na issue com `decisao`. Registrar no resumo, remover a worktree (passo 10)
     e seguir.
   - `FALHOU`: registrar o motivo, pôr o label `precisa-do-leo` na issue, remover a worktree (passo 10) e
     seguir.
   - `PR aberta`: seguir para os gates. Se em `## Gates` o `/code-review` consta como "não rodou" (a skill
     pode não existir dentro de um subagente), a orquestradora roda `/code-review <M>` (skill `code-review`,
     argumento = número da PR) e trata os achados como os do revisor.
5. **Gates da orquestradora** (sempre, em toda PR):
   - **`revisor-adversarial`** (Agent, `subagent_type: revisor-adversarial`), prompt com o número da issue, o
     número da PR e o **caminho absoluto da worktree** que a trabalhadora devolveu. Ele lê os arquivos lá e
     roda `git -C <worktree> diff origin/main...HEAD`.
   - **Gate Sol**, se a issue tem label `risco:*` ou o diff toca o que a skill `gate-sol` lista (inclusive
     caminho protegido; lista de arquivos por `git -C "<worktree>" diff --name-only origin/main...HEAD`,
     nunca por `gh pr view --json files`, que corta em 100 arquivos): skill
     `gate-sol`, passando o caminho da worktree, pela ferramenta Bash.
   - Veredito inválido (resposta vazia, erro, sem "OK" nem lista de achados, **ou "OK" sobre diff vazio**:
     conferir antes `git -C "<worktree>" diff --stat origin/main...HEAD` não vazio): rodar de novo uma vez;
     se continuar inválido, a PR não mergeia sozinha (ver Travas).
6. **Achado do item 10** do revisor ou do item (11) do Sol (os dois começam com `[regra afrouxada]`; na
   dúvida, todo Crítico ou Aviso sobre `.claude/settings.json`, `.github/` ou `.githooks/` conta como um), não vai para correção nem
   aceita refutação na rodada ("a issue pediu" não vale): marcar a PR como draft (`gh pr ready --undo <M>`),
   pôr `precisa-do-leo` e `sessao-manual` na issue e anotar no resumo. Afrouxar regra é decisão do dono numa
   sessão manual (ADR-041). Os outros achados seguem abaixo.
   **Correção**, se houve achado Crítico ou Aviso: anotar o commit atual da PR (`<sha-antes>`), mandar a lista
   inteira à mesma trabalhadora (`SendMessage` com o nome dela), pedindo para corrigir com teste ou refutar
   com `arquivo:linha`, e atualizar a PR. Se a trabalhadora não responder (o agente já encerrou), abrir uma
   `trabalhadora` nova **sem** `isolation`, com o prompt "Issue #N, PR #M, worktree `<caminho>`: corrija
   estes achados" e a lista. Quando ela voltar, rodar o `revisor-adversarial` de novo **só sobre o diff
   novo**, passando no prompt o intervalo `<sha-antes>..HEAD`. **Duas rodadas no máximo**; se ainda sobrar
   Crítico ou Aviso não refutado, marcar a PR como draft (`gh pr ready --undo <M>`), pôr `precisa-do-leo` na
   issue, e seguir.
7. **Preencher `## Gates` na PR** (`gh pr edit <M> --body-file ...`, mantendo o resto do corpo) com o resultado
   do revisor e do gate Sol, no formato da skill `abrir-pr`.
8. **Travas, todas, antes de ligar o auto-merge:**
   - `gh pr view <M> --json isDraft,mergeable,mergeStateStatus`: não é draft, `MERGEABLE` (sem conflito).
     `UNKNOWN` não é trava: esperar 20 s e reconsultar, até 3 vezes. `CONFLICTING` segura; `BEHIND` (a
     `main` andou e a trava `strict` ainda estiver ligada) não é recusa: mandar a trabalhadora trazer a
     `main` por merge (nunca rebase), esperar o CI e voltar a este passo;
   - revisor com veredito válido e sem Crítico/Aviso em aberto; gate Sol idem quando se aplica;
   - **nenhum comentário nem review na PR** (`gh pr view <M> --json comments,reviews`): todo agente posta com
     a conta do dono, então qualquer comentário na PR conta como dele. Por isso **a orquestradora e a
     trabalhadora nunca comentam na PR**: o que precisam registrar vai no corpo da PR (`gh pr edit`) ou na
     issue (`gh issue comment`);
   - se a PR **toca** caminho protegido (`git -C "<worktree>" diff --name-only origin/main...HEAD`; se o
     caminho protegido apareceu só depois da rodada do Sol, isto é, `<sha-do-sol>..HEAD` o toca, rodar o Sol de
     novo nesse intervalo, com o item (11), antes deste passo): gate Sol rodado
     de fato (não "não se aplica", não "não rodou", não "dispensado": em caminho protegido não há dispensa,
     porque o comentário que dispensaria sai pela conta do dono e qualquer agente o escreve) e sem
     Crítico/Aviso em aberto, e o revisor sem achado do
     item 10 ("regra afrouxada"). Faltou um dos dois: `precisa-do-leo` na issue e aviso no resumo;
   - a CI existe e está rodando ou verde (`gh pr checks <M>`): CI ausente é recusa, não aprovação.
     Logo depois de um push o GitHub responde "no checks reported" por ~30 s (o run antigo é cancelado
     e o novo ainda não começou): esperar 30 s e reconsultar antes de tratar como ausente.
   Passou em tudo: `gh pr merge <M> --auto --squash` e comentar na issue "PR #M com auto-merge ligado".
   Falhou em alguma: comentar na **issue** qual trava segurou, pôr `precisa-do-leo` na issue e seguir.
9. **Esperar a CI** das PRs com auto-merge: `gh pr checks <M> --watch` em segundo plano (Bash com
   `run_in_background: true`); o CI leva ~11 min. **Enquanto espera**, a cada 5 min reconsultar
   `gh pr view <M> --json comments,reviews`: apareceu comentário ou review, é o dono; desarmar na hora
   (`gh pr merge <M> --disable-auto`), pôr `precisa-do-leo` na issue e seguir.
   **CI vermelha:** primeiro desarmar (`gh pr merge <M> --disable-auto`), senão a correção mergeia sem
   revisão quando a CI do commit novo ficar verde. Depois ler o passo que falhou
   (`gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId'` e
   `gh run view <id> --log-failed`), separar ambiente (runner, cota de minutos: job sem passo nenhum é
   bloqueio de cobrança da conta, não é bug) de teste de produto, e mandar à trabalhadora (uma rodada de
   correção, conta nas duas do passo 6). Nunca afrouxar teste para passar: se o teste revela bug, o bug é o
   problema. Quando ela voltar: passo 5 sobre o diff novo e passo 8 inteiro de novo antes de religar o
   auto-merge. Vermelha de novo, `precisa-do-leo`.
10. **Depois do merge** de cada PR (e no `PAROU`/`FALHOU` do passo 4): `git pull --ff-only` na pasta
    principal e remover a worktree da trabalhadora, a partir da pasta principal (nunca `cd` para dentro de
    `.claude/worktrees`: o app troca o diretório da sessão). **Só remover caminho que contém
    `.claude/worktrees/`**: `git worktree remove "<caminho>"` e, depois de confirmar `gh pr view <M> --json
    state -q .state` = `MERGED`, `git branch -D <branch que a trabalhadora devolveu>` (o merge é por squash,
    então `-d` recusa com "not fully merged"; a remota o GitHub apaga no merge). No `PAROU`/`FALHOU` sem PR,
    remover a worktree e, se a branch tem commit à frente da `main` (`git log main..<branch> --oneline` não
    vazio), **não** apagar a branch nem fazer push (o repositório é público): ela fica local e entra no
    resumo ("branch `<nome>` guardada com trabalho parado"). Sem commit à frente, `-D`.
11. **Resumo ao dono**, em português, uma linha por issue: número, o que mudou (do ponto de vista de quem
    usa), estado (mergeada / auto-merge ligado, esperando CI / precisa-do-leo: motivo / decisao: pergunta).
    Depois, um bloco **"Mudou regra ou estrutura"**: uma linha por PR que tocou caminho protegido, dizendo
    em linguagem de negócio o que passa a valer (ex.: "a orquestradora agora pode X", "tabela de créditos
    ganhou a coluna Y; entra no próximo deploy"). No fim: quantas issues elegíveis sobraram, se há migration
    na `main` esperando deploy e se há algo com `precisa-do-leo`. Lembrar que o deploy é dele e que, para segurar uma PR com auto-merge ligado, ele
    comenta nela (a orquestradora desarma na próxima conferência) ou, para segurar na hora, converte em
    draft ou fecha.

"**Até acabar**": terminada a rodada (todas as PRs mergeadas ou paradas), `git pull --ff-only`, conferir a
`main` verde e voltar ao passo 1 com o mesmo N, até a tabela do `listar-issues` vir vazia ou aparecer
`PARAR`. Entre rodadas, nada de deploy.

## O que a orquestradora nunca faz

- Editar código, commitar ou fazer push de código próprio; o que vê de errado vira issue (`gh issue create`).
- Mergear à força, pular o CI, mexer em PR que o dono comentou, ou ligar auto-merge em PR de caminho
  protegido sem o gate reforçado do passo 8.
- Pôr o label `dono-liberou` (isenta da trava da CI sobre o scanner e os hooks; é só do dono).
- Deploy sem o dono pedir. Tocar a produção, a VPS ou o banco da bancada (reset, suíte completa).
- Abrir mais issues por rodada do que o dono disse, ou uma segunda migration com outra em aberto.
- Reabrir uma issue com `precisa-do-leo` ou `decisao` antes de o dono tirar o label.
