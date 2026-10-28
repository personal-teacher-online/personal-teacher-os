// M-Slides-1 — contrato do conteúdo de uma aula do Personal Travel.
// O JSON validado aqui é o ÚNICO insumo do renderer (render-lesson.ts):
// IA/Claude rascunha este documento, a Teacher Vicky revisa o deck gerado no Slides.
// Campos "rich" aceitam marcadores inline: **negrito**, {{roxo-marca}},
// [[teal]], __sublinhado__ (parser em template.ts).
// Gabaritos NUNCA viram texto visível — vão para as speaker notes.
import { z } from 'zod'
import { ANCHOR_RE } from './anchors.ts'

const rich = z.string().min(1)

/**
 * LIMITES DE COMPRIMENTO DO **v2** (spec §7-ter.3, achado 16; escopo reduzido na
 * Fase 0d, item 19).
 *
 * ⚠️ Estes tetos valem SÓ para o caminho `personal-travel-v2`
 * (`LessonSchemaV2`). O `LessonSchema` do v1 continua SEM teto, como sempre
 * esteve: o conteúdo vivo das aulas M6–M12 está no banco de produção, fora do
 * alcance da medição feita aqui, e um campo acima do teto pararia de validar no
 * editor da Teacher Vicky — quebra de produção causada por uma rodada de conserto do
 * v2. Os fixtures MAX dos testes continuam nascendo daqui: eles descrevem o
 * contrato do v2, que é o que sempre foram na prática.
 *
 * Até a Fase 0b nenhum campo de texto tinha teto: os "máximos" dos testes eram
 * ficção, e o Sol provou o buraco com um `warmup.prompt` de 8.000 caracteres (o
 * passo entre chips do writing virava 0,002") e um passo de missão de 1.000
 * (o cartaz terminava em 6,63" numa página de 5,625"). Sem teto no contrato,
 * "conteúdo máximo" não quer dizer nada e o desenho só tem duas saídas: forçar
 * a caber ou transbordar.
 *
 * A régua é a MEDIÇÃO do conteúdo real (as 5 aulas do M5, que é tudo o que
 * existe hoje) com folga larga — nada existente chega perto do teto:
 *
 * | campo                | real | teto | folga |
 * |----------------------|------|------|-------|
 * | tip.text             | 216  | 600  | 2,8×  |
 * | listening.answers    | 245  | 600  | 2,4×  |
 * | mission.briefing     |  91  | 400  | 4,4×  |
 * | warmup.prompt        |  77  | 400  | 5,2×  |
 * | mission.steps[]      |  71  | 400  | 5,6×  |
 * | listening.task       |  71  | 320  | 4,5×  |
 * | objectives.items[]   |  69  | 200  | 2,9×  |
 * | quiz.q               |  83  | 200  | 2,4×  |
 * | títulos              |  42  | 120  | 2,9×  |
 *
 * Campo de BLOCO (protagonista do slide, um por slide) recebe folga de ~5×;
 * campo de LISTA recebe a folga de uma linha (~3×), porque o slide divide a
 * mesma banda entre até 10 itens — o orçamento é o do conjunto, não o do item.
 * Os tetos de `grammar.rule` (240) e a contagem de itens de cada lista são
 * anteriores a esta rodada e continuam valendo.
 */
export const LEN = {
  /** título, manchete, nome de missão */
  title: 120,
  /** rótulo curto: termo do vocabulário, dica de drill, kicker */
  label: 80,
  /** item de lista / uma linha de fala */
  line: 200,
  /**
   * enunciado de UM item de writing (real: 47). Mais apertado que `line` porque
   * cada palavra do `unscramble` vira uma PASTILHA na linha: o orçamento do
   * campo é a faixa de chips, não a caixa de texto. 120 caracteres já são ~30
   * pastilhas, três linhas cheias.
   */
  prompt: 120,
  /** parágrafo de apoio: instrução, contexto, tarefa */
  para: 320,
  /** bloco protagonista do slide: prompt, passo, briefing */
  block: 400,
  /** o cartão da dica é o maior bloco de texto do deck */
  tip: 600,
  /** texto que vive nas speaker notes (não disputa área do slide) */
  notes: 600,
} as const

