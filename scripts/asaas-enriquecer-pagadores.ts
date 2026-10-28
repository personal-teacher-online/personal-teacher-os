// Lote de enriquecimento dos STUBS de pagador (F4 da onda Financeiro).
//
// O webhook (Lei 6: nunca HTTP lá dentro) cria o pagador como stub
// auto-detectável — name = asaas_customer_id (decisão do PLAN-APPROVED F3).
// Este lote fecha o ciclo: para cada stub, GET /customers/{id} e grava
// name/email/cpf_cnpj reais. Consumidor único do endpoint de clientes
// (a ação/UI "completar cadastro" foi ADIADA).
//
// Uso: npm run asaas:enriquecer            (read-only: lista os stubs)
//      npm run asaas:enriquecer -- --apply
//      npm run asaas:enriquecer:prod -- ...

import { createClient } from '@supabase/supabase-js'
import { asaasConfigFromEnv, buscarCliente } from '../src/lib/asaas/client.ts'

const APPLY = process.argv.includes('--apply')

const cfg = asaasConfigFromEnv()
if (!cfg) {
  console.error('ASAAS_API_KEY/ASAAS_ENV ausentes ou inválidas — nada a fazer (fail-closed).')
  process.exit(1)
}
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supaUrl || !supaKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.')
  process.exit(1)
}
const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } })

console.log(`\n=== ENRIQUECIMENTO DE PAGADORES — ambiente ${cfg.ambiente.toUpperCase()} (${cfg.baseUrl})`)
console.log(`=== banco: ${supaUrl} · modo: ${APPLY ? 'APLICAR' : 'read-only'}\n`)

// Stub = name igual ao asaas_customer_id (única marca; sem coluna extra — F3).
// Leitura e escrita SÓ por RPC service_role-only (Sol F4 · P1: o script não
// tem — e não deve ter — privilégio direto em payers).
const { data: stubs, error } = await db.rpc('asaas_pagadores_stub')
if (error) {
  console.error(`asaas_pagadores_stub: ${error.message}`)
  process.exit(1)
}
const alvo = (stubs ?? []) as Array<{ payer_id: string; asaas_customer_id: string }>
console.log(`stubs a enriquecer: ${alvo.length}`)

let falhas = 0
for (const p of alvo) {
  try {
    const cli = await buscarCliente(cfg, p.asaas_customer_id)
    if (!APPLY) {
      console.log(`· ${p.asaas_customer_id} → ${cli.name ?? '?'} <${cli.email ?? 'sem e-mail'}> (dry-run)`)
      continue
    }
    // A RPC enriquece SÓ stub e audita na mesma transação; sem vínculo aqui.
    const { error: rpcErr } = await db.rpc('asaas_bootstrap_pagador', {
      p_asaas_customer_id: cli.id,
      p_name: cli.name ?? null,
      p_email: cli.email ?? null,
      p_cpf_cnpj: cli.cpfCnpj ?? null,
      p_student_id: null,
      p_contexto: { script: 'scripts/asaas-enriquecer-pagadores.ts', ambiente: cfg.ambiente },
    })
    if (rpcErr) throw new Error(`asaas_bootstrap_pagador: ${rpcErr.message}`)
    console.log(`✓ ${p.asaas_customer_id} → ${cli.name ?? '?'}`)
  } catch (e) {
    falhas++
    console.error(`✗ ${p.asaas_customer_id}: ${e instanceof Error ? e.message : e}`)
  }
}

console.log(`\n${APPLY ? 'enriquecidos' : 'listados'}: ${alvo.length - falhas}/${alvo.length}`)
process.exit(falhas > 0 ? 1 : 0)
