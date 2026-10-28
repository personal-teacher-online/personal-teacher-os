// FS-M3 — proposta de trecho + gabarito do listening a partir do transcript
// (IA com Structured Outputs) e aplicação do vídeo escolhido no LessonDoc.
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePrompt, runStructured } from '@/lib/ai/claude'
import { sanitizeForAnthropic, stripNulls } from '@/lib/ai/json-schema'
import { fetchTranscript } from './transcript.ts'

export const ExcerptProposalSchema = z.strictObject({
  excerpt: z.strictObject({
    start: z.string(),
    end: z.string(),
    why: z.string(),
  }),
  task: z.string(),
  items: z
    .array(z.strictObject({ text: z.string(), correct: z.boolean().optional() }))
    .min(4)
    .max(8),
  answers: z.string(),
  notes: z.string(),
})
export type ExcerptProposal = z.infer<typeof ExcerptProposalSchema>

export async function proposeExcerpt(opts: {
  admin: SupabaseClient
  content: unknown
  videoId: string
  videoTitle: string
  videoChannel: string
}): Promise<ExcerptProposal> {
  const lines = await fetchTranscript(opts.videoId)
  // Teto de insumo: ~500 linhas cobrem 15+ min de vídeo.
  const transcript = lines.slice(0, 500).join('\n')
  const prompt = await getActivePrompt(opts.admin, 'slides-excerpt-suggest')
  const schema = sanitizeForAnthropic(z.toJSONSchema(ExcerptProposalSchema))
  const input = JSON.stringify({
    video: { id: opts.videoId, title: opts.videoTitle, channel: opts.videoChannel },
    lesson_content: opts.content,
    transcript,
  })
  const raw = await runStructured({ prompt, schema, input })
  return ExcerptProposalSchema.parse(stripNulls(raw))
}

/** Formato mm:ss (aceita m:ss). */
export function isTimeMark(v: string): boolean {
  return /^\d{1,3}:[0-5]\d$/.test(v.trim())
}

/**
 * Trecho + gabarito marcados PELA PROFESSORA na tela (opção A, 21/07): o
 * YouTube bloqueia o download de legenda a partir de IP de datacenter, então
 * a rota confiável é a humana — ela assiste, marca o que aparece e pronto.
 * Reaproveita o mesmo aplicador da proposta automática.
 */
export function buildManualProposal(input: {
  start: string
  end: string
  why?: string
  items: Array<{ text: string; correct: boolean }>
  currentTask?: string
  currentNotes?: string
}): ExcerptProposal {
  const corretos = input.items.filter((i) => i.correct).map((i) => i.text)
  return ExcerptProposalSchema.parse({
    excerpt: {
      start: input.start.trim(),
      end: input.end.trim(),
      why: (input.why ?? '').trim() || 'Trecho escolhido pela professora.',
    },
    task: input.currentTask?.trim() || '**Watch the video** and check the phrases you **hear**:',
    items: input.items.map((i) => ({ text: i.text, ...(i.correct ? { correct: true } : {}) })),
    answers: corretos.length
      ? `Gabarito (trecho ${input.start}-${input.end}), marcado pela professora: ${corretos.join('; ')}. Os demais itens sao distratores.`
      : `Sem gabarito marcado — a professora corrige ao vivo (trecho ${input.start}-${input.end}).`,
    notes:
      (input.currentNotes?.trim() ? input.currentNotes.trim() + ' ' : '') +
      `Tocar ${input.start}-${input.end}. Toque 2x; na 2a a aluna marca.`,
  })
}

/**
 * Aplica o vídeo aprovado + proposta no slide de listening do conteúdo.
 * Função pura (unit-testada): não valida o LessonDoc inteiro — o portão de
 * aprovação faz isso — mas exige que exista um slide type=listening.
 */
export function applyVideoToLesson(
  content: unknown,
  videoId: string,
  proposal: ExcerptProposal,
): Record<string, unknown> {
  const doc = structuredClone(content) as { slides?: Array<Record<string, unknown>> }
  const listening = doc?.slides?.find((s) => s && s.type === 'listening')
  if (!listening) {
    throw new Error('o conteúdo ainda não tem um slide de listening — rascunhe a aula antes')
  }
  listening.videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  listening.excerpt = proposal.excerpt
  listening.task = proposal.task
  listening.items = proposal.items
  listening.answers = proposal.answers
  listening.notes = proposal.notes
  delete listening.videoHint
  return doc as Record<string, unknown>
}
