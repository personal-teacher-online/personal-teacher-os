// M3-3a (Onda Agenda e Mensagens) — a tela Mensagens no kit novo.
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'
import { DateTime } from 'luxon'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent } from './helpers/db'
import {
  ABAS_DAS_MENSAGENS,
  CONDICAO_DA_SITUACAO,
  POR_PAGINA,
  contextoDaMensagem,
  enderecoDasMensagens,
  lerFiltrosDasMensagens,
  nomeDoTemplate,
  paginaValida,
  situacaoDaLinha,
  type FiltrosDasMensagens,
  type SituacaoDaMensagem,
} from '@/data/admin/mensagens-gramatica'

// `mensagens.ts` é `server-only` e importa o cliente de cookies do Next; o
// teste chama `lerMensagens` com clientes próprios, então os dois saem do caminho.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { lerMensagens } = await import('@/data/admin/mensagens')

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

  it('valor desconhecido cai no padrão — inclusive "entregue", que só existe a partir do M3-3b', () => {
    expect(lerFiltrosDasMensagens({ st: 'entregue', p: '90' })).toMatchObject({ aba: 'todos', periodo: 'tudo' })
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
  it('a condição do WHERE e a leitura da linha são a MESMA régua', () => {
    const casos: Array<[string | null, string | null]> = [
      [null, null],
      [null, 'aluno sem login'],
      ['2026-10-01T12:00:00Z', null],
      ['2026-10-01T12:00:00Z', 'resolvido sem envio: já avisei'],
    ]
    const vistas = new Set<SituacaoDaMensagem>()
    for (const [sentAt, error] of casos) {
      const s = situacaoDaLinha(sentAt, error)
      vistas.add(s)
      expect(CONDICAO_DA_SITUACAO[s], `${sentAt}/${error}`).toEqual({
        enviada: sentAt !== null,
        comErro: error !== null,
      })
    }
    expect(vistas.size).toBe(4)
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
    expect(a).toContain('requireAdminId()')
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
  }): Promise<string> {
    n += 1
    const payload = o.studentId ? { student_id: o.studentId } : {}
    const [r] = await sql`
      insert into notification_outbox
        (template, recipient_profile_id, payload, dedupe_key, scheduled_for, sent_at, error, created_at)
      values (
        ${o.template ?? 'class-reminder'}, ${o.perfil}, ${sql.json(payload)},
        ${`m3-msg:${rodada}:${n}`}, now() + interval '30 days',
        ${o.enviada ? sql`now()` : null}, ${o.erro ?? null},
        now() - make_interval(mins => ${o.minutosAtras ?? 0}) - make_interval(secs => ${n}))
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
    expect(d.contagens).toEqual({ todos: 6, preso: 1, pendente: 1, enviado: 3, resolvido: 1 })
    expect(d.alunoEscolhido?.id).toBe(alunoA)
    expect(d.linhas.map((l) => l.id)).toContain(ids.soPerfil)
    expect(d.linhas.map((l) => l.id)).not.toContain(ids.orfa)
  })

  it('cada aba devolve só a sua situação — o recorte é do WHERE', async () => {
    const esperado: Record<SituacaoDaMensagem, string[]> = {
      preso: [ids.preso],
      pendente: [ids.pendente],
      enviado: [ids.enviado, ids.soPerfil, ids.antigo],
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
    expect(d.contagens).toEqual({ todos: 5, preso: 1, pendente: 1, enviado: 2, resolvido: 1 })
    expect(d.linhas.map((l) => l.id)).not.toContain(ids.antigo)
    const tudo = await ler({ aluno: alunoA, periodo: 'tudo', aba: 'enviado' })
    expect(tudo.linhas.map((l) => l.id)).toContain(ids.antigo)
  })

  it('aluno SEM login: a mensagem presa aparece no filtro dele, com o nome da ficha', async () => {
    const d = await ler({ aluno: alunoB })
    expect(d.contagens).toEqual({ todos: 1, preso: 1, pendente: 0, enviado: 0, resolvido: 0 })
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
})
