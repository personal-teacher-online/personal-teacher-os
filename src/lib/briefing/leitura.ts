// LEITURA HUMANA das respostas do briefing (sub-lote 3 da onda do Portal).
//
// O jsonb de `briefings.answers` é o mesmo nas duas versões do questionário, mas
// a FORMA de cada resposta mudou: o que era texto livre no v1 virou múltipla
// escolha (array) ou sim-não + detalhe no v2. Quem lê — a ficha da admin e o
// painel da professora — não pode ter dois caminhos, nem imprimir `[object
// Object]`/`JSON.stringify` na cara de quem trabalha.
//
// Este módulo é PURO (nada de React, nada de banco) por dois motivos: a ficha o
// usa dentro de um Server Component, e o Vitest consegue provar cada forma sem
// levantar tela. O enunciado NUNCA nasce aqui: vem do dicionário
// (`entradaDaChave`), que é a mesma fonte que a tela de coleta usa para
// PERGUNTAR — pergunta e leitura não podem divergir.

import {
  BRIEFING_ETAPAS,
  ROTINA_BLOCOS,
  ROTINA_DIAS,
  entradaDaChave,
  respondido,
  type SecaoBriefing,
  type VersaoBriefing,
} from './schema'

/* ========================================================================== */
/* Formas                                                                      */
/* ========================================================================== */

export function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const SECOES: readonly string[] = ['historia', 'objetivos', 'interesses', 'rotina', 'livre']

export function ehSecaoBriefing(v: string | undefined): v is SecaoBriefing {
  return !!v && SECOES.includes(v)
}

/**
 * As seções de RESPOSTA, na ordem em que o aluno responde, com o título humano
 * de cada uma. Sai do mesmo `BRIEFING_ETAPAS` que numera as etapas do portal
 * (fonte única) — o Kolb fica de fora porque ele não é resposta escrita: é
 * instrumento, e a ficha o lê pelo estilo calculado.
 */
export const SECOES_DE_RESPOSTA: { secao: SecaoBriefing; titulo: string }[] = BRIEFING_ETAPAS.flatMap(
  (e) => (ehSecaoBriefing(e.slug) ? [{ secao: e.slug, titulo: e.titulo }] : []),
)

/** A seção pedida do `answers`, sempre como objeto (ausente vira vazio). */
export function secaoDoBriefing(answers: unknown, secao: string): Record<string, unknown> {
  const a = ehObjeto(answers) ? answers : {}
  const s = a[secao]
  return ehObjeto(s) ? s : {}
}

/** Os itens de texto de um valor de lista (qualquer outra coisa vira lista vazia). */
export function listaDeTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.map((v) => textoDaResposta(v)).filter((v) => v !== '')
}

/**
 * Uma resposta qualquer pronta para LER. Nenhum ramo cai em `JSON.stringify`:
 * lista vira "a · b · c" (o separador da casa), objeto inesperado vira
 * "chave: valor · chave: valor", e número/booleano de dado legado aparecem como
 * estão — esconder o que veio torto é pior do que mostrá-lo torto.
 */
export function textoDaResposta(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  if (Array.isArray(valor)) return listaDeTexto(valor).join(' · ')
  if (ehObjeto(valor)) {
    return Object.entries(valor)
      .map(([k, v]) => {
        const t = textoDaResposta(v)
        return t ? `${k}: ${t}` : ''
      })
      .filter(Boolean)
      .join(' · ')
  }
  return ''
}

/* ========================================================================== */
/* Pares pergunta → resposta                                                   */
/* ========================================================================== */

export interface ParDeResposta {
  /** a chave crua do jsonb (é ela que aparece quando o dicionário não conhece) */
  chave: string
  /** a pergunta por extenso; `null` quando a chave não está no dicionário */
  enunciado: string | null
  /** o valor CRU — a grade da rotina precisa dele */
  valor: unknown
  /** o mesmo valor pronto para ler */
  texto: string
}

/** Sufixo do campo que complementa uma resposta sim-não (`leitura_detalhe`). */
const DETALHE = '_detalhe'

/**
 * As respostas de uma seção viradas para a leitura, na ordem em que estão
 * gravadas (nada é escondido: chave que o dicionário não conhece sai com
 * `enunciado: null` e a tela mostra a chave crua).
 *
 * Duas junções acontecem aqui, e as duas existem porque a PERGUNTA é uma só:
 * · sim-não + detalhe (`leitura` + `leitura_detalhe`) viram "sim — fantasia";
 *   o campo de detalhe não vira linha própria.
 */
export function paresDaSecao(
  secao: Record<string, unknown>,
  versao: VersaoBriefing,
): ParDeResposta[] {
  const pares: ParDeResposta[] = []
  for (const [chave, valor] of Object.entries(secao)) {
    // detalhe de uma pergunta que está na seção não vira linha: ele se junta à
    // resposta dela, logo abaixo.
    if (chave.endsWith(DETALHE) && chave.slice(0, -DETALHE.length) in secao) continue

    const detalhe = textoDaResposta(secao[`${chave}${DETALHE}`])
    const base = textoDaResposta(valor)
    pares.push({
      chave,
      enunciado: entradaDaChave(chave, versao)?.enunciado ?? null,
      valor,
      texto: detalhe ? (base ? `${base} — ${detalhe}` : detalhe) : base,
    })
  }
  return pares
}

