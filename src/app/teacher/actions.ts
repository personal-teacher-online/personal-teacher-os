'use server'

import { redirect } from 'next/navigation'
import { sendRescheduleEmails } from '@/lib/email/notify'
import { sendEmailWithOutcome } from '@/lib/email/send'
import { evolutionChannel, evolutionConfigFromEnv } from '@/lib/notify/evolution'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { googleWindowClash, syncTeacherCalendarSoon } from '@/lib/google/sync'
import { decryptToken, tokenKeyFromEnv } from '@/lib/google/token-crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { conferirHoraCivil, recusaDaHoraCivil } from '@/lib/admin/hora-civil'
import { fmtCivilDate, fmtLocal, tzLabel } from '@/lib/format'
import { windowPublishConflict } from '@/lib/windows'
import { recusaParaTela } from '@/data/teacher/recusas'
import { gravarFlash } from '@/lib/portal/flash'

// O desfecho de TODA ação da professora viaja num cookie curto (`gravarFlash`)
// que o layout entrega ao toast — nunca na URL: um link montado à mão não pode
// afirmar "Aula remarcada ✅" (gate Sol do M2, A4). A recusa do banco passa por
// `recusaParaTela`: frase de gente, texto cru só no log do servidor.
async function done(msg: string): Promise<never> {
  await gravarFlash(msg)
  redirect('/teacher')
}

/** O id entra no endereço de um redirect: só um uuid passa. */
const ID_DE_AULA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// F3-D6: a POSSE é validada DENTRO das RPCs (D10/F2) — a action só repassa.
// p_teacher vem do servidor (a própria professora); p_iana_tz NUNCA é enviado
// (o banco recusa teacher com p_iana_tz — o fuso vem de teachers.iana_tz).
export async function publishOwnWindowAction(formData: FormData) {
  const supabase = await createClient()
  // Filtro EXPLÍCITO por auth.uid(): a dona é admin (admin_all veria TODAS as
  // linhas de teachers) — "a própria" é sempre a do profile logado, nunca limit(1).
  const { data: { user } } = await supabase.auth.getUser()
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, iana_tz')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  if (!teacher) return done('Sua conta não está vinculada a uma professora.')
  // A zona DELA é lida uma vez e serve às três coisas: converter a hora civil em
  // instante (A6/a), formatar o conflito e nomear a cidade na recusa de DST.
  const zona: string = teacher.iana_tz ?? 'America/Cuiaba'

  const localDate = String(formData.get('local_date') ?? '')
  const localTime = String(formData.get('local_time') ?? '')

  // QA 14/07/2026: mesma antecipação do admin — janela em cima de aula agendada
  // é impossível de consumir (exclusion constraint na reserva). Desde o A6/d a
  // própria RPC recusa; isto continua aqui pela frase, que nomeia a aula.
  const clash = await windowPublishConflict(supabase, teacher.id, localDate, localTime)
  if (clash) {
    return done(
      `Conflito: você já tem aula ${fmtLocal(clash, zona)} — nenhum aluno conseguiria reservar essa janela. Escolha outro horário.`,
    )
  }

  // ADR-017/M5: compromisso PESSOAL dela no Google no mesmo horário → recusa
  // com mensagem clara; Google fora do ar → publica com AVISO (fail-open).
  const admin = createAdminClient()
  const gcal = await googleWindowClash(admin, teacher.id, localDate, localTime)
  if (gcal.status === 'ocupado') {
    return done(
      `Conflito: sua agenda Google tem um compromisso ${fmtLocal(gcal.clashStartUtc, zona)} — escolha outro horário (ou libere o compromisso lá).`,
    )
  }

  // A6/a: a RPC recebe o INSTANTE. A conversão civil→instante acontece UMA vez,
  // aqui, com Luxon e na zona DELA (o painel dela mostra o relógio dela — F3-D2),
  // e a hora que o relógio de lá não tem — ou tem duas vezes, nos dois dias do
  // ano da virada — é RECUSADA antes de virar instante. Sem isto a hora
  // ambígua nascia no offset padrão do Postgres: uma hora depois do ponto que
  // ela tocou, sem erro nenhum.
  const civil = conferirHoraCivil(localDate, localTime, zona)
  if (!civil.ok) return done(`Falha: ${recusaDaHoraCivil(civil, tzLabel(zona), localTime)}`)

  const { error } = await supabase.rpc('publish_reschedule_window', {
    p_teacher: teacher.id,
    p_starts_at_utc: civil.instanteUtc,
  })
  if (error) return done(recusaParaTela(error))
  syncTeacherCalendarSoon(admin, teacher.id)
  return done(
    gcal.status === 'indisponivel'
      ? 'Janela publicada — seus alunos já a veem no portal. ✅ (não consegui checar seus compromissos do Google agora)'
      : 'Janela publicada — seus alunos já a veem no portal. ✅',
  )
}

