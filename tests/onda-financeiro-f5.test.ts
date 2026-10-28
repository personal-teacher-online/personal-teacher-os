// F5 (Onda Financeiro, PLAN-APPROVED) — emissão de cobrança avulsa pelo app:
//   · espelho da avulsa ancorado na AULA (payments.class_instance_id, XOR com
//     contract_id) — o webhook DEIXOU de dar early-return: espelha pela RPC
//     única e quita em passo separado;
//   · trava anti-corrida por INSERT (payment_emissions): duas emissões
//     simultâneas ⇒ NO MÁXIMO 1 POST; claim estagnada (> 5 min) é tomada;
//   · GET antes do POST (a API não tem idempotência — fato do gate F0):
//     timeout depois de o Asaas criar ⇒ ADOÇÃO, nunca duplicação;
//   · pagador pronto é régua ÚNICA (avulsa_pagador_pronto) para tela e action.
// Sandbox real NUNCA entra aqui: o Asaas é dublê de fetch (padrão da casa).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { AsaasConfig } from '../src/lib/asaas/client'
import { emitirCobrancaDaAvulsa } from '../src/lib/asaas/emissao'
import { handleAsaasWebhook } from '../src/lib/webhooks/asaas'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, type PrivateContract } from './helpers/db'

const TOKEN = 'tok-teste-f5'
const CFG: AsaasConfig = {
  apiKey: 'chave-teste',
  ambiente: 'sandbox',
  baseUrl: 'https://api-sandbox.asaas.com/v3',
}

let sql: Sql
const service = serviceClient()

beforeAll(() => {
  sql = connect(4)
})
afterAll(async () => {
  await sql.end()
})

let proximaHora = 0

/** Aula avulsa extra_paid do contrato (o cenário-base da emissão). */
async function criarAvulsa(
  c: PrivateContract,
  over: { kind?: string; priceCents?: number | null } = {},
): Promise<string> {
  const [r] = await sql`
    insert into class_instances
      (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
       state, single_kind, single_price_cents)
    values (${c.contractId}, ${c.teacherId},
            now() + make_interval(hours => ${120 + proximaHora}),
            now() + make_interval(hours => ${120 + proximaHora}, mins => 50),
            'avulsa F5', 'scheduled',
            ${over.kind ?? 'extra_paid'}, ${over.priceCents === undefined ? 15000 : over.priceCents})
    returning id`
  proximaHora += 1 // horários distintos: a exclusão de sobreposição da professora é real
  return r.id as string
}

/** Pagador com cadastro Asaas + vínculo com o aluno do contrato. */
async function vincularPagador(
  c: PrivateContract,
  rel: 'self' | 'terceiro' = 'self',
): Promise<{ payerId: string; cus: string }> {
  const cus = 'cus_f5_' + crypto.randomUUID().slice(0, 8)
  const [p] = await sql`
    insert into payers (name, email, asaas_customer_id)
    values ('Pagador F5', 'pagador.f5@x.com', ${cus})
    returning id`
  await sql`
    insert into student_payers (student_id, payer_id, relationship)
    values (${c.studentId}, ${p.id}, ${rel})`
  return { payerId: p.id as string, cus }
}

function evt(payment: Record<string, unknown>, event = 'PAYMENT_RECEIVED') {
  return {
    id: 'evt_f5_' + crypto.randomUUID().slice(0, 12),
    event,
    payment: {
      id: 'pay_f5_' + crypto.randomUUID().slice(0, 12),
      value: 150.0,
      billingType: 'BOLETO',
      dueDate: '2026-09-10',
      ...payment,
    },
  }
}

async function webhook(payload: unknown) {
  return handleAsaasWebhook(service, { token: TOKEN, expectedToken: TOKEN, payload })
}

