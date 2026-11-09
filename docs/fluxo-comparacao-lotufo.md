# Fluxo de issues: lotufo × personal-teacher-os (27/10/2026)

> Só leitura, para o dono decidir. Nada foi mudado em nenhum dos dois projetos.
> Fontes: os dois `CLAUDE.md`, `.claude/settings*.json`, skills e agentes, `ci.yml`,
> templates, `.githooks/`, `docs/fluxo-paralelo.md`, `docs/fluxo-de-trabalho-2026-10-11.md`
> (lotufo), rulesets e proteção de branch no GitHub, `gh issue list` e `gh pr list` dos dois.

## A resposta em três linhas

1. **O lotufo não usa modo bypass.** Os dois projetos rodam no mesmo modo global `auto`
   (`~/.claude/settings.json:7`). A diferença é a lista `ask` do `settings.json` versionado:
   aqui ela segura o caminho normal da orquestradora (`gh pr merge`, `git branch -D`); lá
   ela só cobre `git checkout -f`/`branch -f`. Medido aqui: **49 min de 1h33 parados em
   pedido de permissão** na rodada de fumaça (`docs/fluxo-paralelo.md:133` e `:165-168`).
2. **Lá a orquestradora nunca espera o dono.** Sem caminho protegido, sem "uma migration por
   vez", sem "main verde antes da rodada" (a fila de merge do GitHub faz esse papel), e a
   fila de issues é carregada em lote (23 issues em 1 minuto, 21/10) com dependência declarada.
3. **O que vale trazer sem afrouxar Lei nenhuma:** a lista de permissões (§3, pronta),
   dependências no `listar-issues`, fila carregada em lote. O que exige decisão sua: mover o
   portão da migration do merge para o deploy (§2.3). O que não dá para copiar: fila de merge
   (precisa de organização no GitHub) e banco por worktree (SQLite lá, Supabase aqui).

---

## 1. Lado a lado

