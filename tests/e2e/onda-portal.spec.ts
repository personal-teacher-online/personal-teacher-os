// HARNESS DA ONDA DO PORTAL · P7 — o e2e das telas do ALUNO, contra a bancada.
//
// ┌─ RITO (os mesmos dois comandos da Onda 1) ────────────────────────────────┐
// │  npm run e2e:bancada     # supabase db reset + preview-logins +           │
// │                          # preview-seed + next build                      │
// │  npm run test:e2e        # sobe `next start` na 3100, roda, derruba       │
// └───────────────────────────────────────────────────────────────────────────┘
// Runner, config, portas e reuso de servidor: `vitest.e2e.config.ts` +
// `tests/e2e/{harness,servidor,porta}.ts`. Nada da Onda 1 foi tocado aqui.
//
// O QUE ESTE ARQUIVO PROVA — e por que cada coisa PRECISA de navegador:
//
//  1. SMOKE + AXE das dez telas do portal, logado como aluno de verdade (RLS e
//     gate por papel valendo). Marco de conteúdo REAL por tela: status 200
//     sozinho não distingue a tela do estado de erro dela.
//  2. FLASH DE PONTA A PONTA — a premissa que teste de unidade não alcança. Uma
//     ação real recusa, grava a frase no cookie `httpOnly` e redireciona; o
//     LAYOUT do portal (`RecadoDoPortal`) relê o cookie na tela de destino e o
//     toast pinta. O Router Cache do Next 16 poderia servir a moldura de cache e
//     engolir o recado — só o navegador responde isso. E o caso mais caro tem
//     nome: o recado tem de sobreviver ao REDIRECT DO GATE (`/portal` →
//     `/portal/briefing`), que foi exatamente onde ele se perdia antes da 2ª
//     rodada de correção do P4.
//  3. BRIEFING v2 (adulto) percorrido no navegador: as seis etapas preenchidas
//     no mínimo válido, o envio, e a tela "enviado" com o estilo de Kolb que o
//     BANCO tabulou (a UI nunca escolhe estilo — Lei 3).
//  4. BARRA DE POLEGAR: 5 colunas para quem é Personal Travel, 4 para quem não
//     é, alvos de 44px e `aria-current` na rota ativa. Em tela larga, a fila
//     horizontal — que NÃO é `fixed`.
//  5. D11 (login em disputa): `/login` serve a capa consolidada e
//     `/login?visual=proposta` a proposta, as duas sem violação grave de axe.
//  6. D1 (botão de entrar): aula distante mostra o botão DESLIGADO com o rótulo
//     de espera.
//
// ── OS DOIS ALUNOS DA BANCADA (e por que são dois) ───────────────────────────
// `/portal` é um gate: manda para `/portal/ciencia` quem não deu ciência do
// canal e para `/portal/briefing` quem não enviou o briefing. Com um aluno só,
// ou o Início nunca abre (e o smoke morre) ou o formulário v2 não existe (e o
// fluxo do briefing morre). O `preview-seed` semeia os dois lados:
// `aluno` (Sabrina) já atravessou o gate; `aluno-briefing` está parado nele.
//
// ── O RECADO SE PERDIA — CONSERTADO PELO K2 (ADR-030) ────────────────────────
// Este harness achou o defeito e a investigação do K2 o mediu na bancada
// (~120 rodadas instrumentadas, Next 16.2.10 + React 19.2.4):
//
//  · NÃO ERA O TOAST QUE ATRASAVA — ERA O COMMIT QUE NÃO ACONTECIA. Sondas de
//    render / `useLayoutEffect` / `useEffect` no `AvisoLegado` mostraram, nas
//    rodadas lentas, UM render do recado novo e NENHUM commit.
//  · O CONTADOR DO D1 ERA O SOCORRO, NÃO A CAUSA: o `setState` do tique de 30s
//    forçava o React a terminar o trabalho parado, e por isso o recado pintava
//    cravado em ~29 000 ms. Nas telas SEM contador — o briefing — não havia quem
//    forçasse e o recado NÃO CHEGAVA NUNCA. Foi esse o vermelho do teste do gate
//    aqui embaixo.
//
// CONSERTO (ADR-030): `src/components/kit/ResgateDoEnvio.tsx`, montado no
// `BotaoDeAcao` e nos quatro formulários de briefing/re-briefing. Se em 3s a
// árvore nova não foi comitada, ele recarrega a página — o cookie de flash (15s)
// ainda está vivo e o servidor entrega o desfecho no HTML novo, pelo caminho que
// já funcionava sem JavaScript. Rejeitado como mascaramento: encurtar o
// intervalo do D1.
//
// MEDIÇÃO (código real, bancada):
//   antes  · aula (8 rodadas) ..... 4 em ~150ms · 4 em ~29 000ms
//   antes  · briefing ............. recado perdido (e2e vermelho, 2 tentativas)
//   depois · aula (16 rodadas) .... 11 em ~150ms · 5 em ~3 350–3 850ms · 0 perdido
//   depois · briefing (10 rodadas)  6 em ~205ms · 4 em ~3 840ms · 0 perdido
//
// POR ISSO ESTE ARQUIVO AGORA COBRA ORÇAMENTO DE TEMPO (`TETO_DO_DESFECHO_MS`).
// Antes ele só media e imprimia, porque uma régua de tempo ficaria vermelha por
// sorteio; com o resgate o teto é determinístico — o caminho feliz mede ~150ms e
// o pior caminho, ~3,9s. Tirar o `ResgateDoEnvio` deixa este teste vermelho nas
// rodadas em que a corrida é perdida, que é exatamente o que se quer travar.
//
// ── LIMITAÇÕES REGISTRADAS (para a revisão) ──────────────────────────────────
// · D1 no estado ABERTO não é exercitado: a janela abre 15 min antes da aula, e
//   montá-la exigiria manipular o relógio (do servidor, porque é dele que sai o
//   `agoraNoServidorMs`) — o que este harness não faz. O estado `cedo` é o que
//   se prova; a fronteira exata dos 15 min já é medida em unidade
//   (`tests/…/entrar`), onde ela é aritmética pura.
// · O RE-BRIEFING semestral não entra: `briefing_update_pendente` exige contrato
//   individual ativo COM plano de estudos de semestre ≥ 2 cobrindo o dia de
//   hoje, e fabricar isso é um bloco de seed próprio (fica anotado no goal).
// · O fluxo do briefing ENVIA o briefing do `aluno-briefing`: numa REPETIÇÃO do
//   arquivo sem `npm run e2e:bancada` no meio, esse teste falha na etapa 1 (a
//   tela já é a de "enviado"). É o preço de exercitar o envio de verdade; o
//   rito da onda é reset + build antes de cada rodada.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'

