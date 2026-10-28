import { DateTime } from 'luxon'
import Link from 'next/link'
import { one } from '@/lib/embed'
import { fmtCivilDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import {
  btnInkSm,
  inputSm,
  linkActionXs,
  Actions,
  Card,
  ConfirmAction,
  EmptyState,
  Field,
  FlashMsg,
  Pill,
  SectionTitle,
  SidePanel,
  toolbarLink,
} from '@/components/ui'
import {
  adjustMentorshipCreditAction,
  cancelMentorshipSessionAction,
  createMentorshipSessionAction,
  doneMentorshipSessionAction,
  openMentorshipSessionAction,
  refundMentorshipBookingAction,
  updateBridgeAction,
  updateHotmartRefAction,
} from './actions'
import {
  applyDefaultThresholdsAction,
  setDefaultThresholdAction,
  updateMentorshipSessionAction,
} from './actions'

export const metadata = { title: 'Mentoria — Admin' }

// Rodada B: leitura em UMA chamada (admin_mentorship_overview), encontros
// futuros em destaque, zero jargão interno na tela. Créditos destravados são
// COMPUTADOS das datas (Lei 2); aqui só se lança início do curso e progresso.

const BUSINESS_TZ = 'America/Cuiaba'

const SESSION_STATUS: Record<string, { tone: 'ok' | 'warn' | 'neutral' | 'muted'; label: string }> = {
  scheduled: { tone: 'neutral', label: 'rascunho' },
  open: { tone: 'ok', label: 'aberta para reservas' },
  full: { tone: 'warn', label: 'lotada' },
  done: { tone: 'muted', label: 'realizada' },
  cancelled: { tone: 'muted', label: 'cancelada' },
}

interface Overview {
  contract_id: string
  student_id: string
  student_name: string
  course_start_date: string | null
  total_credits: number
  window_months: number
  completion_pct: number | null
  external_user_ref: string | null
  hotmart_matched_at: string | null
  hotmart_divergence: string | null
  unlocked: number
  available: number
  next_window: number | null
  validity_end: string | null
  can_book: boolean | null
  threshold_missing: boolean
}

export default async function MentoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; painel?: string }>
}) {
  const { msg, painel } = await searchParams
  const supabase = await createClient()

  // F10/M6-1: régua padrão (defaults) — vazia até a dona definir os números
  const { data: defaultsRaw } = await supabase
    .from('mentorship_default_thresholds')
    .select('window_index, threshold_pct')
    .order('window_index')
  const defaults = new Map(
    ((defaultsRaw ?? []) as { window_index: number; threshold_pct: number }[]).map((d) => [d.window_index, d.threshold_pct]),
  )

  const [{ data: overview, error: ovError }, { data: sessions }, { data: bookingRows }] = await Promise.all([
    supabase.rpc('admin_mentorship_overview'),
    supabase
      .from('mentorship_sessions')
      .select('id, scheduled_at, duration_min, capacity, booked_count, status, gmeet_url')
      .order('scheduled_at', { ascending: false }),
    supabase.from('mentorship_bookings').select('id, session_id, students(display_name)').is('cancelled_at', null),
  ])
  if (ovError) throw new Error(ovError.message)
  const rows = (overview ?? []) as Overview[]

  const bookingsBySession = new Map<string, { id: string; name: string }[]>()
  for (const b of bookingRows ?? []) {
    const list = bookingsBySession.get(b.session_id) ?? []
    list.push({ id: b.id, name: one(b.students)?.display_name ?? '—' })
    bookingsBySession.set(b.session_id, list)
  }

  // eslint-disable-next-line react-hooks/purity
  const now = DateTime.now()
  const futuras = (sessions ?? [])
    .filter((s) => DateTime.fromISO(s.scheduled_at) >= now && s.status !== 'done' && s.status !== 'cancelled')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const passadas = (sessions ?? []).filter((s) => !futuras.includes(s))

  const fmtSess = (iso: string) =>
    DateTime.fromISO(iso).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL 'às' HH:mm")

  const SessionCard = ({ sess }: { sess: (typeof futuras)[number] }) => {
    const st = SESSION_STATUS[sess.status] ?? { tone: 'neutral' as const, label: sess.status }
    const reservas = bookingsBySession.get(sess.id) ?? []
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900 first-letter:uppercase">{fmtSess(sess.scheduled_at)}</p>
            <p className="text-xs text-ink-400">
              {sess.duration_min} min · {sess.booked_count} de {sess.capacity} vagas ocupadas
              {sess.gmeet_url ? ' · link do Meet pronto' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={st.tone}>{sess.status === 'cancelled' ? <s>{st.label}</s> : st.label}</Pill>
            {(sess.status === 'scheduled' || sess.status === 'open' || sess.status === 'full') && (
              <Actions>
                {sess.status === 'scheduled' && (
                  <form action={openMentorshipSessionAction}>
                    <input type="hidden" name="session_id" value={sess.id} />
                    <button type="submit" className={linkActionXs}>
                      abrir reservas
                    </button>
                  </form>
                )}
                {(sess.status === 'open' || sess.status === 'full') && (
                  <>
                    <form action={doneMentorshipSessionAction}>
                      <input type="hidden" name="session_id" value={sess.id} />
                      <button type="submit" className={linkActionXs}>
                        encerrar (realizada)
                      </button>
                    </form>
                    <ConfirmAction
                      label="cancelar encontro (estorna todos)"
                      warning={`Cancela este encontro e devolve 1 crédito a cada mentorado com reserva (${sess.booked_count} no momento). Não dá para desfazer pela tela.`}
                      confirmLabel="cancelar e estornar"
                      action={cancelMentorshipSessionAction}
                      values={{ session_id: sess.id }}
                    />
                    {/* F10/M6-5: link livre; vagas com piso; hora só sem reservas */}
                    <form action={updateMentorshipSessionAction} className="flex flex-col gap-2 border-t border-line-soft pt-2">
                      <span className="text-xs font-bold text-ink-900">Editar encontro</span>
                      <Field label="Link do Meet (livre)">
                        <input name="gmeet_url" defaultValue={sess.gmeet_url ?? ''} placeholder="https://meet.google.com/…" className={inputSm} />
                      </Field>
                      <Field label="Vagas" hint={`piso: ${sess.booked_count} reservas ativas`}>
                        <input name="capacity" type="number" defaultValue={sess.capacity} className={`${inputSm} w-16`} />
                      </Field>
                      <Field label="Nova data/hora (Cuiabá)" hint="só sem reservas ativas">
                        <span className="flex gap-2">
                          <DateField name="local_date" className={inputSm} />
                          <TimeField name="local_time" className={inputSm} />
                        </span>
                      </Field>
                      <input type="hidden" name="session_id" value={sess.id} />
                      <button type="submit" className={linkActionXs}>
                        salvar mudanças
                      </button>
                    </form>
                  </>
                )}
              </Actions>
            )}
          </div>
        </div>
        {reservas.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-soft pt-3">
            {reservas.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-600">{b.name}</span>
                <ConfirmAction
                  label="estornar"
                  warning={`Desfaz a reserva de ${b.name} e devolve 1 crédito. A vaga volta a ficar aberta.`}
                  confirmLabel="estornar reserva"
                  action={refundMentorshipBookingAction}
                  values={{ booking_id: b.id }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    )
  }

  return (
    <main className="flex flex-col gap-6">
      <FlashMsg msg={msg} />

      <header>
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Mentoria <span className="font-sans text-base font-normal text-ink-400">Personal Travel</span>
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Cada mentorado destrava 1 encontro a cada {rows[0]?.window_months ?? 2} meses de curso (o
          primeiro já no início) e a reserva pede o progresso mínimo da etapa. Você marca as datas;
          eles reservam a vaga.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            <Link href="/admin/mentoria?painel=encontro" className={toolbarLink}>
              ＋ Marcar encontro
            </Link>
          }
        >
          Próximos encontros
        </SectionTitle>
        {futuras.length === 0 ? (
          <EmptyState
            title="Nenhum encontro marcado."
            hint="Marque as datas do trimestre de uma vez — os mentorados só veem encontros abertos."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {futuras.map((sess) => (
              <SessionCard key={sess.id} sess={sess} />
            ))}
          </div>
        )}
        {passadas.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer list-none text-xs font-semibold text-ink-400 hover:text-ink-900">
              Encontros passados e cancelados ({passadas.length}) ▾
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {passadas.map((sess) => (
                <SessionCard key={sess.id} sess={sess} />
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            <Link href="/admin/mentoria?painel=regua" className={toolbarLink}>
              Régua padrão de progresso
            </Link>
          }
        >
          Mentorados
        </SectionTitle>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum mentorado ainda."
            hint="Os contratos de mentoria aparecem aqui assim que forem criados."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const pct = Number(r.completion_pct ?? 0)
              return (
                <li key={r.contract_id}>
                  <Card className="flex h-full flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/admin/alunos/${r.student_id}`} className="font-semibold text-ink-900 hover:underline">
                        {r.student_name}
                      </Link>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {/* F10/M7-8: estado do vínculo Hotmart sempre visível */}
                        {!r.external_user_ref && <Pill tone="warn">sem vínculo Hotmart</Pill>}
                        {r.hotmart_divergence && (
                          <Pill tone="danger" title={r.hotmart_divergence}>
                            e-mail divergente ⚠
                          </Pill>
                        )}
                        {r.threshold_missing ? (
                          <Pill tone="danger">critério da etapa sem valor — reserva bloqueada</Pill>
                        ) : r.can_book ? (
                          <Pill tone="ok">pode reservar</Pill>
                        ) : (
                          <Pill tone="neutral">ainda não pode reservar</Pill>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1" title={`${r.unlocked} de ${r.total_credits} encontros destravados`}>
                      {Array.from({ length: r.total_credits }, (_, i) => (
                        <span
                          key={i}
                          className={`h-2.5 w-2.5 rounded-full ${i < r.unlocked ? 'bg-brand-600' : 'bg-paper-100 ring-1 ring-(--line)'}`}
                        />
                      ))}
                      <span className="ml-1.5 text-xs text-ink-400">
                        {r.unlocked}/{r.total_credits} destravados · {Math.max(r.available, 0)} disponíve
                        {Math.max(r.available, 0) === 1 ? 'l' : 'is'}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-ink-400">
                        <span>Progresso no curso</span>
                        <span className="font-mono">{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-paper-100">
                        <div className="h-full rounded-pill bg-brand-600" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>

                    <p className="text-xs text-ink-400">
                      {r.course_start_date
                        ? `curso começou em ${fmtCivilDate(r.course_start_date)}`
                        : 'ainda não começou o curso'}
                      {r.validity_end && ` · créditos valem até ${fmtCivilDate(r.validity_end)}`}
                    </p>

                    <div className="mt-auto border-t border-line-soft pt-2">
                      <Actions label="editar" align="left">
                        <form action={updateBridgeAction} className="flex flex-wrap items-end gap-3">
                          <input type="hidden" name="contract_id" value={r.contract_id} />
                          <input type="hidden" name="student_id" value={r.student_id} />
                          <Field label="Início do curso">
                            <DateField name="course_start_date" defaultValue={r.course_start_date ?? ''} className={inputSm} />
                          </Field>
                          <Field label="Progresso (%)">
                            <input
                              name="completion_pct"
                              type="number"
                              min={0}
                              max={100}
                              defaultValue={pct || ''}
                              className={`${inputSm} w-24`}
                            />
                          </Field>
                          <button type="submit" className={linkActionXs}>
                            salvar
                          </button>
                        </form>
                        <form action={updateHotmartRefAction} className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-3">
                          <input type="hidden" name="contract_id" value={r.contract_id} />
                          <Field label="E-mail no curso online (vínculo)">
                            <input
                              name="external_user_ref"
                              type="email"
                              placeholder="aluno@exemplo.com"
                              defaultValue={r.external_user_ref ?? ''}
                              className={inputSm}
                            />
                          </Field>
                          <button type="submit" className={linkActionXs}>
                            salvar vínculo
                          </button>
                        </form>
                        <form action={adjustMentorshipCreditAction} className="flex flex-col gap-2 border-t border-line-soft pt-3">
                          <input type="hidden" name="contract_id" value={r.contract_id} />
                          <p className="text-xs font-bold text-ink-900">Ajustar créditos (compensação)</p>
                          <div className="flex flex-wrap items-end gap-3">
                            <Field label="Créditos (±)">
                              <input name="delta" type="number" step={1} defaultValue={1} className={`${inputSm} w-20`} />
                            </Field>
                            <Field label="Motivo (opcional)">
                              <input name="note" placeholder="ex.: compensação acordada" className={inputSm} />
                            </Field>
                            <button type="submit" className={linkActionXs}>
                              lançar
                            </button>
                          </div>
                          <p className="text-[11px] text-ink-400">não muda a escada de etapas — vira registro auditado</p>
                        </form>
                      </Actions>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* S2-10b (padrão TutorBird): forms grandes em PAINEL LATERAL */}
      {painel === 'encontro' && (
        <SidePanel title="Marcar encontro" closeHref="/admin/mentoria">
              <form action={createMentorshipSessionAction} className="flex flex-col gap-4">
                <Field label="Data">
                  <DateField name="date" required className={inputSm} />
                </Field>
                <Field label="Hora (Cuiabá)">
                  <TimeField name="time" required className={inputSm} />
                </Field>
                <Field label="Duração (min)">
                  <input name="duration_min" type="number" min={1} defaultValue={60} className={`${inputSm} w-20`} />
                </Field>
                <Field label="Vagas">
                  <input name="capacity" type="number" min={1} defaultValue={6} className={`${inputSm} w-20`} />
                </Field>
                <Field label="Link do Meet (opcional)">
                  <input name="gmeet_url" type="url" placeholder="https://meet.google.com/…" className={inputSm} />
                </Field>
                <button type="submit" className={btnInkSm}>
                  Criar
                </button>
                <p className="w-full max-w-xl text-xs leading-relaxed text-ink-400">
                  A hora vale em Cuiabá; cada mentorado vê no fuso dele. O encontro nasce como
                  rascunho — abra as reservas quando quiser publicá-lo.
                </p>
              </form>
        </SidePanel>
      )}
      {painel === 'regua' && (
        <SidePanel title="Régua padrão de progresso (M6-1)" closeHref="/admin/mentoria">
              <p className="mb-3 max-w-xl text-xs text-ink-400">
                A reserva nº N exige o % de progresso da etapa N. Estes são os PADRÕES: semeiam
                contratos novos e o botão &ldquo;aplicar aos existentes&rdquo; (regras já definidas
                num contrato nunca são sobrescritas). Etapa sem valor BLOQUEIA a reserva — nunca
                libera em silêncio.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                {[1, 2, 3, 4, 5, 6].map((w) => (
                  <form key={w} action={setDefaultThresholdAction} className="flex items-end gap-1.5">
                    <Field label={`Etapa ${w} (%)`}>
                      <input
                        name="threshold_pct"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={defaults.get(w) ?? ''}
                        className={`${inputSm} w-16`}
                      />
                    </Field>
                    <input type="hidden" name="window_index" value={w} />
                    <button type="submit" className={linkActionXs}>
                      salvar
                    </button>
                  </form>
                ))}
                <form action={applyDefaultThresholdsAction}>
                  <button type="submit" className={linkActionXs} title="Preenche etapas faltantes de TODOS os contratos com os padrões">
                    aplicar aos existentes
                  </button>
                </form>
              </div>
        </SidePanel>
      )}
    </main>
  )
}
