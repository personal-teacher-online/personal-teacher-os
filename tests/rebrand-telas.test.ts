// REBRAND DAS TELAS — a escola se chama "Personal Teacher Academy" (decisão do
// dono, 27/10/2026), sempre na forma completa: título de aba, cabeçalho, alt.
//
// Não mudam: "Personal Teacher OS" (o software), o domínio e o e-mail
// (`personal-teacher.com`, com hífen) e "Teacher Vicky".
//
// A régua varre a FONTE de `src/app` e `src/components` (no molde do varredor
// de `acl-higiene.test.ts`): qualquer "Personal Teacher" que não seja seguido de
// " Academy" ou " OS" derruba a suíte. Nome de escola novo escrito na mão, sem
// passar por `MARCA.escola`, não volta sem que este teste acuse.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { MARCA } from '@/lib/brand/constants'

const raiz = path.resolve(__dirname, '..')

/** Todos os arquivos de texto sob `pasta`, com caminho relativo à raiz do repo. */
function arquivosDe(pasta: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(path.join(raiz, pasta), { withFileTypes: true })) {
    const relativo = path.join(pasta, entrada.name)
    if (entrada.isDirectory()) achados.push(...arquivosDe(relativo))
    else if (/\.(tsx?|css|mdx?)$/.test(entrada.name)) achados.push(relativo)
  }
  return achados
}

const FONTES = [...arquivosDe('src/app'), ...arquivosDe('src/components')]

/** Linhas (arquivo:linha) em que `padrao` casa. */
function ocorrencias(padrao: RegExp): string[] {
  const linhas: string[] = []
  for (const arquivo of FONTES) {
    readFileSync(path.join(raiz, arquivo), 'utf8')
      .split('\n')
      .forEach((texto, i) => {
        if (padrao.test(texto)) linhas.push(`${arquivo}:${i + 1}: ${texto.trim()}`)
      })
  }
  return linhas
}

/** O `title` literal da metadata de uma página (ou `undefined` se não houver). */
function tituloDe(arquivo: string): string | undefined {
  const fonte = readFileSync(path.join(raiz, arquivo), 'utf8')
  return /export const metadata\b[^=]*=\s*\{\s*title:\s*(['"`])([^\n]*?)\1/.exec(fonte)?.[2]
}

describe('rebrand — Personal Teacher Academy', () => {
  it('a constante MARCA.escola é o nome completo', () => {
    expect(MARCA.escola).toBe('Personal Teacher Academy')
  })

  it('varre as fontes (a régua não passa por falta de arquivo)', () => {
    expect(FONTES.length).toBeGreaterThan(100)
  })

  it('nenhuma tela ou componente diz "Personal Teacher Online"', () => {
    expect(ocorrencias(/Personal Teacher Online/)).toEqual([])
  })

  it('todo "Personal Teacher" é seguido de " Academy" ou " OS"', () => {
    expect(ocorrencias(/Personal Teacher(?! Academy| OS)/)).toEqual([])
  })

  // Rotas que o aceite da issue nomeia.
  const ROTAS: Array<[rota: string, arquivo: string, titulo: string]> = [
    ['/login', 'src/app/login/page.tsx', 'Entrar — Personal Teacher Academy'],
    ['/recuperar-senha', 'src/app/recuperar-senha/page.tsx', 'Recuperar senha — Personal Teacher Academy'],
    ['/definir-senha', 'src/app/definir-senha/page.tsx', 'Criar senha — Personal Teacher Academy'],
    ['/convite-expirado', 'src/app/convite-expirado/page.tsx', 'Link expirado — Personal Teacher Academy'],
    ['/teacher', 'src/app/teacher/page.tsx', 'Painel da professora — Personal Teacher Academy'],
    ['/sales', 'src/app/sales/page.tsx', 'Vendas — Personal Teacher Academy'],
    ['/portal', 'src/app/portal/page.tsx', 'Portal — Personal Teacher Academy'],
  ]
  for (const [rota, arquivo, titulo] of ROTAS) {
    it(`${rota}: título da aba "${titulo}"`, () => {
      expect(tituloDe(arquivo)).toBe(titulo)
    })
  }

  it('toda página do portal tem título que termina em "— Personal Teacher Academy"', () => {
    const paginas = arquivosDe('src/app/portal').filter((f) => f.endsWith(`${path.sep}page.tsx`))
    expect(paginas.length).toBeGreaterThanOrEqual(13)
    for (const pagina of paginas) {
      expect(tituloDe(pagina), pagina).toMatch(/ — Personal Teacher Academy$/)
    }
  })

  it('o logo do login e da recuperação de senha tem alt com o nome completo', () => {
    for (const arquivo of ['src/app/login/page.tsx', 'src/app/recuperar-senha/page.tsx']) {
      expect(readFileSync(path.join(raiz, arquivo), 'utf8'), arquivo).toContain('alt="Personal Teacher Academy"')
    }
  })

  it('o cabeçalho de /teacher é "<nome> · Painel da professora", com o nome vindo de MARCA.escola', () => {
    const fonte = readFileSync(path.join(raiz, 'src/app/teacher/layout.tsx'), 'utf8')
    expect(fonte).toContain('{MARCA.escola}')
    expect(fonte).toContain('· Painel da professora')
  })

  it('os cabeçalhos de /sales, do trilho do admin (grande e do celular) e da casca do portal usam MARCA.escola', () => {
    const uso = (arquivo: string) =>
      readFileSync(path.join(raiz, arquivo), 'utf8').split('{MARCA.escola}').length - 1
    expect(uso('src/app/sales/page.tsx')).toBe(1)
    expect(uso('src/components/portal/PortalShell.tsx')).toBeGreaterThanOrEqual(1)
    // trilho aberto + barra do celular
    expect(uso('src/components/admin/AdminNavClient.tsx')).toBeGreaterThanOrEqual(2)
  })

  // O rótulo aberto do trilho tem 201px (265 − 64). A 16px o nome completo mede
  // 208,6px (Roboto 700, com letter-spacing) e saía cortado; a 15px mede 195,5px.
  it('o wordmark do trilho do admin fica em 15px para o nome completo caber', () => {
    const css = readFileSync(path.join(raiz, 'src/app/globals.css'), 'utf8')
    const bloco = /\.nav-tb-strong\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(bloco).toMatch(/font-size:\s*15px/)
  })
})
