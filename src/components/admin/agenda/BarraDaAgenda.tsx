// TOOLBAR BIPARTIDA DA AGENDA (Onda da Agenda · A1).
//
// A anatomia do esqueleto universal (`ia-site-2026-07.md` §Modelo de navegação,
// medida no TutorBird): **criar/agir à esquerda** (botão dividido `[+ ▾]`),
// **ver/buscar à direita**. A agenda velha misturava as duas naturezas numa
// fileira só de chips rolável — publicar horário, criar aula, trocar de visão e
// filtrar professora tinham todos o mesmo peso visual, e os dois links de criar
// aula ficavam SOLTOS abaixo da fileira, sem moldura.
//
// Server component: tudo aqui é `<Link>`. O único cliente é o `SplitButton`
// (menu do Radix), que já é do kit.
//
// A COR É DA PROFESSORA (EIXO 1 da matriz M-AG): a bolinha do filtro usa o
// mesmo token que o bloco dela na grade, então filtrar e ler a grade falam a
// mesma língua. Precedente: `AndarHoje` do Início importa `TEACHER_FILL` daqui
// mesmo.
import Link from 'next/link'
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'

import { SplitButton } from '@/components/kit/split-button'
import { TEACHER_FILL } from '@/components/ui'
import { VISAO_ROTULO, VISOES, type AgendaDoAdmin } from '@/data/admin/agenda'
import { comMudanca, type EstadoDaAgenda } from '@/data/admin/agenda-endereco'
import { cn } from '@/lib/cn'

/** Segmento de "ver por": mesma peça do `verPor` do hub de Alunos. */
function Segmento({ href, ativo, children }: { href: string; ativo: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
        ativo
          ? 'bg-ac-wash font-semibold text-ac-deep'
          : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
      )}
    >
      {children}
    </Link>
  )
}

export function BarraDaAgenda({
  agenda,
  estado,
  novoHref,
}: {
  agenda: AgendaDoAdmin
  estado: EstadoDaAgenda
  /** monta o endereço de um painel de criação (`?novo=…`) */
  novoHref: (qual: string) => string
}) {
  const { hojeISO } = agenda
  const ir = (m: Partial<EstadoDaAgenda>) => comMudanca(estado, m, hojeISO)
  const naGrade = agenda.visao !== 'lista' && agenda.visao !== 'pendencias'

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3">
      {/* ------------------------------------------------- ESQUERDA: criar */}
      <div className="flex flex-wrap items-center gap-3">
        <SplitButton
          label="Nova aula"
          href={novoHref('avulsa')}
          icon={<CalendarPlus className="h-4 w-4" />}
          options={[
            {
              label: 'Aula avulsa',
              href: novoHref('avulsa'),
              hint: 'para quem já é aluno — extra cobrada ou cortesia',
            },
            {
              label: 'Aula experimental',
              href: novoHref('experimental'),
              hint: 'pessoa nova: cria a pessoa e um contrato leve junto',
            },
            {
              label: 'Horário aberto',
              href: novoHref('horario'),
              hint: 'oferta um horário para os alunos remarcarem',
            },
            {
              label: 'Período ou férias',
              href: '/admin/agenda/periodo',
              hint: 'bloqueia a oferta e trata as aulas do intervalo em lote',
            },
            {
              label: 'Disponibilidade e bloqueios',
              href: novoHref('disponibilidade'),
              hint: 'janelas semanais e períodos fechados da professora',
            },
          ]}
        />

        {/* Navegação no tempo: fica do lado de CRIAR porque mover a janela é
            gesto de trabalho, não de configuração da visão. O rótulo é DADO
            (responde "que período estou vendo?") — nunca em cinza apagado. */}
        {agenda.anterior && agenda.proximo && (
          <nav aria-label="Navegar no tempo" className="flex items-center gap-1">
            <Link
              href={ir({ ancora: agenda.anterior })}
              aria-label="Período anterior"
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-input text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <Link
              href={ir({ ancora: hojeISO })}
              className="inline-flex min-h-9 items-center rounded-input px-3 text-sm font-medium text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
            >
              Hoje
            </Link>
            <Link
              href={ir({ ancora: agenda.proximo })}
              aria-label="Próximo período"
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-input text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </nav>
        )}
        {/* Régua MEDIDA do TutorBird (A2): o título do período é o mesmo degrau
            do título de empty/seção (20px/600, `.title-section`), NA COR DA
            MARCA — como o título do mês no calendário deles. */}
        {/* Cor da marca ENTRA pelo token de acento (--ac-deep = o pigmento da
            marca): a varredura da Onda 1 proíbe brand-* cru em componente. */}
        <span className="title-section text-ac-deep first-letter:uppercase">{agenda.rotulo}</span>
      </div>

      {/* ----------------------------------------------------- DIREITA: ver */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label="Visão da agenda" className="flex flex-wrap items-center gap-1">
          {VISOES.map((v) => (
            <Segmento key={v} href={ir({ visao: v })} ativo={agenda.visao === v}>
              {VISAO_ROTULO[v]}
            </Segmento>
          ))}
        </nav>

        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />

        <nav aria-label="Filtrar por professora" className="flex flex-wrap items-center gap-1">
          <Segmento href={ir({ professora: undefined })} ativo={!estado.professora}>
            Todas
          </Segmento>
          {agenda.professoras.map((t) => (
            <Segmento key={t.id} href={ir({ professora: t.id })} ativo={estado.professora === t.id}>
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full', TEACHER_FILL[t.idx % TEACHER_FILL.length])}
              />
              {t.nome}
            </Segmento>
          ))}
        </nav>

        {naGrade && (
          <>
            <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
            <Segmento href={ir({ comJanelas: !estado.comJanelas })} ativo={estado.comJanelas}>
              Horários abertos
            </Segmento>
          </>
        )}
      </div>
    </div>
  )
}
