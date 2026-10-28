// Seed de BANCADA (pós `supabase db reset` + preview-logins): preenche o que o
// seed real deixa vazio — mentoria, pagamentos, relatórios, extratos, avisos e
// assinaturas — para desenhar/verificar os estados CHEIOS dessas telas.
// Conexão direta de OWNER no Postgres LOCAL (as tabelas críticas negam INSERT
// até ao service_role — de propósito); NUNCA roda fora de localhost; dados
// marcados "(bancada)". NÃO toca em supabase/seed.sql (pino da suíte).
//
// Uso: node --env-file=.env.local scripts/preview-seed.ts
//
// RETOMÁVEL POR BLOCO (conserto de 26/07): a versão anterior tinha UMA guarda
// global ("bancada já semeada — nada a fazer") logo no começo. Quando um passo
// lá no fim quebrava — e quebrou: `enqueue_class_reminders()` sumiu na Leva
// F6 de 18/07, virou `enqueue_class_touches()`, e o Postgres respondia
// ParseFuncOrColumn —, a bancada ficava pela metade E a guarda global
// impedia qualquer nova tentativa. Agora cada bloco diz se JÁ está feito;
// rodar de novo completa o que faltou. Um bloco que falha não impede os
// outros: o resumo do fim lista o que ficou de fora e o processo sai != 0.
//
// TRANSACIONAL POR BLOCO (correção 8 da revisão adversarial de 26/07): cada
// `run()` roda dentro de BEGIN/COMMIT e leva ROLLBACK no erro. Sem isso, um
// bloco que quebrava no meio deixava rastro — e a guarda, que olha para UM
// artefato, podia ver o artefato criado antes da queda e declarar o bloco
// pronto para sempre, com metade das linhas faltando (bancada que mente).
// Com a transação, o bloco OU completa OU não deixa nada: a guarda volta a ser
// uma pergunta honesta e a re-execução refaz o bloco inteiro.

import pg from 'pg'
import { DateTime } from 'luxon'

const DB_URL = process.env.PREVIEW_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!DB_URL.includes('127.0.0.1') && !DB_URL.includes('localhost')) {
  console.error(`banco não é local (${DB_URL}) — este script é só de bancada. Abortando.`)
  process.exit(1)
}

const TZ = 'America/Cuiaba'
const now = DateTime.now().setZone(TZ)
const client = new pg.Client({ connectionString: DB_URL })

async function val<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params)
  if (!rows[0]) throw new Error(`linha esperada não veio: ${sql.slice(0, 60)}`)
  return rows[0][Object.keys(rows[0])[0]] as T
}

/** true quando a consulta devolve pelo menos uma linha (guarda de bloco). */
async function existe(sql: string, params: unknown[] = []): Promise<boolean> {
  const { rowCount } = await client.query(sql, params)
  return (rowCount ?? 0) > 0
}

interface Bloco {
  nome: string
  /** já está semeado? (consulta pelo ARTEFATO final do bloco) */
  feito: () => Promise<boolean>
  run: () => Promise<void>
}

/* ------------------------------------------------------------------ blocos */

const LEVELS: Record<string, string> = {
  Sabrina: 'B1', 'Bianca Bastos': 'A2', 'Amanda Karina Serra': 'B2', 'Gabriel Barros': 'A1',
  'Luís Bento': 'B1', 'Elisa Faria': 'C1', 'Tomás Estevão': 'A2', 'Vinícius Lacerda': 'B2',
  'Fábio Ramos': 'A1', 'Jéssica Sampaio': 'B1', 'Joana Siqueira': 'A2',
  'Lara Moraes': 'B2', 'Murilo Fonseca': 'A1',
}

const cadastro: Bloco = {
  nome: 'níveis + cadastro das professoras',
  feito: async () =>
    !(await existe(
      `select 1 from students where display_name = any($1::text[]) and level is null`,
      [Object.keys(LEVELS)],
    )),
  run: async () => {
    // Os nomes têm de bater com o `display_name` do seed REAL. A versão anterior
    // usava só o primeiro nome ('Amanda Karina', 'Gabriel', 'Murilo'…) e o
    // UPDATE não achava ninguém — 9 dos 13 alunos ficavam sem nível, calados,
    // porque UPDATE que casa 0 linhas não é erro no Postgres. Pego na varredura
    // visual de 22/07: a lista de alunos aparecia quase toda sem a etiqueta.
    const semAlvo: string[] = []
    for (const [name, level] of Object.entries(LEVELS)) {
      const r = await client.query(`update students set level = $1 where display_name = $2`, [level, name])
      if (!r.rowCount) semAlvo.push(name)
    }
    if (semAlvo.length) {
      // Bancada que mente é pior que bancada vazia: se o nome mudou no seed real,
      // é para aparecer aqui, não numa tela quase toda sem etiqueta.
      throw new Error(`níveis: nenhum aluno com estes nomes — ${semAlvo.join(', ')}`)
    }
    await client.query(
      `update teachers set cpf = '000.000.000-00', contract_kind = 'PJ — paga por hora auditada' where display_name = 'Renata'`,
    )
    await client.query(`update teachers set contract_kind = 'Dona da escola' where display_name = 'Teacher Vicky'`)
  },
}


async function acharAluno(name: string): Promise<string> {
  return val<string>(`select id from students where display_name = $1`, [name])
}

const mentoria: Bloco = {
  nome: 'alunos e contratos de mentoria',
  // Guarda no ÚLTIMO artefato do bloco (o contrato da Camila), não no primeiro:
  // uma queda no meio precisa poder ser retomada.
  feito: async () =>
    existe(
      `select 1 from contracts c join students s on s.id = c.student_id
        where s.display_name = 'Camila (bancada)' and c.contract_type = 'mentorship'`,
    ),
  run: async () => {
    async function mkStudent(name: string, tz: string, city: string, country: string, level: string | null) {
      const achado = await client.query(`select id from students where display_name = $1`, [name])
      if (achado.rowCount) return achado.rows[0].id as string
      return val<string>(
        // `tz_confirmed` explícito (c11 · U1): o default virou `false`, e estes
        // alunos da bancada nascem COM cidade — o estado de quem já foi conferido.
        `insert into students (display_name, iana_tz, city, country, level, status, tz_confirmed)
         values ($1, $2, $3, $4, $5, 'active', true) returning id`,
        [name, tz, city, country, level],
      )
    }
    const sabrina = await acharAluno('Sabrina')
    const mariana = await mkStudent('Mariana (bancada)', 'America/Sao_Paulo', 'Campinas', 'Brasil', 'B1')
    const rafael = await mkStudent('Rafael (bancada)', 'Europe/Lisbon', 'Lisboa', 'Portugal', 'A2')
    const camila = await mkStudent('Camila (bancada)', 'America/New_York', 'Orlando', 'EUA', null)

    async function mkMentoria(
      studentId: string,
      opts: { startMonthsAgo: number | null; thresholds: boolean; pct: number | null },
    ) {
      const jaTem = await client.query(
        `select id from contracts where student_id = $1 and contract_type = 'mentorship'`,
        [studentId],
      )
      if (jaTem.rowCount) return jaTem.rows[0].id as string

      const startedOn = now.minus({ months: opts.startMonthsAgo ?? 0 }).toISODate()
      const contractId = await val<string>(
        `insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, status, started_on)
         values ('mentorship', $1, 'Personal Travel', 7000, 'active', $2) returning id`,
        [studentId, startedOn],
      )
      await client.query(
        `insert into mentorship_contracts (contract_id, course_start_date) values ($1, $2)`,
        [contractId, opts.startMonthsAgo === null ? null : startedOn],
      )
      if (opts.thresholds) {
        // F10/M6-1 (18/07): o trigger mentorship_contracts_seed_thresholds já
        // semeia a régua a partir de mentorship_default_thresholds. Sem o
        // ON CONFLICT, a bancada quebrava na chave primária assim que alguém
        // preenchesse os defaults globais.
        await client.query(
          `insert into mentorship_window_rules (contract_id, window_index, threshold_pct)
           select $1, i, (array[0, 10, 25, 40, 55, 70])[i] from generate_series(1, 6) i
           on conflict (contract_id, window_index) do update set threshold_pct = excluded.threshold_pct`,
          [contractId],
        )
      }
      if (opts.pct !== null && opts.startMonthsAgo !== null) {
        await client.query(
          `insert into course_progress (contract_id, student_id, completion_pct, last_synced_at)
           values ($1, $2, $3, $4) on conflict (contract_id) do nothing`,
          [contractId, studentId, opts.pct, now.minus({ hours: 18 }).toISO()],
        )
      }
      return contractId
    }

    await mkMentoria(sabrina, { startMonthsAgo: 3, thresholds: true, pct: 30 })
    await mkMentoria(mariana, { startMonthsAgo: 5, thresholds: true, pct: 47 })
    await mkMentoria(rafael, { startMonthsAgo: 1, thresholds: false, pct: 12 })
    await mkMentoria(camila, { startMonthsAgo: null, thresholds: true, pct: null })
    console.log('  4 contratos (Sabrina, Mariana, Rafael sem régua, Camila sem início)')
  },
}

const sessoes: Bloco = {
  nome: 'sessões de mentoria + reserva histórica',
  feito: async () => existe(`select 1 from mentorship_sessions where google_event_id = 'preview-bancada'`),
  run: async () => {
    const mariana = await acharAluno('Mariana (bancada)')
    const cMariana = await val<string>(
      `select id from contracts where student_id = $1 and contract_type = 'mentorship'`,
      [mariana],
    )
    async function mkSession(dt: DateTime, status: string, capacity = 6) {
      return val<string>(
        `insert into mentorship_sessions (scheduled_at, local_time_snapshot, duration_min, capacity, status, google_event_id)
         values ($1, $2, 60, $3, $4, 'preview-bancada') returning id`,
        [dt.toUTC().toISO(), `${dt.toFormat('HH:mm')} ${TZ}`, capacity, status],
      )
    }
    const sDone = await mkSession(now.minus({ days: 21 }).set({ hour: 10, minute: 0 }), 'done')
    await mkSession(now.plus({ days: 5 }).set({ hour: 19, minute: 0 }), 'open')
    await mkSession(now.plus({ days: 19 }).set({ hour: 10, minute: 0 }), 'open')
    await mkSession(now.plus({ days: 12 }).set({ hour: 19, minute: 0 }), 'cancelled')

    const ledgerId = await val<string>(
      `insert into mentorship_credit_ledger (contract_id, student_id, delta, reason, window_index, session_id)
       values ($1, $2, -1, 'booking_spend', 1, $3) returning id`,
      [cMariana, mariana, sDone],
    )
    await client.query(
      `insert into mentorship_bookings (session_id, student_id, contract_id, ledger_id) values ($1, $2, $3, $4)`,
      [sDone, mariana, cMariana, ledgerId],
    )
    await client.query(`update mentorship_sessions set booked_count = 1 where id = $1`, [sDone])
    console.log('  1 realizada (com presença), 2 abertas, 1 cancelada')
  },
}

const SNAPSHOT_ONTEM = 'bancada — aula de ontem'

const pendencias: Bloco = {
  nome: 'aulas de ontem sem desfecho (visão Pendências)',
  feito: async () => existe(`select 1 from class_instances where local_time_snapshot = $1`, [SNAPSHOT_ONTEM]),
  run: async () => {
    await client.query(
      `insert into class_instances (contract_id, teacher_id, occurrence_date, starts_at_utc, ends_at_utc, local_time_snapshot, state)
       select c.id, c.teacher_id, ($1::timestamptz at time zone 'America/Cuiaba')::date,
              $1::timestamptz + (row_number() over ()) * interval '75 minutes',
              $1::timestamptz + (row_number() over ()) * interval '75 minutes' + interval '45 minutes',
              $2, 'scheduled'
       from contracts c
       join students s on s.id = c.student_id
       where c.contract_type = 'private_1on1' and s.display_name in ('Bianca Bastos', 'Luís Bento', 'Joana Siqueira')`,
      [now.minus({ days: 1 }).set({ hour: 9, minute: 0 }).toUTC().toISO(), SNAPSHOT_ONTEM],
    )
    console.log('  3 aulas de ontem sem desfecho')
  },
}

