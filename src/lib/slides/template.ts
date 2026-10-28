// M-Slides-1 — design system dos decks do Personal Travel (ADR-020).
// Tokens do Design.md: capa/divisórias/fechamento no tema NOTURNO das públicas
// (fog periwinkle/ciano + acentos), conteúdo em PAPEL & TINTA.
// Correções do piloto (20/07, feedback do mantenedor):
//  - FACECAM maior: 2.4"×1.35" (24% da largura, 16:9 = proporção da gravação),
//    topo esquerdo (não briga com as colunas de exercício à direita).
//  - Barras laterais (regra/tip) substituídas por cartões com LAVAGEM de cor
//    (a barra reta não acompanhava a curvatura do cartão).
//  - Check e números em círculo = PNGs (chips/) — glifo de texto em shape
//    descentraliza na conversão para o Google Slides.
//  - Chips do unscramble: wrap desligado + largura generosa + quebra por chip.
//  - Slides de GABARITO automáticos após listening/writing/quiz (a seta da
//    apresentação "preenche" as respostas — animação por elemento não é
//    suportada por geração programática).
import type PptxGenJS from 'pptxgenjs'
import { join } from 'node:path'
import { pastaDeMarca } from '../pastas.ts'
import type { LessonDoc, SlideSpec } from './lesson-schema.ts'
import {
  ancoraDaCapa,
  fitFont,
  fitStep,
  planCover,
  planGrammar,
  planMission,
  planPhotoCrop,
  planWriting,
} from './layout.ts'
import { imageSize } from './image-size.ts'

export type Pres = InstanceType<typeof PptxGenJS>
export type Slide = ReturnType<Pres['addSlide']>

// ------------------------------------------------------------------- tokens
export const T = {
  paper0: 'FFFFFF',
  paper50: 'F7F7FB',
  paper100: 'EFEFF6',
  hairline: 'E3E1EC',
  box: 'D6D3E0', // borda de caixa de resposta (a Teacher Vicky digita nelas ao vivo)
  ink900: '17141F',
  ink600: '4C4859',
  ink400: '6D6878',
  brand700: '7E36A3',
  brand600: '9333C9',
  brandWash: 'F4EBFA', // lavagem roxa (cartão de regra)
  brandWashLine: 'E3D0F2',
  teal700: '0B7A70',
  teal600: '0F9488',
  tealWash: 'E4F4F2',
  ok700: '1A7F37',
  warn700: 'B3550E',
  warnWash: 'FBF1E3', // lavagem âmbar (travel tip)
  warnWashLine: 'F0DCC0',
  danger700: 'B32441',
  night: '0A0A0F',
  nightText: 'FAF9F5',
  nightSub: 'C6C4E4', // texto secundário sobre fog
  turquoise: '2BD9D9',
} as const

export const FONT = {
  display: 'Bricolage Grotesque',
  body: 'Hanken Grotesk',
  mono: 'JetBrains Mono',
} as const

// -------------------------------------------------------------- geometria
// página 16:9 = 10 × 5.625 in
const MX = 0.42
// facecam 16:9 (mesma proporção da gravação 1080p) — ~24% da largura
const FACECAM = { x: 0.38, y: 0.38, w: 2.4, h: 1.35 }
const HEAD_X = FACECAM.x + FACECAM.w + 0.28 // 3.06
const BODY_Y = 1.98
const BODY_BOTTOM = 5.06
const CONTENT_W = 10 - 2 * MX

// NOTA (Template v2, 24/07): daqui para baixo vários helpers e caminhos ganharam
// `export` para o `template-v2.ts` REUSAR em vez de reimplementar (chips PNG,
// caixa de resposta, notas, sombra de cartão, logos). É diff ADITIVO: nenhum
// comportamento do v1 muda, e o v1 segue servindo o botão "Gerar deck" da Teacher Vicky.
const MARCA = pastaDeMarca()
export const ASSETS = join(MARCA, 'slides', 'assets')
export const CHIPS = join(ASSETS, 'chips')
export const LOGO_DIR = join(MARCA, 'logos')
export const LOGO_WHITE = join(LOGO_DIR, 'Logo Personal Teacher - Fundo Transparente - Branco.png')
export const SYMBOL_BLACK = join(LOGO_DIR, 'Logo Personal Teacher - Símbolo Preto - Fundo Transparente.png')
export const WORDMARK_RATIO = 4657 / 2226 // arquivo é recortado justo

export const MASTER = {
  paper: 'PT_PAPER',
  cover: 'PT_NIGHT_COVER',
  section: 'PT_NIGHT_SECTION',
  closing: 'PT_NIGHT_CLOSING',
} as const

export function defineMasters(pres: Pres): void {
  const fio = { image: { x: 0, y: 5.593, w: 10, h: 0.032, path: join(ASSETS, 'brand-strip.png') } }
  pres.defineSlideMaster({
    title: MASTER.paper,
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
  for (const [title, file] of [
    [MASTER.cover, 'fog-cover.jpg'],
    [MASTER.section, 'fog-section.jpg'],
    [MASTER.closing, 'fog-closing.jpg'],
  ] as const) {
    pres.defineSlideMaster({ title, background: { path: join(ASSETS, file) }, objects: [fio] })
  }
}

// ------------------------------------------------- marcadores inline → runs
// **negrito** · {{roxo-marca}} · [[teal]] · __sublinhado__
type RunOpts = Record<string, unknown>
export type Run = { text: string; options?: RunOpts }
const MARK = /(\*\*[^*]+\*\*|\{\{[^}]+\}\}|\[\[[^\]]+\]\]|__[^_]+__)/g

