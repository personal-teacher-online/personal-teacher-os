'use server'

// AS AÇÕES DA PAUTA (frente de conteúdo · M4) — cadastrar, editar e tirar de
// cena um criador de referência.
//
// ── POR QUE ESCRITA DIRETA, E NÃO RPC (Lei 3, lida com atenção) ─────────────
// A Lei manda a REGRA morar no banco, e ela mora: whitelist de plataforma e
// mercado, formato do handle, unicidade por rede, DELETE proibido, auditoria —
// tudo em CHECK, índice e trigger da migration 20260801000100, mais os grants
// de COLUNA que impedem esta tela de encostar em `metricas`/`medido_em` mesmo
// se alguém escrever o campo aqui por engano. O que sobraria para uma RPC seria
// repetir um INSERT sem lock, sem faixa e sem dinheiro. Escrita direta pela
// sessão (a policy `content_creators_admin_all` decide) é o padrão da casa para
// cadastro — o mesmo de `admin/conteudo/actions.ts`.
//
// ── O QUE ESTAS VALIDAÇÕES SÃO, E O QUE NÃO SÃO ────────────────────────────
// Antecipação de FRASE, nunca segunda gramática: cada recusa abaixo tem a
// recusa correspondente no banco, e se a antecipação falhasse o INSERT seria
// barrado igual — só com um texto pior. `normalizarHandle` é a única que muda
// dado: tira o `@` e o espaço que todo mundo copia junto. URL colada NÃO é
// consertada (ver o porquê na gramática) — ela chega ao banco e volta recusada.
//
// ── O DESFECHO É TOAST, E NADA DELE ENCOSTA NA URL ─────────────────────────
// Mesmo mecanismo do A8: a frase vai num cookie de vida curta (`@/lib/kit/recado`,
// seção `conteudo`, subrota `pauta`) e quem a pinta é o `AvisoLegado`. A recusa
// do banco é TRADUZIDA por `fraseDaRecusaDoBanco` — nome de constraint não é
// assunto da dona. Na volta de ERRO o formulário reabre com o que ela digitou
// (rascunho em cookie `httpOnly`, chave POR CRIADOR).
//
// ⚠️ As frases de acerto são LITERAIS aqui, não importadas da gramática: o
// varredor de `tests/portal-nav.test.ts` lê a fonte DESTE arquivo para cobrar a
// classificação de cada uma em `tom-do-aviso.ts`. Frase importada sairia do
// alcance dele — e acerto fora da lista de tom sai vermelho.

import { redirect } from 'next/navigation'

import { requireAdminId } from '@/lib/auth/admin'
import { esquecerRascunho, gravarRascunho } from '@/lib/admin/rascunho-do-formulario'
import { createClient } from '@/lib/supabase/server'
import {
  CASA_DA_PAUTA,
  ehHandle,
  ehPais,
  ehPlataforma,
  ehTier,
  ehTipo,
  fraseDaRecusaDoBanco,
  normalizarHandle,
} from '@/data/admin/pauta-gramatica'
import { PONTE_LEGADA, destinoDaSecao, destinoDoRecado, gravarRecado } from '@/lib/kit/recado'

/** A seção desta tela — ela decide o cookie e o `path` estreito do recado. */
const SECAO = 'conteudo' as const

/** Volta com o desfecho no cookie. A URL não carrega recado nenhum. */
async function backTo(formData: FormData, msg: string): Promise<never> {
  // Ato concluído não deixa rascunho para trás — e apaga só o DELE (dívida (a)
  // do A7): o cookie de rascunho é um só para o `/admin` inteiro.
  await esquecerRascunho(String(formData.get('rascunho') ?? '').trim())
  // Com DESTINO: a seção `conteudo` tem outras telas (o Estúdio, o detalhe do
  // post) que ainda falam pela ponte `?msg=` e não leem este cookie. Amarrar o
  // recado à Pauta impede que ele fique pendurado esperando uma tela que nunca
  // vai pintá-lo.
  await gravarRecado(SECAO, msg, CASA_DA_PAUTA)
  redirect(destinoDoRecado(SECAO, String(formData.get('back') ?? '')))
}

