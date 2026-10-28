// @vitest-environment jsdom
//
// PORTÃO DE DEPLOY DA ONDA DA AGENDA — 29/07/2026.
//
// Duas revisões independentes auditaram a árvore inteira como portão de deploy
// e responderam NÃO. Este arquivo é a prova dos bloqueadores que dependem de
// código do app (o que é de BANCO está em `f7-cadastro-lgpd`/`auth`):
//
//   1. o lote "Todas aconteceram" prometia N e fazia menos, dizendo que deu
//      certo — a tela agora conta e envia só o que pode concluir, diz quantas
//      ficam de fora, e o desfecho declara o número REAL;
//   3. a QUARTA aparição do toque fantasma — fundo PROIBITIVO
//      (bloqueio/ocupada) deixava o toque descer para o botão de publicar; e o
//      primitivo de cobertura errava nos dois sentidos em sobreposição parcial;
//   4/6. falha no meio do caminho apagava escolhas que mexem em DINHEIRO
//      (cortesia/furar/motivo do Remarcar, tratamento do Período) e o painel de
//      criação fechava levando junto o que a dona tinha digitado.
//
// Mais os médios da mesma rodada: piso de alvo de 24px, hover só em ponteiro
// fino, nome acessível do select do slot e o popover que nascia sob a barra do
// polegar.
//
// Padrão da casa (a1/a3): cliente Supabase falso que GRAVA as chamadas, relógio
// congelado, e o que se cobra é COMPORTAMENTO — a árvore real da página, a URL
// real do redirect, a geometria real do DOM. Nada de varredura de fonte fingindo
// prova.
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { cookieDoRecado } from '@/lib/kit/recado'
import {
  CAMPOS_DA_PORTA,
  chaveDoDestino,
  chavesDaTela,
  geometriaCanonica,
  lerDaQuery,
} from '@/lib/admin/transporte-da-agenda'
import {
  CHAVE_DO_PERIODO,
  chaveDoPainel,
  chaveDoRemarcar,
  RASCUNHO_COOKIE,
} from '@/lib/admin/rascunho-do-formulario'
import {
  CamposDaAvulsa,
  CamposDaExperimental,
} from '@/components/admin/agenda/campos-de-aula'

import { Calendario, type CalEvent } from '@/components/kit/calendario'
import { ProvedorDoSlot, ROTULO } from '@/components/admin/agenda/IntencoesDoSlot'
import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ========================================================================== */
/* Cliente Supabase falso                                                      */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
  count?: number
}

/** Cadeia permissiva: qualquer método de filtro devolve `this` e é GRAVADO. */
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
  // ── A FORMA DA RESPOSTA SEGUE A DO POSTGREST (A7) ─────────────────────────
  // O dublê devolvia o MESMO `data` para qualquer consulta à tabela, e isso
  // bastava enquanto cada tabela era lida de um jeito só. Deixou de bastar
  // quando a tela de Remarcar passou a ler `class_instances` duas vezes: uma
  // por `maybeSingle` (a aula, um objeto) e outra em LISTA (as aulas que ocupam
  // a agenda da professora, dentro de `availableSlots`). O real distingue os
  // dois; o dublê passou a distinguir também — senão o teste morre num
  // `.map is not a function` que não existe em produção.
  private singular = false
  single() { this.singular = true; return this.marca('single', []) }
  maybeSingle() { this.singular = true; return this.marca('maybeSingle', []) }
  then<A, B>(ok: (v: Resposta) => A, falha?: (e: unknown) => B) {
    const bruto = this.resposta.data ?? null
    return Promise.resolve({
      data: this.singular ? bruto : Array.isArray(bruto) ? bruto : [],
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
  /** resposta POR FUNÇÃO (o padrão do a5): a tela de Remarcar chama duas. */
  respostasRpc: {} as Record<string, Resposta>,
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
      const r = mock.respostasRpc[fn] ?? mock.respostaRpc
      return { data: r.data ?? null, error: r.error ?? null }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))
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

const { cookies } = await import('next/headers')

/** O pote de cookies dublê: as telas da agenda leem o RASCUNHO de um cookie
 *  `httpOnly` (A4/grave 5 — o que a dona digita não passa mais pela URL). */
let pote: PoteDeCookies

/**
 * A FRASE DA ACTION — no cookie da seção, nunca mais na URL (A7). Todas as
 * actions da Agenda passaram ao transporte único; cobrar a frase na URL passaria
 * a ser cobrar o defeito.
 */
function frase(): string {
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  if (!cru) throw new Error('a action não gravou recado nenhum no cookie da seção')
  return (JSON.parse(cru) as { mensagem: string }).mensagem
}
beforeEach(() => {
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
})

const { getAgenda } = await import('@/data/admin/agenda')
const {
  adminBookWindowAction,
  adminRescheduleNewTimeAction,
  aplicarOpcoesDaRemarcacaoAction,
  completeAllPendingAction,
  createSingleClassAction,
  periodTreatmentAction,
} = await import('@/app/admin/agenda/actions')
const { default: AgendaPage } = await import('@/app/admin/agenda/page')
const { default: PeriodoPage } = await import('@/app/admin/agenda/periodo/page')
const { default: RemarcarPage } = await import('@/app/admin/agenda/remarcar/[instance]/page')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }
const CUIABA = 'America/Cuiaba'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá
  mock.respostas = {}
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
  mock.respostasRpc = {}
})
afterEach(() => {
  vi.useRealTimers()
})

/* ========================================================================== */
/* Ferramentas de árvore (o padrão do a3)                                      */
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

function textoDe(no: unknown): string {
  if (no == null || typeof no === 'boolean') return ''
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  if (Array.isArray(no)) return no.map(textoDe).join('')
  return ehElemento(no) ? textoDe(no.props.children) : ''
}

/**
 * O que o NAVEGADOR enviaria se a dona apenas reapertasse o botão do formulário
 * sem tocar em nada: hidden pelo `value`, campos e selects pelo valor inicial.
 */
function envioDoForm(form: ElementoDaArvore): FormData {
  const fd = new FormData()
  for (const el of percorrer(form)) {
    const nome = el.props.name
    if (typeof nome !== 'string') continue
    const valor =
      el.props.type === 'hidden' ? el.props.value : (el.props.defaultValue ?? el.props.value)
    if (typeof valor === 'string' || typeof valor === 'number') fd.set(nome, String(valor))
  }
  return fd
}

/** Roda a action e devolve a URL do redirect, já decodificada. */
async function rodar(acao: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return decodeURIComponent(e.url)
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

/** A query de uma URL de volta, como a página a receberia em `searchParams`. */
function queryDe(url: string): Record<string, string> {
  const p = new URLSearchParams(url.split('?')[1] ?? '')
  return Object.fromEntries(p.entries())
}

function form(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor)
  return fd
}

/* ========================================================================== */
/* 1. BLOQUEADOR 1 — o lote não promete o que não vai fazer                    */
/* ========================================================================== */

