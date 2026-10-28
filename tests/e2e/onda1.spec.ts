// HARNESS DA ONDA 1 · M5 — o e2e das telas novas, contra a bancada local.
//
// ┌─ RITO (dois comandos) ────────────────────────────────────────────────────┐
// │  npm run e2e:bancada     # supabase db reset + preview-logins +           │
// │                          # preview-seed + next build                      │
// │  npm run test:e2e        # sobe `next start` na 3100, roda, derruba       │
// └───────────────────────────────────────────────────────────────────────────┘
// Se já houver servidor atendendo na 3100, o harness REUSA (e não o mata).
// Navegador: `npx playwright install chromium` na primeira vez.
//
// O QUE ESTE ARQUIVO PROVA (spec `docs/goals/onda-1-admin.md` §M5, adaptada ao
// que a onda virou depois do M3/M4):
//
//  1. SMOKE das seis telas novas, logado como admin: 200 + um MARCO de conteúdo
//     REAL de cada uma (frase que só existe ali). Status sozinho não prova tela:
//     uma página que renderiza o estado de erro também responde 200.
//  2. AXE nas mesmas seis: `serious`/`critical` = falha.
//  3. OVERLAYS em uso real: o Sheet com gatilho de verdade (Esc, clique fora,
//     foco DEVOLVIDO ao gatilho) e um segundo overlay aberto DE DENTRO de um
//     Sheet visível — ver a nota "SOBRE O ALERTDIALOG" logo abaixo.
//  4. REDIRECTS da tela velha de contratos, no navegador.
//  5. PONTEIRO GROSSO em tela larga: trilho aberto fixo, rótulos opacos.
//  6. PONTEIRO FINO: hover abre, mouse-out fecha — e o CLIQUE não deixa o
//     trilho preso aberto (a regressão que o dono achou em produção).
//
// ── SOBRE O ALERTDIALOG (desvio consciente, para a revisão do Sol) ───────────
// A spec do M5 pede "AlertDialog aberto DE DENTRO de um Sheet visível e
// focável". Varrendo o `src` inteiro: `components/kit/alert-dialog.tsx` NÃO TEM
// UM ÚNICO CONSUMIDOR — o type-to-confirm do encerrar (o candidato natural) é
// um campo de texto dentro do próprio Sheet, não um AlertDialog. Não há tela
// onde esse par exista, e inventar uma só para o teste seria fabricar UI.
// O que este arquivo faz, então, é provar o MESMO contrato de empilhamento com
// o par que EXISTE (a instrução da tarefa: "senão use o par que existir no
// kit") — o Select do kit aberto de dentro do Sheet `?painel=horario-novo`:
// conteúdo VISÍVEL acima do véu (z-60 × z-50), foco DENTRO dele, e Esc que
// fecha só a camada de cima, deixando o Sheet vivo.
// ✔ DECIDIDO — **ADR-028** (`docs/decisions/028-aceite-alertdialog-adiado.md`,
// 27/07/2026): o aceite literal fica ADIADO para a onda AGENDA, cuja tela de
// confirmação ("Delete Event" do TutorBird, modal com checkboxes de aviso) é o
// consumidor mapeado do primitivo; `kit/alert-dialog.tsx` permanece no kit com
// anotação de destino, e o e2e do par entra no harness daquela onda. Este teste
// substituto NÃO é provisório: ele cobre a mecânica de camadas que o site de
// fato exercita hoje, e continua valendo depois.
//
// ── SOBRE OS "308" (fato medido, contra a leitura ingênua) ───────────────────
// `/admin/contratos` faz `permanentRedirect` (308) — e é isso que o teste de
// unidade do M4-4 confere no código. No NAVEGADOR, porém, o Next 16 não devolve
// 308 na navegação de documento: ele responde 200 com o payload RSC carregando
// o destino E o código de permanência (`…;308;`), e o cliente aplica. Medido
// com curl autenticado. Por isso aqui se prova o COMPORTAMENTO (onde o
// navegador para) somado à permanência que viaja no payload — asserção de
// status HTTP 308 seria falsa contra este framework.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'

import {
  BASE_URL,
  abrirNavegador,
  ate,
  contextoAdmin,
  larguraDoTrilho,
  opacidadeDoRotulo,
  violacoesGraves,
} from './harness'

/** Bancada local varia (banco frio, primeira renderização de rota). */
const ESPERA = 20_000

