// ANDAR "HOJE" DO INÍCIO — o que pede AÇÃO, fisicamente separado dos números do
// negócio (pesquisa 07: Jackrabbit separa "Key Metrics" de "Alerts").
//
// Clonagem TutorBird (captura 16, 26/07/2026): a agenda do dia mora DENTRO de um
// card-contêiner — bloco branco com anel de 1px, cabeçalho simples ("Hoje" bold
// + a data) e as linhas separadas por hairline. As pendências viraram cartões
// pequenos com ícone em círculo e número bold, clicáveis, na mesma anatomia dos
// KPIs — antes eram links de texto em fila, que a régua de legibilidade proíbe
// como ação.
//
// Linha da agenda: hora bold tabular · aluno · nível · professora · estado ·
// AÇÃO COMO BOTÃO. A linha NÃO é clicável (nada de onClick em <li>): quem
// navega é a âncora real do nome do aluno.
import Link from 'next/link'
import { ClipboardList, Mail, NotebookPen } from 'lucide-react'

import { CardPanel, CardPanelHeader } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { InstanteTexto } from '@/components/kit/instant'
import { Pill, type PillTone } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import type { AdminHoje as DadosDeHoje, SituacaoDaAula } from '@/data/admin/home'
import { CartaoKpi } from './CartaoKpi'
import { RESERVA_AGENDA, RESERVA_PENDENCIAS } from './geometria'
import { RegistrarDesfecho } from './RegistrarDesfecho'

const SITUACAO: Record<SituacaoDaAula, { rotulo: string; tom: PillTone }> = {
  agendada: { rotulo: 'agendada', tom: 'neutral' },
  sem_registro: { rotulo: 'sem registro', tom: 'warn' },
  realizada: { rotulo: 'realizada', tom: 'ok' },
  falta_aluno: { rotulo: 'aluno faltou', tom: 'danger' },
  falta_professora: { rotulo: 'professora faltou', tom: 'danger' },
  cancelada: { rotulo: 'cancelada', tom: 'muted' },
  remarcada: { rotulo: 'remarcada', tom: 'muted' },
}

