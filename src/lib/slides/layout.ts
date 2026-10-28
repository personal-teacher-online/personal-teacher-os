// Planos de layout PUROS (sem pptxgenjs) para os slides que crescem com o
// conteúdo. Motivo (21/07, 1º deck do M6A1): writing com 2 exercícios e
// grammar com regra longa + tabela estouravam a borda inferior — o texto caía
// por cima do rodapé. Aqui a altura é medida ANTES de desenhar e o
// espaçamento é comprimido até caber; os testes garantem a invariante
// "nada passa de BODY_BOTTOM".

export const BODY_Y = 1.98
export const BODY_BOTTOM = 5.06

/** Linhas estimadas de um texto numa caixa de `perLine` caracteres. */
export function estLines(text: string, perLine: number): number {
  return Math.max(1, Math.ceil(text.length / perLine))
}

/**
 * Linhas REAIS: a quebra acontece por PALAVRA, não por caractere — dividir o
 * comprimento pelo limite erra para os dois lados (barra da capa longe demais
 * com título curto, e por cima do texto com título longo — M6A3/M6A4, 21/07).
 */
export function wrapLines(text: string, perLine: number): number {
  const limit = Math.max(4, Math.floor(perLine))
  let lines = 1
  let col = 0
  for (const word of String(text).trim().split(/\s+/)) {
    if (!word) continue
    // palavra maior que a linha inteira ocupa quantas linhas precisar
    if (word.length > limit) {
      if (col > 0) lines += 1
      const extra = Math.ceil(word.length / limit)
      lines += extra - 1
      col = word.length % limit || limit
      continue
    }
    const need = col === 0 ? word.length : col + 1 + word.length
    if (need > limit) {
      lines += 1
      col = word.length
    } else {
      col = need
    }
  }
  return lines
}

/**
 * Caracteres por linha numa caixa de largura `w` (polegadas) para `size` pt.
 * A constante do display (Bricolage bold) foi CALIBRADA com dois casos reais
 * medidos no Google Slides (21/07): "Do Pedido à Conta Sem Travar" (28 car.)
 * coube em 1 linha com 38pt → perChar ≤ 0,00752; "Problemas no Restaurante?
 * Resolva" (33 car.) NÃO coube com 34pt → perChar > 0,00735.
 */
export function charsPerLine(w: number, size: number, display = false): number {
  const perChar = size * (display ? 0.00745 : 0.0072)
  return Math.max(6, w / perChar)
}

// ------------------------------------------------- medida REAL do título
/**
 * LARGURA DE GLIFO DO DISPLAY (Bricolage Grotesque, peso 700), em `em`.
 *
 * Por que a tabela existe (defeito do fio riscado, 25/07): `charsPerLine` mede
 * o título por CONTAGEM DE CARACTERES com um `perChar` único. Esse modelo é
 * cego à CAIXA ALTA — no Bricolage bold um `L` custa 0,509 em e um `M` custa
 * 0,939 em, quase o dobro. "THE PILLARS OF FLUENCY" tem 22 caracteres e o
 * modelo dava 24,6 de folga: título de UMA linha. Na página ele quebra em
 * DUAS, e o fio — que é desenhado logo abaixo da caixa PLANEJADA — cai por
 * dentro da segunda linha e vira tachado. O `y` do fio nunca esteve cravado no
 * renderizador: ele já era derivado; o que estava errado era a CAIXA de onde
 * ele deriva. 51 slides em 33 dos 65 decks.
 *
 * Os números saem do próprio arquivo da marca (`brand/fonts/bricolage-variable.woff2`,
 * instanciado em `wght=700`) — não são chute nem calibração por dois exemplos.
 * Acentos entram pela decomposição (o `á` tem a largura do `a`), então a tabela
 * é só ASCII + a pontuação tipográfica que os títulos usam.
 */
const DISPLAY_ADV: Readonly<Record<string, number>> = {
  ' ': 0.231, '!': 0.291, '"': 0.36, '#': 0.626, $: 0.641, '%': 0.977, '&': 0.755, "'": 0.177,
  '(': 0.321, ')': 0.316, '*': 0.436, '+': 0.528, ',': 0.196, '-': 0.352, '.': 0.233, '/': 0.361,
  '0': 0.665, '1': 0.347, '2': 0.603, '3': 0.606, '4': 0.623, '5': 0.61, '6': 0.657, '7': 0.509,
  '8': 0.656, '9': 0.652, ':': 0.244, ';': 0.22, '<': 0.528, '=': 0.528, '>': 0.528, '?': 0.421,
  '@': 0.987,
  A: 0.698, B: 0.683, C: 0.68, D: 0.7, E: 0.621, F: 0.593, G: 0.721, H: 0.723, I: 0.294, J: 0.374,
  K: 0.687, L: 0.509, M: 0.939, N: 0.776, O: 0.722, P: 0.646, Q: 0.723, R: 0.678, S: 0.652,
  T: 0.57, U: 0.728, V: 0.674, W: 0.986, X: 0.697, Y: 0.641, Z: 0.57,
  '[': 0.324, '\\': 0.357, ']': 0.319, '^': 0.572, _: 0.555, '`': 0.283,
  a: 0.586, b: 0.638, c: 0.565, d: 0.638, e: 0.581, f: 0.398, g: 0.601, h: 0.631, i: 0.277,
  j: 0.281, k: 0.59, l: 0.274, m: 0.946, n: 0.631, o: 0.609, p: 0.638, q: 0.638, r: 0.434,
  s: 0.544, t: 0.397, u: 0.622, v: 0.572, w: 0.863, x: 0.569, y: 0.602, z: 0.525,
  '{': 0.349, '|': 0.271, '}': 0.342, '~': 0.528,
  ç: 0.565, Ç: 0.68, ñ: 0.631, Ñ: 0.776, º: 0.423, ª: 0.43,
  '–': 0.537, '—': 0.803, '‘': 0.204, '’': 0.204, '“': 0.399, '”': 0.399, '·': 0.233, '…': 0.765,
  '€': 0.745, '£': 0.718, '¥': 0.629, '«': 0.463, '»': 0.463,
}
/** glifo fora da tabela paga o mais largo dos frequentes (`M`): erra para o lado seguro */
const DISPLAY_FALLBACK = 0.939

/** Largura do texto em `em` do display, somando o avanço REAL de cada glifo. */
export function displayWidthEm(text: string): number {
  let em = 0
  // NFD separa o acento do `a`; os combinantes não avançam o cursor
  for (const ch of String(text).normalize('NFD')) {
    if (ch >= '̀' && ch <= 'ͯ') continue
    em += DISPLAY_ADV[ch] ?? DISPLAY_FALLBACK
  }
  return em
}

/**
 * Margens internas que o PowerPoint aplica por padrão a TODA caixa de texto:
 * 0,1" de cada lado e 0,05" em cima e embaixo. O planejador antigo media
 * contra a largura DECLARADA da caixa e somava 0,04" de altura — os dois erros
 * empurram o texto para além da caixa que o fio usa como âncora.
 */
export const TEXT_INSET_X = 0.1
export const TEXT_INSET_Y = 0.05

/**
 * Folga sobre a medida do Bricolage. Não é superstição: o mesmo .pptx é lido
 * por quem TEM a fonte (Google Slides, produção) e por quem NÃO tem (qualquer
 * PowerPoint sem o Bricolage instalado, e o LibreOffice das provas em PNG).
 * Medido nas provas: a substituta do LibreOffice desenha "THE PILLARS OF
 * FLUENCY" ~7% mais larga que o Bricolage.
 *
 * COMO a folga é gasta importa tanto quanto o número. Ela NÃO entra na
 * contagem de linhas do plano — se entrasse, o planejador passaria a prever
 * DUAS linhas onde a página desenha UMA, e o fio voltaria a ficar solto no
 * meio do slide (o defeito M6A4, o gêmeo deste). Ela é o critério de ACEITE de
 * cada degrau da escada: só vale a fonte cuja quebra não muda quando o texto
 * engorda 6%. Quem não passa, desce um degrau — e o degrau vale 12–15%, muito
 * mais que os 6%. Ver `fitTitle`.
 */
export const DISPLAY_SAFE = 0.94

/** Altura de UMA linha de display, em polegadas, para `size` pt. */
export const displayLineH = (size: number): number => size * 0.0175

/**
 * Linhas que o título REALMENTE ocupa numa caixa DECLARADA de largura `boxW`.
 * Quebra por palavra, medindo cada palavra em `em` — a mesma regra do
 * `wrapLines`, com régua de glifo no lugar da contagem de caracteres.
 */
export function displayLines(text: string, boxW: number, size: number, folga = 1): number {
  const usable = Math.max(0.2, (boxW - 2 * TEXT_INSET_X) * folga)
  const limit = usable / (size / 72) // em cabíveis por linha
  const space = DISPLAY_ADV[' ']
  let lines = 1
  let col = 0
  for (const word of String(text).trim().split(/\s+/)) {
    if (!word) continue
    const wEm = displayWidthEm(word)
    // palavra maior que a linha inteira ocupa quantas linhas precisar
    if (wEm > limit) {
      if (col > 0) lines += 1
      const extra = Math.ceil(wEm / limit)
      lines += extra - 1
      col = wEm - (extra - 1) * limit
      continue
    }
    const need = col === 0 ? wEm : col + space + wEm
    if (need > limit) {
      lines += 1
      col = wEm
    } else {
      col = need
    }
  }
  return lines
}

/**
 * A CAIXA que o título ocupa: linhas medidas × entrelinha + as margens
 * internas do PowerPoint. É desta caixa — e só dela — que sai o `y` do fio da
 * marca em capa, cabeçalho, divisória, missão e fechamento.
 */
export function displayTitleBox(text: string, boxW: number, size: number): { lines: number; h: number } {
  const lines = displayLines(text, boxW, size)
  return { lines, h: lines * displayLineH(size) + 2 * TEXT_INSET_Y }
}

/**
 * Maior fonte da escada cujo TÍTULO cabe em `room` — e cuja QUEBRA é estável.
 *
 * Duas condições, as duas necessárias:
 *   (a) a caixa medida cabe na altura disponível;
 *   (b) a quebra não muda se o texto engordar `DISPLAY_SAFE` (fonte substituta).
 * (b) é o que impede o fio de riscar quem a página quebra em duas linhas e o
 * plano previu uma. E como (a) usa a contagem HONESTA (sem folga), o plano
 * nunca prevê uma linha a mais do que a página desenha — que é o defeito
 * espelhado, o fio solto do M6A4.
 *
 * Quando a escada inteira falha, continua descendo de 1 em 1 pt: a spec manda
 * ceder a FONTE, nunca a borda. O antigo `Math.min(room, …)` fazia o contrário
 * — devolvia uma caixa MENOR que o texto e punha o fio dentro dele.
 */
export function fitTitle(text: string, boxW: number, room: number, sizes: number[]): TitlePlan {
  const tenta = (size: number): TitlePlan | null => {
    const box = displayTitleBox(text, boxW, size)
    if (box.h > room) return null
    if (displayLines(text, boxW, size, DISPLAY_SAFE) > box.lines) return null
    return { font: size, lines: box.lines, h: box.h }
  }
  for (const size of sizes) {
    const plano = tenta(size)
    if (plano) return plano
  }
  const piso = 8
  for (let size = Math.floor(sizes[sizes.length - 1]) - 1; size >= piso; size -= 1) {
    const plano = tenta(size)
    if (plano) return plano
  }
  // nem o piso cabe: devolve a caixa HONESTA (nenhum título real chega aqui, e
  // se chegar o fio segue abaixo do texto em vez de riscá-lo)
  const box = displayTitleBox(text, boxW, piso)
  return { font: piso, lines: box.lines, h: box.h }
}

/**
 * Passo vertical que garante caber `count` itens entre `startY` e a borda.
 * Usado por TODA lista do deck (objetivos, speaking, quiz, recap, mission):
 * passo fixo transbordava quando a aula vinha maior (M6A2, 21/07).
 */
/** Respiro acima do rodapé: encostar na linha da marca fica feio (M6A2). */
export const BOTTOM_PAD = 0.12

