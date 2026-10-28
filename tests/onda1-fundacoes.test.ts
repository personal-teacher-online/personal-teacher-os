// ONDA 1 · M1 + M2 — o que as fundações prometem, provado.
//
// Cobre: contraste AA do TEMA OFICIAL (conferência PROGRAMÁTICA exigida pela
// spec), paridade entre o `:root` do `globals.css` e a fonte única de marca,
// trilho da IA nova, comparação "vs mês anterior" (que some quando não há ponto
// anterior), contrato dos 8 KPIs contra o banco DE VERDADE, a regra de lint de
// fuso e os aceites de grep das telas novas.
//
// D10/D7 MARTELADAS (26/07): não há mais seis temas nem duas variantes — há UM
// tema (duo periwinkle+turquesa) com o comportamento que era a variante B. Os
// testes do alternador morreram com ele; os de contraste continuam, agora
// obrigatórios no caso "texto deep sobre tint" (que a variante B tornou padrão).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Linter } from 'eslint'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import { CLONE, PALETA_OFICIAL, TEMA } from '@/lib/brand/constants'
import { bandaDeNivel } from '@/components/kit/pill'
import { NIVEIS, nivelValido } from '@/data/admin/alunos-grupos'
import { entradasSaidasEmPalavras } from '@/lib/format'
import { AJUSTES, POLEGAR, TRILHO, itemAtivo, tituloDaRota } from '@/components/admin/nav'
import {
  compararComMesAnterior,
  dataDaBase,
  fechamentoValido,
  montarComparacao,
  versoesComparaveis,
} from '@/data/admin/comparar'
import {
  FOLGA_DE_FECHAMENTO_MIN,
  TENTATIVAS_DE_FECHAMENTO_UTC,
  passouDaHoraDoFechamento,
} from '@/data/admin/fechamento'
import { AdminKpisSchema } from '@/data/admin/kpis'
import { ptosPlugin } from '../tools/eslint/no-client-timezone.mjs'

const RAIZ = path.resolve(__dirname, '..')
const CSS = readFileSync(path.join(RAIZ, 'src/app/globals.css'), 'utf8')

/* ========================================================================== */
/* 1. Tema de acento: paridade :root × constantes e contraste AA              */
/* ========================================================================== */

/** globals.css sem comentários — senão um `/* … *​/` no fim da linha engole a
 *  declaração seguinte na hora de fatiar por `;`. */
const CSS_LIMPO = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

