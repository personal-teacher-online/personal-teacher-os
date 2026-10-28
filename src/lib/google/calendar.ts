import type { SupabaseClient } from '@supabase/supabase-js'

// Google Agenda da professora (ADR-017) — núcleo framework-free (porta injetada,
// como notify/channel): o Vitest exercita o diff e a montagem dos eventos sem
// rede; o adaptador googleapis fino vive em gcal-port.ts.
//
// Modelo "o app manda, o Google informa":
//  - desiredEventsForTeacher lê do BANCO o que deve existir na agenda dela
//    (aulas agendadas + janelas publicadas, próximas 8 semanas);
//  - syncTeacherGoogleCalendar faz o diff contra os eventos MARCADOS COMO NOSSOS
//    (extendedProperties.private.ptos_key) e aplica insert/patch/delete;
//  - o sync é IDEMPOTENTE e auto-corretivo: falhou hoje, o de amanhã conserta;
//    a professora apagou/arrastou um evento nosso no Google, o sync recoloca.
//    Por isso NÃO guardamos google_event_id por instância (a coluna do blueprint
//    fica dormente — ADR-017): estado no banco dessincroniza, a marca no próprio
//    evento não.
//  - Instantes: comparação por epoch (Date.parse) — zero aritmética de fuso
//    aqui (Lei 1); os timestamps já nascem UTC no banco.

/** Duração presumida da janela (mesma régua de windows.ts/availableWindows). */
const WINDOW_MIN = 45
/** Horizonte do sync — cobre o horizonte de materialização das instâncias. */
export const SYNC_HORIZON_DAYS = 56

export interface DesiredEvent {
  /** identidade estável: 'aula:<instance_id>' | 'janela:<window_id>' */
  key: string
  startUtc: string
  endUtc: string
  summary: string
  /** janela publicada não conta como "ocupado" na agenda dela */
  transparent: boolean
  /** F11/M13: aula ganha Meet no PRÓPRIO evento (janela não) */
  meet?: boolean
}

export interface GcalEventLite {
  id: string
  key: string | null
  startUtc: string | null
  endUtc: string | null
  summary: string | null
  transparent: boolean
  /** F11: hangoutLink do evento (para gravar o Meet real na aula) */
  meetUrl?: string | null
}

export interface BusyBlock {
  startUtc: string
  endUtc: string
}

/** Porta mínima para a agenda PRINCIPAL da professora (adaptador em gcal-port.ts). */
export interface GcalPort {
  /** só eventos nossos (privateExtendedProperty ptos=1) no intervalo */
  listOurs(fromUtcISO: string, toUtcISO: string): Promise<GcalEventLite[]>
  /** TODOS os eventos dela no intervalo (para os blocos de "ocupado") */
  listAll(fromUtcISO: string, toUtcISO: string): Promise<GcalEventLite[]>
  /** F11: devolve id + link do Meet criados (o sync grava na aula) */
  insert(ev: DesiredEvent): Promise<{ id: string; meetUrl: string | null }>
  patch(id: string, ev: DesiredEvent): Promise<void>
  remove(id: string): Promise<void>
}

/** Título privado (F0/M12-11): a agenda Google pessoal da professora não
 *  carrega o nome completo — "Sabrina Almeida" → "Sabrina A.". Vale também para
 *  rótulo de grupo ("Casal Silva" → "Casal S."), por coerência de privacidade. */
export function privateName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/** O que DEVE existir na agenda dela, segundo o banco (fonte da verdade). */
export async function desiredEventsForTeacher(
  client: SupabaseClient,
  teacherId: string,
  range: { fromUtcISO: string; toUtcISO: string },
): Promise<DesiredEvent[]> {
  const [{ data: classes }, { data: windows }] = await Promise.all([
    client
      .from('class_instances')
      .select(
        'id, starts_at_utc, ends_at_utc, contracts(students!contracts_student_id_fkey(display_name), student_groups(label))',
      )
      .eq('teacher_id', teacherId)
      .eq('state', 'scheduled')
      .gte('starts_at_utc', range.fromUtcISO)
      .lte('starts_at_utc', range.toUtcISO)
      .order('starts_at_utc'),
    client
      .from('reschedule_windows')
      .select('id, starts_at_utc')
      .eq('teacher_id', teacherId)
      .eq('state', 'publicada')
      .gte('starts_at_utc', range.fromUtcISO)
      .lte('starts_at_utc', range.toUtcISO)
      .order('starts_at_utc'),
  ])

  const events: DesiredEvent[] = []
  for (const ci of classes ?? []) {
    const contract = Array.isArray(ci.contracts) ? ci.contracts[0] : ci.contracts
    const student = contract && (Array.isArray(contract.students) ? contract.students[0] : contract.students)
    const group = contract && (Array.isArray(contract.student_groups) ? contract.student_groups[0] : contract.student_groups)
    const who = student?.display_name ?? group?.label ?? 'aluno'
    events.push({
      key: `aula:${ci.id}`,
      startUtc: ci.starts_at_utc,
      endUtc: ci.ends_at_utc,
      summary: `Aula — ${privateName(who)}`,
      transparent: false,
      meet: true, // F11/M13: a aula ganha Meet no próprio evento
    })
  }
  for (const w of windows ?? []) {
    const end = new Date(Date.parse(w.starts_at_utc) + WINDOW_MIN * 60_000).toISOString()
    events.push({
      key: `janela:${w.id}`,
      startUtc: w.starts_at_utc,
      endUtc: end,
      summary: 'Janela de remarcação (aberta)',
      transparent: true,
    })
  }
  return events
}