/**
 * Maior fonte (entre `sizes`) cujo texto CABE numa caixa w×h. O `fit: shrink`
 * do pptxgenjs não sobrevive à conversão do Google Slides — o texto vazava
 * por baixo do cartão da regra (M6A2, 21/07). Aqui a fonte é decidida na
 * medição.
 */
export function fitFont(
  text: string,
  w: number,
  h: number,
  sizes: number[] = [13, 12, 11.5, 10.5, 9.5, 8.5],
): number {
  const inner = Math.max(0.2, h - 0.28) // margens internas do cartão
  for (const size of sizes) {
    const charsPerLine = Math.max(8, Math.round(w * (121 / size)))
    const lineH = size * 0.0158
    if (estLines(text, charsPerLine) * lineH <= inner) return size
  }
  return sizes[sizes.length - 1]
}

export function fitStep(startY: number, count: number, baseStep: number, itemH = baseStep - 0.06): number {
  if (count <= 1) return baseStep
  const avail = BODY_BOTTOM - startY - itemH
  return Math.max(0.22, Math.min(baseStep, avail / (count - 1)))
}

/**
 * Capa: altura do título e onde entram o fio da marca e o subtítulo. O
 * layout antigo fixava o fio em y=3.12 e um título de 3 linhas passava por
 * cima dele (M6A3, 21/07).
 */
export function planCover(title: string, hasImage: boolean): {
  titleFont: number
  titleY: number
  titleH: number
  stripY: number
  subtitleY: number
  lines: number
} {
  const w = hasImage ? 6.55 : 8.0
  const TITLE_Y = 1.6 // logo abaixo do eyebrow (fixo no design)
  const GAP = 0.14 // respiro entre o título e o fio da marca
  const LOGO_Y = 4.84
  // Teto do bloco de título: precisa sobrar fio + subtítulo antes do logo.
  const room = LOGO_Y - 0.34 - GAP - 0.16 - 0.6 - TITLE_Y

  // REGRA GERAL (21/07): o fio vem SEMPRE logo abaixo do título — nunca em
  // altura fixa. Título curto deixava o fio solto no meio do slide (M6A4);
  // título de 3 linhas passava por cima dele (M6A3). A fonte cai até o bloco
  // caber; fonte menor também quebra em menos linhas, por isso a conta é
  // refeita a cada tamanho. Desde 25/07 quem conta as linhas é o avanço REAL
  // do glifo (`fitTitle`), não a contagem de caracteres.
  const plan = fitTitle(title, w, room, [38, 34, 30, 26, 22])
  const stripY = TITLE_Y + plan.h + GAP
  return {
    titleFont: plan.font,
    titleY: TITLE_Y,
    titleH: plan.h,
    stripY,
    subtitleY: stripY + 0.16,
    lines: plan.lines,
  }
}

/**
 * Missão (fundo noturno): título + briefing + passos numerados. Passo com 2
 * linhas estourava a borda (M6A5, 21/07) — aqui tudo é medido: o briefing
 * define onde os passos começam e o passo mais longo define o espaçamento.
 */
export function planMission(input: {
  briefing: string
  steps: string[]
  bottom?: number
}): { briefingY: number; briefingH: number; stepsY: number; stepStep: number; stepFont: number; stepLines: number[] } {
  const BRIEF_Y = 2.66
  const bottom = input.bottom ?? 5.0
  const briefLines = wrapLines(input.briefing, charsPerLine(6.8, 13.5))
  const briefingH = Math.max(0.42, briefLines * 0.22 + 0.1)
  const stepsY = BRIEF_Y + briefingH + 0.18

  // Fonte dos passos: cai se o bloco não couber (menos linhas por passo).
  for (const font of [12.5, 11.5, 10.5, 9.5]) {
    const lines = input.steps.map((t) => wrapLines(`9.  ${t}`, charsPerLine(5.8, font)))
    const total = lines.reduce((n, l) => n + l, 0)
    const lineH = font * 0.0165
    const need = total * lineH + (input.steps.length - 1) * 0.08
    if (need <= bottom - stepsY) {
      return {
        briefingY: BRIEF_Y,
        briefingH,
        stepsY,
        stepStep: lineH,
        stepFont: font,
        stepLines: lines,
      }
    }
  }
  const font = 9.5
  const lines = input.steps.map((t) => wrapLines(`9.  ${t}`, charsPerLine(5.8, font)))
  const total = Math.max(1, lines.reduce((n, l) => n + l, 0))
  return {
    briefingY: BRIEF_Y,
    briefingH,
    stepsY,
    // último recurso: comprime o entrelinhas até caber (mesmo gap do desenho)
    stepStep: Math.max(0.12, (bottom - stepsY - Math.max(0, input.steps.length - 1) * 0.08) / total),
    stepFont: font,
    stepLines: lines,
  }
}

// --------------------------------------------------------------- vocab card
// Plano PURO do card de vocabulário (Fase 0b, defeito 1). Antes o `vocabCard`
// do v2 calculava as caixas no meio do desenho, com um `Math.max(0.2, …)` na
// caixa do termo e a pronúncia ancorada ACIMA do rodapé do card: num card baixo
// (grade de 8) as três caixas se sobrepunham — pronúncia sobre a foto, termo
// sobre a tradução. Passou por 806 testes porque a invariante era de borda
// inferior, e a colisão é de INTERSECÇÃO (spec §2, invariante 0).
//
// Aqui as caixas nascem de UMA conta com soma exata: foto + linhas + respiros
// = altura do card. Nenhuma caixa é ancorada no rodapé com piso de altura
// (proibido pela spec §2.1), então intersecção é impossível por construção.
export interface VocabBox {
  x: number
  y: number
  w: number
  h: number
}
export interface VocabTextBox extends VocabBox {
  font: number
}

/**
 * Composição do card:
 *  - `stack` — foto no topo, termo/pronúncia/tradução centrados abaixo (card alto)
 *  - `side`  — foto à esquerda, texto à direita alinhado à esquerda (card baixo)
 *  - `row`   — cartão-linha: miniatura + termo/pronúncia à esquerda, tradução à
 *              direita (card muito largo, grade de 2 colunas)
 */
export type VocabCardLayout = 'stack' | 'side' | 'row'

export interface VocabCardPlan {
  layout: VocabCardLayout
  /** ausente quando não há foto OU quando a foto foi omitida por falta de espaço */
  img?: VocabBox
  term: VocabTextBox
  cue?: VocabTextBox
  pt: VocabTextBox
  /** a pronúncia entrou no card? `false` = vai só para as speaker notes */
  showCue: boolean
  align: 'left' | 'center'
}

export const VOCAB_CARD = {
  pad: 0.09,
  /** respiro entre a foto e o bloco de texto (stack) */
  imgGap: 0.09,
  /** respiro entre a foto e a coluna de texto (side/row) */
  sideGap: 0.12,
  /** respiro entre duas linhas de texto */
  lineGap: 0.02,
  /** fração-alvo da altura do card para a foto */
  imgTarget: 0.46,
  imgTargetHero: 0.54,
  /** PISO da foto: 30% da altura do card (spec §7-bis, defeito 1, degradação a) */
  imgFloor: 0.3,
  /** abaixo disto a coluna de texto não é legível: a foto sai do card */
  minTextW: 1.2,
  /** miniatura menor que isto não comunica nada: melhor card só de texto */
  minThumb: 0.34,
  /** piso de legibilidade = último tamanho de cada escada (degradação b) */
  termSizes: [22, 18, 15.5, 14, 12.5, 11.5, 11],
  cueSizes: [10.5, 9, 8.5, 8, 7.5],
  ptSizes: [13, 11.5, 10.5, 9.5, 9],
} as const

/**
 * Altura de UMA linha de texto de `font` pt. Cada caixa do card carrega uma
 * linha só (o termo tem `fit: 'shrink'` para palavra comprida), então a altura
 * é o passo tipográfico — não a caixa generosa do v1, que era o que fazia as
 * três caixas se sobreporem.
 */
export function vocabLineH(font: number): number {
  return Math.max(0.13, font * 0.0155)
}

/** escada de tamanhos: o degrau inicial vem da ALTURA do card */
function vocabStart(h: number): { term: number; cue: number; pt: number } {
  if (h >= 2.0) return { term: 0, cue: 0, pt: 0 }
  if (h >= 1.35) return { term: 2, cue: 1, pt: 1 }
  if (h >= 1.05) return { term: 3, cue: 2, pt: 2 }
  if (h >= 0.8) return { term: 4, cue: 3, pt: 3 }
  return { term: 5, cue: 4, pt: 4 }
}

const at = (sizes: readonly number[], i: number): number => sizes[Math.min(i, sizes.length - 1)]

/**
 * Caixas de um card de vocabulário, SEM intersecção nenhuma.
 *
 * Ordem de degradação (spec §7-bis, defeito 1): (a) a foto encolhe até o piso
 * de 30% da altura do card; (b) as fontes caem até o piso de legibilidade;
 * (c) só então a pronúncia sai do card — ela vai para as speaker notes.
 */
