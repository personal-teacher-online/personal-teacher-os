// Briefing v2 · sub-lote 5 — LEMBRETE DO RE-BRIEFING SEMESTRAL
// (migration 20260728000400_briefing_update_reminder).
//
// Molde: o describe M0c de tests/briefing.test.ts (o lembrete do briefing). O
// que muda, e é o que este arquivo trava, é a RÉGUA: o lembrete do briefing
// recusa quem já ENVIOU o briefing; este NÃO — quem tem re-briefing a fazer é
// justamente quem já enviou o base.
//
// Desde a rodada de integração a régua deste lembrete NÃO é dele: ele pergunta
// a `briefing_update_pendente` (a mesma função do card do Início, da rota de
// atualização e do botão da ficha) e obedece. Sem pendência há UMA recusa, que
// enumera os porquês — e é isso que os casos abaixo travam: sem plano vigente,
// no semestre 1, com a atualização já enviada e com contrato de casal/grupo, o
// resultado é o mesmo "não tem atualização pendente" e ZERO linhas no outbox.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

/* -------------------------------------------------------------------------- */
/* Bancada (a mesma de tests/briefing-updates.test.ts, reduzida ao que o        */
/* lembrete enxerga: briefing base ENVIADO + plano vigente)                     */
/* -------------------------------------------------------------------------- */

const BRIEFING_BASE = {
  historia: {
    cidade_vida: 'Cuiabá',
    facil: 'entender o que ouço em série',
    dificil: 'falar sem travar no meio da frase',
    contato: ['Aulas particulares'],
  },
  objetivos: {
    finalidades: ['Viagens'],
    finalidade_principal: 'Viagens',
    alvo_6_meses: 'me virar sozinho num aeroporto',
    onde_trava: ['Falar'],
    correcao_preferida: 'Na hora, sempre',
    tempo_diario: '20 min/dia',
  },
  interesses: {
    hobbies: ['Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Praticar esportes/exercícios'],
    leitura: 'não',
    filmes_series: 'não',
    musicas: 'não',
  },
  rotina: { blocos: { seg: ['Noite'] }, imersao: 'Ouvir músicas em inglês (legenda em inglês)' },
}

const KOLB = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

const UPDATE = {
  objetivos: {
    finalidades: ['Imigração'],
    finalidade_principal: 'Imigração',
    alvo_6_meses: 'passar na entrevista do consulado sem tradutor',
    onde_trava: ['Entender de ouvido'],
    correcao_preferida: 'No fim da fala',
    tempo_diario: '30+ min/dia',
  },
  interesses: {
    hobbies: ['Ler', 'Cozinhar', 'Fotografar', 'Viajar', 'Desenhar', 'Cantar'],
    leitura: 'não',
    filmes_series: 'não',
    musicas: 'não',
  },
}

interface Cenario {
  contractId: string
  studentId: string
  teacherId: string
  userId: string
  client: SupabaseClient
  admin: SupabaseClient
  semestre: number
}

/**
 * Aluno com briefing v2 enviado e plano de estudos VIGENTE. `mesesDeEstrada`
 * decide o semestre: 8 meses → semestre 2 (o cenário do re-briefing), 0 →
 * semestre 1 (o cenário em que o lembrete recusa). O plano sai da RPC de
 * produção, que é quem decide o semestre pelo relógio do contrato.
 */
async function alunoComPlano(mesesDeEstrada: number): Promise<Cenario> {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno Lembrete Update')
  await sql`update students set profile_id = ${userId}, level = 'A1' where id = ${c.studentId}`
  // A6/i: o vínculo exige número no perfil (gatilho `students_lead_sem_login`);
  // esta fixture representa o aluno SEM número — estado ACEITO (legado ou limpeza
  // pelo admin) —, então o número nasce, vincula, e é limpo em seguida.
  await sql`update profiles set whatsapp_e164 = null where id = ${userId}`
  if (mesesDeEstrada > 0) {
    await sql`
      update contracts
         set started_on = (public.business_today() - make_interval(months => ${mesesDeEstrada}))::date
       where id = ${c.contractId}`
  }
  await sql`delete from briefings where student_id = ${c.studentId}`
  await sql`
    insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                           status, submitted_at, schema_version)
    values (${c.studentId}, ${sql.json(BRIEFING_BASE)}, ${sql.json(KOLB)},
            ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
            'submitted', now(), 2)`

  const adminId = await createAuthUser(sql, 'admin', 'Admin Lembrete Update')
  const admin = await clientAs(adminId, 'admin')
  const { error } = await admin.rpc('generate_study_plan', { p_contract: c.contractId })
  expect(error).toBeNull()
  const [p] = await sql`
    select semester_no from study_plans where contract_id = ${c.contractId}
     order by semester_no desc limit 1`

  return {
    ...c,
    userId,
    client: await clientAs(userId, 'student'),
    admin,
    semestre: p.semester_no as number,
  }
}

