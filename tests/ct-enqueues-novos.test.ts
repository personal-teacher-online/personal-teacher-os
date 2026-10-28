// Construção total — novos enqueues do outbox: lembrete de aula + confirmação
// de remarcação (20260715000500) e elegibilidade de mentoria (20260715000600).
// Os enqueues de batch varrem o banco INTEIRO e os arquivos de teste rodam em
// paralelo: NUNCA asserir o retorno global — sempre linhas das fixtures PRÓPRIAS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createInstance,
  createMentorshipContract,
  createPrivateContract,
  createSession,
  type PrivateContract,
} from './helpers/db'

let sql: Sql
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  service = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

async function outboxByInstance(instanceId: string) {
  return sql`
    select channel, template, dedupe_key, recipient_profile_id,
           payload->>'iana_tz' as iana_tz, payload->>'starts_at_utc' as starts_at_utc
    from notification_outbox
    where payload->>'instance_id' = ${instanceId}
    order by channel`
}

/** Vincula um login de aluno ao student da fixture (opcionalmente com opt-in de WhatsApp). */
async function linkStudentLogin(
  c: PrivateContract,
  opts: { whatsapp?: string } = {},
): Promise<string> {
  const userId = await createAuthUser(sql, 'student', 'Aluno enqueue CT')
  // A6/i: o vínculo exige número no perfil (gatilho `students_lead_sem_login`),
  // então ele nasce com um. O opt-in DESTA suíte é o número ESCOLHIDO: sem
  // `opts.whatsapp`, o número é limpo depois do vínculo — o estado ACEITO (legado
  // ou limpeza pelo admin), que é o que "sem opt-in" representa aqui.
  if (opts.whatsapp) {
    await sql`update profiles set whatsapp_e164 = ${opts.whatsapp}
              where id = ${userId}`
  }
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  if (!opts.whatsapp) {
    await sql`update profiles set whatsapp_e164 = null where id = ${userId}`
  }
  return userId
}

describe('F6/M8-2: enqueue_class_touches (marcos 48h/2h)', () => {
  it('aula em 2h ganha o toque de 2h com iana_tz do aluno; nascida a 30h ganha o ACIONÁVEL imediato (31c); rerodada não duplica', async () => {
    const c = await createPrivateContract(sql, { tz: 'Europe/Lisbon' })
    const in2h = await createInstance(sql, c, { startsInHours: 2 })
    const in30h = await createInstance(sql, c, { startsInHours: 30 })

    const run = await service.rpc('enqueue_class_touches')
    expect(run.error).toBeNull()

    const rows = await outboxByInstance(in2h)
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe('email')
    expect(rows[0].template).toBe('class-reminder')
    expect(rows[0].iana_tz).toBe('Europe/Lisbon') // painel 28: o template formata na zona do destinatário
    const [inst] = await sql`select starts_at_utc from class_instances where id = ${in2h}`
    expect(new Date(rows[0].starts_at_utc as string).getTime()).toBe(
      new Date(inst.starts_at_utc as string).getTime(),
    )

    // 31c (ADR-018/veredito): nascida DEPOIS do marco de 48h mas >2h do início
    // recebe o toque acionável imediatamente (canal e-mail; fixture sem número).
    const meio = await outboxByInstance(in30h)
    expect(meio).toHaveLength(1)
    expect(meio[0].dedupe_key).toBe(`class-reminder:48h:${in30h}:${c.studentId}`)

    const rerun = await service.rpc('enqueue_class_touches')
    expect(rerun.error).toBeNull()
    expect(await outboxByInstance(in2h)).toHaveLength(1) // dedupe por marco+instância+aluno
  })

  it('contrato PAUSADO com aula em 2h → nenhuma linha (painel 21)', async () => {
    const c = await createPrivateContract(sql)
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    const inst = await createInstance(sql, c, { startsInHours: 2 })

    const run = await service.rpc('enqueue_class_touches')
    expect(run.error).toBeNull()
    expect(await outboxByInstance(inst)).toHaveLength(0)
  })

  it('aluno com NÚMERO (F7/M4-3) → linha extra channel=whatsapp com dedupe do marco + :wa', async () => {
    const c = await createPrivateContract(sql)
    const userId = await linkStudentLogin(c, { whatsapp: '+5565900030013' })
    const inst = await createInstance(sql, c, { startsInHours: 2 })

    const run = await service.rpc('enqueue_class_touches')
    expect(run.error).toBeNull()

    const rows = await outboxByInstance(inst)
    expect(rows.map((r) => r.channel)).toEqual(['email', 'whatsapp'])
    const wa = rows.find((r) => r.channel === 'whatsapp')!
    expect(wa.dedupe_key).toBe(`class-reminder:2h:${inst}:${c.studentId}:wa`)
    expect(wa.recipient_profile_id).toBe(userId)
  })
})

