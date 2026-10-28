/** Normaliza embeds do PostgREST: sem tipos gerados, o supabase-js infere relações
 *  to-one como array, mas o runtime entrega objeto. Aceita os dois. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}
