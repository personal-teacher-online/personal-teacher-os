// A DEFINIÇÃO EFETIVA DE UMA FUNÇÃO DO POSTGRES, LIDA DAS MIGRATIONS.
//
// Nasceu dentro de `tests/onda-agenda-a4.test.ts` e virou helper compartilhado no
// A5/L5, quando o segundo arquivo passou a amarrar frase de tela × corpo de RPC.
// Duas cópias divergindo é exatamente o defeito que a versão corrigida abaixo
// conserta: uma delas continuaria lendo função MORTA e dando confiança falsa.
//
// ── O DEFEITO QUE A VERSÃO CORRIGIDA FECHA (Sol · rodada 1 do A4, grave 6) ───
// A primeira versão casava `create (or replace )?function public.<nome>` em
// MINÚSCULAS e terminava o corpo em `\n$$;` ou `\n$fn$;`. Só que as definições
// EFETIVAS de `book_reschedule_window`, `reschedule_class_at`, `_cancel_class_core`
// e `_mark_no_show` estão em `20260727000700_ordem_global_de_locks.sql`, escritas
// pelo `pg_dump` — `CREATE OR REPLACE FUNCTION` em MAIÚSCULAS e corpo em
// `$function$`. O helper não as via e devolvia, caladinho, a versão antiga.
// Consequência: uma mudança de DINHEIRO na função viva passava com o teste verde.
//
// A regra desta versão:
//   · sem distinção de caixa (`gim`);
//   · qualquer tag de dollar-quote (`$$`, `$fn$`, `$function$`, `$body$`);
//   · `public.` OPCIONAL (o dump escreve com, a migration à mão às vezes sem);
//   · varre as migrations EM ORDEM DE NOME e fica com a ÚLTIMA definição — que
//     é a que vale depois de aplicar tudo (migrations são imutáveis, Lei 7, então
//     a ordem de nome É a ordem de aplicação);
//   · `^[ \t]*` amarra o casamento ao começo da linha: comentário SQL (`--`),
//     `revoke execute on function …` e `comment on function …` não entram.
//
// O teste-guarda que derruba a versão ANTIGA continua morando no A4
// (`corpoDaFuncaoAntigo` + a prova de mutação em `book_reschedule_window`): é ele
// que impede a regressão de voltar, e por isso ele NÃO se muda de lugar.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const DIR_MIGRATIONS = join(process.cwd(), 'supabase/migrations')

/** As migrations em ORDEM DE APLICAÇÃO (= ordem de nome; Lei 7 as torna imutáveis). */
export function migrations(): string[] {
  return readdirSync(DIR_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** O SQL cru de uma migration. */
export function sqlDaMigration(arquivo: string): string {
  return readFileSync(join(DIR_MIGRATIONS, arquivo), 'utf8')
}

/** As migrations que DEFINEM a função, em ordem — a última é a que vale. */
export function quemDefine(nome: string): string[] {
  const cabecalho = new RegExp(
    `^[ \\t]*create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${nome}\\s*\\(`,
    'im',
  )
  return migrations().filter((f) => cabecalho.test(sqlDaMigration(f)))
}

/**
 * Os parâmetros de PRIMEIRO NÍVEL, ignorando parênteses (`numeric(8,2)`) e
 * literais (`default '(a,b)'`).
 *
 * COMENTÁRIO SQL SAI AQUI, e não é detalhe: as migrations desta casa comentam
 * DENTRO da lista de argumentos (`p_via text -- 'admin' | 'self'`), e sem tirar
 * isso o comentário entrava no nome do tipo — a assinatura do `create` nunca
 * casava com a do `drop`, a função aparecia com DUAS assinaturas vivas e o helper
 * estourava por ambiguidade inexistente. Medido: 3 das 223 funções do repositório
 * (`_cancel_class_core`, `_mark_no_show`, `admin_end_contract`).
 */
function partesDosArgumentos(lista: string): string[] {
  const partes: string[] = []
  let nivel = 0
  let emTexto = false
  let atual = ''
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i]
    if (emTexto) {
      atual += c
      if (c === "'") emTexto = false
      continue
    }
    // comentário de linha: pula até o fim da linha
    if (c === '-' && lista[i + 1] === '-') {
      const fim = lista.indexOf('\n', i)
      i = fim === -1 ? lista.length : fim
      continue
    }
    // comentário de bloco
    if (c === '/' && lista[i + 1] === '*') {
      const fim = lista.indexOf('*/', i + 2)
      i = fim === -1 ? lista.length : fim + 1
      continue
    }
    if (c === "'") emTexto = true
    else if (c === '(') nivel++
    else if (c === ')') nivel--
    else if (c === ',' && nivel === 0) {
      partes.push(atual)
      atual = ''
      continue
    }
    atual += c
  }
  partes.push(atual)
  return partes.filter((p) => p.trim() !== '')
}

/**
 * Apelidos de tipo que o Postgres trata como o MESMO tipo. O `drop` escreve um,
 * o `create` escreve outro, e sem isto a mesma função pareceria duas.
 */
