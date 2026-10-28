// A7 — AS TRÊS TELAS QUE FALTAVAM MIGRAR (Onda da Agenda).
//
// O que este arquivo protege, na ordem:
//   1. FILA DE PENDÊNCIAS: a mais antiga grita primeiro — ordem E hierarquia;
//   2. LOTE "todas aconteceram": o gesto por professora (S2-7) e as travas do
//      portão de 29/07 sobreviveram à troca de moldura;
//   3. PERÍODO: a prévia diz QUAIS aulas entram, e não inventa predição de
//      crédito que o banco não dá;
//   4. REMARCAR: slot-picker vindo do motor de horários, saldo re-exposto antes
//      de gastar, e a classificação do banco como INFORMAÇÃO — nunca como
//      portão para o admin, que tem cortesia e furar antecedência.
//
// Padrão da casa: cliente Supabase falso, pote de cookies dublê, relógio
// congelado e a árvore REAL de cada página.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'

/* ========================================================================== */
/* Dublês                                                                      */
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
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))

const { cookies } = await import('next/headers')
const { default: AgendaPage } = await import('@/app/admin/agenda/page')
const { default: PeriodoPage } = await import('@/app/admin/agenda/periodo/page')
const { default: RemarcarPage } = await import('@/app/admin/agenda/remarcar/[instance]/page')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const CUIABA = 'America/Cuiaba'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: CUIABA }

let pote: PoteDeCookies

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
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
/* Ferramentas de árvore                                                       */
/* ========================================================================== */

interface ElementoDaArvore {
  type: unknown
  props: { children?: unknown } & Record<string, unknown>
}
function ehElemento(no: unknown): no is ElementoDaArvore {
  return typeof no === 'object' && no !== null && 'props' in (no as object)
}
function* percorrer(no: unknown): Generator<ElementoDaArvore> {
  if (Array.isArray(no)) {
    for (const filho of no) yield* percorrer(filho)
    return
  }
  if (!ehElemento(no)) return
  yield no
  yield* percorrer(no.props.children)
}
function textoDe(no: unknown): string {
  if (no === null || no === undefined || typeof no === 'boolean') return ''
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  // ARRAY de filhos é texto CONTÍGUO (`{n} aula{s} no período` chega em pedaços):
  // juntar com espaço partiria a frase e o varredor não a encontraria.
  if (Array.isArray(no)) return no.map(textoDe).join('')
  if (ehElemento(no)) return textoDe(no.props.children)
  return ''
}

/**
 * As props que CARREGAM TEXTO DE TELA nas peças do kit (o título do cartão, o
 * rótulo e o aviso do lote, o `meta` do cabeçalho). Sem elas, um varredor de
 * árvore rasa não veria metade do que a dona lê — e ficaria verde por não olhar.
 */
const PROPS_DE_TEXTO = ['title', 'meta', 'titulo', 'descricao', 'rotulo', 'aviso', 'label', 'hint']

const textoDaArvore = (arvore: unknown) =>
  [...percorrer(arvore)]
    .map((el) =>
      [
        textoDe(el.props.children),
        ...PROPS_DE_TEXTO.map((p) => (typeof el.props[p] === 'string' ? el.props[p] : '')),
      ].join(' '),
    )
    .join(' ')

/* ========================================================================== */
/* 1. A FILA DE PENDÊNCIAS — a mais antiga grita primeiro                      */
/* ========================================================================== */

function aulaCrua(campos: { id: string; inicio: string; apontada?: boolean; aluno?: string }) {
  return {
    id: campos.id,
    starts_at_utc: campos.inicio,
    ends_at_utc: null,
    state: 'scheduled',
    teacher_id: PROFESSORA,
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (fixture de aula de contrato)
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: {
      id: 'c-fixture',
      plan_name: 'Mensal',
      students: {
        id: 'a1',
        display_name: campos.aluno ?? 'Elisa',
        iana_tz: CUIABA,
        profile_id: 'p-a1',
        profiles: { whatsapp_e164: '+5565999990000' },
      },
      student_groups: null,
    },
    class_content_reports: campos.apontada ? { class_instance_id: campos.id } : null,
  }
}

