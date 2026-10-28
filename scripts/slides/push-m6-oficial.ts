/**
 * Gera o SQL que aplica as FOTOS no M6 oficial (course='personal-travel').
 * SÓ roda em linha que estiver em 'rascunho' — o portão do banco congela
 * aula aprovada/gerada, e reabrir é ação de admin no painel (Lei 3). Se a
 * aula não tiver sido reaberta, o update simplesmente não pega nela.
 *
 *   npx tsx scripts/slides/push-m6-oficial.ts > out/m6-oficial/push.sql
 */
import fs from 'node:fs'
import path from 'node:path'
import { LessonSchema } from '../../src/lib/slides/lesson-schema.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const linhas: string[] = ['begin;']
for (const aula of [1, 2, 3, 4, 5]) {
  const f = path.join(raiz, `out/m6-oficial/6-${aula}-final.json`)
  if (!fs.existsSync(f)) continue
  const doc = LessonSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8')))
  const json = JSON.stringify(doc)
  if (json.includes('$ptos$')) throw new Error(`6-${aula}: conteudo colide com o delimitador`)
  linhas.push(
    `update slide_lessons set content = $ptos$${json}$ptos$` +
      ` where course = 'personal-travel' and module = 6 and lesson = ${aula}` +
      ` and status = 'rascunho';`,
  )
}
linhas.push(
  `select module, lesson, status,` +
    ` (select count(*) from jsonb_array_elements(content->'slides') s where s ? 'image') as slides_com_foto` +
    ` from slide_lessons where course = 'personal-travel' and module = 6 order by lesson;`,
  'commit;',
)
console.log(linhas.join('\n'))
