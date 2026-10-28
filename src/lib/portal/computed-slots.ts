import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'
import { googleBusyForTeacher } from '@/lib/google/sync'

// F5/M1-4 — horários COMPUTADOS: agenda semanal da professora − aulas −
// bloqueios − ocupado do Google, fatiados na DURAÇÃO REAL (F1/M1-5), unidos às
// janelas publicadas (o motor antigo é o andar de baixo — nada se perde).
// A UI só ANTECIPA: quem decide é o banco em book_computed_slot /
// book_reschedule_window (Lei 3). Google indisponível = FAIL-OPEN com marcador
// (a reserva segue; o audit registra google_degraded).
//
// Lei 1: expansão semanal com Luxon DateTime.fromObject({...},{zone}) — o
// offset é o DAQUELE dia; nenhuma aritmética manual de fuso.
//
// ══════════════════════════════════════════════════════════════════════════════
// O QUE MUDOU NA VARREDURA FINAL DA ONDA DA AGENDA (S1 · S4 · S5)
// ══════════════════════════════════════════════════════════════════════════════
// S4 — LEITURA QUE FALHA NÃO VIRA GRADE VAZIA. As cinco consultas tinham o
// `{ error }` DESCARTADO (`{ data: windows }` e nada mais): banco fora do ar,
// RLS recusando ou rede caindo devolviam `null`, o `?? []` transformava isso em
// "nenhuma aula", "nenhum bloqueio", "nenhuma janela" — e a grade OFERECIA como
// livre um horário ocupado. No portal isso é uma reserva que o banco vai
// recusar; na tela nova do admin (o caminho do A7) é a dona remarcando a aula
// de outra pessoa por cima de uma aula que ela não viu. A função passa a
// devolver o par `{ dado, erro }` da casa (o mesmo de `src/lib/portal/data.ts`),
// e cada chamador diz a verdade do jeito da tela dele.
//   Exceção declarada, que NÃO muda: o Google continua FAIL-OPEN com marcador
//   (`googleDegraded`) — é agenda de fora, a decisão M1-4 é anterior a este
//   lote, e o efeito dela é oferecer horário A MAIS, que a reserva recusa.
//
// S5 — A DURAÇÃO É O INTERVALO EXATO, não minutos arredondados. `durationMin`
// obrigava o chamador a arredondar (`Math.round(ms / 60_000)`), e uma aula de
// 30m20s virava 30 min: a grade oferecia um vão de 30 minutos onde a aula não
// cabe, e a recusa só aparecia DEPOIS da confirmação. Mesma família do cinto da
// migration 98.
//
// S1 — `bypassLead` (o "furar antecedência" do admin). O corte de antecedência
// mínima é do ALUNO; quando a dona liga o furar, a RPC recebe `p_bypass_lead` e
// a grade tem de mostrar o que a RPC aceitaria — senão a janela publicada para
// amanhã some da lista e digitar o mesmo horário à mão funciona, o que é a tela
// contradizendo a si mesma. O PASSADO continua fora nos dois modos: com o corte
// desligado, era ele que escondia o horário que já passou.

export interface OfferedSlot {
  /** chave estável para a URL de revisão: id da janela publicada ou 't<ISO>' */
  key: string
  startsAtUtc: string
  windowId: string | null
}

export interface OfferResult {
  slots: OfferedSlot[]
  googleDegraded: boolean
}

/**
 * O par `{ dado, erro }` da casa: `erro: true` significa "não sei quais
 * horários estão livres" — nunca "não há horários livres". Quem chama escolhe
 * a frase; o que ninguém pode fazer é desenhar uma grade com isto.
 */
export interface OfferReading {
  dado: OfferResult | null
  erro: boolean
}

const GRID_MIN = 30
const HORIZON_DAYS = 14

