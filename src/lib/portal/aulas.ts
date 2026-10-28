// AS AULAS EM LINGUAGEM DE GENTE (Onda do Portal · P4).
//
// Duas famílias de frase moram aqui, e nenhuma delas DECIDE nada:
//
//   1. `estadoDaAula` — o estado de uma aula passada. O banco entrega o fato
//      (`student_class_history`: estado, quem cancelou, se o aviso veio fora do
//      prazo, se nasceu crédito); esta função escolhe as palavras. Todo estado
//      de `class_state` tem frase, e o estado que ainda não existe cai numa
//      frase neutra — o aluno nunca lê o código do banco;
//
//   2. `fraseDeRemarcarAgora` / `fraseDeCancelarAgora` — a CONSEQUÊNCIA da ação
//      explicada na tela (D4, contra o padrão Preply de esconder o controle). O
//      efeito vem classificado de `preview_reschedule_effect` /
//      `preview_cancel_effect`, que são a mesma régua de `reschedule_class_at` e
//      do miolo da matriz D2. Aqui não há `if` de regra de negócio: há `if` de
//      redação.
//
// PROIBIDO no portal (varredor de `tests/helpers/vocabulario.ts`): jargão de
// ledger, notação de dupla entrada, data em formato de máquina. Por isso as
// datas chegam JÁ FORMATADAS (o servidor formata na zona do aluno — Lei 1).

import { FALE_COM_A_GENTE_INICIAL } from '@/lib/contact'

export type TomDaAula = 'ok' | 'warn' | 'danger' | 'neutral' | 'muted'

export interface EstadoDaAula {
  frase: string
  tom: TomDaAula
}

/** O fato que o banco entrega sobre uma aula passada. */
export interface FatoDaAula {
  /** `class_state` do Postgres — string crua, nunca mostrada ao aluno */
  estado: string
  /** 'student' | 'teacher' | null (cancelamento sem registro nominal) */
  canceladoPor?: string | null
  /** o aviso veio depois do prazo mínimo do contrato? (null = não registrado) */
  foraDoAviso?: boolean | null
  /** nasceu crédito de reposição? (null = não registrado) */
  gerouCredito?: boolean | null
}

/** A cauda que conta o que aconteceu com a aula perdida — só quando o banco
 *  registrou o desfecho. Sem registro, a frase para antes de prometer. */
function caudaDeReposicao(gerouCredito: boolean | null | undefined): string {
  if (gerouCredito === true) return ' — você ganhou uma reposição'
  if (gerouCredito === false) return ' — a aula não foi reposta'
  return ''
}

export function estadoDaAula(fato: FatoDaAula): EstadoDaAula {
  const { estado, canceladoPor, foraDoAviso, gerouCredito } = fato

  if (estado === 'completed') return { frase: 'aula realizada', tom: 'ok' }

  if (estado === 'rescheduled')
    return { frase: 'remarcada — essa aula foi movida para outro horário', tom: 'muted' }

  if (estado === 'cancelled') {
    if (canceladoPor === 'teacher')
      return { frase: `a professora precisou cancelar${caudaDeReposicao(gerouCredito)}`, tom: 'warn' }
    if (canceladoPor === 'student') {
      const quando = foraDoAviso === true ? 'você cancelou em cima da hora' : 'você cancelou'
      return {
        frase: `${quando}${caudaDeReposicao(gerouCredito)}`,
        tom: foraDoAviso === true ? 'danger' : 'muted',
      }
    }
    // Cancelamento sem registro nominal (encerramento de contrato, troca de
    // horário, pausa): o banco não sabe quem foi, e a tela não inventa.
    return { frase: 'cancelada', tom: 'muted' }
  }

  if (estado === 'no_show_student')
    return { frase: 'você faltou — a aula contou como dada', tom: 'danger' }

  if (estado === 'no_show_teacher')
    return { frase: `a professora faltou${caudaDeReposicao(gerouCredito)}`, tom: 'warn' }

  // Aula que já passou e ninguém registrou ainda (a professora fecha o desfecho
  // no painel dela). É estado legítimo, não erro.
  if (estado === 'scheduled') return { frase: 'ainda sem registro', tom: 'neutral' }

  // Estado novo no schema: frase neutra, nunca o código.
  return { frase: 'aula registrada', tom: 'neutral' }
}

/* -------------------------------------------------------------------------- */
/* A consequência da AÇÃO, explicada antes de agir (D4)                       */
/* -------------------------------------------------------------------------- */

export type EfeitoDeRemarcar =
  | 'franquia'
  | 'credito'
  | 'sem_saldo'
  | 'fora_do_aviso'
  | 'contrato_inativo'
  | 'nao_remarcavel'
  | 'nao_agendada'

export interface PreviewDeRemarcacao {
  efeito: EfeitoDeRemarcar
  franquiaRestante: number
  saldoCreditos: number
  minNoticeHours: number
  /** validade do crédito que sairia, JÁ FORMATADA (null = sem prazo / não se aplica) */
  validadeFormatada: string | null
}

/* -------------------------------------------------------------------------- */
/* A RESPOSTA TEM PRAZO — e a tela diz qual (D4, revisão do P4 · E2)          */
/* -------------------------------------------------------------------------- */

