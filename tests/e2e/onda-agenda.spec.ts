// HARNESS DA ONDA DA AGENDA · A9 — o e2e da Agenda e dos Ajustes, contra a
// bancada, com os casos OBRIGATÓRIOS que a onda foi acumulando como dívida.
//
// ┌─ RITO (os mesmos dois comandos das outras duas suítes) ───────────────────┐
// │  npm run e2e:bancada     # supabase db reset + preview-logins +           │
// │                          # preview-seed + next build                      │
// │  npm run test:e2e        # sobe `next start` na 3100, roda, derruba       │
// └───────────────────────────────────────────────────────────────────────────┘
// Runner, config, portas e reuso de servidor: `vitest.e2e.config.ts` +
// `tests/e2e/{harness,servidor,porta}.ts`. Nada da Onda 1 nem do Portal foi
// tocado aqui; o único acréscimo compartilhado é `abrirWebkit()` no harness.
//
// ── POR QUE ESTE ARQUIVO EXISTE, E DE ONDE VEIO CADA CASO ────────────────────
// Cada `it` abaixo nomeia, no comentário, a DÍVIDA que o criou — a lista está
// no goal (`docs/goals/onda-agenda.md`, "A9 chega carregado" e as dívidas do
// A5/A6). Nenhum caso aqui é decoração: todos nasceram de um achado do Sol, de
// uma revisão independente ou do portão de deploy que ficou sem passe próprio.
//
// ── WEBKIT, E POR QUÊ (risco nomeado nº 1 do goal) ──────────────────────────
// A grade é feita de blocos absolutamente posicionados dentro de células, com
// popovers em portal ancorados a esses blocos. É a família de defeito que o
// Chromium NÃO mostra — a lição do hotfix `.linha-ancora` de 28/07, em que uma
// capa esticada engolia todos os toques só no Safari. Os casos marcados
// `[webkit]` abrem o motor do Safari (`abrirWebkit()`); os demais rodam no
// chromium do harness, que é onde as outras duas suítes já vivem.
// ⚠️ WebKit NÃO É O IPHONE: sem hardware, sem teclado do sistema, sem barra de
// endereço que muda de altura, sem gesto real de rotação. O aparelho continua
// sendo etapa obrigatória do portão do dono
// (`docs/goals/portao-visual-2-agenda.md`) — este arquivo REDUZ o que chega
// lá, não substitui.
//
// ── O QUE O HARNESS ESCREVE NA BANCADA (e por que isso é aceitável) ─────────
// Quatro casos MUTAM: eles criam bloqueio, publicam horário, criam aula avulsa,
// registram desfecho e (caso 12, lote final) trocam o WhatsApp da Sabrina. É
// deliberado — o caso obrigatório é justamente "o estado no BANCO bate com a
// consequência declarada na tela", e isso não se prova sem escrever. Todo
// bloqueio criado é removido no fim do próprio caso; horário publicado, aula
// avulsa e o número novo FICAM (são inertes: madrugada de um dia futuro, e um
// número de bancada que a próxima rodada troca de novo).
// O rito da onda é reset + build antes de cada rodada, então repetição sem
// reset pode falhar por estado consumido — o mesmo preço que o fluxo do
// briefing já paga no harness do Portal.
//
// ── SELETORES (régua da tarefa) ─────────────────────────────────────────────
// Papel e rótulo acessível para tudo o que é botão, diálogo e rótulo; `[name=]`
// e `data-slot` para campo de formulário e primitivo do kit — `name` é o
// CONTRATO do formulário com a server action (é o que a action lê), e
// `data-slot` é o contrato do kit, os dois estáveis por desenho. Nenhuma classe
// do Tailwind aparece como seletor.

import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'

import {
  BASE_URL,
  abrirNavegador,
  abrirWebkit,
  ate,
  contextoAdmin,
  contextoAluno,
} from './harness'

/** Bancada local varia (banco frio, primeira renderização de cada rota). */
const ESPERA = 20_000

/** Celular de referência (iPhone 12/13/14) — o mesmo do harness do Portal. */
const CELULAR = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

/* Contratos de DOM que este arquivo lê (todos do kit, nenhum de estilo). */
const POPOVER = '[data-slot="popover-content"]'
const SHEET = '[data-slot="sheet-content"]'
const ALERTA = '[data-slot="alert-dialog-content"]'
const TOAST = '[data-sonner-toast]'

let browser: Browser
let ctx: BrowserContext
let page: Page

/** WebKit é caro para abrir: sobe na primeira vez que um caso pede. */
let wk: Browser | null = null
const contextosWebkit: BrowserContext[] = []

async function navegadorWebkit(): Promise<Browser> {
  if (!wk) wk = await abrirWebkit()
  return wk
}

/** Uma bancada NOVA no WebKit (o `/dev-entrar` cria sessão de verdade). */
async function bancadaWebkit(
  opcoes: Parameters<Browser['newContext']>[0] = {},
): Promise<Page> {
  const { ctx: c, page: p } = await contextoAdmin(await navegadorWebkit(), opcoes)
  contextosWebkit.push(c)
  return p
}

/* -------------------------------------------------------------------------- */
/* O que a bancada nos diz (descoberto, nunca chumbado)                         */
/* -------------------------------------------------------------------------- */

/** 'yyyy-LL-dd' de HOJE no fuso do NEGÓCIO — lido da própria tela. */
let hojeISO = ''
/** As professoras da barra: id e nome, na ordem em que a tela as mostra. */
let professoras: { id: string; nome: string }[] = []
/** A professora cujo fuso é o do negócio (Cuiabá) — ver `beforeAll`. */
let profDaCasa = { id: '', nome: '' }

/** O dia civil a N dias de hoje, em 'yyyy-LL-dd'. Conta de CALENDÁRIO sobre a
 *  data que o servidor já resolveu no fuso do negócio (Lei 1: o cliente do
 *  teste não converte fuso nenhum — ele só soma dias a uma data civil). */
function maisDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** 'yyyy-LL-dd' → 'ddmmaaaa', que é o que o `DateField` mascarado aceita. */
const paraOCampoDeData = (iso: string) => iso.split('-').reverse().join('')

const enderecoDaAgenda = (query: string) => `${BASE_URL}/admin/agenda${query}`

async function abrir(p: Page, url: string): Promise<void> {
  await p.goto(url, { waitUntil: 'networkidle' })
}

/**
 * O recado que a tela acabou de pintar — e ele tem DUAS formas nesta seção, de
 * propósito (é a convivência que a onda declarou):
 *  · as telas NOVAS entregam a frase ao `AvisoLegado`, que a pinta como toast do
 *    kit (`[data-sonner-toast]`);
 *  · as telas ainda-legadas (o Remarcar do admin é uma delas, até o A7) usam a
 *    faixa `FlashMsg`, um `<p role="status">` fixo no topo.
 * Ler só uma das duas faria o harness expirar esperando o recado que a outra
 * tela já tinha mostrado.
 */
const RECADO = `${TOAST}, p[role="status"]`

async function recado(p: Page): Promise<string> {
  const t = p.locator(RECADO).first()
  await t.waitFor({ state: 'visible', timeout: ESPERA })
  return (await t.innerText()).trim()
}

/** O recado que JÁ está na tela agora — vazio quando não há nenhum. */
async function recadoNaTela(p: Page): Promise<string> {
  const t = p.locator(RECADO).first()
  if ((await t.count()) === 0 || !(await t.isVisible())) return ''
  return (await t.innerText()).trim()
}

/**
 * O recado NOVO — o que apareceu DEPOIS do ato, e não o que já estava na tela.
 *
 * ⚠️ ISTO NÃO É PARANOIA, É COMPORTAMENTO DECLARADO DO APP (1ª execução real,
 * 30/07). O recado da seção vive num cookie de 15s que carrega o ENDEREÇO em que
 * deve pintar (`@/lib/kit/recado`), e o preço aceito e escrito lá é: «um F5 no
 * próprio destino, dentro da janela, mostra o recado de novo». O caso 11 falha
 * de propósito e volta para `…&ev=<aula>`; o caso 9, logo em seguida, ABRE O
 * MESMO ENDEREÇO — e a recusa do 11 repinta. `recado()` cru pegava esse toast
 * velho e o caso 9 acusava "o registro falhou" com a frase do cancelamento,
 * enquanto o registro tinha dado certo (a repetição encontrava a aula já
 * realizada). Medir o recado de um ato exige ignorar o que já estava na tela.
 */
async function recadoNovo(p: Page, anterior: string): Promise<string> {
  const todos = p.locator(RECADO)
  let novo = ''
  await ate(
    async () => {
      const n = await todos.count()
      for (let i = 0; i < n; i++) {
        const texto = (await todos.nth(i).innerText()).trim()
        if (texto && texto !== anterior) {
          novo = texto
          return true
        }
      }
      return false
    },
    `nenhum recado NOVO apareceu (o que já estava na tela era "${anterior}")`,
    ESPERA,
  )
  return novo
}

/** O foco está DENTRO deste elemento? (a pergunta de acessibilidade que o
 *  `<details data-popup>` nunca soube responder — ver `kit/popover.tsx`). */
function focoDentroDe(p: Page, seletor: string): Promise<boolean> {
  return p.evaluate((s) => {
    const alvo = document.querySelector(s)
    const ativo = document.activeElement
    return Boolean(alvo && ativo && alvo.contains(ativo))
  }, seletor)
}

/** O que o dedo encostaria neste ponto da tela — a pergunta do toque fantasma.
 *  Devolve uma descrição curta do elemento no topo, e se ele está dentro do
 *  seletor dado. */
function oQueRecebeOToque(
  p: Page,
  ponto: { x: number; y: number },
  dentroDe: string,
): Promise<{ tag: string; slot: string; title: string; dentro: boolean }> {
  return p.evaluate(
    ({ ponto: pt, dentroDe: sel }) => {
      const el = document.elementFromPoint(pt.x, pt.y)
      const alvo = document.querySelector(sel)
      return {
        tag: el?.tagName ?? '(nada)',
        slot: el?.getAttribute('data-slot') ?? '',
        title: el?.getAttribute('title') ?? '',
        dentro: Boolean(el && alvo && alvo.contains(el)),
      }
    },
    { ponto, dentroDe },
  )
}