const APELIDOS: Record<string, string> = {
  integer: 'int',
  int4: 'int',
  int8: 'bigint',
  boolean: 'bool',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'time without time zone': 'time',
  'character varying': 'varchar',
  character: 'char',
  'double precision': 'float8',
  float4: 'real',
}

/** O TIPO de um parâmetro, canonizado. Nome, modo e default saem. */
function tipoDoParametro(parte: string): string | null {
  let t = parte.trim().replace(/\s+/g, ' ')
  // OUT não entra na identidade da função: a assinatura de `drop function` (e a
  // do `pg_proc`) conta só IN/INOUT/VARIADIC. Medido no repositório:
  // `_refund_for_credit_born_class(p_instance uuid, p_fault text, p_actor uuid,
  // OUT o_expires date, OUT o_blocked text)` é dropada como `(uuid, text, uuid)`.
  const modo = /^(in|out|inout|variadic)\s+/i.exec(t)
  if (modo) {
    if (modo[1].toLowerCase() === 'out') return null
    t = t.slice(modo[0].length)
  }
  // O default sai (pode conter `::tipo`, texto e parênteses).
  t = t.split(/\s+default\s+/i)[0].split('=')[0].trim()
  // Sobrou "nome tipo" ou só "tipo" (o `drop` escreve só o tipo). Se houver mais
  // de um token e o primeiro NÃO for parte de um tipo composto, ele é o nome.
  const tokens = t.split(' ')
  if (tokens.length > 1) {
    const semPrimeiro = tokens.slice(1).join(' ')
    // `p_from date` → 'date'. `timestamp with time zone` → não tem nome, e o
    // teste é justamente este: o resto casa um apelido conhecido?
    const candidato = semPrimeiro.toLowerCase()
    if (APELIDOS[candidato] || !APELIDOS[t.toLowerCase()]) t = semPrimeiro
  }
  // Modificador de precisão não entra na identidade (`numeric(8,2)` = `numeric`)
  // e `[]` fica (array é outro tipo).
  t = t.toLowerCase().replace(/\s*\([^)]*\)/g, '')
  return APELIDOS[t] ?? t
}

/**
 * A ASSINATURA da função — a identidade que o Postgres usa, e a que este helper
 * usa para casar `create` com `drop`.
 *
 * Aridade NÃO servia (Sol · rodada 2 do A5): dois overloads de mesma aridade se
 * sobrescreviam no mapa, `vivas.size` ficava 1 e a guarda de ambiguidade nunca
 * estourava — e um `drop` de tipos diferentes apagava a função ERRADA. Como esta
 * é a fundação de TODA prova de dinheiro do lote, mentira silenciosa aqui
 * invalidaria o lote inteiro.
 */
function assinatura(lista: string): string {
  return partesDosArgumentos(lista)
    .map(tipoDoParametro)
    .filter((t): t is string => t !== null)
    .join(',')
}

/**
 * A lista de argumentos que começa no `(` de `inicio` — com os parênteses
 * balanceados e as aspas respeitadas. `null` quando o parêntese não fecha (SQL
 * quebrado): quem chama trata como definição ilegível em vez de adivinhar.
 */
function listaDeArgumentos(sql: string, inicio: number): { lista: string; fim: number } | null {
  let nivel = 0
  let emTexto = false
  for (let i = inicio; i < sql.length; i++) {
    const c = sql[i]
    if (emTexto) {
      if (c === "'") emTexto = false
      continue
    }
    if (c === "'") emTexto = true
    else if (c === '(') nivel++
    else if (c === ')') {
      nivel--
      if (nivel === 0) return { lista: sql.slice(inicio + 1, i), fim: i + 1 }
    }
  }
  return null
}

