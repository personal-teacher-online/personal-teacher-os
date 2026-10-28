// Template v2 — INVARIANTES DE DESENHO, um layout por tipo.
//
// Em vez de reproduzir a conta de cada layout no teste (que só provaria que a
// conta é igual a si mesma), aqui o renderer desenha num pptx FALSO que grava
// x/y/w/h de tudo. As invariantes são checadas sobre o que foi desenhado, com
// conteúdo no MÁXIMO do contrato:
//   0. NENHUMA CAIXA INTERSECTA OUTRA, salvo camada declarada (spec §2) — a
//      invariante que faltava na Fase 0a e por isso a colisão tripla do card de
//      vocabulário passou por 806 testes, pelo implementador E pelo revisor;
//   1. nada passa de BODY_BOTTOM (5.06) nos slides de conteúdo;
//   2. nada passa de NIGHT_BOTTOM (5.20) nos slides noturnos, fundo à parte
//      (spec §2.1, ratificado na Fase 0b);
//   3. nada passa da página (5.625);
//   4. a ZONA DA FACECAM fica livre — só o dock ocupa aquele retângulo;
//   5. quando o layout pede foto e a foto não existe, ele degrada para a versão
//      sem foto (nenhuma moldura vazia, nenhuma imagem de aula desenhada).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { carregarSePresente, presente, privado } from './_privado'
import {
  AGRUPAMENTO,
  BODY_BOTTOM,
  BODY_Y,
  CHIPS,
  DIALOGUE,
  STEP_LINE_FLOOR,
  fillRows,
  respiroEntrePassos,
  vaoDentroDoPasso,
  WRITING_MINS_V1,
  WRITING_MINS_V2,
  VOCAB_CARD,
  charsPerLine,
  displayTitleBox,
  planChips,
  planDialogue,
  planVocabCard,
  planWriting,
  speakerLanes,
  wrapLines,
  type WritingBlock,
} from '../src/lib/slides/layout'
import {
  LEN,
  LessonSchema,
  LessonSchemaV2,
  SlideSchemaV2,
  type LessonDoc,
  type SlideSpec,
} from '../src/lib/slides/lesson-schema'
const { DIALOGUE_LANES, FACECAM, FACECAM_BOTTOM, asideSplit, FACECAM_SIDE, FAR_SIDE, HEAD_W, HEAD_X, FACECAM_V2, HEAD_EYEBROW_Y, HEAD_TITLE_Y, MASTER_V2, NIGHT_BOTTOM, missionSteps, planHead, planSteps, planTitle, renderSlideV2, spreadList, vocabCols } = await carregarSePresente(() => import('../src/lib/slides/template-v2'))
const { FONT, T } = await carregarSePresente(() => import('../src/lib/slides/template'))
import type { Pres } from '../src/lib/slides/template'

const PAGE_H = 5.625
const PAGE_W = 10
const MX = 0.42
const EPS = 0.002

/**
 * Papel do objeto no desenho — é o que decide se uma intersecção é CAMADA
 * (legítima) ou COLISÃO (defeito). Sai da própria chamada de desenho, não de uma
 * anotação à parte: assim o teste não pode ser "enganado" por um layout novo.
 */
type Role = 'text' | 'veiled' | 'panel' | 'scrim' | 'frame' | 'photo' | 'mark' | 'table'

interface Obj {
  role: Role
  x: number
  y: number
  w: number
  h: number
  path?: string
  /** o objeto é fundo de página/faixa (foto sangrada, véu)? */
  bleed: boolean
  /** texto plano do objeto (só para `addText`) — é por ele que o teste ACHA um passo */
  text?: string
  /** corpo pedido na caixa, e se a caixa carrega autoajuste do conversor */
  fontSize?: number
  /** família pedida — é por ela que o teste ACHA a caixa de TÍTULO (display) */
  fontFace?: string
  fit?: unknown
  /** corpos declarados RUN a run (um run pode sobrescrever a fonte da caixa) */
  runFonts?: number[]
  /** cores declaradas run a run — é por elas que se lê a COR DO FALANTE */
  runColors?: string[]
  /** cor de preenchimento do shape (a pastilha) */
  fill?: string
  /** margens internas pedidas e entrelinha travada (pontos) */
  margin?: unknown
  lineSpacing?: number
  /** entrelinha em MÚLTIPLO — 0.98 é a assinatura das caixas de TÍTULO */
  lineSpacingMultiple?: number
  /** `false` = a caixa não quebra linha (chip de uma palavra só) */
  wrap?: boolean
  /**
   * ORDEM DE DESENHO (0 = primeiro objeto do slide). É o eixo que faltava na
   * Fase 0b: no pptx quem desenha depois fica POR CIMA, então "o texto está
   * coberto por um painel" só é verdade se o painel vier DEPOIS da foto e ANTES
   * do texto. Sem isso, um painel desenhado ATRÁS da foto absolvia texto colado
   * na foto (spec §7-ter.3, achado 14).
   */
  z: number
}
interface Rec {
  master?: string
  objs: Obj[]
  notes: string[]
}

type AnyOpts = Record<string, unknown>
const fillOf = (o: AnyOpts): AnyOpts | undefined =>
  typeof o.fill === 'object' && o.fill !== null ? (o.fill as AnyOpts) : undefined

function imageRole(path: string): Role {
  if (path.includes('library')) return 'photo'
  return 'mark' // chips, fio da marca, wordmark, símbolo
}

function shapeRole(o: AnyOpts): Role {
  const fill = fillOf(o)
  // véu: preto da noite com transparência — o contraste do texto sobre foto
  if (fill?.color === T.night && typeof fill.transparency === 'number') return 'scrim'
  // moldura do framedImage: retângulo 100% transparente com fio de cabelo
  if (fill?.color === 'FFFFFF' && fill.transparency === 100) return 'frame'
  return 'panel'
}

/**
 * O primeiro argumento do `addText` é uma string OU um array de runs. As duas
 * funções abaixo achatam os dois formatos: o texto plano (para ACHAR a caixa) e
 * as fontes declaradas run a run (para provar que nenhum run reescala um passo
 * por dentro da caixa).
 */
function flatten(t: unknown): string {
  if (typeof t === 'string') return t
  if (Array.isArray(t)) return t.map((r) => flatten((r as AnyOpts)?.text)).join('')
  return ''
}

function runFonts(t: unknown): number[] {
  if (!Array.isArray(t)) return []
  return t
    .map((r) => ((r as AnyOpts)?.options as AnyOpts | undefined)?.fontSize)
    .filter((s): s is number => typeof s === 'number')
}

function runColors(t: unknown): string[] {
  if (!Array.isArray(t)) return []
  return t
    .map((r) => ((r as AnyOpts)?.options as AnyOpts | undefined)?.color)
    .filter((c): c is string => typeof c === 'string')
}

/** pptx de mentira: grava a geometria E o papel de tudo que o renderer desenha */
function recorder(): { pres: Pres; slides: Rec[] } {
  const slides: Rec[] = []
  const pres = {
    defineSlideMaster() {},
    addSlide(opts?: { masterName?: string }) {
      const rec: Rec = { master: opts?.masterName, objs: [], notes: [] }
      slides.push(rec)
      const box = (role: Role, o: AnyOpts): Obj => {
        // GEOMETRIA INVÁLIDA FALHA (spec §7-ter.3, achado 15). O `num()` antigo
        // transformava `h: undefined` e `h: NaN` em ZERO: a caixa sumia da
        // invariante em silêncio e o teste aplaudia um objeto que o pptxgenjs
        // desenharia com altura automática. Aqui é erro.
        const geo = (k: 'x' | 'y' | 'w' | 'h'): number => {
          const v = o[k]
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new Error(
              `geometria inválida em ${role}: ${k}=${String(v)} (x=${String(o.x)} y=${String(o.y)} w=${String(o.w)} h=${String(o.h)})`,
            )
          }
          return v
        }
        const x = geo('x')
        const y = geo('y')
        const w = geo('w')
        const h = geo('h')
        return {
          role,
          x,
          y,
          w,
          h,
          path: typeof o.path === 'string' ? o.path : undefined,
          // fundo: sangra numa dimensão inteira da página (foto full-bleed, véu,
          // bloco lateral de altura cheia) — é o que preenche, não o que informa
          bleed: h >= PAGE_H - 0.01 || w >= PAGE_W - 0.01 || (w >= PAGE_W - 0.9 && h >= 2.0),
          z: rec.objs.length,
        }
      }
      return {
        addText(t: unknown, o: AnyOpts) {
          // texto COM shape carrega o próprio fundo: é cartão + texto num objeto
          rec.objs.push({
            ...box(o.shape ? 'veiled' : 'text', o),
            text: flatten(t),
            fontSize: typeof o.fontSize === 'number' ? o.fontSize : undefined,
            fontFace: typeof o.fontFace === 'string' ? o.fontFace : undefined,
            fit: o.fit,
            runFonts: runFonts(t),
            runColors: runColors(t),
            fill: typeof fillOf(o)?.color === 'string' ? String(fillOf(o)!.color) : undefined,
            margin: o.margin,
            lineSpacing: typeof o.lineSpacing === 'number' ? o.lineSpacing : undefined,
            lineSpacingMultiple:
              typeof o.lineSpacingMultiple === 'number' ? o.lineSpacingMultiple : undefined,
            wrap: typeof o.wrap === 'boolean' ? o.wrap : undefined,
          })
        },
        addShape(_s: unknown, o: AnyOpts) {
          rec.objs.push(box(shapeRole(o), o))
        },
        addImage(o: AnyOpts) {
          // `sizing` MANDA na geometria final. No pptxgenjs `w`/`h` de uma
          // imagem com `sizing` descrevem o tamanho NATURAL do arquivo (é o que
          // alimenta a conta do recorte) e `sizing.w`/`sizing.h` são a caixa que
          // vai para a página — a biblioteca sobrescreve a extensão do shape
          // logo depois de escrever o `srcRect`. Antes do conserto do recorte
          // (25/07) os dois pares eram iguais e a diferença não aparecia; agora
          // aparece, e gravar `w`/`h` faria a invariante 0 medir uma caixa que
          // ninguém desenha. O teste `pptxgenjs desenha a caixa do sizing`
          // (abaixo) prende este modelo ao XML de verdade.
          const sizing = typeof o.sizing === 'object' && o.sizing !== null ? (o.sizing as AnyOpts) : null
          const geo = sizing?.type ? { ...o, w: sizing.w ?? o.w, h: sizing.h ?? o.h } : o
          rec.objs.push(box(imageRole(String(o.path ?? '')), geo))
        },
        addTable(rows: unknown[], o: AnyOpts) {
          if (typeof o.rowH !== 'number' || !Number.isFinite(o.rowH)) {
            throw new Error(`geometria inválida em table: rowH=${String(o.rowH)}`)
          }
          rec.objs.push(box('table', { ...o, h: o.rowH * rows.length }))
        },
        addNotes(t: string) {
          rec.notes.push(t)
        },
      }
    },
  }
  return { pres: pres as unknown as Pres, slides }
}

// ------------------------------------------------------- invariante 0 (colisão)
/**
 * Área de intersecção com banda morta de EPS (0.002" = 0.05 mm) em cada eixo:
 * caixa que ENCOSTA na vizinha (borda comum, como a caixa de resposta e a linha
 * de chips do item seguinte) não é colisão — é vizinhança. Abaixo dessa folga
 * nada é visível em nenhuma resolução de projeção.
 */
const area = (a: Obj, b: Obj): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - EPS) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - EPS)

/** `a` contém `b` (com folga de EPS)? */
const contains = (a: Obj, b: Obj): boolean =>
  b.x >= a.x - EPS &&
  b.y >= a.y - EPS &&
  b.x + b.w <= a.x + a.w + EPS &&
  b.y + b.h <= a.y + a.h + EPS

const sameBox = (a: Obj, b: Obj): boolean =>
  Math.abs(a.x - b.x) < EPS &&
  Math.abs(a.y - b.y) < EPS &&
  Math.abs(a.w - b.w) < EPS &&
  Math.abs(a.h - b.h) < EPS

/** marcas e texto: o que tem de ficar LEGÍVEL, nunca sob nem sobre outro */
const isInk = (r: Role): boolean => r === 'text' || r === 'mark' || r === 'table'
/** o que pode servir de fundo para tinta */
const isBed = (r: Role): boolean => r === 'panel' || r === 'veiled' || r === 'scrim'

/**
 * CAMADAS DECLARADAS — a lista explícita e curta que a spec §2 exige. Qualquer
 * par com área de intersecção > 0 fora daqui é COLISÃO.
 *
 * TODA regra é escrita como `sob` (desenhado ANTES) × `sobre` (desenhado
 * DEPOIS), porque no pptx a ordem de desenho É a ordem de empilhamento. A
 * versão da Fase 0b ignorava esse eixo e olhava só contenção — bastava existir
 * QUALQUER painel contendo o texto para o par ser absolvido, mesmo que o painel
 * estivesse ATRÁS da foto (spec §7-ter.3, achado 14). Como o `vocabCard`
 * desenha painel → foto → texto, uma regressão de parâmetro reabriria a colisão
 * original com a rede aplaudindo.
 *
 *  L1 véu (`scrim`) sobre foto/fundo · e tinta sobre o véu que a cobre;
 *  L2 moldura (`frame`) desenhada logo sobre a foto que ela emoldura;
 *  L3 painel/cartão sob o conteúdo que ele CONTÉM (o cartão é fundo, não vizinho);
 *  L4 cartão (ou texto-com-cartão) sobre foto, inteiro dentro dela;
 *  L5 tinta sobre foto COBERTA por véu/cartão desenhado ENTRE a foto e a tinta;
 *  L6 painel dentro de painel (coluna dentro de moldura).
 */
function camadaDeclarada(a: Obj, b: Obj, todos: Obj[]): string | null {
  const sob = a.z < b.z ? a : b
  const sobre = a.z < b.z ? b : a
  // L1 — o véu só cobre o que foi desenhado ANTES dele; o que vem DEPOIS do véu
  // só é legítimo se o véu de fato o cobrir (é dele que vem o contraste).
  if (sobre.role === 'scrim' && (sob.role === 'photo' || sob.bleed)) return 'L1 véu sobre fundo'
  if (sob.role === 'scrim' && contains(sob, sobre)) return 'L1 tinta sobre véu'
  if (sob.role === 'photo' && sobre.role === 'frame' && sameBox(sob, sobre)) return 'L2 moldura'
  if (sob.role === 'panel' && contains(sob, sobre)) return 'L3 cartão sob conteúdo'
  if (sob.role === 'photo' && contains(sob, sobre)) {
    if (sobre.role === 'panel' || sobre.role === 'veiled') return 'L4 cartão sobre foto'
    if (isInk(sobre.role)) {
      // L5 com ASSOCIAÇÃO e ORDEM: a cama tem de cobrir a tinta E ter sido
      // desenhada depois da foto e antes da tinta. Painel atrás da foto não
      // absolve nada — ele está escondido pela própria foto.
      const cama = todos.some(
        (o) =>
          o !== sobre &&
          o !== sob &&
          isBed(o.role) &&
          o.z > sob.z &&
          o.z < sobre.z &&
          contains(o, sobre) &&
          area(o, sob) > 0,
      )
      if (cama) return 'L5 tinta sobre foto com véu'
    }
  }
  if (sob.role === 'panel' && sobre.role === 'panel' && contains(sob, sobre)) return 'L6 painel em painel'
  return null
}

/** todos os pares que se cruzam SEM camada declarada */
function colisoes(rec: Rec): string[] {
  const out: string[] = []
  for (let i = 0; i < rec.objs.length; i++) {
    for (let j = i + 1; j < rec.objs.length; j++) {
      const a = rec.objs[i]
      const b = rec.objs[j]
      const inter = area(a, b)
      if (inter <= 0) continue
      if (camadaDeclarada(a, b, rec.objs)) continue
      out.push(
        `${a.role}[${a.x.toFixed(2)},${a.y.toFixed(2)},${a.w.toFixed(2)},${a.h.toFixed(2)}] × ` +
          `${b.role}[${b.x.toFixed(2)},${b.y.toFixed(2)},${b.w.toFixed(2)},${b.h.toFixed(2)}] ` +
          `= ${inter.toFixed(4)} in²`,
      )
    }
  }
  return out
}

