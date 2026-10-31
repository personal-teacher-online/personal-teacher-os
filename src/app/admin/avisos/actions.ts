'use server'

import { revalidatePath } from 'next/cache'

import type { ResultadoDaAcao } from '@/data/admin/action-result'
import { requireAdminId } from '@/lib/auth/admin'
import { canaisDoAmbiente } from '@/lib/notify/registry'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// F6/M8-5 → M3-3a: resolver SEM enviar, com motivo obrigatório e auditoria —
// a MESMA RPC de antes (`admin_resolve_outbox` decide e audita; Lei 3). O que
// mudou é a porta: em vez de `redirect` com recado na URL, devolve
// `ResultadoDaAcao` para o toast do kit, e quem chamou fecha o painel.
// M3-3b: o "reenviar" entra pela mesma porta (`admin_resend_outbox`).
export async function resolverMensagemAction(formData: FormData): Promise<ResultadoDaAcao> {
  // Server action é endpoint público: revalida o papel SEMPRE.
  await requireAdminId()

  const id = String(formData.get('id') ?? '')
  const nota = String(formData.get('note') ?? '').trim()
  if (!id) return { ok: false, mensagem: 'Mensagem não identificada.' }
  // Antecipação para UX — quem recusa de verdade é a RPC.
  if (!nota) return { ok: false, mensagem: 'Escreva o motivo: ele fica registrado na mensagem.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_resolve_outbox', { p_id: id, p_note: nota })
  if (error) return { ok: false, mensagem: `Não deu para resolver: ${error.message}` }

  revalidatePath('/admin/avisos')
  return { ok: true, mensagem: 'Mensagem resolvida sem envio. O motivo ficou registrado.' }
}

const SITUACOES_QUE_A_TELA_MOSTRA = ['pendente', 'preso', 'enviado', 'entregue', 'resolvido']

// "Reenviar" do painel. Quem decide, recusa e audita é a RPC
// `admin_resend_outbox` (Lei 3): cria a linha nova, fecha a de origem e grava
// no audit_log; ela recusa linha aguardando envio e linha cuja situação mudou
// desde que a tela abriu (por isso a tela manda a situação que mostrava).
// Depois do commit, o despacho imediato tira a linha nova de "Aguardando" sem
// esperar a rodada horária; se ele falhar, o reenvio continua valendo.
export async function reenviarMensagemAction(formData: FormData): Promise<ResultadoDaAcao> {
  // Server action é endpoint público: revalida o papel SEMPRE.
  await requireAdminId()

  const id = String(formData.get('id') ?? '')
  const situacao = String(formData.get('situacao') ?? '')
  if (!id) return { ok: false, mensagem: 'Mensagem não identificada.' }
  // Antecipação para UX — quem recusa de verdade é a RPC.
  if (!SITUACOES_QUE_A_TELA_MOSTRA.includes(situacao)) {
    return { ok: false, mensagem: 'Reabra a mensagem e tente de novo: a situação dela não veio.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_resend_outbox', { p_id: id, p_situacao_esperada: situacao })
  if (error) return { ok: false, mensagem: `Não deu para reenviar: ${error.message}` }

  try {
    await dispatchOutbox(createAdminClient(), canaisDoAmbiente())
  } catch (err) {
    console.error('[reenvio não despachado na hora]', err)
  }

  revalidatePath('/admin/avisos')
  return {
    ok: true,
    mensagem: 'Mensagem reenviada. A cópia aparece em Aguardando até o envio sair.',
  }
}