/** Uma aula crua do PostgREST; `apontada` liga o embed de apontamento. */
function aulaCrua(campos: {
  id: string
  inicio: string
  fim?: string | null
  apontada?: boolean
  aluno?: string
}) {
  return {
    id: campos.id,
    starts_at_utc: campos.inicio,
    ends_at_utc: campos.fim ?? null,
    state: 'scheduled',
    teacher_id: PROFESSORA,
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (fixture de aula de contrato)
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: {
      // A5/L2: o `id` do contrato entrou na projeção (o "duplicar" do popover).
      id: 'c-fixture',
      plan_name: 'Mensal',
      // A6/lote 2: o login e o número do perfil entraram na MESMA projeção —
      // é o que o diálogo destrutivo usa para as caixas de aviso nascerem
      // espelhando a entrega real.
      students: {
        id: 'a1',
        display_name: campos.aluno ?? 'Elisa',
        iana_tz: CUIABA,
        profile_id: 'p-a1',
        profiles: { whatsapp_e164: '+5565999990000' },
      },
      student_groups: null,
    },
    // o embed 1:1 que a camada de dados passou a pedir
    class_content_reports: campos.apontada ? { class_instance_id: campos.id } : null,
  }
}

function semear(aulas: unknown[], extras: Record<string, Resposta> = {}) {
  mock.respostas = {
    class_instances: { data: aulas },
    teachers: { data: [DONA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
    ...extras,
  }
}

/** Três pendências ontem: duas COM apontamento, uma sem. */
const PENDENCIAS_MISTAS = [
  aulaCrua({ id: 'p-1', inicio: '2026-07-27T18:00:00Z', fim: '2026-07-27T18:45:00Z', apontada: true, aluno: 'Elisa' }),
  aulaCrua({ id: 'p-2', inicio: '2026-07-27T19:00:00Z', fim: '2026-07-27T19:45:00Z', apontada: false, aluno: 'Bruno' }),
  aulaCrua({ id: 'p-3', inicio: '2026-07-27T20:00:00Z', fim: '2026-07-27T20:45:00Z', apontada: true, aluno: 'Clara' }),
]

describe('portão · a camada de dados sabe quem tem apontamento (sem N+1)', () => {
  it('temApontamento sai do EMBED da consulta de aulas, numa ida só ao banco', async () => {
    semear(PENDENCIAS_MISTAS)
    const agenda = await getAgenda({ visao: 'pendencias', comJanelas: false, professora: PROFESSORA })

    expect(agenda.pendencias.map((r) => [r.id, r.temApontamento])).toEqual([
      ['p-1', true],
      ['p-2', false],
      ['p-3', true],
    ])
    // a projeção pede o embed…
    const select = mock.chamadas.class_instances.find((c) => c[0] === 'select')![1] as string
    expect(select).toContain('class_content_reports(class_instance_id)')
    // …e NÃO existe consulta própria à tabela de apontamento (o N+1 que a
    // primeira ideia teria produzido: uma leitura por pendência)
    expect(mock.chamadas.class_content_reports).toBeUndefined()

    // A6/lote 2 · MESMA RÉGUA para a entregabilidade do aviso: ela viaja no
    // embed que já existe, e não numa leitura de `profiles` por aula. A fila de
    // pendências chega a dezenas de linhas, e latência aqui é latência que a
    // dona sente todo dia.
    expect(select).toContain('profiles!students_profile_id_fkey(whatsapp_e164)')
    expect(mock.chamadas.profiles).toBeUndefined()
    expect(agenda.pendencias.map((r) => [r.temLogin, r.temWhatsapp])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ])
  })
})

/** A confirmação do lote na árvore — a peça do kit (A7), não mais o `details`. */
function loteDaTela(els: ElementoDaArvore[]): ElementoDaArvore | undefined {
  return els.find(
    (el) => typeof el.props.rotulo === 'string' && String(el.props.rotulo).includes('Todas aconteceram'),
  )
}

/** O bloco das pendências, achado pela árvore real da página. */
async function telaDePendencias(prof = PROFESSORA) {
  const arvore: unknown = await AgendaPage({
    searchParams: Promise.resolve({ v: 'pendencias', prof }),
  })
  return [...percorrer(arvore)]
}

describe('portão · o botão do lote conta e envia SÓ o que pode concluir', () => {
  it('3 pendências, 2 apontadas: o rótulo diz (2) e o envio leva os 2 IDs', async () => {
    semear(PENDENCIAS_MISTAS)
    const els = await telaDePendencias()
    // A7: a moldura virou o AlertDialog do kit (`ConfirmarLote`) no lugar do
    // `<details data-popup>` do `ConfirmAction`. As props mudaram de nome; a
    // REGRA que este caso protege é exatamente a mesma.
    const confirmacao = loteDaTela(els)!
    expect(confirmacao, 'o botão do lote sumiu da tela').toBeDefined()

    // PROVA DA CONTAGEM: o rótulo é o número do que pode concluir, não o da fila
    expect(confirmacao.props.rotulo).toBe('✓ Todas aconteceram (2)')
    const values = confirmacao.props.campos as Record<string, string>
    expect(values.instance_ids).toBe('p-1,p-3')
    expect(values.instance_ids).not.toContain('p-2')

    // …e o aviso de confirmação diz, com todas as letras, quantas ficam de fora
    // e POR QUÊ (a dona não pode descobrir isso conferindo o extrato depois)
    expect(confirmacao.props.aviso).toContain('1 aula desta fila NÃO entra')
    expect(confirmacao.props.aviso).toContain('sem apontamento')

    // a fila continua mostrando as TRÊS (o pulo é do lote, não da tela)
    const textoDaTela = els.map((el) => textoDe(el.props.children)).join(' ')
    expect(textoDaTela).toContain('3 aulas sem registro')
  })

  it('PROVA DE MUTAÇÃO: sem nenhuma apontada o botão NÃO existe — no lugar, a explicação', async () => {
    semear([
      aulaCrua({ id: 'p-2', inicio: '2026-07-27T19:00:00Z', fim: '2026-07-27T19:45:00Z', apontada: false }),
    ])
    const els = await telaDePendencias()
    expect(
      loteDaTela(els),
      'o botão apareceu prometendo um lote que o banco recusaria inteiro',
    ).toBeUndefined()
    const texto = els.map((el) => textoDe(el.props.children)).join(' ')
    expect(texto).toContain('Nenhuma destas aulas pode ser registrada em lote')
    expect(texto).toContain('sem apontamento')
  })

  it('todas apontadas: o botão volta a contar a fila inteira e não fala de exceção', async () => {
    semear([
      aulaCrua({ id: 'p-1', inicio: '2026-07-27T18:00:00Z', fim: '2026-07-27T18:45:00Z', apontada: true }),
      aulaCrua({ id: 'p-3', inicio: '2026-07-27T20:00:00Z', fim: '2026-07-27T20:45:00Z', apontada: true }),
    ])
    const els = await telaDePendencias()
    const confirmacao = loteDaTela(els)!
    expect(confirmacao.props.rotulo).toBe('✓ Todas aconteceram (2)')
    expect(confirmacao.props.aviso).not.toContain('NÃO entra')
  })
})

describe('portão · o desfecho do lote declara o número REAL', () => {
  it('o banco concluiu MENOS do que foi enviado: recado conta as duas metades e sai VERMELHO', async () => {
    // A corrida que sobra: alguém apagou o apontamento entre o render e o
    // submit. A tela não tem como saber antes — o desfecho tem.
    mock.respostaRpc = { data: 1 }
    const url = await rodar(
      completeAllPendingAction,
      form({ teacher_id: PROFESSORA, instance_ids: 'p-1,p-3', back: '/admin/agenda?v=pendencias' }),
    )
    expect(url, 'a frase voltou para a barra de endereços (A7)').not.toContain('msg=')
    expect(frase()).toContain('1 aula registrada como realizada')
    expect(frase()).toContain('1 continua sem registro')
    expect(frase()).toContain('sem apontamento')
    expect(tomDoAviso(frase()), 'sucesso parcial não pode sair com o ✓ da casa').toBe('erro')
  })

  it('o banco concluiu TUDO: o ✓ verde continua existindo', async () => {
    mock.respostaRpc = { data: 2 }
    const url = await rodar(
      completeAllPendingAction,
      form({ teacher_id: PROFESSORA, instance_ids: 'p-1,p-3', back: '/admin/agenda?v=pendencias' }),
    )
    // …e o destino continua sendo a aba de onde ela veio, reconstruída pela
    // allowlist (A7) — nada além da geometria da tela sobrevive
    expect(url).toBe('/admin/agenda?v=pendencias')
    expect(frase()).toBe('2 aulas registradas como realizadas. ✓')
    expect(tomDoAviso(frase())).toBe('sucesso')
  })
})

/* ========================================================================== */
/* 2. BLOQUEADOR 3 — faixa proibitiva NUNCA abre o formulário de publicar      */
/* ========================================================================== */

let container: HTMLDivElement | undefined
let root: Root | undefined

async function montar(props: {
  events: CalEvent[]
  view: 'mes' | 'semana' | 'dia'
  anchor: string
  slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode
}): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(
      h(Calendario, {
        tz: CUIABA,
        todayISO: '2026-07-28',
        dayHref: (iso: string) => `/admin/agenda?v=dia&d=${iso}`,
        ...props,
      }),
    )
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

/**
 * HIT-TESTING de verdade (não "presença de classe"): quem RECEBE o toque na
 * altura `y` da coluna do dia.
 *
 * jsdom não faz layout, então a conta roda sobre a geometria DECLARADA — o
 * mesmo `style.top/height` que o navegador usaria para posicionar. Regras
 * modeladas: quem tem `pointer-events-none` não recebe; entre os que ocupam o
 * ponto, vence o ÚLTIMO da ordem de pintura (todos são irmãos absolutos no
 * mesmo contexto de empilhamento).
 */
function quemRecebeOToque(coluna: HTMLElement, y: number): HTMLElement | null {
  let alvo: HTMLElement | null = null
  for (const filho of [...coluna.children] as HTMLElement[]) {
    if (!filho.style.height) continue // linhas de hora não têm caixa
    if (filho.className.includes('pointer-events-none')) continue
    const topo = parseFloat(filho.style.top)
    const fim = topo + parseFloat(filho.style.height)
    if (y >= topo && y < fim) alvo = filho
  }
  return alvo
}

/** A coluna do dia (view 'dia' renderiza UMA TimeGrid). */
function colunaDoDia(c: HTMLDivElement): HTMLElement {
  const qualquer = c.querySelector<HTMLElement>('[title^="Criar às"], [title*="indisponível"]')
  if (!qualquer) throw new Error('nenhuma meia-hora renderizada')
  return qualquer.parentElement as HTMLElement
}

const MINI_FORM = (iso: string, hhmm: string) => h('p', null, `publicar ${iso} ${hhmm}`)

/** 10:00–11:00 em Cuiabá (UTC−4) no dia 29/07. */
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
/** disponibilidade da professora, 08:00–18:00 em Cuiabá */
const DISPONIVEL: CalEvent = {
  id: 'av-dia',
  startsAtUtc: '2026-07-29T12:00:00Z',
  endsAtUtc: '2026-07-29T22:00:00Z',
  title: 'disponível',
  color: 0,
  avail: true,
}

/** y (px) do início da meia-hora `hh:mm` na faixa default (7h–21h, 64px/hora). */
const yDoSlot = (hh: number, mm: 0 | 30) => ((hh - 7) * 60 + mm) * (64 / 60)

describe('portão · 4ª aparição do toque fantasma: proibição × slot de publicação', () => {
  it('o toque numa faixa PROIBITIVA não chega a nenhum gatilho de publicar (bloqueio e ocupada)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [DISPONIVEL, BLOQUEIO_10_11, OCUPADA_13_14],
      slotPopup: MINI_FORM,
    })
    const coluna = colunaDoDia(c)

    for (const [hora, motivo] of [
      [10, 'bloqueada — férias'],
      [13, 'ocupada (agenda pessoal)'],
    ] as const) {
      for (const minuto of [0, 30] as const) {
        const recebe = quemRecebeOToque(coluna, yDoSlot(hora, minuto) + 5)
        expect(recebe, `nada recebe o toque às ${hora}:${minuto}`).not.toBeNull()
        // NÃO é gatilho: nem botão, nem link — um retângulo inerte que diz o motivo
        expect(recebe!.tagName, `${hora}:${minuto}`).toBe('DIV')
        expect(recebe!.getAttribute('title')).toContain('indisponível')
        expect(recebe!.getAttribute('title')).toContain(motivo)
        expect(recebe!.querySelector('button')).toBeNull()
      }
    }
    // e nenhum gatilho de publicação sobrou DENTRO das faixas proibidas
    const gatilhos = [...c.querySelectorAll<HTMLElement>('button[title^="Criar às"]')].map((b) =>
      b.getAttribute('title'),
    )
    for (const proibido of ['Criar às 10:00', 'Criar às 10:30', 'Criar às 13:00', 'Criar às 13:30']) {
      expect(gatilhos, proibido).not.toContain(proibido)
    }
  })

  it('PROVA DE MUTAÇÃO (outro sentido): slot LIVRE — e sob mera disponibilidade — continua abrindo', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [DISPONIVEL, BLOQUEIO_10_11, OCUPADA_13_14],
      slotPopup: MINI_FORM,
    })
    const coluna = colunaDoDia(c)

    // 09:00 está DENTRO da disponibilidade (fundo informativo) e fora de
    // qualquer proibição: o toque tem de chegar ao gatilho de publicar.
    const recebe = quemRecebeOToque(coluna, yDoSlot(9, 0) + 5)
    expect(recebe!.tagName).toBe('BUTTON')
    expect(recebe!.getAttribute('title')).toBe('Criar às 09:00')

    // e o fim do bloqueio devolve a oferta na meia-hora seguinte
    const depois = quemRecebeOToque(coluna, yDoSlot(11, 0) + 5)
    expect(depois!.getAttribute('title')).toBe('Criar às 11:00')
  })

  it('a mesma régua vale no ramo de LINK (slotHref, sem popover)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [BLOQUEIO_10_11],
    })
    // sem slotPopup nem slotHref não há meia-hora nenhuma; com href, há
    const comLink = await montarComHref()
    const coluna = comLink.querySelector<HTMLElement>('a[title^="Publicar janela"]')!
      .parentElement as HTMLElement
    const recebe = quemRecebeOToque(coluna, yDoSlot(10, 0) + 5)
    expect(recebe!.tagName).toBe('DIV')
    expect(recebe!.getAttribute('title')).toContain('indisponível')
    expect(c).toBeDefined()
  })
})

