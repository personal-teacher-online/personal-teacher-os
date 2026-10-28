// ONDA 1 · M4-3 — o WIZARD `/admin/contratos/novo` e a ÚNICA migration do M4:
// `admin_create_contract`, a porta que faz nascer contrato numa transação só.
//
// Cobre, nesta ordem:
//  · a RPC contra a bancada — ATOMICIDADE do grupo (o horário conflitante na
//    SEGUNDA posição não pode deixar grupo, membro nem contrato para trás),
//    gate admin, fuso-palpite, âncora obrigatória, promoção lead→ativo,
//    reativação de arquivado e o ramo mentoria (contrato sem horário);
//  · a gramática pura do wizard (ramos, etapas por ramo, endereço, payload);
//  · os aceites da tela nova: rota, stepper vindo do kit (e a admissão
//    consumindo o MESMO), botão do índice virado, zero query inline, mentoria
//    pulando a etapa de horários;
//  · o render do wizard (o grep não prova que a peça desenha).
//
// O QUE NÃO DÁ PARA CHAMAR AQUI: `getNewContractContext()` monta o cliente
// Supabase a partir dos cookies do request (`server-only`). Por isso o corpo da
// leitura mora em `contrato-novo-consulta.ts`, que RECEBE o cliente — é essa
// função que a página chama e que o teste executa com um admin de verdade
// (mesmo arranjo de `contrato-detalhe.ts` no M4-2).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

// As server actions do wizard importam `@/lib/supabase/server` → `server-only`,
// que LANÇA fora da condição `react-server` (é essa a função do pacote). O
// componente só as usa no clique; para DESENHAR ele, o módulo é substituído por
// um duplo — assim o render do wizard entra na suíte em vez de ficar só no e2e.
vi.mock('@/app/admin/contratos/novo/actions', () => ({
  criarContratoAction: async () => ({ ok: false, mensagem: 'duplo de teste' }),
  confirmarCidadesAction: async () => ({ ok: false, mensagem: 'duplo de teste' }),
}))

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createStudent, createTeacher } from './helpers/db'
import { WizardDeContrato } from '@/app/admin/contratos/novo/WizardDeContrato'
import {
  LINHAS_POR_PAGINA,
  lerContextoDoNovoContrato,
  lerTudoPaginado,
} from '@/data/admin/contrato-novo-consulta'
import {
  ETAPAS_DO_CONTRATO,
  RAMOS_DO_CONTRATO,
  RAMO_CONSEQUENCIA,
  RAMO_ROTULO,
  NovoContratoSchema,
  ehRamoDeContrato,
  enderecoDoNovoContrato,
  etapasDoRamo,
  temEtapaDeHorarios,
  temEtapaDePolitica,
} from '@/data/admin/contrato-novo'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Nome único por rodada — a bancada é compartilhada entre arquivos. */
const unico = (prefixo: string) => `${prefixo} ${crypto.randomUUID().slice(0, 8)}`

/* ========================================================================== */
/* 1. `admin_create_contract` contra o banco                                   */
/* ========================================================================== */

