// ONDA 1 · M4-4 — O ENCAMINHAMENTO, A MORTE DA TELA VELHA E A POLÍTICA ÚNICA.
//
// O último sub-milestone do M4 não constrói tela: ele FECHA portas. Três coisas
// mudam de estado e todas as três são verificáveis sem browser:
//
//  1. `/admin/contratos` deixa de ser uma tela e vira um mapa de encaminhamento
//     (308). O mapa é função PURA — e é testado por comportamento, caso a caso,
//     não por grep: encaminhamento errado manda a dona para o lugar errado, e
//     "o arquivo contém a string certa" nunca provou isso.
//  2. A lista velha (814 linhas, kit velho, dois formulários de criação) morre,
//     e com ela as duas actions que escreviam contrato SOLTO.
//  3. Os três números da política da escola passam a ter UMA declaração.
//
// E, de lambuja, a varredura: nenhum link do app aponta mais para o endereço
// velho — quem sabe criar contrato manda para o wizard, quem sabe listar manda
// para a aba.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  INDICE_DE_CONTRATOS,
  NOVO_PARA_RAMO,
  destinoDoLegado,
  ramoDoNovo,
} from '@/data/admin/contratos-legado'
import { enderecoDoNovoContrato } from '@/data/admin/contrato-novo'
import { POLICY } from '@/lib/policy'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** Todo arquivo de código de `src/` (a varredura precisa olhar o app inteiro). */
function arquivosDeSrc(dir = 'src'): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`
    if (statSync(path.join(RAIZ, rel)).isDirectory()) saida.push(...arquivosDeSrc(rel))
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(rel)
  }
  return saida
}

const PAGINA_VELHA = 'src/app/admin/contratos/page.tsx'

/* ========================================================================== */
/* 1. O mapa de encaminhamento, caso a caso                                    */
/* ========================================================================== */

describe('destinoDoLegado — a tabela do M4-4', () => {
  it('sem query nenhuma, o endereço velho é o índice novo', () => {
    expect(destinoDoLegado({})).toBe('/admin/alunos/contratos')
    expect(INDICE_DE_CONTRATOS).toBe('/admin/alunos/contratos')
  })

  it('`?novo=individual` e `?novo=grupo` viram o WIZARD com o tipo escolhido', () => {
    expect(destinoDoLegado({ novo: 'individual' })).toBe('/admin/contratos/novo?tipo=individual')
    expect(destinoDoLegado({ novo: 'grupo' })).toBe('/admin/contratos/novo?tipo=grupo')
    // e o endereço sai da gramática do wizard — não é literal em dois lugares
    expect(destinoDoLegado({ novo: 'grupo' })).toBe(enderecoDoNovoContrato('grupo'))
  })

  it('a tradução `?novo=` → `?tipo=` é a tabela, e ela recusa o que não conhece', () => {
    expect(Object.keys(NOVO_PARA_RAMO).sort()).toEqual(['grupo', 'individual'])
    expect(ramoDoNovo('individual')).toBe('individual')
    expect(ramoDoNovo('grupo')).toBe('grupo')
    // a mentoria nunca teve porta na tela velha; `group` é o vocabulário da RPC
    // (`p_kind`), não o do `?tipo=` — nenhum dos dois vira wizard por engano
    expect(ramoDoNovo('mentoria')).toBeNull()
    expect(ramoDoNovo('group')).toBeNull()
    expect(ramoDoNovo('')).toBeNull()
    expect(ramoDoNovo(undefined)).toBeNull()
  })

  it('`?novo=` desconhecido cai no ÍNDICE — nunca num wizard sem tipo', () => {
    expect(destinoDoLegado({ novo: 'mentoria' })).toBe('/admin/alunos/contratos')
    expect(destinoDoLegado({ novo: 'group' })).toBe('/admin/alunos/contratos')
    expect(destinoDoLegado({ novo: 'lixo' })).toBe('/admin/alunos/contratos')
  })

  it('busca, situação e organização chegam inteiras na aba nova', () => {
    expect(destinoDoLegado({ q: 'Sabrina' })).toBe('/admin/alunos/contratos?q=Sabrina')
    expect(destinoDoLegado({ st: 'active' })).toBe('/admin/alunos/contratos?st=active')
    expect(destinoDoLegado({ st: 'paused' })).toBe('/admin/alunos/contratos?st=paused')
    expect(destinoDoLegado({ ver: 'professora' })).toBe('/admin/alunos/contratos?ver=professora')
    expect(destinoDoLegado({ ver: 'nivel' })).toBe('/admin/alunos/contratos?ver=nivel')
    expect(destinoDoLegado({ q: 'Ana', st: 'active', ver: 'nivel' })).toBe(
      '/admin/alunos/contratos?q=Ana&st=active&ver=nivel',
    )
  })

  it('valor de padrão ou de lixo não vira estado na URL nova', () => {
    // `todos` e `lista` SÃO o padrão da tela nova: repeti-los só alonga o link
    expect(destinoDoLegado({ st: 'todos', ver: 'lista' })).toBe('/admin/alunos/contratos')
    // e o que a tela nova não entende não viaja
    expect(destinoDoLegado({ st: 'ended', ver: 'inventado' })).toBe('/admin/alunos/contratos')
  })

  it('o recado das actions velhas sobrevive à mudança de endereço', () => {
    expect(destinoDoLegado({ msg: 'Contrato pausado', n: '42' })).toBe(
      '/admin/alunos/contratos?msg=Contrato+pausado&n=42',
    )
    // com acento e pontuação (a frase real das actions) o recado vai codificado
    expect(destinoDoLegado({ msg: 'Falha: horário já existe' })).toBe(
      '/admin/alunos/contratos?msg=Falha%3A+hor%C3%A1rio+j%C3%A1+existe',
    )
    // e continua junto do recorte que a pessoa tinha
    expect(destinoDoLegado({ msg: 'Regras atualizadas', n: '1', st: 'paused' })).toBe(
      '/admin/alunos/contratos?msg=Regras+atualizadas&n=1&st=paused',
    )
  })

  it('recado GANHA do wizard: mensagem nenhuma é engolida em silêncio', () => {
    // combinação que os links velhos nunca produziram — mas se ela chegar, o
    // destino é a única tela que MOSTRA o recado (o wizard não tem AvisoLegado)
    expect(destinoDoLegado({ novo: 'individual', msg: 'Falha: dados incompletos' })).toBe(
      '/admin/alunos/contratos?msg=Falha%3A+dados+incompletos',
    )
  })

  it('o `n=` só viaja acompanhando um recado (sozinho ele não diz nada)', () => {
    expect(destinoDoLegado({ n: '99' })).toBe('/admin/alunos/contratos')
  })
})

/* ========================================================================== */
/* 2. A tela velha morreu                                                      */
/* ========================================================================== */

describe('a lista velha de contratos (814 linhas) morreu', () => {
  it('o `page.tsx` é só a porta: lê a query, obedece ao mapa e faz 308', () => {
    const p = corpo(PAGINA_VELHA)
    expect(p).toContain("import { permanentRedirect } from 'next/navigation'")
    expect(p).toContain('permanentRedirect(destinoDoLegado(await searchParams))')
    // 308, nunca 307: a mudança de endereço é definitiva
    expect(codigo(PAGINA_VELHA), 'redirect temporário não ensina o favorito').not.toMatch(
      /\bredirect\(/,
    )
    // e ele não decide nada por conta própria — a regra mora no módulo puro
    expect(p).toContain("from '@/data/admin/contratos-legado'")
  })

  it('a tela sumiu: nem kit velho, nem leitura, nem formulário', () => {
    const c = codigo(PAGINA_VELHA)
    // o `Drawer` (e o resto do kit velho) era o coração do cartão de contrato
    expect(c).not.toContain('<Drawer')
    expect(c).not.toContain("from '@/components/ui'")
    // sete leituras inline na página — a coisa que a camada `src/data` matou
    expect(c).not.toMatch(/\.from\(|\.rpc\(|createClient/)
    // e os dois formulários de criação
    expect(c).not.toContain('<form')
    expect(c).not.toContain('SidePanel')
    // 814 → uma porta. O número é generoso de propósito: o aceite é "não é mais
    // uma tela", não uma contagem exata de linhas de comentário.
    expect(corpo(PAGINA_VELHA).split('\n').length).toBeLessThan(60)
  })

  it('as duas actions que escreviam contrato solto saíram do repositório', () => {
    const a = corpo('src/app/admin/contratos/actions.ts')
    expect(codigo('src/app/admin/contratos/actions.ts')).not.toContain('createContractAction')
    expect(codigo('src/app/admin/contratos/actions.ts')).not.toContain('createGroupContractAction')
    // …e com elas o `insert` direto em `contracts`/`student_groups`. O que
    // sobrou de `.from('contracts')` no arquivo é LEITURA (o nome do plano que
    // vai no PDF da assinatura) — escrita de contrato agora é só pela RPC.
    expect(codigo('src/app/admin/contratos/actions.ts')).not.toMatch(
      /\.from\('(contracts|student_groups|student_group_members)'\)\s*\.insert/,
    )
    expect(codigo('src/app/admin/contratos/actions.ts')).not.toMatch(
      /from\('(contracts|student_groups|student_group_members)'\)\.insert/,
    )
    // o que ficou são as ações que o DETALHE usa — nenhuma delas foi tocada
    for (const acao of [
      'updateContractRulesAction',
      'renewContractAction',
      'endContractAction',
      'pauseContractAction',
      'resumeContractAction',
      'adjustCreditAction',
      'createSlotAction',
      'closeAndCreateSlotAction',
      'sendContractForSignatureAction',
      'refreshSignatureStatusAction',
    ]) {
      expect(a, acao).toContain(`export async function ${acao}(`)
    }
  })

  it('ninguém no app importa as actions mortas', () => {
    for (const rel of arquivosDeSrc()) {
      const c = codigo(rel)
      expect(c, rel).not.toContain('createContractAction')
      expect(c, rel).not.toContain('createGroupContractAction')
    }
  })
})

/* ========================================================================== */
/* 3. A varredura das entradas                                                 */
/* ========================================================================== */

describe('nenhuma entrada do app aponta para o endereço velho', () => {
  // O que PODE citar `/admin/contratos` sem ser um link para a tela morta:
  //  · a própria porta de encaminhamento;
  //  · o trilho, que marca "Alunos" como seção ativa também sob esse prefixo
  //    (o detalhe e o wizard vivem lá dentro);
  //  · o padrão do `back` nas actions — que é justamente o endereço que o 308
  //    resolve, levando o recado junto.
  const PERDOADOS = new Set([PAGINA_VELHA, 'src/components/admin/nav.ts', 'src/app/admin/contratos/actions.ts'])

  it('grep do endereço exato em src/: só os três casos declarados', () => {
    const achados: string[] = []
    for (const rel of arquivosDeSrc()) {
      if (PERDOADOS.has(rel)) continue
      const c = codigo(rel)
      // `/admin/contratos` seguido de fim-de-string, `?` ou crase — o que NÃO
      // casa é `/admin/contratos/algo`, que são as sub-rotas vivas
      if (/['"`]\/admin\/contratos(\?[^'"`]*)?['"`]/.test(c)) achados.push(rel)
    }
    expect(achados).toEqual([])
  })

  it('quem oferece "Criar contrato" manda para o wizard', () => {
    // a ficha do aluno: o cartão sem contrato e o cartão de lead
    const coluna = corpo('src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx')
    expect(coluna).toContain("enderecoDoNovoContrato('individual')")
    // a aba Contrato & horários da ficha, no estado vazio
    expect(corpo('src/components/admin/alunos/ficha/abas.tsx')).toContain(
      "enderecoDoNovoContrato('individual')",
    )
    expect(enderecoDoNovoContrato('individual')).toBe('/admin/contratos/novo?tipo=individual')
  })

  it('quem oferece "Ver contratos" manda para a aba do hub', () => {
    for (const rel of [
      'src/app/admin/professoras/[id]/page.tsx',
      'src/app/admin/agenda/page.tsx',
      'src/components/admin/inicio/AndarNegocio.tsx',
    ]) {
      expect(corpo(rel), rel).toContain('/admin/alunos/contratos')
    }
  })

  it('a aba nova toca o recado que ainda chega pela URL', () => {
    const p = corpo('src/app/admin/alunos/contratos/page.tsx')
    expect(p).toContain("<AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />")
    expect(p).toContain("from '@/components/kit/aviso-legado'")
    // …e continua sem PRODUZIR `?msg=` nenhum (ADR-025: tela nova fala por
    // toast). Ela LÊ o recado de quem ainda usa; nenhum link dela o escreve.
    expect(codigo('src/app/admin/alunos/contratos/page.tsx')).not.toContain("p.set('msg'")
    expect(codigo('src/app/admin/alunos/contratos/page.tsx')).not.toContain('?msg=')
  })
})

