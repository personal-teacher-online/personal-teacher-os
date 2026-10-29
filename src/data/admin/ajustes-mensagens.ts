// CATÁLOGO DE MENSAGENS DA ESCOLA (Onda da Agenda · A8, bloco 3) — EM LEITURA.
//
// A pergunta que esta lista responde é a da dona: "o que o sistema manda para o
// meu aluno, quando, e com que palavras?". Hoje a resposta mora espalhada entre
// `src/lib/email/`, o registro do despachante e uma dúzia de funções SQL de
// enfileiramento — ou seja, não existe para quem não lê código.
//
// DECISÃO DO DONO (28/07, registrada no goal): catálogo em LEITURA, sem tabela
// nova. Mudar o texto de uma mensagem continua sendo tarefa de código. Por isso
// aqui não há CRUD nenhum: o que existe é uma projeção legível do que já sai.
//
// ── A REGRA QUE IMPEDE ESTA TELA DE MENTIR ──────────────────────────────────
// O catálogo NÃO tem cópia de texto. Ele renderiza pelo MESMO registro que o
// despachante usa (`TEMPLATES`, de `src/lib/outbox/dispatch.ts`) e pelas MESMAS
// funções puras de `src/lib/email/`. Se um texto mudar lá, muda aqui na mesma
// hora; se nascer um template novo sem entrada neste arquivo, o teste do A8
// fica vermelho (varredura de chaves) em vez de a tela ficar caladamente
// incompleta.
//
// ── O WHATSAPP VEM DOS TEMPLATES DA META (issue #41, ADR-038) ───────────────
// Com a Cloud API, o que sai pelo WhatsApp é o corpo APROVADO na Meta, não o
// texto livre do código. Então o corpo de WhatsApp das nove famílias com
// template vem de `src/lib/notify/whatsapp-templates.ts` (a mesma fonte do JSON
// de submissão), renderizado com os exemplos que vão para a Meta, com o nome do
// template ao lado. As três chaves sem template continuam mostrando o texto do
// código, com o rótulo `SEM_TEMPLATE_NA_META`.
//
// ── POR QUE O CORPO APARECE COMO TEXTO, E NÃO COMO O HTML DO E-MAIL ─────────
// Duas razões, nesta ordem: (1) injetar HTML de outro módulo numa tela do admin
// pediria `dangerouslySetInnerHTML`, e a casa não tem um único uso disso — a
// exceção nasceria aqui, num lugar que não precisa dela; (2) o que a dona quer
// conferir é a PALAVRA, não a tabela de 560px do e-mail. Então o HTML passa por
// `textoDoHtml` e vira o texto que o aluno lê. O desenho do e-mail continua
// sendo assunto de `src/lib/email/`.
//
// ── LEI 1 ───────────────────────────────────────────────────────────────────
// Nenhuma data de exemplo é escrita à mão nem congelada num literal: os
// instantes saem de `agora` (injetado — a página passa o relógio, o teste passa
// um instante fixo) e quem formata é a própria função da mensagem, no fuso do
// destinatário, como no envio real.

import { DateTime } from 'luxon'

import {
  partnerEmail,
  studentEmail,
  teacherEmail,
} from '@/lib/email/reschedule'
import {
  CHAVES_SEM_TEMPLATE_NA_META,
  renderizarTemplate,
  templatesDaChave,
} from '@/lib/notify/whatsapp-templates'
import { TEMPLATES } from '@/lib/outbox/dispatch'

/* ========================================================================== */
/* HTML → texto                                                                */
/* ========================================================================== */

const ENTIDADES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#8202;': '',
}

/**
 * O corpo do e-mail como a pessoa LÊ. Função pura, deliberadamente pequena:
 * ela serve HTML que NÓS escrevemos (moldura da marca + parágrafos), não HTML
 * arbitrário da internet.
 *
 * O que ela preserva: a quebra de linha onde havia bloco (`</p>`, `<br>`,
 * `</h2>`, `</ul>`) e o marcador de lista (`<li>` vira "• "). O resto das tags
 * some, as entidades da casa voltam a ser caractere, e três linhas em branco
 * viram uma — a moldura da marca tem muita tabela vazia entre um parágrafo e
 * outro.
 */