| | **nova-dashboard-lotufo** | **personal-teacher-os** |
|---|---|---|
| Repositório | público, organização `lotufo-dev` | privado, conta pessoal |
| Fila | GitHub Issues; label `area:*` obrigatório; "Depende da #N" lido pelo `listar-issues` (`.claude/agents/listar-issues.md:18-27`) | GitHub Issues; "depende da #N" só em texto, ninguém lê (`listar-issues.md:17-21`) |
| Quem abre trabalhadoras | orquestradora, **até 20 por rodada no Mac**, sem pedir número (`CLAUDE.md:60`; `orquestrar/SKILL.md:21-23`) | orquestradora, **N dito pelo dono a cada rodada**; sem número, pergunta (`orquestrar/SKILL.md:17`) |
| Modelo | Sonnet; Opus com `risco:*` | igual |
| Gates por PR | CI (3 jobs paralelos, 7-12 min) + `/code-review` + revisor-adversarial + Sol nas de risco; 2 rodadas de correção | CI (1 job, 11-15 min) + `/code-review` + revisor-adversarial + Sol nas de risco; 2 rodadas. **Mais um antes de rodar:** CI da `main` verde, senão espera (`orquestrar/SKILL.md:34-39`) |
| Revisor adversarial | 7 itens; "achado sem cenário concreto não entra" (`revisor-adversarial.md:27-47, 59-60`) | 9 itens incl. régua de legibilidade do `AGENTS.md`; "reportar TUDO" (`revisor-adversarial.md:38-63, 76`) |
| Auto-merge | em **toda** PR aprovada, inclusive migração, `risco:*`, `.github/`, `.claude/` (`CLAUDE.md:62-66`; `orquestrar/SKILL.md:76-77`) | só PR sem caminho protegido (`orquestrar/SKILL.md:96-97`) |
| Travas do auto-merge | CI verde, sem conflito, revisor sem Crítico/Aviso, Sol idem, nenhum comentário na PR | as mesmas **+ caminho protegido + main verde + uma migration por vez** |
| Caminhos protegidos | nenhum na orquestradora. Só `scripts/vazamento.py`, lista de exceções e `.githooks` exigem merge do dono, e isso é **um passo do CI** que fica vermelho (`ci.yml:91-101`), não regra da skill | 12: `.github/`, `.claude/`, `.githooks/`, `supabase/migrations/`, `supabase/seed.sql`, runbook, `Dockerfile`, `next.config.ts`, `CLAUDE.md`, `AGENTS.md`, `Design.md`, `scripts/vazamento*` (`CLAUDE.md` › Como o trabalho anda) |
| Trava do GitHub | ruleset: PR obrigatória, 3 checks, fila de merge (`merge_group`, `ALLGREEN`), sem bypass, `strict=false` | proteção clássica: check "tsc + lint + suíte", `enforce_admins`, `strict=false`, **sem fila de merge** (não existe em conta pessoal) |
| Permissões versionadas | allow cobre todo o caminho da orquestradora: `gh pr merge *`, `git merge *`, `git branch -D *`, `git worktree remove --force *` (`settings.json:45,55,57,58`); `ask` só para `git checkout -f`/`branch -f` (`:104-125`) | `gh pr merge *`, `git branch -D *`, `git worktree remove --force *`, `gh api -X *` em **ask** (`settings.json:91-108`) |
| Permissões locais | 2 linhas (`settings.local.json`) | 116 linhas de aprovações soltas, incl. `rm -rf .git`, `ssh *`, `scp *`, `docker *`, `python3 *`, `node *` |
| Worktree pronta | links simbólicos para `node_modules`/`.venv` do clone principal, 0 s (`hooks/preparar-worktree.sh`) | `npm ci` por worktree, ~40 s (`hooks/session-start.mjs`) |
| Regras por tema | `.claude/rules/*.md` com `paths:`; carregam só quando a sessão toca aqueles arquivos | tudo no `CLAUDE.md` (~200 linhas) + `AGENTS.md` + `Design.md`, lidos por toda trabalhadora |
| Visibilidade | quadro Kanban movido pela orquestradora (`orquestrar/SKILL.md:115-126`) | só o resumo da rodada |
| Deploy | skill `deploy` (1 frase, rollback automático, comenta "Em produção" na PR) | manual pelo runbook |
| **Intervenção do dono por PR** | **0** durante a vida da PR (nas 30 últimas mergeadas: 0 reviews, 0 comentários; o único comentário é o "Em produção" do deploy, depois). Ele intervém na issue (`decisao`, `precisa-do-leo`) e no deploy em lote | **1 a 3**: aprovar `gh pr merge --auto`, aprovar `git branch -D`, mesclar PR de caminho protegido, dizer o N da rodada, liberar a bancada |

### Ritmo medido