let browser: Browser
let ctx: BrowserContext
let page: Page
/** Um contrato ATIVO de verdade da bancada — descoberto, nunca chumbado. */
let contratoId = ''

beforeAll(async () => {
  browser = await abrirNavegador()
  const sessao = await contextoAdmin(browser)
  ctx = sessao.ctx
  page = sessao.page

  await page.goto(`${BASE_URL}/admin/alunos/contratos?st=active`, { waitUntil: 'networkidle' })
  const hrefs = await page
    .locator('a[href^="/admin/contratos/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  const alvo = hrefs.find((h) => /^\/admin\/contratos\/[0-9a-f-]{36}$/.test(h))
  if (!alvo) {
    throw new Error(
      'a bancada não tem nenhum contrato ativo listado — rode `npm run e2e:bancada` antes do e2e.',
    )
  }
  contratoId = alvo.split('/').pop()!
}, 180_000)

afterAll(async () => {
  await ctx?.close()
  await browser?.close()
})

/* ========================================================================== */
/* 1 + 2. Smoke das telas novas e axe                                          */
/* ========================================================================== */

/**
 * As telas da onda e o MARCO de cada uma — frases que só existem ali.
 * `:contrato` é substituído pelo id descoberto na bancada.
 *
 * A sétima nasceu no portão visual do dono (27/07): o "ver por" do índice de
 * contratos virou cartão, e cartão precisa da tela que ele abre.
 */
const TELAS: { nome: string; rota: string; marcos: string[] }[] = [
  {
    nome: 'Início (os 8 KPIs em dois andares)',
    rota: '/admin',
    marcos: [
      // banda do mês (4)
      'Recebido no mês',
      'Previsto no mês',
      'Em atraso',
      'Alunos ativos',
      // andar do negócio (4)
      'Aulas desta semana',
      'Entradas e saídas do mês',
      'Ocupação das janelas',
      'Alunos por nível',
      // os dois andares, nomeados
      'Hoje',
      'Como a escola está',
    ],
  },
  {
    nome: 'Hub de Alunos',
    rota: '/admin/alunos',
    marcos: ['Ver por', 'Buscar aluno…', 'Novo aluno', 'Experimental', 'Sem contrato', 'Arquivado'],
  },
  {
    nome: 'Índice de Contratos (aba do hub)',
    rota: '/admin/alunos/contratos',
    marcos: ['Novo contrato', 'Ativos', 'Pausados', 'Mentoria', 'Abrir Mentoria'],
  },
  {
    nome: 'Grupo de contratos (o N2 que os cartões do "ver por" abrem)',
    rota: '/admin/alunos/contratos/grupo/situacao/active',
    marcos: ['Situação', 'Buscar neste grupo…', 'Contratos'],
  },
  {
    nome: 'Convites',
    rota: '/admin/alunos/convites',
    marcos: ['Com acesso', 'Convite pendente', 'Sem convite'],
  },
  {
    nome: 'Detalhe do contrato (5 seções)',
    rota: '/admin/contratos/:contrato',
    marcos: ['Dados & valores', 'Vigência & pausas', 'Horários fixos', 'Créditos', 'Assinatura'],
  },
  {
    nome: 'Wizard de novo contrato (etapa 1)',
    rota: '/admin/contratos/novo',
    marcos: [
      'Seis etapas — tipo, aluno, horários, valores, política e revisão. Nada é criado até a última.',
      'Que contrato é este',
      'Individual',
      'Casal ou turma',
    ],
  },
]

const endereco = (rota: string) => `${BASE_URL}${rota.replace(':contrato', contratoId)}`

describe('smoke das telas novas (200 + marco de conteúdo real)', () => {
  it.each(TELAS)('$nome responde e diz o que promete', async ({ rota, marcos }) => {
    const resposta = await page.goto(endereco(rota), { waitUntil: 'networkidle' })
    expect(resposta?.status(), `${rota} não respondeu 200`).toBe(200)
    // Ninguém foi parar no login nem numa página de erro do shell.
    expect(page.url(), `${rota} não parou onde devia`).toContain(rota.split('?')[0].replace(':contrato', contratoId))
    for (const marco of marcos) {
      await expect
        .poll(() => page.getByText(marco, { exact: false }).first().count(), { timeout: ESPERA })
        .toBeGreaterThan(0)
    }
  })

  it('o Início mostra OITO KPIs — quatro na banda do mês, quatro no andar do negócio', async () => {
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })
    // A conta é por ANDAR, e não um `.card-kpi` solto na página: os cartões da
    // fila de Pendências vestem a MESMA receita (são cartões clicáveis também),
    // e contá-los junto faria o teste dizer "11 KPIs" com a tela certa.
    //
    // c18 (portão visual do dono): a banda deixou de ser `.bg-ac-band` — a
    // lavagem agora é o pseudo-elemento de `.faixa-cheia`, que atravessa a
    // largura toda da área de conteúdo. O andar é o mesmo; o gancho mudou.
    await expect.poll(() => page.locator('.faixa-cheia .card-kpi').count(), { timeout: ESPERA }).toBe(4)
    await expect
      .poll(() => page.locator('section[aria-labelledby="andar-negocio"] .card-kpi').count(), { timeout: ESPERA })
      .toBe(4)
    // Cada número é porta para a tela que o explica (nenhum KPI decorativo).
    const destinos = await page
      .locator('.faixa-cheia .card-kpi, section[aria-labelledby="andar-negocio"] .card-kpi')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
    expect(destinos.filter((h) => h.startsWith('/admin/'))).toHaveLength(8)
  })

  /*
   * A FAIXA VAI DE LATERAL A LATERAL — provado no navegador (portão visual do
   * dono, 27/07/2026). O grep de `.faixa-cheia` prova que a regra existe; só o
   * navegador prova que ela PINTA mais largo que a coluna e que o transbordo
   * não virou rolagem horizontal (o defeito que a tesoura do shell evita).
   */
  it('a lavagem da banda é mais larga que a coluna — e não cria rolagem horizontal', async () => {
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })
    const medida = await page.evaluate(() => {
      const faixa = document.querySelector('.faixa-cheia')
      if (!faixa) return null
      const antes = getComputedStyle(faixa, '::before')
      const doc = document.documentElement
      return {
        secao: faixa.getBoundingClientRect().width,
        lavagem: Number.parseFloat(antes.width),
        cor: antes.backgroundColor,
        rolagemHorizontal: doc.scrollWidth - doc.clientWidth,
      }
    })
    expect(medida, 'a banda não foi encontrada na tela').not.toBeNull()
    // pinta o token da banda (#e3e4f8)
    expect(medida!.cor).toBe('rgb(227, 228, 248)')
    // e transborda a coluna dos dois lados, de verdade
    expect(medida!.lavagem).toBeGreaterThan(medida!.secao + 200)
    // …sem que um pixel disso vire barra de rolagem
    expect(medida!.rolagemHorizontal).toBeLessThanOrEqual(0)
  })

  it('o filtro de situação do hub tem os SETE botões do funil, como links', async () => {
    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' })
    const filtro = page.locator('nav[aria-label="Recortar por situação"], nav[aria-label*="situação"]').first()
    const botoes = filtro.locator('a')
    await expect.poll(() => botoes.count(), { timeout: ESPERA }).toBe(7)
    const textos = (await botoes.allInnerTexts()).map((t) => t.split('\n')[0].trim())
    expect(textos).toEqual(['Todos', 'Lead', 'Experimental', 'Ativo', 'Pausado', 'Sem contrato', 'Arquivado'])
    // Cada botão é ENDEREÇO (`?situacao=`), nunca onClick simulado.
    const hrefs = await botoes.evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    expect(hrefs[0]).toBe('/admin/alunos')
    expect(hrefs.slice(1).every((h) => h.includes('situacao='))).toBe(true)
  })
})

