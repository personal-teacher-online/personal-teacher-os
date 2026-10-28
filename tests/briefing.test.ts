// M0a do cronograma — BRIEFING integrado (migration 20260720000100): rascunho
// por etapas, envio com Kolb calculado NO BANCO (gabarito do Doc, 12 questões),
// trava pós-envio, retaguarda do admin e leitura por papel (RLS).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(async () => {
  sql = connect(7)
})
afterAll(async () => {
  await sql.end()
})

const ETAPAS = {
  historia: { cidade_vida: 'Cuiabá', facil_dificil: 'listening fácil; speaking difícil', contato: 'escola + jogos' },
  objetivos: { finalidades: 'viagem', topicos_profissionais: ['eng', 'obras'], viagem: 'planejo', intercambio: 'nenhuma' },
  interesses: { hobbies: ['Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Praticar esportes/exercícios'], leitura: 'blogs', filmes_series: 'séries de comédia', musicas: 'sim, rock' },
  rotina: { blocos: { seg: ['noite'], qua: ['manha'], sab: ['tarde'] }, imersao: 'filmes com legenda' },
}

/** 6 respostas AC + 6 AE (gabarito do Doc) → par AC+AE máximo → convergente. */
const KOLB_CONVERGENTE = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}
/** Todas CE → empate CE+RO × CE+AE → desempate pelos eixos (y≤0, x=0) → divergente. */
const KOLB_TODAS_CE = {
  q1: 'A', q2: 'D', q3: 'D', q4: 'D', q5: 'D', q6: 'D',
  q7: 'D', q8: 'D', q9: 'C', q10: 'A', q11: 'B', q12: 'D',
}

async function novoAlunoComLogin() {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno Briefing')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  // A6/i: o vínculo exige número no perfil (gatilho `students_lead_sem_login`);
  // esta fixture representa o aluno SEM número — estado ACEITO (legado ou limpeza
  // pelo admin) —, então o número nasce, vincula, e é limpo em seguida.
  await sql`update profiles set whatsapp_e164 = null where id = ${userId}`
  // Esta suíte é a REGRESSÃO do questionário v1: as fixtures acima têm a forma
  // antiga (facil_dificil, contato como texto, leitura livre). Desde o flip do
  // default (migration 20260728000200) linha nova nasce 2, então a linha é
  // criada aqui já carimbada 1 — é exatamente o rascunho começado antes do v2,
  // que a spec manda continuar submetendo pela regra antiga. Quem cobre o v2 é
  // tests/briefing-v2.test.ts.
  await sql`insert into briefings (student_id, schema_version) values (${c.studentId}, 1)`
  const client = await clientAs(userId, 'student')
  return { ...c, userId, client }
}