export function planVocabCard(input: {
  x: number
  y: number
  w: number
  h: number
  hasImg: boolean
  temCue: boolean
}): VocabCardPlan {
  const V = VOCAB_CARD
  const { x, y, w, h } = input
  const inner = Math.max(0.1, h - 2 * V.pad)
  const start = vocabStart(h)
  const steps = Math.max(V.termSizes.length, V.cueSizes.length, V.ptSizes.length)
  const wide = w / h >= 3.4
  const hero = h >= 2.0

  /** as três fontes do degrau `s` da escada */
  const fonts = (s: number) => ({
    term: at(V.termSizes, start.term + s),
    cue: at(V.cueSizes, start.cue + s),
    pt: at(V.ptSizes, start.pt + s),
  })

  // ---------------------------------------------------------------- cartão-linha
  if (wide) {
    const thumb = input.hasImg ? Math.min(inner, w * 0.2, 1.0) : 0
    const useThumb = thumb >= V.minThumb
    const tx = x + V.pad + (useThumb ? thumb + V.sideGap : 0)
    const tw = Math.max(0.4, x + w - V.pad - tx)
    const termW = tw * 0.58
    for (const showCue of input.temCue ? [true, false] : [false]) {
      for (let s = 0; s < steps; s++) {
        const f = fonts(s)
        const need = vocabLineH(f.term) + (showCue ? V.lineGap + vocabLineH(f.cue) : 0)
        if (need > inner && s < steps - 1) continue
        if (need > inner && showCue) break // desiste da pronúncia (degradação c)
        const top = y + V.pad + Math.max(0, (inner - need) / 2)
        return {
          layout: 'row',
          img: useThumb ? { x: x + V.pad, y: y + V.pad, w: thumb, h: inner } : undefined,
          term: { x: tx, y: top, w: termW, h: vocabLineH(f.term), font: f.term },
          cue: showCue
            ? {
                x: tx,
                y: top + vocabLineH(f.term) + V.lineGap,
                w: termW,
                h: vocabLineH(f.cue),
                font: f.cue,
              }
            : undefined,
          pt: { x: tx + termW, y: y + V.pad, w: tw - termW, h: inner, font: f.pt },
          showCue,
          align: 'left',
        }
      }
    }
  }

  // ------------------------------------------------------- foto ao lado do texto
  const sideThumb = Math.min(inner, w * 0.36)
  const sideTextX = x + V.pad + sideThumb + V.sideGap
  const sideTextW = x + w - V.pad - sideTextX
  const side = input.hasImg && !hero && h < 1.05 && sideTextW >= V.minTextW

  // ------------------------------------------------------ empilhado / centralizado
  // Um único laço para as duas composições: a diferença é onde a foto entra
  // (acima do texto ou ao lado dele) e, por consequência, quanta altura sobra.
  const textW = side ? sideTextW : w - 2 * V.pad
  const textX = side ? sideTextX : x
  const imgTarget = (hero ? V.imgTargetHero : V.imgTarget) * h
  for (const showCue of input.temCue ? [true, false] : [false]) {
    for (let s = 0; s < steps; s++) {
      const f = fonts(s)
      const lines =
        vocabLineH(f.term) +
        (showCue ? V.lineGap + vocabLineH(f.cue) : 0) +
        V.lineGap +
        vocabLineH(f.pt)
      const room = side ? inner : inner - (input.hasImg ? V.imgGap : 0)
      // (a) a foto cede primeiro: fica com o que sobrar das fontes deste degrau
      const imgH = side ? inner : Math.min(imgTarget, room - lines)
      const last = s === steps - 1
      if (input.hasImg && !side && imgH < V.imgFloor * h) {
        if (!last) continue
        if (showCue) break // (c) sem espaço nem no piso: a pronúncia sai
      }
      if (lines > room) {
        if (!last) continue
        if (showCue) break
      }
      const drawImg = input.hasImg && (side || imgH >= V.imgFloor * h)
      // Sobra depois da foto e das linhas. COM foto ela vira respiro entre a foto
      // e as linhas; SEM foto o bloco de texto fica junto e centrado — espalhar
      // três linhas soltas num card alto lê como card meio vazio (visto na
      // inspeção do M5A1: os cards sem foto da grade de 8 ficavam desmontados).
      const used = lines + (drawImg && !side ? imgH + V.imgGap : 0)
      const slack = Math.max(0, room - used)
      const gapExtra = drawImg && !side ? slack / (showCue ? 4 : 3) : 0
      const topPad =
        y +
        V.pad +
        (side || !drawImg ? Math.max(0, (inner - used) / 2) : gapExtra)
      let cursor = topPad + (drawImg && !side ? imgH + V.imgGap + gapExtra : 0)
      const term = { x: textX, y: cursor, w: textW, h: vocabLineH(f.term), font: f.term }
      cursor += term.h + V.lineGap + (side ? 0 : gapExtra)
      const cue = showCue
        ? { x: textX, y: cursor, w: textW, h: vocabLineH(f.cue), font: f.cue }
        : undefined
      if (cue) cursor += cue.h + V.lineGap + (side ? 0 : gapExtra)
      const pt = { x: textX, y: cursor, w: textW, h: vocabLineH(f.pt), font: f.pt }
      return {
        layout: side ? 'side' : 'stack',
        img: drawImg
          ? side
            ? { x: x + V.pad, y: y + V.pad, w: sideThumb, h: inner }
            : { x: x + V.pad, y: topPad, w: w - 2 * V.pad, h: imgH }
          : undefined,
        term,
        cue,
        pt,
        showCue,
        align: side ? 'left' : 'center',
      }
    }
  }
  // inalcançável: o último degrau sem pronúncia sempre devolve (as escadas têm
  // piso e `room` é positivo por construção). Fica explícito para o tipo.
  const f = fonts(steps - 1)
  return {
    layout: 'stack',
    term: { x, y: y + V.pad, w: w - 2 * V.pad, h: vocabLineH(f.term), font: f.term },
    pt: {
      x,
      y: y + V.pad + vocabLineH(f.term) + V.lineGap,
      w: w - 2 * V.pad,
      h: vocabLineH(f.pt),
      font: f.pt,
    },
    showCue: false,
    align: 'center',
  }
}

// ------------------------------------------------------------------- chips
/**
 * Chips do `unscramble` (spec §7-ter.2, ajuste 13): o dono viu as palavras
 * coladas umas nas outras e coladas na caixa de resposta.
 *
 * A geometria vive AQUI e não no renderer porque ela é usada DUAS vezes — para
 * MEDIR quantas linhas o item ocupa (entra no `planWriting`) e para DESENHAR.
 * Na Fase 0b as duas contas eram cópias uma da outra dentro do template: mudar
 * o vão numa e esquecer da outra faz a linha medida não ser a linha desenhada,
 * que é exatamente o tipo de defeito que a invariante 0 pega tarde.
 */
export const CHIPS = {
  /** vão HORIZONTAL entre dois chips vizinhos */
  gapX: 0.16,
  /** vão VERTICAL entre duas linhas de chips (sai da altura do chip) */
  gapY: 0.08,
  /** largura mínima de um chip (palavra de 1–2 letras não vira pastilha fina) */
  minW: 0.5,
  /** folga interna do chip + largura por caractere (calibrado no M5A1) */
  padW: 0.34,
  perChar: 0.105,
  /**
   * altura máxima da pastilha. Com poucos itens sobra banda, e sem teto a
   * pastilha viraria uma barra alta com uma palavrinha no meio. O excedente vai
   * para a CAIXA DE RESPOSTA, nunca para o vão — o vão é contrato (`AGRUPAMENTO`).
   */
  maxH: 0.3,
} as const

export interface Chip {
  text: string
  x: number
  w: number
  /** linha do chip, começando em 0 */
  row: number
}

/** chips de UM item, quebrados em linhas dentro de `[x0, right]` */
export function planChips(words: string[], x0: number, right: number): { chips: Chip[]; rows: number } {
  const chips: Chip[] = []
  const maxW = Math.max(CHIPS.minW, right - x0)
  let cx = x0
  let row = 0
  for (const word of words) {
    // teto na largura da linha: palavra absurda (o contrato permite até 200
    // caracteres num prompt) encolhe dentro do chip em vez de sair da página
    const w = Math.min(maxW, Math.max(CHIPS.minW, CHIPS.padW + word.length * CHIPS.perChar))
    if (cx > x0 && cx + w > right) {
      cx = x0
      row += 1
    }
    chips.push({ text: word, x: cx, w, row })
    cx += w + CHIPS.gapX
  }
  return { chips, rows: row + 1 }
}

/**
 * TODA a geometria de um bloco do writing — inclusive as pastilhas e os chips,
 * que até a Fase 0e eram recalculados no desenho com piso próprio.
 *
 * Nenhum campo é opcional de propósito (spec §7-quater, item 20): campo
 * opcional é convite para o renderer inventar um `?? …` com `Math.max` em volta,
 * que foi exatamente como o rótulo do exercício voltou a invadir a 1ª pastilha.
 * O plano responde por cada caixa que vai ser desenhada; o desenho só transcreve.
 */
export interface WritingBlock {
  kind: 'label' | 'complete' | 'unscramble' | 'create'
  /** índice do exercício (para o rótulo) */
  ex: number
  /** índice do item dentro do exercício (−1 no rótulo) */
  item: number
  y: number
  h: number
  /** altura do chip preto do RÓTULO do exercício (0 fora do rótulo) */
  labelH: number
  /** altura do chip numerado do item (0 no rótulo) */
  numChipH: number
  /** linhas de chips (unscramble; 0 nos demais) */
  chipRows: number
  /** PASSO de uma linha de chips para a seguinte (unscramble) = `chipH` + vão */
  chipStep: number
  /**
   * altura da PASTILHA (unscramble). Sai do plano, não do desenho: é ela que
   * fecha a conta do vão DENTRO do item — `answerY − (y + (rows−1)·chipStep +
   * chipH)` é exatamente `gapDentro`, e sem isso o vão medido no teste não é o
   * vão desenhado (Fase 0d, item 18).
   */
  chipH: number
  /** caixa do enunciado (`complete` e `create`) */
  promptH: number
  /** caixa de resposta: topo e altura JÁ com o piso respeitado (defeito 2) */
  answerY: number
  answerH: number
}

export interface WritingPlan {
  blocks: WritingBlock[]
  /**
   * fator aplicado à parte COMPRIMÍVEL. `1` = base; abaixo de 1 o conteúdo
   * comprime; acima de 1 (só no v2, teto `mins.grow`) o bloco CRESCE para
   * ocupar a banda — no v2 essa expansão vive aqui e não mais no renderer, para
   * que os vãos do agrupamento sejam o que o plano diz que são.
   */
  k: number
  /** vão DENTRO do item: última linha de chips (ou enunciado) → caixa de resposta */
  gapDentro: number
  /** vão ENTRE dois itens vizinhos do mesmo exercício */
  gapEntre: number
  /** fonte do enunciado do item, já escalada */
  fontSize: number
  bottom: number
  /**
   * Quantos ITENS couberam NESTA página (spec §7-quater, item 21). Menor que
   * `total` significa que o writing CONTINUA em outro slide — nunca que um item
   * foi escondido nem que o piso da caixa de resposta foi comprimido.
   *
   * `0` é resposta legítima ("nem um item cabe aqui") e quem chama decide o que
   * fazer, como em `planSteps.fits`.
   */
  fits: number
  /** total de itens oferecidos ao plano */
  total: number
}

const W_BASE = {
  label: 0.36,
  complete: 0.5,
  unscrambleChipRow: 0.36,
  unscrambleBox: 0.44,
  create: 0.96,
  /** parte da caixa de resposta dentro do bloco `create` (o resto é enunciado) */
  createBox: 0.54,
  gapEx: 0.08,
  gapIn: 0.02,
  font: 13,
}

/**
 * Parte NÃO comprimível de cada bloco (Fase 0b, defeito 2).
 *
 * A caixa de resposta tem piso de 0.18" — quem digita nela é a aluna, ao vivo.
 * No v2 o piso era aplicado no DESENHO (`Math.max(0.18, …)`), depois do fator de
 * compressão: com `k < 0.4545` a caixa crescia para além do bloco e o writing
 * terminava em 5.106, fora da borda. Agora o piso entra no CÁLCULO do fator:
 * `k` comprime só o que é comprimível e a soma das partes é exata.
 */
export interface WritingMins {
  /** chip do rótulo do exercício */
  label: number
  /** caixa de resposta */
  answer: number
  /** enunciado do `create` — uma linha */
  prompt: number
  /**
   * vão DENTRO do item: última linha de chips (ou enunciado do `create`) → caixa
   * de resposta (spec §7-ter.2, ajuste 13). É PISO, como a caixa de resposta.
   */
  chipGap: number
  /**
   * vão ENTRE dois itens vizinhos que têm divisão interna (`unscramble` e
   * `create`: enunciado em cima, caixa embaixo). **Fase 0d, item 18.**
   *
   * Até aqui os blocos de item eram encostados (`y += h`, vão zero) enquanto o
   * vão DENTRO do item valia 0.19": o espaço dentro do item era maior que o
   * espaço entre itens, o inverso do que a proximidade exige — o aluno lia
   * "caixa do item 1 + chips do item 2" como um bloco só. Este piso é derivado
   * de `chipGap` por `AGRUPAMENTO`, e não escrito à mão, justamente para que a
   * razão não possa derivar num ajuste futuro.
   */
  gapItem: number
  /**
   * vão ENTRE itens SEM divisão interna (`complete`: enunciado e caixa lado a
   * lado, uma linha só). Ali o vão DENTRO é zero, então o vão ENTRE não precisa
   * pagar o dobro de nada — e cobrar `gapItem` roubaria altura da tipografia
   * (o M5A1 tem 4 `complete` numa banda de 2.72").
   */
  gapItemFlat: number
  /** teto da caixa de resposta (0 = as bases históricas do v1) */
  answerBox: number
  /** altura mínima da pastilha de chip, para ela não sumir no slide cheio */
  chipMin: number
  /**
   * TETO do fator de expansão. O v2 cresce DENTRO do plano até `grow` para
   * ocupar a banda (defeito 9); o v1 não cresce (`1`) — ele nunca cresceu.
   */
  grow: number
}

/**
 * RAZÃO DE AGRUPAMENTO (Fase 0d, item 18) — o contrato de percepção do writing.
 *
 * O vão ENTRE itens é sempre este múltiplo do vão DENTRO do item. É RAZÃO e não
 * medida: os dois são PISOS e nenhum dos dois é comprimido (Fase 0e, item 21 —
 * quando não cabem, a página é que quebra), então o agrupamento é invariante por
 * construção. A régua do dono é `entre ≥ 2 × dentro`; 2.5 dá margem para a
 * pastilha ser desenhada com o teto de `CHIPS.maxH` sem raspar o limite.
 */
export const AGRUPAMENTO = 2.5

