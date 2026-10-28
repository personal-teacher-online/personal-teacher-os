// FS-M1: o contrato da aula precisa converter para JSON Schema (Structured
// Outputs do rascunho por IA) sem perder o shape básico.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { LessonSchema } from '../src/lib/slides/lesson-schema'

describe('LessonSchema → JSON Schema (Structured Outputs)', () => {
  it('converte e mantém os campos de topo', () => {
    const js = z.toJSONSchema(LessonSchema) as { properties?: Record<string, unknown> }
    expect(js.properties).toBeDefined()
    for (const k of ['course', 'module', 'lesson', 'level', 'grammarFocus', 'slides']) {
      expect(js.properties![k], `campo ${k}`).toBeDefined()
    }
  })
})
