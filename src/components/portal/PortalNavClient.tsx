'use client'

// PEÇAS DE NAVEGAÇÃO DO PORTAL (Onda do Portal · P1).
//
// Client component SÓ pelo `usePathname` (item aceso) — zero fetch, zero regra
// de negócio. Quem descobre se existe aba Mentoria é o servidor; aqui só chega
// a lista pronta (`ItemDoPortal[]`, dados puros e serializáveis).
//
// Duas formas, uma lista:
// · DESKTOP (md+): fila horizontal logo abaixo da faixa de tinta, na voz da
//   navegação da casa (`.nav-tb`). Aceso = lavagem `--ac-tint` com texto
//   `--ac-deep` — a mesma dupla que o admin usa para dizer "é aqui".
// · CELULAR: barra INFERIOR fixa, no polegar (o padrão do `AdminThumbBar`).
//   Cabem os 4 itens — 5 com Mentoria —, então não existe menu "Mais": nenhum
//   destino do aluno fica escondido atrás de um segundo toque.
//
// Os dois <nav> vivem sempre no DOM e se alternam por `display` (`hidden md:…`
// × `md:hidden`), que TIRA o escondido da árvore de acessibilidade — nunca há
// dois landmarks de navegação anunciados ao mesmo tempo.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, CreditCard, GraduationCap, House, UserRound } from 'lucide-react'
import type { ComponentType } from 'react'

import { itemAtivo, type ItemDoPortal } from './nav'

/** O ícone é escolha de DESENHO, não de navegação: mora aqui, e não no
 *  `nav.ts` (que precisa continuar server-safe). Rota sem ícone cai no símbolo
 *  do próprio portal. */
const ICONES: Record<string, ComponentType<{ className?: string }>> = {
  '/portal': House,
  '/portal/aulas': CalendarDays,
  '/portal/pagamentos': CreditCard,
  '/portal/mentoria': GraduationCap,
  '/portal/perfil': UserRound,
}

export function PortalNavClient({ itens }: { itens: ItemDoPortal[] }) {
  const pathname = usePathname()

  return (
    <>
      {/* ------------------------------------------------------- desktop */}
      <nav
        aria-label="Seções do portal"
        className="hidden border-b border-line bg-paper-0 md:block"
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-1 px-6">
          {itens.map((item) => {
            const Icone = ICONES[item.href] ?? House
            const ativo = itemAtivo(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={`nav-tb my-2 flex min-h-11 items-center gap-2 rounded-input px-3 transition-colors duration-(--duration-hover) ease-(--ease-in-out) ${
                  ativo
                    ? 'bg-ac-tint font-medium text-ac-deep'
                    : 'text-ink-600 hover:bg-paper-100 hover:text-ink-900'
                }`}
              >
                <Icone className="h-[18px] w-[18px]" />
                {item.rotulo}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* ------------------------------------------------------- celular */}
      {/* z-40 = nav flutuante na escala da casa (abaixo do toast, que é 60).
          `pb-[env(safe-area-inset-bottom)]`: a barra encosta na borda do
          aparelho sem ficar debaixo do risco do iPhone. */}
      <nav
        aria-label="Seções do portal"
        className={`fixed inset-x-0 bottom-0 z-40 grid bg-ac-nav-bg pb-[env(safe-area-inset-bottom)] md:hidden ${
          itens.length === 5 ? 'grid-cols-5' : 'grid-cols-4'
        }`}
      >
        {itens.map((item) => {
          const Icone = ICONES[item.href] ?? House
          const ativo = itemAtivo(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              // min-h-14 (56px) > os 44px de alvo de toque exigidos.
              // A tinta do item inerte é branco a 80% — não menos: sobre o
              // `--ac-nav-bg` (#4a50b5) isso dá 4,99:1, e a 65% cairia para
              // 3,88:1, reprovado em AA justamente no rótulo de 11px.
              // `min-w-0` + `truncate` no rótulo (P1 · F8): com 5 colunas num
              // aparelho estreito, "Pagamentos" é a palavra que estoura a
              // célula — e célula de grade só encolhe abaixo do conteúdo com
              // `min-w-0`. O nome corta com reticências em vez de empurrar a
              // barra (que o `overflow-x-clip` do layout apararia calada).
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[11px] ${
                ativo ? 'font-semibold text-ac-nav-fg' : 'font-medium text-ac-nav-fg/80'
              }`}
            >
              {/* O aceso ganha uma lozango clara atrás do ícone: sobre o fundo
                  da nav, mudar só o peso da letra não é diferença que se veja
                  de relance. */}
              <span className={`flex items-center rounded-input px-3 py-0.5 ${ativo ? 'bg-white/20' : ''}`}>
                <Icone className="h-5 w-5" />
              </span>
              <span className="w-full truncate px-1 text-center">{item.rotulo}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
