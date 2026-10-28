'use client'

// BOTÃO DIVIDIDO "+ Novo ▾" (clonagem TutorBird, 26/07/2026) — o corpo dispara
// a AÇÃO PADRÃO; a seta abre as variantes. É o canto esquerdo da toolbar
// bipartida do esqueleto de tela (PLANO-CLONAGEM-UX §2) e nasce aqui porque o
// hub de Alunos (M3) abre com ele: [+ Novo aluno ▾] → aluno · turma · convite.
//
// Geometria = a do `.btn-ac` (h36, radius 6, 600/14px); a divisão é só o raio
// de cada metade e o fio vertical entre elas. Itens do menu em 14px com 32px de
// altura, como medido no TutorBird.
//
// FUSÃO (M3-c1 · C1): as duas metades vivem no MESMO retângulo — corpo à
// esquerda com o raio só nas pontas de fora, fio de 1px no acento escurecido,
// seta à direita. A versão anterior tentava isso por utility
// (`rounded-r-none`, `border-l border-white/25`, `px-2`) e não conseguia:
// `.btn-ac` é unlayered e vence utility do Tailwind, então as duas metades
// saíam com o raio CHEIO e o fio branco no meio — dois botões encostados, com
// a fresta que o dono reprovou. A anatomia agora mora em `.split-ac*`, no
// globals.css (seletores compostos, que ganham por especificidade).
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu'
import { cn } from '@/lib/cn'

export interface SplitOption {
  label: string
  href: string
  /** uma frase dizendo o que a variante faz (régua do TutorBird) */
  hint?: string
}

export function SplitButton({
  label,
  href,
  options,
  icon,
  className,
}: {
  /** rótulo da ação PADRÃO (o corpo do botão) */
  label: string
  /** destino da ação padrão */
  href: string
  /** as variantes, na seta */
  options: SplitOption[]
  icon?: ReactNode
  className?: string
}) {
  return (
    <span className={cn('split-ac', className)}>
      <Link href={href} className="btn-ac split-ac-main">
        {icon}
        {label}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Mais opções de ${label.toLowerCase()}`}
          className="btn-ac split-ac-arrow"
        >
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 gap-0.5 p-1.5">
          {options.map((o) => (
            <DropdownMenuItem key={o.href} asChild>
              {/* VOZ DA NAVEGAÇÃO no menu (lote 10): o menu suspenso deles é
                  peça MATERIAL — Roboto 14/400 —, não conteúdo. O corpo do
                  botão continua Inter 600/14 (é ação, não navegação): a
                  divisão de famílias do TutorBird é por natureza da peça, e
                  este componente tem as duas naturezas dentro de si.
                  O rótulo perdeu o `font-medium`: o que separa rótulo de dica
                  aqui é a COR (ink-900 × ink-600), como no original. */}
              <Link href={o.href} className="nav-tb-item min-h-8 flex-col items-start gap-0 py-1.5">
                <span className="text-ink-900">{o.label}</span>
                {o.hint && <span className="text-ink-600">{o.hint}</span>}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
