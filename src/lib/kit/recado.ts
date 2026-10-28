// O DESFECHO DA AÇÃO DE UMA SEÇÃO DO ADMIN — EM COOKIE, NUNCA NA URL.
//
// Nasceu dentro de `/admin/ajustes` (A8) e virou peça do kit no A5, quando a
// Agenda passou a precisar do mesmo mecanismo. O que era constante virou
// PARÂMETRO: a seção decide o nome do cookie (`recado_<secao>`) e o caminho
// (`/admin/<secao>`). O comportamento da seção `ajustes` é o mesmo de antes.
//
// ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 1 do A8, grave 3) ──────────────
// A primeira versão da tela de Ajustes terminava em
// `redirect('/admin/ajustes?msg=…&n=Date.now()')` e a página pintava o recado
// com o `AvisoLegado`. Duas coisas erradas nisso, e a segunda é a grave:
//
//   1. `?msg=` é a PONTE DE CONVIVÊNCIA das telas velhas. Ela existe para que
//      matar a faixa antiga não engula o recado das ações que ainda não
//      migraram (está escrito no cabeçalho do `AvisoLegado`, e a régua da onda
//      diz "tela nova devolve o desfecho sem `?msg=` nenhum"). Nascer usando a
//      ponte é nascer legado — e o teste do A8 chegou a CRISTALIZAR o padrão
//      proibido, cobrando o `msg=` na URL em vez de reprová-lo;
//   2. o texto do recado ia inteiro para a barra de endereços, o histórico do
//      navegador e o log de acesso do servidor e do Cloudflare — e, no caminho
//      de falha, esse texto era o **erro cru do Postgres** repassado do
//      PostgREST. Nome de constraint, nome de função, trecho de SQL: tudo
//      publicado num endereço que a dona pode colar num WhatsApp pedindo ajuda.
//
// ── O TRANSPORTE ────────────────────────────────────────────────────────────
// O mesmo desenho do recado do portal (`src/lib/portal/flash.ts`, ADR-025):
// cookie `httpOnly`, escrito só pelo servidor, com vida curta. Quem PINTA
// continua sendo o `AvisoLegado` do kit — ele já faz as duas metades (toast com
// JavaScript, faixa `<noscript>` sem ele) e decide a cor por `tomDoAviso`.
//
// ── POR QUE UM COOKIE POR SEÇÃO, E NÃO O `flash` DO PORTAL ──────────────────
// Aquele cookie tem `path: '/'` e é lido pela moldura de TODAS as rotas do
// portal. Reusá-lo aqui faria o desfecho de uma ação do admin aparecer na tela
// da aluna no mesmo navegador (a dona usa as duas contas na mesma máquina). O
// cookie daqui tem nome próprio e `path` estreito: ele só é ENVIADO pelo
// navegador dentro da seção que o produziu, então nem chega às outras telas do
// admin — e o recado de Ajustes não pinta na Agenda, nem o contrário.
//
// ── COMO ELE SOME (e por que ninguém o apaga na leitura) ────────────────────
// Igual ao do portal, e pela mesma razão técnica: quem lê é uma página (Server
// Component), e o Next 16 proíbe escrever cookie durante o render. A faxina é a
// EXPIRAÇÃO (`RECADO_MAX_AGE_S`), curta o bastante para não reaparecer numa
// visita seguinte. Cada recado leva um `id` aleatório, que vira a chave do toast
// — dois envios com a mesma frase continuam sendo dois avisos, e a mesma escrita
// lida duas vezes continua sendo um só.
//
// ── O RECADO É DO DESTINO, NÃO DA SEÇÃO (dívida (b) do A7) ──────────────────
// A expiração sozinha não bastava, e o caso é de DINHEIRO. A dona registra o
// desfecho de uma aula, chega em `/admin/agenda` com "✓ Aula registrada" e, dois
// segundos depois, toca na aba Pendências para conferir a fila: o cookie ainda
// está vivo, a página nova o lê, e o mesmo ✓ verde pinta OUTRA VEZ. Num ato que
// move crédito e extrato, um segundo ✓ lê como um SEGUNDO registro — e a dona
// tem toda a razão de ler assim.
//
// Consertar apagando na leitura é impossível aqui (o Next 16 proíbe escrever
// cookie durante o render — está dito acima). Então o recado passa a carregar o
// ENDEREÇO em que ele deve aparecer: a action grava o destino para o qual está
// redirecionando, e a página só pinta quando o endereço dela é aquele. Trocar de
// aba muda o endereço e o recado some — sem ninguém apagar nada.
//
// Preço aceito e declarado, o MESMO de antes e nem um a mais: um F5 no próprio
// destino, dentro da janela, mostra o recado de novo (e voltar ao mesmo endereço
// pelo histórico também). O que morreu foi a repintura em NAVEGAÇÃO.
//
// Recado gravado SEM destino continua pintando em qualquer tela da seção — é o
// comportamento de Ajustes, que é uma página só e não tem para onde navegar
// dentro de si.

import { cookies } from 'next/headers'