export async function cancelOwnWindowAction(formData: FormData) {
  const supabase = await createClient()
  const windowId = String(formData.get('window_id') ?? '')
  // teacher_id ANTES do cancel (posse é decidida na RPC; isto é só para o sync).
  const { data: win } = await supabase
    .from('reschedule_windows')
    .select('teacher_id')
    .eq('id', windowId)
    .maybeSingle()
  const { error } = await supabase.rpc('cancel_reschedule_window', { p_window: windowId })
  if (error) return done(recusaParaTela(error))
  if (win) syncTeacherCalendarSoon(createAdminClient(), win.teacher_id) // ADR-017
  return done('Janela cancelada.')
}

// ADR-017/M3: desconectar o Google Agenda — revoga o token no Google
// (best-effort) e apaga a credencial. Posse: sempre a professora do profile
// logado (mesmo pino das actions acima).
export async function disconnectGoogleAction() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, is_owner')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  if (!teacher || !user) return done('Sua conta não está vinculada a uma professora.')

  // F11/M13-1: guarda-corpo da ÂNCORA — a conexão da dona também espelha os
  // encontros de mentoria; desconectar avisa a consequência (não bloqueia).
  let avisoAncora = ''
  if (teacher.is_owner) {
    const { data: mentorias } = await supabase
      .from('contracts')
      .select('id')
      .eq('contract_type', 'mentorship')
      .eq('status', 'active')
      .limit(1)
    if ((mentorias ?? []).length > 0) {
      avisoAncora =
        ' ⚠️ Sua conta é a ÂNCORA da mentoria: os encontros do Personal Travel deixam de ser espelhados no Google até reconectar.'
    }
  }

  const admin = createAdminClient()
  const { data: acct } = await admin
    .from('teacher_google_accounts')
    .select('google_email, refresh_token_cipher')
    .eq('teacher_id', teacher.id)
    .maybeSingle()
  if (!acct) return done('O Google Agenda já estava desconectado.')

  // Revogação no Google: higiene, não requisito — sem rede/da chave, o delete
  // abaixo já corta o uso (o token cifrado morre com a linha).
  const key = tokenKeyFromEnv()
  if (key) {
    try {
      const token = decryptToken(acct.refresh_token_cipher, key)
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      })
    } catch {
      // best-effort
    }
  }

  const { error } = await admin.from('teacher_google_accounts').delete().eq('teacher_id', teacher.id)
  if (error) return done(recusaParaTela(error, 'Falha ao desconectar'))

  await admin.from('audit_log').insert({
    actor: user.id,
    action: 'disconnect_google_calendar',
    entity: 'teachers',
    entity_id: teacher.id,
    diff: { google_email: acct.google_email },
  })
  return done('Google Agenda desconectada — os eventos criados por aqui não somem sozinhos; apague-os lá se quiser.' + avisoAncora)
}

/* ---------------- F5/M12-12: agenda semanal + bloqueios ---------------- */

async function myTeacherId(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  if (!teacher) return done('Sua conta não está vinculada a uma professora.')
  return teacher.id
}

