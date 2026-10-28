// @vitest-environment jsdom
//
// A4 — AS TRÊS INTENÇÕES DO SLOT VAZIO (Onda da Agenda).
//
// O que este arquivo protege, na ordem:
//   1. MEDIÇÃO da dívida dos Popover Roots (declarada no A2): quantos Roots a
//      grade monta numa semana cheia e o que cada slot carrega — com guarda
//      contra o conteúdo voltar a ser servido 224 vezes;
//   2. o HELPER que lê o Postgres pega a definição EFETIVA da função (o que a
//      primeira versão não fazia — ver §2), e as QUATRO frases de consequência
//      amarradas ao que a RPC realmente faz;
//   3. slot PROIBIDO não oferece intenção nenhuma, e slot OCUPADO não reabre
//      sozinho;
//   4. os dois passos acontecem no MESMO balão — escolher revela os campos ali;
//   5. cada formulário chama a SUA action, com o payload exato (submit de
//      verdade no jsdom, não leitura de props);
//   6. O FUSO: escolher o contrato (ou a cidade) converte data e hora para o
//      relógio do aluno, com prova de mutação num dia de DST;
//   7. ERRO REABRE COM O QUE FOI DIGITADO — e o que foi digitado NÃO passa pela
//      URL (cookie de rascunho), nem vaza para o slot vizinho;
//   8. CORTESIA É GRATUITA DE VERDADE: o campo de preço é desmontado;
//   9. o botão "com janelas" governa o que APARECE, nunca o que ela PODE fazer;
//  10. régua da casa: alvo ≥24px no que é clicável, DADO no piso literal, e o
//      cliente não formata data.
//
// Padrão da casa (a1/a3/portão): cliente Supabase falso que GRAVA as chamadas,
// pote de cookies dublê, relógio congelado, árvore REAL da página e DOM real do
// balão.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DateTime } from 'luxon'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import {
  DIR_MIGRATIONS,
  corpoDaFuncao,
  definicaoDaFuncao,
  migrations,
} from './helpers/definicao-da-funcao'
import { Calendario, type CalEvent } from '@/components/kit/calendario'
import {
  CONSEQUENCIA,
  chaveDoSlot,
  INTENCOES,
  IntencoesDoSlot,
  ProvedorDoSlot,
  ROTULO,
  urlDoSlotComErro,
  type DadosDoSlot,
  type IntencaoDoSlot,
} from '@/components/admin/agenda/IntencoesDoSlot'
import { equivalenteNoFuso } from '@/components/admin/agenda/equivalente-no-fuso'
import {
  CamposDaAvulsa,
  CamposDaExperimental,
} from '@/components/admin/agenda/campos-de-aula'
import { conferirHoraCivil } from '@/lib/admin/hora-civil'
import {
  chaveDoBalao,
  chaveDoPainel,
  chaveDoRemarcar,
  RASCUNHO_COOKIE,
} from '@/lib/admin/rascunho-do-formulario'
import {
  CAMPOS_DA_PORTA,
  chaveDoDestino,
  geometriaCanonica,
  lerDaQuery,
} from '@/lib/admin/transporte-da-agenda'
import { cookieDoRecado } from '@/lib/kit/recado'
import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ========================================================================== */
/* Mocks                                                                       */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
  count?: number
}

class ConsultaFalsa {
  constructor(
    private readonly resposta: Resposta,
    private readonly registrar: (chamada: [string, ...unknown[]]) => void,
  ) {}
  private marca(nome: string, args: unknown[]) {
    this.registrar([nome, ...args])
    return this
  }
  select(...a: unknown[]) { return this.marca('select', a) }
  eq(...a: unknown[]) { return this.marca('eq', a) }
  is(...a: unknown[]) { return this.marca('is', a) }
  gt(...a: unknown[]) { return this.marca('gt', a) }
  gte(...a: unknown[]) { return this.marca('gte', a) }
  lt(...a: unknown[]) { return this.marca('lt', a) }
  lte(...a: unknown[]) { return this.marca('lte', a) }
  or(...a: unknown[]) { return this.marca('or', a) }
  limit(...a: unknown[]) { return this.marca('limit', a) }
  order(...a: unknown[]) { return this.marca('order', a) }
  single() { return this.marca('single', []) }
  maybeSingle() { return this.marca('maybeSingle', []) }
  then<A, B>(ok: (v: Resposta) => A, falha?: (e: unknown) => B) {
    return Promise.resolve({
      data: this.resposta.data ?? [],
      error: this.resposta.error ?? null,
      count: this.resposta.count ?? 0,
    }).then(ok, falha)
  }
}

const mock = vi.hoisted(() => ({
  respostas: {} as Record<string, Resposta>,
  chamadas: {} as Record<string, Array<[string, ...unknown[]]>>,
  rpcs: [] as Array<[string, unknown]>,
  respostaRpc: { data: null, error: null } as Resposta,
  /** cada submit que chegou a uma action do balão: [nome, FormData] */
  submits: [] as Array<[string, FormData]>,
  /** o signout do médio 2 passou por aqui */
  saiu: false,
}))

const { Redirecionou } = vi.hoisted(() => {
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return { Redirecionou }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      mock.chamadas[tabela] ??= []
      return new ConsultaFalsa(mock.respostas[tabela] ?? { data: [] }, (c) =>
        mock.chamadas[tabela].push(c),
      )
    },
    rpc: async (fn: string, args: unknown) => {
      mock.rpcs.push([fn, args])
      return { data: mock.respostaRpc.data ?? null, error: mock.respostaRpc.error ?? null }
    },
    // o `POST` de `/auth/signout` (médio 2) usa o mesmo cliente
    auth: {
      signOut: async () => {
        mock.saiu = true
        return { error: null }
      },
    },
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/email/notify', () => ({ sendRescheduleEmails: async () => {} }))
vi.mock('@/lib/email/send', () => ({ sendEmail: async () => {}, sendEmailWithOutcome: async () => {} }))
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))
vi.mock('@/lib/notify/evolution', () => ({
  evolutionChannel: () => ({}),
  evolutionConfigFromEnv: () => ({}),
}))
vi.mock('@/lib/outbox/dispatch', () => ({ dispatchOutbox: async () => {} }))

// As actions do balão viram ESPIÕES: o submit real do jsdom entrega a FormData
// aqui, e o teste 7 a devolve para a action VERDADEIRA (importActual) — as duas
// metades são reais, e nenhuma delas é leitura de props.
vi.mock('@/app/admin/agenda/actions', async () => {
  const real = await vi.importActual<typeof import('@/app/admin/agenda/actions')>(
    '@/app/admin/agenda/actions',
  )
  const espiao = (nome: string) => async (fd: FormData) => {
    mock.submits.push([nome, fd])
  }
  return {
    ...real,
    createSingleClassAction: espiao('createSingleClassAction'),
    createTrialClassAction: espiao('createTrialClassAction'),
    publishWindowAction: espiao('publishWindowAction'),
    addTeacherBlockAction: espiao('addTeacherBlockAction'),
  }
})

const acoesReais = await vi.importActual<typeof import('@/app/admin/agenda/actions')>(
  '@/app/admin/agenda/actions',
)
const { default: AgendaPage } = await import('@/app/admin/agenda/page')
const { cookies } = await import('next/headers')

/* -------------------------------------------------------------------------- */
/* O pote de cookies dublê — UMA cópia só (Sol · rodada 2 do A4, menor 2)       */
/* -------------------------------------------------------------------------- */
// Este arquivo tinha uma classe `Pote` PRÓPRIA, irmã da `PoteDeCookies`
// compartilhada — e foi essa duplicação que deixou o teto real do cookie sem
// prova: o dublê local não sabia medir o tamanho codificado, então o médio 3
// (limite em caracteres, não em bytes) passou batido nas duas pontas. Uma cópia
// só, para as duas envelhecerem juntas.

let pote: PoteDeCookies

/* -------------------------------------------------------------------------- */
/* A tela: `matchMedia` não existe no jsdom, e o balão decide por ele           */
/* -------------------------------------------------------------------------- */

const tela: { desktop: boolean; ouvintes: Array<() => void> } = { desktop: false, ouvintes: [] }
;(window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = () => ({
  get matches() {
    return tela.desktop
  },
  addEventListener: (_: string, cb: () => void) => {
    tela.ouvintes.push(cb)
  },
  removeEventListener: () => {},
})

/** Muda a largura da tela como o navegador faria (dispara o `change`). */
async function larguraDeTela(desktop: boolean) {
  tela.desktop = desktop
  await act(async () => {
    for (const cb of tela.ouvintes) cb()
  })
}

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const OUTRA = '22222222-2222-2222-2222-222222222222'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }
/** a professora com fuso PRÓPRIO (F3-D2): é ela que expõe o dia civil do bloqueio. */
const PARCEIRA = { id: OUTRA, display_name: 'Renata', is_owner: false, iana_tz: 'Europe/Lisbon' }
const CUIABA = 'America/Cuiaba'

/** 20 contratos particulares ativos: o tamanho REAL da lista que o balão
 *  carregaria em cada um dos 224 slots se o conteúdo voltasse para o servidor. */
const CONTRATOS_CRUS = Array.from({ length: 20 }, (_, i) => ({
  id: `c-${i}`,
  plan_name: 'Mensal 2x',
  students: { display_name: `Aluno ${i}`, iana_tz: 'America/Sao_Paulo' },
  student_groups: null,
  recurring_slots: [],
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  tela.desktop = false
  tela.ouvintes = []
  mock.respostas = {
    class_instances: { data: [] },
    teachers: { data: [DONA, PARCEIRA] },
    reschedule_windows: { data: [] },
    contracts: { data: CONTRATOS_CRUS },
  }
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
  mock.submits = []
})
afterEach(() => {
  vi.useRealTimers()
})

/* ========================================================================== */
/* Ferramentas                                                                 */
/* ========================================================================== */

interface ElementoDaArvore {
  type: unknown
  props: { children?: unknown } & Record<string, unknown>
}
function ehElemento(no: unknown): no is ElementoDaArvore {
  return typeof no === 'object' && no !== null && 'props' in no && 'type' in no
}
function* percorrer(no: unknown): Generator<ElementoDaArvore> {
  if (no == null || typeof no !== 'object') return
  if (Array.isArray(no)) {
    for (const filho of no) yield* percorrer(filho)
    return
  }
  if (!ehElemento(no)) return
  yield no
  yield* percorrer(no.props.children)
}

let container: HTMLDivElement | undefined
let root: Root | undefined

async function montarNo(no: ReactNode): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(no)
  })
  return el
}

async function desmontar() {
  if (root) {
    const r = root
    root = undefined
    await act(async () => r.unmount())
  }
  container?.remove()
  container = undefined
}

afterEach(async () => {
  await desmontar()
  document.body.innerHTML = ''
})

/** O instante UTC de um slot da grade — a MESMA conta do servidor (Lei 1). */
function instanteDoSlot(iso: string, hhmm: string): string {
  return DateTime.fromISO(`${iso}T${hhmm}`, { zone: CUIABA }).toUTC().toISO()!
}

/** Os dados do provedor, no estado de repouso (sem filtro, sem erro de volta). */
function dados(over: Partial<DadosDoSlot> = {}): DadosDoSlot {
  return {
    self: '/admin/agenda',
    professoras: [
      { id: PROFESSORA, nome: 'Teacher Vicky', ianaTz: CUIABA, cidade: 'Cuiabá' },
      { id: OUTRA, nome: 'Renata', ianaTz: 'Europe/Lisbon', cidade: 'Lisboa' },
    ],
    professoraFiltrada: null,
    contratos: [
      { id: 'c-0', rotulo: 'Aluno 0 · Mensal 2x · Cuiabá', ianaTz: CUIABA, cidade: 'Cuiabá' },
      {
        id: 'c-sp',
        rotulo: 'Aluno SP · Mensal 2x · São Paulo',
        ianaTz: 'America/Sao_Paulo',
        cidade: 'São Paulo',
      },
      {
        id: 'c-ny',
        rotulo: 'Aluno NY · Mensal 2x · Nova York',
        ianaTz: 'America/New_York',
        cidade: 'Nova York',
      },
    ],
    digitado: {},
    slotDoErro: null,
    intencaoDoErro: null,
    ...over,
  }
}

const SLOT_PADRAO = { iso: '2026-08-04', hhmm: '14:00' }

/** O balão de um slot, montado com o provedor — como a página o monta. */
async function balao(
  over: Partial<DadosDoSlot> = {},
  slot = SLOT_PADRAO,
): Promise<HTMLDivElement> {
  return montarNo(
    h(ProvedorDoSlot, {
      dados: dados(over),
      children: h(IntencoesDoSlot, {
        iso: slot.iso,
        hhmm: slot.hhmm,
        titulo: 'ter, 04/08',
        instanteUtc: instanteDoSlot(slot.iso, slot.hhmm),
      }),
    }),
  )
}

/** Clica no botão cujo texto começa com o rótulo da intenção. */
async function escolher(c: HTMLElement, qual: IntencaoDoSlot) {
  const alvo = [...c.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').startsWith(ROTULO[qual]),
  )
  if (!alvo) throw new Error(`botão da intenção ${qual} não existe no balão`)
  await act(async () => {
    alvo.click()
  })
}

/** Envia o formulário do balão como o navegador faria. */
async function enviar(c: HTMLElement): Promise<FormData> {
  const form = c.querySelector('form')
  if (!form) throw new Error('o balão não tem formulário')
  await act(async () => {
    form.requestSubmit()
  })
  const ultimo = mock.submits.at(-1)
  if (!ultimo) throw new Error('o submit não chegou a nenhuma action')
  return ultimo[1]
}

/** Preenche um campo controlado pelo React (o setter nativo + evento).
 *  Dentro de `act`: o balão declara o fuso do formulário por EFEITO, e sem o
 *  flush o cabeçalho ficaria uma renderização atrás do que a dona escolheu. */