export function AndarHoje({ hoje }: { hoje: DadosDeHoje }) {
  const { aulas, pendencias } = hoje

  return (
    <section aria-label="Hoje" className="flex flex-col gap-5">
      <CardPanel>
        <CardPanelHeader title="Hoje" meta={hoje.dataPorExtenso} />

        {/* PISO de altura (`geometria.ts`): o esqueleto desenha 4 linhas de
            64px e o conteúdo real não entra abaixo disso — sem o piso, um dia
            de 1 aula puxava a página inteira para cima na troca. */}
        <div className={RESERVA_AGENDA}>
          {aulas.length === 0 ? (
            <EmptyState
              illustration="/illustrations/agenda-vazia.svg"
              title="Nenhuma aula hoje."
              hint="Dia livre no calendário. A semana inteira está na agenda — inclusive as janelas ainda abertas."
              cta="Ver a semana"
              href="/admin/agenda"
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {aulas.map((a) => {
                const s = SITUACAO[a.situacao]
                return (
                  <li
                    key={a.id}
                    className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <InstanteTexto
                        value={a.instante}
                        className="text-sm font-bold tabular-nums text-ink-900"
                      >
                        {a.hora}
                      </InstanteTexto>
                      {a.studentId ? (
                        <Link
                          href={`/admin/alunos/${a.studentId}`}
                          className="truncate text-sm font-medium text-ink-900 hover:text-ac-deep hover:underline"
                        >
                          {a.quem}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium text-ink-900">{a.quem}</span>
                      )}
                      {/* O nível tem ESCALA de cor própria (M3-c1 · C2): sobe
                          de azul-céu a roxo sólido conforme o aluno avança. */}
                      {a.nivel && (
                        <Pill tone="nivel" nivel={a.nivel}>
                          {a.nivel}
                        </Pill>
                      )}
                      {/* Cor por professora vale AQUI porque isto é agenda (D5): é
                          o único lugar fora dela em que a professora é eixo de
                          leitura. Sem nome, nem bolinha — marca sem rótulo é
                          enigma. */}
                      {a.teacherNome && (
                        <span className="hidden items-center gap-1.5 text-sm text-ink-600 sm:inline-flex">
                          <span
                            aria-hidden
                            className={`h-2 w-2 rounded-full ${TEACHER_FILL[a.teacherIdx % TEACHER_FILL.length]}`}
                          />
                          {a.teacherNome}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <Pill tone={s.tom}>{s.rotulo}</Pill>
                      {a.situacao === 'sem_registro' && (
                        <RegistrarDesfecho instanceId={a.id} quem={a.quem} instante={a.instante} />
                      )}
                      {a.situacao === 'agendada' && (
                        <Link href={`/admin/agenda/remarcar/${a.id}`} className="btn-ac-soft">
                          Remarcar
                        </Link>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardPanel>

      {/* Pendências: a fila do que trava alguém (apontamento, briefing, acesso).
          Cada cartão vai para a lista que o explica. */}
      <div className="flex flex-col gap-3">
        {/* Título de SEÇÃO na régua medida (Inter 20/600, −0.8px): era 16/700,
            menor que o do bloco vizinho para a mesma hierarquia. */}
        <h3 className="title-section text-ink-900">Pendências</h3>

        {/* PISO de altura (`geometria.ts`): 1, 2 ou 3 cartões medem o mesmo
            (uma fileira só), e é essa fileira que o esqueleto desenha. O
            estado "nada travado" é MAIS ALTO que o piso, de propósito — ver a
            exceção declarada na régua. */}
        <div className={RESERVA_PENDENCIAS}>
          {pendencias.total === 0 ? (
            <EmptyState
              illustration="/illustrations/tudo-em-dia.svg"
              title="Nada travado."
              hint="Apontamentos, briefings e acessos ao portal estão todos em dia."
              cta="Ver a agenda da semana"
              href="/admin/agenda"
              className="panel-tb"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {/* A5/L5 (Sol · rodada 2, grave): o `detalhe` deste cartão dizia
                  "a professora só recebe pela aula depois do apontamento", e é
                  FALSO — `_teacher_payable_hours` (20260713000600) soma aula
                  passada ainda `scheduled` sem consultar `class_content_reports`
                  em lugar nenhum. A hora já está acumulando no extrato; o que o
                  apontamento fecha é o registro PEDAGÓGICO, que é o que
                  `complete_class` exige. A frase antiga fazia a dona acreditar
                  que o pagamento estava retido — é a mesma falsidade nº 3 que a
                  Agenda e o `RegistrarDesfecho` já tinham consertado.
                  A RESSALVA DA PAUSA veio com a revisão independente (médio 4): o
                  ramo `scheduled` de `_teacher_payable_hours` exige que NÃO haja
                  `contract_pauses` cobrindo o dia, e nem esta fila nem a da Agenda
                  filtram por status de contrato — sem a ressalva, a frase mente
                  justamente na aula de contrato pausado. */}
              {pendencias.apontamentos > 0 && (
                <CartaoKpi
                  compacto
                  href="/admin/agenda?v=pendencias"
                  icone={NotebookPen}
                  valor={String(pendencias.apontamentos)}
                  rotulo={pendencias.apontamentos === 1 ? 'aula sem registro' : 'aulas sem registro'}
                  detalhe="a hora já conta no extrato (se o contrato não está pausado); falta o registro do que foi trabalhado"
                />
              )}
              {pendencias.briefings > 0 && (
                <CartaoKpi
                  compacto
                  href="/admin/alunos"
                  icone={ClipboardList}
                  valor={String(pendencias.briefings)}
                  rotulo={pendencias.briefings === 1 ? 'briefing pendente' : 'briefings pendentes'}
                  detalhe="sem briefing não há plano de estudo"
                />
              )}
              {pendencias.convites > 0 && (
                <CartaoKpi
                  compacto
                  href="/admin/alunos"
                  icone={Mail}
                  valor={String(pendencias.convites)}
                  rotulo={pendencias.convites === 1 ? 'aluno sem acesso ao portal' : 'alunos sem acesso ao portal'}
                  // F4 (revisão adversarial nº 4): a contagem junta DOIS estados
                  // — aluno que nunca recebeu convite (sem `profile_id`) e aluno
                  // convidado que não confirmou. Dizer só "convite enviado" fazia
                  // a dona procurar um e-mail que talvez nunca tenha saído. A
                  // separação em três estados é da tela de convites (M3); aqui a
                  // contagem é UMA, e a frase cobre os dois casos.
                  detalhe="sem convite ou com convite ainda não aceito"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
