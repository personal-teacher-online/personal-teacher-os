// O RECADO DA AÇÃO ATRAVESSA UM REDIRECT — em COOKIE, nunca na URL.
//
// O DEFEITO QUE ISTO CONSERTA (revisão adversarial do P4, E6). A porta nova
// (ADR-025) fazia a action DEVOLVER `ResultadoDaAcao` e o `BotaoDeAcao`
// transformava esse retorno em toast. Funciona — com JavaScript. Sem ele, o
// navegador faz o POST da Server Action, o React descarta o valor de retorno
// (`form action` é tipado como void, e em runtime ele realmente ignora) e a
// pessoa recebe a MESMA página redesenhada, sem recado nenhum. O ato acontecia;
// a RECUSA ficava invisível. Quem não conseguiu cancelar via a tela piscar e a
// aula continuar lá, sem uma palavra.
//
// Por que cookie e não `?msg=&n=`: o recado na URL é forjável (qualquer um monta
// um link que faz o portal afirmar "Aula cancelada. ✅") e obriga a carregar um
// nonce só para o toast não se repetir — a ponte que o P4 matou justamente
// nestas telas. O cookie é `httpOnly`, escrito só pelo servidor.
//
// COMO ELE SOME — E POR QUE NINGUÉM O APAGA (2ª rodada de revisão do P4).
// A primeira versão era um cookie de uso ÚNICO, deletado pelo `src/proxy.ts` na
// resposta seguinte. O desenho tinha dois furos, e os dois eram de perder o
// recado:
//
//   1. GATE NO CAMINHO. O `/portal` redireciona quem ainda não deu ciência do
//      canal (`/portal/ciencia`) ou não enviou o briefing (`/portal/briefing`).
//      Um aluno nessa situação que remarcasse por deep link GASTAVA o crédito,
//      era mandado para `/portal` e de lá para o gate — e o cookie era apagado
//      no caminho, sem ninguém tê-lo lido. O desfecho da ação sumia sempre, de
//      forma determinística, para quem ainda não passou pelo gate.
//   2. QUEM CHEGA PRIMEIRO COME. Prefetch do Next, uma aba paralela, uma
//      requisição de ícone qualquer sob `/portal` — qualquer resposta consumia o
//      cookie antes de a tela existir.
//
// Agora NINGUÉM apaga: quem limpa é a EXPIRAÇÃO do próprio cookie
// (`FLASH_MAX_AGE_S`, 15s — o suficiente para atravessar um redirect, curto
// demais para reaparecer numa visita seguinte). Cada recado leva um `id`
// aleatório: é ele que vira a chave do toast (o `sonner` dedupa por `id`), então
// o recado não se repete a cada navegação dentro da janela. O preço, aceito e
// declarado: um F5 DENTRO dos 15s mostra o recado de novo — pela faixa
// `<noscript>` e pelo toast, que renascem com a página. Melhor repetir um
// desfecho verdadeiro do que engoli-lo.
//
// DUAS AÇÕES QUASE SIMULTÂNEAS (o casal em duas abas). O cookie é um só: a
// segunda escrita sobrescreve a primeira e um dos recados se perde. É raro
// (exige dois atos no mesmo navegador dentro de segundos) e o efeito é sempre o
// mesmo — a pessoa deixa de LER um desfecho que o banco registrou e que a tela
// de destino mostra assim mesmo (a aula sumiu da lista, o saldo mudou). Uma fila
// de recados custaria um cookie que cresce e uma ordem a manter; não vale.
//
// Quem PINTA continua sendo o `AvisoLegado` do kit: ele já faz as duas metades
// que esta correção precisa — toast com JavaScript, faixa `<noscript>` sem ele.
// Quem LÊ é a moldura do portal (`src/components/portal/RecadoDoPortal.tsx`,
// montado pelo layout), e não cada página: assim toda rota do portal — inclusive
// as duas do gate — mostra o desfecho.

import { cookies } from 'next/headers'

import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

/** Cookie com o recado da última ação do portal (ADR-025, porta nova). */
export const FLASH_COOKIE = 'flash'

/** Vida curta: ele existe só para atravessar UM redirect, e a expiração é a
 *  ÚNICA faxina — nenhuma leitura o consome (ver o cabeçalho). */
export const FLASH_MAX_AGE_S = 15

/** O recado + a identidade daquela escrita (chave do toast). */
export type Flash = { mensagem: string; id: string }

/** Grava o recado da ação. Só vale dentro de uma Server Action / Route Handler. */
export async function gravarFlash(mensagem: string): Promise<void> {
  const jar = await cookies()
  const { nome, valor, opcoes } = cookieDoFlash(mensagem)
  jar.set(nome, valor, opcoes)
}

/**
 * O MESMO cookie, em dados — para quem responde com `NextResponse.redirect` (um
 * Route Handler) e grava na própria resposta: `res.cookies.set(nome, valor, opcoes)`.
 * `id` aleatório por ESCRITA: duas ações seguidas com a mesma frase continuam
 * sendo dois recados (e o `sonner` mostra os dois), enquanto a MESMA escrita lida
 * em duas navegações continua sendo um só toast.
 */
