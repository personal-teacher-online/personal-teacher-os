import type { SupabaseClient } from '@supabase/supabase-js'
import {
  criarCobranca,
  listarCobrancasPorReferencia,
  reaisParaCentavos,
  type AsaasCobranca,
  type AsaasConfig,
} from '@/lib/asaas/client'
import { espelharCobrancaDaApi } from '@/lib/asaas/espelho'

// Núcleo da EMISSÃO de cobrança de aula avulsa (F5) — client injetado para o
// Vitest exercitar concorrência e timeout com dublê de fetch; a server action
// da agenda é um wrapper fino (auth + formulário + transporte).
//
// A ordem é a defesa (fatos do gate F0: a API NÃO tem idempotência nativa;
// GET ?externalReference= é read-your-writes):
//   1. pagador pronto — régua única `avulsa_pagador_pronto` (a mesma da tela);
//   2. CLAIM — `emitir_avulsa_claim` valida a aula e disputa a trava por
//      INSERT; perdeu = outra emissão em andamento, NADA de POST;
//   3. GET antes do POST — NUNCA POST cego: cobrança existente não-cancelada
//      é ADOTADA (cobre o crash pós-POST e a cobrança manual do painel);
//   4. POST /payments com externalReference = UUID da aula;
//   5. espelho IMEDIATO pela MESMA RPC do webhook + audit.
// Falha entre 4 e 5 não perde nada: a cobrança existe no Asaas e a PRÓXIMA
// tentativa a adota pelo GET (a claim estagnada é tomada após 5 min).

