'use server'

// AS DUAS AÇÕES DO WIZARD DE CONTRATO (Onda 1 · M4-3).
//
// A porta nova do admin (ADR-025 · item 1): a ação devolve `ResultadoDaAcao` e
// quem mostra o recado é o toast do kit — nada de `?msg=` na URL, nada de
// nonce. Por isso o payload chega TIPADO (e não como `FormData`): o wizard é
// cliente do começo ao fim e só fala com o servidor uma vez, no fim.
//
// Payload tipado NÃO é payload confiável: server action é endpoint público, e o
// que chega é conferido por `NovoContratoSchema` (forma) e pelo Postgres
// (regra). Nenhuma decisão de negócio mora aqui — nem conflito de agenda, nem
// fuso, nem promoção de lead. Esta camada TRADUZ: payload → RPC → frase.

import { revalidatePath } from 'next/cache'

import type { ResultadoDaAcao } from '@/data/admin/action-result'
import { NovoContratoSchema, type ContratoCriado, type NovoContrato } from '@/data/admin/contrato-novo'
import { confirmarLocalizacao } from '@/lib/admin/confirmar-localizacao'
import { requireAdminId } from '@/lib/auth/admin'
import { POLICY } from '@/lib/policy'
import { createClient } from '@/lib/supabase/server'

/**
 * O erro do banco dito em gente — a mesma régua do `friendlyBookError` da
 * agenda e do `erroDeHorarioEmGente` da admissão. O que o Postgres devolve é
 * verdade, mas "conflicting key value violates exclusion constraint" não é
 * resposta para quem está criando um contrato.
 */
function emGente(m: string): string {
  if (m.includes('no_overlap') || m.includes('exclusion') || m.includes('exclusão')) {
    return 'a professora já tem aula em um dos horários escolhidos'
  }
  if (m.includes('recurring_slots_active_uniq') || m.includes('duplicate key')) {
    return 'os dois horários escolhidos são o mesmo'
  }
  return m
}

/** As telas que mudam de conteúdo quando um contrato nasce. */
function revalidar(contratoId: string) {
  revalidatePath('/admin/alunos/contratos')
  revalidatePath('/admin/alunos')
  revalidatePath(`/admin/contratos/${contratoId}`)
  revalidatePath('/admin')
}

export async function criarContratoAction(
  entrada: NovoContrato,
): Promise<ResultadoDaAcao & { criado?: ContratoCriado }> {
  await requireAdminId()

  const conferido = NovoContratoSchema.safeParse(entrada)
  if (!conferido.success) {
    return {
      ok: false,
      mensagem: `Falta algo no contrato: ${conferido.error.issues.map((i) => i.message).join(' · ')}`,
    }
  }
  const c = conferido.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_create_contract', {
    p_kind: c.ramo === 'grupo' ? 'group' : c.ramo === 'mentoria' ? 'mentorship' : 'individual',
    p_students: c.alunos,
    p_plan_name: c.plano,
    // Lei 9: o wizard já converte reais em centavos antes de sair do cliente.
    p_hourly_rate_cents: c.valorCentavos,
    p_teacher: c.professora,
    p_started_on: c.inicio,
    p_group_label: c.ramo === 'grupo' ? c.rotuloDoGrupo.trim() : null,
    p_tz_anchor: c.ramo === 'grupo' ? c.ancora : null,
    p_allowance: c.remarcacoes,
    // A POLICY da escola vai por PARÂMETRO com os valores do app (item 12 do
    // veredito do e2e): constante da escola, nunca campo de tela. A RPC tem os
    // mesmos defaults; mandá-los explícitos deixa a decisão visível no diff. A
    // constante mora em `src/lib/policy.ts` — declaração única desde o M4-4.
    p_min_notice: POLICY.minNotice,
    p_expiry_days: POLICY.expiryDays,
    p_school_fault_days: POLICY.schoolFaultDays,
    p_slots: c.horarios,
  })
  if (error) return { ok: false, mensagem: `Não deu para criar o contrato: ${emGente(error.message)}` }

  const r = data as {
    contract_id: string
    slot_ids: string[]
    promoted: { id: string; nome: string; de: string }[]
  }
  revalidar(r.contract_id)
  return {
    ok: true,
    mensagem: 'Contrato criado.',
    criado: {
      contratoId: r.contract_id,
      promovidos: r.promoted ?? [],
      horarios: (r.slot_ids ?? []).length,
      alunoId: c.ramo === 'grupo' ? null : c.alunos[0],
      ramo: c.ramo,
    },
  }
}

