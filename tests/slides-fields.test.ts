// FS-M5: editor por seções — o que a professora edita nos campos volta
// EXATAMENTE para o contrato da aula (ida e volta sem perder nada).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { presente, privado } from './_privado'
import { LessonSchema, type SlideSpec } from '../src/lib/slides/lesson-schema'
import { applyFields, describeSlide, slideLabel, slideSummary } from '../src/lib/slides/fields'

/** Simula o FormData que o editor devolve, a partir dos campos descritos. */
function formOf(spec: SlideSpec): { get(n: string): string | null; getAll(n: string): string[] } {
  const single = new Map<string, string>()
  const multi = new Map<string, string[]>()
  const push = (k: string, v: string) => multi.set(k, [...(multi.get(k) ?? []), v])
  for (const f of describeSlide(spec)) {
    if (f.kind === 'text' || f.kind === 'longtext') single.set(f.name, String(f.value ?? ''))
    else if (f.kind === 'list') single.set(f.name, ((f.value as string[]) ?? []).join('\n'))
    else if (f.kind === 'checks') {
      ;((f.value as string[][]) ?? []).forEach((r, i) => {
        push('items__1', r[0])
        if (r[1] === 'x') push('items__check', String(i))
      })
    } else {
      ;((f.value as string[][]) ?? []).forEach((r) => {
        push(`${f.name}__1`, r[0] ?? '')
        push(`${f.name}__2`, r[1] ?? '')
        push(`${f.name}__3`, r[2] ?? '')
      })
    }
  }
  return {
    get: (n) => single.get(n) ?? null,
    getAll: (n) => multi.get(n) ?? [],
  }
}

const AULAS = ['m5a1', 'm5a2', 'm5a3', 'm5a4', 'm5-mission']

describe.skipIf(!presente)('editor por seções', () => {
  it('ida e volta preserva o conteúdo de TODOS os slides das aulas prontas', () => {
    for (const f of AULAS) {
      const doc = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', `${f}.json`), 'utf8')))
      for (const spec of doc.slides) {
        const voltou = applyFields(spec, formOf(spec))
        // o slide continua válido e com o mesmo conteúdo essencial
        const limpo = (x: unknown) => JSON.parse(JSON.stringify(x, Object.keys(spec as object).sort()))
        expect(limpo(voltou), `${f} · ${spec.type}`).toEqual(limpo(spec))
      }
    }
  })

  it('edição de um campo entra no slide (vocab)', () => {
    const doc = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')))
    const vocab = doc.slides.find((s) => s.type === 'vocab')!
    const form = formOf(vocab)
    const comEdicao = {
      get: (n: string) => (n === 'title' ? 'Título novo' : form.get(n)),
      getAll: form.getAll,
    }
    const out = applyFields(vocab, comEdicao)
    if (out.type !== 'vocab') throw new Error('tipo')
    expect(out.title).toBe('Título novo')
    expect(out.cards.length).toBe(vocab.type === 'vocab' ? vocab.cards.length : 0)
  })

  it('marcar/desmarcar gabarito do listening funciona', () => {
    const doc = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')))
    const l = doc.slides.find((s) => s.type === 'listening')!
    const form = formOf(l)
    const semMarcas = { get: form.get, getAll: (n: string) => (n === 'items__check' ? [] : form.getAll(n)) }
    const out = applyFields(l, semMarcas)
    if (out.type !== 'listening') throw new Error('tipo')
    expect(out.items?.every((i) => i.correct === undefined)).toBe(true)
  })

  it('rótulo e resumo existem para todos os tipos', () => {
    for (const f of AULAS) {
      const doc = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', `${f}.json`), 'utf8')))
      for (const s of doc.slides) {
        expect(slideLabel(s), s.type).toBeTruthy()
        expect(typeof slideSummary(s), s.type).toBe('string')
      }
    }
  })
})
