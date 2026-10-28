// ONDA DA AGENDA · VARREDURA FINAL — os achados do passe adversarial de
// fechamento da onda, na camada em que cada um vive.
//
// O que está aqui:
//   S1 · o "furar antecedência" chega ao motor de horários (`bypassLead`);
//   S4 · o motor de horários FALA quando não conseguiu ler — nunca devolve
//        "nenhum horário livre" por causa de um `{ error }` engolido;
//   S5 · o filtro de vagas usa o INTERVALO EXATO da aula, não minutos
//        arredondados;
//   S6 · a prévia do catálogo de mensagens cumprimenta QUEM RECEBE.
//
// Os outros três moram onde a prova é possível: S2/S3 contra o Postgres de
// verdade (`tests/aviso-troca-whatsapp.test.ts`), S7 na suíte das actions da
// disponibilidade (`tests/onda-agenda-a3.test.ts`), e o par S1/S4/S5 também na
// TELA do remarcar (`tests/onda-agenda-a7-telas.test.ts`) — aqui é a régua do
// motor, lá é a régua da página.

import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/google/sync', () => ({
  // Google indisponível é o caminho FAIL-OPEN com marcador (decisão M1-4, que
  // esta varredura NÃO muda): é agenda de fora, e o efeito dela é oferecer
  // horário a mais, que a reserva recusa.
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))

const { availableSlots } = await import('@/lib/portal/computed-slots')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const CUIABA = 'America/Cuiaba'
/** 2026-07-28 é uma TERÇA; 18:00Z = 14:00 em Cuiabá (−4 o ano inteiro). */
const AGORA = '2026-07-28T18:00:00Z'

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

/**
 * O cliente falso: uma resposta por TABELA. Tudo o que `availableSlots` encadeia
 * (`select`/`eq`/`gt`/`lte`/`lt`/`order`/`maybeSingle`) devolve o mesmo objeto,
 * e o `then` entrega `{ data, error }` — o formato do PostgREST.
 */
function clienteCom(respostas: Record<string, Resposta>): SupabaseClient {
  const consulta = (r: Resposta) => {
    const eu: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'order', 'limit'])
      eu[m] = () => eu
    eu.maybeSingle = () => eu
    eu.then = <A, B>(ok: (v: unknown) => A, falha?: (e: unknown) => B) =>
      Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, falha)
    return eu
  }
  return {
    from: (tabela: string) => consulta(respostas[tabela] ?? { data: [] }),
  } as unknown as SupabaseClient
}

/** As cinco leituras do motor, no estado "tudo respondeu". */
const AGENDA_VIVA: Record<string, Resposta> = {
  reschedule_windows: { data: [] },
  class_instances: { data: [] },
  teacher_public: { data: { min_booking_lead_hours: 12 } },
  teacher_weekly_availability: { data: [] },
  teacher_availability_exceptions: { data: [] },
}

/** Uma janela semanal na quinta (convenção do banco: 0=dom … 6=sáb). */
const QUINTA_MANHA = {
  weekday: 4,
  start_local: '09:00:00',
  end_local: '11:00:00',
  iana_tz: CUIABA,
}

async function grade(
  respostas: Record<string, Resposta>,
  opts: { durationMs: number; bypassLead?: boolean },
) {
  return availableSlots(
    clienteCom({ ...AGENDA_VIVA, ...respostas }),
    {} as SupabaseClient,
    PROFESSORA,
    opts,
  )
}

/** Os horários oferecidos, em civil de Cuiabá — como a tela os mostra. */
function horarios(r: Awaited<ReturnType<typeof grade>>): string[] {
  return (r.dado?.slots ?? []).map((s) =>
    DateTime.fromISO(s.startsAtUtc).setZone(CUIABA).toFormat('dd/LL HH:mm'),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(AGORA))
})
afterEach(() => {
  vi.useRealTimers()
})

/* ========================================================================== */
/* S4 — leitura que falha é DITA, nunca vira grade vazia                       */
/* ========================================================================== */

