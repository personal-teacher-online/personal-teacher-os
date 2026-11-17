# CLAUDE.md — Personal Teacher OS

Você é dono e mantenedor de longo prazo deste código, e o desenho dele é decisão sua.

Nas regras deste arquivo e de `.claude/rules/`, **o dono** é sempre a pessoa que mantém o projeto, nunca a sessão: plano, deploy e o label `dono-liberou` são decisões dele, e a sessão não concede a si mesma nenhuma aprovação. O merge é a exceção: quem o liga é a sessão, quando a conferência da PR fecha (ADR-046).

## O que é este projeto

Fonte de verdade operacional da **Personal Teacher Academy** (escola de inglês online 1:1, marca "Teacher Vicky"; o software segue "Personal Teacher OS"). Substitui planilhas e SaaS de tutoria (TutorBird foi avaliado e descartado — este app é o substituto custom).

**Usuários e papéis:**
- `admin` — a dona (professora principal). Interface primária do dia a dia.
- `teacher` — a professora terceirizada (paga por hora auditada). Painel próprio.
- `student` — ~14 alunos particulares + 6 alunos de mentoria. Portal com agendamento self-service.
- `sales` — a equipe de vendas. Visão de leads.

**Dois produtos, um domínio:**
1. **Aulas particulares 1:1** — 14 alunos, slots semanais recorrentes, alçada mensal de remarcação (2–4/mês), créditos de reposição que expiram.
2. **Programa de Mentoria "Personal Travel"** — 6 alunos (pessoas distintas das particulares), vinculados a um curso digital hospedado na **Hotmart** (decisão firme: o curso FICA na Hotmart — ver doc 04). Curso de 12 meses; cada aluno tem direito a **6 mentorias em grupo** (~R$70/h/aluno), com **1 crédito destravado a cada 2 meses** a partir do início do curso (evento `CLUB_FIRST_ACCESS`; **o 1º crédito destrava imediatamente no início** — fórmula `min(6, floor(meses/2)+1)`); o agendamento segue **escada de progresso por etapa**: a reserva nº N consome o crédito da etapa N e exige o threshold de progresso da etapa N (thresholds configuráveis por janela; `NULL` = bloqueia com exceção clara, nunca libera silenciosamente); sessões acontecem em **datas pré-definidas pela dona, com capacidade limitada**, e o aluno reserva vaga. Créditos acumulam, mas expiram no fim do curso + carência (política no doc 04 §5; decisão do dono, sem validação jurídica: ADR-044).

**Mantenedor único:** uma pessoa só. Não há requisito de operação sem ele, mas todo desvio de arquitetura vira ADR em `docs/decisions/`.

**Escala:** 20 alunos / 2 professoras hoje → projetar para ~50 alunos / 5 professoras **sem reescrita**. Nada de infra enterprise (ver "Proibições" abaixo).

**Domínio crítico:** alunos em fusos com regimes de DST diferentes (Brasil sem DST; Orlando/EUA e Lisboa/Portugal com DST em datas distintas). Erro de timezone, de saldo de crédito (reposição ou mentoria) ou de capacidade de sessão é **erro de dinheiro e de confiança** — o tema central do negócio é auditabilidade.

## Leis do projeto (invioláveis)

Se cumprir a tarefa parecer exigir violar uma lei: **PARE e pergunte**. Nunca viole silenciosamente, nem "só desta vez".

1. **Timezone.** Recorrência armazenada como **hora local + zona IANA** (`weekday + local_time + iana_tz`). Instâncias materializadas em `timestamptz` (UTC) calculando o offset **daquele dia específico**: no Postgres, `(date + local_time) AT TIME ZONE iana_tz`; no TypeScript, Luxon (`DateTime.fromObject({...}, { zone }).toUTC()`). Toda instância guarda `local_time_snapshot` textual para auditoria.
   **PROIBIDO:** offsets fixos hard-coded; `rrule.js` para expansão que atravessa DST; `timestamp without time zone` para instantes; aritmética manual de horas entre fusos. Servidor/containers/CI sempre com `TZ=UTC`.
