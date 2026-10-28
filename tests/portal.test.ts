// Fase 2 / M3 — Portal do aluno: isolamento A×B com as QUERIES REAIS da página,
// casal (D3) vendo o mesmo contrato, e exibição DST-correta (Lei 1: Luxon só formata).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { fmtLocal } from '../src/lib/format'
import {
  cobrancaEmAbertoMaisAntiga,
  creditSummary,
  extratoDeCreditos,
  historicoDeAulas,
  payments,
  portalStudent,
  upcomingClasses,
} from '../src/lib/portal/data'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract, daysFromToday } from './helpers/db'
// `createPrivateContract` + `createAuthUser` + `clientAs` montam à mão o cenário
// do D5 (a conta teacher vinculada a um students) — `studentLogin` sempre assina
// o JWT com papel 'student', que é justamente o que o teste precisa NÃO fazer.

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

async function studentLogin(tz = 'America/Cuiaba') {
  const c = await createPrivateContract(sql, { tz })
  const userId = await createAuthUser(sql, 'student', 'Aluno portal')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  return { ...c, client: await clientAs(userId, 'student') }
}

describe('isolamento A×B nas queries reais do portal', () => {
  it('A não vê aulas, créditos nem pagamentos de B em NENHUMA superfície', async () => {
    const a = await studentLogin()
    const b = await studentLogin()
    const instB = await createInstance(sql, { contractId: b.contractId, teacherId: b.teacherId }, { startsInHours: 48 })
    await createInstance(sql, { contractId: b.contractId, teacherId: b.teacherId }, { startsInHours: -48 })
    await sql`select public.earn_makeup(${b.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`
      insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym)
      values (${'pay-' + crypto.randomUUID().slice(0, 8)}, ${b.contractId}, 15000, 'PENDING', current_date, to_char(current_date, 'YYYY-MM'))`

    const [aClasses, aHistory, aCredits, aPays, aStudent] = await Promise.all([
      upcomingClasses(a.client),
      historicoDeAulas(a.client),
      creditSummary(a.client),
      payments(a.client),
      portalStudent(a.client),
    ])
    // P3: leitura que DEU CERTO e não trouxe nada é `{ dado: [], erro: false }` —
    // o vazio do isolamento tem de ser distinguível de uma falha de leitura.
    expect([aClasses.erro, aCredits.erro, aPays.erro, aStudent.erro]).toEqual([false, false, false, false])
    expect(aClasses.dado.map((c) => c.id)).not.toContain(instB)
    expect(aClasses.dado).toHaveLength(0)
    // P4: o histórico virou `{ dado: { aulas, total }, erro }` — o isolamento
    // continua sendo o mesmo fato, agora com a leitura declarando que deu certo.
    expect(aHistory.erro).toBe(false)
    expect(aHistory.dado.aulas).toHaveLength(0)
    expect(aHistory.dado.total).toBe(0)
    const aCreditB = aCredits.dado.find((c) => c.contractId === b.contractId)
    expect(aCreditB).toBeUndefined()
    expect(aPays.dado).toHaveLength(0)
    // A asserção antiga (`expect(aStudent.dado?.displayName).not.toBe('')`)
    // PASSAVA com `dado: null` — `undefined` não é `''`. Agora o dado nulo
    // reprova, que era a intenção o tempo todo.
    expect(aStudent.dado).not.toBeNull()
    expect(aStudent.dado?.displayName ?? '').toMatch(/\S/)

    // B vê o dele (prova positiva).
    const [bClasses, bCredits, bPays] = await Promise.all([
      upcomingClasses(b.client),
      creditSummary(b.client),
      payments(b.client),
    ])
    expect(bClasses.dado.map((c) => c.id)).toContain(instB)
    expect(bCredits.dado.find((c) => c.contractId === b.contractId)?.balance).toBe(1)
    expect(bPays.dado).toHaveLength(1)
  })

  it('validade em destaque = menor expires_on vigente; crédito expirado não conta', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(60)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(20)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(-5)})`

    const credits = await creditSummary(s.client)
    const mine = credits.dado.find((c) => c.contractId === s.contractId)
    expect(mine?.balance).toBe(2)
    expect(mine?.nextExpiry).toBe(daysFromToday(20))
    expect(mine?.nextExpiryDays).toBe(20)
  })
})