/** Monta a grade no ramo de LINK (o outro consumidor de meia-hora). */
async function montarComHref(): Promise<HTMLDivElement> {
  if (root) {
    const r = root
    root = undefined
    await act(async () => r.unmount())
  }
  container?.remove()
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(
      h(Calendario, {
        tz: CUIABA,
        todayISO: '2026-07-28',
        dayHref: (iso: string) => `/admin/agenda?v=dia&d=${iso}`,
        view: 'dia',
        anchor: '2026-07-29',
        events: [BLOQUEIO_10_11],
        slotHref: (iso: string, hhmm: string) => `/admin/agenda?nd=${iso}&nt=${hhmm}`,
      }),
    )
  })
  return el
}

/* ========================================================================== */
/* 3. Achado 7 — cobertura por SOBREPOSIÇÃO REAL, não por zona de rótulo      */
/* ========================================================================== */

describe('portão · fundo interativo parcialmente coberto: o gatilho encolhe, não mente nem some', () => {
  /** ghost COM popup — o único fundo interativo que existe hoje. */
  const ghost = (inicioUtc: string, fimUtc: string): CalEvent => ({
    id: 'gh-pop',
    startsAtUtc: inicioUtc,
    endsAtUtc: fimUtc,
    title: 'Compromisso',
    color: 0,
    ghost: true,
    popup: h('p', null, 'detalhe'),
  })
  const bloqueio = (inicioUtc: string, fimUtc: string): CalEvent => ({
    id: 'bl',
    startsAtUtc: inicioUtc,
    endsAtUtc: fimUtc,
    title: 'bloqueada — férias',
    color: 0,
    blocked: true,
  })

  it('cobre o FIM (ghost 09:00–11:00 sob bloqueio 10:00–12:00): o gatilho vive só até as 10:00', async () => {
    // Antes: a zona de rótulo (09:00–09:20) não era tocada pelo bloqueio, o
    // gatilho ficava inteiro e o toque às 10:30 atravessava a hachura.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        ghost('2026-07-29T13:00:00Z', '2026-07-29T15:00:00Z'),
        bloqueio('2026-07-29T14:00:00Z', '2026-07-29T16:00:00Z'),
      ],
    })
    const gatilho = c.querySelector<HTMLElement>('button[title="Compromisso"]')
    expect(gatilho, 'o trecho visível 09:00–10:00 perdeu o gatilho').not.toBeNull()
    expect(parseFloat(gatilho!.style.top)).toBeCloseTo(yDoSlot(9, 0), 5)
    expect(parseFloat(gatilho!.style.height)).toBeCloseTo(64 - 2, 5) // 1h, não 2h

    const coluna = gatilho!.parentElement as HTMLElement
    // 10:30 está sob a hachura: o toque NÃO pode chegar ao ghost
    expect(quemRecebeOToque(coluna, yDoSlot(10, 30) + 5)).toBeNull()
  })

  it('cobre o COMEÇO (ghost 09:00–12:00 sob bloqueio 09:00–09:30): o gatilho vive de 09:30 às 12:00', async () => {
    // Antes: a zona de rótulo era coberta, o gatilho MORRIA inteiro e as 2h30
    // visíveis ficavam sem clique nenhum.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        ghost('2026-07-29T13:00:00Z', '2026-07-29T16:00:00Z'),
        bloqueio('2026-07-29T13:00:00Z', '2026-07-29T13:30:00Z'),
      ],
    })
    const gatilho = c.querySelector<HTMLElement>('button[title="Compromisso"]')
    expect(gatilho, 'o trecho visível 09:30–12:00 perdeu o gatilho inteiro').not.toBeNull()
    expect(parseFloat(gatilho!.style.top)).toBeCloseTo(yDoSlot(9, 30), 5)
    expect(parseFloat(gatilho!.style.height)).toBeCloseTo(2.5 * 64 - 2, 5)

    const coluna = gatilho!.parentElement as HTMLElement
    expect(quemRecebeOToque(coluna, yDoSlot(11, 0) + 5)).toBe(gatilho)
    expect(quemRecebeOToque(coluna, yDoSlot(9, 0) + 5)).toBeNull() // sob a hachura
  })

  it('cobertura TOTAL continua matando o gatilho (o caso da rodada 5 do A3)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        ghost('2026-07-29T13:00:00Z', '2026-07-29T14:00:00Z'),
        bloqueio('2026-07-29T12:00:00Z', '2026-07-29T16:00:00Z'),
      ],
    })
    expect(c.querySelector('button[title="Compromisso"]')).toBeNull()
    const bloco = c.querySelector<HTMLElement>('[title="Compromisso"]')!
    expect(bloco.tagName).toBe('DIV')
    expect(bloco.className).toContain('pointer-events-none')
  })
})

