// ONDA 1 · M4-1 — índice de contratos: o que a camada de dados lê, o que a
// gramática recorta e o que a tela nova promete, provado.
//
// Cobre:
//  · as SETE leituras de `getContractsIndex()` contra o banco de verdade,
//    executadas como admin (uma grant que sumir ou uma RLS que apertar estoura
//    AQUI, não na tela da dona) — com os schemas Zod da camada por cima;
//  · a gramática pura: montagem da linha (identidade de grupo, os dois avisos
//    da tela velha), os GRUPOS do "ver por" (um grupo por contrato, na ordem da
//    casa, com slug de URL e pendência) e o casamento da busca;
//  · os aceites de grep da tela nova (zero query inline, sem `<select>`, sem
//    cor fora do acento, régua de legibilidade) e o giro das abas: as três
//    telas do hub passaram a apontar para `/admin/alunos/contratos`;
//  · o render da lista — os CARTÕES de acesso do "ver por" e a troca deles pela
//    tabela quando há busca escrita (portão visual do dono, 27/07/2026: o "ver
//    por" deixou de ser pilha de seções e virou cartão, como a aba Alunos).
//
// O QUE NÃO DÁ PARA CHAMAR AQUI, e por quê: `getContractsIndex()` monta o
// cliente Supabase a partir dos cookies do request (`server-only`), e montar
// essa condição no Vitest seria inventar harness. Por isso as leituras são
// reproduzidas com um cliente de admin real e conferidas pelos MESMOS schemas
// que a camada usa — é o payload que se prova, não a string da query.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createMentorshipContract, createPrivateContract, createSlot } from './helpers/db'
import { CartaoDeContratos } from '@/components/admin/alunos/CartaoDeGrupo'
import { ListaDeContratos } from '@/components/admin/alunos/ListaDeContratos'
import { NIVEIS } from '@/data/admin/alunos-grupos'
import {
  AssinaturasBrutasSchema,
  ContratosBrutosSchema,
  ContratosDeMentoriaBrutosSchema,
  FILTROS_DE_CONTRATO,
  ProfessorasDoIndiceSchema,
  ResumosDeCreditoSchema,
  SEM_NIVEL,
  SEM_PLANO,
  SEM_PROFESSORA,
  SlotsBrutosSchema,
  VISOES_DE_CONTRATO,
  agruparContratos,
  casaComBuscaDeContrato,
  ehFiltroDeContrato,
  ehVisaoDeContratos,
  enderecoDoGrupoDeContratos,
  montarContrato,
  situacaoDoContrato,
  type ContratoBruto,
  type ContratoDaLista,
  type EixoDeContratos,
} from '@/data/admin/contratos-gramatica'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** As MESMAS colunas que `contratos.ts` pede ao PostgREST. */
const SELECT_CONTRATOS =
  'id, contract_type, plan_name, status, hourly_rate_cents, teacher_id, student_group_id, students!contracts_student_id_fkey(id, display_name, level), student_groups(label)'

/* ========================================================================== */
/* 1. As sete leituras do índice, contra o banco                               */
/* ========================================================================== */

