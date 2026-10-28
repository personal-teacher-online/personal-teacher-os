// GRAMÁTICA DA FICHA DO ALUNO (Onda 1 · M3-2) — o que o banco promete para a
// ficha (Zod), quais são as abas e para qual delas cada painel antigo aponta.
//
// Módulo PURO, como `alunos-grupos.ts` é para o hub: `ficha.ts` é `server-only`
// (fala com o banco e com o relógio) e isto aqui é a parte que se prova sem
// banco — e que o teste importa direto.
//
// Nada aqui decide regra de negócio (Lei 3): saldo, expiração e situação de
// contrato chegam prontos das funções do Postgres. O que este arquivo faz é
// nomear: aba, painel, endereço.

import { z } from 'zod'

import { ContratoDoDiretorioSchema, NIVEIS } from './alunos-grupos'

/* ========================================================================== */
/* 1. Contrato do diretório, na versão da FICHA                                */
/* ========================================================================== */

/**
 * A ficha lê o MESMO `admin_student_directory()` do hub, mas usa quatro campos
 * que a lista descarta: a política de remarcação (que ela mostra por extenso) e
 * a data de início. Por isso o schema ESTENDE o do hub em vez de duplicá-lo —
 * uma mudança de forma do jsonb estoura nos dois lugares de uma vez.
 */
export const ContratoDaFichaSchema = ContratoDoDiretorioSchema.extend({
  monthly_reschedule_allowance: z.coerce.number().nullish(),
  min_notice_hours: z.coerce.number().nullish(),
  makeup_credit_expiry_days: z.coerce.number().nullish(),
  started_on: z.string().nullish(),
})

/**
 * Os campos do cadastro que NÃO vêm no jsonb de `admin_student_directory` —
 * são lidos direto de `students` (M3-c5 · D1). Zod aqui, e não `as`: campo novo
 * que o banco parar de devolver estoura na leitura, não pinta "—" na ficha.
 *
 * `student_type` é NOT NULL no banco com default; o `.catch` existe só para o
 * caso de alguém acrescentar um terceiro tipo lá e esquecer da tela — aí a
 * ficha diz "adulto" em vez de quebrar a página inteira da dona.
 */
export const ExtrasDoAlunoSchema = z.object({
  student_type: z.enum(['child', 'adult']).catch('adult'),
  birth_date: z.string().nullish(),
  referral_source: z.string().nullish(),
  auth_cleanup_profile_id: z.string().nullish(),
  /**
   * P6 da revisão nº 8 — o fuso desta ficha é FATO ou palpite do cadastro
   * mínimo? `.catch(true)` porque a coluna nasceu com default `true` e um
   * payload de deploy em voo não pode acender alarme falso na ficha inteira.
   */
  tz_confirmed: z.boolean().catch(true),
})

export type ExtrasDoAluno = z.infer<typeof ExtrasDoAlunoSchema>

/** Como a tela chama cada tipo (o banco fala inglês; a dona, não). */
export const TIPO_DE_ALUNO: Record<'child' | 'adult', string> = {
  child: 'criança',
  adult: 'adulto',
}

/** A frase curta que acompanha cada opção no wizard — o "por que perguntamos". */
export const TIPO_DE_ALUNO_APOIO: Record<'child' | 'adult', string> = {
  child: 'quem fala com a escola é o responsável',
  adult: 'o próprio aluno responde por ele',
}

export const TIPO_PADRAO: 'child' | 'adult' = 'adult'

/** O que a action aceita gravar em `students.student_type` (espelha o CHECK). */
export function tipoDeAlunoValido(v: string): v is 'child' | 'adult' {
  return v === 'child' || v === 'adult'
}

export const AlunoDaFichaSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  iana_tz: z.string(),
  status: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  level: z.string().nullable(),
  profile_id: z.string().nullable(),
  whatsapp_e164: z.string().nullable(),
  whatsapp_channel_ack_at: z.string().nullable(),
  email_bounced_at: z.string().nullable(),
  invited_at: z.string().nullable(),
  email: z.string().nullable(),
  email_confirmed: z.boolean().nullable(),
  last_sign_in_at: z.string().nullable(),
  contracts: z.array(ContratoDaFichaSchema),
})

export const FichaDiretorioSchema = z.array(AlunoDaFichaSchema)

export type AlunoDaFicha = z.infer<typeof AlunoDaFichaSchema>
export type ContratoDaFicha = z.infer<typeof ContratoDaFichaSchema>

/* ========================================================================== */
/* 2. Abas                                                                     */
/* ========================================================================== */

export const ABAS = ['visao', 'contrato', 'creditos', 'briefing', 'historico'] as const
export type Aba = (typeof ABAS)[number]

export const ABA_PADRAO: Aba = 'visao'

export const ABA_ROTULO: Record<Aba, string> = {
  visao: 'Visão geral',
  contrato: 'Contrato & horários',
  creditos: 'Créditos',
  briefing: 'Briefing & plano',
  historico: 'Histórico',
}

export function ehAba(v: string | undefined): v is Aba {
  return !!v && (ABAS as readonly string[]).includes(v)
}

/* ========================================================================== */
/* 3. Painéis (os `?painel=` que a ficha velha já respondia)                    */
/* ========================================================================== */