/* ========================================================================== */
/* 4. Médios da rodada: alvo de 24px, hover de ponteiro fino, nome acessível   */
/* ========================================================================== */

describe('portão · piso de alvo do elemento INTERATIVO é 24px', () => {
  it('aula de 15 min desenha 24px de alvo; o fundo passivo mantém a geometria verdadeira', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        {
          id: 'curta',
          startsAtUtc: '2026-07-29T13:00:00Z',
          endsAtUtc: '2026-07-29T13:15:00Z',
          title: 'Aula curta',
          color: 0,
          popup: h('p', null, 'x'),
        },
        {
          id: 'bl-curto',
          startsAtUtc: '2026-07-29T17:00:00Z',
          endsAtUtc: '2026-07-29T17:10:00Z',
          title: 'bloqueada — dentista',
          color: 0,
          blocked: true,
        },
      ],
    })
    const aula = c.querySelector<HTMLElement>('[title="Aula curta"]')!
    expect(parseFloat(aula.style.height)).toBe(24) // 15min = 16px − 2 → piso
    const fundo = c.querySelector<HTMLElement>('[title="bloqueada — dentista"]')!
    expect(parseFloat(fundo.style.height)).toBeCloseTo((10 / 60) * 64 - 2, 5) // ~8,7px, honesto
  })
})

describe('portão · o realce da meia-hora não gruda no Safari do iPhone', () => {
  it('o hover do slot está atrás de (hover:hover) and (pointer:fine); o estado ABERTO não', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [],
      slotPopup: MINI_FORM,
    })
    const realce = c.querySelector<HTMLElement>('button[title="Criar às 09:00"] span')!
    // A6/Lote 2: o `_` é a sintaxe do Tailwind para espaço em variante
    // arbitrária — a grafia antiga (sem `_`) gerava media query inválida e
    // derrubava o compilador CSS do `next dev`.
    expect(realce.className).toContain('[@media(hover:hover)_and_(pointer:fine)]:group-hover:flex')
    // …e NÃO existe um `group-hover:flex` solto (o que grudava no iOS): o único
    // group-hover da classe é o que está dentro da media query
    expect(realce.className).not.toMatch(/(^|\s)group-hover:flex/)
    expect(realce.className).toContain('group-data-[state=open]:flex')
  })
})

