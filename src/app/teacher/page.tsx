import { DateTime } from 'luxon'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DateField } from '@/components/DateField'
import { CalendarGrid, type CalEvent } from '@/components/CalendarGrid'
import { subtractBusy } from '@/lib/google/busy-subtract'
import { TimeField } from '@/components/TimeField'
import { googleOAuthConfigFromEnv } from '@/lib/google/oauth'
import { googleBusyForTeacher } from '@/lib/google/sync'
import { createAdminClient } from '@/lib/supabase/admin'
import { fmtBRL, tzLabel, tzSuffix } from '@/lib/format'
import { one } from '@/lib/embed'
import { aulaQueEncosta } from '@/lib/windows'
import { KOLB_STYLE_LABEL } from '@/lib/briefing/schema'
import {
  btnInk,
  btnInkSm,
  chipBrandOn,
  chipOff,
  navArrow,
  touchTarget,
  inputSm,
  Card,
  ConfirmAction,
  Drawer,
  EmptyState,
  Field,
  Pill,
  SectionTitle,
  SidePanel,
  STATE_LABEL,
} from '@/components/ui'
import {
  addBlockAction,
  addWeeklyAvailabilityAction,
  cancelOwnClassAction,
  cancelOwnWindowAction,
  disconnectGoogleAction,
  publishOwnWindowAction,
  removeBlockAction,
  removeWeeklyAvailabilityAction,
  reportClassContentAction,
} from './actions'

export const metadata = { title: 'Painel da professora — Personal Teacher' }

// Rodada B: fim da rolagem única — abas Agenda / Aulas / Extratos / Conta.
// Tudo no fuso DELA (nome de cidade, nunca IANA cru); hora do aluno humanizada.

type Aba = 'agenda' | 'aulas' | 'alunos' | 'extratos' | 'conta'
const ABAS: { key: Aba; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'aulas', label: 'Aulas' },
  { key: 'alunos', label: 'Alunos' },
  { key: 'extratos', label: 'Extratos' },
  { key: 'conta', label: 'Conta' },
]

/** "2026-07-28 20:00 Europe/Lisbon" → "20:00 (horário de Lisboa)". */
function humanSnapshot(snapshot: string): string | null {
  const m = snapshot.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2})? (.+)$/)
  if (!m) return null
  return `${m[2]} (${tzSuffix(m[3])})`
}