/* -------------------------------------------------------------------------- */
/* As seis correções de DINHEIRO da revisão adversarial do P3                  */
/* -------------------------------------------------------------------------- */

describe('P3 · C1 — a validade anunciada é a do crédito que SOBROU', () => {
  it('gastei o crédito que vencia antes: o cartão anuncia a validade do outro', async () => {
    const s = await studentLogin()
    // A vence primeiro (10 dias), B depois (40). O FIFO gasta o A.
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(10)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(40)})`
    await sql`select public.spend_makeup(${s.contractId}, 'spend_reschedule')`

    const credits = await creditSummary(s.client)
    const mine = credits.dado.find((c) => c.contractId === s.contractId)
    expect(mine?.balance).toBe(1)
    // O defeito: a validade vinha das linhas +1 CRUAS do ledger, então o cartão
    // seguia anunciando o dia do crédito JÁ GASTO — e o aluno corria contra uma
    // data que não existia mais.
    expect(mine?.nextExpiry).toBe(daysFromToday(40))
    expect(mine?.nextExpiryDays).toBe(40)
  })

  it('sobrou só crédito SEM PRAZO: nenhuma data é anunciada', async () => {
    const s = await studentLogin()
    await sql`insert into makeup_ledger (contract_id, delta, reason) values (${s.contractId}, 1, 'manual_adjust')`
    const credits = await creditSummary(s.client)
    const mine = credits.dado.find((c) => c.contractId === s.contractId)
    expect(mine?.balance).toBe(1)
    expect(mine?.nextExpiry).toBeNull()
    expect(mine?.nextExpiryDays).toBeNull()
  })
})

describe('P3 · C2 — contrato PAUSADO: a validade fica congelada', () => {
  it('crédito de contrato pausado não é usável nem vencido — é congelado', async () => {
    const s = await studentLogin()
    // Vivo no início da pausa (a retomada o estende — F3-D10.2) …
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(5)})`
    // … e um que já tinha vencido ANTES dela (a retomada não devolve esse).
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(-20)})`
    await sql`update contracts set status = 'paused' where id = ${s.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${s.contractId}, ${daysFromToday(-10)})`

    const { dado, erro } = await extratoDeCreditos(s.client)
    expect(erro).toBe(false)
    const meus = (l: typeof dado.vivos) => l.filter((c) => c.contractId === s.contractId)
    // O defeito: com `.neq('status','ended')` o crédito de +5 dias caía em "Para
    // usar" (botão que /portal/resgatar recusa) e, cinco dias depois, em
    // "Venceram" — dando por perdido o que o banco vai devolver.
    expect(meus(dado.congelados).map((c) => c.validade)).toEqual([daysFromToday(5)])
    expect(meus(dado.vivos)).toHaveLength(0)
    expect(meus(dado.vencidos).map((c) => c.validade)).toEqual([daysFromToday(-20)])
    expect(meus(dado.congelados)[0].contratoStatus).toBe('paused')
  })

  // ⚠️ ESTE CASO FOI INVERTIDO EM 30/07/2026 (A6 · lote 3), por DECISÃO
  // COMERCIAL DO DONO: a validade do crédito de reposição CONGELA durante a
  // pausa, sem exceção.
  //
  // O que ele afirmava até 29/07 — "crédito concedido DURANTE a pausa não é
  // congelado, vence quando vence" — era a leitura HONESTA de um banco com
  // furo: `resume_contract` reemitia só o crédito criado antes da pausa
  // (`ml.created_at < v_pause.created_at`), e congelar na tela teria sido
  // prometer extensão que a retomada não faria (D1 da revisão adversarial 2 do
  // P3). O teste protegia a tela de mentir.
  //
  // A migration 20260730000300 apagou o filtro e passou a estender TODO crédito
  // parado — o nascido na pausa pelos dias desde a concessão. A promessa virou
  // verdade, e o predicado `congelado` de `student_credit_statement` /
  // `student_credit_totals` perdeu a condição `rcriado < pausa_criada_em`.
  // Agora é o comportamento ANTIGO que seria a mentira: mandar para "Para usar"
  // um crédito que o /portal/resgatar recusa, com uma contagem que não corre.
  it('crédito concedido DURANTE a pausa TAMBÉM é congelado (invertido em 30/07 · A6)', async () => {
    const s = await studentLogin()
    await sql`update contracts set status = 'paused' where id = ${s.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${s.contractId}, ${daysFromToday(-10)})`
    // A escola dá um crédito com o contrato JÁ pausado (caso real: o aluno
    // parou, e a dona compensa uma aula que ficou devendo de antes).
    await sql`select public.earn_makeup(${s.contractId}, 'manual_adjust', ${daysFromToday(20)})`

    const { dado, erro } = await extratoDeCreditos(s.client)
    expect(erro).toBe(false)
    const meus = (l: typeof dado.vivos) => l.filter((c) => c.contractId === s.contractId)
    expect(meus(dado.vivos)).toHaveLength(0)
    expect(meus(dado.vencidos)).toHaveLength(0)
    // A validade continua sendo a REAL (a tela mostra "valia até …, contagem
    // parada"); o que mudou é o balde, não o número.
    expect(meus(dado.congelados).map((c) => [c.validade, c.diasRestantes])).toEqual([
      [daysFromToday(20), 20],
    ])
    expect(meus(dado.congelados)[0].contratoStatus).toBe('paused')
  })

  // O AGREGADO CONTA A MESMA HISTÓRIA (a razão de `student_credit_totals`
  // existir separada da statement: as duas telas não podem divergir sobre o
  // mesmo crédito). Aqui a RPC é chamada direto porque `creditSummary` só
  // pergunta por contrato ATIVO — o pausado nem chega à tela do Início.
  it('o crédito nascido na pausa sai do SALDO agregado junto com os outros congelados', async () => {
    const s = await studentLogin()
    await sql`update contracts set status = 'paused' where id = ${s.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${s.contractId}, ${daysFromToday(-10)})`
    await sql`select public.earn_makeup(${s.contractId}, 'manual_adjust', ${daysFromToday(20)})`

    const { data, error } = await s.client.rpc('student_credit_totals')
    expect(error).toBeNull()
    const linhas = (data ?? []) as { contract_id: string; saldo: number; proxima_validade: string | null }[]
    const mine = linhas.find((l) => l.contract_id === s.contractId)
    expect(mine).toBeDefined()
    expect(mine?.saldo).toBe(0)
    expect(mine?.proxima_validade).toBeNull()
  })

  // Sol P3 r3, achado 1: contrato 'paused' SEM linha de pausa aberta é estado
  // anômalo que `resume_contract` RECUSA — congelar aqui prometeria extensão
  // que a retomada nunca fará. A régua normal vale (vence quando vence).
  it('pausado SEM pausa aberta (estado anômalo) não congela nada', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(5)})`
    await sql`update contracts set status = 'paused' where id = ${s.contractId}`
    // NENHUM insert em contract_pauses: o estado que resume_contract aborta.

    const { dado, erro } = await extratoDeCreditos(s.client)
    expect(erro).toBe(false)
    const meus = (l: typeof dado.vivos) => l.filter((c) => c.contractId === s.contractId)
    expect(meus(dado.congelados)).toHaveLength(0)
    expect(meus(dado.vivos).map((c) => c.validade)).toEqual([daysFromToday(5)])
  })

  it('o cartão do Início ignora contrato pausado (a rota de resgate o recusa)', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`update contracts set status = 'paused' where id = ${s.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${s.contractId}, ${daysFromToday(-1)})`

    const credits = await creditSummary(s.client)
    expect(credits.erro).toBe(false)
    expect(credits.dado.find((c) => c.contractId === s.contractId)).toBeUndefined()
  })
})