async function digitar(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(el, valor)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** O valor dos campos de TEXTO visíveis (o `DateField`/`TimeField` da casa). */
function textosVisiveis(c: HTMLElement): string[] {
  return [...c.querySelectorAll<HTMLInputElement>('input[type="text"]')].map((i) => i.value)
}

/** Roda uma action REAL e devolve a URL do redirect, já decodificada. */
async function rodar(acao: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return decodeURIComponent(e.url)
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

/** O rascunho guardado no cookie, já desempacotado. */
function rascunhoNoPote(): { chave: string; campos: Record<string, string> } | null {
  const cru = pote.get(RASCUNHO_COOKIE)?.value
  return cru ? JSON.parse(cru) : null
}

/**
 * A FRASE DA ACTION — no cookie da seção, nunca mais na URL (A7).
 *
 * Todas as actions desta seção passaram ao transporte único: a mensagem viaja
 * num cookie `httpOnly` e o endereço leva só geometria. Este helper existe para
 * os testes cobrarem a frase onde ela agora está — cobrá-la na URL passaria a
 * ser cobrar o defeito.
 */
function recadoNoPote(): { mensagem: string; id: string; destino?: string } | null {
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  return cru ? JSON.parse(cru) : null
}

/** A frase da última action — falha alto se ela não existe. */
function frase(): string {
  const r = recadoNoPote()
  if (!r) throw new Error('a action não gravou recado nenhum no cookie da seção')
  return r.mensagem
}

/* ========================================================================== */
/* 1. A DÍVIDA DOS POPOVER ROOTS — medida, com número                          */
/* ========================================================================== */

/**
 * O QUE FOI MEDIDO EM 29/07, e SÓ isto (Sol · rodada 1 do A4, menor 1: a
 * conclusão anterior afirmava mais do que a medição sustentava):
 *   · 224 Popover Roots numa semana cheia = 196 (7 dias × 28 meias-horas do
 *     desktop) + 28 (a cópia do dia selecionado, que o celular mostra);
 *   · conteúdo ANTIGO servido por slot (mini-form de publicar, UMA intenção):
 *     10 elementos React / 1.469 bytes de HTML — medidos, e a ordem de grandeza
 *     está travada no contrafactual abaixo;
 *   · conteúdo de HOJE: 4 props de string por slot (iso, hhmm, título,
 *     instante UTC) — o corpo é cliente e lê o resto do CONTEXTO, uma cópia só.
 * O QUE **NÃO** FOI MEDIDO, e por isso não é afirmado em lugar nenhum: tempo de
 * hidratação, número de listeners, memória, e o "~1,22 MB" que a primeira
 * versão citava (era CÁLCULO — bytes × 224 —, não leitura de instrumento).
 * DECISÃO INALTERADA: os 224 Roots FICAM (Root + Trigger são baratos e o gatilho
 * por slot é o que mantém a âncora e a devolução de foco do Radix); o que
 * multiplicava era o CONTEÚDO, e é ele que parou de multiplicar.
 */
describe('A4 · a dívida dos Roots do A2, fechada com o que foi MEDIDO', () => {
  it('a grade monta 224 balões numa semana cheia — e cada um carrega só strings', async () => {
    let chamadas = 0
    const conteudos: ReactNode[] = []
    const espiao = (iso: string, hhmm: string) => {
      chamadas++
      const no = h(IntencoesDoSlot, {
        iso,
        hhmm,
        titulo: 'ter, 04/08',
        instanteUtc: instanteDoSlot(iso, hhmm),
      })
      conteudos.push(no)
      return no
    }
    const c = await montarNo(
      h(ProvedorDoSlot, {
        dados: dados(),
        children: h(Calendario, {
          events: [],
          view: 'semana' as const,
          anchor: '2026-08-03',
          tz: CUIABA,
          dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
          todayISO: '2026-08-04',
          slotPopup: espiao,
        }),
      }),
    )

    expect(chamadas, 'o número de Roots do slot mudou — remedir a dívida').toBe(224)
    expect(c.querySelectorAll('button[title^="Criar às"]')).toHaveLength(224)

    // A GUARDA: o conteúdo de cada slot é o elemento cliente com QUATRO props de
    // string. Voltar a servir o formulário inline (com os 20 contratos e as
    // professoras) reabre a dívida — e deixa este caso vermelho.
    const primeiro = conteudos[0] as ElementoDaArvore
    expect(Object.keys(primeiro.props).sort()).toEqual(['hhmm', 'instanteUtc', 'iso', 'titulo'])
    for (const v of Object.values(primeiro.props)) expect(typeof v).toBe('string')
    expect(JSON.stringify(primeiro.props).length).toBeLessThan(200)
  })

  it('CONTRAFACTUAL: o corpo do balão é grande — por isso ele não pode ser 224 cópias', async () => {
    // O mesmo conteúdo renderizado UMA vez: é o tamanho que seria multiplicado
    // por 224 se o corpo tivesse ficado no servidor. O teste não fixa o número
    // (ele cresce com a lista de contratos, que é o problema): fixa a ORDEM DE
    // GRANDEZA contra o mini-form antigo, de 1.469 bytes.
    const c = await balao()
    await escolher(c, 'avulsa')
    expect(c.innerHTML.length).toBeGreaterThan(1469)
  })
})

/* ========================================================================== */
/* 2. O HELPER LÊ A DEFINIÇÃO EFETIVA · AS QUATRO FRASES × O QUE A RPC FAZ      */
/* ========================================================================== */

// O HELPER FOI PROMOVIDO A `tests/helpers/definicao-da-funcao.ts` (A5/L5): o A5
// passou a amarrar frase × corpo efetivo das mesmas funções, e duas cópias
// divergindo é exatamente o defeito do grave 6 (uma delas continuaria lendo
// função MORTA). O que FICA aqui é o teste-guarda: a versão ANTIGA reconstruída
// abaixo e a prova de mutação que a derruba — sem ela, nada impede a regressão
// de voltar.

/** O helper VELHO, reconstruído: é ele que o teste-guarda abaixo derruba. */
function corpoDaFuncaoAntigo(nome: string): string | null {
  let achado: string | null = null
  for (const arquivo of migrations()) {
    const sql = readFileSync(join(DIR_MIGRATIONS, arquivo), 'utf8')
    const re = new RegExp(
      `create (?:or replace )?function public\\.${nome}\\s*\\([\\s\\S]*?\\n\\$(?:fn)?\\$;`,
      'g',
    )
    for (const m of sql.matchAll(re)) achado = m[0]
  }
  return achado
}

describe('A4 · o helper lê a definição EFETIVA (grave 6)', () => {
  it('PROVA DE MUTAÇÃO: a função existe em duas migrations e o helper devolve a NOVA', () => {
    // `book_reschedule_window` é definida seis vezes; a que vale é a última —
    // desde o A6/e ela é a da migration 98 (o cinto do bloqueio), reemitida no
    // MESMO formato do dump (maiúsculas + `$function$`), que é o que este
    // teste-guarda mede.
    const efetiva = definicaoDaFuncao('book_reschedule_window')
    expect(efetiva.origem).toBe('20260730000100_a6_travas_de_agenda.sql')
    // …e é mesmo a MAIS RECENTE das migrations que a definem.
    const quemDefine = migrations().filter((f) =>
      /^[ \t]*create\s+(?:or\s+replace\s+)?function\s+public\.book_reschedule_window\s*\(/im.test(
        readFileSync(join(DIR_MIGRATIONS, f), 'utf8'),
      ),
    )
    expect(quemDefine.length).toBeGreaterThan(1)
    expect(quemDefine.at(-1)).toBe(efetiva.origem)

    // O HELPER VELHO devolvia OUTRA coisa — a versão morta de 20260718000400.
    const morta = corpoDaFuncaoAntigo('book_reschedule_window')
    expect(morta, 'o helper velho não achava nada? então a mutação mudou de forma').not.toBeNull()
    expect(morta).not.toBe(efetiva.corpo)
    // A marca da versão viva: `pg_dump` escreve em maiúsculas e `$function$`.
    expect(efetiva.corpo.startsWith('CREATE OR REPLACE FUNCTION')).toBe(true)
    expect(efetiva.corpo).toContain('$function$')
    expect(morta!.startsWith('CREATE')).toBe(false)
  })

  it('o mesmo vale para `reschedule_class_at` — a outra função de dinheiro do dump', () => {
    // M2 da onda Agenda e Mensagens (01/09/2026): recriada com `p_school_move`
    // a partir da definição de 20260727000700 — a origem efetiva avançou. O pino
    // continua provando que o helper lê a ÚLTIMA definição, não uma morta.
    expect(definicaoDaFuncao('reschedule_class_at').origem).toBe(
      '20260901000100_m2_professora_cancela_e_remarca.sql',
    )
  })

  it('função inexistente ESTOURA (helper mudo é como o defeito voltaria)', () => {
    expect(() => corpoDaFuncao('funcao_que_nunca_existiu')).toThrow(/não encontrada/)
  })
})

describe('A4 · a frase de consequência é CONFERIDA contra a RPC', () => {
  it('as quatro intenções têm rótulo e frase, e nenhuma frase é vazia ou repetida', () => {
    expect([...INTENCOES]).toEqual(['avulsa', 'experimental', 'horario', 'bloqueio'])
    const frases = INTENCOES.map((i) => CONSEQUENCIA[i])
    for (const i of INTENCOES) {
      expect(ROTULO[i].length).toBeGreaterThan(8)
      expect(CONSEQUENCIA[i].length).toBeGreaterThan(40)
    }
    expect(new Set(frases).size).toBe(4)
  })

  it('avulsa: "não gasta crédito nem franquia" — a função não toca em nenhum dos dois', () => {
    const fn = corpoDaFuncao('admin_create_single_class')
    expect(CONSEQUENCIA.avulsa).toContain('Não gasta crédito de reposição nem a franquia')
    // as duas provas do banco: nada de ledger de reposição, nada de contador de alçada
    expect(fn).not.toContain('spend_makeup')
    expect(fn).not.toContain('reschedule_usage')
    // "Extra cobrada exige valor" sai do próprio raise da função
    expect(CONSEQUENCIA.avulsa).toContain('Extra cobrada exige valor')
    expect(fn).toContain('aula extra cobrada exige valor')
    // "cortesia é gratuita": o tipo existe e é o que dispensa o valor
    expect(fn).toContain("'extra_paid', 'courtesy'")
    // "a hora conta no extrato da professora": a aula nasce como class_instance
    // da professora, e é isso que `_teacher_payable_hours` soma
    expect(CONSEQUENCIA.avulsa).toContain('conta no extrato da professora')
    expect(fn).toContain('insert into class_instances')
    expect(corpoDaFuncao('_teacher_payable_hours')).toContain('from class_instances i')
    // "data e hora valem no fuso DO ALUNO": a escada da RPC é slot → aluno, e
    // desde o A6/a ela serve ao SNAPSHOT (o instante chega decidido pela action).
    expect(CONSEQUENCIA.avulsa).toContain('fuso DO ALUNO')
    expect(fn).toContain('select rs.iana_tz into v_tz')
    expect(fn).toContain('select s.iana_tz into v_tz from students s')
    expect(fn).toContain('v_local := v_starts at time zone v_tz')
    expect(
      fn,
      'a RPC voltou a reconstruir o instante a partir de data+hora civis (A6/a desfeito)',
    ).not.toContain('p_local_date')
  })

  it('experimental: pessoa + contrato leve + aula, sem horário fixo e sem semanas geradas', () => {
    const fn = corpoDaFuncao('admin_create_trial_class')
    expect(CONSEQUENCIA.experimental).toContain('contrato experimental leve')
    expect(fn).toContain('insert into students')
    expect(fn).toContain('insert into contracts')
    expect(fn).toContain('is_trial')
    // "sem horário fixo e sem gerar as próximas semanas": nenhum slot recorrente
    expect(CONSEQUENCIA.experimental).toContain('sem horário fixo e sem gerar as próximas semanas')
    expect(fn).not.toContain('insert into recurring_slots')
    // 'o fuso dela nasce "a confirmar"'
    expect(CONSEQUENCIA.experimental).toContain('a confirmar')
    expect(fn).toContain('tz_confirmed')
    expect(fn).toContain('false')
  })

  it('horário: 2 semanas para reservar, e o consumo gasta franquia OU crédito', () => {
    const consumo = corpoDaFuncao('book_reschedule_window')
    expect(CONSEQUENCIA.horario).toContain('até 2 semanas à frente')
    expect(consumo).toContain("interval '14 days'")
    expect(CONSEQUENCIA.horario).toContain('gasta a franquia do mês')
    expect(CONSEQUENCIA.horario).toContain('crédito de reposição')
    // quem cobra é a remarcação: franquia primeiro, crédito quando ela acaba
    const remarcar = corpoDaFuncao('reschedule_class_at')
    expect(remarcar).toContain('monthly_reschedule_allowance')
    expect(remarcar).toContain('spend_makeup')
    // "o horário sai da oferta"
    expect(CONSEQUENCIA.horario).toContain('sai da oferta')
    expect(consumo).toContain("state = 'consumida'")
  })

  it('bloqueio: dia INTEIRO no fuso da professora, e as AULAS marcadas continuam', () => {
    const fn = corpoDaFuncao('add_teacher_block')
    expect(CONSEQUENCIA.bloqueio).toContain('dia inteiro, no fuso dela')
    // de 00:00 do primeiro dia até 00:00 do dia seguinte ao último, na zona DELA
    expect(fn).toContain("(p_from + time '00:00') at time zone v_tz")
    expect(fn).toContain("((p_to + 1) + time '00:00') at time zone v_tz")
    expect(fn).toContain('coalesce(t.iana_tz, public.business_tz())')
    // "as aulas já marcadas continuam de pé": a função não encosta nelas.
    // ⚠️ ESTA metade da asserção NEGATIVA fica de pé no A6 e é de propósito: o
    // bloqueio passou a mexer em `reschedule_windows` (janela publicada sai da
    // oferta), e continua NÃO mexendo em `class_instances` — quem trata aula
    // marcada é `admin_period_treatment`.
    expect(CONSEQUENCIA.bloqueio).toContain('já marcadas continuam de pé')
    expect(fn).not.toContain('class_instances')
    // …e é a exceção `block` que fecha a oferta nova
    expect(corpoDaFuncao('_teacher_available_for')).toContain("e.kind = 'block'")
  })

  it('A6: o bloqueio FECHA a janela já publicada — e as duas frases dizem isso', () => {
    // ── A INVERSÃO ANUNCIADA (o teste antigo pinava a AUSÊNCIA e pedia a
    // própria morte: "se a reserva passar a conferir disponibilidade (A6),
    // reescreva a frase, ela ficou pessimista"). Ela passou. ──────────────────
    //
    // As DUAS provas do banco, agora POSITIVAS, lidas na definição EFETIVA:
    //   1. `add_teacher_block` cancela as janelas PUBLICADAS do período;
    const bloqueio = definicaoDaFuncao('add_teacher_block')
    expect(bloqueio.origem).toBe('20260730000100_a6_travas_de_agenda.sql')
    expect(bloqueio.corpo).toContain('reschedule_windows')
    expect(bloqueio.corpo).toContain("set state = 'cancelada'")
    expect(bloqueio.corpo).toContain("w.state = 'publicada'")
    // …e devolve quantas fechou (o retorno virou jsonb)
    expect(bloqueio.corpo).toContain('closed_windows')
    //   2. e a RESERVA ganhou o cinto do bloqueio criado DEPOIS da publicação —
    //      pelo `kind='block'` direto, não por `_teacher_available_for` (que
    //      exige estar DENTRO de janela semanal, e janela semanal é
    //      INFORMATIVA nesta casa — régua do A3).
    const reserva = definicaoDaFuncao('book_reschedule_window')
    expect(reserva.origem).toBe('20260730000100_a6_travas_de_agenda.sql')
    expect(reserva.corpo).toContain("e.kind = 'block'")
    expect(reserva.corpo).toContain('teacher_availability_exceptions')
    expect(
      reserva.corpo,
      'a reserva NÃO deve exigir janela semanal: `avail` é informativa (régua do A3)',
    ).not.toContain('_teacher_available_for')

    // A frase, então, promete o fecho — e não ensina mais gesto manual nenhum.
    expect(CONSEQUENCIA.bloqueio).toContain('horários NOVOS')
    expect(CONSEQUENCIA.bloqueio).toContain('JÁ PUBLICADO no período sai da oferta')
    expect(CONSEQUENCIA.bloqueio).not.toContain('despublique a janela')
    expect(CONSEQUENCIA.bloqueio).not.toContain('continua reservável')
    // …e a frase de SUCESSO da action diz a mesma coisa (as duas são lidas pela
    // dona no mesmo minuto; divergir entre elas é pior que as duas erradas).
    const acoes = readFileSync(join(process.cwd(), 'src/app/admin/agenda/actions.ts'), 'utf8')
    const sucesso = /'(Bloqueio criado[^']*)'/.exec(acoes)![1]
    expect(sucesso).toContain('NOVOS')
    expect(sucesso).toContain('saíram da oferta')
    expect(sucesso).not.toContain('segue reservável')
    // …e a da PROFESSORA, que era a mais otimista das duas, finalmente é verdade
    const doTeacher = readFileSync(join(process.cwd(), 'src/app/teacher/actions.ts'), 'utf8')
    const sucessoTeacher = /'(Bloqueio criado[^']*)'/.exec(doTeacher)![1]
    expect(sucessoTeacher).toContain('nenhum horário será ofertado no período')
    expect(sucessoTeacher).toContain('saíram da oferta')
    // …e a QUARTA superfície, a que a prova do Lote 1 pegou viva (a lição do A5:
    // a frase falsa é a que o autor não olhou): o painel de Bloqueios de
    // `?novo=disponibilidade` ensinava a "despublicar na grade" um buraco que o
    // A6/f fechou. A frase agora promete o fecho automático — e este pino cresce
    // se alguém a reescrever para trás.
    const painel = readFileSync(join(process.cwd(), 'src/app/admin/agenda/page.tsx'), 'utf8')
    expect(painel).toContain('fecha os horários de')
    expect(painel).not.toContain('despublique-o na grade')
    expect(painel).not.toContain('continua reservável')
  })

  it('as frases de SUCESSO das quatro actions continuam enumeradas no tom-do-aviso', () => {
    // O desfecho do balão é o toast do `AvisoLegado`; frase nova sem lista sai
    // VERMELHA na tela, mesmo tendo dado certo.
    for (const frase of [
      'Aula avulsa criada — ela entra sozinha nos lembretes e no extrato. ✓',
      'Aula experimental criada (com contrato experimental leve). ✓',
      'Horário publicado — os alunos da professora já podem remarcar para ele.',
      'Bloqueio criado — a professora para de receber horários NOVOS no período, e os horários de remarcação já publicados nele saíram da oferta. Aulas já marcadas continuam de pé: trate-as em Período ou férias.',
    ]) {
      expect(tomDoAviso(frase), frase).toBe('sucesso')
    }
  })
})

/* ========================================================================== */
/* 3. SLOT PROIBIDO NÃO OFERECE NADA · SLOT OCUPADO NÃO REABRE SOZINHO         */
/* ========================================================================== */

/** 10:00–11:00 em Cuiabá (UTC−4) no dia 29/07 — bloqueio da professora. */
const BLOQUEIO_10_11: CalEvent = {
  id: 'bl-manha',
  startsAtUtc: '2026-07-29T14:00:00Z',
  endsAtUtc: '2026-07-29T15:00:00Z',
  title: 'bloqueada — férias',
  color: 0,
  blocked: true,
}
/** compromisso pessoal do Google, 13:00–14:00 em Cuiabá */
const OCUPADA_13_14: CalEvent = {
  id: 'g-0',
  startsAtUtc: '2026-07-29T17:00:00Z',
  endsAtUtc: '2026-07-29T18:00:00Z',
  title: 'ocupada (agenda pessoal)',
  color: 0,
  ghost: true,
}
/** disponibilidade da professora, 08:00–18:00 em Cuiabá (fundo INFORMATIVO) */
const DISPONIVEL: CalEvent = {
  id: 'av-dia',
  startsAtUtc: '2026-07-29T12:00:00Z',
  endsAtUtc: '2026-07-29T22:00:00Z',
  title: 'disponível',
  color: 0,
  avail: true,
}
/** AULA de verdade às 09:00–09:45 em Cuiabá — cobre o slot só visualmente. */
const AULA_09: CalEvent = {
  id: 'aula-9',
  startsAtUtc: '2026-07-29T13:00:00Z',
  endsAtUtc: '2026-07-29T13:45:00Z',
  title: 'Elisa',
  color: 0,
}

/** y (px) do início da meia-hora `hh:mm` na faixa default (7h–21h, 64px/hora). */
const yDoSlot = (hh: number, mm: 0 | 30) => ((hh - 7) * 60 + mm) * (64 / 60)

/** HIT-TESTING pela geometria declarada (o mesmo do portão de deploy). */
function quemRecebeOToque(coluna: HTMLElement, y: number): HTMLElement | null {
  let alvo: HTMLElement | null = null
  for (const filho of [...coluna.children] as HTMLElement[]) {
    if (!filho.style.height) continue
    if (filho.className.includes('pointer-events-none')) continue
    const topo = parseFloat(filho.style.top)
    const fim = topo + parseFloat(filho.style.height)
    if (y >= topo && y < fim) alvo = filho
  }
  return alvo
}