/**
 * v1 (template.ts, em produção): NENHUM piso no plano — é o comportamento
 * original, em que o piso da caixa de resposta era aplicado no desenho. Fica
 * como padrão do parâmetro para o v1 continuar byte-idêntico (spec §1/§7.1).
 */
export const WRITING_MINS_V1: WritingMins = {
  label: 0,
  answer: 0,
  prompt: 0,
  chipGap: 0,
  gapItem: 0,
  gapItemFlat: 0,
  answerBox: 0,
  chipMin: 0,
  grow: 1,
}

/** v2 (Fase 0b + 0d): os pisos entram no plano, antes do fator de compressão. */
export const WRITING_MINS_V2: WritingMins = {
  label: 0.16,
  answer: 0.18,
  prompt: 0.17,
  chipGap: 0.12,
  gapItem: 0.12 * AGRUPAMENTO,
  gapItemFlat: 0.14,
  // era 0.44 (base do v1): a caixa é generosa e o agrupamento é que carrega o
  // significado, então quem cede altura para o vão é ela (Fase 0d, item 18)
  answerBox: 0.34,
  chipMin: 0.1,
  // A expansão agora só puxa a parte COMPRIMÍVEL (os pisos e os vãos ficam no
  // tamanho do contrato), então o teto precisa ser mais alto que o 1.7 da
  // escala uniforme que ela substituiu para dar o mesmo preenchimento no
  // mínimo do contrato — 1 exercício de 1 item (defeito 9).
  grow: 2.6,
}

/** um bloco ANTES de ganhar posição: parte fixa (piso) + parte comprimível */
interface RawBlock {
  kind: WritingBlock['kind']
  ex: number
  item: number
  chipRows: number
  fixed: number
  flex: number
}

/**
 * Monta a lista de blocos de UMA página, com no máximo `take` itens.
 *
 * `take` é o mecanismo da paginação (Fase 0e, item 21): o rótulo de um exercício
 * só entra se algum item dele entrar, e o respiro ENTRE exercícios só entra se o
 * exercício seguinte também couber nesta página — senão o respiro sobraria
 * pendurado no fim do slide.
 *
 * Com `take` = total (sempre o caso do v1, cujos pisos são todos zero) a lista é
 * IDÊNTICA à da Fase 0d.
 */
function montarWriting(
  exercises: Array<{ kind: 'complete' | 'unscramble' | 'create'; items: unknown[] }>,
  chipRowsOf: (ex: number, item: number) => number,
  mins: WritingMins,
  take: number,
): { raw: RawBlock[]; fixed: number; flex: number } {
  // piso + o respiro que ele arrasta (zero continua zero: é o caminho do v1)
  const floor = (v: number, extra = 0): number => (v > 0 ? v + extra : 0)
  const raw: RawBlock[] = []
  let usados = 0
  exercises.forEach((ex, i) => {
    const cabem = Math.max(0, Math.min(ex.items.length, take - usados))
    if (cabem === 0) return
    raw.push({
      kind: 'label',
      ex: i,
      item: -1,
      chipRows: 0,
      fixed: mins.label,
      flex: W_BASE.label - mins.label,
    })
    for (let j = 0; j < cabem; j++) {
      // VÃO ENTRE ITENS (Fase 0d, item 18): um espaçador de verdade entre dois
      // itens vizinhos. Antes os blocos eram encostados e a percepção agrupava
      // "caixa do item N + chips do item N+1". No v1 os dois vãos são 0 e o
      // espaçador nem existe — o plano do v1 fica idêntico.
      const entre = ex.kind === 'complete' ? mins.gapItemFlat : mins.gapItem
      if (j > 0 && entre > 0)
        raw.push({ kind: 'label', ex: i, item: -2, chipRows: 0, fixed: entre, flex: 0 })
      if (ex.kind === 'complete') {
        const fixed = floor(mins.answer, 2 * W_BASE.gapIn)
        raw.push({
          kind: 'complete',
          ex: i,
          item: j,
          chipRows: 0,
          fixed,
          flex: W_BASE.complete - fixed,
        })
      } else if (ex.kind === 'unscramble') {
        const rows = Math.max(1, chipRowsOf(i, j))
        // piso do item: caixa + vão de dentro + pastilha mínima. A pastilha
        // entra no piso porque sem ela o item no teto do contrato saía com
        // chip de altura ZERO quando os pisos precisavam encolher.
        const fixed = mins.answer + mins.chipGap + rows * mins.chipMin
        raw.push({
          kind: 'unscramble',
          ex: i,
          item: j,
          chipRows: rows,
          fixed,
          // as linhas de chips comprimem; a caixa de resposta e os vãos, não
          flex: Math.max(0, rows * W_BASE.unscrambleChipRow + answerMax(mins, 'unscramble') - fixed),
        })
      } else {
        const fixed = floor(mins.prompt, mins.chipGap > 0 ? mins.chipGap : W_BASE.gapIn) + mins.answer
        raw.push({
          kind: 'create',
          ex: i,
          item: j,
          chipRows: 0,
          fixed,
          flex: Math.max(0, W_BASE.create - fixed),
        })
      }
    }
    usados += cabem
    // entre EXERCÍCIOS o respiro é pelo menos o de entre itens (o chip preto do
    // rótulo já sinaliza a troca, mas o vão não pode ser MENOR que o de dentro)
    if (i < exercises.length - 1 && take - usados > 0)
      raw.push({ kind: 'label', ex: i, item: -2, chipRows: 0, fixed: mins.gapItem, flex: W_BASE.gapEx })
  })
  return {
    raw,
    fixed: raw.reduce((sum, b) => sum + b.fixed, 0),
    flex: raw.reduce((sum, b) => sum + b.flex, 0),
  }
}

/**
 * Distribui os exercícios de writing entre `startY` e BODY_BOTTOM.
 * `chipRowsOf` informa quantas linhas de chips um unscramble ocupa (medido no
 * renderer, que conhece as larguras reais).
 *
 * INVARIANTES:
 * 1. `bottom <= BODY_BOTTOM` para QUALQUER distribuição legal dos 6 itens do
 *    contrato — e a caixa de resposta nunca é desenhada fora do bloco;
 * 2. **AGRUPAMENTO** (Fase 0d, item 18): `gapEntre === AGRUPAMENTO × gapDentro`
 *    por CONSTRUÇÃO, em qualquer distribuição — os dois são pisos e piso não
 *    encolhe;
 * 3. **PISO É PISO** (Fase 0e, item 21): a caixa de resposta nunca sai abaixo de
 *    `mins.answer`. Quando os pisos do conjunto não cabem na banda, o plano NÃO
 *    os comprime — ele devolve `fits < total` e o writing continua em outro
 *    slide. Até a Fase 0d havia um segundo fator (`kf`) que espremia os pisos
 *    junto com o resto: medido, a caixa de resposta ficava com 0.09" no teto do
 *    contrato — metade do "piso" de 0.18" que o código anunciava. Caixa de 0.09"
 *    não serve para a aluna escrever dentro; um slide a mais serve.
 */
export function planWriting(
  exercises: Array<{ kind: 'complete' | 'unscramble' | 'create'; items: unknown[] }>,
  chipRowsOf: (ex: number, item: number) => number,
  startY = BODY_Y + 0.36,
  mins: WritingMins = WRITING_MINS_V1,
): WritingPlan {
  const total = exercises.reduce((n, ex) => n + ex.items.length, 0)
  const avail = BODY_BOTTOM - startY
  // PAGINAÇÃO: tira o último item enquanto a soma dos PISOS não couber na banda.
  // No v1 todos os pisos são zero, então `fixed` é zero e o laço nunca roda — o
  // plano do v1 continua sendo o de sempre, com todos os itens.
  let fits = total
  let montado = montarWriting(exercises, chipRowsOf, mins, fits)
  while (fits > 0 && montado.fixed > avail) {
    fits -= 1
    montado = montarWriting(exercises, chipRowsOf, mins, fits)
  }
  const { raw, fixed, flex } = montado
  // NUNCA transborda: o fator comprime a parte comprimível até o que couber.
  // Acima de 1 (só no v2) ele EXPANDE até `mins.grow` para ocupar a banda.
  const k = flex <= 0 ? 1 : Math.max(0, Math.min(mins.grow, (avail - fixed) / flex))
  const gapDentro = mins.chipGap
  const gapEntre = mins.gapItem
  const blocks: WritingBlock[] = []
  let y = startY
  for (const b of raw) {
    const h = b.fixed + b.flex * k
    if (b.item !== -2) {
      // Geometria interna do bloco: sai do PLANO, não do desenho. Toda caixa é
      // derivada de `h` por subtração, então a soma fecha exatamente e nenhuma
      // sobra para fora do bloco (spec §2.1: proibido piso de altura em caixa
      // ancorada no rodapé — e §7-quater: proibido piso NENHUM no renderer).
      const block: WritingBlock = {
        kind: b.kind,
        ex: b.ex,
        item: b.item,
        y,
        h,
        // O `Math.max(0, …)` daqui para baixo é rede contra ALTURA NEGATIVA (a
        // caixa some), nunca piso: ele só encolhe, jamais empurra uma caixa para
        // fora do bloco. Era o `Math.max(0.08, …)` do renderer — piso de
        // verdade, que crescia a caixa — que invadia a pastilha seguinte.
        labelH: 0,
        numChipH: 0,
        chipRows: b.chipRows,
        chipStep: 0,
        chipH: 0,
        promptH: 0,
        answerY: y,
        answerH: 0,
      }
      if (b.kind === 'label') {
        block.labelH = Math.max(0, Math.min(0.26, h - 0.06))
      } else {
        block.numChipH = Math.max(0, Math.min(0.3, h - 0.08))
      }
      if (b.kind === 'complete') {
        block.answerH = Math.max(0, Math.min(0.36, h - 2 * W_BASE.gapIn))
        // no v2 a caixa fica CENTRADA no bloco, como o enunciado ao lado dela
        // (valign middle): encostada no topo ela desalinhava do próprio texto
        block.answerY = mins.answer > 0 ? y + (h - block.answerH) / 2 : y + W_BASE.gapIn
        block.promptH = Math.max(0, h - 0.06)
      } else if (b.kind === 'unscramble') {
        const rows = Math.max(1, b.chipRows)
        const vao = mins.chipGap > 0 ? gapDentro : W_BASE.gapIn * k
        let answerH = Math.min(h, mins.answer + (answerMax(mins, 'unscramble') - mins.answer) * k)
        let faixa = Math.max(0, h - answerH - vao)
        const gapY = rows > 1 ? Math.min(CHIPS.gapY, (faixa / rows) * 0.3) : 0
        let chipH = Math.max(0, (faixa - (rows - 1) * gapY) / rows)
        if (mins.chipMin > 0 && chipH > CHIPS.maxH) {
          // pastilha no teto: o excedente vai para a CAIXA, não para o vão —
          // assim `answerY − fim dos chips` continua sendo exatamente `vao`
          const sobra = (chipH - CHIPS.maxH) * rows
          chipH = CHIPS.maxH
          answerH += sobra
          faixa -= sobra
        }
        block.answerH = answerH
        block.answerY = y + h - answerH
        block.chipH = chipH
        block.chipStep = chipH + gapY
      } else if (b.kind === 'create') {
        const vao = mins.chipGap > 0 ? gapDentro : W_BASE.gapIn * k
        block.answerH = Math.min(h, mins.answer + (answerMax(mins, 'create') - mins.answer) * k)
        block.answerY = y + h - block.answerH
        block.promptH = Math.max(0, h - block.answerH - vao)
      }
      blocks.push(block)
    }
    y += h
  }
  return {
    blocks,
    k,
    gapDentro,
    gapEntre,
    // A fonte encolhe menos que o espaçamento (piso de 82%) e NÃO cresce com a
    // expansão: `k > 1` é folga de espaço, não licença para tipografia gigante.
    fontSize: Math.round(W_BASE.font * Math.max(0.82, Math.min(1, k)) * 10) / 10,
    bottom: y,
    fits,
    total,
  }
}

