/**
 * Gera o SQL que grava as 10 versoes ESTRUTURAIS validadas em producao
 * (course = 'personal-travel-estrutural'). Nao toca em nada do curso oficial.
 *
 *   npx tsx scripts/slides/push-estrutural.ts > out/estrutural/push.sql
 */
import fs from 'node:fs'
import path from 'node:path'
import { LessonSchema } from '../../src/lib/slides/lesson-schema.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const dir = path.join(raiz, 'out/estrutural')

const linhas: string[] = ['begin;']
let n = 0
for (const mod of [5, 6]) {
  for (const aula of [1, 2, 3, 4, 5]) {
    const f = path.join(dir, `${mod}-${aula}-final.json`)
    if (!fs.existsSync(f)) continue
    const doc = LessonSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8')))
    const json = JSON.stringify(doc)
    if (json.includes('$ptos$')) throw new Error(`${mod}-${aula}: conteudo colide com o delimitador`)
    linhas.push(
      `update slide_lessons set content = $ptos$${json}$ptos$, updated_at = now()` +
        ` where course = 'personal-travel-estrutural' and module = ${mod} and lesson = ${aula}` +
        ` and status = 'rascunho';`,
    )
    n++
  }
}
linhas.push(
  `select course, module, lesson, jsonb_array_length(content->'slides') as slides` +
    ` from slide_lessons where course = 'personal-travel-estrutural' order by module, lesson;`,
  'commit;',
)
if (n !== 10) console.error(`aviso: ${n}/10 aulas prontas`)
console.log(linhas.join('\n'))
