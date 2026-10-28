# ADR-020 — Fábrica de slides do Personal Travel (trilho local agora, app na Fase 4)

Data: 20/07/2026 · Status: aceito (decisões do mantenedor em sessão, 20/07)

## Contexto

A dona precisa produzir/regravar os vídeos do curso Personal Travel (Hotmart):
julho = gravar módulos 5–7 e regravar 2–4; agosto = 8–12 (~55 decks no total,
~4 aulas + 1 Mission por módulo). Os decks atuais (Google Slides manuais) não
têm template nem identidade consistente e a dona pediu redesign ("não estou
satisfeita com eles"). O blueprint (docs/research/01 §7 e 02) e o CLAUDE.md já
fixam o padrão de Slides para a Fase 4: template + `files.copy` + `batchUpdate`
via service account — mas o gate CHAVES (service account/envs Google) está
pendente e o prazo é julho.

## Decisão

1. **Trilho A (agora):** a fábrica de slides vive no repo — `scripts/slides/`
   gera `.pptx` localmente com **PptxGenJS** a partir de um JSON de aula
   validado por schema (`lesson-schema.ts`). O upload é manual (arrastar para
   o Drive; conversão para Google Slides automática). **Claude Code é o motor
   de conteúdo** neste trilho (rascunha o JSON; a dona revisa no Slides) —
   sem dependência de `ANTHROPIC_API_KEY`/service account em produção.
2. **Trilho B (Fase 4):** o mesmo template/design-system e o prompt de aula
   migram para o app (botão no `/admin`; `files.copy`+`batchUpdate`, motor
   M13/M14). Nada do trilho A é descartado; o JSON de aula é o contrato comum.
3. **Visual híbrido ratificado:** capa/divisórias/fechamento no tema noturno
   das páginas públicas (fog periwinkle/ciano, acentos roxo/turquesa) e slides
   de conteúdo em Papel & Tinta (Design.md). Fontes da marca (Bricolage
   Grotesque/Hanken Grotesk — Google Fonts, disponíveis no Slides).
4. **Facecam:** todo slide de conteúdo reserva a zona da câmera da dona
   (canto superior esquerdo, mesma posição dos decks antigos) — requisito dela.
5. **Conteúdo:** IA rascunha a aula completa (4 habilidades + marcação Kolb +
   gabarito nas speaker notes); **vídeos de listening são curadoria humana**
   (a IA nunca inventa URL — deixa placeholder com instrução).
6. **Assets determinísticos:** fundos de fog e fio-gradiente gerados por
   script puro (`build-assets.ts`, PNG sem deps) — reproduzíveis; imagens
   ilustrativas seguem a Lei 11 e o doc 03 §6 (biblioteca curada, sem texto
   dentro de imagem de IA) quando entrarem.

## Consequências

- Julho fica viável: template + piloto prontos sem deploy nem gates externos.
- O deck final nasce como `.pptx` convertido — o "template primário" do Drive
  (quando M13 ligar) será a cópia oficial gerada por `slides:template`; a
  regra "nunca tocar o template primário" segue valendo na Fase 4.
- `content/personal-travel/` versiona o conteúdo pedagógico por aula (novo
  diretório de topo, fora de `src/`).
- `tsconfig.json` ganhou `allowImportingTsExtensions` (scripts rodam com
  `node` direto; `noEmit` já era o caso — sem efeito no build do app).

## Adendo (21/07/2026) — rascunho da aula NÃO usa Structured Outputs

Medido contra a API real (probes de dentro do container de produção, com a
chave de lá — nenhum segredo saiu do servidor):

1. `output_config.format.json_schema` **rejeita** o LessonDoc. Três limites
   duros, nessa ordem: (a) restrições numéricas/de tamanho não são aceitas
   (`minimum`, `maximum`, `minLength`, `maxLength`, `maxItems`; `minItems` só
   0 ou 1); (b) **máx. 24 campos opcionais** — o contrato tem 81; (c) **máx.
   16 campos com união/nullable** — tornar tudo obrigatório+nullable (saída
   canônica) levou a 82. Contrato com 15 tipos de slide não cabe.
2. **Decisão:** o rascunho da aula usa JSON guiado — o schema sanitizado vai
   como REFERÊNCIA no system (`draftSystemPrompt`) e a garantia fica onde
   sempre esteve: `LessonSchema` (zod) no servidor, antes de gravar
   (`normalizeLessonDraft` + parse + identidade vinda do banco). Structured
   Outputs CONTINUA no trecho/gabarito (`slides-excerpt-suggest`, schema
   pequeno — probe 200 em 10s).
3. Achados colaterais corrigidos em `src/lib/ai/claude.ts` (valiam para TODAS
   as rotinas de IA): `temperature` é descontinuada na família 5 (400) — só é
   enviada para modelos 4.x; e a resposta traz um bloco `thinking` ANTES do
   texto — ler o primeiro bloco `type === 'text'`, nunca `content[0]`.
4. Custo/tempo medidos: aula completa ≈ 56–66s e ~5,6k tokens de saída
   (15 specs → 26 slides). Fica sob o teto de 100s do Cloudflare, mas é o
   número a vigiar: se aulas maiores estourarem, mover para job em background.
