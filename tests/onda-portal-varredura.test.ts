// VARREDURA DA ONDA DO PORTAL INTEIRA — rodada final (28/07/2026).
//
// Sete achados de uma leitura da onda COMPLETA (não de um milestone). Este
// arquivo trava os cinco que dão para provar em teste:
//
//  · V1 — todo `<form action={serverAction}>` do portal monta o `ResgateDoEnvio`.
//    Não é um teste de três arquivos: é um VARREDOR. A regra que ele cobra é a
//    do ADR-030, e o defeito que ela cobre (a navegação da action perdida quando
//    o redirect volta à MESMA URL) não deixa rastro nenhum em teste de unidade —
//    quem esquecer a rede num formulário novo descobre pelo aluno.
//    **A9 (onda da Agenda, 29/07):** o varredor passou a ter DUAS superfícies. As
//    capas públicas (`/login`, `/recuperar-senha`, `/definir-senha`,
//    `/convite-expirado`) ficaram de fora da onda do Portal e foram anotadas como
//    dívida no goal — elas têm exatamente a mesma classe de corrida. Agora a
//    varredura cobra as duas, e formulário novo sem rede fica vermelho de
//    qualquer um dos dois lados.
//  · V2 — a recusa da ciência não sobrevive ao aceite (o caminho de sucesso
//    apaga o próprio recado, como as irmãs do briefing).
//  · V3 — porteiro de PAPEL nas quatro portas do briefing: ter linha em
//    `students` não é ser aluno.
//  · V4 — o SQL de recuperação da janela do flip do `schema_version` acerta o
//    alvo e só ele (o rito de deploy desta onda depende dele).
//  · V5 — o recado do portal não atravessa o logout.
//
// (V6 é e2e — `tests/e2e/onda-portal.spec.ts`, "re-briefing semestral"; V7 é
// documento.)
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