export default async function TeacherPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; nd?: string; nt?: string; aba?: string; pub?: string; painel?: string }>
}) {
  const { d, nd, nt, aba: abaRaw, pub, painel } = await searchParams
  const aba: Aba =
    abaRaw === 'aulas' || abaRaw === 'alunos' || abaRaw === 'extratos' || abaRaw === 'conta'
      ? abaRaw
      : 'agenda'
  const prefillDate = nd && /^\d{4}-\d{2}-\d{2}$/.test(nd) ? nd : undefined
  const prefillTime = nt && /^\d{2}:\d{2}$/.test(nt) ? nt : undefined
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Filtro explícito por auth.uid(): a dona é admin (admin_all veria todas as
  // linhas) — "a própria professora" é sempre a do profile logado.
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, display_name, iana_tz')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()

  if (!teacher) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <p className="text-ink-400">Sua conta não está vinculada a uma professora. Fale com a administração.</p>
      </main>
    )
  }

  // relógio por request é intencional (Server Component)
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const since = new Date(now - 14 * 864e5).toISOString()
  const until = new Date(now + 14 * 864e5).toISOString()

  // F5/M12-12: agenda semanal + bloqueios da própria professora; issue #85: a
  // medida de um horário de reposição (a meia-hora da grade que encosta numa
  // aula dela não oferece "Publicar aqui" — quem decide é a RPC).
  const [{ data: weekly }, { data: blocks }, { data: medidaDaJanela }] = await Promise.all([
    supabase
      .from('teacher_weekly_availability')
      .select('id, weekday, start_local, end_local, iana_tz')
      .eq('teacher_id', teacher.id)
      .order('weekday')
      .order('start_local'),
    supabase
      .from('teacher_availability_exceptions')
      .select('id, kind, starts_at_utc, ends_at_utc, local_snapshot, note')
      .eq('teacher_id', teacher.id)
      .eq('kind', 'block')
      .gte('ends_at_utc', new Date(now).toISOString())
      .order('starts_at_utc'),
    supabase.rpc('teacher_window_span_min', { p_teacher: teacher.id }),
  ])

  const [{ data: agenda }, { data: windows }, { data: statements }, { data: gcal }] = await Promise.all([
    supabase
      .from('teacher_agenda')
      .select('id, starts_at_utc, ends_at_utc, state, local_time_snapshot, student_label, confirmed_at, contract_id')
      .gte('starts_at_utc', since)
      .lte('starts_at_utc', until)
      .order('starts_at_utc'),
    // filtro EXPLÍCITO por teacher_id: a dona é admin vinculada — sem isso as
    // policies admin_all devolveriam janelas/extratos da outra professora.
    supabase
      .from('reschedule_windows')
      .select('id, starts_at_utc, state, iana_tz')
      .eq('teacher_id', teacher.id)
      .gte('starts_at_utc', new Date(now - 7 * 864e5).toISOString())
      .order('starts_at_utc'),
    supabase
      .from('teacher_statements')
      .select('id, period_start, period_end, audited_hours, rate_cents, adjustments_cents, manual_adjustments_cents, total_cents, status')
      .eq('teacher_id', teacher.id)
      .order('period_start', { ascending: false })
      .limit(12),
    // colunas NOMEADAS de propósito — o cifrado fica fora do grant de coluna.
    supabase
      .from('teacher_google_accounts')
      .select('google_email, connected_at, last_sync_at, last_sync_error')
      .eq('teacher_id', teacher.id)
      .maybeSingle(),
  ])
  const gcalConfigured = googleOAuthConfigFromEnv() !== null

  // Cronograma M3-UI (20/07): dados das abas Alunos (lista + status de
  // briefing/plano) e Aulas (módulos por contrato + apontamentos feitos).
  const agendaIds = (agenda ?? []).map((x) => x.id)
  const [{ data: meusContratos }, { data: planItems }, { data: contentReports }] = await Promise.all([
    aba === 'alunos'
      ? supabase
          .from('contracts')
          .select('id, status, students!contracts_student_id_fkey(id, display_name, level)')
          .eq('teacher_id', teacher.id)
          .eq('contract_type', 'private_1on1')
          .neq('status', 'ended')
      : Promise.resolve({ data: null }),
    aba === 'aulas'
      ? supabase
          .from('study_plan_items')
          .select('id, position, title, study_plans!inner(contract_id)')
          .order('position')
      : Promise.resolve({ data: null }),
    aba === 'aulas' && agendaIds.length
      ? supabase
          .from('class_content_reports')
          .select('class_instance_id, plan_item_id, off_track_kind')
          .in('class_instance_id', agendaIds)
      : Promise.resolve({ data: null }),
  ])
  const briefingKolb = new Map<string, string | null>()
  const contratosComPlano = new Set<string>()
  if (aba === 'alunos' && (meusContratos ?? []).length) {
    const sids = (meusContratos ?? []).map((c) => one(c.students)?.id).filter(Boolean) as string[]
    const [{ data: bfs }, { data: pls }] = await Promise.all([
      sids.length
        ? supabase.from('briefings').select('student_id, status, kolb_style').in('student_id', sids)
        : Promise.resolve({ data: [] }),
      supabase.from('study_plans').select('contract_id').in('contract_id', (meusContratos ?? []).map((c) => c.id)),
    ])
    for (const b of bfs ?? []) briefingKolb.set(b.student_id, b.status === 'submitted' ? b.kolb_style : null)
    for (const p of pls ?? []) contratosComPlano.add(p.contract_id)
  }
  const itensPorContrato = new Map<string, { id: string; position: number; title: string }[]>()
  for (const it of planItems ?? []) {
    const cid = (Array.isArray(it.study_plans) ? it.study_plans[0] : it.study_plans)?.contract_id
    if (!cid) continue
    itensPorContrato.set(cid, [
      ...(itensPorContrato.get(cid) ?? []),
      { id: it.id, position: it.position, title: it.title },
    ])
  }
  const reportDaAula = new Map((contentReports ?? []).map((r) => [r.class_instance_id, r]))

  const fmt = (utc: string) =>
    DateTime.fromISO(utc, { zone: 'utc' }).setZone(teacher.iana_tz).setLocale('pt-BR').toFormat("ccc, dd/LL 'às' HH:mm")

  const nowTz = DateTime.now().setZone(teacher.iana_tz)
  const todayISO = nowTz.toFormat('yyyy-LL-dd')
  const anchor = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayISO
  const a = DateTime.fromISO(anchor, { zone: teacher.iana_tz })
  const weekStart = a.startOf('day').minus({ days: a.weekday - 1 }) // item 14.2: segunda
  const weekEnd = weekStart.plus({ days: 7 })

  const busy =
    aba === 'agenda' && gcal
      ? await googleBusyForTeacher(createAdminClient(), teacher.id, {
          fromUtcISO: weekStart.toUTC().toISO()!,
          toUtcISO: weekEnd.toUTC().toISO()!,
        })
      : null

  const inWeek = (utc: string) => {
    const t = DateTime.fromISO(utc)
    return t >= weekStart.toUTC() && t <= weekEnd.toUTC()
  }
  const gridEvents: CalEvent[] = [
    ...(agenda ?? [])
      .filter((x) => inWeek(x.starts_at_utc))
      .map((x) => ({
        id: x.id,
        startsAtUtc: x.starts_at_utc,
        endsAtUtc: x.ends_at_utc,
        title: x.student_label ?? '—',
        color: 0,
        dim: x.state === 'completed',
        strike: x.state === 'cancelled' || x.state === 'rescheduled',
        // M-AG: no_show é FALTA (desfecho terminal, dinheiro) = acento danger,
        // não warn — mantém a semântica de perda sobre a tinta da professora
        falta: x.state.startsWith('no_show'),
        // M-AG (arbitragem): a grade mostra 14 dias de passado; scheduled já
        // iniciada é SEM REGISTRO (warn), não pode parecer futura sólida
        warn: x.state === 'scheduled' && DateTime.fromISO(x.starts_at_utc).toMillis() < now,
        popup: (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink-900">{x.student_label ?? '—'}</span>
            <span className="text-xs text-ink-600">
              {fmt(x.starts_at_utc)}
              {humanSnapshot(x.local_time_snapshot) && (
                <>
                  <br />
                  para o aluno: {humanSnapshot(x.local_time_snapshot)}
                </>
              )}
            </span>
            <span className="text-xs text-ink-400">{STATE_LABEL[x.state] ?? x.state}</span>
          </div>
        ),
      })),
    ...(windows ?? [])
      .filter((w) => inWeek(w.starts_at_utc) && w.state !== 'cancelada')
      .map((w) => ({
        id: `w-${w.id}`,
        startsAtUtc: w.starts_at_utc,
        title: w.state === 'consumida' ? 'horário usado' : 'horário aberto',
        color: 0,
        dashed: true,
        dim: w.state !== 'publicada',
        popup: (
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-ink-900">Horário de reposição</span>
            <span className="text-xs text-ink-600">
              {fmt(w.starts_at_utc)} · {w.state === 'publicada' ? 'aberto para os alunos' : 'já usado'}
            </span>
            {w.state === 'publicada' && (
              <form action={cancelOwnWindowAction} className="border-t border-line-soft pt-2">
                <input type="hidden" name="window_id" value={w.id} />
                <button type="submit" className="text-xs font-semibold text-danger-700 hover:underline">
                  Despublicar este horário
                </button>
              </form>
            )}
          </div>
        ),
      })),
    ...subtractBusy(
      busy?.status === 'ok' ? busy.blocks : [],
      (agenda ?? [])
        .filter((x) => x.state === 'scheduled' || x.state === 'completed')
        .map((x) => ({ startUtc: x.starts_at_utc, endUtc: x.ends_at_utc })),
    ).map((b, i) => ({
      id: `g-${i}`,
      startsAtUtc: b.startUtc,
      endsAtUtc: b.endUtc,
      title: 'ocupada (sua agenda Google)',
      color: 0,
      ghost: true,
    })),
    // item 14.5: a disponibilidade semanal aparece como camada de fundo
    // ("expediente" do Google) — a janela criada deixa de ser invisível.
    ...Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i })).flatMap((day) =>
      (weekly ?? [])
        .filter((w) => day.weekday % 7 === w.weekday)
        .map((w) => ({
          id: `av-${w.id}-${day.toFormat('yyyy-LL-dd')}`,
          startsAtUtc: DateTime.fromISO(`${day.toFormat('yyyy-LL-dd')}T${w.start_local}`, { zone: teacher.iana_tz })
            .toUTC()
            .toISO()!,
          endsAtUtc: DateTime.fromISO(`${day.toFormat('yyyy-LL-dd')}T${w.end_local}`, { zone: teacher.iana_tz })
            .toUTC()
            .toISO()!,
          title: 'disponível',
          color: 0,
          avail: true,
        })),
    ),
  ]

  const abertas = (windows ?? []).filter(
    (w) => w.state === 'publicada' && DateTime.fromISO(w.starts_at_utc).toMillis() >= now,
  )

  return (
    <main className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Olá, {teacher.display_name}!</h1>
          <p className="text-sm text-ink-400">
            Tudo aqui está no seu fuso ({tzLabel(teacher.iana_tz)}).
          </p>
        </div>
        <nav className="flex items-center gap-1" aria-label="Seções do painel">
          {ABAS.map((t) => (
            <Link key={t.key} href={t.key === 'agenda' ? '/teacher' : `/teacher?aba=${t.key}`} className={aba === t.key ? chipBrandOn : chipOff}>
              {t.label}
            </Link>
          ))}
        </nav>
      </header>


      {aba === 'agenda' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex items-center gap-1.5" aria-label="Navegar no tempo">
              <Link href={`/teacher?d=${a.minus({ days: 7 }).toFormat('yyyy-LL-dd')}`} className={navArrow} title="Semana anterior">
                ‹
              </Link>
              <Link href="/teacher" className={`${chipOff} ${touchTarget}`}>
                Hoje
              </Link>
              <Link href={`/teacher?d=${a.plus({ days: 7 }).toFormat('yyyy-LL-dd')}`} className={navArrow} title="Próxima semana">
                ›
              </Link>
            </nav>
            <span className="text-sm font-medium text-ink-600">
              {weekStart.setLocale('pt-BR').toFormat('dd/LL')} – {weekEnd.minus({ days: 1 }).setLocale('pt-BR').toFormat('dd/LL')}
            </span>
            <Link href={`/teacher?pub=1${anchor !== todayISO ? `&d=${anchor}` : ''}`} className={chipOff}>
              ＋ Publicar horário de reposição
            </Link>
            {/* e2e 19/07: forms grandes moram em PAINEL LATERAL (padrão S2-10) */}
            <Link href={`/teacher?painel=janelas${anchor !== todayISO ? `&d=${anchor}` : ''}`} className={chipOff}>
              Disponibilidade e bloqueios
            </Link>
          </div>

          {(pub === '1' || (prefillDate && prefillTime)) && (
            <Card className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-bold text-ink-900">Publicar horário de reposição</h2>
                <Link href="/teacher" className="text-xs font-semibold text-ink-400 hover:text-ink-900">
                  fechar ×
                </Link>
              </div>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-400">
                Hora no seu fuso ({tzLabel(teacher.iana_tz)}). Seus alunos usam esses horários para
                remarcar ou repor aulas pelo portal — eles só enxergam horários até 2 semanas à
                frente.
              </p>
              <form action={publishOwnWindowAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <Field label="Data">
                  <DateField name="local_date" required defaultValue={prefillDate} />
                </Field>
                <Field label="Hora">
                  <TimeField name="local_time" required defaultValue={prefillTime} />
                </Field>
                <button type="submit" className={`${btnInkSm} w-full sm:w-auto`}>
                  Publicar
                </button>
              </form>
            </Card>
          )}

          <CalendarGrid
            events={gridEvents}
            view="semana"
            anchor={anchor}
            tz={teacher.iana_tz}
            dayHref={(iso) => `/teacher?d=${iso}`}
            todayISO={todayISO}
            slotPopup={(iso, hhmm) => {
              const titulo = (
                <p className="text-xs font-semibold text-ink-900">
                  Publicar horário de reposição — {DateTime.fromISO(iso).setLocale('pt-BR').toFormat('ccc, dd/LL')} às {hhmm}
                </p>
              )
              // Issue #85: a janela medida que encosta numa aula marcada dela é
              // recusada pela RPC; aqui ela só deixa de ser oferecida.
              const encostada = aulaQueEncosta(
                DateTime.fromISO(`${iso}T${hhmm}`, { zone: teacher.iana_tz }).toMillis(),
                typeof medidaDaJanela === 'number' ? medidaDaJanela : null,
                (agenda ?? []).filter((x) => x.state === 'scheduled'),
              )
              if (encostada)
                return (
                  <div className="flex flex-col gap-2">
                    {titulo}
                    <p className="text-sm font-medium text-ink-900">
                      Esse horário encosta na sua aula de {fmt(encostada.starts_at_utc)} — nenhum aluno conseguiria
                      reservar uma janela aqui.
                    </p>
                  </div>
                )
              return (
                <form action={publishOwnWindowAction} className="flex flex-col gap-2">
                  {titulo}
                  <p className="text-[11px] text-ink-400">Seus alunos poderão remarcar/repor para cá.</p>
                  <input type="hidden" name="local_date" value={iso} />
                  <input type="hidden" name="local_time" value={hhmm} />
                  <button type="submit" className={`${btnInkSm} self-start`}>
                    Publicar aqui
                  </button>
                </form>
              )
            }}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            <span>Dica: clique numa meia-hora vazia para publicar um horário de reposição ali.</span>
            {busy?.status === 'indisponivel' && (
              <span>⚠️ Seus compromissos do Google não carregaram agora — a grade mostra só aulas e horários.</span>
            )}
          </div>

          {/* F5/M12-12 + e2e 19/07: a disponibilidade RECORRENTE e os bloqueios
              saem do meio da página para o PAINEL LATERAL (padrão TutorBird);
              publicar avulso continua existindo como exceção pontual */}
          {painel === 'janelas' && (
          <SidePanel
            title="Disponibilidade e bloqueios"
            closeHref={`/teacher${anchor !== todayISO ? `?d=${anchor}` : ''}`}
          >
          <section className="flex flex-col gap-3">
            <SectionTitle>Sua disponibilidade semanal</SectionTitle>
            <p className="text-xs text-ink-400">
              Os alunos veem como horários agendáveis o que estiver dentro destas janelas — menos
              suas aulas, seus compromissos do Google e seus bloqueios.
            </p>
            {(weekly ?? []).length > 0 && (
              <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
                {(weekly ?? []).map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="text-ink-900">
                      {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][w.weekday]} ·{' '}
                      {String(w.start_local).slice(0, 5)}–{String(w.end_local).slice(0, 5)}
                    </span>
                    <form action={removeWeeklyAvailabilityAction}>
                      <input type="hidden" name="id" value={w.id} />
                      <button type="submit" className="text-xs font-semibold text-danger-700 hover:underline">
                        remover
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addWeeklyAvailabilityAction} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                Dia
                <select name="weekday" className="min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm">
                  {['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'].map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                Das
                <TimeField name="start_local" required />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                Até
                <TimeField name="end_local" required />
              </label>
              <button type="submit" className={`${btnInkSm} !min-h-11`}>
                ＋ adicionar janela
              </button>
            </form>

            <SectionTitle>Bloqueios (férias, compromissos)</SectionTitle>
            {(blocks ?? []).length > 0 && (
              <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
                {(blocks ?? []).map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="text-ink-900">
                      {b.local_snapshot}
                      {b.note ? <span className="text-ink-400"> · {b.note}</span> : null}
                    </span>
                    <form action={removeBlockAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <button type="submit" className="text-xs font-semibold text-danger-700 hover:underline">
                        remover
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addBlockAction} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                De
                <DateField name="from" required />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                Até
                <DateField name="to" required />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-600">
                Motivo
                <input name="note" placeholder="ex.: viagem" className="min-h-11 rounded-input border border-line bg-paper-0 px-3 py-2 text-sm" />
              </label>
              <button type="submit" className={`${btnInkSm} !min-h-11`}>
                ＋ bloquear período
              </button>
            </form>
          </section>
          </SidePanel>
          )}

          {abertas.length > 0 && (
            <section>
              <SectionTitle>Seus horários abertos</SectionTitle>
              <ul className="mt-2 divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
                {abertas.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium text-ink-900 first-letter:uppercase">{fmt(w.starts_at_utc)}</span>
                    <div className="flex items-center gap-3">
                      <Pill tone="ok">aberto</Pill>
                      <form action={cancelOwnWindowAction}>
                        <input type="hidden" name="window_id" value={w.id} />
                        <button type="submit" className="text-xs font-semibold text-danger-700 hover:underline">
                          despublicar
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Cronograma M3-UI: seus alunos → plano de estudos de cada um */}
      {aba === 'alunos' && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Seus alunos</SectionTitle>
          <p className="text-xs text-ink-400">
            O plano de estudos de cada aluno nasce da trilha do nível dele e é personalizado por
            você — com o briefing (interesses + estilo de aprendizagem) como guia.
          </p>
          {(meusContratos ?? []).length === 0 ? (
            <EmptyState title="Nenhum aluno ativo no momento." />
          ) : (
            <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
              {(meusContratos ?? []).map((ct) => {
                const st = one(ct.students)
                const kolb = st ? briefingKolb.get(st.id) : undefined
                return (
                  <li key={ct.id}>
                    <Link
                      href={`/teacher/alunos/${ct.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-paper-100"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-semibold text-ink-900">{st?.display_name ?? '—'}</span>
                        {st?.level && <Pill tone="brand">{st.level}</Pill>}
                      </span>
                      <span className="flex items-center gap-2">
                        {kolb ? (
                          <Pill tone="ok">{KOLB_STYLE_LABEL[kolb]?.nome ?? kolb}</Pill>
                        ) : (
                          <Pill tone="warn">briefing pendente</Pill>
                        )}
                        {contratosComPlano.has(ct.id) ? (
                          <Pill tone="neutral">plano criado</Pill>
                        ) : (
                          <Pill tone="warn">sem plano</Pill>
                        )}
                        <span className="text-xs font-semibold text-brand-700">abrir →</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {aba === 'aulas' && (
        <section className="flex flex-col gap-5">
          {/* S2-1 (e2e): a PRÓXIMA aula em destaque, no padrão do card da home
              do portal/admin — a fila contínua segue logo abaixo. */}
          {(() => {
            const proxima = (agenda ?? []).find(
              (x) => x.state === 'scheduled' && DateTime.fromISO(x.starts_at_utc).toMillis() >= now,
            )
            if (!proxima) return null
            return (
              <div className="rounded-card border border-transparent bg-paper-0 p-5 shadow-(--glow-brand)">
                <span className="text-[10px] font-bold tracking-[0.14em] text-brand-700 uppercase">A seguir</span>
                <p className="mt-1 font-display text-2xl font-bold text-ink-900 first-letter:uppercase">
                  {fmt(proxima.starts_at_utc)}
                </p>
                <p className="mt-0.5 text-sm text-ink-600">
                  {proxima.student_label ?? '—'}
                  {proxima.confirmed_at && (
                    <span className="ml-2 text-xs font-bold text-ok-700">✓ presença confirmada</span>
                  )}
                </p>
              </div>
            )
          })()}
          {(agenda ?? []).length === 0 ? (
            <EmptyState title="Nenhuma aula neste período." />
          ) : (
            (
              [
                ['Próximas aulas', (agenda ?? []).filter((x) => DateTime.fromISO(x.starts_at_utc).toMillis() >= now)],
                ['Últimas 2 semanas', (agenda ?? []).filter((x) => DateTime.fromISO(x.starts_at_utc).toMillis() < now).reverse()],
              ] as const
            ).map(([titulo, lista]) => (
              <div key={titulo}>
                <SectionTitle>{titulo}</SectionTitle>
                {/* S2-2 (e2e): o desfecho é tarefa da ADMINISTRAÇÃO — a pill
                    "aguardando registro" é informativa, não uma ação sua. */}
                {titulo === 'Últimas 2 semanas' && (
                  <p className="mt-1 text-xs text-ink-400">
                    Os desfechos (realizada/falta) são registrados pela administração — mas o{' '}
                    <strong className="text-ink-600">conteúdo trabalhado é seu</strong>: aponte em
                    cada aula (sem apontamento, a administração não consegue registrar).
                  </p>
                )}
                {lista.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-400">Nada por aqui.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
                    {lista.map((x) => {
                      const futuraNormal = titulo === 'Próximas aulas' && x.state === 'scheduled'
                      return (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                          <div className="min-w-0">
                            <span className="font-mono text-xs font-semibold text-ink-900 first-letter:uppercase">
                              {fmt(x.starts_at_utc)}
                            </span>
                            <span className="ml-2 font-semibold text-ink-900">{x.student_label ?? '—'}</span>
                            {/* F6/M8-3: badge informativo de presença confirmada */}
                            {x.state === 'scheduled' && x.confirmed_at && (
                              <span className="ml-2 text-xs font-bold text-ok-700">✓ confirmada</span>
                            )}
                            {humanSnapshot(x.local_time_snapshot) && (
                              <span className="ml-2 text-xs text-ink-400">
                                aluno: {humanSnapshot(x.local_time_snapshot)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* M2 (01/09/2026): a professora REMARCA e CANCELA a
                                própria aula. A regra de dinheiro é do banco; a
                                consequência está escrita antes do botão. */}
                            {futuraNormal && (
                              <>
                                <Link href={`/teacher/remarcar/${x.id}`} className={btnInkSm}>
                                  remarcar
                                </Link>
                                <Drawer label="cancelar" title={`Cancelar a aula — ${x.student_label ?? ''}`}>
                                  <form action={cancelOwnClassAction} className="flex flex-col gap-3">
                                    <input type="hidden" name="instance_id" value={x.id} />
                                    <p className="text-sm font-medium text-ink-900 first-letter:uppercase">
                                      {fmt(x.starts_at_utc)} · {x.student_label ?? '—'}
                                    </p>
                                    <p className="text-sm text-ink-900">
                                      O que acontece: como a falta é da escola,{' '}
                                      <strong>o aluno ganha 1 crédito de reposição</strong> e é avisado por e-mail e
                                      WhatsApp. A administração recebe o seu motivo.
                                    </p>
                                    <Field label="Motivo (obrigatório — vai para a administração, não para o aluno)">
                                      <textarea name="reason" required minLength={3} maxLength={500} rows={3} className={inputSm} />
                                    </Field>
                                    <button type="submit" className={btnInk}>
                                      Cancelar esta aula
                                    </button>
                                  </form>
                                </Drawer>
                              </>
                            )}
                            {!futuraNormal && (
                              <Pill
                                tone={
                                  x.state === 'completed'
                                    ? 'ok'
                                    : x.state.startsWith('no_show')
                                      ? 'danger'
                                      : x.state === 'scheduled'
                                        ? 'warn'
                                        : 'muted'
                                }
                              >
                                {x.state === 'scheduled' ? 'aguardando registro' : (STATE_LABEL[x.state] ?? x.state)}
                              </Pill>
                            )}
                            {/* M3: apontamento do CONTEÚDO — aulas passadas dadas/pendentes */}
                            {titulo === 'Últimas 2 semanas' &&
                              (x.state === 'scheduled' || x.state === 'completed') &&
                              (reportDaAula.has(x.id) ? (
                                <span className="text-xs font-bold text-ok-700">conteúdo ✓</span>
                              ) : (
                                <Drawer label="o que trabalhei" title={`Conteúdo da aula — ${x.student_label ?? ''}`}>
                                  <form action={reportClassContentAction} className="flex flex-col gap-3">
                                    <input type="hidden" name="instance_id" value={x.id} />
                                    <input type="hidden" name="back" value="/teacher?aba=aulas" />
                                    {(itensPorContrato.get(x.contract_id) ?? []).length > 0 && (
                                      <Field label="Módulo do plano" hint="deixe em branco se foi um tema avulso">
                                        <select name="plan_item" className={inputSm} defaultValue="">
                                          <option value="">— nenhum (tema avulso abaixo)</option>
                                          {(itensPorContrato.get(x.contract_id) ?? []).map((m) => (
                                            <option key={m.id} value={m.id}>
                                              {m.position}. {m.title}
                                            </option>
                                          ))}
                                        </select>
                                      </Field>
                                    )}
                                    <Field label="Tema avulso" hint="quando a aula fugiu da trilha">
                                      <select name="off_kind" className={inputSm} defaultValue="">
                                        <option value="">—</option>
                                        <option value="revisao">revisão</option>
                                        <option value="prova">prova</option>
                                        <option value="extra">conteúdo extra</option>
                                        <option value="conversacao">conversação</option>
                                        <option value="outro">outro</option>
                                      </select>
                                    </Field>
                                    <Field label="Detalhe (opcional)">
                                      <input name="off_note" placeholder="ex.: simulado de proficiência" className={inputSm} />
                                    </Field>
                                    <button type="submit" className={btnInkSm}>
                                      Apontar conteúdo
                                    </button>
                                  </form>
                                </Drawer>
                              ))}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {aba === 'extratos' && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Seus extratos de pagamento</SectionTitle>
          <p className="max-w-2xl text-sm text-ink-600">
            Cada extrato soma suas horas do período. “Em conferência” ainda pode mudar; “fechado” é
            definitivo.
          </p>
          {(statements ?? []).length === 0 ? (
            <EmptyState title="Nenhum extrato ainda." hint="A administração gera os extratos por período." />
          ) : (
            <ul className="divide-y divide-line-soft rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
              {(statements ?? []).map((st) => {
                const ajustes = st.adjustments_cents + st.manual_adjustments_cents
                const ini = DateTime.fromISO(st.period_start).setLocale('pt-BR')
                const fim = DateTime.fromISO(st.period_end).setLocale('pt-BR')
                const mesInteiro = ini.day === 1 && fim.equals(ini.endOf('month').startOf('day'))
                const periodo = mesInteiro
                  ? ini.toFormat("LLLL 'de' yyyy")
                  : `${ini.toFormat('dd/LL')} – ${fim.toFormat('dd/LL/yyyy')}`
                const horas = Number(st.audited_hours).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
                return (
                  <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="text-ink-600 first-letter:uppercase">{periodo}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-ink-400">
                        {horas} h × {fmtBRL(st.rate_cents)}
                        {ajustes !== 0 && ` + ajustes ${fmtBRL(ajustes)}`}
                      </span>
                      <span className="font-mono font-semibold text-ink-900 tabular-nums">{fmtBRL(st.total_cents)}</span>
                      <Pill tone={st.status === 'closed' ? 'muted' : 'warn'}>
                        {st.status === 'closed' ? 'fechado' : 'em conferência'}
                      </Pill>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {aba === 'conta' && (
        <section className="flex max-w-2xl flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display text-base font-bold text-ink-900">Google Agenda</h2>
            {gcal ? (
              <>
                <p className="mt-1 text-sm text-ink-600">
                  Conectada como <strong className="text-ink-900">{gcal.google_email}</strong>. Suas aulas e
                  horários de reposição aparecem na sua agenda do Google, e seus compromissos pessoais
                  contam como “ocupada” na grade.
                </p>
                <p className="mt-2 text-xs text-ink-400">
                  {gcal.last_sync_error
                    ? 'A última sincronização falhou — tentamos de novo sozinhos.'
                    : gcal.last_sync_at
                      ? `Última sincronização: ${fmt(gcal.last_sync_at)}`
                      : 'Primeira sincronização ainda não rodou.'}
                </p>
                <div className="mt-3">
                  <ConfirmAction
                    label="desconectar Google Agenda"
                    warning="Suas aulas somem da sua agenda do Google e seus compromissos pessoais deixam de contar como “ocupada”. Dá para reconectar quando quiser."
                    confirmLabel="desconectar"
                    action={disconnectGoogleAction}
                    values={{}}
                    align="left"
                  />
                </div>
              </>
            ) : gcalConfigured ? (
              <>
                <p className="mt-1 text-sm text-ink-600">
                  Conecte sua conta Google para ver suas aulas na sua agenda — e para o sistema
                  respeitar seus compromissos pessoais. Só os horários são lidos; os detalhes dos seus
                  eventos ficam com você.
                </p>
                {/* <a> de propósito (rota handler, não página): o clique inicia o OAuth. */}
                <a href="/teacher/google/conectar" className={`${btnInk} mt-4 inline-flex`}>
                  Conectar Google Agenda
                </a>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-400">
                A integração com o Google Agenda ainda não foi ativada no servidor — em breve por aqui.
              </p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-display text-base font-bold text-ink-900">Seu fuso</h2>
            <p className="mt-1 text-sm text-ink-600">
              Seus horários são exibidos no fuso de {tzLabel(teacher.iana_tz)}. Para mudar, fale com a
              administração.
            </p>
          </Card>
        </section>
      )}
    </main>
  )
}
