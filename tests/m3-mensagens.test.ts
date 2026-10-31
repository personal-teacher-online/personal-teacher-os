// M3-3a + M3-3b (Onda Agenda e Mensagens) — a tela Mensagens no kit novo, com a
// situação lida da view `outbox_admin` (régua única do banco), a aba Entregues
// e o "reenviar" do painel.
//
// Três blocos:
// 1. GRAMÁTICA (puro): vocabulário da URL, endereço, página, situação e texto.
// 2. ACEITES DA TELA NOVA (puro, varredura de fonte): os pinos do AGENTS.md —
//    sem `<details data-popup>`, sem `?msg=`, sem `<select>` nativo, cor só dos
//    tokens, dado nunca rebaixado, página sem query, paginação no lugar do
//    `limit(200)`.
// 3. A CONSULTA CONTRA O BANCO (`lerMensagens`, a mesma função da página): o
//    recorte vai no WHERE — situação, período, aluno, página de 50 — e as
//    contagens são exatas.
//
// HIGIENE (o bloco 3 roda em paralelo com o resto da suíte): toda linha nasce
// com `dedupe_key` deste arquivo e desta rodada, `scheduled_for` daqui a 30
// dias (o despachante dos outros arquivos só pega `scheduled_for <= now()`) e,
// quando pendente, `created_at` recente (a varredura de órfãs de
// `fase3-dispatch` só alcança mais de 1 h). A limpeza do fim fecha SÓ o que
// este arquivo criou.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'
import { DateTime } from 'luxon'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent, daysFromToday } from './helpers/db'
import {
  ABAS_DAS_MENSAGENS,
  POR_PAGINA,
  contextoDaMensagem,
  enderecoDasMensagens,
  lerFiltrosDasMensagens,
  fraseDaRecusaDoReenvio,
  motivoDaFalhaNaLista,
  nomeDoTemplate,
  paginaValida,
  type FiltrosDasMensagens,
  type SituacaoDaMensagem,
} from '@/data/admin/mensagens-gramatica'

// `mensagens.ts` é `server-only` e importa o cliente de cookies do Next; o
// teste chama `lerMensagens` com clientes próprios, então os dois saem do caminho.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// A action de reenviar: o papel já vem validado (o RPC é quem recusa de verdade) e
// o cache não existe fora do Next. O DESPACHANTE É O REAL (só observado, com
// `vi.fn(real)`), e o canal de e-mail é falso: junta o que o despachante mandaria.
const { enviadosPeloCanal } = vi.hoisted(() => ({ enviadosPeloCanal: [] as Array<{ to: string }> }))
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: vi.fn(async () => 'admin-do-teste') }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/outbox/dispatch', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/outbox/dispatch')>()
  return { ...real, dispatchOutbox: vi.fn(real.dispatchOutbox) }
})
vi.mock('@/lib/notify/registry', () => ({
  canaisDoAmbiente: vi.fn(() => ({
    email: {
      send: async (m: { to: string }) => {
        enviadosPeloCanal.push(m)
        return { ok: true as const }
      },
    },
  })),
}))

const { lerMensagens } = await import('@/data/admin/mensagens')
const { createClient } = await import('@/lib/supabase/server')
const { dispatchOutbox } = await import('@/lib/outbox/dispatch')
const { reenviarMensagemAction, resolverMensagemAction } = await import('@/app/admin/avisos/actions')

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const PADRAO: FiltrosDasMensagens = { aba: 'todos', periodo: 'tudo', aluno: null, pagina: 1, ver: null }
const UM_UUID = '0b6f6c1e-3d2a-4c5b-9e8f-1a2b3c4d5e6f'

/* ========================================================================== */
/* 1. Gramática                                                                */
/* ========================================================================== */

describe('vocabulário da URL', () => {
  it('sem nada na URL: todos, tudo, sem aluno, página 1, nenhum painel', () => {
    expect(lerFiltrosDasMensagens({})).toEqual(PADRAO)
  })

  it('os links velhos `?st=preso&p=7` chegam no mesmo recorte', () => {
    expect(lerFiltrosDasMensagens({ st: 'preso', p: '7' })).toMatchObject({ aba: 'preso', periodo: '7' })
    for (const { aba } of ABAS_DAS_MENSAGENS) {
      expect(lerFiltrosDasMensagens({ st: aba }).aba).toBe(aba)
    }
  })

  it('valor desconhecido cai no padrão', () => {
    expect(lerFiltrosDasMensagens({ st: 'lixo', p: '90' })).toMatchObject({ aba: 'todos', periodo: 'tudo' })
  })

  it('a aba Entregues existe, entre Enviados e Resolvidos', () => {
    expect(ABAS_DAS_MENSAGENS.map((a) => a.aba)).toEqual([
      'todos',
      'preso',
      'pendente',
      'enviado',
      'entregue',
      'resolvido',
    ])
    expect(ABAS_DAS_MENSAGENS.find((a) => a.aba === 'entregue')?.rotulo).toBe('Entregues')
    expect(lerFiltrosDasMensagens({ st: 'entregue' }).aba).toBe('entregue')
  })

  it('aluno e painel só aceitam uuid (o id entra na expressão da consulta)', () => {
    expect(lerFiltrosDasMensagens({ aluno: 'todos' }).aluno).toBeNull()
    expect(lerFiltrosDasMensagens({ aluno: `${UM_UUID},recipient_profile_id.is.null` }).aluno).toBeNull()
    expect(lerFiltrosDasMensagens({ ver: 'abc' }).ver).toBeNull()
    expect(lerFiltrosDasMensagens({ aluno: UM_UUID.toUpperCase() }).aluno).toBe(UM_UUID)
  })

  it('página: só inteiro positivo; o resto vira 1', () => {
    expect(lerFiltrosDasMensagens({ pg: '3' }).pagina).toBe(3)
    for (const pg of ['0', '-2', 'abc', '1.5', '']) {
      expect(lerFiltrosDasMensagens({ pg }).pagina, pg).toBe(1)
    }
  })
})