export function textoDoHtml(html: string): string {
  let t = html
  // <style>/<script> não existem nos nossos e-mails, mas se um dia entrarem o
  // conteúdo deles não é texto para ninguém ler.
  t = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
  t = t.replace(/<li[^>]*>/gi, '\n• ')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/(p|h1|h2|h3|div|ul|ol|li|tr|table)>/gi, '\n')
  t = t.replace(/<[^>]+>/g, '')
  for (const [entidade, letra] of Object.entries(ENTIDADES)) {
    t = t.split(entidade).join(letra)
  }
  t = t.replace(/[ \t]+/g, ' ')
  t = t.replace(/ *\n */g, '\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

/* ========================================================================== */
/* Vocabulário do catálogo                                                     */
/* ========================================================================== */

export type CanalDaMensagem = 'E-mail' | 'WhatsApp'

/** O rótulo das três chaves de WhatsApp que não vão à Meta (ADR-038). */
export const SEM_TEMPLATE_NA_META = 'sem template na Meta (sai só por e-mail)'

/** Um corpo de WhatsApp: um por template da Meta (ou o texto do código, sem template). */
export interface VersaoDoWhatsapp {
  /** o caso, quando a mensagem tem mais de um template; null quando é um só */
  rotulo: string | null
  /** nome do template na Meta; null quando a mensagem não tem template */
  nomeNaMeta: string | null
  corpo: string
}

export interface MensagemRenderizada {
  /** nome humano — o único nome que a tela mostra (Design.md: nada de chaves) */
  nome: string
  /** o que faz a mensagem sair, em português da escola */
  gatilho: string
  /** por onde ela sai (derivado do registro real, não escrito à mão) */
  canais: CanalDaMensagem[]
  /** assunto do e-mail; null quando a mensagem só existe no WhatsApp */
  assunto: string | null
  /** corpo do e-mail, já em texto */
  corpoEmail: string | null
  /** os corpos de WhatsApp (vazio quando a mensagem não sai por WhatsApp) */
  whatsapp: VersaoDoWhatsapp[]
  /** a mensagem tem texto de WhatsApp, mas não template na Meta */
  semTemplateNaMeta: boolean
}

export interface BlocoDeMensagens {
  titulo: string
  explicacao: string
  mensagens: MensagemRenderizada[]
}

/** Uma linha do catálogo do OUTBOX: o nome humano, o gatilho e o exemplo. */
interface EntradaDoOutbox {
  /** a chave do registro do despachante — usada só para casar, nunca exibida */
  chave: string
  nome: string
  gatilho: string
  /** os fatos de exemplo, no formato do `payload` que o banco enfileira */
  exemplo: (agora: DateTime) => Record<string, unknown>
  /**
   * QUEM RECEBE o exemplo — o aluno, salvo nos avisos INTERNOS (S6 da varredura
   * final da onda da Agenda).
   *
   * O corpo de todo template começa cumprimentando o destinatário pelo primeiro
   * nome, e o despachante o resolve a partir de `recipient_profile_id`. O
   * catálogo passava a ALUNA para todos, e nas duas entradas internas a prévia
   * saía absurda — «Oi, Marina! Marina atualizou o WhatsApp no portal» —, o que
   * é pior do que feio: a tela existe para a dona conferir PARA QUEM cada
   * mensagem vai, e a prévia dizia que o aviso interno vai para a aluna.
   */
  recebe?: string
}

/** O aluno de exemplo do catálogo (nome curto, fuso do negócio). */
const ALUNA = 'Marina'
const FUSO_DO_ALUNO = 'America/Cuiaba'
const PROFESSORA = 'Vicky'

/** Um instante de exemplo: daqui a `dias` dias, às 09:00 do fuso do aluno. */
function exemploDeInstante(agora: DateTime, dias: number): string {
  return agora
    .setZone(FUSO_DO_ALUNO)
    .plus({ days: dias })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toISO()!
}

/** A data civil de exemplo (para validade de crédito). */
function exemploDeData(agora: DateTime, dias: number): string {
  return agora.setZone(FUSO_DO_ALUNO).plus({ days: dias }).toISODate()!
}

/** Fatos comuns de toda mensagem sobre UMA aula. */
function fatosDaAula(agora: DateTime, dias = 2): Record<string, unknown> {
  return {
    starts_at_utc: exemploDeInstante(agora, dias),
    iana_tz: FUSO_DO_ALUNO,
    local_time_snapshot: '09:00',
    teacher_name: PROFESSORA,
  }
}

/**
 * AS MENSAGENS DA FILA, com o gatilho que cada uma tem no banco.
 *
 * Os gatilhos foram lidos nas funções de enfileiramento (`enqueue_*`) e nas
 * actions que as chamam — não são suposição. Quando duas funções enfileiram o
 * mesmo template (o lembrete nasceu na F6 e ganhou irmãs na F11 e na Leva 1), o
 * gatilho descreve a REGRA, que é a mesma nas três.
 */
const DO_OUTBOX: readonly EntradaDoOutbox[] = [
  {
    chave: 'class-reminder',
    nome: 'Lembrete de aula',
    gatilho:
      'Sai sozinho antes de cada aula marcada: um toque com 48h (com o link da aula) e outro com 2h (com o link da sala).',
    exemplo: (agora) => ({
      ...fatosDaAula(agora),
      marco: '48h',
      instance_id: '00000000-0000-0000-0000-0000000000aa',
      meet_url: 'https://meet.google.com/exemplo',
    }),
  },
  {
    chave: 'class-cancelled',
    nome: 'Aula cancelada',
    gatilho:
      'Sai quando uma aula é cancelada — pelo aluno no portal ou pela escola na agenda. O texto muda conforme o cancelamento gerou crédito ou não.',
    exemplo: (agora) => ({
      ...fatosDaAula(agora),
      credited: true,
      expires_on: exemploDeData(agora, 90),
    }),
  },
  {
    chave: 'reschedule-confirm',
    nome: 'Confirmação de remarcação (WhatsApp)',
    gatilho:
      'Sai logo depois de o aluno remarcar ou resgatar uma aula pelo portal. O e-mail dessa mesma remarcação sai na hora, e está no bloco de baixo.',
    exemplo: (agora) => ({ ...fatosDaAula(agora), kind: 'reschedule' }),
  },
  {
    chave: 'period-reschedule-invite',
    nome: 'Convite para remarcar (férias e feriados)',
    gatilho:
      'Sai quando a escola trata um período inteiro escolhendo "convidar a remarcar": a aula continua de pé e o aluno recebe o convite.',
    exemplo: (agora) => ({
      ...fatosDaAula(agora, 6),
      instance_id: '00000000-0000-0000-0000-0000000000bb',
      note: 'Vou estar viajando nesta semana.',
    }),
  },
  {
    chave: 'credit-expiry',
    nome: 'Crédito de reposição vencendo',
    gatilho:
      'Sai sozinho quando um crédito de reposição chega a 30 e a 15 dias do vencimento. Crédito que vence antes do envio não vira mensagem.',
    exemplo: (agora) => ({ n_credits: 2, expires_on: exemploDeData(agora, 30) }),
  },
  {
    chave: 'briefing-reminder',
    nome: 'Lembrete do briefing',
    gatilho: 'A escola dispara pela ficha do aluno, quando o briefing inicial ainda não foi respondido.',
    exemplo: () => ({}),
  },
  {
    chave: 'briefing-update-reminder',
    nome: 'Lembrete de atualização do briefing',
    gatilho:
      'A escola dispara pela ficha do aluno na virada de semestre, para ele revisar o que mudou nos objetivos.',
    exemplo: () => ({}),
  },
  {
    chave: 'mentorship-eligible',
    nome: 'Mentoria liberada',
    gatilho:
      'Sai sozinho quando o progresso no curso libera uma nova mentoria em grupo para o aluno reservar.',
    exemplo: () => ({ next_window: 2, total_credits: 6 }),
  },
  {
    chave: 'meeting-reminder',
    nome: 'Lembrete de encontro de mentoria',
    gatilho: 'Sai sozinho 24h antes de um encontro de mentoria que o aluno reservou.',
    exemplo: (agora) => ({
      starts_at_utc: exemploDeInstante(agora, 1),
      iana_tz: FUSO_DO_ALUNO,
      local_time_snapshot: '09:00',
      meet_url: 'https://meet.google.com/exemplo',
    }),
  },
  {
    chave: 'meeting-cancelled',
    nome: 'Encontro de mentoria cancelado',
    gatilho:
      'Sai quando um encontro de mentoria é cancelado — pelo aluno ou pela escola. O crédito já volta para ele antes da mensagem.',
    exemplo: (agora) => ({
      scheduled_at: exemploDeInstante(agora, 3),
      iana_tz: FUSO_DO_ALUNO,
      local_time_snapshot: '09:00',
      self: false,
    }),
  },
  {
    chave: 'student-whatsapp-changed',
    nome: 'WhatsApp do aluno mudou (aviso para a professora)',
    gatilho:
      'Aviso INTERNO, para a professora: sai quando o aluno troca o próprio número de WhatsApp no portal. Cada número novo avisa uma vez por professora, pelos contratos ativos dele — reenviar o mesmo número no mesmo dia não repete o aviso. O aluno nunca recebe.',
    // Quem recebe é a PROFESSORA (ver `recebe` na interface).
    recebe: PROFESSORA,
    exemplo: () => ({
      student_id: '00000000-0000-0000-0000-0000000000cc',
      student_name: ALUNA,
      whatsapp_e164: '+5565900090009',
    }),
  },
  {
    chave: 'class-cancelled-teacher',
    nome: 'Aula cancelada (aviso para a professora)',
    gatilho:
      'Aviso INTERNO, para a professora: sai quando uma aula dela é cancelada por outra pessoa — o aluno pelo portal ou a administração. Quando ela mesma cancela, não recebe.',
    recebe: PROFESSORA,
    exemplo: (agora) => ({
      student_name: ALUNA,
      starts_at_utc: exemploDeInstante(agora, 2),
      teacher_tz: FUSO_DO_ALUNO,
      cancelled_by: 'student',
      via: 'self',
    }),
  },
  {
    chave: 'teacher-class-changed',
    nome: 'Professora cancelou ou remarcou uma aula (aviso para a administração)',
    gatilho:
      'Aviso INTERNO, para a administração: sai quando a professora cancela ou remarca a própria aula pelo painel dela, com o motivo que ela escreveu. Quem fez a mudança não recebe.',
    recebe: PROFESSORA,
    exemplo: (agora) => ({
      kind: 'rescheduled',
      teacher_name: 'Renata',
      student_name: ALUNA,
      old_starts_at_utc: exemploDeInstante(agora, 2),
      new_starts_at_utc: exemploDeInstante(agora, 4),
      reason: 'consulta médica no horário',
      teacher_tz: 'America/Sao_Paulo',
    }),
  },
  {
    chave: 'content-digest',
    nome: 'Trends novas da varredura (aviso interno)',
    gatilho:
      'Aviso INTERNO, para a escola: sai UMA vez por varredura (semana), quando a pesquisa fecha a corrida — com quantas trends chegaram, quantas são de viagem e quantos rascunhos ficaram parados. O aluno nunca recebe.',
    recebe: PROFESSORA,
    exemplo: () => ({ semana: '2026-W32', novas: 6, destaque: 2, rascunhos: 3 }),
  },
  {
    chave: 'content-review',
    nome: 'Conteúdo esperando revisão (aviso interno)',
    gatilho:
      'Aviso INTERNO, para a escola: sai quando um rascunho de post fica pronto e para esperando a sua revisão (uma vez por dia). O aluno nunca recebe.',
    // A outra entrada interna: quem recebe é a casa, não a aluna.
    recebe: PROFESSORA,
    exemplo: () => ({ stage: 'rascunhos' }),
  },
]

/** As chaves que o catálogo conhece — o teste do A8 as compara com o registro. */
export const CHAVES_DO_CATALOGO: readonly string[] = DO_OUTBOX.map((m) => m.chave)

/* ========================================================================== */
/* Renderização                                                                */
/* ========================================================================== */

function doOutbox(entrada: EntradaDoOutbox, agora: DateTime): MensagemRenderizada {
  const spec = TEMPLATES[entrada.chave]
  // Chave sem registro NÃO vira linha muda na tela: o catálogo é uma promessa
  // ("é isto que sai"), e uma linha sem corpo seria a promessa quebrada em
  // silêncio. O teste do A8 prende as duas listas uma na outra; aqui embaixo
  // fica a rede para o caso de alguém apagar um template sem rodar o teste.
  if (!spec) {
    throw new Error(`Catálogo de mensagens: template desconhecido no despachante: ${entrada.chave}`)
  }
  const payload = entrada.exemplo(agora)
  // S6: o destinatário do EXEMPLO é o da mensagem — a aluna por padrão, a casa
  // nos avisos internos (ver `recebe`).
  const destinatario = entrada.recebe ?? ALUNA
  const email = spec.email?.(payload, destinatario)
  const texto = spec.text?.(payload, destinatario)
  const canais: CanalDaMensagem[] = []
  if (email) canais.push('E-mail')
  if (texto) canais.push('WhatsApp')
  return {
    nome: entrada.nome,
    gatilho: entrada.gatilho,
    canais,
    assunto: email?.subject ?? null,
    corpoEmail: email ? textoDoHtml(email.html) : null,
    whatsapp: texto ? versoesDoWhatsapp(entrada.chave, texto) : [],
    semTemplateNaMeta: Boolean(texto) && CHAVES_SEM_TEMPLATE_NA_META.includes(entrada.chave),
  }
}

/**
 * O WhatsApp de uma chave como a dona deve conferir: o corpo de cada template
 * da Meta, com os exemplos da submissão. Sem template, o texto do código. Uma
 * chave com texto de WhatsApp que não está em nenhuma das duas listas é o
 * buraco que o teste de cobertura (`tests/whatsapp-templates.test.ts`) prende;
 * aqui ela quebra a tela em vez de mostrar um texto que a Meta não aprovou.
 */
function versoesDoWhatsapp(chave: string, textoDoCodigo: string): VersaoDoWhatsapp[] {
  if (CHAVES_SEM_TEMPLATE_NA_META.includes(chave)) {
    return [{ rotulo: null, nomeNaMeta: null, corpo: textoDoCodigo }]
  }
  const templates = templatesDaChave(chave)
  if (!templates.length) {
    throw new Error(`Catálogo de mensagens: WhatsApp sem template na Meta: ${chave}`)
  }
  return templates.map((t) => ({
    rotulo: templates.length > 1 ? t.rotulo : null,
    nomeNaMeta: t.nome,
    corpo: renderizarTemplate(t),
  }))
}

/**
 * O catálogo inteiro, em três blocos. Recebe o relógio (Lei 1: quem chama diz
 * que horas são; esta função não consulta o mundo).
 */
export function catalogoDeMensagens(agora: DateTime): BlocoDeMensagens[] {
  const antes = exemploDeInstante(agora, 1)
  const depois = exemploDeInstante(agora, 4)
  const fatosDaRemarcacao = {
    firstName: ALUNA,
    studentTz: FUSO_DO_ALUNO,
    oldStartsUtc: antes,
    newStartsUtc: depois,
    teacherName: PROFESSORA,
    howCharged: 'da sua franquia mensal (restam 3)',
  }

  return [
    {
      titulo: 'Avisos automáticos',
      explicacao:
        'Entram numa fila e saem sozinhos, na hora certa. Entre 21h e 8h no horário do aluno a fila segura o WhatsApp e envia na manhã seguinte.',
      mensagens: DO_OUTBOX.map((m) => doOutbox(m, agora)),
    },
    {
      titulo: 'Enviados na hora da remarcação',
      explicacao:
        'Saem no mesmo instante em que a aula é remarcada pelo portal, sem passar pela fila. São três, porque cada pessoa envolvida precisa saber de uma coisa diferente.',
      mensagens: [
        {
          nome: 'Remarcação confirmada (para quem remarcou)',
          gatilho: 'Sai no instante em que o aluno confirma a remarcação no portal.',
          canais: ['E-mail'],
          assunto: studentEmail(fatosDaRemarcacao).subject,
          corpoEmail: textoDoHtml(studentEmail(fatosDaRemarcacao).html),
          whatsapp: [],
          semTemplateNaMeta: false,
        },
        {
          nome: 'Remarcação confirmada (para o outro aluno do contrato)',
          gatilho:
            'Sai junto da anterior quando o contrato é de duas pessoas: quem não remarcou também precisa saber que o horário mudou.',
          canais: ['E-mail'],
          assunto: partnerEmail({
            ...fatosDaRemarcacao,
            partnerFirstName: 'Rafael',
            whoRescheduled: ALUNA,
          }).subject,
          corpoEmail: textoDoHtml(
            partnerEmail({
              ...fatosDaRemarcacao,
              partnerFirstName: 'Rafael',
              whoRescheduled: ALUNA,
            }).html,
          ),
          whatsapp: [],
          semTemplateNaMeta: false,
        },
        {
          nome: 'Remarcação confirmada (para a professora)',
          gatilho:
            'Sai junto das anteriores, no horário DELA: é o registro da mudança para quem vai dar a aula.',
          canais: ['E-mail'],
          assunto: teacherEmail({
            studentTz: FUSO_DO_ALUNO,
            oldStartsUtc: antes,
            newStartsUtc: depois,
            teacherName: PROFESSORA,
            studentName: ALUNA,
            teacherTz: FUSO_DO_ALUNO,
          }).subject,
          corpoEmail: textoDoHtml(
            teacherEmail({
              studentTz: FUSO_DO_ALUNO,
              oldStartsUtc: antes,
              newStartsUtc: depois,
              teacherName: PROFESSORA,
              studentName: ALUNA,
              teacherTz: FUSO_DO_ALUNO,
            }).html,
          ),
          whatsapp: [],
          semTemplateNaMeta: false,
        },
      ],
    },
    {
      titulo: 'Convite e senha',
      explicacao:
        'Estes três saem do serviço de acesso, junto com o próprio botão de ativar ou redefinir. O texto deles é configurado no servidor, não neste aplicativo — por isso aparece aqui o que eles são, e não o corpo da mensagem.',
      mensagens: [
        {
          nome: 'Convite para ativar o acesso',
          gatilho: 'Sai quando a escola convida um aluno pela ficha dele (e no reenvio do convite).',
          canais: ['E-mail'],
          assunto: null,
          corpoEmail: null,
          whatsapp: [],
          semTemplateNaMeta: false,
        },
        {
          nome: 'Link para criar uma senha nova',
          gatilho: 'Sai quando alguém pede "esqueci minha senha" na tela de entrada.',
          canais: ['E-mail'],
          assunto: null,
          corpoEmail: null,
          whatsapp: [],
          semTemplateNaMeta: false,
        },
        {
          nome: 'Link que já entra logado',
          gatilho:
            'Vai dentro do lembrete de aula no WhatsApp: é o endereço de uso único que abre o portal sem pedir senha.',
          canais: ['E-mail'],
          assunto: null,
          corpoEmail: null,
          whatsapp: [],
          semTemplateNaMeta: false,
        },
      ],
    },
  ]
}
