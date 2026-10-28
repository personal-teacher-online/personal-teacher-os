// Briefing v2 — RODADA DE INTEGRAÇÃO (28/07/2026).
//
// A revisão adversarial de integração do P2 apontou que a MESMA pergunta — "este
// aluno tem re-briefing a fazer, e de qual (contrato, semestre)?" — era
// respondida por três derivações independentes (a query do card em TypeScript, a
// escolha de contrato do lembrete em SQL, e o par derivado dentro das RPCs de
// escrita), e que elas já discordavam. Este arquivo trava as correções:
//
//  · I1 — `briefing_update_pendente` é a regra ÚNICA, e acerta o caso que
//    derrubava as três: aluno com DOIS contratos individuais ativos, um já
//    atualizado e outro não;
//  · I2 — re-briefing é de contrato INDIVIDUAL nesta onda: contrato de
//    casal/grupo não produz pendência, e o envio pela admin diz isso em voz alta;
//  · I3 — rascunho e envio exigem briefing BASE enviado e v2 (as duas frases
//    nascem numa função só, `_briefing_update_base_ok`);
//  · I4 — a RLS da professora é POR CONTRATO: a professora de OUTRO contrato do
//    MESMO aluno não lê a atualização, nem por `briefing_updates` nem pelo
//    `briefing_effective` (que é SECURITY INVOKER e herda a RLS);
//  · I5 — o formulário do briefing diz sob que VERSÃO foi desenhado, e a action
//    recusa quando a linha mudou de versão no intervalo (o parse com a régua
//    errada gravava a resposta sob outra chave, calado).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createStudent } from './helpers/db'

// A ponte é declarada ANTES dos mocks porque `vi.mock` sobe para o topo do
// arquivo — mesmo truque do c17 e do sub-lote 3.
const ponte = vi.hoisted(() => {
  class Redirecionou extends Error {
    url: string
    constructor(url: string) {
      super(`redirect(${url})`)
      this.name = 'Redirecionou'
      this.url = url
    }
  }
  /** O pote de cookies dublê — só o que `gravarFlash`/`lerFlash` usam. */
  const cru = new Map<string, string>()
  const pote = {
    get: (nome: string) => {
      const v = cru.get(nome)
      return v === undefined ? undefined : { name: nome, value: decodeURIComponent(v) }
    },
    set: (nome: string, valor: string) => {
      cru.set(nome, encodeURIComponent(valor))
    },
    delete: (nome: string) => {
      cru.delete(nome)
    },
  }
  return { Redirecionou, pote, cliente: null as SupabaseClient | null }
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new ponte.Redirecionou(url)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ponte.cliente,
}))
// P5: a recusa do briefing deixou de viajar na URL e passou a ser gravada no
// COOKIE de flash (a moldura do portal a pinta). O dublê abaixo é o mesmo pote
// de `tests/portal-flash.test.ts`: ele guarda o valor serializado e o desfaz na
// leitura, como o `@edge-runtime/cookies` do Next faz nas duas pontas.
vi.mock('next/headers', () => ({ cookies: async () => ponte.pote }))

import { saveBriefingStepAction } from '@/app/portal/actions'
import { FLASH_COOKIE, lerFlash } from '@/lib/portal/flash'
import { atualizacaoDeBriefingPendente } from '@/lib/portal/data'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})
afterEach(() => {
  ponte.cliente = null
})

/* -------------------------------------------------------------------------- */
/* Bancada                                                                     */
/* -------------------------------------------------------------------------- */