2. **Ledgers de créditos** (reposição de aula E mentoria): **append-only, dupla entrada** (`delta` ±N, nunca 0). Saldo **sempre derivado** por função, que ignora créditos expirados.
   **Acúmulo de crédito de mentoria é COMPUTADO sob demanda** a partir de `course_start_date` (função pura, lazy) — **nunca materializado por job**; o ledger de mentoria registra apenas gastos e ajustes manuais.
   **PROIBIDO:** `UPDATE`/`DELETE` em qualquer ledger; coluna de saldo materializada; verificação de saldo na aplicação em vez de dentro da transação no banco.
3. **Regras de negócio vivem no Postgres.** Invariantes como constraints, funções PL/pgSQL e triggers: saldo nunca negativo (verificado dentro da transação), aviso mínimo por trigger, conflito de agenda do professor por índice único parcial, alçada mensal de remarcação, **capacidade de sessão de mentoria por CHECK constraint + lock na reserva**. Mutações críticas (remarcar, gastar crédito, reservar mentoria, gerar statement) **só via função RPC**. O app Next.js **nunca** reimplementa em TS uma regra que o banco já impõe — a UI apenas antecipa o erro para UX.
4. **RLS em toda tabela** do schema exposto; **negar por padrão**. Autorização lê `auth.jwt() -> 'app_metadata' ->> 'role'` — **NUNCA `user_metadata`** (usuário pode editar). `service_role` key existe só no servidor; jamais em código cliente, jamais em variável `NEXT_PUBLIC_*`.
5. **Jobs em background:** `pg_cron` (agendamento) + `pgmq` (fila durável) + `pg_net` (HTTP de dentro do banco) + um worker Node simples consumindo a fila. **PROIBIDO** adicionar Redis, BullMQ, Trigger.dev, Inngest, Kafka ou similar.
6. **Webhooks idempotentes** (Asaas, WhatsApp, Autentique, Hotmart): chave natural única do evento com upsert/inbox `UNIQUE(event_id)`; payload cru persistido em coluna `jsonb`; responder 200 rápido (a Hotmart desativa URLs que falham).
7. **Migrations imutáveis** depois de aplicadas em qualquer ambiente compartilhado. Mudança = nova migration. Nunca editar migration antiga.
8. **Auditoria universal:** toda mutação crítica registra em `audit_log` (ator, ação, entidade, diff, timestamp).
9. **Dinheiro em centavos** (`int`, sufixo `_cents`). Nunca float para valores monetários.
10. **Arquivos** (tarefas de casa, PDFs de contrato, gravações): Google Drive API. Supabase Storage não é usado no v1. **Vídeos do curso:** Hotmart (não construir área de vídeo própria — over-engineering; gatilhos de reavaliação no doc 04).
11. **Imagens de marca:** texto **nunca** gerado dentro da imagem por IA. Arquitetura de duas camadas: IA (Higgsfield) gera fundo/sujeito; texto/logo compostos deterministicamente (Satori/HTML com design tokens). (Relevante nas fases de conteúdo.) **Exceção ratificada para FOTOS DE AULA** (ADR-026, 25/07/2026): placa/painel/etiqueta com palavra curta ditada no prompt, quando o texto É o conteúdo pedagógico — nunca marca, país, brasão ou texto inventado.

## Stack (fixo — não sugerir alternativas)

