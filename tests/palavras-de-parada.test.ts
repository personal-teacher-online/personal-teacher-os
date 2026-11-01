// Issue #127 — o detector COMPARTILHADO (`src/lib/notify/palavras-de-parada.ts`,
// da #113/#140) tem dois níveis: o LARGO (`pedeParaParar`) só destaca a linha
// na aba Recebidas; o ESTRITO (`pedeParaPararInequivoco`) dispara o e-mail às
// admins, que pode levar a apagar o WhatsApp do aluno, e por isso não aceita o
// que é ambíguo ("Cancelar" respondendo ao lembrete de aula). A régua inteira do
// nível largo está em `tests/m3-recebidas.test.ts`; aqui ficam os 4 textos do
// critério da #127, os dois níveis lado a lado e o extrator de texto que o
// webhook e a aba usam.
import { describe, expect, it } from 'vitest'
import {
  pedeParaParar,
  pedeParaPararInequivoco,
  textoDaMensagemRecebida,
} from '@/lib/notify/palavras-de-parada'

describe('#127 · palavras de parada (critério da issue, nível do e-mail)', () => {
  it('"PARAR", "parar" e "não quero mais receber" avisam; "preciso sair mais cedo" não', () => {
    expect(pedeParaPararInequivoco('PARAR')).toBe(true)
    expect(pedeParaPararInequivoco('parar')).toBe(true)
    expect(pedeParaPararInequivoco('não quero mais receber')).toBe(true)
    expect(pedeParaPararInequivoco('preciso sair mais cedo')).toBe(false)
    expect(pedeParaParar('preciso sair mais cedo')).toBe(false)
  })

  it('"parar" no meio de um recado de aula não avisa', () => {
    expect(pedeParaParar('vou parar o carro e já entro')).toBe(false)
    expect(pedeParaPararInequivoco('vou parar o carro e já entro')).toBe(false)
  })
})

describe('#127 · os dois níveis', () => {
  it.each([
    'PARAR',
    'Pare!',
    'STOP',
    'Sair.',
    'unsubscribe',
    'parar por favor',
    'quero parar de receber',
    'não quero mais mensagens',
    'não me mande mais',
    'me tira da lista',
    'please stop',
    'pare de me mandar mensagem',
  ])('"%s": destaca E avisa por e-mail', (t) => {
    expect(pedeParaParar(t)).toBe(true)
    expect(pedeParaPararInequivoco(t)).toBe(true)
  })

  it.each(['Cancelar', 'cancelar por favor', 'pode parar', 'quero sair', 'não quero mais', 'chega', 'Para!'])(
    '"%s": só destaca na aba; não manda e-mail',
    (t) => {
      expect(pedeParaParar(t)).toBe(true)
      expect(pedeParaPararInequivoco(t)).toBe(false)
    },
  )

  it.each(['cancelar a aula de amanhã', 'Posso sair mais cedo hoje?', 'não quero mais faltar', '', null, undefined])(
    '"%s": nenhum dos dois',
    (t) => {
      expect(pedeParaParar(t)).toBe(false)
      expect(pedeParaPararInequivoco(t)).toBe(false)
    },
  )
})

describe('#127 · o texto de uma mensagem recebida (webhook e aba leem igual)', () => {
  it('texto, toque em botão de modelo, botão interativo e item de lista; mídia não tem texto', () => {
    expect(textoDaMensagemRecebida({ type: 'text', text: { body: 'PARAR' } })).toBe('PARAR')
    expect(textoDaMensagemRecebida({ type: 'button', button: { text: 'Parar', payload: 'x' } })).toBe('Parar')
    expect(
      textoDaMensagemRecebida({ type: 'interactive', interactive: { button_reply: { id: 'b1', title: 'Stop' } } }),
    ).toBe('Stop')
    expect(
      textoDaMensagemRecebida({ type: 'interactive', interactive: { list_reply: { id: 'l1', title: 'Sair' } } }),
    ).toBe('Sair')
    expect(textoDaMensagemRecebida({ type: 'audio', audio: { id: '300000000000001' } })).toBeNull()
    expect(textoDaMensagemRecebida(null)).toBeNull()
  })
})

describe('#141 · parar de mandar com artigo antes do objeto', () => {
  it.each(['Pare de mandar as mensagens', 'parar de enviar os lembretes'])(
    '"%s": destaca E avisa por e-mail',
    (t) => {
      expect(pedeParaParar(t)).toBe(true)
      expect(pedeParaPararInequivoco(t)).toBe(true)
    },
  )

  it('preposição de lugar e artigo sem objeto de mensagem seguem sem contar', () => {
    expect(pedeParaParar('pode parar de mandar no grupo?')).toBe(false)
    expect(pedeParaPararInequivoco('pode parar de mandar no grupo?')).toBe(false)
    expect(pedeParaParar('pare de mandar a foto')).toBe(false)
  })

  it.each(['pare de mandar os lembretes pra mim', 'pare de mandar as mensagens no WhatsApp'])(
    '"%s": complemento depois do objeto não cancela',
    (t) => {
      expect(pedeParaParar(t)).toBe(true)
      expect(pedeParaPararInequivoco(t)).toBe(true)
    },
  )

  it('artigo no singular também conta', () => {
    expect(pedeParaPararInequivoco('pare de enviar o aviso')).toBe(true)
    expect(pedeParaPararInequivoco('pare de mandar a mensagem')).toBe(true)
  })
})
