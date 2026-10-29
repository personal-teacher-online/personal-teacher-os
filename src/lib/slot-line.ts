import { DateTime } from 'luxon'
import { instanteNaSegundaPassagem } from '@/lib/admin/hora-civil'

const WEEKDAYS_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Item 11 (veredito): linha legível "terça · 20:30–21:15" + hora da
 *  professora SÓ quando os fusos divergem — calculada para a PRÓXIMA
 *  ocorrência do slot (offset daquele dia específico; Lei 1 — com DST a
 *  diferença muda ao longo do ano, offset fixo é proibido).
 *  Compartilhado por Contratos e pela ficha do aluno (mesmo padrão em todo
 *  ponto que lista horário fixo). */
export function slotLine(
  sl: { weekday: number; local_time: string; duration_min: number; iana_tz: string },
  teacherTz: string | null | undefined,
): { aluno: string; prof: string | null } {
  const now = DateTime.now().setZone(sl.iana_tz)
  const ahead = (sl.weekday - (now.weekday % 7) + 7) % 7
  const date = now.startOf('day').plus({ days: ahead })
  // Hora repetida da noite de recuo: a SEGUNDA passagem, a que o materializador
  // grava (`AT TIME ZONE`), sem depender da época em que o servidor roda (#40).
  const start = instanteNaSegundaPassagem(
    date.toFormat('yyyy-LL-dd'),
    String(sl.local_time).slice(0, 5),
    sl.iana_tz,
  )
  const end = start.plus({ minutes: sl.duration_min })
  const aluno = `${WEEKDAYS_FULL[sl.weekday]} · ${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`
  let prof: string | null = null
  if (teacherTz && teacherTz !== sl.iana_tz) {
    const t = start.setZone(teacherTz)
    if (t.toFormat('HH:mm') !== start.toFormat('HH:mm')) prof = t.toFormat('HH:mm')
  }
  return { aluno, prof }
}
