// Consulta de RECONCILIAÇÃO por exceções (F6 da onda Financeiro) — rodada no
// smoke do religamento e sob demanda. SEMPRE read-only: lista o que precisa de
// olho humano, nada mais (sem painel de métricas — decisão do PLAN-APPROVED).
//
// As exceções:
//   1. claim de emissão em estado INCERTO (sem cobrança ativa espelhada);
//   2. inbox com `error` — PRESA (processed_at nulo: o replay re-tenta) e
//      TERMINAL ainda NÃO resolvida (a cobrança segue sem espelho; terminal
//      cuja cobrança já foi conciliada por evento posterior sai da lista);
//   3. cobrança EXTERNA sem espelho local (universo do Asaas − payments);
//   4. ESPELHO DESATUALIZADO (status externo ≠ status local — webhook perdido
//      ou fora de ordem; Sol F6 · P1);
//   5. payment sem pagador (payer_id nulo — evento nunca trouxe customer);
//   6. externalReference com 2+ cobranças ATIVAS no Asaas (duplicidade).
//
// Sai com código 1 quando há QUALQUER exceção — o smoke do runbook usa isso.
// Sem ASAAS_API_KEY o script RECUSA (Sol F6 · P1: smoke "limpo" sem falar com
// o Asaas seria falso-verde); `--so-local` libera o modo local explícito.
// `--desde YYYY-MM-DD` corta o histórico PRÉ-religamento do lado externo
// (cobranças antigas nunca terão espelho — o webhook não recria o passado).
//
// Uso: npm run asaas:reconciliar -- --desde 2026-08-15
//      npm run asaas:reconciliar:prod -- --desde 2026-08-15
//      npm run asaas:reconciliar -- --so-local

import { createClient } from '@supabase/supabase-js'
import { asaasConfigFromEnv, listarCobrancas } from '../src/lib/asaas/client.ts'

const SO_LOCAL = process.argv.includes('--so-local')
const desdeIdx = process.argv.indexOf('--desde')
const DESDE = desdeIdx >= 0 ? process.argv[desdeIdx + 1] : null
if (desdeIdx >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(DESDE ?? '')) {
  console.error('--desde exige uma data YYYY-MM-DD (a data do religamento).')
  process.exit(1)
}

// A MESMA régua de "não cobrável" do banco (payment_nao_cobravel, migration
// 20260726000100: `lower(status) ~ '(refund|chargeback|cancel|delet)'`).
// Duplicá-la aqui é deliberado e ANCORADO: se a função do banco mudar, este
// espelho muda junto — o teste de reconciliação do F6 compara as duas.
const NAO_COBRAVEL = /(refund|chargeback|cancel|delet)/i

const cfg = asaasConfigFromEnv()
if (!cfg && !SO_LOCAL) {
  console.error(
    'ASAAS_API_KEY/ASAAS_ENV ausentes — sem falar com o Asaas a reconciliação seria FALSO-VERDE. ' +
      'Configure a env, ou rode com --so-local para conferir só o lado do banco.',
  )
  process.exit(1)
}
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supaUrl || !supaKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.')
  process.exit(1)
}
const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } })

console.log(`\n=== RECONCILIAÇÃO ASAAS — banco ${supaUrl}`)
console.log(cfg ? `=== Asaas: ${cfg.ambiente} (${cfg.baseUrl})${DESDE ? ` · corte externo desde ${DESDE}` : ''}` : '=== --so-local: SÓ as exceções do banco (o lado Asaas fica de fora)')

let excecoes = 0
function bloco(titulo: string, linhas: string[]) {
  console.log(`\n--- ${titulo}: ${linhas.length}`)
  for (const l of linhas) console.log(`  · ${l}`)
  excecoes += linhas.length
}

/* espelho local inteiro (id → status), usado por várias exceções */
const { data: locais, error: locErr } = await db
  .from('payments')
  .select('asaas_payment_id, status, payer_id')
if (locErr) throw new Error(`payments: ${locErr.message}`)
const localPorId = new Map((locais ?? []).map((p) => [p.asaas_payment_id as string, p]))

