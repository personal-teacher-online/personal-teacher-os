// TRILHO DO PORTAL DO ALUNO (Onda do Portal · P1) — espelho do
// `src/components/admin/nav.ts`, com a mesma disciplina: o array é a ÚNICA
// tabela de navegação, e tanto o item aceso quanto o nome da seção saem dele.
//
// Server-safe DE PROPÓSITO: nada de JSX, nada de ícone. Quem desenha (e quem
// escolhe o ícone) é o `PortalNavClient`; o layout — que é servidor — só
// precisa saber QUAIS itens existem, e isso ele lê aqui sem arrastar `react`
// nem `lucide-react` para dentro do bundle do servidor.
//
// A ordem é a da IA do portal: Início · Aulas · Pagamentos · Perfil, com
// Mentoria entrando ANTES do Perfil para quem é do Personal Travel — o perfil
// é o fim da fila em toda superfície do produto.

export interface ItemDoPortal {
  href: string
  rotulo: string
  /** rotas-filhas que pertencem a esta seção e por isso ACENDEM o item */
  tambem?: string[]
}

/** Os itens que TODO aluno tem. */
export const ITENS_BASE: ItemDoPortal[] = [
  { href: '/portal', rotulo: 'Início' },
  // As telas do mundo "aulas" moram em rotas irmãs (detalhe, extrato de
  // crédito, remarcar, cancelar, resgatar): sem elas em `tambem`, o aluno
  // navega para dentro de uma aula e a barra apaga — ninguém sabe mais onde
  // está.
  //
  // `/portal/resgatar/<contrato>` é o AGENDAMENTO DE REPOSIÇÃO da aula
  // particular (gasta crédito do `makeup_ledger`) — não tem relação com a
  // mentoria, onde estava pendurado até a revisão adversarial P1 · F3. Quem
  // resgatava uma reposição via a barra acender "Mentoria".
  {
    href: '/portal/aulas',
    rotulo: 'Aulas',
    tambem: [
      '/portal/aula',
      '/portal/creditos',
      '/portal/remarcar',
      '/portal/cancelar',
      '/portal/resgatar',
    ],
  },
  { href: '/portal/pagamentos', rotulo: 'Pagamentos' },
  // Ciência (o aceite de LGPD) é assunto de conta: acende o Perfil.
  { href: '/portal/perfil', rotulo: 'Perfil', tambem: ['/portal/ciencia'] },
]

/**
 * A aba CONDICIONAL: só existe para quem tem contrato de mentoria ativo
 * (`contracts.contract_type='mentorship'` + `status='active'`, sob RLS). Quem
 * responde essa pergunta é `temMentoriaAtiva` (`src/lib/portal/data.ts`) — aqui
 * mora apenas o item.
 */
export const ITEM_MENTORIA: ItemDoPortal = {
  href: '/portal/mentoria',
  rotulo: 'Mentoria',
}

/** O trilho do aluno: Mentoria entra ANTES do Perfil, nunca no fim. */
export function itensDoPortal(temMentoria: boolean): ItemDoPortal[] {
  if (!temMentoria) return ITENS_BASE
  const iPerfil = ITENS_BASE.findIndex((i) => i.href === '/portal/perfil')
  return [...ITENS_BASE.slice(0, iPerfil), ITEM_MENTORIA, ...ITENS_BASE.slice(iPerfil)]
}

/**
 * Nome da seção, derivado do MESMO array — a regra do admin: o nome que a tela
 * diz é o nome que o menu diz, sem uma segunda tabela para dessincronizar.
 * A Mentoria entra na busca mesmo para quem não a tem no trilho: quem chega em
 * `/portal/mentoria` sem contrato vê a defesa da página, e a seção continua
 * tendo nome.
 */
export function tituloDaRota(pathname: string): string {
  return [...ITENS_BASE, ITEM_MENTORIA].find((i) => itemAtivo(pathname, i))?.rotulo ?? MARCA_PORTAL
}

const MARCA_PORTAL = 'Portal do aluno'

export function itemAtivo(pathname: string, item: ItemDoPortal): boolean {
  // `/portal` é a raiz: igualdade ESTRITA, senão ele acende em toda tela do
  // portal. Os demais acendem em si e nas filhas.
  const casa = (href: string) =>
    href === '/portal' ? pathname === '/portal' : pathname === href || pathname.startsWith(`${href}/`)
  return casa(item.href) || (item.tambem ?? []).some(casa)
}
