// Template v2 dos decks do Personal Travel — Fase 0a (spec docs/goals/spec-template-v2.md).
//
// Vive AO LADO do v1 (`template.ts`), nunca em cima: o v1 está em produção
// servindo o botão "Gerar deck" da Teacher Vicky. O despacho é por curso (`build.ts`):
// prefixo `personal-travel-v2` → aqui; qualquer outro → v1 intacto.
//
// O que muda em relação ao v1:
//  1. FACECAM AMPLIADA e à DIREITA — 2.8"×1.575" (28% da largura, 16:9), lado
//     decidido pelo dono em 24/07 (Polat 2023: a direita é a posição mais
//     eficaz). TODA a geometria deriva de `FACECAM_SIDE`/`FACECAM_V2`: virar o
//     lado é trocar UMA constante, e o cabeçalho, as colunas de foto e as
//     colunas de exercício acompanham.
//  2. SISTEMA DE VARIANTES — "esqueleto fixo, pele variada". A variante é
//     REARRANJO dos mesmos elementos, NUNCA acréscimo de decoração
//     (`docs/research/05` §4.2: o dano de detalhe decorativo é linear na
//     quantidade). Nesta fase, variantes múltiplas só nos tipos que carregam
//     foto; os outros nascem com uma.
//  3. CLIMA POR PARTE — o fundo noturno do deck vem da PARTE do curso
//     (`climate.ts`). Fog é FUNDO, não sinal: a gramática de cor (roxo =
//     marca/ação, teal = positivo, âmbar = tip, danger = erro) é a mesma em
//     todas as 55 aulas.
//
// O que NÃO muda (âncoras — é o que faz parecer o mesmo curso): vocabulário de
// rótulos (as strings de eyebrow/label são as MESMAS do v1), tipografia,
// gramática de cor, fio-assinatura, posição do número da aula, banda do corpo
// (BODY_Y..BODY_BOTTOM), gabaritos progressivos e speaker notes.
//
// INVARIANTE DURA: nada passa de BODY_BOTTOM. Todo layout que cresce com o
// conteúdo MEDE antes de desenhar, com o motor de `layout.ts`.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LessonDoc, SlideSpec } from './lesson-schema.ts'
import {
  BODY_BOTTOM,
  BODY_Y,
  DIALOGUE,
  HEAD_EYEBROW_Y,
  HEAD_TITLE_Y,
  WRITING_MINS_V2,
  centrarPassos,
  charsPerLine,
  fillRows,
  fitFont,
  planBriefing,
  planDialogue,
  planCheckItems,
  planCheckRow,
  planChips,
  planClosing,
  planGrammar,
  planHead as planHeadIn,
  planListening,
  planNightBlock,
  planObjectives,
  planQuiz,
  planRecap,
  planScrimRamp,
  planSteps,
  planTitle,
  planVocabCard,
  planVocabGrid,
  planWarmup,
  planWriting,
  speakerLanes,
  vocabCols,
  wrapLines,
  type DialoguePlan,
  type HeadPlan,
  type NightBlockPlan,
  type StepsPlan,
} from './layout.ts'
import {
  ASSETS,
  FONT,
  KIND_LABEL,
  LOGO_WHITE,
  SYMBOL_BLACK,
  T,
  WORDMARK_RATIO,
  answerBox,
  caminhoDaImagem,
  cardShadow,
  checkChip,
  coverImage,
  framedImage,
  numChip,
  plain,
  revealCount,
  runs,
  setNotes,
  type AncoraFoto,
  type Pres,
  type Slide,
} from './template.ts'
import { climateFor } from './climate.ts'

// ------------------------------------------------------------------ geometria
const PAGE_W = 10
const PAGE_H = 5.625
const MX = 0.42
const CONTENT_W = PAGE_W - 2 * MX
const COL_GAP = 0.24

/**
 * Facecam do v2: 28% da largura, 16:9 (proporção da gravação 1080p).
 *
 * `m` é a margem superior (e lateral) da câmera. Ela SUBIU de 0.38" para 0.26"
 * na Fase 0c (spec §7-ter.2, ajuste 11): com 0.38 a borda de baixo caía em
 * 1.955" e o corpo começa em 1.98" — 0.025" de folga, que na projeção é a
 * câmera ENCOSTADA nos cards. Agora a folga é 0.145" (≈ 6× maior) e continua
 * sendo âncora fixa do curso inteiro: quem muda, muda esta linha e só.
 */
export const FACECAM_V2 = { w: 2.8, h: 1.575, m: 0.26 } as const
export type FacecamSide = 'left' | 'right'

/**
 * LADO DA FACECAM — parâmetro único do template (spec §3.1).
 * Decidido pelo dono em 24/07: DIREITA. É âncora do curso inteiro, nunca
 * variante. Nada mais no arquivo escreve 6.82 / 0.38 / 3.46 na mão: quem quiser
 * ver o outro lado troca esta linha e re-renderiza.
 */
export const FACECAM_SIDE: FacecamSide = 'right'

const HEAD_GAP = 0.28

// As três funções abaixo são a ÚNICA fonte da geometria dependente do lado.
// São funções (e não expressões inline) porque o TypeScript estreita um `const`
// de união para o literal declarado: com `FACECAM_SIDE === 'left'` escrito
// direto, o compilador reclamaria de comparação impossível e — pior — o código
// do outro lado passaria a ser "morto" aos olhos de quem lê. Dentro de uma
// função com parâmetro `FacecamSide`, os dois lados seguem vivos e virar o lado
// continua sendo trocar UMA linha.
function otherSide(side: FacecamSide): FacecamSide {
  return side === 'left' ? 'right' : 'left'
}

function facecamBox(side: FacecamSide): { x: number; y: number; w: number; h: number } {
  return {
    x: side === 'left' ? FACECAM_V2.m : PAGE_W - FACECAM_V2.m - FACECAM_V2.w,
    y: FACECAM_V2.m,
    w: FACECAM_V2.w,
    h: FACECAM_V2.h,
  }
}

/** faixa do cabeçalho: começa no lado oposto à câmera e termina antes dela */
function headBand(side: FacecamSide, cam: { x: number; w: number }): Box {
  const x = side === 'left' ? cam.x + cam.w + HEAD_GAP : MX
  const w = (side === 'left' ? PAGE_W - MX : cam.x - HEAD_GAP) - x
  return { x, w }
}

/** contra-lado da facecam — onde vai a foto quando a variante pede foto lateral */
export const FAR_SIDE: FacecamSide = otherSide(FACECAM_SIDE)

export const FACECAM = facecamBox(FACECAM_SIDE)

/** 1.835 — 0.145" acima de BODY_Y (1.98): o respiro do ajuste 11. */
export const FACECAM_BOTTOM = FACECAM.y + FACECAM.h

const HEAD_BAND = headBand(FACECAM_SIDE, FACECAM)
export const HEAD_X = HEAD_BAND.x
export const HEAD_W = HEAD_BAND.w

/**
 * Piso dos slides noturnos. Um pouco mais baixo que o do corpo (5.06) porque o
 * noturno não tem rodapé de módulo nem número de slide — só o fio da marca em
 * 5.593. Continua com folga larga do fio.
 */
export const NIGHT_BOTTOM = 5.2

export interface Box {
  x: number
  w: number
}

/** x de uma coluna de largura `w` encostada na margem do lado pedido */
export function sideX(side: FacecamSide, w: number): number {
  return side === 'left' ? MX : PAGE_W - MX - w
}

/**
 * Corpo em duas colunas com a FOTO no contra-lado da facecam (spec §3.1) e o
 * texto do lado da câmera. Vira junto com `FACECAM_SIDE`.
 */
export function photoSplit(photoW: number): { photo: Box; text: Box } {
  const textW = CONTENT_W - photoW - COL_GAP
  return {
    photo: { x: sideX(FAR_SIDE, photoW), w: photoW },
    text: { x: sideX(FACECAM_SIDE, textW), w: textW },
  }
}

/**
 * Corpo em duas colunas quando a coluna secundária é APOIO (glossário do
 * diálogo, cartão de itens do listening): o conteúdo primário abre na margem do
 * contra-lado, porque é por ele que a leitura começa, e o apoio fica sob a
 * câmera. Também vira junto com `FACECAM_SIDE`.
 */
export function asideSplit(asideW: number): { aside: Box; main: Box } {
  const mainW = CONTENT_W - asideW - COL_GAP
  return {
    aside: { x: sideX(FACECAM_SIDE, asideW), w: asideW },
    main: { x: sideX(FAR_SIDE, mainW), w: mainW },
  }
}

/**
 * TUDO O QUE MEDE VIVE EM `layout.ts` (spec §7-quater, item 20).
 *
 * Este arquivo é o DESENHO do v2 e só isso: não sobrou um `Math.max`/`Math.min`
 * nele. A quebra confirmada da invariante 0 na 3ª rodada do Sol foi um piso
 * reaplicado depois do plano (`Math.max(0.08, …)` no chip do rótulo do writing,
 * contra os 0.0723" que o plano previa) — a mesma classe de defeito do card de
 * vocabulário e do transbordo do writing. A regra agora é geral: **a geometria
 * vem do plano, ponto.**
 *
 * Os planos abaixo são reexportados daqui porque os testes e o `slides:template`
 * sempre os importaram deste módulo; a implementação é a de `layout.ts`.
 */
export {
  centrarPassos,
  fillRows,
  planNightBlock,
  planSteps,
  planTitle,
  rowFont,
  spreadList,
  vocabCols,
  STEP_LINE_FLOOR,
  HEAD_EYEBROW_Y,
  HEAD_TITLE_Y,
} from './layout.ts'
export type { HeadPlan, NightBlockPlan, Rows, StepsPlan, TitlePlan } from './layout.ts'

// -------------------------------------------------------------------- masters
export const MASTER_V2 = { paper: 'PT2_PAPER', night: 'PT2_NIGHT' } as const

/**
 * Masters do deck v2. O fundo noturno é UM só por deck — o fog do CLIMA da
 * PARTE (`climate.ts`). Capa, divisórias, missão e fechamento compartilham esse
 * fundo e se diferenciam pela COMPOSIÇÃO, não por um fundo diferente cada
 * (menos arquivo no .pptx e coerência de "capítulo" dentro do módulo).
 */
export function defineMastersV2(pres: Pres, doc: LessonDoc): void {
  const fio = { image: { x: 0, y: 5.593, w: 10, h: 0.032, path: join(ASSETS, 'brand-strip.png') } }
  pres.defineSlideMaster({
    title: MASTER_V2.paper,
    background: { color: T.paper50 },
    objects: [fio],
    slideNumber: {
      x: 9.3,
      y: 5.27,
      w: 0.35,
      h: 0.24,
      fontFace: FONT.body,
      fontSize: 8.5,
      color: T.ink400,
      align: 'right',
    },
  })
  pres.defineSlideMaster({
    title: MASTER_V2.night,
    background: { path: join(ASSETS, `${climateFor(doc.module.number).fog}.jpg`) },
    objects: [fio],
  })
}

