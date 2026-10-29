import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'

// QA 14/07/2026: aviso de CONFLITO na publicação de janela — publicar um horário
// que encosta em aula agendada da professora cria uma janela que nenhum aluno
// consegue consumir (a exclusion constraint class_instances_teacher_no_overlap_excl
// recusa na reserva). Isto é ANTECIPAÇÃO de UX (Lei 3): quem decide é o banco,
// em `publish_reschedule_window`. Instante calculado com o offset DAQUELE dia
// (Lei 1, Luxon).
//
// Issue #85: a janela não guarda duração; o banco a mede pela maior duração que
// pode consumi-la na agenda da professora (`teacher_window_span_min`), nunca
// menos que a aula que cruza. As contas abaixo são as MESMAS das RPCs, com
// bordas meia-abertas: terminar no começo, ou começar no fim, não encosta.

/** A medida (ms) de uma janela publicada: a do banco (minutos; null = nenhuma),
 *  nunca menos que `minimoMs` (a aula que cruza, ou a que vai nascer). */
export function medidaDaJanelaMs(medidaMin: number | null, minimoMs: number): number {
  return Math.max((medidaMin ?? 0) * 60_000, minimoMs)
}

/** A janela [janelaMs, janelaMs + medidaMs) cruza o intervalo [inicioMs, fimMs)? */
export function janelaEncosta(janelaMs: number, medidaMs: number, inicioMs: number, fimMs: number): boolean {
  return inicioMs < janelaMs + medidaMs && fimMs > janelaMs
}

/** A primeira aula agendada que uma janela em `janelaMs` encostaria, ou null. */
export function aulaQueEncosta<A extends { starts_at_utc: string; ends_at_utc: string }>(
  janelaMs: number,
  medidaMin: number | null,
  aulas: readonly A[],
): A | null {
  for (const a of aulas) {
    const inicio = Date.parse(a.starts_at_utc)
    const fim = Date.parse(a.ends_at_utc)
    if (janelaEncosta(janelaMs, medidaDaJanelaMs(medidaMin, fim - inicio), inicio, fim)) return a
  }
  return null
}

/**
 * O instante que o banco nomeia na recusa, no relógio de quem publicou
 * ('2026-11-03 19:00 America/Sao_Paulo'), vira " de 03/11 às 19:00". Sem
 * instante reconhecível, nada — a frase continua inteira sem ele.
 */
export function quandoNaRecusa(m: string): string {
  const q = m.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/)
  return q ? ` de ${q[3]}/${q[2]} às ${q[4]}` : ''
}

/** Teto da duração de uma aula (CHECK 15..480 do A6/c): só limita a consulta. */
const AULA_MAX_MIN = 480

/** Retorna o starts_at_utc (ISO) da aula agendada que a janela encostaria, ou null. */
export async function windowPublishConflict(
  client: SupabaseClient,
  teacherId: string,
  localDate: string,
  localTime: string,
): Promise<string | null> {
  const { data: teacher } = await client
    .from('teachers')
    .select('iana_tz')
    .eq('id', teacherId)
    .maybeSingle()
  if (!teacher?.iana_tz) return null

  const start = DateTime.fromISO(`${localDate}T${localTime}`, { zone: teacher.iana_tz }).toUTC()
  if (!start.isValid) return null

  // A medida do banco. Falhando a leitura, a antecipação fica só com a aula que
  // cruza (oferece a mais; a RPC recusa com a frase dela).
  const { data: medida } = await client.rpc('teacher_window_span_min', { p_teacher: teacherId })
  const medidaMin = typeof medida === 'number' ? medida : null

  const { data: aulas } = await client
    .from('class_instances')
    .select('starts_at_utc, ends_at_utc')
    .eq('teacher_id', teacherId)
    .eq('state', 'scheduled')
    .gt('ends_at_utc', start.toISO())
    .lt('starts_at_utc', start.plus({ minutes: Math.max(medidaMin ?? 0, AULA_MAX_MIN) }).toISO())
    .order('starts_at_utc')
  return aulaQueEncosta(start.toMillis(), medidaMin, aulas ?? [])?.starts_at_utc ?? null
}