/** Volta de ERRO: o formulário reabre com o que ela digitou (ver o cabeçalho). */
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

  await gravarRecado(SECAO, msg, caminho === CASA_DA_PAUTA ? CASA_DA_PAUTA : undefined)
  const query = p.toString().replace(/\+/g, '%20')
  // Concatenação e não template: o varredor de frases lê os literais deste
  // módulo, e `«…»?«…»` entraria na lista como se fosse recado de tela.
  redirect(query ? caminho + '?' + query : caminho)
}

interface Cadastro {
  plataforma: string
  handle: string
  nome: string
  pais: string
  tipo: string
  /** `null` = sem classificação — estado legítimo do banco (Leva 1.2) */
  tier: string | null
  notas: string | null
}

/** Os campos que o banco exige, já normalizados — ou a frase da recusa. */
async function lerCadastro(formData: FormData): Promise<Cadastro> {
  const plataforma = String(formData.get('plataforma') ?? '').trim()
  if (!ehPlataforma(plataforma)) {
    await falhou(formData, 'Falha: escolha uma das plataformas da lista.')
  }

  const handle = normalizarHandle(String(formData.get('handle') ?? ''))
  if (!ehHandle(handle)) {
    await falhou(formData, 'Falha: escreva só o @ do perfil, sem link e sem espaços.')
  }

  const nome = String(formData.get('nome') ?? '').trim()
  if (nome === '') {
    await falhou(formData, 'Falha: escreva o nome do criador.')
  }

  const pais = String(formData.get('pais') ?? '').trim()
  if (!ehPais(pais)) {
    await falhou(formData, 'Falha: escolha se o criador é do Brasil ou internacional.')
  }

  const tipo = String(formData.get('tipo') ?? '').trim()
  if (!ehTipo(tipo)) {
    await falhou(formData, 'Falha: o tipo é criador ou empresa — escolha um dos dois.')
  }

  // Tier VAZIO é escolha legítima ("sem classificação" → NULL no banco); o que
  // não pode é valor fora da lista.
  const tier = String(formData.get('tier') ?? '').trim()
  if (tier !== '' && !ehTier(tier)) {
    await falhou(formData, 'Falha: o tier é grande, média ou nicho — ou fica sem classificação.')
  }

  const notas = String(formData.get('notas') ?? '').trim()
  return {
    plataforma,
    handle,
    nome,
    pais,
    tipo,
    tier: tier === '' ? null : tier,
    notas: notas === '' ? null : notas,
  }
}

/** Cadastra um criador novo. Métricas NÃO entram: elas são do robô (grant de coluna). */
export async function createCreatorAction(formData: FormData) {
  const ator = await requireAdminId()
  const cadastro = await lerCadastro(formData)

  const supabase = await createClient()
  const { error } = await supabase
    .from('content_creators')
    .insert({ ...cadastro, created_by: ator })
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))

  await backTo(formData, 'Criador adicionado à pauta.')
}

/** Edita o cadastro de um criador. `created_by` não vai junto: autoria não se reescreve. */
export async function updateCreatorAction(formData: FormData) {
  await requireAdminId()

  const alvo = String(formData.get('alvo') ?? '').trim()
  if (!alvo) {
    await falhou(formData, 'Falha: criador não identificado — recarregue a página.')
  }
  const cadastro = await lerCadastro(formData)

  const supabase = await createClient()
  const { error } = await supabase.from('content_creators').update(cadastro).eq('id', alvo)
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))

  await backTo(formData, 'Criador atualizado.')
}

/**
 * Tira de cena / traz de volta. É UPDATE de `ativo` — DELETE é proibido (Lei 8)
 * e o guard do banco recusa até para o dono da tabela.
 */
export async function setCreatorAtivoAction(formData: FormData) {
  await requireAdminId()

  const alvo = String(formData.get('alvo') ?? '').trim()
  if (!alvo) {
    await falhou(formData, 'Falha: criador não identificado — recarregue a página.')
  }
  const ativo = String(formData.get('ativo') ?? '') === 'true'

  const supabase = await createClient()
  const { error } = await supabase.from('content_creators').update({ ativo }).eq('id', alvo)
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))

  await backTo(
    formData,
    ativo
      ? 'Criador reativado — volta para a próxima corrida da pesquisa.'
      : 'Criador desativado — o robô de pesquisa deixa de olhar para ele.',
  )
}
