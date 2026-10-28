import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'
import {
  classCancelledEmail,
  classCancelledText,
  classReminderEmail,
  classReminderText,
  meetingCancelledEmail,
  meetingCancelledText,
  meetingReminderEmail,
  meetingReminderText,
  mentorshipEligibleEmail,
  mentorshipEligibleText,
  periodInviteEmail,
  periodInviteText,
  rescheduleConfirmText,
} from '@/lib/email/class-notices'
import { creditExpiryEmail, creditExpiryText } from '@/lib/email/credit-expiry'
import { briefingReminderEmail, briefingReminderText } from '@/lib/email/briefing-reminder'
import {
  briefingUpdateReminderEmail,
  briefingUpdateReminderText,
} from '@/lib/email/briefing-update-reminder'
import { contentDigestEmail, contentDigestText } from '@/lib/email/content-digest'
import { contentReviewEmail, contentReviewText } from '@/lib/email/content-review'
import { studentWhatsappChangedEmail } from '@/lib/email/student-whatsapp-changed'
import { classCancelledTeacherEmail, teacherClassChangedEmail } from '@/lib/email/teacher-notices'
import type { ChannelRegistry, OutboundMessage } from '@/lib/notify/channel'

// ADR-019: base dos links mágicos quando o chamador não injeta appUrl.
const APP_URL_FALLBACK = 'https://app.personal-teacher.com'

// Despachante do notification_outbox (F3-D4/M3 + canais F3-D8/M5) — framework-free
// (client e CANAIS injetados) para o Vitest exercitar o fluxo real.
//
// Entrega AT-LEAST-ONCE (F3-D4): seleciona sent_at IS NULL AND scheduled_for <= now
// (com ou sem error — crash entre envio e UPDATE deixa a linha elegível de novo;
// linha com sent_at preenchido NUNCA é reenviada). Duplicata só na janela de crash
// entre o aceite do provedor e a gravação — aceita nesta escala; o Idempotency-Key
// (dedupe_key) estreita a janela no e-mail sem que os testes dependam dele.
//
// Regras pinadas nos adendos do gate M0 (+ M5 + painel final):
//  - aviso OBSOLETO (crédito expirou antes do envio) → NÃO envia; sent_at = now +
//    error = 'crédito expirado antes do envio' (rastro auditável, nunca spam);
//    o "hoje" vem do BANCO (public.business_today() — fonte única do fuso do
//    negócio, adendo 7/Lei 3), nunca de fuso hard-coded no app; opts.today é a
//    injeção dos testes;
//  - aluno sem login → error = 'aluno sem login', sent_at NULL: quando o convite
//    sair (D6/F2), a PRÓXIMA rodada resolve sozinha (resolução tardia via student_id);
//  - template sem handler NESTA versão do app → PENDENTE com erro (sent_at NULL):
//    enqueue deployado antes do case novo se auto-recupera na rodada pós-deploy
//    (painel final — mesmo padrão auto-recuperável do 'canal sem driver');
//  - WhatsApp (ADR-016): opt-out DEPOIS do agendamento → resolvida sem envio
//    (consentimento vale na hora do ENVIO); com opt-in mas sem telefone → pendente.

export interface DispatchResult {
  processed: number
  sent: number
  pendingError: number // ficaram para retry (sem login, envio falhou, sem telefone, template sem handler)
  resolvedStale: number // resolvidas sem envio (expirado, opt-out)
  held: number // F6/M8-1: seguradas pela janela de silêncio (21h–8h local) — próxima rodada resolve
}

interface OutboxRow {
  id: string
  channel: string
  template: string
  recipient_profile_id: string | null
  payload: Record<string, unknown>
  dedupe_key: string
}

// ---------------------------------------------------------------------------
// Registro de templates (construção total, 14/07/2026): cada template declara
// como fica OBSOLETO (resolve sem envio), sua versão e-mail e sua versão texto.
// O credit-expiry mantém comportamento e MENSAGENS byte a byte (testes-pino de
// fase3-dispatch/outbox); template desconhecido continua PENDENTE com erro
// (auto-recuperável na rodada pós-deploy — painel final F3).
// ---------------------------------------------------------------------------
type Payload = Record<string, unknown>