// ------------------------------------- invariante 0-bis (texto fora do shape)
/**
 * A invariante 0 mede CAIXA contra CAIXA — ela nunca olhou o texto DENTRO da
 * caixa. Foi por esse buraco que a pastilha do diálogo passou: o balão tinha
 * altura de LISTA (contagem de falas) e corpo FIXO, então uma fala de 61
 * caracteres quebrava em duas linhas e o texto saía do fundo — sem cruzar
 * caixa nenhuma, portanto sem acusar nada. O autor do M4 descobriu isso
 * medindo à mão e cortou 32 falas para ≤54 caracteres; teto de caractere
 * achado na tentativa é dívida de renderer, não regra de escrita.
 *
 * A régua é a MESMA de `layout.ts` (`wrapLines` × `charsPerLine` × entrelinha):
 * é ela que o plano usa para decidir a altura, então é ela que tem de ser
 * cobrada no desenho.
 */
const LINE_FACTOR = 0.0172

/** margens internas pedidas ao pptx, em POLEGADAS: [topo, direita, base, esquerda] */
function margens(m: unknown): [number, number, number, number] {
  const pt = (v: number): number => v / 72
  if (typeof m === 'number') return [pt(m), pt(m), pt(m), pt(m)]
  if (Array.isArray(m) && m.length === 4 && m.every((v) => typeof v === 'number')) {
    return [pt(m[0]), pt(m[1]), pt(m[2]), pt(m[3])]
  }
  // sem `margin` o PowerPoint aplica o "Normal": 0.05" em cima/baixo, 0.1" nas laterais
  return [0.05, 0.1, 0.05, 0.1]
}

const corpoDe = (o: Obj): number => Math.max(o.fontSize ?? 0, ...(o.runFonts ?? []), 0)

/** altura que o texto REALMENTE ocupa na caixa, pela régua do `layout.ts` */
function alturaDoTexto(o: Obj): { need: number; lines: number } {
  const font = corpoDe(o)
  const [topo, dir, base, esq] = margens(o.margin)
  const lineH = o.lineSpacing ? o.lineSpacing / 72 : font * LINE_FACTOR
  const lines = o.wrap === false ? 1 : wrapLines(o.text ?? '', charsPerLine(o.w - esq - dir, font))
  return { need: lines * lineH + topo + base, lines }
}

/** todo texto que não cabe no shape que o carrega */
function transbordos(rec: Rec, filtro: (o: Obj) => boolean = () => true): string[] {
  const out: string[] = []
  for (const o of rec.objs) {
    if (!o.text?.trim() || !filtro(o)) continue
    const font = corpoDe(o)
    // caixa sem corpo declarado é caixa que o conversor dimensiona: fora da régua
    if (font <= 0) continue
    const { need, lines } = alturaDoTexto(o)
    if (need > o.h + EPS) {
      out.push(
        `${o.role}[${o.x.toFixed(2)},${o.y.toFixed(2)},${o.w.toFixed(2)},${o.h.toFixed(2)}] ` +
          `${font}pt × ${lines} linha(s) = ${need.toFixed(3)}" > ${o.h.toFixed(3)}" ` +
          `— "${(o.text ?? '').slice(0, 40)}…"`,
      )
    }
  }
  return out
}

// ------------------------------- invariante 0-ter (decoração × caixa do título)
/**
 * A INVARIANTE QUE FALTAVA (25/07).
 *
 * A invariante 0 mede caixa contra caixa e a 0-bis mede o texto DENTRO da caixa
 * — mas só nos objetos que carregam o próprio fundo (`veiled`). O título de
 * papel/noturno é `text` puro, sem fundo, e ficou fora das duas. Foi por esse
 * buraco que o fio-gradiente passou: `planHead`/`planTitle` mediam o título por
 * CONTAGEM DE CARACTERES, davam UMA linha para "THE PILLARS OF FLUENCY", a
 * caixa saía com altura de uma linha, o fio ia para logo abaixo dela — e na
 * página o título quebrava em DUAS, com o fio por dentro da segunda. 51 slides
 * em 33 dos 65 decks, todos aprovados por 806 testes.
 *
 * Aqui a caixa do título é RECALCULADA com a régua de glifo (`displayTitleBox`)
 * e cobrada de duas maneiras:
 *   (a) a caixa DECLARADA contém o texto que ela carrega;
 *   (b) nenhuma MARCA (fio da marca, logo, símbolo, chip) intersecta a caixa
 *       real do título.
 * (b) é a invariante 0 — "nada desenhado intersecta nada" — aplicada ao caso
 * que ela não cobria, porque a colisão não era entre duas caixas declaradas: era
 * entre uma caixa declarada e o texto que vazava dela.
 */
/**
 * O que é TÍTULO aqui: caixa de DISPLAY com a entrelinha travada em 0.98. Não
 * é heurística — é a assinatura das CINCO chamadas que desenham título neste
 * motor (cabeçalho de papel, bloco noturno, cartaz de missão, manchete de
 * fechamento e a capa do v1), e é o único lugar do desenho onde o `y` do fio
 * sai da caixa do texto. Termo de vocabulário e subtítulo de divisória também
 * usam a família display, mas com outra entrelinha e outro planejador — ficam
 * de fora de propósito.
 */
const ehTitulo = (o: Obj): boolean =>
  o.fontFace === FONT.display &&
  o.lineSpacingMultiple === 0.98 &&
  Boolean(o.text?.trim()) &&
  corpoDe(o) > 0

/** a caixa que o título REALMENTE ocupa (a declarada, esticada até caber o texto) */
function caixaRealDoTitulo(o: Obj): Obj {
  const { h } = displayTitleBox(o.text ?? '', o.w, corpoDe(o))
  return { ...o, h: Math.max(o.h, h) }
}

function tituloRiscado(rec: Rec): string[] {
  const out: string[] = []
  const marcas = rec.objs.filter((o) => o.role === 'mark')
  for (const t of rec.objs.filter(ehTitulo)) {
    const real = caixaRealDoTitulo(t)
    const { h: precisa, lines } = displayTitleBox(t.text ?? '', t.w, corpoDe(t))
    if (precisa > t.h + EPS) {
      out.push(
        `título "${(t.text ?? '').slice(0, 34)}…" ${corpoDe(t)}pt × ${lines} linha(s) ` +
          `precisa de ${precisa.toFixed(3)}" e a caixa tem ${t.h.toFixed(3)}"`,
      )
    }
    for (const m of marcas) {
      const inter = area(real, m)
      if (inter <= 0) continue
      out.push(
        `marca[${m.x.toFixed(2)},${m.y.toFixed(2)},${m.w.toFixed(2)},${m.h.toFixed(2)}]` +
          `${m.path ? ` (${m.path.split('/').pop()})` : ''} risca o título ` +
          `"${(t.text ?? '').slice(0, 34)}…" [${real.x.toFixed(2)},${real.y.toFixed(2)},` +
          `${real.w.toFixed(2)},${real.h.toFixed(2)}] = ${inter.toFixed(4)} in²`,
      )
    }
  }
  return out
}

const doc = (over: Partial<LessonDoc> = {}): LessonDoc =>
  ({
    course: 'personal-travel',
    module: { number: 5, title: 'Transportation Guide' },
    lesson: { number: 1, title: 'Getting Around Without Fear', subtitle: 'Sem medo em qualquer transporte' },
    level: 'A1',
    grammarFocus: ['by + transport'],
    slides: [],
    ...over,
  }) as LessonDoc

/** desenha UM spec e devolve os slides gravados */
function draw(spec: SlideSpec, d: LessonDoc = doc()): Rec[] {
  const { pres, slides } = recorder()
  renderSlideV2(pres, d, spec)
  return slides
}

/**
 * Texto de EXATAMENTE `n` caracteres, com palavras de verdade (a quebra de
 * linha do layout é por palavra). É com ele que o "conteúdo máximo" dos testes
 * passa a ser o máximo do CONTRATO v2, e não um número inventado: até a Fase 0b
 * os máximos eram ficção, porque nenhum campo tinha teto (spec §7-ter.3,
 * achado 16).
 */
function texto(n: number): string {
  const base = 'frase longa de teste para medir a quebra real do layout na banda do corpo '
  let out = ''
  while (out.length < n) out += base
  return out.slice(0, n)
}

/** prompt de `unscramble`: palavras separadas por ' / ', no teto do contrato */
function embaralhado(n: number): string {
  const words = ['time', 'What', 'is', 'next', 'the', 'train', 'leaving', 'from', 'platform', 'two', '?']
  let out = ''
  for (let i = 0; out.length < n; i++) {
    const w = words[i % words.length]
    if (out.length + w.length + 3 > n) break
    out += (out ? ' / ' : '') + w
  }
  return out
}

const LONG =
  'Uma frase longa de verdade para forçar a quebra de linha e provar que a medida acontece antes do desenho'

// ------------------------------------------------------ conteúdo no MÁXIMO
/**
 * TODO campo aqui está no TETO do contrato **v2** (`LEN` / `LessonSchemaV2`),
 * não num tamanho escolhido a dedo: se alguém afrouxar um limite, o conteúdo
 * destes testes cresce junto e o layout responde por ele. É o conserto do
 * achado 16 ("os máximos dos testes são ficção"), com o escopo que a Fase 0d
 * lhe deu (item 19): o teto é do v2, e é contra o v2 que ele é cobrado.
 */
const MAX: SlideSpec[] = [
  {
    type: 'cover',
    title: texto(LEN.title),
    subtitle: texto(LEN.line),
    image: { file: 'm5/suitcase-window.jpg' },
  },
  { type: 'objectives', title: texto(LEN.title), items: Array.from({ length: 5 }, () => texto(LEN.line)) },
  {
    type: 'warmup',
    title: texto(LEN.title),
    prompt: texto(LEN.block),
    items: Array.from({ length: 10 }, () => texto(LEN.line)),
    image: { file: 'm5/rails-dusk.jpg', caption: texto(LEN.label) },
  },
  {
    type: 'vocab',
    title: texto(LEN.title),
    intro: texto(LEN.line),
    drillHint: texto(LEN.label),
    cards: Array.from({ length: 8 }, (_, i) => ({
      term: texto(LEN.label),
      cue: texto(LEN.label),
      pt: texto(LEN.label),
      image: i % 2 === 0 ? 'vocab/bus.jpg' : undefined,
    })),
  },
  {
    type: 'grammar',
    title: texto(LEN.title),
    rule: texto(240),
    examples: Array.from({ length: 6 }, () => texto(LEN.line)),
    table: {
      headers: [texto(LEN.label), texto(LEN.label), texto(LEN.label)],
      rows: Array.from({ length: 5 }, () => [texto(LEN.label), texto(LEN.label), texto(LEN.label)]),
    },
    watchOut: { wrong: texto(LEN.label), right: texto(LEN.label) },
  },
  {
    type: 'dialogue',
    title: texto(LEN.title),
    context: texto(LEN.line),
    lines: Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 ? 'B' : 'A', text: texto(LEN.line) })),
    glossary: Array.from({ length: 6 }, () => ({ term: texto(LEN.label), pt: texto(LEN.label) })),
  },
  {
    type: 'listening',
    title: texto(LEN.title),
    task: texto(LEN.para),
    videoUrl: null,
    videoHint: texto(LEN.line),
    items: Array.from({ length: 8 }, (_, i) => ({ text: texto(LEN.line), correct: i % 3 === 0 })),
    answers: texto(LEN.notes),
  },
  {
    type: 'speaking',
    title: texto(LEN.title),
    instruction: texto(LEN.para),
    phrases: Array.from({ length: 6 }, () => texto(LEN.line)),
    hint: texto(LEN.line),
  },
  {
    type: 'writing',
    title: texto(LEN.title),
    instruction: texto(LEN.para),
    exercises: [
      {
        kind: 'complete',
        items: Array.from({ length: 3 }, () => ({ prompt: texto(LEN.prompt), answer: texto(LEN.line) })),
      },
      {
        kind: 'unscramble',
        items: Array.from({ length: 3 }, () => ({
          prompt: embaralhado(LEN.prompt),
          answer: texto(LEN.line),
        })),
      },
    ],
  },
  {
    type: 'quiz',
    title: texto(LEN.title),
    intro: texto(LEN.line),
    questions: Array.from({ length: 6 }, () => ({ q: texto(LEN.line), answer: texto(LEN.line) })),
  },
  { type: 'tip', title: texto(LEN.title), text: texto(LEN.tip), image: { file: 'vocab/transport-card.jpg' } },
  {
    type: 'section',
    title: texto(LEN.title),
    kicker: texto(LEN.label),
    subtitle: texto(LEN.line),
    image: { file: 'shared/practice-time.jpg' },
  },
  {
    type: 'mission',
    number: 5,
    title: texto(LEN.title),
    briefing: texto(LEN.block),
    steps: Array.from({ length: 6 }, () => texto(LEN.block)),
  },
  { type: 'recap', title: texto(LEN.title), items: Array.from({ length: 8 }, () => texto(LEN.line)) },
  {
    type: 'closing',
    headline: texto(LEN.title),
    message: texto(LEN.para),
    nextClass: texto(LEN.line),
  },
]

/** conteúdo MÍNIMO do contrato — é onde nasce o espaço morto (defeito 9) */
const MIN: SlideSpec[] = [
  { type: 'cover', title: 'Curto', image: { file: 'm5/suitcase-window.jpg' } },
  { type: 'objectives', items: ['Um', 'Dois'] },
  { type: 'warmup', prompt: 'Vamos começar?', items: ['a', 'b'], image: { file: 'm5/rails-dusk.jpg' } },
  {
    type: 'vocab',
    title: 'Cards',
    cards: [
      { term: 'bus', cue: 'BUS', pt: 'ônibus', image: 'vocab/bus.jpg' },
      { term: 'train', cue: 'TRAIN', pt: 'trem', image: 'vocab/train.jpg' },
      { term: 'ferry', cue: 'FER-ry', pt: 'balsa', image: 'vocab/ferry.jpg' },
    ],
  },
  { type: 'grammar', title: 'Regra', rule: 'Curta.', examples: ['Um exemplo.'] },
  { type: 'dialogue', title: 'Diálogo', lines: [{ speaker: 'A', text: 'Oi' }, { speaker: 'B', text: 'Olá' }] },
  { type: 'listening', task: 'Ouça', videoUrl: null, items: [{ text: 'um', correct: true }] },
  { type: 'speaking', instruction: 'Repita', phrases: ['Um', 'Dois'] },
  {
    type: 'writing',
    instruction: 'Escreva',
    exercises: [{ kind: 'complete', items: [{ prompt: 'a ___ b', answer: 'x' }] }],
  },
  { type: 'quiz', questions: [{ q: 'Pergunta curta?', answer: 'Sim.' }, { q: 'Outra?', answer: 'Não.' }] },
  { type: 'tip', text: 'Dica curta.', image: { file: 'vocab/transport-card.jpg' } },
  { type: 'section', title: 'PRACTICE TIME', image: { file: 'shared/practice-time.jpg' } },
  { type: 'mission', number: 5, title: 'Missão', briefing: 'Briefing curto.', steps: ['Um', 'Dois'] },
  { type: 'recap', items: ['Um', 'Dois'] },
  { type: 'closing' },
]

const invadeFacecam = (o: Obj): boolean =>
  o.x < FACECAM.x + FACECAM.w - EPS &&
  o.x + o.w > FACECAM.x + EPS &&
  o.y < FACECAM.y + FACECAM.h - EPS &&
  o.y + o.h > FACECAM.y + EPS