/** teto da caixa de resposta: o do contrato v2, ou a base histórica do v1 */
function answerMax(mins: WritingMins, kind: 'unscramble' | 'create'): number {
  if (mins.answerBox > 0) return mins.answerBox
  return kind === 'unscramble' ? W_BASE.unscrambleBox : W_BASE.createBox
}

export interface GrammarPlan {
  ruleH: number
  ruleFont: number
  tableY: number
  tableRowH: number
  tableFont: number
  /** fonte do CABEÇALHO da tabela (um degrau abaixo do corpo, com piso) */
  tableHeaderFont: number
  exampleStep: number
  exampleFont: number
  /** altura de UMA caixa de exemplo (v2) */
  exampleH: number
  /** distribuição dos exemplos na coluna da direita (v2) */
  examples: { y0: number; step: number; h: number }
  watchOutY: number
  watchOutH: number
}

const TABLE_W = 4.42

/** Coluna esquerda (regra + tabela) e direita (exemplos + watch out). */
export function planGrammar(input: {
  rule: string
  /** células por linha (sem o cabeçalho) — usadas para MEDIR a quebra real */
  tableCells?: string[][]
  tableHeaders?: string[]
  tableRows?: number
  examples: string[]
  hasWatchOut: boolean
}): GrammarPlan {
  const avail = BODY_BOTTOM - BODY_Y
  const cells = input.tableCells ?? []
  const nRows = cells.length || input.tableRows || 0
  const rows = nRows > 0 ? nRows + 1 : 0 // + cabeçalho
  const cols = Math.max(1, input.tableHeaders?.length ?? cells[0]?.length ?? 2)
  const colW = TABLE_W / cols
  const allRows = input.tableHeaders ? [input.tableHeaders, ...cells] : cells

  // Medição por fonte: célula longa QUEBRA e empurra a tabela para fora
  // (M6A2, 21/07 — a 1ª conta usava ~31 caracteres por célula, mas na largura
  // real cabem ~15 com 11.5pt). Tenta a maior fonte que couber.
  const FONTS: Array<{ size: number; charsPerInch: number; lineH: number }> = [
    { size: 11.5, charsPerInch: 10.5, lineH: 0.16 },
    { size: 10.5, charsPerInch: 11.5, lineH: 0.15 },
    { size: 9.5, charsPerInch: 12.5, lineH: 0.135 },
  ]
  const needFor = (f: { charsPerInch: number; lineH: number }): number => {
    if (rows === 0) return 0
    const perCell = Math.max(8, Math.round(colW * f.charsPerInch))
    const textLines = allRows.reduce(
      (sum, row) => sum + Math.max(1, ...row.map((c) => estLines(String(c ?? ''), perCell))),
      0,
    )
    return textLines * f.lineH + rows * 0.12
  }
  const ruleWanted = Math.max(0.9, estLines(input.rule, 40) * 0.26 + 0.36)
  const ruleMin = 0.8
  let picked = FONTS[FONTS.length - 1]
  let tableNeed = needFor(picked)
  for (const f of FONTS) {
    const need = needFor(f)
    if (need <= avail - BOTTOM_PAD - 0.16 - ruleMin) {
      picked = f
      tableNeed = need
      break
    }
  }
  const ruleH = rows > 0 ? Math.min(ruleWanted, Math.max(ruleMin, avail - BOTTOM_PAD - 0.16 - tableNeed)) : Math.min(ruleWanted, avail)
  const tableY = BODY_Y + ruleH + 0.16
  const tableSpace = BODY_BOTTOM - BOTTOM_PAD - tableY
  const tableFont = picked.size
  // rowH = espaço real dividido pelas linhas (nunca ultrapassa a borda).
  const tableRowH = rows > 0 ? Math.max(0.18, (tableSpace / rows) * 0.98) : 0

  const watchOutH = input.hasWatchOut ? 0.62 : 0
  const watchOutY = BODY_BOTTOM - watchOutH
  const exArea = (input.hasWatchOut ? watchOutY - 0.1 : BODY_BOTTOM) - (BODY_Y + 0.06)
  const n = Math.max(1, input.examples.length)
  const exampleStep = Math.min(0.5, exArea / n)
  // v2: a caixa do exemplo e a distribuição dela na coluna saem DAQUI, não do
  // desenho (spec §7-quater, item 20). O v1 ignora estes campos e segue igual.
  const exampleH = Math.min(0.44, Math.max(0.24, exampleStep - 0.06))
  const exBottom = input.hasWatchOut ? watchOutY - 0.1 : BODY_BOTTOM
  const spread = spreadList(BODY_Y + 0.06, input.examples.length, exampleH, exBottom, 0.62)
  return {
    ruleH,
    ruleFont: fitFont(input.rule, TABLE_W, ruleH),
    tableY,
    tableRowH,
    tableFont,
    tableHeaderFont: Math.max(9, tableFont - 1),
    exampleStep,
    exampleFont: exampleStep < 0.34 ? 12 : 13.5,
    exampleH,
    examples: { ...spread, h: Math.min(exampleH, spread.step) },
    watchOutY,
    watchOutH,
  }
}

// ===========================================================================
// PLANOS DO TEMPLATE v2 (spec §7-quater, item 20)
// ===========================================================================
//
// Tudo o que DECIDE uma dimensão do deck v2 mora aqui. O `template-v2.ts` ficou
// com o desenho e só com ele: nenhum `Math.max`/`Math.min` sobrou lá.
//
// POR QUÊ. A quebra confirmada da invariante 0 na 3ª rodada do Sol foi um piso
// reaplicado DEPOIS do plano: o plano previa um rótulo de exercício de 0.0723" e
// o renderer desenhava `Math.max(0.08, …)` — 0.08" —, então o chip do rótulo
// entrava na 1ª pastilha do item (intersecção de 0.00284 in², acima do EPS do
// próprio teste). É a MESMA classe de defeito que originou a Fase 0b (o card de
// vocabulário) e a Fase 0c: uma conta de altura escrita duas vezes, uma no plano
// e outra no desenho, que divergem sob compressão.
//
// A proibição do §2.1 (piso de altura em caixa ancorada no rodapé) generaliza:
// **nenhum piso de dimensão pode ser reaplicado no renderer depois do plano — a
// geometria vem do plano, ponto.** Um `Math.max` aqui dentro é legítimo porque é
// AQUI que a conta fecha; um `Math.max` no desenho é, por construção, uma conta
// que ninguém mediu.

/**
 * Lista que OCUPA a banda em vez de empilhar no topo (Fase 0b, defeito 9).
 *
 * O portão visual achou `warmup` terminando a 40% da altura e `tip` a 73%: os
 * layouts ancoravam tudo no topo, com um passo fixo pequeno, e abandonavam o
 * rodapé — o slide parecia inacabado. Aqui o passo cresce até `maxStep` (limite
 * de legibilidade: item solto demais também é ruim) e o que ainda sobrar é
 * dividido em cima e embaixo, centrando o bloco.
 */
export function spreadList(
  startY: number,
  count: number,
  itemH: number,
  bottom: number,
  maxStep: number,
): { y0: number; step: number } {
  if (count <= 1) {
    return { y0: startY + Math.max(0, (bottom - startY - itemH) / 2), step: maxStep }
  }
  // SEM piso no passo: piso aqui é o mesmo erro do defeito 2 — a lista passaria
  // da borda. Quem cede quando o conteúdo é grande é a altura do item.
  const step = Math.max(0, Math.min(maxStep, (bottom - startY - itemH) / (count - 1)))
  const blockH = (count - 1) * step + itemH
  return { y0: startY + Math.max(0, (bottom - startY - blockH) / 2), step }
}

export interface Rows {
  y0: number
  /** altura de UM item (cresce com a folga, encolhe com a densidade) */
  h: number
  step: number
}

/**
 * Lista que PREENCHE a banda crescendo a altura do item (Fase 0b, defeito 9).
 *
 * `spreadList` distribui itens de altura FIXA; aqui a altura é a variável: com 2
 * objetivos numa banda de 3", cada linha vira uma faixa alta com tipografia
 * maior — composição, não empilhamento no topo. `cap` limita o crescimento (item
 * desproporcional também é feio) e o que sobrar viaja para o respiro.
 */
export function fillRows(
  startY: number,
  bottom: number,
  count: number,
  base: { h: number; gap: number },
  cap = 2.2,
): Rows {
  const n = Math.max(1, count)
  const avail = Math.max(0, bottom - startY)
  const h = Math.min(base.h * cap, Math.max(0, (avail - (n - 1) * base.gap) / n))
  const sobra = Math.max(0, avail - n * h - (n - 1) * base.gap)
  const gap = n > 1 ? base.gap + Math.min(base.gap * 2, sobra / (n - 1)) : base.gap
  const blockH = n * h + (n - 1) * gap
  return { y0: startY + Math.max(0, (avail - blockH) / 2), h, step: h + gap }
}

/** tamanho de corpo proporcional à altura da linha (tipografia acompanha a área) */
export function rowFont(h: number): number {
  if (h >= 1.0) return 19
  if (h >= 0.78) return 17
  if (h >= 0.6) return 16
  if (h >= 0.46) return 15
  if (h >= 0.36) return 13.5
  return 12.5
}

// ------------------------------------------------------------- títulos do v2
export interface TitlePlan {
  font: number
  lines: number
  h: number
}

/**
 * Maior fonte de display (entre `sizes`) cujo título CABE em `room` na largura
 * `w`. Uma regra de medida para TODO título grande do v2 (capa, divisória,
 * missão, fechamento) — a mesma disciplina que o `planCover` do v1 aprendeu no
 * M6A3/M6A4: quem cede é a fonte, nunca a borda.
 *
 * 25/07: a medida passou a ser `fitTitle` (avanço real do glifo + margens
 * internas do PowerPoint). O `Math.min(room, …)` do último degrau saiu junto —
 * ele devolvia uma caixa MENOR que o texto, e é de caixa menor que o texto que
 * nasce fio por dentro de título.
 */
export function planTitle(title: string, w: number, room: number, sizes: number[]): TitlePlan {
  return fitTitle(title, w, room, sizes)
}

export interface HeadPlan {
  titleFont: number
  titleY: number
  titleH: number
  stripY: number
  lines: number
}

/** âncoras verticais do cabeçalho de papel (subiram junto com a facecam) */
export const HEAD_EYEBROW_Y = 0.4
export const HEAD_TITLE_Y = 0.68

/**
 * Cabeçalho do slide de conteúdo: eyebrow, título e fio, na faixa que sobra ao
 * lado da facecam (`w`), terminando antes da borda de baixo da câmera
 * (`camBottom`).
 *
 * O fio vem SEMPRE logo abaixo do título, com teto: é a mesma regra que o v1
 * aprendeu na capa (M6A3/M6A4, 21/07) — fio em altura fixa fica solto sob
 * título curto e é atropelado por título longo. O teto garante que o cabeçalho
 * nunca invada o corpo: quem cede é o cabeçalho, nunca a banda de conteúdo.
 */
export function planHead(title: string, w: number, camBottom: number, big = false): HeadPlan {
  const TITLE_Y = HEAD_TITLE_Y
  const GAP = 0.1
  const STRIP_H = 0.035
  const STRIP_MAX = camBottom - 0.06 - STRIP_H
  const room = STRIP_MAX - GAP - TITLE_Y
  // `big` é a DIVISÓRIA (spec §7-ter.2, ajuste 12): mesmo lugar, mesma faixa,
  // mesma âncora dos outros layouts — o que muda é a escada de tamanhos, porque
  // ali o título é o slide inteiro. A medida é a mesma: quem cede é a fonte.
  // a escada da divisória é a MESMA do conteúdo, com degraus grandes por cima:
  // assim um título longo de divisória nunca fica MENOR que o mesmo título num
  // slide de conteúdo (a degradação é contínua, não uma escada paralela)
  const NORMAIS = [26, 23.5, 21, 18.5]
  const sizes = big ? [40, 34, 29, ...NORMAIS] : NORMAIS
  // `fitTitle` garante `h <= room`, então `TITLE_Y + h + GAP <= STRIP_MAX` por
  // construção — o antigo `Math.min(STRIP_MAX, …)` era exatamente a ferida:
  // quando a caixa passava do teto, ele PUXAVA o fio para dentro do título em
  // vez de reduzir a fonte.
  const plan = fitTitle(title, w, room, sizes)
  return {
    titleFont: plan.font,
    titleY: TITLE_Y,
    titleH: plan.h,
    stripY: TITLE_Y + plan.h + GAP,
    lines: plan.lines,
  }
}

