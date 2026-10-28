// Worker do pipeline de auditoria (Fase 4, handoff §1 — "fora do app; o app só
// recebe"). Roda por Scheduled Task/CLI (mesmo desvio da Lei 5 já registrado no
// ADR-015 para o dispatcher: agendador externo em vez de fila viva; pgmq entra
// se/quando o volume justificar).
//
// Fluxo por aula: class_instances com drive_recording_id e SEM auditoria, já
// encerrada → baixa a gravação do Drive → extrai/comprime áudio (ffmpeg, mono
// 48kbps m4a — a doc oficial da OpenAI manda "chunk ou formato comprimido",
// limite 25MB) → fatia em blocos de 20min se preciso → whisper-1 (verificado
// 14/07/2026: US$0,006/min, verbose_json, 500 RPM sem TPM) → transcrição →
// runClassAudit (prompt ativo + Structured Outputs + validação de shape) →
// record_class_audit via service_role. Transcrição NÃO sobe para lugar nenhum
// no v1: p_raw_transcript_ref guarda o próprio drive_recording_id (fonte
// re-derivável) — texto cru NUNCA no banco (handoff §1).
//
// Uso:  node --env-file=.env.local worker/audit-pipeline.ts [instance_id]
// Envs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
//       ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON. Requer ffmpeg no PATH.

import { execFileSync } from 'node:child_process'
import { createReadStream, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { runClassAudit } from '../src/lib/ai/audit'
import { downloadDriveFile, googleClientsFromEnv } from '../src/lib/google/slides'

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024 // margem sob o limite oficial de 25MB

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
}

async function transcribe(openai: OpenAI, audioPath: string): Promise<string> {
  const size = statSync(audioPath).size
  const paths: string[] = []
  if (size <= MAX_UPLOAD_BYTES) {
    paths.push(audioPath)
  } else {
    // Fatias de 20min sem recomprimir (copy) — "não cortar no meio da frase" é
    // aproximado por blocos longos; contexto perdido nas bordas é aceitável aqui.
    const dir = join(audioPath, '..')
    ffmpeg(['-i', audioPath, '-f', 'segment', '-segment_time', '1200', '-c', 'copy', join(dir, 'chunk-%02d.m4a')])
    for (const f of readdirSync(dir).filter((f) => f.startsWith('chunk-')).sort()) {
      paths.push(join(dir, f))
    }
  }
  let out = ''
  for (const p of paths) {
    const res = await openai.audio.transcriptions.create({
      file: createReadStream(p),
      model: 'whisper-1',
      response_format: 'verbose_json',
      // Vocabulário da casa melhora nomes próprios (doc oficial: prompt guia estilo).
      prompt: 'Aula de inglês da Personal Teacher Online, professora e aluno alternando inglês e português.',
    })
    out += `${(res as { text?: string }).text ?? ''}\n`
  }
  return out.trim()
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY ausentes')
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente')
  const clients = googleClientsFromEnv()
  if (!clients) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ausente')

  const admin = createClient(url, key, { auth: { persistSession: false } })
  const openai = new OpenAI()

  const onlyInstance = process.argv[2]
  let candidates: { id: string; drive_recording_id: string }[]
  if (onlyInstance) {
    const { data } = await admin
      .from('class_instances')
      .select('id, drive_recording_id')
      .eq('id', onlyInstance)
    candidates = (data ?? []).filter((c): c is typeof c & { drive_recording_id: string } => !!c.drive_recording_id)
  } else {
    // Aulas encerradas com gravação e sem auditoria (upsert garante idempotência
    // se a corrida acontecer — caso 2 do handoff).
    const { data: withRec } = await admin
      .from('class_instances')
      .select('id, drive_recording_id, ends_at_utc')
      .not('drive_recording_id', 'is', null)
      .lt('ends_at_utc', new Date().toISOString())
      .order('ends_at_utc', { ascending: false })
      .limit(20)
    const ids = (withRec ?? []).map((r) => r.id)
    const { data: audited } = ids.length
      ? await admin.from('class_audits').select('class_instance_id').in('class_instance_id', ids)
      : { data: [] as { class_instance_id: string }[] }
    const done = new Set((audited ?? []).map((a) => a.class_instance_id))
    candidates = (withRec ?? [])
      .filter((r) => !done.has(r.id))
      .map((r) => ({ id: r.id, drive_recording_id: r.drive_recording_id as string }))
  }

  console.log(`aulas para auditar: ${candidates.length}`)
  for (const c of candidates) {
    const dir = mkdtempSync(join(tmpdir(), 'ptos-audit-'))
    try {
      console.log(`→ ${c.id}: baixando gravação ${c.drive_recording_id}`)
      const media = await downloadDriveFile(clients, c.drive_recording_id)
      const src = join(dir, 'gravacao.bin')
      writeFileSync(src, media)
      const audio = join(dir, 'audio.m4a')
      ffmpeg(['-i', src, '-vn', '-ac', '1', '-b:a', '48k', audio])
      console.log(`  transcrevendo (whisper-1)…`)
      const transcript = await transcribe(openai, audio)
      if (!transcript) throw new Error('transcrição vazia')
      console.log(`  auditando (${transcript.length} chars)…`)
      const { auditId, checklist } = await runClassAudit(admin, {
        instanceId: c.id,
        transcript,
        transcriptRef: c.drive_recording_id,
      })
      console.log(`  ✓ auditoria ${auditId} — passed=${checklist.passed}`)
    } catch (err) {
      console.error(`  ✗ ${c.id}: ${String(err)}`)
      process.exitCode = 1
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

main().catch((err) => {
  console.error('audit-pipeline falhou:', err)
  process.exit(1)
})
