'use client'

// Wrapper de useRouter que ACENDE a barra de navegação em push/replace.
// Contrato: Design.md §"Barra de progresso de navegação" — a navegação
// imperativa "DEVE passar por um wrapper useTrackedRouter; o uso direto de
// useRouter().push/replace é PROIBIDO" (sem ele a barra não enxerga a
// navegação). M-EF-b cria este hook.
//
// Substituto 1:1 de useRouter: back/forward/refresh/prefetch vêm INTACTOS pelo
// spread (prefetch mantém onInvalidate); push/replace são reembrulhados com
// tipos DERIVADOS do próprio router (Parameters<…>), então nada é estreitado
// (transitionTypes do Next 16 continua valendo). Retorno tipado como o próprio
// ReturnType<typeof useRouter>. Só acende quando a navegação troca o shell
// (shouldTrackNavigation): URL final igual à atual, hash na mesma página ou
// origem externa não iniciam. A conclusão é observada pelo ClickFeedback no
// commit de pathname/search.

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { shouldTrackNavigation, startNavProgress } from './nav-progress'

export function useTrackedRouter(): ReturnType<typeof useRouter> {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useMemo(() => {
    const search = searchParams?.toString()
    const currentHref =
      typeof window !== 'undefined' ? window.location.href : `${pathname}${search ? `?${search}` : ''}`

    const track = (href: string) => {
      if (shouldTrackNavigation(href, currentHref)) startNavProgress()
    }

    return {
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        track(args[0])
        return router.push(...args)
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        track(args[0])
        return router.replace(...args)
      },
    }
  }, [router, pathname, searchParams])
}
