// PAGAMENTOS · PERFIL · MENTORIA · FLUXOS (Onda do Portal · P5).
//
// Quatro coisas se provam aqui, e as quatro são dívidas que este milestone
// fecha:
//
//   1. A VOZ DA COBRANÇA. Uma linha ESTORNADA saía como "paga" — a
//      escola afirmando ter recebido o que devolveu. O desfecho passa a vir
//      nomeado do banco (`payment_situacao`) e a tela só traduz.
//   2. A VALIDADE DO RESGATE vem do FIFO. `/portal/resgatar` lia
//      `contract_credit_summary()`, que tira `min()` de TODAS as datas do replay
//      — inclusive as de créditos JÁ VENCIDOS e as de créditos já GASTOS.
//   3. O `?msg=` MORREU NO PORTAL. Nenhuma tela do aluno lê recado de query
//      string, e nenhuma action do portal escreve um.
//   4. O REENVIO DO CONVITE não mente. Leitura que falha deixou de virar "um
//      link novo acabou de ser enviado" (dívida c14 de `/convite-expirado`).
//
// A RODADA DE CORREÇÃO (22 achados) acrescentou os casos que faltavam, e todos
// são da mesma família: a tela não pode afirmar o que o sistema não sabe, nem
// oferecer o que a RPC recusa. Entram a MATRIZ inteira de status do Asaas (a
// régua por substring dizia "o valor voltou para você" de estorno parcial, de
// chargeback em reversão e de estorno RECUSADO), a morte do botão de fatura, o
// slot vigente do resgate, o fim do padrão de 45 min, os estados da escada da
// mentoria e três sequências de dois estados (erro→render, erro→sucesso→limpo).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { reenviarConvite } from '@/lib/auth/reenvio'
import {
  contatoDoAluno,
  dadosDoResgate,
  payments,
  portalStudent,
  reservasDeMentoria,
  type SituacaoDaCobranca,
} from '@/lib/portal/data'
import {
  rotuloDaCobranca,
  urgenciaDaCobranca,
  verboDoVencimento,
} from '@/lib/portal/pagamentos'
import {
  PALAVRA_DO_DEGRAU,
  esperandoProgresso,
  estadoDoDegrau,
  etapasUsadas,
  proximaEtapaLivre,
  type EscadaDaMentoria,
} from '@/lib/portal/mentoria'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createMentorshipContract,
  createPrivateContract,
  createSession,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

async function studentLogin(tz = 'America/Cuiaba') {
  const c = await createPrivateContract(sql, { tz })
  const userId = await createAuthUser(sql, 'student', 'Aluno P5')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  return { ...c, userId, client: await clientAs(userId, 'student') }
}

/* -------------------------------------------------------------------------- */
/* 1. a voz da cobrança: estornada não é paga                                  */
/* -------------------------------------------------------------------------- */

async function cobranca(
  contractId: string,
  status: string,
  dueDate: string,
  extra: { pago?: boolean; raw?: unknown } = {},
) {
  await sql`
    insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date,
                          reference_ym, paid_at, raw)
    values (${'pay-' + crypto.randomUUID().slice(0, 8)}, ${contractId}, 15000, ${status},
            ${dueDate}, ${dueDate.slice(0, 7)},
            ${extra.pago ? new Date().toISOString() : null},
            ${extra.raw ? JSON.stringify(extra.raw) : null}::text::jsonb)`
}

