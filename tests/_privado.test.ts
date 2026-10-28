import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { criarAvisador, resolverPrivado } from './_privado'

const criadas: string[] = []
const vazia = () => {
  const d = mkdtempSync(join(tmpdir(), 'privado-'))
  criadas.push(d)
  return d
}
afterAll(() => {
  for (const d of criadas) rmSync(d, { recursive: true, force: true })
})

describe('insumo privado dos testes de slides', () => {
  it('sem as pastas (nem por env, nem no repositório): presente=false e o aviso diz variável e pasta', () => {
    const r = resolverPrivado(vazia(), {
      PT_CONTENT_DIR: '/caminho/inexistente',
      PT_BRAND_DIR: '/caminho/inexistente',
    })
    expect(r.presente).toBe(false)
    expect(r.avisos.join(' ')).toContain('PT_CONTENT_DIR')
    expect(r.avisos.join(' ')).toContain('PT_BRAND_DIR')
  })

  it('só uma pasta faltando: presente=false e o aviso nomeia apenas a que falta', () => {
    const raiz = vazia()
    mkdirSync(join(raiz, 'content', 'personal-travel'), { recursive: true })
    const r = resolverPrivado(raiz, { PT_BRAND_DIR: '/caminho/inexistente' })
    expect(r.presente).toBe(false)
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toContain('PT_BRAND_DIR')
  })

  it('com as pastas no repositório: presente=true e os caminhos são os do motor', () => {
    const raiz = vazia()
    mkdirSync(join(raiz, 'content', 'personal-travel'), { recursive: true })
    mkdirSync(join(raiz, 'brand', 'logos'), { recursive: true })
    const r = resolverPrivado(raiz, {})
    expect(r).toMatchObject({
      presente: true,
      content: join(raiz, 'content'),
      brand: join(raiz, 'brand'),
      avisos: [],
    })
  })

  it('o aviso sai UMA vez, e só quando falta insumo', () => {
    const ausente = resolverPrivado(vazia(), { PT_BRAND_DIR: '/nada', PT_CONTENT_DIR: '/nada' })
    const linhas: string[] = []
    const avisar = criarAvisador((m) => linhas.push(m))
    expect(avisar(ausente)).toBe(true)
    expect(avisar(ausente)).toBe(false)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toContain('PT_BRAND_DIR')

    const raiz = vazia()
    mkdirSync(join(raiz, 'content', 'personal-travel'), { recursive: true })
    mkdirSync(join(raiz, 'brand', 'logos'), { recursive: true })
    const semAviso: string[] = []
    expect(criarAvisador((m) => semAviso.push(m))(resolverPrivado(raiz, {}))).toBe(false)
    expect(semAviso).toEqual([])
  })
})
