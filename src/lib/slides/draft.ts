// FS-M1/M5 — rascunho da aula por IA.
//
// Structured Outputs NÃO serve para o LessonDoc: a API limita 24 campos
// opcionais e 16 uniões, e o contrato tem 81/82 (400 medido em produção
// 21/07). Aqui o schema vai como REFERÊNCIA no system e a garantia fica onde
// sempre esteve: o contrato zod do CURSO da aula, no servidor, antes de gravar.
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePrompt, runStructured } from '@/lib/ai/claude'
import { sanitizeForAnthropic, stripNulls } from '@/lib/ai/json-schema'
import {
  lessonSchemaBaseFor,
  lessonSchemaFor,
  normalizeFlexgeLevel,
  type LessonDoc,
} from './lesson-schema.ts'
import { preserveAnchorsOnRedraft, stripAnchorIds } from './anchors.ts'

/**
 * M-F — parâmetros EFÊMEROS da conversa com a IA (não persistem em tabela; a
 * alternativa persistida foi descartada por exigir migration, fora do escopo
 * do lote). Cada campo entra no prompt por um SLOT nomeado; campo vazio = a
 * seção correspondente do prompt é OMITIDA (não vira placeholder solto).
 */
export interface DraftParams {
  /** nível-alvo (catálogo Flexge; o operador pode subir/descer a partir da planilha) */
  level?: string | null
  /** tema / diretrizes livres da aula */
  theme?: string | null
  /** tópicos da planilha da professora */
  topics?: string | null
  /** estilo do slide (curto, opcional) */
  style?: string | null
  /** número-alvo de slides (opcional; sem valor = padrão do prompt) */
  slideCount?: number | null
  /** estrutura do conteúdo do início ao fim (opcional) */
  structure?: string | null
}

/** retorno do draftLesson: o documento + avisos não-bloqueantes para a UI. */
export interface DraftResult {
  doc: LessonDoc
  /** presente quando a IA declarou um nível diferente do escolhido pelo operador */
  levelAviso?: string
  /** termos que TINHAM foto e o re-rascunho descartaria (item 5); não bloqueia */
  orphanTerms?: string[]
}

/**
 * Remove campos OPERACIONAIS (não-pedagógicos) do JSON Schema de referência que
 * vai no prompt: a IA nunca vê nem gera `anchorId` — é identidade interna
 * atribuída na persistência (item 5). Poda recursiva por nome de propriedade.
 */
export function stripOperationalFields(schema: unknown): unknown {
  const OP = new Set(['anchorId'])
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk)
    if (!n || typeof n !== 'object') return n
    const o = n as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      if (k === 'properties' && v && typeof v === 'object') {
        const props: Record<string, unknown> = {}
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          if (!OP.has(pk)) props[pk] = walk(pv)
        }
        out[k] = props
      } else if (k === 'required' && Array.isArray(v)) {
        out[k] = v.filter((x) => !OP.has(String(x)))
      } else {
        out[k] = walk(v)
      }
    }
    return out
  }
  return walk(schema)
}

// Slots que recebem VALOR (substituição de {{SLOT}}); PARAMS é só uma seção-
// guarda-chuva (presente se QUALQUER parâmetro veio preenchido).
const VALUE_SLOTS = ['LEVEL', 'THEME', 'TOPICS', 'STYLE', 'SLIDE_COUNT', 'STRUCTURE'] as const
type ValueSlot = (typeof VALUE_SLOTS)[number]

function slotValues(p: DraftParams): Record<ValueSlot, string> {
  const num =
    p.slideCount != null && Number.isFinite(p.slideCount) && p.slideCount > 0
      ? String(Math.round(p.slideCount))
      : ''
  return {
    LEVEL: (p.level ?? '').trim(),
    THEME: (p.theme ?? '').trim(),
    TOPICS: (p.topics ?? '').trim(),
    STYLE: (p.style ?? '').trim(),
    SLIDE_COUNT: num,
    STRUCTURE: (p.structure ?? '').trim(),
  }
}

/**
 * Monta o prompt injetando os parâmetros por SLOTS nomeados. Suporta:
 *  · seções condicionais `{{#SLOT}}…{{/SLOT}}` — mantidas só quando o slot tem
 *    valor (a seção `{{#PARAMS}}` some inteira se NENHUM parâmetro veio);
 *  · substituição de valor `{{SLOT}}` — SÓ para os nomes em CAIXA ALTA
 *    conhecidos, então marcadores de conteúdo como `{{roxo-marca}}` ficam
 *    intactos.
 *
 * As seções operam SÓ sobre o template (nenhum valor do operador está inserido
 * ainda). Os valores entram numa ÚNICA passada final por regex/callback: o
 * texto inserido nunca é reescaneado, então theme="{{TOPICS}}" fica literal e
 * `$&`/`$'`/`$1` no valor não são interpretados (callback, não replacement
 * string). Sem dependência de ordem entre os slots.
 */
