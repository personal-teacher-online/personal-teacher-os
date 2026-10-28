import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { safeTokenEqual } from '@/lib/auth/token'
import { getActiveBrandVoice, type BrandVoice } from '@/lib/content/voice'

// Núcleo das rotas /api/content/* (ADR-021) — superfície de escrita do pipeline
// n8n da fábrica de conteúdo. Padrão handleDispatchOutbox: client e I/O de
// imagem INJETADOS, sem `import 'server-only'`, para o Vitest provar o 401
// fail-closed e a idempotência sem HTTP. As rotas são wrappers finos que leem o
// header 'content-api-token' e a env CONTENT_API_TOKEN.
//
// A MÁQUINA DE ESTADOS É DO BANCO (Lei 3): estes handlers só fazem UPDATEs
// condicionais (lock otimista por status) e traduzem o erro do guard para o n8n.

// ── MIOLOS DE DOMÍNIO (M2, ADR-031) ──────────────────────────────────────────
// O gerador passou a ser IN-APP: as mesmas transições agora são chamadas de
// dentro do servidor (action "Gerar agora" e rota de cron), onde não existe
// token nem body HTTP. Os miolos abaixo falam DOMÍNIO; os handleContent* viraram
// adaptadores que só traduzem transporte (token, zod, status HTTP).
//
// O cadeado continua sendo o UPDATE condicional por status (Lei 3) — dois
// cliques, duas abas, ou action e cron na mesma janela: só o primeiro escreve.
// Post que morrer em `gerando` (processo caiu entre o claim e o desfecho) volta
// pelo botão "Destravar" do painel; NÃO existe job varrendo órfão (plano v3).

export type PostFailure =
  | { ok: false; reason: 'not_found'; detail: string }
  | { ok: false; reason: 'conflict'; detail: string }
  | { ok: false; reason: 'error'; detail: string }

export type PostOutcome = { ok: true } | PostFailure
export type ClaimOutcome = { ok: true; attempt: number } | PostFailure

/** ideia_aprovada → gerando. Devolve a tentativa que este claim consumiu. */
export async function claimContentPost(db: SupabaseClient, postId: string): Promise<ClaimOutcome> {
  const { data: current, error: readErr } = await db
    .from('content_posts')
    .select('generation_attempts')
    .eq('id', postId)
    .maybeSingle()
  if (readErr) return { ok: false, reason: 'error', detail: readErr.message }
  if (!current) return { ok: false, reason: 'not_found', detail: 'post não existe' }

  const attempt = current.generation_attempts + 1
  // O cadeado é o filtro por status: se outro run reivindicou antes, 0 linhas.
  // A corrida no incremento de attempts é inofensiva (o perdedor não escreve).
  const { data, error } = await db
    .from('content_posts')
    .update({
      status: 'gerando',
      generation_started_at: new Date().toISOString(),
      generation_attempts: attempt,
    })
    .eq('id', postId)
    .eq('status', 'ideia_aprovada')
    .select('id')
  if (error) return { ok: false, reason: 'error', detail: error.message }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'conflict', detail: 'post não está em ideia_aprovada' }
  }
  return { ok: true, attempt }
}

export interface DeliverInput {
  postId: string
  legenda: string
  roteiro?: string | null
  slides?: unknown[]
  /** Já persistidas (Drive) pelo chamador — o miolo não faz I/O de imagem. */
  images?: unknown[]
  imageProvider?: string | null
  generationMeta?: Record<string, unknown>
  brandVoiceVersion?: number | null
}

/** gerando → rascunho. */
export async function deliverContentPost(
  db: SupabaseClient,
  input: DeliverInput,
): Promise<PostOutcome> {
  const { data, error } = await db
    .from('content_posts')
    .update({
      status: 'rascunho',
      legenda: input.legenda,
      roteiro: input.roteiro ?? null,
      slides: input.slides ?? [],
      images: input.images ?? [],
      image_provider: input.imageProvider ?? null,
      generation_meta: input.generationMeta ?? {},
      generation_error: null,
      brand_voice_version: input.brandVoiceVersion ?? null,
    })
    .eq('id', input.postId)
    .eq('status', 'gerando')
    .select('id')
  if (error) return { ok: false, reason: 'error', detail: error.message }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'conflict', detail: 'post saiu de gerando durante a entrega' }
  }
  return { ok: true }
}

