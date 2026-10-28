// A6 · LOTE 1 — AS TRAVAS DA AGENDA NO BANCO (migration 98).
//
// O que este arquivo prova, contra o Postgres de verdade:
//   1. A6/a — as três RPCs recebem o INSTANTE, e o `local_time_snapshot` é
//      derivado com o offset DAQUELE dia (Lei 1). A prova que só existe depois
//      desta migration: as DUAS ocorrências da hora repetida da virada de
//      horário de verão podem ser gravadas, cada uma no seu instante, com o
//      MESMO snapshot civil — antes a RPC escolhia sozinha uma delas;
//   2. A6/b — cortesia com preço é recusada pela RPC E pelo CHECK;
//   3. A6/c — duração fora de 15..480 é recusada pelas duas RPCs E pelo CHECK;
//   4. A6/d — publicar dentro de bloqueio, ou em cima de aula agendada, recusa;
//   5. A6/e — reservar janela que caiu em bloqueio criado DEPOIS recusa;
//   6. A6/f — o bloqueio CANCELA as janelas publicadas do período e devolve
//      quantas fechou; aula marcada continua de pé;
//   7. A6/g — `remove_teacher_block` recusa exceção que não é bloqueio;
//   8. A6/h — aula que SOBREPÕE bloqueio (não só a que começa dentro dele) é
//      recusada nas duas portas de criação;
//   9. A6/i — vínculo de acesso a perfil SEM WhatsApp é recusado no banco.
//
// Cada trava vem com a PROVA DE MUTAÇÃO do caminho feliz ao lado: recusa sem o
// caminho bom provado é recusa que pode estar recusando tudo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createInstanceAt,
  createPrivateContract,
  createStudent,
  createTeacher,
  daysFromToday,
  instanteEm,
  proximaVirada,
  proximoRecuo,
} from './helpers/db'
import { corpoDaFuncao, definicaoDaFuncao } from './helpers/definicao-da-funcao'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin A6'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Bloqueio de dia civil inteiro pela porta de produção. */
async function bloquear(teacherId: string, de: string, ate = de) {
  const { data, error } = await admin.rpc('add_teacher_block', {
    p_teacher: teacherId,
    p_from: de,
    p_to: ate,
    p_note: 'bloqueio A6',
  })
  expect(error).toBeNull()
  return data as { exception_id: string; closed_windows: number }
}

/* ========================================================================== */
/* 1. A6/a — O INSTANTE É A VERDADE, O SNAPSHOT É AUDITORIA                    */
/* ========================================================================== */

