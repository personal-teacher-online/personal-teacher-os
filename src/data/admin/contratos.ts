import 'server-only'

// CAMADA DE DADOS DO ÍNDICE DE CONTRATOS (Onda 1 · M4-1) — a leitura única da
// aba `/admin/alunos/contratos`.
//
// Mesma convenção de `home.ts`, `alunos.ts` e `ficha.ts`:
// · UMA função por leitura de tela; a página NÃO faz query inline;
// · o que vem do banco passa por Zod (`contratos-gramatica.ts`) — payload que
//   mudou de forma estoura AQUI, não pinta `undefined` na tela da dona;
// · FALHA NUNCA VIRA LISTA VAZIA: `exigir` confere o `error` e estoura, para o
//   boundary de erro acender em vez de a tela afirmar "nenhum contrato";
// · `server-only` — a chave e a query não podem viajar para o navegador;
// · zero regra de negócio (Lei 3): saldo e validade vêm de
//   `contract_credit_summary()`, a situação vem de `contracts.status`.
//
// SÃO AS SETE LEITURAS DA TELA VELHA, no mesmo lugar em vez de espalhadas no
// meio do JSX: contratos particulares (com aluno/grupo), professoras, horários
// vigentes, saldo consolidado, "tem aula futura?", última assinatura — e os
// contratos de MENTORIA, que a tela velha só alcançava por um link de rodapé e
// aqui viram seção própria.
//
// FUSO (Lei 1): toda hora chega à tela como TEXTO pronto, calculado aqui com
// `slotLine` — que resolve o offset da PRÓXIMA ocorrência daquele dia
// específico. Nenhum componente cliente formata data nesta onda.

import { DateTime } from 'luxon'

import { fmtBRL, fmtCivilDate } from '@/lib/format'
import { slotLine } from '@/lib/slot-line'
import { createClient } from '@/lib/supabase/server'
import { lerContratoDoDetalhe, type FichaDoContrato } from './contrato-detalhe'
import type { ContextoDoNovoContrato } from './contrato-novo'
import { lerContextoDoNovoContrato } from './contrato-novo-consulta'
import {
  ASSINATURA_ROTULO,
  AssinaturasBrutasSchema,
  ContratosBrutosSchema,
  ContratosDeMentoriaBrutosSchema,
  ProfessorasDoIndiceSchema,
  ResumosDeCreditoSchema,
  SlotsBrutosSchema,
  montarContrato,
  type ContratoDaLista,
  type FiltroDeContrato,
  type HorarioDoContrato,
} from './contratos-gramatica'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Contratos: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/** Uma linha da seção de mentoria — o mínimo que a seção mostra. */
export interface ContratoDeMentoriaNaLista {
  id: string
  aluno: string
  /** início do curso já formatado (Lei 1); `null` = ainda não lançado */
  inicioDoCurso: string | null
}

export interface IndiceDeContratos {
  /** o que a tabela mostra: os contratos vivos no recorte pedido */
  contratos: ContratoDaLista[]
  /**
   * Quantos existem em cada recorte — SEMPRE do universo inteiro, para os
   * números da fileira de filtros não mudarem de valor quando o recorte muda
   * (mesma régua dos contadores da aba Convites).
   */
  contagens: Record<FiltroDeContrato, number>
  /** contratos particulares VIVOS: é a contagem da aba do hub */
  vivos: number
  /** o recorte em vigor (`?st=`) */
  recorte: FiltroDeContrato
  mentoria: ContratoDeMentoriaNaLista[]
}

/**
 * O índice inteiro: contratos particulares vivos já traduzidos em linha de
 * tabela (horários, saldo e valor resolvidos) e os contratos de mentoria da
 * seção própria.
 */
