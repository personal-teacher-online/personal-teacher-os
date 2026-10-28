// LOTE c13 — as correções da RODADA 3 do Sol sobre o M4 + M5.
//
// A numeração dos `describe` é a do relatório dele, para a revisão seguinte
// achar cada achado sem garimpo.
//
// O QUE ESTE ARQUIVO PROVA CONTRA O BANCO (bancada local):
//  · nº 1/nº 2 — a escalada de lock morre nas TRÊS portas: renovação×renovação
//    do mesmo aluno, membro×membro (o mesmo aluno entrando em duas turmas) e a
//    criação×criação que o c12 já cobria. 20 rodadas cada — e as duas primeiras
//    foram MEDIDAS vermelhas antes desta migration (18 deadlocks em 20, nas
//    duas);
//  · nº 5 — o type-to-confirm do encerramento passou a ser conferido DENTRO da
//    transação: renomear o aluno entre a tela e o envio recusa (era o TOCTOU),
//    caixa não importa, acento importa, e o nome da TURMA vale para o contrato
//    de grupo;
//  · nº 9 — o pré-filtro da guarda ativa×ativa não afrouxou nada: os dois casos
//    vermelho→verde do c12 (mesmo fuso e entre fusos) continuam recusados.
//
// E O QUE ELE PROVA SEM BANCO: a decisão sobre quem está na porta da bancada
// (nº 7, função pura, por comportamento), o round-trip REAL do rascunho da
// admissão (nº 8/nº 13) e o contraste da lavagem, rodando o medidor de verdade
// sobre as artes publicadas (nº 12/nº 13).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  createStudent,
  createTeacher,
  daysFromToday,
  nomeDeConfirmacao,
} from './helpers/db'
import { decidirSobreAPorta, oQueAtende } from './e2e/porta'
import {
  lerRascunhoDoContrato,
  rascunhoDoContrato,
  TETO_DO_RASCUNHO,
  type RascunhoDoContrato,
} from '@/data/admin/admissao'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const unico = (prefixo: string) => `${prefixo} ${crypto.randomUUID().slice(0, 8)}`

/** As rodadas de cada prova de concorrência (o lote exigiu 20). */
const RODADAS = 20

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(8)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c13'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Deadlock é a única coisa que estas três provas procuram. */
function semDeadlock(mensagem: string | null | undefined, onde: string) {
  expect(mensagem ?? '', onde).not.toMatch(/deadlock|40P01/i)
}

/* ========================================================================== */
/* nº 1 + nº 2 · a escalada de lock, pelas TRÊS portas                         */
/* ========================================================================== */