export function runs(s: string, base: RunOpts = {}): Run[] {
  const out: Run[] = []
  for (const part of s.split(MARK)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      out.push({ text: part.slice(2, -2), options: { ...base, bold: true } })
    } else if (part.startsWith('{{') && part.endsWith('}}')) {
      out.push({ text: part.slice(2, -2), options: { ...base, bold: true, color: T.brand700 } })
    } else if (part.startsWith('[[') && part.endsWith(']]')) {
      out.push({ text: part.slice(2, -2), options: { ...base, bold: true, color: T.teal700 } })
    } else if (part.startsWith('__') && part.endsWith('__')) {
      out.push({ text: part.slice(2, -2), options: { ...base, underline: { style: 'sng' as const } } })
    } else {
      out.push({ text: part, options: { ...base } })
    }
  }
  return out
}

export function plain(s: string): string {
  return s.replace(MARK, (m) => m.slice(2, -2))
}

const estLines = (s: string, charsPerLine: number): number =>
  Math.max(1, Math.ceil(plain(s).length / charsPerLine))

// ------------------------------------------------------------------ helpers
const KOLB_LABEL: Record<string, string> = {
  concrete: 'Concrete Experience (viver/sentir)',
  reflective: 'Reflective Observation (observar/refletir)',
  abstract: 'Abstract Conceptualization (conceituar)',
  active: 'Active Experimentation (praticar)',
}

export function setNotes(slide: Slide, spec: SlideSpec, gabarito: string[] = []): void {
  const parts: string[] = []
  if (spec.kolb?.length) parts.push(`[KOLB] ${spec.kolb.map((k) => KOLB_LABEL[k]).join(' · ')}`)
  if (gabarito.length) parts.push(`[GABARITO]\n${gabarito.join('\n')}`)
  if (spec.notes) parts.push(`[ROTEIRO] ${spec.notes}`)
  if (parts.length) slide.addNotes(parts.join('\n\n'))
}

// ATENÇÃO: o pptxgenjs MUTA o objeto de sombra ao converter unidades — um
// objeto compartilhado degrada a cada uso (sombras gigantes nos slides
// seguintes). Por isso é uma FUNÇÃO que devolve um objeto novo por chamada.
export const cardShadow = () => ({
  type: 'outer' as const,
  color: '17141F',
  opacity: 0.1,
  blur: 6,
  offset: 2,
  angle: 90,
})

type PaperHeader = { eyebrow: string; title: string; rightNote?: string; rightNoteColor?: string }

function paperSlide(pres: Pres, doc: LessonDoc, head: PaperHeader): Slide {
  const slide = pres.addSlide({ masterName: MASTER.paper })
  // dock da facecam — a câmera da Teacher Vicky cobre esta área na gravação (16:9)
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
  slide.addText(head.eyebrow.toUpperCase(), {
    x: HEAD_X,
    y: 0.46,
    w: 10 - HEAD_X - MX,
    h: 0.26,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    charSpacing: 2,
    color: T.brand700,
  })
  slide.addText(head.title, {
    x: HEAD_X,
    y: 0.7,
    w: 10 - HEAD_X - MX,
    h: 0.6,
    fontFace: FONT.display,
    fontSize: 22,
    bold: true,
    color: T.ink900,
    fit: 'shrink',
    valign: 'middle',
  })
  slide.addImage({ path: join(ASSETS, 'brand-strip.png'), x: HEAD_X, y: 1.42, w: 0.85, h: 0.032 })
  if (head.rightNote) {
    slide.addText(head.rightNote.toUpperCase(), {
      x: 6.9,
      y: 0.46,
      w: 2.68,
      h: 0.26,
      align: 'right',
      fontFace: FONT.body,
      fontSize: 9.5,
      bold: true,
      charSpacing: 1.5,
      color: head.rightNoteColor ?? T.brand700,
    })
  }
  // rodapé: contexto do curso + símbolo
  slide.addText(`PERSONAL TRAVEL — MODULE ${doc.module.number} · ${doc.module.title.toUpperCase()}`, {
    x: MX,
    y: 5.28,
    w: 6.4,
    h: 0.22,
    fontFace: FONT.body,
    fontSize: 8,
    charSpacing: 1.5,
    color: T.ink400,
  })
  slide.addImage({ path: SYMBOL_BLACK, x: 9.04, y: 5.285, w: 0.19, h: 0.19, transparency: 78 })
  return slide
}

function nightEyebrow(slide: Slide, text: string, y: number): void {
  slide.addText(text.toUpperCase(), {
    x: 0.7,
    y,
    w: 8.6,
    h: 0.3,
    align: 'center',
    fontFace: FONT.body,
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: T.turquoise,
  })
}

// biblioteca curada de imagens (doc 03 §6; Lei 11 — sem texto dentro da imagem)
const LIBRARY = join(ASSETS, '..', 'library')

/**
 * IM-2/M1 — onde cada endereço de imagem foi resolvido nesta renderização.
 *
 * O motor é síncrono e `renderSlide` distribui para quinze funções; enfiar o
 * mapa como parâmetro em todas seria um diff enorme para nada. Ele fica preso
 * ao `doc` — que já é passado em todo lugar — em vez de virar variável de
 * módulo: assim dois decks renderizando ao mesmo tempo no servidor não
 * disputam o mesmo estado.
 *
 * Sem mapa, cai na biblioteca do disco. É o caminho da CLI e das 33 fotos já
 * commitadas, que continuam funcionando sem banco nem rede.
 */
const IMAGENS_RESOLVIDAS = new WeakMap<LessonDoc, ReadonlyMap<string, string>>()

export function usarImagensResolvidas(doc: LessonDoc, mapa: ReadonlyMap<string, string>): void {
  IMAGENS_RESOLVIDAS.set(doc, mapa)
}

/** de onde sai o arquivo deste endereço nesta renderização */
export function caminhoDaImagem(doc: LessonDoc, file: string): string {
  return IMAGENS_RESOLVIDAS.get(doc)?.get(file) ?? join(LIBRARY, file)
}

/** onde o recorte da foto se ancara verticalmente */
export type AncoraFoto = 'centro' | 'capa'