async function gradeDoDia(events: CalEvent[], slotAberto?: string): Promise<HTMLElement> {
  const c = await montarNo(
    h(ProvedorDoSlot, {
      dados: dados(),
      children: h(Calendario, {
        events,
        view: 'dia' as const,
        anchor: '2026-07-29',
        tz: CUIABA,
        dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
        todayISO: '2026-07-28',
        slotAberto,
        slotPopup: (iso: string, hhmm: string) =>
          h(IntencoesDoSlot, {
            iso,
            hhmm,
            titulo: 'qua, 29/07',
            instanteUtc: instanteDoSlot(iso, hhmm),
          }),
      }),
    }),
  )
  const qualquer = c.querySelector<HTMLElement>('[title^="Criar às"], [title*="indisponível"]')
  if (!qualquer) throw new Error('nenhuma meia-hora renderizada')
  return qualquer.parentElement as HTMLElement
}

/** O balão ABERTO vive no portal do Radix (fora do container). */
function balaoAbertoNoDocumento(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
}

describe('A4 · faixa proibitiva não oferece NENHUMA das três intenções', () => {
  it('bloqueio e ocupada: o toque cai num retângulo inerte que diz o motivo', async () => {
    const coluna = await gradeDoDia([DISPONIVEL, BLOQUEIO_10_11, OCUPADA_13_14])
    for (const [hora, motivo] of [
      [10, 'bloqueada — férias'],
      [13, 'ocupada (agenda pessoal)'],
    ] as const) {
      for (const minuto of [0, 30] as const) {
        const recebe = quemRecebeOToque(coluna, yDoSlot(hora, minuto) + 5)
        expect(recebe, `nada recebe o toque às ${hora}:${minuto}`).not.toBeNull()
        expect(recebe!.tagName, `${hora}:${minuto}`).toBe('DIV')
        expect(recebe!.getAttribute('title')).toContain('indisponível')
        expect(recebe!.getAttribute('title')).toContain(motivo)
        expect(recebe!.querySelector('button')).toBeNull()
      }
    }
    // …e nenhum gatilho de criação sobrou dentro das faixas proibidas
    const gatilhos = [...coluna.querySelectorAll<HTMLElement>('button[title^="Criar às"]')].map(
      (b) => b.getAttribute('title'),
    )
    for (const proibido of ['Criar às 10:00', 'Criar às 10:30', 'Criar às 13:00', 'Criar às 13:30']) {
      expect(gatilhos, proibido).not.toContain(proibido)
    }
  })

  it('PROVA DE MUTAÇÃO (outro sentido): slot livre — e sob mera disponibilidade — oferece as três', async () => {
    const coluna = await gradeDoDia([DISPONIVEL, BLOQUEIO_10_11, OCUPADA_13_14])
    // 09:00 está DENTRO da disponibilidade (fundo informativo) e fora das duas
    // proibições: publicar por cima dela é o gesto certo.
    const recebe = quemRecebeOToque(coluna, yDoSlot(9, 0) + 5)
    expect(recebe!.tagName).toBe('BUTTON')
    expect(recebe!.getAttribute('title')).toBe('Criar às 09:00')
  })
})

describe('A4 · médio 2 — a URL de erro não reabre balão sob aula existente', () => {
  it('slot com AULA em cima: a reabertura é recusada (o link salvo não mente)', async () => {
    await gradeDoDia([DISPONIVEL, AULA_09], '2026-07-29T09:00')
    expect(
      balaoAbertoNoDocumento(),
      'o balão "criar aqui" nasceu POR BAIXO de uma aula que já existe',
    ).toBeNull()
  })

  it('PROVA DE MUTAÇÃO: o MESMO slot, sem a aula, reabre normalmente', async () => {
    await gradeDoDia([DISPONIVEL], '2026-07-29T09:00')
    const balaoAberto = balaoAbertoNoDocumento()
    expect(balaoAberto, 'a reabertura parou de funcionar no slot vazio').not.toBeNull()
    expect(balaoAberto!.textContent).toContain(ROTULO.avulsa)
  })

  it('janela de remarcação publicada também segura a reabertura', async () => {
    const janela: CalEvent = {
      id: 'w-1',
      startsAtUtc: '2026-07-29T13:00:00Z', // 09:00 em Cuiabá
      title: 'horário aberto',
      color: 0,
      dashed: true,
    }
    await gradeDoDia([DISPONIVEL, janela], '2026-07-29T09:00')
    expect(balaoAbertoNoDocumento()).toBeNull()
  })
})

/* ========================================================================== */
/* 4. DOIS PASSOS NO MESMO BALÃO                                               */
/* ========================================================================== */

describe('A4 · os dois passos acontecem dentro do mesmo balão', () => {
  it('passo 1: as três intenções, cada uma com a frase de consequência à vista', async () => {
    const c = await balao()
    const texto = c.textContent ?? ''
    for (const i of INTENCOES) {
      expect(texto, ROTULO[i]).toContain(ROTULO[i])
      expect(texto, CONSEQUENCIA[i]).toContain(CONSEQUENCIA[i])
    }
    // o horário tocado é o primeiro DADO do balão
    expect(texto).toContain('ter, 04/08')
    expect(texto).toContain('14:00')
    // nenhum formulário antes da escolha
    expect(c.querySelector('form')).toBeNull()
  })

  it('passo 2: escolher revela os campos DALI mesmo — sem link, sem painel, sem sair', async () => {
    const c = await balao()
    const antes = c.querySelectorAll('a').length
    await escolher(c, 'avulsa')
    const form = c.querySelector('form')!
    expect(form, 'a escolha não revelou formulário nenhum').not.toBeNull()
    expect(form.querySelector('select[name="contract_id"]')).not.toBeNull()
    // nada de navegação: o balão não ganhou link nenhum para painel/outra tela
    expect(c.querySelectorAll('a').length).toBe(antes)
    expect(antes).toBe(0)
    // e dá para voltar para as três
    const voltar = [...c.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Escolher outra coisa'),
    )!
    await act(async () => voltar.click())
    expect(c.querySelector('form')).toBeNull()
    expect(c.textContent).toContain(ROTULO.horario)
  })

  it('a professora é UM seletor só, compartilhado — e some quando a barra já filtrou', async () => {
    for (const qual of ['experimental', 'horario', 'bloqueio'] as const) {
      const c = await balao()
      await escolher(c, qual)
      const select = c.querySelector<HTMLSelectElement>('select[name="teacher_id"]')!
      expect(select, `${qual} ficou sem seletor de professora`).not.toBeNull()
      // NOME ACESSÍVEL (portão de deploy 29/07): combo sem nome era o defeito
      expect(select.getAttribute('aria-label')!.length).toBeGreaterThan(3)
      expect([...select.options].map((o) => o.value)).toEqual(['', PROFESSORA, OUTRA])
      await desmontar()
    }
    // com filtro: o campo vira oculto com a professora da barra (mesma chave da
    // camada de disponibilidade do A3)
    const c = await balao({ professoraFiltrada: OUTRA })
    await escolher(c, 'horario')
    expect(c.querySelector('select[name="teacher_id"]')).toBeNull()
    expect(c.querySelector<HTMLInputElement>('input[name="teacher_id"]')!.value).toBe(OUTRA)
  })

  it('a AVULSA não oferece professora: quem decide é o contrato (a RPC nem recebe)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    expect(c.querySelector('[name="teacher_id"]')).toBeNull()
    expect(corpoDaFuncao('admin_create_single_class')).not.toContain('p_teacher ')
  })

  it('tudo que é clicável no balão tem alvo ≥ 24px (piso da casa)', async () => {
    const c = await balao()
    const alvos = [...c.querySelectorAll('button')]
    expect(alvos).toHaveLength(4)
    for (const b of alvos) {
      // as classes do kit que garantem o piso: min-h-11 (44px) nas intenções
      expect(b.className, b.textContent ?? '').toMatch(/min-h-(6|9|11)/)
    }
    await escolher(c, 'bloqueio')
    for (const b of [...c.querySelectorAll('button')]) {
      expect(b.className, b.textContent ?? '').toMatch(/min-h-(6|9|11)/)
    }
  })
})

/* ========================================================================== */
/* 5. CADA FORM CHAMA A SUA ACTION, COM O PAYLOAD EXATO                        */
/* ========================================================================== */

describe('A4 · binding form→action por SUBMIT real (trocar duas fica vermelho)', () => {
  it('horário aberto: publishWindowAction com a data/hora do slot em Cuiabá', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c, 'horario')
    const fd = await enviar(c)
    expect(mock.submits.at(-1)![0]).toBe('publishWindowAction')
    expect(fd.get('local_date')).toBe('2026-08-04')
    expect(fd.get('local_time')).toBe('14:00')
    expect(fd.get('teacher_id')).toBe(PROFESSORA)
    expect(fd.get('back')).toBe('/admin/agenda')
    expect(fd.get('back_erro')).toBe('/admin/agenda?slot=2026-08-04T14:00&si=horario')
    // A7 · A IDENTIDADE DO RASCUNHO NÃO VIAJA MAIS — ela é DERIVADA do
    // `back_erro` no servidor (`chaveDoDestino`). O formulário parou de declarar
    // `rascunho`, e a garantia ficou mais forte: antes eram duas strings montadas
    // em lugares diferentes, e nada obrigava as duas a falarem do mesmo slot;
    // divergir devolvia o balão VAZIO, em silêncio. Agora não há como divergir.
    expect(fd.get('rascunho'), 'o formulário voltou a mandar a chave do cliente').toBeNull()
    expect(fd.get('manter'), 'o formulário voltou a mandar a lista de campos').toBeNull()
    expect(
      chaveDoDestino({ tela: 'casa' }, geometriaCanonica({ tela: 'casa' }, true, lerDaQuery(String(fd.get('back_erro'))))),
      'a chave derivada do back_erro deixou de ser a do slot',
    ).toBe(chaveDoBalao('2026-08-04T14:00', 'horario'))
  })

  it('aula avulsa: createSingleClassAction com contrato, tipo e o horário no fuso do ALUNO', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-0')
    const fd = await enviar(c)
    expect(mock.submits.at(-1)![0]).toBe('createSingleClassAction')
    expect(fd.get('contract_id')).toBe('c-0')
    expect(fd.get('kind')).toBe('extra_paid')
    expect(fd.get('duration_min')).toBe('45')
    // contrato de Cuiabá: o equivalente local é o próprio slot
    expect(fd.get('local_date')).toBe('2026-08-04')
    expect(fd.get('local_time')).toBe('14:00')
    // EDITÁVEIS: o `DateField`/`TimeField` da casa carrega o valor num hidden e
    // mostra um campo de TEXTO — é a existência desse campo visível, com o
    // valor já convertido, que deixa a dona conferir antes de confirmar.
    expect(textosVisiveis(c)).toContain('04/08/2026')
    expect(textosVisiveis(c)).toContain('14:00')
    expect(c.textContent).toContain('fuso de Cuiabá')
  })

  it('experimental: createTrialClassAction com nome, fuso da pessoa e professora', async () => {
    const c = await balao({ professoraFiltrada: OUTRA })
    await escolher(c, 'experimental')
    await digitar(c.querySelector<HTMLInputElement>('input[name="student_name"]')!, 'Maria Silva')
    const fd = await enviar(c)
    expect(mock.submits.at(-1)![0]).toBe('createTrialClassAction')
    expect(fd.get('student_name')).toBe('Maria Silva')
    expect(fd.get('iana_tz')).toBe(CUIABA)
    expect(fd.get('teacher_id')).toBe(OUTRA)
    expect(fd.get('local_date')).toBe('2026-08-04')
  })

  it('bloqueio: addTeacherBlockAction com o DIA do slot nos dois extremos, e a nota', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c, 'bloqueio')
    await digitar(c.querySelector<HTMLInputElement>('input[name="note"]')!, 'férias')
    const fd = await enviar(c)
    expect(mock.submits.at(-1)![0]).toBe('addTeacherBlockAction')
    expect(fd.get('from')).toBe('2026-08-04')
    expect(fd.get('to')).toBe('2026-08-04')
    expect(fd.get('note')).toBe('férias')
    // A NOTA CONTINUA SOBREVIVENDO AO ERRO — é ela que distingue um bloqueio do
    // outro na hora de remover (A3). A lista deixou de ser um campo do
    // formulário e virou tabela do SERVIDOR (A7): o teste passa a cobrá-la lá,
    // que é onde ela decide.
    expect(CAMPOS_DA_PORTA.bloqueio, 'a nota saiu da porta do bloqueio').toContain('note')
  })
})

/* ========================================================================== */
/* 6. O FUSO — grave 3 e médio 1                                               */
/* ========================================================================== */

describe('A4 · grave 3 — escolher o contrato CONVERTE data e hora', () => {
  it('slot 14:00 em Cuiabá + contrato de São Paulo → o campo nasce 15:00', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    // antes de escolher, os campos mostram o próprio slot
    expect(textosVisiveis(c)).toContain('14:00')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    const fd = await enviar(c)
    expect(
      fd.get('local_time'),
      'a aula ia nascer 14:00 em São Paulo — 13:00 no ponto tocado na grade',
    ).toBe('15:00')
    expect(fd.get('local_date')).toBe('2026-08-04')
    // …e a dona VÊ o número novo no campo, não só no envio
    expect(textosVisiveis(c)).toContain('15:00')
  })

  it('trocar de contrato recalcula de novo (e o rótulo do campo segue a cidade)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    const select = c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!
    await digitar(select, 'c-sp')
    expect(c.textContent).toContain('Hora (São Paulo)')
    await digitar(select, 'c-ny')
    // agosto: Nova York está em EDT (UTC−4), o mesmo offset de Cuiabá → 14:00
    expect(textosVisiveis(c)).toContain('14:00')
    expect(c.textContent).toContain('Hora (Nova York)')
    await digitar(select, 'c-0')
    expect(c.textContent).toContain('Hora (Cuiabá)')
  })

  it('o CABEÇALHO para de afirmar Cuiabá quando os campos estão noutro relógio', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    // sem contrato escolhido, o balão só fala do ponto da grade
    expect(c.textContent).toContain('(Cuiabá)')
    expect(c.textContent).not.toContain('Nos campos:')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    expect(c.textContent).toContain('o ponto tocado na grade (Cuiabá)')
    expect(c.textContent).toContain('Nos campos: 04/08/2026 às 15:00 — hora de São Paulo')
  })

  it('PROVA DE MUTAÇÃO (DST): offset fixo passaria em agosto e MENTIRIA em dezembro', () => {
    // O slot é sempre 14:00 em Cuiabá, que não tem horário de verão. Nova York
    // tem: em agosto é EDT (mesma hora), em dezembro é EST (uma hora atrás).
    // Uma conversão por offset FIXO (a que a Lei 1 proíbe) devolveria o mesmo
    // número nos dois meses — e é isso que este par de asserções derruba.
    const agosto = equivalenteNoFuso(instanteDoSlot('2026-08-04', '14:00'), 'America/New_York')
    const dezembro = equivalenteNoFuso(instanteDoSlot('2026-12-04', '14:00'), 'America/New_York')
    expect(agosto).toEqual({ data: '2026-08-04', hora: '14:00' })
    expect(dezembro).toEqual({ data: '2026-12-04', hora: '13:00' })
    expect(dezembro!.hora).not.toBe(agosto!.hora)
    // e Lisboa, no mesmo instante de agosto, é WEST (+1)
    expect(equivalenteNoFuso(instanteDoSlot('2026-08-04', '14:00'), 'Europe/Lisbon')).toEqual({
      data: '2026-08-04',
      hora: '19:00',
    })
  })

  it('zona inválida NÃO mexe nos campos (mentir horário é pior que não converter)', () => {
    expect(equivalenteNoFuso(instanteDoSlot('2026-08-04', '14:00'), 'Marte/Olympus')).toBeNull()
    expect(equivalenteNoFuso('nem instante é', 'America/Sao_Paulo')).toBeNull()
  })

  it('o seletor de contrato MOSTRA a cidade — o dado que evita o erro', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    const opcoes = [...c.querySelectorAll('select[name="contract_id"] option')].map(
      (o) => o.textContent,
    )
    expect(opcoes).toContain('Aluno SP · Mensal 2x · São Paulo')
  })

  it('a camada de dados calcula o fuso do contrato pela MESMA escada da RPC', async () => {
    // slot recorrente ATIVO vence o cadastro do aluno; sem slot, cai no aluno.
    mock.respostas.contracts = {
      data: [
        {
          id: 'c-slot',
          plan_name: 'Mensal',
          students: { display_name: 'Com slot', iana_tz: 'America/Sao_Paulo' },
          student_groups: null,
          recurring_slots: [
            { iana_tz: 'Europe/Lisbon', active_from: '2026-01-01', active_to: null },
            { iana_tz: 'America/New_York', active_from: '2020-01-01', active_to: '2021-01-01' },
          ],
        },
        {
          id: 'c-sem-slot',
          plan_name: 'Mensal',
          students: { display_name: 'Sem slot', iana_tz: 'America/New_York' },
          student_groups: null,
          recurring_slots: [],
        },
      ],
    }
    const { getAgenda } = await import('@/data/admin/agenda')
    const agenda = await getAgenda({
      visao: 'dia',
      ancora: '2026-08-04',
      professora: undefined,
      comJanelas: false,
      busca: undefined,
    })
    const porId = new Map(agenda.contratos.map((c) => [c.id, c]))
    expect(porId.get('c-slot')!.ianaTz, 'o slot ATIVO tem de vencer o cadastro').toBe(
      'Europe/Lisbon',
    )
    expect(porId.get('c-slot')!.cidade).toBe('Lisboa')
    expect(porId.get('c-sem-slot')!.ianaTz).toBe('America/New_York')
    expect(porId.get('c-sem-slot')!.rotulo).toContain('Nova York')
  })
})