describe('admin_create_contract (contra o banco local)', () => {
  let sql: Sql
  let admin: SupabaseClient
  let professora: SupabaseClient
  // Prefixo das reservas do caso de >1.000 alunos. Fica no escopo do describe
  // para o `afterAll` apagar o que sobrar se o caso estourar o tempo.
  const prefixoDasReservas = unico('Reserva M4-3')
  const apagarReservas = (conexao: Sql) =>
    conexao`delete from students where display_name like ${'%' + prefixoDasReservas + '%'}`

  beforeAll(async () => {
    sql = connect(3)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M4-3'), 'admin')
    professora = await clientAs(await createAuthUser(sql, 'teacher', 'Teacher M4-3'), 'teacher')
  })
  afterAll(async () => {
    await apagarReservas(sql)
    await sql.end()
  })

  it('individual: contrato + horário fixo numa chamada só, com auditoria', async () => {
    const aluno = await createStudent(sql)
    const teacher = await createTeacher(sql)
    const plano = unico('Plano individual')

    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: plano,
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_slots: [{ weekday: 2, local_time: '20:30', duration_min: 45 }],
    })
    expect(error).toBeNull()
    const r = data as { contract_id: string; group_id: string | null; slot_ids: string[] }
    expect(r.group_id).toBeNull()
    expect(r.slot_ids).toHaveLength(1)

    const [c] = await sql<
      { student_id: string; plan_name: string; hourly_rate_cents: number; allowance: number; min_notice: number }[]
    >`
      select student_id, plan_name, hourly_rate_cents,
             monthly_reschedule_allowance as allowance, min_notice_hours as min_notice
        from contracts where id = ${r.contract_id}`
    expect(c.student_id).toBe(aluno)
    expect(c.plan_name).toBe(plano)
    // Lei 9: centavos entram como centavos
    expect(Number(c.hourly_rate_cents)).toBe(15000)
    // POLICY por parâmetro, com o default do app (item 12)
    expect(Number(c.min_notice)).toBe(24)
    expect(Number(c.allowance)).toBe(4)

    // o horário nasceu pela RPC de sempre — e ela materializou as aulas
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances where contract_id = ${r.contract_id}`
    expect(Number(n)).toBeGreaterThan(0)

    // Lei 8: a criação inteira vira UMA linha de auditoria
    const [aud] = await sql<{ diff: { kind: string; plan_name: string } }[]>`
      select diff from audit_log
       where action = 'admin_create_contract' and entity_id = ${r.contract_id}`
    expect(aud.diff.kind).toBe('individual')
    expect(aud.diff.plan_name).toBe(plano)
  })

  it('grupo: turma, membros, contrato e DOIS horários — tudo na mesma transação', async () => {
    const a = await createStudent(sql)
    const b = await createStudent(sql)
    const teacher = await createTeacher(sql)
    const turma = unico('Casal M4-3')

    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: [a, b],
      p_group_label: turma,
      p_tz_anchor: b,
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
      p_slots: [
        { weekday: 1, local_time: '07:00', duration_min: 45 },
        { weekday: 5, local_time: '07:00', duration_min: 45 },
      ],
    })
    expect(error).toBeNull()
    const r = data as { contract_id: string; group_id: string; slot_ids: string[] }
    expect(r.group_id).not.toBeNull()
    expect(r.slot_ids).toHaveLength(2)

    const membros = await sql<{ student_id: string }[]>`
      select student_id from student_group_members where group_id = ${r.group_id} order by student_id`
    expect(membros.map((m) => m.student_id).sort()).toEqual([a, b].sort())

    const [c] = await sql<{ student_id: string | null; anchor: string }[]>`
      select student_id, group_tz_anchor_student as anchor from contracts where id = ${r.contract_id}`
    // ADR-002: aluno XOR grupo
    expect(c.student_id).toBeNull()
    expect(c.anchor).toBe(b)
  })

  it('ATOMICIDADE: horário conflitante na 2ª posição não deixa NADA para trás', async () => {
    const teacher = await createTeacher(sql)
    // a agenda que já existe: outra aluna, quarta 20:00 com esta professora
    const ocupada = await createStudent(sql)
    const primeiro = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [ocupada],
      p_plan_name: 'Aulas particulares',
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
      p_slots: [{ weekday: 3, local_time: '20:00', duration_min: 45 }],
    })
    expect(primeiro.error).toBeNull()

    const a = await createStudent(sql)
    const b = await createStudent(sql)
    const turma = unico('Turma que não nasce')

    const { error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: [a, b],
      p_group_label: turma,
      p_tz_anchor: a,
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
      p_slots: [
        // este passaria…
        { weekday: 6, local_time: '10:00', duration_min: 45 },
        // …e este atropela a agenda da professora
        { weekday: 3, local_time: '20:00', duration_min: 45 },
      ],
    })
    expect(error, 'o banco recusa o segundo horário').not.toBeNull()
    expect(error!.message).toMatch(/já tem aula|exclusion|sobrepos/i)

    // NADA persistiu: nem turma, nem membros, nem contrato, nem o primeiro slot
    const [{ grupos }] = await sql<{ grupos: number }[]>`
      select count(*)::int as grupos from student_groups where label = ${turma}`
    expect(Number(grupos), 'a turma não ficou órfã no banco').toBe(0)
    const [{ vinculos }] = await sql<{ vinculos: number }[]>`
      select count(*)::int as vinculos from student_group_members where student_id in (${a}, ${b})`
    expect(Number(vinculos)).toBe(0)
    const [{ contratos }] = await sql<{ contratos: number }[]>`
      select count(*)::int as contratos from contracts
       where student_id in (${a}, ${b})
          or student_group_id in (select id from student_groups where label = ${turma})`
    expect(Number(contratos)).toBe(0)
    const [{ slots }] = await sql<{ slots: number }[]>`
      select count(*)::int as slots from recurring_slots
       where teacher_id = ${teacher} and weekday = 6`
    expect(Number(slots), 'o horário que já tinha passado também voltou atrás').toBe(0)
  })

  it('gate admin: professora não cria contrato', async () => {
    const aluno = await createStudent(sql)
    const teacher = await createTeacher(sql)
    const { error } = await professora.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: 'Aulas particulares',
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('restrita à admin')
  })

  it('fuso PALPITE recusa o contrato inteiro (Lei 1)', async () => {
    const aluno = await createStudent(sql)
    await sql`update students set tz_confirmed = false where id = ${aluno}`
    const teacher = await createTeacher(sql)
    const plano = unico('Plano do palpite')

    const { error } = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [aluno],
      p_plan_name: plano,
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('palpite')
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from contracts where plan_name = ${plano}`
    expect(Number(n)).toBe(0)
  })

  it('grupo SEM âncora de fuso recusa antes de escrever qualquer coisa (P1)', async () => {
    const a = await createStudent(sql)
    const b = await createStudent(sql)
    const teacher = await createTeacher(sql)
    const turma = unico('Turma sem âncora')

    const { error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: [a, b],
      p_group_label: turma,
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('âncora de fuso')

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from student_groups where label = ${turma}`
    expect(Number(n)).toBe(0)

    // âncora que não é da turma também não cola
    const forasteiro = await createStudent(sql)
    const outra = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: [a, b],
      p_group_label: turma,
      p_tz_anchor: forasteiro,
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: teacher,
    })
    expect(outra.error).not.toBeNull()
    expect(outra.error!.message).toContain('âncora de fuso')
  })

  it('a promoção lead→ativo dispara, e a RPC diz QUEM foi promovido', async () => {
    const lead = await createStudent(sql)
    await sql`update students set status = 'lead', display_name = 'Lead do M4-3' where id = ${lead}`
    const teacher = await createTeacher(sql)

    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [lead],
      p_plan_name: 'Aulas particulares',
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
    })
    expect(error).toBeNull()
    const r = data as { promoted: { id: string; nome: string; de: string }[] }
    expect(r.promoted).toHaveLength(1)
    expect(r.promoted[0]).toMatchObject({ id: lead, nome: 'Lead do M4-3', de: 'lead' })

    const [s] = await sql<{ status: string }[]>`select status from students where id = ${lead}`
    expect(s.status).toBe('active')
    // e a transição é auditada com nome próprio, pelo gatilho de sempre
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where action = 'lead_promoted' and entity_id = ${lead}`
    expect(Number(n)).toBe(1)

    // aluno que JÁ era ativo não entra na lista (nada a anunciar)
    const ativo = await createStudent(sql)
    const outro = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [ativo],
      p_plan_name: 'Aulas particulares',
      p_hourly_rate_cents: 15000,
      p_teacher: teacher,
    })
    expect((outro.data as { promoted: unknown[] }).promoted).toEqual([])
  })

  it('mentoria: contrato simples, sem horário fixo e sem franquia', async () => {
    const aluno = await createStudent(sql)
    const plano = unico('Personal Travel')

    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'mentorship',
      p_students: [aluno],
      p_plan_name: plano,
      p_hourly_rate_cents: 7000,
    })
    expect(error).toBeNull()
    const r = data as { contract_id: string; slot_ids: string[] }
    expect(r.slot_ids).toEqual([])

    const [c] = await sql<
      { tipo: string; teacher_id: string | null; allowance: number | null; min_notice: number | null }[]
    >`
      select contract_type as tipo, teacher_id,
             monthly_reschedule_allowance as allowance, min_notice_hours as min_notice
        from contracts where id = ${r.contract_id}`
    expect(c.tipo).toBe('mentorship')
    expect(c.teacher_id).toBeNull()
    // `contracts_private_fields` só exige os campos de remarcação no particular
    expect(c.allowance).toBeNull()
    expect(c.min_notice).toBeNull()

    // a extensão nasce junto (e com ela a régua de progresso padrão, pelo gatilho)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from mentorship_contracts where contract_id = ${r.contract_id}`
    expect(Number(n)).toBe(1)

    // e horário fixo em mentoria é recusado com nome, não com erro de constraint
    const comHorario = await admin.rpc('admin_create_contract', {
      p_kind: 'mentorship',
      p_students: [aluno],
      p_plan_name: plano,
      p_hourly_rate_cents: 7000,
      p_slots: [{ weekday: 2, local_time: '20:30', duration_min: 45 }],
    })
    expect(comHorario.error).not.toBeNull()
    expect(comHorario.error!.message).toContain('mentoria não tem horário fixo')
  })

  it('a leitura do wizard entrega alunos por situação, planos, professoras e a ocupação por fuso', async () => {
    const aluno = await createStudent(sql, 'Europe/Lisbon')
    await sql`update students set display_name = 'Aluna de Lisboa M4-3' where id = ${aluno}`
    const teacher = await createTeacher(sql)
    await sql`update teachers set display_name = 'Professora M4-3' where id = ${teacher}`

    const ctx = await lerContextoDoNovoContrato(admin)
    const encontrado = ctx.alunos.find((a) => a.id === aluno)
    expect(encontrado, 'o aluno novo aparece no seletor').toBeDefined()
    expect(encontrado!.nome).toBe('Aluna de Lisboa M4-3')
    expect(encontrado!.fusoConfirmado).toBe(true)
    expect(encontrado!.iana).toBe('Europe/Lisbon')
    // Lei 1: o rótulo do fuso sai formatado do servidor
    expect(encontrado!.fuso).toBeTruthy()
    expect(ctx.professoras.some((t) => t.id === teacher)).toBe(true)
    // A OCUPAÇÃO VEM POR FUSO, e balde AUSENTE não é balde vazio: a leitura da
    // agenda é antecipação (quem recusa é a exclusão GiST) e pode falhar sozinha
    // numa base grande — foi o que aconteceu na bancada com milhares de
    // fixtures, e é por isso que a tela distingue "não li" de "não tem nada".
    // O que se prova aqui é o CONTRATO da forma: só zonas de alunos viram
    // chave, e o que existe é lista de janelas daquele relógio.
    const zonasDosAlunos = new Set(ctx.alunos.map((a) => a.iana))
    for (const [zona, janelas] of Object.entries(ctx.ocupacaoPorFuso)) {
      expect(zonasDosAlunos.has(zona), zona).toBe(true)
      expect(Array.isArray(janelas)).toBe(true)
    }
    expect(ctx.hojeIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('com mais de 1.000 alunos na base, quem está depois da milésima ficha aparece com o fuso confirmado', async () => {
    // O PostgREST corta a resposta em 1.000 linhas (`max_rows`). A bancada pode
    // estar acima ou abaixo disso, então o teste completa o que falta com
    // reservas próprias (nome com prefixo, apagadas no `finally`) até passar de
    // mil — assim ele vale também no CI, que parte de uma base limpa.
    const prefixo = prefixoDasReservas
    // O seletor tira os anonimizados, e outros arquivos da suíte anonimizam e
    // apagam alunos em paralelo: a conta é sobre quem NÃO é anonimizado, com
    // folga larga para a base poder encolher durante a leitura.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from students where anonymized_at is null`
    const faltam = Math.max(0, LINHAS_POR_PAGINA + 100 - Number(n))
    try {
      if (faltam > 0) {
        await sql`
          insert into students (display_name, iana_tz, tz_confirmed)
          select ${prefixo} || ' ' || g, 'America/Cuiaba', true from generate_series(1, ${faltam}) g`
      }
      // As duas fichas do teste ficam no FIM das duas ordens que a leitura usa:
      // o diretório ordena por nome ("Zzz") e `students` por `id` (uuid fixo no
      // topo). Sem isso, um uuid aleatório poderia cair antes da milésima e o
      // caso passaria mesmo sem paginar `students`.
      const idNoFim = () => `ffffffff-ffff-4fff-8fff-fffff${crypto.randomUUID().slice(0, 7).replace('-', '0')}`
      const [{ id: aluno }] = await sql<{ id: string }[]>`
        insert into students (id, display_name, iana_tz, tz_confirmed)
        values (${idNoFim()}, ${'Zzz fim da fila ' + prefixo}, 'America/Cuiaba', true)
        returning id`
      const [{ id: anonimizado }] = await sql<{ id: string }[]>`
        insert into students (id, display_name, iana_tz, tz_confirmed)
        values (${idNoFim()}, ${'Zzz anonimizado ' + prefixo}, 'America/Cuiaba', true)
        returning id`
      await sql`update students set anonymized_at = now() where id = ${anonimizado}`

      const ctx = await lerContextoDoNovoContrato(admin)
      expect(ctx.alunos.length).toBeGreaterThan(LINHAS_POR_PAGINA)
      const achado = ctx.alunos.find((a) => a.id === aluno)
      expect(achado, 'o aluno depois da milésima ficha aparece no seletor').toBeDefined()
      expect(achado!.fusoConfirmado).toBe(true)
      expect(ctx.alunos.some((a) => a.id === anonimizado), 'anonimizado fica fora').toBe(false)
      // nenhuma ficha repetida entre páginas
      expect(new Set(ctx.alunos.map((a) => a.id)).size).toBe(ctx.alunos.length)
    } finally {
      await apagarReservas(sql)
    }
  }, 60_000)
})

/* ========================================================================== */
/* 1b. A leitura paginada (pura — sem banco)                                   */
/* ========================================================================== */

describe('lerTudoPaginado', () => {
  /** Um PostgREST de mentira: devolve a fatia pedida, mas nunca mais que o teto. */
  const base = (total: number) => Array.from({ length: total }, (_, i) => ({ id: i }))
  const comTeto = (linhas: { id: number }[], chamadas: number[][] = []) =>
    async (de: number, ate: number) => {
      chamadas.push([de, ate])
      return { data: linhas.slice(de, Math.min(ate + 1, de + LINHAS_POR_PAGINA)), error: null }
    }

  it('junta todas as páginas até a última, mesmo passando do teto de 1.000', async () => {
    const chamadas: number[][] = []
    const lidas = await lerTudoPaginado<{ id: number }>('teste', comTeto(base(2305), chamadas))
    expect(lidas).toHaveLength(2305)
    expect(lidas[2304]).toEqual({ id: 2304 })
    // uma ida por página (mais a vazia que encerra), não uma por linha
    expect(chamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2305, 3304],
    ])
  })

  it('base pequena: uma página e a vazia que encerra', async () => {
    const chamadas: number[][] = []
    expect(await lerTudoPaginado('teste', comTeto(base(7), chamadas))).toHaveLength(7)
    expect(chamadas).toHaveLength(2)
  })

  it('servidor com teto MENOR que a página pedida não trunca a lista', async () => {
    const linhas = base(1300)
    const chamadas: number[][] = []
    const teto500 = async (de: number, ate: number) => {
      chamadas.push([de, ate])
      return { data: linhas.slice(de, Math.min(ate + 1, de + 500)), error: null }
    }
    expect(await lerTudoPaginado('teste', teto500)).toHaveLength(1300)
  })

  it('base vazia e `data` nulo devolvem lista vazia', async () => {
    expect(await lerTudoPaginado('teste', comTeto([]))).toEqual([])
    expect(await lerTudoPaginado('teste', async () => ({ data: null, error: null }))).toEqual([])
  })

  it('erro de qualquer página derruba a leitura, dizendo o que falhou', async () => {
    await expect(
      lerTudoPaginado('os alunos', async () => ({ data: null, error: { message: 'boom' } })),
    ).rejects.toThrow('falha ao ler os alunos: boom')
  })
})

