// LOTE c14 — as correções da RODADA 4 do Sol sobre o c13 (M4 + M5).
//
// A numeração dos `describe` é a do relatório dele, para a revisão seguinte
// achar cada achado sem garimpo.
//
// O QUE ESTE ARQUIVO PROVA CONTRA O BANCO (bancada local):
//  · 2.1/2.2 — o envio para assinatura virou RESERVA ANTES DE CHAMAR: dois
//    pedidos concorrentes têm um vencedor só (quem arbitra é o índice único
//    parcial, não um `if` da action), a falha externa libera a próxima
//    tentativa sem duplicar, e "documento criado lá fora sem espelho aqui"
//    deixou de existir porque o espelho é o PRIMEIRO ato;
//  · 4.1 — o TOCTOU do nome morreu de verdade: com duas conexões orquestradas,
//    a renomeação que commita enquanto o encerramento espera obriga a digitar o
//    nome NOVO (antes, o encerramento seguia com o velho já aprovado);
//  · 4.2 — acento COMPOSTO (NFD) é o mesmo nome do cadastro (NFC), e acento
//    continua sendo letra;
//  · 5 — a porta direta de `student_group_members` fechou para `authenticated`,
//    e o caminho que sobrou (o do DONO da tabela, onde só o gatilho protege)
//    aguenta 20 rodadas de membro×membro sem um deadlock;
//  · 7.1 — o teto do nome do plano é invariante de banco, não conselho de tela.
//
// E O QUE ELE PROVA SEM BANCO: que nenhuma leitura da action de contratos
// descarta `error` no caminho de decisão (2.2) e que o teto do rascunho é
// medido com o MESMO codificador que produz o endereço (7.2).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createStudent, createTeacher } from './helpers/db'
import {
  enderecoDaAdmissao,
  rascunhoDoContrato,
  tamanhoNoEndereco,
  TETO_DO_RASCUNHO,
  type RascunhoDoContrato,
} from '@/data/admin/admissao'
import { NovoContratoSchema, TETO_DO_PLANO } from '@/data/admin/contrato-novo'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const unico = (prefixo: string) => `${prefixo} ${crypto.randomUUID().slice(0, 8)}`

/** As rodadas da prova de concorrência (o lote exigiu 20, como no c13). */
const RODADAS = 20

/** O que importa de uma resposta do PostgREST nestas provas. */
type Resposta = { data: unknown; error: { message: string; code?: string } | null }

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(8)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c14'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/* ========================================================================== */
/* 2.1 + 2.2 · o envio para assinatura reserva ANTES de chamar o Autentique     */
/* ========================================================================== */

