// O CONTEXTO DE DESTINO DO ROTEIRO (Estúdio v2 · Leva 5 — ADR-035 decisão 2).
//
// A mesma trend pode virar dois roteiros: um de engajamento geral e um do funil
// do Personal Travel. O que muda é UM BLOCO da entrada, montado por CÓDIGO —
// **não** um segundo prompt.
//
// ── POR QUE UM PROMPT SÓ ────────────────────────────────────────────────────
// Dois prompts seriam duas calibrações e dupla manutenção para uma diferença
// que é um parágrafo (ADR-035 rejeitou o fork explicitamente). A mecânica é a da
// casa: a voz da marca e o feedback da revisora já entram assim, como bloco.
//
// ── O QUE ESTE BLOCO PODE DIZER, E O QUE NÃO PODE ───────────────────────────
// Ele dá DESTINO, não fatos. Nenhuma promessa de resultado, preço, prazo ou
// característica do programa entra aqui: o que o roteiro pode afirmar sobre a
// Teacher Vicky e sobre os produtos vem da VOZ DA MARCA (fatos canônicos), que viaja na
// mesma entrada. Bloco de destino que inventasse fato viraria frase falsa com
// carimbo de instrução.

/** Os dois destinos — o mesmo par do CHECK `content_posts_contexto_check`. */
export const CONTEXTOS_DO_ROTEIRO = ['geral', 'travel'] as const
export type ContextoDoRoteiro = (typeof CONTEXTOS_DO_ROTEIRO)[number]

export function ehContextoDoRoteiro(v: string | undefined | null): v is ContextoDoRoteiro {
  return typeof v === 'string' && (CONTEXTOS_DO_ROTEIRO as readonly string[]).includes(v)
}

/** O rótulo de tela de cada destino (provisório até o batismo da Leva 7). */
export const CONTEXTO_ROTULO: Record<ContextoDoRoteiro, string> = {
  geral: 'engajamento geral',
  travel: 'Personal Travel',
}

const TEXTO: Record<ContextoDoRoteiro, readonly string[]> = {
  geral: [
    'Este roteiro é de ENGAJAMENTO GERAL da Personal Teacher: ele existe para a',
    'pessoa aprender uma coisa útil e querer voltar. Não venda nada, não convide',
    'para programa nenhum e não cite preço, turma ou vaga. O fechamento pede',
    'interação (comentar, salvar, mandar para alguém) — nunca clique em link.',
  ],
  travel: [
    'Este roteiro é do PERSONAL TRAVEL, o programa de mentoria de inglês para',
    'quem vai viajar. Puxe o assunto para uma situação real de viagem (aeroporto,',
    'imigração, hotel, restaurante, pedir ajuda na rua) e termine com UM convite,',
    'de uma frase só, na última cena: conhecer o Personal Travel. A legenda repete',
    'o convite com outras palavras, sem repetir o roteiro. Nada de preço, prazo,',
    'número de vagas ou promessa de resultado — o que dá para afirmar sobre o',
    'programa é o que está nos fatos canônicos da voz da marca.',
  ],
}

/**
 * O bloco de destino, pronto para entrar na entrada do gerador.
 *
 * `null` (post antigo, roteiro avulso) devolve `[]`: o gerador de antes da Leva
 * 5 não tinha destino nenhum e continua não tendo — silêncio é o comportamento
 * de ontem, e inventar "geral" para todo mundo mudaria roteiro que já existia.
 */
export function blocoDoContexto(contexto: string | null | undefined): string[] {
  if (!ehContextoDoRoteiro(contexto)) return []
  return ['=== CONTEXTO DE DESTINO ===', ...TEXTO[contexto]]
}