export async function getContractsIndex(
  recorte: FiltroDeContrato = 'todos',
): Promise<IndiceDeContratos> {
  const supabase = await createClient()

  // Corte do "tem aula futura?" — relógio por request é intencional (Server
  // Component). A pergunta é sobre o INSTANTE, então o corte é em UTC.
  const agoraIso = DateTime.utc().toISO()!

  const [
    contratosRes,
    professorasRes,
    slotsRes,
    creditosRes,
    futurasRes,
    assinaturasRes,
    mentoriaRes,
  ] = await Promise.all([
    supabase
      .from('contracts')
      .select(
        'id, contract_type, plan_name, status, hourly_rate_cents, teacher_id, student_group_id, students!contracts_student_id_fkey(id, display_name, level), student_groups(label)',
      )
      .eq('contract_type', 'private_1on1')
      .neq('status', 'ended')
      .order('started_on', { ascending: false }),
    // A ORDEM define a cor da bolinha (dona primeiro, depois alfabética) — é a
    // mesma da agenda, do Início e do hub de alunos; trocar aqui repintaria a
    // escola inteira.
    supabase
      .from('teachers')
      .select('id, display_name, is_owner, iana_tz')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // Horário VIGENTE é o que não foi fechado (`active_to is null`) — a mesma
    // definição da tela velha, agora perguntada ao banco em vez de filtrada
    // depois.
    supabase
      .from('recurring_slots')
      .select('id, contract_id, weekday, local_time, iana_tz, duration_min')
      .is('active_to', null),
    supabase.rpc('contract_credit_summary'),
    supabase.from('class_instances').select('contract_id').eq('state', 'scheduled').gt('starts_at_utc', agoraIso),
    supabase
      // c15 · Sol 8: a ordem é `reserved_at` (quando o pedido começou) — a única
      // coluna que TODA linha tem desde que `sent_at` deixou de ser preenchido
      // por reserva que ainda não virou documento.
      .from('contract_signatures')
      .select('contract_id, status, reserved_at, sent_at')
      .order('reserved_at', { ascending: false }),
    supabase
      .from('contracts')
      .select('id, status, students!contracts_student_id_fkey(id, display_name, level), mentorship_contracts(course_start_date)')
      .eq('contract_type', 'mentorship')
      .neq('status', 'ended'),
  ])

  const brutos = ContratosBrutosSchema.parse(exigir('os contratos', contratosRes) ?? [])
  const professoras = ProfessorasDoIndiceSchema.parse(exigir('as professoras', professorasRes) ?? [])
  const slots = SlotsBrutosSchema.parse(exigir('os horários fixos', slotsRes) ?? [])
  const resumos = ResumosDeCreditoSchema.parse(exigir('o saldo de créditos', creditosRes) ?? [])
  const futuras = (exigir('as aulas futuras', futurasRes) ?? []) as { contract_id: string }[]
  const assinaturas = AssinaturasBrutasSchema.parse(exigir('as assinaturas', assinaturasRes) ?? [])
  const mentoriaBrutos = ContratosDeMentoriaBrutosSchema.parse(
    exigir('os contratos de mentoria', mentoriaRes) ?? [],
  )

  const comNome = professoras.filter((t) => t.display_name)
  const idxDaProfessora = new Map(comNome.map((t, i) => [t.id, i]))
  const professoraPorId = new Map(comNome.map((t) => [t.id, t]))

  // O relógio da PROFESSORA de cada contrato: é ele que decide se a linha do
  // horário ganha a segunda hora ("20:30 para a professora"). Um mapa antes do
  // laço, e não um `find` dentro dele: são poucas linhas, mas varredura dentro
  // de laço é o começo de todo N+1.
  const tzDaProfessoraDoContrato = new Map(
    brutos.map((c) => [
      c.id,
      c.teacher_id ? (professoraPorId.get(c.teacher_id)?.iana_tz ?? null) : null,
    ]),
  )

  const horariosPorContrato = new Map<string, HorarioDoContrato[]>()
  for (const s of slots) {
    // Horário de contrato ENCERRADO (ou de mentoria) não interessa ao índice: a
    // consulta traz todos os vigentes de uma vez, e quem não tem contrato na
    // lista sai aqui.
    if (!tzDaProfessoraDoContrato.has(s.contract_id)) continue
    const linha = slotLine(s, tzDaProfessoraDoContrato.get(s.contract_id) ?? null)
    const lista = horariosPorContrato.get(s.contract_id) ?? []
    lista.push({ id: s.id, aluno: linha.aluno, professora: linha.prof })
    horariosPorContrato.set(s.contract_id, lista)
  }

  const saldos = new Map(resumos.map((r) => [r.contract_id, r]))
  const temAulaFutura = new Set(futuras.map((f) => f.contract_id))

  // A lista já vem ordenada por `reserved_at` desc: a PRIMEIRA de cada contrato
  // é o último pedido de assinatura (c15 · Sol 8).
  const ultimaAssinatura = new Map<string, string>()
  for (const a of assinaturas) if (!ultimaAssinatura.has(a.contract_id)) ultimaAssinatura.set(a.contract_id, a.status)

  const contratos = brutos.map((bruto) => {
    const resumo = saldos.get(bruto.id)
    const professora = bruto.teacher_id ? professoraPorId.get(bruto.teacher_id) : undefined
    const status = ultimaAssinatura.get(bruto.id)

    return montarContrato(bruto, {
      professora: {
        id: bruto.teacher_id,
        nome: professora?.display_name ?? null,
        idx: bruto.teacher_id ? (idxDaProfessora.get(bruto.teacher_id) ?? 0) : 0,
      },
      horarios: horariosPorContrato.get(bruto.id) ?? [],
      temAulaFutura: temAulaFutura.has(bruto.id),
      valorHora: bruto.hourly_rate_cents === null ? null : fmtBRL(bruto.hourly_rate_cents),
      saldo: resumo?.balance ?? 0,
      proximaValidade: resumo?.next_expiry ? fmtCivilDate(resumo.next_expiry) : null,
      assinatura: status ? { status, rotulo: ASSINATURA_ROTULO[status] ?? status } : null,
    })
  })

  const contagens: Record<FiltroDeContrato, number> = {
    todos: contratos.length,
    active: contratos.filter((c) => c.situacao === 'active').length,
    paused: contratos.filter((c) => c.situacao === 'paused').length,
  }

  const mentoria: ContratoDeMentoriaNaLista[] = mentoriaBrutos
    .map((m) => ({
      id: m.id,
      aluno: m.students?.display_name ?? '—',
      inicioDoCurso: m.mentorship_contracts?.course_start_date
        ? fmtCivilDate(m.mentorship_contracts.course_start_date)
        : null,
    }))
    .sort((a, b) => a.aluno.localeCompare(b.aluno, 'pt-BR'))

  return {
    contratos: recorte === 'todos' ? contratos : contratos.filter((c) => c.situacao === recorte),
    contagens,
    vivos: contratos.length,
    recorte,
    mentoria,
  }
}

