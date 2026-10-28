// ONDA 1 · M3-2 — a ficha do aluno em abas: o que a leitura, o mapa de abas e
// as peças novas prometem, provado.
//
// Cobre:
//  · o CONTRATO do que a ficha lê do banco — o diretório na versão dela
//    (`FichaDiretorioSchema`, com política e vigência) e TODAS as demais
//    leituras que `getStudentFile` faz, executadas como admin de verdade: uma
//    grant que sumir ou uma RLS que apertar estoura AQUI, não na tela da dona;
//  · o mapa `?painel=` → aba (função pura): todo painel da ficha velha continua
//    tendo endereço, e agora escolhe a aba por baixo;
//  · os aceites de grep da tela nova (sem query inline, sem `<select>` nativo,
//    sem cor fora do acento, type-to-confirm nas destrutivas e a EXTENSÃO DE
//    VALIDADE alcançável — era a regressão que bloqueava o deploy da onda);
//  · o render das peças que dá para renderizar sem teatro (a grade de pares e a
//    coluna de identidade).
//
// O QUE NÃO DÁ PARA RENDERIZAR AQUI, e por quê: `abas.tsx` e `paineis.tsx`
// importam as server actions da ficha, que importam `@/lib/auth/admin`, que
// importa `server-only` — e o pacote `server-only` LANÇA fora da condição
// `react-server` (é essa a função dele). Montar essa condição no Vitest seria
// inventar harness. O gesto dessas telas fica para o e2e do M5.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract, daysFromToday } from './helpers/db'
import { ColunaDeIdentidade } from '@/components/admin/alunos/ficha/ColunaDeIdentidade'
import {
  HistoricoDeRevisoes,
  RespostasDoBriefing,
} from '@/components/admin/alunos/ficha/briefing-leitura'
import { Pares, Secao } from '@/components/admin/alunos/ficha/pecas'
import { NIVEIS, nivelValido } from '@/data/admin/alunos-grupos'
import type { BriefingNaFicha, FichaDoAluno, RevisaoDoBriefing } from '@/data/admin/ficha'
import { enunciadoDaChave } from '@/lib/briefing/schema'
import {
  ABAS,
  ABA_PADRAO,
  ABA_ROTULO,
  FichaDiretorioSchema,
  NIVEIS_DO_CADASTRO,
  PAINEIS,
  SEM_NIVEL_NO_FORM,
  abaAtiva,
  abaDoPainel,
  ehAba,
  ehPainel,
  enderecoDaFicha,
  type AlunoDaFicha,
} from '@/data/admin/ficha-gramatica'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/* ========================================================================== */
/* 0. Um briefing v2 de bancada (o que a ficha lê e desenha)                   */
/* ========================================================================== */

