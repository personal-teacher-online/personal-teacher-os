'use client'

// Item 6 do e2e (Leva 0: checklist CLÁSSICO) — campo de senha com barra de
// força e checklist VIVO. O checklist NUNCA mente: os mesmos requisitos de
// src/lib/auth/password.ts valem na action (validatePasswordPair) e no GoTrue
// (password_requirements) — UI, servidor e Auth contam a mesma história.
import { useState } from 'react'
import { PASSWORD_RULES } from '@/lib/auth/password'

const NIVEIS = [
  { max: 2, label: 'fraca', bar: 'w-1/4 bg-danger-700' },
  { max: 4, label: 'média', bar: 'w-2/4 bg-warn-700' },
  { max: 5, label: 'forte', bar: 'w-full bg-ok-700' },
] as const

export function PasswordField({
  name,
  id,
  className,
  dark,
  minLength,
}: {
  name: string
  id?: string
  className: string
  /** capa noturna (definir-senha) × papel (perfil) */
  dark?: boolean
  minLength?: number
}) {
  const [value, setValue] = useState('')
  const ok = PASSWORD_RULES.filter((r) => r.test(value)).length
  const nivel = NIVEIS.find((n) => ok <= n.max) ?? NIVEIS[2]
  const muted = dark ? 'text-text-mid' : 'text-ink-400'
  const done = dark ? 'text-accent-turquoise' : 'text-ok-700'

  return (
    <div className="flex flex-col gap-2">
      <input
        id={id}
        name={name}
        type="password"
        required
        minLength={minLength}
        autoComplete="new-password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={className}
      />
      {value.length > 0 && (
        <>
          <span className={`flex items-center gap-2 text-xs ${muted}`}>
            <span className={`h-1 flex-1 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-paper-100'}`}>
              <span className={`block h-full rounded-full transition-all ${nivel.bar}`} />
            </span>
            {nivel.label}
          </span>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {PASSWORD_RULES.map((r) => {
              const passed = r.test(value)
              return (
                <li key={r.key} className={passed ? done : muted}>
                  {passed ? '✓' : '○'} {r.label}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