interface TemplateSpec {
  /** motivo de obsolescência (→ resolvida sem envio) ou null para seguir */
  stale?: (payload: Payload, today: string) => string | null
  email?: (payload: Payload, firstName: string, appUrl?: string) => { subject: string; html: string }
  text?: (payload: Payload, firstName: string, appUrl?: string) => string
  /** F6/M8-1: aviso de LOTE respeita o silêncio 21h–8h no WhatsApp; confirmações
   *  imediatas (remarcação, cancelamento) NUNCA seguram. */
  quiet?: boolean
}

/** Aula que já começou não recebe aviso atrasado (relógio do app: aproximação
 *  aceitável — o corte fino de elegibilidade continua no banco via scheduled_for). */
const startedStale =
  (motivo: string) =>
  (payload: Payload): string | null => {
    const starts = String(payload.starts_at_utc ?? '')
    return starts && new Date(starts).getTime() <= Date.now() ? motivo : null
  }

/**
 * EXPORTADO desde a Onda da Agenda · A8 (catálogo de mensagens em
 * `/admin/ajustes`). O catálogo RENDERIZA por este mesmo registro, em vez de
 * manter uma segunda lista de textos: assim ele não pode mostrar à dona uma
 * mensagem diferente da que sai de verdade, e template novo sem entrada no
 * catálogo aparece como teste vermelho (`tests/onda-agenda-a8.test.ts`), não
 * como buraco silencioso na tela.
 *
 * E É CONGELADO (Sol · rodada 1 do A8, baixo 9). Exportar o registro CRU
 * transformou o mapa de textos do despachante num objeto MUTÁVEL compartilhado:
 * qualquer módulo que o importasse podia trocar `TEMPLATES['class-reminder']` em
 * memória, e o despachante — que lê exatamente este objeto na hora de mandar —
 * passaria a enviar outra coisa. Não é escalada de privilégio (quem importa já
 * roda no servidor), é superfície acidental que ninguém precisa. `Object.freeze`
 * no registro E em cada entrada, sem uma segunda cópia dos textos.
 */