/** Respostas v2 completas — o envio v2 as exige, e a correção revalida. */
const BRIEFING_V2_FIXTURE = {
  historia: {
    cidade_vida: 'Cuiabá',
    facil: 'entender o que ouço em série',
    dificil: 'falar sem travar no meio da frase',
    contato: ['Aulas particulares', 'Escola / curso em grupo'],
    experiencia_marcante: '',
  },
  objetivos: {
    finalidades: ['Trabalho / carreira', 'Viagens'],
    finalidade_principal: 'Trabalho / carreira',
    topicos_profissionais: ['reuniões', 'e-mails', 'apresentações'],
    alvo_6_meses: 'conduzir uma reunião de 30 minutos em inglês',
    onde_trava: ['Falar'],
    correcao_preferida: 'Na hora, sempre',
    tempo_diario: '20 min/dia',
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
  livre: { obs: '', apoio: 'tenho TDAH — funciono melhor com blocos curtos' },
}

const KOLB_FIXTURE = {
  q1: 'C', q2: 'C', q3: 'A', q4: 'A', q5: 'C', q6: 'A',
  q7: 'A', q8: 'A', q9: 'A', q10: 'D', q11: 'A', q12: 'A',
}

/* ========================================================================== */
/* 1. Contrato das leituras da ficha contra o banco                            */
/* ========================================================================== */

describe('o que getStudentFile lê (contra o banco local)', () => {
  let sql: Sql
  let admin: SupabaseClient
  let alunos: AlunoDaFicha[]
  let comContrato: AlunoDaFicha

  beforeAll(async () => {
    sql = connect(2)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M3-2'), 'admin')

    const { data, error } = await admin.rpc('admin_student_directory')
    expect(error).toBeNull()
    alunos = FichaDiretorioSchema.parse(data)
    const achado = alunos.find((a) => a.contracts.some((c) => c.contract_type === 'private_1on1'))
    expect(achado, 'a bancada precisa de um aluno com contrato particular').toBeTruthy()
    comContrato = achado!
  })
  afterAll(async () => {
    await sql.end()
  })

  it('o diretório de UM aluno passa pelo schema da ficha, com política e vigência', async () => {
    const { data, error } = await admin.rpc('admin_student_directory', { p_student: comContrato.id })
    expect(error).toBeNull()
    const [aluno] = FichaDiretorioSchema.parse(data)
    expect(aluno.id).toBe(comContrato.id)

    // Os quatro campos que a FICHA usa e a lista descarta — se o jsonb parar de
    // trazê-los, a ficha mostraria "—" em política e vigência sem ninguém notar.
    const particular = aluno.contracts.find((c) => c.contract_type === 'private_1on1')!
    expect(particular.started_on).toBeTruthy()
    expect(particular.monthly_reschedule_allowance).toBeTypeOf('number')
    expect(particular.min_notice_hours).toBeTypeOf('number')
    expect(particular.makeup_credit_expiry_days).toBeTypeOf('number')
  })

  it('todas as outras leituras da camada respondem para a admin', async () => {
    const ids = comContrato.contracts.map((c) => c.contract_id)

    const [
      professoras,
      slots,
      aulas,
      pagamentos,
      contratos,
      encerrados,
      pausas,
      ledger,
      briefing,
      planos,
      vinculos,
      pagadores,
      pendencia,
    ] = await Promise.all([
      admin.from('teachers').select('id, display_name, is_owner, iana_tz').is('archived_at', null),
      admin
        .from('recurring_slots')
        .select('id, contract_id, weekday, local_time, iana_tz, duration_min, active_to')
        .in('contract_id', ids),
      admin
        .from('class_instances')
        .select('id, starts_at_utc, state, teacher_id, contract_id')
        .in('contract_id', ids),
      admin
        .from('payments')
        .select('id, contract_id, amount_cents, status, due_date, reference_ym, paid_at')
        .in('contract_id', ids),
      admin
        .from('contracts')
        .select(
          'id, hourly_rate_cents, started_on, ended_on, is_trial, contract_type, plan_name, teacher_id, status',
        )
        .in('id', ids),
      admin.from('contracts').select('id, status').eq('student_id', comContrato.id).eq('status', 'ended'),
      admin.from('contract_pauses').select('contract_id, paused_on, resumed_on').in('contract_id', ids),
      admin
        .from('makeup_ledger')
        .select(
          'id, contract_id, delta, reason, class_instance_id, expires_on, duration_min, consumes_ledger_id, note, created_at',
        )
        .in('contract_id', ids),
      admin
        .from('briefings')
        .select('status, kolb_style, kolb_scores, answers, submitted_at')
        .eq('student_id', comContrato.id)
        .maybeSingle(),
      admin.from('study_plans').select('id, contract_id, semester_no, level_snapshot').in('contract_id', ids),
      admin
        .from('student_payers')
        .select('payer_id, payers(id, name, email, cpf_cnpj, asaas_customer_id)')
        .eq('student_id', comContrato.id),
      admin.from('payers').select('id, name'),
      admin
        .from('students')
        .select('auth_cleanup_profile_id')
        .eq('id', comContrato.id)
        .maybeSingle(),
    ])

    for (const [nome, r] of [
      ['professoras', professoras],
      ['horários fixos', slots],
      ['aulas', aulas],
      ['cobranças', pagamentos],
      ['contratos', contratos],
      ['encerrados', encerrados],
      ['pausas', pausas],
      ['ledger', ledger],
      ['briefing', briefing],
      ['planos', planos],
      ['pagadores do aluno', vinculos],
      ['lista de pagadores', pagadores],
      ['pendência de bloqueio', pendencia],
    ] as const) {
      expect(r.error, `${nome}: ${r.error?.message ?? ''}`).toBeNull()
    }

    // A fila viva do FIFO é o que dá IDENTIDADE ao crédito (`ledger_id`) — sem
    // ela não existe "estender a validade DESTE crédito".
    const contratoParticular = comContrato.contracts.find((c) => c.contract_type === 'private_1on1')!
    const { data: fila, error: erroFila } = await admin.rpc('_makeup_remaining_credits', {
      p_contract: contratoParticular.contract_id,
    })
    expect(erroFila).toBeNull()
    for (const linha of (fila ?? []) as { ledger_id: number; expires_on: string }[]) {
      expect(Number(linha.ledger_id)).toBeGreaterThan(0)
      expect(String(linha.expires_on).length).toBeGreaterThan(0)
    }
  })

  // S3 da revisão adversarial nº 6: o conjunto de ids vinha SÓ do diretório —
  // que omite encerrados. Aula, cobrança e lançamento de crédito de um contrato
  // encerrado sumiam da ficha inteira junto com o contrato, e a tela afirmava
  // um histórico que não era o do aluno.
  it('S3 — o histórico alcança o contrato ENCERRADO (aulas, cobranças e ledger)', async () => {
    const c = await createPrivateContract(sql)
    const aulaId = await createInstance(sql, c, { startsInHours: -72 })
    await sql`
      insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym)
      values (${'pay-encerrado-' + crypto.randomUUID()}, ${c.contractId}, 15000, 'RECEIVED',
              ${daysFromToday(-40)}, '2026-06')`
    const [credito] = await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on)
      values (${c.contractId}, 1, 'manual_adjust', ${daysFromToday(30)})
      returning id`
    await sql`
      update contracts set status = 'ended', ended_on = public.business_today()
      where id = ${c.contractId}`

    // 1. o diretório — fonte do conjunto ATIVO — de fato NÃO traz o encerrado
    const { data: dir, error: erroDir } = await admin.rpc('admin_student_directory', {
      p_student: c.studentId,
    })
    expect(erroDir).toBeNull()
    const [alunoDir] = FichaDiretorioSchema.parse(dir)
    const idsAtivos = alunoDir.contracts.map((x) => x.contract_id)
    expect(idsAtivos).not.toContain(c.contractId)

    // 2. a leitura de encerrados devolve, e a UNIÃO é o universo do histórico
    const { data: encerrados, error: erroEnc } = await admin
      .from('contracts')
      .select('id')
      .eq('student_id', c.studentId)
      .eq('status', 'ended')
    expect(erroEnc).toBeNull()
    const ids = Array.from(new Set([...idsAtivos, ...(encerrados ?? []).map((e) => e.id)]))
    expect(ids).toContain(c.contractId)

    // 3. com a união, os fatos do contrato morto aparecem
    const [aulas, pagamentos, ledger] = await Promise.all([
      admin.from('class_instances').select('id').in('contract_id', ids),
      admin.from('payments').select('id, contract_id').in('contract_id', ids),
      admin.from('makeup_ledger').select('id').in('contract_id', ids),
    ])
    expect((aulas.data ?? []).map((a) => a.id)).toContain(aulaId)
    expect((pagamentos.data ?? []).map((p) => p.contract_id)).toContain(c.contractId)
    expect((ledger.data ?? []).map((l) => Number(l.id))).toContain(Number(credito.id))

    // 4. e com o conjunto ATIVO (o de antes) nenhum deles apareceria
    const [aulasAtivas] = await Promise.all([
      idsAtivos.length
        ? admin.from('class_instances').select('id').in('contract_id', idsAtivos)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ])
    expect((aulasAtivas.data ?? []).map((a) => a.id)).not.toContain(aulaId)
  })

  it('o briefing de um aluno chega na forma que a aba desenha', async () => {
    // A bancada não semeia briefing: a fixture é desta suíte (e sai com ela).
    const alvo = alunos[alunos.length - 1]
    await sql`delete from briefings where student_id = ${alvo.id}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style, status, submitted_at)
      values (
        ${alvo.id},
        ${sql.json({ historia: { estudou_antes: 'sim' }, objetivos: { por_que: 'viagem' } })},
        ${sql.json({ q1: 'A' })},
        ${sql.json({ EC: 3, RO: 2, AC: 4, AE: 3 })},
        'divergente', 'submitted', now()
      )`

    const { data, error } = await admin
      .from('briefings')
      .select('status, kolb_style, kolb_scores, answers, submitted_at')
      .eq('student_id', alvo.id)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.status).toBe('submitted')
    expect(data?.kolb_style).toBe('divergente')
    // é este objeto que vira os pares "Pontuações" e a lista de respostas
    expect(Object.keys(data?.kolb_scores ?? {})).toContain('AC')
    expect(Object.keys((data?.answers ?? {}) as object)).toContain('historia')

    await sql`delete from briefings where student_id = ${alvo.id}`
  })

  // Briefing v2 (sub-lote 3): a ficha passou a ler DUAS coisas novas na mesma
  // linha (a versão do questionário e as letras do Kolb) e uma tabela nova (a
  // trilha de correção). Se a grant sumir ou a RLS apertar, é aqui que estoura.
  it('a correção pós-envio chega à ficha na forma que a aba desenha', async () => {
    const c = await createPrivateContract(sql)
    await sql`delete from briefings where student_id = ${c.studentId}`
    await sql`
      insert into briefings (student_id, answers, kolb_answers, kolb_scores, kolb_style,
                             status, submitted_at, schema_version)
      values (${c.studentId}, ${sql.json(BRIEFING_V2_FIXTURE)}, ${sql.json(KOLB_FIXTURE)},
              ${sql.json({ CE: 0, RO: 0, AC: 6, AE: 6 })}, 'convergente', 'submitted', now(), 2)`

    const { error } = await admin.rpc('admin_revise_briefing', {
      p_student: c.studentId,
      p_patch: { historia: { cidade_vida: 'Lisboa' } },
      p_reason: 'a aluna se mudou de país',
    })
    expect(error).toBeNull()

    // 1. a MESMA leitura da camada de dados
    const revisoes = await admin
      .from('briefing_revisions')
      .select('id, actor, reason, changes, created_at')
      .eq('student_id', c.studentId)
      .order('created_at', { ascending: false })
    expect(revisoes.error).toBeNull()
    const linhas = (revisoes.data ?? []) as {
      actor: string
      reason: string
      changes: Record<string, { de: unknown; para: unknown }>
      created_at: string
    }[]
    expect(linhas).toHaveLength(1)
    expect(linhas[0].reason).toContain('mudou de país')
    expect(linhas[0].changes['historia.cidade_vida']).toEqual({ de: 'Cuiabá', para: 'Lisboa' })
    expect(linhas[0].created_at).toBeTruthy()

    // 2. o nome de quem corrigiu (a segunda leitura, feita só quando há correção)
    const perfis = await admin.from('profiles').select('id, full_name').in('id', [linhas[0].actor])
    expect(perfis.error).toBeNull()
    expect((perfis.data ?? [])[0]?.full_name).toBe('Admin M3-2')

    // 3. e as duas colunas novas do briefing, que escolhem o enunciado e a
    //    pré-carga do Kolb no painel do preenchimento por telefone
    const b = await admin
      .from('briefings')
      .select('status, kolb_style, kolb_scores, answers, submitted_at, schema_version, kolb_answers')
      .eq('student_id', c.studentId)
      .maybeSingle()
    expect(b.error).toBeNull()
    expect(b.data?.schema_version).toBe(2)
    expect(b.data?.kolb_answers).toMatchObject({ q1: 'C', q12: 'A' })
  })
})

/* ========================================================================== */
/* 2. Abas e o mapa dos painéis (função pura)                                  */
/* ========================================================================== */

describe('abas e deep links da ficha', () => {
  it('as cinco abas existem, com rótulo, e nada mais', () => {
    expect([...ABAS]).toEqual(['visao', 'contrato', 'creditos', 'briefing', 'historico'])
    for (const a of ABAS) expect(ABA_ROTULO[a].length).toBeGreaterThan(0)
    expect(ehAba('visao')).toBe(true)
    expect(ehAba('inventada')).toBe(false)
    expect(ehAba(undefined)).toBe(false)
  })

  it('TODO painel da ficha velha continua tendo endereço e sabe a aba dele', () => {
    // Os cinco que a ficha velha respondia — nenhum pode ter ficado órfão.
    for (const antigo of ['editar', 'convidar', 'pagador', 'anonimizar', 'briefing']) {
      expect(ehPainel(antigo), antigo).toBe(true)
      expect(abaDoPainel(antigo), antigo).not.toBeNull()
    }
    // …e o mapa completo, painel a painel
    expect(abaDoPainel('editar')).toBe('visao')
    expect(abaDoPainel('whatsapp')).toBe('visao')
    expect(abaDoPainel('convidar')).toBe('visao')
    expect(abaDoPainel('anonimizar')).toBe('visao')
    expect(abaDoPainel('pagador')).toBe('contrato')
    expect(abaDoPainel('briefing')).toBe('briefing')
    // Briefing v2: a correção pós-envio é o irmão do preenchimento, na mesma aba
    expect(ehPainel('briefing-correcao')).toBe(true)
    expect(abaDoPainel('briefing-correcao')).toBe('briefing')
    expect(abaDoPainel('estender')).toBe('creditos')
    expect(abaDoPainel('cancelar')).toBe('historico')
    // painel inventado não abre aba nenhuma
    expect(abaDoPainel('sei-la')).toBeNull()
    // e todo painel declarado tem destino (nada de `undefined` na tela)
    for (const p of PAINEIS) expect(abaDoPainel(p), p).not.toBeNull()
  })

  it('a aba explícita manda; sem ela, quem manda é o painel; sem os dois, a padrão', () => {
    expect(abaAtiva('creditos', 'editar')).toBe('creditos')
    expect(abaAtiva(undefined, 'estender')).toBe('creditos')
    expect(abaAtiva(undefined, undefined)).toBe(ABA_PADRAO)
    expect(abaAtiva('inventada', undefined)).toBe(ABA_PADRAO)
  })

  it('o endereço da ficha é limpo na aba padrão e carrega alvo quando precisa', () => {
    expect(enderecoDaFicha('abc')).toBe('/admin/alunos/abc')
    expect(enderecoDaFicha('abc', { aba: 'visao' })).toBe('/admin/alunos/abc')
    expect(enderecoDaFicha('abc', { aba: 'creditos' })).toBe('/admin/alunos/abc?aba=creditos')
    expect(enderecoDaFicha('abc', { painel: 'convidar' })).toBe('/admin/alunos/abc?painel=convidar')
    expect(enderecoDaFicha('abc', { painel: 'estender', alvo: 42 })).toBe(
      '/admin/alunos/abc?painel=estender&alvo=42',
    )
  })

  // INVERTIDO no M3-3 (anexo A1). Este teste provava a DIVERGÊNCIA (form com 6,
  // banco com 11) enquanto ela estava anotada; agora prova a PARIDADE. O que
  // fechou a divergência foi a fonte única: `nivelValido`, em `alunos-grupos`.
  it('o seletor de nível oferece exatamente os níveis que a action aceita', () => {
    expect([...NIVEIS_DO_CADASTRO]).toEqual([...NIVEIS])
    expect(NIVEIS_DO_CADASTRO).toHaveLength(11)
    // …e não há mais lista copiada à mão dentro das actions de cadastro
    for (const rel of ['src/app/admin/alunos/actions.ts', 'src/app/admin/alunos/novo/actions.ts']) {
      const acao = corpo(rel)
      expect(acao, rel).toContain("from '@/data/admin/alunos-grupos'")
      expect(acao, rel).toContain('nivelValido(level)')
      expect(acao, rel).not.toMatch(/'A1',\s*'A2',\s*'B1'/)
    }
    // o sentinela do "ainda não avaliado" continua fora do vocabulário aceito
    expect(nivelValido(SEM_NIVEL_NO_FORM)).toBe(false)
    for (const n of NIVEIS_DO_CADASTRO) expect(nivelValido(n), n).toBe(true)
  })
})

/* ========================================================================== */
/* 3. Aceites de grep da tela nova                                             */
/* ========================================================================== */

const ARQUIVOS_DA_FICHA = [
  'src/app/admin/alunos/[id]/page.tsx',
  'src/components/admin/alunos/ficha/abas.tsx',
  'src/components/admin/alunos/ficha/paineis.tsx',
  'src/components/admin/alunos/ficha/pecas.tsx',
  'src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx',
  // A6/lote 2: o painel "cancelar" virou peça própria (cliente) para a
  // confirmação destrutiva ler a escolha de "quem cancelou" na hora. Entra na
  // lista no MESMO commit em que nasce — as réguas da ficha valem para ele.
  'src/components/admin/alunos/ficha/CancelarAula.tsx',
  'src/data/admin/ficha.ts',
  'src/data/admin/ficha-gramatica.ts',
]

describe('aceites da ficha nova', () => {
  it.each(ARQUIVOS_DA_FICHA)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_DA_FICHA)('%s não abre overlay fora do kit', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  it.each(ARQUIVOS_DA_FICHA)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  it('a página não faz query inline — quem lê é a camada de dados', () => {
    const p = codigo('src/app/admin/alunos/[id]/page.tsx')
    expect(p).not.toContain('@/lib/supabase')
    expect(p).not.toMatch(/\.from\(/)
    expect(p).not.toMatch(/\.rpc\(/)
    expect(p).toContain("from '@/data/admin/ficha'")
    expect(p).toContain('getStudentFile')
    // 404 honesto quando o id não é de aluno nenhum
    expect(p).toContain('notFound()')
  })

  it('a camada de dados é server-only, valida o retorno e não engole erro', () => {
    const d = corpo('src/data/admin/ficha.ts')
    expect(d.startsWith("import 'server-only'")).toBe(true)
    expect(d).toContain('FichaDiretorioSchema.parse')
    expect(d).toContain("exigir('o diretório do aluno'")
    expect(d).toContain("exigir('os contratos'")
    expect(d).toContain("exigir('o extrato de créditos'")
    // Lei 1: hora do aluno e das aulas calculadas no SERVIDOR, na zona certa
    expect(d).toContain('setZone(aluno.iana_tz)')
    expect(d).toContain('setZone(BUSINESS_TZ)')
  })

  it('as cinco abas estão montadas na página, cada uma com o corpo dela', () => {
    const p = corpo('src/app/admin/alunos/[id]/page.tsx')
    for (const componente of [
      'AbaVisaoGeral',
      'AbaContrato',
      'AbaCreditos',
      'AbaBriefing',
      'AbaHistorico',
    ]) {
      expect(p, componente).toContain(`<${componente} ficha={ficha} />`)
    }
    // o card-contêiner do kit é a moldura das abas
    expect(p).toContain('<CardPanel>')
    expect(p).toContain('<CardPanelTabs tabs={abas} />')
  })

  // A REGRESSÃO QUE BLOQUEAVA O DEPLOY DA ONDA: a extensão de validade só
  // existia na home velha. Ela precisa estar alcançável de novo, com auditoria.
  it('a extensão de validade de crédito voltou a ter dono, com motivo obrigatório', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain("from '@/app/admin/credit-actions'")
    expect(paineis).toContain('action={extendCreditAction}')
    expect(paineis).toContain('name="ledger_id"')
    expect(paineis).toContain('name="new_expires_on"')
    // motivo é obrigatório no formulário (o banco também recusa vazio)
    expect(paineis).toMatch(/name="note" required/)

    // e há um caminho até ele na aba de créditos, um por crédito vivo
    const abas = codigo('src/components/admin/alunos/ficha/abas.tsx')
    expect(abas).toContain("painel: 'estender'")
    expect(abas).toContain('alvo: c.ledgerId')

    // a action volta para a ficha (e não mais sempre para o Início)
    const acao = codigo('src/app/admin/credit-actions.ts')
    expect(acao).toContain("formData.get('back')")
    expect(acao).toContain("admin_extend_credit")
  })

  it('as destrutivas mantêm o type-to-confirm e a consequência declarada', () => {
    const paineis = corpo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain('name="confirm_name"')
    expect(paineis).toContain('Digite o nome EXATO para confirmar')
    expect(paineis).toContain('action={anonymizeStudentAction}')
    // cancelamento de aula declara a consequência antes de perguntar
    expect(paineis).toContain('action={cancelClassAction}')
    // A6/lote 2: o corpo do painel mudou de arquivo (virou peça cliente, para a
    // confirmação saber QUEM pediu o cancelamento). A afirmação continua a
    // mesma; o que mudou é onde ela mora.
    const cancelar = corpo('src/components/admin/alunos/ficha/CancelarAula.tsx')
    expect(cancelar).toContain('ADR-018')
    // …e o destrutivo passou a parar numa confirmação (o mesmo componente da
    // Agenda: duas telas, uma matriz só).
    expect(cancelar).toContain('ConfirmarDesfecho')

    // A6 · prova independente L2 (GRAVE): as próximas aulas da ficha incluem as
    // do contrato de GRUPO (casal/turma), e o painel entregava o cadastro do
    // aluno DA FICHA como se fosse o de todo mundo — as duas caixas podiam
    // nascer desmarcadas por causa dele e silenciar o aviso de TODOS os
    // membros. Aula de grupo passa `null/null` (o "não sei" da matriz), e a
    // marca vem POR AULA da camada de dados, sem N+1.
    expect(paineis).toContain('aula.ehGrupo')
    expect(paineis).toContain('{ temLogin: null, temWhatsapp: null }')
    const dados = corpo('src/data/admin/ficha.ts')
    expect(dados).toContain('ehGrupo: contratosDeGrupo.has(a.contract_id)')
    expect(corpo('src/data/admin/ficha-consultas.ts')).toContain('student_group_id')

    // A cor da destrutiva vem de CLASSE, não de utility empilhada: as regras
    // `.btn-*` são unlayered e venceriam `text-danger-700`/`bg-danger-700` —
    // o botão sairia no acento, dizendo "confirme" na cor de "prossiga".
    expect(paineis).toContain("'btn-danger btn-ac-lg'")
    const css = corpo('src/app/globals.css')
    expect(css).toContain('.btn-danger {')
    expect(css).toContain('.btn-danger-ghost {')
    for (const rel of ARQUIVOS_DA_FICHA) {
      expect(codigo(rel), rel).not.toMatch(/btn-ac[a-z-]*[^"'`]*\b(text|bg)-danger/)
    }
  })

  it('nenhuma mutação foi reescrita: os forms apontam para as actions de sempre', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    for (const acao of [
      'updateStudentAction',
      'updateStudentWhatsappAction',
      'inviteStudentAction',
      'linkPayerAction',
      'createPayerAction',
      'anonymizeStudentAction',
      'adminFillBriefingAction',
    ]) {
      expect(paineis, acao).toContain(`action={${acao}}`)
    }
    const abas = codigo('src/components/admin/alunos/ficha/abas.tsx')
    for (const acao of [
      'resendInviteAction',
      'finishAuthBlockAction',
      'unlinkPayerAction',
      'sendBriefingReminderAction',
      'sendBriefingUpdateReminderAction',
      'adminGeneratePlanAction',
    ]) {
      expect(abas, acao).toContain(`action={${acao}}`)
    }
  })

  it('o briefing da retaguarda usa os MESMOS campos do portal', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain("from '@/components/BriefingFields'")
    for (const etapa of ['EtapaHistoria', 'EtapaObjetivos', 'EtapaInteresses', 'EtapaRotina', 'EtapaKolb']) {
      expect(paineis, etapa).toContain(`<${etapa} `)
    }
    // Briefing v2: as etapas ramificadas entraram junto — o painel desenhava
    // SEMPRE as telas v1 enquanto a action já montava o jsonb pela versão da
    // linha (o buraco declarado no P2.2).
    for (const etapa of ['EtapaHistoriaV2', 'EtapaObjetivosV2', 'EtapaInteressesV2']) {
      expect(paineis, etapa).toContain(`<${etapa} `)
    }
    expect(paineis).toContain('versao === 1 ?')
    expect(paineis).toContain('tipo={tipo}')
  })

  it('o painel do telefone pré-carrega o Kolb e avisa a criança sobre o responsável', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    // O fix aprovado da spec: era `kolb={{}}` — reabrir o painel apagava as
    // letras já respondidas, porque o formulário reenvia tudo.
    expect(paineis).not.toContain('kolb={{}}')
    expect(paineis).toContain('kolb={kolbAtual}')
    expect(paineis).toContain('const kolbAtual = ficha.briefing?.kolb ?? {}')
    expect(paineis).toContain("const comResponsavel = versao >= 2 && ficha.tipo === 'child'")
    expect(paineis).toContain('notaResponsavel={comResponsavel}')
    // e a camada de dados de fato traz as letras e a versão da linha
    const d = codigo('src/data/admin/ficha.ts')
    expect(d).toContain('kolb_answers')
    expect(d).toContain('schema_version')
  })

  it('a correção pós-envio tem painel, action e a RPC do banco (Kolb fora)', () => {
    const paineis = codigo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain('action={adminReviseBriefingAction}')
    expect(paineis).toContain('name="secao"')
    expect(paineis).toMatch(/name="motivo" required/)
    const abas = codigo('src/components/admin/alunos/ficha/abas.tsx')
    expect(abas).toContain("painel: 'briefing-correcao'")

    const acao = codigo('src/app/admin/alunos/actions.ts')
    expect(acao).toContain("rpc('admin_revise_briefing'")
    expect(acao).toContain('montarPatchDeRevisao')
    // a recusa do banco vira o recado da tela (nada de validação paralela)
    expect(acao).toContain('Falha na correção: ${error.message}')
  })

  it('a ficha lê o briefing pelo DICIONÁRIO — nenhum enunciado escrito na tela', () => {
    const abas = codigo('src/components/admin/alunos/ficha/abas.tsx')
    // O `<details>` que despejava o jsonb cru morreu, e com ele o JSON na tela
    expect(abas).not.toContain('JSON.stringify')
    expect(abas).not.toContain('Ver todas as respostas')
    expect(abas).toContain('<RespostasDoBriefing briefing={b} />')
    expect(abas).toContain('<HistoricoDeRevisoes')

    const leitura = codigo('src/components/admin/alunos/ficha/briefing-leitura.tsx')
    expect(leitura).not.toContain('JSON.stringify')
    expect(leitura).toContain("from '@/lib/briefing/leitura'")
    expect(leitura).toContain('entradaDaChave')
    // e o painel da professora parou de citar chave literal com forma fixa
    const teacher = codigo('src/app/teacher/alunos/[contract]/page.tsx')
    expect(teacher).not.toContain('a.interesses?.hobbies')
    expect(teacher).not.toContain("typeof a.objetivos?.finalidades === 'string'")
    expect(teacher).toContain('resumoDoBriefing')
  })

  it('os painéis vestem o rodapé fixo do kit e voltam para a ficha', () => {
    const paineis = corpo('src/components/admin/alunos/ficha/paineis.tsx')
    expect(paineis).toContain('<SheetFooter')
    expect(paineis).toContain('Cancelar')
    // o corpo do painel é o do kit (rolagem contida), não uma div qualquer
    expect(paineis).toContain('<SheetBody>')
  })
})