/* ========================================================================== */
/* 2. A gramática pura do wizard                                               */
/* ========================================================================== */

describe('gramática do wizard de contrato', () => {
  it('os três ramos, cada um com rótulo e UMA frase de consequência', () => {
    expect([...RAMOS_DO_CONTRATO]).toEqual(['individual', 'grupo', 'mentoria'])
    for (const r of RAMOS_DO_CONTRATO) {
      expect(RAMO_ROTULO[r], r).toBeTruthy()
      expect(RAMO_CONSEQUENCIA[r], r).toBeTruthy()
    }
  })

  it('`?tipo=` recusa o que não é ramo', () => {
    expect(ehRamoDeContrato('grupo')).toBe(true)
    expect(ehRamoDeContrato('mentoria')).toBe(true)
    expect(ehRamoDeContrato('qualquer')).toBe(false)
    expect(ehRamoDeContrato(undefined)).toBe(false)
  })

  it('a mentoria pula horários e política; o particular passa pelos seis passos', () => {
    expect(etapasDoRamo('individual')).toEqual([...ETAPAS_DO_CONTRATO])
    expect(etapasDoRamo('grupo')).toEqual([...ETAPAS_DO_CONTRATO])
    expect(temEtapaDeHorarios('individual')).toBe(true)
    expect(temEtapaDeHorarios('grupo')).toBe(true)
    expect(temEtapaDeHorarios('mentoria')).toBe(false)
    expect(temEtapaDePolitica('mentoria')).toBe(false)
    const mentoria = etapasDoRamo('mentoria')
    expect(mentoria).toEqual(['Tipo', 'Aluno', 'Valores', 'Revisão'])
  })

  it('o endereço do wizard leva (ou não) o tipo pré-escolhido', () => {
    expect(enderecoDoNovoContrato()).toBe('/admin/contratos/novo')
    expect(enderecoDoNovoContrato('grupo')).toBe('/admin/contratos/novo?tipo=grupo')
  })

  it('o payload é validado ANTES de virar RPC (entrada de fora nunca é confiável)', () => {
    const base = {
      ramo: 'individual' as const,
      alunos: ['11111111-1111-1111-1111-111111111111'],
      ancora: null,
      rotuloDoGrupo: '',
      professora: '22222222-2222-2222-2222-222222222222',
      plano: 'Aulas particulares',
      valorCentavos: 15000,
      remarcacoes: 4,
      inicio: '2026-07-27',
      horarios: [{ weekday: 2, local_time: '20:30', duration_min: 45 }],
    }
    expect(NovoContratoSchema.safeParse(base).success).toBe(true)
    // plano vazio, valor negativo, dia fora da semana e hora que não é hora
    expect(NovoContratoSchema.safeParse({ ...base, plano: '  ' }).success).toBe(false)
    expect(NovoContratoSchema.safeParse({ ...base, valorCentavos: -1 }).success).toBe(false)
    expect(
      NovoContratoSchema.safeParse({ ...base, horarios: [{ weekday: 9, local_time: '20:30', duration_min: 45 }] })
        .success,
    ).toBe(false)
    expect(
      NovoContratoSchema.safeParse({ ...base, horarios: [{ weekday: 2, local_time: '25:99', duration_min: 45 }] })
        .success,
    ).toBe(false)
    // grupo exige dois alunos e uma âncora entre eles
    expect(
      NovoContratoSchema.safeParse({ ...base, ramo: 'grupo', rotuloDoGrupo: 'Casal' }).success,
      'grupo com um aluno só',
    ).toBe(false)
  })
})

