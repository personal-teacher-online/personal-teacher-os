// HARNESS DA ONDA 1 (M5) — as peças compartilhadas do e2e: endereço da
// bancada, entrada por `/dev-entrar`, navegador e o axe.
//
// PLAYWRIGHT PURO + VITEST, e não `@playwright/test`. A onda já tem `playwright`
// como devDep e uma suíte Vitest com 1900+ testes; trazer um segundo runner
// significaria dois vocabulários de asserção, dois relatórios e dois arquivos de
// configuração para o mesmo repositório. O que o runner do Playwright daria de
// graça — retry, timeout generoso, execução em série — o Vitest dá por
// configuração (`vitest.e2e.config.ts`), e o axe entra por injeção do
// `axe-core`, que é o que o `@axe-core/playwright` faz por baixo.
//
// O e2e NÃO entra no `npm test`: a suíte de unidade continua em `*.test.ts` e
// esta em `*.spec.ts`, com config própria. Uma coisa é a régua de cada gate; a
// outra precisa de banco semeado, build e navegador.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright'

const RAIZ = path.resolve(__dirname, '..', '..')
const require = createRequire(import.meta.url)

/** Porta da bancada — fora da 3000 de propósito: `npm run dev` do dono continua
 *  no ar enquanto o harness roda. */
