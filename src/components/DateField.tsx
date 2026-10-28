'use client'

// QA de UX 14/07/2026 (exceção client aprovada): o <input type="date"> nativo
// exibe segmentos "dd/mm/aaaa" que parecem pré-preenchidos. Aqui o usuário vê
// um input de TEXTO, digita só dígitos e as barras entram sozinhas; um hidden
// carrega o ISO yyyy-MM-dd para a action (vazio enquanto incompleto). A
// validação REAL continua nas actions/banco (Lei 3) — o pattern do input
// visível só antecipa o erro de formato para UX.
import { useEffect, useRef, useState } from 'react'

// Cópia literal da classe `input` de src/components/ui.tsx — NÃO importar de
// lá, para não criar dependência server→client desnecessária.
const INPUT_CLS =
  'min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600'

function mask(digits: string): string {
  const d = digits.slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

function displayToISO(text: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function isoToDisplay(iso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

export function DateField({
  name,
  defaultValue,
  required,
  min,
  max,
  aoMudar,
  className = INPUT_CLS,
}: {
  name: string
  /** ISO yyyy-MM-dd — exibido como dd/mm/aaaa. */
  defaultValue?: string
  required?: boolean
  /**
   * Primeira data ACEITÁVEL (ISO yyyy-MM-dd). Como o campo visível é de TEXTO
   * mascarado, o `min` nativo do `type=date` não existe aqui: a antecipação é
   * `setCustomValidity`, e quem recusa de verdade continua sendo o banco (Lei
   * 3 — a extensão de validade é monotônica lá dentro, sob lock).
   */
  min?: string
  /**
   * Avisa o valor COMPLETO (ISO yyyy-MM-dd) ou vazio enquanto a digitação não
   * fecha — o mesmo contrato que o `TimeField` já oferecia. Existe para quem
   * precisa REFLETIR o que está no campo (o cabeçalho do balão da agenda dizia
   * o valor calculado, não o editado — Sol · rodada 2 do A4, médio 1).
   * Não é chamado quando o `defaultValue` muda por navegação: aquilo é o valor
   * que quem chama acabou de empurrar, e ele já o conhece.
   */
  aoMudar?: (valor: string) => void
  /**
   * ÚLTIMA data aceitável (ISO yyyy-MM-dd), pelo mesmo mecanismo do `min`
   * (M4-2). Existe por causa da renovação: `admin_renew_contract` recusa virada
   * a mais de 8 semanas ("a virada precisa estar a no máximo 8 semanas"), e a
   * tela antecipa esse teto no próprio campo em vez de deixar a pessoa preencher
   * o formulário inteiro para ouvir um erro de Postgres no fim.
   */
  max?: string
  className?: string
}) {
  const [text, setText] = useState(() => isoToDisplay(defaultValue))
  const visivel = useRef<HTMLInputElement>(null)
  const iso = displayToISO(text)
  useEffect(() => {
    const el = visivel.current
    if (!el) return
    el.setCustomValidity(
      min && iso && iso < min
        ? `Escolha uma data a partir de ${isoToDisplay(min)}.`
        : max && iso && iso > max
          ? `Escolha uma data até ${isoToDisplay(max)}.`
          : '',
    )
  }, [iso, min, max])
  // Pré-preenchimento por navegação (ex.: clique na grade muda ?nd=): o
  // componente já está montado, então a mudança da prop é derivada no render.
  const [prevDefault, setPrevDefault] = useState(defaultValue)
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue)
    setText(isoToDisplay(defaultValue))
  }
  return (
    <>
      <input
        ref={visivel}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        title="dd/mm/aaaa"
        maxLength={10}
        required={required}
        pattern="\d{2}/\d{2}/\d{4}"
        value={text}
        onChange={(e) => {
          const novo = mask(e.target.value.replace(/\D/g, ''))
          setText(novo)
          aoMudar?.(displayToISO(novo))
        }}
        className={className}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  )
}
