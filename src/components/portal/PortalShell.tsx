// SHELL DO PORTAL DO ALUNO (Onda do Portal · P1) — a moldura, no kit da Onda 1.
//
//   [ faixa de tinta: marca · conta ]
//   [ fio-assinatura                ]
//   [ fila de seções (md+)          ]      [ barra de polegar (celular) ]
//   [ superfície de papel           ]
//
// Server component de propósito, e sem consulta própria: as duas perguntas da
// moldura (o fuso cadastrado e "o aluno é do Personal Travel?") são disparadas
// JUNTAS pelo layout e chegam aqui prontas, por prop (P1 · G5). Sem `<Suspense>`
// nenhum aqui dentro, e ninguém pode envolver ESTE componente num de fora (é a
// lição C4 do admin).
//
// POR QUE O LAYOUT ESPERA, e não desenha com um fallback (revisão adversarial
// P1 · F5). A barra do polegar tem 4 colunas sem mentoria e 5 com ela: desenhar
// 4 e trocar por 5 quando a resposta chega MOVE os alvos debaixo do dedo de quem
// já estava tocando — o aluno abre "Pagamentos" e cai em "Mentoria". Numa escala
// de 20–50 alunos, uma leitura com `limit 1` sob RLS não é o que segura esta
// tela — e agora ela nem sequer é a segunda de uma fila.
import Image from 'next/image'
import Link from 'next/link'
import { UserRound } from 'lucide-react'

import { MARCA } from '@/lib/brand/constants'
import { TzMismatch } from '@/components/TzMismatch'
import { PortalNavClient } from './PortalNavClient'
import { itensDoPortal } from './nav'

export function PortalShell({
  tz,
  temMentoria,
  children,
}: {
  tz: string | null
  temMentoria: boolean
  children: React.ReactNode
}) {
  const itens = itensDoPortal(temMentoria)

  return (
    <>
      <header className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3 md:px-8">
        <span className="flex items-center gap-2.5">
          <Image src={MARCA.simboloBranco} alt="" width={22} height={22} className="h-[22px] w-[22px] opacity-90" />
          <span className="font-display text-[15px] font-bold text-white">{MARCA.escola}</span>
        </span>
        {/* NAV-2 (auditoria 23/07): a conta mora no topo direito — convenção
            universal. Tinta em 85% de branco, não 60%: aqui é ação, e ação
            apagada foi justamente o que o dono reprovou (régua do AGENTS).
            `min-h-11 sm:min-h-9` (F7): no celular estes dois são alvo de DEDO,
            e 36px é menos que os 44px de alvo de toque; no desktop, onde o
            ponteiro tem precisão, a altura compacta volta. */}
        <span className="flex items-center gap-1">
          <Link
            href="/portal/perfil"
            className="flex min-h-11 items-center gap-1.5 rounded-input px-3 py-1.5 text-sm font-medium text-white/85 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-white/10 hover:text-white sm:min-h-9"
          >
            <UserRound className="h-4 w-4" />
            <span className="hidden sm:inline">Seu perfil</span>
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="min-h-11 rounded-input px-3 py-1.5 text-sm font-medium text-white/85 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-white/10 hover:text-white sm:min-h-9"
            >
              Sair
            </button>
          </form>
        </span>
      </header>

      <div className="brand-thread" aria-hidden />

      <PortalNavClient itens={itens} />

      {/* superfície de TRABALHO — largura intocada. A folga da barra de polegar
          (`pb-24 md:pb-0`) mora no wrapper do layout, como no `AdminShell`: a
          barra é `fixed` e não empurra nada, então sem a folga o último cartão
          de toda página fica debaixo dela. */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 md:max-w-4xl md:px-6">
        {/* item 7: aviso de fuso SÓ na exceção (offset do navegador ≠ do cadastro) */}
        {tz && <TzMismatch tz={tz} />}
        {children}
      </div>
    </>
  )
}
