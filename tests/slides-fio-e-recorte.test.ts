// Os DOIS defeitos da varredura visual dos 65 decks (25/07), presos em teste.
//
//  1. O fio-gradiente riscava a segunda linha do título (51 slides, 33 decks).
//     Causa: o planejador media o título por CONTAGEM DE CARACTERES, cego à
//     caixa alta. A caixa saía com altura de uma linha, o fio ia para logo
//     abaixo dela, e a página quebrava em duas.
//  2. A capa em retrato numa página 16:9. Causa: o `sizing: {type:'cover'}` do
//     pptxgenjs nunca recortou nada sob Node — ele usa o tamanho da CAIXA como
//     tamanho da imagem, o recorte dá zero e a foto sai ESTICADA.
//
// A invariante geral ("nenhuma marca intersecta a caixa do título", nos 65
// decks) mora em `slides-v2-layout.test.ts`. Aqui ficam as peças puras e o
// contrato com o pptxgenjs, que é onde o defeito 2 se esconde.
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { carregarSePresente, presente, privado } from './_privado'
import {
  DISPLAY_SAFE,
  TEXT_INSET_X,
  ancoraDaCapa,
  charsPerLine,
  displayLines,
  displayTitleBox,
  displayWidthEm,
  planPhotoCrop,
  wrapLines,
} from '../src/lib/slides/layout'
import { imageSize } from '../src/lib/slides/image-size'
const { HEAD_W, planHead } = await carregarSePresente(() => import('../src/lib/slides/template-v2'))

const LIB = join(privado.brand, 'slides', 'library')

// ------------------------------------------------------------------ defeito 1
describe.skipIf(!presente)('largura do título: avanço de glifo, não contagem de caractere', () => {
  it('CAIXA ALTA é muito mais larga que caixa baixa com o MESMO número de letras', () => {
    // 10 letras cada; o modelo antigo daria exatamente a mesma largura às duas
    const alta = displayWidthEm('MMMMMMMMMM')
    const baixa = displayWidthEm('llllllllll')
    expect(alta / baixa).toBeGreaterThan(3)
    // e mesmo em texto de verdade a diferença é da ordem de 30%
    expect(displayWidthEm('THE PILLARS OF FLUENCY') / displayWidthEm('the pillars of fluency')).toBeGreaterThan(1.2)
  })

  it('acento não engorda a letra (o "á" mede o mesmo que o "a")', () => {
    expect(displayWidthEm('não')).toBeCloseTo(displayWidthEm('nao'), 6)
    expect(displayWidthEm('Ação')).toBeCloseTo(displayWidthEm('Acao'), 6)
  })

  it('o caso do defeito: os dois modelos DISCORDAM em "THE PILLARS OF FLUENCY"', () => {
    const t = 'THE PILLARS OF FLUENCY'
    // modelo antigo: 22 caracteres numa faixa que ele julga caber 24,6 → 1 linha
    expect(charsPerLine(HEAD_W, 34, true)).toBeGreaterThan(t.length)
    expect(wrapLines(t, charsPerLine(HEAD_W, 34, true))).toBe(1)
    // régua de glifo: a 34pt o texto ocupa 97% da caixa útil — quebra a qualquer
    // diferença de fonte, e é isso que a página mostrou
    const util = HEAD_W - 2 * TEXT_INSET_X
    expect((displayWidthEm(t) * 34) / 72).toBeGreaterThan(util * DISPLAY_SAFE)
    expect(displayLines(t, HEAD_W, 34, DISPLAY_SAFE)).toBe(2)
  })

  it('o plano do cabeçalho desce um degrau e o fio fica ABAIXO do título', () => {
    for (const t of ['THE PILLARS OF FLUENCY', 'FRIENDS & NETWORKING', 'Tempo não sobra. Tempo se marca.']) {
      const p = planHead(t, true)
      const caixa = displayTitleBox(t, HEAD_W, p.titleFont)
      expect(caixa.h, t).toBeLessThanOrEqual(p.titleH + 1e-9)
      expect(p.stripY, t).toBeGreaterThanOrEqual(p.titleY + caixa.h)
      // e continua COLADO: conserto do fio riscado não pode virar fio solto
      expect(p.stripY - (p.titleY + caixa.h), t).toBeLessThan(0.2)
    }
  })

  it('a folga NÃO inventa linha: o plano nunca prevê mais linhas que o Bricolage', () => {
    for (const t of [
      'Do Pedido à Conta Sem Travar',
      'Getting Around Without Fear',
      'Asking for Directions',
      'THE PILLARS OF FLUENCY',
      'Dez minutos agora valem mais que um plano perfeito depois',
    ]) {
      const p = planHead(t, true)
      expect(displayLines(t, HEAD_W, p.titleFont), t).toBe(p.lines)
    }
  })
})