const isDock = (o: Obj): boolean =>
  Math.abs(o.x - FACECAM.x) < EPS &&
  Math.abs(o.y - FACECAM.y) < EPS &&
  Math.abs(o.w - FACECAM.w) < EPS &&
  Math.abs(o.h - FACECAM.h) < EPS

describe.skipIf(!presente)('geometria da facecam (spec §3)', () => {
  it('16:9, 28% da largura e RESPIRO real até o corpo (ajuste 11)', () => {
    expect(FACECAM.w / FACECAM.h).toBeCloseTo(16 / 9, 3)
    expect(FACECAM.w / 10).toBeCloseTo(0.28, 5)
    expect(FACECAM_BOTTOM).toBeCloseTo(FACECAM_V2.m + FACECAM_V2.h, 5)
    // era 0.025" (a câmera encostada nos cards, reprovado de olho pelo dono);
    // o piso agora é 0.12", e a câmera continua acima do corpo
    expect(BODY_Y - FACECAM_BOTTOM).toBeGreaterThanOrEqual(0.12)
    expect(FACECAM_BOTTOM).toBeLessThan(BODY_Y)
    // a câmera subiu, e o cabeçalho subiu junto — o título não paga a conta
    expect(HEAD_EYEBROW_Y).toBeLessThan(HEAD_TITLE_Y)
    expect(HEAD_TITLE_Y + 0.02).toBeLessThan(FACECAM_BOTTOM)
  })

  it('lado ativo é a DIREITA e o cabeçalho nasce na margem esquerda', () => {
    expect(FACECAM_SIDE).toBe('right')
    expect(FAR_SIDE).toBe('left')
    expect(FACECAM.x).toBeCloseTo(PAGE_W - FACECAM_V2.m - FACECAM_V2.w, 5)
    expect(HEAD_X).toBeCloseTo(MX, 5)
    expect(HEAD_W).toBeCloseTo(FACECAM.x - 0.28 - MX, 5)
    // o cabeçalho termina antes da câmera
    expect(HEAD_X + HEAD_W).toBeLessThanOrEqual(FACECAM.x)
  })

  it('o cabeçalho cede espaço, nunca o corpo (o fio nunca passa da facecam)', () => {
    for (const t of [
      'Curto',
      'Getting Around Without Fear',
      'Estruturas Práticas para Pedir Comida Sem Pensar Demais',
      `${LONG} ${LONG}`,
    ]) {
      const p = planHead(t)
      expect(p.stripY + 0.035, t).toBeLessThanOrEqual(FACECAM_BOTTOM + EPS)
      expect(p.titleY + p.titleH, t).toBeLessThanOrEqual(p.stripY + EPS)
      // A CAIXA CONTÉM O TEXTO — é esta a invariante, e é ela que faltava.
      // Aqui morava `expect(p.titleFont).toBeGreaterThanOrEqual(18.5)`. Aquele
      // piso só se sustentava porque o `planHead` antigo GRAMPEAVA a altura da
      // caixa em `room` (`Math.min(room, …)`): devolvia 18.5pt numa caixa MENOR
      // que o texto — que é exatamente como o fio da marca ia parar POR DENTRO
      // do título (51 slides, 33 decks). A faixa do cabeçalho tem 0.96"; um
      // título no TETO do contrato (120 caracteres) precisa de 16pt para caber
      // ali, e a frase de 209 caracteres deste laço (que já passa do teto)
      // precisa de 12pt. Quem cede é a fonte, nunca a borda — e nos 65 decks
      // REAIS o menor cabeçalho é 23.5pt (m0-mission, slide 3).
      expect(displayTitleBox(t, HEAD_W, p.titleFont).h, t).toBeLessThanOrEqual(p.titleH + EPS)
      expect(p.titleFont, t).toBeGreaterThan(0)
      // divisória: mesma faixa, título grande (ajuste 12)
      const big = planHead(t, true)
      expect(big.stripY + 0.035, t).toBeLessThanOrEqual(FACECAM_BOTTOM + EPS)
      expect(big.titleFont, t).toBeGreaterThanOrEqual(p.titleFont)
    }
    expect(planHead('PRACTICE TIME', true).titleFont).toBe(40)
  })
})

/**
 * INVARIANTE 0 — a peça que faltava. Roda em TODOS os tipos, em TODAS as
 * variantes, no conteúdo máximo E no mínimo do contrato: é a combinação que
 * produz card baixo (máximo) e slide vazio (mínimo).
 */
describe.skipIf(!presente)('invariante 0 — nenhuma caixa intersecta outra (spec §2)', () => {
  it('o DECK REAL do M5A1 (o que o dono abriu) não tem uma colisão', () => {
    const real = LessonSchemaV2.parse(
      JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')),
    )
    const { pres, slides } = recorder()
    for (const spec of real.slides) renderSlideV2(pres, real, spec)
    const achados: string[] = []
    slides.forEach((s, i) => {
      for (const c of colisoes(s)) achados.push(`slide ${i + 1}: ${c}`)
    })
    expect(achados, `${achados.length} par(es):\n${achados.join('\n')}`).toEqual([])
    expect(slides.length).toBe(29)
  })

  /**
   * CANÁRIO — prova que o detector está VIVO, não só que os layouts estão limpos.
   *
   * Reconstrói a geometria EXATA do `vocabCard` da Fase 0a num card de 2.93×0.80
   * (a grade de 8 do M5A1): `imgH = h*0.44`, `term` com piso `max(0.2, …)`, `cue`
   * e `pt` ancorados no rodapé do card. Era o que o dono viu no PowerPoint e o
   * que 806 testes, o implementador e o revisor deixaram passar. Se algum dia
   * alguém "simplificar" as camadas declaradas até a invariante virar carimbo,
   * este teste cai.
   */
  it('CANÁRIO: a geometria antiga do card de vocab É reprovada', () => {
    const x = 0.42
    const y = 2.34
    const w = 2.93
    const h = 0.8
    const pad = 0.06
    const imgH = h * 0.44
    const textY = y + imgH + 0.1
    const textH = y + h - 0.08 - textY
    const cueH = 7.5 * 0.024 + 0.06
    const ptH = 9.5 * 0.024 + 0.06
    const antigo: Rec = {
      master: MASTER_V2.paper,
      notes: [],
      // a ORDEM é a real do `vocabCard`: painel → foto → termo → pronúncia →
      // tradução (é o que torna o achado 14 grave: o painel do card está ATRÁS
      // da foto e, na rede antiga, absolvia a pronúncia colada nela)
      objs: [
        { role: 'panel', x, y, w, h, bleed: false, z: 0 },
        { role: 'photo', x: x + pad, y: y + pad, w: w - 2 * pad, h: imgH, bleed: false, path: 'library/vocab/bus.jpg', z: 1 },
        { role: 'text', x, y: textY, w, h: Math.max(0.2, textH - cueH - ptH), bleed: false, z: 2 },
        { role: 'text', x, y: y + h - 0.08 - ptH - cueH, w, h: cueH, bleed: false, z: 3 },
        { role: 'text', x, y: y + h - 0.08 - ptH, w, h: ptH, bleed: false, z: 4 },
      ],
    }
    const c = colisoes(antigo)
    // pronúncia sobre a foto E termo sobre a tradução — a colisão tripla
    expect(c.length, c.join('\n')).toBeGreaterThanOrEqual(2)
    expect(c.some((s) => s.includes('photo'))).toBe(true)
  })

  for (const [nome, specs] of [
    ['máximo', MAX],
    ['mínimo', MIN],
  ] as const) {
    for (const spec of specs) {
      it(`${spec.type} (${nome}): zero colisão`, () => {
        for (const s of draw(spec)) {
          const c = colisoes(s)
          expect(c, `${spec.type} (${nome}) — ${c.length} par(es):\n${c.join('\n')}`).toEqual([])
        }
      })
    }
  }
})

/**
 * O BURACO DO ACHADO 14, em teste. A rede da Fase 0b absolvia este par: existe
 * um painel que CONTÉM o texto, então "está coberto". Só que o painel foi
 * desenhado ANTES da foto — ele está atrás dela, e o texto continua colado na
 * foto, exatamente como o dono viu no card de vocabulário. Com associação e
 * ordem de camada, o par é reprovado.
 */
describe.skipIf(!presente)('invariante 0 modela ORDEM DE DESENHO (spec §7-ter.3, achado 14)', () => {
  const foto = {
    role: 'photo' as const,
    x: 1,
    y: 2,
    w: 2,
    h: 1,
    bleed: false,
    path: 'library/vocab/bus.jpg',
    z: 0,
  }
  // a cama cobre a tinta e vive DENTRO da foto (é um cartão sobre a foto)
  const cama = { role: 'panel' as const, x: 1.1, y: 2.2, w: 1.6, h: 0.4, bleed: false, z: 0 }
  const tinta = { role: 'text' as const, x: 1.2, y: 2.3, w: 1.4, h: 0.2, bleed: false, z: 0 }
  /** a única diferença entre as duas cenas é QUANDO a cama é desenhada */
  const cena = (ordem: 'cama-antes-da-foto' | 'cama-depois-da-foto'): Rec => {
    const objs = ordem === 'cama-antes-da-foto' ? [cama, foto, tinta] : [foto, cama, tinta]
    return { master: MASTER_V2.paper, notes: [], objs: objs.map((o, z) => ({ ...o, z })) }
  }

  it('painel ATRÁS da foto NÃO absolve texto colado na foto', () => {
    const c = colisoes(cena('cama-antes-da-foto'))
    expect(c.join('\n')).toContain('photo')
    expect(c.length).toBeGreaterThanOrEqual(1)
  })

  it('o MESMO painel, desenhado entre a foto e o texto, absolve (L5)', () => {
    expect(colisoes(cena('cama-depois-da-foto'))).toEqual([])
  })

  it('geometria ausente ou NaN FALHA o teste, não vira caixa zero (achado 15)', () => {
    const { pres } = recorder()
    const slide = pres.addSlide({ masterName: MASTER_V2.paper })
    expect(() => slide.addText('x', { x: 1, y: 1, w: 2 } as never)).toThrow(/geometria inválida/)
    expect(() => slide.addText('x', { x: 1, y: 1, w: 2, h: NaN } as never)).toThrow(/geometria inválida/)
    expect(() => slide.addShape('rect', { x: 1, y: 1, w: 2, h: 0.3 } as never)).not.toThrow()
  })
})

describe.skipIf(!presente)('invariantes de borda — cada tipo, conteúdo no máximo do contrato', () => {
  for (const spec of MAX) {
    {
      const v = 0
      it(`${spec.type}: nada passa da borda e a zona da facecam fica livre`, () => {
        const slides = draw(spec)
        expect(slides.length).toBeGreaterThan(0)
        for (const s of slides) {
          expect(s.objs.length).toBeGreaterThan(0)
          for (const o of s.objs) {
            expect(o.h, `${spec.type} v${v}: altura negativa`).toBeGreaterThanOrEqual(0)
            expect(o.y + o.h, `${spec.type} v${v}: passa da página`).toBeLessThanOrEqual(PAGE_H + EPS)
            expect(o.x, `${spec.type} v${v}: sai pela esquerda`).toBeGreaterThanOrEqual(-EPS)
            expect(o.x + o.w, `${spec.type} v${v}: sai pela direita`).toBeLessThanOrEqual(10 + EPS)
          }
          if (s.master === MASTER_V2.paper) {
            // rodapé (>= 5.2) é fora do corpo por desenho
            for (const o of s.objs.filter((o) => o.y < 5.2)) {
              expect(o.y + o.h, `${spec.type} v${v}: ${o.role} passa de BODY_BOTTOM`).toBeLessThanOrEqual(
                BODY_BOTTOM + EPS,
              )
            }
            const dock = s.objs.filter(isDock)
            expect(dock.length, `${spec.type} v${v}: dock da facecam`).toBe(1)
            for (const o of s.objs.filter((o) => !isDock(o))) {
              expect(invadeFacecam(o), `${spec.type} v${v}: ${o.role} invade a facecam`).toBe(false)
            }
          } else {
            // noturno: o texto também começa abaixo da faixa da facecam
            for (const o of s.objs.filter((o) => o.role === 'text' || o.role === 'veiled')) {
              expect(o.y, `${spec.type} v${v}: texto noturno na faixa da facecam`).toBeGreaterThanOrEqual(
                FACECAM_BOTTOM - EPS,
              )
            }
          }
        }
      })
    }
  }
})

/**
 * O limite dos NOTURNOS (spec §2.1, ratificado na Fase 0b): o defeito 4 era de
 * contrato — `NIGHT_BOTTOM` existia no código e nenhum teste o cobria, então o
 * logo em 5.21 passou. Fundo (foto sangrada e véu) é isento por definição: é ele
 * que preenche a página.
 */
describe.skipIf(!presente)('invariante de borda dos NOTURNOS (NIGHT_BOTTOM = 5.20)', () => {
  it('nenhum conteúdo noturno passa de 5.20, em nenhuma variante', () => {
    expect(NIGHT_BOTTOM).toBe(5.2)
    for (const specs of [MAX, MIN]) {
      for (const spec of specs) {
        for (const s of draw(spec)) {
          if (s.master !== MASTER_V2.night) continue
          for (const o of s.objs) {
            if (o.bleed || o.role === 'scrim') continue
            expect(
              o.y + o.h,
              `${spec.type}: ${o.role} em ${(o.y + o.h).toFixed(3)} passa de NIGHT_BOTTOM`,
            ).toBeLessThanOrEqual(NIGHT_BOTTOM + EPS)
          }
        }
      }
    }
  })
})

describe.skipIf(!presente)('gabaritos progressivos (spec §2.3 + defeito 7)', () => {
  it('listening e writing MANTÊM o progressivo: 1 tela base + 1 por resposta', () => {
    const listening = MAX.find((s) => s.type === 'listening')!
    const writing = MAX.find((s) => s.type === 'writing')!
    // listening: 3 itens com correct: true (índices 0, 3, 6)
    expect(draw(listening).length).toBe(1 + 3)
    // writing: 6 respostas → 7 TELAS. No teto do contrato cada tela ocupa mais
    // de uma PÁGINA (item 21: os pisos não cabem na banda e o exercício
    // continua em outro slide), então o total é 7 × páginas.
    const paginas = draw(writing).length / (1 + 6)
    expect(Number.isInteger(paginas), `${draw(writing).length} slides / 7 telas`).toBe(true)
    expect(paginas).toBeGreaterThanOrEqual(1)
    // no conteúdo REAL do piloto (4 `complete` curtos) uma página basta
    const real: SlideSpec = {
      type: 'writing',
      instruction: 'Complete:',
      exercises: [
        { kind: 'complete', items: [{ prompt: 'a ___ b', answer: 'x' }, { prompt: 'c ___ d', answer: 'y' }] },
      ],
    }
    expect(draw(real).length).toBe(1 + 2)
  })

  it('o QUIZ consolida: UMA tela de respostas, com todas, repetindo as perguntas', () => {
    const quiz = MAX.find((s) => s.type === 'quiz')!
    const slides = draw(quiz)
    expect(slides.length).toBe(2)
    // a tela de respostas repete as 6 perguntas E traz as 6 respostas
    const textos = slides[1].objs.filter((o) => o.role === 'text').length
    expect(textos).toBeGreaterThanOrEqual(12)
  })

  it('quiz sem nenhuma resposta não gera tela de gabarito', () => {
    const spec: SlideSpec = { type: 'quiz', questions: [{ q: 'a?' }, { q: 'b?' }] }
    expect(draw(spec).length).toBe(1)
  })

  it('as notas levam o gabarito e ele nunca vira texto do slide', () => {
    const writing = MAX.find((s) => s.type === 'writing')!
    const slides = draw(writing)
    expect(slides[0].notes.join('\n')).toContain('[GABARITO]')
  })
})

