// ONDA DA AGENDA · LOTE FINAL — os achados da REVISÃO INDEPENDENTE FRESCA do A6.
//
// Três correções, e cada uma nasceu de um defeito que os varredores existentes
// NÃO pegavam. É esse ponto cego que este arquivo fecha:
//
//   F1 (M1) · A COR DA FRASE COMPOSTA. `tests/portal-nav.test.ts` lê os
//      literais do módulo UM A UM, e um literal solto que não está na lista de
//      acertos cai no vermelho por default — então os dois ramos em que NADA
//      chega ao aluno "passavam" naquele varredor enquanto saíam VERDES na
//      tela, porque o que chega à tela é a frase COMPOSTA ("Aula cancelada …" +
//      o pedaço da entrega), e ela abre com prefixo de sucesso enumerado. Aqui
//      a cor é medida onde ela existe: no recado que a action grava, montado
//      pela própria action, com os 12 estados de escolha × entregabilidade.
//
//   F2 (M2) · A VOLTA DE ERRO DA FICHA. O painel "cancelar" reusa
//      `cancelClassAction`, e a recusa do banco fechava o Sheet, devolvia texto
//      CRU de banco e religava em silêncio o canal que a dona tinha desmarcado.
//      Prova funcional, com a action de verdade: para onde ela volta, o que
//      guarda e o que a dona lê.
//
//   F3 (M3) · O `max` QUE ENVELHECE. Com a aba aberta desde as 9h, o campo da
//      hora do aviso recusava "hoje 15:40" como se fosse FUTURO. O conserto é
//      renovar a hora-limite no momento do toque, no fuso do NEGÓCIO — e a
//      ORDEM importa: renovar DEPOIS de ler a validade seria não consertar
//      nada.
//
// Padrão de dublês: o mesmo do a4/a5/a7 (cliente Supabase falso, `redirect`
// que estoura, pote de cookies, relógio congelado). Nada aqui toca o Postgres —
// a prova de banco deste lote é `tests/aviso-troca-whatsapp.test.ts`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { RASCUNHO_COOKIE } from '@/lib/admin/rascunho-do-formulario'
import { chaveDoCancelamentoDaFicha } from '@/lib/admin/chaves-de-rascunho'
import { AVISO_NO_FUTURO, CONSEQUENCIA } from '@/lib/admin/desfecho-da-aula'
import { tomDoAviso, type TomDoAviso } from '@/lib/kit/tom-do-aviso'

/* ========================================================================== */
/* Dublês (o padrão do a4/a5/a7)                                               */
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
const { cookieDoRecado } = await import('@/lib/kit/recado')
const acoes = await import('@/app/admin/agenda/actions')

let pote: PoteDeCookies

/** Relógio congelado: 18:00 UTC = 14:00 em Cuiabá (o fuso do negócio, sem DST). */
const AGORA_UTC = '2026-07-28T18:00:00Z'
const AGORA_NO_NEGOCIO = '2026-07-28T14:00'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(AGORA_UTC))
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  mock.respostas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
})
afterEach(() => {
  vi.useRealTimers()
})

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
/* F1 · A COR DA FRASE COMPOSTA — os 12 estados do aviso                       */
/* ========================================================================== */

/** Os três estados de ENTREGABILIDADE que a tela sabe declarar. */
const ENTREGABILIDADE = {
  // aluno com portal e com número
  completa: { entrega_email: '1', entrega_whatsapp: '1' },
  // aluno com portal, sem número no cadastro
  semNumero: { entrega_email: '1', entrega_whatsapp: '0' },
  // aluno sem acesso ao portal (e por consequência sem perfil, logo sem número)
  semPortal: { entrega_email: '0', entrega_whatsapp: '0' },
  // aula de GRUPO: a tela NÃO SABE, e "não sei" nunca vira "não"
  grupo: { entrega_email: '', entrega_whatsapp: '' },
} as const