export interface NightBlockPlan {
  eyebrowY: number
  titleY: number
  titleH: number
  titleFont: number
  stripY: number
  subtitleY: number
}

/**
 * Bloco de título dos slides noturnos (capa, divisória, missão, fechamento),
 * ancorado pela BASE: o texto cresce para cima a partir de `baseline` e nunca
 * passa de `top`.
 */
export function planNightBlock(input: {
  title: string
  hasSubtitle: boolean
  w: number
  top: number
  baseline: number
  sizes?: number[]
}): NightBlockPlan {
  const SUB_H = 0.46
  const STRIP_H = 0.035
  const EYE_H = 0.3
  const subtitleY = input.baseline - (input.hasSubtitle ? SUB_H : 0)
  const stripY = subtitleY - (input.hasSubtitle ? 0.18 : 0) - STRIP_H
  const titleBottom = stripY - 0.16
  const room = Math.max(0.34, titleBottom - input.top - EYE_H - 0.08)
  const plan = planTitle(input.title, input.w, room, input.sizes ?? [40, 34, 29, 25, 21])
  const titleY = titleBottom - plan.h
  return {
    eyebrowY: titleY - EYE_H - 0.06,
    titleY,
    titleH: plan.h,
    titleFont: plan.font,
    stripY,
    subtitleY,
  }
}

/**
 * Onde começa a rampa de véu da CAPA. Não é 2.5" fixo: quando o bloco de título
 * sobe (título de 3 linhas), a rampa tem de subir junto, senão ela corta o
 * eyebrow ao meio e a mesma linha fica metade no claro e metade no escuro.
 */
export function planScrimRamp(eyebrowY: number, teto = 2.5): number {
  return Math.min(teto, eyebrowY - 0.12)
}

// ------------------------------------------------------------ listas do papel
export interface ObjectivesPlan {
  rows: Rows
  /** lado do chip de check */
  chip: number
  font: number
}

/** OBJETIVOS — linhas que crescem para ocupar a banda, com o chip proporcional */
export function planObjectives(count: number, top: number, bottom: number): ObjectivesPlan {
  const rows = fillRows(top, bottom, count, { h: 0.52, gap: 0.1 })
  return { rows, chip: Math.min(0.46, Math.max(0.36, rows.h * 0.5)), font: rowFont(rows.h) }
}

export interface CheckRowPlan {
  /** lado do quadradinho marcável */
  box: number
  font: number
}

/**
 * Linha marcável de altura DADA. O `checkboxRow` do v1 tem linha fixa de 0.38" e,
 * no máximo do contrato, a última linha caía fora do corpo; aqui a caixa e a
 * fonte acompanham a altura disponível.
 */
export function planCheckRow(h: number): CheckRowPlan {
  return {
    box: Math.max(0.16, Math.min(0.26, h - 0.06)),
    // a tipografia acompanha a linha: linha alta com fonte de linha baixa é o
    // "card meio vazio" que o portão visual reclamou
    font: h >= 0.62 ? 15 : h >= 0.5 ? 14 : h >= 0.36 ? 12.5 : h >= 0.3 ? 11.5 : 10.5,
  }
}

export interface CheckItemsPlan {
  cols: number
  rows: number
  colW: number
  grid: Rows
}

/** itens marcáveis: 1 coluna até 5 itens, 2 colunas acima disso */
export function planCheckItems(
  count: number,
  area: { y: number; w: number; bottom: number },
  colGap: number,
): CheckItemsPlan {
  const cols = count > 5 ? 2 : 1
  const rows = Math.ceil(count / cols)
  const colW = cols === 1 ? area.w : (area.w - colGap) / 2
  // a linha CRESCE para ocupar a área e cede altura quando a área é curta; a
  // lista nunca passa da borda (defeito 9)
  return { cols, rows, colW, grid: fillRows(area.y, area.bottom, rows, { h: 0.38, gap: 0.08 }, 2.0) }
}

export interface RecapPlan {
  twoCols: boolean
  rows: number
  grid: Rows
  chip: number
  font: number
}

export function planRecap(count: number, top: number, bottom: number): RecapPlan {
  const twoCols = count > 4
  const rows = Math.ceil(count / (twoCols ? 2 : 1))
  const grid = fillRows(top, bottom, rows, { h: 0.46, gap: 0.1 })
  return {
    twoCols,
    rows,
    grid,
    chip: Math.min(0.42, Math.max(0.32, grid.h * 0.46)),
    font: Math.min(rowFont(grid.h), twoCols ? 15 : 17),
  }
}

// ------------------------------------------------------------ recorte de foto
/**
 * RECORTE "COVER" — que pedaço da foto entra na caixa, em FRAÇÃO da foto.
 *
 * Contexto (defeito da capa em retrato, 25/07). O comentário da `cover` do
 * `template-v2.ts` dizia que "a biblioteca é 16:9, exatamente a proporção da
 * página". É falso: das 360 fotos, 359 estão fora de 16:9 — 186 em 3:2
 * (1264×848), 134 em 1:1 (1024×1024) e 19 em RETRATO 2:3, nove delas usadas
 * como CAPA. E a premissa também não salvava nada, porque o `sizing: cover` do
 * pptxgenjs nunca recortou coisa alguma sob Node (ver `image-size.ts`): a foto
 * era ESTICADA até a caixa. Uma foto 2:3 numa página 16:9 sai deformada em
 * 2,65× no eixo horizontal — foi isso que o dono viu e chamou de "foto
 * esticada".
 *
 * Aqui a conta é a do CSS `object-fit: cover`: a foto é escalada pelo lado que
 * falta e o excedente do outro lado é cortado. `anchor` diz ONDE cortar, em
 * fração (0 = mostra o começo, 0.5 = centro, 1 = mostra o fim).
 */
export interface PhotoCrop {
  /** fração cortada de cada lado da FOTO */
  l: number
  r: number
  t: number
  b: number
}

export function planPhotoCrop(
  img: { w: number; h: number },
  box: { w: number; h: number },
  anchor: { x?: number; y?: number } = {},
): PhotoCrop {
  const imgAspect = img.w / img.h
  const boxAspect = box.w / box.h
  // fração VISÍVEL da foto em cada eixo: um dos dois é sempre 1 (o lado que
  // encosta), o outro é o que sobra depois de escalar
  const vx = imgAspect > boxAspect ? boxAspect / imgAspect : 1
  const vy = imgAspect > boxAspect ? 1 : imgAspect / boxAspect
  const ax = Math.min(1, Math.max(0, anchor.x ?? 0.5))
  const ay = Math.min(1, Math.max(0, anchor.y ?? 0.5))
  const cortaX = 1 - vx
  const cortaY = 1 - vy
  return { l: cortaX * ax, r: cortaX * (1 - ax), t: cortaY * ay, b: cortaY * (1 - ay) }
}

/**
 * ÂNCORA VERTICAL da foto de CAPA.
 *
 * A capa é o único quadro que perde muita altura: 16:9 é o formato mais
 * deitado do deck e a biblioteca tem retrato 2:3, que entrega só 37,7% da
 * altura. A âncora sobe um pouco acima do centro, na proporção do que se
 * perde — quanto mais alta a foto, mais alto o corte.
 *
 * ESCOLHA MEDIDA, não gosto: as nove capas em retrato foram conferidas com as
 * três janelas desenhadas por cima do arquivo (0.38 derivada, 0.50 centro,
 * 0.62 abaixo do centro). Só a derivada mantém as NOVE cabeças inteiras; o
 * centro já corta a testa da viajante do `m5-v2/lost-tourist.jpg` (topo da
 * cabeça em 25,2% do arquivo, borda do centro em 31,1%). O preço, honesto: em
 * `street-signs`/`street-corner` o sujeito fica no terço de baixo, que na capa
 * é onde mora o véu do título — mas rosto meio velado é menos pior que rosto
 * decepado, e é o defeito que o dono nomeou (M5A1, M5A4).
 *
 * Foto deitada ou quadrada não perde altura nenhuma (`vy = 1`), então a
 * fórmula devolve 0.5 e nada muda para as 341 fotos que já estavam bem.
 */
export function ancoraDaCapa(img: { w: number; h: number }, box: { w: number; h: number }): number {
  const vy = img.w / img.h > box.w / box.h ? 1 : (img.w / img.h) / (box.w / box.h)
  // vy = 1 → 0.5 (centro); vy = 0.377 (retrato 2:3) → 0.38
  return 0.5 - 0.19 * (1 - vy)
}

// ------------------------------------------------------------------- warm up
export interface WarmupPlan {
  /** fonte do cartão do prompt */
  font: number
  /** altura do cartão do prompt */
  h: number
  /** onde o cartão termina (é daí que a lista começa) */
  bottom: number
}

/**
 * WARM UP — o prompt é MEDIDO contra o que os itens precisam.
 *
 * Com o teto de 400 caracteres do contrato um prompt longo empurraria a lista
 * para fora da banda; aqui a fonte do prompt cede primeiro e o cartão nunca
 * invade o espaço dos itens.
 */
export function planWarmup(input: {
  /** prompt já em texto plano */
  prompt: string
  w: number
  top: number
  bottom: number
  items: number
  hasPhoto: boolean
}): WarmupPlan {
  // quanto os itens precisam para continuar legíveis (linha de 0.4" é o piso
  // confortável do `checkRow`); o prompt fica com o resto
  const linhas = Math.ceil(input.items / (input.items > 5 ? 2 : 1))
  const precisam = input.items ? linhas * 0.4 + 0.16 : 0
  const teto = Math.max(0.62, input.bottom - input.top - precisam)
  // sem itens o prompt é o protagonista e ocupa a banda; com itens ele cede
  const escada = input.hasPhoto ? [15, 13.5, 12.5, 11.5] : [19, 17, 15, 13.5, 12.5]
  const font =
    escada.find((f) => alturaDoCartao(input.prompt, input.w, f) <= teto) ?? escada[escada.length - 1]
  const minH = input.items ? 0.62 : input.bottom - input.top
  const h = Math.max(Math.min(minH, teto), Math.min(teto, alturaDoCartao(input.prompt, input.w, font)))
  return { font, h, bottom: input.top + h }
}

/** altura que o cartão de prompt QUER ter com aquela fonte (antes do teto) */
function alturaDoCartao(texto: string, w: number, font: number): number {
  return wrapLines(texto, charsPerLine(w - 0.34, font)) * font * 0.0195 + 0.3
}

// ------------------------------------------------------------- vocabulário
/**
 * Colunas da grade de vocabulário. É a régua do v1 (`template.ts`), que o
 * portão visual de 24/07 declarou MELHOR que a do v2: 3–4 cards por linha,
 * cards do mesmo tamanho, nenhum órfão de linha com 4 cards.
 */
export function vocabCols(n: number): number {
  return n > 6 ? 4 : n > 4 ? 3 : Math.max(1, n)
}

export interface VocabGridPlan {
  cols: number
  rows: number
  cardW: number
  cardH: number
  gapX: number
  gapY: number
  y0: number
}

/** grade UNIFORME de cards, centrada na área (nunca passa da borda) */
export function planVocabGrid(
  count: number,
  cols: number,
  area: { y: number; w: number; h: number },
  /**
   * Teto de altura do card. Sem teto explícito: uma linha só OCUPA a área toda
   * (senão sobra meia banda vazia — defeito 9), duas ou mais respeitam 1.6".
   */
  maxH?: number,
): VocabGridPlan {
  const c = Math.max(1, Math.min(cols, count))
  const rows = Math.ceil(count / c)
  const gapX = 0.18
  const gapY = 0.16
  const cardW = (area.w - (c - 1) * gapX) / c
  const cardH = Math.min(maxH ?? (rows === 1 ? area.h : 1.6), (area.h - (rows - 1) * gapY) / rows)
  const gridH = rows * cardH + (rows - 1) * gapY
  return { cols: c, rows, cardW, cardH, gapX, gapY, y0: area.y + Math.max(0, (area.h - gridH) / 2) }
}