describe('varredura final · S4: o motor de horários não inventa disponibilidade', () => {
  const MEIA_HORA = 30 * 60_000

  it('QUALQUER uma das cinco leituras com {error} devolve erro — nenhuma delas é opcional', async () => {
    // Cada linha aqui é um mundo em que a grade mentiria de um jeito diferente:
    // sem as janelas publicadas, ela esconde o que existe; sem as aulas ou sem
    // os bloqueios, ela OFERECE horário ocupado; sem a professora, o corte de
    // antecedência cai no padrão de 12 h, que pode não ser o dela; sem a agenda
    // semanal, some a grade computada inteira.
    for (const tabela of [
      'reschedule_windows',
      'class_instances',
      'teacher_public',
      'teacher_weekly_availability',
      'teacher_availability_exceptions',
    ]) {
      const r = await grade({ [tabela]: { error: { message: 'timeout' } } }, { durationMs: MEIA_HORA })
      expect(r.erro, tabela).toBe(true)
      expect(r.dado, tabela).toBeNull()
    }
  })

  it('PROVA DE MUTAÇÃO: com as cinco respondendo, a mesma grade sai cheia e sem erro', async () => {
    // Sem esta metade, o teste acima passaria com uma função que só sabe falhar.
    const r = await grade(
      { teacher_weekly_availability: { data: [QUINTA_MANHA] } },
      { durationMs: MEIA_HORA },
    )
    expect(r.erro).toBe(false)
    expect(horarios(r)).toContain('30/07 09:00')
  })

  it('a AULA JÁ MARCADA continua saindo da oferta (é o que o `{error}` engolido apagava)', async () => {
    const r = await grade(
      {
        teacher_weekly_availability: { data: [QUINTA_MANHA] },
        class_instances: {
          data: [{ starts_at_utc: '2026-07-30T13:00:00Z', ends_at_utc: '2026-07-30T13:45:00Z' }],
        },
      },
      { durationMs: MEIA_HORA },
    )
    // 13:00Z = 09:00 em Cuiabá: a aula ocupa 09:00 e 09:30, e a grade só volta
    // às 10:00.
    expect(horarios(r)).not.toContain('30/07 09:00')
    expect(horarios(r)).not.toContain('30/07 09:30')
    expect(horarios(r)).toContain('30/07 10:00')
  })
})

/* ========================================================================== */
/* S5 — a duração é o intervalo EXATO                                          */
/* ========================================================================== */

describe('varredura final · S5: o vão tem de caber a aula inteira', () => {
  /** Um vão de exatamente 30 minutos na quinta de manhã. */
  const VAO_DE_30 = {
    teacher_weekly_availability: {
      data: [{ ...QUINTA_MANHA, end_local: '09:30:00' }],
    },
  }

  it('30 min cabem no vão de 30 min; 30m20s NÃO cabem', async () => {
    expect(horarios(await grade(VAO_DE_30, { durationMs: 30 * 60_000 }))).toEqual([
      '30/07 09:00',
      '06/08 09:00',
    ])
    // 20 segundos a mais — o arredondamento antigo (`Math.round(ms/60_000)`)
    // dizia "30 min" e oferecia este vão, e a recusa vinha da RPC depois da
    // confirmação.
    expect(horarios(await grade(VAO_DE_30, { durationMs: 30 * 60_000 + 20_000 }))).toEqual([])
  })

  it('os 20 segundos também contam CONTRA a aula seguinte', async () => {
    // A aula das 09:30 começa 30 min depois; uma aula de 30m20s às 09:00
    // invadiria 20 s dela. A régua é a mesma do banco.
    const r = await grade(
      {
        teacher_weekly_availability: { data: [QUINTA_MANHA] },
        class_instances: {
          data: [{ starts_at_utc: '2026-07-30T13:30:00Z', ends_at_utc: '2026-07-30T14:15:00Z' }],
        },
      },
      { durationMs: 30 * 60_000 + 20_000 },
    )
    expect(horarios(r)).not.toContain('30/07 09:00')
  })
})

/* ========================================================================== */
/* S1 — o furar antecedência atravessa até o motor                             */
/* ========================================================================== */