/**
 * FOTO RECORTADA DE VERDADE (`object-fit: cover`).
 *
 * O `sizing: {type:'cover'}` do pptxgenjs é NO-OP sob Node: sem `Image` do
 * navegador ele usa o tamanho da CAIXA como tamanho da imagem (`imgWidth = cx`
 * em `pptxgen.cjs.js`), a proporção bate consigo mesma e o recorte calculado é
 * sempre `l=r=t=b=0`. O `<a:stretch/>` que sobra ESTICA a foto até a caixa —
 * é o que está em todos os decks do lote (`<a:srcRect l="0" r="0" t="0"
 * b="0"/>`), e o que deforma 2,65× as nove capas em retrato.
 *
 * O conserto informa ao pptxgenjs o tamanho natural na escala do recorte: com
 * `w = caixa/visívelX` e `h = caixa/visívelY`, a conta do `type: 'crop'` cai
 * exatamente nos percentuais que a gente quer, e a biblioteca reescreve a
 * extensão do shape para a caixa verdadeira logo em seguida. A geometria vem
 * do planejador puro (`planPhotoCrop`); aqui só se traduz para a API.
 *
 * Sem conseguir medir o arquivo (formato exótico, imagem remota), degrada para
 * o caminho antigo — nenhum deck quebra por causa de uma foto que não dá para
 * medir.
 */
export function coverImage(
  doc: LessonDoc,
  slide: Slide,
  file: string,
  x: number,
  y: number,
  w: number,
  h: number,
  ancora: AncoraFoto = 'centro',
): void {
  const path = caminhoDaImagem(doc, file)
  const img = imageSize(path)
  if (!img) {
    slide.addImage({ path, x, y, w, h, sizing: { type: 'cover', w, h } })
    return
  }
  const box = { w, h }
  const crop = planPhotoCrop(img, box, { y: ancora === 'capa' ? ancoraDaCapa(img, box) : 0.5 })
  const naturalW = w / (1 - crop.l - crop.r)
  const naturalH = h / (1 - crop.t - crop.b)
  slide.addImage({
    path,
    x,
    y,
    w: naturalW,
    h: naturalH,
    sizing: { type: 'crop', x: crop.l * naturalW, y: crop.t * naturalH, w, h },
  })
}

export function framedImage(doc: LessonDoc, slide: Slide, file: string, x: number, y: number, w: number, h: number, caption?: string): void {
  coverImage(doc, slide, file, x, y, w, h)
  slide.addShape('rect', { x, y, w, h, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: T.hairline, width: 1 } })
  if (caption) {
    slide.addText(caption, {
      x,
      y: y + h + 0.04,
      w,
      h: 0.22,
      align: 'center',
      fontFace: FONT.body,
      fontSize: 8.5,
      italic: true,
      color: T.ink400,
    })
  }
}

export function checkChip(slide: Slide, x: number, y: number, size = 0.34): void {
  slide.addImage({ path: join(CHIPS, 'chip-check.png'), x, y, w: size, h: size })
}

export function numChip(slide: Slide, x: number, y: number, n: number, size = 0.3): void {
  if (n >= 1 && n <= 9) {
    slide.addImage({ path: join(CHIPS, `chip-${n}.png`), x, y, w: size, h: size })
  } else {
    slide.addText(`${n}.`, {
      x,
      y,
      w: size + 0.1,
      h: size,
      fontFace: FONT.body,
      fontSize: 12,
      bold: true,
      color: T.ink900,
      valign: 'middle',
    })
  }
}

export function checkboxRow(slide: Slide, x: number, y: number, w: number, label: string, checked = false): void {
  slide.addShape('roundRect', {
    x,
    y: y + 0.05,
    w: 0.26,
    h: 0.26,
    rectRadius: 0.04,
    fill: { color: T.paper0 },
    line: { color: T.box, width: 1.25 },
  })
  if (checked) checkChip(slide, x + 0.02, y + 0.07, 0.22)
  slide.addText(runs(label, { fontFace: FONT.body, fontSize: 12.5, color: T.ink900 }), {
    x: x + 0.4,
    y,
    w: w - 0.4,
    h: 0.38,
    valign: 'middle',
  })
}

export function answerBox(slide: Slide, x: number, y: number, w: number, h: number, answer?: string): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.05,
    fill: { color: T.paper0 },
    line: { color: T.box, width: 1.25 },
  })
  if (answer) {
    slide.addText(answer, {
      x: x + 0.06,
      y,
      w: w - 0.12,
      h,
      fontFace: FONT.body,
      fontSize: 12.5,
      bold: true,
      color: T.teal700,
      valign: 'middle',
      fit: 'shrink',
    })
  }
}

// ---------------------------------------------------------------- layouts
type R<K extends SlideSpec['type']> = (
  pres: Pres,
  doc: LessonDoc,
  s: Extract<SlideSpec, { type: K }>
) => void

const cover: R<'cover'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER.cover })
  slide.addText(`PERSONAL TRAVEL · MODULE ${doc.module.number} · LESSON ${doc.lesson.number}`, {
    x: 0.55,
    y: 1.26,
    w: 8.9,
    h: 0.3,
    fontFace: FONT.body,
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: T.turquoise,
  })
  const title = s.title ?? doc.lesson.title
  const cov = planCover(plain(title), Boolean(s.image))
  slide.addText(title, {
    x: 0.53,
    y: cov.titleY,
    w: s.image ? 6.55 : 8.0,
    h: cov.titleH,
    fontFace: FONT.display,
    fontSize: cov.titleFont,
    bold: true,
    color: T.nightText,
    lineSpacingMultiple: 0.98,
    valign: 'top',
  })
  if (s.image) framedImage(doc, slide, s.image.file, 7.42, 1.42, 2.1, 3.1)
  slide.addImage({ path: join(ASSETS, 'brand-strip.png'), x: 0.56, y: cov.stripY, w: 1.05, h: 0.035 })
  const subtitle = s.subtitle ?? doc.lesson.subtitle
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.55,
      y: cov.subtitleY,
      w: 7.4,
      h: 0.6,
      fontFace: FONT.body,
      fontSize: 13.5,
      color: T.nightSub,
    })
  }
  slide.addImage({ path: LOGO_WHITE, x: 0.55, y: 4.84, w: 0.35 * WORDMARK_RATIO, h: 0.35 })
  setNotes(slide, s)
}

