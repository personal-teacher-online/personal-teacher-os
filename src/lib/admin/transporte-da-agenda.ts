// O TRANSPORTE DA SEÇÃO AGENDA — um só, para as três telas (Onda da Agenda · A7).
//
// ══════════════════════════════════════════════════════════════════════════════
// POR QUE ESTE ARQUIVO EXISTE
// ══════════════════════════════════════════════════════════════════════════════
// O A5 blindou UMA action (`registrarDesfechoDaAulaAction`) e deixou escrita a
// dívida, com estas palavras, em `agenda/actions.ts`:
//
//   «⚠️ DÍVIDA NOMEADA DO A7: o `falhou()` compartilhado pelas outras onze
//    actions deste arquivo CONTINUA confiando em `manter`/`na_url`/`back_erro`
//    do cliente, com as duas portas abaixo abertas.»
//
// As duas portas, textualmente, eram:
//   1. `manter=msg&na_url=msg` REINSERIA `msg` na query depois da higienização
//      da ponte — a limpeza era contornável pelo próprio formulário;
//   2. `back_erro=/admin/agenda?off_note=mãe%20internada` voltava intacto,
//      republicando na barra de endereços o texto que o cookie de rascunho
//      existe para tirar de lá.
//
// Server Action é ENDPOINT PÚBLICO: `manter`, `na_url`, `back_erro` e `rascunho`
// são dados do cliente. Este módulo tira os quatro da negociação:
//
//   · a lista de campos que sobrevivem ao erro é do SERVIDOR (`CAMPOS_DA_PORTA`);
//   · a chave do rascunho é DERIVADA do destino (`chaveDoDestino`) — não lida;
//   · o destino é RECONSTRUÍDO: caminho fixo da tela + allowlist de geometria,
//     validada por TIPO. Nada que a dona digitou tem como viajar na URL.
//
// ══════════════════════════════════════════════════════════════════════════════
// A INVARIANTE QUE ESTE DESENHO COMPRA
// ══════════════════════════════════════════════════════════════════════════════
// **A chave do rascunho é uma FUNÇÃO do destino reconstruído.**
//
// Não é elegância: é o conserto de uma classe de defeito que a onda já pagou. No
// A4, `painelDeErro()` teve de aprender a carregar `nd`/`nt` porque, sem eles, a
// volta de erro caía numa chave DIFERENTE da que a action tinha acabado de
// gravar — e o painel voltava vazio, em silêncio, depois de a dona ter digitado
// tudo. Com a chave derivada do destino, escritor e leitor não têm como
// divergir: quem decide para onde ela vai é quem decide sob que nome o rascunho
// foi guardado.
//
// ══════════════════════════════════════════════════════════════════════════════
// SÓ FUNÇÃO — SEM COOKIE, SEM `redirect`
// ══════════════════════════════════════════════════════════════════════════════
// Quem escreve o endereço é a ACTION; quem o RECONSTRÓI para conferir de quem é
// o recado é a PÁGINA. As duas pontas são servidor, e as duas precisam da MESMA
// função — é ela que faz "este recado é do endereço em que estou" ser uma
// COMPARAÇÃO em vez de uma esperança (a dívida (b) do A7: o recado repintando a
// cada navegação da seção dentro dos 15 s).
//
// Por isso aqui não há efeito: nada de `cookies()`, nada de `redirect()`. Quem
// os chama são `agenda/actions.ts` (escrita) e as três páginas (leitura). Sem
// `server-only` porque as duas pontas já são de servidor — mas também sem
// `'use client'`: este módulo importa `@/lib/kit/recado`, que fala com
// `next/headers`, e não atravessa a fronteira do cliente. O vocabulário que o
// CLIENTE precisa (as intenções do slot, as chaves de rascunho) mora em módulos
// próprios, e é de lá que os dois lados o leem.

import { DateTime } from 'luxon'

import {
  CHAVE_DO_PERIODO,
  chaveDoBalao,
  chaveDoDesfecho,
  chaveDoPainel,
  chaveDoRemarcar,
} from './chaves-de-rascunho'
import { casaDaSecao } from '@/lib/kit/recado'
import { ehVisaoDaAgenda } from '@/data/admin/agenda-endereco'
import { INTENCOES_DO_SLOT } from './intencoes-do-slot'

/* ========================================================================== */
/* 1. AS TRÊS TELAS DA SEÇÃO                                                   */
/* ========================================================================== */

