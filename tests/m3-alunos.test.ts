// ONDA 1 · M3-1 — hub de Alunos: o que as duas leituras e as três peças novas
// do kit prometem, provado.
//
// Cobre:
//  · o CONTRATO do diretório contra o banco de verdade (`DiretorioSchema`);
//  · o agrupamento — contagens, pendências e recorte batendo com a mesma
//    fonte, incluindo o caso que a lista velha escondia (aluno em dois
//    produtos conta nos dois cartões);
//  · o vocabulário de níveis como ESPELHO do check do banco (a lista copiada
//    em `alunos-grupos.ts` não pode divergir do `students_level_check`);
//  · 404 honesto: rótulo de grupo inexistente devolve `null`;
//  · a busca (acento, cidade, termo vazio);
//  · os aceites de grep das telas novas (sem `<select>` nativo, âncora real na
//    linha, kebab na voz da navegação, paginação, contagem anunciada) e a
//    acessibilidade estrutural da tabela e da trilha.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'
import { CartaoDeGrupo } from '@/components/admin/alunos/CartaoDeGrupo'
import { ListaDeAlunos } from '@/components/admin/alunos/ListaDeAlunos'
import { ListaDeConvites } from '@/components/admin/alunos/ListaDeConvites'
import { DataTable } from '@/components/kit/data-table'
import { FLEXGE_LEVELS } from '@/lib/slides/lesson-schema'
import {
  CONCLUSAO,
  ETAPAS_DA_ADMISSAO,
  enderecoDaAdmissao,
  estadoDaEtapa,
  etapaDaAdmissao,
} from '@/data/admin/admissao'
import {
  ACESSOS,
  ACESSO_ROTULO,
  DiretorioSchema,
  NIVEIS,
  ehAcesso,
  nivelValido,
  SEM_CONTRATO,
  SEM_NIVEL,
  SEM_PROFESSORA,
  agrupar,
  alunosDoGrupo,
  casaComBusca,
  ehEixo,
  ehEixoDeGrupo,
  montarAluno,
  nivelParaSlug,
  rotuloDoGrupo,
  slugParaNivel,
  type AlunoDaLista,
  type AlunoDoDiretorio,
} from '@/data/admin/alunos-grupos'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Traduz o diretório cru como a camada de dados traduz (hora/cidade prontas). */
function comoNaTela(brutos: AlunoDoDiretorio[]): AlunoDaLista[] {
  return brutos.map((b) =>
    montarAluno(b, {
      cidade: b.city || 'Cuiabá',
      horaLocal: '12:00',
      idxDaProfessora: () => 0,
    }),
  )
}

/* ========================================================================== */
/* 1. Contrato do diretório contra o banco                                     */
/* ========================================================================== */

