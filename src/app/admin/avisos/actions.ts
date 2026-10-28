'use server'

import { revalidatePath } from 'next/cache'

import type { ResultadoDaAcao } from '@/data/admin/action-result'
import { requireAdminId } from '@/lib/auth/admin'
import { createClient } from '@/lib/supabase/server'

// F6/M8-5 → M3-3a: resolver SEM enviar, com motivo obrigatório e auditoria —
// a MESMA RPC de antes (`admin_resolve_outbox` decide e audita; Lei 3). O que
// mudou é a porta: em vez de `redirect` com recado na URL, devolve
// `ResultadoDaAcao` para o toast do kit, e quem chamou fecha o painel.
// O "reenviar" entra aqui no M3-3b, depois da migration M3-1.
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
