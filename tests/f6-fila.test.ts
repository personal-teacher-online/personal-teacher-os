// F6 — Fila em tempo real (plano integrado v2, 18/07/2026): dois toques com
// marco (M8-2/P24), silêncio 21h–8h local no despacho (M8-1), confirmação de
// presença (M8-3), resolver-sem-enviar (M8-5), retenção Evolution (M9-8) e a
// regra "tem número → recebe" (P9/M4-3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createInstance, createPrivateContract, daysFromToday } from './helpers/db'
import { dispatchOutbox } from '@/lib/outbox/dispatch'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F6'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('M8-2/P24 — dois toques com marco na chave', () => {
  it('toque 1 para aula existente no marco E para a nascida <48h (31c); guarda: nascida de ação do aluno fica sem', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno toques')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`

    const perto = await createInstance(sql, c, { startsInHours: 1 }) // → toque 2
    // 31c (veredito): criada agora, <48h e >2h → toque ACIONÁVEL imediato
    const meio = await createInstance(sql, c, { startsInHours: 30 })
    const longe = await createInstance(sql, c, { startsInHours: 40 })
    // 'longe' passa a ter nascido ANTES do marco de 48h
    await sql`update class_instances set created_at = now() - interval '20 hours' where id = ${longe}`
    // guarda do 31c: instância nascida de AÇÃO DO ALUNO (remarcação) já recebe
    // confirmação própria — o toque imediato não pode duplicar a mensagem.
    const remarcada = await createInstance(sql, c, { startsInHours: 33 })
    await sql`update class_instances set reschedule_of = ${longe} where id = ${remarcada}`

    await sql`select public.enqueue_class_touches()`

    const has = async (key: string) => {
      const rows = await sql`select 1 from notification_outbox where dedupe_key = ${key}`
      return rows.length
    }
    expect(await has(`class-reminder:2h:${perto}:${c.studentId}`)).toBe(1)
    expect(await has(`class-reminder:48h:${meio}:${c.studentId}`)).toBe(1) // 31c
    expect(await has(`class-reminder:2h:${meio}:${c.studentId}`)).toBe(0)
    expect(await has(`class-reminder:48h:${longe}:${c.studentId}`)).toBe(1)
    expect(await has(`class-reminder:48h:${remarcada}:${c.studentId}`)).toBe(0) // guarda
    expect(await has(`class-reminder:2h:${remarcada}:${c.studentId}`)).toBe(0)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-reminder' and payload->>'student_id' = ${c.studentId}::text`
  })

  it('P9/M4-3: linha de WhatsApp nasce por TEM NÚMERO (opt-in ignorado)', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno número')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    await sql`update profiles set whatsapp_e164 = '+5565900090009' where id = ${userId}`
    const inst = await createInstance(sql, c, { startsInHours: 1 })
    await sql`select public.enqueue_class_touches()`
    const rows = await sql`
      select 1 from notification_outbox
      where dedupe_key = ${`class-reminder:2h:${inst}:${c.studentId}:wa`}`
    expect(rows).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-reminder' and payload->>'student_id' = ${c.studentId}::text`
  })
})

describe('M8-1 — silêncio 21h–8h local no DESPACHO (só lote, só WhatsApp)', () => {
  it('lote em silêncio fica SEGURADO; toque 2 impossível → resolvido; e-mail nunca segura', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluno silêncio')
    await sql`update profiles set whatsapp_e164 = '+5565900070017' where id = ${userId}`
    const svc = serviceClient()
    // Fuso DINÂMICO onde AGORA são ~23h locais: assim o silêncio vale para
    // QUALQUER despachante (inclusive os de arquivos paralelos, que rodam com o
    // relógio real) — sem corrida. Etc/GMT tem sinal INVERTIDO (Etc/GMT-8 = UTC+8).
    const nowUtcHour = new Date().getUTCHours()
    const offset = (23 - nowUtcHour + 24) % 24
    const tz = offset === 0 ? 'Etc/GMT' : offset <= 14 ? `Etc/GMT-${offset}` : `Etc/GMT+${24 - offset}`
    const run = crypto.randomUUID().slice(0, 8) // chaves únicas por rodada
    const mk = async (key: string, channel: string, payload: Record<string, string | null>) => {
      await sql`
        insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
        values (${channel}, 'class-reminder', ${userId}, ${sql.json(payload)}, ${key})`
    }
    const inMs = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
    const common = { iana_tz: tz, teacher_name: 'Dona', local_time_snapshot: 'x' }
    // aula daqui a 40h → toque de 48h SEGURADO; aula daqui a 1h → toque de 2h
    // IMPOSSÍVEL (começa antes das 8h locais) → resolvida com a razão nova
    await mk(`f6:${run}:48h`, 'whatsapp', { ...common, marco: '48h', starts_at_utc: inMs(40), student_id: null })
    await mk(`f6:${run}:2h-impossivel`, 'whatsapp', { ...common, marco: '2h', starts_at_utc: inMs(1), student_id: null })
    await mk(`f6:${run}:email`, 'email', { ...common, marco: '48h', starts_at_utc: inMs(40), student_id: null })

    await dispatchOutbox(svc, {
      email: { send: async () => ({ ok: true as const }) },
      whatsapp: { send: async () => ({ ok: true as const }) },
    }, { keyLike: `f6:${run}:%` })

    const row = async (key: string) => {
      const [r] = await sql`select sent_at, error from notification_outbox where dedupe_key = ${key}`
      return r
    }
    const held = await row(`f6:${run}:48h`)
    expect(held.sent_at).toBeNull()
    expect(held.error).toBeNull() // segurado SEM erro — a próxima rodada pega
    const resolved = await row(`f6:${run}:2h-impossivel`)
    expect(resolved.sent_at).not.toBeNull()
    expect(resolved.error).toContain('silêncio')
    const email = await row(`f6:${run}:email`)
    expect(email.sent_at).not.toBeNull()
    expect(email.error).toBeNull()
    await sql`update notification_outbox set sent_at = now() where sent_at is null and dedupe_key like ${'f6:' + run + ':%'}`
  })
})

