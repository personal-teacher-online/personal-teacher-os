// @vitest-environment jsdom
//
// HOTFIX 28/07/2026 — TODO TOQUE NA LISTA DE ALUNOS ABRIA O ÚLTIMO ALUNO (iOS).
//
// O DEFEITO, em uma frase de negócio: no iPhone da dona, tocar em qualquer
// linha da lista de Alunos abria sempre a ficha do ÚLTIMO aluno da página.
//
// O MECANISMO. A linha da `DataTable` é um `<a>` real na 1ª célula, ampliado
// até as bordas da linha por `after:absolute after:inset-0`. Elemento absoluto
// se mede pelo ancestral POSICIONADO mais próximo, e o único candidato era o
// `position: relative` da `<tr>` — que a CSS 2.1 §9.4.3 declara INDEFINIDO para
// `table-row`. Blink e Gecko honram; o WebKit/Safari (iOS) não. Sem bloco
// contido na linha, as capas de TODAS as linhas passam a se medir pelo painel
// inteiro, empilhadas umas sobre as outras — e a última da ordem do DOM fica
// por cima, engolindo o toque de todo mundo.
//
// A CORREÇÃO é a classe `.linha-ancora` (globals.css): `transform: translate(0)`
// na linha. `transform` é o ÚNICO mecanismo que o padrão garante em `table-row`
// (css-transforms-1: qualquer valor != `none` estabelece bloco contido para os
// descendentes absolutos) — ao contrário do `position: relative`, não é
// comportamento indefinido.
//
// POR QUE ESTE TESTE NÃO REPRODUZ O BUG. O jsdom não faz layout nem pinta: não
// existe "quem está por cima" para medir, e mesmo um navegador de verdade não
// serviria — o defeito é do WebKit, e o e2e da casa roda em chromium, onde o
// `relative` na `<tr>` sempre funcionou (ou seja: o bug de produção passava
// VERDE em toda a suíte). O que este arquivo trava, então, é a SOLUÇÃO: a linha
// com capa carrega `.linha-ancora`, e `.linha-ancora` declara um `transform`
// diferente de `none`. Tirar qualquer uma das duas pontas fica vermelho aqui —
// que é o mais perto de um alarme que se consegue sem um iPhone na bancada.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { DataTable } from '@/components/kit/data-table'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A classe é o contrato: o mesmo literal tem de existir no DOM e no CSS. */
const CLASSE = 'linha-ancora'
const RAIZ = path.resolve(__dirname, '..')

const arquivo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')

interface Aluno {
  id: string
  nome: string
}
const ALUNOS: Aluno[] = [
  { id: 'a1', nome: 'Primeira' },
  { id: 'a2', nome: 'Segunda' },
  { id: 'a3', nome: 'Última' },
]

let container: HTMLDivElement
let root: Root

async function montar(comLink: boolean): Promise<HTMLTableRowElement[]> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      h(DataTable<Aluno>, {
        linhas: ALUNOS,
        chaveDaLinha: (l) => l.id,
        legenda: 'Alunos',
        colunas: [{ id: 'nome', cabecalho: 'Aluno', celula: (l) => l.nome }],
        ...(comLink
          ? {
              hrefDaLinha: (l: Aluno) => `/admin/alunos/${l.id}`,
              rotuloDaLinha: (l: Aluno) => l.nome,
              acoesDaLinha: () => [{ rotulo: 'Abrir ficha', href: '/x' }],
            }
          : {}),
      }),
    )
  })
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')]
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
})

