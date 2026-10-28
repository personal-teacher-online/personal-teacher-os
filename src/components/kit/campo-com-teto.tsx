'use client'

// CAMPO DE TEXTO COM TETO DE CARACTERES (c16 · r6 nº 12/13).
//
// O QUE ELE SUBSTITUI, e por quê. Os campos de tamanho limitado desta casa
// usavam `maxLength`, e `maxLength` conta UNIDADES UTF-16: um emoji fora do BMP
// vale 2, um par surrogate vale 2. O `maxLength={80}` do nome do plano, então,
// parava a digitação em 40 emojis — enquanto o CHECK do banco
// (`contracts_plan_name_len`, `char_length`) aceitaria os 80. Régua de tela mais
// apertada que a do banco é o pior dos dois mundos: a pessoa vê "não cabe" para
// uma coisa que cabe, e o teto real nunca é exercitado.
//
// E `maxLength` não avisa: ele COME a tecla. Quem cola um nome de 120
// caracteres vê o campo truncar em silêncio e não fica sabendo que perdeu o
// fim.
//
// COMO ESTE FUNCIONA. Ele deixa digitar e, quando passa do teto, põe a frase em
// `setCustomValidity` — o mesmo mecanismo do `DateField` e do `CityPicker`. Daí
// o `FormValidado` do kit faz o resto que já sabe fazer: borda vermelha, frase
// EMBAIXO do campo, foco no primeiro erro no submit, e a frase some assim que o
// texto encolhe. A contagem é `[...valor].length` — code points, a mesma conta
// do `char_length` do Postgres e a mesma que o Zod e as actions já usavam.
//
// LEI 3 INTEIRA: isto não decide nada. Quem recusa é o CHECK (nome do plano) ou
// a RPC (`admin_cancel_signature`, motivo do cancelamento); o Zod recusa o
// payload montado à mão antes de virar RPC. Este arquivo só diz antes, no campo
// certo, em português.

import * as React from 'react'

/**
 * A RÉGUA, isolada para poder ser provada sem DOM.
 *
 * `[...valor].length` itera por CODE POINT — é a mesma conta que o `char_length`
 * do Postgres faz, e a mesma que o Zod (`NovoContratoSchema`) e as actions já
 * usavam. `valor.length` contaria unidades UTF-16, que é a régua errada e mais
 * apertada.
 */
export function passouDoTeto(valor: string, teto: number): boolean {
  return [...valor].length > teto
}

export function CampoComTeto({
  teto,
  frase,
  onInput,
  ref: refDeFora,
  ...props
}: React.ComponentProps<'input'> & {
  /** quantos CARACTERES (code points) o banco aceita neste campo */
  teto: number
  /** a frase que a pessoa lê quando passa do teto */
  frase: string
}) {
  const meu = React.useRef<HTMLInputElement>(null)

  const conferir = React.useCallback(
    (el: HTMLInputElement | null) => {
      if (!el) return
      el.setCustomValidity(passouDoTeto(el.value, teto) ? frase : '')
    },
    [teto, frase],
  )

  // Sem lista de dependências de propósito: o campo é NÃO controlado nos dois
  // consumidores de servidor (`paineis.tsx`), então o valor muda sem re-render —
  // quem cobre a digitação é o `onInput`. Este efeito cobre a outra ponta: o
  // valor inicial (um `defaultValue` já longo) e o campo controlado do wizard.
  React.useEffect(() => {
    conferir(meu.current)
  })

  return (
    <input
      {...props}
      ref={(el) => {
        meu.current = el
        if (typeof refDeFora === 'function') refDeFora(el)
        else if (refDeFora) refDeFora.current = el
      }}
      onInput={(e) => {
        // A ordem importa: a validade é atualizada AQUI, no alvo, antes de o
        // evento subir para o `onInput` do `FormValidado` (que é quem apaga o
        // erro de um campo já corrigido).
        conferir(e.currentTarget)
        onInput?.(e)
      }}
    />
  )
}