import { BASE_URL, abrirNavegador, ate, contextoAluno, violacoesGraves } from './harness'

/** Bancada local varia (banco frio, primeira renderização de rota). */
const ESPERA = 20_000

/** Celular de referência da barra de polegar (iPhone 12/13/14). */
const CELULAR = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

let browser: Browser
let ctx: BrowserContext
/** Sabrina — o aluno que já passou pelo gate. */
let page: Page

/* Ids DESCOBERTOS na bancada, nunca chumbados. */
let aulaProxima = ''
let aulaDistante = ''
let aulaSemRegistro = ''

/** A seção de um balde da tela de aulas ("Próximas" / "Histórico"). */
function balde(p: Page, nome: string) {
  return p.locator('section').filter({ has: p.getByRole('heading', { level: 2, name: nome, exact: true }) })
}

const idDaRota = (href: string) => href.split('/').pop() ?? ''

beforeAll(async () => {
  browser = await abrirNavegador()
  const sessao = await contextoAluno(browser)
  ctx = sessao.ctx
  page = sessao.page

  // O gate tem de estar liberado para a Sabrina — se não estiver, o resto do
  // arquivo falharia dez vezes dizendo outra coisa.
  if (page.url() !== `${BASE_URL}/portal`) {
    throw new Error(
      `o aluno de preview parou em ${page.url()} em vez de /portal — o bloco "portal do aluno" ` +
        'do preview-seed rodou? (`npm run e2e:bancada`)',
    )
  }

  await page.goto(`${BASE_URL}/portal/aulas`, { waitUntil: 'networkidle' })

  const proximas = await balde(page, 'Próximas')
    .locator('a[href^="/portal/aula/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  if (proximas.length < 2) {
    throw new Error(
      `a bancada tem ${proximas.length} aula(s) futura(s) para o aluno de preview — o harness precisa ` +
        'de pelo menos duas (a próxima e uma distante). Rode `npm run e2e:bancada`.',
    )
  }
  aulaProxima = idDaRota(proximas[0])
  // A ÚLTIMA da lista é a mais distante: `upcomingClasses` ordena por começo. É
  // ela que garante o estado `cedo` do botão de entrar sem depender da hora em
  // que a suíte roda.
  aulaDistante = idDaRota(proximas[proximas.length - 1])

  const semRegistro = await balde(page, 'Histórico')
    .locator('li:has-text("ainda sem registro") a[href^="/portal/aula/"]')
    .first()
    .getAttribute('href')
  if (!semRegistro) {
    throw new Error(
      'a bancada não tem aula PASSADA ainda sem registro para o aluno de preview — é ela que ' +
        'provoca a recusa de "confirmar presença" do teste de flash. Rode `npm run e2e:bancada`.',
    )
  }
  aulaSemRegistro = idDaRota(semRegistro)
}, 180_000)

