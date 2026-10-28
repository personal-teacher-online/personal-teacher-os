// Pastas de marca e de conteúdo por config (plano do repositório público, 1a).
// Teste puro: monta uma raiz de mentira no tmp e injeta env/raiz, sem tocar no
// process.env nem na pasta real do repositório. No fim, prova que o template de
// slides e a biblioteca de fotos de fato leem a pasta que a config manda.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { pastaDeConteudo, pastaDeMarca } from '@/lib/pastas'

let base: string
const dir = (...partes: string[]) => {
  const p = path.join(base, ...partes)
  mkdirSync(p, { recursive: true })
  return p
}

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'pt-pastas-'))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('pastaDeMarca / pastaDeConteudo', () => {
  it('sem env e com a pasta dentro do repositório: resolve para ela (nada muda hoje)', () => {
    const raiz = dir('a', 'personal-teacher-os')
    dir('a', 'personal-teacher-os', 'brand', 'logos')
    dir('a', 'personal-teacher-os', 'content', 'personal-travel')
    expect(pastaDeMarca(raiz, {})).toBe(path.join(raiz, 'brand'))
    expect(pastaDeConteudo(raiz, {})).toBe(path.join(raiz, 'content'))
  })

  it('env preenchida e válida manda mais que a pasta do repositório', () => {
    const raiz = dir('b', 'personal-teacher-os')
    dir('b', 'personal-teacher-os', 'brand', 'logos')
    const outra = dir('b', 'outra-marca', 'logos')
    expect(pastaDeMarca(raiz, { PT_BRAND_DIR: path.dirname(outra) })).toBe(path.dirname(outra))
  })

  it('env apontando para pasta inexistente FALHA dizendo qual caminho faltou', () => {
    const raiz = dir('c', 'personal-teacher-os')
    const vazio = path.join(base, 'c', 'nao-existe')
    expect(() => pastaDeMarca(raiz, { PT_BRAND_DIR: vazio })).toThrow(
      `pasta de marca não encontrada em ${vazio}`,
    )
    expect(() => pastaDeConteudo(raiz, { PT_CONTENT_DIR: vazio })).toThrow(
      `pasta de conteúdo não encontrada em ${vazio}`,
    )
  })

  it('env apontando para pasta que EXISTE mas está vazia também falha com a mesma mensagem', () => {
    const raiz = dir('d', 'personal-teacher-os')
    const vazia = dir('d', 'vazia')
    expect(() => pastaDeMarca(raiz, { PT_BRAND_DIR: vazia })).toThrow(
      `pasta de marca não encontrada em ${vazia}`,
    )
  })

  it('env em branco vale como ausente', () => {
    const raiz = dir('e', 'personal-teacher-os')
    dir('e', 'personal-teacher-os', 'brand', 'logos')
    expect(pastaDeMarca(raiz, { PT_BRAND_DIR: '  ' })).toBe(path.join(raiz, 'brand'))
  })

  it('sem env e sem a pasta no repositório: cai no repositório privado vizinho', () => {
    const raiz = dir('f', 'personal-teacher-os')
    dir('f', 'personal-teacher-os', '.git')
    const marca = dir('f', 'personal-teacher-os-privado', 'brand', 'logos')
    const conteudo = dir('f', 'personal-teacher-os-privado', 'content', 'personal-travel')
    expect(pastaDeMarca(raiz, {})).toBe(path.dirname(marca))
    expect(pastaDeConteudo(raiz, {})).toBe(path.dirname(conteudo))
  })

  it('numa worktree, o vizinho é contado a partir do repositório PRINCIPAL', () => {
    const principal = dir('g', 'personal-teacher-os')
    dir('g', 'personal-teacher-os', '.git')
    const worktree = dir('g', 'personal-teacher-os', '.claude', 'worktrees', 'agente-x')
    writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/agente-x\n')
    const marca = dir('g', 'personal-teacher-os-privado', 'brand', 'logos')
    expect(principal).toContain('personal-teacher-os')
    expect(pastaDeMarca(worktree, {})).toBe(path.dirname(marca))
  })

  it('sem env, sem pasta no repositório e sem vizinho: erro claro dizendo onde procurou', () => {
    const raiz = dir('h', 'personal-teacher-os')
    dir('h', 'personal-teacher-os', '.git')
    expect(() => pastaDeMarca(raiz, {})).toThrow(/pasta de marca não encontrada em .*brand nem em .*personal-teacher-os-privado/)
  })

  // Só vale onde as pastas moram dentro do repositório; no público elas não existem.
  const real = path.resolve(__dirname, '..')
  const pastasDentro =
    existsSync(path.join(real, 'brand', 'logos')) && existsSync(path.join(real, 'content', 'personal-travel'))
  it.skipIf(!pastasDentro)('o repositório real resolve para as pastas dele enquanto elas existirem', () => {
    expect(pastaDeMarca(real, {})).toBe(path.join(real, 'brand'))
    expect(pastaDeConteudo(real, {})).toBe(path.join(real, 'content'))
  })
})

describe('o motor de slides lê a pasta que a config manda', () => {
  it('template.ts: LOGO_DIR e ASSETS saem de PT_BRAND_DIR', async () => {
    const marca = dir('i', 'marca')
    dir('i', 'marca', 'logos')
    vi.resetModules()
    vi.stubEnv('PT_BRAND_DIR', marca)
    const template = await import('@/lib/slides/template')
    expect(template.LOGO_DIR).toBe(path.join(marca, 'logos'))
    expect(template.ASSETS).toBe(path.join(marca, 'slides', 'assets'))
    expect(template.LOGO_WHITE.startsWith(path.join(marca, 'logos'))).toBe(true)
  })

  it('template.ts: PT_BRAND_DIR inexistente derruba o import com a mensagem clara', async () => {
    const naoExiste = path.join(base, 'i', 'nao-existe')
    vi.resetModules()
    vi.stubEnv('PT_BRAND_DIR', naoExiste)
    await expect(import('@/lib/slides/template')).rejects.toThrow(
      `pasta de marca não encontrada em ${naoExiste}`,
    )
  })

  it('biblioteca de fotos (resolve.ts) também sai de PT_BRAND_DIR', async () => {
    const marca = dir('j', 'marca')
    dir('j', 'marca', 'logos')
    vi.resetModules()
    vi.stubEnv('PT_BRAND_DIR', marca)
    const resolve = await import('@/lib/images/resolve')
    expect(resolve.RAIZ_DISCO).toBe(path.join(marca, 'slides', 'library'))
  })
})