/**
 * As seções do admin que devolvem desfecho por cookie. União fechada de
 * propósito: a seção é o que decide o nome do cookie E o `path` estreito, e uma
 * seção escrita errada produziria um cookie que a página nunca recebe — falha
 * silenciosa, do tipo que só aparece em produção com a dona sem recado.
 */
export type SecaoDoRecado = 'ajustes' | 'agenda' | 'conteudo'

/** Só precisa atravessar UM redirect. */
export const RECADO_MAX_AGE_S = 15

/** Nome do cookie da seção. */
export function cookieDoRecado(secao: SecaoDoRecado): string {
  return `recado_${secao}`
}

/** A casa da seção — também o `path` estreito do cookie. */
export function casaDaSecao(secao: SecaoDoRecado): string {
  return `/admin/${secao}`
}

export type Recado = {
  mensagem: string
  id: string
  /** o endereço em que este recado deve aparecer (ver o cabeçalho) */
  destino?: string
}

function opcoes(secao: SecaoDoRecado, maxAge: number) {
  return {
    maxAge,
    httpOnly: true,
    sameSite: 'lax' as const,
    // O caminho estreito: este recado não existe fora da seção que o produziu.
    path: casaDaSecao(secao),
    // Mesma régua do resto da casa: `Secure` por env EXPLÍCITA, nunca por
    // NODE_ENV — `next start` local é production e o Safari descarta cookie
    // Secure em http://.
    secure: process.env.COOKIE_SECURE === 'true',
  }
}

/**
 * Grava o desfecho. Só vale dentro de uma Server Action / Route Handler.
 *
 * `destino` é o endereço para o qual quem grava está redirecionando — e é ele
 * que amarra o recado a UMA tela (ver o cabeçalho). Omitir é legítimo e
 * significa "vale em qualquer tela da seção" (o caso de Ajustes).
 */
export async function gravarRecado(
  secao: SecaoDoRecado,
  mensagem: string,
  destino?: string,
): Promise<void> {
  const jar = await cookies()
  const recado: Recado = { mensagem, id: crypto.randomUUID(), ...(destino ? { destino } : {}) }
  jar.set(cookieDoRecado(secao), JSON.stringify(recado), opcoes(secao, RECADO_MAX_AGE_S))
}

/**
 * Lê o desfecho pendente. NÃO consome — ler é operação sem efeito, de propósito.
 * Valor ilegível vira `null` em vez de exceção: um cookie truncado não pode
 * derrubar a tela inteira.
 *
 * `aqui` é o endereço CANÔNICO da página que está lendo. Quando o recado tem
 * destino e ele não é este, a resposta é `null`: o recado pertence a outra tela
 * da seção, e repintá-lo aqui seria anunciar um segundo ato que não aconteceu.
 * Página que não sabe (ou não precisa saber) o próprio endereço não passa nada,
 * e o comportamento é o de antes.
 */
export async function lerRecado(secao: SecaoDoRecado, aqui?: string): Promise<Recado | null> {
  const jar = await cookies()
  const cru = jar.get(cookieDoRecado(secao))?.value
  if (!cru) return null
  let bruto: unknown
  try {
    bruto = JSON.parse(cru)
  } catch {
    return null
  }
  if (typeof bruto !== 'object' || bruto === null) return null
  const { mensagem, id, destino } = bruto as Record<string, unknown>
  if (typeof mensagem !== 'string' || mensagem === '') return null
  if (typeof id !== 'string' || id === '') return null
  if (typeof destino === 'string' && destino !== '' && aqui !== undefined && destino !== aqui)
    return null
  return { mensagem, id, ...(typeof destino === 'string' && destino ? { destino } : {}) }
}

/**
 * Origem FICTÍCIA, só para o parser de URL ter uma base.
 *
 * TLD `.invalid` é reservado por RFC 2606: mesmo que este valor escape para
 * algum lugar por engano, ele não resolve para host nenhum. O que importa dele é
 * a comparação: destino que sai com OUTRA origem não é caminho relativo desta
 * casa — é endereço absoluto (ou protocol-relative, `//evil.example`) tentando
 * passar pelo porteiro.
 */
const ORIGEM_DO_PORTEIRO = 'https://recado.invalid'

/**
 * Para onde voltar. Só dentro da seção, e por dois motivos que se somam: o
 * `back` chega do formulário (endpoint público, pode vir forjado) e o cookie do
 * recado tem `path` estreito — mandar a dona para fora daqui engoliria o
 * desfecho em silêncio.
 *
 * A fronteira é a casa da seção seguida de `/` (ou a casa exata):
 * `/admin/agenda-antiga` começa com `/admin/agenda` e mesmo assim está FORA do
 * `path` do cookie — passaria um `startsWith` cru e perderia o recado, que é
 * exatamente o que este porteiro existe para impedir.
 *
 * ── POR QUE O CAMINHO É CANONICALIZADO (Sol · rodada 1 do A5, médio 3) ───────
 * A comparação textual era contornável por travessia: `/admin/agenda/../ajustes`
 * COMEÇA com a casa, passava intacto — e o navegador então normalizava o
 * endereço para `/admin/ajustes`, que está fora do `path` do cookie. Resultado:
 * a dona ia para outra seção e o recado desaparecia em silêncio, que é o defeito
 * exato que este porteiro existe para impedir. Vale para `.`/`..` e para as
 * formas codificadas (`%2e%2e`), que o parser de URL resolve igual.
 *
 * Resolver contra uma origem fixa faz as duas coisas de uma vez: normaliza os
 * segmentos de ponto e denuncia o endereço absoluto (a origem sai diferente).
 * O retorno passa a ser a URL CANÔNICA — caminho normalizado + query intacta
 * (`search` não é reescrito pelo parser, então `%20`/`+` voltam como vieram).
 * Fragmento (`#…`) cai de propósito: ele nunca chega ao servidor e não é
 * geometria de tela.
 */
