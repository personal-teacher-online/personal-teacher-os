// LOTE c12 — as correções da RODADA 2 do Sol sobre o M4 + M5.
//
// A numeração dos `describe` é a do relatório dele, para a revisão seguinte
// achar cada achado sem garimpo.
//
// O QUE ESTE ARQUIVO PROVA CONTRA O BANCO (bancada local):
//  · nº 1  — conflito ativo×ativo ALÉM do horizonte de materialização: dois
//            contratos que só começam em 100 dias, mesma professora, mesma
//            terça 20:30. Era o buraco: a exclusão GiST só vê aula
//            materializada (8 semanas), o índice único de `recurring_slots` é
//            por contrato e `_assert_no_paused_overlap` só olha contrato
//            PAUSADO — os dois nasciam;
//  · nº 2  — a promoção de turma percorre os membros em ordem total, e duas
//            criações de grupo com membros em comum, em paralelo, não
//            deadlockam (best-effort, no padrão do P2);
//  · nº 3  — a duração sana (15..480) virou CHECK no Postgres;
//  · nº 4  — professora ARQUIVADA não recebe contrato;
//  · nº 10 — a virada da renovação nunca é anterior ao início do contrato velho;
//  · nº 11 — R$0 é CORTESIA nas duas portas (criar e renovar).
//
// E O QUE ELE PROVA SEM BANCO: a normalização de chave repetida na query da
// tela velha (nº 20), o nome real do type-to-confirm vindo do servidor (nº 9), a
// leitura do fuso confirmado dos MEMBROS do grupo (nº 5) e os aceites de forma
// dos arquivos tocados (nº 6, 7, 8, 12, 13, 14, 16, 17, 18, 19, 21).
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
} from './helpers/db'
import { destinoDoLegado } from '@/data/admin/contratos-legado'
import { lerContratoDoDetalhe } from '@/data/admin/contrato-detalhe'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const unico = (prefixo: string) => `${prefixo} ${crypto.randomUUID().slice(0, 8)}`

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(8)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c12'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/* ========================================================================== */
/* nº 1 · conflito ativo×ativo além do horizonte de materialização             */
/* ========================================================================== */