/** Dublê do Asaas: conta os POSTs e devolve o que cada rota deve responder. */
function asaasDuble(opts: {
  posPost?: 'ok' | 'explode-depois-de-criar'
  postDelayMs?: number
}) {
  const estado = { posts: 0, criada: null as Record<string, unknown> | null }
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    // Só o ASAAS é dublado — o supabase-js continua falando com o banco local.
    if (!u.startsWith(CFG.baseUrl)) return original(url as never, init)
    if (u.includes('/payments?externalReference=')) {
      return new Response(JSON.stringify({ data: estado.criada ? [estado.criada] : [] }), { status: 200 })
    }
    if (u.endsWith('/payments') && init?.method === 'POST') {
      estado.posts++
      if (opts.postDelayMs) await new Promise((r) => setTimeout(r, opts.postDelayMs))
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      estado.criada = {
        id: 'pay_emitida_' + crypto.randomUUID().slice(0, 8),
        customer: body.customer,
        value: body.value,
        status: 'PENDING',
        billingType: body.billingType,
        dueDate: body.dueDate,
        externalReference: body.externalReference,
        invoiceUrl: 'https://sandbox.asaas.com/i/f5emitida',
      }
      if (opts.posPost === 'explode-depois-de-criar') {
        throw new Error('socket hang up (o Asaas criou, a resposta não chegou)')
      }
      return new Response(JSON.stringify(estado.criada), { status: 200 })
    }
    throw new Error(`dublê não esperava: ${init?.method ?? 'GET'} ${u}`)
  }) as typeof fetch
  return { estado, restaurar: () => (globalThis.fetch = original) }
}

/* ========================================================================== */
/* 1. O webhook espelha a avulsa (transições + replay)                         */
/* ========================================================================== */

describe('F5 — webhook: a avulsa é ESPELHADA (fim do early-return) e quita em passo separado', () => {
  it('PENDING → RECEIVED → estorno → replay: espelho e aula certos em cada passo', async () => {
    const c = await createPrivateContract(sql)
    const aula = await criarAvulsa(c)
    const payId = 'pay_f5_trans_' + crypto.randomUUID().slice(0, 8)

    // PENDING: espelha ancorado na AULA, sem quitar
    const criado = evt({ id: payId, externalReference: aula, status: 'PENDING' }, 'PAYMENT_CREATED')
    expect((await webhook(criado)).status).toBe(200)
    let [pay] = await sql`
      select contract_id, class_instance_id, status, paid_at from payments
       where asaas_payment_id = ${payId}`
    expect(pay.class_instance_id).toBe(aula)
    expect(pay.contract_id).toBeNull() // âncora XOR: avulsa aponta a aula
    expect(pay.paid_at).toBeNull()
    let [ci] = await sql`select single_paid_at from class_instances where id = ${aula}`
    expect(ci.single_paid_at).toBeNull()

    // RECEIVED: espelho evolui E a aula quita
    const pago = evt({ id: payId, externalReference: aula, status: 'RECEIVED', paymentDate: '2026-09-04' })
    expect((await webhook(pago)).status).toBe(200)
    ;[pay] = await sql`select status, paid_at from payments where asaas_payment_id = ${payId}`
    expect(pay.status).toBe('RECEIVED')
    expect(pay.paid_at).not.toBeNull()
    ;[ci] = await sql`select single_paid_at from class_instances where id = ${aula}`
    expect(ci.single_paid_at).not.toBeNull()

    // estorno: o espelho conta a verdade (a régua da tela mostra "estornada")
    const estorno = evt(
      { id: payId, externalReference: aula, status: 'REFUNDED', paymentDate: '2026-09-04' },
      'PAYMENT_REFUNDED',
    )
    expect((await webhook(estorno)).status).toBe(200)
    ;[pay] = await sql`select status from payments where asaas_payment_id = ${payId}`
    expect(pay.status).toBe('REFUNDED')

    // replay do RECEIVED (mesmo event id): sem efeito extra, UMA linha só
    expect((await webhook(pago)).status).toBe(200)
    const [{ n }] = await sql`
      select count(*)::int as n from payments where class_instance_id = ${aula}`
    expect(n).toBe(1)
    ;[pay] = await sql`select status from payments where asaas_payment_id = ${payId}`
    expect(pay.status).toBe('REFUNDED') // o replay antigo não regride o estado
  })

  it('âncora XOR no banco: espelho com as duas âncoras (ou nenhuma) é IMPOSSÍVEL', async () => {
    const c = await createPrivateContract(sql)
    const aula = await criarAvulsa(c)
    await expect(sql`
      insert into payments (asaas_payment_id, contract_id, class_instance_id)
      values ('pay_f5_xor2', ${c.contractId}, ${aula})`).rejects.toThrow(/payments_ancora_xor/)
    await expect(sql`
      insert into payments (asaas_payment_id) values ('pay_f5_xor0')`).rejects.toThrow(/payments_ancora_xor/)
  })
})

/* ========================================================================== */
/* 2. A régua do pagador pronto                                                */
/* ========================================================================== */