// A ponte é declarada ANTES dos mocks porque `vi.mock` sobe para o topo do
// arquivo — mesmo truque do sub-lote 3 e da rodada de integração.
const ponte = vi.hoisted(() => {
  class Redirecionou extends Error {
    url: string
    constructor(url: string) {
      super(`redirect(${url})`)
      this.name = 'Redirecionou'
      this.url = url
    }
  }
  /** O pote de cookies dublê — guarda serializado e desfaz na leitura, como o
   *  `@edge-runtime/cookies` embutido no Next faz nas duas pontas. */
  const cru = new Map<string, string>()
  const pote = {
    get: (nome: string) => {
      const v = cru.get(nome)
      return v === undefined ? undefined : { name: nome, value: decodeURIComponent(v) }
    },
    set: (nome: string, valor: string, opcoes: { maxAge?: number } = {}) => {
      // `maxAge: 0` é como a produção APAGA (o mesmo path/secure da escrita) —
      // o dublê precisa tratá-lo como remoção, senão o teste do apagamento
      // passaria lendo uma string vazia.
      if (opcoes.maxAge === 0 || valor === '') cru.delete(nome)
      else cru.set(nome, encodeURIComponent(valor))
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
vi.mock('next/headers', () => ({ cookies: async () => ponte.pote }))

import { ackChannelNoticeAction } from '@/app/portal/actions'
import { POST as signout } from '@/app/auth/signout/route'
import { FLASH_COOKIE, gravarFlash, lerFlash } from '@/lib/portal/flash'

const RAIZ = path.resolve(__dirname, '..')

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})
afterEach(() => {
  ponte.cliente = null
  ponte.pote.delete(FLASH_COOKIE)
})

/* ========================================================================== */
/* V1 · a rede de segurança do desfecho, em TODO formulário do portal          */
/* ========================================================================== */

/** Todo arquivo `.tsx` sob um diretório, recursivamente. */
function arquivosTsx(dir: string): string[] {
  const fora: string[] = []
  for (const entrada of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entrada.name)
    if (entrada.isDirectory()) fora.push(...arquivosTsx(rel))
    else if (entrada.name.endsWith('.tsx')) fora.push(rel)
  }
  return fora
}

/**
 * Os `<form action={…}>` de um arquivo — o pedaço de fonte de cada um, da tag de
 * abertura até o `</form>` que a fecha.
 *
 * `<form action="…">` (string) fica de fora de propósito: com aspas o destino é
 * uma URL, e o que acontece é um POST de navegador para um Route Handler (é o
 * caso do "Sair" na moldura). Nesse caminho quem navega é o navegador — não
 * existe commit de árvore do React para se perder, então não há o que resgatar.
 */
function formulariosDeAction(fonte: string): string[] {
  const fora: string[] = []
  const abertura = /<form\s+action=\{/g
  let m: RegExpExecArray | null
  while ((m = abertura.exec(fonte)) !== null) {
    const fim = fonte.indexOf('</form>', m.index)
    fora.push(fonte.slice(m.index, fim === -1 ? fonte.length : fim))
  }
  return fora
}

/**
 * As DUAS superfícies que a regra do ADR-030 alcança hoje.
 *
 * `formularios` é um PINO, não decoração: sem ele, apagar um formulário (ou
 * mover a pasta) deixaria o varredor varrendo menos do que deveria e verde do
 * mesmo jeito. `nomeados` são os arquivos que o defeito citou pelo nome — o
 * caso concreto que ninguém pode "consertar" tirando do escopo.
 */
const SUPERFICIES = [
  {
    nome: 'portal',
    diretorios: ['src/app/portal', 'src/components/portal'],
    // Briefing (2) + re-briefing (2) + perfil (2) + ciência (1) + BotaoDeAcao (1).
    formularios: 8,
    nomeados: ['src/app/portal/perfil/page.tsx', 'src/app/portal/ciencia/page.tsx'],
  },
  {
    // A9 (29/07): a dívida das capas do goal da onda do Portal, fechada. São
    // telas PÚBLICAS e noturnas — o que entra nelas é só o resgate, que não
    // desenha nada; nenhum estilo do portal atravessa para cá.
    nome: 'capas públicas',
    diretorios: [
      'src/app/login',
      'src/app/recuperar-senha',
      'src/app/definir-senha',
      'src/app/convite-expirado',
    ],
    // login consolidada + login proposta + recuperar consolidada + recuperar
    // proposta + definir-senha + convite-expirado. As duas PROPOSTAS entram
    // porque a disputa do D11 exige comportamento idêntico entre as capas.
    formularios: 6,
    nomeados: [
      'src/app/login/page.tsx',
      'src/app/login/proposta.tsx',
      'src/app/recuperar-senha/page.tsx',
      'src/app/recuperar-senha/proposta.tsx',
      'src/app/definir-senha/page.tsx',
      'src/app/convite-expirado/page.tsx',
    ],
  },
] as const

describe('V1 · nenhum formulário de Server Action fica sem o ResgateDoEnvio', () => {
  for (const superficie of SUPERFICIES) {
    describe(superficie.nome, () => {
      const arquivos = () => superficie.diretorios.flatMap(arquivosTsx)

      it('o varredor acha os formulários que a superfície tem (senão ele não prova nada)', () => {
        const total = arquivos().reduce(
          (n, rel) => n + formulariosDeAction(readFileSync(path.join(RAIZ, rel), 'utf8')).length,
          0,
        )
        expect(total).toBe(superficie.formularios)
      })

      it('cada `<form action={…}>` monta o ResgateDoEnvio DENTRO de si', () => {
        const semRede: string[] = []
        for (const rel of arquivos()) {
          const fonte = readFileSync(path.join(RAIZ, rel), 'utf8')
          formulariosDeAction(fonte).forEach((form, i) => {
            if (!form.includes('<ResgateDoEnvio')) semRede.push(`${rel} (formulário nº ${i + 1})`)
          })
        }
        // A frase do vermelho é a instrução: quem escrever o formulário novo lê
        // aqui o que fazer, sem precisar reabrir a ADR.
        expect(
          semRede,
          `estes formulários (${superficie.nome}) enviam para uma Server Action sem a rede do ` +
            'ADR-030 — monte <ResgateDoEnvio /> dentro do <form> ' +
            '(ver src/components/kit/ResgateDoEnvio.tsx)',
        ).toEqual([])
      })

      it('os arquivos que o defeito nomeou estão entre os cobertos', () => {
        for (const rel of superficie.nomeados) {
          const fonte = readFileSync(path.join(RAIZ, rel), 'utf8')
          expect(fonte, rel).toContain("from '@/components/kit/ResgateDoEnvio'")
          const forms = formulariosDeAction(fonte)
          expect(forms.length, `${rel} precisa ter formulário para o pino valer`).toBeGreaterThan(0)
          for (const form of forms) expect(form, rel).toContain('<ResgateDoEnvio')
        }
      })
    })
  }

  /**
   * PROVA DE MUTAÇÃO do próprio varredor, com o mesmo extrator: um formulário
   * novo sem a rede TEM de ser apontado, e um com a rede não. Sem isto,
   * `formulariosDeAction` poderia devolver lista vazia (regex quebrada, pasta
   * renomeada) e os casos acima passariam sem varrer coisa nenhuma.
   */
  it('o varredor reprova formulário novo sem rede e aprova o que a tem', () => {
    const semRede = '<form action={minhaAction}>\n<button/>\n</form>'
    const comRede = '<form action={minhaAction}>\n<button/>\n<ResgateDoEnvio />\n</form>'
    expect(formulariosDeAction(semRede)).toHaveLength(1)
    expect(formulariosDeAction(semRede)[0]).not.toContain('<ResgateDoEnvio')
    expect(formulariosDeAction(comRede)[0]).toContain('<ResgateDoEnvio')
    // `<form action="/rota">` (string) continua FORA: ali quem navega é o
    // navegador, não há commit de árvore para se perder.
    expect(formulariosDeAction('<form action="/auth/signout"><button/></form>')).toHaveLength(0)
  })

  /**
   * A moldura das capas (`CapaNoturna` / `CapaClara`) não desenha formulário
   * hoje — e a varredura acima olha só as PASTAS DE ROTA. Se um formulário
   * nascer dentro da moldura, ele escaparia do varredor em silêncio; este caso
   * fecha o flanco pedindo que ele volte para a rota (ou que a superfície ganhe
   * o diretório).
   */
  it('as molduras das capas continuam sem formulário próprio', () => {
    for (const rel of ['src/components/kit/capa-noturna.tsx', 'src/components/kit/capa-clara.tsx']) {
      const fonte = readFileSync(path.join(RAIZ, rel), 'utf8')
      expect(formulariosDeAction(fonte), `${rel} ganhou um <form action={…}>`).toEqual([])
    }
  })
})

/* ========================================================================== */
/* V2 · a recusa da ciência não sobrevive ao aceite                            */
/* ========================================================================== */

/** Chama a action e devolve para onde ela levou. NÃO toca no cookie — é o
 *  estado entre as duas chamadas que este bloco investiga. */
async function chamarAceite(policyVersionId: string): Promise<string> {
  const fd = new FormData()
  fd.append('policy_version_id', policyVersionId)
  try {
    await ackChannelNoticeAction(fd)
  } catch (e) {
    if (e instanceof ponte.Redirecionou) return e.url
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

describe('V2 · ciência: o aceite apaga a recusa que ele acabou de resolver', () => {
  it('recusa (versão velha) → aceite VÁLIDO em segundos → a tela seguinte chega SEM o recado velho', async () => {
    // `{ whatsapp: null }` explícito: a fixture de aluno nasce COM número desde o
    // A6/i, e este caso é justamente o do perfil SEM número — é ele que faz o
    // aceite desembocar no campo do WhatsApp. Sem login vinculado a ficha nenhuma
    // aqui, então nada esbarra no gatilho.
    const userId = await createAuthUser(sql, 'student', 'Aluno Ciência', { whatsapp: null })
    ponte.cliente = await clientAs(userId, 'student')

    const [vigente] = await sql<{ id: string }[]>`select id from public.policy_vigente('ciencia-canais')`
    expect(vigente?.id).toBeTruthy()

    // 1) a recusa REAL: um id que NÃO é o da versão vigente — `ack_channel_notice`
    //    responde 'politica-desatualizada' e a action grava a frase no cookie de
    //    15s. Publicar uma v2 de verdade seria pior: ela mudaria a vigente para
    //    a suíte inteira (é o que o comentário de `_accept_policy_locked` diz),
    //    e o que se exercita aqui é o RECADO, não a publicação.
    const urlDaRecusa = await chamarAceite(crypto.randomUUID())
    expect(urlDaRecusa).toBe('/portal/ciencia')
    expect((await lerFlash())?.mensagem).toContain('combinado foi atualizado')

    // 2) o aceite certo, no mesmo navegador, dentro dos 15s
    const urlDoAceite = await chamarAceite(vigente.id)
    // sem WhatsApp cadastrado, o aceite desemboca no campo do número (e2e 19/07)
    expect(urlDoAceite).toBe('/portal/perfil?foco=whatsapp')

    // 3) O DEFEITO: aqui a recusa continuava pendurada, e a moldura a repintava
    //    na tela de destino — a pessoa via "leia o texto novo" logo depois de o
    //    aceite ter sido gravado.
    expect(await lerFlash()).toBeNull()

    // …e o aceite aconteceu de verdade (o carimbo é o que faz o gate abrir)
    const [perfil] = await sql`select whatsapp_channel_ack_at from profiles where id = ${userId}`
    expect(perfil.whatsapp_channel_ack_at).not.toBeNull()
  })

  it('o sucesso de OUTRA aba sobrevive: o aceite só apaga recado de ERRO', async () => {
    // A régua de `limparFlash` é essa, e ela é o motivo de o caminho de sucesso
    // poder limpar sem risco: desfecho de dinheiro nascido em outra aba fica.
    const userId = await createAuthUser(sql, 'student', 'Aluno Ciência 2')
    ponte.cliente = await clientAs(userId, 'student')
    const [vigente] = await sql<{ id: string }[]>`select id from public.policy_vigente('ciencia-canais')`

    await gravarFlash('Aula remarcada! ✅ Você recebe a confirmação por e-mail.')
    await chamarAceite(vigente.id)
    expect((await lerFlash())?.mensagem).toContain('Aula remarcada')
  })
})

/* ========================================================================== */
/* V3 · porteiro de PAPEL: ter linha em students não é ser aluno               */
/* ========================================================================== */

const BASE_V2 = {
  historia: {
    cidade_vida: 'Cuiabá',
    facil: 'entender o que ouço',
    dificil: 'falar sem travar',
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
    hobbies: ['Viajar', 'Jogar', 'Escutar música', 'Ler', 'Cozinhar', 'Fotografar'],
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

const UPDATE_OBJETIVOS = {
  finalidades: ['Imigração'],
  finalidade_principal: 'Imigração',
  alvo_6_meses: 'passar na entrevista do consulado',
  onde_trava: ['Entender de ouvido'],
  correcao_preferida: 'No fim da fala',
  tempo_diario: '30+ min/dia',
}

describe('V3 · as quatro portas do briefing exigem PAPEL, não só cadastro', () => {
  /**
   * O cenário do defeito, em uma frase: a professora que também estuda na escola
   * (ou a conta de vendas cadastrada como aluna para testar o portal) tem JWT de
   * `teacher`/`sales` E linha em `students`. `_briefing_session_student()` só
   * pergunta a segunda coisa.
   *
   * Cada caso abaixo roda DUAS vezes sobre a MESMA linha de `students`: uma com
   * a conta de aluno (tem de passar — é o que prova que o cenário era válido) e
   * outra com a conta de professora (tem de bater na porta). A única variável
   * entre as duas é o papel.
   */
  it('briefing BASE: o aluno salva e envia; a MESMA linha, sob conta de professora, não', async () => {
    const c = await createPrivateContract(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno Porteiro')
    await sql`update students set profile_id = ${alunoUser} where id = ${c.studentId}`
    const aluno = await clientAs(alunoUser, 'student')

    // controle positivo: pela porta certa, entra
    const ok = await aluno.rpc('save_briefing_draft', {
      p_answers: { historia: BASE_V2.historia },
      p_kolb_answers: {},
    })
    expect(ok.error).toBeNull()

    // agora a MESMA linha de students pertence a uma conta de PROFESSORA
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Que Estuda')
    await sql`update students set profile_id = ${profUser} where id = ${c.studentId}`
    const prof = await clientAs(profUser, 'teacher')

    const rascunho = await prof.rpc('save_briefing_draft', {
      p_answers: { historia: { cidade_vida: 'Escrita pelo papel errado' } },
      p_kolb_answers: {},
    })
    expect(rascunho.error?.message).toContain('sem acesso')
    const envio = await prof.rpc('submit_briefing')
    expect(envio.error?.message).toContain('sem acesso')

    // e nada da escrita barrada encostou na linha
    const [linha] = await sql`select answers, status from briefings where student_id = ${c.studentId}`
    expect(linha.answers.historia.cidade_vida).toBe('Cuiabá')
    expect(linha.status).toBe('draft')
  })

  it('RE-BRIEFING: o aluno rascunha; a mesma linha, sob conta de professora, não rascunha nem envia', async () => {
    const c = await createPrivateContract(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno Porteiro Update')
    await sql`update students set profile_id = ${alunoUser}, level = 'A1' where id = ${c.studentId}`
    await sql`
      update contracts set started_on = (public.business_today() - interval '8 months')::date
       where id = ${c.contractId}`
    await sql`delete from briefings where student_id = ${c.studentId}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                             status, submitted_at, schema_version)
      values (${c.studentId}, ${sql.json(BASE_V2)}, ${sql.json(KOLB)},
              ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
              'submitted', now(), 2)`

    const adminUser = await createAuthUser(sql, 'admin', 'Admin Porteiro Update')
    const admin = await clientAs(adminUser, 'admin')
    const plano = await admin.rpc('generate_study_plan', { p_contract: c.contractId })
    expect(plano.error).toBeNull()

    // controle positivo
    const aluno = await clientAs(alunoUser, 'student')
    const ok = await aluno.rpc('save_briefing_update_draft', {
      p_contract: c.contractId,
      p_answers: { objetivos: UPDATE_OBJETIVOS },
    })
    expect(ok.error).toBeNull()

    // a mesma linha, agora sob conta de professora
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Que Estuda 2')
    await sql`update students set profile_id = ${profUser} where id = ${c.studentId}`
    const prof = await clientAs(profUser, 'teacher')

    const rascunho = await prof.rpc('save_briefing_update_draft', {
      p_contract: c.contractId,
      p_answers: { objetivos: { ...UPDATE_OBJETIVOS, alvo_6_meses: 'escrito pelo papel errado' } },
    })
    expect(rascunho.error?.message).toContain('sem acesso')
    const envio = await prof.rpc('submit_briefing_update', { p_contract: c.contractId })
    expect(envio.error?.message).toContain('sem acesso')

    const [linha] = await sql`
      select answers, status from briefing_updates where contract_id = ${c.contractId}`
    expect(linha.answers.objetivos.alvo_6_meses).toBe(UPDATE_OBJETIVOS.alvo_6_meses)
    expect(linha.status).toBe('draft')
  })

  it('a retaguarda da ADMIN continua entrando no envio da atualização (a porta não fechou demais)', async () => {
    const c = await createPrivateContract(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno Retaguarda')
    await sql`update students set profile_id = ${alunoUser}, level = 'A1' where id = ${c.studentId}`
    await sql`
      update contracts set started_on = (public.business_today() - interval '8 months')::date
       where id = ${c.contractId}`
    await sql`delete from briefings where student_id = ${c.studentId}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                             status, submitted_at, schema_version)
      values (${c.studentId}, ${sql.json(BASE_V2)}, ${sql.json(KOLB)},
              ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
              'submitted', now(), 2)`
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin Retaguarda'), 'admin')
    expect((await admin.rpc('generate_study_plan', { p_contract: c.contractId })).error).toBeNull()

    const aluno = await clientAs(alunoUser, 'student')
    expect(
      (
        await aluno.rpc('save_briefing_update_draft', {
          p_contract: c.contractId,
          p_answers: { objetivos: UPDATE_OBJETIVOS, interesses: BASE_V2.interesses },
        })
      ).error,
    ).toBeNull()

    const enviado = await admin.rpc('submit_briefing_update', { p_contract: c.contractId })
    expect(enviado.error).toBeNull()
  })
})

/* ========================================================================== */
/* V4 · o SQL de recuperação da janela do flip                                 */
/* ========================================================================== */

/**
 * O RISCO, em uma frase: entre a migration que troca o default de
 * `briefings.schema_version` para 2 e a troca da imagem, o banco carimba 2 numa
 * linha que a tela v1 preencheu com as chaves v1 — e o envio recusa para sempre,
 * numa tela BLOQUEANTE.
 *
 * Não há fix de código limpo (a UI v1 não diz sob que versão foi desenhada, e
 * inverter a ordem do deploy quebra mais gente). O que existe é o conserto, e um
 * conserto de produção que ninguém rodou é uma esperança: este caso roda.
 *
 * O texto do `update` é o MESMO de `docs/goals/rito-deploy-onda-portal.md`.
 */
describe('V4 · recuperação da janela do flip do schema_version', () => {
  it('carimba de volta o rascunho v2-com-respostas-v1 — e não encosta em mais ninguém', async () => {
    const alvo = await createPrivateContract(sql)
    const v2Legitimo = await createPrivateContract(sql)
    const jaEnviado = await createPrivateContract(sql)

    // (a) a VÍTIMA da janela: carimbo 2 (default novo), respostas do formulário
    //     v1 — a chave `facil_dificil` é a assinatura do questionário antigo.
    await sql`delete from briefings where student_id = ${alvo.studentId}`
    await sql`
      insert into briefings (student_id, answers, schema_version)
      values (${alvo.studentId},
              ${sql.json({ historia: { cidade_vida: 'Cuiabá', facil_dificil: 'ler é fácil, falar é difícil' } })},
              2)`

    // (b) rascunho v2 LEGÍTIMO (chaves novas) — não pode ser rebaixado
    await sql`delete from briefings where student_id = ${v2Legitimo.studentId}`
    await sql`
      insert into briefings (student_id, answers, schema_version)
      values (${v2Legitimo.studentId}, ${sql.json({ historia: BASE_V2.historia })}, 2)`

    // (c) linha já ENVIADA com respostas v1 — o carimbo dela é histórico
    await sql`delete from briefings where student_id = ${jaEnviado.studentId}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                             status, submitted_at, schema_version)
      values (${jaEnviado.studentId},
              ${sql.json({ historia: { cidade_vida: 'Cuiabá', facil_dificil: 'idem' } })},
              ${sql.json(KOLB)}, ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente',
              'submitted', now(), 2)`

    // a consulta de reconhecimento do rito enxerga a vítima — e só ela
    const achados = await sql<{ student_id: string }[]>`
      select b.student_id
        from briefings b
       where b.status = 'draft'
         and b.schema_version = 2
         and b.answers -> 'historia' ? 'facil_dificil'`
    expect(achados.map((r) => r.student_id)).toContain(alvo.studentId)
    expect(achados.map((r) => r.student_id)).not.toContain(v2Legitimo.studentId)
    expect(achados.map((r) => r.student_id)).not.toContain(jaEnviado.studentId)

    // o conserto, palavra por palavra do rito
    await sql`
      update briefings
         set schema_version = 1,
             updated_at = now()
       where status = 'draft'
         and schema_version = 2
         and answers -> 'historia' ? 'facil_dificil'`

    const versao = async (studentId: string) =>
      (await sql<{ v: number }[]>`select schema_version as v from briefings where student_id = ${studentId}`)[0].v
    expect(await versao(alvo.studentId)).toBe(1)
    expect(await versao(v2Legitimo.studentId)).toBe(2)
    expect(await versao(jaEnviado.studentId)).toBe(2)

    // …e agora a vítima envia pela régua v1, que é a das respostas que ela deu
    // (v1 só cobra "a etapa existe e não está vazia").
    const userId = await createAuthUser(sql, 'student', 'Aluno da Janela')
    await sql`update students set profile_id = ${userId} where id = ${alvo.studentId}`
    const aluno = await clientAs(userId, 'student')
    const completa = await aluno.rpc('save_briefing_draft', {
      p_answers: {
        objetivos: { livre: 'x' },
        interesses: { livre: 'x' },
        rotina: { livre: 'x' },
      },
      p_kolb_answers: KOLB,
    })
    expect(completa.error).toBeNull()
    const enviado = await aluno.rpc('submit_briefing')
    expect(enviado.error).toBeNull()
  })
})

/* ========================================================================== */
/* V5 · o recado não atravessa o logout                                        */
/* ========================================================================== */

describe('V5 · sair da conta apaga o recado pendente', () => {
  it('o cookie de flash não sobrevive ao signout', async () => {
    ponte.cliente = {
      auth: { signOut: async () => ({ error: null }) },
    } as unknown as SupabaseClient

    await gravarFlash('Senha trocada. ✓')
    expect(await lerFlash()).not.toBeNull()

    const resposta = await signout()
    expect(resposta.status).toBe(303)
    expect(resposta.headers.get('location')).toBe('/login')

    // O DEFEITO: o recado da conta anterior chegava ao `/login` — e, num
    // computador compartilhado, à próxima pessoa.
    expect(await lerFlash()).toBeNull()
  })
})