describe('A6/a · as três RPCs recebem `p_starts_at_utc`', () => {
  it('as assinaturas do banco não têm mais data+hora civis — e não há overload', () => {
    for (const nome of [
      'admin_create_single_class',
      'admin_create_trial_class',
      'publish_reschedule_window',
    ]) {
      // `definicaoDaFuncao` ESTOURA se sobreviver mais de uma assinatura viva —
      // é a guarda contra o `create or replace` que criaria overload em vez de
      // trocar a assinatura.
      const d = definicaoDaFuncao(nome)
      expect(d.origem, nome).toBe('20260730000100_a6_travas_de_agenda.sql')
      expect(d.corpo, nome).toContain('p_starts_at_utc timestamptz')
      expect(d.corpo, nome).not.toContain('p_local_date')
      expect(d.corpo, nome).not.toContain('p_local_time')
    }
  })

  it('AS DUAS OCORRÊNCIAS da hora repetida de Lisboa podem ser gravadas — cada uma no seu instante', async () => {
    // Na noite em que Lisboa sai do horário de verão (último domingo de
    // outubro) o relógio volta de 02:00 para 01:00 — 01:30 acontece DUAS vezes.
    // Antes do A6 a RPC recebia "01:30" e o `at time zone` do Postgres resolvia
    // a ambiguidade pelo offset PADRÃO (a SEGUNDA ocorrência): a primeira era
    // inalcançável por esta porta.
    //
    // A data é a PRÓXIMA noite de recuo a partir de amanhã, nunca cravada: a
    // RPC recusa aula no passado, e o caso cravado em 25/10/2026 virou bomba de
    // relógio (CI vermelho em 15/10/2026 pelo caso irmão de Nova York).
    const c = await createPrivateContract(sql, { tz: 'Europe/Lisbon' })
    const dia = proximoRecuo('Europe/Lisbon').toISODate()!
    const primeira = `${dia}T00:30:00.000Z` // 01:30 WEST (UTC+1)
    const segunda = `${dia}T01:30:00.000Z` // 01:30 WET  (UTC+0)

    for (const instante of [primeira, segunda]) {
      const { error } = await admin.rpc('admin_create_single_class', {
        p_contract: c.contractId,
        p_starts_at_utc: instante,
        p_duration_min: 45,
        p_kind: 'courtesy',
      })
      expect(error, instante).toBeNull()
    }

    const linhas = await sql<{ inicio: string; snap: string; dia: string }[]>`
      select starts_at_utc::text as inicio, local_time_snapshot as snap,
             occurrence_date::text as dia
        from class_instances
       where contract_id = ${c.contractId}
       order by starts_at_utc`
    expect(linhas).toHaveLength(2)
    // instantes DIFERENTES, uma hora entre eles…
    expect(new Date(linhas[1].inicio).getTime() - new Date(linhas[0].inicio).getTime()).toBe(3_600_000)
    // …e o MESMO horário civil de Lisboa nos dois, que é o fato da virada.
    expect(linhas[0].snap).toBe(`${dia} 01:30 Europe/Lisbon`)
    expect(linhas[1].snap).toBe(`${dia} 01:30 Europe/Lisbon`)
    expect(linhas[0].dia).toBe(dia)
    expect(linhas[1].dia).toBe(dia)
  })

  it('o snapshot da experimental usa o offset DAQUELE dia (Nova York, antes e depois da virada)', async () => {
    const teacher = await createTeacher(sql)
    // 09:00 em Nova York vale 13:00Z no horário de verão (EDT, UTC−4) e 14:00Z
    // no de inverno (EST, UTC−5). O snapshot tem de dizer 09:00 nos dois.
    //
    // Os dois dias são RELATIVOS: amanhã e o dia da próxima virada do relógio
    // de Nova York (um de cada lado da virada, os dois no futuro). O caso
    // cravado em 15/10/2026 e 15/12/2026 ficou vermelho no CI em 15/10/2026
    // às 13:00Z, quando o instante virou passado e a RPC recusou.
    const amanha = DateTime.now().setZone('America/New_York').plus({ days: 1 }).startOf('day')
    // a sonda parte do MEIO-DIA de amanhã: se amanhã for o próprio dia da
    // virada, `proximaVirada` devolveria amanhã e os dois casos cairiam no
    // mesmo dia.
    const virada = proximaVirada(amanha.set({ hour: 12 }))
    const casos = [amanha, virada].map((d) => ({
      instante: d.set({ hour: 9 }).toUTC().toISO()!,
      dia: d.toISODate()!,
    }))
    // a prova de que a virada existe: 09:00 civis caem em horas UTC DIFERENTES
    expect(new Set(casos.map((k) => k.instante.slice(11, 13)))).toEqual(new Set(['13', '14']))
    for (const { instante, dia } of casos) {
      const { data: id, error } = await admin.rpc('admin_create_trial_class', {
        p_student_name: `Experimental A6 ${dia}`,
        p_iana_tz: 'America/New_York',
        p_teacher: teacher,
        p_starts_at_utc: instante,
        p_duration_min: 45,
      })
      expect(error, dia).toBeNull()
      const [linha] = await sql<{ snap: string; dia: string; started: string }[]>`
        select ci.local_time_snapshot as snap, ci.occurrence_date::text as dia,
               c.started_on::text as started
          from class_instances ci join contracts c on c.id = ci.contract_id
         where ci.id = ${id as string}`
      expect(linha.snap).toBe(`${dia} 09:00 America/New_York`)
      expect(linha.dia).toBe(dia)
      // o contrato leve nasce com a data CIVIL da aula (como antes, quando o
      // parâmetro era `p_local_date`)
      expect(linha.started).toBe(dia)
    }
  })

  it('janela publicada guarda instante, data/hora civis e snapshot coerentes', async () => {
    const t = await createTeacher(sql)
    const dia = daysFromToday(4)
    const instante = instanteEm(dia, '15:30')
    const { data: winId, error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: t,
      p_starts_at_utc: instante,
      p_iana_tz: 'America/Cuiaba',
    })
    expect(error).toBeNull()
    const [w] = await sql<
      { inicio: string; d: string; h: string; snap: string; tz: string }[]
    >`select starts_at_utc::text as inicio, local_date::text as d, local_time::text as h,
             local_time_snapshot as snap, iana_tz as tz
        from reschedule_windows where id = ${winId as string}`
    expect(new Date(w.inicio).toISOString()).toBe(new Date(instante).toISOString())
    expect(w.d).toBe(dia)
    expect(w.h).toBe('15:30:00')
    expect(w.snap).toBe(`${dia} 15:30 America/Cuiaba`)
    expect(w.tz).toBe('America/Cuiaba')
  })

  it('instante NULO é recusado nas três (não existe aula sem quando)', async () => {
    const c = await createPrivateContract(sql)
    const avulsa = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: null,
      p_duration_min: 45,
      p_kind: 'courtesy',
    })
    expect(avulsa.error?.message).toContain('instante de início')
    const trial = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Sem quando',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: c.teacherId,
      p_starts_at_utc: null,
      p_duration_min: 45,
    })
    expect(trial.error?.message).toContain('instante de início')
    const janela = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: null,
    })
    expect(janela.error?.message).toContain('instante do horário')
  })
})

/* ========================================================================== */
/* 2. A6/b — CORTESIA NÃO CARREGA PREÇO                                        */
/* ========================================================================== */

