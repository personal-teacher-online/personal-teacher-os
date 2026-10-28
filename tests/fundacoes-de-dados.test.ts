// Lote "Fundações de dados" (26/07) + rodada de CORREÇÃO da revisão
// adversarial: admin_kpis + kpi_snapshots, política versionada com aceite que
// PROVA o texto, ui_events, client_errors com balde por pessoa, redação de PII,
// corpo capado, gate por igualdade e rate-limit particionado.
// O que se prova aqui é o que NÃO se reconstrói depois — por isso a suíte cobre
// portão de papel, RLS negar-por-padrão, append-only e dedupe.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql, TransactionSql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
  julgadaDepois,
} from './helpers/db'
import {
  anonBucketKey,
  BEACON_MAX_BYTES,
  CLIENT_ERROR_MAX_BYTES,
  createClientErrorGate,
  createKeyedRateLimiter,
  errorHash,
  handleBeacon,
  handleClientError,
  normalizeMessage,
  normalizePath,
  readCappedBody,
  redactPii,
  type TelemetrySink,
} from '@/lib/telemetry/handle'
import { buildStudentExport, ExportIncompletoError } from '@/lib/lgpd/export'
import { renderPolicyMd } from '@/lib/policy/markdown'
import { TENTATIVAS_DE_FECHAMENTO_UTC } from '@/data/admin/fechamento'

let sql: Sql
let admin: SupabaseClient
let teacher: SupabaseClient
let svc: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin fundações'), 'admin')
  teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Teacher fundações'), 'teacher')
  svc = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

interface Kpis {
  definitions_version: number
  recebido_no_mes_cents: number
  previsto_no_mes_cents: number
  previsto_mentoria_cents: number
  em_atraso_cents: number
  familias_em_atraso: number
  alunos_ativos: { total: number; particulares: number; travel: number }
  aulas_da_semana: { restantes: number; total: number }
  entradas_saidas_do_mes: { novos: number; encerrados: number }
  ocupacao_por_professora: { teacher_id: string; ocupacao_pct: number | null }[]
  alunos_por_nivel: { nivel: string; alunos: number }[]
}

/** Assinatura de fixture. errorHash() colapsa UUID em `<id>` — é o objetivo
 *  dele —, então uma fixture que usasse errorHash('x '+uuid, …) cairia SEMPRE
 *  na mesma linha, inclusive entre execuções (a suíte roda sem reset) e o
 *  `count` acumularia. Aqui a assinatura é sorteada; o errorHash real é
 *  provado no bloco de handlers puros. */
const hashAleatorio = () =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

const refPag = () => 'kpi-' + crypto.randomUUID().slice(0, 12)

async function kpis(): Promise<Kpis> {
  const { data, error } = await admin.rpc('admin_kpis')
  expect(error).toBeNull()
  return data as Kpis
}

/** Pagador + contrato de bancada para pendurar cobranças. */
async function contratoComPagador() {
  const c = await createPrivateContract(sql)
  const [payer] = await sql`insert into payers (name) values ('Família KPI') returning id`
  return { contractId: c.contractId, payerId: payer.id as string }
}

interface Cobranca {
  ref?: string
  cents: number
  status: string
  /** dia do vencimento: 'mes' = dentro do mês corrente; número = dias a partir de hoje */
  vence: 'mes' | number
  pago?: boolean
}

async function cobrar(alvo: { contractId: string; payerId: string }, c: Cobranca) {
  const ref = c.ref ?? refPag()
  const due =
    c.vence === 'mes'
      ? sql`(date_trunc('month', public.business_today()) + interval '2 day')::date`
      : sql`${daysFromToday(c.vence)}::date`
  await sql`
    insert into payments (asaas_payment_id, payer_id, contract_id, amount_cents, status, due_date, paid_at)
    values (${ref}, ${alvo.payerId}, ${alvo.contractId}, ${c.cents}, ${c.status}, ${due},
            ${c.pago ? sql`now()` : null})`
  return ref
}

describe('admin_kpis — portão e contrato', () => {
  it('só admin lê; anon e teacher levam exceção', async () => {
    const anon = anonClient()
    const semPapel = await anon.rpc('admin_kpis')
    expect(semPapel.error).not.toBeNull()
    const daProfessora = await teacher.rpc('admin_kpis')
    expect(daProfessora.error?.message).toContain('restrita à admin')
  })

  it('devolve os 8 números com a versão de fórmula', async () => {
    const k = await kpis()
    expect(k.definitions_version).toBe(3)
    for (const chave of [
      'recebido_no_mes_cents',
      'previsto_no_mes_cents',
      'em_atraso_cents',
      'familias_em_atraso',
      'alunos_ativos',
      'aulas_da_semana',
      'entradas_saidas_do_mes',
      'ocupacao_por_professora',
      'alunos_por_nivel',
    ]) {
      expect(k, `faltou ${chave}`).toHaveProperty(chave)
    }
    // 11 níveis Flexge + o balde "sem nível"
    expect(k.alunos_por_nivel).toHaveLength(12)
    expect(k.alunos_por_nivel.at(-1)?.nivel).toBe('sem nível')
    // A receita do Personal Travel é da Hotmart e NÃO passa por payments: a
    // perna existe no contrato, sempre zerada, para o cartão não sugerir que a
    // conta a inclui (correção 1 da revisão).
    expect(k.previsto_mentoria_cents).toBe(0)
  })

  it('conta a aula nova da semana; contrato novo é entrada do mês', async () => {
    const c = await createPrivateContract(sql)
    // 26h à frente cai dentro da semana corrente só de segunda a sexta; para o
    // teste ser estável em qualquer dia, a aula entra HOJE às 23h do negócio.
    const [aula] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
      values
        (${c.contractId}, ${c.teacherId},
         (public.business_today() + time '23:00') at time zone public.business_tz(),
         (public.business_today() + time '23:45') at time zone public.business_tz(),
         'fixture kpi', 'scheduled')
      returning id`

    // ⚠️ A conta é GLOBAL e a suíte roda arquivos em PARALELO — dezoito deles
    // criam aula a 48h daqui (dentro da semana corrente). Medir por DELTA entre
    // duas chamadas de `admin_kpis` era, portanto, uma corrida: qualquer aula
    // que nascesse no meio somava um. A prova aqui é mais forte e não corre:
    // dentro de UM snapshot (repeatable read — em read committed cada instrução
    // abre o seu), o número do KPI é comparado à contagem DIRETA da mesma
    // janela, e a fixture é procurada dentro dela. Se a fórmula mudar de
    // sentido, ou se a aula de hoje ficar de fora, isto fica vermelho.
    const medido = (await sql.begin('isolation level repeatable read', async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        app_metadata: { role: 'admin' },
      })}, true)`
      const [k] = await tx`select public.admin_kpis() as k`
      const [n] = await tx`
        select (select count(*) from class_instances ci
                 where ci.state not in ('cancelled', 'rescheduled')
                   and ci.starts_at_utc >= (date_trunc('week', public.business_today()::timestamp))
                                             at time zone public.business_tz()
                   and ci.starts_at_utc <  (date_trunc('week', public.business_today()::timestamp)
                                             + interval '7 days') at time zone public.business_tz()
               )::int as aulas,
               -- mesma régua da RPC: renovação não é ENTRADA (renewed_from) e
               -- contrato que ainda não começou não conta (<= hoje)
               (select count(*) from contracts co
                 where co.renewed_from is null
                   and co.started_on >= date_trunc('month', public.business_today())::date
                   and co.started_on <= public.business_today())::int as novos,
               (select count(*) from class_instances ci where ci.id = ${aula.id as string}
                 and ci.starts_at_utc >= (date_trunc('week', public.business_today()::timestamp))
                                           at time zone public.business_tz()
                 and ci.starts_at_utc <  (date_trunc('week', public.business_today()::timestamp)
                                           + interval '7 days') at time zone public.business_tz()
               )::int as fixture_na_semana`
      return { k: k.k as Kpis, n }
    })) as unknown as { k: Kpis; n: { aulas: number; novos: number; fixture_na_semana: number } }

    expect(Number(medido.n.fixture_na_semana), 'a aula de hoje cai na semana corrente').toBe(1)
    expect(medido.k.aulas_da_semana.total).toBe(Number(medido.n.aulas))
    expect(medido.k.entradas_saidas_do_mes.novos).toBe(Number(medido.n.novos))
    expect(medido.k.entradas_saidas_do_mes.novos, 'o contrato novo é entrada do mês')
      .toBeGreaterThan(0)
  })
})