describe('2.1 · a reserva nasce antes do documento, e a unicidade arbitra a corrida', () => {
  const doc = () => 'c14-doc-' + crypto.randomUUID().replace(/-/g, '')

  it('dois pedidos CONCORRENTES: um vence, o outro recebe a recusa NOMEADA', async () => {
    const c = await createPrivateContract(sql)

    const [um, dois] = await Promise.all([
      admin.rpc('admin_begin_signature', { p_contract: c.contractId }),
      admin.rpc('admin_begin_signature', { p_contract: c.contractId }),
    ])

    const vencedores = [um, dois].filter((r) => r.error === null)
    const perdedores = [um, dois].filter((r) => r.error !== null)
    expect(vencedores, 'exatamente um pedido vive').toHaveLength(1)
    expect(perdedores).toHaveLength(1)
    // recusa NOMEADA: nada de 23505 cru chegando na tela da dona. c15: a frase
    // mudou junto com o desenho — quando o vencedor ainda não tem documento, ela
    // diz que a reserva está ABERTA e o que fazer com ela.
    expect(perdedores[0].error!.message).toMatch(/reserva de assinatura ABERTA/)
    expect(perdedores[0].error!.message).toMatch(/documento ainda não criado/)

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from contract_signatures where contract_id = ${c.contractId}`
    expect(Number(n), 'e só UMA linha nasceu').toBe(1)
  })

  it('a corrida perdida é do ÍNDICE, não de uma leitura: o segundo ESPERA e cai', async () => {
    // Determinismo: a primeira reserva fica ABERTA numa transação que não
    // commita. Sem o índice único parcial, o segundo `begin` passaria batido
    // (não há linha visível para nenhuma leitura enxergar) — com ele, o INSERT
    // do segundo BLOQUEIA na chave e só decide quando o primeiro commita.
    const c = await createPrivateContract(sql)
    const outra = connect(1)
    let segundo: PromiseLike<Resposta> | null = null
    let bloqueou = false
    try {
      await outra.begin(async (tx) => {
        await tx`insert into contract_signatures (contract_id, status, provider_document_id)
                 values (${c.contractId}, 'pending', null)`
        // `.then(r => r)` NÃO é enfeite: o builder do supabase-js só dispara o
        // HTTP quando alguém pede o resultado, e aqui o pedido tem de sair ANTES
        // de esperarmos pelo bloqueio.
        segundo = admin
          .rpc('admin_begin_signature', { p_contract: c.contractId })
          .then((r): Resposta => r)
        bloqueou = await esperarBloqueio('admin_begin_signature')
      })
      // sai do `begin` → COMMIT: o segundo acorda e colide
    } finally {
      await outra.end()
    }
    expect(bloqueou, 'o segundo pedido tem de ESPERAR na chave única').toBe(true)
    const r = await segundo!
    expect(r.error, 'o segundo não pode nascer').not.toBeNull()
    expect(r.error!.message).toMatch(/reserva de assinatura ABERTA/)
  }, 60_000)

  it('falha externa INEQUÍVOCA: o desfecho `failed` LIBERA a próxima tentativa, e ela não duplica', async () => {
    const c = await createPrivateContract(sql)

    const primeira = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(primeira.error).toBeNull()
    /*
     * c16 · r6 nº 11 — O ACEITE MORTO DO c14 VIRA O COMPORTAMENTO VIVO.
     *
     * Este caso nasceu com "Error: 502 do Autentique" no motivo, e desde o c15
     * (decisão A) esse cenário NÃO EXISTE MAIS: 502 é 5xx, 5xx é AMBÍGUO, e
     * ambíguo deixa a reserva ABERTA — o servidor pode ter quebrado depois de
     * criar o documento. Um aceite que descreve um caminho que o código não
     * percorre não guarda nada: ele só finge que guarda.
     *
     * O motivo agora é o que de fato produz `failed`: a recusa INEQUÍVOCA (a API
     * respondeu, com corpo interpretado, que não criou). Quem prova que o 502
     * deixa a reserva aberta é o c16, ponta a ponta.
     */
    const morta = await admin.rpc('admin_finish_signature', {
      p_signature: primeira.data as string,
      p_error:
        'AutentiqueEnvioError: o Autentique recusou a criação: file too large (certeza: nao-criou)',
    })
    expect(morta.error).toBeNull()
    expect(morta.data).toBe('failed')

    // o retry funciona…
    const segunda = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(segunda.error, 'tentativa que falhou não trava o contrato para sempre').toBeNull()
    const enviada = await admin.rpc('admin_finish_signature', {
      p_signature: segunda.data as string,
      p_document_id: doc(),
    })
    expect(enviada.data).toBe('sent')

    // …e agora que existe documento de verdade, um terceiro envio recusa
    const terceira = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(terceira.error).not.toBeNull()
    expect(terceira.error!.message).toMatch(/c14-doc-/)

    // c15 · Sol 8: a ordem do histórico é `reserved_at` — `sent_at` é nulo na
    // reserva morta (envio que não aconteceu não tem hora de envio).
    const linhas = await sql<{ status: string; provider_document_id: string | null }[]>`
      select status, provider_document_id from contract_signatures
       where contract_id = ${c.contractId} order by reserved_at`
    expect(linhas.map((l) => l.status), 'a falha fica no histórico, não some').toEqual([
      'failed',
      'sent',
    ])
    expect(linhas[0].provider_document_id, 'a tentativa morta não inventa documento').toBeNull()
    expect(linhas[1].provider_document_id).not.toBeNull()
  })

  it('"documento criado sem espelho" é impossível: o espelho é o PRIMEIRO ato', async () => {
    // (a) por CÓDIGO — a ordem da action, que é onde o defeito morava
    const a = codigo('src/app/admin/contratos/actions.ts')
    const reserva = a.indexOf("rpc('admin_begin_signature'")
    const externa = a.indexOf('createDocumentForSignature(cfg!')
    const anexo = a.indexOf("p_document_id: doc!.documentId")
    expect(reserva, 'a reserva existe').toBeGreaterThan(-1)
    expect(reserva, 'e vem ANTES da chamada externa').toBeLessThan(externa)
    expect(anexo, 'o id do documento é anexado DEPOIS').toBeGreaterThan(externa)
    // o pré-check check-then-act do c13 morreu junto com o INSERT direto
    expect(a, 'nada de INSERT direto no espelho').not.toContain("from('contract_signatures')")

    // (b) por BANCO — a reserva existe, e sem documento nenhum
    const c = await createPrivateContract(sql)
    const r = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(r.error).toBeNull()
    const [linha] = await sql<{ status: string; provider_document_id: string | null }[]>`
      select status, provider_document_id from contract_signatures where id = ${r.data as string}`
    expect(linha).toEqual({ status: 'pending', provider_document_id: null })
  })

  it('a exceção à regra F2 é ESTREITA: o desfecho só age sobre a reserva aberta', async () => {
    const c = await createPrivateContract(sql)
    const r = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    const id = r.data as string
    expect((await admin.rpc('admin_finish_signature', { p_signature: id, p_document_id: doc() })).data).toBe('sent')

    // segunda chamada sobre a MESMA reserva: recusa (documento enviado muda de
    // estado só por `apply_autentique_event`)
    const denovo = await admin.rpc('admin_finish_signature', {
      p_signature: id,
      p_document_id: doc(),
    })
    expect(denovo.error).not.toBeNull()
    expect(denovo.error!.message).toMatch(/já teve desfecho \(sent\)/)

    // e reserva que não existe é erro, não silêncio
    const fantasma = await admin.rpc('admin_finish_signature', {
      p_signature: crypto.randomUUID(),
      p_document_id: doc(),
    })
    expect(fantasma.error!.message).toMatch(/não existe/)
  })

  it('espelho sem documento é SÓ reserva: o CHECK de forma recusa o resto', async () => {
    const c = await createPrivateContract(sql)
    const cru = (status: string, documento: string | null) =>
      sql`insert into contract_signatures (contract_id, status, provider_document_id)
          values (${c.contractId}, ${status}, ${documento})`.then(
        () => null,
        (e: Error) => e.message,
      )
    expect(await cru('sent', null), 'enviado sem documento é mentira').toMatch(
      /contract_signatures_document_shape/,
    )
    expect(await cru('pending', 'c14-doc-torto'), 'reserva com documento também').toMatch(
      /contract_signatures_document_shape/,
    )
  })

  /*
   * O TESTE DA RECLAMAÇÃO AUTOMÁTICA MORREU AQUI (c15 · decisão B), e o que
   * ficou no lugar prova o CONTRÁRIO dele.
   *
   * O c14 fazia a reserva sem desfecho ser reclamada pelo próximo envio depois
   * de 30 minutos, "para o contrato não travar para sempre". O Sol pegou o preço
   * disso na rodada 5: o relógio não distingue reserva ABANDONADA de reserva
   * VIVA. Um envio lento — PDF grande, fila do provedor, retry interno do fetch
   * — que passasse do prazo tinha a vaga tomada pelo clique seguinte, e aí
   * nasciam DOIS documentos, agora com a bênção do banco. O relógio existia para
   * impedir duplicata e podia produzir duplicata.
   *
   * A prisão perpétua que ele resolvia continua não existindo — só que a chave
   * agora é humana e auditada (`admin_cancel_signature` / anexo do id do
   * documento), provada em `c15-correcoes-sol-5.test.ts`.
   */
  it('reserva antiga NÃO é reclamada por relógio nenhum — a vaga se libera por ato humano', async () => {
    const c = await createPrivateContract(sql)
    const orfa = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(orfa.error).toBeNull()
    await sql`update contract_signatures set reserved_at = now() - interval '31 minutes'
               where id = ${orfa.data as string}`

    const nova = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(nova.error, 'o tempo não decide sozinho que o documento não existe').not.toBeNull()
    expect(nova.error!.message).toMatch(/reserva de assinatura ABERTA/)
    // e a recusa DIZ o que fazer, porque agora há o que fazer
    expect(nova.error!.message).toMatch(/anexe o id/)
    expect(nova.error!.message).toMatch(/cancele a reserva/)

    const [velha] = await sql<{ status: string }[]>`
      select status from contract_signatures where id = ${orfa.data as string}`
    expect(velha.status, 'a reserva continua viva').toBe('pending')
  })
})

describe('2.2 · nenhuma leitura da action decide no escuro', () => {
  it('toda desestruturação de resposta do Supabase leva o `error` junto', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    // `await import(...)` é a única desestruturação que não é resposta de banco.
    const leituras = [...a.matchAll(/const \{([^}]+)\} = await (?!import\()/g)]
    expect(leituras.length, 'a varredura tem o que varrer').toBeGreaterThan(5)
    for (const [i, m] of leituras.entries()) {
      expect(m[1], `desestruturação ${i + 1} sem \`error\`: ${m[1].trim()}`).toMatch(/\berror\b/)
    }
  })

  it('a leitura do contrato recusa com o motivo REAL, não com "não encontrado"', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    expect(a).toContain('if (erroDoContrato) done(`Falha ao ler o contrato: ${erroDoContrato.message}`, FALHOU)')
  })
})