describe('rascunho por etapas + envio com Kolb no banco', () => {
  it('salva parcial, envia, calcula convergente e trava edições', async () => {
    const { client, studentId, userId } = await novoAlunoComLogin()

    // etapas salvas em chamadas separadas (o merge preserva as anteriores)
    await client.rpc('save_briefing_draft', { p_answers: { historia: ETAPAS.historia } })
    await client.rpc('save_briefing_draft', { p_answers: { objetivos: ETAPAS.objetivos, interesses: ETAPAS.interesses } })
    await client.rpc('save_briefing_draft', { p_answers: { rotina: ETAPAS.rotina }, p_kolb_answers: KOLB_CONVERGENTE })

    const { data: estilo, error } = await client.rpc('submit_briefing')
    expect(error).toBeNull()
    expect(estilo).toBe('convergente')

    const [b] = await sql`select status, kolb_style, kolb_scores, submitted_at, answers from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    expect(b.kolb_style).toBe('convergente')
    expect(b.kolb_scores).toEqual({ CE: 0, RO: 0, AC: 6, AE: 6 })
    expect(b.submitted_at).not.toBeNull()
    expect(b.answers.historia.cidade_vida).toBe('Cuiabá')

    // trava: rascunho pós-envio recusa com mensagem clara
    const dep = await client.rpc('save_briefing_draft', { p_answers: { livre: { obs: 'x' } } })
    expect(dep.error?.message).toContain('já enviado')

    // auditoria (Lei 8)
    const audit = await sql`select 1 from audit_log where action = 'submit_briefing' and entity_id = ${studentId}::text`
    expect(audit.length).toBe(1)
    void userId
  })

  it('empate no Kolb resolve pelos eixos (todas CE → divergente)', async () => {
    const { client } = await novoAlunoComLogin()
    await client.rpc('save_briefing_draft', { p_answers: ETAPAS, p_kolb_answers: KOLB_TODAS_CE })
    const { data: estilo } = await client.rpc('submit_briefing')
    expect(estilo).toBe('divergente')
  })

  it('valida: etapa faltando e Kolb incompleto recusam com erro claro', async () => {
    const { client } = await novoAlunoComLogin()
    await client.rpc('save_briefing_draft', {
      p_answers: { historia: ETAPAS.historia, objetivos: ETAPAS.objetivos, interesses: ETAPAS.interesses },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const semRotina = await client.rpc('submit_briefing')
    expect(semRotina.error?.message).toContain('rotina')

    await client.rpc('save_briefing_draft', { p_answers: { rotina: ETAPAS.rotina }, p_kolb_answers: { q12: 'X' } })
    const kolbRuim = await client.rpc('submit_briefing')
    expect(kolbRuim.error?.message).toContain('questão 12')
  })
})

describe('permissões (RLS + revokes)', () => {
  it('escrita direta na tabela é negada; leitura é por papel', async () => {
    const { client, studentId, teacherId } = await novoAlunoComLogin()
    await client.rpc('save_briefing_draft', { p_answers: { historia: ETAPAS.historia } })

    // aluno NÃO escreve direto (só RPC)
    const direto = await client.from('briefings').update({ answers: {} }).eq('student_id', studentId)
    expect(direto.error?.code).toBe('42501')

    // o próprio aluno LÊ
    const own = await client.from('briefings').select('student_id').eq('student_id', studentId)
    expect(own.data).toHaveLength(1)

    // outro aluno NÃO vê (RLS silencia)
    const outro = await novoAlunoComLogin()
    const alheio = await outro.client.from('briefings').select('student_id').eq('student_id', studentId)
    expect(alheio.data).toHaveLength(0)

    // a professora DO aluno vê
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Briefing')
    await sql`update teachers set profile_id = ${profUser} where id = ${teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const daProf = await prof.from('briefings').select('student_id').eq('student_id', studentId)
    expect(daProf.data).toHaveLength(1)

    // admin vê
    const adminUser = await createAuthUser(sql, 'admin', 'Admin Briefing')
    const admin = await clientAs(adminUser, 'admin')
    const doAdmin = await admin.from('briefings').select('student_id').eq('student_id', studentId)
    expect(doAdmin.data).toHaveLength(1)
  })

  it('retaguarda: admin preenche e finaliza em nome do aluno (auditado); professora não', async () => {
    const { studentId } = await novoAlunoComLogin()
    const adminUser = await createAuthUser(sql, 'admin', 'Admin Fill')
    const admin = await clientAs(adminUser, 'admin')

    const { error } = await admin.rpc('admin_fill_briefing', {
      p_student: studentId,
      p_answers: ETAPAS,
      p_kolb_answers: KOLB_CONVERGENTE,
      p_finalize: true,
    })
    expect(error).toBeNull()
    const [b] = await sql`select status, kolb_style, filled_by from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    expect(b.kolb_style).toBe('convergente')
    expect(b.filled_by).toBe(adminUser)
    const audit = await sql`select 1 from audit_log where action = 'admin_fill_briefing' and entity_id = ${studentId}::text`
    expect(audit.length).toBe(1)

    const profUser = await createAuthUser(sql, 'teacher', 'Prof Fill')
    const prof = await clientAs(profUser, 'teacher')
    const negado = await prof.rpc('admin_fill_briefing', { p_student: studentId, p_answers: {} })
    expect(negado.error?.message).toContain('apenas admin')
  })
})

describe('M0c — lembrete de briefing (RPC enqueue_briefing_reminder)', () => {
  it('exige login; enfileira 1×/dia; recusa após envio', async () => {
    const { client, studentId, userId } = await novoAlunoComLogin()
    const adminUser = await createAuthUser(sql, 'admin', 'Admin Lembrete')
    const admin = await clientAs(adminUser, 'admin')

    // aluno SEM login → erro claro
    const semLogin = await createPrivateContract(sql)
    const negado = await admin.rpc('enqueue_briefing_reminder', { p_student: semLogin.studentId })
    expect(negado.error?.message).toContain('não tem login')

    // com login: 1 linha de e-mail (sem número de WhatsApp) + dedupe diária
    const { data: n1, error } = await admin.rpc('enqueue_briefing_reminder', { p_student: studentId })
    expect(error).toBeNull()
    expect(n1).toBe(1)
    const { data: n2 } = await admin.rpc('enqueue_briefing_reminder', { p_student: studentId })
    expect(n2).toBe(0)
    const rows = await sql`
      select channel from notification_outbox
      where template = 'briefing-reminder' and recipient_profile_id = ${userId}`
    expect(rows.map((r) => r.channel)).toEqual(['email'])

    // briefing enviado → lembrete não faz mais sentido
    await client.rpc('save_briefing_draft', { p_answers: ETAPAS, p_kolb_answers: KOLB_CONVERGENTE })
    await client.rpc('submit_briefing')
    const depois = await admin.rpc('enqueue_briefing_reminder', { p_student: studentId })
    expect(depois.error?.message).toContain('já foi enviado')
  })
})