describe('P3 · C3 — quem decide o dia civil é o banco (business_today)', () => {
  /**
   * O "hoje" e o "ontem" do NEGÓCIO, lidos do BANCO numa consulta só.
   *
   * D6 da revisão adversarial 2: a versão anterior montava as expectativas com
   * `daysFromToday`, que é o relógio da MÁQUINA DE TESTE. Duas consequências
   * ruins: o teste podia discordar do banco na virada do dia, e — pior — só via
   * a regressão quando a máquina, o banco e o fuso do aluno já discordavam
   * entre si. Agora a data que cria o crédito e a data que o teste afirma são a
   * MESMA data, e ela vem de `business_today()`.
   */
  async function diasDoNegocio(): Promise<{ hoje: string; ontem: string }> {
    const [r] = await sql<{ hoje: string; ontem: string }[]>`
      select public.business_today()::text as hoje,
             (public.business_today() - 1)::text as ontem`
    return { hoje: r.hoje, ontem: r.ontem }
  }

  // OS DOIS LADOS DO NEGÓCIO, e é isso que faz o teste valer a QUALQUER HORA.
  // Cuiabá é UTC−4 o ano inteiro. Kiritimati (UTC+14) está 18h À FRENTE: o dia
  // civil dele só difere do do negócio das 06:00 às 23:59 de Cuiabá. Midway
  // (UTC−11) está 7h ATRÁS: difere das 00:00 às 06:59. Um sozinho deixa uma
  // janela do dia em que a regressão (decidir o dia civil no fuso de quem olha)
  // passa despercebida — a versão anterior deste teste era verde das 00:00 às
  // 05:59 mesmo com o bug. Os dois juntos cobrem as 24 horas.
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway']) {
    it(`vivo/vencido e dias restantes não dependem do fuso de quem olha (${tz})`, async () => {
      const s = await studentLogin(tz)
      const { hoje, ontem } = await diasDoNegocio()
      await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${hoje})`
      await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${ontem})`

      const { dado } = await extratoDeCreditos(s.client)
      const vivos = dado.vivos.filter((c) => c.contractId === s.contractId)
      const vencidos = dado.vencidos.filter((c) => c.contractId === s.contractId)
      expect(vivos.map((c) => [c.validade, c.diasRestantes])).toEqual([[hoje, 0]])
      expect(vencidos.map((c) => [c.validade, c.diasRestantes])).toEqual([[ontem, -1]])
      // …e o saldo do banco concorda com o que a tela vai mostrar.
      const [{ saldo }] = await sql`select public.makeup_balance(${s.contractId}) as saldo`
      expect(vivos).toHaveLength(Number(saldo))
      // …e o agregado que alimenta o cartão do Início conta o MESMO (D2).
      const totais = await creditSummary(s.client)
      const meu = totais.dado.find((c) => c.contractId === s.contractId)
      expect([meu?.balance, meu?.nextExpiry, meu?.nextExpiryDays]).toEqual([1, hoje, 0])
    })
  }
})