/* ========================================================================== */
/* 4.1 · a leitura do nome entra na jaula (TOCTOU, agora com duas conexões)     */
/* ========================================================================== */

/**
 * Espera até que ALGUMA transação esteja bloqueada num lock enquanto roda a
 * função `alvo`. É o que torna a prova determinística: sem isto, "T2 renomeia
 * enquanto T1 espera" seria uma corrida contra o relógio.
 */
async function esperarBloqueio(alvo: string, ms = 15_000): Promise<boolean> {
  const ate = Date.now() + ms
  while (Date.now() < ate) {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from pg_stat_activity
       where datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query ilike ${'%' + alvo + '%'}`
    if (Number(n) > 0) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

describe('4.1 · `admin_end_contract` trava a linha do NOME antes da do contrato', () => {
  it('a função pede `students`/`student_groups` ANTES de `contracts`', async () => {
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_end_contract'`
    const alunos = src.indexOf('from students s')
    const grupos = src.indexOf('from student_groups g')
    const contratos = src.indexOf('perform 1 from contracts')
    expect(alunos).toBeGreaterThan(-1)
    expect(grupos).toBeGreaterThan(alunos) // andar 0a antes do 0b
    expect(contratos, 'andar 0 antes do andar 1').toBeGreaterThan(grupos)
    expect(src.slice(alunos, contratos)).toMatch(/for update/)
  })

  it('T2 renomeia enquanto T1 espera: o encerramento RECUSA com o nome novo', async () => {
    const c = await createPrivateContract(sql)
    const velho = unico('Elisa Faria c14')
    const novo = unico('Elisa Nakamura c14')
    await sql`update students set display_name = ${velho} where id = ${c.studentId}`

    const outra = connect(1)
    let t1: PromiseLike<Resposta> | null = null
    let bloqueou = false
    try {
      await outra.begin(async (tx) => {
        // T2 renomeia e SEGURA a linha (sem commit).
        await tx`update students set display_name = ${novo} where id = ${c.studentId}`
        // T1 entra com o nome que a tela mostrou. Com a correção, ela para no
        // `for update` da linha do aluno — que é o andar 0. SEM a correção, ela
        // passa direto, lê o nome VELHO (T2 ainda não commitou), aprova e
        // encerra o contrato. (`.then(r => r)` dispara o HTTP na hora: o builder
        // do supabase-js é preguiçoso.)
        t1 = admin
          .rpc('admin_end_contract', { p_contract: c.contractId, p_confirm_name: velho })
          .then((r): Resposta => r)
        bloqueou = await esperarBloqueio('admin_end_contract')
      })
      // saiu do `begin` → COMMIT do rename
    } finally {
      await outra.end()
    }

    expect(bloqueou, 'T1 tem de esperar pela linha do aluno').toBe(true)
    const { error } = await t1!
    expect(error, 'o nome de ontem não encerra o contrato de hoje').not.toBeNull()
    expect(error!.message).toMatch(/confirmação não confere/)
    expect(error!.message, 'e a recusa mostra o nome ATUAL').toContain(novo)

    const [{ status }] = await sql<{ status: string }[]>`
      select status from contracts where id = ${c.contractId}`
    expect(status, 'nada foi encerrado').toBe('active')
  }, 60_000)

  it('e com o nome NOVO digitado, o encerramento acontece', async () => {
    const c = await createPrivateContract(sql)
    const nome = unico('Turma que fica c14')
    await sql`update students set display_name = ${nome} where id = ${c.studentId}`
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: nome,
    })
    expect(error, 'a guarda não virou muro').toBeNull()
  })
})

