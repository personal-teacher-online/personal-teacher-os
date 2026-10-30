// FS-M2: a lib compartilhada monta o deck real (M5A1 do repositório) e o
// pacote sai saneado (invariante das partes fantasma preservada).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import JSZip from 'jszip'
import { carregarSePresente, presente, privado } from './_privado'
import { LessonSchema } from '../src/lib/slides/lesson-schema'
const { buildLesson, deckCode, packDeck } = await carregarSePresente(() => import('../src/lib/slides/build'))
const { renderedSlideCount } = await carregarSePresente(() => import('../src/lib/slides/template'))

describe.skipIf(!presente)('build do deck pela lib (FS-M2)', () => {
  it('gera o pptx do M5A1 com todos os slides', async () => {
    const doc = LessonSchema.parse(
      JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')),
    )
    expect(deckCode(doc)).toBe('M5A1')
    const pres = buildLesson(doc)
    expect(pres.author).toBe('Personal Teacher Academy')
    expect(pres.company).toBe('Personal Teacher Academy')
    const buf = await packDeck(pres)
    expect(buf.byteLength).toBeGreaterThan(100_000)
    // zip válido começa com PK
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    // propriedades do arquivo gerado (o que o dono vê ao abrir o .pptx)
    const zip = await JSZip.loadAsync(buf)
    expect(await zip.file('docProps/core.xml')!.async('string')).toMatch(
      /<dc:creator>Personal Teacher Academy<\/dc:creator>/,
    )
    expect(await zip.file('docProps/app.xml')!.async('string')).toMatch(
      /<Company>Personal Teacher Academy<\/Company>/,
    )
    expect(renderedSlideCount(doc)).toBeGreaterThan(doc.slides.length)
  }, 30_000)
})
