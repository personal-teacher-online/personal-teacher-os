'use client'

// FORMULÁRIO COM ERRO INLINE (M3-c4 · B3) — a peça do kit que mata o balão
// nativo do navegador.
//
// A CAPTURA DO DONO: enviar o wizard sem o valor da aula abria o popover cinza
// "Preencha este campo" do Chrome — fonte do sistema, some sozinho, não é lido
// por quem usa leitor de tela e não diz QUAL dado falta. O padrão medido no
// TutorBird é outro: o campo fica com BORDA VERMELHA e a frase aparece EM BAIXO
// dele, com um ícone pequeno, e o foco vai para o primeiro erro.
//
// COMO FUNCIONA, e por que assim:
// · o `<form>` leva `noValidate` — é o que desliga o balão. A partir daí a
//   antecipação é nossa por inteiro (se ela falhasse, o envio passaria e quem
//   recusaria seria a action/o banco, que é o combinado da Lei 3);
// · a validade continua sendo a NATIVA (`checkValidity()`): `required`,
//   `type=email`, `pattern`, `min`, e o `setCustomValidity` que o CityPicker,
//   o DateField e o seletor de horário já usam. Não existe segunda gramática de
//   validação em TypeScript para manter em dia;
// · a FRASE sai de `mensagemDoCampo` (pura, testada à parte);
// · a pintura é por DOM, não por estado: o corpo do formulário é renderizado no
//   SERVIDOR (`Campo`, `GradeDeCampos`, as seções do Sheet) e não volta a
//   renderizar no cliente. Cada `Campo` já traz o parágrafo do erro pronto e
//   `hidden`; aqui só se acende e se apaga o que já existe.
//
// RÉGUA DO §8 DO PLANO DE CLONAGEM, que este componente implementa:
//   · valida no SUBMIT e, depois do primeiro erro daquele campo, no BLUR;
//   · o erro SOME assim que o campo é corrigido (no `input` E no `change`, sem
//     esperar o blur — o select escondido do Radix só dispara o segundo);
//   · o botão de enviar NUNCA é desabilitado — quem tenta enviar tem direito de
//     saber o que falta, e botão morto não explica nada.

import * as React from 'react'

import { mensagemDoCampo } from '@/lib/kit/validacao'

type Controle = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const SLOT_CAMPO = '[data-slot="campo"]'
const SLOT_ERRO = '[data-slot="campo-erro"]'
const SLOT_TEXTO = '[data-slot="campo-erro-texto"]'
const SLOT_GATILHO = '[data-slot="select-trigger"]'

let sequencia = 0

function ehControle(alvo: EventTarget | null): alvo is Controle {
  return (
    alvo instanceof HTMLInputElement ||
    alvo instanceof HTMLSelectElement ||
    alvo instanceof HTMLTextAreaElement
  )
}

/** Os controles que o navegador valida — some com hidden, disabled e botões. */
function controlesDe(form: HTMLFormElement): Controle[] {
  return Array.from(form.elements).filter(
    (el): el is Controle => ehControle(el) && el.willValidate,
  )
}

function noDe(el: Controle): HTMLElement | null {
  return el.closest<HTMLElement>(SLOT_CAMPO)
}

function erroDe(el: Controle): HTMLElement | null {
  return noDe(el)?.querySelector<HTMLElement>(SLOT_ERRO) ?? null
}

/**
 * Onde o foco pousa. O `Select` do kit (Radix) manda o valor num `<select>`
 * ESCONDIDO (`aria-hidden`, fora da ordem de tabulação): focar nele levaria o
 * cursor para um lugar que ninguém vê. Quem recebe o foco, aí, é o gatilho
 * visível do mesmo campo.
 */
function alvoDoFoco(el: Controle): HTMLElement {
  const escondido = el.getAttribute('aria-hidden') === 'true' || el.tabIndex < 0
  if (!escondido) return el
  return noDe(el)?.querySelector<HTMLElement>(SLOT_GATILHO) ?? el
}

