import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cliente Claude (Fase 4 — construção total 14/07/2026). Fatos conferidos na
// doc oficial da Anthropic em 14/07/2026 (agente de verificação):
//  - Modelos vigentes: claude-haiku-4-5-20251001 (extração/auditoria) e
//    claude-sonnet-5 (relatórios) — a ESCOLHA por rotina vive no prompt ativo
//    de ai_prompts (coluna model NOT NULL — handoff-fase4).
//  - Structured Outputs: output_config.format { type: 'json_schema', schema }
//    (saiu de beta; JSON garantido-válido em content[0].text).
//  - Prompt caching: cache_control ephemeral no bloco de system (o prompt de
//    auditoria repete a cada aula — pagamos 0.1x nas leituras).
// Regra do handoff (caso 3): rotina SEMPRE lê o prompt ATIVO; name inexistente
// → erro claro, nunca prompt vazio/hardcoded.
// SEM `import 'server-only'`: o worker (fora do Next) usa este módulo.

export interface ActivePrompt {
  name: string
  version: number
  content: string
  model: string
  params: Record<string, unknown>
}

export async function getActivePrompt(admin: SupabaseClient, name: string): Promise<ActivePrompt> {
  const { data, error } = await admin
    .from('ai_prompts')
    .select('name, version, content, model, params')
    .eq('name', name)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`ai_prompts(${name}): ${error.message}`)
  if (!data) {
    throw new Error(
      `nenhum prompt ATIVO com name='${name}' — publique com publish_ai_prompt (scripts/publish-prompts.ts)`,
    )
  }
  return {
    name: data.name,
    version: data.version,
    content: data.content,
    model: data.model,
    params: (data.params ?? {}) as Record<string, unknown>,
  }
}

export interface StructuredCall {
  prompt: ActivePrompt
  /** conteúdo do usuário (transcrição, dados do período etc.) */
  input: string
  /** JSON Schema do resultado (output_config.format) */
  schema: Record<string, unknown>
  apiKey?: string
  maxTokens?: number
  /** false = schema vai como REFERÊNCIA no system, não como gramática da API.
   *  Necessário para contratos grandes: Structured Outputs limita 24 campos
   *  opcionais e 16 uniões (400 em 21/07 com o LessonDoc, que tem 81/82) — a
   *  validação de verdade é sempre do chamador (zod). */
  structured?: boolean
}

/** Chama a Messages API com Structured Outputs e devolve o JSON parseado.
 *  A VALIDAÇÃO SEMÂNTICA do shape é do CHAMADOR (handoff-fase4, caso 1:
 *  validar no servidor ANTES de gravar qualquer coisa). */
export async function runStructured(call: StructuredCall): Promise<unknown> {
  const apiKey = call.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente')
  const client = new Anthropic({ apiKey })

  const params = call.prompt.params
  const structured = call.structured !== false
  const message = await client.messages.create({
    model: call.prompt.model,
    max_tokens: call.maxTokens ?? Number(params.max_tokens ?? 4096),
    // `temperature` foi DESCONTINUADA nos modelos da família 5 (400 em
    // 21/07: "`temperature` is deprecated for this model"). Mantida só nos
    // modelos 4.x que ainda a aceitam (ex.: haiku-4-5 da auditoria).
    ...(params.temperature !== undefined && /-4(-|\.)/.test(call.prompt.model)
      ? { temperature: Number(params.temperature) }
      : {}),
    system: [
      {
        type: 'text',
        text: call.prompt.content,
        // Prompt reutilizado a cada aula/relatório: cache 5min (0.1x nas leituras).
        cache_control: { type: 'ephemeral' },
      },
    ],
    ...(structured
      ? { output_config: { format: { type: 'json_schema', schema: call.schema } } }
      : {}),
    messages: [{ role: 'user', content: call.input }],
  } as Parameters<typeof client.messages.create>[0])

  // Modelos da família 5 devolvem um bloco `thinking` ANTES do texto — pegar o
  // primeiro bloco de texto, nunca content[0] (achado do probe 21/07).
  const blocks = Array.isArray((message as { content?: unknown }).content)
    ? (message as { content: { type: string; text?: string }[] }).content
    : []
  const block = blocks.find((b) => b.type === 'text' && b.text)
  if (!block?.text) {
    throw new Error('resposta do Claude sem bloco de texto')
  }
  // No modo guiado o modelo às vezes embrulha em cerca de código.
  const text = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `resposta do Claude não é JSON válido (${text.length} caracteres; começa com "${text.slice(0, 60)}")`,
    )
  }
}