const objectives: R<'objectives'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: "TODAY'S GOALS", title: s.title ?? 'Today you will…' })
  s.items.forEach((item, i) => {
    const y = BODY_Y + 0.12 + i * fitStep(BODY_Y + 0.12, s.items.length, 0.56, 0.5)
    checkChip(slide, 0.52, y + 0.03, 0.34)
    slide.addText(runs(item, { fontFace: FONT.body, fontSize: 14, color: T.ink900 }), {
      x: 1.02,
      y,
      w: 8.4,
      h: 0.42,
      valign: 'middle',
    })
  })
  setNotes(slide, s)
}

const warmup: R<'warmup'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'WARM UP', title: s.title ?? "Let's get started" })
  slide.addText(runs(s.prompt, { fontFace: FONT.body, fontSize: 13.5, color: T.ink900 }), {
    shape: 'roundRect',
    rectRadius: 0.07,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    x: MX,
    y: BODY_Y,
    w: CONTENT_W,
    h: 0.7,
    margin: 0.14,
    valign: 'middle',
  })
  if (s.items?.length) {
    // com imagem: itens em 1 coluna à esquerda, foto emoldurada à direita;
    // passo comprimido para nunca invadir o rodapé
    const half = s.image ? s.items.length : Math.ceil(s.items.length / 2)
    const step = s.image ? Math.min(0.45, 2.14 / Math.max(1, s.items.length - 1)) : 0.45
    s.items.forEach((item, i) => {
      const col = i < half ? 0 : 1
      const row = i < half ? i : i - half
      checkboxRow(slide, col === 0 ? 0.52 : 5.12, BODY_Y + 0.92 + row * step, 4.3, item)
    })
  }
  if (s.image) {
    framedImage(doc, slide, s.image.file, 5.3, BODY_Y + 0.92, 4.28, 2.62, s.image.caption)
  }
  setNotes(slide, s)
}

const vocab: R<'vocab'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, {
    eyebrow: 'VOCABULARY',
    title: s.title,
    rightNote: `▶ ${s.drillHint ?? 'Listen & repeat'}`,
  })
  let y0 = BODY_Y
  if (s.intro) {
    slide.addText(runs(s.intro, { fontFace: FONT.body, fontSize: 12, italic: true, color: T.ink600 }), {
      x: MX,
      y: BODY_Y - 0.04,
      w: CONTENT_W,
      h: 0.3,
    })
    y0 = BODY_Y + 0.34
  }
  const n = s.cards.length
  const cols = n > 6 ? 4 : n > 4 ? 3 : n
  const rows = Math.ceil(n / cols)
  const gap = 0.18
  const cardW = (CONTENT_W - (cols - 1) * gap) / cols
  const cardH = Math.min(1.32, (BODY_BOTTOM - y0 - (rows - 1) * 0.14) / rows)
  s.cards.forEach((card, i) => {
    const cx = MX + (i % cols) * (cardW + gap)
    const cy = y0 + Math.floor(i / cols) * (cardH + 0.14)
    slide.addShape('roundRect', {
      x: cx,
      y: cy,
      w: cardW,
      h: cardH,
      rectRadius: 0.07,
      fill: { color: T.paper0 },
      line: { color: T.hairline, width: 1 },
      shadow: cardShadow(),
    })
    const hasCue = Boolean(card.cue)
    if (card.image) {
      // foto no topo do card (associação palavra-imagem); textos comprimidos
      const imgH = cardH * 0.46
      framedImage(doc, slide, card.image, cx + 0.05, cy + 0.05, cardW - 0.1, imgH)
      slide.addText(card.term, {
        x: cx,
        y: cy + imgH + 0.09,
        w: cardW,
        h: 0.26,
        align: 'center',
        fontFace: FONT.display,
        fontSize: 12.5,
        bold: true,
        color: T.ink900,
        fit: 'shrink',
      })
      if (card.cue) {
        slide.addText(card.cue, {
          x: cx,
          y: cy + imgH + 0.34,
          w: cardW,
          h: 0.16,
          align: 'center',
          fontFace: FONT.mono,
          fontSize: 7.5,
          color: T.teal700,
        })
      }
      slide.addText(card.pt, {
        x: cx,
        y: cy + cardH - 0.26,
        w: cardW,
        h: 0.22,
        align: 'center',
        fontFace: FONT.body,
        fontSize: 9.5,
        color: T.ink600,
        fit: 'shrink',
      })
      return
    }
    slide.addText(card.term, {
      x: cx,
      y: cy + cardH * (hasCue ? 0.1 : 0.18),
      w: cardW,
      h: 0.34,
      align: 'center',
      fontFace: FONT.display,
      fontSize: 14.5,
      bold: true,
      color: T.ink900,
      fit: 'shrink',
    })
    if (card.cue) {
      slide.addText(card.cue, {
        x: cx,
        y: cy + cardH * 0.44,
        w: cardW,
        h: 0.24,
        align: 'center',
        fontFace: FONT.mono,
        fontSize: 8.5,
        color: T.teal700,
      })
    }
    slide.addText(card.pt, {
      x: cx,
      y: cy + cardH * (hasCue ? 0.68 : 0.55),
      w: cardW,
      h: 0.28,
      align: 'center',
      fontFace: FONT.body,
      fontSize: 10.5,
      color: T.ink600,
      fit: 'shrink',
    })
  })
  setNotes(slide, s)
}

