// Cliente Asaas (F4 da onda Financeiro). Fatos CONFERIDOS com chamadas reais no
// gate F0 (07/08/2026 — payloads em tests/fixtures/asaas/, prova por item no
// README de lá):
//  - Base sandbox: https://api-sandbox.asaas.com/v3 · produção: https://api.asaas.com/v3
//  - Auth: header `access_token` com a API key (o header de ENTREGA de webhook,
//    `asaas-access-token`, é outro — vive na rota do webhook).
//  - POST /payments NÃO tem idempotência nativa (2 POSTs = 2 cobranças; header
//    Idempotency-Key ignorado) → quem emite defende com claim + GET (F5).
//  - PUT /subscriptions/{id} é MERGE: campos omitidos ficam como estão.
//  - GET /payments?externalReference= é read-your-writes (3/3 imediato).
//  - Dinheiro na API em REAIS decimais; aqui dentro, SEMPRE centavos (Lei 9) —
//    a conversão acontece SÓ nas duas funções abaixo, em nenhum outro lugar.
// Fail-closed sem envs (padrão hotmart/evolution): null → chamador decide
// ("integração desligada"), nunca chamada anônima. ASAAS_API_KEY é server-only;
// a key de PRODUÇÃO só entra na env no F6 (religamento — runbook §N.3).

export interface AsaasConfig {
  apiKey: string
  ambiente: 'sandbox' | 'producao'
  baseUrl: string
}

export function asaasConfigFromEnv(): AsaasConfig | null {
  const apiKey = process.env.ASAAS_API_KEY
  const ambiente = process.env.ASAAS_ENV
  if (!apiKey || (ambiente !== 'sandbox' && ambiente !== 'producao')) return null
  return {
    apiKey,
    ambiente,
    baseUrl:
      ambiente === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3',
  }
}

// ---------------------------------------------------------------- dinheiro
// A ÚNICA fronteira cents↔reais do app (Lei 9). O webhook importa daqui.

/** Reais decimais do Asaas → centavos int. Math.round mata o erro binário (69.99*100 = 6998.999…). */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100)
}

/** Centavos int → reais decimais para o corpo de requisição do Asaas. */
export function centavosParaReais(cents: number): number {
  return Math.round(cents) / 100
}

// ---------------------------------------------------------------- transporte

async function asaas<T>(cfg: AsaasConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: cfg.apiKey,
      ...(init?.headers ?? {}),
    },
    // Teto de 60s em TODA chamada (Sol F5 · P1): a trava de emissão considera
    // estagnada uma claim de > 5 min — o teto garante que nenhum POST do dono
    // antigo ainda esteja no ar quando a retomada acontecer.
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    throw new Error(
      `asaas ${init?.method ?? 'GET'} ${path} falhou: HTTP ${res.status} ${corpo.slice(0, 300)}`
    )
  }
  return (await res.json()) as T
}

interface AsaasLista<T> {
  hasMore?: boolean
  totalCount?: number
  data?: T[]
}

// ---------------------------------------------------------------- cobranças

export interface AsaasCobranca {
  id: string
  customer?: string | null
  value?: number
  status?: string
  billingType?: string
  dueDate?: string
  dateCreated?: string
  paymentDate?: string | null
  clientPaymentDate?: string | null
  invoiceUrl?: string | null
  externalReference?: string | null
  deleted?: boolean
}

export interface NovaCobranca {
  customer: string
  /** BOLETO no sandbox (PIX exige aprovação da conta — medido no F0). */
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED'
  valueCents: number
  /** Data civil 'YYYY-MM-DD' (fuso de Brasília, contrato do Asaas). */
  dueDate: string
  description?: string
  /** Chave de idempotência DA APLICAÇÃO (a API não tem uma): UUID da entidade local. */
  externalReference: string
}

export async function criarCobranca(cfg: AsaasConfig, nova: NovaCobranca): Promise<AsaasCobranca> {
  return asaas<AsaasCobranca>(cfg, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: nova.customer,
      billingType: nova.billingType,
      value: centavosParaReais(nova.valueCents),
      dueDate: nova.dueDate,
      description: nova.description,
      externalReference: nova.externalReference,
    }),
  })
}

/** TODAS as cobranças da conta, paginadas (reconciliação do F6: o universo
 *  EXTERNO que o espelho local precisa cobrir). Teto defensivo: 50 páginas ×
 *  100 — anos de cobrança na escala-alvo de 50 alunos. */
export async function listarCobrancas(cfg: AsaasConfig): Promise<AsaasCobranca[]> {
  const todas: AsaasCobranca[] = []
  for (let offset = 0, pagina = 0; pagina < 50; pagina++) {
    const page = await asaas<AsaasLista<AsaasCobranca>>(
      cfg,
      `/payments?limit=100&offset=${offset}`,
    )
    todas.push(...(page.data ?? []))
    if (!page.hasMore) break
    offset += 100
  }
  return todas
}

/** Reconciliação (F5): antes de POST, procurar cobrança já emitida com a mesma referência. */
export async function listarCobrancasPorReferencia(
  cfg: AsaasConfig,
  externalReference: string
): Promise<AsaasCobranca[]> {
  const page = await asaas<AsaasLista<AsaasCobranca>>(
    cfg,
    `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=100`
  )
  return page.data ?? []
}

// ---------------------------------------------------------------- clientes

export interface AsaasCliente {
  id: string
  name?: string | null
  email?: string | null
  cpfCnpj?: string | null
  mobilePhone?: string | null
  deleted?: boolean
}

/** Consumidor: o lote de enriquecimento dos stubs (scripts/asaas-enriquecer-pagadores.ts)
 *  e o matching da semeadura. UI "completar cadastro" foi ADIADA (PLAN-APPROVED F4). */
export async function buscarCliente(cfg: AsaasConfig, customerId: string): Promise<AsaasCliente> {
  return asaas<AsaasCliente>(cfg, `/customers/${encodeURIComponent(customerId)}`)
}

// ---------------------------------------------------------------- assinaturas

export interface AsaasAssinatura {
  id: string
  customer?: string | null
  value?: number
  status?: string
  cycle?: string
  description?: string | null
  nextDueDate?: string
  externalReference?: string | null
  deleted?: boolean
}

/** TODAS as assinaturas, paginadas. Teto defensivo: 20 páginas × 100 cobre
 *  qualquer futuro da escola (escala-alvo: 50 alunos). */
export async function listarAssinaturas(cfg: AsaasConfig): Promise<AsaasAssinatura[]> {
  const todas: AsaasAssinatura[] = []
  for (let offset = 0, pagina = 0; pagina < 20; pagina++) {
    const page = await asaas<AsaasLista<AsaasAssinatura>>(
      cfg,
      `/subscriptions?limit=100&offset=${offset}`
    )
    todas.push(...(page.data ?? []))
    if (!page.hasMore) break
    offset += 100
  }
  return todas
}

/** PUT é MERGE (provado no F0 com diff before/after: só o campo enviado mudou).
 *  Ainda assim, mandar SÓ o que se quer mudar — nunca reenviar o objeto inteiro. */
export async function atualizarAssinatura(
  cfg: AsaasConfig,
  subscriptionId: string,
  mudanca: { externalReference: string }
): Promise<AsaasAssinatura> {
  return asaas<AsaasAssinatura>(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PUT',
    body: JSON.stringify(mudanca),
  })
}
