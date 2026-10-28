# Fluxo de trabalho da frente de Conteúdo — v2 (modelos por papel + exceção adversarial)

> **Nota de 11/10/2026:** o fluxo da casa passou a ser `docs/fluxo-paralelo.md`
> (sessões em worktree, PR por tarefa, CI, `/code-review`). Ele vale também
> nesta frente para o CÓDIGO (branch, PR, CI, revisão); o que segue abaixo
> continua valendo para o rito editorial (modelos por papel, gates da Vicky,
> loop de screenshot). O `~/dev/FLUXO-MULTIAGENTE.md` citado adiante só existe
> no Mac e é histórico.

> v2 — 30/07/2026. Consolida a v1 (decisão do dono na sessão de abertura; base: palestra
> "Common workflows" com Claude Code) com: modelos por papel (§3), exceção adversarial
> nomeada (§4), fluxo por milestone (§5) e checklist de sessão (§6). **Nesta frente, este
> fluxo SUBSTITUI o fluxo multiagente da casa** (`~/dev/FLUXO-MULTIAGENTE.md`): sem Sol
> como implementador, sem subagentes, sem rodadas adversariais como rito. O que NÃO muda:
> as Leis do projeto (CLAUDE.md) — regra de negócio no banco, migrations imutáveis, RLS,
> auditoria — e o portão humano fechando cada etapa.
> Plano vivo do ciclo: `docs/goals/conteudo-ciclo1.md` (v3 aprovada em 30/07).

## 1. A referência (slide "Common workflows")

1. **Explore → plan → confirm → code → commit** — confirmar ANTES de escrever código.
2. **Write tests → commit → code → iterate → commit** — testes primeiro quando o domínio permite.
3. **Write code → screenshot → iterate** — trabalho visual itera contra feedback próprio.

Tese central: **dar ao agente um meio de VER o próprio resultado** (teste, screenshot,
corrida real). É referência de workflow, não receita literal.

## 2. Regras do dono (valem em toda sessão da frente)

1. **Planejar em rodadas de Q&A antes de codar.** Nada de codar a partir de intenção vaga.
2. **Confirmação antes de código — com mecanismo, não memória (reforçada na v2):** toda
   sessão de milestone **abre em plan mode** (shift+tab) e só cicla para execução após o
   OK do dono no recorte (arquivos a criar/alterar). **Auto mode nunca atravessa portão
   humano:** ao chegar num gate (dono ou Vicky), o agente PARA, apresenta o estado e
   espera — nunca marca o milestone como fechado por conta própria.
3. **Verificação com feedback próprio em todo milestone:**
   - Lógica → Vitest contra o Supabase local (guards de banco testados de verdade).
   - UI → loop de screenshot: `scripts/export-screens-local.mjs` (desktop 1440×900 +
     celular 390×844) → crítica contra `Design.md` + régua do `AGENTS.md` → corrigir →
     repetir até passar → só então mostrar ao dono.
   - Real → uma corrida de verdade onde importa (geração real, corrida de pesquisa,
     ciclo ponta a ponta).
4. **Portão humano fecha cada milestone.** Gate editorial = Vicky.
5. **Commit fecha o milestone, com o goal atualizado.**
6. **Criatividade sem violar Lei:** mudança no motor do site é permitida com ANÁLISE
   prévia apresentada ao dono (nunca mudança silenciosa); conflito com Lei do CLAUDE.md
   → parar e perguntar.
7. **(nova) Guards antes de migration:** os testes de invariantes (`pauta-fabrica.test.ts`
   partes 1 e 2) são escritos, commitados e vistos FALHAR antes de aplicar a migration
   correspondente. Migration imutável (Lei) é onde o workflow 2 mais paga.
8. **(nova) Nenhum modelo é juiz editorial de roteiro.** A calibração do M2 é julgada
   pela Vicky, às cegas (protocolo do plano v3). LLM apenas mecaniza o cegamento:
   embaralhar ordem, remover rótulos de braço.