describe('nº 1 · horário fixo de contrato ATIVO além das 8 semanas materializadas', () => {
  /** Cria um contrato individual com UM horário fixo, começando em `emDias`. */
  async function contratoCom(
    teacher: string,
    emDias: number,
    horario: { weekday: number; local_time: string; duration_min?: number },
  ) {
    const aluno = await createStudent(sql)
    return admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: unico('Plano c12'),
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_started_on: daysFromToday(emDias),
      p_slots: [{ duration_min: 45, ...horario }],
    })
  }

  it('o CENÁRIO DO SOL: dois contratos começando em 100 dias, mesma professora, mesma terça 20:30', async () => {
    const teacher = await createTeacher(sql)

    const primeiro = await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })
    expect(primeiro.error, 'o primeiro contrato nasce normalmente').toBeNull()

    // A PROVA DE QUE O BURACO ERA REAL: o primeiro horário não materializou
    // aula nenhuma (começa muito além das 8 semanas), então não há NADA para a
    // exclusão GiST recusar.
    const [{ n: aulas }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${(primeiro.data as { contract_id: string }).contract_id}`
    expect(Number(aulas), 'nenhuma aula materializada: a GiST está cega aqui').toBe(0)

    const segundo = await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })
    expect(segundo.error, 'o segundo horário TEM de ser recusado').not.toBeNull()
    expect(segundo.error!.message).toMatch(/outro contrato ATIVO/)

    // e a transação inteira reverteu: nada do segundo contrato ficou de pé
    const [{ n: slots }] = await sql<{ n: number }[]>`
      select count(*)::int as n from recurring_slots
       where teacher_id = ${teacher} and weekday = 2 and local_time = '20:30'`
    expect(Number(slots), 'só o primeiro horário existe').toBe(1)
  })

  it('horário que NÃO choca continua nascendo (a guarda não é um muro)', async () => {
    const teacher = await createTeacher(sql)
    expect((await contratoCom(teacher, 100, { weekday: 2, local_time: '20:30' })).error).toBeNull()
    // mesma terça, duas horas depois: nenhuma sobreposição
    expect((await contratoCom(teacher, 100, { weekday: 2, local_time: '22:30' })).error).toBeNull()
    // e outro dia da semana no mesmo horário também passa
    expect((await contratoCom(teacher, 100, { weekday: 4, local_time: '20:30' })).error).toBeNull()
  })

  it('dentro do horizonte quem recusa continua sendo a exclusão GiST, com a frase de sempre', async () => {
    const teacher = await createTeacher(sql)
    expect((await contratoCom(teacher, 0, { weekday: 3, local_time: '14:00' })).error).toBeNull()
    const choque = await contratoCom(teacher, 0, { weekday: 3, local_time: '14:00' })
    expect(choque.error).not.toBeNull()
    // a mensagem do materializador, e NÃO a da guarda nova — a ordem das guardas
    // em `create_slot` é deliberada (a GiST fala primeiro sobre o que ela vê)
    expect(choque.error!.message).toMatch(/já tem aula em/)
  })

  it('contrato ENCERRADO não guarda horário nenhum além do horizonte', async () => {
    const teacher = await createTeacher(sql)
    const primeiro = await contratoCom(teacher, 100, { weekday: 5, local_time: '08:00' })
    expect(primeiro.error).toBeNull()
    // `contracts_dates_ok` exige `ended_on >= started_on`, e este contrato só
    // começa em 100 dias: ele é encerrado no próprio dia em que começaria.
    await sql`
      update contracts set status = 'ended', ended_on = started_on
       where id = ${(primeiro.data as { contract_id: string }).contract_id}`
    // com o dono fora do ar, a hora volta ao mercado
    expect((await contratoCom(teacher, 100, { weekday: 5, local_time: '08:00' })).error).toBeNull()
  })

  it('a guarda atravessa FUSOS: 20:30 de Lisboa é 16:30 de Cuiabá, e as duas colidem', async () => {
    const teacher = await createTeacher(sql)

    const lisboa = await createStudent(sql, 'Europe/Lisbon')
    const emLisboa = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [lisboa],
      p_plan_name: unico('Plano Lisboa c12'),
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_started_on: daysFromToday(100),
      p_slots: [{ weekday: 2, local_time: '20:30', duration_min: 45 }],
    })
    expect(emLisboa.error).toBeNull()

    // 20:30 em Lisboa (WEST, UTC+1 no verão) = 19:30 UTC = 15:30 em Cuiabá
    // (UTC−4). O offset é do DIA (Lei 1), então a conta é do Postgres — o que o
    // teste prova é que a MESMA hora absoluta é vista como choque, venha ela do
    // relógio que vier.
    const [{ hora }] = await sql<{ hora: string }[]>`
      select to_char(
               ((${daysFromToday(100)}::date + time '20:30') at time zone 'Europe/Lisbon')
                 at time zone 'America/Cuiaba', 'HH24:MI') as hora`

    const cuiaba = await createStudent(sql, 'America/Cuiaba')
    const emCuiaba = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [cuiaba],
      p_plan_name: unico('Plano Cuiabá c12'),
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_started_on: daysFromToday(100),
      p_slots: [{ weekday: 2, local_time: hora, duration_min: 45 }],
    })
    expect(emCuiaba.error, `${hora} em Cuiabá é a mesma hora de 20:30 em Lisboa`).not.toBeNull()
    expect(emCuiaba.error!.message).toMatch(/outro contrato ATIVO/)
  })
})

/* ========================================================================== */
/* nº 2 · ordem total dos locks na promoção de turma                           */
/* ========================================================================== */

describe('nº 2 · promoção de turma pede as linhas de `students` em ordem total', () => {
  it('o laço do gatilho ordena por student_id (a premissa que a 001100 assumia)', async () => {
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'promote_lead_on_contract'`
    expect(src).toMatch(/order by m\.student_id/)
  })

  it('e a porta única trava as linhas de `students` ANTES de escrever (escalada de lock)', async () => {
    // O `order by` sozinho NÃO bastava, e a bancada mostrou por quê (4 deadlocks
    // em 4 rodadas): a FK de `student_group_members` pega FOR KEY SHARE
    // (compartilhado) no aluno em comum, as DUAS transações o obtêm sem esperar,
    // e cada uma depois tenta subir para o FOR UPDATE de `_promote_lead`.
    // Escalada de lock não se conserta com ordem — só não escalando.
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_create_contract'`
    expect(src).toMatch(
      /perform 1 from students where id = any \(v_students\) order by id for update/,
    )
    // e o lock EXCLUSIVO vem antes do insert dos membros, que é quem pega o
    // compartilhado — a ordem no CÓDIGO é o que faz a correção valer (os
    // comentários citam as duas linhas e sairiam na frente de qualquer uma)
    const semComentario = src.replace(/^\s*--.*$/gm, '')
    expect(semComentario.indexOf('order by id for update')).toBeLessThan(
      semComentario.indexOf('insert into student_group_members'),
    )
  })

  it('duas turmas com membro em comum, criadas em paralelo, não deadlockam', async () => {
    const teacher = await createTeacher(sql)
    // BEST-EFFORT, e dito em voz alta: deadlock é corrida, e ausência num
    // punhado de rodadas não é prova de impossibilidade — a prova é a ordem
    // total no `order by` do teste acima. O que ESTE caso pega é a regressão
    // grosseira (alguém tirar o `order by` e o laço voltar a pedir as mesmas
    // linhas em ordens opostas), que aparece rápido com repetição.
    for (let rodada = 0; rodada < 6; rodada++) {
      const a = await createStudent(sql)
      const b = await createStudent(sql)
      const c = await createStudent(sql)
      // 'lead' de propósito: só quem é lead entra no `_promote_lead` que trava
      // a linha. As duas turmas compartilham `b`.
      await sql`update students set status = 'lead' where id in (${a}, ${b}, ${c})`

      const criar = (alunos: string[], ancora: string) =>
        admin.rpc('admin_create_contract', {
          p_kind: 'group',
          p_students: alunos,
          p_group_label: unico('Turma c12'),
          p_tz_anchor: ancora,
          p_plan_name: 'Aulas do casal',
          p_hourly_rate_cents: 18000,
          p_teacher: teacher,
        })

      // ordens OPOSTAS no array: se o gatilho não ordenasse, cada transação
      // pediria as linhas na ordem em que os membros foram inseridos.
      const [ida, volta] = await Promise.all([criar([a, b], a), criar([c, b], c)])
      expect(ida.error?.message ?? '', `rodada ${rodada} · ida`).not.toMatch(/deadlock|40P01/i)
      expect(volta.error?.message ?? '', `rodada ${rodada} · volta`).not.toMatch(/deadlock|40P01/i)
      expect(ida.error, `rodada ${rodada} · ida`).toBeNull()
      expect(volta.error, `rodada ${rodada} · volta`).toBeNull()

      const promovidos = await sql<{ status: string }[]>`
        select status from students where id in (${a}, ${b}, ${c})`
      expect(promovidos.every((s) => s.status === 'active'), `rodada ${rodada}`).toBe(true)
    }
  })
})

