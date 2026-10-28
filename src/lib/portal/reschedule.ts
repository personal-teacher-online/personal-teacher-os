import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'

// Dados do fluxo de remarcação do portal. A UI só ANTECIPA a elegibilidade (padrão
// TutorBird: botão some sem alçada e sem crédito) — quem decide de verdade é o banco
// dentro de book_reschedule_window (Lei 3).

export interface AvailableWindow {
  id: string
  startsAtUtc: string
}

/** Janelas consumíveis da professora: publicadas (RLS já restringe às professoras dos
 *  meus contratos), futuras e ≤ 2 semanas — a mesma régua da RPC.
 *
 *  Só mostrar o que o aluno PODE clicar (a UI antecipa, o banco decide):
 *  - F2/M2-1: janela dentro da ANTECEDÊNCIA mínima da professora some (o
 *    "não adiantar" saiu — antecipar agora é permitido);
 *  - janelas que CONFLITAM com aulas já agendadas da professora somem, na
 *    DURAÇÃO REAL (F1/M1-5) — a exclusion constraint recusaria na reserva. */
export async function availableWindows(
  client: SupabaseClient,
  teacherId: string,
  opts: { durationMin?: number } = {},
): Promise<AvailableWindow[]> {
  const now = new Date()
  const horizon = new Date(now.getTime() + 14 * 864e5).toISOString()
  const [{ data: windows }, { data: busy }, { data: teacher }] = await Promise.all([
    client
      .from('reschedule_windows')
      .select('id, starts_at_utc')
      .eq('teacher_id', teacherId)
      .eq('state', 'publicada')
      .gt('starts_at_utc', now.toISOString())
      .lte('starts_at_utc', horizon)
      .order('starts_at_utc'),
    client
      .from('class_instances')
      .select('starts_at_utc, ends_at_utc')
      .eq('teacher_id', teacherId)
      .eq('state', 'scheduled')
      .gt('ends_at_utc', now.toISOString())
      .lte('starts_at_utc', horizon),
    client
      .from('teacher_public')
      .select('min_booking_lead_hours')
      .eq('id', teacherId)
      .maybeSingle(),
  ])
  const dur = (opts.durationMin ?? 45) * 60_000
  const leadCutoff = now.getTime() + (teacher?.min_booking_lead_hours ?? 12) * 3600_000
  return (windows ?? [])
    .filter((w) => {
      const start = new Date(w.starts_at_utc).getTime()
      if (start < leadCutoff) return false
      const end = start + dur
      return !(busy ?? []).some((b) => {
        const bs = new Date(b.starts_at_utc).getTime()
        const be = new Date(b.ends_at_utc).getTime()
        return start < be && end > bs
      })
    })
    .map((w) => ({ id: w.id, startsAtUtc: w.starts_at_utc }))
}

export interface RescheduleEligibility {
  allowanceLeft: number
  creditBalance: number
  canReschedule: boolean
}

/** Elegibilidade para remarcar UMA aula: franquia do mês da data LOCAL da aula OU
 *  crédito. A régua do período espelha a DO BANCO (reschedule_class_at):
 *  occurrence_date quando existir; senão o instante NA ZONA DO SLOT (imutável) — a
 *  zona ATUAL do aluno só entra como último recurso (aluno pode ter migrado de fuso). */
export async function rescheduleEligibility(
  client: SupabaseClient,
  contractId: string,
  classStartsUtc: string,
  studentTz: string,
  classOccurrenceDate?: string | null,
): Promise<RescheduleEligibility> {
  let zone = studentTz
  if (!classOccurrenceDate) {
    const { data: slot } = await client
      .from('recurring_slots')
      .select('iana_tz')
      .eq('contract_id', contractId)
      .order('active_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    zone = slot?.iana_tz ?? studentTz
  }
  const periodYm = classOccurrenceDate
    ? classOccurrenceDate.slice(0, 7)
    : DateTime.fromISO(classStartsUtc).setZone(zone).toFormat('yyyy-LL')
  const [{ data: contract }, { data: usage }, { data: balance }] = await Promise.all([
    client.from('contracts').select('monthly_reschedule_allowance').eq('id', contractId).single(),
    client
      .from('reschedule_usage')
      .select('used_count')
      .eq('contract_id', contractId)
      .eq('period_ym', periodYm)
      .maybeSingle(),
    client.rpc('makeup_balance', { p_contract: contractId }),
  ])
  const allowanceLeft = Math.max(
    0,
    (contract?.monthly_reschedule_allowance ?? 0) - (usage?.used_count ?? 0),
  )
  const creditBalance = Number(balance ?? 0)
  return { allowanceLeft, creditBalance, canReschedule: allowanceLeft + creditBalance > 0 }
}