/** Os gatilhos de EVENTO da grade (aulas e janelas): são Popover triggers que
 *  ficam no caminho do Tab. As meias-horas vazias são triggers também, mas
 *  `tabIndex={-1}` por decisão registrada no A4 — é isso que as separa. */
const gatilhosDeEvento = (p: Page) =>
  p.locator(`[data-slot="popover-trigger"]:not([tabindex="-1"])`)

/** Os gatilhos de MEIA-HORA vazia (o `title` deles é o contrato do A4). */
const gatilhosDeSlot = (p: Page) => p.locator('button[title^="Criar às "]')

/**
 * O primeiro gatilho de slot em que um clique REALMENTE acerta.
 *
 * LIÇÃO DA 1ª SEMANA DO HARNESS (30/07): `slots.first()` cravava as 02:00 — e
 * a bancada tem uma aula semeada RELATIVA a `now()` (a prova: o title dela
 * mudou de "03:06" para "03:07" entre duas rodadas). Em certos horários do
 * dia ela pousa em cima do primeiro slot e intercepta o toque: o teste
 * quebrava por FIXTURE QUE CAMINHA, não por defeito do app. Em vez de cravar
 * outra hora (que caminharia para o mesmo buraco noutra hora do dia), o
 * `click({ trial: true })` do Playwright faz a checagem de acionabilidade
 * SEM clicar — o teste escolhe o primeiro slot comprovadamente livre.
 */
async function primeiroSlotClicavel(p: Page) {
  const slots = gatilhosDeSlot(p)
  const total = await slots.count()
  for (let i = 0; i < total; i++) {
    const candidato = slots.nth(i)
    try {
      await candidato.click({ trial: true, timeout: 1500 })
      return candidato
    } catch {
      // coberto por um bloco de aula neste horário do dia — tenta o próximo
    }
  }
  throw new Error(
    `nenhum dos ${total} gatilhos de meia-hora aceita clique — a grade inteira está coberta?`,
  )
}

interface AulaDaGrade {
  indice: number
  id: string
  /** o texto inteiro do balão — é dele que sai a situação */
  texto: string
}

/**
 * Abre cada balão de evento da grade, colhe o id da aula (o campo escondido que
 * a action lê) e o texto, e fecha. É o único jeito honesto de descobrir ids na
 * bancada: a grade não os escreve no DOM, e chumbar id de seed é como o harness
 * começa a mentir.
 *
 * Evento sem formulário de desfecho (aula já registrada, janela de remarcação)
 * não tem id a colher — sai da lista.
 */
async function aulasDaGrade(p: Page): Promise<AulaDaGrade[]> {
  const total = await gatilhosDeEvento(p).count()
  const fora: AulaDaGrade[] = []
  for (let i = 0; i < total; i++) {
    await gatilhosDeEvento(p).nth(i).click()
    const balao = p.locator(POPOVER)
    await balao.waitFor({ state: 'visible', timeout: ESPERA })
    const campo = balao.locator('input[name="instance_id"]')
    const id = (await campo.count()) > 0 ? await campo.first().inputValue() : ''
    const texto = await balao.innerText()
    if (id) fora.push({ indice: i, id, texto })
    await p.keyboard.press('Escape')
    await balao.waitFor({ state: 'detached', timeout: ESPERA })
  }
  return fora
}

/** Abre o balão da aula pelo endereço (`?ev=`), que é a porta que o A5 criou
 *  para a volta de erro — e a mesma que a visão-lista usa. */
async function abrirBalaoDaAula(p: Page, id: string, query: string): Promise<void> {
  await abrir(p, enderecoDaAgenda(`${query}&ev=${encodeURIComponent(id)}`))
  await p.locator(POPOVER).waitFor({ state: 'visible', timeout: ESPERA })
}

/* -------------------------------------------------------------------------- */
/* Escrita na bancada — sempre pelas MESMAS portas do app                      */
/* -------------------------------------------------------------------------- */

/**
 * Cria um bloqueio da professora pelo painel `?novo=disponibilidade` — a MESMA
 * action e a MESMA RPC (`add_teacher_block`) que a dona usa. Nada de SQL: a
 * regra da tarefa é literal, e aqui ela também é a régua da casa (Lei 3).
 *
 * Estoura se o banco recusar: bancada meio-escrita é como um caso obrigatório
 * passa a verde sem provar nada.
 */
async function criarBloqueio(
  p: Page,
  prof: { id: string },
  de: string,
  ate: string,
  motivo: string,
): Promise<void> {
  await abrir(p, enderecoDaAgenda(`?v=dia&d=${de}&prof=${prof.id}&novo=disponibilidade`))
  const painel = p.locator(SHEET)
  await painel.waitFor({ state: 'visible', timeout: ESPERA })
  const form = painel.locator('form:has(input[name="from"])')
  await form.locator('input[placeholder="dd/mm/aaaa"]').first().fill(paraOCampoDeData(de))
  await form.locator('input[placeholder="dd/mm/aaaa"]').nth(1).fill(paraOCampoDeData(ate))
  await form.locator('input[name="note"]').fill(motivo)
  await form.getByRole('button', { name: 'Criar bloqueio' }).click()
  const frase = await recado(p)
  expect(frase, `o bloqueio não foi criado: ${frase}`).not.toContain('Falha')
}

/** Remove o bloqueio pelo motivo — o `aria-label` do botão o carrega inteiro
 *  (item 11 do Sol no A3: numa lista, sete "Remover" iguais não dizem qual).
 *  Os motivos usados aqui são escritos SEM parêntese e sem acento de sobra: eles
 *  entram numa expressão regular de nome acessível, e metacaractere solto
 *  transformaria "não achei o botão" num falso verde de limpeza. */
async function removerBloqueio(p: Page, prof: { id: string }, motivo: string): Promise<void> {
  await abrir(p, enderecoDaAgenda(`?v=dia&d=${hojeISO}&prof=${prof.id}&novo=disponibilidade`))
  const painel = p.locator(SHEET)
  await painel.waitFor({ state: 'visible', timeout: ESPERA })
  const botao = painel.getByRole('button', { name: new RegExp(`Remover bloqueio.*${motivo}`) })
  if ((await botao.count()) === 0) return
  await botao.first().click()
  await recado(p)
}

/** Publica um horário de remarcação pelo painel `?novo=horario`. */
async function publicarHorario(
  p: Page,
  prof: { id: string },
  dia: string,
  hora: string,
): Promise<void> {
  await abrir(p, enderecoDaAgenda(`?v=dia&d=${dia}&prof=${prof.id}&novo=horario`))
  const painel = p.locator(SHEET)
  await painel.waitFor({ state: 'visible', timeout: ESPERA })
  await painel.locator('select[name="teacher_id"]').selectOption(prof.id)
  await painel.locator('input[placeholder="dd/mm/aaaa"]').first().fill(paraOCampoDeData(dia))
  await painel.locator('input[placeholder="HH:mm"]').first().fill(hora.replace(':', ''))
  await painel.getByRole('button', { name: 'Publicar horário' }).click()
  const frase = await recado(p)
  expect(frase, `o horário das ${hora} não foi publicado: ${frase}`).not.toContain('Falha')
}

/* ========================================================================== */
/* Bancada                                                                     */
/* ========================================================================== */

beforeAll(async () => {
  browser = await abrirNavegador()
  const sessao = await contextoAdmin(browser)
  ctx = sessao.ctx
  page = sessao.page

  await abrir(page, enderecoDaAgenda('?v=dia'))

  // HOJE no fuso do NEGÓCIO sai da própria tela — ler o relógio do processo do
  // teste seria ler UTC, e o dia civil de Cuiabá pode ser outro (Lei 1).
  //
  // A ÂNCORA É A SETA "Período anterior", cujo href nomeia ONTEM (`d=`); hoje =
  // ontem + 1 em aritmética CIVIL pura (zona `utc` no Luxon de propósito:
  // data-sem-hora não pode atravessar DST de ninguém). Ela existe em TODAS as
  // visões, o que a torna a leitura mais barata de sustentar.
  //
  // ⚠️ CORREÇÃO DE LÁPIDE (30/07): a versão anterior deste comentário dizia que
  // o link "Abrir o dia" «só existe nas visões SEMANA e MÊS». É FALSO, e foi
  // medido: em `?v=dia` a 1440×900 ele está lá, com `href=…?v=dia&d=<hoje>`. O
  // cabeçalho de dia único é `hidden sm:grid` — some da VISTA abaixo de 640px,
  // mas continua no DOM, e `getAttribute` não pede visibilidade. Ou seja: a
  // leitura antiga funcionaria; a de agora também, e por um motivo verdadeiro.
  // A lápide fica porque frase falsa em comentário envelhece pior que código.
  const hrefOntem = await page
    .locator('a[aria-label="Período anterior"]')
    .first()
    .getAttribute('href')
  const ontemISO = new URL(hrefOntem ?? '', BASE_URL).searchParams.get('d') ?? ''
  hojeISO = /^\d{4}-\d{2}-\d{2}$/.test(ontemISO)
    ? (DateTime.fromISO(ontemISO, { zone: 'utc' }).plus({ days: 1 }).toISODate() ?? '')
    : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hojeISO)) {
    throw new Error(
      `não consegui derivar hoje da seta "Período anterior" (href=${hrefOntem}) — a tela abriu mesmo?`,
    )
  }

  professoras = await page
    .locator('nav[aria-label="Filtrar por professora"] a')
    .evaluateAll((as) =>
      as
        .map((a) => ({
          nome: (a.textContent ?? '').trim(),
          id: new URL(a.getAttribute('href') ?? '', 'http://x').searchParams.get('prof') ?? '',
        }))
        .filter((t) => t.id !== ''),
    )
  if (professoras.length === 0) {
    throw new Error('a barra da agenda não listou nenhuma professora — rode `npm run e2e:bancada`.')
  }

  // A PROFESSORA DO FUSO DA CASA. O bloqueio é gravado no dia civil DELA
  // (`add_teacher_block`), e a janela de remarcação é publicada no fuso do
  // NEGÓCIO (`publishWindowAction` manda `America/Cuiaba`). Com uma professora
  // de outro fuso, "23:30 de quarta em Cuiabá" pode já ser quinta no relógio
  // dela — e o caso da janela das 23:30 mediria outra coisa. Quem responde é o
  // painel de disponibilidade, que escreve a cidade dela.
  for (const t of professoras) {
    await abrir(page, enderecoDaAgenda(`?v=dia&prof=${t.id}&novo=disponibilidade`))
    const painel = page.locator(SHEET)
    await painel.waitFor({ state: 'visible', timeout: ESPERA })
    if ((await painel.innerText()).includes('fuso de Cuiabá')) {
      profDaCasa = t
      break
    }
  }
  if (!profDaCasa.id) {
    throw new Error(
      'nenhuma professora da bancada tem fuso de Cuiabá — os casos de bloqueio × janela ' +
        'comparam dia civil DELA com hora do negócio e não podem rodar sem essa âncora.',
    )
  }
}, 180_000)