describe('axe (serious/critical = falha)', () => {
  it.each(TELAS)('$nome não tem violação grave de acessibilidade', async ({ rota }) => {
    await page.goto(endereco(rota), { waitUntil: 'networkidle' })
    const graves = await violacoesGraves(page)
    expect(
      graves,
      graves.map((v) => `${v.id} (${v.impact}) em ${v.alvos.join(', ')} — ${v.ajuda}`).join('\n'),
    ).toEqual([])
  })
})

/* ========================================================================== */
/* 3. Overlays do kit em uso real                                              */
/* ========================================================================== */

const SHEET = '[data-slot="sheet-content"]'
const VEU = '[data-slot="sheet-overlay"]'

/** O único gatilho de Sheet do site: "Registrar" na aula de hoje sem desfecho
 *  (a bancada garante uma — bloco "aulas de HOJE" do preview-seed). */
function gatilhoDoDesfecho(p: Page) {
  return p.getByRole('button', { name: 'Registrar', exact: true }).first()
}

describe('Sheet com gatilho de verdade (Início · Registrar desfecho)', () => {
  beforeAll(async () => {
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })
    await ate(
      async () => (await gatilhoDoDesfecho(page).count()) > 0,
      'a bancada não tem aula de HOJE já terminada e sem desfecho (o botão "Registrar" do Início não apareceu) — rode `npm run e2e:bancada`',
      ESPERA,
    )
  }, 60_000)

  it('abre, fecha por Esc e DEVOLVE o foco ao gatilho', async () => {
    await gatilhoDoDesfecho(page).click()
    await page.locator(SHEET).waitFor({ state: 'visible', timeout: ESPERA })
    expect(await page.locator('[data-slot="sheet-title"]').innerText()).toBe('Como foi a aula?')

    await page.keyboard.press('Escape')
    await page.locator(SHEET).waitFor({ state: 'detached', timeout: ESPERA })
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''), { timeout: ESPERA })
      .toBe('Registrar')
  })

  it('fecha por CLIQUE FORA e devolve o foco ao gatilho', async () => {
    await gatilhoDoDesfecho(page).click()
    await page.locator(SHEET).waitFor({ state: 'visible', timeout: ESPERA })

    // clique no véu, longe do painel (que é a faixa da direita)
    await page.locator(VEU).click({ position: { x: 400, y: 300 } })
    await page.locator(SHEET).waitFor({ state: 'detached', timeout: ESPERA })
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''), { timeout: ESPERA })
      .toBe('Registrar')
    // o mouse ficou sobre o trilho ao clicar no véu — tira ele de lá para os
    // testes de trilho não herdarem um hover pendurado
    await page.mouse.move(1200, 500)
  })
})