// ------------------------------------------------------------------ defeito 2
describe.skipIf(!presente)('a biblioteca NÃO é 16:9 (o comentário mentiroso da capa)', () => {
  const capasEmRetrato = [
    'm5-v2/lost-tourist.jpg',
    'm5-v2/street-signs.jpg',
    'm5-v2/street-corner.jpg',
    'm5-v2/suitcase-window.jpg',
    'm5-v2/planning-flatlay.jpg',
    'm6/menu-reading.jpg',
    'm6/paying-card.jpg',
    'm7/cashier.jpg',
    'm7/fitting-mirror.jpg',
  ]

  it('as nove capas do M5/M6/M7 são RETRATO 2:3 — a capa recorta 62% da altura', () => {
    for (const f of capasEmRetrato) {
      const m = imageSize(`${LIB}/${f}`)
      expect(m, f).not.toBeNull()
      expect(m!.h, f).toBeGreaterThan(m!.w)
      expect(m!.w / m!.h, f).toBeCloseTo(2 / 3, 2)
    }
  })

  it('mede JPEG e PNG e devolve null no que não dá para medir', () => {
    expect(imageSize(`${LIB}/m5/bus-stop.jpg`)).toEqual({ w: 1100, h: 738 })
    expect(imageSize(`${LIB}/m0/notebook-and-watch.jpg`)).toEqual({ w: 1264, h: 848 })
    expect(imageSize(`${LIB}/m0/coffee-and-notes.jpg`)).toEqual({ w: 1024, h: 1024 })
    expect(imageSize(join(privado.brand, 'slides', 'assets', 'brand-strip.png'))?.w).toBeGreaterThan(0)
    expect(imageSize(`${LIB}/nao-existe.jpg`)).toBeNull()
  })
})

describe('planPhotoCrop — recorte "cover" de verdade', () => {
  const pagina = { w: 10, h: 5.625 }

  it('foto na proporção da caixa não perde nada', () => {
    expect(planPhotoCrop({ w: 1920, h: 1080 }, pagina)).toEqual({ l: 0, r: 0, t: 0, b: 0 })
  })

  it('retrato 2:3 numa página 16:9 corta ALTURA, nunca largura', () => {
    const c = planPhotoCrop({ w: 848, h: 1264 }, pagina, { y: 0.5 })
    expect(c.l).toBe(0)
    expect(c.r).toBe(0)
    expect(1 - c.t - c.b).toBeCloseTo(0.3775, 3)
    expect(c.t).toBeCloseTo(c.b, 6) // centro
  })

  it('a âncora move a janela sem mudar o tamanho dela', () => {
    const alto = planPhotoCrop({ w: 848, h: 1264 }, pagina, { y: 0 })
    const baixo = planPhotoCrop({ w: 848, h: 1264 }, pagina, { y: 1 })
    expect(alto.t).toBe(0)
    expect(baixo.b).toBe(0)
    expect(1 - alto.t - alto.b).toBeCloseTo(1 - baixo.t - baixo.b, 9)
  })

  it('3:2 numa coluna alta corta LARGURA', () => {
    const c = planPhotoCrop({ w: 1264, h: 848 }, { w: 3.06, h: 3.08 })
    expect(c.t).toBe(0)
    expect(c.b).toBe(0)
    expect(c.l).toBeGreaterThan(0.15)
    expect(c.l).toBeCloseTo(c.r, 6)
  })

  it('a âncora da capa sobe quanto mais alta for a foto', () => {
    // 16:9 não perde altura nenhuma: âncora no centro exato
    expect(ancoraDaCapa({ w: 1920, h: 1080 }, pagina)).toBeCloseTo(0.5, 6)
    // 3:2 já é mais alto que a página e perde 16% da altura — sobe um pouco
    expect(ancoraDaCapa({ w: 1264, h: 848 }, pagina)).toBeLessThan(0.5)
    expect(ancoraDaCapa({ w: 1264, h: 848 }, pagina)).toBeGreaterThan(0.46)
    expect(ancoraDaCapa({ w: 1024, h: 1024 }, pagina)).toBeLessThan(0.45)
    const retrato = ancoraDaCapa({ w: 848, h: 1264 }, pagina)
    expect(retrato).toBeGreaterThan(0.3)
    expect(retrato).toBeLessThan(0.45)
  })
})

