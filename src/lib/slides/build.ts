// FS-M2 — montagem do deck .pptx a partir de um LessonDoc validado (motor
// compartilhado entre a CLI de scripts/slides e a Fábrica de Slides do site).
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { COURSE_V2_PREFIX, type LessonDoc } from './lesson-schema.ts'
import { defineMasters, renderSlide } from './template.ts'
import { defineMastersV2, renderSlideV2 } from './template-v2.ts'

/**
 * Qual template este curso usa. O v2 (Fase 0a) vive AO LADO do v1: o curso
 * paralelo `personal-travel-v2` (e qualquer sufixo dele, ex.
 * `personal-travel-v2-piloto`) renderiza no template novo; QUALQUER outro curso
 * — inclusive o `personal-travel` em produção — continua no v1, byte por byte.
 *
 * A chave é o curso da AULA (coluna `slide_lessons.course`), não o `course` de
 * dentro do JSON: é a coluna que distingue as variantes da mesma aula (é assim
 * que `variantLabel` já funciona para a 'estrutural').
 *
 * O MESMO prefixo escolhe o CONTRATO em `lessonSchemaFor` (Fase 0d, item 19):
 * template v2 e tetos de comprimento do v2 andam juntos, por construção.
 */
export function isV2(course: string | null | undefined): boolean {
  return (course ?? '').startsWith(COURSE_V2_PREFIX)
}

export function buildLesson(doc: LessonDoc, course?: string | null): PptxGenJS {
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_16x9'
  pres.author = 'Personal Teacher'
  pres.company = 'Personal Teacher'
  pres.title = `${deckCode(doc)} — ${doc.lesson.title}`
  if (isV2(course ?? doc.course)) {
    defineMastersV2(pres, doc)
    for (const spec of doc.slides) renderSlideV2(pres, doc, spec)
    return pres
  }
  defineMasters(pres)
  for (const spec of doc.slides) renderSlide(pres, doc, spec)
  return pres
}

export function deckCode(doc: LessonDoc): string {
  return `M${doc.module.number}A${doc.lesson.number}`
}

/**
 * Sufixo do nome do deck para variantes do mesmo curso —
 * 'personal-travel-estrutural' vira ' (Estrutural)'. O curso base fica sem
 * sufixo (os decks já publicados mantêm o nome). Sem isso, duas versões da
 * mesma aula nasceriam com nome idêntico no Drive.
 */
export function variantLabel(course: string | null | undefined): string {
  const resto = (course ?? '').replace(/^personal-travel-?/, '')
  if (!resto) return ''
  const nome = resto.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return ` (${nome})`
}

// pptxgenjs 4.0.1 declara um slideMasterN.xml POR SLIDE no [Content_Types].xml,
// mas o pacote tem um único master real — o PowerPoint então exige "reparar".
// Saneia o pacote: remove Overrides que apontam para partes inexistentes.
export async function packDeck(pres: PptxGenJS): Promise<Buffer> {
  const raw = (await pres.write({ outputType: 'nodebuffer' })) as Buffer
  const zip = await JSZip.loadAsync(raw)
  const CT = '[Content_Types].xml'
  const xml = await zip.file(CT)!.async('string')
  const fixed = xml.replace(/<Override PartName="([^"]+)"[^>]*\/>/g, (tag, part: string) =>
    zip.file(part.slice(1)) ? tag : ''
  )
  zip.file(CT, fixed)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
