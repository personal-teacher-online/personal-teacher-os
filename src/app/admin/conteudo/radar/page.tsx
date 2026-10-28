// LÁPIDE DO ENDEREÇO ANTIGO DO RADAR (cutover da Leva 5).
//
// O radar nasceu aqui como rota IRMÃ do Estúdio (Leva 3) e assumiu a casa
// (`/admin/conteudo`) quando a geração ligou. Este arquivo fica UMA leva só,
// para que link salvo, aba aberta e favorito da Teacher Vicky não caiam em 404 no dia
// da virada — a Leva 7 o apaga junto com os outros renomes.
//
// `redirect` do servidor (302 por padrão): nada de `permanentRedirect`, que o
// navegador cacheia para sempre e sobreviveria ao arquivo.

import { redirect } from 'next/navigation'

import { CASA_DO_RADAR } from '@/data/admin/radar-gramatica'

export default async function RadarEnderecoAntigo({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // A query inteira viaja junto: `?ver=pt`, `?alvo=`, filtros da vista Todos —
  // quem tinha um link para uma trend específica continua chegando nela.
  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [chave, valor] of Object.entries(sp)) {
    if (typeof valor === 'string') query.set(chave, valor)
    else if (Array.isArray(valor) && valor[0] != null) query.set(chave, valor[0])
  }
  const busca = query.toString()
  redirect(busca ? CASA_DO_RADAR + '?' + busca : CASA_DO_RADAR)
}