const grammar: R<'grammar'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'GRAMMAR SPOTLIGHT', title: s.title })
  // Alturas medidas ANTES de desenhar: regra longa + tabela cheia estouravam
  // a borda inferior (1º deck do M6A1).
  const plan = planGrammar({
    rule: plain(s.rule),
    tableHeaders: s.table?.headers,
    tableCells: s.table?.rows,
    examples: s.examples.map(plain),
    hasWatchOut: Boolean(s.watchOut),
  })
  slide.addText(runs(s.rule, { fontFace: FONT.body, fontSize: plan.ruleFont, color: T.ink900 }), {
    shape: 'roundRect',
    rectRadius: 0.07,
    fill: { color: T.brandWash },
    line: { color: T.brandWashLine, width: 1 },
    x: MX,
    y: BODY_Y,
    w: 4.42,
    h: plan.ruleH,
    margin: 0.16,
    valign: 'middle',
  })
  if (s.table) {
    const tw = 4.42
    slide.addTable(
      [
        s.table.headers.map((h) => ({
          text: h,
          options: { bold: true, color: T.ink600, fill: { color: T.paper100 }, fontSize: Math.max(9, plan.tableFont - 1) },
        })),
        ...s.table.rows.map((row) =>
          row.map((cell) => ({ text: cell, options: { color: T.ink900, fill: { color: T.paper0 }, fontSize: plan.tableFont } }))
        ),
      ],
      {
        x: MX,
        y: plan.tableY,
        w: tw,
        rowH: plan.tableRowH,
        colW: s.table.headers.map(() => tw / s.table!.headers.length),
        border: { type: 'solid', pt: 0.5, color: T.hairline },
        fontFace: FONT.body,
        valign: 'middle',
        margin: 0.05,
      }
    )
  }
  let y = BODY_Y + 0.06
  for (const ex of s.examples) {
    slide.addText(runs(ex, { fontFace: FONT.body, fontSize: plan.exampleFont, color: T.ink900 }), {
      x: 5.06,
      y,
      w: 4.52,
      h: Math.max(0.24, plan.exampleStep - 0.06),
      valign: 'top',
    })
    y += plan.exampleStep
  }
  if (s.watchOut) {
    slide.addText(
      [
        { text: '✗ ', options: { bold: true, color: T.danger700 } },
        { text: s.watchOut.wrong, options: { color: T.danger700, strike: true } },
        { text: '   ✓ ', options: { bold: true, color: T.ok700 } },
        { text: s.watchOut.right, options: { bold: true, color: T.ok700 } },
      ],
      {
        x: 5.06,
        y: plan.watchOutY,
        w: 4.52,
        h: plan.watchOutH,
        fontFace: FONT.body,
        fontSize: fitFont(plain(s.watchOut.wrong) + plain(s.watchOut.right) + '     ', 4.52, plan.watchOutH, [12, 11, 10]),
        valign: 'middle',
      }
    )
  }
  setNotes(slide, s)
}

const dialogue: R<'dialogue'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'READING · DIALOGUE', title: s.title })
  let y0 = BODY_Y + 0.06
  if (s.context) {
    slide.addText(runs(s.context, { fontFace: FONT.body, fontSize: 11.5, italic: true, color: T.ink600 }), {
      x: MX,
      y: BODY_Y - 0.04,
      w: 5.9,
      h: 0.3,
    })
    y0 = BODY_Y + 0.36
  }
  // passo comprimido quando há muitas falas, para nunca invadir o rodapé
  const step = Math.min(0.54, (BODY_BOTTOM - y0 - 0.46) / Math.max(1, s.lines.length - 1))
  const bubbleH = Math.min(0.46, step - 0.03)
  s.lines.forEach((line, i) => {
    const isA = i % 2 === 0
    slide.addText(
      [
        { text: `${line.speaker}   `, options: { bold: true, color: isA ? T.brand700 : T.teal700, fontSize: 10.5 } },
        ...runs(line.text, { fontFace: FONT.body, fontSize: 12.5, color: T.ink900 }),
      ],
      {
        shape: 'roundRect',
        rectRadius: 0.08,
        fill: { color: isA ? T.paper100 : T.tealWash },
        x: isA ? MX : 0.98,
        y: y0 + i * step,
        w: 5.35,
        h: bubbleH,
        margin: 0.1,
        valign: 'middle',
        fontFace: FONT.body,
      }
    )
  })
  if (s.glossary?.length) {
    const gh = Math.min(3.0, 0.52 + s.glossary.length * 0.38)
    slide.addShape('roundRect', {
      x: 6.5,
      y: y0,
      w: 3.08,
      h: gh,
      rectRadius: 0.07,
      fill: { color: T.paper0 },
      line: { color: T.hairline, width: 1 },
      shadow: cardShadow(),
    })
    slide.addText('GLOSSARY', {
      x: 6.68,
      y: y0 + 0.14,
      w: 2.7,
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
        { x: 6.68, y: y0 + 0.42 + i * 0.38, w: 2.78, h: 0.34, fontFace: FONT.body, fontSize: 10.5, valign: 'middle' }
      )
    })
  } else if (s.image) {
    framedImage(doc, slide, s.image.file, 6.5, y0, 3.08, 2.7, s.image.caption)
  }
  setNotes(slide, s)
}

