// NOTA DE VIAGEM (Estúdio v2 — Leva 2.2, ADR-033).
//
// A aba "Personal Travel" do radar é um FILTRO sobre a mesma base de trends, e o
// filtro precisa de um número: `travel_score` 0–100, respondendo à pergunta
// AMPLA — "este post rende conteúdo pro curso Personal Travel?" — e não "é
// sobre viagem?". Quem responde é o Haiku (prompt `content-travel-score` em
// `ai_prompts`, publicado por `scripts/publish-prompts.ts`), uma chamada por
// trend capturada (~40/semana — custo irrelevante perto do Apify).
//
// FAIL-OPEN declarado (ADR-033 decisão 5): falha aqui NUNCA segura a captura —
// a trend nasce com score NULL (fora da aba PT, com aviso) e a corrida seguinte
// cura, porque o guard deixa o robô atualizar travel_score/travel_meta
// enquanto a trend é NOVA (ADR-037 decisão 6).
//
// Módulo do WORKER (Node puro): imports relativos com `.ts`, sem alias `@/`.

import { z } from 'zod'

import { PRECO_HAIKU } from './config.ts'
import { runStructured, type ActivePrompt } from '../ai/claude.ts'

export const PROMPT_TRAVEL = 'content-travel-score'

/** Trecho de transcrição que vai ao modelo: o suficiente para julgar TEMA e
 *  mecanismo; transcrição inteira seria pagar tokens para julgar execução. */
const TRANSCRICAO_MAX = 1_500

export interface NotaDeViagem {
  nota: number
  justificativa: string
}

export const notaDeViagemSchema = z
  .object({
    nota: z.number().int().min(0).max(100),
    justificativa: z.string().trim().min(1),
  })
  .strict()

/** JSON Schema do structured output. SEM minimum/maximum de propósito: a API
 *  recusa as duas propriedades em integer (400 medido na 1ª corrida da
 *  bancada, 03/08) — a faixa 0–100 é do prompt e a validação de verdade é o
 *  zod acima (regra da casa: validar no chamador antes de gravar). */
export const SCHEMA_NOTA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['nota', 'justificativa'],
  properties: {
    nota: { type: 'integer' },
    justificativa: { type: 'string' },
  },
}

/** A entrada do modelo: título + trecho da transcrição (quando houver). PURA —
 *  provada em research-logica.test.ts. */
export function entradaDaNota(t: { titulo: string; transcricao?: string | null }): string {
  const partes = [`TÍTULO: ${t.titulo}`]
  const trecho = (t.transcricao ?? '').trim()
  if (trecho) {
    partes.push(`TRANSCRIÇÃO (trecho):\n${trecho.slice(0, TRANSCRICAO_MAX)}`)
  }
  return partes.join('\n\n')
}

/**
 * Uma nota. O prompt ativo vem de fora (lido UMA vez por corrida); quem decide
 * o que fazer com a falha é o chamador — aqui ela só sobe.
 */
export async function avaliarNotaDeViagem(
  prompt: ActivePrompt,
  entrada: string,
): Promise<{ nota: NotaDeViagem; custoUsd: number }> {
  const bruto = await runStructured({ prompt, input: entrada, schema: SCHEMA_NOTA })
  const nota = notaDeViagemSchema.parse(bruto)
  // Mesma conta de bolso do analisarReel: o SDK não devolve usage por este
  // caminho — chars/4 na entrada e um teto curto de saída.
  const custoUsd =
    ((prompt.content.length + entrada.length) / 4 / 1_000_000) * PRECO_HAIKU.entrada +
    (200 / 1_000_000) * PRECO_HAIKU.saida
  return { nota, custoUsd }
}
