import type { NextRequest } from 'next/server'
import { DESTINO_DOS_CREDITOS, entrarPeloLink } from '../entrar'

// #116 — o link do botão "Usar meu crédito" do aviso de crédito vencendo:
// `/wa/<hash>/creditos`. Entra logado (ADR-019) e cai na tela "Seus créditos";
// a regra da porta mora em `../entrar.ts`.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  return entrarPeloLink(token, DESTINO_DOS_CREDITOS)
}
