// GRAMÁTICA DO WIZARD DE CONTRATO (Onda 1 · M4-3) — os três ramos, as etapas de
// cada um, o endereço da tela e o CONTRATO do que o cliente manda para o
// servidor.
//
// Módulo PURO de propósito, como `contratos-gramatica.ts`: quem fala com o banco
// é `contrato-novo-consulta.ts` (server-only, cliente injetado); isto aqui é a
// parte que se prova sem banco nenhum — e é a única que o componente CLIENTE do
// wizard pode importar.
//
// Zero regra de negócio (Lei 3). O que `NovoContratoSchema` faz NÃO é validar o
// contrato: é conferir a FORMA do que chegou do navegador antes de virar
// chamada de RPC (entrada de fora nunca é confiável). Quem recusa horário
// conflitante, fuso não confirmado, âncora forasteira e franquia fora da faixa
// continua sendo o Postgres — e as mensagens que a tela mostra são as dele.

import { z } from 'zod'

import type { JanelaOcupada } from '@/lib/agenda/ocupacao'
import type { Situacao } from './alunos-grupos'

/* ========================================================================== */
/* 1. Os três ramos (a etapa 1: radios-de-consequência)                        */
/* ========================================================================== */

export const RAMOS_DO_CONTRATO = ['individual', 'grupo', 'mentoria'] as const
export type RamoDeContrato = (typeof RAMOS_DO_CONTRATO)[number]

export function ehRamoDeContrato(v: string | undefined | null): v is RamoDeContrato {
  return !!v && (RAMOS_DO_CONTRATO as readonly string[]).includes(v)
}

export const RAMO_ROTULO: Record<RamoDeContrato, string> = {
  individual: 'Individual',
  grupo: 'Casal ou turma',
  mentoria: 'Mentoria',
}

/**
 * UMA frase de consequência por opção — a régua dos radios do TutorBird
 * (mapeamento 2.0, 3ª passada): a escolha diz o que ACONTECE, não só o que é.
 */
export const RAMO_CONSEQUENCIA: Record<RamoDeContrato, string> = {
  individual:
    'Uma pessoa, uma professora e horários fixos no relógio dela. É o contrato da maioria dos alunos.',
  grupo:
    'Duas pessoas ou mais dividem o mesmo contrato e a mesma aula. Você escolhe de quem é o relógio que rege os horários.',
  mentoria:
    'O Personal Travel: sem horário fixo semanal — as sessões são datas que a escola publica e o aluno reserva.',
}

/* ========================================================================== */
/* 2. As etapas                                                                */
/* ========================================================================== */

/** Os seis passos do contrato particular, na ordem da spec do M4. */
export const ETAPAS_DO_CONTRATO = [
  'Tipo',
  'Aluno',
  'Horários',
  'Valores',
  'Política',
  'Revisão',
] as const

/**
 * A mentoria não tem horário fixo semanal nem franquia de remarcação — as duas
 * colunas ficam NULL no banco (`contracts_private_fields` só as exige no
 * particular). Perguntar isso ali seria pedir um dado que não vai a lugar
 * nenhum, então o ramo curto pula os dois passos: tipo → aluno → valores →
 * revisão (é o desenho aprovado no plano do M4-3).
 */
export function temEtapaDeHorarios(ramo: RamoDeContrato): boolean {
  return ramo !== 'mentoria'
}

export function temEtapaDePolitica(ramo: RamoDeContrato): boolean {
  return ramo !== 'mentoria'
}

/** Os rótulos do stepper para este ramo. */
export function etapasDoRamo(ramo: RamoDeContrato): string[] {
  return ETAPAS_DO_CONTRATO.filter(
    (e) =>
      (e !== 'Horários' || temEtapaDeHorarios(ramo)) &&
      (e !== 'Política' || temEtapaDePolitica(ramo)),
  )
}

/** O endereço da tela, com o tipo pré-escolhido quando alguém já sabe qual é. */
export function enderecoDoNovoContrato(tipo?: RamoDeContrato | null): string {
  return tipo ? `/admin/contratos/novo?tipo=${tipo}` : '/admin/contratos/novo'
}