// M-F (ADR-024 §5): a fonte CANÔNICA dos níveis é o catálogo
// `curriculum_tracks.level` (11 níveis Flexge, semeados na migration
// 20260720000200). Esta constante é ESPELHO desse catálogo — quem lista as
// opções na UI lê do banco; aqui ela só serve de gramática do validador de
// conteúdo (ordem = progressão CEFR). Ampliar isto é permitido pelo ADR;
// inventar um conjunto novo, não.
export const FLEXGE_LEVELS = [
  'Pre A1',
  'A1',
  'A1+',
  'A2',
  'A2+',
  'B1',
  'B1+',
  'B2',
  'B2+',
  'C1',
  'C2',
] as const
export type FlexgeLevel = (typeof FLEXGE_LEVELS)[number]

// 'A0' NÃO é nível Flexge. É aceito SÓ na entrada legada (conteúdo antigo do
// Personal Travel, quando o enum era A0/A1/A2) e normalizado EM MEMÓRIA para
// 'Pre A1' via preprocess — nunca reescreve o conteúdo vivo no banco e nenhum
// conteúdo novo persiste 'A0' (o parse já devolve 'Pre A1').
export function normalizeFlexgeLevel(v: unknown): FlexgeLevel | undefined {
  const t = typeof v === 'string' ? v.trim() : ''
  const n = t === 'A0' ? 'Pre A1' : t
  return (FLEXGE_LEVELS as readonly string[]).includes(n) ? (n as FlexgeLevel) : undefined
}

// preprocess: só a entrada legada 'A0' vira 'Pre A1'; o resto passa cru para o
// enum decidir. Exportado para teste do rito de normalização (ADR-024 §5).
export const LevelSchema = z.preprocess(
  (v) => (v === 'A0' ? 'Pre A1' : v),
  z.enum(FLEXGE_LEVELS),
)

/**
 * FÁBRICA DOS DOIS CONTRATOS — v1 (produção) e v2 (curso paralelo).
 *
 * Os tetos de comprimento (`LEN`) nasceram na Fase 0c e valiam para TODO
 * documento. Isso era risco de PRODUÇÃO: o conteúdo vivo das aulas M6–M12 mora
 * no banco de produção e não dá para medir daqui — uma aula com um campo acima
 * do teto pararia de validar no editor da Teacher Vicky, quebrando o v1 por causa de
 * uma rodada de conserto do v2. Os tetos passam a valer SÓ no caminho v2
 * (`personal-travel-v2`), que é o que eles sempre descreveram na prática: o
 * contrato do template novo, medido contra os layouts novos.
 *
 * Por que uma fábrica e não `LessonSchema.extend({...})`: os tetos vivem DENTRO
 * de `SlideSchema` (união discriminada de 15 objetos), e `.extend()` só troca
 * campos de primeiro nível — reescrever `slides` no `extend` seria duplicar a
 * união inteira. A fábrica gera as duas versões da MESMA definição; os tipos
 * TypeScript saem idênticos (o `.max()` do zod não muda o tipo inferido), então
 * `LessonDoc`/`SlideSpec` continuam sendo um tipo só para os dois caminhos.
 */