export function fillPromptSlots(template: string, params: DraftParams): string {
  const values = slotValues(params)
  const anyFilled = VALUE_SLOTS.some((s) => values[s].length > 0)
  const gate: Record<string, boolean> = { PARAMS: anyFilled }
  for (const s of VALUE_SLOTS) gate[s] = values[s].length > 0

  let out = template
  // 1) seções condicionais: mantém o miolo quando o slot está presente, senão
  //    remove. Só mexe em marcadores do TEMPLATE — nenhum valor ainda foi
  //    inserido, então não há expansão cruzada aqui.
  for (const name of ['PARAMS', ...VALUE_SLOTS]) {
    const re = new RegExp(`\\{\\{#${name}\\}\\}([\\s\\S]*?)\\{\\{/${name}\\}\\}`, 'g')
    out = out.replace(re, gate[name] ? '$1' : '')
  }
  // 2) valores: UMA passada única sobre todos os slots conhecidos. O regex
  //    global varre a string original da esquerda p/ direita e NÃO reprocessa
  //    o texto que acabou de inserir → sem expansão cruzada (item 4). O
  //    callback blinda contra padrões `$` no texto do operador.
  const valueRe = new RegExp(`\\{\\{(${VALUE_SLOTS.join('|')})\\}\\}`, 'g')
  out = out.replace(valueRe, (_m, name: string) => values[name as ValueSlot])
  // limpa as linhas em branco deixadas pelas seções omitidas.
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function draftSystemPrompt(promptContent: string, course?: string | null): string {
  // Base (sem o refine de unicidade): toJSONSchema não representa refinamentos;
  // e stripOperationalFields tira o anchorId — a IA nunca o vê.
  // O contrato é o do CURSO da aula (spec §7-quater, item 22): numa aula v2 a
  // IA precisa VER os tetos de comprimento, senão escreveria um documento que o
  // parse desta mesma função recusaria e o rascunho inteiro viraria erro.
  const schema = JSON.stringify(
    sanitizeForAnthropic(stripOperationalFields(z.toJSONSchema(lessonSchemaBaseFor(course)))),
  )
  return [
    promptContent,
    '',
    'FORMATO DA RESPOSTA: SOMENTE o JSON do LessonDoc — sem cercas de código,',
    'sem comentários, sem texto fora do JSON. Omita campos que não se aplicam',
    '(não escreva null), COM UMA EXCEÇÃO: no slide de listening, `videoUrl` é',
    'obrigatório — use null quando ainda não houver vídeo escolhido.',
    '',
    'Contrato (JSON Schema de referência):',
    schema,
  ].join('\n')
}

/**
 * Conserta o que a IA costuma variar no JSON guiado, sem inventar conteúdo:
 * · campos ausentes que o contrato exige nullable (videoUrl);
 * · `module`/`lesson` devolvidos como NÚMERO em vez de objeto (M6A4, 21/07).
 */
export function normalizeLessonDraft(
  raw: unknown,
  opts: { moduleTitle?: string; lessonTitle?: string; level?: string } = {},
): unknown {
  const doc = stripNulls(raw) as {
    slides?: Array<Record<string, unknown>>
    module?: unknown
    lesson?: unknown
    level?: unknown
  }
  if (typeof doc?.module === 'number') {
    doc.module = { number: doc.module, title: opts.moduleTitle ?? '' }
  }
  if (typeof doc?.lesson === 'number') {
    doc.lesson = { number: doc.lesson, title: opts.lessonTitle ?? '' }
  }
  // O nível escolhido pelo operador manda (M-F): fixa antes do parse para o
  // deck bater com a escolha, mesmo se a IA divergir. Só um nível Flexge válido
  // sobrescreve; 'A0' legado já chega normalizado por quem chama.
  if (opts.level) doc.level = opts.level
  for (const s of doc?.slides ?? []) {
    if (s?.type === 'listening' && s.videoUrl === undefined) s.videoUrl = null
  }
  return doc
}

/**
 * Resumo curto de uma aula já pronta — vira contexto do rascunho da aula
 * seguinte para a IA NÃO repetir o que o módulo já ensinou (o que eu fazia à
 * mão ao produzir o M6).
 */
export function summarizeLesson(content: unknown): string | null {
  const doc = content as Partial<LessonDoc> | null
  if (!doc?.slides?.length) return null
  const termos: string[] = []
  const frases: string[] = []
  for (const s of doc.slides) {
    if (s.type === 'vocab') termos.push(...s.cards.map((c) => c.term))
    if (s.type === 'speaking') frases.push(...s.phrases.slice(0, 3))
    if (s.type === 'grammar') frases.push(s.title)
  }
  const partes = [
    `aula ${doc.lesson?.number}: ${doc.lesson?.title ?? ''}`,
    doc.grammarFocus?.length ? `foco: ${doc.grammarFocus.join('; ')}` : '',
    termos.length ? `vocabulário: ${termos.slice(0, 14).join(', ')}` : '',
    frases.length ? `estruturas: ${frases.slice(0, 6).join(' / ')}` : '',
  ].filter(Boolean)
  return partes.join(' — ')
}

export async function draftLesson(opts: {
  admin: SupabaseClient
  module: number
  lesson: number
  title: string
  /** parâmetros efêmeros da conversa (nível, tema, tópicos, estilo, nº, estrutura) */
  params: DraftParams
  content: unknown
  /** resumos das aulas anteriores do módulo (contexto automático) */
  previous?: string[]
  /**
   * Curso da LINHA da aula (`slide_lessons.course`). É ele que escolhe o
   * contrato — o do v2 tem tetos de comprimento (spec §7-quater, item 22).
   * Ausente = o caminho v1, que é o que a UI cria hoje.
   */
  course?: string | null
}): Promise<DraftResult> {
  const prompt = await getActivePrompt(opts.admin, 'slides-lesson-draft')
  // Nível-alvo: 'A0' legado normaliza para 'Pre A1'; valor fora do catálogo é
  // ignorado (a IA/validador decidem). O prompt recebe o rótulo já normalizado.
  const level = normalizeFlexgeLevel(opts.params.level)
  const filled = fillPromptSlots(prompt.content, { ...opts.params, level: level ?? '' })
  const raw = await runStructured({
    prompt: { ...prompt, content: draftSystemPrompt(filled, opts.course) },
    schema: {},
    structured: false,
    maxTokens: Number(prompt.params.max_tokens ?? 16000),
    input: JSON.stringify({
      course: 'personal-travel',
      module: opts.module,
      lesson: opts.lesson,
      title: opts.title,
      // item 2: a IA NUNCA vê anchorId — nem no schema, nem no conteúdo atual.
      // A identidade pós-rascunho vem SÓ de preserveAnchorsOnRedraft (abaixo),
      // por posição+termo; um id ecoado pela IA seria uma troca silenciosa.
      content:
        opts.content && Object.keys(opts.content as object).length
          ? stripAnchorIds(opts.content)
          : null,
      // O que as aulas ANTERIORES deste módulo já ensinaram — não repita,
      // avance a partir daqui.
      previous_lessons: opts.previous?.length ? opts.previous : null,
    }),
  })
  // item 2: descarta QUALQUER anchorId que a IA tenha ecoado na resposta bruta
  // ANTES de parse/preservação — a identidade é reconstruída no servidor.
  const cleanRaw = stripAnchorIds(raw)
  // Nível DECLARADO pela IA, capturado ANTES de o operador sobrescrever — para
  // sinalizar divergência (o operador manda, mas ele precisa saber que a IA
  // calibrou o texto para outro nível).
  const iaLevel = normalizeFlexgeLevel((cleanRaw as { level?: unknown } | null)?.level)
  const doc = lessonSchemaFor(opts.course).parse(
    normalizeLessonDraft(cleanRaw, { lessonTitle: opts.title, level }),
  )
  const levelAviso =
    level && iaLevel && iaLevel !== level
      ? `A IA rascunhou em ${iaLevel}; rotulado como ${level} — revise a dificuldade.`
      : undefined
  // A identidade da aula é do BANCO — a IA não decide número nem curso.
  const base: LessonDoc = {
    ...doc,
    course: 'personal-travel',
    module: { ...doc.module, number: opts.module },
    lesson: { ...doc.lesson, number: opts.lesson },
  }
  // Re-rascunho da MESMA aula: preserva anchorId+foto por posição+termo e
  // aponta os termos com foto que sumiriam (item 5). ensureVocabAnchors (no
  // action) completa/valida os ids depois.
  const { doc: preserved, orphanTerms } = preserveAnchorsOnRedraft(opts.content, base)
  return { doc: preserved, levelAviso, orphanTerms: orphanTerms.length ? orphanTerms : undefined }
}
