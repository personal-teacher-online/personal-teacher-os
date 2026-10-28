// GRAMÁTICA DA TELA DE AJUSTES (Onda da Agenda · A8) — o módulo PURO.
//
// Aqui mora o vocabulário da seção: os quatro blocos e seus endereços, a faixa
// da antecedência mínima, as duas políticas de feriado com a consequência
// escrita, o padrão da escola contra o qual um contrato é "fora do padrão" e as
// frases que traduzem número em português.
//
// Por que separado da camada de dados: este arquivo não importa `server-only`
// nem o cliente do Supabase, então o formulário (que precisa da chave do
// rascunho) e o teste (que precisa das faixas) o leem sem arrastar o servidor
// junto. Mesma divisão de `agenda-endereco.ts` × `agenda.ts` no A1.

import { POLICY } from '@/lib/policy'

/* ========================================================================== */
/* Os quatro blocos                                                            */
/* ========================================================================== */

export const BLOCOS = ['politica', 'janelas', 'mensagens', 'integracoes'] as const
export type BlocoDosAjustes = (typeof BLOCOS)[number]

export const BLOCO_ROTULO: Record<BlocoDosAjustes, string> = {
  politica: 'Política de remarcação',
  janelas: 'Janelas',
  mensagens: 'Mensagens',
  integracoes: 'Integrações',
}

/** O bloco de abertura: é o único dos quatro que se EDITA. */
export const BLOCO_PADRAO: BlocoDosAjustes = 'politica'

export function ehBloco(v: string | undefined | null): v is BlocoDosAjustes {
  return typeof v === 'string' && (BLOCOS as readonly string[]).includes(v)
}

/** O endereço do bloco. O padrão não escreve na URL (régua do Design.md). */
export function enderecoDoBloco(bloco: BlocoDosAjustes): string {
  return bloco === BLOCO_PADRAO ? '/admin/ajustes' : `/admin/ajustes?bloco=${bloco}`
}

/* ========================================================================== */
/* Antecedência mínima de reserva                                              */
/* ========================================================================== */

/**
 * A FAIXA. Os mesmos dois números que `admin_set_teacher_policy` valida dentro
 * do banco (migration 20260729000100, `v_piso`/`v_teto`) — a tela é antecipação
 * da recusa, nunca a regra (Lei 3). O teste do A8 lê o corpo da migration para
 * cobrar a igualdade dos dois lados.
 *
 * 📌 `ANTECEDENCIA_MAX` É LIMITE COMERCIAL PROVISÓRIO, AGUARDANDO RATIFICAÇÃO
 * DO DONO (Sol · rodada 1 do A8, grave 4). Não há consequência técnica que
 * produza 168: o horizonte de reserva do portal é de 14 dias, então 192h ainda
 * deixaria horários elegíveis entre o 8º e o 14º dia. O número existe para que
 * "10000" digitado sem querer não vire regra, e vive NUM LUGAR SÓ de cada lado
 * (aqui e em `v_teto`): trocar a política é trocar uma linha, e a decisão de
 * verdade vira ADR.
 */
export const ANTECEDENCIA_MIN = 0
export const ANTECEDENCIA_MAX = 168

/** De quanto em quanto o [−]/[+] anda: meio dia de aula, não uma hora. */
export const ANTECEDENCIA_PASSO = 1

/**
 * CAMPO VAZIO NÃO É ZERO (Sol · rodada 1 do A8, médio 5).
 *
 * `Number('')` é `0`, e zero aqui é uma escolha válida e perigosa — ela DESLIGA
 * a antecedência mínima. A dona que apaga o campo no celular para redigitar, é
 * interrompida e salva não pode publicar "dá para marcar até a hora de começar"
 * sem ter pedido isso. Vazio é ESTADO VAZIO: esta é a frase que ocupa o lugar da
 * consequência enquanto não há número, e ela não afirma nada sobre a regra.
 */
export const ANTECEDENCIA_VAZIA = `Informe a antecedência mínima — de ${ANTECEDENCIA_MIN} a ${ANTECEDENCIA_MAX} horas.`

/**
 * A FRASE DA FAIXA ESTOURADA (Sol · rodada 1 do A8, médio 6).
 *
 * Digitar 169 impedia o envio, pintava a borda de vermelho e não dizia NADA —
 * nem na tela, nem para o leitor de tela (`aria-invalid` sem `aria-describedby`,
 * porque o stepper não estava dentro de um `data-slot="campo"`). A dona conclui
 * que "Salvar" está quebrado. Esta é a frase que o campo passa a mostrar, e ela
 * é a mesma que o banco diria — só que em português da casa e antes do envio.
 */
export const ANTECEDENCIA_FORA_DA_FAIXA = `A antecedência mínima vai de ${ANTECEDENCIA_MIN} a ${ANTECEDENCIA_MAX} horas (${ANTECEDENCIA_MAX / 24} dias). Use um número inteiro dentro dessa faixa.`

/**
 * A antecedência em português. Zero NÃO é "0 horas": é a ausência da regra, e
 * escrever o número ali faria a dona ler um limite onde não há nenhum.
 *
 * `null` (campo vazio) devolve a frase do estado vazio — nunca a de zero.
 */