describe.skipIf(!presente)('sem foto resolvida, o layout degrada para a versão sem foto', () => {
  const semFoto: SlideSpec[] = [
    { type: 'cover', title: 'Capa sem foto', image: { file: 'm5/nao-existe.jpg' } },
    {
      type: 'warmup',
      prompt: 'Pergunta de ativação',
      items: ['a', 'b'],
      image: { file: 'm5/nao-existe.jpg' },
    },
    { type: 'tip', text: 'Dica de viagem', image: { file: 'm5/nao-existe.jpg' } },
    {
      type: 'section',
      title: 'PRACTICE TIME',
      subtitle: 'Agora é a sua vez',
      image: { file: 'm5/nao-existe.jpg' },
    },
  ]
  for (const spec of semFoto) {
    it(`${spec.type} não desenha moldura vazia`, () => {
      const objs = draw(spec).flatMap((s) => s.objs)
      expect(objs.some((o) => o.path?.includes('nao-existe'))).toBe(false)
      expect(objs.length).toBeGreaterThan(2)
    })
  }

  it('card de vocabulário sem foto no disco vira card só de texto', () => {
    const spec: SlideSpec = {
      type: 'vocab',
      title: 'Cards',
      cards: [
        { term: 'bus', pt: 'ônibus', image: 'vocab/nao-existe.jpg' },
        { term: 'train', pt: 'trem' },
        { term: 'ferry', pt: 'balsa' },
      ],
    }
    const objs = draw(spec).flatMap((s) => s.objs)
    expect(objs.some((o) => o.path?.includes('nao-existe'))).toBe(false)
  })
})

// -------------------------------------------------------------- defeito 5
describe.skipIf(!presente)('divisória PRACTICE TIME é de PAPEL, com foto de luz normal (defeito 5)', () => {
  const spec = MIN.find((s) => s.type === 'section')!
  it('não usa o master noturno nem desenha véu', () => {
    for (const s of draw(spec)) {
      expect(s.master).toBe(MASTER_V2.paper)
      expect(s.objs.some((o) => o.role === 'scrim')).toBe(false)
    }
  })

  it('a foto da divisória vem de shared/, nunca de uma pasta de módulo', () => {
    const fotos = draw(spec)
      .flatMap((s) => s.objs)
      .filter((o) => o.role === 'photo')
    expect(fotos.length).toBe(1)
    expect(fotos[0].path).toContain('shared')
    expect(fotos[0].path).not.toMatch(/m\d\//)
  })

  it('a zona da facecam continua reservada na divisória', () => {
    for (const s of draw(spec)) {
      expect(s.objs.filter(isDock).length).toBe(1)
      for (const o of s.objs.filter((o) => !isDock(o))) {
        expect(invadeFacecam(o), o.role).toBe(false)
      }
    }
  })
})

/**
 * AJUSTE 12 (spec §7-ter.2): o dono viu vazio na porção superior esquerda da
 * divisória. O conserto é distributivo — a facecam fica onde está, o título sobe
 * para a faixa de cabeçalho dos outros layouts e a foto toma a coluna da direita
 * inteira, do abaixo-da-câmera à margem do corpo.
 */
describe.skipIf(!presente)('divisória redistribuída (ajuste 12)', () => {
  const spec: SlideSpec = {
    type: 'section',
    title: 'PRACTICE TIME',
    subtitle: "Now it's your turn — listening, speaking and writing",
    image: { file: 'shared/practice-time.jpg' },
  }
  const rec = () => draw(spec)[0]

  it('o título vive na MESMA faixa de cabeçalho dos outros layouts', () => {
    const s = rec()
    const cabecalho = s.objs.filter((o) => o.role === 'text' && o.y < BODY_Y && !isDock(o))
    expect(cabecalho.length).toBeGreaterThanOrEqual(2)
    // eyebrow e título nas âncoras do cabeçalho, na margem esquerda
    expect(Math.min(...cabecalho.map((o) => o.y))).toBeCloseTo(HEAD_EYEBROW_Y, 5)
    expect(cabecalho.some((o) => Math.abs(o.y - HEAD_TITLE_Y) < EPS)).toBe(true)
    for (const o of cabecalho) expect(o.x).toBeCloseTo(HEAD_X, 5)
  })

  it('nenhum vazio acima do título: o alto da banda começa no cabeçalho', () => {
    const s = rec()
    const topo = Math.min(...s.objs.filter((o) => !isDock(o)).map((o) => o.y))
    expect(topo).toBeLessThanOrEqual(HEAD_EYEBROW_Y + EPS)
  })

  it('a foto ocupa a coluna da câmera inteira, de BODY_Y à margem do corpo', () => {
    const foto = rec().objs.find((o) => o.role === 'photo')!
    expect(foto.y).toBeCloseTo(BODY_Y, 5)
    expect(foto.y + foto.h).toBeCloseTo(BODY_BOTTOM, 5)
    // alinhada ao rail da facecam e sangrando na borda daquele lado
    expect(foto.x).toBeCloseTo(FACECAM.x, 5)
    expect(foto.w).toBeCloseTo(FACECAM_V2.w + FACECAM_V2.m, 5)
    expect(foto.x + foto.w).toBeCloseTo(PAGE_W, 5)
  })

  it('o subtítulo fecha a banda à esquerda (nada de meia página branca)', () => {
    const s = rec()
    const foto = s.objs.find((o) => o.role === 'photo')!
    const painel = s.objs.filter((o) => o.role === 'panel' && !isDock(o))
    expect(painel.length).toBe(1)
    expect(painel[0].y).toBeCloseTo(BODY_Y, 5)
    expect(painel[0].y + painel[0].h).toBeCloseTo(BODY_BOTTOM, 5)
    expect(painel[0].x).toBeCloseTo(MX, 5)
    expect(painel[0].x + painel[0].w).toBeLessThanOrEqual(foto.x + EPS)
  })
})

// -------------------------------------------------------------- defeito 8/9
describe.skipIf(!presente)('o layout não degrada a função do beat (defeito 8 · spec §7-ter.1)', () => {
  const cards = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      term: `termo-${i}`,
      cue: 'PRO-nun',
      pt: 'tradução',
      image: 'vocab/bus.jpg',
    }))
  /** os cartões do slide (o dock da facecam também é um painel) */
  const cartoes = (rec: Rec) => rec.objs.filter((o) => o.role === 'panel' && !isDock(o))

  it('TODA contagem de cards cai na grade uniforme — nada de herói nem cartão-linha', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const spec = SlideSchemaV2.parse({ type: 'vocab', title: 'V', cards: cards(n) }) as SlideSpec
      const objs = cartoes(draw(spec)[0])
      const alturas = new Set(objs.map((o) => o.h.toFixed(3)))
      const larguras = new Set(objs.map((o) => o.w.toFixed(3)))
      expect(objs.length, `${n} cards`).toBe(n)
      expect(alturas.size, `${n} cards: alturas`).toBe(1)
      expect(larguras.size, `${n} cards: larguras`).toBe(1)
    }
  })

  it('a foto do card nunca vira selo: com 4 cards ela passa de 1" de largura', () => {
    // o cartão-linha reprovado pelo dono dava 0.89" de miniatura; a grade dá a
    // largura do card inteiro menos o padding
    const spec = SlideSchemaV2.parse({ type: 'vocab', title: 'V', cards: cards(4) }) as SlideSpec
    const fotos = draw(spec)[0].objs.filter((o) => o.role === 'photo')
    expect(fotos.length).toBe(4)
    for (const f of fotos) expect(f.w).toBeGreaterThan(1.0)
  })

  it('a grade uniforme usa as colunas do v1 (a régua a superar)', () => {
    expect([3, 4, 5, 6, 7, 8].map(vocabCols)).toEqual([3, 4, 3, 3, 4, 4])
  })

  it('grade de 8 cards com foto ocupa a banda e todo card tem foto + termo + pronúncia + tradução', () => {
    const spec = SlideSchemaV2.parse({ type: 'vocab', title: 'V', cards: cards(8) }) as SlideSpec
    const s = draw(spec)[0]
    const panels = cartoes(s)
    expect(panels.length).toBe(8)
    // fundo do card: 1.46" de altura contra 1.32" do v1 — supera a régua
    expect(panels[0].h).toBeGreaterThan(1.32)
    expect(s.objs.filter((o) => o.role === 'photo').length).toBe(8)
    // 3 textos por card (termo, pronúncia, tradução) = 24
    expect(s.objs.filter((o) => o.role === 'text').length).toBeGreaterThanOrEqual(24)
    const fundo = Math.max(...panels.map((p) => p.y + p.h))
    expect(fundo).toBeGreaterThanOrEqual(BODY_BOTTOM - 0.02)
  })
})

describe.skipIf(!presente)('sem espaço morto vertical (defeito 9)', () => {
  /**
   * Sobra em cima e embaixo da banda do corpo. O defeito do dono era assimetria
   * ("acaba a 40%, metade de baixo vazia" = slide inacabado): um bloco menor,
   * mas CENTRADO, é composição; um bloco colado no topo, não. Então o teste
   * cobra as duas coisas — ocupar a maior parte da banda OU estar centrado.
   */
  const sobras = (rec: Rec): { topo: number; base: number; uso: number } => {
    const uteis = rec.objs.filter((o) => o.y >= BODY_Y - 0.4 && o.y < 5.2 && !isDock(o))
    if (!uteis.length) return { topo: 0, base: 0, uso: 1 }
    const inicio = Math.min(...uteis.map((o) => o.y))
    const fim = Math.max(...uteis.map((o) => o.y + o.h))
    const banda = BODY_BOTTOM - BODY_Y
    return {
      topo: Math.max(0, inicio - BODY_Y),
      base: Math.max(0, BODY_BOTTOM - fim),
      uso: (fim - Math.max(BODY_Y, inicio)) / banda,
    }
  }

  /**
   * O DECK REAL — é o que o dono abriu no PowerPoint e reprovou. Aqui a régua é
   * apertada: o pé da banda tem de ser usado em TODOS os slides de papel.
   */
  it('deck real do M5A1: nenhum slide de papel deixa o pé da banda vazio', () => {
    const real = LessonSchemaV2.parse(
      JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')),
    )
    const { pres, slides } = recorder()
    for (const spec of real.slides) renderSlideV2(pres, real, spec)
    const folgados: string[] = []
    slides.forEach((s, i) => {
      if (s.master !== MASTER_V2.paper) return
      const { topo, base, uso } = sobras(s)
      if (base > 0.4) {
        folgados.push(
          `slide ${i + 1}: sobra ${base.toFixed(2)}" no pé (topo ${topo.toFixed(2)}", usa ${(uso * 100).toFixed(0)}%)`,
        )
      }
    })
    expect(folgados, folgados.join('\n')).toEqual([])
  })

  for (const spec of MIN) {
    it(`${spec.type} no MÍNIMO do contrato: nem metade da banda vazia`, () => {
      for (const s of draw(spec)) {
        if (s.master !== MASTER_V2.paper) continue
        const { topo, base, uso } = sobras(s)
        const rotulo = `${spec.type}: usa ${(uso * 100).toFixed(0)}% (sobra topo ${topo.toFixed(2)}, base ${base.toFixed(2)})`
        // no mínimo do contrato (2 objetivos, 1 item de writing) sobra ar por
        // definição; o que NÃO pode é o padrão "acaba a 40% da altura"
        expect(uso, rotulo).toBeGreaterThanOrEqual(0.5)
        expect(base, rotulo).toBeLessThanOrEqual(1.35)
      }
    })
  }

  it('spreadList centra o bloco quando sobra área e nunca passa da borda', () => {
    const { y0, step } = spreadList(2.0, 3, 0.4, 5.0, 0.6)
    expect(y0).toBeGreaterThan(2.0)
    expect(y0 + 2 * step + 0.4).toBeLessThanOrEqual(5.0 + EPS)
    // com muito conteúdo o passo comprime, o bloco começa no topo e NÃO passa
    const cheio = spreadList(2.0, 8, 0.4, 5.0, 0.6)
    expect(cheio.y0).toBeCloseTo(2.0, 5)
    expect(cheio.step).toBeLessThan(0.4)
    expect(cheio.y0 + 7 * cheio.step + 0.4).toBeLessThanOrEqual(5.0 + EPS)
  })
})

describe.skipIf(!presente)('specs de exemplo do teste são válidas no contrato', () => {
  it('todo o conteúdo máximo e mínimo passa no SlideSchemaV2', () => {
    for (const spec of [...MAX, ...MIN]) expect(() => SlideSchemaV2.parse(spec)).not.toThrow()
  })
})

// ------------------------------------------------------------- medidores puros
describe.skipIf(!presente)('medidores puros do v2', () => {
  it('planTitle escolhe a maior fonte que cabe e nunca estoura a altura', () => {
    const curto = planTitle('Smart Route', 8.6, 1.0, [40, 34, 29, 25])
    expect(curto.font).toBe(40)
    expect(curto.h).toBeLessThanOrEqual(1.0)
    // 209 caracteres numa coluna de 4" com 1" de altura: NENHUM degrau da
    // escada cabe. Aqui se cobrava `font === 25` (o último degrau) com
    // `h <= 1.0` — e as duas coisas só eram verdade juntas porque o
    // `Math.min(room, …)` do fim MENTIA a altura. Agora a fonte continua caindo
    // até caber de verdade, e o que se cobra é a coerência do trio
    // (fonte × linhas × altura), não o número.
    const longo = planTitle(`${LONG} ${LONG}`, 4.0, 1.0, [40, 34, 29, 25])
    expect(longo.font).toBeLessThan(25)
    expect(longo.h).toBeLessThanOrEqual(1.0)
    expect(displayTitleBox(`${LONG} ${LONG}`, 4.0, longo.font).h).toBeLessThanOrEqual(longo.h + EPS)
  })

  it('planSteps mantém os passos dentro da área, com PISO de entrelinha (defeito 3)', () => {
    for (const [w, top, bottom] of [
      [4.04, 1.98, 5.2],
      [5.9, 3.9, 5.2],
      [5.9, 4.8, 5.2],
    ] as const) {
      const steps = Array.from({ length: 6 }, () => LONG)
      const p = planSteps(steps, w, top, bottom)
      const fim =
        p.lines.slice(0, p.fits).reduce((a, l) => a + l * p.lineH, 0) + (p.fits - 1) * p.gap
      expect(top + fim, `w=${w} top=${top}`).toBeLessThanOrEqual(bottom + EPS)
      // piso: nunca comprime abaixo de 1.07 de entrelinha
      expect(p.lineH, `w=${w} top=${top}`).toBeGreaterThanOrEqual(p.font * 0.0148 - 1e-9)
      expect(p.fits).toBeGreaterThanOrEqual(1)
    }
  })

  it('quando nem no piso cabe, a missão CONTINUA em outro slide (nada é escondido)', () => {
    const spec: SlideSpec = {
      type: 'mission',
      number: 5,
      title: 'Missão',
      briefing: 'Briefing',
      // 6 passos no TETO do contrato (400 caracteres cada): é o pior cartaz legal
      steps: Array.from({ length: 6 }, () => texto(LEN.block)),
    }
    const slides = draw(spec)
    expect(slides.length).toBeGreaterThan(1)
    const p = planSteps(Array.from({ length: 6 }, () => texto(LEN.block)), 4.36, BODY_Y, 5.2)
    expect(p.fits).toBeGreaterThanOrEqual(1)
    expect(p.fits).toBeLessThan(6)
  })

  it('`fits` diz a VERDADE: área impossível devolve 0 em vez de forçar (achado 16)', () => {
    // 0.2" de área não cabe nem uma linha no piso de entrelinha
    expect(planSteps([texto(LEN.block)], 4.36, 5.0, 5.2).fits).toBe(0)
    // e o pior passo LEGAL cabe com folga na coluna do cartaz — é o que autoriza
    // a missão a estourar quando `fits` é 0, em vez de desenhar fora da área
    expect(planSteps([texto(LEN.block)], 4.36, BODY_Y, 5.2).fits).toBe(1)
  })

  it('missão curta (M5 real) mantém a fonte cheia nas duas colunas do cartaz', () => {
    const p = planSteps(
      [
        'Choose a city and **3 places** you want to visit',
        'Open your map app **in English** and plan the route between them',
        'Decide the **transport for each part**: by metro? by bus? on foot?',
        'Record a **voice note in English** explaining your route (First… Then…)',
        'Send it to Kelly on WhatsApp',
      ],
      4.04,
      1.98,
      5.2,
    )
    // a fonte não degrada: o cartaz cabe no topo da escada (16pt na Fase 0c)
    expect(p.font).toBeGreaterThanOrEqual(13.5)
    expect(p.fits).toBe(5)
  })
})

