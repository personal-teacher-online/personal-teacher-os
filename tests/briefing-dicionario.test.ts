// Briefing v2 — o DICIONÁRIO (src/lib/briefing/schema.ts) contra o BANCO.
//
// O dicionário é espelho, não fonte: quem decide o que é obrigatório é
// `_briefing_validate_v2` (Lei 3). Espelho que mente é pior que espelho nenhum —
// a tela marcaria a etapa como feita, deixaria a pessoa chegar no fim e o envio
// recusaria sem ela entender por quê. Estes testes travam o drift nos dois
// sentidos (achado 14 do Sol na fundação):
//   (a) toda chave que o dicionário marca `obrigatoria` REALMENTE recusa o envio
//       quando falta — provado chave a chave, nos dois ramos;
//   (b) um envio montado SÓ com as chaves do dicionário PASSA — ou seja, o banco
//       não cobra nada que o dicionário não conheça;
//   (c) o rótulo da finalidade profissional é o mesmo texto dos dois lados.
// E, no fim, a unidade do ÚNICO montador (`parseBriefingForm`): FormData da tela
// → as chaves literais do v2.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import {
  DICIONARIO_BRIEFING,
  FINALIDADE_PROFISSIONAL,
  IMERSAO_OPCOES,
  INTERCAMBIO_OPCOES,
  VIAGEM_OPCOES,
  chavesObrigatorias,
  entradasDaSecao,
  type SecaoBriefing,
  type TipoAluno,
} from '@/lib/briefing/schema'
import { parseBriefingForm } from '@/lib/briefing/parse'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(async () => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

const SECOES: SecaoBriefing[] = ['historia', 'objetivos', 'interesses', 'rotina', 'livre']

/** 6 respostas AC + 6 AE (gabarito do Doc) → convergente. */
const KOLB_CONVERGENTE = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

const HOBBIES_SEIS = [
  'Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Praticar esportes/exercícios',
]

/**
 * Uma resposta VÁLIDA por chave do dicionário v2. É a peça que faz (a) e (b)
 * serem dirigidos por dados: as respostas são montadas iterando o dicionário, e
 * chave nova sem valor aqui deixa o teste vermelho antes de chegar no banco.
 */
const VALOR_V2: Record<string, unknown> = {
  // historia
  cidade_vida: 'Cuiabá',
  facil: 'entender o que ouço em série',
  dificil: 'falar sem travar no meio da frase',
  contato: ['Aulas particulares', 'Escola / curso em grupo'],
  experiencia_marcante: 'um mês de férias em Orlando, em 2019',
  // objetivos (adulto)
  finalidades: [FINALIDADE_PROFISSIONAL, 'Viagens'],
  finalidade_principal: FINALIDADE_PROFISSIONAL,
  topicos_profissionais: ['reuniões', 'e-mails', 'apresentações'],
  alvo_6_meses: 'conduzir uma reunião de 30 minutos em inglês',
  onde_trava: ['Falar', 'Entender de ouvido'],
  correcao_preferida: 'Na hora, sempre',
  tempo_diario: '20 min/dia',
  viagem: VIAGEM_OPCOES[1],
  intercambio: INTERCAMBIO_OPCOES[2],
  // objetivos (criança)
  para_que_ingles: ['Escola / provas', 'Jogos e vídeos'],
  temas_escola: 'ciências e artes',
  favoritos_midia: 'Minecraft e desenhos da Disney',
  quem_acompanha: 'a mãe, todo dia depois do jantar',
  temperamento: 'tímido no começo, solta depois de uns minutos',
  // interesses
  hobbies: HOBBIES_SEIS,
  leitura: 'sim',
  leitura_detalhe: 'fantasia e biografias',
  filmes_series: 'sim',
  filmes_series_detalhe: 'comédia e true crime',
  musicas: 'não',
  musicas_detalhe: '',
  // rotina
  blocos: { seg: ['Noite'], qua: ['Manhã'] },
  imersao: IMERSAO_OPCOES[1],
  // livre (opcionais por desenho)
  obs: 'prefiro aula de manhã',
  apoio: 'tenho TDAH — funciono melhor com blocos curtos',
}

/** Todas as chaves do dicionário que valem no v2 para este ramo. */
function chavesV2(secao: SecaoBriefing, ramo: TipoAluno): string[] {
  return entradasDaSecao(secao, ramo, 2).map((e) => e.chave)
}

/** `answers` completo montado SÓ a partir do dicionário (opcionalmente sem uma chave). */
function respostasDoDicionario(ramo: TipoAluno, semEsta?: string): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const secao of SECOES) {
    const bloco: Record<string, unknown> = {}
    for (const chave of chavesV2(secao, ramo)) {
      if (chave === semEsta) continue
      bloco[chave] = VALOR_V2[chave]
    }
    if (Object.keys(bloco).length > 0) answers[secao] = bloco
  }
  return answers
}