/**
 * O recado que a dona LÊ depois de cancelar — a frase INTEIRA, montada pela
 * própria action. É este texto que o `AvisoLegado` classifica.
 *
 * `cancelada_aluno` de propósito: é o ramo direto (sem leitura de trilha), e o
 * pedaço da entrega é o MESMO nos dois cancelamentos.
 */
async function recadoDoCancelamento(
  canais: { email: string; whatsapp: string },
  entrega: Record<string, string>,
): Promise<string> {
  await rodar(
    acoes.registrarDesfechoDaAulaAction,
    form({
      instance_id: 'aula-1',
      desfecho: 'cancelada_aluno',
      back: '/admin/agenda',
      canais: '1',
      avisar_email: canais.email,
      avisar_whatsapp: canais.whatsapp,
      ...entrega,
    }),
  )
  const recado = recadoNoPote()
  if (!recado) throw new Error('a action não gravou recado nenhum')
  return recado.mensagem
}

/**
 * A MATRIZ INTEIRA: 4 combinações de caixa × 3 de entregabilidade.
 *
 * VERMELHO onde ela MARCOU pelo menos um canal e algum recado marcado não foi
 * registrado — sucesso parcial não é sucesso. VERDE onde tudo o que ela pediu
 * foi registrado, e também onde ela não pediu nada (o ato aconteceu como ela
 * quis; a frase não fica muda, mas não é falha).
 */
const MATRIZ: ReadonlyArray<
  readonly [string, { email: string; whatsapp: string }, Record<string, string>, TomDoAviso]
> = [
  // ---- ela marcou OS DOIS ----
  ['os dois marcados, entrega completa', { email: '1', whatsapp: '1' }, ENTREGABILIDADE.completa, 'sucesso'],
  ['os dois marcados, sem número', { email: '1', whatsapp: '1' }, ENTREGABILIDADE.semNumero, 'erro'],
  ['os dois marcados, sem portal', { email: '1', whatsapp: '1' }, ENTREGABILIDADE.semPortal, 'erro'],
  // ---- só E-MAIL ----
  ['só e-mail, entrega completa', { email: '1', whatsapp: '0' }, ENTREGABILIDADE.completa, 'sucesso'],
  ['só e-mail, sem número (o WhatsApp nem era possível)', { email: '1', whatsapp: '0' }, ENTREGABILIDADE.semNumero, 'sucesso'],
  // ⚠️ M1: este saía VERDE — ela marcou o e-mail, o aluno não tem portal, e
  // NADA chegou nele.
  ['só e-mail, sem portal — NADA chega ao aluno', { email: '1', whatsapp: '0' }, ENTREGABILIDADE.semPortal, 'erro'],
  // ---- só WHATSAPP ----
  ['só WhatsApp, entrega completa', { email: '0', whatsapp: '1' }, ENTREGABILIDADE.completa, 'sucesso'],
  // ⚠️ M1: e este também — ela marcou o WhatsApp e não há número.
  ['só WhatsApp, sem número — NADA chega ao aluno', { email: '0', whatsapp: '1' }, ENTREGABILIDADE.semNumero, 'erro'],
  ['só WhatsApp, sem portal — NADA chega ao aluno', { email: '0', whatsapp: '1' }, ENTREGABILIDADE.semPortal, 'erro'],
  // ---- NENHUM (decisão dela: acerto declarado, mas nunca mudo) ----
  ['nenhum marcado, entrega completa', { email: '0', whatsapp: '0' }, ENTREGABILIDADE.completa, 'sucesso'],
  ['nenhum marcado, sem número', { email: '0', whatsapp: '0' }, ENTREGABILIDADE.semNumero, 'sucesso'],
  ['nenhum marcado, sem portal', { email: '0', whatsapp: '0' }, ENTREGABILIDADE.semPortal, 'sucesso'],
]

