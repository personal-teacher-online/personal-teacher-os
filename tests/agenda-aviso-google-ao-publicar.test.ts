// @vitest-environment jsdom
//
// ISSUE #190 — PUBLICAR HORÁRIO ABERTO EM CIMA DE COMPROMISSO DO GOOGLE AVISA.
//
// A dona publicava um horário aberto num horário em que a agenda do Google da
// professora tinha compromisso, e a aluna não via o horário no portal. Nada
// avisava. O que este arquivo protege:
//   1. com compromisso no Google, a publicação PARA antes da RPC e devolve a
//      dona ao formulário com o aviso guardado no rascunho;
//   2. "Publicar mesmo assim" publica, sem ler o Google de novo;
//   3. sem compromisso, publica direto, como sempre;
//   4. sem Google conectado ou com o Google fora do ar, publica direto e a tela
//      não mostra aviso nenhum;
//   5. a confirmação vale só para o horário avisado;
//   6. a sobreposição usa a leitura do portal (`googleBusyForTeacher`) e a
//      medida que o banco dá ao horário aberto;
//   7. as duas telas (painel e balão do slot) mostram o aviso com as duas saídas;
//   8. "Voltar" desfaz o aviso e devolve o formulário editável;
//   9. a publicação não fica esperando o Google (teto de tempo) nem depende da
//      chave do servidor.
//
// Não toca o banco: cliente Supabase falso, pote de cookies dublê e relógio
// congelado, no padrão de `onda-agenda-a4.test.ts`.
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { AvisoDoGoogleAoPublicar } from '@/components/admin/agenda/AvisoDoGoogleAoPublicar'
import {
  IntencoesDoSlot,
  ProvedorDoSlot,
  type DadosDoSlot,
} from '@/components/admin/agenda/IntencoesDoSlot'
import {
  AVISO_DO_GOOGLE_AO_PUBLICAR,
  CAMPO_DO_AVISO_DO_GOOGLE,
  fichaDoAvisoDoGoogle,
  PUBLICAR_MESMO_ASSIM,
} from '@/lib/admin/aviso-google-ao-publicar'
import { chaveDoBalao, chaveDoPainel, RASCUNHO_COOKIE } from '@/lib/admin/rascunho-do-formulario'
import { compromissoDoGoogleAoPublicar } from '@/lib/google/compromisso-ao-publicar'
import { CAMPOS_DA_PORTA } from '@/lib/admin/transporte-da-agenda'
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

type Ocupado =
  | { status: 'ok'; blocks: { startUtc: string; endUtc: string }[] }
  | { status: 'desconectada' }
  | { status: 'indisponivel' }

class ConsultaFalsa {
  constructor(private readonly resposta: Resposta) {}
  select() { return this }
  eq() { return this }
  is() { return this }
  in() { return this }
  not() { return this }
  gt() { return this }
  gte() { return this }
  lt() { return this }
  lte() { return this }
  or() { return this }
  limit() { return this }
  order() { return this }
  single() { return this }
  maybeSingle() { return this }
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
  /** cada RPC chamada pelo cliente de quem publica: [nome, argumentos] */
  rpcs: [] as Array<[string, unknown]>,
  /** a resposta de cada RPC, por nome */
  respostaRpc: {} as Record<string, Resposta>,
  /** o que a leitura do Google devolve — um erro a lançar, ou `'pendura'`
   *  (a chamada nunca responde) */
  google: { status: 'ok', blocks: [] } as Ocupado | Error | 'pendura',
  /** o cliente do servidor estoura ao ser criado (falta a chave do servidor) */
  semChaveDoServidor: false,
  /** cada leitura do Google: [professora, intervalo] */
  leiturasDoGoogle: [] as Array<[string, { fromUtcISO: string; toUtcISO: string }]>,
  /** cada submit que chegou à action de publicar */
  submits: [] as FormData[],
  /** cada submit que chegou à action do "Voltar" */
  voltas: [] as FormData[],
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
    from: (tabela: string) => new ConsultaFalsa(mock.respostas[tabela] ?? { data: [] }),
    rpc: async (fn: string, args: unknown) => {
      mock.rpcs.push([fn, args])
      const r = mock.respostaRpc[fn] ?? {}
      return { data: r.data ?? null, error: r.error ?? null }
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
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (mock.semChaveDoServidor) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
    return {}
  },
}))
vi.mock('@/lib/email/notify', () => ({ sendRescheduleEmails: async () => {} }))
vi.mock('@/lib/email/send', () => ({ sendEmail: async () => {}, sendEmailWithOutcome: async () => {} }))
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  // A MESMA leitura do portal: é ela que a publicação tem de consultar.
  googleBusyForTeacher: async (
    _admin: unknown,
    teacherId: string,
    range: { fromUtcISO: string; toUtcISO: string },
  ) => {
    mock.leiturasDoGoogle.push([teacherId, range])
    if (mock.google === 'pendura') return new Promise(() => {})
    if (mock.google instanceof Error) throw mock.google
    if (mock.google.status !== 'ok') return mock.google
    // COMO O GOOGLE: só volta o compromisso que cruza o intervalo PEDIDO. Sem
    // este filtro, encolher o alcance da leitura passaria batido pela suíte.
    const de = Date.parse(range.fromUtcISO)
    const ate = Date.parse(range.toUtcISO)
    return {
      status: 'ok' as const,
      blocks: mock.google.blocks.filter(
        (b) => Date.parse(b.endUtc) > de && Date.parse(b.startUtc) < ate,
      ),
    }
  },
}))
vi.mock('@/lib/notify/evolution', () => ({
  evolutionChannel: () => ({}),
  evolutionConfigFromEnv: () => ({}),
}))
vi.mock('@/lib/outbox/dispatch', () => ({ dispatchOutbox: async () => {} }))