describe('a capa do link se mede pela LINHA, também no Safari (iOS)', () => {
  it('toda linha com capa carrega `.linha-ancora` — inclusive a última', async () => {
    const linhas = await montar(true)
    expect(linhas).toHaveLength(ALUNOS.length)
    for (const [i, tr] of linhas.entries()) {
      expect(
        tr.classList.contains(CLASSE),
        `linha ${i} sem bloco contido: no iOS a capa dela vazaria para o painel`,
      ).toBe(true)
    }
  })

  it('a capa e o link vivem DENTRO da linha que carrega o bloco contido', async () => {
    const linhas = await montar(true)
    for (const [i, tr] of linhas.entries()) {
      const a = tr.querySelector('a[class*="after:inset-0"]')
      expect(a, `linha ${i} perdeu a âncora ampliada`).not.toBeNull()
      // a capa é do LINK, e o link é descendente DESTA linha — é essa cadeia
      // (capa → linha posicionada) que o Safari quebrava
      expect(a?.className).toContain('after:absolute after:inset-0')
      expect(tr.contains(a as Node)).toBe(true)
      expect(a?.getAttribute('href')).toBe(`/admin/alunos/${ALUNOS[i].id}`)
    }
  })

  it('cada linha aponta para o SEU aluno (o sintoma era todas caírem na última)', async () => {
    const linhas = await montar(true)
    const destinos = linhas.map((tr) => tr.querySelector('a')?.getAttribute('href'))
    expect(destinos).toEqual(ALUNOS.map((l) => `/admin/alunos/${l.id}`))
    expect(new Set(destinos).size, 'três linhas, três destinos distintos').toBe(3)
  })

  it('a célula do kebab continua ACIMA da capa (o menu não pode ficar inalcançável)', async () => {
    const linhas = await montar(true)
    for (const tr of linhas) {
      const acao = tr.querySelector('td:last-child')
      expect(acao?.className).toContain('relative')
      expect(acao?.className).toContain('z-10')
      expect(acao?.querySelector('button')).not.toBeNull()
    }
  })

  it('linha SEM link não ganha contexto de empilhamento à toa', async () => {
    const linhas = await montar(false)
    for (const tr of linhas) {
      expect(tr.querySelector('a')).toBeNull()
      expect(
        tr.classList.contains(CLASSE),
        'sem capa não há o que conter — a classe só existe por causa da capa',
      ).toBe(false)
    }
  })
})

describe('a outra ponta do contrato: o que `.linha-ancora` declara', () => {
  /** O bloco da regra, sem os comentários que a explicam. */
  function regraDaLinhaAncora(): string {
    const css = arquivo('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const m = css.match(new RegExp(`\\.${CLASSE}\\s*\\{([^}]*)\\}`))
    expect(m, `a regra .${CLASSE} sumiu do globals.css`).not.toBeNull()
    return (m as RegExpMatchArray)[1]
  }

  it('declara um `transform` diferente de `none` — é ELE que cria o bloco contido', () => {
    const regra = regraDaLinhaAncora()
    const t = regra.match(/transform\s*:\s*([^;]+);/)
    expect(t, 'sem transform a classe não conserta nada no WebKit').not.toBeNull()
    expect((t as RegExpMatchArray)[1].trim()).not.toBe('none')
  })

  it('não apara o anel de foco: nada de `clip-path`/`overflow` na linha', () => {
    // `clip-path: inset(0)` também criaria o bloco contido, mas o foco do link
    // pinta FORA da linha (`outline-offset-2`) e seria cortado — o teclado
    // pagaria a conta do toque.
    const regra = regraDaLinhaAncora()
    expect(regra).not.toMatch(/clip-path\s*:/)
    expect(regra).not.toMatch(/overflow\s*:/)
  })
})

describe('varredura: quem mais estica âncora por pseudo-elemento', () => {
  function tsxDoRepo(dir: string, achados: string[] = []): string[] {
    for (const e of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) tsxDoRepo(rel, achados)
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) achados.push(rel)
    }
    return achados
  }

  it('a capa `after:absolute after:inset-0` só existe na DataTable', () => {
    // Guarda de raiz: qualquer superfície nova que esticar uma âncora por
    // pseudo-elemento cai aqui e é obrigada a decidir de quem é o bloco contido
    // — que é exatamente a decisão que faltou e quebrou o iPhone.
    const donos = tsxDoRepo('src').filter((rel) => /after:absolute[\s\S]{0,40}after:inset-0/.test(arquivo(rel)))
    expect(donos).toEqual(['src/components/kit/data-table.tsx'])
  })
})