// ------------------------------------------------------------------- imagens
/**
 * A foto daquele endereço EXISTE nesta renderização?
 *
 * Regra da spec §4.4: quando a variante pede foto e não há imagem resolvida, cai
 * na variante sem-foto — nunca desenhar moldura vazia. No site o resolvedor já
 * estoura `ImagensFaltando` antes de chegar aqui; pela CLI (sem banco) é este
 * teste que segura.
 */
function temImagem(doc: LessonDoc, file?: string): boolean {
  if (!file) return false
  const caminho = caminhoDaImagem(doc, file)
  return Boolean(caminho) && existsSync(caminho)
}

/**
 * Foto sangrada, sem moldura — usada nas composições full-bleed. O recorte é o
 * do `coverImage` (recorte de verdade, não esticada); `ancora` só muda para a
 * CAPA, que é o quadro mais deitado do deck e o único em que a foto em retrato
 * perde quase dois terços da altura.
 */
function bleedImage(
  doc: LessonDoc,
  slide: Slide,
  file: string,
  x: number,
  y: number,
  w: number,
  h: number,
  ancora: AncoraFoto = 'centro',
): void {
  coverImage(doc, slide, file, x, y, w, h, ancora)
}

/**
 * Véu escuro sobre foto. NÃO é decoração: é o que garante contraste do texto
 * branco sobre a foto (contiguidade/legibilidade). Reusa o vocabulário de
 * painel translúcido que o v1 já tem no cartão "NEXT CLASS".
 */
function scrim(slide: Slide, x: number, y: number, w: number, h: number, transparency: number): void {
  slide.addShape('rect', { x, y, w, h, fill: { color: T.night, transparency }, line: { width: 0 } })
}

// ------------------------------------------------------- cabeçalho (papel)
/**
 * Cabeçalho do slide de conteúdo, na faixa que sobra ao lado da facecam (6.12"
 * com a câmera à direita). A medida é de `layout.ts`; aqui só se amarram as duas
 * âncoras do template — a largura da faixa e a borda de baixo da câmera.
 *
 * As constantes verticais (`HEAD_EYEBROW_Y` 0.40 e `HEAD_TITLE_Y` 0.68) subiram
 * junto com a facecam no ajuste 11: sem isso, a faixa útil encolheria 0.12" e o
 * título perderia um degrau de fonte — a câmera subiria às custas do título.
 */
export function planHead(title: string, big = false): HeadPlan {
  return planHeadIn(title, HEAD_W, FACECAM_BOTTOM, big)
}

export interface PaperHeadV2 {
  eyebrow: string
  title: string
  /** nota à direita da faixa do cabeçalho (contagem de gabarito, dica de drill) */
  rightNote?: string
  rightNoteColor?: string
  /** título de DIVISÓRIA: mesma faixa, escada de fonte maior (ajuste 12) */
  big?: boolean
}

/**
 * Dock da facecam: a câmera da Teacher Vicky cobre esta área na gravação (16:9). Zona
 * reservada — nenhum layout desenha aqui. Fica em TODO slide de papel, inclusive
 * na divisória, para a câmera aterrissar sempre no mesmo lugar do curso.
 */
function facecamDock(slide: Slide): void {
  slide.addShape('roundRect', {
    x: FACECAM.x,
    y: FACECAM.y,
    w: FACECAM.w,
    h: FACECAM.h,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    rectRadius: 0.1,
    shadow: cardShadow(),
  })
}

function paperSlideV2(pres: Pres, doc: LessonDoc, head: PaperHeadV2): Slide {
  const slide = pres.addSlide({ masterName: MASTER_V2.paper })
  facecamDock(slide)
  const NOTE_W = 2.6
  const hasNote = Boolean(head.rightNote)
  slide.addText(head.eyebrow.toUpperCase(), {
    x: HEAD_X,
    y: HEAD_EYEBROW_Y,
    w: hasNote ? HEAD_W - NOTE_W - 0.2 : HEAD_W,
    h: 0.26,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    charSpacing: 2.4,
    color: T.brand700,
  })
  if (head.rightNote) {
    slide.addText(head.rightNote.toUpperCase(), {
      x: HEAD_X + HEAD_W - NOTE_W,
      y: HEAD_EYEBROW_Y,
      w: NOTE_W,
      h: 0.26,
      align: 'right',
      fontFace: FONT.body,
      fontSize: 9.5,
      bold: true,
      charSpacing: 1.5,
      color: head.rightNoteColor ?? T.brand700,
    })
  }
  const plan = planHead(plain(head.title), head.big)
  slide.addText(head.title, {
    x: HEAD_X,
    y: plan.titleY,
    w: HEAD_W,
    h: plan.titleH,
    fontFace: FONT.display,
    fontSize: plan.titleFont,
    bold: true,
    color: T.ink900,
    lineSpacingMultiple: 0.98,
    valign: 'top',
  })
  slide.addImage({
    path: join(ASSETS, 'brand-strip.png'),
    x: HEAD_X,
    y: plan.stripY,
    w: 0.9,
    h: 0.035,
  })
  // rodapé: contexto do curso + símbolo (mesma âncora do v1)
  slide.addText(
    `PERSONAL TRAVEL — MODULE ${doc.module.number} · ${doc.module.title.toUpperCase()}`,
    {
      x: MX,
      y: 5.28,
      w: 6.4,
      h: 0.22,
      fontFace: FONT.body,
      fontSize: 8,
      charSpacing: 1.5,
      color: T.ink400,
    },
  )
  slide.addImage({ path: SYMBOL_BLACK, x: 9.04, y: 5.285, w: 0.19, h: 0.19, transparency: 78 })
  return slide
}

// -------------------------------------------------------- bloco noturno
/**
 * `planNightBlock` (em `layout.ts`) recebe `top` = `FACECAM_BOTTOM` em TODOS os
 * layouts deste arquivo — decisão estética: mesmo nos slides noturnos (onde a
 * câmera pode estar desligada) o texto começa abaixo da faixa da facecam, para
 * "o conteúdo mora aqui" ser a mesma âncora em TODO o curso e para o slide não
 * quebrar se a Teacher Vicky mantiver a câmera ligada.
 */
function drawNightBlock(
  slide: Slide,
  opts: {
    x: number
    w: number
    align?: 'left' | 'center'
    eyebrow: string
    title: string
    subtitle?: string
    plan: NightBlockPlan
  },
): void {
  const align = opts.align ?? 'left'
  const { plan } = opts
  slide.addText(opts.eyebrow.toUpperCase(), {
    x: opts.x,
    y: plan.eyebrowY,
    w: opts.w,
    h: 0.3,
    align,
    fontFace: FONT.body,
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: T.turquoise,
  })
  slide.addText(opts.title, {
    x: opts.x,
    y: plan.titleY,
    w: opts.w,
    h: plan.titleH,
    align,
    fontFace: FONT.display,
    fontSize: plan.titleFont,
    bold: true,
    color: T.nightText,
    lineSpacingMultiple: 0.98,
    valign: 'top',
  })
  const stripW = 1.05
  slide.addImage({
    path: join(ASSETS, 'brand-strip.png'),
    x: align === 'center' ? opts.x + (opts.w - stripW) / 2 : opts.x,
    y: plan.stripY,
    w: stripW,
    h: 0.035,
  })
  if (opts.subtitle) {
    slide.addText(opts.subtitle, {
      x: opts.x,
      y: plan.subtitleY,
      w: opts.w,
      h: 0.46,
      align,
      fontFace: FONT.body,
      fontSize: 13.5,
      color: T.nightSub,
    })
  }
}

// ------------------------------------------------------------------ layouts
/**
 * UM LAYOUT POR TIPO (spec §7-ter.1, que revoga o §4.4).
 *
 * O sistema de variantes visuais saiu depois do 2º portão: aplicada com
 * honestidade, a regra do §4.1 — "variante não pode degradar a função do beat" —
 * mata quase todas. Se a composição A é a melhor para aquele beat, B e C são,
 * por definição, piores; e variante pior que a base é valor negativo (o aluno
 * não ganha novidade, ganha um slide ruim), além de triplicar a superfície de QA.
 *
 * Por isso as funções abaixo não recebem mais `variant`: cada uma desenha a
 * ÚNICA composição do seu tipo. O que varia entre aulas continua sendo o CLIMA
 * da PARTE (`climate.ts`), o formato do exercício, as vozes do listening e o
 * conteúdo — que é onde a pesquisa 05 mediu ganho de verdade. `variants.ts`
 * segue no repositório, disponível, mas nenhum tipo o consulta.
 */
type RV<K extends SlideSpec['type']> = (
  pres: Pres,
  doc: LessonDoc,
  s: Extract<SlideSpec, { type: K }>,
) => void

const COVER_BASELINE = 4.52
/**
 * Logo dos slides noturnos. 4.84 + 0.35 = 5.19, dentro de `NIGHT_BOTTOM` (5.20)
 * — antes era 4.86, e a borda caía em 5.21: os noturnos estavam silenciosamente
 * isentos do limite porque nenhum teste cobria o piso deles (Fase 0b, defeito 4;
 * `NIGHT_BOTTOM` agora está ratificado na spec §2.1).
 */
const LOGO_Y = 4.84
const LOGO_H = 0.35

// --------------------------------------------------------------------- cover
/**
 * CAPA — foto SANGRADA na página inteira, véu de contraste e o bloco de título
 * na base.
 *
 * Por que esta e não as outras duas da Fase 0a (spec §7-ter.1): (a) usa a foto
 * aprovada, como a variante do bloco lateral; (b) é a única que a usa no
 * tamanho da página; a variante "fog puro" descartava um asset aprovado e por
 * isso nem entra.
 *
 * ⚠️ CORREÇÃO DE UM COMENTÁRIO MENTIROSO (25/07). Aqui estava escrito que "a
 * biblioteca é 16:9, exatamente a proporção da página, de modo que a capa
 * mostra o enquadramento que o Gemini gerou, sem corte lateral". Isso nunca foi
 * verdade e a frase é a raiz do defeito — alguém leu, acreditou e desenhou em
 * cima dela. Medido em 25/07: 359 das 360 fotos estão FORA de 16:9 (186 em 3:2,
 * 134 em 1:1, 19 em RETRATO 2:3, nove delas usadas como capa). A capa portanto
 * SEMPRE recorta, e recorta muito: uma foto 2:3 mostra 37,7% da altura. É por
 * isso que a âncora vertical da capa é `'capa'` e não o centro — ver
 * `ancoraDaCapa` em `layout.ts`.
 *
 * Sem foto resolvida no endereço, o fundo é o fog da PARTE e o título cresce —
 * moldura vazia, nunca.
 */
