import postgres, { type Sql } from 'postgres'
import { DateTime } from 'luxon'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Conexão Postgres direta (bypassa PostgREST; roda como owner das tabelas). */
export function connect(max = 1): Sql {
  return postgres(DATABASE_URL, { max, onnotice: () => {} })
}

/** Data civil do NEGÓCIO (Cuiabá — public.business_tz) deslocada. Era UTC e
 *  quebrava a suíte na janela noturna: das 20h às 24h de Cuiabá o dia UTC já
 *  virou, e "hoje" gerado em UTC cai no FUTURO do banco (flake 18/07 23h —
 *  f9 só-futuro e f4 encerramento). */
export function daysFromToday(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/**
 * O INSTANTE (ISO UTC) de uma hora civil `data`+`hora` numa zona IANA.
 *
 * Nasceu no A6, quando as RPCs da agenda (`admin_create_single_class`,
 * `admin_create_trial_class`, `publish_reschedule_window`) deixaram de receber
 * `p_local_date` + `p_local_time` e passaram a receber `p_starts_at_utc`: a
 * conversão civil→instante acontece UMA vez, em quem fala com a dona, e o teste
 * precisa fazer a mesma conta que a action faz.
 *
 * Lei 1: offset DAQUELE dia, lido da base IANA pelo Luxon — nunca `-04:00`
 * cravado (o `utcOf` local de `f5-disponibilidade` faz isso e só continua certo
 * porque Cuiabá não tem horário de verão). Atenção ao limite (prova do Lote 1):
 * o Luxon NÃO estoura hora inexistente/ambígua — ele ajusta/escolhe um offset em
 * silêncio; só zona inválida estoura aqui. Quem recusa hora civil que não existe
 * é `conferirHoraCivil`, na action — teste que precise dessa guarda usa ela.
 */
export function instanteEm(data: string, hora: string, tz = 'America/Cuiaba'): string {
  const dt = DateTime.fromISO(`${data}T${hora}`, { zone: tz })
  if (!dt.isValid) {
    throw new Error(`hora civil inválida em ${tz}: ${data} ${hora} (${dt.invalidReason})`)
  }
  return dt.toUTC().toISO()!
}

/**
 * Data N meses atrás com folga de 3 dias — evita cair exatamente na fronteira de
 * mês (o fuso do negócio pode estar 1 dia atrás do UTC).
 */
export function monthsAgo(months: number): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - months)
  d.setUTCDate(d.getUTCDate() - 3)
  return d.toISOString().slice(0, 10)
}

/* `tz_confirmed` EXPLÍCITO desde o c11 · U1: o default da coluna passou a ser
   `false` (a resposta segura para quem esquecer de dizer), e o aluno de fixture
   representa a ficha NORMAL — a que já tem cidade conferida e portanto aceita
   contrato e horário fixo. Quem quiser o outro estado (o cadastro que nasceu
   palpite) grava `false` no próprio teste; quem quiser o ATO de confirmação
   auditado chama `confirm_student_location`. Fixture escrita como dona da
   tabela não é porta produtiva — as portas produtivas estão enumeradas e
   exercitadas em `m3-c11-veredito.test.ts`. */
export async function createStudent(sql: Sql, tz = 'America/Cuiaba'): Promise<string> {
  const [row] = await sql`
    insert into students (display_name, iana_tz, tz_confirmed)
    values (${'Aluno ' + crypto.randomUUID().slice(0, 8)}, ${tz}, true)
    returning id`
  return row.id as string
}

export async function createTeacher(sql: Sql): Promise<string> {
  const [row] = await sql`
    insert into teachers (hourly_rate_cents) values (10000) returning id`
  return row.id as string
}

export interface PrivateContract {
  contractId: string
  studentId: string
  teacherId: string
}

/* `started_on` usa `public.business_today()`, NÃO `current_date` (achado da
   madrugada de 27/07, durante o M3-2). O banco de teste roda em UTC e a data
   civil do NEGÓCIO é a de Cuiabá: das 20h à meia-noite de Cuiabá o `current_date`
   já é o dia SEGUINTE do negócio. Um contrato nascido nesse futuro deixou de
   contar como entrada do mês quando a retroativa nº 2 (B4) pôs o corte
   `started_on <= business_today()` na `admin_kpis` — e o teste "contrato novo é
   entrada do mês" ficava vermelho todas as noites, nessa janela de 4 horas. É a
   mesma armadilha que `daysFromToday` já documenta logo acima. */