afterAll(async () => {
  await ctx?.close()
  await browser?.close()
})

/* ========================================================================== */
/* 1. Smoke das telas do portal e axe                                          */
/* ========================================================================== */

/**
 * As dez telas do portal e o MARCO de cada uma — frase que só existe ali.
 * `:proxima` é substituído pela aula descoberta na bancada.
 *
 * A Mentoria ENTRA porque o aluno de preview (Sabrina) tem contrato de mentoria
 * ativo no seed de bancada — é ele que faz a barra ter cinco colunas.
 */
const TELAS: { nome: string; rota: string; marcos: string[] }[] = [
  { nome: 'Início', rota: '/portal', marcos: ['Olá', 'Sua próxima aula', 'Precisa de suporte?'] },
  { nome: 'Aulas', rota: '/portal/aulas', marcos: ['Suas aulas', 'Próximas', 'Histórico'] },
  {
    nome: 'A aula (N3)',
    rota: '/portal/aula/:proxima',
    marcos: ['Sua aula', 'Precisa mudar alguma coisa?', 'Remarcar', 'Cancelar'],
  },
  { nome: 'Créditos', rota: '/portal/creditos', marcos: ['Seus créditos', 'Como funciona'] },
  { nome: 'Pagamentos', rota: '/portal/pagamentos', marcos: ['Pagamentos'] },
  { nome: 'Perfil', rota: '/portal/perfil', marcos: ['Seu perfil'] },
  { nome: 'Mentoria (Personal Travel)', rota: '/portal/mentoria', marcos: ['Personal Travel', 'Suas mentorias em grupo.'] },
  { nome: 'Briefing (já enviado)', rota: '/portal/briefing', marcos: ['Seu briefing', 'enviado ✓'] },
  { nome: 'Remarcar', rota: '/portal/remarcar/:proxima', marcos: ['Remarcar aula', '← Suas aulas'] },
  { nome: 'Cancelar', rota: '/portal/cancelar/:proxima', marcos: ['Cancelar aula', '← Suas aulas'] },
]

const endereco = (rota: string) => `${BASE_URL}${rota.replace(':proxima', aulaProxima)}`

describe('smoke das telas do portal (200 + marco de conteúdo real)', () => {
  it.each(TELAS)('$nome responde e diz o que promete', async ({ rota, marcos }) => {
    const resposta = await page.goto(endereco(rota), { waitUntil: 'networkidle' })
    expect(resposta?.status(), `${rota} não respondeu 200`).toBe(200)
    // Ninguém foi parar no login nem num gate: a tela pedida é a tela servida.
    expect(page.url(), `${rota} não parou onde devia`).toBe(endereco(rota))
    for (const marco of marcos) {
      await expect
        .poll(() => page.getByText(marco, { exact: false }).first().count(), { timeout: ESPERA })
        .toBeGreaterThan(0)
    }
  })
})