/** gerando → ideia_aprovada, com o erro visível no painel. CONSOME a tentativa. */
export async function failContentPost(
  db: SupabaseClient,
  input: { postId: string; error: string },
): Promise<PostOutcome> {
  const { data, error } = await db
    .from('content_posts')
    .update({ status: 'ideia_aprovada', generation_error: input.error })
    .eq('id', input.postId)
    .eq('status', 'gerando')
    .select('id')
  if (error) return { ok: false, reason: 'error', detail: error.message }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'conflict', detail: 'post não está em gerando' }
  }
  return { ok: true }
}

/** Rejeição da revisora (portão 1 ou 2). ZERA o contador: `generation_attempts`
 *  significa "tentativas desde a última rejeição" — o motivo entra no próximo
 *  prompt como feedback, então a rodada recomeça de verdade. O histórico
 *  integral sobrevive em `generation_meta` e no `audit_log` (Lei 8). */
export async function rejectContentPost(
  db: SupabaseClient,
  input: { postId: string; motivo: string },
): Promise<PostOutcome> {
  const { data, error } = await db
    .from('content_posts')
    .update({
      status: 'rejeitado',
      rejection_reason: input.motivo,
      generation_attempts: 0,
    })
    .eq('id', input.postId)
    // O guard só admite rejeitar destes dois estados; filtrar aqui transforma a
    // transição ilegal em conflito honesto em vez de exceção crua do Postgres.
    .in('status', ['ideia', 'rascunho'])
    .select('id')
  if (error) return { ok: false, reason: 'error', detail: error.message }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'conflict', detail: 'post não pode ser rejeitado neste estado' }
  }
  return { ok: true }
}

export interface ContentAuth {
  token: string | null
  expectedToken: string | undefined
}

export interface HandlerResult {
  status: number
  body: Record<string, unknown>
}

const unauthorized: HandlerResult = { status: 401, body: { ok: false, detail: 'token inválido' } }

/** Tradução domínio → HTTP, para os adaptadores das rotas do ADR-021. */
function httpFrom(failure: PostFailure): HandlerResult {
  const status = failure.reason === 'not_found' ? 404 : failure.reason === 'conflict' ? 409 : 500
  return { status, body: { ok: false, detail: failure.detail } }
}

function authorized(auth: ContentAuth): boolean {
  // Fail-closed IGUAL ao dispatch-outbox: sem env configurada, a rota é INOPERANTE.
  return Boolean(auth.expectedToken && auth.token && safeTokenEqual(auth.token, auth.expectedToken))
}

// ⚠️ `POST /api/content/ideias` MORREU na Leva 6.3 (decisão do dono, 04/08).
//
// Era a porta HTTP por token que criava ideia de ROBÔ (`created_by` nulo, sem
// `trend_id`) direto no Portão 1. O Portão 1 deixou de existir no cutover da
// Leva 5, e a Leva 6.2 desligou o aviso que essas ideias disparavam: elas
// passariam a entrar na fila EM SILÊNCIO, esperando uma aprovação que nenhuma
// tela pede mais. Quem cria roteiro hoje é o radar (`gerar_roteiro_da_trend`) ou
// a própria Teacher Vicky, pelo "Roteiro avulso". Foram embora com ela a rota, o miolo
// `src/lib/content/ideias.ts` e o schema deste arquivo.
//
// As outras rotas `/api/content/*` (fila, claim, entrega, erro, refs) continuam
// de pé: elas LEEM a fila e entregam resultado, não criam pauta.