// Os formulários enviam para espiões; as actions VERDADEIRAS são importadas à parte.
vi.mock('@/app/admin/agenda/actions', async () => {
  const real = await vi.importActual<typeof import('@/app/admin/agenda/actions')>(
    '@/app/admin/agenda/actions',
  )
  return {
    ...real,
    publishWindowAction: async (fd: FormData) => {
      mock.submits.push(fd)
    },
    voltarDoAvisoDoGoogleAction: async (fd: FormData) => {
      mock.voltas.push(fd)
    },
  }
})

const { publishWindowAction: publicarEspiao } = await import('@/app/admin/agenda/actions')
const { publishWindowAction, voltarDoAvisoDoGoogleAction } = await vi.importActual<
  typeof import('@/app/admin/agenda/actions')
>('@/app/admin/agenda/actions')
const { default: AgendaPage } = await import('@/app/admin/agenda/page')
const { cookies } = await import('next/headers')

/* ========================================================================== */
/* Cenário                                                                     */
/* ========================================================================== */

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const OUTRA = '22222222-2222-2222-2222-222222222222'
const CUIABA = 'America/Cuiaba'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: CUIABA }
const PARCEIRA = { id: OUTRA, display_name: 'Renata', is_owner: false, iana_tz: 'Europe/Lisbon' }

/** 04/08/2026 às 14:00 em Cuiabá (UTC-4, sem horário de verão). */
const INSTANTE = '2026-08-04T18:00:00.000Z'
const FICHA = fichaDoAvisoDoGoogle(PROFESSORA, INSTANTE)
/** Compromisso pessoal das 14:15 às 15:00 de Cuiabá: cruza o horário das 14:00. */
const COMPROMISSO = { startUtc: '2026-08-04T18:15:00.000Z', endUtc: '2026-08-04T19:00:00.000Z' }

let pote: PoteDeCookies