describe('lote final · F1 — a COR é a da frase composta, não a do pedaço', () => {
  it.each(MATRIZ)('%s → %#', async (_nome, canais, entrega, tom) => {
    const frase = await recadoDoCancelamento(canais, entrega)
    expect(tomDoAviso(frase), frase).toBe(tom)
  })

  it('OS DOIS RAMOS DO M1: ela marcou, nada chegou, e o recado é VERMELHO', async () => {
    // O pino contra a regressão exata que a revisão fresca achou. Nos dois
    // casos a frase abre com "Aula cancelada", que é prefixo de SUCESSO
    // enumerado em `tomDoAviso` — sem um marcador de falha parcial na frase
    // inteira, os dois voltam a sair com o ✓ da casa em cima de um aluno que
    // não foi avisado.
    const soEmailSemPortal = await recadoDoCancelamento(
      { email: '1', whatsapp: '0' },
      ENTREGABILIDADE.semPortal,
    )
    const soWhatsappSemNumero = await recadoDoCancelamento(
      { email: '0', whatsapp: '1' },
      ENTREGABILIDADE.semNumero,
    )
    for (const frase of [soEmailSemPortal, soWhatsappSemNumero]) {
      expect(frase.startsWith('Aula cancelada'), frase).toBe(true)
      expect(tomDoAviso(frase), frase).toBe('erro')
    }
  })

  it('a AULA DE GRUPO ("não sei") continua sendo tratada como entrega de pé', async () => {
    // "Não sei" nunca vira "não": o enfileiramento é por MEMBRO, e inventar a
    // recusa aqui seria afirmar sobre a vida de N cadastros diferentes.
    const frase = await recadoDoCancelamento({ email: '1', whatsapp: '1' }, ENTREGABILIDADE.grupo)
    expect(tomDoAviso(frase), frase).toBe('sucesso')
  })

  it('envio SEM a marca `canais` mantém os dois avisos (o default da RPC)', async () => {
    // A rede que impede um formulário velho/forjado de virar cancelamento
    // silencioso: sem `canais=1`, a escolha não existe e os dois canais valem.
    const url = await rodar(
      acoes.registrarDesfechoDaAulaAction,
      form({ instance_id: 'aula-1', desfecho: 'cancelada_aluno', back: '/admin/agenda' }),
    )
    expect(url).toBe('/admin/agenda')
    const [, args] = mock.rpcs.find(([fn]) => fn === 'cancel_class')!
    expect(args).toMatchObject({ p_notify_email: true, p_notify_whatsapp: true })
  })
})

/* ========================================================================== */
/* F4 · O QUE AS FRASES NÃO PODEM DIZER                                        */
/* ========================================================================== */

