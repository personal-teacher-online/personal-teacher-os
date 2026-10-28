// CICLO DE VIDA DO ALUNO — fase 1 (spec `docs/goals/ciclo-de-vida-do-aluno.md`).
//
// O que esta suíte prova, na ordem das camadas:
//   1. o vocabulário novo existe no banco e as DUAS portas do lead têm gate,
//      efeito e auditoria (Leis 3 e 8);
//   2. a PROMOÇÃO automática lead → aluno acontece na mesma transação do
//      contrato, por TODOS os caminhos por onde um contrato nasce — e NÃO
//      acontece no contrato da aula experimental;
//   3. lead é invisível a quem não é admin (professora, aluno, anônimo) — sem
//      policy nova, por construção (Lei 4);
//   4. a DERIVAÇÃO é pura e cobre a matriz inteira, incluindo pausado e
//      experimental;
//   5. as contagens das badges batem com o diretório de verdade;
//   6. as telas desenham o que a spec pediu (greps de aceite).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect, createStudent, instanteEm } from './helpers/db'
import {
  DiretorioSchema,
  SITUACOES,
  SITUACAO_FILTRO,
  SITUACAO_ROTULO,
  contarSituacoes,
  ehSituacao,
  montarAluno,
  noDiaADia,
  situacaoDoAluno,
  type AlunoDoDiretorio,
  type Situacao,
} from '@/data/admin/alunos-grupos'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

let sql: Sql
let adminUser: string
let admin: SupabaseClient
let teacherUser: string
let teacherId: string
let studentUser: string

beforeAll(async () => {
  sql = connect(3)
  adminUser = await createAuthUser(sql, 'admin', 'Admin ciclo')
  admin = await clientAs(adminUser, 'admin')
  teacherUser = await createAuthUser(sql, 'teacher', 'Professora ciclo')
  const [t] = await sql`
    insert into teachers (profile_id, hourly_rate_cents) values (${teacherUser}, 5000) returning id`
  teacherId = t.id as string
  studentUser = await createAuthUser(sql, 'student', 'Aluno ciclo')
})

afterAll(async () => {
  await sql.end()
})

/**
 * Contrato de verdade (o mesmo `insert` que o wizard e a tela de contratos
 * fazem por PostgREST — é por aí que nasce a maioria dos contratos).
 *
 * `started_on` no MÊS PASSADO de propósito: os KPIs contam "entradas do mês"
 * globalmente, e a suíte roda arquivos em paralelo — contrato desta fixture
 * nascendo hoje entraria na conta de outro arquivo de teste.
 */
async function criarContrato(studentId: string): Promise<string> {
  const { data, error } = await admin
    .from('contracts')
    .insert({
      contract_type: 'private_1on1',
      student_id: studentId,
      teacher_id: teacherId,
      plan_name: 'ciclo de vida',
      hourly_rate_cents: 15000,
      monthly_reschedule_allowance: 4,
      min_notice_hours: 24,
      makeup_credit_expiry_days: 90,
      started_on: new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  return (data as { id: string }).id
}

/**
 * Lead com CIDADE e fuso — o caminho normal do CityPicker.
 *
 * Desde o P6 da revisão nº 8 o lead que nasce sem cidade fica com o fuso do
 * negócio marcado como PALPITE (`students.tz_confirmed = false`) e o banco
 * RECUSA contrato não-experimental para ele. Quem vai fechar contrato no teste
 * precisa, então, do cadastro completo — que é como a escola faz.
 */
async function criarLead(nome: string): Promise<string> {
  const { data, error } = await admin.rpc('admin_create_lead', {
    p_name: nome,
    p_iana_tz: 'America/Cuiaba',
    p_city: 'Cuiabá',
    p_country: 'BR',
  })
  expect(error).toBeNull()
  return data as string
}

async function statusDe(studentId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status from students where id = ${studentId}`
  return row.status
}

async function auditoria(entityId: string, action: string) {
  return sql<{ diff: Record<string, unknown> }[]>`
    select diff from audit_log
     where entity = 'students' and entity_id = ${entityId} and action = ${action}
     order by at desc`
}

/* ========================================================================== */
/* 1. Vocabulário e as duas portas do lead                                     */
/* ========================================================================== */

describe('o banco conhece o estado LEAD', () => {
  it('o CHECK de students.status aceita lead — e segue recusando invenção', async () => {
    const [c] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'students_status_check'`
    expect(c.def).toContain("'lead'")
    expect(c.def).toContain("'active'")
    expect(c.def).toContain("'archived'")

    const id = await createStudent(sql)
    await expect(
      sql`update students set status = 'prospecto' where id = ${id}`,
    ).rejects.toThrow(/students_status_check/)
  })
})