describe('A6/b · cortesia é gratuita no BANCO', () => {
  it('a RPC recusa cortesia com preço, e a extra cobrada continua exigindo valor', async () => {
    const c = await createPrivateContract(sql)
    const comPreco = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(3), '08:00'),
      p_duration_min: 45,
      p_kind: 'courtesy',
      p_price_cents: 15000,
    })
    expect(comPreco.error?.message).toContain('cortesia não leva valor')

    // PROVA DE MUTAÇÃO: a MESMA cortesia sem preço passa…
    const semPreco = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(3), '08:00'),
      p_duration_min: 45,
      p_kind: 'courtesy',
    })
    expect(semPreco.error).toBeNull()
    // …e a guarda do outro lado (extra sem valor) continua de pé
    const extraSemValor = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(3), '09:00'),
      p_duration_min: 45,
      p_kind: 'extra_paid',
    })
    expect(extraSemValor.error?.message).toContain('valor')
  })

  it('o CHECK vale para QUALQUER porta — nem o dono da tabela grava cortesia com preço', async () => {
    const c = await createPrivateContract(sql)
    await expect(
      sql`insert into class_instances
            (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
             single_kind, single_price_cents)
          values (${c.contractId}, ${c.teacherId}, now() + interval '30 days',
                  now() + interval '30 days 45 minutes', 'fixture A6', 'courtesy', 15000)`,
    ).rejects.toThrow(/class_instances_courtesy_sem_preco/)

    // …e a aula de horário fixo (single_kind NULL) não é confundida com cortesia
    const [ok] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId}, now() + interval '31 days',
              now() + interval '31 days 45 minutes', 'fixture A6 fixa')
      returning id`
    expect(ok.id).toBeTruthy()
  })
})

/* ========================================================================== */
/* 3. A6/c — DURAÇÃO SÃ (15..480) É REGRA DO BANCO                             */
/* ========================================================================== */

describe('A6/c · duração de aula entre 15 e 480 minutos', () => {
  it('as duas RPCs recusam 14 e 481, e aceitam os extremos 15 e 480', async () => {
    const c = await createPrivateContract(sql)
    const teacher = await createTeacher(sql)
    let hora = 6
    for (const ruim of [14, 481]) {
      const avulsa = await admin.rpc('admin_create_single_class', {
        p_contract: c.contractId,
        p_starts_at_utc: instanteEm(daysFromToday(9), `${String(hora).padStart(2, '0')}:00`),
        p_duration_min: ruim,
        p_kind: 'courtesy',
      })
      expect(avulsa.error?.message, `avulsa ${ruim}`).toContain('entre 15 e 480 minutos')
      const trial = await admin.rpc('admin_create_trial_class', {
        p_student_name: `Duração ${ruim}`,
        p_iana_tz: 'America/Cuiaba',
        p_teacher: teacher,
        p_starts_at_utc: instanteEm(daysFromToday(9), `${String(hora).padStart(2, '0')}:00`),
        p_duration_min: ruim,
      })
      expect(trial.error?.message, `trial ${ruim}`).toContain('entre 15 e 480 minutos')
      hora += 1
    }

    // PROVA DE MUTAÇÃO: os extremos VÁLIDOS entram (a régua é fechada nos dois
    // lados, não um jeito de recusar duração incomum).
    for (const bom of [15, 480]) {
      const { error } = await admin.rpc('admin_create_single_class', {
        p_contract: c.contractId,
        p_starts_at_utc: instanteEm(daysFromToday(10 + bom % 7), `${String(hora).padStart(2, '0')}:00`),
        p_duration_min: bom,
        p_kind: 'courtesy',
      })
      expect(error, `duração ${bom}`).toBeNull()
      hora += 9
    }
  })

  it('o CHECK vale para qualquer porta — 5 minutos e 9 horas são recusados na tabela', async () => {
    const c = await createPrivateContract(sql)
    for (const min of [5, 540]) {
      await expect(
        sql`insert into class_instances
              (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
            values (${c.contractId}, ${c.teacherId}, now() + interval '40 days',
                    now() + interval '40 days' + make_interval(mins => ${min}), 'fixture A6 dur')`,
      ).rejects.toThrow(/class_instances_duration_sane/)
    }
  })
})

/* ========================================================================== */
/* 4. A6/d — PUBLICAR NÃO PASSA POR CIMA DE BLOQUEIO NEM DE AULA               */
/* ========================================================================== */

describe('A6/d · a publicação de horário confere bloqueio e conflito', () => {
  it('dentro de bloqueio: recusa nomeando o período, e sem bloqueio a MESMA publicação passa', async () => {
    const t = await createTeacher(sql)
    const dia = daysFromToday(6)
    await bloquear(t, dia)
    const recusa = await admin.rpc('publish_reschedule_window', {
      p_teacher: t,
      p_starts_at_utc: instanteEm(dia, '10:00'),
    })
    expect(recusa.error?.message).toContain('dentro de um bloqueio da professora')
    expect(recusa.error?.message).toContain(dia) // o período, para ela poder removê-lo
    expect(
      await sql`select 1 from reschedule_windows where teacher_id = ${t}`,
    ).toHaveLength(0)

    // PROVA DE MUTAÇÃO: no dia SEGUINTE ao bloqueio, publica.
    const { error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: t,
      p_starts_at_utc: instanteEm(daysFromToday(7), '10:00'),
    })
    expect(error).toBeNull()
  })

  it('em cima de aula agendada: recusa (janela assim ninguém conseguiria reservar)', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(11)
    // Aula de 60 min às 13:00 de Cuiabá, com instante EXATO (sem microssegundos
    // de `now()`, que truncariam na volta pelo JSON e mascarariam a borda).
    const inicio = instanteEm(dia, '13:00')
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId}, ${inicio},
              ${inicio}::timestamptz + interval '60 minutes', ${`${dia} 13:00 America/Cuiaba`})`

    // o próprio início da aula
    const emCima = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: inicio,
    })
    expect(emCima.error?.message).toContain('já tem aula marcada nesse horário')

    // …e DENTRO dela (30 min depois do início de uma aula de 60)
    const dentro = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(dia, '13:30'),
    })
    expect(dentro.error?.message).toContain('já tem aula marcada nesse horário')

    // PROVA DE MUTAÇÃO: no instante EXATO do fim (borda exclusiva), publica.
    const { error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(dia, '14:00'),
    })
    expect(error).toBeNull()
  })

  it('aula CANCELADA não impede publicar no lugar dela (só `scheduled` conta)', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(13)
    const inicio = instanteEm(dia, '13:00')
    const [inst] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
      values (${c.contractId}, ${c.teacherId}, ${inicio},
              ${inicio}::timestamptz + interval '45 minutes',
              ${`${dia} 13:00 America/Cuiaba`}, 'cancelled')
      returning id`
    expect(inst.id).toBeTruthy()
    const { error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: inicio,
    })
    expect(error).toBeNull()
  })
})

/* ========================================================================== */
/* 5. A6/e — O CINTO DA RESERVA                                                */
/* ========================================================================== */

describe('A6/e · reservar janela que caiu em bloqueio criado DEPOIS', () => {
  it('recusa, e sem o bloqueio a MESMA reserva acontece', async () => {
    const dia = daysFromToday(5)
    const instanteDaJanela = instanteEm(dia, '14:00')

    async function cenario() {
      const c = await createPrivateContract(sql, { minNotice: 1 })
      const inst = await createInstance(sql, c, { startsInHours: 24 * 9 })
      const { data: win, error } = await admin.rpc('publish_reschedule_window', {
        p_teacher: c.teacherId,
        p_starts_at_utc: instanteDaJanela,
      })
      expect(error).toBeNull()
      return { c, inst, win: win as string }
    }

    const bloqueado = await cenario()
    // O bloqueio entra por FORA de `add_teacher_block` de propósito: a porta de
    // produção cancela as janelas publicadas do período (A6/f), então ela nunca
    // deixaria a janela em `publicada`. O cinto existe para o que a porta não
    // cobre — corrida, republicação, escrita por outro caminho.
    await sql`
      insert into teacher_availability_exceptions
        (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot, note)
      values (${bloqueado.c.teacherId}, 'block',
              (${dia}::date + time '00:00') at time zone 'America/Cuiaba',
              ((${dia}::date + 1) + time '00:00') at time zone 'America/Cuiaba',
              ${`${dia} → ${dia} America/Cuiaba`}, 'inserido fora da RPC')`

    const recusa = await admin.rpc('book_reschedule_window', {
      p_window: bloqueado.win,
      p_instance: bloqueado.inst,
    })
    expect(recusa.error?.message).toContain('foi bloqueado pela professora')
    // nada mudou: a aula original continua agendada e a janela continua publicada
    const [depois] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${bloqueado.inst}`
    expect(depois.state).toBe('scheduled')
    const [w] = await sql<{ state: string }[]>`
      select state from reschedule_windows where id = ${bloqueado.win}`
    expect(w.state).toBe('publicada')

    // PROVA DE MUTAÇÃO: cenário idêntico, sem bloqueio nenhum → reserva feita.
    const livre = await cenario()
    const { error } = await admin.rpc('book_reschedule_window', {
      p_window: livre.win,
      p_instance: livre.inst,
    })
    expect(error).toBeNull()
  })

  // ── A JANELA DAS 23:30 (dívida nomeada do A9, morta aqui) ───────────────────
  // A primeira versão do cinto perguntava só pelo INSTANTE da janela. A janela
  // publicada às 23:30 da véspera está fora do bloqueio do dia seguinte — e a
  // aula de 60 min que nasce dela entra 30 minutos DENTRO do dia bloqueado.
  // Conferir o início deixava essa passar, gastando franquia ou crédito para pôr
  // uma aula num dia em que a professora não atende.
  it('a aula de 60 min das 23:30 INVADE o bloqueio do dia seguinte e é recusada', async () => {
    const vespera = daysFromToday(8)
    const bloqueado = daysFromToday(9)

    /** Contrato + aula original de `dur` minutos + janela publicada às 23:30. */
    async function cenario(dur: number) {
      const c = await createPrivateContract(sql, { minNotice: 1 })
      const inst = await createInstance(sql, c, { startsInHours: 24 * 20, durationMin: dur })
      const { data: win, error } = await admin.rpc('publish_reschedule_window', {
        p_teacher: c.teacherId,
        p_starts_at_utc: instanteEm(vespera, '23:30'),
      })
      // a publicação PASSA de propósito: o instante 23:30 da véspera está fora
      // do bloqueio — é justamente por isso que o cinto da reserva precisa
      // perguntar pela aula inteira.
      expect(error).toBeNull()
      // o bloqueio do dia SEGUINTE não alcança essa janela (ela não está no
      // período), então ela continua `publicada` depois do A6/f
      await bloquear(c.teacherId, bloqueado)
      const [w] = await sql<{ state: string }[]>`
        select state from reschedule_windows where id = ${win as string}`
      expect(w.state).toBe('publicada')
      return { c, inst, win: win as string }
    }

    const invade = await cenario(60)
    const recusa = await admin.rpc('book_reschedule_window', {
      p_window: invade.win,
      p_instance: invade.inst,
    })
    expect(recusa.error?.message).toContain('foi bloqueado pela professora')
    expect(recusa.error?.message).toContain(bloqueado) // o período, para removê-lo
    // nada mudou dos dois lados
    const [orig] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${invade.inst}`
    expect(orig.state).toBe('scheduled')
    const [w] = await sql<{ state: string }[]>`
      select state from reschedule_windows where id = ${invade.win}`
    expect(w.state).toBe('publicada')

    // PROVA DE MUTAÇÃO: 30 minutos terminam 00:00 EM PONTO — a borda do fim é
    // exclusiva, a aula não invade, e a MESMA reserva acontece.
    const naBorda = await cenario(30)
    const { error } = await admin.rpc('book_reschedule_window', {
      p_window: naBorda.win,
      p_instance: naBorda.inst,
    })
    expect(error).toBeNull()
    const [nova] = await sql<{ inicio: string; fim: string }[]>`
      select starts_at_utc::text as inicio, ends_at_utc::text as fim
        from class_instances where reschedule_of = ${naBorda.inst}`
    expect(new Date(nova.fim).getTime() - new Date(nova.inicio).getTime()).toBe(30 * 60_000)
  })

  // ── OS 20 SEGUNDOS QUE O ARREDONDAMENTO ESCONDIA (Sol · rodada 2) ──────────
  // O cinto derivava a duração por `round(epoch/60)`, mas `reschedule_class_at`
  // preserva `ends_at_utc - starts_at_utc` EXATO e a coluna aceita segundos (o
  // CHECK desta migration é de FAIXA, 15..480 min, não de granularidade). Uma
  // aula de 30m20s às 23:30 era medida como "30 min", terminava 00:00 em ponto
  // aos olhos do cinto — e renascia 20 segundos DENTRO do dia bloqueado.
  it('a aula de 30m20s das 23:30 invade o bloqueio por 20 SEGUNDOS — e é recusada', async () => {
    const vespera = daysFromToday(11)
    const bloqueado = daysFromToday(12)

    /** Contrato + aula original com duração EXATA em segundos + janela 23:30. */
    async function cenario(segundos: number) {
      const c = await createPrivateContract(sql, { minNotice: 1 })
      const inst = await createInstance(sql, c, { startsInHours: 24 * 20, durationMin: 30 })
      // a duração com segundos é escrita direto: nenhuma porta da casa oferece
      // isso, e é justamente por isso que ela precisa estar no teste — dado
      // legado/importado tem o direito de existir sem furar o cinto.
      await sql`
        update class_instances
           set ends_at_utc = starts_at_utc + make_interval(secs => ${segundos})
         where id = ${inst}`
      const { data: win, error } = await admin.rpc('publish_reschedule_window', {
        p_teacher: c.teacherId,
        p_starts_at_utc: instanteEm(vespera, '23:30'),
      })
      expect(error).toBeNull()
      await bloquear(c.teacherId, bloqueado)
      return { c, inst, win: win as string }
    }

    const invade = await cenario(30 * 60 + 20)
    const recusa = await admin.rpc('book_reschedule_window', {
      p_window: invade.win,
      p_instance: invade.inst,
    })
    expect(recusa.error?.message).toContain('foi bloqueado pela professora')
    const [orig] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${invade.inst}`
    expect(orig.state).toBe('scheduled')

    // PROVA DE MUTAÇÃO: 30 min EXATOS (mesmo caminho, mesma escrita direta)
    // terminam 00:00 em ponto e passam — e a aula nova nasce com a duração
    // exata da original, sem arredondamento nenhum no meio.
    const naBorda = await cenario(30 * 60)
    const { error } = await admin.rpc('book_reschedule_window', {
      p_window: naBorda.win,
      p_instance: naBorda.inst,
    })
    expect(error).toBeNull()
    const [nova] = await sql<{ ms: number }[]>`
      select (extract(epoch from (ends_at_utc - starts_at_utc)) * 1000)::int as ms
        from class_instances where reschedule_of = ${naBorda.inst}`
    expect(Number(nova.ms)).toBe(30 * 60_000)
  })
})

