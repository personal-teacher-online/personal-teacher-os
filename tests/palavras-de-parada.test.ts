// Issue #127 — o detector de palavra de parada (ADR-038, item 4; régua decidida
// na #44 em 01/11/2026 e aceita pela orquestradora): "parar", "sair" e "stop"
// só quando são a mensagem INTEIRA; "não quero mais" em qualquer lugar;
// maiúsculas, acentos e pontuação ignorados. O webhook da Meta usa este
// detector para decidir se avisa a admin.
import { describe, expect, it } from 'vitest'
import { pedeParaParar } from '@/lib/notify/palavras-de-parada'

describe('#127 · palavras de parada', () => {
  it('os 4 textos da issue: "PARAR", "parar" e "não quero mais receber" avisam; "preciso sair mais cedo" não', () => {
    expect(pedeParaParar('PARAR')).toBe(true)
    expect(pedeParaParar('parar')).toBe(true)
    expect(pedeParaParar('não quero mais receber')).toBe(true)
    expect(pedeParaParar('preciso sair mais cedo')).toBe(false)
  })

  it.each(['Parar!', ' sair ', 'SAIR.', 'stop', 'Stop', 'não quero mais', 'NAO QUERO MAIS', 'Não quero mais receber'])(
    '"%s" pede para parar',
    (t) => expect(pedeParaParar(t)).toBe(true),
  )

  it.each(['Preciso sair mais cedo hoje', 'vou parar o carro e já entro', 'Oi! Posso trocar a aula de quinta?', '', '   ', null, undefined])(
    '"%s" não pede',
    (t) => expect(pedeParaParar(t)).toBe(false),
  )
})