export async function addWeeklyAvailabilityAction(formData: FormData) {
  const teacherId = await myTeacherId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_weekly_availability', {
    p_teacher: teacherId,
    p_weekday: Number(formData.get('weekday')),
    p_start: String(formData.get('start_local') ?? ''),
    p_end: String(formData.get('end_local') ?? ''),
  })
  return done(error ? recusaParaTela(error) : 'Janela semanal criada — os horários ofertáveis já a consideram. ✓')
}

export async function removeWeeklyAvailabilityAction(formData: FormData) {
  await myTeacherId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('remove_weekly_availability', {
    p_id: String(formData.get('id') ?? ''),
  })
  return done(error ? recusaParaTela(error) : 'Janela semanal removida.')
}

export async function addBlockAction(formData: FormData) {
  const teacherId = await myTeacherId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('add_teacher_block', {
    p_teacher: teacherId,
    p_from: String(formData.get('from') ?? ''),
    p_to: String(formData.get('to') ?? ''),
    p_note: String(formData.get('note') ?? '').trim() || null,
  })
  // A6/f: "nenhum horário será ofertado no período" finalmente é VERDADE para
  // janelas — `add_teacher_block` cancela as publicadas do período na mesma
  // transação, e `book_reschedule_window` ganhou o cinto do bloqueio criado
  // depois da publicação (A6/e). Até a migration 97 esta frase prometia o que a
  // função não fazia: o aluno com a confirmação aberta reservava dentro do dia
  // bloqueado, gastando franquia ou crédito.
  return done(
    error
      ? recusaParaTela(error)
      : 'Bloqueio criado — nenhum horário será ofertado no período: os horários de remarcação já publicados nele saíram da oferta. Aulas já marcadas continuam: avise a administração para tratá-las.',
  )
}

export async function removeBlockAction(formData: FormData) {
  await myTeacherId()
  const supabase = await createClient()
  // A6/g: esta porta chamava a RPC sem ler `kind`, e a RPC da F5 apagava
  // QUALQUER exceção pelo id — um uuid de `kind='open'` saía apagado com a frase
  // verde de bloqueio. Quem recusa agora é o banco (a antecipação em TS existe
  // só no admin, pela frase); aqui não se duplica a leitura.
  const { error } = await supabase.rpc('remove_teacher_block', {
    p_id: String(formData.get('id') ?? ''),
  })
  return done(error ? recusaParaTela(error) : 'Bloqueio removido.')
}

// ---------------------------------------------------------------------------
// Cronograma M3-UI (20/07/2026) — plano do aluno + apontamento pela professora.
// Posse validada DENTRO das RPCs (padrão D10); a sugestão de IA valida posse
// aqui (não é RPC) antes de tocar o banco com o admin client.
// ---------------------------------------------------------------------------

async function planBack(contract: string, msg: string): Promise<never> {
  await gravarFlash(msg)
  redirect(ID_DE_AULA.test(contract) ? `/teacher/alunos/${contract}` : '/teacher')
}

