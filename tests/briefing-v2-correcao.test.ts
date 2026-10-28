// Briefing v2 · sub-lote 3 — a CORREÇÃO pós-envio pela fronteira real (a server
// action, com o banco de verdade do outro lado) e as duas leituras puras que a
// ficha e o painel da professora passaram a usar.
//
// O que este arquivo trava:
//  · a action manda para a RPC SÓ o que mudou — o formulário reenvia a etapa
//    inteira, e sem o diff toda resposta intocada entraria no histórico como se
//    tivesse sido corrigida;
//  · a recusa do BANCO chega à tela com a frase do banco (Lei 3): a action não
//    inventa validação própria de "nada mudou" nem de motivo;
//  · `resumoDoBriefing` lê v1 (texto) e v2 (lista, e o ramo criança) — era a
//    leitura literal `typeof a.objetivos.finalidades === 'string'` do painel da
//    professora, que com dado v2 simplesmente não desenhava nada.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

// A ponte é declarada ANTES dos mocks porque `vi.mock` sobe para o topo do
// arquivo — mesmo truque do c17.
const ponte = vi.hoisted(() => {
  class Redirecionou extends Error {
    url: string
    constructor(url: string) {
      super(`redirect(${url})`)
      this.name = 'Redirecionou'
      this.url = url
    }
  }
  return { Redirecionou, cliente: null as SupabaseClient | null }
})

// `server-only` lança fora do bundle de servidor do Next, e a cadeia
// `actions.ts → lib/auth/admin.ts` o importa. Aqui é no-op: o que ele protege
// (a chave service_role não vazar para o cliente) é papel do bundler.
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new ponte.Redirecionou(url)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ponte.cliente,
}))

import { adminReviseBriefingAction } from '@/app/admin/alunos/actions'
import { montarPatchDeRevisao, resumoDoBriefing, textoDaResposta } from '@/lib/briefing/leitura'

let sql: Sql
let adminId: string
let adminReal: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  adminId = await createAuthUser(sql, 'admin', 'Admin Correção')
  adminReal = await clientAs(adminId, 'admin')
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

const FINALIDADE_PROFISSIONAL = 'Trabalho / carreira'

const V2_HISTORIA = {
  cidade_vida: 'Cuiabá',
  facil: 'entender o que ouço em série',
  dificil: 'falar sem travar no meio da frase',
  contato: ['Aulas particulares', 'Escola / curso em grupo'],
  experiencia_marcante: '',
}

const V2_ADULT = {
  historia: V2_HISTORIA,
  objetivos: {
    finalidades: [FINALIDADE_PROFISSIONAL, 'Viagens'],
    finalidade_principal: FINALIDADE_PROFISSIONAL,
    topicos_profissionais: ['reuniões', 'e-mails', 'apresentações'],
    alvo_6_meses: 'conduzir uma reunião de 30 minutos em inglês',
    onde_trava: ['Falar'],
    correcao_preferida: 'Na hora, sempre',
    tempo_diario: '20 min/dia',
    viagem: 'Planejo realizar uma viagem internacional em breve',
    intercambio: 'Nenhuma das alternativas',
  },
  interesses: {
    hobbies: ['Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Praticar esportes/exercícios'],
    leitura: 'sim',
    leitura_detalhe: 'fantasia e biografias',
    filmes_series: 'não',
    musicas: 'não',
  },
  rotina: {
    blocos: { seg: ['Noite'], qua: ['Manhã'] },
    imersao: 'Ouvir músicas em inglês (legenda em inglês)',
  },
}

const KOLB = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

/** Um aluno com briefing v2 JÁ ENVIADO (a correção só existe depois do envio). */
async function alunoComBriefingEnviado(): Promise<string> {
  const c = await createPrivateContract(sql)
  await sql`delete from briefings where student_id = ${c.studentId}`
  await sql`
    insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                           status, submitted_at, schema_version)
    values (${c.studentId}, ${sql.json(V2_ADULT)}, ${sql.json(KOLB)},
            ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
            'submitted', now(), 2)`
  return c.studentId
}

/**
 * A etapa 1 como o PAINEL a entrega: todos os campos da seção, pré-preenchidos
 * com o que está gravado (é o que `EtapaHistoriaV2` desenha), com a substituição
 * pedida por cima. Reproduzir o formulário inteiro é o ponto do teste — é assim
 * que a chave intocada chega à action.
 */
function formDaHistoria(troca: Partial<Record<string, string>>, motivo: string): FormData {
  const fd = new FormData()
  fd.append('student_id', troca.student_id ?? '')
  fd.append('secao', 'historia')
  fd.append('motivo', motivo)
  fd.append('cidade_vida', troca.cidade_vida ?? V2_HISTORIA.cidade_vida)
  fd.append('facil', troca.facil ?? V2_HISTORIA.facil)
  fd.append('dificil', troca.dificil ?? V2_HISTORIA.dificil)
  for (const c of V2_HISTORIA.contato) fd.append('contato', c)
  fd.append('experiencia_marcante', troca.experiencia_marcante ?? V2_HISTORIA.experiencia_marcante)
  return fd
}

