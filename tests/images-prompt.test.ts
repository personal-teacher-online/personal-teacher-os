import { describe, expect, it } from 'vitest'
import { framingFor, promptFor, sceneFor } from '../src/lib/images/prompt.ts'
import type { SlideSpec } from '../src/lib/slides/lesson-schema.ts'

const capa: SlideSpec = { type: 'cover', title: 'Menu Sem Segredos', subtitle: 'Pedir sem travar' }
const gramatica: SlideSpec = {
  type: 'grammar',
  title: 'Modal Verbs',
  rule: 'Use CAN for ability.',
  examples: ['Can I have a map?'],
}
const dica: SlideSpec = { type: 'tip', title: 'Dica', text: 'Sempre **confirme** o preço antes de pagar' }

describe('sugestão de prompt a partir do slide', () => {
  it('só oferece foto nos tipos que o contrato aceita', () => {
    expect(promptFor(capa)).not.toBeNull()
    expect(promptFor(dica)).not.toBeNull()
    // gramática não tem campo image no lesson-schema — nem oferecer o botão
    expect(promptFor(gramatica)).toBeNull()
    expect(sceneFor(gramatica)).toBeNull()
  })

  it('proíbe texto e mão em close em TODO prompt gerado', () => {
    for (const s of [capa, dica]) {
      const p = promptFor(s) as string
      expect(p).toContain('No text, letters, numbers or logos anywhere')
      expect(p).toContain('No close-up of hands')
    }
  })

  // As quatro alavancas medidas em 22/07 contra o texto inventado dentro da
  // imagem. Sem elas, a mesma cena difícil deu 1 de 4 aproveitáveis; com elas,
  // 4 de 4. Cada uma tem teste próprio para não sumir num refactor de string.
  describe('as alavancas contra texto na imagem', () => {
    it('declara as placas EM BRANCO — a instrução afirmativa é a que funciona', () => {
      for (const s of [capa, dica]) {
        expect(promptFor(s) as string).toContain('blank and unmarked')
      }
    })

    it('pede profundidade de campo rasa — texto desfocado não é texto', () => {
      expect(promptFor(capa) as string).toContain('Shallow depth of field')
    })

    it('a proibição fica no FIM do prompt, onde o modelo pesa mais', () => {
      const p = promptFor(capa) as string
      expect(p.trimEnd().endsWith('No close-up of hands.')).toBe(true)
    })

    it('aproxima o enquadramento onde a cena permite', () => {
      expect(sceneFor(capa) as string).toContain('framed close')
      const dialogo: SlideSpec = { type: 'dialogue', title: 'At the counter', lines: [] } as SlideSpec
      expect(sceneFor(dialogo) as string).toContain('framed close')
    })

    it('o warmup deixou de pedir plano ABERTO — enchia o quadro de placa', () => {
      const aquecimento: SlideSpec = {
        type: 'warmup',
        prompt: 'a busy train station',
      } as SlideSpec
      const cena = sceneFor(aquecimento) as string
      expect(cena).not.toContain('wide')
      expect(cena).toContain('establishing scene')
    })
  })

  it('nunca pede a paleta da marca — regra revogada em 22/07', () => {
    const p = (promptFor(capa) as string).toLowerCase()
    for (const proibido of ['purple', 'teal', 'neon', 'brand palette', 'roxo']) {
      expect(p).not.toContain(proibido)
    }
    expect(p).toContain('natural daylight')
  })

  it('tira os marcadores de destaque do texto do slide', () => {
    const cena = sceneFor(dica) as string
    expect(cena).not.toContain('**')
    expect(cena).toContain('confirme o preço')
  })

  it('leva o tema do módulo quando existe', () => {
    expect(sceneFor(capa, 'Time to Eat & Drink')).toContain('Time to Eat & Drink')
    expect(sceneFor(capa)).not.toContain('lesson topic')
  })

  it('enquadra conforme a moldura do template', () => {
    expect(framingFor('cover')).toBe('retrato')
    expect(framingFor('warmup')).toBe('paisagem')
    expect(framingFor('section')).toBe('quadrado')
  })
})

describe('capa sem título', () => {
  it('cai para o subtítulo ou o módulo, e não oferece foto se não houver assunto', () => {
    const semTitulo: SlideSpec = { type: 'cover', subtitle: 'Pedir sem travar' }
    expect(sceneFor(semTitulo)).toContain('Pedir sem travar')
    const vazia: SlideSpec = { type: 'cover' }
    expect(promptFor(vazia)).toBeNull()
    expect(sceneFor(vazia, 'Time to Eat')).toContain('Time to Eat')
  })
})
