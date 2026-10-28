// O helper da lista local de nomes segue a convenção do scanner `scripts/vazamento.py`:
// termo e literal liberado ("Teacher Vicky", em scripts/vazamento-excecoes.txt) casam sem
// acento, sem caixa e com espaço, `.`, `_` ou `-` entre as palavras.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nomesNoTexto, termosProibidos } from './helpers/nomes-proibidos'

// O termo é a outra palavra da marca liberada ("Vicky" sozinho também é exceção desde
// 28/10/2026, issue #50): dentro do literal some, fora dele é achado.
const MARCA = 'Teacher Vicky'
const TERMO = MARCA.split(' ')[0]

const ARQUIVO = path.resolve(__dirname, '..', 'scripts', 'vazamento-nomes.txt')

describe('nomesNoTexto', () => {
  it('a marca liberada some em qualquer caixa e separador', () => {
    const variantes = [MARCA, MARCA.toLowerCase(), MARCA.toUpperCase().replace(' ', '_'), MARCA.replace(' ', '.'), MARCA.replace(' ', '-')]
    for (const texto of variantes) {
      expect(nomesNoTexto(`aula com a ${texto} amanhã`, [TERMO]), texto).toEqual([])
    }
  })

  it('o termo sozinho, fora da marca, é achado', () => {
    expect(nomesNoTexto(`o ${TERMO.toLowerCase()} confirma`, [TERMO])).toEqual([TERMO])
  })

  it('termo de duas palavras casa sem acento, sem caixa e com separador', () => {
    expect(nomesNoTexto('pagador: JOAO_DA-silva', ['João da Silva'])).toEqual(['João da Silva'])
    expect(nomesNoTexto('joaozinho', ['João'])).toEqual([])
  })
})

// Termos inventados só para o teste; a lista local (se existir na máquina) soma com eles.
describe('termosProibidos', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('soma os termos de PT_NOMES_PROIBIDOS (um por linha, # comenta) à lista local', () => {
    vi.stubEnv('PT_NOMES_PROIBIDOS', '# nomes\nZelda Exemplar\n\nOutro Termo # fim\n-\n')
    const termos = termosProibidos()
    expect(termos).toContain('Zelda Exemplar')
    expect(termos).toContain('Outro Termo')
    expect(termos).not.toContain('-')
    expect(nomesNoTexto('assinado por zelda_exemplar', termos!)).toEqual(['Zelda Exemplar'])
  })

  // Nunca encosta numa lista real: onde `scripts/vazamento-nomes.txt` já existe (pasta do dono) o caso é pulado;
  // na CI e nas worktrees ele cria o arquivo e o apaga em seguida.
  it.skipIf(existsSync(ARQUIVO))('a variável SOMA com o arquivo local, não o substitui', () => {
    try {
      writeFileSync(ARQUIVO, 'Termo Doarquivo\n')
      vi.stubEnv('PT_NOMES_PROIBIDOS', 'Zelda Exemplar\n')
      const termos = termosProibidos()
      expect(termos).toContain('Termo Doarquivo')
      expect(termos).toContain('Zelda Exemplar')
    } finally {
      rmSync(ARQUIVO, { force: true })
    }
  })

  it('variável vazia ou só de comentário não quebra e não vira termo', () => {
    vi.stubEnv('PT_NOMES_PROIBIDOS', '')
    const sem = termosProibidos()
    vi.stubEnv('PT_NOMES_PROIBIDOS', '# só comentário\n')
    expect(termosProibidos()).toEqual(sem)
  })
})