## 3. Modelos por papel (novo na v2)

**Princípio: a atribuição segue a reversibilidade do artefato, não o milestone.**
Artefato irreversível ou sem feedback mecânico → modelo de cima. Artefato coberto por
teste ou loop → modelo de volume.

| Papel | Modelo | Usado para |
|---|---|---|
| Decisão e arquitetura | **Fable 5** | recorte+plano de cada milestone (regra 2); design do refactor de `handle.ts`; **autoria** da migration `content_research` (supersessão + nota transacional); texto do ADR-031; prompt de análise do spike M2.0; toda ANÁLISE da regra 6 |
| Motorista padrão | **Opus 5** | implementação do dia a dia: `generate.ts`, worker, actions, rotas, testes, parser; última crítica visual antes de mostrar ao dono |
| Loops de volume | **Sonnet 5** | voltas do loop de screenshot (M3/M4), seed e bancada |
| Barato (runtime, condicional) | **Haiku 4.5** | passo de formatação do braço (b) da calibração — só se (b) vencer |
| Adversário externo | **Sol 5.6 (Codex)** | sessões avulsas de ataque (§4). Outra família = outros pontos cegos |
| Runtime de produção | **`claude-sonnet-5`** | pinado no plano (`content-reel-script`, `content-idea-batch`) — não mexer |

Decisões e regras práticas:

- **Sonnet 5 substitui o 4.6 nos loops** (decisão de 30/07): upgrade drop-in do 4.6, em
  preço introdutório (US$2/US$10 por MTok) até 31/08/2026, depois iguala a classe
  (US$3/US$15). Não há argumento de custo a favor do 4.6, que fica só como fallback se
  aparecer regressão específica.
- **Opus 5 (lançado 24/07/2026) é o motorista** — mesmo custo do 4.8, salto em coding.
  Se a cota do Fable apertar, Opus 5 é substituto aceitável nos pontos de decisão,
  EXCETO nos artefatos irreversíveis (migrations, ADR), que seguem com Fable.
- Trocar de modelo **dentro da sessão** com `/model` (o contexto permanece). Começar a
  sessão no modelo do papel dominante do milestone.
- Tokens de dev NÃO saem do teto de US$5–25/mês do plano (aquele é runtime + Apify).
  O recurso escasso é a atenção do dono: economizar nas voltas de loop, nunca nos
  pontos de decisão.

## 4. Exceção nomeada — adversário pontual (não é rito; novo na v2)

A v1 aboliu rodadas adversariais **como rito**; não aboliu a ferramenta. Onde **não há
feedback mecânico E o erro é irreversível**, roda-se UMA sessão avulsa de ataque no
Sol 5.6:

| Artefato | Quando | Por quê |
|---|---|---|
| Migration `content_research` + invariantes | M5, ANTES do apply | migration não se conserta depois (Lei) |
| ADR-031 (política de dados de terceiros) | antes do aceite do dono no gate do M5 | política não tem teste |
| Diff final de `generate.ts` + rota do token | M2 (opcional) | superfície de segurança |

Formato: colar artefato + invariantes + "ataque isto". Achados voltam para a sessão
Claude corrigir; o dono arbitra divergências. Sem orquestração, sem subagente, sem
cadeia automática. Papel invertido em relação ao fluxo antigo: Claude implementa
(domina contexto, Leis e harness da casa), Sol ataca — cada um onde sua independência
vale mais.

## 5. Fluxo por milestone

**M1 — Voz da Marca** · workflow 1 · Opus 5
plan mode → recorte → OK → revisão leve + do/don't de REEL → `brand/voice/voz-v1.md` →
publicar `?painel=voz` → **PARAR no gate**. Gate: v1 ativa + OK da Vicky (o agente não
fecha sozinho). Commit.

**M2.0 — Spike de pauta** · workflow 1 · Fable no prompt de análise, Opus no script
Script descartável: YouTube-only, 2–3 criadores fixos em código, relatórios md locais.
Saídas: relatórios + as 10 ideias da calibração + schema real do M5. Gate: relatórios
legíveis, OK do dono. Fallback do plano: 10 ideias manuais.