/* ========================================================================== */
/* O DETALHE (`/admin/contratos/[id]`, M4-2)                                   */
/* ========================================================================== */

/**
 * A leitura única da página de detalhe de um contrato. `null` = não existe (a
 * página responde 404).
 *
 * O CORPO da leitura mora em `contrato-detalhe.ts`, que recebe o cliente por
 * parâmetro: é isso que permite ao Vitest executar a consulta de verdade contra
 * a bancada em vez de conferir por grep que a query está escrita (o mesmo
 * arranjo de `ficha-consultas.ts`). Aqui fica o que só existe no request: o
 * cliente montado a partir dos cookies e o relógio.
 */
export async function getContractFile(id: string): Promise<FichaDoContrato | null> {
  const supabase = await createClient()
  // Relógio por request é intencional (Server Component).
  return lerContratoDoDetalhe(supabase, id, DateTime.now())
}

/* ========================================================================== */
/* O WIZARD (`/admin/contratos/novo`, M4-3)                                    */
/* ========================================================================== */

/**
 * O que o wizard precisa para deixar alguém montar um contrato sem sair da
 * tela: alunos (com situação e estado do fuso), professoras, planos já usados e
 * a agenda ocupada por zona.
 *
 * Mesmo arranjo do detalhe: o CORPO mora em `contrato-novo-consulta.ts`, que
 * recebe o cliente por parâmetro (é o que permite ao Vitest executar a leitura
 * de verdade contra a bancada); aqui fica só o que existe no request.
 */
export async function getNewContractContext(): Promise<ContextoDoNovoContrato> {
  const supabase = await createClient()
  // Relógio por request é intencional (Server Component).
  return lerContextoDoNovoContrato(supabase, DateTime.now())
}
