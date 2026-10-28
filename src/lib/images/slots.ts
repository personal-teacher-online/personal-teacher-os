// IM-2/M2 — os "slots" de imagem de uma aula: onde a Teacher Vicky pode gerar uma foto.
//
// As aulas rascunhadas pela IA nascem SEM endereço de imagem (o draft.ts não os
// escreve). Então a tela não pode se limitar aos endereços que já existem no
// conteúdo — ela precisa saber, por slide, ONDE cabe uma foto e QUAL endereço
// ela terá. Este módulo responde isso.
//
// Escopo v1: imagens de CENA (cover/warmup/dialogue/tip/section), que o
// prompt.ts já sabe descrever. Vocabulário (palavra→objeto) é outro estilo de
// geração e fica para a v2.
import type { LessonDoc, SlideSpec } from '../slides/lesson-schema.ts'
import { framingFor, promptFor, VOCAB_FRAMING, vocabPromptFor } from './prompt.ts'
import type { ImageFraming } from './provider.ts'

/** os tipos de slide que ganham UMA foto de cena emoldurada */
const TIPOS_COM_FOTO = ['cover', 'warmup', 'dialogue', 'tip', 'section'] as const
type TipoComFoto = (typeof TIPOS_COM_FOTO)[number]

function temFoto(t: string): t is TipoComFoto {
  return (TIPOS_COM_FOTO as readonly string[]).includes(t)
}

export interface SlotDeImagem {
  slideIndex: number
  type: TipoComFoto
  /** endereço efetivo: o que já está no conteúdo, ou o derivado se ainda não há */
  address: string
  /** o slide já referencia este endereço? (M5 escrito à mão × aula nova) */
  jaNoConteudo: boolean
  /** sugestão pronta do prompt.ts; null quando o slide não tem assunto */
  promptSugerido: string | null
  framing: ImageFraming
}

/**
 * Endereço derivado para um slide sem foto: pasta = módulo, nome = aula + tipo.
 * `m8/a3-cover`. Determinístico e estável para o mesmo slide.
 */
function enderecoDerivado(doc: LessonDoc, type: TipoComFoto): string {
  return `m${doc.module.number}/a${doc.lesson.number}-${type}`
}

/** o endereço que o slide já carrega no conteúdo, se houver */
function enderecoAtual(spec: SlideSpec): string | null {
  const img = (spec as { image?: { file?: string } }).image
  return img?.file ?? null
}

/**
 * Todos os pontos onde a Teacher Vicky pode gerar uma foto nesta aula.
 *
 * Se dois slides do mesmo tipo caírem no mesmo endereço derivado (raro — duas
 * dicas, p.ex.), o segundo ganha um sufixo de índice: endereço vivo é único no
 * banco, e dois slots colidindo tentariam ocupar a mesma linha.
 */
export function slotsDeImagem(doc: LessonDoc): SlotDeImagem[] {
  const usados = new Set<string>()
  const slots: SlotDeImagem[] = []

  doc.slides.forEach((spec, slideIndex) => {
    if (!temFoto(spec.type)) return
    const atual = enderecoAtual(spec)
    let address = atual ?? enderecoDerivado(doc, spec.type)
    if (!atual) {
      // desambigua só o endereço DERIVADO; um endereço já no conteúdo é soberano
      let n = 2
      while (usados.has(address)) address = `${enderecoDerivado(doc, spec.type)}-${n++}`
    }
    usados.add(address)
    slots.push({
      slideIndex,
      type: spec.type,
      address,
      jaNoConteudo: atual !== null,
      promptSugerido: promptFor(spec, doc.module.title),
      framing: framingFor(spec.type),
    })
  })

  return slots
}

/** parte um endereço `m8/a3-cover.jpg` (ou sem extensão) em pasta + nome */
export function partesDoEndereco(address: string): { folder: string; name: string } | null {
  const m = /^([a-z0-9-]+)\/([a-z0-9-]+)(?:\.[a-z0-9]+)?$/.exec(address.trim())
  return m ? { folder: m[1], name: m[2] } : null
}

// ------------------------------------------------------------------ VOCAB (M-H2)
//
// NAMESPACE INDEPENDENTE do de cena (ADR-024 §4). Aqui um "slot" é um CARD de
// vocabulário — a foto associa palavra→objeto. O endereço é ancorado no anchorId
// do card (identidade opaca e estável), não na posição:
// `m{module}/a{lesson}-vocab-{anchorId}`. Isso é o que faz a foto sobreviver a
// reordenar/renomear o termo.

export interface SlotDeVocab {
  slideIndex: number
  cardIndex: number
  anchorId: string
  term: string
  pt: string
  /** endereço lógico ancorado (sem extensão): m{mod}/a{aula}-vocab-{anchorId} */
  address: string
  /** o card já tem uma foto aprovada gravada? (card.image presente) */
  jaNoConteudo: boolean
  promptSugerido: string | null
  framing: ImageFraming
}

/** endereço ancorado de um card de vocab. */
export function enderecoVocab(doc: LessonDoc, anchorId: string): string {
  return `m${doc.module.number}/a${doc.lesson.number}-vocab-${anchorId}`
}

/**
 * Todos os cards de vocabulário onde a Teacher Vicky pode gerar uma foto por termo.
 *
 * SÓ cards com anchorId entram — sem identidade estável não há endereço estável.
 * Cards legados ainda sem âncora ganham uma no primeiro save (ensureVocabAnchors);
 * até lá ficam de fora (o painel avisa que basta salvar).
 */
export function vocabSlotsDeImagem(doc: LessonDoc): SlotDeVocab[] {
  const slots: SlotDeVocab[] = []
  doc.slides.forEach((spec, slideIndex) => {
    if (spec.type !== 'vocab') return
    spec.cards.forEach((card, cardIndex) => {
      if (!card.anchorId) return
      slots.push({
        slideIndex,
        cardIndex,
        anchorId: card.anchorId,
        term: card.term,
        pt: card.pt,
        address: enderecoVocab(doc, card.anchorId),
        jaNoConteudo: Boolean(card.image),
        promptSugerido: vocabPromptFor(card.term, card.pt, doc.module.title),
        framing: VOCAB_FRAMING,
      })
    })
  })
  return slots
}

/** true se a aula tem algum card de vocab AINDA sem âncora (basta salvar). */
export function temVocabSemAncora(doc: LessonDoc): boolean {
  return doc.slides.some((s) => s.type === 'vocab' && s.cards.some((c) => !c.anchorId))
}

// A escrita do endereço no card de vocab NÃO mora mais aqui: a aprovação é
// ATÔMICA (RPC slide_image_approve_and_link faz jsonb_set do card na mesma
// transação da aprovação — item 6 da rodada de correção), então não há um passo
// separado de "gravar no conteúdo" a preservar por índice.

/** escreve/atualiza o endereço da foto no slide, devolvendo um conteúdo novo */
export function comEnderecoDeImagem(
  content: unknown,
  slideIndex: number,
  address: string,
): unknown {
  const doc = content as { slides?: Array<Record<string, unknown>> }
  const slides = doc.slides
  if (!Array.isArray(slides) || !slides[slideIndex]) return content
  const slide = slides[slideIndex]
  const imgAtual = (slide.image ?? {}) as Record<string, unknown>
  const novo = {
    ...doc,
    slides: slides.map((s, i) =>
      i === slideIndex ? { ...s, image: { ...imgAtual, file: address } } : s,
    ),
  }
  return novo
}
