// O QUE A DONA DIGITOU ATRAVESSA UM ERRO — EM COOKIE, NUNCA NA URL.
//
// ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 1 do A4, grave 5 — LGPD) ───────
// O mecanismo do `manter` (portão de deploy 29/07, bloqueadores 4 e 6) devolvia
// os campos digitados NA QUERY STRING: um erro do banco ao criar uma
// experimental produzia
//
//   /admin/agenda?slot=…&si=experimental&student_name=Maria%20Silva
//                &iana_tz=Europe/Lisbon&teacher_id=…&price=15000
//
// e um erro no bloqueio carregava a `note` — que é onde a dona escreve
// "consulta médica", "luto", "férias". Endereço não é lugar de dado pessoal: ele
// fica no histórico do navegador, no log de acesso do Cloudflare e do servidor,
// na captura de tela que ela manda por WhatsApp e no link que ela copia para
// pedir ajuda. O ato de errar não pode publicar o nome de um aluno.
//
// ── O TRANSPORTE NOVO ───────────────────────────────────────────────────────
// Mesmo padrão do recado do portal (`src/lib/portal/flash.ts`, ADR-025): cookie
// `httpOnly`, escrito só pelo servidor, com vida curta e caminho estreito. A URL
// de erro do balão passa a carregar SÓ `slot` (qual meia-hora reabre) e `si`
// (qual das quatro intenções) — dois dados de geometria de tela, não de pessoa.
//
// A CHAVE é o que impede o rascunho de vazar para o formulário errado: cada
// formulário declara um campo oculto `rascunho` com a sua identidade
// (`slot:2026-08-04T14:00:avulsa`, `painel:experimental`, `periodo`), a action
// grava essa chave junto, e quem lê PEDE a chave que espera. Rascunho da
// meia-hora das 14:00 não preenche a das 14:30, e rascunho do balão não
// preenche o painel (Sol · rodada 1 do A4, grave 4).
//
// ── SOBRE "USO ÚNICO", COM HONESTIDADE ──────────────────────────────────────
// Apagar o cookie NA LEITURA é impossível aqui, e não por preguiça: quem lê é
// uma página (Server Component), e o Next 16 não permite escrever cookie durante
// o render — "Setting cookies is not supported during Server Component
// rendering… must be performed in a Server Function or Route Handler"
// (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
// As três faxinas que existem, então, são todas do ESCRITOR:
//   1. cada erro SOBRESCREVE o rascunho anterior (só existe um por vez);
//   2. o caminho de SUCESSO (`backTo`) apaga — ato concluído não deixa rastro;
//   3. `RASCUNHO_MAX_AGE_S` mata o que sobrar.
// Descartada de propósito a variante "queimar na montagem do balão" (Server
// Action disparada por efeito): ela daria o uso único literal e tiraria o F5 —
// recarregar a página perderia o que a dona digitou, que é exatamente o defeito
// (bloqueador 4) que este mecanismo existe para consertar.
//
// ── A FAXINA É POR CHAVE, NÃO POR VARREDURA (dívida (a) do A7) ──────────────
// `esquecerRascunho()` apagava o cookie INTEIRO, sem olhar de quem ele era. Com
// duas abas do admin abertas — a dona usa isso quando confere a agenda numa e o
// cadastro na outra — bastava um ato dar CERTO na aba B para o que estava
// digitado na aba A desaparecer. Um sucesso não pode ser destrutivo para um
// formulário que não é o dele.
//
// Agora quem apaga DIZ de quem é o rascunho, e a faxina só acontece quando a
// chave guardada é aquela. Chave vazia (formulário que não tem rascunho: o lote,
// as remoções, o despublicar) não toca em nada — era exatamente por aí que o
// sucesso de um formulário sem gaveta limpava a gaveta de outro.
//
// ── DÍVIDA QUE CONTINUA ABERTA: UM COOKIE SÓ, LOGO UM RASCUNHO SÓ (Sol ·
// rodada 2 do A4, médio 5) ─────────────────────────────────────────────────
// O mecanismo continua tendo UMA gaveta. O que o A7 fechou foi o caminho do
// SUCESSO; o do ERRO segue como estava: com duas abas abertas, o segundo erro
// sobrescreve o rascunho do primeiro, e a aba A volta VAZIA (a chave impede o
// texto de entrar no formulário ERRADO, mas não devolve o que era dela).
// Gaveta por chave exigiria um cookie com N entradas e política de despejo
// dentro do teto de ~4 KB: complexidade que este milestone não paga, para um
// cenário que a dona quase não vive. Fica ESCRITA, com o caso do harness: duas
// abas, ERRO nas duas, cada uma volta com o que era dela.