describe('A4 · médio 1 — o bloqueio nasce no dia civil DA PROFESSORA', () => {
  it('20:30 em Cuiabá já é o dia seguinte em Lisboa: o campo mostra 05/08', async () => {
    const c = await balao({}, { iso: '2026-08-04', hhmm: '20:30' })
    await escolher(c, 'bloqueio')
    // a dona (Cuiabá): o dia é o da grade
    const select = c.querySelector<HTMLSelectElement>('select[name="teacher_id"]')!
    await digitar(select, PROFESSORA)
    expect(textosVisiveis(c)).toContain('04/08/2026')
    // a professora (Lisboa, UTC+1): 20:30 de Cuiabá é 01:30 do dia SEGUINTE
    await digitar(select, OUTRA)
    const fd = await enviar(c)
    expect(fd.get('from'), 'o bloqueio nasceria no dia errado para a professora').toBe('2026-08-05')
    expect(fd.get('to')).toBe('2026-08-05')
    // …e a tela DIZ isso, em vez de trocar o número em silêncio
    expect(c.textContent).toContain('Em Lisboa este horário já é 05/08/2026')
  })

  it('o seletor de professora do bloqueio mostra a cidade dela', async () => {
    const c = await balao()
    await escolher(c, 'bloqueio')
    const opcoes = [...c.querySelectorAll('select[name="teacher_id"] option')].map(
      (o) => o.textContent,
    )
    expect(opcoes).toContain('Renata · Lisboa')
  })
})

/* ========================================================================== */
/* 7. ERRO REABRE O BALÃO — SEM DADO PESSOAL NA URL, SEM VAZAR PARA O VIZINHO  */
/* ========================================================================== */

describe('A4 · a volta de erro devolve o balão, não uma tela em branco', () => {
  it('ponta a ponta: submit → recusa do banco → cookie+URL → página → balão reaberto', async () => {
    // 1) a dona escolhe a intenção e preenche
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    const fd = await enviar(c)

    // 2) a MESMA FormData vai para a action VERDADEIRA, e o banco recusa
    mock.respostaRpc = { error: { message: 'a aula avulsa precisa ser no futuro' } }
    const url = await rodar(acoesReais.createSingleClassAction, fd)
    const q = Object.fromEntries(new URLSearchParams(url.split('?')[1]))
    expect(q.slot).toBe('2026-08-04T14:00')
    expect(q.si).toBe('avulsa')
    // A7: a frase saiu da URL e foi para o cookie da seção — o tom continua
    // sendo cobrado, na fonte nova.
    expect(q.msg, 'a frase voltou para a barra de endereços').toBeUndefined()
    expect(tomDoAviso(frase())).toBe('erro')
    // o que ela digitou está no COOKIE, sob a chave daquele slot+intenção
    const rascunho = rascunhoNoPote()!
    expect(rascunho.chave).toBe(chaveDoBalao('2026-08-04T14:00', 'avulsa'))
    expect(rascunho.campos.contract_id).toBe('c-sp')
    expect(rascunho.campos.local_time).toBe('15:00')

    // 3) a página relê essa URL e manda a grade reabrir AQUELE slot, já com o
    //    rascunho do cookie na mão
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ v: 'dia', d: '2026-08-04', ...q }),
    })
    const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
    expect(cal.props.slotAberto).toBe('2026-08-04T14:00')
    const provedor = [...percorrer(arvore)].find((el) => el.type === ProvedorDoSlot)!
    const dadosDaPagina = provedor.props.dados as DadosDoSlot
    expect(dadosDaPagina.digitado.contract_id).toBe('c-sp')
    expect(dadosDaPagina.intencaoDoErro).toBe('avulsa')

    // 4) …e o balão daquele slot nasce na intenção certa, com o que ela digitou
    await desmontar()
    const reaberto = await balao({
      slotDoErro: '2026-08-04T14:00',
      intencaoDoErro: 'avulsa',
      digitado: { contract_id: 'c-sp', local_date: '2026-08-04', local_time: '15:00' },
    })
    expect(reaberto.querySelector('form'), 'o balão voltou no passo 1, sem os campos').not.toBeNull()
    expect(reaberto.querySelector<HTMLSelectElement>('select[name="contract_id"]')!.value).toBe('c-sp')
    expect(textosVisiveis(reaberto)).toContain('15:00')
  })

  it('GRAVE 5: NENHUM campo digitado aparece na URL de erro', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c, 'experimental')
    await digitar(c.querySelector<HTMLInputElement>('input[name="student_name"]')!, 'Maria Silva')
    await digitar(c.querySelector<HTMLInputElement>('input[name="price"]')!, '150')
    const fd = await enviar(c)

    mock.respostaRpc = { error: { message: 'conflito de agenda' } }
    const url = await rodar(acoesReais.createTrialClassAction, fd)
    const q = new URLSearchParams(url.split('?')[1])

    // A URL tem SÓ geometria de tela — a frase saiu dela no A7.
    expect([...q.keys()].sort()).toEqual(['si', 'slot'])
    expect(frase()).toContain('conflito de agenda')
    for (const proibido of ['Maria Silva', '150', 'America/Cuiaba', PROFESSORA]) {
      expect(url, `dado pessoal na barra de endereços: ${proibido}`).not.toContain(proibido)
    }
    // …e o dado está no cookie, que é httpOnly, de caminho estreito e vida curta
    const escrita = pote.escritas.filter((e) => e.nome === RASCUNHO_COOKIE).at(-1)!
    expect(escrita.nome).toBe(RASCUNHO_COOKIE)
    expect(escrita.opcoes.httpOnly).toBe(true)
    expect(escrita.opcoes.path).toBe('/admin')
    expect(escrita.opcoes.sameSite).toBe('lax')
    expect(escrita.opcoes.maxAge).toBeGreaterThan(0)
    expect(escrita.opcoes.maxAge).toBeLessThanOrEqual(120)
    expect(rascunhoNoPote()!.campos.student_name).toBe('Maria Silva')
  })

  it('a nota do bloqueio (férias, saúde) também sai da URL', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c, 'bloqueio')
    await digitar(c.querySelector<HTMLInputElement>('input[name="note"]')!, 'cirurgia da dona')
    const fd = await enviar(c)
    mock.respostaRpc = { error: { message: 'deu ruim' } }
    const url = await rodar(acoesReais.addTeacherBlockAction, fd)
    expect(url).not.toContain('cirurgia')
    expect(url).not.toContain('note=')
    expect(rascunhoNoPote()!.campos.note).toBe('cirurgia da dona')
  })

  it('SUCESSO apaga o rascunho — o próximo formulário nasce limpo', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c, 'bloqueio')
    await digitar(c.querySelector<HTMLInputElement>('input[name="note"]')!, 'férias')
    const fd = await enviar(c)
    mock.respostaRpc = { error: { message: 'deu ruim' } }
    await rodar(acoesReais.addTeacherBlockAction, fd)
    expect(rascunhoNoPote()).not.toBeNull()
    // agora dá certo
    mock.respostaRpc = { data: null, error: null }
    await rodar(acoesReais.addTeacherBlockAction, fd)
    expect(rascunhoNoPote(), 'o rascunho sobreviveu a um ato concluído').toBeNull()
  })

  it('CHAVE ERRADA não preenche: rascunho do balão não vaza para o painel (nem vice-versa)', async () => {
    const { gravarRascunho, lerRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    await gravarRascunho(chaveDoBalao('2026-08-04T14:00', 'avulsa'), { contract_id: 'c-sp' })
    expect(await lerRascunho(chaveDoBalao('2026-08-04T14:00', 'avulsa'))).toEqual({
      contract_id: 'c-sp',
    })
    // outro slot, outra intenção, outro painel: todos vazios
    expect(await lerRascunho(chaveDoBalao('2026-08-04T14:30', 'avulsa'))).toEqual({})
    expect(await lerRascunho(chaveDoBalao('2026-08-04T14:00', 'bloqueio'))).toEqual({})
    expect(await lerRascunho(chaveDoPainel('avulsa'))).toEqual({})
  })

  it('cookie EXPIRADO/ausente: o balão ainda reabre, só que limpo', async () => {
    const { lerRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    // nada no pote (é o que a expiração de 60s produz)
    expect(await lerRascunho(chaveDoBalao('2026-08-04T14:00', 'avulsa'))).toEqual({})
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ v: 'dia', d: '2026-08-04', slot: '2026-08-04T14:00', si: 'avulsa' }),
    })
    const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
    expect(cal.props.slotAberto).toBe('2026-08-04T14:00')
    const provedor = [...percorrer(arvore)].find((el) => el.type === ProvedorDoSlot)!
    expect((provedor.props.dados as DadosDoSlot).digitado).toEqual({})
  })

  it('GRAVE 4: o valor restaurado existe SÓ dentro do slot que falhou', async () => {
    const restaurado = {
      slotDoErro: '2026-08-04T14:00',
      intencaoDoErro: 'avulsa' as const,
      digitado: { contract_id: 'c-sp', local_date: '2026-08-04', local_time: '15:00' },
    }
    // o VIZINHO das 14:30 nasce no passo 1 e, quando ela escolhe "avulsa" ali,
    // o formulário é do PRÓPRIO slot — não do que falhou
    const vizinho = await balao(restaurado, { iso: '2026-08-04', hhmm: '14:30' })
    expect(vizinho.querySelector('form')).toBeNull()
    await escolher(vizinho, 'avulsa')
    expect(
      vizinho.querySelector<HTMLSelectElement>('select[name="contract_id"]')!.value,
      'o contrato do slot que falhou reapareceu no vizinho',
    ).toBe('')
    expect(
      textosVisiveis(vizinho),
      'o horário 15:00 do erro anterior vazou para o slot das 14:30',
    ).not.toContain('15:00')
    expect(textosVisiveis(vizinho)).toContain('14:30')
    // …e o que ela enviar dali é do PRÓPRIO slot (contrato de Cuiabá: sem
    // conversão no meio, o número tem de continuar 14:30)
    await digitar(vizinho.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-0')
    const fd = await enviar(vizinho)
    expect(fd.get('local_time')).toBe('14:30')
    // A7: a identidade é derivada do `back_erro` daquele slot (ver §5).
    expect(
      chaveDoDestino({ tela: 'casa' }, geometriaCanonica({ tela: 'casa' }, true, lerDaQuery(String(fd.get('back_erro'))))),
    ).toBe(chaveDoBalao('2026-08-04T14:30', 'avulsa'))

    // PROVA DE MUTAÇÃO (o outro sentido): no slot que FALHOU, restaura mesmo
    await desmontar()
    const oDoErro = await balao(restaurado, { iso: '2026-08-04', hhmm: '14:00' })
    expect(oDoErro.querySelector<HTMLSelectElement>('select[name="contract_id"]')!.value).toBe('c-sp')
    expect(textosVisiveis(oDoErro)).toContain('15:00')
  })

  it('slot ou intenção malformados na URL não abrem balão nenhum', async () => {
    for (const q of [
      { slot: 'ontem de tarde', si: 'avulsa' },
      { slot: '2026-08-04T14:00', si: 'apagar-tudo' },
      { slot: '2026-08-04T14:00' },
      { si: 'avulsa' },
    ]) {
      const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ v: 'dia', ...q }) })
      const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
      expect(cal.props.slotAberto, JSON.stringify(q)).toBeUndefined()
    }
  })

  it('a chave do slot e a URL de erro são as MESMAS dos dois lados', () => {
    expect(chaveDoSlot('2026-08-04', '14:00')).toBe('2026-08-04T14:00')
    expect(urlDoSlotComErro('/admin/agenda', '2026-08-04', '14:00', 'bloqueio')).toBe(
      '/admin/agenda?slot=2026-08-04T14:00&si=bloqueio',
    )
    // com query existente, o separador é `&` (senão a volta de erro perderia o
    // filtro de professora e a data que a dona estava vendo)
    expect(
      urlDoSlotComErro('/admin/agenda?v=dia&prof=x', '2026-08-04', '14:00', 'horario'),
    ).toBe('/admin/agenda?v=dia&prof=x&slot=2026-08-04T14:00&si=horario')
  })
})

/* ========================================================================== */
/* 8. CORTESIA É GRATUITA DE VERDADE (grave 1)                                 */
/* ========================================================================== */

describe('A4 · grave 1 — cortesia DESMONTA o campo de valor', () => {
  it('o caminho do Sol: digita 150 na extra, volta, troca para cortesia, confirma', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-0')
    await digitar(c.querySelector<HTMLInputElement>('input[name="price"]')!, '150')
    // …a dona troca para cortesia
    await digitar(c.querySelector<HTMLSelectElement>('select[name="kind"]')!, 'courtesy')
    expect(
      c.querySelector('input[name="price"]'),
      'o campo de valor continua MONTADO — é assim que 15000 chega na cortesia',
    ).toBeNull()
    const fd = await enviar(c)
    expect(fd.get('kind')).toBe('courtesy')
    expect(fd.get('price'), 'a cortesia levou preço no envio').toBeNull()
    // …e a tela diz por que o campo sumiu, em vez de sumir calada
    expect(c.textContent).toContain('o aluno não paga nada por esta aula')
  })

  it('voltar para "extra" NÃO ressuscita o valor antigo', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLInputElement>('input[name="price"]')!, '150')
    const kind = c.querySelector<HTMLSelectElement>('select[name="kind"]')!
    await digitar(kind, 'courtesy')
    await digitar(kind, 'extra_paid')
    expect(c.querySelector<HTMLInputElement>('input[name="price"]')!.value).toBe('')
  })

  it('PROVA DE MUTAÇÃO: na EXTRA o campo existe e o valor viaja', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-0')
    await digitar(c.querySelector<HTMLInputElement>('input[name="price"]')!, '150')
    const fd = await enviar(c)
    expect(fd.get('kind')).toBe('extra_paid')
    expect(fd.get('price')).toBe('150')
  })

  it('o painel `?novo=avulsa` usa a MESMA peça (o defeito não fica na tela do lado)', async () => {
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ novo: 'avulsa' }) })
    // Rodada 2 (grave 3): o painel deixou de ter campos próprios e passou a
    // hospedar a peça INTEIRA do balão — que é quem carrega o
    // `TipoEValorDaAvulsa` dentro dela.
    expect([...percorrer(arvore)].some((el) => el.type === CamposDaAvulsa)).toBe(true)
    // …e o truque de CSS que escondia sem desmontar morreu junto
    const fonte = readFileSync(join(process.cwd(), 'src/app/admin/agenda/page.tsx'), 'utf8')
    expect(fonte).not.toContain('data-price')
    expect(fonte).not.toContain('option[value=courtesy]:checked')
  })
})

/* ========================================================================== */
/* 9. MÉDIO 3/4 — abertura controlada, e só na grade visível                   */
/* ========================================================================== */

describe('A4 · médios 3 e 4 — quem abre é o cliente, e só uma grade', () => {
  async function semana(slotAberto?: string) {
    return montarNo(
      h(ProvedorDoSlot, {
        dados: dados(),
        children: h(Calendario, {
          events: [],
          view: 'semana' as const,
          // ÂNCORA NO DIA DO SLOT de propósito: é exatamente quando as duas
          // grades da semana mostram a mesma meia-hora — o caso do médio 3.
          anchor: '2026-08-04',
          tz: CUIABA,
          dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
          todayISO: '2026-08-04',
          slotAberto,
          slotPopup: (iso: string, hhmm: string) =>
            h(IntencoesDoSlot, {
              iso,
              hhmm,
              titulo: 'ter, 04/08',
              instanteUtc: instanteDoSlot(iso, hhmm),
            }),
        }),
      }),
    )
  }

  const abertos = () =>
    document.body.querySelectorAll('[data-slot="popover-content"]').length

  it('MÉDIO 3: a semana abre UM balão só, mesmo com o slot no dia da âncora', async () => {
    // celular: só a grade de dia único abre
    tela.desktop = false
    await semana('2026-08-04T14:00')
    expect(abertos(), 'as duas grades da semana abriram o mesmo slot').toBe(1)

    // desktop: continua UM (agora o da grade de 7 colunas)
    await larguraDeTela(true)
    expect(abertos()).toBe(1)
  })

  it('MÉDIO 4: Back/Forward entre URL limpa e URL de erro muda o Root já montado', async () => {
    tela.desktop = false
    // (1) URL limpa: nada aberto
    await semana(undefined)
    expect(abertos()).toBe(0)
    // (2) Forward para a URL de erro, no MESMO Root (é o que o Router faz)
    await act(async () => {
      root!.render(
        h(ProvedorDoSlot, {
          dados: dados(),
          children: h(Calendario, {
            events: [],
            view: 'semana' as const,
            anchor: '2026-08-04',
            tz: CUIABA,
            dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
            todayISO: '2026-08-04',
            slotAberto: '2026-08-04T14:00',
            slotPopup: (iso: string, hhmm: string) =>
              h(IntencoesDoSlot, {
                iso,
                hhmm,
                titulo: 'ter, 04/08',
                instanteUtc: instanteDoSlot(iso, hhmm),
              }),
          }),
        }),
      )
    })
    expect(abertos(), 'o Root já montado ignorou a URL nova (defeito do defaultOpen)').toBe(1)
    // (3) Back para a URL limpa: fecha
    await act(async () => {
      root!.render(
        h(ProvedorDoSlot, {
          dados: dados(),
          children: h(Calendario, {
            events: [],
            view: 'semana' as const,
            anchor: '2026-08-04',
            tz: CUIABA,
            dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
            todayISO: '2026-08-04',
            slotPopup: (iso: string, hhmm: string) =>
              h(IntencoesDoSlot, {
                iso,
                hhmm,
                titulo: 'ter, 04/08',
                instanteUtc: instanteDoSlot(iso, hhmm),
              }),
          }),
        }),
      )
    })
    expect(abertos(), 'o Back deixou o balão do erro aberto').toBe(0)
  })
})