describe('admin_create_lead', () => {
  it('cria o cadastro mínimo com status lead, sem login, e AUDITA', async () => {
    const { data, error } = await admin.rpc('admin_create_lead', {
      p_name: '  Mariana Prospecto  ',
      p_city: 'Lisboa',
      p_country: 'PT',
      p_iana_tz: 'Europe/Lisbon',
      p_referral_source: 'indicação da dona',
    })
    expect(error).toBeNull()
    const id = data as string

    const [linha] = await sql<
      { display_name: string; status: string; iana_tz: string; city: string; profile_id: string | null; referral_source: string }[]
    >`select display_name, status, iana_tz, city, profile_id, referral_source
        from students where id = ${id}`
    expect(linha.status).toBe('lead')
    expect(linha.display_name).toBe('Mariana Prospecto') // o btrim é do banco
    expect(linha.iana_tz).toBe('Europe/Lisbon')
    expect(linha.city).toBe('Lisboa')
    expect(linha.referral_source).toBe('indicação da dona')
    // Lead NUNCA tem login nesta fase: é o que o torna inalcançável pelo portal.
    expect(linha.profile_id).toBeNull()

    const audit = await auditoria(id, 'admin_create_lead')
    expect(audit.length).toBe(1)
    expect(audit[0].diff).toMatchObject({ status: 'lead', display_name: 'Mariana Prospecto' })
  })

  it('sem cidade, o fuso é o do NEGÓCIO — nunca um offset inventado (Lei 1)', async () => {
    const { data, error } = await admin.rpc('admin_create_lead', { p_name: 'Lead sem cidade' })
    expect(error).toBeNull()
    const [linha] = await sql<{ iana_tz: string; city: string | null }[]>`
      select iana_tz, city from students where id = ${data as string}`
    expect(linha.iana_tz).toBe('America/Cuiaba')
    expect(linha.city).toBeNull()
  })

  it('nome vazio recusa, e fuso inventado recusa (o trigger de IANA é o cinto)', async () => {
    const semNome = await admin.rpc('admin_create_lead', { p_name: '   ' })
    expect(semNome.error?.message).toMatch(/nome do lead é obrigatório/)
    const fusoRuim = await admin.rpc('admin_create_lead', {
      p_name: 'Lead torto',
      p_iana_tz: 'Mars/Olympus',
    })
    expect(fusoRuim.error).not.toBeNull()
  })

  it('é da ADMIN: professora, aluno e anônimo levam não', async () => {
    const prof = await clientAs(teacherUser, 'teacher')
    const aluno = await clientAs(studentUser, 'student')
    expect((await prof.rpc('admin_create_lead', { p_name: 'X' })).error?.message).toMatch(
      /restrita à admin/,
    )
    expect((await aluno.rpc('admin_create_lead', { p_name: 'X' })).error?.message).toMatch(
      /restrita à admin/,
    )
    expect((await anonClient().rpc('admin_create_lead', { p_name: 'X' })).error).not.toBeNull()
  })
})

