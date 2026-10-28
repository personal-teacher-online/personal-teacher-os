import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'

// Webhook Hotmart (Fase 5 — handoff-fase5 §i, molde EXATO de asaas.ts).
// Fatos conferidos na doc oficial (14/07/2026):
//  - Autenticidade: header X-HOTMART-HOTTOK com token FIXO da conta (não há HMAC).
//  - Eventos Club: { id, creation_date (epoch MS), event, data: { user: { email },
//    module?: { id } } } — aluno identificado por E-MAIL; sem percentual no payload.
//  - A Hotmart DESATIVA URL que falha (retry 5x) → erro de NEGÓCIO responde 200.
// Regras herdadas do molde: fail-closed 401 sem gravar nada; inbox first-write-wins
// com REPROCESSO de evento preso (processed_at IS NULL); efeito DEPOIS da inbox;
// 500 SÓ para falha do INSERT na inbox.
// Lei 1: o parser NUNCA deriva data civil — creation_date (epoch ms) vira
// timestamptz CRU e a RPC converte no fuso do ALUNO (apply_course_first_access).

interface HotmartEvent {
  id?: string
  creation_date?: number
  event?: string
  data?: {
    user?: { email?: string; name?: string }
    module?: { id?: string; name?: string }
    product?: { id?: number; name?: string }
  }
}

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

export async function handleHotmartWebhook(
  admin: SupabaseClient,
  opts: {
    hottok: string | null
    expectedHottok: string | undefined
    payload: unknown
    /** injetado pela rota (fetch real na API do Club); os testes injetam fake.
     *  null = progresso indisponível (sem creds/erro) — o polling diário cobre. */
    fetchPct?: (email: string) => Promise<number | null>
  },
): Promise<WebhookResult> {
  // Fail-closed (caso 1 da Fase 5): sem hottok configurado a rota é INOPERANTE;
  // hottok errado nunca grava nada. Comparação em tempo constante.
  if (!opts.expectedHottok || !opts.hottok || !safeTokenEqual(opts.hottok, opts.expectedHottok)) {
    return { status: 401, body: { ok: false, detail: 'hottok inválido' } }
  }

  const evt = (opts.payload ?? {}) as HotmartEvent
  // id natural do evento (doc oficial); fallback DETERMINÍSTICO documentado no
  // handoff (retries idênticos → mesmo id; eventos distintos → ids distintos).
  const eventId =
    typeof evt.id === 'string' && evt.id
      ? evt.id
      : createHash('sha256')
          .update(`${evt.event ?? ''}|${evt.data?.user?.email ?? ''}|${evt.creation_date ?? ''}`)
          .digest('hex')

  const { data: inserted, error: inboxErr } = await admin
    .from('webhook_inbox')
    .upsert(
      { source: 'hotmart', event_id: eventId, payload: evt as never },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (inboxErr) {
    // Payload ainda NÃO persistido — o retry da Hotmart é desejado (único 500).
    return { status: 500, body: { ok: false, detail: `inbox: ${inboxErr.message}` } }
  }

  let inboxId: number
  if (!inserted || inserted.length === 0) {
    // Replay: evento preso (processed_at NULL) reprocessa com o payload ORIGINAL;
    // evento já processado → 200 sem efeito (caso 3).
    const { data: stuck } = await admin
      .from('webhook_inbox')
      .select('id, payload')
      .eq('source', 'hotmart')
      .eq('event_id', eventId)
      .is('processed_at', null)
      .maybeSingle()
    if (!stuck) {
      return { status: 200, body: { ok: true, detail: 'evento já recebido (replay ignorado)' } }
    }
    inboxId = stuck.id as number
    Object.assign(evt, stuck.payload as HotmartEvent)
  } else {
    inboxId = inserted[0].id as number
  }

  const finish = async (error: string | null): Promise<WebhookResult> => {
    await admin
      .from('webhook_inbox')
      .update({ processed_at: new Date().toISOString(), error })
      .eq('id', inboxId)
    return { status: 200, body: { ok: true, detail: error ?? undefined } }
  }

  if (evt.event !== 'CLUB_FIRST_ACCESS' && evt.event !== 'CLUB_MODULE_COMPLETED') {
    return finish(`evento ${evt.event ?? 'desconhecido'} ignorado (só CLUB_*)`)
  }

  const email = (evt.data?.user?.email ?? '').trim().toLowerCase()
  if (!email) return finish('payload sem data.user.email')

  // Vínculo aluno-Hotmart → contrato: external_user_ref guarda o E-MAIL do aluno
  // no Club (lançado pela admin na tela de mentoria — colunas da F1). Grant de
  // SELECT para service_role: migration 20260715000900 (achado dos testes —
  // erro de leitura NUNCA pode virar 'sem contrato' silencioso).
  const { data: mcRows, error: mcErr } = await admin
    .from('mentorship_contracts')
    .select('contract_id, external_user_ref')
    .not('external_user_ref', 'is', null)
  if (mcErr) {
    return finish(`mentorship_contracts: ${mcErr.message}`)
  }
  const contract = (mcRows ?? []).find(
    (r) => String(r.external_user_ref).trim().toLowerCase() === email,
  )
  if (!contract) {
    // Caso 4: aluno desconhecido → 200 + inbox com rastro (NUNCA 500).
    return finish(`aluno hotmart sem contrato vinculado: ${email}`)
  }

  if (evt.event === 'CLUB_FIRST_ACCESS') {
    if (typeof evt.creation_date !== 'number') {
      return finish('CLUB_FIRST_ACCESS sem creation_date numérico')
    }
    // Epoch ms → instante CRU (UTC). A data civil nasce DENTRO da RPC, no fuso
    // do aluno (caso 2: evento 23:30Z vira dia seguinte em Lisboa).
    const { error } = await admin.rpc('apply_course_first_access', {
      p_contract: contract.contract_id,
      p_event_at: new Date(evt.creation_date).toISOString(),
    })
    return finish(error ? `apply_course_first_access: ${error.message}` : null)
  }

  // CLUB_MODULE_COMPLETED: o payload NÃO traz percentual (doc oficial) — o evento
  // é GATILHO de um fetch pontual na API do Club (handoff §passo 0.2); a RPC de
  // EVENTO é monotônica (webhook atrasado nunca regride — caso 5). Sem creds ou
  // fetch falho → 200 com rastro; o polling diário (autoritativo) cobre.
  if (!opts.fetchPct) {
    return finish('progresso não buscado (credenciais Hotmart ausentes) — polling diário cobre')
  }
  let pct: number | null
  try {
    pct = await opts.fetchPct(email)
  } catch (err) {
    return finish(`fetch de progresso falhou: ${String(err)}`)
  }
  if (pct === null) return finish(`progresso indisponível na API para ${email}`)

  const { error } = await admin.rpc('apply_module_progress', {
    p_contract: contract.contract_id,
    p_pct: pct,
  })
  return finish(error ? `apply_module_progress: ${error.message}` : null)
}