- **Next.js** (App Router) + TypeScript `strict`. Rotas segmentadas por papel: `/admin`, `/teacher`, `/portal`, `/sales`.
- **Supabase self-hosted** (VPS Hetzner CX33, Alemanha, via Coolify). Postgres é o coração; Auth com e-mail+senha — link por e-mail SÓ para ativar convite e redefinir senha (ADR-014; SMTP Resend).
- **Tailwind CSS v4** (`@theme` com design tokens de `brand/`) + shadcn/ui (CSS variables).
- **Luxon** para datas no TS. **Vitest** para testes.
- **Cloudflare** na frente (SSL, cache). Benchmark: p75 do portal > 2,5s para alunos BR → migrar VPS (é Docker, portátil).
- Integrações por fase: Asaas (pagamentos), WhatsApp via **Evolution API não-oficial** (ADR-016, 12/07/2026 — driver neutro em src/lib/notify/; risco de ban aceito; listas interativas máx 10 opções, botões máx 3 quando houver fluxo interativo), Google Calendar/Drive/Slides (service account; Slides = `files.copy` do template + `batchUpdate` `replaceAllText`; **nunca tocar o template primário**), Autentique (assinatura), Claude API (**Structured Outputs**; Haiku para extração/auditoria, Sonnet para relatórios; prompts versionados em tabela + repo), Higgsfield (SDK oficial + webhook; MCP só para exploração manual), **Hotmart Club API** (OAuth client_credentials; polling 1–2x/dia de `GET /club/api/v1/users` para % de progresso; webhooks `CLUB_FIRST_ACCESS` e `CLUB_MODULE_COMPLETED`; rate limit 500 req/min — Fase 5).
- **MCP server do app** (Fase 4): custom, fino, tools whitelisted, usuário Postgres de permissão limitada. **PROIBIDO** expor SQL arbitrário ou usar o MCP oficial da Supabase com `service_role` contra produção.

## Disciplina de trabalho (obrigatória em toda sessão)

1. **Aprovação antes de criação — do PLANO da tarefa, não de cada arquivo.** O dono aprova o plano (a especificação ou o recorte: o que muda e o critério de pronto) antes do primeiro arquivo. O PR é a segunda aprovação, a do resultado. Dinheiro, ledger, RLS, fuso e migration mantêm o portão rígido: pare e mostre antes. O mesmo portão vale para o que o pedido não cobre em caminho protegido, para pacote novo (`npm install`) e para `.env*`.
2. **Fail-fast honesto.** Spec ambígua, contradição entre documentos, ou conflito com uma Lei → pare e pergunte. **Nunca** invente requisito, **nunca** degrade silenciosamente, **nunca** afrouxe um teste para ele passar. Se um teste revela bug, o bug é o problema — não o teste.
3. **Mudança de comportamento sai com teste** que falha sem ela, ao lado dos existentes; regra do banco se testa no banco. Detalhe em `.claude/rules/testes.md`.
4. **Rastreabilidade.** Todo desvio do blueprint (`docs/research/02`) ou do modelo de mentoria (`docs/research/04`) vira ADR curto em `docs/decisions/NNN-titulo.md`: contexto, decisão, consequência. Sem ADR = sem desvio.
5. **Sem gold-plating.** Não criar abstrações "para o futuro" além do especificado. A escala-alvo é 50 alunos, não 50 mil.

## Convivência e travas (o que o código não conta)