;(window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  mock.respostas = {
    class_instances: { data: [] },
    teachers: { data: [DONA, PARCEIRA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
    teacher_availability_exceptions: { data: [] },
  }
  mock.rpcs = []
  mock.respostaRpc = {}
  mock.google = { status: 'ok', blocks: [] }
  mock.semChaveDoServidor = false
  mock.leiturasDoGoogle = []
  mock.submits = []
  mock.voltas = []
})
afterEach(() => {
  vi.useRealTimers()
})

/** O formulário de publicar, como o painel `?novo=horario` o envia. */
function formDePublicar(over: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('teacher_id', PROFESSORA)
  fd.set('local_date', '2026-08-04')
  fd.set('local_time', '14:00')
  fd.set('back', '/admin/agenda')
  fd.set('back_erro', '/admin/agenda?novo=horario')
  for (const [k, v] of Object.entries(over)) fd.set(k, v)
  return fd
}

/** Roda uma action REAL e devolve a URL do redirect, já decodificada. */
async function rodar(
  fd: FormData,
  acao: (fd: FormData) => Promise<void> = publishWindowAction,
): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return decodeURIComponent(e.url)
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

const publicou = () => mock.rpcs.some(([fn]) => fn === 'publish_reschedule_window')

function rascunhoNoPote(): { chave: string; campos: Record<string, string> } | null {
  const cru = pote.get(RASCUNHO_COOKIE)?.value
  return cru ? JSON.parse(cru) : null
}

function frase(): string {
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  if (!cru) throw new Error('a action não gravou recado nenhum no cookie da seção')
  return (JSON.parse(cru) as { mensagem: string }).mensagem
}

interface ElementoDaArvore {
  type: unknown
  props: { children?: unknown } & Record<string, unknown>
}
function* percorrer(no: unknown): Generator<ElementoDaArvore> {
  if (no == null || typeof no !== 'object') return
  if (Array.isArray(no)) {
    for (const filho of no) yield* percorrer(filho)
    return
  }
  if (!('props' in no) || !('type' in no)) return
  const el = no as ElementoDaArvore
  yield el
  yield* percorrer(el.props.children)
}

/** A query de uma URL de redirect, no formato de `searchParams` da página. */
function queryDe(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://teste.invalid').searchParams)
}

let container: HTMLDivElement | undefined
let root: Root | undefined

async function montar(no: ReactNode): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(no)
  })
  return el
}

afterEach(async () => {
  if (root) {
    const r = root
    root = undefined
    await act(async () => r.unmount())
  }
  container?.remove()
  container = undefined
  document.body.innerHTML = ''
})

/** O bloco do aviso na tela. */
const avisoNaTela = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-aviso="google-ao-publicar"]')

/** Clica num botão de envio do formulário, como o navegador faria. */
async function clicar(botao: HTMLButtonElement) {
  await act(async () => {
    botao.click()
  })
}

const botoes = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].map((b) =>
    (b.textContent ?? '').trim(),
  )

/* ========================================================================== */
/* 1. A PUBLICAÇÃO PARA E PERGUNTA                                             */
/* ========================================================================== */

describe('#190 · compromisso do Google no horário: a publicação para antes da RPC', () => {
  it('nada é publicado, e a dona volta ao MESMO formulário com o aviso guardado', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    const url = await rodar(formDePublicar())

    expect(publicou(), 'publicou sem perguntar').toBe(false)
    expect(url, 'o painel fechou em vez de mostrar o aviso').toContain('novo=horario')
    // o que ela escolheu continua lá, e o aviso é o DESTE horário
    expect(rascunhoNoPote()).toEqual({
      chave: chaveDoPainel('horario'),
      campos: {
        teacher_id: PROFESSORA,
        local_date: '2026-08-04',
        local_time: '14:00',
        [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA,
      },
    })
    // o recado diz que nada saiu, em vermelho (não é sucesso)
    expect(frase()).toContain('Nada foi publicado ainda')
    expect(frase()).toContain('agenda do Google')
    expect(tomDoAviso(frase())).toBe('erro')
    // nada do que ela digitou nem o aviso viajam no endereço
    expect(url).not.toContain(CAMPO_DO_AVISO_DO_GOOGLE)
    expect(url).not.toContain(PROFESSORA)
  })

  it('a leitura é a do PORTAL: `googleBusyForTeacher`, da professora e a partir do instante', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar())
    expect(mock.leiturasDoGoogle).toHaveLength(1)
    const [quem, intervalo] = mock.leiturasDoGoogle[0]
    expect(quem).toBe(PROFESSORA)
    expect(intervalo.fromUtcISO).toBe(INSTANTE)
    // o alcance é o teto da duração de uma aula (8 horas): nenhuma medida passa disso
    expect(intervalo.toUtcISO).toBe('2026-08-05T02:00:00.000Z')
  })

  it('o campo do aviso está na porta de publicar (é a tabela do servidor que o guarda)', () => {
    expect(CAMPOS_DA_PORTA.publicar).toContain(CAMPO_DO_AVISO_DO_GOOGLE)
  })
})

/* ========================================================================== */
/* 2. PUBLICAR MESMO ASSIM                                                     */
/* ========================================================================== */

