// Notificação da fábrica (ADR-021): trigger notify_content_review → outbox com
// aviso por admin/dia + template content-review no despachante.
//
// Desde a Leva 6.2 sobrou UMA etapa: `rascunhos`, o portão 2. A etapa `ideias`
// morreu com o Portão 1 (o aviso do LOTE virou `enqueue_content_digest`, em
// tests/conteudo-digest.test.ts). O RENDER da etapa velha continua testado de
// propósito: linha já enfileirada e ainda não enviada no dia do deploy precisa
// sair legível, não estourar no despachante.
// Gotcha da casa: o trigger notifica TODOS os admins (inclusive os de outros
// arquivos rodando em paralelo) — asserções SEMPRE filtradas pelos admins desta
// fixture, nunca contagem global.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { contentReviewEmail, contentReviewText } from '@/lib/email/content-review'
import { createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let adminEmailId: string // sem WhatsApp → canal email
let adminWaId: string // com número → canal whatsapp (régua M4-3)

beforeAll(async () => {
  sql = connect(2)
  adminEmailId = await createAuthUser(sql, 'admin', 'Admin digest e-mail')
  // O canal é decidido no INSERT da PRIMEIRA linha do dia (dedupe): o número
  // precisa existir desde o nascimento do perfil — ideias de arquivos paralelos
  // disparam o trigger a qualquer momento. Perfil criado já com e164 (atômico).
  const [u] = await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data,
                            confirmation_token, recovery_token, email_change,
                            email_change_token_new, email_change_token_current,
                            phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', ${crypto.randomUUID().slice(0, 8) + '@bancada.dev'}, '',
            now(), now(), now(), ${sql.json({ role: 'admin' })},
            '', '', '', '', '', '', '', '')
    returning id`
  adminWaId = u.id as string
  await sql`
    insert into profiles (id, role, full_name, whatsapp_e164)
    values (${adminWaId}, 'admin'::user_role, 'Admin digest zap', '+5565900010011')`
})
afterAll(async () => {
  await sql.end()
})

function ref(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

describe('trigger notify_content_review', () => {
  it('ideia nova NÃO avisa mais ninguém — a etapa `ideias` morreu com o Portão 1', async () => {
    // Leva 6.2: sobrou o roteiro AVULSO nascendo `ideia`, e ele é ato da própria
    // admin — avisá-la do que ela acabou de escrever é ruído. O aviso do LOTE
    // agora é o `enqueue_content_digest` (tests/conteudo-digest.test.ts).
    await sql`insert into content_posts (external_ref, kind, tema)
              values (${ref('digest')}, 'carrossel', 'Digest 1')`
    await sql`insert into content_posts (external_ref, kind, tema)
              values (${ref('digest')}, 'story', 'Digest 2')`

    const porAdmin = await sql`
      select recipient_profile_id, channel, count(*)::int as n
      from notification_outbox
      where template = 'content-review'
        and payload ->> 'stage' = 'ideias'
        and recipient_profile_id in (${adminEmailId}, ${adminWaId})
      group by 1, 2`
    expect(porAdmin).toHaveLength(0)
  })

  it('o canal do aviso do portão 2 segue a régua M4-3 (número → WhatsApp)', async () => {
    const r = ref('canal')
    const [{ id }] = await sql`
      insert into content_posts (external_ref, kind, tema) values (${r}, 'story', 'Canal')
      returning id`
    await sql`update content_posts
              set status = 'ideia_aprovada', idea_approved_by = ${adminEmailId}, idea_approved_at = now()
              where id = ${id}`
    await sql`update content_posts set status = 'gerando' where id = ${id}`
    await sql`update content_posts set status = 'rascunho', legenda = 'ok' where id = ${id}`

    const porAdmin = await sql`
      select recipient_profile_id, channel, count(*)::int as n
      from notification_outbox
      where template = 'content-review'
        and payload ->> 'stage' = 'rascunhos'
        and recipient_profile_id in (${adminEmailId}, ${adminWaId})
      group by 1, 2`
    expect(porAdmin).toHaveLength(2) // um por admin, e um só (dedupe do dia)
    const byId = new Map(porAdmin.map((r) => [r.recipient_profile_id, r]))
    expect(byId.get(adminEmailId)).toMatchObject({ channel: 'email', n: 1 })
    expect(byId.get(adminWaId)).toMatchObject({ channel: 'whatsapp', n: 1 })
  })

  it('entrega (gerando → rascunho) → aviso da etapa rascunhos', async () => {
    const r = ref('rascunho')
    const [{ id }] = await sql`
      insert into content_posts (external_ref, kind, tema) values (${r}, 'story', 'Etapa 2')
      returning id`
    await sql`update content_posts
              set status = 'ideia_aprovada', idea_approved_by = ${adminEmailId}, idea_approved_at = now()
              where id = ${id}`
    await sql`update content_posts set status = 'gerando' where id = ${id}`
    await sql`update content_posts set status = 'rascunho', legenda = 'ok' where id = ${id}`

    const rows = await sql`
      select 1 from notification_outbox
      where template = 'content-review'
        and payload ->> 'stage' = 'rascunhos'
        and recipient_profile_id = ${adminEmailId}`
    expect(rows).toHaveLength(1)
  })

  it('transições que NÃO são ideia nova/rascunho não notificam (aprovar não gera toque)', async () => {
    const r = ref('silencio')
    const [{ id }] = await sql`
      insert into content_posts (external_ref, kind, tema) values (${r}, 'story', 'Silêncio')
      returning id`
    const antes = await sql`
      select count(*)::int as n from notification_outbox
      where template = 'content-review' and recipient_profile_id = ${adminEmailId}`
    await sql`update content_posts
              set status = 'ideia_aprovada', idea_approved_by = ${adminEmailId}, idea_approved_at = now()
              where id = ${id}`
    const depois = await sql`
      select count(*)::int as n from notification_outbox
      where template = 'content-review' and recipient_profile_id = ${adminEmailId}`
    expect(depois[0].n).toBe(antes[0].n)
  })
})

describe('template content-review (render)', () => {
  it('texto e e-mail apontam para /admin/conteudo e diferenciam as etapas', () => {
    const ideias = contentReviewText({ stage: 'ideias', firstName: 'Helena' })
    const rascunhos = contentReviewText({ stage: 'rascunhos', firstName: 'Helena' })
    expect(ideias).toContain('/admin/conteudo')
    expect(rascunhos).toContain('/admin/conteudo')
    expect(ideias).not.toBe(rascunhos)
    expect(ideias.toLowerCase()).toContain('ideia')
    expect(rascunhos.toLowerCase()).toContain('rascunho')

    const email = contentReviewEmail({ stage: 'ideias', firstName: 'Helena', appUrl: 'https://x' })
    expect(email.html).toContain('https://x/admin/conteudo')
    expect(email.subject.toLowerCase()).toContain('ideia')
  })
})