// ------------------------------------------ UMA fonte por lista (Fase 0d)
/**
 * NUMA LISTA NUMERADA, CORPO É HIERARQUIA.
 *
 * O defeito que abriu esta suíte: no M5 real os passos 1 a 4 (2 linhas cada)
 * saíam num corpo e o passo 5, "Send it to Kelly on WhatsApp" (1 linha),
 * visivelmente MENOR — o CTA da missão lendo como rodapé. A causa não estava na
 * medida (o `planSteps` sempre devolveu UMA fonte), estava no desenho: cada
 * passo ia numa caixa própria com `fit: 'shrink'` e sem descontar as margens
 * internas padrão do PowerPoint. O rombo de 0.1" é igual em toda caixa, mas
 * pesa 9% numa de 2 linhas e 36% numa de 1 linha, então o autoajuste derretia
 * mais o passo mais CURTO.
 *
 * Aqui isso vira invariante, não conserto pontual: em qualquer distribuição
 * legal, todo passo de uma mesma missão sai no MESMO corpo — inclusive quando a
 * missão pagina, porque a continuação é irmã, não outra lista.
 */
describe.skipIf(!presente)('missão: UMA fonte para a lista inteira de passos (Fase 0d)', () => {
  /** as caixas de passo de um slide: as que começam com "N.  " */
  const passos = (rec: Rec): Obj[] =>
    rec.objs.filter((o) => o.role === 'text' && /^\d+\.\s/.test(o.text ?? ''))

  /** TODO corpo declarado na caixa (o da caixa + o de cada run) */
  const corpos = (o: Obj): number[] => [
    ...(typeof o.fontSize === 'number' ? [o.fontSize] : []),
    ...(o.runFonts ?? []),
  ]

  const missao = (steps: string[]): SlideSpec => ({
    type: 'mission',
    number: 5,
    title: 'Smart Route',
    briefing: 'Plan a **real day of sightseeing** in a city you dream of visiting.',
    steps,
  })

  const M5_REAL = [
    'Choose a city and **3 places** you want to visit',
    'Open your map app **in English** and plan the route between them',
    'Decide the **transport for each part**: by metro? by bus? on foot?',
    'Record a **voice note in English** explaining your route (First… Then…)',
    'Send it to Kelly on WhatsApp',
  ]

  /**
   * Distribuições LEGAIS: 1 a 6 passos (o contrato não impõe mínimo nem máximo
   * de passos além do teto de 400 caracteres por passo), curtos e longos
   * misturados — que é justamente onde o defeito nascia.
   */
  const DISTRIBUICOES: Array<[string, string[]]> = [
    ['o M5 real', M5_REAL],
    ['1 passo curto', ['Send it to Kelly on WhatsApp']],
    ['1 passo no teto', [texto(LEN.block)]],
    ['2 curtos', ['Open the app', 'Send it to Kelly']],
    ['curto + no teto', ['Send it to Kelly on WhatsApp', texto(LEN.block)]],
    ['no teto + curto', [texto(LEN.block), 'Send it to Kelly on WhatsApp']],
    ['3 misturados', [texto(LEN.block), 'Open the app', texto(LEN.line)]],
    ['4 no teto (pagina)', Array.from({ length: 4 }, () => texto(LEN.block))],
    ['5 misturados', [...M5_REAL.slice(0, 4), texto(LEN.block)]],
    ['6 no teto (pior cartaz legal)', Array.from({ length: 6 }, () => texto(LEN.block))],
    ['6 curtos', Array.from({ length: 6 }, (_, i) => `Passo ${i + 1}`)],
  ]

  it('o M5 real: os cinco passos saem no MESMO corpo (o defeito relatado)', () => {
    const [slide] = draw(missao(M5_REAL))
    const ps = passos(slide)
    expect(ps.length).toBe(5)
    // o passo 5 é o CTA da missão: ele não pode ser o menor da lista
    expect(new Set(ps.flatMap(corpos)).size).toBe(1)
  })

  it('em TODA distribuição legal, a missão inteira tem UM corpo só', () => {
    for (const [nome, steps] of DISTRIBUICOES) {
      const slides = draw(missao(steps))
      const ps = slides.flatMap(passos)
      // nada de passo escondido: a soma das páginas é a lista inteira
      expect(ps.length, nome).toBe(steps.length)
      const fontes = new Set(ps.flatMap(corpos))
      expect([...fontes], `${nome} (${slides.length} slide[s])`).toHaveLength(1)
    }
  })

  it('nenhuma caixa de passo carrega autoajuste — o `shrink` é POR CAIXA', () => {
    // esta é a rede que reabriria o defeito: `fit: 'shrink'` deixa o conversor
    // reescalar cada caixa sozinha, e caixa curta encolhe mais que caixa longa
    for (const [nome, steps] of DISTRIBUICOES) {
      for (const p of draw(missao(steps)).flatMap(passos)) {
        expect(p.fit, nome).toBeUndefined()
      }
    }
  })

  it('a caixa do passo VALE o que foi medido: margem zero e N linhas exatas', () => {
    // sem `shrink`, a medida passa a ser a única rede — então ela tem de ser
    // verdadeira: sem as margens internas padrão do PowerPoint (0.05" em cima e
    // embaixo) e com a entrelinha travada na do plano, de modo que a altura da
    // caixa seja um número INTEIRO de linhas renderizadas.
    for (const [nome, steps] of DISTRIBUICOES) {
      for (const p of draw(missao(steps)).flatMap(passos)) {
        expect(p.margin, nome).toBe(0)
        expect(typeof p.lineSpacing, nome).toBe('number')
        const linhas = p.h / (p.lineSpacing! / 72)
        expect(linhas, `${nome}: ${p.h} / ${p.lineSpacing!} pt`).toBeGreaterThanOrEqual(1 - EPS)
        expect(Math.abs(linhas - Math.round(linhas)), nome).toBeLessThan(EPS)
      }
    }
  })

  it('CANÁRIO: a régua REPROVA uma lista com um passo de corpo diferente', () => {
    // sem canário, "um corpo só" poderia estar passando por não achar passo
    // nenhum. Aqui a mesma conta é aplicada a uma lista adulterada de propósito.
    const ps = passos(draw(missao(M5_REAL))[0])
    const adulterada = ps.map((p, i) => (i === ps.length - 1 ? { ...p, fontSize: 10.5 } : p))
    expect(new Set(adulterada.flatMap(corpos)).size).toBe(2)
  })
})

// --------------------------------------------------------- defeito 1 (vocab)
describe.skipIf(!presente)('planVocabCard: caixas sem intersecção, em qualquer tamanho de card (defeito 1)', () => {
  const boxes = (p: ReturnType<typeof planVocabCard>) =>
    [p.img, p.term, p.cue, p.pt].filter(Boolean) as Array<{ x: number; y: number; w: number; h: number }>

  const inter = (a: { x: number; y: number; w: number; h: number }, b: typeof a): number =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

  it('varredura de tamanhos: zero intersecção e nada fora do card', () => {
    for (const w of [1.4, 1.82, 2.155, 2.93, 3.1, 4.46, 5.82, 9.16]) {
      for (const h of [0.45, 0.56, 0.65, 0.8, 0.92, 1.05, 1.3, 1.46, 2.4, 3.08]) {
        for (const hasImg of [true, false]) {
          for (const temCue of [true, false]) {
            const p = planVocabCard({ x: 1, y: 2, w, h, hasImg, temCue })
            const bs = boxes(p)
            const rotulo = `w=${w} h=${h} img=${hasImg} cue=${temCue} (${p.layout})`
            for (let i = 0; i < bs.length; i++) {
              for (let j = i + 1; j < bs.length; j++) {
                expect(inter(bs[i], bs[j]), `${rotulo}: caixas ${i}×${j}`).toBe(0)
              }
            }
            for (const b of bs) {
              expect(b.x, rotulo).toBeGreaterThanOrEqual(1 - EPS)
              expect(b.y, rotulo).toBeGreaterThanOrEqual(2 - EPS)
              expect(b.x + b.w, rotulo).toBeLessThanOrEqual(1 + w + EPS)
              expect(b.y + b.h, rotulo).toBeLessThanOrEqual(2 + h + EPS)
              expect(b.h, rotulo).toBeGreaterThan(0)
              expect(b.w, rotulo).toBeGreaterThan(0)
            }
          }
        }
      }
    }
  })

  it('ordem de degradação: a foto encolhe primeiro, até o piso de 30%', () => {
    const alto = planVocabCard({ x: 0, y: 0, w: 2.155, h: 1.46, hasImg: true, temCue: true })
    expect(alto.img!.h / 1.46).toBeGreaterThanOrEqual(VOCAB_CARD.imgFloor)
    expect(alto.showCue).toBe(true)
    // card apertado: a foto está no piso e as fontes já caíram
    const baixo = planVocabCard({ x: 0, y: 0, w: 2.155, h: 0.8, hasImg: true, temCue: true })
    expect(baixo.img ? baixo.img.h / 0.8 : 1).toBeGreaterThanOrEqual(VOCAB_CARD.imgFloor - EPS)
    expect(baixo.term.font).toBeLessThan(alto.term.font)
  })

  it('a pronúncia é a ÚLTIMA a sair, e sai avisando (vai para as notas)', () => {
    // card impossível: nem no piso de fonte cabem três linhas + foto
    const p = planVocabCard({ x: 0, y: 0, w: 2.0, h: 0.42, hasImg: true, temCue: true })
    expect(p.showCue).toBe(false)
    expect(p.cue).toBeUndefined()
    expect(p.term.font).toBeGreaterThanOrEqual(VOCAB_CARD.termSizes[VOCAB_CARD.termSizes.length - 1])
    expect(p.pt.font).toBeGreaterThanOrEqual(VOCAB_CARD.ptSizes[VOCAB_CARD.ptSizes.length - 1])
  })

  it('nenhuma fonte fica abaixo do piso de legibilidade', () => {
    const menorTerm = VOCAB_CARD.termSizes[VOCAB_CARD.termSizes.length - 1]
    const menorPt = VOCAB_CARD.ptSizes[VOCAB_CARD.ptSizes.length - 1]
    const menorCue = VOCAB_CARD.cueSizes[VOCAB_CARD.cueSizes.length - 1]
    for (const h of [0.4, 0.6, 0.9, 1.4, 3.0]) {
      const p = planVocabCard({ x: 0, y: 0, w: 2.155, h, hasImg: true, temCue: true })
      expect(p.term.font, `h=${h}`).toBeGreaterThanOrEqual(menorTerm)
      expect(p.pt.font, `h=${h}`).toBeGreaterThanOrEqual(menorPt)
      if (p.cue) expect(p.cue.font, `h=${h}`).toBeGreaterThanOrEqual(menorCue)
    }
  })

  it('card SEM foto continua perfeito: três linhas, nenhuma foto, tudo dentro', () => {
    const p = planVocabCard({ x: 0, y: 0, w: 2.155, h: 1.46, hasImg: false, temCue: true })
    expect(p.img).toBeUndefined()
    expect(p.showCue).toBe(true)
    expect(p.pt.y + p.pt.h).toBeLessThanOrEqual(1.46 + EPS)
  })

  it('coluna de texto estreita demais: a foto sai em vez de espremer o termo', () => {
    const p = planVocabCard({ x: 0, y: 0, w: 1.4, h: 0.9, hasImg: true, temCue: true })
    expect(p.term.w).toBeGreaterThanOrEqual(1.0)
  })
})

// ------------------------------------------------------ ajuste 13 (chips)
/**
 * O dono viu os chips do `unscramble` colados uns nos outros e colados na caixa
 * de resposta (spec §7-ter.2, ajuste 13). O respiro é medido nos DOIS eixos, no
 * conteúdo real do M5A1 e no teto do contrato.
 */
describe.skipIf(!presente)('chips do unscramble com respiro (ajuste 13)', () => {
  // o M5A1 não tem `unscramble` (só `complete`); o exercício de referência é o
  // do exemplar oficial do template, que é onde o dono viu os chips colados
  const tipico: SlideSpec = {
    type: 'writing',
    instruction: 'Put the words in order:',
    exercises: [
      {
        kind: 'unscramble',
        items: [
          {
            prompt: 'time / What / is / the / next / train / ?',
            answer: 'What time is the next train?',
          },
          { prompt: 'go / I / by / bus / to / school', answer: 'I go to school by bus.' },
        ],
      },
    ],
  }

  /** pastilhas: texto-com-cartão baixo e estreito (o rótulo do exercício é 1.42 de largura) */
  const pastilhas = (rec: Rec) => rec.objs.filter((o) => o.role === 'veiled' && o.h < 0.36 && o.w < 1.4)

  it('vão HORIZONTAL entre chips vizinhos ≥ 0.14" (era 0.10")', () => {
    const chips = pastilhas(draw(tipico)[0]).sort((a, b) => a.y - b.y || a.x - b.x)
    expect(chips.length).toBeGreaterThan(6)
    let pares = 0
    for (let i = 1; i < chips.length; i++) {
      const a = chips[i - 1]
      const b = chips[i]
      if (Math.abs(a.y - b.y) > EPS) continue // linhas diferentes
      pares += 1
      expect(b.x - (a.x + a.w), `chips ${i - 1}×${i}`).toBeGreaterThanOrEqual(0.14)
    }
    expect(pares).toBeGreaterThan(3)
  })

  it('vão VERTICAL entre a linha de chips e a caixa de resposta ≥ 0.1"', () => {
    const plan = planWriting(
      [{ kind: 'unscramble', items: [1, 2, 3] }],
      () => 1,
      undefined,
      WRITING_MINS_V2,
    )
    for (const b of plan.blocks.filter((b) => b.kind === 'unscramble')) {
      const fimDosChips = b.y + (b.chipRows ?? 1) * (b.chipStep ?? 0)
      expect(b.answerY! - fimDosChips).toBeGreaterThanOrEqual(WRITING_MINS_V2.chipGap - EPS)
    }
  })

  it('3 unscrambles (o formato que existe): chip legível, ≥ 0.09"', () => {
    const tres: SlideSpec = {
      type: 'writing',
      instruction: 'Put the words in order:',
      exercises: [
        {
          kind: 'unscramble',
          items: Array.from({ length: 3 }, () => ({
            prompt: embaralhado(LEN.prompt),
            answer: texto(60),
          })),
        },
      ],
    }
    const chips = pastilhas(draw(tres)[0])
    expect(chips.length).toBeGreaterThan(10)
    for (const c of chips) expect(c.h).toBeGreaterThanOrEqual(0.09)
  })

  /**
   * O teto de 6 itens do `writing` foi calibrado no v1 para exercícios
   * `complete` (bloco de 0.50"). SEIS `unscramble` não cabem na banda — e desde
   * a Fase 0e isso não vira mais compressão do piso: o writing PAGINA (item 21).
   * O que este teste cobra continua valendo em cada página.
   */
  it('no pior writing legal nada se sobrepõe nem sai do bloco (a régua atual)', () => {
    const spec = MAX.find((s) => s.type === 'writing')!
    const chips = pastilhas(draw(spec)[0])
    expect(chips.length).toBeGreaterThan(10)
    for (const c of chips) expect(c.h).toBeGreaterThan(0)
    // sem sobreposição entre linhas de chips: a invariante 0 cobre o slide
    // inteiro, aqui fica explícito o caso que motivou o ajuste
    const porLinha = new Map<string, Obj[]>()
    for (const c of chips) {
      const k = c.y.toFixed(3)
      porLinha.set(k, [...(porLinha.get(k) ?? []), c])
    }
    const linhas = [...porLinha.keys()].map(Number).sort((a, b) => a - b)
    for (let i = 1; i < linhas.length; i++) {
      const anterior = porLinha.get(linhas[i - 1].toFixed(3))![0]
      expect(anterior.y + anterior.h).toBeLessThanOrEqual(linhas[i] + EPS)
    }
  })

  it('planChips: uma conta só para medir e desenhar, sem sair da faixa', () => {
    const { chips, rows } = planChips('What / time / is / the / next / train / ?'.split(' / '), 0.84, 9.58)
    expect(chips.length).toBe(7)
    expect(rows).toBe(1)
    for (const c of chips) {
      expect(c.x).toBeGreaterThanOrEqual(0.84 - EPS)
      expect(c.x + c.w).toBeLessThanOrEqual(9.58 + EPS)
      expect(c.w).toBeGreaterThanOrEqual(CHIPS.minW)
    }
    // palavra absurda (contrato permite 200 caracteres) fica DENTRO da faixa
    const gigante = planChips(['a'.repeat(200)], 0.84, 9.58)
    expect(gigante.chips[0].w).toBeLessThanOrEqual(9.58 - 0.84 + EPS)
  })
})

