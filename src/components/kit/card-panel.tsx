// CARD-CONTÊINER (clonagem TutorBird, 26/07/2026) — o bloco branco grande que
// o dono chama de "card": abas no topo, conteúdo dentro, tudo numa moldura só.
//
// Medido na página Students: o contêiner de trabalho é FLAT — anel de 1px e
// raio 8px, SEM sombra. É o oposto do cartão de KPI da home (sombra 0 8px 16px,
// raio 12, sem borda). Os dois papéis coexistem de propósito: elevação é
// destaque de número; anel é moldura de trabalho. Misturar os dois (hairline +
// sombra larga no mesmo cartão) continua proibido.
//
// Server-safe: zero client JS. As abas são âncoras de verdade (`<Link>`), com
// `aria-current` — quem muda de aba muda de URL, e o estado sobrevive ao F5.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface PanelTab {
  label: string
  href: string
  active?: boolean
  /** contagem do recorte — DADO, então nunca em cinza apagado */
  count?: number
  /**
   * Badge SOBRE a aba (Onda Financeiro · F1, padrão Stripe: inadimplência é
   * badge sobre "em aberto", nunca aba própria). Vem pronto de quem chama —
   * tipicamente uma `<Pill tone="danger">` — porque o tom é decisão da tela.
   */
  badge?: ReactNode
}

export function CardPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('panel-tb overflow-hidden', className)}>{children}</section>
}

/**
 * Cabeçalho simples do bloco: título bold à esquerda, apoio (data, contagem) ao
 * lado e ações à direita.
 */
export function CardPanelHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Título de SEÇÃO na régua medida (Inter 20/600, tracking −0.8px —
            `.title-section` no globals). Era 18/700: o peso 700 da Inter, ao
            lado do 600 deles, lê como um título mais pesado e menos desenhado. */}
        <h3 className="title-section text-ink-900">{title}</h3>
        {meta && <span className="text-sm text-ink-600 first-letter:uppercase">{meta}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Abas no topo do bloco: a ativa ganha o SUBLINHADO do acento e o texto no
 * acento; as demais ficam em cinza legível e acendem no hover. Sem pílula, sem
 * fundo lavado — é a execução do TutorBird.
 */
export function CardPanelTabs({ tabs, className }: { tabs: PanelTab[]; className?: string }) {
  return (
    <nav
      aria-label="Seções deste bloco"
      className={cn('flex flex-wrap gap-1 border-b border-line px-2', className)}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
            t.active
              ? 'border-ac-deep font-semibold text-ac-deep'
              : 'border-transparent font-medium text-ink-600 hover:border-line hover:text-ink-900',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="text-sm font-semibold tabular-nums text-ink-900">{t.count}</span>
          )}
          {t.badge}
        </Link>
      ))}
    </nav>
  )
}
