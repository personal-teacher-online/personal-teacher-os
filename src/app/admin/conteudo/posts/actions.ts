'use server'

import { redirect } from 'next/navigation'
import { requireAdminId } from '@/lib/auth/admin'
import { createClient } from '@/lib/supabase/server'
import { rejectContentPost } from '@/lib/content/handle'
import { generateReelScript } from '@/lib/content/generate'

// Fábrica de conteúdo (ADR-021): os DOIS portões da Teacher Vicky. Transições e
// imutabilidade são do BANCO (content_posts_guard — Lei 3); aqui só UX e
// tradução de erro, no molde de relatorios/actions.ts.

function back(msg: string): never {
  redirect(`/admin/conteudo/posts?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}
function toPost(id: string, msg: string): never {
  redirect(`/admin/conteudo/${id}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

export async function createIdeaAction(formData: FormData) {
  const actor = await requireAdminId()
  const kind = String(formData.get('kind') ?? '')
  const tema = String(formData.get('tema') ?? '').trim()
  const gancho = String(formData.get('gancho') ?? '').trim()
  if (!kind || !tema) back('Escolha o formato e escreva o tema.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_posts')
    .insert({ kind, tema, gancho: gancho || null, created_by: actor })
    .select('id')
    .single()
  if (error || !data) back(`Falha: ${error?.message ?? 'sem retorno'}`)
  toPost(data.id, 'Roteiro avulso criado — aprove para entrar na fila de geração.')
}

export async function approveIdeaAction(formData: FormData) {
  const actor = await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_posts')
    .update({
      status: 'ideia_aprovada',
      idea_approved_by: actor,
      idea_approved_at: new Date().toISOString(),
    })
    .eq('id', id)
  toPost(id, error ? `Falha: ${error.message}` : 'Ideia aprovada — os agentes vão gerar o rascunho. ✔')
}

export async function rejectPostAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!motivo) toPost(id, 'Diga o motivo — ele vira feedback para os agentes na próxima tentativa.')
  const supabase = await createClient()
  // Miolo de domínio (M2): a rejeição ZERA generation_attempts, senão a rodada
  // nova nasce com o orçamento de tentativas da rodada rejeitada já gasto.
  const res = await rejectContentPost(supabase, { postId: id, motivo })
  toPost(id, res.ok ? 'Rejeitado — o motivo fica registrado como feedback.' : `Falha: ${res.detail}`)
}

/** "Gerar agora" (M2, ADR-031). Síncrona de propósito: a Teacher Vicky vê o rascunho na
 *  volta. O duplo clique morre no claim condicional do banco (Lei 3), não aqui. */
export async function gerarAgoraAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  if (!process.env.ANTHROPIC_API_KEY) {
    toPost(id, 'ANTHROPIC_API_KEY ausente no servidor — sem ela não há geração.')
  }
  const supabase = await createClient()
  try {
    const res = await generateReelScript(supabase, id)
    if (res.ok) toPost(id, 'Rascunho gerado — revise, edite e aprove. ✔')
    if (res.reason === 'sem_voz') {
      toPost(id, 'Publique a voz da marca no Estúdio antes de gerar — nada foi consumido.')
    }
    if (res.reason === 'conflict') {
      toPost(id, 'Alguém já está gerando este post (ou ele saiu da fila). Recarregue a página.')
    }
    toPost(id, `Falha na geração: ${res.detalhe}`)
  } catch (err) {
    // redirect() do Next viaja como exceção — nunca traduzir para "falha".
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    toPost(id, `Falha na geração: ${(err as Error).message}`)
  }
}

export async function updateDraftAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const legenda = String(formData.get('legenda') ?? '').trim()
  // Campo AUSENTE (a tela não desenhou a textarea) é diferente de campo VAZIO
  // (a Teacher Vicky apagou o texto): ausente preserva o que está no banco. Sem essa
  // distinção, um formulário sem o campo apagaria o roteiro em silêncio — o
  // mesmo padrão que os slides já usam logo abaixo.
  const roteiroCru = formData.get('roteiro')
  const roteiro = roteiroCru === null ? null : String(roteiroCru).trim() || null
  if (!legenda) toPost(id, 'A legenda não pode ficar vazia.')

  const supabase = await createClient()
  // Slides: reconstrói os textos a partir dos campos indexados, preservando o
  // resto (prompt_imagem etc.) — o texto do slide NUNCA está na imagem (Lei 11).
  const { data: current } = await supabase
    .from('content_posts')
    .select('slides')
    .eq('id', id)
    .maybeSingle()
  const slides = ((current?.slides ?? []) as Array<Record<string, unknown>>).map((s) => {
    const ordem = s.ordem as number
    const titulo = formData.get(`slide_titulo_${ordem}`)
    const texto = formData.get(`slide_texto_${ordem}`)
    return {
      ...s,
      ...(titulo !== null ? { titulo: String(titulo) } : {}),
      ...(texto !== null ? { texto: String(texto) } : {}),
    }
  })

  const { error } = await supabase
    .from('content_posts')
    .update({ legenda, ...(roteiroCru !== null ? { roteiro } : {}), slides })
    .eq('id', id)
  toPost(id, error ? `Falha: ${error.message}` : 'Rascunho salvo.')
}

