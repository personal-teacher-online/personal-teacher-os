import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVEDOR_PADRAO, provedorDeImagem, provedoresDeImagem } from '../src/lib/images/registry.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('registro de provedores de imagem', () => {
  it('o padrão é o Gemini — o motor das fotos que já estão no curso', () => {
    expect(PROVEDOR_PADRAO).toBe('gemini')
    expect(provedorDeImagem()?.name).toBe('gemini')
  })

  it('a Higgsfield continua plugável', () => {
    expect(provedorDeImagem('higgsfield')?.name).toBe('higgsfield')
  })

  it('nome desconhecido devolve null — não cai calado no padrão', () => {
    expect(provedorDeImagem('midjourney')).toBeNull()
  })

  // Omitir o provedor sem credencial daria "provedor desconhecido" na tela, e a
  // professora iria caçar o problema errado. Ele existe e falha dizendo o que falta.
  it('provedor SEM credencial existe e falha com a mensagem certa', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const p = provedoresDeImagem().gemini
    expect(p).toBeTruthy()
    expect(await p.start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'GEMINI_API_KEY ausente no ambiente',
    })
  })
})
