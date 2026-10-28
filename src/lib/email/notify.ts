import type { SupabaseClient } from '@supabase/supabase-js'
import { one } from '@/lib/embed'
import { partnerEmail, studentEmail, teacherEmail, teacherMovedEmail } from './reschedule'
import type { Email } from './send'

const BUSINESS_TZ = 'America/Cuiaba'

/**
 * D14: dispara os e-mails 3/3b/4 APÓS o commit da remarcação. Best-effort — qualquer
 * falha aqui é logada e NUNCA desfaz a remarcação (o chamador embrulha em try/catch).
 * Client e função de envio INJETADOS: a action passa o service client (e-mails vivem
 * em auth.users) e o sendEmail real; os testes passam um coletor (caso 9 do goal).
 */
export async function sendRescheduleEmails(
  admin: SupabaseClient,
  opts: { newInstanceId: string; actorUserId: string },
  send: (email: Email) => Promise<void>,
): Promise<void> {

  const { data: inst } = await admin
    .from('class_instances')
    .select('id, contract_id, teacher_id, starts_at_utc, reschedule_of')
    .eq('id', opts.newInstanceId)
    .single()
  if (!inst?.reschedule_of) return // resgate/avulsa: sem e-mail aprovado para este caso

  const [{ data: oldInst }, { data: contract }, { data: teacher }, { data: auditRows }] =
    await Promise.all([
      admin.from('class_instances').select('starts_at_utc').eq('id', inst.reschedule_of).single(),
      admin
        .from('contracts')
        .select(
          'id, monthly_reschedule_allowance, student_id, student_group_id, students!contracts_student_id_fkey(id, display_name, iana_tz, profile_id)',
        )
        .eq('id', inst.contract_id)
        .single(),
      admin.from('teachers').select('display_name, profile_id, iana_tz').eq('id', inst.teacher_id).single(),
      admin
        .from('audit_log')
        .select('diff')
        .eq('action', 'reschedule_class')
        .eq('entity_id', opts.newInstanceId)
        .limit(1),
    ])
  if (!oldInst || !contract) return

  // Membros: contrato individual OU grupo (casal — D3).
  interface Member { id: string; display_name: string; iana_tz: string; profile_id: string | null }
  let members: Member[] = []
  const single = one(contract.students) as Member | null
  if (single) {
    members = [single]
  } else if (contract.student_group_id) {
    const { data: gm } = await admin
      .from('student_group_members')
      .select('students(id, display_name, iana_tz, profile_id)')
      .eq('group_id', contract.student_group_id)
    members = (gm ?? []).map((r) => one(r.students) as Member).filter(Boolean)
  }

  const actor = members.find((m) => m.profile_id === opts.actorUserId) ?? members[0]
  if (!actor) return
  const studentTz = actor.iana_tz

  // "Como foi descontado" — o que o BANCO decidiu (audit da RPC).
  const diff = auditRows?.[0]?.diff as { via?: string; period_ym?: string } | undefined
  let howCharged = 'conforme as regras do seu plano'
  if (diff?.via === 'allowance' && diff.period_ym) {
    const { data: usage } = await admin
      .from('reschedule_usage')
      .select('used_count')
      .eq('contract_id', contract.id)
      .eq('period_ym', diff.period_ym)
      .single()
    const left = Math.max(0, (contract.monthly_reschedule_allowance ?? 0) - (usage?.used_count ?? 0))
    howCharged = `das suas remarcações do mês (você ainda pode remarcar ${left})`
  } else if (diff?.via === 'makeup_credit') {
    const { data: balance } = await admin.rpc('makeup_balance', { p_contract: contract.id })
    howCharged = `de 1 crédito de reposição (saldo: ${Number(balance ?? 0)})`
  }

  const facts = {
    firstName: actor.display_name.split(' ')[0],
    studentTz,
    oldStartsUtc: oldInst.starts_at_utc,
    newStartsUtc: inst.starts_at_utc,
    teacherName: teacher?.display_name ?? 'sua professora',
    howCharged,
  }

  const emailOf = async (profileId: string | null): Promise<string | null> => {
    if (!profileId) return null
    const { data } = await admin.auth.admin.getUserById(profileId)
    return data?.user?.email ?? null
  }

  // M2 (01/09/2026): a PROFESSORA remarcou (via = 'teacher' no audit). Cada
  // membro recebe o e-mail 3t no fuso dele — a mudança partiu da escola, nada
  // foi descontado — e o e-mail 4 (para a professora) é PULADO: foi ela quem
  // mexeu. O aviso interno à administração sai pelo outbox
  // (`teacher-class-changed`), enfileirado pela própria RPC.
  if (diff?.via === 'teacher') {
    for (const m of members) {
      const to = await emailOf(m.profile_id)
      if (!to) {
        console.log(`[email 3t pulado] ${m.display_name} sem login/e-mail`)
        continue
      }
      await send({
        to,
        ...teacherMovedEmail({
          firstName: m.display_name.split(' ')[0],
          studentTz: m.iana_tz,
          oldStartsUtc: oldInst.starts_at_utc,
          newStartsUtc: inst.starts_at_utc,
          teacherName: teacher?.display_name ?? 'sua professora',
        }),
      })
    }
    return
  }

  // E-mail 3 — quem remarcou.
  const actorEmail = await emailOf(actor.profile_id)
  if (actorEmail) {
    await send({ to: actorEmail, ...studentEmail(facts) })
  }

  // E-mail 3b — o(s) outro(s) membro(s) do casal (D3).
  for (const m of members.filter((m) => m.id !== actor.id)) {
    const to = await emailOf(m.profile_id)
    if (to) {
      await send({
        to,
        ...partnerEmail({
          ...facts,
          partnerFirstName: m.display_name.split(' ')[0],
          whoRescheduled: actor.display_name.split(' ')[0],
        }),
      })
    } else {
      console.log(`[email 3b pulado] membro ${m.display_name} sem login/e-mail`)
    }
  }

  // E-mail 4 — professora. F3-D5: horários no fuso DELA (teachers.iana_tz é a
  // FONTE — F3-D2); o `?? BUSINESS_TZ` abaixo é resíduo deliberado, inalcançável
  // em operação normal (teachers.iana_tz é NOT NULL; cobre só falha do SELECT) —
  // registrado no fase3-relatorio.md. Professora sem login → pulado com log.
  const teacherTo = await emailOf(teacher?.profile_id ?? null)
  if (teacherTo) {
    await send({
      to: teacherTo,
      ...teacherEmail({
        studentName: actor.display_name,
        teacherName: teacher?.display_name ?? 'Professora',
        teacherTz: teacher?.iana_tz ?? BUSINESS_TZ,
        studentTz,
        oldStartsUtc: oldInst.starts_at_utc,
        newStartsUtc: inst.starts_at_utc,
      }),
    })
  } else {
    console.log(`[email 4 pulado] professora ${teacher?.display_name ?? '?'} sem login/e-mail (Fase 3)`)
  }
}