describe('overlay aberto DE DENTRO de um Sheet visível (ver a nota do cabeçalho)', () => {
  it('o Select do kit sobe acima do véu, é focável e o Esc fecha só ele', async () => {
    await page.goto(`${BASE_URL}/admin/contratos/${contratoId}?painel=horario-novo`, {
      waitUntil: 'networkidle',
    })
    await page.locator(SHEET).waitFor({ state: 'visible', timeout: ESPERA })
    expect(await page.locator('[data-slot="sheet-title"]').innerText()).toBe('Novo horário fixo')

    const gatilho = page.locator(`${SHEET} [data-slot="select-trigger"]`).first()
    await expect.poll(() => gatilho.count(), { timeout: ESPERA }).toBeGreaterThan(0)
    await gatilho.click()

    const conteudo = page.locator('[data-slot="select-content"]')
    await conteudo.waitFor({ state: 'visible', timeout: ESPERA })

    const medida = await page.evaluate(() => {
      const c = document.querySelector('[data-slot="select-content"]') as HTMLElement
      const s = document.querySelector('[data-slot="sheet-content"]') as HTMLElement
      return {
        zSelect: Number(getComputedStyle(c).zIndex),
        zSheet: Number(getComputedStyle(s).zIndex),
        largura: Math.round(c.getBoundingClientRect().width),
        focoEmSlot: document.activeElement?.getAttribute('data-slot') ?? '',
      }
    })
    // VISÍVEL: pintado acima do véu do Sheet, com caixa de verdade.
    expect(medida.zSelect).toBeGreaterThan(medida.zSheet)
    expect(medida.largura).toBeGreaterThan(0)
    // FOCÁVEL: o teclado entrou na camada de cima.
    expect(medida.focoEmSlot).toBe('select-item')

    // Esc fecha SÓ a camada de cima — o Sheet continua vivo.
    await page.keyboard.press('Escape')
    await conteudo.waitFor({ state: 'detached', timeout: ESPERA })
    expect(await page.locator(SHEET).isVisible()).toBe(true)

    // e o segundo Esc devolve para o detalhe (o painel é ENDEREÇO).
    await page.keyboard.press('Escape')
    await page.waitForURL(`**/admin/contratos/${contratoId}`, { timeout: ESPERA })
    expect(page.url()).not.toContain('painel=')
  })
})