describe('endereço da tela', () => {
  it('o padrão é a rota limpa', () => {
    expect(enderecoDasMensagens(PADRAO)).toBe('/admin/avisos')
  })

  it('mudar aba, período ou aluno volta para a página 1 e fecha o painel', () => {
    const f: FiltrosDasMensagens = { ...PADRAO, pagina: 4, ver: UM_UUID }
    expect(enderecoDasMensagens(f, { aba: 'preso' })).toBe('/admin/avisos?st=preso')
    expect(enderecoDasMensagens(f, { periodo: '30' })).toBe('/admin/avisos?p=30')
    expect(enderecoDasMensagens(f, { aluno: UM_UUID })).toBe(`/admin/avisos?aluno=${UM_UUID}`)
  })

  it('trocar de página e abrir o painel preservam o recorte', () => {
    const f: FiltrosDasMensagens = { ...PADRAO, aba: 'enviado', periodo: '7', aluno: UM_UUID, pagina: 2 }
    expect(enderecoDasMensagens(f, { pagina: 3 })).toBe(`/admin/avisos?st=enviado&p=7&aluno=${UM_UUID}&pg=3`)
    expect(enderecoDasMensagens(f, { ver: UM_UUID })).toBe(
      `/admin/avisos?st=enviado&p=7&aluno=${UM_UUID}&pg=2&ver=${UM_UUID}`,
    )
  })

  it('o endereço lido de volta dá os mesmos filtros', () => {
    const f: FiltrosDasMensagens = { aba: 'resolvido', periodo: '30', aluno: UM_UUID, pagina: 5, ver: UM_UUID }
    const q = Object.fromEntries(new URL(enderecoDasMensagens(f, { ver: UM_UUID }), 'http://x').searchParams)
    expect(lerFiltrosDasMensagens(q)).toEqual(f)
  })
})

describe('página efetiva', () => {
  it(`${POR_PAGINA} por página; o pedido além do fim vira a última`, () => {
    expect(POR_PAGINA).toBe(50)
    expect(paginaValida(1, 0)).toEqual({ pagina: 1, totalDePaginas: 1 })
    expect(paginaValida(1, 50)).toEqual({ pagina: 1, totalDePaginas: 1 })
    expect(paginaValida(2, 51)).toEqual({ pagina: 2, totalDePaginas: 2 })
    expect(paginaValida(9, 51)).toEqual({ pagina: 2, totalDePaginas: 2 })
    expect(paginaValida(0, 120)).toEqual({ pagina: 1, totalDePaginas: 3 })
  })
})

describe('situação', () => {
  it('a régua velha morreu: quem decide a situação é a coluna da view `outbox_admin`', () => {
    const g = codigo('src/data/admin/mensagens-gramatica.ts')
    expect(g).not.toContain('CONDICAO_DA_SITUACAO')
    expect(g).not.toContain('situacaoDaLinha')
    const dados = codigo('src/data/admin/mensagens.ts')
    expect(dados).not.toContain('CONDICAO_DA_SITUACAO')
    expect(dados).not.toContain('situacaoDaLinha')
    expect(dados).toContain("'outbox_admin'")
    expect(dados).toContain("'situacao'")
  })
})

describe('motivo da falha da Meta na lista (em português, pelo código)', () => {
  it('traduz o código que o recibo e o POST gravam no `error`', () => {
    expect(motivoDaFalhaNaLista('falhou depois do envio: Message undeliverable (código 131026)')).toBe(
      'a Meta não conseguiu entregar (131026)',
    )
    expect(
      motivoDaFalhaNaLista('a Meta recusou o envio (HTTP 400, código 131026): Message undeliverable'),
    ).toBe('a Meta não conseguiu entregar (131026)')
  })

  it('código que a tabela não conhece ainda vira frase com o código; sem código, nada (o cru fica no painel)', () => {
    expect(motivoDaFalhaNaLista('falhou depois do envio: algo novo (código 999999)')).toBe(
      'a Meta devolveu um erro (999999)',
    )
    expect(motivoDaFalhaNaLista('aluno sem login')).toBeNull()
    // frases literais: não afirmam causa que o código não garante
    expect(motivoDaFalhaNaLista('falhou depois do envio: x (código 131049)')).toBe(
      'a Meta segurou para não sobrecarregar o aluno (limite de mensagens por pessoa) (131049)',
    )
    expect(motivoDaFalhaNaLista('falhou depois do envio: x (código 131048)')).toBe(
      'a Meta limitou temporariamente o envio (131048)',
    )
    expect(motivoDaFalhaNaLista('falhou depois do envio: x (código 132001)')).toBe(
      'o modelo não está aprovado na Meta nesse idioma (132001)',
    )
    // "código N" solto, em erro que não é da Meta, não vira motivo da Meta
    expect(motivoDaFalhaNaLista('driver: falha (código 42)')).toBeNull()
    expect(motivoDaFalhaNaLista(null)).toBeNull()
  })
})

