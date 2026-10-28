// ONDA 1 · M4-2 — o DETALHE de um contrato (`/admin/contratos/[id]`): o que a
// camada de dados lê, o que a gramática nomeia, o que a tela promete e o que
// ela DESENHA.
//
// Cobre:
//  · `lerContratoDoDetalhe` executada de verdade contra a bancada, nos cinco
//    casos que a tela precisa acertar: contrato de aluno, contrato de GRUPO
//    (com membros e âncora de fuso), contrato com PAUSA aberta, contrato com
//    horário FECHADO no histórico e contrato com aula passada sem desfecho (o
//    gate duro de encerrar/renovar);
//  · a gramática pura do M4-2: os oito painéis, o endereço com `?painel=`/
//    `?alvo=` e a comparação do type-to-confirm — que agora é UMA função,
//    usada pela tela e pela action;
//  · os aceites da tela nova (rota, painéis mapeados, gates antecipados, zero
//    query inline, régua de legibilidade) e o giro dos DOIS links: a linha da
//    lista e o "Gerir em Contratos" da ficha do aluno;
//  · o render das seções — os lápis, o gate desabilitado com o número e o
//    contrato encerrado sem edição nenhuma.
//
// O QUE NÃO DÁ PARA CHAMAR AQUI, e por quê: `getContractFile(id)` monta o
// cliente Supabase a partir dos cookies do request (`server-only`). Por isso o
// corpo da leitura mora em `contrato-detalhe.ts`, que recebe o cliente por
// parâmetro — é ESSA função que a página chama e que o teste executa, com um
// cliente de admin real. Mesmo arranjo de `ficha-consultas.ts`.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { destinoDoLegado } from '@/data/admin/contratos-legado'
import { connect, createInstance, createPrivateContract, createSlot, createStudent, createTeacher } from './helpers/db'
import { SecoesDoContrato, fraseDaPendencia } from '@/components/admin/contratos/detalhe'
import { lerContratoDoDetalhe, type FichaDoContrato } from '@/data/admin/contrato-detalhe'
import {
  DIAS_DA_SEMANA,
  PAINEIS_DO_CONTRATO,
  PAINEL_DO_CONTRATO_TITULO,
  ehPainelDoContrato,
  enderecoDoContrato,
} from '@/data/admin/contratos-gramatica'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/* ========================================================================== */
/* 1. A leitura, contra o banco                                                */
/* ========================================================================== */