/**
 * As telas que a seção Agenda tem — e é exatamente a lista que o porteiro do
 * recado conhece (`SUBROTAS.agenda` em `src/lib/kit/recado.ts`). União fechada:
 * tela nova entra aqui E lá, junto com o arquivo de página.
 */
export type TelaDaAgenda =
  | { tela: 'casa' }
  | { tela: 'periodo' }
  /** o id vai no CAMINHO, então ele é conferido antes de virar endereço */
  | { tela: 'remarcar'; instance: string }

/**
 * O conjunto SEGURO de caracteres de um id que entra num caminho de URL — o
 * mesmo critério que `aplicarOpcoesDaRemarcacaoAction` já usava, e pela mesma
 * razão escrita lá: o que precisa ser barrado é `/`, `?`, `#` e espaço (nada de
 * atravessar rota). Exigir 36 hexadecimais amarraria a seção ao formato atual
 * de chave sem proteger mais ninguém.
 */
export const ID_NO_CAMINHO = /^[A-Za-z0-9._-]{1,64}$/

export function caminhoDaTela(t: TelaDaAgenda): string {
  const casa = casaDaSecao('agenda')
  if (t.tela === 'periodo') return `${casa}/periodo`
  if (t.tela === 'remarcar') return `${casa}/remarcar/${t.instance}`
  return casa
}

/* ========================================================================== */
/* 2. A GEOMETRIA QUE PODE VOLTAR NA URL — allowlist por TIPO                  */
/* ========================================================================== */

/** Teto de tamanho de qualquer valor de geometria. */
const TETO_DA_GEOMETRIA = 120

/** `j` só existe para DESLIGAR a camada de janelas (`j !== '0'` = ligada). */
const VALORES_DE_J = new Set(['0', '1'])

const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Os painéis `?novo=` que a casa abre — lista fechada (a mesma da página). */
export const PAINEIS = ['avulsa', 'experimental', 'horario', 'disponibilidade'] as const

const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/
const HORA_CIVIL = /^\d{2}:\d{2}$/
const SLOT_CIVIL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * O predicado de cada chave de geometria. Chave fora da tabela NÃO EXISTE — a
 * query de volta é montada do zero a partir desta lista, então `msg`/`n` (e
 * qualquer campo digitado pendurado num `back` forjado) não têm por onde entrar.
 * Não é "limpar depois": é "nunca entrar".
 *
 * ⚠️ `q` É O ÚNICO TEXTO LIVRE, e fica de propósito: é o termo que a própria
 * dona digitou na busca da toolbar, e busca por GET põe o termo na URL POR
 * DESENHO (comportamento do A1, anterior a este lote). Teto de tamanho ele tem;
 * texto de OUTRA pessoa (nota, motivo, nome) não entra nesta tabela.
 */
const PREDICADO: Record<string, (v: string) => boolean> = {
  // ---- a geometria da CASA (a tela: onde ela estava olhando) ----------------
  v: (v) => ehVisaoDaAgenda(v),
  d: (v) => DATA_CIVIL.test(v) && DateTime.fromISO(v).isValid,
  prof: (v) => FORMATO_DE_UUID.test(v),
  j: (v) => VALORES_DE_J.has(v),
  q: (v) => v.trim() !== '',
  // ---- a geometria do ERRO na casa (qual formulário reabre) -----------------
  novo: (v) => (PAINEIS as readonly string[]).includes(v),
  nd: (v) => DATA_CIVIL.test(v) && DateTime.fromISO(v).isValid,
  nt: (v) => HORA_CIVIL.test(v),
  slot: (v) => SLOT_CIVIL.test(v),
  si: (v) => (INTENCOES_DO_SLOT as readonly string[]).includes(v),
  ev: (v) => ID_NO_CAMINHO.test(v),
  nc: (v) => ID_NO_CAMINHO.test(v),
  // ---- a geometria do PERÍODO ----------------------------------------------
  de: (v) => DATA_CIVIL.test(v) && DateTime.fromISO(v).isValid,
  ate: (v) => DATA_CIVIL.test(v) && DateTime.fromISO(v).isValid,
  // ---- a geometria do REMARCAR --------------------------------------------
  // Os dois booleanos das opções da administração…
  cortesia: (v) => v === '1',
  furar: (v) => v === '1',
  // …e QUAL horário do slot-picker está em revisão. É a chave que
  // `availableSlots` devolve: o uuid da janela publicada, ou `t<instante ISO>`
  // para o horário computado. Nenhum dos dois é dado de pessoa, e um valor
  // forjado não casa com slot nenhum — a tela volta à lista.
  escolha: (v) => /^[A-Za-z0-9:.\-]{1,64}$/.test(v),
}