const NOTA_CREDITO = 'bancada — crédito para o fluxo de resgate'

const creditos: Bloco = {
  nome: 'créditos de reposição para a Sabrina',
  feito: async () => existe(`select 1 from makeup_ledger where note = $1`, [NOTA_CREDITO]),
  run: async () => {
    await client.query(
      `insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, note)
       select c.id, c.student_id, 2, 'manual_adjust', (current_date + 90), $1
       from contracts c join students s on s.id = c.student_id
       where s.display_name = 'Sabrina' and c.contract_type = 'private_1on1'`,
      [NOTA_CREDITO],
    )
    console.log('  +2 para a Sabrina (resgate visível no portal)')
  },
}

const pagamentos: Bloco = {
  nome: 'pagamentos (espelho Asaas de bancada)',
  // O guarda mira o ÚLTIMO artefato do bloco (a estornada, Sol F1-r1): bancada
  // criada antes dela re-roda o bloco e backfilla — os inserts têm on conflict.
  feito: async () => existe(`select 1 from payments where asaas_payment_id = 'bancada-pay-5'`),
  run: async () => {
    const sabrina = await acharAluno('Sabrina')
    const contractSabrina = await val<string>(
      `select id from contracts where student_id = $1 and contract_type = 'private_1on1'`,
      [sabrina],
    )
    const jaPagador = await client.query(`select id from payers where asaas_customer_id = 'bancada-cus-1'`)
    const payerId = jaPagador.rowCount
      ? (jaPagador.rows[0].id as string)
      : await val<string>(
          `insert into payers (name, email, cpf_cnpj, asaas_customer_id)
           values ('Responsável da Sabrina (bancada)', 'resp-sabrina@bancada.dev', '111.222.333-44', 'bancada-cus-1')
           returning id`,
        )
    // F3: o vínculo nasce SELF na bancada — é o estado que liga o botão da
    // fatura no portal (o portão visual do F3 é exatamente este caminho).
    await client.query(
      `insert into student_payers (student_id, payer_id, relationship)
       values ($1, $2, 'self') on conflict (student_id, payer_id) do update set relationship = 'self'`,
      [sabrina, payerId],
    )

    const lista = [
      { m: -2, status: 'received', paid: true, overdue: false },
      { m: -1, status: 'confirmed', paid: true, overdue: false },
      { m: 0, status: 'overdue', paid: false, overdue: true },
      { m: 1, status: 'pending', paid: false, overdue: false },
      // Onda Financeiro · F1: uma ESTORNADA com paid_at preenchido — o caso que
      // a tela velha chamava de "paga" e a régua do banco chama de "estornada".
      // Serve de prova viva no portão visual (aba "Todas").
      { m: -3, status: 'REFUNDED', paid: true, overdue: false },
    ]
    for (const [i, p] of lista.entries()) {
      const due = p.overdue ? now.minus({ days: 12 }) : now.plus({ months: p.m }).set({ day: 5 })
      await client.query(
        `insert into payments (asaas_payment_id, payer_id, contract_id, amount_cents, status, due_date, paid_at, billing_type, reference_ym, raw)
         values ($1, $2, $3, 68000, $4, $5, $6, 'PIX', $7, $8)
         on conflict (asaas_payment_id) do nothing`,
        [
          `bancada-pay-${i + 1}`,
          payerId,
          contractSabrina,
          p.status,
          due.toISODate(),
          p.paid ? due.plus({ days: 1 }).toISO() : null,
          due.toFormat('yyyy-LL'),
          // F3: o raw carrega o invoiceUrl como no payload real (fixtures do
          // F0) — com o vínculo self, o portal liga o botão "Abrir a fatura".
          JSON.stringify({
            bancada: true,
            payment: { invoiceUrl: `https://www.asaas.com/i/bancada-pay-${i + 1}` },
          }),
        ],
      )
    }
    console.log('  2 pagos, 1 vencido, 1 em aberto, 1 estornado')
  },
}

const relatorios: Bloco = {
  nome: 'relatórios de progresso',
  feito: async () => existe(`select 1 from progress_reports where model = 'bancada'`),
  run: async () => {
    const sabrina = await acharAluno('Sabrina')
    const contractSabrina = await val<string>(
      `select id from contracts where student_id = $1 and contract_type = 'private_1on1'`,
      [sabrina],
    )
    const adminProfile = await val<string>(`select id from profiles where role = 'admin' limit 1`)
    async function mkReport(title: string, monthsAgo: number, to: 'draft' | 'sent') {
      const start = now.minus({ months: monthsAgo }).startOf('month')
      const id = await val<string>(
        `insert into progress_reports (student_id, contract_id, period_start, period_end, title, content_md, highlights, status, model)
         values ($1, $2, $3, $4, $5, $6, $7, 'draft', 'bancada') returning id`,
        [
          sabrina,
          contractSabrina,
          start.toISODate(),
          start.endOf('month').toISODate(),
          title,
          '## Como foi o período\n\nSabrina avançou bem em conversação — destaque para o passado simples.\n\n- Presença: 7 de 8 aulas\n- Próximo foco: phrasal verbs do dia a dia',
          JSON.stringify({ presenca: '7/8', foco: 'phrasal verbs' }),
        ],
      )
      if (to === 'sent') {
        await client.query(
          `update progress_reports set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`,
          [id, adminProfile],
        )
        await client.query(`update progress_reports set status = 'sent', sent_at = now() where id = $1`, [id])
      }
    }
    await mkReport('[bancada] Relatório de junho — Sabrina', 1, 'sent')
    await mkReport('[bancada] Relatório de julho — Sabrina', 0, 'draft')
    console.log('  1 enviado, 1 rascunho')
  },
}

const extrato: Bloco = {
  nome: 'extrato fechado da professora (mês passado)',
  feito: async () =>
    existe(
      `select 1 from teacher_statements ts join teachers t on t.id = ts.teacher_id
        where t.display_name = 'Renata' and ts.period_start = $1`,
      [now.minus({ months: 1 }).startOf('month').toISODate()],
    ),
  run: async () => {
    const parceira = await val<string>(`select id from teachers where display_name = 'Renata'`)
    const lastMonth = now.minus({ months: 1 })
    await client.query(
      `insert into teacher_statements (teacher_id, period_start, period_end, audited_hours, rate_cents, adjustments_cents, manual_adjustments_cents, total_cents, status)
       values ($1, $2, $3, 22.5, 5000, 0, 0, $4, 'closed')`,
      [parceira, lastMonth.startOf('month').toISODate(), lastMonth.endOf('month').toISODate(), Math.round(22.5 * 5000)],
    )
    console.log('  1 fechado (mês passado)')
  },
}

const assinaturas: Bloco = {
  nome: 'assinaturas de contrato',
  feito: async () => existe(`select 1 from contract_signatures where provider_document_id like 'bancada-doc-%'`),
  run: async () => {
    const sabrina = await acharAluno('Sabrina')
    const contractSabrina = await val<string>(
      `select id from contracts where student_id = $1 and contract_type = 'private_1on1'`,
      [sabrina],
    )
    const contractBianca = await val<string>(
      `select c.id from contracts c join students s on s.id = c.student_id where s.display_name = 'Bianca Bastos' limit 1`,
    )
    await client.query(
      // c15 · Sol 8: `sent_at` perdeu o default — quem escreve um documento
      // ENVIADO tem de dizer quando foi (a coluna não inventa mais um "agora"
      // para reserva nenhuma). `reserved_at` acompanha: o pedido começou antes
      // do envio, e é ele que ordena o histórico na tela.
      `insert into contract_signatures
         (contract_id, provider_document_id, status, reserved_at, sent_at, signed_at)
       values ($1, 'bancada-doc-1', 'signed', $2, $2, $3),
              ($4, 'bancada-doc-2', 'sent',   $5, $5, null)`,
      [
        contractSabrina,
        now.minus({ days: 45 }).toISO(),
        now.minus({ days: 40 }).toISO(),
        contractBianca,
        now.minus({ days: 10 }).toISO(),
      ],
    )
    console.log('  1 assinada, 1 aguardando')
  },
}