function listeningSlide(pres: Pres, doc: LessonDoc, s: Extract<SlideSpec, { type: 'listening' }>, revealUpTo: number): void {
  const total = (s.items ?? []).filter((i) => i.correct === true).length
  const slide = paperSlide(pres, doc, {
    eyebrow: revealUpTo > 0 ? 'LISTENING · ANSWERS' : 'LISTENING COMPREHENSION',
    title: s.title ?? 'Watch and listen',
    rightNote: revealUpTo > 0 ? `✓ Answers ${revealUpTo}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  slide.addShape('roundRect', {
    x: MX,
    y: BODY_Y,
    w: 4.3,
    h: 2.2,
    rectRadius: 0.09,
    fill: { color: T.ink900 },
    shadow: cardShadow(),
  })
  slide.addText('▶', {
    shape: 'ellipse',
    x: 2.26,
    y: BODY_Y + 0.79,
    w: 0.62,
    h: 0.62,
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
        { text: s.videoUrl, options: { color: T.teal700, underline: { style: 'sng' as const }, hyperlink: { url: s.videoUrl } } },
        ...(s.excerpt ? [{ text: `  ▶ ${s.excerpt.start}–${s.excerpt.end}`, options: { color: T.ink400, bold: true } }] : []),
      ]
    : [{ text: s.videoHint ?? '► Teacher Vicky: inserir o vídeo aqui (Inserir → Vídeo)', options: { italic: true, color: T.ink400 } }]
  slide.addText(chipText, {
    shape: 'roundRect',
    rectRadius: 0.06,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    x: MX,
    y: BODY_Y + 2.34,
    w: 4.3,
    h: 0.44,
    margin: 0.1,
    valign: 'middle',
    fontFace: FONT.body,
    fontSize: 9.5,
    fit: 'shrink',
  })
  // altura do cartão acompanha a contagem de itens (7+ itens: linhas mais
  // compactas para caber dentro de BODY_BOTTOM)
  const nItems = s.items?.length ?? 0
  const rowH = nItems >= 7 ? 0.31 : 0.36
  const cardH = Math.min(3.08, Math.max(2.92, 0.74 + nItems * rowH + 0.14))
  slide.addShape('roundRect', {
    x: 4.94,
    y: BODY_Y,
    w: 4.64,
    h: cardH,
    rectRadius: 0.09,
    fill: { color: T.paper0 },
    line: { color: T.hairline, width: 1 },
    shadow: cardShadow(),
  })
  slide.addText(runs(s.task, { fontFace: FONT.body, fontSize: 12.5, color: T.ink900 }), {
    x: 5.12,
    y: BODY_Y + 0.14,
    w: 4.3,
    h: 0.56,
  })
  let ordinal = 0
  s.items?.forEach((item, i) => {
    if (item.correct === true) ordinal += 1
    const checked = item.correct === true && ordinal <= revealUpTo
    checkboxRow(slide, 5.12, BODY_Y + 0.74 + i * rowH, 4.3, item.text, checked)
  })
  setNotes(slide, s, s.answers ? [s.answers] : [])
}

const speaking: R<'speaking'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'SPEAKING · PRONUNCIATION', title: s.title ?? 'Repeat after me' })
  slide.addText(runs(s.instruction, { fontFace: FONT.body, fontSize: 12.5, color: T.ink600 }), {
    x: MX,
    y: BODY_Y - 0.04,
    w: CONTENT_W,
    h: 0.32,
  })
  s.phrases.forEach((phrase, i) => {
    const y = BODY_Y + 0.34 + i * fitStep(BODY_Y + 0.34, s.phrases.length, 0.52, 0.46)
    slide.addText('SAY', {
      shape: 'roundRect',
      rectRadius: 0.06,
      x: 0.52,
      y: y + 0.06,
      w: 0.56,
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
    slide.addText(runs(phrase, { fontFace: FONT.body, fontSize: 14, color: T.ink900 }), {
      shape: 'roundRect',
      rectRadius: 0.07,
      fill: { color: T.paper0 },
      line: { color: T.hairline, width: 1 },
      x: 1.22,
      y,
      w: 8.36,
      h: 0.42,
      margin: 0.12,
      valign: 'middle',
    })
  })
  if (s.hint) {
    slide.addText(s.hint, {
      x: MX,
      y: 4.94,
      w: CONTENT_W,
      h: 0.22,
      fontFace: FONT.body,
      fontSize: 9.5,
      italic: true,
      color: T.ink400,
    })
  }
  setNotes(slide, s)
}

export const KIND_LABEL = { complete: 'COMPLETE', unscramble: 'UNSCRAMBLE', create: 'CREATE' } as const

function writingSlide(pres: Pres, doc: LessonDoc, s: Extract<SlideSpec, { type: 'writing' }>, revealUpTo: number): void {
  const total = s.exercises.reduce((n, ex) => n + ex.items.filter((i) => i.answer).length, 0)
  const slide = paperSlide(pres, doc, {
    eyebrow: revealUpTo > 0 ? 'WRITING · ANSWERS' : 'WRITING PRODUCTION',
    title: s.title ?? 'Your turn to write',
    rightNote: revealUpTo > 0 ? `✓ Answers ${revealUpTo}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  slide.addText(runs(s.instruction, { fontFace: FONT.body, fontSize: 12, color: T.ink600 }), {
    x: MX,
    y: BODY_Y - 0.04,
    w: CONTENT_W,
    h: 0.3,
  })

  // Quantas linhas de chips cada unscramble ocupa (mesma conta do desenho).
  const chipRowsOf = (exIdx: number, itemIdx: number): number => {
    const item = s.exercises[exIdx]?.items[itemIdx]
    if (!item) return 1
    let cx = 0.84
    let rows = 1
    for (const word of plain(item.prompt).split(' / ')) {
      const w = Math.max(0.44, 0.3 + word.length * 0.105)
      if (cx + w > 9.5) {
        cx = 0.84
        rows += 1
      }
      cx += w + 0.1
    }
    return rows
  }
  // Alturas medidas ANTES de desenhar: 2 exercícios estouravam o rodapé
  // (1º deck do M6A1). O plano comprime o espaçamento até caber.
  const plan = planWriting(s.exercises, chipRowsOf)

  const gabarito: string[] = []
  let itemNo = 0
  let answered = 0
  for (const b of plan.blocks) {
    const ex = s.exercises[b.ex]
    if (b.kind === 'label') {
      slide.addText(KIND_LABEL[ex.kind], {
        shape: 'roundRect',
        rectRadius: 0.05,
        x: MX,
        y: b.y,
        w: 1.16,
        h: Math.min(0.26, b.h - 0.06),
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
    const item = ex.items[b.item]
    itemNo += 1
    if (item.answer) {
      answered += 1
      gabarito.push(`${itemNo}. ${item.answer}`)
    }
    const show = Boolean(item.answer) && answered <= revealUpTo
    const chip = Math.min(0.3, b.h - 0.08)
    if (b.kind === 'complete') {
      numChip(slide, MX, b.y + (b.h - chip) / 2, itemNo, chip)
      slide.addText(runs(item.prompt, { fontFace: FONT.body, fontSize: plan.fontSize, color: T.ink900 }), {
        x: 0.84,
        y: b.y,
        w: 6.9,
        h: b.h - 0.06,
        valign: 'middle',
        fit: 'shrink',
      })
      answerBox(slide, 7.9, b.y + 0.02, 1.68, Math.min(0.36, b.h - 0.08), show ? item.answer : undefined)
    } else if (b.kind === 'unscramble') {
      numChip(slide, MX, b.y + 0.02, itemNo, chip)
      const chipStep = (b.h - 0.44 * plan.k) / Math.max(1, b.chipRows ?? 1)
      let cx = 0.84
      let row = 1
      for (const word of plain(item.prompt).split(' / ')) {
        const w = Math.max(0.44, 0.3 + word.length * 0.105)
        if (cx + w > 9.5) {
          cx = 0.84
          row += 1
        }
        slide.addText(word, {
          shape: 'roundRect',
          rectRadius: 0.05,
          x: cx,
          y: b.y + (row - 1) * chipStep,
          w,
          h: Math.min(0.3, chipStep - 0.04),
          fill: { color: T.paper100 },
          line: { color: T.hairline, width: 1 },
          color: T.ink900,
          fontFace: FONT.body,
          fontSize: plan.k < 0.85 ? 10 : 11,
          align: 'center',
          valign: 'middle',
          wrap: false,
          margin: 0.02,
        })
        cx += w + 0.1
      }
      const lineY = b.y + (b.chipRows ?? 1) * chipStep + 0.02
      answerBox(slide, 0.84, lineY, 8.74, Math.max(0.18, b.y + b.h - lineY - 0.04), show ? item.answer : undefined)
    } else {
      numChip(slide, MX, b.y + 0.02, itemNo, chip)
      slide.addText(runs(item.prompt, { fontFace: FONT.body, fontSize: plan.fontSize, color: T.ink900 }), {
        x: 0.84,
        y: b.y,
        w: 8.7,
        h: b.h * 0.42,
        valign: 'middle',
        fit: 'shrink',
      })
      answerBox(slide, 0.84, b.y + b.h * 0.46, 8.74, b.h * 0.44, show ? item.answer : undefined)
    }
  }
  setNotes(slide, s, gabarito)
}

function quizSlide(pres: Pres, doc: LessonDoc, s: Extract<SlideSpec, { type: 'quiz' }>, revealUpTo: number): void {
  const total = s.questions.filter((q) => q.answer).length
  const slide = paperSlide(pres, doc, {
    eyebrow: revealUpTo > 0 ? 'QUIZ · ANSWERS' : 'QUIZ',
    title: s.title ?? 'What do you do?',
    rightNote: revealUpTo > 0 ? `✓ Answers ${revealUpTo}/${total}` : undefined,
    rightNoteColor: T.teal700,
  })
  const gabarito: string[] = []
  if (revealUpTo > 0) {
    // gabarito compacto: número + resposta (a pergunta ficou no slide anterior)
    // cumulativo: cada seta revela uma resposta a mais
    s.questions.slice(0, revealUpTo).forEach((question, i) => {
      const y = BODY_Y + 0.16 + i * fitStep(BODY_Y + 0.16, revealUpTo, 0.52, 0.42)
      numChip(slide, MX, y + 0.04, i + 1)
      slide.addText(runs(question.answer ?? '—', { fontFace: FONT.body, fontSize: 13.5, bold: true, color: T.teal700 }), {
        x: 0.84,
        y,
        w: 8.7,
        h: 0.42,
        valign: 'middle',
      })
    })
    setNotes(slide, s)
    return
  }
  let y = BODY_Y
  if (s.intro) {
    slide.addText(runs(s.intro, { fontFace: FONT.body, fontSize: 12.5, color: T.ink600 }), {
      x: MX,
      y: BODY_Y - 0.04,
      w: CONTENT_W,
      h: 0.3,
    })
    y = BODY_Y + 0.36
  }
  // Alturas medidas antes: 6 perguntas longas passavam do rodapé.
  const qHeights = s.questions.map((q) => estLines(plain(q.q), 90) * 0.24 + 0.2)
  const need = qHeights.reduce((a, b) => a + b + 0.08, 0)
  const kq = need <= BODY_BOTTOM - y ? 1 : Math.max(0.62, (BODY_BOTTOM - y) / need)
  s.questions.forEach((question, i) => {
    if (question.answer) gabarito.push(`${i + 1}. ${question.answer}`)
    const h = qHeights[i] * kq
    numChip(slide, MX, y + 0.03, i + 1, Math.min(0.3, h - 0.06))
    slide.addText(runs(question.q, { fontFace: FONT.body, fontSize: kq < 0.85 ? 11.5 : 12.5, color: T.ink900 }), {
      x: 0.84,
      y,
      w: 8.7,
      h,
      valign: 'top',
      fit: 'shrink',
    })
    y += h + 0.08 * kq
  })
  setNotes(slide, s, gabarito)
}

const tip: R<'tip'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'GOOD TO KNOW', title: s.title ?? 'Travel tip' })
  const h = Math.max(1.5, estLines(s.text, 78) * 0.3 + 0.75)
  // cartão com lavagem âmbar (sem barra lateral)
  slide.addShape('roundRect', {
    x: MX,
    y: BODY_Y + 0.28,
    w: CONTENT_W,
    h,
    rectRadius: 0.09,
    fill: { color: T.warnWash },
    line: { color: T.warnWashLine, width: 1 },
    shadow: cardShadow(),
  })
  slide.addText('TRAVEL TIP', {
    x: 0.74,
    y: BODY_Y + 0.48,
    w: 3,
    h: 0.24,
    fontFace: FONT.body,
    fontSize: 9.5,
    bold: true,
    charSpacing: 2,
    color: T.warn700,
  })
  slide.addText(runs(s.text, { fontFace: FONT.body, fontSize: 13.5, color: T.ink900 }), {
    x: 0.74,
    y: BODY_Y + 0.8,
    w: s.image ? 6.0 : 8.55,
    h: h - 0.62,
  })
  if (s.image) {
    framedImage(doc, slide, s.image.file, 7.05, BODY_Y + 0.48, 2.3, h - 0.4)
  }
  setNotes(slide, s)
}

const section: R<'section'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER.section })
  // com foto, o bloco de texto alinha à esquerda e a foto emoldura à direita
  const withImage = Boolean(s.image)
  const tx = withImage ? 0.75 : 0.7
  const tw = withImage ? 5.5 : 8.6
  const align = withImage ? ('left' as const) : ('center' as const)
  slide.addText((s.kicker ?? 'Practice time').toUpperCase(), {
    x: tx,
    y: 2.0,
    w: tw,
    h: 0.3,
    align,
    fontFace: FONT.body,
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: T.turquoise,
  })
  slide.addText(s.title, {
    x: tx,
    y: 2.32,
    w: tw,
    h: 0.9,
    align,
    fontFace: FONT.display,
    fontSize: 40,
    bold: true,
    color: T.nightText,
    fit: 'shrink',
  })
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: tx,
      y: 3.3,
      w: withImage ? tw : 7,
      align,
      h: 0.5,
      fontFace: FONT.body,
      fontSize: 13,
      color: T.nightSub,
    })
  }
  if (s.image) framedImage(doc, slide, s.image.file, 6.6, 1.45, 2.85, 2.75)
  setNotes(slide, s)
}

