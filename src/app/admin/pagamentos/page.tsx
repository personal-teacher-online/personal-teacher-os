// FINANCEIRO — N1 (Onda Financeiro · F1). A tela velha (régua própria em
// TypeScript, relógio na página, query inline) morre aqui.
//
// A RÉGUA É A DO BANCO. Cada linha chega da view `payments_admin` (migration
// 20260807000100) com o desfecho JÁ NOMEADO por `payment_situacao` — a mesma
// régua do portal e dos KPIs. Esta página não olha status cru nem relógio:
// o `PAGO = new Set(...)` que divergia do aluno (`RECEIVED_IN_CASH_UNDONE`
// saía "paga" aqui e "em aberto" lá) não tem herdeiro.
//
// ANATOMIA (spec `ia-site-2026-07.md:103`, padrão Stripe):
//   card-contêiner ← abas Em aberto | Pagas | Todas
//                    · VENCIDAS é BADGE sobre "Em aberto", nunca aba própria
//                    · "Todas" hospeda o que já terminou sem pagamento
//                      (estornos, disputa, canceladas) — os links velhos
//                      `?st=todas` continuam chegando nela
//     recorte      ← chips "todas em aberto / só vencidas" (só na 1ª aba)
//     conteúdo     ← tabela do kit (`ListaDeCobrancas`)
//
// DEEP-LINKS PRESERVADOS (BandaDeTopo da home): `?st=pagas` → aba Pagas;
// `?st=vencidas` → aba Em aberto com o recorte APLICADO NA CONSULTA (o WHERE
// leva `em_atraso = true`; a tela não filtra nada); `?st=aberto` → 1ª aba.
//
// SELEÇÃO MÚLTIPLA: ADIADA (decisão da revisão do plano). Gatilho de
// reavaliação: a primeira ação em massa com backend real.
//
// Zero query nesta página: quem lê é `src/data/admin/financeiro.ts`.

import Link from 'next/link'

import { ListaDeCobrancas } from '@/components/admin/financeiro/ListaDeCobrancas'
import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill } from '@/components/kit/pill'
import { getFinanceiro, type AbaDoFinanceiro } from '@/data/admin/financeiro'
import { cn } from '@/lib/cn'

export const metadata = { title: 'Financeiro — Admin' }

/** Estado vazio por recorte — vazio nunca é a mesma frase para todos. */
const VAZIO: Record<'aberto' | 'pagas' | 'todas' | 'vencidas', { titulo: string; frase: string }> = {
  aberto: {
    titulo: 'Nenhuma cobrança em aberto.',
    frase:
      'Cobrança nasce no painel do Asaas e aparece aqui pelo espelho. Enquanto a integração está desligada, esta lista fica vazia de propósito.',
  },
  vencidas: {
    titulo: 'Nenhuma cobrança vencida.',
    frase: 'É assim que a lista deve ficar — vencidas aparecem aqui no dia seguinte ao vencimento.',
  },
  pagas: {
    titulo: 'Nenhum pagamento confirmado ainda.',
    frase: 'Quando o Asaas confirmar um recebimento, a cobrança muda para cá sozinha.',
  },
  todas: {
    titulo: 'O espelho está vazio.',
    frase:
      'As cobranças do Asaas aparecem aqui automaticamente quando a integração for religada (gate da chave).',
  },
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ st?: string; msg?: string; n?: string }>
}) {
  const sp = await searchParams
  const soVencidas = sp.st === 'vencidas'
  const aba: AbaDoFinanceiro = sp.st === 'pagas' ? 'pagas' : sp.st === 'todas' ? 'todas' : 'aberto'
  const d = await getFinanceiro(aba, soVencidas)

  const vencidasBadge =
    d.contagens.vencidas > 0
      ? d.contagens.vencidas === 1
        ? '1 vencida'
        : `${d.contagens.vencidas} vencidas`
      : null

  const abas = [
    {
      label: 'Em aberto',
      href: '/admin/pagamentos',
      active: aba === 'aberto',
      count: d.contagens.aberto,
      // Inadimplência é BADGE sobre "em aberto", nunca status/aba própria
      // (padrão Stripe — pesquisa UX achado 8).
      badge: vencidasBadge ? <Pill tone="danger">{vencidasBadge}</Pill> : undefined,
    },
    { label: 'Pagas', href: '/admin/pagamentos?st=pagas', active: aba === 'pagas', count: d.contagens.pagas },
    { label: 'Todas', href: '/admin/pagamentos?st=todas', active: aba === 'todas', count: d.contagens.todas },
  ]

  const recorteChip = (rotulo: string, href: string, ativo: boolean) => (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-9 items-center rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
        ativo
          ? 'bg-ac-wash font-semibold text-ac-deep'
          : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
      )}
    >
      {rotulo}
    </Link>
  )

  const recorteVazio = soVencidas ? 'vencidas' : aba
  const cortada = d.totalDoRecorte > d.linhas.length

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />

      {/* F8/M11-2 — o alarme operacional do espelho: cobrança que chegou do
          Asaas e não casou (externalReference desconhecido). A correção é no
          painel do Asaas (rotina P21), por isso é faixa, não linha da tabela. */}
      {d.naoConciliadas > 0 && (
        <p className="rounded-input border border-warn-700/30 bg-warn-700/5 px-4 py-3 text-sm font-medium text-ink-900">
          {d.naoConciliadas === 1
            ? '1 evento do Asaas precisa de olho'
            : `${d.naoConciliadas} eventos do Asaas precisam de olho`}{' '}
          — cobrança que não casou (corrija o externalReference no painel; o próximo evento
          concilia sozinho) ou escrita que falhou e está em replay. O detalhe sai em{' '}
          <code className="font-mono text-sm">npm run asaas:reconciliar:prod</code>.
        </p>
      )}

      <CardPanel>
        <CardPanelTabs tabs={abas} />

        {aba === 'aberto' && d.contagens.vencidas > 0 && (
          <nav
            aria-label="Recorte das cobranças em aberto"
            className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2"
          >
            {recorteChip('Todas em aberto', '/admin/pagamentos', !soVencidas)}
            {recorteChip(
              d.contagens.vencidas === 1 ? 'Só a vencida' : `Só as vencidas (${d.contagens.vencidas})`,
              '/admin/pagamentos?st=vencidas',
              soVencidas,
            )}
          </nav>
        )}

        {cortada && (
          <p className="border-b border-line px-4 py-2 text-sm text-ink-600">
            Mostrando as <span className="font-semibold text-ink-900">{d.linhas.length}</span> mais
            recentes de <span className="font-semibold text-ink-900">{d.totalDoRecorte}</span> deste
            recorte.
          </p>
        )}

        <ListaDeCobrancas
          linhas={d.linhas}
          legenda={
            soVencidas
              ? 'Cobranças vencidas'
              : aba === 'aberto'
                ? 'Cobranças em aberto'
                : aba === 'pagas'
                  ? 'Cobranças pagas'
                  : 'Todas as cobranças do espelho'
          }
          vazio={
            <EmptyState
              illustration="/illustrations/agenda-vazia.svg"
              title={VAZIO[recorteVazio].titulo}
              hint={VAZIO[recorteVazio].frase}
            />
          }
        />
      </CardPanel>
    </main>
  )
}