/* ========================================================================== */
/* 10. VER × PODER · a régua de legibilidade                                   */
/* ========================================================================== */

describe('A4 · o botão "com janelas" governa o que APARECE, não o que ela pode fazer', () => {
  async function calendarioDaPagina(query: Record<string, string>) {
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve(query) })
    return [...percorrer(arvore)].find((el) => el.type === Calendario)!
  }

  it('com a camada DESLIGADA (j=0), o balão do slot continua existindo', async () => {
    const cal = await calendarioDaPagina({ v: 'dia', j: '0' })
    expect(typeof cal.props.slotPopup).toBe('function')
    // …e a camada de janelas realmente não foi consultada (o `j=0` fez efeito)
    expect(mock.chamadas.reschedule_windows).toBeUndefined()
  })

  it('semana e dia têm balão; o MÊS não (não há meia-hora para tocar)', async () => {
    for (const v of ['dia', 'semana']) {
      expect(typeof (await calendarioDaPagina({ v })).props.slotPopup).toBe('function')
    }
    expect((await calendarioDaPagina({ v: 'mes' })).props.slotPopup).toBeUndefined()
  })

  it('o título do dia chega ESCRITO do servidor, e o instante em UTC junto', async () => {
    const cal = await calendarioDaPagina({ v: 'dia', d: '2026-08-04' })
    const conteudo = (cal.props.slotPopup as (i: string, h: string) => ReactNode)(
      '2026-08-04',
      '14:00',
    ) as ElementoDaArvore
    expect(conteudo.props.titulo).toBe('ter., 04/08')
    expect(conteudo.props.iso).toBe('2026-08-04')
    expect(conteudo.props.hhmm).toBe('14:00')
    // Lei 1: a conversão civil→instante é do SERVIDOR; o cliente só lê.
    expect(conteudo.props.instanteUtc).toBe('2026-08-04T18:00:00.000Z')
  })
})

describe('A4 · médio 5 — os dados que evitam o erro de fuso saem do degrau de apoio', () => {
  /** O rótulo (o `<span>` de texto) do campo cujo `name` é dado. */
  function rotuloDoCampo(c: HTMLElement, name: string): HTMLElement {
    const campo = c.querySelector(`[name="${name}"]`)!
    const label = campo.closest('label')!
    return label.querySelector('span')!
  }

  it('data, hora e valor: piso de DADO (nunca text-xs, nunca ink-400)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    for (const campo of ['local_date', 'local_time', 'contract_id']) {
      const rotulo = rotuloDoCampo(c, campo)
      expect(rotulo.className, `${campo}: rótulo abaixo do piso`).toContain('text-sm')
      expect(rotulo.className).not.toContain('text-xs')
      expect(rotulo.className).toContain('text-ink-900')
    }
    // o Valor, na extra cobrada
    expect(rotuloDoCampo(c, 'price').className).toContain('text-sm')
    expect(rotuloDoCampo(c, 'price').className).not.toContain('text-xs')
  })

  it('a cidade do CityPicker deixou de ser `small` (o campo que define o fuso)', async () => {
    const c = await balao()
    await escolher(c, 'experimental')
    const cidade = c.querySelector<HTMLInputElement>('input[role="combobox"]')!
    expect(cidade.className, 'a cidade continuava em text-xs').not.toContain('text-xs')
    expect(cidade.className).toContain('text-sm')
    // e o rótulo dela também está no piso de DADO
    expect(rotuloDoCampo(c, 'iana_tz').className).toContain('text-sm')
  })

  it('a linha da HORA ATUAL da cidade saiu do degrau de apoio', async () => {
    // É a conferência visual que evita marcar no fuso errado — a mais barata
    // que a tela oferece, e estava em `text-xs text-ink-400`. Cobrada no DOM
    // REAL do balão (o campo nasce com Cuiabá escolhido, então a linha existe).
    const c = await balao()
    await escolher(c, 'experimental')
    const linha = [...c.querySelectorAll('p')].find((p) =>
      (p.textContent ?? '').startsWith('agora são'),
    )
    expect(linha, 'a linha da hora atual da cidade sumiu do balão').toBeDefined()
    expect(linha!.className).toContain('text-sm')
    expect(linha!.className).not.toContain('text-xs')
    expect(linha!.className).not.toContain('text-ink-400')
  })
})

/* ========================================================================== */
/* 11. GRAVE 1 — A HORA QUE NÃO EXISTE, E A QUE EXISTE DUAS VEZES             */
/* ========================================================================== */

/**
 * O caminho inteiro é uma VOLTA: o servidor manda o instante do slot, o balão o
 * converte para os campos civis do fuso do aluno, e a RPC reconstrói o instante
 * com `AT TIME ZONE`. Nos dois dias do ano em que o relógio da cidade pula ou
 * repete, a volta não fecha — e o banco grava, sem erro, um instante que
 * ninguém escolheu. Os dois cenários abaixo são os que o revisor mediu.
 */
describe('A4 · grave 1 — round-trip do civil antes de enviar', () => {
  it('a peça pura: hora AMBÍGUA em Lisboa (fim do horário de verão) é recusada', () => {
    // 25/10/2026, 01:30 em Lisboa acontece DUAS vezes: 00:30Z (ainda WEST) e
    // 01:30Z (já WET). O `AT TIME ZONE` do Postgres fica com a segunda.
    const v = conferirHoraCivil('2026-10-25', '01:30', 'Europe/Lisbon')
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('inalcançável')
    expect(v.motivo).toBe('ambigua')
    if (v.motivo !== 'ambigua') throw new Error('inalcançável')
    expect(v.primeiro).toBe('2026-10-25T00:30:00.000Z')
    expect(v.segundo).toBe('2026-10-25T01:30:00.000Z')
    // …e é exatamente a primeira que o ponto tocado na grade produz: 24/10 às
    // 20:30 em Cuiabá é 25/10 00:30Z. O banco gravaria a segunda — a aula
    // apareceria 21:30 em Cuiabá, uma hora depois do ponto tocado.
    const tocado = instanteDoSlot('2026-10-24', '20:30')
    expect(tocado).toBe('2026-10-25T00:30:00.000Z')
    expect(equivalenteNoFuso(tocado, 'Europe/Lisbon')).toEqual({
      data: '2026-10-25',
      hora: '01:30',
    })
  })

  it('a peça pura: hora INEXISTENTE em Lisboa (início do horário de verão) é recusada', () => {
    // 29/03/2026 o relógio de Lisboa vai de 00:59 para 02:00 — 01:30 não existe.
    const v = conferirHoraCivil('2026-03-29', '01:30', 'Europe/Lisbon')
    expect(v.ok).toBe(false)
    if (v.ok || v.motivo !== 'inexistente') throw new Error('veredicto errado')
    // e é para onde a aula iria se alguém gravasse assim mesmo
    expect(v.viraria).toBe('02:30')
  })

  it('PROVA DE MUTAÇÃO: nos outros 363 dias a mesma hora passa, com o instante certo', () => {
    const v = conferirHoraCivil('2026-10-18', '01:30', 'Europe/Lisbon')
    expect(v.ok).toBe(true)
    if (!v.ok) throw new Error('inalcançável')
    expect(v.instanteUtc).toBe('2026-10-18T00:30:00.000Z')
    // Cuiabá não tem horário de verão: nenhuma data dá ambiguidade lá
    for (const dia of ['2026-10-18', '2026-10-25', '2026-03-29', '2026-02-15'])
      expect(conferirHoraCivil(dia, '01:30', 'America/Cuiaba').ok, dia).toBe(true)
  })

  it('data/hora sem sentido e zona desconhecida não passam por engano', () => {
    expect(conferirHoraCivil('2026-02-30', '10:00', 'Europe/Lisbon')).toEqual({
      ok: false,
      motivo: 'formato',
    })
    expect(conferirHoraCivil('2026-02-10', '25:00', 'Europe/Lisbon')).toEqual({
      ok: false,
      motivo: 'formato',
    })
    expect(conferirHoraCivil('2026-02-10', '10:00', 'Marte/Olympus')).toEqual({
      ok: false,
      motivo: 'zona',
    })
  })

  it('A TELA RECUSA: experimental em Lisboa na hora ambígua não chega ao banco', async () => {
    // o balão do slot das 20:30 de 24/10 em Cuiabá, com a pessoa nova em Lisboa
    const c = await balao({ professoraFiltrada: PROFESSORA }, { iso: '2026-10-24', hhmm: '20:30' })
    await escolher(c, 'experimental')
    await digitar(c.querySelector<HTMLInputElement>('input[name="student_name"]')!, 'Maria Silva')
    const fd = await enviar(c)
    // o campo já mostra o equivalente de Lisboa…
    fd.set('iana_tz', 'Europe/Lisbon')
    fd.set('local_date', '2026-10-25')
    fd.set('local_time', '01:30')

    mock.rpcs = []
    const url = await rodar(acoesReais.createTrialClassAction, fd)
    expect(mock.rpcs, 'a aula ambígua chegou ao banco').toHaveLength(0)
    const q = Object.fromEntries(new URLSearchParams(url.split('?')[1]))
    // A7: a frase mora no cookie da seção; a URL leva só geometria.
    expect(tomDoAviso(frase())).toBe('erro')
    expect(frase()).toContain('Lisboa')
    expect(frase()).toContain('DUAS vezes')
    expect(frase()).toContain('Nada foi criado')
    // …e o balão reabre no mesmo slot, com o que ela digitou guardado
    expect(q.slot).toBe('2026-10-24T20:30')
    expect(rascunhoNoPote()!.campos.student_name).toBe('Maria Silva')
  })

  it('A TELA RECUSA: hora que NÃO EXISTE, digitada à mão, também para aqui', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA }, { iso: '2026-03-28', hhmm: '20:30' })
    await escolher(c, 'experimental')
    await digitar(c.querySelector<HTMLInputElement>('input[name="student_name"]')!, 'Maria Silva')
    const fd = await enviar(c)
    fd.set('iana_tz', 'Europe/Lisbon')
    fd.set('local_date', '2026-03-29')
    fd.set('local_time', '01:30')

    mock.rpcs = []
    const url = await rodar(acoesReais.createTrialClassAction, fd)
    expect(mock.rpcs).toHaveLength(0)
    const msg = frase()
    expect(url, 'a frase voltou para a barra de endereços').not.toContain('msg=')
    expect(msg).toContain('não existe em Lisboa')
    expect(msg).toContain('02:30')
  })

  it('PROVA DE MUTAÇÃO (o outro sentido): uma semana antes, o MESMO envio cria', async () => {
    const c = await balao({ professoraFiltrada: PROFESSORA }, { iso: '2026-10-17', hhmm: '20:30' })
    await escolher(c, 'experimental')
    await digitar(c.querySelector<HTMLInputElement>('input[name="student_name"]')!, 'Maria Silva')
    const fd = await enviar(c)
    fd.set('iana_tz', 'Europe/Lisbon')
    fd.set('local_date', '2026-10-18')
    fd.set('local_time', '01:30')

    mock.rpcs = []
    await rodar(acoesReais.createTrialClassAction, fd)
    expect(mock.rpcs.map(([n]) => n)).toContain('admin_create_trial_class')
  })

  it('a AVULSA confere o fuso pela mesma escada da RPC — e recusa fail-closed', async () => {
    // contrato de Lisboa (slot vigente), e a hora ambígua daquela madrugada
    mock.respostas.contracts = {
      data: {
        students: { iana_tz: 'America/Sao_Paulo' },
        recurring_slots: [{ iana_tz: 'Europe/Lisbon', active_from: '2026-01-01', active_to: null }],
      },
    }
    const fd = new FormData()
    fd.set('contract_id', 'c-lisboa')
    fd.set('local_date', '2026-10-25')
    fd.set('local_time', '01:30')
    fd.set('kind', 'courtesy')
    fd.set('duration_min', '45')
    fd.set('back', '/admin/agenda')
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, fd)
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('Lisboa')

    // LEITURA que falha RECUSA (nada é criado às cegas)
    mock.respostas.contracts = { data: null, error: { message: 'timeout' } }
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, fd)
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('Falha ao conferir o fuso do contrato')

    // PROVA DE MUTAÇÃO: contrato de Cuiabá, mesma data → passa
    mock.respostas.contracts = {
      data: { students: { iana_tz: 'America/Cuiaba' }, recurring_slots: [] },
    }
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, fd)
    expect(mock.rpcs.map(([n]) => n)).toContain('admin_create_single_class')
  })
})

/* ========================================================================== */
/* 12. O "HOJE" DA ESCADA VEM DO BANCO — E NÃO DE UMA CONTA EM NODE           */
/* ========================================================================== */

/**
 * Sol · rodada 2 do A4 (grave 2) trocou o dia de CUIABÁ pelo dia UTC do Node
 * (`diaDoBanco()`). A revisão independente do A4 (29/07, grave 3) mostrou que
 * isso continuava sendo uma SUPOSIÇÃO: `current_date`, dentro da RPC, vale no
 * `TimeZone` DA SESSÃO Postgres — não no relógio do host e não no processo
 * Node. Enquanto produção estiver em UTC os dois coincidem; se o invariante
 * operacional quebrar, o app resolve Lisboa, a RPC resolve Orlando e a aula
 * nasce cinco horas fora do lugar, sem erro nenhum.
 *
 * A suposição foi ELIMINADA: `diaDoBanco()` não existe mais e a comparação de
 * vigência viaja para o banco como filtro de embed, com o literal `today` do
 * Postgres (que É `current_date`, na mesma sessão). O que se cobra aqui:
 *   1. a consulta MANDA a comparação para o banco (as duas metades, `>=` e o
 *      `or` do `active_to` nulo);
 *   2. o app NÃO refiltra por data nenhuma — com o "hoje do banco" divergindo
 *      do "hoje do Node", quem manda é o banco;
 *   3. nenhum caminho da agenda calcula um "dia do banco" em Node.
 */
describe('A4 · grave 3 (revisão independente) — a vigência é comparada NO BANCO', () => {
  /** Um contrato com DUAS vigências que trocam na virada de 31/07 para 01/08. */
  const CONTRATO_QUE_TROCA_DE_FUSO = {
    id: 'c-troca',
    plan_name: 'Mensal',
    students: { display_name: 'Quem mudou de país', iana_tz: 'America/Cuiaba' },
    student_groups: null,
    recurring_slots: [
      { iana_tz: 'America/Cuiaba', active_from: '2026-01-01', active_to: '2026-07-31' },
      { iana_tz: 'Europe/Lisbon', active_from: '2026-08-01', active_to: null },
    ],
  }

  async function agendaCom(slots: unknown[]) {
    mock.respostas.contracts = { data: [{ ...CONTRATO_QUE_TROCA_DE_FUSO, recurring_slots: slots }] }
    const { getAgenda } = await import('@/data/admin/agenda')
    return getAgenda({
      visao: 'dia',
      ancora: '2026-08-04',
      professora: undefined,
      comJanelas: false,
      busca: undefined,
    })
  }

  it('a consulta dos contratos manda as DUAS metades da vigência para o banco', async () => {
    mock.chamadas = {}
    await agendaCom(CONTRATO_QUE_TROCA_DE_FUSO.recurring_slots)
    const chamadas = mock.chamadas.contracts
    const lte = chamadas.filter(([m]) => m === 'lte').map(([, k, v]) => `${k}=${v}`)
    expect(lte, 'o `active_from <= current_date` da RPC ficou em Node').toContain(
      'recurring_slots.active_from=today',
    )
    const or = chamadas.find(([m]) => m === 'or')!
    expect(or, 'o `active_to is null or >= current_date` da RPC ficou em Node').toBeDefined()
    expect(or[1]).toBe('active_to.is.null,active_to.gte.today')
    expect(or[2]).toEqual({ referencedTable: 'recurring_slots' })
  })

  it('o "hoje do BANCO" diverge do "hoje do Node" → a escolha do fuso segue o BANCO', async () => {
    // O Node acha que é 15/01/2026 — muito ANTES de a vigência de Lisboa
    // começar. Se sobrasse qualquer comparação de data do lado de cá, a linha
    // de Lisboa seria descartada e o fuso cairia no cadastro do aluno (Cuiabá).
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    // O BANCO, com a sessão noutro fuso, já está em 01/08 — e por isso devolve
    // SÓ a linha vigente para ele (é o filtro `today` fazendo o corte lá).
    const agenda = await agendaCom([
      { iana_tz: 'Europe/Lisbon', active_from: '2026-08-01', active_to: null },
    ])
    const contrato = agenda.contratos.find((c) => c.id === 'c-troca')!
    expect(
      contrato.ianaTz,
      'o app refiltrou por um "hoje" próprio e discordou da RPC na mesma confirmação',
    ).toBe('Europe/Lisbon')
    expect(contrato.cidade).toBe('Lisboa')
    // …e o `hojeISO` da agenda continua sendo o dia do NEGÓCIO (a grade é dela)
    expect(agenda.hojeISO).toBe('2026-01-15')
  })

  it('PROVA DE MUTAÇÃO: se o banco devolver a linha VELHA, é ela que vale', async () => {
    vi.setSystemTime(new Date('2026-08-01T02:00:00Z'))
    const agenda = await agendaCom([
      { iana_tz: 'America/Cuiaba', active_from: '2026-01-01', active_to: '2026-07-31' },
    ])
    expect(agenda.contratos.find((c) => c.id === 'c-troca')!.ianaTz).toBe('America/Cuiaba')
  })

  it('o DESEMPATE continua sendo o da RPC: `active_from` mais recente vence', async () => {
    // Duas linhas vigentes ao mesmo tempo (é o que `order by active_from desc
    // limit 1` resolve dentro da função).
    const agenda = await agendaCom([
      { iana_tz: 'America/Cuiaba', active_from: '2026-01-01', active_to: null },
      { iana_tz: 'Europe/Lisbon', active_from: '2026-06-01', active_to: null },
    ])
    expect(agenda.contratos.find((c) => c.id === 'c-troca')!.ianaTz).toBe('Europe/Lisbon')
  })

  it('a MESMA escada vale na action da avulsa — e também vai inteira para o banco', async () => {
    mock.chamadas = {}
    mock.respostas.contracts = {
      data: {
        teacher_id: PROFESSORA,
        students: { iana_tz: 'America/Cuiaba' },
        recurring_slots: [{ iana_tz: 'Europe/Lisbon', active_from: '2026-08-01' }],
      },
    }
    const fd = new FormData()
    fd.set('contract_id', 'c-troca')
    fd.set('local_date', '2026-10-25')
    fd.set('local_time', '01:30') // ambígua SÓ em Lisboa
    fd.set('kind', 'courtesy')
    fd.set('duration_min', '45')
    fd.set('back', '/admin/agenda')
    // Node num dia em que a vigência de Lisboa ainda não começou:
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, fd)
    expect(mock.rpcs, 'a action escolheu o fuso por um "hoje" de Node').toHaveLength(0)
    expect(frase()).toContain('Lisboa')
    const chamadas = mock.chamadas.contracts
    expect(chamadas.filter(([m]) => m === 'lte').map(([, k, v]) => `${k}=${v}`)).toContain(
      'recurring_slots.active_from=today',
    )
    expect(chamadas.find(([m]) => m === 'or')![1]).toBe('active_to.is.null,active_to.gte.today')
  })

  it('VARREDOR: nenhum caminho da agenda inventa um "dia do banco" em Node', async () => {
    const fonte = [
      readFileSync(join(process.cwd(), 'src/app/admin/agenda/actions.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/data/admin/agenda.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/lib/admin/hora-civil.ts'), 'utf8'),
    ]
    for (const f of fonte)
      expect(
        /\bdiaDoBanco\s*\(/.test(f),
        'voltou a existir um "hoje do banco" calculado em Node — a suposição do grave 3',
      ).toBe(false)
  })
})

