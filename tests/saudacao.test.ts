import { describe, expect, it } from 'vitest'
import { nomeParaSaudacao, saudacaoPara } from '../src/lib/saudacao.ts'

describe('saudação pela hora local', () => {
  it('madrugada NÃO é "Bom dia" — o bug da varredura de 22/07', () => {
    expect(saudacaoPara(0)).toBe('Boa noite')
    expect(saudacaoPara(4)).toBe('Boa noite')
  })

  it('as três faixas normais', () => {
    expect(saudacaoPara(5)).toBe('Bom dia')
    expect(saudacaoPara(11)).toBe('Bom dia')
    expect(saudacaoPara(12)).toBe('Boa tarde')
    expect(saudacaoPara(17)).toBe('Boa tarde')
    expect(saudacaoPara(18)).toBe('Boa noite')
    expect(saudacaoPara(23)).toBe('Boa noite')
  })

  it('cobre as 24 horas sem buraco', () => {
    for (let h = 0; h < 24; h++) {
      expect(['Bom dia', 'Boa tarde', 'Boa noite']).toContain(saudacaoPara(h))
    }
  })
})

describe('nome na saudação do admin', () => {
  it('o primeiro nome do perfil vence qualquer config', () => {
    expect(nomeParaSaudacao('Helena Souza', { SCHOOL_OWNER_NAME: 'Outra' })).toBe('Helena')
  })

  it('sem nome no perfil e sem env: o padrão neutro "Professora"', () => {
    expect(nomeParaSaudacao(null, {})).toBe('Professora')
    expect(nomeParaSaudacao('', {})).toBe('Professora')
    expect(nomeParaSaudacao(undefined, { SCHOOL_OWNER_NAME: '  ' })).toBe('Professora')
  })

  it('sem nome no perfil e com SCHOOL_OWNER_NAME: o valor da env', () => {
    expect(nomeParaSaudacao(null, { SCHOOL_OWNER_NAME: 'Helena' })).toBe('Helena')
  })
})
