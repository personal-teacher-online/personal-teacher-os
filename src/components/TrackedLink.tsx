'use client'

// Link que ACENDE a barra de navegação via onNavigate — o mecanismo CORRETO do
// contrato (Design.md §"Barra de progresso de navegação": "clique de Link para
// rota interna (via onNavigate)"). Por que não deixar no listener global do
// ClickFeedback: aquele roda em CAPTURA, ANTES do onClick do consumidor, então
// um link que o consumidor cancela (preventDefault) já teria acendido a barra —
// órfã até o watchdog. onNavigate roda DEPOIS da decisão do Next: só dispara
// quando a navegação de fato vai acontecer, e o consumidor pode cancelá-la ali.
//
// TrackedLink marca a âncora com data-tracked-link; o listener global pula
// âncoras marcadas (não há duplo-acender nem órfão em cancelamento). Links
// comuns (a esmagadora maioria, sem onClick/cancelamento) seguem no listener
// global — casando com o padrão atual sem trocar 156 <Link>.

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { shouldTrackNavigation, startNavProgress } from '@/lib/nav-progress'

type LinkProps = ComponentProps<typeof Link>
// O evento do onNavigate do Next expõe SÓ preventDefault() (sem defaultPrevented).
// Para saber se o consumidor cancelou, entregamos um preventDefault embrulhado
// que levanta uma flag além de cancelar de verdade a navegação do Next.
type NavigateEvent = Parameters<NonNullable<LinkProps['onNavigate']>>[0]

export function TrackedLink({ onNavigate, ...props }: LinkProps) {
  const handleNavigate: NonNullable<LinkProps['onNavigate']> = (event) => {
    let cancelled = false
    const proxied: NavigateEvent = {
      ...event,
      preventDefault: () => {
        cancelled = true
        event.preventDefault() // cancela a navegação do Next de fato
      },
    }
    // 1) o consumidor decide primeiro (pode chamar preventDefault()).
    onNavigate?.(proxied)
    // 2) cancelado → barra NÃO acende.
    if (cancelled) return
    // 3) URL final igual à atual / hash na mesma página não trocam o shell.
    //    (href não-string = UrlObject: onNavigate já garante navegação interna.)
    const hrefStr = typeof props.href === 'string' ? props.href : null
    if (hrefStr === null || shouldTrackNavigation(hrefStr, window.location.href)) {
      startNavProgress()
    }
  }

  return <Link {...props} data-tracked-link="" onNavigate={handleNavigate} />
}