describe('lote final · F4 — a frase não afirma o que não sabe', () => {
  it('sem portal, ninguém é mandado olhar "a agenda dele"', async () => {
    // Menor 1: "Ele descobre a aula cancelada sozinho, na agenda dele" manda o
    // aluno SEM acesso ao portal olhar uma tela que ele não tem.
    for (const canais of [
      { email: '1', whatsapp: '1' },
      { email: '1', whatsapp: '0' },
      { email: '0', whatsapp: '1' },
      { email: '0', whatsapp: '0' },
    ]) {
      const frase = await recadoDoCancelamento(canais, ENTREGABILIDADE.semPortal)
      expect(frase, frase).not.toContain('na agenda dele')
    }
  })

  it('"você escolheu não avisar" só aparece quando o canal ERA entregável', async () => {
    // Menor 2: a caixa nasce desmarcada quando não há para onde mandar — ali a
    // tela decidiu, não ela. Atribuir a decisão à dona é falsificar o registro
    // do que aconteceu.
    const semPortal = await recadoDoCancelamento({ email: '1', whatsapp: '0' }, ENTREGABILIDADE.semPortal)
    expect(semPortal, semPortal).not.toContain('você escolheu')
    const semNumeroSoEmail = await recadoDoCancelamento({ email: '1', whatsapp: '0' }, ENTREGABILIDADE.semNumero)
    expect(semNumeroSoEmail, semNumeroSoEmail).not.toContain('você escolheu')
    const nadaSemPortal = await recadoDoCancelamento({ email: '0', whatsapp: '0' }, ENTREGABILIDADE.semPortal)
    expect(nadaSemPortal, nadaSemPortal).not.toContain('você escolheu')

    // …e continua aparecendo onde É verdade: a caixa nasceu MARCADA e ela
    // desmarcou. Sem esta metade, o teste acima passaria com a frase muda.
    const escolhaDela = await recadoDoCancelamento({ email: '1', whatsapp: '0' }, ENTREGABILIDADE.completa)
    expect(escolhaDela).toContain('você escolheu não avisar por WhatsApp')
  })

  it('o alerta do estorno bloqueado não atribui escolha a quem não escolheu', async () => {
    // Mesmo defeito, na frase irmã: "você escolheu não avisar o aluno" saía
    // para o aluno SEM portal, em que as duas caixas nasceram desmarcadas.
    mock.respostas.audit_log = {
      data: { diff: { refund_blocked: 'gasto sem identidade (anterior à F1)' } },
    }
    await rodar(
      acoes.registrarDesfechoDaAulaAction,
      form({
        instance_id: 'aula-1',
        desfecho: 'cancelada_professora',
        back: '/admin/agenda',
        canais: '1',
        avisar_email: '0',
        avisar_whatsapp: '0',
        ...ENTREGABILIDADE.semPortal,
      }),
    )
    const frase = recadoNoPote()!.mensagem
    expect(frase).toContain('nenhum aviso foi registrado para o aluno')
    expect(frase).not.toContain('você escolheu')
    // …e o ramo do dinheiro continua VERMELHO: o crédito não voltou.
    expect(tomDoAviso(frase), frase).toBe('erro')
  })

  it('a consequência de "realizada" não manda escolher um tema "abaixo"', () => {
    // Menor 3: a MESMA frase é lida na linha da matriz (onde o campo fica logo
    // abaixo) e dentro do AlertDialog (onde o campo ficou ATRÁS do véu).
    expect(CONSEQUENCIA.realizada).not.toContain('abaixo')
    expect(CONSEQUENCIA.realizada).toContain('"Tema"')
  })
})

/* ========================================================================== */
/* F2 · A VOLTA DE ERRO DO PAINEL "CANCELAR" DA FICHA                          */
/* ========================================================================== */

const FICHA = '/admin/alunos/a-1?aba=historico'

/** O envio do painel da ficha, com a dona tendo DESMARCADO o WhatsApp. */
function envioDaFicha(extra: Record<string, string> = {}): FormData {
  return form({
    instance_id: 'aula-1',
    cancelled_by: 'teacher',
    back: FICHA,
    canais: '1',
    avisar_email: '1',
    avisar_whatsapp: '0',
    entrega_email: '1',
    entrega_whatsapp: '1',
    ...extra,
  })
}