/** GET /api/content/fila — próximos posts aprovados no portão 1 + voz da marca ativa. */
export async function handleContentFila(
  admin: SupabaseClient,
  auth: ContentAuth,
): Promise<HandlerResult> {
  if (!authorized(auth)) return unauthorized
  let voice: BrandVoice | null
  try {
    voice = await getActiveBrandVoice(admin)
  } catch (err) {
    return { status: 500, body: { ok: false, detail: (err as Error).message } }
  }
  const { data: posts, error } = await admin
    .from('content_posts')
    .select(
      'id, kind, tema, gancho, idea, rejection_reason, scheduled_for, generation_attempts, idea_approved_at',
    )
    .eq('status', 'ideia_aprovada')
    .order('idea_approved_at', { ascending: true })
    .limit(3)
  if (error) return { status: 500, body: { ok: false, detail: error.message } }
  return {
    status: 200,
    // Projeção explícita: o contrato do pipeline não enxerga created_at.
    body: {
      ok: true,
      brand_voice: voice ? { version: voice.version, content_md: voice.content_md } : null,
      posts: posts ?? [],
    },
  }
}

const claimBody = z.object({ post_id: z.uuid() })

/** POST /api/content/claim — cadeado: ideia_aprovada → gerando (condicional, atômico). */
export async function handleContentClaim(
  admin: SupabaseClient,
  auth: ContentAuth,
  body: unknown,
): Promise<HandlerResult> {
  if (!authorized(auth)) return unauthorized
  const parsed = claimBody.safeParse(body)
  if (!parsed.success) {
    return { status: 400, body: { ok: false, detail: z.prettifyError(parsed.error) } }
  }
  const res = await claimContentPost(admin, parsed.data.post_id)
  if (!res.ok) return httpFrom(res)
  return { status: 200, body: { ok: true } }
}

const slideSchema = z.object({
  ordem: z.number().int().min(1).max(10),
  titulo: z.string().max(200).optional(),
  texto: z.string().max(2000),
  // Expressão-alvo que vira a faixa da marca no cartão. Explícito porque
  // deduzir pela posição na frase falhou no primeiro post real (ver compose).
  termo: z.string().max(120).optional(),
  prompt_imagem: z.string().max(2000).optional(),
})

const imageInSchema = z
  .object({
    slide: z.number().int().min(1).max(10).optional(),
    // Duas versões de cada cena para a Teacher Vicky escolher (decisão do mantenedor,
    // 21/07): a PRIMEIRA de cada slide é a que vale; alternar = reordenar.
    variante: z.number().int().min(1).max(4).optional(),
    provider: z.string().min(1).max(60),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    // Exatamente UM: base64 (Gemini devolve inline) ou url (fal devolve link).
    base64: z.string().min(1).optional(),
    url: z.url().optional(),
  })
  .refine((i) => Boolean(i.base64) !== Boolean(i.url), {
    message: 'imagem exige exatamente um de base64/url',
  })

const entregaBody = z.object({
  post_id: z.uuid(),
  legenda: z.string().trim().min(1).max(4000),
  roteiro: z.string().max(8000).optional(),
  slides: z.array(slideSchema).max(10).optional(),
  // 10 slides × 2 versões de cena é o teto real do formato.
  images: z.array(imageInSchema).max(20).default([]),
  generation_meta: z.record(z.string(), z.unknown()).optional(),
  brand_voice_version: z.number().int().min(1).optional(),
})

/** Persistência de imagem (Drive — Lei 10) injetada pela rota; ver images.ts. */
export interface ImageSink {
  persist(args: {
    postId: string
    slide: number | null
    mime: string
    data: Uint8Array
  }): Promise<{ drive_file_id: string }>
  fetchUrl(url: string): Promise<{ mime: string; data: Uint8Array }>
}

