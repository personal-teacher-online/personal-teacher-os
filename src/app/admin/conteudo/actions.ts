'use server'

// AS AÇÕES DO RADAR (Estúdio v2 · Levas 3 e 4) — descartar uma trend com
// motivo e ajustar a nota de viagem (a válvula da Teacher Vicky).
//
// ── POR QUE ESCRITA DIRETA, E NÃO RPC (Lei 3, lida com atenção) ─────────────
// A regra mora no banco (migration 20260803000300): motivo obrigatório e
// não-branco (`content_trends_descartada_shape`), ator+timestamp juntos
// (`content_trends_decidida_shape`), linha decidida imutável, medição congelada
// por whitelist do guard, DELETE proibido — e a CASCATA às variações novas é
// trigger, não código daqui. O que sobraria para uma RPC seria repetir um
// UPDATE sem lock, sem faixa e sem dinheiro. Escrita direta pela sessão (a
// policy `content_trends_admin_all` decide) é o padrão da casa — o mesmo da
// Pauta.
//
// ── O QUE ESTAS VALIDAÇÕES SÃO, E O QUE NÃO SÃO ────────────────────────────
// Antecipação de FRASE, nunca segunda gramática: cada recusa abaixo tem a
// recusa correspondente no banco, e se a antecipação falhasse o UPDATE seria
// barrado igual — só com um texto pior.
//
// ── O DESFECHO É TOAST, E NADA DELE ENCOSTA NA URL ─────────────────────────
// Mesmo mecanismo da Pauta: frase em cookie de vida curta (`@/lib/kit/recado`,
// seção `conteudo`, subrota `radar`), pintada pelo `AvisoLegado`. Recusa do
// banco TRADUZIDA por `fraseDaRecusaDoBanco` — nome de constraint não é
// assunto da dona. Na volta de ERRO o painel reabre com o motivo digitado
// (rascunho em cookie `httpOnly`, chave POR TREND).
//
// ⚠️ As frases de desfecho são LITERAIS aqui, não importadas da gramática: o
// varredor de `tests/portal-nav.test.ts` lê a fonte DESTE arquivo para cobrar
// a classificação de cada uma em `tom-do-aviso.ts`.

import { redirect } from 'next/navigation'

import { requireAdminId } from '@/lib/auth/admin'
import { esquecerRascunho, gravarRascunho } from '@/lib/admin/rascunho-do-formulario'
import { getTrendParaRoteiro } from '@/data/admin/radar'
import { ehContextoDoRoteiro } from '@/lib/content/contexto'
import { generateReelScript } from '@/lib/content/generate'
import { createClient } from '@/lib/supabase/server'
import {
  CASA_DO_RADAR,
  NOTA_MAXIMA,
  NOTA_MINIMA,
  fraseDaRecusaDoBanco,
} from '@/data/admin/radar-gramatica'
import { PONTE_LEGADA, destinoDaSecao, destinoDoRecado, gravarRecado } from '@/lib/kit/recado'

/** A seção desta tela — ela decide o cookie e o `path` estreito do recado. */
const SECAO = 'conteudo' as const

/** Volta com o desfecho no cookie. A URL não carrega recado nenhum. */
async function backTo(formData: FormData, msg: string): Promise<never> {
  await esquecerRascunho(String(formData.get('rascunho') ?? '').trim())
  // Com DESTINO: a seção `conteudo` tem telas que ainda falam pela ponte
  // `?msg=` (o Estúdio, o detalhe do post) e não leem este cookie. Amarrar o
  // recado ao Radar impede que ele fique pendurado esperando uma tela que
  // nunca vai pintá-lo.
  await gravarRecado(SECAO, msg, CASA_DO_RADAR)
  redirect(destinoDoRecado(SECAO, String(formData.get('back') ?? '')))
}

