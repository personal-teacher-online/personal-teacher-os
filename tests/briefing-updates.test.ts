// Briefing v2 · sub-lote 4 — RE-BRIEFING SEMESTRAL
// (migration 20260728000300_briefing_updates).
//
// O que este arquivo trava:
//  · o ciclo: rascunho por etapa → envio, para adulto E criança, com a MESMA
//    régua de obrigatoriedade do envio do briefing (a validação foi fatorada em
//    `_briefing_validate_v2_secoes`, e é ela que os dois caminhos usam);
//  · um plano, uma atualização — UNIQUE (contract_id, semester_no), espelho de
//    study_plans;
//  · a atualização é SÓ de objetivos e interesses (RPC e CHECK);
//  · depois de enviada é imutável — pela RPC e pelo UPDATE/DELETE direto;
//  · posse e RLS: o aluno mexe no contrato dele, vê o que é dele, e não escreve
//    na tabela por fora da RPC;
//  · `briefing_effective`: sem atualização devolve o base; com atualização
//    ENVIADA substitui as duas seções INTEIRAS (a chave que sumiu, some);
//  · o input do prompt do plano de estudos: chaves NOMEADAS pelo dicionário e,
//    com atualização enviada, os valores NOVOS (é o consumidor real do efetivo).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

// A IA do plano de estudos é a única fronteira externa deste arquivo: o espião
// guarda o INPUT montado e devolve uma sugestão válida para cada item, de modo
// que `suggestStudyPlan` percorra o caminho inteiro (banco → efetivo → input).
const espiao = vi.hoisted(() => ({ input: '' }))
vi.mock('@/lib/ai/claude', () => ({
  getActivePrompt: async () => ({
    name: 'study-plan-suggest',
    version: 1,
    content: 'prompt de teste',
    model: 'claude-sonnet-5',
    params: {},
  }),
  runStructured: async ({ input }: { input: string }) => {
    espiao.input = input
    const itens = (JSON.parse(input).itens ?? []) as { id: string }[]
    return { items: itens.map((i) => ({ id: i.id, theme: 'tema', approach: 'abordagem' })) }
  },
}))

import { suggestStudyPlan } from '@/lib/ai/study-plan'
import { atualizacaoDeBriefingPendente } from '@/lib/portal/data'

let sql: Sql

beforeAll(() => {
  sql = connect(7)
})
afterAll(async () => {
  await sql.end()
})

/* -------------------------------------------------------------------------- */
/* Bancada                                                                     */
/* -------------------------------------------------------------------------- */

const FINALIDADE_PROFISSIONAL = 'Trabalho / carreira'

const V2_HISTORIA = {
  cidade_vida: 'Cuiabá',
  facil: 'entender o que ouço em série',
  dificil: 'falar sem travar no meio da frase',
  contato: ['Aulas particulares', 'Escola / curso em grupo'],
  experiencia_marcante: '',
}

const V2_OBJETIVOS_ADULT = {
  finalidades: [FINALIDADE_PROFISSIONAL, 'Viagens'],
  finalidade_principal: FINALIDADE_PROFISSIONAL,
  topicos_profissionais: ['reuniões', 'e-mails', 'apresentações'],
  alvo_6_meses: 'conduzir uma reunião de 30 minutos em inglês',
  onde_trava: ['Falar'],
  correcao_preferida: 'Na hora, sempre',
  tempo_diario: '20 min/dia',
  viagem: 'Planejo realizar uma viagem internacional em breve',
  intercambio: 'Nenhuma das alternativas',
}

const V2_OBJETIVOS_CHILD = {
  para_que_ingles: ['Escola / provas', 'Jogos e vídeos'],
  temas_escola: 'ciências e artes',
  favoritos_midia: 'Minecraft e desenhos da Disney',
  quem_acompanha: 'a mãe, todo dia depois do jantar',
  temperamento: 'tímido no começo, solta depois de uns minutos',
}

