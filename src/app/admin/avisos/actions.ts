'use server'

import { revalidatePath } from 'next/cache'

import type { ResultadoDaAcao } from '@/data/admin/action-result'
import {
  fraseDaRecusaDoReenvio,
  fraseDoReenvioDepoisDoDespacho,
  ROTULO_DA_SITUACAO,
} from '@/data/admin/mensagens-gramatica'
import { requireAdminId } from '@/lib/auth/admin'
import { canaisDoAmbiente } from '@/lib/notify/registry'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// F6/M8-5 → M3-3a: resolver SEM enviar, com motivo obrigatório e auditoria —
// a MESMA RPC de antes (`admin_resolve_outbox` decide e audita; Lei 3). O que
// mudou é a porta: em vez de `redirect` com recado na URL, devolve
// `ResultadoDaAcao` para o toast do kit, e quem chamou fecha o painel.
// M3-3b: o "reenviar" entra pela mesma porta (`admin_resend_outbox`).
//
// A PALAVRA do toast sai do que a RPC GRAVOU, lido depois dela: a presa que
// falhou depois do envio (a mensagem saiu) se resolve "sem reenviar", não "sem
// enviar". O formulário pode estar velho (o recibo de falha chegou entre a
// abertura do painel e o clique), então ele não decide a frase.
// Quem decide o que é possível continua sendo a RPC.
export async function resolverMensagemAction(formData: FormData): Promise<ResultadoDaAcao> {
  // Server action é endpoint público: revalida o papel SEMPRE.
  await requireAdminId()

  const id = String(formData.get('id') ?? '')
  const nota = String(formData.get('note') ?? '').trim()
  if (!id) return { ok: false, mensagem: 'Mensagem não identificada.' }
  // Antecipação para UX — quem recusa de verdade é a RPC.
  if (!nota) return { ok: false, mensagem: 'Escreva o motivo: ele fica registrado na mensagem.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_resolve_outbox', { p_id: id, p_note: nota })
  if (error) return { ok: false, mensagem: `Não deu para resolver: ${error.message}` }

  revalidatePath('/admin/avisos')
  // `admin_resolve_outbox` grava 'resolvido sem reenviar: …' na que já tinha saído
  const { data: gravada } = await supabase.from('outbox_admin').select('error').eq('id', id).maybeSingle()
  const erro = typeof gravada?.error === 'string' ? gravada.error : null
  const palavra = erro === null ? null : erro.startsWith('resolvido sem reenviar:') ? 'sem reenviar' : 'sem envio'
  return {
    ok: true,
    mensagem: `Mensagem resolvida${palavra ? ` ${palavra}` : ''}. O motivo ficou registrado.`,
  }
}

const SITUACOES_QUE_A_TELA_MOSTRA = Object.keys(ROTULO_DA_SITUACAO)

// "Reenviar" do painel. Quem decide, recusa e audita é a RPC
// `admin_resend_outbox` (Lei 3): cria a linha nova, fecha a de origem e grava
// no audit_log; ela recusa linha aguardando envio e linha cuja situação mudou
// desde que a tela abriu (por isso a tela manda a situação que mostrava). A
// recusa chega à dona em frase dela, sem id nem código.
//
// Depois do commit, o despacho imediato tira a cópia de "Aguardando" sem esperar
// a rodada horária. Ele é ESCOPADO na cópia (`keyLike` pela chave dela): com a
// fila cheia na frente, a rodada inteira não chegaria nela, e a dona esperaria
// no escuro. Se o despacho falhar ou não enviar, o reenvio continua valendo e o
// toast diz isso — nada fica só no `console.error`.
export async function reenviarMensagemAction(formData: FormData): Promise<ResultadoDaAcao> {
  // Server action é endpoint público: revalida o papel SEMPRE.
  await requireAdminId()

  const id = String(formData.get('id') ?? '')
  const situacao = String(formData.get('situacao') ?? '')
  if (!id) return { ok: false, mensagem: 'Mensagem não identificada.' }
  // Antecipação para UX — quem recusa de verdade é a RPC.
  if (!SITUACOES_QUE_A_TELA_MOSTRA.includes(situacao)) {
    return { ok: false, mensagem: 'Reabra a mensagem e tente de novo: a situação dela não veio.' }
  }

  const supabase = await createClient()
  const { data: nova, error } = await supabase.rpc('admin_resend_outbox', {
    p_id: id,
    p_situacao_esperada: situacao,
  })
  if (error) return { ok: false, mensagem: fraseDaRecusaDoReenvio(error.message, error.code) }

  revalidatePath('/admin/avisos')

  let seguradaNoSilencio = false
  try {
    // a chave da cópia é `<chave da origem>:reenvio:<uuid>` (a RPC a monta assim)
    const r = await dispatchOutbox(createAdminClient(), canaisDoAmbiente(), {
      keyLike: `%:reenvio:${String(nova)}`,
    })
    seguradaNoSilencio = (r?.held ?? 0) > 0
  } catch (err) {
    console.error('[reenvio não despachado na hora]', err)
    return {
      ok: true,
      mensagem:
        'Mensagem reenviada, mas o envio imediato falhou. A cópia fica em Aguardando e a próxima rodada tenta de novo.',
    }
  }
  // O que dizer sai da situação REAL da cópia depois do despacho (a view), não de
  // um palpite: ela pode ter saído, ficado presa, sido fechada sem envio ou esperar.
  const { data: copia } = await supabase
    .from('outbox_admin')
    .select('situacao, error')
    .eq('id', String(nova))
    .maybeSingle()
  return {
    ok: true,
    mensagem: fraseDoReenvioDepoisDoDespacho(
      typeof copia?.situacao === 'string' ? copia.situacao : null,
      typeof copia?.error === 'string' ? copia.error : null,
      seguradaNoSilencio,
    ),
  }
}
