'use client'

import { useState } from 'react'
import { btnInkSm } from '@/components/ui'

/** Copiar texto (legenda) para a área de transferência — feedback inline,
 *  sem toast: o rótulo do próprio botão confirma (padrão de microcopy da casa). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={btnInkSm}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        } catch {
          // Clipboard bloqueado (contexto sem permissão): o texto está na tela —
          // não há degradação silenciosa a esconder.
          setCopied(false)
        }
      }}
    >
      {copied ? 'Copiado ✔' : label}
    </button>
  )
}
