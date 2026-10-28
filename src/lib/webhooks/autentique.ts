import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Webhook Autentique (B8). Fatos conferidos na doc oficial (14/07/2026):
//  - Autenticidade: HMAC-SHA256 do CORPO CRU com o secret, hex, no header
//    x-autentique-signature (comparação timingSafeEqual — fail-closed).
//  - Payload: { id, object: 'webhook', event: { id, type, data: { object } } };
//    eventos relevantes: signature.viewed / signature.rejected /
//    signature.accepted / document.finished / document.deleted.
//  - Retry deles: 3 tentativas extra (60/120/300s) — erro de negócio responde
//    200 (molde Asaas/Hotmart; inbox first-write-wins + reprocesso de preso).
// Status derivado (comment da migration 20260715000400): o provedor NÃO tem
// campo único de status — mapeamos evento→status SEM regredir assinatura:
// viewed nunca sobrescreve signed/refused; finished ganha de tudo (exceto
// cancelled explícito posterior).

interface AutentiqueWebhookEvent {
  id?: string
  event?: {
    id?: string
    type?: string
    data?: { object?: { id?: string; document?: { id?: string }; signed?: string } }
  }
}

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

export function verifyAutentiqueSignature(
  rawBody: string,
  signatureHex: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !signatureHex) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  let b: Buffer
  try {
    b = Buffer.from(signatureHex, 'hex')
  } catch {
    return false
  }
  return a.length === b.length && timingSafeEqual(a, b)
}

// evento → status alvo; a MATRIZ de transição (monotônica, terminais não
// regridem) vive NO BANCO — apply_autentique_event (Lei 3; painel 14/07/2026).
//
// c15 · Sol 4: este mapa tem um GÊMEO em SQL (`autentique_status_do_evento`),
// porque a reaplicação de eventos presos acontece dentro da transação do anexo,
// no banco, e não pode depender de um round-trip até aqui. Os dois são
// conferidos tipo a tipo pelo aceite do c15 — cópia sem aceite é cópia que
// diverge.
//
// c16 · r6 nº 3 (GRAVE) — `signature.accepted` É DE UM SIGNATÁRIO.
//
// O evento de aceite fala de UMA assinatura, não do documento. Mandá-lo para
// `signed` (que é TERMINAL) fazia o primeiro a assinar declarar o contrato de
// casal inteiro assinado — e, como terminal não regride, nem o
// `document.finished` posterior nem a RECUSA do segundo signatário mudavam mais
// nada. O único evento que fala do DOCUMENTO como um todo é
// `document.finished`; ele é que encerra.
//
// `viewed` é o degrau intermediário porque o espelho local tem UMA linha por
// documento e não guarda signatário nenhum: ele não sabe dizer "1 de 2", e
// inventar um status para isso seria fingir um dado que a tabela não tem. É a
// mesma resposta que a consulta manual já dava — `getDocumentSignatures` só diz
// `signed` quando `signatures.every(s => s.signed)`.
const EVENT_STATUS: Record<string, string> = {
  'signature.viewed': 'viewed',
  'signature.rejected': 'refused',
  'signature.accepted': 'viewed',
  'document.finished': 'signed',
  'document.deleted': 'cancelled',
}