describe('P3 · D5 — SECURITY DEFINER sem papel é porta aberta', () => {
  it('conta com papel teacher não recebe o extrato, nem vinculada a um aluno', async () => {
    // O cenário do achado: a professora que TAMBÉM faz aula na escola. O
    // `students.profile_id` dela aponta para a mesma conta que entra como
    // teacher — então `my_contract_ids()` (auth.uid()) devolve o contrato, e a
    // função DEFINER, que existe só para o portal do aluno, entregaria o
    // extrato pelo caminho do painel da professora.
    const c = await createPrivateContract(sql)
    // O número vem explícito: quem tem acesso de ALUNO tem número (A6/i), e esta
    // conta é justamente a que ocupa as duas cadeiras.
    const userId = await createAuthUser(sql, 'teacher', 'Professora que também é aluna', {
      whatsapp: '+5565900020032',
    })
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const client = await clientAs(userId, 'teacher')

    const extrato = await extratoDeCreditos(client)
    expect(extrato.erro).toBe(true)
    expect(extrato.dado.vivos).toHaveLength(0)
    // …e o agregado do cartão do Início fecha a mesma porta (D2 + D5).
    expect((await creditSummary(client)).erro).toBe(true)
  })

  it('o aluno continua recebendo o dele (o porteiro filtra papel, não pessoa)', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const extrato = await extratoDeCreditos(s.client)
    expect(extrato.erro).toBe(false)
    expect(extrato.dado.vivos.filter((x) => x.contractId === s.contractId)).toHaveLength(1)
  })
})

