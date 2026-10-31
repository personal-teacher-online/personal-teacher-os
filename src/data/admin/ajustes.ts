import 'server-only'

// CAMADA DE DADOS DE /admin/ajustes (Onda da Agenda · A8).
//
// Mesmo contrato de `agenda.ts` e `home.ts`: uma função tipada por leitura de
// tela, Zod no que vem do banco, e **falha NUNCA vira estado vazio** — erro do
// PostgREST estoura e acende `src/app/admin/error.tsx`. Numa tela de ajustes
// isso importa tanto quanto na agenda: "nenhum contrato fora do padrão" e
// "não consegui ler os contratos" são respostas opostas, e a segunda não pode
// se disfarçar da primeira.
//
// ── UMA EXCEÇÃO, MEDIDA: O BLOCO DE INTEGRAÇÕES ─────────────────────────────
// (Sol · rodada 1 do A8, médio 7.) A leitura das integrações é a única desta
// tela que depende de tabelas que nada têm a ver com as outras três abas — e ela
// estourava para TODAS elas: um problema na caixa de avisos de webhook impedia a
// dona de mudar uma regra comercial. Agora a falha fica CONTIDA: `integracoes`
// é um resultado de duas caras (`{ ok: true, lista }` | `{ ok: false, motivo }`)
// e o bloco desenha o erro dele mesmo. Isso NÃO é o estado vazio disfarçado —
// "não verificado" continua significando "as chaves estão aí e nunca vi sinal",
// e falha de leitura tem cara própria, com a frase dizendo que a leitura falhou.
//
// ── POR QUE ESTA LEITURA PEDE O PAPEL ANTES ─────────────────────────────────
// O bloco de Integrações precisa de duas coisas que a sessão da dona não
// alcança por RLS: `webhook_inbox` é deny-all (nenhuma policy de leitura, por
// desenho da Lei 6) e o que se quer dela é a PROVA de que a integração está
// viva. Ler isso exige o cliente de serviço, e cliente de serviço ignora RLS —
// então a porta tem de ter porteiro próprio. `requireAdminId()` é a primeira
// linha da função: sem ele, uma professora que digitasse /admin/ajustes leria
// o movimento financeiro da escola. As demais leituras seguem pela sessão dela
// (RLS de verdade), como o resto do admin.
//
// ── O QUE ESTA CAMADA NÃO FAZ ───────────────────────────────────────────────
// Nenhuma regra de negócio (Lei 3). A faixa da antecedência, o conjunto de
// políticas de feriado e o padrão da escola são vocabulário — moram no módulo
// puro (`ajustes-gramatica.ts`) e são impostos pelo BANCO na hora de gravar.

import { DateTime } from 'luxon'
import { z } from 'zod'

import { requireAdminId } from '@/lib/auth/admin'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import { one } from '@/lib/embed'
import { tzLabel } from '@/lib/format'
import { googleOAuthConfigFromEnv } from '@/lib/google/oauth'
import { hotmartConfigFromEnv } from '@/lib/hotmart/client'
import { cloudApiConfigFromEnv } from '@/lib/notify/cloud-api'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  desviosDoContrato,
  ehPoliticaDeFeriado,
  type DesvioDoContrato,
  type PoliticaDeFeriado,
} from './ajustes-gramatica'

/** Igual ao da agenda, com o nome da seção no texto (é ele que chega ao log). */
function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Ajustes: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/* ========================================================================== */
/* Tipos da tela                                                               */
/* ========================================================================== */

export interface PoliticaDaProfessora {
  id: string
  nome: string
  /** a dona vem primeiro na lista (mesma ordem da agenda e do hub de alunos) */
  ehDona: boolean
  /** fuso operacional dela, já como cidade (Design.md: nunca IANA cru) */
  cidade: string
  antecedenciaHoras: number
  /**
   * A política de feriado quando ela está dentro do vocabulário da tela.
   * `null` = o banco guarda algo que esta tela não conhece — e aí nenhum rádio
   * nasce marcado (ver `feriadoCru` e `avisoDePoliticaDesconhecida`).
   */
  feriado: PoliticaDeFeriado | null
  /** o que está gravado, como está gravado — só usado quando `feriado` é null */
  feriadoCru: string
}