describe('varredura final · S1: `bypassLead` mostra o que a RPC aceitaria', () => {
  /** Uma janela publicada para daqui a 2 h — dentro das 12 h de antecedência. */
  const JANELA_CEDO = {
    reschedule_windows: { data: [{ id: 'w-cedo', starts_at_utc: '2026-07-28T20:00:00Z' }] },
  }

  it('sem o furar, a janela dentro do prazo é cortada; com ele, aparece', async () => {
    const cortada = await grade(JANELA_CEDO, { durationMs: 45 * 60_000 })
    expect(horarios(cortada)).toEqual([])

    const comFurar = await grade(JANELA_CEDO, { durationMs: 45 * 60_000, bypassLead: true })
    expect(horarios(comFurar)).toEqual(['28/07 16:00'])
    // e continua sendo JANELA PUBLICADA (leva o id — é o caminho clássico de
    // consumo, não o do horário novo)
    expect(comFurar.dado!.slots[0].windowId).toBe('w-cedo')
  })

  it('o PASSADO nunca cabe, nem com o furar ligado', async () => {
    // Com o corte de antecedência de pé, era ELE que escondia a hora vencida —
    // a grade computada começa no início do dia CIVIL de hoje, e as 09:00 de
    // hoje já passaram às 14:00.
    const hoje = {
      teacher_weekly_availability: {
        // terça (28/07), 09:00–11:00: a primeira metade já passou
        data: [{ weekday: 2, start_local: '09:00:00', end_local: '16:00:00', iana_tz: CUIABA }],
      },
    }
    const r = await grade(hoje, { durationMs: 30 * 60_000, bypassLead: true })
    const deHoje = horarios(r).filter((h) => h.startsWith('28/07'))
    expect(deHoje, 'a grade ofereceu uma hora que já passou').not.toContain('28/07 09:00')
    expect(deHoje, 'a grade ofereceu a própria hora atual como se ela ainda estivesse à frente')
      .not.toContain('28/07 14:00')
    // …e o que ainda está à frente hoje continua sendo oferecido — é para isso
    // que o furar existe.
    expect(deHoje).toContain('28/07 14:30')
  })

  it('o aluno NÃO tem a chave: sem `bypassLead`, o corte da professora vale', async () => {
    // O portal chama o mesmo motor e nunca passa a opção — a régua do aluno é a
    // antecedência mínima dela, e é o default.
    const r = await grade(JANELA_CEDO, { durationMs: 45 * 60_000 })
    expect(r.erro).toBe(false)
    expect(r.dado!.slots).toEqual([])
  })
})

/* ========================================================================== */
/* S6 — a prévia do catálogo cumprimenta quem RECEBE                           */
/* ========================================================================== */

const { catalogoDeMensagens } = await import('@/data/admin/ajustes-mensagens')

describe('varredura final · S6: o exemplo do aviso interno não cumprimenta a aluna', () => {
  const RELOGIO = DateTime.fromISO('2026-08-03T15:00:00Z', { zone: 'utc' })

  /** Uma mensagem do catálogo pelo nome humano (o único que a tela mostra). */
  function mensagem(nome: string) {
    const m = catalogoDeMensagens(RELOGIO)
      .flatMap((b) => b.mensagens)
      .find((x) => x.nome === nome)
    if (!m) throw new Error(`mensagem "${nome}" sumiu do catálogo`)
    return m
  }

  it('a troca de WhatsApp é lida como a PROFESSORA a lê', async () => {
    const m = mensagem('WhatsApp do aluno mudou (aviso para a professora)')
    // O defeito: «Oi, Marina! Marina atualizou o WhatsApp no portal» — a tela
    // que existe para a dona conferir PARA QUEM cada mensagem vai dizia que o
    // aviso interno vai para a aluna.
    expect(m.corpoEmail).toContain('Oi, Vicky!')
    expect(m.corpoEmail, 'a prévia cumprimentou a própria aluna de quem ela fala').not.toContain(
      'Oi, Marina!',
    )
    // …e o assunto continua sendo sobre a aluna, que é o fato da mensagem
    expect(m.assunto).toContain('Marina')
    expect(m.corpoEmail).toContain('Marina')
  })

  it('o aviso interno da fábrica de conteúdo também', async () => {
    const m = mensagem('Conteúdo esperando revisão (aviso interno)')
    for (const corpo of [m.corpoEmail, m.corpoWhatsapp]) {
      expect(corpo).toBeTruthy()
      expect(corpo, 'aviso interno cumprimentando a aluna').not.toContain('Marina')
    }
  })

  it('PROVA DE MUTAÇÃO: as mensagens DO ALUNO continuam cumprimentando o aluno', async () => {
    // Sem esta metade, trocar o destinatário de todas as entradas passaria.
    const m = mensagem('Lembrete de aula')
    expect(m.corpoEmail).toContain('Marina')
    expect(m.corpoWhatsapp).toContain('Marina')
  })
})
