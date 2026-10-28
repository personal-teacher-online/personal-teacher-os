// D9 — A REGRA DE CRÉDITO, ESCRITA EM LÍNGUA DE GENTE (Onda do Portal · P3).
//
// Duas coisas moram aqui, e as duas são PURAS (nenhuma conversa com o banco):
//   1. o motivo técnico de cada crédito virando frase que o aluno entende;
//   2. a validade nos DOIS formatos que a IA exige (D2): a data absoluta, que
//      dá para anotar na agenda, e a distância ("faltam 48 dias"), que dá a
//      urgência — uma sozinha sempre falha para metade das pessoas.
//
// O QUE MORREU AQUI (fotografado pelo dono em 26/07): "crédito (lançamento
// −1/+1 auditado)". Isso é vocabulário de contabilidade — verdadeiro no banco,
// ilegível na tela do aluno. A regra desta camada é simples: quem lê é quem tem
// aula, não quem audita o saldo.
//
// Motivo DESCONHECIDO nunca vira código na tela: cai numa frase neutra. O dia
// em que o schema ganhar um motivo novo, o aluno lê "Crédito registrado em
// 12/06" — que é pouco, mas é português.

/** Os motivos que existem hoje no schema (`ledger_reason`, migrations
 *  20260711000300 + 20260718000200). A função aceita `string` de propósito: o
 *  banco pode ganhar um motivo novo antes desta tela saber dele. */
export const MOTIVOS_CONHECIDOS = [
  'earn_cancellation',
  'initial_backlog',
  'manual_adjust',
  'refund',
  'spend_reschedule',
  'expire',
] as const

export type MotivoDeCredito = (typeof MOTIVOS_CONHECIDOS)[number]

export interface ContextoDaOrigem {
  /** o dia do crédito, já formatado pelo servidor ("12/06") */
  em: string
  /** o dia da aula que originou o crédito, quando existe ("05/06") */
  aula?: string | null
  /** o que a escola escreveu quando mexeu à mão */
  nota?: string | null
  /**
   * QUEM desmarcou a aula que gerou o crédito (`student_credit_statement`
   * .origem_autor). `null`/ausente = o banco não sabe — e aí a frase não
   * escolhe culpado.
   */
  autor?: 'student' | 'teacher' | null
}

/**
 * De onde veio este crédito, em uma frase.
 *
 * `earn_cancellation` é o caso comum. Desde a ADR-018 (18/07/2026) ele é
 * automático numa direção só — a escola desmarcou, o aluno ganhou —, e era assim
 * que esta função o traduzia: TODO `earn_cancellation` virava "porque a
 * professora precisou desmarcar".
 *
 * O QUE A REVISÃO DO P4 DERRUBOU: antes da ADR-018, cancelamento DO ALUNO com
 * aviso também creditava. Esses lançamentos continuam no ledger, e para eles a
 * frase acusava a escola de uma falha que foi decisão do aluno. Agora quem
 * decide a frase é o AUTOR que o banco leu do audit da aula — e quando não há
 * autor determinável (crédito migrado, cancelamento por caminho direto), a frase
 * conta o FATO sem nomear ninguém. Frase neutra é uma resposta; culpado
 * inventado não é.
 *
 * Os demais motivos são exceção — saldo trazido de antes do portal, ajuste feito
 * por gente, e a devolução de um crédito que tinha sido usado numa reposição que
 * não aconteceu.
 */