/* ========================================================================== */
/* 4. A política da escola tem UMA declaração                                  */
/* ========================================================================== */

describe('POLICY única (item 12)', () => {
  it('os três números valem o que a escola combinou', () => {
    expect(POLICY).toEqual({ minNotice: 24, expiryDays: 90, schoolFaultDays: 180 })
  })

  it('só `src/lib/policy.ts` DECLARA o objeto — o resto importa', () => {
    const declaram = arquivosDeSrc().filter((rel) =>
      /minNotice:\s*\d|expiryDays:\s*\d|schoolFaultDays:\s*\d/.test(codigo(rel)),
    )
    expect(declaram).toEqual(['src/lib/policy.ts'])
  })

  it('as três actions que gravam política importam a constante única', () => {
    for (const rel of [
      'src/app/admin/contratos/actions.ts',
      'src/app/admin/alunos/novo/actions.ts',
      'src/app/admin/contratos/novo/actions.ts',
    ]) {
      expect(corpo(rel), rel).toContain("import { POLICY } from '@/lib/policy'")
      expect(corpo(rel), rel).toContain('POLICY.minNotice')
      expect(corpo(rel), rel).toContain('POLICY.expiryDays')
      expect(corpo(rel), rel).toContain('POLICY.schoolFaultDays')
    }
  })

  it('a tela que PROMETE os números lê os mesmos (não uma cópia em prosa)', () => {
    const w = corpo('src/app/admin/contratos/novo/WizardDeContrato.tsx')
    expect(w).toContain("import { POLICY } from '@/lib/policy'")
    expect(w).toContain('`Aviso mínimo de ${POLICY.minNotice} horas`')
    expect(w).toContain('`Crédito de reposição vale ${POLICY.expiryDays} dias`')
    expect(w).toContain('`Falha da escola vale ${POLICY.schoolFaultDays} dias`')
  })
})