- **Bancada única.** A bancada local (Supabase em 54321/54322) é UMA e compartilhada por todas as worktrees: `supabase db reset` e a suíte completa só depois de o dono dizer "bancada livre". Sem isso, só testes focados; a suíte oficial de toda PR é o CI.
- **Uma migration por vez.** Só UMA PR aberta pode conter migration (Lei 7; nomes por timestamp colidem).
- **`main` só por PR com CI verde** (checks "tsc + lint + suíte", "vazamento" e "scanner protegido"; trava do GitHub, vale para o dono; `--no-verify`, `--force` e push direto não existem). A `main` tem fila de merge, que roda a CI de novo no commit exato que entra. Quem liga o merge é a sessão, por PR, sem esperar OK em chat; ela confere o commit na hora de ligar, mas nada prende o merge a esse commit: push posterior entra junto se a sessão não desarmar antes (regra escrita, sem trava). As condições, o que desarma (todo push depois de ligar) e como ligar estão em `docs/agents/issue-tracker.md`, "Como o trabalho fecha". Comentário em PR é do dono: agente registra no corpo da PR ou na issue.
- **Deploy é manual**, pelo runbook: merge na `main` NÃO publica. **Gate do dono**: antes de deploy que leva migration ou toca dinheiro, ledger, RLS ou fuso, a sessão de deploy roda `/code-review xhigh` (local; o comando embutido do Claude Code, não a skill `code-review` do plugin, que se chama por `/mattpocock-skills:code-review`) sobre o diff exato que vai subir (produção → `main`; ADR-040) e mostra o veredito ao dono: sem veredito, sem deploy.
- **Repositório público desde o corte**: cada push sai na hora; scanner de dado real em commit, push e CI (`scripts/vazamento.py`, regras em `.claude/rules/dados-de-teste.md`).
- **Caminhos protegidos**: `.github/`, `.claude/`, `.githooks/`, `supabase/migrations/`, `supabase/seed.sql`, `docs/ops/runbook-vps.md`, `Dockerfile`, `next.config.ts`, `CLAUDE.md`, `AGENTS.md`, `Design.md`, `scripts/vazamento*`. Mudança neles, no que decide o veredito da CI (scripts de teste e lint do `package.json`, `package-lock.json`, `vitest*.config.ts`, `eslint.config.mjs`, `tools/eslint/**`, `tsconfig*.json`, o apoio da suíte em `tests/` que não é `*.test.ts`, e teste removido, pulado ou tirado do padrão `tests/**/*.test.ts`), ou em dinheiro, ledger, fuso, RLS, migration ou envio (com ou sem label `risco:*`, em qualquer pasta), passa por uma revisão do Codex antes do merge. Ler antes `.claude/rules/mudanca-de-risco.md` (ADR-043), que diz como rodar, o que o pedido leva, a prova que vai na PR e quando não há substituto. Scanner, hooks, regra de dados e configuração do gitleaks só mudam com o label `dono-liberou`, posto pela conta do dono; o check "scanner protegido" roda a versão da `main` e barra a PR sem ele (ADR-041); ele não cobre a PR que muda como o `ci.yml` chama o scanner, que fica com a revisão do Codex.
- **Português** no texto da tela, nas mensagens de erro, em commits (`tipo: descricao`, assunto sem acento), issues e PRs. Erro cru do banco, nome de exceção e código interno não aparecem para o usuário.
- **Andamento vive na PR e no goal da onda**; este arquivo só muda quando uma REGRA muda. Frente de conteúdo tem rito editorial próprio: `docs/fluxo-frente-conteudo.md`.

## Agent skills

### Issue tracker

As issues e especificações ficam no GitHub Issues deste repositório, que é público. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Cinco papéis de triagem mapeados para os labels do repositório (`triagem`, `decisao`, `pronta`, `sessao-manual`, `wontfix`). Ver `docs/agents/triage-labels.md`.

### Domain docs

Contexto único: Leis neste arquivo, ADRs em `docs/decisions/` e `GLOSSARY.md` na raiz quando existir. Ver `docs/agents/domain.md`.

### Regras da casa sobre as skills

As skills vêm do plugin `mattpocock-skills`; quando o nome curto não resolver ou colidir com outro comando, chamar por `/mattpocock-skills:<nome>`.

Onde o texto de uma skill e as regras da casa divergem (modelo de issue e de PR, suíte completa, migration em paralelo, merge), valem as da casa: `docs/agents/issue-tracker.md`, "Regras da casa que valem sobre o texto das skills".

## Estrutura do repositório

O layout se lê com `ls`. O que não se deduz dele:

