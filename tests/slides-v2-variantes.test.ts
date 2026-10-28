// Template v2 — rotação determinística e clima por PARTE (spec §4.3, §5, §7-ter.1).
//
// FASE 0c: as VARIANTES VISUAIS saíram. Cada tipo passou a ter uma composição
// única (spec §7-ter.1), então nenhum layout consulta `pickVariant` — e é por
// isso que este arquivo prova, além do comportamento da função, que o template
// não a importa mais. `variants.ts` fica no repositório como peça pura e testada
// (a rotação determinística segue disponível para o futuro), não como
// dependência escondida do renderer.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carregarSePresente, presente, privado } from './_privado'
import { pickVariant, typeAxis } from '../src/lib/slides/variants'
import { PARTS, climateFor, fogNames } from '../src/lib/slides/climate'
const { isV2 } = await carregarSePresente(() => import('../src/lib/slides/build'))
import type { SlideSpec } from '../src/lib/slides/lesson-schema'

describe('pickVariant é determinístico e puro', () => {
  it('mesma entrada → mesma variante (idempotência)', () => {
    for (let m = 1; m <= 12; m++) {
      for (let a = 1; a <= 5; a++) {
        const key = { module: m, lesson: a, index: typeAxis('vocab') }
        const first = pickVariant(key, 3)
        for (let k = 0; k < 5; k++) expect(pickVariant(key, 3)).toBe(first)
      }
    }
  })

  it('count === 1 sempre devolve 0', () => {
    for (let m = 1; m <= 12; m++) {
      for (let a = 1; a <= 5; a++) {
        expect(pickVariant({ module: m, lesson: a, index: typeAxis('grammar') }, 1)).toBe(0)
      }
    }
  })

  it('sempre dentro de 0..count-1', () => {
    for (const count of [2, 3, 4]) {
      for (let m = -3; m <= 14; m++) {
        for (let a = -2; a <= 9; a++) {
          const v = pickVariant({ module: m, lesson: a, index: typeAxis('cover') }, count)
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(count)
        }
      }
    }
  })

  it('aulas vizinhas do mesmo módulo NÃO caem todas na mesma variante', () => {
    for (const [type, count] of [['cover', 3], ['vocab', 3], ['section', 2], ['mission', 2]] as const) {
      for (let m = 1; m <= 12; m++) {
        const vistas = new Set(
          [1, 2, 3, 4, 5].map((a) => pickVariant({ module: m, lesson: a, index: typeAxis(type) }, count)),
        )
        // 5 aulas cobrem TODAS as variantes do tipo (2 ou 3)
        expect(vistas.size, `${type} no módulo ${m}`).toBe(count)
      }
    }
  })

  it('tipos diferentes na MESMA aula não ficam presos na mesma letra', () => {
    const porTipo = ['cover', 'vocab', 'warmup', 'tip'].map((t) =>
      pickVariant({ module: 5, lesson: 1, index: typeAxis(t) }, 3),
    )
    expect(new Set(porTipo).size).toBeGreaterThan(1)
  })

  it('o curso inteiro usa as variantes de forma equilibrada', () => {
    const conta = [0, 0, 0]
    for (let m = 1; m <= 12; m++) {
      for (let a = 1; a <= 5; a++) {
        conta[pickVariant({ module: m, lesson: a, index: typeAxis('vocab') }, 3)] += 1
      }
    }
    // 60 aulas / 3 variantes = 20 cada; nenhuma some nem domina
    for (const n of conta) {
      expect(n).toBeGreaterThanOrEqual(15)
      expect(n).toBeLessThanOrEqual(25)
    }
  })

  it('typeAxis é estável e não colide entre os 15 tipos', () => {
    const tipos: SlideSpec['type'][] = [
      'cover',
      'objectives',
      'warmup',
      'vocab',
      'grammar',
      'dialogue',
      'listening',
      'speaking',
      'writing',
      'quiz',
      'tip',
      'section',
      'mission',
      'recap',
      'closing',
    ]
    expect(new Set(tipos.map(typeAxis)).size).toBe(tipos.length)
    expect(typeAxis('vocab')).toBe(typeAxis('vocab'))
  })
})

describe('um layout por tipo (spec §7-ter.1)', () => {
  const template = readFileSync('src/lib/slides/template-v2.ts', 'utf8')

  it('o template NÃO importa a rotação de variantes', () => {
    expect(template).not.toMatch(/from '\.\/variants\.ts'/)
    expect(template).not.toMatch(/\bpickVariant\b/)
  })

  it('nenhum tipo declara mais de uma composição', () => {
    // a tabela de contagem de variantes deixou de existir: o que sobrou é o
    // despacho tipo → função, um para um
    expect(template).not.toMatch(/VARIANT_COUNT/)
    const tipos: SlideSpec['type'][] = [
      'cover',
      'objectives',
      'warmup',
      'vocab',
      'grammar',
      'dialogue',
      'listening',
      'speaking',
      'writing',
      'quiz',
      'tip',
      'section',
      'mission',
      'recap',
      'closing',
    ]
    for (const t of tipos) {
      expect(template, t).toContain(`case '${t}':`)
    }
  })
})

describe.skipIf(!presente)('clima por PARTE (spec §5)', () => {
  it('cobre GET READY + os 12 módulos, e cada um cai na PARTE certa', () => {
    const esperado: Array<[number | 'get-ready', number]> = [
      ['get-ready', 1],
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 3],
      [8, 4],
      [9, 4],
      [10, 5],
      [11, 5],
      [12, 6],
    ]
    for (const [module, part] of esperado) {
      expect(climateFor(module).part, `módulo ${module}`).toBe(part)
    }
  })

  it('cada PARTE tem seu fog, os seis são distintos e existem em disco', () => {
    const nomes = fogNames()
    expect(nomes.length).toBe(6)
    expect(new Set(nomes).size).toBe(6)
    for (const nome of nomes) {
      expect(existsSync(join(privado.brand, 'slides', 'assets', `${nome}.jpg`)), nome).toBe(true)
    }
  })

  it('os fogs do v1 continuam intocados (o v1 usa os três antigos)', () => {
    for (const nome of ['fog-cover', 'fog-section', 'fog-closing']) {
      expect(existsSync(join(privado.brand, 'slides', 'assets', `${nome}.jpg`)), nome).toBe(true)
      expect(fogNames()).not.toContain(nome)
    }
  })

  it('nome da PARTE e direção fotográfica vêm do mapa do curso', () => {
    expect(climateFor(1).partTitle).toBe('THE PILLARS OF FLUENCY')
    expect(climateFor(5).partTitle).toBe('TIME TO TOUR')
    expect(climateFor(12).partTitle).toBe('READY TO GO')
    expect(climateFor(10).photo).toContain('sem drama')
    expect(PARTS.length).toBe(6)
  })

  it('módulo fora do mapa é ERRO, não fallback silencioso', () => {
    expect(() => climateFor(13)).toThrow(RangeError)
    expect(() => climateFor(-1)).toThrow(/sem PARTE mapeada/)
  })
})

describe.skipIf(!presente)('despacho por curso (spec §1)', () => {
  it('só o curso paralelo do v2 entra no template novo', () => {
    expect(isV2('personal-travel-v2')).toBe(true)
    expect(isV2('personal-travel-v2-piloto')).toBe(true)
    expect(isV2('personal-travel')).toBe(false)
    expect(isV2('personal-travel-estrutural')).toBe(false)
    expect(isV2(null)).toBe(false)
    expect(isV2(undefined)).toBe(false)
  })
})