describe('P3 · D2 — o teto do PostgREST não pode virar saldo falso', () => {
  it('extrato NO teto de linhas é tratado como falha; o SALDO vem do agregado', async () => {
    const s = await studentLogin()
    // `max_rows = 1000` (supabase/config.toml:16). Mil créditos vivos é o
    // cenário absurdo que produz o defeito real: o PostgREST corta a resposta e
    // devolve 200, então "1000" é indistinguível de "1000 e mais alguns".
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on)
      select ${s.contractId}, ${s.studentId}, 1, 'initial_backlog', ${daysFromToday(30)}::date
        from generate_series(1, 1000)`

    // Camada (b): o extrato prefere o aviso de falha a um extrato pela metade.
    const extrato = await extratoDeCreditos(s.client)
    expect(extrato.erro).toBe(true)
    expect(extrato.dado.vivos).toHaveLength(0)

    // Camada (a): o cartão do Início NÃO passa por essa leitura — o saldo é um
    // agregado SQL, uma linha por contrato, e conta os mil.
    const credits = await creditSummary(s.client)
    expect(credits.erro).toBe(false)
    const meu = credits.dado.find((c) => c.contractId === s.contractId)
    expect(meu?.balance).toBe(1000)
    expect(meu?.nextExpiry).toBe(daysFromToday(30))
    // …e o banco concorda com o número que o aluno lê.
    const [{ saldo }] = await sql`select public.makeup_balance(${s.contractId}) as saldo`
    expect(Number(saldo)).toBe(1000)
  })
})

describe('P3 · D7 — o parâmetro da memória tem teto', () => {
  it('memória absurda não estoura o tipo date — a função responde', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(-5)})`
    // Sem o clamp, `business_today() - 1000000000` estoura `date` e a leitura
    // inteira morre com "date out of range" — o aluno vê o aviso de falha por
    // causa de um número numa query string.
    const extrato = await extratoDeCreditos(s.client, { memoriaDias: 1_000_000_000 })
    expect(extrato.erro).toBe(false)
    expect(extrato.dado.vencidos.filter((x) => x.contractId === s.contractId)).toHaveLength(1)
  })
})

describe('P3 · C4 — cobrabilidade é regra do banco, não lista de status em TS', () => {
  async function cobranca(contractId: string, status: string, dueDate: string) {
    await sql`
      insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym)
      values (${'pay-' + crypto.randomUUID().slice(0, 8)}, ${contractId}, 15000, ${status},
              ${dueDate}, ${dueDate.slice(0, 7)})`
  }

  it('estornada, com chargeback ou cancelada NÃO vira "mensalidade em atraso"', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'REFUNDED', daysFromToday(-30))
    await cobranca(s.contractId, 'CHARGEBACK_REQUESTED', daysFromToday(-20))
    await cobranca(s.contractId, 'PAYMENT_DELETED', daysFromToday(-15))

    const aviso = await cobrancaEmAbertoMaisAntiga(s.client)
    expect(aviso.erro).toBe(false)
    // O defeito: "em aberto" era tudo que não fosse received/confirmed/
    // received_in_cash — e o aluno via cobrança de dinheiro DEVOLVIDO como
    // dívida em atraso.
    expect(aviso.dado).toBeNull()

    const lista = await payments(s.client)
    expect(lista.dado.every((p) => !p.emAberto && !p.emAtraso)).toBe(true)
  })

  it('cobrança pendente e vencida continua sendo atraso', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'OVERDUE', daysFromToday(-3))
    const aviso = await cobrancaEmAbertoMaisAntiga(s.client)
    expect(aviso.dado?.emAberto).toBe(true)
    expect(aviso.dado?.emAtraso).toBe(true)
    expect(aviso.dado?.dueDate).toBe(daysFromToday(-3))
  })

  it('cobrança em aberto que ainda não venceu não é atraso', async () => {
    const s = await studentLogin()
    await cobranca(s.contractId, 'PENDING', daysFromToday(4))
    const aviso = await cobrancaEmAbertoMaisAntiga(s.client)
    expect(aviso.dado?.emAberto).toBe(true)
    expect(aviso.dado?.emAtraso).toBe(false)
  })
})