// ~8MB de imagem por slide é teto generoso (Nano Banana 4:5 fica bem abaixo).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** POST /api/content/entrega — gerando → rascunho, com imagens persistidas no Drive. */
export async function handleContentEntrega(
  admin: SupabaseClient,
  auth: ContentAuth,
  body: unknown,
  sink: ImageSink,
): Promise<HandlerResult> {
  if (!authorized(auth)) return unauthorized
  const parsed = entregaBody.safeParse(body)
  if (!parsed.success) {
    return { status: 400, body: { ok: false, detail: z.prettifyError(parsed.error) } }
  }
  const p = parsed.data
  const { data: current, error: readErr } = await admin
    .from('content_posts')
    .select('status')
    .eq('id', p.post_id)
    .maybeSingle()
  if (readErr) return { status: 500, body: { ok: false, detail: readErr.message } }
  if (!current) return { status: 404, body: { ok: false, detail: 'post não existe' } }
  if (current.status !== 'gerando') {
    return { status: 409, body: { ok: false, detail: `post está ${current.status}, não gerando` } }
  }

  const stored: Array<{
    slide: number | null
    variante: number
    drive_file_id: string
    provider: string
  }> = []
  try {
    for (const img of p.images) {
      let mime: string
      let data: Uint8Array
      if (img.base64) {
        data = Uint8Array.from(Buffer.from(img.base64, 'base64'))
        mime = img.mime ?? 'image/png'
      } else {
        const fetched = await sink.fetchUrl(img.url as string)
        data = fetched.data
        mime = fetched.mime
      }
      if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
        return { status: 400, body: { ok: false, detail: 'imagem vazia ou acima de 8MB' } }
      }
      const saved = await sink.persist({
        postId: p.post_id,
        slide: img.slide ?? null,
        mime,
        data,
      })
      stored.push({
        slide: img.slide ?? null,
        variante: img.variante ?? 1,
        drive_file_id: saved.drive_file_id,
        provider: img.provider,
      })
    }
  } catch (err) {
    // Falha de Drive/download vira erro HONESTO para o n8n (que devolve o post
    // à fila via /erro) — o post segue em 'gerando' até lá.
    return { status: 502, body: { ok: false, detail: (err as Error).message } }
  }

  // Corrida raríssima no conflito abaixo (destravado no meio): imagens já no
  // Drive ficam órfãs — aceitável no v1 (painel referencia só images jsonb).
  const res = await deliverContentPost(admin, {
    postId: p.post_id,
    legenda: p.legenda,
    roteiro: p.roteiro,
    slides: p.slides,
    images: stored,
    imageProvider: p.images[0]?.provider ?? null,
    generationMeta: p.generation_meta,
    brandVoiceVersion: p.brand_voice_version,
  })
  if (!res.ok) return httpFrom(res)
  return { status: 200, body: { ok: true, images: stored.length } }
}

const erroBody = z.object({
  post_id: z.uuid(),
  error: z.string().trim().min(1).max(4000),
})

/** POST /api/content/erro — devolve gerando → ideia_aprovada com o erro visível. */
export async function handleContentErro(
  admin: SupabaseClient,
  auth: ContentAuth,
  body: unknown,
): Promise<HandlerResult> {
  if (!authorized(auth)) return unauthorized
  const parsed = erroBody.safeParse(body)
  if (!parsed.success) {
    return { status: 400, body: { ok: false, detail: z.prettifyError(parsed.error) } }
  }
  const res = await failContentPost(admin, {
    postId: parsed.data.post_id,
    error: parsed.data.error,
  })
  if (!res.ok) return httpFrom(res)
  return { status: 200, body: { ok: true } }
}

/** Fonte das fotos de referência (Drive) injetada pela rota; ver images.ts. */
export interface RefSource {
  list(): Promise<Array<{ mime: string; base64: string }>>
}

/** GET /api/content/refs — fotos de referência da Vic para o provedor de imagem. */
export async function handleContentRefs(
  auth: ContentAuth,
  refs: RefSource,
): Promise<HandlerResult> {
  if (!authorized(auth)) return unauthorized
  try {
    const list = await refs.list()
    return { status: 200, body: { ok: true, refs: list } }
  } catch (err) {
    return { status: 502, body: { ok: false, detail: (err as Error).message } }
  }
}
