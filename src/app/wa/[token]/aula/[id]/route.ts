import type { NextRequest } from 'next/server'
import { destinoDaAula, entrarPeloLink } from '../../entrar'

// #115 — o link do botão "Ver minha aula"/"Confirmar presença" do WhatsApp:
// `/wa/<hash>/aula/<id>`, com o destino no CAMINHO (a variável do botão de URL
// da Meta fica no fim da URL e não garante `?`). Entra logado (ADR-019) e cai
// em `/portal/aula/<id>`; a regra da porta mora em `../../entrar.ts`.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params
  return entrarPeloLink(token, destinoDaAula(id))
}