// ⚠️ As contas de dinheiro são somas GLOBAIS da tabela payments; a prova é por
// DELTA (antes/depois), padrão da casa. A aula não entra em recebido/atraso; o
// PREVISTO, desde a v3 (Onda Financeiro · F2), deriva do CONTRATO — os casos
// dele vivem em `tests/onda-financeiro-f2.test.ts` (tabela-verdade V1–V12).
describe('admin_kpis — dinheiro (correções 1 e 2)', () => {
  it('cobrança no espelho NÃO mexe no previsto (v3: previsto lê o contrato, não o espelho)', async () => {
    // Asserção POR CONTRATO, não por delta do agregado global: a suíte roda em
    // paralelo e outro arquivo criando contrato+slot mudaria o total no meio.
    const alvo = await contratoComPagador()
    await cobrar(alvo, { cents: 10_000, status: 'PENDING', vence: 'mes' })
    await cobrar(alvo, { cents: 20_000, status: 'RECEIVED', vence: 'mes', pago: true })
    await cobrar(alvo, { cents: 30_000, status: 'REFUNDED', vence: 'mes', pago: true })
    // Na v2, 30_000 disto entrava no previsto. Na v3 a fórmula nem OLHA para
    // payments: o contrato sem slot prevê 0, com 60k de cobranças no mês.
    const [r] = await sql`
      select public.contract_previsto_no_mes_cents(
               ${alvo.contractId}, date_trunc('month', public.business_today())::date) as v`
    expect(Number(r.v)).toBe(0)
  })

  it('aula agendada NÃO é receita prevista (v3 = mensalidade cadastrada; a agenda vivida não entra)', async () => {
    // Por CONTRATO (não por delta do agregado — suíte paralela cria slots).
    const c = await createPrivateContract(sql)
    await sql`update contracts set hourly_rate_cents = 17000 where id = ${c.contractId}`
    const mesAtual = async () => {
      const [r] = await sql`
        select public.contract_previsto_no_mes_cents(
                 ${c.contractId}, date_trunc('month', public.business_today())::date) as v`
      return Number(r.v)
    }
    const antes = await mesAtual()
    // uma aula EXTRA na agenda vivida — fora dos slots — não muda a regra:
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
      values
        (${c.contractId}, ${c.teacherId},
         (public.business_today() + time '22:00') at time zone public.business_tz(),
         (public.business_today() + time '22:45') at time zone public.business_tz(),
         'fixture previsto', 'scheduled')`
    expect(await mesAtual()).toBe(antes)
  })

  it('cobrança vencida e não paga entra em atraso; quitada sai e vira recebido', async () => {
    const alvo = await contratoComPagador()
    const antes = await kpis()
    const ref = await cobrar(alvo, { cents: 43_000, status: 'OVERDUE', vence: -5 })
    const vencida = await kpis()
    expect(vencida.em_atraso_cents - antes.em_atraso_cents).toBe(43_000)
    expect(vencida.familias_em_atraso - antes.familias_em_atraso).toBe(1)

    // Asaas manda status em CAIXA ALTA — a régua de "paga" precisa ser lower()
    await sql`update payments set status = 'RECEIVED', paid_at = now() where asaas_payment_id = ${ref}`
    const paga = await kpis()
    expect(paga.em_atraso_cents).toBe(antes.em_atraso_cents)
    expect(paga.recebido_no_mes_cents - antes.recebido_no_mes_cents).toBe(43_000)
  })

  it('estorno some do RECEBIDO — com paymentDate e sem paymentDate', async () => {
    const alvo = await contratoComPagador()
    const base = await kpis()

    // (a) devolveu COM data de pagamento preenchida (o caso comum do Asaas: o
    //     paid_at fica lá, só o status vira REFUNDED)
    const comData = await cobrar(alvo, { cents: 50_000, status: 'RECEIVED', vence: 'mes', pago: true })
    const entrou = await kpis()
    expect(entrou.recebido_no_mes_cents - base.recebido_no_mes_cents).toBe(50_000)
    await sql`update payments set status = 'REFUNDED' where asaas_payment_id = ${comData}`
    const estornou = await kpis()
    expect(estornou.recebido_no_mes_cents).toBe(base.recebido_no_mes_cents)
    // (a alegação "estorno não mexe no previsto" virou estrutural na v3: o
    // previsto deriva do contrato e nem olha payments — pinado por contrato em
    // "cobrança no espelho NÃO mexe no previsto" e na tabela-verdade do F2.
    // Delta global aqui seria corrida com a suíte paralela criando slots.)

    // (b) devolveu SEM paymentDate (evento sem paymentDate → paid_at nulo).
    //     Não pode contar em lugar nenhum: nem caixa, nem atraso.
    await cobrar(alvo, { cents: 60_000, status: 'REFUNDED', vence: -7 })
    const semData = await kpis()
    expect(semData.recebido_no_mes_cents).toBe(base.recebido_no_mes_cents)
    expect(semData.em_atraso_cents).toBe(base.em_atraso_cents)
    expect(semData.familias_em_atraso).toBe(base.familias_em_atraso)
  })

  it('chargeback, cancelada e apagada saem do EM ATRASO', async () => {
    const alvo = await contratoComPagador()
    const antes = await kpis()
    for (const status of ['CHARGEBACK_REQUESTED', 'PAYMENT_DELETED', 'canceled', 'Cancelled']) {
      await cobrar(alvo, { cents: 11_000, status, vence: -9 })
    }
    const depois = await kpis()
    expect(depois.em_atraso_cents).toBe(antes.em_atraso_cents)
    expect(depois.familias_em_atraso).toBe(antes.familias_em_atraso)
  })

  it('payment_nao_cobravel é a régua única e é case-insensitive', async () => {
    const [r] = await sql`
      select
        public.payment_nao_cobravel('REFUNDED')              as refunded,
        public.payment_nao_cobravel('refund_requested')      as refund_req,
        public.payment_nao_cobravel('CHARGEBACK_DISPUTE')    as chargeback,
        public.payment_nao_cobravel('PAYMENT_DELETED')       as deletado,
        public.payment_nao_cobravel('Canceled')              as cancelado,
        public.payment_nao_cobravel('RECEIVED')              as recebido,
        public.payment_nao_cobravel('OVERDUE')               as vencido,
        public.payment_nao_cobravel(null)                    as nulo`
    expect([r.refunded, r.refund_req, r.chargeback, r.deletado, r.cancelado]).toEqual([
      true, true, true, true, true,
    ])
    expect([r.recebido, r.vencido, r.nulo]).toEqual([false, false, false])
  })

  /* --------------------------------------------------------------------------
   * A RÉGUA PASSOU A NASCER DA MATRIZ (28/07, ordem complementar do P5).
   *
   * `payment_nao_cobravel` casava substring `(refund|chargeback|cancel|delet)`.
   * Isso dava por MORTA cobrança que está viva, e o efeito não era só de
   * rótulo: estes três status saíam do "recebido", do "previsto" e do
   * "em atraso" dos KPIs — dinheiro da escola sumindo do painel dela.
   *
   * A definição nova é o complemento das três vozes de cobrança de pé
   * (`payment_situacao not in ('paga','em_aberto','em_atraso')`). Ela preserva
   * TODAS as classificações do caso acima — inclusive as que a ordem original
   * teria virado, como `refund_requested` e `CHARGEBACK_DISPUTE`, que continuam
   * fora do caixa — e conserta só as que estavam erradas.
   * ----------------------------------------------------------------------- */
  it('nome de EVENTO com "cancel"/"refund" não mata mais a cobrança (correção 28/07)', async () => {
    const [r] = await sql`
      select
        -- boleto cancelado e REGERADO: a cobrança segue de pé
        public.payment_nao_cobravel('BANK_SLIP_CANCELLED')  as boleto,
        public.payment_nao_cobravel('SPLIT_CANCELLED')      as split,
        -- estorno RECUSADO: o dinheiro ficou com a escola
        public.payment_nao_cobravel('REFUND_DENIED')        as negado,
        -- …e o que era certo continua certo
        public.payment_nao_cobravel('PARTIALLY_REFUNDED')   as parcial,
        public.payment_nao_cobravel('REFUND_IN_PROGRESS')   as andamento,
        public.payment_nao_cobravel('AWAITING_CHARGEBACK_REVERSAL') as reversao`
    expect([r.boleto, r.split, r.negado]).toEqual([false, false, false])
    expect([r.parcial, r.andamento, r.reversao]).toEqual([true, true, true])
  })

  it('a régua é a MESMA que a do rótulo do aluno — por construção', async () => {
    // Nenhum status pode responder "não-cobrável" e, ao mesmo tempo, receber uma
    // das três vozes de cobrança de pé. Era exatamente o que acontecia com
    // BANK_SLIP_CANCELLED (não-cobrável = true, situação = em aberto).
    const linhas = await sql<{ st: string; nc: boolean; sit: string }[]>`
      select st,
             public.payment_nao_cobravel(st)              as nc,
             public.payment_situacao(st, null, null)      as sit
        from unnest(array[
          'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS',
          'REFUND_DENIED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
          'AWAITING_CHARGEBACK_REVERSAL', 'PAYMENT_DELETED', 'CANCELED', 'RECEIVED',
          'CONFIRMED', 'RECEIVED_IN_CASH', 'RECEIVED_IN_CASH_UNDONE',
          'BANK_SLIP_CANCELLED', 'SPLIT_CANCELLED', 'DUNNING_REQUESTED',
          'DUNNING_RECEIVED', 'AWAITING_CHARGEBACK_DEBIT', 'PENDING',
          'OVERDUE', 'INVENTADO_AMANHA'
        ]) as st`
    for (const l of linhas) {
      expect(l.nc, `${l.st} (situação ${l.sit})`).toBe(
        !['paga', 'em_aberto', 'em_atraso'].includes(l.sit),
      )
    }
  })
})

describe('kpi_snapshots — foto diária append-only', () => {
  it('capture grava uma vez por dia; a segunda chamada não duplica', async () => {
    const primeira = await svc.rpc('capture_kpi_snapshot')
    expect(primeira.error).toBeNull()
    const segunda = await svc.rpc('capture_kpi_snapshot')
    expect(segunda.error).toBeNull()
    expect(segunda.data).toBe(false) // ON CONFLICT DO NOTHING

    const linhas = await sql`
      select definitions_version, data from kpi_snapshots
       where captured_on = public.business_today()`
    expect(linhas).toHaveLength(1)
    expect(linhas[0].definitions_version).toBe(3)
    expect(linhas[0].data).toHaveProperty('alunos_ativos')
  })

  it('append-only: UPDATE e DELETE são recusados até para o dono da tabela', async () => {
    await svc.rpc('capture_kpi_snapshot')
    await expect(
      sql`update kpi_snapshots set definitions_version = 9 where captured_on = public.business_today()`,
    ).rejects.toThrow(/append-only/)
    await expect(
      sql`delete from kpi_snapshots where captured_on = public.business_today()`,
    ).rejects.toThrow(/append-only/)
  })

  it('RLS: admin lê, teacher e anônimo veem vazio, ninguém insere pelo PostgREST', async () => {
    await svc.rpc('capture_kpi_snapshot')
    const doAdmin = await admin.from('kpi_snapshots').select('captured_on')
    expect(doAdmin.error).toBeNull()
    expect((doAdmin.data ?? []).length).toBeGreaterThanOrEqual(1)

    const daProfessora = await teacher.from('kpi_snapshots').select('captured_on')
    expect(daProfessora.error).toBeNull()
    expect(daProfessora.data).toEqual([])

    const doAnonimo = await anonClient().from('kpi_snapshots').select('captured_on')
    expect(doAnonimo.error).toBeNull()
    expect(doAnonimo.data).toEqual([])

    const inserido = await admin
      .from('kpi_snapshots')
      .insert({ captured_on: daysFromToday(30), definitions_version: 1, data: {} })
    expect(inserido.error).not.toBeNull()
    const peloServico = await svc
      .from('kpi_snapshots')
      .insert({ captured_on: daysFromToday(31), definitions_version: 1, data: {} })
    expect(peloServico.error).not.toBeNull()
  })
})

async function idDaVigente(): Promise<string> {
  const { data } = await admin.rpc('policy_vigente', { p_kind: 'ciencia-canais' })
  return ((data ?? []) as { id: string }[])[0].id
}

describe('política versionada + aceite que prova o texto', () => {
  it('a v1 semeada é o texto que a tela de ciência renderiza', async () => {
    const [v1] = await sql`
      select version, body_md, effective_from from policy_versions
       where kind = 'ciencia-canais' order by version limit 1`
    expect(v1.version).toBe(1)

    // A página não tem mais texto martelado: ela renderiza ESTE body_md. O
    // teste prova que o subconjunto de Markdown produz exatamente o cartão
    // antigo — eyebrow + parágrafo com "e-mail" e "WhatsApp" em negrito.
    const t = renderPolicyMd(v1.body_md as string)
    expect(t.titulo).toBe('Canais de aviso')
    expect(t.paragrafos).toHaveLength(1)
    const plano = t.paragrafos[0].map((p) => p.texto).join('')
    expect(plano).toContain('lembretes de aula, remarcações, créditos')
    expect(plano).toContain('canais oficiais de comunicação')
    expect(t.paragrafos[0].filter((p) => p.forte).map((p) => p.texto)).toEqual([
      'e-mail',
      'WhatsApp',
    ])
  })

  it('policy_vigente é a MAIOR versão já em vigor (e não a última inserida)', async () => {
    const kind = 'teste-corrida-' + crypto.randomUUID().slice(0, 8)
    // B1: publicar é ato de RPC (é ela que pega o advisory lock). O INSERT
    // direto passou a ser barrado por trigger — inclusive para o dono.
    const [v1] = await sql`
      select public.publish_policy_version(
        ${kind}, 1, '## Um\n\nprimeiro', public.business_today() - 10) as id`
    const [v2] = await sql`
      select public.publish_policy_version(
        ${kind}, 2, '## Dois\n\nsegundo', public.business_today()) as id`
    // versão FUTURA existe mas ainda não vale
    await sql`
      select public.publish_policy_version(
        ${kind}, 3, '## Três\n\nterceiro', public.business_today() + 5)`

    const { data } = await admin.rpc('policy_vigente', { p_kind: kind })
    const vigente = ((data ?? []) as { id: string; version: number }[])[0]
    expect(vigente.version).toBe(2)
    expect(vigente.id).toBe(v2.id)
    expect(vigente.id).not.toBe(v1.id)
  })

  it('ack registra o aceite da versão EXIBIDA, uma vez só', async () => {
    const userId = await createAuthUser(sql, 'student', 'Aluna da política')
    const c = await createPrivateContract(sql)
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const aluna = await clientAs(userId, 'student')
    const exibido = await idDaVigente()

    expect((await aluna.rpc('ack_channel_notice', { p_policy_version_id: exibido })).error).toBeNull()
    // idempotente
    expect((await aluna.rpc('ack_channel_notice', { p_policy_version_id: exibido })).error).toBeNull()

    const aceites = await sql`
      select pa.channel, pa.policy_version_id, pv.kind, pv.version
        from policy_acceptances pa
        join policy_versions pv on pv.id = pa.policy_version_id
       where pa.student_id = ${c.studentId}`
    expect(aceites).toHaveLength(1)
    // grava EXATAMENTE o id que a página mostrou
    expect(aceites[0].policy_version_id).toBe(exibido)
    expect(aceites[0].kind).toBe('ciencia-canais')
    expect(aceites[0].channel).toBe('portal')

    // o carimbo antigo continua sendo gravado (aditivo)
    const [p] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(p.whatsapp_channel_ack_at).not.toBeNull()
    // e a auditoria guarda a versão aceita
    const [a] = await sql`
      select diff from audit_log where action = 'ack_channel_notice'
        and entity_id = ${userId}::text order by at desc limit 1`
    expect(a.diff.policy_version_id).toBe(exibido)

    // a aluna vê o PRÓPRIO aceite; a professora não vê o de ninguém
    const meus = await aluna.from('policy_acceptances').select('id')
    expect((meus.data ?? []).length).toBe(1)
    const daProfessora = await teacher.from('policy_acceptances').select('id')
    expect(daProfessora.data).toEqual([])
  })

  it('CORRIDA: aceite de versão que não é a vigente falha limpo, sem carimbar nada', async () => {
    // Simular a corrida de verdade exigiria publicar uma v2 de 'ciencia-canais'
    // no banco COMPARTILHADO da suíte, o que quebraria os outros arquivos que
    // rodam em paralelo. As duas metades do cenário estão provadas: o teste
    // acima mostra que uma v2 vigente vira a vigente; este mostra que um id que
    // NÃO é o vigente é recusado — que é exatamente o que a página em cima de
    // um texto velho envia.
    const userId = await createAuthUser(sql, 'student', 'Aluna atrasada')
    const c = await createPrivateContract(sql)
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const aluna = await clientAs(userId, 'student')

    const kind = 'teste-velha-' + crypto.randomUUID().slice(0, 8)
    const [outra] = await sql`
      select public.publish_policy_version(${kind}, 1, 'outro texto') as id`

    const velha = await aluna.rpc('ack_channel_notice', { p_policy_version_id: outra.id })
    expect(velha.error?.message).toContain('politica-desatualizada')
    const nula = await aluna.rpc('ack_channel_notice', { p_policy_version_id: null })
    expect(nula.error?.message).toContain('politica-desatualizada')

    // nada gravado: nem aceite, nem carimbo (a transação inteira caiu)
    const aceites = await sql`select 1 from policy_acceptances where student_id = ${c.studentId}`
    expect(aceites).toHaveLength(0)
    const [p] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(p.whatsapp_channel_ack_at).toBeNull()

    // e o caminho feliz logo depois funciona (o erro não deixou resíduo)
    const ok = await aluna.rpc('ack_channel_notice', { p_policy_version_id: await idDaVigente() })
    expect(ok.error).toBeNull()
  })

  it('quem não tem ficha de aluno apenas carimba, sem aceite órfão', async () => {
    const userId = await createAuthUser(sql, 'teacher', 'Professora curiosa')
    const prof = await clientAs(userId, 'teacher')
    const { error } = await prof.rpc('ack_channel_notice', {
      p_policy_version_id: await idDaVigente(),
    })
    expect(error).toBeNull()
    const [p] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(p.whatsapp_channel_ack_at).not.toBeNull()
  })

  it('policy_versions é append-only e nega escrita pelo PostgREST', async () => {
    await expect(
      sql`update policy_versions set body_md = 'reescrito' where kind = 'ciencia-canais'`,
    ).rejects.toThrow(/append-only/)
    const escrita = await admin
      .from('policy_versions')
      .insert({ kind: 'invencao', version: 1, body_md: 'x' })
    expect(escrita.error).not.toBeNull()
  })
})

describe('renderPolicyMd — subconjunto fechado de Markdown', () => {
  it('separa título e parágrafos e resolve o negrito', () => {
    const t = renderPolicyMd('## Título\n\nprimeiro **forte** fim\n\nsegundo\nna mesma frase')
    expect(t.titulo).toBe('Título')
    expect(t.paragrafos).toHaveLength(2)
    expect(t.paragrafos[0]).toEqual([
      { texto: 'primeiro ', forte: false },
      { texto: 'forte', forte: true },
      { texto: ' fim', forte: false },
    ])
    expect(t.paragrafos[1][0].texto).toBe('segundo na mesma frase')
  })

  it('não executa marcação que não entende — sai como TEXTO', () => {
    const t = renderPolicyMd('sem título\n\n<script>alert(1)</script> e [link](http://x) e ** solto')
    expect(t.titulo).toBeNull()
    expect(t.paragrafos).toHaveLength(2)
    const plano = t.paragrafos.flat().map((p) => p.texto).join(' ')
    // o React escapa na renderização; aqui o que importa é que nada virou
    // "pedaço forte" nem sumiu do texto
    expect(plano).toContain('<script>alert(1)</script>')
    expect(plano).toContain('[link](http://x)')
    expect(t.paragrafos.flat().some((p) => p.forte)).toBe(false)
  })
})

describe('ui_events e client_errors — escrita só pelo servidor', () => {
  it('record_ui_event grava o page_view; INSERT direto é negado a todos', async () => {
    const userId = await createAuthUser(sql, 'admin', 'Admin telemetria')
    const { error } = await svc.rpc('record_ui_event', {
      p_user: userId,
      p_role: 'admin',
      p_path: '/admin/agenda',
      p_event: 'page_view',
      p_meta: {},
    })
    expect(error).toBeNull()
    const [ev] = await sql`select role, path, event from ui_events where user_id = ${userId}`
    expect(ev.path).toBe('/admin/agenda')
    expect(ev.event).toBe('page_view')

    const direto = await svc.from('ui_events').insert({ path: '/x', event: 'page_view' })
    expect(direto.error).not.toBeNull()
    const doAdmin = await admin.from('ui_events').insert({ path: '/x', event: 'page_view' })
    expect(doAdmin.error).not.toBeNull()
  })

  it('caminho longo demais é truncado no banco, não rejeitado', async () => {
    const userId = await createAuthUser(sql, 'admin', 'Admin caminho longo')
    const { error } = await svc.rpc('record_ui_event', {
      p_user: userId,
      p_role: 'admin',
      p_path: '/' + 'a'.repeat(600),
      p_event: 'page_view',
      p_meta: {},
    })
    expect(error).toBeNull()
    const [ev] = await sql`select length(path) as n from ui_events where user_id = ${userId}`
    expect(Number(ev.n)).toBe(300)
  })

  it('RLS: só admin lê ui_events; teacher e anônimo veem vazio', async () => {
    expect((await teacher.from('ui_events').select('id')).data).toEqual([])
    expect((await anonClient().from('ui_events').select('id')).data).toEqual([])
    const doAdmin = await admin.from('ui_events').select('id').limit(1)
    expect(doAdmin.error).toBeNull()
  })

  it('record_client_error deduplica por hash e conta as repetições', async () => {
    const hash = hashAleatorio()
    const userId = await createAuthUser(sql, 'student', 'Aluno do erro')

    await svc.rpc('record_client_error', {
      p_hash: hash,
      p_message: 'Boom',
      p_stack: 'at foo (bar.js:1:1)',
      p_path: '/portal/aulas',
      p_user: userId,
    })
    await svc.rpc('record_client_error', {
      p_hash: hash,
      p_message: 'Boom',
      p_stack: null,
      p_path: '/portal/aulas',
      p_user: userId,
    })
    const [e] = await sql`
      select count, first_at, last_at, user_id, stack from client_errors
       where hash = ${hash} and user_id = ${userId}`
    expect(e.count).toBe(2)
    expect(new Date(e.last_at).getTime()).toBeGreaterThanOrEqual(new Date(e.first_at).getTime())
    expect(e.stack).toContain('bar.js')
  })

  it('CORREÇÃO 6: um balde por pessoa — dois usuários no mesmo defeito são duas linhas', async () => {
    const hash = hashAleatorio()
    const a = await createAuthUser(sql, 'student', 'Aluno A do erro')
    const b = await createAuthUser(sql, 'student', 'Aluno B do erro')
    const bater = (user: string | null) =>
      svc.rpc('record_client_error', {
        p_hash: hash,
        p_message: 'Mesmo defeito',
        p_stack: null,
        p_path: '/portal',
        p_user: user,
      })

    await bater(a)
    await bater(a)
    await bater(b)
    await bater(null)
    await bater(null)

    const linhas = await sql`
      select user_id, count from client_errors where hash = ${hash} order by count desc`
    expect(linhas).toHaveLength(3)
    // contagem global do defeito = SOMA dos baldes
    expect(linhas.reduce((s, l) => s + Number(l.count), 0)).toBe(5)
    const porDono = new Map(linhas.map((l) => [l.user_id, Number(l.count)]))
    expect(porDono.get(a)).toBe(2)
    expect(porDono.get(b)).toBe(1)
    // o anônimo é UM balde (nulls not distinct), não uma linha por ocorrência
    expect(porDono.get(null)).toBe(2)
  })

  it('mensagem e stack são cortadas nos caps; hash torto é recusado', async () => {
    const hash = hashAleatorio()
    await svc.rpc('record_client_error', {
      p_hash: hash,
      p_message: 'M'.repeat(900),
      p_stack: 'S'.repeat(9000),
      p_path: '/admin',
      p_user: null,
    })
    const [e] = await sql`
      select length(message) as m, length(stack) as s from client_errors where hash = ${hash}`
    expect(Number(e.m)).toBe(500)
    expect(Number(e.s)).toBe(4000)

    const torto = await svc.rpc('record_client_error', {
      p_hash: 'nao-e-sha256',
      p_message: 'x',
      p_stack: null,
      p_path: null,
      p_user: null,
    })
    expect(torto.error?.message).toContain('hash inválido')
  })

  it('RLS: só admin lê client_errors; INSERT direto negado', async () => {
    expect((await teacher.from('client_errors').select('id')).data).toEqual([])
    expect((await anonClient().from('client_errors').select('id')).data).toEqual([])
    const direto = await svc.from('client_errors').insert({ hash: 'a'.repeat(64), message: 'x' })
    expect(direto.error).not.toBeNull()
  })
})

describe('corpo com teto em BYTES (correção 9)', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(0x61) // 'a'

  function reqComStream(pedacos: Uint8Array[]): Request {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of pedacos) c.enqueue(p)
        c.close()
      },
    })
    return new Request('http://local/api/x', {
      method: 'POST',
      body: stream,
      // @ts-expect-error duplex é exigido pelo undici e não está no lib.dom
      duplex: 'half',
    })
  }

  it('Content-Length grande é recusado SEM ler o corpo', async () => {
    let leu = false
    const req = {
      headers: new Headers({ 'content-length': String(BEACON_MAX_BYTES + 1) }),
      body: null,
      text: async () => {
        leu = true
        return 'irrelevante'
      },
    } as unknown as Request
    expect(await readCappedBody(req, BEACON_MAX_BYTES)).toBeNull()
    expect(leu).toBe(false)
  })

  it('Content-Length ilegível também é recusado', async () => {
    const req = {
      headers: new Headers({ 'content-length': 'quinhentos' }),
      body: null,
      text: async () => 'x',
    } as unknown as Request
    expect(await readCappedBody(req, BEACON_MAX_BYTES)).toBeNull()
  })

  it('corpo enorme SEM Content-Length é abortado no meio do stream', async () => {
    // 64 pedaços de 1 KiB contra um teto de 2 KiB: o leitor tem de parar cedo.
    const pedacos = Array.from({ length: 64 }, () => bytes(1_024))
    const req = reqComStream(pedacos)
    expect(req.headers.get('content-length')).toBeNull()
    expect(await readCappedBody(req, BEACON_MAX_BYTES)).toBeNull()
  })

  it('corpo dentro do teto volta inteiro, inclusive multibyte', async () => {
    const corpo = JSON.stringify({ path: '/admin/alunos/ação', event: 'page_view' })
    const req = reqComStream([new TextEncoder().encode(corpo)])
    expect(await readCappedBody(req, BEACON_MAX_BYTES)).toBe(corpo)
  })

  it('mede BYTES, não caracteres: string curta de caracteres pesados estoura', async () => {
    // 20 emojis = 80 bytes; com teto de 40 bytes tem de ser recusado, ainda que
    // `raw.length` (caracteres) dissesse 40.
    const pesado = '🧨'.repeat(20)
    const req = reqComStream([new TextEncoder().encode(pesado)])
    expect(await readCappedBody(req, 40)).toBeNull()
  })
})

describe('redação de PII na telemetria (correção 4)', () => {
  it('tira e-mail, telefone, credencial e query string', () => {
    const bruto =
      'Falha ao avisar maria.silva+aula@exemplo.com no (65) 90000-0000 / +5565900000000 — ' +
      'GET https://app.personal-teacher.com/portal/aula/9?token=abc123&x=1 ' +
      'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def apikey=sk-live-999zzz'
    const limpo = redactPii(bruto)

    expect(limpo).not.toContain('maria.silva+aula@exemplo.com')
    expect(limpo).not.toContain('90000-0000')
    expect(limpo).not.toContain('+5565900000000')
    expect(limpo).not.toContain('token=abc123')
    expect(limpo).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(limpo).not.toContain('sk-live-999zzz')

    expect(limpo).toContain('<email>')
    expect(limpo).toContain('<telefone>')
    expect(limpo).toContain('?<redigido>')
    expect(limpo).toContain('<credencial>')
    // o que NÃO é PII fica legível — senão a linha não serve para depurar
    expect(limpo).toContain('Falha ao avisar')
    expect(limpo).toContain('app.personal-teacher.com/portal/aula/9')
  })

  it('cada categoria isolada', () => {
    expect(redactPii('erro com joao@bancada.dev')).toBe('erro com <email>')
    expect(redactPii('whats +5511900000030 fora')).toBe('whats <telefone> fora')
    expect(redactPii('whats 11 90000-0030 fora')).toBe('whats <telefone> fora')
    expect(redactPii('senha=hunter2 no log')).toBe('senha=<redigido> no log')
    expect(redactPii('/api/x?a=1&b=2 falhou')).toBe('/api/x?<redigido> falhou')
    // número curto (status, linha, id pequeno) NÃO é telefone
    expect(redactPii('status 500 na linha 42')).toBe('status 500 na linha 42')
  })

  it('o handler redige ANTES de persistir — e o banco nunca vê a PII', async () => {
    const capturado: { message: string; stack: string | null }[] = []
    const sink: TelemetrySink = {
      async uiEvent() {},
      async clientError(i) {
        capturado.push({ message: i.message, stack: i.stack })
      },
    }
    await handleClientError(
      JSON.stringify({
        name: 'TypeError',
        message: 'falhou para ana@bancada.dev (65) 90000-0000',
        stack: 'at fetch (/api/x?token=segredo)',
        path: '/portal',
      }),
      { userId: null, anonKey: 'ip' },
      sink,
      () => true,
    )
    expect(capturado[0].message).toBe('TypeError: falhou para <email> <telefone>')
    expect(capturado[0].stack).toBe('at fetch (/api/x?<redigido>)')
  })
})

describe('handlers de telemetria (puros)', () => {
  function fakeSink() {
    const eventos: unknown[] = []
    const erros: unknown[] = []
    const sink: TelemetrySink = {
      async uiEvent(i) {
        eventos.push(i)
      },
      async clientError(i) {
        erros.push(i)
      },
    }
    return { sink, eventos, erros }
  }
  const sessao = { userId: '00000000-0000-0000-0000-000000000001', role: 'admin' }
  const quem = { userId: sessao.userId, anonKey: null }
  const anonimo = { userId: null, anonKey: 'balde-de-teste' }

  it('beacon sem sessão não grava (v1 não registra anônimo)', async () => {
    const f = fakeSink()
    const r = await handleBeacon(JSON.stringify({ path: '/admin' }), null, f.sink)
    expect(r).toEqual({ status: 204, outcome: 'sem-sessao' })
    expect(f.eventos).toHaveLength(0)
  })

  it('beacon grava o caminho NORMALIZADO (sem o id do aluno na URL)', async () => {
    const f = fakeSink()
    const r = await handleBeacon(
      JSON.stringify({ path: '/admin/alunos/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b?painel=x' }),
      sessao,
      f.sink,
    )
    expect(r.outcome).toBe('gravado')
    expect(f.eventos[0]).toMatchObject({ path: '/admin/alunos/:id', event: 'page_view' })
  })

  it('beacon descarta corpo grande, JSON inválido e evento fora do contrato', async () => {
    const f = fakeSink()
    expect((await handleBeacon('x'.repeat(BEACON_MAX_BYTES + 1), sessao, f.sink)).outcome).toBe(
      'grande-demais',
    )
    expect((await handleBeacon('{isto não é json', sessao, f.sink)).outcome).toBe('invalido')
    expect(
      (await handleBeacon(JSON.stringify({ path: '/x', event: 'click' }), sessao, f.sink)).outcome,
    ).toBe('invalido')
    expect((await handleBeacon(JSON.stringify({ path: '' }), sessao, f.sink)).outcome).toBe('invalido')
    expect(f.eventos).toHaveLength(0)
  })

  it('erro do banco vira descarte silencioso, nunca exceção', async () => {
    const quebrado: TelemetrySink = {
      async uiEvent() {
        throw new Error('banco fora do ar')
      },
      async clientError() {
        throw new Error('banco fora do ar')
      },
    }
    expect((await handleBeacon(JSON.stringify({ path: '/x' }), sessao, quebrado)).outcome).toBe(
      'erro-no-banco',
    )
    expect(
      (await handleClientError(JSON.stringify({ message: 'x' }), anonimo, quebrado, () => true))
        .outcome,
    ).toBe('erro-no-banco',
    )
  })

  it('client-error aceita sem sessão, corta caps e respeita o rate-limit', async () => {
    const f = fakeSink()
    const agora = 1_000
    const gate = createClientErrorGate({
      anonLimit: 2,
      windowMs: 60_000,
      now: () => agora,
      onDiscard: () => {},
    })
    const passa = (q: { userId: string | null; anonKey: string | null }) => gate.allow(q)
    expect(
      (await handleClientError(JSON.stringify({ message: 'a', path: '/login' }), anonimo, f.sink, passa))
        .outcome,
    ).toBe('gravado')
    expect(
      (await handleClientError(JSON.stringify({ message: 'b' }), anonimo, f.sink, passa)).outcome,
    ).toBe('gravado')
    expect(
      (await handleClientError(JSON.stringify({ message: 'c' }), anonimo, f.sink, passa)).outcome,
    ).toBe('limitado')
    expect(f.erros).toHaveLength(2)
    expect(gate.discarded()).toBe(1)

    const g = fakeSink()
    await handleClientError(
      JSON.stringify({ message: 'M'.repeat(900), stack: 'S'.repeat(9_000), path: '/admin' }),
      quem,
      g.sink,
      () => true,
    )
    const gravado = g.erros[0] as { message: string; stack: string; userId: string }
    expect(gravado.message).toHaveLength(500)
    expect(gravado.stack).toHaveLength(4_000)
    expect(gravado.userId).toBe(sessao.userId)

    const h = fakeSink()
    expect(
      (await handleClientError('x'.repeat(CLIENT_ERROR_MAX_BYTES + 1), anonimo, h.sink, () => true))
        .outcome,
    ).toBe('grande-demais')
  })

  it('normalização: mesmo defeito em alunos diferentes é UM hash', () => {
    const a = errorHash(
      'TypeError',
      'Cannot read properties of undefined (reading "level") at line 42',
      '/admin/alunos/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
    )
    const b = errorHash(
      'TypeError',
      'Cannot read properties of undefined (reading "level") at line 77',
      '/admin/alunos/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee?painel=x',
    )
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(errorHash('TypeError', 'Outro defeito', '/admin')).not.toBe(a)
    expect(normalizePath('/portal/aula/12345')).toBe('/portal/aula/:n')
    expect(normalizeMessage('Erro 500 no id ABC')).toBe('erro 500 no id abc')
  })

  it('CORREÇÃO 5: código de 3 dígitos sobrevive e o TIPO entra na assinatura', () => {
    const p = '/portal/aulas'
    const naoAutorizado = errorHash('Error', 'request failed with status 401', p)
    const servidor = errorHash('Error', 'request failed with status 500', p)
    // dois defeitos de naturezas diferentes: permissão × servidor
    expect(naoAutorizado).not.toBe(servidor)
    expect(normalizeMessage('request failed with status 401')).toBe('request failed with status 401')
    // número de circunstância continua colapsando
    expect(normalizeMessage('falhou na linha 4210')).toBe('falhou na linha <n>')

    // mesmo texto, tipos distintos = baldes distintos (bug × bundle velho)
    const bug = errorHash('TypeError', 'x is not a function', p)
    const bundle = errorHash('ChunkLoadError', 'x is not a function', p)
    expect(bug).not.toBe(bundle)
    // ausência de tipo tem um valor estável, não um hash por chamada
    expect(errorHash(null, 'x', p)).toBe(errorHash('  ', 'x', p))
  })
})

describe('rate-limit particionado (correção 11)', () => {
  it('a janela por chave reabre', () => {
    let agora = 0
    const l = createKeyedRateLimiter({ limit: 1, windowMs: 1_000, now: () => agora })
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(false)
    agora = 1_500
    expect(l.allow('k')).toBe(true)
  })

  it('HOSTIL: anônimo em laço não consome a cota de quem tem sessão', () => {
    const agora = 1_000
    const avisos: string[] = []
    const gate = createClientErrorGate({
      authLimit: 3,
      anonLimit: 2,
      windowMs: 60_000,
      now: () => agora,
      onDiscard: (fila) => avisos.push(fila),
    })
    for (let i = 0; i < 500; i++) gate.allow({ userId: null, anonKey: 'ip-do-atacante' })
    expect(gate.discarded()).toBe(498)
    // o aviso sai UMA vez por chave por janela (não 498 linhas de log)
    expect(avisos).toEqual(['anon'])

    // a dona continua conseguindo reportar
    expect(gate.allow({ userId: 'dona', anonKey: null })).toBe(true)
    expect(gate.allow({ userId: 'dona', anonKey: null })).toBe(true)
    expect(gate.allow({ userId: 'dona', anonKey: null })).toBe(true)
    expect(gate.allow({ userId: 'dona', anonKey: null })).toBe(false)
    // e um segundo usuário tem cota própria
    expect(gate.allow({ userId: 'parceira', anonKey: null })).toBe(true)
    // outro IP anônimo também
    expect(gate.allow({ userId: null, anonKey: 'outro-ip' })).toBe(true)
  })

  it('HOSTIL: enxame de chaves não cresce a memória sem limite', () => {
    let agora = 0
    const l = createKeyedRateLimiter({ limit: 5, windowMs: 1_000, maxKeys: 3, now: () => agora })
    expect(l.allow('a')).toBe(true)
    expect(l.allow('b')).toBe(true)
    expect(l.allow('c')).toBe(true)
    // mesa cheia: chave NOVA é negada em vez de alocar
    expect(l.allow('d')).toBe(false)
    expect(l.allow('a')).toBe(true) // quem já tem balde continua
    // passada a janela, as chaves velhas são varridas e a mesa abre
    agora = 2_000
    expect(l.allow('d')).toBe(true)
  })

  it('a chave anônima é derivada do IP e não volta a ser IP', () => {
    const ip = '203.0.113.7'
    expect(anonBucketKey(ip)).toBe(anonBucketKey(ip))
    expect(anonBucketKey(ip)).not.toBe(anonBucketKey('203.0.113.8'))
    // NÃO conter o IP: asserção pelo IP INTEIRO — conferir um octeto solto
    // ('203') era loteria: o sal é aleatório por processo e 16 hex contêm
    // qualquer trinca com ~0,3% de chance por rodada (caiu em 08/08).
    expect(anonBucketKey(ip)).not.toContain(ip)
    expect(anonBucketKey(ip)).toMatch(/^[0-9a-f]{16}$/)
    // sem header da borda, balde único e declarado
    expect(anonBucketKey(null)).toBe('sem-ip')
    expect(anonBucketKey('')).toBe('sem-ip')
    // x-forwarded-for com lista: usa o primeiro
    expect(anonBucketKey('203.0.113.7, 10.0.0.1')).toBe(anonBucketKey(ip))
  })
})

/* --------------------------------- LGPD --------------------------------- */

type Resp = { data: unknown; error: { message: string } | null }

/** Cliente de mentira encadeável: só o suficiente para injetar um erro. */
function stubSupabase(porTabela: Record<string, Resp>, rpc: Resp): SupabaseClient {
  const chain = (r: Resp) => {
    const c = {
      select: () => c,
      eq: () => c,
      in: () => c,
      order: () => c,
      maybeSingle: () => Promise.resolve(r),
      then: (ok?: (v: Resp) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(r).then(ok, err),
    }
    return c
  }
  return {
    rpc: () => Promise.resolve(rpc),
    from: (t: string) => chain(porTabela[t] ?? { data: [], error: null }),
  } as unknown as SupabaseClient
}

describe('LGPD — export e anonimização alcançam a telemetria', () => {
  async function alunoComRastro(opts: { hash?: string } = {}) {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Rastro Detal')
    await sql`update students set profile_id = ${userId}, display_name = 'Rastro Detal'
              where id = ${c.studentId}`
    await createInstance(sql, c)
    await svc.rpc('record_ui_event', {
      p_user: userId,
      p_role: 'student',
      p_path: '/portal/aulas',
      p_event: 'page_view',
      p_meta: {},
    })
    const hash = opts.hash ?? hashAleatorio()
    await svc.rpc('record_client_error', {
      p_hash: hash,
      p_message: 'Rastro',
      p_stack: null,
      p_path: '/portal',
      p_user: userId,
    })
    const aluna = await clientAs(userId, 'student')
    await aluna.rpc('ack_channel_notice', { p_policy_version_id: await idDaVigente() })
    return { ...c, userId, hash }
  }

  it('o export do aluno traz aceites, eventos de uso e erros de cliente', async () => {
    const f = await alunoComRastro()
    const r = await buildStudentExport(admin, f.studentId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.contratos.length).toBeGreaterThanOrEqual(1)
    expect(r.payload.aulas.length).toBeGreaterThanOrEqual(1)
    expect(r.payload.politicas_aceitas).toHaveLength(1)
    expect(r.payload.eventos_de_uso).toHaveLength(1)
    expect(r.payload.erros_de_cliente).toHaveLength(1)
    const evento = r.payload.eventos_de_uso[0] as { path: string }
    expect(evento.path).toBe('/portal/aulas')
  })

  it('CORREÇÃO 6: o export de B enxerga o erro de B mesmo quando A chegou antes', async () => {
    // Com a chave só no hash, a linha era de quem topasse PRIMEIRO com o
    // defeito e o export de todo mundo depois saía vazio.
    const hash = hashAleatorio()
    const a = await alunoComRastro({ hash })
    const b = await alunoComRastro({ hash })
    expect(a.studentId).not.toBe(b.studentId)
    for (const f of [a, b]) {
      const r = await buildStudentExport(admin, f.studentId)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.payload.erros_de_cliente).toHaveLength(1)
    }
  })

  it('aluno inexistente devolve 404 sem vazar detalhe', async () => {
    const r = await buildStudentExport(admin, '00000000-0000-0000-0000-000000000000')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('CORREÇÃO 7: consulta que falha LANÇA — nada de arquivo pela metade', async () => {
    const alunoOk: Resp = { data: [{ id: 'x', display_name: 'Fulana' }], error: null }

    // (a) uma seção de detalhe falha
    const comFalha = stubSupabase(
      {
        contracts: { data: [{ id: 'c1' }], error: null },
        students: { data: { profile_id: 'p1' }, error: null },
        ui_events: { data: null, error: { message: 'permission denied for table ui_events' } },
      },
      alunoOk,
    )
    await expect(buildStudentExport(comFalha, 'aluno')).rejects.toThrow(ExportIncompletoError)
    await expect(buildStudentExport(comFalha, 'aluno')).rejects.toThrow(/eventos_de_uso/)

    // (b) a própria lista de contratos falha — o export não pode seguir com []
    const semContratos = stubSupabase(
      { contracts: { data: null, error: { message: 'timeout' } } },
      alunoOk,
    )
    await expect(buildStudentExport(semContratos, 'aluno')).rejects.toThrow(/contratos/)

    // (c) tudo certo continua passando pelo mesmo caminho
    const saudavel = stubSupabase(
      { contracts: { data: [], error: null }, students: { data: { profile_id: null }, error: null } },
      alunoOk,
    )
    const ok = await buildStudentExport(saudavel, 'aluno')
    expect(ok.ok).toBe(true)
  })

  it('anonimizar zera o user_id da telemetria e mantém o evento', async () => {
    const f = await alunoComRastro()
    await sql`update contracts set status = 'ended', ended_on = current_date where id = ${f.contractId}`
    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId,
      p_confirm: 'Rastro Detal',
    })
    expect(error).toBeNull()
    const r = data as { ui_events: number; client_errors: number }
    expect(r.ui_events).toBe(1)
    expect(r.client_errors).toBe(1)

    const restantes = await sql`select 1 from ui_events where user_id = ${f.userId}`
    expect(restantes).toHaveLength(0)
    const desidentificado = await sql`
      select 1 from ui_events where user_id is null and path = '/portal/aulas'`
    expect(desidentificado.length).toBeGreaterThanOrEqual(1)
    const semDono = await sql`select 1 from client_errors where user_id = ${f.userId}`
    expect(semDono).toHaveLength(0)
  })

  it('anonimizar FUNDE o balde da pessoa no anônimo sem perder a contagem', async () => {
    const hash = hashAleatorio()
    // já existe um balde anônimo para o mesmo defeito
    await svc.rpc('record_client_error', {
      p_hash: hash, p_message: 'Compartilhado', p_stack: null, p_path: '/portal', p_user: null,
    })
    const f = await alunoComRastro({ hash })
    await svc.rpc('record_client_error', {
      p_hash: hash, p_message: 'Compartilhado', p_stack: null, p_path: '/portal', p_user: f.userId,
    })
    const antes = await sql`select user_id, count from client_errors where hash = ${hash}`
    expect(antes).toHaveLength(2)
    const totalAntes = antes.reduce((s, l) => s + Number(l.count), 0)

    await sql`update contracts set status = 'ended', ended_on = current_date where id = ${f.contractId}`
    const { error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId,
      p_confirm: 'Rastro Detal',
    })
    expect(error).toBeNull()

    const depois = await sql`select user_id, count from client_errors where hash = ${hash}`
    expect(depois).toHaveLength(1)
    expect(depois[0].user_id).toBeNull()
    // a contagem do DEFEITO não encolhe porque alguém foi esquecido
    expect(Number(depois[0].count)).toBe(totalAntes)
  })
})

/* ==========================================================================
   REVISÃO ADVERSARIAL RETROATIVA Nº 2 (Sol, 26/07) — B1 a B4
   ========================================================================== */

/** Promessa que outro trecho resolve — para orquestrar duas conexões. */
function deferido() {
  let resolve!: () => void
  const promessa = new Promise<void>((r) => {
    resolve = r
  })
  return { promessa, resolve }
}

describe('B1 · corrida publicação × aceite', () => {
  const kindNovo = () => 'teste-lock-' + crypto.randomUUID().slice(0, 8)

  async function publicar(kind: string, versao: number, texto: string, vigencia?: string) {
    const [r] = vigencia
      ? await sql`select public.publish_policy_version(${kind}, ${versao}, ${texto}, ${vigencia}::date) as id`
      : await sql`select public.publish_policy_version(${kind}, ${versao}, ${texto}) as id`
    return r.id as string
  }

  async function alunaComPerfil() {
    const userId = await createAuthUser(sql, 'student', 'Aluna da corrida')
    const c = await createPrivateContract(sql)
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    return { userId, studentId: c.studentId }
  }

  const claimsDe = (userId: string) =>
    JSON.stringify({ sub: userId, app_metadata: { role: 'student' } })

  it('o INSERT direto em policy_versions é barrado — publicar é pela RPC', async () => {
    await expect(
      sql`insert into policy_versions (kind, version, body_md) values ('direto', 1, 'texto')`,
    ).rejects.toThrow(/publish_policy_version/)
    // e a RPC publica normalmente
    const kind = kindNovo()
    const id = await publicar(kind, 1, 'texto')
    const [linha] = await sql`select kind, version from policy_versions where id = ${id}`
    expect(linha.kind).toBe(kind)
    expect(linha.version).toBe(1)
  })

  it('CORRIDA REAL: v2 publicada depois da leitura ⇒ o aceite da v1 falha limpo', async () => {
    // A ordem exata do achado: A abre transação e LÊ a vigente (é o que a
    // página renderizou), B publica a v2 e COMMITA, A tenta gravar o aceite.
    // Antes do lock, o INSERT de A passava — READ COMMITTED dá snapshot novo a
    // cada comando, e nada segurava a publicação entre o SELECT e o INSERT.
    const kind = kindNovo()
    const v1 = await publicar(kind, 1, 'texto v1')
    const { userId, studentId } = await alunaComPerfil()

    const outra = connect(1)
    try {
      await expect(
        sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claimsDe(userId)}, true)`
          const lida = await tx`select id from public.policy_vigente(${kind})`
          expect(lida[0].id).toBe(v1)

          // B, em OUTRA conexão: publica a v2 e commita.
          await outra`select public.publish_policy_version(${kind}, 2, 'texto v2')`

          // A grava o aceite do que leu — e é aqui que a versão morta entraria.
          await tx`select public._accept_policy_locked(${kind}, ${v1}::uuid)`
        }),
      ).rejects.toThrow(/politica-desatualizada/)
    } finally {
      await outra.end()
    }

    // nada gravado: aceite de versão morta é a única coisa que a tabela não
    // pode conter
    const aceites = await sql`
      select 1 from policy_acceptances pa
       join policy_versions pv on pv.id = pa.policy_version_id
      where pa.student_id = ${studentId} and pv.kind = ${kind}`
    expect(aceites).toHaveLength(0)
  })

  it('o aceite ESPERA a publicação em curso (é o lock, não a sorte)', async () => {
    const kind = kindNovo()
    const v1 = await publicar(kind, 1, 'texto v1')
    const { userId, studentId } = await alunaComPerfil()

    const publicadora = connect(1)
    const aceitante = connect(1)
    const publicou = deferido()
    const solte = deferido()

    // B segura o lock: publica a v2 numa transação que NÃO commita ainda.
    const publicacao = publicadora.begin(async (tx) => {
      await tx`select public.publish_policy_version(${kind}, 2, 'texto v2')`
      publicou.resolve()
      await solte.promessa
    })
    await publicou.promessa

    let terminou = false
    const aceite = aceitante
      .begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claimsDe(userId)}, true)`
        await tx`select public._accept_policy_locked(${kind}, ${v1}::uuid)`
      })
      .finally(() => {
        terminou = true
      })
    const desfecho = aceite.catch((e: unknown) => e)

    await new Promise((r) => setTimeout(r, 400))
    // sem o lock isto já teria terminado (é consulta local, de milissegundos):
    // o aceite está ESPERANDO a publicação decidir.
    expect(terminou).toBe(false)

    solte.resolve()
    await publicacao
    // ao acordar, o aceite lê a vigente REAL (v2) e recusa a v1
    expect(String(await desfecho)).toMatch(/politica-desatualizada/)

    await publicadora.end()
    await aceitante.end()

    const aceites = await sql`
      select 1 from policy_acceptances pa
       join policy_versions pv on pv.id = pa.policy_version_id
      where pa.student_id = ${studentId} and pv.kind = ${kind}`
    expect(aceites).toHaveLength(0)
  })
})

/* ========================================================================== */
/* S2 · corrida telemetria × anonimização (revisão adversarial nº 3)           */
/* ========================================================================== */

describe('S2 · a telemetria não reidentifica quem foi esquecido', () => {
  it('CORRIDA REAL: o evento ESPERA a anonimização e nasce anônimo', async () => {
    // Fixture: ex-aluno com login, contrato encerrado (a RPC exige).
    const nome = 'Corrida Telemetria'
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', nome)
    await sql`update students set profile_id = ${userId}, display_name = ${nome}
               where id = ${c.studentId}`
    await sql`update contracts set status = 'ended', ended_on = current_date
               where id = ${c.contractId}`
    const adminId = await createAuthUser(sql, 'admin', 'Admin da corrida')
    const claimsAdmin = JSON.stringify({ sub: adminId, app_metadata: { role: 'admin' } })
    const caminho = '/portal/corrida-' + crypto.randomUUID().slice(0, 8)

    const anonimizadora = connect(1)
    const telemetria = connect(1)
    const carimbou = deferido()
    const solte = deferido()

    // B segura a transação da anonimização (o carimbo em profiles já está
    // aplicado, a limpeza de ui_events já passou) SEM commitar.
    const trabalho = anonimizadora.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claimsAdmin}, true)`
      await tx`select public.admin_anonymize_student(${c.studentId}, ${nome})`
      carimbou.resolve()
      await solte.promessa
    })
    await carimbou.promessa

    // A é a aba ainda aberta da pessoa: manda um evento com o user_id dela.
    let terminou = false
    const evento = telemetria`
      select public.record_ui_event(${userId}, 'student', ${caminho})`.then(() => {
      terminou = true
    })

    await new Promise((r) => setTimeout(r, 400))
    // SEM o `for share` isto já teria terminado (insert local, milissegundos) —
    // e a linha identificada entraria DEPOIS da limpeza, que é o achado.
    expect(terminou).toBe(false)

    solte.resolve()
    await trabalho
    await evento

    await anonimizadora.end()
    await telemetria.end()

    // O evento existe (série histórica sem buraco) e é ANÔNIMO.
    const linhas = await sql`select user_id from ui_events where path = ${caminho}`
    expect(linhas).toHaveLength(1)
    expect(linhas[0].user_id).toBeNull()
    const identificadas = await sql`select 1 from ui_events where user_id = ${userId}`
    expect(identificadas).toHaveLength(0)
  })

  it('erro de cliente concorrente também cai no balde anônimo', async () => {
    const nome = 'Corrida Erro'
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', nome)
    await sql`update students set profile_id = ${userId}, display_name = ${nome}
               where id = ${c.studentId}`
    await sql`update contracts set status = 'ended', ended_on = current_date
               where id = ${c.contractId}`
    const adminId = await createAuthUser(sql, 'admin', 'Admin da corrida 2')
    const claimsAdmin = JSON.stringify({ sub: adminId, app_metadata: { role: 'admin' } })
    // só LETRAS: `normalizeMessage` colapsa uuid em `<id>` e dígitos em `<n>` —
    // um uuid cru daria o MESMO hash em toda rodada, e o balde seria o de ontem.
    const hash = errorHash(
      'TypeError',
      'corrida ' + crypto.randomUUID().replace(/[^a-f]/g, ''),
      '/portal',
    )

    const anonimizadora = connect(1)
    const telemetria = connect(1)
    const carimbou = deferido()
    const solte = deferido()

    const trabalho = anonimizadora.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claimsAdmin}, true)`
      await tx`select public.admin_anonymize_student(${c.studentId}, ${nome})`
      carimbou.resolve()
      await solte.promessa
    })
    await carimbou.promessa

    let terminou = false
    const erro = julgadaDepois(
      telemetria`
      select public.record_client_error(${hash}, 'quebrou', null, '/portal', ${userId})`.then(
        () => {
          terminou = true
        },
      ),
    )
    await new Promise((r) => setTimeout(r, 400))
    expect(terminou).toBe(false)

    solte.resolve()
    await trabalho
    await erro
    await anonimizadora.end()
    await telemetria.end()

    const baldes = await sql`select user_id from client_errors where hash = ${hash}`
    expect(baldes).toHaveLength(1)
    expect(baldes[0].user_id).toBeNull()
  })
})

describe('B2 · o fechamento diário tem três tentativas', () => {
  it('as entradas do cron são exatamente as três — e batem com a constante do app', async () => {
    const jobs = await sql`
      select jobname, schedule from cron.job
       where command like '%capture_kpi_snapshot%'
       order by jobname`
    expect(jobs.map((j) => [j.jobname, j.schedule])).toEqual([
      ['capture-kpi-snapshot-daily', '0 7 * * *'],
      ['capture-kpi-snapshot-retry-1', '20 7 * * *'],
      ['capture-kpi-snapshot-retry-2', '0 9 * * *'],
    ])

    // O aviso "fechamento de hoje ainda não disponível" só é honesto se o app
    // souber a hora da ÚLTIMA tentativa. Aqui as duas pontas se conferem.
    const emMinutos = jobs
      .map((j) => String(j.schedule).split(' '))
      .map(([min, hora]) => Number(hora) * 60 + Number(min))
      .sort((a, b) => a - b)
    expect(emMinutos).toEqual([...TENTATIVAS_DE_FECHAMENTO_UTC])
  })

  it('a repetição no MESMO dia não duplica nem reescreve a foto', async () => {
    await svc.rpc('capture_kpi_snapshot')
    const [antes] = await sql`
      select data ->> 'generated_at' as gerado from kpi_snapshots
       where captured_on = public.business_today()`

    const segunda = await svc.rpc('capture_kpi_snapshot')
    const terceira = await svc.rpc('capture_kpi_snapshot')
    expect(segunda.data).toBe(false)
    expect(terceira.data).toBe(false)

    const linhas = await sql`
      select data ->> 'generated_at' as gerado from kpi_snapshots
       where captured_on = public.business_today()`
    expect(linhas).toHaveLength(1)
    // a foto do dia é a da PRIMEIRA captura — a retentativa existe para o caso
    // de não ter havido nenhuma, não para sobrescrever
    expect(linhas[0].gerado).toBe(antes.gerado)
  })
})

describe('B3 · anonimizado não volta a ser identificado', () => {
  it('telemetria gravada DEPOIS da anonimização entra sem usuário', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Esquecida Total')
    await sql`update students set profile_id = ${userId}, display_name = 'Esquecida Total'
              where id = ${c.studentId}`
    await sql`update contracts set status = 'ended', ended_on = current_date where id = ${c.contractId}`

    const { error } = await admin.rpc('admin_anonymize_student', {
      p_student: c.studentId,
      p_confirm: 'Esquecida Total',
    })
    expect(error).toBeNull()

    // o carimbo é da MESMA transação da anonimização
    const [p] = await sql`select anonymized_at from profiles where id = ${userId}`
    expect(p.anonymized_at).not.toBeNull()

    // A janela do achado: a aba dela ainda está aberta e o beacon chega agora.
    const caminho = '/portal/depois-' + crypto.randomUUID().slice(0, 8)
    await svc.rpc('record_ui_event', {
      p_user: userId,
      p_role: 'student',
      p_path: caminho,
      p_event: 'page_view',
      p_meta: {},
    })
    const hash = hashAleatorio()
    await svc.rpc('record_client_error', {
      p_hash: hash,
      p_message: 'depois da anonimização',
      p_stack: null,
      p_path: caminho,
      p_user: userId,
    })

    // o EVENTO fica (série histórica sem buraco), a pessoa não volta
    const evento = await sql`select user_id from ui_events where path = ${caminho}`
    expect(evento).toHaveLength(1)
    expect(evento[0].user_id).toBeNull()
    const erro = await sql`select user_id from client_errors where hash = ${hash}`
    expect(erro).toHaveLength(1)
    expect(erro[0].user_id).toBeNull()
    // e nada de novo com o id dela em lugar nenhum
    expect(await sql`select 1 from ui_events where user_id = ${userId}`).toHaveLength(0)
    expect(await sql`select 1 from client_errors where user_id = ${userId}`).toHaveLength(0)
  })

  it('a falha do ban do Auth vira registro na auditoria (fail-closed da action)', async () => {
    const c = await createPrivateContract(sql)
    const { error } = await admin.rpc('admin_report_anonymize_failure', {
      p_student: c.studentId,
      p_detail: 'AuthApiError: unable to update user',
    })
    expect(error).toBeNull()
    const [a] = await sql`
      select diff from audit_log
       where action = 'anonymize_student_auth_failed' and entity_id = ${c.studentId}::text
       order by at desc limit 1`
    expect(a.diff.detalhe).toContain('unable to update user')

    // e é restrita à admin
    const daProfessora = await teacher.rpc('admin_report_anonymize_failure', {
      p_student: c.studentId,
      p_detail: 'x',
    })
    expect(daProfessora.error?.message).toContain('restrita à admin')
  })
})

describe('B4 · entradas e saídas não contam o futuro', () => {
  /** Conta os dois números pela fórmula REAL (a RPC), dentro da transação. */
  async function entradasSaidas(tx: TransactionSql) {
    const [r] = await tx`
      select (public._admin_kpis_compute() -> 'entradas_saidas_do_mes' ->> 'novos')::int as novos,
             (public._admin_kpis_compute() -> 'entradas_saidas_do_mes' ->> 'encerrados')::int as encerrados`
    return { novos: r.novos as number, encerrados: r.encerrados as number }
  }

  it('contrato que começa/termina AMANHÃ não conta hoje; conta quando o dia chega', async () => {
    // REPEATABLE READ + rollback: a suíte roda arquivos em paralelo e outros
    // testes criam contratos com started_on = hoje o tempo todo. Com o snapshot
    // fixo, o único movimento visível é o desta transação — e nada dela fica.
    const sentinela = 'rollback-b4'
    await expect(
      sql.begin(async (tx) => {
        await tx`set transaction isolation level repeatable read`
        const zero = await entradasSaidas(tx)

        const [aluno] = await tx`
          insert into students (display_name, iana_tz, tz_confirmed)
          values ('Entrada futura', 'America/Cuiaba', true) returning id`
        const [prof] = await tx`insert into teachers (hourly_rate_cents) values (10000) returning id`
        const novo = async (offsetDias: number) => {
          const [c] = await tx`
            insert into contracts
              (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
               monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
            values ('private_1on1', ${aluno.id}, ${prof.id}, 'b4', 15000, 4, 24, 90,
                    public.business_today() + ${offsetDias}::int)
            returning id`
          return c.id as string
        }

        // (1) a virada que `admin_renew_contract` cria com semanas de
        // antecedência: começa AMANHÃ.
        const futuro = await novo(1)
        const comFuturo = await entradasSaidas(tx)
        expect(comFuturo.novos).toBe(zero.novos)

        // (2) quando o dia chega, ele é entrada
        await tx`update contracts set started_on = public.business_today() where id = ${futuro}`
        const comHoje = await entradasSaidas(tx)
        expect(comHoje.novos).toBe(zero.novos + 1)

        // (3) mesma régua na saída: encerramento AGENDADO não é saída de hoje
        const saindo = await novo(-5)
        await tx`update contracts set status = 'ended', ended_on = public.business_today() + 1
                  where id = ${saindo}`
        const comSaidaFutura = await entradasSaidas(tx)
        expect(comSaidaFutura.encerrados).toBe(zero.encerrados)

        await tx`update contracts set ended_on = public.business_today() where id = ${saindo}`
        const comSaidaHoje = await entradasSaidas(tx)
        expect(comSaidaHoje.encerrados).toBe(zero.encerrados + 1)

        throw new Error(sentinela)
      }),
    ).rejects.toThrow(sentinela)
  })
})
