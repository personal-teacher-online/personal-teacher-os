// TEXTOS DAS MENSAGENS PARA A REVISÃO DA DONA (Onda Agenda e Mensagens · M3-4).
//
// Gera `docs/goals/textos-revisao-2026-09.md`: uma seção por mensagem do
// catálogo de Ajustes, com o texto ATUAL de cada uma e um bloco vazio para a
// edição da dona. As edições dela viram código depois, em issue própria; este
// script só LÊ — não muda texto nenhum.
//
// ── DE ONDE SAI CADA COISA ──────────────────────────────────────────────────
// A LISTA (ordem, nome, gatilho, canais) é a do catálogo
// (`src/data/admin/ajustes-mensagens.ts`): se uma mensagem nascer lá, este
// script quebra até ganhar entrada aqui, e o documento nunca fica mais curto
// que o catálogo. O TEXTO sai das mesmas funções que o envio real usa — o
// registro do despachante (`TEMPLATES`), os e-mails de remarcação e os
// templates do serviço de acesso servidos em `public/emails/`.
//
// ── POR QUE NÃO USAR O EXEMPLO DO CATÁLOGO ──────────────────────────────────
// O catálogo renderiza com uma aluna e uma professora de exemplo, com nome. O
// documento é para revisar PALAVRAS e não pode ter nome de pessoa, então cada
// template é renderizado de novo com marcadores: o que é texto livre entra
// direto como `{nome}`; data, hora e número entram como valores-sentinela
// improváveis (ano 2031, 07:43, 9137…) e são trocados pelo marcador no texto
// pronto. Se sobrar sentinela no texto, o script para em vez de gerar um
// documento com data inventada.
//
// Lei 1: o relógio é injetado (`agora`). O "HOJE/AMANHÃ" do lembrete consulta
// o relógio do Luxon, então ele é apontado para `agora` durante a montagem e
// devolvido no fim.
//
// Uso: npm run textos:revisao

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DateTime, Settings } from 'luxon'

import { catalogoDeMensagens, CHAVES_DO_CATALOGO, textoDoHtml } from '@/data/admin/ajustes-mensagens'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { brandEmail } from '@/lib/email/brand'
import { friendlyTz, partnerEmail, studentEmail, teacherEmail, teacherMovedEmail } from '@/lib/email/reschedule'
import { TEMPLATES } from '@/lib/outbox/dispatch'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DESTINO = 'docs/goals/textos-revisao-2026-09.md'

/* ========================================================================== */
/* Sentinelas e marcadores                                                     */
/* ========================================================================== */

const FUSO = 'America/Sao_Paulo'
const AULA = DateTime.fromObject({ year: 2031, month: 6, day: 23, hour: 7, minute: 43 }, { zone: FUSO })
const NOVA = DateTime.fromObject({ year: 2031, month: 6, day: 27, hour: 16, minute: 29 }, { zone: FUSO })
const VALIDADE = '2031-09-14'

/** Os números-sentinela e o marcador de cada um. */
const NUMEROS = {
  quantidade: 9137,
  mentoria: 9241,
  totalMentorias: 9343,
  novas: 9453,
  destaque: 9559,
  rascunhos: 9661,
} as const

const MARCADOR_DE_NUMERO: Record<number, string> = {
  [NUMEROS.quantidade]: '{quantidade}',
  [NUMEROS.mentoria]: '{nº da mentoria}',
  [NUMEROS.totalMentorias]: '{total de mentorias}',
  [NUMEROS.novas]: '{trends novas}',
  [NUMEROS.destaque]: '{em destaque}',
  [NUMEROS.rascunhos]: '{rascunhos parados}',
}

const longo = (dt: DateTime) => dt.setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")