async function linhasDoLembrete(profileId: string) {
  return sql`
    select channel, payload, dedupe_key from notification_outbox
     where template = 'briefing-update-reminder' and recipient_profile_id = ${profileId}
     order by channel`
}

/* -------------------------------------------------------------------------- */
describe('enqueue_briefing_update_reminder', () => {
  it('enfileira 1×/dia, com a linha de WhatsApp quando há número, e audita', async () => {
    const cenario = await alunoComPlano(8)
    expect(cenario.semestre).toBe(2)
    await sql`update profiles set whatsapp_e164 = '+5565999990001' where id = ${cenario.userId}`

    const { data: n1, error } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(error).toBeNull()
    expect(n1).toBe(2)

    const linhas = await linhasDoLembrete(cenario.userId)
    expect(linhas.map((l) => l.channel)).toEqual(['email', 'whatsapp'])
    // o payload leva o RASTRO do ciclo (o texto do aviso não depende dele)
    for (const l of linhas) {
      expect(l.payload.student_id).toBe(cenario.studentId)
      expect(l.payload.contract_id).toBe(cenario.contractId)
      expect(l.payload.semester_no).toBe(2)
    }
    expect(linhas.some((l) => String(l.dedupe_key).includes(':wa:'))).toBe(true)

    // dedupe DIÁRIA: o segundo clique no mesmo dia não enfileira nada
    const { data: n2 } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(n2).toBe(0)
    expect(await linhasDoLembrete(cenario.userId)).toHaveLength(2)

    // Lei 8
    const audit = await sql`
      select diff from audit_log
       where action = 'enqueue_briefing_update_reminder' and entity_id = ${cenario.studentId}::text`
    expect(audit).toHaveLength(2)
    expect(audit.map((a) => a.diff.enfileirados).sort()).toEqual([0, 2])
    expect(audit[0].diff.semester_no).toBe(2)
    expect(audit[0].diff.contract_id).toBe(cenario.contractId)
  })

  it('sem número de WhatsApp sai só a linha de e-mail', async () => {
    const cenario = await alunoComPlano(8)
    const { data: n } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(n).toBe(1)
    expect((await linhasDoLembrete(cenario.userId)).map((l) => l.channel)).toEqual(['email'])
  })

  it('aluno sem login não recebe lembrete nenhum', async () => {
    const semLogin = await createPrivateContract(sql)
    const adminId = await createAuthUser(sql, 'admin', 'Admin Sem Login')
    const admin = await clientAs(adminId, 'admin')
    const { error } = await admin.rpc('enqueue_briefing_update_reminder', {
      p_student: semLogin.studentId,
    })
    expect(error?.message).toContain('não tem login')
  })

  it('recusa no semestre 1 — esse ciclo é o do briefing completo', async () => {
    const cenario = await alunoComPlano(0)
    expect(cenario.semestre).toBe(1)
    const { error } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(error?.message).toContain('não tem atualização de briefing pendente')
    // e a pendência, que é quem decide, concorda: zero linhas
    const pendencia = await cenario.admin.rpc('briefing_update_pendente', {
      p_student: cenario.studentId,
    })
    expect(pendencia.data).toEqual([])
    expect(await linhasDoLembrete(cenario.userId)).toHaveLength(0)
  })

  it('recusa sem plano vigente — não há semestre para atualizar', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno Sem Plano Lembrete')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const adminId = await createAuthUser(sql, 'admin', 'Admin Sem Plano Lembrete')
    const admin = await clientAs(adminId, 'admin')

    const { error } = await admin.rpc('enqueue_briefing_update_reminder', {
      p_student: c.studentId,
    })
    expect(error?.message).toContain('não tem atualização de briefing pendente')
    expect(await linhasDoLembrete(userId)).toHaveLength(0)
  })

  it('recusa quando o aluno só tem contrato de CASAL/GRUPO (escopo desta onda)', async () => {
    // O ramo de grupo que esta RPC declarava (ADR-002) saiu: o re-briefing é de
    // contrato INDIVIDUAL. Antes, este aluno recebia o e-mail e, ao clicar,
    // encontrava um portal que recusa o rascunho ("este contrato não é seu") —
    // a UNIQUE (contract_id, semester_no) nem comporta dois membros do casal.
    const base = await alunoComPlano(8)
    const [g] = await sql`insert into student_groups (label) values ('Casal do lembrete') returning id`
    await sql`
      insert into student_group_members (group_id, student_id)
      values (${g.id}, ${base.studentId})`
    const [grupo] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${base.teacherId}, 'casal', 15000, 2, 24, 90,
              (public.business_today() - interval '8 months')::date)
      returning id`
    // `generate_study_plan` não aceita contrato de grupo; o plano entra à mão
    // para montar o cenário que a régua VELHA deste lembrete dizia atender.
    await sql`
      insert into study_plans (contract_id, semester_no, starts_on, ends_on, level_snapshot, track_id)
      select ${grupo.id}, 2, (public.business_today() - interval '2 months')::date,
             (public.business_today() + interval '4 months')::date, 'A1', t.id
        from curriculum_tracks t limit 1`

    // encerra o contrato INDIVIDUAL: sobra só o de grupo, com plano vigente do
    // semestre 2 — o cenário que a régua velha aceitava
    await sql`update contracts set status = 'ended', ended_on = public.business_today() where id = ${base.contractId}`

    const pendencia = await base.admin.rpc('briefing_update_pendente', {
      p_student: base.studentId,
    })
    expect(pendencia.error).toBeNull()
    expect(pendencia.data).toEqual([])

    const { error } = await base.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: base.studentId,
    })
    expect(error?.message).toContain('não tem atualização de briefing pendente')
    expect(error?.message).toContain('contrato individual ativo')
    expect(await linhasDoLembrete(base.userId)).toHaveLength(0)
  })

  it('recusa quando o briefing BASE ainda não foi enviado, ou é v1', async () => {
    const rascunho = await alunoComPlano(8)
    await sql`update briefings set status = 'draft' where student_id = ${rascunho.studentId}`
    const semBase = await rascunho.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: rascunho.studentId,
    })
    expect(semBase.error?.message).toContain('não tem atualização de briefing pendente')
    expect(await linhasDoLembrete(rascunho.userId)).toHaveLength(0)

    const antigo = await alunoComPlano(8)
    await sql`update briefings set schema_version = 1 where student_id = ${antigo.studentId}`
    const v1 = await antigo.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: antigo.studentId,
    })
    expect(v1.error?.message).toContain('não tem atualização de briefing pendente')
    expect(await linhasDoLembrete(antigo.userId)).toHaveLength(0)
  })

  it('recusa quando a atualização do semestre JÁ foi enviada', async () => {
    const cenario = await alunoComPlano(8)
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: UPDATE,
    })
    // rascunho não basta: o lembrete continua fazendo sentido
    const aindaRascunho = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(aindaRascunho.error).toBeNull()
    expect(aindaRascunho.data).toBe(1)

    const enviado = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(enviado.error).toBeNull()

    // …e agora recusa — inclusive num dia em que a dedupe já não seguraria
    await sql`
      delete from notification_outbox
       where template = 'briefing-update-reminder' and recipient_profile_id = ${cenario.userId}`
    const { error } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(error?.message).toContain('não tem atualização de briefing pendente')
    expect(await linhasDoLembrete(cenario.userId)).toHaveLength(0)
  })

  it('o briefing BASE enviado NÃO recusa (é a diferença para o lembrete irmão)', async () => {
    const cenario = await alunoComPlano(8)
    const [b] = await sql`select status from briefings where student_id = ${cenario.studentId}`
    expect(b.status).toBe('submitted')

    // o irmão recusa exatamente este aluno…
    const irmao = await cenario.admin.rpc('enqueue_briefing_reminder', {
      p_student: cenario.studentId,
    })
    expect(irmao.error?.message).toContain('já foi enviado')
    // …e o do re-briefing enfileira
    const { data: n, error } = await cenario.admin.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(error).toBeNull()
    expect(n).toBe(1)
  })

  it('só a admin invoca: professora e aluno morrem na guarda', async () => {
    const cenario = await alunoComPlano(8)

    const doAluno = await cenario.client.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(doAluno.error?.message).toContain('apenas admin')

    const profUser = await createAuthUser(sql, 'teacher', 'Prof Lembrete Update')
    await sql`update teachers set profile_id = ${profUser} where id = ${cenario.teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const daProf = await prof.rpc('enqueue_briefing_update_reminder', {
      p_student: cenario.studentId,
    })
    expect(daProf.error?.message).toContain('apenas admin')

    expect(await linhasDoLembrete(cenario.userId)).toHaveLength(0)
  })
})
