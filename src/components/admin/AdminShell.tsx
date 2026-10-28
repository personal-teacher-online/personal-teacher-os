// SHELL DO ADMIN — a moldura, na anatomia TutorBird (26/07/2026).
//
//   [ trilho sólido periwinkle ][ barra superior BRANCA · título · conta ]
//                               [ superfície de trabalho em papel        ]
//
// Server component de propósito: as fronteiras de `<Suspense>` cercam APENAS as
// peças de navegação (que leem a URL no cliente) e a leitura da conta. Se elas
// cercassem `children`, qualquer página que suspende faria o trilho inteiro
// piscar — o oposto do "chrome estável, conteúdo muda" que a onda persegue.
//
// A invariante tem uma segunda metade, que o layout violava até a revisão
// adversarial nº 1 (C4): NINGUÉM pode envolver este componente inteiro num
// `<Suspense>` lá de fora. Fazê-lo transforma a suspensão de qualquer página
// legada no desaparecimento do admin inteiro. A espera da página é do
// `src/app/admin/loading.tsx`; as fronteiras de navegação são estas aqui.
//
// O que mudou nesta rodada: nasceu a barra superior branca do desktop (56px,
// sombra sutil, título persistente à esquerda e o menu da conta à direita) e o
// trilho deixou de ser tinta escura para ser o periwinkle sólido da clonagem. O
// celular ficou como estava: barra de tinta em cima, barra de polegar embaixo.
import { Suspense } from 'react'

import { getContaDoAdmin } from '@/data/admin/conta'
import { AdminMobileBar, AdminRail, AdminThumbBar, AdminTopBar } from './AdminNavClient'

/** A barra com a conta já lida — sozinha atrás de uma fronteira de espera. */
async function BarraComConta() {
  return <AdminTopBar conta={await getContaDoAdmin()} />
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* mesma largura do espaçador do trilho (`--rail-w-spacer`): a moldura
          não pode encolher enquanto a nav de verdade não chega */}
      <Suspense
        fallback={<div className="hidden w-(--rail-w-spacer) shrink-0 bg-rail-bg md:block" aria-hidden />}
      >
        <AdminRail />
      </Suspense>

      {/* `overflow-x-clip`: a TESOURA da faixa de lateral a lateral do Início
          (portão visual do dono, 27/07/2026 — regra `.faixa-cheia` no globals).
          A lavagem da banda transborda 100vw para cada lado e é aparada aqui,
          na borda da área de conteúdo: ela nunca passa por baixo do trilho nem
          cria rolagem horizontal, e nada aqui precisa saber a largura dele.
          `clip` (e não `hidden`) porque `clip` não cria caixa de rolagem: a
          barra superior `sticky` e os overlays `fixed` das telas legadas
          continuam ancorados na JANELA, como antes. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip pb-24 md:pb-0">
        <AdminMobileBar />

        {/* O fallback é a MESMA barra sem o nome: a moldura não pisca, só o
            cluster da conta chega depois. */}
        <Suspense fallback={<AdminTopBar />}>
          <BarraComConta />
        </Suspense>

        {/* superfície de TRABALHO — fluida com teto alto (formulário tem largura
            própria dentro das páginas) */}
        <div className="mx-auto w-full max-w-[1720px] px-4 py-6 md:px-6 md:py-8">{children}</div>
      </div>

      <Suspense fallback={<div className="fixed inset-x-0 bottom-0 z-40 h-14 bg-ink-900 md:hidden" aria-hidden />}>
        <AdminThumbBar />
      </Suspense>
    </>
  )
}