describe('P3 · C5 — a pendência do Início não depende da página de pagamentos', () => {
  it('mensalidade esquecida FORA do corte de 12 linhas ainda acende o cartão', async () => {
    const s = await studentLogin()
    // A esquecida, lá atrás …
    await sql`
      insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym)
      values (${'pay-old-' + crypto.randomUUID().slice(0, 8)}, ${s.contractId}, 15000, 'OVERDUE',
              ${daysFromToday(-400)}, ${daysFromToday(-400).slice(0, 7)})`
    // … e 12 cobranças PAGAS mais recentes, que ocupavam a janela inteira.
    for (let i = 1; i <= 12; i++) {
      await sql`
        insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym, paid_at)
        values (${'pay-ok-' + crypto.randomUUID().slice(0, 8)}, ${s.contractId}, 15000, 'RECEIVED',
                ${daysFromToday(-i)}, ${daysFromToday(-i).slice(0, 7)}, now())`
    }

    const lista = await payments(s.client)
    expect(lista.dado).toHaveLength(12)
    expect(lista.dado.some((p) => p.dueDate === daysFromToday(-400))).toBe(false)

    // O defeito: a pendência era procurada DEPOIS do corte — o Início ficava
    // calado sobre a única cobrança que precisava de ação.
    const aviso = await cobrancaEmAbertoMaisAntiga(s.client)
    expect(aviso.dado?.dueDate).toBe(daysFromToday(-400))
    expect(aviso.dado?.emAtraso).toBe(true)
  })
})

describe('P3 · C6 — leitura que falhou não publica número', () => {
  it('sem poder ler os créditos, o resumo vem VAZIO (só o aviso sobra na tela)', async () => {
    // `student_credit_statement` é revogada de anon: a leitura falha de verdade,
    // pela fronteira real (PostgREST), sem stub.
    const credits = await creditSummary(anonClient())
    expect(credits.erro).toBe(true)
    // O defeito: um contrato lido e outro falhando publicavam "1 reposição"
    // JUNTO do aviso — um número que o aluno lê como o saldo dele.
    expect(credits.dado).toEqual([])
    const extrato = await extratoDeCreditos(anonClient())
    expect(extrato.erro).toBe(true)
    expect(extrato.dado).toEqual({ vivos: [], congelados: [], vencidos: [] })
  })
})

describe('casal (D3): os dois membros veem o MESMO contrato', () => {
  it('aula e saldo do contrato do grupo aparecem para ambos', async () => {
    const [n] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Natália P', 'America/Cuiaba', true) returning id`
    const [y] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Yago P', 'America/Cuiaba', true) returning id`
    const [g] = await sql`insert into student_groups (label) values ('Casal portal') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${n.id}), (${g.id}, ${y.id})`
    const [t] = await sql`insert into teachers (hourly_rate_cents, display_name) values (10000, 'Prof P') returning id`
    const [c] = await sql`
      insert into contracts (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
                             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${t.id}, 'casal portal', 15000, 2, 24, 90, current_date)
      returning id`
    const inst = await createInstance(sql, { contractId: c.id, teacherId: t.id }, { startsInHours: 72 })
    await sql`select public.earn_makeup(${c.id}, 'initial_backlog', ${daysFromToday(40)})`

    for (const name of ['Natália P', 'Yago P']) {
      const userId = await createAuthUser(sql, 'student', name)
      const sid = name.startsWith('Natália') ? n.id : y.id
      await sql`update students set profile_id = ${userId} where id = ${sid}`
      const client = await clientAs(userId, 'student')
      const [classes, credits] = await Promise.all([upcomingClasses(client), creditSummary(client)])
      expect(classes.dado.map((x) => x.id)).toContain(inst)
      expect(credits.dado.find((x) => x.contractId === c.id)?.balance).toBe(1)
    }
  })
})

describe('P3 — a aula que já começou e o link da sala', () => {
  it('aula EM CURSO continua na lista (o botão de entrar vale até o fim)', async () => {
    const s = await studentLogin()
    await sql`update teachers set fallback_meet_url = 'https://meet.example/sala-fixa' where id = ${s.teacherId}`
    const [emCurso] = await sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${s.contractId}, ${s.teacherId}, now() - interval '10 minutes', now() + interval '35 minutes', 'fixture P3')
      returning id`
    const [acabada] = await sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${s.contractId}, ${s.teacherId}, now() - interval '3 hours', now() - interval '2 hours', 'fixture P3')
      returning id`

    const leitura = await upcomingClasses(s.client)
    expect(leitura.erro).toBe(false)
    const ids = leitura.dado.map((c) => c.id)
    // O corte antigo era pelo COMEÇO: às 20h01 a aula das 20h sumia do portal.
    expect(ids).toContain(emCurso.id)
    expect(ids).not.toContain(acabada.id)
    // Sem link por aula (F11 ainda não sobe), vale o fixo da professora.
    expect(leitura.dado.find((c) => c.id === emCurso.id)?.meetUrl).toBe('https://meet.example/sala-fixa')
  })
})