function acender(el: Controle) {
  const erro = erroDe(el)
  const exigencia = erro?.dataset.exigencia ?? null
  const frase = mensagemDoCampo({
    faltando: el.validity.valueMissing,
    tipoErrado: el.validity.typeMismatch,
    formatoErrado: el.validity.patternMismatch,
    foraDaFaixa:
      el.validity.rangeUnderflow ||
      el.validity.rangeOverflow ||
      el.validity.stepMismatch ||
      el.validity.tooLong ||
      el.validity.tooShort,
    frasePropria: el.validity.customError ? el.validationMessage : null,
    exigencia,
    formato: el.getAttribute('title'),
    tipo: el instanceof HTMLInputElement ? el.type : 'select',
  })

  el.setAttribute('data-erro', 'sim')
  el.setAttribute('aria-invalid', 'true')
  if (!erro) return
  const texto = erro.querySelector(SLOT_TEXTO)
  if (texto) texto.textContent = frase
  if (!erro.id) erro.id = `campo-erro-${++sequencia}`
  erro.hidden = false
  // O gatilho do Select não é o controle validado, mas é ele que a pessoa vê:
  // a borda vermelha tem de aparecer nele também.
  noDe(el)?.querySelector(SLOT_GATILHO)?.setAttribute('data-erro', 'sim')
  el.setAttribute('aria-describedby', erro.id)
}

function apagar(el: Controle) {
  el.removeAttribute('data-erro')
  el.removeAttribute('aria-invalid')
  el.removeAttribute('aria-describedby')
  noDe(el)?.querySelector(SLOT_GATILHO)?.removeAttribute('data-erro')
  const erro = erroDe(el)
  if (!erro) return
  erro.hidden = true
  const texto = erro.querySelector(SLOT_TEXTO)
  if (texto) texto.textContent = erro.dataset.exigencia ?? ''
}

export function FormValidado({
  children,
  onSubmit,
  ...props
}: React.ComponentProps<'form'>) {
  /** quem JÁ errou uma vez — só esses passam a ser conferidos no blur (§8) */
  const marcados = React.useRef(new WeakSet<Controle>())

  function conferir(el: Controle) {
    if (el.checkValidity()) apagar(el)
    else acender(el)
  }

  /**
   * Corrigiu, apagou — sem esperar o blur.
   *
   * E6 da revisão nº 7: isto precisa valer também para o `change`. O `Select` do
   * kit (Radix) escreve o valor num `<select>` ESCONDIDO e dispara nele um
   * evento `change` — nunca `input`, e o escondido também nunca recebe blur
   * (ninguém o foca). Resultado: escolher a opção certa depois do erro deixava a
   * borda vermelha e a frase acesas para sempre, acusando um campo já correto.
   */
  function corrigiu(alvo: EventTarget | null) {
    if (ehControle(alvo) && marcados.current.has(alvo) && alvo.checkValidity()) apagar(alvo)
  }

  return (
    <form
      {...props}
      // O balão nativo morre aqui, e ninguém de fora reacende: `noValidate` vem
      // DEPOIS do espalhamento de propriedades de propósito.
      noValidate
      onSubmit={(e) => {
        const controles = controlesDe(e.currentTarget)
        // E6, segunda metade: reaplicar a régua a quem está com erro ACESO. Sem
        // isto, um campo que ficou marcado por um caminho que não avisa
        // (o `change` do select escondido é o caso conhecido) seguiria pintado
        // de vermelho na segunda tentativa mesmo já estando certo — e o envio
        // passaria com a tela dizendo que há erro.
        for (const el of controles) {
          if (el.getAttribute('data-erro') === 'sim') conferir(el)
        }
        const invalidos = controles.filter((el) => !el.checkValidity())
        for (const el of invalidos) {
          marcados.current.add(el)
          acender(el)
        }
        if (invalidos.length > 0) {
          // Sem `preventDefault` a server action rodaria com o formulário
          // incompleto — e o erro voltaria como recado de página inteira.
          e.preventDefault()
          const foco = alvoDoFoco(invalidos[0])
          foco.focus()
          foco.scrollIntoView({ block: 'center', behavior: 'smooth' })
          return
        }
        onSubmit?.(e)
      }}
      // Blur: só reconfere quem já errou. Conferir um campo que a pessoa apenas
      // ATRAVESSOU (tab) seria acusar antes de a pessoa ter tentado.
      onBlur={(e) => {
        const alvo = e.target
        if (ehControle(alvo) && marcados.current.has(alvo)) conferir(alvo)
      }}
      onInput={(e) => corrigiu(e.target)}
      // `change` além de `input`: o select escondido do Radix só dispara este.
      onChange={(e) => corrigiu(e.target)}
    >
      {children}
    </form>
  )
}
