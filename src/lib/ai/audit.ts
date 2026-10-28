import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePrompt, runStructured } from './claude'

// Auditoria de aula (Fase 4, handoff §1): transcrição → Claude (prompt ativo
// 'class-audit', Structured Outputs) → validação de SHAPE no servidor →
// record_class_audit via service_role. Shape inválido → NADA gravado (caso 1).
// Re-rodar a mesma aula é upsert auditado (caso 2 — idempotência natural da RPC).

export interface ClassAuditChecklist {
  passed: boolean
  audited_duration_min: number | null
  summary: string
  items: { key: string; ok: boolean; note?: string }[]
  red_flags: string[]
}

export const CLASS_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    audited_duration_min: { type: ['integer', 'null'] },
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          ok: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['key', 'ok'],
        additionalProperties: false,
      },
    },
    red_flags: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed', 'audited_duration_min', 'summary', 'items', 'red_flags'],
  additionalProperties: false,
} as const

/** Validação SEMÂNTICA no servidor (handoff caso 1) — nunca confiar só no provedor. */
export function validateChecklist(x: unknown): x is ClassAuditChecklist {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  if (typeof o.passed !== 'boolean') return false
  if (o.audited_duration_min !== null) {
    const d = o.audited_duration_min
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 600) return false
  }
  if (typeof o.summary !== 'string' || !o.summary.trim()) return false
  if (!Array.isArray(o.items)) return false
  for (const it of o.items) {
    const i = it as Record<string, unknown>
    if (typeof i.key !== 'string' || typeof i.ok !== 'boolean') return false
    if (i.note !== undefined && typeof i.note !== 'string') return false
  }
  if (!Array.isArray(o.red_flags) || o.red_flags.some((r) => typeof r !== 'string')) return false
  return true
}

export interface RunClassAuditOpts {
  instanceId: string
  transcript: string
  /** id do arquivo no Drive — NUNCA o texto cru no banco (handoff §1) */
  transcriptRef: string | null
  apiKey?: string
  actorId?: string | null
}

export async function runClassAudit(
  admin: SupabaseClient,
  opts: RunClassAuditOpts,
): Promise<{ auditId: string; checklist: ClassAuditChecklist; model: string }> {
  const prompt = await getActivePrompt(admin, 'class-audit')
  const raw = await runStructured({
    prompt,
    input: opts.transcript,
    schema: CLASS_AUDIT_SCHEMA as unknown as Record<string, unknown>,
  })
  if (!validateChecklist(raw)) {
    // Caso 1: shape inválido → rejeita ANTES da RPC; nada gravado.
    throw new Error('checklist da auditoria com shape inválido — nada foi gravado')
  }

  const { data, error } = await admin.rpc('record_class_audit', {
    p_class_instance: opts.instanceId,
    p_checklist: raw as never,
    p_passed: raw.passed,
    p_audited_duration_min: raw.audited_duration_min,
    p_model: prompt.model,
    p_raw_transcript_ref: opts.transcriptRef,
    p_actor: opts.actorId ?? null,
  })
  if (error) throw new Error(`record_class_audit: ${error.message}`)
  return { auditId: String(data), checklist: raw, model: prompt.model }
}