const mission: R<'mission'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER.section })
  nightEyebrow(slide, `Mission ${s.number}`, 1.5)
  slide.addText(s.title, {
    x: 0.7,
    y: 1.82,
    w: 8.6,
    h: 0.78,
    align: 'center',
    fontFace: FONT.display,
    fontSize: 32,
    bold: true,
    color: T.nightText,
    fit: 'shrink',
  })
  const mis = planMission({ briefing: plain(s.briefing), steps: (s.steps ?? []).map(plain) })
  slide.addText(runs(s.briefing, { fontFace: FONT.body, fontSize: 13.5, color: T.nightSub }), {
    x: 1.6,
    y: mis.briefingY,
    w: 6.8,
    h: mis.briefingH,
    align: 'center',
  })
  let stepY = mis.stepsY
  s.steps?.forEach((step, i) => {
    const h = mis.stepLines[i] * mis.stepStep
    slide.addText(
      [
        { text: `${i + 1}.  `, options: { bold: true, color: T.turquoise } },
        ...runs(step, { color: T.nightText }),
      ],
      { x: 2.3, y: stepY, w: 5.8, h, fontFace: FONT.body, fontSize: mis.stepFont, valign: 'top' }
    )
    stepY += h + 0.08
  })
  setNotes(slide, s)
}

