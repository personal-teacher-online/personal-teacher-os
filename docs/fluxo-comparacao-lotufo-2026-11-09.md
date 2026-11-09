# Fluxo de issues: o que mudou no lotufo de 28/10 a 09/11/2026, e o que trazer

> Só leitura, para o dono decidir. Nada foi mudado em nenhum dos dois projetos.
> Linha de base: `docs/fluxo-comparacao-lotufo.md` (27/10). Das 4 propostas dela, 3 estão
> adotadas aqui desde 30/10 (permissões de merge no `allow`, `listar-issues` lê "Depende da #N",
> fila de merge na organização). A 4ª (migration no auto-merge) é a decisão 5 abaixo.
> Corte no lotufo: commit `59703ce` (último de 27/10) até o HEAD de 09/11 (889 commits no total;
> 12 arquivos de fluxo mudaram). Fontes: diffs de `.claude/`, `CLAUDE.md`, `.github/`,
> rulesets dos dois repositórios, `gh issue list` e `gh pr list`.

## A resposta em três linhas

1. **O rito do lotufo mudou em 8 pontos**, todos nascidos de tropeço medido em rodada (30/10 e
   03/11): correção da PR com trabalhadora isolada, teto real de duas rodadas, vigia versionado da
   PR depois do auto-merge, um push por rodada, gate Sol em subshell com log e sem cota, revisor
   da correção sobre `origin/master...HEAD`. Permissões, hooks, templates e ruleset **não mudaram**.
2. **Aqui já está no mesmo patamar de ritmo**: mediana PR aberta → mergeada de 41 min (lotufo 34).
   A diferença de volume (159 PRs lá, 38 aqui) é tamanho de fila, não processo: 12 das 30 issues
   abertas aqui têm `risco:migration` e esperam a decisão 5.
3. **Vale trazer 6 dos 8 pontos, num pacote só de texto em `.claude/`** (caminho protegido: PR com
   gate reforçado e merge do dono, ~2 h de trabalho). Um deles (teto de duas rodadas com Aviso
   virando issue) só com ressalva, porque aqui Aviso pode ser Lei. Dois não se aplicam (CI em
   Ubuntu, skill de deploy).

## 1. O que mudou lá, e o estado aqui

