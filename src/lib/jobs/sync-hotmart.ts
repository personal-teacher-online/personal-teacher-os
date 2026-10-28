import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'

// Polling AUTORITATIVO de progresso Hotmart (Fase 5, handoff §iii — decisão:
// RPC separada sync_course_progress, last-write-wins; a de EVENTO continua
// monotônica). Roda 1–2×/dia via Scheduled Task (padrão dispatch-outbox,
// ADR-015). Núcleo injetável (client + fetch) para o Vitest — a rota HTTP é fina.
//
// Falha de UM aluno não derruba o lote (caso 9): erros são coletados por
// contrato e devolvidos no corpo; o próximo ciclo tenta de novo.

export interface SyncHotmartResult {
  status: number
  body: {
    ok: boolean
    detail?: string
    synced?: number
    skipped?: number
    errors?: { contract: string; error: string }[]
    /** F10/M7-8: e-mails presentes na Hotmart SEM contrato vinculado (visíveis, nunca engolidos) */
    hotmart_sem_vinculo?: string[]
  }
}

export async function handleSyncHotmart(
  admin: SupabaseClient,
  opts: {
    token: string | null
    expectedToken: string | undefined
    /** e-mail (lower) → completed_percentage, vindo do Club API. null = sem creds. */
    listProgress: (() => Promise<Map<string, number>>) | null
  },
): Promise<SyncHotmartResult> {
  // Fail-closed idêntico ao despachante (F3): sem token a rota é inoperante.
  if (!opts.expectedToken || !opts.token || !safeTokenEqual(opts.token, opts.expectedToken)) {
    return { status: 401, body: { ok: false, detail: 'token inválido' } }
  }
  if (!opts.listProgress) {
    return { status: 200, body: { ok: true, detail: 'credenciais Hotmart ausentes — nada a sincronizar' } }
  }

  const { data: rows, error } = await admin
    .from('mentorship_contracts')
    .select('contract_id, external_user_ref, contracts(status)')
    .not('external_user_ref', 'is', null)
  if (error) {
    return { status: 500, body: { ok: false, detail: `mentorship_contracts: ${error.message}` } }
  }

  let progress: Map<string, number>
  try {
    progress = await opts.listProgress()
  } catch (err) {
    return { status: 200, body: { ok: false, detail: `Club API indisponível: ${String(err)}` } }
  }

  let synced = 0
  let skipped = 0
  const errors: { contract: string; error: string }[] = []
  for (const row of rows ?? []) {
    const status = (row.contracts as { status?: string } | { status?: string }[] | null | undefined)
    const contractStatus = Array.isArray(status) ? status[0]?.status : status?.status
    if (contractStatus && contractStatus !== 'active') {
      skipped++
      continue
    }
    const email = String(row.external_user_ref).trim().toLowerCase()
    const pct = progress.get(email)
    if (pct === undefined) {
      // F10/M7-8: divergência VISÍVEL — o e-mail do vínculo não aparece na Hotmart
      await admin
        .from('mentorship_contracts')
        .update({ hotmart_divergence: `e-mail ${email} não encontrado na Hotmart` })
        .eq('contract_id', row.contract_id)
      skipped++
      continue
    }
    const { error: rpcErr } = await admin.rpc('sync_course_progress', {
      p_contract: row.contract_id,
      p_pct: pct,
    })
    if (rpcErr) errors.push({ contract: row.contract_id as string, error: rpcErr.message })
    else {
      synced++
      await admin
        .from('mentorship_contracts')
        .update({ hotmart_matched_at: new Date().toISOString(), hotmart_divergence: null })
        .eq('contract_id', row.contract_id)
    }
  }
  // M7-8: e-mails da Hotmart SEM contrato correspondente também ficam visíveis
  const linked = new Set(
    (rows ?? []).map((r) => String(r.external_user_ref).trim().toLowerCase()),
  )
  const semVinculo = [...progress.keys()].filter((e) => !linked.has(e))
  return {
    status: 200,
    body: { ok: errors.length === 0, synced, skipped, errors, hotmart_sem_vinculo: semVinculo },
  }
}
