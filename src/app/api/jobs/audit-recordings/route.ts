import { NextResponse, type NextRequest } from 'next/server'
import { safeTokenEqual } from '@/lib/auth/token'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditRecordings } from '@/lib/jobs/audit-recordings'
import { driveAuditPortsFromEnv } from '@/lib/jobs/audit-recordings-drive'

// F11/M15 — rota fina do robô de auditoria (Scheduled Task diário, mesmo padrão
// do dispatch-outbox: token no header, fail-closed; envs ausentes = inoperante).
// Retenção: AUDIT_RETAIN_DAYS (política com NÚMEROS — entregável do gate CHAVES);
// sem a env, nada é apagado.
export async function POST(request: NextRequest) {
  const expected = process.env.AUDIT_RECORDINGS_TOKEN
  const token = request.headers.get('audit-recordings-token')
  if (!expected || !token || !safeTokenEqual(token, expected)) {
    return NextResponse.json({ ok: false, detail: 'token inválido' }, { status: 401 })
  }

  const ports = await driveAuditPortsFromEnv()
  if (!ports) {
    return NextResponse.json({ ok: true, detail: 'integração de gravações desligada (envs ausentes)' })
  }
  const retainRaw = Number(process.env.AUDIT_RETAIN_DAYS)
  const report = await auditRecordings(createAdminClient(), ports, {
    retainDays: Number.isFinite(retainRaw) && retainRaw > 0 ? retainRaw : null,
  })
  return NextResponse.json({ ok: true, ...report })
}