/* ========================================================================== */
/* 4.2 · a comparação normaliza Unicode (NFC) dos dois lados                   */
/* ========================================================================== */

describe('4.2 · acento COMPOSTO é o mesmo nome; acento continua sendo letra', () => {
  async function contratoChamado(nome: string) {
    const c = await createPrivateContract(sql)
    await sql`update students set display_name = ${nome} where id = ${c.studentId}`
    return c
  }

  it('cadastro em NFC, digitação em NFD (teclado de Mac, colar de PDF): confirma', async () => {
    const nome = unico('Mário Sérgio c14')
    expect(nome.normalize('NFD')).not.toBe(nome) // o teste só vale se forem bytes diferentes
    const c = await contratoChamado(nome.normalize('NFC'))

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: nome.normalize('NFD'),
    })
    expect(error, 'o mesmo nome, escrito com acento decomposto').toBeNull()
  })

  it('cadastro em NFD, digitação em NFC: confirma também (os DOIS lados normalizam)', async () => {
    const nome = unico('Mário Sérgio c14')
    const c = await contratoChamado(nome.normalize('NFD'))
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: nome.normalize('NFC'),
    })
    expect(error).toBeNull()
  })

  it('e SEM acento continua sendo outro nome (a régua não afrouxou)', async () => {
    const c = await contratoChamado('Mário Sérgio c14')
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: 'Mario Sergio c14',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/confirmação não confere/)
  })
})