describe('o que getContractsIndex() lê (contra o banco local)', () => {
  let sql: Sql
  let admin: SupabaseClient

  beforeAll(async () => {
    sql = connect(2)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M4'), 'admin')
  })
  afterAll(async () => {
    await sql.end()
  })

  it('as sete leituras respondem para a admin e passam pelos schemas da camada', async () => {
    const agoraIso = new Date().toISOString()

    const [contratos, professoras, slots, creditos, futuras, assinaturas, mentoria] = await Promise.all([
      admin
        .from('contracts')
        .select(SELECT_CONTRATOS)
        .eq('contract_type', 'private_1on1')
        .neq('status', 'ended')
        .order('started_on', { ascending: false }),
      admin
        .from('teachers')
        .select('id, display_name, is_owner, iana_tz')
        .is('archived_at', null)
        .order('is_owner', { ascending: false })
        .order('display_name'),
      admin
        .from('recurring_slots')
        .select('id, contract_id, weekday, local_time, iana_tz, duration_min')
        .is('active_to', null),
      admin.rpc('contract_credit_summary'),
      admin.from('class_instances').select('contract_id').eq('state', 'scheduled').gt('starts_at_utc', agoraIso),
      // c15 · Sol 8: a leitura do índice passou a pedir `reserved_at` e a
      // ordenar por ele — `sent_at` é nulo enquanto o documento não existe.
      admin
        .from('contract_signatures')
        .select('contract_id, status, reserved_at, sent_at')
        .order('reserved_at', { ascending: false }),
      admin
        .from('contracts')
        .select('id, status, students!contracts_student_id_fkey(id, display_name, level), mentorship_contracts(course_start_date)')
        .eq('contract_type', 'mentorship')
        .neq('status', 'ended'),
    ])

    for (const [nome, r] of [
      ['contratos', contratos],
      ['professoras', professoras],
      ['horários fixos', slots],
      ['saldo de créditos', creditos],
      ['aulas futuras', futuras],
      ['assinaturas', assinaturas],
      ['contratos de mentoria', mentoria],
    ] as const) {
      expect(r.error, `${nome}: ${r.error?.message ?? ''}`).toBeNull()
    }

    // Os schemas da camada por cima do payload REAL: forma que mudar estoura
    // aqui, e não em `undefined` na tela.
    const linhas = ContratosBrutosSchema.parse(contratos.data ?? [])
    ProfessorasDoIndiceSchema.parse(professoras.data ?? [])
    SlotsBrutosSchema.parse(slots.data ?? [])
    ResumosDeCreditoSchema.parse(creditos.data ?? [])
    AssinaturasBrutasSchema.parse(assinaturas.data ?? [])
    ContratosDeMentoriaBrutosSchema.parse(mentoria.data ?? [])

    // A bancada tem contratos semeados; lista vazia aqui esconderia um contrato
    // quebrado atrás de um `[]`.
    expect(linhas.length).toBeGreaterThan(0)
    for (const c of linhas) {
      expect(c.contract_type).toBe('private_1on1')
      expect(c.status).not.toBe('ended')
      // JOIN honesto: todo contrato particular é de alguém — um aluno OU um
      // grupo. Sem um dos dois, a linha não teria identidade na tabela.
      expect(Boolean(c.students || c.student_groups), `contrato ${c.id} sem aluno e sem grupo`).toBe(true)
    }
  })

  it('o contrato de GRUPO da bancada chega com rótulo de turma e sem aluno direto', async () => {
    const { data, error } = await admin
      .from('contracts')
      .select(SELECT_CONTRATOS)
      .eq('contract_type', 'private_1on1')
      .not('student_group_id', 'is', null)
    expect(error).toBeNull()

    const grupos = ContratosBrutosSchema.parse(data ?? [])
    expect(grupos.length, 'a bancada semeia o casal Natália e Yago').toBeGreaterThan(0)
    for (const g of grupos) {
      expect(g.students).toBeNull()
      expect(g.student_groups?.label.length).toBeGreaterThan(0)
      // …e a linha da tabela veste o rótulo do grupo como identidade
      expect(comoNaTela(g).quem).toBe(g.student_groups!.label)
      expect(comoNaTela(g).alunoId).toBeNull()
    }
  })

  it('a coluna Créditos vem inteira de contract_credit_summary() (saldo + validade)', async () => {
    // Contrato PRÓPRIO, e não uma varredura da lista toda: os outros arquivos da
    // suíte criam e encerram contratos o tempo todo, e um "todo contrato tem
    // resumo" comparando duas leituras seria vermelho por sorteio, não por
    // defeito.
    const c = await createPrivateContract(sql)
    const vazio = await resumoDe(admin, c.contractId)
    // Contrato sem lançamento nenhum aparece com saldo ZERO — e zero é uma
    // afirmação sobre o contrato, não a ausência da leitura (a linha tem de
    // existir, senão a coluna cairia para 0 em silêncio).
    expect(vazio, 'contrato vivo sem linha no resumo').toBeTruthy()
    expect(vazio!.balance).toBe(0)
    expect(vazio!.next_expiry).toBeNull()

    const [{ dia }] = await sql<{ dia: string }[]>`
      select to_char(public.business_today() + 30, 'YYYY-MM-DD') as dia`
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on)
      values (${c.contractId}, ${c.studentId}, 1, 'initial_backlog', ${dia})`

    const comCredito = await resumoDe(admin, c.contractId)
    expect(comCredito!.balance).toBe(1)
    expect(comCredito!.next_expiry).toBe(dia)
  })

  it('"sem aulas futuras" e "sem horário fixo" saem das leituras certas', async () => {
    const c = await createPrivateContract(sql)
    const agoraIso = new Date().toISOString()

    // 1. contrato recém-criado: sem slot e sem aula → os dois avisos acendem
    const semNada = await leituraDeUmContrato(admin, c.contractId, agoraIso)
    expect(semNada.temAulaFutura).toBe(false)
    expect(semNada.horarios).toBe(0)

    // 2. com horário fixo vigente e aula futura → nenhum aviso
    const slotId = await createSlot(sql, c, { weekday: 3, localTime: '10:00', tz: 'America/Cuiaba' })
    await createInstance(sql, c, { startsInHours: 72 })
    const comTudo = await leituraDeUmContrato(admin, c.contractId, agoraIso)
    expect(comTudo.temAulaFutura).toBe(true)
    expect(comTudo.horarios).toBe(1)

    // 3. horário FECHADO deixa de ser vigente (é o `active_to is null` da query)
    await sql`update recurring_slots set active_to = current_date where id = ${slotId}`
    const fechado = await leituraDeUmContrato(admin, c.contractId, agoraIso)
    expect(fechado.horarios).toBe(0)

    // 4. aula no PASSADO não conta como futura
    const outro = await createPrivateContract(sql)
    await createInstance(sql, outro, { startsInHours: -72 })
    expect((await leituraDeUmContrato(admin, outro.contractId, agoraIso)).temAulaFutura).toBe(false)
  })

  it('a seção de Mentoria enxerga o contrato de mentoria e o início do curso', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 3 })
    const { data, error } = await admin
      .from('contracts')
      .select('id, status, students!contracts_student_id_fkey(id, display_name, level), mentorship_contracts(course_start_date)')
      .eq('contract_type', 'mentorship')
      .eq('id', m.contractId)
    expect(error).toBeNull()

    const [linha] = ContratosDeMentoriaBrutosSchema.parse(data ?? [])
    expect(linha).toBeTruthy()
    expect(linha.students?.id).toBe(m.studentId)
    expect(linha.mentorship_contracts?.course_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // …e o curso nunca acessado chega como NULL (a seção diz "não lançado", que
    // é uma resposta diferente de uma data qualquer).
    const semInicio = await createMentorshipContract(sql, { courseStartMonthsAgo: null })
    const { data: d2 } = await admin
      .from('contracts')
      .select('id, status, students!contracts_student_id_fkey(id, display_name, level), mentorship_contracts(course_start_date)')
      .eq('id', semInicio.contractId)
    expect(ContratosDeMentoriaBrutosSchema.parse(d2 ?? [])[0].mentorship_contracts?.course_start_date).toBeNull()
  })
})

/** A linha do resumo de crédito deste contrato (ou `undefined`). */
async function resumoDe(admin: SupabaseClient, contractId: string) {
  const { data, error } = await admin.rpc('contract_credit_summary')
  expect(error).toBeNull()
  return ResumosDeCreditoSchema.parse(data ?? []).find((r) => r.contract_id === contractId)
}

/** As duas perguntas por contrato que os avisos da linha respondem. */
async function leituraDeUmContrato(
  admin: SupabaseClient,
  contractId: string,
  agoraIso: string,
): Promise<{ temAulaFutura: boolean; horarios: number }> {
  const [futuras, slots] = await Promise.all([
    admin
      .from('class_instances')
      .select('contract_id')
      .eq('state', 'scheduled')
      .eq('contract_id', contractId)
      .gt('starts_at_utc', agoraIso),
    admin
      .from('recurring_slots')
      .select('id, contract_id, weekday, local_time, iana_tz, duration_min')
      .eq('contract_id', contractId)
      .is('active_to', null),
  ])
  expect(futuras.error).toBeNull()
  expect(slots.error).toBeNull()
  return {
    temAulaFutura: (futuras.data ?? []).length > 0,
    horarios: SlotsBrutosSchema.parse(slots.data ?? []).length,
  }
}

/* ========================================================================== */
/* 2. Gramática pura: linha, seções e busca                                    */
/* ========================================================================== */

/** Traduz o cru como a camada traduz, com o que depende de fuso já pronto. */
function comoNaTela(bruto: ContratoBruto, extras: Partial<Parameters<typeof montarContrato>[1]> = {}): ContratoDaLista {
  return montarContrato(bruto, {
    professora: { id: bruto.teacher_id, nome: bruto.teacher_id ? 'Helena' : null, idx: 0 },
    horarios: [],
    temAulaFutura: false,
    valorHora: 'R$ 150,00',
    saldo: 0,
    proximaValidade: null,
    assinatura: null,
    ...extras,
  })
}

function bruto(over: Partial<ContratoBruto> = {}): ContratoBruto {
  return {
    id: over.id ?? 'c-1',
    contract_type: 'private_1on1',
    plan_name: 'Aulas particulares',
    status: 'active',
    hourly_rate_cents: 15000,
    teacher_id: 't-1',
    student_group_id: null,
    students: { id: 's-1', display_name: 'Elisa Faria', level: 'B1' },
    student_groups: null,
    ...over,
  }
}

describe('vocabulário das duas chaves de URL', () => {
  it('`?st=` aceita os três recortes e recusa o resto', () => {
    expect([...FILTROS_DE_CONTRATO]).toEqual(['todos', 'active', 'paused'])
    for (const f of FILTROS_DE_CONTRATO) expect(ehFiltroDeContrato(f), f).toBe(true)
    // "encerrado" NÃO é recorte: contrato encerrado não aparece no índice (é a
    // regra da tela velha, e o histórico dele vive na ficha do aluno).
    expect(ehFiltroDeContrato('ended')).toBe(false)
    expect(ehFiltroDeContrato(undefined)).toBe(false)
  })

  it('`?ver=` aceita a lista e os quatro eixos da spec', () => {
    expect([...VISOES_DE_CONTRATO]).toEqual(['lista', 'professora', 'nivel', 'produto', 'situacao'])
    for (const v of VISOES_DE_CONTRATO) expect(ehVisaoDeContratos(v), v).toBe(true)
    expect(ehVisaoDeContratos('turma')).toBe(false)
  })

  it('status desconhecido nunca vira situação inventada', () => {
    expect(situacaoDoContrato('active')).toBe('active')
    expect(situacaoDoContrato('paused')).toBe('paused')
    expect(situacaoDoContrato('ended')).toBe('ended')
    expect(situacaoDoContrato('zumbi')).toBe('ended')
  })
})

describe('montagem da linha', () => {
  it('o grupo veste o rótulo da turma e não oferece ficha', () => {
    const g = comoNaTela(
      bruto({ students: null, student_group_id: 'g-1', student_groups: { label: 'Natália e Yago (casal)' } }),
    )
    expect(g.quem).toBe('Natália e Yago (casal)')
    expect(g.grupo).toBe(true)
    expect(g.alunoId).toBeNull()
    expect(g.nivel).toBeNull()
  })

  it('plano em branco não vira string vazia na tela', () => {
    expect(comoNaTela(bruto({ plan_name: null })).plano).toBe(SEM_PLANO)
    expect(comoNaTela(bruto({ plan_name: '   ' })).plano).toBe(SEM_PLANO)
  })

  it('os dois avisos da tela velha só acendem em contrato ATIVO', () => {
    const ativoPelado = comoNaTela(bruto())
    expect(ativoPelado.semHorarioFixo).toBe(true)
    expect(ativoPelado.semAulasFuturas).toBe(true)

    // Pausado é decisão da escola: "sem aulas futuras" ali é consequência, não
    // alarme.
    const pausado = comoNaTela(bruto({ status: 'paused' }))
    expect(pausado.semHorarioFixo).toBe(false)
    expect(pausado.semAulasFuturas).toBe(false)

    const completo = comoNaTela(bruto(), {
      horarios: [{ id: 'sl-1', aluno: 'terça · 20:30–21:15', professora: '21:30' }],
      temAulaFutura: true,
    })
    expect(completo.semHorarioFixo).toBe(false)
    expect(completo.semAulasFuturas).toBe(false)
  })
})

describe('grupos do "ver por"', () => {
  const lista: ContratoDaLista[] = [
    comoNaTela(bruto({ id: 'a', students: { id: 's-a', display_name: 'Ana', level: 'B1' } })),
    comoNaTela(
      bruto({
        id: 'b',
        teacher_id: 't-2',
        plan_name: 'Aulas do casal',
        students: { id: 's-b', display_name: 'Bruno', level: 'A1' },
      }),
    ),
    comoNaTela(bruto({ id: 'c', teacher_id: null, status: 'paused', students: { id: 's-c', display_name: 'Célia', level: null } })),
  ].map((c, i) => ({ ...c, professoraIdx: i === 1 ? 1 : 0, professora: i === 2 ? null : c.professora }))

  it('"lista" não agrupa nada', () => {
    expect(agruparContratos(lista, 'lista')).toEqual([])
  })

  it('cada contrato cai em EXATAMENTE uma seção, em todos os eixos', () => {
    for (const visao of ['professora', 'nivel', 'produto', 'situacao'] as const) {
      const secoes = agruparContratos(lista, visao)
      expect(secoes.reduce((s, x) => s + x.total, 0), visao).toBe(lista.length)
      const vistos = secoes.flatMap((s) => s.contratos.map((c) => c.id))
      expect(new Set(vistos).size, visao).toBe(lista.length)
      for (const s of secoes) {
        expect(s.total, `${visao}/${s.chave}`).toBe(s.contratos.length)
        expect(s.total).toBeGreaterThan(0) // seção vazia não vira cabeçalho
      }
    }
  })

  it('a ordem é a da casa: dona primeiro, escala Flexge, ativos antes de pausados', () => {
    // professora: pela ordem de cor (dona primeiro), com "sem professora" no fim
    expect(agruparContratos(lista, 'professora').map((s) => s.chave)).toEqual(['t-1', 't-2', SEM_PROFESSORA])

    // nível: na ordem da trilha, com "sem nível" no fim
    const niveis = agruparContratos(lista, 'nivel')
    expect(niveis.map((s) => s.chave)).toEqual(['A1', 'B1', SEM_NIVEL])
    expect(NIVEIS.indexOf('A1')).toBeLessThan(NIVEIS.indexOf('B1'))

    // situação: ativo antes de pausado
    expect(agruparContratos(lista, 'situacao').map((s) => s.chave)).toEqual(['active', 'paused'])

    // produto (o plano, fase 1): alfabético, com "Sem plano" no fim
    const comSemPlano = [...lista, comoNaTela(bruto({ id: 'd', plan_name: null }))]
    expect(agruparContratos(comSemPlano, 'produto').map((s) => s.rotulo)).toEqual([
      'Aulas do casal',
      'Aulas particulares',
      SEM_PLANO,
    ])
  })

  /*
   * O QUE O CARTÃO PRECISA SABER (portão visual do dono, 27/07/2026): para onde
   * ele abre (o slug) e a pendência do grupo (contrato ativo sem horário fixo).
   */
  it('cada grupo sabe o endereço dele — e o nível não vai cru para a URL', () => {
    expect(agruparContratos(lista, 'professora').map((s) => s.slug)).toEqual([
      't-1',
      't-2',
      SEM_PROFESSORA,
    ])
    // `A1+` viraria `A1%2B` no endereço: o slug é o mesmo do hub de alunos
    const comMais = [
      ...lista,
      comoNaTela(bruto({ id: 'e', students: { id: 's-e', display_name: 'Eva', level: 'A1+' } })),
    ]
    expect(agruparContratos(comMais, 'nivel').map((s) => s.slug)).toEqual([
      'a1',
      'a1-mais',
      'b1',
      SEM_NIVEL,
    ])
    expect(agruparContratos(lista, 'situacao').map((s) => s.slug)).toEqual(['active', 'paused'])

    // e o endereço escapa o que precisa ser escapado (o plano é texto livre)
    expect(enderecoDoGrupoDeContratos('nivel', 'a1-mais')).toBe(
      '/admin/alunos/contratos/grupo/nivel/a1-mais',
    )
    expect(enderecoDoGrupoDeContratos('produto', 'Aulas do casal')).toBe(
      '/admin/alunos/contratos/grupo/produto/Aulas%20do%20casal',
    )
  })

  it('o cartão conta a PENDÊNCIA do grupo: contrato ativo sem horário fixo', () => {
    // `lista` inteira é de contrato sem horário; o pausado não conta (a pausa é
    // decisão da escola, não pendência — a mesma régua da pílula da linha)
    const porProfessora = agruparContratos(lista, 'professora')
    expect(porProfessora.map((s) => [s.chave, s.total, s.semHorarioFixo])).toEqual([
      ['t-1', 1, 1],
      ['t-2', 1, 1],
      [SEM_PROFESSORA, 1, 0],
    ])

    const comHorario = agruparContratos(
      [comoNaTela(bruto({ id: 'f' }), { horarios: [{ id: 'sl', aluno: 'terça · 13:15', professora: null }] })],
      'professora',
    )
    expect(comHorario[0].semHorarioFixo).toBe(0)
  })
})

describe('busca do índice', () => {
  const ana = comoNaTela(bruto({ students: { id: 's', display_name: 'Lúcia Prado', level: null } }))
  const casal = comoNaTela(
    bruto({
      id: 'x',
      students: null,
      student_groups: { label: 'Natália e Yago (casal)' },
      plan_name: 'Aulas do casal',
    }),
  )

  it('acha sem acento, sem caixa, pelo grupo e pelo plano', () => {
    expect(casaComBuscaDeContrato(ana, 'lucia')).toBe(true)
    expect(casaComBuscaDeContrato(ana, 'PRADO')).toBe(true)
    expect(casaComBuscaDeContrato(casal, 'natalia')).toBe(true)
    expect(casaComBuscaDeContrato(casal, 'casal')).toBe(true)
    expect(casaComBuscaDeContrato(ana, 'casal')).toBe(false)
  })

  it('termo vazio não filtra nada', () => {
    expect(casaComBuscaDeContrato(ana, '   ')).toBe(true)
  })
})

/* ========================================================================== */
/* 3. Aceites da tela nova                                                     */
/* ========================================================================== */

const ARQUIVOS_DO_M4 = [
  'src/data/admin/contratos.ts',
  'src/data/admin/contratos-gramatica.ts',
  'src/components/admin/alunos/ListaDeContratos.tsx',
  'src/app/admin/alunos/contratos/page.tsx',
  // o N2 nasceu no portão visual do dono (27/07): cartão que abre um recorte
  // precisa da tela do recorte, e ela entra na MESMA varredura de aceites
  'src/app/admin/alunos/contratos/grupo/[eixo]/[valor]/page.tsx',
]

const PAGINAS_DO_M4 = ARQUIVOS_DO_M4.filter((r) => r.endsWith('/page.tsx'))

describe('aceites do M4-1', () => {
  it.each(ARQUIVOS_DO_M4)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_DO_M4)('%s não abre overlay fora do kit nem usa `<details data-popup>`', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  it.each(ARQUIVOS_DO_M4)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  it.each(ARQUIVOS_DO_M4)('%s não fabrica `?msg=` nem nonce', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
  })

  // Régua de legibilidade (AGENTS.md): DADO nunca em 12px nem no cinza de apoio.
  it.each(ARQUIVOS_DO_M4)('%s não rebaixa dado para 12px nem para o cinza de apoio', (rel) => {
    const c = codigo(rel).replace(/(?:placeholder|data-\[placeholder\]):text-ink-400/g, '')
    expect(c).not.toMatch(/text-xs/)
    expect(c).not.toMatch(/text-ink-400/)
    expect(c).not.toMatch(/text-\[1[0-3]px\]/)
    expect(c).not.toMatch(/font-(light|extralight)/)
  })

  it.each(ARQUIVOS_DO_M4)('%s não usa o link-ação de 12px', (rel) => {
    expect(codigo(rel)).not.toContain('linkActionXs')
  })

  it.each(ARQUIVOS_DO_M4)('%s não formata data no cliente (Lei 1)', (rel) => {
    const c = codigo(rel)
    if (!c.startsWith("'use client'")) return
    expect(c, rel).not.toMatch(/new Date\(|toLocaleString|DateTime\./)
  })

  it.each(ARQUIVOS_DO_M4)('%s não usa link-texto com seta como ação', (rel) => {
    expect(codigo(rel)).not.toMatch(/→\s*(?:\{'\s*'\}\s*)?<\//)
  })

  it.each(ARQUIVOS_DO_M4)('%s não pendura explicação com travessão no rótulo da ação', (rel) => {
    expect(codigo(rel)).not.toMatch(/—[^<>]*<\/(?:Link|a|button)>/)
  })

  it('nenhum título do M4 inventa tamanho (as duas réguas da casa)', () => {
    for (const rel of ARQUIVOS_DO_M4) {
      for (const tag of codigo(rel).match(/<h[1-3][^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/title-(page|section)/)
      }
    }
  })

  it('a PÁGINA nova não faz query inline — quem lê é a camada de dados', () => {
    for (const rel of PAGINAS_DO_M4) {
      const p = codigo(rel)
      expect(p, rel).not.toContain('@/lib/supabase')
      expect(p, rel).not.toMatch(/\.from\(/)
      expect(p, rel).not.toMatch(/\.rpc\(/)
      expect(p, rel).toContain('getContractsIndex')
    }
  })

  it('a camada de dados é server-only, valida o retorno e não engole erro', () => {
    const d = corpo('src/data/admin/contratos.ts')
    expect(d.startsWith("import 'server-only'")).toBe(true)
    // as sete leituras, cada uma com a sua mensagem de falha
    for (const leitura of [
      'os contratos',
      'as professoras',
      'os horários fixos',
      'o saldo de créditos',
      'as aulas futuras',
      'as assinaturas',
      'os contratos de mentoria',
    ]) {
      expect(d, leitura).toContain(`exigir('${leitura}'`)
    }
    // Zod por cima de TODO payload
    for (const schema of [
      'ContratosBrutosSchema.parse',
      'ProfessorasDoIndiceSchema.parse',
      'SlotsBrutosSchema.parse',
      'ResumosDeCreditoSchema.parse',
      'AssinaturasBrutasSchema.parse',
      'ContratosDeMentoriaBrutosSchema.parse',
    ]) {
      expect(d, schema).toContain(schema)
    }
    // Lei 1: a hora do horário fixo é resolvida no SERVIDOR, com `slotLine`
    expect(d).toContain('slotLine(s,')
    // Lei 9: centavos viram reais uma vez, aqui
    expect(d).toContain('fmtBRL(bruto.hourly_rate_cents)')
    // regra de negócio nenhuma: o saldo vem do banco
    expect(d).toContain("supabase.rpc('contract_credit_summary')")
  })

  it('a aba Contratos das TRÊS telas do hub aponta para a rota nova', () => {
    for (const rel of [
      'src/app/admin/alunos/page.tsx',
      'src/app/admin/alunos/convites/page.tsx',
      'src/app/admin/alunos/contratos/page.tsx',
    ]) {
      expect(corpo(rel), rel).toContain("href: '/admin/alunos/contratos'")
      // …e nenhuma delas ainda manda a aba para a tela velha
      expect(corpo(rel).replace(/^\s*\/\/.*$/gm, ''), rel).not.toContain("label: 'Contratos', href: '/admin/contratos'")
    }
  })

  it('a tela nova tem as três abas, a contagem de vivos e o botão primário', () => {
    const p = corpo('src/app/admin/alunos/contratos/page.tsx')
    expect(p).toContain("label: 'Alunos', href: '/admin/alunos'")
    expect(p).toContain("label: 'Convites', href: '/admin/alunos/convites'")
    expect(p).toContain('active: true')
    expect(p).toContain('count: indice.vivos')
    // o botão primário do kit (nunca link de texto), apontando para o WIZARD
    // (M4-3 — até ele nascer, esta constante levava à tela velha)
    expect(p).toContain('const NOVO_CONTRATO = enderecoDoNovoContrato()')
    expect(p).toMatch(/href=\{NOVO_CONTRATO\}\s+className="btn-ac"/)
    // as duas chaves de estado da URL
    expect(p).toContain('ehFiltroDeContrato(sp.st)')
    expect(p).toContain('ehVisaoDeContratos(sp.ver)')
    // e a seção própria da mentoria, com porta para a tela que a gere
    expect(p).toContain('indice.mentoria')
    expect(p).toContain('href="/admin/mentoria"')
  })

  /*
   * O "VER POR" É CARTÃO, E CARTÃO ABRE ALGUMA COISA (portão visual do dono,
   * 27/07/2026). Dois aceites de grep, porque são duas promessas: a página
   * desenha os cartões (e não uma pilha de seções), e existe o N2 para onde
   * eles apontam — cartão que não abre nada é enfeite.
   */
  it('o índice desenha os CARTÕES de acesso do "ver por", na grade do hub', () => {
    const p = codigo('src/app/admin/alunos/contratos/page.tsx')
    expect(p).toContain('agruparContratos(indice.contratos, eixo)')
    expect(p).toContain('<CartaoDeContratos')
    // a MESMA grade do hub de alunos (inclusive o `pb-6` que salva a sombra da
    // última fileira dentro do `CardPanel` `overflow-hidden`)
    expect(p).toContain('grid grid-cols-1 gap-4 p-4 pb-6 sm:grid-cols-2 xl:grid-cols-3')
    // e o desenho velho não sobrou em lugar nenhum
    expect(p).not.toContain('visao={visao}')
  })

  it('o N2 dos contratos existe, é irmão do de alunos e volta para o eixo de onde se veio', () => {
    const rel = 'src/app/admin/alunos/contratos/grupo/[eixo]/[valor]/page.tsx'
    const n2 = codigo(rel)
    // 404 honesto nos dois enganos possíveis: eixo fora do vocabulário e valor
    // que não é grupo nenhum
    expect(n2).toContain('ehEixoDeContratos(eixo)')
    expect((n2.match(/notFound\(\)/g) ?? []).length).toBe(2)
    // a MESMA tabela do índice, filtrada no grupo
    expect(n2).toContain('<ListaDeContratos')
    expect(n2).toContain('contratos={grupo.contratos}')
    // trilha de volta preservando o eixo (voltar não desfaz o agrupamento)
    expect(n2).toContain('href={`/admin/alunos/contratos?ver=${eixo}`}')
    // zero query inline (a leitura mora em `src/data/`)
    expect(n2).not.toContain('.from(')
    expect(n2).not.toContain('createClient')
  })

  // ACEITE REESCRITO — ordem do dono no portão visual (27/07/2026): o "ver por"
  // saiu daqui. A lista não agrupa mais nada (o `agruparContratos` que ela
  // chamava mora agora na PÁGINA, que desenha os cartões e os passa como
  // `children`) — e "nunca chip" continua valendo.
  it('a lista filtra no cliente, anuncia a contagem e não agrupa mais nada', () => {
    const l = codigo('src/components/admin/alunos/ListaDeContratos.tsx')
    expect(l).toContain('aria-live="polite"')
    expect(l).toContain('casaComBuscaDeContrato')
    // o agrupamento subiu para a página: aqui não sobrou nem a chamada nem a
    // pilha de seções que ela alimentava
    expect(l).not.toContain('agruparContratos')
    expect(l).not.toMatch(/<h3 className="title-section/)
    // nada de ida ao servidor por tecla
    expect(l).not.toContain('.rpc(')
    expect(l).not.toContain('router.push')
    // e nunca chip (spec do M4, que este pedaço mantém)
    expect(l).not.toContain('chipOn')
    expect(l).not.toContain('chipOff')
    // a tabela é a do kit, com âncora de verdade na linha
    expect(l).toContain('<DataTable')
    expect(l).toContain('hrefDaLinha')
    // as sete colunas da spec
    for (const col of [
      "id: 'contrato'",
      "id: 'professora'",
      "id: 'nivel'",
      "id: 'horarios'",
      "id: 'valor'",
      "id: 'creditos'",
      "id: 'situacao'",
    ]) {
      expect(l, col).toContain(col)
    }
    // sem edição na listagem (spec): nenhum formulário, nenhuma mutação
    expect(l).not.toMatch(/<form[\s>]/)
    expect(l).not.toContain('Action')
    // e o destino da linha é o DETALHE do contrato (o provisório do M4-1, que
    // abria a lista velha filtrada por nome, morreu no M4-2)
    expect(l).toContain('enderecoDoContrato(c.id)')
  })
})

/* ========================================================================== */
/* 4. Render (o grep não prova que a peça desenha)                             */
/* ========================================================================== */

describe('a lista de contratos desenha', () => {
  const linhas: ContratoDaLista[] = [
    comoNaTela(bruto({ id: 'a', students: { id: 's-a', display_name: 'Elisa Faria', level: 'B1' } }), {
      horarios: [{ id: 'sl', aluno: 'terça · 13:15–14:00', professora: '14:15' }],
      temAulaFutura: true,
      saldo: 3,
      proximaValidade: '31/07/2026',
    }),
    comoNaTela(
      bruto({
        id: 'b',
        teacher_id: 't-2',
        status: 'paused',
        plan_name: 'Aulas do casal',
        students: null,
        student_groups: { label: 'Natália e Yago (casal)' },
      }),
    ),
  ]

  it('a tabela mostra identidade, plano, valor, saldo e situação', () => {
    const html = renderToStaticMarkup(
      h(ListaDeContratos, { contratos: linhas, legenda: 'Contratos', vazio: h('p', null, 'vazio') }),
    )
    expect(html).toContain('Elisa Faria')
    expect(html).toContain('Natália e Yago (casal)')
    expect(html).toContain('Aulas do casal')
    expect(html).toContain('R$ 150,00')
    expect(html).toContain('vence 31/07/2026')
    expect(html).toContain('terça · 13:15–14:00')
    // a hora da professora só aparece quando os relógios divergem
    expect(html).toContain('14:15 para Helena')
    // situação com a palavra do hub…
    expect(html).toContain('>ativo<')
    expect(html).toContain('>pausado<')
    // contrato com horário e aula marcada não acende aviso nenhum; o pausado
    // também não (a pausa é decisão da escola, não pendência)
    expect(html).not.toContain('sem horário fixo')
    expect(html).not.toContain('sem aulas futuras')
    // contagem viva anunciada, no plural certo
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('2 contratos')
    // linha é âncora de verdade — e, desde o M4-2, para o DETALHE do contrato
    expect(html).toContain('href="/admin/contratos/a"')
  })

  it('o contrato ativo e pelado carrega os dois avisos da tela velha na linha', () => {
    const html = renderToStaticMarkup(
      h(ListaDeContratos, {
        // sem horário fixo e sem aula futura: é exatamente o contrato que a
        // dona precisa ver de longe (aluno matriculado que não tem aula marcada)
        contratos: [comoNaTela(bruto({ id: 'z' }))],
        legenda: 'Contratos',
        vazio: h('p', null, 'vazio'),
      }),
    )
    expect(html).toContain('sem horário fixo')
    expect(html).toContain('sem aulas futuras')
  })

  it('singular e plural não saem no automático', () => {
    const html = renderToStaticMarkup(
      h(ListaDeContratos, {
        contratos: [linhas[0]],
        legenda: 'Contratos',
        vazio: h('p', null, 'vazio'),
      }),
    )
    expect(html).toContain('1 contrato<')
  })

  it('lista sem ninguém desenha o estado vazio que a página mandou', () => {
    const html = renderToStaticMarkup(
      h(ListaDeContratos, {
        contratos: [],
        legenda: 'Contratos',
        vazio: h('p', null, 'Nenhum contrato vivo.'),
      }),
    )
    expect(html).toContain('Nenhum contrato vivo.')
    expect(html).toContain('0 contratos')
  })

  /*
   * ACEITE REESCRITO — ordem direta do dono no PORTÃO VISUAL (27/07/2026).
   *
   * A spec do M4-1 dizia "ver por é SEÇÃO, nunca chip": uma pilha de seções com
   * cabeçalho de identidade e uma tabela cada. O dono olhou a bancada e mandou
   * outra coisa: cartões de acesso, "como a aba Alunos". O aceite antigo
   * (`"ver por" desenha uma seção por grupo, com cabeçalho de identidade e
   * tabela própria` — dois `<h3>`, duas `<caption>`) morreu com o desenho que
   * ele provava; este prova o desenho novo, e a razão de ele existir está
   * registrada em `docs/goals/m4-contratos.md` §M4-1.
   */
  it('"ver por" mostra os CARTÕES que a página manda, e a busca os troca pela tabela', () => {
    const cartoes = h('div', { 'data-teste': 'cartoes' }, 'os cartões de acesso')

    const comCartoes = renderToStaticMarkup(
      h(ListaDeContratos, { contratos: linhas, legenda: 'Contratos', vazio: h('p', null, 'v') }, cartoes),
    )
    expect(comCartoes).toContain('os cartões de acesso')
    // nenhuma tabela desenhada por baixo: o cartão SUBSTITUI a lista
    expect(comCartoes).not.toContain('<caption')
    // e a contagem viva do recorte continua lá, em cima dos cartões
    expect(comCartoes).toContain('2 contratos')

    // Com busca escrita, os cartões somem e volta a tabela dos RESULTADOS —
    // quem digitou um nome procura UM contrato (precedente de `ListaDeAlunos`).
    const buscando = renderToStaticMarkup(
      h(
        ListaDeContratos,
        { contratos: linhas, legenda: 'Contratos', buscaInicial: 'Elisa', vazio: h('p', null, 'v') },
        cartoes,
      ),
    )
    expect(buscando).not.toContain('os cartões de acesso')
    expect(buscando).toContain('<caption')
    expect(buscando).toContain('Elisa Faria')
    expect(buscando).toContain('1 contrato encontrado')
  })

  it('busca sem resultado oferece a saída, e não uma tabela muda', () => {
    const html = renderToStaticMarkup(
      h(ListaDeContratos, {
        contratos: linhas,
        buscaInicial: 'zzz',
        legenda: 'Contratos',
        vazio: h('p', null, 'vazio'),
      }),
    )
    expect(html).toContain('Nenhum contrato com esse nome.')
    expect(html).toContain('Limpar a busca')
    expect(html).toContain('0 contratos encontrados')
  })
})

/* ========================================================================== */
/* 5. Os cartões de acesso do "ver por" (portão visual do dono, 27/07/2026)     */
/* ========================================================================== */

/**
 * O dono mandou o "ver por" virar cartão "como a aba Alunos". Este bloco prova
 * que é o MESMO cartão (a peça é `CartaoDeAcesso`, compartilhada com o hub) e
 * que cada eixo veste a identidade dele — bolinha da professora, pílula do
 * nível, pílula da situação, nome do plano — com a contagem em contratos e a
 * pendência do grupo.
 */
describe('os cartões do "ver por" desenham', () => {
  const universo: ContratoDaLista[] = [
    comoNaTela(bruto({ id: 'a', students: { id: 's-a', display_name: 'Ana', level: 'B1' } }), {
      horarios: [{ id: 'sl', aluno: 'terça · 13:15–14:00', professora: null }],
    }),
    comoNaTela(
      bruto({
        id: 'b',
        plan_name: 'Aulas do casal',
        students: null,
        student_groups: { label: 'Natália e Yago (casal)' },
      }),
    ),
    comoNaTela(
      bruto({ id: 'c', status: 'paused', students: { id: 's-c', display_name: 'Célia', level: null } }),
    ),
  ]

  const desenhar = (eixo: EixoDeContratos) =>
    agruparContratos(universo, eixo)
      .map((secao) => renderToStaticMarkup(h(CartaoDeContratos, { eixo, secao })))
      .join('\n')

  it('por PROFESSORA: bolinha de cor, contagem em contratos e o endereço do grupo', () => {
    const html = desenhar('professora')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/professora/t-1"')
    expect(html).toContain('Helena')
    // a contagem é DADO grande, e conta CONTRATO (não aluno)
    expect(html).toMatch(/text-3xl font-semibold tabular-nums[^>]*>3</)
    expect(html).toContain('contratos')
    // a pendência do grupo: um contrato ativo sem horário fixo (o pausado não
    // conta, e o que tem horário também não)
    expect(html).toContain('sem horário fixo')
    // é a receita de elevação da casa (cartão CLICÁVEL), como no hub
    expect(html).toContain('card-kpi card-kpi-interactive')
  })

  it('por NÍVEL: a pílula da escala, e o slug no lugar do `+`', () => {
    const html = desenhar('nivel')
    expect(html).toContain('>B1<')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/nivel/b1"')
    // sem nível é um balde, e ele não some da lista
    expect(html).toContain('Sem nível')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/nivel/sem-nivel"')
  })

  it('por SITUAÇÃO: a pílula da situação, na palavra e na cor do hub', () => {
    const html = desenhar('situacao')
    expect(html).toContain('>ativo<')
    expect(html).toContain('>pausado<')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/situacao/active"')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/situacao/paused"')
  })

  it('por PRODUTO: o plano nomeia o cartão — e não veste arte de produto', () => {
    const html = desenhar('produto')
    expect(html).toContain('Aulas do casal')
    expect(html).toContain('href="/admin/alunos/contratos/grupo/produto/Aulas%20do%20casal"')
    // a arte de `public/brand/produtos` responde por particular/travel (os
    // produtos do hub de ALUNOS); plano é texto livre e não tem arte
    expect(html).not.toContain('/brand/produtos/')
  })

  it('grupo sem pendência não inventa um "0 sem horário fixo"', () => {
    const so = agruparContratos(
      [comoNaTela(bruto({ id: 'z' }), { horarios: [{ id: 's', aluno: 'terça · 13:15', professora: null }] })],
      'professora',
    )
    const html = renderToStaticMarkup(h(CartaoDeContratos, { eixo: 'professora', secao: so[0] }))
    expect(html).not.toContain('sem horário fixo')
    // …e o singular não sai no automático
    expect(html).toMatch(/tabular-nums[^>]*>1</)
    expect(html).toContain('>contrato<')
  })
})