import { cookies } from 'next/headers'

// As CHAVES vivem num arquivo puro (`chaves-de-rascunho.ts`) porque o
// formulário — que é `'use client'` — precisa escrevê-las, e este módulo aqui
// importa `next/headers`, que não atravessa a fronteira do cliente. Reexportadas
// para quem já é servidor não precisar saber de dois endereços.
import {
  CHAVE_DO_PERIODO,
  chaveDoBalao,
  chaveDoCancelamentoDaFicha,
  chaveDoDesfecho,
  chaveDoPainel,
  chaveDoRemarcar,
  RASCUNHO_COOKIE,
  RASCUNHO_MAX_AGE_S,
  RASCUNHO_PATH,
} from './chaves-de-rascunho'

export {
  CHAVE_DO_PERIODO,
  chaveDoBalao,
  chaveDoCancelamentoDaFicha,
  chaveDoDesfecho,
  chaveDoPainel,
  chaveDoRemarcar,
  RASCUNHO_COOKIE,
  RASCUNHO_MAX_AGE_S,
}

/** Teto de tamanho do que viaja (cookie tem limite de ~4 KB no navegador). */
const TETO_DE_BYTES = 3_000

/**
 * O TAMANHO REAL DO QUE VAI PARA A REDE (Sol · rodada 2 do A4, médio 3).
 *
 * O teto media `corpo.length` — CARACTERES do JSON. Só que o que sai no
 * cabeçalho `Set-Cookie` é o valor PERCENT-ENCODED (é o que o
 * `@edge-runtime/cookies`, embutido no Next, escreve), e em texto acentuado cada
 * caractere vira 6 bytes: `%C3%A9`. Um rascunho de 2.990 caracteres com acentos
 * passava no teto e chegava ao navegador com ~18 KB — acima do limite de ~4 KB,
 * o cookie era DESCARTADO, e a dona perdia exatamente o texto longo que o
 * mecanismo prometia salvar. Pior: perdia em silêncio, porque o teto tinha
 * dado "ok".
 *
 * `encodeURIComponent` só produz ASCII, então contar caracteres do resultado é
 * contar bytes.
 */
export function tamanhoNaRede(valor: string): number {
  return encodeURIComponent(valor).length
}

export interface Rascunho {
  /** identidade do formulário que gerou o rascunho (ver o cabeçalho) */
  chave: string
  /** o que a dona digitou, por `name` do campo */
  campos: Record<string, string>
}

function opcoes(maxAge: number) {
  return {
    maxAge,
    httpOnly: true,
    sameSite: 'lax' as const,
    path: RASCUNHO_PATH,
    // Mesma régua do resto da casa: `Secure` por env EXPLÍCITA, nunca por
    // NODE_ENV — `next start` local é production e o Safari descarta cookie
    // Secure em http://.
    secure: process.env.COOKIE_SECURE === 'true',
  }
}

/** A chave guardada no cookie agora, ou `null` se não há rascunho legível. */
async function chaveGuardada(): Promise<string | null> {
  const jar = await cookies()
  const cru = jar.get(RASCUNHO_COOKIE)?.value
  if (!cru) return null
  try {
    const bruto = JSON.parse(cru) as unknown
    if (typeof bruto !== 'object' || bruto === null) return null
    const { chave } = bruto as Record<string, unknown>
    return typeof chave === 'string' && chave !== '' ? chave : null
  } catch {
    return null
  }
}