const BASE = {
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

const KOLB = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

/** Briefing base ENVIADO em v2 para um aluno já existente. */
async function briefingEnviado(studentId: string) {
  await sql`delete from briefings where student_id = ${studentId}`
  await sql`
    insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                           status, submitted_at, schema_version)
    values (${studentId}, ${sql.json(BASE)}, ${sql.json(KOLB)},
            ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
            'submitted', now(), 2)`
}

interface Aluno {
  studentId: string
  userId: string
  client: SupabaseClient
  admin: SupabaseClient
  adminId: string
}

/** Aluno com login, briefing v2 enviado e NENHUM contrato ainda. */
async function alunoBase(nome: string): Promise<Aluno> {
  const studentId = await createStudent(sql)
  const userId = await createAuthUser(sql, 'student', nome)
  await sql`update students set profile_id = ${userId}, level = 'A1' where id = ${studentId}`
  await briefingEnviado(studentId)
  const adminId = await createAuthUser(sql, 'admin', `Admin ${nome}`)
  return {
    studentId,
    userId,
    client: await clientAs(userId, 'student'),
    admin: await clientAs(adminId, 'admin'),
    adminId,
  }
}

/** Contrato individual ATIVO com 8 meses de estrada + plano do semestre 2. */
async function contratoComSemestre2(aluno: Aluno): Promise<{ contractId: string; teacherId: string }> {
  const c = await createPrivateContract(sql, { studentId: aluno.studentId })
  await sql`
    update contracts set started_on = (public.business_today() - interval '8 months')::date
     where id = ${c.contractId}`
  const { data: planId, error } = await aluno.admin.rpc('generate_study_plan', {
    p_contract: c.contractId,
  })
  expect(error).toBeNull()
  const [p] = await sql`select semester_no from study_plans where id = ${planId}`
  expect(p.semester_no).toBe(2)
  return { contractId: c.contractId, teacherId: c.teacherId }
}

async function enviaAtualizacao(aluno: Aluno, contractId: string) {
  const rascunho = await aluno.client.rpc('save_briefing_update_draft', {
    p_contract: contractId,
    p_answers: UPDATE,
  })
  expect(rascunho.error).toBeNull()
  const envio = await aluno.client.rpc('submit_briefing_update', { p_contract: contractId })
  expect(envio.error).toBeNull()
}

/* -------------------------------------------------------------------------- */
describe('I1 · briefing_update_pendente é a regra ÚNICA', () => {
  it('dois contratos ativos, um já atualizado: devolve o que FALTA (achado 5)', async () => {
    const aluno = await alunoBase('Aluno Dois Contratos')
    const um = await contratoComSemestre2(aluno)
    const dois = await contratoComSemestre2(aluno)

    // Os dois estão empatados em semestre; o desempate é por `contract_id`. O
    // cenário do achado é justamente o contrato que vem PRIMEIRO na ordem já
    // estar atualizado — uma derivação que só pega "o primeiro" responderia
    // aquele, e o aluno veria "nada para atualizar" com um ciclo em aberto.
    const [primeiro, segundo] =
      um.contractId < dois.contractId ? [um, dois] : [dois, um]
    await enviaAtualizacao(aluno, primeiro.contractId)

    const { data, error } = await aluno.client.rpc('briefing_update_pendente', {
      p_student: aluno.studentId,
    })
    expect(error).toBeNull()
    expect(data).toEqual([{ contract_id: segundo.contractId, semester_no: 2 }])

    // e a função do portal (card do Início, rota de atualização, ficha) concorda
    const pendencia = await atualizacaoDeBriefingPendente(aluno.client)
    expect(pendencia.erro).toBe(false)
    expect(pendencia.pendente).toEqual({
      studentId: aluno.studentId,
      contractId: segundo.contractId,
      semesterNo: 2,
    })

    // atualizado o segundo, não sobra nada
    await enviaAtualizacao(aluno, segundo.contractId)
    const depois = await aluno.client.rpc('briefing_update_pendente', {
      p_student: aluno.studentId,
    })
    expect(depois.data).toEqual([])
    expect((await atualizacaoDeBriefingPendente(aluno.client)).pendente).toBeNull()
  })

  it('a mesma resposta para a admin e para a professora do aluno; estranho leva exceção', async () => {
    const aluno = await alunoBase('Aluno Porteiro')
    const c = await contratoComSemestre2(aluno)
    const esperado = [{ contract_id: c.contractId, semester_no: 2 }]

    const daAdmin = await aluno.admin.rpc('briefing_update_pendente', { p_student: aluno.studentId })
    expect(daAdmin.data).toEqual(esperado)

    const profUser = await createAuthUser(sql, 'teacher', 'Prof Porteiro')
    await sql`update teachers set profile_id = ${profUser} where id = ${c.teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const daProf = await prof.rpc('briefing_update_pendente', { p_student: aluno.studentId })
    expect(daProf.data).toEqual(esperado)

    // outro aluno perguntando pelo alheio: EXCEÇÃO, não lista vazia — vazio seria
    // indistinguível de "este aluno não tem nada pendente".
    const intruso = await alunoBase('Aluno Intruso')
    const espiada = await intruso.client.rpc('briefing_update_pendente', {
      p_student: aluno.studentId,
    })
    expect(espiada.error?.message).toContain('sem acesso')

    // professora SEM vínculo com o aluno, idem
    const outraUser = await createAuthUser(sql, 'teacher', 'Prof Sem Vínculo')
    const outra = await clientAs(outraUser, 'teacher')
    const dela = await outra.rpc('briefing_update_pendente', { p_student: aluno.studentId })
    expect(dela.error?.message).toContain('sem acesso')
  })
})

/* -------------------------------------------------------------------------- */
describe('I2 · o re-briefing é de contrato INDIVIDUAL nesta onda', () => {
  it('contrato de casal não produz pendência, e o envio pela admin recusa por nome', async () => {
    const aluno = await alunoBase('Aluno do Casal')
    const [g] = await sql`insert into student_groups (label) values ('Casal da integração') returning id`
    await sql`
      insert into student_group_members (group_id, student_id)
      values (${g.id}, ${aluno.studentId})`
    const [teacher] = await sql`select id from teachers limit 1`
    const [grupo] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${teacher.id}, 'casal', 15000, 2, 24, 90,
              (public.business_today() - interval '8 months')::date)
      returning id`
    // `generate_study_plan` nem aceita contrato de grupo ("contrato particular
    // não encontrado"), então o plano entra à mão: é EXATAMENTE o cenário que a
    // régua velha do lembrete dizia atender e nunca conseguiria cumprir.
    await sql`
      insert into study_plans (contract_id, semester_no, starts_on, ends_on, level_snapshot, track_id)
      select ${grupo.id}, 2, (public.business_today() - interval '2 months')::date,
             (public.business_today() + interval '4 months')::date, 'A1', t.id
        from curriculum_tracks t limit 1`

    const { data } = await aluno.client.rpc('briefing_update_pendente', {
      p_student: aluno.studentId,
    })
    expect(data).toEqual([])

    // o aluno nem começa (o contrato "não é dele" — `student_id` é NULL)
    const rascunho = await aluno.client.rpc('save_briefing_update_draft', {
      p_contract: grupo.id,
      p_answers: { objetivos: UPDATE.objetivos },
    })
    expect(rascunho.error?.message).toContain('não é seu')

    // e a admin, que entra por outra porta, ouve o motivo real
    const envio = await aluno.admin.rpc('submit_briefing_update', { p_contract: grupo.id })
    expect(envio.error?.message).toContain('casal/grupo')

    expect((await sql`select 1 from briefing_updates where contract_id = ${grupo.id}`).length).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
describe('I3 · a atualização precisa de um briefing BASE enviado, e em v2', () => {
  it('base ainda em rascunho: rascunho e envio da atualização recusam', async () => {
    const aluno = await alunoBase('Aluno Base Rascunho')
    const c = await contratoComSemestre2(aluno)
    await sql`update briefings set status = 'draft' where student_id = ${aluno.studentId}`

    const rascunho = await aluno.client.rpc('save_briefing_update_draft', {
      p_contract: c.contractId,
      p_answers: { objetivos: UPDATE.objetivos },
    })
    expect(rascunho.error?.message).toContain('o briefing completo vem primeiro')

    const envio = await aluno.client.rpc('submit_briefing_update', { p_contract: c.contractId })
    expect(envio.error?.message).toContain('o briefing completo vem primeiro')

    // nem pela porta da admin
    const daAdmin = await aluno.admin.rpc('submit_briefing_update', { p_contract: c.contractId })
    expect(daAdmin.error?.message).toContain('o briefing completo vem primeiro')

    expect((await sql`select 1 from briefing_updates where contract_id = ${c.contractId}`).length).toBe(0)
  })

  it('base colhida no v1: a atualização não se aplica (o formulário é o v2)', async () => {
    const aluno = await alunoBase('Aluno Base v1')
    const c = await contratoComSemestre2(aluno)

    // o rascunho começa enquanto a linha ainda é v2…
    const antes = await aluno.client.rpc('save_briefing_update_draft', {
      p_contract: c.contractId,
      p_answers: UPDATE,
    })
    expect(antes.error).toBeNull()

    // …e a partir daqui a linha é v1: as duas portas fecham
    await sql`update briefings set schema_version = 1 where student_id = ${aluno.studentId}`
    const rascunho = await aluno.client.rpc('save_briefing_update_draft', {
      p_contract: c.contractId,
      p_answers: { objetivos: UPDATE.objetivos },
    })
    expect(rascunho.error?.message).toContain('briefing antigo')

    const envio = await aluno.client.rpc('submit_briefing_update', { p_contract: c.contractId })
    expect(envio.error?.message).toContain('briefing antigo')

    const [u] = await sql`select status from briefing_updates where contract_id = ${c.contractId}`
    expect(u.status).toBe('draft')
    expect((await aluno.client.rpc('briefing_update_pendente', { p_student: aluno.studentId })).data)
      .toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
describe('I4 · a RLS da atualização é POR CONTRATO', () => {
  it('a professora de OUTRO contrato do mesmo aluno não lê — nem pelo efetivo', async () => {
    const aluno = await alunoBase('Aluno Duas Professoras')
    const dela = await contratoComSemestre2(aluno)
    const doOutro = await contratoComSemestre2(aluno)
    await enviaAtualizacao(aluno, dela.contractId)

    const donaUser = await createAuthUser(sql, 'teacher', 'Prof Dona do Contrato')
    await sql`update teachers set profile_id = ${donaUser} where id = ${dela.teacherId}`
    const dona = await clientAs(donaUser, 'teacher')

    const antigaUser = await createAuthUser(sql, 'teacher', 'Prof Antiga do Aluno')
    await sql`update teachers set profile_id = ${antigaUser} where id = ${doOutro.teacherId}`
    const antiga = await clientAs(antigaUser, 'teacher')

    // a antiga É professora DO ALUNO (é dela o outro contrato) — a policy velha,
    // escrita em `teacher_student_ids()`, entregava a ela a atualização feita
    // para o plano da colega.
    const daAntiga = await antiga.from('students').select('id').eq('id', aluno.studentId)
    expect(daAntiga.data, 'a professora antiga enxerga o ALUNO').toHaveLength(1)

    const leituraDona = await dona
      .from('briefing_updates')
      .select('id')
      .eq('contract_id', dela.contractId)
    expect(leituraDona.data).toHaveLength(1)

    const leituraAntiga = await antiga
      .from('briefing_updates')
      .select('id')
      .eq('contract_id', dela.contractId)
    expect(leituraAntiga.data ?? []).toHaveLength(0)

    // `briefing_effective` é SECURITY INVOKER: a mesma fronteira vale nele
    const efetivoDona = await dona.rpc('briefing_effective', {
      p_student: aluno.studentId,
      p_contract: dela.contractId,
      p_semester: 2,
    })
    expect((efetivoDona.data as Record<string, unknown>).objetivos).toEqual(UPDATE.objetivos)

    const efetivoAntiga = await antiga.rpc('briefing_effective', {
      p_student: aluno.studentId,
      p_contract: dela.contractId,
      p_semester: 2,
    })
    expect((efetivoAntiga.data as Record<string, unknown>).objetivos).toEqual(BASE.objetivos)
  })
})

/* -------------------------------------------------------------------------- */
describe('I5 · a tela diz sob que versão foi desenhada, e a action confere', () => {
  /** Etapa 1 do briefing v2, como o formulário a envia. */
  function etapa1(versao: string): FormData {
    const fd = new FormData()
    fd.set('etapa', '1')
    fd.set('versao', versao)
    fd.set('cidade_vida', 'Cuiabá')
    fd.set('facil', 'entender o que ouço')
    fd.set('dificil', 'falar sem travar')
    fd.append('contato', 'Aulas particulares')
    return fd
  }

  /**
   * O desfecho da action: para ONDE ela levou e QUAL recado ela deixou.
   *
   * P5: a frase da recusa saiu da URL e passou a ser gravada no cookie de flash
   * (a moldura do portal a pinta). O teste passou a olhar os dois lugares — é a
   * mesma exigência de antes, no endereço novo: a rota diz a ETAPA, o cookie diz
   * o MOTIVO. `lerFlash` é a função de produção, sobre o pote dublê.
   */
  async function chamar(
    cliente: SupabaseClient,
    fd: FormData,
  ): Promise<{ url: string; recado: string | null }> {
    ponte.cliente = cliente
    ponte.pote.delete(FLASH_COOKIE)
    try {
      await saveBriefingStepAction(fd)
    } catch (e) {
      if (e instanceof ponte.Redirecionou)
        return { url: e.url, recado: (await lerFlash())?.mensagem ?? null }
      throw e
    }
    throw new Error('a action deveria ter redirecionado')
  }

  it('versão divergente da linha: recusa e não grava nada', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno Versão da Tela')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const cliente = await clientAs(userId, 'student')

    // a linha nasce v2 (default da coluna); a tela diz que foi desenhada no v1
    const recusa = await chamar(cliente, etapa1('1'))
    expect(recusa.recado).toContain('a página estava desatualizada')
    expect(recusa.url).toContain('etapa=1')
    // …e o motivo NÃO viaja mais pendurado na URL (P5)
    expect(recusa.url).not.toContain('msg=')

    const [antes] = await sql`select answers from briefings where student_id = ${c.studentId}`
    expect(antes?.answers ?? {}).toEqual({})

    // campo ausente também é divergência (formulário de outra época)
    const semCampo = etapa1('2')
    semCampo.delete('versao')
    const semVersao = await chamar(cliente, semCampo)
    expect(semVersao.recado).toContain('a página estava desatualizada')

    // com a versão certa, grava — e nas chaves do v2
    const ok = await chamar(cliente, etapa1('2'))
    expect(ok.url).toContain('etapa=2')
    expect(ok.url).not.toContain('msg=')
    // avanço sem recusa não deixa recado nenhum para a moldura pintar
    expect(ok.recado).toBeNull()
    const [depois] = await sql`select answers from briefings where student_id = ${c.studentId}`
    expect(depois.answers.historia.facil).toBe('entender o que ouço')
    expect(depois.answers.historia.contato).toEqual(['Aulas particulares'])
    // a chave do v1 (que o parse errado teria criado) não existe
    expect(depois.answers.historia.facil_dificil).toBeUndefined()
  })

  /* ------------------------------------------------------------------------
   * O RECADO VELHO NÃO SOBREVIVE À CORREÇÃO (rodada de correção do P5, M13).
   *
   * O cookie de flash vive 15 segundos e NINGUÉM o apaga na leitura — foi assim
   * que ele parou de ser comido por prefetch e por gate de rota. Só que
   * expiração é faxina de TEMPO, não de FATO: quem erra na etapa 1, lê a recusa
   * e corrige em cinco segundos chegava na etapa 2 com a frase da falha que
   * acabou de resolver. O sucesso ficava mudo e o erro ficava falando.
   *
   * A correção é do ESCRITOR: a action que teve sucesso limpa o próprio recado
   * (`maxAge: 0`). A proibição de apagar na LEITURA continua de pé.
   *
   * Este caso NÃO usa o `chamar` acima de propósito: ele zera o cookie entre as
   * chamadas, que é justamente o que esconderia o defeito.
   * ---------------------------------------------------------------------- */
  it('erro na etapa 1 → correção com sucesso → a etapa 2 chega SEM o recado velho', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno Flash Velho')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    ponte.cliente = await clientAs(userId, 'student')
    ponte.pote.delete(FLASH_COOKIE)

    /** Chama a action SEM tocar no cookie — o estado atravessa as duas chamadas. */
    const passo = async (fd: FormData): Promise<string> => {
      try {
        await saveBriefingStepAction(fd)
      } catch (e) {
        if (e instanceof ponte.Redirecionou) return e.url
        throw e
      }
      throw new Error('a action deveria ter redirecionado')
    }

    // 1) a recusa: etapa 1 do v2 exige ao menos uma forma de contato
    const semContato = etapa1('2')
    semContato.delete('contato')
    const urlDaRecusa = await passo(semContato)
    expect(urlDaRecusa).toContain('etapa=1')
    const recusa = await lerFlash()
    expect(recusa?.mensagem).toContain('forma de contato')

    // 2) a correção, no mesmo navegador, dentro dos 15s do cookie
    const urlDoSucesso = await passo(etapa1('2'))
    expect(urlDoSucesso).toContain('etapa=2')

    // 3) e a etapa 2 não herda a frase da etapa 1
    expect(await lerFlash()).toBeNull()
  })
})