/**
 * O preview é uma FOTO do agora. Quem abre a tela de confirmação faltando três
 * minutos para o aviso mínimo expirar, lê "não custa reposição", pensa um pouco
 * e confirma, recebe uma recusa correta e completamente surpreendente — a
 * classificação nasceu válida e morreu entre o render e o clique.
 *
 * O banco devolve a fronteira (`limite_ts`); estas duas funções só decidem
 * QUANDO vale a pena falar dela e COMO. Fronteira longe não vira aviso: contar
 * um prazo de 20 horas é ruído. A conta é de ÉPOCA — nenhuma data civil é
 * decidida aqui (Lei 1); a HORA que aparece na frase é formatada pela página, no
 * fuso do aluno.
 */
export const AVISO_DE_LIMITE_MS = 60 * 60 * 1000

/** A fronteira está perto o bastante para a tela avisar? */
export function limiteApertado(limiteTs: string | null | undefined, agoraMs: number): boolean {
  if (!limiteTs) return false
  const falta = Date.parse(limiteTs) - agoraMs
  return Number.isFinite(falta) && falta > 0 && falta <= AVISO_DE_LIMITE_MS
}

/** `hora` chega JÁ formatada no fuso do aluno ("19:30"). */
export function fraseDoLimite(hora: string): string {
  return `Isso vale se você confirmar até ${hora} — depois desse horário, a resposta muda.`
}

const remarcacoes = (n: number) => (n === 1 ? '1 remarcação' : `${n} remarcações`)
const reposicoes = (n: number) => (n === 1 ? '1 aula de reposição' : `${n} aulas de reposição`)
const horas = (n: number) => (n === 1 ? '1 hora' : `${n} horas`)

/** "Se eu remarcar agora, o que acontece?" — a resposta do banco, em português. */
export function fraseDeRemarcarAgora(p: PreviewDeRemarcacao): string {
  switch (p.efeito) {
    case 'franquia':
      return `Remarcando agora: está dentro do prazo de aviso e não custa reposição — você ainda tem ${remarcacoes(
        p.franquiaRestante,
      )} neste mês.`
    case 'credito':
      return `Remarcando agora: suas remarcações deste mês acabaram, então sai 1 das suas ${reposicoes(
        p.saldoCreditos,
      )}${p.validadeFormatada ? ` (a que vence primeiro, em ${p.validadeFormatada})` : ''}.`
    case 'sem_saldo':
      return `Remarcando agora: não dá — suas remarcações deste mês acabaram e você não tem aulas de reposição. ${FALE_COM_A_GENTE_INICIAL}.`
    case 'fora_do_aviso':
      return `Remarcar já não é possível por aqui: essa aula está a menos de ${horas(
        p.minNoticeHours,
      )} do começo. ${FALE_COM_A_GENTE_INICIAL}.`
    case 'contrato_inativo':
      return `Remarcar está indisponível enquanto seu plano não estiver ativo. ${FALE_COM_A_GENTE_INICIAL}.`
    case 'nao_remarcavel':
      return `Essa aula não é remarcada por aqui. ${FALE_COM_A_GENTE_INICIAL}.`
    case 'nao_agendada':
      return 'Essa aula já não está mais agendada.'
  }
}

/** A remarcação é oferecida como AÇÃO? (só quando o clique funcionaria) */
export function podeRemarcar(p: { efeito: EfeitoDeRemarcar }): boolean {
  return p.efeito === 'franquia' || p.efeito === 'credito'
}

export type EfeitoDeCancelar = 'sem_reposicao' | 'ja_comecou' | 'nao_agendada' | 'nao_cancelavel'

export interface PreviewDeCancelamento {
  efeito: EfeitoDeCancelar
  geraCredito: boolean
  minNoticeHours: number
  /** remarcar ainda é caminho? (o aviso mínimo ainda cabe) */
  dentroDoAviso: boolean
}

/** "Se eu cancelar agora, o que acontece?" */
export function fraseDeCancelarAgora(p: PreviewDeCancelamento): string {
  switch (p.efeito) {
    case 'sem_reposicao':
      if (p.geraCredito) {
        // A matriz D2 hoje não credita cancelamento do aluno (ADR-018). Se ela
        // voltar a creditar, a tela acompanha — a régua é do banco.
        return 'Cancelando agora: esta aula vira uma reposição para você marcar depois.'
      }
      return p.dentroDoAviso
        ? 'Cancelando agora: a aula não é reposta e não vira crédito. Se você só precisa mudar o horário, remarcar mantém a sua aula.'
        : `Cancelando agora: falta menos de ${horas(
            p.minNoticeHours,
          )} para a aula — ela é dada como usada e não é reposta.`
    case 'ja_comecou':
      return `Essa aula já começou — cancelar por aqui não é mais possível. ${FALE_COM_A_GENTE_INICIAL}.`
    case 'nao_agendada':
      return 'Essa aula já não está mais agendada.'
    case 'nao_cancelavel':
      return `Essa aula não é cancelada por aqui. ${FALE_COM_A_GENTE_INICIAL}.`
  }
}

/** O cancelamento é oferecido como AÇÃO? */
export function podeCancelar(p: { efeito: EfeitoDeCancelar }): boolean {
  return p.efeito === 'sem_reposicao'
}
