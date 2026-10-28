import type { SupabaseClient } from '@supabase/supabase-js'

// F11/M15 — o ROBÔ de auditoria de aula: casa gravações do Meet com aulas,
// alimenta a auditoria com a TRANSCRIÇÃO NATIVA (gate do transcript: o Doc do
// Meet é a rota única aqui — Whisper/ffmpeg NUNCA entram neste código; se o
// gate reprovar o nativo em produção, o plano B é um adaptador NOVO, decisão
// consciente) e deixa TODO desvio visível (fim do silêncio total — M15-3):
//   • gravação órfã (não casa com aula nenhuma);
//   • aula sem gravação;
//   • gravação curta (menos da metade da aula agendada);
//   • gravação de MENTORIA descartada (P20 — nunca vira órfã eterna).
// Casamento: rota PRIMÁRIA pelo código do Meet (aula.meet_url gravado pelo
// sync da F11); fallback por janela de horário. Retenção pós-auditoria: apaga
// a gravação auditada mais velha que opts.retainDays (política com números —
// entregável do gate CHAVES).

export interface RecordingFile {
  fileId: string
  name: string
  createdAtUtc: string
  durationMin: number | null
  /** código do Meet (ex.: 'abc-defg-hij') — rota primária do casamento */
  meetCode: string | null
  /** transcrição NATIVA (Doc do Meet) já lida pela porta; null = sem transcript */
  transcriptText: string | null
}

export interface AuditPorts {
  listRecordings(): Promise<RecordingFile[]>
  /** roda a auditoria (record_class_audit + checklist) com o transcript TEXTO */
  runAudit(instanceId: string, transcript: string): Promise<void>
  deleteRecording?(fileId: string): Promise<void>
}

export interface AuditRunReport {
  matched: number
  audited: number
  deleted: number
  mentoria_descartadas: string[]
  orfas: string[]
  aulas_sem_gravacao: string[]
  curtas: string[]
  sem_transcricao: string[]
  erros: { fileId: string; error: string }[]
}

export function meetCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /meet\.google\.com\/([a-z0-9-]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

export async function auditRecordings(
  admin: SupabaseClient,
  ports: AuditPorts,
  opts: { windowDays?: number; retainDays?: number | null; now?: Date; teacherId?: string } = {},
): Promise<AuditRunReport> {
  const now = opts.now ?? new Date()
  const windowDays = opts.windowDays ?? 7
  const since = new Date(now.getTime() - windowDays * 864e5).toISOString()

  let q = admin
    .from('class_instances')
    .select('id, starts_at_utc, ends_at_utc, state, meet_url, google_event_id')
    .gte('starts_at_utc', since)
    .lt('starts_at_utc', now.toISOString())
    .in('state', ['completed', 'scheduled', 'no_show_student'])
  if (opts.teacherId) q = q.eq('teacher_id', opts.teacherId)
  const [{ data: classes }, { data: sessions }, recordings] = await Promise.all([
    q,
    admin
      .from('mentorship_sessions')
      .select('id, scheduled_at, gmeet_url')
      .gte('scheduled_at', since),
    ports.listRecordings(),
  ])

  const report: AuditRunReport = {
    matched: 0,
    audited: 0,
    deleted: 0,
    mentoria_descartadas: [],
    orfas: [],
    aulas_sem_gravacao: [],
    curtas: [],
    sem_transcricao: [],
    erros: [],
  }

  const mentoriaCodes = new Set(
    (sessions ?? []).map((s) => meetCodeFromUrl(s.gmeet_url)).filter(Boolean) as string[],
  )
  const byCode = new Map<string, (typeof classes extends (infer T)[] | null ? T : never)[]>()
  for (const c of classes ?? []) {
    const code = meetCodeFromUrl(c.meet_url)
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), c])
  }

  const matchedClassIds = new Set<string>()
  const { data: audited } = await admin
    .from('class_audits')
    .select('class_instance_id')
    .in('class_instance_id', (classes ?? []).map((c) => c.id))
  const alreadyAudited = new Set((audited ?? []).map((a) => a.class_instance_id))

  for (const rec of recordings) {
    // P20: gravação de encontro de MENTORIA é reconhecida e DESCARTADA
    if ((rec.meetCode && mentoriaCodes.has(rec.meetCode)) || /mentoria/i.test(rec.name)) {
      report.mentoria_descartadas.push(rec.fileId)
      continue
    }

    // rota PRIMÁRIA: código do Meet; FALLBACK: janela de horário (única candidata)
    let cls = rec.meetCode ? (byCode.get(rec.meetCode) ?? [])[0] : undefined
    if (!cls) {
      const t = Date.parse(rec.createdAtUtc)
      const candidates = (classes ?? []).filter(
        (c) => t >= Date.parse(c.starts_at_utc) - 15 * 60_000 && t <= Date.parse(c.ends_at_utc) + 120 * 60_000,
      )
      if (candidates.length === 1) cls = candidates[0]
    }
    if (!cls) {
      report.orfas.push(rec.fileId)
      continue
    }
    report.matched++
    matchedClassIds.add(cls.id)

    const scheduledMin = Math.round((Date.parse(cls.ends_at_utc) - Date.parse(cls.starts_at_utc)) / 60_000)
    if (rec.durationMin != null && rec.durationMin < scheduledMin / 2) {
      report.curtas.push(rec.fileId)
    }

    try {
      if (!alreadyAudited.has(cls.id)) {
        if (rec.transcriptText && rec.transcriptText.trim().length > 0) {
          await ports.runAudit(cls.id, rec.transcriptText)
          report.audited++
          alreadyAudited.add(cls.id)
        } else {
          report.sem_transcricao.push(rec.fileId)
        }
      }
      // retenção PÓS-AUDITORIA: só gravação já auditada e mais velha que o prazo
      if (
        ports.deleteRecording &&
        opts.retainDays != null &&
        alreadyAudited.has(cls.id) &&
        Date.parse(rec.createdAtUtc) < now.getTime() - opts.retainDays * 864e5
      ) {
        await ports.deleteRecording(rec.fileId)
        report.deleted++
      }
    } catch (err) {
      report.erros.push({ fileId: rec.fileId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  for (const c of classes ?? []) {
    if (c.state === 'completed' && !matchedClassIds.has(c.id)) {
      report.aulas_sem_gravacao.push(c.id)
    }
  }
  return report
}