describe('a superfície de assinatura atrás do gate 🔑 (ADR-029 §1), no navegador', () => {
  /*
   * A BANCADA NÃO TEM `AUTENTIQUE_TOKEN` — e é justamente esse o estado que
   * interessa provar aqui: o modo DESLIGADO, no servidor de verdade, com o
   * endereço colado à mão. O modo ligado é prova de unidade
   * (`c16-correcoes-sol-6.test.ts` desenha a seção nos dois modos): ligá-lo aqui
   * exigiria subir um segundo servidor com a env, e o que o navegador acrescenta
   * é exatamente o caminho do deep-link.
   */
  it.each(['assinatura', 'reserva-anexar', 'reserva-cancelar'])(
    '?painel=%s não abre Sheet nenhum — volta para o detalhe',
    async (painel) => {
      await page.goto(`${BASE_URL}/admin/contratos/${contratoId}?painel=${painel}`, {
        waitUntil: 'networkidle',
      })
      expect(page.url(), 'o painel não sobrevive ao gate').toBe(
        `${BASE_URL}/admin/contratos/${contratoId}`,
      )
      expect(await page.locator(SHEET).count()).toBe(0)
    },
  )

  it('e a seção Assinatura diz por que está em silêncio', async () => {
    await page.goto(`${BASE_URL}/admin/contratos/${contratoId}`, { waitUntil: 'networkidle' })
    await expect
      .poll(() => page.getByText('chave do Autentique', { exact: false }).first().count(), {
        timeout: ESPERA,
      })
      .toBeGreaterThan(0)
    expect(await page.getByText('Enviar para assinatura', { exact: false }).count()).toBe(0)
  })
})

/* ========================================================================== */
/* 4. Redirects da tela velha, no navegador                                    */
/* ========================================================================== */

