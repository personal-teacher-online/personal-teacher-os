// Carregador do catálogo de cidades (Lote 6 · G3, 26/07/2026).
//
// A base (public/geo/cities.json, ~1,6 MB) é asset ESTÁTICO de propósito — fora
// do grafo do bundler/TS. Quem a lia era o próprio CityPicker, com um `if
// (!DATASET)` que NÃO cobria a corrida: enquanto o primeiro fetch estava no ar,
// cada tecla disparava OUTRO fetch de 1,6 MB, e as respostas voltavam fora de
// ordem. Era metade do defeito "a lista não fecha ao escolher": a continuação de
// uma tecla velha chegava DEPOIS do clique e reabria o dropdown (ela terminava
// em `setOpen(true)` incondicional).
//
// Aqui mora a metade que dá para testar sem DOM: uma requisição só, cache
// compartilhado, e falha que NÃO envenena o cache (a próxima tecla tenta de
// novo — comportamento preservado). A outra metade (a continuação atrasada não
// pode mexer na tela) é o contador de geração dentro do componente.
import type { GeoCity } from './search'

/** O mínimo do `fetch` que este módulo usa — assim o teste injeta um duble. */
export type BuscarCatalogo = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

const CATALOGO = '/geo/cities.json'

/**
 * Fábrica: cada carregador tem seu próprio cache. Existe para o teste poder
 * medir quantas requisições saem sem depender de estado global de módulo.
 */
export function criarCarregadorDeCidades(buscar: BuscarCatalogo = (url) => fetch(url)) {
  let cache: GeoCity[] | null = null
  let emVoo: Promise<GeoCity[]> | null = null

  return async function carregarCidades(): Promise<GeoCity[]> {
    if (cache) return cache
    // já tem uma no ar: todo mundo espera A MESMA — nada de N fetches de 1,6 MB
    if (emVoo) return emVoo

    emVoo = (async () => {
      try {
        const res = await buscar(CATALOGO)
        if (!res.ok) return []
        const dados = (await res.json()) as GeoCity[]
        cache = dados
        return dados
      } catch {
        return [] // rede falhou — sem cachear: a próxima tecla tenta de novo
      } finally {
        emVoo = null
      }
    })()

    return emVoo
  }
}

/** O carregador do app (um por página, compartilhado por todos os pickers). */
export const carregarCidades = criarCarregadorDeCidades()