// ------------------------------------------------------- defeito 2 (writing)
const chip = (rows: number) => () => rows
/** todas as distribuições legais dos exercícios até 6 itens */
const distribuicoes = (): Array<Array<{ kind: 'complete' | 'unscramble' | 'create'; items: number[] }>> => {
  const kinds = ['complete', 'unscramble', 'create'] as const
  const out: Array<Array<{ kind: 'complete' | 'unscramble' | 'create'; items: number[] }>> = []
  for (const k1 of kinds) {
    for (let n1 = 1; n1 <= 5; n1++) {
      out.push([{ kind: k1, items: Array.from({ length: n1 }, (_, i) => i) }])
      for (const k2 of kinds) {
        for (let n2 = 1; n2 <= 5; n2++) {
          if (n1 + n2 > 6) continue
          out.push([
            { kind: k1, items: Array.from({ length: n1 }, (_, i) => i) },
            { kind: k2, items: Array.from({ length: n2 }, (_, i) => i) },
          ])
        }
      }
    }
  }
  return out
}

describe.skipIf(!presente)('planWriting com os pisos NO PLANO (defeito 2)', () => {
  it('PIOR distribuição legal dos 6 itens: nada passa de BODY_BOTTOM, com chips em 1 a 4 linhas', () => {
    for (const rows of [1, 2, 3, 4]) {
      for (const exs of distribuicoes()) {
        const plan = planWriting(exs, chip(rows), undefined, WRITING_MINS_V2)
        const rotulo = `${exs.map((e) => `${e.kind}×${e.items.length}`).join(' + ')} rows=${rows}`
        expect(plan.bottom, rotulo).toBeLessThanOrEqual(BODY_BOTTOM + EPS)
        // paginação (item 21): nenhuma página fica vazia e nada é escondido
        expect(plan.fits, `${rotulo}: fits`).toBeGreaterThanOrEqual(1)
        expect(plan.fits, `${rotulo}: fits`).toBeLessThanOrEqual(plan.total)
        expect(plan.blocks.filter((b) => b.item >= 0).length, `${rotulo}: itens`).toBe(plan.fits)
        for (const b of plan.blocks) {
          expect(b.y + b.h, `${rotulo}: bloco ${b.kind}`).toBeLessThanOrEqual(BODY_BOTTOM + EPS)
          expect(b.h, `${rotulo}: bloco ${b.kind} negativo`).toBeGreaterThan(0)
          // TODA caixa do bloco vem do plano e cabe dentro dele (item 20)
          expect(b.labelH, `${rotulo}: rótulo`).toBeLessThanOrEqual(b.h + EPS)
          expect(b.numChipH, `${rotulo}: chip numerado`).toBeLessThanOrEqual(b.h + EPS)
          expect(b.promptH, `${rotulo}: enunciado`).toBeLessThanOrEqual(b.h + EPS)
          expect(b.answerY + b.answerH, `${rotulo}: caixa de ${b.kind}`).toBeLessThanOrEqual(
            b.y + b.h + EPS,
          )
          expect(b.answerY, `${rotulo}: caixa de ${b.kind}`).toBeGreaterThanOrEqual(b.y - EPS)
        }
      }
    }
  })

  /**
   * ITEM 21 — o piso é PISO. Antes um segundo fator (`kf`) comprimia os pisos
   * junto com o resto: no teto do contrato a caixa de resposta media 0.09", e o
   * código continuava chamando 0.18" de piso. Agora o piso não cede em
   * distribuição nenhuma; quem cede é a PÁGINA.
   */
  it('a caixa de resposta NUNCA fica abaixo de 0.18", em nenhuma distribuição legal', () => {
    for (const rows of [1, 2, 3, 4]) {
      for (const exs of distribuicoes()) {
        const plan = planWriting(exs, chip(rows), undefined, WRITING_MINS_V2)
        const rotulo = `${exs.map((e) => `${e.kind}×${e.items.length}`).join(' + ')} rows=${rows}`
        for (const b of plan.blocks.filter((b) => b.item >= 0)) {
          expect(b.answerH, `${rotulo}: caixa de ${b.kind}`).toBeGreaterThanOrEqual(
            WRITING_MINS_V2.answer - EPS,
          )
        }
      }
    }
  })

  it('o CASO DO SOL (6 unscramble de 41 tokens) pagina em vez de espremer', () => {
    // 41 tokens vazios separados por ' / ' = exatamente 120 caracteres (LEN.prompt)
    const prompt = Array.from({ length: 41 }, () => '').join(' / ')
    expect(prompt.length).toBe(LEN.prompt)
    expect(prompt.split(' / ').length).toBe(41)
    const linhas = planChips(prompt.split(' / '), 0.84, 9.58).rows
    expect(linhas).toBe(4)
    const exs = [
      { kind: 'unscramble' as const, items: [1, 2, 3] },
      { kind: 'unscramble' as const, items: [1, 2, 3] },
    ]
    const plan = planWriting(exs, chip(linhas), undefined, WRITING_MINS_V2)
    // era `kf = 0.4518` e um rótulo de 0.0723"; agora o conjunto simplesmente
    // não cabe numa página e o writing continua em outra
    expect(plan.total).toBe(6)
    expect(plan.fits).toBeLessThan(6)
    expect(plan.fits).toBeGreaterThanOrEqual(1)
    for (const b of plan.blocks.filter((b) => b.item >= 0)) {
      expect(b.answerH).toBeGreaterThanOrEqual(WRITING_MINS_V2.answer - EPS)
    }
    // e o DESENHO não tem uma colisão sequer, em nenhuma página
    const spec: SlideSpec = {
      type: 'writing',
      instruction: 'Put the words in order:',
      exercises: exs.map((e) => ({
        kind: e.kind,
        items: e.items.map(() => ({ prompt })),
      })),
    }
    for (const s of draw(spec)) {
      const c = colisoes(s)
      expect(c, `${c.length} par(es):\n${c.join('\n')}`).toEqual([])
    }
  })

  it('o v1 continua com o plano ORIGINAL (sem pisos) — comportamento intacto', () => {
    const exs = [
      { kind: 'complete' as const, items: [1, 2, 3] },
      { kind: 'unscramble' as const, items: [1, 2] },
    ]
    const v1 = planWriting(exs, chip(1))
    // conta original: soma das bases × k, sem parte fixa
    const base = 0.36 + 3 * 0.5 + 0.08 + 0.36 + 2 * (0.36 + 0.44)
    const k = (BODY_BOTTOM - (BODY_Y + 0.36)) / base
    expect(v1.k).toBeCloseTo(k, 6)
    expect(v1.blocks[0].h).toBeCloseTo(0.36 * k, 6)
  })
})

// ------------------------------------------------------------ item 18 (Fase 0d)
/**
 * AGRUPAMENTO — o vão ENTRE itens tem de ser claramente MAIOR que o vão DENTRO
 * do item (régua do dono: `entre ≥ 2 × dentro`).
 *
 * O defeito: os blocos de item eram encostados (`y += h`, vão zero) enquanto o
 * vão dentro do item valia 0.19". Por proximidade, o aluno lia "caixa do item 1
 * + chips do item 2" como um bloco só e o exercício perdia o sentido. O
 * conserto não é uma constante ajustada a olho: `WRITING_MINS_V2.gapItem` é
 * DERIVADO de `chipGap` por `AGRUPAMENTO`, os dois são pisos e os dois saem do
 * mesmo fator `kf` — então a razão é invariante, não calibração.
 */
describe.skipIf(!presente)('agrupamento do writing: entre > dentro (item 18)', () => {
  /** vão DENTRO do item, medido no bloco como ele será desenhado */
  const dentroDo = (b: WritingBlock): number => {
    if (b.kind === 'unscramble') {
      const rows = Math.max(1, b.chipRows ?? 1)
      return b.answerY! - (b.y + (rows - 1) * (b.chipStep ?? 0) + (b.chipH ?? 0))
    }
    // `create`: enunciado em cima, caixa embaixo
    if (b.kind === 'create') return b.answerY! - (b.y + (b.promptH ?? 0))
    // `complete`: enunciado e caixa LADO A LADO — não há vão interno vertical
    return 0
  }

  it('a razão está no contrato, não no olho: gapItem = AGRUPAMENTO × chipGap', () => {
    expect(AGRUPAMENTO).toBeGreaterThanOrEqual(2)
    expect(WRITING_MINS_V2.gapItem).toBeCloseTo(AGRUPAMENTO * WRITING_MINS_V2.chipGap, 9)
    // o v1 (produção) não tem vão nenhum no plano — segue como sempre foi
    expect(WRITING_MINS_V1.gapItem).toBe(0)
    expect(WRITING_MINS_V1.chipGap).toBe(0)
  })

  it('em TODA distribuição legal: entre ≥ 2 × dentro, mesmo com os pisos comprimidos', () => {
    for (const rows of [1, 2, 3]) {
      for (const exs of distribuicoes()) {
        const plan = planWriting(exs, chip(rows), undefined, WRITING_MINS_V2)
        const rotulo = `${exs.map((e) => `${e.kind}×${e.items.length}`).join(' + ')} rows=${rows}`
        expect(plan.gapEntre, rotulo).toBeGreaterThanOrEqual(2 * plan.gapDentro - EPS)
        const itens = plan.blocks.filter((b) => b.item >= 0)
        for (let i = 0; i < itens.length; i++) {
          const b = itens[i]
          const dentro = dentroDo(b)
          expect(dentro, `${rotulo}: dentro do item ${i} (${b.kind})`).toBeGreaterThanOrEqual(-EPS)
          // o vão DENTRO medido no bloco é o que o plano promete
          if (b.kind !== 'complete') expect(dentro, `${rotulo}: item ${i}`).toBeCloseTo(plan.gapDentro, 6)
          const prox = itens[i + 1]
          if (!prox || prox.ex !== b.ex) continue
          const entre = prox.y - (b.y + b.h)
          expect(entre, `${rotulo}: entre ${i} e ${i + 1}`).toBeGreaterThanOrEqual(2 * dentro - EPS)
          expect(entre, `${rotulo}: entre ${i} e ${i + 1} é positivo`).toBeGreaterThan(0)
        }
      }
    }
  })

  /**
   * A prova no DESENHO, não no plano: as pastilhas e as caixas de resposta que
   * o renderer gravou no pptx falso, com o exercício de 3 itens que o dono
   * inspecionou no slide 21 do piloto.
   */
  it('desenho do unscramble de 3 itens: chips do item N+1 longe da caixa do item N', () => {
    const spec: SlideSpec = {
      type: 'writing',
      title: 'Put the words in order',
      instruction: 'Unscramble and type the full sentence in the box:',
      exercises: [
        {
          kind: 'unscramble',
          items: [
            { prompt: 'time / What / is / the / next / train / ?', answer: 'What time is the next train?' },
            {
              prompt: 'bus / Does / this / go / to / the / airport / ?',
              answer: 'Does this bus go to the airport?',
            },
            { prompt: 'off / Get / at / the / last / stop', answer: 'Get off at the last stop.' },
          ],
        },
      ],
    }
    const rec = draw(spec)[0]
    // caixa de resposta do unscramble: painel largo ancorado na coluna do texto
    const caixas = rec.objs
      .filter((o) => o.role === 'panel' && Math.abs(o.x - 0.84) < EPS && o.w > 8)
      .sort((a, b) => a.y - b.y)
    const chips = rec.objs
      .filter((o) => o.role === 'veiled' && o.h < 0.36 && o.w < 1.4)
      .sort((a, b) => a.y - b.y)
    expect(caixas.length).toBe(3)
    expect(chips.length).toBeGreaterThan(15)
    for (let i = 0; i < caixas.length; i++) {
      const anterior = i === 0 ? 0 : caixas[i - 1].y + caixas[i - 1].h
      // chips DESTE item: os que ficam entre a caixa anterior e a deste
      const meus = chips.filter((c) => c.y >= anterior - EPS && c.y + c.h <= caixas[i].y + EPS)
      expect(meus.length, `item ${i} sem chips`).toBeGreaterThan(4)
      const fim = Math.max(...meus.map((c) => c.y + c.h))
      const dentro = caixas[i].y - fim
      expect(dentro, `dentro do item ${i}`).toBeGreaterThan(0.05)
      if (i + 1 >= caixas.length) continue
      const seguintes = chips.filter((c) => c.y > caixas[i].y + EPS && c.y + c.h <= caixas[i + 1].y + EPS)
      const entre = Math.min(...seguintes.map((c) => c.y)) - (caixas[i].y + caixas[i].h)
      expect(entre, `entre ${i} e ${i + 1} (dentro=${dentro.toFixed(3)})`).toBeGreaterThanOrEqual(
        2 * dentro - EPS,
      )
    }
  })

  /**
   * `listening` e `quiz` têm a mesma estrutura repetida "enunciado → resposta" e
   * corriam o mesmo risco. Aqui a régua é medida no DESENHO, com a tela de
   * respostas (que é onde a resposta existe e pode colar no enunciado seguinte).
   */
  it('quiz · ANSWERS: a resposta cola na SUA pergunta e a próxima pergunta fica longe', () => {
    const spec: SlideSpec = {
      type: 'quiz',
      title: 'What do you do?',
      questions: [
        { q: 'How do you get to work?', answer: 'I take the bus every morning.' },
        { q: 'What time does the last ferry leave?', answer: 'It leaves at eleven.' },
        { q: 'Where do you buy your ticket?', answer: 'At the machine in the station.' },
      ],
    }
    const telas = draw(spec)
    const rec = telas[telas.length - 1]
    // pergunta e resposta são caixas de texto na coluna do enunciado
    const linhas = rec.objs
      .filter((o) => o.role === 'text' && Math.abs(o.x - 0.9) < EPS && o.y >= BODY_Y - EPS)
      .sort((a, b) => a.y - b.y)
    expect(linhas.length).toBe(6) // 3 perguntas + 3 respostas
    for (let i = 0; i + 1 < linhas.length; i += 2) {
      const dentro = linhas[i + 1].y - (linhas[i].y + linhas[i].h)
      const prox = linhas[i + 2]
      if (!prox) continue
      const entre = prox.y - (linhas[i + 1].y + linhas[i + 1].h)
      expect(dentro, `dentro do bloco ${i / 2}`).toBeLessThan(0.02)
      expect(entre, `entre ${i / 2} e ${i / 2 + 1}`).toBeGreaterThanOrEqual(2 * dentro - EPS)
      expect(entre).toBeGreaterThan(0.08)
    }
  })

  it('listening: cada item é UMA linha (sem divisão interna) e as linhas não se encostam', () => {
    const spec: SlideSpec = {
      type: 'listening',
      task: 'Watch and check what you hear:',
      videoUrl: null,
      items: [
        { text: 'The train leaves at nine.', correct: true },
        { text: 'The bus is late again today.' },
        { text: 'Get off at the last stop.', correct: true },
        { text: 'The ferry runs every hour.' },
      ],
      answers: 'itens 1 e 3',
    }
    const telas = draw(spec)
    const rec = telas[telas.length - 1]
    // o rótulo de cada item: caixa de texto à direita do quadradinho
    const linhas = rec.objs
      .filter((o) => o.role === 'text' && o.y > BODY_Y + 0.5 && o.x > 5 && o.h < 1)
      .sort((a, b) => a.y - b.y)
    expect(linhas.length).toBe(4)
    for (let i = 1; i < linhas.length; i++) {
      // a resposta do listening é o CHECK dentro da própria linha: não existe
      // vão "dentro" para inverter — o que precisa existir é o vão ENTRE linhas
      expect(linhas[i].y - (linhas[i - 1].y + linhas[i - 1].h), `linhas ${i - 1}×${i}`).toBeGreaterThan(0.02)
    }
  })

  /**
   * O CARTAZ DA MISSÃO (24/07) — o mesmo defeito, no último tipo que ainda
   * media o vão à mão.
   *
   * O passo é o ITEM e as linhas do passo são a DIVISÃO INTERNA dele. O respiro
   * entre passos era um `gap = 0.1` fixo, escrito à mão e cego para a
   * entrelinha: nas quatro missões do curso o vão ENTRE passos saía ~1.9× o vão
   * DENTRO do passo (mínimo 2.5×), e os seis passos numerados liam como um
   * parágrafo corrido. Nada estourava e nada colidia — por isso passou por
   * quatro missões e pelo `fit-check`, que ainda dizia "passos longos demais".
   *
   * A régua é a MESMA do writing, medida entre as faixas de MASSA das linhas
   * (`MASSA_LINHA`): ascendente e descendente são esparsas e não formam a borda
   * que o olho usa para agrupar.
   */
  describe('cartaz da missão: passo é item, linha do passo é divisão interna', () => {
    /** os passos REAIS das quatro missões do curso (o que o dono reprovou) */
    const missoes = (presente ? ['m2', 'm3', 'm4', 'm5'] : []).map((m) => {
      const doc = JSON.parse(readFileSync(join(privado.content, 'personal-travel-v2', `${m}-mission.json`), 'utf8'))
      const s = (doc.slides as SlideSpec[]).find((x) => x.type === 'mission')
      return { m, spec: SlideSchemaV2.parse(s) as Extract<SlideSpec, { type: 'mission' }> }
    })

    it('as quatro missões do curso respeitam AGRUPAMENTO (era 1.85–1.92×)', () => {
      const fora: string[] = []
      for (const { m, spec } of missoes) {
        for (const [i, p] of missionSteps(spec).entries()) {
          const razao = p.gapEntre / p.gapDentro
          if (razao < AGRUPAMENTO - 1e-9) {
            fora.push(`${m} pág.${i + 1}: razão ${razao.toFixed(3)} (corpo ${p.font}pt)`)
          }
        }
      }
      expect(fora, fora.join('\n')).toEqual([])
    })

    it('a razão está no contrato, não no olho: o respiro é DERIVADO da entrelinha', () => {
      for (const font of [16, 12.5, 9.5]) {
        for (const lineH of [font * 0.0172, font * STEP_LINE_FLOOR]) {
          const dentro = vaoDentroDoPasso(font, lineH)
          expect(dentro).toBeGreaterThan(0)
          expect(respiroEntrePassos(font, lineH) + dentro).toBeCloseTo(AGRUPAMENTO * dentro, 9)
        }
      }
    })

    it('em TODA lista legal de passos: entre = AGRUPAMENTO × dentro, inclusive comprimida', () => {
      for (const n of [1, 2, 3, 4, 5, 6]) {
        for (const len of [28, 80, LEN.block]) {
          for (const [w, top] of [[4.56, BODY_Y], [4.04, BODY_Y], [4.56, 3.9]] as const) {
            const p = planSteps(Array.from({ length: n }, () => texto(len)), w, top, NIGHT_BOTTOM)
            const rotulo = `${n}×${len} em ${w}"@${top}"`
            expect(p.gapDentro, rotulo).toBeGreaterThan(0)
            expect(p.gapEntre, rotulo).toBeCloseTo(AGRUPAMENTO * p.gapDentro, 9)
            // o respiro DESENHADO é o que fecha a conta do vão entre passos
            expect(p.gap + p.gapDentro, rotulo).toBeCloseTo(p.gapEntre, 9)
            // e o bloco continua dentro da área (o agrupamento não empurra nada
            // para fora: quem não cabe vai para o slide seguinte)
            const fim =
              p.lines.slice(0, p.fits).reduce((a, l) => a + l * p.lineH, 0) +
              Math.max(0, p.fits - 1) * p.gap
            expect(top + fim, rotulo).toBeLessThanOrEqual(NIGHT_BOTTOM + EPS)
          }
        }
      }
    })

    it('no DESENHO: as caixas dos passos ficam AGRUPAMENTO × mais longe que as linhas de dentro', () => {
      for (const { m, spec } of missoes) {
        for (const rec of draw(spec)) {
          const passos = rec.objs
            .filter((o) => o.role === 'text' && /^\d+\.\s/.test(o.text ?? ''))
            .sort((a, b) => a.y - b.y)
          expect(passos.length, m).toBeGreaterThan(1)
          for (let i = 0; i + 1 < passos.length; i++) {
            const o = passos[i]
            // entrelinha TRAVADA na caixa (pontos) → o vão dentro do passo
            expect(o.lineSpacing, `${m}: passo ${i} sem entrelinha travada`).toBeGreaterThan(0)
            const dentro = vaoDentroDoPasso(o.fontSize!, o.lineSpacing! / 72)
            const entre = passos[i + 1].y - (o.y + o.h) + dentro
            expect(entre / dentro, `${m}: passos ${i}×${i + 1}`).toBeGreaterThanOrEqual(
              AGRUPAMENTO - 1e-6,
            )
          }
        }
      }
    })
  })
})

