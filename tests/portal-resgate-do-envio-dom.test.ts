// @vitest-environment jsdom
//
// K2 / ADR-030 — O RESGATE DO ENVIO, PROVADO NO DOM.
//
// O e2e cobra o TETO do desfecho, mas só fica vermelho nas rodadas em que a
// corrida do Router é perdida — e ela é perdida em ~30% das vezes. Uma trava que
// só acende às vezes não trava nada: apagar o `ResgateDoEnvio` passaria batido
// numa rodada de sorte. Este arquivo é a trava determinística.
//
// O QUE ELE MONTA: um `<form action={…}>` cuja Server Action NUNCA resolve — que
// é, do ponto de vista do React, exatamente o que acontece quando o commit da
// navegação se perde: `useFormStatus().pending` fica preso em `true`.
//
// RELÓGIO DE VERDADE, e não `vi.useFakeTimers` (medido): com o `setTimeout`
// falseado, o React 19 não consegue ENCERRAR a transição do `<form action>` — o
// `pending` fica preso em `true` mesmo depois de a action resolver, e o teste do
// caminho feliz viraria um falso vermelho. Por isso o teto entra por prop
// (`apos`), em dezenas de milissegundos: é o mesmo relógio, só que curto.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RESGATE_DO_ENVIO_MS, ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Teto curto para o teste; o de produção é `RESGATE_DO_ENVIO_MS`. */
const TETO = 150

let container: HTMLDivElement
let root: Root
let assign: ReturnType<typeof vi.fn>
/** A action pendente do teste da vez — o `afterEach` a resolve antes de
 *  desmontar. Sem isso, o teste que deixa uma transição do React pendurada
 *  para sempre contamina o seguinte (medido: o caso feliz vira falso
 *  vermelho quando roda depois do caso quebrado). */
let resolverAtual: (() => void) | null = null

/** Monta o formulário; `resolver()` termina a action (o caminho feliz). */
async function montar() {
  let resolver!: () => void
  const acao = () =>
    new Promise<void>((r) => {
      resolver = r
      resolverAtual = r
    })

  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      h(
        'form',
        { action: acao },
        h(ResgateDoEnvio, { apos: TETO }),
        h('button', { type: 'submit' }, 'Enviar'),
      ),
    )
  })
  return { resolver: () => resolver() }
}

async function enviar() {
  await act(async () => {
    container.querySelector('button')!.click()
  })
}

async function esperar(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

/** O `location` do jsdom não deixa redefinir `assign` (a propriedade não é
 *  configurável), mas `window.location` INTEIRO é — então se troca o objeto. */
const ENDERECO = 'http://localhost:3000/portal/aula/abc'
let locationReal: Location

beforeEach(() => {
  assign = vi.fn()
  locationReal = window.location
  Object.defineProperty(window, 'location', {
    value: { href: ENDERECO, assign },
    configurable: true,
    writable: true,
  })
})

afterEach(async () => {
  if (resolverAtual) {
    const r = resolverAtual
    resolverAtual = null
    await act(async () => r())
  }
  await act(async () => root.unmount())
  container.remove()
  Object.defineProperty(window, 'location', {
    value: locationReal,
    configurable: true,
    writable: true,
  })
  vi.restoreAllMocks()
})

describe('ResgateDoEnvio — quando o commit da navegação não vem', () => {
  it('envio que não termina vira RECARGA depois do teto', async () => {
    await montar()
    await enviar()

    // Antes do teto ainda se espera pelo caminho normal.
    await esperar(TETO / 3)
    expect(assign).not.toHaveBeenCalled()

    await esperar(TETO * 3)
    expect(assign).toHaveBeenCalledTimes(1)
    // O destino é o endereço ATUAL: quando a corrida acontece, é para ele que o
    // `redirect` da action queria levar (ADR-030).
    expect(assign).toHaveBeenCalledWith(ENDERECO)
  })

  it('envio que TERMINA não recarrega nada', async () => {
    const { resolver } = await montar()
    await enviar()
    await act(async () => resolver())

    // Muito depois do teto: o relógio do resgate morreu junto com o `pending`.
    // Sem esse cancelamento, TODO envio bem sucedido recarregaria a página.
    await esperar(TETO * 4)
    expect(assign).not.toHaveBeenCalled()
  })

  it('sem envio nenhum, o relógio nunca é armado', async () => {
    await montar()
    await esperar(TETO * 4)
    expect(assign).not.toHaveBeenCalled()
  })

  it('o teto de produção é o que a ADR-030 declara', () => {
    // Trocar este número sem passar pela ADR muda o contrato medido: 3s fica
    // acima do pior caminho real (~150ms) e muito abaixo do defeito (~29s).
    expect(RESGATE_DO_ENVIO_MS).toBe(3_000)
  })
})