/* ========================================================================== */
/* 3. Aceites da tela nova                                                     */
/* ========================================================================== */

const ARQUIVOS_DO_M4_3 = [
  'src/components/kit/stepper.tsx',
  'src/data/admin/contrato-novo.ts',
  'src/data/admin/contrato-novo-consulta.ts',
  'src/app/admin/contratos/novo/WizardDeContrato.tsx',
  'src/app/admin/contratos/novo/page.tsx',
]

describe('aceites do M4-3', () => {
  it.each(ARQUIVOS_DO_M4_3)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_DO_M4_3)('%s não abre overlay fora do kit nem usa `<details data-popup>`', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  it.each(ARQUIVOS_DO_M4_3)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  it.each(ARQUIVOS_DO_M4_3)('%s não fabrica `?msg=` nem nonce', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
  })

  it.each(ARQUIVOS_DO_M4_3)('%s não rebaixa dado para 12px nem para o cinza de apoio', (rel) => {
    const c = codigo(rel).replace(/(?:placeholder|data-\[placeholder\]):text-ink-400/g, '')
    expect(c).not.toMatch(/text-xs/)
    expect(c).not.toMatch(/text-ink-400/)
    expect(c).not.toMatch(/text-\[1[0-3]px\]/)
    expect(c).not.toMatch(/font-(light|extralight)/)
  })

  it.each(ARQUIVOS_DO_M4_3)('%s não formata data no cliente (Lei 1)', (rel) => {
    const c = codigo(rel)
    if (!c.startsWith("'use client'")) return
    expect(c, rel).not.toMatch(/new Date\(|toLocaleString|DateTime\./)
  })

  it('nenhum título do M4-3 inventa tamanho (as duas réguas da casa)', () => {
    for (const rel of ARQUIVOS_DO_M4_3) {
      for (const tag of codigo(rel).match(/<h[1-3][^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/title-(page|section)/)
      }
    }
  })

  it('a rota nova existe, hospeda o índice por baixo e não faz query inline', () => {
    const p = codigo('src/app/admin/contratos/novo/page.tsx')
    expect(p).not.toContain('@/lib/supabase')
    expect(p).not.toMatch(/\.from\(/)
    expect(p).not.toMatch(/\.rpc\(/)
    expect(p).toContain('getNewContractContext')
    // o índice por baixo + o Sheet largo do kit, aberto na URL própria
    expect(p).toContain('PainelDeUrl')
    expect(p).toContain("voltarPara=\"/admin/alunos/contratos\"")
    expect(p).toContain('<WizardDeContrato')
  })

  it('o stepper virou peça do KIT — e a admissão passou a consumi-lo', () => {
    const kit = corpo('src/components/kit/stepper.tsx')
    // a anatomia medida continua inteira (círculo, ✓, anel do acento, respiro)
    expect(kit).toContain('rounded-full')
    expect(kit).toContain('ring-2 ring-ac-vivid/40')
    expect(kit).toMatch(/border-b border-line-soft py-5/)
    expect(kit).toMatch(/estado === 'feita' \? <Check/)
    expect(kit).toMatch(/aria-current=\{estado === 'atual' \? 'step'/)

    const admissao = corpo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    expect(admissao).toContain("from '@/components/kit/stepper'")
    expect(admissao).toContain('<Stepper')
    // e o wizard novo usa a MESMA peça (é isso que faz os dois parecerem um só)
    expect(corpo('src/app/admin/contratos/novo/WizardDeContrato.tsx')).toContain(
      "from '@/components/kit/stepper'",
    )
  })

  it('o botão do índice aponta para o wizard (a porta da tela velha morreu aqui)', () => {
    const p = corpo('src/app/admin/alunos/contratos/page.tsx')
    // o endereço sai da gramática (não é literal em duas telas)
    expect(p).toContain('const NOVO_CONTRATO = enderecoDoNovoContrato()')
    expect(p).not.toContain("'/admin/contratos?novo=individual'")
    expect(enderecoDoNovoContrato()).toBe('/admin/contratos/novo')
    expect(p).toMatch(/href=\{NOVO_CONTRATO\}\s+className="btn-ac"/)
  })

  it('a criação passa pela RPC nova — e a action não reimplementa regra nenhuma', () => {
    const a = corpo('src/app/admin/contratos/novo/actions.ts')
    expect(a).toContain("supabase.rpc('admin_create_contract'")
    // o fuso-palpite se resolve pelo ATO de sempre (c9 · S3), não por update
    expect(a).toContain('confirmarLocalizacao')
    expect(a).toContain('requireAdminId')
    // nada de INSERT solto: a porta é uma só
    expect(codigo('src/app/admin/contratos/novo/actions.ts')).not.toMatch(/\.from\(/)
    // e o payload que chega do cliente é validado antes de virar chamada
    expect(a).toContain('NovoContratoSchema')
  })

  it('a migration chama `create_slot` em vez de reescrever a regra do horário', () => {
    const m = corpo('supabase/migrations/20260727001100_admin_create_contract.sql')
    expect(m).toContain('public.create_slot(')
    expect(m).toContain("public.app_role() <> 'admin'")
    expect(m).toContain('public.log_audit(')
    // nenhum insert em recurring_slots/class_instances: a regra mora onde já morava
    expect(m).not.toMatch(/insert\s+into\s+recurring_slots/i)
    expect(m).not.toMatch(/insert\s+into\s+class_instances/i)
    // a ordem canônica de locks está citada e justificada (a lei da casa)
    expect(m).toContain('ORDEM CANÔNICA GLOBAL DE LOCKS')
    expect(m).toContain('teacher_agenda')
  })
})

/* ========================================================================== */
/* 4. Render (o grep não prova que a peça desenha)                             */
/* ========================================================================== */

const CONTEXTO = {
  alunos: [
    {
      id: 's-1',
      nome: 'Elisa Faria',
      situacao: 'ativo' as const,
      situacaoRotulo: 'ativo',
      iana: 'America/Cuiaba',
      fuso: 'Cuiabá',
      cidade: 'Cuiabá',
      pais: 'Brasil',
      fusoConfirmado: true,
      temAcesso: true,
    },
    {
      id: 's-2',
      nome: 'Lead do Palpite',
      situacao: 'lead' as const,
      situacaoRotulo: 'lead',
      iana: 'America/Cuiaba',
      fuso: 'Cuiabá',
      cidade: '',
      pais: '',
      fusoConfirmado: false,
      temAcesso: false,
    },
  ],
  professoras: [{ id: 't-1', nome: 'Dona' }],
  planos: ['Aulas particulares'],
  ocupacaoPorFuso: { 'America/Cuiaba': [] },
  hojeIso: '2026-07-27',
}

const desenhar = (tipo?: 'individual' | 'grupo' | 'mentoria') =>
  renderToStaticMarkup(h(WizardDeContrato, { contexto: CONTEXTO, tipoInicial: tipo ?? null }))

describe('o wizard desenha', () => {
  it('abre na etapa do TIPO, com os três radios-de-consequência', () => {
    const html = desenhar()
    for (const r of RAMOS_DO_CONTRATO) {
      expect(html, RAMO_ROTULO[r]).toContain(RAMO_ROTULO[r])
      expect(html, RAMO_CONSEQUENCIA[r]).toContain(RAMO_CONSEQUENCIA[r].slice(0, 30))
    }
    // o stepper do kit, com os seis passos do particular
    for (const etapa of ETAPAS_DO_CONTRATO) expect(html, etapa).toContain(`>${etapa}<`)
  })

  it('`?tipo=mentoria` já abre no ramo curto — sem Horários no stepper', () => {
    const html = desenhar('mentoria')
    expect(html).not.toContain('>Horários<')
    expect(html).not.toContain('>Política<')
    expect(html).toContain('>Valores<')
  })
})