describe('P5 · pagamentos — cada desfecho na sua voz, decidida pelo banco', () => {
  it('REFUNDED sai como "estornada": nunca "paga", nunca "vencida"', async () => {
    const s = await studentLogin()
    // Vencida há um mês E estornada: o pior caso: pelas duas réguas velhas ela
    // era "paga" (não estava na lista de em-aberto) ou "vencida" (due_date no
    // passado). As duas mentem sobre dinheiro que voltou para o aluno.
    await cobranca(s.contractId, 'REFUNDED', daysFromToday(-30))

    const lista = await payments(s.client)
    expect(lista.erro).toBe(false)
    expect(lista.dado).toHaveLength(1)
    const p = lista.dado[0]!

    expect(p.situacao).toBe('estornada')
    expect(p.naoCobravel).toBe(true)
    expect(p.emAberto).toBe(false)
    expect(p.emAtraso).toBe(false)

    const rotulo = rotuloDaCobranca(p.situacao)
    expect(rotulo.frase).toBe('estornada')
    expect(rotulo.frase).not.toBe('paga')
    expect(rotulo.frase).not.toBe('vencida')
    expect(rotulo.tom).toBe('muted')
    expect(rotulo.explicacao).toContain('voltou para você')
  })

  it('a família não-cobrável inteira ganha voz: chargeback é DISPUTA, apagada é cancelamento', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'CHARGEBACK_REQUESTED', daysFromToday(-20))
    await cobranca(s.contractId, 'PAYMENT_DELETED', daysFromToday(-19))
    await cobranca(s.contractId, 'CANCELED', daysFromToday(-18))

    const lista = await payments(s.client)
    const porStatus = new Map(lista.dado.map((p) => [p.status, p.situacao]))
    // Na primeira versão do P5, chargeback era "estornada" — e a tela dizia "o
    // valor voltou para você" de um dinheiro que ainda está sendo disputado
    // (achado 4). Ele tem voz própria desde a rodada de correção.
    expect(porStatus.get('CHARGEBACK_REQUESTED')).toBe('em_disputa')
    expect(porStatus.get('PAYMENT_DELETED')).toBe('cancelada')
    expect(porStatus.get('CANCELED')).toBe('cancelada')
    // Todas fora da conta de dívida — a régua compartilhada com os KPIs.
    expect(lista.dado.every((p) => p.naoCobravel && !p.emAberto && !p.emAtraso)).toBe(true)
  })

  it('as outras duas vozes continuam onde estavam (paga · em aberto · vencida)', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'RECEIVED', daysFromToday(-10), { pago: true })
    await cobranca(s.contractId, 'OVERDUE', daysFromToday(-3))
    await cobranca(s.contractId, 'PENDING', daysFromToday(5))

    const lista = await payments(s.client)
    const porStatus = new Map(lista.dado.map((p) => [p.status, p.situacao]))
    expect(porStatus.get('RECEIVED')).toBe('paga')
    expect(porStatus.get('OVERDUE')).toBe('em_atraso')
    expect(porStatus.get('PENDING')).toBe('em_aberto')

    expect(rotuloDaCobranca('paga').frase).toBe('paga')
    expect(rotuloDaCobranca('em_aberto').frase).toBe('em aberto')
    expect(rotuloDaCobranca('em_atraso').frase).toBe('vencida')
  })

  it('a ordem da lista põe o que pede ação na frente, e o resolvido no fim', () => {
    expect(urgenciaDaCobranca('em_atraso')).toBeLessThan(urgenciaDaCobranca('em_aberto'))
    expect(urgenciaDaCobranca('em_aberto')).toBeLessThan(urgenciaDaCobranca('paga'))
    expect(urgenciaDaCobranca('paga')).toBeLessThan(urgenciaDaCobranca('estornada'))
    expect(urgenciaDaCobranca('estornada')).toBe(urgenciaDaCobranca('cancelada'))
  })

  it('rótulo desconhecido não herda "paga" — ele se declara a confirmar', () => {
    // A regressão a impedir é justamente a de origem: o default silencioso.
    const r = rotuloDaCobranca('desconhecida')
    expect(r.frase).not.toBe('paga')
    expect(r.frase).toContain('confirmar')
  })

  /* ------------------------------------------------------------------------
   * A MATRIZ INTEIRA (rodada de correção, achados 3/4/7/8 + menor 18).
   *
   * A primeira versão de `payment_situacao` decidia "estornada × cancelada" por
   * SUBSTRING sobre o balde não-cobrável (`~ '(cancel|delet)'`). Substring em
   * cima de vocabulário externo erra sobre DINHEIRO — e erra na direção de
   * afirmar devolução que não houve. Cada linha desta tabela é um status real do
   * Asaas que a régua velha classificava errado, ou um nome de EVENTO que ela
   * confundia com status de cobrança.
   * ---------------------------------------------------------------------- */
  const MATRIZ: ReadonlyArray<readonly [string, string, { pago?: boolean; vencida?: boolean }]> = [
    // — o dinheiro voltou de verdade (a única voz que pode dizer isso)
    ['REFUNDED', 'estornada', {}],
    // — voltou PARTE: a régua velha dizia "estornada" (= o valor voltou)
    ['PARTIALLY_REFUNDED', 'estorno_parcial', { pago: true }],
    // — nada voltou ainda
    ['REFUND_REQUESTED', 'estorno_em_andamento', { pago: true }],
    ['REFUND_IN_PROGRESS', 'estorno_em_andamento', { pago: true }],
    // — o estorno foi RECUSADO: o dinheiro FICOU. A régua velha o devolvia.
    ['REFUND_DENIED', 'paga', { pago: true }],
    // — disputa: ninguém recebeu nada, e não há o que fazer
    ['CHARGEBACK_REQUESTED', 'em_disputa', { pago: true }],
    ['CHARGEBACK_DISPUTE', 'em_disputa', { pago: true }],
    ['AWAITING_CHARGEBACK_DEBIT', 'em_disputa', { pago: true }],
    // — o mais traiçoeiro: a disputa sendo revertida A FAVOR DA ESCOLA saía
    //   como "o valor voltou para você"
    ['AWAITING_CHARGEBACK_REVERSAL', 'em_disputa', { pago: true }],
    // — cobrança morta na origem
    ['PAYMENT_DELETED', 'cancelada', {}],
    ['CANCELED', 'cancelada', {}],
    // — quitadas
    ['RECEIVED', 'paga', { pago: true }],
    ['CONFIRMED', 'paga', { pago: true }],
    ['RECEIVED_IN_CASH', 'paga', { pago: true }],
    // — a baixa manual DESFEITA: `paid_at` continua lá do recebimento anulado,
    //   e a dívida voltou. Vencida no passado ⇒ em atraso.
    ['RECEIVED_IN_CASH_UNDONE', 'em_atraso', { pago: true, vencida: true }],
    // — nomes de EVENTO do webhook, não desfecho de cobrança. `cancel` na
    //   substring matava a cobrança; o boleto cancelado e regerado segue aberto.
    ['BANK_SLIP_CANCELLED', 'em_aberto', {}],
    ['SPLIT_CANCELLED', 'em_aberto', {}],
    ['DUNNING_REQUESTED', 'em_atraso', { vencida: true }],
    // "dunning" é NEGATIVAÇÃO, e o evento só existe em cima de dívida vencida.
    // Ele já esteve na lista de `paga` — e carimbava de quitada exatamente a
    // cobrança que a escola mandou negativar (grave da rodada 2).
    ['DUNNING_RECEIVED', 'em_atraso', { vencida: true }],
    // — desconhecido: default conservador, jamais "estornada"
    ['STATUS_QUE_O_ASAAS_INVENTOU_AMANHA', 'em_aberto', {}],
    // — o espelho grava o status CRU: caixa mista e espaço sobrando entram pela
    //   normalização (`upper(btrim(…))`), não por sorte.
    ['  ReFuNdEd  ', 'estornada', {}],
    ['bank_slip_cancelled ', 'em_aberto', {}],
  ]

  it('cada status do Asaas cai na voz certa — e "o valor voltou" só em REFUNDED', async () => {
    const s = await studentLogin()
    // Vencimentos distintos para casar cada linha de volta com o seu status.
    for (const [i, [status, , opts]] of MATRIZ.entries()) {
      await cobranca(s.contractId, status, daysFromToday(opts.vencida ? -60 - i : 60 + i), {
        pago: opts.pago,
      })
    }

    // A VIEW direto, e não `payments()`: o leitor corta a página em 12 linhas
    // por vencimento, e a matriz tem mais que isso. O que se prova aqui é a
    // régua do BANCO — a tradução em TypeScript tem o caso logo abaixo.
    const { data, error } = await s.client
      .from('payments_student')
      .select('status, situacao, nao_cobravel')
      .limit(100)
    expect(error).toBeNull()
    const porStatus = new Map((data ?? []).map((p) => [p.status, p.situacao]))
    expect(porStatus.size).toBe(MATRIZ.length)
    for (const [status, esperada] of MATRIZ) {
      expect(porStatus.get(status), status).toBe(esperada)
    }

    // A frase "o valor voltou para você" é EXCLUSIVA de `estornada`.
    for (const [status, situacao] of MATRIZ) {
      const explicacao = rotuloDaCobranca(situacao as SituacaoDaCobranca).explicacao ?? ''
      if (situacao !== 'estornada') {
        expect(explicacao, status).not.toContain('voltou para você')
      }
    }
    expect(rotuloDaCobranca('estornada').explicacao).toContain('voltou para você')
    // …e o estorno PARCIAL não afirma o total.
    expect(rotuloDaCobranca('estorno_parcial').explicacao).toContain('parte do valor')
    expect(rotuloDaCobranca('em_disputa').explicacao).toContain('nada a fazer agora')

    // A NORMALIZAÇÃO é explícita, não sorte: a matriz é por IGUALDADE, então
    // caixa e espaço passam por `upper(btrim(…))` — e a régua velha, por
    // substring sobre `lower`, tolerava isso por acidente.
    const [n] = await sql<{ a: string; b: string; c: string }[]>`
      select public.payment_situacao('  ReFuNdEd  ', null, null) as a,
             public.payment_situacao('refunded',     null, null) as b,
             public.payment_situacao('REFUNDED ',    null, null) as c`
    expect([n.a, n.b, n.c]).toEqual(['estornada', 'estornada', 'estornada'])
  })

  /* ------------------------------------------------------------------------
   * AS TRÊS COLUNAS CONTAM A MESMA HISTÓRIA (ordem complementar da rodada).
   *
   * Enquanto `payment_nao_cobravel`/`payment_em_aberto` decidiam por substring e
   * `situacao` decidia por matriz, o MESMO pagamento tinha dois vereditos: a
   * lista de /portal/pagamentos (que lê `situacao`) dizia "em aberto" e o cartão
   * de pendência do Início (que filtra pela COLUNA `em_aberto`) não via dívida
   * nenhuma. As duas réguas velhas passaram a NASCER da matriz.
   * ---------------------------------------------------------------------- */
  it('os status de borda dão o MESMO veredito na coluna e na situação', async () => {
    const s = await studentLogin()
    // Boleto cancelado e regerado: a COBRANÇA segue de pé, vencendo lá na
    // frente. A substring `cancel` a dava por morta.
    await cobranca(s.contractId, 'BANK_SLIP_CANCELLED', daysFromToday(9))
    // Baixa manual DESFEITA, vencida: `paid_at` continua preenchido do
    // recebimento anulado, e a dívida voltou.
    await cobranca(s.contractId, 'RECEIVED_IN_CASH_UNDONE', daysFromToday(-9), { pago: true })

    const { data } = await s.client
      .from('payments_student')
      .select('status, situacao, em_aberto, em_atraso, nao_cobravel')
      .limit(10)
    const porStatus = new Map((data ?? []).map((p) => [p.status as string, p]))

    const boleto = porStatus.get('BANK_SLIP_CANCELLED')!
    expect(boleto.situacao).toBe('em_aberto')
    expect(boleto.em_aberto).toBe(true) // antes: false (a substring matava)
    expect(boleto.em_atraso).toBe(false)
    expect(boleto.nao_cobravel).toBe(false) // antes: true

    const desfeita = porStatus.get('RECEIVED_IN_CASH_UNDONE')!
    expect(desfeita.situacao).toBe('em_atraso')
    expect(desfeita.em_aberto).toBe(true) // antes: false (por causa do paid_at)
    expect(desfeita.em_atraso).toBe(true)
    expect(desfeita.nao_cobravel).toBe(false)

    // A invariante, escrita uma vez: as colunas são o MESMO fato da situação.
    for (const p of data ?? []) {
      expect(p.em_aberto, `${p.status} · em_aberto`).toBe(
        p.situacao === 'em_aberto' || p.situacao === 'em_atraso',
      )
      expect(p.em_atraso, `${p.status} · em_atraso`).toBe(p.situacao === 'em_atraso')
      expect(p.nao_cobravel, `${p.status} · nao_cobravel`).toBe(
        !['paga', 'em_aberto', 'em_atraso'].includes(p.situacao as string),
      )
    }
  })

  it('a invariante das três colunas vale para a MATRIZ inteira', async () => {
    const s = await studentLogin()
    for (const [i, [status, , opts]] of MATRIZ.entries()) {
      await cobranca(s.contractId, status, daysFromToday(opts.vencida ? -60 - i : 60 + i), {
        pago: opts.pago,
      })
    }
    const { data } = await s.client
      .from('payments_student')
      .select('status, situacao, em_aberto, em_atraso, nao_cobravel')
      .limit(100)
    expect((data ?? []).length).toBe(MATRIZ.length)
    for (const p of data ?? []) {
      expect(p.em_aberto, `${p.status} · em_aberto`).toBe(
        p.situacao === 'em_aberto' || p.situacao === 'em_atraso',
      )
      expect(p.em_atraso, `${p.status} · em_atraso`).toBe(p.situacao === 'em_atraso')
      expect(p.nao_cobravel, `${p.status} · nao_cobravel`).toBe(
        !['paga', 'em_aberto', 'em_atraso'].includes(p.situacao as string),
      )
    }
  })

  it('o vocabulário novo atravessa o leitor em TypeScript (nada vira "a confirmar")', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'PARTIALLY_REFUNDED', daysFromToday(-4), { pago: true })
    await cobranca(s.contractId, 'AWAITING_CHARGEBACK_REVERSAL', daysFromToday(-3), { pago: true })
    await cobranca(s.contractId, 'REFUND_IN_PROGRESS', daysFromToday(-2), { pago: true })

    const lista = await payments(s.client)
    const porStatus = new Map(lista.dado.map((p) => [p.status, p.situacao]))
    expect(porStatus.get('PARTIALLY_REFUNDED')).toBe('estorno_parcial')
    expect(porStatus.get('AWAITING_CHARGEBACK_REVERSAL')).toBe('em_disputa')
    expect(porStatus.get('REFUND_IN_PROGRESS')).toBe('estorno_em_andamento')
    expect(lista.dado.some((p) => p.situacao === 'desconhecida')).toBe(false)
  })

  it('o verbo "vence em" é só da cobrança que ainda está de pé (achado 16)', () => {
    expect(verboDoVencimento('em_aberto')).toBe('vence em')
    expect(verboDoVencimento('em_atraso')).toBe('venceu em')
    for (const s of [
      'paga',
      'estornada',
      'estorno_parcial',
      'estorno_em_andamento',
      'em_disputa',
      'cancelada',
      'desconhecida',
    ] as const) {
      expect(verboDoVencimento(s), s).toBe('venc.')
    }
    // A tela usa a função, e não monta o verbo na mão.
    const tela = semComentarios(fonteDe('src/app/portal/pagamentos/page.tsx'))
    expect(tela).toContain('verboDoVencimento(cobranca.situacao)')
    expect(tela).not.toMatch(/'venceu' : 'vence'/)
  })

  /* ------------------------------------------------------------------------
   * O LINK DA FATURA MORREU no P5 (achados graves 1 e 2) e VOLTOU no F3 da
   * Onda Financeiro — nas condições que o P5 exigiu por escrito: o banco agora
   * SABE afirmar que o pagador é o próprio aluno (student_payers.relationship
   * = self, promoção manual auditada) e valida a ORIGEM do link. As duas
   * guardas vivem DENTRO da view (migration 20260807000300); `raw` e
   * `payer_id` continuam fora. Os casos de guarda finos (terceiro, casal,
   * origem hostil) estão em tests/onda-financeiro-f3.test.ts.
   * ---------------------------------------------------------------------- */
  it('o `raw` continua sem atravessar a fronteira — o link só sai FILTRADO pela view', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'PENDING', daysFromToday(6), {
      raw: { payment: { invoiceUrl: 'https://www.asaas.com/i/abc123' } },
    })
    // Domínio hostil: o payload é EXTERNO, e o espelho grava o que chegar.
    await cobranca(s.contractId, 'PENDING', daysFromToday(7), {
      raw: { payment: { invoiceUrl: 'https://evil.com/i/abc123' } },
    })
    await cobranca(s.contractId, 'PENDING', daysFromToday(8), {
      raw: { payment: { invoiceUrl: 'javascript:alert(1)' } },
    })

    const linhas = (await s.client.from('payments_student').select('*')).data ?? []
    const colunas = Object.keys(linhas[0] ?? {})
    expect(colunas).not.toContain('raw')
    expect(colunas).not.toContain('payer_id')
    expect(colunas).toContain('invoice_url')
    // SEM vínculo self, nenhuma das três cobranças entrega link — nem a de
    // origem legítima (posse é a primeira guarda), muito menos as hostis.
    for (const l of linhas) expect(l.invoice_url).toBeNull()
  })

  it('a tela desenha o botão SÓ quando a view manda a url — e não decide nada em TS', () => {
    const tela = semComentarios(fonteDe('src/app/portal/pagamentos/page.tsx'))
    expect(tela).toContain('cobranca.invoiceUrl &&')
    expect(tela).toContain('Abrir a fatura')
    // nenhuma régua de status/origem na tela: quem decide é a view
    expect(tela).not.toMatch(/asaas\.com/)
    // O caminho de quem não tem botão continua sendo a conversa.
    expect(tela).toContain('WHATSAPP_ATENDIMENTO_URL')
  })
})