export const PORTA = Number(process.env.E2E_PORT ?? 3100)
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORTA}`

/* -------------------------------------------------------------------------- */
/* .env.local — só o segredo da entrada de bancada                             */
/* -------------------------------------------------------------------------- */

function envLocal(): Record<string, string> {
  let cru = ''
  try {
    cru = readFileSync(path.join(RAIZ, '.env.local'), 'utf8')
  } catch {
    throw new Error('.env.local não existe — o harness precisa do BANCADA_AUTOLOGIN.')
  }
  const fora: Record<string, string> = {}
  for (const linha of cru.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha.trim())
    if (!m) continue
    fora[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return fora
}

/** O segredo que `/dev-entrar` exige em `?chave=` (trava dupla da rota). */
export function chaveDaBancada(): string {
  const chave = envLocal().BANCADA_AUTOLOGIN ?? ''
  if (chave.length < 16) {
    throw new Error(
      'BANCADA_AUTOLOGIN ausente (ou < 16 chars) no .env.local — sem ele /dev-entrar responde 404 e o harness não entra.',
    )
  }
  return chave
}

/* -------------------------------------------------------------------------- */
/* Navegador                                                                   */
/* -------------------------------------------------------------------------- */

export async function abrirNavegador(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch (e) {
    throw new Error(
      `não foi possível abrir o Chromium (${(e as Error).message}).\n` +
        'Instale o navegador do Playwright: npx playwright install chromium',
    )
  }
}

/**
 * Contexto JÁ LOGADO por um dos logins de bancada, pela porta `/dev-entrar`.
 *
 * Não é ausência de auth: a rota faz `signInWithPassword` com o login de
 * preview e cria uma sessão normal — RLS e gate por papel seguem valendo, que é
 * exatamente o que o smoke precisa exercitar.
 *
 * `prefixoEsperado` é onde a pessoa TEM de parar. O gate do portal redireciona
 * `/portal` → `/portal/ciencia` ou `/portal/briefing` conforme o aluno; por isso
 * a conferência é por PREFIXO, e não por igualdade: parar num gate legítimo é
 * entrar, parar em `/login` não é.
 */
async function contextoDe(
  browser: Browser,
  como: string,
  para: string,
  prefixoEsperado: string,
  opcoes: Parameters<Browser['newContext']>[0] = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opcoes })
  const page = await ctx.newPage()
  const chave = encodeURIComponent(chaveDaBancada())
  await page.goto(`${BASE_URL}/dev-entrar?chave=${chave}&como=${como}&para=${para}`, {
    waitUntil: 'domcontentloaded',
  })
  if (!page.url().startsWith(`${BASE_URL}${prefixoEsperado}`)) {
    throw new Error(
      `/dev-entrar?como=${como} não deixou entrar (parou em ${page.url()}).\n` +
        'A bancada tem os logins de preview? node --env-file=.env.local scripts/preview-logins.ts',
    )
  }
  return { ctx, page }
}

/** Contexto JÁ LOGADO como admin (Onda 1). */
export async function contextoAdmin(
  browser: Browser,
  opcoes: Parameters<Browser['newContext']>[0] = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  return contextoDe(browser, 'admin', '/admin', '/admin', opcoes)
}

/**
 * Contexto JÁ LOGADO como ALUNO (Onda do Portal · P7) — irmão do
 * `contextoAdmin`.
 *
 * TRÊS contas de aluno vivem na bancada, e a diferença entre elas é o ESTADO:
 *  · `aluno` (Sabrina) atravessou ciência + briefing, e por isso o `/portal`
 *    abre — é com ela que o smoke das telas roda;
 *  · `aluno-briefing` tem o briefing PENDENTE de propósito: `/portal` a joga em
 *    `/portal/briefing`, que é o cenário do fluxo v2 e o do recado que precisa
 *    sobreviver ao gate;
 *  · `aluno-rebriefing` já passou pelo gate, mas tem o RE-BRIEFING semestral
 *    pendente (contrato de 8 meses, plano do semestre 2, briefing base v2
 *    enviado): é com ele que o convite do Início e as duas etapas da
 *    atualização são percorridos.
 *
 * Quem semeia os três estados é `scripts/preview-seed.ts` (blocos "portal do
 * aluno" e "3º login com RE-BRIEFING semestral pendente"); aqui só se escolhe
 * por qual porta entrar.
 */
export async function contextoAluno(
  browser: Browser,
  opcoes: { como?: 'aluno' | 'aluno-briefing' | 'aluno-rebriefing'; para?: string } &
    Parameters<Browser['newContext']>[0] = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const { como = 'aluno', para = '/portal', ...doNavegador } = opcoes
  return contextoDe(browser, como, para, '/portal', doNavegador)
}

/**
 * WEBKIT — o motor do Safari/iOS, aberto SÓ pelos casos que precisam dele.
 *
 * POR QUE ELE ENTRA NA CASA (onda da Agenda · A9): a lição do hotfix
 * `.linha-ancora` (28/07) foi que a família de defeito desta onda — bloco
 * absolutamente posicionado dentro de célula, capa que engole toque, popover
 * ancorado que sobrevive à rolagem — é exatamente a que o Chromium NÃO mostra.
 * O `chromium` continua sendo o motor do smoke (é mais rápido e é onde as
 * outras duas suítes rodam); o que atravessa para cá é a lista curta de casos
 * em que o WebKit é a pergunta.
 *
 * NÃO É "o iPhone real": é o mesmo MOTOR, sem o hardware, sem o teclado do
 * sistema e sem a barra de endereço que muda de altura. O aparelho continua
 * sendo etapa do portão do dono (`docs/goals/portao-visual-2-agenda.md`) —
 * este navegador reduz a superfície que chega lá, não a substitui.
 */
export async function abrirWebkit(): Promise<Browser> {
  try {
    return await webkit.launch()
  } catch (e) {
    throw new Error(
      `não foi possível abrir o WebKit (${(e as Error).message}).\n` +
        'Instale o navegador do Playwright: npx playwright install webkit',
    )
  }
}

/* -------------------------------------------------------------------------- */
/* axe                                                                         */
/* -------------------------------------------------------------------------- */

const AXE_MIN = require.resolve('axe-core/axe.min.js')

export interface ViolacaoGrave {
  id: string
  impact: string
  ajuda: string
  alvos: string[]
}

/**
 * Roda o axe na página como ela está AGORA e devolve só o que a onda trata como
 * falha: `serious` e `critical`. `minor`/`moderate` são reportados no console —
 * informação para o revisor, não portão automático (a régua da spec é literal:
 * "violações serious/critical = FALHA").
 */
export async function violacoesGraves(page: Page): Promise<ViolacaoGrave[]> {
  await page.addScriptTag({ path: AXE_MIN })
  const violacoes = await page.evaluate(async () => {
    // @ts-expect-error — axe é injetado no runtime da página, não do teste
    const r = await window.axe.run(document, { resultTypes: ['violations'] })
    return (r.violations as { id: string; impact: string; help: string; nodes: { target: string[] }[] }[]).map(
      (v) => ({ id: v.id, impact: v.impact, ajuda: v.help, alvos: v.nodes.map((n) => n.target.join(' ')) }),
    )
  })
  return violacoes.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

/* -------------------------------------------------------------------------- */
/* Utilidades de leitura da tela                                               */
/* -------------------------------------------------------------------------- */

/**
 * Espera até a condição virar verdade.
 *
 * Existe porque `expect.poll()` do Vitest só pode ser chamado DENTRO de um
 * teste — e os `beforeAll` daqui também precisam esperar a bancada (a primeira
 * renderização de uma rota do `next start` pode levar alguns segundos).
 */
export async function ate(
  condicao: () => Promise<boolean> | boolean,
  oQueFaltou: string,
  timeout = 20_000,
): Promise<void> {
  const fim = Date.now() + timeout
  let ultimoErro: unknown = null
  while (Date.now() < fim) {
    try {
      if (await condicao()) return
    } catch (e) {
      ultimoErro = e
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `${oQueFaltou} (esperei ${timeout}ms)` + (ultimoErro ? ` — último erro: ${String(ultimoErro)}` : ''),
  )
}

/** Largura RENDERIZADA do trilho (o mecanismo dele é animar a própria width). */
export function larguraDoTrilho(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rail = document.querySelector('nav.rail')
    return rail ? Math.round(parseFloat(getComputedStyle(rail).width)) : -1
  })
}

/** Opacidade do rótulo do trilho (a emenda v3: fade sincronizado com o corte). */
export function opacidadeDoRotulo(page: Page): Promise<number> {
  return page.evaluate(() => {
    const label = document.querySelector('nav.rail .rail-label')
    return label ? Number(getComputedStyle(label).opacity) : -1
  })
}