/**
 * Os painéis da ficha velha continuam VALENDO como endereço: são links salvos,
 * e o hub novo aponta para `?painel=convidar` desde o M3-1. O que muda é que
 * agora cada um sabe em que ABA o assunto dele mora — abrir o painel abre a aba
 * certa por baixo, senão o painel fecha e a pessoa cai numa tela que não fala
 * do que ela estava fazendo.
 *
 * DOIS painéis são novos como ENDEREÇO, nenhum é mutação nova:
 * · `estender` — a extensão de validade de crédito existia na home velha
 *   (`extendCreditAction`) e ficou órfã quando o Início foi reconstruído. Ela
 *   volta aqui, na aba do assunto dela;
 * · `cancelar` — o cancelamento de aula existia na ficha dentro de um
 *   `<details data-popup>` com `<select>` nativo, os dois proibidos em tela
 *   nova. Mesma action (`cancelClassAction`), moldura do kit.
 *
 * E um é MUTAÇÃO nova, a única desta rodada:
 * · `nota` — a nota interna da equipe (M3-c5 · D1), que passa pela RPC
 *   `admin_set_student_note`.
 */
export const PAINEIS = [
  'editar',
  'whatsapp',
  'convidar',
  'pagador',
  'anonimizar',
  'briefing',
  'estender',
  'cancelar',
  'nota',
  // Ciclo de vida, fase 1: a saída do funil sem contrato (`admin_lose_lead`).
  'perder',
  // Briefing v2 (28/07): correção pós-envio, com motivo e trilha
  // (`admin_revise_briefing`). É o irmão de `briefing`, que só existe ANTES do
  // envio — depois dele, editar em silêncio deixaria de ser auditável.
  'briefing-correcao',
] as const
export type Painel = (typeof PAINEIS)[number]

export function ehPainel(v: string | undefined): v is Painel {
  return !!v && (PAINEIS as readonly string[]).includes(v)
}

/**
 * Em que aba cada painel mora. É o mapa de deep-link: `?painel=convidar` sem
 * `?aba=` abre a ficha JÁ na Visão geral, com o painel por cima.
 */
const ABA_DO_PAINEL: Record<Painel, Aba> = {
  editar: 'visao',
  whatsapp: 'visao',
  convidar: 'visao',
  anonimizar: 'visao',
  nota: 'visao',
  // O lead vive inteiro na Visão geral (não tem contrato, crédito nem plano).
  perder: 'visao',
  // Pagador é dinheiro: mora com valores e cobranças, não com identidade.
  pagador: 'contrato',
  briefing: 'briefing',
  'briefing-correcao': 'briefing',
  estender: 'creditos',
  cancelar: 'historico',
}

export function abaDoPainel(painel: string | undefined): Aba | null {
  return ehPainel(painel) ? ABA_DO_PAINEL[painel] : null
}

/**
 * Qual aba desenhar: o `?aba=` explícito manda; sem ele, quem manda é o painel
 * aberto; sem nenhum dos dois, a Visão geral.
 */
export function abaAtiva(aba: string | undefined, painel: string | undefined): Aba {
  if (ehAba(aba)) return aba
  return abaDoPainel(painel) ?? ABA_PADRAO
}

/* ========================================================================== */
/* 4. Endereços                                                                */
/* ========================================================================== */

/** O endereço da ficha com aba (e, opcionalmente, painel) — sem `?aba=visao`
 *  pendurado à toa: a aba padrão é o endereço limpo. */
export function enderecoDaFicha(
  id: string,
  opcoes: { aba?: Aba; painel?: Painel; alvo?: string | number } = {},
): string {
  const q = new URLSearchParams()
  if (opcoes.aba && opcoes.aba !== ABA_PADRAO) q.set('aba', opcoes.aba)
  if (opcoes.painel) q.set('painel', opcoes.painel)
  if (opcoes.alvo != null) q.set('alvo', String(opcoes.alvo))
  const s = q.toString()
  return s ? `/admin/alunos/${id}?${s}` : `/admin/alunos/${id}`
}

/* ========================================================================== */
/* 5. Vocabulário de tela                                                      */
/* ========================================================================== */

/**
 * Os níveis que o formulário de cadastro oferece — os MESMOS onze da trilha
 * Flexge que o banco aceita (`students_level_check`) e que a lista, os grupos e
 * a Fábrica de conteúdo desenham.
 *
 * Era uma lista própria de SEIS, e a divergência ficou anotada aqui no M3-2:
 * as actions de cadastro só aceitavam seis e jogavam fora, em silêncio,
 * qualquer outro valor — então oferecer "A1+" num seletor que gravava `null`
 * seria perda de dado sem aviso. O M3-3 (anexo A1) fechou a divergência pela
 * FONTE: quem decide é `nivelValido`, em `alunos-grupos.ts`, e as três actions
 * de cadastro passaram a consultá-la. Aqui só sobra o alias, para o formulário
 * continuar tendo um nome com a voz da tela.
 */
export const NIVEIS_DO_CADASTRO = NIVEIS

/**
 * O Select do kit (Radix) proíbe item de valor vazio, e "ainda não avaliado"
 * precisa de um valor. Este sentinela NÃO passa por `nivelValido` — que é
 * justamente o efeito desejado: qualquer coisa fora dos onze vira `null`.
 */
export const SEM_NIVEL_NO_FORM = 'nenhum'

/** Situação do CONTRATO (a do cadastro do aluno tem vocabulário próprio). */
export const SITUACAO_DO_CONTRATO: Record<string, string> = {
  active: 'ativo',
  paused: 'pausado',
  ended: 'encerrado',
}

/*
 * O vocabulário do CADASTRO (`students.status` cru: ativo / pausado / saiu da
 * escola / arquivado) morava aqui e MORREU na fase 1 do ciclo de vida
 * (27/07/2026): a ficha e a lista passaram a falar a situação DERIVADA
 * (`SITUACAO_ROTULO` + `situacaoDoAluno`, em `alunos-grupos.ts`), que é a
 * mesma palavra nas duas telas. Manter os dois mapas era garantir que um dia a
 * ficha diria "ativo" para quem a lista chama de "experimental".
 */
