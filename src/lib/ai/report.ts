import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePrompt, runStructured } from './claude'

// Relatório de progresso (Fase 4, handoff §3 — DDL em 20260715000300): coleta
// os FATOS do período no banco, chama o prompt ativo 'progress-report' (Sonnet)
// e grava o RASCUNHO em progress_reports. A dona revisa/edita/aprova na UI;
// só relatório aprovado vira Slides/PDF e só aprovado é enviado.

export interface ReportDraft {
  title: string
  content_md: string
  highlights: {
    classes_done: number
    classes_missed: number
    classes_rescheduled: number
    strengths: string[]
    focus_areas: string[]
  }
}

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content_md: { type: 'string' },
    highlights: {
      type: 'object',
      properties: {
        classes_done: { type: 'integer' },
        classes_missed: { type: 'integer' },
        classes_rescheduled: { type: 'integer' },
        strengths: { type: 'array', items: { type: 'string' } },
        focus_areas: { type: 'array', items: { type: 'string' } },
      },
      required: ['classes_done', 'classes_missed', 'classes_rescheduled', 'strengths', 'focus_areas'],
      additionalProperties: false,
    },
  },
  required: ['title', 'content_md', 'highlights'],
  additionalProperties: false,
} as const

export function validateReport(x: unknown): x is ReportDraft {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return false
  if (typeof o.content_md !== 'string' || !o.content_md.trim()) return false
  const h = o.highlights as Record<string, unknown> | undefined
  if (!h || typeof h !== 'object') return false
  for (const k of ['classes_done', 'classes_missed', 'classes_rescheduled']) {
    if (typeof h[k] !== 'number' || !Number.isInteger(h[k])) return false
  }
  if (!Array.isArray(h.strengths) || !Array.isArray(h.focus_areas)) return false
  return true
}

export interface GenerateReportOpts {
  studentId: string
  periodStart: string // yyyy-LL-dd
  periodEnd: string
  apiKey?: string
  createdBy?: string | null
}

/** Junta os fatos do período e gera o rascunho. Devolve o id do relatório. */
export async function generateProgressReportDraft(
  admin: SupabaseClient,
  opts: GenerateReportOpts,
): Promise<string> {
  const [{ data: student }, { data: contracts }] = await Promise.all([
    admin.from('students').select('id, display_name, iana_tz, level').eq('id', opts.studentId).maybeSingle(),
    admin.from('contracts').select('id, contract_type, plan_name').eq('student_id', opts.studentId),
  ])
  if (!student) throw new Error(`aluno ${opts.studentId} não existe`)
  const contractIds = (contracts ?? []).map((c) => c.id)
  if (contractIds.length === 0) throw new Error('aluno sem contrato — nada a relatar')

  const startUtc = DateTime.fromISO(opts.periodStart, { zone: student.iana_tz }).startOf('day').toUTC().toISO()!
  const endUtc = DateTime.fromISO(opts.periodEnd, { zone: student.iana_tz }).endOf('day').toUTC().toISO()!

  const { data: aulas } = await admin
    .from('class_instances')
    .select('id, starts_at_utc, state, local_time_snapshot')
    .in('contract_id', contractIds)
    .gte('starts_at_utc', startUtc)
    .lte('starts_at_utc', endUtc)
    .order('starts_at_utc')

  const ids = (aulas ?? []).map((a) => a.id)
  const { data: audits } = ids.length
    ? await admin
        .from('class_audits')
        .select('class_instance_id, checklist, passed')
        .in('class_instance_id', ids)
    : { data: [] as { class_instance_id: string; checklist: unknown; passed: boolean }[] }

  const auditByInstance = new Map((audits ?? []).map((a) => [a.class_instance_id, a]))
  const fatos = {
    aluno: student.display_name,
    // F11/M14-6: o nível CEFR entra no contexto (quase-zero: 1 campo + 1 linha)
    nivel_cefr: student.level ?? 'não avaliado',
    periodo: { inicio: opts.periodStart, fim: opts.periodEnd },
    aulas: (aulas ?? []).map((a) => ({
      quando: a.local_time_snapshot,
      estado: a.state,
      auditoria: (auditByInstance.get(a.id)?.checklist as { summary?: string } | undefined)?.summary ?? null,
    })),
  }

  const prompt = await getActivePrompt(admin, 'progress-report')
  const raw = await runStructured({
    prompt,
    input: JSON.stringify(fatos, null, 2),
    schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
    apiKey: opts.apiKey,
  })
  if (!validateReport(raw)) {
    throw new Error('relatório com shape inválido — nada foi gravado')
  }

  const { data, error } = await admin
    .from('progress_reports')
    .insert({
      student_id: opts.studentId,
      contract_id: contractIds.length === 1 ? contractIds[0] : null,
      period_start: opts.periodStart,
      period_end: opts.periodEnd,
      title: raw.title,
      content_md: raw.content_md,
      highlights: raw.highlights as never,
      model: prompt.model,
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`progress_reports insert: ${error.message}`)
  return data.id as string
}
