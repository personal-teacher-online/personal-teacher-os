// Onda Agenda e Mensagens · M3-2, issue #43 — driver `cloud-api` do WhatsApp
// (ADR-038, opção B) atrás de NotificationChannel, com template e wamid.
// Banco real (as RPCs da M3-1, migration 20261030000100), fetch da Meta
// simulado; tudo que vai para outro endereço passa direto (o Supabase).
//
// O que se prova, na ordem dos critérios da issue:
//   1. o núcleo da rota manda a linha como template: o request bate com a
//      fixture e a linha fica com provider = 'meta' e o wamid da resposta;
//   2. sem as chaves, a linha fica pendente com o motivo, nada sai;
//   3. 2xx da Meta e `outbox_mark_sent` falhando: a linha fica presa com o
//      wamid no motivo e a rodada seguinte não manda de novo;
//   4. duas rodadas ao mesmo tempo sobre 20 linhas: 20 envios, não 40;
//   5. chave sem template na Meta fica presa; a professora que remarcou usa o
//      template "a escola moveu";
//   6. 4xx da Meta vira motivo, sem token no motivo nem no log;
//   7. o número vai sem "+", e os pontos que montavam o registro de canais
//      usam `canaisDoAmbiente()` (pino de fonte).
//
// Régua da casa: arquivos rodam em PARALELO no mesmo banco. Toda linha daqui
// nasce com a chave `m3c:<rodada>:…` e todo despacho é recortado por ela.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// O rodapé "fale com a gente" é parâmetro de vários templates: número
// fictício fixado ANTES dos imports (o link é lido na carga do módulo).
vi.hoisted(() => {
  process.env.WHATSAPP_ATENDIMENTO_E164 = '+5565900000001'
})
vi.mock('server-only', () => ({}))

import type { NotificationChannel } from '@/lib/notify/channel'
import { cloudApiChannel, GRAPH_API_VERSION } from '@/lib/notify/cloud-api'
import { canaisDoAmbiente } from '@/lib/notify/registry'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { handleDispatchOutbox } from '@/lib/outbox/handle'
import { createAuthUser, serviceClient } from './helpers/auth'
import { connect, createInstanceAt, createPrivateContract, createStudent } from './helpers/db'

const RODADA = crypto.randomUUID().slice(0, 8)
const PREFIXO = `m3c:${RODADA}:`
const TOKEN = 'token-de-teste-da-meta-xyz'
const NUMERO_DA_ESCOLA = '100000000000001'
const CONFIG = { token: TOKEN, phoneNumberId: NUMERO_DA_ESCOLA }
const FIXTURES = join(process.cwd(), 'tests/fixtures/meta')

const fixture = (nome: string): Record<string, unknown> => {
  const { _fonte, ...resto } = JSON.parse(readFileSync(join(FIXTURES, nome), 'utf8')) as Record<string, unknown>
  void _fonte
  return resto
}

let sql: Sql
let servico: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  servico = serviceClient()
})
afterAll(async () => {
  // higiene: o que ficou pendente ou preso desta rodada sai da fila (resolvida,
  // nunca apagada — Lei 8); a tentativa aberta só fecha pelo caminho dela
  await sql`
    update notification_outbox
       set sent_at = now(), error = coalesce(error, 'fim do teste m3-cloud-api')
     where dedupe_key like ${PREFIXO + '%'} and sent_at is null and attempt_id is null`
  await sql.end()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */
/* A Meta simulada                                                             */
/* -------------------------------------------------------------------------- */

interface ChamadaDaMeta {
  url: string
  headers: Record<string, string>
  corpo: Record<string, unknown>
}

/**
 * Troca o fetch global: o que vai para graph.facebook.com é anotado e
 * respondido por `responder`; o resto (Supabase) passa para o fetch de verdade.
 */
function metaSimulada(responder: (c: ChamadaDaMeta) => Response | Promise<Response>): ChamadaDaMeta[] {
  const chamadas: ChamadaDaMeta[] = []
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada)
    if (!url.startsWith('https://graph.facebook.com/')) return original(entrada, init)
    const c: ChamadaDaMeta = {
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      corpo: JSON.parse(String(init?.body)) as Record<string, unknown>,
    }
    chamadas.push(c)
    return responder(c)
  })
  return chamadas
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