describe('portão · o select de professora do slot tem nome acessível', () => {
  // ANATOMIA NOVA (A4): o corpo do balão virou componente CLIENTE — o conteúdo
  // não é mais um `<form>` na árvore do servidor, e por isso este caso deixou
  // de poder ser lido por `percorrer`. O que ele cobra é o MESMO: sem filtro de
  // professora, o combo do slot tem nome acessível (era um combo anônimo para
  // leitor de tela). Agora pelo DOM real, que é onde o defeito aparecia.
  it('sem professora filtrada, o balão do slot nomeia o campo de professora', async () => {
    semear([])
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve({ v: 'dia' }) })
    const calendario = [...percorrer(arvore)].find((el) => typeof el.props.slotPopup === 'function')!
    const popup = (calendario.props.slotPopup as (i: string, h: string) => ReactNode)(
      '2026-07-29',
      '14:00',
    )
    const el = document.createElement('div')
    container = el
    document.body.appendChild(el)
    await act(async () => {
      root = createRoot(el)
      root.render(
        h(ProvedorDoSlot, {
          dados: {
            self: '/admin/agenda',
            professoras: [
              { id: PROFESSORA, nome: 'Teacher Vicky', ianaTz: CUIABA, cidade: 'Cuiabá' },
            ],
            professoraFiltrada: null,
            contratos: [],
            digitado: {},
            slotDoErro: null,
            intencaoDoErro: null,
          },
          children: popup,
        }),
      )
    })
    // a intenção que carrega o seletor compartilhado
    const abrir = [...el.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').startsWith(ROTULO.horario),
    )!
    await act(async () => abrir.click())
    const select = el.querySelector<HTMLSelectElement>('select[name="teacher_id"]')
    expect(select, 'o select da professora sumiu do balão').not.toBeNull()
    expect(select!.getAttribute('aria-label')!.length).toBeGreaterThan(3)
  })
})

/* ========================================================================== */
/* 5. BLOQUEADORES 4 e 6 — a volta de erro não apaga a decisão da dona        */
/* ========================================================================== */

describe('portão · Remarcar: cortesia/furar/motivo sobrevivem ao erro e valem no SEGUNDO envio', () => {
  /** A página do Remarcar com o que ela precisa ler — inclusive UM horário
   *  publicado, para existir o formulário de reserva na árvore. */
  function semearRemarcar() {
    mock.respostas = {
      class_instances: {
        data: {
          id: 'aula-1',
          starts_at_utc: '2026-07-30T18:00:00Z',
          ends_at_utc: '2026-07-30T18:45:00Z',
          state: 'scheduled',
          teacher_id: PROFESSORA,
          contract_id: 'c-1',
          contracts: {
            students: { id: 'a1', display_name: 'Elisa', iana_tz: CUIABA },
            student_groups: null,
          },
        },
      },
      teacher_public: { data: { id: PROFESSORA, display_name: 'Teacher Vicky' } },
      reschedule_windows: { data: [{ id: 'w-1', starts_at_utc: '2026-08-04T18:00:00Z', state: 'publicada' }] },
      audit_log: { data: null, count: 0 },
    }
    // A7: franquia e crédito passaram a vir do BANCO, numa leitura só
    // (`preview_reschedule_effect`) — as três contas em TypeScript morreram.
    mock.respostasRpc.preview_reschedule_effect = {
      data: [
        {
          efeito: 'franquia',
          franquia_restante: 2,
          saldo_creditos: 3,
          min_notice_hours: 24,
          validade_do_credito: null,
          limite_ts: '2026-07-29T18:00:00Z',
        },
      ],
    }
  }

  /**
   * A página com as opções aplicadas, e o form de reserva que ela desenha.
   *
   * A7: reservar deixou de ser um botão por horário na lista e passou a ter
   * PASSO DE REVISÃO (`?escolha=`), que é onde o saldo é re-exposto ao lado do
   * botão que gasta. Por isso o helper entra já escolhido — é lá que o
   * formulário de `window_id` existe.
   */
  async function paginaDoRemarcar(query: Record<string, string>) {
    semearRemarcar()
    const arvore: unknown = await RemarcarPage({
      params: Promise.resolve({ instance: 'aula-1' }),
      searchParams: Promise.resolve({ escolha: 'w-1', ...query }),
    })
    const els = [...percorrer(arvore)]
    const reserva = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'window_id'),
    )
    if (!reserva) throw new Error('o form de reservar horário publicado sumiu da página')
    return { els, reserva }
  }

  /** O formulário de OPÇÕES da página (cortesia · furar · motivo). */
  function opcoesDaPagina(els: ElementoDaArvore[]): ElementoDaArvore {
    const f = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((x) => x.props.name === 'motivo'),
    )
    if (!f) throw new Error('o form de opções da administração sumiu da página')
    return f
  }

  it('APLICAR as opções manda o motivo para o cookie e deixa só os booleanos na URL', async () => {
    // A4/rodada 2, GRAVE 6: o "Aplicar" era `<form method="get">` e publicava
    // "cirurgia"/"luto" na barra de endereços. Agora é Server Action.
    const { els } = await paginaDoRemarcar({})
    const fd = envioDoForm(opcoesDaPagina(els))
    fd.set('cortesia', '1')
    fd.set('furar', '1')
    fd.set('motivo', 'cirurgia da dona')

    const url = await rodar(aplicarOpcoesDaRemarcacaoAction, fd)
    // A7: o horário em revisão (`escolha`) viaja junto — reaplicar as opções não
    // pode desfazer a escolha do horário e mandar a dona reencontrá-lo.
    expect(url).toBe('/admin/agenda/remarcar/aula-1?cortesia=1&furar=1&escolha=w-1')
    expect(url, 'o motivo da cortesia foi para a barra de endereços').not.toContain('cirurgia')
    const guardado = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(guardado.chave).toBe(chaveDoRemarcar('aula-1'))
    expect(guardado.campos.motivo).toBe('cirurgia da dona')
  })

  it('conflito no 1º horário → volta com cortesia LIGADA; o 2º envio ainda é cortesia', async () => {
    // 1) a dona liga cortesia + furar + motivo pelo formulário REAL de opções
    //    (que hoje é Server Action — grave 6), e só depois reserva um horário
    //    publicado. O ENVIO sai da árvore real da página, então o `manter` que
    //    viaja é o que a página declara (tirá-lo reprova aqui).
    const { els: comOpcoes } = await paginaDoRemarcar({})
    const aplicar = envioDoForm(opcoesDaPagina(comOpcoes))
    aplicar.set('cortesia', '1')
    aplicar.set('furar', '1')
    aplicar.set('motivo', 'imprevisto nosso')
    const escolhas = queryDe(await rodar(aplicarOpcoesDaRemarcacaoAction, aplicar))
    const { reserva: primeiroEnvio } = await paginaDoRemarcar(escolhas)
    mock.respostaRpc = { data: null, error: { message: 'no_overlap: conflita' } }
    const url = await rodar(adminBookWindowAction, envioDoForm(primeiroEnvio))

    expect(url).toContain('/admin/agenda/remarcar/aula-1')
    const q = queryDe(url)
    expect(q.cortesia, 'a cortesia não sobreviveu à volta de erro').toBe('1')
    expect(q.furar).toBe('1')
    // A4/rodada 2, GRAVE 6 (LGPD): o MOTIVO saiu da barra de endereços. Ele é
    // texto livre sobre a vida de alguém ("cirurgia", "luto") e ficava no
    // histórico, no log de acesso e em qualquer captura de tela. Os dois
    // booleanos podem ficar (é deles que a página se remonta); o texto viaja no
    // cookie de rascunho, sob a chave DAQUELA aula.
    expect(q.motivo, 'o motivo da cortesia voltou para a URL').toBeUndefined()
    expect(url).not.toContain('imprevisto')
    const guardado = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(guardado.chave).toBe(chaveDoRemarcar('aula-1'))
    expect(guardado.campos.motivo).toBe('imprevisto nosso')

    // 2) a página REAL recebe essa query de volta (com o cookie ainda no pote)
    //    e RE-HIDRATA as escolhas
    const { els, reserva: segundoEnvio } = await paginaDoRemarcar(q)
    const caixaDeCortesia = els.find((el) => el.props.name === 'cortesia' && el.props.type === 'checkbox')!
    expect(caixaDeCortesia.props.defaultChecked, 'a cortesia voltou DESLIGADA').toBe(true)
    const caixaDeFurar = els.find((el) => el.props.name === 'furar' && el.props.type === 'checkbox')!
    expect(caixaDeFurar.props.defaultChecked).toBe(true)
    const campoDoMotivo = els.find((el) => el.props.name === 'motivo' && el.props.type !== 'hidden')!
    expect(campoDoMotivo.props.defaultValue).toBe('imprevisto nosso')

    // 3) SEGUNDO envio, com o formulário como a página o devolveu
    mock.rpcs = []
    mock.respostaRpc = { data: 'nova-1', error: null }
    await rodar(adminBookWindowAction, envioDoForm(segundoEnvio))
    const chamada = mock.rpcs.find(([nome]) => nome === 'book_reschedule_window')!
    const args = chamada[1] as Record<string, unknown>
    expect(
      args.p_courtesy,
      'o 2º envio consumiu franquia/crédito de um aluno que a dona isentou',
    ).toBe(true)
    expect(args.p_courtesy_note).toBe('imprevisto nosso')
    expect(args.p_bypass_lead).toBe(true)
  })

  it('VARREDOR: só o que NÃO é dado de pessoa fica na URL — e quem decide é o servidor', async () => {
    // A rede contra o apodrecimento do grave 6, remontada para o A7. Antes ela
    // lia `manter`/`na_url` dos formulários; esses campos deixaram de existir, e
    // vigiar um campo morto é vigiar nada. Agora o crivo é o que DE FATO
    // acontece: a allowlist da tela `remarcar` e a tabela de campos do servidor.
    const permitidos = new Set(['cortesia', 'furar', 'escolha'])
    expect(chavesDaTela({ tela: 'remarcar', instance: 'aula-1' }, true).length).toBe(3)
    for (const chave of chavesDaTela({ tela: 'remarcar', instance: 'aula-1' }, true))
      expect(permitidos.has(chave), `"${chave}" não é geometria e está indo para a URL`).toBe(true)

    // …e o `motivo` continua guardado nas DUAS portas de reserva
    expect(CAMPOS_DA_PORTA.remarcarOfertado).toContain('motivo')
    expect(CAMPOS_DA_PORTA.remarcarNovo).toContain('motivo')
    // nenhum campo guardado pode ser, ao mesmo tempo, geometria de URL
    for (const campo of [...CAMPOS_DA_PORTA.remarcarOfertado, ...CAMPOS_DA_PORTA.remarcarNovo])
      expect(permitidos.has(campo), `"${campo}" viaja no cookie E na URL`).toBe(false)

    // PROVA VIVA: nenhum formulário da página declara mais os campos mortos.
    const { els } = await paginaDoRemarcar({ cortesia: '1' })
    const forms = els.filter((el) => el.type === 'form')
    expect(forms.length, 'os formulários do Remarcar sumiram da página').toBeGreaterThan(0)
    for (const f of forms) {
      const dentro = [...percorrer(f)]
      for (const morto of ['manter', 'na_url', 'rascunho'])
        expect(
          dentro.some((el) => el.props.name === morto),
          `o formulário voltou a declarar "${morto}" — decisão do servidor viajando do cliente`,
        ).toBe(false)
    }
  })

  it('MÉDIO 4: o horário NOVO que ela digitou também volta depois do erro', async () => {
    // Sol · rodada 2 do A4: `manter` do formulário de horário novo só tinha
    // cortesia/furar/motivo. Um conflito devolvia a tela com data e hora VAZIAS,
    // e a dona redigitava tudo — no formulário que MEXE EM DINHEIRO.
    const { els } = await paginaDoRemarcar({})
    const novoHorario = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'local_date'),
    )!
    const fd = envioDoForm(novoHorario)
    fd.set('local_date', '2026-08-06')
    fd.set('local_time', '10:30')

    mock.respostaRpc = { data: null, error: { message: 'no_overlap: conflita' } }
    const url = await rodar(adminRescheduleNewTimeAction, fd)
    // na URL não fica nem a data nem a hora: elas voltam pelo cookie
    expect(queryDe(url).local_date).toBeUndefined()
    const guardado = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(guardado.campos).toMatchObject({ local_date: '2026-08-06', local_time: '10:30' })

    // …e a página REAL devolve os dois campos preenchidos
    const { els: devolvida } = await paginaDoRemarcar(queryDe(url))
    expect(devolvida.find((el) => el.props.name === 'local_date')!.props.defaultValue).toBe(
      '2026-08-06',
    )
    expect(devolvida.find((el) => el.props.name === 'local_time')!.props.defaultValue).toBe('10:30')
  })
})

