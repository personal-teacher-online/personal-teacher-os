// Esqueleto de carregamento (Onda 1 · M1, item 7).
//
// Contrato de motion (PLANO-CLONAGEM §4): ATRASO de 150–300 ms para aparecer —
// resposta rápida não pode piscar esqueleto — e forma REAL, nunca uma barra
// genérica: quem usa passa a altura/largura do conteúdo que vai entrar ali.
// O atraso e o pulso moram no `.kit-skeleton` (globals.css).
import { cn } from '@/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('kit-skeleton', className)} />
}

/** Lista de linhas com a MESMA altura da linha real (não "3 barras cinzas"). */
export function SkeletonRows({
  rows = 3,
  rowClassName = 'h-14',
  className,
}: {
  rows?: number
  rowClassName?: string
  className?: string
}) {
  return (
    <div
      className={cn('divide-y divide-line-soft overflow-hidden rounded-card border border-line-soft', className)}
      // O leitor de tela anuncia "carregando" uma vez; as formas são aria-hidden.
      role="status"
      aria-label="Carregando"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex items-center gap-3 px-4', rowClassName)}>
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
