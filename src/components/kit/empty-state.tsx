// Estado vazio COMPLETO (clonagem TutorBird, 26/07/2026): ILUSTRAÇÃO grande em
// cima, título 20px/600 quase-preto, UMA frase de apoio e o CTA principal
// repetido no meio da área — o mesmo botão primário da tela. Vazio sem próximo
// passo é beco sem saída.
//
// A ilustração deixou de ser dois arcos de CSS e passou a ser SVG flat do
// unDraw, recolorido no periwinkle da marca (`public/illustrations/README.md`
// registra origem, licença e recoloração). Ela é DECORATIVA: `alt=""`, porque o
// título ao lado já diz tudo o que ela ilustra.
//
// `unoptimized` no `next/image` é obrigatório para SVG — o otimizador do Next
// recusa SVG, e sem isso a imagem simplesmente não pinta em produção.
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function EmptyState({
  title,
  hint,
  cta,
  href,
  action,
  illustration,
  className,
}: {
  title: string
  hint?: string
  /** CTA por link (o caso comum) */
  cta?: string
  href?: string
  /** CTA que não é navegação (abre Sheet, dispara action…) */
  action?: ReactNode
  /** caminho do SVG em /illustrations (sem ilustração, o bloco segue válido) */
  illustration?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-4 rounded-panel px-6 py-10 text-center', className)}>
      {illustration && (
        <Image
          src={illustration}
          alt=""
          aria-hidden
          width={220}
          height={170}
          unoptimized
          className="h-auto w-40 max-w-full sm:w-52"
        />
      )}
      <div className="flex flex-col items-center gap-1.5">
        {/* 20/600 já era o medido; o que faltava era o tracking −0.8px, que é
            metade do que dá o desenho do título deles (`.title-section`). */}
        <p className="title-section text-ink-900">{title}</p>
        {hint && <p className="max-w-md text-sm leading-relaxed text-ink-600">{hint}</p>}
      </div>
      {action ??
        (cta && href ? (
          <Link href={href} className="btn-ac btn-ac-lg">
            {cta}
          </Link>
        ) : null)}
    </div>
  )
}
