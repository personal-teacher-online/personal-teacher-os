// MCP server do app (Fase 4, handoff §5 — pinos INVIOLÁVEIS do CLAUDE.md):
// custom e FINO; tools WHITELISTED com SQL FIXO e parametrizado (nada de SQL
// arbitrário); conexão com usuário Postgres DEDICADO de permissão mínima
// (role ptos_mcp_ro — migration 20260715000700; o LOGIN é criado no runbook §N
// e entra por DATABASE_URL_MCP). PROIBIDO service_role — este processo nem
// conhece as chaves do Supabase.
//
// Uso (stdio): DATABASE_URL_MCP=postgres://ptos_mcp:...@host:5432/postgres \
//   node mcp/server.ts
// Registrar no Claude Code: claude mcp add personal-teacher-os -- node mcp/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import pg from 'pg'
import { z } from 'zod'

const url = process.env.DATABASE_URL_MCP
if (!url) {
  console.error('DATABASE_URL_MCP ausente (usuário ptos_mcp — runbook §N)')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: url, max: 3 })
// BYPASSRLS não é herdado por membership (painel 14/07/2026): assumimos o
// GRUPO em cada conexão — o atributo do role ptos_mcp_ro passa a valer e o
// confinamento continua sendo o GRANT da whitelist.
pool.on('connect', (client) => {
  client.query('set role ptos_mcp_ro').catch((err) => {
    console.error('set role ptos_mcp_ro falhou:', String(err))
  })
})

const server = new McpServer({ name: 'personal-teacher-os', version: '1.0.0' })

function ok(rows: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
}

server.tool(
  'agenda_do_dia',
  'Aulas de um dia (fuso do negócio, America/Cuiaba). Sem data = hoje.',
  { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  async ({ date }) => {
    const { rows } = await pool.query(
      `select ci.starts_at_utc at time zone 'America/Cuiaba' as hora_cuiaba,
              coalesce(s.display_name, g.label, '—') as aluno,
              t.display_name as professora,
              ci.state, ci.local_time_snapshot
         from class_instances ci
         join contracts c on c.id = ci.contract_id
         left join students s on s.id = c.student_id
         left join student_groups g on g.id = c.student_group_id
         join teachers t on t.id = ci.teacher_id
        where (ci.starts_at_utc at time zone 'America/Cuiaba')::date =
              coalesce($1::date, (now() at time zone 'America/Cuiaba')::date)
        order by ci.starts_at_utc`,
      [date ?? null],
    )
    return ok(rows)
  },
)

server.tool(
  'ficha_aluno',
  'Contratos, saldo de créditos e próximas aulas de um aluno (busca por nome).',
  { nome: z.string().min(2) },
  async ({ nome }) => {
    const { rows: alunos } = await pool.query(
      `select id, display_name, iana_tz from students where display_name ilike '%' || $1 || '%' limit 5`,
      [nome],
    )
    const out = []
    for (const a of alunos) {
      const { rows: contratos } = await pool.query(
        `select c.id, c.contract_type, c.plan_name, c.status,
                case when c.contract_type = 'private_1on1'
                     then public.makeup_balance(c.id) end as creditos
           from contracts c where c.student_id = $1`,
        [a.id],
      )
      const { rows: proximas } = await pool.query(
        `select ci.local_time_snapshot, ci.state
           from class_instances ci
           join contracts c on c.id = ci.contract_id
          where c.student_id = $1 and ci.starts_at_utc > now() and ci.state = 'scheduled'
          order by ci.starts_at_utc limit 5`,
        [a.id],
      )
      out.push({ aluno: a, contratos, proximas })
    }
    return ok(out)
  },
)

server.tool(
  'pagamentos_em_aberto',
  'Espelho Asaas: pagamentos não pagos, com vencidos destacados.',
  {},
  async () => {
    const { rows } = await pool.query(
      `select coalesce(s.display_name, g.label) as aluno, p.reference_ym,
              p.amount_cents, p.due_date, p.status,
              (p.paid_at is null and lower(coalesce(p.status,'')) not in
               ('received','confirmed','received_in_cash')
               and p.due_date < (now() at time zone 'America/Cuiaba')::date) as vencida
         from payments p
         left join contracts c on c.id = p.contract_id
         left join students s on s.id = c.student_id
         left join student_groups g on g.id = c.student_group_id
        where p.paid_at is null
          and lower(coalesce(p.status,'')) not in ('received','confirmed','received_in_cash')
        order by p.due_date`,
    )
    return ok(rows)
  },
)

server.tool(
  'avisos_presos',
  'Fila de notificações com erro aguardando ação (outbox).',
  {},
  async () => {
    const { rows } = await pool.query(
      `select template, channel, payload, error, created_at
         from notification_outbox
        where sent_at is null and error is not null
        order by created_at desc limit 50`,
    )
    return ok(rows)
  },
)

server.tool(
  'mentoria_status',
  'Programa Personal Travel: progresso, janelas destravadas e elegibilidade por mentorado.',
  {},
  async () => {
    const { rows } = await pool.query(
      `select s.display_name as aluno, mc.course_start_date, mc.total_credits,
              cp.completion_pct,
              public.mentorship_windows_unlocked(mc.contract_id) as destravadas,
              public.mentorship_can_book(mc.contract_id) as pode_reservar
         from mentorship_contracts mc
         join contracts c on c.id = mc.contract_id
         join students s on s.id = c.student_id
         left join course_progress cp on cp.contract_id = mc.contract_id
        where c.status = 'active'
        order by s.display_name`,
    )
    return ok(rows)
  },
)

server.tool(
  'extratos_professora',
  'Extratos (horas auditadas × valor) de uma professora, mais recentes primeiro.',
  { nome: z.string().min(2) },
  async ({ nome }) => {
    const { rows } = await pool.query(
      `select t.display_name as professora, st.period_start, st.period_end,
              st.audited_hours, st.rate_cents, st.total_cents, st.status
         from teacher_statements st
         join teachers t on t.id = st.teacher_id
        where t.display_name ilike '%' || $1 || '%'
        order by st.period_start desc limit 24`,
      [nome],
    )
    return ok(rows)
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('MCP personal-teacher-os pronto (stdio; role ptos_mcp_ro)')
