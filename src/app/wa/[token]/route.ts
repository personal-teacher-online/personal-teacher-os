import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ADR-019 — porta de entrada dos links do WhatsApp: troca o magic link (uso
// único, gerado por mensagem no despachante) por uma SESSÃO completa e cai na
// página pedida. É a exceção deliberada ao ADR-014 (que segue valendo para
// E-MAIL — /auth/confirm continua recusando magiclink). Token usado/vencido
// degrada para /login com o destino preservado — nunca uma página morta. O
// destino é restrito ao portal (allowlist), para não virar open redirect.
const DEST_OK = /^\/portal(\/|$)/

// Location RELATIVO (padrão do /auth/confirm): atrás do Cloudflare/Traefik o
// request.url pode carregar o host interno — absoluto vazaria isso.
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const ir = request.nextUrl.searchParams.get('ir') ?? '/portal'
  const dest = DEST_OK.test(ir) ? ir : '/portal'

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: token })

  if (error) return redirectTo(`/login?erro=link-invalido&next=${encodeURIComponent(dest)}`)
  return redirectTo(dest)
}