describe('nº 1/nº 2 · nenhuma porta escala `for key share` → `for update`', () => {
  it('os dois gatilhos de pré-trava existem e pedem `students` com FOR UPDATE', async () => {
    const fonte = async (nome: string) => {
      const [{ src }] = await sql<{ src: string }[]>`
        select prosrc as src from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = ${nome}`
      return src
    }
    // contrato: aluno direto OU todos os membros da turma, em ordem de uuid
    expect(await fonte('contracts_lock_students')).toMatch(/order by s\.id\s+for update/)
    // membro: a linha do aluno que está entrando
    expect(await fonte('group_members_lock_student')).toMatch(
      /from students where id = new\.student_id for update/,
    )

    // e os dois são BEFORE INSERT — depois do insert a FK já teria pegado o
    // compartilhado, e a pré-trava viraria a própria escalada que ela evita
    const gatilhos = await sql<{ tabela: string; quando: string; nome: string }[]>`
      select c.relname as tabela,
             case when (t.tgtype & 2) = 2 then 'before' else 'after' end as quando,
             t.tgname as nome
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where t.tgname in ('contracts_lock_students', 'student_group_members_lock_student')`
    expect(gatilhos).toHaveLength(2)
    for (const g of gatilhos) expect(g.quando, g.nome).toBe('before')
  })

  it(`renovação × renovação do MESMO aluno, ${RODADAS} rodadas em paralelo`, async () => {
    // MEDIDO VERMELHO antes desta migration: 18 deadlocks em 20 rodadas. A FK de
    // `contracts.student_id` pega FOR KEY SHARE no insert do contrato novo e o
    // gatilho de promoção tenta subir para FOR UPDATE na mesma linha — as duas
    // transações com o compartilhado na mão, cada uma esperando a outra soltar.
    let deadlocks = 0
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const a = await createPrivateContract(sql)
      // dois contratos ATIVOS do MESMO aluno (a escola tem o caso: particular +
      // um contrato de reforço), e o aluno em 'lead' para o gatilho de promoção
      // ter trabalho de verdade.
      //
      // c15 · Sol 6: o segundo contrato NASCE do aluno certo. Era um `update
      // contracts set student_id`, e trocar o dono de um contrato deixou de ser
      // possível para qualquer porta (gatilho `contracts_vinculo_imutavel`) — o
      // cenário é o mesmo, o caminho é que não é mais o torto.
      const b = await createPrivateContract(sql, { studentId: a.studentId })
      await sql`update students set status = 'lead' where id = ${a.studentId}`

      const renovar = (id: string) =>
        admin.rpc('admin_renew_contract', {
          p_old: id,
          p_switch_on: daysFromToday(7),
          p_plan_name: unico('Renovado c13'),
          p_hourly_rate_cents: 16000,
          p_allowance: 4,
          p_min_notice: 24,
          p_expiry_days: 90,
          p_school_fault_days: 180,
        })

      const [ida, volta] = await Promise.all([renovar(a.contractId), renovar(b.contractId)])
      semDeadlock(ida.error?.message, `rodada ${rodada} · ida`)
      semDeadlock(volta.error?.message, `rodada ${rodada} · volta`)
      expect(ida.error, `rodada ${rodada} · ida`).toBeNull()
      expect(volta.error, `rodada ${rodada} · volta`).toBeNull()
      if (ida.error || volta.error) deadlocks++

      // e as duas renovações aconteceram de verdade
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from contracts
         where renewed_from in (${a.contractId}, ${b.contractId})`
      expect(Number(n), `rodada ${rodada}`).toBe(2)
    }
    expect(deadlocks).toBe(0)
  }, 180_000)

  it(`membro × membro (o mesmo aluno em duas turmas), ${RODADAS} rodadas`, async () => {
    // MEDIDO VERMELHO antes desta migration: 18 deadlocks em 20 rodadas. É a
    // porta que o c12 não cobriu — a policy de admin admite `insert` direto em
    // `student_group_members`, e ali não passa RPC nenhuma onde pendurar a
    // pré-trava. Daí o gatilho.
    const teacher = await createTeacher(sql)
    let deadlocks = 0
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const comum = await createStudent(sql)
      await sql`update students set status = 'lead' where id = ${comum}`

      const grupos: string[] = []
      for (let i = 0; i < 2; i++) {
        const dono = await createStudent(sql)
        const { data, error } = await admin.rpc('admin_create_contract', {
          p_kind: 'group',
          p_students: [dono, await createStudent(sql)],
          p_group_label: unico('Turma c13'),
          p_tz_anchor: dono,
          p_plan_name: 'Aulas do casal',
          p_hourly_rate_cents: 18000,
          p_teacher: teacher,
        })
        expect(error, `rodada ${rodada} · turma ${i}`).toBeNull()
        grupos.push((data as { group_id: string }).group_id)
      }

      const entrar = (grupo: string) =>
        sql`insert into student_group_members (group_id, student_id)
            values (${grupo}, ${comum})`.then(
          () => null,
          (e: Error) => e.message,
        )

      const erros = await Promise.all([entrar(grupos[0]), entrar(grupos[1])])
      for (const [i, erro] of erros.entries()) {
        semDeadlock(erro, `rodada ${rodada} · entrada ${i}`)
        expect(erro, `rodada ${rodada} · entrada ${i}`).toBeNull()
        if (erro) deadlocks++
      }

      // e o gatilho de promoção fez o trabalho dele nas duas
      const [{ status }] = await sql<{ status: string }[]>`
        select status from students where id = ${comum}`
      expect(status, `rodada ${rodada}`).toBe('active')
    }
    expect(deadlocks).toBe(0)
  }, 180_000)

  it(`criação × criação com membro em comum (o caso do c12), ${RODADAS} rodadas`, async () => {
    // O caso que o c12 consertou continua verde com a pré-trava agora
    // DUPLICADA (a da RPC e a do gatilho) — nenhuma das duas atrapalha a outra:
    // a segunda tomada do mesmo lock exclusivo, na mesma transação, é no-op.
    const teacher = await createTeacher(sql)
    let deadlocks = 0
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const a = await createStudent(sql)
      const b = await createStudent(sql)
      const c = await createStudent(sql)
      await sql`update students set status = 'lead' where id in (${a}, ${b}, ${c})`

      const criar = (alunos: string[], ancora: string) =>
        admin.rpc('admin_create_contract', {
          p_kind: 'group',
          p_students: alunos,
          p_group_label: unico('Turma c13x'),
          p_tz_anchor: ancora,
          p_plan_name: 'Aulas do casal',
          p_hourly_rate_cents: 18000,
          p_teacher: teacher,
        })

      // ordens OPOSTAS no array, e `b` em comum
      const [ida, volta] = await Promise.all([criar([a, b], a), criar([c, b], c)])
      semDeadlock(ida.error?.message, `rodada ${rodada} · ida`)
      semDeadlock(volta.error?.message, `rodada ${rodada} · volta`)
      expect(ida.error, `rodada ${rodada} · ida`).toBeNull()
      expect(volta.error, `rodada ${rodada} · volta`).toBeNull()
      if (ida.error || volta.error) deadlocks++

      const promovidos = await sql<{ status: string }[]>`
        select status from students where id in (${a}, ${b}, ${c})`
      expect(promovidos.every((s) => s.status === 'active'), `rodada ${rodada}`).toBe(true)
    }
    expect(deadlocks).toBe(0)
  }, 180_000)
})

/* ========================================================================== */
/* nº 5 · o type-to-confirm do encerramento, DENTRO da transação               */
/* ========================================================================== */

describe('nº 5 · `admin_end_contract` confere o nome contra a linha travada', () => {
  /** Um contrato particular pronto para encerrar, com o nome do aluno escolhido. */
  async function contratoDe(nome: string) {
    const c = await createPrivateContract(sql)
    await sql`update students set display_name = ${nome} where id = ${c.studentId}`
    return c
  }

  it('O TOCTOU: renomear entre a tela e o envio RECUSA', async () => {
    const c = await contratoDe('Elisa Faria c13')
    // a tela carregou com o nome de então, e a pessoa o digitou…
    const digitado = await nomeDeConfirmacao(sql, c.contractId)
    expect(digitado).toBe('Elisa Faria c13')
    // …e o cadastro foi corrigido antes de ela apertar o botão (casamento,
    // grafia errada, o nome social que finalmente entrou na ficha)
    await sql`update students set display_name = 'Elisa Nakamura c13' where id = ${c.studentId}`

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: digitado,
    })
    expect(error, 'o nome de ontem não encerra o contrato de hoje').not.toBeNull()
    expect(error!.message).toMatch(/confirmação não confere/)
    // e a frase diz qual é o nome ATUAL, senão a recusa vira adivinhação
    expect(error!.message).toContain('Elisa Nakamura c13')

    const [{ status }] = await sql<{ status: string }[]>`
      select status from contracts where id = ${c.contractId}`
    expect(status, 'nada foi encerrado').toBe('active')
  })

  it('caixa e espaço não importam; acento importa', async () => {
    const c = await contratoDe('Mário Sérgio c13')
    const tentar = (nome: string) =>
      admin.rpc('admin_end_contract', { p_contract: c.contractId, p_confirm_name: nome })

    expect((await tentar('Mario Sergio c13')).error, 'sem acento é outro nome').not.toBeNull()
    expect((await tentar('')).error, 'vazio nunca confirma').not.toBeNull()
    expect((await tentar('Mário')).error, 'meio nome não é o nome').not.toBeNull()
    // caixa e espaço em volta são ruído de digitação, não recusa
    expect((await tentar('  mÁrio sérgio C13  ')).error).toBeNull()

    const [{ status }] = await sql<{ status: string }[]>`
      select status from contracts where id = ${c.contractId}`
    expect(status).toBe('ended')
  })

  it('contrato de TURMA confirma pelo rótulo da turma', async () => {
    const teacher = await createTeacher(sql)
    const alunos = [await createStudent(sql), await createStudent(sql)]
    const rotulo = unico('Casal c13')
    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: alunos,
      p_group_label: rotulo,
      p_tz_anchor: alunos[0],
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
    })
    expect(error).toBeNull()
    const contrato = (data as { contract_id: string }).contract_id

    const comNomeDeAluno = await admin.rpc('admin_end_contract', {
      p_contract: contrato,
      p_confirm_name: 'Aluno qualquer',
    })
    expect(comNomeDeAluno.error).not.toBeNull()
    expect((await admin.rpc('admin_end_contract', {
      p_contract: contrato,
      p_confirm_name: rotulo,
    })).error).toBeNull()
  })

  it('a auditoria registra o nome conferido (Lei 8)', async () => {
    const c = await contratoDe('Auditada c13')
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: 'auditada c13',
    })
    expect(error).toBeNull()
    const [linha] = await sql<{ diff: { confirm_name?: string } }[]>`
      select diff from audit_log
       where action = 'end_contract' and entity_id = ${c.contractId}
       order by at desc limit 1`
    expect(linha.diff.confirm_name).toBe('Auditada c13')
  })

  it('a assinatura VELHA (sem confirmação) não existe mais', async () => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'admin_end_contract'`
    // uma função só: se a antiga tivesse ficado de pé, uma chamada de quatro
    // argumentos poderia cair na versão SEM portão nenhum
    expect(Number(n)).toBe(1)
  })
})