const cover: RV<'cover'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER_V2.night })
  const hasPhoto = temImagem(doc, s.image?.file)
  const eyebrow = `PERSONAL TRAVEL · MODULE ${doc.module.number} · LESSON ${doc.lesson.number}`
  const title = s.title ?? doc.lesson.title
  const subtitle = s.subtitle ?? doc.lesson.subtitle
  const col: Box = { x: 0.62, w: hasPhoto ? 7.4 : 8.6 }
  const plan = planNightBlock({
    title: plain(title),
    hasSubtitle: Boolean(subtitle),
    w: col.w,
    top: FACECAM_BOTTOM,
    baseline: COVER_BASELINE,
    sizes: hasPhoto ? [40, 34, 29, 25, 21] : [46, 40, 34, 29, 24],
  })
  if (hasPhoto) {
    bleedImage(doc, slide, s.image!.file, 0, 0, PAGE_W, PAGE_H, 'capa')
    // dois véus = rampa grosseira (o pptx não tem gradiente): o de baixo é mais
    // forte, onde mora o texto. A rampa começa ACIMA do bloco inteiro — quando
    // ela cortava o eyebrow ao meio (2.5" fixo), a mesma linha de texto ficava
    // metade no claro e metade no escuro. Achado da invariante 0 com ordem de
    // camada (spec §7-ter.3, achado 14).
    const rampY = planScrimRamp(plan.eyebrowY)
    scrim(slide, 0, 0, PAGE_W, PAGE_H, 52)
    scrim(slide, 0, rampY, PAGE_W, PAGE_H - rampY, 34)
  }
  drawNightBlock(slide, { ...col, eyebrow, title, subtitle, plan })
  slide.addImage({ path: LOGO_WHITE, x: col.x, y: LOGO_Y, w: LOGO_H * WORDMARK_RATIO, h: LOGO_H })
  setNotes(slide, s)
}

// ---------------------------------------------------------------- objectives
const objectives: RV<'objectives'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, {
    eyebrow: "TODAY'S GOALS",
    title: s.title ?? 'Today you will…',
  })
  // ocupa a banda inteira: 2 objetivos não podem terminar no meio do slide
  const { rows, chip, font } = planObjectives(s.items.length, BODY_Y + 0.16, BODY_BOTTOM)
  s.items.forEach((item, i) => {
    const y = rows.y0 + i * rows.step
    checkChip(slide, MX + 0.04, y + (rows.h - chip) / 2, chip)
    slide.addText(runs(item, { fontFace: FONT.body, fontSize: font, color: T.ink900 }), {
      x: MX + 0.16 + chip,
      y,
      w: CONTENT_W - 0.16 - chip,
      h: rows.h,
      valign: 'middle',
      fit: 'shrink',
    })
  })
  setNotes(slide, s)
}

// -------------------------------------------------------------------- warmup
/** cartão do prompt — a altura e a fonte vêm de `planWarmup` */
function promptCard(
  slide: Slide,
  text: string,
  box: Box,
  y: number,
  font: number,
  h: number,
  tone: 'paper' | 'night' = 'paper',
): void {
  slide.addText(
    runs(text, {
      fontFace: FONT.body,
      fontSize: font,
      color: tone === 'paper' ? T.ink900 : T.nightText,
    }),
    {
      shape: 'roundRect',
      rectRadius: 0.08,
      fill: tone === 'paper' ? { color: T.paper0 } : { color: T.night, transparency: 26 },
      ...(tone === 'paper' ? { line: { color: T.hairline, width: 1 } } : {}),
      x: box.x,
      y,
      w: box.w,
      h,
      margin: 0.16,
      valign: 'middle',
      // rede da borda: com o prompt no teto do contrato (400 caracteres) a
      // menor fonte da escada ainda pode passar do cartão medido
      fit: 'shrink',
    },
  )
}

/**
 * Linha marcável com ALTURA dada (o `checkboxRow` do v1 tem linha fixa de 0.38"
 * e, no máximo do contrato — 10 itens abaixo de uma faixa de foto —, a última
 * linha caía fora do corpo). Mesmo desenho e mesmos tokens; o que muda é que a
 * caixa e a fonte acompanham a altura disponível (`planCheckRow`). O helper do
 * v1 fica intacto.
 */
function checkRow(
  slide: Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  checked = false,
): void {
  const { box, font } = planCheckRow(h)
  slide.addShape('roundRect', {
    x,
    y: y + (h - box) / 2,
    w: box,
    h: box,
    rectRadius: 0.04,
    fill: { color: T.paper0 },
    line: { color: T.box, width: 1.25 },
  })
  if (checked) checkChip(slide, x + box * 0.08, y + (h - box) / 2 + box * 0.08, box * 0.84)
  slide.addText(
    runs(label, { fontFace: FONT.body, fontSize: font, color: T.ink900 }),
    {
      x: x + box + 0.14,
      y,
      w: w - box - 0.14,
      h,
      valign: 'middle',
      fit: 'shrink',
    },
  )
}

/** itens marcáveis: 1 coluna até 5 itens, 2 colunas acima disso */
function checkItems(slide: Slide, items: string[], area: { x: number; y: number; w: number; bottom: number }): void {
  if (!items.length) return
  const { rows, colW, grid } = planCheckItems(items.length, area, COL_GAP)
  items.forEach((item, i) => {
    const c = Math.floor(i / rows)
    const r = i % rows
    checkRow(slide, area.x + c * (colW + COL_GAP), grid.y0 + r * grid.step, colW, grid.h, item)
  })
}

/**
 * WARM UP — foto em coluna alta no contra-lado da câmera, prompt no topo da
 * coluna de texto e itens marcáveis embaixo.
 *
 * Única composição (spec §7-ter.1). A variante da faixa panorâmica foi a que o
 * dono reprovou de olho ("foto esticada"): uma foto numa faixa de 9.16×1.34
 * deixa um filete da cena. A variante sem foto violava o critério (a) —
 * descartar asset aprovado.
 *
 * NOTA DE 25/07: quando o dono disse "foto esticada" ele estava literalmente
 * certo, e o motor lhe deu razão pelo motivo errado. Até aqui o `sizing:
 * cover` NÃO recortava nada sob Node — toda foto era esticada até a caixa (ver
 * `coverImage` em `template.ts`). O que se chamava de "recorte de 6.8:1" era
 * deformação de 6.8:1. O recorte agora existe; o veredito da composição
 * continua valendo, porque um filete de 6.8:1 é ruim recortado também. Esta usa a foto
 * num retrato alto (3.66×3.08, recorte 1.2:1, que é o que o `sizing: cover`
 * sustenta) e preenche a banda inteira dos dois lados.
 *
 * O prompt é MEDIDO contra o que os itens precisam: com o teto de 400
 * caracteres do contrato (spec §7-ter.3, achado 16) um prompt longo empurraria
 * a lista para fora da banda. Aqui a fonte do prompt cede primeiro e o cartão
 * nunca invade o espaço dos itens.
 */
const warmup: RV<'warmup'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, { eyebrow: 'WARM UP', title: s.title ?? "Let's get started" })
  const hasPhoto = temImagem(doc, s.image?.file)
  const items = s.items ?? []
  const { photo, text } = photoSplit(3.66)
  const col = hasPhoto ? text : { x: MX, w: CONTENT_W }
  const plan = planWarmup({
    prompt: plain(s.prompt),
    w: col.w,
    top: BODY_Y,
    bottom: BODY_BOTTOM,
    items: items.length,
    hasPhoto,
  })
  promptCard(slide, s.prompt, col, BODY_Y, plan.font, plan.h)
  checkItems(slide, items, { x: col.x, y: plan.bottom + 0.16, w: col.w, bottom: BODY_BOTTOM })
  if (hasPhoto) {
    const capH = s.image?.caption ? 0.26 : 0
    framedImage(
      doc,
      slide,
      s.image!.file,
      photo.x,
      BODY_Y,
      photo.w,
      BODY_BOTTOM - BODY_Y - capH,
      s.image?.caption,
    )
  }
  setNotes(slide, s)
}

// --------------------------------------------------------------------- vocab
type VocabCard = Extract<SlideSpec, { type: 'vocab' }>['cards'][number]

/**
 * Card de vocabulário. TODA a geometria vem de `planVocabCard` (`layout.ts`) —
 * aqui só se desenha (Fase 0b, defeito 1). O card antigo calculava as caixas no
 * meio do desenho, com piso de altura na caixa do termo e a pronúncia ancorada
 * acima do rodapé: num card baixo as três caixas colidiam (pronúncia sobre a
 * foto, termo sobre a tradução).
 *
 * Devolve a pronúncia que NÃO caberia no card, para as speaker notes.
 */
function vocabCard(
  doc: LessonDoc,
  slide: Slide,
  card: VocabCard,
  x: number,
  y: number,
  w: number,
  h: number,
): string | undefined {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    shadow: cardShadow(),
  })
  const p = planVocabCard({
    x,
    y,
    w,
    h,
    hasImg: temImagem(doc, card.image),
    temCue: Boolean(card.cue),
  })
  if (p.img) framedImage(doc, slide, card.image!, p.img.x, p.img.y, p.img.w, p.img.h)
  slide.addText(card.term, {
    x: p.term.x,
    y: p.term.y,
    w: p.term.w,
    h: p.term.h,
    align: p.align,
    fontFace: FONT.display,
    fontSize: p.term.font,
    bold: true,
    color: T.ink900,
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  })
  if (p.cue && card.cue) {
    slide.addText(card.cue, {
      x: p.cue.x,
      y: p.cue.y,
      w: p.cue.w,
      h: p.cue.h,
      align: p.align,
      fontFace: FONT.mono,
      fontSize: p.cue.font,
      color: T.teal700,
      valign: 'middle',
      margin: 0,
      fit: 'shrink',
    })
  }
  slide.addText(card.pt, {
    x: p.pt.x,
    y: p.pt.y,
    w: p.pt.w,
    h: p.pt.h,
    align: p.layout === 'row' ? 'right' : p.align,
    fontFace: FONT.body,
    fontSize: p.pt.font,
    color: T.ink600,
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  })
  return card.cue && !p.showCue ? `${card.term} — ${card.cue}` : undefined
}

/** grade UNIFORME de cards, centrada na área (nunca passa da borda) */
function vocabGrid(
  doc: LessonDoc,
  slide: Slide,
  cards: VocabCard[],
  area: { x: number; y: number; w: number; h: number },
  cols: number,
  maxH?: number,
): string[] {
  if (!cards.length) return []
  const g = planVocabGrid(cards.length, cols, area, maxH)
  const semCue: string[] = []
  cards.forEach((card, i) => {
    const omitida = vocabCard(
      doc,
      slide,
      card,
      area.x + (i % g.cols) * (g.cardW + g.gapX),
      g.y0 + Math.floor(i / g.cols) * (g.cardH + g.gapY),
      g.cardW,
      g.cardH,
    )
    if (omitida) semCue.push(omitida)
  })
  return semCue
}

/**
 * VOCABULÁRIO — grade UNIFORME de 3–4 colunas (a régua do v1, que o 1º portão
 * visual declarou melhor que a do v2).
 *
 * Única composição (spec §7-ter.1). O cartão-linha em 2 colunas foi o "fotos
 * minúsculas" que o dono reprovou: numa linha de 4.46×1.30 a miniatura fica com
 * 0.89" de largura — a foto vira selo. O card-herói já havia sido contido na
 * Fase 0b (defeito 8) por esmagar os outros 7. Sobra a grade, que é também a
 * que dá à FOTO de cada card a maior área possível.
 */