| | lotufo | personal-teacher-os |
|---|---|---|
| PR aberta → mergeada (mediana) | **~30 min** (22-84 min nas rodadas de 19 e 21/10; 107-127 min nas PRs empilhadas de 26/10) | fumaça da orquestradora 15/10: 48 e 63 min (44 min parados em permissão); sessões manuais de 27/10: 26 a 298 min |
| Issues fechadas 14→27/10 | ~60 (3 dias de rodada: 14, 16, 19, 21, 26/10) | 6 (2 pela orquestradora; o resto sessão manual e docs) |
| Uma rodada típica | 21/10: 23 issues criadas 03:43-03:44 (uma leva do `nova-tarefa` a partir da spec dos motores, PR #300); 8 PRs abertas 15:54-16:04, todas mergeadas até 17:28; mais 7 às 19:09-19:25, mergeadas até 20:10 | 15/10: 2 issues → 2 PRs → 2 merges em 1h33 |
| Migrations | 042, 043, 050 **auto-mergeadas** com Sol em 2 rodadas cada (PRs #310, #306, #319); deploy em lote em 23/10 | 118 corrigida em sessão manual (PR #34); migration é caminho protegido, espera o dono |
| Fila hoje | 55 abertas: 22 `sessao-manual`, 11 `precisa-do-leo`, 3 `decisao`, **~16 elegíveis** | 14 abertas: 4 `sessao-manual`, 2 `decisao`, **9 elegíveis** (2 com migration: só uma por rodada) |
| Achados do revisor por PR | 2 a 6 | 8 a 12 (12 na PR #35, que é só texto) |

Leitura honesta do ritmo: parte da diferença das duas semanas não é processo. Aqui o tempo
foi para a conta da Meta, a mudança Evolution → Cloud API (ADR-038, que fechou M3-1 e M3-2
como superadas) e itens `sessao-manual`. Mas a rodada de fumaça, que é a comparação limpa,
mostra o problema: metade do tempo parado em permissão.

---

## 2. O que o lotufo faz de diferente, e o que custa trazer

### 2.1 Permissões cobrem o caminho inteiro da orquestradora

**Lá:** `.claude/settings.json:45` `Bash(gh pr merge *)`, `:57` `Bash(git branch -D *)`,
`:58` `Bash(git worktree remove --force *)`, `:55` `Bash(git merge *)` em `allow`. A lista
`ask` (`:104-125`) só tem `git checkout -f`, `git checkout -- *`, `git branch -f`. Tudo
versionado: toda worktree e toda máquina herdam.

**Aqui:** `.claude/settings.json:100` `Bash(gh pr merge *)` e `:91` `Bash(git branch -D *)`
em `ask`. A skill `orquestrar` precisa dos dois em toda PR (passos 8 e 10,
`orquestrar/SKILL.md:101,119`). Pela regra do Claude Code, "rules are evaluated in order:
deny, then ask, then allow" e "an ask rule like `Bash(git clean *)` still prompts you ...
even in auto mode" (doc oficial de permissões). Resultado medido: 44 min + 5 min parados
na fumaça (`docs/fluxo-paralelo.md:165-168`).

**Custo de adotar:** 10 minutos, edição do dono (`.claude/` é caminho protegido).
**Risco para as Leis:** nenhum. A trava que impede merge sem CI verde é do GitHub
(`enforce_admins`), não da permissão; `gh pr merge --auto` só arma, quem mescla é o GitHub.
Detalhe completo em §3.

### 2.2 Fila carregada em lote, com dependência declarada

**Lá:** o dono escreve a onda inteira de uma vez (23 issues em 1 minuto em 21/10, a partir
de uma spec); `listar-issues.md:18-27` lê "Depende da #N" e **não oferece** a issue enquanto
a dependência estiver aberta. A orquestradora pega até 20 (`orquestrar/SKILL.md:21-23`) e
"até acabar" esvazia a fila sem o dono dosar.

**Aqui:** `nova-tarefa/SKILL.md:13-14` manda escrever "depende da #N" em Origem, mas
`listar-issues.md:17-21` não lê isso. Por isso o dono precisa dizer "rodada de N" para não
abrir uma issue cuja base ainda não está na `main`.

**Custo:** copiar o `jq` do lotufo para o `listar-issues` daqui (15 min). **Risco:** nenhum;
"uma migration por vez" continua valendo, basta a issue de tela dizer "depende da migration".

### 2.3 Sem caminho protegido: migração entra em auto-merge

**Lá:** `CLAUDE.md:62-66` e `orquestrar/SKILL.md:76-77`: "Não há trava por arquivo nem por
label: redesenho, migração, `risco:*` e PR que toca `.github/`, `scripts/deploy.ps1` ou
`.claude/` entram igual às outras (decisão do dono de 16/10/2026)". As três migrations da
onda dos motores (#310, #306, #319) foram mergeadas pela orquestradora depois de Sol em 2
rodadas, e subiram juntas no deploy de 23/10. O único "só o dono mescla" que sobrou é
implementado como passo do CI (`ci.yml:91-101`): a PR fica vermelha, a orquestradora não
precisa saber a regra.

**Aqui:** 12 caminhos protegidos, inclusive `supabase/migrations/`. Toda PR com migration
espera o dono mesclar, e enquanto ela espera nenhuma outra issue de migration entra.

**Custo e risco de adotar, por caminho:**

- `supabase/migrations/`: a Lei 7 congela a migration **depois de aplicada em ambiente
  compartilhado**. Merge na `main` não aplica em lugar nenhum (deploy é manual) e a 118 foi
  reescrita depois de mergeada justamente por isso (PR #34: "reset nas duas bancadas").
  O portão do dono já existe **no deploy**: `/code-review ultra` bloqueante antes de deploy
  com migration (`CLAUDE.md` › Gate do dono). Então o portão do merge é duplo. Mover para
  auto-merge com Opus + Sol obrigatório + "uma por vez" mantém a Lei 7. Risco real: migration
  errada na `main` vira migration corretiva se alguém aplicou (só a bancada do dono, que
  reseta). **É decisão sua, não da orquestradora.**
- `.github/`, `.claude/`, `.githooks/`, `scripts/vazamento*`: o lotufo liberou `.github/` e
  `.claude/` mas manteve `vazamento`/`.githooks` como vermelho de CI. Aqui faz sentido manter
  os quatro protegidos: são a régua que julga as outras PRs. Custo de manter: baixo (poucas
  PRs tocam isso).
- `CLAUDE.md`, `AGENTS.md`, `Design.md`, runbook, `Dockerfile`, `next.config.ts`: manter.
  São regra e produção.

### 2.4 Fila de merge no lugar de "main verde antes da rodada"

**Lá:** ruleset com `merge_queue` (`ALLGREEN`, até 5 PRs por grupo) e CI em `merge_group`
(`ci.yml:13`). Duas PRs mergeadas em seguida nunca quebram o `master`; a orquestradora não
confere CI do `master` antes de começar (pré-condições `orquestrar/SKILL.md:15-23`).

**Aqui:** `orquestrar/SKILL.md:26-27, 34-39`: "a última rodada do CI na `main` precisa estar
verde" e, se estiver rodando, "esperar dentro do mesmo turno com `gh run watch`". São 11-15
min por rodada encadeada. Necessário porque sem fila dois merges seguidos podem quebrar a
`main` (medido em 15/10, `ci.yml:19-22`).

**Custo de adotar:** fila de merge exige repositório numa **organização** do GitHub
(`fluxo-de-trabalho-2026-10-11.md:57`: "a fila não existe em conta pessoal"). Mover o repo
para uma org é meia hora, mas conversa com a Fase 2 do fluxo (repositório público) e com os
segredos do CI. **Até lá**, a espera de 11 min é o preço certo: não afrouxar.

### 2.5 Revisor adversarial com menos ruído

**Lá:** `revisor-adversarial.md:59-60`: "achado sem cenário concreto não entra"; 7 itens, todos
de defeito em produção. **Aqui:** `revisor-adversarial.md:76`: "reportar TUDO que encontrar" e
item 8 (régua de legibilidade do `AGENTS.md`). Efeito: 8 a 12 achados por PR contra 2 a 6;
cada Aviso dispara rodada de correção; a PR #35 (só texto) levou 12.

**Custo de adotar:** mudar duas linhas do agente: Leis continuam Crítico/Aviso (travam);
régua de tela e legibilidade viram Sugestão (não travam, ficam para o `/code-review` e para o
dono). **Risco:** baixo; nenhuma Lei passa pela régua de legibilidade.

### 2.6 O que não copiar (e por quê)

- **Banco por worktree / suíte local barata.** Lá é SQLite num arquivo; `pytest` do módulo
  roda em qualquer worktree sem pisar em ninguém. Aqui a bancada é um Supabase só. Trocar
  isso é infraestrutura; o CI já é o juiz. Não vale.
- **Links simbólicos de `node_modules`** no lugar do `npm ci` (~40 s por worktree). Ganho
  pequeno; o `npm ci` protege contra lockfile diferente entre branches. Deixar.
- **Teto de 20 trabalhadoras.** Aqui o gargalo não é CPU, é a bancada e o dono lendo PR.
  "Até acabar" com dependências resolvidas já dá o mesmo efeito.

---

## 3. Permissões

### 3.1 Como o lotufo evita o pedido de permissão

Não é `bypassPermissions`. Os dois projetos rodam sob o mesmo global:

```json
// ~/.claude/settings.json (global, vale para os dois)
"permissions": { "defaultMode": "auto" },
"skipDangerousModePermissionPrompt": true
```

O `--dangerously-skip-permissions` aparece aqui, não lá: `qa/como-rodar-reforma.md:46`
(rito da reforma de QA), nunca no fluxo de issues.

O que o lotufo faz é uma **allowlist versionada que cobre o caminho inteiro** e um `ask`
mínimo. Regras exatas (`~/dev/nova-dashboard-lotufo/.claude/settings.json`, só a família
`Bash`; a família `PowerShell` repete as mesmas):

```json
"allow": [
  "Bash(python -m pytest *)", "Bash(pytest *)",
  "Bash(.venv/bin/python -m pytest *)", "Bash(backend/.venv/bin/python -m pytest *)",
  "Bash(npm test *)", "Bash(npm run lint *)", "Bash(npm run typecheck *)", "Bash(npm run build *)",
  "Bash(npx tsc *)", "Bash(npx oxlint *)",
  "Bash(ruff *)", "Bash(python -m ruff *)", "Bash(.venv/bin/ruff *)", "Bash(backend/.venv/bin/ruff *)",
  "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git branch *)",
  "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(git fetch *)",
  "Bash(git checkout *)", "Bash(git switch *)", "Bash(git worktree *)",
  "Bash(git pull --ff-only*)", "Bash(git rev-parse *)",
  "Bash(git merge *)", "Bash(git merge-tree *)",
  "Bash(git branch -D *)", "Bash(git worktree remove --force *)",
  "Bash(gh pr *)", "Bash(gh issue *)", "Bash(gh run *)", "Bash(gh api *)", "Bash(gh label *)",
  "Bash(gh pr merge *)",
  "Bash(codex exec *)",
  "Bash(cd *)", "Bash(echo *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(ls *)",
  "Bash(grep *)", "Bash(sleep *)",
  "Bash(sh *preparar-worktree.sh*)"
],
"ask": [
  "Bash(git checkout -- *)", "Bash(git checkout .)", "Bash(git checkout -f *)",
  "Bash(git checkout --force *)", "Bash(git checkout * -- *)",
  "Bash(git switch --discard-changes *)", "Bash(git switch -f *)",
  "Bash(git branch -f *)", "Bash(git branch --force *)", "Bash(git branch --delete --force *)"
],
"deny": [
  "Bash(git push *--force*)", "Bash(git push -f *)", "Bash(git push * -f)",
  "Bash(git push * -f *)", "Bash(git push * +*)"
]
```

Hooks do lotufo não mexem em permissão: `PostToolUse` formata, `SessionStart`/`SubagentStart`
preparam a worktree, `WorktreeRemove` desfaz os links.

### 3.2 O que trava aqui, linha por linha

`~/dev/personal-teacher-os/.claude/settings.json`, lista `ask` (`:75-109`), separada pelo
que a orquestradora usa de fato:

| Regra em `ask` | Quem bate nela | Veredito |
|---|---|---|
| `Bash(gh pr merge *)` (`:100`) | orquestradora, toda PR, passo 8 (`--auto --squash`) e CI vermelha (`--disable-auto`) | **tirar do ask**. O merge em si é do GitHub, que exige CI verde (`enforce_admins`); `--auto` só arma |
| `Bash(git branch -D *)` (`:91`) | orquestradora, toda PR, passo 10 (squash obriga `-D`) | **tirar do ask**. Branch local de PR já mergeada; reversível pelo reflog |
| `Bash(git worktree remove --force *)` (`:95`) | raro (a fumaça removeu sem `--force`) | pode ficar em ask |
| `Bash(gh api *-X*)` e irmãs (`:102-108`) | só na nuvem (lotufo usa para armar auto-merge) | ficar em ask |
| `Bash(npm test*)`, `Bash(npx vitest*)`, suíte inteira (`:76-78`) | ninguém no fluxo (trabalhadora roda só focado) | **ficar em ask**: bancada única |
| `Bash(supabase *)`, `Bash(npx supabase *)` (`:79-80`) | ninguém no fluxo | **ficar em ask**: `db reset` na bancada compartilhada |
| `Bash(npm run dev*)`, `Bash(npm run build*)`, `e2e:bancada` (`:81-83`) | bancada visual, sessão manual | ficar em ask (porta 3000, heap) |
| `git checkout -f`, `reset --hard`, `clean`, `rebase`, `gh pr close`, `gh issue delete`, `gh repo *` | ninguém no fluxo | ficar em ask |

Um buraco que vale nos dois projetos: as skills usam `git -C "<worktree>" diff|push|branch`
(`orquestrar/SKILL.md:70`, `revisor-adversarial.md:23-25`, `trabalhadora.md:74-76`), e a doc
diz que `Bash(git push *)` **não** casa com `git -C . push origin main`. Em modo `auto` o
classificador costuma aprovar leitura, mas escrita (`git -C ... push`) pode pedir. A proposta
cobre `git -C` nominalmente.

Sobre o `settings.local.json` daqui (116 linhas): é arquivo pessoal desta máquina, não vai
para o Windows nem para a nuvem. Tem `Bash(npm test *)` e `Bash(npx supabase *)` em `allow`,
que **não valem** porque o `ask` do arquivo versionado vence o `allow` do local. E tem
`Bash(rm -rf .git)`, `Bash(ssh *)`, `Bash(scp *)`, `Bash(docker exec *)`, `Bash(python3 *)`,
`Bash(node *)`. O `ssh`/`scp` é autorização que você deu de propósito para a sessão local da
VPS (memória do projeto); fica onde está, no arquivo local, **nunca no versionado**. O resto
é lixo de aprovações antigas: vale zerar e deixar só `ssh *`, `scp *`, `docker *`,
`psql ...`. Não mexi.

### 3.3 Proposta de `settings.json` (NÃO aplicada)

Mudanças em relação ao arquivo atual, só na família `Bash` (repetir em `PowerShell`):

- **sai do `ask`, entra no `allow`:** `gh pr merge *`, `git branch -D *`.
- **entra no `allow` (novo):** `git -C * status|diff|log|branch|rev-parse|fetch|add|commit|push *`,
  `gh pr checks *` (já coberto por `gh pr *`, só explicitando), `cd *`, `sleep *`.
- **entra no `deny` (novo, cinto além da trava do GitHub):** push direto na `main`.
- **tudo o mais igual:** `ask` de bancada (`npm test`, `supabase`, `dev`, `build`), git
  destrutivo, `gh pr close`, `gh issue delete`, `gh api -X`; `deny` de `--force` e `--no-verify`.
- **não entra:** `defaultMode: bypassPermissions`, `ssh *`, `scp *`, `supabase db reset`,
  qualquer coisa que toque a VPS.

```json
{
  "enabledPlugins": { "vercel@claude-plugins-official": false },
  "skillOverrides": {
    "agents-sdk": "off", "cloudflare": "off", "cloudflare-email-service": "off",
    "cloudflare-one": "off", "cloudflare-one-migrations": "off", "durable-objects": "off",
    "sandbox-sdk": "off", "turnstile-spin": "off", "workers-best-practices": "off", "wrangler": "off"
  },
  "permissions": {
    "allow": [
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)",
      "Bash(git ls-files *)", "Bash(git rev-parse *)", "Bash(git remote -v)", "Bash(git branch *)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(git fetch *)",
      "Bash(git pull --ff-only*)", "Bash(git merge origin/main*)",
      "Bash(git checkout -b *)", "Bash(git switch *)", "Bash(git worktree *)",
      "Bash(git branch -D *)",
      "Bash(git -C * status *)", "Bash(git -C * diff *)", "Bash(git -C * log *)",
      "Bash(git -C * branch *)", "Bash(git -C * rev-parse *)", "Bash(git -C * fetch *)",
      "Bash(git -C * add *)", "Bash(git -C * commit *)", "Bash(git -C * push *)",
      "Bash(git -C * merge origin/main*)",
      "Bash(gh pr *)", "Bash(gh pr merge *)", "Bash(gh issue *)", "Bash(gh run *)",
      "Bash(gh api *)", "Bash(gh label *)",
      "Bash(npx tsc *)", "Bash(npx eslint *)", "Bash(npm run lint*)",
      "Bash(node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/*.test.ts)",
      "Bash(node .claude/hooks/session-start.mjs)",
      "Bash(codex exec *)",
      "Bash(cd *)", "Bash(sleep *)"
    ],
    "ask": [
      "Bash(npm test*)", "Bash(npx vitest*)",
      "Bash(node --env-file=.env.local node_modules/vitest/vitest.mjs run)",
      "Bash(npx supabase *)", "Bash(supabase *)",
      "Bash(npm run e2e:bancada*)", "Bash(npm run dev*)", "Bash(npm run build*)",
      "Bash(git checkout -- *)", "Bash(git checkout .)", "Bash(git checkout -f *)",
      "Bash(git checkout --force *)", "Bash(git checkout * -- *)",
      "Bash(git switch --discard-changes *)", "Bash(git switch -f *)",
      "Bash(git branch -f *)", "Bash(git branch --force *)", "Bash(git branch --delete --force *)",
      "Bash(git worktree remove --force *)",
      "Bash(git reset --hard *)", "Bash(git clean *)", "Bash(git rebase *)",
      "Bash(gh pr close *)", "Bash(gh issue delete *)",
      "Bash(gh api *-X*)", "Bash(gh api *--method*)", "Bash(gh api * -f *)", "Bash(gh api * -F *)",
      "Bash(gh api *--field*)", "Bash(gh api *--raw-field*)", "Bash(gh api *--input*)",
      "Bash(gh repo *)"
    ],
    "deny": [
      "Bash(git push *--force*)", "Bash(git push -f *)", "Bash(git push * -f)",
      "Bash(git push * -f *)", "Bash(git push * +*)", "Bash(git push --force*)",
      "Bash(git push origin main*)", "Bash(git push * HEAD:main*)", "Bash(git push origin HEAD:main*)",
      "Bash(git commit *--no-verify*)", "Bash(git commit *-n *)", "Bash(git commit *-n)",
      "Bash(git push *--no-verify*)", "Bash(git merge *--no-verify*)"
    ]
  },
  "hooks": { "...": "sem mudança: SessionStart, SubagentStart e PostToolUse como estão" }
}
```

(As entradas `PowerShell(...)` espelham cada linha `Bash(...)`, como hoje. O bloco `hooks`
fica literalmente igual ao atual; foi abreviado aqui.)

Por que isso não afrouxa Lei nenhuma:

- Push na `main`: já é impossível pelo GitHub (`enforce_admins`), e agora é `deny` também.
- `gh pr merge --auto`: o GitHub só mescla com o check "tsc + lint + suíte" verde. A trava de
  caminho protegido continua na skill (passo 8), não dependia da permissão.
- `supabase db reset`, suíte inteira, `npm run dev/build`: continuam pedindo. Bancada única.
- VPS: nada de `ssh`/`scp` no versionado; a trabalhadora é proibida pelo agente
  (`trabalhadora.md:45-46`), e a sessão local do dono tem a autorização no arquivo local.
- `--no-verify`, `--force`: `deny`, como hoje.

Como aplicar, quando decidir: editar `.claude/settings.json` (caminho protegido, PR sua) e
`settings.local.json` à mão. A skill `/fewer-permission-prompts` monta a lista a partir das
transcrições se quiser conferir o que mais pede.

---

## 4. Recomendação, por impacto

1. **Permissões (§3.3).** Tirar `gh pr merge *` e `git branch -D *` do `ask`, cobrir `git -C`,
   negar push na `main`. Ganho medido: ~49 min por rodada de 1h33. Risco: zero para as Leis.
   Custo: 10 min, PR sua. *Faça primeiro.*
2. **Fila cheia com dependência.** Copiar o `jq` de "Depende da #N" do lotufo para o
   `listar-issues` daqui e carregar a onda Agenda e Mensagens inteira de uma vez pelo
   `nova-tarefa`. Daí "até acabar" funciona sem você dosar o N. Custo: 15 min. Risco: nenhum.
3. **Migration: portão do dono no deploy, não no merge.** Decisão sua. Tirar
   `supabase/migrations/` dos caminhos protegidos, manter Opus + Sol obrigatório + uma por vez
   + `/code-review ultra` bloqueante antes do deploy (já é regra). O lotufo fez isso em 16/10 e
   subiu três migrations num deploy só. Risco: migration corretiva se a `main` levar erro
   (bancada do dono reseta). ADR curto se aceitar.
4. **Revisor adversarial sem ruído.** Leis = Crítico/Aviso (travam); régua de tela e
   legibilidade = Sugestão (não trava). Corta rodadas de correção que hoje nascem de 12 achados
   numa PR de texto. Custo: 2 linhas em `.claude/agents/revisor-adversarial.md`.
5. **Fila de merge, quando o repo virar público.** Exige organização no GitHub; é a hora de
   mover (Fase 2 do fluxo). Com ela, cai a espera de "main verde antes da rodada" (11-15 min
   por rodada encadeada). Até lá, não afrouxar essa pré-condição.

Depois, se sobrar vontade: `.claude/rules/*.md` com `paths:` para a trabalhadora carregar só a
Lei do arquivo que toca; quadro Kanban movido pela orquestradora; `settings.local.json` zerado.