/* ========================================================================== */
/* 6. A6/f — O BLOQUEIO FECHA A OFERTA JÁ PUBLICADA                            */
/* ========================================================================== */

describe('A6/f · `add_teacher_block` cancela as janelas publicadas do período', () => {
  it('fecha as do período, devolve a contagem, e não encosta nas de fora nem nas aulas', async () => {
    const c = await createPrivateContract(sql)
    const dentro1 = daysFromToday(4)
    const dentro2 = daysFromToday(5)
    const fora = daysFromToday(7)
    const publicar = async (dia: string, hora: string) => {
      const { data, error } = await admin.rpc('publish_reschedule_window', {
        p_teacher: c.teacherId,
        p_starts_at_utc: instanteEm(dia, hora),
      })
      expect(error).toBeNull()
      return data as string
    }
    const w1 = await publicar(dentro1, '09:00')
    const w2 = await publicar(dentro2, '10:00')
    const w3 = await publicar(fora, '11:00')
    // uma aula DENTRO do período: ela continua de pé (é do tratamento de período)
    const aula = await createInstance(sql, c, { startsInHours: 24 * 4 + 20 })

    const r = await bloquear(c.teacherId, dentro1, dentro2)
    expect(r.closed_windows).toBe(2)
    expect(r.exception_id).toBeTruthy()

    const estados = await sql<{ id: string; state: string }[]>`
      select id, state from reschedule_windows where id in ${sql([w1, w2, w3])}`
    const porId = Object.fromEntries(estados.map((e) => [e.id, e.state]))
    expect(porId[w1]).toBe('cancelada')
    expect(porId[w2]).toBe('cancelada')
    expect(porId[w3]).toBe('publicada')
    const [ci] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${aula}`
    expect(ci.state).toBe('scheduled')

    // a contagem também fica na trilha (Lei 8)
    const [audit] = await sql<{ diff: Record<string, unknown> }[]>`
      select diff from audit_log
       where action = 'add_teacher_block' and entity_id = ${r.exception_id}`
    expect(audit.diff.closed_windows).toBe(2)
  })

  it('janela CONSUMIDA não volta atrás — ela já virou aula', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    const dia = daysFromToday(6)
    const inst = await createInstance(sql, c, { startsInHours: 24 * 10 })
    const { data: win } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(dia, '16:00'),
    })
    const { error } = await admin.rpc('book_reschedule_window', {
      p_window: win as string,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const r = await bloquear(c.teacherId, dia)
    expect(r.closed_windows).toBe(0)
    const [w] = await sql<{ state: string }[]>`
      select state from reschedule_windows where id = ${win as string}`
    expect(w.state).toBe('consumida')
  })

  it('sem janela publicada no período, a contagem é ZERO (e o bloqueio existe)', async () => {
    const t = await createTeacher(sql)
    const r = await bloquear(t, daysFromToday(20))
    expect(r.closed_windows).toBe(0)
    const [e] = await sql<{ kind: string }[]>`
      select kind from teacher_availability_exceptions where id = ${r.exception_id}`
    expect(e.kind).toBe('block')
  })

  it('`admin_period_treatment` acompanha o retorno novo (o contrato dela não muda)', async () => {
    const c = await createPrivateContract(sql)
    // Aula e janela em horas civis FIXAS do dia 5 (meio do período 4–6). Antes a
    // aula nascia em "agora + 5 dias" (hora civil do momento da rodada): das
    // 18:15 às 19:00 de Cuiabá ela cobria as 19:00 da janela,
    // `publish_reschedule_window` recusava (A6/d) e o teste quebrava só nessa
    // faixa do relógio (vermelho no CI em 10/10/2026, rodada das 18:25).
    const inst = await createInstanceAt(sql, c, instanteEm(daysFromToday(5), '10:00'))
    const { data: janela, error: erroJanela } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(5), '19:00'),
    })
    expect(erroJanela).toBeNull()
    const { data, error } = await admin.rpc('admin_period_treatment', {
      p_teacher: c.teacherId,
      p_from: daysFromToday(4),
      p_to: daysFromToday(6),
      p_mode: 'cancel_credit',
      p_note: 'férias A6',
    })
    expect(error).toBeNull()
    const r = data as { block: string; cancelled: number; invited: number }
    // `block` continua sendo o UUID da exceção, não o objeto inteiro
    expect(r.block).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.cancelled).toBe(1)
    expect(r.invited).toBe(0)
    const [e] = await sql<{ kind: string }[]>`
      select kind from teacher_availability_exceptions where id = ${r.block}`
    expect(e.kind).toBe('block')
    // …e a janela publicada do período saiu da oferta junto
    const [w] = await sql<{ state: string }[]>`
      select state from reschedule_windows where id = ${janela as string}`
    expect(w.state).toBe('cancelada')
    const [ci] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${inst}`
    expect(ci.state).toBe('cancelled')
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-cancelled' and payload->>'student_id' = ${c.studentId}::text`
  })
})