export interface ContratoForaDoPadrao {
  id: string
  /** o aluno (ou o rótulo do grupo) — DADO */
  quem: string
  plano: string
  /** em que ele foge do padrão, um item por regra */
  desvios: DesvioDoContrato[]
  /** true = contrato pausado (a regra continua valendo quando ele voltar) */
  pausado: boolean
}

/**
 * OS QUATRO ESTADOS DE UMA INTEGRAÇÃO.
 *
 * `falhando` nasceu na correção da rodada 1 (grave 2). Antes existiam três, e a
 * falha não tinha onde morar: um webhook do Asaas que chegou e não pôde ser
 * processado saía como "funcionando" (porque a régua olhava só o `received_at`)
 * ou, no melhor caso, como "não verificado" — que é a frase de quem não sabe, e
 * aqui nós sabemos: sabemos que falhou.
 */
export type SituacaoDaIntegracao = 'ligada' | 'falhando' | 'nao_verificada' | 'desligada'

export interface Integracao {
  nome: string
  /** para que ela serve, na língua da escola */
  paraQue: string
  situacao: SituacaoDaIntegracao
  /** a frase HONESTA do estado (ver o cabeçalho de `montarIntegracoes`) */
  frase: string
  /** a prova, quando existe: o último sinal de vida que o app viu */
  evidencia: string | null
  /** um problema real que o app conhece (nunca o texto cru do erro) */
  alerta: string | null
}

/** Ver o cabeçalho: a falha do bloco de integrações não derruba as outras abas. */
export type BlocoDeIntegracoes =
  | { ok: true; lista: Integracao[] }
  | { ok: false; motivo: string }

export interface DadosDosAjustes {
  professoras: PoliticaDaProfessora[]
  contratosForaDoPadrao: ContratoForaDoPadrao[]
  /** quantos contratos vivos foram conferidos (o denominador do índice) */
  contratosConferidos: number
  integracoes: BlocoDeIntegracoes
}

/* ========================================================================== */
/* Gramática do que vem do banco                                               */
/* ========================================================================== */

const ProfessoraCrua = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  is_owner: z.boolean().nullable(),
  iana_tz: z.string().nullable(),
  min_booking_lead_hours: z.coerce.number(),
  holiday_policy: z.string(),
})

const ContratoCru = z.object({
  id: z.string(),
  plan_name: z.string().nullable(),
  status: z.string(),
  monthly_reschedule_allowance: z.coerce.number().nullable(),
  min_notice_hours: z.coerce.number().nullable(),
  makeup_credit_expiry_days: z.coerce.number().nullable(),
  students: z.unknown().nullish(),
  student_groups: z.unknown().nullish(),
})

const NomeDoAluno = z.object({ display_name: z.string().nullable() })
const RotuloDoGrupo = z.object({ label: z.string().nullable() })

/* ========================================================================== */
/* Leitura                                                                     */
/* ========================================================================== */