export interface CalendarDiff {
  toInsert: DesiredEvent[]
  toPatch: Array<{ id: string; ev: DesiredEvent }>
  toDelete: string[]
}

function sameInstant(a: string | null, b: string): boolean {
  return a !== null && Date.parse(a) === Date.parse(b)
}

/** Diff puro (testável sem rede): existente na agenda × desejado pelo banco. */
export function diffCalendar(existing: GcalEventLite[], desired: DesiredEvent[]): CalendarDiff {
  const wanted = new Map(desired.map((d) => [d.key, d]))
  const seen = new Set<string>()
  const diff: CalendarDiff = { toInsert: [], toPatch: [], toDelete: [] }

  for (const ev of existing) {
    const want = ev.key ? wanted.get(ev.key) : undefined
    // Sem chave (marcado como nosso mas ilegível), órfão, ou DUPLICADO da mesma
    // chave (corrida de dois syncs): remove — o estado converge para 1 evento/chave.
    if (!want || !ev.key || seen.has(ev.key)) {
      diff.toDelete.push(ev.id)
      continue
    }
    seen.add(ev.key)
    const unchanged =
      sameInstant(ev.startUtc, want.startUtc) &&
      sameInstant(ev.endUtc, want.endUtc) &&
      ev.summary === want.summary &&
      ev.transparent === want.transparent
    if (!unchanged) diff.toPatch.push({ id: ev.id, ev: want })
  }
  for (const d of desired) {
    if (!seen.has(d.key)) diff.toInsert.push(d)
  }
  return diff
}

/** Aplica o diff na agenda. Sequencial de propósito: volume ≤ dezenas/professora.
 *  F11/M13: onAulaEvent grava (event id, Meet) na AULA — para inserts E para
 *  eventos já existentes (o id dormia; o robô do M15 precisa dele para casar). */
export async function syncTeacherGoogleCalendar(
  port: GcalPort,
  desired: DesiredEvent[],
  range: { fromUtcISO: string; toUtcISO: string },
  onAulaEvent?: (instanceId: string, eventId: string, meetUrl: string | null) => Promise<void>,
): Promise<{ inserted: number; patched: number; deleted: number }> {
  const existing = await port.listOurs(range.fromUtcISO, range.toUtcISO)
  const diff = diffCalendar(existing, desired)
  for (const id of diff.toDelete) await port.remove(id)
  for (const { id, ev } of diff.toPatch) await port.patch(id, ev)
  for (const ev of diff.toInsert) {
    const created = await port.insert(ev)
    if (onAulaEvent && ev.key.startsWith('aula:')) {
      await onAulaEvent(ev.key.slice(5), created.id, created.meetUrl)
    }
  }
  if (onAulaEvent) {
    const wanted = new Set(desired.map((d) => d.key))
    for (const ev of existing) {
      if (ev.key?.startsWith('aula:') && wanted.has(ev.key) && !diff.toDelete.includes(ev.id)) {
        await onAulaEvent(ev.key.slice(5), ev.id, ev.meetUrl ?? null)
      }
    }
  }
  return { inserted: diff.toInsert.length, patched: diff.toPatch.length, deleted: diff.toDelete.length }
}

/**
 * Afazeres dela = ocupado (M5): todos os eventos MENOS os nossos e os
 * transparentes ("disponível" no Google não bloqueia). Só horários saem daqui —
 * título/detalhe do compromisso pessoal dela nunca entram na plataforma.
 */
export async function googleBusyBlocks(
  port: GcalPort,
  range: { fromUtcISO: string; toUtcISO: string },
): Promise<BusyBlock[]> {
  const all = await port.listAll(range.fromUtcISO, range.toUtcISO)
  return all
    .filter((ev) => ev.key === null && !ev.transparent && ev.startUtc && ev.endUtc)
    .map((ev) => ({ startUtc: ev.startUtc!, endUtc: ev.endUtc! }))
}