/** Do mais longo para o mais curto: a data longa contém a hora. */
const TROCAS: ReadonlyArray<[string, string]> = [
  [longo(AULA), '{dia e hora da aula}'],
  [longo(NOVA), '{novo dia e hora}'],
  [DateTime.fromISO(VALIDADE).setLocale('pt-BR').toFormat('dd/LL/yyyy'), '{data de validade}'],
  [AULA.toFormat('dd/LL'), '{data da aula}'],
  [NOVA.toFormat('dd/LL'), '{nova data}'],
  [AULA.toFormat('HH:mm'), '{hora da aula}'],
  [NOVA.toFormat('HH:mm'), '{nova hora}'],
  [friendlyTz(FUSO), 'horário de {cidade}'],
  // sem WHATSAPP_ATENDIMENTO_E164 o rodapé nem existe: nada a trocar
  ...(WHATSAPP_ATENDIMENTO_URL ? [[WHATSAPP_ATENDIMENTO_URL, '{WhatsApp de atendimento}'] as [string, string]] : []),
]

/** Ano, dia e hora de cada sentinela: se um formato de data mudar, um deles sobra. */
const RESIDUO = [
  String(AULA.year),
  ...[AULA, NOVA].flatMap((dt) => [dt.toFormat('HH:mm'), dt.setLocale('pt-BR').toFormat('cccc')]),
  ...[AULA, NOVA, DateTime.fromISO(VALIDADE)].map((dt) => dt.setLocale('pt-BR').toFormat('LLLL')),
]

/** Troca as sentinelas pelos marcadores; sentinela que sobrar é erro. */
export function marcar(texto: string): string {
  let t = texto
  for (const [de, para] of TROCAS) t = t.split(de).join(para)
  t = t.replace(/\b\d+\b/g, (n) => MARCADOR_DE_NUMERO[Number(n)] ?? n)
  const sobra = RESIDUO.find((s) => t.includes(s))
  if (sobra) throw new Error(`textos-revisao: sentinela "${sobra}" sobrou no texto — o formato da data mudou?`)
  return t
}

/* ========================================================================== */
/* Moldura do e-mail                                                           */
/* ========================================================================== */

/**
 * `textoDoHtml` do catálogo, com três ajustes de leitura: quebra de linha do
 * código-fonte vira espaço (como o e-mail mostra), parágrafo ganha linha em
 * branco e botão aparece como `[botão: …]` — senão a dona lê "Confirmar
 * presença" solto e não sabe que é um botão (link comum vira `[link: …]`, pela
 * mesma razão: reescrever a frase sem saber apagaria o link).
 */
function paraTexto(html: string): string {
  return textoDoHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/&#8202;/g, ' ')
      .replace(/<a\b[^>]*style="[^"]*background[^"]*"[^>]*>([\s\S]*?)<\/a\s*>/gi, '[botão: $1]')
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, '[link: $1]')
      .replace(/<\/(p|h1|h2|h3)>/gi, '</$1>\n'),
  )
}

const MIOLO = '§MIOLO§'
const [TOPO, RODAPE] = paraTexto(brandEmail(MIOLO)).split(MIOLO).map((s) => s.trim())

/** O corpo do e-mail em texto, sem a moldura (que aparece uma vez no topo). */
function corpoDoEmail(html: string): string {
  let t = paraTexto(html)
  if (t.startsWith(TOPO) && t.endsWith(RODAPE)) t = t.slice(TOPO.length, t.length - RODAPE.length).trim()
  return t
}

/* ========================================================================== */
/* Vocabulário do documento                                                    */
/* ========================================================================== */

export interface Versao {
  /** null quando a mensagem tem uma versão só */
  rotulo: string | null
  assunto: string | null
  corpoEmail: string | null
  corpoWhatsapp: string | null
}

export interface Secao {
  bloco: string
  nome: string
  chave: string
  canais: string[]
  gatilho: string
  destinatario: string
  situacao: string
  /** observação sobre o que o documento NÃO mostra (null quando não há) */
  nota: string | null
  versoes: Versao[]
  variaveis: string[]
}

/** Os templates do serviço de acesso (convite e senha), lidos do disco. */
export interface TextosDeAcesso {
  invite: { assunto: string; html: string }
  recovery: { assunto: string; html: string }
}

