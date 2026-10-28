// @vitest-environment jsdom
//
// ONDA DA AGENDA · A5/L5 — A PROVA DE DOM QUE ESTAVA FALTANDO.
//
// O L4 declarou, no goal, que `?ev=` não tinha prova em nível de DOM: nada
// garantia que a visão de SEMANA abre UM balão e não dois. Esse foi o defeito
// REAL do A4 (médio 3 do Sol) quando o mount cliente foi esquecido — a semana
// desenha DUAS grades (a de dia único do celular e a de 7 colunas do desktop) e
// `defaultOpen` abria as duas: o balão da grade escondida vira conteúdo órfão no
// portal, come o primeiro `Esc` e disputa o foco com o visível. O A5 reusa a
// MESMA peça (`BalaoDoSlot`) para o balão do evento, e reuso sem prova é aposta.
//
// O que este arquivo prova, na ordem do risco:
//   1. `?ev=<id>` abre EXATAMENTE UM balão na semana — no celular e no desktop —
//      e a troca de URL (Back/Forward) mexe num Root já montado;
//   2. `?ev=` de aula fora da visão (ou malformado) não abre nada e não estoura;
//   3. a página traduz `?ev=` em `eventoAberto` e NADA MAIS entra na URL: o
//      `back_erro` do balão carrega geometria + id opaco, sem nome de aluno, sem
//      nota de cortesia, sem hora de aviso e sem frase de recado;
//   4. NADA INVISÍVEL CONTINUA CLICÁVEL na região do balão de aula — a 4ª
//      aparição da família (blocked×dashed · .linha-ancora do iOS · blocked×ghost
//      · agora a camada de FUNDO por baixo da aula);
//   5. a barra de ícones: três alvos ≥ 24px, cada um com `aria-label` próprio, e
//      NENHUM ícone de excluir (não existe delete de aula em migration nenhuma);
//   6. `RODAPE_DO_POLEGAR` e `z-[45]` sobrevivem à largura própria do balão de
//      aula (`w-96`) — medidos no elemento RENDERIZADO, não na fonte;
//   7. a matriz na tela: o gate por situação, o aviso da hora só onde ele é
//      verdadeiro, o alerta de apontamento que NÃO esconde a opção, e o campo da
//      hora do aviso que é o que permite cancelar aula já começada.
//
// Padrão da casa (a3/a4): árvore REAL da página, DOM real do balão, cliente
// Supabase falso que grava as chamadas, pote de cookies dublê, relógio congelado.

import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { Calendario, type CalEvent } from '@/components/kit/calendario'
import { LARGURA_DO_BALAO_DE_AULA } from '@/components/kit/popover'
import { BalaoDaAula } from '@/components/admin/agenda/BalaoDaAula'
import { DesfechoDaAula } from '@/components/admin/agenda/DesfechoDaAula'
import {
  AVISO_DA_HORA,
  AVISO_NO_FUTURO,
  CAMPOS_DO_DESFECHO,
  CONSEQUENCIA,
  GRUPO_ENTREGA_POR_MEMBRO,
  REGISTRO_NAO_SE_DESFAZ,
  ROTULO,
  ROTULO_DO_CANAL,
  SEM_LOGIN_NAO_ENTREGA,
  SEM_WHATSAPP_NAO_ENTREGA,
} from '@/lib/admin/desfecho-da-aula'
import type { AulaDaAgenda } from '@/data/admin/agenda'
import type { SituacaoDaAula } from '@/data/admin/home'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ========================================================================== */
/* Mocks (padrão do a4)                                                        */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

class ConsultaFalsa {
  constructor(private readonly resposta: Resposta) {}
  private marca() {
    return this
  }
  select() { return this.marca() }
  eq() { return this.marca() }
  is() { return this.marca() }
  not() { return this.marca() }
  // A5/L5: a consulta do histórico virou ALLOWLIST de ação (`in`), em vez de
  // lista negra do trigger genérico (`not`) — o dublê acompanha.
  in() { return this.marca() }
  gt() { return this.marca() }
  gte() { return this.marca() }
  lt() { return this.marca() }
  lte() { return this.marca() }
  or() { return this.marca() }
  limit() { return this.marca() }
  order() { return this.marca() }
  single() { return this.marca() }
  maybeSingle() { return this.marca() }
  then<A, B>(ok: (v: { data: unknown; error: unknown }) => A, falha?: (e: unknown) => B) {
    return Promise.resolve({
      data: this.resposta.data ?? [],
      error: this.resposta.error ?? null,
    }).then(ok, falha)
  }
}