/* ========================================================================== */
/* 13. GRAVE 3 — A PORTA LEGADA USA A MESMA PEÇA                              */
/* ========================================================================== */

describe('A4 · grave 3 — o painel `?novo=` recalcula como o balão', () => {
  /** A peça do painel, montada dentro de um form como a página a monta. */
  async function painel(props: Record<string, unknown>) {
    return montarNo(
      h(
        'form',
        {},
        h(CamposDaAvulsa, {
          contratos: dados().contratos,
          digitado: {},
          instanteUtc: null,
          horaNaGrade: null,
          ...props,
        }),
      ),
    )
  }

  it('o painel recebe o INSTANTE do ponto tocado (`nd`/`nt` são hora de Cuiabá)', async () => {
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ novo: 'avulsa', nd: '2026-08-04', nt: '14:00' }),
    })
    const peca = [...percorrer(arvore)].find((el) => el.type === CamposDaAvulsa)!
    expect(peca.props.instanteUtc).toBe('2026-08-04T18:00:00.000Z')
    expect(peca.props.horaNaGrade).toBe('14:00')
  })

  it('link salvo com nd/nt + contrato de São Paulo envia 15:00, não 14:00', async () => {
    const c = await painel({
      instanteUtc: instanteDoSlot('2026-08-04', '14:00'),
      horaNaGrade: '14:00',
      dataInicial: '2026-08-04',
      horaInicial: '14:00',
    })
    expect(textosVisiveis(c)).toContain('14:00')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    expect(
      textosVisiveis(c),
      'o painel criava a aula às 14:00 de São Paulo — 13:00 no ponto tocado',
    ).toContain('15:00')
    const escondido = c.querySelector<HTMLInputElement>('input[name="local_time"]')!
    expect(escondido.value).toBe('15:00')
    expect(c.textContent).toContain('Hora (São Paulo)')
  })

  it('sem ponto tocado (painel aberto pelo menu) NADA é recalculado', async () => {
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ novo: 'avulsa' }) })
    const peca = [...percorrer(arvore)].find((el) => el.type === CamposDaAvulsa)!
    expect(peca.props.instanteUtc).toBeNull()

    const c = await painel({ instanteUtc: null, horaNaGrade: null })
    await digitar(c.querySelector<HTMLInputElement>('input[type="text"]')!, '05082026')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    // a data que ela digitou continua lá — nada foi convertido por cima
    expect(c.querySelector<HTMLInputElement>('input[name="local_date"]')!.value).toBe('2026-08-05')
  })

  it('a experimental do painel é a MESMA peça, com as professoras do servidor', async () => {
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ novo: 'experimental', nd: '2026-08-04', nt: '14:00' }),
    })
    const peca = [...percorrer(arvore)].find((el) => el.type === CamposDaExperimental)!
    expect(peca.props.instanteUtc).toBe('2026-08-04T18:00:00.000Z')
    expect((peca.props.professoras as { id: string }[]).map((t) => t.id)).toEqual([
      PROFESSORA,
      OUTRA,
    ])
  })
})

/* ========================================================================== */
/* 14. GRAVE 4 — BLOQUEIO IMPEDE PUBLICAR JANELA NOVA                         */
/* ========================================================================== */

describe('A4 · grave 4 — publicar dentro de um bloqueio é recusado', () => {
  function formDePublicar() {
    const fd = new FormData()
    fd.set('teacher_id', PROFESSORA)
    fd.set('local_date', '2026-08-04')
    fd.set('local_time', '14:00')
    fd.set('back', '/admin/agenda')
    return fd
  }

  it('há bloqueio no horário → nenhuma janela é publicada, e a frase NOMEIA o período', async () => {
    // A NOTA NÃO PODE APARECER NA FRASE (revisão independente do A4, grave 2):
    // ela vai para a query string, e é onde se escreve "consulta médica da
    // dona". O bloqueio é identificado pelo PERÍODO, na mesma grafia do painel.
    mock.respostas.teacher_availability_exceptions = {
      data: [{ note: 'consulta médica da dona', local_snapshot: `2026-08-04 → 2026-08-04 ${CUIABA}` }],
    }
    mock.rpcs = []
    const url = await rodar(acoesReais.publishWindowAction, formDePublicar())
    expect(mock.rpcs, 'a janela foi publicada dentro do bloqueio').toHaveLength(0)
    const msg = frase()
    expect(url, 'a frase voltou para a barra de endereços').not.toContain('msg=')
    expect(tomDoAviso(msg)).toBe('erro')
    expect(msg).toContain('dentro de um bloqueio da professora')
    expect(msg, 'a dona precisa saber QUAL bloqueio para poder removê-lo').toContain('04/08/2026')
    expect(msg).toContain('Disponibilidade e bloqueios')
    expect(msg).toContain('Nada foi publicado')
    expect(msg, 'a NOTA PRIVADA do bloqueio foi publicada na URL').not.toContain('consulta médica')
  })

  it('a consulta NEM LÊ a `note` — o que não se seleciona não vaza', async () => {
    mock.respostas.teacher_availability_exceptions = { data: [] }
    mock.chamadas = {}
    await rodar(acoesReais.publishWindowAction, formDePublicar())
    const select = mock.chamadas.teacher_availability_exceptions.find(([m]) => m === 'select')!
    expect(String(select[1])).not.toContain('note')
  })

  it('PROVA DE MUTAÇÃO: sem bloqueio, a MESMA publicação acontece', async () => {
    mock.respostas.teacher_availability_exceptions = { data: [] }
    mock.rpcs = []
    await rodar(acoesReais.publishWindowAction, formDePublicar())
    const chamada = mock.rpcs.find(([n]) => n === 'publish_reschedule_window')!
    expect(chamada, 'a publicação parou de funcionar no caminho livre').toBeDefined()
    expect((chamada[1] as Record<string, unknown>).p_iana_tz).toBe(CUIABA)
  })

  it('FAIL-CLOSED: leitura dos bloqueios que falha também recusa', async () => {
    mock.respostas.teacher_availability_exceptions = { data: null, error: { message: 'timeout' } }
    mock.rpcs = []
    await rodar(acoesReais.publishWindowAction, formDePublicar())
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('Falha ao conferir os bloqueios da professora')
  })

  it('a consulta pergunta pelo bloqueio DAQUELE instante, daquela professora', async () => {
    mock.respostas.teacher_availability_exceptions = { data: [] }
    mock.chamadas = {}
    await rodar(acoesReais.publishWindowAction, formDePublicar())
    const chamadas = mock.chamadas.teacher_availability_exceptions
    expect(chamadas).toBeDefined()
    const pares = Object.fromEntries(
      chamadas.filter(([m]) => m === 'eq' || m === 'lte' || m === 'gt').map(([, k, v]) => [k, v]),
    )
    expect(pares.teacher_id).toBe(PROFESSORA)
    expect(pares.kind).toBe('block')
    // o instante do slot em Cuiabá — o mesmo que a RPC vai calcular
    expect(pares.starts_at_utc).toBe('2026-08-04T18:00:00.000Z')
    expect(pares.ends_at_utc).toBe('2026-08-04T18:00:00.000Z')
  })

  it('a OUTRA porta que publica (remarcar para horário novo) tem o mesmo porteiro', async () => {
    mock.respostas.teacher_availability_exceptions = { data: [{ note: null }] }
    const fd = new FormData()
    fd.set('instance_id', 'aula-1')
    fd.set('teacher_id', PROFESSORA)
    fd.set('local_date', '2026-08-04')
    fd.set('local_time', '14:00')
    fd.set('back', '/admin/agenda')
    mock.rpcs = []
    await rodar(acoesReais.adminRescheduleNewTimeAction, fd)
    expect(mock.rpcs, 'a janela temporária nasceu dentro do bloqueio').toHaveLength(0)
    expect(frase()).toContain('dentro de um bloqueio da professora')
  })
})

/* ========================================================================== */
/* 14b. BLOQUEADOR 1 — A AULA NÃO NASCE MAIS EM CIMA DO BLOQUEIO              */
/* ========================================================================== */

/**
 * Revisão independente do A4 (29/07). As DUAS RPCs de criação inseriam sem
 * consultar `teacher_availability_exceptions`: a proteção da grade era só
 * VISUAL e os campos de data/hora são editáveis de propósito. Cenário do
 * revisor: a dona bloqueia 04/08 inteiro; a dona abre um link salvo
 * `?novo=avulsa&nd=2026-08-04&nt=14:00` (ou toca outro slot e edita a data),
 * escolhe o aluno e confirma — e o banco grava `starts_at_utc` DENTRO do
 * bloqueio.
 *
 * A trava é a MESMA do porteiro da publicação, agora nas três portas, e cobre o
 * INTERVALO da aula: 60 min começando 10 min antes do bloqueio o invadem.
 * (A trava do BANCO segue roteada ao A6, com as outras.)
 */
describe('A4 · bloqueador 1 — criar aula dentro de um bloqueio é recusado', () => {
  /** O bloqueio de 04/08 inteiro, em Cuiabá: 04/08 04:00Z → 05/08 04:00Z. */
  const BLOQUEIO_DO_DIA = {
    data: [
      {
        note: 'consulta médica da dona',
        local_snapshot: `2026-08-04 → 2026-08-04 ${CUIABA}`,
        starts_at_utc: '2026-08-04T04:00:00.000Z',
        ends_at_utc: '2026-08-05T04:00:00.000Z',
      },
    ],
  }

  function formDaAvulsa(over: Record<string, string> = {}) {
    const fd = new FormData()
    fd.set('contract_id', 'c-0')
    fd.set('kind', 'courtesy')
    fd.set('local_date', '2026-08-04')
    fd.set('local_time', '14:00')
    fd.set('duration_min', '45')
    fd.set('back', '/admin/agenda')
    for (const [k, v] of Object.entries(over)) fd.set(k, v)
    return fd
  }

  function formDaExperimental(over: Record<string, string> = {}) {
    const fd = new FormData()
    fd.set('student_name', 'Maria Silva')
    fd.set('iana_tz', CUIABA)
    fd.set('teacher_id', PROFESSORA)
    fd.set('local_date', '2026-08-04')
    fd.set('local_time', '14:00')
    fd.set('duration_min', '45')
    fd.set('back', '/admin/agenda')
    for (const [k, v] of Object.entries(over)) fd.set(k, v)
    return fd
  }

  /** O contrato como a action o lê: professora + fuso (sem slot vigente). */
  function contratoDe(tz = CUIABA, teacher: string | null = PROFESSORA) {
    mock.respostas.contracts = {
      data: { teacher_id: teacher, students: { iana_tz: tz }, recurring_slots: [] },
    }
  }

  it('AVULSA dentro do bloqueio: nada é criado, e a professora é a DO CONTRATO', async () => {
    contratoDe()
    mock.respostas.teacher_availability_exceptions = BLOQUEIO_DO_DIA
    mock.chamadas = {}
    mock.rpcs = []
    const url = await rodar(acoesReais.createSingleClassAction, formDaAvulsa())
    expect(mock.rpcs, 'a aula nasceu EM CIMA do bloqueio').toHaveLength(0)
    expect(frase()).toContain('dentro de um bloqueio da professora')
    expect(frase()).toContain('Nada foi criado')
    expect(url, 'a nota privada do bloqueio vazou para a URL').not.toContain('consulta médica')
    expect(frase(), 'a nota privada do bloqueio entrou na frase').not.toContain('consulta médica')
    // a agenda consultada é a da professora do CONTRATO (a RPC tira dali também)
    const pares = Object.fromEntries(
      mock.chamadas.teacher_availability_exceptions
        .filter(([m]) => m === 'eq')
        .map(([, k, v]) => [k, v]),
    )
    expect(pares.teacher_id).toBe(PROFESSORA)
    expect(pares.kind).toBe('block')
  })

  it('EXPERIMENTAL dentro do bloqueio: nada é criado (o mesmo buraco, na porta ao lado)', async () => {
    mock.respostas.teacher_availability_exceptions = BLOQUEIO_DO_DIA
    mock.rpcs = []
    const url = await rodar(acoesReais.createTrialClassAction, formDaExperimental())
    expect(mock.rpcs, 'a experimental nasceu EM CIMA do bloqueio').toHaveLength(0)
    expect(frase()).toContain('dentro de um bloqueio da professora')
    expect(url).not.toContain('consulta médica')
    expect(frase()).not.toContain('consulta médica')
  })

  it('a aula que ATRAVESSA a borda do bloqueio também é recusada', async () => {
    // Bloqueio começa 05/08 04:00Z (= 05/08 00:00 em Cuiabá). A aula das
    // 23:30 de 04/08 em Cuiabá começa 05/08 03:30Z e, com 60 min, termina
    // 05/08 04:30Z — meia hora DENTRO. O instante de início está livre.
    contratoDe()
    mock.respostas.teacher_availability_exceptions = {
      data: [
        {
          local_snapshot: `2026-08-05 → 2026-08-05 ${CUIABA}`,
          starts_at_utc: '2026-08-05T04:00:00.000Z',
          ends_at_utc: '2026-08-06T04:00:00.000Z',
        },
      ],
    }
    mock.chamadas = {}
    mock.rpcs = []
    const url = await rodar(
      acoesReais.createSingleClassAction,
      formDaAvulsa({ local_time: '23:30', duration_min: '60' }),
    )
    expect(mock.rpcs, 'a aula de 60 min invadiu o bloqueio pela borda').toHaveLength(0)
    expect(url, 'a frase voltou para a barra de endereços').not.toContain('msg=')
    expect(frase()).toContain('dentro de um bloqueio da professora')
    // e a pergunta ao banco foi de SOBREPOSIÇÃO, não de instante
    const filtros = mock.chamadas.teacher_availability_exceptions.filter(
      ([m]) => m === 'lt' || m === 'gt',
    )
    expect(Object.fromEntries(filtros.map(([, k, v]) => [k, v]))).toEqual({
      starts_at_utc: '2026-08-05T04:30:00.000Z', // fim da aula
      ends_at_utc: '2026-08-05T03:30:00.000Z', // início da aula
    })
  })

  it('PROVA DE MUTAÇÃO: fora do bloqueio, as duas criações continuam acontecendo', async () => {
    contratoDe()
    mock.respostas.teacher_availability_exceptions = { data: [] }
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, formDaAvulsa())
    expect(mock.rpcs.map(([n]) => n)).toContain('admin_create_single_class')
    mock.rpcs = []
    await rodar(acoesReais.createTrialClassAction, formDaExperimental())
    expect(mock.rpcs.map(([n]) => n)).toContain('admin_create_trial_class')
  })

  it('PROVA DE MUTAÇÃO (borda): a aula de 45 min que ENCOSTA no bloqueio passa', async () => {
    // 23:00–23:45 em Cuiabá termina 05/08 03:45Z, antes do bloqueio das 04:00Z.
    contratoDe()
    mock.respostas.teacher_availability_exceptions = {
      data: [],
    }
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, formDaAvulsa({ local_time: '23:00' }))
    expect(mock.rpcs.map(([n]) => n)).toContain('admin_create_single_class')
  })

  it('FAIL-CLOSED: leitura dos bloqueios que falha recusa as DUAS criações', async () => {
    contratoDe()
    mock.respostas.teacher_availability_exceptions = { data: null, error: { message: 'timeout' } }
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, formDaAvulsa())
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('Falha ao conferir os bloqueios da professora')
    expect(frase()).toContain('nada foi criado')
    mock.rpcs = []
    await rodar(acoesReais.createTrialClassAction, formDaExperimental())
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('Falha ao conferir os bloqueios da professora')
  })

  it('VARREDOR do grave 2: nenhuma das quatro portas põe a NOTA na URL', async () => {
    const SEGREDO = 'tratamento psiquiátrico da aluna'
    const comSegredo = {
      data: [
        {
          note: SEGREDO,
          local_snapshot: `2026-08-04 → 2026-08-04 ${CUIABA}`,
          starts_at_utc: '2026-08-04T04:00:00.000Z',
          ends_at_utc: '2026-08-05T04:00:00.000Z',
        },
      ],
    }
    const remarcar = new FormData()
    remarcar.set('instance_id', 'aula-1')
    remarcar.set('teacher_id', PROFESSORA)
    remarcar.set('local_date', '2026-08-04')
    remarcar.set('local_time', '14:00')
    remarcar.set('back', '/admin/agenda')
    const portas: Array<[string, (fd: FormData) => Promise<void>, FormData]> = [
      ['publicar horário', acoesReais.publishWindowAction, (() => {
        const fd = new FormData()
        fd.set('teacher_id', PROFESSORA)
        fd.set('local_date', '2026-08-04')
        fd.set('local_time', '14:00')
        fd.set('back', '/admin/agenda')
        return fd
      })()],
      ['remarcar para horário novo', acoesReais.adminRescheduleNewTimeAction, remarcar],
      ['aula avulsa', acoesReais.createSingleClassAction, formDaAvulsa()],
      ['aula experimental', acoesReais.createTrialClassAction, formDaExperimental()],
    ]
    for (const [nome, acao, fd] of portas) {
      contratoDe()
      mock.respostas.teacher_availability_exceptions = comSegredo
      const url = await rodar(acao, fd)
      expect(frase(), `${nome}: recusou sem dizer que foi o bloqueio`).toContain(
        'dentro de um bloqueio da professora',
      )
      expect(url, `${nome}: publicou a nota privada do bloqueio na URL`).not.toContain(
        'psiquiátrico',
      )
      // …e a frase também não a carrega: o cookie é `httpOnly`, mas o texto
      // chega à TELA, e a nota é a vida de alguém (grave 2).
      expect(frase(), `${nome}: publicou a nota privada do bloqueio na frase`).not.toContain(
        'psiquiátrico',
      )
    }
  })
})