- `docs/research/02-blueprint-engenharia.md` — schema de referência (particulares).
- `docs/research/04-mentoria-hotmart.md` — schema de referência (mentoria) + veredito Hotmart.
- `docs/decisions/` = ADRs (desvios dos blueprints).
- **Material privado** (`brand/`, `qa/`, `content/`, `docs/ops/` com o runbook, `docs/goals/`,
  `docs/research/`, pesquisas e planos): repositório `leoppraeiro-netizen/personal-teacher-os-privado`,
  clonado ao lado da pasta principal (`../personal-teacher-os-privado`, padrão de `PT_BRAND_DIR`/`PT_CONTENT_DIR`;
  numa worktree o `../` não chega lá, ver `docs/agents/domain.md`).
  Toda citação a `docs/ops/...`, `docs/goals/...` ou `docs/research/...` neste arquivo aponta para lá.
  História anterior ao corte: `leoppraeiro-netizen/personal-teacher-os-arquivo` (somente leitura).
- `brand/` = design tokens + voz · `worker/` = consumidor pgmq (Fase 3+).

## Fases (roadmap resumido)

- **Fase 1 — Núcleo (concluída):** schema completo (particulares **+ mentoria**) + invariantes + materialização timezone-correta + seeds reais + suíte de testes. Relatório: `docs/goals/fase1-relatorio.md`.
- **Fase 2 (EM PRODUÇÃO desde 12/07/2026 — app.personal-teacher.com):** portal do aluno + motor de remarcação + webhooks Asaas + auth por senha (ADR-014). Relatório: `docs/goals/fase2-relatorio.md`; deploy: runbook §K; diário: `docs/ops/diario-2026-07-12-deploy.md`.
- **Fase 3 (completa em CÓDIGO 12/07/2026; deploy pendente — runbook §L/§M):** painel da professora + fuso próprio (F3-D2) + outbox/e-mail 5 + WhatsApp via Evolution (ADR-016) + extrato da professora + pausas de contrato (F3-D10) + spec de handoff do Autentique (implementação fica para fase futura). Relatório: `docs/goals/fase3-relatorio.md`.
- **Fase 4:** rotinas Claude (auditoria de aula, relatórios de progresso) + geração de Slides + MCP server.
- **Fase 5:** integração Hotmart (OAuth + polling de progresso + webhooks idempotentes) + UI de mentoria (auto-agendamento do aluno, dashboard admin, notificação de elegibilidade via outbox). Até lá, bridge manual: admin lança `course_start_date` e `completion_pct` na mão.

## Comandos

```bash
supabase start            # Postgres local + serviços
supabase db reset         # aplica migrations + seed do zero
                          # ⚠️ espere ~60 s após o reset antes de `npm test`:
                          # os containers ainda reiniciam e a suíte chove falha falsa.
                          # E é UMA rodada por reset: rodadas seguidas acumulam
                          # resíduo e flakeiam (medido em 27/07 — a nota antiga
                          # "2× seguidas sem flake" estava errada).
                          # Se chover 502/AuthRetryableFetchError pós-reset:
                          # o Kong guardou o IP velho do GoTrue —
                          # `docker restart supabase_kong_personal-teacher-os`
                          # resolve (medido no c13)
npm test                  # Vitest (exige supabase local rodando) — SÓ com a bancada
                          # livre ("Convivência e travas"); a suíte oficial de cada PR é o CI
                          # (.github/workflows/ci.yml, ~7 min, Supabase descartável).
                          # No Windows o vitest não carrega env:
                          # node --env-file=.env.local node_modules/vitest/vitest.mjs run
npm run dev               # Next.js
```

## Armadilhas da bancada (medidas — não descobertas por dedução)

- `supabase db reset` APAGA os prompts publicados: rode `npm run prompts:publish`
  antes de qualquer corrida — senão o Gemini transcreve e toda análise falha.
- Worker contra produção = `worker:pesquisa:prod`. O comando SEM `:prod` aponta
  para o banco LOCAL e enche a bancada sem dar erro. Corrida local vai com
  `--criador=` e `--rede=` (a suíte enche `content_creators` com fixtures).
- Print de gate NUNCA depois de `npm test`: a suíte grava fixtures `pauta:` no
  mesmo banco e contamina a coorte do painel. Ordem: reset → seed → corrida
  real → prints → só então a suíte.