describe('M8-3 — confirmação de presença (informativa)', () => {
  it('aluno confirma a própria aula; idempotente; alheia e passada recusadas', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno confirma')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const student = await clientAs(userId, 'student')
    const inst = await createInstance(sql, c, { startsInHours: 30 })

    const { error } = await student.rpc('confirm_my_class', { p_instance: inst })
    expect(error).toBeNull()
    const [row] = await sql`select confirmed_at, confirmed_by from class_instances where id = ${inst}`
    expect(row.confirmed_at).not.toBeNull()
    expect(row.confirmed_by).toBe(userId)
    // idempotente
    const again = await student.rpc('confirm_my_class', { p_instance: inst })
    expect(again.error).toBeNull()

    const outro = await createPrivateContract(sql)
    const alheia = await createInstance(sql, outro, { startsInHours: 30 })
    const negado = await student.rpc('confirm_my_class', { p_instance: alheia })
    expect(negado.error?.message).toContain('acesso')

    const passada = await createInstance(sql, c, { startsInHours: -2 })
    const tarde = await student.rpc('confirm_my_class', { p_instance: passada })
    expect(tarde.error?.message).toContain('já começou')
  })
})

describe('M8-5 — resolver sem enviar', () => {
  it('motivo obrigatório; resolve marca sent_at + rastro + auditoria', async () => {
    const [row] = await sql`
      insert into notification_outbox (template, payload, dedupe_key)
      values ('class-reminder', '{}'::jsonb, 'f6:resolver:' || gen_random_uuid())
      returning id`
    const semMotivo = await admin.rpc('admin_resolve_outbox', { p_id: row.id })
    expect(semMotivo.error?.message).toContain('motivo')

    const { error } = await admin.rpc('admin_resolve_outbox', {
      p_id: row.id, p_note: 'já avisei pessoalmente',
    })
    expect(error).toBeNull()
    const [depois] = await sql`select sent_at, error from notification_outbox where id = ${row.id}`
    expect(depois.sent_at).not.toBeNull()
    expect(depois.error).toContain('resolvido sem envio')
    const audit = await sql`
      select 1 from audit_log where action = 'resolve_outbox' and entity_id = ${row.id}::text`
    expect(audit).toHaveLength(1)
  })
})

describe('M9-8 — retenção 90 dias da caixa Evolution (recibos ficam)', () => {
  it('expurga mensagem velha; mantém recibo velho e mensagem fresca', async () => {
    const run = crypto.randomUUID().slice(0, 8)
    await sql`
      insert into webhook_inbox (source, event_id, payload, received_at) values
      ('evolution', ${'f6-' + run + '-old-msg'}, '{"event":"messages.upsert"}'::jsonb, now() - interval '120 days'),
      ('evolution', ${'f6-' + run + '-old-receipt'}, '{"event":"messages.update"}'::jsonb, now() - interval '120 days'),
      ('evolution', ${'f6-' + run + '-fresh-msg'}, '{"event":"messages.upsert"}'::jsonb, now() - interval '5 days')`
    const [r] = await sql`select public.purge_evolution_inbox(90) as n`
    expect(Number(r.n)).toBeGreaterThanOrEqual(1)
    const left = await sql`
      select event_id from webhook_inbox
      where source = 'evolution' and event_id like ${'f6-' + run + '-%'} order by event_id`
    expect(left.map((x) => x.event_id)).toEqual([`f6-${run}-fresh-msg`, `f6-${run}-old-receipt`])
  })
})
