// AS DUAS CONSULTAS DA FICHA QUE PRECISAM DE PROVA CONTRA O BANCO
// (E4 e E5 da revisão adversarial nº 7).
//
// Por que elas moram FORA de `ficha.ts`: aquele arquivo é `server-only` e sua
// única função pública monta o cliente Supabase a partir dos cookies do request
// — não dá para chamá-la no Vitest sem inventar harness. Estas duas recebem o
// cliente por parâmetro, não importam `next/headers` e não têm `server-only`:
// o teste passa um cliente de admin de verdade e prova o RESULTADO, em vez de
// provar por grep que a string da query está no arquivo.
//
// Continua valendo a Lei 3: aqui não há regra de negócio nenhuma. São duas
// perguntas ao Postgres, com os filtros certos.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `student_group_id` entrou no A6 (prova independente L2, grave do GRUPO): a
 * ficha do aluno lista as próximas aulas de TODOS os contratos dele — inclusive
 * o de casal/turma —, e o diálogo de cancelamento precisa saber se aquela aula
 * é de grupo para não afirmar a entrega do aviso por um cadastro só. A coluna
 * viaja na consulta que já existia; nenhuma ida a mais ao banco.
 */
export const COLUNAS_DO_CONTRATO =
  'id, hourly_rate_cents, started_on, ended_on, is_trial, contract_type, plan_name, teacher_id, status, student_group_id'

export interface ContratoEncerrado {
  id: string
  hourly_rate_cents: number | null
  started_on: string | null
  ended_on: string | null
  is_trial: boolean | null
  contract_type: string
  plan_name: string | null
  teacher_id: string | null
  status: string
  /** não-nulo = contrato de GRUPO (casal/turma) */
  student_group_id: string | null
}

/**
 * E4 — os contratos ENCERRADOS deste aluno, pela UNIÃO de como um aluno se liga
 * a um contrato:
 *   · vínculo direto (`contracts.student_id`), o caso do aluno individual;
 *   · participação em GRUPO (`student_group_members` → `contracts
 *     .student_group_id`), o caso do casal e da turma.
 *
 * A versão anterior só olhava o vínculo direto. Consequência: quando o contrato
 * de casal era encerrado, ele sumia da ficha dos DOIS alunos — e com ele sumiam
 * as aulas, as cobranças, as pausas e o extrato de crédito daquele contrato,
 * porque o conjunto de ids do histórico é montado a partir desta leitura. O
 * diretório (`admin_student_directory`) já faz a união — mas só dos NÃO
 * encerrados; era exatamente a metade que faltava.
 *
 * Duas idas ao banco, e não uma: `student_group_members` é uma tabela à parte, e
 * o `.or()` do PostgREST não sabe fazer subconsulta. A admin tem policy de
 * leitura nas duas (`*_admin_all` da 20260711000700), então nada aqui depende de
 * RPC nova.
 */
export async function lerContratosEncerrados(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ data: ContratoEncerrado[] | null; error: { message: string } | null }> {
  const grupos = await supabase
    .from('student_group_members')
    .select('group_id')
    .eq('student_id', studentId)
  if (grupos.error) return { data: null, error: grupos.error }

  const idsDeGrupo = ((grupos.data ?? []) as { group_id: string }[]).map((g) => g.group_id)

  const base = supabase.from('contracts').select(COLUNAS_DO_CONTRATO).eq('status', 'ended')
  const filtrado = idsDeGrupo.length
    ? base.or(`student_id.eq.${studentId},student_group_id.in.(${idsDeGrupo.join(',')})`)
    : base.eq('student_id', studentId)

  const r = await filtrado.order('started_on', { ascending: false })
  return { data: (r.data as ContratoEncerrado[] | null) ?? null, error: r.error }
}

/**
 * E5 — quantos créditos estão RESERVADOS: gasto de crédito (`delta < 0`) preso a
 * uma aula que ainda vai acontecer.
 *
 * A conta já esteve em DOIS lugares errados. Primeiro por cima da coleção de
 * aulas da ficha, que tem TETO (as 60 mais recentes): quem tinha mais reposições
 * marcadas que isso via um número menor que a verdade. Depois no PostgREST, com
 * `makeup_ledger → class_instances!inner` filtrando `state = 'scheduled'` — e
 * essa versão perdia toda reposição REMARCADA (P3 da revisão nº 8): o débito
 * fica preso à aula ORIGINAL, que vira `rescheduled`, enquanto a aula que vai
 * acontecer é outra linha, ligada por `reschedule_of`. O cartão zerava
 * "Agendados" justo para quem mexeu na agenda.
 *
 * Agora a pergunta inteira mora no banco (`admin_reserved_credits`), que segue a
 * cadeia de `reschedule_of` até a ponta — inclusive a remarcação da remarcação.
 * Aqui não sobrou regra nenhuma: é uma chamada e a soma que o Postgres devolveu.
 */
export async function contarCreditosReservados(
  supabase: SupabaseClient,
  contractIds: string[],
): Promise<{ data: number | null; error: { message: string } | null }> {
  if (contractIds.length === 0) return { data: 0, error: null }

  const r = await supabase.rpc('admin_reserved_credits', { p_contract_ids: contractIds })
  if (r.error) return { data: null, error: r.error }
  return { data: Number(r.data ?? 0), error: null }
}