export async function createPrivateContract(
  sql: Sql,
  /**
   * `studentId` (c15 · Sol 6): o cenário "dois contratos ATIVOS do MESMO aluno"
   * era montado com `update contracts set student_id = …` depois de criar dois
   * contratos independentes. Desde o gatilho `contracts_vinculo_imutavel`
   * (migration 20260727001500) esse caminho não existe mais para NINGUÉM — nem
   * para o dono da tabela —, porque trocar o dono de um contrato deixa aulas,
   * créditos e assinaturas pendurados em quem não é mais o dono. O cenário
   * continua legítimo (a escola tem aluno com particular + reforço); o que muda
   * é que ele nasce certo, em vez de nascer torto e ser corrigido.
   */
  opts: {
    allowance?: number
    minNotice?: number
    tz?: string
    studentId?: string
    teacherId?: string
  } = {},
): Promise<PrivateContract> {
  const studentId = opts.studentId ?? (await createStudent(sql, opts.tz))
  const teacherId = opts.teacherId ?? (await createTeacher(sql))
  const [row] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values
      ('private_1on1', ${studentId}, ${teacherId}, 'teste', 15000,
       ${opts.allowance ?? 4}, ${opts.minNotice ?? 24}, 90, public.business_today())
    returning id`
  return { contractId: row.id as string, studentId, teacherId }
}

export async function createInstance(
  sql: Sql,
  c: { contractId: string; teacherId: string },
  opts: { startsInHours?: number; durationMin?: number } = {},
): Promise<string> {
  const hours = opts.startsInHours ?? 48
  const dur = opts.durationMin ?? 45
  const [row] = await sql`
    insert into class_instances
      (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
    values
      (${c.contractId}, ${c.teacherId},
       now() + make_interval(hours => ${hours}),
       now() + make_interval(hours => ${hours}, mins => ${dur}),
       'fixture de teste')
    returning id`
  return row.id as string
}

export async function createSlot(
  sql: Sql,
  c: { contractId: string; teacherId: string },
  opts: { weekday: number; localTime: string; tz: string; durationMin?: number; activeFrom?: string },
): Promise<string> {
  const [row] = await sql`
    insert into recurring_slots
      (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
    values
      (${c.contractId}, ${c.teacherId}, ${opts.weekday}, ${opts.localTime}, ${opts.tz},
       ${opts.durationMin ?? 45}, ${opts.activeFrom ?? '2026-01-01'})
    returning id`
  return row.id as string
}

export interface MentorshipContract {
  contractId: string
  studentId: string
}

export async function createMentorshipContract(
  sql: Sql,
  opts: {
    /** null = curso nunca acessado */
    courseStartMonthsAgo?: number | null
    /** thresholds por etapa; valor null = etapa registrada sem percentual */
    thresholds?: Record<number, number | null>
    completionPct?: number
    /** fuso IANA do aluno (default America/Cuiaba) */
    tz?: string
  } = {},
): Promise<MentorshipContract> {
  const studentId = await createStudent(sql, opts.tz)
  const courseStart =
    opts.courseStartMonthsAgo == null ? null : monthsAgo(opts.courseStartMonthsAgo)
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
    values ('mentorship', ${studentId}, 'Personal Travel', 7000, current_date)
    returning id`
  const contractId = c.id as string
  await sql`
    insert into mentorship_contracts (contract_id, course_start_date)
    values (${contractId}, ${courseStart})`
  // F10/M6-1: contratos novos são SEMEADOS pelos defaults (trigger). Quando a
  // fixture declara thresholds (mesmo {}), a régua vira EXATAMENTE o declarado
  // — determinístico contra defaults globais de testes paralelos.
  if (opts.thresholds !== undefined) {
    await sql`delete from mentorship_window_rules where contract_id = ${contractId}`
    for (const [idx, pct] of Object.entries(opts.thresholds)) {
      await sql`
        insert into mentorship_window_rules (contract_id, window_index, threshold_pct)
        values (${contractId}, ${Number(idx)}, ${pct})`
    }
  }
  if (opts.completionPct != null) {
    await sql`
      insert into course_progress (contract_id, student_id, completion_pct)
      values (${contractId}, ${studentId}, ${opts.completionPct})`
  }
  return { contractId, studentId }
}

/**
 * Higiene do banco compartilhado (a suíte roda sem reset) para quem lê
 * admin_mentorship_overview. A RPC devolve TODOS os contratos de mentoria não
 * encerrados ordenados por nome do aluno — e o nome das fixtures é aleatório
 * ('Aluno ' + uuid). O PostgREST corta a resposta em PGRST_DB_MAX_ROWS (=1000 no
 * supabase local), então, com as 2,3 mil fixtures acumuladas de execuções
 * anteriores (21/07), um contrato recém-criado caía FORA da janela em ~58% das
 * rodadas: o .find(...) devolvia undefined e o caso ficava vermelho por sorteio.
 *
 * DELETE é proibido (Lei 8) — a varredura usa a transição legítima para 'ended',
 * que é exatamente o filtro da RPC (e o trigger contracts_audit registra). O
 * seed não cria mentoria: todo contrato alcançado aqui é fixture de teste. O
 * corte de 1h (ancorado em students.created_at, pois contracts não tem
 * timestamp) nunca alcança fixture da execução corrente nem dos arquivos que
 * rodam em paralelo.
 */
export async function sweepStaleMentorshipFixtures(sql: Sql): Promise<void> {
  await sql`
    update contracts c
       set status = 'ended'
      from students s
     where s.id = c.student_id
       and c.contract_type = 'mentorship'
       and c.status <> 'ended'
       and s.created_at < now() - interval '1 hour'`
}

export async function createSession(
  sql: Sql,
  opts: { capacity?: number; bookedCount?: number; status?: string; inDays?: number } = {},
): Promise<string> {
  const [row] = await sql`
    insert into mentorship_sessions
      (scheduled_at, local_time_snapshot, capacity, booked_count, status)
    values
      (now() + make_interval(days => ${opts.inDays ?? 14}),
       'fixture de teste America/Cuiaba',
       ${opts.capacity ?? 6}, ${opts.bookedCount ?? 0},
       ${opts.status ?? 'open'}::mentorship_session_status)
    returning id`
  return row.id as string
}

/**
 * O nome que o type-to-confirm de `admin_end_contract` exige (c13 · nº 5).
 *
 * Desde a rodada 3 do Sol a confirmação é conferida DENTRO da transação que
 * encerra, contra o nome ATUAL do aluno (ou o rótulo da turma): a RPC ganhou
 * `p_confirm_name` obrigatório. Os testes que só querem exercitar o
 * encerramento perguntam aqui qual é o nome do dia — quem prova a régua da
 * confirmação é `c13-correcoes-sol-3.test.ts`.
 */
export async function nomeDeConfirmacao(sql: Sql, contractId: string): Promise<string> {
  const [row] = await sql<{ nome: string | null }[]>`
    select coalesce(s.display_name, g.label) as nome
      from contracts c
      left join students s on s.id = c.student_id
      left join student_groups g on g.id = c.student_group_id
     where c.id = ${contractId}`
  if (!row?.nome) throw new Error(`contrato ${contractId} sem nome de confirmação`)
  return row.nome
}

/**
 * O primeiro dia civil, a partir de `de` (inclusive), em que a zona troca de
 * regime (a próxima virada de DST), lido da base IANA pelo Luxon — Lei 1:
 * nunca uma data de virada cravada. Sonda ao meio-dia de cada dia porque as
 * viradas acontecem de madrugada: no próprio dia da virada, 12:00 já está no
 * regime novo. Zona sem DST estoura em vez de devolver uma data inventada.
 */
export function proximaVirada(de: DateTime): DateTime {
  for (let d = 0; d <= 400; d++) {
    const dia = de.plus({ days: d }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    if (dia.isInDST !== de.isInDST) return dia.startOf('day')
  }
  throw new Error(`${de.zoneName} não vira o relógio em 400 dias — o caso de DST não se aplica`)
}

/**
 * O dia da PRÓXIMA noite em que `tz` sai do horário de verão (o relógio
 * recua), a partir de amanhã. `proximaVirada` devolve a próxima virada em
 * qualquer sentido; se ela for a de AVANÇO (inverno → verão), a de recuo é a
 * seguinte. Começa em meio-dia para a aritmética de dias não tropeçar na
 * própria virada.
 */
export function proximoRecuo(tz: string): DateTime {
  // Sondas ao MEIO-DIA: à meia-noite do dia da virada o regime ainda é o velho.
  const meioDia = (d: DateTime) => d.set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
  const amanha = meioDia(DateTime.now().setZone(tz).plus({ days: 1 }))
  const primeira = proximaVirada(amanha)
  const recuo = meioDia(primeira).isInDST ? proximaVirada(meioDia(primeira)) : primeira
  if (meioDia(recuo).isInDST) throw new Error(`${tz}: a virada seguinte não é de recuo`)
  return recuo.startOf('day')
}

/**
 * Aula agendada num INSTANTE fixo (ISO UTC, normalmente vindo de `instanteEm`),
 * para teste que precisa de hora civil determinística. `createInstance` marca
 * "agora + N horas" — a hora civil da aula flutua com o relógio da rodada, e
 * pareá-la com uma janela de hora fixa no mesmo dia dá choque numa faixa de
 * 45 min por dia (a6/f, vermelho no CI em 10/10/2026).
 */
export async function createInstanceAt(
  sql: Sql,
  c: { contractId: string; teacherId: string },
  startsAtUtc: string,
  durationMin = 45,
): Promise<string> {
  const [row] = await sql`
    insert into class_instances
      (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
    values
      (${c.contractId}, ${c.teacherId}, ${startsAtUtc},
       ${startsAtUtc}::timestamptz + make_interval(mins => ${durationMin}),
       'fixture de teste (instante fixo)')
    returning id`
  return row.id as string
}

/**
 * Promessa de CORRIDA que será julgada DEPOIS (`await expect(p).rejects…`).
 * Entre a rejeição e o momento em que o teste chega à asserção, o Node não vê
 * tratador nenhum e o Vitest derruba a rodada com "Unhandled Rejection" — mesmo
 * com todos os testes verdes (medido na main em 11/10/2026, `m3-c6` corrida
 * extensão × pausa; 1 em 4 rodadas, só quando o banco responde rápido). O
 * `catch` vazio marca a promessa como tratada; a rejeição original continua
 * disponível para a asserção. Custo assumido: se o teste falhar numa asserção
 * ANTERIOR, a rejeição da transação pendente não aparece como erro extra no
 * relatório (a primeira falha continua visível).
 */
export function julgadaDepois<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}