/* ========================================================================== */
/* 14c. GRAVE 1 — DURAÇÃO ZERO NÃO VIRA 45 MINUTOS EM SILÊNCIO                */
/* ========================================================================== */

/**
 * Revisão independente do A4. O campo não tinha `required`/`min` e as duas
 * actions faziam `Number(x) || 45`: a dona digitava 0 (ou apagava para
 * corrigir), a tela enviava zero sem reclamar e o banco gravava uma aula de 45
 * MINUTOS — que depois conta 45 minutos no extrato da professora. Piso e teto
 * são os que o banco já impõe ao horário fixo (`recurring_slots_duration_sane`,
 * 15..480).
 */
describe('A4 · grave 1 (revisão independente) — a duração é conferida, não adivinhada', () => {
  function form(duracao: string | null) {
    const fd = new FormData()
    fd.set('contract_id', 'c-0')
    fd.set('kind', 'courtesy')
    fd.set('local_date', '2026-08-05')
    fd.set('local_time', '14:00')
    fd.set('back', '/admin/agenda')
    if (duracao !== null) fd.set('duration_min', duracao)
    return fd
  }

  beforeEach(() => {
    mock.respostas.contracts = {
      data: { teacher_id: PROFESSORA, students: { iana_tz: CUIABA }, recurring_slots: [] },
    }
    mock.respostas.teacher_availability_exceptions = { data: [] }
  })

  for (const [rotulo, valor] of [
    ['zero', '0'],
    ['vazio', ''],
    ['ausente', null],
    ['fracionária', '45.5'],
    ['abaixo do piso', '14'],
    ['acima do teto', '481'],
    ['texto', 'quarenta'],
  ] as Array<[string, string | null]>) {
    it(`duração ${rotulo} é RECUSADA nas duas portas — nada é criado`, async () => {
      mock.rpcs = []
      const url = await rodar(acoesReais.createSingleClassAction, form(valor))
      expect(mock.rpcs, `duração ${rotulo} chegou ao banco`).toHaveLength(0)
      expect(url, 'a frase voltou para a barra de endereços').not.toContain('msg=')
      expect(tomDoAviso(frase())).toBe('erro')
      expect(frase()).toContain('duração da aula precisa ser um número inteiro')
      expect(frase()).toContain('Nada foi criado')

      const trial = form(valor)
      trial.set('student_name', 'Maria Silva')
      trial.set('iana_tz', CUIABA)
      trial.set('teacher_id', PROFESSORA)
      mock.rpcs = []
      await rodar(acoesReais.createTrialClassAction, trial)
      expect(mock.rpcs, `duração ${rotulo} chegou ao banco (experimental)`).toHaveLength(0)
    })
  }

  it('PROVA DE MUTAÇÃO: 60 passa, e é 60 que chega ao banco (não 45)', async () => {
    mock.rpcs = []
    await rodar(acoesReais.createSingleClassAction, form('60'))
    const args = mock.rpcs.find(([n]) => n === 'admin_create_single_class')![1] as Record<
      string,
      unknown
    >
    expect(args.p_duration_min).toBe(60)
    // e os extremos válidos continuam válidos
    for (const bom of ['15', '480']) {
      mock.rpcs = []
      await rodar(acoesReais.createSingleClassAction, form(bom))
      expect(mock.rpcs.map(([n]) => n), bom).toContain('admin_create_single_class')
    }
  })

  it('a TELA antecipa: o campo é obrigatório e tem piso e teto', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    const campo = c.querySelector<HTMLInputElement>('input[name="duration_min"]')!
    expect(campo.required, 'campo de duração sem required volta a aceitar vazio').toBe(true)
    expect(campo.min).toBe('15')
    expect(campo.max).toBe('480')
    // a experimental compartilha a MESMA peça (balão novo: o de cima já está
    // com a avulsa aberta)
    await desmontar()
    const c2 = await balao({ professoraFiltrada: PROFESSORA })
    await escolher(c2, 'experimental')
    const daExperimental = c2.querySelector<HTMLInputElement>('input[name="duration_min"]')!
    expect(daExperimental.required).toBe(true)
    expect(daExperimental.min).toBe('15')
  })
})

/* ========================================================================== */
/* 14d. BLOQUEADOR 2 — O CAMPO RESETA PELO GESTO, NÃO PELO VALOR              */
/* ========================================================================== */

/**
 * Revisão independente do A4. `useCampoEspelhado` só mudava a prop
 * `defaultValue` quando o texto calculado MUDAVA — e `DateField`/`TimeField`
 * só ressincronizam o texto visível quando a prop muda. Quando a conversão
 * devolve os MESMOS algarismos do último valor empurrado, o campo (e o hidden)
 * ficam com o que a dona digitou à mão, enquanto o cabeçalho passa a afirmar o
 * valor convertido. O banco recebe o do campo.
 */
describe('A4 · bloqueador 2 — reempurrar o MESMO valor reseta o campo', () => {
  it('edita a hora à mão → escolhe contrato de equivalente IGUAL → campo, hidden e cabeçalho concordam', async () => {
    // 04/08/2026 14:00 em Cuiabá (UTC−4) = 18:00Z. Nova York nesse dia está em
    // EDT (UTC−4): o equivalente é 14:00 — os MESMOS algarismos do slot.
    const c = await balao()
    await escolher(c, 'avulsa')
    const hora = [...c.querySelectorAll<HTMLInputElement>('input[type="text"]')].at(-1)!
    await digitar(hora, '1500')
    expect(c.querySelector<HTMLInputElement>('input[name="local_time"]')!.value).toBe('15:00')

    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-ny')

    expect(
      c.querySelector<HTMLInputElement>('input[name="local_time"]')!.value,
      'o hidden ficou com a hora digitada à mão e o banco receberia 15:00',
    ).toBe('14:00')
    expect(textosVisiveis(c), 'o campo visível continuou mostrando 15:00').toContain('14:00')
    expect(textosVisiveis(c)).not.toContain('15:00')
    // …e o cabeçalho do balão afirma exatamente o que está no campo
    expect(c.textContent).toContain('Nos campos:')
    expect(c.textContent).toContain('às 14:00 — hora de Nova York')
  })

  it('vale também para a DATA (o mesmo dia civil, empurrado de novo)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    const data = c.querySelector<HTMLInputElement>('input[type="text"]')!
    await digitar(data, '05082026')
    expect(c.querySelector<HTMLInputElement>('input[name="local_date"]')!.value).toBe('2026-08-05')

    // Nova York devolve o MESMO dia civil do slot (04/08) — a prop não muda.
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-ny')
    expect(
      c.querySelector<HTMLInputElement>('input[name="local_date"]')!.value,
      'a data digitada à mão sobreviveu à troca de contrato',
    ).toBe('2026-08-04')
  })

  it('PROVA DE MUTAÇÃO: quando o valor MUDA, o reset continua funcionando', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    // São Paulo (UTC−3) devolve 15:00 para o slot das 14:00 de Cuiabá
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    expect(c.querySelector<HTMLInputElement>('input[name="local_time"]')!.value).toBe('15:00')
    // …e voltar para um contrato de Cuiabá devolve 14:00
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-0')
    expect(c.querySelector<HTMLInputElement>('input[name="local_time"]')!.value).toBe('14:00')
  })

  it('o que o formulário ENVIA é o valor reempurrado, não o digitado antes', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    const hora = [...c.querySelectorAll<HTMLInputElement>('input[type="text"]')].at(-1)!
    await digitar(hora, '1500')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-ny')
    const fd = await enviar(c)
    expect(fd.get('local_time')).toBe('14:00')
    expect(fd.get('local_date')).toBe('2026-08-04')
  })
})

/* ========================================================================== */
/* 14e. MÉDIO 1 — O RASCUNHO DO PAINEL É DAQUELE ALVO                         */
/* ========================================================================== */

describe('A4 · médio 1 (revisão independente) — rascunho de painel não atravessa alvos', () => {
  it('a chave do painel inclui o alvo do link (`nd`/`nt`)', () => {
    expect(chaveDoPainel('experimental')).toBe('painel:experimental')
    expect(chaveDoPainel('experimental', '2026-08-04T14:00')).toBe(
      'painel:experimental@2026-08-04T14:00',
    )
    expect(chaveDoPainel('experimental', '2026-08-05T15:00')).not.toBe(
      chaveDoPainel('experimental', '2026-08-04T14:00'),
    )
  })

  it('rascunho de 04/08 14:00 NÃO preenche o painel aberto para 05/08 15:00', async () => {
    const { gravarRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    await gravarRascunho(chaveDoPainel('experimental', '2026-08-04T14:00'), {
      student_name: 'Maria Silva',
      local_date: '2026-08-04',
      local_time: '14:00',
      teacher_id: OUTRA,
    })
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ novo: 'experimental', nd: '2026-08-05', nt: '15:00' }),
    })
    const peca = [...percorrer(arvore)].find((el) => el.type === CamposDaExperimental)!
    expect(
      peca.props.digitado,
      'o painel nasceu com o nome e o horário da tentativa anterior por cima do link novo',
    ).toEqual({})
    expect(peca.props.dataInicial).toBe('2026-08-05')
    expect(peca.props.horaInicial).toBe('15:00')
  })

  it('PROVA DE MUTAÇÃO: no MESMO alvo o rascunho continua voltando', async () => {
    const { gravarRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    await gravarRascunho(chaveDoPainel('experimental', '2026-08-04T14:00'), {
      student_name: 'Maria Silva',
    })
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ novo: 'experimental', nd: '2026-08-04', nt: '14:00' }),
    })
    const peca = [...percorrer(arvore)].find((el) => el.type === CamposDaExperimental)!
    expect(peca.props.digitado).toEqual({ student_name: 'Maria Silva' })
  })

  it('a volta de ERRO leva o alvo junto — senão o painel voltaria vazio', async () => {
    const arvore: unknown = await AgendaPage({
      searchParams: Promise.resolve({ novo: 'avulsa', nd: '2026-08-04', nt: '14:00' }),
    })
    const els = [...percorrer(arvore)]
    const form = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.type === CamposDaAvulsa),
    )!
    const dentro = [...percorrer(form)]
    const backErro = String(dentro.find((el) => el.props.name === 'back_erro')!.props.value)
    expect(backErro).toContain('nd=2026-08-04')
    expect(backErro).toContain(`nt=${encodeURIComponent('14:00')}`)
    // A7 — A CHAVE DEIXOU DE SER DECLARADA E PASSOU A SER DERIVADA, e o defeito
    // que ela conserta ficou IMPOSSÍVEL em vez de vigiado: antes o `rascunho` e o
    // `back_erro` eram duas strings montadas em lugares diferentes, e este teste
    // existia para flagrar a divergência. Agora a chave é FUNÇÃO do `back_erro`,
    // que é o mesmo endereço para onde a dona volta.
    expect(dentro.find((el) => el.props.name === 'rascunho'), 'a chave voltou a viajar do cliente').toBeUndefined()
    expect(dentro.find((el) => el.props.name === 'manter'), 'a lista voltou a viajar do cliente').toBeUndefined()
    const chave = chaveDoDestino(
      { tela: 'casa' },
      geometriaCanonica({ tela: 'casa' }, true, lerDaQuery(backErro)),
    )
    expect(chave).toBe(chaveDoPainel('avulsa', '2026-08-04T14:00'))
  })
})

/* ========================================================================== */
/* 15. GRAVE 5 — AS PROPOSIÇÕES SÃO PROVADAS COMO REGRA, NÃO COMO TOKEN       */
/* ========================================================================== */

describe('A6/b — "cortesia é gratuita" voltou a ser invariante do BANCO', () => {
  it('a action NEM MANDA preço na cortesia, e o banco recusaria se mandasse', async () => {
    // ── A INVERSÃO ANUNCIADA. O teste antigo pinava o oposto ("o banco aceita e
    // persiste preço na cortesia: quem impede é o formulário") e pedia a própria
    // reescrita: "se o banco passar a recusar preço na cortesia (A6), reescreva
    // a frase — ela ficou pessimista". Passou a recusar. ─────────────────────
    //
    // A prova de REGRA, não de token: com um envio FORJADO que leva
    // `kind=courtesy` E `price` (o formulário desmonta o campo, mas o endpoint é
    // público), o preço não chega à RPC.
    const fd = new FormData()
    fd.set('contract_id', 'c-0')
    fd.set('kind', 'courtesy')
    fd.set('price', '150')
    fd.set('local_date', '2026-08-05')
    fd.set('local_time', '14:00')
    fd.set('duration_min', '45')
    fd.set('back', '/admin/agenda')
    mock.rpcs = []
    mock.respostas.contracts = {
      data: { students: { iana_tz: 'America/Cuiaba' }, recurring_slots: [] },
    }
    await rodar(acoesReais.createSingleClassAction, fd)
    const args = mock.rpcs.find(([n]) => n === 'admin_create_single_class')![1] as Record<
      string,
      unknown
    >
    expect(args.p_kind).toBe('courtesy')
    expect(args.p_price_cents).toBeNull()

    // …e as DUAS travas do banco existem: a guarda da EXTRA (valor ausente) e a
    // da CORTESIA (valor presente).
    const fn = corpoDaFuncao('admin_create_single_class')
    expect(fn).toContain("if p_kind = 'extra_paid' and (p_price_cents is null or p_price_cents <= 0)")
    expect(/courtesy'\s+and\s+p_price_cents/i.test(fn)).toBe(true)
    // …mais o CHECK, que vale para QUALQUER porta (SQL manual, service_role)
    const sql98 = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260730000100_a6_travas_de_agenda.sql'),
      'utf8',
    )
    expect(sql98).toContain('class_instances_courtesy_sem_preco')
    expect(sql98).toContain("single_kind is distinct from 'courtesy' or single_price_cents is null")
  })

  it('a FRASE volta a prometer a gratuidade, porque agora o banco a sustenta', () => {
    expect(CONSEQUENCIA.avulsa).toContain('Extra cobrada exige valor')
    expect(CONSEQUENCIA.avulsa).toContain('esta tela não oferece campo de valor')
    expect(CONSEQUENCIA.avulsa).toContain('o banco recusa cortesia com valor')
    // a ressalva que existia porque o banco não sustentava não pode ficar de pé
    expect(CONSEQUENCIA.avulsa).not.toContain('quem garante isso é a tela')
  })

  it('…e a trava de tela continua real: o campo é DESMONTADO (não escondido)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLInputElement>('input[name="price"]')!, '150')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="kind"]')!, 'courtesy')
    expect(c.querySelector('input[name="price"]')).toBeNull()
  })
})