export function fraseDeOrigem(motivo: string, ctx: ContextoDaOrigem): string {
  const { em, aula, nota, autor } = ctx
  switch (motivo) {
    case 'earn_cancellation':
      if (autor === 'teacher')
        return aula
          ? `Você ganhou em ${em} porque a professora precisou desmarcar a aula de ${aula}.`
          : `Você ganhou em ${em} porque a professora precisou desmarcar uma aula.`
      if (autor === 'student')
        return aula
          ? `Você ganhou em ${em} quando você desmarcou a aula de ${aula} com antecedência.`
          : `Você ganhou em ${em} quando você desmarcou uma aula com antecedência.`
      return aula
        ? `Você ganhou em ${em} quando a aula de ${aula} foi desmarcada.`
        : `Você ganhou em ${em} quando uma aula foi desmarcada.`
    case 'initial_backlog':
      return `Crédito que você já tinha com a gente, trazido para o portal em ${em}.`
    case 'manual_adjust':
      return nota
        ? `A escola te deu esse crédito em ${em} — ${nota}.`
        : `A escola te deu esse crédito em ${em}.`
    case 'refund':
      return aula
        ? `Sua reposição de ${aula} não aconteceu, e o crédito voltou para você em ${em}.`
        : `O crédito voltou para você em ${em}, porque a reposição não aconteceu.`
    case 'spend_reschedule':
      return aula ? `Você usou esse crédito em ${em}, na aula de ${aula}.` : `Você usou esse crédito em ${em}.`
    case 'expire':
      return `Esse crédito venceu em ${em}.`
    default:
      return `Crédito registrado em ${em}.`
  }
}

/* -------------------------------------------------------------------------- */
/* Validade: os dois formatos (D2)                                            */
/* -------------------------------------------------------------------------- */

/* A CONTA DE DIAS NÃO MORA MAIS AQUI (revisão adversarial do P3).
 *
 * `diasAteVencer(expiresOn, hoje)` calculava a distância com um "hoje" montado
 * no fuso do ALUNO. Só que quem decide se um crédito venceu é o banco, e ele
 * decide por `business_today()` (Cuiabá) — em `makeup_balance`, no e-mail 5 e no
 * painel da admin. Duas viradas de dia diferentes é um dia por ano em que a
 * tela diz "venceu ontem" sobre um crédito que o banco ainda aceita gastar (ou
 * o contrário).
 *
 * Agora `dias_restantes` chega pronto de `student_credit_statement`, e o que
 * sobrou nesta camada é o que ela sempre soube fazer: escrever o número em
 * português. */

/** "faltam 48 dias" · "falta 1 dia" · "vence hoje" · "venceu há 3 dias". */
export function fraseDeContagem(dias: number): string {
  if (dias > 1) return `faltam ${dias} dias`
  if (dias === 1) return 'falta 1 dia'
  if (dias === 0) return 'vence hoje'
  if (dias === -1) return 'venceu ontem'
  return `venceu há ${-dias} dias`
}

/** "1 reposição" · "3 reposições" — nunca "1 crédito(s)". */
export function fraseDeSaldo(n: number): string {
  return n === 1 ? '1 reposição' : `${n} reposições`
}

/* -------------------------------------------------------------------------- */
/* O cartão COM MÉRITO do Início                                              */
/* -------------------------------------------------------------------------- */

/** Até quantos dias antes do vencimento o cartão do Início se justifica. */
export const JANELA_DO_CARTAO_DIAS = 30

/**
 * O cartão de créditos aparece? Só quando ele tem o que dizer E o que oferecer.
 *
 * Sem saldo e sem vencimento próximo, ele NÃO EXISTE — cartão que só informa é
 * ruído, e o "venceu em 12/07" sem próximo passo (a foto que o dono trouxe em
 * 26/07) é o caso extremo disso: uma má notícia sem ação. Por isso a janela é
 * de 0 a 30 dias: vencimento no passado não acende o cartão.
 */
export function mostrarCartaoDeCreditos({
  saldo,
  dias,
}: {
  saldo: number
  /** dias até o vencimento mais próximo (null = não há vencimento a olhar) */
  dias: number | null
}): boolean {
  if (saldo > 0) return true
  return dias !== null && dias >= 0 && dias <= JANELA_DO_CARTAO_DIAS
}

/** Quanto tempo um crédito vencido continua visível na tela de créditos. */
export const MEMORIA_DOS_VENCIDOS_DIAS = 60
