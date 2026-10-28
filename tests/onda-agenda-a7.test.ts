// A7 — O TRANSPORTE ÚNICO DA SEÇÃO AGENDA (Onda da Agenda).
//
// O que este arquivo protege, na ordem:
//   1. A ALLOWLIST DE GEOMETRIA: o destino é reconstruído, e nada além dela
//      atravessa — `msg`/`n` inclusive, o que mata a ponte legada pela raiz;
//   2. A CHAVE É FUNÇÃO DO DESTINO: escritor e leitor do rascunho não têm como
//      divergir (foi divergindo que o painel voltava vazio, no A4);
//   3. AS 11 ACTIONS: nenhuma delas escreve `?msg=`; todas gravam no cookie;
//   4. DÍVIDA (a) — DUAS ABAS: o sucesso de uma não apaga o rascunho da outra;
//   5. DÍVIDA (b) — O RECADO NÃO REPINTA: ele é do ENDEREÇO, e navegar dentro
//      da seção dentro dos 15 s não o traz de volta;
//   6. DÍVIDA (c) — OS CHAMADORES EXTERNOS: quem entra na seção por fora
//      continua funcionando, e quem SAI dela (a ficha) continua com o recado;
//   7. O GUARDA ARMADO: `SUBROTAS` conhece as três telas — subrota que não
//      existe cai na casa, e o recado não some num 404.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import {
  CHAVE_DO_PERIODO,
  chaveDoBalao,
  chaveDoDesfecho,
  chaveDoPainel,
  chaveDoRemarcar,
  RASCUNHO_COOKIE,
} from '@/lib/admin/rascunho-do-formulario'
import {
  CAMPOS_DA_PORTA,
  CAMPOS_GUARDADOS,
  caminhoDaTela,
  chaveDoDestino,
  chavesDaTela,
  enderecoDaTela,
  geometriaCanonica,
  geometriaValida,
  lerDaQuery,
  type TelaDaAgenda,
} from '@/lib/admin/transporte-da-agenda'

/* ========================================================================== */
/* Dublês (o padrão do a4/a5/portão)                                           */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
  count?: number
}

class ConsultaFalsa {
  constructor(private readonly resposta: Resposta) {}
  private eu() {
    return this
  }
  select() { return this.eu() }
  eq() { return this.eu() }
  is() { return this.eu() }
  gt() { return this.eu() }
  gte() { return this.eu() }
  lt() { return this.eu() }
  lte() { return this.eu() }
  or() { return this.eu() }
  limit() { return this.eu() }
  order() { return this.eu() }
  private singular = false
  single() { this.singular = true; return this.eu() }
  maybeSingle() { this.singular = true; return this.eu() }
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
  rpcs: [] as Array<[string, unknown]>,
  respostaRpc: { data: null, error: null } as Resposta,
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
      return { data: mock.respostaRpc.data ?? null, error: mock.respostaRpc.error ?? null }
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
const { cookieDoRecado, gravarRecado, lerRecado } = await import('@/lib/kit/recado')
const { esquecerRascunho, gravarRascunho, lerRascunho } = await import(
  '@/lib/admin/rascunho-do-formulario'
)
const acoes = await import('@/app/admin/agenda/actions')

let pote: PoteDeCookies

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  mock.respostas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
})
afterEach(() => {
  vi.useRealTimers()
})

const CASA: TelaDaAgenda = { tela: 'casa' }
const PROFESSORA = '11111111-1111-1111-1111-111111111111'

