'use client'

// QA de UX 14/07/2026 (exceção client aprovada): par do DateField para hora —
// input de TEXTO com dois-pontos automático (HH:mm); um hidden carrega HH:mm
// para a action (vazio enquanto incompleto). A validação REAL continua nas
// actions/banco (Lei 3) — o pattern só antecipa o erro de formato para UX.
import { useEffect, useRef, useState } from 'react'

// Cópia literal da classe `input` de src/components/ui.tsx — NÃO importar de
// lá, para não criar dependência server→client desnecessária.
const INPUT_CLS =
  'min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors focus:border-brand-600'

function mask(digits: string): string {
  const d = digits.slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

const COMPLETE = /^\d{2}:\d{2}$/

export function TimeField({
  name,
  defaultValue,
  required,
  problema,
  aoMudar,
  className = INPUT_CLS,
}: {
  name: string
  /** HH:mm — exibido como digitado. */
  defaultValue?: string
  required?: boolean
  /**
   * M3-c4 · B5 — motivo pelo qual ESTA hora não serve, decidido por quem usa o
   * campo (no wizard: a professora já tem aula nesse horário). Vira
   * `setCustomValidity`, então o `FormValidado` do kit mostra a frase embaixo
   * do campo e trava o envio. Quem recusa DE VERDADE continua sendo o banco
   * (Lei 3 — `class_instances_teacher_no_overlap_excl`); isto é antecipação.
   */
  problema?: string | null
  /** avisa o valor completo (HH:mm) ou vazio, para quem precisa reagir a ele */
  aoMudar?: (valor: string) => void
  className?: string
}) {
  const [text, setText] = useState(() =>
    defaultValue && COMPLETE.test(defaultValue) ? defaultValue : '',
  )
  const visivel = useRef<HTMLInputElement>(null)
  useEffect(() => {
    visivel.current?.setCustomValidity(problema ?? '')
  }, [problema, text])
  // Pré-preenchimento por navegação (ex.: clique na grade muda ?nt=): o
  // componente já está montado, então a mudança da prop é derivada no render.
  const [prevDefault, setPrevDefault] = useState(defaultValue)
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue)
    setText(defaultValue && COMPLETE.test(defaultValue) ? defaultValue : '')
  }
  return (
    <>
      <input
        ref={visivel}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        title="HH:mm"
        maxLength={5}
        required={required}
        pattern="\d{2}:\d{2}"
        value={text}
        onChange={(e) => {
          const novo = mask(e.target.value.replace(/\D/g, ''))
          setText(novo)
          aoMudar?.(COMPLETE.test(novo) ? novo : '')
        }}
        className={className}
      />
      <input type="hidden" name={name} value={COMPLETE.test(text) ? text : ''} />
    </>
  )
}
