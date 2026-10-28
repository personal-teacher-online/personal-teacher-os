// PESQUISA DE PAUTA — o filtro por CÓDIGO, antes de qualquer token de IA (M5).
//
// Barato, determinístico e auditável. O que ele descarta e por quê fica visível
// no terminal; a alternativa — pagar um modelo para dizer "isto é sobre outra
// coisa" — custa dinheiro e não deixa rastro.
//
// Módulo PURO (provado em `tests/research-logica.test.ts`).

import {
  ENGAJAMENTO_MINIMO,
  PALAVRAS_DO_TEMA,
  TOP_POR_FONTE,
  type Rede,
} from './config.ts'
import { engajamento, type ItemDaPesquisa } from './tipos.ts'

export interface ResultadoDoFiltro {
  itens: ItemDaPesquisa[]
  descartados: { foraDoTema: number; fracos: number; repetidos: number }
}

/** Sem acento e em minúsculas — "inglês" e "ingles" são a mesma palavra. */
function dobrar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function ehDoTema(item: ItemDaPesquisa): boolean {
  const alvo = dobrar(`${item.titulo} ${item.autor}`)
  return PALAVRAS_DO_TEMA.some((p) => alvo.includes(dobrar(p)))
}

/**
 * Filtra, deduplica e corta no topo.
 *
 * A ordem importa: dedupe ANTES do corte (senão o mesmo vídeo ocuparia duas
 * vagas do top N) e ordenação por engajamento DEPOIS do filtro (senão um item
 * fora de tema empurraria um bom para fora).
 */
export function filtrar(
  rede: Rede,
  brutos: readonly ItemDaPesquisa[],
  limite: number = TOP_POR_FONTE,
): ResultadoDoFiltro {
  const piso = ENGAJAMENTO_MINIMO[rede]
  const descartados = { foraDoTema: 0, fracos: 0, repetidos: 0 }
  const vistos = new Set<string>()
  const guardados: ItemDaPesquisa[] = []

  for (const item of brutos) {
    if (!item.id || vistos.has(item.id)) {
      if (item.id) descartados.repetidos += 1
      continue
    }
    vistos.add(item.id)
    if (!ehDoTema(item)) {
      descartados.foraDoTema += 1
      continue
    }
    if (engajamento(item) < piso) {
      descartados.fracos += 1
      continue
    }
    guardados.push(item)
  }

  guardados.sort((a, b) => engajamento(b) - engajamento(a))
  return { itens: guardados.slice(0, limite), descartados }
}

/** A frase do terminal — o que entrou e o que ficou de fora, sempre visível. */
export function fraseDoFiltro(rede: Rede, brutos: number, r: ResultadoDoFiltro): string {
  const { foraDoTema, fracos, repetidos } = r.descartados
  return (
    `${rede}: ${brutos} coletados → ${r.itens.length} guardados ` +
    `(fora de tema ${foraDoTema} · fracos ${fracos} · repetidos ${repetidos})`
  )
}