/** Os itens 6, 7 e 8 de `docs/goals/textos-novos-para-aprovacao.md`. */
const RASCUNHO = 'Rascunho de julho, ainda sem aprovação (`docs/goals/textos-novos-para-aprovacao.md`).'
/** O resto de `class-notices.ts`: o arquivo inteiro está marcado RASCUNHO. */
const RASCUNHO_SEM_DOC =
  'Rascunho (o arquivo `src/lib/email/class-notices.ts` está marcado RASCUNHO), sem registro de aprovação.'
const APROVADO_FASE2 = 'Aprovado pela dona na Fase 2 (`docs/goals/fase2-emails-rascunho.md`).'
const APROVADO_SO_EMAIL =
  'E-mail aprovado pela dona na Fase 2 (`docs/goals/fase2-emails-rascunho.md`); a versão WhatsApp foi adaptada dele depois, sem aprovação própria registrada.'
const SEM_REGISTRO = 'Sem registro de aprovação.'

/* ========================================================================== */
/* As mensagens da fila (bloco 1 do catálogo)                                  */
/* ========================================================================== */

interface VersaoDoOutbox {
  rotulo: string | null
  payload: Record<string, unknown>
}

interface EntradaDoOutbox {
  destinatario: string
  situacao: string
  versoes: (agora: DateTime) => VersaoDoOutbox[]
}

/** Fatos de uma aula no formato do `payload` que o banco enfileira. */
function aula(instante: DateTime = AULA): Record<string, unknown> {
  return {
    starts_at_utc: instante.toUTC().toISO(),
    iana_tz: FUSO,
    local_time_snapshot: instante.toFormat('HH:mm'),
    teacher_name: '{professora}',
  }
}

/** A aula no mesmo horário-sentinela, mas hoje ou amanhã (o texto diz HOJE/AMANHÃ). */
function aulaEmDias(agora: DateTime, dias: number): DateTime {
  return agora.setZone(FUSO).plus({ days: dias }).set({ hour: AULA.hour, minute: AULA.minute, second: 0, millisecond: 0 })
}

const unica = (payload: Record<string, unknown>): VersaoDoOutbox[] => [{ rotulo: null, payload }]