/** Resposta de sucesso com um wamid único (o banco não aceita o mesmo id duas vezes). */
const aceita = () => {
  const r = fixture('send-template-response.json') as { messages: { id: string }[] }
  return json({ ...r, messages: [{ ...r.messages[0], id: `${r.messages[0].id}.${crypto.randomUUID()}` }] })
}

/* -------------------------------------------------------------------------- */
/* Fixtures no banco                                                           */
/* -------------------------------------------------------------------------- */

/** Aluna com login, número de WhatsApp e primeiro nome "Marina". */
async function aluna(): Promise<{ studentId: string; profileId: string; e164: string }> {
  const studentId = await createStudent(sql)
  const e164 = '+556590000' + String(Math.floor(Math.random() * 9000) + 1000)
  const profileId = await createAuthUser(sql, 'student', 'Aluna Cloud API', { whatsapp: e164 })
  await sql`update auth.users set raw_user_meta_data = ${sql.json({ first_name: 'Marina' })} where id = ${profileId}`
  await sql`update students set profile_id = ${profileId} where id = ${studentId}`
  return { studentId, profileId, e164 }
}

let seq = 0
async function linha(
  template: string,
  profileId: string,
  payload: Record<string, unknown>,
  grupo = 'x',
): Promise<string> {
  seq += 1
  const [r] = await sql`
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values ('whatsapp', ${template}, ${profileId}, ${sql.json(payload as never)}, ${`${PREFIXO}${grupo}:${seq}`})
    returning id`
  return r.id as string
}

/** Aula cancelada sem crédito (sem silêncio, sem obsolescência): sai a qualquer hora. */
function cancelada(studentId: string, startsAt = DateTime.utc().plus({ days: 2 }).startOf('minute')) {
  return {
    student_id: studentId,
    starts_at_utc: startsAt.toISO(),
    iana_tz: 'America/Sao_Paulo',
    local_time_snapshot: 'fixture',
    teacher_name: 'Teacher Ana',
    credited: false,
  }
}

interface Estado {
  sent_at: Date | null
  error: string | null
  provider: string | null
  provider_message_id: string | null
  attempt_id: string | null
  situacao: string
}
async function estado(id: string): Promise<Estado> {
  const [r] = await sql`
    select sent_at, error, provider, provider_message_id, attempt_id, situacao
      from outbox_admin where id = ${id}`
  return r as unknown as Estado
}

const despachar = (canal: ReturnType<typeof cloudApiChannel>, grupo: string, admin: SupabaseClient = servico) =>
  dispatchOutbox(admin, { whatsapp: canal }, { keyLike: `${PREFIXO}${grupo}:%`, limit: 500 })

/* ========================================================================== */