/** Roda uma action e devolve o destino do redirect. */
async function rodar(acao: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return e.url
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

function recadoNoPote(): { mensagem: string; id: string; destino?: string } | null {
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  return cru ? JSON.parse(cru) : null
}

function rascunhoNoPote(): { chave: string; campos: Record<string, string> } | null {
  const cru = pote.get(RASCUNHO_COOKIE)?.value
  return cru ? JSON.parse(cru) : null
}

/* ========================================================================== */
/* 1. A ALLOWLIST — o destino é MONTADO, não copiado                           */
/* ========================================================================== */

describe('A7/1 · a geometria que atravessa é a da allowlist, e mais nada', () => {
  it('a ponte legada não tem por onde entrar (não é "limpar depois")', () => {
    const q = geometriaCanonica(CASA, true, lerDaQuery('/admin/agenda?v=dia&msg=oi&n=123'))
    expect(q.get('v')).toBe('dia')
    expect(q.get('msg'), '`msg` entrou na query reconstruída').toBeNull()
    expect(q.get('n')).toBeNull()
    expect(enderecoDaTela(CASA, q)).toBe('/admin/agenda?v=dia')
  })

  it('campo digitado pendurado no `back` NÃO sobrevive — nem com nome de geometria', () => {
    const cru =
      '/admin/agenda?off_note=m%C3%A3e%20internada&student_name=Maria&motivo=cirurgia&v=semana'
    const destino = enderecoDaTela(CASA, geometriaCanonica(CASA, true, lerDaQuery(cru)))
    expect(destino).toBe('/admin/agenda?v=semana')
    for (const proibido of ['internada', 'Maria', 'cirurgia'])
      expect(destino).not.toContain(proibido)
  })

  it('valor do TIPO errado é DESCARTADO, nunca recusado (a dona não perde o desfecho)', () => {
    const q = geometriaCanonica(
      CASA,
      true,
      lerDaQuery('/admin/agenda?v=galáxia&d=32/13&prof=nao-uuid&j=7&novo=inventado&si=xpto'),
    )
    expect([...q.keys()]).toEqual([])
  })

  it('cada chave conhece o próprio tipo', () => {
    expect(geometriaValida('v', 'pendencias')).toBe(true)
    expect(geometriaValida('v', 'kanban')).toBe(false)
    expect(geometriaValida('d', '2026-08-04')).toBe(true)
    expect(geometriaValida('d', '2026-02-31')).toBe(false)
    expect(geometriaValida('prof', PROFESSORA)).toBe(true)
    expect(geometriaValida('prof', 'Maria Silva')).toBe(false)
    expect(geometriaValida('novo', 'disponibilidade')).toBe(true)
    expect(geometriaValida('novo', 'qualquer')).toBe(false)
    expect(geometriaValida('si', 'bloqueio')).toBe(true)
    expect(geometriaValida('si', 'sei-la')).toBe(false)
    expect(geometriaValida('slot', '2026-08-04T14:00')).toBe(true)
    expect(geometriaValida('slot', '2026-08-04')).toBe(false)
    expect(geometriaValida('cortesia', '1')).toBe(true)
    expect(geometriaValida('cortesia', '0')).toBe(false)
    // chave que não está na tabela simplesmente NÃO EXISTE
    expect(geometriaValida('msg', 'oi')).toBe(false)
    expect(geometriaValida('rascunho', 'painel:avulsa')).toBe(false)
  })

  it('teto de tamanho vale para todas — inclusive para a busca, o único texto livre', () => {
    expect(geometriaValida('q', 'x'.repeat(120))).toBe(true)
    expect(geometriaValida('q', 'x'.repeat(121))).toBe(false)
  })

  it('SUCESSO não carrega a geometria do ERRO — ato concluído fecha o formulário', () => {
    const cru = '/admin/agenda?v=dia&novo=avulsa&slot=2026-08-04T14:00&si=avulsa&ev=aula-1'
    expect(enderecoDaTela(CASA, geometriaCanonica(CASA, false, lerDaQuery(cru)))).toBe(
      '/admin/agenda?v=dia',
    )
    // …e o de ERRO carrega, que é o que reabre o que falhou
    expect(enderecoDaTela(CASA, geometriaCanonica(CASA, true, lerDaQuery(cru)))).toContain('novo=avulsa')
  })

  it('o caminho é FIXO por tela: `back` de outra seção não tem para onde ir', () => {
    expect(caminhoDaTela(CASA)).toBe('/admin/agenda')
    expect(caminhoDaTela({ tela: 'periodo' })).toBe('/admin/agenda/periodo')
    expect(caminhoDaTela({ tela: 'remarcar', instance: 'aula-1' })).toBe(
      '/admin/agenda/remarcar/aula-1',
    )
    // travessia e endereço absoluto não chegam a virar caminho: só a QUERY é lida
    const q = geometriaCanonica(CASA, true, lerDaQuery('https://evil.example/x?v=dia'))
    expect(enderecoDaTela(CASA, q)).toBe('/admin/agenda?v=dia')
  })
})

/* ========================================================================== */
/* 2. A CHAVE É FUNÇÃO DO DESTINO                                              */
/* ========================================================================== */

describe('A7/2 · a chave do rascunho é derivada do destino, nunca lida do formulário', () => {
  const chaveDe = (cru: string) =>
    chaveDoDestino(CASA, geometriaCanonica(CASA, true, lerDaQuery(cru)))

  it('cada superfície da casa produz a chave dela', () => {
    expect(chaveDe('/admin/agenda?ev=aula-9')).toBe(chaveDoDesfecho('aula-9'))
    expect(chaveDe('/admin/agenda?slot=2026-08-04T14:00&si=avulsa')).toBe(
      chaveDoBalao('2026-08-04T14:00', 'avulsa'),
    )
    expect(chaveDe('/admin/agenda?novo=avulsa&nd=2026-08-04&nt=14:00')).toBe(
      chaveDoPainel('avulsa', '2026-08-04T14:00'),
    )
    expect(chaveDe('/admin/agenda?novo=disponibilidade')).toBe(chaveDoPainel('disponibilidade'))
    // tela sem formulário aberto = sem gaveta
    expect(chaveDe('/admin/agenda?v=semana')).toBe('')
  })

  it('as outras duas telas têm chave própria, e ela não depende da query', () => {
    expect(chaveDoDestino({ tela: 'periodo' }, new URLSearchParams())).toBe(CHAVE_DO_PERIODO)
    expect(chaveDoDestino({ tela: 'remarcar', instance: 'aula-1' }, new URLSearchParams())).toBe(
      chaveDoRemarcar('aula-1'),
    )
  })

  it('a MESMA aula tem duas gavetas: remarcar e desfecho não se preenchem', () => {
    expect(chaveDoDesfecho('aula-1')).not.toBe(chaveDoRemarcar('aula-1'))
  })

  it('slot vizinho é OUTRA gaveta (o grave 4 do A4, agora por construção)', () => {
    expect(chaveDe('/admin/agenda?slot=2026-08-04T14:00&si=avulsa')).not.toBe(
      chaveDe('/admin/agenda?slot=2026-08-04T14:30&si=avulsa'),
    )
    // e a MESMA meia-hora em intenção diferente também
    expect(chaveDe('/admin/agenda?slot=2026-08-04T14:00&si=avulsa')).not.toBe(
      chaveDe('/admin/agenda?slot=2026-08-04T14:00&si=horario'),
    )
  })

  it('painel aberto por link salvo de OUTRO alvo não herda o rascunho do anterior', () => {
    // o médio 1 da revisão independente do A4: `painel:avulsa` era chave de
    // FORMULÁRIO, e o cookie sobrevive 60 s ao painel fechado.
    expect(chaveDe('/admin/agenda?novo=avulsa&nd=2026-08-04&nt=14:00')).not.toBe(
      chaveDe('/admin/agenda?novo=avulsa&nd=2026-08-05&nt=15:00'),
    )
  })

  it('nenhum campo guardado é, ao mesmo tempo, geometria de URL', () => {
    // A invariante que impede o vazamento de voltar por descuido: se alguém
    // acrescentar `motivo` à allowlist, ou `cortesia` à porta, isto reprova.
    for (const tela of [
      CASA,
      { tela: 'periodo' } as const,
      { tela: 'remarcar', instance: 'x' } as const,
    ])
      for (const chave of chavesDaTela(tela, true))
        expect(CAMPOS_GUARDADOS, `"${chave}" viaja na URL E no cookie`).not.toContain(chave)
  })

  it('toda porta tem lista, e nenhuma lista tem campo repetido', () => {
    for (const [nome, campos] of Object.entries(CAMPOS_DA_PORTA))
      expect(new Set(campos).size, `${nome}: campo repetido na porta`).toBe(campos.length)
  })
})

/* ========================================================================== */
/* 3. AS ACTIONS DA SEÇÃO NÃO ESCREVEM `?msg=` — nenhuma, nem por engano       */
/* ========================================================================== */

describe('A7/3 · a ponte legada morreu no arquivo das actions', () => {
  const fonte = readFileSync(join(process.cwd(), 'src/app/admin/agenda/actions.ts'), 'utf8')

  it('só UMA função monta `msg=` — a ponte declarada da ficha', () => {
    // O varredor: qualquer `msg=` novo neste arquivo é uma action legada
    // renascendo. A única permitida é `backParaAFicha`, e a lápide dela explica
    // por quê (o cookie da seção tem `path` estreito e não chega a
    // `/admin/alunos`).
    const linhas = fonte
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => l.includes('msg=') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    expect(linhas.map(([n]) => n)).toHaveLength(1)
    // …e ela está DENTRO da função da ficha
    const corpo = fonte.slice(fonte.indexOf('async function backParaAFicha'))
    expect(corpo.slice(0, corpo.indexOf('\n}')).includes('msg=')).toBe(true)
  })

  it('a ponte é chamada SÓ pelo cancelamento que a ficha reusa', () => {
    const chamadas = [...fonte.matchAll(/backParaAFicha\(/g)].length
    // 1 declaração + as chamadas de `cancelClassAction`
    expect(chamadas).toBeGreaterThan(1)
    const cancel = fonte.slice(
      fonte.indexOf('export async function cancelClassAction'),
      fonte.indexOf('/* ---------------- porteiros de fuso'),
    )
    // todas as chamadas estão dentro dela
    expect([...cancel.matchAll(/backParaAFicha\(/g)].length).toBe(chamadas - 1)
  })

  it('`manter`, `na_url` e `rascunho` deixaram de ser lidos do formulário', () => {
    for (const morto of ["get('manter')", "get('na_url')", "get('rascunho')"])
      expect(fonte, `o transporte voltou a ler "${morto}" do cliente`).not.toContain(morto)
  })
})

/* ========================================================================== */
/* 4. DÍVIDA (a) — DUAS ABAS NÃO SE ATROPELAM                                  */
/* ========================================================================== */

describe('A7/4 · sucesso de um formulário não apaga o rascunho de outro', () => {
  it('o SUCESSO do lote não varre o que ficou digitado no painel da avulsa', async () => {
    // aba A: um erro no painel deixou o rascunho dela guardado
    await gravarRascunho(chaveDoPainel('avulsa'), { student_name: 'Maria Silva' })
    expect(rascunhoNoPote()!.chave).toBe(chaveDoPainel('avulsa'))

    // aba B: o lote dá CERTO (porta sem gaveta nenhuma)
    mock.respostaRpc = { data: 2 }
    await rodar(
      acoes.completeAllPendingAction,
      form({ teacher_id: PROFESSORA, instance_ids: 'p-1,p-2', back: '/admin/agenda' }),
    )

    // a aba A continua com o que era dela
    expect(await lerRascunho(chaveDoPainel('avulsa'))).toEqual({ student_name: 'Maria Silva' })
  })

  it('o SUCESSO do próprio formulário APAGA o rascunho dele (ato concluído não deixa rastro)', async () => {
    await gravarRascunho(chaveDoPainel('avulsa'), { student_name: 'Maria Silva' })
    mock.respostas.contracts = {
      data: { teacher_id: PROFESSORA, students: { iana_tz: 'America/Cuiaba' }, recurring_slots: [] },
    }
    mock.respostaRpc = { data: null, error: null }
    await rodar(
      acoes.createSingleClassAction,
      form({
        contract_id: 'c-1',
        kind: 'extra_paid',
        local_date: '2026-08-05',
        local_time: '14:00',
        duration_min: '45',
        back: '/admin/agenda',
        back_erro: '/admin/agenda?novo=avulsa',
      }),
    )
    expect(rascunhoNoPote(), 'o rascunho do próprio formulário sobreviveu ao sucesso').toBeNull()
  })

  it('`esquecerRascunho` de OUTRA chave é no-op; sem chave (signout) varre tudo', async () => {
    await gravarRascunho(chaveDoRemarcar('aula-1'), { motivo: 'imprevisto' })
    await esquecerRascunho(chaveDoPainel('avulsa'))
    expect(rascunhoNoPote()!.chave).toBe(chaveDoRemarcar('aula-1'))
    // chave vazia = formulário sem gaveta: não toca em nada
    await esquecerRascunho('')
    expect(rascunhoNoPote()).not.toBeNull()
    // o signout continua varrendo — ali a varredura cega É o certo
    await esquecerRascunho()
    expect(rascunhoNoPote()).toBeNull()
  })

  it('gravar VAZIO apaga só a própria gaveta', async () => {
    await gravarRascunho(chaveDoRemarcar('aula-1'), { motivo: 'imprevisto' })
    await gravarRascunho(chaveDoPainel('avulsa'), {})
    expect(rascunhoNoPote()!.chave).toBe(chaveDoRemarcar('aula-1'))
    await gravarRascunho(chaveDoRemarcar('aula-1'), {})
    expect(rascunhoNoPote()).toBeNull()
  })
})

/* ========================================================================== */
/* 5. DÍVIDA (b) — O RECADO NÃO REPINTA EM NAVEGAÇÃO                           */
/* ========================================================================== */

describe('A7/5 · o recado é do ENDEREÇO, não da seção', () => {
  it('ele aparece no destino do ato…', async () => {
    await gravarRecado('agenda', '✓ Aula registrada', '/admin/agenda?v=dia&d=2026-08-04')
    expect(await lerRecado('agenda', '/admin/agenda?v=dia&d=2026-08-04')).toMatchObject({
      mensagem: '✓ Aula registrada',
    })
  })

  it('…e NÃO repinta quando ela toca em outra aba da seção nos 15 s', async () => {
    await gravarRecado('agenda', '✓ Aula registrada', '/admin/agenda?v=dia&d=2026-08-04')
    // o toque na aba Pendências: mesma seção, mesmo cookie vivo, OUTRO endereço
    expect(
      await lerRecado('agenda', '/admin/agenda?v=pendencias'),
      'o ✓ repintou noutra aba — num ato de dinheiro isso lê como um segundo registro',
    ).toBeNull()
    // nem nas outras duas telas da seção
    expect(await lerRecado('agenda', '/admin/agenda/periodo')).toBeNull()
    expect(await lerRecado('agenda', '/admin/agenda/remarcar/aula-1')).toBeNull()
  })

  it('PREÇO DECLARADO: o F5 no PRÓPRIO destino continua mostrando (é o de antes)', async () => {
    await gravarRecado('agenda', '✓ Aula registrada', '/admin/agenda')
    expect(await lerRecado('agenda', '/admin/agenda')).not.toBeNull()
    expect(await lerRecado('agenda', '/admin/agenda')).not.toBeNull()
  })

  it('recado SEM destino continua valendo em qualquer tela (o caso de Ajustes)', async () => {
    await gravarRecado('ajustes', 'Política salva.')
    expect(await lerRecado('ajustes', '/admin/ajustes')).toMatchObject({ mensagem: 'Política salva.' })
    expect(await lerRecado('ajustes')).not.toBeNull()
  })

  it('PONTA A PONTA: a action grava o destino que ela mesma monta', async () => {
    mock.respostaRpc = { data: 2 }
    const url = await rodar(
      acoes.completeAllPendingAction,
      form({
        teacher_id: PROFESSORA,
        instance_ids: 'p-1,p-2',
        back: '/admin/agenda?v=pendencias&prof=' + PROFESSORA,
      }),
    )
    expect(recadoNoPote()!.destino).toBe(url)
    // …e é exatamente esse endereço que a página reconstrói ao chegar
    const sp: Record<string, string> = Object.fromEntries(
      new URLSearchParams(url.split('?')[1] ?? ''),
    )
    expect(enderecoDaTela(CASA, geometriaCanonica(CASA, true, (k) => sp[k]))).toBe(url)
  })

  it('PONTA A PONTA no ERRO: o destino gravado reabre o painel, e é o do recado', async () => {
    mock.respostas.contracts = {
      data: { teacher_id: PROFESSORA, students: { iana_tz: 'America/Cuiaba' }, recurring_slots: [] },
    }
    mock.respostaRpc = { data: null, error: { message: 'horário conflita' } }
    const url = await rodar(
      acoes.createSingleClassAction,
      form({
        contract_id: 'c-1',
        kind: 'extra_paid',
        local_date: '2026-08-05',
        local_time: '14:00',
        duration_min: '45',
        back: '/admin/agenda',
        back_erro: '/admin/agenda?novo=avulsa',
      }),
    )
    expect(url).toBe('/admin/agenda?novo=avulsa')
    expect(recadoNoPote()!.destino).toBe(url)
    // …e a gaveta é a DAQUELE painel
    expect(rascunhoNoPote()!.chave).toBe(chaveDoPainel('avulsa'))
  })
})

/* ========================================================================== */
/* 6. DÍVIDA (c) — OS CHAMADORES EXTERNOS                                      */
/* ========================================================================== */

describe('A7/6 · quem entra e quem sai da seção por fora continua funcionando', () => {
  it('a FICHA continua recebendo o recado dela: `cancelClassAction` não migrou', async () => {
    // O cookie da seção tem `path: /admin/agenda` — gravá-lo aqui seria cancelar
    // a aula e a dona não ver recado nenhum na ficha.
    mock.respostaRpc = { data: null, error: null }
    mock.respostas.audit_log = { data: { diff: { credited: false } } }
    const url = await rodar(
      acoes.cancelClassAction,
      form({
        instance_id: 'aula-1',
        cancelled_by: 'student',
        back: '/admin/alunos/a-1?aba=historico',
      }),
    )
    expect(url.startsWith('/admin/alunos/a-1?aba=historico')).toBe(true)
    expect(url).toContain('msg=')
    expect(recadoNoPote(), 'a frase foi para um cookie que a ficha nunca recebe').toBeNull()
  })

  it('…e ela IGNORA `manter`/`na_url`/`back_erro` mesmo forjados', async () => {
    mock.respostaRpc = { data: null, error: null }
    mock.respostas.audit_log = { data: { diff: { credited: false } } }
    const url = await rodar(
      acoes.cancelClassAction,
      form({
        instance_id: 'aula-1',
        cancelled_by: 'student',
        back: '/admin/alunos/a-1?aba=historico',
        back_erro: '/admin/alunos/a-1?off_note=mãe%20internada',
        manter: 'off_note',
        na_url: 'off_note',
        off_note: 'mãe internada',
      }),
    )
    expect(url).not.toContain('internada')
    expect(url).not.toContain('off_note')
  })

  it('entrada externa em `/admin/agenda/remarcar/<id>` volta para a AGENDA no sucesso', async () => {
    // A ficha e o Início linkam direto para a remarcação, sem `back`. O sucesso
    // não pode voltar para a página daquela aula: ela deixou de existir como
    // estava (a remarcação cria instância nova).
    mock.respostaRpc = { data: 'nova-1', error: null }
    const url = await rodar(
      acoes.adminBookWindowAction,
      form({ instance_id: 'aula-1', window_id: 'w-1' }),
    )
    expect(url).toBe('/admin/agenda')
    expect(recadoNoPote()!.mensagem).toContain('Aula remarcada')
    expect(recadoNoPote()!.destino).toBe('/admin/agenda')
  })

  it('…e o ERRO volta para a página DAQUELA aula, com as escolhas', async () => {
    mock.respostaRpc = { data: null, error: { message: 'no_overlap' } }
    const url = await rodar(
      acoes.adminBookWindowAction,
      form({ instance_id: 'aula-1', window_id: 'w-1', cortesia: '1', motivo: 'imprevisto', escolha: 'w-1' }),
    )
    expect(url).toBe('/admin/agenda/remarcar/aula-1?cortesia=1&escolha=w-1')
    expect(url).not.toContain('imprevisto')
    expect(rascunhoNoPote()!.campos.motivo).toBe('imprevisto')
  })

  it('id de aula TORTO não vira rota: a volta é a casa da seção', async () => {
    mock.respostaRpc = { data: null, error: { message: 'no_overlap' } }
    const url = await rodar(
      acoes.adminBookWindowAction,
      form({ instance_id: '../../ajustes', window_id: 'w-1' }),
    )
    expect(url).toBe('/admin/agenda')
  })

  it('o tratamento de período volta para o intervalo que ELE recebeu, não para o `back`', async () => {
    mock.respostaRpc = { data: { cancelled: 0, invited: 0, credited: 0, refund_blocked: 0 } }
    const url = await rodar(
      acoes.periodTreatmentAction,
      form({
        teacher_id: PROFESSORA,
        from: '2026-08-01',
        to: '2026-08-10',
        mode: 'block_only',
        note: 'férias da professora',
        // um `back` forjado, apontando para outro período e com texto pendurado
        back: '/admin/agenda/periodo?prof=' + PROFESSORA + '&de=1999-01-01&ate=1999-01-02&note=x',
      }),
    )
    expect(url).toBe(`/admin/agenda/periodo?prof=${PROFESSORA}&de=2026-08-01&ate=2026-08-10`)
    expect(url).not.toContain('férias')
  })
})

/* ========================================================================== */
/* 7. O GUARDA ARMADO — `SUBROTAS` conhece as três telas                       */
/* ========================================================================== */

describe('A7/7 · o porteiro do recado conhece as subrotas que existem', () => {
  it('as três telas do transporte são as três que o porteiro aceita', async () => {
    const { destinoDaSecao } = await import('@/lib/kit/recado')
    expect(destinoDaSecao('agenda', '/admin/agenda/periodo')).toBe('/admin/agenda/periodo')
    expect(destinoDaSecao('agenda', '/admin/agenda/remarcar/aula-1')).toBe(
      '/admin/agenda/remarcar/aula-1',
    )
    // subrota que NÃO existe cai na casa: no 404 ninguém pinta o recado
    expect(destinoDaSecao('agenda', '/admin/agenda/inventada')).toBe('/admin/agenda')
    // e fora da seção também
    expect(destinoDaSecao('agenda', '/admin/ajustes')).toBe('/admin/agenda')
  })

  it('todo caminho que o transporte monta passa pelo porteiro', async () => {
    const { destinoDaSecao } = await import('@/lib/kit/recado')
    for (const tela of [
      CASA,
      { tela: 'periodo' } as const,
      { tela: 'remarcar', instance: 'aula-1' } as const,
    ]) {
      const caminho = caminhoDaTela(tela)
      expect(destinoDaSecao('agenda', caminho), `${caminho} não sobrevive ao porteiro`).toBe(caminho)
    }
  })
})