/* ========================================================================== */
/* 3. O que a tela recebe do servidor                                          */
/* ========================================================================== */

/** Um aluno no seletor da etapa 2. */
export interface AlunoDoSeletor {
  id: string
  nome: string
  /** situação DERIVADA (a mesma pílula do hub) — é ela que agrupa a lista */
  situacao: Situacao
  situacaoRotulo: string
  /** zona IANA da ficha: é o relógio dos horários fixos (ou o palpite herdado) */
  iana: string
  /** rótulo humano do fuso, JÁ formatado no servidor (Lei 1) */
  fuso: string
  cidade: string
  pais: string
  /** `false` = o fuso é palpite; contrato e horário fixo são recusados pelo banco */
  fusoConfirmado: boolean
  /** já entrou no portal (tem login)? é o que decide se a conclusão oferece o convite */
  temAcesso: boolean
}

export interface ContextoDoNovoContrato {
  alunos: AlunoDoSeletor[]
  professoras: { id: string; nome: string }[]
  /** os nomes de plano que a escola já usa (plano fase 1) */
  planos: string[]
  /**
   * A agenda ocupada das professoras, POR ZONA IANA.
   *
   * A comparação de conflito acontece em minutos dentro de UM relógio, e o
   * relógio é o do aluno escolhido — que só se sabe na etapa 2, no cliente.
   * Como a conversão é Lei 1 (offset do dia específico, no servidor), a leitura
   * é feita uma vez por FUSO DISTINTO dos alunos elegíveis (na escola real são
   * dois ou três: Cuiabá, Lisboa, Orlando) e o cliente escolhe o balde certo.
   */
  ocupacaoPorFuso: Record<string, JanelaOcupada[]>
  /** data civil do negócio, para o início da vigência nascer em "hoje" */
  hojeIso: string
}

/** Os alunos agrupados por situação, na ordem do funil (o Select da etapa 2). */
export function alunosPorSituacao(
  alunos: AlunoDoSeletor[],
  ordem: readonly Situacao[],
): { situacao: Situacao; rotulo: string; alunos: AlunoDoSeletor[] }[] {
  return ordem
    .map((s) => ({
      situacao: s,
      rotulo: alunos.find((a) => a.situacao === s)?.situacaoRotulo ?? s,
      alunos: alunos.filter((a) => a.situacao === s),
    }))
    .filter((g) => g.alunos.length > 0)
}

/* ========================================================================== */
/* 4. O payload (o que o cliente manda para a action)                          */
/* ========================================================================== */

/** uuid de qualquer variante — é identidade que vem do próprio servidor. */
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const HorarioDoWizardSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration_min: z.number().int().min(15).max(480),
})
export type HorarioDoWizard = z.infer<typeof HorarioDoWizardSchema>

/** Quantos horários fixos o wizard cria de uma vez (a tela oferece dois). */
export const MAX_HORARIOS = 2

/**
 * Quanto cabe no nome do plano (c14 · Sol 7.1).
 *
 * A REGRA é o CHECK `contracts_plan_name_len` (migration 20260727001400) — ela
 * vale para toda porta, inclusive a que não existe ainda. Este número é o que
 * as telas passam ao `CampoComTeto` (`teto={TETO_DO_PLANO}`) e o que as actions
 * usam para ANTECIPAR a recusa com uma frase em português; sem ele, o POST
 * montado à mão levaria de volta um `violates check constraint
 * "contracts_plan_name_len"`, que é verdade e não é resposta (Lei 3: a UI
 * antecipa o erro do banco, nunca o substitui).
 *
 * r7 nº 6 — este parágrafo dizia `maxLength={80}`, e não é mais assim desde o
 * c16 (r6 nº 12): `maxLength` conta unidades UTF-16 e COME a tecla em silêncio.
 * As telas usam `CampoComTeto` (`components/kit/campo-com-teto.tsx`), que mede
 * code points e AVISA em vez de truncar.
 *
 * A contagem é de CARACTERES, como a do Postgres (`char_length`) — daí o
 * `[...texto].length` nos chamadores E no Zod deste arquivo (c15 · Sol 13), e
 * não `.length`, que conta unidades UTF-16 e recusaria antes da hora um nome
 * com emoji.
 */