describe('axe no portal (serious/critical = falha)', () => {
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
/* 2. O FLASH DE PONTA A PONTA (caso obrigatório herdado do P4)                */
/* ========================================================================== */

describe('recado da ação: cookie → redirect → a MOLDURA repinta', () => {
  /*
   * A ação mais barata de provocar na bancada é `confirmarMinhaPresencaAction`
   * sobre uma aula que JÁ COMEÇOU: `confirm_my_class` recusa ("a aula já
   * começou"), a action grava a frase no cookie e devolve a pessoa à mesma
   * página. Nada é mutado — o teste pode repetir à vontade.
   */
  it('uma recusa REAL vira toast na tela de destino, dentro do teto, e a URL fica limpa', async () => {
    const { ms, frase } = await recusarPresenca(page, PACIENCIA_DO_HARNESS)
    expect(frase).toContain('já começou')
    // O recado atravessou por COOKIE: nada dele aparece no endereço.
    expect(new URL(page.url()).search).toBe('')
    // O ORÇAMENTO (ADR-030). Esta é a tela que desenha o `BotaoEntrar`: era aqui
    // que o recado pintava cravado em ~29 000 ms, no tique do contador, quando o
    // commit da navegação se perdia. Sem o `ResgateDoEnvio` a rodada perdida
    // estoura este teto; com ele o pior caso mede ~3,9 s.
    expect(
      ms,
      `o desfecho levou ${ms}ms — acima do teto de ${TETO_DO_DESFECHO_MS}ms. ` +
        'Ou o resgate do envio parou de funcionar, ou a corrida do Router mudou de forma (ADR-030).',
    ).toBeLessThan(TETO_DO_DESFECHO_MS)
    console.log(`[P7] o recado da recusa pintou em ${ms}ms`)
  })

  it('e o recado SOBREVIVE ao redirect do gate (/portal → /portal/briefing)', async () => {
    // Este é o defeito determinístico que a 2ª rodada do P4 consertou: o aluno
    // que ainda não passou pelo gate agia, era mandado para `/portal`, o gate o
    // desviava — e o desfecho do ato dele sumia no caminho.
    const { ctx: gated, page: pg } = await contextoAluno(browser, { como: 'aluno-briefing' })
    try {
      // A ida também é cobrada pelo teto (ADR-030): o briefing é a tela SEM
      // contador, onde o commit perdido não tinha quem o forçasse — foi por aqui
      // que este teste ficou vermelho antes do `ResgateDoEnvio`.
      const msDaRecusa = await recusarEtapa1(pg)
      expect(
        msDaRecusa,
        `a recusa da etapa 1 levou ${msDaRecusa}ms — acima do teto de ${TETO_DO_DESFECHO_MS}ms (ADR-030).`,
      ).toBeLessThan(TETO_DO_DESFECHO_MS)

      // Navegação de DOCUMENTO (não client-side): a árvore React morre e o
      // toast tem de renascer do cookie, na tela do gate.
      await pg.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle' })
      expect(pg.url(), 'o gate não levou para o briefing').toBe(`${BASE_URL}/portal/briefing`)

      const toast = pg.locator('[data-sonner-toast]')
      await toast.first().waitFor({ state: 'visible', timeout: ESPERA })
      expect(await toast.first().innerText()).toContain('forma de contato')
    } finally {
      await gated.close()
    }
  }, 120_000)
})

/**
 * O TETO DO DESFECHO (ADR-030) — quanto a pessoa pode esperar pela notícia do
 * próprio ato antes de isto virar defeito.
 *
 * Medido, não escolhido por conforto: com o `ResgateDoEnvio` o caminho feliz
 * mede ~150 ms e o pior caminho (corrida perdida → recarga) ~3,9 s. 10 s deixa
 * quase 3x de folga sobre o pior caso e continua MUITO abaixo dos ~29 000 ms do
 * defeito, então o teto separa as duas coisas sem sortear vermelho.
 */
const TETO_DO_DESFECHO_MS = 10_000

/**
 * Quanto o harness ESPERA antes de dizer que o recado NÃO VEIO.
 *
 * Maior que o teto de propósito: assim "não veio nunca" e "veio tarde demais"
 * viram dois vermelhos DIFERENTES — um estoura no `waitFor`, o outro na régua
 * de tempo, e a mensagem diz qual dos dois aconteceu.
 */
const PACIENCIA_DO_HARNESS = 30_000

/**
 * Clica em "Confirmar presença" numa aula que JÁ COMEÇOU — `confirm_my_class`
 * recusa, a action grava a frase no cookie e redireciona. Devolve a frase que
 * apareceu e QUANTO TEMPO ela demorou.
 */
async function recusarPresenca(p: Page, paciencia: number): Promise<{ ms: number; frase: string }> {
  await p.goto(`${BASE_URL}/portal/aula/${aulaSemRegistro}`, { waitUntil: 'networkidle' })
  const botao = p.getByRole('button', { name: 'Confirmar presença' })
  await ate(
    async () => (await botao.count()) > 0,
    'a aula passada da bancada não oferece "Confirmar presença" — ela ainda está agendada e sem registro?',
    ESPERA,
  )

  const t0 = Date.now()
  await botao.click()
  const toast = p.locator('[data-sonner-toast]')
  await toast.first().waitFor({ state: 'visible', timeout: paciencia })
  return { ms: Date.now() - t0, frase: await toast.first().innerText() }
}

/**
 * Envia a etapa 1 do briefing SEM marcar nenhuma forma de contato — os três
 * campos de texto vão preenchidos porque são `required` no HTML, e o que se quer
 * exercitar é a recusa do SERVIDOR, não o balão do navegador.
 *
 * A recusa devolve a pessoa à MESMA URL (`?etapa=1`), então não há mudança de
 * endereço para esperar: o sinal de que a ação completou é o próprio recado
 * aparecendo — que é, ele mesmo, o caminho cookie → redirect → moldura.
 *
 * Devolve QUANTO TEMPO o recado levou: quem chama cobra o teto do ADR-030.
 */
async function recusarEtapa1(p: Page): Promise<number> {
  await p.goto(`${BASE_URL}/portal/briefing?etapa=1`, { waitUntil: 'networkidle' })
  await p.fill('input[name="cidade_vida"]', 'Cuiabá')
  await p.fill('textarea[name="facil"]', 'Ler')
  await p.fill('textarea[name="dificil"]', 'Falar')
  const t0 = Date.now()
  await p.getByRole('button', { name: 'Salvar e continuar' }).click()
  const toast = p.locator('[data-sonner-toast]', { hasText: 'forma de contato' })
  await toast.first().waitFor({ state: 'visible', timeout: PACIENCIA_DO_HARNESS })
  return Date.now() - t0
}

/* ========================================================================== */
/* 3. O BRIEFING v2, percorrido (caso obrigatório herdado do P2)               */
/* ========================================================================== */

/** Avança uma etapa e, se o portal recusar, diz o que ele disse. */
async function avancar(p: Page, destino: number): Promise<void> {
  await p.getByRole('button', { name: 'Salvar e continuar' }).click()
  try {
    await p.waitForURL((u) => u.searchParams.get('etapa') === String(destino), { timeout: ESPERA })
  } catch {
    const recado = await p
      .locator('[data-sonner-toast]')
      .first()
      .innerText()
      .catch(() => '(nenhum toast na tela)')
    throw new Error(`o briefing não avançou para a etapa ${destino} — o portal disse: ${recado}`)
  }
}

describe('briefing v2 (adulto): as seis etapas no navegador', () => {
  it('preenche o mínimo válido, envia e vê o estilo de Kolb que o BANCO tabulou', async () => {
    const { ctx: novo, page: pb } = await contextoAluno(browser, { como: 'aluno-briefing' })
    try {
      // O gate leva sozinho para o briefing — é assim que o aluno real chega.
      // ESPERAR, e não afirmar de imediato: o `redirect()` de um Server
      // Component não chega ao navegador como 3xx de documento (mesma medição do
      // cabeçalho "SOBRE OS 308" do harness da Onda 1) — o Next 16 responde 200
      // com o destino no payload RSC e é o CLIENTE que troca de endereço. Um
      // `expect(url)` logo depois do `domcontentloaded` lê o endereço de antes.
      await pb.waitForURL(`${BASE_URL}/portal/briefing`, { timeout: ESPERA })
      await pb.goto(`${BASE_URL}/portal/briefing?etapa=1`, { waitUntil: 'networkidle' })

      // 1 · sua história
      await pb.fill('input[name="cidade_vida"]', 'Cuiabá')
      await pb.fill('textarea[name="facil"]', 'Entender o que leio')
      await pb.fill('textarea[name="dificil"]', 'Falar sem travar')
      await pb.check('input[name="contato"][value="Aulas particulares"]')
      await avancar(pb, 2)

      // 2 · objetivos (ramo adulto). "Viagens" no lugar de "Trabalho / carreira"
      // de propósito: a finalidade profissional acenderia a exigência dos três
      // tópicos, e o caminho mínimo é o que se quer medir aqui.
      await pb.check('input[name="finalidades"][value="Viagens"]')
      await pb.check('input[name="finalidade_principal"][value="Viagens"]')
      await pb.fill('textarea[name="alvo_6_meses"]', 'Me virar sozinha numa viagem')
      await pb.check('input[name="onde_trava"][value="Falar"]')
      await pb.check('input[name="correcao_preferida"][value="No fim da fala"]')
      await pb.check('input[name="tempo_diario"][value="10 min/dia"]')
      // Viagem e intercâmbio ficam EM BRANCO de propósito: o banco não as cobra,
      // e desde o K1 (`required={false}` + `tests/briefing-v2-required-dom.test.ts`)
      // o navegador também não — antes disso elas barravam a etapa 2 aqui.
      await avancar(pb, 3)

      // 3 · interesses: os 6 hobbies do mínimo + "não" nas três sim/não (com
      // "não" o banco não cobra o detalhe).
      const hobbies = pb.locator('input[name="hobbies"]')
      for (let i = 0; i < 6; i++) await hobbies.nth(i).check()
      for (const campo of ['leitura', 'filmes_series', 'musicas']) {
        await pb.check(`input[name="${campo}"][value="não"]`)
      }
      await avancar(pb, 4)

      // 4 · rotina: um bloco livre na semana + uma imersão
      await pb.locator('input[name="blocos"]').first().check()
      await pb.locator('input[name="imersao"]').first().check()
      await avancar(pb, 5)

      // 5 · Kolb: as 12 questões (a letra é indiferente — quem tabula é o banco)
      for (let q = 1; q <= 12; q++) await pb.check(`input[name="q${q}"][value="A"]`)
      await avancar(pb, 6)

      // 6 · fechar e enviar
      await pb.getByRole('button', { name: 'Enviar briefing' }).click()
      await pb.waitForURL(`${BASE_URL}/portal/briefing`, { timeout: ESPERA })

      await expect
        .poll(() => pb.getByText('enviado ✓', { exact: false }).first().count(), { timeout: ESPERA })
        .toBeGreaterThan(0)
      const estilo = await pb.getByText('Seu estilo de aprendizagem', { exact: false }).first().innerText()
      expect(estilo).toMatch(/Divergente|Assimilador|Convergente|Acomodador/)

      // …e o portal deixou de ser um gate para ele: `/portal` abre.
      await pb.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle' })
      expect(pb.url()).toBe(`${BASE_URL}/portal`)
    } finally {
      await novo.close()
    }
  }, 180_000)
})

/* ========================================================================== */
/* 3b. O RE-BRIEFING SEMESTRAL, percorrido (caso obrigatório herdado do P2)    */
/* ========================================================================== */

/**
 * O outro fluxo que o goal do P7 cobra por escrito ("fluxo v2 do briefing e
 * RE-BRIEFING") e que o harness não tinha. Ele é diferente do briefing base em
 * três coisas, e é por elas que um teste de unidade não substitui este:
 *
 *  1. o convite nasce no INÍCIO, não num gate — é um cartão que a pessoa pode
 *     ignorar, então "ele aparece" e "ele some depois do envio" são a única
 *     prova de que a regra única (`briefing_update_pendente`) governa a tela;
 *  2. as duas etapas chegam PRÉ-PREENCHIDAS com o briefing efetivo do ciclo
 *     anterior, atravessando o dicionário. Se o prefill quebrar, o e2e passa a
 *     enviar formulário vazio e o BANCO recusa — o vermelho aparece aqui, no
 *     lugar onde a pessoa real esbarraria;
 *  3. o desfecho volta para `/portal` com toast, e não para a própria tela.
 *
 * Como o do briefing base, este caso CONSOME o estado da bancada (depois do
 * envio não há mais atualização pendente para este aluno). Duas passadas
 * seguidas do e2e exigem `npm run e2e:bancada` entre elas — é o combinado do
 * rito, não uma fragilidade nova.
 */
describe('re-briefing semestral: do convite no Início ao envio', () => {
  it('o card leva às duas etapas pré-preenchidas, o envio confirma e o convite some', async () => {
    const { ctx: novo, page: pr } = await contextoAluno(browser, { como: 'aluno-rebriefing' })
    try {
      await pr.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle' })
      // Passou pelo gate (ciência dada, briefing base enviado): quem tem
      // re-briefing pendente entra no Início, não numa tela obrigatória.
      expect(pr.url()).toBe(`${BASE_URL}/portal`)

      // 1 · o CONVITE está na tela — e é um link para a atualização
      const convite = pr.locator('a[href="/portal/briefing/atualizar"]')
      await ate(
        async () => (await convite.count()) > 0,
        'o Início do aluno de re-briefing não desenhou o convite "Seu plano do semestre … está chegando" — ' +
          'o bloco "3º login com RE-BRIEFING semestral pendente" do preview-seed rodou? (`npm run e2e:bancada`)',
        ESPERA,
      )
      expect(await convite.first().innerText()).toContain('está chegando')

      await convite.first().click()
      await pr.waitForURL(`${BASE_URL}/portal/briefing/atualizar`, { timeout: ESPERA })
      expect(await pr.getByRole('heading', { level: 1 }).first().innerText()).toContain('o que mudou?')

      // 2 · etapa 1 (objetivos) chega PRÉ-PREENCHIDA com o que ele respondeu no
      // briefing base — nada é digitado aqui de propósito: o que se prova é que
      // confirmar o que já está na tela basta para o banco aceitar.
      const alvo = pr.locator('textarea[name="alvo_6_meses"]')
      await alvo.waitFor({ state: 'visible', timeout: ESPERA })
      expect((await alvo.inputValue()).trim().length).toBeGreaterThan(0)
      expect(await pr.locator('input[name="finalidade_principal"]:checked').count()).toBe(1)

      await pr.getByRole('button', { name: 'Salvar e continuar' }).click()
      try {
        await pr.waitForURL((u) => u.searchParams.get('etapa') === '2', { timeout: ESPERA })
      } catch {
        const recado = await pr
          .locator('[data-sonner-toast]')
          .first()
          .innerText()
          .catch(() => '(nenhum toast na tela)')
        throw new Error(`a atualização não avançou para a etapa 2 — o portal disse: ${recado}`)
      }

      // 3 · etapa 2 (interesses), também pré-preenchida: os 6 hobbies do mínimo
      // já vêm marcados do briefing base.
      expect(await pr.locator('input[name="hobbies"]:checked').count()).toBeGreaterThanOrEqual(6)

      const t0 = Date.now()
      await pr.getByRole('button', { name: 'Enviar atualização' }).click()

      // 4 · o desfecho: volta para o Início com o recado do cookie na tela
      await pr.waitForURL(`${BASE_URL}/portal`, { timeout: PACIENCIA_DO_HARNESS })
      const toast = pr.locator('[data-sonner-toast]', { hasText: 'Atualização enviada' })
      await toast.first().waitFor({ state: 'visible', timeout: PACIENCIA_DO_HARNESS })
      expect(Date.now() - t0).toBeLessThan(TETO_DO_DESFECHO_MS)

      // 5 · …e o convite SUMIU — a mesma regra que o desenhou o apaga.
      await expect
        .poll(() => pr.locator('a[href="/portal/briefing/atualizar"]').count(), { timeout: ESPERA })
        .toBe(0)
    } finally {
      await novo.close()
    }
  }, 180_000)
})

/* ========================================================================== */
/* 4. A barra de polegar (celular) × a fila horizontal (tela larga)            */
/* ========================================================================== */

/** O `<nav>` que está VISÍVEL agora — os dois vivem no DOM e se alternam por
 *  `display`, então só um deles é anunciado por vez. */
const navVisivel = (p: Page) => p.locator('nav[aria-label="Seções do portal"]:visible')

describe('navegação do portal', () => {
  it('no CELULAR: barra inferior com 5 colunas (Personal Travel), alvos de 44px e aria-current', async () => {
    const { ctx: cel, page: pc } = await contextoAluno(browser, CELULAR)
    try {
      await pc.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle' })
      const barra = navVisivel(pc)
      await expect.poll(() => barra.count(), { timeout: ESPERA }).toBe(1)

      // Fixada no rodapé (é o polegar que a alcança), e não a fila do topo.
      expect(await barra.evaluate((n) => getComputedStyle(n).position)).toBe('fixed')

      const itens = barra.locator('a')
      await expect.poll(() => itens.count(), { timeout: ESPERA }).toBe(5)
      const rotulos = (await itens.allInnerTexts()).map((t) => t.trim())
      expect(rotulos).toEqual(['Início', 'Aulas', 'Pagamentos', 'Mentoria', 'Perfil'])

      // Alvo de toque: a régua da casa é 44px, e o item declara `min-h-14` (56).
      const alturas = await itens.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))
      expect(Math.min(...alturas)).toBeGreaterThanOrEqual(44)

      // A rota ativa é a do Início, e só ela.
      const marcados = await itens.evaluateAll((as) =>
        as.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href')),
      )
      expect(marcados).toEqual(['/portal'])

      // E o item aceso segue a navegação.
      await pc.goto(`${BASE_URL}/portal/pagamentos`, { waitUntil: 'networkidle' })
      await expect
        .poll(
          () =>
            navVisivel(pc)
              .locator('a[aria-current="page"]')
              .evaluateAll((as) => as.map((a) => a.getAttribute('href'))),
          { timeout: ESPERA },
        )
        .toEqual(['/portal/pagamentos'])
    } finally {
      await cel.close()
    }
  }, 120_000)

  it('quem NÃO é Personal Travel vê 4 colunas — a aba Mentoria é condicional', async () => {
    const { ctx: cel, page: pc } = await contextoAluno(browser, { como: 'aluno-briefing', ...CELULAR })
    try {
      // Rota SEM gate de propósito: `/portal` deste aluno pode estar trocando de
      // endereço no cliente (o gate do briefing), e medir a barra no meio de uma
      // navegação mede o DOM que está morrendo. A barra é a mesma em toda rota.
      await pc.goto(`${BASE_URL}/portal/aulas`, { waitUntil: 'networkidle' })
      const itens = navVisivel(pc).locator('a')
      await expect.poll(() => itens.count(), { timeout: ESPERA }).toBe(4)
      expect((await itens.allInnerTexts()).map((t) => t.trim())).toEqual([
        'Início',
        'Aulas',
        'Pagamentos',
        'Perfil',
      ])
    } finally {
      await cel.close()
    }
  }, 120_000)

  it('no DESKTOP: fila horizontal no topo (não fixa), com o item aceso', async () => {
    await page.goto(`${BASE_URL}/portal/creditos`, { waitUntil: 'networkidle' })
    const fila = navVisivel(page)
    await expect.poll(() => fila.count(), { timeout: ESPERA }).toBe(1)
    expect(await fila.evaluate((n) => getComputedStyle(n).position)).not.toBe('fixed')
    // Créditos é rota-filha do mundo "Aulas" (`tambem`): quem navega para dentro
    // de uma reposição não pode ver a barra apagar.
    await expect
      .poll(
        () =>
          fila.locator('a[aria-current="page"]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))),
        { timeout: ESPERA },
      )
      .toEqual(['/portal/aulas'])
  })
})

/* ========================================================================== */
/* 5. D11 — as duas capas de login, lado a lado                                */
/* ========================================================================== */

describe('D11: /login serve a consolidada e ?visual=proposta serve a proposta', () => {
  let anon: BrowserContext
  let pl: Page

  beforeAll(async () => {
    // Sem sessão: `/login` é rota pública e é assim que o aluno real a encontra.
    anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    pl = await anon.newPage()
  }, 60_000)

  afterAll(async () => {
    await anon?.close()
  })

  it('sem query, a CAPA NOTURNA consolidada (a incumbente que vence por padrão)', async () => {
    const r = await pl.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
    expect(r?.status()).toBe(200)
    // O cartão de vidro é o marcador da consolidada; a proposta não o tem.
    await expect.poll(() => pl.locator('.glass').count(), { timeout: ESPERA }).toBe(1)
    expect(await pl.locator('[data-visual="proposta"]').count()).toBe(0)
    expect(await pl.getByRole('heading', { name: 'Bem-vindo de volta' }).count()).toBe(1)
  })

  it('com ?visual=proposta, a PROPOSTA — pelo marcador estável dela', async () => {
    const r = await pl.goto(`${BASE_URL}/login?visual=proposta`, { waitUntil: 'networkidle' })
    expect(r?.status()).toBe(200)
    await expect.poll(() => pl.locator('main[data-visual="proposta"]').count(), { timeout: ESPERA }).toBe(1)
    expect(await pl.locator('.glass').count()).toBe(0)
    // A CÓPIA é a mesma nas duas de propósito (a disputa é só de visual).
    expect(await pl.getByRole('heading', { name: 'Bem-vindo de volta' }).count()).toBe(1)
  })

  it.each([
    ['consolidada', '/login'],
    ['proposta', '/login?visual=proposta'],
  ])('a capa %s não tem violação grave de acessibilidade', async (_nome, rota) => {
    await pl.goto(`${BASE_URL}${rota}`, { waitUntil: 'networkidle' })
    const graves = await violacoesGraves(pl)
    expect(
      graves,
      graves.map((v) => `${v.id} (${v.impact}) em ${v.alvos.join(', ')} — ${v.ajuda}`).join('\n'),
    ).toEqual([])
  })
})

/* ========================================================================== */
/* 6. D1 — o botão de entrar na aula                                           */
/* ========================================================================== */

describe('D1: o botão de entrar', () => {
  it('aula distante: botão DESLIGADO, com o rótulo de espera', async () => {
    await page.goto(`${BASE_URL}/portal/aula/${aulaDistante}`, { waitUntil: 'networkidle' })

    const cedo = page.locator('[data-estado="cedo"]')
    await cedo.waitFor({ state: 'visible', timeout: ESPERA })
    // É BOTÃO, não link: a porta da aula ainda não abriu, e um `<a>` desligado
    // continuaria clicável por teclado.
    expect(await cedo.evaluate((el) => el.tagName)).toBe('BUTTON')
    expect(await cedo.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(true)
    // O rótulo é a espera — "Entrar às HH:MM" (longe) ou "Entrar em N min".
    expect((await cedo.innerText()).trim()).toMatch(/^Entrar (às \d{2}:\d{2}|em \d+ min)$/)
    // E o estado ABERTO não está na tela ao mesmo tempo.
    expect(await page.locator('[data-estado="aberto"]').count()).toBe(0)
  })
})