/* -------------------------------------------------------------------------- */
/* 2. o resgate anuncia a validade do crédito que vai gastar                   */
/* -------------------------------------------------------------------------- */

/** A fonte VELHA da tela — mantida no teste como testemunha do defeito. */
async function validadeDaFonteVelha(contractId: string): Promise<string | null> {
  const [row] = await sql<{ next_expiry: string | null }[]>`
    select to_char(next_expiry, 'YYYY-MM-DD') as next_expiry
      from public.contract_credit_summary() where contract_id = ${contractId}`
  return row?.next_expiry ?? null
}

describe('P5 · resgatar — a validade é a do FIFO, não a de um crédito que não existe mais', () => {
  it('crédito JÁ VENCIDO não empresta a própria data ao saldo vivo (cenário C1)', async () => {
    const s = await studentLogin()
    const vencido = daysFromToday(-5)
    const vivo = daysFromToday(60)
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${vencido})`
    await sql`select public.earn_makeup(${s.contractId}, 'earn_cancellation', ${vivo})`

    // A TESTEMUNHA: a fonte que a tela usava responde com a data do vencido.
    expect(await validadeDaFonteVelha(s.contractId)).toBe(vencido)

    const r = await dadosDoResgate(s.client, s.contractId)
    expect(r.erro).toBe(false)
    // Saldo conta só o que ainda vira aula…
    expect(r.dado?.saldo).toBe(1)
    // …e a validade anunciada é a DELE, nunca a do que já morreu.
    expect(r.dado?.proximaValidade).toBe(vivo)
    expect(r.dado?.proximaValidade).not.toBe(vencido)
    expect(r.dado?.validadeDoCreditoDaVez).toBe(vivo)
  })

  it('crédito GASTO não anuncia a própria validade — quem manda é o replay', async () => {
    const s = await studentLogin()
    const primeiro = daysFromToday(10)
    const segundo = daysFromToday(70)
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${primeiro})`
    await sql`select public.earn_makeup(${s.contractId}, 'earn_cancellation', ${segundo})`
    // FIFO: o gasto consome o que vence primeiro.
    await sql`select public.spend_makeup(${s.contractId})`

    const r = await dadosDoResgate(s.client, s.contractId)
    expect(r.dado?.saldo).toBe(1)
    expect(r.dado?.proximaValidade).toBe(segundo)
    expect(r.dado?.validadeDoCreditoDaVez).toBe(segundo)
    expect(r.dado?.validadeDoCreditoDaVez).not.toBe(primeiro)
  })

  it('a duração da aula é a do crédito da vez', async () => {
    const s = await studentLogin()
    await sql`
      select public.earn_makeup(${s.contractId}, 'earn_cancellation', ${daysFromToday(30)},
                                null, null, null, 60)`
    const r = await dadosDoResgate(s.client, s.contractId)
    expect(r.dado?.duracaoMin).toBe(60)
  })

  /* ------------------------------------------------------------------------
   * O PADRÃO DE 45 MIN MORREU (achado grave 6 · menor 19).
   *
   * O teste anterior CODIFICAVA o defeito: "crédito sem duração ⇒ 45 min".
   * Nenhum lugar do negócio diz 45 — e a RPC que cria a aula LEVANTA EXCEÇÃO
   * quando não há duração ("contrato % não tem duração para o resgate").
   * A tela montava a grade inteira num número inventado.
   * ---------------------------------------------------------------------- */
  it('sem duração determinável, a resposta é NULA — não 45 (o teste que codificava os 45 foi invertido)', async () => {
    const t = await studentLogin()
    await sql`select public.earn_makeup(${t.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const semDuracao = await dadosDoResgate(t.client, t.contractId)
    expect(semDuracao.erro).toBe(false)
    expect(semDuracao.dado?.saldo).toBe(1)
    expect(semDuracao.dado?.duracaoMin).toBeNull()
    expect(semDuracao.dado?.duracaoMin).not.toBe(45)

    // E a RPC concorda: sem duração, ela RECUSA — em voz alta. A tela não pode
    // oferecer o que o banco vai negar; por isso a página não monta grade.
    // As duas RPCs são restritas a admin/professora (D10): o cliente precisa
    // de JWT com papel, e não a conexão de dono do banco.
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin P5'), 'admin')
    const { data: janela, error: erroDaJanela } = await admin.rpc('publish_reschedule_window', {
      p_teacher: t.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(6), '15:00'),
    })
    expect(erroDaJanela).toBeNull()
    const recusa = await admin.rpc('book_reschedule_window', {
      p_window: janela as string,
      p_contract: t.contractId,
    })
    expect(recusa.error?.message).toContain('não tem duração para o resgate')

    const tela = semComentarios(fonteDe('src/app/portal/resgatar/[contract]/page.tsx'))
    expect(tela).toContain('semDuracao')
    expect(tela).toMatch(/Não conseguimos calcular a duração/)
    expect(tela).not.toMatch(/DURACAO_PADRAO/)
  })

  /* ------------------------------------------------------------------------
   * O SLOT VIGENTE É O DA RPC (achado grave 5).
   *
   * A leitura escolhia por `active_to is null` ("o que não terminou"); a RPC
   * escolhe o VIGENTE HOJE (`active_from <= current_date` + intervalo aberto ou
   * ainda em vigor — 20260727000700:537). O cenário abaixo é o do aluno que
   * troca de horário: o de 60 min encerra HOJE, o de 30 min começa amanhã e tem
   * `active_to` nulo. A tela lia 30 e oferecia uma grade que a RPC não honraria.
   * ---------------------------------------------------------------------- */
  it('o horário fixo lido é o VIGENTE HOJE, igual ao que a RPC escolhe', async () => {
    const s = await studentLogin()
    // Crédito SEM duração: é ele que faz a decisão cair no horário fixo.
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`
      insert into recurring_slots
        (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from, active_to)
      values
        (${s.contractId}, ${s.teacherId}, 3, '19:00', 'America/Cuiaba', 60,
         current_date - 60, current_date),
        (${s.contractId}, ${s.teacherId}, 4, '19:00', 'America/Cuiaba', 30,
         current_date + 1, null)`

    // A ESCRITA (a RPC canônica) escolhe 60 — o slot vigente hoje.
    const [daRpc] = await sql<{ duration_min: number }[]>`
      select rs.duration_min
        from recurring_slots rs
       where rs.contract_id = ${s.contractId}
         and rs.active_from <= current_date
         and (rs.active_to is null or rs.active_to >= current_date)
       order by rs.active_from desc
       limit 1`
    expect(daRpc.duration_min).toBe(60)

    // A LEITURA responde o MESMO número. A régua velha (`active_to is null`)
    // teria respondido 30.
    const r = await dadosDoResgate(s.client, s.contractId)
    expect(r.erro).toBe(false)
    expect(r.dado?.duracaoMin).toBe(60)
    expect(r.dado?.duracaoMin).not.toBe(30)

    // E a leitura não recriou o WHERE em TypeScript: ela chama a função do banco.
    const fonte = semComentarios(fonteDe('src/lib/portal/data.ts'))
    expect(fonte).toContain('contract_active_slot_duration')
    expect(fonte).not.toMatch(/\.is\('active_to', null\)/)
  })

  it('sem crédito nenhum, a resposta é saldo zero — e não um erro de leitura', async () => {
    const s = await studentLogin()
    const r = await dadosDoResgate(s.client, s.contractId)
    expect(r.erro).toBe(false)
    expect(r.dado?.saldo).toBe(0)
    expect(r.dado?.proximaValidade).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* 3. o perfil lê cidade, fuso e o aceite — e nunca inventa                    */
/* -------------------------------------------------------------------------- */

describe('P5 · perfil — o cadastro que a tela mostra', () => {
  it('cidade e país chegam à tela junto do fuso', async () => {
    const s = await studentLogin('America/New_York')
    await sql`update students set city = 'Orlando', country = 'Estados Unidos' where id = ${s.studentId}`
    const aluno = await portalStudent(s.client)
    expect(aluno.erro).toBe(false)
    expect(aluno.dado?.city).toBe('Orlando')
    expect(aluno.dado?.country).toBe('Estados Unidos')
    expect(aluno.dado?.ianaTz).toBe('America/New_York')
  })

  it('cadastro sem cidade volta NULO — a tela diz isso, não uma cidade inventada', async () => {
    const s = await studentLogin()
    const aluno = await portalStudent(s.client)
    expect(aluno.dado?.city).toBeNull()
    expect(aluno.dado?.country).toBeNull()
  })

  /* ------------------------------------------------------------------------
   * DOIS ESTADOS SEGUIDOS: erro de leitura → e o que a tela desenha depois
   * (menores 12 e 22).
   *
   * `lugar` vem vazio pelos DOIS caminhos — quem não tem cidade e quem teve a
   * leitura falhando. A tela dizia "Cidade ainda não cadastrada" nos dois, ou
   * seja, afirmava ausência com base num erro. E o cartão do WhatsApp, que já
   * escondia o formulário sob erro, deixava a pessoa sem caminho nenhum.
   * ---------------------------------------------------------------------- */
  it('sob erro de leitura a tela NÃO afirma ausência — e oferece "Tentar de novo"', async () => {
    // O erro é real: `contatoDoAluno` sobre um cliente que não responde.
    const cliente = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: null, error: { message: 'connection refused' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const contato = await contatoDoAluno(cliente, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(contato.erro).toBe(true)
    expect(contato.dado).toBeNull()

    const tela = semComentarios(fonteDe('src/app/portal/perfil/page.tsx'))
    // A afirmação de ausência fica atrás do ramo de erro.
    expect(tela).toMatch(/aluno\.erro \?[\s\S]{0,400}Cidade ainda não cadastrada/)
    // …e o aviso do contato leva um caminho de volta.
    expect(tela).toMatch(/contato\.erro && <AvisoDeLeitura oQue="seu contato" tentarEm=/)
    const aviso = semComentarios(fonteDe('src/components/portal/AvisoDeLeitura.tsx'))
    expect(aviso).toContain('Tentar de novo')
  })
})

/* -------------------------------------------------------------------------- */
/* 4. o portal inteiro sem `?msg=`                                             */
/* -------------------------------------------------------------------------- */

const raiz = path.resolve(__dirname, '..')
const fonteDe = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8')

/** Fonte sem comentário: o que sobra é código de verdade. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function arquivosDe(dir: string): string[] {
  const raizAbs = path.join(raiz, dir)
  const achados: string[] = []
  const andar = (atual: string) => {
    for (const nome of readdirSync(atual)) {
      const cheio = path.join(atual, nome)
      if (statSync(cheio).isDirectory()) andar(cheio)
      else if (/\.tsx?$/.test(nome))
        // Bancada Windows (01/09/2026): `path.relative` devolve barra invertida;
        // os pinos falam em "/".
        achados.push(path.relative(raiz, cheio).split(path.sep).join('/'))
    }
  }
  andar(raizAbs)
  return achados
}

describe('P5 · a ponte `?msg=` morreu no portal', () => {
  const doPortal = arquivosDe('src/app/portal')

  it('o varredor está olhando o portal inteiro (e não uma pasta vazia)', () => {
    expect(doPortal.length).toBeGreaterThan(10)
    expect(doPortal).toContain('src/app/portal/actions.ts')
    expect(doPortal).toContain('src/app/portal/pagamentos/page.tsx')
  })

  /**
   * OS PADRÕES DA PONTE — e o buraco que a rodada de correção fechou (menor 20).
   *
   * A lista original pegava a ponte escrita do jeito que o M3 a escrevia
   * (`?msg=` na string do redirect, `msg?: string` na assinatura do
   * searchParams). Ela NÃO pegaria as duas outras formas de a mesma ponte
   * voltar: ler pelo objeto (`searchParams.get('msg')`, como num Client
   * Component ou num Route Handler) e montá-la programaticamente
   * (`new URLSearchParams(...).set('msg', …)`). Um varredor que não vê o retorno
   * do defeito é decoração.
   */
  const PONTES: ReadonlyArray<readonly [string, RegExp]> = [
    ['recado escrito na URL (`?msg=`)', /msg=/],
    ['recado lido do searchParams tipado', /msg\?:\s*string/],
    ["recado lido por objeto (`searchParams.get('msg')`)", /\.get\(\s*['"]msg['"]/],
    ["recado montado à mão (`URLSearchParams…set('msg'`)", /\.set\(\s*['"]msg['"]/],
    ['a faixa que pintava a ponte (`AvisoLegado`)', /AvisoLegado/],
  ]

  it('NENHUM arquivo do portal produz nem lê `msg` de query string', () => {
    for (const arquivo of doPortal) {
      const fonte = semComentarios(fonteDe(arquivo))
      for (const [oQue, regex] of PONTES) {
        expect(regex.test(fonte), `${arquivo} contém ${oQue}`).toBe(false)
      }
    }
  })

  it('o varredor PEGARIA o defeito de volta — nos QUATRO formatos', () => {
    // O admin ainda usa a ponte de propósito (a onda das telas dele não chegou):
    // se o padrão procurado acima estivesse errado, este teste ficaria vermelho
    // e o de cima passaria por acidente.
    const admin = semComentarios(fonteDe('src/app/admin/alunos/actions.ts'))
    expect(admin).toMatch(/msg=/)
    // Os padrões novos não têm ocorrência real no repo (ainda bem) — a prova de
    // mutação é sobre um trecho SINTÉTICO, escrito aqui, com o defeito de volta.
    const seVoltasse = [
      "const m = searchParams.get('msg')",
      "const q = new URLSearchParams(); q.set('msg', 'Aula cancelada.')",
      'function P({ searchParams }: { searchParams: { msg?: string } })',
      '<AvisoLegado msg={m} />',
    ]
    for (const trecho of seVoltasse) {
      expect(
        PONTES.some(([, regex]) => regex.test(trecho)),
        trecho,
      ).toBe(true)
    }
  })

  it('o recado continua tendo dono: toda ação do portal termina no cookie de flash', () => {
    const acoes = semComentarios(fonteDe('src/app/portal/actions.ts'))
    // Nenhum `redirect` do módulo carrega recado — os que sobraram levam só
    // rota e estado (`/login`, `?etapa=`).
    for (const alvo of ['comFlash', 'gravarFlash']) expect(acoes).toContain(alvo)
    expect(acoes).not.toMatch(/encodeURIComponent/)
  })
})

/* -------------------------------------------------------------------------- */
/* 5. mentoria — reforma VISUAL: nenhuma regra mudou de lugar                  */
/* -------------------------------------------------------------------------- */

describe('P5 · mentoria — o esqueleto novo não mexeu na régua', () => {
  it('a página continua perguntando ao BANCO tudo o que decide elegibilidade', () => {
    const tela = semComentarios(fonteDe('src/app/portal/mentoria/page.tsx'))
    // as mesmas fontes de verdade de antes da reforma
    for (const fonte of [
      'contratoDeMentoriaAtivo',
      'mentorship_windows_unlocked',
      'mentorship_can_book',
      'mentorship_contracts',
      'mentorship_sessions',
      'course_progress',
    ]) {
      expect(tela, fonte).toContain(fonte)
    }
    // A leitura das RESERVAS desceu para a camada de dados na rodada de
    // correção (a tela do aluno não pode carregar o nome da tabela de ledger —
    // varredor de vocabulário), mas continua sendo a MESMA pergunta ao banco.
    expect(tela).toContain('reservasDeMentoria')
    const dados = semComentarios(fonteDe('src/lib/portal/data.ts'))
    expect(dados).toContain('mentorship_bookings')
    // …e a reserva continua sendo a RPC de posse, chamada pela action.
    const acoes = semComentarios(fonteDe('src/app/portal/actions.ts'))
    expect(acoes).toContain('book_my_mentorship_session')
    expect(acoes).toContain('cancel_my_mentorship_booking')
  })

  it('a escada não passou a ser calculada na tela', () => {
    const tela = semComentarios(fonteDe('src/app/portal/mentoria/page.tsx'))
    // Nada de derivar janela liberada de data de início aqui: `unlocked` vem da
    // função pura do banco (Lei 2 — computada, nunca materializada por job).
    expect(tela).not.toMatch(/course_start_date[\s\S]{0,200}Math\./)
    expect(tela).toMatch(/const unlocked = Number\(unlockedRaw/)
  })
})

/* -------------------------------------------------------------------------- */
/* 5b. mentoria — a escada diz a verdade sobre QUAL etapa e sobre "liberada"    */
/* -------------------------------------------------------------------------- */

const ESCADA_BASE: EscadaDaMentoria = {
  usadas: new Set<number>(),
  proxima: 1,
  unlocked: 0,
  canBook: false,
}

describe('P5 · mentoria — os estados da escada (rodada de correção)', () => {
  it('o BURACO pós-estorno aparece certo: 1 e 3 usadas, 2 é a próxima', () => {
    const usadas = new Set([1, 3])
    expect(proximaEtapaLivre(usadas, 6)).toBe(2)

    const escada: EscadaDaMentoria = { usadas, proxima: 2, unlocked: 3, canBook: true }
    // A régua VELHA (`i < spent`, com spent = 2) pintava 1 e 2 como usadas e
    // apontava a 3 como próxima — bloqueando na tela o crédito que o aluno
    // recuperou no estorno.
    expect(estadoDoDegrau(1, escada)).toBe('usada')
    expect(estadoDoDegrau(2, escada)).toBe('liberada')
    expect(estadoDoDegrau(3, escada)).toBe('usada')
    expect(estadoDoDegrau(4, escada)).toBe('a_liberar')
  })

  it('janela aberta SEM confirmação do banco não vira "liberada"', () => {
    // O tempo destravou 3 janelas, mas `mentorship_can_book` diz não (o
    // threshold de progresso da etapa 1 não foi atingido).
    const escada: EscadaDaMentoria = { ...ESCADA_BASE, unlocked: 3, canBook: false }
    expect(estadoDoDegrau(1, escada)).toBe('janela_aberta')
    expect(estadoDoDegrau(2, escada)).toBe('a_liberar')
    expect(esperandoProgresso(escada)).toBe(true)
    expect(PALAVRA_DO_DEGRAU.janela_aberta).toBe('janela aberta')

    // Com o banco confirmando, a MESMA escada libera — e só a próxima.
    const liberada: EscadaDaMentoria = { ...escada, canBook: true }
    expect(estadoDoDegrau(1, liberada)).toBe('liberada')
    expect(estadoDoDegrau(2, liberada)).toBe('a_liberar')
    expect(esperandoProgresso(liberada)).toBe(false)
  })

  it('janela AINDA fechada continua "a liberar" — não "depende do seu progresso"', () => {
    const escada: EscadaDaMentoria = { ...ESCADA_BASE, unlocked: 0, canBook: false }
    expect(estadoDoDegrau(1, escada)).toBe('a_liberar')
    expect(esperandoProgresso(escada)).toBe(false)
  })

  it('a escada inteira usada: não sobra próxima etapa', () => {
    const usadas = new Set([1, 2, 3, 4, 5, 6])
    expect(proximaEtapaLivre(usadas, 6)).toBeNull()
    const escada: EscadaDaMentoria = { usadas, proxima: null, unlocked: 6, canBook: false }
    expect(estadoDoDegrau(6, escada)).toBe('usada')
    expect(esperandoProgresso(escada)).toBe(false)
  })

  it('reserva sem etapa legível não vira degrau (um a menos > um errado)', () => {
    expect(etapasUsadas([{ etapa: 2 }, { etapa: 3 }])).toEqual(new Set([2, 3]))
    expect(etapasUsadas([{ etapa: null }])).toEqual(new Set())
    expect(etapasUsadas([{ etapa: 0 }])).toEqual(new Set())
    expect(etapasUsadas(null)).toEqual(new Set())
  })

  /* ------------------------------------------------------------------------
   * ESCADA FALSA NÃO SE PUBLICA (rodada 2 da revisão; régua do C6 do P3).
   *
   * Com a leitura das reservas falhando, `dado` vem VAZIO — indistinguível de
   * "nenhuma mentoria usada". Desenhar a escada em cima disso mostra os seis
   * degraus livres e a etapa 1 como a próxima: um SALDO inventado, na tela onde
   * o aluno decide gastar crédito.
   * ---------------------------------------------------------------------- */
  it('leitura que falha devolve vazio — e é por isso que a escada não pode ser desenhada', async () => {
    const cliente = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              order: async () => ({ data: null, error: { message: 'connection refused' } }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const leitura = await reservasDeMentoria(cliente, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(leitura.erro).toBe(true)
    expect(leitura.dado).toEqual([])

    // O vazio de FALHA e o vazio de VERDADE produziriam a MESMA escada — e é
    // uma escada que promete: nenhum degrau usado, o primeiro liberado.
    const escadaMentirosa: EscadaDaMentoria = {
      usadas: etapasUsadas(leitura.dado),
      proxima: proximaEtapaLivre(etapasUsadas(leitura.dado), 6),
      unlocked: 3,
      canBook: true,
    }
    expect(escadaMentirosa.proxima).toBe(1)
    expect(estadoDoDegrau(1, escadaMentirosa)).toBe('liberada')

    // Por isso a tela SAI antes de calcular: o aviso entra no LUGAR da escada.
    const tela = semComentarios(fonteDe('src/app/portal/mentoria/page.tsx'))
    expect(tela).toMatch(/if \(reservas\.erro\)[\s\S]{0,400}AvisoDeLeitura/)
    // …e a saída acontece ANTES de qualquer degrau ser computado.
    expect(tela.indexOf('if (reservas.erro)')).toBeLessThan(tela.indexOf('etapasUsadas('))
    expect(tela.indexOf('if (reservas.erro)')).toBeLessThan(tela.indexOf('proximaEtapaLivre('))
  })

  it('no BANCO de verdade: estorno da etapa 2 deixa {1,3} usadas e a 2 como a próxima', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 5, // floor(5/2)+1 = 3 janelas destravadas
      thresholds: { 1: 0, 2: 0, 3: 0 },
      completionPct: 100,
    })
    const userId = await createAuthUser(sql, 'student', 'Mentorado P5')
    await sql`update students set profile_id = ${userId} where id = ${m.studentId}`
    const client = await clientAs(userId, 'student')

    const feitas: string[] = []
    for (let i = 0; i < 3; i++) {
      const sess = await createSession(sql)
      const [row] = await sql<{ id: string }[]>`
        select public.book_mentorship_session(${sess}, ${m.contractId}) as id`
      feitas.push(row.id)
    }
    // O estorno da SEGUNDA reserva devolve o crédito da etapa 2 e marca a
    // reserva como cancelada — o buraco no meio da escada.
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin escada'), 'admin')
    const estorno = await admin.rpc('refund_mentorship_booking', { p_booking: feitas[1] })
    expect(estorno.error).toBeNull()

    // O banco diz que a próxima é a 2 (`mentorship_next_window`)…
    const [proxima] = await sql`select public.mentorship_next_window(${m.contractId}) as n`
    expect(Number(proxima.n)).toBe(2)

    // …e a tela, lendo o que a tela lê, chega ao MESMO lugar.
    const leitura = await reservasDeMentoria(client, m.contractId)
    expect(leitura.erro).toBe(false)
    const usadas = etapasUsadas(leitura.dado)
    expect([...usadas].sort()).toEqual([1, 3])
    expect(proximaEtapaLivre(usadas, 6)).toBe(Number(proxima.n))

    // A régua velha — contagem — teria dito 3.
    expect(leitura.dado.length).toBe(2)
    expect(proximaEtapaLivre(usadas, 6)).not.toBe(leitura.dado.length + 1)
  })
})

/* -------------------------------------------------------------------------- */
/* 6. convite expirado — leitura que falha não vira "enviamos" (dívida c14)    */
/* -------------------------------------------------------------------------- */

/** Um cliente que só sabe responder `_student_by_email`, do jeito pedido. */
function clienteFake(resposta: { data?: unknown; error?: { message: string } | null }) {
  const chamadas: string[] = []
  const cliente = {
    rpc: async (nome: string) => {
      chamadas.push(nome)
      return { data: resposta.data ?? null, error: resposta.error ?? null }
    },
  } as unknown as SupabaseClient
  return { cliente, chamadas }
}

describe('P5 · reenvio do convite — o silêncio deixou de ser resposta', () => {
  it('leitura que FALHA devolve "não deu" (o defeito: ela virava "enviado")', async () => {
    const { cliente } = clienteFake({ error: { message: 'connection refused' } })
    let provisionou = false
    const desfecho = await reenviarConvite(cliente, 'aluna@exemplo.com', async () => {
      provisionou = true
    })
    expect(desfecho).toBe('nao-deu')
    // …e nada foi provisionado: a tela não pode prometer um e-mail que ninguém mandou.
    expect(provisionou).toBe(false)
  })

  it('e-mail que não é de cliente continua com a resposta NEUTRA', async () => {
    const { cliente, chamadas } = clienteFake({ data: null })
    let provisionou = false
    const desfecho = await reenviarConvite(cliente, 'estranho@exemplo.com', async () => {
      provisionou = true
    })
    expect(desfecho).toBe('enviado')
    expect(provisionou).toBe(false)
    expect(chamadas).toEqual(['_student_by_email'])
  })

  it('cliente de verdade: o convite sai e a resposta é a mesma do estranho', async () => {
    const { cliente } = clienteFake({ data: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const recebidos: string[] = []
    const desfecho = await reenviarConvite(cliente, 'Aluna@Exemplo.com ', async (_a, id, mail) => {
      recebidos.push(`${id}|${mail}`)
    })
    expect(desfecho).toBe('enviado')
    // e-mail normalizado antes de sair daqui
    expect(recebidos).toEqual(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|aluna@exemplo.com'])
  })

  it('falha do PROVISIONAMENTO continua neutra — senão o formulário enumera clientes', async () => {
    // Ela só acontece para quem existe, e é provocável de fora (basta repetir o
    // e-mail até o Auth impor limite de envio). Distinguir a resposta aqui
    // entregaria a lista de alunos a quem tentasse.
    const { cliente } = clienteFake({ data: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const desfecho = await reenviarConvite(cliente, 'aluna@exemplo.com', async () => {
      throw new Error('rate limit')
    })
    expect(desfecho).toBe('enviado')
  })

  it('e-mail malformado nem chega ao banco, e responde igual', async () => {
    const { cliente, chamadas } = clienteFake({ data: null })
    expect(await reenviarConvite(cliente, 'nao-e-email', async () => {})).toBe('enviado')
    expect(chamadas).toEqual([])
  })

  it('a tela tem os três estados, e o de falha não promete e-mail nenhum', () => {
    const tela = semComentarios(fonteDe('src/app/convite-expirado/page.tsx'))
    expect(tela).toContain("estado === 'enviado'")
    expect(tela).toContain("estado === 'nao-deu'")
    expect(tela).toMatch(/Não deu para enviar agora/)
    // O formulário volta no caminho da falha: sem ele, a pessoa não tem como
    // tentar de novo sem digitar a URL na mão.
    expect(tela).toMatch(/naoDeu &&[\s\S]{0,400}resendMyInviteAction/)
  })

  /* ------------------------------------------------------------------------
   * A CÓPIA DO SUCESSO NÃO AFIRMA ENTREGA (menor 14 + menor 22).
   *
   * `enviado` é a resposta NEUTRA — ela sai para quem é cliente, para quem não
   * é, e para quem é cliente mas cujo provisionamento falhou (rate limit do
   * Auth). Dizer "um link novo acabou de ser enviado" era afirmar, nos três
   * casos, um envio que só aconteceu no primeiro.
   * ---------------------------------------------------------------------- */
  it('o desfecho `enviado` sai igual nos três mundos — e a cópia não promete entrega', async () => {
    // 1. cliente de verdade  2. estranho  3. cliente com o Auth em rate limit
    const cliente = clienteFake({ data: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    const estranho = clienteFake({ data: null })
    const limitado = clienteFake({ data: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
    expect(await reenviarConvite(cliente.cliente, 'a@exemplo.com', async () => {})).toBe('enviado')
    expect(await reenviarConvite(estranho.cliente, 'b@exemplo.com', async () => {})).toBe('enviado')
    expect(
      await reenviarConvite(limitado.cliente, 'c@exemplo.com', async () => {
        throw new Error('email rate limit exceeded')
      }),
    ).toBe('enviado')

    const tela = semComentarios(fonteDe('src/app/convite-expirado/page.tsx'))
    // Rodada 4 do Sol (WhatsApp): a cópia neutra não pode PROMETER — "chega em
    // instantes" era falso para cadastrado sem número (o código decide não
    // enviar). A frase confirma só o pedido e aponta a porta humana.
    expect(tela).toMatch(/Pedido recebido\. Confira sua caixa de entrada/)
    expect(tela).toMatch(/se nada chegar/)
    // As afirmações antigas morreram — inclusive a promessa do SUBTÍTULO
    // ("enviaremos um novo"), que era falsa nos caminhos sem provisionamento.
    expect(tela).not.toMatch(/acabou de ser enviado/)
    expect(tela).not.toMatch(/chega em instantes/)
    expect(tela).not.toMatch(/enviaremos um novo/)
    // E há uma porta para quem ficou sem o e-mail.
    expect(tela).toContain('WHATSAPP_ATENDIMENTO_URL')
  })
})
