import { DateTime } from 'luxon'
import Link from 'next/link'
import { fmtCivilShort, fmtCivilDate } from '@/lib/format'

/** Período civil humano: mês inteiro vira "junho/2026". */
function periodoHumano(startISO: string, endISO: string): string {
  const ini = DateTime.fromISO(startISO).setLocale('pt-BR')
  const fim = DateTime.fromISO(endISO).setLocale('pt-BR')
  if (ini.day === 1 && fim.toISODate() === ini.endOf('month').toISODate()) return ini.toFormat('LLLL/yyyy')
  return `${fmtCivilShort(startISO)} – ${fmtCivilDate(endISO)}`
}
import { createClient } from '@/lib/supabase/server'
import { DateField } from '@/components/DateField'
import { btnInkSm, input, linkActionXs, EmptyState, Field, FlashMsg, Pill, SidePanel, toolbarLink } from '@/components/ui'
import { generateReportAction } from './actions'

export const metadata = { title: 'Relatórios — Admin' }

// Relatórios de progresso: rascunho (escrito pela IA a partir dos fatos do
// período) → você revisa e aprova → envia. Rodada B: fluxo explicado na tela,
// datas humanas, cartões no celular.

const STATUS_PT: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'muted' }> = {
  draft: { label: 'rascunho — revise', tone: 'warn' },
  approved: { label: 'aprovado', tone: 'ok' },
  sent: { label: 'enviado', tone: 'muted' },
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; st?: string; painel?: string }>
}) {
  const { msg, st, painel } = await searchParams
  const soRascunhos = st === 'rascunhos'
  const supabase = await createClient()
  const [{ data: reports }, { data: students }] = await Promise.all([
    supabase
      .from('progress_reports')
      .select('id, student_id, period_start, period_end, title, status, updated_at, students(display_name)')
      .order('updated_at', { ascending: false })
      .limit(60),
    supabase.from('students').select('id, display_name').order('display_name'),
  ])
  const todas = reports ?? []
  const rascunhos = todas.filter((r) => r.status === 'draft').length
  const rows = soRascunhos ? todas.filter((r) => r.status === 'draft') : todas

  return (
    <main className="flex flex-col gap-4">
      <FlashMsg msg={msg} />

      <header>
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Relatórios <span className="font-sans text-base font-normal text-ink-400">de progresso</span>
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          O rascunho nasce dos fatos do período (aulas, presenças, desfechos) — nada é inventado.
          Você revisa, edita e aprova antes de qualquer aluno ver.
        </p>
      </header>

      <Link href="/admin/relatorios?painel=rascunho" className={toolbarLink}>
        ＋ Gerar rascunho
      </Link>

      {rascunhos > 0 && !soRascunhos && (
        <p className="rounded-card border border-warn-700/30 bg-warn-700/5 p-3 text-sm text-ink-900">
          {rascunhos} rascunho{rascunhos > 1 ? 's' : ''} esperando a sua revisão.{' '}
          <Link href="/admin/relatorios?st=rascunhos" className="font-semibold text-warn-700 hover:underline">
            Revisar →
          </Link>
        </p>
      )}
      {soRascunhos && (
        <p className="text-xs text-ink-400">
          Mostrando só os rascunhos.{' '}
          <Link href="/admin/relatorios" className="font-semibold text-brand-700 hover:underline">
            ver todos
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum relatório ainda."
          hint="Gere o primeiro rascunho acima — a IA escreve a partir das aulas do período e você dá a palavra final."
        />
      ) : (
        <>
          {/* tabela — desktop */}
          <div className="hidden overflow-x-auto rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card) md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left">
                <tr>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Aluno</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Período</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Título</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Situação</th>
                  <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-ink-400 uppercase">Atualizado</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {rows.map((r) => {
                  const student = Array.isArray(r.students) ? r.students[0] : r.students
                  const st = STATUS_PT[r.status] ?? { label: r.status, tone: 'neutral' as const }
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-semibold text-ink-900">
                        {(student as { display_name?: string } | null)?.display_name ?? '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-ink-600">{periodoHumano(r.period_start, r.period_end)}</td>
                      <td className="max-w-64 truncate px-4 py-2 text-ink-600">{r.title}</td>
                      <td className="px-4 py-2">
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-400">
                        {DateTime.fromISO(r.updated_at).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link href={`/admin/relatorios/${r.id}`} className={linkActionXs}>
                          abrir →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* cartões — celular */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => {
              const student = Array.isArray(r.students) ? r.students[0] : r.students
              const st = STATUS_PT[r.status] ?? { label: r.status, tone: 'neutral' as const }
              return (
                <li key={r.id}>
                  <Link
                    href={`/admin/relatorios/${r.id}`}
                    className="card-interactive flex flex-col gap-1.5 rounded-card border border-line-soft bg-paper-0 p-4"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink-900">
                        {(student as { display_name?: string } | null)?.display_name ?? '—'}
                      </span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </span>
                    <span className="text-xs text-ink-400">
                      {periodoHumano(r.period_start, r.period_end)} · {r.title}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* S2-10b (padrão TutorBird): forms grandes em PAINEL LATERAL */}
      {painel === 'rascunho' && (
        <SidePanel title="Gerar rascunho de relatório" closeHref="/admin/relatorios">
        <form action={generateReportAction} className="flex flex-col gap-4">
          <Field label="Aluno">
            <select name="student_id" required className={input}>
              <option value="">Escolha…</option>
              {(students ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Início do período">
            <DateField name="period_start" required />
          </Field>
          <Field label="Fim do período">
            <DateField name="period_end" required />
          </Field>
          <button type="submit" className={btnInkSm}>
            Gerar rascunho
          </button>
        </form>
        </SidePanel>
      )}
    </main>
  )
}
