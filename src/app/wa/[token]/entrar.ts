import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ADR-019 — a porta de entrada dos links do WhatsApp, comum às duas formas do
// endereço: troca o magic link (uso único, gerado por mensagem no despachante)
// por uma SESSÃO completa e cai na página pedida. É a exceção deliberada ao
// ADR-014 (que segue valendo para E-MAIL — /auth/confirm continua recusando
// magiclink). Token usado/vencido degrada para /login com o destino preservado
// — nunca uma página morta. O destino é restrito ao portal (allowlist), para
// não virar open redirect.
//
// As formas:
//   /wa/<hash>?ir=/portal/aula/<id>   a original (o que já saiu continua valendo)
//   /wa/<hash>/aula/<id>              #115: o botão de URL da Meta tem UMA
//                                     variável, no fim, e não garante `?` nela
//   /wa/<hash>/creditos               #116: o aviso de crédito vencendo

const DEST_OK = /^\/portal(\/|$)/
const ID_DE_AULA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O destino do `?ir=`, só dentro do portal (senão o início do portal). */
export function destinoDaQuery(ir: string | null): string {
  const pedido = ir ?? '/portal'
  return DEST_OK.test(pedido) ? pedido : '/portal'
}

/** #116: a tela "Seus créditos", destino do aviso de crédito vencendo. */
export const DESTINO_DOS_CREDITOS = '/portal/creditos'

/** A página da aula pelo id do caminho; id que não é de aula cai no início do portal. */
export function destinoDaAula(id: string): string {
  return ID_DE_AULA.test(id) ? `/portal/aula/${id.toLowerCase()}` : '/portal'
}

// Location RELATIVO (padrão do /auth/confirm): atrás do Cloudflare/Traefik o
// request.url pode carregar o host interno — absoluto vazaria isso.
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } })
}

/** Troca o token por sessão e redireciona ao destino (já conferido). */
export async function entrarPeloLink(token: string, destino: string): Promise<NextResponse> {
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: token })
  if (error) return redirectTo(`/login?erro=link-invalido&next=${encodeURIComponent(destino)}`)
  return redirectTo(destino)
}