// -------------------------------------------------------------------- listening
export interface ListeningPlan {
  /** moldura do vídeo em 16:9, até onde a coluna permitir */
  videoH: number
  /** chip do link, embaixo da moldura */
  chipH: number
  /** diâmetro do botão de play */
  play: number
  /** faixa da tarefa no cartão de itens */
  taskH: number
}

export function planListening(videoW: number, top: number, bottom: number): ListeningPlan {
  const chipH = 0.46
  return {
    // a moldura ocupa a coluna até a borda do corpo — o chip do link fecha
    // embaixo (defeito 9); com coluna larga o 16:9 é que manda
    videoH: Math.min(videoW * (9 / 16), bottom - top - 0.16 - chipH),
    chipH,
    play: 0.66,
    taskH: 0.6,
  }
}

// ------------------------------------------------------------------------ quiz
export interface QuizRow {
  y: number
  /** caixa da pergunta */
  qh: number
  /** altura do bloco inteiro (pergunta + resposta) */
  h: number
  /** lado do chip numerado */
  chipH: number
  /** caixa da resposta (0 na tela sem gabarito) */
  answerH: number
}

export interface QuizPlan {
  fontQ: number
  fontA: number
  rows: QuizRow[]
}

/**
 * QUIZ — a tipografia CRESCE até preencher a banda (defeito 9) e o bloco fica
 * centrado; quando não cabe, tudo comprime pelo mesmo fator.
 */
export function planQuiz(input: {
  questions: Array<{ q: string; answer?: string }>
  showAnswers: boolean
  top: number
  bottom: number
  textW: number
}): QuizPlan {
  const { questions, showAnswers, textW } = input
  const n = questions.length
  const avail = input.bottom - input.top
  /** altura de cada bloco pergunta(+resposta) num certo tamanho de fonte */
  const medir = (fq: number) => {
    // na tela de respostas a RESPOSTA é o protagonista: fonte maior que a
    // pergunta (que ali é só lembrete). Na inspeção do M5A1 a resposta saiu
    // menor que a pergunta e virou letra miúda.
    const fa = showAnswers ? fq + 1.5 : fq
    const ql = questions.map((q) => wrapLines(q.q, charsPerLine(textW, fq)))
    const al = questions.map((q) =>
      showAnswers ? wrapLines(q.answer ?? '—', charsPerLine(textW - 0.34, fa)) : 0,
    )
    const hs = questions.map(
      (_, i) => ql[i] * fq * 0.019 + 0.06 + (showAnswers ? al[i] * fa * 0.021 + 0.06 : 0.04),
    )
    return { fq, fa, ql, hs, total: hs.reduce((a, b) => a + b, 0) }
  }
  const LADDER = showAnswers ? [15, 13.5, 12, 11] : [17, 15.5, 14, 13, 12]
  const GAP_MIN = 0.1
  let m = medir(LADDER[LADDER.length - 1])
  for (const fq of LADDER) {
    const tentativa = medir(fq)
    if (tentativa.total + (n - 1) * GAP_MIN <= avail) {
      m = tentativa
      break
    }
  }
  const need = m.total + (n - 1) * GAP_MIN
  const k = need <= avail ? 1 : avail / need
  // a folga que sobrar vira respiro entre as perguntas e o bloco fica centrado
  const gap = n > 1 ? GAP_MIN + Math.max(0, Math.min(1.1, (avail - need) / (n - 1))) : GAP_MIN
  const bloco = m.total + (n - 1) * gap
  let y = input.top + Math.max(0, (avail - bloco) / 2)
  const rows: QuizRow[] = questions.map((_, i) => {
    const h = m.hs[i] * k
    const qh = (m.ql[i] * m.fq * 0.019 + 0.06) * k
    const row: QuizRow = {
      y,
      qh,
      h,
      chipH: Math.min(0.3, Math.max(0.12, qh - 0.06)),
      answerH: showAnswers ? Math.max(0.16, h - qh) : 0,
    }
    y += h + gap * k
    return row
  })
  return { fontQ: k < 0.86 ? m.fq - 1.5 : m.fq, fontA: m.fa, rows }
}

// --------------------------------------------------------------------- missão
/**
 * PISO de entrelinha (Fase 0b, defeito 3). `font * 0.0148` ≈ entrelinha 1.07 —
 * já apertado; abaixo disso as letras se encostam. Antes o último recurso do
 * `planSteps` dividia a área pelo total de linhas SEM piso: com 6 passos longos
 * o entrelinha ia a ~0.09" e o texto virava um borrão que só passava no teste
 * porque "cabia".
 */
export const STEP_LINE_FLOOR = 0.0148

/**
 * MASSA DA LINHA (altura-de-x), em polegadas por PONTO de corpo.
 *
 * A proximidade não é julgada entre as bordas do "em" — é julgada entre as
 * FAIXAS DE MASSA das linhas, porque ascendente e descendente são esparsas e
 * não formam borda visível. Medido no PNG do M3 a 100 dpi (o cartaz que o dono
 * reprovou): a faixa densa de cada linha tem 9 px com corpo de 11.5pt, cujo em
 * mede 16 px → 0.56 em. Este é o número que fecha a conta do defeito: com ele o
 * cartaz do M3 media 1.9× de agrupamento (o dono mediu 1.8× na imagem), e é por
 * medir contra o em — e não contra a massa — que a régua antiga dizia 3.6× e não
 * via defeito nenhum durante quatro missões.
 */
export const MASSA_LINHA = 0.56 / 72

/**
 * Vão DENTRO de um passo: o branco entre a massa de duas linhas do MESMO passo.
 * É o que a entrelinha (`lineH`) deixa sobrar depois da massa da linha.
 */
export function vaoDentroDoPasso(font: number, lineH: number): number {
  return Math.max(0, lineH - font * MASSA_LINHA)
}

/**
 * RESPIRO ENTRE PASSOS — a caixa vazia que o desenho deixa entre um passo e o
 * seguinte. DERIVADO de `vaoDentroDoPasso` por `AGRUPAMENTO`, nunca escrito à
 * mão: o vão ENTRE passos (respiro + o branco da entrelinha, que é o que a
 * aluna enxerga) sai exatamente `AGRUPAMENTO ×` o vão DENTRO do passo, em
 * qualquer corpo e em qualquer nível de compressão.
 */
export function respiroEntrePassos(font: number, lineH: number): number {
  return (AGRUPAMENTO - 1) * vaoDentroDoPasso(font, lineH)
}

export interface StepsPlan {
  font: number
  lines: number[]
  lineH: number
  /** a caixa vazia ENTRE duas caixas de passo (o que o desenho soma ao cursor) */
  gap: number
  /** vão DENTRO do passo: massa da linha N → massa da linha N+1 do mesmo passo */
  gapDentro: number
  /** vão ENTRE passos, na MESMA régua: `gap` + o branco da entrelinha */
  gapEntre: number
  /**
   * Quantos passos deste plano cabem NESTA área. Menor que `steps.length`
   * significa que a missão continua em outro slide — nunca que passos foram
   * escondidos (Fase 0b, defeito 3).
   *
   * ZERO é resposta legítima e quer dizer "nem UM passo cabe aqui": quem chama
   * decide o que fazer (o `mission` estoura, porque um cartaz sem passo nenhum
   * não é um slide). Até a Fase 0c isto era `Math.max(1, fits)` — o "força a
   * caber" que a spec §7-ter.3 (achado 16) manda tirar.
   */
  fits: number
}

/**
 * Escada de corpo dos passos, do maior ao piso. O cartaz da missão é um slide
 * de UMA coisa só: os passos podem crescer até 16pt quando cabem (na inspeção
 * da Fase 0c, 3 passos curtos a 13.5 ficavam perdidos na coluna).
 */
const STEP_SIZES = [16, 14.5, 13.5, 12.5, 11.5, 10.5, 9.5] as const

/** o piso da escada: abaixo dele a degradação é de entrelinha, nunca de corpo */
export const STEP_FONT_FLOOR = STEP_SIZES[STEP_SIZES.length - 1]

/**
 * Passos numerados de uma missão numa coluna de largura `w`, entre `top` e
 * `bottom`.
 *
 * A fonte devolvida vale para a LISTA INTEIRA — é medida pelo passo mais
 * exigente e nenhum passo pode sair diferente dos irmãos (Fase 0d). Numa lista
 * numerada, corpo é hierarquia: um passo menor lê como rodapé.
 *
 * AGRUPAMENTO (item 18) — o respiro entre passos NÃO é mais um parâmetro de quem
 * chama (era `gap = 0.1`, um número redondo escrito à mão que não olhava para a
 * entrelinha): ele é DERIVADO da entrelinha por `AGRUPAMENTO`. Com o 0.1 fixo, o
 * cartaz de seis passos saía com o vão entre passos quase igual ao vão entre as
 * duas linhas do mesmo passo (1.9× medido no M3, mínimo 2.5×) e os seis passos
 * liam como um parágrafo corrido. Como a derivação é proporcional, o respiro
 * acompanha a compressão da entrelinha e a razão sobrevive ao último recurso.
 *
 * Ordem de degradação: fonte cai até o piso (9.5) → entrelinha comprime até o
 * PISO (o respiro comprime JUNTO, mantendo a razão). Se ainda não couber, `fits`
 * diz quantos passos entram e o `mission` abre um segundo slide. Reduzir o
 * número de passos VISÍVEIS não é opção: o passo que falta é trabalho que a
 * aluna não faz — e afrouxar o agrupamento também não, porque um cartaz que lê
 * como parágrafo já custou quatro missões.
 */
export function planSteps(
  steps: string[],
  w: number,
  top: number,
  bottom: number,
  /**
   * TETO de corpo. É o que trava a continuação da missão no corpo da primeira
   * página: sem ele, 4 passos no teto do contrato saíam com os passos 1 a 3 a
   * 9.5pt e o passo 4, sozinho no slide seguinte, a 14.5pt — irmãos da MESMA
   * lista numerada em corpos diferentes, o mesmo defeito que a Fase 0d fechou
   * no cartaz de um slide só.
   */
  maxFont: number = STEP_SIZES[0],
): StepsPlan {
  const n = Math.max(1, steps.length)
  const avail = Math.max(0.2, bottom - top)
  const plano = (font: number, lines: number[], lineH: number, fits: number): StepsPlan => {
    const gapDentro = vaoDentroDoPasso(font, lineH)
    const gap = respiroEntrePassos(font, lineH)
    return { font, lines, lineH, gap, gapDentro, gapEntre: gap + gapDentro, fits }
  }
  for (const font of STEP_SIZES) {
    if (font > maxFont) continue
    const lines = steps.map((t) => wrapLines(`9.  ${t}`, charsPerLine(w, font)))
    const lineH = font * 0.0172
    const need =
      lines.reduce((a, l) => a + l * lineH, 0) + (n - 1) * respiroEntrePassos(font, lineH)
    if (need <= avail) return plano(font, lines, lineH, steps.length)
  }
  // Último recurso: comprime o entrelinhas ATÉ O PISO — e o respiro comprime
  // JUNTO, porque ele é derivado dela. Antes o respiro fechava primeiro (ia a
  // zero) e os passos encostavam uns nos outros justamente no cartaz mais
  // cheio, que é onde separar item de item mais importa. O que não couber
  // transborda para o slide seguinte.
  const font = Math.min(maxFont, STEP_FONT_FLOOR)
  const lines = steps.map((t) => wrapLines(`9.  ${t}`, charsPerLine(w, font)))
  const total = Math.max(1, lines.reduce((a, l) => a + l, 0))
  const floorH = font * STEP_LINE_FLOOR
  // `total·lineH + (n−1)·(AGRUPAMENTO−1)·(lineH − massa) = avail`, resolvido em
  // `lineH` e travado no piso: é a maior entrelinha que ainda paga o respiro do
  // contrato dentro da área.
  const k = (AGRUPAMENTO - 1) * (n - 1)
  const lineH = Math.max(floorH, (avail + k * font * MASSA_LINHA) / (total + k))
  const gap = respiroEntrePassos(font, lineH)
  let fits = 0
  let used = 0
  for (const l of lines) {
    const need = used + l * lineH + (fits > 0 ? gap : 0)
    if (need > avail + 0.001) break
    used = need
    fits += 1
  }
  return plano(font, lines, lineH, fits)
}