describe('M3-2 · 1. a rota manda template e grava o wamid', () => {
  it('com as chaves: o request bate com a fixture e a linha fica com provider meta e o wamid da resposta', async () => {
    vi.stubEnv('WHATSAPP_CLOUD_TOKEN', TOKEN)
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', NUMERO_DA_ESCOLA)
    const { studentId, profileId, e164 } = await aluna()
    const payload = cancelada(studentId)
    const id = await linha('class-cancelled', profileId, payload, 'rota')

    let wamid = ''
    const chamadas = metaSimulada(() => {
      const r = aceita()
      return r.clone().json().then((b: { messages: { id: string }[] }) => {
        wamid = b.messages[0].id
        return r
      })
    })
    const { status } = await handleDispatchOutbox(servico, {
      token: 'segredo-da-rota',
      expectedToken: 'segredo-da-rota',
      channels: canaisDoAmbiente(),
      keyLike: `${PREFIXO}rota:%`,
    })
    expect(status).toBe(200)

    expect(chamadas).toHaveLength(1)
    const [c] = chamadas
    expect(c.url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/${NUMERO_DA_ESCOLA}/messages`)
    expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`)

    const diaEHora = DateTime.fromISO(String(payload.starts_at_utc))
      .setZone('America/Sao_Paulo')
      .setLocale('pt-BR')
      .toFormat("cccc, dd/LL 'às' HH:mm")
    const esperado = JSON.parse(
      JSON.stringify(fixture('send-template-request.json'))
        .replace('<to>', e164.slice(1))
        .replace('<dia_e_hora>', diaEHora)
        .replace('<attempt_id>', String(c.corpo.biz_opaque_callback_data)),
    )
    expect(c.corpo).toEqual(esperado)
    expect(String(c.corpo.biz_opaque_callback_data)).toMatch(/^[0-9a-f-]{36}$/)

    const e = await estado(id)
    expect(e.sent_at).not.toBeNull()
    expect(e.error).toBeNull()
    expect(e.provider).toBe('meta')
    expect(e.provider_message_id).toBe(wamid)
    expect(e.attempt_id).toBeNull()
  })

  it('o registro de canais aponta o WhatsApp para o driver cloud-api', () => {
    expect(canaisDoAmbiente().whatsapp?.provider).toBe('meta')
  })
})

describe('M3-2 · 2. fail-closed sem as chaves', () => {
  it('sem token nem id do número: a linha fica pendente com o motivo e nada sai', async () => {
    vi.stubEnv('WHATSAPP_CLOUD_TOKEN', '')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'semchave')

    const chamadas = metaSimulada(aceita)
    await dispatchOutbox(servico, canaisDoAmbiente(), { keyLike: `${PREFIXO}semchave:%` })

    expect(chamadas).toHaveLength(0)
    const e = await estado(id)
    expect(e.sent_at).toBeNull()
    expect(e.attempt_id).toBeNull()
    expect(e.error).toMatch(/faltam as chaves da Cloud API do WhatsApp/)
    // a frase vai para a tela de Mensagens: nada de nome de variável (R2)
    expect(e.error).not.toContain('WHATSAPP_')
    // o canal sem chave se declara indisponível e, chamado direto, recusa
    expect(await cloudApiChannel(null).send({ to: '+5565900000001', template: { name: 'x', params: [] } }))
      .toEqual({ ok: false, error: expect.stringMatching(/ausentes/) })
  })

  it('sem as chaves, o aviso que já perdeu o sentido (aula começou) resolve como obsoleto, não fica pendente', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha(
      'class-reminder',
      profileId,
      { ...cancelada(studentId, DateTime.utc().minus({ hours: 1 })), marco: '48h', instance_id: crypto.randomUUID() },
      'semchaveobsoleto',
    )
    await dispatchOutbox(servico, { whatsapp: cloudApiChannel(null) }, { keyLike: `${PREFIXO}semchaveobsoleto:%` })
    const e = await estado(id)
    expect(e.sent_at).not.toBeNull()
    expect(e.error).toBe('aula já começou antes do envio')
  })
})