/** Roda a ação e devolve o recado que ela pendurou na URL do `redirect`. */
async function recadoDe(acao: () => Promise<unknown>): Promise<{ url: string; msg: string }> {
  try {
    await acao()
  } catch (e) {
    if (e instanceof ponte.Redirecionou) {
      const u = new URL(e.url, 'http://bancada.local')
      return { url: e.url, msg: u.searchParams.get('msg') ?? '' }
    }
    throw e
  }
  throw new Error('a ação terminou sem redirecionar — ela deveria ter respondido algo')
}

type LinhaDeRevisao = { changes: Record<string, { de: unknown; para: unknown }>; reason: string }

async function revisoesDe(studentId: string): Promise<LinhaDeRevisao[]> {
  const linhas = await sql`
    select changes, reason from briefing_revisions
    where student_id = ${studentId} order by created_at`
  return linhas as unknown as LinhaDeRevisao[]
}

/* ========================================================================== */
/* A action, pela fronteira real                                               */
/* ========================================================================== */

describe('adminReviseBriefingAction — o patch leva SÓ o que mudou', () => {
  it('a etapa inteira volta do formulário, mas só a resposta trocada vira correção', async () => {
    const studentId = await alunoComBriefingEnviado()
    ponte.cliente = adminReal

    const { url, msg } = await recadoDe(() =>
      adminReviseBriefingAction(
        formDaHistoria(
          { student_id: studentId, cidade_vida: 'Lisboa' },
          'a aluna se mudou e corrigiu por telefone',
        ),
      ),
    )
    expect(msg, msg).toContain('Correção registrada')
    // a volta é a ABA do assunto, não o hub
    expect(url.startsWith(`/admin/alunos/${studentId}?aba=briefing&msg=`)).toBe(true)

    const revs = await revisoesDe(studentId)
    expect(revs).toHaveLength(1)
    // ↓ o coração do teste: `facil`, `dificil`, `contato` e `experiencia_marcante`
    //   vieram no formulário com o MESMO valor e não entraram no histórico.
    expect(Object.keys(revs[0].changes)).toEqual(['historia.cidade_vida'])
    expect(revs[0].changes['historia.cidade_vida']).toEqual({ de: 'Cuiabá', para: 'Lisboa' })
    expect(revs[0].reason).toContain('se mudou')

    // e o briefing gravado tem a correção com o RESTO da seção de pé
    const [b] = await sql`select answers, status from briefings where student_id = ${studentId}`
    expect(b.status).toBe('submitted')
    expect(b.answers.historia.cidade_vida).toBe('Lisboa')
    expect(b.answers.historia.facil).toBe(V2_HISTORIA.facil)
    expect(b.answers.historia.contato).toEqual(V2_HISTORIA.contato)
  })

  it('lista trocada entra inteira; e a chave que sumiu do formulário não é apagada', async () => {
    const studentId = await alunoComBriefingEnviado()
    ponte.cliente = adminReal

    const fd = formDaHistoria({ student_id: studentId }, 'a aluna lembrou do intercâmbio')
    fd.append('contato', 'Intercâmbio')

    const { msg } = await recadoDe(() => adminReviseBriefingAction(fd))
    expect(msg, msg).toContain('Correção registrada')
    const revs = await revisoesDe(studentId)
    expect(Object.keys(revs[0].changes)).toEqual(['historia.contato'])
    expect(revs[0].changes['historia.contato'].para).toEqual([
      ...V2_HISTORIA.contato,
      'Intercâmbio',
    ])
  })

  it('a recusa é do BANCO e chega com a frase dele: nada mudou · sem motivo · rascunho', async () => {
    const studentId = await alunoComBriefingEnviado()
    ponte.cliente = adminReal

    // 1. formulário reenviado sem tocar em nada
    const igual = await recadoDe(() =>
      adminReviseBriefingAction(formDaHistoria({ student_id: studentId }, 'abriu e fechou a tela')),
    )
    expect(igual.msg).toContain('Falha na correção')
    expect(igual.msg).toContain('iguais aos atuais')

    // 2. motivo vazio (o campo é `required` na tela; quem recusa de verdade é a RPC)
    const semMotivo = await recadoDe(() =>
      adminReviseBriefingAction(formDaHistoria({ student_id: studentId, cidade_vida: 'Lisboa' }, '   ')),
    )
    expect(semMotivo.msg).toContain('motivo')

    // 3. nenhuma das duas deixou trilha nem mexeu na resposta
    expect(await revisoesDe(studentId)).toHaveLength(0)
    const [b] = await sql`select answers from briefings where student_id = ${studentId}`
    expect(b.answers.historia.cidade_vida).toBe('Cuiabá')

    // 4. rascunho não se corrige — a mensagem manda para o caminho certo
    const rascunho = await createPrivateContract(sql)
    await sql`delete from briefings where student_id = ${rascunho.studentId}`
    await sql`
      insert into briefings (student_id, answers, schema_version)
      values (${rascunho.studentId}, ${sql.json(V2_ADULT)}, 2)`
    const emRascunho = await recadoDe(() =>
      adminReviseBriefingAction(
        formDaHistoria({ student_id: rascunho.studentId, cidade_vida: 'Lisboa' }, 'tentativa'),
      ),
    )
    expect(emRascunho.msg).toContain('ainda é rascunho')
  })

  it('sem etapa (formulário forjado) a ação nem chega ao banco', async () => {
    const studentId = await alunoComBriefingEnviado()
    // cliente que EXPLODE em qualquer leitura: se a guarda de etapa falhar, o
    // teste morre com o nome do que foi tocado em vez de passar calado.
    ponte.cliente = {
      auth: {
        getUser: async () => ({
          data: { user: { id: adminId, app_metadata: { role: 'admin' } } },
          error: null,
        }),
      },
      rpc: (nome: string) => {
        throw new Error(`a correção sem etapa chamou rpc:${nome}`)
      },
      from: (tabela: string) => {
        throw new Error(`a correção sem etapa leu from:${tabela}`)
      },
    } as unknown as SupabaseClient

    const fd = new FormData()
    fd.append('student_id', studentId)
    fd.append('secao', 'kolb_answers')
    fd.append('motivo', 'quis mudar o estilo')
    const { msg } = await recadoDe(() => adminReviseBriefingAction(fd))
    expect(msg).toContain('Correção sem etapa')
  })
})