const REGISTRO_DE_TEMPLATES: Record<string, TemplateSpec> = {
  'credit-expiry': {
    quiet: true,
    stale: (p, today) => {
      const expiresOn = String(p.expires_on ?? '')
      return expiresOn && expiresOn < today ? 'crédito expirado antes do envio' : null
    },
    email: (p, firstName, appUrl) =>
      creditExpiryEmail({
        firstName,
        nCredits: Number(p.n_credits ?? 1),
        expiresOn: String(p.expires_on ?? ''),
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      creditExpiryText({
        firstName,
        nCredits: Number(p.n_credits ?? 1),
        expiresOn: String(p.expires_on ?? ''),
        appUrl,
      }),
  },
  'class-reminder': {
    quiet: true,
    stale: startedStale('aula já começou antes do envio'),
    email: (p, firstName, appUrl) =>
      classReminderEmail({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        marco: p.marco === '48h' || p.marco === '2h' ? p.marco : null,
        instanceId: typeof p.instance_id === 'string' ? p.instance_id : null,
        meetUrl: typeof p.meet_url === 'string' ? p.meet_url : null,
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      classReminderText({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        marco: p.marco === '48h' || p.marco === '2h' ? p.marco : null,
        instanceId: typeof p.instance_id === 'string' ? p.instance_id : null,
        meetUrl: typeof p.meet_url === 'string' ? p.meet_url : null,
        magicUrl: typeof p.magic_url === 'string' ? p.magic_url : null,
        appUrl,
      }),
  },
  'briefing-reminder': {
    // M0c: lembrete manual da dona (ficha do aluno) — respeita o silêncio.
    quiet: true,
    email: (_p, firstName, appUrl) => briefingReminderEmail({ firstName, appUrl }),
    text: (_p, firstName, appUrl) => briefingReminderText({ firstName, appUrl }),
  },
  'briefing-update-reminder': {
    // Briefing v2 · sub-lote 5: o irmão do de cima, para o RE-BRIEFING semestral
    // (também manual, também respeita o silêncio). Sem `stale`: o texto não
    // afirma data nenhuma, e a recusa por "já enviada" acontece no
    // enfileiramento (enqueue_briefing_update_reminder).
    quiet: true,
    email: (_p, firstName, appUrl) => briefingUpdateReminderEmail({ firstName, appUrl }),
    text: (_p, firstName, appUrl) => briefingUpdateReminderText({ firstName, appUrl }),
  },
  'content-digest': {
    // ADR-036: o aviso do LOTE — 1 por RODADA de varredura, com números. Sai
    // do worker pela RPC enqueue_content_digest, não de um trigger. Respeita o
    // silêncio (o digest pode fechar a corrida às 23h e nada disso é urgente).
    quiet: true,
    email: (p, firstName, appUrl) =>
      contentDigestEmail({
        semana: String(p.semana ?? ''),
        novas: Number(p.novas ?? 0),
        destaque: Number(p.destaque ?? 0),
        rascunhos: Number(p.rascunhos ?? 0),
        firstName,
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      contentDigestText({
        semana: String(p.semana ?? ''),
        novas: Number(p.novas ?? 0),
        destaque: Number(p.destaque ?? 0),
        rascunhos: Number(p.rascunhos ?? 0),
        firstName,
        appUrl,
      }),
  },
  'content-review': {
    // ADR-021: aviso interno da fábrica de conteúdo (digest por etapa/dia,
    // dedupe no trigger notify_content_review). Respeita o silêncio.
    quiet: true,
    email: (p, firstName, appUrl) =>
      contentReviewEmail({ stage: p.stage === 'rascunhos' ? 'rascunhos' : 'ideias', firstName, appUrl }),
    text: (p, firstName, appUrl) =>
      contentReviewText({ stage: p.stage === 'rascunhos' ? 'rascunhos' : 'ideias', firstName, appUrl }),
  },
  'reschedule-confirm': {
    // Só WhatsApp (o e-mail 3 aprovado sai direto pela action do portal).
    stale: startedStale('aula remarcada já começou antes do envio'),
    text: (p, firstName) =>
      rescheduleConfirmText({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        // Item 26: 'redeem' (aula nascida de crédito) ganha texto próprio —
        // o campo é enriquecido pelo dispatchRow (reschedule_of da instância).
        kind: p.kind === 'redeem' ? 'redeem' : 'reschedule',
      }),
  },
  'class-cancelled': {
    // F2/M2-3/P4: confirmação de cancelamento (autocancelamento E admin unitário).
    // Sem stale: a confirmação vale mesmo que o horário original já tenha passado.
    email: (p, firstName, appUrl) =>
      classCancelledEmail({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        credited: Boolean(p.credited),
        expiresOn: typeof p.expires_on === 'string' ? p.expires_on : null,
        appUrl,
      }),
    text: (p, firstName) =>
      classCancelledText({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        credited: Boolean(p.credited),
        expiresOn: typeof p.expires_on === 'string' ? p.expires_on : null,
      }),
  },
  'period-reschedule-invite': {
    // F5/P5: convite de remarcação (a aula permanece) — obsoleto se já começou.
    quiet: true,
    stale: startedStale('aula do convite já começou antes do envio'),
    email: (p, firstName, appUrl) =>
      periodInviteEmail({
        firstName,
        instanceId: String(p.instance_id ?? ''),
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        note: typeof p.note === 'string' ? p.note : null,
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      periodInviteText({
        firstName,
        instanceId: String(p.instance_id ?? ''),
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        teacherName: String(p.teacher_name ?? 'sua professora'),
        note: typeof p.note === 'string' ? p.note : null,
        appUrl,
      }),
  },
  'meeting-reminder': {
    // F10/M6-3: lembrete 24h do encontro — lote (herda o silêncio 21h–8h)
    quiet: true,
    stale: startedStale('encontro já começou antes do envio'),
    email: (p, firstName) =>
      meetingReminderEmail({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        meetUrl: typeof p.meet_url === 'string' ? p.meet_url : null,
      }),
    text: (p, firstName) =>
      meetingReminderText({
        firstName,
        startsAtUtc: String(p.starts_at_utc ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        meetUrl: typeof p.meet_url === 'string' ? p.meet_url : null,
      }),
  },
  'meeting-cancelled': {
    // evento (estorno já feito): sai imediato, sem silêncio e sem stale
    email: (p, firstName, appUrl) =>
      meetingCancelledEmail({
        firstName,
        startsAtUtc: String(p.scheduled_at ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        self: Boolean(p.self),
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      meetingCancelledText({
        firstName,
        startsAtUtc: String(p.scheduled_at ?? ''),
        ianaTz: String(p.iana_tz ?? ''),
        localTimeSnapshot: String(p.local_time_snapshot ?? ''),
        self: Boolean(p.self),
        appUrl,
      }),
  },
  'student-whatsapp-changed': {
    // Onda da Agenda · lote final: aviso INTERNO para a professora quando o
    // aluno troca o WhatsApp no portal (`update_my_whatsapp`, migration
    // 20260730000400). SÓ e-mail, de propósito — avisar pelo canal que acabou
    // de mudar é o que este aviso existe para evitar; sem `text`, uma linha de
    // WhatsApp com este template fica PRESA e visível em Mensagens em vez de
    // sair pelo canal errado.
    // Sem `stale`: o fato não envelhece — o número novo continua sendo o
    // número, tenha o e-mail saído hoje ou amanhã.
    email: (p, firstName, appUrl) =>
      studentWhatsappChangedEmail({
        firstName,
        studentName: String(p.student_name ?? 'Um aluno'),
        whatsappE164: String(p.whatsapp_e164 ?? ''),
        appUrl,
      }),
  },
  'mentorship-eligible': {
    quiet: true,
    email: (p, firstName, appUrl) =>
      mentorshipEligibleEmail({
        firstName,
        nextWindow: Number(p.next_window ?? 1),
        totalCredits: Number(p.total_credits ?? 6),
        appUrl,
      }),
    text: (p, firstName, appUrl) =>
      mentorshipEligibleText({
        firstName,
        nextWindow: Number(p.next_window ?? 1),
        totalCredits: Number(p.total_credits ?? 6),
        appUrl,
      }),
  },
  'class-cancelled-teacher': {
    // M2 (01/09/2026): aviso INTERNO para a professora — a aula dela foi
    // cancelada por outra pessoa. SÓ e-mail (sem `text`, como o aviso de
    // troca de número): linha de WhatsApp com este template fica PRESA e
    // visível em Avisos. Sem `stale`: a professora precisa saber mesmo que o
    // e-mail saia depois do horário.
    email: (p, firstName, appUrl) =>
      classCancelledTeacherEmail({
        firstName,
        studentName: String(p.student_name ?? 'Um aluno'),
        startsAtUtc: String(p.starts_at_utc ?? ''),
        teacherTz: String(p.teacher_tz ?? 'America/Cuiaba'),
        cancelledBy: p.cancelled_by === 'teacher' ? 'teacher' : 'student',
        appUrl,
      }),
  },
  'teacher-class-changed': {
    // M2: aviso INTERNO para a administração — a professora cancelou ou
    // remarcou a própria aula, com o motivo dela. Só e-mail, mesma razão.
    email: (p, firstName, appUrl) =>
      teacherClassChangedEmail({
        firstName,
        teacherName: String(p.teacher_name ?? 'A professora'),
        studentName: String(p.student_name ?? 'um aluno'),
        kind: p.kind === 'rescheduled' ? 'rescheduled' : 'cancelled',
        oldStartsAtUtc: String(p.old_starts_at_utc ?? ''),
        newStartsAtUtc: typeof p.new_starts_at_utc === 'string' ? p.new_starts_at_utc : null,
        reason: String(p.reason ?? ''),
        teacherTz: String(p.teacher_tz ?? 'America/Cuiaba'),
        credited: typeof p.credited === 'boolean' ? p.credited : null,
        expiresOn: typeof p.expires_on === 'string' ? p.expires_on : null,
        appUrl,
      }),
  },
}

for (const spec of Object.values(REGISTRO_DE_TEMPLATES)) Object.freeze(spec)

export const TEMPLATES: Readonly<Record<string, Readonly<TemplateSpec>>> =
  Object.freeze(REGISTRO_DE_TEMPLATES)

export async function dispatchOutbox(
  admin: SupabaseClient,
  channels: ChannelRegistry,
  opts: { limit?: number; today?: string; appUrl?: string; now?: Date; keyLike?: string } = {},
): Promise<DispatchResult> {
  const today = opts.today ?? (await businessToday(admin))
  const result: DispatchResult = { processed: 0, sent: 0, pendingError: 0, resolvedStale: 0, held: 0 }

  let query = admin
    .from('notification_outbox')
    .select('id, channel, template, recipient_profile_id, payload, dedupe_key')
    .is('sent_at', null)
    // 'now' é resolvido NO BANCO ('now'::timestamptz) — o relógio do app nunca
    // decide elegibilidade (painel final: skew host×container fazia o despachante
    // pular linha recém-agendada; mesma fonte única de tempo do business_today).
    .lte('scheduled_for', 'now')
  // escopo por prefixo de chave — usado pelos TESTES (arquivos paralelos não
  // disputam as linhas uns dos outros); em produção fica ausente (fila inteira).
  if (opts.keyLike) query = query.like('dedupe_key', opts.keyLike)
  const { data: rows, error } = await query.order('created_at').limit(opts.limit ?? 500)
  if (error) throw new Error(`outbox select falhou: ${error.message}`)

  for (const row of (rows ?? []) as OutboxRow[]) {
    result.processed++
    const outcome = await dispatchRow(admin, channels, row, today, opts.appUrl, opts.now ?? new Date())
    if (outcome === 'sent') result.sent++
    else if (outcome === 'stale') result.resolvedStale++
    else if (outcome === 'held') result.held++
    else result.pendingError++
  }
  return result
}

/** F6/M8-1: janela de silêncio 21h–8h no fuso do DESTINATÁRIO (só WhatsApp de
 *  lote; e-mail nunca segura). Devolve também quando o silêncio acaba, para a
 *  exceção do toque de 2h (aula que começa antes das 8h → resolvida sem envio). */
function quietWindow(ianaTz: string, now: Date): { inQuiet: boolean; endsMs: number } {
  const local = DateTime.fromJSDate(now).setZone(ianaTz || 'America/Cuiaba')
  const base = local.isValid ? local : DateTime.fromJSDate(now).setZone('America/Cuiaba')
  const inQuiet = base.hour >= 21 || base.hour < 8
  const ends = (base.hour >= 21 ? base.plus({ days: 1 }) : base).set({
    hour: 8, minute: 0, second: 0, millisecond: 0,
  })
  return { inQuiet, endsMs: ends.toMillis() }
}

/** Data civil de "hoje" no fuso do NEGÓCIO, resolvida no BANCO (fonte única —
 *  public.business_tz()/business_today(); adendo 7 do gate M0, Lei 3). Um fuso
 *  hard-coded aqui divergiria em silêncio nas janelas 00:00–04:00 UTC se o fuso
 *  do negócio mudasse no banco. */
async function businessToday(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.rpc('business_today')
  if (error || typeof data !== 'string') {
    throw new Error(`business_today() falhou: ${error?.message ?? 'resposta vazia'}`)
  }
  return data
}

async function dispatchRow(
  admin: SupabaseClient,
  channels: ChannelRegistry,
  row: OutboxRow,
  today: string,
  appUrl: string | undefined,
  now: Date,
): Promise<'sent' | 'stale' | 'pending' | 'held'> {
  const fail = async (msg: string): Promise<'pending'> => {
    await admin.from('notification_outbox').update({ error: msg }).eq('id', row.id)
    return 'pending'
  }
  // Resolvida SEM envio: rastro fica (Lei 8), o despachante nunca a pega de novo.
  const resolve = async (msg: string): Promise<'stale'> => {
    await admin
      .from('notification_outbox')
      .update({ sent_at: new Date().toISOString(), error: msg })
      .eq('id', row.id)
    return 'stale'
  }

  const channel = channels[row.channel]
  if (!channel) {
    return fail(`canal ${row.channel} sem driver configurado`)
  }
  // Painel final: pendente (nunca resolve) — um template novo enfileirado antes do
  // deploy do app com o handler sai sozinho na primeira rodada pós-deploy (F3-D4).
  const spec = TEMPLATES[row.template]
  if (!spec) {
    return fail(`template sem handler nesta versão do app: ${row.template}`)
  }

  // Painel final: exceção de REDE (timeout, ECONNREFUSED, DNS) num driver nunca
  // derruba a rodada — vira { ok: false } e a linha fica pendente para retry;
  // as linhas seguintes continuam sendo processadas. Ponto ÚNICO para todos os
  // drivers (atuais e futuros).
  const safeSend = async (message: OutboundMessage) => {
    try {
      return await channel.send(message)
    } catch (err) {
      return { ok: false as const, error: String(err) }
    }
  }

  const staleReason = spec.stale?.(row.payload, today) ?? null
  if (staleReason) {
    return resolve(staleReason)
  }

  // Item 26 (veredito): remarcação × resgate divergem só aqui — a instância de
  // resgate não tem reschedule_of. Uma leitura por linha, sem tocar o SQL de
  // enfileiramento; falha da consulta cai no texto padrão (nunca trava envio).
  if (row.template === 'reschedule-confirm' && row.payload.kind === undefined) {
    const instanceId = typeof row.payload.instance_id === 'string' ? row.payload.instance_id : null
    if (instanceId) {
      const { data: inst } = await admin
        .from('class_instances')
        .select('reschedule_of')
        .eq('id', instanceId)
        .maybeSingle()
      row.payload.kind = inst && inst.reschedule_of === null ? 'redeem' : 'reschedule'
    }
  }

  // F6/M8-1: silêncio 21h–8h LOCAL — só WhatsApp de LOTE. A linha fica intocada
  // (pendente sem erro) e a próxima rodada horária a pega fora do silêncio.
  // Exceção do toque de 2h: se a aula começa ANTES do fim do silêncio, não há
  // como avisar a tempo — resolvida sem envio, com a razão nova (M8-2).
  if (row.channel === 'whatsapp' && spec.quiet) {
    const { inQuiet, endsMs } = quietWindow(String(row.payload.iana_tz ?? ''), now)
    if (inQuiet) {
      const starts = String(row.payload.starts_at_utc ?? '')
      if (String(row.payload.marco ?? '') === '2h' && starts && Date.parse(starts) < endsMs) {
        return resolve('janela de silêncio (21h–8h): a aula começa antes das 8h — resolvida sem envio')
      }
      return 'held'
    }
  }

  // Resolução TARDIA do destinatário (F3-D4): a linha nasce mesmo sem login; o
  // profile é procurado no DESPACHO — aluno convidado depois entra sozinho.
  let profileId = row.recipient_profile_id
  if (!profileId) {
    const { data: student } = await admin
      .from('students')
      .select('profile_id')
      .eq('id', String(row.payload.student_id ?? ''))
      .maybeSingle()
    profileId = student?.profile_id ?? null
  }
  if (!profileId) return fail('aluno sem login')

  const { data: userData } = await admin.auth.admin.getUserById(profileId)
  const firstNameRaw =
    (userData?.user?.user_metadata as Record<string, unknown> | null)?.first_name
  const firstName = typeof firstNameRaw === 'string' && firstNameRaw ? firstNameRaw : 'aluno(a)'

  if (row.channel === 'whatsapp') {
    // F6/P9 (M4-3 vigora): TEM NÚMERO → recebe. O opt-in booleano sai de cena
    // (a F7 dropa a coluna); sem número a linha fica pendente — quando o número
    // entrar no cadastro, a próxima rodada resolve sozinha.
    const { data: profile } = await admin
      .from('profiles')
      .select('whatsapp_e164')
      .eq('id', profileId)
      .maybeSingle()
    if (!profile?.whatsapp_e164) return fail('sem número de WhatsApp no cadastro')
    if (!spec.text) return fail(`template ${row.template} sem versão WhatsApp`)

    // ADR-019 (19/07, decisão do mantenedor): o link do lembrete entra LOGADO —
    // magic link do GoTrue gerado POR MENSAGEM, uso único; o /wa/<hash> troca
    // por sessão e cai na página da aula. Falha na geração nunca trava o
    // envio: o texto degrada para o link normal (login com destino).
    if (
      row.template === 'class-reminder' &&
      typeof row.payload.instance_id === 'string' &&
      userData?.user?.email
    ) {
      try {
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email: userData.user.email,
        })
        const th = linkData?.properties?.hashed_token
        if (th) {
          row.payload.magic_url = `${appUrl ?? APP_URL_FALLBACK}/wa/${th}?ir=/portal/aula/${row.payload.instance_id}`
        }
      } catch {
        /* link normal segue valendo */
      }
    }

    const sent = await safeSend({
      to: profile.whatsapp_e164,
      text: spec.text(row.payload, firstName, appUrl),
    })
    if (!sent.ok) return fail(sent.error)
  } else {
    const to = userData?.user?.email
    if (!to) return fail('perfil sem e-mail')
    if (!spec.email) return fail(`template ${row.template} sem versão e-mail`)
    const { subject, html } = spec.email(row.payload, firstName, appUrl)
    const sent = await safeSend({ to, subject, html, idempotencyKey: row.dedupe_key })
    if (!sent.ok) return fail(sent.error)
  }

  await admin
    .from('notification_outbox')
    .update({ sent_at: new Date().toISOString(), error: null })
    .eq('id', row.id)
  return 'sent'
}