describe('M3-2 · 2b. janela de silêncio e link logado', () => {
  it('o driver não decide o silêncio: a linha segurada não abre tentativa nem chama a Meta', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha(
      'class-reminder',
      profileId,
      { ...cancelada(studentId), marco: '48h', instance_id: crypto.randomUUID() },
      'silencio',
    )
    // 06:00 UTC = 03:00 em São Paulo: silêncio
    const madrugada = new Date(new Date().setUTCHours(6, 0, 0, 0))
    const chamadas = metaSimulada(aceita)
    const r = await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}silencio:%`,
      now: madrugada,
    })
    expect(r.held).toBe(1)
    expect(chamadas).toHaveLength(0)
    const [l] = await sql`select sent_at, error, attempt_id from notification_outbox where id = ${id}`
    expect(l.sent_at).toBeNull()
    expect(l.error).toBeNull()
    expect(l.attempt_id, 'segurar não é enviar: nenhuma tentativa aberta').toBeNull()
    // R1: a reserva sai já — senão a dona veria resolver/reenviar recusados por 10 min
    const [r2] = await sql`select claimed_at from notification_outbox where id = ${id}`
    expect(r2.claimed_at).toBeNull()
  })

  it('lembrete que não pode virar template não gera link logado à toa', async () => {
    const { studentId, profileId } = await aluna()
    await linha(
      'class-reminder',
      profileId,
      { ...cancelada(studentId), marco: '48h', instance_id: crypto.randomUUID() },
      'semlink',
    )
    let links = 0
    const contaLinks = new Proxy(servico, {
      get(alvo, chave, receptor) {
        if (chave === 'auth') {
          const auth = alvo.auth
          return new Proxy(auth, {
            get(a, k) {
              if (k !== 'admin') return Reflect.get(a, k)
              return new Proxy(a.admin, {
                get(adm, kk) {
                  if (kk === 'generateLink') {
                    return (...args: Parameters<typeof adm.generateLink>) => {
                      links += 1
                      return adm.generateLink(...args)
                    }
                  }
                  const v = Reflect.get(adm, kk)
                  return typeof v === 'function' ? v.bind(adm) : v
                },
              })
            },
          })
        }
        return Reflect.get(alvo, chave, receptor)
      },
    })
    await dispatchOutbox(contaLinks, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}semlink:%`,
      now: new Date(new Date().setUTCHours(15, 0, 0, 0)),
      atendimentoUrl: null, // o toque de 48h pede o número de atendimento
    })
    expect(links).toBe(0)
  })
})

describe('M3-2 · 3. 2xx da Meta e o id não gravado: nunca reenviar', () => {
  it('outbox_mark_sent falha depois do 2xx: a linha fica presa com o wamid no motivo e a rodada seguinte não chama a Meta', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'markfalha')

    // o banco recusa o fechamento (o "grant faltando em produção" da issue)
    const quebrado = new Proxy(servico, {
      get(alvo, chave, receptor) {
        if (chave === 'rpc') {
          return (fn: string, args?: Record<string, unknown>) =>
            fn === 'outbox_mark_sent'
              ? Promise.resolve({
                  data: null,
                  error: { message: 'permission denied for function outbox_mark_sent', code: '42501' },
                })
              : alvo.rpc(fn, args)
        }
        return Reflect.get(alvo, chave, receptor)
      },
    })
    let wamid = ''
    const primeira = metaSimulada(async () => {
      const r = aceita()
      wamid = ((await r.clone().json()) as { messages: { id: string }[] }).messages[0].id
      return r
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rodada = await despachar(cloudApiChannel(CONFIG), 'markfalha', quebrado)
    expect(rodada, 'presa conta como pendente, não como enviada').toMatchObject({ sent: 0, pendingError: 1 })
    expect(primeira).toHaveLength(1)

    const e = await estado(id)
    expect(e.attempt_id, 'a tentativa fica aberta: a linha não volta para a fila').not.toBeNull()
    expect(e.error).toContain('resultado incerto')
    expect(e.error).toContain(`a Meta aceitou a mensagem (id ${wamid}), mas o registro do envio falhou`)
    expect(e.error, 'o erro cru do banco fica no log, não na tela').not.toContain('permission denied')
    expect(e.situacao).toBe('preso')

    vi.unstubAllGlobals()
    const segunda = metaSimulada(aceita)
    await despachar(cloudApiChannel(CONFIG), 'markfalha')
    expect(segunda, 'a Meta já aceitou: mandar de novo seria cobrar duas vezes').toHaveLength(0)
    expect((await estado(id)).attempt_id).toBe(e.attempt_id)
  })
})