/* ========================================================================== */
/* 7. A6/g — A PORTA DO BLOQUEIO REMOVE BLOQUEIO                               */
/* ========================================================================== */

describe('A6/g · `remove_teacher_block` confere o `kind`', () => {
  it('exceção `open` é recusada e CONTINUA existindo; bloqueio é removido', async () => {
    const t = await createTeacher(sql)
    const [aberta] = await sql<{ id: string }[]>`
      insert into teacher_availability_exceptions
        (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
      values (${t}, 'open', now() + interval '10 days', now() + interval '10 days 2 hours',
              'abertura A6')
      returning id`
    const recusa = await admin.rpc('remove_teacher_block', { p_id: aberta.id })
    expect(recusa.error?.message).toContain('não é um bloqueio')
    expect(
      await sql`select 1 from teacher_availability_exceptions where id = ${aberta.id}`,
    ).toHaveLength(1)

    // PROVA DE MUTAÇÃO: o bloqueio de verdade sai pela mesma porta.
    const bloqueio = await bloquear(t, daysFromToday(11))
    const { error } = await admin.rpc('remove_teacher_block', { p_id: bloqueio.exception_id })
    expect(error).toBeNull()
    expect(
      await sql`select 1 from teacher_availability_exceptions where id = ${bloqueio.exception_id}`,
    ).toHaveLength(0)
  })
})