const avisos: Bloco = {
  nome: 'avisos: enfileiramento real + estados sintéticos',
  feito: async () => existe(`select 1 from notification_outbox where dedupe_key like 'bancada:%'`),
  run: async () => {
    // ⚠️ `enqueue_class_reminders()` NÃO EXISTE MAIS: a Leva F6 (migration
    // 20260718000800) trocou o lembrete diário pelos TOQUES horários e
    // renomeou a função para `enqueue_class_touches()`. Era este o
    // ParseFuncOrColumn que travava a bancada desde 18/07.
    await client.query(`select enqueue_class_touches()`)
    await client.query(`select enqueue_meeting_reminders()`)
    await client.query(`select enqueue_credit_expiry_notices()`)
    await client.query(`select enqueue_mentorship_eligibility_notices()`)
    const sabrinaProfile = (
      await client.query(`select profile_id from students where display_name = 'Sabrina'`)
    ).rows[0]?.profile_id
    if (sabrinaProfile) {
      await client.query(
        `insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key, error, sent_at)
         values
           ('whatsapp', 'class-reminder', $1, $2, 'bancada:erro-1', 'Evolution: número não está no WhatsApp', null),
           ('email', 'reschedule-confirm', $1, '{"bancada": true}', 'bancada:enviado-1', null, $3)
         on conflict (dedupe_key) do nothing`,
        [sabrinaProfile, JSON.stringify({ bancada: true, starts_at_utc: now.plus({ days: 1 }).toUTC().toISO() }), now.minus({ hours: 2 }).toISO()],
      )
    } else {
      // Sem perfil vinculado não há destinatário: dizer isso é melhor do que
      // uma bancada silenciosamente sem os dois estados de aviso.
      throw new Error('Sabrina sem profile_id — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    }
    console.log('  fila real enfileirada + 1 preso com erro + 1 enviado')
  },
}

/* ---- bancada do INÍCIO (revisão adversarial nº 1, C12) -------------------- */

const SNAPSHOT_HOJE = 'bancada — aula de hoje'

/** Os estados que a tela desenha diferente — todos precisam existir HOJE. */
const ESTADOS_DE_HOJE = ['scheduled', 'completed', 'no_show_student'] as const

/** Folga mínima de cada lado do agora (o retry de vaga anda +7 min por
 *  tentativa, e a aula dura 45 min). */
const MARGEM = { minutes: 120 }

/**
 * O andar HOJE só é decidível se HOUVER aula hoje, em estados MISTOS: uma já
 * passada e sem registro (que acende o CTA de apontamento), uma realizada, uma
 * falta e as próximas ainda por vir. Sem isto, a bancada mostrava o estado
 * vazio ("Nenhuma aula hoje") e não dava para julgar a linha da agenda.
 *
 * Os horários são calculados EM CUIABÁ (Lei 1: hora local + zona, instante
 * derivado com o offset daquele dia) e distribuídos proporcionalmente dentro do
 * dia civil — três antes do agora, duas depois.
 *
 * ⚠️ GUARDA POR DIA CIVIL (revisão adversarial retroativa nº 2, B6). A guarda
 * antiga perguntava se EXISTIA qualquer instância com o prefixo — e a resposta,
 * depois da primeira execução, era "sim" PARA SEMPRE. No dia seguinte o bloco
 * era pulado e o Início voltava a abrir vazio, com o resumo dizendo "já
 * semeado". Agora ela exige linhas de HOJE (dia civil de Cuiabá) cobrindo o
 * conjunto completo de estados.
 *
 * ⚠️ BORDAS DO DIA (mesmo item). Nos primeiros e nos últimos minutos os
 * intervalos INVERTEM: `fatia(inicioDoDia, now, …)` com o agora antes do início
 * devolve instantes no FUTURO — e o bloco fabricaria uma aula "realizada" que
 * ainda não aconteceu, ou uma "agendada" no passado (que a tela lê como
 * apontamento em falta). Em vez de mentir, o bloco estoura com a hora em que
 * dá para rodá-lo.
 */
const aulasDeHoje: Bloco = {
  nome: 'aulas de HOJE em estados mistos (andar Hoje do Início)',
  feito: async () => {
    const { rows } = await client.query(
      `select coalesce(array_agg(distinct state), '{}') as estados,
              count(*)::int as n,
              count(*) filter (where state = 'scheduled' and ends_at_utc <= now())::int as sem_registro
         from class_instances
        where local_time_snapshot like $1
          and occurrence_date = $2::date`,
      [`${SNAPSHOT_HOJE}%`, now.toISODate()],
    )
    const { estados, n, sem_registro } = rows[0] as { estados: string[]; n: number; sem_registro: number }
    // `sem_registro > 0` entrou no M5: sem uma aula de hoje JÁ TERMINADA e ainda
    // sem desfecho, o andar Hoje abre sem o botão "Registrar" — o único gatilho
    // de Sheet do site, e o que o harness da onda exercita.
    //
    // ⚠️ E SÃO **DUAS** DESDE O A9 (30/07), porque agora há DOIS consumidores na
    // mesma rodada de `npm run test:e2e`, e o primeiro GASTA a sua: o caso 9 do
    // harness da Agenda registra a aula sem desfecho ("registrar realizada pelo
    // balão", que é o caso obrigatório "o estado do banco bate com a promessa"),
    // e depois dele o `onda1.spec` não achava mais o botão "Registrar" do Início
    // — o `beforeAll` dele derrubava dois casos por arrasto. Medido na 1ª rodada
    // das três suítes juntas. Uma para gastar, uma para o Início.
    return n >= 5 && sem_registro >= 2 && ESTADOS_DE_HOJE.every((e) => estados.includes(e))
  },
  run: async () => {
    const inicioDoDia = now.startOf('day').plus({ minutes: 10 })
    const fimDoDia = now.endOf('day').minus({ minutes: 10 })

    // Bancada que mente é pior que bancada vazia — e nas bordas do dia não há
    // como não mentir. Diz o que falta em vez de fabricar estado impossível.
    if (now < inicioDoDia.plus(MARGEM)) {
      throw new Error(
        `são ${now.toFormat('HH:mm')} em Cuiabá: ainda não cabe aula CONCLUÍDA no passado de hoje — ` +
          `rode depois das ${inicioDoDia.plus(MARGEM).toFormat('HH:mm')}`,
      )
    }
    if (now > fimDoDia.minus(MARGEM)) {
      throw new Error(
        `são ${now.toFormat('HH:mm')} em Cuiabá: não cabe mais aula AGENDADA no futuro de hoje — ` +
          `rode amanhã depois das ${inicioDoDia.plus(MARGEM).toFormat('HH:mm')}`,
      )
    }
    const fatia = (de: DateTime, ate: DateTime, i: number, n: number) =>
      de.plus({ milliseconds: ((ate.toMillis() - de.toMillis()) * i) / n }).startOf('minute')

    // O LADO DO DIA É DADO DO PLANO, não dedução a partir do `state` (conserto
    // do M5, 27/07). O cinto de segurança do B6 deduzia "scheduled ⇒ futuro" —
    // e com isso PROIBIA justamente a linha que o cabeçalho deste bloco promete:
    // "uma já passada e sem registro (que acende o CTA de apontamento)", que é
    // `scheduled` no PASSADO. Resultado medido: a Sabrina nunca entrava, só 4 das
    // 5 linhas eram possíveis e o bloco quebrava no mínimo de 4 assim que
    // qualquer outra esbarrasse em agenda ocupada — a bancada abria sem o botão
    // "Registrar", que é o único gatilho de Sheet do site.
    const planos: { aluno: string; quando: DateTime; state: string; lado: 'passado' | 'futuro' }[] = [
      // A SEGUNDA aula sem registro (A9, 30/07): o harness da Agenda GASTA uma
      // (caso 9) e o `onda1.spec`, que roda depois na mesma rodada, precisa da
      // outra para achar o botão "Registrar" do Início. Aluno de OUTRA
      // professora (a dona) de propósito: a Sabrina é da professora, e duas aulas
      // da mesma professora na mesma faixa disputariam o índice único de
      // sobreposição, gastando as 5 tentativas do laço de vaga.
      { aluno: 'Luís Bento', quando: fatia(inicioDoDia, now, 0.5, 4), state: 'scheduled', lado: 'passado' },
      { aluno: 'Sabrina', quando: fatia(inicioDoDia, now, 1, 4), state: 'scheduled', lado: 'passado' },
      { aluno: 'Amanda Karina Serra', quando: fatia(inicioDoDia, now, 2, 4), state: 'completed', lado: 'passado' },
      { aluno: 'Gabriel Barros', quando: fatia(inicioDoDia, now, 3, 4), state: 'no_show_student', lado: 'passado' },
      { aluno: 'Elisa Faria', quando: fatia(now, fimDoDia, 1, 3), state: 'scheduled', lado: 'futuro' },
      { aluno: 'Tomás Estevão', quando: fatia(now, fimDoDia, 2, 3), state: 'scheduled', lado: 'futuro' },
    ]

    const feitos: string[] = []
    for (const p of planos) {
      const contrato = await client.query(
        `select c.id, c.teacher_id from contracts c join students s on s.id = c.student_id
          where s.display_name = $1 and c.contract_type = 'private_1on1' and c.status = 'active' limit 1`,
        [p.aluno],
      )
      if (!contrato.rowCount) throw new Error(`aulas de hoje: contrato ativo de ${p.aluno} não existe no seed`)
      const { id: contractId, teacher_id: teacherId } = contrato.rows[0]

      // A agenda real do seed já ocupa horários; a professora tem índice único
      // de sobreposição (Lei 3). Anda de 7 em 7 minutos até achar vaga em vez
      // de estourar — e desiste depois de 5 tentativas, sem mentir.
      let inserido = false
      for (let tentativa = 0; tentativa < 5 && !inserido; tentativa++) {
        const inicio = p.quando.plus({ minutes: 7 * tentativa })
        const fim = inicio.plus({ minutes: 45 })
        const ocupado = await existe(
          `select 1 from class_instances
            where teacher_id = $1 and state in ('scheduled', 'completed')
              and tstzrange(starts_at_utc, ends_at_utc) && tstzrange($2::timestamptz, $3::timestamptz)`,
          [teacherId, inicio.toUTC().toISO(), fim.toUTC().toISO()],
        )
        if (ocupado) continue
        // Cinto de segurança do B6, agora conferido contra o LADO declarado: o
        // desvio do retry (+7 min por tentativa) nunca pode empurrar uma linha
        // do passado para o futuro nem o contrário. Passado exige a aula
        // TERMINADA (`fim <= now`) — é isso que faz o Início lê-la como "sem
        // registro" em vez de "em andamento".
        if (p.lado === 'futuro' ? inicio <= now : fim > now) continue
        await client.query(
          `insert into class_instances
             (contract_id, teacher_id, occurrence_date, starts_at_utc, ends_at_utc, local_time_snapshot, state)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contractId,
            teacherId,
            inicio.toISODate(),
            inicio.toUTC().toISO(),
            fim.toUTC().toISO(),
            `${SNAPSHOT_HOJE} ${inicio.toFormat('HH:mm')} ${TZ}`,
            p.state,
          ],
        )
        feitos.push(`${p.state}/${p.lado}`)
        inserido = true
      }
    }

    // Os estados que a tela desenha diferente têm de estar todos lá — a mesma
    // lista que a guarda exige para considerar o bloco pronto.
    for (const exigido of ESTADOS_DE_HOJE) {
      if (!feitos.some((f) => f.startsWith(`${exigido}/`)))
        throw new Error(`aulas de hoje: faltou o estado ${exigido} (agenda cheia?)`)
    }
    // As linhas do CTA: DUAS aulas de hoje já terminadas e ainda sem desfecho —
    // uma para o caso 9 do harness da Agenda gastar, outra para o botão
    // "Registrar" do Início que o `onda1.spec` exercita depois (ver a guarda).
    const semRegistro = feitos.filter((f) => f === 'scheduled/passado').length
    if (semRegistro < 2)
      throw new Error(
        `aulas de hoje: só ${semRegistro} aula(s) SEM REGISTRO (scheduled no passado) — ` +
          'são precisas 2 (uma o harness da Agenda gasta); agenda cheia?',
      )
    if (feitos.length < 5) throw new Error(`aulas de hoje: só ${feitos.length} couberam (mínimo 5)`)
    console.log(`  ${feitos.length} aulas hoje: ${feitos.join(', ')}`)
  },
}

/**
 * A comparação "vs mês anterior" do andar NEGÓCIO só aparece com DOIS
 * fechamentos: o de hoje e o do mesmo dia do mês passado (C5). O de hoje é
 * capturado pelo MESMO mecanismo do cron (`capture_kpi_snapshot`, a função que
 * o pg_cron chama às 07:00 UTC) — nada de payload paralelo. O do mês passado
 * não existe (o job nasceu ontem), então é FABRICADO a partir do de hoje, com a
 * mesma `definitions_version` e números plausivelmente menores; a marca
 * `"bancada": true` fica dentro do próprio jsonb, que é onde dá para marcar.
 */
const snapshotsDeKpi: Bloco = {
  nome: 'fechamentos de KPI (hoje + mesmo dia do mês passado)',
  feito: async () =>
    existe(`select 1 from kpi_snapshots where captured_on = $1`, [
      now.minus({ months: 1 }).toISODate(),
    ]),
  run: async () => {
    // idempotente por UNIQUE(captured_on) — a função devolve false se já havia
    await client.query(`select public.capture_kpi_snapshot()`)

    const hoje = await client.query(
      `select s.definitions_version,
              s.data,
              (public._admin_kpis_compute() ->> 'definitions_version')::int as versao_viva
         from kpi_snapshots s
        where s.captured_on = public.business_today()`,
    )
    if (!hoje.rowCount) throw new Error('snapshot de hoje não foi capturado — capture_kpi_snapshot() falhou?')
    const { definitions_version, data, versao_viva } = hoje.rows[0] as {
      definitions_version: number
      data: Record<string, unknown>
      versao_viva: number
    }
    // S3: a captura é IDEMPOTENTE (UNIQUE(captured_on) + do nothing), então um
    // snapshot de hoje gravado ANTES de a fórmula mudar sobrevive ao deploy — e
    // herdar a versão velha aqui fabricaria uma bancada mentirosa: o fabricado
    // do mês passado nasceria v1 ao lado de cartões v2, justamente o defeito
    // que a tela agora omite. Bancada não se conserta com remendo: reseta.
    if (definitions_version !== versao_viva) {
      throw new Error(
        `o fechamento de hoje é v${definitions_version} e a fórmula viva é v${versao_viva} — ` +
          'o snapshot do dia não se sobrescreve (append-only). Rode `npx supabase db reset` ' +
          'e semeie de novo.',
      )
    }

    const menor = (v: unknown, fator: number) => Math.round(Number(v ?? 0) * fator)
    const ativos = (data.alunos_ativos ?? {}) as Record<string, unknown>
    const base = now.minus({ months: 1 })
    const anterior = {
      ...data,
      bancada: true,
      business_date: base.toISODate(),
      month: base.toFormat('yyyy-LL'),
      recebido_no_mes_cents: menor(data.recebido_no_mes_cents, 0.82),
      previsto_no_mes_cents: menor(data.previsto_no_mes_cents, 0.9),
      em_atraso_cents: menor(data.em_atraso_cents, 1.35),
      alunos_ativos: {
        ...ativos,
        total: Math.max(0, Number(ativos.total ?? 0) - 1),
        particulares: Math.max(0, Number(ativos.particulares ?? 0) - 1),
      },
    }

    await client.query(
      `insert into kpi_snapshots (captured_on, definitions_version, data) values ($1, $2, $3)
       on conflict (captured_on) do nothing`,
      [base.toISODate(), definitions_version, JSON.stringify(anterior)],
    )
    console.log(`  fechamento de hoje + fabricado de ${base.toISODate()} (v${definitions_version})`)
  },
}

/* ---- bancada do PORTAL DO ALUNO (P7 · harness e2e do portal) -------------- */

/** A sala fixa da professora na bancada. Sem ela NENHUMA aula tem link de
 *  Meet (o seed real não grava `meet_url`) e o botão "Entrar" do D1 — que é o
 *  cartão principal do Início — simplesmente não é desenhado. */
const SALA_DA_BANCADA = 'https://meet.google.com/bancada-sala'

const ALUNO_BRIEFING = 'Briefing Pendente (bancada)'
const EMAIL_ALUNO_BRIEFING = 'aluno2-preview@local.dev'

/** Um briefing v2 de ADULTO que o banco aceita — as respostas mínimas de cada
 *  seção, na régua de `_briefing_validate_v2_secoes`. "Trabalho / carreira"
 *  fica DE FORA das finalidades de propósito: com ela o banco passaria a exigir
 *  3 tópicos profissionais, e o que se quer aqui é o caminho mais curto. */
const BRIEFING_V2_DA_BANCADA = {
  historia: {
    cidade_vida: 'Cuiabá',
    facil: 'Entender o que leio (bancada)',
    dificil: 'Falar sem travar (bancada)',
    contato: ['Aulas particulares'],
    experiencia_marcante: '',
  },
  objetivos: {
    finalidades: ['Viagens'],
    finalidade_principal: 'Viagens',
    topicos_profissionais: [],
    alvo_6_meses: 'Viajar e me virar sozinha (bancada)',
    onde_trava: ['Falar'],
    correcao_preferida: 'No fim da fala',
    tempo_diario: '10 min/dia',
    viagem: 'Planejo realizar uma viagem internacional em breve',
    intercambio: 'Nenhuma das alternativas',
  },
  interesses: {
    hobbies: ['Assistir filmes/séries', 'Escutar música', 'Ler', 'Cozinhar', 'Viajar', 'Fotografar'],
    leitura: 'sim',
    leitura_detalhe: 'Blogs de viagem (bancada)',
    filmes_series: 'não',
    filmes_series_detalhe: '',
    musicas: 'não',
    musicas_detalhe: '',
  },
  rotina: {
    blocos: { seg: ['Manhã'], qua: ['Noite'] },
    imersao: 'Ouvir músicas em inglês (legenda em inglês)',
  },
  livre: { obs: '', apoio: '' },
}

/** As 12 letras do Kolb — o ESTILO não é escolhido aqui: quem tabula e decide é
 *  `_briefing_submit` no banco (Lei 3). */
const KOLB_DA_BANCADA = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, 'ABCD'[i % 4]]),
)

/**
 * O PORTAL DO ALUNO precisa de DOIS alunos, e a diferença entre eles é o GATE.
 *
 * `/portal` redireciona quem não deu ciência do canal (`/portal/ciencia`) e quem
 * não enviou o briefing (`/portal/briefing`). Com um aluno só, ou o smoke das
 * telas não roda (o Início nunca abre) ou o fluxo do briefing v2 não existe.
 * Então:
 *
 *   · Sabrina (`aluno-preview`) atravessa o gate — ciência dada e briefing v2
 *     ENVIADO pelo caminho real (`_briefing_submit`, que valida e tabula o
 *     Kolb). É com ela que rodam as 10 telas do portal;
 *   · "Briefing Pendente (bancada)" (`aluno2-preview`) fica ANTES do gate: deu
 *     ciência, não enviou briefing. É o aluno do fluxo v2 de seis etapas e o do
 *     recado que precisa sobreviver ao redirect do gate.
 *
 * A conta de Auth do segundo já existe (preview-logins); o que falta — e nasce
 * aqui — é a linha de `students` apontando para o perfil dela.
 */
const portalDoAluno: Bloco = {
  nome: 'portal do aluno: sala fixa, gate liberado da Sabrina e 2º login com briefing pendente',
  feito: async () =>
    (await existe(`select 1 from teachers where display_name = 'Teacher Vicky' and fallback_meet_url is not null`)) &&
    (await existe(
      `select 1 from students s
         join profiles p on p.id = s.profile_id
         join briefings b on b.student_id = s.id
        where s.display_name = 'Sabrina'
          and p.whatsapp_channel_ack_at is not null
          -- correção 28/07: bancada semeada ANTES da regra do número não conta
          -- como feita; sem isto ela ficaria eternamente sem WhatsApp
          and p.whatsapp_e164 is not null
          and b.status = 'submitted'`,
    )) &&
    (await existe(
      `select 1 from students s join profiles p on p.id = s.profile_id
        where s.display_name = $1 and p.whatsapp_e164 is not null`,
      [ALUNO_BRIEFING],
    )),
  run: async () => {
    // 1. a sala fixa das duas professoras do seed real (D1)
    await client.query(`update teachers set fallback_meet_url = $1 where display_name in ('Teacher Vicky', 'Renata')`, [
      SALA_DA_BANCADA,
    ])

    // 2. Sabrina atravessa o gate
    const sabrina = await acharAluno('Sabrina')
    const perfilSabrina = await val<string | null>(`select profile_id from students where id = $1`, [sabrina])
    if (!perfilSabrina)
      throw new Error('Sabrina sem profile_id — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    // Correção 28/07: o número é canal de CONTRATO — o aluno chega ao portal
    // com ele já cadastrado pela professora (convite obrigatório). Sem isto a
    // bancada mostraria um estado que não existe mais em produção: perfil com o
    // campo de WhatsApp vazio.
    await client.query(
      `update profiles set whatsapp_channel_ack_at = now(), whatsapp_e164 = '+5565900060006' where id = $1`,
      [perfilSabrina],
    )
    // A linha nasce RASCUNHO e é fechada pela função do banco: assim o estilo de
    // aprendizagem que a tela "enviado" mostra é o que o gabarito calcula, e não
    // um valor escrito à mão pelo seed.
    await client.query(
      `insert into briefings (student_id, schema_version, answers, kolb_answers)
       values ($1, 2, $2, $3)
       on conflict (student_id) do update
         set schema_version = 2, answers = excluded.answers, kolb_answers = excluded.kolb_answers,
             status = 'draft', kolb_style = null, kolb_scores = null, submitted_at = null`,
      [sabrina, JSON.stringify(BRIEFING_V2_DA_BANCADA), JSON.stringify(KOLB_DA_BANCADA)],
    )
    await client.query(`select public._briefing_submit($1, $2)`, [sabrina, perfilSabrina])

    // 3. o segundo aluno, parado ANTES do briefing
    const perfil2 = await val<string>(`select id from auth.users where email = $1`, [EMAIL_ALUNO_BRIEFING])
    await client.query(
      `update profiles set whatsapp_channel_ack_at = now(), whatsapp_e164 = '+5565900070007' where id = $1`,
      [perfil2],
    )
    await client.query(
      `insert into students (display_name, iana_tz, city, country, level, status, tz_confirmed, student_type, profile_id)
       values ($1, 'America/Cuiaba', 'Cuiabá', 'Brasil', 'A2', 'active', true, 'adult', $2)`,
      [ALUNO_BRIEFING, perfil2],
    )
    console.log(`  sala fixa + Sabrina com briefing enviado + ${ALUNO_BRIEFING} (briefing pendente)`)
  },
}

/* ---- bancada do RE-BRIEFING SEMESTRAL (o 3º aluno) ----------------------- */

const ALUNO_REBRIEFING = 'Re-briefing (bancada)'
const EMAIL_ALUNO_REBRIEFING = 'aluno3-preview@local.dev'

/**
 * O TERCEIRO aluno existe porque o re-briefing pede um estado que os outros dois
 * não têm — e não podem ter sem estragar o que já provam.
 *
 * `briefing_update_pendente` só devolve pendência para quem tem, ao mesmo tempo:
 * contrato INDIVIDUAL ativo · plano de estudos VIGENTE de semestre ≥ 2 · briefing
 * base v2 ENVIADO · nenhuma atualização enviada naquele (contrato, semestre).
 * Encaixar isso na Sabrina significaria empurrar o `started_on` do contrato dela
 * oito meses para trás — e ela é a aluna das dez telas do smoke, com aulas,
 * créditos e pagamentos posicionados em relação a esse contrato. Um aluno
 * próprio custa uma linha de login e não move nada do que já está verde.
 *
 * O contrato nasce com 8 meses de estrada (o mesmo truque de
 * tests/briefing-updates.test.ts) para o relógio do contrato cair no 2º bloco de
 * 6 meses; quem decide o semestre é `generate_study_plan`, a RPC de produção,
 * chamada com claims de admin — plano fabricado à mão aqui seria uma bancada que
 * concorda consigo mesma em vez de concordar com o banco.
 */
const reBriefing: Bloco = {
  nome: 'portal do aluno: 3º login com RE-BRIEFING semestral pendente',
  feito: async () =>
    existe(
      `select 1
         from students s
         join contracts c on c.student_id = s.id and c.status = 'active'
         join study_plans sp on sp.contract_id = c.id and sp.semester_no >= 2
         join briefings b on b.student_id = s.id
         join profiles p on p.id = s.profile_id
        where s.display_name = $1
          and s.profile_id is not null
          and p.whatsapp_e164 is not null
          and b.status = 'submitted'
          and b.schema_version = 2`,
      [ALUNO_REBRIEFING],
    ),
  run: async () => {
    const perfil = await val<string>(`select id from auth.users where email = $1`, [EMAIL_ALUNO_REBRIEFING])
    await client.query(
      `update profiles set whatsapp_channel_ack_at = now(), whatsapp_e164 = '+5565900080008' where id = $1`,
      [perfil],
    )

    const aluno = await val<string>(
      `insert into students (display_name, iana_tz, city, country, level, status, tz_confirmed, student_type, profile_id)
       values ($1, 'America/Cuiaba', 'Cuiabá', 'Brasil', 'A2', 'active', true, 'adult', $2)
       returning id`,
      [ALUNO_REBRIEFING, perfil],
    )

    const dona = await val<string>(`select id from teachers where display_name = 'Teacher Vicky'`)
    const contrato = await val<string>(
      `insert into contracts
         (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
          monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
       values ('private_1on1', $1, $2, 'Personal One (bancada)', 15000, 2, 24, 90,
               (public.business_today() - interval '8 months')::date)
       returning id`,
      [aluno, dona],
    )

    // O briefing BASE, v2 e enviado pelo caminho real (valida e tabula o Kolb) —
    // é ele que a tela de atualização usa para pré-preencher as duas etapas.
    await client.query(
      `insert into briefings (student_id, schema_version, answers, kolb_answers) values ($1, 2, $2, $3)`,
      [aluno, JSON.stringify(BRIEFING_V2_DA_BANCADA), JSON.stringify(KOLB_DA_BANCADA)],
    )
    await client.query(`select public._briefing_submit($1, $2)`, [aluno, perfil])

    // O plano do semestre 2 pela RPC de produção. `set_config(..., true)` é LOCAL
    // à transação do bloco: as claims não vazam para os blocos seguintes nem para
    // a conexão.
    const adminPerfil = await val<string>(`select id from auth.users where email = 'teste-senha@local.dev'`)
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: adminPerfil, role: 'authenticated', app_metadata: { role: 'admin' } }),
    ])
    const plano = await val<string>(`select public.generate_study_plan($1)`, [contrato])
    const semestre = await val<number>(`select semester_no from study_plans where id = $1`, [plano])
    if (semestre < 2) {
      // Bancada que mente é pior que bancada vazia: sem semestre ≥ 2 o card do
      // Início não aparece, e o e2e falharia dizendo "o card sumiu" em vez de
      // "o plano nasceu no semestre errado".
      throw new Error(`plano do ${ALUNO_REBRIEFING} nasceu no semestre ${semestre} — esperado ≥ 2`)
    }
    console.log(`  ${ALUNO_REBRIEFING}: contrato de 8 meses + plano do semestre ${semestre} + briefing v2 enviado`)
  },
}

/** Roteiro de bancada: DELIBERADAMENTE longo e completo (6 cenas, legenda de 3
 *  linhas, trilha com aviso, nota extensa). O print tem de mostrar o layout sob
 *  pressão — os casos mínimos são provados nos testes de componente, não aqui.
 *  Base real: os roteiros trend aprovados pelo dono na calibração do M2. */
const ROTEIRO_BANCADA = [
  'GANCHO: Essas 4 frases vão salvar sua próxima viagem aos Estados Unidos.',
  'VARIANTES DE GANCHO:',
  '1. Você comete pelo menos um desses erros em todo restaurante americano.',
  '2. Ninguém te ensinou isso no curso de inglês: 4 frases de restaurante.',
  '3. Guarda essas 4 frases antes de pedir qualquer coisa num restaurante nos EUA.',
  '',
  'CENA 1',
  'Fala: Primeira. Você terminou de comer e quer dizer que está satisfeito. Errado: "I\'m satisfied" — não é o que um americano diria aqui. O certo é: "I\'m full, thank you." Repete comigo: I\'m full, thank you.',
  'Texto na tela: 🇧🇷 Estou satisfeito ❌ I\'m satisfied ✅ I\'m full, thank you',
  'Ação: Cabeçalho fixo no topo com numeração "01" em destaque; corte seco para cartela full-screen.',
  '',
  'CENA 2',
  'Fala: Segunda. Vocês vão dividir a conta. Errado: "the bill apart, please". O certo é: "Can we get separate checks, please?"',
  'Texto na tela: 🇧🇷 A conta separada ❌ The bill apart ✅ Can we get separate checks?',
  'Ação: Numeração muda para "02"; mesmo padrão de cartela, corte seco entre fala e cartela.',
  '',
  'CENA 3',
  'Fala: Terceira. Você chega e quer mesa pra dois. Errado: "you have table for two?" O certo é: "Do you have a table for two, please?"',
  'Texto na tela: 🇧🇷 Mesa pra dois? ❌ You have table for two? ✅ Do you have a table for two?',
  'Ação: Numeração "03"; mesmo padrão visual, ritmo idêntico às cenas anteriores.',
  '',
  'CENA 4',
  'Fala: Quarta. Sobrou comida e você quer levar. Errado: "can you wrap to take?" O certo é: "Can I get this to go, please?"',
  'Texto na tela: 🇧🇷 Embrulhar pra levar? ❌ Can you wrap to take? ✅ Can I get this to go?',
  'Ação: Numeração "04"; cartela final do bloco antes de cortar pro CTA.',
  '',
  'CENA 5',
  'Fala: Bônus, e esse quase ninguém sabe: quando o garçom pergunta "still or sparkling", ele está perguntando se você quer água sem gás ou com gás.',
  'Texto na tela: still = sem gás · sparkling = com gás',
  'Ação: Cartela dividida ao meio, cada lado entra com um corte.',
  '',
  'CENA 6',
  'Fala: E se você não entendeu nada do que ele falou, a frase que salva é: "Could you repeat that, please?"',
  'Texto na tela: ✅ Could you repeat that, please?',
  'Ação: A dona olha para a câmera, sem cartela por dois segundos, depois entra a frase.',
  '',
  'CTA',
  'Fala: Salva essas frases agora e clica no link da bio pra fazer sua aula experimental gratuita.',
  'Texto na tela: Link na bio 👆 Aula experimental gratuita',
  '',
  'LEGENDA',
  'Restaurante nos EUA não vai mais te pegar de surpresa 🇺🇸',
  'Salva esse post antes da próxima viagem e treina as frases em voz alta.',
  'Link na bio pra aula experimental gratuita.',
  '',
  'HASHTAGS: #inglês #inglesparaviagem #dicasdeingles #restauranteingles #aprenderingles',
  'DURAÇÃO-ALVO: 55s',
  'TRILHA: trilha instrumental do trend de viagem — ⚠️ usar pela biblioteca do app',
  'NOTA DE PRODUÇÃO: Manter o cabeçalho fixo com a numeração colorida do início ao fim, igual à referência — é o que sustenta a leitura rápida das cartelas. Nenhum caso de aluno foi usado: os erros são genéricos e recorrentes na língua, não histórico real de ninguém.',
].join('\n')

const conteudo: Bloco = {
  nome: 'conteúdo: voz da marca + reel em rascunho e ideia aprovada',
  feito: async () => existe(`select 1 from content_posts where external_ref like 'bancada:%'`),
  run: async () => {
    // A voz ativa é pré-requisito do gerador: sem ela a tela mostra o aviso de
    // "publique a voz" e o botão Gerar agora recusa — a bancada não representaria
    // o estado normal. INSERT direto é legítimo (a trava append-only proíbe
    // UPDATE/DELETE, não inserção); a guarda evita colidir com o índice de
    // "no máximo uma ativa".
    if (!(await existe(`select 1 from brand_voice_docs where active`))) {
      await client.query(
        `insert into brand_voice_docs (version, content_md, notes, active)
         values (coalesce((select max(version) from brand_voice_docs), 0) + 1, $1, 'bancada', true)`,
        ['# Voz da marca (bancada)\n\nDocumento de bancada — a voz real vive em brand/voice/voz-v1.md.'],
      )
    }

    const adminId = (
      await client.query(
        `select p.id from profiles p join auth.users u on u.id = p.id
          where p.role = 'admin' order by u.created_at limit 1`,
      )
    ).rows[0]?.id
    if (!adminId) {
      throw new Error('nenhum admin — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    }

    // A máquina de estados é do BANCO (Lei 3) e o guard só admite nascer em
    // 'ideia': o rascunho de bancada percorre o caminho legítimo
    // ideia → ideia_aprovada → gerando → rascunho, como um post de verdade.
    const criar = async (ref: string, tema: string, gancho: string, idea: unknown) =>
      (
        await client.query(
          `insert into content_posts (external_ref, kind, tema, gancho, idea, created_by)
           values ($1, 'roteiro_reel', $2, $3, $4, $5)
           on conflict (external_ref) do nothing
           returning id`,
          [ref, tema, gancho, JSON.stringify(idea), adminId],
        )
      ).rows[0]?.id as string | undefined

    const aprovar = async (id: string) =>
      client.query(
        `update content_posts
            set status = 'ideia_aprovada', idea_approved_by = $2, idea_approved_at = now()
          where id = $1`,
        [id, adminId],
      )

    // 1) Ideia aprovada e SEM roteiro: é o estado que mostra o "Gerar agora".
    const naFila = await criar(
      'bancada:reel-na-fila',
      'Frases que não significam o que parecem',
      'Essas frases em inglês não significam o que você está imaginando agora.',
      {
        premissa: 'Série com 2 expressões por episódio: repete a frase em inglês antes de traduzir para criar suspense.',
        de_onde_veio: "cópia do formato em série 'Frases que não significam o que parecem' da Ask Jackie",
      },
    )
    if (naFila) await aprovar(naFila)

    // 2) O rascunho do print. Tema com marca reconhecível: é por ele que o
    //    export-screens acha esta tela ({match:}), e não pelo "primeiro da lista".
    const rascunho = await criar(
      'bancada:reel-roteiro',
      'Roteiro de bancada — 4 frases no restaurante',
      'Essas 4 frases vão salvar sua próxima viagem aos Estados Unidos.',
      {
        premissa:
          'Lista numerada de situações de restaurante, cada bloco no padrão 🇧🇷 frase em português → ❌ erro comum → ✅ frase certa em inglês, repetida duas vezes.',
        de_onde_veio: "cópia fiel do formato '04 frases pra usar nos restaurantes nos EUA' da Ask Jackie",
        pergunta_a_vicky: 'Você tem alguma história de mal-entendido em restaurante durante uma viagem?',
      },
    )
    if (rascunho) {
      await aprovar(rascunho)
      // ⚠️ `- 2 days` e não `now()` (Leva 5): `generation_started_at` passou a
      // ser a REIVINDICAÇÃO que consome o teto diário de roteiros
      // (`roteiros_gerados_hoje`). Semeado com a data de hoje, o bancada nascia
      // com o teto já estourado e o botão "Gerar roteiro" do radar só sabia
      // dizer "entra na fila" — o estado que o portão visual menos precisa ver.
      // O rascunho de bancada representa trabalho de ANTEONTEM, que é a verdade.
      await client.query(
        `update content_posts set status = 'gerando', generation_started_at = now() - interval '2 days', generation_attempts = 1
          where id = $1`,
        [rascunho],
      )
      await client.query(
        `update content_posts
            set status = 'rascunho', roteiro = $2, legenda = $3, brand_voice_version = (select version from brand_voice_docs where active),
                generation_meta = $4
          where id = $1`,
        [
          rascunho,
          ROTEIRO_BANCADA,
          'Restaurante nos EUA não vai mais te pegar de surpresa 🇺🇸\nSalva esse post antes da próxima viagem.',
          JSON.stringify({ modelo: 'claude-sonnet-5', tentativa: 1, bancada: true }),
        ],
      )
    }
    console.log('  voz ativa + 1 reel na fila + 1 rascunho com roteiro completo')
  },
}


/**
 * MÉTRICAS DO RADAR (Leva 6.1) — a coorte que o painel "Como a pauta anda" mede.
 *
 * O painel virou o retrato do funil do RADAR: quanto de cada VARREDURA virou
 * roteiro, e como esses roteiros passaram no portão 2. Por isso a bancada
 * precisa de três rodadas, não de uma pilha de ideias:
 *   · duas rodadas ANTIGAS e fechadas — é o que dá veredito (a régua exige 2
 *     rodadas fechadas, e uma rodada só fecha quando a varredura seguinte já
 *     rodou);
 *   · a rodada CORRENTE aberta, com um roteiro ainda em rascunho — o estado que
 *     mostra "aberta · 1 roteiro sem decisão";
 *   · uma trend PULADA (segue `nova`) na rodada do meio: ela aparece nomeada na
 *     tabela e fica fora do denominador da conversão.
 *
 * Os pares roteiro-original × roteiro-editado são sintéticos e se anunciam como
 * tal (`bancada: true`): um reescrito a fundo e três com retoque, para a medida
 * de "% do texto trocado" ter os dois extremos. Par real ainda não existe.
 *
 * Cada post percorre o caminho legítimo da máquina de estados (Lei 3): nasce
 * ideia e sobe pelas transições que o guard admite. O conteúdo do rascunho é
 * gravado ANTES da aprovação — post aprovado tem conteúdo congelado por
 * whitelist, e escrever depois quebraria de propósito. As trends nascem `nova`
 * e são decididas por UPDATE, como o guard da 107 manda.
 */
const metricasDoRadar: Bloco = {
  nome: 'métricas: 3 rodadas do radar (2 fechadas com veredito + a corrente aberta)',
  feito: async () =>
    existe(`select 1 from content_trends where source_key like 'reel:youtube:bancada-metricas-%'`),
  run: async () => {
    const adminId = (
      await client.query(
        `select p.id from profiles p join auth.users u on u.id = p.id
          where p.role = 'admin' order by u.created_at limit 1`,
      )
    ).rows[0]?.id
    if (!adminId) {
      throw new Error('nenhum admin — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    }

    /** A rodada é a semana ISO em UTC — a régua do worker e do CHECK da 107.
     *  `now() at time zone 'UTC'` não depende do fuso da sessão. */
    const semanaDe = (diasAtras: number): Promise<string> =>
      val<string>(
        `select to_char((now() at time zone 'UTC') - make_interval(days => $1::int), 'IYYY-"W"IW')`,
        [diasAtras],
      )
    const S0 = await semanaDe(0) // corrente — aberta
    const S1 = await semanaDe(7) // fechada
    const S2 = await semanaDe(14) // fechada

    /** Um roteiro curto no formato que o serializador escreve. */
    const roteiro = (gancho: string, cenas: string[], cta: string, legenda: string): string =>
      [
        `GANCHO: ${gancho}`,
        'VARIANTES DE GANCHO:',
        '1. Ninguém te ensinou isso no curso de inglês.',
        '2. Esse detalhe entrega que você é brasileiro.',
        '3. Guarda essa antes da próxima viagem.',
        '',
        ...cenas.flatMap((fala, i) => [
          `CENA ${i + 1}`,
          `Fala: ${fala}`,
          `Texto na tela: ${fala.split(' ').slice(0, 4).join(' ')}`,
          'Ação: corte seco, cartela cheia.',
          '',
        ]),
        'CTA',
        `Fala: ${cta}`,
        'Texto na tela: Salva aí 👆',
        '',
        'LEGENDA',
        legenda,
        '',
        'HASHTAGS: #ingles #dicasdeingles #teachervicky',
        'DURAÇÃO-ALVO: 45s',
        'TRILHA: —',
        'NOTA DE PRODUÇÃO: —',
      ].join('\n')

    const CENAS_ORIGINAIS = [
      'Primeira: você quer dizer que está satisfeito e fala I am satisfied. O certo é I am full, thank you.',
      'Segunda: vocês vão dividir a conta. Diga can we get separate checks, please.',
      'Terceira: sobrou comida e você quer levar. Diga can I get this to go, please.',
    ]
    const ORIGINAL = roteiro(
      'Essas 3 frases salvam seu próximo restaurante nos EUA.',
      CENAS_ORIGINAIS,
      'Salva essa antes da viagem.',
      'Restaurante nos EUA não pega mais você de surpresa.',
    )
    const RETOQUE = roteiro(
      'Essas 3 frases salvam seu próximo restaurante nos Estados Unidos.',
      [
        CENAS_ORIGINAIS[0],
        CENAS_ORIGINAIS[1],
        'Terceira: sobrou comida e você quer levar para casa. Diga can I get this to go, please.',
      ],
      'Salva essa antes da viagem.',
      'Restaurante nos EUA não pega mais você de surpresa.',
    )
    const REESCRITO = roteiro(
      'Três phrasal verbs para não travar no aeroporto.',
      [
        'Check in é apresentar documento no balcão da companhia aérea.',
        'Take off é decolar, e não tirar a roupa como muita gente pensa.',
        'Pick up é retirar a mala na esteira depois do desembarque.',
      ],
      'Comenta qual deles você já usou errado.',
      'Aeroporto internacional pede vocabulário próprio.',
    )

    /** Research + trend do mesmo `source_key` — o guard da 107 exige o par. */
    const trendDeBancada = async (n: number, semana: string, nota: number): Promise<string> => {
      const sourceKey = `reel:youtube:bancada-metricas-${n}`
      const researchId = await val<string>(
        `select id from public.record_content_research($1, $2, $3, $4, $5, null, $6, $7, null)`,
        [
          'analise_reel',
          'youtube',
          sourceKey,
          JSON.stringify({
            analise: { gancho: { texto_falado: 'Erro que todo brasileiro comete.', tipo: 'erro comum', segundos_ate_o_ponto: 2 } },
            transcricao: { texto: '[0:00] Stop saying…', via: 'gemini-url' },
            autor: 'English in Brazil',
            duracao_s: 41,
            bancada: true,
          }),
          JSON.stringify({ views: 90_000 + n * 3_100 }),
          `Trend de bancada ${n} (${semana})`,
          `https://www.youtube.com/shorts/bancaMetricas${n}`,
        ],
      )
      return val<string>(
        `insert into content_trends
           (research_id, source_key, plataforma, url, autor, views, velocidade,
            velocidade_sem_conta, semana, travel_score, travel_meta)
         values ($1, $2, 'youtube', $3, 'English in Brazil', $4, $5, false, $6, $7, $8)
         returning id`,
        [
          researchId,
          sourceKey,
          `https://www.youtube.com/shorts/bancaMetricas${n}`,
          90_000 + n * 3_100,
          2 + (n % 4) * 0.6,
          semana,
          nota,
          JSON.stringify({
            justificativa: 'nota de bancada',
            prompt_versao: 1,
            modelo: 'claude-haiku-4-5',
            avaliado_em: now.toISO(),
          }),
        ],
      )
    }

    const decidir = (id: string, status: 'descartada' | 'roteirizada', motivo?: string) =>
      client.query(
        `update content_trends
            set status = $2, discard_reason = $3, decidida_por = $4, decidida_em = now()
          where id = $1`,
        [id, status, motivo ?? null, adminId],
      )

    /** O roteiro nascido da trend, no caminho da máquina de estados. */
    const roteiroDaTrend = async (p: {
      trendId: string
      n: number
      contexto: 'geral' | 'travel'
      tema: string
      editado: string
      desfecho: 'aprovado' | 'rejeitado' | 'rascunho'
    }): Promise<void> => {
      const id = await val<string>(
        `insert into content_posts (external_ref, kind, tema, gancho, idea, trend_id, contexto)
         values ($1, 'roteiro_reel', $2, $3, $4, $5, $6)
         returning id`,
        [
          `trend:${p.trendId}:${p.contexto}:1`,
          p.tema,
          'Você diz isso achando que está certo — e não está.',
          JSON.stringify({
            premissa: 'Bloco de três situações, cada uma no padrão erro → frase certa.',
            de_onde_veio: `Cópia de "Trend de bancada ${p.n}" no YouTube · https://www.youtube.com/shorts/bancaMetricas${p.n}`,
            pilar: 3,
            bancada: true,
          }),
          p.trendId,
          p.contexto,
        ],
      )
      await client.query(
        `update content_posts
            set status = 'ideia_aprovada', idea_approved_by = $2, idea_approved_at = now()
          where id = $1`,
        [id, adminId],
      )
      await client.query(
        `update content_posts
            set status = 'gerando', generation_started_at = now() - interval '2 days',
                generation_attempts = 1
          where id = $1`,
        [id],
      )
      await client.query(
        `update content_posts
            set status = 'rascunho', roteiro = $2, legenda = $3,
                brand_voice_version = (select version from brand_voice_docs where active),
                generation_meta = $4
          where id = $1`,
        [
          id,
          p.editado,
          'Legenda de bancada para o roteiro do radar.',
          JSON.stringify({
            modelo: 'claude-sonnet-5',
            prompt_versao: 1,
            tentativa: 1,
            bancada: true,
            contexto: p.contexto,
            roteiro_original: ORIGINAL,
          }),
        ],
      )
      if (p.desfecho === 'aprovado') {
        await client.query(
          `update content_posts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1`,
          [id, adminId],
        )
      } else if (p.desfecho === 'rejeitado') {
        await client.query(
          `update content_posts set status = 'rejeitado', rejection_reason = $2 where id = $1`,
          [id, 'gancho fraco para o público de viagem'],
        )
      }
    }

    // ── S2 (fechada): 4 trends · 3 roteirizadas · 1 descartada ──────────────
    //    Portão 2: 2 aprovados (1 com reescrita pesada) + 1 recusado.
    const s2 = [
      await trendDeBancada(1, S2, 84),
      await trendDeBancada(2, S2, 71),
      await trendDeBancada(3, S2, 63),
      await trendDeBancada(4, S2, 22),
    ]
    await decidir(s2[3], 'descartada', 'assunto não é de viagem — não serve ao programa')
    for (const id of s2.slice(0, 3)) await decidir(id, 'roteirizada')
    await roteiroDaTrend({ trendId: s2[0], n: 1, contexto: 'travel', tema: 'Frases de restaurante que ninguém ensina', editado: RETOQUE, desfecho: 'aprovado' })
    await roteiroDaTrend({ trendId: s2[1], n: 2, contexto: 'geral', tema: 'O erro que entrega o brasileiro no aeroporto', editado: REESCRITO, desfecho: 'aprovado' })
    await roteiroDaTrend({ trendId: s2[2], n: 3, contexto: 'geral', tema: 'Três jeitos de pedir a conta', editado: RETOQUE, desfecho: 'rejeitado' })

    // ── S1 (fechada): 3 trends · 2 roteirizadas · 1 PULADA (segue nova) ─────
    const s1 = [await trendDeBancada(5, S1, 78), await trendDeBancada(6, S1, 66), await trendDeBancada(7, S1, 58)]
    for (const id of s1.slice(0, 2)) await decidir(id, 'roteirizada')
    await roteiroDaTrend({ trendId: s1[0], n: 5, contexto: 'travel', tema: 'Check-in sem gaguejar', editado: RETOQUE, desfecho: 'aprovado' })
    await roteiroDaTrend({ trendId: s1[1], n: 6, contexto: 'geral', tema: 'Small talk de elevador', editado: RETOQUE, desfecho: 'aprovado' })

    // ── S0 (corrente, ABERTA): 1 roteirizada com o roteiro ainda em rascunho ─
    const s0 = await trendDeBancada(8, S0, 81)
    await decidir(s0, 'roteirizada')
    await roteiroDaTrend({ trendId: s0, n: 8, contexto: 'travel', tema: 'Como pedir ajuda no aeroporto', editado: RETOQUE, desfecho: 'rascunho' })

    console.log(`  3 rodadas (${S2} · ${S1} fechadas · ${S0} aberta) · 8 trends · 6 roteiros no portão 2`)
  },
}

/**
 * PAUTA (M4) — os criadores de referência nos QUATRO estados que a tela desenha,
 * porque um print só prova o que ele mostra:
 *   · ativo COM medição (o normal, depois de uma corrida do worker);
 *   · ativo SEM medição nenhuma (acabou de ser cadastrado);
 *   · ativo medido e VAZIO — "o robô passou e não achou nada". O caso não é
 *     hipótese: Speak English With Vanessa foi medida no spike M2.0 e não tinha
 *     UM Short ≤90s em 100 uploads. É o estado que o check `medicao_shape`
 *     existe para deixar representável;
 *   · desativado (sai da corrida sem sair do histórico — DELETE é proibido).
 *
 * Os quatro nomes reais são os que o dono escolheu para o spike. O desativado é
 * fictício e se anuncia como tal: desligar um canal real na bancada contaria uma
 * decisão editorial que ninguém tomou.
 *
 * Escreve como OWNER (conexão direta): os grants de coluna que separam a mão da
 * admin da mão do robô valem para PostgREST, e é por isso que a medição aqui
 * pode ir junto do cadastro. Quem prova aqueles grants é `pauta-fabrica.test.ts`.
 */
const pauta: Bloco = {
  nome: 'pauta: criadores de referência (medido, sem medição, vazio e desativado)',
  // O sentinela é o ÚLTIMO criador que o bloco escreve, não o primeiro: com o
  // primeiro, acrescentar um nome à lista nunca mais rodava (o bloco se dava
  // por pronto). Como os inserts são `on conflict do nothing`, reexecutar é de
  // graça e completa o que faltar.
  feito: async () => existe(`select 1 from content_creators where handle = 'canal.de.bancada'`),
  run: async () => {
    const adminId = (
      await client.query(
        `select p.id from profiles p join auth.users u on u.id = p.id
          where p.role = 'admin' order by u.created_at limit 1`,
      )
    ).rows[0]?.id
    if (!adminId) {
      throw new Error('nenhum admin — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    }

    const criar = async (
      plataforma: string,
      handle: string,
      nome: string,
      pais: string,
      notas: string | null,
      ativo = true,
    ): Promise<string> => {
      // `do nothing` + releitura: o bloco reexecuta sem explodir no índice
      // único quando um handle já está cadastrado (o worker do M5 roda contra
      // esta mesma bancada, e reset nem sempre precede a corrida).
      await client.query(
        `insert into content_creators (plataforma, handle, nome, pais, notas, ativo, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (plataforma, lower(handle)) do nothing`,
        [plataforma, handle, nome, pais, notas, ativo, adminId],
      )
      return val<string>(
        `select id from content_creators where plataforma = $1 and lower(handle) = lower($2)`,
        [plataforma, handle],
      )
    }

    const medir = async (id: string, metricas: unknown) =>
      client.query(
        `update content_creators set metricas = $2, medido_em = now() - interval '2 days' where id = $1`,
        [id, JSON.stringify(metricas)],
      )

    const carina = await criar(
      // Handle REAL conferido na YouTube API (`triagem-candidatos.ts`): o canal
      // dela resolve por `carinafragozo`, não por `englishinbrazil`. Handle que
      // não resolve é criador que o worker do M5 nunca acha.
      'youtube', 'carinafragozo', 'English in Brazil (Carina Fragozo)', 'BR',
      'Abre explicando o erro antes de ensinar a forma certa; cartelas curtas o vídeo inteiro.',
    )
    // Chaves de UMA palavra, e é régua e não estilo: a tela mostra a chave como
    // ela é (ver `resumirMedicao`), então nome de métrica com `_` apareceria cru
    // na cara da dona. O M5 herda esta régua ao nomear o payload.
    await medir(carina, { shorts: 5, views: 128_400 })

    const jackie = await criar(
      'youtube', 'askjackie', 'Ask Jackie', 'INT',
      'Pergunta do seguidor como gancho — o título é a dúvida, não o tema.',
    )
    await medir(jackie, { shorts: 5, views: 96_100 })

    // Cadastrado e ainda não visitado pelo worker: métricas e data ficam "—".
    await criar(
      'youtube', 'englishwithlucy', 'English with Lucy', 'INT',
      'Ritmo lento e dicção muito clara; usa a tela inteira para uma palavra só.',
    )

    // OS OUTROS QUATRO DOS 7 APROVADOS pelo dono no gate do M4 (01/08), todos
    // com handle MEDIDO na YouTube API antes de virarem proposta. A bancada
    // espelha o cadastro de produção porque é contra ela que o worker do M5
    // roda a corrida do gate — bancada com cadastro diferente ensaiaria outra
    // peça.
    await criar(
      'youtube', 'mairovergara', 'Mairo Vergara', 'BR',
      'O canal BR com mais curtos recentes na triagem (30 em 90 dias).',
    )
    await criar(
      'youtube', 'LearnEnglishWithTVSeries', 'Learn English With TV Series', 'INT',
      'Cena de série como insumo — o vídeo de referência é sempre alheio.',
    )
    await criar(
      'youtube', 'rachelsenglish', "Rachel's English", 'INT',
      'Pronúncia em close, boca em quadro; o rosto É o material didático.',
    )
    await criar(
      'youtube', 'bbclearningenglish', 'BBC Learning English', 'INT',
      'Institucional: formato limpo, sem persona forte — contraponto aos criadores.',
    )

    // O CASO VANESSA: medido, sem nada encontrado (canal de vídeo longo).
    const vanessa = await criar(
      'youtube', 'speakenglishwithvanessa', 'Speak English With Vanessa', 'INT',
      'Canal de vídeo LONGO — o spike não achou Short nenhum. Fica para observar formato, não para copiar reel.',
    )
    await medir(vanessa, {})

    // A MESMA PESSOA EM OUTRA REDE (aprovado pelo dono no M5, 01/08): a Carina
    // já está aqui pelo YouTube, e o @ do Instagram dela é outro — é o caso que
    // o índice único do M4 previu (unique por plataforma+handle, não por
    // pessoa). Existe para que o caminho de PERFIL do Instagram tenha corrida
    // real: o ator de reels devolve vídeo com views, e é dele que sai a
    // transcrição que o Gemini analisa.
    await criar(
      'instagram', 'englishinbrazil', 'English in Brazil (Instagram)', 'BR',
      'Mesma professora do canal do YouTube; no Instagram o formato é reel curto.',
    )

    // OS 10 DE INSTAGRAM escolhidos pelo dono (01/08), TODOS medidos antes de
    // entrar (régua do M4): os 10 resolvem no ator de reels, 5/5 reels cada.
    // Mercado confirmado pelo dono ("nick the teacher - internacional, o resto
    // está correto" sobre a proposta por língua de legenda). Nome é derivado do
    // handle — a admin renomeia na ficha se quiser; nota fica vazia de
    // propósito (nada de editorial inventado).
    const DEZ_DO_INSTAGRAM: Array<[string, string, string]> = [
      ['teacherdosfamosos', 'Teacher dos Famosos', 'BR'],
      ['eusoutiagorocha', 'Tiago Rocha', 'BR'],
      ['teacherdavid', 'Teacher David', 'BR'],
      ['teacherpaulagabriela', 'Teacher Paula Gabriela', 'BR'],
      ['nick_the_teacher', 'Nick the Teacher', 'INT'],
      ['englishbygiovana', 'English by Giovana', 'INT'],
      ['speakeasymatyas', 'Speakeasy Matyas', 'INT'],
      ['ariannitalagringa', 'Arianni La Gringa', 'INT'],
      ['teacher.aliona', 'Teacher Aliona', 'INT'],
      ['instantenglishuk', 'Instant English UK', 'INT'],
    ]
    for (const [handle, nome, pais] of DEZ_DO_INSTAGRAM) {
      await criar('instagram', handle, nome, pais, null)
    }

    await criar(
      'instagram', 'canal.de.bancada', 'Canal de bancada (parado)', 'BR',
      'Exemplo de bancada: saiu da pauta e continua no histórico.',
      false,
    )
  },
}

/**
 * RADAR (Leva 3) — trends de bancada nos ESTADOS que a tela desenha, porque um
 * print só prova o que ele mostra:
 *   · raiz YouTube com dissecação completa, criador cadastrado e velocidade
 *     normalizada (o cartão cheio — é o 1º do deck pela ordem fixa);
 *   · variação NOVA pendurada nela (o aviso de cascata no descarte);
 *   · raiz de bundle (Reddit, `tipo='trends'`): sem dissecação, sem views —
 *     os NULLs honestos e o cartão-link;
 *   · variação ÓRFÃ (mãe roteirizada) com autor fora da pauta e velocidade
 *     sem a régua da conta;
 *   · uma descartada com motivo e uma roteirizada (a Vista Todos da 3.2 e o
 *     histórico).
 *
 * Escreve como OWNER: research entra pela RPC `record_content_research` (DML
 * direto é negado até ao dono — a porta é a função); as trends entram por
 * INSERT direto (o guard da 107 exige research ATIVO com o MESMO source_key —
 * satisfeito aqui). Decidida nasce em DOIS tempos (INSERT nova → UPDATE), como
 * o guard manda: trend nasce nova, decidir é transição.
 */
const radar: Bloco = {
  nome: 'radar: trends de bancada (cheia, variação, bundle, órfã, descartada, roteirizada)',
  feito: async () =>
    existe(`select 1 from content_trends where source_key = 'reel:youtube:bancada-radar-1'`),
  run: async () => {
    const adminId = (
      await client.query(
        `select p.id from profiles p join auth.users u on u.id = p.id
          where p.role = 'admin' order by u.created_at limit 1`,
      )
    ).rows[0]?.id
    if (!adminId) {
      throw new Error('nenhum admin — rode `node --env-file=.env.local scripts/preview-logins.ts` antes')
    }
    // A semana da rodada é ISO **UTC** (a régua do worker e do CHECK da 107).
    await client.query(`set local time zone 'UTC'`)
    const semana = await val<string>(`select to_char(now(), 'IYYY-"W"IW')`)

    const criadorId = async (plataforma: string, handle: string): Promise<string | null> =>
      (
        await client.query(
          `select id from content_creators where plataforma = $1 and lower(handle) = lower($2)`,
          [plataforma, handle],
        )
      ).rows[0]?.id ?? null

    const research = async (p: {
      tipo: 'analise_reel' | 'trends'
      plataforma: string
      sourceKey: string
      payload: Record<string, unknown>
      metricas?: Record<string, unknown>
      creatorId?: string | null
      titulo?: string
      url?: string
      publicadoDiasAtras?: number
    }): Promise<string> =>
      val<string>(
        `select id from public.record_content_research($1, $2, $3, $4, $5, $6, $7, $8,
           case when $9::int is null then null else now() - make_interval(days => $9::int) end)`,
        [
          p.tipo,
          p.plataforma,
          p.sourceKey,
          JSON.stringify(p.payload),
          JSON.stringify(p.metricas ?? {}),
          p.creatorId ?? null,
          p.titulo ?? null,
          p.url ?? null,
          p.publicadoDiasAtras ?? null,
        ],
      )

    /** Uma dissecação no shape do worker (`AnaliseSchema`), curta mas completa. */
    const analise = (gancho: string, tema: string) => ({
      gancho: { texto_falado: gancho, tipo: 'erro comum', segundos_ate_o_ponto: 2 },
      beats: [
        { ordem: 1, funcao: 'gancho', resumo: 'Abre com o erro dito como se fosse normal.', frase_chave: gancho },
        { ordem: 2, funcao: 'desenvolvimento', resumo: `Mostra o certo: ${tema}.`, frase_chave: '' },
        { ordem: 3, funcao: 'demonstracao', resumo: 'Repete em situação real, com legenda.', frase_chave: '' },
        { ordem: 4, funcao: 'cta', resumo: 'Pede o salvar antes da próxima viagem.', frase_chave: 'Salva pra não errar.' },
      ],
      texto_na_tela: { cartelas: ['I HAVE 25 YEARS ❌', 'I AM 25 ✅', 'TO BE = idade'], padrao: 'cartela cheia a cada virada' },
      ingles_na_fala: { modo: 'frases-alvo em inglês, explicação em PT', detalhe: 'frase-alvo repetida 2×' },
      cta: { texto: 'Salva pra não errar na próxima viagem.', posicao: 'fim', tipo: 'salvar' },
      duracao_e_ritmo: '38s, corte a cada 3–4s',
      por_que_performou: [
        'Erro que todo brasileiro comete — identificação imediata.',
        'Correção em 3 segundos: dá para assistir até o fim sem custo.',
        'Cartela final resume a regra — dá vontade de salvar.',
      ],
      copia: { pilar: 3, como_copiar: 'Mesmo molde erro→certo com frase de viagem: uma situação, uma correção, uma cartela-resumo.', trilha: { protegida: false, qual: 'som original' } },
      avisos: [],
    })

    const carina = await criadorId('youtube', 'carinafragozo')
    const jackie = await criadorId('youtube', 'askjackie')

    const trend = async (p: {
      researchId: string
      sourceKey: string
      plataforma: string
      url: string | null
      autor: string | null
      views: number | null
      velocidade: number | null
      semConta?: boolean
      travelScore?: number | null
      variacaoDe?: string | null
    }): Promise<string> =>
      val<string>(
        `insert into content_trends
           (research_id, source_key, plataforma, url, autor, views, velocidade,
            velocidade_sem_conta, semana, travel_score, travel_meta, variacao_de)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          p.researchId,
          p.sourceKey,
          p.plataforma,
          p.url,
          p.autor,
          p.views,
          p.velocidade,
          p.semConta ?? false,
          semana,
          p.travelScore ?? null,
          p.travelScore != null
            ? JSON.stringify({ justificativa: 'nota de bancada', prompt_versao: 1, modelo: 'claude-haiku-4-5', avaliado_em: now.toISO() })
            : JSON.stringify({}),
          p.variacaoDe ?? null,
        ],
      )

    const decidir = (id: string, status: 'descartada' | 'roteirizada', motivo?: string) =>
      client.query(
        `update content_trends
            set status = $2, discard_reason = $3, decidida_por = $4, decidida_em = now()
          where id = $1`,
        [id, status, motivo ?? null, adminId],
      )

    // A — o cartão cheio (1º do deck: velocidade mais alta da rodada).
    const rA = await research({
      tipo: 'analise_reel', plataforma: 'youtube', sourceKey: 'reel:youtube:bancada-radar-1',
      payload: {
        analise: analise('Stop saying I HAVE 25 years — não é assim que se fala idade.', 'I am 25, o verbo é TO BE'),
        transcricao: { texto: '[0:00] Stop saying I have 25 years… [0:05] In English, age uses TO BE…', via: 'gemini-url' },
        autor: 'English in Brazil',
        duracao_s: 38,
      },
      metricas: { views: 128_400, likes: 9_100 },
      creatorId: carina,
      titulo: 'A idade em inglês NÃO usa have',
      url: 'https://www.youtube.com/shorts/bancaRadar1',
      publicadoDiasAtras: 10,
    })
    const tA = await trend({
      researchId: rA, sourceKey: 'reel:youtube:bancada-radar-1', plataforma: 'youtube',
      url: 'https://www.youtube.com/shorts/bancaRadar1', autor: 'English in Brazil',
      views: 128_400, velocidade: 4.2, travelScore: 82,
    })

    // B — variação NOVA pendurada na A (o aviso de cascata no descarte).
    const rB = await research({
      tipo: 'analise_reel', plataforma: 'youtube', sourceKey: 'reel:youtube:bancada-radar-2',
      payload: {
        analise: analise('How old are you? E você responde… I have?', 'to be para idade'),
        transcricao: { texto: '[0:00] How old are you?…', via: 'gemini-url' },
        autor: 'Ask Jackie',
        duracao_s: 41,
      },
      metricas: { views: 61_000 },
      creatorId: jackie,
      titulo: 'Age in English — the mistake everyone makes',
      url: 'https://www.youtube.com/shorts/bancaRadar2',
      publicadoDiasAtras: 8,
    })
    await trend({
      researchId: rB, sourceKey: 'reel:youtube:bancada-radar-2', plataforma: 'youtube',
      url: 'https://www.youtube.com/shorts/bancaRadar2', autor: 'Ask Jackie',
      views: 61_000, velocidade: 2.0, travelScore: 78, variacaoDe: tA,
    })

    // C — bundle de trends (Reddit): sem dissecação, sem views — NULLs honestos.
    const rC = await research({
      tipo: 'trends', plataforma: 'reddit', sourceKey: 'trends:reddit:bancada-radar',
      payload: { semana, assuntos: ['gírias que dão errado em viagem', 'falsos cognatos de aeroporto'] },
      url: 'https://www.reddit.com/r/EnglishLearning/',
      titulo: 'Trends do Reddit — bancada',
    })
    await trend({
      researchId: rC, sourceKey: 'trends:reddit:bancada-radar', plataforma: 'reddit',
      url: 'https://www.reddit.com/r/EnglishLearning/', autor: null,
      views: null, velocidade: null, travelScore: null,
    })

    // D — descartada com motivo (Vista Todos / histórico).
    const rD = await research({
      tipo: 'analise_reel', plataforma: 'youtube', sourceKey: 'reel:youtube:bancada-radar-3',
      payload: {
        analise: analise('POV: você no drive-thru americano.', 'pedidos no imperativo educado'),
        transcricao: { texto: '[0:00] POV…', via: 'whisper' },
        autor: 'Random Skits',
        duracao_s: 22,
      },
      metricas: { views: 15_300 },
      titulo: 'Drive-thru POV',
      url: 'https://www.youtube.com/shorts/bancaRadar3',
      publicadoDiasAtras: 12,
    })
    const tD = await trend({
      researchId: rD, sourceKey: 'reel:youtube:bancada-radar-3', plataforma: 'youtube',
      url: 'https://www.youtube.com/shorts/bancaRadar3', autor: 'Random Skits',
      views: 15_300, velocidade: 0.8, travelScore: 45,
    })
    await decidir(tD, 'descartada', 'humor genérico sem inglês — fora do público da dona')

    // E — roteirizada (decidida; a mãe da órfã F).
    const rE = await research({
      tipo: 'analise_reel', plataforma: 'youtube', sourceKey: 'reel:youtube:bancada-radar-4',
      payload: {
        analise: analise('Você NÃO precisa do gerúndio aqui.', 'presente simples em pedidos'),
        transcricao: { texto: '[0:00] Você não precisa…', via: 'gemini-url' },
        autor: 'English in Brazil',
        duracao_s: 35,
      },
      metricas: { views: 240_000 },
      creatorId: carina,
      titulo: 'O gerúndio que não existe em inglês',
      url: 'https://www.youtube.com/shorts/bancaRadar4',
      publicadoDiasAtras: 6,
    })
    const tE = await trend({
      researchId: rE, sourceKey: 'reel:youtube:bancada-radar-4', plataforma: 'youtube',
      url: 'https://www.youtube.com/shorts/bancaRadar4', autor: 'English in Brazil',
      views: 240_000, velocidade: 6.1, travelScore: 75,
    })

    // F — variação da E com autor FORA da pauta e velocidade sem a régua da
    // conta. Nasce antes da decisão da mãe (nova sob mãe nova é sempre válido);
    // quando a E vira roteirizada, a F fica órfã no deck.
    const rF = await research({
      tipo: 'analise_reel', plataforma: 'instagram', sourceKey: 'reel:instagram:bancada-radar-5',
      payload: {
        analise: analise('Para de traduzir "estou precisando".', 'I need, sem gerúndio'),
        transcricao: { texto: '[0:00] Para de traduzir…', via: 'gemini-arquivo' },
        autor: 'gringa.no.brasil',
        duracao_s: 29,
      },
      metricas: { views: 33_000 },
      titulo: 'I am needing não existe',
      url: 'https://www.instagram.com/reel/bancadaRadar5/',
      publicadoDiasAtras: 5,
    })
    await trend({
      researchId: rF, sourceKey: 'reel:instagram:bancada-radar-5', plataforma: 'instagram',
      url: 'https://www.instagram.com/reel/bancadaRadar5/', autor: 'gringa.no.brasil',
      views: 33_000, velocidade: 6_600, semConta: true, travelScore: 71, variacaoDe: tE,
    })
    await decidir(tE, 'roteirizada')

    console.log('  6 trends de bancada (cheia, variação, bundle, órfã, descartada, roteirizada)')
  },
}

// Onda Financeiro · F2: mensalidade cadastrada (o previsto v3 lê DELA). Na
// bancada, o valor nasce da conta clássica "aulas semanais × valor da aula ×
// 4"; contrato sem horário fixo fica SEM mensalidade de propósito — é o estado
// "não cadastrada" que a lista do gate mostra.
const mensalidades: Bloco = {
  nome: 'mensalidades dos contratos (previsto v3)',
  feito: async () =>
    !(await existe(`select 1 from contracts c
                     where c.contract_type = 'private_1on1' and c.status <> 'ended'
                       and c.monthly_value_cents is null
                       and exists (select 1 from recurring_slots rs
                                    where rs.contract_id = c.id and rs.active_to is null)`)),
  run: async () => {
    await client.query(`
      update contracts c
         set monthly_value_cents = sub.mensal
        from (select rs.contract_id,
                     4 * sum(round(ct.hourly_rate_cents * rs.duration_min / 60.0))::int as mensal
                from recurring_slots rs
                join contracts ct on ct.id = rs.contract_id
               where rs.active_to is null
               group by rs.contract_id) sub
       where sub.contract_id = c.id
         and c.contract_type = 'private_1on1'
         and c.monthly_value_cents is null`)
    console.log('  mensalidade = aulas semanais × valor da aula × 4 (sem horário fixo → sem mensalidade)')
  },
}

// F5 (Onda Financeiro): a aula extra COBRÁVEL do portão visual — amanhã, da
// Sabrina, R$ 150, sem pagamento. O pagador-self da Sabrina ganha o cadastro
// REAL do sandbox (cus_ do gate F0) para o "Cobrar no Asaas" do balão emitir
// uma cobrança de verdade no portão (BOLETO; PIX é indisponível no sandbox).
const avulsaParaCobrar: Bloco = {
  nome: 'aula avulsa para cobrar (F5)',
  feito: async () => existe(`select 1 from class_instances where local_time_snapshot = 'bancada-avulsa-f5'`),
  run: async () => {
    const sabrina = await acharAluno('Sabrina')
    const contrato = await client.query(
      `select id, teacher_id from contracts where student_id = $1 and contract_type = 'private_1on1'`,
      [sabrina],
    )
    // o payer-self da bancada assume o customer REAL do sandbox
    await client.query(
      `update payers set asaas_customer_id = 'cus_000008597483'
        where asaas_customer_id = 'bancada-cus-1'`,
    )
    const inicio = now.plus({ days: 1 }).set({ hour: 15, minute: 0, second: 0, millisecond: 0 })
    await client.query(
      `insert into class_instances
         (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
          state, single_kind, single_price_cents)
       values ($1, $2, $3, $4, 'bancada-avulsa-f5', 'scheduled', 'extra_paid', 15000)`,
      [
        contrato.rows[0].id,
        contrato.rows[0].teacher_id,
        inicio.toUTC().toISO(),
        inicio.plus({ minutes: 50 }).toUTC().toISO(),
      ],
    )
    console.log('  1 extra cobrável amanhã 15:00 (Sabrina, R$ 150, pagador-self com cus real do sandbox)')
  },
}

const BLOCOS: Bloco[] = [
  cadastro, mentoria, sessoes, pendencias, creditos,
  pagamentos, avulsaParaCobrar, relatorios, extrato, assinaturas, avisos,
  aulasDeHoje, snapshotsDeKpi, conteudo, pauta, metricasDoRadar, radar,
  // POR ÚLTIMO, e de propósito: estes dois blocos criam alunos ATIVOS novos, e os
  // fechamentos de KPI acima contam alunos ativos. Semeá-los antes faria o
  // snapshot do dia nascer com alunos de bancada que não existiam quando a
  // fórmula foi capturada.
  portalDoAluno,
  reBriefing,
  // Depois de TODOS os contratos existirem (inclui os dois blocos acima).
  mensalidades,
]

/* -------------------------------------------------------------------- main */

async function main() {
  await client.connect()

  const pulados: string[] = []
  const falhos: string[] = []

  for (const bloco of BLOCOS) {
    try {
      // A guarda é leitura pura — fica FORA da transação de propósito, para um
      // bloco já pronto não abrir transação nenhuma.
      if (await bloco.feito()) {
        pulados.push(bloco.nome)
        console.log(`— ${bloco.nome}: já semeado`)
        continue
      }
    } catch (err) {
      falhos.push(bloco.nome)
      console.error(`✖ ${bloco.nome} (guarda): ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    // Tudo ou nada: o bloco não tem estado intermediário observável.
    await client.query('begin')
    try {
      await bloco.run()
      await client.query('commit')
      console.log(`✔ ${bloco.nome}`)
    } catch (err) {
      // O rollback pode falhar por si (conexão morta); nesse caso o erro
      // original é o que interessa relatar.
      await client.query('rollback').catch(() => {})
      falhos.push(bloco.nome)
      console.error(`✖ ${bloco.nome}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`  (desfeito — nada deste bloco ficou no banco)`)
    }
  }

  console.log(
    `\nbancada: ${BLOCOS.length - pulados.length - falhos.length} semeados, ` +
      `${pulados.length} já prontos, ${falhos.length} com falha`,
  )
  if (falhos.length) {
    console.error(`blocos com falha: ${falhos.join(', ')}`)
    console.error('corrija e rode de novo — os blocos prontos são pulados.')
    process.exitCode = 1
    return
  }
  console.log('bancada completa ✔')
}

main()
  .catch((err) => {
    console.error('preview-seed falhou:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