describe('M3-2 · 4. duas rodadas ao mesmo tempo', () => {
  it('20 linhas pendentes e duas rodadas simultâneas: 20 chamadas à Meta, cada linha uma vez', async () => {
    const { studentId, profileId } = await aluna()
    const ids: string[] = []
    for (let i = 0; i < 20; i++) ids.push(await linha('class-cancelled', profileId, cancelada(studentId), 'corrida'))

    const chamadas = metaSimulada(aceita)
    await Promise.all([
      despachar(cloudApiChannel(CONFIG), 'corrida'),
      despachar(cloudApiChannel(CONFIG), 'corrida'),
    ])

    expect(chamadas).toHaveLength(20)
    const tentativas = new Set(chamadas.map((c) => c.corpo.biz_opaque_callback_data))
    expect(tentativas.size).toBe(20)
    const linhas = await sql`
      select provider, provider_message_id, sent_at from notification_outbox where id in ${sql(ids)}`
    expect(linhas.every((l) => l.sent_at !== null && l.provider === 'meta' && l.provider_message_id)).toBe(true)
  })
})

describe('M3-2 · 4b. reserva que venceu (gate Sol S1) e reserva do e-mail (R6)', () => {
  /** Rodada A com a reserva "vencida": logo depois de A reservar, a rodada B
   *  reserva de novo a linha X (claimed_at novo) e a fecha; A segue com a cópia velha. */
  function comRodadaBNoMeio(alvo: () => string, fecharPorB: (id: string) => Promise<void>): SupabaseClient {
    return new Proxy(servico, {
      get(cliente, chave, receptor) {
        if (chave === 'rpc') {
          return async (fn: string, args?: Record<string, unknown>) => {
            const r = await cliente.rpc(fn, args)
            if (fn === 'outbox_claim_pending') {
              await sql`update notification_outbox set claimed_at = now() + interval '1 minute' where id = ${alvo()}`
              await fecharPorB(alvo())
            }
            return r
          }
        }
        return Reflect.get(cliente, chave, receptor)
      },
    })
  }

  it('WhatsApp: B enviou X com wamid; A, com a cópia velha (aula já começou), não grava "resolvido" em cima', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha(
      'class-reminder',
      profileId,
      { ...cancelada(studentId, DateTime.utc().minus({ minutes: 5 })), marco: '48h', instance_id: crypto.randomUUID() },
      'vencida',
    )
    const idDaMeta = `wamid.VENCIDA${crypto.randomUUID().replace(/-/g, '')}`
    const comB = comRodadaBNoMeio(
      () => id,
      async (x) => {
        const { error } = await servico.rpc('outbox_mark_sent', {
          p_outbox_id: x,
          p_provider: 'meta',
          p_provider_message_id: idDaMeta,
        })
        expect(error).toBeNull()
      },
    )
    await despachar(cloudApiChannel(CONFIG), 'vencida', comB)

    const e = await estado(id)
    expect(e.provider_message_id).toBe(idDaMeta)
    expect(e.error, 'A não escreveu o motivo de obsoleto em cima da linha enviada').toBeNull()
    expect(e.situacao).toBe('enviado')
  })

  it('e-mail: B já mandou X; A confere a reserva antes e não manda de novo', async () => {
    const { studentId, profileId } = await aluna()
    seq += 1
    const [r] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('email', 'class-cancelled', ${profileId}, ${sql.json(cancelada(studentId) as never)},
              ${`${PREFIXO}vencidaemail:${seq}`})
      returning id`
    const id = r.id as string
    let enviados = 0
    const comB = comRodadaBNoMeio(
      () => id,
      async (x) => {
        await sql`update notification_outbox set sent_at = now(), error = null where id = ${x}`
      },
    )
    await dispatchOutbox(
      comB,
      { email: { send: async () => ((enviados += 1), { ok: true as const }) } },
      { keyLike: `${PREFIXO}vencidaemail:%` },
    )
    expect(enviados).toBe(0)
  })

  /*
   * Gate Sol da PR #105, rodada 2 (S1): A começa a linha, trava, a reserva
   * vence (envelhecida por SQL além de 10 min) e B retoma no meio. O portão é a
   * tentativa aberta no banco (`outbox_begin_attempt`), não um SELECT: B não
   * reserva linha com tentativa em aberto, e o envio acontece uma vez só.
   */
  it('S1 · A trava no meio do envio e a reserva vence; B retoma: exatamente 1 envio pela Meta', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'travawa')
    let rodadaB = false
    const chamadas = metaSimulada(async () => {
      if (!rodadaB) {
        rodadaB = true
        await sql`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = ${id}`
        await despachar(cloudApiChannel(CONFIG), 'travawa')
      }
      return aceita()
    })
    await despachar(cloudApiChannel(CONFIG), 'travawa')
    expect(chamadas).toHaveLength(1)
    const e = await estado(id)
    expect(e.provider).toBe('meta')
    expect(e.situacao).toBe('enviado')
  })

  it('S1 · o mesmo no e-mail: A trava no meio, a reserva vence, B retoma: exatamente 1 e-mail', async () => {
    const { studentId, profileId } = await aluna()
    seq += 1
    const chave = `${PREFIXO}travaemail:${seq}`
    const [r] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('email', 'class-cancelled', ${profileId}, ${sql.json(cancelada(studentId) as never)}, ${chave})
      returning id`
    const id = r.id as string
    let enviados = 0
    let rodadaB = false
    const canal: NotificationChannel = {
      provider: 'resend',
      send: async () => {
        enviados += 1
        if (!rodadaB) {
          rodadaB = true
          await sql`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = ${id}`
          await dispatchOutbox(servico, { email: canal }, { keyLike: `${PREFIXO}travaemail:%` })
        }
        return { ok: true as const }
      },
    }
    await dispatchOutbox(servico, { email: canal }, { keyLike: `${PREFIXO}travaemail:%` })
    expect(enviados).toBe(1)
    const e = await estado(id)
    expect(e.sent_at).not.toBeNull()
    expect(e.provider).toBe('resend')
    // sem o id do Resend na resposta, o id gravado é a Idempotency-Key
    expect(e.provider_message_id).toBe(chave)
  })

  it('o canal de e-mail do ambiente passa pela tentativa (provedor resend)', () => {
    expect(canaisDoAmbiente().email?.provider).toBe('resend')
  })

  it('rodada que passou do prazo da reserva para de processar; o resto fica para a próxima', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'prazo')
    const chamadas = metaSimulada(aceita)
    const r = await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}prazo:%`,
      prazoDaReservaMs: 0,
    })
    expect(r.processed).toBe(0)
    expect(chamadas).toHaveLength(0)
    const e = await estado(id)
    expect(e.sent_at).toBeNull()
    expect(e.error).toBeNull()
  })

  it('a reserva da M3-1 dá conjuntos disjuntos também no e-mail: 20 linhas e duas rodadas ao mesmo tempo, 20 envios', async () => {
    const { studentId, profileId } = await aluna()
    for (let i = 0; i < 20; i++) {
      seq += 1
      await sql`
        insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
        values ('email', 'class-cancelled', ${profileId}, ${sql.json(cancelada(studentId) as never)},
                ${`${PREFIXO}corridaemail:${seq}`})`
    }
    const enviados: string[] = []
    const canal = {
      send: async (m: { idempotencyKey?: string }) => {
        enviados.push(String(m.idempotencyKey))
        await new Promise((ok) => setTimeout(ok, 5))
        return { ok: true as const }
      },
    }
    await Promise.all([
      dispatchOutbox(servico, { email: canal }, { keyLike: `${PREFIXO}corridaemail:%` }),
      dispatchOutbox(servico, { email: canal }, { keyLike: `${PREFIXO}corridaemail:%` }),
    ])
    expect(enviados).toHaveLength(20)
    expect(new Set(enviados).size).toBe(20)
  })
})

describe('M3-2 · 5. o template certo para cada aviso', () => {
  it('chave sem template na Meta (digest de conteúdo) fica presa com o motivo, sem chamar a Meta', async () => {
    const { profileId } = await aluna()
    const id = await linha('content-digest', profileId, { semana: '2026-W44', novas: 3 }, 'semtpl')

    const chamadas = metaSimulada(aceita)
    await despachar(cloudApiChannel(CONFIG), 'semtpl')

    expect(chamadas).toHaveLength(0)
    const e = await estado(id)
    expect(e.sent_at).toBeNull()
    expect(e.error).toMatch(/sem template na Meta/)
    expect(e.error, 'chave interna fica no log').not.toContain('content-digest')
    expect(e.situacao).toBe('preso')
  })

  it('a professora remarcou (moved_by = teacher): sai o template "a escola moveu", com a aula original e a nova', async () => {
    const { studentId, profileId } = await aluna()
    const c = await createPrivateContract(sql, { studentId })
    const original = DateTime.utc().plus({ days: 3 }).set({ hour: 13, minute: 0, second: 0, millisecond: 0 })
    const nova = original.plus({ days: 1, hours: 2 })
    const idOriginal = await createInstanceAt(sql, c, original.toISO()!)
    const idNova = await createInstanceAt(sql, c, nova.toISO()!)
    await sql`update class_instances set reschedule_of = ${idOriginal} where id = ${idNova}`
    const id = await linha(
      'reschedule-confirm',
      profileId,
      {
        instance_id: idNova,
        student_id: studentId,
        starts_at_utc: nova.toISO(),
        local_time_snapshot: 'fixture',
        iana_tz: 'America/Sao_Paulo',
        teacher_name: 'Teacher Ana',
        moved_by: 'teacher',
      },
      'moveu',
    )

    const chamadas = metaSimulada(aceita)
    await despachar(cloudApiChannel(CONFIG), 'moveu')

    expect(chamadas).toHaveLength(1)
    const tpl = chamadas[0].corpo.template as {
      name: string
      components: { parameters: { text: string }[] }[]
    }
    expect(tpl.name).toBe('reschedule_confirm_escola_moveu')
    const sp = (d: DateTime) => d.setZone('America/Sao_Paulo')
    expect(tpl.components[0].parameters.map((p) => p.text)).toEqual([
      'Marina',
      // sem "Teacher" no corpo deste template: o nome entra como está
      'Teacher Ana',
      sp(original).toFormat('dd/LL'),
      sp(original).toFormat('HH:mm'),
      sp(nova).toFormat('dd/LL'),
      sp(nova).toFormat('HH:mm'),
      'São Paulo', // o nome humano da tela, não o pedaço do IANA
    ])
    expect((await estado(id)).provider).toBe('meta')
  })

  it('template com rodapé e sem o número de atendimento na configuração: presa com o motivo, nada sai', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'semrodape')
    const chamadas = metaSimulada(aceita)
    await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}semrodape:%`,
      atendimentoUrl: null,
    })
    expect(chamadas).toHaveLength(0)
    const e = await estado(id)
    expect(e.sent_at).toBeNull()
    expect(e.error).toMatch(/falta o número de atendimento da escola/)
    expect(e.error).not.toContain('WHATSAPP_')
  })

  it('o aluno que remarcou continua recebendo o template de remarcação', async () => {
    const { studentId, profileId } = await aluna()
    await linha(
      'reschedule-confirm',
      profileId,
      { ...cancelada(studentId), kind: 'reschedule', moved_by: 'student' },
      'aluno',
    )
    const chamadas = metaSimulada(aceita)
    await despachar(cloudApiChannel(CONFIG), 'aluno')
    expect((chamadas[0].corpo.template as { name: string }).name).toBe('reschedule_confirm_remarcacao')
  })
})