describe('F5 — avulsa_pagador_pronto: a régua única da tela e da action', () => {
  it('sem vínculo → vazio; um terceiro com cadastro → ele; dois terceiros → vazio; self vence', async () => {
    const c = await createPrivateContract(sql)
    const aula = await criarAvulsa(c)

    let r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([])

    const t1 = await vincularPagador(c, 'terceiro')
    r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect((r.data as { asaas_customer_id: string }[])[0]?.asaas_customer_id).toBe(t1.cus)

    await vincularPagador(c, 'terceiro') // segundo terceiro: ambíguo
    r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect(r.data).toEqual([])

    const s = await vincularPagador(c, 'self') // self desempata
    r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect((r.data as { asaas_customer_id: string }[])[0]?.asaas_customer_id).toBe(s.cus)
  })

  it('cortesia não tem pagador pronto (não é cobrável)', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const cortesia = await criarAvulsa(c, { kind: 'courtesy', priceCents: null })
    const r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: cortesia })
    expect(r.data).toEqual([])
  })
})

/* ========================================================================== */
/* 3. A emissão: concorrência, timeout/adoção, validações                      */
/* ========================================================================== */

describe('F5 — emitirCobrancaDaAvulsa: a trava e a reconciliação', () => {
  it('duas emissões SIMULTÂNEAS ⇒ 1 POST, 1 espelho; a perdedora explica', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const duble = asaasDuble({ postDelayMs: 250 })
    try {
      const [r1, r2] = await Promise.all([
        emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' }),
        emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' }),
      ])
      expect(duble.estado.posts).toBe(1)
      const [venceu, perdeu] = r1.ok ? [r1, r2] : [r2, r1]
      expect(venceu.ok).toBe(true)
      expect(venceu.adotada).toBe(false)
      expect(perdeu.ok).toBe(false)
      expect(perdeu.frase).toContain('em andamento')
    } finally {
      duble.restaurar()
    }
    const [{ n }] = await sql`
      select count(*)::int as n from payments where class_instance_id = ${aula}`
    expect(n).toBe(1)
    const [aud] = await sql`
      select diff from audit_log where action = 'asaas.emitir_avulsa'
       and diff ->> 'class_instance_id' = ${aula}`
    expect(aud.diff.adotada).toBe(false)
  })

  it('timeout DEPOIS de o Asaas criar ⇒ a retomada ADOTA (claim estagnada), nunca duplica', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const duble = asaasDuble({ posPost: 'explode-depois-de-criar' })
    try {
      const r1 = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r1.ok).toBe(false)
      expect(duble.estado.posts).toBe(1)

      // retry IMEDIATO: a claim é de agora — recusa honesta, sem POST
      const r2 = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r2.ok).toBe(false)
      expect(r2.frase).toContain('em andamento')

      // 5 minutos depois (claim estagnada): a retomada toma a trava e ADOTA
      await sql`
        update payment_emissions set created_at = now() - interval '6 minutes'
         where class_instance_id = ${aula}`
      const r3 = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r3.ok).toBe(true)
      expect(r3.adotada).toBe(true)
      expect(duble.estado.posts).toBe(1) // NUNCA um segundo POST
    } finally {
      duble.restaurar()
    }
    const [{ n }] = await sql`
      select count(*)::int as n from payments where class_instance_id = ${aula}`
    expect(n).toBe(1)
  })

  it('a claim valida a aula: cortesia, sem valor, já paga e já espelhada são recusadas', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')

    const cortesia = await criarAvulsa(c, { kind: 'courtesy', priceCents: null })
    let r = await service.rpc('emitir_avulsa_claim', { p_class_instance: cortesia })
    expect(r.error?.message).toMatch(/EXTRA COBRADA/i)

    const semValor = await criarAvulsa(c, { priceCents: null })
    r = await service.rpc('emitir_avulsa_claim', { p_class_instance: semValor })
    expect(r.error?.message).toMatch(/sem valor/)

    const paga = await criarAvulsa(c)
    await sql`update class_instances set single_paid_at = now() where id = ${paga}`
    r = await service.rpc('emitir_avulsa_claim', { p_class_instance: paga })
    expect(r.error?.message).toMatch(/já está paga/)

    const espelhada = await criarAvulsa(c)
    await webhook(evt({ externalReference: espelhada, status: 'PENDING' }, 'PAYMENT_CREATED'))
    r = await service.rpc('emitir_avulsa_claim', { p_class_instance: espelhada })
    expect(r.error?.message).toMatch(/cobrança ativa espelhada/)
  })

  it('ACL: aluno não emite claim; a régua do pagador devolve VAZIO para ele', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno F5 ACL'), 'student')
    const claim = await aluno.rpc('emitir_avulsa_claim', { p_class_instance: aula })
    expect(claim.error).not.toBeNull()
    const pagador = await aluno.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect(pagador.data ?? []).toEqual([])
  })
})