describe('#190 · "Publicar mesmo assim" publica', () => {
  it('com a ficha do aviso, a RPC é chamada como sempre e o Google não é lido de novo', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    const url = await rodar(formDePublicar({ [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }))

    const chamada = mock.rpcs.find(([fn]) => fn === 'publish_reschedule_window')
    expect(chamada, 'a confirmação não publicou').toBeDefined()
    expect(chamada![1]).toEqual({
      p_teacher: PROFESSORA,
      p_starts_at_utc: INSTANTE,
      p_iana_tz: CUIABA,
    })
    expect(mock.leiturasDoGoogle, 'perguntou de novo depois de a dona confirmar').toHaveLength(0)
    expect(url, 'o painel continuou aberto depois de publicar').not.toContain('novo=')
    // a frase de sucesso não promete o que o aviso acabou de negar
    expect(tomDoAviso(frase())).toBe('sucesso')
    expect(frase()).toContain('Horário publicado')
    expect(frase()).toContain('a aluna não vai ver este horário')
    expect(frase()).not.toContain('já podem remarcar')
    // ato concluído não deixa o aviso para trás
    expect(pote.get(RASCUNHO_COOKIE)).toBeUndefined()
  })

  it('se o banco recusar depois da confirmação, o formulário volta ainda no aviso DESTE horário', async () => {
    mock.respostaRpc.publish_reschedule_window = { error: { message: 'recusa qualquer do banco' } }
    await rodar(formDePublicar({ [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }))
    expect(rascunhoNoPote()?.campos[CAMPO_DO_AVISO_DO_GOOGLE]).toBe(FICHA)
    expect(tomDoAviso(frase())).toBe('erro')
  })
})

/* ========================================================================== */
/* 3 e 4. SEM COMPROMISSO, SEM GOOGLE, GOOGLE FORA DO AR                       */
/* ========================================================================== */

describe('#190 · sem o que avisar, a publicação acontece direto', () => {
  const FRASE_DE_SEMPRE = 'Horário publicado — os alunos da professora já podem remarcar para ele.'

  it('sem compromisso no Google: publica direto, com a frase de sempre', async () => {
    mock.google = { status: 'ok', blocks: [] }
    const url = await rodar(formDePublicar())
    expect(publicou()).toBe(true)
    expect(url).not.toContain('novo=')
    expect(frase()).toBe(FRASE_DE_SEMPRE)
    expect(pote.get(RASCUNHO_COOKIE)).toBeUndefined()
    // sem compromisso por perto, nem a medida do horário é lida
    expect(mock.rpcs.map(([fn]) => fn)).toEqual(['publish_reschedule_window'])
  })

  for (const [nome, estado] of [
    ['professora sem Google conectado', { status: 'desconectada' }],
    ['Google fora do ar', { status: 'indisponivel' }],
    ['leitura do Google que estoura', new Error('rede caiu')],
  ] as const) {
    it(`${nome}: publica como hoje, sem aviso e sem afirmar que o horário está livre`, async () => {
      mock.google = estado as Ocupado | Error
      const url = await rodar(formDePublicar())
      expect(publicou(), 'o Google fora do ar travou a agenda').toBe(true)
      expect(url).not.toContain('novo=')
      expect(pote.get(RASCUNHO_COOKIE), 'guardou aviso sem ter conferido').toBeUndefined()
      expect(frase()).toBe(FRASE_DE_SEMPRE)
      expect(frase().toLowerCase()).not.toContain('livre')
      expect(frase()).not.toContain('Google')
    })
  }
})

/* ========================================================================== */
/* 5. A CONFIRMAÇÃO VALE SÓ PARA O HORÁRIO AVISADO                              */
/* ========================================================================== */

describe('#190 · a confirmação não serve para outro horário', () => {
  it('trocou a hora depois do aviso: o Google é conferido de novo e nada é publicado', async () => {
    // compromisso das 15:00 às 16:00 de Cuiabá; a confirmação era das 14:00
    mock.google = {
      status: 'ok',
      blocks: [{ startUtc: '2026-08-04T19:00:00.000Z', endUtc: '2026-08-04T20:00:00.000Z' }],
    }
    await rodar(formDePublicar({ local_time: '15:00', [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }))
    expect(mock.leiturasDoGoogle).toHaveLength(1)
    expect(publicou(), 'a confirmação das 14:00 publicou as 15:00').toBe(false)
    expect(rascunhoNoPote()?.campos[CAMPO_DO_AVISO_DO_GOOGLE]).toBe(
      fichaDoAvisoDoGoogle(PROFESSORA, '2026-08-04T19:00:00.000Z'),
    )
  })

  it('trocou a professora depois do aviso: confere a agenda da outra', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar({ teacher_id: OUTRA, [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }))
    expect(mock.leiturasDoGoogle.map(([quem]) => quem)).toEqual([OUTRA])
    expect(publicou()).toBe(false)
  })

  it('confirmação forjada com texto qualquer não pula o aviso', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar({ [CAMPO_DO_AVISO_DO_GOOGLE]: '1' }))
    expect(publicou()).toBe(false)
  })

  it('recusa por outro motivo não guarda a confirmação de outro horário no rascunho', async () => {
    // a hora nova cai num bloqueio: a recusa é a do bloqueio, e o formulário não
    // pode voltar mostrando o aviso do Google de um horário que já não é o dele
    mock.respostas.teacher_availability_exceptions = {
      data: [{ local_snapshot: `2026-08-04 → 2026-08-04 ${CUIABA}` }],
    }
    await rodar(formDePublicar({ local_time: '15:00', [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }))
    expect(publicou()).toBe(false)
    expect(frase()).toContain('dentro de um bloqueio da professora')
    expect(rascunhoNoPote()?.campos).toEqual({
      teacher_id: PROFESSORA,
      local_date: '2026-08-04',
      local_time: '15:00',
    })
  })
})