/* ========================================================================== */
/* 5 · a porta direta de `student_group_members` fechou                        */
/* ========================================================================== */

describe('5 · entrar numa turma é ato da RPC, não INSERT avulso', () => {
  it('o INSERT direto da admin (authenticated) cai no pino 42501', async () => {
    const aluno = await createStudent(sql)
    const [g] = await sql<{ id: string }[]>`
      insert into student_groups (label) values (${unico('Turma fechada c14')}) returning id`

    const { error } = await admin
      .from('student_group_members')
      .insert({ group_id: g.id, student_id: aluno })
    expect(error?.code, 'a porta que o c13 remendou deixou de existir').toBe('42501')

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from student_group_members where group_id = ${g.id}`
    expect(Number(n)).toBe(0)
  })

  it('e a porta abençoada continua criando turma inteira', async () => {
    const alunos = [await createStudent(sql), await createStudent(sql)]
    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: alunos,
      p_group_label: unico('Turma viva c14'),
      p_tz_anchor: alunos[0],
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: await createTeacher(sql),
    })
    expect(error).toBeNull()
    const membros = await sql<{ student_id: string }[]>`
      select student_id from student_group_members
       where group_id = ${(data as { group_id: string }).group_id}`
    expect(membros).toHaveLength(2)
  })
})

/* ========================================================================== */
/* 6 · a prova onde SÓ o gatilho protege                                       */
/* ========================================================================== */

describe('6 · membro × membro por INSERT DIRETO de linha única', () => {
  /*
   * POR QUE ESTA PROVA EXISTE, se o c13 já tinha uma de membro×membro.
   *
   * A do c13 montava as turmas com `admin_create_contract` — que trava os alunos
   * em ordem total antes de escrever. O caminho medido continuava sendo o do
   * INSERT direto, mas o cenário carregava junto a pré-trava da RPC, e um
   * revisor não tem como saber, olhando o teste, QUAL das duas defesas está
   * segurando. Aqui não há RPC nenhuma no caminho: as turmas nascem por `insert`
   * cru, o aluno entra por `insert` cru de UMA linha, e a única coisa entre o
   * `FOR KEY SHARE` da chave estrangeira e o `FOR UPDATE` do gatilho de promoção
   * é `student_group_members_lock_student` (c13 · nº 2).
   *
   * COMO DONO DA TABELA, e não como `service_role`: desde o c14 `authenticated`
   * não insere mais aqui, e `service_role` nunca teve INSERT nesta tabela
   * (medido na bancada: só SELECT). Quem sobrou é o dono — que é exatamente quem
   * o gatilho tem de proteger, porque para ele não há RPC nem policy no caminho.
   *
   * O VERMELHO DE CONTROLE (medido à mão em 27/07/2026, fora da suíte, porque
   * `alter table … disable trigger` é DDL com ACCESS EXCLUSIVE e a suíte roda
   * arquivos em PARALELO — desabilitar um gatilho global no meio da rodada
   * envenenaria os outros arquivos):
   *
   *     alter table student_group_members disable trigger student_group_members_lock_student;
   *     -- 20 rodadas do MESMO cenário abaixo → 19 deadlocks (40P01)
   *     alter table student_group_members enable  trigger student_group_members_lock_student;
   *     -- 20 rodadas → 0 deadlocks
   *
   * É esse par que diz que o cenário abaixo tem gatilho de verdade: verde sem o
   * vermelho ao lado é verde que não prova nada.
   */
  it(`${RODADAS} rodadas do mesmo aluno entrando em duas turmas, zero deadlock`, async () => {
    const teacher = await createTeacher(sql)
    let deadlocks = 0
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const comum = await createStudent(sql)
      // 'lead' para o gatilho de promoção ter trabalho de verdade — é ele que
      // pede o `for update` que escalava. Sem lead, `_promote_lead` nem é
      // chamado e o cenário viraria teatro (foi o primeiro vermelho deste
      // teste, e ele estava certo).
      await sql`update students set status = 'lead' where id = ${comum}`

      const grupos: string[] = []
      for (let i = 0; i < 2; i++) {
        const dono = await createStudent(sql)
        const [g] = await sql<{ id: string }[]>`
          insert into student_groups (label) values (${unico('Turma crua c14')}) returning id`
        await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${dono})`
        // A turma precisa de CONTRATO vivo: `promote_lead_on_group_member` só
        // promove quem entra numa turma que matricula de verdade — e é a
        // promoção que pede o `for update` que escalava.
        await sql`
          insert into contracts
            (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
             started_on, group_tz_anchor_student)
          values ('private_1on1', ${g.id}, ${teacher}, 'turma crua c14', 15000, 4, 24, 90,
                  public.business_today(), ${dono})`
        grupos.push(g.id)
      }

      const entrar = (grupo: string) =>
        sql`insert into student_group_members (group_id, student_id)
            values (${grupo}, ${comum})`.then(
          () => null,
          (e: Error) => e.message,
        )

      const erros = await Promise.all([entrar(grupos[0]), entrar(grupos[1])])
      for (const [i, erro] of erros.entries()) {
        expect(erro ?? '', `rodada ${rodada} · entrada ${i}`).not.toMatch(/deadlock|40P01/i)
        expect(erro, `rodada ${rodada} · entrada ${i}`).toBeNull()
        if (erro) deadlocks++
      }

      const [{ status }] = await sql<{ status: string }[]>`
        select status from students where id = ${comum}`
      expect(status, `rodada ${rodada}: o gatilho de promoção fez o trabalho dele`).toBe('active')
    }
    expect(deadlocks).toBe(0)
  }, 180_000)

  it('o gatilho continua ARMADO (a prova acima só vale se ele existir)', async () => {
    const [g] = await sql<{ tgenabled: string }[]>`
      select tgenabled from pg_trigger
       where tgname = 'student_group_members_lock_student'`
    // 'O' = origin: dispara nas escritas normais (não é 'D', desabilitado)
    expect(g.tgenabled).toBe('O')
  })
})

