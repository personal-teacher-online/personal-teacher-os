import { NextResponse } from 'next/server'
import {
  BEACON_MAX_BYTES,
  handleBeacon,
  readCappedBody,
  supabaseTelemetrySink,
} from '@/lib/telemetry/handle'
import { roleFromUser } from '@/lib/auth/gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// POST /api/beacon — page_view de quem tem sessão. Escreve com service_role
// (a tabela nega INSERT a todo mundo; a RPC record_ui_event é o único caminho).
// SEMPRE 204, em qualquer desfecho: quem chama é um sendBeacon que não lê a
// resposta, e um corpo de erro só serviria para vazar o que existe do lado de
// cá. Sem sessão → descarta (v1 não grava anônimo).
//
// O corpo é lido com TETO EM BYTES (readCappedBody): recusa pelo
// Content-Length quando ele vem e, quando não vem, aborta o stream no limite —
// nunca bufferiza o corpo inteiro para só depois medir.
const vazio204 = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request) {
  try {
    const raw = await readCappedBody(req, BEACON_MAX_BYTES)
    if (raw === null) return vazio204()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const session = user ? { userId: user.id, role: roleFromUser(user) } : null

    await handleBeacon(raw, session, supabaseTelemetrySink(createAdminClient()))
  } catch {
    /* telemetria nunca devolve erro */
  }
  return vazio204()
}