const mock = vi.hoisted(() => ({
  respostas: {} as Record<string, { data?: unknown; error?: { message: string } | null }>,
  /** cada submit que chegou à action do desfecho: a FormData exata */
  submits: [] as FormData[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabela: string) => new ConsultaFalsa(mock.respostas[tabela] ?? { data: [] }),
    rpc: async () => ({ data: null, error: null }),
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect: ${url}`)
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

// A action do desfecho vira ESPIÃO: o submit real do jsdom entrega a FormData
// aqui (o que ela FAZ com a FormData é assunto do arquivo de node).
vi.mock('@/app/admin/agenda/actions', async () => {
  const real = await vi.importActual<typeof import('@/app/admin/agenda/actions')>(
    '@/app/admin/agenda/actions',
  )
  return {
    ...real,
    registrarDesfechoDaAulaAction: async (fd: FormData) => {
      mock.submits.push(fd)
    },
  }
})

const { default: AgendaPage } = await import('@/app/admin/agenda/page')
const { cookies } = await import('next/headers')

/* -------------------------------------------------------------------------- */
/* LIMITE DO jsdom, não do código: `getComputedStyle` × `calc()` inline         */
/* -------------------------------------------------------------------------- */
// O bloco de evento da grade tem `width: calc(100% - 4px)` inline (lane
// dividida), e o posicionamento do Radix (floating-ui) chama `getComputedStyle`
// nos ancestrais do gatilho para calcular a colisão. O motor de CSS do jsdom
// estoura ao resolver esse `calc()` (`resolveLengthInPixels` → null iterable) —
// numa Promise, o que vira "Unhandled Rejection" e derruba o arquivo inteiro
// sem nenhum caso vermelho. O balão do A4 não passa por aqui porque o gatilho
// dele (a meia-hora) não usa `calc()`.
// A guarda devolve uma declaração vazia SÓ quando o jsdom estoura: o cálculo de
// POSIÇÃO do balão não é o que este arquivo mede (nem daria para medir sem
// layout de verdade — isso é papel do e2e no WebKit).
const styleReal = window.getComputedStyle.bind(window)
window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
  try {
    return styleReal(el, pseudo ?? undefined)
  } catch {
    return {
      getPropertyValue: () => '',
      position: 'static',
      overflow: 'visible',
    } as unknown as CSSStyleDeclaration
  }
}) as typeof window.getComputedStyle

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

/* -------------------------------------------------------------------------- */
/* Dados                                                                       */
/* -------------------------------------------------------------------------- */

const CUIABA = 'America/Cuiaba'
const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: CUIABA }
const AULA = 'cccccccc-0000-0000-0000-000000000001'
const OUTRA_AULA = 'cccccccc-0000-0000-0000-000000000002'
const ALUNO = 'aaaaaaaa-0000-0000-0000-000000000001'
/** o login do aluno (`students.profile_id`) — A6/lote 2 */
const PERFIL = 'eeeeeeee-0000-0000-0000-000000000001'
const CONTRATO = 'dddddddd-0000-0000-0000-000000000001'

/** 10:00 em Cuiabá do dia congelado (14:00 lá) — aula que JÁ terminou. */
const INICIO_UTC = '2026-07-28T14:00:00Z'
const FIM_UTC = '2026-07-28T14:45:00Z'

/** A linha crua de `class_instances`, na projeção que `getAgenda` pede. */
function linhaDaAula(over: Record<string, unknown> = {}) {
  return {
    id: AULA,
    starts_at_utc: INICIO_UTC,
    ends_at_utc: FIM_UTC,
    state: 'scheduled',
    teacher_id: PROFESSORA,
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (a fixture-base é aula
    // de contrato — sem seção de cobrança no balão).
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: {
      id: CONTRATO,
      plan_name: 'Mensal 2x',
      // A6/lote 2: a projeção cresceu (login + número do perfil), porque é o
      // que o diálogo destrutivo precisa para as caixas de aviso nascerem
      // espelhando a entrega real.
      students: {
        id: ALUNO,
        display_name: 'Aluno Zero',
        iana_tz: CUIABA,
        profile_id: PERFIL,
        profiles: { whatsapp_e164: '+5565999990000' },
      },
      student_groups: null,
    },
    class_content_reports: null,
    ...over,
  }
}

/** A aula já pronta para o balão (o que a camada de dados devolve). */
function aula(over: Partial<AulaDaAgenda> = {}): AulaDaAgenda {
  return {
    id: AULA,
    inicioUtc: INICIO_UTC,
    fimUtc: FIM_UTC,
    situacao: 'sem_registro',
    teacherId: PROFESSORA,
    teacherNome: 'Teacher Vicky',
    teacherIdx: 0,
    quem: 'Aluno Zero',
    studentId: ALUNO,
    horaDoAluno: null,
    confirmada: false,
    temApontamento: true,
    contractId: CONTRATO,
    // A6/lote 2 — o aluno da fixture tem login E número: é o caso em que as
    // duas caixas do diálogo nascem marcadas. Os casos sem login / sem número
    // entram por `over`.
    temLogin: true,
    temWhatsapp: true,
    // F5: a fixture-base é aula de CONTRATO (sem seção de cobrança); os casos
    // de avulsa entram por `over`.
    avulsa: null,
    instante: { texto: 'ter, 28/07 às 10:00', iso: INICIO_UTC },
    hora: '10:00',
    ...over,
  }
}

/**
 * AGORA no fuso do negócio, como a página o entrega: é o `max` do campo "quando o
 * aviso chegou" (a mesma guarda que a ficha do aluno já dava — o banco recusa
 * aviso no futuro).
 */
const AGORA_NO_NEGOCIO = '2026-07-28T10:30'

/** O balão como a página o monta (Server Component compondo duas peças cliente). */
function balaoDaAula(over: Partial<AulaDaAgenda> = {}): ReactNode {
  return h(BalaoDaAula, {
    a: aula(over),
    back: '/admin/agenda?v=dia&d=2026-07-28',
    backErro: `/admin/agenda?v=dia&d=2026-07-28&ev=${AULA}`,
    duplicarHref: `/admin/agenda?v=dia&d=2026-07-28&novo=avulsa&nd=2026-07-28&nt=10%3A00&nc=${CONTRATO}`,
    historico: [],
    digitado: {},
    agoraNoNegocio: AGORA_NO_NEGOCIO,
  })
}

/** O evento da grade com o balão de aula dentro (como a página o monta). */
function eventoComBalao(over: Partial<AulaDaAgenda> = {}): CalEvent {
  return {
    id: AULA,
    startsAtUtc: INICIO_UTC,
    endsAtUtc: FIM_UTC,
    title: 'Aluno Zero',
    color: 0,
    popup: balaoDaAula(over),
  }
}

/* -------------------------------------------------------------------------- */
/* Montagem                                                                    */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement | undefined
let root: Root | undefined
let pote: PoteDeCookies

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  tela.desktop = false
  tela.ouvintes = []
  mock.respostas = {
    class_instances: { data: [linhaDaAula()] },
    teachers: { data: [DONA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
    audit_log: { data: [] },
  }
  mock.submits = []
  // O `FormValidado`/`Select` do kit chamam `scrollIntoView` no foco; o jsdom não o tem.
  Element.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
  await desmontar()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

/** Os balões ABERTOS vivem no portal do Radix, fora do container. */
const abertos = () => document.body.querySelectorAll('[data-slot="popover-content"]')

/** Em qual das duas grades da semana está o gatilho ABERTO (`sm:hidden` = a do
 *  celular; `hidden sm:block` = a de 7 colunas). Vazio = nenhum aberto. */
function gradeDoBalaoAberto(): string {
  let pai = document.body.querySelector('button[data-state="open"]')?.parentElement ?? null
  while (pai) {
    if (/sm:hidden/.test(pai.className)) return 'celular'
    if (/hidden sm:block/.test(pai.className)) return 'desktop'
    pai = pai.parentElement
  }
  return ''
}

/**
 * O BALÃO DE AULA ABERTO, servido pela grade — e não montado à mão.
 *
 * `BalaoDaAula` usa `PopoverClose` (o ícone de fechar), que EXIGE o Root do
 * Radix: montar o componente solto estoura com "`PopoverClose` must be used
 * within `Popover`". Montar pela grade é também o que a página faz, então o que
 * se mede aqui é a composição real. Visão DIA de propósito: uma grade só
 * (`variante: 'unica'`), então a largura da tela não entra na conta deste bloco.
 */
async function balaoAberto(over: Partial<AulaDaAgenda> = {}): Promise<HTMLElement> {
  await montarNo(
    h(Calendario, {
      events: [eventoComBalao(over)],
      view: 'dia' as const,
      anchor: '2026-07-28',
      tz: CUIABA,
      dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
      todayISO: '2026-07-28',
      eventoAberto: AULA,
    }),
  )
  const el = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
  if (!el) throw new Error('o balão da aula não abriu')
  return el
}

/** A grade da semana, ancorada no DIA da aula — é aí que as duas grades da
 *  semana mostram o MESMO evento, que é o caso do médio 3. */
async function semana(eventoAberto?: string, eventos: CalEvent[] = [eventoComBalao()]) {
  return montarNo(
    h(Calendario, {
      events: eventos,
      view: 'semana' as const,
      anchor: '2026-07-28',
      tz: CUIABA,
      dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
      todayISO: '2026-07-28',
      eventoAberto,
    }),
  )
}

/* ========================================================================== */
/* 1. `?ev=` ABRE **UM** BALÃO — a lacuna declarada no L4                      */
/* ========================================================================== */

describe('A5/L5 · `?ev=` na SEMANA abre exatamente UM balão', () => {
  it('NO CELULAR: um só, e é o da grade do celular (o médio 3, na peça reusada)', async () => {
    // A semana desenha DUAS grades com o MESMO evento; `eventoAberto` vai para as
    // duas, e quem decide é o cliente, por media query, depois de montar.
    tela.desktop = false
    await semana(AULA)
    expect(abertos().length, 'as duas grades da semana abriram o mesmo balão').toBe(1)
    expect(gradeDoBalaoAberto()).toBe('celular')
  })

  it('NO DESKTOP: um só, e é o da grade de 7 colunas', async () => {
    tela.desktop = true
    await semana(AULA)
    expect(abertos().length, 'as duas grades da semana abriram o mesmo balão').toBe(1)
    expect(gradeDoBalaoAberto()).toBe('desktop')
  })

  it('atravessar a fronteira dos 640px NUNCA produz dois balões', async () => {
    // A invariante que importa é "nunca dois" — e ela vale nos dois sentidos.
    //
    // ⚠️ MEDIDO E DECLARADO (não é o que se esperaria): ao atravessar a
    // fronteira o balão FECHA (vira 0), em vez de migrar para a outra grade. A
    // causa medida: quem fecha devolve o foco ao gatilho dele, e esse foco cai
    // FORA do balão que acabou de abrir — o `DismissableLayer` do Radix então o
    // dispensa. Consequência real: girar o celular para paisagem (≥640px) com o
    // balão reaberto por `?ev=` fecha o balão; o rascunho sobrevive no cookie e
    // o `?ev=` continua na URL, então o custo é UM toque a mais. Sem dinheiro
    // envolvido e sem balão órfão — que era o defeito do médio 3.
    // O caso fica para o harness e2e do A9, no WebKit real, onde há layout de
    // verdade e rotação de verdade.
    tela.desktop = false
    await semana(AULA)
    expect(abertos().length).toBe(1)
    await larguraDeTela(true)
    expect(abertos().length, 'dois balões abertos depois do giro').toBeLessThanOrEqual(1)
    await larguraDeTela(false)
    expect(abertos().length, 'dois balões abertos depois de voltar').toBeLessThanOrEqual(1)
  })

  it('o balão aberto é o DESTA aula (conteúdo, não só contagem)', async () => {
    tela.desktop = false
    await semana(AULA)
    const balao = abertos()[0] as HTMLElement
    expect(balao.getAttribute('aria-label')).toContain('Aluno Zero')
    // a matriz do desfecho está dentro dele
    expect(balao.querySelector('input[name="desfecho"]')).not.toBeNull()
    expect(balao.querySelector<HTMLInputElement>('input[name="instance_id"]')!.value).toBe(AULA)
  })

  it('sem `?ev=` nenhum balão nasce aberto', async () => {
    await semana(undefined)
    expect(abertos().length).toBe(0)
  })

  it('`?ev=` de aula que NÃO está na visão não abre nada e não estoura', async () => {
    await semana('cccccccc-9999-9999-9999-999999999999')
    expect(abertos().length).toBe(0)
    // …e a grade continuou desenhando o evento que existe
    expect(container!.querySelector('button[title="Aluno Zero"]')).not.toBeNull()
  })

  it('Back/Forward: trocar a URL mexe num Root JÁ MONTADO (o médio 4)', async () => {
    tela.desktop = false
    await semana(undefined)
    expect(abertos().length).toBe(0)
    // Forward para a URL de erro (é o que o Router faz: re-render, não remount)
    await act(async () => {
      root!.render(
        h(Calendario, {
          events: [eventoComBalao()],
          view: 'semana' as const,
          anchor: '2026-07-28',
          tz: CUIABA,
          dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
          todayISO: '2026-07-28',
          eventoAberto: AULA,
        }),
      )
    })
    expect(abertos().length, 'o Root já montado ignorou a URL nova').toBe(1)
    // Back para a URL limpa: fecha
    await act(async () => {
      root!.render(
        h(Calendario, {
          events: [eventoComBalao()],
          view: 'semana' as const,
          anchor: '2026-07-28',
          tz: CUIABA,
          dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
          todayISO: '2026-07-28',
        }),
      )
    })
    expect(abertos().length, 'o Back deixou o balão do erro aberto').toBe(0)
  })
})

/* ========================================================================== */
/* 2. A PÁGINA TRADUZ `?ev=` — e nada de pessoa entra na URL                   */
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

async function arvoreDaAgenda(query: Record<string, string>): Promise<unknown> {
  return AgendaPage({ searchParams: Promise.resolve(query) })
}

describe('A5/L5 · a página traduz `?ev=` e só o id opaco viaja', () => {
  it('`?ev=<id>` chega ao Calendario como `eventoAberto`', async () => {
    const arvore = await arvoreDaAgenda({ v: 'dia', d: '2026-07-28', ev: AULA })
    const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
    expect(cal.props.eventoAberto).toBe(AULA)
  })

  it('`?ev=` malformado NÃO abre balão nenhum (endpoint público)', async () => {
    for (const ev of ['../../etc', 'a b', 'x'.repeat(65), '', 'aula/1']) {
      const arvore = await arvoreDaAgenda({ v: 'dia', d: '2026-07-28', ev })
      const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
      expect(cal.props.eventoAberto, JSON.stringify(ev)).toBeUndefined()
    }
  })

  it('os dois endereços que o balão emite carregam GEOMETRIA + id opaco, e nada de pessoa', async () => {
    const arvore = await arvoreDaAgenda({ v: 'dia', d: '2026-07-28', ev: AULA })
    // O balão não está em `children`: ele viaja no `popup` de cada `CalEvent`,
    // que é prop do Calendario. É de lá que a página o serve.
    const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
    const evento = (cal.props.events as CalEvent[]).find((e) => e.id === AULA)!
    const balao = evento.popup as unknown as ElementoDaArvore
    expect(balao.type).toBe(BalaoDaAula)
    const backErro = String(balao.props.backErro)
    const duplicar = String(balao.props.duplicarHref)

    // `?ev=` diz só QUAL aula, e o `?nc=` só QUAL contrato — ids opacos.
    expect(backErro).toContain(`ev=${AULA}`)
    expect(duplicar).toContain(`nc=${CONTRATO}`)
    const chaves = (url: string) => [...new URLSearchParams(url.split('?')[1] ?? '').keys()].sort()
    expect(chaves(backErro)).toEqual(['d', 'ev', 'v'])
    expect(chaves(duplicar)).toEqual(['d', 'nc', 'nd', 'novo', 'nt', 'v'])

    // NADA de pessoa nem de frase: nome do aluno, nota, hora do aviso, recado.
    for (const url of [backErro, duplicar, String(balao.props.back)]) {
      for (const proibido of ['Aluno Zero', 'msg=', 'notified_at', 'off_note', 'cortesia', 'motivo'])
        expect(decodeURIComponent(url), `${proibido} em ${url}`).not.toContain(proibido)
    }
  })

  it('contrato ILEGÍVEL: o "duplicar" abre sem `nc=` em vez de prometer o que não sabe', async () => {
    // `contractId` é `null` quando o embed do contrato não veio. Aí o painel da
    // avulsa abre no mesmo horário com o aluno a escolher — e a URL não ganha
    // um `nc` inventado.
    mock.respostas.class_instances = { data: [linhaDaAula({ contracts: null })] }
    const arvore = await arvoreDaAgenda({ v: 'dia', d: '2026-07-28', ev: AULA })
    const cal = [...percorrer(arvore)].find((el) => el.type === Calendario)!
    const evento = (cal.props.events as CalEvent[]).find((e) => e.id === AULA)!
    const balao = evento.popup as unknown as ElementoDaArvore
    expect(String(balao.props.duplicarHref)).not.toContain('nc=')
    expect(String(balao.props.duplicarHref)).toContain('novo=avulsa')
  })

  it('o RECADO da action nova continua no COOKIE, nunca na URL da página', async () => {
    // A página só pinta o cookie quando não há ponte legada — e o cookie é
    // `httpOnly`, escrito pelo servidor. A prova de que a frase não vaza para a
    // URL está no arquivo de node; aqui a prova é que a página SABE ler o cookie.
    const { gravarRecado } = await import('@/lib/kit/recado')
    await gravarRecado('agenda', 'Falta da professora registrada — o aluno GANHOU um crédito.')
    const arvore = await arvoreDaAgenda({ v: 'dia', d: '2026-07-28' })
    const avisos = [...percorrer(arvore)].filter(
      (el) => typeof el.props.mensagem === 'string' && el.props.mensagem !== '',
    )
    expect(avisos).toHaveLength(1)
    expect(String(avisos[0].props.mensagem)).toContain('GANHOU um crédito')
    // o cookie é o veículo: ele existe, e é `httpOnly`
    const escrita = pote.escritas.find((e) => e.nome === 'recado_agenda')
    expect(escrita?.opcoes.httpOnly).toBe(true)
    expect(escrita?.opcoes.path).toBe('/admin/agenda')
  })
})

/* ========================================================================== */
/* 3. NADA INVISÍVEL CONTINUA CLICÁVEL — 4ª aparição da família                */
/* ========================================================================== */

/** O bloqueio do dia civil 28/07 em Cuiabá, como a página o monta (A3). */
const BLOQUEIO: CalEvent = {
  id: 'bl-1',
  startsAtUtc: '2026-07-28T04:00:00Z',
  endsAtUtc: '2026-07-29T04:00:00Z',
  title: 'bloqueada — férias',
  color: 0,
  blocked: true,
}

/** Quem RECEBE o toque naquele y da coluna (o de cima que não é inerte). */
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

describe('A5/L5 · a camada de FUNDO por baixo do balão de aula', () => {
  async function dia(eventos: CalEvent[]) {
    const c = await montarNo(
      h(Calendario, {
        events: eventos,
        view: 'dia' as const,
        anchor: '2026-07-28',
        tz: CUIABA,
        dayHref: (d: string) => `/admin/agenda?v=dia&d=${d}`,
        todayISO: '2026-07-28',
      }),
    )
    const bloco = c.querySelector<HTMLElement>('button[title^="Aluno Zero"], [title^="bloqueada"]')
    if (!bloco) throw new Error('nada renderizado na coluna')
    return { c, coluna: bloco.parentElement as HTMLElement }
  }

  it('o bloqueio NÃO come o gatilho da aula: a aula é primeiro plano e continua clicável', async () => {
    const { c, coluna } = await dia([BLOQUEIO, eventoComBalao()])
    const gatilho = c.querySelector<HTMLElement>('button[title^="Aluno Zero"]')
    expect(gatilho, 'a aula perdeu o gatilho por causa do fundo').not.toBeNull()
    // o fundo é inerte (o slot vazio embaixo dele segue vivo)
    const fundo = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    expect(fundo.className).toContain('pointer-events-none')
    expect(fundo.tagName).toBe('DIV')
    // e quem recebe o toque na faixa da aula é a AULA, não o fundo
    const y = parseFloat(gatilho!.style.top) + 2
    expect(quemRecebeOToque(coluna, y)).toBe(gatilho)
  })

  it('NENHUM elemento clicável da região está invisível: todo botão da coluna tem geometria e rótulo', async () => {
    const { c, coluna } = await dia([BLOQUEIO, eventoComBalao()])
    const clicaveis = [...coluna.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        (el.tagName === 'BUTTON' || el.tagName === 'A') &&
        !el.className.includes('pointer-events-none'),
    )
    expect(clicaveis.length).toBeGreaterThan(0)
    for (const el of clicaveis) {
      // alvo com altura de verdade (o piso da casa é 24px)
      const h = parseFloat(el.style.height || '0')
      if (el.style.height) expect(h, el.title).toBeGreaterThanOrEqual(24)
      // e nome alcançável: título, texto ou aria-label — botão anônimo é botão
      // invisível para quem usa leitor de tela
      const nome = (el.getAttribute('aria-label') ?? '') + el.title + (el.textContent ?? '')
      expect(nome.trim(), `clicável sem nome: ${el.outerHTML.slice(0, 120)}`).not.toBe('')
    }
    // o fundo do bloqueio existe e NÃO está entre os clicáveis
    expect(c.querySelector('[title="bloqueada — férias"]')).not.toBeNull()
    expect(clicaveis.some((el) => el.title.startsWith('bloqueada'))).toBe(false)
  })

  it('a aba escondida do balão sai da árvore: `hidden` no painel inativo', async () => {
    const c = await balaoAberto()
    const paineis = [...c.querySelectorAll('[role="tabpanel"]')]
    expect(paineis).toHaveLength(2)
    // o Desfecho começa visível; o Histórico começa `hidden` (fora do Tab e da
    // árvore de acessibilidade) — nada invisível continua alcançável
    expect(paineis[0].hasAttribute('hidden')).toBe(false)
    expect(paineis[1].hasAttribute('hidden')).toBe(true)
    // e os dois seguem MONTADOS: trocar de aba não pode apagar o formulário
    expect(paineis[0].querySelector('form')).not.toBeNull()
    // a aba não selecionada sai do Tab (padrão ARIA de tablist)
    const abas = [...c.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(abas.map((b) => b.tabIndex)).toEqual([0, -1])
  })
})

/* ========================================================================== */
/* 4. A BARRA DE ÍCONES: três alvos, três nomes, nenhum botão sem backend      */
/* ========================================================================== */

describe('A5/L5 · a barra de ícones do balão de aula', () => {
  it('três ícones — remarcar · duplicar · fechar — cada um com `aria-label` e alvo ≥ 24px', async () => {
    const c = await balaoAberto()
    const icones = [...c.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]')].filter(
      (el) => el.className.includes('h-8') && el.className.includes('w-8'),
    )
    expect(icones).toHaveLength(3)
    for (const el of icones) {
      // 32px, acima do piso de 24 da casa
      expect(el.className, el.getAttribute('aria-label') ?? '').toMatch(/\bh-8\b/)
      expect((el.getAttribute('aria-label') ?? '').length).toBeGreaterThan(5)
      // o SVG do ícone é decorativo — o nome é do BOTÃO
      const svg = el.querySelector('svg')
      if (svg) expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
    const nomes = icones.map((el) => el.getAttribute('aria-label'))
    expect(nomes).toEqual([
      'Remarcar a aula de Aluno Zero',
      'Criar outra aula igual a esta, de Aluno Zero',
      'Fechar',
    ])
  })

  it('NENHUM ícone de excluir: não existe delete de aula em migration nenhuma', async () => {
    const c = await balaoAberto()
    const tudo = [...c.querySelectorAll<HTMLElement>('a, button')]
    for (const el of tudo) {
      const nome = ((el.getAttribute('aria-label') ?? '') + ' ' + el.title).toLowerCase()
      expect(nome, el.outerHTML.slice(0, 100)).not.toMatch(/excluir|apagar|deletar|remover a aula/)
    }
  })

  it('TUDO o que é clicável no balão tem alvo ≥ 24px (piso da casa)', async () => {
    const c = await balaoAberto()
    for (const el of [...c.querySelectorAll<HTMLElement>('a, button')]) {
      const cls = el.className
      const nome = el.textContent || el.getAttribute('aria-label') || ''
      // TODO clicável declara o alvo pelas classes do kit (h-8/min-h-6/9/11).
      // A exceção "link de texto com hover:underline" MORREU (Sol · rodada 1 do
      // A5, médio 6): ela cobria justamente o defeito — o "Abrir ficha do aluno
      // →" era link de texto puro, abaixo de 24px no celular —, e uma régua que
      // abre exceção para a forma do defeito deixa de ser régua.
      const declarado = /\bh-8\b|min-h-(6|9|11)\b/.test(cls)
      expect(declarado, `alvo indefinido em «${nome}» · ${cls}`).toBe(true)
    }
  })
})

/* ========================================================================== */
/* 5. `RODAPE_DO_POLEGAR` E `z-[45]` NO BALÃO DE AULA — no elemento renderizado */
/* ========================================================================== */

describe('A5/L5 · a largura própria do balão de aula não come o empilhamento', () => {
  it('o balão aberto tem `z-[45]` (acima da barra do polegar) E a largura do A5', async () => {
    tela.desktop = false
    await semana(AULA)
    const balao = abertos()[0] as HTMLElement
    // A largura do A5 é `className` do consumidor; o `z-[45]` é do primitivo. Se
    // o `cn()` ou uma refatoração trocar um pelo outro, o balão volta a nascer
    // SOB a barra fixa do celular (achado 5 do portão de deploy).
    expect(balao.className).toContain('z-[45]')
    expect(balao.className).toContain(LARGURA_DO_BALAO_DE_AULA)
    expect(LARGURA_DO_BALAO_DE_AULA).toBe('w-96')
    // e o teto de rolagem própria: sem ele a matriz de 5 linhas fica
    // inalcançável no celular (o popover vive num portal de posição fixa).
    // O teto APERTOU no A9 (30/07): `70vh` sozinho não sabia quanto espaço
    // sobrou entre a âncora e a borda da tela, e o balão da aula das 03:30
    // desenhava 664px onde havia 408 — o CTA "Registrar como realizada" ficava
    // abaixo do monitor, e rolar não o trazia (quem rolava era o miolo, dentro
    // de uma caixa cuja borda já estava fora da tela). Agora é o MENOR entre
    // `70vh` e a medida do Radix, então o `70vh` continua pinado aqui — dentro
    // do `min()`, e não sozinho.
    expect(balao.innerHTML).toContain('overflow-y-auto')
    expect(balao.innerHTML).toContain('max-h-[min(70vh,')
    expect(balao.innerHTML).toContain('--radix-popover-content-available-height')
  })

  it('a fronteira de colisão do polegar continua a DO PRIMITIVO — ninguém a sobrescreve', async () => {
    // `collisionPadding` é número em JS: não dá para ler do DOM sem layout de
    // verdade. O que se pode provar é que o balão de aula NÃO passa um valor
    // próprio — logo ele herda `bottom: RODAPE_DO_POLEGAR`, que é o que impede
    // o balão de nascer embaixo da barra fixa do celular (achado 5 do portão).
    const fs = await import('node:fs')
    const path = await import('node:path')
    const ler = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
    const primitivo = ler('src/components/kit/popover.tsx')
    expect(primitivo).toMatch(/bottom: RODAPE_DO_POLEGAR/)
    expect(primitivo).toMatch(/const RODAPE_DO_POLEGAR = 9[0-9]/)
    expect(primitivo).toContain('z-[45]')
    // as duas peças do caminho do balão de aula só passam LARGURA: nenhuma
    // ATRIBUI `collisionPadding` (o `calendario.tsx` só o menciona em comentário,
    // justamente para dizer que a colisão vem do kit)
    for (const rel of ['src/components/kit/balao-do-slot.tsx', 'src/components/kit/calendario.tsx'])
      expect(ler(rel), rel).not.toMatch(/collisionPadding\s*[=:]/)
  })

  it('o Select do tema sobe ACIMA do balão (senão o menu abre por baixo)', async () => {
    const c = await balaoAberto()
    // o tema só existe DEPOIS de escolher "realizada" (nada nasce pré-marcado)
    await escolher(c, 'realizada')
    const trigger = c.querySelector<HTMLElement>('[data-slot="select-trigger"], button[role="combobox"]')
    expect(trigger, 'o Select do tema não renderizou').not.toBeNull()
    // o conteúdo do Select declara `z-60` no consumidor — acima do `z-[45]`
    const fonte = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/components/admin/agenda/DesfechoDaAula.tsx'),
      'utf8',
    )
    expect(fonte).toContain('z-60')
  })
})

/* ========================================================================== */
/* 6. A MATRIZ NA TELA: o gate, o aviso da hora, o apontamento, a hora do aviso */
/* ========================================================================== */

async function matriz(
  situacao: SituacaoDaAula,
  over: Partial<AulaDaAgenda> = {},
  /** o RASCUNHO da volta de erro (A6 · rodada 2 do Sol) — vazio por padrão */
  digitado: Record<string, string> = {},
) {
  return montarNo(
    h(DesfechoDaAula, {
      aulaId: AULA,
      situacao,
      temApontamento: over.temApontamento ?? true,
      back: '/admin/agenda',
      backErro: `/admin/agenda?ev=${AULA}`,
      digitado,
      agoraNoNegocio: AGORA_NO_NEGOCIO,
      // A6/lote 2: o default da fixture é o aluno COMPLETO (login + número);
      // quem quiser o aluno sem acesso passa `temLogin: false` em `over`.
      // ⚠️ `??` NÃO serve aqui: `null` é um valor LEGÍTIMO (a aula de grupo, que
      // significa "esta tela não sabe"), e `?? true` o transformaria em "sabe e
      // tem" — o teste do grupo passaria medindo o caso do aluno individual.
      entregabilidade: {
        temLogin: over.temLogin === undefined ? true : over.temLogin,
        temWhatsapp: over.temWhatsapp === undefined ? true : over.temWhatsapp,
      },
      pele: 'balao' as const,
    }),
  )
}

const linhas = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLInputElement>('input[name="desfecho"]')].map((i) => i.value)

/**
 * Marca uma linha da matriz. Existe porque NADA nasce pré-marcado (revisão
 * independente do A5, grave 2: o registro é irreversível): os campos que dependem
 * da escolha — tema, detalhe, hora do aviso — só aparecem depois do toque.
 */
async function escolher(c: HTMLElement, valor: string) {
  const radio = [...c.querySelectorAll<HTMLInputElement>('input[name="desfecho"]')].find(
    (i) => i.value === valor,
  )
  expect(radio, `a linha ${valor} não está na matriz`).toBeDefined()
  await act(async () => {
    radio!.click()
  })
}

/**
 * O CTA da matriz — o ÚLTIMO botão do formulário (A6/lote 2).
 *
 * Ele deixou de ser sempre `type="submit"`: nos três desfechos irreversíveis
 * é o gatilho da confirmação (`type="button"`), e nas duas faltas continua
 * enviando. Por isso o seletor é posicional, não pelo tipo.
 */
function ctaDaMatriz(c: HTMLElement): HTMLButtonElement {
  const botoes = [...c.querySelectorAll<HTMLButtonElement>('form > button')]
  const cta = botoes.at(-1)
  expect(cta, 'o CTA da matriz sumiu do formulário').toBeDefined()
  return cta!
}

describe('A5/L5 · a matriz na tela obedece ao gate por situação', () => {
  it('aula que TERMINOU oferece as cinco, com a ressalva da hora no cabeçalho', async () => {
    const c = await matriz('sem_registro')
    expect(linhas(c)).toEqual([
      'realizada',
      'falta_aluno',
      'falta_professora',
      'cancelada_professora',
      'cancelada_aluno',
    ])
    expect(c.textContent).toContain(AVISO_DA_HORA)
    // NADA NASCE MARCADO, nem "realizada" (revisão independente do A5, grave 2):
    // o registro é IRREVERSÍVEL — nenhuma função devolve a aula a `scheduled` —, e
    // com nove cartões na fila da segunda-feira um toque errado atesta como
    // realizada uma aula que era falta da professora, tirando o crédito do aluno.
    // O CTA continua ENABLED (a régua da casa), mas neutro até ela escolher.
    const marcados = [...c.querySelectorAll<HTMLInputElement>('input[name="desfecho"]')].filter(
      (i) => i.checked,
    )
    expect(marcados, 'nenhuma linha pré-marcada').toHaveLength(0)
    const cta = c.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(cta.disabled).toBe(false)
    expect(cta.className).toContain('btn-paper')
    expect(cta.className).not.toContain('btn-ink')
    expect(cta.textContent).toContain('Registrar desfecho')
    // cada linha mostra o RÓTULO e a frase de consequência (a frase é o que muda
    // a decisão — DADO, não apoio)
    for (const d of linhas(c)) expect(c.textContent).toContain(ROTULO[d as keyof typeof ROTULO])
  })

  it('aula FUTURA oferece SÓ os dois cancelamentos — e SEM a ressalva da hora', async () => {
    const c = await matriz('agendada')
    expect(linhas(c)).toEqual(['cancelada_professora', 'cancelada_aluno'])
    // a soma do extrato exige `starts_at < now()`: em aula futura a frase "JÁ
    // conta" seria falsa, então ela não aparece
    expect(c.textContent).not.toContain(AVISO_DA_HORA)
    // e NENHUM cancelamento nasce marcado (um toque distraído não cancela aula)
    const marcados = [...c.querySelectorAll<HTMLInputElement>('input[name="desfecho"]')].filter(
      (i) => i.checked,
    )
    expect(marcados).toHaveLength(0)
    // o CTA existe e não nasce desabilitado (régua da casa)
    const cta = c.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(cta.disabled).toBe(false)
    expect(cta.textContent).toContain('Registrar desfecho')
  })

  it('aula COM desfecho não oferece nada — e DECLARA a consequência do estado', async () => {
    for (const s of ['realizada', 'falta_professora', 'cancelada', 'remarcada'] as const) {
      await desmontar()
      const c = await matriz(s)
      expect(c.querySelector('form'), s).toBeNull()
      expect(c.textContent, s).toMatch(/extrato da professora/)
    }
  })

  it('SEM apontamento a opção "realizada" NÃO se esconde — ela AVISA', async () => {
    const c = await matriz('sem_registro', { temApontamento: false })
    // a opção continua oferecida (esconder trabalho legítimo também é defeito)
    expect(linhas(c)).toContain('realizada')
    await escolher(c, 'realizada')
    // …e o aviso é visível, no piso de DADO (warn-700, nunca ink-400/text-xs)
    const aviso = [...c.querySelectorAll('p')].find((p) =>
      (p.textContent ?? '').includes('ainda não apontou'),
    )
    expect(aviso, 'o alerta do apontamento não apareceu').toBeDefined()
    expect(aviso!.className).toContain('text-warn-700')
    expect(aviso!.className).not.toMatch(/text-xs|text-ink-400/)
    // e o campo do tema está aberto para ela resolver ali
    expect(c.querySelector('input[name="off_kind"]')).not.toBeNull()
  })

  it('COM apontamento o alerta não aparece — e o campo do tema continua lá', async () => {
    const c = await matriz('sem_registro', { temApontamento: true })
    await escolher(c, 'realizada')
    expect(c.textContent).not.toContain('A professora ainda não apontou')
    expect(c.querySelector('input[name="off_kind"]')).not.toBeNull()
  })

  it('escolher cancelamento revela a HORA DO AVISO — o campo que permite cancelar aula já começada', async () => {
    const c = await matriz('sem_registro')
    // antes de escolher, o campo não existe (e agora NADA nasce escolhido)
    expect(c.querySelector('input[name="notified_at"]')).toBeNull()
    await escolher(c, 'cancelada_aluno')
    const campo = c.querySelector<HTMLInputElement>('input[name="notified_at"]')
    expect(campo, 'sem este campo, cancelar aula passada é sempre recusado pelo banco').not.toBeNull()
    expect(campo!.type).toBe('datetime-local')
    // …e o campo tem `max` = AGORA no fuso do negócio (hora futura não é aviso;
    // o banco recusa).
    //
    // ⚠️ MUDOU NO LOTE FINAL (revisão independente do A6, M3): o `max` deixou de
    // ser o valor que o SERVIDOR renderizou e passou a ser renovado pelo
    // relógio do negócio no momento em que o campo monta (e a cada digitação, e
    // no toque do CTA). O motivo: com a aba aberta desde as 9h, o `max` do
    // render recusava "hoje 15:40" com a frase FALSA de hora no futuro, e sem
    // saída visível. O valor do servidor continua no HTML como CINTO (é a única
    // régua que existe sem JS).
    //
    // Por isso este caso agora mede as DUAS coisas: que o `max` é o agora
    // MEDIDO (o relógio congelado deste arquivo marca 14:00 em Cuiabá) e que
    // ele NÃO é mais o retrato velho que veio na propriedade — se o retrato
    // velho sobreviver, o defeito voltou.
    expect(campo!.getAttribute('max')).toBe('2026-07-28T14:00')
    expect(campo!.getAttribute('max')).not.toBe(AGORA_NO_NEGOCIO)
    // a explicação diz o que o campo FAZ (e o que ele não faz)
    expect(c.textContent).toContain('Não muda o crédito')
    expect(c.textContent).toContain('anterior ao início')
    // e o CTA passou a ser destrutivo, dizendo QUEM pediu.
    // A6/lote 2: ele deixou de ser `type="submit"` — cancelar é irreversível e
    // passa pela confirmação, que é quem envia. A roupa e o texto continuam os
    // mesmos (o que mudou é o que o toque FAZ, não o peso do botão).
    const cta = ctaDaMatriz(c)
    expect(cta.type).toBe('button')
    expect(cta.className).toContain('btn-danger')
    expect(cta.textContent).toContain('pedido do aluno')
    expect(
      c.querySelector('button[type="submit"]'),
      'o cancelamento voltou a enviar num toque só',
    ).toBeNull()
  })

  it('o submit leva a escolha e o rascunho DAQUELA aula — e nada mais', async () => {
    const c = await matriz('sem_registro')
    // ESCOLHER é obrigatório agora (grave 2): sem pré-seleção, o formulário só
    // carrega `desfecho` depois do toque na linha — e é isso que este caso passou
    // a provar, em vez de herdar um valor que a tela decidia por ela.
    const realizada = [...c.querySelectorAll<HTMLInputElement>('input[name="desfecho"]')].find(
      (i) => i.value === 'realizada',
    )!
    await act(async () => {
      realizada.click()
    })
    const form = c.querySelector('form')!
    await act(async () => {
      form.requestSubmit()
    })
    const fd = mock.submits.at(-1)
    expect(fd, 'o submit não chegou à action').toBeDefined()
    expect(fd!.get('desfecho')).toBe('realizada')
    expect(fd!.get('instance_id')).toBe(AULA)
    // A7 — O FORMULÁRIO NÃO DECLARA MAIS NADA DISSO, e é a inversão anunciada:
    // o A5 escreveu, ao lado do campo oculto, que ele "continua existindo porque
    // o contrato do formulário é do A7". A lista de campos que sobrevivem ao
    // erro é `CAMPOS_DO_DESFECHO` (servidor), e a identidade do rascunho é
    // derivada do `instance_id` que a própria action recebe.
    //
    // A6 · rodada 2 do Sol (P2) continua coberto, e no lugar onde ele decide: os
    // TRÊS campos da escolha de canais nasceram no lote 2 e ficaram de fora das
    // listas, e a consequência era a recusa RELIGANDO o canal que a dona tinha
    // desmarcado. Por isso este caso compara a lista INTEIRA, em ordem.
    expect([...CAMPOS_DO_DESFECHO]).toEqual([
      'desfecho',
      'off_kind',
      'off_note',
      'notified_at',
      'canais',
      'avisar_email',
      'avisar_whatsapp',
    ])
    expect(fd!.get('manter'), 'a lista voltou a viajar do cliente').toBeNull()
    expect(fd!.get('na_url')).toBeNull()
    expect(fd!.get('rascunho'), 'a chave voltou a viajar do cliente').toBeNull()
  })
})

/* ========================================================================== */
/* 7. A PELE LARGA da fila de pendências é a MESMA matriz                      */
/* ========================================================================== */

describe('A5/L5 · as duas peles dizem a MESMA coisa', () => {
  it('`largo` e `balao` oferecem as mesmas cinco linhas e as mesmas frases', async () => {
    const daFila = await montarNo(
      h(DesfechoDaAula, {
        aulaId: OUTRA_AULA,
        situacao: 'sem_registro' as const,
        temApontamento: true,
        back: '/admin/agenda?v=pendencias',
        backErro: `/admin/agenda?v=pendencias&ev=${OUTRA_AULA}`,
        digitado: {},
        agoraNoNegocio: AGORA_NO_NEGOCIO,
        entregabilidade: { temLogin: true, temWhatsapp: true },
        pele: 'largo' as const,
      }),
    )
    const dasLinhas = linhas(daFila)
    const texto = daFila.textContent ?? ''
    await desmontar()
    const noBalao = await matriz('sem_registro')
    expect(dasLinhas).toEqual(linhas(noBalao))
    // a frase de dinheiro é a MESMA nas duas (corrigir metade da tela é o
    // defeito que a pele única existe para impedir)
    expect(texto).toContain(AVISO_DA_HORA)
    expect(noBalao.textContent).toContain(AVISO_DA_HORA)
  })
})

/* ========================================================================== */
/* 8. A6/lote 2 — A CONFIRMAÇÃO DESTRUTIVA (o 1º consumidor do alert-dialog)   */
/* ========================================================================== */

/** O conteúdo do AlertDialog vive no portal do Radix, fora do container. */
const caixa = () => document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-content"]')

/** Abre a confirmação a partir do CTA da matriz. */
async function abrirConfirmacao(c: HTMLElement) {
  await act(async () => {
    ctaDaMatriz(c).click()
  })
  const caixaAberta = caixa()
  expect(caixaAberta, 'a confirmação não abriu').not.toBeNull()
  return caixaAberta!
}

/** As caixas de aviso DENTRO do diálogo, na ordem em que a tela as mostra. */
const caixasDeAviso = (dialogo: HTMLElement) => [
  ...dialogo.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
]

/** O que o formulário VAI ENVIAR (os escondidos ficam junto ao gatilho). */
const enviaria = (c: HTMLElement, nome: string) =>
  c.querySelector<HTMLInputElement>(`input[name="${nome}"]`)?.value ?? null

describe('A6/lote 2 · os três irreversíveis param para confirmar', () => {
  it('`realizada` abre a caixa com a consequência MEDIDA e a irreversibilidade', async () => {
    const c = await matriz('sem_registro')
    await escolher(c, 'realizada')
    const d = await abrirConfirmacao(c)
    // O texto é o da MATRIZ, não um texto novo: duas superfícies que falam do
    // mesmo dinheiro não podem ter palavras próprias (a lição do A5).
    expect(d.textContent).toContain(CONSEQUENCIA.realizada)
    expect(d.textContent).toContain(REGISTRO_NAO_SE_DESFAZ)
    // …e `realizada` não pergunta canal nenhum: `complete_class` não enfileira
    // aviso em lugar nenhum (varrido no §11 do A5).
    expect(caixasDeAviso(d)).toHaveLength(0)
    expect(enviaria(c, 'canais')).toBeNull()
  })

  it('as duas FALTAS continuam enviando no toque — elas não abrem caixa', async () => {
    for (const falta of ['falta_aluno', 'falta_professora']) {
      const c = await matriz('sem_registro')
      await escolher(c, falta)
      expect(ctaDaMatriz(c).type, falta).toBe('submit')
      await desmontar()
    }
  })

  it('cancelamento: a caixa traz os DOIS canais, marcados para quem tem os dois', async () => {
    const c = await matriz('sem_registro')
    await escolher(c, 'cancelada_professora')
    const d = await abrirConfirmacao(c)
    expect(d.textContent).toContain(CONSEQUENCIA.cancelada_professora)
    expect(d.textContent).toContain(ROTULO_DO_CANAL.email)
    expect(d.textContent).toContain(ROTULO_DO_CANAL.whatsapp)
    const [email, whats] = caixasDeAviso(d)
    expect(email.checked).toBe(true)
    expect(whats.checked).toBe(true)
    // …e é isto que o formulário levaria AGORA (o campo do portal não viaja:
    // quem viaja é o escondido, que fica junto ao gatilho)
    expect(enviaria(c, 'canais')).toBe('1')
    expect(enviaria(c, 'avisar_email')).toBe('1')
    expect(enviaria(c, 'avisar_whatsapp')).toBe('1')
  })

  it('SEM LOGIN as duas caixas nascem DESMARCADAS, com o porquê na frase', async () => {
    const c = await matriz('sem_registro', { temLogin: false, temWhatsapp: false })
    await escolher(c, 'cancelada_aluno')
    const d = await abrirConfirmacao(c)
    const [email, whats] = caixasDeAviso(d)
    expect(email.checked, 'e-mail sem destinatário não nasce prometido').toBe(false)
    expect(whats.checked).toBe(false)
    expect(d.textContent).toContain(SEM_LOGIN_NAO_ENTREGA)
    expect(enviaria(c, 'avisar_email')).toBe('0')
    expect(enviaria(c, 'avisar_whatsapp')).toBe('0')
    // A caixa NÃO é desabilitada (régua da casa: controle desabilitado não diz
    // por quê) — marcar continua possível, e o que ela produz está escrito.
    expect(email.disabled).toBe(false)
  })

  it('COM login e SEM número: e-mail marcado, WhatsApp desmarcado e explicado', async () => {
    const c = await matriz('sem_registro', { temLogin: true, temWhatsapp: false })
    await escolher(c, 'cancelada_aluno')
    const d = await abrirConfirmacao(c)
    const [email, whats] = caixasDeAviso(d)
    expect(email.checked).toBe(true)
    expect(whats.checked).toBe(false)
    expect(d.textContent).toContain(SEM_WHATSAPP_NAO_ENTREGA)
    expect(enviaria(c, 'avisar_email')).toBe('1')
    expect(enviaria(c, 'avisar_whatsapp')).toBe('0')
  })

  it('aula de GRUPO (`null`): as duas marcadas, e a tela diz que não sabe por quem', async () => {
    const c = await matriz('sem_registro', { temLogin: null, temWhatsapp: null })
    await escolher(c, 'cancelada_professora')
    const d = await abrirConfirmacao(c)
    const [email, whats] = caixasDeAviso(d)
    expect(email.checked).toBe(true)
    expect(whats.checked).toBe(true)
    expect(d.textContent).toContain(GRUPO_ENTREGA_POR_MEMBRO)
  })

  it('desmarcar uma caixa muda o que o FORMULÁRIO leva — não só a pintura', async () => {
    const c = await matriz('sem_registro')
    await escolher(c, 'cancelada_professora')
    const d = await abrirConfirmacao(c)
    const [, whats] = caixasDeAviso(d)
    await act(async () => {
      whats.click()
    })
    expect(enviaria(c, 'avisar_email')).toBe('1')
    expect(enviaria(c, 'avisar_whatsapp')).toBe('0')
  })

  it('CONFIRMAR ENVIA — e leva a escolha de canais junto', async () => {
    // O caso que mais importa: o botão de confirmar vive no PORTAL, fora do
    // formulário, e o Radix fecha o diálogo no próprio clique. Se o envio
    // dependesse da ação padrão do submit, ele morreria com o desmonte — por
    // isso `ConfirmarDesfecho` chama `requestSubmit()` à mão.
    const c = await matriz('sem_registro')
    await escolher(c, 'cancelada_aluno')
    const d = await abrirConfirmacao(c)
    const [email] = caixasDeAviso(d)
    await act(async () => {
      email.click()
    })
    const confirmar = [...d.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.type === 'submit',
    )
    expect(confirmar, 'a caixa não tem botão de confirmar').toBeDefined()
    await act(async () => {
      confirmar!.click()
    })
    const fd = mock.submits.at(-1)
    expect(fd, 'confirmar não enviou o formulário').toBeDefined()
    expect(fd!.get('desfecho')).toBe('cancelada_aluno')
    expect(fd!.get('canais')).toBe('1')
    expect(fd!.get('avisar_email')).toBe('0')
    expect(fd!.get('avisar_whatsapp')).toBe('1')
  })
})

/* ========================================================================== */
/* 9. A6 · rodada 2 do Sol — A ESCOLHA SOBREVIVE À RECUSA, E O CAMPO INVÁLIDO  */
/*    NÃO CHEGA À CONFIRMAÇÃO                                                  */
/* ========================================================================== */

describe('A6/rodada 2 · o rascunho manda nas caixas de aviso', () => {
  it('P2: depois de uma recusa, o canal DESMARCADO continua desmarcado', async () => {
    // O cenário exato do achado: aluno com login E número (as duas caixas
    // nasceriam marcadas), a dona desmarca o WhatsApp, o servidor recusa (hora
    // do aviso no futuro), o balão reabre com o rascunho. Antes, as caixas
    // renasciam pela ENTREGABILIDADE — e o WhatsApp que ela desmarcou de
    // propósito voltava ligado, mandando ao aluno o recado que ela decidiu não
    // mandar.
    const c = await matriz(
      'sem_registro',
      {},
      { desfecho: 'cancelada_professora', canais: '1', avisar_email: '1', avisar_whatsapp: '0' },
    )
    // a escolha do desfecho também volta do rascunho: a confirmação já é o CTA
    const d = await abrirConfirmacao(c)
    const [email, whats] = caixasDeAviso(d)
    expect(email.checked).toBe(true)
    expect(whats.checked, 'o WhatsApp desmarcado renasceu marcado').toBe(false)
    expect(enviaria(c, 'avisar_whatsapp')).toBe('0')

    // PROVA DE MUTAÇÃO: mesmo aluno, MESMA tela, sem rascunho de canal → as
    // duas nascem marcadas (a entregabilidade real, comportamento de sempre).
    await desmontar()
    const semRascunho = await matriz('sem_registro', {}, { desfecho: 'cancelada_professora' })
    const d2 = await abrirConfirmacao(semRascunho)
    expect(caixasDeAviso(d2).map((i) => i.checked)).toEqual([true, true])
  })

  it('a entregabilidade viaja no envio — é ela que separa "registrado" de "preso"', async () => {
    const c = await matriz('sem_registro', { temLogin: false, temWhatsapp: false })
    await escolher(c, 'cancelada_professora')
    expect(enviaria(c, 'entrega_email')).toBe('0')
    expect(enviaria(c, 'entrega_whatsapp')).toBe('0')
    await desmontar()

    // aula de GRUPO: a tela NÃO SABE, e "não sei" não pode virar "não"
    const grupo = await matriz('sem_registro', { temLogin: null, temWhatsapp: null })
    await escolher(grupo, 'cancelada_professora')
    expect(enviaria(grupo, 'entrega_email')).toBe('')
    expect(enviaria(grupo, 'entrega_whatsapp')).toBe('')
  })
})

describe('A6/rodada 2 · C10a — hora do aviso no futuro não morre em balão nativo', () => {
  it('o CTA NÃO abre a confirmação, o erro acende NO CAMPO e nada é enviado', async () => {
    const c = await matriz('sem_registro')
    await escolher(c, 'cancelada_aluno')
    const campo = c.querySelector<HTMLInputElement>('input[name="notified_at"]')!
    const enviadosAntes = mock.submits.length
    await act(async () => {
      campo.value = '2030-01-01T10:00' // depois do `max` (agora no negócio)
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(campo.validity.rangeOverflow, 'o `max` do campo sumiu').toBe(true)

    await act(async () => {
      ctaDaMatriz(c).click()
    })
    // 1. a confirmação NÃO abriu (era aqui que a dona confirmava no vazio)
    expect(caixa(), 'a confirmação abriu com o campo inválido').toBeNull()
    // 2. nada foi enviado à action
    expect(mock.submits.length).toBe(enviadosAntes)
    // 3. o erro está ACESO no campo, com a frase da casa — e não num balão do
    //    navegador, que some sozinho e o leitor de tela não guarda
    expect(campo.getAttribute('data-erro')).toBe('sim')
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    expect(c.textContent).toContain(AVISO_NO_FUTURO)

    // PROVA DE MUTAÇÃO: corrigido (campo vazio = "agora"), o CTA abre a caixa.
    await act(async () => {
      campo.value = ''
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await abrirConfirmacao(c)
  })
})
