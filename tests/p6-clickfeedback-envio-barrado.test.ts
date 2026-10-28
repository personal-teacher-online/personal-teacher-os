// @vitest-environment jsdom
//
// P6 — A TRAVA DE DUPLO ENVIO NÃO PODE PRENDER QUEM NUNCA ENVIOU.
//
// DEFEITO LATENTE DA ONDA 1, descoberto pela rodada adversarial do login
// (28/07/2026) e corrigido na raiz em `src/components/ClickFeedback.tsx`.
//
// O que acontecia: o `ClickFeedback` ouve `submit` no `document` em CAPTURA —
// portanto ANTES de qualquer `onSubmit` de React — e já marcava o formulário
// com `data-submitting` (CSS: `pointer-events: none`) e o botão com
// `data-pending`. Se o envio fosse CANCELADO logo depois, a marca ficava presa
// até o cinto de 12s. Quem cancela é o `FormValidado` do kit: ele leva
// `noValidate`, então o evento `submit` DISPARA mesmo com campo vazio, e é ele
// quem chama `preventDefault()`. Resultado no admin (wizard de contrato, ficha
// do aluno, formulário de lead — todos usam o kit): clicar em "Salvar" com um
// campo obrigatório vazio mostrava a frase de erro E congelava o formulário
// inteiro por 12 segundos, incluindo o campo que a pessoa precisava corrigir.
//
// A validação NATIVA nunca teve o problema — o navegador segura o envio e o
// evento `submit` sequer é disparado. Os dois caminhos estão medidos aqui, para
// que a afirmação não seja mais um comentário.
//
// PROVA DE MUTAÇÃO conferida à mão: apagando o `queueMicrotask(...)` do
// `ClickFeedback`, os dois testes de "form inválido" ficam VERMELHOS
// (`data-submitting` presente) e os de "form válido" seguem verdes.
import { act, createElement as h, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClickFeedback } from '@/components/ClickFeedback'
import { FormValidado } from '@/components/kit/form-validado'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// O `ClickFeedback` observa a conclusão da navegação por `usePathname` /
// `useSearchParams`. Fora do App Router não há provedor; aqui eles são fixos —
// o que este arquivo exercita é o caminho do SUBMIT, não o da barra.
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}))

// O jsdom não implementa `scrollIntoView`, e o `FormValidado` rola até o
// primeiro erro. Shim mínimo: o que se mede aqui é a marca do envio, não a
// rolagem.
Element.prototype.scrollIntoView = () => {}

let raiz: Root | null = null
let caixa: HTMLDivElement | null = null

afterEach(async () => {
  if (raiz) await act(async () => raiz!.unmount())
  caixa?.remove()
  raiz = null
  caixa = null
})

type Cena = {
  form: HTMLFormElement
  botao: HTMLButtonElement
  campo: HTMLInputElement
  enviosDaAction: FormData[]
}

/**
 * Monta o `ClickFeedback` (que é global, no layout raiz) ao lado de UM
 * formulário com campo obrigatório — a anatomia mínima do defeito.
 *
 * `comKit = true` usa o `FormValidado` (o caminho que quebrava); `false` usa um
 * `<form>` comum, com a validação nativa do navegador (o caminho que sempre
 * esteve certo, e que a proposta do login voltou a usar).
 */
async function montar(comKit: boolean): Promise<Cena> {
  const enviosDaAction: FormData[] = []
  caixa = document.createElement('div')
  document.body.appendChild(caixa)
  const elementoDoForm = comKit ? FormValidado : 'form'
  await act(async () => {
    raiz = createRoot(caixa!)
    raiz.render(
      h(
        Fragment,
        null,
        h(ClickFeedback),
        h(
          elementoDoForm as 'form',
          {
            action: (fd: FormData) => {
              enviosDaAction.push(fd)
            },
          },
          h('input', { name: 'nome', required: true, 'data-slot': 'campo-alvo' }),
          h('button', { type: 'submit' }, 'Salvar'),
        ),
      ),
    )
  })
  return {
    form: caixa!.querySelector('form')!,
    botao: caixa!.querySelector('button')!,
    campo: caixa!.querySelector('input')!,
    enviosDaAction,
  }
}

/**
 * Clicar de verdade no botão de envio — é o gesto da pessoa, e é ele que
 * dispara (ou não) o `submit` conforme a validação.
 *
 * O `await act` esvazia a fila de microtasks, que é onde o `ClickFeedback`
 * decide se a marca fica ou some.
 */
async function clicarEmSalvar(cena: Cena) {
  await act(async () => {
    cena.botao.click()
  })
}

const travado = (cena: Cena) => ({
  form: cena.form.hasAttribute('data-submitting'),
  botao: cena.botao.hasAttribute('data-pending'),
})

describe('ClickFeedback · envio BARRADO pela validação não pode travar o formulário', () => {
  it('FormValidado (kit) com campo vazio: erro aparece e o formulário segue vivo', async () => {
    const cena = await montar(true)
    await clicarEmSalvar(cena)

    // O evento SUBMIT aconteceu (o kit leva `noValidate`) e o kit o cancelou:
    // a action não rodou e o campo está acusado.
    expect(cena.enviosDaAction).toHaveLength(0)
    expect(cena.campo.getAttribute('aria-invalid')).toBe('true')

    // …e é isto que estava quebrado: nada de marca presa.
    expect(travado(cena)).toEqual({ form: false, botao: false })
  })

  it('FormValidado (kit) com o campo preenchido: a trava de duplo envio CONTINUA', async () => {
    const cena = await montar(true)
    cena.campo.value = 'Ana'
    await clicarEmSalvar(cena)

    expect(cena.enviosDaAction).toHaveLength(1)
    expect(cena.enviosDaAction[0].get('nome')).toBe('Ana')
    // A marca fica: é ela que bloqueia o segundo clique enquanto a action corre.
    expect(travado(cena)).toEqual({ form: true, botao: true })
  })

  it('FormValidado: corrigir e reenviar funciona — o segundo clique passa', async () => {
    const cena = await montar(true)
    await clicarEmSalvar(cena)
    expect(travado(cena)).toEqual({ form: false, botao: false })

    cena.campo.value = 'Ana'
    cena.campo.dispatchEvent(new Event('input', { bubbles: true }))
    await clicarEmSalvar(cena)

    expect(cena.enviosDaAction).toHaveLength(1)
    expect(travado(cena)).toEqual({ form: true, botao: true })
  })

  it('form comum (validação nativa) com campo vazio: o submit nem dispara', async () => {
    const cena = await montar(false)
    expect(cena.form.hasAttribute('novalidate')).toBe(false)
    await clicarEmSalvar(cena)

    expect(cena.enviosDaAction).toHaveLength(0)
    expect(travado(cena)).toEqual({ form: false, botao: false })
  })

  it('form comum (validação nativa) preenchido: marca e trava, como sempre', async () => {
    const cena = await montar(false)
    cena.campo.value = 'Ana'
    await clicarEmSalvar(cena)

    expect(cena.enviosDaAction).toHaveLength(1)
    expect(travado(cena)).toEqual({ form: true, botao: true })
  })
})