export async function handleAutentiqueWebhook(
  admin: SupabaseClient,
  opts: { rawBody: string; signature: string | null; secret: string | undefined },
): Promise<WebhookResult> {
  // Fail-closed: sem secret configurado a rota é inoperante; assinatura errada
  // nunca grava nada.
  if (!verifyAutentiqueSignature(opts.rawBody, opts.signature, opts.secret)) {
    return { status: 401, body: { ok: false, detail: 'assinatura inválida' } }
  }

  let evt: AutentiqueWebhookEvent
  try {
    evt = JSON.parse(opts.rawBody) as AutentiqueWebhookEvent
  } catch {
    return { status: 400, body: { ok: false, detail: 'JSON inválido' } }
  }

  const eventId = evt.event?.id ?? evt.id
  if (!eventId) return { status: 400, body: { ok: false, detail: 'payload sem id de evento' } }

  const { data: inserted, error: inboxErr } = await admin
    .from('webhook_inbox')
    .upsert(
      { source: 'autentique', event_id: String(eventId), payload: evt as never },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (inboxErr) {
    return { status: 500, body: { ok: false, detail: `inbox: ${inboxErr.message}` } }
  }
  let inboxId: number
  if (!inserted || inserted.length === 0) {
    const { data: stuck } = await admin
      .from('webhook_inbox')
      .select('id, payload')
      .eq('source', 'autentique')
      .eq('event_id', String(eventId))
      .is('processed_at', null)
      .maybeSingle()
    if (!stuck) {
      return { status: 200, body: { ok: true, detail: 'evento já recebido (replay ignorado)' } }
    }
    inboxId = stuck.id as number
    evt = stuck.payload as AutentiqueWebhookEvent
  } else {
    inboxId = inserted[0].id as number
  }

  const finish = async (error: string | null): Promise<WebhookResult> => {
    await admin
      .from('webhook_inbox')
      .update({ processed_at: new Date().toISOString(), error })
      .eq('id', inboxId)
    return { status: 200, body: { ok: true, detail: error ?? undefined } }
  }

  /**
   * c15 · Sol 4 — O EVENTO QUE CHEGA ANTES DO ESPELHO FICA PRESO, NÃO PROCESSADO.
   *
   * Entre criar o documento no Autentique e anexar o id à reserva local há uma
   * janela de milissegundos, e um webhook cabe nela (o `signature.viewed` de
   * quem abre o e-mail na hora). Nessa janela `apply_autentique_event` devolve
   * NULL — não há espelho para transicionar. O c14 marcava `processed_at` assim
   * mesmo: o evento constava como consumido e não tinha feito nada, e o estado
   * local ficava parado até alguém clicar "consultar".
   *
   * Agora a linha fica com `processed_at` NULO e o erro escrito. Quem a resgata é
   * o ANEXO do documento (`admin_finish_signature` → `_reaplicar_eventos_
   * autentique`), que reaplica em ordem tudo o que estiver preso para aquele
   * documento — e, enquanto isso não acontece, um replay do provedor cai no
   * caminho de "evento preso" que este arquivo já tinha e reprocessa.
   *
   * A resposta continua sendo 200 (Lei 6): o provedor não pode ver falha nossa,
   * sob pena de desativar a URL.
   */
  /*
   * c16 · r6 nº 10 — O DIAGNÓSTICO NÃO PISA EM EVENTO JÁ PROCESSADO.
   *
   * Este `update` escreve a coluna `error` de uma linha que ele espera encontrar
   * PRESA. Só que entre a leitura e a escrita cabe o anexo do documento
   * (`admin_finish_signature` → `_reaplicar_eventos_autentique`), que aplica o
   * evento e escreve nessas mesmas duas colunas o texto "aplicado no anexo do
   * documento". Sem a guarda, a corrida terminava com a linha marcada como
   * processada E com o erro dizendo que não havia espelho — rastro que se
   * contradiz, no lugar exato onde a auditoria vai olhar.
   *
   * O `error` da escrita também deixou de ser descartado: uma inbox que não
   * aceita o diagnóstico é uma inbox que perdeu o rastro, e isso tem de aparecer
   * na resposta (que continua 200 — Lei 6: o provedor não pode ver falha nossa).
   */
  const naoAplicado = async (error: string): Promise<WebhookResult> => {
    const { error: escrita } = await admin
      .from('webhook_inbox')
      .update({ error })
      .eq('id', inboxId)
      .is('processed_at', null)
    if (escrita) {
      return {
        status: 200,
        body: { ok: true, detail: `${error} — e o diagnóstico não pôde ser gravado: ${escrita.message}` },
      }
    }
    return { status: 200, body: { ok: true, detail: error } }
  }

  const type = evt.event?.type ?? ''
  const newStatus = EVENT_STATUS[type]
  if (!newStatus) return finish(`evento ${type || 'desconhecido'} ignorado`)

  // O objeto pode ser o documento (document.*) ou a assinatura (signature.* —
  // documento em data.object.document.id, quando presente).
  const obj = evt.event?.data?.object
  const documentId = obj?.document?.id ?? obj?.id
  if (!documentId) return finish('evento sem id de documento')

  // A decisão (monotônica + auditada) é da RPC; NULL = sem espelho local.
  const { data: applied, error: rpcErr } = await admin.rpc('apply_autentique_event', {
    p_provider_document_id: String(documentId),
    p_new_status: newStatus,
    p_event: evt as never,
  })
  if (rpcErr) return finish(`apply_autentique_event: ${rpcErr.message}`)
  if (applied === null) {
    return naoAplicado(
      `documento ${documentId} ainda sem registro em contract_signatures — evento guardado para ser aplicado quando o documento for anexado`,
    )
  }
  return finish(null)
}