const DO_OUTBOX: Record<string, EntradaDoOutbox> = {
  'class-reminder': {
    destinatario: 'aluno',
    situacao: RASCUNHO,
    versoes: (agora) => {
      const toque48 = { marco: '48h', instance_id: '{id-da-aula}', magic_url: '{link que já entra logado}' }
      return [
        { rotulo: 'Toque de 48h, aula daqui a mais de um dia', payload: { ...aula(), ...toque48 } },
        { rotulo: 'Toque de 48h, aula amanhã', payload: { ...aula(aulaEmDias(agora, 1)), ...toque48 } },
        { rotulo: 'Toque de 48h, aula marcada em cima da hora (hoje)', payload: { ...aula(aulaEmDias(agora, 0)), ...toque48 } },
        {
          rotulo: 'Toque de 2h, aula hoje',
          payload: {
            ...aula(aulaEmDias(agora, 0)),
            marco: '2h',
            instance_id: '{id-da-aula}',
            meet_url: '{link da sala}',
            magic_url: '{link que já entra logado}',
          },
        },
        {
          rotulo: 'Toque de 2h, aula hoje, sem link da sala cadastrado',
          payload: {
            ...aula(aulaEmDias(agora, 0)),
            marco: '2h',
            instance_id: '{id-da-aula}',
            magic_url: '{link que já entra logado}',
          },
        },
        { rotulo: 'Formato antigo (aviso enfileirado antes dos toques de 48h e 2h)', payload: aula() },
      ]
    },
  },
  'class-cancelled': {
    destinatario: 'aluno',
    situacao: RASCUNHO_SEM_DOC,
    versoes: () => [
      { rotulo: 'Cancelamento que gera crédito', payload: { ...aula(), credited: true, expires_on: VALIDADE } },
      { rotulo: 'Cancelamento sem crédito', payload: { ...aula(), credited: false } },
    ],
  },
  'reschedule-confirm': {
    destinatario: 'aluno',
    situacao: RASCUNHO,
    versoes: () => [
      { rotulo: 'Remarcação', payload: { ...aula(), kind: 'reschedule' } },
      { rotulo: 'Aula de reposição (agendada com crédito)', payload: { ...aula(), kind: 'redeem' } },
    ],
  },
  'period-reschedule-invite': {
    destinatario: 'aluno',
    situacao: RASCUNHO_SEM_DOC,
    versoes: () => [
      { rotulo: 'Com recado da escola', payload: { ...aula(), instance_id: '{id-da-aula}', note: '{recado da escola}' } },
      { rotulo: 'Sem recado', payload: { ...aula(), instance_id: '{id-da-aula}' } },
    ],
  },
  'credit-expiry': {
    destinatario: 'aluno',
    situacao: APROVADO_SO_EMAIL,
    versoes: () => [
      { rotulo: 'Um crédito', payload: { n_credits: 1, expires_on: VALIDADE } },
      { rotulo: 'Mais de um crédito', payload: { n_credits: NUMEROS.quantidade, expires_on: VALIDADE } },
    ],
  },
  'briefing-reminder': { destinatario: 'aluno', situacao: SEM_REGISTRO, versoes: () => unica({}) },
  'briefing-update-reminder': { destinatario: 'aluno', situacao: SEM_REGISTRO, versoes: () => unica({}) },
  'mentorship-eligible': {
    destinatario: 'aluno da mentoria',
    situacao: RASCUNHO,
    versoes: () => unica({ next_window: NUMEROS.mentoria, total_credits: NUMEROS.totalMentorias }),
  },
  'meeting-reminder': {
    destinatario: 'aluno da mentoria',
    situacao: RASCUNHO_SEM_DOC,
    versoes: () =>
      unica({
        starts_at_utc: AULA.toUTC().toISO(),
        iana_tz: FUSO,
        local_time_snapshot: AULA.toFormat('HH:mm'),
        meet_url: '{link da sala}',
      }),
  },
  'meeting-cancelled': {
    destinatario: 'aluno da mentoria',
    situacao: RASCUNHO_SEM_DOC,
    versoes: () => {
      const encontro = { scheduled_at: AULA.toUTC().toISO(), iana_tz: FUSO, local_time_snapshot: AULA.toFormat('HH:mm') }
      return [
        { rotulo: 'A escola cancelou o encontro', payload: { ...encontro, self: false } },
        { rotulo: 'O aluno cancelou a própria reserva', payload: { ...encontro, self: true } },
      ]
    },
  },
  'student-whatsapp-changed': {
    destinatario: 'professora',
    situacao: SEM_REGISTRO,
    versoes: () => unica({ student_name: '{aluno}', whatsapp_e164: '{número novo}' }),
  },
  'class-cancelled-teacher': {
    destinatario: 'professora',
    situacao: SEM_REGISTRO,
    versoes: () => {
      const fatos = { student_name: '{aluno}', starts_at_utc: AULA.toUTC().toISO(), teacher_tz: FUSO }
      return [
        { rotulo: 'O aluno cancelou pelo portal', payload: { ...fatos, cancelled_by: 'student' } },
        { rotulo: 'A administração cancelou', payload: { ...fatos, cancelled_by: 'teacher' } },
      ]
    },
  },
  'teacher-class-changed': {
    destinatario: 'dona (administração)',
    situacao: SEM_REGISTRO,
    versoes: () => {
      const fatos = {
        teacher_name: '{professora}',
        student_name: '{aluno}',
        old_starts_at_utc: AULA.toUTC().toISO(),
        reason: '{motivo da professora}',
        teacher_tz: FUSO,
      }
      return [
        { rotulo: 'A professora cancelou', payload: { ...fatos, kind: 'cancelled' } },
        { rotulo: 'A professora remarcou', payload: { ...fatos, kind: 'rescheduled', new_starts_at_utc: NOVA.toUTC().toISO() } },
      ]
    },
  },
  'content-digest': {
    destinatario: 'dona (administração)',
    situacao: SEM_REGISTRO,
    versoes: () => [
      {
        rotulo: 'Com trends em destaque e rascunhos parados',
        payload: { semana: '{semana}', novas: NUMEROS.novas, destaque: NUMEROS.destaque, rascunhos: NUMEROS.rascunhos },
      },
      {
        rotulo: 'Uma trend só, em destaque, e um rascunho parado (singular)',
        payload: { semana: '{semana}', novas: 1, destaque: 1, rascunhos: 1 },
      },
      {
        rotulo: 'Sem destaque e sem rascunho parado',
        payload: { semana: '{semana}', novas: NUMEROS.novas, destaque: 0, rascunhos: 0 },
      },
    ],
  },
  'content-review': {
    destinatario: 'dona (administração)',
    situacao: SEM_REGISTRO,
    versoes: () => [
      { rotulo: 'Ideias novas', payload: { stage: 'ideias' } },
      { rotulo: 'Rascunho pronto', payload: { stage: 'rascunhos' } },
    ],
  },
}