/* ========================================================================== */
/* 4. Render das peças (o grep não prova que a peça desenha)                    */
/* ========================================================================== */

/** Ficha mínima: um aluno com contrato ativo, dois créditos e nenhum extra. */
function fichaFake(): FichaDoAluno {
  return {
    id: 'aluno-1',
    nome: 'Sabrina Marques',
    nivel: 'B1',
    // M3-c5 · D1 — os campos novos do cadastro e a nota interna.
    tipo: 'adult',
    tipoRotulo: 'adulto',
    nascimento: '14/02/1994',
    nascimentoIso: '1994-02-14',
    comoConheceu: 'indicação da Mariana',
    notaInterna: { texto: 'Prefere aula de manhã.', quando: '26/07/2026' },
    agoraNoNegocio: '2026-07-27T09:30',
    // Ciclo de vida (fase 1): a ficha fala a situação DERIVADA, não o
    // `students.status` cru — o mesmo vocabulário da badge do hub.
    situacao: 'ativo',
    situacaoRotulo: 'ativo',
    arquivado: false,
    ehLead: false,
    cidade: 'Orlando, US',
    cidadeCanonica: 'Orlando',
    pais: 'US',
    horaLocal: '09:30',
    tzRotulo: 'Nova York',
    ianaTz: 'America/New_York',
    // P6 da revisão nº 8: esta ficha tem cidade de verdade, então o fuso é fato.
    fusoAConfirmar: false,
    acesso: 'ativo',
    email: 'sabrina@exemplo.com',
    emailDevolvido: false,
    whatsapp: '+5565999999999',
    cienciaDoCanal: '18/07/2026',
    convidadoEm: '01/07/2026',
    ultimoAcesso: '25/07/2026',
    temLogin: true,
    bloqueioDeLoginPendente: false,
    temMentoria: false,
    contratos: [
      {
        id: 'c-1',
        tipo: 'private_1on1',
        produto: 'Aulas particulares',
        plano: 'Plano semanal 60min',
        situacao: 'active',
        situacaoRotulo: 'ativo',
        situacaoTom: 'ok',
        professora: { id: 't-1', nome: 'Helena', idx: 0 },
        turma: null,
        experimental: false,
        valorHora: 'R$ 120,00',
        vigencia: { inicio: '01/03/2026', fim: null },
        politica: { remarcacoes: 2, avisoHoras: 24, validadeDias: 60 },
        horarios: [{ id: 's-1', aluno: 'terça · 20:30–21:30', professora: '21:30' }],
        pausas: [],
        saldo: 2,
        proximaValidade: '31/08/2026',
        gerirEm: '/admin/contratos',
      },
    ],
    encerrados: [],
    creditos: {
      disponiveis: 2,
      agendados: 1,
      total: 3,
      proximaValidade: '31/08/2026',
      tomDaValidade: 'ok',
      // A6/lote 3: contrato ATIVO — a validade corre, e a palavra continua
      // sendo "vale até" (o caso congelado é provado no `onda-agenda-a6` DOM).
      validadeCongelada: false,
      vivos: [],
      extrato: [],
      extratoTruncado: false,
    },
    aulas: { proximas: [], passadas: [] },
    cobrancas: [],
    pagadores: [
      { id: 'p-1', nome: 'Marcos Marques', email: null, cpfCnpj: null, noAsaas: true, self: false },
    ],
    pagadoresDisponiveis: [],
    briefing: null,
    plano: null,
    contratoParaPlano: 'c-1',
  }
}

