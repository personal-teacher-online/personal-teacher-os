// Template v2 / Fase 0a — o piloto M5A1 renderiza de verdade sob
// `personal-travel-v2`, e o v1 continua intacto (spec §7.1, §7.4, §7.5).
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { carregarSePresente, presente, privado } from './_privado'
import { LessonSchemaV2 } from '../src/lib/slides/lesson-schema'
const { buildLesson, deckCode, packDeck } = await carregarSePresente(() => import('../src/lib/slides/build'))
const { renderedSlideCount, revealCount } = await carregarSePresente(() => import('../src/lib/slides/template'))
import type { LessonDoc } from '../src/lib/slides/lesson-schema'
const { checkFit } = await carregarSePresente(() => import('../src/lib/slides/fit-check'))
const { MASTER_V2 } = await carregarSePresente(() => import('../src/lib/slides/template-v2'))
const { MASTER } = await carregarSePresente(() => import('../src/lib/slides/template'))
import { climateFor } from '../src/lib/slides/climate'

const m5a1 = () =>
  LessonSchemaV2.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')))

/**
 * Quantos slides o v2 produz. Difere do `renderedSlideCount` do v1 por UM
 * motivo: o quiz consolida as respostas numa tela só (spec §7-bis, defeito 7),
 * enquanto `listening` e `writing` mantêm a revelação progressiva.
 */
function contagemV2(doc: LessonDoc): number {
  return doc.slides.reduce((n, spec) => {
    if (spec.type === 'quiz') return n + 1 + (spec.questions.some((q) => q.answer) ? 1 : 0)
    return n + 1 + revealCount(spec)
  }, 0)
}

/**
 * Títulos dos masters do pacote. O pptxgenjs grava o `title` de cada
 * `defineSlideMaster` como o `name` do slideLayout correspondente — é ali que se
 * lê QUAL template montou o deck.
 */
async function masterNames(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const nomes: string[] = []
  for (const nome of Object.keys(zip.files)) {
    if (!/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(nome)) continue
    const xml = await zip.file(nome)!.async('string')
    const m = /<p:cSld name="([^"]*)"/.exec(xml)
    if (m) nomes.push(m[1])
  }
  return nomes
}

describe.skipIf(!presente)('render do piloto M5A1 sob personal-travel-v2', () => {
  it('produz um .pptx válido com todos os slides e sem transbordo', async () => {
    const doc = m5a1()
    expect(deckCode(doc)).toBe('M5A1')
    // o conteúdo do piloto é o mesmo; o que muda é o template
    expect(checkFit(doc).filter((w) => w.severity === 'estouro')).toEqual([])
    const buf = await packDeck(buildLesson(doc, 'personal-travel-v2'))
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    expect(buf.byteLength).toBeGreaterThan(100_000)
    const zip = await JSZip.loadAsync(buf)
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    expect(slides.length).toBe(contagemV2(doc))
    // o quiz do M5A1 tem 5 respostas: o v1 gerava 5 telas de gabarito, o v2 uma
    expect(renderedSlideCount(doc) - contagemV2(doc)).toBe(4)
  }, 60_000)

  it('usa os masters do v2 e o fog do CLIMA da PARTE do módulo', async () => {
    const doc = m5a1()
    const buf = await packDeck(buildLesson(doc, 'personal-travel-v2'))
    const nomes = await masterNames(buf)
    expect(nomes).toContain(MASTER_V2.paper)
    expect(nomes).toContain(MASTER_V2.night)
    expect(nomes).not.toContain(MASTER.paper)
    // M5 está na PARTE 3 (TIME TO TOUR)
    expect(climateFor(doc.module.number).fog).toBe('fog-p3')
    const zip = await JSZip.loadAsync(buf)
    const imagens = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'))
    expect(imagens.length).toBeGreaterThan(0)
  }, 60_000)

  it('o mesmo doc renderiza IGUAL duas vezes (variante determinística)', async () => {
    const doc = m5a1()
    const [a, b] = await Promise.all([
      packDeck(buildLesson(doc, 'personal-travel-v2')),
      packDeck(buildLesson(doc, 'personal-travel-v2')),
    ])
    const [xa, xb] = await Promise.all([JSZip.loadAsync(a), JSZip.loadAsync(b)])
    const xml = async (z: JSZip) => z.file('ppt/slides/slide1.xml')!.async('string')
    expect(await xml(xa)).toBe(await xml(xb))
  }, 60_000)
})

describe.skipIf(!presente)('v1 segue intacto', () => {
  it('sem curso (ou com o curso oficial) o deck sai no template v1', async () => {
    const doc = m5a1()
    for (const curso of [undefined, 'personal-travel', 'personal-travel-estrutural']) {
      const buf = await packDeck(buildLesson(doc, curso))
      const nomes = await masterNames(buf)
      expect(nomes, String(curso)).toContain(MASTER.paper)
      expect(nomes, String(curso)).not.toContain(MASTER_V2.paper)
    }
  }, 90_000)
})