function versoesDoOutbox(chave: string, agora: DateTime): Versao[] {
  const entrada = DO_OUTBOX[chave]
  const spec = TEMPLATES[chave]
  if (!entrada || !spec) throw new Error(`textos-revisao: mensagem do catálogo sem entrada no script: ${chave}`)
  return entrada.versoes(agora).map(({ rotulo, payload }) => {
    const email = spec.email?.(payload, '{nome}')
    const texto = spec.text?.(payload, '{nome}')
    return {
      rotulo,
      assunto: email ? marcar(email.subject) : null,
      corpoEmail: email ? marcar(corpoDoEmail(email.html)) : null,
      corpoWhatsapp: texto ? marcar(texto) : null,
    }
  })
}

/* ========================================================================== */
/* As mensagens fora da fila (blocos 2 e 3 do catálogo)                        */
/* ========================================================================== */

interface EntradaAvulsa {
  chave: string
  destinatario: string
  situacao: string
  nota?: string
  email: ((acesso: TextosDeAcesso) => { subject: string; html: string }) | null
}

const NOTA_DESCONTO =
  'A frase de `{como foi descontado}` é montada na hora do envio (`src/lib/email/notify.ts`), conforme a remarcação usou a franquia do mês ou um crédito; ela não aparece neste documento.'

const REMARCACAO = {
  firstName: '{nome}',
  studentTz: FUSO,
  oldStartsUtc: AULA.toUTC().toISO()!,
  newStartsUtc: NOVA.toUTC().toISO()!,
  teacherName: '{professora}',
  howCharged: '{como foi descontado}',
}

/** Os templates do acesso usam a sintaxe do serviço de login (`{{ .X }}`). */
function doServicoDeAcesso(t: { assunto: string; html: string }): { subject: string; html: string } {
  const html = t.html
    .replace(/\{\{\s*\.Data\.first_name\s*\}\}/g, '{nome}')
    .replace(/\{\{\s*\.(\w+)\s*\}\}/g, '{$1}')
  return { subject: t.assunto, html }
}

