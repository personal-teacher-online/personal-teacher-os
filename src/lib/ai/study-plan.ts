import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePrompt, runStructured } from './claude'
import { secaoDoBriefing } from '@/lib/briefing/leitura'
import { paresConhecidos, type SecaoBriefing, type VersaoBriefing } from '@/lib/briefing/schema'

// Sugestão de personalização do plano (cronograma M3-UI, 20/07/2026): junta
// briefing + módulos da trilha e pede ao prompt ativo 'study-plan-suggest'
// um tema/abordagem POR MÓDULO. O resultado vai para as colunas suggested_*
// (grant estreito do service_role) — a professora aceita/edita; nada se
// aplica sozinho.

export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          theme: { type: 'string' },
          approach: { type: 'string' },
        },
        required: ['id', 'theme', 'approach'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

export interface Suggestion {
  id: string
  theme: string
  approach: string
}

export function validateSuggestions(x: unknown, validIds: Set<string>): Suggestion[] {
  if (typeof x !== 'object' || x === null) throw new Error('sugestão fora do formato')
  const items = (x as { items?: unknown }).items
  if (!Array.isArray(items)) throw new Error('sugestão sem items')
  const out: Suggestion[] = []
  for (const it of items) {
    const o = it as Record<string, unknown>
    if (typeof o.id !== 'string' || !validIds.has(o.id)) continue // id inventado: descarta
    if (typeof o.theme !== 'string' || !o.theme.trim()) continue
    if (typeof o.approach !== 'string' || !o.approach.trim()) continue
    out.push({ id: o.id, theme: o.theme.trim(), approach: o.approach.trim() })
  }
  if (out.length === 0) throw new Error('nenhuma sugestão válida no retorno')
  return out
}

/** As seções de resposta, na ordem em que o aluno as responde. */
const SECOES: readonly SecaoBriefing[] = ['historia', 'objetivos', 'interesses', 'rotina', 'livre']

/**
 * O briefing virado seção → {chave: valor}, com as chaves do DICIONÁRIO.
 *
 * Antes daqui o input espalhava `...answers` cru: o que fosse para o prompt era o
 * que estivesse gravado, com o nome que estivesse — e o prompt, que cita campos
 * pelo nome, não tinha como estar certo sobre isso. Agora as chaves são as do
 * dicionário da versão da linha (`paresConhecidos`), e o teste de snapshot do
 * input as trava.
 */
function briefingNomeado(answers: unknown, versao: VersaoBriefing): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const secao of SECOES) {
    const pares = paresConhecidos(secao, secaoDoBriefing(answers, secao), versao)
    if (Object.keys(pares).length > 0) out[secao] = pares
  }
  return out
}

/** Monta o input do prompt a partir do banco (função separável para teste). */
export function buildSuggestInput(facts: {
  studentName: string
  level: string
  briefing: {
    /** já é o EFETIVO do semestre (base + re-briefing daquele ciclo) */
    answers: unknown
    kolb_style: string | null
    kolb_scores: unknown
    versao: VersaoBriefing
  } | null
  items: { id: string; position: number; title: string; goals: unknown }[]
}): string {
  return JSON.stringify({
    aluno: {
      nome: facts.studentName,
      nivel: facts.level,
      briefing: facts.briefing
        ? {
            estilo_kolb: facts.briefing.kolb_style,
            pontuacoes_kolb: facts.briefing.kolb_scores,
            ...briefingNomeado(facts.briefing.answers, facts.briefing.versao),
          }
        : null,
    },
    itens: facts.items.map((i) => ({ id: i.id, position: i.position, title: i.title, goals: i.goals })),
  })
}

/** Gera e grava as sugestões do plano. Retorna quantos itens receberam sugestão. */
export async function suggestStudyPlan(admin: SupabaseClient, planId: string): Promise<number> {
  const { data: plan, error } = await admin
    .from('study_plans')
    .select(
      'id, semester_no, level_snapshot, contract_id, contracts(student_id, students!contracts_student_id_fkey(display_name))',
    )
    .eq('id', planId)
    .maybeSingle()
  if (error || !plan) throw new Error('plano não encontrado')

  const contract = Array.isArray(plan.contracts) ? plan.contracts[0] : plan.contracts
  const student = contract
    ? Array.isArray(contract.students)
      ? contract.students[0]
      : contract.students
    : null

  const [{ data: items, error: erroItens }, { data: briefing, error: erroBriefing }] =
    await Promise.all([
      admin
        .from('study_plan_items')
        .select('id, position, title, topic_id, curriculum_topics(educational_goals)')
        .eq('plan_id', planId)
        .order('position'),
      contract
        ? admin
            .from('briefings')
            .select('answers, kolb_style, kolb_scores, status, schema_version')
            .eq('student_id', contract.student_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
  // Leitura que falha não vira "aluno sem briefing" nem "plano sem itens": as
  // duas mentiras terminam numa sugestão montada com menos do que existe.
  if (erroItens) throw new Error(`não foi possível ler os módulos do plano: ${erroItens.message}`)
  if (erroBriefing) throw new Error(`não foi possível ler o briefing do aluno: ${erroBriefing.message}`)
  if (!items?.length) throw new Error('plano sem itens')

  // O briefing que vale NESTE semestre: o base com objetivos/interesses
  // substituídos pelo re-briefing daquele ciclo, quando o aluno enviou um
  // (briefing v2 · sub-lote 4). A regra da substituição é do banco — aqui só se
  // pergunta. Só o briefing ENVIADO alimenta a IA: rascunho é resposta a meio.
  let answers: unknown = null
  if (briefing && briefing.status === 'submitted' && contract) {
    const { data: efetivo, error: erroEfetivo } = await admin.rpc('briefing_effective', {
      p_student: contract.student_id,
      p_contract: plan.contract_id,
      p_semester: plan.semester_no,
    })
    // Falhar alto: mandar o briefing DESATUALIZADO para a IA por causa de uma
    // leitura ruim é pior do que não sugerir — a professora repete o clique.
    if (erroEfetivo)
      throw new Error(`não foi possível montar o briefing do aluno: ${erroEfetivo.message}`)
    answers = efetivo ?? {}
  }

  const input = buildSuggestInput({
    studentName: (student as { display_name?: string } | null)?.display_name ?? 'aluno',
    level: plan.level_snapshot,
    briefing:
      answers !== null
        ? {
            answers,
            kolb_style: briefing!.kolb_style,
            kolb_scores: briefing!.kolb_scores,
            versao: briefing!.schema_version === 1 ? 1 : 2,
          }
        : null,
    items: items.map((i) => {
      const topic = Array.isArray(i.curriculum_topics) ? i.curriculum_topics[0] : i.curriculum_topics
      return { id: i.id, position: i.position, title: i.title, goals: topic?.educational_goals ?? [] }
    }),
  })

  const prompt = await getActivePrompt(admin, 'study-plan-suggest')
  const raw = await runStructured({ prompt, schema: SUGGEST_SCHEMA, input })
  const suggestions = validateSuggestions(raw, new Set(items.map((i) => i.id)))

  for (const s of suggestions) {
    await admin
      .from('study_plan_items')
      .update({ suggested_theme: s.theme, suggested_approach: s.approach })
      .eq('id', s.id)
  }
  return suggestions.length
}