/**
 * Grava o rascunho. Só vale dentro de uma Server Action / Route Handler.
 *
 * Campo vazio é OMITIDO, não gravado como '': era assim na versão da URL (a
 * chave era removida) e continua sendo — senão um valor velho ressuscitaria por
 * cima da correção da dona.
 *
 * NADA A GUARDAR (formulário esvaziado, ou porta sem rascunho) apaga só o que é
 * DESTA chave — ver "a faxina é por chave" no cabeçalho.
 */
export async function gravarRascunho(
  chave: string,
  campos: Record<string, string>,
): Promise<void> {
  const limpos: Record<string, string> = {}
  for (const [nome, valor] of Object.entries(campos)) {
    if (typeof valor === 'string' && valor.trim() !== '') limpos[nome] = valor
  }
  if (!chave || Object.keys(limpos).length === 0) {
    // O rascunho VELHO DESTA CHAVE tem de morrer, senão ele repreencheria um
    // formulário que a dona acabou de esvaziar. O de outra chave não é meu.
    await esquecerRascunho(chave)
    return
  }
  const corpo = JSON.stringify({ chave, campos: limpos } satisfies Rascunho)
  const jar = await cookies()
  if (tamanhoNaRede(corpo) > TETO_DE_BYTES) {
    // Rascunho gigante (colagem de texto num campo livre) não pode derrubar o
    // redirect inteiro por cabeçalho grande demais: melhor perder o rascunho e
    // entregar o ERRO, que é o recado que importa.
    jar.set(RASCUNHO_COOKIE, '', opcoes(0))
    return
  }
  jar.set(RASCUNHO_COOKIE, corpo, opcoes(RASCUNHO_MAX_AGE_S))
}

/**
 * Apaga o rascunho DAQUELA chave — caminho de SUCESSO.
 *
 * Sem chave, apaga o que estiver lá: é o caso do SIGNOUT do admin, o único em
 * que a varredura cega é o comportamento certo (ninguém mais vai voltar àquele
 * formulário, e o que foi digitado não pode ficar no navegador).
 */
export async function esquecerRascunho(chave?: string): Promise<void> {
  if (chave !== undefined) {
    // Chave vazia = formulário sem rascunho: não há nada dele para apagar, e
    // apagar o dos outros é o defeito que a dívida (a) do A7 fechou.
    if (chave === '') return
    if ((await chaveGuardada()) !== chave) return
  }
  const jar = await cookies()
  // `set` com `maxAge: 0` e não `delete`: o mesmo `path`/`secure` da escrita,
  // para o navegador casar o cookie certo.
  jar.set(RASCUNHO_COOKIE, '', opcoes(0))
}

/**
 * Lê o rascunho DAQUELE formulário. Chave diferente (ou cookie ausente,
 * expirado, ilegível) devolve `{}` — formulário nasce limpo, nunca com o que
 * alguém digitou noutro lugar.
 *
 * NÃO consome: ler é operação sem efeito (ver o cabeçalho).
 */
export async function lerRascunho(chave: string): Promise<Record<string, string>> {
  if (!chave) return {}
  const jar = await cookies()
  const cru = jar.get(RASCUNHO_COOKIE)?.value
  if (!cru) return {}
  let bruto: unknown
  try {
    bruto = JSON.parse(cru)
  } catch {
    return {}
  }
  if (typeof bruto !== 'object' || bruto === null) return {}
  const { chave: dele, campos } = bruto as Record<string, unknown>
  if (dele !== chave) return {}
  if (typeof campos !== 'object' || campos === null) return {}
  const saida: Record<string, string> = {}
  for (const [nome, valor] of Object.entries(campos as Record<string, unknown>)) {
    if (typeof valor === 'string') saida[nome] = valor
  }
  return saida
}