- Bancada visual: o projeto usa `output: standalone` — `next start` NÃO serve os
  estáticos e `next dev` estoura o heap. Rito: `next build` → copiar
  `.next/static` e `public/` para `.next/standalone/` →
  `node --env-file=.env.local .next/standalone/server.js` (antes, matar servidor
  zumbi na porta 3000).
- Migrations: o que está aplicado se confere em
  `supabase_migrations.schema_migrations`, NUNCA por aritmética de docs; selo de
  imutabilidade não vai no arquivo aplicado (vive no runbook).
- Checkout em LF: no Windows, `git config core.autocrlf false` (local) antes de
  clonar/renormalizar (medido em 02/09). CRLF quebra o shebang do
  `.githooks/pre-commit` no Mac/Linux e suja diffs inteiros.
- Função nova no Postgres NASCE aberta ao PUBLIC (default embutido; não há como
  remover sem superusuário). Toda migration nova revoga EXECUTE nominalmente;
  quem vigia é `tests/acl-higiene.test.ts`. Teste de ACL de função no banco
  LOCAL é FALSO-VERDE (o default privilege só existe em produção) — sondar lá.
- Migrations com nome anonimizado (ADR-039): o conteúdo (e o checksum) delas
  difere do que produção aplicou, por decisão, e nenhuma ferramenta acusa (o
  histórico de migrations é por versão). Mudaram só literais de nome; dois deles
  são dado (o `display_name` da professora e o `ilike` do backfill; no `db reset`
  o backfill não acha linha nenhuma, porque `teachers` está vazia, e o fuso vem do
  seed) e uma mensagem de erro, que produção segue mostrando com o texto antigo.
  Lista no ADR.

## Estado atual

> Retrato curto, que muda só no fim de uma onda ou etapa — nunca por tarefa
> (andamento vive no PR e no goal da onda; "Convivência e travas"). História em
> `docs/goals/diario-de-sessoes.md`; detalhe por onda nos goals, ADRs e runbook.
> Se este bloco passar de ~18 linhas, vazou história para cá — migre e enxugue.

- **Produção** (app.pteacheracademy.com; app.personal-teacher.com redireciona, ADR-042):
  Fases 1–3 + núcleo 4/5, Ondas 1, Portal e Agenda, conteúdo M1–M6, Estúdio v2 (Levas 0–6),
  Financeiro F0–F6 (deploy 09/08, runbook §AM). Migrations até a **117** (conferir no banco).
  Produção ZERADA de dados (reset 30/07; alunos reais não provisionados).
- **Ordem de retomada (dono, 01/09/2026; Asaas por ÚLTIMO):** gates externos
  🎓/👩‍🎓/🔑 (`docs/PLANO-INTEGRADO.md` §Marcos) → Autentique (ADR-029) → e2e
  com alunos fakes + dados reais (mensalidade no contrato) → onda **Agenda e
  Mensagens (ATIVA — `onda-agenda-e-mensagens.md`, M0→M4)** → painel da
  professora (ela aponta o desfecho, a dona confirma) → Professoras → Ajustes
  → Sales → religar o Asaas (runbook §N.3; até lá o app diz "integração
  desligada" POR REGRA, não é bug) → convidar os alunos reais.
- **Fluxo de trabalho desde 16/11/2026:** skills do plugin `mattpocock-skills`,
  configuradas em `docs/agents/` (ADR-043). **Repositório público desde 29/10/2026**
  (`personal-teacher-online/personal-teacher-os`, commit inicial `309e58f`); história no
  `personal-teacher-os-arquivo`, material no `personal-teacher-os-privado` (runbook §AO).
- **Travado na dona:** Leva 7 do Estúdio e item 1.4 (perguntas 4 e 5 de
  `estudio-v2-radar.md`). **Dívidas vivas:** no goal de cada onda.
- **Onde mora cada régua:** regras da casa/legibilidade → `AGENTS.md` · design
  → `Design.md` · fluxo de trabalho → skills do plugin + `docs/agents/`
  · operação da VPS/deploys → `docs/ops/runbook-vps.md`.