const V2_INTERESSES = {
  hobbies: ['Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Praticar esportes/exercícios'],
  leitura: 'sim',
  leitura_detalhe: 'fantasia e biografias',
  filmes_series: 'não',
  musicas: 'não',
}

const V2_ROTINA = {
  blocos: { seg: ['Noite'], qua: ['Manhã'] },
  imersao: 'Ouvir músicas em inglês (legenda em inglês)',
}

const KOLB = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

function briefingBase(tipo: 'adult' | 'child') {
  return {
    historia: V2_HISTORIA,
    objetivos: tipo === 'child' ? V2_OBJETIVOS_CHILD : V2_OBJETIVOS_ADULT,
    interesses: V2_INTERESSES,
    rotina: V2_ROTINA,
    livre: { obs: 'prefere aula de manhã', apoio: '' },
  }
}

/** As duas seções como o portal as reenvia — objetivos+interesses, completas. */
const UPDATE_ADULT = {
  objetivos: {
    finalidades: ['Viagens', 'Imigração'],
    finalidade_principal: 'Imigração',
    alvo_6_meses: 'passar na entrevista do consulado sem tradutor',
    onde_trava: ['Entender de ouvido'],
    correcao_preferida: 'No fim da fala',
    tempo_diario: '30+ min/dia',
  },
  interesses: {
    hobbies: ['Ler', 'Cozinhar', 'Fotografar', 'Viajar', 'Desenhar', 'Cantar'],
    leitura: 'sim',
    leitura_detalhe: 'jornalismo literário',
    filmes_series: 'sim',
    filmes_series_detalhe: 'documentários',
    musicas: 'não',
  },
}

const UPDATE_CHILD = {
  objetivos: {
    para_que_ingles: ['Futuro (faculdade, carreira)'],
    temas_escola: 'história',
    favoritos_midia: 'Roblox e vídeos de ciência',
    quem_acompanha: 'o pai, nos fins de semana',
    temperamento: 'falante desde o primeiro minuto',
  },
  interesses: UPDATE_ADULT.interesses,
}

interface Cenario {
  contractId: string
  studentId: string
  teacherId: string
  userId: string
  client: SupabaseClient
  admin: SupabaseClient
  adminId: string
  planId: string
  semestre: number
}

/**
 * Aluno com briefing v2 ENVIADO e plano de estudos VIGENTE no semestre 2 — o
 * cenário em que o re-briefing existe. O contrato nasce com 8 meses de estrada
 * (o mesmo truque de tests/study-plan.test.ts) e o plano sai da RPC de produção,
 * `generate_study_plan`, que é quem decide o semestre pelo relógio do contrato.
 */
async function alunoComSemestre2(tipo: 'adult' | 'child' = 'adult'): Promise<Cenario> {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno Re-briefing')
  await sql`
    update students set profile_id = ${userId}, student_type = ${tipo}, level = 'A1'
     where id = ${c.studentId}`
  await sql`
    update contracts set started_on = (public.business_today() - interval '8 months')::date
     where id = ${c.contractId}`
  await sql`delete from briefings where student_id = ${c.studentId}`
  await sql`
    insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                           status, submitted_at, schema_version)
    values (${c.studentId}, ${sql.json(briefingBase(tipo))}, ${sql.json(KOLB)},
            ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
            'submitted', now(), 2)`

  const adminId = await createAuthUser(sql, 'admin', 'Admin Re-briefing')
  const admin = await clientAs(adminId, 'admin')
  const { data: planId, error } = await admin.rpc('generate_study_plan', { p_contract: c.contractId })
  expect(error).toBeNull()
  const [p] = await sql`select semester_no from study_plans where id = ${planId}`
  expect(p.semester_no).toBe(2)

  return {
    ...c,
    userId,
    client: await clientAs(userId, 'student'),
    admin,
    adminId,
    planId: planId as string,
    semestre: p.semester_no as number,
  }
}

