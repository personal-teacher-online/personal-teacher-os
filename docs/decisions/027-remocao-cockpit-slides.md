# ADR-027 — A Fábrica de Slides sai do site; o motor fica

Data: 26/07/2026 · Status: aceito (decidido pelo mantenedor em sessão, 26/07)

## Contexto

A Fábrica de Slides ganhou uma tela em julho/2026 (`/admin/slides` — grade, editor da aula,
rascunho por IA, curadoria de vídeo, painéis de foto; FS-M0–M4 em produção 21/07, runbook §P, e a
tela do IM-2 em 23/07, runbook §R). A tela existia para responder uma pergunta em aberto: **dá para
produzir uma aula inteira pelo sistema, e a dona consegue tocar isso sozinha?**

A pergunta foi respondida, e o uso real andou para o outro lado:

- **O ciclo foi validado ponta a ponta** — 1ª aula completa pela fábrica em 21/07 (rascunho por IA →
  revisão → vídeo aprovado por thumbnail → trecho/gabarito → deck de 24 slides no Drive).
- **A produção amadureceu para linha de comando.** O curso v2 completo — 65 aulas — foi produzido em
  26/07 pelo caminho de terminal (`scripts/slides/`, `npm run slides:render`) com a skill
  `slides-de-aula` conduzindo escrita, direção fotográfica e QA visual. A tela nunca foi o caminho
  do volume: ela edita uma aula por vez, e quem escreve o curso trabalha em lote.
- **A entrega final não vive no app.** O deck acabado mora no Drive compartilhado da dona, que é
  onde ela abre para dar aula. O app era intermediário, não destino.
- **A dona não vai usar a tela.** Quem opera a fábrica é o mantenedor, no terminal.

Manter a tela custa: são ~2.500 linhas de UI e server actions que continuam entrando em toda
varredura de segurança, de design e de dependência, e que reimplementam — em outra linguagem de
interface — o que a CLI já faz melhor. Manter também **engana**: um cockpit no trilho do admin
promete um fluxo que ninguém percorre.

O motivo desta ADR existir é o oposto do óbvio. Removida a tela, o motor (`src/lib/slides/**`,
`src/lib/images/**`) e duas migrations aplicadas em produção ficam **sem nenhum ponto de entrada
pelo site**. Sem registro, daqui a três meses alguém abre o repositório, vê motor sem interface e
tabela sem tela, conclui "código morto" e apaga o que produz o curso.

## Decisão

**A tela sai; o motor fica.**

Removido: `src/app/admin/slides/**` inteiro (grade, página da aula, `SlideEditor`, `ImagePanel`,
`VocabImagePanel`, `actions.ts`, `status.ts` e a rota `image/[fileId]` que transmitia bytes do
Drive), o item "Slides" do trilho do admin (`src/components/AdminNav.tsx`) e o
`outputFileTracingIncludes` de `brand/slides/**` no `next.config.ts`, que existia só porque a tela
lia os assets da marca do disco em runtime.

**Preservado, e é onde a produção vive hoje:**

- `src/lib/slides/**` e `src/lib/images/**` — o motor (schema da aula, layout que mede antes de
  desenhar, renderer, resolvedor de imagem).
- `scripts/slides/` e `scripts/images/` + os `npm run slides:*` — a CLI, que é o caminho oficial.
- `.claude/skills/slides-de-aula/` — a skill que conduz a produção.
- `content/`, `brand/slides/` — as aulas e a biblioteca fotográfica.
- **As migrations `20260721000100` e `20260722000100` ficam DORMENTES** (Lei 7: migration aplicada é
  imutável). Nada é dropado. As tabelas `lessons`/`slide_images` e suas RPCs seguem em produção,
  com RLS, sem tela que as chame. Isso é deliberado: são o registro do que foi produzido e o ponto
  de partida se a tela voltar.
- **Nenhum toque em banco**, local ou de produção, nesta mudança.

**Os prompts `slides-*` da tabela `ai_prompts` serão DESATIVADOS no próximo deploy** — desativados,
nunca apagados (Lei 8: trilha de auditoria). Eles serviam ao "✨ Rascunhar com IA" da tela; a CLI
usa os seus próprios. Fica aqui porque é o único resíduo que exige uma ação futura, e não foi feito
agora: mexer em prompt de produção pede janela de deploy, não uma remoção de código.

## Consequências

- **Gerar deck volta a ser tarefa de terminal**, não de site: `npm run slides:render` com a skill
  `slides-de-aula`. Quem quiser um deck e não tiver o repositório na mão não consegue — e isso é
  aceito, porque hoje só o mantenedor produz.
- **Reintroduzir UI de slides exige decisão nova** (ADR que supersede esta), não um "só voltar o
  arquivo". Se voltar, o `outputFileTracingIncludes` de `brand/slides/**` volta junto, ou o deck sai
  sem fundo, sem fio e sem foto em produção — a pegadinha já custou um deploy uma vez.
- **O motor sem interface NÃO é código morto.** Esta ADR é a resposta a quem encontrar
  `src/lib/slides/**`, `src/lib/images/**` ou as tabelas dormentes e achar que sobrou lixo.
- O invariante do despacho de contrato por curso (item 22, `tests/slides-schema.test.ts`) perdeu
  dois pontos de entrada — os dois da tela, porque os arquivos deixaram de existir. Ele segue
  valendo inteiro para os que sobraram (`draft.ts`, `render-lesson.ts`, `build.ts`), que hoje são
  **todos** os pontos que escrevem ou validam aula.
- ADRs 020, 022, 023, 024 e 026 continuam válidos naquilo que descrevem do **motor** (contrato da
  aula, curadoria de vídeo, provedor de imagem, generalização, texto em foto de aula). O que elas
  descrevem de **tela** passa a ser histórico.