export const TETO_DO_PLANO = 80

export const NovoContratoSchema = z
  .object({
    ramo: z.enum(RAMOS_DO_CONTRATO),
    alunos: z.array(UUID).min(1),
    /** grupo: de quem é o relógio que rege os horários fixos (P1) */
    ancora: UUID.nullable(),
    rotuloDoGrupo: z.string(),
    professora: UUID.nullable(),
    /**
     * c14 · Sol 7.1: o teto de 80 que a tela antecipa (o `CampoComTeto`, desde o
     * c16 — r7 nº 6) passa a ser conferido também aqui e — o que de fato importa
     * — no banco (CHECK `contracts_plan_name_len`, migration 20260727001400).
     * Três lugares porque são três públicos: o campo avisa quem digita, o Zod
     * recusa o payload montado à mão antes de virar RPC, e o CHECK é a regra
     * (Lei 3).
     */
    /*
     * c15 · Sol 13 — A CONTAGEM É DE CODE POINTS, como a do Postgres.
     *
     * `.max(80)` do Zod mede `String.length`, que conta unidades UTF-16: um
     * emoji fora do BMP vale 2, um par surrogate vale 2, e um nome de plano com
     * 80 caracteres desses era recusado AQUI enquanto o `char_length` do banco
     * (que conta caracteres) o aceitava sem piscar. Régua da tela mais apertada
     * que a do banco é o pior dos dois mundos: a pessoa vê "não cabe" para uma
     * coisa que cabe, e o teto real continua sem prova.
     *
     * `[...s].length` itera por code point — é a mesma conta que `char_length`
     * faz, e a mesma que as actions já usavam.
     */
    plano: z
      .string()
      .trim()
      .min(1, 'o contrato precisa de um plano')
      .refine(
        (s) => [...s].length <= TETO_DO_PLANO,
        `o nome do plano cabe em ${TETO_DO_PLANO} caracteres`,
      ),
    /** Lei 9: dinheiro em CENTAVOS, sempre inteiro */
    valorCentavos: z.number().int('o valor da aula precisa ser um número').min(0, 'informe o valor da aula'),
    remarcacoes: z.number().int().min(0).max(10, 'a franquia de remarcações vai de 0 a 10'),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'informe a data de início da vigência'),
    horarios: z.array(HorarioDoWizardSchema).max(MAX_HORARIOS),
  })
  .superRefine((v, ctx) => {
    const erro = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })

    const distintos = new Set(v.alunos)
    if (distintos.size !== v.alunos.length) erro('alunos', 'aluno repetido na lista')

    if (v.ramo === 'grupo') {
      if (v.alunos.length < 2) erro('alunos', 'casal ou turma precisa de pelo menos duas pessoas')
      if (!v.rotuloDoGrupo.trim()) erro('rotuloDoGrupo', 'a turma precisa de um nome')
      if (!v.ancora || !v.alunos.includes(v.ancora))
        erro('ancora', 'escolha de quem é o relógio que rege os horários')
    } else if (v.alunos.length !== 1) {
      erro('alunos', 'este tipo de contrato é de uma pessoa só')
    }

    if (v.ramo === 'mentoria') {
      if (v.horarios.length > 0) erro('horarios', 'mentoria não tem horário fixo semanal')
    } else if (!v.professora) {
      erro('professora', 'escolha a professora')
    }
  })

export type NovoContrato = z.infer<typeof NovoContratoSchema>

/** O que a action devolve quando o contrato nasce. */
export interface ContratoCriado {
  contratoId: string
  /** quem o gatilho tirou de lead/arquivado e pôs em ativo, com o nome */
  promovidos: { id: string; nome: string; de: string }[]
  /** quantos horários fixos nasceram junto */
  horarios: number
  /** o aluno da ficha (individual/mentoria); `null` no grupo */
  alunoId: string | null
  ramo: RamoDeContrato
}