afterAll(async () => {
  await ctx?.close()
  await browser?.close()
  for (const c of contextosWebkit) await c.close()
  await wk?.close()
})

/* ========================================================================== */
/* 1. GRADE E BALÃO (A2–A4)                                                    */
/* ========================================================================== */

describe('grade e balão: o que só o navegador responde', () => {
  /**
   * CASO 1 — dívida do A1 ("nenhum e2e cobre /admin/agenda: a tela não foi
   * aberta em navegador") somada à declarada no A2 ("interação do Popover —
   * abrir/focar/Esc — não roda no jsdom").
   *
   * O que ele prova, e o `<details data-popup>` nunca deu: o balão ABRE, o foco
   * ENTRA nele, o Esc fecha e o foco VOLTA ao gatilho. Nas duas famílias de
   * gatilho da grade — o bloco do evento e a meia-hora vazia —, com a grade
   * rolável no meio (`overflow-x-auto`), que é onde um balão em portal pode
   * nascer cortado.
   */
  it('o balão do EVENTO abre dentro da grade rolável, recebe o foco e devolve no Esc', async () => {
    await abrir(page, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const gatilho = gatilhosDeEvento(page).first()
    await ate(
      async () => (await gatilhosDeEvento(page).count()) > 0,
      'o dia de hoje não tem nenhum evento na grade — o bloco "aulas de HOJE" do preview-seed rodou? (`npm run e2e:bancada`)',
      ESPERA,
    )
    // `textContent`, e NÃO `innerText` (1ª execução real, 30/07): o gatilho tem
    // dois blocos dentro (hora+nome e a situação), e `innerText` insere a quebra
    // de linha que o layout mostra enquanto `textContent` não. A comparação lá
    // embaixo lê `document.activeElement.textContent` — medir uma API contra a
    // outra fazia o caso falhar em '03:30 Sabrina?\nsem registro' × '03:30
    // Sabrina?sem registro', ou seja, com o foco JÁ devolvido corretamente.
    const nomeDoGatilho = await gatilho.evaluate((el) => (el.textContent ?? '').trim())

    await gatilho.click()
    const balao = page.locator(POPOVER)
    await balao.waitFor({ state: 'visible', timeout: ESPERA })

    // FOCÁVEL: o Radix leva o foco para dentro do conteúdo.
    await expect.poll(() => focoDentroDe(page, POPOVER), { timeout: ESPERA }).toBe(true)

    // E VISÍVEL DE VERDADE: caixa com área, inteira dentro da janela. A grade
    // rola nos dois eixos e o balão vive em portal — sem o `collisionPadding` do
    // kit, o balão do último dia nasce metade fora da tela.
    const caixa = await balao.boundingBox()
    expect(caixa, 'o balão não tem caixa').not.toBeNull()
    const janela = page.viewportSize()!
    expect(caixa!.width).toBeGreaterThan(0)
    expect(caixa!.height).toBeGreaterThan(0)
    expect(caixa!.x, 'o balão nasceu cortado à esquerda').toBeGreaterThanOrEqual(0)
    expect(caixa!.x + caixa!.width, 'o balão vazou pela direita').toBeLessThanOrEqual(janela.width)

    await page.keyboard.press('Escape')
    await balao.waitFor({ state: 'detached', timeout: ESPERA })
    // FOCO DEVOLVIDO ao bloco que o abriu — a metade que o `<details>` não fazia.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''), {
        timeout: ESPERA,
      })
      .toBe(nomeDoGatilho)
  })

  it('o balão da MEIA-HORA vazia abre no ponto tocado, recebe o foco e fecha no Esc', async () => {
    await abrir(page, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const slots = gatilhosDeSlot(page)
    await ate(
      async () => (await slots.count()) > 0,
      'a grade do dia não ofereceu nenhuma meia-hora vazia — a agenda de hoje está cheia?',
      ESPERA,
    )
    const gatilho = await primeiroSlotClicavel(page)
    const titulo = (await gatilho.getAttribute('title')) ?? ''
    expect(titulo, 'o title do slot deixou de ser o contrato do A4').toMatch(/^Criar às \d{2}:\d{2}$/)

    await gatilho.click()
    const balao = page.locator(POPOVER)
    await balao.waitFor({ state: 'visible', timeout: ESPERA })
    await expect.poll(() => focoDentroDe(page, POPOVER), { timeout: ESPERA }).toBe(true)

    // As TRÊS intenções do A4 estão ali, com a pergunta que o balão faz.
    const texto = await balao.innerText()
    expect(texto).toContain('O que vai acontecer neste horário?')
    for (const rotulo of [
      'Aula avulsa — para quem já é aluno',
      'Aula experimental — para pessoa nova',
      'Horário aberto para remarcação',
      'Bloqueio — a professora não atende',
    ]) {
      expect(texto, `o balão do slot perdeu a intenção "${rotulo}"`).toContain(rotulo)
    }

    await page.keyboard.press('Escape')
    await balao.waitFor({ state: 'detached', timeout: ESPERA })
  })

  /**
   * CASO 2 [webkit] — A TERCEIRA APARIÇÃO DO BOTÃO INVISÍVEL, que ficou sem
   * passe adversarial próprio (o A3 bateu no teto de 5 rodadas) e virou a
   * dívida nº 1 roteada ao A9: "o par invisível×clicável sob bloqueio é caso
   * OBRIGATÓRIO do harness e2e, no WebKit real".
   *
   * A invariante da casa está escrita no `TimeGrid`: NADA INVISÍVEL CONTINUA
   * CLICÁVEL. Sob PROIBIÇÃO (bloqueio da professora), a meia-hora não é
   * renderizada como gatilho — no lugar vai um retângulo INERTE que recebe o
   * toque, não faz nada, e carrega o motivo no `title`.
   *
   * Por que WebKit: a quarta aparição desta família (portão de deploy 29/07) foi
   * medida NO IPHONE — a hachura por cima do botão de meia-hora, que seguia vivo
   * e abria "Publicar horário" no horário que a tela declarava indisponível.
   */
  it('[webkit] meia-hora sob bloqueio não tem gatilho vivo, e o toque na hachura não abre nada', async () => {
    const dia = maisDias(hojeISO, 21)
    const motivo = 'ferias e2e A9'
    const p = await bancadaWebkit(CELULAR)
    try {
      await criarBloqueio(p, profDaCasa, dia, dia, motivo)
      await abrir(p, enderecoDaAgenda(`?v=dia&d=${dia}&prof=${profDaCasa.id}`))

      // O dia inteiro está coberto pela proibição: NENHUMA meia-hora pode
      // oferecer horário. Zero gatilhos — não "gatilhos desabilitados".
      expect(
        await gatilhosDeSlot(p).count(),
        'há meia-hora oferecendo horário dentro de um dia bloqueado — o botão invisível voltou',
      ).toBe(0)

      // …e o que está no lugar diz POR QUÊ (o `title` do retângulo inerte é a
      // única fonte alcançável pelo ponteiro: o rótulo do fundo é
      // pointer-events-none, residual declarado no A3).
      const inertes = p.locator('[title*="indisponível"]')
      await expect.poll(() => inertes.count(), { timeout: ESPERA }).toBeGreaterThan(0)
      expect(await inertes.first().getAttribute('title')).toContain(motivo)

      // O TOQUE: no meio da hachura, o dedo encosta no retângulo inerte — e nada
      // acontece. Nem balão, nem navegação.
      const alvo = inertes.first()
      const caixa = await alvo.boundingBox()
      expect(caixa, 'o retângulo inerte não tem caixa').not.toBeNull()
      const ponto = { x: caixa!.x + caixa!.width / 2, y: caixa!.y + caixa!.height / 2 }
      const quem = await oQueRecebeOToque(p, ponto, POPOVER)
      expect(quem.dentro, 'o toque caiu dentro de um popover que não deveria existir').toBe(false)

      const urlAntes = p.url()
      await p.mouse.click(ponto.x, ponto.y)
      await p.waitForTimeout(500)
      expect(await p.locator(POPOVER).count(), 'o toque na área bloqueada ABRIU um balão').toBe(0)
      expect(p.url(), 'o toque na área bloqueada navegou para outro lugar').toBe(urlAntes)
    } finally {
      await removerBloqueio(p, profDaCasa, motivo)
    }
  })

  /**
   * CASO 3 [webkit] — ROTAÇÃO CRUZANDO 640px COM O BALÃO ABERTO POR `?ev=`.
   * Dívida escrita no fim do A5: "rotação cruzando 640px fecha o balão do
   * `?ev=` — no jsdom; o e2e diz a verdade do navegador".
   *
   * A fronteira de 640px é a mesma que decide QUAL das duas grades da semana
   * está à vista (`kit/balao-do-slot.tsx`). O médio 3 do A4 e o médio 4 do A5
   * moram aqui: com as duas grades montadas, um balão aberto na grade ESCONDIDA
   * vira conteúdo órfão no portal — o `hideWhenDetached` só o esconde, ele come
   * o primeiro Esc e disputa o foco.
   *
   * A INVARIANTE é dura: NUNCA dois balões. O que o navegador decide — migrar
   * para a outra grade ou fechar — é MEDIDO e impresso, não afirmado: é
   * comportamento do `useSyncExternalStore` sob troca de media query, e é
   * exatamente o que este harness existe para descobrir.
   */
  it('[webkit] rotação cruzando 640px com ?ev= aberto: nunca dois balões', async () => {
    const p = await bancadaWebkit(CELULAR)
    await abrir(p, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(p)
    if (aulas.length === 0) {
      throw new Error('nenhuma aula com desfecho aberto hoje — rode `npm run e2e:bancada`.')
    }

    // SEMANA, não dia: é a visão que desenha DUAS grades (a do celular e a de 7
    // colunas). Em `dia` a variante é `unica` e o par nem existe.
    await abrir(p, enderecoDaAgenda(`?v=semana&d=${hojeISO}&ev=${aulas[0].id}`))
    const baloes = p.locator(POPOVER)
    await expect.poll(() => baloes.count(), { timeout: ESPERA }).toBe(1)
    expect(await focoDentroDe(p, POPOVER)).toBe(true)

    // A ROTAÇÃO: retrato de celular → paisagem larga, cruzando o `sm`.
    await p.setViewportSize({ width: 900, height: 500 })
    await p.waitForTimeout(750)

    const quantos = await baloes.count()
    expect(
      quantos,
      `depois de cruzar 640px havia ${quantos} balões abertos — dois balões é o defeito ` +
        '(um deles órfão no portal, comendo o Esc e disputando o foco)',
    ).toBeLessThanOrEqual(1)

    if (quantos === 1) {
      // MIGROU: então tem de estar visível e alcançável — balão aberto e
      // invisível é a família "nada invisível continua clicável".
      expect(await baloes.first().isVisible(), 'o balão que sobrou está invisível').toBe(true)
      const caixa = await baloes.first().boundingBox()
      expect(caixa!.width).toBeGreaterThan(0)
      console.log('[A9] rotação 390→900 com ?ev=: o balão MIGROU para a grade larga')
    } else {
      // FECHOU: então nenhum gatilho pode ter ficado dizendo que está aberto —
      // é por esse `data-state` que o Radix mantém o par gatilho×conteúdo, e um
      // gatilho "aberto" sem conteúdo é meio balão vivo.
      expect(
        await p.locator('[data-slot="popover-trigger"][data-state="open"]').count(),
        'o balão fechou mas sobrou gatilho marcado como aberto',
      ).toBe(0)
      console.log('[A9] rotação 390→900 com ?ev=: o balão FECHOU (nada órfão ficou no portal)')
    }
  })

  /**
   * CASO 4 [webkit] — ROLAR A GRADE COM O BALÃO ABERTO. Dívida escrita no fim do
   * A5: "rolar a grade detacha o balão e o toque seguinte apaga o digitado".
   * A revisão independente confirmou que NÃO é recaída do invisível×clicável (o
   * Radix põe `pointer-events:none`) — mas quem prova isso no motor do Safari é
   * este caso, porque `hideWhenDetached` depende de IntersectionObserver e de
   * layout, os dois territórios em que o WebKit diverge.
   */
  it('[webkit] com o balão aberto, rolar a grade não deixa um balão detachado recebendo o toque', async () => {
    const p = await bancadaWebkit(CELULAR)
    await abrir(p, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(p)
    const futura = aulas.find((a) => a.texto.includes('agendada'))
    if (!futura) {
      throw new Error(
        'hoje não há aula AGENDADA (futura) na bancada — o caso precisa de uma para digitar no campo de aviso.',
      )
    }

    await abrirBalaoDaAula(p, futura.id, `?v=dia&d=${hojeISO}`)
    const balao = p.locator(POPOVER)

    // Escolher um cancelamento revela o campo "quando o aviso chegou" — é ele
    // que guarda o que a dona digitou, e é ele que o toque fantasma apagava.
    await balao.getByRole('radio', { name: /Cancelada — quem pediu foi o aluno/ }).check()
    const campo = balao.locator('input[name="notified_at"]')
    await campo.waitFor({ state: 'visible', timeout: ESPERA })
    const digitado = `${hojeISO}T08:15`
    await campo.fill(digitado)

    const antes = await balao.boundingBox()
    expect(antes, 'o balão não tem caixa').not.toBeNull()
    const ponto = { x: antes!.x + antes!.width / 2, y: antes!.y + 12 }

    // ROLAR até a âncora (o bloco da aula) sair da área visível.
    // `window.scrollBy` e não `mouse.wheel` (1ª execução real, 30/07): o
    // Playwright recusa a roda no WebKit MÓVEL com "Mouse wheel is not supported
    // in mobile WebKit" — e móvel é o ponto do caso. O que importa aqui é a
    // ROLAGEM (a âncora sair da área visível e o Radix reposicionar/desancorar),
    // não o dispositivo que a produz; no aparelho quem rola é o dedo, e o
    // resultado no documento é o mesmo.
    await p.evaluate(() => window.scrollBy(0, 1200))
    await p.waitForTimeout(750)

    // O balão detachado não pode receber o toque seguinte.
    const quem = await oQueRecebeOToque(p, ponto, POPOVER)
    if (quem.dentro) {
      // O ponto ainda pertence ao balão. Só há um jeito de isso ser aceitável:
      // ele estar INERTE (é o que o Radix faz ao detachar — `pointer-events:
      // none`). Balão escondido que continua recebendo o dedo é a família
      // "nada invisível continua clicável", agora do lado do portal.
      const inerte = await p.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement | null
        if (!el) return true
        const cs = getComputedStyle(el)
        return cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none'
      }, POPOVER)
      const aindaAncorado = await balao.isVisible().catch(() => false)
      expect(
        inerte || aindaAncorado,
        `depois da rolagem o toque caiu DENTRO do balão (${quem.tag} ${quem.slot}) e ele não estava ` +
          'nem ancorado nem inerte — é o balão detachado comendo o toque seguinte',
      ).toBe(true)
    }

    const urlAntes = p.url()
    await p.mouse.click(ponto.x, ponto.y)
    await p.waitForTimeout(500)
    expect(p.url(), 'o toque depois da rolagem navegou para outro lugar').toBe(urlAntes)

    // E o que ela digitou: se o balão sobreviveu, o valor tem de estar lá.
    if (await balao.isVisible().catch(() => false)) {
      expect(
        await campo.inputValue(),
        'o toque seguinte à rolagem apagou o que a dona tinha digitado',
      ).toBe(digitado)
    } else {
      console.log('[A9] rolagem com balão aberto: o balão FECHOU ao detachar (nada a apagar)')
    }
  })

  /**
   * CASO 5a [webkit] — FOCO NA REABERTURA EM SEMANA + CELULAR. Dívida da lista
   * "A9 chega carregado". É o médio 4 do A5: enquanto a tela é DESCONHECIDA,
   * nenhuma das duas grades abre; quando a media query responde, só a visível
   * abre — e o foco tem de entrar NELA, nunca no gêmeo escondido.
   */
  it('[webkit] semana + celular: a volta de erro reabre UM balão, e o foco entra no visível', async () => {
    const p = await bancadaWebkit(CELULAR)
    await abrir(p, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(p)
    if (aulas.length === 0) throw new Error('sem aulas hoje na bancada — rode `npm run e2e:bancada`.')

    await abrir(p, enderecoDaAgenda(`?v=semana&d=${hojeISO}&ev=${aulas[0].id}`))
    const baloes = p.locator(POPOVER)
    await expect.poll(() => baloes.count(), { timeout: ESPERA }).toBe(1)
    expect(await baloes.first().isVisible(), 'o balão reaberto não está visível').toBe(true)
    expect(
      await focoDentroDe(p, POPOVER),
      'o foco não entrou no balão reaberto (ou entrou no gêmeo escondido)',
    ).toBe(true)

    // O Esc fecha de primeira: um balão órfão montado comeria este Esc.
    await p.keyboard.press('Escape')
    await expect.poll(() => baloes.count(), { timeout: ESPERA }).toBe(0)
  })

  /**
   * CASO 5b — FOCO DEPOIS DA REMONTAGEM DO CAMPO AO TROCAR O CONTRATO.
   * Dívida da lista "A9 chega carregado", e a consequência declarada da decisão
   * do A4: "reset por REMONTAGEM, com chave de GESTO — o custo da remontagem é o
   * foco, e ele não está no campo: o gesto acontece no `<select>` de contrato".
   *
   * O que se prova aqui é essa frase: trocar o contrato remonta data e hora (os
   * valores mudam para o relógio do aluno) e o foco CONTINUA no seletor —
   * nunca cai no `<body>`, que é como o teclado se perde no meio do formulário.
   */
  it('trocar o contrato recalcula os campos e NÃO joga o foco fora do seletor', async () => {
    await abrir(
      page,
      enderecoDaAgenda(`?v=dia&d=${hojeISO}&novo=avulsa&nd=${maisDias(hojeISO, 7)}&nt=14:00`),
    )
    const painel = page.locator(SHEET)
    await painel.waitFor({ state: 'visible', timeout: ESPERA })

    const seletor = painel.locator('select[name="contract_id"]')
    const opcoes = await seletor.locator('option').evaluateAll((os) =>
      os.map((o) => ({ valor: (o as HTMLOptionElement).value, texto: o.textContent ?? '' })).filter((o) => o.valor),
    )
    expect(opcoes.length, 'nenhum contrato ativo na bancada para a aula avulsa').toBeGreaterThan(0)

    await seletor.focus()
    await seletor.selectOption(opcoes[0].valor)
    await page.waitForTimeout(300)

    // O FOCO fica com o gesto (o seletor), não some para o documento.
    const ondeEstaOFoco = await page.evaluate(
      () => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName ?? '',
    )
    expect(
      ondeEstaOFoco,
      'a remontagem dos campos (chave de gesto) levou o foco embora do seletor',
    ).toBe('contract_id')

    // …e os campos EXISTEM com valor depois da remontagem (o reset por gesto não
    // pode deixar data/hora vazias — é o que o banco recebe).
    const data = painel.locator('input[placeholder="dd/mm/aaaa"]').first()
    const hora = painel.locator('input[placeholder="HH:mm"]').first()
    expect(await data.inputValue()).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(await hora.inputValue()).toMatch(/^\d{2}:\d{2}$/)
  })

  /**
   * CASO 6 [webkit] — O CITYPICKER NÃO PODE SER CORTADO PELA BORDA DO BALÃO.
   * Dívida da lista "A9 chega carregado".
   *
   * A lista do `CityPicker` é `absolute` dentro do próprio campo, e o corpo do
   * balão tem `max-h-[70vh] overflow-y-auto` — quando um eixo rola, o outro
   * deixa de ser `visible` por especificação, e é assim que uma lista suspensa
   * some pela borda. A pergunta que importa não é "o `<ul>` existe": é se o dedo
   * ALCANÇA a primeira cidade. Por isso a asserção é um hit-test.
   */
  it('[webkit] a lista de cidades do balão é alcançável pelo dedo (não some na borda)', async () => {
    const p = await bancadaWebkit(CELULAR)
    await abrir(p, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    await ate(
      async () => (await gatilhosDeSlot(p).count()) > 0,
      'a grade do dia não ofereceu meia-hora vazia',
      ESPERA,
    )
    const slot = await primeiroSlotClicavel(p)
    await slot.click()
    const balao = p.locator(POPOVER)
    await balao.waitFor({ state: 'visible', timeout: ESPERA })

    await balao.getByRole('button', { name: /Aula experimental — para pessoa nova/ }).click()
    // `input[role=combobox]` e não `getByRole('combobox')`: o formulário também
    // tem `<select>` nativos (professora, duração), que carregam o mesmo papel.
    const campo = balao.locator('input[role="combobox"]')
    await campo.waitFor({ state: 'visible', timeout: ESPERA })
    await campo.click()
    await campo.fill('Cuiab')

    const lista = balao.getByRole('listbox')
    await lista.waitFor({ state: 'visible', timeout: ESPERA })
    const primeira = lista.getByRole('option').first()
    await primeira.waitFor({ state: 'visible', timeout: ESPERA })

    const caixa = await primeira.boundingBox()
    expect(caixa, 'a primeira cidade não tem caixa — a lista nasceu com altura zero').not.toBeNull()
    const janela = p.viewportSize()!
    expect(caixa!.y, 'a lista de cidades nasceu acima do topo da janela').toBeGreaterThanOrEqual(0)
    expect(
      caixa!.y + caixa!.height,
      'a primeira cidade ficou abaixo do fim da janela — cortada pela borda do balão',
    ).toBeLessThanOrEqual(janela.height)

    // HIT-TEST: é o dedo que decide. Se o corte do balão engolir a opção, quem
    // responde neste ponto é outro elemento.
    // A pergunta é se o dedo ALCANÇA a opção — e quem responde é a árvore, não
    // o nó de cima. `elementFromPoint` devolve o elemento MAIS FUNDO, e a opção
    // do `CityPicker` é um `<button role="option">` com dois `<span>` dentro
    // (nome+estado+país e a hora local). Cobrar `role="option"` no nó devolvido
    // media a marcação, não o alcance: na 1ª execução real o toque caiu no
    // `<span>` ", Mato Grosso — Brasil", que é FILHO da opção e faz o clique
    // chegar nela. O que tem de ser verdade é PERTENCER à opção.
    const ponto = { x: caixa!.x + caixa!.width / 2, y: caixa!.y + caixa!.height / 2 }
    const quem = await p.evaluate((pt) => {
      const el = document.elementFromPoint(pt.x, pt.y) as HTMLElement | null
      return {
        naOpcao: Boolean(el?.closest('[role="option"]')),
        papel: el?.getAttribute('role') ?? '',
        texto: (el?.textContent ?? '').slice(0, 40),
      }
    }, ponto)
    expect(
      quem.naOpcao,
      `o toque na primeira cidade encostou em "${quem.texto}" (role=${quem.papel}), fora da opção — a lista está coberta ou cortada`,
    ).toBe(true)

    // E escolher COMMITA: o cabeçalho do balão passa a declarar o outro relógio
    // (ou confirma o da casa) — é a prova de que a lista era usável, não só
    // visível.
    await primeira.click()
    await expect.poll(() => balao.innerText(), { timeout: ESPERA }).toContain('agora são')
  })

  /**
   * CASO 7 — A JANELA DAS 23:30. Dívida escrita no TimeGrid e no goal como caso
   * OBRIGATÓRIO do A9; o cinto que a fecha nasceu no passe adversarial do A6
   * (lote 1), e o comentário da migration diz, com estas palavras: "a janela
   * publicada às 23:30 do dia anterior consumia uma aula de 60 min que entrava
   * 30 minutos DENTRO do dia bloqueado, e passava. É a 'janela das 23:30' que
   * estava roteada como dívida ao A9 — morre aqui."
   *
   * O que este caso prova é o INTERVALO: a janela está FORA do bloqueio (23:30
   * do dia anterior), a aula que ela criaria está DENTRO (00:00–00:30), e a
   * reserva é recusada. Uma checagem por INSTANTE aceitaria — é exatamente essa
   * a diferença que o teste mede.
   *
   * ⚠️ A "OFERTA FANTASMA" JÁ MORREU — e este caso foi REESCRITO por causa
   * disso, na 1ª execução real (30/07), exatamente como o parágrafo antigo
   * mandava ("quando alguém a matar, este trecho fica vermelho: é a hora de
   * reescrevê-lo, não de afrouxá-lo").
   *
   * O que a execução real mediu: com o bloqueio criado, a janela das 23:30 NÃO
   * é mais oferecida na tela de remarcar. Quem a tira é `availableSlots`
   * (`@/lib/portal/computed-slots`), e ela o faz pelo INTERVALO — monta o
   * horário candidato com a DURAÇÃO REAL da aula que está sendo movida
   * (`durationMs` — o INTERVALO exato desde o S5 da varredura final; 60 min
   * aqui) e descarta quem cruza um bloqueio:
   * `!occupied.some((o) => startMs < o.e && endMs > o.s)`. A janela em si
   * continua `publicada` no banco (conferido), e o cinto da RPC continua sendo a
   * última linha — ele é que não é mais ALCANÇÁVEL pelo navegador, porque a tela
   * não oferece o caminho.
   *
   * ENTÃO O CASO MEDE A MESMA DISTINÇÃO, na camada que hoje responde por ela, e
   * com CONTRASTE — que é o que separa "some porque a regra funciona" de "some
   * por qualquer motivo": a MESMA janela, para a MESMA aula, aparece quando não
   * há bloqueio e desaparece quando há. Uma checagem por INSTANTE deixaria a
   * oferta de pé nos dois casos (23:30 está FORA do dia bloqueado); é só a
   * checagem por INTERVALO que a derruba, porque a aula de 60 min entra 30
   * minutos DENTRO do bloqueio.
   */
  it('janela das 23:30: a oferta cai pelo INTERVALO — a aula de 60 min entra no dia bloqueado', async () => {
    const diaDaJanela = maisDias(hojeISO, 7)
    const diaBloqueado = maisDias(hojeISO, 8)
    const motivo = 'madrugada e2e A9'

    // 1. A aula que vai ser remarcada: 60 minutos, da professora da casa. Ela
    //    nasce pela porta da dona (`admin_create_single_class`), na madrugada de
    //    um dia futuro, longe da agenda semeada.
    const alunosDela = await (async () => {
      await abrir(page, enderecoDaAgenda(`?v=lista&prof=${profDaCasa.id}`))
      return page
        .locator('a[href^="/admin/alunos/"]')
        .evaluateAll((as) => [...new Set(as.map((a) => (a.textContent ?? '').trim()).filter(Boolean))])
    })()
    if (alunosDela.length === 0) {
      throw new Error(
        `a professora ${profDaCasa.nome} não tem nenhuma aula listada nos próximos 14 dias — ` +
          'sem isso não dá para saber qual contrato é dela.',
      )
    }

    await abrir(page, enderecoDaAgenda(`?v=dia&d=${diaDaJanela}&prof=${profDaCasa.id}&novo=avulsa`))
    const painel = page.locator(SHEET)
    await painel.waitFor({ state: 'visible', timeout: ESPERA })
    const seletor = painel.locator('select[name="contract_id"]')
    const opcoes = await seletor.locator('option').evaluateAll((os) =>
      os.map((o) => ({ valor: (o as HTMLOptionElement).value, texto: o.textContent ?? '' })).filter((o) => o.valor),
    )
    // O contrato precisa ser de aluno DELA **e** de fuso CUIABÁ: a hora que se
    // digita aqui vale no relógio do ALUNO (é a régua do A4), e com um aluno de
    // outro fuso os "05:30" digitados apareceriam noutra hora na grade — o
    // `find` abaixo pegaria a aula errada. O rótulo da opção traz a cidade
    // (`nome · plano · cidade`), então a escolha é conferida, não suposta.
    const dela = opcoes.find(
      (o) => alunosDela.some((nome) => o.texto.startsWith(nome)) && o.texto.includes('Cuiabá'),
    )
    if (!dela) {
      throw new Error(
        `nenhum contrato ativo de aluno de ${profDaCasa.nome} em CUIABÁ (vistos: ${alunosDela.join(', ')}) — ` +
          'o caso da janela das 23:30 precisa de aluno no fuso da grade',
      )
    }
    await seletor.selectOption(dela.valor)
    // Cortesia: a aula não é sobre dinheiro cobrado, e o campo de valor some
    // (`TipoEValorDaAvulsa` desmonta — grave 1 da rodada 1 do A4).
    await painel.locator('select[name="kind"]').selectOption('courtesy')
    await painel.locator('input[placeholder="dd/mm/aaaa"]').first().fill(paraOCampoDeData(diaDaJanela))
    await painel.locator('input[placeholder="HH:mm"]').first().fill('0530')
    await painel.locator('input[name="duration_min"]').fill('60')
    await painel.getByRole('button', { name: 'Criar aula avulsa' }).click()
    const criada = await recado(page)
    expect(criada, `a aula de 60 min não foi criada: ${criada}`).not.toContain('Falha')

    // 2. A janela das 23:30 do dia ANTERIOR ao bloqueio (fora dele).
    await publicarHorario(page, profDaCasa, diaDaJanela, '23:30')

    // 3. O bloqueio do dia seguinte — criado DEPOIS da publicação, que é a
    //    corrida que o cinto cobre (a janela não está dentro do período, então
    //    o fecho de janelas do A6/f não a alcança).
    await criarBloqueio(page, profDaCasa, diaBloqueado, diaBloqueado, motivo)

    try {
      // 4. A aula de 60 min tenta consumir a janela.
      await abrir(page, enderecoDaAgenda(`?v=dia&d=${diaDaJanela}&prof=${profDaCasa.id}`))
      const aulas = await aulasDaGrade(page)
      // É a aula das 05:30 que importa — o dia pode ter outras, dos horários
      // fixos. Como o contrato escolhido é de Cuiabá, a hora digitada é a mesma
      // que a grade desenha.
      const aula = aulas.find((a) => a.texto.includes('agendada') && a.texto.includes('05:30'))
      if (!aula) {
        throw new Error(
          'a aula avulsa de 60 min das 05:30 não apareceu como agendada na grade do dia — ' +
            'a criação passou mas a grade não a mostra?',
        )
      }

      const remarcar = `${BASE_URL}/admin/agenda/remarcar/${aula.id}`
      await abrir(page, remarcar)
      // "Furar antecedência": sem isso a ausência da oferta poderia ser a da
      // antecedência mínima da professora, que é OUTRA regra — e o caso mediria
      // outra coisa.
      // CORREÇÃO DA 1ª EXECUÇÃO REAL (30/07): o plano abria um `<details>` antes
      // — pressuposto falso sobre o DOM. "Opções da administração" é um
      // `CardPanel` com cabeçalho, SEMPRE aberto (o A7 matou o `<details>`
      // daquela tela); o `summary` não existe e o caso morria esperando por ele.
      // A caixa está à mão, sem gesto de abrir.
      await page.getByRole('checkbox', { name: /Furar antecedência mínima/ }).check()
      await page.getByRole('button', { name: 'Aplicar' }).click()
      await page.waitForURL(/furar=1/, { timeout: ESPERA })

      // A oferta é um LINK com a hora nua ("23:30"), que só ESCOLHE
      // (`?escolha=<janela>`); quem gasta franquia é o "Confirmar remarcação" do
      // painel de revisão. (O plano descrevia a tela VELHA — um `li` com "às
      // 23:30" e um botão "Remarcar para cá" dentro; o A7 refez os dois.)
      const oferta = page.getByRole('link', { name: '23:30', exact: true })

      // COM O BLOQUEIO: a janela some da lista. A janela em si continua
      // `publicada` — o que caiu foi a OFERTA, e caiu porque a aula de 60 min
      // que ela criaria entra 30 minutos dentro do dia bloqueado.
      //
      // O painel da lista tem de estar PINTADO antes de se afirmar ausência:
      // contar zero numa tela que ainda não renderizou é o falso-verde clássico.
      await page
        .getByText('Escolha o novo horário')
        .first()
        .waitFor({ state: 'visible', timeout: ESPERA })
      expect(
        await oferta.count(),
        'a janela das 23:30 continuou oferecida mesmo com o dia seguinte bloqueado — ' +
          'a filtragem voltou a ser por INSTANTE (23:30 está fora do bloqueio) em vez de por INTERVALO',
      ).toBe(0)

      // O CONTRASTE, que é o que torna a ausência uma PROVA: tirado o bloqueio,
      // a MESMA janela, para a MESMA aula, volta a ser oferecida. Sem esta
      // metade, o caso ficaria verde se a oferta sumisse por qualquer motivo —
      // horizonte, antecedência, janela cancelada, lista quebrada.
      await removerBloqueio(page, profDaCasa, motivo)
      await abrir(page, `${remarcar}?furar=1`)
      await expect
        .poll(() => oferta.count(), { timeout: ESPERA })
        .toBeGreaterThan(0)
    } finally {
      await removerBloqueio(page, profDaCasa, motivo)
    }
  })
})

/* ========================================================================== */
/* 2. DESFECHO E DIÁLOGO DESTRUTIVO (A5/A6)                                    */
/* ========================================================================== */

/**
 * ⚠️ A ORDEM DESTE BLOCO É DELIBERADA, e não estética.
 *
 * A bancada semeia UMA aula de hoje já terminada e sem registro (a linha
 * `scheduled/passado` do `preview-seed`), e o caso 9 a CONSOME — depois dele ela
 * está realizada e não há mais o que registrar. Por isso o caso 11, que precisa
 * da mesma aula para provocar a recusa do banco (e não muta nada: a recusa é o
 * ponto), vem ANTES. O caso 10a cancela uma aula FUTURA de hoje, que é outro
 * estoque. Quem trocar a ordem quebra o bloco inteiro — está escrito aqui para
 * que a quebra não pareça flake de bancada.
 */
describe('desfecho: o diálogo destrutivo e o que o banco fez', () => {
  /**
   * CASO 8 — O ACEITE LITERAL DO ADR-028, que a Onda 1 adiou por não ter
   * consumidor (`docs/decisions/028-aceite-alertdialog-adiado.md`): "AlertDialog
   * aberto DE DENTRO de um Sheet visível e focável". O consumidor chegou no
   * A6/lote 2 e é o painel "cancelar" da ficha — o próprio cabeçalho de
   * `CancelarAula.tsx` diz "é ELE que fecha o aceite literal; o e2e do par é
   * caso obrigatório do A9".
   *
   * As três metades do aceite: o diálogo pinta ACIMA do véu do Sheet, o FOCO
   * entra nele, e o Esc fecha SÓ ele — devolvendo o foco ao Sheet, que continua
   * vivo. Mais a regra de desenho que o primitivo exige: o conteúdo fica no
   * portal do `<body>` (nada de `container` apontando para dentro do Sheet, que
   * é `overflow-hidden` e cortaria a caixa).
   */
  it('AlertDialog aberto de dentro do Sheet: acima do véu, focável, e o Esc fecha só ele', async () => {
    // Uma aula FUTURA de um aluno com ficha — o link "Cancelar…" só existe
    // nelas.
    await abrir(page, enderecoDaAgenda('?v=lista'))
    const alunos = await page
      .locator('a[href^="/admin/alunos/"]')
      .evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href') ?? '').filter(Boolean))])
    let painelDeCancelar = ''
    // Teto de 8 fichas: com a bancada semeada a primeira já serve; o teto é para
    // o caso não morrer no timeout do runner procurando em quinze.
    for (const href of alunos.slice(0, 8)) {
      await abrir(page, `${BASE_URL}${href}?aba=historico`)
      const link = page.locator('a[href*="painel=cancelar"]')
      if ((await link.count()) > 0) {
        painelDeCancelar = (await link.first().getAttribute('href')) ?? ''
        break
      }
    }
    if (!painelDeCancelar) {
      throw new Error(
        'nenhuma ficha da bancada tem aula futura com "Cancelar…" — rode `npm run e2e:bancada`.',
      )
    }

    await abrir(page, `${BASE_URL}${painelDeCancelar}`)
    const sheet = page.locator(SHEET)
    await sheet.waitFor({ state: 'visible', timeout: ESPERA })
    expect(await page.locator('[data-slot="sheet-title"]').innerText()).toBe('Cancelar aula')

    // O CTA do rodapé do Sheet é o gatilho do diálogo (ele não envia mais
    // direto: quem envia é a confirmação).
    const cta = sheet.getByRole('button', { name: /^Cancelar a aula \(pedido d/ })
    await cta.click()

    const alerta = page.locator(ALERTA)
    await alerta.waitFor({ state: 'visible', timeout: ESPERA })

    const medida = await page.evaluate(
      ({ a, s }) => {
        const dialogo = document.querySelector(a) as HTMLElement
        const painel = document.querySelector(s) as HTMLElement
        return {
          zDialogo: Number(getComputedStyle(dialogo).zIndex),
          zSheet: Number(getComputedStyle(painel).zIndex),
          largura: Math.round(dialogo.getBoundingClientRect().width),
          // O conteúdo do diálogo NÃO pode morar dentro do Sheet: o corpo dele é
          // overflow-hidden e cortaria a caixa (regra 3 do cabeçalho do
          // primitivo).
          dentroDoSheet: painel.contains(dialogo),
        }
      },
      { a: ALERTA, s: SHEET },
    )
    expect(medida.zDialogo).toBeGreaterThanOrEqual(medida.zSheet)
    expect(medida.largura, 'o diálogo abriu sem caixa').toBeGreaterThan(0)
    expect(medida.dentroDoSheet, 'o diálogo foi parar DENTRO do Sheet (será cortado)').toBe(false)
    expect(await focoDentroDe(page, ALERTA), 'o foco não entrou no diálogo').toBe(true)

    // O conteúdo é a MATRIZ, não texto novo: consequência medida + a
    // irreversibilidade + as duas caixas de aviso.
    const texto = await alerta.innerText()
    expect(texto).toContain('Este registro não se desfaz')
    expect(texto).toContain('O que sai para o aluno junto com este cancelamento')
    expect(texto).toContain('Avisar o aluno por e-mail')
    expect(texto).toContain('Avisar o aluno por WhatsApp')

    // ESC FECHA SÓ A CAMADA DE CIMA.
    await page.keyboard.press('Escape')
    await alerta.waitFor({ state: 'detached', timeout: ESPERA })
    expect(await sheet.isVisible(), 'o Esc do diálogo derrubou o Sheet junto').toBe(true)
    await expect
      .poll(() => focoDentroDe(page, SHEET), { timeout: ESPERA })
      .toBe(true)
  })

  /**
   * CASO 11 — O RASCUNHO DOS CANAIS SOBREVIVE À RECUSA. É o P2 da rodada 2 do
   * Sol no A6: sem isso, a recusa RELIGAVA em silêncio o canal que a dona tinha
   * desmarcado — e a segunda tentativa mandava o aviso que ela decidiu não
   * mandar.
   *
   * A recusa usada é a do BANCO, não a do navegador: hora do aviso POSTERIOR ao
   * início de uma aula que já começou (`_cancel_class_core`: "aula já começou e
   * o aviso não a precedeu — use no_show…"). A hora futura, que era a recusa
   * óbvia, deixou de servir de propósito — desde o C10a ela nem abre o diálogo
   * (o `FormValidado` acende o erro no campo).
   */
  it('recusa do banco no cancelamento: ao reabrir, as escolhas de canal continuam como ela deixou', async () => {
    await abrir(page, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(page)
    const passada = aulas.find((a) => a.texto.includes('sem registro'))
    if (!passada) {
      throw new Error(
        'não há aula passada sem registro para provocar a recusa — rode `npm run e2e:bancada`. ' +
          '(Este caso roda ANTES do 9 de propósito: é o 9 que consome a aula.)',
      )
    }

    await abrirBalaoDaAula(page, passada.id, `?v=dia&d=${hojeISO}`)
    const balao = page.locator(POPOVER)
    await balao.getByRole('radio', { name: /Cancelada — quem pediu foi o aluno/ }).check()

    // A hora do aviso: DEPOIS do início da aula (que já passou) e antes de
    // agora — passa no `max` do campo e é recusada pelo banco.
    const horaDaAula = (await balao.innerText()).match(/\b(\d{2}):(\d{2})\b/)
    expect(horaDaAula, 'não consegui ler a hora da aula no balão').toBeTruthy()
    const depoisDoInicio = `${hojeISO}T${horaDaAula![1]}:${horaDaAula![2]}`
    await balao.locator('input[name="notified_at"]').fill(depoisDoInicio)

    await balao.getByRole('button', { name: /^Cancelar a aula \(pedido do aluno\)/ }).click()
    const alerta = page.locator(ALERTA)
    await alerta.waitFor({ state: 'visible', timeout: ESPERA })
    const caixaDeWhatsapp = alerta.getByRole('checkbox', { name: 'Avisar o aluno por WhatsApp' })
    if (await caixaDeWhatsapp.isChecked()) await caixaDeWhatsapp.uncheck()
    await alerta.getByRole('button', { name: /^Cancelar a aula \(pedido do aluno\)/ }).click()

    const frase = await recado(page)
    expect(frase, `esperava a recusa do banco, veio "${frase}"`).toContain('Falha')
    expect(frase).toContain('já começou')
    // A volta de erro reabre o balão DAQUELA aula (`?ev=`).
    expect(new URL(page.url()).searchParams.get('ev')).toBe(passada.id)

    const reaberto = page.locator(POPOVER)
    await reaberto.waitFor({ state: 'visible', timeout: ESPERA })
    // A escolha de desfecho voltou (é o que o rascunho guarda)…
    await expect
      .poll(
        () => reaberto.getByRole('radio', { name: /Cancelada — quem pediu foi o aluno/ }).isChecked(),
        { timeout: ESPERA },
      )
      .toBe(true)
    // …e a decisão de CANAL também: reabrir o diálogo mostra o WhatsApp
    // desmarcado, como ela deixou.
    await reaberto.getByRole('button', { name: /^Cancelar a aula \(pedido do aluno\)/ }).click()
    const alerta2 = page.locator(ALERTA)
    await alerta2.waitFor({ state: 'visible', timeout: ESPERA })
    expect(
      await alerta2.getByRole('checkbox', { name: 'Avisar o aluno por WhatsApp' }).isChecked(),
      'a recusa religou o WhatsApp que a dona tinha desmarcado',
    ).toBe(false)
    await alerta2.getByRole('button', { name: 'Voltar sem registrar' }).click()
  })

  /**
   * CASO 9 — DESFECHO DE PONTA A PONTA PELO BALÃO: "registrar realizada →
   * confirmação → o estado no BANCO bate com a consequência declarada na tela"
   * (o caso literal do §A9 do goal).
   *
   * O "banco" é lido pelas TRÊS superfícies que só ele alimenta: a situação da
   * aula na grade, a DECLARAÇÃO do estado (que a tela só escreve quando não há
   * mais nada a escolher) e a trilha do `audit_log` na aba Histórico. As três
   * juntas são a prova de que o que foi prometido antes do toque aconteceu.
   */
  it('registrar "realizada" pelo balão: confirmação, e o estado do banco bate com a promessa', async () => {
    await abrir(page, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(page)
    const pendente = aulas.find((a) => a.texto.includes('sem registro'))
    if (!pendente) {
      throw new Error(
        'hoje não há aula PASSADA e sem registro na bancada (a linha `scheduled/passado` do ' +
          'preview-seed) — rode `npm run e2e:bancada`.',
      )
    }

    await abrirBalaoDaAula(page, pendente.id, `?v=dia&d=${hojeISO}`)
    const balao = page.locator(POPOVER)

    // O QUE JÁ ESTAVA NA TELA antes deste ato. Este endereço é o MESMO para o
    // qual a recusa do caso 11 voltou, e o cookie do recado repinta no próprio
    // destino dentro dos 15s (comportamento declarado — ver `recadoNovo`).
    const recadoVelho = await recadoNaTela(page)

    // A ressalva da hora é dita UMA vez, e só em aula que já terminou.
    expect(await balao.innerText()).toContain('JÁ conta no extrato da professora')

    await balao.getByRole('radio', { name: 'A aula aconteceu' }).check()
    // O tema satisfaz `complete_class` quando a professora ainda não apontou —
    // é o caminho que a própria tela oferece com a frase de aviso.
    await balao.locator('[data-slot="select-trigger"]').first().click()
    const opcoesDoTema = page.locator('[data-slot="select-content"] [data-slot="select-item"]')
    await opcoesDoTema.first().waitFor({ state: 'visible', timeout: ESPERA })
    // A primeira é a sentinela "módulo do plano"; qualquer tema real serve.
    await opcoesDoTema.nth(1).click()

    await balao.getByRole('button', { name: 'Registrar como realizada' }).click()
    const alerta = page.locator(ALERTA)
    await alerta.waitFor({ state: 'visible', timeout: ESPERA })

    // A PROMESSA, antes do toque — a mesma frase da matriz, medida nas RPCs.
    const promessa = await alerta.innerText()
    expect(promessa).toContain('A hora CONTA no extrato da professora')
    expect(promessa).toContain('não ganha crédito de reposição')
    expect(promessa).toContain('Este registro não se desfaz')

    await alerta.getByRole('button', { name: 'Registrar como realizada' }).click()
    const frase = await recadoNovo(page, recadoVelho)
    expect(frase, `o registro falhou: ${frase}`).not.toContain('Falha')

    // O QUE O BANCO FEZ, lido de volta.
    await abrirBalaoDaAula(page, pendente.id, `?v=dia&d=${hojeISO}`)
    const depois = page.locator(POPOVER)
    const textoDepois = await depois.innerText()
    expect(textoDepois, 'a aula não ficou realizada no banco').toContain('realizada')
    // A declaração do estado (só existe quando não há mais desfecho a escolher)
    // repete a consequência no tempo do verbo passado — e nunca AFIRMA crédito.
    expect(textoDepois).toContain('A hora conta no extrato da professora')
    expect(textoDepois).toContain('não recebeu crédito de reposição')
    // …e não sobra formulário: `opcoesDaSituacao` fechou a matriz.
    expect(await depois.locator('input[name="desfecho"]').count()).toBe(0)

    // A TRILHA: o `audit_log` daquela aula ganhou o ato.
    await depois.getByRole('tab', { name: /^Histórico/ }).click()
    await expect
      .poll(() => depois.innerText(), { timeout: ESPERA })
      .not.toContain('Nada registrado na trilha desta aula ainda')
  })

  /**
   * CASO 10a — OS CHECKBOXES DE AVISO DECIDEM O QUE NASCE NA OUTBOX.
   * É a promessa central da migration 99 ("a escolha de avisar entra na
   * assinatura"): desmarcar e-mail tem de significar que a linha de e-mail NÃO
   * nasce. Quem responde é a tela de Mensagens (`/admin/avisos`), que é onde a
   * própria frase de sucesso manda conferir.
   */
  it('cancelar desmarcando o e-mail: a outbox NÃO ganha a linha de e-mail daquela aula', async () => {
    await abrir(page, enderecoDaAgenda(`?v=dia&d=${hojeISO}`))
    const aulas = await aulasDaGrade(page)
    const futura = aulas.find((a) => a.texto.includes('agendada'))
    if (!futura) {
      throw new Error('hoje não há aula AGENDADA para cancelar — rode `npm run e2e:bancada`.')
    }
    // A hora da aula identifica a linha na tela de Mensagens (o contexto dela é
    // "aula dd/LL às HH:mm", montado do payload).
    const hora = (futura.texto.match(/\b(\d{2}:\d{2})\b/) ?? [])[1] ?? ''
    expect(hora, 'não consegui ler a hora da aula no balão').toMatch(/^\d{2}:\d{2}$/)

    await abrirBalaoDaAula(page, futura.id, `?v=dia&d=${hojeISO}`)
    const balao = page.locator(POPOVER)
    await balao.getByRole('radio', { name: /Cancelada — quem pediu foi o aluno/ }).check()
    await balao.getByRole('button', { name: /^Cancelar a aula \(pedido do aluno\)/ }).click()

    const alerta = page.locator(ALERTA)
    await alerta.waitFor({ state: 'visible', timeout: ESPERA })
    const caixaDeEmail = alerta.getByRole('checkbox', { name: 'Avisar o aluno por e-mail' })
    // Ela pode nascer desmarcada (aluno sem login): o gesto é garantir o estado,
    // não presumi-lo.
    if (await caixaDeEmail.isChecked()) await caixaDeEmail.uncheck()
    expect(await caixaDeEmail.isChecked()).toBe(false)

    await alerta.getByRole('button', { name: /^Cancelar a aula \(pedido do aluno\)/ }).click()
    const frase = await recado(page)
    expect(frase, `o cancelamento falhou: ${frase}`).not.toContain('Falha')
    // A frase de sucesso segue a ESCOLHA, não o default: os três ramos possíveis
    // com o e-mail desmarcado (`ENTREGA_SO_WHATSAPP`,
    // `ENTREGA_SO_WHATSAPP_SEM_NUMERO`, `ENTREGA_NENHUMA`) dizem, cada um com as
    // suas palavras, que ela escolheu não avisar por e-mail.
    expect(
      frase,
      `o recado não declarou a escolha da dona: "${frase}"`,
    ).toContain('escolheu não avisar')

    // A OUTBOX: nenhuma linha de e-mail para aquela aula.
    // M3-3a: a lista virou a tabela do kit — a linha é `tr` e o canal é TEXTO
    // na coluna Canal ("E-mail"/"WhatsApp"), não mais o aria-label do ícone.
    await abrir(page, `${BASE_URL}/admin/avisos`)
    const linhasDaAula = page.locator('tbody tr', { hasText: 'Cancelamento de aula' }).filter({
      hasText: `às ${hora}`,
    })
    const canais = await linhasDaAula.evaluateAll((trs) => trs.map((tr) => tr.textContent ?? ''))
    expect(
      canais.some((c) => c.includes('E-mail')),
      `a outbox ganhou linha de E-MAIL para a aula das ${hora} mesmo com a caixa desmarcada (canais vistos: ${canais.join(' | ')})`,
    ).toBe(false)
  })

  /**
   * CASO 10b — AULA DE GRUPO: as duas caixas nascem LIGADAS e a frase é a "por
   * membro". É o grave que a prova independente do A6 achou: usar o cadastro do
   * aluno da ficha numa aula de grupo fazia as duas caixas nascerem desmarcadas
   * por causa DELE — e um toque em confirmar silenciava o aviso de TODOS.
   *
   * A tela NÃO SABE quem recebe o quê num grupo (`_enqueue_class_cancelled`
   * decide canal a canal, por membro), e "não sei" nunca pode virar "não".
   */
  it('aula de GRUPO: as duas caixas nascem ligadas, com a frase da entrega por membro', async () => {
    // O grupo da bancada aparece pelo rótulo dele (nunca por id chumbado).
    await abrir(page, enderecoDaAgenda('?v=lista'))
    const linhaDoGrupo = page.locator('li', { hasText: /\(casal\)|Grupo/ }).first()
    if ((await linhaDoGrupo.count()) === 0) {
      throw new Error(
        'a bancada não tem aula futura de contrato de GRUPO nos próximos 14 dias — ' +
          'o caso da entrega por membro precisa de uma.',
      )
    }
    // O menu "gerir" é um `<details>` fechado, mas o link já está no DOM: ler o
    // `href` não exige abrir a gaveta (e evita depender do papel ARIA que cada
    // navegador dá a um `<summary>`).
    const paraOBalao = await linhaDoGrupo
      .locator('a[href*="ev="]')
      .first()
      .getAttribute('href')
    expect(paraOBalao, 'a linha do grupo não trouxe o link do balão (?ev=)').toBeTruthy()

    await abrir(page, `${BASE_URL}${paraOBalao}`)
    const balao = page.locator(POPOVER)
    await balao.waitFor({ state: 'visible', timeout: ESPERA })
    await balao.getByRole('radio', { name: /Cancelada — quem pediu foi a professora/ }).check()
    await balao.getByRole('button', { name: /^Cancelar a aula \(pedido da professora\)/ }).click()

    const alerta = page.locator(ALERTA)
    await alerta.waitFor({ state: 'visible', timeout: ESPERA })
    expect(
      await alerta.getByRole('checkbox', { name: 'Avisar o aluno por e-mail' }).isChecked(),
      'a caixa de e-mail nasceu desmarcada numa aula de grupo — um toque silenciaria TODOS',
    ).toBe(true)
    expect(
      await alerta.getByRole('checkbox', { name: 'Avisar o aluno por WhatsApp' }).isChecked(),
      'a caixa de WhatsApp nasceu desmarcada numa aula de grupo',
    ).toBe(true)
    expect(await alerta.innerText()).toContain('Aula de grupo: o aviso é registrado por aluno')

    // Sai sem registrar nada: o caso é sobre como as caixas NASCEM.
    await alerta.getByRole('button', { name: 'Voltar sem registrar' }).click()
    await alerta.waitFor({ state: 'detached', timeout: ESPERA })
  })

})

/* ========================================================================== */
/* 3. AJUSTES E PROFESSORA                                                     */
/* ========================================================================== */

describe('Ajustes (A8) e o que a professora precisa saber', () => {
  /**
   * Smoke dos quatro blocos: a seção nasceu no A8 e nenhum e2e a abriu ainda.
   *
   * O MARCO É DE DENTRO DO BLOCO, nunca o rótulo da aba: as quatro abas estão na
   * tela nas quatro rotas, então cobrar "Mensagens" em `?bloco=mensagens` seria
   * asserção vácua — a família que o Sol listou sete vezes no A1.
   */
  it.each([
    { bloco: 'politica', marco: 'Contratos fora do padrão' },
    { bloco: 'janelas', marco: 'Janelas de horário' },
    { bloco: 'mensagens', marco: 'Mensagens que a escola envia' },
    { bloco: 'integracoes', marco: 'Os serviços de fora com que o sistema conversa' },
  ])('o bloco $bloco dos Ajustes abre e diz o que promete', async ({ bloco, marco }) => {
    const r = await page.goto(`${BASE_URL}/admin/ajustes?bloco=${bloco}`, {
      waitUntil: 'networkidle',
    })
    expect(r?.status(), `/admin/ajustes?bloco=${bloco} não respondeu 200`).toBe(200)
    expect(page.url()).toContain('/admin/ajustes')
    // `body`, e não `main`: a seção Ajustes devolve um fragmento — quem embrulha
    // é o shell do admin, que não usa `<main>`. Procurar por `main` aqui daria
    // "elemento não encontrado" no lugar de "a tela não diz o que promete".
    const texto = await page.locator('body').innerText()
    expect(texto).toContain(marco)
  })

  /**
   * CASO 12 — AVISO DE TROCA DE WHATSAPP PARA A TEACHER.
   *
   * A dívida que o criou (goal, §"As 4 dívidas do WhatsApp", 29/07): «o aluno
   * continua podendo TROCAR o próprio WhatsApp no portal, mas a Teacher passa a
   * ser avisada por e-mail quando isso acontece». Ele nasceu `todo` no A9
   * porque o enqueue não existia; o LOTE FINAL o construiu (migration
   * `20260730000400`, template `student-whatsapp-changed`) e o corpo é este.
   *
   * O QUE ELE ATRAVESSA, e é por isso que ele é e2e e não teste de banco: a
   * tela do portal (formulário de país + número), a server action do aluno, a
   * RPC `update_my_whatsapp` com o enqueue dentro da MESMA transação, e a tela
   * de Mensagens do admin, que é onde a dona confere. A prova de banco — quem
   * recebe, quem não recebe, o dedupe por dia — é
   * `tests/aviso-troca-whatsapp.test.ts`; aqui a pergunta é se as quatro
   * pontas estão ligadas.
   *
   * ⚠️ ESTE CASO MUTA A BANCADA (é o quarto): ele troca o número da Sabrina. O
   * rito da onda é reset + build antes de cada rodada; sem reset, a repetição
   * no MESMO dia civil não cria linha nova (o dedupe é por dia), e a asserção
   * continua verdadeira porque a linha do primeiro toque ainda está lá.
   */
  it('a troca de WhatsApp pelo aluno vira aviso para a professora, visível em Mensagens', async () => {
    const { ctx: doAluno, page: pa } = await contextoAluno(browser)
    try {
      await abrir(pa, `${BASE_URL}/portal/perfil`)
      // O campo composto: o `name` que a action lê é um input escondido, e quem
      // a pessoa preenche é o número LOCAL (o país fica no seletor ao lado). O
      // `id` vem do rótulo visível da tela — é o contrato do campo com o label.
      const numero = pa.locator('#whatsapp-do-perfil')
      await numero.waitFor({ state: 'visible', timeout: ESPERA })
      // Número da bancada, com dígito final variável para a troca ser real
      // mesmo quando alguém rodou o harness antes do reset.
      const novo = `65 9992${String(Date.now()).slice(-5)}`
      await numero.fill(novo)
      await pa.getByRole('button', { name: 'Salvar número' }).click()
      expect(await recado(pa)).toContain('Número atualizado')
    } finally {
      await doAluno.close()
    }

    // …e a escola vê o aviso na tela onde ela confere o que saiu. O nome é o
    // PORTUGUÊS do template: linha com nome cru em inglês é o defeito que o A5
    // matou no `class-cancelled`.
    await abrir(page, `${BASE_URL}/admin/avisos`)
    const linha = page.locator('tbody tr', { hasText: 'WhatsApp do aluno mudou' }).first()
    await linha.waitFor({ state: 'visible', timeout: ESPERA })
    // O destinatário é INTERNO: a professora do contrato ativo, nunca o aluno.
    // "sem destinatário definido" aqui significaria linha órfã — e a órfã desta
    // família seria resolvida pelo despachante como sendo do ALUNO.
    // M3-3a: o destinatário tem coluna própria ("Para", 2ª célula) — antes era
    // o texto "para <nome>" dentro da linha. A órfã com aluno no payload agora
    // se escreve "<aluno> (sem login)", e também não pode aparecer aqui.
    const para = (await linha.locator('td').nth(1).innerText()).trim()
    expect(para).not.toBe('')
    expect(para).not.toContain('sem destinatário definido')
    expect(para).not.toContain('(sem login)')
  })
})

/* ========================================================================== */
/* 4. DEPENDENTES DO A7 — escritos por último, e por isso ainda sem corpo      */
/* ========================================================================== */

/**
 * O A7 (pendências, lote, período/férias e remarcar) está REFAZENDO estas telas
 * agora. Escrever o corpo destes três casos contra a tela que vai morrer é
 * garantir harness vermelho por motivo errado — e "afrouxar depois" é como um
 * caso obrigatório vira caso esquecido.
 *
 * Ficam declarados como `todo` (o Vitest não tem `test.fixme`; `todo` é o que a
 * casa tem para "escrito, ainda sem corpo") com a origem e a régua de cada um,
 * para que quem fechar o A7 tenha o enunciado pronto:
 *
 *  · PERDA DE RASCUNHO ENTRE ABAS — dívida do A5 roteada ao A7 ("transporte
 *    único compartilhado: corrida do recado entre abas, rascunho apagado por
 *    outra aba"). A régua: o cookie de rascunho tem UMA gaveta; duas abas da
 *    Agenda com formulários diferentes não podem se sobrescrever em silêncio.
 *
 *  · O RECADO QUE REPINTA NA NAVEGAÇÃO DA SEÇÃO — mesma dívida: "o recado
 *    repinta em QUALQUER navegação da seção dentro dos 15s (não só no F5):
 *    clicar a aba Pendências repinta o '✓ Aula registrada', que num ato de
 *    dinheiro lê como segundo registro". A régua: um ato, um aviso.
 *
 *  · FILA DE PENDÊNCIAS COM A MAIS ANTIGA PRIMEIRO — o §A7 do goal ("a mais
 *    antiga grita primeiro"). A régua: a ordem da fila é do banco, e a tela não
 *    pode reordenar por acidente de render.
 */
describe('dependentes do A7 (a tela está sendo refeita — corpo depois)', () => {
  it.todo('rascunho de uma aba não é apagado pelo formulário de outra aba da Agenda [A7]')
  it.todo('o recado de um ato não repinta ao navegar entre as abas da seção [A7]')
  it.todo('a fila de pendências mostra a mais antiga primeiro [A7]')
})
