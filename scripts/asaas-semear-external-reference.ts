// Semeadura de `externalReference` nas ASSINATURAS do Asaas (F4 da onda
// Financeiro) — transforma o passo 1 do religamento (runbook §N.3, "pendência
// herdada da F2") de trabalho manual em script.
//
// O que faz: lista as assinaturas do Asaas, casa cada uma com um contrato
// local VIGENTE pelo e-mail do cliente (matching puro em
// src/lib/asaas/semeadura.ts) e:
//   - por padrão: SÓ RELATA (read-only) — contagens + sobras. Este relatório é
//     o gate do F4 com o dono.
//   - com --apply: grava `externalReference = <uuid do contrato>` via PUT
//     (MERGE provado no gate F0 — só o campo enviado muda) SÓ nas inequívocas,
//     e faz o bootstrap do pagador (payers + vínculo student_payers como
//     TERCEIRO, só contrato individual — regra do F3). Ambiguidade NUNCA é
//     aplicada automaticamente.
//   - rollout um-depois-todos: `--apply --uma sub_xxx` aplica UMA assinatura
//     (conferir no painel) antes de rodar `--apply` para o resto.
//
// Snapshot: TODA execução salva o retrato cru das assinaturas em
// _rascunhos/ (gitignored) — é o "antes" auditável de qualquer --apply.
//
// Uso: npm run asaas:semear                       (local/sandbox, read-only)
//      npm run asaas:semear -- --apply --uma sub_xxx
//      npm run asaas:semear -- --apply
//      npm run asaas:semear:prod -- ...           (F6 — key de produção SÓ lá)

import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'
import {
  asaasConfigFromEnv,
  atualizarAssinatura,
  buscarCliente,
  listarAssinaturas,
  type AsaasAssinatura,
  type AsaasCliente,
} from '../src/lib/asaas/client.ts'
import {
  classificarAssinatura,
  type AlunoLocal,
  type Classificacao,
  type ContratoLocal,
  type IndiceLocal,
} from '../src/lib/asaas/semeadura.ts'

const APPLY = process.argv.includes('--apply')
const umaIdx = process.argv.indexOf('--uma')
const UMA = umaIdx >= 0 ? process.argv[umaIdx + 1] : null
if (umaIdx >= 0 && !UMA?.startsWith('sub_')) {
  console.error('--uma exige o id da assinatura (sub_…)')
  process.exit(1)
}

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

console.log(`\n=== SEMEADURA ASAAS — ambiente ${cfg.ambiente.toUpperCase()} (${cfg.baseUrl})`)
console.log(`=== banco: ${supaUrl}`)
console.log(`=== modo: ${APPLY ? (UMA ? `APLICAR UMA (${UMA})` : 'APLICAR TODAS as inequívocas') : 'read-only (relatório)'}\n`)

/* ------------------------------------------------------------ índice local */