/* ========================================================================== */
/* 6. A MEDIDA DO HORÁRIO ABERTO                                               */
/* ========================================================================== */

describe('#190 · o tamanho do horário é a medida do banco, com bordas abertas', () => {
  /** compromisso que começa 50 minutos depois do horário publicado */
  const DEPOIS = { startUtc: '2026-08-04T18:50:00.000Z', endUtc: '2026-08-04T19:30:00.000Z' }

  it('medida de 60 minutos: compromisso que começa aos 50 cruza, e a publicação para', async () => {
    mock.google = { status: 'ok', blocks: [DEPOIS] }
    mock.respostaRpc.teacher_window_span_min = { data: 60 }
    await rodar(formDePublicar())
    expect(mock.rpcs[0]).toEqual(['teacher_window_span_min', { p_teacher: PROFESSORA }])
    expect(publicou()).toBe(false)
  })

  it('medida de 30 minutos: o mesmo compromisso não cruza, e publica direto', async () => {
    mock.google = { status: 'ok', blocks: [DEPOIS] }
    mock.respostaRpc.teacher_window_span_min = { data: 30 }
    await rodar(formDePublicar())
    expect(publicou()).toBe(true)
    expect(pote.get(RASCUNHO_COOKIE)).toBeUndefined()
  })

  it('medida de 90 minutos: compromisso que começa uma hora depois ainda cruza', async () => {
    // além dos 45 minutos presumidos: só a medida do banco e o alcance de 8
    // horas da leitura explicam este aviso
    mock.google = {
      status: 'ok',
      blocks: [{ startUtc: '2026-08-04T19:00:00.000Z', endUtc: '2026-08-04T19:45:00.000Z' }],
    }
    mock.respostaRpc.teacher_window_span_min = { data: 90 }
    await rodar(formDePublicar())
    expect(publicou()).toBe(false)
    expect(rascunhoNoPote()?.campos[CAMPO_DO_AVISO_DO_GOOGLE]).toBe(FICHA)
  })

  it('sem medida no banco (ou leitura que falha): valem 45 minutos presumidos', async () => {
    mock.google = { status: 'ok', blocks: [DEPOIS] }
    mock.respostaRpc.teacher_window_span_min = { data: null, error: { message: 'timeout' } }
    await rodar(formDePublicar())
    expect(publicou(), 'compromisso aos 50 minutos cruzou uma medida de 45').toBe(true)

    mock.rpcs = []
    mock.google = {
      status: 'ok',
      blocks: [{ startUtc: '2026-08-04T18:40:00.000Z', endUtc: '2026-08-04T19:30:00.000Z' }],
    }
    await rodar(formDePublicar())
    expect(publicou(), 'compromisso aos 40 minutos não cruzou a medida de 45').toBe(false)
  })

  it('compromisso que começa exatamente no fim da medida não cruza', async () => {
    mock.google = {
      status: 'ok',
      blocks: [{ startUtc: '2026-08-04T19:00:00.000Z', endUtc: '2026-08-04T20:00:00.000Z' }],
    }
    mock.respostaRpc.teacher_window_span_min = { data: 60 }
    await rodar(formDePublicar())
    expect(publicou()).toBe(true)
  })
})