/* ========================================================================== */
/* nº 9 · o pré-filtro da guarda ativa×ativa não afrouxou a recusa             */
/* ========================================================================== */

describe('nº 9 · pré-filtro por dia-da-semana na guarda ativa×ativa', () => {
  async function contratoCom(
    teacher: string,
    emDias: number,
    horario: { weekday: number; local_time: string; duration_min?: number },
    tz?: string,
  ) {
    const aluno = await createStudent(sql, tz)
    return admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: unico('Plano c13'),
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_started_on: daysFromToday(emDias),
      p_slots: [{ duration_min: 45, ...horario }],
    })
  }

  it('o choque do MESMO dia continua recusado (o caso do c12)', async () => {
    const teacher = await createTeacher(sql)
    expect((await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })).error).toBeNull()
    const choque = await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })
    expect(choque.error).not.toBeNull()
    expect(choque.error!.message).toMatch(/outro contrato ATIVO/)
  })

  it('o choque ENTRE FUSOS, que cruza a meia-noite, continua recusado', async () => {
    // Lisboa 20:30 (WEST) = 15:30 em Cuiabá no mesmo dia civil; o que este caso
    // guarda é a distância de dia que o pré-filtro NÃO pode cortar.
    const teacher = await createTeacher(sql)
    const lisboa = await contratoCom(
      teacher,
      100,
      { weekday: 2, local_time: '20:30' },
      'Europe/Lisbon',
    )
    expect(lisboa.error).toBeNull()

    // A conversão tem de sair de um dia que SEJA a terça de Lisboa — o
    // `started_on` cai em qualquer dia da semana, e converter a data errada
    // produz um horário que não choca com nada (foi o primeiro vermelho deste
    // teste, e ele estava certo).
    const [{ hora, dia }] = await sql<{ hora: string; dia: number }[]>`
      with terca as (
        select g::date as dia
          from generate_series(${daysFromToday(100)}::timestamp,
                               ${daysFromToday(106)}::timestamp, interval '1 day') g
         where extract(dow from g)::int = 2
         limit 1
      )
      select to_char(
               ((t.dia + time '20:30') at time zone 'Europe/Lisbon')
                 at time zone 'Pacific/Auckland', 'HH24:MI') as hora,
             extract(dow from (((t.dia + time '20:30') at time zone 'Europe/Lisbon')
                 at time zone 'Pacific/Auckland'))::int as dia
        from terca t`

    // Auckland (UTC+12/+13) vê a MESMA hora absoluta num DIA CIVIL diferente —
    // é exatamente o caso que obriga o pré-filtro a ter folga de dias. Com um
    // filtro de "mesmo dia" este contrato nasceria por cima do outro.
    const auckland = await contratoCom(
      teacher,
      100,
      { weekday: dia, local_time: hora },
      'Pacific/Auckland',
    )
    expect(auckland.error, `${hora} de ${dia} em Auckland é a hora de Lisboa`).not.toBeNull()
    expect(auckland.error!.message).toMatch(/outro contrato ATIVO/)
  })

  it('horário que não choca continua nascendo (a guarda não virou muro)', async () => {
    const teacher = await createTeacher(sql)
    expect((await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })).error).toBeNull()
    // mesmo dia, duas horas depois
    expect((await contratoCom(teacher, 100, { weekday: 2, local_time: '22:30' })).error).toBeNull()
    // dia vizinho, mesma hora (dentro do pré-filtro, e sem sobreposição)
    expect((await contratoCom(teacher, 100, { weekday: 3, local_time: '20:30' })).error).toBeNull()
    // dia oposto (fora do pré-filtro)
    expect((await contratoCom(teacher, 100, { weekday: 5, local_time: '20:30' })).error).toBeNull()
  })

  it('a fronteira do filtro está no CÓDIGO com os dois sentidos (0,1,2,5,6)', async () => {
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = '_assert_no_active_overlap'`
    // o `% 7` circular, e não `abs(a - b) <= 2`: domingo e sexta distam 2
    const filtros = src.match(/\(\(rs\.weekday - v_novo\.weekday \+ 7\) % 7\) in \(0, 1, 2, 5, 6\)/g)
    // um na porta barata, outro na expansão
    expect(filtros).toHaveLength(2)
  })
})

/* ========================================================================== */
/* nº 3 · o par `back`/`back_erro` em TODO formulário dos painéis              */
/* ========================================================================== */

describe('nº 3 · varredura: nenhum formulário do detalhe fica sem `back_erro`', () => {
  /** Cada formulário da tela, do `<Form…` até o começo do próximo. */
  function formularios(): string[] {
    const bruto = corpo('src/components/admin/contratos/paineis.tsx')
    return bruto.split(/<(?:FormValidado|FormularioDeHorario)\b/).slice(1)
  }

  it('a tela tem ONZE formulários — e a conta é do teste, não do olho', () => {
    // Se um painel novo nascer, este número muda e o aceite abaixo passa a
    // varrê-lo também. É isso que separa esta varredura da do c12, que se
    // contentava com UMA ocorrência de `name="back_erro"` no arquivo inteiro:
    // ela ficou verde com dois formulários sem o par.
    //
    // c15 · decisão B: nove viraram ONZE — os dois atos humanos sobre uma
    // reserva de assinatura aberta (anexar o id do documento, cancelar a
    // reserva). O aceite de baixo passou a varrê-los, que é exatamente o que
    // este número existe para provocar.
    // Onda Financeiro · F2: onze viraram DOZE — o painel da mensalidade
    // (previsto v3), e a varredura de baixo já o cobre.
    expect(formularios()).toHaveLength(12)
  })

  it('todos levam os DOIS destinos (o do sucesso e o da falha)', () => {
    for (const [i, forma] of formularios().entries()) {
      const temPar =
        forma.includes('{fixos}') ||
        (forma.includes('name="back"') && forma.includes('name="back_erro"'))
      expect(temPar, `formulário ${i + 1} de paineis.tsx sem o par back/back_erro`).toBe(true)
    }
  })

  it('e o `fixos` compartilhado é quem carrega os dois', () => {
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    expect(p).toContain('<input type="hidden" name="back" value={self} />')
    expect(p).toContain('<input type="hidden" name="back_erro" value={aqui} />')
  })
})

/* ========================================================================== */
/* nº 4 · a criação no Autentique não se repete no "tentar de novo"            */
/* ========================================================================== */

describe('nº 4 · envio para assinatura: o espelho nasce ANTES do documento', () => {
  /*
   * O ACEITE MUDOU COM O DESENHO (c14 · Sol 2.1/2.2). O do c13 media a ORDEM de
   * duas linhas na action: "a consulta ao espelho vem antes da chamada externa".
   * Era o aceite possível para um pré-check — e um pré-check é check-then-act:
   * dois cliques simultâneos passam os dois pela consulta e criam DOIS
   * documentos. O aceite novo não pergunta pela ordem das linhas, pergunta pelo
   * COMPORTAMENTO: existe registro local do pedido ANTES de o Autentique ser
   * chamado, e um segundo pedido do mesmo contrato é recusado. As provas de
   * concorrência (dois `begin` em paralelo, falha externa que não duplica) estão
   * em `c14-correcoes-sol-4.test.ts`.
   */
  it('a reserva é registrada antes de qualquer documento, e barra o segundo pedido', async () => {
    const c = await createPrivateContract(sql)

    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(reserva.error).toBeNull()
    const [linha] = await sql<{ status: string; provider_document_id: string | null }[]>`
      select status, provider_document_id from contract_signatures
       where contract_id = ${c.contractId}`
    expect(linha.status, 'o espelho existe antes de o documento existir').toBe('pending')
    expect(linha.provider_document_id).toBeNull()

    const segundo = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(segundo.error, 'enviar de novo criaria um SEGUNDO contrato para assinar').not.toBeNull()
    // c15: a frase da recusa passou a DIZER o que fazer com a reserva aberta (o
    // relógio de 30 minutos que resolvia isso sozinho morreu — decisão B).
    expect(segundo.error!.message).toMatch(/reserva de assinatura ABERTA/)
  })

  it('e a action chama a reserva ANTES do Autentique — nada de INSERT direto', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    expect(a.indexOf("rpc('admin_begin_signature'")).toBeLessThan(
      a.indexOf('createDocumentForSignature(cfg!'),
    )
    expect(a, 'o espelho não é mais escrito por fora da RPC').not.toContain(
      "from('contract_signatures')",
    )
  })
})

/* ========================================================================== */
/* nº 6 · valor VAZIO nunca vira cortesia                                      */
/* ========================================================================== */

describe('nº 6 · cortesia é 0 explícito, em toda porta que converte `hourly_rate`', () => {
  it('a renovação recusa o campo em branco antes de chamar a RPC', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    expect(a).toContain("const valorBruto = String(formData.get('hourly_rate') ?? '').trim()")
    expect(a).toMatch(/if \(valorBruto === '' \|\| !Number\.isFinite\(valor\) \|\| valor < 0\)/)
    // e o que vai para o banco sai do valor CONFERIDO, não de um `?? 0`
    expect(a).toContain('p_hourly_rate_cents: Math.round(valor * 100)')
    expect(a, 'o `?? 0` que virava cortesia silenciosa').not.toMatch(
      /Number\(formData\.get\('hourly_rate'\) \?\? 0\)/,
    )
  })

  it('as outras duas portas dizem a mesma coisa', () => {
    // etapa 2 da admissão (c12 · nº 11, mantida)
    expect(codigo('src/app/admin/alunos/novo/actions.ts')).toMatch(
      /rateBruto === '' \|\| !Number\.isFinite\(rate\) \|\| rate < 0/,
    )
    // wizard de contrato: `Number('')` é 0, e 0 é cortesia — o vazio tem de
    // virar o −1 que o Zod recusa
    expect(codigo('src/app/admin/contratos/novo/WizardDeContrato.tsx')).toMatch(
      /valor\.trim\(\) === '' \? -1 :/,
    )
  })
})

/* ========================================================================== */
/* nº 7 + nº 13 · a decisão sobre quem está na porta da bancada                */
/* ========================================================================== */

describe('nº 7 · o harness decide por COMPORTAMENTO, e recusa dev server', () => {
  const BUILD = 'aBc123_-xyz'

  it('servidor de DESENVOLVIMENTO não é reusado — nunca', () => {
    const d = decidirSobreAPorta({ estado: 'dev' }, BUILD)
    expect(d.tipo).toBe('parar')
    expect(d.tipo === 'parar' && d.motivo).toMatch(/DESENVOLVIMENTO/)
    // e nem com o disco vazio ele vira "sobe por cima"
    expect(decidirSobreAPorta({ estado: 'dev' }, null).tipo).toBe('parar')
  })

  it('build IGUAL ao do disco é o ÚNICO reuso aceito', () => {
    expect(decidirSobreAPorta({ estado: 'build', buildId: BUILD }, BUILD)).toEqual({
      tipo: 'reusar',
      buildId: BUILD,
    })
    const outro = decidirSobreAPorta({ estado: 'build', buildId: 'de-ontem' }, BUILD)
    expect(outro.tipo).toBe('parar')
    expect(outro.tipo === 'parar' && outro.motivo).toMatch(/OUTRO build/)
    // servindo um build com o disco vazio: não há com o que comparar
    expect(decidirSobreAPorta({ estado: 'build', buildId: BUILD }, null).tipo).toBe('parar')
  })

  it('porta livre sobe — e só se houver build no disco', () => {
    expect(decidirSobreAPorta({ estado: 'fora' }, BUILD)).toEqual({ tipo: 'subir' })
    const sem = decidirSobreAPorta({ estado: 'fora' }, null)
    expect(sem.tipo).toBe('parar')
    expect(sem.tipo === 'parar' && sem.motivo).toMatch(/BUILD_ID ausente/)
  })

  it('qualquer outra coisa na porta para a suíte, com o status na frase', () => {
    const d = decidirSobreAPorta({ estado: 'estranho', status: 404 }, BUILD)
    expect(d.tipo).toBe('parar')
    expect(d.tipo === 'parar' && d.motivo).toMatch(/404/)
  })

  it('e a leitura do HTML separa build de dev de intruso', () => {
    const flight = (b: string) => `<script>self.__next_f.push([1,"3:{\\"b\\":\\"${b}\\",\\"p\\":\\"\\"}"])</script>`
    expect(oQueAtende(200, flight('aBc123_-xyz'))).toEqual({ estado: 'build', buildId: 'aBc123_-xyz' })
    expect(oQueAtende(200, flight('development'))).toEqual({ estado: 'dev' })
    // 404 é OUTRA coisa na porta (ou o app sem `.env.local`) — nunca "no ar"
    expect(oQueAtende(404, flight('aBc123_-xyz'))).toEqual({ estado: 'estranho', status: 404 })
    expect(oQueAtende(200, '<html>nada a ver</html>')).toEqual({ estado: 'estranho', status: 200 })
  })
})

/* ========================================================================== */
/* nº 8 + nº 13 · o rascunho da admissão: round-trip REAL e teto de tamanho    */
/* ========================================================================== */

describe('nº 8 · o rascunho volta INTEIRO — e some quando não cabe', () => {
  const cheio: RascunhoDoContrato = {
    professora: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    plano: 'Aulas particulares — pacote de 8, com relatório',
    valor: '187.50',
    remarcacoes: '3',
    inicio: '2026-08-03',
    horarios: [
      { weekday: 2, hora: '20:30', duracao: 45 },
      { weekday: 5, hora: '07:15', duracao: 60 },
    ],
  }

  it('ida e volta preservam CADA campo (e não só "tem alguma coisa lá")', () => {
    const devolta = lerRascunhoDoContrato(rascunhoDoContrato(cheio))
    expect(devolta).toEqual(cheio)
    // campo a campo, para a falha dizer QUAL se perdeu
    for (const chave of Object.keys(cheio) as (keyof RascunhoDoContrato)[]) {
      expect(devolta![chave], `campo ${chave}`).toEqual(cheio[chave])
    }
  })

  it('o que não é dado válido volta ao padrão, sem estourar', () => {
    // dia fora da semana, hora sem forma de hora, duração absurda
    const torto = JSON.stringify({ h: [[9, 'amanhã', -3], 'nem lista'] })
    expect(lerRascunhoDoContrato(torto)).toEqual({
      professora: '',
      plano: '',
      valor: '',
      remarcacoes: '',
      inicio: '',
      horarios: [{ weekday: 1, hora: '', duracao: 45 }],
    })
    expect(lerRascunhoDoContrato('{quebrado'), 'JSON torto não derruba a etapa').toBeNull()
    expect(lerRascunhoDoContrato(undefined)).toBeNull()
  })

  it('rascunho grande demais vira VAZIO — a etapa avisa em vez de mandar URL gigante', () => {
    const gigante = { ...cheio, plano: 'p'.repeat(TETO_DO_RASCUNHO) }
    expect(rascunhoDoContrato(gigante)).toBe('')
    // e o que cabe continua cabendo
    expect(rascunhoDoContrato(cheio).length).toBeGreaterThan(0)
    expect(encodeURIComponent(rascunhoDoContrato(cheio)).length).toBeLessThanOrEqual(
      TETO_DO_RASCUNHO,
    )
  })

  it('a action transforma o "não coube" em frase, não em endereço quebrado', () => {
    const a = codigo('src/app/admin/alunos/novo/actions.ts')
    expect(a).toContain("const coube = rascunho !== ''")
    expect(a).toContain('não cabe no endereço')
  })

  it('o único campo de tamanho livre ganhou teto nas três telas que o pedem', () => {
    for (const rel of [
      'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
      'src/app/admin/contratos/novo/WizardDeContrato.tsx',
      'src/components/admin/contratos/paineis.tsx',
    ]) {
      const c = codigo(rel)
      /*
       * c16 · r6 nº 12 — O TETO CONTINUA, O `maxLength` NÃO.
       *
       * O aceite do c13 exigia `maxLength={80}` literal, e era ele que amarrava
       * a régua ERRADA: `maxLength` conta unidades UTF-16, então o campo travava
       * a digitação em 40 emojis enquanto o CHECK do banco (`char_length`)
       * aceitaria 80 caracteres. O teto que este teste guarda é o mesmo; o que
       * mudou é quem o mede — `CampoComTeto`, em code points, dizendo a frase em
       * vez de comer a tecla.
       */
      expect(c, rel).toContain('teto={TETO_DO_PLANO}')
      expect(c, `${rel} não pode voltar a medir UTF-16`).not.toContain('maxLength={80}')
    }
  })
})

/* ========================================================================== */
/* nº 10 + nº 11 · as duas pontas dos campos do horário e do crédito           */
/* ========================================================================== */

describe('nº 10 · a duração diz na tela o que o CHECK diz no banco', () => {
  it.each([
    'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
    'src/app/admin/contratos/novo/WizardDeContrato.tsx',
    'src/components/admin/contratos/FormularioDeHorario.tsx',
  ])('%s limita a duração a 480', (rel) => {
    const c = codigo(rel)
    expect(c).toContain('min="15"')
    expect(c).toContain('max="480"')
  })
})

describe('nº 11 · lançamento NEGATIVO não tem validade', () => {
  it('o campo some da tela quando o lançamento não é positivo', () => {
    const c = codigo('src/components/admin/contratos/campos-reativos.tsx')
    // o campo agora é CONDICIONAL — antes ele só perdia o `required`
    expect(c).toMatch(/\{positivo \? \(/)
    expect(c).toContain('crédito que sai não tem validade a informar')
    expect(c, 'nada de `required={positivo}` com o campo sempre desenhado').not.toContain(
      'required={positivo}',
    )
  })

  it('e a action não manda validade no débito (rede de baixo para o POST à mão)', () => {
    expect(codigo('src/app/admin/contratos/actions.ts')).toContain(
      'p_expires_on: delta > 0 ? expires || null : null,',
    )
  })

  it('o banco ignora a validade do débito — é por isso que mandá-la é ruído', async () => {
    const c = await createPrivateContract(sql)
    // um crédito para poder tirar
    expect(
      (
        await admin.rpc('admin_makeup_adjust', {
          p_contract: c.contractId,
          p_delta: 1,
          p_expires_on: daysFromToday(30),
          p_note: 'c13: para poder tirar',
        })
      ).error,
    ).toBeNull()
    // e o débito passa SEM validade nenhuma
    const { error } = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId,
      p_delta: -1,
      p_expires_on: null,
      p_note: 'c13: ajuste para baixo',
    })
    expect(error, 'débito sem validade é o caminho normal').toBeNull()
  })
})

/* ========================================================================== */
/* nº 12 + nº 13 · a lavagem medida pelo medidor commitado                     */
/* ========================================================================== */

describe('nº 12 · o contraste do cartão de produto é MEDIDO, não afirmado', () => {
  it('o medidor roda sobre as artes reais e os dois passam AA com folga', async () => {
    const { medirLavagem } = await import('../scripts/brand/medir-lavagem.mjs')
    const medidas = await medirLavagem()
    expect(medidas).toHaveLength(2)
    for (const m of medidas) {
      expect(m.pior, `${m.nome}: pior caso dentro do p-4`).toBeGreaterThanOrEqual(4.5)
    }
  }, 60_000)

  it('e os números do comentário do componente são os que ele IMPRIME', async () => {
    const { medirLavagem } = await import('../scripts/brand/medir-lavagem.mjs')
    const medidas = await medirLavagem()
    const componente = corpo('src/components/admin/alunos/CartaoDeGrupo.tsx')
    // o comentário cita a FONTE (era esse o defeito: número sem script)
    expect(componente).toContain('scripts/brand/medir-lavagem.mjs')
    for (const m of medidas) {
      for (const t of m.porTinta) {
        expect(componente, `${m.nome} · ${t.nome}`).toContain(`${t.pior.toFixed(3)}:1`)
      }
    }
  }, 60_000)

  it('a geometria medida é a do cartão no viewport estreito', async () => {
    const { CARTAO } = await import('../scripts/brand/medir-lavagem.mjs')
    expect(CARTAO).toEqual({ largura: 256, altura: 132, recuo: 16 })
    // `p-4` = 16px, e é o recuo que a varredura respeita
    expect(codigo('src/components/admin/alunos/CartaoDeGrupo.tsx')).toContain('overflow-hidden p-4')
  })
})