/** Alterna a cena de um slide entre as versões geradas. A imagem que vale é a
 *  PRIMEIRA do grupo daquele slide, então "trocar" é rotacionar o grupo nas
 *  posições que ele já ocupa — nada é apagado (Lei 8), a outra versão continua
 *  no Drive e volta com um novo clique. */
export async function swapImageVariantAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const slide = Number(formData.get('slide') ?? 0)
  const alvo = Number.isFinite(slide) && slide > 0 ? slide : null

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('content_posts')
    .select('images, status')
    .eq('id', id)
    .maybeSingle()
  if (!current) toPost(id, 'Post não existe.')
  if (current.status !== 'rascunho') {
    toPost(id, 'A cena só pode ser trocada enquanto o post é rascunho.')
  }

  const images = (current.images ?? []) as Array<Record<string, unknown>>
  const posicoes = images
    .map((im, k) => ({ im, k }))
    .filter(({ im }) => ((im.slide as number | null) ?? null) === alvo)
    .map(({ k }) => k)
  if (posicoes.length < 2) toPost(id, 'Esse slide tem só uma versão de cena.')

  const grupo = posicoes.map((k) => images[k])
  const rotacionado = [...grupo.slice(1), grupo[0]]
  const novas = images.slice()
  posicoes.forEach((k, j) => {
    novas[k] = rotacionado[j]
  })

  const { error } = await supabase.from('content_posts').update({ images: novas }).eq('id', id)
  toPost(
    id,
    error ? `Falha: ${error.message}` : `Cena trocada${alvo ? ` no slide ${alvo}` : ' na capa'}.`,
  )
}

export async function approvePostAction(formData: FormData) {
  const actor = await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_posts')
    .update({ status: 'aprovado', approved_by: actor, approved_at: new Date().toISOString() })
    .eq('id', id)
  toPost(id, error ? `Falha: ${error.message}` : 'Post APROVADO — conteúdo congelado, pronto para publicar. ✔')
}

export async function markPublishedAction(formData: FormData) {
  const actor = await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const postUrl = String(formData.get('post_url') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_posts')
    .update({
      status: 'publicado',
      published_by: actor,
      published_at: new Date().toISOString(),
      post_url: postUrl || null,
    })
    .eq('id', id)
  toPost(id, error ? `Falha: ${error.message}` : 'Publicado — registro congelado (Lei 8). 🎉')
}

export async function retryAction(formData: FormData) {
  const actor = await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const supabase = await createClient()
  // "Tentar de novo" É uma aprovação da ideia (portão 1) — carimba sempre:
  // post rejeitado ainda na ideia não tem carimbo e o CHECK gate1_shape exige.
  const { error } = await supabase
    .from('content_posts')
    .update({
      status: 'ideia_aprovada',
      idea_approved_by: actor,
      idea_approved_at: new Date().toISOString(),
    })
    .eq('id', id)
  toPost(
    id,
    error
      ? `Falha: ${error.message}`
      : 'De volta à fila — os agentes tentam de novo levando o seu motivo em conta.',
  )
}

export async function unlockGeneratingAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_posts')
    .update({ status: 'ideia_aprovada', generation_error: 'destravado manualmente no painel' })
    .eq('id', id)
  toPost(id, error ? `Falha: ${error.message}` : 'Destravado — voltou para a fila de geração.')
}

export async function discardAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('post_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase
    .from('content_posts')
    .update({ status: 'descartado' })
    .eq('id', id)
  if (error) toPost(id, `Falha: ${error.message}`)
  back('Descartado — fica no histórico, fora do caminho.')
}

export async function publishBrandVoiceAction(formData: FormData) {
  await requireAdminId()
  const content = String(formData.get('content_md') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()
  if (!content) back('O documento de voz não pode ficar vazio.')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('publish_brand_voice', {
    p_content_md: content,
    p_notes: notes || null,
  })
  back(error ? `Falha: ${error.message}` : `Voz da marca publicada (versão ${data}). ✔`)
}