/* ========================================================================== */
/* nº 3 · duração sana é regra do BANCO                                        */
/* ========================================================================== */

describe('nº 3 · `recurring_slots.duration_min` entre 15 e 480 (Lei 3)', () => {
  it('o banco recusa a duração absurda por QUALQUER porta, não só pelo Zod do wizard', async () => {
    const c = await createPrivateContract(sql)
    // hora DIFERENTE a cada linha: `recurring_slots_active_uniq` é por
    // (contrato, dia, hora, fuso), e o que se prova aqui é a DURAÇÃO.
    const inserir = (min: number, hora: string) => sql`
      insert into recurring_slots
        (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
      values (${c.contractId}, ${c.teacherId}, 6, ${hora}, 'America/Cuiaba', ${min},
              public.business_today() + 200)`

    await expect(inserir(5, '11:00'), '5 minutos não é aula').rejects.toThrow(
      /recurring_slots_duration_sane/,
    )
    await expect(inserir(1440, '12:00'), 'um dia inteiro não é aula').rejects.toThrow(
      /recurring_slots_duration_sane/,
    )
    // as pontas da faixa passam
    await expect(inserir(15, '13:00')).resolves.toBeDefined()
    await expect(inserir(480, '14:00')).resolves.toBeDefined()
  })
})

