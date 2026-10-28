// Sem `server-only` DE PROPÓSITO: o Vitest exercita a emissão (concorrência,
// timeout, adoção) importando este módulo — o segredo não mora aqui (o client
// do banco e a config chegam injetados; quem os cria é código de servidor).
import type { SupabaseClient } from '@supabase/supabase-js'
import { reaisParaCentavos, type AsaasCobranca } from '@/lib/asaas/client'
import { paidAtDoAsaas } from '@/lib/webhooks/asaas'

/**
 * Espelha uma cobrança de AULA AVULSA a partir da RESPOSTA da API (F5) — a
 * tela fica verdadeira NO ATO, sem esperar o webhook religar. Mesma RPC
 * transacional do webhook (`espelhar_pagamento`), mesmo shape de `raw`
 * (`{ event, payment }` — é o caminho que a guarda do `invoice_url` na view
 * `payments_student` lê). Devolve a mensagem de erro, ou null no sucesso.
 */
export async function espelharCobrancaDaApi(
  admin: SupabaseClient,
  aulaId: string,
  cobranca: AsaasCobranca,
  /** trilha da EMISSÃO (audit `asaas.emitir_avulsa`) — gravada NA MESMA
   *  transação do espelho (Sol F5 · P1: audit separado que falhava depois do
   *  espelho ficava sem conserto). `actor` sai do diff e vira o ator da linha. */
  emissao?: Record<string, unknown>,
): Promise<string | null> {
  const referenceYm =
    typeof cobranca.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cobranca.dueDate)
      ? cobranca.dueDate.slice(0, 7)
      : null
  const { error } = await admin.rpc('espelhar_pagamento', {
    p_asaas_payment_id: cobranca.id,
    p_contract_id: null,
    p_class_instance_id: aulaId,
    p_customer: cobranca.customer ?? null,
    p_amount_cents: typeof cobranca.value === 'number' ? reaisParaCentavos(cobranca.value) : null,
    p_status: cobranca.status ?? 'PENDING',
    p_due_date: cobranca.dueDate ?? null,
    p_paid_at: paidAtDoAsaas(cobranca),
    p_billing_type: cobranca.billingType ?? null,
    p_reference_ym: referenceYm,
    p_raw: { event: 'APP_EMISSAO', payment: cobranca } as never,
    p_emissao: (emissao ?? null) as never,
  })
  return error ? error.message : null
}
