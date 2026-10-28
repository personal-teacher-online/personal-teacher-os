'use client'

// O FORMULÁRIO DE HORÁRIO FIXO DO CONTRATO (Onda 1 · M4-2) — criar um horário
// novo e trocar um que existe, com a agenda da professora ao lado.
//
// É componente CLIENTE pelo mesmo motivo (e com o mesmo mecanismo) da etapa 2 do
// wizard de admissão: mostrar o que a professora JÁ tem naquele dia da semana e
// travar a hora que atropela uma dessas janelas exige reagir a "que dia" e "que
// hora" antes do envio. Quem recusa DE VERDADE continua sendo o banco (Lei 3 —
// a exclusão GiST `class_instances_teacher_no_overlap_excl`); isto é
// antecipação, para a pessoa não preencher tudo e levar um erro de Postgres.
//
// LEI 1, ONDE ELA MORA: este arquivo NÃO faz conta de fuso. As janelas chegam
// prontas de `contrato-detalhe.ts` (servidor, Luxon, offset do dia específico),
// já convertidas para o relógio que rege ESTE contrato; aqui só se comparam
// minutos dentro de um relógio só.
//
// A TROCA IGNORA O PRÓPRIO HORÁRIO. `close_and_create_slot` fecha o slot antigo
// e cancela as aulas futuras dele ANTES de materializar o novo — então empurrar
// a aula de terça 20:30 para terça 20:45 é legal, e acusar conflito ali seria a
// tela mentindo sobre o banco. É para isso que a janela carrega `slotId`.
//
// Os campos são os MESMOS que `createSlotAction`/`closeAndCreateSlotAction` já
// liam na tela velha: nenhuma mutação foi reescrita.

import { useState, type ReactNode } from 'react'

import { CityPicker } from '@/components/CityPicker'
import { TimeField } from '@/components/TimeField'
import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import { FormValidado } from '@/components/kit/form-validado'
import { SheetBody, SheetSection } from '@/components/kit/sheet'
import { DIAS_DA_SEMANA } from '@/data/admin/contratos-gramatica'
import { conflitoDe, janelasDoDia, minutosDeHhmm, type JanelaOcupada } from '@/lib/agenda/ocupacao'

/** A agenda que a professora já tem naquele dia — o dado que decide a hora. */
function JaOcupado({ janelas, professora }: { janelas: JanelaOcupada[]; professora: string }) {
  if (janelas.length === 0) {
    return <p className="text-sm leading-relaxed text-ink-600">{professora} não tem nada marcado neste dia.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-ink-900">{professora} já tem neste dia</p>
      <ul className="flex flex-col gap-0.5">
        {janelas.map((j) => (
          <li key={`${j.weekday}-${j.inicio}-${j.quem}`} className="text-sm leading-relaxed text-ink-600">
            <span className="font-medium tabular-nums text-ink-900">{j.texto}</span> · {j.quem}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FormularioDeHorario({
  action,
  camposFixos,
  professoraId,
  professoraNome,
  ocupacao,
  fuso,
  ancora,
  weekdayInicial,
  horaInicial,
  duracaoInicial,
  /** na TROCA a duração não é campo: ela vem do horário que está sendo trocado */
  duracaoEditavel,
  rodape,
}: {
  action: (formData: FormData) => void | Promise<void>
  /** os hidden que identificam o alvo da mutação (contrato ou slot) + `back` */
  camposFixos: ReactNode
  professoraId: string | null
  professoraNome: string
  ocupacao: JanelaOcupada[]
  /** rótulo do fuso já formatado no servidor (Lei 1: nada de conta aqui) */
  fuso: string
  /** contrato de GRUPO manda a âncora de fuso EXPLÍCITA (P1) */
  ancora: { defaultTz: string } | null
  weekdayInicial: number
  horaInicial: string
  duracaoInicial: number
  duracaoEditavel: boolean
  rodape: ReactNode
}) {
  const [weekday, setWeekday] = useState(weekdayInicial)
  const [hora, setHora] = useState(horaInicial)
  const [duracao, setDuracao] = useState(duracaoInicial)

  const inicio = minutosDeHhmm(hora)
  const bate =
    professoraId && inicio !== null && duracao > 0
      ? conflitoDe(ocupacao, professoraId, weekday, inicio, duracao)
      : null
  const problema = bate ? `${professoraNome} já tem aula neste horário: ${bate.texto} · ${bate.quem}.` : null

  return (
    <FormValidado action={action} className="flex min-h-0 flex-1 flex-col">
      {camposFixos}
      <SheetBody>
        <SheetSection
          title="Quando é a aula"
          hint={`Hora no fuso que rege este contrato (${fuso}). O banco materializa as próximas 8 semanas na hora em que você salvar.`}
        >
          <GradeDeCampos>
            <Campo rotulo="Dia da semana" para="dia-do-horario">
              <Select
                name="weekday"
                defaultValue={String(weekdayInicial)}
                onValueChange={(v) => setWeekday(Number(v))}
              >
                <SelectTrigger id="dia-do-horario" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-60">
                  {DIAS_DA_SEMANA.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Hora" exigencia="Informe a hora da aula">
              <TimeField
                name="local_time"
                required
                defaultValue={horaInicial}
                className={CAMPO}
                problema={problema}
                aoMudar={setHora}
              />
            </Campo>
            {duracaoEditavel ? (
              <Campo rotulo="Duração (min)" exigencia="Informe a duração da aula">
                {/* c13 · nº 10: o teto é do BANCO desde o c12 · nº 3 (CHECK
                    `recurring_slots_duration_sane`, 15..480). Sem o `max`, a
                    tela aceitava 600 e o horário morria no submit com erro de
                    constraint — as duas pontas da faixa dizem a mesma coisa. */}
                <input
                  name="duration_min"
                  type="number"
                  min="15"
                  max="480"
                  step="5"
                  required
                  defaultValue={duracaoInicial}
                  onChange={(e) => setDuracao(Number(e.target.value))}
                  className={CAMPO}
                />
              </Campo>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink-900">Duração</span>
                <p className="py-2 text-sm text-ink-900">
                  {duracaoInicial} min — a mesma do horário que está sendo trocado
                </p>
              </div>
            )}
            {ancora && (
              <Campo
                rotulo="Âncora de fuso (grupo)"
                largo
                apoio="o relógio de quem rege este horário — o grupo não tem um fuso só"
                exigencia="Informe a cidade que ancora o fuso do grupo"
              >
                <CityPicker tzName="iana_tz" defaultTz={ancora.defaultTz} required />
              </Campo>
            )}
          </GradeDeCampos>
        </SheetSection>

        <SheetSection
          title="A agenda da professora"
          hint="O que ela já tem marcado neste dia, no relógio deste contrato. Horário que atropela um destes o banco recusa."
        >
          <JaOcupado
            professora={professoraNome}
            janelas={professoraId ? janelasDoDia(ocupacao, professoraId, weekday) : []}
          />
        </SheetSection>
      </SheetBody>
      {rodape}
    </FormValidado>
  )
}
