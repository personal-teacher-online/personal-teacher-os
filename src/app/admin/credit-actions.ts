'use server'

import { redirect } from 'next/navigation'
import { requireAdminId } from '@/lib/auth/admin'
import { createClient } from '@/lib/supabase/server'

// F3/M3-2: estender a validade de UM crédito (par −1/+1 auditado no banco;
// duração e origem preservadas pelo _reissue_credit). Motivo obrigatório.
export async function extendCreditAction(formData: FormData) {
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_extend_credit', {
    p_ledger: Number(formData.get('ledger_id')),
    p_new_expires_on: String(formData.get('new_expires_on') ?? ''),
    p_note: String(formData.get('note') ?? '').trim() || null,
  })
  const msg = error
    ? `Falha: ${error.message}`
    : 'Validade estendida — o crédito continua com a mesma duração e origem. ✓'
  // Onda 1 · M3-2: a extensão voltou a ter dono (a aba Créditos da ficha), e
  // quem chama diz para onde voltar. Sem `back`, o destino é o de sempre.
  const back = String(formData.get('back') ?? '')
  const destino = back.startsWith('/admin/') ? back : '/admin'
  const juncao = destino.includes('?') ? '&' : '?'
  redirect(`${destino}${juncao}msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}
