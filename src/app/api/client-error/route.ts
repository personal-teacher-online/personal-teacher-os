import { NextResponse } from 'next/server'
import {
  anonBucketKey,
  CLIENT_ERROR_MAX_BYTES,
  handleClientError,
  readCappedBody,
  supabaseTelemetrySink,
} from '@/lib/telemetry/handle'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// POST /api/client-error — erro de navegador, deduplicado por (hash, user_id)
// no banco. Aceita SEM sessão (o erro pode acontecer no /login ou numa página
// pública). Rate-limit PARTICIONADO vive no handler: quem tem sessão tem cota
// por usuário, quem não tem cai num balde derivado do IP da borda. SEMPRE 204.
//
// Corpo lido com teto em BYTES (readCappedBody), igual ao beacon.
const vazio204 = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request) {
  try {
    const raw = await readCappedBody(req, CLIENT_ERROR_MAX_BYTES)
    if (raw === null) return vazio204()

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Cloudflare está na frente (stack fixo): cf-connecting-ip é o IP real e
    // não é forjável pelo cliente como o x-forwarded-for seria. O IP NÃO é
    // guardado nem logado — vira só um balde de hash com sal de boot.
    const anonKey = user ? null : anonBucketKey(req.headers.get('cf-connecting-ip'))

    await handleClientError(
      raw,
      { userId: user?.id ?? null, anonKey },
      supabaseTelemetrySink(createAdminClient()),
    )
  } catch {
    /* telemetria nunca devolve erro */
  }
  return vazio204()
}