| # | Mudança no lotufo (commit, motivo) | Aqui |
|---|---|---|
| 1 | **Correção da PR com trabalhadora isolada** (`orquestrar/SKILL.md:62-98`, `trabalhadora.md:49-56`; #356, 30/10). Fato medido: o agente tem `isolation: worktree`, então "trabalhadora nova sem isolation apontada para o worktree da PR" não existe; a ferramenta recusa `git` fora do próprio worktree. 1 de 7 parou, 6 improvisaram. Agora: a mesma trabalhadora por `SendMessage` é a preferida, sem prazo em minutos; conferir `headRefOid` antes de abrir outra; trabalhadora nova faz `git fetch` + `checkout -B <branch> origin/<branch>` + `push origin HEAD:<branch>`. "Mesma família de achado pela 2ª vez → corrigir a família inteira." | **Diferente, com o mesmo bug latente.** `orquestrar/SKILL.md:84-91` manda "trabalhadora nova **sem** `isolation`... worktree `<caminho>`"; `trabalhadora.md:5` tem `isolation: worktree`. Nunca exercitado aqui. |
| 2 | **Teto real de duas rodadas**: Aviso que sobra vira issue e a PR segue; Crítico segura (`orquestrar/SKILL.md:91-98`; `CLAUDE.md:64`; #368, 03/11, depois da PR #320 acumular 20 commits de correção). | **Não tem.** Aqui sobrou Crítico **ou Aviso** → draft + `precisa-do-leo`. |
| 3 | **Vigia versionado** (`orquestrar/vigia.sh`, 116 linhas, e `vigia.ps1`): GraphQL a cada 2 min, devolve `MERGED`, `FECHADA`, `COMENTARIO`, `CI_VERMELHA`, `FILA_VERMELHA`, `AUTO_MERGE_DESLIGADO` (lê `reasonCode == manually_disabled` = dono, não religar), `SEM_MUDANCA` (60 min), `ERRO`. Parametrizado por `VIGIA_DONO`/`VIGIA_REPO` (#368, #374). Motivo: PR #320 ficou 1h32 com CI vermelha sem ninguém olhar; o `--watch` improvisado só esperava "mergeada ou fora da fila" e a PR nunca entrou na fila. | **Não tem.** `orquestrar/SKILL.md:116-119`: `gh pr checks --watch` em background + comentários a cada 5 min. Com a fila de merge ligada em 30/10, o buraco é igual aqui. |
| 4 | **Um push por rodada de correção** (e um push + `gh pr create` na abertura) (`trabalhadora.md:49,57-60`, `abrir-pr/SKILL.md:35-36`; #369). Motivo: 7 de 30 execuções da CI de 03/11 canceladas por push em cima de push (`concurrency` com `cancel-in-progress`). | **Não tem.** `ci.yml:26-28` cancela igual; cada push a mais custa ~11 min de CI com Supabase descartável. |
| 5 | **Resposta da trabalhadora com `estado: PR corrigida` e `sha-antes / sha-depois`** (`trabalhadora.md:77-83`). | **Não tem** (`trabalhadora.md:88-98`). |
| 6 | **Revisor da correção sobre `origin/master...HEAD` quando a correção incluiu `git merge origin/master`** (senão `<sha-antes>..HEAD` traz código de outras PRs). Sol só repete se a correção mexeu de forma grande em dinheiro/envio (`orquestrar/SKILL.md:84-89,171`). | **Não tem.** Passo 8 daqui manda trazer a `main` por merge em `BEHIND`, mas o revisor segue em `<sha-antes>..HEAD`. |
| 7 | **Gate Sol de dentro do worktree em subshell**, sem `--skip-git-repo-check`, pedido + diff num arquivo lido pelo stdin, stdout/stderr em `.log`, releitura do `-o` e 1 retentativa se inválido (`gate-sol/SKILL.md:24-57`; #80, #356). Motivo: a proteção do worktree recusou o comando; o `cd` solto deixou a orquestradora dentro do worktree da trabalhadora. | **Não tem.** `gate-sol/SKILL.md:39-46` ainda é `git -C diff \| codex exec --skip-git-repo-check`, sem log. |
| 8 | **Gate Sol "sem cota"** não é veredito inválido: não repetir no dia, registrar "sem cota em DD/MM"; se a rodada 1 cobriu o diff e a correção não mexeu em dinheiro/envio, o revisor cobre e o gate vale; senão PR sem auto-merge + `precisa-do-leo` (`gate-sol/SKILL.md:69-88`; #356, cota do ChatGPT acabou no meio da rodada de 30/10). | **Não tem.** `gate-sol/SKILL.md:28-30` trata só codex ausente. |
| 9 | `cd` explícito para a pasta principal antes de `git pull` e da remoção; `-D` se `-d` recusar com PR `MERGED` (`c4d8495`). | **Já tem** (`orquestrar/SKILL.md:128-133`). |
| 10 | `listar-issues` lê todas as dependências da linha "Depende" (`07f0e17`, 07/11). | **Já tem, mais rigoroso** (PR #101: frase que começa com "Depende", vários `#N`, exclui "Não depende"). |
| 11 | CI do backend saiu do Windows para Ubuntu com `pytest -n 4` (#385, #367). | **Não se aplica**: 1 job aqui, gargalo é o Supabase. |
| 12 | Skill `deploy` reescrita (SSH em 3 chamadas, sentinela, HTTPS; +800 linhas). | **Fora de escopo**: deploy manual pelo runbook, por regra. |

**GitHub:** ruleset do lotufo sem mudança desde 15/10 (fila `ALLGREEN`, 5 entradas, `MERGE`,
90 min). Aqui: ruleset `main protegida` de 29/10, fila `ALLGREEN` com **1 entrada**, `SQUASH`,
60 min. Mais conservador, coerente com a bancada única. Labels só daqui: `risco:migration`,
`risco:fuso`, `risco:ledger`, `risco:rls`, `dono-liberou`.

**O que só aqui tem** (saltou aos olhos nos diffs): gate reforçado em caminho protegido + check
"scanner protegido" por `pull_request_target` + `dono-liberou` (ADR-041); "uma migration por PR
aberta"; `listar-issues` com regra de frase; passo 8 tratando `BEHIND` e "no checks reported";
passo 10 guardando a branch sem push em `PAROU`/`FALHOU` (repo público).

## 2. Ritmo medido (27/10 → 09/11)

| | lotufo | personal-teacher-os |
|---|---|---|
| Issues fechadas | 166 | 91 |
| PRs mergeadas | 159 | 38 |
| Mediana PR aberta → mergeada (últimas 30) | 34 min (19 de 30 abaixo de 1 h) | 41 min (18 de 28 abaixo de 1 h; #136 e #137 têm `mergedAt` antes de `createdAt` no GitHub, descartadas) |
| Fila aberta | 15 `sessao-manual`, 3 `decisao`, 13 `risco:dinheiro` | 30: 21 `divida`, 12 `risco:migration`, 6 `sessao-manual`, 1 `precisa-do-leo` |

Na baseline de 27/10 a comparação limpa (fumaça de 15/10) dava 48 e 63 min aqui, com 44 min
parados em permissão. As três propostas adotadas em 30/10 pegaram.

## 3. Proposta: um pacote em `.claude/` (PR com gate reforçado, merge do dono)

Ordem de valor. Custo total ~2 h de sessão, só texto e um script copiado.

| Ordem | Item | Custo | Risco para as Leis | Parecer |
|---|---|---|---|---|
| 1º | #1 correção isolada (passo 6 + `trabalhadora.md`) | 20 min + 10 min de fumaça | Nenhum (rito) | **Trazer.** Bug latente: a 1ª PR que precisar de 2ª trabalhadora trava ou improvisa. |
| 2º | #4 + #5 um push por rodada; `PR corrigida` + `sha-antes/sha-depois` | 10 min | Nenhum | **Trazer.** Cada push a mais é ~11 min de CI jogado. |
| 3º | #6 revisor sobre `origin/main...HEAD` após merge da `main` | 5 min, junto com o 1º | Nenhum | Trazer. |
| 4º | #7 gate Sol em subshell, arquivo de entrada, `.log`, releitura | 15 min (`master`→`main`, prompt daqui é maior) | Nenhum | **Trazer.** Separa "resposta vazia" de "sem cota" e fecha o `cd` solto. |
| 5º | #8 sem cota do codex | 10 min | **Atenção:** "rodada 1 cobriu, revisor cobre a correção" NÃO pode valer em caminho protegido nem com `risco:*` (passo 8 daqui: "Sol rodado de fato, sem dispensa", ADR-041). Trazer só "sem cota = `precisa-do-leo`, não repetir no dia, dono pede o gate depois". | Trazer na forma restrita. |
| 6º | #3 vigia versionado | 30-45 min: copiar `vigia.sh` (já parametrizado), ajustar passo 9 (`--squash`, repo), testar numa branch descartável | Nenhum; reforça "sem comentário do dono" (desarme por `reasonCode`) | **Trazer.** O buraco da PR #320 existe aqui desde a fila de merge. |
| decisão | #2 Aviso que sobra vira issue e a PR segue | 10 min de texto | **Médio.** Aqui o revisor marca violação de Lei como Crítico/Aviso; um Aviso de fuso ou ledger virando issue entraria na `main`. Se adotar: Aviso que cita Lei ou caminho protegido continua segurando; só Aviso de legibilidade, tela ou teste vira issue. | Escolha do dono, com a ressalva. |

Não trazer: #11 (CI Ubuntu), #12 (deploy), `.claude/launch.json`.

## 4. A troca de sistema da CI do lotufo (Windows → Linux) e o que ela ensina aqui

O que mudou lá (issues #367 de 03/11 e #385 de 04/11, PRs #370 e #415): o job `backend` saiu do
`windows-latest` para o `ubuntu-latest` com `pytest-xdist -n 4`, Liberation Sans no lugar da Arial
para os PDFs; o job `backend-windows` que sobrou da #367 caiu na #385. A produção do lotufo
**continua Windows** (corte para a VM em 03/11, #363/#365; deploy por `schtasks` e PowerShell).

Por quê: medido em 03/11, a suíte de 1844 testes levava 11 a 14 min no runner Windows e 1 min 36 s
num Mac; o disco do runner era o gargalo. E cada PR roda a CI **3 vezes** (push na branch, grupo da
fila de merge, push no `master`), então o piso por PR era ~40 min. Depois: job `backend` em 167 s,
rodada inteira em 2 a 4 min, piso por PR ~10 min.

Aqui, medido em 09/11 (últimos 30 runs e passos do último run verde da `main`):

| | lotufo hoje | personal-teacher-os hoje |
|---|---|---|
| Runner | `ubuntu-latest` | `ubuntu-24.04` desde 15/10 (nunca foi Windows) |
| Rodada da CI | 2 a 4 min | **6 a 7 min** (um run de 22 min em 29/10 foi o 1º cache de imagens) |
| Onde vai o tempo | backend 167 s, frontend 45 s, vazamento 14 s | deps 55 s, tsc 31 s, lint 22 s, **carregar imagens do cache 91 s, Supabase 67 s, vitest 153 s** (209 arquivos) |
| Runs por PR | 3 (push, fila, `master`) | 3 (push, fila, `main`) |
| Piso por PR só de CI | ~10 min | **~20 min** |

Veredito: a lição "trocar o sistema do runner" não se aplica, porque aqui nunca houve Windows e o
tempo não está no runner. A lição que se aplica é a conta por PR: 3 rodadas de 7 min. Onde dá para
cortar, do mais barato ao mais caro:

1. **O 3º run (push na `main`) é redundante com a fila de merge.** O grupo da fila testa o commit
   exato que vira a `main` (`ALLGREEN`, 1 entrada); o run do push repete o mesmo trabalho 7 min
   depois, e a orquestradora espera por ele ("`main` verde" no passo 1 da skill, com `gh run watch`
   dentro do turno). Trocar a regra para "último grupo da fila verde = `main` verde" tira 7 min do
   início de cada rodada encadeada sem perder veredito. O lotufo não fez isso (também roda 3×).
   Custo: 10 min de texto na skill; o `ci.yml` pode manter o `push: main` como rede, sem a
   orquestradora esperar por ele. Risco para as Leis: nenhum.
2. **Infra do Supabase no runner: 158 s** (carregar o cache + `start`). É quase metade da rodada e
   não muda com o tamanho da suíte. Sem saída barata: imagem pré-montada é manutenção que a Lei 5
   e o "sem gold-plating" não pagam. Fica.
3. **vitest 153 s** para 209 arquivos contra um Postgres só: já roda arquivos em paralelo (padrão
   do vitest); sharding em 2 jobs dobraria o custo do Supabase (2 × 158 s). Não vale.

Portanto: o único item que vale trazer é o 1, e ele é regra da orquestradora, não troca de sistema.

## 5. Decisão 5 pendente: migration no auto-merge (proposta 2.3 da baseline)

Estado: 12 das 30 issues abertas têm `risco:migration`; cada uma espera o merge do dono e só uma
PR com migration fica aberta por vez. No lotufo as migrations entram em auto-merge com Sol em 2
rodadas (sem mudança desde 27/10). Lei 7 congela a migration **depois de aplicada**; merge na
`main` não aplica em lugar nenhum, e o portão do dono já existe no deploy (`/code-review xhigh`,
ADR-040). Travas a manter se adotar: Opus na trabalhadora, gate Sol obrigatório, uma migration por
rodada. Vira ADR curto e muda `CLAUDE.md` (caminho protegido, merge do dono). Risco que sobra:
migration errada na `main` vira corretiva se alguém a aplicou, e quem aplica é só a bancada do dono.
