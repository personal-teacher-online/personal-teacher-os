# Fluxo paralelo — sessões em worktree, PR por tarefa, CI como juiz

> **Nota de 15/10/2026:** o fluxo ganhou a camada orquestrada, decidida pelo
> dono em 14/10/2026 e montada em etapas (PRs #12 a #16): GitHub Issues como
> fila, orquestradora + trabalhadoras em worktree (agentes), revisor
> adversarial e gate Sol em toda PR, auto-merge com travas, caminhos protegidos
> e trava da `main` sem `strict`. **A regra vigente é a seção "Como o trabalho
> anda" do `CLAUDE.md`**; o rito de cada papel está nas skills `orquestrar`,
> `nova-tarefa`, `abrir-pr` e `gate-sol` e nos agentes de `.claude/agents/`. O
> que segue abaixo continua valendo onde não contradiz isso (peças, CI vermelho,
> medições, histórico), e o §3 descreve a sessão MANUAL.
>
> Decidido pelo dono em 10/10/2026 e montado em 4 etapas (PRs #1 a #6) entre
> 10 e 11/10/2026. Substitui, nesta máquina, o fluxo multiagente da casa
> (`~/dev/FLUXO-MULTIAGENTE.md`, que só existe no Mac). As Leis e a Disciplina do
> `CLAUDE.md` continuam valendo por cima deste documento; aqui está o RITO.

## 1. A ideia em uma frase

O gargalo passa a ser o tempo de revisão do dono, não o tempo do Claude: várias
sessões trabalham ao mesmo tempo, cada uma na própria cópia do projeto e na
própria branch, e tudo o que elas produzem chega ao dono como um PR já
verificado por máquina (CI) e por revisor adversarial (`/code-review`). O dono
não lê código: lê o resumo do PR, confere o ✓ verde e decide o merge.

## 2. As peças (o que existe e onde)

| Peça | Onde | O que faz |
|---|---|---|
| CI | `.github/workflows/ci.yml` | Em cada PR e em cada push na `main`: `tsc`, `eslint` e a suíte completa contra um Supabase próprio e descartável. ~11 min (3 para subir o banco, 6,5 de suíte). |
| Trava na `main` | Configuração do GitHub (plano Pro) | Só aceita merge por PR com o check "tsc + lint + suíte" verde e o PR atualizado com a `main`. Vale para o dono. Sem force-push, sem apagar a branch. |
| Worktree pronta | `.worktreeinclude` + hook SessionStart | Worktree nova recebe o `.env.local` da bancada e instala as dependências sozinha (`npm ci`, ~40 s), ou reinstala se o lockfile mudou. |
| Lint a cada edição | hook PostToolUse `.claude/hooks/after-edit.mjs` | Depois de editar um arquivo de código, roda o eslint nele (~4 s). Erro volta para a sessão, que corrige antes de seguir. |
| Pre-commit | `.githooks/pre-commit` (ligado por `core.hooksPath`, que o SessionStart grava) | Antes de cada commit com código: `tsc` do projeto (~13 s) + eslint nos arquivos do commit. Erro recusa o commit. |
| Revisor adversarial | `/code-review` (na sessão); `ultra` nos PRs sensíveis | Lista achados por ângulo; a sessão tria, corrige e registra no PR o que ficou de fora e por quê. |
| Memória | `CLAUDE.md`, `AGENTS.md`, `Design.md`, goals em `docs/goals/` | Regras e estado. O CLAUDE.md só muda quando uma REGRA muda; andamento de tarefa fica no PR e no goal. |

## 3. O rito de uma tarefa

1. **Abrir a sessão na worktree.** No app: Nova sessão → opção *worktree* ao lado
   da branch. A sessão nasce na `main` atualizada, com branch própria. O hook de
   início instala o que falta e imprime o lembrete da bancada.
2. **Plano antes de código.** A sessão abre em plan mode, lê o goal da onda e
   apresenta o recorte: arquivos a criar/alterar, o que cada um faz, critério de
   pronto, testes previstos. O dono dá o OK (uma pergunta de esclarecimento se
   o pedido admitir leituras diferentes; 2–3 opções, a recomendada primeiro).
3. **Trabalho dentro do recorte.** Hooks corrigem lint na hora; testes
   focados onde o repositório já os mantém. Nada de `npm test` completo nem
   `supabase db reset` sem a bancada livre (§4a).
4. **Commit e PR.** Commits pequenos, mensagem que diz o porquê. `gh pr create`
   com descrição em três blocos: *O que muda* (em palavras, para quem não lê
   código), *Por quê*, *Conferência* (o que foi medido). PR que toca migration
   diz isso no título.
5. **CI e revisão.** O CI roda sozinho. A sessão roda `/code-review <nº do PR>`,
   corrige o que procede, re-reporta os achados com o desfecho de cada um e
   faz push. Vermelho no CI é da sessão resolver (§5), nunca afrouxando teste.
6. **Merge é do dono.** Com ✓ verde e revisão triada, a sessão avisa. O dono
   mescla no GitHub (*Squash and merge*) ou diz "mescle você" — a autorização é
   por PR, não permanente. Com a autorização dada, a sessão pode armar o merge
   automático do GitHub naquele PR (squash); a trava continua valendo. O
   repositório apaga a branch no merge.
7. **Depois do merge.** O goal da onda ganha a linha do que fechou (no mesmo PR
   ou no seguinte). **Os outros PRs abertos ficam "atrás" da `main`** e a trava
   exige PR atualizado: a SESSÃO de cada um traz a `main` para a branch (merge,
   nunca rebase) e faz push — o merge automático e o Auto-fix NÃO fazem isso
   sozinhos (medido no piloto: o PR #8 ficou parado até o dono mandar). O CI
   roda de novo e aí o merge sai. O app arquiva a sessão quando o PR mescla
   (opção "arquivar ao fechar o PR", ligada por escolha do dono) e remove a
   worktree.

Comece com 2 ou 3 sessões. Mais que isso e o dono vira o gargalo na leitura.

## 4. As três regras de convivência ("Como o trabalho anda" no CLAUDE.md)

a. **Bancada única.** O Supabase local (54321/54322) é um só, compartilhado por
   todas as worktrees, e aguenta UMA rodada da suíte por reset. Só a sessão que
   o dono liberou ("bancada livre") roda reset ou suíte completa; as outras
   usam testes focados e o CI. O dono é o semáforo.
b. **Uma migration por vez.** Só um PR aberto pode conter migration. Os nomes
   usam data e hora escolhidas à mão e duas sessões no mesmo dia colidem; e a
   Lei 7 (imutável depois de aplicada) exige ordem.
c. **Estado fora do CLAUDE.md.** Andamento de tarefa vive na descrição do PR e
   no goal da onda. O CLAUDE.md muda quando uma regra muda, para que sessões em
   paralelo não editem as mesmas linhas.

Além delas: deploy continua manual pelo runbook (merge na `main` não publica),
e a `main` só anda por PR.

## 5. Quando o CI fica vermelho

1. Ler o passo que falhou (`gh run view <id> --log-failed`) antes de mexer.
2. Separar **ambiente** (runner sem memória, clone raso, variável faltando) de
   **teste** de **produto**. Os dois primeiros se corrigem no workflow ou no
   fixture; o terceiro é o bug que o teste achou — o bug é o problema, não o
   teste.
3. Teste que depende da data ou da hora do relógio é defeito do teste: datas
   relativas (`daysFromToday`, `proximaVirada`) e instantes fixos
   (`createInstanceAt`), nunca data cravada nem "agora + N dias" pareado com
   hora fixa no mesmo dia (medido em 10/10: dois casos assim derrubaram o CI).
4. Correção de teste vai em PR próprio quando o PR original é de outra coisa.
5. O "vermelho conhecido" da bancada (limite de 1000 linhas no wizard) NÃO
   acontece no CI: o runner é limpo, a bancada acumula alunos entre rodadas.

## 6. Modelos e revisão

- Orquestradora: Opus. Trabalhadora: Sonnet, ou Opus quando a issue tem
  `risco:*`. Revisor adversarial: Opus. Listagem de issues: Haiku. Recorte e
  arquitetura de tarefa grande (sessão manual): Fable 5.1.
- `/code-review` em todo PR (triado pela própria sessão). Revisor adversarial
  (agente) em todo PR. Gate Sol (codex, skill `gate-sol`) nos PRs com
  `risco:*` ou que tocam migration, ledger, RLS, materialização ou outbox.
- `/code-review ultra` (3 rodadas grátis, depois pago) é o gate do dono: ele
  dispara, e é bloqueante antes de deploy que leva migration ou toca dinheiro,
  ledger, RLS ou fuso. A orquestradora não consegue rodá-lo.
- O codex CLI (gate Sol) está instalado nesta máquina desde 10/2026 (0.162);
  sem ele, o gate registra "não rodou" e a PR espera o dono (`precisa-do-leo`).

## 7. Medições de referência (10–11/10/2026, Windows de casa)

| O quê | Tempo |
|---|---|
| Rodada do CI completa | ~11 min |
| `tsc --noEmit` local | 13 s |
| eslint em 1 arquivo | 4 s |
| `npm ci` numa worktree nova | 35–45 s |
| Minutos de CI do plano Pro | 3.000/mês (≈ 260 rodadas) |
| Piloto: PR #7 (7 arquivos de teste), do PR ao merge | 15 min |
| Piloto: PR #8 (tela nova, 11 arquivos, +1.5k linhas), do PR ao merge | 42 min, com 2 rodadas de CI (revisão + sincronização com a `main`) |
| Fumaça do fluxo orquestrado (15/10): trabalhadora, da issue à PR | 5m35s (#18, só teste) · 6m32s (#17, código + teste) |
| Fumaça: revisor adversarial, 1ª rodada / só o diff novo | 1m31s–4m19s / 21s–54s |
| Fumaça: correção pela trabalhadora | ~1 min |
| Fumaça: CI da PR / CI da `main` | 8–10 min / 10–12m40s |
| Fumaça: rodada inteira (2 issues, 2 PRs mescladas) | 1h33, dos quais ~49 min parados em pedido de permissão (ver §8) |

## 8. Follow-ups registrados pelo fluxo

- ~~Limpeza global do outbox nos testes~~ — resolvido (11/10): as 11
  limpezas por prefixo de chave (f2, f5, f6, f10, a6, a6-lote2) passaram a
  filtrar pelo template e pelo aluno, aula ou encontro do próprio teste. A
  varredura de 1 h do `fase3-dispatch` fica como está (só alcança órfãs velhas).
- O pre-commit avalia os tipos na árvore de trabalho, não só no stage; commit
  parcial é julgado pelo disco. O CI é quem julga o commit.
- ~~Outros testes com datas de 2026 cravadas~~ — conferido (12/10): não há
  bomba. a3, a5 e a8 rodam com relógio simulado (`setSystemTime`) ou dados de
  mentira; os casos do m3-c7 são contas de fuso que não consultam "hoje".
- ~~`fase3-dispatch`, caso "token correto", despacha a fila inteira~~ —
  resolvido (12/10): o handler aceita `keyLike` (só o teste passa) e o caso
  filtra pelo aluno que ele mesmo criou.
- Os outros casos do `fase3-dispatch` filtram por `credit-expiry:%`, que ainda
  alcança os avisos que o `fase3-outbox` enfileira (`enqueue_credit_expiry_notices`)
  quando os dois rodam em paralelo. Estreitar para o aluno de cada caso se algum
  deles flakear. O caso "token correto" também ainda roda
  `enqueue_class_touches()` sobre o banco inteiro (só enfileira, com dedupe;
  não despacha mais nada alheio).
- Chip de período da tela Mensagens copiado do Financeiro: extrair peça comum
  quando uma terceira tela usar o mesmo (achado da revisão do #8, não aplicado).
- ~~Casos do `fase3-dispatch` com `credit-expiry:%`~~ — resolvido (15/10, #27):
  filtram pelo aluno do próprio caso.
- Anotados pelas trabalhadoras da fumaça (15/10), fora do recorte das issues:
  `contracts.select('plan_name')` na mesma leitura do wizard também é cortada em
  1.000 linhas (vira issue quando os planos passarem de algumas centenas);
  o `max_rows` do PostgREST em produção nunca foi medido (se for ilimitado, a
  leitura paginada do diretório pode parar na página curta); `seedOutboxRow`
  sorteia dois ids de contrato quando não recebe `contractId`.
- `gh pr merge *` está na lista "pergunta antes" do `.claude/settings.json`
  e o app pediu aprovação mesmo em modo bypass: a orquestradora ficou 44 min
  parada na #27 e 5 min na #28. Tirar da lista é mudança que o classificador
  de permissões não deixa a própria sessão fazer: é edição do dono.

## 9. Histórico curto

- Etapa 1 (10/10): CI (#1), correção dos dois testes com bomba de relógio
  (#2, #3), trava na `main`.
- Etapa 2 (11/10): `.worktreeinclude` + hook SessionStart (#4).
- Etapa 3 (11/10): hook de lint pós-edição + pre-commit + ativação automática (#5).
- Etapa 4 (11/10): este documento, Disciplina §1, §2 e §6, revisão adversarial
  e Estado atual do CLAUDE.md, AJUSTES.md (#6).
- Etapa 5 (11/10): piloto com duas sessões em worktree ao mesmo tempo — #7
  (higiene do outbox nos testes) e #8 (M3-3a, tela Mensagens sem migration).
  Os dois com CI verde, `/code-review` triado e merge sem conflito; o dono não
  abriu código. Lições que viraram texto: o passo 7 (PR "atrás" da `main`
  precisa da sessão), um pedido por sessão (o pedido B foi colado em duas
  sessões por engano e uma teve de ser redirecionada), e o Docker Desktop
  travando ao abrir (sockets em `%LOCALAPPDATA%\Docker`; reboot resolve) —
  nenhuma sessão rodou a suíte local, e o CI bastou.
- Fluxo orquestrado (14–15/10): etapas a–e em PRs #12 a #16 (modelos e labels,
  skills, agentes, permissões e hook `SubagentStart`, seção "Como o trabalho
  anda" no CLAUDE.md), fila carregada (#17 a #25), plano da Fase 2 (#26).
- Fumaça do fluxo orquestrado (15/10, PRs #27 e #28, issues #18 e #17): uma
  rodada de 2 ponta a ponta — orquestradora em sessão própria, duas
  trabalhadoras em worktree em paralelo, revisor adversarial em cada PR (achou
  Aviso nas duas; uma rodada de correção cada), CI vermelha numa delas
  (teste com folga de 2 alunos; corrigido pela trabalhadora), auto-merge por
  squash, `main` verde em 79c026c, worktrees removidas sem `--force`. O que
  foi medido e virou texto: o hook `SubagentStart` RECEBE o cwd da worktree
  (o `npm ci` rodou dentro de cada uma) e o `.worktreeinclude` copia o
  `.env.local` também para a worktree do agente; `gh pr checks` responde "no
  checks reported" por ~30 s depois do push (reconsultar, não é recusa); o
  GitHub levou 5 min para executar um auto-merge já verde; as trabalhadoras
  preencheram a linha do revisor em `## Gates` (a orquestradora sobrescreve);
  a orquestradora encerrou o turno ao achar a CI da `main` em andamento, em
  vez de esperar dentro dele (skill corrigida); e o maior tropeço, o pedido de
  permissão no `gh pr merge --auto` (§8).
- Próximo da onda: M3-0 (#19, sessão manual com o dono) → M3-1 (#20, migration)
  → M3-2 (#21) → M3-3b (#22); M3-4 (#23) pode andar antes.