/**
 * A geometria da TELA — a que sobrevive ao SUCESSO. É o mínimo para a dona
 * voltar ao mesmo lugar depois de um ato concluído.
 */
const GEOMETRIA_DA_TELA: Record<TelaDaAgenda['tela'], readonly string[]> = {
  casa: ['v', 'd', 'prof', 'j', 'q'],
  periodo: ['prof', 'de', 'ate'],
  remarcar: ['cortesia', 'furar', 'escolha'],
}

/**
 * A geometria do ERRO — QUAL formulário reabre. Só a casa tem: o Período e o
 * Remarcar são páginas inteiras, e voltar para elas já é reabrir o formulário.
 *
 * SUCESSO NÃO A CARREGA, e isso é regra e não descuido: um ato concluído fecha
 * o painel e fecha o balão. Se `novo`/`slot`/`ev` pudessem atravessar o sucesso,
 * a dona criaria a aula e a tela voltaria com o formulário aberto, convidando ao
 * segundo envio do MESMO ato.
 */
const GEOMETRIA_DO_ERRO: Record<TelaDaAgenda['tela'], readonly string[]> = {
  casa: ['novo', 'nd', 'nt', 'slot', 'si', 'ev', 'nc'],
  periodo: [],
  remarcar: [],
}

/** Todas as chaves que uma tela reconhece (tela + erro), na ordem canônica. */
export function chavesDaTela(t: TelaDaAgenda, comErro: boolean): readonly string[] {
  return comErro
    ? [...GEOMETRIA_DA_TELA[t.tela], ...GEOMETRIA_DO_ERRO[t.tela]]
    : GEOMETRIA_DA_TELA[t.tela]
}

/** O valor é do TIPO que aquela chave aceita? (chave fora da tabela = não) */
export function geometriaValida(chave: string, valor: string): boolean {
  if (valor.length > TETO_DA_GEOMETRIA) return false
  return PREDICADO[chave]?.(valor) ?? false
}

/**
 * A query canônica de uma tela, montada do ZERO a partir de um leitor de
 * valores. Uma função só, dois chamadores:
 *
 *   · a ACTION lê do `back`/`back_erro` que o formulário mandou (endpoint
 *     público — por isso cada valor passa pelo predicado);
 *   · a PÁGINA lê do próprio `searchParams`, para saber em QUE endereço ela
 *     está e comparar com o destino gravado no recado.
 *
 * A ordem é a da allowlist, nos dois lados — é ela que faz as duas strings
 * saírem idênticas para o mesmo estado.
 */
export function geometriaCanonica(
  t: TelaDaAgenda,
  comErro: boolean,
  ler: (chave: string) => string | undefined,
): URLSearchParams {
  const p = new URLSearchParams()
  for (const chave of chavesDaTela(t, comErro)) {
    const valor = ler(chave)
    if (valor && geometriaValida(chave, valor)) p.set(chave, valor)
  }
  return p
}

/** O leitor de uma query STRING (o `back` de um formulário, por exemplo). */
export function lerDaQuery(cru: string): (chave: string) => string | undefined {
  const corte = cru.indexOf('?')
  const p = new URLSearchParams(corte >= 0 ? cru.slice(corte + 1) : '')
  return (chave) => p.get(chave) ?? undefined
}

/**
 * O endereço final: caminho FIXO da tela + query canônica.
 *
 * `%20` e não `+` para espaço: o valor volta para um endereço de navegação, onde
 * `+` é literal (a mesma convenção do `destinoDoRecado`).
 *
 * Concatenação e não template: o varredor de frases de `tests/portal-nav.test.ts`
 * lê os literais deste módulo, e `«…»?«…»` entraria na lista como se fosse
 * recado de tela (a mesma nota do A8).
 */
export function enderecoDaTela(t: TelaDaAgenda, p: URLSearchParams): string {
  const query = p.toString().replace(/\+/g, '%20')
  const caminho = caminhoDaTela(t)
  return query ? caminho + '?' + query : caminho
}

/* ========================================================================== */
/* 3. A CHAVE DO RASCUNHO — derivada do DESTINO, nunca lida do formulário      */
/* ========================================================================== */