describe('admin_lose_lead', () => {
  it('arquiva o lead, guarda o motivo na auditoria e não apaga nada', async () => {
    const { data: id } = await admin.rpc('admin_create_lead', { p_name: 'Lead que sumiu' })
    const { error } = await admin.rpc('admin_lose_lead', {
      p_student: id as string,
      p_reason: 'achou caro',
    })
    expect(error).toBeNull()
    expect(await statusDe(id as string)).toBe('archived')

    // o cadastro CONTINUA existindo (arquivar não é apagar)
    const [linha] = await sql<{ display_name: string }[]>`
      select display_name from students where id = ${id as string}`
    expect(linha.display_name).toBe('Lead que sumiu')

    const audit = await auditoria(id as string, 'admin_lose_lead')
    expect(audit.length).toBe(1)
    expect(audit[0].diff).toMatchObject({ old: 'lead', new: 'archived', reason: 'achou caro' })
  })

  it('motivo é opcional — vazio vira null, não string vazia guardada para sempre', async () => {
    const { data: id } = await admin.rpc('admin_create_lead', { p_name: 'Lead calado' })
    await admin.rpc('admin_lose_lead', { p_student: id as string, p_reason: '   ' })
    const audit = await auditoria(id as string, 'admin_lose_lead')
    expect(audit[0].diff.reason).toBeNull()
  })

  it('recusa quem NÃO é lead — arquivar aluno é outro fluxo', async () => {
    const alunoId = await createStudent(sql)
    const { error } = await admin.rpc('admin_lose_lead', { p_student: alunoId })
    expect(error?.message).toMatch(/só um lead pode ser dado como perdido/)
    expect(await statusDe(alunoId)).toBe('active')
  })

  it('é da ADMIN: a professora não dá lead por perdido', async () => {
    const { data: id } = await admin.rpc('admin_create_lead', { p_name: 'Lead da professora' })
    const prof = await clientAs(teacherUser, 'teacher')
    const { error } = await prof.rpc('admin_lose_lead', { p_student: id as string })
    expect(error?.message).toMatch(/restrita à admin/)
    expect(await statusDe(id as string)).toBe('lead')
  })
})

/* ========================================================================== */
/* 2. Promoção automática (todos os caminhos de criação de contrato)           */
/* ========================================================================== */