const vocab: RV<'vocab'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, {
    eyebrow: 'VOCABULARY',
    title: s.title,
    rightNote: `▶ ${s.drillHint ?? 'Listen & repeat'}`,
  })
  let y0 = BODY_Y
  if (s.intro) {
    slide.addText(runs(s.intro, { fontFace: FONT.body, fontSize: 12, italic: true, color: T.ink600 }), {
      x: MX,
      y: BODY_Y,
      w: CONTENT_W,
      h: 0.28,
    })
    y0 = BODY_Y + 0.36
  }
  const area = { x: MX, y: y0, w: CONTENT_W, h: BODY_BOTTOM - y0 }
  const cards = [...s.cards]
  const semCue = vocabGrid(doc, slide, cards, area, vocabCols(cards.length))
  // A pronúncia que não caber no card vai para as notas — nunca desaparece.
  setNotes(slide, s, semCue.length ? ['PRONÚNCIA (não caberia no card):', ...semCue] : [])
}

// ------------------------------------------------------------------- grammar
const grammar: RV<'grammar'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, { eyebrow: 'GRAMMAR SPOTLIGHT', title: s.title })
  // motor de medida do v1: regra + tabela dividem a coluna esquerda e a altura
  // é decidida ANTES de desenhar (regressão do M6A1/M6A2)
  const plan = planGrammar({
    rule: plain(s.rule),
    tableHeaders: s.table?.headers,
    tableCells: s.table?.rows,
    examples: s.examples.map(plain),
    hasWatchOut: Boolean(s.watchOut),
  })
  const LEFT_W = 4.42
  const rightX = MX + LEFT_W + COL_GAP - 0.02
  const rightW = PAGE_W - MX - rightX
  // sem tabela, o cartão da regra OCUPA a coluna (defeito 9): antes ele parava
  // onde o texto acabava e a metade de baixo da coluna ficava vazia
  const ruleH = s.table ? plan.ruleH : BODY_BOTTOM - BODY_Y
  // cartão alto pede tipografia alta: a fonte do plano é medida para o cartão
  // curto (com tabela); num cartão de 3" ela deixaria a regra perdida no meio
  const ruleFont = s.table
    ? plan.ruleFont
    : fitFont(plain(s.rule), LEFT_W, ruleH, [19, 17, 15.5, 14, 13, 12])
  slide.addText(runs(s.rule, { fontFace: FONT.body, fontSize: ruleFont, color: T.ink900 }), {
    shape: 'roundRect',
    rectRadius: 0.08,
    fill: { color: T.brandWash },
    line: { color: T.brandWashLine, width: 1 },
    x: MX,
    y: BODY_Y,
    w: LEFT_W,
    h: ruleH,
    margin: 0.18,
    valign: 'middle',
  })
  if (s.table) {
    slide.addTable(
      [
        s.table.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            color: T.ink600,
            fill: { color: T.paper100 },
            fontSize: plan.tableHeaderFont,
          },
        })),
        ...s.table.rows.map((row) =>
          row.map((cell) => ({
            text: cell,
            options: { color: T.ink900, fill: { color: T.paper0 }, fontSize: plan.tableFont },
          })),
        ),
      ],
      {
        x: MX,
        y: plan.tableY,
        w: LEFT_W,
        rowH: plan.tableRowH,
        colW: s.table.headers.map(() => LEFT_W / s.table!.headers.length),
        border: { type: 'solid', pt: 0.5, color: T.hairline },
        fontFace: FONT.body,
        valign: 'middle',
        margin: 0.05,
      },
    )
  }
  // exemplos: distribuídos na coluna (com watch out, até o cartão dele) — a
  // distribuição e a altura da caixa saem do plano, como todo o resto
  const ex = plan.examples
  s.examples.forEach((texto, i) => {
    slide.addText(runs(texto, { fontFace: FONT.body, fontSize: plan.exampleFont, color: T.ink900 }), {
      x: rightX,
      y: ex.y0 + i * ex.step,
      w: rightW,
      h: ex.h,
      valign: 'top',
      fit: 'shrink',
    })
  })
  if (s.watchOut) {
    // erro comum em CARTÃO (v1 deixava solto): a gramática de cor é a mesma —
    // danger para o errado, ok para o certo
    slide.addText(
      [
        { text: '✗ ', options: { bold: true, color: T.danger700 } },
        { text: s.watchOut.wrong, options: { color: T.danger700, strike: true } },
        { text: '   ✓ ', options: { bold: true, color: T.ok700 } },
        { text: s.watchOut.right, options: { bold: true, color: T.ok700 } },
      ],
      {
        shape: 'roundRect',
        rectRadius: 0.07,
        fill: { color: T.paper0 },
        line: { color: T.hairline, width: 1 },
        x: rightX,
        y: plan.watchOutY,
        w: rightW,
        h: plan.watchOutH,
        margin: 0.12,
        fontFace: FONT.body,
        fontSize: fitFont(
          plain(s.watchOut.wrong) + plain(s.watchOut.right) + '     ',
          rightW,
          plan.watchOutH,
          [12, 11, 10],
        ),
        valign: 'middle',
      },
    )
  }
  setNotes(slide, s)
}

// ------------------------------------------------------------------ dialogue
type DialogueSpec = Extract<SlideSpec, { type: 'dialogue' }>

/**
 * PALETA DO DIÁLOGO — uma faixa por FALANTE (defeito 1 do lote de 14 aulas).
 *
 * A gramática de cor do deck não muda: as duas primeiras faixas são exatamente
 * o par que já valia (roxo da marca sobre papel; teal sobre lavagem teal), e as
 * duas seguintes saem dos mesmos tokens aprovados — âmbar (o par do travel tip)
 * e o neutro de tinta. O que mudou é QUEM escolhe a faixa: antes era a posição
 * da fala, agora é o nome do falante (`speakerLanes`).
 */
export const DIALOGUE_LANES = [
  { name: T.brand700, fill: T.paper100 },
  { name: T.teal700, fill: T.tealWash },
  { name: T.warn700, fill: T.warnWash },
  { name: T.ink600, fill: T.paper50 },
] as const

/** onde a banda das pastilhas começa (o contexto, quando existe, ocupa o topo) */
const dialogueTop = (s: DialogueSpec): number => (s.context ? BODY_Y + 0.38 : BODY_Y + 0.06)

/** largura da coluna das pastilhas: com glossário/foto o diálogo divide o corpo */
function dialogueCol(doc: LessonDoc, s: DialogueSpec): { x: number; w: number } {
  const hasAside = Boolean(s.glossary?.length) || temImagem(doc, s.image?.file)
  return hasAside ? asideSplit(3.0).main : { x: MX, w: 7.2 }
}

/**
 * PÁGINAS do diálogo (mesma saída do `writing`, spec §7-quater item 21): o que
 * não cabe na banda CONTINUA em outro slide — nunca vaza da pastilha.
 *
 * As faixas de cor são calculadas UMA vez, sobre o diálogo inteiro: o falante
 * mantém a cor na página 2.
 */
export function dialoguePages(doc: LessonDoc, s: DialogueSpec): DialoguePlan[] {
  const col = dialogueCol(doc, s)
  const w = col.w - DIALOGUE.indent
  const top = dialogueTop(s)
  const falas = s.lines.map((l) => ({ speaker: plain(l.speaker), text: plain(l.text) }))
  const lanes = speakerLanes(falas.map((l) => l.speaker))
  const pages: DialoguePlan[] = []
  let off = 0
  while (off < falas.length) {
    const plan = planDialogue(falas.slice(off), {
      w,
      top,
      bottom: BODY_BOTTOM,
      lanes: lanes.slice(off),
      // a continuação é irmã da primeira tela: mesmo corpo, nunca maior
      maxFont: pages[0]?.font,
    })
    if (plan.fits < 1) {
      throw new RangeError(
        `dialogue: a fala ${off + 1} (${falas[off].speaker}) não cabe na banda do corpo nem ` +
          `sozinha (${falas[off].text.length} caracteres)`,
      )
    }
    pages.push(plan)
    off += plan.fits
  }
  return pages
}

const dialogue: RV<'dialogue'> = (pres, doc, s) => {
  const main = dialogueCol(doc, s)
  const y0 = dialogueTop(s)
  let off = 0
  for (const plano of dialoguePages(doc, s)) {
    dialogueSlide(pres, doc, s, plano, off, main, y0)
    off += plano.fits
  }
}

function dialogueSlide(
  pres: Pres,
  doc: LessonDoc,
  s: DialogueSpec,
  plano: DialoguePlan,
  off: number,
  main: { x: number; w: number },
  y0: number,
): void {
  const slide = paperSlideV2(pres, doc, {
    eyebrow: off > 0 ? 'READING · DIALOGUE (CONT.)' : 'READING · DIALOGUE',
    title: s.title,
  })
  if (s.context) {
    slide.addText(runs(s.context, { fontFace: FONT.body, fontSize: 11.5, italic: true, color: T.ink600 }), {
      x: main.x,
      y: BODY_Y - 0.02,
      w: main.w,
      h: 0.3,
    })
  }
  // TODA a geometria da pastilha vem do PLANO (defeito 2): altura medida pelo
  // texto real, corpo único para o diálogo inteiro, entrelinha travada e
  // respiro interno explícito — o `margin: 0.11` de antes era 0.11 PONTOS
  // (≈0.0015"), ou seja, texto encostado no fundo com a medida por fazer.
  plano.bubbles.forEach((b, i) => {
    const line = s.lines[off + i]
    const cor = DIALOGUE_LANES[b.lane]
    slide.addText(
      [
        {
          text: `${line.speaker}   `,
          options: { bold: true, color: cor.name, fontSize: plano.speakerFont },
        },
        ...runs(line.text, { fontFace: FONT.body, fontSize: plano.font, color: T.ink900 }),
      ],
      {
        shape: 'roundRect',
        rectRadius: 0.09,
        fill: { color: cor.fill },
        x: main.x + b.dx,
        y: b.y,
        w: main.w - DIALOGUE.indent,
        h: b.h,
        margin: plano.margin,
        lineSpacing: plano.lineSpacing,
        valign: 'middle',
        fontFace: FONT.body,
        fontSize: plano.font,
      },
    )
  })
  // a coluna de apoio (glossário ou foto) acompanha TODAS as páginas: é
  // referência do diálogo inteiro, não da fala que calhou de estar na tela
  const split = asideSplit(3.0)
  if (s.glossary?.length) {
    // o cartão do glossário OCUPA a coluna (defeito 9): antes ele parava na
    // última linha e sobrava um vão ao lado dos balões
    const gh = BODY_BOTTOM - y0
    const linhas = fillRows(y0 + 0.44, BODY_BOTTOM - 0.14, s.glossary.length, { h: 0.3, gap: 0.04 }, 1.6)
    slide.addShape('roundRect', {
      x: split.aside.x,
      y: y0,
      w: split.aside.w,
      h: gh,
      rectRadius: 0.08,
      fill: { color: T.paper0 },
      line: { color: T.hairline, width: 1 },
      shadow: cardShadow(),
    })
    slide.addText('GLOSSARY', {
      x: split.aside.x + 0.18,
      y: y0 + 0.14,
      w: split.aside.w - 0.36,
      h: 0.24,
      fontFace: FONT.body,
      fontSize: 9,
      bold: true,
      charSpacing: 2,
      color: T.ink400,
    })
    s.glossary.forEach((g, i) => {
      slide.addText(
        [
          { text: g.term, options: { bold: true, color: T.ink900 } },
          { text: ` — ${g.pt}`, options: { color: T.ink600 } },
        ],
        {
          x: split.aside.x + 0.18,
          y: linhas.y0 + i * linhas.step,
          w: split.aside.w - 0.3,
          h: linhas.h,
          fontFace: FONT.body,
          fontSize: linhas.h >= 0.4 ? 12 : 10.5,
          valign: 'middle',
          fit: 'shrink',
        },
      )
    })
  } else if (temImagem(doc, s.image?.file)) {
    const capH = s.image?.caption ? 0.26 : 0
    framedImage(
      doc,
      slide,
      s.image!.file,
      split.aside.x,
      y0,
      split.aside.w,
      BODY_BOTTOM - y0 - capH,
      s.image?.caption,
    )
  }
  setNotes(slide, s)
}