async function montarIndiceLocal(): Promise<IndiceLocal> {
  // E-mail de login por profile (auth.users, paginado — escala-alvo 50 alunos).
  const emailPorProfile = new Map<string, string>()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers falhou: ${error.message}`)
    for (const u of data.users) if (u.email) emailPorProfile.set(u.id, u.email.toLowerCase())
    if (data.users.length < 1000) break
  }

  const { data: students, error: sErr } = await db
    .from('students')
    .select('id, display_name, profile_id')
  if (sErr) throw new Error(`students: ${sErr.message}`)

  const alunosPorEmail = new Map<string, AlunoLocal>()
  const alunoPorId = new Map<string, AlunoLocal>()
  for (const s of students ?? []) {
    const email = s.profile_id ? emailPorProfile.get(s.profile_id) : undefined
    const aluno: AlunoLocal = { studentId: s.id, nome: s.display_name, email: email ?? '' }
    alunoPorId.set(s.id, aluno)
    if (email) alunosPorEmail.set(email, aluno)
  }

  // Contratos particulares VIGENTES hoje (vigência decide — mesmo critério do
  // previsto do F2; status não decide, renovação agendada continua vigente).
  // "Hoje" vem do BANCO (business_today() = America/Cuiaba — Sol F4 · P2):
  // computar aqui em outro fuso descolava da régua na virada do dia.
  const { data: hoje, error: hErr } = await db.rpc('business_today')
  if (hErr || typeof hoje !== 'string') throw new Error(`business_today: ${hErr?.message ?? 'sem data'}`)
  const { data: contratos, error: cErr } = await db
    .from('contracts')
    .select('id, plan_name, student_id, student_group_id')
    .eq('contract_type', 'private_1on1')
    .lte('started_on', hoje)
    .or(`ended_on.is.null,ended_on.gte.${hoje}`)
  if (cErr) throw new Error(`contracts: ${cErr.message}`)

  const { data: membros, error: mErr } = await db
    .from('student_group_members')
    .select('group_id, student_id')
  if (mErr) throw new Error(`group_members: ${mErr.message}`)
  const membrosPorGrupo = new Map<string, string[]>()
  for (const m of membros ?? []) {
    membrosPorGrupo.set(m.group_id, [...(membrosPorGrupo.get(m.group_id) ?? []), m.student_id])
  }

  const contratosPorStudent = new Map<string, ContratoLocal[]>()
  const contratosPorId = new Map<string, ContratoLocal>()
  for (const c of contratos ?? []) {
    const studentIds: string[] = c.student_id
      ? [c.student_id]
      : (membrosPorGrupo.get(c.student_group_id ?? '') ?? [])
    const contrato: ContratoLocal = {
      id: c.id,
      tipo: c.student_id ? 'individual' : 'grupo',
      planName: c.plan_name,
      studentIds,
    }
    contratosPorId.set(c.id, contrato)
    for (const sid of studentIds) {
      contratosPorStudent.set(sid, [...(contratosPorStudent.get(sid) ?? []), contrato])
    }
  }
  return { alunosPorEmail, contratosPorStudent, contratosPorId }
}

/* ------------------------------------------------------------ classificação */

const indice = await montarIndiceLocal()
const assinaturas = await listarAssinaturas(cfg)

mkdirSync('_rascunhos', { recursive: true })
const stamp = DateTime.now().setZone('America/Sao_Paulo').toFormat("yyyy-MM-dd'T'HHmmss")
const snapshotPath = `_rascunhos/asaas-snapshot-assinaturas-${cfg.ambiente}-${stamp}.json`
writeFileSync(snapshotPath, JSON.stringify(assinaturas, null, 2))
console.log(`snapshot (antes de qualquer escrita): ${snapshotPath} — ${assinaturas.length} assinatura(s)\n`)

const clientes = new Map<string, AsaasCliente>()
async function cliente(id: string | null | undefined): Promise<AsaasCliente | null> {
  if (!id) return null
  if (!clientes.has(id)) clientes.set(id, await buscarCliente(cfg!, id))
  return clientes.get(id) ?? null
}

interface Linha {
  sub: AsaasAssinatura
  cliente: AsaasCliente | null
  classe: Classificacao | { tipo: 'ignorada'; motivo: string }
}
const linhas: Linha[] = []
for (const sub of assinaturas) {
  if (sub.deleted) {
    linhas.push({ sub, cliente: null, classe: { tipo: 'ignorada', motivo: 'deleted' } })
    continue
  }
  if (sub.status && sub.status !== 'ACTIVE') {
    linhas.push({ sub, cliente: null, classe: { tipo: 'ignorada', motivo: `status ${sub.status}` } })
    continue
  }
  const cli = await cliente(sub.customer)
  linhas.push({ sub, cliente: cli, classe: classificarAssinatura(sub, cli ?? {}, indice) })
}

/* --------------------------------------------------------------- relatório */

function rotulo(l: Linha): string {
  const quem = l.cliente ? `${l.cliente.name ?? '?'} <${l.cliente.email ?? 'sem e-mail'}>` : '(sem cliente)'
  const base = `${l.sub.id} · ${quem} · R$ ${l.sub.value ?? '?'} ${l.sub.cycle ?? ''}`
  const c = l.classe
  switch (c.tipo) {
    case 'inequivoca':
      return `${base}\n    → contrato ${c.contrato.id} (${c.contrato.planName}, ${c.contrato.tipo}) de ${c.aluno.nome}`
    case 'ja-semeada':
      return `${base}\n    → já aponta para o contrato ${c.contrato.id} (${c.contrato.planName})`
    case 'referencia-estranha':
      return `${base}\n    → externalReference preenchida com valor DESCONHECIDO (${c.referencia}) — não tocar; resolver à mão`
    case 'ambigua':
      return `${base}\n    → ${c.aluno.nome} tem ${c.contratos.length} contratos vigentes (${c.contratos.map((x) => x.planName).join(', ')}) — decidir à mão`
    case 'sem-contrato-vigente':
      return `${base}\n    → e-mail é de ${c.aluno.nome}, mas sem contrato particular vigente hoje`
    case 'sem-aluno':
      return `${base}\n    → e-mail ${c.email ?? '(vazio)'} não bate com nenhum aluno convidado — sobra manual`
    case 'ignorada':
      return `${base}\n    → ignorada (${c.motivo})`
  }
}

const porClasse = new Map<string, Linha[]>()
for (const l of linhas) {
  porClasse.set(l.classe.tipo, [...(porClasse.get(l.classe.tipo) ?? []), l])
}
const ORDEM = ['inequivoca', 'ja-semeada', 'ambigua', 'sem-contrato-vigente', 'sem-aluno', 'referencia-estranha', 'ignorada']
console.log('--- contagens')
console.log(`contratos particulares vigentes hoje: ${indice.contratosPorId.size}`)
console.log(`alunos com e-mail de login: ${indice.alunosPorEmail.size}`)
for (const t of ORDEM) console.log(`${t}: ${(porClasse.get(t) ?? []).length}`)
console.log('\n--- assinaturas')
for (const t of ORDEM) for (const l of porClasse.get(t) ?? []) console.log(`[${t}] ${rotulo(l)}`)

/* ------------------------------------------------------------------- apply */

if (!APPLY) {
  console.log('\nread-only: nada foi escrito. Para aplicar: --apply --uma sub_xxx, depois --apply.')
  process.exit(0)
}

// Escrita local SÓ pela RPC transacional `asaas_bootstrap_pagador` (Sol F4 ·
// P1: service_role não tem — e não deve ter — privilégio direto em
// payers/student_payers). Falha na RPC ⇒ nada gravado.
async function bootstrapPagador(
  cli: AsaasCliente | null,
  contrato: ContratoLocal,
  subId: string
): Promise<string | null> {
  if (!cli) return null
  const { data, error } = await db.rpc('asaas_bootstrap_pagador', {
    p_asaas_customer_id: cli.id,
    p_name: cli.name ?? null,
    p_email: cli.email ?? null,
    p_cpf_cnpj: cli.cpfCnpj ?? null,
    // Vínculo TERCEIRO só em contrato individual (regra do F3; grupo é manual).
    p_student_id: contrato.tipo === 'individual' ? contrato.studentIds[0] : null,
    p_contexto: {
      script: 'scripts/asaas-semear-external-reference.ts',
      ambiente: cfg!.ambiente,
      subscription: subId,
      contract_id: contrato.id,
      snapshot: snapshotPath,
    },
  })
  if (error) throw new Error(`asaas_bootstrap_pagador: ${error.message}`)
  return typeof data === 'string' ? data : null
}

const inequivocas = (porClasse.get('inequivoca') ?? []) as Array<
  Linha & { classe: Extract<Classificacao, { tipo: 'inequivoca' }> }
>
const jaSemeadas = (porClasse.get('ja-semeada') ?? []) as Array<
  Linha & { classe: Extract<Classificacao, { tipo: 'ja-semeada' }> }
>

let alvo = inequivocas
if (UMA) {
  alvo = alvo.filter((l) => l.sub.id === UMA)
  if (alvo.length === 0) {
    console.error(`\n--uma ${UMA}: não é uma assinatura inequívoca deste relatório — nada aplicado.`)
    process.exit(1)
  }
}

let falhas = 0
let falhasCura = 0
for (const l of alvo) {
  const { contrato, aluno } = l.classe
  try {
    // Ordem: local ANTES do remoto. Se o bootstrap falhar, o Asaas não mudou;
    // se o PUT falhar depois, a assinatura segue inequívoca e a nova rodada
    // repete o bootstrap (idempotente) e re-tenta o PUT — sempre retomável.
    await bootstrapPagador(l.cliente, contrato, l.sub.id)

    const depois = await atualizarAssinatura(cfg, l.sub.id, { externalReference: contrato.id })
    if (depois.externalReference !== contrato.id) {
      throw new Error(`PUT não refletiu: externalReference veio "${depois.externalReference}"`)
    }

    const { error: audErr } = await db.from('audit_log').insert({
      actor: null,
      action: 'asaas.semear_external_reference',
      entity: 'asaas_subscription',
      entity_id: l.sub.id,
      diff: {
        script: 'scripts/asaas-semear-external-reference.ts',
        ambiente: cfg.ambiente,
        contract_id: contrato.id,
        customer: l.cliente?.id ?? null,
        snapshot: snapshotPath,
      },
    })
    if (audErr) throw new Error(`audit_log: ${audErr.message} (o PUT JÁ foi aplicado)`)

    const vinculo =
      contrato.tipo === 'individual' ? 'vínculo terceiro ok' : 'GRUPO — vínculo de pagador é manual'
    console.log(`✓ ${l.sub.id} → ${contrato.id} (${aluno.nome}; ${vinculo})`)
  } catch (e) {
    falhas++
    console.error(`✗ ${l.sub.id}: ${e instanceof Error ? e.message : e}`)
  }
}

// Cura de rodada anterior (Sol F4 · P1): assinatura já apontando para um
// contrato local também passa pelo bootstrap — um --apply que caiu entre o
// PUT e a escrita local deixa de ser buraco permanente.
if (!UMA) {
  for (const l of jaSemeadas) {
    try {
      await bootstrapPagador(l.cliente, l.classe.contrato, l.sub.id)
    } catch (e) {
      falhasCura++
      console.error(`✗ (cura) ${l.sub.id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  if (jaSemeadas.length > 0) {
    console.log(`cura de bootstrap nas já-semeadas: ${jaSemeadas.length - falhasCura}/${jaSemeadas.length}`)
  }
}

console.log(`\naplicadas: ${alvo.length - falhas}/${alvo.length}${UMA ? ' (rollout de UMA — conferir no painel antes do resto)' : ''}`)
process.exit(falhas + falhasCura > 0 ? 1 : 0)
