import { DateTime } from 'luxon'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtBRL, fmtCivilDate, tzLabel } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DateField } from '@/components/DateField'
import { CityPicker } from '@/components/CityPicker'
import {
  btnInkSm,
  input,
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
  TEACHER_FILL,
} from '@/components/ui'
import {
  addRatePeriodAction,
  adjustStatementAction,
  archiveTeacherAction,
  closeStatementAction,
  deleteTeacherAction,
  generateStatementAction,
  inviteExistingTeacherAction,
  removeRatePeriodAction,
  resendTeacherInviteAction,
  unarchiveTeacherAction,
  updateTeacherAction,
} from '../actions'

export const metadata = { title: 'Ficha da professora — Admin' }

// Ficha da professora (NOVA — dor 14/29): cadastro completo, alunos dela,
// Google Agenda e os extratos num lugar só. Dados internos da escola: aluno e
// professora jamais enxergam esta página (rota admin + RLS).

type Estado = 'ativa' | 'pendente' | 'sem_acesso' | 'arquivada'
const ESTADO_PILL: Record<Estado, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'muted' }> = {
  ativa: { label: 'ativa', tone: 'ok' },
  pendente: { label: 'convidada — pendente', tone: 'warn' },
  sem_acesso: { label: 'sem acesso', tone: 'neutral' },
  arquivada: { label: 'arquivada', tone: 'muted' },
}
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export default async function FichaProfessoraPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ msg?: string; painel?: string }>
}) {
  const { id } = await params
  // F0 (M12-8): pré-preenchimento do extrato = mês civil corrente (Cuiabá), editável.
  // eslint-disable-next-line react-hooks/purity
  const mesRef = DateTime.now().setZone('America/Cuiaba')
  const mesInicio = mesRef.startOf('month').toFormat('yyyy-LL-dd')
  const mesFim = mesRef.endOf('month').toFormat('yyyy-LL-dd')
  const hojeISO = mesRef.toFormat('yyyy-LL-dd')
  const { msg, painel } = await searchParams
  const supabase = await createClient()

  const { data: t } = await supabase
    .from('teachers')
    .select('id, display_name, iana_tz, profile_id, is_owner, archived_at, hourly_rate_cents, payment_terms, cpf, contract_kind')
    .eq('id', id)
    .maybeSingle()
  if (!t) notFound()

  // F9/M12-7: vigências de valor/hora da professora
  const { data: ratePeriodsRaw } = await supabase
    .from('teacher_rate_periods')
    .select('id, valid_from, rate_cents')
    .eq('teacher_id', id)
    .order('valid_from', { ascending: false })
  const ratePeriods = (ratePeriodsRaw ?? []) as { id: string; valid_from: string; rate_cents: number }[]

  const [{ data: contracts }, { data: statements }, { data: allTeachers }, google, auth] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, status, contract_type, students!contracts_student_id_fkey(id, display_name, level, status), student_groups(label), recurring_slots(id, weekday, local_time, active_to)')
      .eq('teacher_id', id),
    supabase
      .from('teacher_statements')
      .select('id, period_start, period_end, audited_hours, rate_cents, adjustments_cents, manual_adjustments_cents, total_cents, status')
      .eq('teacher_id', id)
      .order('period_start', { ascending: false })
      .limit(24),
    supabase
      .from('teachers')
      .select('id')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    supabase
      .from('teacher_google_accounts')
      .select('google_email, connected_at, last_sync_at, last_sync_error')
      .eq('teacher_id', id)
      .maybeSingle(),
    t.profile_id
      ? createAdminClient()
          .auth.admin.getUserById(t.profile_id)
          .then(({ data }) => ({
            email: data?.user?.email ?? null,
            confirmed: Boolean(data?.user?.email_confirmed_at),
          }))
      : Promise.resolve({ email: null, confirmed: false }),
  ])

  const estado: Estado = t.archived_at ? 'arquivada' : !t.profile_id ? 'sem_acesso' : auth.confirmed ? 'ativa' : 'pendente'
  const colorIdx = (allTeachers ?? []).findIndex((x) => x.id === t.id)
  const self = `/admin/professoras/${t.id}`

  type Slot = { id: string; weekday: number; local_time: string; active_to: string | null }
  const alunos = (contracts ?? []).map((c) => {
    const student = Array.isArray(c.students) ? c.students[0] : c.students
    const group = Array.isArray(c.student_groups) ? c.student_groups[0] : c.student_groups
    const slots = ((c.recurring_slots ?? []) as Slot[]).filter((s) => !s.active_to)
    return {
      contractId: c.id,
      status: c.status,
      type: c.contract_type,
      studentId: student?.id ?? null,
      name: student?.display_name ?? group?.label ?? '—',
      level: student?.level ?? null,
      // dor 1/2 do dono: aluno arquivado (anonimizado "Ex-aluno(a) …") NÃO pode
      // vazar para a lista de trabalho mesmo com contrato ainda não-encerrado —
      // o backfill da leva 7 arquivou legados sem encerrar o contrato.
      studentStatus: student?.status ?? null,
      slots,
    }
  })
  // Separa a lista de trabalho (vivos) do histórico (Encerrados): contrato
  // encerrado OU aluno arquivado moram numa seção própria, nunca misturados.
  const vivos = alunos.filter((a) => a.status !== 'ended' && a.studentStatus !== 'archived')
  const encerrados = alunos.filter((a) => a.status === 'ended' || a.studentStatus === 'archived')

  return (
    <main className="flex flex-col gap-6">
      <FlashMsg msg={msg} />

      <header className="flex flex-col gap-1">
        <Link href="/admin/professoras" className="text-xs font-semibold text-brand-700 hover:underline">
          ← Professoras
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {colorIdx >= 0 && <span className={`h-3 w-3 rounded-full ${TEACHER_FILL[colorIdx % TEACHER_FILL.length]}`} />}
          <h2 className="font-display text-2xl font-bold text-ink-900">{t.display_name}</h2>
          {t.is_owner && <Pill tone="brand">dona da escola</Pill>}
          {t.is_owner && estado !== 'ativa' ? (
            <Pill tone="neutral">acessa como admin</Pill>
          ) : (
            <Pill tone={ESTADO_PILL[estado].tone}>{ESTADO_PILL[estado].label}</Pill>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
          <SectionTitle
            action={
              <Link href={`${self}?painel=editar`} className={toolbarLink}>
                Editar cadastro
              </Link>
            }
          >
            Cadastro
          </SectionTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">E-mail</dt>
              <dd className="break-all text-ink-900">{auth.email ?? '— (sem acesso ainda)'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">Fuso</dt>
              <dd className="text-ink-900">{tzLabel(t.iana_tz)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">Valor/hora</dt>
              <dd className="text-ink-900">
                {t.hourly_rate_cents ? fmtBRL(t.hourly_rate_cents) : '—'}
                {!t.hourly_rate_cents && t.is_owner && <span className="ml-1 text-xs text-ink-400">(não remunerada por hora)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">CPF</dt>
              <dd className="text-ink-900">{t.cpf ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">Tipo de vínculo</dt>
              <dd className="text-ink-900">{t.contract_kind ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">Condições</dt>
              <dd className="text-ink-900">{t.payment_terms ?? '—'}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs font-bold tracking-wide text-ink-400 uppercase">Google Agenda</dt>
              <dd className="text-ink-900">
                {google.data?.google_email ? (
                  <>
                    conectada ({google.data.google_email})
                    {google.data.last_sync_at && (
                      <span className="ml-1.5 text-xs text-ink-400">
                        · última sincronização{' '}
                        {DateTime.fromISO(google.data.last_sync_at).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")}
                      </span>
                    )}
                    {google.data.last_sync_error && (
                      <span className="ml-1.5 text-xs text-danger-700">· falhou na última tentativa</span>
                    )}
                  </>
                ) : (
                  <span className="text-ink-400">não conectada — ela conecta no painel dela</span>
                )}
              </dd>
            </div>
          </dl>
          {!t.is_owner && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
              {estado === 'pendente' && (
                <form action={resendTeacherInviteAction}>
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <button type="submit" className={linkActionXs}>
                    reenviar convite
                  </button>
                </form>
              )}
              {estado === 'sem_acesso' && (
                <form action={inviteExistingTeacherAction} className="flex items-end gap-2">
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <input name="email" type="email" required placeholder="e-mail p/ convidar" className={inputSm} />
                  <button type="submit" className={linkActionXs}>
                    convidar
                  </button>
                </form>
              )}
              {estado === 'arquivada' ? (
                <form action={unarchiveTeacherAction}>
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <button type="submit" className={linkActionXs}>
                    reativar
                  </button>
                </form>
              ) : (
                <form action={archiveTeacherAction}>
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <button type="submit" className={linkActionXs}>
                    arquivar
                  </button>
                </form>
              )}
              <ConfirmAction
                label="remover"
                warning={`Remove ${t.display_name} e o acesso dela ao painel. Se ela pode voltar um dia, prefira arquivar. Não dá para desfazer pela tela.`}
                confirmLabel="remover professora"
                action={deleteTeacherAction}
                values={{ teacher_id: t.id }}
                align="left"
              />
            </div>
          )}
        </Card>

        <Card className="flex flex-col justify-center gap-1 p-5">
          <span className="text-xs font-bold tracking-wide text-ink-400 uppercase">Alunos ativos</span>
          <span className="font-display text-5xl font-extralight tabular-nums text-ink-900">
            {vivos.filter((a) => a.status === 'active' && a.type === 'private_1on1').length}
          </span>
          <span className="text-xs text-ink-400">de aulas particulares 1:1</span>
        </Card>
      </div>

      <section>
        <SectionTitle>Alunos desta professora</SectionTitle>
        <p className="mt-0.5 text-[11px] text-ink-400">horários fixos no fuso de cada aluno</p>
        {vivos.length === 0 ? (
          // Se há histórico logo abaixo, o EmptyState "como criar vínculo" fica
          // contraditório: basta uma linha curta. O convite completo só quando
          // não existe vínculo NENHUM (ativo ou encerrado).
          encerrados.length > 0 ? (
            <p className="mt-3 text-sm text-ink-400">Nenhum vínculo ativo no momento.</p>
          ) : (
            <div className="mt-3">
              <EmptyState
                title="Nenhum aluno ativo vinculado."
                hint="O vínculo nasce do contrato — crie em Contratos ligando aluno + professora."
                cta="Ver contratos"
                // M4-4: o índice novo (aba do hub). A lista velha morreu.
                href="/admin/alunos/contratos"
              />
            </div>
          )
        ) : (
          <ul className="mt-3 divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
            {vivos.map((a) => (
              <li key={a.contractId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  {a.studentId ? (
                    <Link href={`/admin/alunos/${a.studentId}`} className="font-semibold text-ink-900 hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-ink-900">{a.name}</span>
                  )}
                  {a.level && <Pill tone="neutral">{a.level}</Pill>}
                  {a.status === 'paused' && <Pill tone="warn">pausado</Pill>}
                </span>
                <span className="text-xs text-ink-400">
                  {a.slots.map((s) => `${WEEKDAYS[s.weekday]} ${String(s.local_time).slice(0, 5)}`).join(' · ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* dor 2 do dono: encerrados/ex-alunos ficam AQUI, nunca na lista de
            trabalho acima (mesmo padrão de "Contratos encerrados" da ficha do aluno). */}
        {encerrados.length > 0 && (
          <div className="mt-4 border-t border-line-soft pt-3">
            <p className="text-[10px] font-bold tracking-wide text-ink-400 uppercase">Encerrados ({encerrados.length})</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-600">
              {encerrados.map((a) => (
                <li key={a.contractId} className="flex flex-wrap items-center gap-2">
                  {a.studentId ? (
                    <Link href={`/admin/alunos/${a.studentId}`} className="font-medium text-ink-900 hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-900">{a.name}</span>
                  )}
                  {a.type === 'mentorship' && <Pill tone="brand">Personal Travel</Pill>}
                  <Pill tone="muted">{a.studentStatus === 'archived' ? 'ex-aluno' : 'encerrado'}</Pill>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* F9/M12-7: vigências de valor/hora — cada aula paga pelo valor da SUA data */}
      {!t.is_owner && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <Link href={`${self}?painel=vigencia`} className={toolbarLink}>
                ＋ nova vigência
              </Link>
            }
          >
            Valor/hora (vigências)
          </SectionTitle>
          {ratePeriods.length === 0 ? (
            <p className="text-sm text-ink-400">
              Sem vigências — vale o valor do cadastro ({t.hourly_rate_cents ? fmtBRL(t.hourly_rate_cents) : '—'}).
            </p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
              {ratePeriods.map((rp) => (
                <li key={rp.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-ink-900">
                    desde <strong>{rp.valid_from === '1900-01-01' ? 'o início' : fmtCivilDate(rp.valid_from)}</strong> ·{' '}
                    <span className="font-mono tabular-nums">{fmtBRL(rp.rate_cents)}</span>/h
                  </span>
                  {rp.valid_from > hojeISO && (
                    <form action={removeRatePeriodAction}>
                      <input type="hidden" name="id" value={rp.id} />
                      <input type="hidden" name="back" value={self} />
                      <button type="submit" className="text-xs font-semibold text-danger-700 hover:underline">
                        remover (ainda não vigente)
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {t.is_owner && !t.hourly_rate_cents ? (
        <p className="text-xs text-ink-400">
          Extratos de pagamento não se aplicam — a dona da escola não é remunerada por hora.
        </p>
      ) : (
      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            !t.archived_at ? (
              <Link href={`${self}?painel=extrato`} className={toolbarLink}>
                ＋ Gerar extrato
              </Link>
            ) : undefined
          }
        >
          Extratos de pagamento
        </SectionTitle>
        {(statements ?? []).length === 0 ? (
          <EmptyState title="Nenhum extrato ainda." hint="Gere o primeiro rascunho com o botão acima." />
        ) : (
          <div className="overflow-x-auto rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left">
                <tr>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Período</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Composição</th>
                  <th className="px-4 py-2.5 text-right text-xs font-bold tracking-wide text-ink-400 uppercase">Total</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Situação</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {(statements ?? []).map((st) => (
                  <tr key={st.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-ink-600">
                      {DateTime.fromISO(st.period_start).setLocale('pt-BR').toFormat('dd/LL')} –{' '}
                      {DateTime.fromISO(st.period_end).setLocale('pt-BR').toFormat('dd/LL/yyyy')}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-600">
                      {Number(st.audited_hours).toFixed(2)}h × {fmtBRL(st.rate_cents)}
                      {st.adjustments_cents !== 0 && ` + retroativo ${fmtBRL(st.adjustments_cents)}`}
                      {st.manual_adjustments_cents !== 0 && ` + ajuste ${fmtBRL(st.manual_adjustments_cents)}`}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-ink-900 tabular-nums">
                      {fmtBRL(st.total_cents)}
                    </td>
                    <td className="px-4 py-2">
                      <Pill tone={st.status === 'closed' ? 'muted' : 'warn'}>
                        {st.status === 'closed' ? 'fechado' : 'rascunho'}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {st.status === 'draft' && (
                        <Actions>
                          <form action={adjustStatementAction} className="flex flex-wrap items-end gap-3">
                            <input type="hidden" name="statement_id" value={st.id} />
                            <input type="hidden" name="back" value={self} />
                            <Field label="Ajuste (±R$)">
                              <input name="delta_reais" placeholder="±R$" className={`${inputSm} w-24`} />
                            </Field>
                            <Field label="Motivo">
                              <input name="reason" required placeholder="motivo" className={inputSm} />
                            </Field>
                            <button type="submit" className={linkActionXs}>
                              ajustar
                            </button>
                          </form>
                          <form action={closeStatementAction} className="border-t border-line-soft pt-3">
                            <input type="hidden" name="statement_id" value={st.id} />
                            <input type="hidden" name="back" value={self} />
                            <button type="submit" className={linkActionXs}>
                              fechar extrato
                            </button>
                          </form>
                        </Actions>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* S2-10b (padrão TutorBird): forms grandes da ficha em PAINEL LATERAL */}
      {painel === 'editar' && (
        <SidePanel title={`Editar cadastro — ${t.display_name ?? 'professora'}`} closeHref={self}>
                <form action={updateTeacherAction} className="flex flex-col gap-4">
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <input type="hidden" name="back" value={self} />
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Nome">
                      <input name="display_name" defaultValue={t.display_name ?? ''} required className={input} />
                    </Field>
                    <Field label="Valor/hora (R$)">
                      <input
                        name="hourly_rate"
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        defaultValue={((t.hourly_rate_cents ?? 0) / 100).toFixed(2)}
                        className={input}
                      />
                    </Field>
                    <Field label="CPF">
                      <input name="cpf" defaultValue={t.cpf ?? ''} placeholder="000.000.000-00" className={input} />
                    </Field>
                    <Field label="Tipo de vínculo">
                      <input name="contract_kind" defaultValue={t.contract_kind ?? ''} placeholder="ex.: PJ — hora auditada" className={input} />
                    </Field>
                    <Field label="Condições de pagamento">
                      <input name="payment_terms" defaultValue={t.payment_terms ?? ''} className={input} />
                    </Field>
                  </div>
                  <div className="max-w-xl">
                    <span className="mb-1 block text-xs font-semibold text-ink-600">Fuso da professora</span>
                    <CityPicker tzName="iana_tz" defaultTz={t.iana_tz} required />
                  </div>
                  <div>
                    <button type="submit" className={btnInkSm}>
                      Salvar
                    </button>
                  </div>
                </form>
        </SidePanel>
      )}
      {painel === 'vigencia' && !t.is_owner && (
        <SidePanel title="Nova vigência de valor/hora" closeHref={self}>
                <form action={addRatePeriodAction} className="flex flex-col gap-4">
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <input type="hidden" name="back" value={self} />
                  <Field label="Vale a partir de" hint="só datas FUTURAS (Cuiabá) — o passado nunca muda">
                    <DateField name="valid_from" required className={inputSm} />
                  </Field>
                  <Field label="Valor/hora (R$)">
                    <input name="rate" type="number" step="0.01" required className={`${inputSm} w-24`} />
                  </Field>
                  <button type="submit" className={linkActionXs}>
                    criar vigência
                  </button>
                </form>
        </SidePanel>
      )}
      {painel === 'extrato' && !t.archived_at && (
        <SidePanel title="Gerar extrato" closeHref={self}>
                <form action={generateStatementAction} className="flex flex-col gap-4">
                  <input type="hidden" name="teacher_id" value={t.id} />
                  <input type="hidden" name="back" value={self} />
                  <Field label="Início">
                    <DateField name="period_start" required defaultValue={mesInicio} />
                  </Field>
                  <Field label="Fim">
                    <DateField name="period_end" required defaultValue={mesFim} />
                  </Field>
                  <button type="submit" className={btnInkSm}>
                    Gerar rascunho
                  </button>
                </form>
                <p className="mt-3 max-w-xl text-xs leading-relaxed text-ink-400">
                  Entram no pagamento: aula dada, aula que passou sem registro e falta do aluno. Gere
                  o rascunho, confira, ajuste se precisar (com motivo) e feche — fechado não muda mais.
                  Os períodos precisam se encaixar sem buraco nem sobreposição.
                </p>
        </SidePanel>
      )}
    </main>
  )
}