export async function availableSlots(
  client: SupabaseClient,
  adminClient: SupabaseClient,
  teacherId: string,
  opts: {
    /** o intervalo EXATO da aula, em milissegundos (S5: nada de arredondar) */
    durationMs: number
    /** o "furar antecedência" do admin — o aluno nunca o liga (S1) */
    bypassLead?: boolean
  },
): Promise<OfferReading> {
  const now = DateTime.utc()
  const horizon = now.plus({ days: HORIZON_DAYS })
  const durMs = opts.durationMs

  const [
    { data: windows, error: eWindows },
    { data: busyClasses, error: eClasses },
    { data: teacher, error: eTeacher },
    { data: weekly, error: eWeekly },
    { data: exceptions, error: eExceptions },
  ] = await Promise.all([
      client
        .from('reschedule_windows')
        .select('id, starts_at_utc')
        .eq('teacher_id', teacherId)
        .eq('state', 'publicada')
        .gt('starts_at_utc', now.toISO())
        .lte('starts_at_utc', horizon.toISO())
        .order('starts_at_utc'),
      client
        .from('class_instances')
        .select('starts_at_utc, ends_at_utc')
        .eq('teacher_id', teacherId)
        .eq('state', 'scheduled')
        .gt('ends_at_utc', now.toISO())
        .lte('starts_at_utc', horizon.toISO()),
      client.from('teacher_public').select('min_booking_lead_hours').eq('id', teacherId).maybeSingle(),
      client
        .from('teacher_weekly_availability')
        .select('weekday, start_local, end_local, iana_tz')
        .eq('teacher_id', teacherId),
      client
        .from('teacher_availability_exceptions')
        .select('kind, starts_at_utc, ends_at_utc')
        .eq('teacher_id', teacherId)
        .lt('starts_at_utc', horizon.toISO())
        .gt('ends_at_utc', now.toISO()),
    ])

  // S4: as CINCO leituras decidem o que é livre — a das janelas publicadas, a
  // das aulas já marcadas, a da antecedência mínima da professora (sem ela o
  // corte cairia no padrão de 12 h, que pode não ser o dela), a da agenda
  // semanal e a dos bloqueios. Uma delas falhando já é grade mentirosa.
  if (eWindows || eClasses || eTeacher || eWeekly || eExceptions)
    return { dado: null, erro: true }

  // Google ocupado — FAIL-OPEN com marcador (decisão M1-4)
  let googleDegraded = false
  let googleBusy: { startUtc: string; endUtc: string }[] = []
  try {
    const busy = await googleBusyForTeacher(adminClient, teacherId, {
      fromUtcISO: now.toISO()!,
      toUtcISO: horizon.toISO()!,
    })
    if (busy.status === 'ok') googleBusy = busy.blocks
    else if (busy.status === 'indisponivel') googleDegraded = true
  } catch {
    googleDegraded = true
  }

  const leadCutoff = now.plus({ hours: teacher?.min_booking_lead_hours ?? 12 }).toMillis()
  const blocks = (exceptions ?? []).filter((e) => e.kind === 'block')
  const occupied = [
    ...(busyClasses ?? []).map((b) => ({ s: Date.parse(b.starts_at_utc), e: Date.parse(b.ends_at_utc) })),
    ...googleBusy.map((b) => ({ s: Date.parse(b.startUtc), e: Date.parse(b.endUtc) })),
    ...blocks.map((b) => ({ s: Date.parse(b.starts_at_utc), e: Date.parse(b.ends_at_utc) })),
  ]
  const agoraMs = now.toMillis()
  const fits = (startMs: number): boolean => {
    // O PASSADO NUNCA CABE, e esta linha não é redundante: sem `bypassLead` era
    // o corte de antecedência que escondia o horário já vencido (ele é sempre
    // ≥ agora). Com o furar ligado o corte sai de cena, e a grade da agenda
    // semanal começa no início do dia CIVIL de hoje — sem esta guarda, ela
    // ofereceria as 08:00 de uma manhã que já passou.
    if (startMs <= agoraMs) return false
    if (!opts.bypassLead && startMs < leadCutoff) return false
    const endMs = startMs + durMs
    if (endMs > horizon.toMillis()) return false
    return !occupied.some((o) => startMs < o.e && endMs > o.s)
  }

  const byInstant = new Map<string, OfferedSlot>()

  // 1) janelas publicadas (levam o id — consumo pelo caminho clássico)
  for (const w of windows ?? []) {
    if (fits(Date.parse(w.starts_at_utc))) {
      byInstant.set(w.starts_at_utc, { key: w.id, startsAtUtc: w.starts_at_utc, windowId: w.id })
    }
  }

  // 2) grade computada da agenda semanal (Lei 1 via Luxon, dia a dia)
  for (const row of weekly ?? []) {
    for (let d = 0; d <= HORIZON_DAYS; d++) {
      const day = DateTime.now().setZone(row.iana_tz).startOf('day').plus({ days: d })
      if (day.weekday % 7 !== row.weekday) continue
      const [sh, sm] = String(row.start_local).split(':').map(Number)
      const [eh, em] = String(row.end_local).split(':').map(Number)
      const winStart = day.set({ hour: sh, minute: sm })
      const winEnd = day.set({ hour: eh, minute: em })
      for (let t = winStart; t.plus({ milliseconds: durMs }) <= winEnd; t = t.plus({ minutes: GRID_MIN })) {
        const iso = t.toUTC().toISO()!
        if (byInstant.has(iso)) continue
        if (fits(t.toMillis())) {
          byInstant.set(iso, { key: `t${iso}`, startsAtUtc: iso, windowId: null })
        }
      }
    }
  }

  const slots = [...byInstant.values()].sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc))
  return { dado: { slots, googleDegraded }, erro: false }
}