/* ========================================================================== */
/* 7. AS DUAS TELAS                                                            */
/* ========================================================================== */

/** O texto de um nó da árvore do servidor (só os filhos em texto). */
const textoDe = (el: ElementoDaArvore) => [el.props.children].flat().join('')

describe('#190 · o painel "Horário aberto" mostra o aviso com as duas saídas', () => {
  it('depois da parada, o painel troca os campos e o botão pelo horário avisado e pelo aviso', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    const url = await rodar(formDePublicar())

    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve(queryDe(url)) })
    const els = [...percorrer(arvore)]
    const aviso = els.find((el) => el.type === AvisoDoGoogleAoPublicar)
    expect(aviso, 'o painel reabriu sem o aviso').toBeDefined()
    expect(aviso!.props.ficha).toBe(FICHA)

    // o horário avisado fica ESCRITO, e travado em campos ocultos: "neste
    // horário" não pode conviver com um campo que a dona já trocou
    const form = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((x) => x.type === AvisoDoGoogleAoPublicar),
    )!
    const doForm = [...percorrer(form)]
    const ocultos = Object.fromEntries(
      doForm
        .filter((el) => el.type === 'input' && el.props.type === 'hidden')
        .map((el) => [el.props.name, el.props.value]),
    )
    expect(ocultos).toMatchObject({
      teacher_id: PROFESSORA,
      local_date: '2026-08-04',
      local_time: '14:00',
      back: '/admin/agenda',
      back_erro: '/admin/agenda?novo=horario',
    })
    expect(doForm.filter((el) => el.type === 'select')).toHaveLength(0)
    expect(doForm.map(textoDe)).toContain('Teacher Vicky · 04/08/2026 às 14:00 (Cuiabá)')
    // o botão comum saiu: publicar agora é uma decisão declarada
    expect(doForm.filter((el) => el.type === 'button')).toHaveLength(0)
  })

  it('sem parada nenhuma, o painel mostra os campos e só o botão de sempre', async () => {
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ novo: 'horario' }) })
    const els = [...percorrer(arvore)]
    expect(els.find((el) => el.type === AvisoDoGoogleAoPublicar)).toBeUndefined()
    expect(els.filter((el) => el.type === 'select' && el.props.name === 'teacher_id')).toHaveLength(1)
    const comuns = els.filter((el) => el.type === 'button' && textoDe(el) === 'Publicar horário')
    expect(comuns).toHaveLength(1)
  })

  it('aviso guardado para OUTRO painel não aparece neste', async () => {
    // o rascunho tem uma gaveta só, com chave: o aviso do horário aberto não
    // pode vazar para o painel da avulsa
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar())
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ novo: 'avulsa' }) })
    expect([...percorrer(arvore)].find((el) => el.type === AvisoDoGoogleAoPublicar)).toBeUndefined()
  })
})