describe('lerContratoDoDetalhe (contra o banco local)', () => {
  let sql: Sql
  let admin: SupabaseClient

  beforeAll(async () => {
    sql = connect(3)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M4-2'), 'admin')
  })
  afterAll(async () => {
    await sql.end()
  })

  it('contrato de ALUNO: identidade, valores, política, vigência e créditos', async () => {
    const c = await createPrivateContract(sql, { allowance: 3 })
    await sql`update students set display_name = 'Elisa do M4-2', level = 'B1' where id = ${c.studentId}`
    await sql`update teachers set display_name = 'Dona do M4-2' where id = ${c.teacherId}`

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    expect(ficha, 'o contrato existe').not.toBeNull()
    expect(ficha!.quem).toBe('Elisa do M4-2')
    expect(ficha!.alunoId).toBe(c.studentId)
    expect(ficha!.grupo).toBeNull()
    expect(ficha!.nivel).toBe('B1')
    expect(ficha!.situacao).toBe('active')
    expect(ficha!.encerrado).toBe(false)
    expect(ficha!.professora.nome).toBe('Dona do M4-2')
    // Lei 9: centavos no banco, reais na tela — e o campo do formulário à parte
    expect(ficha!.valorHora).toContain('150')
    expect(ficha!.valorHoraCampo).toBe('150.00')
    expect(ficha!.politica).toMatchObject({
      remarcacoes: 3,
      avisoHoras: 24,
      validadeDias: 90,
      falhaDaEscolaDias: 180,
    })
    // saldo derivado do banco (`contract_credit_summary`), nunca contado aqui
    expect(ficha!.creditos.saldo).toBe(0)
    // a validade sugerida do ajuste manual = hoje + a regra DESTE contrato
    expect(ficha!.creditos.validadeSugeridaIso).toBe(
      DateTime.now().setZone('America/Cuiaba').plus({ days: 90 }).toFormat('yyyy-LL-dd'),
    )
    // a aba Créditos da ficha do aluno, só porque este contrato tem UMA pessoa
    expect(ficha!.creditos.verEm).toBe(`/admin/alunos/${c.studentId}?aba=creditos`)
    expect(ficha!.pendencias).toBe(0)
    expect(ficha!.destinos).toEqual([])
    // as duas pontas do campo de virada da renovação (o teto do banco é 56 dias)
    expect(
      DateTime.fromISO(ficha!.viradaMaximaIso).diff(DateTime.fromISO(ficha!.hojeIso), 'days').days,
    ).toBe(56)
  })

  it('o horário fixo chega como TEXTO pronto, com o slot que o gerou na ocupação', async () => {
    const c = await createPrivateContract(sql)
    await sql`update students set display_name = 'Aluna do horário M4-2' where id = ${c.studentId}`
    // pela RPC (e não por insert): é ela que materializa as instâncias, que são
    // a fonte da ocupação da professora
    const criado = await admin.rpc('create_slot', {
      p_contract: c.contractId,
      p_weekday: 2,
      p_local_time: '20:30',
      p_duration_min: 45,
    })
    expect(criado.error).toBeNull()

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    expect(ficha!.horarios).toHaveLength(1)
    const h0 = ficha!.horarios[0]
    expect(h0.texto).toBe('terça · 20:30–21:15')
    expect(h0.weekday).toBe(2)
    expect(h0.hora).toBe('20:30')
    expect(h0.duracao).toBe(45)
    expect(h0.encerradoEm).toBeNull()
    expect(ficha!.horariosFechados).toEqual([])

    // a ocupação da professora traz a janela DESTE horário carimbada com o slot
    // — é o que permite à troca ignorar o horário que ela mesma vai fechar
    const minhas = ficha!.ocupacao.filter((j) => j.slotId === h0.id)
    expect(minhas.length, 'a aula do próprio contrato aparece na agenda').toBeGreaterThan(0)
    expect(minhas[0].quem).toBe('Aluna do horário M4-2')
    // e a leitura é recortada pela professora DESTE contrato: a agenda das
    // outras não tem por que viajar até esta tela
    expect(ficha!.ocupacao.every((j) => j.professoraId === c.teacherId)).toBe(true)
    expect(ficha!.ocupacao.filter((j) => j.slotId !== h0.id)).not.toContainEqual(
      expect.objectContaining({ slotId: h0.id }),
    )
  })

  it('contrato de GRUPO: rótulo da turma, membros e âncora de fuso', async () => {
    const teacherId = await createTeacher(sql)
    const a = await createStudent(sql, 'America/Cuiaba')
    const b = await createStudent(sql, 'Europe/Lisbon')
    await sql`update students set display_name = 'Natália M4-2' where id = ${a}`
    await sql`update students set display_name = 'Yago M4-2' where id = ${b}`
    const [g] = await sql`insert into student_groups (label) values ('Casal M4-2') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${a}), (${g.id}, ${b})`
    const [contrato] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, group_tz_anchor_student)
      values ('private_1on1', ${g.id}, ${teacherId}, 'Aulas do casal', 18000, 4, 24, 90,
              public.business_today(), ${b})
      returning id`

    const ficha = await lerContratoDoDetalhe(admin, contrato.id as string)
    expect(ficha!.quem).toBe('Casal M4-2')
    expect(ficha!.alunoId, 'grupo não tem ficha: a ficha é de uma pessoa').toBeNull()
    expect(ficha!.creditos.verEm).toBeNull()
    expect(ficha!.grupo?.label).toBe('Casal M4-2')
    expect(ficha!.grupo?.membros.map((m) => m.nome)).toEqual(['Natália M4-2', 'Yago M4-2'])
    expect(ficha!.grupo?.membros.find((m) => m.ancora)?.nome).toBe('Yago M4-2')
    // o fuso que rege os horários é o da ÂNCORA declarada, não o do primeiro membro
    expect(ficha!.fusoDoHorario.iana).toBe('Europe/Lisbon')
  })

  it('contrato PAUSADO: a pausa aberta chega em curso', async () => {
    const c = await createPrivateContract(sql)
    expect((await admin.rpc('pause_contract', { p_contract: c.contractId })).error).toBeNull()

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    expect(ficha!.situacao).toBe('paused')
    expect(ficha!.pausado).toBe(true)
    expect(ficha!.pausas).toHaveLength(1)
    expect(ficha!.pausas[0].aberta).toBe(true)
    expect(ficha!.pausas[0].ate).toBeNull()
  })

  it('horário FECHADO sai do vigente e entra no histórico', async () => {
    const c = await createPrivateContract(sql)
    const slot = await createSlot(sql, c, { weekday: 4, localTime: '09:00', tz: 'America/Cuiaba' })
    await sql`update recurring_slots set active_to = current_date - 1 where id = ${slot}`

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    expect(ficha!.horarios, 'nenhum horário vigente').toEqual([])
    expect(ficha!.horariosFechados).toHaveLength(1)
    expect(ficha!.horariosFechados[0].encerradoEm).not.toBeNull()
  })

  it('aula passada sem desfecho vira a contagem que trava encerrar e renovar', async () => {
    const c = await createPrivateContract(sql)
    await createInstance(sql, c, { startsInHours: -30 })

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    // a MESMA pergunta de `_contract_pending_count`: agendada e já começada
    const [{ n }] = await sql<{ n: number }[]>`
      select public._contract_pending_count(${c.contractId}) as n`
    expect(ficha!.pendencias).toBe(Number(n))
    expect(ficha!.pendencias).toBe(1)
  })

  it('destino de crédito = outro contrato ATIVO do mesmo aluno', async () => {
    const c = await createPrivateContract(sql)
    const [outro] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${c.studentId}, ${c.teacherId}, 'Plano irmão M4-2', 15000, 4, 24, 90,
              public.business_today())
      returning id`

    const ficha = await lerContratoDoDetalhe(admin, c.contractId)
    expect(ficha!.destinos.map((d) => d.id)).toEqual([outro.id])
    expect(ficha!.destinos[0].plano).toBe('Plano irmão M4-2')
  })

  it('id que não existe devolve null (a página responde 404, não uma tela vazia)', async () => {
    expect(await lerContratoDoDetalhe(admin, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

/* ========================================================================== */
/* 2. A gramática pura                                                         */
/* ========================================================================== */

describe('gramática do detalhe', () => {
  it('os painéis do M4-2 (mais os dois do c15) existem, com título cada um', () => {
    expect([...PAINEIS_DO_CONTRATO]).toEqual([
      'regras',
      'renovar',
      'encerrar',
      'pausa',
      'credito',
      'assinatura',
      // c15 · decisão B: os dois atos humanos sobre uma reserva de assinatura
      // aberta, no lugar do reclaim automático de 30 minutos do c14.
      'reserva-anexar',
      'reserva-cancelar',
      'horario-novo',
      'horario-trocar',
      // Onda Financeiro · F2: a porta da mensalidade (previsto v3).
      'mensalidade',
    ])
    for (const p of PAINEIS_DO_CONTRATO) expect(PAINEL_DO_CONTRATO_TITULO[p]).toBeTruthy()
  })

  it('`?painel=` recusa o que não é painel', () => {
    expect(ehPainelDoContrato('regras')).toBe(true)
    expect(ehPainelDoContrato('apagar-tudo')).toBe(false)
    expect(ehPainelDoContrato(undefined)).toBe(false)
  })

  it('o endereço leva painel e alvo — e fica limpo sem eles', () => {
    expect(enderecoDoContrato('abc')).toBe('/admin/contratos/abc')
    expect(enderecoDoContrato('abc', { painel: 'credito' })).toBe(
      '/admin/contratos/abc?painel=credito',
    )
    expect(enderecoDoContrato('abc', { painel: 'horario-trocar', alvo: 's-1' })).toBe(
      '/admin/contratos/abc?painel=horario-trocar&alvo=s-1',
    )
  })

  // O aceite do type-to-confirm ("ignora caixa e espaço, mas NÃO ignora
  // acento") MUDOU DE ARQUIVO no c13 · nº 5: `nomeConfirmado` morreu e a
  // comparação passou a ser de `admin_end_contract`, dentro da transação. A
  // mesma régua é provada CONTRA O BANCO em `c13-correcoes-sol-3.test.ts` —
  // inclusive a recusa quando o nome muda entre a tela e o envio, que é o
  // defeito (TOCTOU) que nenhuma versão em TypeScript conseguia pegar.

  it('os dias da semana seguem a convenção do banco (0 = domingo)', () => {
    expect(DIAS_DA_SEMANA[0]).toBe('domingo')
    expect(DIAS_DA_SEMANA[2]).toBe('terça')
    expect(DIAS_DA_SEMANA).toHaveLength(7)
  })
})

/* ========================================================================== */
/* 3. Aceites da tela nova                                                     */
/* ========================================================================== */

const ARQUIVOS_DO_M4_2 = [
  'src/data/admin/contrato-detalhe.ts',
  'src/components/admin/contratos/detalhe.tsx',
  'src/components/admin/contratos/paineis.tsx',
  'src/components/admin/contratos/FormularioDeHorario.tsx',
  'src/app/admin/contratos/[id]/page.tsx',
]

describe('aceites do M4-2', () => {
  it.each(ARQUIVOS_DO_M4_2)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não abre overlay fora do kit nem usa `<details data-popup>`', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não fabrica `?msg=` nem nonce', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não rebaixa dado para 12px nem para o cinza de apoio', (rel) => {
    const c = codigo(rel).replace(/(?:placeholder|data-\[placeholder\]):text-ink-400/g, '')
    expect(c).not.toMatch(/text-xs/)
    expect(c).not.toMatch(/text-ink-400/)
    expect(c).not.toMatch(/text-\[1[0-3]px\]/)
    expect(c).not.toMatch(/font-(light|extralight)/)
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não usa o link-ação de 12px', (rel) => {
    expect(codigo(rel)).not.toContain('linkActionXs')
  })

  it.each(ARQUIVOS_DO_M4_2)('%s não formata data no cliente (Lei 1)', (rel) => {
    const c = codigo(rel)
    if (!c.startsWith("'use client'")) return
    expect(c, rel).not.toMatch(/new Date\(|toLocaleString|DateTime\./)
  })

  it('nenhum título do M4-2 inventa tamanho (as duas réguas da casa)', () => {
    for (const rel of ARQUIVOS_DO_M4_2) {
      for (const tag of codigo(rel).match(/<h[1-3][^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/title-(page|section)/)
      }
    }
  })

  it('a página do detalhe não faz query inline — quem lê é a camada de dados', () => {
    const p = codigo('src/app/admin/contratos/[id]/page.tsx')
    expect(p).not.toContain('@/lib/supabase')
    expect(p).not.toMatch(/\.from\(/)
    expect(p).not.toMatch(/\.rpc\(/)
    expect(p).toContain('getContractFile')
    // mentoria não se gere aqui
    expect(p).toContain("redirect('/admin/mentoria')")
    // trilha de volta para a aba nova do hub, nunca para a tela velha
    expect(p).toContain('href="/admin/alunos/contratos"')
  })

  it('a camada de dados valida o retorno, não engole erro e resolve o fuso no servidor', () => {
    const d = corpo('src/data/admin/contrato-detalhe.ts')
    for (const leitura of [
      'o contrato',
      'as professoras',
      'os horários fixos',
      'as pausas',
      'o saldo de créditos',
      'as assinaturas',
      'as aulas sem desfecho',
      'os membros do grupo',
      'os contratos-destino',
    ]) {
      expect(d, leitura).toContain(`exigir('${leitura}'`)
    }
    for (const schema of [
      'ContratoDoDetalheSchema.parse',
      'SlotsDoDetalheSchema.parse',
      'PausasBrutasSchema.parse',
      'ResumosDeCreditoSchema.parse',
      'AssinaturasDoDetalheSchema.parse',
      'MembrosDoGrupoSchema.parse',
      'ContratosDestinoSchema.parse',
    ]) {
      expect(d, schema).toContain(schema)
    }
    // Lei 1 e Lei 9 resolvidas UMA vez, aqui
    expect(d).toContain('slotLine(s,')
    expect(d).toContain('fmtBRL(c.hourly_rate_cents)')
    // regra de negócio nenhuma: o saldo vem do banco
    expect(d).toContain("supabase.rpc('contract_credit_summary')")
    // e a porta da tela continua sendo `getContractFile`, em `contratos.ts`
    const c = corpo('src/data/admin/contratos.ts')
    expect(c.startsWith("import 'server-only'")).toBe(true)
    expect(c).toContain('export async function getContractFile(')
    expect(c).toContain('lerContratoDoDetalhe(supabase')
  })

  it('os oito painéis estão montados, com a MESMA action da tela velha', () => {
    const p = corpo('src/components/admin/contratos/paineis.tsx')
    for (const painel of PAINEIS_DO_CONTRATO) expect(p, painel).toContain(`'${painel}'`)
    // cada formulário aponta para a MESMA server action de sempre — a pausa é a
    // única com duas, porque pausar e retomar são o mesmo assunto em dois
    // estados do contrato
    for (const ligacao of [
      'action={updateContractRulesAction}',
      'action={renewContractAction}',
      'action={endContractAction}',
      'action={retomar ? resumeContractAction : pauseContractAction}',
      'action={adjustCreditAction}',
      'action={sendContractForSignatureAction}',
      'action={refreshSignatureStatusAction}',
      'action={createSlotAction}',
      'action={closeAndCreateSlotAction}',
    ]) {
      expect(p, ligacao).toContain(ligacao)
    }
    // nenhuma RPC nova, nenhuma regra reimplementada em TS
    expect(codigo('src/components/admin/contratos/paineis.tsx')).not.toMatch(/\.rpc\(|\.from\(/)
    // o painel devolve o recado ao DETALHE (é isso que o `back` faz)
    expect(p).toContain('<input type="hidden" name="back" value={self} />')
  })

  it('a UI ANTECIPA os gates do banco (Lei 3: antecipar, nunca reimplementar)', () => {
    const paineis = corpo('src/components/admin/contratos/paineis.tsx')
    // encerrar/renovar com aula pendente não viram formulário
    expect(paineis).toContain('contrato.pendencias > 0) redirect(self)')
    // renovar exige contrato ativo
    expect(paineis).toContain("contrato.situacao !== 'active'")
    // contrato encerrado não abre painel nenhum
    expect(paineis).toContain('if (contrato.encerrado) redirect(self)')
    // a virada tem as TRÊS pontas: o piso subiu para `max(hoje, started_on)`
    // no c12 · nº 10 (o banco ganhou a recusa da linhagem invertida)
    expect(paineis).toContain('min={contrato.viradaMinimaIso}')
    expect(paineis).toContain('max={contrato.viradaMaximaIso}')
    // o type-to-confirm continua exigindo o nome exato — e o ESPERADO deixou de
    // ser campo oculto do formulário (c12 · nº 9): quem o busca é a action, no
    // banco, porque dado de fora não pode ser os dois lados da comparação
    expect(paineis).toContain('name="confirm_name"')
    // no CÓDIGO, não no comentário — o comentário é justamente quem conta que o
    // campo morreu, e ele tem de continuar podendo dizer o nome do defunto
    expect(codigo('src/components/admin/contratos/paineis.tsx')).not.toContain('confirm_expected')
    // c13 · nº 5: o que a pessoa digitou vai INTEIRO para a RPC, e quem compara
    // é o banco (dentro da transação, contra a linha travada).
    expect(corpo('src/app/admin/contratos/actions.ts')).toContain(
      "p_confirm_name: String(formData.get('confirm_name') ?? ''),",
    )
    // a troca de horário ignora o horário que ela mesma vai fechar
    expect(paineis).toContain('contrato.ocupacao.filter((j) => j.slotId !== horario.id)')

    const secoes = corpo('src/components/admin/contratos/detalhe.tsx')
    // com pendência, as duas ações aparecem DESABILITADAS (e não somem)
    expect(secoes).toContain('const travado = contrato.pendencias > 0')
    // c12 · nº 6: a peça ganhou um segundo gate (o do fuso), e por isso passou a
    // dizer QUAL frase explica a trava — o `aria-describedby` deixou de ser fixo.
    expect(secoes).toContain('<AcaoTravada porque="gate-de-pendencia">Renovar</AcaoTravada>')
    expect(secoes).toContain('<AcaoTravada porque="gate-de-pendencia">Encerrar…</AcaoTravada>')
    // e o lápis some inteiro no contrato encerrado
    expect(secoes).toContain('const editavel = !contrato.encerrado')
  })

  /*
   * CADA SEÇÃO NA CAIXA DELA (portão visual do dono, 27/07/2026 — ordem direta,
   * olhando a bancada). As cinco seções moravam num `CardPanel` único separadas
   * por hairline; viraram cinco cartões-contêiner com respiro entre eles.
   *
   * O aceite trava as três coisas que podem regredir: a moldura é a de
   * CONTÊINER (`.panel-tb` via `CardPanel`) e nunca a de cartão CLICÁVEL
   * (`.card-kpi`, que prometeria um clique que a seção não tem); a hairline de
   * baixo saiu (dois separadores seriam um fio solto rente à borda); e a página
   * hospeda a pilha com respiro em vez do cartão único.
   */
  it('as cinco seções do detalhe são CAIXAS separadas, na moldura de contêiner', () => {
    const secoes = codigo('src/components/admin/contratos/detalhe.tsx')
    expect(secoes).toContain('<CardPanel>')
    expect(secoes).toContain('<Secao {...props} className="border-b-0" />')
    // a moldura de coisa clicável não entra aqui
    expect(secoes).not.toContain('card-kpi')
    // as cinco seções vestem a caixa — nenhuma ficou para trás
    expect((secoes.match(/<SecaoEmCaixa\b/g) ?? []).length).toBe(5)
    expect(secoes).not.toMatch(/<Secao\s+titulo=/)

    const pagina = codigo('src/app/admin/contratos/[id]/page.tsx')
    expect(pagina).toContain('<div className="flex flex-col gap-4">')
    // o cartão único que envolvia tudo morreu
    expect(pagina).not.toContain('<CardPanel>')
  })

  it('a linha da lista aponta para o DETALHE (o provisório do M4-1 morreu)', () => {
    const l = corpo('src/components/admin/alunos/ListaDeContratos.tsx')
    expect(l).toContain('enderecoDoContrato(c.id)')
    expect(l).not.toContain('/admin/contratos?q=')
    expect(codigo('src/components/admin/alunos/ListaDeContratos.tsx')).not.toContain('TODO (M4-2)')
  })

  it('o "Gerir em Contratos" da ficha do aluno abre o contrato certo', () => {
    const f = corpo('src/data/admin/ficha.ts')
    expect(f).toContain("gerirEm: base.tipo === 'mentorship' ? '/admin/mentoria' : `/admin/contratos/${base.id}`")
  })

  it('a comparação do type-to-confirm existe UMA vez — e agora ela é do BANCO', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    // c13 · nº 5: a action PASSA o que foi digitado e não compara nada. Se
    // alguém reintroduzir a comparação aqui, volta a existir a versão que perde
    // (a que decide sobre um nome lido fora da transação).
    expect(a, 'a régua não vive em duas versões').not.toContain('nomeConfirmado')
    expect(a, 'a régua não vive em duas versões').not.toMatch(/localeCompare\(/)
    expect(a).toContain('p_confirm_name')
    // e a peça que existia só para alimentá-la morreu junto
    expect(codigo('src/data/admin/contratos-gramatica.ts')).not.toContain('export function nomeConfirmado')
    expect(codigo('src/data/admin/contrato-detalhe.ts')).not.toContain('lerNomeDoContrato')
  })

  // ATUALIZADO NO M4-4: a segunda metade deste aceite ("a tela velha segue sem
  // mandar `back`") virou trivialmente verdadeira quando a tela velha morreu —
  // um `not.toContain` sobre um arquivo de 30 linhas de redirect não prova nada.
  // A INTENÇÃO era garantir que quem não manda `back` continua tendo um destino
  // válido; ela não afrouxou, mudou de guardião: o padrão `/admin/contratos`
  // segue no lugar E o mapa de encaminhamento (testado em `m4-redirects`)
  // garante que ele desemboca no índice novo COM o recado. É isso que a segunda
  // asserção passa a checar.
  it('quem não manda `back` cai no padrão — e o padrão é um endereço que ainda leva o recado', () => {
    const a = corpo('src/app/admin/contratos/actions.ts')
    // c12 · nº 8: a limpeza do destino virou UMA função com dois usos (`back` e
    // `back_erro`), mas a régua é a mesma — prefixo `/admin/` ou o padrão.
    expect(a).toContain("const limpar = (v: string, padrao: string) => (v.startsWith('/admin/') ? v : padrao)")
    expect(a).toContain("limpar(String(formData.get('back') ?? ''), '/admin/contratos')")
    // e a falha, quando o painel não diz para onde voltar, cai no MESMO destino
    // do sucesso — nenhum chamador antigo quebra
    expect(a).toContain("limpar(String(formData.get('back_erro') ?? ''), destino)")
    // e esse padrão não é um beco: o mapa do M4-4 o leva ao índice com `msg`
    expect(destinoDoLegado({ msg: 'Contrato encerrado — 2 aula(s) futura(s)', n: '7' })).toBe(
      '/admin/alunos/contratos?msg=Contrato+encerrado+%E2%80%94+2+aula%28s%29+futura%28s%29&n=7',
    )
  })
})

/* ========================================================================== */
/* 4. Render (o grep não prova que a peça desenha)                             */
/* ========================================================================== */

const BASE: FichaDoContrato = {
  id: 'c-1',
  tipo: 'private_1on1',
  quem: 'Elisa Faria',
  alunoId: 's-1',
  nivel: 'B1',
  plano: 'Aulas particulares',
  produto: 'Aulas particulares',
  experimental: false,
  situacao: 'active',
  situacaoRotulo: 'ativo',
  encerrado: false,
  professora: { id: 't-1', nome: 'Dona', idx: 0 },
  valorHora: 'R$ 150,00',
  valorHoraCampo: '150.00',
  mensalidade: null,
  mensalidadeCampo: '',
  politica: { remarcacoes: 4, avisoHoras: 24, validadeDias: 90, falhaDaEscolaDias: 180 },
  vigencia: { inicio: '01/07/2026', fim: null },
  renovacao: { de: null, para: null },
  pausas: [],
  pausado: false,
  grupo: null,
  fusoDoHorario: { iana: 'America/Cuiaba', rotulo: 'Cuiabá' },
  fusoConfirmado: true,
  horarios: [
    {
      id: 'sl-1',
      texto: 'terça · 20:30–21:15',
      professora: null,
      weekday: 2,
      hora: '20:30',
      duracao: 45,
      ianaTz: 'America/Cuiaba',
      fuso: 'Cuiabá',
      vigenteDe: '01/07/2026',
      encerradoEm: null,
    },
  ],
  horariosFechados: [],
  creditos: {
    saldo: 0,
    proximaValidade: null,
    validadeSugeridaIso: '2026-10-25',
    duracaoSugerida: 45,
    verEm: '/admin/alunos/s-1?aba=creditos',
  },
  assinaturas: [],
  pendencias: 0,
  destinos: [],
  ocupacao: [],
  hojeIso: '2026-07-27',
  viradaMaximaIso: '2026-09-21',
  // c12 · nº 10: o piso da virada é `max(hoje, started_on)` — aqui o contrato
  // já começou, então o piso É hoje.
  viradaMinimaIso: '2026-07-27',
}

/**
 * c16 · ADR-029 §1: as seções agora recebem o interruptor da assinatura. O
 * padrão aqui é LIGADO porque é ele que exercita a seção inteira; o modo
 * desligado tem provas próprias em `c16-correcoes-sol-6.test.ts`.
 */
const desenhar = (over: Partial<FichaDoContrato> = {}, assinaturaLigada = true) =>
  renderToStaticMarkup(
    h(SecoesDoContrato, { contrato: { ...BASE, ...over }, assinaturaLigada }),
  )

describe('as seções do detalhe desenham', () => {
  it('as cinco seções, com os lápis apontando para os painéis certos', () => {
    const html = desenhar()
    for (const titulo of [
      'Dados &amp; valores',
      'Vigência &amp; pausas',
      'Horários fixos',
      'Créditos',
      'Assinatura',
    ]) {
      expect(html, titulo).toContain(titulo)
    }
    expect(html).toContain('href="/admin/contratos/c-1?painel=regras"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=renovar"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=pausa"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=encerrar"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=credito"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=assinatura"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=horario-novo"')
    expect(html).toContain('href="/admin/contratos/c-1?painel=horario-trocar&amp;alvo=sl-1"')
    // os dados que a tela existe para responder
    expect(html).toContain('R$ 150,00')
    expect(html).toContain('terça · 20:30–21:15')
    expect(html).toContain('Ver créditos do aluno')
  })

  it('com aula pendente, encerrar e renovar aparecem TRAVADOS — com o número', () => {
    const html = desenhar({ pendencias: 2 })
    expect(html).toContain(fraseDaPendencia(2))
    expect(html).toContain('2 aulas passadas sem desfecho')
    expect(html).toMatch(/<button type="button" disabled[^>]*>Renovar<\/button>/)
    expect(html).toMatch(/<button type="button" disabled[^>]*>Encerrar…<\/button>/)
    // e nenhum dos dois painéis é oferecido como link
    expect(html).not.toContain('painel=encerrar')
    expect(html).not.toContain('painel=renovar')
  })

  it('singular e plural da pendência não saem no automático', () => {
    expect(fraseDaPendencia(1)).toContain('1 aula passada sem desfecho trava')
    expect(fraseDaPendencia(3)).toContain('3 aulas passadas sem desfecho travam')
  })

  it('contrato PAUSADO oferece retomar, e não pausar', () => {
    const html = desenhar({ situacao: 'paused', situacaoRotulo: 'pausado', pausado: true })
    expect(html).toContain('>Retomar<')
    expect(html).not.toContain('>Pausar<')
  })

  it('contrato ENCERRADO não mostra lápis nenhum', () => {
    const html = desenhar({
      situacao: 'ended',
      situacaoRotulo: 'encerrado',
      encerrado: true,
      creditos: { ...BASE.creditos, saldo: null },
      vigencia: { inicio: '01/07/2026', fim: '31/07/2026' },
    })
    expect(html).not.toContain('painel=')
    expect(html).toContain('31/07/2026')
  })

  it('o grupo mostra quem estuda e quem ancora o fuso', () => {
    const html = desenhar({
      quem: 'Casal Natália e Yago',
      alunoId: null,
      grupo: {
        label: 'Casal Natália e Yago',
        membros: [
          { id: 'a', nome: 'Natália', fuso: 'Cuiabá', ancora: false },
          { id: 'b', nome: 'Yago', fuso: 'Lisboa', ancora: true },
        ],
      },
      creditos: { ...BASE.creditos, verEm: null },
    })
    expect(html).toContain('Quem estuda neste contrato')
    expect(html).toContain('âncora de fuso do grupo')
    expect(html).toContain('href="/admin/alunos/b"')
    expect(html, 'grupo não tem ficha de aluno').not.toContain('Ver créditos do aluno')
  })

  it('sem horário fixo e sem assinatura, a seção DIZ isso em vez de ficar muda', () => {
    const html = desenhar({ horarios: [], assinaturas: [] })
    expect(html).toContain('Nenhum horário fixo vigente')
    expect(html).toContain('Nenhum documento enviado para assinatura')
  })

  it('horário encerrado aparece no histórico da seção', () => {
    const html = desenhar({
      horariosFechados: [{ ...BASE.horarios[0], id: 'sl-0', encerradoEm: '30/06/2026' }],
    })
    expect(html).toContain('Horários encerrados')
    expect(html).toContain('até 30/06/2026')
  })

  it('cidade não confirmada avisa antes de o banco recusar o horário', () => {
    const html = desenhar({ fusoConfirmado: false })
    expect(html).toContain('ainda é um palpite do cadastro')
  })
})
