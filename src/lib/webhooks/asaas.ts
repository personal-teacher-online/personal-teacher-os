import type { SupabaseClient } from '@supabase/supabase-js'
import { reaisParaCentavos } from '@/lib/asaas/client'
import { safeTokenEqual } from '@/lib/auth/token'

// Núcleo do webhook Asaas (Lei 6 + D4/D7) — client injetado para o Vitest exercitar
// os casos 11-13/18-19 do goal. A rota HTTP é um wrapper fino.
//
// Regras:
// - Token inválido/ausente → 401 e NADA gravado (caso 18).
// - Inbox por UNIQUE(source, event_id) com first-write-wins: replay (mesmo id) não tem
//   efeito extra e NÃO sobrescreve o payload original (casos 11 e 19).
// - Espelho payments: casado ao contrato pelo externalReference (= UUID estático da
//   assinatura); reference_ym DERIVADO do dueDate (string, 7 chars — sem timezone).
//   externalReference desconhecido → 200 rápido + inbox.error, nada corrompido (caso 12).
// - Dinheiro: Asaas manda `value` em reais → centavos pela fronteira ÚNICA
//   `reaisParaCentavos` de src/lib/asaas/client.ts (Lei 9).

interface AsaasPayment {
  id?: string
  externalReference?: string | null
  value?: number
  status?: string
  dueDate?: string
  // Contrato REAL do webhook Asaas (docs.asaas.com/docs/webhook-para-cobrancas):
  // a data de pagamento vem em paymentDate/clientPaymentDate — NÃO existe "paidDate".
  paymentDate?: string | null
  clientPaymentDate?: string | null
  billingType?: string
  // F3 — confirmado por payload REAL no gate F0 (tests/fixtures/asaas/): o
  // pagador vem como id string `cus_…`, sem nome/CPF (o enriquecimento é o
  // lote do F4; aqui NUNCA se faz HTTP — Lei 6).
  customer?: string | null
  // F5 (Sol r2): no PAYMENT_DELETED real (fixture do F0) o status permanece
  // 'PENDING' e a remoção vem SÓ em `deleted: true` — sem ler a flag, a
  // cobrança apagada ficava "em aberto" na tela para sempre.
  deleted?: boolean
}

/** Data civil do Asaas ('YYYY-MM-DD', fuso de Brasília) → instante no MEIO-DIA de
 *  São Paulo (nunca meia-noite UTC, que viraria o dia anterior em Cuiabá — Lei 1).
 *  Valor não parseável → null (payload externo nunca derruba o handler).
 *  Exportada: a emissão do F5 espelha a RESPOSTA da API com a MESMA regra. */
export function paidAtDoAsaas(p: {
  paymentDate?: string | null
  clientPaymentDate?: string | null
}): string | null {
  const d = p.paymentDate ?? p.clientPaymentDate ?? null
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return `${d}T12:00:00-03:00`
}
const paidAtFrom = paidAtDoAsaas

interface AsaasEvent {
  id?: string
  event?: string
  payment?: AsaasPayment
}

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

