// ARTE DE PRODUTO NO CARTÃO DO HUB (aprovação do dono, 27/07/2026) — o cartão
// do eixo `produto` veste a arte aprovada ao fundo com lavagem de legibilidade;
// os demais eixos e o balde "sem contrato" seguem no cartão neutro.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CartaoDeGrupo } from '@/components/admin/alunos/CartaoDeGrupo'
import type { GrupoDeAlunos } from '@/data/admin/alunos-grupos'

const RAIZ = path.resolve(__dirname, '..')

function grupo(sobras: Partial<GrupoDeAlunos>): GrupoDeAlunos {
  return {
    eixo: 'produto',
    valor: 'particular',
    rotulo: 'Aulas particulares',
    total: 12,
    semAcesso: 2,
    ...sobras,
  } as GrupoDeAlunos
}

describe('arte de produto no CartaoDeGrupo', () => {
  it('as duas artes aprovadas existem em public/brand/produtos', () => {
    for (const rel of [
      'public/brand/produtos/personal-one-card.jpg',
      'public/brand/produtos/personal-travel-card.jpg',
      // as identidades do One também são públicas (hero/quadrado, usos futuros)
      'public/brand/produtos/personal-one-hero.jpg',
      'public/brand/produtos/personal-one-quadrado.jpg',
    ]) {
      expect(existsSync(path.join(RAIZ, rel)), rel).toBe(true)
    }
  })

  it('particular e travel vestem a arte + lavagem, com o texto em branco', () => {
    for (const [valor, arte] of [
      ['particular', '/brand/produtos/personal-one-card.jpg'],
      ['travel', '/brand/produtos/personal-travel-card.jpg'],
    ] as const) {
      const html = renderToStaticMarkup(createElement(CartaoDeGrupo, { grupo: grupo({ valor }) }))
      expect(html, valor).toContain(arte)
      expect(html, valor).toContain('color-mix(in srgb, var(--ink-900)')
      expect(html, valor).toContain('text-white')
      expect(html, valor).not.toContain('text-ink-900')
    }
  })

  it('o balde "sem contrato" e os outros eixos seguem neutros (sem arte)', () => {
    for (const g of [
      grupo({ valor: 'sem-contrato', rotulo: 'Sem contrato' }),
      grupo({ eixo: 'professora', valor: 'x', rotulo: 'Teacher Vicky', professoraIdx: 0 }),
    ]) {
      const html = renderToStaticMarkup(createElement(CartaoDeGrupo, { grupo: g }))
      expect(html).not.toContain('/brand/produtos/')
      expect(html).toContain('text-ink-900')
    }
  })

  it('o texto do card é HTML — a arte publicada do One não tem letreiro (Lei 11)', () => {
    // o card usa a versão SEM letreiro; o gerador reproduzível garante isso
    const publicador = readFileSync(path.join(RAIZ, 'scripts/brand/publicar-produtos.mjs'), 'utf8')
    expect(publicador).toContain('personal-one-card-fundo-922x400.jpg')
    const componente = readFileSync(
      path.join(RAIZ, 'src/components/admin/alunos/CartaoDeGrupo.tsx'),
      'utf8',
    )
    expect(componente).toContain("particular: '/brand/produtos/personal-one-card.jpg'")
    expect(componente).toContain("travel: '/brand/produtos/personal-travel-card.jpg'")
  })
})