export function destinoDaSecao(secao: SecaoDoRecado, cru: string): string {
  const casa = casaDaSecao(secao)
  let alvo: URL
  try {
    alvo = new URL(cru, ORIGEM_DO_PORTEIRO)
  } catch {
    return casa
  }
  // Absoluto ou protocol-relative: outra origem, logo fora da casa.
  if (alvo.origin !== ORIGEM_DO_PORTEIRO) return casa
  const caminho = alvo.pathname
  if (caminho === casa) return caminho + alvo.search
  if (!caminho.startsWith(casa + '/')) return casa
  // SUBROTA TEM DE EXISTIR (Sol · rodada 2 do A5).
  //
  // `startsWith` sozinho aceitava `/admin/agenda/qualquercoisa`: o atacante não
  // escapa da seção, mas a dona cai num 404 — e no 404 ninguém pinta o recado.
  // O desfecho acontece e desaparece, que é o mesmo prejuízo do destino fora da
  // seção, por outro caminho. A lista é curta e vive aqui porque é ela que o
  // porteiro precisa conhecer; rota nova da seção entra nesta lista junto com o
  // arquivo de página.
  const resto = caminho.slice(casa.length + 1)
  return SUBROTAS[secao].some((re) => re.test(resto)) ? caminho + alvo.search : casa
}

/**
 * As subrotas REAIS de cada seção (o que existe em `src/app/admin/<secao>/`).
 * Vazio = a seção é uma página só, e qualquer subcaminho cai na casa.
 */
const SUBROTAS: Record<SecaoDoRecado, readonly RegExp[]> = {
  ajustes: [],
  agenda: [/^periodo$/, /^remarcar\/[A-Za-z0-9._-]{1,64}$/],
  // Conteúdo: a Pauta (M4) fala por cookie, e o RADAR virou a CASA da seção no
  // cutover da Leva 5 — por isso ele saiu desta lista: casa não é subrota.
  // Nem o detalhe do post (`/admin/conteudo/<uuid>`) nem a fila de posts
  // (`/admin/conteudo/posts`) entram aqui de propósito — os dois ainda usam a
  // ponte legada `?msg=`, e listá-los antes de migrá-los autorizaria um destino
  // que não sabe pintar o recado.
  conteudo: [/^pauta$/],
}

/**
 * Os dois parâmetros da ponte legada de recado (`?msg=…&n=…`).
 *
 * EXPORTADO porque quem monta o endereço de volta por outro caminho (a volta de
 * ERRO desmonta a query para tirar os campos do rascunho) precisa da MESMA
 * lista: dois lugares com a lista escrita à mão divergem no dia em que a ponte
 * ganhar ou perder um parâmetro.
 */
export const PONTE_LEGADA = ['msg', 'n'] as const

/**
 * O destino de uma volta COM recado no cookie: o porteiro acima, mais a
 * higienização da ponte legada.
 *
 * Por que ela existe: na Agenda o `back` que os formulários carregam ainda
 * traz `?msg=&n=` (a ponte de convivência das telas velhas). Voltar para esse
 * endereço com o cookie escrito pintaria DOIS recados na mesma tela — o do
 * cookie e o da ponte. Aqui `msg` e `n` saem; o resto da query (a geometria da
 * tela: visão, âncora, professora, aba) fica intacto.
 *
 * Query SEM `msg`/`n` volta byte a byte como veio: nada de reescrever o
 * endereço de quem já estava limpo (é o caso de Ajustes hoje).
 */
export function destinoDoRecado(secao: SecaoDoRecado, cru: string): string {
  const alvo = destinoDaSecao(secao, cru)
  const corte = alvo.indexOf('?')
  if (corte < 0) return alvo
  const p = new URLSearchParams(alvo.slice(corte + 1))
  if (!PONTE_LEGADA.some((k) => p.has(k))) return alvo
  for (const k of PONTE_LEGADA) p.delete(k)
  // `%20` e não `+`: o valor volta para um endereço de navegação, onde `+` é
  // literal — a mesma conversão que `agenda/actions.ts` já faz.
  const query = p.toString().replace(/\+/g, '%20')
  return query ? alvo.slice(0, corte) + '?' + query : alvo.slice(0, corte)
}