export async function handleAsaasWebhook(
  admin: SupabaseClient,
  opts: { token: string | null; expectedToken: string | undefined; payload: unknown },
): Promise<WebhookResult> {
  // Caso 18: sem token configurado o endpoint é INOPERANTE (fail-closed), e token
  // errado nunca grava nada. Comparação em tempo constante (painel final F3).
  if (!opts.expectedToken || !opts.token || !safeTokenEqual(opts.token, opts.expectedToken)) {
    return { status: 401, body: { ok: false, detail: 'token inválido' } }
  }

  const evt = (opts.payload ?? {}) as AsaasEvent
  const eventId = typeof evt.id === 'string' && evt.id ? evt.id : null
  if (!eventId) {
    return { status: 400, body: { ok: false, detail: 'payload sem id de evento' } }
  }

  // Inbox idempotente: só quem INSERIU processa (caso 11); duplicata mantém o payload
  // ORIGINAL (caso 19) e responde 200 sem efeito.
  const { data: inserted, error: inboxErr } = await admin
    .from('webhook_inbox')
    .upsert(
      { source: 'asaas', event_id: eventId, payload: evt as never },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (inboxErr) {
    return { status: 500, body: { ok: false, detail: `inbox: ${inboxErr.message}` } }
  }
  let inboxId: number
  if (!inserted || inserted.length === 0) {
    // Replay: se o evento ficou PRESO (inbox gravada, processo morreu antes do espelho),
    // o retry do Asaas reprocessa; senão, ignora — first-write-wins continua valendo
    // para o PAYLOAD (o original é o que se processa).
    const { data: stuck } = await admin
      .from('webhook_inbox')
      .select('id, payload')
      .eq('source', 'asaas')
      .eq('event_id', eventId)
      .is('processed_at', null)
      .maybeSingle()
    if (!stuck) {
      return { status: 200, body: { ok: true, detail: 'evento já recebido (replay ignorado)' } }
    }
    inboxId = stuck.id as number
    Object.assign(evt, stuck.payload as AsaasEvent) // reprocessa o payload ORIGINAL
  } else {
    inboxId = inserted[0].id as number
  }

  // F3 (Sol · P1): dois desfechos de erro, com destinos diferentes.
  // · TERMINAL (default): a conclusão vale — externalReference desconhecido,
  //   evento ignorado etc. `processed_at` é gravado; a correção é operacional
  //   e chega por um PRÓXIMO evento (id novo).
  // · RETRYÁVEL: a escrita do espelho FALHOU (RPC transacional; nada gravado).
  //   `processed_at` fica NULO — o retry do Asaas cai no ramo de evento preso
  //   e reprocessa o payload ORIGINAL inteiro. Sem isso, uma falha transitória
  //   marcava o evento como processado e o espelho se perdia para sempre.
  const finish = async (
    error: string | null,
    opts: { retryavel?: boolean } = {},
  ): Promise<WebhookResult> => {
    await admin
      .from('webhook_inbox')
      .update({
        processed_at: opts.retryavel ? null : new Date().toISOString(),
        error,
      })
      .eq('id', inboxId)
    // A Hotmart/Asaas desativam URLs que falham: erro de NEGÓCIO responde 200 (Lei 6).
    return { status: 200, body: { ok: true, detail: error ?? undefined } }
  }

  if (!evt.event?.startsWith('PAYMENT_')) {
    return finish(`evento ${evt.event ?? 'desconhecido'} ignorado (só PAYMENT_*)`)
  }

  const p = evt.payment
  if (!p?.id) {
    return finish('evento PAYMENT_* sem payment.id — nada espelhado')
  }

  // D4: contrato pelo externalReference; desconhecido → inbox.error, sem espelho.
  // F8/M11-3 → F5: se a referência não é contrato, tenta AULA avulsa. Desde o
  // F5 a avulsa É ESPELHADA (a tela Financeiro conta com ela) — o early-return
  // que só quitava morreu; o espelho sai pela MESMA RPC, ancorado na aula
  // (rotina P21: a cobrança da avulsa leva o UUID da aula; a emissão pelo app
  // já nasce assim).
  const ref = p.externalReference ?? null
  let contractId: string | null = null
  let aulaAvulsa: { id: string; single_paid_at: string | null } | null = null
  if (ref) {
    const { data: contract } = await admin.from('contracts').select('id').eq('id', ref).maybeSingle()
    contractId = contract?.id ?? null
    if (!contractId) {
      const { data: aula } = await admin
        .from('class_instances')
        .select('id, single_kind, single_paid_at')
        .eq('id', ref)
        .maybeSingle()
      if (aula && !aula.single_kind) {
        return finish(`externalReference aponta uma aula NÃO-avulsa (${aula.id}) — nada espelhado`)
      }
      if (aula) aulaAvulsa = { id: aula.id, single_paid_at: aula.single_paid_at }
    }
  }
  if (!contractId && !aulaAvulsa) {
    return finish(`externalReference desconhecido (${ref ?? 'vazio'}) — pagamento ${p.id} não espelhado`)
  }

  const referenceYm =
    typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.dueDate)
      ? p.dueDate.slice(0, 7)
      : null

  // F3: o espelho inteiro (stub do payer + vínculo + payments) sai numa RPC
  // transacional ÚNICA — tudo-ou-nada. Falha ⇒ nada meio-salvo; o `finish`
  // grava o erro na inbox e o retry do Asaas reprocessa o payload ORIGINAL.
  // O payer_id nunca regride a null (regra dentro da RPC).
  // Sol r2 (F5) · P1: no PAYMENT_DELETED o status do payload segue 'PENDING' e
  // a remoção vem em `deleted: true` (fixture real do F0) — derivar o status
  // terminal aqui, senão a cobrança apagada fica "em aberto" na régua.
  const statusEspelhado =
    evt.event === 'PAYMENT_DELETED' || p.deleted === true
      ? 'DELETED'
      : (p.status ?? evt.event.replace('PAYMENT_', ''))

  const { error: payErr } = await admin.rpc('espelhar_pagamento', {
    p_asaas_payment_id: p.id,
    p_contract_id: contractId,
    p_class_instance_id: aulaAvulsa?.id ?? null,
    p_customer: typeof p.customer === 'string' ? p.customer : null,
    p_amount_cents: typeof p.value === 'number' ? reaisParaCentavos(p.value) : null,
    p_status: statusEspelhado,
    p_due_date: p.dueDate ?? null,
    p_paid_at: paidAtFrom(p),
    p_billing_type: p.billingType ?? null,
    p_reference_ym: referenceYm,
    p_raw: evt as never,
  })
  if (payErr) {
    // RETRYÁVEL: a transação não gravou nada — o retry re-tenta inteira.
    return finish(`espelho payments falhou: ${payErr.message}`, { retryavel: true })
  }

  // F5 (Sol r2): a QUITAÇÃO da avulsa acontece DENTRO da própria RPC (mesma
  // transação do espelho) — vale igual para este webhook e para a adoção da
  // emissão. Aqui não sobra passo nenhum.
  return finish(null)
}
