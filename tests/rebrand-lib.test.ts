// Régua do rebrand em src/lib (#62): o nome da escola é "Personal Teacher
// Academy". Exceções: o Form original do briefing (transcrição literal de
// 19/07/2026), a cobrança avulsa do Asaas (muda no religamento do Asaas,
// runbook §N.3), nomes de arquivo de logo em disco e comentários históricos.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = join(__dirname, '..', 'src', 'lib')
const ARQUIVOS_EXCETO = new Set(['briefing/schema.ts', 'asaas/emissao.ts', 'slides/template.ts'])

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

function linhas() {
  return arquivos(RAIZ).flatMap((p) => {
    const rel = relative(RAIZ, p).replaceAll('\\', '/')
    return readFileSync(p, 'utf8')
      .split('\n')
      .map((texto, i) => ({ rel, n: i + 1, texto }))
  })
}

describe('rebrand em src/lib', () => {
  it('nenhuma linha usa "Personal Teacher Online"', () => {
    const achados = linhas().filter((l) => l.texto.includes('Personal Teacher Online'))
    expect(achados.map((l) => `${l.rel}:${l.n}`)).toEqual([])
  })

  it('"Personal Teacher" só aparece como Academy, OS ou nas exceções', () => {
    const achados = linhas().filter(
      (l) =>
        !ARQUIVOS_EXCETO.has(l.rel) &&
        !l.texto.trim().startsWith('//') &&
        /Personal Teacher(?! Academy| OS)/.test(l.texto),
    )
    expect(achados.map((l) => `${l.rel}:${l.n}: ${l.texto.trim()}`)).toEqual([])
  })
})