export async function generateStudyPlanAction(formData: FormData) {
  const contract = String(formData.get('contract_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('generate_study_plan', { p_contract: contract })
  if (error) return planBack(contract, recusaParaTela(error, 'Falha ao gerar o plano'))
  return planBack(contract, 'Plano do semestre pronto — personalize os módulos. ✓')
}

export async function updatePlanItemAction(formData: FormData) {
  const contract = String(formData.get('contract_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('update_study_plan_item', {
    p_item: String(formData.get('item_id') ?? ''),
    p_theme: String(formData.get('theme') ?? '') || null,
    p_approach: String(formData.get('approach') ?? '') || null,
    p_flexge_lesson_id: String(formData.get('flexge_lesson_id') ?? '') || null,
    p_flexge_lesson_href: String(formData.get('flexge_lesson_href') ?? '') || null,
  })
  if (error) return planBack(contract, recusaParaTela(error, 'Falha ao salvar o módulo'))
  return planBack(contract, 'Módulo atualizado. ✓')
}

export async function suggestPlanAction(formData: FormData) {
  const contract = String(formData.get('contract_id') ?? '')
  const planId = String(formData.get('plan_id') ?? '')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // posse: professora do contrato OU admin (mesma régua das RPCs do plano);
  // papel do JWT (app_metadata — Lei 4), posse pelo helper do banco
  const role = (user.app_metadata as { role?: string } | null)?.role
  const { data: ok } = await supabase.rpc('_is_teacher_of_contract', { p_contract: contract })
  if (!ok && role !== 'admin') return planBack(contract, 'Falha: apenas a professora do aluno (ou a admin).')

  // O redirect fica FORA do try: ele lança, e o catch o engoliria.
  let n: number
  try {
    const { suggestStudyPlan } = await import('@/lib/ai/study-plan')
    n = await suggestStudyPlan(createAdminClient(), planId)
  } catch (err) {
    console.error('[professora · sugestão do plano falhou]', err)
    return planBack(contract, 'Falha ao sugerir: não consegui gerar as sugestões agora. Nada foi alterado — tente de novo.')
  }
  return planBack(contract, `Sugestões prontas para ${n} módulos — revise e aplique as que gostar. ✓`)
}

export async function reportClassContentAction(formData: FormData) {
  // O destino volta ao ponto da lista onde ela estava, mas só dentro de /teacher.
  const voltaPara = String(formData.get('back') ?? '')
  const back = /^\/teacher(?:[/?]|$)/.test(voltaPara) && !voltaPara.includes('\\') ? voltaPara : '/teacher?aba=aulas'
  const offKind = String(formData.get('off_kind') ?? '') || null
  const planItem = String(formData.get('plan_item') ?? '') || null
  const supabase = await createClient()
  const { error } = await supabase.rpc('report_class_content', {
    p_instance: String(formData.get('instance_id') ?? ''),
    p_plan_item: planItem,
    p_off_kind: planItem ? null : offKind,
    p_off_note: String(formData.get('off_note') ?? '') || null,
  })
  await gravarFlash(error ? recusaParaTela(error, 'Falha ao apontar') : 'Conteúdo da aula apontado. ✓')
  redirect(back)
}

/* ========================================================================== */
/* M2 (01/09/2026) — a professora CANCELA e REMARCA a própria aula             */
/* ========================================================================== */
//
// A regra de dinheiro é do banco (`teacher_cancel_own_class` /
// `teacher_reschedule_own_class`): posse por my_teacher_id(), motivo
// obrigatório, crédito ao aluno pela matriz do ADR-018, nada consumido na
// remarcação. Aqui: traduzir a recusa para frase de gente, despachar os
// avisos na hora (o mesmo padrão do portal) e espelhar o Google.

// O desfecho NÃO viaja na URL: vai num cookie curto (`gravarFlash`) que o layout
// da professora entrega ao toast da casa. Link forjado não afirma mais "Aula
// remarcada ✅" (gate Sol do M2, A4).
async function aulasBack(msg: string): Promise<never> {
  await gravarFlash(msg)
  redirect('/teacher?aba=aulas')
}

/** Aviso NA HORA (mesmo padrão do portal): a rodada horária corrige qualquer perda. */
async function despacharAgora(): Promise<void> {
  try {
    await dispatchOutbox(createAdminClient(), {
      email: { send: sendEmailWithOutcome },
      whatsapp: evolutionChannel(evolutionConfigFromEnv()),
    })
  } catch (err) {
    console.error('[M2 · aviso não despachado na hora]', err)
  }
}

async function espelharGoogleDaAula(instanceId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: inst } = await admin.from('class_instances').select('teacher_id').eq('id', instanceId).maybeSingle()
    if (inst) syncTeacherCalendarSoon(admin, inst.teacher_id)
  } catch (err) {
    console.error('[M2 · gcal sync]', err)
  }
}

