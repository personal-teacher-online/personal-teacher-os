// #115 — botões de link nos templates de WhatsApp, prazo de remarcar no toque
// de 48 h e a escolha da variante pelo despachante.
//
// O que se prova, na ordem dos critérios da issue:
//   1. o POST à Meta leva `components` com o `body` e um `button` por botão
//      (`sub_type: 'url'`, `index` "0"/"1", parâmetro `text` = sufixo); sem
//      botão, só o `body`; sufixo vazio ou com espaço é erro ANTES do POST.
//      Desde a revisão da PR #117 todo template tem botão (o encontro sem sala
//      do Meet ganhou "Falar com a gente"), então o "só body" se prova no corpo
//      do envio montado sem botões;
//   2. sem o número de atendimento, o template com o botão "Falar com a gente"
//      fica preso com o motivo (fail-closed), não sai sem o botão;
//   3. o `{prazo}` é o início da aula MENOS o aviso mínimo DO CONTRATO
//      (aritmética de INSTANTE, Lei 1), escrito no fuso da aluna — Cuiabá e
//      Lisboa, inclusive na noite em que Lisboa recua o relógio; sem o aviso
//      mínimo, prazo desconhecido;
//   4. a variante de 48 h é escolhida pelo instante do envio contra o prazo:
//      amanhã com prazo, amanhã sem prazo, hoje;
//   5. sala fora do Google Meet cai na variante sem botão de sala, com nota
//      para o log; sala do Meet vira o código da sala no botão;
//   6. no despacho real, o botão da aula leva o link que entra logado no
//      formato de caminho (`wa/<hash>/aula/<id>`);
//   7. (#116) o aviso de crédito vencendo também entra logado: o botão "Usar
//      meu crédito" leva `wa/<hash>/creditos`; falha na geração do link não
//      trava o envio (cai em `portal/creditos`); o e-mail do mesmo aviso não
//      gera link (ADR-014).
//
// Régua da casa: arquivos rodam em PARALELO no mesmo banco. As linhas daqui
// nascem com a chave `m3b:<rodada>:…` e todo despacho é recortado por ela.
import { DateTime } from 'luxon'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { OutboundMessage } from '@/lib/notify/channel'
import { cloudApiChannel, corpoDoEnvio } from '@/lib/notify/cloud-api'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { whatsappDoAviso, type FatosDoAviso } from '@/lib/outbox/whatsapp-do-aviso'
import { POLICY } from '@/lib/policy'
import { createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createInstanceAt,
  createPrivateContract,
  createStudent,
  daysFromToday,
  proximoRecuo,
} from './helpers/db'

const RODADA = crypto.randomUUID().slice(0, 8)
const PREFIXO = `m3b:${RODADA}:`
const CONFIG = { token: 'token-de-teste-da-meta-botoes', phoneNumberId: '100000000000002' }
const ATENDIMENTO = 'https://wa.me/5565900000001'
const AULA_ID = '00000000-0000-0000-0000-0000000000aa'

let sql: Sql
let servico: SupabaseClient