/* ========================================================================== */
/* nº 4 · professora arquivada                                                 */
/* ========================================================================== */

describe('nº 4 · `admin_create_contract` recusa professora ARQUIVADA', () => {
  it('a mesma frase da RPC da aula experimental, e nenhuma escrita', async () => {
    const teacher = await createTeacher(sql)
    await sql`update teachers set archived_at = now() where id = ${teacher}`
    const aluno = await createStudent(sql)
    const plano = unico('Plano da arquivada')

    const { error } = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: plano,
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/não existe ou está arquivada/)

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from contracts where plan_name = ${plano}`
    expect(Number(n)).toBe(0)
  })
})

/* ========================================================================== */
/* nº 10 + nº 11 · a renovação                                                 */
/* ========================================================================== */

describe('nº 10 · a virada nunca é anterior ao início do contrato renovado', () => {
  it('contrato que só começa em 30 dias não pode virar HOJE (linhagem invertida)', async () => {
    const c = await createPrivateContract(sql)
    await sql`update contracts set started_on = ${daysFromToday(30)} where id = ${c.contractId}`

    const { error } = await admin.rpc('admin_renew_contract', {
      p_old: c.contractId,
      p_switch_on: daysFromToday(0),
      p_plan_name: 'Plano novo',
      p_hourly_rate_cents: 16000,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/anterior ao início do contrato atual/)

    // e a virada NO dia do início passa (a fronteira é fechada dos dois lados)
    const ok = await admin.rpc('admin_renew_contract', {
      p_old: c.contractId,
      p_switch_on: daysFromToday(30),
      p_plan_name: 'Plano novo',
      p_hourly_rate_cents: 16000,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(ok.error).toBeNull()
  })
})

describe('nº 11 · R$0 é CORTESIA, e vale nas duas portas', () => {
  it('criar em cortesia passa; negativo, não', async () => {
    const aluno = await createStudent(sql)
    const teacher = await createTeacher(sql)
    const cortesia = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: unico('Cortesia c12'),
      p_hourly_rate_cents: 0,
      p_teacher: teacher,
    })
    expect(cortesia.error).toBeNull()

    const negativo = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [await createStudent(sql)],
      p_plan_name: unico('Negativo c12'),
      p_hourly_rate_cents: -1,
      p_teacher: teacher,
    })
    expect(negativo.error).not.toBeNull()
    expect(negativo.error!.message).toMatch(/não pode ser negativo/)
  })

  it('RENOVAR em cortesia também passa — era a divergência entre as portas', async () => {
    const c = await createPrivateContract(sql)
    const { error } = await admin.rpc('admin_renew_contract', {
      p_old: c.contractId,
      p_switch_on: daysFromToday(7),
      p_plan_name: 'Plano de cortesia',
      p_hourly_rate_cents: 0,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(error).toBeNull()

    const negativo = await createPrivateContract(sql)
    const r = await admin.rpc('admin_renew_contract', {
      p_old: negativo.contractId,
      p_switch_on: daysFromToday(7),
      p_plan_name: 'Plano inválido',
      p_hourly_rate_cents: -100,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/valor da aula inválido/)
  })
})

/* ========================================================================== */
/* nº 5 · o fuso confirmado do GRUPO é o de TODOS os membros                    */
/* ========================================================================== */

describe('nº 5 · `fusoConfirmado` do detalhe olha os membros da turma', () => {
  async function turmaCom(confirmados: boolean[]) {
    const teacher = await createTeacher(sql)
    const alunos: string[] = []
    for (let i = 0; i < confirmados.length; i++) alunos.push(await createStudent(sql))
    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: alunos,
      p_group_label: unico('Turma do fuso'),
      p_tz_anchor: alunos[0],
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
    })
    expect(error).toBeNull()
    // o contrato já nasceu (o gatilho exige fuso confirmado na criação): o
    // palpite volta DEPOIS, que é o caso real — alguém editou a ficha e o fuso
    // virou chute de novo (o gatilho `students_tz_edit` do c10 · T5).
    for (let i = 0; i < confirmados.length; i++) {
      if (!confirmados[i]) {
        await sql`update students set tz_confirmed = false where id = ${alunos[i]}`
      }
    }
    return (data as { contract_id: string }).contract_id
  }

  it('todos confirmados → confirmado; UM no palpite → não confirmado', async () => {
    const bom = await lerContratoDoDetalhe(admin, await turmaCom([true, true]))
    expect(bom!.grupo, 'é contrato de turma').not.toBeNull()
    expect(bom!.fusoConfirmado, 'os dois membros têm cidade conferida').toBe(true)

    const ruim = await lerContratoDoDetalhe(admin, await turmaCom([true, false]))
    expect(ruim!.fusoConfirmado, 'basta um palpite para o banco recusar horário').toBe(false)
  })
})

/* ========================================================================== */
/* nº 9 · o nome do type-to-confirm vem do SERVIDOR                            */
/* ========================================================================== */
/*
 * ESTE ACEITE MUDOU DE CASA NO c13 · nº 5, e o motivo é o achado seguinte do
 * Sol: buscar o nome no servidor consertava a origem do dado (era um hidden do
 * formulário) e deixava de pé o TOCTOU — a leitura era uma consulta, o
 * encerramento era outra, e entre as duas cabia um `update students set
 * display_name`. `lerNomeDoContrato` foi deletada e a comparação é de
 * `admin_end_contract(p_confirm_name, …)`, dentro da transação. O que este
 * arquivo ainda guarda é a metade que continua verdadeira (o campo oculto
 * morreu); o resto — nome do aluno, rótulo da turma, renomeação no meio do
 * caminho — é provado contra o BANCO em `c13-correcoes-sol-3.test.ts`.
 */

describe('nº 9 · o type-to-confirm não carrega mais os dois lados no formulário', () => {
  it('`confirm_expected` sumiu do formulário e da action', () => {
    expect(codigo('src/components/admin/contratos/paineis.tsx')).not.toContain('confirm_expected')
    expect(codigo('src/app/admin/contratos/actions.ts')).not.toContain('confirm_expected')
    // c13 · nº 5: o que a action manda é o DIGITADO; quem compara é o banco.
    expect(codigo('src/app/admin/contratos/actions.ts')).toContain('p_confirm_name')
  })
})

/* ========================================================================== */
/* nº 20 · chave repetida na query da tela velha                               */
/* ========================================================================== */

describe('nº 20 · `destinoDoLegado` normaliza chave repetida', () => {
  it('`?q=Ana&q=Bia` vale o PRIMEIRO valor — nunca "Ana,Bia"', () => {
    expect(destinoDoLegado({ q: ['Ana', 'Bia'] })).toBe('/admin/alunos/contratos?q=Ana')
    // e o caso simples continua igual
    expect(destinoDoLegado({ q: 'Ana' })).toBe('/admin/alunos/contratos?q=Ana')
  })

  it('vale para TODAS as chaves do mapa, inclusive as que decidem destino', () => {
    // `novo` repetido: o primeiro decide o ramo (e não vira `individual,grupo`,
    // que não é ramo nenhum e cairia no índice)
    expect(destinoDoLegado({ novo: ['grupo', 'individual'] })).toBe(
      '/admin/contratos/novo?tipo=grupo',
    )
    expect(destinoDoLegado({ st: ['paused', 'active'] })).toBe('/admin/alunos/contratos?st=paused')
    expect(destinoDoLegado({ ver: ['professora', 'nivel'] })).toBe(
      '/admin/alunos/contratos?ver=professora',
    )
    expect(destinoDoLegado({ msg: ['oi', 'tchau'], n: ['1', '2'] })).toBe(
      '/admin/alunos/contratos?msg=oi&n=1',
    )
  })

  it('lista VAZIA é ausência, não string vazia', () => {
    expect(destinoDoLegado({ q: [], st: [] })).toBe('/admin/alunos/contratos')
  })
})

/* ========================================================================== */
/* Aceites de forma dos demais achados                                         */
/* ========================================================================== */

describe('nº 6 · gate do fuso DESABILITA a ação em vez de abrir formulário condenado', () => {
  it('o detalhe não oferece "Novo horário"/"Mudar" com fuso no palpite', () => {
    const d = codigo('src/components/admin/contratos/detalhe.tsx')
    expect(d).toContain('const fusoNoPalpite = !contrato.fusoConfirmado')
    // as DUAS ações viram a peça travada do gate — a mesma que a pendência usa
    expect(d).toContain('<AcaoTravada porque="gate-do-fuso">Novo horário</AcaoTravada>')
    expect(d).toContain('<AcaoTravada porque="gate-do-fuso">Mudar</AcaoTravada>')
    // e a peça é um botão DESABILITADO que aponta para a frase do porquê
    expect(d).toContain('<button type="button" disabled className="btn-ac-soft" aria-describedby={porque}>')
    expect(d).toContain('MOTIVO_DO_FUSO')
    expect(d).toContain('id="gate-do-fuso"')
  })

  it('e o painel devolve para o detalhe se alguém digitar o endereço à mão', () => {
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    // os DOIS painéis de horário (novo e trocar) têm a rede
    const redes = p.match(/if \(!contrato\.fusoConfirmado\) redirect\(self\)/g) ?? []
    expect(redes.length).toBe(2)
  })
})

describe('nº 7 · a antecipação do horário pausado alcança 365 dias', () => {
  it('`ocupacao-consulta` expande a mesma janela de `_assert_no_paused_overlap`', () => {
    const o = corpo('src/data/admin/ocupacao-consulta.ts')
    expect(o).toContain('DIAS_DE_PAUSA')
    expect(codigo('src/data/admin/ocupacao-consulta.ts')).toMatch(/DIAS_DE_PAUSA = 365/)
  })
})

describe('nº 8 · a FALHA reabre o painel; o sucesso vai para o detalhe limpo', () => {
  it('os formulários levam o endereço do painel, e a action tem dois destinos', () => {
    const p = codigo('src/components/admin/contratos/paineis.tsx')
    expect(p).toContain('name="back_erro"')
    const a = codigo('src/app/admin/contratos/actions.ts')
    expect(a).toContain('back_erro')
    // o `done` de destino único morreu: quem falha DIZ que falhou, e é isso que
    // escolhe o endereço
    expect(a).toContain('const FALHOU = { falhou: true } as const')
    expect(a).toContain("comRecado(quando?.falhou ? destinoDoErro : destino, msg)")
    // e TODA falha marca (o `Falha: …` genérico das RPCs). Eram oito; o c15
    // acrescentou as duas portas humanas da reserva de assinatura (anexar o id
    // do documento, cancelar a reserva), que são RPC como as outras. A Onda
    // Financeiro (F2) acrescentou a 11ª: a porta da mensalidade.
    expect((a.match(/`Falha: \$\{error\.message\}`, FALHOU\)/g) ?? []).length).toBe(11)
  })

  it('nenhum `done(`Falha…`)` ficou sem o marcador — falha muda de destino', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    for (const linha of a.split('\n')) {
      if (!linha.includes('done(') || !linha.includes('Falha')) continue
      expect(linha, linha.trim()).toContain('FALHOU')
    }
  })
})

describe('nº 12 · o erro da criação atômica remonta a etapa 2 COM TUDO', () => {
  it('a action devolve o rascunho na URL e a etapa o recebe', () => {
    const a = codigo('src/app/admin/alunos/novo/actions.ts')
    expect(a).toContain('rascunhoDoContrato')
    const e = codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')
    expect(e).toContain('rascunho')
  })
})

describe('nº 13 · a confirmação de cidades responde POR MEMBRO', () => {
  it('a action devolve o resultado de cada aluno e o wizard só marca quem passou', () => {
    const a = codigo('src/app/admin/contratos/novo/actions.ts')
    expect(a).toContain('porAluno')
    const w = codigo('src/app/admin/contratos/novo/WizardDeContrato.tsx')
    expect(w).toContain('porAluno')
  })
})

describe('nº 14 · o harness não reusa servidor de build velho', () => {
  // c13 · nº 7: a DECISÃO saiu de `servidor.ts` (que tem efeito) para
  // `tests/e2e/porta.ts` (que não tem), e por isso ela deixou de ser conferida
  // por grep e passou a ser provada por comportamento em
  // `c13-correcoes-sol-3.test.ts`. O que sobra aqui é a costura: o setup lê o
  // BUILD_ID do disco e obedece à decisão.
  it('o BUILD_ID do disco é lido e a decisão vem do módulo puro', () => {
    const s = codigo('tests/e2e/servidor.ts')
    expect(s).toContain('BUILD_ID')
    expect(s).toContain('decidirSobreAPorta')
    expect(s).toMatch(/derrub|kill/i)
  })
})

describe('nº 15 · o aceite do AlertDialog está adiado por ADR, não esquecido', () => {
  it('o comentário do teste substituto cita o ADR-028', () => {
    expect(corpo('tests/e2e/onda1.spec.ts')).toContain('ADR-028')
  })
})

describe('nº 16 · nenhum <select> nativo no Registrar desfecho', () => {
  const VARRIDOS = [
    'src/components/admin/inicio/RegistrarDesfecho.tsx',
    'src/components/admin/contratos/paineis.tsx',
    'src/components/admin/contratos/detalhe.tsx',
    'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
    'src/app/admin/contratos/novo/WizardDeContrato.tsx',
  ]
  it.each(VARRIDOS)('%s não tem <select>/<option> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })
  it('o Select do desfecho sobe acima do véu do Sheet', () => {
    expect(corpo('src/components/admin/inicio/RegistrarDesfecho.tsx')).toContain('z-60')
  })
})

describe('nº 17 · a lavagem do cartão de produto ficou mais pesada, e os números estão no código', () => {
  const componente = () => corpo('src/components/admin/alunos/CartaoDeGrupo.tsx')

  /** Os três alfas do `linear-gradient(90deg, …)`, na ordem em que aparecem. */
  function alfasDaLavagem(): number[] {
    const linha = /const LAVAGEM =\s*'([^']+)'/.exec(componente())?.[1] ?? ''
    return [...linha.matchAll(/var\(--ink-900\)\s+(\d+)%/g)].map((m) => Number(m[1]))
  }

  it('nenhum stop é mais claro do que o que foi MEDIDO (88 · 74 · 66)', () => {
    // A régua é ≥, e não =: escurecer mais é sempre seguro; clarear reabre o
    // buraco que o Sol mediu (4.495:1 no avião do Personal Travel). O pior caso
    // com estes stops é 5.487:1 na caixa inteira do `p-4`, contando o
    // `text-white/85` — os números estão no comentário do componente.
    const [inicio, meio, fim] = alfasDaLavagem()
    expect([inicio, meio, fim], 'os três stops do gradiente').toHaveLength(3)
    expect(inicio).toBeGreaterThanOrEqual(88)
    expect(meio).toBeGreaterThanOrEqual(74)
    expect(fim).toBeGreaterThanOrEqual(66)
    // e o gradiente continua sendo um gradiente (mais tinta à esquerda)
    expect(inicio).toBeGreaterThanOrEqual(meio)
    expect(meio).toBeGreaterThanOrEqual(fim)
  })

  // c13 · nº 12: os números do comentário passaram a ser os que
  // `scripts/brand/medir-lavagem.mjs` IMPRIME (dois dos antigos não
  // reproduziam), e quem confere isso é `c13-correcoes-sol-3.test.ts`, rodando o
  // medidor de verdade. Aqui fica só o que este lote prometeu: que a medição
  // está registrada no código, com o número que motivou a mudança.
  it('a medição está registrada no código, com o número que reprovou os stops antigos', () => {
    expect(componente()).toContain('4.495:1')
  })
})

describe('nº 21 · os scripts de marca dizem o que é reprodutível e onde', () => {
  it.each([
    'scripts/brand/lockup-personal-one.mjs',
    'scripts/brand/publicar-produtos.mjs',
  ])('%s explica que o insumo fica fora do git', (rel) => {
    const c = corpo(rel)
    expect(c).toMatch(/MÁQUINA DA CASA/)
    expect(c).toMatch(/fora do git|gitignorad/i)
  })
})
