// @vitest-environment jsdom
//
// r7 nº 5 — O CAMPO COM TETO, PROVADO NO DOM (e não por leitura de código).
//
// O que o c16 provou dele: a régua pura (`passouDoTeto`, code points) e o HTML
// de servidor (não sai `maxlength`, a frase não vaza). As duas coisas são
// verdade e nenhuma delas exercita o mecanismo: `setCustomValidity` só existe
// depois que o campo está VIVO no navegador, e é ele — não a marcação — que faz
// a borda ficar vermelha, a frase aparecer embaixo e o submit parar no primeiro
// erro. Sem um teste hidratado, apagar o `conferir(e.currentTarget)` do
// `onInput` deixava a suíte inteira verde com o aviso morto.
//
// POR QUE `fireEvent` CRU, sem testing-library. O que este arquivo precisa é de
// três coisas: montar o componente, escrever no input e ler `validity`. As três
// são DOM puro — `createRoot` + `act` (React 19) + `dispatchEvent`. Uma
// dependência a mais só para embrulhar isso seria peso sem troco. O jsdom entra
// porque não há DOM em `environment: 'node'` (o padrão da suíte, que continua
// valendo para os outros ~1900 testes: o docblock lá em cima muda SÓ este
// arquivo).
//
// LEI 3, de novo: nada disto DECIDE. Quem recusa o nome comprido é o CHECK
// `contracts_plan_name_len` (provado contra o banco no c16) e o Zod da action. O
// que se prova aqui é o AVISO — chegar antes, no campo certo, em português.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CampoComTeto } from '@/components/kit/campo-com-teto'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'

// React 19 exige o sinal explícito de "isto é ambiente de act" para não avisar
// que atualizações não foram embrulhadas.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FRASE = `O nome do plano cabe em ${TETO_DO_PLANO} caracteres.`

let container: HTMLDivElement
let root: Root

/** Monta o campo NÃO controlado — é assim que os painéis de servidor o usam. */
async function montar(defaultValue = ''): Promise<HTMLInputElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      h(CampoComTeto, {
        name: 'plan_name',
        required: true,
        teto: TETO_DO_PLANO,
        frase: FRASE,
        defaultValue,
      }),
    )
  })
  const el = container.querySelector('input')
  expect(el, 'o campo tem de existir no DOM').not.toBeNull()
  return el as HTMLInputElement
}

/**
 * Digitar de verdade: escreve no elemento e solta o evento `input` que o
 * navegador soltaria. É por ele que o `onInput` do componente é chamado — o
 * mesmo caminho da pessoa teclando.
 */
async function digitar(el: HTMLInputElement, valor: string) {
  await act(async () => {
    el.value = valor
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})

describe('r7 nº 5 · CampoComTeto no DOM: o aviso existe e some', () => {
  it('digitar acima do teto marca `customError` com a frase em português', async () => {
    const el = await montar('')
    // `customError` é o canal DESTE componente. O campo vazio continua inválido,
    // sim — mas por `valueMissing`, que é assunto do `required` e não do teto.
    expect(el.validity.customError, 'campo recém-montado e vazio não acusa TETO').toBe(false)
    expect(el.validity.valueMissing, 'quem reclama do vazio é o `required`').toBe(true)

    await digitar(el, 'a'.repeat(TETO_DO_PLANO + 1))
    expect(el.validity.customError, 'um caractere acima do teto já acusa').toBe(true)
    expect(el.validationMessage, 'e a frase é a que a pessoa lê embaixo do campo').toBe(FRASE)
    // e o campo NÃO comeu a tecla: o texto inteiro continua lá (o contrário do
    // `maxLength`, que truncava em silêncio — c16 · r6 nº 12)
    expect([...el.value].length).toBe(TETO_DO_PLANO + 1)
  })

  it('voltar para dentro do teto LIMPA o aviso', async () => {
    const el = await montar('')
    await digitar(el, 'a'.repeat(TETO_DO_PLANO + 5))
    expect(el.validity.customError).toBe(true)

    await digitar(el, 'a'.repeat(TETO_DO_PLANO))
    expect(el.validity.customError, 'exatamente no teto CABE').toBe(false)
    expect(el.validationMessage).toBe('')
  })

  it('a conta é de code points também no campo vivo: 80 emojis cabem', async () => {
    const el = await montar('')
    await digitar(el, '🙂'.repeat(TETO_DO_PLANO))
    expect(el.value.length, 'em UTF-16 isto pareceria o dobro do teto').toBe(TETO_DO_PLANO * 2)
    expect(el.validity.customError, 'e mesmo assim cabe — o banco conta caracteres').toBe(false)

    await digitar(el, '🙂'.repeat(TETO_DO_PLANO + 1))
    expect(el.validity.customError).toBe(true)
    expect(el.validationMessage).toBe(FRASE)
  })

  it('valor inicial já comprido nasce acusado (a outra ponta, o efeito de montagem)', async () => {
    // É o caso do painel de regras reabrindo com um plano que veio comprido do
    // banco: ninguém digitou nada, e mesmo assim o campo tem de avisar.
    const el = await montar('a'.repeat(TETO_DO_PLANO + 1))
    expect(el.validity.customError).toBe(true)
    expect(el.validationMessage).toBe(FRASE)

    await digitar(el, 'Plano curto')
    expect(el.validity.customError, 'e o aviso some quando o texto encolhe').toBe(false)
  })
})

/* ========================================================================== */
/* Sol r8 nº 4 — o AVISO VISUAL materializa: CampoComTeto DENTRO do FormValidado */
/* ========================================================================== */
//
// Os testes acima provam o mecanismo do campo (customError seta/limpa). O que
// faltava (achado r8 nº 4): provar que o CONSUMIDOR — o `FormValidado` — lê o
// `customError` e acende o aviso inline no submit. Mutação que este teste
// pega: fazer o FormValidado ignorar `validity.customError` (form-validado.tsx,
// `frasePropria`) deixa os testes de cima verdes e ESTE vermelho, porque a
// frase própria do teto deixa de chegar ao slot de texto.
import { FormValidado } from '@/components/kit/form-validado'

describe('integrado ao FormValidado (Sol r8 nº 4)', () => {
  it('no submit, o campo acima do teto acende borda + frase própria embaixo', async () => {
    // jsdom não implementa scrollIntoView; o FormValidado o chama no foco.
    HTMLElement.prototype.scrollIntoView = () => {}

    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(
        h(
          FormValidado,
          {},
          h(
            'div',
            { 'data-slot': 'campo' },
            h(CampoComTeto, {
              name: 'plan_name',
              teto: 4,
              frase: 'passou do teto de teste',
              defaultValue: 'cinco', // 5 code points > 4: nasce inválido
            }),
            h(
              'p',
              { 'data-slot': 'campo-erro', hidden: true },
              h('span', { 'data-slot': 'campo-erro-texto' }),
            ),
          ),
          h('button', { type: 'submit' }, 'Enviar'),
        ),
      )
    })

    const form = container.querySelector('form') as HTMLFormElement
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.validity.customError, 'nasce acusado pelo useEffect').toBe(true)

    await act(async () => {
      form.requestSubmit()
    })

    expect(input.getAttribute('data-erro'), 'borda acesa').toBe('sim')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const erro = container.querySelector<HTMLElement>('[data-slot="campo-erro"]')
    expect(erro?.hidden, 'o aviso saiu do esconderijo').toBe(false)
    expect(
      erro?.querySelector('[data-slot="campo-erro-texto"]')?.textContent,
      'a frase PRÓPRIA do teto chegou ao slot (caminho do customError)',
    ).toContain('passou do teto de teste')
  })
})