export interface ResultadoDaEmissao {
  ok: boolean
  /** frase pronta para o recado (voz da escola; erro começa com "Falha:") */
  frase: string
  cobranca?: AsaasCobranca
  adotada?: boolean
}

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function emitirCobrancaDaAvulsa(
  admin: SupabaseClient,
  cfg: AsaasConfig,
  aulaId: string,
  opts: { actorId: string | null; dueDate: string; aluno?: string | null; dia?: string | null },
): Promise<ResultadoDaEmissao> {
  // A descrição da FATURA (o pagador lê no boleto): aluno + dia da aula.
  const descricao = `Aula avulsa${opts.aluno ? ` — ${opts.aluno}` : ''}${opts.dia ? ` (${opts.dia})` : ''} · Personal Teacher`
  // 1. Pagador pronto — a action recusa pelo MESMO lugar que a tela consulta.
  const { data: pagadorRows, error: pagErr } = await admin.rpc('avulsa_pagador_pronto', {
    p_class_instance: aulaId,
  })
  if (pagErr) return { ok: false, frase: `Falha: ${pagErr.message}` }
  const pagador = (Array.isArray(pagadorRows) ? pagadorRows[0] : null) as {
    payer_name: string
    asaas_customer_id: string
  } | null
  if (!pagador) {
    return {
      ok: false,
      frase:
        'Falha: esta aula ainda não tem pagador pronto — na ficha do aluno, o pagador precisa de cadastro no Asaas (vínculo self, ou um único terceiro). Nada foi cobrado.',
    }
  }

  // 2. A trava. claimed=false = alguém está emitindo AGORA (não é erro do banco).
  const { data: claim, error: claimErr } = await admin.rpc('emitir_avulsa_claim', {
    p_class_instance: aulaId,
    p_actor: opts.actorId,
  })
  if (claimErr) return { ok: false, frase: `Falha: ${claimErr.message}` }
  const c = claim as { claimed?: boolean; price_cents?: number; stamp?: string } | null
  if (!c?.claimed) {
    return {
      ok: false,
      frase: 'Falha: outra emissão desta aula está em andamento — aguarde alguns segundos e confira a tela de novo. Nada foi duplicado.',
    }
  }
  const valorCents = Number(c.price_cents ?? 0)

  // 3–4. GET antes do POST; adota o que existir (não-cancelada), senão emite.
  let cobranca: AsaasCobranca
  let adotada = false
  try {
    const existentes = (await listarCobrancasPorReferencia(cfg, aulaId)).filter((x) => !x.deleted)
    if (existentes.length > 1) {
      // Sol F5 · P1: adotar `[0]` no escuro esconderia as outras — a
      // reconciliação PARA e aponta o painel; nada é escolhido pelo acaso.
      return {
        ok: false,
        frase: `Falha: o Asaas tem ${existentes.length} cobranças ativas com a referência desta aula — resolva no painel (cancele as sobras) e tente de novo. Nada foi emitido nem espelhado.`,
      }
    }
    if (existentes.length === 1) {
      cobranca = existentes[0]
      adotada = true
    } else {
      // A CERCA da claim, na véspera do POST (Sol F5 · P1): se outra tentativa
      // tomou a trava por estagnação, o stamp mudou — abortar SEM POST.
      const { data: vigente, error: vigErr } = await admin.rpc('emissao_claim_vigente', {
        p_class_instance: aulaId,
        p_stamp: c.stamp,
      })
      if (vigErr || vigente !== true) {
        return {
          ok: false,
          frase: 'Falha: esta emissão foi retomada por outra tentativa — recarregue a tela e confira antes de tentar de novo. Nada foi duplicado.',
        }
      }
      cobranca = await criarCobranca(cfg, {
        customer: pagador.asaas_customer_id,
        billingType: 'BOLETO',
        valueCents: valorCents,
        dueDate: opts.dueDate,
        description: descricao,
        externalReference: aulaId,
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      frase: `Falha: o Asaas não confirmou a emissão (${msg}). Tente de novo em instantes — a conferência prévia adota o que já existir, nunca duplica.`,
    }
  }

  // 5. Espelho imediato pela MESMA RPC do webhook, com a trilha da emissão NA
  // MESMA transação (Sol F5 · P1: audit separado que falhava depois do espelho
  // ficava sem conserto — a claim recusa aula já espelhada).
  // Sol r2 · P1: a trilha e a frase contam os números DA COBRANÇA (na adoção,
  // valor/vencimento podem divergir do formulário — registrar o formulário
  // seria trilha mentirosa sobre dinheiro).
  const valorReal = typeof cobranca.value === 'number' ? reaisParaCentavos(cobranca.value) : valorCents
  const vencimentoReal = cobranca.dueDate ?? opts.dueDate
  const erroEspelho = await espelharCobrancaDaApi(admin, aulaId, cobranca, {
    actor: opts.actorId,
    class_instance_id: aulaId,
    amount_cents: valorReal,
    due_date: vencimentoReal,
    adotada,
    ambiente: cfg.ambiente,
  })
  if (erroEspelho) {
    return {
      ok: false,
      frase: `Falha: a cobrança ${adotada ? 'já existia' : 'saiu'} no Asaas (${cobranca.id}), mas o espelho local falhou: ${erroEspelho}. Tente de novo — a próxima tentativa adota a cobrança, sem duplicar.`,
    }
  }

  // O "— mas" é o marcador da casa para sucesso parcial (sai VERMELHO no
  // toast): adoção com valor divergente é dinheiro precisando de olho humano.
  const divergente =
    adotada && valorReal !== valorCents
      ? ` — mas o valor da cobrança difere do valor da aula (${fmtBRL(valorCents)}): confira no painel.`
      : '.'
  return {
    ok: true,
    adotada,
    cobranca,
    frase: adotada
      ? `Uma cobrança desta aula já existia no Asaas — foi adotada no espelho (${fmtBRL(valorReal)}, vencimento ${vencimentoReal.split('-').reverse().join('/')})${divergente}`
      : `Cobrança emitida no Asaas: ${fmtBRL(valorReal)} para ${pagador.payer_name}, boleto com vencimento em ${vencimentoReal.split('-').reverse().join('/')}. O aluno evolui para “paga” quando o dinheiro cair.`,
  }
}