/* ========================================================================== */
/* 7.1 · o teto do nome do plano é invariante                                  */
/* ========================================================================== */

describe('7.1 · nome de plano com 81 caracteres não entra em contrato nenhum', () => {
  const longo = 'P'.repeat(TETO_DO_PLANO + 1)

  it('o BANCO recusa — em qualquer porta (é o CHECK, não o `if` de uma RPC)', async () => {
    const c = await createPrivateContract(sql)
    const cru = await sql`update contracts set plan_name = ${longo} where id = ${c.contractId}`.then(
      () => null,
      (e: Error) => e.message,
    )
    expect(cru, 'nem o dono da tabela escapa').toMatch(/contracts_plan_name_len/)

    const viaRpc = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [await createStudent(sql)],
      p_plan_name: longo,
      p_hourly_rate_cents: 15000,
      p_teacher: await createTeacher(sql),
    })
    expect(viaRpc.error!.message).toMatch(/contracts_plan_name_len/)
  })

  it('e 80 continua passando (o teto é teto, não muro)', async () => {
    const viaRpc = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [await createStudent(sql)],
      p_plan_name: 'P'.repeat(TETO_DO_PLANO),
      p_hourly_rate_cents: 15000,
      p_teacher: await createTeacher(sql),
    })
    expect(viaRpc.error).toBeNull()
  })

  it('o Zod do wizard recusa antes, com frase em português', () => {
    const base = {
      ramo: 'individual' as const,
      alunos: [crypto.randomUUID()],
      ancora: null,
      rotuloDoGrupo: '',
      professora: crypto.randomUUID(),
      valorCentavos: 15000,
      remarcacoes: 4,
      inicio: '2026-08-03',
      horarios: [],
    }
    const r = NovoContratoSchema.safeParse({ ...base, plano: longo })
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.message)).toContain(
      `o nome do plano cabe em ${TETO_DO_PLANO} caracteres`,
    )
    expect(NovoContratoSchema.safeParse({ ...base, plano: 'P'.repeat(TETO_DO_PLANO) }).success).toBe(
      true,
    )
  })

  it('e as três actions de texto livre antecipam a recusa em vez de cuspir o CHECK', () => {
    const contratos = codigo('src/app/admin/contratos/actions.ts')
    // renovar e editar regras (as duas portas de `plan_name` deste arquivo)
    expect(contratos.match(/planoLongoDemais\(plano\)/g)).toHaveLength(2)
    expect(codigo('src/app/admin/alunos/novo/actions.ts')).toContain(
      '[...plan].length > TETO_DO_PLANO',
    )
  })
})

