import { google } from 'googleapis'
import { runClassAudit } from '@/lib/ai/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AuditPorts, RecordingFile } from './audit-recordings'
import { meetCodeFromUrl } from './audit-recordings'

// F11/M15 — adaptador REAL das portas do robô: pasta "Meet Recordings" da
// organizadora, acessada pela SERVICE ACCOUNT (delegação de domínio OU pasta
// compartilhada — providência externa do gate CHAVES). A transcrição vem do
// DOC NATIVO do Meet (gate do transcript): exportamos text/plain; Whisper/
// ffmpeg NUNCA entram por aqui.
//
// Convenções do Meet no Drive: a gravação (vídeo) e o Doc "… - Transcript"
// nascem na mesma pasta, com o mesmo prefixo de nome; o código da reunião
// costuma aparecer no nome/descrição — quando não aparece, o fallback por
// horário do robô cobre.

export async function driveAuditPortsFromEnv(): Promise<AuditPorts | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const folderId = process.env.AUDIT_RECORDINGS_FOLDER_ID
  if (!raw || !folderId) return null

  const key = JSON.parse(raw) as { client_email: string; private_key: string }
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  const drive = google.drive({ version: 'v3', auth })
  const admin = createAdminClient()

  async function listFolder() {
    const files: {
      id: string
      name: string
      mimeType: string
      createdTime: string
      description: string | null
      videoMediaMetadata?: { durationMillis?: string | null } | null
    }[] = []
    let pageToken: string | undefined
    do {
      const { data } = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime, description, videoMediaMetadata(durationMillis))',
        pageSize: 200,
        pageToken,
      })
      for (const f of data.files ?? []) {
        files.push({
          id: f.id ?? '',
          name: f.name ?? '',
          mimeType: f.mimeType ?? '',
          createdTime: f.createdTime ?? new Date(0).toISOString(),
          description: f.description ?? null,
          videoMediaMetadata: f.videoMediaMetadata ?? null,
        })
      }
      pageToken = data.nextPageToken ?? undefined
    } while (pageToken)
    return files
  }

  return {
    async listRecordings(): Promise<RecordingFile[]> {
      const files = await listFolder()
      const videos = files.filter((f) => f.mimeType.startsWith('video/'))
      const docs = files.filter((f) => f.mimeType === 'application/vnd.google-apps.document')

      const out: RecordingFile[] = []
      for (const v of videos) {
        // Doc de transcrição: mesmo prefixo de nome (convenção do Meet)
        const stem = v.name.replace(/\.(mp4|webm)$/i, '').slice(0, 30)
        const doc = docs.find((d) => d.name.startsWith(stem) || v.name.startsWith(d.name.slice(0, 30)))
        let transcriptText: string | null = null
        if (doc) {
          try {
            const { data } = await drive.files.export(
              { fileId: doc.id, mimeType: 'text/plain' },
              { responseType: 'text' },
            )
            transcriptText = typeof data === 'string' ? data : null
          } catch {
            transcriptText = null // sem transcript → flag 'sem_transcricao' no robô
          }
        }
        const durMs = Number(v.videoMediaMetadata?.durationMillis ?? NaN)
        out.push({
          fileId: v.id,
          name: v.name,
          createdAtUtc: v.createdTime,
          durationMin: Number.isFinite(durMs) ? Math.round(durMs / 60_000) : null,
          meetCode: meetCodeFromUrl(v.description) ?? meetCodeFromUrl(v.name),
          transcriptText,
        })
      }
      return out
    },
    async runAudit(instanceId, transcript) {
      await runClassAudit(admin, { instanceId, transcript, transcriptRef: null })
    },
    async deleteRecording(fileId) {
      await drive.files.delete({ fileId })
    },
  }
}