/**
 * Sob que identidade o que a dona digitou foi guardado — decidido pelo mesmo
 * dado que decide para ONDE ela volta (ver "a invariante" no cabeçalho).
 *
 * A ordem das perguntas é a de especificidade: a aula em foco (`ev`) manda no
 * balão do slot, que manda no painel `?novo=`. Nunca há dois abertos ao mesmo
 * tempo na tela, e a ordem só existe para um envio forjado não ficar sem
 * resposta definida.
 *
 * `''` significa "este formulário não tem rascunho" (o lote, as remoções, o
 * despublicar) — e quem recebe `''` NÃO TOCA no cookie: apagar o rascunho de um
 * formulário que nem tem rascunho é como a aba B apagava o que a aba A tinha
 * digitado.
 */
export function chaveDoDestino(t: TelaDaAgenda, p: URLSearchParams): string {
  if (t.tela === 'periodo') return CHAVE_DO_PERIODO
  if (t.tela === 'remarcar') return chaveDoRemarcar(t.instance)
  const ev = p.get('ev')
  if (ev) return chaveDoDesfecho(ev)
  const slot = p.get('slot')
  const si = p.get('si')
  if (slot && si) return chaveDoBalao(slot, si)
  const novo = p.get('novo')
  if (!novo) return ''
  const nd = p.get('nd')
  const nt = p.get('nt')
  return chaveDoPainel(novo, nd && nt ? `${nd}T${nt}` : undefined)
}

/* ========================================================================== */
/* 4. OS CAMPOS QUE SOBREVIVEM AO ERRO — lista do SERVIDOR, uma por porta      */
/* ========================================================================== */

/**
 * O que cada porta da seção guarda quando o banco recusa.
 *
 * ── POR QUE ELA É DO SERVIDOR (Sol · rodada 1 do A5, bloqueador) ────────────
 * Era o `manter` do formulário. Com ele, `manter=msg&na_url=msg` reinseria a
 * ponte legada na query DEPOIS da higienização — a limpeza era contornável pelo
 * formulário que ela protege. E um `manter` esquecido apagava, em silêncio, o
 * que a dona tinha digitado num campo que ninguém lembrou de listar.
 *
 * ── E POR QUE NADA DAQUI VAI PARA A URL ─────────────────────────────────────
 * Todos estes campos são, ou podem ser, dado de PESSOA: nome do aluno, fuso,
 * preço, o `note` do bloqueio ("consulta médica"), o `motivo` da cortesia
 * ("cirurgia", "luto"), o `note` do período ("férias da professora"). Endereço
 * vai para o histórico do navegador, para o log de acesso do servidor e do
 * Cloudflare, para a captura de tela e para o link que ela copia pedindo ajuda.
 * Os DOIS booleanos do Remarcar (`cortesia`/`furar`) não estão nesta tabela
 * porque não são rascunho: eles são GEOMETRIA da tela do Remarcar e voltam pela
 * allowlist de query, que é onde a página os relê para se remontar.
 */
export const CAMPOS_DA_PORTA = {
  /** publicar horário de remarcação (painel `?novo=horario` e balão do slot) */
  publicar: ['teacher_id', 'local_date', 'local_time'],
  /** janela semanal de disponibilidade */
  janelaSemanal: ['weekday', 'start_local', 'end_local'],
  /** bloqueio da professora (o `note` é o que mais pesa aqui) */
  bloqueio: ['teacher_id', 'from', 'to', 'note'],
  /** aula avulsa em contrato existente */
  avulsa: ['contract_id', 'kind', 'local_date', 'local_time', 'duration_min', 'price'],
  /** aula experimental (cria a pessoa junto) */
  experimental: [
    'student_name',
    'iana_tz',
    'teacher_id',
    'local_date',
    'local_time',
    'duration_min',
    'price',
  ],
  /** tratamento de período/férias */
  periodo: ['mode', 'note'],
  /** remarcar usando um horário ofertado */
  remarcarOfertado: ['motivo'],
  /** remarcar digitando um horário novo */
  remarcarNovo: ['motivo', 'local_date', 'local_time'],
  /** F5: cobrar a aula avulsa no Asaas (o vencimento digitado sobrevive ao erro) */
  cobrar: ['due_date'],
  /** portas sem nada a guardar (remoções, despublicar, lote) */
  nenhum: [],
} as const satisfies Record<string, readonly string[]>

export type PortaDaAgenda = keyof typeof CAMPOS_DA_PORTA

/**
 * A união de tudo o que pode ser guardado — a rede do varredor: campo novo num
 * formulário da seção tem de entrar em alguma porta, ou o teste que compara o
 * JSX com esta tabela fica vermelho.
 */
export const CAMPOS_GUARDADOS: readonly string[] = [
  ...new Set(Object.values(CAMPOS_DA_PORTA).flat()),
].sort()