/* ========================================================================== */
/* 8. A6/h — AULA NÃO NASCE SOBRE BLOQUEIO (SOBREPOSIÇÃO, NÃO SÓ O INÍCIO)     */
/* ========================================================================== */

describe('A6/h · as duas portas de criação recusam aula sobre bloqueio', () => {
  it('a aula que COMEÇA ANTES e invade o bloqueio é recusada (avulsa e experimental)', async () => {
    const c = await createPrivateContract(sql)
    const teacher = await createTeacher(sql)
    const bloqueado = daysFromToday(8)
    const vespera = daysFromToday(7)
    await bloquear(c.teacherId, bloqueado)
    await bloquear(teacher, bloqueado)

    // 23:30 da véspera + 60 min = 00:30 do dia bloqueado: o INÍCIO está livre e
    // o intervalo invade. Conferir só o início deixaria esta passar.
    const avulsa = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(vespera, '23:30'),
      p_duration_min: 60,
      p_kind: 'courtesy',
    })
    expect(avulsa.error?.message).toContain('bloqueio de agenda nesse período')

    const trial = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Experimental sobre bloqueio',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacher,
      p_starts_at_utc: instanteEm(vespera, '23:30'),
      p_duration_min: 60,
      p_price_cents: 8000,
    })
    expect(trial.error?.message).toContain('bloqueio de agenda nesse período')

    // PROVA DE MUTAÇÃO: 30 minutos, terminando 00:00 em ponto — a borda do fim é
    // EXCLUSIVA, então esta NÃO invade e passa nas duas portas.
    const naBorda = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(vespera, '23:30'),
      p_duration_min: 30,
      p_kind: 'courtesy',
    })
    expect(naBorda.error).toBeNull()
    const trialNaBorda = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Experimental na borda',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacher,
      p_starts_at_utc: instanteEm(vespera, '23:30'),
      p_duration_min: 30,
    })
    expect(trialNaBorda.error).toBeNull()
  })

  it('a aula DENTRO do dia bloqueado é recusada, e nada é criado a meio caminho', async () => {
    const teacher = await createTeacher(sql)
    const dia = daysFromToday(9)
    await bloquear(teacher, dia)

    const trial = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Experimental atomica A6',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacher,
      p_starts_at_utc: instanteEm(dia, '10:00'),
      p_duration_min: 45,
    })
    expect(trial.error?.message).toContain('bloqueio de agenda nesse período')
    // A experimental cria pessoa + contrato + aula num ato só: a recusa não pode
    // deixar a pessoa nascida sozinha. A prova é pelo NOME, não por contagem
    // global de `students` — a suíte roda arquivos em paralelo e a contagem se
    // move por baixo do teste.
    expect(
      await sql`select 1 from students where display_name = 'Experimental atomica A6'`,
    ).toHaveLength(0)
    expect(
      await sql`select 1 from contracts where plan_name = 'Aula experimental'
                 and teacher_id = ${teacher}`,
    ).toHaveLength(0)
  })

  it('a JANELA SEMANAL não é proibitiva — aula fora dela continua possível (régua do A3)', async () => {
    // A camada `avail` é INFORMATIVA por decisão do A3: a professora atende fora
    // dela a combinar. Só a PROIBIÇÃO (`kind='block'`) entra no banco.
    const c = await createPrivateContract(sql)
    const { error: erroJanela } = await admin.rpc('set_weekly_availability', {
      p_teacher: c.teacherId,
      p_weekday: 1,
      p_start: '08:00',
      p_end: '09:00',
      p_iana_tz: 'America/Cuiaba',
    })
    expect(erroJanela).toBeNull()
    const { error } = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(12), '21:00'),
      p_duration_min: 45,
      p_kind: 'courtesy',
    })
    expect(error).toBeNull()
  })
})

