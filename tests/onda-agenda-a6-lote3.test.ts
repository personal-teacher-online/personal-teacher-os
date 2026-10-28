// ONDA DA AGENDA · A6 · LOTE 3 — A VALIDADE DO CRÉDITO CONGELA NA PAUSA.
//
// Decisão comercial do dono (30/07/2026): o relógio da validade do crédito de
// reposição NÃO corre enquanto o contrato está pausado. A migration
// `20260730000300_a6_credito_congela_na_pausa.sql` fecha o furo que existia —
// o crédito NASCIDO durante a pausa ficava de fora da compensação da retomada e
// vencia sem poder ser gasto, estendido ou avisado.
//
// O que este arquivo prova, e o que ele deliberadamente NÃO prova:
//   · a ARITMÉTICA do congelamento (função pura, medida caso a caso);
//   · a MEDIÇÃO obrigatória da spec §100.d (encerrar/renovar contrato pausado),
//     escrita como asserção sobre a definição EFETIVA — para que o dia em que
//     alguém mudar a guarda, o teste caia e não a promessa;
//   · o encerramento de contrato PAUSADO com crédito congelado, que é a única
//     porta da casa em que a promessa precisava valer fora da retomada;
//   · as três coerências que a spec mandou NÃO mexer (extensão manual, avisos,
//     panorama), agora medidas como consequência e não como furo.
// A extensão da RETOMADA em si mora em `tests/fase3-pauses.test.ts` (é a casa
// dela desde a F3) e a classificação do portal em `tests/portal.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday, nomeDeConfirmacao } from './helpers/db'
import { corpoDaFuncao, definicaoDaFuncao } from './helpers/definicao-da-funcao'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin A6 lote 3'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Crédito com data civil de concessão escolhida (ver `addCreditOn` da F3). */
async function creditarEm(
  contrato: string,
  expiresOn: string,
  concedidoEm: string,
  durationMin = 45,
): Promise<number> {
  const [row] = await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min, created_at)
    values (${contrato}, 1, 'manual_adjust', ${expiresOn}, ${durationMin},
            ${concedidoEm + 'T12:00:00Z'}::timestamptz)
    returning id`
  return Number(row.id)
}

async function pausarRetroativo(contrato: string, pausadoEm: string) {
  await sql`update contracts set status = 'paused' where id = ${contrato}`
  await sql`insert into contract_pauses (contract_id, paused_on) values (${contrato}, ${pausadoEm})`
}

async function validadesVivas(contrato: string): Promise<string[]> {
  const rows = await sql<{ e: string }[]>`
    select expires_on::text as e from public._makeup_remaining_credits(${contrato})
     order by expires_on`
  return rows.map((r) => r.e)
}

/* ========================================================================== */
/* 1 · A ARITMÉTICA, medida sozinha                                           */
/* ========================================================================== */

describe('A6/L3 · `_dias_congelados_do_credito` — uma fórmula, quatro leituras', () => {
  async function dias(
    expira: string | null,
    concedidoEm: string,
    pausaEm: string | null,
    hoje: string,
  ): Promise<number> {
    const [row] = await sql<{ d: number }[]>`
      select public._dias_congelados_do_credito(
        ${expira}::date, ${concedidoEm + 'T12:00:00Z'}::timestamptz,
        ${pausaEm}::date, ${hoje}::date) as d`
    return Number(row.d)
  }

  it('crédito PRÉ-PAUSA conta desde o início da pausa (a conta histórica da F3-D10.2)', async () => {
    // 2026-06-20 concedido · pausa em 07-01 · hoje 07-11 → 10 dias parados
    expect(await dias('2026-08-30', '2026-06-20', '2026-07-01', '2026-07-11')).toBe(10)
  })

  it('crédito NASCIDO na pausa conta desde a CONCESSÃO — nunca desde a pausa', async () => {
    // devolver 10 aqui seria dar dias em que o crédito não existia
    expect(await dias('2026-08-30', '2026-07-05', '2026-07-01', '2026-07-11')).toBe(6)
  })

  it('concedido HOJE vale zero — é a trava aritmética contra a extensão DUPLA', async () => {
    expect(await dias('2026-08-30', '2026-07-11', '2026-07-01', '2026-07-11')).toBe(0)
  })

  it('sem pausa aberta, sem prazo, ou já morto antes da pausa → zero', async () => {
    expect(await dias('2026-08-30', '2026-06-20', null, '2026-07-11')).toBe(0)
    expect(await dias(null, '2026-06-20', '2026-07-01', '2026-07-11')).toBe(0)
    // venceu em 06-25, a pausa só começou em 07-01: não foi congelado, acabou
    expect(await dias('2026-06-25', '2026-06-20', '2026-07-01', '2026-07-11')).toBe(0)
  })

  it('nunca devolve negativo (relógio injetado no passado não encolhe validade)', async () => {
    expect(await dias('2026-08-30', '2026-07-05', '2026-07-01', '2026-07-03')).toBe(0)
  })

  it('é helper INTERNO: `authenticated` não executa', async () => {
    const [row] = await sql<{ pode: boolean }[]>`
      select has_function_privilege('authenticated',
        'public._dias_congelados_do_credito(date, timestamptz, date, date)', 'execute') as pode`
    expect(row.pode).toBe(false)
  })
})

/* ========================================================================== */
/* 2 · PROVA ESTRUTURAL — o filtro morreu, o predicado encolheu               */
/* ========================================================================== */

describe('A6/L3 · o que a migration 20260730000300 apagou, apagou de verdade', () => {
  it('`resume_contract` não decide mais por EXCLUSÃO (`ml.created_at < v_pause.created_at`)', () => {
    const { corpo, origem } = definicaoDaFuncao('resume_contract')
    expect(origem).toBe('20260730000300_a6_credito_congela_na_pausa.sql')
    expect(corpo).not.toMatch(/ml\.created_at\s*<\s*v_pause\.created_at/)
    expect(corpo).toContain('public._dias_congelados_do_credito(')
    // a fronteira histórica FICA: quem já tinha morrido antes da pausa não foi
    // congelado, foi enterrado
    expect(corpo).toContain('rc.expires_on >= v_pause.paused_on')
  })

  it('os dois ramos da retomada continuam existindo (vivo relança · vencido renasce)', () => {
    const corpo = corpoDaFuncao('resume_contract')
    expect(corpo).toContain('public._reissue_credit(')
    expect(corpo).toMatch(/insert into makeup_ledger/)
    // o relógio injetável continua chegando ao motor (6º parâmetro)
    expect(corpo).toMatch(/_reissue_credit\([\s\S]{0,400}?null,\s*p_today\)/)
  })

  it('o predicado `congelado` do extrato perdeu a condição de nascimento', () => {
    for (const nome of ['student_credit_statement', 'student_credit_totals']) {
      const { corpo, origem } = definicaoDaFuncao(nome)
      expect(origem, nome).toBe('20260730000300_a6_credito_congela_na_pausa.sql')
      expect(corpo, nome).not.toMatch(/rcriado\s*<\s*r\.pausa_criada_em/)
      // e o RESTO da régua fica, item por item
      expect(corpo, nome).toContain("r.cstatus = 'paused'")
      expect(corpo, nome).toContain('r.pausa_em is not null')
      expect(corpo, nome).toContain("r.rexp <> 'infinity'::date")
      expect(corpo, nome).toContain('r.rexp >= r.pausa_em')
    }
  })
})

/* ========================================================================== */
/* 3 · A MEDIÇÃO DA SPEC §100.d, escrita como teste                           */
/* ========================================================================== */

describe('A6/L3 · encerrar/renovar contrato PAUSADO — a medição que a spec exigiu', () => {
  // Renovação RECUSA pausado (efetiva em 20260727001300:248) — e ao recusar,
  // força a retomada, que é justamente quem aplica a extensão. Nada a mudar lá.
  it('`admin_renew_contract` recusa contrato pausado, na letra e no comportamento', async () => {
    expect(corpoDaFuncao('admin_renew_contract')).toMatch(
      /renovação exige contrato particular ATIVO/,
    )
    const c = await createPrivateContract(sql)
    await pausarRetroativo(c.contractId, daysFromToday(-10))
    const { error } = await admin.rpc('admin_renew_contract', {
      p_old: c.contractId,
      p_switch_on: daysFromToday(7),
      p_plan_name: 'Plano novo',
      p_hourly_rate_cents: 15000,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 30,
    })
    expect(error?.message).toMatch(/ATIVO/)
  })

  // Encerramento ACEITA pausado — as únicas guardas de estado são
  // `contract_type <> 'private_1on1'` e `status = 'ended'`. Por isso ele é a
  // ÚNICA porta que precisou aprender o congelamento.
  it('`admin_end_contract` NÃO tem guarda contra pausado — e por isso mede a validade efetiva', () => {
    const { corpo, origem } = definicaoDaFuncao('admin_end_contract')
    expect(origem).toBe('20260730000300_a6_credito_congela_na_pausa.sql')
    // a ÚNICA guarda de estado sobre o contrato de ORIGEM é "já encerrado"
    expect(corpo).toMatch(/v_old\.status\s*=\s*'ended'/)
    expect(corpo).not.toMatch(/v_old\.status\s*(<>|!=)\s*'active'/)
    // (a exigência de ATIVO existe, mas é do contrato DESTINO — outro assunto)
    expect(corpo).toMatch(/v_dest\.status\s*<>\s*'active'/)
    // os TRÊS predicados de crédito vivo passaram a somar os dias congelados:
    // o gate de destinação, o `where` do laço e a validade que ele preserva
    expect(corpo.match(/_dias_congelados_do_credito\(/g) ?? []).toHaveLength(3)
    // …e a pausa é lida (e travada) logo depois da linha do contrato
    expect(corpo).toContain('from contract_pauses cp')
  })
})

/* ========================================================================== */
/* 4 · O ENCERRAMENTO DO CONTRATO PAUSADO, na prática                         */
/* ========================================================================== */

describe('A6/L3 · encerrar contrato PAUSADO não mata o crédito congelado', () => {
  /** Origem pausada + destino ativo do MESMO aluno. */
  async function parDoMesmoAluno() {
    const origem = await createPrivateContract(sql)
    const destino = await createPrivateContract(sql, { studentId: origem.studentId })
    return { origem, destino }
  }

  it('congelado que passou da data é TRANSFERIDO com a validade estendida (não some)', async () => {
    const { origem, destino } = await parDoMesmoAluno()
    await pausarRetroativo(origem.contractId, daysFromToday(-20))
    // concedido 12 dias atrás, com validade de 5 dias: no papel morreu há 7
    const congelado = await creditarEm(origem.contractId, daysFromToday(-7), daysFromToday(-12), 60)
    expect(await validadesVivas(destino.contractId)).toEqual([])

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
      p_dest_contract: destino.contractId,
    })
    expect(error).toBeNull()

    // 12 dias parados desde a concessão: −7 + 12 = +5
    expect(await validadesVivas(destino.contractId)).toEqual([daysFromToday(5)])
    const [novo] = await sql<{ duration_min: number; note: string }[]>`
      select duration_min, note from makeup_ledger
       where contract_id = ${destino.contractId} and delta = 1 order by id desc limit 1`
    expect(novo.duration_min).toBe(60) // duração preservada (M3-4/P6)
    expect(novo.note).toMatch(/congelado/)
    // DUPLA ENTRADA (Lei 2): o `+1` não teleporta — a origem recebe o `-1`
    // dirigido à linha exata, e o lançamento original fica intocado.
    const [orig] = await sql<{ delta: number }[]>`
      select delta from makeup_ledger where id = ${congelado}`
    expect(orig.delta).toBe(1)
    const [debito] = await sql<{ consumes_ledger_id: number }[]>`
      select consumes_ledger_id from makeup_ledger
       where contract_id = ${origem.contractId} and delta = -1 order by id desc limit 1`
    expect(Number(debito.consumes_ledger_id)).toBe(congelado)
    expect(await validadesVivas(origem.contractId)).toEqual([])
  })

  // ── PARIDADE DE AUDITORIA (Sol · rodada 2, C10b · Lei 8) ──────────────────
  // O ramo VIVO chama `_reissue_credit`, que emite
  // `log_audit('reissue_credit', 'makeup_ledger', <novo id>)` por crédito. O
  // ramo do congelado-vencido escrevia o par à mão e não emitia nada: dois
  // créditos transferidos no MESMO encerramento deixavam trilhas diferentes
  // conforme a data no papel, e quem reconstituísse depois só teria a contagem
  // agregada de `end_contract`.
  it('os DOIS ramos da transferência deixam a MESMA trilha (`reissue_credit` por crédito)', async () => {
    const { origem, destino } = await parDoMesmoAluno()
    await pausarRetroativo(origem.contractId, daysFromToday(-20))
    const vencidoNoPapel = await creditarEm(origem.contractId, daysFromToday(-7), daysFromToday(-12), 60)
    const vivoNoPapel = await creditarEm(origem.contractId, daysFromToday(3), daysFromToday(-12), 45)

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
      p_dest_contract: destino.contractId,
    })
    expect(error).toBeNull()

    const trilha = await sql<{ diff: Record<string, unknown> }[]>`
      select diff from audit_log
       where action = 'reissue_credit'
         and diff ->> 'from_contract' = ${origem.contractId}
       order by id`
    // UMA linha por crédito movido — o ramo vivo e o congelado-vencido
    expect(trilha.map((l) => Number(l.diff.from_ledger)).sort()).toEqual(
      [vencidoNoPapel, vivoNoPapel].sort(),
    )
    for (const l of trilha) {
      expect(l.diff.to_contract).toBe(destino.contractId)
      expect(l.diff.new_expires_on).toBeTruthy()
      expect(l.diff.duration_min).not.toBeNull()
    }
    // …e o congelado-vencido registra as DUAS datas: a do papel e a efetiva
    const doCongelado = trilha.find((l) => Number(l.diff.from_ledger) === vencidoNoPapel)!
    expect(doCongelado.diff.old_expires_on).toBe(daysFromToday(-7))
    expect(doCongelado.diff.new_expires_on).toBe(daysFromToday(5)) // −7 + 12 parados
    expect(doCongelado.diff.duration_min).toBe(60)
  })

  it('congelado AINDA vivo no papel é transferido pelo par −1/+1, já com a extensão', async () => {
    const { origem, destino } = await parDoMesmoAluno()
    await pausarRetroativo(origem.contractId, daysFromToday(-20))
    await creditarEm(origem.contractId, daysFromToday(3), daysFromToday(-12), 45)

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
      p_dest_contract: destino.contractId,
    })
    expect(error).toBeNull()
    expect(await validadesVivas(destino.contractId)).toEqual([daysFromToday(15)]) // 3 + 12
    // o par dirigido apagou o original do replay da origem
    expect(await validadesVivas(origem.contractId)).toEqual([])
  })

  it('o GATE de destinação enxerga o congelado: encerrar sem destino nem baixa RECUSA', async () => {
    const { origem } = await parDoMesmoAluno()
    await pausarRetroativo(origem.contractId, daysFromToday(-20))
    await creditarEm(origem.contractId, daysFromToday(-7), daysFromToday(-12))

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
    })
    // Antes desta migration o gate não via este crédito e deixava o
    // encerramento passar em silêncio, levando o crédito junto.
    expect(error?.message).toMatch(/créditos vivos/)
  })

  it('BAIXA com motivo consome o congelado por identidade (nada fica pendurado)', async () => {
    const { origem } = await parDoMesmoAluno()
    await pausarRetroativo(origem.contractId, daysFromToday(-20))
    const id = await creditarEm(origem.contractId, daysFromToday(-7), daysFromToday(-12))

    const { data, error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
      p_writeoff_note: 'aluno não volta',
    })
    expect(error).toBeNull()
    expect((data as { written_off: number }).written_off).toBe(1)
    const [baixa] = await sql<{ consumes_ledger_id: number }[]>`
      select consumes_ledger_id from makeup_ledger
       where contract_id = ${origem.contractId} and delta = -1 order by id desc limit 1`
    expect(Number(baixa.consumes_ledger_id)).toBe(id)
    expect(await validadesVivas(origem.contractId)).toEqual([])
  })

  it('contrato ATIVO encerra exatamente como antes (extensão zero, nenhum desvio)', async () => {
    const { origem, destino } = await parDoMesmoAluno()
    await creditarEm(origem.contractId, daysFromToday(20), daysFromToday(-5))
    // e um que venceu de verdade, sem pausa nenhuma: continua morto
    await creditarEm(origem.contractId, daysFromToday(-2), daysFromToday(-40))

    const { data, error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
      p_dest_contract: destino.contractId,
    })
    expect(error).toBeNull()
    expect((data as { transferred: number }).transferred).toBe(1)
    expect(await validadesVivas(destino.contractId)).toEqual([daysFromToday(20)])
  })

  it('pausado SEM linha de pausa aberta (anomalia) segue a régua normal', async () => {
    const { origem } = await parDoMesmoAluno()
    await sql`update contracts set status = 'paused' where id = ${origem.contractId}`
    // NENHUM insert em contract_pauses — o estado que resume_contract recusa
    await creditarEm(origem.contractId, daysFromToday(-7), daysFromToday(-12))

    const { data, error } = await admin.rpc('admin_end_contract', {
      p_contract: origem.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, origem.contractId),
    })
    // sem pausa aberta não há extensão a prometer: o crédito está vencido, o
    // gate não dispara, e o encerramento passa sem exigir destinação
    expect(error).toBeNull()
    expect(data as { transferred: number; written_off: number }).toMatchObject({
      transferred: 0,
      written_off: 0,
    })
  })
})

/* ========================================================================== */
/* 5 · O QUE NÃO MUDOU — agora por coerência, e não por furo (§100.c)         */
/* ========================================================================== */

describe('A6/L3 · as três coerências que a spec mandou NÃO mexer', () => {
  it('`admin_extend_credit` continua recusando pausado, e agora a frase é verdade inteira', async () => {
    const c = await createPrivateContract(sql)
    const id = await creditarEm(c.contractId, daysFromToday(30), daysFromToday(-1))
    await pausarRetroativo(c.contractId, daysFromToday(-10))
    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id,
      p_new_expires_on: daysFromToday(60),
      p_note: 'tentativa durante a pausa',
    })
    // "estendida na RETOMADA" era verdade parcial (só para o pré-pausa) e virou
    // verdade para TODO crédito do contrato.
    expect(error?.message).toMatch(/congelado[\s\S]*RETOMADA/)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from makeup_ledger where contract_id = ${c.contractId}`
    expect(n).toBe(1) // nada entrou no ledger
  })

  it('`enqueue_credit_expiry_notices` continua calado para pausado — não há o que avisar', async () => {
    const c = await createPrivateContract(sql)
    await pausarRetroativo(c.contractId, daysFromToday(-10))
    // crédito NASCIDO na pausa, dentro da janela dos avisos: antes ele vencia
    // sem aviso (o terceiro lado do furo); agora ele não vence.
    await creditarEm(c.contractId, daysFromToday(10), daysFromToday(-3))
    await sql`select public.enqueue_credit_expiry_notices(${daysFromToday(0)}::date)`
    const linhas = await sql`
      select 1 from notification_outbox where payload->>'contract_id' = ${c.contractId}`
    expect(linhas).toHaveLength(0)
    expect(corpoDaFuncao('enqueue_credit_expiry_notices')).toMatch(/status\s*=\s*'active'/)
  })

  it('`admin_credit_expiry_overview` também segue só o contrato ativo', () => {
    expect(corpoDaFuncao('admin_credit_expiry_overview')).toMatch(/status\s*=\s*'active'/)
  })
})