describe('lead vira aluno quando o contrato nasce', () => {
  it('contrato individual pela tela (PostgREST) promove NA MESMA transação e audita', async () => {
    const id = await criarLead('Lead que fechou')
    const contrato = await criarContrato(id as string)

    expect(await statusDe(id as string)).toBe('active')
    const audit = await auditoria(id as string, 'lead_promoted')
    expect(audit.length).toBe(1)
    expect(audit[0].diff).toMatchObject({ old: 'lead', new: 'active', via: 'contract' })
    expect(audit[0].diff.contract_id).toBe(contrato)
  })

  it('quem JÁ era aluno não é tocado nem auditado à toa', async () => {
    const alunoId = await createStudent(sql)
    await criarContrato(alunoId)
    expect(await statusDe(alunoId)).toBe('active')
    expect((await auditoria(alunoId, 'lead_promoted')).length).toBe(0)
  })

  it('o contrato da AULA EXPERIMENTAL não promove: experimental é etapa do funil', async () => {
    const { data: id } = await admin.rpc('admin_create_lead', { p_name: 'Lead com experimental' })
    await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, is_trial)
      values ('private_1on1', ${id as string}, ${teacherId}, 'Aula experimental', 0,
              0, 24, 90, public.business_today() - 45, true)`
    expect(await statusDe(id as string)).toBe('lead')
    expect((await auditoria(id as string, 'lead_promoted')).length).toBe(0)
  })

  it('a RPC da aula experimental (admin_create_trial_class) não cria lead nem promove ninguém', async () => {
    const { error } = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Pessoa da experimental',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacherId,
      // longe da semana corrente: os KPIs contam "aulas da semana" globalmente,
      // e a suíte roda arquivos em paralelo (a aula desta fixture entraria na
      // conta de outro arquivo de teste)
      p_starts_at_utc: instanteEm(
        new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10),
        '10:00',
        'America/Cuiaba',
      ),
      p_duration_min: 45,
    })
    expect(error).toBeNull()
    const [linha] = await sql<{ id: string; status: string }[]>`
      select id, status from students where display_name = 'Pessoa da experimental'`
    expect(linha.status).toBe('active')
    expect((await auditoria(linha.id, 'lead_promoted')).length).toBe(0)
  })

  it('contrato de TURMA promove quem já está na turma E quem entra depois', async () => {
    const a = await criarLead('Lead turma A')
    const b = await criarLead('Lead turma B')
    const [g] = await sql`insert into student_groups (label) values ('Casal do ciclo') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${a as string})`

    await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${teacherId}, 'casal', 15000, 2, 24, 90,
              public.business_today() - 45)`
    expect(await statusDe(a as string)).toBe('active')

    // o segundo entra DEPOIS do contrato — o gatilho do membro fecha o buraco
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${b as string})`
    expect(await statusDe(b as string)).toBe('active')
    const audit = await auditoria(b as string, 'lead_promoted')
    expect(audit[0].diff).toMatchObject({ via: 'group_member' })
  })

  it('a RENOVAÇÃO também passa pelo gatilho (contrato novo é contrato)', async () => {
    const id = await criarLead('Lead que renovou')
    const contrato = await criarContrato(id as string)
    // volta o cadastro para lead à força: o que se mede aqui é o caminho da
    // renovação, não o do contrato inicial (que o teste acima já cobre)
    await sql`update students set status = 'lead' where id = ${id as string}`

    const { error } = await admin.rpc('admin_renew_contract', {
      p_old: contrato,
      p_switch_on: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      p_plan_name: 'plano novo',
      p_hourly_rate_cents: 16000,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(error).toBeNull()
    expect(await statusDe(id as string)).toBe('active')
  })
})

/* ========================================================================== */
/* 3. Lead é invisível a quem não é admin (sem policy nova)                    */
/* ========================================================================== */

describe('RLS: lead só existe para a administração', () => {
  it('a professora não vê o lead (o recorte dela deriva de CONTRATOS)', async () => {
    const id = await criarLead('Lead invisível')
    const prof = await clientAs(teacherUser, 'teacher')

    const { data } = await prof.from('students').select('id, display_name')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).not.toContain(id as string)

    // …e o diretório inteiro é fechado para ela
    const dir = await prof.rpc('admin_student_directory')
    expect(dir.error?.message).toMatch(/só da administração/)

    // depois de virar aluno DELA, aí sim aparece — a fronteira é o contrato
    await criarContrato(id as string)
    const depois = await prof.from('students').select('id')
    expect((depois.data ?? []).map((r) => r.id)).toContain(id as string)
  })

  it('aluno e anônimo não alcançam lead nenhum', async () => {
    const { data: id } = await admin.rpc('admin_create_lead', { p_name: 'Lead do portal' })
    const aluno = await clientAs(studentUser, 'student')
    const { data: comoAluno } = await aluno.from('students').select('id')
    expect((comoAluno ?? []).map((r) => r.id)).not.toContain(id as string)

    const { data: comoAnon } = await anonClient().from('students').select('id')
    expect(comoAnon ?? []).toHaveLength(0)
  })

  it('nenhuma policy nova de students nasceu nesta fase', async () => {
    const nomes = await sql<{ policyname: string }[]>`
      select policyname from pg_policies where tablename = 'students' order by policyname`
    expect(nomes.map((p) => p.policyname).sort()).toEqual(
      ['students_admin_all', 'students_self', 'students_teacher'].sort(),
    )
  })
})

/* ========================================================================== */
/* 4. Derivação (pura) — a matriz inteira                                      */
/* ========================================================================== */

describe('situacaoDoAluno', () => {
  const vivo = { status: 'active', is_trial: false }
  const pausado = { status: 'paused', is_trial: false }
  const trial = { status: 'active', is_trial: true }
  const morto = { status: 'ended', is_trial: false }

  it('arquivado manda em tudo — inclusive sobre contrato vivo que sobrou', () => {
    expect(situacaoDoAluno({ status: 'archived', contratos: [] })).toBe('arquivado')
    expect(situacaoDoAluno({ status: 'archived', contratos: [vivo] })).toBe('arquivado')
  })

  it('lead sem experimental é lead; com experimental, é experimental', () => {
    expect(situacaoDoAluno({ status: 'lead', contratos: [] })).toBe('lead')
    expect(situacaoDoAluno({ status: 'lead', contratos: [trial] })).toBe('experimental')
  })

  it('cadastro ATIVO cujo único contrato vivo é o experimental também é experimental', () => {
    // é o caso de quem nasceu da aula experimental (admin_create_trial_class):
    // a etapa do funil é a experimental, não a coluna de status
    expect(situacaoDoAluno({ status: 'active', contratos: [trial] })).toBe('experimental')
    // …e para de ser assim que o contrato de verdade nasce
    expect(situacaoDoAluno({ status: 'active', contratos: [trial, vivo] })).toBe('ativo')
  })

  it('pausado exige TODOS os contratos reais pausados', () => {
    expect(situacaoDoAluno({ status: 'active', contratos: [pausado] })).toBe('pausado')
    expect(situacaoDoAluno({ status: 'active', contratos: [pausado, pausado] })).toBe('pausado')
    // um pausado e outro rodando = a pessoa continua tendo aula
    expect(situacaoDoAluno({ status: 'active', contratos: [pausado, vivo] })).toBe('ativo')
    // a pausa do experimental não pausa ninguém
    expect(
      situacaoDoAluno({ status: 'active', contratos: [{ status: 'paused', is_trial: true }, vivo] }),
    ).toBe('ativo')
  })

  it('sem contrato vivo (nenhum, ou só encerrados) é sem_contrato', () => {
    expect(situacaoDoAluno({ status: 'active', contratos: [] })).toBe('sem_contrato')
    expect(situacaoDoAluno({ status: 'active', contratos: [morto] })).toBe('sem_contrato')
  })

  it('`is_trial` ausente (payload velho) não vira experimental por acidente', () => {
    expect(situacaoDoAluno({ status: 'active', contratos: [{ status: 'active' }] })).toBe('ativo')
    expect(
      situacaoDoAluno({ status: 'active', contratos: [{ status: 'active', is_trial: null }] }),
    ).toBe('ativo')
  })

  it('a lista de TRABALHO exclui lead e arquivado, e só eles', () => {
    for (const s of SITUACOES) {
      expect(noDiaADia({ situacao: s }), s).toBe(s !== 'lead' && s !== 'arquivado')
    }
  })

  it('o vocabulário é fechado e tem rótulo para os seis (pílula e filtro)', () => {
    expect(ehSituacao('lead')).toBe(true)
    expect(ehSituacao('ativo')).toBe(true)
    expect(ehSituacao('churned')).toBe(false)
    expect(ehSituacao(undefined)).toBe(false)
    for (const s of SITUACOES) {
      expect(SITUACAO_ROTULO[s]).toBeTruthy()
      expect(SITUACAO_FILTRO[s]).toBeTruthy()
    }
  })

  it('contarSituacoes conta TODO mundo, uma vez só', () => {
    const alunos: { situacao: Situacao }[] = [
      { situacao: 'lead' },
      { situacao: 'lead' },
      { situacao: 'ativo' },
      { situacao: 'arquivado' },
    ]
    const c = contarSituacoes(alunos)
    expect(c.lead).toBe(2)
    expect(c.ativo).toBe(1)
    expect(c.arquivado).toBe(1)
    expect(c.experimental).toBe(0)
    expect(Object.values(c).reduce((s, n) => s + n, 0)).toBe(alunos.length)
  })
})

/* ========================================================================== */
/* 5. As contagens contra o diretório DE VERDADE                               */
/* ========================================================================== */

/*
 * ⚠️ Este bloco lê o diretório pelo POSTGRES, dentro de UMA transação, com a
 * claim de admin injetada — e não pelo PostgREST. Dois motivos, os dois
 * medidos na suíte cheia:
 *   1. o PostgREST corta em `max_rows = 1000` (config.toml), e a bancada
 *      compartilhada passa disso: o diretório voltava truncado e a contagem
 *      comparava metade da escola com o total do banco;
 *   2. a suíte roda arquivos em PARALELO, e outros arquivos criam aluno o tempo
 *      todo — duas leituras seguidas veriam snapshots diferentes. É a mesma
 *      armadilha (e a mesma solução) já anotada em `admin_home_counts()` no
 *      tests/onda1-fundacoes.test.ts.
 */
describe('badges × admin_student_directory()', () => {
  let brutos: AlunoDoDiretorio[]
  let doBanco: { leads: number; arquivados: number; convites: number; convitesEsperado: number }

  /** claim de admin para as leituras diretas (o gate das RPCs é `app_role()`) */
  const CLAIMS = JSON.stringify({
    sub: '00000000-0000-0000-0000-0000000000ad',
    app_metadata: { role: 'admin' },
  })

  beforeAll(async () => {
    // um de cada, para nenhuma badge ser provada com zero
    const { data: leadId } = await admin.rpc('admin_create_lead', { p_name: 'Zzz Lead contagem' })
    await admin.rpc('admin_create_lead', { p_name: 'Zzz Lead perdido contagem' }).then((r) =>
      admin.rpc('admin_lose_lead', { p_student: r.data as string }),
    )
    await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, is_trial)
      values ('private_1on1', ${leadId as string}, ${teacherId}, 'Aula experimental', 0,
              0, 24, 90, public.business_today() - 45, true)`
    const pausadoId = await createStudent(sql)
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${pausadoId}, ${teacherId}, 'pausa do ciclo', 15000, 4, 24, 90,
              public.business_today() - 45)
      returning id`
    await sql`update contracts set status = 'paused' where id = ${c.id}`

    // TUDO no mesmo snapshot: diretório, contagens do banco e a fila do Início.
    //
    // REPEATABLE READ, e não só `begin` (correção do lote c7): em READ
    // COMMITTED cada INSTRUÇÃO abre um snapshot novo — abrir transação não
    // congela nada. A suíte roda arquivos em PARALELO e outros arquivos
    // arquivam aluno o tempo todo; a leitura do diretório e a contagem de
    // `status = 'archived'` saíam de instantes diferentes e discordavam por um.
    const lido = await sql.begin('isolation level repeatable read', async (tx) => {
      await tx`select set_config('request.jwt.claims', ${CLAIMS}, true)`
      const dir = await tx`select * from public.admin_student_directory()`
      const [n] = await tx`
        select count(*) filter (where status = 'lead')::int as leads,
               count(*) filter (where status = 'archived')::int as arquivados,
               (public.admin_home_counts() ->> 'convites_pendentes')::int as convites,
               (select count(*)
                  from students s
                  left join auth.users au on au.id = s.profile_id
                 where s.status not in ('archived', 'lead')
                   and (s.profile_id is null or au.email_confirmed_at is null))::int
                 as convites_esperado
          from students`
      return { dir, n }
    })
    const { dir, n } = lido as unknown as {
      dir: unknown[]
      n: { leads: number; arquivados: number; convites: number; convites_esperado: number }
    }
    // O driver devolve `timestamptz` como `Date`; o app recebe o mesmo dado em
    // JSON (string) pelo PostgREST. A normalização deixa o payload IDÊNTICO ao
    // que a camada de dados valida — o schema segue sendo o mesmo, sem afrouxar.
    brutos = DiretorioSchema.parse(
      (dir as Record<string, unknown>[]).map((linha) =>
        Object.fromEntries(
          Object.entries(linha).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
        ),
      ),
    )
    doBanco = {
      leads: Number(n.leads),
      arquivados: Number(n.arquivados),
      convites: Number(n.convites),
      convitesEsperado: Number(n.convites_esperado),
    }
  })

  it('o diretório entrega o marcador da experimental (is_trial)', () => {
    const comTrial = brutos.flatMap((b) => b.contracts).filter((c) => c.is_trial === true)
    expect(comTrial.length).toBeGreaterThan(0)
    // e o campo é booleano de verdade em TODO contrato (nunca `undefined`)
    for (const c of brutos.flatMap((b) => b.contracts)) expect(typeof c.is_trial).toBe('boolean')
  })

  it('cada situação bate com o que o BANCO diz, uma pessoa em um balde só', () => {
    const linhas = brutos.map((b) =>
      montarAluno(b, { cidade: b.city || 'Cuiabá', horaLocal: '12:00', idxDaProfessora: () => 0 }),
    )
    const contagens = contarSituacoes(linhas)

    // 1. ninguém fica de fora e ninguém conta duas vezes
    expect(Object.values(contagens).reduce((s, n) => s + n, 0)).toBe(brutos.length)

    // 2. as situações que vêm do status ARMAZENADO conferem com o banco
    expect(contagens.arquivado).toBe(doBanco.arquivados)
    // Todo LEAD armazenado aparece como lead ou experimental — e nunca como
    // aluno de coisa nenhuma.
    const porId = new Map(linhas.map((l) => [l.id, l.situacao]))
    const armazenadosLead = brutos.filter((b) => b.status === 'lead')
    expect(armazenadosLead.length).toBe(doBanco.leads)
    for (const b of armazenadosLead) {
      expect(['lead', 'experimental'], b.display_name).toContain(porId.get(b.id))
    }
    // …e a badge "lead" NUNCA cobre quem o banco não chama de lead.
    for (const l of linhas.filter((x) => x.situacao === 'lead')) {
      expect(brutos.find((b) => b.id === l.id)!.status).toBe('lead')
    }

    // 3. as derivadas existem de verdade nesta bancada
    expect(contagens.lead).toBeGreaterThan(0)
    expect(contagens.experimental).toBeGreaterThan(0)
    expect(contagens.pausado).toBeGreaterThan(0)
    expect(contagens.ativo).toBeGreaterThan(0)
    expect(contagens.arquivado).toBeGreaterThan(0)

    // 4. a lista de trabalho é o total menos lead e arquivado
    expect(linhas.filter(noDiaADia).length).toBe(
      brutos.length - contagens.lead - contagens.arquivado,
    )
  })

  it('lead não vira convite pendente na fila do Início', () => {
    // as duas contas saíram do MESMO snapshot (ver o aviso do bloco)
    expect(doBanco.convites).toBe(doBanco.convitesEsperado)
    // e há lead na bancada, então a exclusão está sendo exercitada de verdade
    expect(doBanco.leads).toBeGreaterThan(0)
  })
})

/* ========================================================================== */
/* 6. Aceites de tela                                                          */
/* ========================================================================== */

describe('as telas do ciclo de vida', () => {
  it('o hub desenha a fileira de badges e o `?situacao=` do funil', () => {
    const page = codigo('src/app/admin/alunos/page.tsx')
    expect(page).toContain('<FiltroDeSituacao')
    // P10 da revisão nº 8: o ciclo de vida ganhou chave PRÓPRIA. `?f=` voltou a
    // ser só o vocabulário de ACESSO (as duas listas têm a palavra `ativo`, e
    // uma chave que muda de sentido conforme a rota é ambiguidade, não
    // compatibilidade); os links antigos são encaminhados.
    expect(page).toContain('ehSituacao(sp.situacao)')
    expect(page).toContain('ehAcesso(sp.f)')
    // e a variante nova do split-button existe
    expect(page).toContain("label: 'Novo lead'")
    expect(page).toContain("href: '/admin/alunos?lead=1'")
  })

  it('a fileira tem os SETE botões, com contagem e endereço', () => {
    const filtro = codigo('src/components/admin/alunos/FiltroDeSituacao.tsx')
    expect(filtro).toContain("rotulo: 'Todos'")
    expect(filtro).toContain('SITUACAO_FILTRO[s]')
    expect(filtro).toContain('contagens[s]')
    expect(filtro).toContain('?situacao=${i.valor}')
    // ordem do dono (27/07): item é botão da casa; a cor da situação mora no
    // ponto (mapa PONTO, coberto chave a chave pelo teste da onda 1)
    expect(filtro).toContain('PONTO[i.valor]')
    expect(filtro).toContain('btn-ac-soft')
  })

  it('a pílula da linha e a da ficha falam a situação DERIVADA', () => {
    const lista = codigo('src/components/admin/alunos/ListaDeAlunos.tsx')
    expect(lista).toContain('tone="situacao"')
    expect(lista).toContain('SITUACAO_ROTULO[aluno.situacao]')
    // o mapa do `students.status` cru morreu junto (era a segunda verdade)
    expect(lista).not.toContain("active: { rotulo: 'ativo'")

    const identidade = codigo('src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx')
    expect(identidade).toContain('tone="situacao"')
    expect(identidade).toContain('ficha.ehLead')
    expect(identidade).toContain('Lead perdido')
  })

  it('o Pill do kit tem o tom `situacao` com os SEIS mapeados', () => {
    const pill = codigo('src/components/kit/pill.tsx')
    expect(pill).toContain("'situacao'")
    for (const s of SITUACOES) {
      const chave = s === 'sem_contrato' ? 'sem-contrato' : s
      expect(pill, s).toContain(`bg-situacao-${chave}-bg`)
    }
  })

  it('as cores novas moram em token, e nenhuma é âmbar', () => {
    const css = corpo('src/app/globals.css')
    for (const s of SITUACOES) {
      const chave = s === 'sem_contrato' ? 'sem-contrato' : s
      expect(css).toContain(`--situacao-${chave}-bg:`)
      expect(css).toContain(`--color-situacao-${chave}-bg:`)
    }
    // âmbar segue banido (a régua do M3-c1 · C3)
    const bloco = css.slice(css.indexOf('CICLO DE VIDA DO ALUNO — as seis situações'))
    expect(bloco.slice(0, 3000)).not.toMatch(/#(b3550e|d97706|f59e0b|fbbf24|92400e|b45309)/i)
  })

  it('o painel "lead perdido" existe, é opcional no motivo e não pede type-to-confirm', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain("painel === 'perder'")
    expect(paineis).toContain('loseLeadAction')
    expect(paineis).toContain('name="reason"')
    // o portão por digitação é o da anonimização, e continua só lá
    const trecho = paineis.slice(paineis.indexOf("painel === 'perder'"))
    expect(trecho.slice(0, 1600)).not.toContain('confirm_name')
  })

  it('o formulário de lead pede NOME e mais nada', () => {
    const form = codigo('src/components/admin/alunos/FormularioDeLead.tsx')
    expect(form).toContain('createLeadAction')
    expect(form).toContain('name="display_name"')
    expect(form).toContain('<CityPicker')
    expect(form).toContain('name="referral_source"')
    // um `required` só — o do nome
    expect(form.match(/required/g) ?? []).toHaveLength(1)
  })
})