beforeAll(async () => {
  sql = connect(2)
  servico = serviceClient()
})
afterAll(async () => {
  await sql`
    update notification_outbox
       set sent_at = now(), error = coalesce(error, 'fim do teste m3-cloud-api-botoes')
     where dedupe_key like ${PREFIXO + '%'} and sent_at is null and attempt_id is null`
  await sql.end()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

interface ChamadaDaMeta {
  url: string
  corpo: { template: { name: string; components: Record<string, unknown>[] } } & Record<string, unknown>
}

function metaSimulada(): ChamadaDaMeta[] {
  const chamadas: ChamadaDaMeta[] = []
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada)
    if (!url.startsWith('https://graph.facebook.com/')) return original(entrada, init)
    chamadas.push({ url, corpo: JSON.parse(String(init?.body)) as ChamadaDaMeta['corpo'] })
    return new Response(JSON.stringify({ messages: [{ id: `wamid.botoes.${crypto.randomUUID()}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return chamadas
}

const fatos = (agora: DateTime, extra: Partial<FatosDoAviso> = {}): FatosDoAviso => ({
  nome: 'Marina',
  atendimentoUrl: ATENDIMENTO,
  agora: agora.toJSDate(),
  ...extra,
})

/** O payload do toque de 48 h que o banco enfileira, para uma aula num instante,
 *  com o aviso mínimo do contrato que o despachante acrescenta (24 h, padrão). */
const toque48 = (inicio: DateTime, tz: string, minNoticeHours: number | null = 24) => ({
  marco: '48h',
  min_notice_hours: minNoticeHours,
  instance_id: AULA_ID,
  starts_at_utc: inicio.toUTC().toISO(),
  iana_tz: tz,
  local_time_snapshot: inicio.setZone(tz).toFormat('HH:mm'),
  teacher_name: 'Teacher Vicky',
})

const longo = (dt: DateTime, tz: string) => dt.setZone(tz).setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")

/** A próxima quinta-feira às 09:00 no fuso, pelo menos 3 dias à frente. */
function proximaQuinta(tz: string): DateTime {
  let d = DateTime.now().setZone(tz).plus({ days: 3 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
  while (d.weekday !== 4) d = d.plus({ days: 1 })
  return d
}

/* ========================================================================== */

describe('#115 · 1. o POST à Meta leva um componente button por botão', () => {
  it('corpoDoEnvio: body e os botões com index em texto, sub_type url e o sufixo', () => {
    const msg: OutboundMessage & { template: NonNullable<OutboundMessage['template']> } = {
      to: '+5565900000001',
      template: { name: 'class_reminder_48h_amanha', params: ['Marina'], botoes: ['portal/aula/x', '5565900000001'] },
    }
    const comps = corpoDoEnvio(msg).template.components
    expect(comps).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Marina' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'portal/aula/x' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: '5565900000001' }] },
    ])
    const sem = corpoDoEnvio({ ...msg, template: { name: 'meeting_reminder_sem_link', params: ['Marina'] } })
    expect(sem.template.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Marina' }] }])
  })

  it('driver: class_reminder_48h_amanha sai com body e dois botões; o encontro sem sala, com "Falar com a gente"', async () => {
    const agora = DateTime.now().setZone('America/Cuiaba').plus({ days: 30 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
    const amanha = agora.plus({ days: 1 }).set({ hour: 20 })
    const lembrete = whatsappDoAviso('class-reminder', toque48(amanha, 'America/Cuiaba'), fatos(agora))
    if (!lembrete.ok) throw new Error(lembrete.motivo)
    expect(lembrete.template.nome).toBe('class_reminder_48h_amanha')

    const encontro = whatsappDoAviso(
      'meeting-reminder',
      { starts_at_utc: amanha.toUTC().toISO(), iana_tz: 'America/Cuiaba', local_time_snapshot: '20:00' },
      fatos(agora),
    )
    if (!encontro.ok) throw new Error(encontro.motivo)
    expect(encontro.template.nome).toBe('meeting_reminder_sem_link')

    const chamadas = metaSimulada()
    const canal = cloudApiChannel(CONFIG)
    for (const a of [lembrete, encontro]) {
      const r = await canal.send({
        to: '+5565900000001',
        template: { name: a.template.nome, params: a.params, botoes: a.botoes },
      })
      expect(r.ok, a.template.nome).toBe(true)
    }
    expect(chamadas).toHaveLength(2)
    const [comLembrete, comEncontro] = chamadas.map((c) => c.corpo.template.components)
    expect(comLembrete[0].type).toBe('body')
    expect(comLembrete.slice(1)).toEqual([
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: `portal/aula/${AULA_ID}` }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: '5565900000001' }] },
    ])
    expect(comEncontro[0].type).toBe('body')
    expect(comEncontro.slice(1)).toEqual([
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '5565900000001' }] },
    ])
  })

  it('sufixo de botão vazio ou com espaço: erro antes do POST, a Meta não é chamada', async () => {
    const chamadas = metaSimulada()
    const canal = cloudApiChannel(CONFIG)
    for (const ruim of ['', 'portal/ aula', 'a\nb']) {
      const r = await canal.send({
        to: '+5565900000001',
        template: { name: 'credit_expiry_um', params: ['Marina', '12/02/2031'], botoes: ['portal/creditos', ruim] },
      })
      expect(r.ok, JSON.stringify(ruim)).toBe(false)
      if (!r.ok) {
        expect(r.error).toMatch(/botão/)
        expect(r.incerto).toBeUndefined()
      }
    }
    expect(chamadas).toHaveLength(0)
  })
})

describe('#115 · 2. sem o número de atendimento, o botão "Falar com a gente" prende a linha', () => {
  it('crédito vencendo (que antes não pedia o número): preso com motivo, sem sair sem o botão', () => {
    const r = whatsappDoAviso(
      'credit-expiry',
      { n_credits: 1, expires_on: '2031-02-12' },
      fatos(DateTime.now(), { atendimentoUrl: null }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivo).toMatch(/falta o número de atendimento da escola/)
      expect(r.motivo).not.toContain('WHATSAPP_')
    }
  })

  it('no despacho: a linha fica pendente com o motivo e a Meta não é chamada', async () => {
    const studentId = await createStudent(sql)
    const profileId = await createAuthUser(sql, 'student', 'Aluna botões')
    await sql`update students set profile_id = ${profileId} where id = ${studentId}`
    const [linha] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('whatsapp', 'class-cancelled', ${profileId},
              ${sql.json({
                student_id: studentId,
                starts_at_utc: DateTime.utc().plus({ days: 2 }).toISO(),
                iana_tz: 'America/Sao_Paulo',
                local_time_snapshot: 'fixture',
                teacher_name: 'Teacher Ana',
                credited: true,
                expires_on: '2031-02-12',
              } as never)},
              ${`${PREFIXO}semnumero:1`})
      returning id`
    const chamadas = metaSimulada()
    await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}semnumero:%`,
      atendimentoUrl: null,
    })
    expect(chamadas).toHaveLength(0)
    const [l] = await sql`select sent_at, error, attempt_id from notification_outbox where id = ${linha.id}`
    expect(l.sent_at).toBeNull()
    expect(l.attempt_id).toBeNull()
    expect(l.error).toMatch(/falta o número de atendimento da escola/)
  })
})

describe('#115 · 3. o prazo de remarcar no fuso da aluna (Lei 1)', () => {
  function prazoDe(inicio: DateTime, tz: string, agora = inicio.minus({ days: 3 })): string {
    const r = whatsappDoAviso('class-reminder', toque48(inicio, tz), fatos(agora))
    if (!r.ok) throw new Error(r.motivo)
    expect(r.template.nome).toBe('class_reminder_48h_data')
    const i = r.template.parametros.findIndex((p) => p.nome === 'prazo')
    expect(i, 'o template de 48 h com data tem o parâmetro do prazo').toBeGreaterThanOrEqual(0)
    return r.params[i]
  }

  it('o aviso mínimo lido é o da política da escola', () => {
    expect(POLICY.minNotice).toBe(24)
  })

  it('aula às 09:00 de quinta: o prazo é quarta às 09:00, em Cuiabá e em Lisboa', () => {
    for (const tz of ['America/Cuiaba', 'Europe/Lisbon']) {
      const quinta = proximaQuinta(tz)
      const quarta = quinta.minus({ days: 1 })
      // a semana escolhida não atravessa virada de relógio (senão o caso é o de baixo)
      if (quinta.offset !== quarta.offset) continue
      const prazo = prazoDe(quinta, tz)
      expect(prazo, tz).toBe(longo(quarta, tz))
      expect(prazo, tz).toMatch(/^quarta-feira, \d{2}\/\d{2} às 09:00$/)
    }
  })

  it('Lisboa recua o relógio: o prazo é o INSTANTE 24 h antes, escrito no fuso dela', () => {
    const tz = 'Europe/Lisbon'
    const recuo = proximoRecuo(tz) // o dia em que o relógio volta de 02:00 para 01:00
    // Aula às 09:00 do próprio dia do recuo: 24 h antes, o relógio ainda estava
    // adiantado, então a véspera mostra 10:00 — é o que o banco aplica
    // (`starts_at_utc - make_interval(hours => 24)`), nunca "09:00 da véspera".
    const noDia = recuo.set({ hour: 9, minute: 0 })
    const prazoNoDia = prazoDe(noDia, tz)
    expect(prazoNoDia).toBe(longo(noDia.minus({ days: 1 }).set({ hour: 10 }), tz))
    expect(DateTime.fromMillis(noDia.toMillis() - 24 * 3_600_000).setZone(tz).toFormat('HH:mm')).toBe('10:00')
    // Aula às 09:00 do dia seguinte: as 24 h já estão do mesmo lado da virada.
    const depois = recuo.plus({ days: 1 }).set({ hour: 9, minute: 0 })
    expect(prazoDe(depois, tz)).toBe(longo(recuo.set({ hour: 9, minute: 0 }), tz))
    // Cuiabá não tem horário de verão: no mesmo dia, sempre 09:00 da véspera.
    const cuiaba = DateTime.fromObject(
      { year: recuo.year, month: recuo.month, day: recuo.day, hour: 9 },
      { zone: 'America/Cuiaba' },
    )
    expect(prazoDe(cuiaba, 'America/Cuiaba')).toBe(longo(cuiaba.minus({ days: 1 }), 'America/Cuiaba'))
  })
})

describe('#115 · 4. a variante de 48 h pelo instante do envio contra o prazo', () => {
  const tz = 'America/Cuiaba'
  const dia = DateTime.now().setZone(tz).plus({ days: 30 }).startOf('day')

  function variante(inicio: DateTime, agora: DateTime) {
    const r = whatsappDoAviso('class-reminder', toque48(inicio, tz), fatos(agora))
    if (!r.ok) throw new Error(r.motivo)
    return r
  }

  it('amanhã com o prazo pela frente: a linha do prazo', () => {
    const r = variante(dia.plus({ days: 1 }).set({ hour: 23 }), dia.set({ hour: 17 }))
    expect(r.template.nome).toBe('class_reminder_48h_amanha')
    expect(r.texto).toContain(`Dá para remarcar até *${longo(dia.set({ hour: 23 }), tz)}*.`)
  })

  it('amanhã com o prazo já vencido: o template sem prazo, com o atendimento', () => {
    // aula criada hoje às 13:00 para amanhã às 09:00: o prazo foi hoje às 09:00
    const r = variante(dia.plus({ days: 1 }).set({ hour: 9 }), dia.set({ hour: 13 }))
    expect(r.template.nome).toBe('class_reminder_48h_amanha_sem_prazo')
    expect(r.texto).not.toContain('remarcar')
    expect(r.texto).toContain('Imprevisto? Fale com a gente.')
    expect(r.template.parametros.map((p) => p.nome)).not.toContain('prazo')
  })

  it('a fronteira é a do banco: no instante exato do prazo ainda dá; um minuto depois, não', () => {
    // reschedule_class recusa só quando `now() > starts_at_utc - aviso mínimo`
    const inicio = dia.plus({ days: 1 }).set({ hour: 9 })
    const noPrazo = variante(inicio, inicio.minus({ hours: POLICY.minNotice }))
    expect(noPrazo.template.nome).toBe('class_reminder_48h_amanha')
    const umMinutoDepois = variante(inicio, inicio.minus({ hours: POLICY.minNotice }).plus({ minutes: 1 }))
    expect(umMinutoDepois.template.nome).toBe('class_reminder_48h_amanha_sem_prazo')
  })

  it('aviso mínimo do contrato desconhecido: amanhã sai sem prazo; a dois dias ou mais, fica preso com o motivo', () => {
    const amanha = whatsappDoAviso('class-reminder', toque48(dia.plus({ days: 1 }).set({ hour: 23 }), tz, null), fatos(dia.set({ hour: 17 })))
    if (!amanha.ok) throw new Error(amanha.motivo)
    expect(amanha.template.nome).toBe('class_reminder_48h_amanha_sem_prazo')
    const longe = whatsappDoAviso('class-reminder', toque48(dia.plus({ days: 3 }).set({ hour: 9 }), tz, null), fatos(dia))
    expect(longe.ok).toBe(false)
    if (!longe.ok) expect(longe.motivo).toMatch(/falta o aviso mínimo do contrato/)
  })

  it('o prazo segue o aviso mínimo DO CONTRATO, não uma constante', () => {
    const inicio = dia.plus({ days: 3 }).set({ hour: 9 })
    const r = whatsappDoAviso('class-reminder', toque48(inicio, tz, 48), fatos(dia))
    if (!r.ok) throw new Error(r.motivo)
    expect(r.texto).toContain(`Dá para remarcar até *${longo(inicio.minus({ hours: 48 }), tz)}*.`)
  })

  it('hoje: sempre sem a linha do prazo', () => {
    const r = variante(dia.set({ hour: 20 }), dia.set({ hour: 8 }))
    expect(r.template.nome).toBe('class_reminder_48h_hoje')
    expect(r.texto).not.toContain('remarcar')
  })

  it('o botão da aula usa o link que entra logado quando ele existe, e o caminho comum quando não', () => {
    const inicio = dia.plus({ days: 3 }).set({ hour: 9 })
    const comum = variante(inicio, dia)
    expect(comum.botoes).toEqual([`portal/aula/${AULA_ID}`, '5565900000001'])
    const logado = whatsappDoAviso(
      'class-reminder',
      { ...toque48(inicio, tz), caminho_logado: `wa/abc123/aula/${AULA_ID}` },
      fatos(dia),
    )
    if (!logado.ok) throw new Error(logado.motivo)
    expect(logado.botoes).toEqual([`wa/abc123/aula/${AULA_ID}`, '5565900000001'])
  })
})

describe('#115 · 5. a sala do toque de 2 h', () => {
  const tz = 'America/Cuiaba'
  const agora = DateTime.now().setZone(tz).plus({ days: 30 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
  const toque2 = (meet: string | null) => ({
    marco: '2h',
    instance_id: AULA_ID,
    starts_at_utc: agora.plus({ hours: 2 }).toUTC().toISO(),
    iana_tz: tz,
    local_time_snapshot: '20:00',
    teacher_name: 'Teacher Vicky',
    meet_url: meet,
  })

  it('sala do Google Meet: o botão leva o código da sala', () => {
    const r = whatsappDoAviso('class-reminder', toque2('https://meet.google.com/abc-defg-hij?authuser=0'), fatos(agora))
    if (!r.ok) throw new Error(r.motivo)
    expect(r.template.nome).toBe('class_reminder_2h_com_link')
    expect(r.botoes).toEqual(['abc-defg-hij', `portal/aula/${AULA_ID}`])
    expect(r.observacao).toBeNull()
  })

  it('sala fora do Meet: variante sem botão de sala, com nota para o log', () => {
    const r = whatsappDoAviso('class-reminder', toque2('https://zoom.exemplo.com/j/123'), fatos(agora))
    if (!r.ok) throw new Error(r.motivo)
    expect(r.template.nome).toBe('class_reminder_2h_sem_link')
    expect(r.botoes).toEqual([`portal/aula/${AULA_ID}`, '5565900000001'])
    expect(r.observacao).toMatch(/não é do Google Meet/)
  })

  it('o toque de 48 h, que nunca teve botão de sala, não acusa a sala fora do Meet no log', () => {
    const r = whatsappDoAviso(
      'class-reminder',
      {
        ...toque2('https://zoom.exemplo.com/j/123'),
        marco: '48h',
        min_notice_hours: 24,
        starts_at_utc: agora.plus({ days: 3 }).toUTC().toISO(),
      },
      fatos(agora),
    )
    if (!r.ok) throw new Error(r.motivo)
    expect(r.template.nome).toBe('class_reminder_48h_data')
    expect(r.observacao).toBeNull()
  })

  it('o mesmo vale para o encontro de mentoria', () => {
    const encontro = (meet: string) => ({
      starts_at_utc: agora.plus({ days: 1 }).toUTC().toISO(),
      iana_tz: tz,
      local_time_snapshot: '18:00',
      meet_url: meet,
    })
    const meet = whatsappDoAviso('meeting-reminder', encontro('https://meet.google.com/abc-defg-hij'), fatos(agora))
    const fora = whatsappDoAviso('meeting-reminder', encontro('https://zoom.exemplo.com/j/123'), fatos(agora))
    if (!meet.ok || !fora.ok) throw new Error('aviso não montou')
    expect(meet.template.nome).toBe('meeting_reminder_com_link')
    expect(meet.botoes).toEqual(['abc-defg-hij'])
    expect(fora.template.nome).toBe('meeting_reminder_sem_link')
    // revisão da PR #117: sem sala do Meet, a saída é o atendimento — frase
    // verdadeira com a sessão lotada (a tela não mostra o link) e sem link
    expect(fora.botoes).toEqual(['5565900000001'])
    expect(fora.texto).toContain('Qualquer dúvida sobre a sala, fale com a gente.')
    expect(fora.texto).not.toContain('portal')
  })
})

describe('#115 · 6. no despacho real, o botão da aula entra logado pelo caminho', () => {
  it('toque de 48 h: o botão 0 é wa/<hash>/aula/<id>, o 1 é o atendimento; o prazo vem do contrato', async () => {
    // contrato com aviso mínimo de 12 h: o prazo mostrado é o que o banco aplica
    const c = await createPrivateContract(sql, { tz: 'America/Sao_Paulo', minNotice: 12 })
    const profileId = await createAuthUser(sql, 'student', 'Aluna botões logado')
    await sql`update students set profile_id = ${profileId} where id = ${c.studentId}`
    const inicio = DateTime.utc().plus({ days: 3 }).startOf('minute')
    const instancia = await createInstanceAt(sql, c, inicio.toISO()!)
    await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('whatsapp', 'class-reminder', ${profileId},
              ${sql.json({ ...toque48(inicio, 'America/Sao_Paulo', null), instance_id: instancia, student_id: c.studentId } as never)},
              ${`${PREFIXO}logado:1`})`
    const chamadas = metaSimulada()
    await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}logado:%`,
      // 15:00 UTC = meio-dia em São Paulo: fora do silêncio
      now: new Date(new Date().setUTCHours(15, 0, 0, 0)),
      atendimentoUrl: ATENDIMENTO,
    })
    expect(chamadas).toHaveLength(1)
    const botoes = chamadas[0].corpo.template.components.filter((x) => x.type === 'button') as {
      index: string
      parameters: { text: string }[]
    }[]
    expect(botoes.map((b) => b.index)).toEqual(['0', '1'])
    expect(botoes[0].parameters[0].text).toMatch(new RegExp(`^wa/[0-9a-f]+/aula/${instancia}$`))
    expect(botoes[1].parameters[0].text).toBe('5565900000001')
    // o payload do banco não traz o aviso mínimo: o despachante o lê do contrato
    const corpo = chamadas[0].corpo.template.components[0] as { parameters: { text: string }[] }
    expect(corpo.parameters.map((p) => p.text)).toContain(longo(inicio.minus({ hours: 12 }), 'America/Sao_Paulo'))
  })
})

describe('#116 · 7. o aviso de crédito vencendo entra logado na tela de créditos', () => {
  const credito = { n_credits: 1, expires_on: '2031-02-12' }

  it('o botão "Usar meu crédito" usa o link logado quando ele existe, e o caminho comum quando não', () => {
    const comum = whatsappDoAviso('credit-expiry', credito, fatos(DateTime.now()))
    if (!comum.ok) throw new Error(comum.motivo)
    expect(comum.botoes).toEqual(['portal/creditos', '5565900000001'])
    const logado = whatsappDoAviso('credit-expiry', { ...credito, caminho_logado: 'wa/abc123/creditos' }, fatos(DateTime.now()))
    if (!logado.ok) throw new Error(logado.motivo)
    expect(logado.botoes).toEqual(['wa/abc123/creditos', '5565900000001'])
  })

  it('o link logado é do aviso que o pediu: o cancelamento com crédito segue no caminho comum', () => {
    const r = whatsappDoAviso(
      'class-cancelled',
      {
        starts_at_utc: DateTime.utc().plus({ days: 2 }).toISO(),
        iana_tz: 'America/Sao_Paulo',
        local_time_snapshot: '09:00',
        teacher_name: 'Teacher Ana',
        credited: true,
        expires_on: '2031-02-12',
        caminho_logado: 'wa/abc123/creditos',
      },
      fatos(DateTime.now()),
    )
    if (!r.ok) throw new Error(r.motivo)
    expect(r.botoes).toEqual(['portal/creditos', '5565900000001'])
  })

  /** Uma aluna com login (e-mail e WhatsApp) e uma linha de crédito vencendo no canal. */
  async function linhaDeCredito(canal: 'whatsapp' | 'email', rotulo: string): Promise<string> {
    const studentId = await createStudent(sql)
    const profileId = await createAuthUser(sql, 'student', 'Aluna crédito logado')
    await sql`update students set profile_id = ${profileId} where id = ${studentId}`
    const [linha] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (${canal}, 'credit-expiry', ${profileId},
              ${sql.json({ student_id: studentId, expires_on: daysFromToday(30), marco: 30, n_credits: 1 })},
              ${`${PREFIXO}credito:${rotulo}`})
      returning id`
    return linha.id as string
  }

  // 15:00 UTC = meio-dia no Brasil: fora do silêncio do aviso de lote
  const MEIO_DIA = () => new Date(new Date().setUTCHours(15, 0, 0, 0))

  const botoesDe = (chamada: ChamadaDaMeta) =>
    (chamada.corpo.template.components.filter((x) => x.type === 'button') as { parameters: { text: string }[] }[]).map(
      (b) => b.parameters[0].text,
    )

  it('no despacho real por WhatsApp: o botão 0 é wa/<hash>/creditos e o link é gerado por mensagem', async () => {
    const id = await linhaDeCredito('whatsapp', 'logado')
    const gerar = vi.spyOn(servico.auth.admin, 'generateLink')
    const chamadas = metaSimulada()
    await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
      keyLike: `${PREFIXO}credito:logado`,
      now: MEIO_DIA(),
      atendimentoUrl: ATENDIMENTO,
    })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].corpo.template.name).toBe('credit_expiry_um')
    const [credito, atendimento] = botoesDe(chamadas[0])
    expect(credito).toMatch(/^wa\/[0-9a-f]+\/creditos$/)
    expect(atendimento).toBe('5565900000001')
    expect(gerar).toHaveBeenCalledTimes(1)
    expect(gerar.mock.calls[0][0]).toMatchObject({ type: 'magiclink' })
    const [l] = await sql`select sent_at, error from notification_outbox where id = ${id}`
    expect(l.sent_at).not.toBeNull()
    expect(l.error).toBeNull()
  })

  it('a geração do link falhando (exceção ou erro do GoTrue) não trava o envio: o botão cai em portal/creditos', async () => {
    const falhas = [
      () => vi.spyOn(servico.auth.admin, 'generateLink').mockRejectedValueOnce(new Error('GoTrue fora')),
      () =>
        vi.spyOn(servico.auth.admin, 'generateLink').mockResolvedValueOnce({
          data: { properties: null, user: null },
          error: new Error('GoTrue recusou'),
        } as never),
    ]
    for (const [i, falhar] of falhas.entries()) {
      const id = await linhaDeCredito('whatsapp', `falha${i}`)
      falhar()
      const chamadas = metaSimulada()
      await dispatchOutbox(servico, { whatsapp: cloudApiChannel(CONFIG) }, {
        keyLike: `${PREFIXO}credito:falha${i}`,
        now: MEIO_DIA(),
        atendimentoUrl: ATENDIMENTO,
      })
      expect(chamadas, `falha ${i}`).toHaveLength(1)
      expect(botoesDe(chamadas[0])).toEqual(['portal/creditos', '5565900000001'])
      const [l] = await sql`select sent_at, error from notification_outbox where id = ${id}`
      expect(l.sent_at).not.toBeNull()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('por e-mail o mesmo aviso não gera link logado (ADR-014)', async () => {
    const id = await linhaDeCredito('email', 'email')
    const gerar = vi.spyOn(servico.auth.admin, 'generateLink')
    const enviados: OutboundMessage[] = []
    await dispatchOutbox(
      servico,
      {
        email: {
          send: async (m: OutboundMessage) => {
            enviados.push(m)
            return { ok: true as const }
          },
        },
      },
      { keyLike: `${PREFIXO}credito:email`, now: MEIO_DIA() },
    )
    expect(enviados).toHaveLength(1)
    expect(gerar).not.toHaveBeenCalled()
    expect(enviados[0].html).not.toContain('/wa/')
    const [l] = await sql`select sent_at from notification_outbox where id = ${id}`
    expect(l.sent_at).not.toBeNull()
  })
})
