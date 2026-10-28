import type { SupabaseClient } from '@supabase/supabase-js'

// Montagem do arquivo de PORTABILIDADE do aluno (F7/M4-5, LGPD). Extraído da
// rota /admin/alunos/[id]/export para o Vitest conseguir provar o conteúdo —
// a rota virou um invólucro fino que só cuida do 403, do 500 e do
// content-disposition.
//
// Lê com o cliente do ADMIN logado (não service_role): a RLS das tabelas é
// parte do que está sendo testado.
//
// ⚠️ NADA DE FALHA SILENCIOSA (correção 7 da revisão adversarial de 26/07). A
// versão anterior fazia `data ?? []` em toda seção: uma consulta que falhasse
// — RLS nova, coluna renomeada, banco lento — virava uma seção VAZIA num
// arquivo com cara de completo. Num artefato de portabilidade isso é o pior
// desfecho possível: a escola entrega um arquivo incompleto dizendo que é
// tudo, e ninguém fica sabendo. Agora qualquer `error` LANÇA, e a rota
// devolve 500 sem arquivo nenhum.

export interface StudentExport {
  exported_at: string
  aluno: unknown
  contratos: unknown[]
  aulas: unknown[]
  creditos: unknown[]
  pagamentos: unknown[]
  relatorios: unknown[]
  /** lote 26/07 — aceites versionados de política */
  politicas_aceitas: unknown[]
  /** lote 26/07 — telemetria de primeira parte, por user_id */
  eventos_de_uso: unknown[]
  /** lote 26/07 — erros de navegador atribuídos a este usuário */
  erros_de_cliente: unknown[]
}

export type ExportResult =
  | { ok: true; payload: StudentExport }
  | { ok: false; status: number; detail: string }

/** Erro de montagem do export — a rota traduz para 500. */
export class ExportIncompletoError extends Error {
  constructor(
    readonly secao: string,
    causa: string,
  ) {
    super(`export do aluno incompleto: a seção "${secao}" falhou (${causa})`)
    this.name = 'ExportIncompletoError'
  }
}

interface Resposta<T> {
  data: T | null
  error: { message: string } | null
}

/** Toda seção passa por aqui: `error` preenchido derruba o export inteiro. */
function exigir<T>(secao: string, r: Resposta<T>): T | null {
  if (r.error) throw new ExportIncompletoError(secao, r.error.message)
  return r.data
}

function exigirLista(secao: string, r: Resposta<unknown[]>): unknown[] {
  return exigir(secao, r) ?? []
}

const vazio: Promise<Resposta<unknown[]>> = Promise.resolve({ data: [], error: null })

export async function buildStudentExport(
  supabase: SupabaseClient,
  studentId: string,
): Promise<ExportResult> {
  const dir = exigir<unknown[]>(
    'aluno',
    (await supabase.rpc('admin_student_directory', { p_student: studentId })) as Resposta<unknown[]>,
  )
  const student = (dir ?? [])[0]
  // Ausência de linha NÃO é falha: é aluno que não existe (404 legítimo).
  if (!student) return { ok: false, status: 404, detail: 'aluno não encontrado' }

  // S2-16 (e2e 19/07): contratos DIRETO da tabela, sem filtro de status — a
  // view de diretório omite encerrados, e o fluxo LGPD real (exportar →
  // anonimizar) EXIGE contratos encerrados: o export saía vazio justamente no
  // único cenário em que a portabilidade importa.
  const allContracts = exigirLista(
    'contratos',
    (await supabase
      .from('contracts')
      .select('id, contract_type, plan_name, status, started_on, ended_on, hourly_rate_cents')
      .eq('student_id', studentId)) as Resposta<unknown[]>,
  ) as { id: string }[]
  const contractIds = allContracts.map((c) => c.id)

  // A telemetria é indexada pelo USUÁRIO (auth), não pelo aluno: sem perfil
  // vinculado (aluno já anonimizado, ou nunca convidado) não há o que exportar.
  const me = exigir<{ profile_id: string | null }>(
    'perfil',
    (await supabase
      .from('students')
      .select('profile_id')
      .eq('id', studentId)
      .maybeSingle()) as Resposta<{ profile_id: string | null }>,
  )
  const profileId = me?.profile_id ?? null

  const [classes, ledger, payments, reports, policies, events, errors] = (await Promise.all([
    contractIds.length
      ? supabase
          .from('class_instances')
          .select('id, starts_at_utc, ends_at_utc, state, local_time_snapshot, single_kind')
          .in('contract_id', contractIds)
          .order('starts_at_utc')
      : vazio,
    contractIds.length
      ? supabase
          .from('makeup_ledger')
          .select('id, contract_id, delta, reason, expires_on, duration_min, note, created_at')
          .in('contract_id', contractIds)
          .order('created_at')
      : vazio,
    contractIds.length
      ? supabase
          .from('payments')
          .select('id, contract_id, amount_cents, status, due_date, reference_ym, paid_at')
          .in('contract_id', contractIds)
      : vazio,
    supabase
      .from('progress_reports')
      .select('id, period_start, period_end, status, created_at')
      .eq('student_id', studentId),
    supabase
      .from('policy_acceptances')
      .select('accepted_at, channel, policy_versions(kind, version, body_md, effective_from)')
      .eq('student_id', studentId)
      .order('accepted_at'),
    profileId
      ? supabase
          .from('ui_events')
          .select('at, role, path, event')
          .eq('user_id', profileId)
          .order('at')
      : vazio,
    // (hash, user_id) é a chave desde a correção 6: o balde deste usuário é
    // dele, e não mais "a linha de quem topou primeiro com o defeito".
    profileId
      ? supabase
          .from('client_errors')
          .select('first_at, last_at, count, message, path')
          .eq('user_id', profileId)
          .order('last_at')
      : vazio,
  ])) as Resposta<unknown[]>[]

  return {
    ok: true,
    payload: {
      exported_at: new Date().toISOString(),
      aluno: student,
      contratos: allContracts,
      aulas: exigirLista('aulas', classes),
      creditos: exigirLista('creditos', ledger),
      pagamentos: exigirLista('pagamentos', payments),
      relatorios: exigirLista('relatorios', reports),
      politicas_aceitas: exigirLista('politicas_aceitas', policies),
      eventos_de_uso: exigirLista('eventos_de_uso', events),
      erros_de_cliente: exigirLista('erros_de_cliente', errors),
    },
  }
}