describe('contrato de admin_student_directory() (leituras do hub)', () => {
  let sql: Sql
  let admin: SupabaseClient
  let brutos: AlunoDoDiretorio[]

  beforeAll(async () => {
    sql = connect(2)
    admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M3'), 'admin')
    const { data, error } = await admin.rpc('admin_student_directory')
    expect(error).toBeNull()
    brutos = DiretorioSchema.parse(data)
  })
  afterAll(async () => {
    await sql.end()
  })

  it('o payload real passa pelo schema da camada de dados', () => {
    expect(Array.isArray(brutos)).toBe(true)
    // A bancada tem alunos semeados; lista vazia aqui esconderia um contrato
    // quebrado atrás de um `[]`.
    expect(brutos.length).toBeGreaterThan(0)
    for (const b of brutos) {
      expect(typeof b.id).toBe('string')
      expect(typeof b.iana_tz).toBe('string')
      expect(Array.isArray(b.contracts)).toBe(true)
    }
  })

  it('o nível de todo aluno cabe no vocabulário que a tela desenha', () => {
    for (const b of brutos) {
      if (b.level) expect(NIVEIS as readonly string[]).toContain(b.level)
    }
  })

  it('a linha da tabela deriva acesso e crédito do MESMO dado do diretório', () => {
    for (const linha of comoNaTela(brutos)) {
      const bruto = brutos.find((b) => b.id === linha.id)!
      const esperado = !bruto.profile_id ? 'sem_convite' : bruto.email_confirmed ? 'ativo' : 'pendente'
      expect(linha.acesso).toBe(esperado)

      const particulares = bruto.contracts.filter(
        (c) => c.contract_type === 'private_1on1' && c.status !== 'ended',
      )
      if (particulares.length === 0) {
        // Sem contrato particular NÃO é saldo zero — é ausência de saldo. A
        // coluna mostra "—", e a diferença importa: zero crédito é um fato
        // sobre o aluno, "—" é a falta do contrato que teria créditos.
        expect(linha.creditos).toBeNull()
      } else {
        expect(linha.creditos).toBe(particulares.reduce((s, c) => s + (c.balance ?? 0), 0))
      }
    }
  })

  it('as contagens dos três eixos batem com o diretório', () => {
    const trabalho = comoNaTela(brutos).filter((a) => !a.arquivado)

    // Nível: cada aluno em EXATAMENTE um grupo → a soma é o total.
    const porNivel = agrupar(trabalho, 'nivel')
    expect(porNivel.reduce((s, g) => s + g.total, 0)).toBe(trabalho.length)

    // Produto: quem faz particular E mentoria conta nos dois cartões — a soma
    // é maior que o total, de propósito.
    const porProduto = agrupar(trabalho, 'produto')
    const esperadoProduto = trabalho.reduce(
      (s, a) => s + Math.max(1, (a.particulares.length > 0 ? 1 : 0) + (a.mentoria ? 1 : 0)),
      0,
    )
    expect(porProduto.reduce((s, g) => s + g.total, 0)).toBe(esperadoProduto)

    // Professora: um aluno com dois contratos da MESMA professora conta uma vez.
    const porProfessora = agrupar(trabalho, 'professora')
    const esperadoProfessora = trabalho.reduce((s, a) => {
      const distintas = new Set(a.particulares.map((p) => p.professoraId).filter(Boolean))
      return s + Math.max(1, distintas.size)
    }, 0)
    expect(porProfessora.reduce((s, g) => s + g.total, 0)).toBe(esperadoProfessora)

    // O recorte da página N2 devolve exatamente o que o cartão prometeu.
    for (const eixo of ['professora', 'produto', 'nivel'] as const) {
      for (const g of agrupar(trabalho, eixo)) {
        const dentro = alunosDoGrupo(trabalho, eixo, g.valor)
        expect(dentro.length, `${eixo}/${g.valor}`).toBe(g.total)
        // Pendência do grupo = quem ainda não tem acesso ATIVO ao portal.
        expect(g.semAcesso).toBe(dentro.filter((a) => a.acesso !== 'ativo').length)
        expect(g.total).toBeGreaterThan(0) // grupo vazio não vira cartão
      }
    }
  })

  it('o vocabulário de níveis da tela ESPELHA o check do banco', async () => {
    const [c] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'students_level_check'`
    expect(c).toBeTruthy()
    for (const n of NIVEIS) expect(c.def).toContain(`'${n}'`)
    // …e o mesmo conjunto que a Fábrica de conteúdo usa (uma escola, um
    // vocabulário de nível).
    expect([...NIVEIS]).toEqual([...FLEXGE_LEVELS])
  })
})

/* ========================================================================== */
/* 2. Vocabulário de eixos, slugs e 404 honesto                                */
/* ========================================================================== */

describe('eixos, slugs e rótulos', () => {
  it('só os quatro eixos existem — e só três viram página de grupo', () => {
    expect(ehEixo('professora')).toBe(true)
    expect(ehEixo('todos')).toBe(true)
    expect(ehEixo('inventado')).toBe(false)
    expect(ehEixoDeGrupo('todos')).toBe(false)
    expect(ehEixoDeGrupo('nivel')).toBe(true)
  })

  it('o slug do nível sobrevive à URL e volta inteiro', () => {
    for (const n of NIVEIS) {
      const slug = nivelParaSlug(n)
      expect(slug).toBe(encodeURIComponent(slug)) // nada de %2B na barra
      expect(slugParaNivel(slug)).toBe(n)
    }
    expect(nivelParaSlug('A1+')).toBe('a1-mais')
    expect(nivelParaSlug('Pre A1')).toBe('pre-a1')
    expect(nivelParaSlug(null)).toBe(SEM_NIVEL)
  })

  it('rótulo de grupo inexistente devolve null (é o 404 honesto da N2)', () => {
    expect(rotuloDoGrupo('nivel', 'z9', [])).toBeNull()
    expect(rotuloDoGrupo('produto', 'assinatura', [])).toBeNull()
    expect(rotuloDoGrupo('professora', '00000000-0000-0000-0000-000000000000', [])).toBeNull()
    // …e grupo VÁLIDO tem rótulo mesmo sem ninguém dentro (vazio ≠ inexistente)
    expect(rotuloDoGrupo('nivel', 'b2-mais', [])).toBe('Nível B2+')
    expect(rotuloDoGrupo('produto', 'travel', [])).toBe('Personal Travel')
    expect(rotuloDoGrupo('produto', SEM_CONTRATO, [])).toBe('Sem contrato ativo')
    expect(rotuloDoGrupo('professora', SEM_PROFESSORA, [])).toBe('Sem professora')
    // Professora que existe no cadastro e ainda não tem aluno continua sendo
    // grupo (só vazio) — quem sabe disso é o cadastro, não a lista.
    expect(rotuloDoGrupo('professora', 'abc', [], (id) => (id === 'abc' ? 'Renata' : null))).toBe(
      'Renata',
    )
  })
})

/* ========================================================================== */
/* 2b. Gramática da admissão (função pura — M3-3)                              */
/* ========================================================================== */

describe('etapas do wizard de admissão', () => {
  it('sem aluno criado não existe etapa 2, 3 nem conclusão', () => {
    expect(etapaDaAdmissao(undefined, false)).toBe(1)
    expect(etapaDaAdmissao('2', false)).toBe(1)
    expect(etapaDaAdmissao('3', false)).toBe(1)
    expect(etapaDaAdmissao('4', false)).toBe(1)
  })

  it('com aluno criado, o `?s=` manda — e qualquer lixo cai na etapa 2', () => {
    expect(etapaDaAdmissao(undefined, true)).toBe(2)
    expect(etapaDaAdmissao('2', true)).toBe(2)
    expect(etapaDaAdmissao('3', true)).toBe(3)
    expect(etapaDaAdmissao('4', true)).toBe(CONCLUSAO)
    expect(etapaDaAdmissao('99', true)).toBe(2)
    expect(etapaDaAdmissao('', true)).toBe(2)
  })

  it('o stepper marca feito, atual e a fazer — e na conclusão os três estão feitos', () => {
    expect(ETAPAS_DA_ADMISSAO).toHaveLength(3)
    expect([1, 2, 3].map((n) => estadoDaEtapa(n, 2))).toEqual(['feita', 'atual', 'futura'])
    expect([1, 2, 3].map((n) => estadoDaEtapa(n, 1))).toEqual(['atual', 'futura', 'futura'])
    expect([1, 2, 3].map((n) => estadoDaEtapa(n, CONCLUSAO))).toEqual(['feita', 'feita', 'feita'])
  })

  it('o endereço de cada etapa é o que a action redireciona (um formato só)', () => {
    expect(enderecoDaAdmissao(1)).toBe('/admin/alunos?novo=1')
    // etapa 1 é o endereço limpo, mesmo com aluno na mão
    expect(enderecoDaAdmissao(1, 'abc')).toBe('/admin/alunos?novo=1')
    expect(enderecoDaAdmissao(2, 'abc')).toBe('/admin/alunos?novo=1&s=2&aluno=abc')
    expect(enderecoDaAdmissao(CONCLUSAO, 'abc')).toBe('/admin/alunos?novo=1&s=4&aluno=abc')
    // sem aluno, etapa avançada não vira endereço quebrado — volta ao começo
    expect(enderecoDaAdmissao(3, null)).toBe('/admin/alunos?novo=1')
    // e o que sai daqui volta inteiro pelo leitor de etapa
    for (const etapa of [2, 3, CONCLUSAO] as const) {
      const s = new URL(enderecoDaAdmissao(etapa, 'abc'), 'https://x').searchParams
      expect(etapaDaAdmissao(s.get('s') ?? undefined, true)).toBe(etapa)
    }
  })
})

/* ========================================================================== */
/* 2c. Vocabulário de níveis e de acesso (M3-3 · anexo A1)                     */
/* ========================================================================== */

describe('vocabulário único de níveis', () => {
  it('aceita os onze da trilha e recusa o resto', () => {
    for (const n of NIVEIS) expect(nivelValido(n), n).toBe(true)
    expect(NIVEIS).toHaveLength(11)
    // o que o formulário velho oferecia continua valendo…
    for (const n of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) expect(nivelValido(n), n).toBe(true)
    // …e o que ele jogava fora em silêncio agora entra
    for (const n of ['Pre A1', 'A1+', 'A2+', 'B1+', 'B2+']) expect(nivelValido(n), n).toBe(true)
    // vazio, sentinela e invenção continuam fora
    expect(nivelValido('')).toBe(false)
    expect(nivelValido(null)).toBe(false)
    expect(nivelValido(undefined)).toBe(false)
    expect(nivelValido('nenhum')).toBe(false)
    expect(nivelValido('a1')).toBe(false)
    expect(nivelValido('D1')).toBe(false)
  })

  it('as três situações de acesso são vocabulário fechado (o `?f=` da aba)', () => {
    expect([...ACESSOS]).toEqual(['ativo', 'pendente', 'sem_convite'])
    for (const a of ACESSOS) expect(ehAcesso(a), a).toBe(true)
    expect(ehAcesso('arquivados')).toBe(false)
    expect(ehAcesso(undefined)).toBe(false)
    for (const a of ACESSOS) expect(ACESSO_ROTULO[a].length).toBeGreaterThan(0)
  })
})

/* ========================================================================== */
/* 3. Busca                                                                    */
/* ========================================================================== */

describe('busca do hub', () => {
  const aluno = (nome: string, cidade: string): AlunoDaLista =>
    montarAluno(
      {
        id: nome,
        display_name: nome,
        iana_tz: 'America/Cuiaba',
        status: 'active',
        city: cidade,
        country: 'BR',
        level: null,
        profile_id: null,
        whatsapp_e164: null,
        whatsapp_channel_ack_at: null,
        email_bounced_at: null,
        invited_at: null,
        email: null,
        email_confirmed: null,
        last_sign_in_at: null,
        contracts: [],
      },
      { cidade, horaLocal: '09:00', idxDaProfessora: () => 0 },
    )

  it('acha sem acento, sem caixa e também pela cidade', () => {
    const v = aluno('Lúcia Prado', 'Orlando')
    expect(casaComBusca(v, 'lucia')).toBe(true)
    expect(casaComBusca(v, 'PRADO')).toBe(true)
    expect(casaComBusca(v, 'orlan')).toBe(true)
    expect(casaComBusca(v, 'lisboa')).toBe(false)
  })

  it('termo vazio não filtra nada (a lista inteira continua a resposta)', () => {
    expect(casaComBusca(aluno('Ana', 'Cuiabá'), '   ')).toBe(true)
  })
})

/* ========================================================================== */
/* 4. Aceites das telas e do kit novos                                         */
/* ========================================================================== */

/**
 * TODA tela nova do M3 — hub (M3-1), grupos (M3-1), ficha (M3-2), wizard e
 * convites (M3-3). A varredura do M3-3 roda sobre a lista INTEIRA: um aceite
 * que só vale para a tela da semana não é aceite, é lembrete.
 *
 * Fora da lista, de propósito: as peças de kit anteriores ao M3 (sheet,
 * dialog, toaster…) e as actions velhas — que continuam produzindo `?msg=`,
 * consumido pelo `AvisoLegado`. É convivência declarada, não regressão.
 */
const ARQUIVOS_NOVOS = [
  'src/components/kit/data-table.tsx',
  'src/components/kit/select.tsx',
  'src/components/kit/avatar.tsx',
  'src/components/kit/form-validado.tsx',
  'src/components/admin/alunos/ListaDeAlunos.tsx',
  'src/components/admin/alunos/ListaDeConvites.tsx',
  'src/components/admin/alunos/CartaoDeGrupo.tsx',
  // MUDOU DE CASA na onda da Agenda (A1): já servia alunos E contratos, e a
  // agenda seria a terceira seção — peça de três seções é peça do kit. O que
  // esta lista cobra (arquivo novo não pode usar padrão morto) continua valendo
  // no endereço novo.
  'src/components/kit/painel-de-url.tsx',
  'src/components/admin/alunos/ficha/abas.tsx',
  'src/components/admin/alunos/ficha/paineis.tsx',
  'src/components/admin/alunos/ficha/pecas.tsx',
  'src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx',
  'src/data/admin/alunos.ts',
  'src/data/admin/alunos-grupos.ts',
  'src/data/admin/admissao.ts',
  'src/data/admin/ficha.ts',
  'src/data/admin/ficha-gramatica.ts',
  'src/app/admin/alunos/page.tsx',
  'src/app/admin/alunos/convites/page.tsx',
  'src/app/admin/alunos/[id]/page.tsx',
  'src/app/admin/alunos/grupo/[eixo]/[valor]/page.tsx',
  'src/app/admin/alunos/novo/AdmissionWizard.tsx',
  'src/app/admin/alunos/novo/EtapaDoContrato.tsx',
]

/** As PÁGINAS do M3 (as que respondem a uma URL). */
const PAGINAS_DO_M3 = ARQUIVOS_NOVOS.filter((r) => r.endsWith('/page.tsx'))

/**
 * O INÍCIO (dois andares). Não é M3, mas o portão visual do dono varreu as duas
 * frentes juntas — a régua da seta-de-texto (A4) vale nas duas.
 */
const ARQUIVOS_DO_INICIO = [
  'src/app/admin/page.tsx',
  'src/components/admin/inicio/AndarHoje.tsx',
  'src/components/admin/inicio/AndarNegocio.tsx',
  'src/components/admin/inicio/BandaDeTopo.tsx',
  'src/components/admin/inicio/CartaoKpi.tsx',
  'src/components/admin/inicio/RegistrarDesfecho.tsx',
]

describe('aceites do M3', () => {
  it.each(ARQUIVOS_NOVOS)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    expect(codigo(rel)).not.toMatch(/brand-700|brand-600|teal-\d/)
  })

  it.each(ARQUIVOS_NOVOS)('%s não abre overlay fora do kit nem usa `<details data-popup>`', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  // Objeção nº 1 salva do dono: o menu de seleção do navegador está proibido
  // em tela nova. Quem seleciona é o Select do kit (Radix), sempre.
  it.each(ARQUIVOS_NOVOS)('%s não tem <select> nativo', (rel) => {
    expect(codigo(rel)).not.toMatch(/<select[\s>]/)
    expect(codigo(rel)).not.toMatch(/<option[\s>]/)
  })

  // VARREDURA DO M3-3 — os aceites que valiam de boca em cada milestone viram
  // teste aqui, aplicados a TODAS as telas do M3 de uma vez.

  // Tela nova não PRODUZ `?msg=`+nonce (ADR-025). Consumir o que a action velha
  // manda, via `AvisoLegado`, é a convivência documentada — e é por isso que a
  // busca é pelo `msg=` sendo ESCRITO numa URL, não pela palavra.
  it.each(ARQUIVOS_NOVOS)('%s não fabrica `?msg=` (só as actions velhas mandam)', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
  })

  // Régua de legibilidade (AGENTS.md): DADO nunca em 12px nem em cinza de
  // apoio. Nas telas do M3 a régua é absoluta — não há texto de apoio pequeno
  // nelas, então qualquer `text-xs`/`text-ink-400` que apareça é dado rebaixado.
  it.each(ARQUIVOS_NOVOS)('%s não rebaixa dado para 12px nem para o cinza de apoio', (rel) => {
    // PLACEHOLDER é a exceção declarada (M3-c4 · B2): ele não é dado — é
    // sugestão do que digitar, e a régua manda que ele seja MAIS claro que o
    // texto digitado, não igual. `placeholder:text-ink-400` e
    // `data-[placeholder]:text-ink-400` saem da varredura; qualquer outro
    // `text-ink-400` continua proibido.
    const c = codigo(rel).replace(/(?:placeholder|data-\[placeholder\]):text-ink-400/g, '')
    expect(c).not.toMatch(/text-xs/)
    expect(c).not.toMatch(/text-ink-400/)
    expect(c).not.toMatch(/text-\[1[0-3]px\]/)
    expect(c).not.toMatch(/font-(light|extralight)/)
  })

  // A ação de texto de 12px que a Leva 7 usava nos "pular" do wizard.
  it.each(ARQUIVOS_NOVOS)('%s não usa mais o link-ação de 12px', (rel) => {
    expect(codigo(rel)).not.toContain('linkActionXs')
  })

  it.each(ARQUIVOS_NOVOS)('%s não formata data no cliente (Lei 1)', (rel) => {
    const c = codigo(rel)
    if (!c.startsWith("'use client'")) return
    expect(c, rel).not.toMatch(/new Date\(|toLocaleString|DateTime\./)
  })

  /* --------------------------------------- M3-c3 · A4 · seta-de-texto banida */

  // O dono reprovou o padrão "link de texto terminando em seta" pela terceira
  // vez (a captura era o "Ver extrato →" da ficha). Quem leva a outro lugar é
  // BOTÃO do kit; a direção quem dá é o rótulo.
  //
  // O que a regra NÃO proíbe, de propósito: seta que não é ação. Sobrevivem a
  // trilha de volta ("← Alunos"), o intervalo de vigência ("01/02 → 30/06"), a
  // tendência do KPI (↗ ↘ →) e a seta de prosa ("tem número → recebe"). Por
  // isso a busca é pela seta COLADA no fechamento do elemento — que é a forma
  // que o padrão banido sempre teve —, e não pela seta em si.
  const SETA_DE_ACAO = /→\s*(?:\{'\s*'\}\s*)?<\//
  it.each([...ARQUIVOS_NOVOS, ...ARQUIVOS_DO_INICIO])(
    '%s não usa link-texto com seta como ação',
    (rel) => {
      expect(codigo(rel)).not.toMatch(SETA_DE_ACAO)
    },
  )

  /* ------------------ M3-c4 · B4 · rodapé sem link-texto (e sem frase) */

  // O padrão banido voltou pelo rodapé do wizard: "Fechar — aluno já criado" e
  // "Pular — contrato depois" saíam como texto periwinkle clicável (o
  // `.btn-ac-ghost` é transparente e sem borda: no rodapé, ao lado do sólido,
  // ele lê como link). Duas regras, e as duas são de FORMA:
  //   1. ação de rodapé é BOTÃO do kit — nada de âncora crua lá dentro;
  //   2. rótulo de ação não carrega travessão: explicação é prosa da seção, não
  //      legenda pendurada no botão.
  const ROTULO_COM_TRAVESSAO = /—[^<>]*<\/(?:Link|a|button)>/

  it.each([...ARQUIVOS_NOVOS, ...ARQUIVOS_DO_INICIO])(
    '%s não pendura explicação com travessão no rótulo da ação',
    (rel) => {
      expect(codigo(rel)).not.toMatch(ROTULO_COM_TRAVESSAO)
    },
  )

  it('as ações dos rodapés dos painéis são botões do kit, nunca texto', () => {
    // Os dois rodapés que existem: o do wizard e o dos painéis da ficha.
    for (const [rel, marca] of [
      ['src/app/admin/alunos/novo/AdmissionWizard.tsx', 'function Rodape'],
      ['src/components/admin/alunos/ficha/paineis.tsx', 'function Rodape'],
    ] as const) {
      const fonte = codigo(rel)
      const inicio = fonte.indexOf(marca)
      expect(inicio, rel).toBeGreaterThan(-1)
      const rodape = fonte.slice(inicio, fonte.indexOf('</SheetFooter>', inicio))
      // toda âncora do rodapé veste botão do kit…
      for (const tag of rodape.match(/<(?:Link|a)\b[^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/className="btn-/)
      }
      // …e o fantasma (que é o que lê como link) não é mais o traje de lá
      expect(rodape, rel).not.toContain('btn-ac-ghost')
      expect(rodape, rel).toContain('btn-ac-soft')
    }
    // o rótulo curto de botão substituiu a frase do lote c2 (no CÓDIGO: o
    // comentário do rodapé cita as frases mortas de propósito, para dizer o que
    // morreu)
    const w = codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    expect(w).toContain("'Fechar' : 'Cancelar'")
    expect(w).toContain('Pular esta etapa')
    expect(w).not.toContain('Fechar — aluno já criado')
    expect(w).not.toContain('Pular — contrato depois')
    expect(w).not.toContain('Pular — convidar depois')
    // …e a verdade que a frase carregava continua dita, agora como PROSA: o
    // aluno já salvo na etapa do contrato, o convite adiável na etapa 3.
    expect(codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')).toContain('já está salvo')
    expect(w).toContain('Dá para convidar depois')
  })

  /* ------------------------------- M3-c3 · A3 · os DOIS papéis de cartão */

  // A régua tem dois lados e os dois valem (o dono pediu a elevação E avisou
  // "cuidado para não seguir um padrão na página toda"):
  //   · CARTÃO DE COISA clicável → elevação (`.card-kpi`), sem hairline;
  //   · CARTÃO-CONTÊINER de trabalho → flat com anel (`.panel-tb`).
  it('cartão de coisa é elevado; cartão-contêiner segue flat com anel', () => {
    // 1. os cartões de coisa do M3 vestem a receita de elevação
    for (const [rel, quem] of [
      ['src/components/admin/alunos/CartaoDeGrupo.tsx', 'cartão de grupo do hub'],
      ['src/app/admin/alunos/convites/page.tsx', 'contadores da aba Convites'],
      ['src/app/admin/alunos/novo/AdmissionWizard.tsx', 'próximos passos do wizard'],
    ] as const) {
      expect(codigo(rel), quem).toContain('card-kpi card-kpi-interactive')
    }

    // 2. e NÃO acumulam hairline com sombra (a proibição antiga continua)
    const cartao = codigo('src/components/admin/alunos/CartaoDeGrupo.tsx')
    expect(cartao).not.toMatch(/border border-line/)
    expect(cartao).not.toContain('rounded-card')

    // 3. o contêiner de trabalho (abas + toolbar + tabela) NÃO virou elevado:
    //    quem hospeda a grade continua sendo o `.panel-tb` do kit
    const painel = codigo('src/components/kit/card-panel.tsx')
    expect(painel).toContain('panel-tb')
    expect(painel).not.toContain('card-kpi')

    // 4. estado vazio e tabela não são cartão de coisa nenhuma
    for (const rel of [
      'src/components/kit/empty-state.tsx',
      'src/components/kit/data-table.tsx',
    ]) {
      expect(codigo(rel), rel).not.toContain('card-kpi')
    }

    // 5. e a receita é UMA só, no globals: sombra medida, raio 12, sem borda
    const css = corpo('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const kpi = css.match(/\.card-kpi \{([^}]*)\}/)?.[1] ?? ''
    expect(kpi).toContain('border-radius: var(--radius-kpi)')
    expect(kpi).toContain('var(--shadow-kpi)')
    expect(kpi).not.toContain('border:')
    expect(css).toContain('--shadow-kpi: 0 8px 16px')
  })

  it('as telas do M3 falam nas duas réguas de título e na voz da navegação', () => {
    // título de PÁGINA onde a tela tem título próprio (o hub e a aba Convites
    // recebem o da barra do shell, que deriva do trilho)
    for (const rel of [
      'src/app/admin/alunos/[id]/page.tsx',
      'src/app/admin/alunos/grupo/[eixo]/[valor]/page.tsx',
    ]) {
      expect(corpo(rel), rel).toContain('title-page')
    }
    // título de SEÇÃO nas peças que abrem bloco
    for (const rel of [
      'src/components/kit/card-panel.tsx',
      'src/components/kit/empty-state.tsx',
      'src/components/admin/alunos/ficha/pecas.tsx',
      'src/app/admin/alunos/novo/AdmissionWizard.tsx',
    ]) {
      expect(corpo(rel), rel).toContain('title-section')
    }
    // menus na voz da navegação (Roboto 14) — os três que abrem menu
    for (const rel of [
      'src/components/kit/data-table.tsx',
      'src/components/kit/select.tsx',
      'src/components/kit/split-button.tsx',
    ]) {
      expect(codigo(rel), rel).toContain('nav-tb-item')
    }
    // …e nenhum título do M3 inventa tamanho: h1–h3 são as duas réguas, sempre
    // (o h4 é o sub-rótulo de 14px do kit, e por isso fica fora). Número
    // grande de cartão (o `text-3xl` do cartão de grupo, o `text-2xl` do trio
    // de créditos) NÃO é título — é dado em destaque, que a régua manda
    // engordar.
    for (const rel of ARQUIVOS_NOVOS) {
      for (const tag of codigo(rel).match(/<h[1-3][^>]*>/g) ?? []) {
        expect(tag, `${rel}: ${tag}`).toMatch(/title-(page|section)/)
      }
    }
  })

  it('nenhuma PÁGINA do M3 faz query inline — quem lê é a camada de dados', () => {
    for (const rel of PAGINAS_DO_M3) {
      const p = codigo(rel)
      expect(p, rel).not.toContain('@/lib/supabase')
      expect(p, rel).not.toMatch(/\.from\(/)
      expect(p, rel).not.toMatch(/\.rpc\(/)
    }
    // …e o wizard, que é componente mas vive dentro de uma página, também não
    // (era ele quem abria um `createClient()` no meio do JSX, até o M3-3)
    const w = codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    expect(w).not.toContain('@/lib/supabase')
    expect(w).toContain('getAdmissionContext')
  })

  it('o Select do kit é o do Radix, com item na voz da navegação e ✓ no escolhido', () => {
    const s = codigo('src/components/kit/select.tsx')
    expect(s).toContain("@radix-ui/react-select")
    expect(s).toContain('nav-tb-item')
    expect(s).toContain('ItemIndicator')
  })

  // §7 do plano de clonagem: a linha é ÂNCORA, nunca `onClick` em `<tr>`.
  it('a tabela navega por link real ampliado — nada de onClick na linha', () => {
    const t = codigo('src/components/kit/data-table.tsx')
    expect(t).not.toMatch(/<tr[^>]*onClick/)
    expect(t).not.toMatch(/onClick=\{\(\) => (router|window\.location)/)
    expect(t).toContain('<Link')
    // a capa que amplia o alvo até as bordas da linha
    expect(t).toContain('after:absolute after:inset-0')
    // …e a linha precisa ser o bloco contido dessa capa
    expect(t).toMatch(/<tr\b[\s\S]{0,200}?relative/)
  })

  it('a tabela tem kebab por linha, com itens na voz da navegação', () => {
    const t = codigo('src/components/kit/data-table.tsx')
    expect(t).toContain('DropdownMenu')
    expect(t).toContain('nav-tb-item')
    expect(t).toMatch(/aria-label=\{[\s\S]{0,120}Ações/)
  })

  it('a tabela pagina no rodapé, no padrão medido', () => {
    const t = corpo('src/components/kit/data-table.tsx')
    expect(t).toContain('Itens por página')
    expect(t).toContain('LIMIAR_DE_PAGINACAO = 50')
    expect(t).toContain('TAMANHOS_DE_PAGINA = [25, 50]')
    expect(t).toMatch(/aria-label="Paginação"/)
    expect(t).toMatch(/aria-label="Página anterior"/)
  })

  it('a tabela é HTML semântico: caption, escopo de coluna e números tabulares', () => {
    const t = codigo('src/components/kit/data-table.tsx')
    expect(t).toContain('<caption')
    expect(t).toMatch(/<th\b[\s\S]{0,80}scope="col"/)
    expect(t).toContain('tabular-nums')
  })

  it('a busca reage com CONTAGEM ANUNCIADA (item 7 das fundações)', () => {
    const l = codigo('src/components/admin/alunos/ListaDeAlunos.tsx')
    expect(l).toContain('aria-live="polite"')
    expect(l).toContain('casaComBusca')
    // filtro no cliente sobre o que já veio — nada de ida ao servidor por tecla
    expect(l).not.toContain('.rpc(')
    expect(l).not.toContain('router.push')
  })

  it('as três telas que leem o diretório chamam a MESMA camada de dados', () => {
    for (const rel of [
      'src/app/admin/alunos/page.tsx',
      'src/app/admin/alunos/convites/page.tsx',
      'src/app/admin/alunos/grupo/[eixo]/[valor]/page.tsx',
    ]) {
      expect(codigo(rel), rel).toContain("from '@/data/admin/alunos'")
    }
  })

  // O e-mail entrou na linha para a aba Convites (M3-3). As três listas são
  // componentes CLIENTE: o que entra na linha viaja no HTML. Então só a tela
  // que MOSTRA contato recebe contato.
  it('o contato só viaja para a tela que o desenha', () => {
    const d = codigo('src/data/admin/alunos.ts')
    expect(d).toContain('function semContato')
    // A lista do hub passou a ter recorte (`?f=` do ciclo de vida, fase 1) —
    // seja qual for o recorte, ela sai por `semContato`.
    expect(d).toMatch(/alunos: \(recorte[\s\S]{0,120}\)\.map\(semContato\)/)
    expect(d).toContain('buscaveis: alunos.map(semContato)')
    expect(d).toMatch(/alunosDoGrupo\([\s\S]{0,40}\)\.map\(semContato\)/)
    // a busca continua sem varrer contato (é a mesma razão)
    const g = codigo('src/data/admin/alunos-grupos.ts')
    expect(g).toMatch(/casaComBusca[\s\S]{0,400}normalizarTermo\(aluno\.cidade\)/)
    expect(g).not.toMatch(/casaComBusca[\s\S]{0,400}aluno\.email/)
  })

  it('a camada de dados é server-only, valida o retorno e não engole erro', () => {
    const d = corpo('src/data/admin/alunos.ts')
    expect(d.startsWith("import 'server-only'")).toBe(true)
    expect(d).toContain('DiretorioSchema.parse')
    expect(d).toContain("exigir('o diretório de alunos'")
    expect(d).toContain("exigir('as professoras'")
    // Lei 1: a hora local do aluno é calculada no SERVIDOR, na zona dele.
    expect(d).toContain('setZone(linha.iana_tz)')
  })

  // M4-1: a aba "Contratos" deixou de apontar para a tela VELHA e passou a
  // apontar para a rota irmã `/admin/alunos/contratos` (o índice novo). O
  // aceite não afrouxou — segue exigindo destino real nas três abas; o que
  // mudou é qual destino é o real.
  it('as três abas do hub têm destino real e nenhuma promessa vazia', () => {
    const p = corpo('src/app/admin/alunos/page.tsx')
    expect(p).toContain("label: 'Alunos'")
    expect(p).toContain("label: 'Convites', href: '/admin/alunos/convites'")
    expect(p).toContain("label: 'Contratos', href: '/admin/alunos/contratos'")
    // e a aba Convites existe mesmo, com as três abas de volta
    const c = corpo('src/app/admin/alunos/convites/page.tsx')
    expect(c).toContain("href: '/admin/alunos'")
    expect(c).toContain("href: '/admin/alunos/contratos'")
    expect(c).toContain('active: true')
  })

  it('os deep links da lista velha continuam chegando onde prometiam (T3)', () => {
    const p = corpo('src/app/admin/alunos/page.tsx')
    expect(p).toContain("redirect('/admin/alunos/grupo/produto/particular')")
    expect(p).toContain("redirect('/admin/alunos/grupo/produto/travel')")
    // o wizard velho continua hospedado aqui (ele volta para cá entre etapas)
    expect(p).toContain('AdmissionWizard')
    expect(p).toContain('sp.novo')
    // M3-3: o `?f=` de acesso ganhou destino (a aba Convites) e o painel
    // `?convidar=1` MORREU — o endereço dele redireciona para a aba.
    expect(p).toContain('ehAcesso(sp.f)')
    expect(p).toContain("redirect('/admin/alunos/convites')")
    // …e o Sheet duplicado não existe mais em lugar nenhum
    expect(codigo('src/app/admin/alunos/page.tsx')).not.toContain('semConvite')
  })

  /* ------------------------------------------------- W1 · wizard revestido */

  it('o wizard veste a anatomia medida: stepper, grade, rodapé fixo e cross-fade', () => {
    const w = codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    // O STEPPER MUDOU DE ARQUIVO no M4-3 (virou peça do kit, porque o wizard de
    // contrato desenha o mesmo): a anatomia é conferida onde ela agora mora, e
    // aqui fica o que ESTA tela promete — que é consumir a peça com os rótulos
    // das três etapas da admissão.
    expect(w).toContain("from '@/components/kit/stepper'")
    expect(w).toContain('<Stepper etapas={ETAPAS_DA_ADMISSAO}')
    const stepper = codigo('src/components/kit/stepper.tsx')
    // stepper de círculos numerados com ✓ no feito e anel do acento no atual
    expect(stepper).toContain('etapas.map')
    expect(stepper).toContain('rounded-full')
    expect(stepper).toContain('ring-2 ring-ac-vivid/40')
    // M3-c3 · A1 — RESPIRO do stepper: o anel do passo atual mede 4px para
    // fora do círculo e não ocupa espaço de layout; sem padding em cima, o
    // corpo do painel (contêiner de rolagem) recortava o anel contra a
    // hairline do cabeçalho. O padding é SIMÉTRICO — `py-5`, nunca só `pb`.
    expect(stepper).toMatch(/border-b border-line-soft py-5/)
    expect(stepper).not.toMatch(/border-b border-line-soft pb-5/)
    expect(stepper).toMatch(/estado === 'feita' \? <Check/)
    expect(stepper).toMatch(/aria-current=\{estado === 'atual' \? 'step'/)
    // grade de 2 colunas alinhada + rótulo/apoio das peças do M3-2
    expect(w).toContain('<GradeDeCampos>')
    expect(w).toContain('<Campo rotulo=')
    // seções com hairline e frase de apoio (o `hint` do kit)
    expect(w).toMatch(/<SheetSection\s+title=/)
    // rodapé fixo do kit, com o sólido h40 (`btn-ac-lg`)
    expect(w).toContain('<SheetFooter')
    expect(w).toContain('btn-ac btn-ac-lg')
    expect(w).toContain('Cancelar')
    // A ETAPA 2 mudou de arquivo no M3-c4 · B5 (virou componente cliente para
    // poder mostrar a agenda ocupada da professora), e a anatomia dela viajou
    // junto — inclusive o stepper e o rodapé, que continuam vindo daqui como
    // filhos. O aceite segue o código em vez de afrouxar.
    const etapa2 = codigo('src/app/admin/alunos/novo/EtapaDoContrato.tsx')
    expect(w).toContain('<EtapaDoContrato')
    expect(w).toContain('passos={<Passos atual={2} />}')
    expect(w).toMatch(/rodape=\{\s*<Rodape/)
    expect(etapa2).toContain('<GradeDeCampos>')
    expect(etapa2).toMatch(/<SheetSection\s+title=/)
    // sufixo/prefixo DENTRO do campo, com a unidade anunciada
    expect(etapa2).toContain('<ComUnidade')
    expect(etapa2).toContain('prefixo="R$"')
    expect(etapa2).toContain('sufixo="min"')
    expect(etapa2).toMatch(/aria-describedby=/)
    // cross-fade curto entre passos, com remonte forçado
    expect(w).toContain('passo-fade')
    expect(w).toContain('key={etapa}')

    // …e o cross-fade existe no CSS, curto e desligado em reduced-motion
    const css = corpo('src/app/globals.css')
    expect(css).toContain('.passo-fade {')
    expect(css).toContain('animation: passo-fade var(--duration-hover)')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.passo-fade \{\s*animation: none;/)
  })

  it('o wizard não reescreveu mutação nenhuma — são as actions de sempre', () => {
    const w = codigo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    for (const acao of ['wizardStudentAction', 'wizardContractAction', 'inviteStudentAction']) {
      expect(w, acao).toContain(`action={${acao}}`)
    }
    // e o Sheet do painel entrega o corpo CRU (senão o rodapé rolaria junto)
    expect(corpo('src/app/admin/alunos/page.tsx')).toContain('bruto')
  })

  it('a conclusão do wizard mostra o check verde e os próximos passos como cards', () => {
    const w = corpo('src/app/admin/alunos/novo/AdmissionWizard.tsx')
    expect(w).toContain('Aluno criado!')
    expect(w).toContain('text-ok-700')
    // M3-c3 · A3: os próximos passos são CARTÕES DE COISA clicáveis, então
    // vestem a elevação da casa (a mesma do KPI do Início), não o hairline.
    expect(w).toContain('card-kpi card-kpi-interactive')
    // os três destinos são REAIS (ficha, painel de convite, novo cadastro)
    expect(w).toContain("enderecoDaFicha(student.id, { painel: 'convidar' })")
    expect(w).toContain('enderecoDaFicha(student.id)')
    expect(w).toContain('enderecoDaAdmissao(1)')
    // o convite feito NO wizard volta para a conclusão dele (só o destino)
    expect(w).toContain('name="back" value={enderecoDaAdmissao(CONCLUSAO, student.id)}')
  })

  /* ------------------------------------------------------ W2 · aba Convites */

  it('a aba Convites conta os três estados e age com as actions existentes', () => {
    const p = corpo('src/app/admin/alunos/convites/page.tsx')
    expect(p).toContain('getInvitesOverview')
    // os três contadores, e o "Todos" que devolve a lista inteira
    expect(p).toContain("rotulo: 'Todos'")
    expect(p).toContain('visao.contagens[a]')
    expect(p).toContain('tabular-nums')
    // estado vazio COMPLETO em cada recorte (nada de tabela muda)
    expect(p).toContain('<EmptyState')
    expect(p).toContain('VAZIO[recorte].titulo')

    const l = codigo('src/components/admin/alunos/ListaDeConvites.tsx')
    // as quatro colunas pedidas
    for (const col of ["id: 'aluno'", "id: 'email'", "id: 'acesso'", "id: 'acao'"]) {
      expect(l, col).toContain(col)
    }
    // identidade compartilhada com o hub (uma coluna, não duas cópias)
    expect(l).toContain("from './ListaDeAlunos'")
    expect(l).toContain('<ColunaIdentidade')
    // devolução de e-mail aparece onde ela importa
    expect(l).toContain('emailDevolvido')
    // a ação é a MESMA action de reenvio, com o destino de volta desta aba —
    // entregue pela PÁGINA (a lista é cliente e não importa `'use server'`,
    // que registraria todas as actions do arquivo como endpoint)
    expect(p).toContain('reenviarConvite={resendInviteAction}')
    expect(l).toContain('action={reenviarConvite}')
    expect(l).not.toContain("from '@/app/admin/alunos/actions'")
    expect(l).toContain('name="back"')
    expect(l).toContain('btn-ac-soft')
    // e o botão fica ACIMA da capa do link da linha
    expect(l).toContain('relative z-10')
  })

  it('o convite continua sendo o fluxo da ficha (nada de segunda porta)', () => {
    const l = codigo('src/components/admin/alunos/ListaDeConvites.tsx')
    expect(l).toContain('?painel=convidar')
    // a aba não inventa formulário de convite: quem tem e-mail/WhatsApp é a ficha
    expect(l).not.toContain('inviteStudentAction')
  })

  it('a página do grupo tem trilha de volta rotulada e dá 404 honesto', () => {
    const g = corpo('src/app/admin/alunos/grupo/[eixo]/[valor]/page.tsx')
    expect(g).toMatch(/<nav aria-label="Trilha">/)
    expect(g).toContain('notFound()')
    expect(g).toContain('ehEixoDeGrupo(eixo)')
    expect(g).toContain('title-page')
  })
})

/* ========================================================================== */
/* 5. Render de verdade (o grep não prova que a peça desenha)                  */
/* ========================================================================== */

/** Aluno sintético: metade com acesso ativo, todos com contrato particular. */
function alunoFake(i: number): AlunoDaLista {
  return montarAluno(
    {
      id: `id-${i}`,
      display_name: `Aluno ${i}`,
      iana_tz: 'America/Cuiaba',
      status: 'active',
      city: 'Cuiabá',
      country: 'BR',
      level: 'B1',
      profile_id: i % 2 ? `p-${i}` : null,
      whatsapp_e164: null,
      whatsapp_channel_ack_at: null,
      email_bounced_at: null,
      invited_at: null,
      email: null,
      email_confirmed: i % 2 === 1,
      last_sign_in_at: null,
      contracts: [
        {
          contract_id: `c-${i}`,
          contract_type: 'private_1on1',
          plan_name: null,
          status: 'active',
          teacher_id: 't-1',
          teacher_name: 'Helena',
          group_label: null,
          balance: 2,
          next_expiry: null,
        },
      ],
    },
    { cidade: 'Cuiabá', horaLocal: '10:00', idxDaProfessora: () => 0 },
  )
}

describe('as peças novas desenham', () => {
  const colunas = [{ id: 'n', cabecalho: 'Aluno', celula: (a: AlunoDaLista) => a.nome }]

  it('a tabela pagina acima de 50 linhas, com o rodapé medido', () => {
    const html = renderToStaticMarkup(
      h(DataTable<AlunoDaLista>, {
        linhas: Array.from({ length: 60 }, (_, i) => alunoFake(i)),
        colunas,
        chaveDaLinha: (a: AlunoDaLista) => a.id,
        hrefDaLinha: (a: AlunoDaLista) => `/admin/alunos/${a.id}`,
        acoesDaLinha: () => [{ rotulo: 'Ver ficha', href: '/x' }],
        legenda: 'Alunos',
      }),
    )
    expect(html).toContain('Itens por página')
    expect(html).toContain('1–25 de 60')
    expect(html).toContain('scope="col"')
    // 25 linhas na página, cada uma com sua âncora real
    expect(html.match(/<tr class="relative/g) ?? []).toHaveLength(25)
    expect(html).toContain('href="/admin/alunos/id-0"')
  })

  it('abaixo do limiar a tabela mostra tudo, sem rodapé de paginação', () => {
    const html = renderToStaticMarkup(
      h(DataTable<AlunoDaLista>, {
        linhas: Array.from({ length: 20 }, (_, i) => alunoFake(i)),
        colunas,
        chaveDaLinha: (a: AlunoDaLista) => a.id,
        legenda: 'Alunos',
      }),
    )
    expect(html).not.toContain('Itens por página')
    expect(html.match(/<tr class="relative/g) ?? []).toHaveLength(20)
  })

  it('lista sem ninguém desenha o estado vazio que a página mandou', () => {
    const html = renderToStaticMarkup(
      h(ListaDeAlunos, {
        alunos: [],
        legenda: 'Alunos',
        vazio: h('p', null, 'Nenhum aluno cadastrado ainda.'),
      }),
    )
    expect(html).toContain('Nenhum aluno cadastrado ainda.')
    expect(html).toContain('0 alunos')
  })

  it('a contagem viva nasce com o tamanho da lista e é anunciada', () => {
    const html = renderToStaticMarkup(
      h(ListaDeAlunos, {
        alunos: Array.from({ length: 3 }, (_, i) => alunoFake(i)),
        legenda: 'Alunos',
        vazio: h('p', null, 'vazio'),
      }),
    )
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('3 alunos')
    // singular/plural na mão, porque "1 alunos" é o tipo de detalhe que faz a
    // tela parecer gerada
    const um = renderToStaticMarkup(
      h(ListaDeAlunos, { alunos: [alunoFake(1)], legenda: 'Alunos', vazio: h('p', null, 'v') }),
    )
    expect(um).toContain('1 aluno<')
  })

  it('a lista de convites desenha e-mail, consequência declarada e a ação de cada estado', () => {
    /** Um aluno em cada situação de acesso (o que a aba existe para separar). */
    const comAcesso = (
      acesso: 'ativo' | 'pendente' | 'sem_convite',
      email: string | null,
    ): AlunoDaLista =>
      montarAluno(
        {
          id: `id-${acesso}`,
          display_name: `Aluno ${acesso}`,
          iana_tz: 'America/Cuiaba',
          status: 'active',
          city: 'Cuiabá',
          country: 'BR',
          level: null,
          profile_id: acesso === 'sem_convite' ? null : `p-${acesso}`,
          whatsapp_e164: null,
          whatsapp_channel_ack_at: null,
          email_bounced_at: acesso === 'pendente' ? '2026-07-20T00:00:00Z' : null,
          invited_at: '2026-07-21T00:00:00Z',
          email,
          email_confirmed: acesso === 'ativo',
          last_sign_in_at: null,
          contracts: [],
        },
        {
          cidade: 'Cuiabá',
          horaLocal: '10:00',
          idxDaProfessora: () => 0,
          convidadoEm: acesso === 'sem_convite' ? null : '21/07/2026',
        },
      )

    const html = renderToStaticMarkup(
      h(ListaDeConvites, {
        alunos: [
          comAcesso('ativo', 'ativo@exemplo.com'),
          comAcesso('pendente', 'pendente@exemplo.com'),
          comAcesso('sem_convite', null),
        ],
        vazio: h('p', null, 'vazio'),
        voltarPara: '/admin/alunos/convites?f=pendente',
        reenviarConvite: () => {},
      }),
    )

    // e-mail na coluna, e "—" para quem ainda não tem login
    expect(html).toContain('ativo@exemplo.com')
    expect(html).toContain('—')
    // estado + CONSEQUÊNCIA, no padrão medido
    expect(html).toContain('já criou a senha e entra no portal')
    expect(html).toContain('convite enviado em 21/07/2026 — ainda não criou a senha')
    expect(html).toContain('ainda não recebeu convite nenhum')
    // devolução de e-mail aparece onde ela importa
    expect(html).toContain('devolvido pelo servidor')
    // ação por estado: convidar leva ao painel da ficha; reenviar é formulário
    expect(html).toContain('href="/admin/alunos/id-sem_convite?painel=convidar"')
    expect(html).toContain('Reenviar')
    expect(html).toContain('value="/admin/alunos/convites?f=pendente"')
    // quem já entra no portal não tem ação nenhuma pendurada
    expect(html).not.toContain('id-ativo?painel=convidar')
  })

  it('o cartão de grupo mostra identidade, contagem e pendência', () => {
    const grupo = agrupar(Array.from({ length: 4 }, (_, i) => alunoFake(i)), 'nivel')[0]
    const html = renderToStaticMarkup(h(CartaoDeGrupo, { grupo }))
    expect(html).toContain('B1')
    expect(html).toContain('4')
    // metade dos fakes está sem acesso ativo. A linha virou INFORMAÇÃO (M3-c1
    // · C3a): tinta secundária, com o NÚMERO em destaque — não mais o âmbar de
    // alarme, que fazia o dono ler o cartão como problema.
    expect(html).toContain('sem acesso ao portal')
    expect(html).toMatch(/font-semibold text-ink-900">2<\/span> sem acesso ao portal/)
    expect(html).not.toContain('text-warn-700')
    expect(html).toContain('href="/admin/alunos/grupo/nivel/b1"')
  })
})
