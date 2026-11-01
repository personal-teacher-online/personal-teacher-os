// Issue #127 — `enqueue_student_stop_request`, a função SQL que o webhook da
// Meta chama quando um aluno manda palavra de parada ao número de envio
// (ADR-038, item 4: o "PARAR" não é ignorado; e-mail interno à admin, e quem
// decide é ela, pela ficha). Banco real, chamada direta.
//
// O que se prova:
//   1. aluno achado pelo número (só dígitos, como o despachante manda; e o
//      celular do Brasil também sem o 9 da frente, que é como o WhatsApp
//      identifica número antigo): UM e-mail por admin, com a ficha; nada no
//      perfil nem no aluno muda; audit_log gravado;
//   2. dedupe pelo wamid: a segunda chamada não enfileira nem audita de novo
//      (Lei 6);
//   3. número de ninguém: avisa assim mesmo, sem aluno, com o número;
//   4. número em mais de uma ficha: avisa sem escolher aluno por palpite;
//   5. ACL: só service_role executa (e o texto da migration revoga
//      nominalmente, porque ACL no banco local é falso-verde);
//   6. a rede: a mensagem de parada que ficou pendente na inbox (a função
//      falhou e a Meta, com o 200, não reenvia) é avisada de novo pelo pg_cron;
//   7. o e-mail: no despachante só por e-mail, no catálogo de Ajustes e com
//      nome em português na tela de Mensagens; número sem ficha diz
//      "número não cadastrado: <número>".
//
// Régua da casa: arquivos rodam em PARALELO no mesmo banco. Todo wamid daqui
// leva o sufixo da rodada; a limpeza é só do que este arquivo criou.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Sql } from 'postgres'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'
import { CHAVES_DO_CATALOGO, catalogoDeMensagens } from '@/data/admin/ajustes-mensagens'
import { NOME_DO_TEMPLATE } from '@/data/admin/mensagens-gramatica'
import { studentStopRequestEmail } from '@/lib/email/student-stop-request'
import { TEMPLATES } from '@/lib/outbox/dispatch'

vi.mock('server-only', () => ({}))

const RODADA = crypto.randomUUID().slice(0, 8)
const TEMPLATE = 'student-stop-request'

let sql: Sql
let adminId: string
const wamids: string[] = []
/** logins de ALUNO criados aqui (apagados no fim) */
const usuarios: string[] = []
const alunos: string[] = []

beforeAll(async () => {
  sql = connect(2)
  adminId = await createAuthUser(sql, 'admin', 'Admin do aviso de parada')
})
afterAll(async () => {
  for (const w of wamids) {
    await sql`delete from notification_outbox where dedupe_key like ${`${TEMPLATE}:${w}:%`}`
  }
  if (alunos.length) await sql`delete from students where id = any(${alunos})`
  // só os logins de aluno: admin criada aqui pode ter recebido aviso enfileirado
  // por outro arquivo em paralelo (o outbox a referencia), como nos vizinhos
  if (usuarios.length) await sql`delete from auth.users where id = any(${usuarios})`
  await sql.end()
})

function wamid(): string {
  const w = `wamid.PARADA${RODADA}${crypto.randomUUID().replace(/-/g, '')}`
  wamids.push(w)
  return w
}

/** Celular fictício do Brasil (+55 65 9000X-XXXX), só dígitos, com o 9. */
function numero(): string {
  return `55659000${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`
}

/** Um aluno com login cujo perfil tem o número dado (E.164 com +). */
async function alunoCom(e164: string, nome: string): Promise<{ perfil: string; aluno: string }> {
  const perfil = await createAuthUser(sql, 'student', nome, { whatsapp: e164 })
  usuarios.push(perfil)
  const [a] = await sql`
    insert into students (display_name, iana_tz, tz_confirmed, profile_id)
    values (${nome}, 'America/Cuiaba', true, ${perfil})
    returning id`
  alunos.push(a.id as string)
  return { perfil, aluno: a.id as string }
}

async function chamar(w: string, de: string, texto: string): Promise<number> {
  const [r] = await sql`select public.enqueue_student_stop_request(${w}, ${de}, ${texto}) as n`
  return r.n as number
}

interface Aviso {
  channel: string
  template: string
  recipient_profile_id: string
  payload: Record<string, unknown>
  sent_at: Date | null
}
async function avisos(w: string): Promise<Aviso[]> {
  return (await sql`
    select channel, template, recipient_profile_id, payload, sent_at
      from notification_outbox
     where dedupe_key like ${`${TEMPLATE}:${w}:%`}
     order by recipient_profile_id`) as unknown as Aviso[]
}