describe('#190 · a peça do aviso: a frase aprovada e os dois envios', () => {
  /** A peça dentro de um formulário como o do painel no estado de aviso. */
  const noFormulario = () =>
    montar(
      h(
        'form',
        { action: publicarEspiao },
        h('input', { type: 'hidden', name: 'teacher_id', defaultValue: PROFESSORA }),
        h('input', { type: 'hidden', name: 'local_date', defaultValue: '2026-08-04' }),
        h('input', { type: 'hidden', name: 'local_time', defaultValue: '14:00' }),
        h(AvisoDoGoogleAoPublicar, { ficha: FICHA }),
      ),
    )

  it('mostra a frase da issue, nomeando o grupo dos dois botões', async () => {
    const c = await noFormulario()
    const aviso = avisoNaTela(c)!
    expect(AVISO_DO_GOOGLE_AO_PUBLICAR).toBe(
      'A professora tem um compromisso na agenda do Google neste horário. Enquanto ele existir, a aluna não vai ver este horário.',
    )
    expect(aviso.getAttribute('role')).toBe('group')
    const frase = c.ownerDocument.getElementById(aviso.getAttribute('aria-labelledby')!)!
    expect(frase.textContent).toBe(AVISO_DO_GOOGLE_AO_PUBLICAR)
    // DADO no piso da régua: nunca texto miúdo nem apagado
    expect(frase.className).toContain('text-sm')
    expect(frase.className).toContain('text-ink-900')
    expect(botoes(c)).toEqual([PUBLICAR_MESMO_ASSIM, 'Voltar'])
  })

  it('"Publicar mesmo assim" envia para a publicação, com a ficha do aviso', async () => {
    const c = await noFormulario()
    const [confirmar] = c.querySelectorAll<HTMLButtonElement>('button[type="submit"]')
    expect(confirmar.name).toBe(CAMPO_DO_AVISO_DO_GOOGLE)
    expect(confirmar.value).toBe(FICHA)
    await clicar(confirmar)
    expect(mock.voltas).toHaveLength(0)
    expect(mock.submits).toHaveLength(1)
    expect(Object.fromEntries(mock.submits[0])).toEqual({
      teacher_id: PROFESSORA,
      local_date: '2026-08-04',
      local_time: '14:00',
      [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA,
    })
  })

  it('"Voltar" envia para a action de voltar, SEM a ficha', async () => {
    const c = await noFormulario()
    const voltar = [...c.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].at(-1)!
    expect(voltar.textContent?.trim()).toBe('Voltar')
    expect(voltar.formNoValidate, 'voltar esbarraria em campo obrigatório').toBe(true)
    await clicar(voltar)
    expect(mock.submits, '"Voltar" publicou').toHaveLength(0)
    expect(mock.voltas).toHaveLength(1)
    expect(mock.voltas[0].get(CAMPO_DO_AVISO_DO_GOOGLE)).toBeNull()
    expect(mock.voltas[0].get('local_time')).toBe('14:00')
  })
})

describe('#190 · o balão do slot vazio mostra o mesmo aviso', () => {
  function dados(over: Partial<DadosDoSlot> = {}): DadosDoSlot {
    return {
      self: '/admin/agenda',
      professoras: [
        { id: PROFESSORA, nome: 'Teacher Vicky', ianaTz: CUIABA, cidade: 'Cuiabá' },
        { id: OUTRA, nome: 'Renata', ianaTz: 'Europe/Lisbon', cidade: 'Lisboa' },
      ],
      professoraFiltrada: null,
      contratos: [],
      digitado: {},
      slotDoErro: null,
      intencaoDoErro: null,
      ...over,
    }
  }

  const balao = (d: DadosDoSlot) =>
    montar(
      h(ProvedorDoSlot, {
        dados: d,
        children: h(IntencoesDoSlot, {
          iso: '2026-08-04',
          hhmm: '14:00',
          titulo: 'ter, 04/08',
          instanteUtc: INSTANTE,
        }),
      }),
    )

  it('a parada reabre o balão DAQUELA meia-hora com o aviso e as duas saídas', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    const url = await rodar(
      formDePublicar({ back_erro: '/admin/agenda?slot=2026-08-04T14:00&si=horario' }),
    )
    expect(url).toContain('slot=2026-08-04T14:00')
    expect(url).toContain('si=horario')
    const rascunho = rascunhoNoPote()!
    expect(rascunho.chave).toBe(chaveDoBalao('2026-08-04T14:00', 'horario'))

    const c = await balao(
      dados({
        slotDoErro: '2026-08-04T14:00',
        intencaoDoErro: 'horario',
        digitado: rascunho.campos,
      }),
    )
    expect(avisoNaTela(c)?.textContent).toContain(AVISO_DO_GOOGLE_AO_PUBLICAR)
    expect(botoes(c)).toEqual([PUBLICAR_MESMO_ASSIM, 'Voltar'])

    // "Publicar mesmo assim" no balão leva a ficha e o horário do slot
    await clicar(c.querySelector<HTMLButtonElement>('button[type="submit"]')!)
    expect(mock.submits).toHaveLength(1)
    expect(mock.submits[0].get(CAMPO_DO_AVISO_DO_GOOGLE)).toBe(FICHA)
    expect(mock.submits[0].get('teacher_id')).toBe(PROFESSORA)
    expect(mock.submits[0].get('local_date')).toBe('2026-08-04')
    expect(mock.submits[0].get('local_time')).toBe('14:00')
    expect(mock.submits[0].get('back_erro')).toBe('/admin/agenda?slot=2026-08-04T14:00&si=horario')

    // trocar a professora desfaz o aviso: ele era da agenda da outra
    const seletor = c.querySelector<HTMLSelectElement>('select[name="teacher_id"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(seletor, OUTRA)
      seletor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(avisoNaTela(c)).toBeNull()
    expect(botoes(c)).toEqual(['Publicar horário'])
  })

  it('balão sem parada: só o botão de sempre', async () => {
    const c = await balao(
      dados({ slotDoErro: '2026-08-04T14:00', intencaoDoErro: 'horario', digitado: {} }),
    )
    expect(avisoNaTela(c)).toBeNull()
    expect(botoes(c)).toEqual(['Publicar horário'])
  })
})

/* ========================================================================== */
/* 8. VOLTAR DESFAZ O AVISO                                                    */
/* ========================================================================== */

describe('#190 · "Voltar" não publica e devolve o formulário editável', () => {
  it('o aviso sai do rascunho, o que ela escolheu fica, e o recado da parada não repinta', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar())
    expect(pote.get(cookieDoRecado('agenda'))).toBeDefined()

    // o envio do "Voltar": os campos do formulário, sem a ficha (o botão dela não foi o clicado)
    mock.rpcs = []
    const url = await rodar(formDePublicar(), voltarDoAvisoDoGoogleAction)
    expect(mock.rpcs, '"Voltar" chamou o banco').toHaveLength(0)
    expect(url, 'o painel fechou em vez de voltar ao formulário').toContain('novo=horario')
    expect(rascunhoNoPote()).toEqual({
      chave: chaveDoPainel('horario'),
      campos: { teacher_id: PROFESSORA, local_date: '2026-08-04', local_time: '14:00' },
    })
    expect(pote.get(cookieDoRecado('agenda')), 'o "Nada foi publicado" repintaria').toBeUndefined()

    // e a tela reabre editável, com o botão de sempre
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve(queryDe(url)) })
    const els = [...percorrer(arvore)]
    expect(els.find((el) => el.type === AvisoDoGoogleAoPublicar)).toBeUndefined()
    const seletor = els.find((el) => el.type === 'select' && el.props.name === 'teacher_id')!
    expect(seletor.props.defaultValue).toBe(PROFESSORA)
  })

  it('ficha que chegue no envio do "Voltar" não volta para o rascunho', async () => {
    await rodar(formDePublicar({ [CAMPO_DO_AVISO_DO_GOOGLE]: FICHA }), voltarDoAvisoDoGoogleAction)
    expect(rascunhoNoPote()?.campos[CAMPO_DO_AVISO_DO_GOOGLE]).toBeUndefined()
    expect(publicou()).toBe(false)
  })

  it('no balão, "Voltar" reabre a mesma meia-hora sem o aviso', async () => {
    const url = await rodar(
      formDePublicar({ back_erro: '/admin/agenda?slot=2026-08-04T14:00&si=horario' }),
      voltarDoAvisoDoGoogleAction,
    )
    expect(url).toContain('slot=2026-08-04T14:00')
    expect(url).toContain('si=horario')
    expect(rascunhoNoPote()?.chave).toBe(chaveDoBalao('2026-08-04T14:00', 'horario'))
    expect(rascunhoNoPote()?.campos[CAMPO_DO_AVISO_DO_GOOGLE]).toBeUndefined()
  })
})

