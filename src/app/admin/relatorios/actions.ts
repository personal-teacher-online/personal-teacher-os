'use server'

import { DateTime } from 'luxon'
import { redirect } from 'next/navigation'
import { generateProgressReportDraft } from '@/lib/ai/report'
import { requireAdminId } from '@/lib/auth/admin'
import { exportDeckPdf, generateDeckFromTemplate, googleClientsFromEnv } from '@/lib/google/slides'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// Relatórios de progresso (Fase 4 §3): Claude gera o RASCUNHO; a dona
// edita/aprova; aprovado gera Slides (cópia do template — nunca o primário);
// 'enviado' congela (trigger progress_reports_guard). Transições e imutabilidade
// são do BANCO (Lei 3) — aqui só UX e tradução de erro.

function back(msg: string): never {
  redirect(`/admin/relatorios?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}
function toReport(id: string, msg: string): never {
  redirect(`/admin/relatorios/${id}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

export async function generateReportAction(formData: FormData) {
  const actor = await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const start = String(formData.get('period_start') ?? '')
  const end = String(formData.get('period_end') ?? '')
  if (!studentId || !start || !end) back('Informe aluno e período.')
  if (!process.env.ANTHROPIC_API_KEY) back('ANTHROPIC_API_KEY ausente — configure no deploy (§N).')

  try {
    const id = await generateProgressReportDraft(createAdminClient(), {
      studentId,
      periodStart: start,
      periodEnd: end,
      createdBy: actor,
    })
    toReport(id, 'Rascunho gerado — revise, edite e aprove. ✔')
  } catch (err) {
    // redirect() lança NEXT_REDIRECT — não engolir.
    if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err
    back(`Falha ao gerar: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function updateReportDraftAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('report_id') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const content = String(formData.get('content_md') ?? '')
  if (!id || !title || !content.trim()) toReport(id, 'Título e conteúdo são obrigatórios.')

  const supabase = await createClient()
  const { error } = await supabase
    .from('progress_reports')
    .update({ title, content_md: content })
    .eq('id', id)
  toReport(id, error ? `Falha: ${error.message}` : 'Rascunho salvo.')
}

export async function approveReportAction(formData: FormData) {
  const actor = await requireAdminId()
  const id = String(formData.get('report_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('progress_reports')
    .update({ status: 'approved', approved_by: actor, approved_at: new Date().toISOString() })
    .eq('id', id)
  toReport(id, error ? `Falha: ${error.message}` : 'Relatório APROVADO — agora dá para gerar os Slides.')
}

export async function deleteDraftAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('report_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.from('progress_reports').delete().eq('id', id)
  back(error ? `Falha: ${error.message}` : 'Rascunho descartado.')
}

/** Extrai a seção `## Titulo` do markdown (para os placeholders do deck). */
function section(md: string, title: string): string {
  const re = new RegExp(`##\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`)
  return (re.exec(md)?.[1] ?? '').trim()
}

export async function generateSlidesAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('report_id') ?? '')
  const clients = googleClientsFromEnv()
  const templateId = process.env.SLIDES_TEMPLATE_ID
  const folderId = process.env.SLIDES_FOLDER_ID
  if (!clients || !templateId || !folderId) {
    toReport(id, 'Google não configurado (GOOGLE_SERVICE_ACCOUNT_JSON / SLIDES_TEMPLATE_ID / SLIDES_FOLDER_ID — §N).')
  }

  const admin = createAdminClient()
  const { data: r } = await admin
    .from('progress_reports')
    .select('id, title, content_md, highlights, status, period_start, period_end, students(display_name)')
    .eq('id', id)
    .maybeSingle()
  if (!r) toReport(id, 'Relatório não encontrado.')
  if (r!.status === 'draft') toReport(id, 'Aprove o relatório antes de gerar os Slides.')
  // Sol r8 nº 1: `sent` também recusa — a UI só mostra o botão no aprovado, mas
  // Server Action é porta POST direta (aba velha aberta): sem este cinto, o
  // deck era COPIADO no Google e ficava órfão quando o update local recusasse.
  if (r!.status !== 'approved')
    toReport(id, 'Relatório já enviado — o deck não é regerado depois do envio.')

  const student = Array.isArray(r!.students) ? r!.students[0] : r!.students
  const h = (r!.highlights ?? {}) as {
    classes_done?: number
    classes_missed?: number
    strengths?: string[]
    focus_areas?: string[]
  }
  const fmt = (d: string) => DateTime.fromISO(d).setLocale('pt-BR').toFormat('dd/LL/yyyy')
  try {
    const deck = await generateDeckFromTemplate({
      clients: clients!,
      templateId: templateId!,
      parentFolderId: folderId!,
      name: r!.title,
      replacements: {
        aluno: (student as { display_name?: string } | null)?.display_name ?? '—',
        titulo: r!.title,
        periodo: `${fmt(r!.period_start)} – ${fmt(r!.period_end)}`,
        resumo: section(r!.content_md, 'Resumo do período'),
        trabalhado: section(r!.content_md, 'O que trabalhamos'),
        fortes: (h.strengths ?? []).map((s) => `• ${s}`).join('\n'),
        focos: (h.focus_areas ?? []).map((s) => `• ${s}`).join('\n'),
        frequencia: section(r!.content_md, 'Frequência'),
      },
    })
    // PDF best-effort (limite 10MB do export) — o deck é o principal.
    let pdfNote = ''
    try {
      await exportDeckPdf(clients!, deck.fileId)
      pdfNote = ' (PDF exportável ok)'
    } catch {
      pdfNote = ' (export de PDF indisponível — use o deck)'
    }
    const { error } = await admin
      .from('progress_reports')
      .update({ slides_file_id: deck.fileId })
      .eq('id', id)
    toReport(id, error ? `Deck criado mas não registrado: ${error.message}` : `Slides gerados ✔${pdfNote}`)
  } catch (err) {
    if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err
    toReport(id, `Falha nos Slides: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function markSentAction(formData: FormData) {
  const actorId = await requireAdminId()
  const id = String(formData.get('report_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('progress_reports')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: actorId })
    .eq('id', id)
  toReport(id, error ? `Falha: ${error.message}` : 'Relatório marcado como ENVIADO — congelado (Lei 8).')
}