/** Chaveadas pelo NOME do catálogo: estas mensagens não têm chave no despachante. */
const AVULSAS: Record<string, EntradaAvulsa> = {
  'Remarcação confirmada (para quem remarcou)': {
    chave: 'reschedule.ts · studentEmail',
    destinatario: 'aluno que remarcou',
    situacao: APROVADO_FASE2,
    nota: NOTA_DESCONTO,
    email: () => studentEmail(REMARCACAO),
  },
  'Remarcação confirmada (para o outro aluno do contrato)': {
    chave: 'reschedule.ts · partnerEmail',
    destinatario: 'o outro aluno do contrato de duas pessoas',
    situacao: APROVADO_FASE2,
    nota: NOTA_DESCONTO,
    email: () => partnerEmail({ ...REMARCACAO, partnerFirstName: '{nome}', whoRescheduled: '{quem remarcou}' }),
  },
  'Remarcação confirmada (para a professora)': {
    chave: 'reschedule.ts · teacherEmail',
    destinatario: 'professora',
    situacao: APROVADO_FASE2,
    email: () =>
      teacherEmail({
        studentTz: FUSO,
        oldStartsUtc: REMARCACAO.oldStartsUtc,
        newStartsUtc: REMARCACAO.newStartsUtc,
        teacherName: '{nome}',
        studentName: '{aluno}',
        teacherTz: FUSO,
      }),
  },
  'Convite para ativar o acesso': {
    chave: 'public/emails/invite.html',
    destinatario: 'aluno convidado',
    situacao: 'Aprovado pela dona em 11/07 (comentário do próprio template).',
    email: (acesso) => doServicoDeAcesso(acesso.invite),
  },
  'Link para criar uma senha nova': {
    chave: 'public/emails/recovery.html',
    destinatario: 'quem pediu a senha nova',
    situacao: 'Rascunho, pendente de OK da dona (comentário do próprio template).',
    email: (acesso) => doServicoDeAcesso(acesso.recovery),
  },
  'Link que já entra logado': {
    chave: '—',
    destinatario: 'aluno',
    situacao: 'Não tem texto próprio: é só o endereço que vai dentro do lembrete de aula no WhatsApp.',
    email: null,
  },
}

function versaoAvulsa(nome: string, acesso: TextosDeAcesso): { entrada: EntradaAvulsa; versoes: Versao[] } {
  const entrada = AVULSAS[nome]
  if (!entrada) throw new Error(`textos-revisao: mensagem do catálogo sem entrada no script: ${nome}`)
  if (!entrada.email) return { entrada, versoes: [] }
  const email = entrada.email(acesso)
  return {
    entrada,
    versoes: [{ rotulo: null, assunto: marcar(email.subject), corpoEmail: marcar(corpoDoEmail(email.html)), corpoWhatsapp: null }],
  }
}

/* ========================================================================== */
/* Montagem                                                                    */
/* ========================================================================== */

function variaveisDe(versoes: Versao[]): string[] {
  const achadas = new Set<string>()
  for (const v of versoes) {
    for (const t of [v.assunto, v.corpoEmail, v.corpoWhatsapp]) {
      for (const m of (t ?? '').matchAll(/\{[^{}\n]+\}/g)) achadas.add(m[0])
    }
  }
  return [...achadas]
}

/** Uma seção por mensagem do catálogo, na ordem dele. */
export function montarSecoes(agora: DateTime, acesso: TextosDeAcesso): Secao[] {
  const relogio = Settings.now
  Settings.now = () => agora.toMillis()
  try {
    const blocos = catalogoDeMensagens(agora)
    // O bloco 1 é casado por posição com CHAVES_DO_CATALOGO: se o bloco ganhar
    // mensagem que não é da fila, a posição deixa de valer e o texto de uma
    // mensagem sairia com o nome de outra.
    if (blocos[0]?.mensagens.length !== CHAVES_DO_CATALOGO.length) {
      throw new Error('textos-revisao: o primeiro bloco do catálogo não é mais só o da fila')
    }
    const secoes: Secao[] = []
    blocos.forEach((bloco, i) => {
      bloco.mensagens.forEach((m, j) => {
        // O bloco 1 do catálogo é o da fila, na ordem de CHAVES_DO_CATALOGO.
        const doOutbox = i === 0
        const chave = doOutbox ? CHAVES_DO_CATALOGO[j] : null
        const { entrada, versoes } = chave
          ? { entrada: DO_OUTBOX[chave], versoes: versoesDoOutbox(chave, agora) }
          : versaoAvulsa(m.nome, acesso)
        secoes.push({
          bloco: bloco.titulo,
          nome: m.nome,
          chave: chave ?? (entrada as EntradaAvulsa).chave,
          canais: m.canais,
          gatilho: m.gatilho,
          destinatario: entrada.destinatario,
          situacao: entrada.situacao,
          nota: chave ? null : ((entrada as EntradaAvulsa).nota ?? null),
          versoes,
          variaveis: variaveisDe(versoes),
        })
      })
    })
    return secoes
  } finally {
    Settings.now = relogio
  }
}

