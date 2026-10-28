// ESQUELETO UNIVERSAL DE TELA (Onda 1 · M1, item 8 — PLANO-CLONAGEM §2).
//
//   barra com TÍTULO persistente (+ breadcrumb e CONTAGEM)
//   abas
//   toolbar BIPARTIDA — esquerda cria/age · direita vê/busca
//   conteúdo (fica com a página)
//
// É a peça que dá "produto único": toda seção nova abre igual. Server-safe
// (zero client JS) — o que precisa de estado entra como children.
//
// Regras que viajam junto:
// · o título vive AQUI, nunca dentro do conteúdo;
// · a contagem muda junto com a visão (é o feedback de mudança de nível, item 7);
// · ação nunca em `text-xs` — os slots são dimensionados para `text-sm`;
// · controle que depende de seleção nasce DESABILITADO (quem monta o slot
//   `view`/`create` decide, mas o espaço já é dele).
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface Crumb {
  label: string
  href?: string
}

export interface PageTab {
  label: string
  href: string
  active?: boolean
  count?: number
}

export function PageBar({
  title,
  breadcrumb,
  count,
  subtitle,
  tabs,
  create,
  view,
  className,
}: {
  title: string
  breadcrumb?: Crumb[]
  /** contagem do recorte em vista (N2/N3); muda com o filtro */
  count?: number
  subtitle?: ReactNode
  tabs?: PageTab[]
  /** esquerda da toolbar: criar / agir */
  create?: ReactNode
  /** direita da toolbar: ver / buscar */
  view?: ReactNode
  className?: string
}) {
  const temToolbar = Boolean(create || view)
  return (
    <div
      className={cn(
        // `md:top-14` = a altura da barra superior branca do shell (56px), que
        // nasceu na clonagem TutorBird: sem o deslocamento, esta barra grudaria
        // POR BAIXO dela e o título sumiria ao rolar.
        'sticky top-0 z-20 -mx-4 mb-6 border-b border-line bg-paper-50/95 px-4 pt-4 pb-3 backdrop-blur-sm max-md:static md:-mx-6 md:top-14 md:px-6',
        className,
      )}
    >
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Trilha" className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
          {breadcrumb.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>›</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-ac-deep hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-bold text-ink-900">{title}</h2>
        {count !== undefined && (
          <span className="text-sm font-semibold tabular-nums text-ink-400" data-testid="page-count">
            ({count})
          </span>
        )}
        {subtitle && <p className="w-full text-sm text-ink-600 md:w-auto">{subtitle}</p>}
      </div>

      {tabs && tabs.length > 0 && (
        <nav aria-label="Seções desta tela" className="mt-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-out)',
                t.active
                  ? 'bg-ac-wash font-semibold text-ac-deep shadow-[inset_0_-2px_0_0_var(--ac-vivid)]'
                  : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="tabular-nums text-ink-400">{t.count}</span>}
            </Link>
          ))}
        </nav>
      )}

      {temToolbar && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">{create}</div>
          <div className="flex flex-wrap items-center gap-2">{view}</div>
        </div>
      )}
    </div>
  )
}
