// A6 · LOTE 2 — O AVISO DO CANCELAMENTO VIROU ESCOLHA (migration 99).
//
// O que este arquivo prova, contra o Postgres de verdade:
//   1. os DEFAULTS preservam o comportamento de sempre — quem não escolhe nada
//      continua avisando pelos dois canais (é a prova que impede o A6 de virar
//      um cancelamento silencioso por descuido);
//   2. desligar um flag SUPRIME aquele canal, e só aquele;
//   3. a condição do NÚMERO continua por baixo do flag: `p_notify_whatsapp` não
//      inventa WhatsApp em cadastro que não tem;
//   4. `_cancel_class_core` DEVOLVE `{credited, refund_blocked, expires_on}` —
//      os mesmos valores que grava no audit, agora legíveis na transação;
//   5. `admin_period_treatment` conta cancelamento, CRÉDITO e BLOQUEIO em
//      separado, e guarda os uuids de cada grupo no audit;
//   6. as provas ESTRUTURAIS (assinatura única, defaults, ACL) por
//      `definicaoDaFuncao`, que lê as migrations em ordem.
//
// Cada supressão vem com a PROVA DE MUTAÇÃO do caminho ligado ao lado: recusa
// sem o caminho bom provado é recusa que pode estar recusando tudo.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
} from './helpers/db'
import { definicaoDaFuncao } from './helpers/definicao-da-funcao'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin A6L2'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/**
 * Contrato particular com aluno que TEM login — e, por consequência do A6/i,
 * número de WhatsApp (o gatilho `students_lead_sem_login` recusa vincular
 * acesso a perfil sem número).
 *
 * `semWhatsapp: true` monta o outro estado legítimo: o número foi LIMPO pelo
 * admin depois do vínculo (migration 95 aceita a limpeza deliberada). É o único
 * jeito honesto de ter login sem número neste banco.
 */
async function contratoComLogin(opts: { semWhatsapp?: boolean } = {}) {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno A6L2')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  if (opts.semWhatsapp)
    await sql`update profiles set whatsapp_e164 = null where id = ${userId}`
  return { ...c, userId }
}

/** As linhas da outbox DESTE cancelamento, por canal. */
async function avisosDe(instance: string) {
  const linhas = await sql`
    select coalesce(channel, 'email') as canal, recipient_profile_id
    from notification_outbox
    where template = 'class-cancelled' and payload->>'instance_id' = ${instance}::text`
  return {
    email: linhas.filter((l) => l.canal === 'email').length,
    whatsapp: linhas.filter((l) => l.canal === 'whatsapp').length,
    orfas: linhas.filter((l) => l.recipient_profile_id === null).length,
  }
}

/** Fixture não pode disputar a fila com os testes de despacho — e só fecha
 * os avisos do PRÓPRIO aluno (arquivos paralelos não perdem os deles). */
async function fecharAvisos(studentId: string) {
  await sql`
    update notification_outbox
       set sent_at = now(), error = 'fixture A6/lote 2'
     where sent_at is null and template = 'class-cancelled'
       and payload->>'student_id' = ${studentId}::text`
}

/* ========================================================================== */
/* 1. OS DEFAULTS — o comportamento de sempre continua sendo o de sempre       */
/* ========================================================================== */

describe('A6/lote 2 · quem não escolhe nada avisa pelos DOIS canais', () => {
  it('`cancel_class` sem os parâmetros novos enfileira e-mail E WhatsApp', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
    })
    expect(error).toBeNull()
    expect(await avisosDe(inst)).toMatchObject({ email: 1, whatsapp: 1, orfas: 0 })
    await fecharAvisos(c.studentId)
  })

  it('`cancel_my_class` (o ALUNO) não escolhe canal — e continua avisando pelos dois', async () => {
    // O aluno não tem por que decidir não se avisar: a porta dele não ganhou
    // parâmetro nenhum, e é o default do miolo que responde.
    const c = await contratoComLogin()
    const aluno = await clientAs(c.userId, 'student')
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { error } = await aluno.rpc('cancel_my_class', { p_instance: inst })
    expect(error).toBeNull()
    expect(await avisosDe(inst)).toMatchObject({ email: 1, whatsapp: 1 })
    await fecharAvisos(c.studentId)
  })

  it('a escolha fica no AUDIT (Lei 8): quem cancelou sem avisar tem de aparecer', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
      p_notify_email: false,
      p_notify_whatsapp: false,
    })
    const [audit] = await sql`
      select diff from audit_log where action = 'cancel_class' and entity_id = ${inst}::text`
    expect(audit.diff.notify_email).toBe(false)
    expect(audit.diff.notify_whatsapp).toBe(false)
    await fecharAvisos(c.studentId)
  })
})