/**
 * O que sai para alguém mas o catálogo de Ajustes não lista. Fica num bloco à
 * parte, depois das seções do catálogo, para a contagem do catálogo continuar
 * valendo; a correção de verdade é o catálogo ganhar a entrada.
 */
export function montarForaDoCatalogo(): Secao[] {
  const email = teacherMovedEmail({
    firstName: '{nome}',
    studentTz: FUSO,
    oldStartsUtc: REMARCACAO.oldStartsUtc,
    newStartsUtc: REMARCACAO.newStartsUtc,
    teacherName: '{professora}',
  })
  const versoes: Versao[] = [
    { rotulo: null, assunto: marcar(email.subject), corpoEmail: marcar(corpoDoEmail(email.html)), corpoWhatsapp: null },
  ]
  return [
    {
      bloco: FORA_DO_CATALOGO,
      nome: 'Professora remarcou a aula (aviso para o aluno)',
      chave: 'reschedule.ts · teacherMovedEmail',
      canais: ['E-mail'],
      gatilho:
        'Sai quando a professora remarca a própria aula pelo painel dela: cada aluno do contrato recebe, no fuso dele. O motivo que ela escreveu não vai para o aluno.',
      destinatario: 'aluno',
      situacao: SEM_REGISTRO,
      nota: null,
      versoes,
      variaveis: variaveisDe(versoes),
    },
  ]
}

const FORA_DO_CATALOGO = 'Fora do catálogo de Ajustes'

/**
 * Toda função de texto de `src/lib/email/` que este documento mostra. O teste
 * compara com o que os módulos exportam: função nova sem lugar aqui é vermelho.
 */
export const FUNCOES_COBERTAS: readonly string[] = [
  'briefingReminderEmail',
  'briefingReminderText',
  'briefingUpdateReminderEmail',
  'briefingUpdateReminderText',
  'classReminderEmail',
  'classReminderText',
  'rescheduleConfirmText',
  'classCancelledEmail',
  'classCancelledText',
  'periodInviteEmail',
  'periodInviteText',
  'meetingReminderEmail',
  'meetingReminderText',
  'meetingCancelledEmail',
  'meetingCancelledText',
  'mentorshipEligibleEmail',
  'mentorshipEligibleText',
  'contentDigestEmail',
  'contentDigestText',
  'contentReviewEmail',
  'contentReviewText',
  'creditExpiryEmail',
  'creditExpiryText',
  'studentWhatsappChangedEmail',
  'classCancelledTeacherEmail',
  'teacherClassChangedEmail',
  'studentEmail',
  'partnerEmail',
  'teacherEmail',
  'teacherMovedEmail',
]

function bloco(texto: string): string {
  return ['```text', texto, '```'].join('\n')
}