/** Volta de ERRO: o painel reabre com o que ela digitou (ver o cabeçalho). */
async function falhou(formData: FormData, msg: string): Promise<never> {
  const alvo = destinoDaSecao(
    SECAO,
    String(formData.get('back_erro') ?? '') || String(formData.get('back') ?? ''),
  )
  const [caminho, queryCrua = ''] = alvo.split('?')
  const p = new URLSearchParams(queryCrua)
  for (const k of PONTE_LEGADA) p.delete(k)

  const chave = String(formData.get('rascunho') ?? '').trim()
  const guardados: Record<string, string> = {}
  for (const campo of String(formData.get('manter') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const v = formData.get(campo)
    // Nada do que foi digitado encosta na URL: sai da query, vai para o cookie.
    p.delete(campo)
    if (typeof v === 'string' && v.trim() !== '') guardados[campo] = v
  }
  if (chave) await gravarRascunho(chave, guardados)
  else await esquecerRascunho('')

  await gravarRecado(SECAO, msg, caminho === CASA_DO_RADAR ? CASA_DO_RADAR : undefined)
  const query = p.toString().replace(/\+/g, '%20')
  // Concatenação e não template: o varredor de frases lê os literais deste
  // módulo, e um template entraria na lista como se fosse recado de tela.
  redirect(query ? caminho + '?' + query : caminho)
}

/**
 * A volta de SUCESSO da geração: o detalhe do post, pela ponte legada `?msg=`.
 *
 * ⚠️ DUAS PONTES NESTE ARQUIVO, de propósito. O radar fala por cookie (ele sabe
 * pintar o recado); o DETALHE DO POST ainda não migrou e só entende `?msg=` —
 * mandar cookie para lá deixaria a frase pendurada esperando uma tela que nunca
 * a pinta. É a mesma razão pela qual `/admin/conteudo/<uuid>` está fora de
 * SUBROTAS em `@/lib/kit/recado`. Migrar o detalhe é assunto da Leva 7.
 */
function toPost(id: string, msg: string): never {
  redirect('/admin/conteudo/' + id + '?msg=' + encodeURIComponent(msg) + '&n=' + Date.now())
}

/**
 * "Gerar roteiro" — o FIM DO PORTÃO 1 (ADR-032 decisão 5 · ADR-035).
 *
 * Escolher a trend É a aprovação: a RPC cria o post já aprovado e carimba a
 * trend, numa transação; a action então chama o gerador do M2, INTACTO, e a
 * Teacher Vicky vê o rascunho na volta (síncrona de propósito).
 *
 * ── A ORDEM DOS PRÉ-VOOS NÃO É ARBITRÁRIA ──────────────────────────────────
 * Sem chave da API a recusa vem ANTES da RPC: post criado que nunca vai gerar é
 * lixo com carimbo de aprovação, e a trend teria queimado a decisão dela por
 * nada. Depois da RPC não há volta — a transação já foi.
 *
 * ── TETO ESTOURADO NÃO É ERRO ──────────────────────────────────────────────
 * O post fica na fila em `ideia_aprovada` e a vassoura das 12:00 UTC gera de
 * manhã. A Teacher Vicky volta ao radar (o deck continua), não ao detalhe de um post
 * que ainda não tem rascunho para mostrar.
 */
export async function gerarRoteiroDaTrendAction(formData: FormData) {
  await requireAdminId()

  const alvo = String(formData.get('alvo') ?? '').trim()
  if (!alvo) {
    await falhou(formData, 'Falha: trend não identificada — recarregue a página.')
  }

  // O destino vem da ABA (campo escondido), não de uma pergunta nova: contexto
  // fora do par é tela desatualizada, não escolha da dona.
  const contexto = String(formData.get('contexto') ?? '').trim()
  if (!ehContextoDoRoteiro(contexto)) {
    await falhou(formData, 'Falha: não entendi de qual aba veio o pedido — recarregue a página.')
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await falhou(
      formData,
      'Falha: a geração está desligada no servidor — nada foi criado e a trend continua na fila.',
    )
  }

  const trend = await getTrendParaRoteiro(alvo)
  // `return` inalcançável (o `falhou` redireciona, e redirect() lança): ele está
  // aqui só para o TypeScript estreitar o tipo — `Promise<never>` não estreita.
  if (!trend) {
    await falhou(formData, 'Falha: essa trend não está mais disponível — recarregue a página.')
    return
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('gerar_roteiro_da_trend', {
    p_trend_id: alvo,
    p_contexto: contexto,
    p_tema: trend.tema,
    p_gancho: trend.gancho,
    p_idea: trend.idea,
  })
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))
  const criado = (data as { post_id: string; gerar_agora: boolean }[] | null)?.[0]
  if (!criado) {
    await falhou(formData, 'Falha: o roteiro não foi criado e nada mudou — tente de novo.')
    return
  }

  if (!criado.gerar_agora) {
    await backTo(
      formData,
      'Roteiro na fila: o teto de roteiros de hoje já foi atingido — a rotina da manhã gera este.',
    )
  }

  try {
    // A vaga do teto já foi reservada DENTRO da RPC (o post saiu em `gerando`,
    // tentativa 1) — reivindicar de novo aqui daria conflito com o próprio
    // pedido. Ver o cabeçalho da migration 20260803000400.
    const res = await generateReelScript(supabase, criado.post_id, { jaReivindicado: 1 })
    if (res.ok) toPost(criado.post_id, 'Rascunho gerado — revise, edite e aprove. ✔')
    // ⚠️ AS FALHAS QUE VÃO PARA O DETALHE DO POST COMEÇAM COM "Falha": lá quem
    // pinta é o `FlashMsg`, que decide a cor por `^falha|^não deu` — frase de
    // erro sem esse começo sai VERDE, com cara de que deu certo.
    if (res.reason === 'sem_voz') {
      toPost(
        criado.post_id,
        'Falha: publique a voz da marca no Estúdio antes de gerar — o roteiro ficou na fila.',
      )
    }
    if (res.reason === 'conflict') {
      toPost(criado.post_id, 'Falha: alguém já está gerando este roteiro — recarregue a página.')
    }
    toPost(criado.post_id, `Falha na geração: ${res.detalhe}`)
  } catch (err) {
    // redirect() do Next viaja como exceção — nunca traduzir para "falha".
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    toPost(criado.post_id, `Falha na geração: ${(err as Error).message}`)
  }
}

