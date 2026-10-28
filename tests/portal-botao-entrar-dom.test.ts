// @vitest-environment jsdom
//
// D1 PROVADO NO DOM — o botão de entrar com a página ABERTA (Onda do Portal · P3).
//
// A régua pura (`estadoDoBotao`, `rotuloDoBotao`) já é cobrada em
// `portal-inicio-creditos.test.ts`. O que ela NÃO alcança é o mecanismo: o
// aluno abre o portal 20 minutos antes da aula e deixa o celular na mesa — se o
// intervalo de 30s não estiver ligado, ele volta e lê "Entrar em 20 min" num
// botão morto enquanto a professora espera na sala. Sem este arquivo, apagar o
// `setInterval` deixaria a suíte inteira verde.
//
// Relógio falso (`vi.useFakeTimers`) porque o tempo é o insumo do componente: é
// ele que anda, não o teste. `fireEvent` cru pelo mesmo motivo do c17 — montar,
// avançar e ler DOM são `createRoot` + `act`, sem embrulho de biblioteca.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BotaoEntrar } from '@/components/portal/BotaoEntrar'
import { varrerVocabulario } from './helpers/vocabulario'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AGORA = Date.UTC(2026, 6, 28, 20, 0, 0)
const COMECO = AGORA + 20 * 60_000
const FIM = COMECO + 45 * 60_000

let container: HTMLDivElement
let root: Root

