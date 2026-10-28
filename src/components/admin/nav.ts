// TRILHO DO ADMIN (Onda 1 · M1, item 8 — IA de 26/07).
//
// Ordem decidida na IA:
//   Início · Agenda · Alunos · Financeiro · Mentoria · Mensagens · Estúdio ·
//   Professoras · Relatórios
//
// Mudanças vs. o trilho velho: Contratos DEIXA de ser 1º nível (vira aba do hub
// Alunos — Q1), "Avisos" vira Mensagens, "Pagamentos" vira Financeiro, "Ajustes"
// nasce (Q2).
//
// M3-c5 · D3: o Ajustes SAIU do trilho e foi para o menu da conta (emenda de
// POSIÇÃO da Q2 — a seção continua existindo). Ele está logo abaixo, em
// `AJUSTES`, e não no array: quem varre o trilho desenha navegação de trabalho,
// e configuração não é isso.
//
// CONVIVÊNCIA: "Início" (M2) e "Alunos" (M3-1) apontam para tela NOVA. As
// demais apontam para as rotas velhas correspondentes — nenhuma rota velha
// morre antes de a nova existir, e nada de tela fantasma "em construção".
import type { ComponentType } from 'react'
import {
  CalendarDays,
  ChartNoAxesColumn,
  CreditCard,
  GraduationCap,
  House,
  Megaphone,
  MessageSquare,
  Presentation,
  Settings,
  UsersRound,
} from 'lucide-react'

export interface ItemDoTrilho {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** rotas velhas que pertencem a esta seção na IA nova (acendem o item) */
  tambem?: string[]
  /** true = já é tela nova desta onda */
  nova?: boolean
}

export const TRILHO: ItemDoTrilho[] = [
  { href: '/admin', label: 'Início', icon: House, nova: true },
  { href: '/admin/agenda', label: 'Agenda', icon: CalendarDays },
  // Alunos virou tela NOVA no M3-1 (o hub). A ficha (`/admin/alunos/[id]`)
  // ainda é a velha até o M3-2, e Contratos acende aqui porque, na IA nova,
  // ele mora dentro de Alunos.
  { href: '/admin/alunos', label: 'Alunos', icon: UsersRound, tambem: ['/admin/contratos'], nova: true },
  // Onda Financeiro · F1: a tela nova (abas + badge de vencidas + régua do banco).
  { href: '/admin/pagamentos', label: 'Financeiro', icon: CreditCard, nova: true },
  { href: '/admin/mentoria', label: 'Mentoria', icon: GraduationCap },
  { href: '/admin/avisos', label: 'Mensagens', icon: MessageSquare },
  { href: '/admin/conteudo', label: 'Estúdio', icon: Megaphone },
  { href: '/admin/professoras', label: 'Professoras', icon: Presentation },
  { href: '/admin/relatorios', label: 'Relatórios', icon: ChartNoAxesColumn },
]

/**
 * AJUSTES — a seção existe (Q2), mas não mora no TRILHO (M3-c5 · D3).
 *
 * Emenda de POSIÇÃO pedida pelo dono, espelhando o TutorBird: configuração é
 * assunto de CONTA, não destino de trabalho do dia. Ela sai do trilho e passa a
 * viver no menu da conta, no alto à direita, junto de "Sair" — o mesmo lugar
 * onde o TutorBird guarda as dele. O DESTINO não mudou: continua apontando
 * para as JANELAS, a página velha que a seção vai absorver, nunca para um
 * placeholder vazio.
 *
 * No CELULAR não há menu de conta (a barra superior é só identidade), então
 * quem hospeda o Ajustes lá é o menu "Mais" da barra de polegar — o mesmo que
 * já hospeda "Sair". Sem isso, a emenda apagaria o acesso móvel a Ajustes.
 *
 * ONDA DA AGENDA · A8: o destino deixou de ser `/admin/janelas` (a página velha
 * que a seção ia absorver) e passou a ser `/admin/ajustes`, que nasceu com os
 * quatro blocos. `/admin/janelas` continua chegando — virou redirect para cá,
 * pelos links salvos.
 */
export const AJUSTES: ItemDoTrilho = {
  href: '/admin/ajustes',
  label: 'Ajustes',
  icon: Settings,
}

/** Celular: barra inferior de polegar (Q5) — o resto vai para "Mais". */
export const POLEGAR = ['/admin', '/admin/agenda', '/admin/alunos']

/**
 * Título da página para a BARRA SUPERIOR (clonagem TutorBird: o título vive na
 * barra persistente, não dentro do conteúdo). Deriva do trilho — assim o nome
 * na barra é sempre o mesmo nome do menu, sem uma segunda tabela para
 * dessincronizar. Rota fora do trilho cai no nome da casa.
 *
 * O Ajustes entra na busca mesmo tendo saído do trilho (D3): ele mudou de
 * LUGAR, não de nome — e a barra tem de continuar dizendo "Ajustes" quando a
 * pessoa está lá, senão a página vira "Administração" sem motivo.
 */
export function tituloDaRota(pathname: string): string {
  return [...TRILHO, AJUSTES].find((i) => itemAtivo(pathname, i))?.label ?? MARCA_ADMIN
}

const MARCA_ADMIN = 'Administração'

export function itemAtivo(pathname: string, item: ItemDoTrilho): boolean {
  const casa = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`)
  return casa(item.href) || (item.tambem ?? []).some(casa)
}