/**
 * Descarta a trend com motivo — UPDATE numa instrução só (status + motivo +
 * ator + carimbo), porque o `decidida_shape` é bicondicional e não há default
 * de `decidida_em` no banco. A cascata às variações novas é do banco; esta
 * action não a menciona nem a simula — o cartão avisa antes.
 */
export async function descartarTrendAction(formData: FormData) {
  const ator = await requireAdminId()

  const alvo = String(formData.get('alvo') ?? '').trim()
  if (!alvo) {
    await falhou(formData, 'Falha: trend não identificada — recarregue a página.')
  }

  const motivo = String(formData.get('motivo') ?? '').trim()
  if (motivo === '') {
    await falhou(formData, 'Falha: escreva o motivo do descarte — ele fica no histórico da trend.')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_trends')
    .update({
      status: 'descartada',
      discard_reason: motivo,
      decidida_por: ator,
      decidida_em: new Date().toISOString(),
    })
    .eq('id', alvo)
    // O filtro por `nova` transforma a corrida (outra aba decidiu antes) em
    // "0 linhas" — e a frase honesta abaixo — em vez do erro cru do guard.
    .eq('status', 'nova')
    .select('id')
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))
  if (!data || data.length === 0) {
    await falhou(formData, 'Falha: essa trend já foi decidida em outra aba — recarregue a página.')
  }

  await backTo(formData, 'Trend descartada — o motivo fica no histórico.')
}

/**
 * Ajusta (ou limpa) `travel_score_ajustado` — a válvula da Teacher Vicky, que vence a
 * nota do robô SEMPRE (ADR-033 decisão 4). Escrita direta pelo mesmo racional
 * do descarte: o grant de coluna e o guard de terminal moram no banco, e a
 * auditoria é o trigger. A intenção vem do BOTÃO (`acao`): "campo vazio =
 * limpar" apagaria a válvula num Enter afobado.
 */
export async function ajustarNotaAction(formData: FormData) {
  await requireAdminId()

  const alvo = String(formData.get('alvo') ?? '').trim()
  if (!alvo) {
    await falhou(formData, 'Falha: trend não identificada — recarregue a página.')
  }

  const acao = String(formData.get('acao') ?? '').trim()
  let valor: number | null = null
  if (acao === 'definir') {
    const cru = String(formData.get('nota') ?? '').trim()
    if (cru === '') {
      await falhou(formData, 'Falha: escreva a nota de viagem — um número inteiro de 0 a 100.')
    }
    // Regex, não Number(): '1e2', '12.5' e '-1' são recusas, nunca palpites.
    const n = Number(cru)
    if (!/^\d{1,3}$/.test(cru) || n < NOTA_MINIMA || n > NOTA_MAXIMA) {
      await falhou(formData, 'Falha: a nota de viagem é um número inteiro de 0 a 100.')
    }
    valor = n
  } else if (acao !== 'limpar') {
    await falhou(formData, 'Falha: não entendi o que fazer com a nota — recarregue a página.')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_trends')
    .update({ travel_score_ajustado: valor })
    .eq('id', alvo)
    // O filtro por `nova` transforma a corrida (outra aba decidiu antes) em
    // "0 linhas" em vez do raise "imutável (Lei 8)" do guard — decisão encerra
    // a curadoria (ADR-037 decisão 7).
    .eq('status', 'nova')
    .select('id')
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))
  if (!data || data.length === 0) {
    await falhou(formData, 'Falha: essa trend já foi decidida em outra aba — recarregue a página.')
  }

  if (valor === null) {
    await backTo(formData, 'Ajuste de nota removido — volta a valer a nota do robô.')
  }
  await backTo(formData, 'Nota de viagem ajustada — a sua nota vale no lugar da nota do robô.')
}