describe('recusa do reenvio em frase da dona (sem id, sem código)', () => {
  const id = '3f2a9c1e-8d4b-4e6a-9b1c-5d7e8f901234'
  const casos: Array<[string, string, string?]> = [
    [`reenviar recusado: o aviso ${id} ainda está aguardando envio`, 'Esta mensagem ainda aguarda o envio; não há o que reenviar.'],
    [
      `reenviar recusado: o aviso ${id} mudou desde que a tela foi aberta (agora: entregue); confira antes de reenviar`,
      'Esta mensagem mudou desde que a tela foi aberta (agora: entregue). Confira e tente de novo.',
    ],
    [
      `reenviar recusado: o aviso ${id} já foi reenviado (linha nova ${id}); reenvie a linha nova`,
      'Esta mensagem já foi reenviada. Reenvie a mensagem nova.',
    ],
    [
      `reenviar recusado: o aviso ${id} está sendo enviado agora; tente de novo em alguns minutos`,
      'Esta mensagem está sendo enviada agora. Tente de novo em alguns minutos.',
    ],
    [
      'reenviar recusado: a mensagem original já foi entregue; não há o que reenviar',
      'A mensagem original já foi entregue; não há o que reenviar.',
    ],
    ['reenviar aviso é restrito à admin (D10)', 'Só a administração pode reenviar mensagens.', '42501'],
    [`aviso ${id} não existe`, 'Esta mensagem não existe mais. Volte para a lista.'],
    ['algo que ninguém previu', 'Não deu para reenviar agora. Reabra a mensagem e tente de novo.'],
  ]
  it.each(casos)('%s', (mensagem, esperada, codigo) => {
    const frase = fraseDaRecusaDoReenvio(mensagem, codigo)
    expect(frase).toBe(esperada)
    expect(frase).not.toContain(id)
    expect(frase).not.toMatch(/\(D10\)|42501/)
  })
})

describe('texto da linha', () => {
  it('template conhecido em português; desconhecido aparece cru (é o alarme da linha que faltou)', () => {
    expect(nomeDoTemplate('class-cancelled')).toBe('Cancelamento de aula')
    expect(nomeDoTemplate('template-novo')).toBe('template-novo')
  })

  it('o contexto lê o horário no fuso da escola e ignora o que não tem a forma esperada', () => {
    // Cuiabá é UTC−4 o ano todo (sem horário de verão)
    expect(contextoDaMensagem({ starts_at_utc: '2026-10-14T13:00:00Z' })).toBe('aula 14/10 às 09:00')
    expect(contextoDaMensagem({ expires_on: '2026-10-20', n_credits: 2 })).toBe('crédito vence 20/10 · 2 créditos')
    expect(contextoDaMensagem({ marco: 15, n_credits: 1 })).toBe('aviso de 15 dias · 1 crédito')
    expect(contextoDaMensagem({ starts_at_utc: 42, expires_on: 'ontem', marco: '15' })).toBeNull()
    expect(contextoDaMensagem(null)).toBeNull()
  })
})

/* ========================================================================== */
/* 2. Aceites da tela nova (pinos do AGENTS.md)                                */
/* ========================================================================== */

const ARQUIVOS_DO_M3_3A = [
  'src/data/admin/mensagens.ts',
  'src/data/admin/mensagens-gramatica.ts',
  'src/components/admin/mensagens/ListaDeMensagens.tsx',
  'src/components/admin/mensagens/SeletorDeAluno.tsx',
  'src/components/admin/mensagens/ResolverMensagem.tsx',
  'src/components/admin/mensagens/ReenviarMensagem.tsx',
  'src/app/admin/avisos/page.tsx',
  'src/app/admin/avisos/actions.ts',
]
const PAGINA = 'src/app/admin/avisos/page.tsx'