export async function getAjustes(agora: DateTime = DateTime.now()): Promise<DadosDosAjustes> {
  // Porteiro próprio — ver o cabeçalho.
  await requireAdminId()

  const supabase = await createClient()

  const [professorasRes, contratosRes] = await Promise.all([
    supabase
      .from('teachers')
      .select('id, display_name, is_owner, iana_tz, min_booking_lead_hours, holiday_policy')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // O índice olha o contrato VIVO (ativo ou pausado). Encerrado não tem regra
    // para conferir — e listá-lo encheria a tela de história.
    supabase
      .from('contracts')
      .select(
        'id, plan_name, status, monthly_reschedule_allowance, min_notice_hours, ' +
          'makeup_credit_expiry_days, students!contracts_student_id_fkey(display_name), ' +
          'student_groups(label)',
      )
      .eq('contract_type', 'private_1on1')
      .neq('status', 'ended')
      .order('started_on', { ascending: false }),
  ])

  const professoras = z
    .array(ProfessoraCrua)
    .parse(exigir('as professoras', professorasRes))
    .map((t): PoliticaDaProfessora => ({
      id: t.id,
      nome: (t.display_name ?? '').trim() || 'Professora sem nome',
      ehDona: t.is_owner === true,
      cidade: tzLabel(t.iana_tz ?? BUSINESS_TZ),
      antecedenciaHoras: t.min_booking_lead_hours,
      // Valor fora do vocabulário não vira silêncio NEM CHUTE (baixo 10 da
      // rodada 1: a versão anterior caía em 'flag' e o próximo "Salvar" podia
      // sobrescrever a política nova do banco). Ele chega `null`, e a tela pede
      // uma escolha explícita.
      feriado: ehPoliticaDeFeriado(t.holiday_policy) ? t.holiday_policy : null,
      feriadoCru: t.holiday_policy,
    }))

  const contratosCrus = z.array(ContratoCru).parse(exigir('os contratos', contratosRes))
  const contratosForaDoPadrao: ContratoForaDoPadrao[] = []
  for (const c of contratosCrus) {
    const desvios = desviosDoContrato({
      alcada: c.monthly_reschedule_allowance,
      avisoHoras: c.min_notice_hours,
      validadeDias: c.makeup_credit_expiry_days,
    })
    if (desvios.length === 0) continue
    const aluno = NomeDoAluno.safeParse(one(c.students))
    const grupo = RotuloDoGrupo.safeParse(one(c.student_groups))
    contratosForaDoPadrao.push({
      id: c.id,
      quem:
        (aluno.success ? (aluno.data.display_name ?? '').trim() : '') ||
        (grupo.success ? (grupo.data.label ?? '').trim() : '') ||
        'Contrato sem aluno',
      plano: (c.plan_name ?? '').trim() || 'Sem nome de plano',
      desvios,
      pausado: c.status === 'paused',
    })
  }

  return {
    professoras,
    contratosForaDoPadrao,
    contratosConferidos: contratosCrus.length,
    integracoes: await lerIntegracoes(agora),
  }
}

/* ========================================================================== */
/* Integrações                                                                 */
/* ========================================================================== */

/**
 * A JANELA DE FRESCOR — por que "funcionando" tem prazo de validade.
 *
 * (Sol · rodada 1 do A8, grave 2, terceira metade.) Um webhook processado com
 * sucesso em MAIO não sustenta "funcionando" em JULHO: entre uma coisa e outra
 * cabe o token que venceu, o número que caiu, a URL que o parceiro desativou. A
 * pergunta que a pílula responde é sobre o presente, então a prova também
 * precisa ser do presente.
 *
 * SETE DIAS para Google, WhatsApp, Asaas e e-mail. É o ciclo da escola: toda
 * semana tem aula, lembrete, confirmação e vencimento de cobrança — nenhum
 * desses quatro canais fica sete dias em silêncio com a escola funcionando. Mais
 * curto (24h) daria alarme falso no feriado prolongado; mais longo esconderia
 * uma parada de vários dias.
 *
 * TRINTA DIAS para a Hotmart, e por um motivo que não vale para os outros: o
 * curso é de 12 meses e os avisos dela são de PROGRESSO (`CLUB_FIRST_ACCESS`,
 * `CLUB_MODULE_COMPLETED`). Com 6 alunos de mentoria, semanas sem nenhum módulo
 * concluído é o funcionamento normal, não defeito.
 *
 * A DATA APARECE SEMPRE, seja qual for o estado: é DADO, e é ela que permite à
 * dona discordar da nossa régua olhando o número.
 *
 * AS DUAS JANELAS FORAM **RATIFICADAS PELO DONO** em 29/07/2026 — nasceram como
 * número escolhido pelo implementador e viraram decisão de negócio de verdade.
 */
export const FRESCOR_DIAS = 7
export const FRESCOR_DIAS_HOTMART = 30

/** Quando foi, em português, ou null se nunca houve. */
function quando(iso: string | null, agora: DateTime): string | null {
  if (!iso) return null
  const dt = DateTime.fromISO(iso).setZone(BUSINESS_TZ).setLocale('pt-BR')
  if (!dt.isValid) return null
  const dias = Math.floor(agora.setZone(BUSINESS_TZ).startOf('day').diff(dt.startOf('day'), 'days').days)
  if (dias <= 0) return `hoje às ${dt.toFormat('HH:mm')}`
  if (dias === 1) return `ontem às ${dt.toFormat('HH:mm')}`
  return `em ${dt.toFormat("dd/LL 'às' HH:mm")}`
}