/** Rascunho das duas etapas + envio, como a tela faz. */
async function enviaAtualizacao(
  cenario: Cenario,
  respostas: { objetivos: Record<string, unknown>; interesses: Record<string, unknown> } = UPDATE_ADULT,
) {
  const etapa1 = await cenario.client.rpc('save_briefing_update_draft', {
    p_contract: cenario.contractId,
    p_answers: { objetivos: respostas.objetivos },
  })
  expect(etapa1.error).toBeNull()
  const etapa2 = await cenario.client.rpc('save_briefing_update_draft', {
    p_contract: cenario.contractId,
    p_answers: { interesses: respostas.interesses },
  })
  expect(etapa2.error).toBeNull()
  const enviado = await cenario.client.rpc('submit_briefing_update', {
    p_contract: cenario.contractId,
  })
  expect(enviado.error).toBeNull()
}

/* -------------------------------------------------------------------------- */
describe('ciclo do re-briefing (rascunho → envio)', () => {
  it('adulto: as duas etapas viram uma linha enviada do semestre vigente, auditada', async () => {
    const cenario = await alunoComSemestre2()
    await enviaAtualizacao(cenario)

    const [u] = await sql`
      select id, student_id, semester_no, status, submitted_at, schema_version, answers
        from briefing_updates where contract_id = ${cenario.contractId}`
    expect(u.student_id).toBe(cenario.studentId)
    expect(u.semester_no).toBe(2)
    expect(u.status).toBe('submitted')
    expect(u.submitted_at).not.toBeNull()
    expect(u.schema_version).toBe(2)
    expect(u.answers.objetivos.finalidade_principal).toBe('Imigração')
    expect(u.answers.interesses.filmes_series_detalhe).toBe('documentários')
    // o briefing BASE não foi tocado
    const [b] = await sql`select answers from briefings where student_id = ${cenario.studentId}`
    expect(b.answers.objetivos.finalidade_principal).toBe(FINALIDADE_PROFISSIONAL)

    // Lei 8: a linha do audit aponta para ESTA atualização, com contrato e semestre
    const audit = await sql`
      select actor, diff from audit_log
       where action = 'submit_briefing_update' and entity_id = ${u.id}::text`
    expect(audit).toHaveLength(1)
    expect(audit[0].actor).toBe(cenario.userId)
    expect(audit[0].diff.contract_id).toBe(cenario.contractId)
    expect(audit[0].diff.semester_no).toBe(2)
    expect(audit[0].diff.student_id).toBe(cenario.studentId)
  })

  it('criança: a régua do ramo vale igual — sem temperamento o envio recusa', async () => {
    const cenario = await alunoComSemestre2('child')
    const semTemperamento = { ...UPDATE_CHILD.objetivos } as Record<string, unknown>
    delete semTemperamento.temperamento
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { objetivos: semTemperamento, interesses: UPDATE_CHILD.interesses },
    })
    const recusa = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(recusa.error?.message).toContain('pessoas novas')
    const [rascunho] = await sql`
      select status from briefing_updates where contract_id = ${cenario.contractId}`
    expect(rascunho.status).toBe('draft')

    // completa, passa (e as perguntas de adulto não são cobradas dela)
    await enviaAtualizacao(cenario, UPDATE_CHILD)
    const [u] = await sql`
      select status, answers from briefing_updates where contract_id = ${cenario.contractId}`
    expect(u.status).toBe('submitted')
    expect(u.answers.objetivos.para_que_ingles).toEqual(['Futuro (faculdade, carreira)'])
  })

  it('a régua do banco é a MESMA do briefing: hobbies de menos e sim-sem-detalhe recusam', async () => {
    const cenario = await alunoComSemestre2()
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: {
        objetivos: UPDATE_ADULT.objetivos,
        interesses: { ...UPDATE_ADULT.interesses, hobbies: UPDATE_ADULT.interesses.hobbies.slice(0, 5) },
      },
    })
    const r1 = await cenario.client.rpc('submit_briefing_update', { p_contract: cenario.contractId })
    expect(r1.error?.message).toContain('ao menos 6 hobbies')

    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { interesses: { ...UPDATE_ADULT.interesses, musicas: 'sim' } },
    })
    const r2 = await cenario.client.rpc('submit_briefing_update', { p_contract: cenario.contractId })
    expect(r2.error?.message).toContain('musicas')

    // e a finalidade principal continua tendo de estar entre as marcadas
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: {
        objetivos: { ...UPDATE_ADULT.objetivos, finalidade_principal: 'Viagens em Marte' },
        interesses: UPDATE_ADULT.interesses,
      },
    })
    const r3 = await cenario.client.rpc('submit_briefing_update', { p_contract: cenario.contractId })
    expect(r3.error?.message).toContain('precisa estar entre as finalidades marcadas')
  })

  it('a recusa nomeia a etapa do BRIEFING COMPLETO — é o que a tela traduz', async () => {
    // Sub-lote 5: `/portal/briefing/atualizar` tem DUAS telas (1 objetivos, 2
    // interesses) e reescreve estes números antes do toast
    // (`naNumeracaoDaAtualizacao`, em src/app/portal/actions.ts). Se a frase do
    // banco mudar de forma, a tradução vira silêncio — este teste é o pino.
    const cenario = await alunoComSemestre2()
    const semAlvo = { ...UPDATE_ADULT.objetivos } as Record<string, unknown>
    delete semAlvo.alvo_6_meses
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { objetivos: semAlvo, interesses: UPDATE_ADULT.interesses },
    })
    const objetivos = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(objetivos.error?.message).toContain('etapa 2 (objetivos)')

    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: {
        objetivos: UPDATE_ADULT.objetivos,
        interesses: { ...UPDATE_ADULT.interesses, hobbies: UPDATE_ADULT.interesses.hobbies.slice(0, 3) },
      },
    })
    const interesses = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(interesses.error?.message).toContain('etapa 3 (interesses)')
  })

  it('um plano, uma atualização: UNIQUE (contract_id, semester_no)', async () => {
    const cenario = await alunoComSemestre2()
    await enviaAtualizacao(cenario)
    await expect(
      sql`
        insert into briefing_updates (student_id, contract_id, semester_no, answers)
        values (${cenario.studentId}, ${cenario.contractId}, 2, ${sql.json({ objetivos: {} })})`,
    ).rejects.toThrow(/briefing_updates_contract_id_semester_no_key|duplicate key/)
  })

  it('só objetivos e interesses entram — na RPC e no CHECK', async () => {
    const cenario = await alunoComSemestre2()
    const r = await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { historia: { cidade_vida: 'Lisboa' } },
    })
    expect(r.error?.message).toContain('objetivos e interesses')

    const kolb = await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { kolb_answers: { q1: 'B' } },
    })
    expect(kolb.error?.message).toContain('objetivos e interesses')

    // nem por dentro (dona da tabela): o CHECK é do banco
    await expect(
      sql`
        insert into briefing_updates (student_id, contract_id, semester_no, answers)
        values (${cenario.studentId}, ${cenario.contractId}, 5,
                ${sql.json({ rotina: { imersao: 'x' } })})`,
    ).rejects.toThrow(/briefing_updates_secoes_check/)

    expect((await sql`select 1 from briefing_updates where contract_id = ${cenario.contractId}`).length).toBe(0)
  })

  it('sem plano vigente não há ciclo, e contrato de outro aluno nem começa', async () => {
    // contrato novinho, sem plano gerado
    const semPlano = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno Sem Plano')
    await sql`update students set profile_id = ${userId} where id = ${semPlano.studentId}`
    const cliente = await clientAs(userId, 'student')
    const r1 = await cliente.rpc('save_briefing_update_draft', {
      p_contract: semPlano.contractId,
      p_answers: { objetivos: UPDATE_ADULT.objetivos },
    })
    expect(r1.error?.message).toContain('plano de estudos vigente')

    // contrato de OUTRO aluno
    const alheio = await alunoComSemestre2()
    const r2 = await cliente.rpc('save_briefing_update_draft', {
      p_contract: alheio.contractId,
      p_answers: { objetivos: UPDATE_ADULT.objetivos },
    })
    expect(r2.error?.message).toContain('não é seu')
    const r3 = await cliente.rpc('submit_briefing_update', { p_contract: alheio.contractId })
    expect(r3.error?.message).toContain('não é seu')
    expect((await sql`select 1 from briefing_updates where contract_id = ${alheio.contractId}`).length).toBe(0)
  })

  it('a admin envia EM NOME do aluno', async () => {
    const cenario = await alunoComSemestre2()
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: UPDATE_ADULT,
    })
    const { error } = await cenario.admin.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(error).toBeNull()
    const [u] = await sql`select status from briefing_updates where contract_id = ${cenario.contractId}`
    expect(u.status).toBe('submitted')
  })
})