describe('A4 · grave 5b — o horário aberto tem DUAS portas, e a frase cobre as duas', () => {
  /** O ramo do RESGATE (`p_contract`) da definição efetiva. */
  function ramoDoResgate(): string {
    const fn = corpoDaFuncao('book_reschedule_window')
    const inicio = fn.indexOf('v_new_id := public.reschedule_class_at(')
    expect(inicio, 'a função mudou de forma — refaça o recorte').toBeGreaterThan(0)
    const fim = fn.indexOf('select starts_at_utc into v_new_starts', inicio)
    return fn.slice(inicio, fim)
  }

  it('o resgate por contrato chama `spend_makeup` SEMPRE — franquia nenhuma no caminho', () => {
    const resgate = ramoDoResgate()
    expect(resgate).toContain('perform public.spend_makeup(')
    expect(
      resgate,
      'o resgate passou a olhar a franquia: reescreva a frase, ela ficou desatualizada',
    ).not.toContain('monthly_reschedule_allowance')
    // …enquanto a remarcação de uma instância faz o contrário: franquia primeiro
    const remarcar = corpoDaFuncao('reschedule_class_at')
    const antesDoCredito = remarcar.slice(0, remarcar.indexOf('perform public.spend_makeup('))
    expect(antesDoCredito).toContain('monthly_reschedule_allowance')
  })

  it('a frase descreve os DOIS custos, com o nome de cada caminho', () => {
    expect(CONSEQUENCIA.horario).toContain('REMARCANDO')
    expect(CONSEQUENCIA.horario).toContain('franquia do mês')
    expect(CONSEQUENCIA.horario).toContain('RESGATANDO')
    expect(CONSEQUENCIA.horario).toContain('sempre um crédito')
    expect(CONSEQUENCIA.horario).toContain('até 2 semanas à frente')
  })
})

/**
 * A CONFERÊNCIA REFEITA, proposição a proposição, com o helper corrigido.
 *
 * O relatório da rodada 1 afirmou que só a proposição do bloqueio estava errada.
 * Não procede: a da CORTESIA e a do CUSTO DO HORÁRIO ABERTO também estavam —
 * a primeira prometia invariante de banco que não existe, a segunda descrevia
 * metade dos caminhos. Cada linha abaixo prova a REGRA (comportamento da função
 * efetiva), não a presença de um token na frase.
 */
describe('A4 · as proposições das quatro frases, uma a uma', () => {
  const proposicoes: ReadonlyArray<readonly [string, () => void]> = [
    [
      'P1 avulsa: é aula fora do horário fixo (nasce sem slot recorrente)',
      () => expect(corpoDaFuncao('admin_create_single_class')).toContain('(contract_id, teacher_id, slot_id, occurrence_date'),
    ],
    [
      'P2 avulsa: não gasta crédito nem franquia',
      () => {
        const fn = corpoDaFuncao('admin_create_single_class')
        expect(fn).not.toContain('spend_makeup')
        expect(fn).not.toContain('reschedule_usage')
      },
    ],
    [
      'P3 avulsa: a hora conta no extrato da professora',
      () => expect(corpoDaFuncao('_teacher_payable_hours')).toContain('from class_instances i'),
    ],
    [
      'P4 avulsa: extra cobrada exige valor',
      () => expect(corpoDaFuncao('admin_create_single_class')).toContain('aula extra cobrada exige valor'),
    ],
    [
      'P5 avulsa: cortesia sem cobrança é invariante do BANCO — INVERTIDA no A6/b',
      () =>
        expect(
          /courtesy'\s+and\s+p_price_cents/i.test(corpoDaFuncao('admin_create_single_class')),
        ).toBe(true),
    ],
    [
      'P6 avulsa: o SNAPSHOT no fuso do ALUNO (slot vigente → cadastro) — A6/a',
      () => {
        const fn = corpoDaFuncao('admin_create_single_class')
        expect(fn).toContain('select rs.iana_tz into v_tz')
        expect(fn).toContain('select s.iana_tz into v_tz from students s')
        // o instante chega decidido; a zona serve ao snapshot (Lei 1)
        expect(fn).toContain('v_local := v_starts at time zone v_tz')
        expect(fn).toContain("to_char(v_local, 'YYYY-MM-DD HH24:MI')")
        expect(fn).not.toContain('p_local_date')
      },
    ],
    [
      'P7 experimental: pessoa + contrato leve + aula num ato só',
      () => {
        const fn = corpoDaFuncao('admin_create_trial_class')
        expect(fn).toContain('insert into students')
        expect(fn).toContain('insert into contracts')
        expect(fn).toContain('is_trial')
      },
    ],
    [
      'P8 experimental: sem horário fixo e sem semanas geradas',
      () => expect(corpoDaFuncao('admin_create_trial_class')).not.toContain('insert into recurring_slots'),
    ],
    [
      'P9 experimental: o fuso da pessoa nasce "a confirmar"',
      () => expect(corpoDaFuncao('admin_create_trial_class')).toContain('tz_confirmed'),
    ],
    [
      'P10 experimental: valor em branco = gratuita',
      () => {
        // a action manda `null` quando o campo volta vazio…
        expect(CONSEQUENCIA.experimental).toContain('valor em branco = aula gratuita')
        // …e a função trata `null` como zero no contrato leve
        expect(corpoDaFuncao('admin_create_trial_class')).toContain('coalesce(p_price_cents, 0)')
      },
    ],
    [
      'P11 horário: a janela é da professora, e só os alunos dela a consomem',
      () => {
        const fn = corpoDaFuncao('book_reschedule_window')
        expect(fn).toContain('janela % pertence a outra professora')
        expect(fn).toContain('my_contract_ids()')
      },
    ],
    [
      'P12 horário: reservável só até 2 semanas à frente',
      () => expect(corpoDaFuncao('book_reschedule_window')).toContain("interval '14 days'"),
    ],
    [
      'P13 horário (remarcando): franquia do mês e, esgotada, um crédito',
      () => {
        const fn = corpoDaFuncao('reschedule_class_at')
        expect(fn).toContain('monthly_reschedule_allowance')
        expect(fn).toContain('spend_makeup')
      },
    ],
    [
      'P14 horário (resgatando): sempre um crédito — CORRIGIDA nesta rodada',
      () => expect(corpoDaFuncao('book_reschedule_window')).toContain(
        "perform public.spend_makeup(v_contract.id, 'spend_reschedule'",
      ),
    ],
    [
      'P15 horário: o horário sai da oferta',
      () => expect(corpoDaFuncao('book_reschedule_window')).toContain("state = 'consumida'"),
    ],
    [
      'P16 bloqueio: dia civil INTEIRO, no fuso da professora',
      () => {
        const fn = corpoDaFuncao('add_teacher_block')
        expect(fn).toContain("(p_from + time '00:00') at time zone v_tz")
        expect(fn).toContain("((p_to + 1) + time '00:00') at time zone v_tz")
        expect(fn).toContain('coalesce(t.iana_tz, public.business_tz())')
      },
    ],
    [
      'P17 bloqueio: as aulas já marcadas não são tocadas',
      () => expect(corpoDaFuncao('add_teacher_block')).not.toContain('class_instances'),
    ],
    [
      'P18 bloqueio: janela JÁ publicada SAI da oferta — INVERTIDA no A6/f+e',
      () => {
        const bloqueio = corpoDaFuncao('add_teacher_block')
        expect(bloqueio).toContain('reschedule_windows')
        expect(bloqueio).toContain("set state = 'cancelada'")
        // e a reserva recusa o bloqueio criado depois da publicação
        expect(corpoDaFuncao('book_reschedule_window')).toContain("e.kind = 'block'")
      },
    ],
  ]

  for (const [nome, prova] of proposicoes) it(nome, prova)

  it('a conferência cobre as QUATRO frases inteiras (nenhuma proposição órfã)', () => {
    expect(proposicoes).toHaveLength(18)
  })
})

/* ========================================================================== */
/* 16. GRAVE 6 — O TRANSPORTE ESCOLHIDO CAMPO A CAMPO                         */
/* ========================================================================== */

describe('A4/grave 6 · A7 — quem escolhe o transporte de cada campo é o SERVIDOR', () => {
  // ── A INVERSÃO ANUNCIADA ────────────────────────────────────────────────────
  // O teste antigo pinava o mecanismo do A4: o FORMULÁRIO declarava `manter`
  // (tudo o que sobrevive ao erro) e `na_url` (o subconjunto que pode ficar
  // visível), e a action obedecia. Isso resolvia o vazamento do `motivo`, mas
  // deixava a decisão em dado de cliente — e o bloqueador do A5 mostrou o preço:
  // `manter=msg&na_url=msg` reinseria a ponte legada na query, e um `back_erro`
  // com campo pendurado voltava intacto.
  //
  // No A7 os três campos deixaram de existir. A garantia é a mesma, e mais forte:
  // o que fica visível é a allowlist de geometria da tela `remarcar`
  // (`cortesia`, `furar`, `escolha` — nenhum é dado de pessoa), e o que é
  // guardado é `CAMPOS_DA_PORTA`. Envio forjado não muda nem um nem outro.

  it('booleano fica na URL; texto livre vai para o cookie', async () => {
    const fd = new FormData()
    fd.set('cortesia', '1')
    fd.set('furar', '1')
    fd.set('motivo', 'cirurgia da dona')
    fd.set('local_date', '2026-08-05')
    fd.set('instance_id', 'aula-1')
    fd.set('window_id', 'w-1')
    mock.respostaRpc = { data: null, error: { message: 'no_overlap' } }
    const url = await rodar(acoesReais.adminBookWindowAction, fd)

    expect(url.split('?')[0]).toBe('/admin/agenda/remarcar/aula-1')
    const q = new URLSearchParams(url.split('?')[1])
    expect([...q.keys()].sort()).toEqual(['cortesia', 'furar'])
    expect(url).not.toContain('cirurgia')
    expect(frase()).toContain('conflita com outra aula da professora')
    const guardado = rascunhoNoPote()!
    expect(guardado.chave).toBe(chaveDoRemarcar('aula-1'))
    expect(guardado.campos.motivo).toBe('cirurgia da dona')
    expect(guardado.campos.cortesia, 'o booleano foi duplicado no cookie').toBeUndefined()
  })

  it('BLOQUEADOR: `manter`/`na_url`/`rascunho` forjados não mudam nada', async () => {
    // A prova de que o mecanismo velho morreu de verdade: um envio que tenta
    // reinserir a ponte legada e publicar o motivo na barra de endereços.
    const fd = new FormData()
    fd.set('manter', 'msg,motivo,cortesia')
    fd.set('na_url', 'msg,motivo')
    fd.set('rascunho', 'painel:avulsa')
    fd.set('msg', 'texto forjado')
    fd.set('cortesia', '1')
    fd.set('motivo', 'cirurgia da dona')
    fd.set('instance_id', 'aula-1')
    fd.set('window_id', 'w-1')
    mock.respostaRpc = { data: null, error: { message: 'no_overlap' } }
    const url = await rodar(acoesReais.adminBookWindowAction, fd)

    expect([...new URLSearchParams(url.split('?')[1]).keys()].sort()).toEqual(['cortesia'])
    expect(url).not.toContain('texto forjado')
    expect(url).not.toContain('cirurgia')
    // …e o rascunho ficou sob a identidade DAQUELA aula, não sob a que o envio
    // pediu: chave derivada no servidor, não lida do formulário.
    expect(rascunhoNoPote()!.chave).toBe(chaveDoRemarcar('aula-1'))
  })

  it('o horário NOVO guarda também data e hora — a outra porta, a outra lista', async () => {
    const fd = new FormData()
    fd.set('instance_id', 'aula-1')
    fd.set('teacher_id', PROFESSORA)
    fd.set('local_date', '2026-08-05')
    fd.set('local_time', '10:30')
    fd.set('motivo', 'x y z')
    mock.respostaRpc = { data: null, error: { message: 'no_overlap' } }
    const url = await rodar(acoesReais.adminRescheduleNewTimeAction, fd)
    expect(url).not.toContain('10:30')
    const guardado = rascunhoNoPote()!
    expect(guardado.chave).toBe(chaveDoRemarcar('aula-1'))
    expect(guardado.campos).toMatchObject({ local_date: '2026-08-05', local_time: '10:30', motivo: 'x y z' })
  })

  it('cortesia LIGADA e motivo vazio é recusada antes de tocar o banco', async () => {
    const fd = new FormData()
    fd.set('instance_id', 'aula-1')
    fd.set('window_id', 'w-1')
    fd.set('cortesia', '1')
    mock.rpcs = []
    await rodar(acoesReais.adminBookWindowAction, fd)
    expect(mock.rpcs).toHaveLength(0)
    expect(frase()).toContain('a cortesia exige o motivo')
  })
})

/* ========================================================================== */
/* 17. MÉDIOS 1, 2 e 3                                                         */
/* ========================================================================== */

describe('A4 · médio 1 — o cabeçalho mostra o que está NOS CAMPOS', () => {
  it('editar a hora muda o resumo do balão (antes ele repetia o valor calculado)', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    expect(c.textContent).toContain('Nos campos: 04/08/2026 às 15:00 — hora de São Paulo')

    // a dona corrige 15:00 para 16:00 no campo visível
    const visiveis = [...c.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    const campoDaHora = visiveis.find((i) => i.value === '15:00')!
    await digitar(campoDaHora, '1600')
    expect(
      c.textContent,
      'o cabeçalho continuou anunciando o horário que ela acabou de trocar',
    ).toContain('Nos campos: 04/08/2026 às 16:00 — hora de São Paulo')
    // …e é 16:00 que viaja
    expect(c.querySelector<HTMLInputElement>('input[name="local_time"]')!.value).toBe('16:00')
  })

  it('editar a DATA também aparece no resumo', async () => {
    const c = await balao()
    await escolher(c, 'avulsa')
    await digitar(c.querySelector<HTMLSelectElement>('select[name="contract_id"]')!, 'c-sp')
    const visiveis = [...c.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    const campoDaData = visiveis.find((i) => i.value === '04/08/2026')!
    await digitar(campoDaData, '05082026')
    expect(c.textContent).toContain('Nos campos: 05/08/2026 às 15:00 — hora de São Paulo')
  })
})

describe('A4 · médio 2 — o rascunho não atravessa o logout', () => {
  it('sair apaga o que a dona tinha digitado (máquina compartilhada)', async () => {
    const { gravarRascunho, lerRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    await gravarRascunho(chaveDoBalao('2026-08-04T14:00', 'bloqueio'), {
      note: 'cirurgia da dona',
    })
    expect(rascunhoNoPote()).not.toBeNull()

    const { POST } = await import('@/app/auth/signout/route')
    mock.saiu = false
    await POST()
    expect(mock.saiu, 'a rota nem chegou a encerrar a sessão').toBe(true)

    expect(
      rascunhoNoPote(),
      'o rascunho sobreviveu ao logout — o próximo login reencontraria o texto',
    ).toBeNull()
    expect(await lerRascunho(chaveDoBalao('2026-08-04T14:00', 'bloqueio'))).toEqual({})
    // apagado com o MESMO caminho da escrita (senão o navegador não casa o cookie)
    const apagou = pote.escritas.filter((e) => e.nome === RASCUNHO_COOKIE).at(-1)!
    expect(apagou.opcoes.maxAge).toBe(0)
    expect(apagou.opcoes.path).toBe('/admin')
  })
})

describe('A4 · médio 3 — o teto do cookie é medido em BYTES codificados', () => {
  it('texto acentuado longo: o que passava no teto era descartado pelo navegador', async () => {
    const { gravarRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    // 2.900 caracteres acentuados — abaixo do teto em CARACTERES, muito acima
    // dele depois do percent-encoding (cada "é" vira "%C3%A9": 6 bytes).
    const texto = 'é'.repeat(2_900)
    const corpo = JSON.stringify({ chave: 'periodo', campos: { note: texto } })
    expect(corpo.length, 'o contrafactual sumiu: reescreva o caso').toBeLessThan(3_000)
    expect(encodeURIComponent(corpo).length).toBeGreaterThan(17_000)

    await gravarRascunho('periodo', { note: texto })
    expect(
      rascunhoNoPote(),
      'o cookie gigante foi escrito: o navegador o descartaria e a dona perderia o texto em silêncio',
    ).toBeNull()
  })

  it('PROVA DE MUTAÇÃO: o mesmo texto dentro do teto REAL é guardado', async () => {
    const { gravarRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    const texto = 'é'.repeat(400) // ~2.400 bytes codificados
    await gravarRascunho('periodo', { note: texto })
    expect(rascunhoNoPote()!.campos.note).toBe(texto)
    expect(pote.tamanhoCodificado(RASCUNHO_COOKIE)).toBeLessThan(3_100)
    expect(pote.tamanhoCodificado(RASCUNHO_COOKIE)).toBeGreaterThan(2_400)
  })
})

/* ========================================================================== */
/* 18. MENOR 1 — a dívida dos Roots continua ABERTA, por escrito              */
/* ========================================================================== */

describe('A4 · menor 1 — o que não foi medido não é afirmado', () => {
  it('o comentário do arquivo não chama Root+Trigger de barato nem a dívida de fechada', () => {
    const fonte = readFileSync(
      join(process.cwd(), 'src/components/admin/agenda/IntencoesDoSlot.tsx'),
      'utf8',
    )
    const cabecalho = fonte.slice(0, fonte.indexOf("import {"))
    expect(cabecalho).toContain('dívida de PERFORMANCE dos Roots')
    expect(cabecalho).toContain('ABERTA')
    expect(cabecalho).toContain('NÃO** FOI MEDIDO')
    // a conclusão que a medição não sustentava
    expect(cabecalho).not.toContain('Root + Trigger são baratos e o gatilho')
  })
})
