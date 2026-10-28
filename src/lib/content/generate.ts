import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getActivePrompt, runStructured } from '@/lib/ai/claude'
import { claimContentPost, deliverContentPost, failContentPost } from '@/lib/content/handle'
import { ROTEIRO_JSON_SCHEMA, roteiroSchema, serializeRoteiro, validarTextoRoteiro } from '@/lib/content/roteiro'
import { blocoDoContexto } from '@/lib/content/contexto'
import { blocoDaDissecacao, lerDissecacaoDaIdeia } from '@/lib/content/dissecacao'
import { getActiveBrandVoice } from '@/lib/content/voice'

// GERADOR IN-APP de roteiro de reel (M2, ADR-031) — substitui o pipeline n8n
// que nunca existiu. Chamado de dois lugares, com o client INJETADO:
//   · action "Gerar agora" do painel → client da sessão admin (RLS + guard)
//   · rota /api/jobs/generate-content (cron) → service role
//
// Sem `import 'server-only'`: o Vitest exercita este módulo com o Claude mockado.
//
// A MÁQUINA DE ESTADOS É DO BANCO (Lei 3): aqui só a sequência
// claim → prompt → validação estrita → entrega, com failContentPost em qualquer
// tropeço. Post que morrer em `gerando` (processo caiu no meio) volta pelo botão
// "Destravar" do painel — não existe job varrendo órfão (decisão do plano v3).

export const PROMPT_NAME = 'content-reel-script'
/** Teto de tentativas por rodada. Rejeição da revisora ZERA o contador. */
export const MAX_TENTATIVAS = 3

/**
 * Teto DIÁRIO de roteiros gerados, somando o botão do radar e a vassoura das
 * 12:00 UTC (ADR-035 decisão 3 — número escolhido pelo dono).
 *
 * ⚠️ Esta constante é ESPELHO: quem manda é `public.teto_diario_de_roteiros()`,
 * conferido DENTRO da transação da RPC (Lei 3). Aqui ela serve para a tela
 * antecipar a frase e para o cron pedir o lote do tamanho certo — e um teste
 * compara os dois números literalmente, para não divergirem no escuro.
 */
export const TETO_DIARIO_DE_ROTEIROS = 2

export type GenerateOutcome =
  | { ok: true; postId: string; tentativa: number }
  | { ok: false; postId: string; reason: 'sem_voz' | 'not_found' | 'conflict' | 'error'; detalhe: string }

interface PostParaGerar {
  id: string
  kind: string
  tema: string
  gancho: string | null
  idea: Record<string, unknown> | null
  rejection_reason: string | null
  /** `geral` | `travel` quando o roteiro nasceu no radar; `null` no avulso e no legado */
  contexto: string | null
  /** a trend de origem; `null` no roteiro avulso (ADR-032 decisão 6) */
  trend_id: string | null
}

/** Bloco opcional com a linha em branco que o separa — vazio continua vazio. */
function prefixaComLinhaEmBranco(bloco: string[]): string[] {
  return bloco.length > 0 ? ['', ...bloco] : []
}

function montaEntrada(post: PostParaGerar, vozMd: string): string {
  const idea = post.idea ?? {}
  const linhaDe = (rotulo: string, chave: string): string[] => {
    const v = idea[chave]
    return typeof v === 'string' && v.trim() ? [`${rotulo}: ${v.trim()}`] : []
  }
  // A ordem é a da leitura: o que escrever → o que copiar → para quem → o que
  // consertar → quem está falando. Blocos vazios não entram (Leva 5).
  return [
    '=== IDEIA APROVADA (roteirize ESTA) ===',
    `Tema: ${post.tema}`,
    ...(post.gancho ? [`Gancho falado da ideia: "${post.gancho}"`] : []),
    ...linhaDe('O que acontece no reel', 'premissa'),
    ...linhaDe('De onde veio (vídeo de referência a copiar)', 'de_onde_veio'),
    ...linhaDe('Pergunta à Vicky (história pessoal necessária)', 'pergunta_a_vicky'),
    ...prefixaComLinhaEmBranco(blocoDaDissecacao(lerDissecacaoDaIdeia(post.idea))),
    ...prefixaComLinhaEmBranco(blocoDoContexto(post.contexto)),
    ...(post.rejection_reason
      ? [
          '',
          '=== FEEDBACK DA REVISORA SOBRE A TENTATIVA ANTERIOR ===',
          post.rejection_reason,
          '(Resolva o que ela apontou. É instrução, não sugestão.)',
        ]
      : []),
    '',
    '=== VOZ DA MARCA (CONTEXTO: quem é a Vicky + fatos canônicos — NÃO reescreve o registro do vídeo de referência) ===',
    vozMd,
  ].join('\n')
}

export interface GenerateOptions {
  /**
   * A tentativa que a RPC `gerar_roteiro_da_trend` JÁ consumiu (Leva 5): quando
   * vem preenchida, o post chega aqui em `gerando` — a reserva da vaga do teto
   * foi feita dentro daquela transação, e reivindicar de novo daria conflito.
   *
   * Consequência que muda o comportamento: com o post já reivindicado, TODO
   * caminho de erro — inclusive os pré-voos — tem de DEVOLVER o post à fila.
   * No fluxo normal o pré-voo acontece antes do claim e não consome nada; aqui
   * ele já custou a vaga, e um post esquecido em `gerando` só sai pelo botão
   * "Destravar".
   */
  jaReivindicado?: number
}

/** Gera o roteiro de UM post. Reivindica o post (cadeado do banco) e entrega ou
 *  devolve à fila com o erro visível — nunca deixa o post preso por decisão sua. */