async function alunoV2(ramo: TipoAluno) {
  const c = await createPrivateContract(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno Dicionário')
  await sql`update students set profile_id = ${userId}, student_type = ${ramo} where id = ${c.studentId}`
  const client = await clientAs(userId, 'student')
  return { ...c, userId, client }
}

/** Rascunha e envia; devolve o erro (null quando passou). */
async function envia(ramo: TipoAluno, answers: Record<string, unknown>): Promise<string | null> {
  const { client } = await alunoV2(ramo)
  await client.rpc('save_briefing_draft', { p_answers: answers, p_kolb_answers: KOLB_CONVERGENTE })
  const { error } = await client.rpc('submit_briefing')
  return error?.message ?? null
}

// ---------------------------------------------------------------------------
// Bancada Windows (01/09/2026): o caso (a) faz uma ida ao banco por chave
// obrigatória × 2 ramos e estourava os 5 s padrão aqui (Docker Desktop/WSL2 é
// mais lento que o Docker do Mac). O teto sobe só neste bloco.
describe('dicionário × banco — o espelho das obrigatórias não pode mentir', { timeout: 30_000 }, () => {
  it('toda chave do dicionário v2 tem uma resposta de teste (senão os casos abaixo mentem)', () => {
    const semValor = Object.values(DICIONARIO_BRIEFING)
      .filter((e) => e.desde <= 2 && e.ate === undefined)
      .map((e) => e.chave)
      .filter((chave) => !(chave in VALOR_V2))
    expect(semValor).toEqual([])
  })

  it('(c) o rótulo da finalidade profissional é o MESMO no dicionário e no banco', async () => {
    const [f] = await sql`select public.briefing_v2_finalidade_profissional() as label`
    expect(f.label).toBe(FINALIDADE_PROFISSIONAL)
    // e a opção existe de fato na lista que a tela oferece
    expect(entradasDaSecao('objetivos', 'adult', 2).map((e) => e.chave)).toContain('finalidades')
  })

  it('(b) envio montado SÓ com as chaves do dicionário passa — adulto e criança', async () => {
    for (const ramo of ['adult', 'child'] as const) {
      const erro = await envia(ramo, respostasDoDicionario(ramo))
      expect(erro, `${ramo}: o banco cobrou algo que o dicionário não conhece — ${erro}`).toBeNull()
    }
  })

  it('(a) cada chave marcada obrigatória no dicionário REALMENTE recusa o envio quando falta', async () => {
    for (const ramo of ['adult', 'child'] as const) {
      const exigidas = SECOES.flatMap((secao) =>
        chavesObrigatorias(secao, ramo).map((chave) => ({ secao, chave })),
      )
      // sanidade: o ramo tem obrigatórias (um dicionário vazio passaria calado)
      expect(exigidas.length, `${ramo} sem obrigatórias no dicionário`).toBeGreaterThan(8)

      for (const { secao, chave } of exigidas) {
        const erro = await envia(ramo, respostasDoDicionario(ramo, chave))
        expect(
          erro,
          `${ramo}: o dicionário diz que ${secao}.${chave} é obrigatória, mas o banco aceitou o envio sem ela`,
        ).not.toBeNull()
      }
    }
  })

  it('o que o dicionário NÃO marca obrigatório o banco também não cobra', async () => {
    // o par oposto de (a): tirar uma opcional não pode derrubar o envio
    for (const chave of ['experiencia_marcante', 'viagem', 'intercambio', 'obs', 'apoio']) {
      const erro = await envia('adult', respostasDoDicionario('adult', chave))
      expect(erro, `${chave} é opcional no dicionário, mas o banco recusou`).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
describe('parseBriefingForm — o ÚNICO montador (v2)', () => {
  function fd(pares: [string, string][]): FormData {
    const f = new FormData()
    for (const [k, v] of pares) f.append(k, v)
    return f
  }

  const ETAPA_HISTORIA: [string, string][] = [
    ['cidade_vida', 'Cuiabá'],
    ['facil', 'entender o que ouço'],
    ['dificil', 'falar sem travar'],
    ['contato', 'Aulas particulares'],
    ['contato', 'Escola / curso em grupo'],
    ['experiencia_marcante', 'férias em Orlando'],
  ]

  const ETAPA_INTERESSES: [string, string][] = [
    ...HOBBIES_SEIS.map((h) => ['hobbies', h] as [string, string]),
    ['hobby_outro', 'Jardinagem'],
    ['leitura', 'sim'],
    ['leitura_detalhe', 'fantasia'],
    ['filmes_series', 'não'],
    ['filmes_series_detalhe', ''],
    ['musicas', 'sim'],
    ['musicas_detalhe', 'rock dos anos 90'],
  ]

  it('adulto: as chaves literais do v2, listas onde o banco conta mínimo', () => {
    const { answers, kolb } = parseBriefingForm(
      fd([
        ...ETAPA_HISTORIA,
        ['finalidades', FINALIDADE_PROFISSIONAL],
        ['finalidades', 'Viagens'],
        ['finalidade_principal', FINALIDADE_PROFISSIONAL],
        ['topico_1', 'reuniões'],
        ['topico_2', '   '],
        ['topico_3', 'apresentações'],
        ['topico_5', 'e-mails'],
        ['alvo_6_meses', 'conduzir uma reunião'],
        ['onde_trava', 'Falar'],
        ['correcao_preferida', 'Na hora, sempre'],
        ['tempo_diario', '20 min/dia'],
        ['viagem', VIAGEM_OPCOES[1]],
        ['intercambio', INTERCAMBIO_OPCOES[2]],
        ...ETAPA_INTERESSES,
        ['blocos', 'seg|Noite'],
        ['blocos', 'seg|Manhã'],
        ['imersao', IMERSAO_OPCOES[1]],
        ['obs', 'prefiro de manhã'],
        ['apoio', 'tenho TDAH'],
        ['q1', 'C'],
      ]),
      { versao: 2, tipo: 'adult' },
    )

    expect(answers.historia).toEqual({
      cidade_vida: 'Cuiabá',
      facil: 'entender o que ouço',
      dificil: 'falar sem travar',
      contato: ['Aulas particulares', 'Escola / curso em grupo'],
      experiencia_marcante: 'férias em Orlando',
    })
    expect(answers.objetivos).toEqual({
      finalidades: [FINALIDADE_PROFISSIONAL, 'Viagens'],
      finalidade_principal: FINALIDADE_PROFISSIONAL,
      // campo em branco no meio não vira item vazio: some (o banco conta 3)
      topicos_profissionais: ['reuniões', 'apresentações', 'e-mails'],
      alvo_6_meses: 'conduzir uma reunião',
      onde_trava: ['Falar'],
      correcao_preferida: 'Na hora, sempre',
      tempo_diario: '20 min/dia',
      viagem: VIAGEM_OPCOES[1],
      intercambio: INTERCAMBIO_OPCOES[2],
    })
    expect(answers.interesses).toEqual({
      hobbies: [...HOBBIES_SEIS, 'Outro: Jardinagem'],
      leitura: 'sim',
      leitura_detalhe: 'fantasia',
      filmes_series: 'não',
      filmes_series_detalhe: '',
      musicas: 'sim',
      musicas_detalhe: 'rock dos anos 90',
    })
    expect(answers.rotina).toEqual({ blocos: { seg: ['Noite', 'Manhã'] }, imersao: IMERSAO_OPCOES[1] })
    expect(answers.livre).toEqual({ obs: 'prefiro de manhã', apoio: 'tenho TDAH' })
    expect(kolb).toEqual({ q1: 'C' })
  })

  it('criança: a etapa 2 troca de perguntas, o resto é igual', () => {
    const { answers } = parseBriefingForm(
      fd([
        ...ETAPA_HISTORIA,
        ['para_que_ingles', 'Escola / provas'],
        ['para_que_ingles', 'Jogos e vídeos'],
        ['temas_escola', 'ciências'],
        ['favoritos_midia', 'Minecraft'],
        ['quem_acompanha', 'a mãe'],
        ['temperamento', 'tímido no começo'],
        // as perguntas de adulto não existem na tela dela — e não podem vazar
        ['alvo_6_meses', 'não deveria ser lido'],
        ...ETAPA_INTERESSES,
      ]),
      { versao: 2, tipo: 'child' },
    )

    expect(answers.objetivos).toEqual({
      para_que_ingles: ['Escola / provas', 'Jogos e vídeos'],
      temas_escola: 'ciências',
      favoritos_midia: 'Minecraft',
      quem_acompanha: 'a mãe',
      temperamento: 'tímido no começo',
    })
    expect(Object.keys(answers.objetivos as object)).not.toContain('alvo_6_meses')
    expect(answers.historia).toHaveProperty('contato', ['Aulas particulares', 'Escola / curso em grupo'])
  })

  it('etapa sem conteúdo não vira seção vazia (o rascunho salva só o que a pessoa mexeu)', () => {
    const { answers, kolb } = parseBriefingForm(fd([['q1', 'A'], ['q2', 'B']]), {
      versao: 2,
      tipo: 'adult',
    })
    expect(answers).toEqual({})
    expect(kolb).toEqual({ q1: 'A', q2: 'B' })
  })

  it('v1 continua montando as chaves antigas (rascunho começado na tela velha)', () => {
    const { answers } = parseBriefingForm(
      fd([
        ['cidade_vida', 'Cuiabá'],
        ['facil_dificil', 'listening fácil; speaking difícil'],
        ['contato', 'escola + jogos'],
        ['finalidades', 'viagem'],
        ['topicos_profissionais', 'reuniões, e-mails'],
        ['viagem', VIAGEM_OPCOES[0]],
        ['intercambio', INTERCAMBIO_OPCOES[2]],
        ['leitura', 'blogs de tecnologia'],
        ['obs', 'oi'],
        ['apoio', 'no v1 esta pergunta não existe'],
      ]),
      { versao: 1, tipo: 'adult' },
    )
    expect(answers.historia).toEqual({
      cidade_vida: 'Cuiabá',
      facil_dificil: 'listening fácil; speaking difícil',
      contato: 'escola + jogos',
    })
    expect(answers.objetivos).toEqual({
      finalidades: 'viagem',
      topicos_profissionais: 'reuniões, e-mails',
      viagem: VIAGEM_OPCOES[0],
      intercambio: INTERCAMBIO_OPCOES[2],
    })
    expect(answers.livre).toEqual({ obs: 'oi' })
  })
})
