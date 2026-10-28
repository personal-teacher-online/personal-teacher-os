'use server'

import { DateTime } from 'luxon'
import { redirect } from 'next/navigation'
import { requireAdminId } from '@/lib/auth/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { syncMentorshipSessionToGoogle } from '@/lib/google/mentoria-sync'

// F11/M6-6 (P3): espelho best-effort do encontro no Google da ÂNCORA — falha
// vira 'mentoria: …' no painel da conta; a colagem manual continua valendo.
async function mirrorSession(sessionId: string) {
  try {
    await syncMentorshipSessionToGoogle(createAdminClient(), sessionId)
  } catch (err) {
    console.error('[espelho Google do encontro]', err)
  }
}

function done(msg: string): never {
  redirect(`/admin/mentoria?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

// Bridge manual (Fase 5 automatiza via Hotmart): a admin lança o início do curso e o
// % de progresso na mão. O acúmulo de crédito é COMPUTADO das datas (Lei 2 — lazy).
export async function updateBridgeAction(formData: FormData) {
  await requireAdminId()
  const contractId = String(formData.get('contract_id') ?? '')
  const studentId = String(formData.get('student_id') ?? '')
  const startDate = String(formData.get('course_start_date') ?? '').trim()
  const pctRaw = String(formData.get('completion_pct') ?? '').trim()
  if (!contractId) done('Contrato inválido.')

  const supabase = await createClient()

  if (startDate) {
    const { error } = await supabase
      .from('mentorship_contracts')
      .update({ course_start_date: startDate })
      .eq('contract_id', contractId)
    if (error) done(`Falha no início do curso: ${error.message}`)
  }

  if (pctRaw !== '') {
    const pct = Number(pctRaw)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) done('Progresso deve ser 0–100.')
    const { error } = await supabase.from('course_progress').upsert({
      contract_id: contractId,
      student_id: studentId,
      completion_pct: pct,
      last_synced_at: new Date().toISOString(),
    })
    if (error) done(`Falha no progresso: ${error.message}`)
  }

  done('Bridge atualizado.')
}

// ---------------------------------------------------------------------------
// Sessões (handoff-fase5 §v): INSERT e UPDATE de status são permitidos à admin
// (policy admin_all) — booked_count é SÓ do motor, e cancelamento/estorno SÓ
// via RPC (trigger barra o caminho direto com reserva ativa).
// ---------------------------------------------------------------------------

export async function createMentorshipSessionAction(formData: FormData) {
  const adminId = await requireAdminId()
  const date = String(formData.get('date') ?? '').trim()
  const time = String(formData.get('time') ?? '').trim()
  const durationRaw = String(formData.get('duration_min') ?? '').trim()
  const capacityRaw = String(formData.get('capacity') ?? '').trim()
  const gmeetUrl = String(formData.get('gmeet_url') ?? '').trim()

  if (!date || !time) done('Data e hora (em Cuiabá) são obrigatórias.')
  const duration = durationRaw === '' ? 60 : Number(durationRaw)
  const capacity = capacityRaw === '' ? 6 : Number(capacityRaw)
  if (!Number.isInteger(duration) || duration <= 0) done('Duração deve ser um inteiro positivo (min).')
  if (!Number.isInteger(capacity) || capacity <= 0) done('Capacidade deve ser um inteiro positivo.')

  // Lei 1: hora local de Cuiabá → instante UTC com o offset DAQUELE dia (Luxon),
  // + snapshot textual auditável (handoff-fase5 §v).
  const local = DateTime.fromISO(`${date}T${time}`, { zone: 'America/Cuiaba' })
  const scheduledAt = local.isValid ? local.toUTC().toISO() : null
  if (!scheduledAt) done('Data/hora inválidas.')

  const supabase = await createClient()
  // Nasce 'scheduled' (criada): só entra no portal quando a admin abrir reservas.
  const { data: created, error } = await supabase
    .from('mentorship_sessions')
    .insert({
      scheduled_at: scheduledAt,
      local_time_snapshot: `${date} ${time} America/Cuiaba`,
      duration_min: duration,
      capacity,
      status: 'scheduled',
      gmeet_url: gmeetUrl || null,
      created_by: adminId,
    })
    .select('id')
    .single()
  if (error) done(`Falha ao criar sessão: ${error.message}`)
  await mirrorSession(created!.id)
  done('Sessão criada.')
}

// Abrir = UPDATE de status por id (NUNCA booked_count). Guarda de transição:
// só criada→aberta; os demais caminhos têm ação própria.
export async function openMentorshipSessionAction(formData: FormData) {
  await requireAdminId()
  const sessionId = String(formData.get('session_id') ?? '')
  if (!sessionId) done('Sessão inválida.')
  const supabase = await createClient()
  const { error } = await supabase
    .from('mentorship_sessions')
    .update({ status: 'open' })
    .eq('id', sessionId)
    .eq('status', 'scheduled')
  if (error) done(`Falha ao abrir reservas: ${error.message}`)
  done('Reservas abertas — a sessão já aparece no portal dos mentorados.')
}

export async function doneMentorshipSessionAction(formData: FormData) {
  await requireAdminId()
  const sessionId = String(formData.get('session_id') ?? '')
  if (!sessionId) done('Sessão inválida.')
  const supabase = await createClient()
  const { error } = await supabase
    .from('mentorship_sessions')
    .update({ status: 'done' })
    .eq('id', sessionId)
    .in('status', ['open', 'full'])
  if (error) done(`Falha ao encerrar: ${error.message}`)
  done('Sessão encerrada (realizada).')
}

// Cancelar SÓ via RPC: estorna TODAS as reservas ativas e devolve o total.
// Sessão 'done' é recusada pela própria RPC (pós-fato = estorno avulso, C4).
export async function cancelMentorshipSessionAction(formData: FormData) {
  const adminId = await requireAdminId()
  const sessionId = String(formData.get('session_id') ?? '')
  if (!sessionId) done('Sessão inválida.')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_mentorship_session', {
    p_session: sessionId,
    p_actor: adminId,
  })
  if (error) done(`Falha ao cancelar: ${error.message}`)
  await mirrorSession(sessionId)
  done(`Sessão cancelada — ${Number(data ?? 0)} reserva(s) estornada(s).`)
}

export async function refundMentorshipBookingAction(formData: FormData) {
  const adminId = await requireAdminId()
  const bookingId = String(formData.get('booking_id') ?? '')
  if (!bookingId) done('Reserva inválida.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('refund_mentorship_booking', {
    p_booking: bookingId,
    p_actor: adminId,
  })
  if (error) done(`Falha no estorno: ${error.message}`)
  done('Reserva estornada — o crédito voltou para o mentorado.')
}

// Ajuste manual do ledger (rpc admin_mentorship_adjust — handoff-fase5 §v):
// compensações auditáveis, ±1 por linha. NÃO muda a elegibilidade da escada —
// quem decide reserva é janelas destravadas + thresholds + gasto líquido.
export async function adjustMentorshipCreditAction(formData: FormData) {
  const adminId = await requireAdminId()
  const contractId = String(formData.get('contract_id') ?? '')
  const deltaRaw = String(formData.get('delta') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()
  if (!contractId) done('Contrato inválido.')
  const delta = Number(deltaRaw)
  if (!Number.isInteger(delta) || delta === 0) done('Delta deve ser um inteiro ±N (nunca 0).')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_mentorship_adjust', {
    p_contract: contractId,
    p_delta: delta,
    p_note: note || null,
    p_actor: adminId,
  })
  if (error) done(`Falha no ajuste: ${error.message}`)
  done(`Ajuste lançado (líquido de ajustes manuais: ${Number(data ?? 0)}). Não altera a elegibilidade da escada.`)
}

// Vínculo Hotmart (handoff-fase5 §i): e-mail do aluno no Club, lançado pela
// admin — o webhook resolve o contrato por external_user_ref. Action separada
// de propósito: updateBridgeAction mantém a assinatura intocada.
export async function updateHotmartRefAction(formData: FormData) {
  await requireAdminId()
  const contractId = String(formData.get('contract_id') ?? '')
  const ref = String(formData.get('external_user_ref') ?? '').trim().toLowerCase()
  if (!contractId) done('Contrato inválido.')
  const supabase = await createClient()
  const { error } = await supabase
    .from('mentorship_contracts')
    .update({ external_user_ref: ref || null })
    .eq('contract_id', contractId)
  if (error) done(`Falha no vínculo Hotmart: ${error.message}`)
  done(ref ? `Vínculo Hotmart salvo: ${ref}` : 'Vínculo Hotmart removido.')
}

/* ---------------- F10: edição de sessão + régua padrão ---------------- */

export async function updateMentorshipSessionAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const cap = Number(formData.get('capacity'))
  const ld = String(formData.get('local_date') ?? '').trim()
  const lt = String(formData.get('local_time') ?? '').trim()
  const { error } = await supabase.rpc('admin_update_mentorship_session', {
    p_session: String(formData.get('session_id') ?? ''),
    p_gmeet_url: String(formData.get('gmeet_url') ?? '').trim() || null,
    p_capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
    p_local_date: ld || null,
    p_local_time: lt || null,
  })
  if (!error) await mirrorSession(String(formData.get('session_id') ?? ''))
  done(error ? `Falha: ${error.message}` : 'Encontro atualizado. ✓')
}

export async function setDefaultThresholdAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_default_threshold', {
    p_window: Number(formData.get('window_index')),
    p_pct: Number(formData.get('threshold_pct')),
  })
  done(error ? `Falha: ${error.message}` : 'Régua padrão atualizada (vale para contratos novos e para o "aplicar").')
}

export async function applyDefaultThresholdsAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const contract = String(formData.get('contract_id') ?? '') || null
  const { data, error } = await supabase.rpc('admin_apply_default_thresholds', {
    ...(contract ? { p_contract: contract } : {}),
  })
  done(
    error
      ? `Falha: ${error.message}`
      : `Régua padrão aplicada — ${data} etapa(s) preenchida(s) (regras já definidas não foram tocadas).`,
  )
}

// F10/M6-4 dispara aviso via outbox; despache já para o mentorado não esperar a rodada
