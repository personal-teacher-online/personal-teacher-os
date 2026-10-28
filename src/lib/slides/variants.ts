// Template v2 / Fase 0a — escolha DETERMINÍSTICA de variante visual.
//
// "Esqueleto fixo, pele variada": a estrutura pedagógica nunca muda; a
// composição do slide roda entre 2–4 variantes por tipo. Duas regras da
// pesquisa (`docs/research/05`) governam este arquivo:
//
//  1. §4.3 — "Rotação determinística, não aleatória", para o deck ser
//     reproduzível: o mesmo endereço de aula sempre gera o mesmo arquivo.
//     Por isso NÃO existe `Math.random` aqui, nem data, nem contador global.
//  2. §4.3 — "Coerência intra-aula": a rotação acontece entre AULAS e entre
//     TIPOS de slide, não entre slides adjacentes do mesmo tipo na mesma aula
//     (dois grids diferentes de vocabulário na mesma aula é o caso *jarring*
//     que Guo et al. registram como risco). Quem chama passa em `index` o eixo
//     de rotação — no template v2 é um número estável por TIPO de slide
//     (`typeAxis`), não a posição do slide no deck.
//
// Módulo puro e sem I/O de propósito: é a peça mais fácil de testar do v2.

export interface VariantKey {
  module: number
  lesson: number
  /** eixo de rotação — ver `typeAxis`; NÃO é a posição do slide no deck */
  index: number
}

/** mistura de bits (variação do finalizador do murmur3) — inteiro estável */
function mix32(n: number): number {
  let h = Math.trunc(n) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * Variante do slide, em `0..count-1`.
 *
 * A conta tem duas partes de propósito:
 *  - um HASH de `(module, index)` decide o ponto de partida da rotação — é o que
 *    faz dois tipos de slide diferentes, na mesma aula, não caírem sempre na
 *    mesma letra;
 *  - a AULA entra somando (rotação), o que garante que aulas vizinhas do mesmo
 *    módulo percorram variantes diferentes. Um hash puro dos três números
 *    também "distribui", mas pode dar a mesma variante para as 5 aulas de um
 *    módulo (~1% dos casos com count=3) — e aí o módulo inteiro sai igual, que
 *    é exatamente o defeito que a variante existe para evitar.
 */
export function pickVariant(key: VariantKey, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0
  const n = Math.trunc(count)
  const base = mix32(mix32(Math.trunc(key.module) * 0x85ebca6b + 0x9e3779b1) ^ mix32(Math.trunc(key.index)))
  const lesson = Math.trunc(key.lesson)
  return (((base % n) + (lesson % n)) % n + n) % n
}

/**
 * Eixo de rotação de um TIPO de slide: hash FNV-1a do nome. Estável entre
 * execuções e entre máquinas (só depende dos code points da string), e o mesmo
 * tipo devolve sempre o mesmo eixo — é isso que dá coerência intra-aula.
 */
export function typeAxis(type: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < type.length; i++) {
    h ^= type.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