/* ========================================================================== */
/* 4. Os consertos da rodada do Sol (F5)                                       */
/* ========================================================================== */

describe('F5 — achados do Sol aplicados', () => {
  it('P1: reconciliação AMBÍGUA (2+ cobranças ativas na mesma referência) PARA — nada adotado', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (!u.startsWith(CFG.baseUrl)) return original(url as never, init)
      return new Response(
        JSON.stringify({ data: [{ id: 'pay_dup_a' }, { id: 'pay_dup_b' }] }),
        { status: 200 },
      )
    }) as typeof fetch
    try {
      const r = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r.ok).toBe(false)
      expect(r.frase).toContain('2 cobranças ativas')
    } finally {
      globalThis.fetch = original
    }
    const [{ n }] = await sql`
      select count(*)::int as n from payments where class_instance_id = ${aula}`
    expect(n).toBe(0)
  })

  it('P1: a CERCA da claim — retomada muda o stamp e o dono antigo perde a vigência', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)

    const c1 = await service.rpc('emitir_avulsa_claim', { p_class_instance: aula })
    expect(c1.error).toBeNull()
    const stamp1 = (c1.data as { stamp: string }).stamp
    expect(await service.rpc('emissao_claim_vigente', { p_class_instance: aula, p_stamp: stamp1 }))
      .toMatchObject({ data: true })

    // estagnou → outra tentativa toma a trava; o stamp1 morre
    await sql`
      update payment_emissions set created_at = now() - interval '6 minutes'
       where class_instance_id = ${aula}`
    const c2 = await service.rpc('emitir_avulsa_claim', { p_class_instance: aula })
    expect((c2.data as { claimed: boolean }).claimed).toBe(true)
    const stamp2 = (c2.data as { stamp: string }).stamp
    expect(stamp2).not.toBe(stamp1)
    expect(await service.rpc('emissao_claim_vigente', { p_class_instance: aula, p_stamp: stamp1 }))
      .toMatchObject({ data: false })
    expect(await service.rpc('emissao_claim_vigente', { p_class_instance: aula, p_stamp: stamp2 }))
      .toMatchObject({ data: true })
  })

  it('P1: a trilha da emissão sai NA MESMA transação do espelho (audit atômico)', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const duble = asaasDuble({})
    try {
      const r = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r.ok).toBe(true)
    } finally {
      duble.restaurar()
    }
    const [aud] = await sql`
      select actor, entity_id, diff from audit_log
       where action = 'asaas.emitir_avulsa' and diff ->> 'class_instance_id' = ${aula}`
    expect(aud).toBeDefined()
    expect(aud.diff.actor).toBeUndefined() // o ator vira coluna, não fica no diff
  })

  it('P2: aula CANCELADA não tem pagador pronto (o botão não nasce)', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    await sql`update class_instances set state = 'cancelled' where id = ${aula}`
    const r = await service.rpc('avulsa_pagador_pronto', { p_class_instance: aula })
    expect(r.data).toEqual([])
  })

  it('P2: o ALUNO enxerga a cobrança da avulsa no portal — e o link com as guardas do F3', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno F5 Portal')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const aula = await criarAvulsa(c)

    const cus = 'cus_f5_portal_' + crypto.randomUUID().slice(0, 6)
    const pago = evt({
      externalReference: aula,
      customer: cus,
      status: 'PENDING',
      invoiceUrl: 'https://sandbox.asaas.com/i/f5portal',
    }, 'PAYMENT_CREATED')
    expect((await webhook(pago)).status).toBe(200)

    const aluno = await clientAs(userId, 'student')
    // vínculo nasceu TERCEIRO (webhook) → a linha aparece, o link NÃO
    let { data: linhas } = await aluno
      .from('payments_student')
      .select('class_instance_id, situacao, invoice_url')
      .eq('class_instance_id', aula)
    expect(linhas).toHaveLength(1)
    expect(linhas![0].invoice_url).toBeNull()

    // promovido a self → o link aparece (as guardas do F3 valem para a avulsa)
    const [payer] = await sql`select id from payers where asaas_customer_id = ${cus}`
    await sql`update student_payers set relationship = 'self'
       where student_id = ${c.studentId} and payer_id = ${payer.id}`
    ;({ data: linhas } = await aluno
      .from('payments_student')
      .select('class_instance_id, situacao, invoice_url')
      .eq('class_instance_id', aula))
    expect(linhas![0].invoice_url).toBe('https://sandbox.asaas.com/i/f5portal')
  })
})