/* ========================================================================== */
/* 5. A admissão cria pelo motor atômico                                       */
/* ========================================================================== */

describe('wizardContractAction (admissão) passa pela RPC', () => {
  const REL = 'src/app/admin/alunos/novo/actions.ts'

  it('uma chamada de `admin_create_contract` no lugar do insert + laço', () => {
    const a = corpo(REL)
    expect(a).toContain("supabase.rpc('admin_create_contract'")
    expect(a).toContain("p_kind: 'individual'")
    expect(a).toContain('p_students: [aluno]')
    expect(a).toContain('p_slots: horarios')
    // o insert direto e o laço de `create_slot` morreram
    const c = codigo(REL)
    expect(c).not.toContain("from('contracts')")
    expect(c).not.toContain("rpc('create_slot'")
    expect(c, 'nada de criar contrato e ajustar depois').not.toContain('ajuste depois')
  })

  it('o contrato de FormData da etapa 2 não mudou', () => {
    const a = corpo(REL)
    for (const campo of ['aluno', 'teacher_id', 'plan_name', 'hourly_rate', 'allowance', 'started_on']) {
      expect(a, campo).toContain(`formData.get('${campo}')`)
    }
    // Os dois horários que a etapa oferece continuam saindo de `w/t/d` +
    // índice. O laço passou de `[1, 2].map` para `Array.from({length:
    // HORARIOS_DA_ADMISSAO})` no c12 · nº 12 (o rascunho precisa das MESMAS
    // linhas, e duas listas do mesmo número divergiriam no primeiro ajuste), e
    // por isso o índice virou `i + 1`. Os NOMES DE CAMPO — que é o que este
    // aceite protege — são exatamente os mesmos.
    expect(a).toContain('formData.get(`w${i + 1}`)')
    expect(a).toContain('formData.get(`t${i + 1}`)')
    expect(a).toContain('formData.get(`d${i + 1}`)')
    expect(a).toContain('Array.from({ length: HORARIOS_DA_ADMISSAO }')
    expect(corpo('src/data/admin/admissao.ts')).toContain('export const HORARIOS_DA_ADMISSAO = 2')
  })

  it('as mensagens traduzidas e o redirect por etapa continuam de pé', () => {
    const a = corpo(REL)
    expect(a).toContain('erroDeHorarioEmGente(error?.message')
    // c12 · nº 11 + nº 12: a frase ganhou o "(0 = cortesia)" e a volta para a
    // etapa 2 passa pelo `voltar`, que leva o rascunho junto.
    expect(a).toContain("voltar('Falha: preencha professora, plano, valor (0 = cortesia) e início.')")
    // c13 · nº 8: o `voltar` ganhou uma linha — quando o rascunho não coube no
    // endereço (`coube === false`), ele diz isso em vez de devolver a etapa em
    // branco sem explicação.
    expect(a).toContain('const voltar: (msg: string) => never = (msg) =>')
    expect(a).toContain('step(\n      2,\n      aluno,')
    expect(a).toContain("const coube = rascunho !== ''")
    expect(a).toMatch(/step\(\s*3,/)
    // Lei 9: reais viram centavos aqui, uma vez
    expect(a).toContain('p_hourly_rate_cents: Math.round(rate * 100)')
    // item 12: a política vai explícita, da constante única
    expect(a).toContain('p_min_notice: POLICY.minNotice')
  })
})