describe('aceites do M3-3a', () => {
  it.each(ARQUIVOS_DO_M3_3A)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-\d|teal-\d/)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não usa `<details data-popup>`', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
    expect(codigo(rel)).not.toMatch(/<details[\s>]/)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não fabrica `?msg=` nem nonce', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
  })

  // Régua de legibilidade (AGENTS.md): DADO nunca em 12px nem no cinza de apoio.
  it.each(ARQUIVOS_DO_M3_3A)('%s não rebaixa dado para 12px nem para o cinza de apoio', (rel) => {
    const c = codigo(rel)
    expect(c).not.toMatch(/text-xs/)
    expect(c).not.toMatch(/text-ink-400/)
    expect(c).not.toMatch(/text-\[1[0-3]px\]/)
    expect(c).not.toMatch(/font-(light|extralight)/)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não usa o link-ação de 12px', (rel) => {
    expect(codigo(rel)).not.toContain('linkActionXs')
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não formata data no cliente (Lei 1)', (rel) => {
    const c = codigo(rel)
    if (!c.startsWith("'use client'")) return
    expect(c, rel).not.toMatch(/new Date\(|toLocaleString|DateTime\.|toFormat\(/)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não usa link-texto com seta como ação', (rel) => {
    expect(codigo(rel)).not.toMatch(/→\s*(?:\{'\s*'\}\s*)?<\//)
  })

  it.each(ARQUIVOS_DO_M3_3A)('%s não pendura explicação com travessão no rótulo da ação', (rel) => {
    expect(codigo(rel)).not.toMatch(/—[^<>]*<\/(?:Link|a|button)>/)
  })

  it('nenhum título inventa tamanho (as duas réguas da casa)', () => {
    for (const rel of ARQUIVOS_DO_M3_3A) {
      for (const tag of codigo(rel).match(/<h[1-3][^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/title-(page|section)/)
      }
    }
  })

  it('a PÁGINA não faz query inline — quem lê é a camada de dados', () => {
    const p = codigo(PAGINA)
    expect(p).not.toContain('@/lib/supabase')
    expect(p).not.toMatch(/\.from\(|\.rpc\(/)
    expect(p).toContain('getMensagens')
  })

  it('o `limit(200)` morreu: o recorte vai na consulta e a lista pagina com `range`', () => {
    const p = codigo(PAGINA)
    expect(p).not.toMatch(/\.limit\(|\.slice\(0,/)
    expect(p).not.toMatch(/\.filter\(\(r\) => r\.st/)
    const dados = codigo('src/data/admin/mensagens.ts')
    expect(dados).toMatch(/\.range\(/)
    expect(dados).not.toMatch(/\.limit\(/)
    expect(dados).toMatch(/count: 'exact', head: true/)
  })

  it('a ação volta pela porta nova: devolve o resultado, sem `redirect`', () => {
    const a = codigo('src/app/admin/avisos/actions.ts')
    expect(a).not.toContain('redirect(')
    expect(a).toMatch(/Promise<ResultadoDaAcao>/)
    expect(a).toContain("rpc('admin_resolve_outbox'")
    expect(a).toContain("rpc('admin_resend_outbox'")
    // o despacho do reenvio é ESCOPADO na cópia (não a fila inteira)
    expect(a).toContain('keyLike')
    expect(a).toContain('requireAdminId()')
  })

  it('o Reenviar relê o painel quando a RPC recusa (senão a dona repete o clique com a situação velha)', () => {
    const c = codigo('src/components/admin/mensagens/ReenviarMensagem.tsx')
    expect(c).toMatch(/toast\.error\(r\.mensagem\)[\s\S]*router\.refresh\(\)/)
  })

  it('a lista conta a hora na leitura de tela e pinta o "entregue" em cor de estado', () => {
    const l = codigo('src/components/admin/mensagens/ListaDeMensagens.tsx')
    expect(l).toMatch(/rotuloDaLinha[\s\S]*m\.quando/)
    expect(l).toContain("m.situacao === 'entregue' ? 'text-ok-700'")
  })

  it('a página não lê mais recado da URL nem usa as peças da tela velha', () => {
    const p = codigo(PAGINA)
    expect(p).not.toMatch(/FlashMsg|AvisoLegado|msg\?:/)
    expect(p).not.toContain("from '@/components/ui'")
  })
})

/* ========================================================================== */
/* 3. A consulta contra o banco                                                */
/* ========================================================================== */

describe('a consulta da tela (contra o banco)', () => {
  let sql: Sql
  let admin: SupabaseClient
  let servico: SupabaseClient
  const rodada = crypto.randomUUID().slice(0, 8)
  let n = 0
  const ids: Record<string, string> = {}
  let alunoA: string
  let alunoB: string
  let alunoC: string
  let nomeB: string

  /** Uma linha do outbox nascida DESTE arquivo (ver a nota de higiene no topo). */
  async function semear(o: {
    nome?: string
    template?: string
    perfil: string | null
    studentId?: string
    enviada?: boolean
    erro?: string | null
    /** idade da linha; pendente precisa ficar < 1 h (varredura do fase3-dispatch) */
    minutosAtras?: number
    /** campos a mais no payload (ex.: o aviso de crédito vencendo, que o despachante sabe montar) */
    extra?: Record<string, unknown>
    /** recibo de entrega da Meta (provedor + wamid + delivered_at) */
    entregue?: boolean
    /** lida, além de entregue */
    lida?: boolean
  }): Promise<string> {
    if (o.lida && !o.entregue) throw new Error('lida implica entregue')
    n += 1
    const payload = { ...(o.studentId ? { student_id: o.studentId } : {}), ...o.extra }
    const [r] = await sql`
      insert into notification_outbox
        (template, recipient_profile_id, payload, dedupe_key, scheduled_for, sent_at, error, created_at,
         provider, provider_message_id, delivered_at, read_at)
      values (
        ${o.template ?? 'class-reminder'}, ${o.perfil}, ${sql.json(payload)},
        ${`m3-msg:${rodada}:${n}`}, now() + interval '30 days',
        ${o.enviada || o.entregue ? sql`now()` : null}, ${o.erro ?? null},
        now() - make_interval(mins => ${o.minutosAtras ?? 0}) - make_interval(secs => ${n}),
        ${o.entregue ? 'meta' : null}, ${o.entregue ? `wamid.m3msg-${rodada}-${n}` : null},
        ${o.entregue ? sql`now() - interval '2 minutes'` : null},
        ${o.lida ? sql`now() - interval '1 minute'` : null})
      returning id`
    if (o.nome) ids[o.nome] = r.id as string
    return r.id as string
  }

  const ler = (f: Partial<FiltrosDasMensagens>) => lerMensagens(admin, servico, { ...PADRAO, ...f })

  beforeAll(async () => {
    sql = connect(2)
    const adminId = await createAuthUser(sql, 'admin', 'Admin M3-3a')
    admin = await clientAs(adminId, 'admin')
    servico = serviceClient()

    // A: aluno com login — linhas pelo perfil (com e sem student_id no payload)
    alunoA = await createStudent(sql)
    const perfilA = await createAuthUser(sql, 'student', `Aluno A ${rodada}`)
    await sql`update students set profile_id = ${perfilA} where id = ${alunoA}`
    await semear({ nome: 'pendente', perfil: perfilA, studentId: alunoA })
    await semear({ nome: 'preso', perfil: perfilA, studentId: alunoA, erro: 'driver: número fora do WhatsApp' })
    await semear({ nome: 'enviado', perfil: perfilA, studentId: alunoA, enviada: true })
    await semear({ nome: 'resolvido', perfil: perfilA, studentId: alunoA, enviada: true, erro: 'resolvido sem envio: teste' })
    // 40 dias atrás: fora dos recortes de 7 e 30 dias (enviada — a varredura de órfãs não a alcança)
    await semear({ nome: 'antigo', perfil: perfilA, studentId: alunoA, enviada: true, minutosAtras: 40 * 24 * 60 })
    // pelo perfil, SEM student_id no payload (o lado `recipient_profile_id` do filtro)
    await semear({ nome: 'soPerfil', template: 'reschedule-confirm', perfil: perfilA, enviada: true })
    // M3-3b: entregue (recibo da Meta), entregue e lida, e presa que falhou DEPOIS do envio
    await semear({ nome: 'entregue', perfil: perfilA, studentId: alunoA, entregue: true })
    await semear({ nome: 'lida', perfil: perfilA, studentId: alunoA, entregue: true, lida: true })
    await semear({
      nome: 'falhouDepois',
      perfil: perfilA,
      studentId: alunoA,
      enviada: true,
      erro: 'falhou depois do envio: Message undeliverable (código 131026)',
    })
    await sql`update notification_outbox
                 set provider = 'meta', provider_message_id = ${`wamid.m3msg-${rodada}-falha`}
               where id = ${ids.falhouDepois}`

    // B: aluno sem login — a linha órfã, achada só pelo payload
    alunoB = await createStudent(sql)
    const [b] = await sql`select display_name from students where id = ${alunoB}`
    nomeB = b.display_name as string
    await semear({ nome: 'orfa', template: 'class-cancelled', perfil: null, studentId: alunoB, erro: 'aluno sem login' })

    // C: 51 linhas enviadas, para a paginação
    alunoC = await createStudent(sql)
    for (let i = 0; i < 51; i++) await semear({ perfil: null, studentId: alunoC, enviada: true, minutosAtras: i })
  })

  afterAll(async () => {
    // Fecha SÓ o que este arquivo abriu — nunca a fila dos outros.
    await sql`
      update notification_outbox
         set sent_at = now(), error = 'fixture m3-mensagens'
       where sent_at is null and dedupe_key like ${`m3-msg:${rodada}:%`}`
    await sql.end()
  })

  it('aluno com login: as abas contam exatamente as linhas dele, pelas duas portas do filtro', async () => {
    const d = await ler({ aluno: alunoA })
    expect(d.contagens).toEqual({ todos: 9, preso: 2, pendente: 1, enviado: 3, entregue: 2, resolvido: 1 })
    expect(d.alunoEscolhido?.id).toBe(alunoA)
    expect(d.linhas.map((l) => l.id)).toContain(ids.soPerfil)
    expect(d.linhas.map((l) => l.id)).not.toContain(ids.orfa)
  })

  it('cada aba devolve só a sua situação — o recorte é do WHERE', async () => {
    const esperado: Record<SituacaoDaMensagem, string[]> = {
      preso: [ids.preso, ids.falhouDepois],
      pendente: [ids.pendente],
      enviado: [ids.enviado, ids.soPerfil, ids.antigo],
      entregue: [ids.entregue, ids.lida],
      resolvido: [ids.resolvido],
    }
    for (const aba of Object.keys(esperado) as SituacaoDaMensagem[]) {
      const d = await ler({ aluno: alunoA, aba })
      expect(new Set(d.linhas.map((l) => l.id)), aba).toEqual(new Set(esperado[aba]))
      expect(d.linhas.every((l) => l.situacao === aba), aba).toBe(true)
    }
  })

  it('o período corta pela data de criação, nas contagens e na lista', async () => {
    const d = await ler({ aluno: alunoA, periodo: '30' })
    expect(d.contagens).toEqual({ todos: 8, preso: 2, pendente: 1, enviado: 2, entregue: 2, resolvido: 1 })
    expect(d.linhas.map((l) => l.id)).not.toContain(ids.antigo)
    const tudo = await ler({ aluno: alunoA, periodo: 'tudo', aba: 'enviado' })
    expect(tudo.linhas.map((l) => l.id)).toContain(ids.antigo)
  })

  it('aluno SEM login: a mensagem presa aparece no filtro dele, com o nome da ficha', async () => {
    const d = await ler({ aluno: alunoB })
    expect(d.contagens).toEqual({ todos: 1, preso: 1, pendente: 0, enviado: 0, entregue: 0, resolvido: 0 })
    expect(d.linhas).toHaveLength(1)
    expect(d.linhas[0]).toMatchObject({
      id: ids.orfa,
      tipo: 'Cancelamento de aula',
      destinatario: `${nomeB} (sem login)`,
      destinatarioConhecido: true,
      situacao: 'preso',
    })
  })

  it('aluno que não existe: lista vazia, nunca a escola inteira', async () => {
    const d = await ler({ aluno: crypto.randomUUID() })
    expect(d.alunoEscolhido).toBeNull()
    expect(d.linhas).toEqual([])
    expect(d.contagens.todos).toBe(0)
  })

  it('51 mensagens viram 2 páginas de 50 + 1, mais recentes primeiro', async () => {
    const p1 = await ler({ aluno: alunoC })
    expect(p1.contagens.todos).toBe(51)
    expect(p1).toMatchObject({ pagina: 1, totalDePaginas: 2, primeira: 1, ultima: 50 })
    expect(p1.linhas).toHaveLength(50)

    const p2 = await ler({ aluno: alunoC, pagina: 2 })
    expect(p2).toMatchObject({ pagina: 2, totalDePaginas: 2, primeira: 51, ultima: 51 })
    expect(p2.linhas).toHaveLength(1)
    expect(p1.linhas.map((l) => l.id)).not.toContain(p2.linhas[0].id)

    // ordem: criada por último primeiro — a da página 2 é a mais antiga das 51
    const [maisAntiga] = await sql`
      select id from notification_outbox
       where dedupe_key like ${`m3-msg:${rodada}:%`} and payload->>'student_id' = ${alunoC}
       order by created_at asc limit 1`
    expect(p2.linhas[0].id).toBe(maisAntiga.id)

    // página além do fim vira a última, não erro do PostgREST
    const p9 = await ler({ aluno: alunoC, pagina: 9 })
    expect(p9).toMatchObject({ pagina: 2, primeira: 51, ultima: 51 })
  })

  it('o painel (`?ver=`) traz o erro CRU e só oferece resolver ao que não saiu', async () => {
    const presa = await ler({ aluno: alunoA, ver: ids.preso })
    expect(presa.aberta).not.toBe('sumiu')
    expect(presa.aberta).toMatchObject({
      id: ids.preso,
      erro: 'driver: número fora do WhatsApp',
      resolvivel: true,
      enviadaEm: null,
    })

    const enviada = await ler({ ver: ids.enviado })
    expect(enviada.aberta).toMatchObject({ resolvivel: false, erro: null })

    expect((await ler({ ver: crypto.randomUUID() })).aberta).toBe('sumiu')
    expect((await ler({})).aberta).toBeNull()
  })

  it('as datas saem como texto no fuso da escola (o cliente não formata)', async () => {
    const d = await ler({ aluno: alunoA, ver: ids.enviado })
    const [r] = await sql`select sent_at from notification_outbox where id = ${ids.enviado}`
    const esperado = DateTime.fromJSDate(r.sent_at as Date)
      .setZone('America/Cuiaba')
      .setLocale('pt-BR')
      .toFormat("dd/LL 'às' HH:mm")
    expect(d.aberta).toMatchObject({ enviadaEm: esperado })
    expect(d.linhas.find((l) => l.id === ids.enviado)?.quando).toBe(`enviada ${esperado}`)
  })

  /* ---- M3-3b ---------------------------------------------------------- */

  it('as contagens lidas da view batem com a régua antiga (sent_at + error) para as linhas sem provedor', async () => {
    // A régua que morreu na gramática, escrita aqui só para provar que o valor não mudou.
    const antiga = (sentAt: unknown, error: unknown) =>
      !sentAt ? (error ? 'preso' : 'pendente') : error ? 'resolvido' : 'enviado'
    const semProvedor = ['pendente', 'preso', 'enviado', 'resolvido', 'antigo', 'soPerfil'].map((n) => ids[n])
    const linhas = await sql`
      select sent_at, error from notification_outbox where id = any(${semProvedor})`
    const esperado = { todos: 0, preso: 0, pendente: 0, enviado: 0, entregue: 0, resolvido: 0 }
    for (const l of linhas) {
      esperado.todos += 1
      esperado[antiga(l.sent_at, l.error) as 'preso']++
    }
    // as linhas com provedor (entregue, lida, falhouDepois) saem do conjunto comparável
    const d = await ler({ aluno: alunoA })
    const dos = { ...d.contagens }
    dos.todos -= 3
    dos.preso -= 1 // falhouDepois: com wamid, a view a lê como presa (régua nova)
    dos.entregue -= 2
    expect(dos).toEqual(esperado)
  })

  it('aba Entregues: só linhas com delivered_at; mostra "entregue" com dia e hora, e "lida" quando há read_at', async () => {
    const d = await ler({ aluno: alunoA, aba: 'entregue' })
    expect(new Set(d.linhas.map((l) => l.id))).toEqual(new Set([ids.entregue, ids.lida]))
    const [r] = await sql`select delivered_at, read_at from notification_outbox where id = ${ids.lida}`
    const fmt = (v: unknown) =>
      DateTime.fromJSDate(v as Date).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")
    const simples = d.linhas.find((l) => l.id === ids.entregue)!
    const lida = d.linhas.find((l) => l.id === ids.lida)!
    expect(simples.quando).toMatch(/^entregue \d{2}\/\d{2} às \d{2}:\d{2}$/)
    expect(lida.quando).toBe(`entregue ${fmt(r.delivered_at)} · lida ${fmt(r.read_at)}`)
    // o filtro vem de uma coluna que só o recibo escreve
    const fora = await sql`
      select count(*)::int n from notification_outbox
       where id = any(${d.linhas.map((l) => l.id)}) and delivered_at is null`
    expect(fora[0].n).toBe(0)
  })

  it('a lista traduz o motivo da falha da Meta; o painel mostra o erro cru', async () => {
    const d = await ler({ aluno: alunoA, aba: 'preso' })
    expect(d.linhas.find((l) => l.id === ids.falhouDepois)?.motivo).toBe('a Meta não conseguiu entregar (131026)')
    expect(d.linhas.find((l) => l.id === ids.preso)?.motivo).toBeNull()
    const aberta = await ler({ aluno: alunoA, ver: ids.falhouDepois })
    expect(aberta.aberta).toMatchObject({
      erro: 'falhou depois do envio: Message undeliverable (código 131026)',
      // a presa que falhou depois de sair se resolve sem reenviar (admin_resolve_outbox, #42)
      resolvivel: true,
    })
  })

  it('o painel diz se pode reenviar: nunca na pendente', async () => {
    const pode = async (nome: string) => {
      const a = (await ler({ aluno: alunoA, ver: ids[nome] })).aberta
      if (!a || a === 'sumiu') throw new Error('painel não abriu')
      return a.reenviavel
    }
    expect(await pode('pendente')).toBe(false)
    for (const nome of ['preso', 'enviado', 'entregue', 'resolvido']) expect(await pode(nome), nome).toBe(true)
  })

  describe('reenviar pela action', () => {
    const form = (id: string, situacao: string) => {
      const f = new FormData()
      f.set('id', id)
      f.set('situacao', situacao)
      return f
    }
    const copiasDe = async (id: string) =>
      sql`select id, channel, template, scheduled_for, resend_of, sent_at from notification_outbox where resend_of = ${id}`
    /** a cópia nasce com scheduled_for = now(): afasta-a do despachante dos outros arquivos */
    const afastar = (id: string) =>
      sql`update notification_outbox set scheduled_for = now() + interval '30 days' where resend_of = ${id}`

    beforeEach(() => {
      vi.mocked(createClient).mockResolvedValue(admin)
      vi.mocked(dispatchOutbox).mockClear()
    })

    it('numa linha enviada: cria a cópia, audita, ENVIA na hora (só ela) e a cópia sai de Aguardando', async () => {
      // aluno com login e um aviso que o despachante real sabe montar
      const perfil = await createAuthUser(sql, 'student', `Aluno reenvio ${rodada}`)
      const aluno = await createStudent(sql)
      await sql`update students set profile_id = ${perfil} where id = ${aluno}`
      const [{ email }] = await sql`select email from auth.users where id = ${perfil}`
      const origem = await semear({
        template: 'credit-expiry',
        perfil,
        studentId: aluno,
        enviada: true,
        extra: { expires_on: daysFromToday(30), marco: 30, n_credits: 2 },
      })
      enviadosPeloCanal.length = 0
      const r = await reenviarMensagemAction(form(origem, 'enviado'))
      expect(r).toMatchObject({ ok: true, mensagem: 'Mensagem reenviada e enviada agora.' })

      const copias = await copiasDe(origem)
      expect(copias).toHaveLength(1)
      expect(dispatchOutbox).toHaveBeenCalledTimes(1)
      // o despacho é escopado na cópia (com a fila cheia na frente, a rodada inteira não chegaria nela)
      expect(vi.mocked(dispatchOutbox).mock.calls[0][2]).toMatchObject({ keyLike: `%:reenvio:${copias[0].id}` })
      expect(enviadosPeloCanal.map((m) => m.to)).toEqual([email])

      const [a] = await sql`
        select action, entity_id, diff from audit_log
         where action = 'resend_outbox' and entity_id = ${origem}`
      expect(a.diff).toMatchObject({ nova_linha: copias[0].id, situacao_anterior: 'enviado' })

      // a cópia saiu de "Aguardando" (o despacho imediato a enviou)
      const [depois] = await sql`select sent_at from notification_outbox where id = ${copias[0].id}`
      expect(depois.sent_at).not.toBeNull()
      const aguardando = await ler({ aluno, aba: 'pendente' })
      expect(aguardando.linhas.map((l) => l.id)).not.toContain(copias[0].id)

      // a origem sabe que foi reenviada e não oferece reenviar de novo
      expect((await ler({ ver: origem })).aberta).toMatchObject({ reenviada: true, reenviavel: false })
    })

    it('numa linha presa antes de enviar: a de origem fecha e a cópia nasce aguardando', async () => {
      const origem = await semear({ perfil: null, erro: 'aluno sem login' })
      const r = await reenviarMensagemAction(form(origem, 'preso'))
      await afastar(origem)
      expect(r.ok).toBe(true)
      const [o] = await sql`select sent_at from notification_outbox where id = ${origem}`
      expect(o.sent_at).not.toBeNull()
      // fechada com o erro antigo, a linha diz "reenviada" — não "resolvida", e a cópia não é cega a isso
      const aberta = (await ler({ ver: origem })).aberta
      expect(aberta).toMatchObject({ situacao: 'resolvido', reenviada: true })
      // sem hora: o `sent_at` dela é o fechamento do reenvio, não um envio
      expect(aberta).toMatchObject({ quando: 'reenviada', enviadaEm: null })
    })

    it('em linha pendente recusa: nenhuma linha nova, nenhum despacho', async () => {
      const origem = await semear({ perfil: null })
      const r = await reenviarMensagemAction(form(origem, 'pendente'))
      expect(r.ok).toBe(false)
      expect(r.mensagem).toBe('Esta mensagem ainda aguarda o envio; não há o que reenviar.')
      expect(r.mensagem).not.toContain(origem)
      expect(await copiasDe(origem)).toHaveLength(0)
      expect(dispatchOutbox).not.toHaveBeenCalled()
    })

    it('se a situação mudou desde a tela, recusa (o clique foi dado com a leitura velha)', async () => {
      const origem = await semear({ perfil: null, enviada: true })
      const r = await reenviarMensagemAction(form(origem, 'preso'))
      expect(r.ok).toBe(false)
      expect(r.mensagem).toMatch(/^Esta mensagem mudou desde que a tela foi aberta \(agora: enviado\)/)
      expect(r.mensagem).not.toContain(origem)
      expect(await copiasDe(origem)).toHaveLength(0)
    })

    it('sem id ou sem situação: pede de volta, sem chamar o banco', async () => {
      expect((await reenviarMensagemAction(form('', 'enviado'))).ok).toBe(false)
      expect((await reenviarMensagemAction(form(ids.enviado, ''))).ok).toBe(false)
      expect(dispatchOutbox).not.toHaveBeenCalled()
    })

    it('despacho que falha não desfaz o reenvio: a rodada horária pega a linha', async () => {
      vi.mocked(dispatchOutbox).mockRejectedValueOnce(new Error('sem rede'))
      const origem = await semear({ perfil: null, enviada: true })
      const r = await reenviarMensagemAction(form(origem, 'enviado'))
      await afastar(origem)
      expect(r.ok).toBe(true)
      expect(r.mensagem).toMatch(/envio imediato falhou/)
      expect(await copiasDe(origem)).toHaveLength(1)
    })
  })

  /* ---- rodada de correção 1 da PR -------------------------------------- */

  const fmtCuiaba = (v: unknown) =>
    DateTime.fromJSDate(v as Date).setZone('America/Cuiaba').setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm")
  const formDe = (campos: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(campos)) f.set(k, v)
    return f
  }
  /** Linha que saiu pela Meta há 1 dia e depois falhou (recibo `failed`). */
  async function falhouOntem(): Promise<string> {
    const id = await semear({
      perfil: null,
      enviada: true,
      erro: 'falhou depois do envio: Message undeliverable (código 131026)',
    })
    await sql`
      update notification_outbox
         set provider = 'meta', provider_message_id = ${`wamid.m3msg-${rodada}-ontem-${id.slice(0, 8)}`},
             sent_at = now() - interval '1 day'
       where id = ${id}`
    return id
  }

  it('reenviada ou resolvida depois do envio continua "enviada" com a hora do ENVIO, não a do reenvio', async () => {
    const origem = await falhouOntem()
    const [{ sent_at: horaDoEnvio }] = await sql`select sent_at from notification_outbox where id = ${origem}`
    vi.mocked(createClient).mockResolvedValue(admin)

    const antes = (await ler({ ver: origem })).aberta
    expect(antes).toMatchObject({ situacao: 'preso', rotuloDoEnvio: 'Enviada', jaSaiu: true })

    const r = await reenviarMensagemAction(formDe({ id: origem, situacao: 'preso' }))
    expect(r.ok).toBe(true)
    await sql`update notification_outbox set scheduled_for = now() + interval '30 days' where resend_of = ${origem}`

    const depois = (await ler({ ver: origem })).aberta
    expect(depois).toMatchObject({
      situacao: 'resolvido',
      reenviada: true,
      rotuloDoEnvio: 'Enviada',
      enviadaEm: fmtCuiaba(horaDoEnvio),
      quando: `enviada ${fmtCuiaba(horaDoEnvio)}`,
    })
  })

  it('resolvida na mão sem ter saído: "resolvida" com a hora do fechamento', async () => {
    const id = await semear({ perfil: null, enviada: true, erro: 'resolvido sem envio: teste' })
    const a = (await ler({ ver: id })).aberta
    expect(a).toMatchObject({ situacao: 'resolvido', rotuloDoEnvio: 'Resolvida', jaSaiu: true })
    expect((a as { quando: string }).quando).toMatch(/^resolvida \d{2}\/\d{2} às \d{2}:\d{2}$/)
  })

  it('presa que FALHOU DEPOIS do envio: o painel diz "não chegou" e o toast diz "sem reenviar"', async () => {
    const id = await falhouOntem()
    const a = (await ler({ ver: id })).aberta
    expect(a).toMatchObject({ situacao: 'preso', jaSaiu: true, resolvivel: true })
    const presaDeVerdade = (await ler({ aluno: alunoA, ver: ids.preso })).aberta
    expect(presaDeVerdade).toMatchObject({ jaSaiu: false })

    vi.mocked(createClient).mockResolvedValue(admin)
    const r = await resolverMensagemAction(formDe({ id, note: 'já avisei por telefone', ja_saiu: '1' }))
    expect(r).toEqual({ ok: true, mensagem: 'Mensagem resolvida sem reenviar. O motivo ficou registrado.' })
    const [{ error }] = await sql`select error from notification_outbox where id = ${id}`
    expect(error).toContain('resolvido sem reenviar: já avisei por telefone')

    // a que não saiu continua "sem envio"
    const naoSaiu = await semear({ perfil: null, erro: 'aluno sem login' })
    const r2 = await resolverMensagemAction(formDe({ id: naoSaiu, note: 'já avisei', ja_saiu: '0' }))
    expect(r2.mensagem).toBe('Mensagem resolvida sem envio. O motivo ficou registrado.')
  })

  it('a página escreve a palavra certa para a presa que já saiu', () => {
    const p = codigo(PAGINA)
    expect(p).toContain('Por que não chegou')
    expect(p).toContain('Resolver sem reenviar')
    expect(codigo('src/components/admin/mensagens/ResolverMensagem.tsx')).toContain('Resolver sem reenviar')
  })

  // Fixtures em que a régua ANTIGA (sent_at + error) e a view DISCORDAM: se a lista, o
  // painel ou o `p_situacao_esperada` voltassem a calcular por conta própria, falhariam aqui.
  it('lista, painel e o reenviar usam a coluna `situacao` da view, não uma conta da tela', async () => {
    vi.mocked(createClient).mockResolvedValue(admin)
    // (1) entregue: pela régua antiga seria "enviado" (sent_at, sem erro)
    const entregue = await semear({ perfil: null, entregue: true })
    expect((await ler({ aba: 'entregue', ver: entregue })).aberta).toMatchObject({ situacao: 'entregue' })
    const daLista = (await ler({ aba: 'entregue' })).linhas.find((l) => l.id === entregue)
    expect(daLista?.situacao).toBe('entregue')
    const velha = await reenviarMensagemAction(formDe({ id: entregue, situacao: 'enviado' }))
    expect(velha.ok).toBe(false)
    expect(velha.mensagem).toMatch(/\(agora: entregue\)/)
    expect(await sql`select 1 from notification_outbox where resend_of = ${entregue}`).toHaveLength(0)

    // (2) falhou depois do envio: pela régua antiga seria "resolvido" (sent_at + error)
    const falhou = await falhouOntem()
    expect((await ler({ ver: falhou })).aberta).toMatchObject({ situacao: 'preso' })
    const velha2 = await reenviarMensagemAction(formDe({ id: falhou, situacao: 'resolvido' }))
    expect(velha2.ok).toBe(false)
    expect(velha2.mensagem).toMatch(/\(agora: preso/)

    // e com a situação que a tela mostra, o reenvio passa
    const certa = await reenviarMensagemAction(formDe({ id: entregue, situacao: 'entregue' }))
    expect(certa.ok).toBe(true)
    await sql`update notification_outbox set scheduled_for = now() + interval '30 days' where resend_of = ${entregue}`
  })
})