/* ========================================================================== */
/* 5. Rodada 2 do Sol                                                          */
/* ========================================================================== */

describe('F5 — rodada 2 do Sol aplicada', () => {
  it('P1: PAYMENT_DELETED espelha como cancelada (o payload real mantém status PENDING)', async () => {
    const c = await createPrivateContract(sql)
    const aula = await criarAvulsa(c)
    const payId = 'pay_f5_del_' + crypto.randomUUID().slice(0, 8)

    await webhook(evt({ id: payId, externalReference: aula, status: 'PENDING' }, 'PAYMENT_CREATED'))
    // o DELETED real (fixture F0): status segue 'PENDING', deleted: true
    await webhook(evt(
      { id: payId, externalReference: aula, status: 'PENDING', deleted: true },
      'PAYMENT_DELETED',
    ))
    const [pay] = await sql`
      select status, public.payment_situacao(status, paid_at, due_date) as situacao
        from payments where asaas_payment_id = ${payId}`
    expect(pay.status).toBe('DELETED')
    expect(pay.situacao).toBe('cancelada')

    // P2: cobrança cancelada NÃO barra a reemissão — a claim volta a aceitar
    const r = await service.rpc('emitir_avulsa_claim', { p_class_instance: aula })
    expect(r.error).toBeNull()
    expect((r.data as { claimed: boolean }).claimed).toBe(true)
  })

  it('P1: adoção de cobrança JÁ RECEBIDA quita a aula na MESMA transação (sem depender de webhook)', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (!u.startsWith(CFG.baseUrl)) return original(url as never, init)
      // a cobrança já existe no Asaas, criada à mão no painel — e JÁ PAGA
      return new Response(JSON.stringify({
        data: [{
          id: 'pay_f5_adocao_paga', value: 180.0, status: 'RECEIVED',
          dueDate: '2026-09-01', paymentDate: '2026-09-01', billingType: 'BOLETO',
          externalReference: 'na-vida-real-o-uuid-da-aula',
        }],
      }), { status: 200 })
    }) as typeof fetch
    try {
      const r = await emitirCobrancaDaAvulsa(service, CFG, aula, { actorId: null, dueDate: '2026-09-15' })
      expect(r.ok).toBe(true)
      expect(r.adotada).toBe(true)
      // trilha e frase contam os números DA COBRANÇA (180), não do formulário
      // (\s: o toLocaleString separa "R$" do número com espaço NÃO-QUEBRÁVEL)
      expect(r.frase).toMatch(/R\$\s180,00/)
      expect(r.frase).toMatch(/— mas o valor da cobrança difere do valor da aula \(R\$\s150,00\)/)
    } finally {
      globalThis.fetch = original
    }
    const [ci] = await sql`select single_paid_at from class_instances where id = ${aula}`
    expect(ci.single_paid_at).not.toBeNull()
    const [aud] = await sql`
      select diff from audit_log
       where action = 'asaas.emitir_avulsa' and diff ->> 'class_instance_id' = ${aula}`
    expect(aud.diff.amount_cents).toBe(18000)
  })

  it('P1: a cerca revalida a COBRABILIDADE — aula cancelada depois da claim aborta o POST', async () => {
    const c = await createPrivateContract(sql)
    await vincularPagador(c, 'self')
    const aula = await criarAvulsa(c)
    const c1 = await service.rpc('emitir_avulsa_claim', { p_class_instance: aula })
    const stamp = (c1.data as { stamp: string }).stamp

    await sql`update class_instances set state = 'cancelled' where id = ${aula}`
    expect(await service.rpc('emissao_claim_vigente', { p_class_instance: aula, p_stamp: stamp }))
      .toMatchObject({ data: false })
  })
})
