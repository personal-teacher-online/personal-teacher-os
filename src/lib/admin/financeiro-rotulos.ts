// A COBRANÇA NA VOZ DA ESCOLA (Onda Financeiro · F1).
//
// Mesmo contrato do módulo-irmão do portal (`src/lib/portal/pagamentos.ts`):
// aqui não se DECIDE nada sobre dinheiro — quem decide é o banco
// (`payment_situacao`, via a view `payments_admin`), e o que chega é o NOME do
// desfecho. Este arquivo só traduz nome → frase + tom, e é puro de propósito
// (testável sem navegador).
//
// A VOZ É OUTRA. O portal fala com o aluno ("o valor voltou para você"); esta
// tela fala com a DONA, que precisa saber o que fazer: acompanhar a disputa,
// conferir um status novo, ou nada. Por isso as explicações apontam para o
// painel do Asaas — que é onde a cobrança de verdade vive (o app é espelho).
import type { SituacaoDaCobranca } from '@/lib/portal/data'
import type { PillTone } from '@/components/kit/pill'

export type { SituacaoDaCobranca }

export interface RotuloAdminDaCobranca {
  /** o que a pill diz */
  frase: string
  tom: PillTone
  /** linha de apoio quando o rótulo sozinho deixaria a dona sem ação */
  explicacao: string | null
}

const ROTULOS: Record<SituacaoDaCobranca, RotuloAdminDaCobranca> = {
  paga: { frase: 'paga', tom: 'ok', explicacao: null },
  em_aberto: { frase: 'em aberto', tom: 'neutral', explicacao: null },
  em_atraso: {
    frase: 'vencida',
    tom: 'danger',
    explicacao: null,
  },
  estornada: {
    frase: 'estornada',
    tom: 'muted',
    explicacao: 'o valor voltou ao pagador — não conta como recebido.',
  },
  // NUNCA "estornada" seca: voltou UMA PARTE, e o quanto não está nesta tela.
  estorno_parcial: {
    frase: 'estorno parcial',
    tom: 'muted',
    explicacao: 'parte do valor foi devolvida — o detalhe está no painel do Asaas.',
  },
  estorno_em_andamento: {
    frase: 'estorno em andamento',
    tom: 'muted',
    explicacao: 'devolução solicitada, ainda processando — nada voltou por enquanto.',
  },
  // Chargeback: a única voz de ATENÇÃO que não é vencimento — a dona pode ter
  // que apresentar defesa, e o prazo corre no banco, não aqui.
  em_disputa: {
    frase: 'em disputa',
    tom: 'warn',
    explicacao: 'chargeback em análise — acompanhar (e responder) no painel do Asaas.',
  },
  cancelada: {
    frase: 'cancelada',
    tom: 'muted',
    explicacao: 'cancelada na origem — nunca houve o que receber.',
  },
  // O banco tem vocabulário fechado; este ramo é para o dia em que ele crescer.
  desconhecida: {
    frase: 'situação a confirmar',
    tom: 'muted',
    explicacao: 'status que esta tela ainda não conhece — conferir no painel do Asaas.',
  },
}

export function rotuloAdminDaCobranca(situacao: SituacaoDaCobranca): RotuloAdminDaCobranca {
  return ROTULOS[situacao] ?? ROTULOS.desconhecida
}

/** O que a view devolve é texto; nome fora do vocabulário cai em `desconhecida`
 *  — nunca herda outro desfecho por omissão (o defeito de origem da tela velha). */
export function situacaoDaView(nome: string | null | undefined): SituacaoDaCobranca {
  return nome && nome in ROTULOS ? (nome as SituacaoDaCobranca) : 'desconhecida'
}
