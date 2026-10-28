// O MAPA DE ENCAMINHAMENTO DA TELA VELHA (Onda 1 · M4-4).
//
// `/admin/contratos` era a lista de contratos: 814 linhas que faziam sete
// leituras inline, desenhavam cartões com um `Drawer` do kit velho e abriam DOIS
// formulários de criação por `?novo=`. Tudo isso foi reconstruído — o índice na
// aba `/admin/alunos/contratos` (M4-1), o detalhe em `/admin/contratos/[id]`
// (M4-2) e a criação no wizard `/admin/contratos/novo` (M4-3). O que sobra do
// endereço velho é ESTE mapa, e é ele que o `page.tsx` executa antes de um
// `permanentRedirect` (308).
//
// POR QUE UM MÓDULO PURO, e não um punhado de `if` dentro da página: link velho
// é dado de fora (favorito da dona, e-mail antigo, botão de outra tela que
// escapou da varredura). Encaminhamento é REGRA, e regra sem teste é promessa.
// Aqui não há acesso a banco, cookie nem relógio: entra o que veio na query,
// sai uma string — e o teste do M4-4 percorre a tabela caso a caso.
//
// NÃO É AFETADO por este mapa: `/admin/contratos/[id]` e `/admin/contratos/novo`.
// O `page.tsx` de um segmento no App Router só casa o segmento EXATO, e as duas
// sub-rotas têm página própria.

import { ehFiltroDeContrato, ehVisaoDeContratos } from './contratos-gramatica'
import { ehRamoDeContrato, enderecoDoNovoContrato } from './contrato-novo'

/** O índice novo — a casa de quem só queria "ver os contratos". */
export const INDICE_DE_CONTRATOS = '/admin/alunos/contratos'

/**
 * O que a tela velha punha na URL. Tudo opcional: o caso mais comum é
 * `/admin/contratos` pelado.
 *
 * CADA CAMPO ACEITA LISTA (c12 · nº 20). Não é generosidade: é o tipo que o
 * App Router entrega. `searchParams` do Next é
 * `Record<string, string | string[] | undefined>` — `?q=Ana&q=Bia` chega como
 * `['Ana','Bia']`, e a versão anterior desta função, tipada como `string`,
 * fazia o TypeScript acreditar numa promessa que o framework não faz. Em tempo
 * de execução o array escorregava até `p.set('q', ['Ana','Bia'])`, que o
 * `URLSearchParams` serializa como `q=Ana%2CBia` — uma busca por um nome que
 * não existe. Pior no `?novo=`: `'individual,grupo'` não é ramo nenhum, e o
 * link de criação caía calado no índice.
 */
export interface QueryDaTelaVelha {
  /** `individual` | `grupo` — abria o painel de criação */
  novo?: string | string[]
  /** busca por nome do aluno/turma */
  q?: string | string[]
  /** recorte de situação: `active` | `paused` (ausente = todos) */
  st?: string | string[]
  /** organização da lista: `professora` | `nivel` (ausente = lista) */
  ver?: string | string[]
  /** recado de uma action velha, e o nonce que o repete */
  msg?: string | string[]
  n?: string | string[]
}

/**
 * O PRIMEIRO valor de uma chave repetida — e `undefined` quando não há nenhum.
 *
 * Por que o primeiro, e não o último: é o que a barra de endereço mostra
 * primeiro e o que qualquer leitor humano lê como "o" valor. Não há caso de uso
 * legítimo para chave repetida nesta tela (nenhum formulário dela a produzia);
 * o que existe é link torto e URL montada à mão. Escolher uma régua explícita e
 * testá-la é o que impede a decisão de virar acidente de serialização.
 */