async function auditoriaDe(w: string): Promise<Array<{ actor: string | null; entity: string; diff: Record<string, unknown> }>> {
  return (await sql`
    select actor, entity, diff from audit_log
     where action = 'enqueue_student_stop_request' and entity_id = ${w}`) as unknown as Array<{
    actor: string | null
    entity: string
    diff: Record<string, unknown>
  }>
}

describe('#127 · enqueue_student_stop_request', () => {
  it('aluno do número: um e-mail por admin, com a ficha e o texto; perfil e aluno intactos; audit_log', async () => {
    const de = numero()
    const { perfil, aluno } = await alunoCom(`+${de}`, 'Aluna que pediu para parar')
    const [perfilAntes] = await sql`select * from profiles where id = ${perfil}`
    const [alunoAntes] = await sql`select * from students where id = ${aluno}`

    const w = wamid()
    const n = await chamar(w, de, 'PARAR')

    // a contagem de admins não se crava: outros arquivos criam admins em paralelo
    const linhas = await avisos(w)
    expect(n).toBe(linhas.length)
    const meu = linhas.filter((l) => l.recipient_profile_id === adminId)
    expect(meu).toHaveLength(1)
    expect(meu[0]).toMatchObject({ channel: 'email', template: TEMPLATE, sent_at: null })
    expect(meu[0].payload).toMatchObject({
      student_id: aluno,
      student_name: 'Aluna que pediu para parar',
      alunos_com_o_numero: 1,
      whatsapp_e164: `+${de}`,
      texto: 'PARAR',
      wamid: w,
    })
    // só admins recebem
    const papeis = await sql`
      select distinct role::text as role from profiles
       where id = any(${linhas.map((l) => l.recipient_profile_id)})`
    expect(papeis.map((p) => p.role)).toEqual(['admin'])

    expect((await sql`select * from profiles where id = ${perfil}`)[0]).toEqual(perfilAntes)
    expect((await sql`select * from students where id = ${aluno}`)[0]).toEqual(alunoAntes)

    const trilha = await auditoriaDe(w)
    expect(trilha).toHaveLength(1)
    expect(trilha[0].entity).toBe('notification_outbox')
    expect(trilha[0].diff).toMatchObject({ student_id: aluno, alunos_com_o_numero: 1, avisos: linhas.length })
  })

  it('dedupe pelo wamid: a segunda chamada não enfileira nem audita de novo, nem para admin nova', async () => {
    const w = wamid()
    const de = numero()
    expect(await chamar(w, de, 'PARAR')).toBeGreaterThan(0)
    const antes = await avisos(w)
    // uma admin que entra entre a entrega e a reentrega não ganha aviso velho
    await createAuthUser(sql, 'admin', 'Admin que chegou depois')
    expect(await chamar(w, de, 'PARAR')).toBe(0)
    expect(await avisos(w)).toEqual(antes)
    expect(await auditoriaDe(w)).toHaveLength(1)
  })

  it('número que não é de nenhum aluno: avisa a admin mesmo assim, sem aluno e com o número', async () => {
    const w = wamid()
    const de = numero()
    await chamar(w, de, 'não quero mais receber')
    const meu = (await avisos(w)).filter((l) => l.recipient_profile_id === adminId)
    expect(meu).toHaveLength(1)
    expect(meu[0].payload).toMatchObject({
      student_id: null,
      student_name: null,
      alunos_com_o_numero: 0,
      whatsapp_e164: `+${de}`,
      texto: 'não quero mais receber',
    })
  })

  it('celular do Brasil sem o 9 da frente (como o WhatsApp manda número antigo) acha o aluno', async () => {
    // o 9 só volta em celular (8 dígitos começando com 6 a 9): a faixa fictícia
    // 9000X não serve aqui, a 99999-XXXX sim (livre no banco, conferido)
    let de = ''
    for (;;) {
      de = `556599999${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`
      const [{ n }] = await sql`
        select count(*)::int as n from profiles
         where regexp_replace(coalesce(whatsapp_e164, ''), '[^0-9]', '', 'g') in (${de}, ${de.slice(0, 4) + de.slice(5)})`
      if (n === 0) break
    }
    const { aluno } = await alunoCom(`+${de}`, 'Aluna de número antigo')
    const semONove = de.slice(0, 4) + de.slice(5)
    const w = wamid()
    await chamar(w, semONove, 'stop')
    const meu = (await avisos(w)).filter((l) => l.recipient_profile_id === adminId)
    expect(meu[0].payload).toMatchObject({ student_id: aluno, alunos_com_o_numero: 1 })
  })

  it('fixo do Brasil (8 dígitos começando com 2 a 5) não ganha o 9: não casa com o celular de outra pessoa', async () => {
    const assinante = `3${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`
    await alunoCom(`+55659${assinante}`, 'Aluna do celular parecido')
    const w = wamid()
    await chamar(w, `5565${assinante}`, 'PARAR')
    const meu = (await avisos(w)).filter((l) => l.recipient_profile_id === adminId)
    expect(meu[0].payload).toMatchObject({ student_id: null, alunos_com_o_numero: 0 })
  })

  it('número em mais de uma ficha: avisa sem escolher aluno por palpite', async () => {
    const de = numero()
    await alunoCom(`+${de}`, 'Irmã mais velha')
    await alunoCom(`+${de}`, 'Irmã mais nova')
    const w = wamid()
    await chamar(w, de, 'sair')
    const meu = (await avisos(w)).filter((l) => l.recipient_profile_id === adminId)
    expect(meu[0].payload).toMatchObject({ student_id: null, student_name: null, alunos_com_o_numero: 2 })
  })

  it('sem wamid ou sem número: recusa (o webhook anota o erro na linha da inbox)', async () => {
    await expect(chamar('', numero(), 'PARAR')).rejects.toThrow(/wamid/)
    await expect(chamar(wamid(), '+', 'PARAR')).rejects.toThrow(/número/)
  })
})