/** Três pendências de idades diferentes: 20 dias, 3 dias e ontem. */
const FILA = [
  // deliberadamente FORA de ordem na resposta do banco — quem ordena é a
  // camada de dados, e é isso que este arquivo cobra
  aulaCrua({ id: 'nova', inicio: '2026-07-27T18:00:00Z', aluno: 'Clara', apontada: true }),
  aulaCrua({ id: 'velha', inicio: '2026-07-08T18:00:00Z', aluno: 'Elisa', apontada: true }),
  aulaCrua({ id: 'media', inicio: '2026-07-25T18:00:00Z', aluno: 'Bruno', apontada: true }),
]

async function telaDePendencias(aulas: unknown[], prof: string | null = PROFESSORA) {
  mock.respostas = {
    class_instances: { data: aulas },
    teachers: { data: [DONA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
  }
  const arvore: unknown = await AgendaPage({
    // `prof: null` = sem filtro de professora (e não "use o padrão"): passar
    // `undefined` a um parâmetro com default reativa o default, e o teste do
    // S2-7 mediria o cenário oposto ao que ele diz medir.
    searchParams: Promise.resolve(prof === null ? { v: 'pendencias' } : { v: 'pendencias', prof }),
  })
  return [...percorrer(arvore)]
}

describe('A7/telas · a fila de pendências: a mais antiga grita primeiro', () => {
  it('a ORDEM é da mais antiga para a mais nova, mesmo com o banco devolvendo trocado', async () => {
    const els = await telaDePendencias(FILA)
    const matrizes = els.filter((el) => typeof el.props.aulaId === 'string')
    expect(matrizes.map((el) => el.props.aulaId)).toEqual(['velha', 'media', 'nova'])
  })

  it('a HIERARQUIA acompanha: só a primeira leva o rótulo do lugar dela', async () => {
    const els = await telaDePendencias(FILA)
    const rotulos = els.filter((el) => textoDe(el.props.children) === 'a mais antiga')
    expect(rotulos, 'o rótulo da mais antiga sumiu (ou nasceu duplicado)').toHaveLength(1)
  })

  it('o CHIP escala com o atraso REAL: uma semana ou mais fica vermelho', async () => {
    const els = await telaDePendencias(FILA)
    const chips = els.filter((el) => typeof el.props.tone === 'string' && /dias|ontem|hoje/.test(textoDe(el.props.children)))
    expect(chips.map((el) => [textoDe(el.props.children), el.props.tone])).toEqual([
      ['há 20 dias', 'danger'],
      ['há 3 dias', 'warn'],
      ['ontem', 'warn'],
    ])
  })

  it('PROVA DE MUTAÇÃO: fila de UMA não anuncia "a mais antiga" (seria dizer nada)', async () => {
    const els = await telaDePendencias([FILA[0]])
    expect(els.some((el) => textoDe(el.props.children) === 'a mais antiga')).toBe(false)
  })

  it('a fila é UMA moldura, não N cartões soltos (o esqueleto das telas novas)', async () => {
    const els = await telaDePendencias(FILA)
    const lista = els.find((el) => el.type === 'ul' && String(el.props.className).includes('divide-y'))
    expect(lista, 'a fila voltou a ser uma pilha de cartões').toBeDefined()
    expect(String(lista!.props.className)).toContain('border-line-soft')
  })
})

/* ========================================================================== */
/* 2. O LOTE — a moldura mudou, a REGRA não                                    */
/* ========================================================================== */

describe('A7/telas · o lote "todas aconteceram" (S2-7 intacto)', () => {
  const loteDaTela = (els: ElementoDaArvore[]) =>
    els.find((el) => typeof el.props.rotulo === 'string' && String(el.props.rotulo).includes('Todas aconteceram'))

  it('SEM professora filtrada o lote NÃO EXISTE — e a tela diz por quê', async () => {
    const els = await telaDePendencias(FILA, null)
    expect(loteDaTela(els), 'o atestado em massa apareceu sem escolher a professora').toBeUndefined()
    expect(textoDaArvore(els)).toContain('filtre por professora')
  })

  it('o botão conta e envia SÓ o elegível, com os IDs explícitos', async () => {
    const comUmaSemApontamento = [
      FILA[0],
      FILA[1],
      aulaCrua({ id: 'sem-apontamento', inicio: '2026-07-26T18:00:00Z', apontada: false }),
    ]
    const els = await telaDePendencias(comUmaSemApontamento)
    const lote = loteDaTela(els)!
    expect(lote.props.rotulo).toBe('✓ Todas aconteceram (2)')
    const campos = lote.props.campos as Record<string, string>
    expect(campos.instance_ids.split(',').sort()).toEqual(['nova', 'velha'])
    expect(campos.teacher_id).toBe(PROFESSORA)
    expect(lote.props.aviso).toContain('1 aula desta fila NÃO entra')
    expect(lote.props.aviso).toContain('sem apontamento')
  })

  it('a moldura é o AlertDialog do kit, e o `<details data-popup>` morreu', async () => {
    const els = await telaDePendencias(FILA)
    expect(loteDaTela(els)).toBeDefined()
    expect(
      els.some((el) => el.type === 'details' && el.props['data-popup'] !== undefined),
      'o `<details data-popup>` voltou à tela nova (proibido pelo AGENTS.md)',
    ).toBe(false)
  })

  it('o CTA é botão do kit no piso de ação da régua (texto ≥ text-sm)', async () => {
    const els = await telaDePendencias(FILA)
    const classe = String(loteDaTela(els)!.props.className)
    expect(classe).toContain('btn-ink')
    expect(classe, 'o CTA do lote caiu abaixo do piso de texto da régua').toContain('!text-sm')
  })
})

/* ========================================================================== */
/* 3. PERÍODO — a prévia diz o que sabe, e para onde o conhecimento acaba      */
/* ========================================================================== */

async function telaDePeriodo(query: Record<string, string>, afetadas: unknown[] = []) {
  mock.respostas = {
    teachers: { data: [{ ...DONA, holiday_policy: 'cancel_credit' }] },
    br_holidays: { data: [] },
    class_instances: { data: afetadas },
  }
  const arvore: unknown = await PeriodoPage({ searchParams: Promise.resolve(query) })
  return { els: [...percorrer(arvore)], texto: textoDaArvore(arvore) }
}

const AFETADA = (id: string, inicio: string, quem: string) => ({
  id,
  starts_at_utc: inicio,
  contracts: { students: { display_name: quem }, student_groups: null },
})

describe('A7/telas · o tratamento de período com PRÉVIA', () => {
  it('a prévia nomeia as aulas: quem, e o dia/hora no relógio que DECIDE', async () => {
    const { texto } = await telaDePeriodo(
      { prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' },
      [AFETADA('i-1', '2026-08-04T18:00:00Z', 'Elisa'), AFETADA('i-2', '2026-08-05T19:00:00Z', 'Bruno')],
    )
    expect(texto).toContain('2 aulas no período')
    expect(texto).toContain('Elisa')
    expect(texto).toContain('Bruno')
    // 18:00Z = 14:00 em Cuiabá, que é o fuso da professora do fixture
    expect(texto).toContain('14:00')
  })

  it('a prévia diz o ALCANCE e PARA onde o conhecimento acaba — sem inventar predição', async () => {
    const { texto } = await telaDePeriodo(
      { prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' },
      [AFETADA('i-1', '2026-08-04T18:00:00Z', 'Elisa')],
    )
    expect(texto).toContain('vale para as 1 aula da lista acima')
    // O que ela NÃO promete: quantas geram crédito. Quem sabe é a transação.
    expect(texto).toContain('só se sabe na hora')
    expect(texto).toMatch(/frase do desfecho traz os dois números/)
    // …e a EXCEÇÃO vai na mesma frase: prometer crédito sem nomeá-la é a família
    // de frase falsa que o varredor A5/L5 persegue (e que ele pegou aqui).
    expect(texto).toContain('crédito antigo sem identidade')
  })

  it('período VAZIO é dito como fato, não como silêncio (zero é informação)', async () => {
    const { texto } = await telaDePeriodo({ prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' }, [])
    expect(texto).toContain('0 aulas no período')
    expect(texto).toContain('não vai mexer em aula nenhuma')
  })

  it('a tela entrou no esqueleto da seção: as três abas, com Período ativa', async () => {
    const { els } = await telaDePeriodo({ prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' })
    const abas = els.find((el) => Array.isArray(el.props.tabs))!.props.tabs as {
      label: string
      href: string
      active?: boolean
    }[]
    expect(abas.map((a) => a.label)).toEqual(['Agenda', 'Pendências', 'Período'])
    expect(abas.find((a) => a.label === 'Período')!.active).toBe(true)
  })

  it('o formulário não declara mais `manter`/`rascunho`/`back` (A7)', async () => {
    const { els } = await telaDePeriodo({ prof: PROFESSORA, de: '2026-08-01', ate: '2026-08-10' })
    const tratamento = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'mode'),
    )!
    const nomes = [...percorrer(tratamento)].map((el) => el.props.name)
    for (const morto of ['manter', 'rascunho', 'na_url', 'back'])
      expect(nomes, `o formulário do período voltou a declarar "${morto}"`).not.toContain(morto)
    // …e continua mandando o que a action PRECISA
    expect(nomes).toContain('teacher_id')
    expect(nomes).toContain('from')
    expect(nomes).toContain('to')
  })
})

/* ========================================================================== */
/* 4. REMARCAR — slot-picker e saldo re-exposto (D4)                           */
/* ========================================================================== */

const AULA = {
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
}

function preview(efeito: string, extras: Record<string, unknown> = {}) {
  mock.respostasRpc.preview_reschedule_effect = {
    data: [
      {
        efeito,
        franquia_restante: 2,
        saldo_creditos: 3,
        min_notice_hours: 24,
        validade_do_credito: null,
        limite_ts: '2026-07-29T18:00:00Z',
        ...extras,
      },
    ],
  }
}

async function telaDeRemarcar(query: Record<string, string> = {}, extras: Record<string, Resposta> = {}) {
  mock.respostas = {
    class_instances: { data: AULA },
    teacher_public: { data: { id: PROFESSORA, display_name: 'Teacher Vicky' } },
    reschedule_windows: { data: [{ id: 'w-1', starts_at_utc: '2026-08-04T18:00:00Z' }] },
    audit_log: { data: null, count: 0 },
    ...extras,
  }
  const arvore: unknown = await RemarcarPage({
    params: Promise.resolve({ instance: 'aula-1' }),
    searchParams: Promise.resolve(query),
  })
  return { els: [...percorrer(arvore)], texto: textoDaArvore(arvore) }
}

describe('A7/telas · Remarcar do admin: slot-picker e saldo re-exposto', () => {
  it('o SALDO vem de UMA leitura do banco — as três contas em TypeScript morreram', async () => {
    preview('franquia')
    const { texto } = await telaDeRemarcar()
    expect(mock.rpcs.map(([n]) => n)).toContain('preview_reschedule_effect')
    // e as consultas que faziam a conta à mão saíram da página
    expect(mock.chamadas.reschedule_usage, 'a franquia voltou a ser calculada na tela').toBeUndefined()
    expect(mock.rpcs.map(([n]) => n)).not.toContain('makeup_balance')
    expect(texto).toContain('Franquia do mês: 2 · reposições do aluno: 3')
  })

  it('os horários ofertados saem do motor de slots (janela publicada + grade computada)', async () => {
    preview('franquia')
    const { texto } = await telaDeRemarcar()
    // 2026-08-04T18:00Z = 14:00 em Cuiabá
    expect(texto).toContain('14:00')
    expect(texto).toContain('Escolha o novo horário')
    // …e o motor consultou a agenda semanal da professora, não só as janelas
    expect(mock.chamadas.teacher_weekly_availability, 'o slot-picker não olhou a agenda semanal').toBeDefined()
  })

  it('escolher NÃO gasta: leva ao passo de revisão, com o saldo de novo ao lado do botão', async () => {
    preview('credito')
    const { els, texto } = await telaDeRemarcar({ escolha: 'w-1' })
    expect(texto).toContain('Confira antes de confirmar')
    // o saldo aparece DUAS vezes: no cabeçalho e ao lado do que gasta
    expect(texto.match(/Franquia do mês/g)!.length).toBeGreaterThanOrEqual(2)
    // e a consequência com as MESMAS palavras nos dois lugares
    expect(texto.match(/sai 1 das 3 reposições do aluno/g)!.length).toBeGreaterThanOrEqual(2)
    // …e o botão que gasta é um submit de verdade, no formulário da janela
    const reserva = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'window_id'),
    )
    expect(reserva, 'o formulário de reserva sumiu do passo de revisão').toBeDefined()
  })

  it('A CLASSIFICAÇÃO NÃO É PORTÃO PARA O ADMIN: sem saldo, ela ainda enxerga o caminho', async () => {
    preview('sem_saldo', { franquia_restante: 0, saldo_creditos: 0 })
    const { texto } = await telaDeRemarcar()
    expect(texto).toContain('o banco RECUSA')
    // …e a saída que ela TEM é nomeada, em vez de a tela fechar
    expect(texto).toContain('cortesia')
    expect(texto, 'a tela escondeu o slot-picker de quem tem cortesia na mão').toContain(
      'Escolha o novo horário',
    )
    expect(texto).toContain('Ou marcar um horário novo')
  })

  it('fora do aviso mínimo, a saída nomeada é o "furar antecedência"', async () => {
    preview('fora_do_aviso')
    const { texto } = await telaDeRemarcar()
    expect(texto).toContain('furar antecedência')
    expect(texto).toContain('Ou marcar um horário novo')
  })

  it('com CORTESIA ligada a frase muda: nem franquia nem reposição são tocadas', async () => {
    preview('credito')
    const { texto } = await telaDeRemarcar({ cortesia: '1' })
    expect(texto).toContain('CORTESIA')
    expect(texto).toContain('não consome franquia nem reposição')
    expect(texto, 'a tela prometeu gasto de reposição ao lado de uma cortesia ligada').not.toContain(
      'sai 1 das',
    )
  })

  it('leitura do preview que FALHA não vira "sem custo" — a tela admite a dúvida', async () => {
    mock.respostasRpc.preview_reschedule_effect = { data: null, error: { message: 'timeout' } }
    const { texto } = await telaDeRemarcar()
    expect(texto).toContain('Não deu para ler a franquia e a reposição do aluno agora')
    expect(texto).toContain('Quem decide é o banco, na confirmação')
  })

  it('os formulários não declaram mais `manter`/`na_url`/`rascunho` (A7)', async () => {
    preview('franquia')
    const { els } = await telaDeRemarcar({ escolha: 'w-1' })
    for (const f of els.filter((el) => el.type === 'form')) {
      const nomes = [...percorrer(f)].map((el) => el.props.name)
      for (const morto of ['manter', 'na_url', 'rascunho'])
        expect(nomes, `o Remarcar voltou a declarar "${morto}"`).not.toContain(morto)
    }
  })

  /* ------------------------------------------------------------------------ *
   * VARREDURA FINAL — S1 · S4 · S5 nesta mesma tela                            *
   * ------------------------------------------------------------------------ */

  it('S1 · "furar antecedência" atravessa para o SLOT-PICKER (a janela de amanhã volta à lista)', async () => {
    // A janela publicada para daqui a 2 h (20:00Z = 16:00 em Cuiabá) está DENTRO
    // da antecedência mínima da professora (12 h, o padrão). Sem o furar ela é
    // cortada — e é o certo. Com o furar LIGADO, a RPC recebe `p_bypass_lead` e
    // aceitaria esse horário: a lista some enquanto a mesma hora digitada à mão
    // passa, que é a tela desmentindo a própria oferta.
    const janelaCedo = { reschedule_windows: { data: [{ id: 'w-cedo', starts_at_utc: '2026-07-28T20:00:00Z' }] } }
    preview('fora_do_aviso')
    const cortada = await telaDeRemarcar({}, janelaCedo)
    expect(cortada.texto, 'a janela dentro do prazo apareceu sem o furar').not.toContain('16:00')
    expect(cortada.texto).toContain('não tem nenhum horário livre')

    preview('fora_do_aviso')
    const comFurar = await telaDeRemarcar({ furar: '1' }, janelaCedo)
    expect(comFurar.texto, 'com o furar ligado a janela publicada continuou escondida').toContain(
      '16:00',
    )
  })

  it('S4 · leitura da agenda que FALHA não vira "nenhum horário livre"', async () => {
    // "A professora não tem horário nas próximas 2 semanas" é uma afirmação
    // sobre a agenda dela. Dita porque o banco não respondeu, ela empurra a dona
    // para o caminho do horário novo — por cima de uma aula que ninguém viu.
    preview('franquia')
    await expect(
      telaDeRemarcar({}, { teacher_weekly_availability: { error: { message: 'timeout' } } }),
    ).rejects.toThrow(/horários livres/)
  })

  it('S5 · o vão de 30 min não é oferecido a uma aula de 30m20s', async () => {
    // Mesma família do cinto da migration 98: a duração ia arredondada em
    // minutos, e a recusa aparecia DEPOIS da confirmação. A janela semanal de
    // quinta 09:00–09:30 é o vão exato — cabe a aula de 30 min, não cabe a de
    // 30m20s.
    const grade30 = {
      reschedule_windows: { data: [] },
      teacher_weekly_availability: {
        data: [{ weekday: 4, start_local: '09:00:00', end_local: '09:30:00', iana_tz: CUIABA }],
      },
    }
    const aulaDe = (fim: string) => ({
      class_instances: { data: { ...AULA, ends_at_utc: fim } },
      ...grade30,
    })

    preview('franquia')
    const exata = await telaDeRemarcar({}, aulaDe('2026-07-30T18:30:00Z'))
    expect(exata.texto, 'o vão de 30 min sumiu para a aula de 30 min').toContain('09:00')

    preview('franquia')
    const comSobra = await telaDeRemarcar({}, aulaDe('2026-07-30T18:30:20Z'))
    expect(comSobra.texto, 'a aula de 30m20s foi oferecida num vão de 30 min').not.toContain('09:00')
    expect(comSobra.texto).toContain('não tem nenhum horário livre')
  })

  it('o MOTIVO da cortesia não nasce na URL: ele vem do cookie e volta em campo oculto', async () => {
    preview('franquia')
    const { els } = await telaDeRemarcar({ escolha: 'w-1', cortesia: '1' })
    const reserva = els.find(
      (el) => el.type === 'form' && [...percorrer(el)].some((f) => f.props.name === 'window_id'),
    )!
    const dentro = [...percorrer(reserva)]
    // o campo viaja SEMPRE (é ele que sobrevive ao erro pelo cookie)
    expect(dentro.some((el) => el.props.name === 'motivo')).toBe(true)
    expect(dentro.some((el) => el.props.name === 'cortesia')).toBe(true)
  })
})