/* ========================================================================== */
/* As leituras puras                                                           */
/* ========================================================================== */

describe('montarPatchDeRevisao — o diff que a action manda', () => {
  it('ignora o que não mudou, inclui o que mudou e não confunde vazio com ausência', () => {
    const atual = { cidade_vida: 'Cuiabá', contato: ['Aulas particulares'], obs: 'nada' }
    const novo = { cidade_vida: 'Lisboa', contato: ['Aulas particulares'], obs: 'nada' }
    expect(montarPatchDeRevisao(atual, novo)).toEqual({ cidade_vida: 'Lisboa' })

    // campo opcional que a tela devolve como "" e que NUNCA existiu no jsonb:
    // não é correção nenhuma (senão toda abertura do painel viraria histórico).
    expect(montarPatchDeRevisao({}, { experiencia_marcante: '' })).toEqual({})
    // …mas APAGAR uma resposta que existia é uma mudança de verdade
    expect(montarPatchDeRevisao({ experiencia_marcante: 'x' }, { experiencia_marcante: '' })).toEqual({
      experiencia_marcante: '',
    })
    // lista: a ordem e o conteúdo contam
    expect(montarPatchDeRevisao({ hobbies: ['Ler'] }, { hobbies: ['Ler', 'Jogar'] })).toEqual({
      hobbies: ['Ler', 'Jogar'],
    })
    expect(montarPatchDeRevisao({ hobbies: ['Ler'] }, { hobbies: ['Ler'] })).toEqual({})
    // seção que ainda não existe no jsonb: tudo o que veio preenchido é correção
    expect(montarPatchDeRevisao(undefined, { obs: 'algo' })).toEqual({ obs: 'algo' })
  })
})

describe('resumoDoBriefing — o painel da professora lê as DUAS versões', () => {
  const V1 = {
    interesses: { hobbies: ['Viajar', 'Jogar'], leitura: 'blogs' },
    objetivos: { finalidades: 'viagem e trabalho', topicos_profissionais: 'reuniões' },
  }

  it('v1: finalidades é TEXTO', () => {
    expect(resumoDoBriefing(V1)).toEqual({
      hobbies: ['Viajar', 'Jogar'],
      finalidades: 'viagem e trabalho',
    })
  })

  it('v2 adulto: finalidades é LISTA e sai com o separador da casa', () => {
    const r = resumoDoBriefing(V2_ADULT)
    expect(r.finalidades).toBe(`${FINALIDADE_PROFISSIONAL} · Viagens`)
    // hobbies têm teto de 6 no cartão (a mesma régua de antes)
    expect(r.hobbies).toHaveLength(6)
  })

  it('v2 criança: a pergunta tem OUTRA chave, e o cartão continua dizendo algo', () => {
    const r = resumoDoBriefing({
      interesses: { hobbies: ['Jogar'] },
      objetivos: { para_que_ingles: ['Escola / provas', 'Jogos e vídeos'], temas_escola: 'ciências' },
    })
    expect(r.finalidades).toBe('Escola / provas · Jogos e vídeos')
  })

  it('briefing ausente ou torto não derruba a página', () => {
    expect(resumoDoBriefing(null)).toEqual({ hobbies: [], finalidades: '' })
    expect(resumoDoBriefing({ interesses: 'texto solto' })).toEqual({ hobbies: [], finalidades: '' })
    // nenhum ramo cai em JSON.stringify / [object Object]
    expect(textoDaResposta({ a: ['x', 'y'] })).toBe('a: x · y')
    expect(textoDaResposta([{ a: 1 }])).toBe('a: 1')
  })
})