function secaoEmMarkdown(s: Secao, n: number): string {
  const linhas = [
    `### ${n}. ${s.nome}`,
    '',
    `- **Chave:** \`${s.chave}\``,
    `- **Canal:** ${s.canais.join(' e ')}`,
    `- **Quando dispara:** ${s.gatilho}`,
    `- **Quem recebe:** ${s.destinatario}`,
    `- **Situação do texto:** ${s.situacao}`,
    `- **Variáveis:** ${s.variaveis.length ? s.variaveis.map((v) => `\`${v}\``).join(', ') : 'nenhuma'}`,
    ...(s.nota ? [`- **Nota:** ${s.nota}`] : []),
    '',
  ]
  if (!s.versoes.length) linhas.push('_Sem texto para revisar nesta mensagem._', '')
  for (const v of s.versoes) {
    if (v.rotulo) linhas.push(`#### ${v.rotulo}`, '')
    if (v.assunto) linhas.push(`**Assunto do e-mail:** ${v.assunto}`, '')
    if (v.corpoEmail) linhas.push('**Corpo do e-mail:**', '', bloco(v.corpoEmail), '')
    if (v.corpoWhatsapp) linhas.push('**WhatsApp:**', '', bloco(v.corpoWhatsapp), '')
  }
  linhas.push('**Edição da dona:**', '', '> _(escreva aqui o texto novo, ou "ok" se está bom)_', '')
  return linhas.join('\n')
}

export function montarDocumento(agora: DateTime, acesso: TextosDeAcesso): string {
  const doCatalogo = montarSecoes(agora, acesso)
  const secoes = [...doCatalogo, ...montarForaDoCatalogo()]
  const partes = [
    '# Textos das mensagens — revisão da dona (M3-4)',
    '',
    `> Gerado por \`scripts/textos-revisao.ts\` em ${agora.setZone(FUSO).toFormat('dd/LL/yyyy')}, a partir do código.`,
    '> Não edite este arquivo à mão: ele é sobrescrito a cada geração (`npm run textos:revisao`).',
    '> As edições da dona vão nos blocos "Edição da dona" de uma cópia e viram código em issue própria.',
    '',
    '## Como ler',
    '',
    '- Entre chaves, como `{nome}`, é o que o sistema preenche na hora. Cada seção lista as suas.',
    '- No WhatsApp, o texto entre `*asteriscos*` aparece em negrito no celular.',
    '- Mensagem com mais de uma versão: o texto muda conforme o caso, e cada versão tem um título.',
    '- Todo e-mail sai dentro da mesma moldura (logo abaixo); cada seção mostra só o miolo.',
    '',
    `São ${doCatalogo.length} mensagens do catálogo de Ajustes, mais ${secoes.length - doCatalogo.length} que o catálogo ainda não lista (no fim do documento).`,
    '',
    '## Moldura de todo e-mail',
    '',
    '**Topo:**',
    '',
    bloco(TOPO),
    '',
    '**Rodapé:**',
    '',
    bloco(RODAPE),
    '',
    '**Edição da dona:**',
    '',
    '> _(escreva aqui o texto novo, ou "ok" se está bom)_',
    '',
  ]
  let blocoAtual = ''
  secoes.forEach((s, i) => {
    if (s.bloco !== blocoAtual) {
      blocoAtual = s.bloco
      partes.push(`## ${s.bloco}`, '')
    }
    partes.push(secaoEmMarkdown(s, i + 1))
  })
  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/* ========================================================================== */
/* Disco                                                                       */
/* ========================================================================== */

/** O assunto de um template do acesso, como `supabase/config.toml` o declara. */
function assuntoDoConfig(config: string, template: string): string {
  const m = config.match(new RegExp(`\\[auth\\.email\\.template\\.${template}\\]\\s*\\nsubject = "([^"]+)"`))
  if (!m) throw new Error(`textos-revisao: assunto do template ${template} não encontrado no config.toml`)
  return m[1]
}

export function lerTextosDeAcesso(raiz: string = RAIZ): TextosDeAcesso {
  const ler = (rel: string) => readFileSync(path.join(raiz, rel), 'utf8')
  const config = ler('supabase/config.toml')
  return {
    invite: { assunto: assuntoDoConfig(config, 'invite'), html: ler('public/emails/invite.html') },
    recovery: { assunto: assuntoDoConfig(config, 'recovery'), html: ler('public/emails/recovery.html') },
  }
}

function main(): void {
  const documento = montarDocumento(DateTime.now(), lerTextosDeAcesso())
  writeFileSync(path.join(RAIZ, DESTINO), documento)
  console.log(`documento gravado em ${DESTINO}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