/* ========================================================================== */
/* 9. A6/i — ACESSO AO PORTAL NÃO NASCE SEM WHATSAPP                           */
/* ========================================================================== */

describe('A6/i · vínculo de acesso exige número de WhatsApp no perfil', () => {
  it('perfil SEM número é recusado no vínculo; com número, o MESMO vínculo passa', async () => {
    const semNumero = await createAuthUser(sql, 'student', 'Aluno sem número', { whatsapp: null })
    const aluno = await createStudent(sql)
    await expect(
      sql`update students set profile_id = ${semNumero} where id = ${aluno}`,
    ).rejects.toThrow(/número de WhatsApp/)
    const [antes] = await sql<{ profile_id: string | null }[]>`
      select profile_id from students where id = ${aluno}`
    expect(antes.profile_id).toBeNull()

    // PROVA DE MUTAÇÃO: cadastrado o número, o mesmo UPDATE passa.
    await sql`update profiles set whatsapp_e164 = '+5565900090009' where id = ${semNumero}`
    await sql`update students set profile_id = ${semNumero} where id = ${aluno}`
    const [depois] = await sql<{ profile_id: string | null }[]>`
      select profile_id from students where id = ${aluno}`
    expect(depois.profile_id).toBe(semNumero)
  })

  it('a limpeza do número DEPOIS do vínculo continua permitida (decisão aceita)', async () => {
    // O admin é dono do dado e precisa poder corrigir número errado; a
    // anonimização também limpa. O que o A6 fecha é o NASCIMENTO do acesso.
    const user = await createAuthUser(sql, 'student', 'Aluno que perde o número')
    const aluno = await createStudent(sql)
    await sql`update students set profile_id = ${user} where id = ${aluno}`
    await sql`update profiles set whatsapp_e164 = null where id = ${user}`
    const [p] = await sql<{ whatsapp_e164: string | null }[]>`
      select whatsapp_e164 from profiles where id = ${user}`
    expect(p.whatsapp_e164).toBeNull()
  })

  it('as outras três recusas do mesmo gatilho continuam de pé (lead, arquivado, anonimizado)', async () => {
    const mk = async () => createAuthUser(sql, 'student', 'Aluno gatilho A6')
    const lead = await createStudent(sql)
    await sql`update students set status = 'lead' where id = ${lead}`
    await expect(
      sql`update students set profile_id = ${await mk()} where id = ${lead}`,
    ).rejects.toThrow(/lead não tem portal/)

    const arquivado = await createStudent(sql)
    await sql`update students set status = 'archived' where id = ${arquivado}`
    await expect(
      sql`update students set profile_id = ${await mk()} where id = ${arquivado}`,
    ).rejects.toThrow(/arquivado não recebe acesso/)

    const anonimo = await createStudent(sql)
    await sql`update students set anonymized_at = now() where id = ${anonimo}`
    await expect(
      sql`update students set profile_id = ${await mk()} where id = ${anonimo}`,
    ).rejects.toThrow(/anonimizada/)
  })
})