async function montar() {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      h(BotaoEntrar, {
        startsAtEpochMs: COMECO,
        endsAtEpochMs: FIM,
        agoraNoServidorMs: AGORA,
        horaDoComeco: '17:20',
        meetUrl: 'https://meet.google.com/abc-defg-hij',
      }),
    )
  })
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(AGORA)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('BotaoEntrar — a contagem viva', () => {
  it('longe da aula: botão DESLIGADO, e o número anda sozinho', async () => {
    await montar()
    const botao = container.querySelector('button')
    expect(botao?.disabled).toBe(true)
    expect(botao?.textContent).toBe('Entrar em 20 min')
    expect(container.querySelector('a')).toBeNull()

    // Um minuto depois, sem ninguém tocar em nada.
    await avancar(60_000)
    expect(container.querySelector('button')?.textContent).toBe('Entrar em 19 min')
  })

  it('15 minutos antes o botão vira o LINK da sala, sozinho', async () => {
    await montar()
    expect(container.querySelector('a')).toBeNull()

    await avancar(5 * 60_000 + 1_000)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://meet.google.com/abc-defg-hij')
    expect(link?.textContent).toBe('Entrar na aula')
    expect(link?.getAttribute('target')).toBe('_blank')
    // …e continua aceso DEPOIS do horário de começo (quem chega atrasado entra).
    await avancar(25 * 60_000)
    expect(container.querySelector('a')?.textContent).toBe('Entrar na aula')
  })

  it('no fim da aula o botão some da tela', async () => {
    await montar()
    await avancar(FIM - AGORA + 1_000)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('o texto que aparece na tela passa pelo varredor de vocabulário', async () => {
    // O varredor do P3 lia a FONTE das telas; o rótulo do botão chega ao aluno
    // por função, e ninguém o varria (achado do revisor).
    await montar()
    expect(varrerVocabulario(container.textContent ?? '')).toEqual([])
    await avancar(6 * 60_000)
    expect(varrerVocabulario(container.textContent ?? '')).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* O RELÓGIO QUE MANDA É O DO SERVIDOR (C7 da revisão adversarial)             */
/* -------------------------------------------------------------------------- */

describe('BotaoEntrar — relógio do aparelho errado', () => {
  /** Monta com o relógio do APARELHO deslocado do relógio do servidor. */
  async function montarComDesvio(desvioDoAparelhoMs: number) {
    vi.setSystemTime(AGORA + desvioDoAparelhoMs)
    await montar()
  }

  it('celular ADIANTADO uma hora não fecha a porta da aula antes da hora', async () => {
    // Sem a correção, o primeiro tick lê o relógio do aparelho (já depois do fim
    // da aula) e o botão SOME — com a professora ainda esperando na sala.
    await montarComDesvio(60 * 60_000)
    expect(container.querySelector('button')?.textContent).toBe('Entrar em 20 min')
    // …e continua andando pelo relógio certo.
    await avancar(60_000)
    expect(container.querySelector('button')?.textContent).toBe('Entrar em 19 min')
    // A porta abre na hora do SERVIDOR, não na do aparelho.
    await avancar(4 * 60_000 + 1_000)
    expect(container.querySelector('a')?.textContent).toBe('Entrar na aula')
  })

  it('celular ATRASADO três horas não acende o botão cedo demais', async () => {
    // Sem a correção o aparelho acha que faltam 3h20 e escreve a hora marcada;
    // pior, atravessa a janela inteira sem nunca acender.
    await montarComDesvio(-3 * 3_600_000)
    expect(container.querySelector('button')?.textContent).toBe('Entrar em 20 min')
    await avancar(20 * 60_000)
    expect(container.querySelector('a')?.textContent).toBe('Entrar na aula')
  })
})

/* -------------------------------------------------------------------------- */
/* OS DOIS LADOS DO LIMIAR (D4 da revisão adversarial 2)                       */
/* -------------------------------------------------------------------------- */

// O desvio só pode ser MEDIDO na hidratação, e a medida inclui tudo que passou
// entre o render do servidor e o `Date.now()` do navegador — fila, streaming,
// rede de celular, parse. Com a correção aplicada CRUA, uma página que levou 70
// s para chegar "corrigia" 70 s e mandava a porta da aula ~100 s além do fim
// dela. O piso separa as duas coisas: abaixo de `DESVIO_MINIMO_DO_RELOGIO_MS`
// isso é latência (o aparelho manda), acima é relógio errado (o servidor manda).
//
// Os quatro casos abaixo cercam o limiar pelos dois lados e nos dois sinais —
// tirar o piso deixa dois vermelhos, e alargá-lo demais deixa os outros dois.
describe('BotaoEntrar — o piso do desvio (latência não é relógio errado)', () => {
  async function montarComDesvio(desvioDoAparelhoMs: number) {
    vi.setSystemTime(AGORA + desvioDoAparelhoMs)
    await montar()
  }
  const rotulo = () => container.querySelector('button')?.textContent

  it('página que demorou 119 s a chegar NÃO desloca a porta da aula', async () => {
    // Aparelho 119 s ATRÁS do servidor: abaixo do piso, nada é corrigido — a
    // conta sai do relógio do aparelho (faltam 21min59s → "22 min").
    await montarComDesvio(-119_000)
    expect(rotulo()).toBe('Entrar em 22 min')
  })

  it('aparelho 119 s ADIANTADO também fica sem correção', async () => {
    // O outro sinal do mesmo piso: faltam 18min01s pelo relógio do aparelho.
    await montarComDesvio(119_000)
    expect(rotulo()).toBe('Entrar em 19 min')
  })

  it('121 s de atraso no aparelho JÁ é relógio errado — o servidor assume', async () => {
    await montarComDesvio(-121_000)
    expect(rotulo()).toBe('Entrar em 20 min')
  })

  it('121 s de adiantamento no aparelho também volta para a hora do servidor', async () => {
    await montarComDesvio(121_000)
    expect(rotulo()).toBe('Entrar em 20 min')
  })

  // Sol P3 r3, achado 5: a borda EXATA é declarada — a comparação é estrita
  // (`> 120_000`), então 120 s cravados ainda confiam no aparelho.
  it('exatamente 120 s de desvio NÃO corrige (comparação estrita)', async () => {
    await montarComDesvio(-120_000)
    expect(rotulo()).toBe('Entrar em 22 min')
    await montarComDesvio(120_000)
    expect(rotulo()).toBe('Entrar em 18 min')
  })
})
