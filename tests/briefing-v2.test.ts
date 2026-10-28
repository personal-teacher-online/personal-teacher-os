// Briefing v2 — NÚCLEO de banco (migration 20260728000100_briefing_v2_nucleo).
// Prova as três peças do sub-lote 1: a linha carrega a versão sob a qual nasceu
// (rascunho v1 continua submetendo pela regra v1), o envio v2 exige o que cada
// RAMO (criança × adulto) precisa, e a correção pós-envio deixa trilha
// append-only com de/para + snapshot.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(async () => {
  sql = connect(7)
})
afterAll(async () => {
  await sql.end()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Rótulo LITERAL da finalidade profissional — mora no banco (é ele que decide
 *  quando os tópicos ficam obrigatórios). O dicionário do sub-lote 2 espelha
 *  este texto; se alguém trocar um dos dois sem o outro, este teste fica vermelho. */
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
  viagem: 'Planejo realizar uma viagem internacional em breve',
  intercambio: 'Nenhuma das alternativas',
  alvo_6_meses: 'conduzir uma reunião de 30 minutos em inglês',
  onde_trava: ['Falar sem traduzir na cabeça'],
  correcao_preferida: 'Na hora, sem interromper o assunto',
  tempo_diario: '20 min por dia',
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
  filmes_series: 'sim',
  filmes_series_detalhe: 'comédia e true crime',
  musicas: 'não',
}

const V2_ROTINA = {
  blocos: { seg: ['Noite'], qua: ['Manhã'], sáb: ['Tarde'] },
  imersao: 'Ouvir músicas em inglês (legenda em inglês)',
}

const V2_ADULT = {
  historia: V2_HISTORIA,
  objetivos: V2_OBJETIVOS_ADULT,
  interesses: V2_INTERESSES,
  rotina: V2_ROTINA,
}
const V2_CHILD = {
  historia: V2_HISTORIA,
  objetivos: V2_OBJETIVOS_CHILD,
  interesses: V2_INTERESSES,
  rotina: V2_ROTINA,
}

/** Fixture v1 (a MESMA forma de tests/briefing.test.ts) — usada só para provar
 *  que um rascunho carimbado 1 continua submetendo pela regra antiga. */
const V1_ETAPAS = {
  historia: { cidade_vida: 'Cuiabá', facil_dificil: 'listening fácil; speaking difícil', contato: 'escola + jogos' },
  objetivos: { finalidades: 'viagem', topicos_profissionais: ['eng', 'obras'], viagem: 'planejo', intercambio: 'nenhuma' },
  interesses: { hobbies: ['Viajar', 'Jogar'], leitura: 'blogs', filmes_series: 'séries', musicas: 'sim, rock' },
  rotina: { blocos: { seg: ['noite'] }, imersao: 'filmes com legenda' },
}

/** 6 respostas AC + 6 AE (gabarito do Doc) → par AC+AE máximo → convergente. */
const KOLB_CONVERGENTE = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

/** Cópia sem uma chave — simula o campo que a pessoa deixou em branco. */
function sem<T extends Record<string, unknown>>(obj: T, chave: keyof T): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...obj }
  delete copia[chave as string]
  return copia
}

async function novoAlunoComLogin(tipo: 'adult' | 'child' = 'adult') {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno Briefing v2')
  await sql`update students set profile_id = ${userId}, student_type = ${tipo} where id = ${c.studentId}`
  const client = await clientAs(userId, 'student')
  return { ...c, userId, client }
}

/**
 * Aluno com a linha de briefing já CARIMBADA 2. Desde o flip do default
 * (migration 20260728000200) a linha nasceria 2 sozinha; o carimbo explícito
 * fica porque estes casos criam a linha ANTES do primeiro rascunho e o que se
 * quer provar aqui é a regra do v2, não o default. Quem prova o default é o
 * teste da rota produtiva, logo abaixo.
 */
async function alunoV2(tipo: 'adult' | 'child' = 'adult') {
  const cenario = await novoAlunoComLogin(tipo)
  await sql`
    insert into briefings (student_id, schema_version) values (${cenario.studentId}, 2)
    on conflict (student_id) do update set schema_version = 2`
  return cenario
}

async function adminClient(nome = 'Admin Briefing v2') {
  const userId = await createAuthUser(sql, 'admin', nome)
  return { userId, client: await clientAs(userId, 'admin') }
}

