'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { reportClientError, reportPageView } from '@/lib/telemetry/report'

// Componente INVISÍVEL, montado nos três shells internos (admin, teacher,
// portal). Faz duas coisas e nada mais:
//   1. um page_view por mudança de pathname (com debounce, para navegação
//      rápida entre telas não virar três linhas);
//   2. escuta window.onerror e unhandledrejection — o erro que hoje morre na
//      tela do usuário passa a chegar em client_errors.
//
// Nada aqui pode lançar: as funções de src/lib/telemetry/report engolem tudo.
export function UiBeacon() {
  const pathname = usePathname()
  const ultimo = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || ultimo.current === pathname) return
    const id = setTimeout(() => {
      ultimo.current = pathname
      reportPageView(pathname)
    }, 400)
    return () => clearTimeout(id)
  }, [pathname])

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const err = e.error instanceof Error ? e.error : null
      reportClientError(e.message, err?.stack, undefined, err?.name)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason
      reportClientError(
        r instanceof Error ? r.message : `unhandledrejection: ${String(r)}`,
        r instanceof Error ? r.stack : undefined,
        undefined,
        r instanceof Error ? r.name : 'UnhandledRejection',
      )
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