/* ========================================================================== */
/* 2. DESLIGAR UM FLAG SUPRIME AQUELE CANAL — E SÓ AQUELE                      */
/* ========================================================================== */

describe('A6/lote 2 · cada flag governa o seu canal', () => {
  it('e-mail desligado: nasce só a linha de WhatsApp', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
      p_notify_email: false,
    })
    expect(error).toBeNull()
    expect(await avisosDe(inst)).toMatchObject({ email: 0, whatsapp: 1 })
    await fecharAvisos(c.studentId)
  })

  it('WhatsApp desligado: nasce só a linha de e-mail', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
      p_notify_whatsapp: false,
    })
    expect(error).toBeNull()
    expect(await avisosDe(inst)).toMatchObject({ email: 1, whatsapp: 0 })
    await fecharAvisos(c.studentId)
  })

  it('os dois desligados: NENHUMA linha — e a aula cancela do mesmo jeito', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
      p_notify_email: false,
      p_notify_whatsapp: false,
    })
    expect(error).toBeNull()
    expect(await avisosDe(inst)).toMatchObject({ email: 0, whatsapp: 0 })
    // o ATO aconteceu: silêncio é sobre o aviso, nunca sobre o cancelamento
    const [st] = await sql`select state from class_instances where id = ${inst}`
    expect(st.state).toBe('cancelled')
    // …e o crédito da culpa da escola entrou (ADR-018 não depende de aviso)
    const [bal] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(bal.b)).toBe(1)
  })

  it('o flag do WhatsApp NÃO fura a condição do número', async () => {
    // Marcar a caixa não inventa cadastro: `v_wa` continua sendo
    // `profiles.whatsapp_e164 is not null`, e o flag é um SEGUNDO portão.
    const c = await contratoComLogin({ semWhatsapp: true })
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
      p_notify_whatsapp: true,
    })
    expect(await avisosDe(inst)).toMatchObject({ email: 1, whatsapp: 0 })
    await fecharAvisos(c.studentId)
  })

  it('A LINHA ÓRFÃ CONTINUA NASCENDO — decisão de desenho, não descuido', async () => {
    // Aluno SEM login: o e-mail é enfileirado com `recipient_profile_id` NULL,
    // e o silêncio acontece no DESPACHO (comentário de `notification_outbox` é
    // lei). O A6 não escondeu essa linha — o que ele fez foi a TELA passar a
    // mostrar, antes do ato, que ela vai nascer presa.
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    expect(await avisosDe(inst)).toMatchObject({ email: 1, whatsapp: 0, orfas: 1 })
    await fecharAvisos(c.studentId)
  })
})

/* ========================================================================== */
/* 3. O DESFECHO VOLTA PARA QUEM CHAMOU                                        */
/* ========================================================================== */