describe('lote final · F2 — a recusa do banco não desfaz a decisão da dona', () => {
  it('a recusa REABRE o painel daquela aula (e não fecha o Sheet)', async () => {
    mock.respostaRpc = { data: null, error: { message: 'aula não está agendada' } }
    const url = await rodar(acoes.cancelClassAction, envioDaFicha())
    expect(url.startsWith('/admin/alunos/a-1?aba=historico&painel=cancelar&alvo=aula-1')).toBe(true)
    expect(url).toContain('msg=')
  })

  it('a escolha de canais, quem cancelou e a hora do aviso SOBREVIVEM à recusa', async () => {
    // O defeito que importa: sem isto, o segundo envio nasce com o WhatsApp
    // RELIGADO e o aluno recebe o recado que ela decidiu não mandar.
    mock.respostaRpc = { data: null, error: { message: 'aula não está agendada' } }
    await rodar(acoes.cancelClassAction, envioDaFicha({ notified_at: '2026-07-28T09:00' }))
    const rascunho = rascunhoNoPote()
    expect(rascunho!.chave).toBe(chaveDoCancelamentoDaFicha('aula-1'))
    expect(rascunho!.campos).toEqual({
      cancelled_by: 'teacher',
      notified_at: '2026-07-28T09:00',
      avisar_email: '1',
      avisar_whatsapp: '0',
    })
  })

  it('a gaveta é DAQUELA aula — a chave não colide com a matriz da Agenda', async () => {
    // A mesma aula pode estar aberta no balão da Agenda e no painel da ficha:
    // são formulários com campos diferentes, e um não pode preencher o outro.
    const { chaveDoDesfecho } = await import('@/lib/admin/chaves-de-rascunho')
    expect(chaveDoCancelamentoDaFicha('aula-1')).not.toBe(chaveDoDesfecho('aula-1'))
  })

  it('a dona lê a MESMA frase da Agenda, não o texto cru do banco', async () => {
    mock.respostaRpc = {
      data: null,
      error: { message: 'cancel_class só se aplica a contratos private_1on1' },
    }
    const url = await rodar(acoes.cancelClassAction, envioDaFicha())
    const msg = decodeURIComponent(new URL(`http://x${url}`).searchParams.get('msg') ?? '')
    expect(msg).toContain('esta matriz registra desfecho só de aula particular 1:1')
    expect(msg).not.toContain('private_1on1')
    expect(tomDoAviso(msg), msg).toBe('erro')
  })

  it('a recusa da HORA DO AVISO (Lei 1) passa pelo mesmo caminho', async () => {
    // Hora com fuso escrito à mão: recusa da action, antes de tocar o banco.
    const url = await rodar(
      acoes.cancelClassAction,
      envioDaFicha({ notified_at: '2026-07-28T13:00Z' }),
    )
    expect(url).toContain('painel=cancelar')
    expect(mock.rpcs.filter(([fn]) => fn === 'cancel_class')).toHaveLength(0)
    expect(rascunhoNoPote()!.campos.avisar_whatsapp).toBe('0')
  })

  it('o SUCESSO fecha o painel e apaga a gaveta (ato concluído não deixa rastro)', async () => {
    mock.respostaRpc = { data: null, error: null }
    mock.respostas.audit_log = { data: { diff: { credited: true, expires_on: '2026-10-26' } } }
    // a gaveta existe de uma recusa anterior…
    const { gravarRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    await gravarRascunho(chaveDoCancelamentoDaFicha('aula-1'), { avisar_whatsapp: '0' })
    const url = await rodar(acoes.cancelClassAction, envioDaFicha())
    expect(url.startsWith('/admin/alunos/a-1?aba=historico&msg=')).toBe(true)
    expect(url).not.toContain('painel=cancelar')
    expect(rascunhoNoPote()).toBeNull()
  })

  it('`back` sem ficha legível cai na ponte de sempre e NÃO deixa cookie órfão', async () => {
    // Envio forjado / chamada de fora: sem painel para reabrir, guardar o que
    // ela digitou seria deixar um cookie que ninguém vai ler.
    mock.respostaRpc = { data: null, error: { message: 'aula não está agendada' } }
    const url = await rodar(acoes.cancelClassAction, envioDaFicha({ back: '/admin/agenda' }))
    expect(url.startsWith('/admin/agenda?msg=')).toBe(true)
    expect(rascunhoNoPote()).toBeNull()
  })

  it('nada do que ela digitou entra na URL da volta de erro', async () => {
    // A régua da casa desde o grave 5 do A4: endereço vai para histórico, log
    // do Cloudflare e captura de tela. Só GEOMETRIA viaja por lá.
    mock.respostaRpc = { data: null, error: { message: 'aula não está agendada' } }
    const url = await rodar(
      acoes.cancelClassAction,
      envioDaFicha({ notified_at: '2026-07-28T09:00', back_erro: '/admin/alunos/a-1?off_note=mãe' }),
    )
    const query = url.slice(url.indexOf('?'))
    expect(query).not.toContain('notified_at')
    expect(query).not.toContain('avisar_')
    expect(query).not.toContain('off_note')
    expect(query).not.toContain('cancelled_by')
  })
})

/* ========================================================================== */
/* F3 · A HORA-LIMITE É RENOVADA NO TOQUE                                      */
/* ========================================================================== */

/**
 * Um campo `datetime-local` com a validade VIVA: `rangeOverflow` é recalculado
 * a cada leitura, contra o `max` que estiver valendo NAQUELE momento — que é o
 * comportamento do navegador e é justamente o que a ordem das operações no
 * conserto depende.
 *
 * Dublê e não jsdom de propósito: a validação de restrição de `datetime-local`
 * no jsdom é parcial, e um teste que dependesse dela mediria o jsdom, não a
 * nossa régua. O que precisa ser provado aqui é a ORDEM (renovar o `max` ANTES
 * de ler a validade) e a FONTE do relógio (fuso do negócio), e as duas são
 * observáveis num campo de mentira.
 */
function campoDeMentira(valorDigitado: string, maxVelho: string) {
  return {
    max: maxVelho,
    frase: '',
    get validity() {
      return { rangeOverflow: valorDigitado > this.max }
    },
    setCustomValidity(m: string) {
      this.frase = m
    },
  }
}

describe('lote final · F3 — o `max` do servidor envelhece; a régua do toque não', () => {
  it('hora PASSADA com a aba aberta desde a manhã deixa de ser recusada', async () => {
    const { conferirHoraDoAviso } = await import('@/lib/admin/desfecho-da-aula')
    // A aba foi renderizada às 09:12 (fuso do negócio); agora são 14:00 e a
    // dona informa que o aviso chegou às 13:40 — passado, e o banco aceitaria.
    const campo = campoDeMentira('2026-07-28T13:40', '2026-07-28T09:12')
    conferirHoraDoAviso(campo as unknown as HTMLInputElement)
    expect(campo.max, 'o `max` não foi renovado pelo relógio do negócio').toBe(AGORA_NO_NEGOCIO)
    expect(campo.frase, 'a tela recusou uma hora que está no PASSADO').toBe('')
  })

  it('…e a hora REALMENTE futura continua recusada, com a frase da casa', async () => {
    const { conferirHoraDoAviso } = await import('@/lib/admin/desfecho-da-aula')
    const campo = campoDeMentira('2026-07-28T15:00', '2026-07-28T09:12')
    conferirHoraDoAviso(campo as unknown as HTMLInputElement)
    expect(campo.max).toBe(AGORA_NO_NEGOCIO)
    expect(campo.frase).toBe(AVISO_NO_FUTURO)
  })

  it('a hora-limite sai do FUSO DO NEGÓCIO, não do relógio de quem olha', async () => {
    // Lei 1: a zona é do servidor (`BUSINESS_TZ`); o cliente só contribui com o
    // instante. Às 18:00 UTC, Cuiabá marca 14:00 — e é 14:00 que vale.
    const { agoraNoNegocio } = await import('@/lib/admin/desfecho-da-aula')
    expect(agoraNoNegocio()).toBe(AGORA_NO_NEGOCIO)
  })

  it('o portão do CTA renova a régua ANTES de perguntar se o formulário é válido', () => {
    // A ordem é o conserto: `checkValidity()` antes da renovação leria a régua
    // velha, e o diálogo continuaria sem abrir.
    const fonte = readFileSync(
      join(process.cwd(), 'src/components/admin/agenda/ConfirmarDesfecho.tsx'),
      'utf8',
    )
    const corpo = fonte.slice(fonte.indexOf('function tentarAbrir'))
    const miolo = corpo.slice(0, corpo.indexOf('\n  }'))
    expect(miolo).toContain('conferirHoraDoAviso')
    expect(miolo.indexOf('conferirHoraDoAviso')).toBeLessThan(miolo.indexOf('checkValidity'))
  })

  it('as DUAS telas do campo usam a MESMA régua (nenhuma cópia sobrou)', () => {
    // Duas cópias de uma régua de hora é como uma delas fica para trás — foi
    // assim que a Agenda e a ficha divergiram na frase do erro, no A6.
    for (const arquivo of [
      'src/components/admin/agenda/DesfechoDaAula.tsx',
      'src/components/admin/alunos/ficha/CancelarAula.tsx',
    ]) {
      const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8')
      expect(fonte, arquivo).toContain("from '@/lib/admin/desfecho-da-aula'")
      expect(fonte, `${arquivo}: cópia local da régua`).not.toContain(
        'function conferirHoraDoAviso',
      )
    }
  })
})