/* ========================================================================== */
/* 9. PUBLICAR NÃO FICA REFÉM DO GOOGLE NEM DA CHAVE DO SERVIDOR               */
/* ========================================================================== */

describe('#190 · a conferência do Google não trava a publicação', () => {
  it('leitura que não responde dentro do teto: segue sem conferir', async () => {
    mock.google = 'pendura'
    const cliente = { rpc: async () => ({ data: 60, error: null }) }
    const veredito = await compromissoDoGoogleAoPublicar(
      {} as never,
      cliente as never,
      PROFESSORA,
      INSTANTE,
      20, // o teto, em milissegundos (em produção: 4 s)
    )
    expect(veredito).toBe('nao_conferido')
  })

  it('leitura que responde dentro do teto vale normalmente', async () => {
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    const cliente = { rpc: async () => ({ data: 60, error: null }) }
    expect(
      await compromissoDoGoogleAoPublicar({} as never, cliente as never, PROFESSORA, INSTANTE, 20),
    ).toBe('ocupado')
  })

  it('sem a chave do servidor, a dona publica como antes (a conferência é que é pulada)', async () => {
    mock.semChaveDoServidor = true
    mock.google = { status: 'ok', blocks: [COMPROMISSO] }
    await rodar(formDePublicar())
    expect(publicou(), 'a falta da chave do servidor impediu a publicação').toBe(true)
    expect(mock.leiturasDoGoogle).toHaveLength(0)
  })
})