const recap: R<'recap'> = (pres, doc, s) => {
  const slide = paperSlide(pres, doc, { eyebrow: 'RECAP', title: s.title ?? 'Today you learned' })
  const twoCols = s.items.length > 4
  const half = Math.ceil(s.items.length / 2)
  s.items.forEach((item, i) => {
    const col = twoCols && i >= half ? 1 : 0
    const row = twoCols && i >= half ? i - half : i
    const x = col === 0 ? 0.52 : 5.12
    const y = BODY_Y + 0.16 + row * 0.54
    checkChip(slide, x, y + 0.02, 0.32)
    slide.addText(runs(item, { fontFace: FONT.body, fontSize: 13, color: T.ink900 }), {
      x: x + 0.46,
      y,
      w: twoCols ? 3.95 : 8.5,
      h: 0.4,
      valign: 'middle',
    })
  })
  setNotes(slide, s)
}

const closing: R<'closing'> = (pres, doc, s) => {
  const slide = pres.addSlide({ masterName: MASTER.closing })
  slide.addText(s.headline ?? 'Congratulations!', {
    x: 0.7,
    y: 1.72,
    w: 8.6,
    h: 0.8,
    align: 'center',
    fontFace: FONT.display,
    fontSize: 34,
    bold: true,
    color: T.nightText,
    fit: 'shrink',
  })
  if (s.message) {
    slide.addText(runs(s.message, { fontFace: FONT.body, fontSize: 13.5, color: T.nightSub }), {
      x: 1.5,
      y: 2.6,
      w: 7,
      h: 0.6,
      align: 'center',
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
        fill: { color: 'FFFFFF', transparency: 90 },
        line: { color: T.turquoise, width: 1 },
        x: 1.7,
        y: 3.44,
        w: 6.6,
        h: 0.56,
        align: 'center',
        valign: 'middle',
        fontFace: FONT.body,
        fit: 'shrink',
      }
    )
  }
  slide.addImage({ path: LOGO_WHITE, x: (10 - 0.35 * WORDMARK_RATIO) / 2, y: 4.84, w: 0.35 * WORDMARK_RATIO, h: 0.35 })
  setNotes(slide, s)
}

// exercícios ganham GABARITO PROGRESSIVO: N slides cumulativos, um por
// resposta — cada seta da apresentação "preenche" a resposta seguinte
// (decisão do mantenedor, 20/07)
export function revealCount(spec: SlideSpec): number {
  if (spec.type === 'listening') return (spec.items ?? []).filter((i) => i.correct === true).length
  if (spec.type === 'writing')
    return spec.exercises.reduce((n, ex) => n + ex.items.filter((i) => i.answer).length, 0)
  if (spec.type === 'quiz') return spec.questions.filter((q) => q.answer).length
  return 0
}

export function renderSlide(pres: Pres, doc: LessonDoc, spec: SlideSpec): void {
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
      writingSlide(pres, doc, spec, 0)
      for (let k = 1; k <= revealCount(spec); k++) writingSlide(pres, doc, spec, k)
      return
    }
    case 'quiz': {
      quizSlide(pres, doc, spec, 0)
      for (let k = 1; k <= revealCount(spec); k++) quizSlide(pres, doc, spec, k)
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

// total de slides gerados (specs + gabaritos progressivos)
export function renderedSlideCount(doc: LessonDoc): number {
  return doc.slides.length + doc.slides.reduce((n, sp) => n + revealCount(sp), 0)
}
