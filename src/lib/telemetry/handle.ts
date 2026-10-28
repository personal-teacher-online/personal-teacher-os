import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Núcleo das rotas /api/beacon e /api/client-error (lote "Fundações de dados",
// 26/07). Padrão handleContentIdeias: escrita INJETADA e sem `import
// 'server-only'`, para o Vitest provar o zod, os caps, o dedupe, a redação de
// PII e o rate-limit sem subir HTTP.
//
// Três regras que valem para as duas rotas:
//  1. Telemetria NUNCA quebra nada. O pior desfecho de um payload esquisito é
//     um 204 e a linha não gravada — nunca um erro que suba para o usuário.
//  2. LGPD-mínimo: não recebe nem guarda IP, nem user-agent. O que entra é
//     caminho, mensagem e (quando há sessão) o id do usuário. Mensagem e stack
//     passam pela REDAÇÃO antes de virar linha no banco (redactPii).
//  3. Nada cresce sem teto: corpo capado em BYTES antes de ser bufferizado,
//     rate-limit particionado com número máximo de chaves.

/** Corpo maior que isto é recusado — em BYTES, antes de bufferizar. */
export const BEACON_MAX_BYTES = 2_048
export const CLIENT_ERROR_MAX_BYTES = 16_384

/** Caps de coluna (o banco trunca de novo — aqui é só para não trafegar lixo). */
export const MESSAGE_CAP = 500
export const STACK_CAP = 4_000
export const PATH_CAP = 300

const beaconSchema = z.object({
  path: z.string().trim().min(1).max(PATH_CAP),
  event: z.literal('page_view').default('page_view'),
})

const clientErrorSchema = z.object({
  /** Nome/tipo do erro (TypeError, ChunkLoadError…) — entra na assinatura. */
  name: z.string().trim().max(120).nullish(),
  message: z.string().trim().min(1).max(5_000),
  stack: z.string().max(40_000).nullish(),
  path: z.string().max(2_000).nullish(),
})

export interface TelemetrySink {
  uiEvent(input: {
    userId: string | null
    role: string | null
    path: string
    event: string
  }): Promise<void>
  clientError(input: {
    hash: string
    message: string
    stack: string | null
    path: string | null
    userId: string | null
  }): Promise<void>
}

/** Sink real: as duas RPCs são SECURITY DEFINER concedidas SÓ ao service_role. */
export function supabaseTelemetrySink(admin: SupabaseClient): TelemetrySink {
  return {
    async uiEvent({ userId, role, path, event }) {
      const { error } = await admin.rpc('record_ui_event', {
        p_user: userId,
        p_role: role,
        p_path: path,
        p_event: event,
        p_meta: {},
      })
      if (error) throw new Error(error.message)
    },
    async clientError({ hash, message, stack, path, userId }) {
      const { error } = await admin.rpc('record_client_error', {
        p_hash: hash,
        p_message: message,
        p_stack: stack,
        p_path: path,
        p_user: userId,
      })
      if (error) throw new Error(error.message)
    },
  }
}

/* -------------------------------------------------------- corpo com teto */

/**
 * Lê o corpo com teto em BYTES (correção 9 da revisão de 26/07). O `await
 * req.text()` de antes já tinha bufferizado o corpo INTEIRO na memória do
 * processo antes de qualquer conferência — checar o tamanho depois disso é
 * conferir o extintor depois do incêndio.
 *
 * Duas barreiras: o `Content-Length` declarado (recusa imediata, sem ler nada)
 * e, quando ele não vem — `sendBeacon` com stream, `Transfer-Encoding:
 * chunked` —, um contador de bytes que CANCELA o stream ao passar do limite.
 *
 * Devolve `null` quando o corpo é grande demais (o chamador descarta).
 */
export async function readCappedBody(req: Request, maxBytes: number): Promise<string | null> {
  const declarado = req.headers.get('content-length')
  if (declarado !== null) {
    const n = Number(declarado)
    // Content-Length ilegível é tão suspeito quanto Content-Length grande.
    if (!Number.isFinite(n) || n < 0 || n > maxBytes) return null
  }

  const body = req.body
  if (!body) {
    // Sem stream (Request sintético, ambiente sem body): o texto é o que há —
    // com o Content-Length já conferido acima, e o byte-count conferido aqui.
    const raw = await req.text()
    return new TextEncoder().encode(raw).byteLength > maxBytes ? null : raw
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let lido = 0
  let texto = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      lido += value.byteLength
      if (lido > maxBytes) {
        // Corta a conexão em vez de continuar recebendo: é o único jeito de o
        // teto significar alguma coisa contra quem manda 50 MB de propósito.
        await reader.cancel().catch(() => {})
        return null
      }
      texto += decoder.decode(value, { stream: true })
    }
  } catch {
    // Stream que morre no meio = corpo que não existe. Descarta.
    return null
  }
  return texto + decoder.decode()
}

