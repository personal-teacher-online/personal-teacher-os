import type { NextRequest } from 'next/server'
import { destinoDaQuery, entrarPeloLink } from './entrar'

// ADR-019 — o link do WhatsApp com o destino no `?ir=` (a forma original; o
// que já saiu nessa forma continua valendo). A regra da porta mora em
// `./entrar.ts`, comum à forma com o destino no caminho (#115).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  return entrarPeloLink(token, destinoDaQuery(request.nextUrl.searchParams.get('ir')))
}
