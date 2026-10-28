import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Destino do link dos e-mails: troca token_hash por sessão. ADR-014: o link por
// e-mail só existe para ATIVAR o convite (D6) e REDEFINIR senha — o login corrente
// é por senha. Por isso só estes dois tipos são aceitos (nada de magiclink), e os
// dois desaguam em /definir-senha.
const ALLOWED_TYPES: ReadonlySet<string> = new Set(['invite', 'recovery'])

// Location RELATIVO: atrás do Cloudflare/Traefik, request.url pode carregar o host
// interno/http — um Location absoluto vazaria isso para o browser.
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    })
    if (!error) return redirectTo('/definir-senha')
  }
  // F7/M4-2: link vencido/queimado ganha página acolhedora com reenvio NEUTRO
  return redirectTo('/convite-expirado')
}