/* ========================================================================== */
/* 10. OS ESCRITORES DA AGENDA DA PROFESSORA SÃO SERIALIZADOS                  */
/* ========================================================================== */
//
// Toda trava desta migration é CHECK-THEN-INSERT. Sem recurso em comum, duas
// transações se cruzam e commitam um estado que nenhuma das duas aceitaria
// sozinha. O recurso é o advisory `teacher_agenda:<professora>` do c10 · T2 — a
// MESMA chave que `pause_contract`, `_assert_no_paused_overlap` e
// `_assert_no_active_overlap` disputam.

describe('A6/locks · o advisory `teacher_agenda` serializa quem escreve na agenda', () => {
  it('os CINCO corpos pedem o advisory, com a chave da casa', () => {
    for (const nome of [
      'publish_reschedule_window',
      'add_teacher_block',
      'admin_create_single_class',
      'admin_create_trial_class',
      'book_reschedule_window',
    ]) {
      const { corpo, origem } = definicaoDaFuncao(nome)
      expect(origem, nome).toBe('20260730000100_a6_travas_de_agenda.sql')
      // a construção EXATA de `pause_contract` (20260727001000): mesmo prefixo,
      // mesmo `hashtextextended(..., 0)`. Chave diferente = lock diferente = a
      // serialização não existe, e o teste ficaria verde medindo o nada.
      expect(corpo, nome).toMatch(
        /pg_advisory_xact_lock\(\s*hashtextextended\('teacher_agenda:' \|\| [a-z_.]+::text, 0\)\)/,
      )
    }
  })

  it('a POSIÇÃO respeita a ordem canônica global (nenhum par pré-existente invertido)', () => {
    // `add_teacher_block`: reschedule_windows (3º andar) ANTES do advisory (5º).
    // Invertido, ele fecharia ciclo com `book_reschedule_window`, que segura a
    // janela e pede `teacher_agenda` no `insert` da aula.
    const atb = corpoDaFuncao('add_teacher_block')
    expect(atb.indexOf('for update')).toBeGreaterThan(-1)
    expect(atb.indexOf('for update')).toBeLessThan(atb.indexOf("'teacher_agenda:'"))
    // …e o `insert` da exceção — o estado que os outros LEEM — vem depois dele.
    expect(atb.indexOf("'teacher_agenda:'")).toBeLessThan(
      atb.indexOf('insert into teacher_availability_exceptions'),
    )

    // `book_reschedule_window`: sub-ordem do 5º andar (adendo do c10) —
    // `makeup_spend` antes de `teacher_agenda`. Ao contrário, inverteria o par
    // contra `book_computed_slot`, que segura `makeup_spend` e chama esta.
    const brw = corpoDaFuncao('book_reschedule_window')
    expect(brw.indexOf("'makeup_spend:'")).toBeGreaterThan(-1)
    expect(brw.indexOf("'makeup_spend:'")).toBeLessThan(brw.indexOf("'teacher_agenda:'"))
    // e os três locks de linha continuam antes de tudo isso
    expect(brw.indexOf('from reschedule_windows where id = p_window for update')).toBeLessThan(
      brw.indexOf("'makeup_spend:'"),
    )

    // `admin_create_single_class`: contrato (1º andar) antes do advisory (5º).
    const asc = corpoDaFuncao('admin_create_single_class')
    expect(asc.indexOf('from contracts where id = p_contract for update')).toBeLessThan(
      asc.indexOf("'teacher_agenda:'"),
    )
  })

  it('o cinto da reserva pergunta pela FAIXA da aula, não pelo instante da janela', () => {
    const brw = corpoDaFuncao('book_reschedule_window')
    expect(brw).toContain(
      'tstzrange(v_win.starts_at_utc, v_ends) && tstzrange(e.starts_at_utc, e.ends_at_utc)',
    )
    // a derivação da duração vem ANTES do cinto (é ela que fecha a faixa)
    expect(brw.indexOf('v_ends := v_win.starts_at_utc')).toBeLessThan(
      brw.indexOf('foi bloqueado pela professora'),
    )
  })

  it('enquanto alguém segura o advisory da professora, publicar e bloquear ESPERAM', async () => {
    const t = await createTeacher(sql)
    const outra = connect(1)
    let publicar!: Promise<{ error: { message: string } | null }>
    let bloquearAgora!: Promise<{ error: { message: string } | null }>
    try {
      await outra.begin(async (tx) => {
        // a MESMA chave, tomada à mão: é o que uma transação concorrente de
        // `pause_contract`/`add_teacher_block` estaria segurando.
        await tx`select pg_advisory_xact_lock(hashtextextended(${'teacher_agenda:' + t}, 0))`
        publicar = (async () =>
          admin.rpc('publish_reschedule_window', {
            p_teacher: t,
            p_starts_at_utc: instanteEm(daysFromToday(12), '10:00'),
          }))()
        bloquearAgora = (async () =>
          admin.rpc('add_teacher_block', {
            p_teacher: t,
            p_from: daysFromToday(14),
            p_to: daysFromToday(14),
            p_note: 'serialização A6',
          }))()
        const quem = await Promise.race([
          Promise.any([publicar, bloquearAgora]).then(() => 'respondeu'),
          new Promise((r) => setTimeout(() => r('esperou'), 1200)),
        ])
        expect(quem).toBe('esperou')
      })
      // solto o advisory (fim da transação), as duas atravessam
      expect((await publicar).error).toBeNull()
      expect((await bloquearAgora).error).toBeNull()
    } finally {
      await outra.end()
    }
  })
})