/** Salva `answers` como rascunho v2, tenta enviar e devolve a MENSAGEM da recusa.
 *  Falha o teste se o envio passar — é o formato dos casos negativos em lote. */
async function recusaEnvio(
  answers: Record<string, unknown>,
  tipo: 'adult' | 'child' = 'adult',
): Promise<string> {
  const { client } = await alunoV2(tipo)
  await client.rpc('save_briefing_draft', { p_answers: answers, p_kolb_answers: KOLB_CONVERGENTE })
  const { error } = await client.rpc('submit_briefing')
  expect(error, `esperava recusa em ${JSON.stringify(answers).slice(0, 120)}`).not.toBeNull()
  return error!.message
}

/** Deixa o aluno com briefing v2 ENVIADO e devolve o cenário. */
async function enviaV2(tipo: 'adult' | 'child' = 'adult') {
  const cenario = await alunoV2(tipo)
  await cenario.client.rpc('save_briefing_draft', {
    p_answers: tipo === 'child' ? V2_CHILD : V2_ADULT,
    p_kolb_answers: KOLB_CONVERGENTE,
  })
  const { error } = await cenario.client.rpc('submit_briefing')
  expect(error).toBeNull()
  return cenario
}

// ---------------------------------------------------------------------------
describe('schema_version — a linha carrega a regra sob a qual nasceu', () => {
  // O flip do default (20260728000200) veio JUNTO com as telas v2: a partir dele
  // o aluno que abre o portal hoje responde o questionário novo, e é a linha que
  // carrega essa régua.
  it('briefing novo nasce 2 depois do flip do default', async () => {
    const { client, studentId } = await novoAlunoComLogin()
    await client.rpc('save_briefing_draft', { p_answers: { historia: V2_HISTORIA } })
    const [b] = await sql`select schema_version from briefings where student_id = ${studentId}`
    expect(b.schema_version).toBe(2)
  })

  // Achado 9 do Sol na fundação: até aqui o v2 só era exercitado em linha
  // carimbada À MÃO pela fixture. Este caso percorre a ROTA PRODUTIVA inteira —
  // aluno novo, rascunho pela RPC do portal, envio — sem nenhum UPDATE de teste
  // no schema_version. Se o flip não estivesse aplicado, a linha nasceria 1 e o
  // envio v2 passaria pela régua errada.
  it('rota produtiva: aluno novo rascunha, a linha nasce 2 e o envio v2 passa', async () => {
    const { client, studentId } = await novoAlunoComLogin('adult')

    // etapa a etapa, como o portal salva
    await client.rpc('save_briefing_draft', { p_answers: { historia: V2_HISTORIA } })
    const [nasceu] = await sql`select schema_version, status from briefings where student_id = ${studentId}`
    expect(nasceu.schema_version).toBe(2)
    expect(nasceu.status).toBe('draft')

    await client.rpc('save_briefing_draft', { p_answers: { objetivos: V2_OBJETIVOS_ADULT } })
    await client.rpc('save_briefing_draft', { p_answers: { interesses: V2_INTERESSES } })
    await client.rpc('save_briefing_draft', {
      p_answers: { rotina: V2_ROTINA },
      p_kolb_answers: KOLB_CONVERGENTE,
    })

    const { data: estilo, error } = await client.rpc('submit_briefing')
    expect(error).toBeNull()
    expect(estilo).toBe('convergente')

    const [b] = await sql`select status, schema_version from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    expect(b.schema_version).toBe(2)
  })

  it('rascunho carimbado 1 (começado na tela antiga) ainda submete pela regra v1', async () => {
    const { client, studentId } = await novoAlunoComLogin()
    // linha escrita como dona da tabela, simulando o que já existia antes da migration
    await sql`
      insert into briefings (student_id, answers, kolb_answers, schema_version)
      values (${studentId}, ${sql.json(V1_ETAPAS)}, ${sql.json(KOLB_CONVERGENTE)}, 1)`

    const { data: estilo, error } = await client.rpc('submit_briefing')
    expect(error).toBeNull()
    expect(estilo).toBe('convergente')

    // e o v1 continua recusando pela regra v1 (etapa inteira vazia), não pela v2
    const outro = await novoAlunoComLogin()
    await sql`
      insert into briefings (student_id, answers, kolb_answers, schema_version)
      values (${outro.studentId},
              ${sql.json({ historia: V1_ETAPAS.historia, objetivos: V1_ETAPAS.objetivos, interesses: V1_ETAPAS.interesses })},
              ${sql.json(KOLB_CONVERGENTE)}, 1)`
    const semRotina = await outro.client.rpc('submit_briefing')
    expect(semRotina.error?.message).toContain('etapa obrigatória sem resposta: rotina')
  })
})

// ---------------------------------------------------------------------------
describe('envio v2 — obrigatórias por RAMO (Lei 3)', () => {
  it('adulto completo passa e o Kolb continua sendo calculado no banco', async () => {
    const { client, studentId } = await alunoV2()
    await client.rpc('save_briefing_draft', { p_answers: V2_ADULT, p_kolb_answers: KOLB_CONVERGENTE })
    const { data: estilo, error } = await client.rpc('submit_briefing')
    expect(error).toBeNull()
    expect(estilo).toBe('convergente')

    const [b] = await sql`select status, schema_version, kolb_style, kolb_scores from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    expect(b.schema_version).toBe(2)
    expect(b.kolb_style).toBe('convergente')
    expect(b.kolb_scores).toEqual({ CE: 0, RO: 0, AC: 6, AE: 6 })
  })

  it('adulto sem "finalidade mais importante" recusa; e a principal precisa estar entre as marcadas', async () => {
    const semPrincipal = await alunoV2()
    await semPrincipal.client.rpc('save_briefing_draft', {
      p_answers: { ...V2_ADULT, objetivos: sem(V2_OBJETIVOS_ADULT, 'finalidade_principal') },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r1 = await semPrincipal.client.rpc('submit_briefing')
    expect(r1.error?.message).toContain('MAIS importante')

    const foraDaLista = await alunoV2()
    await foraDaLista.client.rpc('save_briefing_draft', {
      p_answers: {
        ...V2_ADULT,
        objetivos: { ...V2_OBJETIVOS_ADULT, finalidade_principal: 'Imigração' },
      },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r2 = await foraDaLista.client.rpc('submit_briefing')
    expect(r2.error?.message).toContain('precisa estar entre as finalidades marcadas')
  })

  it('criança completa passa SEM as perguntas de adulto; sem temperamento recusa', async () => {
    const { client, studentId } = await alunoV2('child')
    // o objetivo da criança não tem finalidades/alvo_6_meses/tempo_diario…
    expect(Object.keys(V2_OBJETIVOS_CHILD)).not.toContain('finalidades')
    await client.rpc('save_briefing_draft', { p_answers: V2_CHILD, p_kolb_answers: KOLB_CONVERGENTE })
    const { data: estilo, error } = await client.rpc('submit_briefing')
    expect(error).toBeNull()
    expect(estilo).toBe('convergente')
    const [b] = await sql`select status from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')

    const semTemperamento = await alunoV2('child')
    await semTemperamento.client.rpc('save_briefing_draft', {
      p_answers: { ...V2_CHILD, objetivos: sem(V2_OBJETIVOS_CHILD, 'temperamento') },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r = await semTemperamento.client.rpc('submit_briefing')
    expect(r.error?.message).toContain('pessoas novas')
  })

  it('tópicos profissionais só são exigidos de quem marcou a finalidade de trabalho', async () => {
    // o rótulo literal é o do BANCO — drift entre SQL e teste fica vermelho aqui
    const [f] = await sql`select public.briefing_v2_finalidade_profissional() as label`
    expect(f.label).toBe(FINALIDADE_PROFISSIONAL)

    const comTrabalho = await alunoV2()
    await comTrabalho.client.rpc('save_briefing_draft', {
      p_answers: {
        ...V2_ADULT,
        objetivos: { ...V2_OBJETIVOS_ADULT, topicos_profissionais: ['reuniões', '  '] },
      },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r1 = await comTrabalho.client.rpc('submit_briefing')
    expect(r1.error?.message).toContain('3 tópicos da sua vida profissional')

    const semTrabalho = await alunoV2()
    await semTrabalho.client.rpc('save_briefing_draft', {
      p_answers: {
        ...V2_ADULT,
        objetivos: {
          ...sem(V2_OBJETIVOS_ADULT, 'topicos_profissionais'),
          finalidades: ['Viagens'],
          finalidade_principal: 'Viagens',
        },
      },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r2 = await semTrabalho.client.rpc('submit_briefing')
    expect(r2.error).toBeNull()
  })

  it('sim-não com detalhe: "sim" sem detalhe recusa, "não" sem detalhe passa', async () => {
    const semDetalhe = await alunoV2()
    await semDetalhe.client.rpc('save_briefing_draft', {
      p_answers: {
        ...V2_ADULT,
        interesses: { ...V2_INTERESSES, leitura: 'sim', leitura_detalhe: '   ' },
      },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r1 = await semDetalhe.client.rpc('submit_briefing')
    expect(r1.error?.message).toContain('leitura')

    const naoLe = await alunoV2()
    await naoLe.client.rpc('save_briefing_draft', {
      p_answers: {
        ...V2_ADULT,
        interesses: { ...sem(V2_INTERESSES, 'leitura_detalhe'), leitura: 'não' },
      },
      p_kolb_answers: KOLB_CONVERGENTE,
    })
    const r2 = await naoLe.client.rpc('submit_briefing')
    expect(r2.error).toBeNull()
  })

  it('cada obrigatória em falta recusa NOMEANDO a etapa (matriz negativa)', async () => {
    expect(await recusaEnvio({ ...V2_ADULT, historia: sem(V2_HISTORIA, 'cidade_vida') }))
      .toContain('em que cidade você vive')
    expect(await recusaEnvio({ ...V2_ADULT, historia: { ...V2_HISTORIA, contato: [] } }))
      .toContain('forma de contato')
    expect(await recusaEnvio({ ...V2_ADULT, interesses: { ...V2_INTERESSES, hobbies: V2_INTERESSES.hobbies.slice(0, 5) } }))
      .toContain('ao menos 6 hobbies')
    expect(await recusaEnvio({ ...V2_ADULT, rotina: { ...V2_ROTINA, blocos: {} } }))
      .toContain('ao menos um horário livre')
    expect(await recusaEnvio({ ...V2_CHILD, objetivos: sem(V2_OBJETIVOS_CHILD, 'favoritos_midia') }, 'child'))
      .toContain('youtubers favoritos')
    expect(await recusaEnvio({ ...V2_CHILD, objetivos: sem(V2_OBJETIVOS_CHILD, 'quem_acompanha') }, 'child'))
      .toContain('acompanha as tarefas em casa')
  })

  it('campo em branco não é "preenchido": tabulação e quebra de linha recusam como o vazio', async () => {
    // btrim() deixava passar — a régua agora é "sobrou algum caractere que não
    // seja whitespace?". A pessoa que aperta Tab e Enter no campo não respondeu.
    expect(await recusaEnvio({ ...V2_ADULT, historia: { ...V2_HISTORIA, facil: '\t\n' } }))
      .toContain('mais FÁCIL')
    expect(await recusaEnvio({ ...V2_ADULT, historia: { ...V2_HISTORIA, contato: ['\n', ' \t '] } }))
      .toContain('forma de contato')
  })

  it('resposta do TIPO errado conta como ausente, não como resposta', async () => {
    // sem o teste de tipo, `->>` serializava qualquer coisa: a cidade virava "123"
    // e seis números viravam seis hobbies.
    expect(await recusaEnvio({ ...V2_ADULT, historia: { ...V2_HISTORIA, cidade_vida: 123 } }))
      .toContain('em que cidade você vive')
    expect(await recusaEnvio({ ...V2_ADULT, historia: { ...V2_HISTORIA, cidade_vida: { nome: 'Cuiabá' } } }))
      .toContain('em que cidade você vive')
    expect(await recusaEnvio({ ...V2_ADULT, interesses: { ...V2_INTERESSES, hobbies: [1, 2, 3, 4, 5, 6] } }))
      .toContain('ao menos 6 hobbies')
  })

  it('mínimo conta itens DISTINTOS: repetir a mesma opção não preenche a lista', async () => {
    // 6 itens, 5 respostas — a duplicata escrita com espaço em volta ainda é a mesma.
    expect(await recusaEnvio({
      ...V2_ADULT,
      interesses: { ...V2_INTERESSES, hobbies: [...V2_INTERESSES.hobbies.slice(0, 5), `  ${V2_INTERESSES.hobbies[0]}  `] },
    })).toContain('ao menos 6 hobbies')

    // e o mesmo vale para os 3 tópicos profissionais
    expect(await recusaEnvio({
      ...V2_ADULT,
      objetivos: { ...V2_OBJETIVOS_ADULT, topicos_profissionais: ['reuniões', 'reuniões', ' reuniões '] },
    })).toContain('3 tópicos da sua vida profissional')
  })

  it('schema_version só aceita 1 ou 2 (CHECK)', async () => {
    const { studentId } = await novoAlunoComLogin()
    await expect(
      sql`insert into briefings (student_id, schema_version) values (${studentId}, 0)`,
    ).rejects.toThrow(/briefings_schema_version_check/)
    await expect(
      sql`insert into briefings (student_id, schema_version) values (${studentId}, 3)`,
    ).rejects.toThrow(/briefings_schema_version_check/)
  })
})

// ---------------------------------------------------------------------------
describe('correção pós-envio (admin_revise_briefing + briefing_revisions)', () => {
  it('corrige por CHAVE, deixa de/para + snapshot e audita', async () => {
    const { studentId, userId: alunoUserId } = await enviaV2()
    const admin = await adminClient()

    // antes da correção, quem escreveu por último foi o próprio aluno
    const [antes] = await sql`select filled_by from briefings where student_id = ${studentId}`
    expect(antes.filled_by).toBe(alunoUserId)

    const { error } = await admin.client.rpc('admin_revise_briefing', {
      p_student: studentId,
      p_patch: {
        historia: { cidade_vida: 'Lisboa' },
        objetivos: { alvo_6_meses: 'apresentar o roadmap trimestral em inglês' },
      },
      p_reason: 'aluna mudou de país e corrigiu o alvo por telefone',
    })
    expect(error).toBeNull()

    const [b] = await sql`select answers, status, filled_by from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    // "quem escreveu por último" passa a ser a admin que corrigiu
    expect(b.filled_by).toBe(admin.userId)
    expect(b.answers.historia.cidade_vida).toBe('Lisboa')
    expect(b.answers.objetivos.alvo_6_meses).toBe('apresentar o roadmap trimestral em inglês')
    // merge por CHAVE: o resto da seção continua de pé
    expect(b.answers.historia.facil).toBe(V2_HISTORIA.facil)
    expect(b.answers.historia.contato).toEqual(V2_HISTORIA.contato)
    expect(b.answers.objetivos.finalidade_principal).toBe(FINALIDADE_PROFISSIONAL)

    const [rev] = await sql`
      select actor, reason, changes, snapshot_before
      from briefing_revisions where student_id = ${studentId}`
    expect(rev.actor).toBe(admin.userId)
    expect(rev.reason).toContain('mudou de país')
    expect(rev.changes['historia.cidade_vida']).toEqual({ de: 'Cuiabá', para: 'Lisboa' })
    expect(rev.changes['objetivos.alvo_6_meses']).toEqual({
      de: V2_OBJETIVOS_ADULT.alvo_6_meses,
      para: 'apresentar o roadmap trimestral em inglês',
    })
    expect(rev.snapshot_before.historia.cidade_vida).toBe('Cuiabá')
    expect(rev.snapshot_before.objetivos.alvo_6_meses).toBe(V2_OBJETIVOS_ADULT.alvo_6_meses)

    // Lei 8
    const audit = await sql`
      select diff from audit_log
      where action = 'admin_revise_briefing' and entity_id = ${studentId}::text`
    expect(audit.length).toBe(1)
    expect(audit[0].diff.reason).toContain('mudou de país')

    // a admin LÊ o histórico pelo PostgREST
    const lida = await admin.client.from('briefing_revisions').select('reason').eq('student_id', studentId)
    expect(lida.data).toHaveLength(1)
  })

  it('recusa: rascunho, motivo vazio, Kolb/chave estranha e ator que não é admin', async () => {
    const admin = await adminClient('Admin Revise Recusa')

    // rascunho não se "revisa": edita-se direto
    const rascunho = await alunoV2()
    await rascunho.client.rpc('save_briefing_draft', { p_answers: V2_ADULT })
    const r1 = await admin.client.rpc('admin_revise_briefing', {
      p_student: rascunho.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: 'tentativa',
    })
    expect(r1.error?.message).toContain('ainda é rascunho')

    const enviado = await enviaV2()

    // motivo vazio
    const r2 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: '   ',
    })
    expect(r2.error?.message).toContain('motivo')

    // Kolb é intocável
    const r3 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { kolb_answers: { q1: 'B' } },
      p_reason: 'quis mudar o estilo',
    })
    expect(r3.error?.message).toContain('kolb_answers')

    // chave de topo fora das 5 seções
    const r4 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { lixo: { x: 1 } },
      p_reason: 'chave inventada',
    })
    expect(r4.error?.message).toContain('lixo')

    // professora e aluno não revisam
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Revise')
    const prof = await clientAs(profUser, 'teacher')
    const r5 = await prof.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: 'a professora quis corrigir',
    })
    expect(r5.error?.message).toContain('apenas admin')

    const r6 = await enviado.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: 'o aluno quis corrigir',
    })
    expect(r6.error?.message).toContain('apenas admin')

    // nenhuma das recusas deixou linha nem mexeu no briefing
    const revs = await sql`select 1 from briefing_revisions where student_id = ${enviado.studentId}`
    expect(revs.length).toBe(0)
    const [b] = await sql`select answers from briefings where student_id = ${enviado.studentId}`
    expect(b.answers.historia.cidade_vida).toBe('Cuiabá')
  })

  it('briefing_revisions é append-only: UPDATE/DELETE morrem no gatilho e authenticated não insere', async () => {
    const { studentId } = await enviaV2()
    const admin = await adminClient('Admin Revise Imutavel')
    await admin.client.rpc('admin_revise_briefing', {
      p_student: studentId,
      p_patch: { livre: { obs: 'prefere aula de manhã' } },
      p_reason: 'observação colhida na aula experimental',
    })
    const [rev] = await sql`select id from briefing_revisions where student_id = ${studentId}`

    // dona da tabela também não passa (o gatilho pega antes do privilégio)
    await expect(
      sql`update briefing_revisions set reason = 'outro' where id = ${rev.id}`,
    ).rejects.toThrow(/append-only/)
    await expect(
      sql`delete from briefing_revisions where id = ${rev.id}`,
    ).rejects.toThrow(/append-only/)
    // TRUNCATE é a porta que o REVOKE não fecha para a dona da tabela
    await expect(sql`truncate briefing_revisions`).rejects.toThrow(/append-only/)

    // authenticated não escreve direto — a porta é a RPC
    const inserido = await admin.client.from('briefing_revisions').insert({
      student_id: studentId,
      actor: admin.userId,
      reason: 'por fora da RPC',
      changes: {},
      snapshot_before: {},
    })
    expect(inserido.error?.code).toBe('42501')

    // a linha original continua lá, intacta
    const [ainda] = await sql`select reason from briefing_revisions where id = ${rev.id}`
    expect(ainda.reason).toContain('aula experimental')
  })

  it('a trilha de correção é SÓ da admin: aluno e professora não leem nem inserem', async () => {
    const enviado = await enviaV2()
    const admin = await adminClient('Admin Revise RLS')
    const { error } = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: 'Porto' } },
      p_reason: 'aluna mudou de cidade',
    })
    expect(error).toBeNull()
    // a linha EXISTE (visão privilegiada) — o que segue é RLS, não ausência de dado
    const todas = await sql`select id from briefing_revisions where student_id = ${enviado.studentId}`
    expect(todas.length).toBe(1)

    const profUser = await createAuthUser(sql, 'teacher', 'Prof Revise RLS')
    const prof = await clientAs(profUser, 'teacher')
    const papeis = [
      ['aluno (dono do briefing)', enviado.client],
      ['professora', prof],
    ] as const

    for (const [papel, cliente] of papeis) {
      const lida = await cliente
        .from('briefing_revisions')
        .select('id, reason')
        .eq('student_id', enviado.studentId)
      expect(lida.data ?? [], `${papel} não lê a trilha`).toHaveLength(0)

      const ins = await cliente.from('briefing_revisions').insert({
        student_id: enviado.studentId,
        actor: enviado.userId,
        reason: 'por fora da RPC',
        changes: {},
        snapshot_before: {},
      })
      expect(ins.error?.code, `${papel} não insere direto`).toBe('42501')
    }

    // e nenhuma tentativa deixou linha nova
    const depois = await sql`select id from briefing_revisions where student_id = ${enviado.studentId}`
    expect(depois.length).toBe(1)
  })

  it('revisão fantasma não existe: valor igual ao atual (ou seção vazia) recusa sem trilha', async () => {
    const enviado = await enviaV2()
    const admin = await adminClient('Admin Revise Fantasma')

    const r1 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: {} },
      p_reason: 'abriu e fechou a tela',
    })
    expect(r1.error?.message).toContain('iguais aos atuais')

    const r2 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: V2_HISTORIA.cidade_vida } },
      p_reason: 'reenviou o mesmo valor',
    })
    expect(r2.error?.message).toContain('iguais aos atuais')

    expect((await sql`select 1 from briefing_revisions where student_id = ${enviado.studentId}`).length).toBe(0)

    // patch misto: SÓ a chave que mudou de fato entra no de/para
    const r3 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: V2_HISTORIA.cidade_vida, facil: 'ouvir podcast sem legenda' } },
      p_reason: 'corrigiu só o que estava errado',
    })
    expect(r3.error).toBeNull()
    expect(Object.keys(r3.data as Record<string, unknown>)).toEqual(['historia.facil'])

    const revs = await sql`select changes from briefing_revisions where student_id = ${enviado.studentId}`
    expect(revs.length).toBe(1)
    expect(Object.keys(revs[0].changes)).toEqual(['historia.facil'])
  })

  it('a correção não é porta de fundo: patch que deixaria o briefing inválido é recusado INTEIRO', async () => {
    const enviado = await enviaV2()
    const admin = await adminClient('Admin Revise Invalido')

    // array virando objeto — os 6 hobbies sumiriam
    const r1 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { interesses: { hobbies: { x: 1 } } },
      p_reason: 'colou o campo errado',
    })
    expect(r1.error?.message).toContain('deixaria o briefing inválido')
    expect(r1.error?.message).toContain('6 hobbies')

    // obrigatória virando espaço
    const r2 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: '  ' } },
      p_reason: 'quis apagar a cidade',
    })
    expect(r2.error?.message).toContain('deixaria o briefing inválido')
    expect(r2.error?.message).toContain('em que cidade você vive')

    // null não apaga resposta: revisão define valor novo
    const r3 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { historia: { cidade_vida: null } },
      p_reason: 'mandou null',
    })
    expect(r3.error?.message).toContain('não apaga a resposta')

    // número/booleano crus não são resposta
    const r4 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { objetivos: { tempo_diario: 20 } },
      p_reason: 'mandou número',
    })
    expect(r4.error?.message).toContain('texto, lista ou objeto')

    const r5 = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { interesses: { leitura: true } },
      p_reason: 'mandou booleano',
    })
    expect(r5.error?.message).toContain('texto, lista ou objeto')

    // nada gravado, nenhuma trilha
    expect((await sql`select 1 from briefing_revisions where student_id = ${enviado.studentId}`).length).toBe(0)
    const [b] = await sql`select answers from briefings where student_id = ${enviado.studentId}`
    expect(b.answers.historia.cidade_vida).toBe('Cuiabá')
    expect(b.answers.interesses.hobbies).toEqual(V2_INTERESSES.hobbies)
    expect(b.answers.objetivos.tempo_diario).toBe(V2_OBJETIVOS_ADULT.tempo_diario)

    // e a revisão LEGÍTIMA continua passando depois de todas as recusas
    const ok = await admin.client.rpc('admin_revise_briefing', {
      p_student: enviado.studentId,
      p_patch: { interesses: { hobbies: [...V2_INTERESSES.hobbies, 'Fotografar'] } },
      p_reason: 'aluna lembrou de mais um hobby',
    })
    expect(ok.error).toBeNull()
    const [depois] = await sql`select answers from briefings where student_id = ${enviado.studentId}`
    expect(depois.answers.interesses.hobbies).toHaveLength(7)
  })

  it('correção de linha v1 continua valendo pela régua v1 (seção presente não fica vazia)', async () => {
    // linha carimbada 1: a revisão NÃO pode cobrar dela as obrigatórias do v2
    const aluno = await novoAlunoComLogin()
    await sql`
      insert into briefings (student_id, answers, kolb_answers, schema_version)
      values (${aluno.studentId}, ${sql.json(V1_ETAPAS)}, ${sql.json(KOLB_CONVERGENTE)}, 1)`
    expect((await aluno.client.rpc('submit_briefing')).error).toBeNull()

    const admin = await adminClient('Admin Revise V1')
    const { error } = await admin.client.rpc('admin_revise_briefing', {
      p_student: aluno.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: 'correção numa linha antiga',
    })
    expect(error).toBeNull()
    const [b] = await sql`select answers from briefings where student_id = ${aluno.studentId}`
    expect(b.answers.historia.cidade_vida).toBe('Lisboa')
    // v1 não tem cidade_vida obrigatória por CAMPO — só a etapa não pode esvaziar
    expect(b.answers.historia.facil_dificil).toBe(V1_ETAPAS.historia.facil_dificil)
  })
})