/** Está dentro da janela? Data ilegível conta como FORA (não afirma frescor). */
function fresco(iso: string | null, agora: DateTime, janelaDias: number): boolean {
  if (!iso) return false
  const dt = DateTime.fromISO(iso)
  if (!dt.isValid) return false
  return agora.diff(dt, 'days').days <= janelaDias
}

/** O instante em milissegundos, ou `null` quando não dá para ler. */
function instante(iso: string | null): number | null {
  if (!iso) return null
  const dt = DateTime.fromISO(iso)
  return dt.isValid ? dt.toMillis() : null
}

/** O sinal de vida de um parceiro que fala por webhook. */
interface SinalDeWebhook {
  /** o último aviso PROCESSADO COM SUCESSO (a única prova que pinta de verde) */
  okEm: string | null
  /** o último aviso que FALHOU no processamento (ou null) */
  falhaEm: string | null
}

/**
 * O ESTADO HONESTO DE CADA INTEGRAÇÃO.
 *
 * A régua, escrita para não haver tentação de pintar de verde o que ninguém
 * conferiu (pedido literal do dono no A8) — e reescrita depois da rodada 1 do
 * Sol, que derrubou a versão anterior com um cenário de dinheiro: chega um
 * pagamento do Asaas que não casa com contrato nenhum, a inbox grava `error`, e
 * a dona lê "funcionando — os avisos de cobrança estão chegando" enquanto o
 * pagamento não entrou.
 *
 *   · **funcionando** exige PROVA DE PROCESSAMENTO, não de recebimento: um
 *     aviso com `processed_at` preenchido e `error` nulo, DENTRO da janela de
 *     frescor. Aviso que chegou e não foi digerido não prova nada — o que ele
 *     trazia (um pagamento, um progresso de curso) não entrou no sistema;
 *   · **falhando** quando o app SABE que deu errado: o último aviso do parceiro
 *     falhou no processamento, ou a última sincronização do Google falhou. É um
 *     estado próprio de propósito — chamá-lo de "não verificado" seria fingir
 *     ignorância de um defeito conhecido, e de "funcionando" seria mentira;
 *   · **não verificado** quando as chaves existem e o app não tem o que
 *     afirmar: nunca houve sinal, ou o último sinal bom é velho demais. A frase
 *     DIZ isso, com todas as letras, e mostra a data. Sair chamando o parceiro
 *     para descobrir seria transformar abrir uma tela de ajustes em cinco
 *     chamadas de rede a serviços externos, cada uma com o seu tempo de espera
 *     e o seu jeito de falhar — e ainda assim só valeria para aquele segundo;
 *   · **não ligada** quando não há chave nenhuma. Não é defeito: a Hotmart, por
 *     exemplo, só entra na Fase 5, e a tela diz isso sem alarme.
 *
 * A PRECEDÊNCIA É ESTA, e ela importa: sem chave > falha conhecida > prova
 * fresca > silêncio. A falha ganha do verde — nunca mais pílula verde com "a
 * última sincronização falhou" logo abaixo, que era o par que o revisor achou.
 *
 * NENHUM SEGREDO SAI DAQUI — nem inteiro, nem pela metade, nem em forma de
 * "termina em …". O que a tela publica é booleano (existe/não existe) e data.
 * A mesma régua vale para o texto cru do erro de sincronização do Google: ele
 * vira "a última sincronização falhou", e o detalhe fica no banco.
 */
async function lerIntegracoes(agora: DateTime): Promise<BlocoDeIntegracoes> {
  try {
    return { ok: true, lista: await montarIntegracoes(agora) }
  } catch (erro) {
    // O detalhe vai para o log do servidor, não para a tela (mesma régua do
    // erro cru do Google). A dona vê que a LEITURA falhou — que é diferente de
    // "não verificado", e é o que a impede de tirar conclusão de uma tela muda.
    console.error('[ajustes] falha ao ler o estado das integrações', erro)
    return {
      ok: false,
      motivo:
        'Não consegui ler o estado das integrações agora — o que aparece abaixo seria adivinhação. ' +
        'As outras abas continuam funcionando; tente recarregar esta em alguns minutos.',
    }
  }
}