/* ========================================================================== */
/* A grade da rotina                                                           */
/* ========================================================================== */

export interface GradeDaRotina {
  dias: string[]
  linhas: { bloco: string; marcado: boolean[] }[]
}

/**
 * `rotina.blocos` (`{ seg: ['Noite'], … }`) virado na MESMA grade dias × blocos
 * que o aluno preencheu — versão leitura.
 *
 * Dias e blocos saem da UNIÃO entre a lista canônica e o que o dado traz: se um
 * briefing antigo gravou "noite" em minúscula, a linha aparece assim mesmo, no
 * fim. Filtrar pela lista canônica sumiria com a resposta da pessoa.
 * `null` quando não há grade nenhuma (o valor não é objeto, ou está vazio).
 */
export function gradeDaRotina(valor: unknown): GradeDaRotina | null {
  if (!ehObjeto(valor)) return null
  const porDia = new Map<string, string[]>()
  for (const [dia, blocos] of Object.entries(valor)) porDia.set(dia, listaDeTexto(blocos))

  const extras = <T extends string>(canonicos: readonly T[], achados: string[]): string[] => [
    ...canonicos.filter((c) => achados.includes(c)),
    ...achados.filter((a) => !(canonicos as readonly string[]).includes(a)),
  ]

  const diasComAlgo = [...porDia.entries()].filter(([, b]) => b.length > 0).map(([d]) => d)
  if (diasComAlgo.length === 0) return null
  const blocosAchados = Array.from(new Set([...porDia.values()].flat()))

  // As colunas ficam SEMPRE na semana inteira (a grade da coleta tem 7 dias, e
  // uma tabela com só os dias marcados esconderia quais ficaram de fora); as
  // linhas trazem só os blocos que alguém marcou, mais os fora-do-catálogo.
  const dias = extras(ROTINA_DIAS, [...ROTINA_DIAS, ...diasComAlgo])
  const blocos = extras(ROTINA_BLOCOS, blocosAchados)
  return {
    dias,
    linhas: blocos.map((bloco) => ({
      bloco,
      marcado: dias.map((dia) => (porDia.get(dia) ?? []).includes(bloco)),
    })),
  }
}

/* ========================================================================== */
/* O resumo que a professora lê                                                */
/* ========================================================================== */

export interface ResumoDoBriefing {
  /** até 6 hobbies (mesma chave no v1 e no v2 — sempre lista) */
  hobbies: string[]
  /** para que ele quer o inglês: `finalidades` (adulto) ou `para_que_ingles`
   *  (criança, v2). Texto no v1, lista no v2 — sai formatado nos dois casos. */
  finalidades: string
}

/** Teto do texto de finalidades no cartão da professora (era `.slice(0, 160)`). */
const TETO_DAS_FINALIDADES = 160

/**
 * O briefing como o painel da professora o lê. Existe para que a página dela
 * não cite chave literal nenhuma: com dado v2 a leitura antiga
 * (`typeof finalidades === 'string'`) simplesmente não desenhava nada.
 */
export function resumoDoBriefing(answers: unknown): ResumoDoBriefing {
  const interesses = secaoDoBriefing(answers, 'interesses')
  const objetivos = secaoDoBriefing(answers, 'objetivos')
  const finalidades = textoDaResposta(objetivos.finalidades ?? objetivos.para_que_ingles)
  return {
    hobbies: listaDeTexto(interesses.hobbies).slice(0, 6),
    finalidades: finalidades.slice(0, TETO_DAS_FINALIDADES),
  }
}

/* ========================================================================== */
/* O patch da correção                                                         */
/* ========================================================================== */

/** Mudou de verdade? Dois vazios (ausente × "" × lista vazia) não são correção. */
function mudou(antes: unknown, depois: unknown): boolean {
  if (!respondido(antes) && !respondido(depois)) return false
  return JSON.stringify(antes ?? null) !== JSON.stringify(depois ?? null)
}

/**
 * O patch de `admin_revise_briefing`: SÓ as chaves cujo valor mudou.
 *
 * O formulário da correção reenvia a seção inteira (são os mesmos campos da
 * coleta, pré-preenchidos), e mandar tudo faria o histórico registrar como
 * "correção" cada resposta que ninguém tocou. Quem tem a última palavra continua
 * sendo o banco (Lei 3): patch vazio vira `{secao: {}}` e a RPC recusa com a
 * frase dela ("os valores enviados são iguais aos atuais").
 */
export function montarPatchDeRevisao(atual: unknown, novo: unknown): Record<string, unknown> {
  const antes = ehObjeto(atual) ? atual : {}
  const depois = ehObjeto(novo) ? novo : {}
  const patch: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(depois)) {
    if (mudou(antes[chave], valor)) patch[chave] = valor
  }
  return patch
}
