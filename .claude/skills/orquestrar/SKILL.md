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
  O CI é o juiz (~7 min por rodada do check "tsc + lint + suíte", medido em 09/11/2026; cada PR roda a CI
  três vezes: push na branch, grupo da fila de merge e push na `main`).
- **Uma migration por vez.** No máximo UMA issue com `risco:migration` por rodada, e nenhuma enquanto houver
  PR aberta que toque `supabase/migrations/` (`gh pr list --state open --json number,files -q
  '.[] | select(any(.files[]; .path | startswith("supabase/migrations/"))) | .number'`).
- **Caminhos protegidos** (PR que toca neles só entra em auto-merge com gate reforçado: gate Sol obrigatório
  e revisor sem achado do item 10, "regra afrouxada"; ADR-041): `.github/`,
  `.claude/`, `.githooks/`, `supabase/migrations/`, `supabase/seed.sql`, `docs/ops/runbook-vps.md`,
  `Dockerfile`, `next.config.ts`, `CLAUDE.md`, `AGENTS.md`, `Design.md`, `scripts/vazamento*`.
- **`main` verde.** A `main` precisa estar verde antes de abrir rodada; vermelha = parar, abrir issue `bug`
  com `precisa-do-leo` e não abrir rodada. **Fila verde conta como `main` verde** (decisão do dono, 09/11/2026,
  #161): a fila de merge (`ALLGREEN`, 1 entrada) testa o commit exato que vira a `main`, então o grupo da fila
  (`merge_group`) verde para o commit que está na ponta da `main` é o veredito; o run do `push` na `main`
  repete o mesmo trabalho ~7 min depois e fica no `ci.yml` só como rede. A orquestradora não espera por ele.

## Pré-condições (todas; se uma falhar, parar e dizer ao dono qual)

1. Sessão na pasta principal (`git rev-parse --show-toplevel` sem `.claude/worktrees`), em `main`, sem
   mudança pendente em arquivo versionado (`git status --short` só com `??`).
2. `git fetch origin` e `git pull --ff-only`: `main` igual a `origin/main`.
3. `main` verde, na ordem: (a) `gh run list --event merge_group --limit 5 --json headSha,conclusion,status`
   tem uma execução com `headSha` igual a `git rev-parse origin/main` e `conclusion` = `success`: pronto, a
   fila já provou esse commit (medido em 09/11/2026: o `headSha` do grupo da fila é o próprio commit que
   vira a `main`). (b) Sem execução da fila para esse commit (merge do dono fora da fila, push direto que o
   ruleset recusa, ou commit anterior à fila), `gh run list --branch main --limit 1 --json
   status,conclusion,databaseId`: `conclusion` = `success`. Se `status` ainda é `in_progress` ou `queued`,
   esperar **dentro do mesmo turno** com `gh run watch <databaseId>` (Bash com timeout de 900000 ms; se o
   timeout estourar, reconsultar o status e repetir o watch); não encerrar o turno para "esperar" (medido em
   15/10: a rodada ficou parada 10 min até alguém cutucar). Só `failure` (ou `cancelled`) do run que vale,
   o da fila em (a) ou o do push em (b), para a rodada. Run do push na `main` vermelho com a fila verde
   para o **mesmo commit** não para a rodada: é ambiente (runner, cota) ou teste que flakeia; ler o passo
   que falhou, abrir issue `divida` se foi teste, registrar no resumo e seguir.
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
     `gate-sol`, passando o caminho da worktree, pela ferramenta Bash (a skill entra na worktree com `cd`
     dentro de um subshell, que não muda o diretório da sessão).
   - **Codex sem cota** ("usage limit" no `.log` ou na saída): não é veredito inválido e rodar de novo no
     mesmo dia não adianta (a cota é da assinatura do dono e volta no dia seguinte). Registrar "Gate Sol: sem
     cota em DD/MM" em `## Gates`, **não ligar o auto-merge**, pôr `precisa-do-leo` na issue dizendo que
     falta só o gate Sol, e avisar no resumo que o gate roda quando a cota voltar, a pedido do dono (skill
     `gate-sol`; o `listar-issues` não devolve issue com `precisa-do-leo`, então a rodada seguinte não a pega
     sozinha). Aqui não existe "o revisor cobre no lugar do Sol": em caminho protegido e com `risco:*` o
     passo 8 exige Sol rodado de fato (ADR-041), e fora deles o Sol não se aplica.
   - Veredito inválido (resposta vazia, erro, sem "OK" nem lista de achados, **ou "OK" sobre diff vazio**:
     conferir antes `git -C "<worktree>" diff --stat origin/main...HEAD` não vazio): rodar de novo uma vez;
     se continuar inválido, a PR não mergeia sozinha (ver Travas).
6. **Achado do item 10** do revisor ou do item (11) do Sol (os dois começam com `[regra afrouxada]`; na
   dúvida, todo Crítico ou Aviso sobre `.claude/settings.json`, `.github/` ou `.githooks/` conta como um), não vai para correção nem
   aceita refutação na rodada ("a issue pediu" não vale): marcar a PR como draft (`gh pr ready --undo <M>`),
   pôr `precisa-do-leo` e `sessao-manual` na issue e anotar no resumo. Afrouxar regra é decisão do dono numa
   sessão manual (ADR-041). Os outros achados seguem abaixo.
   **Correção**, se houve achado Crítico ou Aviso: anotar o commit atual da PR (`<sha-antes>`, de
   `gh pr view <M> --json headRefOid`) e a branch da PR no GitHub (`gh pr view <M> --json headRefName`; aqui
   ela tem o mesmo nome da branch local da trabalhadora). O agente `trabalhadora` tem `isolation: worktree`:
   toda instância nasce na própria worktree e a ferramenta recusa `git` em outra, então **não existe**
   trabalhadora "apontada" para a worktree da PR (medido no lotufo em 30/10/2026: 1 de 7 parou, 6
   improvisaram). O caminho é:
   - A trabalhadora devolve **um push só** por rodada de correção (a CI cancela e recomeça a cada push, ~7 min
     de Supabase jogados): não rodar o revisor em commit intermediário, só sobre `<sha-antes>..<sha-depois>`
     da resposta dela (ou `origin/main...HEAD`, se a rodada incluiu `git merge origin/main`, como abaixo).
   - Mandar a lista inteira à mesma trabalhadora (`SendMessage` com o nome dela), pedindo para corrigir com
     teste ou refutar com `arquivo:linha`, e atualizar a PR. Ela ainda está na worktree dela e é a opção
     preferida. Só conta como "não respondeu" o `SendMessage` avisar que o agente já encerrou ou não existe;
     **sem prazo em minutos** (uma trabalhadora corrigindo com teste pode demorar, e duas corrigindo a mesma
     PR deixam o push da segunda recusado e o `<sha-antes>` sem bater).
   - Se ela não responder (nesse sentido), conferir antes `gh pr view <M> --json headRefOid`. Se já **não** é
     o `<sha-antes>`, a correção subiu enquanto se esperava: não abrir ninguém, rodar o `revisor-adversarial`
     sobre `<sha-antes>..<headRefOid>` na worktree de quem corrigiu. Se ainda é o `<sha-antes>`, abrir uma
     `trabalhadora` **nova, isolada como sempre** (`isolation: "worktree"`, `run_in_background: true`, mesmo
     modelo da original), com o prompt "Issue #N, PR #M, branch no GitHub `<branch>`: corrija estes achados"
     e a lista. Na worktree nova ela aponta a branch local dela para `origin/<branch>` (`git fetch origin` e
     `git checkout -B <nome da branch local lido com git branch --show-current> origin/<branch>`, o nome
     literal, sem substituição de comando e sem renomear a branch), corrige com teste e faz
     `git push origin HEAD:<branch>`, a mesma branch remota da PR. A worktree original fica parada no commit
     antigo; não importa, o que vale é o remoto.
   - Quando a correção voltar (resposta `estado: PR corrigida`, com `sha-antes / sha-depois` e a worktree de
     quem corrigiu), rodar o `revisor-adversarial` de novo **só sobre o diff novo**, passando no prompt o
     **caminho da worktree de quem corrigiu** (o da trabalhadora nova, se foi ela: é ela que tem o commit
     novo) e o intervalo `<sha-antes>..HEAD`. Se a correção incluiu `git merge origin/main` (passo 8,
     `BEHIND`, ou fila vermelha), esse intervalo traria código de outras PRs: nesse caso o revisor recebe
     `origin/main...HEAD`. O gate Sol não roda de novo sobre a correção, salvo se ela mexeu em lógica de
     dinheiro, ledger, fuso, RLS ou envio de forma grande, ou se a PR toca caminho protegido e a correção
     tocou o caminho protegido de novo (passo 8: Sol rodado de fato sobre o que entra); nesses casos roda
     dessa mesma worktree só sobre o diff novo.
   - **Mesma família de achado pela 2ª vez em pontos diferentes** (ex.: três leituras separadas do mesmo
     saldo; três telas com a mesma data crua): pedir à trabalhadora a correção que fecha a família inteira,
     não o ponto.
   - **Duas rodadas no máximo**; se ainda sobrar Crítico ou Aviso não refutado, marcar a PR como draft
     (`gh pr ready --undo <M>`), pôr `precisa-do-leo` na issue, e seguir. (O lotufo deixa Aviso que sobra
     virar issue e a PR seguir; aqui isso é decisão pendente do dono, porque o revisor marca violação de Lei
     também como Aviso: `docs/fluxo-comparacao-lotufo-2026-11-09.md` §3.) Rodada extra só por pedido do dono,
     registrado na issue; quando o revisor (e o Sol, se aplicável) dessa rodada volta sem Crítico/Aviso em
     aberto, tirar o draft (`gh pr ready <M>`) e o `precisa-do-leo`, e só então ir ao passo 8.
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
   Passou em tudo: gravar a hora (`date -u +%Y-%m-%dT%H:%M:%SZ`), `gh pr merge <M> --auto --squash` e comentar
   na issue "PR #M com auto-merge ligado às AAAA-MM-DDTHH:MM:SSZ" (a hora gravada, com segundos). Essa hora é o
   **armamento** que o passo 9 usa: só contam execuções da fila criadas a partir dela. A `main` tem fila de
   merge (ruleset, desde 30/10/2026, `ALLGREEN` com 1 entrada): com a CI da PR verde, o GitHub põe a PR na
   fila, junta com a `main` atual e roda a CI de novo nessa mistura (evento `merge_group`) antes de mesclar.
   Falhou em alguma: comentar na **issue** qual trava segurou, pôr `precisa-do-leo` na issue e seguir.
9. **Vigiar a PR depois do auto-merge.** Para cada PR com auto-merge ligado, lançar o vigia versionado ao
   lado desta skill, em segundo plano (Bash com `run_in_background: true`), pelo **caminho absoluto da pasta
   principal** (o `cd` do Bash pode estar numa worktree antiga sem o arquivo):
   `<pasta principal>/.claude/skills/orquestrar/vigia.sh <M> 120 60 <hora do armamento>` (no Windows,
   `powershell -NoProfile -ExecutionPolicy Bypass -File <pasta principal>\.claude\skills\orquestrar\vigia.ps1 <M> 120 60 <hora do armamento>`).
   A hora do armamento (`AAAA-MM-DDTHH:MM:SSZ`, UTC) é a que a orquestradora gravou antes do `gh pr merge
   --auto` no passo 8: só contam execuções da fila criadas a partir dela. Com a CI já verde a PR entra direto
   na fila e a execução `merge_group` nasce ~20 s depois, antes de o vigia subir; sem a hora, uma fila
   vermelha viraria `AUTO_MERGE_DESLIGADO`. Sem o argumento o script recua o corte para agora menos 10 min.
   Não escrever vigia no scratchpad nem usar `gh pr checks --watch`: um vigia que só espera "mergeada ou
   fora da fila" deixou uma PR do lotufo 1h32 com a CI vermelha em 03/11/2026, porque a PR nunca entrou na
   fila. O vigia faz uma consulta GraphQL a cada 2 min e termina na primeira palavra abaixo; quando voltar,
   a orquestradora faz o que a linha manda:
   - `MERGED`: passo 10.
   - `ERRO` (saída 2: PR inexistente ou `gh` falhando): conferir `gh auth status`; se a PR existe, relançar o
     vigia; senão `precisa-do-leo` na issue.
   - `CI_VERMELHA` (algum check da branch com falha; não espera a fila): **CI vermelha**, abaixo.
   - `FILA_VERMELHA` (o grupo da fila, branch `gh-readonly-queue/main/pr-<M>-...`, falhou): em geral choque
     com outra PR que entrou antes; tratar como CI vermelha, pedindo à trabalhadora `git merge origin/main`
     junto da correção.
   - `AUTO_MERGE_DESLIGADO` (nem auto-merge armado nem PR na fila; o script já trata como armada a PR que
     entrou direto na fila). Todo agente posta com a conta do dono, então o `actor.login` não separa a
     orquestradora do dono: o que separa é o tempo. Seja `<armamento>` a hora do último "PR #M com auto-merge
     ligado às ..." que a orquestradora registrou na issue. Antes de religar, ver por que desligou, com uma
     consulta só:
     `gh api graphql -f query='{repository(owner:"personal-teacher-online",name:"personal-teacher-os"){pullRequest(number:<M>){mergeable mergeStateStatus a:timelineItems(last:5,itemTypes:[AUTO_MERGE_DISABLED_EVENT]){nodes{... on AutoMergeDisabledEvent{reason reasonCode createdAt}}} f:timelineItems(last:5,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{... on RemovedFromMergeQueueEvent{reason createdAt}}}}}}'`.
     (1) `AutoMergeDisabledEvent` com `createdAt` **posterior** ao `<armamento>` e `reasonCode`
     `manually_disabled` é o dono (a orquestradora só desarma antes de religar, e religar grava novo
     `<armamento>`): `precisa-do-leo` e **não religar**; eventos anteriores ao `<armamento>` são desarmes da
     própria orquestradora e não contam. (2) Sem desarme posterior, olhar o `RemovedFromMergeQueueEvent` mais
     recente (posterior ao `<armamento>`): `reason` de conflito (`merge_conflict`), ou `mergeable`
     `CONFLICTING`/`mergeStateStatus` `DIRTY`, é conflito, então mandar a trabalhadora fazer
     `git merge origin/main`, como na fila vermelha; qualquer outro `reason` é falha da fila (a PR que entrou
     direto na fila não gera `AutoMergeDisabledEvent` quando a fila falha: gera `RemovedFromMergeQueueEvent`),
     então tratar como CI vermelha. (3) Check com falha também é CI vermelha. Só com CI verde, sem conflito e
     sem desarme manual, religar com `gh pr merge <M> --auto --squash` depois de repetir as travas do passo 8
     (gravando nova hora e novo comentário na issue).
   - `COMENTARIO` (comentário ou review novo; é o dono): desarmar na hora (`gh pr merge <M> --disable-auto`),
     pôr `precisa-do-leo` na issue e seguir.
   - `FECHADA`: registrar na issue e seguir para o passo 10 sem pull.
   - `SEM_MUDANCA` (60 min sem mudar nada nos checks): reconsultar `gh pr view <M> --json
     state,mergeStateStatus` e `gh pr checks <M>`; se a PR está só esperando, relançar o vigia; se está
     travada (CI que não começou), tratar como CI vermelha ou avisar o dono.
   A PR só terminou quando `gh pr view <M> --json state` der `MERGED`. A CI leva ~7 min e a fila a roda
   outra vez.
   **CI vermelha:** primeiro desarmar (`gh pr merge <M> --disable-auto`), senão a correção mergeia sem
   revisão quando a CI do commit novo ficar verde. Anotar o `<sha-antes>` (`gh pr view <M> --json
   headRefOid`) e ler o passo que falhou
   (`gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId'` e
   `gh run view <id> --log-failed`), separar ambiente (runner, cota de minutos: job sem passo nenhum é
   bloqueio de cobrança da conta, não é bug) de teste de produto, e mandar à trabalhadora (uma rodada de
   correção, conta nas duas do passo 6). Nunca afrouxar teste para passar: se o teste revela bug, o bug é o
   problema. Quando ela voltar: a conferência do passo 6 (revisor sobre `<sha-antes>..HEAD` na worktree de
   quem corrigiu, ou sobre `origin/main...HEAD` se a correção incluiu `git merge origin/main`; Sol conforme o
   passo 6) e o passo 8 inteiro de novo antes de religar o auto-merge e relançar o vigia. Vermelha de novo,
   `precisa-do-leo`.
10. **Depois do merge** de cada PR (e no `PAROU`/`FALHOU` do passo 4): `git pull --ff-only` na pasta
    principal e remover a worktree da trabalhadora (e a da trabalhadora de correção, se o passo 6 abriu uma
    nova), a partir da pasta principal (nunca `cd` para dentro de
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
`main` verde pela pré-condição 3 (a fila que acabou de mesclar a última PR já é o veredito; não esperar o
run do push) e voltar ao passo 1 com o mesmo N, até a tabela do `listar-issues` vir vazia ou aparecer
`PARAR`. Entre rodadas, nada de deploy.

## O que a orquestradora nunca faz

- Editar código, commitar ou fazer push de código próprio; o que vê de errado vira issue (`gh issue create`).
- Mergear à força, pular o CI, mexer em PR que o dono comentou, ou ligar auto-merge em PR de caminho
  protegido sem o gate reforçado do passo 8.
- Pôr o label `dono-liberou` (isenta da trava da CI sobre o scanner e os hooks; é só do dono).
- Deploy sem o dono pedir. Tocar a produção, a VPS ou o banco da bancada (reset, suíte completa).
- Abrir mais issues por rodada do que o dono disse, ou uma segunda migration com outra em aberto.
- Reabrir uma issue com `precisa-do-leo` ou `decisao` antes de o dono tirar o label.