describe('portão · Período: o tratamento escolhido volta selecionado', () => {
  function semearPeriodo() {
    mock.respostas = {
      teachers: { data: [{ ...DONA, holiday_policy: 'cancel_credit' }] },
      br_holidays: { data: [] },
      class_instances: { data: [] },
    }
  }

  /** A página do Período com a prévia aberta, e o form de tratamento dela. */
  async function paginaDoPeriodo(query: Record<string, string>) {
    semearPeriodo()
    const arvore: unknown = await PeriodoPage({ searchParams: Promise.resolve(query) })
    const els = [...percorrer(arvore)]
    const tratamento = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'mode'),
    )
    if (!tratamento) throw new Error('o form de tratamento sumiu da página')
    return { els, tratamento }
  }

  it('falha → volta com "Só bloquear" selecionado → o 2º envio NÃO cancela nada', async () => {
    // O 1º envio sai da ÁRVORE REAL (é dela que vêm `back` e `manter`), com a
    // escolha que a dona fez no navegador.
    const base = { prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' }
    const { tratamento } = await paginaDoPeriodo(base)
    const fd = envioDoForm(tratamento)
    fd.set('mode', 'block_only')
    fd.set('note', 'férias')

    mock.respostaRpc = { data: null, error: { message: 'deu ruim' } }
    const url = await rodar(periodTreatmentAction, fd)
    const q = queryDe(url)
    // A4/grave 5 (LGPD): a escolha e o MOTIVO deixaram de viajar na URL — o
    // motivo é texto livre ("cirurgia da professora") e ficava no histórico, no
    // log de acesso e em qualquer captura de tela. Eles voltam num cookie
    // `httpOnly` de vida curta, sob a chave desta tela.
    expect(q.mode, 'o tratamento escolhido voltou para a barra de endereços').toBeUndefined()
    expect(q.note, 'o motivo do período voltou para a barra de endereços').toBeUndefined()
    expect(url).not.toContain('férias')
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.chave).toBe(CHAVE_DO_PERIODO)
    expect(rascunho.campos).toMatchObject({ mode: 'block_only', note: 'férias' })

    const { els, tratamento: segundoEnvio } = await paginaDoPeriodo(q)
    const select = els.find((el) => el.type === 'select' && el.props.name === 'mode')!
    expect(
      select.props.defaultValue,
      'o seletor voltou para "Cancelar com crédito" — outra operação, destrutiva',
    ).toBe('block_only')
    expect(els.find((el) => el.props.name === 'note')!.props.defaultValue).toBe('férias')

    // segundo envio pela árvore real, sem ela tocar em nada
    mock.rpcs = []
    // A6/lote 2: o contrato de retorno do período ganhou `credited` e
    // `refund_blocked` — o dublê fala a MESMA língua da RPC, senão a frase da
    // tela sairia com "undefined" onde vai a contagem do crédito.
    mock.respostaRpc = {
      data: { cancelled: 0, invited: 0, credited: 0, refund_blocked: 0 },
      error: null,
    }
    await rodar(periodTreatmentAction, envioDoForm(segundoEnvio))
    const chamada = mock.rpcs.find(([nome]) => nome === 'admin_period_treatment')!
    expect((chamada[1] as Record<string, unknown>).p_mode).toBe('block_only')
    expect((chamada[1] as Record<string, unknown>).p_note).toBe('férias')
  })
})