describe('M3-2 · 6. recusa da Meta', () => {
  it('4xx: o motivo da Meta vai para a linha, a tentativa fecha, e o token não aparece no motivo nem no log', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'recusa')

    const logs: string[] = []
    for (const nivel of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
    const chamadas = metaSimulada(() => json(fixture('send-template-error.json'), 400))
    await despachar(cloudApiChannel(CONFIG), 'recusa')

    expect(chamadas).toHaveLength(1)
    const e = await estado(id)
    expect(e.sent_at).toBeNull()
    expect(e.attempt_id, 'recusa definitiva fecha a tentativa').toBeNull()
    expect(e.error).toContain('Template name does not exist in the translation')
    expect(e.error).toContain('132001')
    expect(e.error).toContain('a Meta recusou o envio (HTTP 400, código 132001)')
    expect(e.situacao).toBe('preso')
    expect(e.error).not.toContain(TOKEN)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('5xx: resultado incerto, a linha fica presa e não volta para a fila', async () => {
    const { studentId, profileId } = await aluna()
    const id = await linha('class-cancelled', profileId, cancelada(studentId), 'cincoxx')
    metaSimulada(() => json({ error: { message: 'Service temporarily unavailable', code: 2 } }, 503))
    await despachar(cloudApiChannel(CONFIG), 'cincoxx')

    const e = await estado(id)
    expect(e.attempt_id).not.toBeNull()
    expect(e.error).toMatch(/^resultado incerto: a Meta falhou ao responder \(HTTP 503/)

    vi.unstubAllGlobals()
    const segunda = metaSimulada(aceita)
    await despachar(cloudApiChannel(CONFIG), 'cincoxx')
    expect(segunda).toHaveLength(0)
  })
})

describe('M3-2 · 6b. falha de rede no driver', () => {
  it('timeout depois de enviar é incerto; conexão recusada antes de abrir é definitiva', async () => {
    const tpl = { name: 'briefing_reminder', params: ['Marina', 'https://wa.me/5565900000001'] }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const timeout = await cloudApiChannel(CONFIG).send({ to: '+5565900000001', template: tpl })
    expect(timeout).toMatchObject({ ok: false, incerto: true, error: 'a Meta não respondeu em 10 s' })

    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    const recusada = await cloudApiChannel(CONFIG).send({ to: '+5565900000001', template: tpl })
    expect(recusada).toEqual({ ok: false, error: 'sem conexão com a Meta' })

    // rede fora do ar ou tempo de conectar estourado: também nunca chegou à Meta
    for (const code of ['ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      vi.stubGlobal('fetch', async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code } })
      })
      const r = await cloudApiChannel(CONFIG).send({ to: '+5565900000001', template: tpl })
      expect(r, code).not.toHaveProperty('incerto')
    }
    // conexão caída no meio: pode ter saído
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    })
    expect(await cloudApiChannel(CONFIG).send({ to: '+5565900000001', template: tpl })).toMatchObject({ incerto: true })
  })
})

