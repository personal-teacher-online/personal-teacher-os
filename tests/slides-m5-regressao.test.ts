// O M5A2 (tabela de 4 linhas curtas) precisa continuar cabendo com a medição.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { presente, privado } from './_privado'
import { LessonSchema } from '../src/lib/slides/lesson-schema'
import { BODY_BOTTOM, BOTTOM_PAD, planGrammar } from '../src/lib/slides/layout'
describe.skipIf(!presente)('M5A2 com a medição nova', () => {
  it('tabela de 4 linhas curtas cabe', () => {
    const doc = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a2.json'), 'utf8')))
    const g = doc.slides.find((s) => s.type === 'grammar')
    if (g?.type !== 'grammar' || !g.table) throw new Error('sem tabela')
    const p = planGrammar({ rule: g.rule, tableHeaders: g.table.headers, tableCells: g.table.rows, examples: g.examples, hasWatchOut: Boolean(g.watchOut) })
    const rows = g.table.rows.length + 1
    expect(p.tableY + rows * p.tableRowH).toBeLessThanOrEqual(BODY_BOTTOM - BOTTOM_PAD + 0.001)
    expect(p.tableFont).toBeGreaterThanOrEqual(9.5)
  })
})