describe('/admin/contratos — o mapa de encaminhamento, provado no navegador', () => {
  it('sem query, cai no índice novo — e a permanência (308) viaja no payload', async () => {
    await page.goto(`${BASE_URL}/admin/contratos`, { waitUntil: 'networkidle' })
    expect(page.url()).toBe(`${BASE_URL}/admin/alunos/contratos`)

    // O Next 16 responde 200 e manda o redirect no payload RSC; a permanência
    // está lá dentro, ao lado do destino. Ver a nota do cabeçalho.
    const payload = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/admin/contratos`, { headers: { RSC: '1' } })
      return r.text()
    }, BASE_URL)
    expect(payload).toContain('/admin/alunos/contratos')
    expect(payload).toContain(';308;')
  })

  it.each([
    ['individual', 'individual'],
    ['grupo', 'grupo'],
  ])('?novo=%s abre o wizard já no tipo certo', async (novo, tipo) => {
    await page.goto(`${BASE_URL}/admin/contratos?novo=${novo}`, { waitUntil: 'networkidle' })
    expect(page.url()).toBe(`${BASE_URL}/admin/contratos/novo?tipo=${tipo}`)
    await page.locator(SHEET).waitFor({ state: 'visible', timeout: ESPERA })
    const marcados = await page
      .locator(`${SHEET} input[type=radio]:checked`)
      .evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value))
    expect(marcados).toContain(tipo)
  })

  it('?novo= com lixo NÃO abre wizard sem tipo — vai para o índice', async () => {
    await page.goto(`${BASE_URL}/admin/contratos?novo=mentoria-que-nunca-existiu`, {
      waitUntil: 'networkidle',
    })
    expect(page.url()).toBe(`${BASE_URL}/admin/alunos/contratos`)
  })

  it('?q/?st/?ver são preservados no endereço novo', async () => {
    await page.goto(`${BASE_URL}/admin/contratos?q=Sabrina&st=paused&ver=professora`, {
      waitUntil: 'networkidle',
    })
    const url = new URL(page.url())
    expect(url.pathname).toBe('/admin/alunos/contratos')
    expect(url.searchParams.get('q')).toBe('Sabrina')
    expect(url.searchParams.get('st')).toBe('paused')
    expect(url.searchParams.get('ver')).toBe('professora')
    // e o recorte pedido é o que a tela mostra
    await expect
      .poll(() => page.getByRole('link', { name: /Pausados/ }).getAttribute('aria-current'), { timeout: ESPERA })
      .toBe('page')
  })

  it('?msg vira TOAST visível no índice novo (a ponte do AvisoLegado)', async () => {
    await page.goto(`${BASE_URL}/admin/contratos?msg=Convite%20enviado%20(harness)&n=42`, {
      waitUntil: 'networkidle',
    })
    expect(new URL(page.url()).pathname).toBe('/admin/alunos/contratos')
    const toast = page.locator('[data-sonner-toast]')
    await toast.first().waitFor({ state: 'visible', timeout: ESPERA })
    expect(await toast.first().innerText()).toContain('Convite enviado (harness)')
  })

  it('recado GANHA do wizard: ?msg junto de ?novo= para no índice', async () => {
    await page.goto(`${BASE_URL}/admin/contratos?novo=grupo&msg=Falha:%20teste%20do%20harness&n=7`, {
      waitUntil: 'networkidle',
    })
    expect(new URL(page.url()).pathname).toBe('/admin/alunos/contratos')
  })
})

/* ========================================================================== */
/* 5. Ponteiro GROSSO em tela larga (anotação do lote 5 + emenda v3)           */
/* ========================================================================== */

describe('trilho em ponteiro grosso (tablet/quiosque: hover:none em tela larga)', () => {
  it('fica ABERTO FIXO em 265px, com os rótulos visíveis e o espaçador junto', async () => {
    // `hasTouch + isMobile` é o que faz o Chromium responder `hover: none` e
    // `pointer: coarse` — a combinação que a mídia do globals endereça. A
    // largura de 1280 mantém o `min-width: 768px` da mesma regra.
    const { ctx: toque, page: pt } = await contextoAdmin(browser, {
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
      isMobile: true,
    })
    try {
      await pt.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })

      const midia = await pt.evaluate(() => ({
        semHover: matchMedia('(hover: none)').matches,
        grosso: matchMedia('(pointer: coarse)').matches,
        largo: matchMedia('(min-width: 768px)').matches,
      }))
      expect(midia).toEqual({ semHover: true, grosso: true, largo: true })

      // ABERTO FIXO, sem ninguém ter passado o mouse.
      expect(await larguraDoTrilho(pt)).toBe(265)
      // Rótulos opacos: sem isto o fade de repouso os deixaria invisíveis para
      // sempre, porque aqui não há hover para abrir.
      expect(await opacidadeDoRotulo(pt)).toBe(1)
      // E o espaçador reserva a largura aberta — senão o menu cobre o conteúdo.
      const espacador = await pt.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--rail-w-spacer').trim(),
      )
      expect(espacador).toBe('265px')
    } finally {
      await toque.close()
    }
  }, 120_000)
})

/* ========================================================================== */
/* 6. Ponteiro FINO: hover abre, mouse-out fecha, CLIQUE não prende            */
/* ========================================================================== */

describe('trilho em ponteiro fino (o trackpad do dono)', () => {
  beforeAll(async () => {
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })
    await page.mouse.move(1200, 500)
    await ate(async () => (await larguraDoTrilho(page)) === 64, 'o trilho não voltou ao repouso (64px)', ESPERA)
  }, 60_000)

  it('hover abre (265) e mouse-out fecha (64), rótulos acompanhando', async () => {
    await page.locator('nav.rail').hover()
    await expect.poll(() => larguraDoTrilho(page), { timeout: ESPERA }).toBe(265)
    await expect.poll(() => opacidadeDoRotulo(page), { timeout: ESPERA }).toBe(1)

    await page.mouse.move(1200, 500)
    await expect.poll(() => larguraDoTrilho(page), { timeout: ESPERA }).toBe(64)
    await expect.poll(() => opacidadeDoRotulo(page), { timeout: ESPERA }).toBe(0)
  })

  it('depois de CLICAR num item e tirar o mouse, o trilho NÃO fica preso aberto', async () => {
    // A regressão que o dono achou em produção: era `:focus-within`, e o clique
    // deixa foco no link — o trilho ficava aberto para sempre. Agora é
    // `:has(:focus-visible)`, que só lê o foco de TECLADO.
    await page.locator('nav.rail a[href="/admin/alunos"]').click()
    await page.waitForURL('**/admin/alunos', { timeout: ESPERA })
    await page.mouse.move(1200, 500)

    await expect.poll(() => larguraDoTrilho(page), { timeout: ESPERA }).toBe(64)
    await expect.poll(() => opacidadeDoRotulo(page), { timeout: ESPERA }).toBe(0)
  })

  it('o TAB (foco de teclado) continua abrindo o trilho — nos dois sentidos', async () => {
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' })
    await page.mouse.move(1200, 500)
    await expect.poll(() => larguraDoTrilho(page), { timeout: ESPERA }).toBe(64)

    await page.locator('nav.rail a[href="/admin/alunos"]').focus()
    // `.focus()` programático não marca `:focus-visible`; a tecla marca.
    await page.keyboard.press('Tab')
    await expect.poll(() => larguraDoTrilho(page), { timeout: ESPERA }).toBe(265)
  })
})