/* -------------------------------------------------------------------------- */
describe('imutabilidade pós-envio', () => {
  it('enviada não volta a rascunho: RPC recusa, UPDATE e DELETE morrem no gatilho', async () => {
    const cenario = await alunoComSemestre2()
    await enviaAtualizacao(cenario)
    const [u] = await sql`select id from briefing_updates where contract_id = ${cenario.contractId}`

    const rascunho = await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { objetivos: { ...UPDATE_ADULT.objetivos, alvo_6_meses: 'outra coisa' } },
    })
    expect(rascunho.error?.message).toContain('já foi enviada')

    const denovo = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(denovo.error?.message).toContain('já foi enviada')

    await expect(
      sql`update briefing_updates set answers = '{}'::jsonb where id = ${u.id}`,
    ).rejects.toThrow(/não muda/)
    await expect(sql`delete from briefing_updates where id = ${u.id}`).rejects.toThrow(/não muda/)
    await expect(sql`truncate briefing_updates`).rejects.toThrow(/append-only/)

    const [ainda] = await sql`select answers, status from briefing_updates where id = ${u.id}`
    expect(ainda.status).toBe('submitted')
    expect(ainda.answers.objetivos.alvo_6_meses).toBe(UPDATE_ADULT.objetivos.alvo_6_meses)
  })

  it('rascunho, sim, muda: a segunda etapa acrescenta sem apagar a primeira', async () => {
    const cenario = await alunoComSemestre2()
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { objetivos: UPDATE_ADULT.objetivos },
    })
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { interesses: UPDATE_ADULT.interesses },
    })
    const [u] = await sql`select answers from briefing_updates where contract_id = ${cenario.contractId}`
    expect(Object.keys(u.answers).sort()).toEqual(['interesses', 'objetivos'])
    // e a seção reenviada substitui a anterior INTEIRA (merge no topo)
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: { objetivos: { finalidades: ['Viagens'] } },
    })
    const [depois] = await sql`select answers from briefing_updates where contract_id = ${cenario.contractId}`
    expect(depois.answers.objetivos).toEqual({ finalidades: ['Viagens'] })
    expect(depois.answers.interesses.hobbies).toHaveLength(6)
  })
})