function luminancia(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contraste(a: string, b: string): number {
  const x = luminancia(a)
  const y = luminancia(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const PAPER_0 = '#ffffff'
const PAPER_50 = '#f7f7fb'

describe('tema de acento (D10 martelada)', () => {
  /** O bloco de tema do `:root` — o arquivo tem vários `:root`, e este é o que
   *  carrega o acento. Achado pelo CONTEÚDO, nunca pela ordem. */
  function raizDoTema(): Record<string, string> {
    const m = CSS_LIMPO.match(/:root \{([^}]*--ac-deep:[^}]*)\}/)
    if (!m) throw new Error('o :root do tema (com --ac-deep) não existe no globals.css')
    return Object.fromEntries(
      m[1]
        .split(';')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('--'))
        .map((l) => {
          const i = l.indexOf(':')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  }

  it('o :root ESPELHA o tema oficial — ac e ac2, incluindo o deepHover', () => {
    const r = raizDoTema()
    expect(r['--ac-deep']).toBe(TEMA.deep.toLowerCase())
    expect(r['--ac-deep-hover']).toBe(TEMA.deepHover.toLowerCase())
    expect(r['--ac-vivid']).toBe(TEMA.vivid.toLowerCase())
    expect(r['--ac-tint']).toBe(TEMA.tint.toLowerCase())
    expect(r['--ac2-deep']).toBe(TEMA.ac2.deep.toLowerCase())
    expect(r['--ac2-deep-hover']).toBe(TEMA.ac2.deepHover.toLowerCase())
    expect(r['--ac2-vivid']).toBe(TEMA.ac2.vivid.toLowerCase())
    expect(r['--ac2-tint']).toBe(TEMA.ac2.tint.toLowerCase())
  })

  it('o duo é DUO: o 2º acento não repete a base', () => {
    expect(TEMA.ac2.deep).not.toBe(TEMA.deep)
    expect(TEMA.ac2.vivid).not.toBe(TEMA.vivid)
  })

  // A bancada morreu: um `[data-ac]` ou `[data-variant]` sobrevivente seria
  // tema fantasma — CSS que ninguém mais escreve no <html>.
  it('não sobrou bloco de tema alternativo nem de variante', () => {
    // no CSS SEM comentários: o comentário do bloco cita os dois atributos
    // justamente para contar que eles morreram.
    expect(CSS_LIMPO).not.toMatch(/\[data-ac[=\]]/)
    expect(CSS_LIMPO).not.toMatch(/\[data-variant/)
  })

  // Estado BASE e estado HOVER, acento e 2º acento (C7 e C6): o hover é onde a
  // versão anterior furava — `filter: brightness(1.15)` clareava o deep e
  // derrubava o contraste justo com o dedo no botão.
  it('deep e deepHover (ac e ac2) passam AA sobre papel, sobre paper-50 e sobre o próprio tint', () => {
    const superficies: [string, string, string][] = [
      ['ac.deep', TEMA.deep, TEMA.tint],
      ['ac.deepHover', TEMA.deepHover, TEMA.tint],
      ['ac2.deep', TEMA.ac2.deep, TEMA.ac2.tint],
      ['ac2.deepHover', TEMA.ac2.deepHover, TEMA.ac2.tint],
    ]
    for (const [papel, cor, tint] of superficies) {
      expect(contraste(cor, PAPER_0), `${papel} sobre papel`).toBeGreaterThanOrEqual(4.5)
      expect(contraste(cor, PAPER_50), `${papel} sobre paper-50`).toBeGreaterThanOrEqual(4.5)
      // OBRIGATÓRIO desde o martelo de D7: o número-chave é deep sobre lavagem
      // (tint) em todo cartão, e a pill de nível é ac2.deep sobre ac2.tint.
      expect(contraste(cor, tint), `${papel} sobre o próprio tint`).toBeGreaterThanOrEqual(4.5)
      // botão primário e nav ativa: texto branco sobre o deep
      expect(contraste(PAPER_0, cor), `branco sobre ${papel}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('o hover ESCURECE (clarear é o que derrubava o contraste)', () => {
    expect(contraste(TEMA.deepHover, PAPER_0)).toBeGreaterThan(contraste(TEMA.deep, PAPER_0))
    expect(contraste(TEMA.ac2.deepHover, PAPER_0)).toBeGreaterThan(contraste(TEMA.ac2.deep, PAPER_0))
  })

  it('a ação primária usa o token de hover — nenhum `filter` na cor do acento', () => {
    // sem comentários: o que vale é a declaração, e o comentário FALA de
    // `brightness` justamente para contar que ele morreu aqui
    const btn = CSS_LIMPO.match(/\.btn-ac:hover[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(btn).not.toBe('')
    expect(btn).toContain('var(--ac-deep-hover)')
    expect(btn).not.toContain('brightness')
    // e nenhuma regra do bloco de acento volta ao filtro
    expect(CSS_LIMPO).not.toContain('brightness')
  })

  it('o paper-50 usado na conta é o do próprio globals.css', () => {
    expect(CSS).toContain(`--paper-50: ${PAPER_50}`)
    expect(CSS).toContain(`--paper-0: ${PAPER_0}`)
  })

  // C6: sem consumidor, `--ac2-*` era decoração — o duo sairia idêntico à base.
  //
  // M3-c1 · C2: a PILL DE NÍVEL saiu daqui. Ela era o consumidor de `--ac2-*`
  // enquanto o nível tinha uma cor só; agora o nível tem ESCALA (sete degraus,
  // seção própria abaixo) e o turquesa ficou sendo UM dos degraus (a banda B1).
  // Os dois consumidores do 2º acento passam a ser: a TENDÊNCIA dos KPIs
  // (`text-ac2-deep`, em CartaoKpi) e a banda turquesa da escala — que aponta
  // para `--ac2-*` por `var()`, sem hex novo. A invariante é a mesma de antes:
  // o duo tem de ser CONSUMIDO, senão é decoração.
  it('o 2º acento é CONSUMIDO: tendência dos KPIs + banda turquesa da escala', () => {
    // A tendência "vs mês anterior" mudou de casa na clonagem: ela virou parte
    // da anatomia ÚNICA de cartão (`CartaoKpi`), que é quem a desenha para os
    // 8 números. O consumidor mudou de arquivo; a invariante é a mesma.
    const cartao = readFileSync(
      path.join(RAIZ, 'src/components/admin/inicio/CartaoKpi.tsx'),
      'utf8',
    )
    expect(cartao).toContain('text-ac2-deep')

    // a banda B1/B2 da escala de nível é o 2º acento, por referência
    expect(CSS_LIMPO).toContain('--nivel-b1-bg: var(--ac2-tint)')
    expect(CSS_LIMPO).toContain('--nivel-b1-fg: var(--ac2-deep)')
    expect(CSS_LIMPO).toContain('--nivel-b2-fg: var(--ac2-deep-hover)')

    // e o tom `ac2` da Pill morreu junto com o consumidor único que ele tinha
    const pill = readFileSync(path.join(RAIZ, 'src/components/kit/pill.tsx'), 'utf8')
    expect(pill.replace(/\/\/.*$/gm, '')).not.toContain('ac2')

    // e as utilities existem porque o @theme registra os tokens
    for (const token of ['--color-ac2-deep', '--color-ac2-tint', '--color-ac-deep-hover']) {
      expect(CSS).toContain(token)
    }
  })

  // D7 martelada: o que era "variante B" é o comportamento ÚNICO.
  it('o "mais marca" é o padrão: número no deep, lavagem de tint, nav ativa em deep', () => {
    const r = raizDoTema()
    expect(r['--ac-num']).toBe('var(--ac-deep)')
    expect(r['--ac-wash']).toBe('var(--ac-tint)')
    expect(r['--ac-nav-bg']).toBe('var(--ac-deep)')
    expect(r['--ac-nav-fg']).toBe('var(--paper-0)')
  })
})

/* ========================================================================== */
/* 1a. Escala de cor por NÍVEL (M3-c1 · C2)                                    */
/* ========================================================================== */

/** Todas as declarações `--token: valor` do globals, de todos os `:root`.
 *  Usada só para resolver os `var(--x)` da escala de nível — os tokens que ela
 *  consulta são declarados UMA vez cada. */
function tokensDoCss(): Record<string, string> {
  const mapa: Record<string, string> = {}
  for (const m of CSS_LIMPO.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    mapa[m[1]] = m[2].trim()
  }
  return mapa
}

/** Resolve `var(--a)` → `var(--b)` → `#hex`. Falha alto se não chegar a hex —
 *  contraste de valor não-resolvido seria conta em cima de lixo. */
function corResolvida(valor: string, mapa: Record<string, string>, saltos = 6): string {
  let v = valor.trim()
  for (let i = 0; i < saltos; i++) {
    const m = v.match(/^var\((--[a-z0-9-]+)\)$/)
    if (!m) break
    const proximo = mapa[m[1]]
    if (!proximo) throw new Error(`token ${m[1]} não existe no globals.css`)
    v = proximo.trim()
  }
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`"${valor}" não resolveu para hex (parou em "${v}")`)
  return v.toLowerCase()
}

describe('escala de cor por nível (M3-c1 · C2)', () => {
  const BANDAS = ['none', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'] as const

  it('cada banda tem par bg/fg no globals e o par passa AA', () => {
    const mapa = tokensDoCss()
    for (const banda of BANDAS) {
      const bg = corResolvida(mapa[`--nivel-${banda}-bg`], mapa)
      const fg = corResolvida(mapa[`--nivel-${banda}-fg`], mapa)
      expect(contraste(fg, bg), `nível ${banda}: texto sobre o próprio fundo`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a escala SOBE: dentro da família, o degrau de cima é mais fundo', () => {
    const mapa = tokensDoCss()
    const par = (b: string) => ({
      bg: corResolvida(mapa[`--nivel-${b}-bg`], mapa),
      fg: corResolvida(mapa[`--nivel-${b}-fg`], mapa),
    })
    // céu: A2 é um degrau abaixo de A1 — fundo mais saturado E texto mais escuro
    expect(luminancia(par('a2').bg)).toBeLessThan(luminancia(par('a1').bg))
    expect(luminancia(par('a2').fg)).toBeLessThan(luminancia(par('a1').fg))
    // turquesa: idem, B2 abaixo de B1
    expect(luminancia(par('b2').bg)).toBeLessThan(luminancia(par('b1').bg))
    expect(luminancia(par('b2').fg)).toBeLessThan(luminancia(par('b1').fg))
    // …e o "mais evidente" do topo é literal: C2 é o ÚNICO fundo escuro da
    // escala (pill sólido, texto branco). As outras seis são lavagens claras.
    expect(par('c2').fg).toBe('#ffffff')
    expect(luminancia(par('c2').bg)).toBeLessThan(0.25)
    for (const banda of ['none', 'a1', 'a2', 'b1', 'b2', 'c1'] as const) {
      expect(luminancia(par(banda).bg), `${banda} é lavagem clara`).toBeGreaterThan(0.7)
    }
  })

  it('as famílias são famílias: o roxo do C2 é o da marca e o C1 é a voz do sistema', () => {
    const mapa = tokensDoCss()
    // C1 = periwinkle do app, sem hex novo
    expect(mapa['--nivel-c1-bg']).toBe('var(--ac-tint)')
    expect(mapa['--nivel-c1-fg']).toBe('var(--ac-deep)')
    // C2 = o roxo herdado da marca, que segue vivo nas públicas
    expect(corResolvida(mapa['--nivel-c2-bg'], mapa)).toBe('#7e36a3')
    // e o "sem nível" é neutro DE VERDADE (lavagem + tinta secundária)
    expect(mapa['--nivel-none-bg']).toBe('var(--paper-100)')
    expect(mapa['--nivel-none-fg']).toBe('var(--ink-600)')
  })

  it('os ONZE níveis Flexge caem em UMA banda cada, pelo prefixo CEFR', () => {
    const esperado: Record<string, string> = {
      'Pre A1': 'a1',
      A1: 'a1',
      'A1+': 'a1',
      A2: 'a2',
      'A2+': 'a2',
      B1: 'b1',
      'B1+': 'b1',
      B2: 'b2',
      'B2+': 'b2',
      C1: 'c1',
      C2: 'c2',
    }
    // a lista do teste é a lista do vocabulário — nem um nível a mais, nem a menos
    expect(Object.keys(esperado).sort()).toEqual([...NIVEIS].sort())
    for (const n of NIVEIS) {
      expect(nivelValido(n), n).toBe(true)
      expect(bandaDeNivel(n), n).toBe(esperado[n])
    }
    // ausência e lixo caem no neutro, nunca numa cor inventada
    for (const v of [null, undefined, '', 'nenhum', 'D1', 'a1x']) {
      expect(bandaDeNivel(v), String(v)).toBe('none')
    }
    // …e 'a1' minúsculo, que `nivelValido` REJEITA como dado, ainda assim não
    // pinta errado: a banda é a de A1 (a cor tolera; a porta de cadastro não)
    expect(bandaDeNivel('a1')).toBe('a1')
  })

  it('a pill de nível consome os tokens da escala nas QUATRO telas que a desenham', () => {
    const pill = readFileSync(path.join(RAIZ, 'src/components/kit/pill.tsx'), 'utf8')
    for (const banda of BANDAS) {
      expect(pill).toContain(`bg-nivel-${banda}-bg`)
      expect(pill).toContain(`text-nivel-${banda}-fg`)
      expect(CSS).toContain(`--color-nivel-${banda}-bg`)
      expect(CSS).toContain(`--color-nivel-${banda}-fg`)
    }
    for (const rel of [
      'src/components/admin/inicio/AndarHoje.tsx',
      'src/components/admin/alunos/ListaDeAlunos.tsx',
      'src/components/admin/alunos/CartaoDeGrupo.tsx',
      'src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx',
    ]) {
      const codigo = readFileSync(path.join(RAIZ, rel), 'utf8')
      expect(codigo, rel).toContain('tone="nivel"')
      // e a cor VEM do nível: `tone="nivel"` sem `nivel={…}` pintaria tudo de
      // neutro em silêncio, que é a degradação que esta rodada veio matar
      expect(codigo, rel).toMatch(/tone="nivel"\s+nivel=\{/)
    }
  })
})

/* ========================================================================== */
/* 1b-bis. As SEIS cores do ciclo de vida (fase 1, 27/07/2026)                 */
/* ========================================================================== */

describe('cores da situação no ciclo de vida', () => {
  // Os mesmos nomes do vocabulário, na grafia do token (o `_` do código vira
  // `-` no CSS): se alguém acrescentar uma situação e esquecer a cor, o
  // `corResolvida` estoura aqui em vez de a badge sair invisível na tela.
  const CHAVES = ['lead', 'experimental', 'ativo', 'pausado', 'sem-contrato', 'arquivado'] as const

  it('cada situação tem par bg/fg no globals e o par passa AA', () => {
    const mapa = tokensDoCss()
    for (const chave of CHAVES) {
      const bg = corResolvida(mapa[`--situacao-${chave}-bg`], mapa)
      const fg = corResolvida(mapa[`--situacao-${chave}-fg`], mapa)
      expect(
        contraste(fg, bg),
        `situação ${chave}: texto sobre o próprio fundo`,
      ).toBeGreaterThanOrEqual(4.5)
      // toda badge é LAVAGEM clara: a fileira inteira é lida de uma vez, e um
      // bloco sólido no meio dela roubaria a hierarquia da tela
      expect(luminancia(bg), `${chave} é lavagem clara`).toBeGreaterThan(0.7)
    }
  })

  it('as cores são as que a casa JÁ fala — e âmbar continua banido', () => {
    const mapa = tokensDoCss()
    // lead é a voz do sistema (periwinkle), sem hex novo
    expect(mapa['--situacao-lead-bg']).toBe('var(--ac-tint)')
    expect(mapa['--situacao-lead-fg']).toBe('var(--ac-deep)')
    // ativo e pausado são os tokens de ESTADO da casa (verde e CORAL)
    expect(mapa['--situacao-ativo-fg']).toBe('var(--ok-700)')
    expect(mapa['--situacao-pausado-fg']).toBe('var(--warn-700)')
    expect(corResolvida(mapa['--situacao-pausado-fg'], mapa)).toBe('#b8483f')
    // sem contrato = o neutro do "sem nível": ausência não é degrau
    expect(mapa['--situacao-sem-contrato-bg']).toBe('var(--paper-100)')
    expect(mapa['--situacao-sem-contrato-fg']).toBe('var(--ink-600)')
    // experimental é a família CÉU, a mesma de A1 na escala de nível
    expect(corResolvida(mapa['--situacao-experimental-bg'], mapa)).toBe(
      corResolvida(mapa['--nivel-a1-bg'], mapa),
    )
    // arquivado RECUA: fundo mais fundo que o neutro do "sem contrato"
    expect(luminancia(corResolvida(mapa['--situacao-arquivado-bg'], mapa))).toBeLessThan(
      luminancia(corResolvida(mapa['--situacao-sem-contrato-bg'], mapa)),
    )
    for (const chave of CHAVES) {
      const bg = corResolvida(mapa[`--situacao-${chave}-bg`], mapa)
      const fg = corResolvida(mapa[`--situacao-${chave}-fg`], mapa)
      expect([bg, fg].join(' '), chave).not.toMatch(
        /#(b3550e|d97706|f59e0b|fbbf24|92400e|b45309|a16207|ca8a04)/i,
      )
    }
  })

  it('a pill do kit consome os tokens da situação, e as duas telas a desenham', () => {
    const pill = readFileSync(path.join(RAIZ, 'src/components/kit/pill.tsx'), 'utf8')
    for (const chave of CHAVES) {
      expect(pill).toContain(`bg-situacao-${chave}-bg`)
      expect(pill).toContain(`text-situacao-${chave}-fg`)
      expect(CSS).toContain(`--color-situacao-${chave}-bg`)
      expect(CSS).toContain(`--color-situacao-${chave}-fg`)
    }
    for (const rel of [
      'src/components/admin/alunos/ListaDeAlunos.tsx',
      'src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx',
    ]) {
      const arquivo = readFileSync(path.join(RAIZ, rel), 'utf8')
      expect(arquivo, rel).toContain('tone="situacao"')
      // a cor VEM da situação: `tone="situacao"` sem `situacao={…}` cairia no
      // neutro em silêncio (a mesma armadilha do tom `nivel`)
      expect(arquivo, rel).toMatch(/tone="situacao"\s+situacao=\{/)
    }
  })

  it('o filtro do funil é botão de verdade e mantém o vocabulário no ponto de cor', () => {
    // Ordem do dono (27/07, primeira passada em produção): o filtro deixou a
    // Pill + anel de outline e virou os botões da casa. O vocabulário de cor da
    // situação sobrevive num PONTO (`-fg` da mesma dupla de tokens da pílula) —
    // este teste garante que as SEIS chaves seguem consumidas: uma situação fora
    // do mapa quebraria o vocabulário em silêncio.
    const filtro = readFileSync(
      path.join(RAIZ, 'src/components/admin/alunos/FiltroDeSituacao.tsx'),
      'utf8',
    )
    for (const chave of CHAVES) {
      expect(filtro).toContain(`bg-situacao-${chave}-fg`)
    }
    // estado = preenchimento (btn-ac × btn-ac-soft), nunca cor de identidade
    expect(filtro).toContain('btn-ac')
    expect(filtro).toContain('btn-ac-soft')
    // e a Pill saiu de cena: o item é âncora vestida de botão
    expect(filtro).not.toContain('tone="situacao"')
  })
})

/* ========================================================================== */
/* 1c. Família WARN: coral, não âmbar (M3-c1 · C3)                             */
/* ========================================================================== */

describe('warn recolorido (M3-c1 · C3)', () => {
  const WARN = '#b8483f'
  const DANGER = '#b32441'

  /** Saturação HSL — a régua de "menos saturado" do pedido. */
  function saturacao(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const l = (mx + mn) / 2
    return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1))
  }

  it('o token do globals é o coral, e o glow acompanha', () => {
    expect(CSS).toContain(`--warn-700: ${WARN}`)
    // rgb(184 72 63) = #B8483F
    expect(CSS_LIMPO).toContain('rgb(184 72 63 / 0.4)')
    expect(CSS_LIMPO).toContain('rgb(184 72 63 / 0.25)')
  })

  it('passa AA nos TRÊS papéis que ele veste: texto, lavagem e bloco sólido', () => {
    // texto sobre cartão branco e sobre o fundo de página
    expect(contraste(WARN, PAPER_0)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(WARN, PAPER_50)).toBeGreaterThanOrEqual(4.5)
    // texto sobre a própria lavagem. Desde o Q1 do c7b ela é HEX SÓLIDO
    // (`--warn-wash`): com o alpha de antes o par valia 4,54:1 sobre papel
    // branco mas 3,98:1 sobre --paper-100, e este teste, que compunha o alpha
    // sobre BRANCO, media o único caso que passava. A bateria completa (as três
    // superfícies + a wash) está em tests/m3-c7b-sobras.test.ts.
    const wash = CSS.match(/--warn-wash:\s*(#[0-9a-f]{6})/i)?.[1] ?? ''
    expect(wash, '--warn-wash existe no globals').toMatch(/^#[0-9a-f]{6}$/i)
    expect(contraste(WARN, wash)).toBeGreaterThanOrEqual(4.5)
    // bloco sólido com texto branco (o badge "?" da agenda)
    expect(contraste(PAPER_0, WARN)).toBeGreaterThanOrEqual(4.5)
  })

  it('warn e danger continuam DISTINGUÍVEIS: o erro é mais escuro e mais saturado', () => {
    expect(CSS).toContain(`--danger-700: ${DANGER}`)
    expect(luminancia(DANGER)).toBeLessThan(luminancia(WARN))
    expect(saturacao(DANGER)).toBeGreaterThan(saturacao(WARN))
    // e a diferença é VISÍVEL, não decimal: ≥30% de luminância entre os dois
    expect(luminancia(WARN) / luminancia(DANGER)).toBeGreaterThan(1.3)
  })

  it('VARREDURA: nenhum hex da família âmbar sobrou no globals (fora de comentário)', () => {
    const AMBAR = /#(b3550e|d97706|f59e0b|fbbf24|fde68a|fef3c7|92400e|b45309|a16207|ca8a04|ea580c|c2410c|9a3412|78350f|f97316|fdba74|fed7aa|ffedd5)\b/i
    expect(CSS_LIMPO).not.toMatch(AMBAR)
    // o âmbar também morava no glow, em rgb() — e lá não havia hex para grepar
    expect(CSS_LIMPO).not.toContain('rgb(179 85 14')
    // …e o hex antigo só pode aparecer em COMENTÁRIO (o registro histórico)
    expect(CSS).toMatch(/#B3550E/)
  })

  it('a contagem "sem acesso ao portal" é informação, não alarme', () => {
    // A intenção original (M3-c1 · C3a) segue inteira: a linha é FATO em tinta
    // secundária com o número forte — nunca cor de aviso. Desde a arte de
    // produto (27/07), as classes viraram CONDICIONAIS: cartão neutro fala em
    // tinta (ink-900/ink-600), cartão com arte fala em branco sobre a lavagem.
    // O aceite confere as duas vozes e a proibição de alarme continua.
    //
    // c18 (portão visual do dono): as duas vozes deixaram de ser um ternário
    // repetido em cada linha e viraram UMA função (`tinta(forte)`), porque o
    // cartão passou a servir também a aba Contratos. É a mesma régua, num lugar
    // só — e é ela que este aceite lê agora.
    const cartao = readFileSync(
      path.join(RAIZ, 'src/components/admin/alunos/CartaoDeGrupo.tsx'),
      'utf8',
    ).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(cartao).not.toContain('text-warn-700')
    expect(cartao).toContain('text-ink-600')
    expect(cartao).toContain('text-ink-900')
    expect(cartao).toMatch(
      /arte \? \(forte \? 'text-white' : 'text-white\/85'\) : forte \? 'text-ink-900' : 'text-ink-600'/,
    )
    // o número é a voz FORTE; a pendência, a secundária
    expect(cartao).toMatch(/text-3xl font-semibold tabular-nums \$\{tinta\(true\)\}/)
    expect(cartao).toMatch(/relative text-sm \$\{tinta\(false\)\}/)
  })
})

/* ========================================================================== */
/* 1b. Clonagem TutorBird: trilho, banda e fonte                               */
/* ========================================================================== */

describe('clonagem TutorBird (26/07)', () => {
  /** O `:root` que carrega os tokens da clonagem (achado pelo CONTEÚDO). */
  function raizDoClone(): Record<string, string> {
    const m = CSS_LIMPO.match(/:root \{([^}]*--rail-bg:[^}]*)\}/)
    if (!m) throw new Error('o :root da clonagem (com --rail-bg) não existe no globals.css')
    return Object.fromEntries(
      m[1]
        .split(';')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('--'))
        .map((l) => {
          const i = l.indexOf(':')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  }

  it('o :root ESPELHA os hexes da clonagem (trilho e banda)', () => {
    const r = raizDoClone()
    expect(r['--rail-bg']).toBe(CLONE.railBg.toLowerCase())
    expect(r['--rail-hover']).toBe(CLONE.railHover.toLowerCase())
    expect(r['--ac-band']).toBe(CLONE.band.toLowerCase())
  })

  // O TutorBird escreve branco sobre teal #25A3AF (~3:1) e REPROVA em AA. A
  // clonagem copia a anatomia e conserta o contraste: os TRÊS estados do trilho
  // levam texto/ícone branco, e os três têm de passar.
  it('os três estados do trilho passam AA com texto branco', () => {
    for (const [papel, cor] of [
      ['fundo', CLONE.railBg],
      ['hover', CLONE.railHover],
      ['ativo', CLONE.railActive],
    ] as const) {
      expect(contraste(PAPER_0, cor), `branco sobre o ${papel} do trilho`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a relação entre os estados é a medida no TutorBird: ativo mais ESCURO, hover mais CLARO', () => {
    const l = (hex: string) => luminancia(hex)
    expect(l(CLONE.railActive)).toBeLessThan(l(CLONE.railBg))
    expect(l(CLONE.railHover)).toBeGreaterThan(l(CLONE.railBg))
    // "≈20% mais escuro" deles, em luminância: o nosso ativo tira ~27%
    expect(l(CLONE.railActive) / l(CLONE.railBg)).toBeLessThan(0.85)
  })

  it('o ativo do trilho é o próprio deep do tema — uma cor só manda em "selecionado"', () => {
    expect(CLONE.railActive).toBe(TEMA.deep)
  })

  // A banda é fundo de TEXTO (saudação, data, nota do corte) e de cartões
  // brancos: os três papéis de texto que caem sobre ela têm de passar AA.
  it('a banda de topo aguenta texto: ink-900, ink-600 e ac-deep passam AA sobre ela', () => {
    const INK_900 = '#17141f'
    const INK_600 = '#4c4859'
    expect(CSS).toContain(`--ink-900: ${INK_900}`)
    expect(CSS).toContain(`--ink-600: ${INK_600}`)
    for (const [papel, cor] of [
      ['ink-900', INK_900],
      ['ink-600', INK_600],
      ['ac-deep', TEMA.deep],
    ] as const) {
      expect(contraste(cor, CLONE.band), `${papel} sobre a banda`).toBeGreaterThanOrEqual(4.5)
    }
    // e a banda é MAIS marcada que o tint (senão ela some ao lado dos cartões
    // brancos — foi por isso que ela ganhou tom próprio)
    expect(luminancia(CLONE.band)).toBeLessThan(luminancia(TEMA.tint))
  })

  /*
   * A FAIXA VAI DE LATERAL A LATERAL (portão visual do dono, 27/07/2026 — ordem
   * direta, com o print do TutorBird do lado).
   *
   * A banda parava no teto de 1720px da superfície de trabalho: numa tela larga
   * sobrava papel dos dois lados e ela virava uma ilha. O mecanismo novo tem
   * DUAS metades, e as duas precisam existir — a lavagem transborda 100vw para
   * cada lado (`.faixa-cheia::before`) e a coluna de conteúdo do shell APARA o
   * que sobrou (`overflow-x-clip`). Sem a tesoura, a faixa vira rolagem
   * horizontal; sem o transbordo, ela volta a parar na coluna.
   */
  it('a faixa do Início transborda e é aparada na borda da área de conteúdo', () => {
    // 1. a lavagem: um pseudo-elemento que vaza 100vw para cada lado, atrás do
    //    conteúdo, pintado com o token da banda
    expect(CSS_LIMPO).toMatch(/\.faixa-cheia::before\s*\{[^}]*inset-inline:\s*-100vw/)
    expect(CSS_LIMPO).toMatch(/\.faixa-cheia::before\s*\{[^}]*z-index:\s*-1/)
    expect(CSS_LIMPO).toMatch(/\.faixa-cheia::before\s*\{[^}]*background:\s*var\(--ac-band\)/)

    // 2. a tesoura: `clip` (nunca `hidden`, que criaria caixa de rolagem e
    //    quebraria a barra `sticky` e os overlays `fixed` das telas legadas)
    const shell = corpo('src/components/admin/AdminShell.tsx')
    expect(shell).toContain('flex min-w-0 flex-1 flex-col overflow-x-clip pb-24 md:pb-0')
    expect(shell).not.toContain('overflow-x-hidden')

    // 3. a tela: a seção veste a faixa e não pinta mais o fundo dela própria
    //    (o fundo é o pseudo-elemento; dois fundos seriam duas verdades)
    const inicio = corpo('src/app/admin/page.tsx')
    expect(inicio).toContain('<section className="faixa-cheia px-4 py-6 md:px-6 md:py-8">')
    // (sem comentários: eles CITAM a classe morta justamente para contar que
    // ela morreu — o que vale é o código)
    expect(
      inicio.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, ''),
    ).not.toContain('bg-ac-band')
    // e o conteúdo continua respeitando a coluna: as margens negativas que
    // cancelam o respiro do shell seguem as mesmas
    expect(inicio).toContain('-mx-4 -mt-6 flex flex-col md:-mx-6 md:-mt-8')
  })

  // Verde É a exceção do dinheiro realizado: se não passar AA, não pode ser cor
  // de número. (danger idem, no cartão de atraso.)
  it('o verde do dinheiro e o vermelho do atraso passam AA sobre o cartão branco', () => {
    // O verde desceu um degrau no F1 do lote c7: a pílula de estado o punha
    // sobre a própria lavagem e o par reprovava AA (4,43:1). O par novo, e as
    // outras superfícies, estão medidos em tests/m3-c7-revisao-8.test.ts.
    const OK = '#16702f'
    const DANGER = '#b32441'
    expect(CSS).toContain(`--ok-700: ${OK}`)
    expect(CSS).toContain(`--danger-700: ${DANGER}`)
    expect(contraste(OK, PAPER_0)).toBeGreaterThanOrEqual(4.5)
    expect(contraste(DANGER, PAPER_0)).toBeGreaterThanOrEqual(4.5)
  })

  it('a fonte do CONTEÚDO é a Inter, self-hospedada pelo next/font, e é ela que o CSS monta', () => {
    const layout = readFileSync(path.join(RAIZ, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain("from \"next/font/google\"")
    expect(layout).toMatch(/\bInter\(\{/)
    expect(layout).toContain('--font-inter')
    // o par anterior saiu do site (a Bricolage segue nos decks .pptx, que não
    // passam por aqui)
    expect(layout).not.toContain('Bricolage_Grotesque')
    expect(layout).not.toContain('Hanken_Grotesk')
    // e as duas pontas falam da mesma fonte, com o fallback medido no TutorBird
    expect(CSS).toContain('--font-pt-stack: var(--font-inter)')
    expect(CSS).toContain('--font-pt-body: var(--font-pt-stack)')
    expect(CSS).toContain('--font-pt-display: var(--font-pt-stack)')
  })

  /* ---- LOTE 10: a calibragem tipográfica (26/07) -------------------------- */

  // A medição dos computed styles da sessão logada achou um MIX: os
  // componentes MATERIAL do TutorBird (sidebar, nav, menus) são Roboto; o
  // conteúdo é Inter. Vestir tudo de Inter era a queixa do dono ("a fonte
  // ainda não me parece a mesma").
  it('a NAVEGAÇÃO tem família própria: Roboto, self-hospedada pelo mesmo caminho', () => {
    const layout = readFileSync(path.join(RAIZ, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/import \{[^}]*\bRoboto\b[^}]*\} from "next\/font\/google"/)
    expect(layout).toMatch(/\bRoboto\(\{/)
    expect(layout).toContain('--font-roboto')
    // os três pesos do uso estreito (400 item, 500 rótulo, 700 ênfase)
    expect(layout).toMatch(/weight: \["400", "500", "700"\]/)
    // e a variável chega ao <html> junto com as outras
    expect(layout).toMatch(/\$\{roboto\.variable\}/)

    // pilha no :root + registro no @theme (é o registro que cria `font-nav`)
    expect(CSS).toContain('--font-pt-nav: var(--font-roboto)')
    expect(CSS).toContain('--font-nav: var(--font-pt-nav)')

    // a Roboto NÃO virou a fonte do site: corpo e título seguem Inter. (Ela
    // aparece como NOME em `--font-pt-stack` desde antes desta rodada — é o
    // fallback de sistema medido no TutorBird; o que não pode é a pilha do
    // corpo consumir a FONTE self-hospedada.)
    expect(CSS_LIMPO).not.toMatch(/--font-pt-(body|display|stack):[^;]*var\(--font-roboto\)/i)
  })

  it('a voz da navegação carrega os números medidos (Roboto 16/400, +0.031em, lh 24)', () => {
    const nav = CSS_LIMPO.match(/\.nav-tb \{([^}]*)\}/)?.[1] ?? ''
    expect(nav).toContain('font-family: var(--font-pt-nav)')
    expect(nav).toContain('font-size: 16px')
    expect(nav).toContain('font-weight: 400')
    // 0.031em × 16px = os 0.496px medidos
    expect(nav).toContain('letter-spacing: 0.031em')
    expect(nav).toContain('line-height: 24px')

    // o wordmark é o ÚNICO desvio de peso, e ele existe como classe própria
    // (peso em utility do Tailwind seria engolido: estas regras são unlayered)
    expect(CSS_LIMPO.match(/\.nav-tb-strong \{([^}]*)\}/)?.[1] ?? '').toContain('font-weight: 600')

    // item de MENU: mesma família, 14px (a régua Material deles)
    const item = CSS_LIMPO.match(/\.nav-tb-item \{([^}]*)\}/)?.[1] ?? ''
    expect(item).toContain('font-family: var(--font-pt-nav)')
    expect(item).toContain('font-size: 14px')
    expect(item).toContain('font-weight: 400')
  })

  // O tracking dos títulos é FIXO em px porque o valor medido é o MESMO nos
  // dois tamanhos (24 e 20) — em `em` ele viraria duas réguas diferentes.
  it('a régua de título é 600 + tracking −0.8px, nos dois degraus', () => {
    expect(CSS_LIMPO).toContain('--tracking-title: -0.8px')
    const pagina = CSS_LIMPO.match(/\.title-page \{([^}]*)\}/)?.[1] ?? ''
    expect(pagina).toContain('font-size: 24px')
    expect(pagina).toContain('font-weight: 600')
    expect(pagina).toContain('letter-spacing: var(--tracking-title)')
    expect(pagina).toContain('line-height: 32px')
    const secao = CSS_LIMPO.match(/\.title-section \{([^}]*)\}/)?.[1] ?? ''
    expect(secao).toContain('font-size: 20px')
    expect(secao).toContain('font-weight: 600')
    expect(secao).toContain('letter-spacing: var(--tracking-title)')
    expect(secao).toContain('line-height: 26px')
  })

  // Botão medido: 14px/600 — nunca 700. É o que faz a ação deles ler como
  // ação, e não como grito.
  it('os três botões da tela nova são 14/600 (o medido), não 700', () => {
    for (const cls of ['btn-ac', 'btn-ac-soft', 'btn-ac-ghost']) {
      const b = CSS_LIMPO.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`))?.[1] ?? ''
      expect(b, cls).toContain('font-weight: 600')
      expect(b, cls).toContain('font-size: 0.875rem')
      expect(b, cls).not.toContain('font-weight: 700')
    }
  })

  // Dois papéis de cartão, medidos separadamente: elevação para número, anel
  // para moldura de trabalho. Um cartão com os DOIS é o tell nomeado.
  it('KPI eleva (sombra, sem borda) e contêiner é flat (anel, sem sombra)', () => {
    const kpi = CSS_LIMPO.match(/\.card-kpi \{([^}]*)\}/)?.[1] ?? ''
    expect(kpi).toContain('var(--shadow-kpi)')
    expect(kpi).not.toContain('border:')
    const painel = CSS_LIMPO.match(/\.panel-tb \{([^}]*)\}/)?.[1] ?? ''
    expect(painel).toContain('0 0 0 1px var(--line)')
    expect(painel).not.toContain('--shadow')
  })

  it('o botão primário tem a geometria medida (h36, radius pequeno, 150 ms, sem sombra em repouso)', () => {
    const btn = CSS_LIMPO.match(/\.btn-ac \{([^}]*)\}/)?.[1] ?? ''
    expect(btn).toContain('min-height: 36px')
    expect(btn).toContain('padding: 6px 12px')
    expect(btn).toContain('border-radius: var(--radius-btn)')
    expect(btn).toContain('font-weight: 600')
    expect(btn).toContain('var(--duration-hover) var(--ease-in-out)')
    expect(btn).not.toContain('box-shadow:')
    // M3-c3 · A2 — 4px é o valor MEDIDO no TutorBird. Era 6px, com um desvio
    // consciente anotado no globals; o dono pediu duas vezes "caixas mais
    // quadradas, igual o TutorBird" e o desvio caiu. Campo e botão passam a
    // ter o mesmo canto: os dois tokens dizem 4px.
    expect(CSS_LIMPO).toContain('--radius-btn: 4px')
    expect(CSS_LIMPO).toContain('--radius-input: 4px')
    // e o que NÃO é controle continua com raio próprio (nada de canto único
    // no site inteiro)
    expect(CSS_LIMPO).toContain('--radius-card: 14px')
    expect(CSS_LIMPO).toContain('--radius-kpi: 12px')
    expect(CSS_LIMPO).toContain('--radius-panel: 8px')
    expect(CSS_LIMPO).toContain('--radius-pill: 999px')
    // e o degrau maior do painel existe
    const lg = CSS_LIMPO.match(/\.btn-ac-lg \{([^}]*)\}/)?.[1] ?? ''
    expect(lg).toContain('min-height: 40px')
    expect(lg).toContain('padding: 8px 16px')
  })

  it('as ilustrações do unDraw estão no repo, recoloridas no periwinkle', () => {
    for (const arquivo of ['aula-online.svg', 'agenda-vazia.svg', 'tudo-em-dia.svg']) {
      const svg = readFileSync(path.join(RAIZ, 'public/illustrations', arquivo), 'utf8')
      expect(svg, arquivo).toContain('#8488d9')
      // o acento padrão do unDraw não pode ter sobrado em lugar nenhum
      expect(svg.toLowerCase(), arquivo).not.toContain('#6c63ff')
    }
    // e a procedência/licença fica registrada
    const leiame = readFileSync(path.join(RAIZ, 'public/illustrations/README.md'), 'utf8')
    expect(leiame).toContain('unDraw')
    expect(leiame).toContain('licen')
  })

  it('entradas e saídas se leem em voz alta (zero é "nenhum", não "0")', () => {
    expect(entradasSaidasEmPalavras(1, 0)).toBe('1 novo · nenhum encerrado')
    expect(entradasSaidasEmPalavras(0, 0)).toBe('nenhum novo · nenhum encerrado')
    expect(entradasSaidasEmPalavras(3, 2)).toBe('3 novos · 2 encerrados')
  })
})

/* ========================================================================== */
/* 1c. Ponte de cor: o roxo herdado das telas VELHAS (Lote 6 · G2)             */
/* ========================================================================== */

describe('ponte de cor (G2, 26/07)', () => {
  /** O `:root` das fundações de papel — achado pelo CONTEÚDO, nunca pela ordem. */
  function raizDoPapel(): Record<string, string> {
    const m = CSS_LIMPO.match(/:root \{([^}]*--brand-700:[^}]*)\}/)
    if (!m) throw new Error('o :root com --brand-700 não existe no globals.css')
    return Object.fromEntries(
      m[1]
        .split(';')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('--'))
        .map((l) => {
          const i = l.indexOf(':')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  }

  // As telas velhas só falam `--brand-*`. Trocar o VALOR (e não o JSX) é o que
  // faz todas vestirem a família nova de uma vez.
  it('os tokens legados apontam para a família periwinkle do tema', () => {
    const r = raizDoPapel()
    expect(r['--brand-700']).toBe(TEMA.deep.toLowerCase()) // texto/link/ação
    expect(r['--brand-600']).toBe(CLONE.railBg.toLowerCase()) // realce/hover/anel
  })

  it('o par mantém a relação de antes: o 600 é o degrau mais CLARO', () => {
    expect(luminancia(CLONE.railBg)).toBeGreaterThan(luminancia(TEMA.deep))
  })

  // Os pares REALMENTE usados hoje pelas telas velhas: branco sobre o 700
  // (`.btn-brand`, `chipBrandOn`, hover do `.btn-ink`), texto 700 sobre papel
  // (`linkAction`), branco sobre o 600 (hover do `.btn-brand`) e o 600 como
  // anel de foco/borda sobre papel.
  it('todo par usado passa AA depois da troca', () => {
    for (const [papel, a, b] of [
      ['branco sobre brand-700', PAPER_0, TEMA.deep],
      ['brand-700 sobre paper-0', TEMA.deep, PAPER_0],
      ['brand-700 sobre paper-50', TEMA.deep, PAPER_50],
      ['branco sobre brand-600', PAPER_0, CLONE.railBg],
      ['brand-600 sobre paper-0', CLONE.railBg, PAPER_0],
    ] as const) {
      expect(contraste(a, b), papel).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Aceite de grep: nenhum roxo de PAPEL sobrou — nem em hex, nem na forma
  // rgb() das sombras e do glow (é onde ele estava escondido).
  //
  // ⚠️ UMA exceção, aberta em M3-c1 · C2 e PENDENTE DE RATIFICAÇÃO: o topo da
  // escala de nível (C2) é o roxo herdado, sólido. A ponte de cor matou o roxo
  // como VOZ do app (link, ação, foco, stepper) porque ele destoava do shell
  // periwinkle; a escala o usa como DADO — a etiqueta de um aluno, que aparece
  // em ~0 a 1 linha da tela. O teste não afrouxa: ele fixa que a ÚNICA
  // ocorrência permitida é a declaração `--nivel-c2-bg`, e nada mais.
  it('o roxo herdado não veste mais superfície de papel', () => {
    for (const roxo of [
      '#9333c9', // era o --brand-600
      'rgb(126 54 163', // anel do --glow-brand
      'rgb(124 58 168', // tinta de --shadow-card / --shadow-pop
    ]) {
      expect(CSS_LIMPO, roxo).not.toContain(roxo)
    }
    // o antigo --brand-700: uma ocorrência, e ela tem endereço
    const ocorrencias = CSS_LIMPO.split('#7e36a3').length - 1
    expect(ocorrencias, 'o roxo herdado aparece uma vez só').toBe(1)
    expect(CSS_LIMPO).toContain('--nivel-c2-bg: #7e36a3')
  })

  // A FRONTEIRA da ponte, escrita: o roxo continua sendo fato da marca na capa
  // noturna (e nos e-mails, que ficam fora do CSS). Só morreu no papel.
  it('a paleta oficial não muda: o roxo segue vivo na capa noturna', () => {
    expect(PALETA_OFICIAL.roxo).toBe('#B35BD9')
    expect(CSS_LIMPO).toContain(`--accent-purple: ${PALETA_OFICIAL.roxo.toLowerCase()}`)
  })
})

/* ========================================================================== */
/* 2. Trilho da IA nova                                                        */
/* ========================================================================== */

describe('trilho do admin', () => {
  // M3-c5 · D3: eram 10; o Ajustes desceu para o menu da CONTA (emenda de
  // posição da Q2 pedida pelo dono, espelhando o TutorBird).
  it('tem os 9 itens da IA de 26/07, na ordem', () => {
    expect(TRILHO.map((i) => i.label)).toEqual([
      'Início',
      'Agenda',
      'Alunos',
      'Financeiro',
      'Mentoria',
      'Mensagens',
      'Estúdio',
      'Professoras',
      'Relatórios',
    ])
  })

  // Atualizado no M3-1: o hub de Alunos passou a ser tela nova (a ficha, não —
  // ela é o M3-2). O resto do trilho continua apontando para a rota velha.
  it('Início e Alunos são telas novas; o resto aponta para a rota velha', () => {
    const por = (label: string) => TRILHO.find((i) => i.label === label)!
    expect(por('Início')).toMatchObject({ href: '/admin', nova: true })
    expect(por('Alunos')).toMatchObject({ href: '/admin/alunos', nova: true })
    expect(por('Agenda').nova).toBeUndefined()
    expect(por('Financeiro').href).toBe('/admin/pagamentos')
    expect(por('Mensagens').href).toBe('/admin/avisos')
    expect(por('Estúdio').href).toBe('/admin/conteudo')
    // nenhum item aponta para tela que não existe
    expect(TRILHO.every((i) => i.href.startsWith('/admin'))).toBe(true)
  })

  /* ---------------------------------------------------- M3-c5 · D3: Ajustes */

  it('Ajustes saiu do trilho, mas NÃO do site: agora com tela própria, no menu da conta', () => {
    expect(TRILHO.some((i) => i.label === 'Ajustes')).toBe(false)
    // A seção continua existindo (Q2) e continua morando no menu da conta. O
    // que mudou na onda da Agenda (A8) foi o DESTINO: até aqui ele segurava a
    // página velha de janelas como place-holder; agora aponta para a tela que
    // nasceu (`/admin/ajustes`), e `/admin/janelas` virou redirect para ela.
    expect(AJUSTES).toMatchObject({ href: '/admin/ajustes', label: 'Ajustes' })
    // e a barra superior continua dizendo o nome certo quando se está lá
    expect(tituloDaRota('/admin/ajustes')).toBe('Ajustes')
  })

  it('o menu da conta (desktop) e o "Mais" (celular) hospedam o Ajustes', () => {
    const nav = readFileSync(path.join(RAIZ, 'src/components/admin/AdminNavClient.tsx'), 'utf8')
    const daConta = nav.slice(nav.indexOf('export function AdminTopBar'), nav.indexOf('export function AdminMobileBar'))
    const doPolegar = nav.slice(nav.indexOf('export function AdminThumbBar'))
    // O celular NÃO tem menu de conta: sem esta segunda casa, a emenda de
    // posição apagaria o acesso móvel a Ajustes.
    expect(daConta).toContain('{AJUSTES.label}')
    expect(doPolegar).toContain('{AJUSTES.label}')
    // e o Ajustes NÃO volta a ser desenhado pela varredura do trilho
    expect(nav.match(/TRILHO\.map/g) ?? []).toHaveLength(1)
  })

  it('Contratos deixa de ser 1º nível e acende dentro de Alunos', () => {
    expect(TRILHO.some((i) => i.href === '/admin/contratos')).toBe(false)
    const alunos = TRILHO.find((i) => i.label === 'Alunos')!
    expect(itemAtivo('/admin/contratos', alunos)).toBe(true)
    expect(itemAtivo('/admin/alunos/abc', alunos)).toBe(true)
  })

  it('Início só acende na igualdade exata', () => {
    const inicio = TRILHO[0]
    expect(itemAtivo('/admin', inicio)).toBe(true)
    expect(itemAtivo('/admin/agenda', inicio)).toBe(false)
  })

  it('a barra de polegar leva 3 itens + Mais', () => {
    expect(POLEGAR).toEqual(['/admin', '/admin/agenda', '/admin/alunos'])
    // 6 do trilho (era 7 — o Ajustes saiu) + Ajustes + painel da professora +
    // Sair, que já moravam no "Mais" por não serem seção do trilho.
    expect(TRILHO.filter((i) => !POLEGAR.includes(i.href))).toHaveLength(6)
  })
})

/* ========================================================================== */
/* 3. Comparação "vs mês anterior"                                             */
/* ========================================================================== */

describe('comparação vs mês anterior', () => {
  it('não existe sem base — nunca "—%"', () => {
    expect(compararComMesAnterior(1000, 0)).toBeUndefined()
    expect(compararComMesAnterior(1000, -1)).toBeUndefined()
    expect(compararComMesAnterior(Number.NaN, 10)).toBeUndefined()
  })

  it('diz o sentido e a magnitude absoluta', () => {
    expect(compararComMesAnterior(11000, 10000)).toEqual({ pct: 10, sentido: 'sobe' })
    expect(compararComMesAnterior(9000, 10000)).toEqual({ pct: 10, sentido: 'desce' })
    expect(compararComMesAnterior(10000, 10000)).toEqual({ pct: 0, sentido: 'igual' })
  })

  // S3 (revisão adversarial nº 3): a versão AO VIVO entra na conta. Dois
  // fechamentos v1 são iguais ENTRE SI, mas o cartão ao lado do delta já é v2.
  it('exige a MESMA versão nos três pontos — inclusive no número ao vivo', () => {
    expect(versoesComparaveis(2, 2, 2)).toBe(true)
    expect(versoesComparaveis(2, 1, 1)).toBe(false) // o defeito do S3
    expect(versoesComparaveis(2, 2, 1)).toBe(false)
    expect(versoesComparaveis(1, 2, 2)).toBe(false)
  })

  // O mesmo, com os DOIS fechamentos vindos do banco (jsonb de verdade, lido
  // pelo mesmo schema que a camada de dados usa).
  it('fechamentos v1 no banco × KPI vivo v2 → comparação omitida', async () => {
    const sql = connect(1)
    try {
      const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin S3'), 'admin')
      const vivo = AdminKpisSchema.parse((await admin.rpc('admin_kpis')).data)

      // Datas fora do caminho de qualquer outro teste (kpi_snapshots é
      // append-only: nada aqui pode ser apagado depois).
      const anchor = DateTime.fromISO(vivo.business_date).plus({
        days: 500 + Math.floor(Math.random() * 400),
      })
      const base = anchor.minus({ months: 1 })
      const velho = { ...vivo, definitions_version: 1 }
      for (const dia of [anchor, base]) {
        await sql`
          insert into kpi_snapshots (captured_on, definitions_version, data)
          values (${dia.toISODate()!}, 1, ${sql.json({ ...velho, business_date: dia.toISODate()! })})`
      }

      const { data, error } = await admin
        .from('kpi_snapshots')
        .select('captured_on, data')
        .in('captured_on', [anchor.toISODate()!, base.toISODate()!])
      expect(error).toBeNull()
      const lidos = (data ?? []).map((s) => AdminKpisSchema.parse(s.data))
      expect(lidos).toHaveLength(2)
      expect(lidos.every((k) => k.definitions_version === 1)).toBe(true)

      // fórmula viva é v3 (F2: previsto por contrato) → não há comparação com v1.
      expect(vivo.definitions_version).toBe(3)
      expect(versoesComparaveis(vivo.definitions_version, lidos[0].definitions_version, lidos[1].definitions_version)).toBe(false)
      expect(versoesComparaveis(1, lidos[0].definitions_version, lidos[1].definitions_version)).toBe(true)
    } finally {
      await sql.end()
    }
  })

  // F3 (revisão adversarial nº 4): a MONTAGEM da comparação é função pura, e o
  // que a prova é COMPORTAMENTO. Antes daqui o único gate era um grep por
  // 'versoesComparaveis(' no fonte de home.ts — comentar o condicional deixava
  // a suíte verde com o delta de outra fórmula na tela.
  describe('montarComparacao', () => {
    // KPI mínimo válido pelo schema real (é o mesmo que a home usa).
    const kpi = (over: Record<string, unknown> = {}) =>
      AdminKpisSchema.parse({
        definitions_version: 2,
        generated_at: '2026-07-26T07:04:00.000Z',
        business_date: '2026-07-26',
        month: '2026-07',
        week_start: '2026-07-20',
        recebido_no_mes_cents: 100000,
        previsto_no_mes_cents: 200000,
        previsto_mentoria_cents: 0,
        em_atraso_cents: 5000,
        familias_em_atraso: 1,
        alunos_ativos: { total: 20, particulares: 14, travel: 6 },
        aulas_da_semana: { restantes: 6, total: 10 },
        entradas_saidas_do_mes: { novos: 1, encerrados: 0 },
        ocupacao_por_professora: [
          { teacher_id: 't1', teacher: 'Dona', horas_janela: 10, horas_ocupadas: 7, ocupacao_pct: 70 },
        ],
        alunos_por_nivel: [{ nivel: 'B1', alunos: 3 }],
        ...over,
      })

    const vivo = kpi()
    const hoje = kpi({ recebido_no_mes_cents: 110000, generated_at: '2026-07-26T07:04:00.000Z' })
    const base = kpi({
      business_date: '2026-06-26',
      recebido_no_mes_cents: 100000,
      em_atraso_cents: 4000,
      previsto_no_mes_cents: 200000,
      alunos_ativos: { total: 19, particulares: 13, travel: 6 },
      generated_at: '2026-06-26T09:31:00.000Z',
    })

    it('monta o caminho feliz com as datas e as HORAS reais de cada fechamento', () => {
      const c = montarComparacao(vivo, hoje, base)
      expect(c).not.toBeNull()
      expect(c!.hoje).toBe('2026-07-26')
      expect(c!.base).toBe('2026-06-26')
      // hora do `generated_at` de CADA snapshot, no fuso do negócio (−04)
      expect(c!.horaHoje).toBe('03:04')
      expect(c!.horaBase).toBe('05:31')
      expect(c!.recebido).toEqual({ pct: 10, sentido: 'sobe' })
      expect(c!.atraso).toEqual({ pct: 25, sentido: 'sobe' })
      expect(c!.previsto).toEqual({ pct: 0, sentido: 'igual' })
      expect(c!.alunos).toEqual({ pct: 5, sentido: 'sobe' })
    })

    it('dois fechamentos v1 ao lado de um número vivo v2 → sem comparação (S3)', () => {
      const v1 = { ...hoje, definitions_version: 1 }
      const b1 = { ...base, definitions_version: 1 }
      expect(montarComparacao(vivo, v1, b1)).toBeNull()
      // e volta sozinha quando a régua viva é a mesma dos dois pontos
      expect(montarComparacao(kpi({ definitions_version: 1 }), v1, b1)).not.toBeNull()
      // divergência entre os próprios fechamentos também apaga
      expect(montarComparacao(vivo, hoje, { ...base, definitions_version: 1 })).toBeNull()
    })

    it('snapshot ausente ou malformado → sem comparação (nunca "—%")', () => {
      expect(montarComparacao(vivo, undefined, base)).toBeNull()
      expect(montarComparacao(vivo, hoje, undefined)).toBeNull()
      // forma velha/corrompida: falta um campo do contrato
      const semAlunos: Record<string, unknown> = { ...hoje }
      delete semAlunos.alunos_ativos
      expect(montarComparacao(vivo, semAlunos, base)).toBeNull()
      expect(montarComparacao(vivo, { qualquer: 'coisa' }, base)).toBeNull()
      // business_date impossível: nem base existe
      expect(montarComparacao(kpi({ business_date: 'nada disso' }), hoje, base)).toBeNull()
    })

    it('campo sem base > 0 some sozinho, o resto continua', () => {
      const c = montarComparacao(vivo, hoje, kpi({ ...base, em_atraso_cents: 0 }))
      expect(c!.atraso).toBeUndefined()
      expect(c!.recebido).toEqual({ pct: 10, sentido: 'sobe' })
    })

    it('"há fechamento de hoje" NÃO é "há comparação" — o aviso de atraso não mente', () => {
      // fórmula nova apaga o delta com o fechamento de hoje bem no lugar
      expect(fechamentoValido({ ...hoje, definitions_version: 1 })).toBe(true)
      expect(montarComparacao(vivo, { ...hoje, definitions_version: 1 }, base)).toBeNull()
      expect(fechamentoValido(undefined)).toBe(false)
      expect(fechamentoValido({ qualquer: 'coisa' })).toBe(false)
    })

    it('a base é o MESMO dia do mês anterior', () => {
      expect(dataDaBase('2026-07-26')).toBe('2026-06-26')
      // fim de mês: o Luxon encurta para o último dia válido (31/03 → 28/02)
      expect(dataDaBase('2026-03-31')).toBe('2026-02-28')
      expect(dataDaBase('nada disso')).toBeNull()
    })
  })
})

/* ========================================================================== */
/* 3b. Fechamento de KPI: silêncio antes da hora, AVISO depois (B2)            */
/* ========================================================================== */

describe('passouDaHoraDoFechamento', () => {
  const HOJE = '2026-07-26'
  // última tentativa do cron: 09:00 UTC; folga de 1 h ⇒ 10:00 UTC
  const emUtc = (hhmm: string) => `${HOJE}T${hhmm}:00.000Z`

  it('antes da última tentativa (+folga) fica CALADO — o ponto ainda não existe', () => {
    expect(passouDaHoraDoFechamento(HOJE, emUtc('06:59'))).toBe(false)
    expect(passouDaHoraDoFechamento(HOJE, emUtc('07:30'))).toBe(false)
    expect(passouDaHoraDoFechamento(HOJE, emUtc('09:30'))).toBe(false)
    // exatamente no limite ainda não é atraso
    expect(passouDaHoraDoFechamento(HOJE, emUtc('10:00'))).toBe(false)
  })

  it('depois disso, a ausência do fechamento vira AVISO', () => {
    expect(passouDaHoraDoFechamento(HOJE, emUtc('10:01'))).toBe(true)
    expect(passouDaHoraDoFechamento(HOJE, emUtc('20:00'))).toBe(true)
    // a tarde de Cuiabá (16:00 -04 = 20:00Z) é bem depois do job
    expect(passouDaHoraDoFechamento(HOJE, '2026-07-26T16:00:00-04:00')).toBe(true)
  })

  it('entrada inválida nunca vira alarme', () => {
    expect(passouDaHoraDoFechamento('', emUtc('20:00'))).toBe(false)
    expect(passouDaHoraDoFechamento(HOJE, 'nada disso')).toBe(false)
  })

  it('a última tentativa conhecida pelo app é a do cron (10:00 UTC = 09:00 + folga)', () => {
    expect(TENTATIVAS_DE_FECHAMENTO_UTC).toEqual([420, 440, 540])
    expect(FOLGA_DE_FECHAMENTO_MIN).toBe(60)
  })
})

/* ========================================================================== */
/* 4. Contrato dos 8 KPIs contra o banco                                       */
/* ========================================================================== */

describe('contrato de admin_kpis()', () => {
  let sql: Sql
  let admin: SupabaseClient
  let svc: SupabaseClient

  beforeAll(async () => {
    sql = connect(3)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin onda 1'), 'admin')
    svc = serviceClient()
  })

  it('o payload real da RPC passa pelo schema da camada de dados', async () => {
    const { data, error } = await admin.rpc('admin_kpis')
    expect(error).toBeNull()
    const kpis = AdminKpisSchema.parse(data)
    expect(kpis.definitions_version).toBe(3)
    // v3 (Onda Financeiro · F2, decisão do dono): a perna de mentoria deixou de
    // ser zero fixo e virou REFERÊNCIA computada (sessões do mês × reservas ×
    // R$70 — não é caixa; o caixa é da Hotmart). O valor exato é pinado pela
    // identidade em um único snapshot (T12 de onda-financeiro-f2); aqui só se
    // prova que o schema aceita o número e que ele nunca é negativo.
    expect(kpis.previsto_mentoria_cents).toBeGreaterThanOrEqual(0)
    expect(kpis.alunos_por_nivel.length).toBeGreaterThan(0)
    await sql.end()
  })

  it('o snapshot gravado pelo job é lido pelo MESMO schema (é o que a comparação usa)', async () => {
    await svc.rpc('capture_kpi_snapshot')
    const { data, error } = await admin
      .from('kpi_snapshots')
      .select('captured_on, definitions_version, data')
      .order('captured_on', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const anterior = AdminKpisSchema.parse(data!.data)
    expect(anterior.definitions_version).toBe(data!.definitions_version)
  })
})

/* ========================================================================== */
/* 4b. Contagens da fila de pendências (C2)                                    */
/* ========================================================================== */

describe('admin_home_counts()', () => {
  let sql: Sql
  let admin: SupabaseClient
  let aluno: SupabaseClient

  beforeAll(async () => {
    sql = connect(2)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin contagens'), 'admin')
    aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno contagens'), 'student')
  })
  afterAll(async () => {
    await sql.end()
  })

  it('devolve as duas contagens, como número, para a admin', async () => {
    const { data, error } = await admin.rpc('admin_home_counts')
    expect(error).toBeNull()
    const c = z
      .object({ convites_pendentes: z.coerce.number(), briefings_travados: z.coerce.number() })
      .parse(data)
    expect(c.convites_pendentes).toBeGreaterThanOrEqual(0)
    expect(c.briefings_travados).toBeGreaterThanOrEqual(0)
  })

  // CICLO DE VIDA, fase 1 (27/07/2026): a semântica ganhou UMA exceção — LEAD
  // não é convite pendente. Ele nunca foi convidado e, por decisão da spec, não
  // tem portal nesta fase: contá-lo acenderia na home da dona uma pendência que
  // ninguém quer resolver. O recorte do diretório abaixo acompanha a RPC.
  it('conta os MESMOS alunos que o diretório contava (semântica preservada, sem lead)', async () => {
    // As duas contas saem do MESMO SELECT, numa conexão direta com a claim de
    // admin injetada: a suíte roda arquivos em paralelo e outros testes criam
    // alunos o tempo todo — duas chamadas seguidas via PostgREST veriam
    // snapshots diferentes e a comparação viraria flake (visto: 586 × 584).
    const claims = JSON.stringify({ sub: crypto.randomUUID(), app_metadata: { role: 'admin' } })
    const linhas = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      return tx`
        select (public.admin_home_counts() ->> 'convites_pendentes')::int as pela_rpc,
               (select count(*) from public.admin_student_directory() d
                 where d.status not in ('archived', 'lead')
                   and (d.profile_id is null or coalesce(d.email_confirmed, false) = false))::int
                 as pelo_diretorio`
    })
    const linha = (linhas as unknown as { pela_rpc: number; pelo_diretorio: number }[])[0]
    expect(linha.pela_rpc).toBe(linha.pelo_diretorio)
  })

  it('é restrita à admin (Lei 4)', async () => {
    const { error } = await aluno.rpc('admin_home_counts')
    expect(error).not.toBeNull()
    expect(error!.message).toContain('admin')
  })
})

/* ========================================================================== */
/* 5. Regra de lint: fuso não se calcula no cliente                            */
/* ========================================================================== */

describe('ptos/no-client-timezone', () => {
  const linter = new Linter()
  const rodar = (codigo: string) =>
    linter.verify(codigo, {
      plugins: { ptos: ptosPlugin },
      rules: { 'ptos/no-client-timezone': 'error' },
      languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    })

  it('acusa relógio e formatação de data em arquivo "use client"', () => {
    const r = rodar(`'use client'\nexport function X(iso) {\n  const d = new Date(iso)\n  return d.toLocaleString('pt-BR')\n}\n`)
    expect(r).toHaveLength(2)
  })

  it('acusa Intl.DateTimeFormat', () => {
    const r = rodar(`'use client'\nconst f = new Intl.DateTimeFormat('pt-BR')\n`)
    expect(r.length).toBeGreaterThanOrEqual(1)
  })

  it('cala em arquivo de SERVIDOR (é lá que a conversão deve morar)', () => {
    expect(rodar(`export const x = new Date('2026-07-26')\n`)).toHaveLength(0)
  })

  /* ---- matriz adversarial (C8): os escapes que o revisor provou ---------- */

  const DEVE_ACUSAR: [string, string][] = [
    ['Date() sem new', `const s = Date()\n`],
    ['new globalThis.Date', `const d = new globalThis.Date(iso)\n`],
    ['new window.Date', `const d = new window.Date(iso)\n`],
    ["new globalThis['Date']", `const d = new globalThis['Date'](iso)\n`],
    ["Intl['DateTimeFormat'] computado", `const f = new Intl['DateTimeFormat']('pt-BR')\n`],
    ['globalThis.Intl.DateTimeFormat', `const f = new globalThis.Intl.DateTimeFormat('pt-BR')\n`],
    ["toLocaleString por colchete", `const s = d['toLocaleString']('pt-BR')\n`],
    ['import de luxon', `import { DateTime } from 'luxon'\nexport const x = DateTime\n`],
    ['import de date-fns', `import { format } from 'date-fns'\nexport const x = format\n`],
    ['import de date-fns-tz', `import { utcToZonedTime } from 'date-fns-tz'\nexport const x = utcToZonedTime\n`],
    ['import de submódulo de date-fns', `import add from 'date-fns/add'\nexport const x = add\n`],
  ]

  it.each(DEVE_ACUSAR)('acusa: %s', (_nome, codigo) => {
    expect(rodar(`'use client'\n${codigo}`).length).toBeGreaterThanOrEqual(1)
  })

  const NAO_DEVE_ACUSAR: [string, string][] = [
    // época pura: o número é o MESMO em qualquer fuso — punir isto empurra
    // quem escreve para o eslint-disable, que apaga também o que importa
    ['new Date(x).getTime() imediato', `export const t = new Date(iso).getTime()\n`],
    ['new Date(x).valueOf() imediato', `export const t = new Date(iso).valueOf()\n`],
    ['+new Date(x)', `export const t = +new Date(iso)\n`],
    ['Date.now()', `export const t = Date.now()\n`],
    ['Date.parse(x)', `export const t = Date.parse(iso)\n`],
    // nada disto tem a ver com data
    ['import de outra biblioteca', `import { z } from 'zod'\nexport const x = z\n`],
    ['propriedade parecida', `export const x = obj.dateFnsLike\n`],
  ]

  it.each(NAO_DEVE_ACUSAR)('cala: %s', (_nome, codigo) => {
    expect(rodar(`'use client'\n${codigo}`)).toHaveLength(0)
  })

  it('a variável guardada ainda é acusada (só a época IMEDIATA escapa)', () => {
    // `const d = new Date(iso)` guarda um objeto que formata no fuso do
    // navegador em qualquer linha seguinte — a isenção é só da conversão colada.
    expect(rodar(`'use client'\nconst d = new Date(iso)\nexport const t = d.getTime()\n`)).toHaveLength(1)
  })

  it('em arquivo de servidor, nem biblioteca nem Date() são problema', () => {
    expect(rodar(`import { DateTime } from 'luxon'\nexport const x = DateTime.now()\n`)).toHaveLength(0)
    expect(rodar(`export const s = Date()\n`)).toHaveLength(0)
  })

  it('cala com justificativa escrita — e só com ela', () => {
    expect(
      rodar(`'use client'\n// fuso-ok: comparar com o relógio do navegador é a função deste componente\nconst agora = new Date()\n`),
    ).toHaveLength(0)
    expect(
      rodar(`'use client'\n// fuso-ok-arquivo: componente que existe para ler o relógio do navegador\nconst agora = new Date()\nconst t = agora.toLocaleString()\n`),
    ).toHaveLength(0)
    // comentário SEM motivo não vale como justificativa
    expect(rodar(`'use client'\n// fuso-ok:\nconst agora = new Date()\n`)).toHaveLength(1)
  })
})

/* ========================================================================== */
/* 6. Aceites de grep das telas novas                                          */
/* ========================================================================== */

const ARQUIVOS_NOVOS = [
  'src/app/admin/page.tsx',
  'src/app/admin/layout.tsx',
  'src/app/admin/error.tsx',
  'src/app/admin/loading.tsx',
  'src/components/admin/AdminShell.tsx',
  'src/components/admin/AdminNavClient.tsx',
  'src/components/admin/nav.ts',
  'src/components/admin/inicio/AndarHoje.tsx',
  'src/components/admin/inicio/AndarNegocio.tsx',
  'src/components/admin/inicio/BandaDeTopo.tsx',
  'src/components/admin/inicio/CartaoKpi.tsx',
  'src/components/admin/inicio/RegistrarDesfecho.tsx',
  'src/components/admin/inicio/esqueletos.tsx',
  'src/components/admin/inicio/geometria.ts',
  'src/components/kit/page-bar.tsx',
  'src/components/kit/pill.tsx',
  'src/components/kit/empty-state.tsx',
  'src/components/kit/card-panel.tsx',
  'src/components/kit/split-button.tsx',
  'src/components/kit/sheet.tsx',
  'src/components/kit/skeleton.tsx',
  'src/components/kit/instant.tsx',
  'src/data/admin/home.ts',
  'src/data/admin/conta.ts',
  'src/data/admin/actions.ts',
  'src/data/admin/comparar.ts',
  'src/data/admin/fechamento.ts',
  'src/data/admin/action-result.ts',
]

const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')

describe('aceites das telas novas', () => {
  it.each(ARQUIVOS_NOVOS)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    const codigo = corpo(rel)
      // comentários explicam o que MORREU; o que vale é o código
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(codigo).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_NOVOS)('%s não usa overlay fora do kit, ?msg= nem nonce', (rel) => {
    const codigo = corpo(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(codigo).not.toContain('data-popup')
    expect(codigo).not.toContain('msg=')
    expect(codigo).not.toMatch(/\bnonce\b/)
  })

  it('a página nova não faz query inline — quem lê é a camada de dados', () => {
    const pagina = corpo('src/app/admin/page.tsx')
    expect(pagina).not.toContain('@/lib/supabase')
    expect(pagina).not.toContain('.from(')
    expect(pagina).not.toContain('.rpc(')
    expect(pagina).toContain("from '@/data/admin/home'")
  })

  it('a camada de dados é server-only e valida o retorno', () => {
    const dados = corpo('src/data/admin/home.ts')
    expect(dados.startsWith("import 'server-only'")).toBe(true)
    expect(dados).toContain('AdminKpisSchema.parse')
  })

  // C1: leitura que falha não pode virar lista vazia. Toda leitura crítica
  // passa por `exigir(...)` — só a saudação (cortesia) degrada.
  it('nenhuma leitura crítica do Início cai em `?? []` sem conferir o erro', () => {
    const dados = corpo('src/data/admin/home.ts')
    for (const leitura of [
      "exigir('a agenda do dia'",
      "exigir('as professoras'",
      "exigir('as aulas sem apontamento'",
      "exigir('as contagens da fila'",
      "exigir('os fechamentos de KPI'",
    ]) {
      expect(dados, leitura).toContain(leitura)
    }
    // a home não carrega mais o diretório inteiro só para contar (C2)
    expect(dados).not.toContain('admin_student_directory')
    expect(dados).toContain('admin_home_counts')
  })

  // C3: dois andares, duas promessas — senão um snapshot lento segura a agenda.
  it('a página cria DUAS leituras independentes, uma por andar', () => {
    const pagina = corpo('src/app/admin/page.tsx')
    expect(pagina).toContain('getAdminHoje()')
    expect(pagina).toContain('getAdminNegocio()')
  })

  // C4: o shell inteiro sob Suspense apagava o admin quando uma página legada
  // suspendia; a espera da página é do loading.tsx.
  it('o layout NÃO envolve o AdminShell em Suspense', () => {
    const layout = corpo('src/app/admin/layout.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(layout).not.toMatch(/<Suspense[^>]*>\s*<AdminShell/)
    expect(layout).toContain('<AdminShell>')
  })

  // A bancada MORREU com o martelo de D10/D7: nem componente, nem parâmetro,
  // nem env. Resto de bancada em produção seria ferramenta interna alcançável
  // por quem tivesse a URL — o defeito que o portão de build (C10) cobria.
  it('não sobrou nenhum resto da bancada de decisão', () => {
    expect(existsSync(path.join(RAIZ, 'src/components/admin/BancadaSwitcher.tsx'))).toBe(false)
    expect(existsSync(path.join(RAIZ, 'src/components/admin/bancada.ts'))).toBe(false)
    expect(readFileSync(path.join(RAIZ, '.env.example'), 'utf8')).not.toContain('NEXT_PUBLIC_BANCADA')
    for (const rel of ARQUIVOS_NOVOS) {
      expect(corpo(rel), rel).not.toContain('NEXT_PUBLIC_BANCADA')
      expect(corpo(rel), rel).not.toContain('comBancada')
    }
  })

  /* ---- aceites da clonagem TutorBird (26/07) ----------------------------- */

  // A régua de legibilidade do dono: número-destaque é DADO. Display fino era
  // exatamente a queixa ("informação importante estava apagada").
  it.each(ARQUIVOS_NOVOS)('%s não escreve número em peso fino', (rel) => {
    const codigo = corpo(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(codigo).not.toContain('font-extralight')
    expect(codigo).not.toContain('font-light')
  })

  // Link de texto puro como ação é proibido em tela nova (AGENTS.md). O
  // `linkActionXs` das telas velhas não pode atravessar a fronteira.
  it.each(ARQUIVOS_NOVOS)('%s não usa link de texto como ação', (rel) => {
    expect(corpo(rel)).not.toContain('linkActionXs')
  })

  // O eyebrow (11px caixa alta espaçada) morreu nas telas desta rodada: ele era
  // o único nome de dados críticos, o que a régua proíbe.
  //
  // ⚠️ LOTE 10: "segunda família" saiu do nome deste teste porque ela agora
  // EXISTE — a Roboto da navegação, medida no TutorBird. O que continua morto é
  // a família de DISPLAY (`font-display`), que era decoração de título.
  it('o Início não tem mais eyebrow nem família de display', () => {
    for (const rel of [
      'src/app/admin/page.tsx',
      'src/components/admin/inicio/AndarHoje.tsx',
      'src/components/admin/inicio/AndarNegocio.tsx',
      'src/components/admin/inicio/BandaDeTopo.tsx',
      'src/components/admin/inicio/CartaoKpi.tsx',
      'src/components/admin/AdminShell.tsx',
      'src/components/admin/AdminNavClient.tsx',
    ]) {
      const codigo = corpo(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(codigo, rel).not.toContain('font-display')
      expect(codigo, rel).not.toMatch(/tracking-\[0\.14em\]/)
      // caixa alta como ESTILO de rótulo morre; `first-letter:uppercase` fica —
      // ele só sobe a inicial de uma data que vem em minúscula do Luxon.
      expect(codigo, rel).not.toMatch(/(?<!first-letter:)uppercase/)
    }
  })

  /* ---- LOTE 9: a anatomia CENTRALIZADA do cartão de número ---------------- */

  // O dono reprovou a anatomia de canto ("não dá pra entender o que é cada
  // caixa", captura 41): o que separa um cartão do outro é a MARCA VISUAL no
  // topo. Círculo grande centrado, número embaixo, rótulo na base.
  const cartaoKpi = () =>
    corpo('src/components/admin/inicio/CartaoKpi.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it('o cartão de KPI é coluna centrada, com círculo de 80px e ícone de 32px', () => {
    const cartao = cartaoKpi()
    // a coluna inteira centra — caixa E texto
    expect(cartao).toContain('flex flex-col items-center text-center')
    // círculo 80px / 64px no compacto, com ícone de 32px / 28px dentro
    expect(cartao).toContain('rounded-full bg-ac-tint')
    expect(cartao).toContain("compacto ? 'h-16 w-16' : 'h-20 w-20'")
    expect(cartao).toContain("compacto ? 'h-7 w-7' : 'h-8 w-8'")
    // o traço acompanha o tamanho: a 32px, os 2px do lucide afinam demais
    expect(cartao).toContain('strokeWidth={compacto ? 2 : 2.25}')
    // e a anatomia velha (ícone de 40px no canto superior esquerdo) não sobrou
    expect(cartao).not.toContain('h-10 w-10')
    expect(cartao).not.toContain('h-5 w-5')
  })

  // A centralização é de LAYOUT: nenhuma regra de cor do número muda com ela.
  it('as regras de cor do número atravessam a centralização intactas', () => {
    const cartao = cartaoKpi()
    expect(cartao).toContain(
      "alerta ? 'text-danger-700' : tom === 'ok' ? 'text-ok-700' : 'text-ink-900'",
    )
    // o glow do cartão de atraso segue preso ao mesmo estado
    expect(cartao).toContain('[--card-state:var(--glow-danger)]')
    // número continua sendo DADO: bold, tabular, 2xl/3xl
    expect(cartao).toContain('font-bold tabular-nums')
    expect(cartao).toContain("compacto ? 'text-2xl' : 'text-3xl'")
  })

  // Exceção nomeada: par nome→número centrado é ilegível. Os dois cartões de
  // lista nivelam pelo CABEÇALHO (círculo + rótulo + frase) e só o corpo
  // continua alinhado à esquerda, na largura toda.
  it('os dois cartões de LISTA do andar Negócio mantêm o corpo à esquerda', () => {
    expect(cartaoKpi()).toContain('<div className="w-full text-left">{children}</div>')
    const negocio = corpo('src/components/admin/inicio/AndarNegocio.tsx')
    expect(negocio.match(/^\s+lista$/gm) ?? []).toHaveLength(2)
  })

  // Esqueleto = forma REAL da caixa nova, não bloco cinza chapado; e o contorno
  // segue transparente, senão o atraso de 200 ms do `.kit-skeleton` perde o
  // sentido (um cartão inteiro pintaria no primeiro frame).
  it('o esqueleto do Início veste a anatomia nova', () => {
    const esq = corpo('src/components/admin/inicio/esqueletos.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(esq).toContain('EsqueletoCartaoKpi')
    expect(esq).toContain('flex flex-col items-center')
    expect(esq).toContain("compacto ? 'h-16 w-16' : 'h-20 w-20'")
    expect(esq).not.toContain('h-36 rounded-kpi')
    expect(esq).not.toContain('h-28 rounded-kpi')
    expect(esq).not.toContain('card-kpi')
  })

  // A3 da revisão nº 5 do Sol: forma real não bastava — faltava TAMANHO. O piso
  // de altura é declarado UMA vez (`geometria.ts`) e vestido nos dois lados, e
  // o esqueleto desenha a contagem típica.
  it('o esqueleto e o andar real reservam a MESMA geometria', () => {
    const regua = corpo('src/components/admin/inicio/geometria.ts')
    expect(regua).toContain("RESERVA_AGENDA = 'min-h-64'")
    expect(regua).toContain("RESERVA_PENDENCIAS = 'min-h-52'")
    expect(regua).toContain("RESERVA_CARTOES = 'min-h-68'")
    expect(regua).toContain('LINHAS_TIPICAS_DA_AGENDA = 4')
    expect(regua).toContain('CARTOES_TIPICOS_DE_PENDENCIA = 3')
    // a exceção do estado vazio das pendências é DECLARADA, não descoberta
    expect(regua).toContain('EXCEÇÃO DECLARADA')

    const hoje = corpo('src/components/admin/inicio/AndarHoje.tsx')
    expect(hoje).toContain('className={RESERVA_AGENDA}')
    expect(hoje).toContain('className={RESERVA_PENDENCIAS}')

    const esq = corpo('src/components/admin/inicio/esqueletos.tsx')
    expect(esq).toContain('className={RESERVA_AGENDA}')
    expect(esq).toContain('className={RESERVA_PENDENCIAS}')
    expect(esq).toContain('rows={LINHAS_TIPICAS_DA_AGENDA}')
    expect(esq).toContain('length: CARTOES_TIPICOS_DE_PENDENCIA')
    // o título "Pendências" existe nos dois lados (era um pulo de 26px + gap)
    expect(esq).toContain('h-[26px] w-40')

    // as duas fileiras de cartões grandes usam o mesmo piso dos dois lados
    for (const rel of [
      'src/components/admin/inicio/AndarNegocio.tsx',
      'src/components/admin/inicio/BandaDeTopo.tsx',
      'src/components/admin/inicio/esqueletos.tsx',
    ]) {
      expect(corpo(rel), rel).toContain('${RESERVA_CARTOES}')
    }
  })

  // Item ativo = retângulo full-width escurecido. A barrinha vertical à
  // esquerda e o "quadradinho" com raio eram invenção nossa e morreram.
  it('o item ativo do trilho é retângulo escurecido — sem barrinha, sem raio', () => {
    const nav = corpo('src/components/admin/AdminNavClient.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(nav).toContain('bg-ac-nav-bg')
    // a barrinha era um <span absolute inset-y-… w-0.5 bg-ac-vivid>
    expect(nav).not.toMatch(/w-0\.5/)
    expect(nav).not.toMatch(/ITEM_ATIVO =[^\n]*rounded/)
    // e o trilho veste o fundo sólido da clonagem, não a tinta escura
    expect(nav).toContain('bg-rail-bg')
    expect(nav).toContain('hover:bg-rail-hover')
  })

  // LOTE 8 — o mecanismo DEFINITIVO, medido frame a frame (59 frames do vídeo
  // do dono; `docs/goals/mapeamento-tutorbird-2.md`, "Cinemetria da sidebar").
  // A borda ESQUERDA não se move e o conteúdo está pinado na posição final
  // (morre o slide da v1); os intermediários têm cor plena com os rótulos
  // INTEIROS sendo cortados (morre o fade da v2). Quem viaja é a borda DIREITA:
  // é REVELAÇÃO DE LARGURA POR CORTE, num elemento só.
  /** O trilho e as constantes que só ele usa — a barra de polegar do celular
   *  vem depois da barra superior e fica de fora. */
  const railDoAdmin = () => {
    const nav = corpo('src/components/admin/AdminNavClient.tsx')
    return nav.slice(nav.indexOf('const CONTEUDO'), nav.indexOf('export function AdminTopBar'))
  }

  it('o trilho anima a LARGURA e corta — nada de slide, nada de fade', () => {
    const rail = railDoAdmin()
    // um elemento só, `fixed`, vestindo a classe do mecanismo
    expect(rail).toMatch(/<nav[\s\S]*className="rail fixed/)

    const codigo = rail.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // grep-aceites: o mecanismo velho não sobreviveu em lugar nenhum
    expect(codigo).not.toContain('rail-drawer')
    expect(codigo).not.toContain('translate')
    expect(codigo).not.toMatch(/\bopacity-/)
    expect(codigo).not.toContain('visibility')
    expect(codigo).not.toMatch(/group-(hover|focus-within)\/rail:/)
    expect(CSS_LIMPO).not.toContain('rail-drawer')
    expect(CSS_LIMPO).not.toContain('--delay-drawer-close')

    // as variáveis do contrato (o dono ajusta cadência e sombra em uma linha)
    expect(CSS_LIMPO).toContain('--rail-w-rest: 64px')
    expect(CSS_LIMPO).toContain('--rail-w-open: 265px')
    expect(CSS_LIMPO).toContain('--duration-drawer: 300ms')
    expect(CSS_LIMPO).toContain('--ease-drawer: cubic-bezier(0.65, 0, 0.35, 1)')
    expect(CSS_LIMPO).toContain('--delay-rail-rest: 100ms')

    // REPOUSO: 64px, cortando, com a cortesia no caminho de volta.
    const repouso = CSS_LIMPO.match(/\.rail \{([^}]*)\}/)?.[1] ?? ''
    expect(repouso).toContain('width: var(--rail-w-rest)')
    // o corte É o mecanismo — e fechado não rola
    expect(repouso).toContain('overflow-x: hidden')
    expect(repouso).toContain('overflow-y: hidden')
    // a propriedade animada é WIDTH (com a sombra junto), nunca transform nem
    // opacidade
    expect(repouso).toContain('width var(--duration-drawer) var(--ease-drawer) var(--delay-rail-rest)')
    expect(repouso).not.toMatch(/transition:[^;]*(transform|opacity)/)
    expect(repouso).not.toContain('visibility')
  })

  it('hover/foco de teclado abrem para 265px, imediato e simétrico', () => {
    const aberto =
      CSS_LIMPO.match(/\.rail:hover,\s*\.rail:has\(:focus-visible\) \{([^}]*)\}/)?.[1] ?? ''
    expect(aberto).toContain('width: var(--rail-w-open)')
    // NUNCA `:focus-within` (achado do dono, 27/07): o clique também deixa foco
    // no link e o trilho ficava PRESO aberto depois de navegar — só o foco de
    // teclado (`:has(:focus-visible)`) pode segurar o painel
    expect(CSS_LIMPO).not.toMatch(/\.rail:focus-within/)
    // rolagem vertical SÓ quando aberto
    expect(aberto).toContain('overflow-y: auto')
    // mesma duração e mesma curva na ida (fechamento simétrico, como medido) —
    // mas SEM a cortesia, que é só do caminho de volta
    expect(aberto).toContain('width var(--duration-drawer) var(--ease-drawer)')
    expect(aberto).not.toContain('--delay-rail-rest')
    expect(aberto).not.toContain('transform')
    expect(aberto).not.toContain('opacity')
  })

  // Emenda v3 (ordem do dono, 27/07): os rótulos fazem FADE junto com o corte,
  // na MESMA cadência da largura — abrindo imediato, fechando com a cortesia.
  // Desvio deliberado por cima da cinemetria (que era corte puro).
  it('os rótulos fazem fade sincronizado com o corte (emenda v3)', () => {
    const repouso = CSS_LIMPO.match(/\.rail \.rail-label \{([^}]*)\}/)?.[1] ?? ''
    expect(repouso).toContain('opacity: 0')
    expect(repouso).toContain(
      'opacity var(--duration-drawer) var(--ease-drawer) var(--delay-rail-rest)',
    )
    const aberto =
      CSS_LIMPO.match(
        /\.rail:hover \.rail-label,\s*\.rail:has\(:focus-visible\) \.rail-label \{([^}]*)\}/,
      )?.[1] ?? ''
    expect(aberto).toContain('opacity: 1')
    expect(aberto).toContain('opacity var(--duration-drawer) var(--ease-drawer)')
    expect(aberto).not.toContain('--delay-rail-rest')

    // em ponteiro grosso o trilho é aberto FIXO e não há hover: sem esta regra
    // os rótulos ficariam invisíveis para sempre
    const grosso =
      CSS_LIMPO.match(/@media \(min-width: 768px\) and \(hover: none\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(grosso).toMatch(/\.rail \.rail-label \{[^}]*opacity: 1/)

    // e as TRÊS famílias de rótulo do trilho vestem a classe (wordmark, itens,
    // pé "Meu painel de professora")
    const nav = railDoAdmin()
    expect((nav.match(/rail-label/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  // Δlum medido na borda direita: ≈ 5 fechado × ≈ 26–30 aberto. A sombra é real
  // e acompanha a borda; ela anima JUNTO com a largura, senão descola dela.
  it('a sombra da borda direita tem duas intensidades e anda com a largura', () => {
    expect(CSS_LIMPO).toMatch(/--rail-shadow-rest: 2px 0 6px/)
    expect(CSS_LIMPO).toMatch(/--rail-shadow-open: 8px 0 24px/)

    const repouso = CSS_LIMPO.match(/\.rail \{([^}]*)\}/)?.[1] ?? ''
    const aberto =
      CSS_LIMPO.match(/\.rail:hover,\s*\.rail:has\(:focus-visible\) \{([^}]*)\}/)?.[1] ?? ''
    expect(repouso).toContain('box-shadow: var(--rail-shadow-rest)')
    expect(aberto).toContain('box-shadow: var(--rail-shadow-open)')
    // mesma duração/curva/atraso da largura nos dois estados
    expect(repouso).toContain('box-shadow var(--duration-drawer) var(--ease-drawer) var(--delay-rail-rest)')
    expect(aberto).toContain('box-shadow var(--duration-drawer) var(--ease-drawer)')

    // a aberta é MAIS forte que a de repouso (é o Δ medido, não enfeite)
    const alfa = (nome: string) =>
      Number(CSS_LIMPO.match(new RegExp(`${nome}:[^;]*/ ([\\d.]+)\\)`))?.[1] ?? '0')
    expect(alfa('--rail-shadow-open')).toBeGreaterThan(alfa('--rail-shadow-rest'))
  })

  // O bloco interno tem largura FIXA: se ele reflui, o conteúdo anda durante a
  // animação — e a medição diz que nada anda.
  it('o conteúdo interno tem largura fixa de 265px e não reflui', () => {
    const rail = railDoAdmin()
    expect(rail).toContain("const CONTEUDO = 'w-[265px]'")
    // o bloco que embrulha tudo dentro da nav veste essa largura
    expect(rail).toMatch(/<div className=\{`flex min-h-full \$\{CONTEUDO\} flex-col/)
    // ...e a linha do item também: é ela que carrega o retângulo do ativo
    // (o `nav-tb` da frente é a voz da navegação — lote 10)
    expect(rail).toMatch(/const ITEM_BASE = `nav-tb flex \$\{ITEM_ALTURA\} \$\{CONTEUDO\}/)
    // célula do ícone = a largura de REPOUSO (64px): é o que põe o rótulo a
    // começar exatamente na borda do corte
    expect(rail).toContain("const CELULA = 'flex w-16 shrink-0 items-center justify-center'")
    // altura pinada da régua vertical do TutorBird
    expect(rail).toContain("const ITEM_ALTURA = 'h-11'")
    expect(rail).toContain("const CABECALHO_ALTURA = 'h-6'")
    expect(rail).not.toMatch(/const ITEM_BASE = [^\n]*py-/)
    // o rótulo nunca quebra — ele é revelado inteiro, não redesenhado
    expect(rail).toMatch(/whitespace-nowrap[^\n]*\{item\.label\}/)
  })

  // A CAMADA DUPLA MORREU: um conjunto de links só, todos reais e focáveis.
  it('o trilho tem UM conjunto de links reais — sem espelho, sem duplicata', () => {
    const rail = railDoAdmin()
    // uma única varredura do trilho no componente inteiro
    expect(rail.match(/TRILHO\.map/g) ?? []).toHaveLength(1)
    // nada de duplicata escondida do teclado ou do leitor de tela
    expect(rail).not.toContain('tabIndex={-1}')
    // o bloco que embrulha as rotas é visível para o leitor de tela (o
    // `aria-hidden` do espelho velho morreu — o único que sobra é o do
    // espaçador de fluxo e o da marca, que não são navegação)
    expect(rail).toMatch(/<div className="flex flex-1 flex-col">\s*\{TRILHO\.map/)
    // e nada de anel espelhado / estado de foco em JS
    expect(rail).not.toContain('ANEL_ESPELHADO')
    expect(rail).not.toContain('useState')
    expect(rail).not.toContain("matches(':focus-visible')")

    // cada rota é uma âncora real com o rótulo VISÍVEL como nome acessível
    expect(rail).toMatch(/<Link[\s\S]*href=\{item\.href\}/)
    expect(rail).toContain('aria-current={ativo ? \'page\' : undefined}')
    expect(rail).not.toMatch(/aria-label=\{item\.label\}/)
    expect(rail).not.toMatch(/<span\s+key=\{item\.href\}/)
    // foco visível no padrão do site, puxado para dentro (a nav corta 2px)
    expect(rail).toContain('focus-visible:-outline-offset-2')
    // ...e o trilho retoma o token de foco da superfície de TINTA: sobre papel
    // ele valeria brand-600, que é o próprio fundo do trilho (anel invisível).
    const repouso = CSS_LIMPO.match(/\.rail \{([^}]*)\}/)?.[1] ?? ''
    expect(repouso).toContain('--focus-ring: var(--accent-turquoise)')
  })

  // "Meu painel de professora" não tinha ícone e por isso não existia no estado
  // fechado — que é o estado de repouso do trilho. Agora tem, como os demais.
  it('todo item do trilho tem célula de ícone, inclusive o do pé', () => {
    const rail = railDoAdmin()
    const pe = rail.slice(rail.indexOf('href="/teacher"'))
    expect(pe).toContain('className={CELULA}')
    expect(pe).toContain('<LayoutDashboard className="h-5 w-5" />')
    // o ícone do pé não pode repetir o de "Professoras" (Presentation): no
    // estado fechado, dois ícones iguais são dois destinos indistinguíveis
    expect(pe).not.toContain('Presentation')
  })

  // Ativo = retângulo escurecido nas DUAS larguras. Fechado o corte o entrega
  // como quadrado de 64px; aberto, como a linha inteira. Sem raio, sem barrinha.
  it('o item ativo é retângulo full-width — presente nas duas larguras', () => {
    const rail = railDoAdmin()
    expect(rail).toContain("const ITEM_ATIVO = 'bg-ac-nav-bg text-ac-nav-fg'")
    // full-width do bloco de 265px: é o ITEM_BASE (que já é `w-[265px]`) que ele
    // veste — nenhuma largura própria, nenhum raio, nenhuma barrinha
    expect(rail).toMatch(/\$\{ativo \? ITEM_ATIVO : ITEM_INERTE\}/)
    expect(rail).not.toMatch(/ITEM_ATIVO =[^\n]*(rounded|w-)/)
    expect(rail).not.toMatch(/w-0\.5/)
  })

  /* ---- LOTE 10: a letra, onde ela é vestida ------------------------------ */

  // O dono aprovou o MECANISMO do trilho e reprovou a LETRA. A sidebar do
  // TutorBird é peça Material: Roboto 16/400 com +0.496px de spacing — não a
  // Inter 16/500 que estava aqui.
  it('o trilho inteiro fala na voz da navegação — itens, pé e wordmark', () => {
    const rail = railDoAdmin()
    // a linha (que serve item de rota E o item do pé) nasce com a voz
    expect(rail).toMatch(/const ITEM_BASE = `nav-tb flex /)
    expect(rail).not.toMatch(/ITEM_BASE = [^\n]*text-base font-medium/)
    // wordmark: mesma família, único peso próprio do trilho (600)
    expect(rail).toMatch(/className="nav-tb nav-tb-strong[^"]*">\{MARCA\.escola\}/)
    expect(rail).not.toMatch(/text-base font-bold[^"]*>\{MARCA\.escola\}/)
  })

  it('o título da barra superior veste a régua de título de PÁGINA', () => {
    // sem comentários: o comentário do componente CITA a régua velha
    // justamente para contar que ela morreu
    const topo = corpo('src/components/admin/AdminNavClient.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const barra = topo.slice(topo.indexOf('export function AdminTopBar'))
    expect(barra).toMatch(/<h2 className="title-page/)
    // era 18/600 com tracking normal — dois degraus abaixo do medido
    expect(barra).not.toContain('text-lg font-semibold')
  })

  it('os títulos de seção das telas novas usam a MESMA régua', () => {
    for (const rel of [
      'src/components/admin/inicio/AndarHoje.tsx',
      'src/components/admin/inicio/AndarNegocio.tsx',
      'src/components/kit/card-panel.tsx',
      'src/components/kit/empty-state.tsx',
    ]) {
      expect(corpo(rel), rel).toContain('title-section')
      // nenhum deles pode ter sobrado com a régua velha do mesmo elemento
      expect(corpo(rel), rel).not.toContain('text-lg font-bold text-ink-900')
      expect(corpo(rel), rel).not.toContain('text-xl font-semibold text-ink-900')
    }
    // a saudação da banda NÃO é título de página (esse mora na barra): ela
    // herda só o tracking, e mantém tamanho e peso próprios
    const banda = corpo('src/components/admin/inicio/BandaDeTopo.tsx')
    expect(banda).toContain('tracking-title')
    expect(banda).not.toContain('title-page')
  })

  // O menu suspenso é peça MATERIAL (Roboto 14/400); o corpo do botão é AÇÃO
  // (Inter 600/14, via `.btn-ac`). O split-button tem as duas naturezas dentro
  // de si — e é o componente que o M3 vai multiplicar.
  it('o dropdown do split-button fala Roboto; o botão continua Inter', () => {
    const split = corpo('src/components/kit/split-button.tsx')
    expect(split).toContain('nav-tb-item')
    expect(split).toContain('className="btn-ac split-ac-main"')
    // o rótulo do item de menu perdeu o peso: quem separa rótulo de dica é a COR
    expect(split).not.toContain('text-sm font-medium text-ink-900')
  })

  // M3-c1 · C1: UM bloco, não dois. A fusão tem de vir de CLASSE — `.btn-ac` é
  // unlayered e engole utility, que era exatamente o bug (as `rounded-r-none`,
  // `border-l border-white/25` e `px-2` do componente nunca chegaram a pintar).
  it('o botão dividido é um bloco só: raio nas pontas, fio interno, seta ≥36px', () => {
    // sem comentários: eles CITAM as utilities mortas justamente para contar
    // que morreram — o que vale é o código
    const split = corpo('src/components/kit/split-button.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // nada de fusão por utility (é o que não funcionava)
    expect(split).not.toContain('rounded-r-none')
    expect(split).not.toContain('rounded-l-none')
    expect(split).not.toContain('border-white/25')
    expect(split).toContain("cn('split-ac', className)")
    expect(split).toContain('className="btn-ac split-ac-arrow"')

    // …e a anatomia mora no CSS, com especificidade que vence `.btn-ac`
    const main = CSS_LIMPO.match(/\.btn-ac\.split-ac-main \{([^}]*)\}/)?.[1] ?? ''
    const seta = CSS_LIMPO.match(/\.btn-ac\.split-ac-arrow \{([^}]*)\}/)?.[1] ?? ''
    expect(main).toContain('border-top-right-radius: 0')
    expect(main).toContain('border-bottom-right-radius: 0')
    expect(seta).toContain('border-top-left-radius: 0')
    expect(seta).toContain('border-bottom-left-radius: 0')
    // o fio é o PRÓPRIO acento escurecido, nunca branco translúcido
    expect(seta).toContain('border-left-color: var(--ac-deep-hover)')
    // alvo de toque da seta
    expect(seta).toContain('min-width: 36px')
    // e o container não abre fresta: encosta as duas metades
    expect(CSS_LIMPO).toMatch(/\.split-ac \{[^}]*display: inline-flex;[^}]*\}/)
    expect(CSS_LIMPO.match(/\.split-ac \{([^}]*)\}/)?.[1] ?? '').not.toContain('gap')

    // foco por METADE, e para DENTRO (o outline universal tem offset +2px e
    // desenharia por fora, invadindo a metade vizinha)
    const foco =
      CSS_LIMPO.match(
        /\.btn-ac\.split-ac-main:focus-visible,\s*\.btn-ac\.split-ac-arrow:focus-visible \{([^}]*)\}/,
      )?.[1] ?? ''
    expect(foco).toContain('outline-offset: -3px')
    expect(foco).toContain('var(--paper-0)')
  })

  // A regra universal de reduced-motion zera DURAÇÃO, não ATRASO: sem este
  // bloco o trilho ficaria 100ms pendurado depois de o mouse sair.
  it('reduced-motion mata a animação de largura e a cortesia', () => {
    const bloco =
      CSS_LIMPO.match(
        /@media \(prefers-reduced-motion: reduce\) \{\s*\.rail,\s*\.rail:hover,\s*\.rail:has\(:focus-visible\) \{([^}]*)\}/,
      )?.[1] ?? ''
    expect(bloco).toContain('transition: none')
  })

  // Ponteiro grosso em tela larga (tablet, laptop com toque): `:hover` vira
  // estado PRESO e o trilho ficaria aberto por cima do conteúdo sem ninguém
  // pedir. Lá ele é aberto FIXO, e o espaçador acompanha pela mesma variável.
  it('em ponteiro grosso o trilho é aberto fixo, com o espaçador junto', () => {
    const bloco =
      CSS_LIMPO.match(/@media \(min-width: 768px\) and \(hover: none\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(bloco).toContain('--rail-w-spacer: var(--rail-w-open)')
    expect(bloco).toMatch(
      /\.rail,\s*\.rail:hover,\s*\.rail:has\(:focus-visible\) \{[\s\S]*?width: var\(--rail-w-open\)/,
    )
    // sem transição: não há gesto de abrir/fechar para animar
    expect(bloco).toMatch(/\.rail,[\s\S]*?transition: none/)
    // e o espaçador padrão continua sendo a largura de repouso
    expect(CSS_LIMPO).toContain('--rail-w-spacer: var(--rail-w-rest)')
  })

  // O trilho é OVERLAY: em repouso ele ocupa 64px de fluxo por um espaçador, e
  // ao abrir passa por cima do conteúdo E da barra superior (z-40 × z-30). A
  // página não pode refluir.
  it('o trilho é overlay e a página não reflui', () => {
    const rail = railDoAdmin()
    // Espaçador em fluxo com a largura de repouso — que agora é uma VARIÁVEL
    // (revisão nº 5 do Sol): em ponteiro grosso o trilho fica aberto fixo e o
    // espaçador tem de acompanhar, senão o menu cobre o conteúdo para sempre.
    expect(rail).toMatch(/<div aria-hidden className="hidden w-\(--rail-w-spacer\) shrink-0 md:block" \/>/)
    // e a moldura de espera do shell reserva exatamente a mesma largura
    expect(corpo('src/components/admin/AdminShell.tsx')).toContain('w-(--rail-w-spacer)')
    // a nav é fixa e sobe acima da barra superior
    expect(rail).toContain('rail fixed inset-y-0 left-0 z-40')
    const topo = corpo('src/components/admin/AdminNavClient.tsx')
    expect(topo.slice(topo.indexOf('export function AdminTopBar'))).toContain('sticky top-0 z-30')
  })

  // O fio-assinatura de degradê saiu do admin (a barra branca não convive com
  // ele); segue vivo nos e-mails e no portal, que não mudaram.
  it('o fio-assinatura não é mais renderizado no admin', () => {
    const layout = corpo('src/app/admin/layout.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(layout).not.toContain('brand-thread')
    const sheet = corpo('src/components/kit/sheet.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(sheet).not.toContain('brand-thread')
  })

  // Painel lateral: rodapé fixo, expandir para tela cheia, ~metade da tela no
  // desktop e tela cheia no celular (anatomia medida no TutorBird).
  it('o painel lateral tem rodapé fixo, expandir e a largura medida', () => {
    const sheet = corpo('src/components/kit/sheet.tsx')
    expect(sheet).toContain('md:w-[min(800px,60vw)]')
    expect(sheet).toContain('SheetFooter')
    expect(sheet).toContain('SheetSection')
    expect(sheet).toContain('Expandir para tela cheia')
    // e quem usa o painel hoje já veste o rodapé do kit
    expect(corpo('src/components/admin/inicio/RegistrarDesfecho.tsx')).toContain('<SheetFooter')
  })

  // Aba ativa = sublinhado no acento + texto no acento (nunca pílula).
  it('o card-contêiner marca a aba ativa com sublinhado no acento', () => {
    const painel = corpo('src/components/kit/card-panel.tsx')
    expect(painel).toContain('border-ac-deep')
    expect(painel).toContain('text-ac-deep')
    expect(painel).toContain('panel-tb')
  })

  // Estado vazio completo: ilustração + título + frase + CTA repetido.
  it('os dois estados vazios do Início são completos, com ilustração', () => {
    const hoje = corpo('src/components/admin/inicio/AndarHoje.tsx')
    expect(hoje).toContain('/illustrations/agenda-vazia.svg')
    expect(hoje).toContain('/illustrations/tudo-em-dia.svg')
    const vazio = corpo('src/components/kit/empty-state.tsx')
    expect(vazio).toContain('illustration')
    expect(vazio).toContain('btn-ac')
  })

  it('a ação nova não redireciona com mensagem na URL', () => {
    const acoes = corpo('src/data/admin/actions.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(acoes).not.toContain('redirect(')
    expect(acoes).toContain('revalidatePath')
  })
})