function construirSchemas(limitar: boolean) {
  /** teto de string: só existe no v2 */
  const cap = (n: number) => (limitar ? z.string().max(n) : z.string())
  /** idem, para campo `rich` (marcadores inline) */
  const rico = (n: number) => (limitar ? rich.max(n) : rich)

  /**
   * MÓDULO MÍNIMO — `0` só existe no **v2**.
   *
   * O curso tem uma introdução, GET READY WITH ME!, que **não é módulo
   * numerado** (`docs/research/06` §1 e `climate.ts`, que já trata `0` e
   * `'get-ready'` como a mesma coisa, dentro da PARTE 1). O v2 precisa
   * escrevê-la, e `module.number` era o que rejeitava os cinco arquivos.
   *
   * ⚠️ O v1 continua em **1–12** — e não por conservadorismo: a tabela
   * `slide_lessons` do banco de produção tem `check (module between 1 and 12)`.
   * Um documento v1 com módulo 0 validaria aqui e quebraria no INSERT, que é
   * exatamente o tipo de mina que os tetos de comprimento já custaram uma
   * rodada de conserto (ver bloco de comentário do `LEN`).
   *
   * Vale para os dois lugares onde o número do módulo aparece no contrato:
   * `module.number` e o `number` do cartaz de `mission` (a missão do GET READY
   * é a missão 0 — numerá-la 1 colidiria com a missão do M1 na tela).
   */
  const moduloMin = limitar ? 0 : 1

  // imagem da biblioteca curada (brand/slides/library/<file>) — Lei 11: imagens
  // decorativas/fotográficas SEM texto gerado dentro; texto é sempre do Slides
  const libImage = z.strictObject({
    file: z.string(),
    caption: cap(LEN.label).optional(),
  })

  // trecho recomendado de um vídeo (mm:ss); a Teacher Vicky valida junto com a escolha
  // e configura início/fim no Slides (Formatar → Opções de vídeo)
  const videoExcerpt = z.strictObject({
    start: z.string(),
    end: z.string(),
    why: z.string().optional(),
  })

  const baseFields = {
    // roteiro/gabarito para as notas do apresentador
    notes: z.string().optional(),
    // estilos de Kolb que o slide cobre (prestação de contas pedagógica)
    kolb: z.array(z.enum(['concrete', 'reflective', 'abstract', 'active'])).optional(),
  }

  const slide = z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('cover'),
      title: cap(LEN.title).optional(), // default: lesson.title
      subtitle: cap(LEN.line).optional(),
      image: libImage.optional(), // foto emoldurada à direita da capa
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('objectives'),
      title: cap(LEN.title).optional(),
      items: z.array(rico(LEN.line)).min(2).max(5),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('warmup'),
      title: cap(LEN.title).optional(),
      prompt: rico(LEN.block),
      items: z.array(rico(LEN.line)).max(10).optional(),
      image: libImage.optional(), // com imagem, os itens ficam em 1 coluna
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('vocab'),
      title: cap(LEN.title),
      intro: rico(LEN.line).optional(),
      drillHint: cap(LEN.label).optional(), // default: "LISTEN & REPEAT"
      cards: z
        .array(
          z.strictObject({
            term: cap(LEN.label),
            cue: cap(LEN.label).optional(), // dica de pronúncia (sílaba forte)
            pt: cap(LEN.label),
            // foto da biblioteca no topo do card (associação palavra-imagem);
            // cards sem imagem convivem no mesmo grid
            image: z.string().optional(),
            // M-H2: identidade OPACA e estável do card (nunca derivada do texto do
            // termo). Persistida no conteúdo; sobrevive a reordenação/renome e
            // ancora o endereço da foto por termo (m{mod}/a{aula}-vocab-{anchorId}).
            // OPCIONAL: cards legados/sementes não têm — ganham um no 1º save
            // (ensureVocabAnchors). Formato TRAVADO em 8 hex: um id malformado no
            // conteúdo é rejeitado no parse (é saneado por ensureVocabAnchors no
            // save). Ver src/lib/slides/anchors.ts.
            anchorId: z.string().regex(ANCHOR_RE).optional(),
          })
        )
        .min(3)
        .max(8),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('grammar'),
      title: cap(LEN.title),
      // Limite de DESENHO (21/07): regra + tabela dividem a coluna esquerda;
      // regra longa espremia o cartão e o texto vazava (M6A2).
      rule: rich.max(240),
      examples: z.array(rico(LEN.line)).min(1).max(6),
      table: z
        .strictObject({
          headers: z.array(cap(LEN.label)).min(1).max(4),
          // Até 5 linhas: quem decide se cabe é a MEDIÇÃO (planGrammar mede a
          // quebra real das células e escolhe a fonte). O limite duro fica na
          // regra (rule ≤ 240), que é quem espremia o cartão (M6A2, 21/07).
          rows: z.array(z.array(cap(LEN.label))).min(1).max(5),
        })
        .optional(),
      watchOut: z
        .strictObject({ wrong: cap(LEN.label), right: cap(LEN.label) })
        .optional(),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('dialogue'),
      title: cap(LEN.title),
      context: cap(LEN.line).optional(),
      lines: z
        .array(z.strictObject({ speaker: cap(LEN.label), text: rico(LEN.line) }))
        .min(2)
        .max(8),
      glossary: z
        .array(z.strictObject({ term: cap(LEN.label), pt: cap(LEN.label) }))
        .max(6)
        .optional(),
      image: libImage.optional(), // usada na coluna direita quando NÃO há glossário
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('listening'),
      title: cap(LEN.title).optional(),
      task: rico(LEN.para),
      // null = Teacher Vicky escolhe o vídeo no Slides (curadoria humana; IA não inventa URL)
      videoUrl: z.url().nullable(),
      videoHint: cap(LEN.line).optional(),
      // trecho validado do vídeo escolhido — impresso no chip do link e nas notas
      excerpt: videoExcerpt.optional(),
      // correct: true marca o gabarito → gera o slide de ANSWERS automaticamente
      items: z
        .array(z.strictObject({ text: rico(LEN.line), correct: z.boolean().optional() }))
        .max(8)
        .optional(),
      // vai para as speaker notes, não para o slide
      answers: cap(LEN.notes).optional(),
      // candidatos achados por find-videos.ts (ADR-022) — a Teacher Vicky escolhe um,
      // que vira videoUrl; não são renderizados no slide
      candidates: z
        .array(
          z.strictObject({
            videoId: z.string(),
            title: z.string(),
            channel: z.string(),
            publishedAt: z.string().optional(),
            views: z.number().optional(),
            excerpt: videoExcerpt.optional(),
          })
        )
        .max(5)
        .optional(),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('speaking'),
      title: cap(LEN.title).optional(),
      instruction: rico(LEN.para),
      phrases: z.array(rico(LEN.line)).min(2).max(6),
      hint: cap(LEN.line).optional(),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('writing'),
      title: cap(LEN.title).optional(),
      instruction: rico(LEN.para),
      exercises: z
        .array(
          z.strictObject({
            kind: z.enum(['complete', 'unscramble', 'create']),
            items: z
              .array(
                z.strictObject({
                  prompt: rico(LEN.prompt),
                  answer: cap(LEN.line).optional(),
                }),
              )
              .min(1)
              .max(5),
          })
        )
        .min(1)
        .max(2)
        // Limite de DESENHO (21/07): o slide comporta 6 itens somando os
        // exercícios; acima disso o bloco caía fora da borda (M6A2).
        .refine((exs) => exs.reduce((n, e) => n + e.items.length, 0) <= 6, {
          message: 'writing: no máximo 6 itens somando os exercícios (limite do slide)',
        }),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('quiz'),
      title: cap(LEN.title).optional(),
      intro: rico(LEN.line).optional(),
      questions: z
        .array(z.strictObject({ q: rico(LEN.line), answer: cap(LEN.line).optional() }))
        .min(2)
        .max(6),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('tip'),
      title: cap(LEN.title).optional(),
      text: rico(LEN.tip),
      image: libImage.optional(), // foto emoldurada à direita do cartão
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('section'),
      title: cap(LEN.title),
      kicker: cap(LEN.label).optional(), // default: "PRACTICE TIME"
      subtitle: cap(LEN.line).optional(),
      image: libImage.optional(), // foto emoldurada à direita (texto alinha à esquerda)
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('mission'),
      number: z.number().int().min(moduloMin).max(12),
      title: cap(LEN.title),
      briefing: rico(LEN.block),
      steps: z.array(rico(LEN.block)).max(6).optional(),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('recap'),
      title: cap(LEN.title).optional(),
      items: z.array(rico(LEN.line)).min(2).max(8),
      ...baseFields,
    }),
    z.strictObject({
      type: z.literal('closing'),
      headline: cap(LEN.title).optional(), // default: "Congratulations!"
      message: rico(LEN.para).optional(),
      nextClass: cap(LEN.line).optional(),
      ...baseFields,
    }),
  ])

  // Base SEM refinamento — é o que vira JSON Schema de referência da IA (Zod
  // toJSONSchema não representa refines; e a IA não vê anchorId de qualquer forma,
  // stripOperationalFields o remove).
  const base = z.strictObject({
    course: z.literal('personal-travel'),
    module: z.strictObject({
      number: z.number().int().min(moduloMin).max(12),
      title: cap(LEN.title),
    }),
    lesson: z.strictObject({
      number: z.number().int().min(1).max(9),
      title: cap(LEN.title),
      subtitle: cap(LEN.line).optional(),
    }),
    // 11 níveis do catálogo Flexge (ADR-024 §5); 'A0' legado é aceito e
    // normalizado para 'Pre A1' em memória pelo LevelSchema.
    level: LevelSchema,
    grammarFocus: z.array(z.string()).min(1),
    slides: z.array(slide).min(5).max(24),
  })

  // M-H2 (item 1): os anchorId PRESENTES no documento têm de ser ÚNICOS. Um
  // conteúdo legado com âncoras duplicadas é INVÁLIDO para aprovar — força um save
  // (ensureVocabAnchors saneia) antes de a foto por termo chegar à RPC. Ausentes
  // não contam (cards legados sem âncora convivem).
  const full = base.superRefine((doc, ctx) => {
    const vistos = new Set<string>()
    doc.slides.forEach((s, si) => {
      if (s.type !== 'vocab') return
      s.cards.forEach((c, ci) => {
        if (!c.anchorId) return
        if (vistos.has(c.anchorId)) {
          ctx.addIssue({
            code: 'custom',
            message: `anchorId duplicado no documento: ${c.anchorId}`,
            path: ['slides', si, 'cards', ci, 'anchorId'],
          })
        }
        vistos.add(c.anchorId)
      })
    })
  })

  return { slide, base, full }
}