/**
 * Onde o bloco de passos começa para ficar CENTRADO na área (defeito 9): com 3
 * passos curtos o cartaz da missão ficava com um vão de 0.8" no pé.
 */
export function centrarPassos(plan: StepsPlan, top: number, bottom: number): number {
  const blockH =
    plan.lines.slice(0, plan.fits).reduce((a, l) => a + l * plan.lineH, 0) +
    Math.max(0, plan.fits - 1) * plan.gap
  return top + Math.max(0, (bottom - top - blockH) / 2)
}

/** briefing da missão: cresce com o texto, com teto na borda do noturno */
export function planBriefing(input: {
  /** briefing já em texto plano */
  text: string
  w: number
  font: number
  y: number
  bottom: number
}): { h: number } {
  const lines = wrapLines(input.text, charsPerLine(input.w, input.font))
  return {
    h: Math.min(
      input.bottom - input.y - 0.2,
      Math.max(0.4, lines * input.font * 0.0172 + 0.08),
    ),
  }
}

// ----------------------------------------------------------------- fechamento
export interface ClosingPlan {
  title: TitlePlan
  stripY: number
  msgY: number
  msgH: number
}

export function planClosing(input: {
  /** manchete já em texto plano */
  headline: string
  w: number
  top: number
  /** topo do chip "NEXT CLASS" */
  chipY: number
  sizes: number[]
}): ClosingPlan {
  const title = planTitle(input.headline, input.w, 1.0, input.sizes)
  const stripY = input.top + title.h + 0.16
  const msgY = stripY + 0.22
  return { title, stripY, msgY, msgH: Math.min(0.6, input.chipY - 0.14 - msgY) }
}

// -------------------------------------------------------------------- diálogo
/**
 * PASTILHA DE FALA — geometria MEDIDA (defeito 2 do lote de 14 aulas, 24/07).
 *
 * Até aqui a pastilha do diálogo tinha altura de LISTA (`fillRows`) e corpo
 * FIXO em 12.5pt: o balão era dimensionado pela contagem de falas, nunca pelo
 * texto que ele carrega. O autor do M4 mediu na mão o que isso custa — uma fala
 * de 61 caracteres quebra em duas linhas na coluna de 5.42" e o texto sai do
 * fundo — e auditou as 32 falas do módulo cortando tudo para ≤54 caracteres.
 * Teto de caractere descoberto por tentativa é o sintoma: quem escreve conteúdo
 * estava fazendo, à mão, a medida que o plano tem de fazer.
 *
 * (E o número dele CONFERE com `charsPerLine`: 5.42 − 2×`padX` = 5.22" cabem
 * 58 caracteres a 12.5pt. 54 passa, 61 não. A régua do template e a medida
 * empírica do autor são a mesma régua.)
 *
 * Agora vale a doutrina de `planVocabCard`/`planWriting`: mede, quebra em
 * linhas, cresce a altura ou baixa o corpo até o piso — e, se nem no piso
 * couber, PAGINA (`fits < total`), nunca vaza.
 */
export const DIALOGUE = {
  /** respiro interno da pastilha (polegadas); vira `margin` em PONTOS no desenho */
  padX: 0.1,
  padY: 0.05,
  /** vão MÍNIMO entre duas pastilhas vizinhas — é piso, não é comprimido */
  gapMin: 0.06,
  /** vão MÁXIMO quando sobra banda (o resto da folga engorda as pastilhas) */
  gapMax: 0.18,
  /** teto de altura de UMA pastilha: com 2 falas curtas o balão vira faixa */
  maxH: 0.9,
  /** escada de corpo da fala; o piso (9.5) é o mesmo do resto do v2 */
  sizes: [12.5, 11.5, 10.5, 9.5],
  /** o nome do falante sai 2pt abaixo da fala (a gramática que já valia) */
  speakerDrop: 2,
  speakerFloor: 8,
  /** entrelinha do corpo — a MESMA constante de `planSteps`/`planBriefing` */
  lineFactor: 0.0172,
  /** escalonamento horizontal das pastilhas (só rítmico: quem identifica é a cor) */
  indent: 0.5,
  /** quantas faixas de cor a paleta do diálogo oferece (ver `DIALOGUE_LANES`) */
  lanes: 4,
} as const

/**
 * FAIXA DE COR DE CADA FALA — sai do NOME do falante, nunca da posição
 * (defeito 1 do lote de 14 aulas, 24/07).
 *
 * A alternância por posição (`i % 2`) pinta o mesmo personagem de duas cores
 * assim que ele fala duas vezes seguidas, ou assim que entra um terceiro
 * falante: no M3 há diálogos com 3 e 4 vozes, e o autor precisou reescrever as
 * cenas para a viajante cair sempre na faixa par. Aqui a cor é do nome: o mesmo
 * nome recebe sempre a mesma faixa, em qualquer posição, e falantes distintos
 * recebem faixas distintas na ordem em que entram em cena.
 *
 * Com mais falantes que faixas a numeração dá a volta (`% lanes`): duas VOZES
 * dividem uma cor — o que a régua proíbe é a mesma voz em duas cores.
 */
export function speakerLanes(speakers: string[], lanes: number = DIALOGUE.lanes): number[] {
  const n = Math.max(1, Math.trunc(lanes))
  const ordem = new Map<string, number>()
  return speakers.map((raw) => {
    // o nome é a chave: espaço e caixa não fazem personagem novo
    const chave = String(raw).trim().toLowerCase()
    if (!ordem.has(chave)) ordem.set(chave, ordem.size)
    return ordem.get(chave)! % n
  })
}

export interface DialogueBubble {
  /** faixa de cor — vem do NOME do falante (`speakerLanes`) */
  lane: number
  /** deslocamento horizontal da pastilha em relação à coluna */
  dx: number
  y: number
  h: number
  /** linhas de texto MEDIDAS — é delas que a altura sai */
  lines: number
}

export interface DialoguePlan {
  /** corpo da fala; vale para o diálogo inteiro (irmãos em corpos diferentes é hierarquia falsa) */
  font: number
  speakerFont: number
  /** entrelinha TRAVADA, em pontos: a altura medida é a altura renderizada */
  lineSpacing: number
  /** respiro interno pedido ao pptx, em PONTOS: [topo, direita, base, esquerda] */
  margin: [number, number, number, number]
  bubbles: DialogueBubble[]
  /** quantas falas cabem NESTA página; `< total` = o diálogo continua em outro slide */
  fits: number
  /** falas oferecidas ao plano */
  total: number
}

/** posiciona as pastilhas já medidas, gastando a folga na altura e depois no vão */
function montarDialogo(
  font: number,
  linhas: number[],
  hs: number[],
  lanes: number[],
  top: number,
  avail: number,
  total: number,
): DialoguePlan {
  const D = DIALOGUE
  const n = hs.length
  const margem: [number, number, number, number] = [
    D.padY * 72,
    D.padX * 72,
    D.padY * 72,
    D.padX * 72,
  ]
  const plano: DialoguePlan = {
    font,
    speakerFont: Math.max(D.speakerFloor, font - D.speakerDrop),
    lineSpacing: font * D.lineFactor * 72,
    margin: margem,
    bubbles: [],
    fits: n,
    total,
  }
  if (n === 0) return plano
  const base = hs.reduce((a, h) => a + h, 0) + (n - 1) * D.gapMin
  const folga = Math.max(0, avail - base)
  // (a) a PASTILHA cresce primeiro, até o teto — é ela que compõe a banda
  // (defeito 9: diálogo de 2 falas colado no topo com o corpo vazio)
  const teto = hs.reduce((m, h) => Math.min(m, Math.max(0, D.maxH - h)), D.maxH)
  const cresce = Math.min(folga / n, teto)
  // (b) o que sobrar vira respiro ENTRE as falas, até o teto do vão
  const gap =
    n > 1 ? D.gapMin + Math.min(D.gapMax - D.gapMin, (folga - cresce * n) / (n - 1)) : D.gapMin
  const alturas = hs.map((h) => h + cresce)
  const blockH = alturas.reduce((a, h) => a + h, 0) + (n - 1) * gap
  let y = top + Math.max(0, (avail - blockH) / 2)
  for (let i = 0; i < n; i++) {
    plano.bubbles.push({
      lane: lanes[i],
      // o escalonamento acompanha a PARIDADE da faixa: com 2 falantes o desenho
      // é o de sempre; com 3+ quem separa é a cor, não o recuo
      dx: lanes[i] % 2 === 0 ? 0 : D.indent,
      y,
      h: alturas[i],
      lines: linhas[i],
    })
    y += alturas[i] + gap
  }
  return plano
}

/**
 * Pastilhas de UM diálogo numa coluna de largura `w`, entre `top` e `bottom`.
 *
 * Ordem de degradação (a de sempre): corpo cai até o piso → a folga some → o
 * que não couber CONTINUA em outro slide (`fits < total`). `fits === 0` é
 * resposta legítima e quer dizer "nem esta fala sozinha cabe aqui": quem chama
 * decide (o renderer estoura, como no `writing`), porque encolher a pastilha
 * abaixo do texto é justamente o defeito que este plano fecha.
 *
 * `lanes` entra de fora quando o diálogo PAGINA: a cor é do falante e não pode
 * recomeçar na página 2. `maxFont` também: a continuação é IRMÃ da primeira
 * tela, e a Fase 0d já registrou no cartaz da missão que a mesma lista em dois
 * corpos diferentes lê como hierarquia falsa — com menos falas, a página 2
 * escolheria um corpo maior que o da página 1.
 */
export function planDialogue(
  lines: Array<{ speaker: string; text: string }>,
  input: { w: number; top: number; bottom: number; lanes?: number[]; maxFont?: number },
): DialoguePlan {
  const D = DIALOGUE
  const lanes = input.lanes ?? speakerLanes(lines.map((l) => l.speaker))
  const avail = Math.max(0, input.bottom - input.top)
  const innerW = Math.max(0.4, input.w - 2 * D.padX)
  const teto = input.maxFont ?? D.sizes[0]
  const escada = D.sizes.filter((f) => f <= teto)
  const sizes = escada.length ? escada : [D.sizes[D.sizes.length - 1]]
  // o nome do falante divide a linha com a fala: quem é medido é o parágrafo
  // inteiro. Medir no corpo da FALA (maior que o do nome, que ainda por cima é
  // negrito num corpo menor) erra para o lado seguro.
  const medir = (font: number): number[] =>
    lines.map((l) => wrapLines(`${l.speaker}   ${l.text}`, charsPerLine(innerW, font)))
  const alturas = (font: number, ls: number[]): number[] =>
    ls.map((n) => n * font * D.lineFactor + 2 * D.padY)
  for (const font of sizes) {
    const ls = medir(font)
    const hs = alturas(font, ls)
    if (hs.reduce((a, h) => a + h, 0) + (hs.length - 1) * D.gapMin <= avail) {
      return montarDialogo(font, ls, hs, lanes, input.top, avail, lines.length)
    }
  }
  // PISO: com o menor corpo, quantas falas cabem inteiras nesta banda?
  const font = sizes[sizes.length - 1]
  const ls = medir(font)
  const hs = alturas(font, ls)
  let fits = 0
  let usado = 0
  for (const h of hs) {
    const need = usado + h + (fits > 0 ? D.gapMin : 0)
    if (need > avail) break
    usado = need
    fits += 1
  }
  return montarDialogo(
    font,
    ls.slice(0, fits),
    hs.slice(0, fits),
    lanes.slice(0, fits),
    input.top,
    avail,
    lines.length,
  )
}