// ----------------------------------------------------------------- listening
function listeningSlide(
  pres: Pres,
  doc: LessonDoc,
  s: Extract<SlideSpec, { type: 'listening' }>,
  revealUpTo: number,
): void {
  const total = (s.items ?? []).filter((i) => i.correct === true).length
  const slide = paperSlideV2(pres, doc, {
    eyebrow: revealUpTo > 0 ? 'LISTENING · ANSWERS' : 'LISTENING COMPREHENSION',
    title: s.title ?? 'Watch and listen',
    rightNote: revealUpTo > 0 ? `✓ Answers ${revealUpTo}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  const { main: video, aside: card } = asideSplit(4.62)
  // moldura do vídeo em 16:9 (é a proporção do que vai ser inserido) ocupando a
  // coluna até a borda do corpo — o chip do link fecha embaixo (defeito 9)
  const { videoH: VIDEO_H, chipH: CHIP_H, play: PLAY, taskH: TASK_H } = planListening(
    video.w,
    BODY_Y,
    BODY_BOTTOM,
  )
  slide.addShape('roundRect', {
    x: video.x,
    y: BODY_Y,
    w: video.w,
    h: VIDEO_H,
    rectRadius: 0.1,
    fill: { color: T.ink900 },
    shadow: cardShadow(),
  })
  slide.addText('▶', {
    shape: 'ellipse',
    x: video.x + (video.w - PLAY) / 2,
    y: BODY_Y + (VIDEO_H - PLAY) / 2,
    w: PLAY,
    h: PLAY,
    fill: { color: T.paper0 },
    color: T.brand600,
    fontSize: 20,
    bold: true,
    align: 'center',
    valign: 'middle',
    fontFace: FONT.body,
  })
  const chipText = s.videoUrl
    ? [
        {
          text: s.videoUrl,
          options: {
            color: T.teal700,
            underline: { style: 'sng' as const },
            hyperlink: { url: s.videoUrl },
          },
        },
        ...(s.excerpt
          ? [{ text: `  ▶ ${s.excerpt.start}–${s.excerpt.end}`, options: { color: T.ink400, bold: true } }]
          : []),
      ]
    : [
        {
          text: s.videoHint ?? '► Teacher Vicky: inserir o vídeo aqui (Inserir → Vídeo)',
          options: { italic: true, color: T.ink400 },
        },
      ]
  slide.addText(chipText, {
    shape: 'roundRect',
    rectRadius: 0.07,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    x: video.x,
    y: BODY_Y + VIDEO_H + 0.16,
    w: video.w,
    h: CHIP_H,
    margin: 0.1,
    valign: 'middle',
    fontFace: FONT.body,
    fontSize: 9.5,
    fit: 'shrink',
  })
  const items = s.items ?? []
  const cardTop = BODY_Y
  // o cartão OCUPA a banda (defeito 9): antes ele terminava onde os itens
  // acabavam e o pé da coluna ficava vazio ao lado de um vídeo alto
  const cardH = BODY_BOTTOM - cardTop
  slide.addShape('roundRect', {
    x: card.x,
    y: cardTop,
    w: card.w,
    h: cardH,
    rectRadius: 0.1,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    shadow: cardShadow(),
  })
  slide.addText(runs(s.task, { fontFace: FONT.body, fontSize: 12.5, color: T.ink900 }), {
    x: card.x + 0.18,
    y: cardTop + 0.14,
    w: card.w - 0.36,
    h: TASK_H - 0.18,
  })
  // itens distribuídos no cartão; com 8 itens o passo comprime e a linha
  // acompanha (a linha fixa de 0.38" do helper do v1 fazia os itens colidirem)
  const rows = fillRows(cardTop + TASK_H, BODY_BOTTOM - 0.14, items.length, { h: 0.38, gap: 0.04 }, 1.6)
  let ordinal = 0
  items.forEach((item, i) => {
    if (item.correct === true) ordinal += 1
    const checked = item.correct === true && ordinal <= revealUpTo
    checkRow(slide, card.x + 0.18, rows.y0 + i * rows.step, card.w - 0.36, rows.h, item.text, checked)
  })
  setNotes(slide, s, s.answers ? [s.answers] : [])
}

// ------------------------------------------------------------------ speaking
const speaking: RV<'speaking'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, {
    eyebrow: 'SPEAKING · PRONUNCIATION',
    title: s.title ?? 'Repeat after me',
  })
  slide.addText(runs(s.instruction, { fontFace: FONT.body, fontSize: 12.5, color: T.ink600 }), {
    x: MX,
    y: BODY_Y - 0.02,
    w: CONTENT_W,
    h: 0.32,
  })
  const hintH = s.hint ? 0.28 : 0
  const rows = fillRows(BODY_Y + 0.38, BODY_BOTTOM - hintH, s.phrases.length, { h: 0.46, gap: 0.12 }, 1.9)
  const SAY_W = 0.6
  s.phrases.forEach((phrase, i) => {
    const y = rows.y0 + i * rows.step
    const h = rows.h
    slide.addText('SAY', {
      shape: 'roundRect',
      rectRadius: 0.06,
      x: MX,
      y: y + (h - 0.3) / 2,
      w: SAY_W,
      h: 0.3,
      fill: { color: T.brand600 },
      color: T.paper0,
      fontFace: FONT.body,
      fontSize: 8.5,
      bold: true,
      align: 'center',
      valign: 'middle',
      charSpacing: 1.5,
    })
    slide.addText(runs(phrase, { fontFace: FONT.body, fontSize: 14.5, color: T.ink900 }), {
      shape: 'roundRect',
      rectRadius: 0.08,
      fill: { color: T.paper0 },
      line: { color: T.hairline, width: 1 },
      x: MX + SAY_W + 0.14,
      y,
      w: CONTENT_W - SAY_W - 0.14,
      h,
      margin: 0.13,
      valign: 'middle',
    })
  })
  if (s.hint) {
    slide.addText(s.hint, {
      x: MX,
      y: BODY_BOTTOM - hintH,
      w: CONTENT_W,
      h: 0.24,
      fontFace: FONT.body,
      fontSize: 9.5,
      italic: true,
      color: T.ink400,
    })
  }
  setNotes(slide, s)
}

// ------------------------------------------------------------------- writing
type WritingSpec = Extract<SlideSpec, { type: 'writing' }>

const WRITE_CHIP_X = MX
const WRITE_TEXT_X = 0.84
const WRITE_RIGHT = 9.58

/** endereço de um item dentro do documento (o plano fala em índices de PÁGINA) */
interface WritingRef {
  ex: number
  item: number
}

/** todos os itens do writing, na ordem em que a aluna os vê */
function writingRefs(s: WritingSpec): WritingRef[] {
  const out: WritingRef[] = []
  s.exercises.forEach((ex, i) => ex.items.forEach((_, j) => out.push({ ex: i, item: j })))
  return out
}

/**
 * Os exercícios que RESTAM a partir do item `off`, reagrupados como se fossem o
 * writing inteiro — é isso que `planWriting` mede. `refs[i][j]` traduz de volta
 * para o item do documento.
 */
function writingResto(s: WritingSpec, off: number): {
  exercises: Array<{ kind: 'complete' | 'unscramble' | 'create'; items: unknown[] }>
  refs: WritingRef[][]
} {
  const exercises: Array<{ kind: 'complete' | 'unscramble' | 'create'; items: unknown[] }> = []
  const refs: WritingRef[][] = []
  let atual = -1
  for (const r of writingRefs(s).slice(off)) {
    if (r.ex !== atual) {
      atual = r.ex
      exercises.push({ kind: s.exercises[r.ex].kind, items: [] })
      refs.push([])
    }
    exercises[exercises.length - 1].items.push(0)
    refs[refs.length - 1].push(r)
  }
  return { exercises, refs }
}

/** chips de um item — MESMA função que o desenho usa (nunca duas contas) */
function writingChips(s: WritingSpec, r: WritingRef) {
  const item = s.exercises[r.ex]?.items[r.item]
  return planChips(item ? plain(item.prompt).split(' / ') : [''], WRITE_TEXT_X, WRITE_RIGHT)
}

interface WritingPage {
  refs: WritingRef[][]
  plan: ReturnType<typeof planWriting>
  /** número (1-based) do primeiro item desta página */
  primeiro: number
}

/**
 * PAGINAÇÃO DO WRITING (spec §7-quater, item 21).
 *
 * O piso da caixa de resposta é 0.18" — quem escreve nela é a aluna, ao vivo.
 * Até a Fase 0d esse piso era comprimido junto com o resto quando o conjunto não
 * cabia: medido no teto do contrato, a caixa saía com 0.09". Uma caixa de 0.09"
 * não serve para escrever dentro, então ela deixa de ser piso e o nome vira
 * mentira. A escolha honesta é a mesma que a missão já faz: o que não cabe
 * CONTINUA em outro slide.
 *
 * A quebra é medida uma vez e vale para todas as telas de gabarito da mesma
 * spec — a revelação progressiva não muda geometria nenhuma.
 */
function writingPages(s: WritingSpec): WritingPage[] {
  const pages: WritingPage[] = []
  const total = writingRefs(s).length
  let off = 0
  while (off < total) {
    const { exercises, refs } = writingResto(s, off)
    const plan = planWriting(
      exercises,
      (i, j) => writingChips(s, refs[i][j]).rows,
      undefined,
      WRITING_MINS_V2,
    )
    if (plan.fits < 1) {
      throw new RangeError(
        `writing: o item ${off + 1} não cabe na banda do corpo nem sozinho ` +
          `(${plain(s.exercises[refs[0][0].ex].items[refs[0][0].item].prompt).length} caracteres)`,
      )
    }
    pages.push({ refs, plan, primeiro: off + 1 })
    off += plan.fits
  }
  return pages
}

/**
 * Quantas TELAS o writing ocupa. É a conta do PRÓPRIO renderer (mesma função
 * que desenha), exportada para o `fit-check` avisar quem escreve conteúdo —
 * paginar é legítimo, ser silencioso não é (defeito 3 do lote de 14 aulas).
 */
export function writingPageCount(s: WritingSpec): number {
  return writingPages(s).length
}

function writingSlide(
  pres: Pres,
  doc: LessonDoc,
  s: WritingSpec,
  revealUpTo: number,
  page: WritingPage,
  /** quantas respostas já foram reveladas nas páginas anteriores */
  respondidasAntes: number,
): number {
  const total = s.exercises.reduce((n, ex) => n + ex.items.filter((i) => i.answer).length, 0)
  const cont = page.primeiro > 1
  const slide = paperSlideV2(pres, doc, {
    eyebrow: revealUpTo > 0 ? 'WRITING · ANSWERS' : cont ? 'WRITING · CONTINUED' : 'WRITING PRODUCTION',
    title: s.title ?? 'Your turn to write',
    rightNote: revealUpTo > 0 ? `✓ Answers ${revealUpTo}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  slide.addText(runs(s.instruction, { fontFace: FONT.body, fontSize: 12, color: T.ink600 }), {
    x: MX,
    y: BODY_Y - 0.02,
    w: CONTENT_W,
    h: 0.3,
  })
  // Com folga (1 exercício curto) o bloco CRESCE para ocupar a banda — antes
  // parava a 68% da altura com o pé do slide vazio (defeito 9). A expansão
  // mudou de lugar na Fase 0d: era uma escala vertical aplicada AQUI, sobre o
  // plano pronto, e uma escala uniforme não consegue abrir um vão que vale
  // zero — o vão ENTRE itens continuava colado enquanto o vão DENTRO do item
  // crescia junto com todo o resto (item 18). Agora quem cresce é a parte
  // comprimível DENTRO do `planWriting` (`mins.grow`), com os dois vãos como
  // pisos: o desenho passa a ser exatamente o que o plano diz.
  const { plan, refs } = page
  const gabarito: string[] = []
  let itemNo = page.primeiro - 1
  let answered = respondidasAntes
  for (const b of plan.blocks) {
    const ref = b.item >= 0 ? refs[b.ex][b.item] : refs[b.ex][0]
    const ex = s.exercises[ref.ex]
    if (b.kind === 'label') {
      slide.addText(KIND_LABEL[ex.kind], {
        shape: 'roundRect',
        rectRadius: 0.05,
        x: WRITE_CHIP_X,
        y: b.y,
        // 1.16" cortava "UNSCRAMBLE" em duas linhas e o texto saía do chip
        // (visto na inspeção do M5A1); wrap desligado garante uma linha só
        w: 1.42,
        wrap: false,
        // A ALTURA VEM DO PLANO. Aqui morava `Math.max(0.08, …)`: com o plano
        // prevendo 0.0723" o chip era desenhado com 0.08" e invadia a primeira
        // pastilha do item (spec §7-quater, item 20 — quebra da invariante 0
        // reproduzida pelo Sol). Nenhum piso depois do plano, nunca mais.
        h: b.labelH,
        fill: { color: T.ink900 },
        color: T.paper0,
        fontFace: FONT.body,
        fontSize: 8,
        bold: true,
        charSpacing: 1.5,
        align: 'center',
        valign: 'middle',
      })
      continue
    }
    const item = ex.items[ref.item]
    itemNo += 1
    if (item.answer) {
      answered += 1
      gabarito.push(`${itemNo}. ${item.answer}`)
    }
    const show = Boolean(item.answer) && answered <= revealUpTo
    // TODA caixa deste bloco vem do plano: nenhum piso de altura aqui, senão a
    // caixa volta a crescer para fora do bloco.
    if (b.kind === 'complete') {
      numChip(slide, WRITE_CHIP_X, b.y + (b.h - b.numChipH) / 2, itemNo, b.numChipH)
      slide.addText(runs(item.prompt, { fontFace: FONT.body, fontSize: plan.fontSize, color: T.ink900 }), {
        x: WRITE_TEXT_X,
        y: b.y,
        w: 6.9,
        h: b.promptH,
        valign: 'middle',
        fit: 'shrink',
      })
      answerBox(slide, 7.9, b.answerY, 1.68, b.answerH, show ? item.answer : undefined)
    } else if (b.kind === 'unscramble') {
      numChip(slide, WRITE_CHIP_X, b.y + 0.02, itemNo, b.numChipH)
      // passo E altura da pastilha vêm do PLANO: é a conta dele que garante que
      // `answerY − (fim dos chips)` seja exatamente `plan.gapDentro` — o vão do
      // agrupamento (item 18) tem de ser medível no desenho, não estimado aqui
      for (const c of writingChips(s, ref).chips) {
        slide.addText(c.text, {
          shape: 'roundRect',
          rectRadius: 0.05,
          x: c.x,
          y: b.y + c.row * b.chipStep,
          w: c.w,
          h: b.chipH,
          fill: { color: T.paper100 },
          line: { color: T.hairline, width: 1 },
          color: T.ink900,
          fontFace: FONT.body,
          // a fonte segue a PASTILHA, não o fator global: é a altura dela que
          // decide se 11pt cabe (chipH é o que se desenha)
          fontSize: b.chipH >= 0.17 ? 11 : 10,
          align: 'center',
          valign: 'middle',
          wrap: false,
          margin: 0.02,
          fit: 'shrink',
        })
      }
      answerBox(slide, WRITE_TEXT_X, b.answerY, WRITE_RIGHT - WRITE_TEXT_X, b.answerH, show ? item.answer : undefined)
    } else {
      numChip(slide, WRITE_CHIP_X, b.y + 0.02, itemNo, b.numChipH)
      slide.addText(runs(item.prompt, { fontFace: FONT.body, fontSize: plan.fontSize, color: T.ink900 }), {
        x: WRITE_TEXT_X,
        y: b.y,
        w: WRITE_RIGHT - WRITE_TEXT_X,
        h: b.promptH,
        valign: 'middle',
        fit: 'shrink',
      })
      answerBox(slide, WRITE_TEXT_X, b.answerY, WRITE_RIGHT - WRITE_TEXT_X, b.answerH, show ? item.answer : undefined)
    }
  }
  setNotes(slide, s, gabarito)
  return answered - respondidasAntes
}

/** todas as páginas do writing para UM nível de revelação */
function writingScreens(pres: Pres, doc: LessonDoc, s: WritingSpec, revealUpTo: number): void {
  let respondidas = 0
  for (const page of writingPages(s)) {
    respondidas += writingSlide(pres, doc, s, revealUpTo, page, respondidas)
  }
}

// ---------------------------------------------------------------------- quiz
/**
 * QUIZ — pergunta e, no slide seguinte, as RESPOSTAS TODAS JUNTAS repetindo as
 * perguntas (spec §7-bis, defeito 7; instrução literal do dono: *"as respostas
 * do quiz devem aparecer juntas, igual os outros slides, repetindo"*).
 *
 * Antes eram 6 slides do mesmo quiz — uma revelação por seta — e a 5ª resposta
 * caía cinco slides depois da pergunta. `listening` e `writing` MANTÊM o
 * progressivo: ali a revelação um-a-um é recurso didático (a seta "preenche" a
 * caixa que a aluna acabou de tentar), enquanto o quiz é oral e corrido.
 */
function quizSlide(
  pres: Pres,
  doc: LessonDoc,
  s: Extract<SlideSpec, { type: 'quiz' }>,
  showAnswers: boolean,
): void {
  const total = s.questions.filter((q) => q.answer).length
  const slide = paperSlideV2(pres, doc, {
    eyebrow: showAnswers ? 'QUIZ · ANSWERS' : 'QUIZ',
    title: s.title ?? 'What do you do?',
    rightNote: showAnswers ? `✓ Answers ${total}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  const TEXT_X = 0.9
  const textW = PAGE_W - MX - TEXT_X
  let y = BODY_Y
  if (s.intro && !showAnswers) {
    slide.addText(runs(s.intro, { fontFace: FONT.body, fontSize: 12.5, color: T.ink600 }), {
      x: MX,
      y: BODY_Y - 0.02,
      w: CONTENT_W,
      h: 0.3,
    })
    y = BODY_Y + 0.38
  }
  const gabarito: string[] = []
  // a tipografia CRESCE até preencher a banda (defeito 9): 2 perguntas curtas em
  // 13pt deixavam dois terços do slide vazios. Tudo medido em `planQuiz`.
  const plan = planQuiz({
    questions: s.questions.map((q) => ({ q: plain(q.q), answer: q.answer ? plain(q.answer) : undefined })),
    showAnswers,
    top: y,
    bottom: BODY_BOTTOM,
    textW,
  })
  s.questions.forEach((question, i) => {
    if (question.answer) gabarito.push(`${i + 1}. ${question.answer}`)
    const row = plan.rows[i]
    numChip(slide, MX, row.y + 0.04, i + 1, row.chipH)
    slide.addText(
      runs(question.q, {
        fontFace: FONT.body,
        fontSize: plan.fontQ,
        color: showAnswers ? T.ink600 : T.ink900,
      }),
      { x: TEXT_X, y: row.y, w: textW, h: row.qh, valign: 'top', fit: 'shrink' },
    )
    if (showAnswers) {
      // sem `fit: 'shrink'`: a caixa já tem a altura medida da resposta, e o
      // shrink do conversor derretia a letra numa caixa curta
      slide.addText(
        [
          { text: '✓  ', options: { bold: true, color: T.teal600, fontSize: plan.fontA } },
          ...runs(question.answer ?? '—', {
            fontFace: FONT.body,
            fontSize: plan.fontA,
            bold: true,
            color: T.teal700,
          }),
        ],
        { x: TEXT_X, y: row.y + row.qh, w: textW, h: row.answerH, valign: 'top' },
      )
    }
  })
  setNotes(slide, s, gabarito)
}

// ----------------------------------------------------------------------- tip
/**
 * DICA — cartão de lavagem âmbar ocupando a banda e foto em coluna alta no
 * contra-lado da câmera.
 *
 * Única composição (spec §7-ter.1). A variante do cartão FLUTUANDO sobre a foto
 * de fundo perdia as duas coisas: a foto ficava escondida atrás do cartão e o
 * cartão perdia a lavagem âmbar, que é o sinal de "dica" na gramática de cor.
 * A variante só-texto descartava a foto aprovada. Esta é a que o M5A1 já usava
 * no deck de 29 slides inspecionado.
 */
const tip: RV<'tip'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, { eyebrow: 'GOOD TO KNOW', title: s.title ?? 'Travel tip' })
  const hasPhoto = temImagem(doc, s.image?.file)
  const LABEL_H = 0.34
  const cardTop = BODY_Y + 0.24
  const maxH = BODY_BOTTOM - cardTop
  /**
   * O cartão da dica OCUPA a banda (defeito 9): o portão visual achou o tip
   * terminando a 73% da altura, com o terço de baixo vazio. Em vez de medir o
   * texto e parar onde ele acaba, o cartão vai até a borda do corpo e a FONTE
   * cresce para preencher — o texto fica no tamanho da área, não do parágrafo.
   */
  const fillFont = (w: number, sizes: number[]): number => {
    const room = maxH - LABEL_H - 0.44
    for (const font of sizes) {
      const lines = wrapLines(plain(s.text), charsPerLine(w - 0.5, font))
      if (lines * font * 0.0205 <= room) return font
    }
    return sizes[sizes.length - 1]
  }
  const label = (x: number, y: number, w: number): void => {
    slide.addText('TRAVEL TIP', {
      x,
      y,
      w,
      h: 0.24,
      fontFace: FONT.body,
      fontSize: 9.5,
      bold: true,
      charSpacing: 2,
      color: T.warn700,
    })
  }
  const { photo, text } = photoSplit(2.85)
  const card = hasPhoto ? text : { x: MX, w: CONTENT_W }
  const font = fillFont(card.w, hasPhoto ? [17, 15.5, 14, 13, 12] : [22, 20, 18, 16.5, 15, 14])
  slide.addShape('roundRect', {
    x: card.x,
    y: cardTop,
    w: card.w,
    h: maxH,
    rectRadius: 0.1,
    fill: { color: T.warnWash },
    line: { color: T.warnWashLine, width: 1 },
    shadow: cardShadow(),
  })
  label(card.x + 0.28, cardTop + 0.22, card.w - 0.56)
  slide.addText(runs(s.text, { fontFace: FONT.body, fontSize: font, color: T.ink900 }), {
    x: card.x + 0.28,
    y: cardTop + 0.22 + LABEL_H,
    w: card.w - 0.56,
    h: maxH - LABEL_H - 0.44,
    valign: 'middle',
    // com a dica no teto do contrato (600 caracteres) nem a menor fonte da
    // escada cabe: quem cede é o texto, nunca o cartão
    fit: 'shrink',
  })
  if (hasPhoto) framedImage(doc, slide, s.image!.file, photo.x, cardTop, photo.w, maxH)
  setNotes(slide, s)
}

// ------------------------------------------------------------------- section
// DIVISÓRIA DE PAPEL (Fase 0b, defeito 5). Era um slide NOTURNO com a foto do
// módulo sangrada e véu por cima: no M5A1 isso deu a escada rolante em roxo/teal
// neon que o dono já havia reprovado em julho. Instrução literal dele: a
// divisória tem de ser "genérica, com cores normais, indicando que é hora de
// praticar".
//
// Fase 0c (spec §7-ter.2, ajuste 12): o dono achou VAZIO na porção superior
// esquerda — o bloco de título ficava centrado na banda do corpo e o alto do
// slide era um buraco branco ao lado da câmera. A redistribuição mantém a
// facecam FIXA e move o resto:
//   · kicker + título + fio sobem para a MESMA faixa de cabeçalho dos outros 14
//     layouts (é a âncora de sinalização que a pesquisa 05 exige: o aluno
//     reconhece "onde as coisas ficam" mesmo quando o slide muda de função);
//   · a FOTO assume a coluna inteira à direita, do abaixo-da-câmera (BODY_Y) até
//     a margem inferior do corpo, alinhada ao mesmo rail da câmera;
//   · o subtítulo vira o bloco grande da esquerda, sobre a lavagem da marca, e
//     fecha a banda — nada de vazio acima do título nem ao lado dele.
//
// Degradações (nunca moldura vazia): sem subtítulo, a foto ocupa a banda inteira
// em faixa; sem foto, a lavagem ocupa a banda inteira com o subtítulo.

/**
 * Coluna da foto da divisória: mesmo rail da facecam — câmera em cima, foto
 * embaixo, e a foto sangra na borda daquele lado. Desalinhar por 0.5" (como
 * estava na Fase 0a) lê como descuido.
 */
function sectionPhotoCol(side: FacecamSide): { x: number; w: number } {
  return side === 'left'
    ? { x: 0, w: FACECAM_V2.m + FACECAM_V2.w }
    : { x: PAGE_W - FACECAM_V2.m - FACECAM_V2.w, w: FACECAM_V2.m + FACECAM_V2.w }
}

/** coluna de texto da divisória: o que sobra no contra-lado da foto */
function sectionTextCol(side: FacecamSide, photo: { x: number; w: number }): Box {
  const gap = 0.3
  return side === 'left'
    ? { x: photo.w + gap, w: PAGE_W - MX - photo.w - gap }
    : { x: MX, w: photo.x - gap - MX }
}

const section: RV<'section'> = (pres, doc, s) => {
  const hasPhoto = temImagem(doc, s.image?.file)
  const kicker = s.kicker ?? 'Practice time'
  // kicker que repete o título é ruído (o M5A1 tem título "PRACTICE TIME" e o
  // kicker padrão é "Practice time" — saíam os dois, um sobre o outro). A linha
  // do eyebrow continua existindo VAZIA: é ela que mantém o título na mesma
  // altura dos outros 14 layouts, que é o ponto do ajuste 12.
  const eyebrow =
    kicker.trim().toUpperCase() === plain(s.title).trim().toUpperCase() ? '' : kicker
  // o cabeçalho é o MESMO dos slides de conteúdo: eyebrow, título, fio, rodapé e
  // dock da câmera saem de `paperSlideV2` — a divisória deixa de ter geometria
  // própria no topo, que é o que produzia o vazio
  const slide = paperSlideV2(pres, doc, { eyebrow, title: s.title, big: true })
  const photo = sectionPhotoCol(FACECAM_SIDE)
  const text = sectionTextCol(FACECAM_SIDE, photo)
  const col = hasPhoto ? text : { x: MX, w: CONTENT_W }
  if (hasPhoto && !s.subtitle) {
    // sem texto na esquerda, a foto toma a banda inteira em vez de deixar meia
    // página branca
    bleedImage(doc, slide, s.image!.file, 0, BODY_Y, PAGE_W, BODY_BOTTOM - BODY_Y)
  } else if (hasPhoto) {
    bleedImage(doc, slide, s.image!.file, photo.x, BODY_Y, photo.w, BODY_BOTTOM - BODY_Y)
  }
  if (s.subtitle) {
    // o subtítulo é o bloco grande da banda, sobre a lavagem da marca: é ele que
    // diz o que vem no bloco de prática
    slide.addShape('roundRect', {
      x: col.x,
      y: BODY_Y,
      w: col.w,
      h: BODY_BOTTOM - BODY_Y,
      rectRadius: 0.12,
      fill: { color: T.brandWash },
      line: { color: T.brandWashLine, width: 1 },
    })
    const font = fitFont(plain(s.subtitle), col.w - 0.8, BODY_BOTTOM - BODY_Y, [26, 23, 20, 17, 15])
    slide.addText(runs(s.subtitle, { fontFace: FONT.display, fontSize: font, color: T.ink900 }), {
      x: col.x + 0.4,
      y: BODY_Y + 0.3,
      w: col.w - 0.8,
      h: BODY_BOTTOM - BODY_Y - 0.6,
      valign: 'middle',
      lineSpacingMultiple: 1.05,
      fit: 'shrink',
    })
  }
  setNotes(slide, s)
}

// ------------------------------------------------------------------- mission
/**
 * UMA FONTE PARA A LISTA INTEIRA (Fase 0d).
 *
 * O `planSteps` sempre devolveu UMA fonte para todos os passos — o defeito
 * estava aqui, no desenho. Cada passo saía numa caixa própria de altura
 * `linhas × lineH` com `fit: 'shrink'`, e a caixa NÃO descontava as margens
 * internas que o PowerPoint aplica por padrão (0.05" em cima + 0.05" embaixo,
 * 0.1" de cada lado). O rombo de 0.1" é o MESMO em toda caixa, mas o preço é
 * proporcional: numa caixa de 2 linhas ele custa 9% da altura, numa de 1 linha
 * custa 36%. Resultado: o `shrink` disparava caixa a caixa e o passo mais CURTO
 * derretia mais que os irmãos — no M5 real, "Send it to Teacher Vicky on WhatsApp" (1
 * linha) encolhia para ~2/3 do corpo dos passos 1 a 4 (2 linhas). Numa lista
 * numerada, isso lê como rodapé, e o passo 5 é o CTA da missão.
 *
 * A correção tem três partes, e as três são necessárias:
 *   1. `margin: 0` — a caixa passa a valer o que foi medido. Sem isso, a
 *      medida do plano é ficção;
 *   2. sem `fit: 'shrink'` — é a rede que, por ser POR CAIXA, destrói a
 *      uniformidade que o plano garante. A largura já tem rede na medida: o
 *      `wrapLines` conta a palavra maior que a linha pelas linhas que ela
 *      ocupa. Mesma doutrina do `fitFont` (a fonte é decidida na medição) e do
 *      gabarito do quiz ("o shrink do conversor derretia a letra");
 *   3. `lineSpacing` travado em `plan.lineH` — sem ele a entrelinha real sai da
 *      métrica do Hanken Grotesk (≈1.25 em), maior que o 1.24 do plano, e o
 *      texto vazaria por baixo agora que não há mais shrink. É também o que faz
 *      o PISO de entrelinha da paginação existir no papel, e não só na conta.
 *
 * Quando a lista não cabe, a degradação continua a do contrato: a fonte de
 * TODOS cai até o piso (9.5), depois a entrelinha comprime até
 * `STEP_LINE_FLOOR`, e o que sobrar vira um segundo slide. Nunca um passo com
 * corpo diferente dos irmãos.
 */
function drawSteps(
  slide: Slide,
  steps: string[],
  plan: StepsPlan,
  x: number,
  y: number,
  w: number,
  align: 'left' | 'center' = 'left',
  /** número do primeiro passo (a continuação segue a contagem) */
  first = 1,
): void {
  let cursor = y
  steps.slice(0, plan.fits).forEach((step, i) => {
    const h = plan.lines[i] * plan.lineH
    slide.addText(
      [
        { text: `${first + i}.  `, options: { bold: true, color: T.turquoise } },
        ...runs(step, { color: T.nightText }),
      ],
      {
        x,
        y: cursor,
        w,
        h,
        align,
        fontFace: FONT.body,
        // UMA fonte para a lista inteira: a do plano, medida pelo passo mais
        // exigente. Nada aqui pode reescalar UM passo (ver o bloco acima).
        fontSize: plan.font,
        valign: 'top',
        // a caixa vale exatamente o que foi medido: sem as margens internas
        // padrão do PowerPoint e com a entrelinha do plano
        margin: 0,
        lineSpacing: plan.lineH * 72,
      },
    )
    cursor += h + plan.gap
  })
}

/**
 * MISSÃO — cartaz noturno em duas colunas: título/briefing no contra-lado da
 * câmera, passos numerados na coluna sob ela.
 *
 * Única composição (spec §7-ter.1). A alternativa centrada empilhava kicker →
 * título → briefing → passos numa coluna só, e os passos herdavam o que sobrasse
 * embaixo: no M5 real eles começavam a 3.9" e tinham 1.3" para 5 passos, o que
 * disparava a quebra em dois slides. Em duas colunas os passos recebem a altura
 * INTEIRA do cartaz (3.2") e a missão cabe num slide, com fonte cheia.
 *
 * Sem foto: o contrato de `mission` não tem campo de imagem (decisão da Fase 0b
 * de não mexer no schema; "campo `image` opcional em mission" segue como item
 * futuro do dono).
 */
function missionSlide(
  pres: Pres,
  doc: LessonDoc,
  s: Extract<SlideSpec, { type: 'mission' }>,
  /** os passos DESTE slide (a continuação recebe o que sobrou) */
  steps: string[],
  /** número do primeiro passo deste slide */
  firstStep: number,
  /** plano dos passos, medido ANTES de o slide existir */
  sp: StepsPlan,
): void {
  const slide = pres.addSlide({ masterName: MASTER_V2.night })
  const cont = firstStep > 1
  const eyebrow = cont ? `Mission ${s.number} · continued` : `Mission ${s.number}`
  const TOP = BODY_Y
  const EYE_H = 0.3
  const STRIP_H = 0.035
  // O cartaz é desenhado de CIMA para BAIXO (ao contrário da capa): o que tem de
  // caber sem apertar são os PASSOS, e eles ficam no fim.
  const drawTop = (col: Box, room: number, sizes: number[], align: 'left' | 'center'): number => {
    slide.addText(eyebrow.toUpperCase(), {
      x: col.x,
      y: TOP,
      w: col.w,
      h: EYE_H,
      align,
      fontFace: FONT.body,
      fontSize: 11,
      bold: true,
      charSpacing: 3,
      color: T.turquoise,
    })
    const titleY = TOP + EYE_H + 0.04
    const plan = planTitle(plain(s.title), col.w, room, sizes)
    slide.addText(s.title, {
      x: col.x,
      y: titleY,
      w: col.w,
      h: plan.h,
      align,
      fontFace: FONT.display,
      fontSize: plan.font,
      bold: true,
      color: T.nightText,
      lineSpacingMultiple: 0.98,
      valign: 'top',
    })
    const stripW = 1.05
    const stripY = titleY + plan.h + 0.14
    slide.addImage({
      path: join(ASSETS, 'brand-strip.png'),
      x: align === 'center' ? col.x + (col.w - stripW) / 2 : col.x,
      y: stripY,
      w: stripW,
      h: STRIP_H,
    })
    return stripY + STRIP_H
  }
  const drawBriefing = (col: Box, y: number, font: number, align: 'left' | 'center'): number => {
    const { h } = planBriefing({ text: plain(s.briefing), w: col.w, font, y, bottom: NIGHT_BOTTOM })
    slide.addText(runs(s.briefing, { fontFace: FONT.body, fontSize: font, color: T.nightSub }), {
      x: col.x,
      y,
      w: col.w,
      h,
      align,
      valign: 'top',
    })
    return y + h
  }
  const text = { x: sideX(FAR_SIDE, MISSION_TEXT_W), w: MISSION_TEXT_W }
  const stepsCol = { x: sideX(FACECAM_SIDE, MISSION_STEPS_W), w: MISSION_STEPS_W }
  const afterTitle = drawTop(text, 1.05, [32, 28, 24, 21], 'left')
  // na continuação o briefing não repete: o espaço é dos passos que faltam
  if (!cont) drawBriefing(text, afterTitle + 0.2, 13, 'left')
  drawSteps(slide, steps, sp, stepsCol.x, centrarPassos(sp, TOP, NIGHT_BOTTOM), stepsCol.w, 'left', firstStep)
  setNotes(slide, s)
}

/** colunas do cartaz da missão — a medida dos passos acontece fora do desenho */
const MISSION_TEXT_W = 4.36
const MISSION_STEPS_W = CONTENT_W - MISSION_TEXT_W - COL_GAP

/**
 * OS PLANOS DE PASSOS DO CARTAZ — um por slide da missão, na MESMA medida que o
 * desenho usa. Quem quiser saber a geometria do cartaz antes de gerar o deck (o
 * `fit-check`) chama isto, nunca uma segunda conta: a razão de agrupamento que o
 * painel mostra é a razão que vai para o papel.
 *
 * Quando os passos não cabem nem no piso de entrelinha, a missão CONTINUA em
 * outro slide (spec §7-bis, defeito 3) — reduzir o número de passos visíveis
 * nunca é opção.
 *
 * O plano é medido ANTES de abrir o slide: se nem UM passo couber na coluna,
 * isto estoura em vez de forçar (spec §7-ter.3, achado 16). Com o teto de 400
 * caracteres por passo do contrato isso é inalcançável — o pior passo legal
 * ocupa ~1.0" numa área de 3.2" —, e é justamente por isso que o teto e o fim
 * do "força a caber" andam juntos: um sem o outro seria fé.
 */
export function missionSteps(s: Extract<SlideSpec, { type: 'mission' }>): StepsPlan[] {
  const planos: StepsPlan[] = []
  let first = 1
  let resto = s.steps ?? []
  /**
   * O corpo é da LISTA, não da página. A primeira medida já enxerga TODOS os
   * passos que faltam, então ela é a exigente; daí em diante ela vira TETO para
   * as continuações. Sem esse teto, 4 passos no teto do contrato saíam 1–3 a
   * 9.5pt e o 4 sozinho a 14.5pt — o passo mais importante da missão em corpo
   * de rodapé, ou o contrário, mas nunca o de irmão (Fase 0d).
   */
  let teto: number | undefined
  do {
    // quem decide o respiro entre passos é o layout.ts (contrato AGRUPAMENTO)
    const sp = planSteps(resto, MISSION_STEPS_W, BODY_Y, NIGHT_BOTTOM, teto)
    teto = sp.font
    if (sp.fits < 1) {
      throw new RangeError(
        `missão ${s.number}: o passo ${first} não cabe na coluna de ${MISSION_STEPS_W}" nem no piso de entrelinha (${resto[0]?.length ?? 0} caracteres)`,
      )
    }
    planos.push(sp)
    first += sp.fits
    resto = resto.slice(sp.fits)
  } while (resto.length > 0)
  return planos
}

const mission: RV<'mission'> = (pres, doc, s) => {
  let first = 1
  let resto = s.steps ?? []
  for (const sp of missionSteps(s)) {
    missionSlide(pres, doc, s, resto, first, sp)
    first += sp.fits
    resto = resto.slice(sp.fits)
  }
}

// --------------------------------------------------------------------- recap
const recap: RV<'recap'> = (pres, doc, s) => {
  const slide = paperSlideV2(pres, doc, { eyebrow: 'RECAP', title: s.title ?? 'Today you learned' })
  const { twoCols, rows, grid, chip, font } = planRecap(s.items.length, BODY_Y + 0.18, BODY_BOTTOM)
  const colW = twoCols ? (CONTENT_W - COL_GAP) / 2 : CONTENT_W
  s.items.forEach((item, i) => {
    const c = Math.floor(i / rows)
    const r = i % rows
    const x = MX + c * (colW + COL_GAP)
    const y = grid.y0 + r * grid.step
    checkChip(slide, x, y + (grid.h - chip) / 2, chip)
    slide.addText(
      runs(item, { fontFace: FONT.body, fontSize: font, color: T.ink900 }),
      {
        x: x + chip + 0.12,
        y,
        w: colW - chip - 0.12,
        h: grid.h,
        valign: 'middle',
        fit: 'shrink',
      },
    )
  })
  setNotes(slide, s)
}

// ------------------------------------------------------------------- closing
const closing: RV<'closing'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER_V2.night })
  const headline = s.headline ?? 'Congratulations!'
  const col = { x: 0.7, w: 8.6 }
  // de cima para baixo, começando abaixo da faixa da facecam: manchete, fio,
  // mensagem, chip da próxima aula, logo
  const TOP = BODY_Y + 0.08
  const CHIP_Y = 3.98
  const plan = planClosing({
    headline: plain(headline),
    w: col.w,
    top: TOP,
    chipY: CHIP_Y,
    sizes: [40, 34, 29, 25],
  })
  slide.addText(headline, {
    x: col.x,
    y: TOP,
    w: col.w,
    h: plan.title.h,
    align: 'center',
    fontFace: FONT.display,
    fontSize: plan.title.font,
    bold: true,
    color: T.nightText,
    lineSpacingMultiple: 0.98,
    valign: 'top',
  })
  const stripW = 1.05
  slide.addImage({
    path: join(ASSETS, 'brand-strip.png'),
    x: col.x + (col.w - stripW) / 2,
    y: plan.stripY,
    w: stripW,
    h: 0.035,
  })
  if (s.message) {
    slide.addText(runs(s.message, { fontFace: FONT.body, fontSize: 13.5, color: T.nightSub }), {
      x: 1.5,
      y: plan.msgY,
      w: 7,
      h: plan.msgH,
      align: 'center',
      valign: 'top',
    })
  }
  if (s.nextClass) {
    slide.addText(
      [
        { text: 'NEXT CLASS   ', options: { bold: true, color: T.turquoise, fontSize: 10.5, charSpacing: 2 } },
        { text: s.nextClass, options: { bold: true, color: T.nightText, fontSize: 13 } },
      ],
      {
        shape: 'roundRect',
        rectRadius: 0.1,
        fill: { color: T.paper0, transparency: 90 },
        line: { color: T.turquoise, width: 1 },
        x: 1.7,
        y: CHIP_Y,
        w: 6.6,
        h: 0.58,
        align: 'center',
        valign: 'middle',
        fontFace: FONT.body,
        fit: 'shrink',
      },
    )
  }
  slide.addImage({
    path: LOGO_WHITE,
    x: (PAGE_W - LOGO_H * WORDMARK_RATIO) / 2,
    y: LOGO_Y,
    w: LOGO_H * WORDMARK_RATIO,
    h: LOGO_H,
  })
  setNotes(slide, s)
}