describe('#127 · a rede: meta_retry_pending_stop_requests (pg_cron, 5 min)', () => {
  /** Uma mensagem de parada pendente na inbox, como o webhook a deixa quando a função falha. */
  async function pendente(w: string, message: Record<string, unknown>, haMinutos: number): Promise<void> {
    await sql`
      insert into webhook_inbox (source, event_id, payload, error, received_at)
      values ('meta', ${`${w}:message`}, ${sql.json({ message } as never)},
              'aviso de parada não enfileirado: banco fora do ar',
              now() - make_interval(mins => ${haMinutos}))`
  }
  async function linha(w: string) {
    const [r] = await sql`
      select processed_at, error from webhook_inbox where source = 'meta' and event_id = ${`${w}:message`}`
    return r as { processed_at: Date | null; error: string | null }
  }

  afterAll(async () => {
    for (const w of wamids) await sql`delete from webhook_inbox where source = 'meta' and event_id = ${`${w}:message`}`
  })

  it('a pendente enfileira o aviso e fecha; a que não pode reescreve o erro e espera; a recém-chegada fica com o webhook', async () => {
    const boa = wamid()
    const de = numero()
    await pendente(boa, { id: boa, from: de, type: 'text', text: { body: 'PARAR' } }, 10)
    const semNumero = wamid()
    await pendente(semNumero, { id: semNumero, type: 'text', text: { body: 'PARAR' } }, 10)
    const nova = wamid()
    await pendente(nova, { id: nova, from: numero(), type: 'text', text: { body: 'PARAR' } }, 0)

    await sql`select public.meta_retry_pending_stop_requests()`

    expect(await linha(boa)).toMatchObject({ error: null })
    expect((await linha(boa)).processed_at).not.toBeNull()
    const meu = (await avisos(boa)).filter((l) => l.recipient_profile_id === adminId)
    expect(meu).toHaveLength(1)
    expect(meu[0].payload).toMatchObject({ whatsapp_e164: `+${de}`, texto: 'PARAR' })

    const falha = await linha(semNumero)
    expect(falha.processed_at).toBeNull()
    expect(falha.error).toContain('sem o número')
    expect(await avisos(semNumero)).toHaveLength(0)

    expect((await linha(nova)).processed_at).toBeNull()
    expect(await avisos(nova)).toHaveLength(0)

    // a segunda rodada não repete o aviso de quem já foi avisado
    await sql`select public.meta_retry_pending_stop_requests()`
    expect((await avisos(boa)).filter((l) => l.recipient_profile_id === adminId)).toHaveLength(1)
  })

  it('está no pg_cron a cada 5 minutos e ninguém de fora executa', async () => {
    const [job] = await sql`
      select schedule, command from cron.job where jobname = 'meta-retry-pending-stop-requests'`
    expect(job.schedule).toBe('*/5 * * * *')
    expect(job.command).toContain('meta_retry_pending_stop_requests')
    const [acl] = await sql`
      select has_function_privilege('anon', 'public.meta_retry_pending_stop_requests()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.meta_retry_pending_stop_requests()', 'execute') as authenticated,
             has_function_privilege('service_role', 'public.meta_retry_pending_stop_requests()', 'execute') as service_role`
    expect(acl).toEqual({ anon: false, authenticated: false, service_role: false })
  })
})