// ==================================================== item 20 (Fase 0e)
/**
 * A DIMENSÃO QUE FALTAVA NA AMOSTRA — contagem de TOKENS do prompt.
 *
 * A 3ª rodada do Sol reproduziu, por execução, uma quebra da invariante 0: um
 * `writing.prompt` de 120 caracteres feito de 41 tokens vazios separados por
 * ` / `, com 6 `unscramble`, levava `kf` a 0.4518; o plano previa um rótulo de
 * 0.0723" e o renderer desenhava `Math.max(0.08, …)` — o chip do rótulo entrava
 * na primeira pastilha do item (0.00284 in², acima do EPS deste arquivo).
 *
 * O teste antigo não via porque enumerava só o número de LINHAS de chips (1 a 3)
 * via `chipRowsOf`, nunca o prompt de verdade. Aqui a enumeração é sobre a
 * contagem de tokens — de 1 (uma palavra de 120 caracteres) a 41 (o máximo que
 * cabe no teto do contrato) — e passa pelo RENDERER, que é onde o piso morava.
 */
describe.skipIf(!presente)('writing: enumeração por CONTAGEM DE TOKENS do prompt (item 20)', () => {
  /** exatamente `n` tokens separados por ' / ', no teto de `LEN.prompt` */
  const tokens = (n: number): string => {
    const sobra = Math.max(0, LEN.prompt - 3 * (n - 1))
    const base = Math.floor(sobra / n)
    const resto = sobra - base * n
    return Array.from({ length: n }, (_, i) => 'a'.repeat(base + (i < resto ? 1 : 0))).join(' / ')
  }

  /** 41 é o teto: 41 tokens vazios + 40 separadores = 120 caracteres */
  const MAX_TOKENS = 41
  const DISTRIBUICOES = [[1], [2], [3], [4], [5], [1, 5], [3, 3], [5, 1], [2, 4]]

  it('o gerador de tokens respeita o contrato e chega ao teto', () => {
    for (let n = 1; n <= MAX_TOKENS; n++) {
      const t = tokens(n)
      expect(t.length, `n=${n}`).toBeLessThanOrEqual(LEN.prompt)
      expect(t.split(' / ').length, `n=${n}`).toBe(n)
      expect(t.length, `n=${n}`).toBeGreaterThan(0)
    }
    expect(tokens(MAX_TOKENS).length).toBe(LEN.prompt)
    expect(tokens(MAX_TOKENS).replace(/[ /]/g, '')).toBe('')
  })

  it('nenhuma combinação (tokens × distribuição) produz colisão ou transbordo', () => {
    const achados: string[] = []
    for (let n = 1; n <= MAX_TOKENS; n++) {
      const prompt = tokens(n)
      for (const dist of DISTRIBUICOES) {
        const spec = SlideSchemaV2.parse({
          type: 'writing',
          instruction: 'Put the words in order:',
          exercises: dist.map((qtd) => ({
            kind: 'unscramble',
            items: Array.from({ length: qtd }, () => ({ prompt })),
          })),
        }) as SlideSpec
        const rotulo = `${n} tokens × ${dist.join('+')}`
        const slides = draw(spec)
        expect(slides.length, rotulo).toBeGreaterThan(0)
        slides.forEach((s, p) => {
          for (const c of colisoes(s)) achados.push(`${rotulo} pág.${p + 1}: ${c}`)
          for (const o of s.objs) {
            if (o.y >= 5.2) continue // rodapé, fora do corpo por desenho
            if (o.y + o.h > BODY_BOTTOM + EPS) {
              achados.push(`${rotulo} pág.${p + 1}: ${o.role} termina em ${(o.y + o.h).toFixed(3)}`)
            }
            if (o.h < 0) achados.push(`${rotulo} pág.${p + 1}: ${o.role} com altura negativa`)
          }
        })
      }
    }
    expect(achados.slice(0, 12), `${achados.length} achado(s):\n${achados.slice(0, 12).join('\n')}`).toEqual([])
  })

  /**
   * O CASO EXATO do parecer, desenhado. Antes: intersecção de 0.00284 in² entre
   * o chip do rótulo e a 1ª pastilha do item.
   */
  it('o caso reproduzido pelo Sol não tem mais intersecção nenhuma', () => {
    const prompt = tokens(41)
    const spec = SlideSchemaV2.parse({
      type: 'writing',
      instruction: 'Put the words in order:',
      exercises: [
        { kind: 'unscramble', items: Array.from({ length: 3 }, () => ({ prompt })) },
        { kind: 'unscramble', items: Array.from({ length: 3 }, () => ({ prompt })) },
      ],
    }) as SlideSpec
    const slides = draw(spec)
    // pagina: os pisos de 6 unscramble de 4 linhas não cabem numa banda de 2.72"
    expect(slides.length).toBeGreaterThan(1)
    for (const s of slides) {
      const c = colisoes(s)
      expect(c, `${c.length} par(es):\n${c.join('\n')}`).toEqual([])
    }
    // e TODOS os 6 itens são desenhados — paginar não é esconder. O chip
    // numerado é o PNG quadrado na margem esquerda (chip-N.png).
    const numeros = slides
      .flatMap((s) => s.objs)
      .filter((o) => o.path?.includes('chip-') && Math.abs(o.x - MX) < EPS)
    expect(numeros.map((o) => o.path?.replace(/^.*chip-/, '').replace('.png', ''))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })
})

// ==================================================== item 20 (guarda de fonte)
/**
 * A INVARIANTE COMO REGRA DE CÓDIGO, não como boa intenção.
 *
 * Os três defeitos que fecharam as Fases 0b, 0c e 0e são o MESMO: uma altura
 * decidida no desenho, depois (e diferente) da altura que o plano mediu. A spec
 * §7-quater generaliza a proibição do §2.1 — "nenhum piso pode ser reaplicado no
 * renderer depois do plano; a geometria vem do plano, ponto".
 *
 * Uma proibição que só existe na spec volta na próxima pressa. Esta é a versão
 * executável dela: o renderer do v2 não pode conter `Math.max`/`Math.min`. Se
 * alguém precisar de um, o lugar é `layout.ts` — onde a conta FECHA e onde os
 * testes de plano a alcançam.
 */
describe('o renderer do v2 não decide dimensão (spec §7-quater, item 20)', () => {
  it('template-v2.ts não contém nenhum Math.max/Math.min', () => {
    const fonte = readFileSync('src/lib/slides/template-v2.ts', 'utf8')
    const linhas = fonte
      .split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      // comentários citam o defeito de propósito; o que não pode é CÓDIGO
      .filter(({ l }) => /Math\.(max|min)\s*\(/.test(l) && !/^\s*(\*|\/\/)/.test(l))
    expect(
      linhas.map(({ n, l }) => `${n}: ${l.trim()}`),
      'piso de dimensão no renderer — mova para layout.ts',
    ).toEqual([])
  })

  it('e o motor de medida continua sendo layout.ts (a conta mora em algum lugar)', () => {
    const motor = readFileSync('src/lib/slides/layout.ts', 'utf8')
    expect((motor.match(/Math\.(max|min)\s*\(/g) ?? []).length).toBeGreaterThan(20)
  })
})

// ------------------------------------------- defeitos do lote de 14 aulas (24/07)
/**
 * As 14 aulas novas foram escritas por três autores em paralelo e os três
 * esbarraram nos mesmos defeitos do template — cada um contornando NO CONTEÚDO.
 * Contorno em conteúdo é dívida: some quando o próximo autor não souber da
 * limitação. Aqui os três viram régua.
 */

/** as pastilhas de fala de um slide de diálogo (texto COM fundo próprio) */
const pastilhas = (rec: Rec): Obj[] => rec.objs.filter((o) => o.role === 'veiled' && Boolean(o.text))

/** a "assinatura de cor" de uma fala: fundo da pastilha + cor do nome */
const corDaFala = (o: Obj): string => `${o.fill}/${o.runColors?.[0]}`

const dialogo = (
  lines: Array<{ speaker: string; text: string }>,
  extra: Partial<Extract<SlideSpec, { type: 'dialogue' }>> = {},
): SlideSpec => ({ type: 'dialogue', title: 'Cena', lines, ...extra }) as SlideSpec

describe.skipIf(!presente)('defeito 1 — a cor do diálogo sai do FALANTE, não da posição', () => {
  /**
   * O caso que o autor do M3 contornou reescrevendo as cenas: quando o mesmo
   * personagem fala duas vezes seguidas, a alternância por lane pinta a mesma
   * voz de duas cores no mesmo slide e a aluna perde a âncora de quem fala.
   */
  const CONSECUTIVAS = [
    { speaker: 'Traveller', text: 'Excuse me, is this the train to Porto?' },
    { speaker: 'Traveller', text: 'Sorry — I mean the 9:15 one.' },
    { speaker: 'Agent', text: 'Yes, platform two.' },
    { speaker: 'Traveller', text: 'Thank you!' },
  ]

  it('falas consecutivas do mesmo falante mantêm a MESMA pastilha', () => {
    const [slide] = draw(dialogo(CONSECUTIVAS))
    const balões = pastilhas(slide)
    expect(balões).toHaveLength(4)
    const cores = balões.map(corDaFala)
    // as três falas da viajante (0, 1 e 3) têm a mesma assinatura de cor
    expect(new Set([cores[0], cores[1], cores[3]]).size).toBe(1)
    // e o agente tem OUTRA
    expect(cores[2]).not.toBe(cores[0])
  })

  it('CANÁRIO: a régua ANTIGA (cor por posição) reprova o mesmo diálogo', () => {
    // sem canário, "mesma cor" poderia estar passando por acidente de paleta:
    // aqui a alternância por índice é reproduzida e a mesma cena É reprovada.
    const porPosicao = CONSECUTIVAS.map((_, i) => (i % 2 === 0 ? 'A' : 'B'))
    expect(new Set([porPosicao[0], porPosicao[1], porPosicao[3]]).size).toBeGreaterThan(1)
  })

  it('3 e 4 falantes (M3A2 e M3A4): cada voz tem a sua faixa, sempre a mesma', () => {
    for (const vozes of [
      ['Crew', 'Traveller', 'Neighbour', 'Traveller', 'Crew', 'Traveller', 'Neighbour', 'Crew'],
      ['Agent', 'Traveller', 'Crew', 'Traveller', 'Help desk', 'Traveller', 'Agent', 'Crew'],
    ]) {
      const [slide] = draw(dialogo(vozes.map((v) => ({ speaker: v, text: `Fala de ${v}.` }))))
      const balões = pastilhas(slide)
      expect(balões, vozes.join('/')).toHaveLength(vozes.length)
      const porVoz = new Map<string, Set<string>>()
      balões.forEach((b, i) => {
        const set = porVoz.get(vozes[i]) ?? new Set<string>()
        set.add(corDaFala(b))
        porVoz.set(vozes[i], set)
      })
      // uma voz, UMA cor
      for (const [voz, cores] of porVoz) expect([...cores], voz).toHaveLength(1)
      // vozes distintas, cores distintas (até o tamanho da paleta)
      const distintas = new Set([...porVoz.values()].map((s) => [...s][0]))
      expect(distintas.size).toBe(Math.min(porVoz.size, DIALOGUE.lanes))
    }
  })

  it('a paleta e a contagem de faixas andam JUNTAS (uma faixa sem cor é undefined)', () => {
    expect(DIALOGUE_LANES).toHaveLength(DIALOGUE.lanes)
  })

  it('a paleta de 2 falantes é EXATAMENTE a que já valia (a gramática de cor)', () => {
    const [slide] = draw(
      dialogo([
        { speaker: 'Ana', text: 'Good morning!' },
        { speaker: 'Clerk', text: 'Sure.' },
      ]),
    )
    const [a, b] = pastilhas(slide)
    expect([a.fill, a.runColors?.[0]]).toEqual([T.paper100, T.brand700])
    expect([b.fill, b.runColors?.[0]]).toEqual([T.tealWash, T.teal700])
  })

  it('`speakerLanes`: o nome é a chave (espaço e caixa não criam personagem novo)', () => {
    expect(speakerLanes(['Ana', 'Clerk', 'ana', ' Ana '])).toEqual([0, 1, 0, 0])
    // mais vozes que faixas: a numeração dá a volta — duas VOZES podem dividir
    // uma cor, o que a régua proíbe é a mesma voz em duas cores
    expect(speakerLanes(['a', 'b', 'c', 'd', 'e', 'a'])).toEqual([0, 1, 2, 3, 0, 0])
  })
})

describe.skipIf(!presente)('defeito 2 — a pastilha do diálogo é MEDIDA pelo texto real', () => {
  /** a coluna real do M4A1: diálogo com glossário ao lado */
  const COL = presente ? asideSplit(3.0).main.w - DIALOGUE.indent : 0

  it('a medida do template REPRODUZ o teto empírico do autor do M4 (54 ✓, 61 ✗)', () => {
    // ele mediu na mão: 61 caracteres rompem o fundo, 54 é o teto seguro. A
    // régua do template chega ao MESMO número — o que faltava não era calibrar,
    // era MEDIR antes de desenhar.
    const linhas = (n: number): number => wrapLines(texto(n), charsPerLine(COL, 12.5))
    expect(linhas(54)).toBe(1)
    expect(linhas(61)).toBe(2)
  })

  it('CANÁRIO: a pastilha ANTIGA (altura de lista, corpo fixo) é REPROVADA', () => {
    // geometria exata da Fase 0b: `fillRows` para 8 falas + 12.5pt fixo +
    // `margin: 0.11` (que eram 0.11 PONTOS, ≈0.0015" — texto colado no fundo).
    const spread = fillRows(BODY_Y + 0.38, BODY_BOTTOM, 8, { h: 0.46, gap: 0.1 }, 1.7)
    const antiga: Rec = {
      master: MASTER_V2.paper,
      notes: [],
      objs: [
        {
          role: 'veiled',
          x: 0.42,
          y: spread.y0,
          w: COL,
          h: spread.h,
          text: `Receptionist   ${texto(61)}`,
          fontSize: 12.5,
          margin: 0.11,
          bleed: false,
          z: 0,
        },
      ],
    }
    const achados = transbordos(antiga)
    expect(achados, 'a pastilha antiga tinha de ser reprovada').not.toEqual([])
    expect(achados[0]).toContain('12.5pt')
  })

  it('a MESMA fala de 61 caracteres, no plano novo, cabe dentro do fundo', () => {
    const [slide] = draw(
      dialogo(
        Array.from({ length: 8 }, (_, i) => ({
          speaker: i % 2 ? 'Guest' : 'Receptionist',
          text: texto(61),
        })),
        { glossary: [{ term: 'deposit', pt: 'caução' }] },
      ),
    )
    expect(pastilhas(slide)).toHaveLength(8)
    expect(transbordos(slide, (o) => o.role === 'veiled')).toEqual([])
  })

  it('quem cede é o corpo, nunca a borda — e o corpo é UM só para o diálogo', () => {
    for (const n of [2, 4, 6, 8]) {
      const [slide] = draw(
        dialogo(
          Array.from({ length: n }, (_, i) => ({
            speaker: i % 2 ? 'B' : 'A',
            text: texto(LEN.line / 2),
          })),
        ),
      )
      const corpos = new Set(pastilhas(slide).map((b) => b.fontSize))
      expect([...corpos], `${n} falas`).toHaveLength(1)
      expect([...corpos][0], `${n} falas`).toBeGreaterThanOrEqual(DIALOGUE.sizes[DIALOGUE.sizes.length - 1])
    }
  })

  it('nem no piso cabendo, o diálogo PAGINA — e não esconde uma fala sequer', () => {
    const falas = Array.from({ length: 8 }, (_, i) => ({
      speaker: i % 2 ? 'B' : 'A',
      text: texto(LEN.line),
    }))
    const slides = draw(dialogo(falas, { context: texto(LEN.line) }))
    expect(slides.length).toBeGreaterThan(1)
    const balões = slides.flatMap(pastilhas)
    expect(balões).toHaveLength(falas.length)
    for (const s of slides) expect(transbordos(s, (o) => o.role === 'veiled')).toEqual([])
  })

  it('paginando, a continuação sai no MESMO corpo (irmã, não outra lista)', () => {
    // a régua da Fase 0d no cartaz da missão, aplicada aqui: com menos falas, a
    // página 2 escolheria um corpo maior e as duas telas do MESMO diálogo
    // sairiam em tipografias diferentes
    const slides = draw(
      dialogo(
        Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 ? 'B' : 'A', text: texto(LEN.line) })),
        { context: texto(LEN.line) },
      ),
    )
    expect(slides.length).toBeGreaterThan(1)
    expect(new Set(slides.flatMap(pastilhas).map((b) => b.fontSize)).size).toBe(1)
  })

  it('paginando, a cor do falante NÃO recomeça na página 2', () => {
    const falas = Array.from({ length: 8 }, (_, i) => ({
      speaker: ['Agent', 'Traveller', 'Crew'][i % 3],
      text: texto(LEN.line),
    }))
    const slides = draw(dialogo(falas, { context: texto(LEN.line) }))
    expect(slides.length).toBeGreaterThan(1)
    const cores = slides.flatMap(pastilhas).map(corDaFala)
    const porVoz = new Map<string, Set<string>>()
    falas.forEach((f, i) => {
      const set = porVoz.get(f.speaker) ?? new Set<string>()
      set.add(cores[i])
      porVoz.set(f.speaker, set)
    })
    for (const [voz, c] of porVoz) expect([...c], voz).toHaveLength(1)
  })

  it('`planDialogue` diz a VERDADE: nem uma fala cabendo, `fits` é 0 (não força)', () => {
    const plano = planDialogue([{ speaker: 'A', text: texto(LEN.line) }], {
      w: 1.2,
      top: BODY_Y,
      bottom: BODY_Y + 0.2,
    })
    expect(plano.fits).toBe(0)
    expect(plano.total).toBe(1)
  })
})