export async function cancelOwnClassAction(formData: FormData) {
  const instanceId = String(formData.get('instance_id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!instanceId) return aulasBack('Falha: aula não identificada.')
  if (!reason) return aulasBack('Falha: escreva o motivo do cancelamento — ele vai para a administração.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('teacher_cancel_own_class', {
    p_instance: instanceId,
    p_reason: reason,
  })
  if (error) return aulasBack(recusaParaTela(error))

  await despacharAgora()
  await espelharGoogleDaAula(instanceId)

  // A frase é LIDA do que o banco devolveu (o mesmo jsonb da admin), nunca afirmada.
  const r = (data ?? {}) as { credited?: boolean; expires_on?: string | null; refund_blocked?: string | null }
  const credito = r.credited
    ? ` O aluno ganhou 1 crédito de reposição${r.expires_on ? ` válido até ${fmtCivilDate(r.expires_on)}` : ''}.`
    : r.refund_blocked
      ? ' O crédito não voltou sozinho — a administração foi avisada e resolve.'
      : ''
  // Os avisos saem pelo outbox (despacho na hora + rodada horária): a tela diz
  // que estão a caminho, não que chegaram.
  await aulasBack(`Aula cancelada.${credito} Os avisos ao aluno e à administração estão a caminho. ✅`)
}

const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

export async function rescheduleOwnClassAction(formData: FormData) {
  const instanceId = String(formData.get('instance_id') ?? '')
  const startsAtUtc = String(formData.get('starts_at_utc') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  const googleDegraded = formData.get('google_degraded') === '1'
  const voltar = async (msg: string): Promise<never> => {
    await gravarFlash(msg)
    redirect(`/teacher/remarcar/${instanceId}`)
  }

  // O id entra no endereço do redirect: só um uuid passa.
  if (!ID_DE_AULA.test(instanceId)) return aulasBack('Falha: aula não identificada.')
  // O instante vem do slot-picker (ISO com fuso). Formato conferido ANTES de
  // virar argumento: a RPC recebe o instante pronto (A6/a), nunca data+hora civis.
  if (!ISO_INSTANTE.test(startsAtUtc) || !Number.isFinite(Date.parse(startsAtUtc)))
    return voltar('Falha: horário inválido — escolha de novo na lista.')
  if (!reason) return voltar('Falha: escreva o motivo — ele vai para a administração.')

  const supabase = await createClient()
  const { data: newId, error } = await supabase.rpc('teacher_reschedule_own_class', {
    p_instance: instanceId,
    p_starts_at_utc: startsAtUtc,
    p_reason: reason,
    p_google_degraded: googleDegraded,
  })
  if (error) return voltar(recusaParaTela(error))

  // E-mails 3t (aluno, no fuso dele) — best-effort, nunca desfaz a remarcação.
  // Gate Sol (26/10): a tela só diz "avisado" do que de fato saiu — e-mail
  // pulado (aluno sem login ou sem endereço) conta como NÃO saiu.
  let emailFalhou = false
  let emailsOk = 0
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await sendRescheduleEmails(
      createAdminClient(),
      { newInstanceId: String(newId), actorUserId: user?.id ?? '' },
      async (email) => {
        const r = await sendEmailWithOutcome(email)
        if (r.ok) {
          emailsOk++
        } else {
          emailFalhou = true
          console.error('[M2 · e-mail de remarcação não saiu]', r.error)
        }
      },
    )
  } catch (err) {
    emailFalhou = true
    console.error('[M2 · e-mails de remarcação falharam]', err)
  }
  await despacharAgora()
  await espelharGoogleDaAula(String(newId))

  await aulasBack(
    emailFalhou || emailsOk === 0
      ? 'Aula remarcada. ⚠️ O e-mail ao aluno não saiu — avise-o por outro canal. A administração recebe o seu motivo.'
      : 'Aula remarcada. O e-mail ao aluno saiu; os demais avisos estão a caminho. ✅',
  )
}