**M2 — Gerador** · workflows 1+2 · Fable decide, Opus implementa
Fable: recorte, design do refactor de `handle.ts`, ADR-031 (com política de dados de
terceiros). Opus, nesta ordem: `tests/conteudo-gerador.test.ts` PRIMEIRO
(claim/erro/retry/sem-voz/idempotência/reset-no-reject) → refactor dos miolos →
`generate.ts` (validação estrita) → action + rota + Scheduled Task → prompt
`content-reel-script`. Calibração: protocolo fechado do plano (n=10, pareado, cego,
rubrica 1–5, Vicky julga — regra 8); Haiku 4.5 candidato ao passo de formatação do
braço (b). Sol opcional no diff final. Gate: testes verdes · 401 sem token · braço
vencedor com maioria ≥4.

**M3 — UI do reel** · workflows 2+3 · Opus constrói, Sonnet 5 itera
Opus: parser em DOIS MODOS (testes dos dois modos primeiro) + página de detalhe.
Sonnet 5: voltas do loop de screenshot; **última crítica antes do dono = Opus**.
Gate: loop aprovado (desktop+celular) contra AGENTS.md/Design.md.

**M4 — Criadores** · workflows 2+3 · Opus autora, Fable revisa migration, Sonnet 5 itera tela
`pauta-fabrica.test.ts` parte 1 ANTES da migration `content_creators` (regra 7). Opus
autora a migration; Fable revisa o texto ANTES do apply (barato; artefato irreversível).
Tela via loop (Sonnet 5). Gate: CRUD + screenshot + testes verdes.

**M5 — Research + worker** · workflow 2 integral · Fable autora, Sol ataca, Opus implementa
Parte 2 dos guards ANTES da migration. Fable autora a migration (supersessão,
`unique(source_key, run)`, nota transacional obrigatória). Sol ataca migration +
ADR-031 antes do apply (§4). Opus: worker + `src/lib/research/*` (largada
Reddit+YouTube, filtro por código pré-LLM). Gate: corrida real · `--force` cria run 2 e
supera o 1 · aceite ToS/retenção por escrito.

**M6 — Ideias + métricas** · workflow 1 · Opus
Prompt `content-idea-batch` + subcomando `ideias`. Gate ponta a ponta + 2 semanas de
métricas com regra pré-comprometida (defaults ajustáveis NO gate, nunca depois dos
números).

## 6. Checklist de sessão (colar no início de cada milestone)

1. Abrir em **plan mode**, no modelo do papel dominante.
2. Pedir o recorte (arquivos a criar/alterar). Aguardar OK do dono.
3. Ciclar para execução. Trocar com `/model` quando o papel mudar.
4. Guards/testes antes de qualquer artefato irreversível (regra 7).
5. Rodar o loop de feedback do milestone (Vitest / screenshot / corrida real).
6. **PARAR em todo portão humano.** Nunca fechar milestone sem o gate.
7. Gate fechado → atualizar `docs/goals/conteudo-ciclo1.md` → commit.

## 7. Onde está cada coisa

- Plano vivo: `docs/goals/conteudo-ciclo1.md` (v3 — manter sincronizado; o cabeçalho da
  v3 manda).
- Este fluxo: `docs/fluxo-frente-conteudo.md` (referenciado no CLAUDE.md).
- Insumo de pesquisa: `_rascunhos/transcricoes-youtube/` (6 transcrições analisadas).
- Voz canônica: `brand/voice/voz-v1.md` (fonte em execução = `brand_voice_docs` ativa,
  publicada pelo Estúdio).
- Harness de screenshot: `scripts/export-screens-local.mjs` + contas de bancada
  (`scripts/preview-logins.ts`, rota `/dev-entrar`).
- Fluxo multiagente da casa (suspenso nesta frente): `~/dev/FLUXO-MULTIAGENTE.md`.