export function fraseDaAntecedencia(horas: number | null): string {
  if (horas === null || !Number.isFinite(horas)) return ANTECEDENCIA_VAZIA
  if (horas <= 0) return 'Sem antecedência mínima — dá para marcar até a hora de começar.'
  if (horas === 1) return 'Precisa marcar com pelo menos 1 hora de antecedência.'
  if (horas % 24 === 0) {
    const dias = horas / 24
    return dias === 1
      ? 'Precisa marcar com pelo menos 24 horas (1 dia) de antecedência.'
      : `Precisa marcar com pelo menos ${horas} horas (${dias} dias) de antecedência.`
  }
  return `Precisa marcar com pelo menos ${horas} horas de antecedência.`
}

/* ========================================================================== */
/* Política de feriado                                                         */
/* ========================================================================== */

export const POLITICAS_DE_FERIADO = [
  {
    valor: 'flag',
    rotulo: 'Só avisar',
    consequencia:
      'O feriado aparece marcado na agenda e a aula continua de pé. Você decide caso a caso.',
  },
  {
    valor: 'cancel_credit',
    rotulo: 'Cancelar e devolver o crédito',
    consequencia:
      'As aulas do feriado são canceladas e cada aluno ganha um crédito de reposição para remarcar.',
  },
] as const

export type PoliticaDeFeriado = (typeof POLITICAS_DE_FERIADO)[number]['valor']

export function ehPoliticaDeFeriado(v: string | undefined | null): v is PoliticaDeFeriado {
  return v === 'flag' || v === 'cancel_credit'
}

export function rotuloDaPoliticaDeFeriado(v: string): string {
  return POLITICAS_DE_FERIADO.find((p) => p.valor === v)?.rotulo ?? 'Não definida'
}

/**
 * POLÍTICA DESCONHECIDA NÃO VIRA CHUTE (Sol · rodada 1 do A8, baixo 10).
 *
 * A primeira versão fazia `ehPoliticaDeFeriado(v) ? v : 'flag'` — dizendo, no
 * comentário ao lado, que valor fora do vocabulário "não vira silêncio nem
 * chute". Virava as duas coisas: a tela mostrava "Só avisar" marcado, e o
 * próximo "Salvar política" (feito para mudar SÓ a antecedência) gravava `flag`
 * por cima da política nova que o banco tivesse ganhado.
 *
 * Agora o desconhecido chega à tela COMO É (`null` na escolha + o valor cru ao
 * lado): nenhum rádio nasce marcado, o cartão explica o que está gravado, e o
 * `required` dos rádios impede o envio até a dona escolher. Trocar a política
 * passa a exigir um ato dela — que é o que "explícito" quer dizer.
 */
/* ========================================================================== */
/* A recusa do banco em português da casa                                      */
/* ========================================================================== */

/**
 * O ERRO CRU DO POSTGRES NÃO CHEGA À DONA (Sol · rodada 1 do A8, grave 3).
 *
 * A action repassava `error.message` do PostgREST para o recado — e, enquanto o
 * recado viajava na URL, aquilo ia parar no histórico do navegador e no log de
 * acesso. Mesmo agora que o transporte é cookie, o texto continua sendo errado
 * para quem lê: "permission denied for column min_booking_lead_hours of relation
 * teachers" não diz à dona o que ela deve fazer.
 *
 * A tradução mora AQUI, no módulo puro, e não na action, por dois motivos:
 *   · é vocabulário, e vocabulário desta tela mora neste arquivo;
 *   · assim ela é testada frase a frase, sem montar FormData nem fingir Supabase.
 *
 * O CASAMENTO É POR TRECHO ESTÁVEL do `raise exception` da migration
 * 20260729000100 — não pelo texto inteiro, que muda quando alguém melhora a
 * pontuação. O teste do A8 confere cada trecho contra o corpo REAL da migration:
 * mudou a frase do banco sem mudar esta tabela, o teste fica vermelho.
 *
 * O DEFAULT NÃO ADIVINHA: qualquer coisa fora da lista vira uma frase que diz o
 * que a dona precisa saber — não deu, e nada mudou (a RPC é uma transação só).
 */
const RECUSAS_DO_BANCO: ReadonlyArray<readonly [RegExp, string]> = [
  [/fora da faixa/i, `Falha: ${ANTECEDENCIA_FORA_DA_FAIXA}`],
  [/informe a antecedência mínima/i, 'Falha: informe a antecedência mínima em horas.'],
  [
    /política de feriado inválida/i,
    'Falha: escolha o que fazer com as aulas em feriado (só avisar ou cancelar e devolver o crédito).',
  ],
  [
    /professora não encontrada/i,
    'Falha: essa professora não está mais cadastrada — recarregue a página.',
  ],
  [/professora não informada/i, 'Falha: professora não identificada — recarregue a página.'],
  [
    /decisão da admin|ator obrigatório/i,
    'Falha: só a administração muda a política de uma professora. Entre de novo na sua conta e tente outra vez.',
  ],
  [
    // O selo de coluna desta mesma migration: se um dia alguém tentar gravar por
    // fora da RPC, é esta a cara da recusa.
    /permission denied|permissão negada/i,
    'Falha: esta conta não tem permissão para mudar a política da professora. Nada foi alterado.',
  ],
]