/* 1. claims incertas: emissão travada sem cobrança ativa espelhada */
{
  const { data: claims, error } = await db
    .from('payment_emissions')
    .select('class_instance_id, created_at')
  if (error) throw new Error(`payment_emissions: ${error.message}`)
  const incertas: string[] = []
  for (const c of claims ?? []) {
    const { data: pays } = await db
      .from('payments')
      .select('status')
      .eq('class_instance_id', c.class_instance_id)
    const ativa = (pays ?? []).some((p) => !NAO_COBRAVEL.test(String(p.status ?? '')))
    if (!ativa) incertas.push(`aula ${c.class_instance_id} — claim de ${c.created_at} sem cobrança ativa`)
  }
  bloco('claims de emissão em estado incerto', incertas)
}

/* 2. inbox com error — presa × terminal AINDA não resolvida */
{
  const { data: rows, error } = await db
    .from('webhook_inbox')
    .select('event_id, error, processed_at, payload')
    .eq('source', 'asaas')
    .not('error', 'is', null)
    .order('received_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`webhook_inbox: ${error.message}`)
  const presas = (rows ?? []).filter((r) => !r.processed_at)
  // Terminal RESOLVIDA (Sol F6 · P2): a cobrança daquele evento já tem espelho
  // — um evento posterior (id novo) conciliou; a linha velha não é pendência.
  const terminais = (rows ?? []).filter((r) => {
    if (!r.processed_at) return false
    const payId = (r.payload as { payment?: { id?: string } })?.payment?.id
    return !(payId && localPorId.has(payId))
  })
  bloco('inbox PRESA com erro (o replay do Asaas re-tenta; se persistir, investigar)',
    presas.map((r) => `${r.event_id}: ${r.error}`))
  bloco('inbox com erro TERMINAL não resolvido (corrigir a causa; o próximo evento concilia)',
    terminais.map((r) => `${r.event_id}: ${r.error}`))
}

/* 5. payment sem pagador (local — independe da API) */
bloco('payments sem pagador (nenhum evento trouxe customer — conferir no painel)',
  (locais ?? []).filter((p) => !p.payer_id).map((p) => `${p.asaas_payment_id} (${p.status ?? '?'})`))

/* 3, 4 e 6. o universo EXTERNO */
if (cfg) {
  const externas = await listarCobrancas(cfg)
  const noCorte = DESDE
    ? externas.filter((c) => !c.dateCreated || c.dateCreated >= DESDE)
    : externas
  if (DESDE) console.log(`\n(corte externo: ${externas.length} cobranças no Asaas, ${noCorte.length} desde ${DESDE})`)

  const vivas = noCorte.filter((c) => !c.deleted)

  bloco('cobranças no Asaas SEM espelho local (webhook perdeu ou nunca chegou)',
    vivas.filter((c) => !localPorId.has(c.id))
         .map((c) => `${c.id} · R$ ${c.value ?? '?'} · ${c.status ?? '?'} · ref ${c.externalReference ?? '(vazia)'}`))

  // Sol F6 · P1: id espelhado com STATUS divergente = webhook perdido/fora de
  // ordem — o espelho está mentindo baixinho.
  bloco('espelho DESATUALIZADO (status externo ≠ local — reenviar o evento no painel)',
    vivas.filter((c) => {
      const local = localPorId.get(c.id)
      return local && String(c.status ?? '') !== String(local.status ?? '')
    }).map((c) => `${c.id}: Asaas=${c.status} × local=${localPorId.get(c.id)?.status}`))

  // Duplicidade só entre ATIVAS de verdade (Sol F6 · P2): estornada/cancelada
  // não deletada + substituta legítima não é duplicidade.
  const porRef = new Map<string, number>()
  for (const c of vivas) {
    if (NAO_COBRAVEL.test(String(c.status ?? ''))) continue
    const ref = c.externalReference?.trim()
    if (ref) porRef.set(ref, (porRef.get(ref) ?? 0) + 1)
  }
  bloco('externalReference com 2+ cobranças ativas (duplicidade — cancelar sobras no painel)',
    [...porRef.entries()].filter(([, n]) => n > 1).map(([ref, n]) => `${ref}: ${n} cobranças`))
}

console.log(`\n${excecoes === 0 ? '✓ reconciliação LIMPA — nenhuma exceção.' : `✗ ${excecoes} exceção(ões) — resolver antes de dar o religamento por concluído.`}`)
process.exit(excecoes === 0 ? 0 : 1)
