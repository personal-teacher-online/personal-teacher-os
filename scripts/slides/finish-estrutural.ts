/**
 * Fecha as 10 versoes ESTRUTURAIS (M5 e M6): valida o rascunho da IA contra o
 * contrato, importa o slide de listening ja curado (video + trecho + gabarito
 * humano) da versao funcional correspondente, e conserta o que a IA nao teria
 * como acertar sozinha. Escreve out/estrutural/<k>-final.json.
 *
 *   npx tsx scripts/slides/finish-estrutural.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { LessonSchema, type LessonDoc, type SlideSpec } from '../../src/lib/slides/lesson-schema.ts'
import { normalizeLessonDraft } from '../../src/lib/slides/draft.ts'
import { checkFit } from '../../src/lib/slides/fit-check.ts'
import { pastaDeConteudo } from '../../src/lib/pastas.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const dir = path.join(raiz, 'out/estrutural')
const plano = JSON.parse(fs.readFileSync(path.join(raiz, 'out/deploy/estrutural-plano.json'), 'utf8'))

/** de onde vem o listening ja validado por humano */
const FONTE: Record<string, string> = {
  '5-1': 'content/personal-travel/m5a1.json',
  '5-2': 'content/personal-travel/m5a2.json',
  '5-3': 'content/personal-travel/m5a3.json',
  '5-4': 'content/personal-travel/m5a4.json',
  '5-5': 'content/personal-travel/m5-mission.json',
  '6-1': 'out/deploy/m6a1-prod.json',
  '6-2': 'out/deploy/m6a2-final.json',
  '6-3': 'out/deploy/m6a3-final.json',
  '6-4': 'out/deploy/m6a4-final.json',
  '6-5': 'out/deploy/m6a5-final.json',
}

/**
 * Consertos de conteudo que a IA nao acertou e que eu nao quero mascarar num
 * corte automatico. Cada entrada e explicita e revisavel pela Teacher Vicky.
 */
const CONSERTOS: Record<string, (doc: LessonDoc) => string | null> = {
  // Missao do M5: 6 passos longos (ate 93 chars) estouram o cartaz. As missoes
  // ja aprovadas usam 5 passos de ate ~71. Encurta preservando a escada
  // estrutural do modulo (question words → to be → present simple → modal).
  '5-5': (doc) => {
    const m = doc.slides.find((s) => s.type === 'mission')
    if (!m || m.type !== 'mission') return null
    m.steps = [
      'Choose your **destination city**',
      'Write **3 questions**: Where…? How much…? When…?',
      'Answer with **to be**: Is it fast? Is it cheap?',
      'Add times with **present simple**: When does it leave?',
      '**Record a voice note**: your plan + 1 tip with should/can',
    ]
    return 'missao: 6 passos longos → 5 curtos'
  },
  // Mesmo caso no M6 (um passo de 110 chars). Preserva a escada do modulo:
  // demonstrativos → gostos → eat/drink/have → present continuous → entrega.
  '6-5': (doc) => {
    const m = doc.slides.find((s) => s.type === 'mission')
    if (!m || m.type !== 'mission') return null
    m.steps = [
      'Choose a menu with **5 dishes** (real or imagined)',
      'Point at two dishes with **this / that**',
      'Say what you **like** and **dislike** on it',
      "Order with **I'll have** / **I eat** / **I drink**",
      '**Record it** + 1 line in present continuous for Teacher Vicky',
    ]
    return 'missao: 6 passos longos → 5 curtos'
  },
}

function lerDoc(rel: string): LessonDoc {
  // `content/…` mora onde PT_CONTENT_DIR disser; o resto (`out/…`) é do repositório
  const arquivo = rel.startsWith('content/')
    ? path.join(pastaDeConteudo(raiz), rel.slice('content/'.length))
    : path.join(raiz, rel)
  const cru = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  return (cru.content ?? cru) as LessonDoc
}

function listeningDe(doc: LessonDoc): SlideSpec | null {
  return doc.slides.find((s) => s.type === 'listening') ?? null
}

let falhas = 0
for (const k of Object.keys(FONTE)) {
  const bruto = path.join(dir, `${k}.json`)
  if (!fs.existsSync(bruto)) {
    console.log(`${k}  — sem rascunho ainda`)
    continue
  }
  const [mod, aula] = k.split('-')
  const meta = plano[mod]
  const texto = fs.readFileSync(bruto, 'utf8').trim()
  const semCerca = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')

  let doc: LessonDoc
  try {
    const cru = JSON.parse(semCerca)
    doc = LessonSchema.parse(
      normalizeLessonDraft(cru, {
        moduleTitle: meta.moduleTitle,
        lessonTitle: meta.aulas[aula].titulo,
      }),
    )
  } catch (e) {
    falhas++
    console.log(`${k}  ✗ CONTRATO: ${(e as Error).message.slice(0, 400)}`)
    continue
  }

  // listening humano manda: video, trecho, itens marcados e gabarito
  const fonte = listeningDe(lerDoc(FONTE[k]))
  const iDraft = doc.slides.findIndex((s) => s.type === 'listening')
  let notaListening = 'sem listening (missao)'
  if (fonte && iDraft >= 0) {
    doc.slides[iDraft] = structuredClone(fonte)
    notaListening = 'listening importado'
  } else if (fonte && iDraft < 0) {
    falhas++
    console.log(`${k}  ✗ rascunho sem slide de listening, mas a versao funcional tem`)
    continue
  } else if (!fonte && iDraft >= 0) {
    // missao nao tem video curado: remove o listening inventado
    doc.slides.splice(iDraft, 1)
    notaListening = 'listening sem video removido'
  }

  // O prompt pedia ate 6 itens de writing, mas a medicao diz que 6 estoura
  // (defeito de origem, corrigido no prompt). Nos rascunhos que ja sairam,
  // corta o ultimo item do maior exercicio ate caber — a Teacher Vicky revisa depois.
  const cortes: string[] = []
  const conserto = CONSERTOS[k]?.(doc)
  if (conserto) cortes.push(conserto)
  for (const s of doc.slides) {
    if (s.type !== 'writing') continue
    for (let guarda = 0; guarda < 4; guarda++) {
      const apertado = checkFit({ ...doc, slides: [s] }).some((a) => a.severity === 'estouro')
      if (!apertado) break
      const maior = s.exercises.reduce((a, b) => (b.items.length > a.items.length ? b : a))
      if (maior.items.length <= 1) break
      cortes.push(`writing −1 item (${maior.kind})`)
      maior.items.pop()
    }
  }

  const avisos = checkFit(doc)
  const estouros = avisos.filter((a) => a.severity === 'estouro')
  const fit = estouros.length ? `✗ ${estouros.length} ESTOURO(S)` : avisos.length ? `${avisos.length} aperto(s)` : 'espaco ok'
  if (estouros.length) falhas++

  fs.writeFileSync(path.join(dir, `${k}-final.json`), JSON.stringify(doc, null, 2))
  console.log(
    `${k}  ${doc.slides.length} slides · ${notaListening} · ${fit}${cortes.length ? ` · ${cortes.join(', ')}` : ''}`,
  )
  for (const a of estouros) console.log(`      slide ${a.slide} (${a.type}): ${a.what} → ${a.fix}`)
}
console.log(falhas ? `\n${falhas} aula(s) precisam de conserto.` : '\nTodas validadas.')