describe('M3-2 · 7. número e registro de canais', () => {
  it('o número vai em dígitos, sem o "+" do armazenamento', async () => {
    const chamadas = metaSimulada(aceita)
    const r = await cloudApiChannel(CONFIG).send({
      to: '+5565900000001',
      template: { name: 'briefing_reminder', params: ['Marina', 'https://wa.me/5565900000001'] },
    })
    expect(r.ok).toBe(true)
    expect(chamadas[0].corpo.to).toBe('5565900000001')
  })

  it('pino: nenhum `evolutionChannel` em src/app, e os pontos de despacho usam canaisDoAmbiente()', () => {
    const arquivos: string[] = []
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome)
        if (statSync(p).isDirectory()) varrer(p)
        else if (/\.(ts|tsx)$/.test(nome)) arquivos.push(p)
      }
    }
    varrer(join(process.cwd(), 'src/app'))
    const comEvolution = arquivos.filter((p) => readFileSync(p, 'utf8').includes('evolutionChannel'))
    expect(comEvolution).toEqual([])

    // cada chamada do despachante nas actions passa o registro único
    const pontos = arquivos.flatMap((p) =>
      readFileSync(p, 'utf8')
        .split('\n')
        .filter((l) => l.includes('dispatchOutbox(') && !/^\s*(\/\/|\*)/.test(l))
        .map((l) => [p, l] as const),
    )
    expect(pontos.length).toBeGreaterThanOrEqual(8)
    for (const [p, chamada] of pontos) expect(chamada, p).toContain('canaisDoAmbiente())')

    const rota = readFileSync(join(process.cwd(), 'src/app/api/jobs/dispatch-outbox/route.ts'), 'utf8')
    expect(rota).toContain('channels: canaisDoAmbiente()')
  })
})