export async function generateReelScript(
  db: SupabaseClient,
  postId: string,
  opts: GenerateOptions = {},
): Promise<GenerateOutcome> {
  const reivindicado = opts.jaReivindicado != null

  /** Erro antes da entrega: devolve à fila SE a vaga já tiver sido tomada. */
  const desistir = async (
    reason: 'sem_voz' | 'not_found' | 'error',
    detalhe: string,
  ): Promise<GenerateOutcome> => {
    if (reivindicado) await failContentPost(db, { postId, error: detalhe })
    return { ok: false, postId, reason, detalhe }
  }

  // 1. Pré-voo ANTES do claim: erro de configuração não pode consumir tentativa.
  let vozVersao: number
  let vozMd: string
  try {
    const voz = await getActiveBrandVoice(db)
    if (!voz) {
      return desistir(
        'sem_voz',
        'nenhuma voz da marca ATIVA — publique a voz no Estúdio antes de gerar',
      )
    }
    vozVersao = voz.version
    vozMd = voz.content_md
  } catch (err) {
    return desistir('error', (err as Error).message)
  }

  const { data: post, error: readErr } = await db
    .from('content_posts')
    .select('id, kind, tema, gancho, idea, rejection_reason, contexto, trend_id')
    .eq('id', postId)
    .maybeSingle()
  if (readErr) return desistir('error', readErr.message)
  if (!post) return { ok: false, postId, reason: 'not_found', detalhe: 'post não existe' }

  let prompt
  try {
    prompt = await getActivePrompt(db, PROMPT_NAME)
  } catch (err) {
    return desistir('error', (err as Error).message)
  }

  // 2. Cadeado. Duplo clique, duas abas ou action+cron na mesma janela: um só
  //    passa. Quem chega com a vaga já reservada pela RPC pula esta etapa — ela
  //    aconteceu lá dentro, junto com a conta do teto.
  const claim = reivindicado
    ? { ok: true as const, attempt: opts.jaReivindicado as number }
    : await claimContentPost(db, postId)
  if (!claim.ok) return { ok: false, postId, reason: claim.reason, detalhe: claim.detail }

  // 3. Daqui para baixo o post está em `gerando`: TODO caminho de erro devolve.
  const comecou = Date.now()
  try {
    const cru = await runStructured({
      prompt,
      input: montaEntrada(post as PostParaGerar, vozMd),
      schema: ROTEIRO_JSON_SCHEMA,
    })
    const parsed = roteiroSchema.safeParse(cru)
    if (!parsed.success) {
      throw new Error(`roteiro fora do contrato: ${z.prettifyError(parsed.error)}`)
    }
    const texto = serializeRoteiro(parsed.data)
    const conferido = validarTextoRoteiro(texto)
    if (!conferido.ok) throw new Error(conferido.detalhe)

    const entrega = await deliverContentPost(db, {
      postId,
      // A legenda default vem do roteiro; a Teacher Vicky edita no painel. Registrado em
      // generation_meta para o M3 saber que é provisória, não escolha dela.
      legenda: parsed.data.legenda,
      roteiro: texto,
      generationMeta: {
        modelo: prompt.model,
        prompt_nome: prompt.name,
        prompt_versao: prompt.version,
        voz_versao: vozVersao,
        tentativa: claim.attempt,
        latencia_ms: Date.now() - comecou,
        variantes_de_gancho: parsed.data.gancho.variantes.length,
        duracao_alvo_s: parsed.data.duracao_alvo_s,
        legenda_source: 'roteiro_gerado',
        // Proveniência do radar (ADR-035): a métrica de reescrita e o histórico
        // continuam auditáveis POR CONTEXTO. Ausentes no avulso e no legado —
        // e ausente é diferente de 'geral'.
        ...(post.contexto ? { contexto: post.contexto } : {}),
        ...(post.trend_id ? { trend_id: post.trend_id } : {}),
        roteiro_original: texto,
        roteiro_json: parsed.data,
      },
      brandVoiceVersion: vozVersao,
    })
    if (!entrega.ok) return { ok: false, postId, reason: entrega.reason, detalhe: entrega.detail }
    return { ok: true, postId, tentativa: claim.attempt }
  } catch (err) {
    const detalhe = (err as Error).message
    await failContentPost(db, { postId, error: detalhe })
    return { ok: false, postId, reason: 'error', detalhe }
  }
}

export interface BatchResult {
  gerados: number
  falhas: number
  detalhes: Array<{ postId: string; ok: boolean; detalhe?: string }>
}

/** Lote da rotina diária. Só posts em `ideia_aprovada` com tentativas de sobra —
 *  NUNCA reivindica post preso em `gerando` (isso é o botão Destravar). */
export async function generateContentBatch(
  admin: SupabaseClient,
  limite = 2,
): Promise<BatchResult> {
  const { data, error } = await admin
    .from('content_posts')
    .select('id')
    .eq('status', 'ideia_aprovada')
    .eq('kind', 'roteiro_reel')
    .lt('generation_attempts', MAX_TENTATIVAS)
    .order('idea_approved_at', { ascending: true })
    .limit(limite)
  if (error) throw new Error(error.message)

  const detalhes: BatchResult['detalhes'] = []
  for (const row of data ?? []) {
    const res = await generateReelScript(admin, row.id as string)
    detalhes.push(
      res.ok ? { postId: res.postId, ok: true } : { postId: res.postId, ok: false, detalhe: res.detalhe },
    )
  }
  return {
    gerados: detalhes.filter((d) => d.ok).length,
    falhas: detalhes.filter((d) => !d.ok).length,
    detalhes,
  }
}