/* ------------------------------------------------------------ redação PII */

// Cada padrão é uma CATEGORIA que não pode virar linha no banco. A ordem
// importa e é esta: a QUERY STRING vem primeiro porque ela CONTÉM as outras
// (`?token=…`, `?email=…`) — deixá-la para depois fazia a regra de credencial
// comer metade da query e a de query redigir o resto, produzindo
// `?<redigido><redigido>` (pego pelo teste do handler). Depois credencial
// solta, depois e-mail, depois telefone.
const RE_QUERY = /\?[^\s"'<>)\]]+/g
const RE_CREDENCIAL_ESQUEMA = /\b(bearer|basic)\s+[\w.~+/=-]{6,}/gi
const RE_CREDENCIAL_CHAVE =
  /\b(api[_-]?key|apikey|token|secret|password|senha|authorization|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*"?[^\s"',&;)}\]]+/gi
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// E.164 (+5565900000000) e o formato brasileiro escrito à mão ((65) 90000-0000,
// 65 90000 0000, 6590000000). Números curtos (linha, status, id) não casam.
const RE_TELEFONE = /\+\d{10,15}\b|\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g

/**
 * Tira PII do texto ANTES de persistir. O que chega aqui é mensagem e stack de
 * navegador — e mensagem de erro é justamente onde vaza o que ninguém planejou
 * vazar: "falha ao enviar para maria@exemplo.com", a URL inteira com `?token=…`,
 * o número do WhatsApp no corpo de um fetch que falhou.
 *
 * Regra da casa: redigir CEDO (aqui) e não na leitura. Dado que não entrou na
 * tabela não vaza em export, em backup nem em print de tela.
 */
export function redactPii(texto: string): string {
  return texto
    .replace(RE_QUERY, '?<redigido>')
    .replace(RE_CREDENCIAL_ESQUEMA, (_m, esquema: string) => `${esquema} <credencial>`)
    .replace(RE_CREDENCIAL_CHAVE, (_m, chave: string) => `${chave}=<redigido>`)
    .replace(RE_EMAIL, '<email>')
    .replace(RE_TELEFONE, '<telefone>')
}

/* ------------------------------------------------------------- assinatura */

/**
 * Caminho sem identificador: `/admin/alunos/9f1c-…/export` e
 * `/admin/alunos/outro-uuid/export` são a MESMA tela. Sem isto o dedupe de
 * erro viraria uma linha por aluno e o `count` não diria nada.
 */
export function normalizePath(path: string): string {
  const semQuery = path.split('?')[0].split('#')[0]
  return (
    semQuery
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:n')
      .toLowerCase() || '/'
  )
}

/**
 * Mensagem sem os números do caso concreto (ids, linhas, hashes de bundle) —
 * MENOS os de três dígitos, que quase sempre são CÓDIGO e não circunstância:
 * status HTTP (401, 404, 500) e SQLSTATE (23505, esse tem cinco, mas 401 e 500
 * são o caso que importa). Colapsá-los juntava "status 401" com "status 500"
 * numa linha só — dois defeitos completamente diferentes, um de permissão e um
 * de servidor, com o mesmo balde e o mesmo contador.
 *
 * Falso positivo aceito: "line 404" preserva o 404. Preferível ao inverso.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, (n) => (n.length === 3 ? n : '<n>'))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Assinatura do erro: TIPO + mensagem + caminho normalizados (sha-256 hex).
 * O tipo entra porque `TypeError: x is not a function` e
 * `ChunkLoadError: x is not a function` são defeitos de naturezas distintas
 * (bug de código × deploy com bundle velho) e a triagem começa por aí.
 */
export function errorHash(name: string | null, message: string, path: string | null): string {
  const tipo = (name ?? '').trim().toLowerCase() || 'error'
  return createHash('sha256')
    .update(`${tipo}\n${normalizeMessage(message)}\n${normalizePath(path ?? '')}`)
    .digest('hex')
}

/* ------------------------------------------------------------ rate-limit */

/**
 * Chave anônima NÃO-REVERSÍVEL. O sal é sorteado a cada boot: dentro do
 * processo o mesmo IP cai sempre no mesmo balde (que é tudo o que o freio
 * precisa), e o valor guardado/logado não volta a ser um IP nem com tabela
 * pronta — 2^32 IPv4 é varredura de segundos sem sal.
 */
const SAL_ANONIMO = randomBytes(16).toString('hex')

/** Balde de quem não tem sessão: hash do IP da borda, ou um balde único. */
export function anonBucketKey(ip: string | null | undefined): string {
  const limpo = (ip ?? '').split(',')[0].trim()
  if (!limpo) return 'sem-ip'
  return createHash('sha256').update(`${SAL_ANONIMO}:${limpo}`).digest('hex').slice(0, 16)
}

export interface KeyedRateLimiter {
  allow(key: string): boolean
  /** Quantas chamadas o freio já descartou (para o log e para o teste). */
  discarded(): number
}

/**
 * Janela fixa por chave, em MEMÓRIA DO PROCESSO.
 *
 * ⚠️ Limite conhecido e aceito: o app roda em um container só, então "memória
 * do processo" é o app inteiro hoje. Se um dia houver duas réplicas, cada uma
 * terá o próprio freio e o teto efetivo dobra — o que é irrelevante para o que
 * este freio existe (impedir que um laço de render quebrado escreva milhares
 * de linhas por minuto), e melhor do que a alternativa: Redis é PROIBIDO
 * (Lei 5) e um contador no Postgres transformaria cada erro de cliente em uma
 * escrita a mais no banco que talvez já esteja com problema.
 *
 * `maxKeys` existe porque um atacante rodando de mil IPs criaria mil baldes:
 * chaves vencidas são purgadas e, com a mesa cheia, chave NOVA é negada — o
 * freio degrada para "nega desconhecido", nunca para "consome toda a RAM".
 */
export function createKeyedRateLimiter(opts: {
  limit: number
  windowMs: number
  maxKeys?: number
  now?: () => number
  onDiscard?: (key: string, totalDescartes: number) => void
}): KeyedRateLimiter {
  const { limit, windowMs, maxKeys = 1_000, now = Date.now, onDiscard } = opts
  const baldes = new Map<string, { inicio: number; usados: number; avisado: boolean }>()
  let descartes = 0

  const descartar = (key: string, avisar: boolean): boolean => {
    descartes += 1
    if (avisar) onDiscard?.(key, descartes)
    return false
  }

  return {
    allow(key: string): boolean {
      const t = now()
      let b = baldes.get(key)

      if (b && t - b.inicio >= windowMs) {
        b.inicio = t
        b.usados = 0
        b.avisado = false
      }

      if (!b) {
        if (baldes.size >= maxKeys) {
          for (const [k, v] of baldes) if (t - v.inicio >= windowMs) baldes.delete(k)
          // Ainda cheia depois da faxina: mesa lotada nega o desconhecido.
          if (baldes.size >= maxKeys) return descartar(key, false)
        }
        b = { inicio: t, usados: 0, avisado: false }
        baldes.set(key, b)
      }

      if (b.usados >= limit) {
        const primeiro = !b.avisado
        b.avisado = true
        return descartar(key, primeiro)
      }
      b.usados += 1
      return true
    },
    discarded: () => descartes,
  }
}

export interface Quem {
  userId: string | null
  /** anonBucketKey(ip) — só usado quando não há sessão. */
  anonKey: string | null
}

export interface ClientErrorGate {
  allow(quem: Quem): boolean
  discarded(): number
}

/**
 * Freio PARTICIONADO: fila de quem tem sessão separada da de quem não tem.
 * Antes era um teto único do processo — e um anônimo em laço consumia a cota
 * de TODO MUNDO, apagando exatamente o erro da dona que interessa ver.
 * A cota autenticada é por usuário; a anônima, por balde de IP.
 */
export function createClientErrorGate(opts?: {
  authLimit?: number
  anonLimit?: number
  windowMs?: number
  now?: () => number
  onDiscard?: (fila: 'auth' | 'anon', key: string, total: number) => void
}): ClientErrorGate {
  const {
    authLimit = 30,
    anonLimit = 10,
    windowMs = 60_000,
    now,
    onDiscard = (fila: 'auth' | 'anon', _key: string, total: number) =>
      console.warn(`[client-error] rate-limit ${fila}: ${total} descarte(s) no processo`),
  } = opts ?? {}

  const auth = createKeyedRateLimiter({
    limit: authLimit,
    windowMs,
    maxKeys: 500,
    now,
    onDiscard: (k, t) => onDiscard('auth', k, t),
  })
  const anon = createKeyedRateLimiter({
    limit: anonLimit,
    windowMs,
    maxKeys: 2_000,
    now,
    onDiscard: (k, t) => onDiscard('anon', k, t),
  })

  return {
    allow: (quem) =>
      quem.userId ? auth.allow(quem.userId) : anon.allow(quem.anonKey ?? 'sem-ip'),
    discarded: () => auth.discarded() + anon.discarded(),
  }
}

/** Freio do processo (o que as rotas usam de verdade). */
export const clientErrorGate = createClientErrorGate()

/* --------------------------------------------------------------- handlers */

export interface TelemetryResult {
  /** Sempre 204: o cliente não aprende nada com o resultado. */
  status: 204
  /** Só para o teste (e para o log local) saber o que aconteceu. */
  outcome: 'gravado' | 'sem-sessao' | 'grande-demais' | 'invalido' | 'limitado' | 'erro-no-banco'
}

const discard = (outcome: TelemetryResult['outcome']): TelemetryResult => ({ status: 204, outcome })

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * Guarda de tamanho de segunda linha, para quem chama o handler direto (teste,
 * futuro worker). Em UTF-8 o número de CARACTERES nunca passa o de bytes, então
 * `length > max` já prova estouro; o teto em bytes de verdade é readCappedBody.
 */
const grandeDemais = (raw: string, max: number) => raw.length > max

/** POST /api/beacon — page_view de quem TEM sessão (v1 não grava anônimo). */
export async function handleBeacon(
  raw: string,
  session: { userId: string; role: string | null } | null,
  sink: TelemetrySink,
): Promise<TelemetryResult> {
  if (!session) return discard('sem-sessao')
  if (grandeDemais(raw, BEACON_MAX_BYTES)) return discard('grande-demais')
  const parsed = beaconSchema.safeParse(parseJson(raw))
  if (!parsed.success) return discard('invalido')
  try {
    await sink.uiEvent({
      userId: session.userId,
      role: session.role,
      // Caminho NORMALIZADO também aqui: a pergunta é "que TELA ela usa", não
      // "que aluno ela abriu" — e o id na URL seria dado pessoal de terceiro
      // dentro de uma tabela de telemetria.
      path: normalizePath(parsed.data.path).slice(0, PATH_CAP),
      event: parsed.data.event,
    })
  } catch {
    return discard('erro-no-banco')
  }
  return discard('gravado')
}

/** POST /api/client-error — aceita SEM sessão (erro pode ser em página pública). */
export async function handleClientError(
  raw: string,
  quem: Quem,
  sink: TelemetrySink,
  allow: (quem: Quem) => boolean = (q) => clientErrorGate.allow(q),
): Promise<TelemetryResult> {
  if (grandeDemais(raw, CLIENT_ERROR_MAX_BYTES)) return discard('grande-demais')
  const parsed = clientErrorSchema.safeParse(parseJson(raw))
  if (!parsed.success) return discard('invalido')
  if (!allow(quem)) return discard('limitado')

  const path = parsed.data.path ? normalizePath(parsed.data.path).slice(0, PATH_CAP) : null
  // Redigir ANTES do hash: duas ocorrências que só diferem no e-mail de quem
  // estava logado são o MESMO defeito e têm de cair no mesmo balde.
  const nome = parsed.data.name?.trim() || null
  const mensagem = redactPii(parsed.data.message)
  const stack = parsed.data.stack ? redactPii(parsed.data.stack) : null
  const rotulada = nome ? `${nome}: ${mensagem}` : mensagem

  try {
    await sink.clientError({
      hash: errorHash(nome, mensagem, path),
      message: rotulada.slice(0, MESSAGE_CAP),
      stack: stack ? stack.slice(0, STACK_CAP) : null,
      path,
      userId: quem.userId,
    })
  } catch {
    return discard('erro-no-banco')
  }
  return discard('gravado')
}