describe('#127 · ACL de enqueue_student_stop_request', () => {
  it('só service_role executa', async () => {
    const [acl] = await sql`
      select has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role', p.oid, 'execute') as service_role
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'enqueue_student_stop_request'`
    expect(acl).toEqual({ anon: false, authenticated: false, service_role: true })
  })

  it('o texto da migration revoga de public, anon e authenticated nominalmente (ACL local é falso-verde)', () => {
    const dir = join(process.cwd(), 'supabase/migrations')
    const arquivo = readdirSync(dir).find((f) => f.endsWith('_student_stop_request.sql'))
    expect(arquivo, 'migration da #127').toBeTruthy()
    const texto = readFileSync(join(dir, arquivo!), 'utf8').replace(/\s+/g, ' ')
    expect(texto).toContain(
      'revoke execute on function public.enqueue_student_stop_request(text, text, text) from public, anon, authenticated;',
    )
    expect(texto).toContain('grant execute on function public.enqueue_student_stop_request(text, text, text) to service_role;')
  })
})

describe('#127 · o e-mail student-stop-request', () => {
  it('o despachante sabe mandar, SÓ por e-mail', () => {
    expect(TEMPLATES[TEMPLATE]?.email).toBeTypeOf('function')
    expect(TEMPLATES[TEMPLATE]?.text).toBeUndefined()
  })

  it('está no catálogo de Ajustes (só e-mail) e tem nome em português na tela de Mensagens', () => {
    expect(CHAVES_DO_CATALOGO).toContain(TEMPLATE)
    const nome = 'Aluno pediu para parar (aviso interno)'
    expect(NOME_DO_TEMPLATE[TEMPLATE]).toBe(nome)
    const m = catalogoDeMensagens(DateTime.now())
      .flatMap((b) => b.mensagens)
      .find((x) => x.nome === nome)
    expect(m?.canais).toEqual(['E-mail'])
    expect(m?.assunto).toBe('Marina pediu para parar de receber mensagens')
  })

  it('aluno identificado: nome no assunto e botão para a ficha', () => {
    const e = studentStopRequestEmail({
      firstName: 'Dona',
      studentId: '00000000-0000-0000-0000-0000000000cc',
      studentName: 'Aluna Inventada',
      alunosComONumero: 1,
      whatsappE164: '+5565900090009',
      texto: 'PARAR',
      appUrl: 'https://app.exemplo.com',
    })
    expect(e.subject).toBe('Aluna Inventada pediu para parar de receber mensagens')
    expect(e.html).toContain('https://app.exemplo.com/admin/alunos/00000000-0000-0000-0000-0000000000cc')
    expect(e.html).toContain('PARAR')
  })

  it('número sem ficha: "número não cadastrado: <número>" e botão para a lista', () => {
    const e = studentStopRequestEmail({
      firstName: 'Dona',
      studentId: null,
      studentName: null,
      alunosComONumero: 0,
      whatsappE164: '+5565900090009',
      texto: '<b>stop</b>',
      appUrl: 'https://app.exemplo.com',
    })
    expect(e.subject).toContain('+5565900090009')
    expect(e.html).toContain('Número não cadastrado: <strong>+5565900090009</strong>')
    expect(e.html).toContain('href="https://app.exemplo.com/admin/alunos"')
    expect(e.html, 'o texto do aluno é escapado').toContain('&lt;b&gt;stop&lt;/b&gt;')
  })

  it('número em mais de uma ficha: diz isso, sem escolher aluno', () => {
    const e = studentStopRequestEmail({
      firstName: 'Dona',
      studentId: null,
      studentName: null,
      alunosComONumero: 2,
      whatsappE164: '+5565900090009',
      texto: 'sair',
    })
    expect(e.html).toContain('Número em mais de uma ficha')
    expect(e.html).not.toContain('não cadastrado')
  })
})