export const RECUSA_DESCONHECIDA =
  'Falha: não consegui salvar a política agora. Nada foi alterado — tente de novo em alguns instantes.'

/** Todas as frases que esta tela pode dizer quando o banco recusa (para teste). */
export const FRASES_DE_RECUSA: readonly string[] = [
  ...RECUSAS_DO_BANCO.map(([, frase]) => frase),
  RECUSA_DESCONHECIDA,
]

export function fraseDaRecusaDoBanco(cru: string | null | undefined): string {
  const texto = (cru ?? '').trim()
  for (const [marca, frase] of RECUSAS_DO_BANCO) if (marca.test(texto)) return frase
  return RECUSA_DESCONHECIDA
}

export function avisoDePoliticaDesconhecida(cru: string): string {
  const valor = cru.trim() === '' ? 'em branco' : `«${cru.trim()}»`
  return (
    `A política gravada para esta professora é ${valor}, que esta tela ainda não conhece — ` +
    'ela continua valendo como está. Para trocá-la, escolha uma das duas opções abaixo; ' +
    'enquanto nenhuma for escolhida, o formulário não salva.'
  )
}

/* ========================================================================== */
/* O padrão da escola (para o índice de contratos fora dele)                   */
/* ========================================================================== */

/**
 * ALÇADA PADRÃO — quantas remarcações por mês um contrato novo nasce podendo.
 *
 * Ela NÃO mora em `src/lib/policy.ts` de propósito: aquele arquivo guarda os
 * três números que valem para TODO contrato e só mudam por ADR, e a alçada é
 * negociação individual (está escrito lá, no cabeçalho). O que ela é, então, é
 * o VALOR DE REFERÊNCIA: o número com que o banco preenche um contrato quando
 * ninguém diz outra coisa (`coalesce(p_allowance, 4)` em `admin_create_contract`,
 * migration 20260727001100). É contra ele que este índice chama um contrato de
 * "fora do padrão" — e o teste do A8 lê a migration para provar que os dois
 * ainda dizem 4.
 */
export const ALCADA_PADRAO = 4

/** O padrão completo, na ordem em que a tela o mostra. */
export const PADRAO_DA_ESCOLA = {
  alcada: ALCADA_PADRAO,
  avisoHoras: POLICY.minNotice,
  validadeDias: POLICY.expiryDays,
} as const

export interface DesvioDoContrato {
  rotulo: string
  /** o que o contrato diz — DADO */
  valor: string
  /** o que a escola pratica */
  padrao: string
}

export interface RegrasDoContrato {
  alcada: number | null
  avisoHoras: number | null
  validadeDias: number | null
}

function emHoras(n: number): string {
  return n === 1 ? '1 hora' : `${n} horas`
}
function emDias(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`
}
function emVezes(n: number): string {
  return n === 1 ? '1 por mês' : `${n} por mês`
}

/**
 * Em que este contrato foge do padrão da escola. Lista vazia = está no padrão.
 *
 * `null` (campo nunca preenchido — acontece em contrato de mentoria, onde os
 * três são NULL por desenho) NÃO é desvio: é ausência, e chamar ausência de
 * desvio encheria o índice de linhas que ninguém pode consertar.
 */
export function desviosDoContrato(regras: RegrasDoContrato): DesvioDoContrato[] {
  const fora: DesvioDoContrato[] = []
  if (regras.alcada !== null && regras.alcada !== PADRAO_DA_ESCOLA.alcada) {
    fora.push({
      rotulo: 'Remarcações por mês',
      valor: emVezes(regras.alcada),
      padrao: emVezes(PADRAO_DA_ESCOLA.alcada),
    })
  }
  if (regras.avisoHoras !== null && regras.avisoHoras !== PADRAO_DA_ESCOLA.avisoHoras) {
    fora.push({
      rotulo: 'Aviso mínimo para remarcar',
      valor: emHoras(regras.avisoHoras),
      padrao: emHoras(PADRAO_DA_ESCOLA.avisoHoras),
    })
  }
  if (regras.validadeDias !== null && regras.validadeDias !== PADRAO_DA_ESCOLA.validadeDias) {
    fora.push({
      rotulo: 'Validade do crédito',
      valor: emDias(regras.validadeDias),
      padrao: emDias(PADRAO_DA_ESCOLA.validadeDias),
    })
  }
  return fora
}

/* ========================================================================== */
/* Rascunho do formulário de política                                          */
/* ========================================================================== */

/**
 * A identidade do formulário de política DAQUELA professora.
 *
 * Chave por professora, e não uma só para a tela inteira: são N formulários
 * abertos na mesma página, e o rascunho de um erro na política da dona não
 * pode nascer preenchido no formulário da professora (é o mesmo defeito que o
 * `chaveDoBalao` fecha na agenda — Sol · rodada 1 do A4, grave 4).
 */
export function chaveDaPolitica(teacherId: string): string {
  return `ajustes-politica:${teacherId}`
}
