// Issue #40 · gate Sol S1 — a camada "disponível" do painel da professora.
//
// A janela semanal mora no fuso GRAVADO na linha (`w.iana_tz`), que é o que
// `_teacher_available_for` usa no banco. O painel convertia a janela no fuso
// ATUAL da professora (`teachers.iana_tz`): se ela mudou de NY para Lisboa,
// uma janela antiga de 09:00 em NY era desenhada às 09:00 de Lisboa, enquanto
// alunos e banco seguiam no instante de NY.
//
// Padrão do a3: cliente Supabase falso, relógio congelado, e o que se cobra é o
// que a PÁGINA entrega à grade (as props do CalendarGrid), não a fonte.
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'

interface Resposta {
  data?: unknown
}

class ConsultaFalsa {
  constructor(private readonly resposta: Resposta) {}
  select() { return this }
  eq() { return this }
  neq() { return this }
  in() { return this }
  order() { return this }
  gte() { return this }
  lte() { return this }
  limit() { return this }
  maybeSingle() { return this }
  then<A, B>(ok: (v: { data: unknown; error: unknown }) => A, falha?: (e: unknown) => B) {
    return Promise.resolve({ data: this.resposta.data ?? [], error: null }).then(ok, falha)
  }
}

const mock = vi.hoisted(() => ({ respostas: {} as Record<string, { data?: unknown }> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'perfil-da-professora' } } }) },
    from: (tabela: string) => new ConsultaFalsa(mock.respostas[tabela] ?? { data: [] }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/google/sync', () => ({
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))
vi.mock('@/lib/google/oauth', () => ({ googleOAuthConfigFromEnv: () => null }))
vi.mock('next/navigation', () => ({ redirect: () => {} }))
vi.mock('@/app/teacher/actions', () => ({
  addBlockAction: async () => {},
  addWeeklyAvailabilityAction: async () => {},
  cancelOwnClassAction: async () => {},
  cancelOwnWindowAction: async () => {},
  disconnectGoogleAction: async () => {},
  publishOwnWindowAction: async () => {},
  removeBlockAction: async () => {},
  removeWeeklyAvailabilityAction: async () => {},
  reportClassContentAction: async () => {},
}))

const { CalendarGrid } = await import('@/components/CalendarGrid')
const { default: TeacherPage } = await import('@/app/teacher/page')

interface EventoDaGrade {
  id: string
  startsAtUtc: string
  endsAtUtc: string
  avail?: boolean
}

/** Desce a árvore devolvida pela página até o CalendarGrid e lê as props. */
function eventosDaGrade(no: ReactNode): EventoDaGrade[] | null {
  if (Array.isArray(no)) {
    for (const filho of no) {
      const achou = eventosDaGrade(filho)
      if (achou) return achou
    }
    return null
  }
  if (!isValidElement(no)) return null
  const props = no.props as { children?: ReactNode; events?: EventoDaGrade[] }
  if (no.type === CalendarGrid) return props.events ?? []
  return eventosDaGrade(props.children)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-11T12:00:00Z')) // segunda; inverno em NY e em Lisboa
})
afterEach(() => {
  vi.useRealTimers()
})

describe('#40 · S1 · a janela semanal do painel mora no fuso GRAVADO nela', () => {
  it('professora hoje em Lisboa, janela antiga de terça 09:00–10:00 em NY: desenhada às 14:00 de Lisboa', async () => {
    mock.respostas = {
      teachers: { data: { id: 'prof-1', display_name: 'Professora', iana_tz: 'Europe/Lisbon' } },
      teacher_google_accounts: { data: null },
      teacher_weekly_availability: {
        data: [
          { id: 'w-ny', weekday: 2, start_local: '09:00:00', end_local: '10:00:00', iana_tz: 'America/New_York' },
        ],
      },
    }
    const arvore = await TeacherPage({ searchParams: Promise.resolve({ d: '2027-01-12' }) })
    const disponivel = (eventosDaGrade(arvore) ?? []).filter((e) => e.avail)
    expect(disponivel).toHaveLength(1)
    // 09:00 EST (−5) = 14:00Z = 14:00 em Lisboa (WET, +0)
    expect(DateTime.fromISO(disponivel[0].startsAtUtc).toUTC().toISO()).toBe('2027-01-12T14:00:00.000Z')
    expect(DateTime.fromISO(disponivel[0].endsAtUtc).toUTC().toISO()).toBe('2027-01-12T15:00:00.000Z')
  })

  it('a lista "Sua disponibilidade semanal" diz o fuso da janela gravada noutro fuso (revisor, rodada 2)', async () => {
    // A grade desenha a janela de NY às 14:00 de Lisboa; a lista mostra a hora
    // GRAVADA (09:00) e, sob o título "tudo no seu fuso", tem de dizer de onde.
    mock.respostas = {
      teachers: { data: { id: 'prof-1', display_name: 'Professora', iana_tz: 'Europe/Lisbon' } },
      teacher_google_accounts: { data: null },
      teacher_weekly_availability: {
        data: [
          { id: 'w-ny', weekday: 2, start_local: '09:00:00', end_local: '10:00:00', iana_tz: 'America/New_York' },
          { id: 'w-lis', weekday: 3, start_local: '15:00:00', end_local: '16:00:00', iana_tz: 'Europe/Lisbon' },
        ],
      },
    }
    const arvore = await TeacherPage({ searchParams: Promise.resolve({ d: '2027-01-12', painel: 'janelas' }) })
    const linhas = textosDosItens(arvore)
    expect(linhas).toContain('ter · 09:00–10:00 (horário de Nova York)')
    // a janela no fuso dela segue sem sufixo
    expect(linhas).toContain('qua · 15:00–16:00')
  })
})

/** O texto de cada `<li>` da árvore (a lista da disponibilidade semanal). */
function textosDosItens(no: ReactNode): string[] {
  const texto = (n: ReactNode): string => {
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (Array.isArray(n)) return n.map(texto).join('')
    if (!isValidElement(n)) return ''
    const props = n.props as { children?: ReactNode }
    // o formulário de remover não é texto da linha
    if (n.type === 'form') return ''
    return texto(props.children)
  }
  const saida: string[] = []
  const descer = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(descer)
    if (!isValidElement(n)) return
    const props = n.props as { children?: ReactNode }
    if (n.type === 'li') saida.push(texto(props.children).trim())
    descer(props.children)
  }
  descer(no)
  return saida
}