/**
 * INVARIANTE 0-bis, geral: a régua roda em TODOS os tipos, no máximo e no
 * mínimo do contrato, sobre todo texto que carrega o próprio fundo e que NÃO
 * delega o encaixe ao autoajuste do conversor (`fit: 'shrink'`, que a Fase 0b
 * registrou não sobreviver à conversão do Google Slides) nem desliga a quebra
 * (`wrap: false`, chip de uma palavra só).
 */
describe.skipIf(!presente)('invariante 0-bis — nenhum texto excede o shape que o contém', () => {
  const medivel = (o: Obj): boolean =>
    o.role === 'veiled' && o.fit === undefined && o.wrap !== false

  /**
   * DÍVIDA REGISTRADA, não exceção silenciosa: `speaking` desenha a frase numa
   * pastilha de altura de lista com corpo fixo em 14.5pt — a MESMA classe do
   * defeito 2, que só aparece no teto do contrato (frase de 200 caracteres; as
   * frases reais têm ~40). Está FORA do escopo deste conserto (é outro layout,
   * e mexer nele mudaria os 20 decks do lote). Quando for consertado, este
   * teste falha pedindo que o tipo saia da lista.
   */
  const DIVIDA = ['speaking']

  it(`só ${DIVIDA.join(', ')} transborda — e é dívida conhecida, não novidade`, () => {
    const tipos = new Set<string>()
    const achados: string[] = []
    for (const [nome, specs] of [
      ['máximo', MAX],
      ['mínimo', MIN],
    ] as const) {
      for (const spec of specs) {
        draw(spec).forEach((s, i) => {
          for (const t of transbordos(s, medivel)) {
            tipos.add(spec.type)
            achados.push(`${nome}/${spec.type}/tela ${i + 1}: ${t}`)
          }
        })
      }
    }
    expect([...tipos].sort(), achados.join('\n')).toEqual(DIVIDA)
  })

  it('o DECK REAL do M5A1: nenhum texto sai do fundo que o carrega', () => {
    const real = LessonSchemaV2.parse(
      JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')),
    )
    const { pres, slides } = recorder()
    for (const spec of real.slides) renderSlideV2(pres, real, spec)
    const achados: string[] = []
    slides.forEach((s, i) => {
      for (const t of transbordos(s, medivel)) achados.push(`slide ${i + 1}: ${t}`)
    })
    expect(achados, achados.join('\n')).toEqual([])
  })
})

/**
 * INVARIANTE 0-ter — o fio da marca NUNCA risca o título.
 *
 * Roda no teto e no piso do contrato, em TODOS os tipos: é a rede que faltava
 * quando o defeito nasceu. O caso nomeado ("THE PILLARS OF FLUENCY", M0A2
 * slide 5) entra como caso de regressão explícito — ele é o retrato do defeito:
 * 22 caracteres que o modelo antigo dava por UMA linha e que na página são
 * DUAS, porque caixa alta é ~30% mais larga por caractere.
 */
describe.skipIf(!presente)('invariante 0-ter — nenhuma marca intersecta a caixa do título', () => {
  it('no MÁXIMO e no MÍNIMO do contrato, em todo tipo', () => {
    const achados: string[] = []
    for (const [nome, specs] of [
      ['máximo', MAX],
      ['mínimo', MIN],
    ] as const) {
      for (const spec of specs) {
        draw(spec).forEach((s, i) => {
          for (const r of tituloRiscado(s)) achados.push(`${nome}/${spec.type}/tela ${i + 1}: ${r}`)
        })
      }
    }
    expect(achados, achados.join('\n')).toEqual([])
  })

  it('regressão nomeada: o título em CAIXA ALTA do M0A2 slide 5', () => {
    const s = draw({
      type: 'section',
      kicker: 'Part 1 · Você está aqui',
      title: 'THE PILLARS OF FLUENCY',
      subtitle: 'Os pilares. Antes das frases, a base.',
    } as SlideSpec)[0]
    expect(tituloRiscado(s), tituloRiscado(s).join('\n')).toEqual([])
    // e o fio continua COLADO no título — conserto não pode virar fio solto
    const titulo = s.objs.find(ehTitulo)!
    const fio = s.objs.find((o) => o.role === 'mark' && o.path?.endsWith('brand-strip.png'))!
    const real = caixaRealDoTitulo(titulo)
    expect(fio.y).toBeGreaterThan(real.y + real.h - EPS)
    expect(fio.y - (real.y + real.h)).toBeLessThan(0.2)
  })
})

/**
 * O LOTE DE 14 AULAS, INTEIRO. Os defeitos 1 e 2 nasceram na produção real, não
 * no conteúdo sintético dos testes: a rede tem de rodar sobre as aulas que os
 * três autores escreveram. É barato (o renderer é puro) e é o que pega o
 * próximo diálogo com três vozes ou com uma fala comprida.
 */
describe.skipIf(!presente)('todas as aulas do lote (content/personal-travel-v2)', () => {
  const aulas = (presente ? readdirSync(join(privado.content, 'personal-travel-v2')) : [])
    .filter((f) => f.endsWith('.json'))
    .sort()

  /**
   * O número FIXO (`toHaveLength(20)`) saiu daqui na rodada dos nove autores em
   * paralelo: a pasta cresce de 20 para 65 arquivos um módulo por vez, e um
   * censo cravado transforma cada entrega de conteúdo numa falha vermelha que
   * não tem nada a ver com layout — o teste vira ruído e a rede de baixo (o
   * laço por arquivo, que é quem pega colisão e transbordo) para de ser lida.
   *
   * O que o censo protegia continua protegido, sem envelhecer: a pasta não
   * encolhe abaixo do lote já revisado e todo arquivo ali dentro é uma aula
   * endereçável (`m<N>a<1-4>.json` ou `m<N>-mission.json`) — nome fora do padrão
   * é arquivo que o resto da fábrica não acha.
   */
  it('a pasta não encolhe e todo arquivo tem nome de aula', () => {
    expect(aulas.length).toBeGreaterThanOrEqual(20)
    const foraDoPadrao = aulas.filter((f) => !/^m\d+(a[1-4]|-mission)\.json$/.test(f))
    expect(foraDoPadrao, foraDoPadrao.join(', ')).toEqual([])
  })

  for (const arquivo of aulas) {
    it(`${arquivo}: zero colisão, zero transbordo, fio fora do título e nada fora da banda`, () => {
      const aula = LessonSchemaV2.parse(
        JSON.parse(readFileSync(join(privado.content, 'personal-travel-v2', `${arquivo}`), 'utf8')),
      )
      const { pres, slides } = recorder()
      for (const spec of aula.slides) renderSlideV2(pres, aula, spec)
      const achados: string[] = []
      slides.forEach((s, i) => {
        for (const c of colisoes(s)) achados.push(`slide ${i + 1} · colisão: ${c}`)
        for (const t of transbordos(s, (o) => o.role === 'veiled' && o.fit === undefined && o.wrap !== false)) {
          achados.push(`slide ${i + 1} · transbordo: ${t}`)
        }
        for (const r of tituloRiscado(s)) achados.push(`slide ${i + 1} · fio no título: ${r}`)
        if (s.master === MASTER_V2.paper) {
          for (const o of s.objs.filter((o) => o.y < 5.2)) {
            if (o.y + o.h > BODY_BOTTOM + EPS) {
              achados.push(`slide ${i + 1} · borda: ${o.role} termina em ${(o.y + o.h).toFixed(3)}`)
            }
          }
        }
      })
      expect(achados, `${arquivo}:\n${achados.join('\n')}`).toEqual([])
    })
  }
})
