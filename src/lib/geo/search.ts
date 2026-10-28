// Leva 5 (itens 1–4 do e2e) — busca de cidade PURA (testável no Vitest).
// A base (cities.json, GeoNames CC-BY) vem ORDENADA por população: a ordem do
// arquivo é o desempate de relevância. O que se grava no banco é sempre o
// fuso IANA da cidade (Lei 1) — aqui é só a camada de busca.

export interface GeoCity {
  /** nome (grafia GeoNames) */
  n: string
  /** região/UF */
  a: string
  /** país (pt-BR quando curado) */
  c: string
  /** fuso IANA — o que vai para o banco */
  t: string
  /** apelidos pt-BR separados por | ("Nova York|Nova Iorque") */
  b?: string
}

/** minúsculas + sem acentos ("Milão" → "milao") */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

interface Indexed {
  city: GeoCity
  keys: string[] // nome + apelidos, normalizados
}

let cache: { source: GeoCity[]; index: Indexed[] } | null = null

function indexOf(cities: GeoCity[]): Indexed[] {
  if (cache?.source === cities) return cache.index
  const index = cities.map((city) => ({
    city,
    keys: [normalize(city.n), ...(city.b ? city.b.split('|').map(normalize) : [])],
  }))
  cache = { source: cities, index }
  return index
}

/** Busca ranqueada: exato > começa-com > contém; empate = ordem do arquivo
 *  (população). Query com <2 caracteres não busca (evita listão inútil). */
export function searchCities(cities: GeoCity[], query: string, limit = 8): GeoCity[] {
  const q = normalize(query)
  if (q.length < 2) return []
  const exact: GeoCity[] = []
  const starts: GeoCity[] = []
  const contains: GeoCity[] = []
  for (const { city, keys } of indexOf(cities)) {
    if (keys.some((k) => k === q)) exact.push(city)
    else if (keys.some((k) => k.startsWith(q))) starts.push(city)
    else if (q.length >= 3 && keys.some((k) => k.includes(q))) contains.push(city)
    if (exact.length >= limit) break
  }
  return [...exact, ...starts, ...contains].slice(0, limit)
}

/** Hora atual na cidade (conferência visual do item 1) — Intl puro, só formata. */
export function currentTimeIn(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date())
  } catch {
    return null
  }
}