const V1 = construirSchemas(false)
const V2 = construirSchemas(true)

// ------------------------------------------------------------------ contrato v1
// É o que estava no HEAD antes da Fase 0c: SEM teto de comprimento. Vale para o
// curso `personal-travel` em produção — editor da Teacher Vicky, rascunho por IA, CLI.
export const SlideSchema = V1.slide
// Base SEM refinamento — é o que vira JSON Schema de referência da IA (Zod
// toJSONSchema não representa refines; e a IA não vê anchorId de qualquer forma,
// stripOperationalFields o remove).
export const LessonSchemaBase = V1.base
export const LessonSchema = V1.full

// ------------------------------------------------------------------ contrato v2
// MESMO documento, com os tetos de `LEN`. Só é aplicado onde o curso é
// `personal-travel-v2` (ver `isV2` em build.ts): é ali que os fixtures MAX dos
// testes descrevem o pior conteúdo LEGAL, e é ali que o desenho promete caber.
export const SlideSchemaV2 = V2.slide
export const LessonSchemaBaseV2 = V2.base
export const LessonSchemaV2 = V2.full

/**
 * O curso paralelo do template v2 — e qualquer sufixo dele. Mora AQUI (e não em
 * `build.ts`, de onde `isV2` a reexporta) porque quem precisa dela sem arrastar
 * o pptxgenjs junto é o ponto de VALIDAÇÃO: o server action escolhe o contrato
 * antes de importar o renderer.
 */
