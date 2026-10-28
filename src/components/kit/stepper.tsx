// STEPPER DO KIT (Onda 1 · M4-3) — a fileira de círculos numerados no topo dos
// painéis de várias etapas.
//
// De onde veio: era a função `Passos` do wizard de admissão (M3-3), medida no
// "Add New Student" do TutorBird. Ela sobe para o kit sem UM pixel de mudança,
// porque agora dois wizards a desenham — admissão de aluno e criação de
// contrato — e duas cópias divergiriam no primeiro ajuste.
//
// ANATOMIA MEDIDA: círculo numerado, rótulo ao lado, passo feito virando ✓ com
// o fundo do acento, passo atual com anel do acento, passo futuro em contorno
// neutro; fio de 24px entre um passo e o seguinte.
//
// RESPIRO (M3-c3 · A1) — a captura do dono mostrava o círculo "1" encostando na
// hairline do cabeçalho do painel, com o anel do passo atual CORTADO. Duas
// causas somadas, e as duas moram aqui:
//   1. o stepper é o primeiro filho do `SheetBody`, que só tem `pb-8` — sem
//      `pt`, o topo do círculo nascia colado no `border-b` do `SheetHeader`;
//   2. o anel do passo atual (`ring-2` + `ring-offset-2`) mede 4px PARA FORA do
//      círculo e não ocupa espaço no layout; como o corpo do painel é um
//      contêiner de rolagem (`.kit-scroll` → `overflow-y: auto`, que faz o
//      navegador computar o eixo X junto), esses 4px eram simplesmente
//      recortados.
// O `py-5` resolve os dois: 20px iguais em cima e embaixo, e o anel passa a
// caber com folga entre a hairline do cabeçalho e a do próprio stepper.
//
// Server-safe: zero client JS. Quem sabe em que passo está é quem chama.
import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

export type EstadoDoPasso = 'feita' | 'atual' | 'futura'

/** Estado da bolinha `n` (1-based) quando o painel está no passo `atual`. */
export function estadoDoPasso(n: number, atual: number): EstadoDoPasso {
  if (n < atual) return 'feita'
  return n === atual ? 'atual' : 'futura'
}

export function Stepper({
  etapas,
  atual,
  'aria-label': rotulo = 'Etapas',
}: {
  /** os rótulos, na ordem — o comprimento define quantas bolinhas existem */
  etapas: readonly string[]
  /** o passo em que se está (1-based). Maior que o total = tudo concluído. */
  atual: number
  'aria-label'?: string
}) {
  return (
    <nav
      aria-label={rotulo}
      className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-line-soft py-5"
    >
      {etapas.map((rotuloDaEtapa, i) => {
        const n = i + 1
        const estado = estadoDoPasso(n, atual)
        return (
          <span key={rotuloDaEtapa} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums',
                estado === 'feita' && 'border-ac-deep bg-ac-deep text-paper-0',
                estado === 'atual' &&
                  'border-ac-deep bg-paper-0 text-ac-deep ring-2 ring-ac-vivid/40 ring-offset-2 ring-offset-paper-0',
                estado === 'futura' && 'border-line bg-paper-0 text-ink-600',
              )}
            >
              {estado === 'feita' ? <Check className="h-4 w-4" /> : n}
            </span>
            <span
              aria-current={estado === 'atual' ? 'step' : undefined}
              className={cn(
                'text-sm',
                estado === 'atual' ? 'font-semibold text-ink-900' : 'text-ink-600',
              )}
            >
              {rotuloDaEtapa}
              {/* O estado da bolinha é COR e ícone: quem ouve a tela precisa da
                  mesma informação em palavra. */}
              <span className="sr-only">
                {estado === 'feita'
                  ? ' (concluída)'
                  : estado === 'atual'
                    ? ' (etapa atual)'
                    : ' (a fazer)'}
              </span>
            </span>
            {n < etapas.length && <span aria-hidden className="mx-1 h-px w-6 bg-line" />}
          </span>
        )
      })}
    </nav>
  )
}