function primeiro(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * `?novo=` da tela velha → `?tipo=` do wizard.
 *
 * São vocabulários DIFERENTES de propósito: o velho nomeava qual dos dois
 * formulários abrir; o novo nomeia o RAMO do contrato (a gramática de
 * `contrato-novo.ts`, que tem três — `individual`, `grupo`, `mentoria`). A
 * tabela existe para essa tradução ficar explícita em vez de coincidência de
 * grafia. `grupo` do velho é o mesmo `grupo` do wizard; `individual` idem;
 * mentoria nunca teve porta na tela velha e por isso não aparece aqui.
 */
export const NOVO_PARA_RAMO = {
  individual: 'individual',
  grupo: 'grupo',
} as const satisfies Record<string, string>

/**
 * PARA ONDE VAI UM ENDEREÇO VELHO.
 *
 * | chegava em `/admin/contratos` | vai para |
 * | --- | --- |
 * | (nada) | `/admin/alunos/contratos` |
 * | `?novo=individual` | `/admin/contratos/novo?tipo=individual` |
 * | `?novo=grupo` | `/admin/contratos/novo?tipo=grupo` |
 * | `?novo=<qualquer outra coisa>` | `/admin/alunos/contratos` (o índice; nunca um wizard sem tipo válido) |
 * | `?q=` `?st=` `?ver=` | `/admin/alunos/contratos` com os MESMOS valores |
 * | `?msg=…&n=…` | `/admin/alunos/contratos?msg=…&n=…` (vira toast pelo `AvisoLegado`) |
 *
 * DUAS DECISÕES QUE ESTA FUNÇÃO TOMA, ditas em voz alta:
 *
 * 1. `st` e `ver` só viajam se forem valores que a tela NOVA entende
 *    (`ehFiltroDeContrato`/`ehVisaoDeContratos`). O vocabulário do `?ver=` velho
 *    (lista·professora·nível) é subconjunto do novo, então nada se perde; lixo
 *    na query cai no padrão em vez de virar estado inválido.
 * 2. RECADO GANHA DO WIZARD: se vierem `msg` e `novo` juntos, o destino é o
 *    índice. O `msg` é a resposta de uma ação que ACABOU de acontecer e só o
 *    índice a mostra (o wizard não tem `AvisoLegado`); mandar para o wizard
 *    engoliria em silêncio um "Falha: …". Na prática a combinação nunca
 *    existiu — os links de `?novo=` da tela velha não carregavam `msg`, e as
 *    actions não carregavam `novo` —, mas silêncio não é um destino aceitável.
 */
export function destinoDoLegado(query: QueryDaTelaVelha): string {
  // c12 · nº 20: a query é NORMALIZADA na entrada, uma vez só. Daqui para baixo
  // tudo é `string | undefined`, e nenhuma linha precisa lembrar do array.
  const novo = primeiro(query.novo)
  const q = primeiro(query.q)
  const st = primeiro(query.st)
  const ver = primeiro(query.ver)
  const msg = primeiro(query.msg)
  const n = primeiro(query.n)

  const p = new URLSearchParams()
  if (msg) {
    p.set('msg', msg)
    if (n) p.set('n', n)
  }

  const ramo = ramoDoNovo(novo)
  if (ramo && !msg) {
    return enderecoDoNovoContrato(ramo)
  }

  if (q) p.set('q', q)
  // `todos` e `lista` são os padrões da tela nova: mandá-los na URL só faria um
  // endereço mais comprido dizendo a mesma coisa.
  if (ehFiltroDeContrato(st) && st !== 'todos') p.set('st', st)
  if (ehVisaoDeContratos(ver) && ver !== 'lista') p.set('ver', ver)

  const s = p.toString()
  return s ? `${INDICE_DE_CONTRATOS}?${s}` : INDICE_DE_CONTRATOS
}

/** A tradução do `?novo=`, isolada para o teste poder percorrer a tabela. */
export function ramoDoNovo(novo: string | string[] | undefined | null) {
  const um = primeiro(novo ?? undefined)
  if (!um) return null
  const traduzido = (NOVO_PARA_RAMO as Record<string, string>)[um]
  return ehRamoDeContrato(traduzido) ? traduzido : null
}