describe('portão · painel de criação: erro devolve o painel ABERTO e preenchido', () => {
  const CONTRATOS = {
    // a projeção da consulta cresceu no A4 (fuso do contrato — grave 3)
    contracts: {
      data: [
        {
          id: 'c-9',
          plan_name: 'Mensal',
          students: { display_name: 'Elisa', iana_tz: 'America/Cuiaba' },
          student_groups: null,
          recurring_slots: [],
        },
      ],
    },
  }

  /** O painel `?novo=avulsa` e o formulário dele, pela árvore real. */
  async function painelDaAvulsa(query: Record<string, string>) {
    semear([], CONTRATOS)
    const arvore: unknown = await AgendaPage({ searchParams: Promise.resolve(query) })
    const painel = [...percorrer(arvore)].find((el) => el.props.titulo === 'Aula avulsa')
    if (!painel) throw new Error('o painel ?novo=avulsa sumiu da página')
    const campos = [...percorrer(painel.props.children)]
    const formulario = campos.find((el) => el.type === 'form')!
    return { campos, formulario }
  }

  it('aula avulsa recusada pelo banco → ?novo=avulsa de volta, com os campos que ela digitou', async () => {
    // 1º envio pela ÁRVORE REAL (é dela que vêm `back`, `back_erro` e `manter`)
    const { formulario } = await painelDaAvulsa({ novo: 'avulsa' })
    const fd = envioDoForm(formulario)
    fd.set('contract_id', 'c-9')
    fd.set('kind', 'courtesy')
    fd.set('local_date', '2026-08-05')
    fd.set('local_time', '14:00')
    fd.set('duration_min', '60')
    fd.set('price', '')

    // A6/a: a action CONVERTE a hora civil em instante antes de chamar a RPC, e
    // para isso precisa saber o fuso do contrato — a leitura de `contracts` deixou
    // de ser conferência opcional e virou insumo do ato. Sem semear a zona, a
    // recusa acontece ANTES do banco e o teste mediria o porteiro errado.
    mock.respostas.contracts = {
      data: { teacher_id: PROFESSORA, students: { iana_tz: CUIABA }, recurring_slots: [] },
    }
    mock.respostaRpc = { data: null, error: { message: 'horário conflita' } }
    const url = await rodar(createSingleClassAction, fd)
    const q = queryDe(url)
    expect(q.novo, 'o painel fechou e levou junto o que ela digitou').toBe('avulsa')
    // A4/grave 5 (LGPD): na URL fica SÓ a geometria da tela. O que a dona
    // digitou — contrato, datas, valor — viaja no cookie de rascunho.
    // A7: a FRASE também saiu da URL — ela viaja no cookie da seção.
    expect([...new URLSearchParams(url.split('?')[1]).keys()].sort()).toEqual(['novo'])
    expect(frase()).toContain('horário conflita')
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.chave).toBe(chaveDoPainel('avulsa'))
    expect(rascunho.campos).toMatchObject({
      contract_id: 'c-9',
      kind: 'courtesy',
      local_date: '2026-08-05',
      local_time: '14:00',
      duration_min: '60',
    })
    expect(rascunho.campos.price, 'campo vazio não pode ressuscitar valor velho').toBeUndefined()

    // a página REAL relê a URL (com o cookie ainda no pote) e devolve o painel
    // preenchido — a dona não perde nada por o transporte ter mudado.
    //
    // A4/rodada 2, GRAVE 3: os campos do painel deixaram de ser cópia própria e
    // passaram a ser a MESMA peça do balão (`CamposDaAvulsa`), que é cliente —
    // então o que a árvore do SERVIDOR mostra é o rascunho INTEIRO entregue a
    // ela, e é isso que se cobra aqui (o preenchimento campo a campo, no DOM
    // real, é `tests/onda-agenda-a4.test.ts`).
    const { campos } = await painelDaAvulsa(q)
    const peca = campos.find((el) => el.type === CamposDaAvulsa)!
    expect(peca, 'o painel voltou a ter campos próprios — o grave 3 renasceu').toBeDefined()
    expect(peca.props.digitado).toMatchObject({
      contract_id: 'c-9',
      kind: 'courtesy',
      local_date: '2026-08-05',
      local_time: '14:00',
      duration_min: '60',
    })
  })

  it('sucesso continua FECHANDO o painel (o `back` limpo, sem os campos)', async () => {
    const { formulario } = await painelDaAvulsa({ novo: 'avulsa' })
    const fd = envioDoForm(formulario)
    fd.set('contract_id', 'c-9')
    fd.set('local_date', '2026-08-05')
    fd.set('local_time', '14:00')
    // O campo mora DENTRO da peça cliente (não aparece na árvore do servidor),
    // mas o navegador sempre o envia — e a action passou a RECUSAR duração
    // ausente/zero em vez de inventar 45 (revisão independente do A4, grave 1).
    fd.set('duration_min', '45')
    // A6/a: a action CONVERTE a hora civil em instante antes de chamar a RPC, e
    // para isso precisa saber o fuso do contrato — a leitura de `contracts` deixou
    // de ser conferência opcional e virou insumo do ato. Sem semear a zona, a
    // recusa acontece ANTES do banco e o teste mediria o porteiro errado.
    mock.respostas.contracts = {
      data: { teacher_id: PROFESSORA, students: { iana_tz: CUIABA }, recurring_slots: [] },
    }
    mock.respostaRpc = { data: null, error: null }
    const url = await rodar(createSingleClassAction, fd)
    const q = queryDe(url)
    expect(q.novo).toBeUndefined()
    expect(q.contract_id).toBeUndefined()
    expect(url, 'a frase voltou para a barra de endereços (A7)').not.toContain('msg=')
    expect(frase()).toContain('Aula avulsa criada')
    // …e o ato concluído não deixa rascunho para trás (A4/grave 5)
    expect(pote.get(RASCUNHO_COOKIE)).toBeUndefined()
  })

  it('VARREDOR: a porta de cada painel guarda os campos que a dona preenche', async () => {
    // A rede contra o apodrecimento: campo novo num painel que não entre na
    // porta dele volta VAZIO depois de um erro — e este teste fica vermelho.
    //
    // A7 · O QUE MUDOU NA VARREDURA, e por que ela ficou mais forte: a lista
    // deixou de ser um campo do formulário (`manter`) e virou tabela do SERVIDOR
    // (`CAMPOS_DA_PORTA`). Antes, o teste comparava o JSX com um campo do
    // PRÓPRIO JSX — duas coisas que um mesmo descuido mudava junto. Agora ele
    // compara o JSX com a tabela do outro lado, que é onde a decisão mora.
    semear([], { teacher_weekly_availability: { data: [] }, teacher_availability_exceptions: { data: [] } })
    const controle = new Set(['back', 'back_erro', 'teacher_id', 'id'])
    /** Qual porta atende cada painel — o mesmo mapa que as actions usam. */
    const PORTA_DO_PAINEL: Record<string, ReadonlyArray<readonly string[]>> = {
      avulsa: [CAMPOS_DA_PORTA.avulsa],
      experimental: [CAMPOS_DA_PORTA.experimental],
      horario: [CAMPOS_DA_PORTA.publicar],
      // o painel de disponibilidade tem DOIS formulários de criação
      disponibilidade: [CAMPOS_DA_PORTA.janelaSemanal, CAMPOS_DA_PORTA.bloqueio],
    }
    for (const qual of ['avulsa', 'experimental', 'horario', 'disponibilidade']) {
      const arvore: unknown = await AgendaPage({
        searchParams: Promise.resolve({ novo: qual, prof: PROFESSORA }),
      })
      const painel = [...percorrer(arvore)].find((el) => typeof el.props.titulo === 'string' && el.props.voltarPara)
      expect(painel, `painel ${qual}`).toBeDefined()
      const guardados = new Set(PORTA_DO_PAINEL[qual].flat())
      for (const f of [...percorrer(painel!.props.children)].filter((el) => el.type === 'form')) {
        const els = [...percorrer(f)]
        const backErro = els.find((el) => el.props.name === 'back_erro')
        expect(backErro, `${qual}: form sem back_erro fecha o painel no erro`).toBeDefined()
        expect(String(backErro!.props.value)).toContain('novo=')
        // A CHAVE DO RASCUNHO É DERIVADA DESSE MESMO `back_erro` (A7): não há
        // mais campo `rascunho` para conferir — há a garantia de que quem decide
        // o destino decide a identidade.
        expect(els.find((el) => el.props.name === 'rascunho'), `${qual}: a chave voltou a viajar do cliente`).toBeUndefined()
        expect(els.find((el) => el.props.name === 'manter'), `${qual}: a lista voltou a viajar do cliente`).toBeUndefined()
        expect(
          chaveDoDestino({ tela: 'casa' }, geometriaCanonica({ tela: 'casa' }, true, lerDaQuery(String(backErro!.props.value)))),
          `${qual}: a chave derivada do back_erro não é a do painel`,
        ).toBe(chaveDoPainel(qual))

        for (const campo of els
          .map((el) => el.props.name)
          .filter((n): n is string => typeof n === 'string' && !controle.has(n))) {
          expect(guardados.has(campo), `${qual}: o campo "${campo}" não está na porta`).toBe(true)
        }
        // OS CAMPOS QUE MORAM DENTRO DE UM COMPONENTE CLIENTE não aparecem na
        // varredura da árvore (a peça só renderiza no navegador). Sem esta
        // cláusula, tirar `kind`/`price` da porta passaria batido — e a dona
        // perderia o tipo da aula na volta de erro.
        const dentroDoCliente: Record<string, string[]> = {
          avulsa: ['contract_id', 'kind', 'price', 'local_date', 'local_time', 'duration_min'],
          experimental: [
            'student_name',
            'iana_tz',
            'teacher_id',
            'local_date',
            'local_time',
            'duration_min',
            'price',
          ],
        }
        if (els.some((el) => el.type === CamposDaAvulsa || el.type === CamposDaExperimental)) {
          for (const campo of dentroDoCliente[qual] ?? [])
            expect(guardados.has(campo), `${qual}: "${campo}" saiu da porta`).toBe(true)
        }
      }
    }
  })
})

