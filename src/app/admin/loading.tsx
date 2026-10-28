// Carregamento das telas do admin (revisão adversarial nº 1, C4).
//
// Nasceu junto com a remoção do `<Suspense>` que envolvia o AdminShell inteiro:
// sem aquele fallback (que apagava o admin inteiro), quem cobre a espera de uma
// página é ESTE boundary — e ele fica DENTRO da moldura, que continua na tela.
//
// Mesma régua dos esqueletos do Início: forma real (barra de título + bloco de
// conteúdo), nunca uma barra genérica; o atraso de 200 ms para aparecer mora no
// `.kit-skeleton`.
import { Skeleton, SkeletonRows } from '@/components/kit/skeleton'

export default function AdminLoading() {
  return (
    <main className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-8 w-48" />
      <SkeletonRows rows={5} rowClassName="h-14" />
    </main>
  )
}