async function montarIntegracoes(agora: DateTime): Promise<Integracao[]> {
  const admin = createAdminClient()
  const supabase = await createClient()

  /**
   * O sinal de vida daquele parceiro (webhook_inbox é deny-all: serviço).
   *
   * DUAS leituras, e é o par que faz a régua funcionar: a última PROCESSADA com
   * sucesso (a prova do verde) e a última que FALHOU (o gatilho do vermelho).
   * Uma só não bastaria — "o último evento" sozinho pinta de vermelho uma
   * integração que teve um tropeço isolado e já voltou a funcionar, e "o último
   * sucesso" sozinho é justamente o que escondia a falha.
   */
  const sinalDe = async (fonte: string): Promise<SinalDeWebhook> => {
    const [okRes, falhaRes] = await Promise.all([
      admin
        .from('webhook_inbox')
        .select('received_at')
        .eq('source', fonte)
        .not('processed_at', 'is', null)
        .is('error', null)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('webhook_inbox')
        .select('received_at')
        .eq('source', fonte)
        .not('error', 'is', null)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const ok = exigir(`os avisos de ${fonte}`, okRes) as { received_at: string } | null
    const falha = exigir(`as falhas de ${fonte}`, falhaRes) as { received_at: string } | null
    return { okEm: ok?.received_at ?? null, falhaEm: falha?.received_at ?? null }
  }

  const [asaas, meta, hotmart, resend, google, emailOkRes, emailFalhaRes] = await Promise.all([
    sinalDe('asaas'),
    sinalDe('meta'),
    sinalDe('hotmart'),
    sinalDe('resend'),
    supabase.from('teacher_google_accounts').select('teacher_id, last_sync_at, last_sync_error'),
    // Prova de que o e-mail SAI: a última linha da fila entregue sem erro.
    supabase
      .from('notification_outbox')
      .select('sent_at')
      .eq('channel', 'email')
      .not('sent_at', 'is', null)
      .is('error', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // E a última que ficou PARADA com erro: e-mail que não saiu é falha, não
    // silêncio (uma cobrança que a aluna nunca recebeu).
    supabase
      .from('notification_outbox')
      .select('created_at')
      .eq('channel', 'email')
      .is('sent_at', null)
      .not('error', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const ultimoEmail =
    (exigir('a fila de e-mails', emailOkRes) as { sent_at: string } | null)?.sent_at ?? null
  const emailParado =
    (exigir('as falhas de envio de e-mail', emailFalhaRes) as { created_at: string } | null)
      ?.created_at ?? null
  const email: SinalDeWebhook = { okEm: ultimoEmail, falhaEm: emailParado }

  const contas = z
    .array(
      z.object({
        teacher_id: z.string(),
        last_sync_at: z.string().nullable(),
        last_sync_error: z.string().nullable(),
      }),
    )
    .parse(exigir('as contas do Google', google))

  const integracoes: Integracao[] = []

  /* -------------------------------------------------------------- Google -- */
  const conectadas = contas.length
  const comErro = contas.filter((g) => (g.last_sync_error ?? '').trim() !== '').length
  const ultimaSync = contas
    .map((g) => g.last_sync_at)
    .filter((v): v is string => typeof v === 'string')
    .sort()
    .at(-1) ?? null
  const syncFresca = fresco(ultimaSync, agora, FRESCOR_DIAS)
  const googleConfigurado = googleOAuthConfigFromEnv() !== null

  integracoes.push({
    nome: 'Google Agenda',
    paraQue:
      'Escreve as aulas na agenda pessoal de cada professora e lê os compromissos dela como “ocupado”.',
    situacao: !googleConfigurado
      ? 'desligada'
      : comErro > 0
        ? 'falhando'
        : syncFresca
          ? 'ligada'
          : 'nao_verificada',
    frase: !googleConfigurado
      ? 'Sem as chaves do Google neste ambiente — nenhuma agenda é sincronizada.'
      : comErro > 0
        ? `A última sincronização falhou para ${comErro === 1 ? 'uma professora' : `${comErro} professoras`} — as aulas dela podem não estar aparecendo na agenda pessoal.`
        : conectadas === 0
          ? 'As chaves estão no ambiente, mas nenhuma professora conectou a agenda ainda.'
          : syncFresca
            ? `${conectadas === 1 ? '1 professora conectou' : `${conectadas} professoras conectaram`} a agenda, e a sincronização está rodando.`
            : ultimaSync
              ? // O caso que pintava de verde antes: conta conectada, sincronização
                // velha. Conectar é um clique de um dia; sincronizar é o serviço.
                `${conectadas === 1 ? '1 professora conectou' : `${conectadas} professoras conectaram`} a agenda, mas nenhuma sincronização aconteceu nos últimos ${FRESCOR_DIAS} dias.`
              : // E o caso que o revisor achou: linha de conta criada pelo callback,
                // `last_sync_at` nulo, pílula verde. Conectou nunca é sincronizou.
                `${conectadas === 1 ? '1 professora conectou' : `${conectadas} professoras conectaram`} a agenda, mas nenhuma sincronização aconteceu ainda.`,
    evidencia: ultimaSync ? `Última sincronização ${quando(ultimaSync, agora)}.` : null,
    alerta:
      comErro > 0
        ? `Abra a ficha ${comErro === 1 ? 'dela' : 'delas'} para reconectar a agenda.`
        : null,
  })

  /* -------------------------------------------- WhatsApp (Cloud API, #43) -- */
  // ADR-038: configurado = as chaves da Cloud API no ambiente; sinal = os
  // avisos da Meta processados na inbox (origem `meta`, que nascem no webhook
  // da #44). Até o webhook entrar, o cartão diz "configurado, sem sinal ainda".
  integracoes.push(
    doWebhook({
      nome: 'WhatsApp',
      paraQue: 'Envia os lembretes e as confirmações pelo WhatsApp da escola.',
      configurado: cloudApiConfigFromEnv() !== null,
      sinal: meta,
      janelaDias: FRESCOR_DIAS,
      agora,
      semChave: 'Sem as chaves do WhatsApp neste ambiente — os avisos saem só por e-mail.',
      funcionando: 'O número da escola na Meta está conversando com o sistema.',
      nunca:
        'As chaves estão no ambiente. O app ainda não recebeu nenhum sinal da Meta sobre o número da escola — não dá para afirmar que as mensagens estão chegando.',
      velho:
        'A Meta não manda sinal sobre o número da escola há mais de {dias} dias — o envio pode ter parado sem avisar.',
      falhando:
        'O último sinal da Meta chegou e o sistema não conseguiu processá-lo. Confira na Meta se o número da escola continua ativo.',
      rotuloDoSinal: 'Último sinal processado',
      rotuloDaFalha: 'Última falha',
    }),
  )

  /* --------------------------------------------------------------- Asaas -- */
  integracoes.push(
    doWebhook({
      nome: 'Asaas',
      paraQue: 'Avisa o sistema quando uma cobrança é paga, vence ou é estornada.',
      configurado: Boolean(process.env.ASAAS_WEBHOOK_TOKEN),
      sinal: asaas,
      janelaDias: FRESCOR_DIAS,
      agora,
      semChave: 'Sem a senha de aviso do Asaas neste ambiente — nenhum pagamento entra sozinho.',
      funcionando: 'Os avisos de cobrança estão chegando e entrando no sistema.',
      nunca: 'A senha de aviso está no ambiente, mas nenhum aviso de cobrança chegou até agora.',
      velho:
        'Nenhum aviso de cobrança entrou nos últimos {dias} dias. Confira no Asaas se o aviso automático continua ligado.',
      falhando:
        'O último aviso de cobrança chegou e NÃO entrou no sistema. Um pagamento pode ter acontecido sem aparecer aqui — confira o extrato do Asaas.',
      rotuloDoSinal: 'Último aviso processado',
      rotuloDaFalha: 'Última falha',
    }),
  )

  /* -------------------------------------------------------------- Resend -- */
  const emailBase = doWebhook({
    nome: 'E-mail',
    paraQue: 'Entrega os e-mails da escola — lembretes, confirmações e o convite de acesso.',
    configurado: Boolean(process.env.RESEND_API_KEY),
    sinal: email,
    janelaDias: FRESCOR_DIAS,
    agora,
    semChave: 'Sem a chave de envio neste ambiente — nenhum e-mail sai daqui.',
    funcionando: 'Os e-mails da fila estão saindo.',
    nunca: 'A chave está no ambiente, mas nenhum e-mail da fila saiu ainda.',
    velho: 'Nenhum e-mail da fila saiu nos últimos {dias} dias.',
    falhando:
      'Há e-mail parado na fila com erro de envio — alguém pode não ter recebido o aviso que a escola mandou.',
    rotuloDoSinal: 'Último e-mail enviado',
    rotuloDaFalha: 'Última falha de envio',
  })
  integracoes.push({
    ...emailBase,
    // O retorno de entrega do Resend não pinta estado (ele não prova que a fila
    // saiu), mas é sinal de vida do parceiro e vale como DADO quando não há nada
    // melhor para mostrar.
    evidencia:
      emailBase.evidencia ??
      (resend.okEm ? `Último retorno de entrega recebido ${quando(resend.okEm, agora)}.` : null),
  })

  /* ------------------------------------------------------------- Hotmart -- */
  integracoes.push(
    doWebhook({
      nome: 'Hotmart',
      paraQue: 'Traz o progresso de cada aluno no curso, que é o que libera as mentorias.',
      configurado: hotmartConfigFromEnv() !== null,
      sinal: hotmart,
      janelaDias: FRESCOR_DIAS_HOTMART,
      agora,
      semChave:
        'Ainda não ligada neste ambiente. Até ligar, o progresso do curso é lançado à mão na ficha do aluno.',
      funcionando: 'Os avisos do curso estão chegando e entrando no sistema.',
      nunca: 'As chaves estão no ambiente, mas nenhum aviso do curso chegou até agora.',
      velho:
        'Nenhum aviso do curso entrou nos últimos {dias} dias. Com poucos alunos no curso isso pode ser normal — mas não é prova de que a ligação está de pé.',
      falhando:
        'O último aviso do curso chegou e NÃO entrou no sistema. O progresso de algum aluno pode estar desatualizado, e é o progresso que libera a mentoria.',
      rotuloDoSinal: 'Último aviso processado',
      rotuloDaFalha: 'Última falha',
    }),
  )

  return integracoes
}

/**
 * A MÁQUINA DE ESTADOS, uma só para todos os parceiros que falam por sinal.
 *
 * Uma função e não cinco blocos copiados: a régua da honestidade tem de ser a
 * MESMA em todas as linhas da tela — foi a divergência entre elas (o Google
 * olhando "existe conta", o Asaas olhando "chegou aviso") que produziu os dois
 * verdes falsos da rodada 1.
 */
function doWebhook(p: {
  nome: string
  paraQue: string
  configurado: boolean
  sinal: SinalDeWebhook
  janelaDias: number
  agora: DateTime
  semChave: string
  funcionando: string
  nunca: string
  /** `{dias}` é trocado pela janela — a frase não repete o número à mão */
  velho: string
  falhando: string
  rotuloDoSinal: string
  rotuloDaFalha: string
}): Integracao {
  const { okEm, falhaEm } = p.sinal
  // A falha só manda enquanto for a NOTÍCIA MAIS NOVA: um tropeço de terça que
  // já foi seguido de avisos processados na quarta não é o estado de hoje.
  // Comparação por INSTANTE, não por texto: as duas datas podem chegar do
  // PostgREST com fusos escritos de jeitos diferentes, e aí "maior string" não é
  // "mais recente".
  const tOk = instante(okEm)
  const tFalha = instante(falhaEm)
  const falhaEhAtual = tFalha !== null && (tOk === null || tFalha > tOk)
  const provaFresca = fresco(okEm, p.agora, p.janelaDias)

  const situacao: SituacaoDaIntegracao = !p.configurado
    ? 'desligada'
    : falhaEhAtual
      ? 'falhando'
      : provaFresca
        ? 'ligada'
        : 'nao_verificada'

  const frase = !p.configurado
    ? p.semChave
    : falhaEhAtual
      ? p.falhando
      : provaFresca
        ? p.funcionando
        : okEm
          ? p.velho.replace('{dias}', String(p.janelaDias))
          : p.nunca

  // A data do último sinal BOM aparece sempre que existe — inclusive no estado
  // de falha e no de silêncio. É ela que deixa a dona discordar da régua.
  const evidencia = okEm ? `${p.rotuloDoSinal} ${quando(okEm, p.agora)}.` : null
  const alerta = falhaEhAtual ? `${p.rotuloDaFalha} ${quando(falhaEm, p.agora)}.` : null

  return { nome: p.nome, paraQue: p.paraQue, situacao, frase, evidencia, alerta }
}
