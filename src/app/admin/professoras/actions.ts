'use server'

import { redirect } from 'next/navigation'
import { requireAdminId } from '@/lib/auth/admin'
import { provisionTeacher } from '@/lib/auth/provision'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function done(msg: string): never {
  redirect(`/admin/professoras?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

/** Volta para a tela de origem (ficha ou lista) com a mensagem. */
function backOrDone(formData: FormData, msg: string): never {
  const raw = String(formData.get('back') ?? '')
  if (raw.startsWith('/admin')) redirect(`${raw}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
  done(msg)
}

// Reformulação 15/07/2026 (pedido do mantenedor): o cadastro de professora virou
// UM fluxo — cadastrar JÁ convida. "Vincular a conta existente" saiu da tela
// (caso raríssimo, só a dona, já feito; o motor linkTeacherToExistingProfile
// segue dormente na lib). Cada linha ganhou reenviar/arquivar/remover.

// Cadastra a professora e, no MESMO gesto, dispara o convite. Se o cadastro
// funciona mas o e-mail falha, a professora fica "pendente" e o reenvio resolve.
export async function createAndInviteTeacherAction(formData: FormData) {
  const actorId = await requireAdminId()
  const name = String(formData.get('display_name') ?? '').trim()
  const tz = String(formData.get('iana_tz') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const rateReais = Number(String(formData.get('hourly_rate') ?? '').replace(',', '.'))
  const terms = String(formData.get('payment_terms') ?? '').trim()

  if (!name) done('Informe o nome da professora.')
  if (!email.includes('@')) done('Informe um e-mail válido para o convite.')
  if (!tz) done('Escolha o fuso (país e cidade).')
  if (!Number.isFinite(rateReais) || rateReais < 0) done('Informe o valor/hora (use 0 se não for paga por hora).')

  const supabase = await createClient()
  const { data: created, error } = await supabase
    .from('teachers')
    .insert({
      display_name: name,
      iana_tz: tz,
      hourly_rate_cents: Math.round(rateReais * 100),
      payment_terms: terms || null,
      cpf: String(formData.get('cpf') ?? '').trim() || null,
      contract_kind: String(formData.get('contract_kind') ?? '').trim() || null,
    })
    .select('id')
    .single()
  if (error || !created) done(`Falha ao cadastrar: ${error?.message ?? 'erro'}`)

  const outcome = await provisionTeacher(createAdminClient(), created.id, email, actorId)
  done(
    outcome.status === 'invited'
      ? `Professora ${name} cadastrada e convidada! 🎉 Ela recebe o e-mail para criar a senha.`
      : outcome.status === 'error'
        ? `Professora cadastrada, mas o convite falhou: ${outcome.message} Use "reenviar convite" na lista.`
        : `Professora ${name} cadastrada.`,
  )
}

// Reenvia o convite de uma professora PENDENTE (já tem conta, nunca ativou).
// provisionTeacher, no caminho do profile_id, gera um link novo (re_invited).
export async function resendTeacherInviteAction(formData: FormData) {
  const actorId = await requireAdminId()
  const teacherId = String(formData.get('teacher_id') ?? '')
  if (!teacherId) done('Professora inválida.')

  const admin = createAdminClient()
  const { data: teacher } = await admin
    .from('teachers')
    .select('profile_id')
    .eq('id', teacherId)
    .maybeSingle()
  if (!teacher?.profile_id) done('Essa professora ainda não foi convidada — use o cadastro para convidá-la.')

  const { data: existing } = await admin.auth.admin.getUserById(teacher.profile_id)
  const email = existing?.user?.email
  if (!email) done('Não encontrei o e-mail do convite dessa professora.')

  const outcome = await provisionTeacher(admin, teacherId, email, actorId)
  done(
    outcome.status === 're_invited'
      ? 'Convite reenviado — chegou um link novo no e-mail dela.'
      : outcome.status === 'already_active'
        ? 'Essa professora já ativou o acesso — não precisa de novo convite.'
        : outcome.status === 'error'
          ? `Falha ao reenviar: ${outcome.message}`
          : 'Convite reenviado.',
  )
}

// Convida uma professora legada "sem acesso" (cadastrada no fluxo antigo, sem
// e-mail) — pede o e-mail agora e provisiona pela primeira vez.
export async function inviteExistingTeacherAction(formData: FormData) {
  const actorId = await requireAdminId()
  const teacherId = String(formData.get('teacher_id') ?? '')
  const email = String(formData.get('email') ?? '').trim()
  if (!teacherId || !email.includes('@')) done('Informe um e-mail válido para o convite.')

  const outcome = await provisionTeacher(createAdminClient(), teacherId, email, actorId)
  done(
    outcome.status === 'invited'
      ? 'Convite enviado! 🎉'
      : outcome.status === 'already_active'
        ? 'Essa professora já está com o acesso ativo.'
        : outcome.status === 'error'
          ? outcome.message
          : 'Convite enviado.',
  )
}

// Remove de verdade (só sem história) ou orienta a arquivar. Se a professora
// tinha convite pendente (profile_id), a RPC o retorna para apagarmos o usuário
// órfão do Auth aqui (não dá para deletar auth.users com segurança pelo SQL).
export async function deleteTeacherAction(formData: FormData) {
  await requireAdminId()
  const teacherId = String(formData.get('teacher_id') ?? '')
  if (!teacherId) done('Professora inválida.')

  const supabase = await createClient()
  const { data: orphanProfile, error } = await supabase.rpc('delete_teacher', { p_teacher: teacherId })
  if (error) {
    done(
      error.message.includes('PROFESSORA_COM_HISTORICO')
        ? 'Essa professora já tem contratos/aulas/extratos — não dá para apagar (o histórico é dinheiro e auditoria). Use "arquivar" para escondê-la das listas.'
        : `Não foi possível remover: ${error.message}`,
    )
  }

  if (orphanProfile) {
    // best-effort: apaga o usuário/perfil órfão do convite que nunca virou aula.
    await createAdminClient().auth.admin.deleteUser(String(orphanProfile)).catch(() => {})
  }
  done('Professora removida.')
}

export async function archiveTeacherAction(formData: FormData) {
  await requireAdminId()
  const teacherId = String(formData.get('teacher_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_teacher_archived', { p_teacher: teacherId, p_archived: true })
  done(error ? `Falha ao arquivar: ${error.message}` : 'Professora arquivada — some das listas, o histórico fica.')
}

export async function unarchiveTeacherAction(formData: FormData) {
  await requireAdminId()
  const teacherId = String(formData.get('teacher_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_teacher_archived', { p_teacher: teacherId, p_archived: false })
  done(error ? `Falha ao reativar: ${error.message}` : 'Professora reativada.')
}

// M4 — extrato da professora (F3-D3): RPCs com validação interna (D10/F2);
// as actions só repassam com a SESSÃO da admin.
export async function generateStatementAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('generate_teacher_statement', {
    p_teacher: String(formData.get('teacher_id') ?? ''),
    p_period_start: String(formData.get('period_start') ?? ''),
    p_period_end: String(formData.get('period_end') ?? ''),
  })
  backOrDone(formData, error ? `Falha: ${error.message}` : 'Extrato (rascunho) gerado — confira e feche.')
}

export async function adjustStatementAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const reais = Number(String(formData.get('delta_reais') ?? '0').replace(',', '.'))
  const { error } = await supabase.rpc('adjust_teacher_statement', {
    p_statement: String(formData.get('statement_id') ?? ''),
    p_delta_cents: Math.round(reais * 100),
    p_reason: String(formData.get('reason') ?? ''),
  })
  backOrDone(formData, error ? `Falha: ${error.message}` : 'Ajuste lançado no rascunho.')
}

export async function closeStatementAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('close_teacher_statement', {
    p_statement: String(formData.get('statement_id') ?? ''),
  })
  backOrDone(formData, error ? `Falha: ${error.message}` : 'Extrato FECHADO — imutável a partir de agora.')
}


// Ficha da professora (rodada B): edição do cadastro interno — nome, fuso,
// valor/hora, condições, CPF e tipo de vínculo. Sessão admin (policy
// admin_all); o trigger de auditoria registra o diff.
export async function updateTeacherAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('teacher_id') ?? '')
  const name = String(formData.get('display_name') ?? '').trim()
  const tz = String(formData.get('iana_tz') ?? '').trim()
  const rateReais = Number(String(formData.get('hourly_rate') ?? '').replace(',', '.'))
  if (!id || !name || !tz) backOrDone(formData, 'Falha: dados incompletos.')
  if (!Number.isFinite(rateReais) || rateReais < 0) backOrDone(formData, 'Falha: valor/hora inválido.')

  const supabase = await createClient()
  const { error } = await supabase
    .from('teachers')
    .update({
      display_name: name,
      iana_tz: tz,
      hourly_rate_cents: Math.round(rateReais * 100),
      payment_terms: String(formData.get('payment_terms') ?? '').trim() || null,
      cpf: String(formData.get('cpf') ?? '').trim() || null,
      contract_kind: String(formData.get('contract_kind') ?? '').trim() || null,
    })
    .eq('id', id)
  backOrDone(formData, error ? `Falha: ${error.message}` : 'Cadastro da professora atualizado.')
}

/* ---------------- F9/M12-7: vigências de valor/hora ---------------- */

export async function addRatePeriodAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const rate = Math.round(Number(String(formData.get('rate') ?? '').replace(',', '.')) * 100)
  const { error } = await supabase.rpc('admin_add_rate_period', {
    p_teacher: String(formData.get('teacher_id') ?? ''),
    p_valid_from: String(formData.get('valid_from') ?? ''),
    p_rate_cents: rate,
  })
  backOrDone(
    formData,
    error
      ? `Falha: ${error.message}`
      : 'Vigência criada — as aulas a partir dessa data pagam o valor novo; o passado não muda.',
  )
}

export async function removeRatePeriodAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_remove_rate_period', {
    p_id: String(formData.get('id') ?? ''),
  })
  backOrDone(formData, error ? `Falha: ${error.message}` : 'Vigência futura removida.')
}