// ------------------------------------------------------------------ despacho
/**
 * Um tipo, um layout (spec §7-ter.1): não há mais escolha de composição, então
 * o despacho é só o `switch`. O deck continua reproduzível pelo mesmo motivo de
 * sempre — nada aqui depende de sorteio, data ou contador global.
 */
export function renderSlideV2(pres: Pres, doc: LessonDoc, spec: SlideSpec): void {
  switch (spec.type) {
    case 'cover':
      return cover(pres, doc, spec)
    case 'objectives':
      return objectives(pres, doc, spec)
    case 'warmup':
      return warmup(pres, doc, spec)
    case 'vocab':
      return vocab(pres, doc, spec)
    case 'grammar':
      return grammar(pres, doc, spec)
    case 'dialogue':
      return dialogue(pres, doc, spec)
    case 'listening': {
      listeningSlide(pres, doc, spec, 0)
      for (let k = 1; k <= revealCount(spec); k++) listeningSlide(pres, doc, spec, k)
      return
    }
    case 'speaking':
      return speaking(pres, doc, spec)
    case 'writing': {
      // cada nível de revelação repete TODAS as páginas do exercício (item 21):
      // a quebra é de geometria e não muda com o gabarito
      writingScreens(pres, doc, spec, 0)
      for (let k = 1; k <= revealCount(spec); k++) writingScreens(pres, doc, spec, k)
      return
    }
    case 'quiz': {
      // UMA tela de respostas com todas (defeito 7) — não uma por resposta
      quizSlide(pres, doc, spec, false)
      if (revealCount(spec) > 0) quizSlide(pres, doc, spec, true)
      return
    }
    case 'tip':
      return tip(pres, doc, spec)
    case 'section':
      return section(pres, doc, spec)
    case 'mission':
      return mission(pres, doc, spec)
    case 'recap':
      return recap(pres, doc, spec)
    case 'closing':
      return closing(pres, doc, spec)
  }
}