/* -------------------------------------------------------------------------- */
describe('RLS de briefing_updates', () => {
  it('aluno vê só a sua, a professora vê a dos alunos dela, e ninguém escreve direto', async () => {
    const a = await alunoComSemestre2()
    await enviaAtualizacao(a)
    const b = await alunoComSemestre2()

    const doA = await a.client.from('briefing_updates').select('id, contract_id')
    expect(doA.data).toHaveLength(1)
    expect(doA.data?.[0].contract_id).toBe(a.contractId)

    const bVendoA = await b.client
      .from('briefing_updates')
      .select('id')
      .eq('contract_id', a.contractId)
    expect(bVendoA.data ?? []).toHaveLength(0)

    // a professora DO contrato lê; outra professora não
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Re-briefing')
    await sql`update teachers set profile_id = ${profUser} where id = ${a.teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const lidaProf = await prof.from('briefing_updates').select('id').eq('contract_id', a.contractId)
    expect(lidaProf.data).toHaveLength(1)

    const outraUser = await createAuthUser(sql, 'teacher', 'Outra Prof Re-briefing')
    const outra = await clientAs(outraUser, 'teacher')
    const lidaOutra = await outra.from('briefing_updates').select('id').eq('contract_id', a.contractId)
    expect(lidaOutra.data ?? []).toHaveLength(0)

    // a admin lê tudo
    const lidaAdmin = await a.admin.from('briefing_updates').select('id').eq('contract_id', a.contractId)
    expect(lidaAdmin.data).toHaveLength(1)

    // escrita direta: negada para todo mundo que passa pelo PostgREST
    for (const [papel, cliente] of [
      ['aluno', a.client],
      ['professora', prof],
      ['admin', a.admin],
    ] as const) {
      const ins = await cliente.from('briefing_updates').insert({
        student_id: b.studentId,
        contract_id: b.contractId,
        semester_no: 2,
        answers: {},
      })
      expect(ins.error?.code, `${papel} não insere direto`).toBe('42501')
    }
    expect((await sql`select 1 from briefing_updates where contract_id = ${b.contractId}`).length).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
describe('briefing_effective — o briefing que vale no ciclo', () => {
  it('sem atualização devolve o base; com atualização ENVIADA troca as duas seções INTEIRAS', async () => {
    const cenario = await alunoComSemestre2()

    const semUpdate = await cenario.client.rpc('briefing_effective', {
      p_student: cenario.studentId,
      p_contract: cenario.contractId,
      p_semester: 2,
    })
    expect(semUpdate.error).toBeNull()
    expect(semUpdate.data).toEqual(briefingBase('adult'))

    // rascunho NÃO conta — o que vale é o enviado
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: UPDATE_ADULT,
    })
    const comRascunho = await cenario.client.rpc('briefing_effective', {
      p_student: cenario.studentId,
      p_contract: cenario.contractId,
      p_semester: 2,
    })
    expect(comRascunho.data).toEqual(briefingBase('adult'))

    const { error } = await cenario.client.rpc('submit_briefing_update', {
      p_contract: cenario.contractId,
    })
    expect(error).toBeNull()

    const efetivo = await cenario.client.rpc('briefing_effective', {
      p_student: cenario.studentId,
      p_contract: cenario.contractId,
      p_semester: 2,
    })
    const dado = efetivo.data as Record<string, Record<string, unknown>>
    // as duas seções são as NOVAS, por inteiro
    expect(dado.objetivos).toEqual(UPDATE_ADULT.objetivos)
    expect(dado.interesses).toEqual(UPDATE_ADULT.interesses)
    // chave que existia no base e não veio na atualização SOME (substituição por
    // seção inteira, não remendo chave a chave)
    expect(dado.objetivos.viagem).toBeUndefined()
    expect(dado.objetivos.topicos_profissionais).toBeUndefined()
    // e o que a atualização não toca continua o do base
    expect(dado.historia).toEqual(V2_HISTORIA)
    expect(dado.rotina).toEqual(V2_ROTINA)
    expect(dado.livre).toEqual({ obs: 'prefere aula de manhã', apoio: '' })

    // outro semestre (inclusive o 1) devolve o base
    for (const semestre of [1, 3]) {
      const outro = await cenario.client.rpc('briefing_effective', {
        p_student: cenario.studentId,
        p_contract: cenario.contractId,
        p_semester: semestre,
      })
      expect(outro.data, `semestre ${semestre}`).toEqual(briefingBase('adult'))
    }
  })

  it('a RLS vale: outro aluno chamando o efetivo alheio recebe vazio', async () => {
    const a = await alunoComSemestre2()
    await enviaAtualizacao(a)
    const b = await alunoComSemestre2()

    const espiada = await b.client.rpc('briefing_effective', {
      p_student: a.studentId,
      p_contract: a.contractId,
      p_semester: 2,
    })
    expect(espiada.error).toBeNull()
    expect(espiada.data).toBeNull()

    // a professora do contrato, essa lê
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Efetivo')
    await sql`update teachers set profile_id = ${profUser} where id = ${a.teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const dela = await prof.rpc('briefing_effective', {
      p_student: a.studentId,
      p_contract: a.contractId,
      p_semester: 2,
    })
    expect((dela.data as Record<string, unknown>).objetivos).toEqual(UPDATE_ADULT.objetivos)
  })
})

/* -------------------------------------------------------------------------- */
describe('o convite do Início (a query real do card)', () => {
  it('aparece no semestre ≥ 2 sem atualização enviada e some quando o aluno envia', async () => {
    const cenario = await alunoComSemestre2()

    const antes = await atualizacaoDeBriefingPendente(cenario.client)
    expect(antes.erro).toBe(false)
    expect(antes.pendente).toEqual({
      studentId: cenario.studentId,
      contractId: cenario.contractId,
      semesterNo: 2,
    })

    // rascunho não faz o card sumir — quem some é o ENVIO
    await cenario.client.rpc('save_briefing_update_draft', {
      p_contract: cenario.contractId,
      p_answers: UPDATE_ADULT,
    })
    expect((await atualizacaoDeBriefingPendente(cenario.client)).pendente).not.toBeNull()

    await cenario.client.rpc('submit_briefing_update', { p_contract: cenario.contractId })
    const depois = await atualizacaoDeBriefingPendente(cenario.client)
    expect(depois.pendente).toBeNull()
    expect(depois.erro).toBe(false)
  })

  it('não aparece no semestre 1, nem para briefing v1, nem para quem não enviou o base', async () => {
    // semestre 1: o ciclo do briefing original
    const novo = await createPrivateContract(sql)
    const userNovo = await createAuthUser(sql, 'student', 'Aluno Semestre 1')
    await sql`update students set profile_id = ${userNovo}, level = 'A1' where id = ${novo.studentId}`
    await sql`delete from briefings where student_id = ${novo.studentId}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, status, submitted_at, schema_version)
      values (${novo.studentId}, ${sql.json(briefingBase('adult'))}, ${sql.json(KOLB)},
              'submitted', now(), 2)`
    const adminId = await createAuthUser(sql, 'admin', 'Admin Semestre 1')
    const admin = await clientAs(adminId, 'admin')
    const { error } = await admin.rpc('generate_study_plan', { p_contract: novo.contractId })
    expect(error).toBeNull()
    const clienteNovo = await clientAs(userNovo, 'student')
    expect((await atualizacaoDeBriefingPendente(clienteNovo)).pendente).toBeNull()

    // briefing colhido no v1: o formulário da atualização é o v2 (ver o comentário
    // da função) — o convite não aparece
    const v1 = await alunoComSemestre2()
    await sql`update briefings set schema_version = 1 where student_id = ${v1.studentId}`
    expect((await atualizacaoDeBriefingPendente(v1.client)).pendente).toBeNull()

    // base ainda em rascunho: primeiro o briefing, depois a atualização dele
    const semBase = await alunoComSemestre2()
    await sql`update briefings set status = 'draft' where student_id = ${semBase.studentId}`
    expect((await atualizacaoDeBriefingPendente(semBase.client)).pendente).toBeNull()

    // contrato PAUSADO: a RPC recusaria o rascunho ("não está ativo"), então o
    // convite não aparece — card nenhum leva a beco
    const pausado = await alunoComSemestre2()
    expect((await atualizacaoDeBriefingPendente(pausado.client)).pendente).not.toBeNull()
    await sql`update contracts set status = 'paused' where id = ${pausado.contractId}`
    expect((await atualizacaoDeBriefingPendente(pausado.client)).pendente).toBeNull()
    const recusa = await pausado.client.rpc('save_briefing_update_draft', {
      p_contract: pausado.contractId,
      p_answers: { objetivos: UPDATE_ADULT.objetivos },
    })
    expect(recusa.error?.message).toContain('não está ativo')

    // contrato que PAUSA ENTRE o rascunho e o envio: o envio recusa igual —
    // sem a guarda do submit, o rascunho feito na ativa submeteria mesmo assim
    const pausaTardia = await alunoComSemestre2()
    const rascunhoOk = await pausaTardia.client.rpc('save_briefing_update_draft', {
      p_contract: pausaTardia.contractId,
      p_answers: UPDATE_ADULT,
    })
    expect(rascunhoOk.error).toBeNull()
    await sql`update contracts set status = 'paused' where id = ${pausaTardia.contractId}`
    const envioRecusado = await pausaTardia.client.rpc('submit_briefing_update', {
      p_contract: pausaTardia.contractId,
    })
    expect(envioRecusado.error?.message).toContain('não está ativo')
  })
})

/* -------------------------------------------------------------------------- */
describe('input do prompt do plano de estudos', () => {
  it('chaves NOMEADAS por seção; com atualização enviada, os valores são os novos', async () => {
    const cenario = await alunoComSemestre2()
    const admin = serviceClient()

    const n = await suggestStudyPlan(admin, cenario.planId)
    expect(n).toBeGreaterThan(0)
    const antes = JSON.parse(espiao.input) as {
      aluno: { nome: string; nivel: string; briefing: Record<string, Record<string, unknown>> }
      itens: { id: string }[]
    }
    // o briefing vai NOMEADO por seção — nada de espalhar o jsonb cru
    expect(Object.keys(antes.aluno.briefing).sort()).toEqual([
      'estilo_kolb',
      'historia',
      'interesses',
      'livre',
      'objetivos',
      'pontuacoes_kolb',
      'rotina',
    ])
    expect(Object.keys(antes.aluno.briefing.objetivos).sort()).toEqual([
      'alvo_6_meses',
      'correcao_preferida',
      'finalidade_principal',
      'finalidades',
      'intercambio',
      'onde_trava',
      'tempo_diario',
      'topicos_profissionais',
      'viagem',
    ])
    expect(antes.aluno.briefing.objetivos.finalidade_principal).toBe(FINALIDADE_PROFISSIONAL)
    expect(antes.aluno.briefing.estilo_kolb).toBe('convergente')
    // `experiencia_marcante: ''` não é resposta: campo em branco não vai ao prompt
    expect(Object.keys(antes.aluno.briefing.historia)).not.toContain('experiencia_marcante')
    expect(antes.itens.length).toBeGreaterThan(0)

    // agora o aluno atualiza o briefing do semestre — o input muda
    await enviaAtualizacao(cenario)
    await suggestStudyPlan(admin, cenario.planId)
    const depois = JSON.parse(espiao.input) as {
      aluno: { briefing: Record<string, Record<string, unknown>> }
    }
    expect(depois.aluno.briefing.objetivos.finalidade_principal).toBe('Imigração')
    expect(depois.aluno.briefing.objetivos.alvo_6_meses).toBe(UPDATE_ADULT.objetivos.alvo_6_meses)
    expect(depois.aluno.briefing.objetivos.viagem).toBeUndefined()
    expect(depois.aluno.briefing.interesses.filmes_series_detalhe).toBe('documentários')
    // história e rotina continuam as do briefing base
    expect(depois.aluno.briefing.historia.cidade_vida).toBe('Cuiabá')
    expect(depois.aluno.briefing.rotina.imersao).toBe(V2_ROTINA.imersao)
  })
})