export const COURSE_V2_PREFIX = 'personal-travel-v2'

/**
 * Contrato do documento a partir do curso da aula (v2 tem tetos, v1 não).
 *
 * ⚠️ TODO ponto de entrada que valida conteúdo tem de passar por aqui (spec
 * §7-quater, item 22). Até a Fase 0e só a CLI e a geração do deck despachavam;
 * o save do JSON, a aprovação, o save por seção, o editor e o rascunho por IA
 * usavam o schema v1 direto. Consequência concreta: uma aula
 * `personal-travel-v2` com `tip.text` de 5.000 caracteres podia ser salva,
 * anunciada como VÁLIDA e APROVADA — e só quebrava na hora de gerar o deck. A
 * UI hoje só cria v1, mas a RPC aceita qualquer curso: a mina explodiria
 * exatamente quando o v2 entrasse em uso.
 */
export function lessonSchemaFor(course: string | null | undefined) {
  return (course ?? '').startsWith(COURSE_V2_PREFIX) ? LessonSchemaV2 : LessonSchema
}

/**
 * Idem para a BASE (sem o refine de unicidade de âncora) — é ela que vira o
 * JSON Schema de referência do rascunho por IA. Sem este despacho a IA
 * receberia o contrato SEM tetos e escreveria um documento que o parse do
 * mesmo rascunho recusaria: o trabalho todo viraria `draft_error`.
 */
export function lessonSchemaBaseFor(course: string | null | undefined) {
  return (course ?? '').startsWith(COURSE_V2_PREFIX) ? LessonSchemaBaseV2 : LessonSchemaBase
}

export type LessonDoc = z.infer<typeof LessonSchema>
export type SlideSpec = z.infer<typeof SlideSchema>
