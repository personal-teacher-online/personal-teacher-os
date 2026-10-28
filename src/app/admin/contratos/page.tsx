// `/admin/contratos` — O ENCAMINHAMENTO (Onda 1 · M4-4).
//
// Aqui morava a lista de contratos: 814 linhas com sete leituras inline,
// cartões com `Drawer` do kit velho e dois formulários de criação por `?novo=`.
// Ela foi reconstruída em três endereços — índice em `/admin/alunos/contratos`
// (M4-1), detalhe em `/admin/contratos/[id]` (M4-2), criação em
// `/admin/contratos/novo` (M4-3) — e o contrato de URLs da onda (spec congelada
// em `docs/goals/onda-1-admin.md`) manda este endereço virar **redirect
// permanente**.
//
// 308 (`permanentRedirect`), e não 307: a mudança de endereço é definitiva, e é
// isso que faz o favorito da dona e o histórico do navegador aprenderem o
// destino novo em vez de baterem aqui para sempre.
//
// A REGRA DE PARA ONDE mora em `src/data/admin/contratos-legado.ts` — módulo
// puro, com a tabela de encaminhamento e teste caso a caso. Esta página é só a
// porta: lê a query e obedece.
//
// AS SUB-ROTAS NÃO SÃO AFETADAS: no App Router, `page.tsx` casa o segmento
// EXATO. `/admin/contratos/[id]` e `/admin/contratos/novo` têm página própria e
// continuam sendo os endereços vivos do detalhe e do wizard.

import { permanentRedirect } from 'next/navigation'

import { destinoDoLegado, type QueryDaTelaVelha } from '@/data/admin/contratos-legado'

export default async function ContratosLegadoPage({
  searchParams,
}: {
  // c12 · nº 20: o tipo é o que o App Router ENTREGA — cada chave pode chegar
  // como lista (`?q=Ana&q=Bia`). Declarar `string` aqui era uma promessa que o
  // framework não faz, e o array escorregava até virar `q=Ana%2CBia` no
  // destino. `QueryDaTelaVelha` já aceita as duas formas e normaliza dentro.
  searchParams: Promise<QueryDaTelaVelha>
}) {
  permanentRedirect(destinoDoLegado(await searchParams))
}