describe('P3 — extrato de créditos em linguagem de gente', () => {
  it('separa o que vale, o que venceu há pouco e o que já saiu da memória', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(20)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(-5)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(-90)})`
    // Ajuste manual SEM prazo: o replay carimba 'infinity', que não pode chegar
    // à tela — vira "sem prazo para usar".
    await sql`insert into makeup_ledger (contract_id, delta, reason) values (${s.contractId}, 1, 'manual_adjust')`
    // …e um ajuste de +2 é DOIS créditos para o aluno, não uma linha.
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on)
      values (${s.contractId}, 2, 'manual_adjust', ${daysFromToday(40)})`

    const { dado, erro } = await extratoDeCreditos(s.client)
    expect(erro).toBe(false)
    const meus = dado.vivos.filter((c) => c.contractId === s.contractId)
    // 1 (20 dias) + 2 (40 dias) + 1 (sem prazo), nessa ordem — sem prazo por último.
    expect(meus.map((c) => c.validade)).toEqual([
      daysFromToday(20),
      daysFromToday(40),
      daysFromToday(40),
      null,
    ])
    expect(meus.every((c) => c.motivo !== '')).toBe(true)
    // Vencido recente aparece; o de 90 dias atrás já não interessa a ninguém.
    expect(dado.vencidos.filter((c) => c.contractId === s.contractId).map((c) => c.validade)).toEqual([
      daysFromToday(-5),
    ])
  })

  it('crédito GASTO some do extrato (o replay do FIFO é quem decide)', async () => {
    const s = await studentLogin()
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const antes = await extratoDeCreditos(s.client)
    expect(antes.dado.vivos.filter((c) => c.contractId === s.contractId)).toHaveLength(1)

    await sql`select public.spend_makeup(${s.contractId}, 'spend_reschedule')`
    const depois = await extratoDeCreditos(s.client)
    expect(depois.dado.vivos.filter((c) => c.contractId === s.contractId)).toHaveLength(0)
    expect(depois.dado.vencidos.filter((c) => c.contractId === s.contractId)).toHaveLength(0)
  })

  it('o extrato do aluno A não enxerga crédito do aluno B', async () => {
    const a = await studentLogin()
    const b = await studentLogin()
    await sql`select public.earn_makeup(${b.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const { dado } = await extratoDeCreditos(a.client)
    expect(dado.vivos.map((c) => c.contractId)).not.toContain(b.contractId)
  })
})

describe('exibição DST-correta (Lei 1: instante fixo, formatação por zona)', () => {
  it('Nova York: mesmo horário civil dos dois lados da virada de novembro/2026', () => {
    // Slot 11:00 em NY: antes da virada (EDT, UTC-4) = 15:00Z; depois (EST, UTC-5) = 16:00Z.
    expect(fmtLocal('2026-10-30T15:00:00Z', 'America/New_York')).toContain('às 11:00')
    expect(fmtLocal('2026-11-06T16:00:00Z', 'America/New_York')).toContain('às 11:00')
    // E o MESMO instante UTC muda de hora civil ao cruzar a virada — como deve ser.
    expect(fmtLocal('2026-11-06T15:00:00Z', 'America/New_York')).toContain('às 10:00')
  })

  it('Lisboa: fim do DST em 25/10/2026', () => {
    expect(fmtLocal('2026-10-20T19:00:00Z', 'Europe/Lisbon')).toContain('às 20:00') // BST
    expect(fmtLocal('2026-10-27T20:00:00Z', 'Europe/Lisbon')).toContain('às 20:00') // WET
  })

  it('Cuiabá (sem DST): sempre UTC−4', () => {
    expect(fmtLocal('2026-07-15T22:00:00Z', 'America/Cuiaba')).toContain('às 18:00')
    expect(fmtLocal('2026-12-15T22:00:00Z', 'America/Cuiaba')).toContain('às 18:00')
  })
})
