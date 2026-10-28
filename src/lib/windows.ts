import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'

// QA 14/07/2026: aviso de CONFLITO na publicação de janela — publicar um horário
// em cima de aula agendada da professora cria uma janela que nenhum aluno consegue
// consumir (a exclusion constraint class_instances_teacher_no_overlap_excl recusa
// na reserva). Isto é ANTECIPAÇÃO de UX (Lei 3): quem decide continua sendo o
// banco, na reserva. Instante calculado com o offset DAQUELE dia (Lei 1, Luxon).

/** Duração presumida da janela para o check (mesma régua de availableWindows —
 *  a duração real da aula remarcada vem da instância original, quase sempre 45min). */
const WINDOW_MIN = 45

/** Retorna o starts_at_utc (ISO) da aula agendada que conflita, ou null. */
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
  const end = start.plus({ minutes: WINDOW_MIN })

  const { data: clash } = await client
    .from('class_instances')
    .select('starts_at_utc')
    .eq('teacher_id', teacherId)
    .eq('state', 'scheduled')
    .lt('starts_at_utc', end.toISO())
    .gt('ends_at_utc', start.toISO())
    .limit(1)
    .maybeSingle()
  return clash?.starts_at_utc ?? null
}