/**
 * O CONTRATO COM O pptxgenjs — o teste que faltava para o defeito 2 existir.
 *
 * O recorte depende de um detalhe da biblioteca: numa imagem com `sizing`, o
 * `w`/`h` da chamada descreve o tamanho NATURAL do arquivo (é o que alimenta a
 * conta do recorte) e o `sizing.w`/`sizing.h` é a caixa que vai para a página.
 * O código antigo passava a CAIXA nos dois, a proporção batia consigo mesma, o
 * recorte dava zero e a foto saía esticada — sem que nada acusasse.
 *
 * Este teste lê o XML de verdade: se um upgrade do pptxgenjs mudar a conta, ele
 * fica vermelho em vez de a foto voltar a esticar em silêncio.
 */
describe.skipIf(!presente)('contrato do pptxgenjs: o recorte chega ao XML', () => {
  async function srcRectDe(opts: Record<string, unknown>): Promise<{ rect: number[]; ext: number[] }> {
    const p = new PptxGenJS()
    p.defineLayout({ name: 'P', width: 10, height: 5.625 })
    p.layout = 'P'
    p.addSlide().addImage(opts as never)
    const zip = await JSZip.loadAsync((await p.write({ outputType: 'nodebuffer' })) as Buffer)
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const r = /<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"\/>/.exec(xml)!
    // a extensão do PIC, não a do grupo (que o pptxgenjs escreve zerada antes)
    const pic = xml.slice(xml.indexOf('<p:pic>'))
    const e = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic)!
    return { rect: r.slice(1, 5).map(Number), ext: e.slice(1, 3).map(Number) }
  }

  it('o jeito ANTIGO (caixa nos dois lados) não recorta nada — a foto estica', async () => {
    const { rect } = await srcRectDe({
      path: `${LIB}/m5-v2/street-signs.jpg`,
      x: 0,
      y: 0,
      w: 10,
      h: 5.625,
      sizing: { type: 'cover', w: 10, h: 5.625 },
    })
    expect(rect).toEqual([0, 0, 0, 0])
  })

  it('o jeito NOVO recorta a altura e mantém a caixa da página', async () => {
    const img = imageSize(`${LIB}/m5-v2/street-signs.jpg`)!
    const box = { w: 10, h: 5.625 }
    const crop = planPhotoCrop(img, box, { y: ancoraDaCapa(img, box) })
    const naturalW = box.w / (1 - crop.l - crop.r)
    const naturalH = box.h / (1 - crop.t - crop.b)
    const { rect, ext } = await srcRectDe({
      path: `${LIB}/m5-v2/street-signs.jpg`,
      x: 0,
      y: 0,
      w: naturalW,
      h: naturalH,
      sizing: { type: 'crop', x: crop.l * naturalW, y: crop.t * naturalH, w: box.w, h: box.h },
    })
    const [l, r, t, b] = rect
    expect([l, r]).toEqual([0, 0])
    expect(t / 1e5).toBeCloseTo(crop.t, 4)
    expect(b / 1e5).toBeCloseTo(crop.b, 4)
    // 62% da altura cortada — e a foto ocupa a página inteira, sem deformar
    expect((t + b) / 1e5).toBeCloseTo(0.6225, 3)
    expect(ext).toEqual([9144000, 5143500])
  })
})

/**
 * A PROVA DE QUE O DECK REAL MUDOU: as nove capas em retrato passam pelo
 * caminho do recorte. Se alguém trocar o endereço da capa por uma foto deitada,
 * este teste continua verde (o recorte some porque não é mais preciso) — o que
 * se cobra é que o motor NÃO estique nenhuma delas.
 */
describe.skipIf(!presente)('as capas do lote não saem esticadas', () => {
  it('toda capa do M5 tem recorte compatível com a proporção do arquivo', () => {
    for (const arquivo of ['m5a1.json', 'm5a2.json', 'm5a3.json', 'm5a4.json', 'm5-mission.json']) {
      const doc = JSON.parse(readFileSync(join(privado.content, 'personal-travel-v2', `${arquivo}`), 'utf8'))
      const capa = doc.slides.find((s: { type: string }) => s.type === 'cover')
      const file = capa?.image?.file as string | undefined
      expect(file, arquivo).toBeTruthy()
      const img = imageSize(`${LIB}/${file}`)
      expect(img, `${arquivo} → ${file}`).not.toBeNull()
      const box = { w: 10, h: 5.625 }
      const crop = planPhotoCrop(img!, box, { y: ancoraDaCapa(img!, box) })
      const visivelX = 1 - crop.l - crop.r
      const visivelY = 1 - crop.t - crop.b
      // proporção da JANELA visível == proporção da CAIXA: é isto que garante
      // que a foto não deforma
      expect((img!.w * visivelX) / (img!.h * visivelY), arquivo).toBeCloseTo(box.w / box.h, 4)
    }
  })
})