describe('A6/lote 2 · `_cancel_class_core` devolve o que o audit registra', () => {
  it('culpa da escola: `credited` verdadeiro e `expires_on` igual ao do ledger', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    // chamada direta ao miolo (a porta interna não é exposta ao PostgREST)
    const [r] = await sql`
      select public._cancel_class_core(
        ${inst}::uuid, 'teacher', now(), null::uuid, 'teste') as d`
    expect(r.d.credited).toBe(true)
    expect(r.d.refund_blocked).toBeNull()
    const [cred] = await sql`
      select expires_on::text as exp from makeup_ledger
      where contract_id = ${c.contractId} and delta = 1`
    expect(r.d.expires_on).toBe(cred.exp)
    // …e é O MESMO que foi para a trilha (uma fonte, dois leitores)
    const [audit] = await sql`
      select diff from audit_log where action = 'cancel_class' and entity_id = ${inst}::text`
    expect(audit.diff.credited).toBe(true)
    expect(audit.diff.expires_on).toBe(r.d.expires_on)
    await fecharAvisos(c.studentId)
  })

  it('pedido do ALUNO: `credited` falso e nenhuma validade — em qualquer antecedência', async () => {
    const c = await contratoComLogin()
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const [r] = await sql`
      select public._cancel_class_core(
        ${inst}::uuid, 'student', now(), null::uuid, 'teste') as d`
    expect(r.d.credited).toBe(false)
    expect(r.d.expires_on).toBeNull()
    expect(r.d.refund_blocked).toBeNull()
    await fecharAvisos(c.studentId)
  })
})

/* ========================================================================== */
/* 4. O TRATAMENTO DE PERÍODO CONTA AS DUAS METADES                            */
/* ========================================================================== */

describe('A6/lote 2 · `admin_period_treatment` separa creditadas de bloqueadas', () => {
  it('duas aulas comuns: 2 canceladas, 2 creditadas, 0 bloqueadas — e os uuids no audit', async () => {
    const c = await contratoComLogin()
    const a1 = await createInstance(sql, c, { startsInHours: 5 * 24 })
    const a2 = await createInstance(sql, c, { startsInHours: 5 * 24 + 2 })
    const { data, error } = await admin.rpc('admin_period_treatment', {
      p_teacher: c.teacherId,
      p_from: daysFromToday(4),
      p_to: daysFromToday(6),
      p_mode: 'cancel_credit',
      p_note: 'férias A6L2',
    })
    expect(error).toBeNull()
    expect(data as Record<string, unknown>).toMatchObject({
      cancelled: 2,
      credited: 2,
      refund_blocked: 0,
      invited: 0,
    })
    const [audit] = await sql`
      select diff from audit_log
      where action = 'period_treatment' and entity_id = ${c.teacherId}::text
      order by id desc limit 1`
    // os IDS de cada grupo existem para achar O ALUNO que ficou sem — a
    // contagem serve à frase da tela, os uuids servem ao conserto
    expect(audit.diff.credited_instances).toEqual(expect.arrayContaining([a1, a2]))
    expect(audit.diff.refund_blocked_instances).toEqual([])
    await fecharAvisos(c.studentId)
  })

  it('nada no período: as quatro contagens são ZERO, e o bloqueio acontece do mesmo jeito', async () => {
    const c = await contratoComLogin()
    const { data, error } = await admin.rpc('admin_period_treatment', {
      p_teacher: c.teacherId,
      p_from: daysFromToday(200),
      p_to: daysFromToday(201),
      p_mode: 'cancel_credit',
    })
    expect(error).toBeNull()
    expect(data as Record<string, unknown>).toMatchObject({
      cancelled: 0,
      credited: 0,
      refund_blocked: 0,
      invited: 0,
    })
    expect((data as { block: string }).block).toBeTruthy()
  })
})

/* ========================================================================== */
/* 5. PROVAS ESTRUTURAIS — o que se lê nas migrations, sem banco               */
/* ========================================================================== */

