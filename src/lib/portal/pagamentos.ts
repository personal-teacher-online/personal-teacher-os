// A COBRANÇA EM LINGUAGEM DE GENTE (Onda do Portal · P5).
//
// Aqui não se DECIDE nada sobre dinheiro: quem decide é o banco
// (`payment_situacao`, migration 20260728000800), e o que chega a este arquivo
// já é o nome do desfecho. O que mora aqui é a tradução nome → frase + tom, e
// ela é pura para caber num teste sem navegador.
//
// AS VOZES QUE FALTAVAM. Até o P4 a tela tinha duas pills — "vencida" e "em
// aberto" — e chamava de "paga" TUDO o mais. Uma cobrança ESTORNADA (o dinheiro voltou
// para o aluno) e uma CANCELADA (nunca houve o que pagar) saíam com o verde de
// quitada: a escola afirmando ter recebido o que devolveu. O balde
// não-cobrável ganhou voz própria, e ela não é verde nem vermelha — não há nada
// a comemorar nem a fazer.
//
// A VOZ SÓ AFIRMA O QUE O SISTEMA SABE (rodada de correção). Três desfechos
// saíram de dentro de "estornada" porque nenhum deles devolveu dinheiro ao
// aluno: o estorno PARCIAL (parte voltou), o estorno EM ANDAMENTO (ainda não
// voltou nada) e a DISPUTA de chargeback (o banco está decidindo). Cada um tem
// frase própria, e só "estornada" pode dizer "o valor voltou para você".
import type { SituacaoDaCobranca } from '@/lib/portal/data'
import type { PillTone } from '@/components/kit/pill'

export interface RotuloDaCobranca {
  /** o que a pill diz */
  frase: string
  tom: PillTone
  /** a linha de apoio, quando o rótulo sozinho deixaria dúvida */
  explicacao: string | null
}

const ROTULOS: Record<SituacaoDaCobranca, RotuloDaCobranca> = {
  paga: { frase: 'paga', tom: 'ok', explicacao: null },
  em_aberto: {
    frase: 'em aberto',
    tom: 'neutral',
    explicacao: 'ainda dá tempo — o pagamento entra no dia do vencimento.',
  },
  em_atraso: {
    frase: 'vencida',
    tom: 'danger',
    explicacao: 'o vencimento já passou. Se você já pagou, avise a gente que a gente confere.',
  },
  estornada: {
    frase: 'estornada',
    tom: 'muted',
    explicacao: 'o valor voltou para você — não há nada a pagar nesta cobrança.',
  },
  // NUNCA "o valor voltou": voltou UMA PARTE, e o quanto não está nesta tela.
  estorno_parcial: {
    frase: 'estorno parcial',
    tom: 'muted',
    explicacao: 'parte do valor foi estornada — fale com a gente se tiver dúvida.',
  },
  // Pedido feito, dinheiro ainda no caminho. Prometer a devolução aqui é
  // prometer data que a escola não controla.
  estorno_em_andamento: {
    frase: 'estorno em andamento',
    tom: 'muted',
    explicacao: 'o estorno foi solicitado e ainda está sendo processado.',
  },
  // Chargeback aberto, contestado ou em reversão. O aluno não tem o que fazer, e
  // dizer qualquer coisa sobre o destino do dinheiro seria adivinhar.
  em_disputa: {
    frase: 'em disputa',
    tom: 'muted',
    explicacao: 'cobrança em análise — nada a fazer agora.',
  },
  cancelada: {
    frase: 'cancelada',
    tom: 'muted',
    explicacao: 'esta cobrança foi cancelada — não há nada a pagar nela.',
  },
  // O banco tem um vocabulário fechado; este ramo existe para o dia em que ele
  // crescer. Dizer "a confirmar" é a única coisa verdadeira que a tela sabe —
  // muito melhor que herdar "paga" por omissão, que foi o defeito de origem.
  desconhecida: {
    frase: 'situação a confirmar',
    tom: 'muted',
    explicacao: 'estamos conferindo esta cobrança com o financeiro.',
  },
}

export function rotuloDaCobranca(situacao: SituacaoDaCobranca): RotuloDaCobranca {
  return ROTULOS[situacao] ?? ROTULOS.desconhecida
}

/**
 * A ORDEM DA LISTA: urgência primeiro.
 *
 * vencida → em aberto → paga → resolvida sem pagamento (o resto). Dentro de cada
 * balde, quem chama ordena por data.
 */
export function urgenciaDaCobranca(situacao: SituacaoDaCobranca): number {
  switch (situacao) {
    case 'em_atraso':
      return 0
    case 'em_aberto':
      return 1
    case 'paga':
      return 2
    default:
      return 3
  }
}

/**
 * O VERBO DA DATA (achado 16 da rodada de correção).
 *
 * "vence em 10/08" é promessa de futuro: ela só cabe na cobrança que ainda está
 * de pé. Numa cobrança PAGA, CANCELADA ou ESTORNADA, o mesmo verbo sugere que
 * ainda há um vencimento chegando — e não há. Quem já venceu ganha o passado
 * ("venceu em"), e o resto mostra a data com rótulo neutro ("venc.").
 */
export function verboDoVencimento(situacao: SituacaoDaCobranca): string {
  if (situacao === 'em_aberto') return 'vence em'
  if (situacao === 'em_atraso') return 'venceu em'
  return 'venc.'
}
