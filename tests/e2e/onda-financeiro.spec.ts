// ONDA FINANCEIRO · F1 — o e2e do deep-link (mudança aprovada do plano):
// `?st=vencidas` tem de chegar com o recorte APLICADO NA CONSULTA — a tabela
// mostra SÓ as vencidas da bancada, não "tudo com um chip aceso".
//
// Rito (o mesmo das outras suítes): `npm run e2e:bancada` → `npm run test:e2e`.
// A bancada semeia 5 cobranças da Sabrina: 2 pagas, 1 vencida (R$ 680, há 12
// dias), 1 em aberto e 1 ESTORNADA com paid_at preenchido — a prova viva de
// que a régua velha (`!!paid_at → paga`) morreu.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'

import { BASE_URL, abrirNavegador, contextoAdmin, violacoesGraves } from './harness'

let browser: Browser
let ctx: BrowserContext
let page: Page

beforeAll(async () => {
  browser = await abrirNavegador()
  const sessao = await contextoAdmin(browser)
  ctx = sessao.ctx
  page = sessao.page
}, 180_000)

afterAll(async () => {
  await ctx?.close()
  await browser?.close()
})

/** As linhas visíveis da tabela de cobranças (tbody do kit). */
const LINHAS = 'table tbody tr'

describe('F1 — deep-links do Financeiro', () => {
  it('?st=vencidas: o recorte vem NA CONSULTA — só a vencida da bancada aparece', async () => {
    await page.goto(`${BASE_URL}/admin/pagamentos?st=vencidas`, { waitUntil: 'networkidle' })

    const linhas = page.locator(LINHAS)
    await expect.poll(() => linhas.count(), { timeout: 20_000 }).toBe(1)
    await expect
      .poll(() => linhas.first().innerText())
      .toMatch(/vencida/i)
    // A paga e a estornada NÃO estão na página — recorte de consulta, não CSS.
    const corpo = await page.locator('table tbody').innerText()
    expect(corpo).not.toMatch(/estornada/i)

    expect(await violacoesGraves(page)).toEqual([])
  })

  it('?st=pagas cai na aba Pagas; a estornada com paid_at NÃO está lá', async () => {
    await page.goto(`${BASE_URL}/admin/pagamentos?st=pagas`, { waitUntil: 'networkidle' })
    const aba = page.locator('nav[aria-label="Seções deste bloco"] a[aria-current="page"]')
    await expect.poll(() => aba.innerText(), { timeout: 20_000 }).toMatch(/Pagas/)

    const corpo = await page.locator('table tbody').innerText()
    expect(corpo).toMatch(/paga/i)
    // O caso que a tela velha mentia: REFUNDED com paid_at ficava em "pagas".
    expect(corpo).not.toMatch(/estornada/i)
  })

  it('a estornada vive em "Todas", com a voz própria', async () => {
    await page.goto(`${BASE_URL}/admin/pagamentos?st=todas`, { waitUntil: 'networkidle' })
    const corpo = await page.locator('table tbody').innerText()
    expect(corpo).toMatch(/estornada/i)
  })

  it('a aba Em aberto carrega o badge de vencidas (padrão Stripe)', async () => {
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' })
    const abaAberto = page.locator('nav[aria-label="Seções deste bloco"] a', {
      hasText: 'Em aberto',
    })
    await expect.poll(() => abaAberto.innerText(), { timeout: 20_000 }).toMatch(/1 vencida/)
  })
})