describe('A6/lote 2 · a estrutura das três funções trocadas', () => {
  it('cada uma tem UMA assinatura viva, e ela vem da migration que a trocou por último', () => {
    // M2 da onda Agenda e Mensagens (01/09/2026): `_cancel_class_core` foi
    // recriada (mesma assinatura, aviso à professora) — a origem dela avançou;
    // as outras duas continuam vindo da migration 99.
    const ORIGEM: Record<string, string> = {
      _cancel_class_core: '20260901000100_m2_professora_cancela_e_remarca.sql',
      _enqueue_class_cancelled: '20260730000200_a6_aviso_com_escolha.sql',
      cancel_class: '20260730000200_a6_aviso_com_escolha.sql',
    }
    for (const nome of Object.keys(ORIGEM)) {
      // `definicaoDaFuncao` ESTOURA com duas assinaturas vivas — é a guarda
      // contra o `create or replace` que criaria overload em vez de trocar a
      // assinatura (overload nesta família é sorteio).
      const d = definicaoDaFuncao(nome)
      expect(d.origem, nome).toBe(ORIGEM[nome])
    }
  })

  it('o miolo devolve JSONB com os três campos do desfecho', () => {
    const core = definicaoDaFuncao('_cancel_class_core').corpo
    expect(core).toContain('returns jsonb')
    expect(core).toContain("'credited', v_credited")
    expect(core).toContain("'refund_blocked', v_blocked")
    expect(core).toContain("'expires_on', v_expires")
  })

  it('os revokes foram REEMITIDOS na assinatura nova (Lei 4)', () => {
    // Sem isto, a porta interna renasceria executável por `authenticated` — a
    // ACL não viaja com o nome, ela viaja com a assinatura.
    const sqlDa99 = corpoDaMigration99()
    expect(sqlDa99).toContain(
      'revoke execute on function public._cancel_class_core(uuid, text, timestamptz, uuid, text, boolean, boolean)',
    )
    expect(sqlDa99).toContain(
      'revoke execute on function public._enqueue_class_cancelled(uuid, boolean, date, boolean, boolean)',
    )
  })

  it('o tratamento de período LÊ o retorno em vez de descartá-lo', () => {
    const p = definicaoDaFuncao('admin_period_treatment').corpo
    expect(p).toContain('v_desfecho := public._cancel_class_core(')
    expect(p).not.toContain('perform public._cancel_class_core(')
    expect(p).toContain("'credited', coalesce(array_length(v_credited, 1), 0)")
    expect(p).toContain("'refund_blocked', coalesce(array_length(v_blocked, 1), 0)")
  })

  it('A PROJEÇÃO NOVA DA AGENDA É ACEITA PELO POSTGREST — o embed não é ambíguo', async () => {
    // O caso que derrubaria a Agenda INTEIRA, não só a caixa de aviso:
    // `students` tem DUAS chaves estrangeiras para `profiles` (`profile_id` e
    // `auth_cleanup_profile_id`, da anonimização retomável). Sem o apelido da
    // constraint, o PostgREST recusa o embed por ambiguidade — e o erro só
    // apareceria ao ABRIR a tela. Aqui a projeção sai da FONTE, não de uma
    // cópia: cópia envelhece e o teste passaria medindo outra consulta.
    const fonte = readFileSync(join(process.cwd(), 'src/data/admin/agenda.ts'), 'utf8')
    const projecao = /'(id, starts_at_utc, ends_at_utc, state, teacher_id, confirmed_at,[^']*)'/.exec(
      fonte,
    )
    expect(projecao, 'a projeção das aulas mudou de forma — remedir este caso').not.toBeNull()
    expect(projecao![1]).toContain('profiles!students_profile_id_fkey(whatsapp_e164)')
    const { error } = await admin.from('class_instances').select(projecao![1]).limit(1)
    expect(error?.message ?? null).toBeNull()
  })

  it('a confirmação da tela NÃO tem texto próprio — ela repete a matriz', () => {
    // A lição do A5 virada régua estrutural: superfície nova que fala de
    // dinheiro com palavras próprias é a quarta versão da mesma frase, e é
    // sempre uma delas que fica para trás. O componente só monta constantes.
    const fonte = readFileSync(
      join(process.cwd(), 'src/components/admin/agenda/ConfirmarDesfecho.tsx'),
      'utf8',
    )
    for (const constante of ['CONSEQUENCIA[desfecho]', 'REGISTRO_NAO_SE_DESFAZ', 'CONFIRMAR[desfecho]'])
      expect(fonte, constante).toContain(constante)
  })
})

/** A migration 99 CRUA — os revokes não estão no corpo de nenhuma função. */
function corpoDaMigration99(): string {
  return readFileSync(
    join(process.cwd(), 'supabase/migrations/20260730000200_a6_aviso_com_escolha.sql'),
    'utf8',
  )
}
