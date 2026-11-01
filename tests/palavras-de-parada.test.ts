// Issue #127 — os 4 textos do critério de aceite contra o detector COMPARTILHADO
// (`src/lib/notify/palavras-de-parada.ts`, da #113/#140), que o webhook da Meta
// usa para decidir se avisa a admin. A régua inteira do detector (palavras,
// frases, cortesia, falsos positivos) é testada em `tests/m3-recebidas.test.ts`;
// aqui fica só o que a #127 pede e o que lá não aparece literalmente.
import { describe, expect, it } from 'vitest'
import { pedeParaParar } from '@/lib/notify/palavras-de-parada'

describe('#127 · palavras de parada (critério da issue)', () => {
  it('"PARAR", "parar" e "não quero mais receber" avisam; "preciso sair mais cedo" não', () => {
    expect(pedeParaParar('PARAR')).toBe(true)
    expect(pedeParaParar('parar')).toBe(true)
    expect(pedeParaParar('não quero mais receber')).toBe(true)
    expect(pedeParaParar('preciso sair mais cedo')).toBe(false)
  })

  it('"parar" no meio de um recado de aula não avisa', () => {
    expect(pedeParaParar('vou parar o carro e já entro')).toBe(false)
  })
})