describe('as peças da ficha desenham', () => {
  it('a coluna de identidade traz retrato, contrato e o trio de créditos', () => {
    const html = renderToStaticMarkup(h(ColunaDeIdentidade, { ficha: fichaFake() }))
    expect(html).toContain('Sabrina Marques')
    // avatar de iniciais, na medida da ficha (64px)
    expect(html).toContain('SM')
    expect(html).toContain('h-16 w-16')
    // identidade: onde vive + que horas são lá (Lei 1: texto pronto do servidor)
    expect(html).toContain('Orlando, US')
    expect(html).toContain('09:30')
    // contrato ativo com horário fixo pelo slotLine
    expect(html).toContain('terça · 20:30–21:30')
    expect(html).toContain('R$ 120,00')
    // trio Make-Up
    expect(html).toContain('Disponíveis')
    expect(html).toContain('Agendados')
    expect(html).toContain('Total')
    expect(html).toContain('vale até 31/08/2026')
    // atalho para o pagador (a aba onde ele mora)
    expect(html).toContain('Ver pagador (Marcos Marques)')
    expect(html).toContain('?aba=contrato')
  })

  // A6/lote 3 · prova independente L3: contrato PAUSADO congela a validade, e a
  // ficha chamava o crédito congelado de "vencido"/"vale até" — enquanto o
  // portal do aluno mostrava o MESMO crédito como "contagem parada". Duas telas
  // contando histórias opostas sobre o mesmo dinheiro.
  it('crédito CONGELADO não é "vale até" nem "venceu" — é contagem parada', () => {
    const base = fichaFake()
    const congelada: FichaDoAluno = {
      ...base,
      creditos: {
        ...base.creditos,
        proximaValidade: '12/08/2026',
        // o tom neutro é parte do conserto: congelado não é alarme
        tomDaValidade: 'muted',
        validadeCongelada: true,
      },
    }
    const html = renderToStaticMarkup(h(ColunaDeIdentidade, { ficha: congelada }))
    expect(html).toContain('valia até')
    expect(html).toContain('contagem parada')
    expect(html).not.toContain('vale até 12/08/2026')
    expect(html).not.toContain('venceu 12/08/2026')
  })

  it('sem contrato, a coluna diz o que fazer em vez de mostrar um cartão vazio', () => {
    const semContrato: FichaDoAluno = { ...fichaFake(), contratos: [] }
    const html = renderToStaticMarkup(h(ColunaDeIdentidade, { ficha: semContrato }))
    expect(html).toContain('Sem contrato ativo')
    expect(html).toContain('Criar contrato')
    // ATUALIZADO NO M4-4: o destino era a lista velha (`/admin/contratos`), que
    // morreu — e onde o CTA "Criar contrato" caía numa TELA DE LISTA, não numa
    // de criação. A intenção do aceite (o cartão vazio leva a CRIAR) não
    // afrouxou: ela ficou mais exigente, porque agora o endereço é o do wizard,
    // com o tipo já escolhido.
    expect(html).toContain('href="/admin/contratos/novo?tipo=individual"')
  })

  it('a grade de pares põe "—" no vazio e mantém o hairline', () => {
    const html = renderToStaticMarkup(
      h(Pares, {
        itens: [
          { rotulo: 'E-mail', valor: 'a@exemplo.com' },
          { rotulo: 'WhatsApp' },
          { rotulo: 'Observação', valor: '', largo: true },
        ],
      }),
    )
    expect(html).toContain('a@exemplo.com')
    // dois vazios viram travessão — campo sumido esconderia a ausência
    expect(html.match(/—/g) ?? []).toHaveLength(2)
    expect(html).toContain('border-b border-line-soft')
    expect(html).toContain('sm:col-span-2')
    // rótulo é rótulo (cinza legível) e valor é DADO (tinta)
    expect(html).toContain('text-sm text-ink-600')
    expect(html).toContain('text-sm font-medium break-words text-ink-900')
  })

  /** O briefing v2 como a ficha o recebe (`getStudentFile`). */
  function briefingFake(): BriefingNaFicha {
    return {
      enviado: true,
      rascunho: false,
      estilo: { chave: 'convergente', nome: 'Convergente', leitura: 'Aprende resolvendo.' },
      pontuacoes: [{ sigla: 'AC', valor: 6 }],
      enviadoEm: '20/07/2026',
      versao: 2,
      kolb: KOLB_FIXTURE,
      revisoes: [],
      atualizacaoPendente: null,
      atualizacoes: [],
      respostas: {
        ...BRIEFING_V2_FIXTURE,
        // Seção de outra época: nada some da ficha — ela entra no fim, com o
        // nome cru, em vez de sumir por não estar no dicionário.
        antiga: { pergunta_esquecida: 'resposta que alguém gravou um dia' },
      },
    }
  }

  it('as respostas do briefing saem com a PERGUNTA por extenso, não com a chave', () => {
    const html = renderToStaticMarkup(h(RespostasDoBriefing, { briefing: briefingFake() }))

    // os títulos das etapas, na ordem em que o aluno respondeu
    for (const t of ['Sua história com o inglês', 'Seus objetivos', 'Seus interesses', 'Sua rotina', 'Para fechar']) {
      expect(html, t).toContain(t)
    }
    // o enunciado vem do DICIONÁRIO (v2), não escrito na tela
    expect(html).toContain(enunciadoDaChave('cidade_vida', 2))
    expect(html).toContain(enunciadoDaChave('facil', 2))
    expect(html).toContain(enunciadoDaChave('alvo_6_meses', 2))
    expect(html).toContain('Cuiabá')

    // múltipla escolha vira lista legível — nada de JSON nem [object Object]
    expect(html).toContain('Aulas particulares · Escola / curso em grupo')
    expect(html).toContain('reuniões · e-mails · apresentações')
    expect(html).not.toContain('[object Object]')
    expect(html).not.toContain('{&quot;')

    // sim-não + detalhe viram UMA resposta, e o campo de detalhe não vira linha
    expect(html).toContain('sim — fantasia e biografias')
    expect(html).toContain('>não</dd>')
    expect(html).not.toContain(enunciadoDaChave('leitura_detalhe', 2))

    // a rotina volta a ser GRADE (dias × blocos), como na coleta
    expect(html).toContain('<table')
    // a semana INTEIRA nas colunas (dia sem marca é informação), e nas linhas os
    // blocos que a pessoa marcou
    for (const dia of ['seg', 'ter', 'sáb', 'dom']) expect(html, dia).toContain(`>${dia}<`)
    expect(html).toContain('>Noite<')
    expect(html).toContain('>Manhã<')
    expect(html).toContain('✓')

    // opcional em branco continua na grade dizendo que está vazio
    expect(html).toContain('>—</dd>')

    // chave e seção que o dicionário não conhece aparecem CRUAS, não escondidas
    expect(html).toContain('<code')
    expect(html).toContain('antiga')
    expect(html).toContain('pergunta_esquecida')
    expect(html).toContain('resposta que alguém gravou um dia')
  })

  it('o histórico de revisões diz quem, quando, por quê e o de → para', () => {
    const revisoes: RevisaoDoBriefing[] = [
      {
        id: 'r-1',
        quando: '28/07/2026 às 14:32',
        quem: 'Helena',
        motivo: 'a aluna se mudou de país e corrigiu por telefone',
        mudancas: [
          {
            campo: 'historia.cidade_vida',
            secao: 'historia',
            chave: 'cidade_vida',
            de: 'Cuiabá',
            para: 'Lisboa',
          },
          {
            campo: 'historia.experiencia_marcante',
            secao: 'historia',
            chave: 'experiencia_marcante',
            de: null,
            para: 'um mês em Orlando, em 2019',
          },
        ],
      },
    ]
    const html = renderToStaticMarkup(h(HistoricoDeRevisoes, { revisoes, versao: 2 }))

    expect(html).toContain('28/07/2026 às 14:32')
    expect(html).toContain('Helena')
    expect(html).toContain('se mudou de país')
    // a mudança é lida pela PERGUNTA, não pela chave
    expect(html).toContain(enunciadoDaChave('cidade_vida', 2))
    expect(html).toContain('Cuiabá')
    expect(html).toContain('Lisboa')
    // e a ausência anterior é dita em voz alta
    expect(html).toContain('(sem resposta)')
  })

  it('a seção traz título na régua medida e o lápis à direita', () => {
    const html = renderToStaticMarkup(
      h(Secao, { titulo: 'Identidade', apoio: 'quem é o aluno', children: null, acao: null }),
    )
    expect(html).toContain('title-section')
    expect(html).toContain('Identidade')
    expect(html).toContain('quem é o aluno')
  })
})