/* ========================================================================== */
/* 6. Achado 5 — o popover respeita a barra do polegar                        */
/* ========================================================================== */

describe('portão · o balão não nasce embaixo da barra do celular', () => {
  it('a fronteira de colisão reserva a barra (56px + safe-area) e o empilhamento fica acima dela', async () => {
    const { PopoverContent } = await import('@/components/kit/popover')
    // O default do primitivo é o que vale para TODOS os consumidores (a grade
    // não passa collisionPadding próprio).
    const el = h(PopoverContent, {}) as unknown as ElementoDaArvore
    const props = (el.type as { defaultProps?: Record<string, unknown> }) ?? {}
    expect(props).toBeDefined()
    // React function components não expõem defaults; a prova é o RENDER: o
    // conteúdo só existe dentro de um Popover aberto, então aqui se lê a fonte
    // do módulo — é fronteira de configuração, não comportamento de tela.
    const fonte = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/components/kit/popover.tsx'),
      'utf8',
    )
    expect(fonte).toMatch(/bottom: RODAPE_DO_POLEGAR/)
    expect(fonte).toMatch(/const RODAPE_DO_POLEGAR = 9[0-9]/)
    expect(fonte).toContain('z-[45]')
    expect(fonte).not.toContain('kit-menu z-30')
  })

  /**
   * …E A GRADE OFERECE A FOLGA QUE O BALÃO RESERVA (A9, 30/07).
   *
   * A fronteira de colisão do popover não é só posição: o Radix entrega a MESMA
   * medida ao `hide({ strategy: 'referenceHidden' })`, onde ela quer dizer
   * «âncora a menos disso de uma borda de recorte CONTA COMO ESCONDIDA». O
   * contêiner da grade é borda de recorte (`overflow-x-auto` faz o eixo Y
   * computar `auto`), e a borda dele encostava no último evento do dia — o balão
   * da aula das 21:15 do casal nascia `visibility: hidden` e não abria em
   * rolagem nenhuma (medido na 1ª execução real do e2e).
   *
   * Os dois números vivem em arquivos diferentes por FRONTEIRA RSC — `popover`
   * é `'use client'`, `calendario` é Server Component, e constante que atravessa
   * essa fronteira chega como referência, não como valor. É esta asserção que
   * impede os dois de divergirem sem ninguém ver no diff.
   */
  it('a grade reserva, em classe, a MESMA folga que o popover pede em colisão', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const ler = (rel: string) =>
      fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')

    const doPopover = /const RODAPE_DO_POLEGAR = (\d+)/.exec(ler('src/components/kit/popover.tsx'))
    expect(doPopover, 'o `RODAPE_DO_POLEGAR` sumiu do primitivo').toBeTruthy()
    const reservado = Number(doPopover![1])

    // `pb-24` do Tailwind = 24 × 0.25rem = 6rem = 96px. A conta fica escrita
    // aqui para que trocar a classe por outra escada acuse.
    const grade = ler('src/components/kit/calendario.tsx')
    const roláveis = [...grade.matchAll(/className="([^"]*\boverflow-x-auto\b[^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(
      roláveis.length,
      'as duas grades roláveis (horas e mês) têm de declarar a folga da âncora',
    ).toBe(2)
    const folgas = roláveis.map((c) => Number(/\bpb-(\d+)\b/.exec(c)?.[1] ?? 0) * 4)
    for (const folga of folgas) {
      expect(
        folga,
        `a grade oferece ${folga}px de folga e o balão reserva ${reservado}px — ` +
          'âncora dentro da reserva é lida como escondida e o balão não abre',
      ).toBeGreaterThanOrEqual(reservado)
    }
  })
})