export function cookieDoFlash(mensagem: string) {
  const recado: Flash = { mensagem, id: crypto.randomUUID() }
  // JSON cru: o `cookies()` do Next serializa o valor com `encodeURIComponent` e
  // o desfaz na leitura (`@edge-runtime/cookies`), então aspas, vírgulas e o
  // emoji das frases atravessam inteiros.
  return {
    nome: FLASH_COOKIE,
    valor: JSON.stringify(recado),
    opcoes: {
      maxAge: FLASH_MAX_AGE_S,
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      // Mesma régua do cliente Supabase: `Secure` por env EXPLÍCITA, nunca por
      // NODE_ENV — `next start` local é production e o Safari descarta cookie
      // Secure em http://.
      secure: process.env.COOKIE_SECURE === 'true',
    },
  }
}

/**
 * APAGA o recado pendente quando ele é um ERRO JÁ RESOLVIDO — e quem faz isso é
 * sempre o ESCRITOR, nunca o leitor.
 *
 * O DEFEITO QUE ISTO CONSERTA (rodada de correção do P5). O `maxAge` de 15s é
 * faxina de tempo, não de fato: quem erra na etapa 1 do briefing, lê "Falha:
 * marque ao menos uma forma de contato" e corrige em cinco segundos é levado à
 * etapa 2 com o recado de FALHA ainda no cookie — a moldura o repinta, e a
 * pessoa vê a recusa de um passo que ela acabou de resolver. O sucesso ficava
 * mudo e o erro ficava falando.
 *
 * POR QUE NÃO APAGA TUDO (rodada 2 da revisão). A primeira versão limpava o
 * cookie incondicionalmente no caminho de sucesso. Só que o cookie é UM para o
 * navegador inteiro: a aluna que confirma uma remarcação numa aba e, meio
 * segundo depois, avança uma etapa do briefing na outra perdia o
 * "Aula remarcada! ✅" — um desfecho de DINHEIRO, engolido por um avanço de
 * formulário que não tinha recado próprio para dar. Agora só some o que é
 * ERRO (`tomDoAviso`), que é a única classe cuja obsolescência este caminho
 * consegue afirmar: quem avançou de etapa resolveu a recusa que estava ali.
 *
 * TRADE-OFF RESIDUAL, aceito e declarado: um ERRO nascido em outra aba dentro da
 * mesma janela de milissegundos também é apagado. Custa a repetição de uma
 * recusa que a pessoa vai reencontrar na tela de origem assim que voltar a ela —
 * muito mais barato que engolir um desfecho de sucesso, que não se reencontra.
 *
 * A proibição do cabeçalho continua de pé: ninguém deleta o cookie na LEITURA
 * (era isso que fazia o gate de rota e o prefetch comerem o recado antes de a
 * tela existir).
 */
export async function limparFlash(): Promise<void> {
  const atual = await lerFlash()
  // Nada pendente, ou pendente que é SUCESSO: não é nosso para apagar.
  if (!atual || tomDoAviso(atual.mensagem) !== 'erro') return
  const jar = await cookies()
  // `set` com `maxAge: 0` e não `delete`: o mesmo `path`/`secure` da escrita,
  // para o navegador casar o cookie certo (um `delete` sem path pode não casar).
  jar.set(FLASH_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true',
  })
}

/**
 * APAGA o recado pendente SEJA QUAL FOR o tom — só no SAIR DA CONTA.
 *
 * O DEFEITO QUE ISTO CONSERTA (varredura de onda, V5). O cookie vive 15s e vale
 * para o navegador inteiro, não para a sessão: quem faz uma ação no portal e
 * clica em "sair" em seguida cai no `/login` com o desfecho da conta anterior
 * ainda pendurado — e, num computador compartilhado, quem entrar depois lê um
 * recado que não é dele ("Senha trocada. ✓", "Aula remarcada!"). É vazamento
 * pequeno, mas é vazamento.
 *
 * Por que não `limparFlash` aqui: aquela função só apaga ERRO, de propósito (um
 * sucesso pode ter nascido em outra aba e não é dela para apagar). No signout a
 * pergunta é outra — a sessão que poderia LER o recado está acabando —, então
 * some tudo. Continua valendo a proibição do cabeçalho: quem apaga é o
 * ESCRITOR, num caminho de mutação, nunca a leitura de uma página.
 */
export async function esquecerFlash(): Promise<void> {
  const jar = await cookies()
  jar.set(FLASH_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true',
  })
}

/**
 * Lê o recado pendente. NÃO consome — ler é uma operação sem efeito, de
 * propósito (ver o cabeçalho: quem limpa é o `maxAge`).
 *
 * Valor ilegível vira `null` em vez de exceção: um cookie do formato anterior
 * (texto puro) ou truncado não pode derrubar a moldura do portal inteira.
 */
export async function lerFlash(): Promise<Flash | null> {
  const jar = await cookies()
  const cru = jar.get(FLASH_COOKIE)?.value
  if (!cru) return null
  let bruto: unknown
  try {
    bruto = JSON.parse(cru)
  } catch {
    return null
  }
  if (typeof bruto !== 'object' || bruto === null) return null
  const { mensagem, id } = bruto as Record<string, unknown>
  if (typeof mensagem !== 'string' || mensagem === '') return null
  if (typeof id !== 'string' || id === '') return null
  return { mensagem, id }
}
