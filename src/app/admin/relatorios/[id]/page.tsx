import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fmtCivilShort, fmtCivilDate } from '@/lib/format'
import { btnInkSm, input, linkActionXs, ConfirmAction, Field, FlashMsg, Pill } from '@/components/ui'
import {
  approveReportAction,
  deleteDraftAction,
  generateSlidesAction,
  markSentAction,
  updateReportDraftAction,
} from '../actions'

export const metadata = { title: 'Relatório — Admin' }

// Detalhe do relatório: edição SÓ em rascunho (o trigger do banco congela
// aprovado/enviado — Lei 8); aprovado → Slides → marcado como enviado.

export default async function RelatorioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ msg?: string }>
}) {
  const { id } = await params
  const { msg } = await searchParams
  const supabase = await createClient()
  const { data: r } = await supabase
    .from('progress_reports')
    .select(
      'id, title, content_md, highlights, status, period_start, period_end, model, slides_file_id, students(display_name)',
    )
    .eq('id', id)
    .maybeSingle()
  if (!r) notFound()

  const student = Array.isArray(r.students) ? r.students[0] : r.students
  const nome = (student as { display_name?: string } | null)?.display_name ?? '—'
  const editable = r.status === 'draft'

  return (
    <main className="flex flex-col gap-4">
      <FlashMsg msg={msg} />

      <header className="flex flex-col gap-2">
        <Link href="/admin/relatorios" className="text-xs font-semibold text-brand-700 hover:underline">
          ← Relatórios
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold text-ink-900">{nome}</h2>
          <Pill tone={r.status === 'sent' ? 'muted' : r.status === 'approved' ? 'ok' : 'warn'}>
            {r.status === 'sent' ? 'enviado' : r.status === 'approved' ? 'aprovado' : 'rascunho'}
          </Pill>
          <span className="text-sm text-ink-400">
            {fmtCivilShort(r.period_start)} – {fmtCivilDate(r.period_end)}
          </span>
        </div>
      </header>

      <form action={updateReportDraftAction} className="flex flex-col gap-3">
        <input type="hidden" name="report_id" value={r.id} />
        <Field label="Título">
          <input name="title" defaultValue={r.title} readOnly={!editable} className={input} />
        </Field>
        <Field label="Conteúdo (markdown — o que o aluno vai receber)">
          <textarea
            name="content_md"
            defaultValue={r.content_md}
            readOnly={!editable}
            rows={22}
            className={`${input} min-h-96 w-full font-mono text-xs leading-relaxed`}
          />
        </Field>
        {editable && (
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="btn-paper !min-h-9 !px-3 !py-1.5 !text-xs">Salvar rascunho</button>
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-4 border-t border-line-soft pt-4">
        {editable && (
          <>
            <form action={approveReportAction}>
              <input type="hidden" name="report_id" value={r.id} />
              <button type="submit" className={btnInkSm} title="Congela o conteúdo — só aprovado gera Slides">
                Aprovar relatório
              </button>
            </form>
            <ConfirmAction
              label="descartar rascunho"
              warning="Apaga este rascunho de relatório de vez — o texto não fica guardado em lugar nenhum."
              confirmLabel="descartar rascunho"
              action={deleteDraftAction}
              values={{ report_id: r.id }}
              align="left"
            />
          </>
        )}
        {r.status === 'approved' && (
          <>
            <form action={generateSlidesAction}>
              <input type="hidden" name="report_id" value={r.id} />
              <button type="submit" className={btnInkSm}>
                {r.slides_file_id ? 'Regerar Slides' : 'Gerar Slides'}
              </button>
            </form>
            <form action={markSentAction}>
              <input type="hidden" name="report_id" value={r.id} />
              <button type="submit" className={linkActionXs} title="Depois de entregue ao aluno — congela de vez">
                marcar como enviado
              </button>
            </form>
          </>
        )}
        {r.slides_file_id && (
          <a
            href={`https://docs.google.com/presentation/d/${r.slides_file_id}/edit`}
            target="_blank"
            rel="noreferrer"
            className={linkActionXs}
          >
            abrir deck no Google Slides ↗
          </a>
        )}
      </div>
    </main>
  )
}