/**
 * O corpo da definição EFETIVA da função — a que existe depois de aplicar as
 * migrations em ordem — e o arquivo de onde ela veio.
 *
 * ── O QUE A RODADA 1 DO SOL NO A5 CONSERTOU AQUI (menor, mas é a FUNDAÇÃO) ───
 * A versão anterior guardava o último `create` POR NOME e mais nada. Três
 * buracos, e o primeiro é o mesmo do grave 6 do A4 com outra roupa:
 *
 *   1. `DROP FUNCTION` era ignorado. Este repositório dropa 20 vezes (é assim
 *      que ele troca a assinatura de uma função sem criar overload), e uma
 *      migration que DROPE a função e não a recrie deixava o helper devolvendo,
 *      caladinho, o corpo de uma função MORTA — que é exatamente a confiança
 *      falsa que o grave 6 produzia. Agora o replay processa create E drop.
 *   2. OVERLOAD não era distinguido. Duas assinaturas vivas do mesmo nome são
 *      duas funções no Postgres, e "a última que apareceu no texto" não é
 *      resposta — é sorteio. Agora o helper ESTOURA nomeando as assinaturas: em
 *      prova de dinheiro, erro explícito é melhor que corpo plausível.
 *   3. O dollar-quote era o PRIMEIRO depois do cabeçalho, mesmo que aparecesse
 *      dentro da lista de argumentos (um `default '$x$'` bastaria). Agora ele é
 *      procurado depois do `)` que fecha os argumentos e do `as` que abre o
 *      corpo.
 *
 * A identidade usada para casar `create` com `drop` é NOME + ASSINATURA DE TIPOS
 * (ver `assinatura`): o `drop` escreve tipos (`(uuid, uuid, uuid)`) e o `create`
 * escreve nome+tipo+default (`p_instance uuid, …`), então os dois lados são
 * canonizados — modo `OUT` fora (não entra na identidade no Postgres), default
 * fora, apelidos unificados (`integer`→`int`, `timestamp with time zone`→
 * `timestamptz`), modificador de precisão fora (`numeric(8,2)`=`numeric`).
 *
 * A primeira versão usava ARIDADE, e isso ainda enganava (Sol · rodada 2): dois
 * overloads de mesma aridade se sobrescreviam no mapa — `vivas.size` ficava 1 e a
 * guarda de ambiguidade nunca disparava —, e um `drop` de tipos diferentes com a
 * mesma contagem apagava a definição ERRADA. Medido no banco local: `pg_proc` não
 * tem NENHUM overload em `public`, justamente porque as migrations dropam antes
 * de recriar; o helper agora reproduz esse mesmo raciocínio.
 *
 * Função inexistente — ou que não sobrevive ao replay — ESTOURA de propósito:
 * helper mudo é como o grave 6 voltaria (teste verde medindo o nada).
 */
export function definicaoDaFuncao(nome: string): { corpo: string; origem: string } {
  // assinatura de tipos → a última definição viva dela
  const vivas = new Map<string, { corpo: string; origem: string }>()
  const cabecalho = new RegExp(
    `^[ \\t]*create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${nome}\\s*\\(`,
    'gim',
  )
  const dropAlvo = new RegExp(
    `^[ \\t]*drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${nome}\\s*(\\(|;)`,
    'gim',
  )
  for (const arquivo of migrations()) {
    const sql = sqlDaMigration(arquivo)
    // Os DOIS eventos do arquivo, na ordem em que aparecem: uma migration pode
    // dropar a assinatura velha e criar a nova no mesmo arquivo (é o padrão
    // daqui), e a ordem decide.
    const eventos: { pos: number; tipo: 'create' | 'drop'; texto: string }[] = []
    cabecalho.lastIndex = 0
    for (const m of sql.matchAll(cabecalho))
      eventos.push({ pos: m.index!, tipo: 'create', texto: m[0] })
    dropAlvo.lastIndex = 0
    for (const m of sql.matchAll(dropAlvo))
      eventos.push({ pos: m.index!, tipo: 'drop', texto: m[0] })
    eventos.sort((x, y) => x.pos - y.pos)

    for (const e of eventos) {
      const abreParen = sql.indexOf('(', e.pos)
      if (e.tipo === 'drop') {
        // `drop function nome;` sem assinatura só é legal quando a função é
        // única — e aí derruba a única que existe. Sem parêntese antes do `;`,
        // limpa tudo.
        if (e.texto.trim().endsWith(';')) {
          vivas.clear()
          continue
        }
        const args = listaDeArgumentos(sql, abreParen)
        if (!args) continue
        vivas.delete(assinatura(args.lista))
        continue
      }
      const args = listaDeArgumentos(sql, abreParen)
      if (!args) continue
      // O corpo abre no dollar-quote que vem DEPOIS do `as` — nunca o primeiro
      // `$…$` encontrado (que poderia estar num default da lista de argumentos).
      const depois = sql.slice(args.fim)
      const abre = /\bas\s*(\$[A-Za-z_0-9]*\$)/i.exec(depois)
      if (!abre) continue
      const tag = abre[1]
      const inicioCorpo = args.fim + abre.index + abre[0].length - tag.length
      const fim = sql.indexOf(tag, inicioCorpo + tag.length)
      if (fim === -1) continue
      vivas.set(assinatura(args.lista), {
        corpo: sql.slice(e.pos, fim + tag.length),
        origem: arquivo,
      })
    }
  }

  if (vivas.size === 0)
    throw new Error(
      `função ${nome} não encontrada nas migrations depois do replay (nunca criada, ou criada e DROPada sem recriação)`,
    )
  if (vivas.size > 1)
    throw new Error(
      `função ${nome} tem ${vivas.size} assinaturas VIVAS nas migrations ([${[...vivas.keys()].map((k) => `(${k})`).join('] [')}]; origens ${[...vivas.values()].map((v) => v.origem).join(', ')}). ` +
        'Overload em prova de dinheiro não se resolve por sorteio: peça a assinatura certa em vez de adivinhar.',
    )
  return [...vivas.values()][0]
}

export function corpoDaFuncao(nome: string): string {
  return definicaoDaFuncao(nome).corpo
}
