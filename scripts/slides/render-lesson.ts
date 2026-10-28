// M-Slides-1 — renderiza o deck .pptx de UMA aula a partir do JSON validado.
// Uso: npm run slides:render -- content/personal-travel/m5a1.json
// Saída: out/slides/M<mod>A<aula> — <título>.pptx (arrastar para o Drive;
// a conversão para Google Slides é automática ao abrir).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lessonSchemaFor, type LessonDoc } from '../../src/lib/slides/lesson-schema.ts'
import { buildLesson, deckCode, isV2, packDeck } from '../../src/lib/slides/build.ts'
import { defineMasters, renderSlide, renderedSlideCount } from '../../src/lib/slides/template.ts'
import { checkFit } from '../../src/lib/slides/fit-check.ts'

/** slides REAIS dentro do .pptx — conta as partes do pacote, sem adivinhar */
function contarSlides(buf: Buffer): number {
  return (buf.toString('latin1').match(/ppt\/slides\/slide\d+\.xml/g) ?? []).filter(
    (s, i, todos) => todos.indexOf(s) === i,
  ).length
}

/**
 * `course` decide QUAL contrato vale (Fase 0d, item 19): os tetos de
 * comprimento (`LEN`) são do v2 e só são cobrados no caminho v2 — uma aula v1
 * com campo longo continua carregando aqui exatamente como sempre carregou.
 */
export function loadLesson(path: string, course?: string | null): LessonDoc {
  const parsed = lessonSchemaFor(course).safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    console.error(`✗ ${path} inválido:\n${parsed.error.message}`)
    process.exit(1)
  }
  return parsed.data
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const input = process.argv[2]
  if (!input) {
    console.error('Uso: npm run slides:render -- content/personal-travel/m5a1.json')
    process.exit(1)
  }
  // 2º argumento OPCIONAL: o curso que escolhe o template E o contrato. Sem
  // ele, v1 (como sempre). `personal-travel-v2` renderiza a MESMA aula no
  // template v2 — é o comando do piloto antes/depois:
  //   npm run slides:render -- content/personal-travel/m5a1.json personal-travel-v2
  const course = process.argv[3]
  const doc = loadLesson(resolve(input), course)
  // AVISOS DE ENCAIXE NO MESMO CANAL DE QUEM ESCREVE (defeito 3 do lote de 14
  // aulas): o `fit-check` só falava com a tela do /admin/slides, e quem escreve
  // conteúdo neste lote usa o CLI. Aviso não bloqueia — informa o preço.
  const SINAL = { estouro: '✗', aperto: '⚠', 'paginação': '↳' } as const
  for (const a of checkFit(doc, course)) {
    console.warn(`${SINAL[a.severity]} slide ${a.slide} (${a.type}): ${a.what}\n    → ${a.fix}`)
  }
  const sufixo = isV2(course) ? ' — v2' : ''
  const outDir = join(process.cwd(), 'out', 'slides')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${deckCode(doc)} — ${doc.lesson.title}${sufixo}.pptx`)
  packDeck(buildLesson(doc, course)).then((buf) => {
    writeFileSync(file, buf)
    // no v2 o quiz consolida as respostas numa tela só (spec §7-bis, defeito 7),
    // então a contagem do v1 não vale para ele — quem conta é o pacote
    const total = isV2(course) ? contarSlides(buf) : renderedSlideCount(doc)
    console.log(`✓ ${file} (${total} slides, incl. gabaritos automáticos)`)
  })
}