/**
 * Confirma a cidade (e com ela o fuso) de um aluno SEM sair do wizard.
 *
 * O banco recusa contrato e horário fixo de quem tem `tz_confirmed = false` — o
 * fuso ainda é o palpite herdado da escola, e aula em relógio errado é erro de
 * dinheiro. Em vez de mandar a pessoa para a ficha e voltar, a etapa 2 mostra o
 * CityPicker ali mesmo e chama o ato de sempre (`confirm_student_location`, o
 * único caminho que liga o flag — c9 · S3). Nada é reimplementado aqui.
 *
 * c12 · nº 13 — A RESPOSTA É POR MEMBRO, e é preciso que seja.
 *
 * O laço confirma um aluno por vez, e cada confirmação COMMITA sozinha (é uma
 * RPC por aluno). Antes, o primeiro erro devolvia `{ ok:false }` e ia embora: as
 * cidades já gravadas ficavam gravadas no banco e o wizard não sabia disso —
 * marcava ZERO como confirmado, e a pessoa reconfirmava tudo (inclusive quem já
 * estava certo) só para descobrir qual dos três alunos tinha o problema. O
 * resultado passa a dizer, aluno a aluno, quem passou e quem não passou; o
 * cliente marca os que passaram e mostra o erro só nos outros.
 *
 * TODOS SÃO TENTADOS, e não só até o primeiro erro: parar no primeiro esconderia
 * dos demais um problema que eles talvez também tenham (duas cidades inválidas
 * viram duas idas e voltas em vez de uma).
 */
export interface ConfirmacaoDeCidade {
  aluno: string
  ok: boolean
  /** o motivo, só quando não deu */
  erro?: string
}

export async function confirmarCidadesAction(
  entradas: { aluno: string; cidade: string; pais: string; iana: string }[],
): Promise<ResultadoDaAcao & { porAluno: ConfirmacaoDeCidade[] }> {
  await requireAdminId()
  if (!Array.isArray(entradas) || entradas.length === 0) {
    return { ok: false, mensagem: 'Nenhuma cidade para confirmar.', porAluno: [] }
  }

  const supabase = await createClient()
  const porAluno: ConfirmacaoDeCidade[] = []
  for (const e of entradas) {
    const aluno = String(e.aluno ?? '')
    const { error } = await confirmarLocalizacao(
      supabase,
      aluno,
      String(e.cidade ?? ''),
      String(e.pais ?? ''),
      String(e.iana ?? ''),
    )
    porAluno.push(error ? { aluno, ok: false, erro: error } : { aluno, ok: true })
  }
  revalidatePath('/admin/alunos')

  const falharam = porAluno.filter((r) => !r.ok)
  const passaram = porAluno.length - falharam.length
  if (falharam.length > 0) {
    return {
      ok: false,
      mensagem:
        passaram === 0
          ? `Não deu para confirmar a cidade: ${falharam[0].erro}`
          : `${passaram} cidade(s) confirmada(s); ${falharam.length} não: ${falharam[0].erro}`,
      porAluno,
    }
  }
  return {
    ok: true,
    mensagem:
      entradas.length === 1
        ? 'Cidade confirmada — o fuso deste aluno deixou de ser palpite.'
        : `${entradas.length} cidades confirmadas — os fusos deixaram de ser palpite.`,
    porAluno,
  }
}