describe('enqueue_reschedule_confirmation (posse D10 com escape service_role)', () => {
  it('dono com opt-in chama → 1 linha whatsapp; outro aluno → D10; sem opt-in → 0 sem erro', async () => {
    const a = await createPrivateContract(sql)
    const userA = await linkStudentLogin(a, { whatsapp: '+351900000015' })
    const instA = await createInstance(sql, a)
    const clientA = await clientAs(userA, 'student')

    const own = await clientA.rpc('enqueue_reschedule_confirmation', { p_instance: instA })
    expect(own.error).toBeNull()
    expect(own.data).toBe(1)
    const rows = await outboxByInstance(instA)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      channel: 'whatsapp',
      template: 'reschedule-confirm',
      recipient_profile_id: userA,
    })
    expect(rows[0].dedupe_key).toBe(`reschedule-confirm:${instA}:${a.studentId}:wa`)

    // Aluno B (contrato próprio, alheio à instância de A) → posse nega.
    const b = await createPrivateContract(sql)
    const userB = await linkStudentLogin(b, { whatsapp: '+351900000016' })
    const clientB = await clientAs(userB, 'student')
    const alheio = await clientB.rpc('enqueue_reschedule_confirmation', { p_instance: instA })
    expect(alheio.error?.message).toMatch(/não tem acesso a este contrato \(D10\)/)

    // Sem opt-in: retorno 0 e nenhuma linha, SEM erro (só e-mail 3 pela action).
    const semOptin = await createPrivateContract(sql)
    const userSem = await linkStudentLogin(semOptin)
    const instSem = await createInstance(sql, semOptin)
    const clientSem = await clientAs(userSem, 'student')
    const r = await clientSem.rpc('enqueue_reschedule_confirmation', { p_instance: instSem })
    expect(r.error).toBeNull()
    expect(r.data).toBe(0)
    expect(await outboxByInstance(instSem)).toHaveLength(0)
  })

  it('service client chama e insere — regressão do grant morto (escape service_role)', async () => {
    const a = await createPrivateContract(sql)
    await linkStudentLogin(a, { whatsapp: '+5565900040014' })
    const inst = await createInstance(sql, a)

    const r = await service.rpc('enqueue_reschedule_confirmation', { p_instance: inst })
    expect(r.error).toBeNull() // um check app_role()='admin' sem escape rejeitaria o service_role
    expect(r.data).toBe(1)
    expect(await outboxByInstance(inst)).toHaveLength(1)
  })
})

describe('enqueue_mentorship_eligibility_notices (aviso pela etapa RESERVÁVEL)', () => {
  async function noticesFor(contractId: string) {
    return sql`
      select dedupe_key, (payload->>'next_window')::int as next_window
      from notification_outbox
      where template = 'mentorship-eligible'
        and payload->>'contract_id' = ${contractId}
      order by dedupe_key`
  }

  it('contrato destravado com regra da etapa 1 → aviso next_window=1; 2ª rodada não duplica', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1, // 1 janela destravada
      thresholds: { 1: 0 },
      completionPct: 0,
    })

    const run = await service.rpc('enqueue_mentorship_eligibility_notices')
    expect(run.error).toBeNull()

    let rows = await noticesFor(m.contractId)
    expect(rows).toHaveLength(1)
    expect(rows[0].next_window).toBe(1)
    expect(rows[0].dedupe_key).toBe(`mentorship-eligible:${m.contractId}:1`)

    const rerun = await service.rpc('enqueue_mentorship_eligibility_notices')
    expect(rerun.error).toBeNull()
    rows = await noticesFor(m.contractId)
    expect(rows).toHaveLength(1) // dedupe pela etapa
  })

  it('contrato SEM regra não derruba o batch: o configurado insere e o outro vira skip auditado', async () => {
    const semRegra = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1,
      thresholds: {}, // estado ATUAL de produção: pendência da dona
      completionPct: 50,
    })
    const comRegra = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1,
      thresholds: { 1: 0 },
      completionPct: 0,
    })

    const run = await service.rpc('enqueue_mentorship_eligibility_notices')
    expect(run.error).toBeNull() // mentorship_can_book RAISA para semRegra; o batch sobrevive

    expect(await noticesFor(comRegra.contractId)).toHaveLength(1)
    expect(await noticesFor(semRegra.contractId)).toHaveLength(0)

    const skips = await sql`
      select diff from audit_log
      where action = 'mentorship_eligibility_skip'
        and entity_id = ${semRegra.contractId}::text`
    expect(skips.length).toBeGreaterThanOrEqual(1)
    expect(skips[0].diff.error).toMatch(/regras de progresso não configuradas/)
  })

  it('etapa 1 gasta + 2 janelas destravadas → o aviso novo sai com next_window=2 (painel 22)', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3, // window_months=2 (default) ⇒ floor(3/2)+1 = 2 janelas
      thresholds: { 1: 0, 2: 0 },
      completionPct: 0,
    })
    // Gasta a etapa 1 pelo motor (definer; como owner via SQL, padrão mentorship.test.ts).
    const session = await createSession(sql)
    await sql`select public.book_mentorship_session(${session}, ${m.contractId})`

    const run = await service.rpc('enqueue_mentorship_eligibility_notices')
    expect(run.error).toBeNull()

    const rows = await noticesFor(m.contractId)
    expect(rows).toHaveLength(1) // nenhum aviso da etapa 1 — ela nunca foi anunciável aqui
    expect(rows[0].next_window).toBe(2)
    expect(rows[0].dedupe_key).toBe(`mentorship-eligible:${m.contractId}:2`)
  })
})