/* ========================================================================== */
/* 7.2 · o teto do rascunho mede o endereço que o produtor gera                */
/* ========================================================================== */

describe('7.2 · o rascunho é medido com o codificador que produz a URL', () => {
  const base: RascunhoDoContrato = {
    professora: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    plano: 'Aulas particulares',
    valor: '187.50',
    remarcacoes: '3',
    inicio: '2026-08-03',
    horarios: [{ weekday: 2, hora: '20:30', duracao: 45 }],
  }

  it('`URLSearchParams` e `encodeURIComponent` NÃO são o mesmo tamanho', () => {
    // Os dois sentidos da divergência, para o teste explicar por que ela importa:
    // `~` é literal em encodeURIComponent e vira %7E no formulário (3× maior)…
    expect(tamanhoNoEndereco('~~~')).toBe(9)
    expect(encodeURIComponent('~~~').length).toBe(3)
    // …e o espaço é `+` no formulário e `%20` no outro (3× menor).
    expect(tamanhoNoEndereco('   ')).toBe(3)
    expect(encodeURIComponent('   ').length).toBe(9)
  })

  it('o que não cabe volta VAZIO — medido pelo produtor, não por aproximação', () => {
    // Plano recheado de `~`: cada um deles é UM byte para `encodeURIComponent`
    // (a régua velha, que dizia "cabe") e TRÊS para o formulário que monta a URL
    // de verdade. Metade do teto em `~` é o caso onde as duas réguas discordam.
    const quantos = TETO_DO_RASCUNHO / 2
    const so: RascunhoDoContrato = { ...base, plano: '~'.repeat(quantos) }
    expect(encodeURIComponent('~'.repeat(quantos)).length).toBeLessThan(TETO_DO_RASCUNHO)
    expect(tamanhoNoEndereco('~'.repeat(quantos))).toBeGreaterThan(TETO_DO_RASCUNHO)
    expect(rascunhoDoContrato(so), 'a régua nova enxerga os %7E').toBe('')
    expect(rascunhoDoContrato(base).length).toBeGreaterThan(0)
  })

  it('e o ENDEREÇO efetivamente gerado respeita o teto', () => {
    const rascunho = rascunhoDoContrato({ ...base, plano: 'A'.repeat(80) })
    expect(rascunho).not.toBe('')
    const endereco = enderecoDaAdmissao(2, base.professora, rascunho)
    // o pedaço `rasc=…` do endereço REAL, medido como ele viaja
    const rasc = new URLSearchParams(endereco.split('?')[1]).get('rasc')
    expect(rasc, 'ida e volta pelo endereço preservam o rascunho').toBe(rascunho)
    const codificado = endereco.split('rasc=')[1]
    expect(codificado.length).toBeLessThanOrEqual(TETO_DO_RASCUNHO)
    expect(codificado.length).toBe(tamanhoNoEndereco(rascunho))
  })
})
