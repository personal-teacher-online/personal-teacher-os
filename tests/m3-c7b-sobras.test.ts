// MICRO-LOTE c7b — as duas sobras apontadas no relatório do c7.
//
// Q1 · a lavagem de ESTADO deixa de ser alpha. O `ok` já tinha virado hex
//      sólido no F1 do c7; `warn` (que REPROVAVA AA fora do papel branco) e
//      `danger` (que passava por sorte do hex, não por desenho) seguem o mesmo
//      caminho. O que este arquivo prova é o par que a pessoa VÊ: texto de
//      estado sobre a lavagem da própria família, e sobre as três superfícies
//      de papel da casa.
// Q2 · `admin_end_contract` pegava o advisory do contrato de origem e SÓ
//      DEPOIS travava a linha do contrato de destino — duas transferências
//      espelhadas (A→B e B→A) fechavam ciclo. A ordem canônica agora é: as
//      duas linhas juntas, ordenadas por uuid, antes de qualquer advisory.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  daysFromToday,
  nomeDeConfirmacao,
} from './helpers/db'

const RAIZ = path.resolve(__dirname, '..')
const CSS = readFileSync(path.join(RAIZ, 'src/app/globals.css'), 'utf8')

/* ========================================================================== */
/* Q1 — lavagem de estado: hex sólido, par provado                             */
/* ========================================================================== */

function luminancia(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contraste(a: string, b: string): number {
  const x = luminancia(a)
  const y = luminancia(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** O que o navegador realmente pinta quando a lavagem é ALPHA: a cor misturada
 *  com a superfície de baixo. É esta conta que faz um mesmo par valer três
 *  contrastes diferentes — o defeito que o Q1 veio matar. */
function compor(hex: string, alfa: number, papel: string): string {
  const canal = (i: number) => {
    const f = parseInt(hex.slice(i, i + 2), 16)
    const b = parseInt(papel.slice(i, i + 2), 16)
    return Math.round(b + (f - b) * alfa)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${canal(1)}${canal(3)}${canal(5)}`
}

function token(nome: string): string {
  const m = CSS.match(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token ${nome} não encontrado no globals.css`)
  return m[1].toLowerCase()
}

const PAPEIS = ['--paper-0', '--paper-50', '--paper-100'] as const
const FAMILIAS = ['ok', 'warn', 'danger'] as const

/** Comentários fora: nas notas de cor a casa CITA o defeito antigo de
 *  propósito, e um grep ingênuo leria a citação como código vivo. */
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('Q1 · a lavagem das pílulas de estado é hex sólido, e o par passa AA', () => {
  it('cada família de estado tem texto e lavagem em HEX (nunca alpha, nunca color-mix)', () => {
    for (const fam of FAMILIAS) {
      expect(token(`--${fam}-700`), fam).toMatch(/^#[0-9a-f]{6}$/)
      expect(token(`--${fam}-wash`), fam).toMatch(/^#[0-9a-f]{6}$/)
      // e a lavagem é LAVAGEM: clara o bastante para a pílula não virar bloco
      expect(luminancia(token(`--${fam}-wash`)), `${fam} é lavagem clara`).toBeGreaterThan(0.8)
    }
  })

  it('AA: texto de estado sobre a própria lavagem E sobre os três papéis', () => {
    for (const fam of FAMILIAS) {
      const fg = token(`--${fam}-700`)
      expect(
        contraste(fg, token(`--${fam}-wash`)),
        `${fam}: texto sobre a própria lavagem`,
      ).toBeGreaterThanOrEqual(4.5)
      for (const papel of PAPEIS) {
        expect(contraste(fg, token(papel)), `${fam} sobre ${papel}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('o MOTIVO congelado: com alpha, warn reprovava nos papéis que não são brancos', () => {
    const warn = token('--warn-700')
    // 4,54:1 sobre o cartão branco — o único caso que o teste antigo media…
    expect(contraste(warn, compor(warn, 0.1, token('--paper-0')))).toBeGreaterThanOrEqual(4.5)
    // …e 4,27:1 / 3,98:1 nos dois papéis de baixo, que a pessoa vê o tempo todo
    expect(contraste(warn, compor(warn, 0.1, token('--paper-50')))).toBeLessThan(4.5)
    expect(contraste(warn, compor(warn, 0.1, token('--paper-100')))).toBeLessThan(4.5)

    // O danger NÃO reprovava em nenhum dos três (o hex é escuro o bastante) —
    // ele veio junto pelo MECANISMO, não pelo número. Se um dia alguém clarear
    // o vermelho, este caso vira o alarme.
    const danger = token('--danger-700')
    for (const papel of PAPEIS) {
      expect(
        contraste(danger, compor(danger, 0.1, token(papel))),
        `danger em alpha sobre ${papel}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('nenhum degrau MAIS ESCURO que a lavagem de warn aguenta AA (por isso o hover mudou de dimensão)', () => {
    const warn = token('--warn-700')
    const wash = token('--warn-wash')
    // o hover do chip de Pendências era `bg-warn-700/15`: 4,22:1 sobre branco
    expect(contraste(warn, compor(warn, 0.15, token('--paper-0')))).toBeLessThan(4.5)
    // e qualquer sólido mais escuro que a wash já entra na zona de reprovação:
    // a wash está a 4,62:1, e o degrau seguinte (1% de coral a mais) cai abaixo
    // de 4,55 — não há folga para escurecer fundo sob texto coral.
    const umDegrauAbaixo = compor(warn, 0.11, token('--paper-0'))
    expect(luminancia(umDegrauAbaixo)).toBeLessThan(luminancia(wash))
    expect(contraste(warn, umDegrauAbaixo)).toBeLessThan(contraste(warn, wash))
  })

  it('os dois kits de pílula consomem a wash, e o alpha sumiu de lá', () => {
    for (const arquivo of ['src/components/kit/pill.tsx', 'src/components/ui.tsx']) {
      // sem comentários: eles CITAM o alpha antigo de propósito (é o registro
      // do porquê), e um grep ingênuo confundiria a nota com o código
      const fonte = semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'))
      for (const fam of FAMILIAS) {
        expect(fonte, `${arquivo} · ${fam}`).toContain(
          `bg-${fam}-wash font-semibold text-${fam}-700`,
        )
        expect(fonte, `${arquivo} · ${fam}`).not.toContain(`bg-${fam}-700/10`)
      }
    }
    for (const fam of FAMILIAS) {
      expect(CSS).toContain(`--color-${fam}-wash: var(--${fam}-wash)`)
    }
  })

  it('a badge "pausado" do ciclo de vida herda a MESMA lavagem (um hex, uma verdade)', () => {
    expect(CSS).toContain('--situacao-pausado-bg: var(--warn-wash)')
    expect(CSS).toContain('--situacao-pausado-fg: var(--warn-700)')
    expect(CSS).toContain('--situacao-ativo-bg: var(--ok-wash)')
    expect(contraste(token('--warn-700'), token('--warn-wash'))).toBeGreaterThanOrEqual(4.5)
  })

  it('VARREDURA: nenhum texto de estado senta sobre lavagem alpha da própria família', () => {
    // Alpha continua legítimo em BORDA (`border-warn-700/30`) e em cartão de
    // aviso com texto de TINTA (`bg-warn-700/5 text-ink-900`) — ali o par é
    // outro e passa com folga. O que morreu é o par texto-X sobre lavagem-X.
    const raiz = path.join(RAIZ, 'src')
    const arquivos = (readdirSync(raiz, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => path.join(raiz, f))
    expect(arquivos.length).toBeGreaterThan(100)

    const achados: string[] = []
    for (const arquivo of arquivos) {
      const fonte = semComentarios(readFileSync(arquivo, 'utf8'))
      if (!/bg-(ok|warn|danger)-700\//.test(fonte)) continue
      // cada literal de string é uma lista de classes em potencial
      for (const [corpo] of fonte.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
        const m = corpo.match(/bg-(ok|warn|danger)-700\//)
        if (m && corpo.includes(`text-${m[1]}-700`)) {
          achados.push(`${path.relative(RAIZ, arquivo)}: ${corpo.trim().slice(0, 120)}`)
        }
      }
    }
    expect(achados).toEqual([])
  })
})

/* ========================================================================== */
/* Q2 — admin_end_contract: linhas de contrato antes do advisory               */
/* ========================================================================== */

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c7b'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function saldo(contrato: string): Promise<number> {
  const [row] = await sql`select public.makeup_balance(${contrato}) as b`
  return Number(row.b)
}

async function creditar(contrato: string) {
  await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contrato}, 1, 'manual_adjust', ${daysFromToday(45)}, 45)`
}

describe('Q2 · encerramentos espelhados não fecham ciclo de lock', () => {
  it('A→B e B→A em paralelo: sem deadlock, um encerra e o outro falha limpo', async () => {
    // dois contratos particulares do MESMO aluno, ambos com crédito vivo — é o
    // saldo vivo que obriga a destinação e faz a função tocar as DUAS linhas.
    const a = await createPrivateContract(sql)
    // c15 · Sol 6: o segundo contrato nasce do MESMO aluno em vez de ser
    // re-apontado depois (trocar o dono virou recusa do gatilho
    // `contracts_vinculo_imutavel`).
    const b = await createPrivateContract(sql, { studentId: a.studentId })
    await creditar(a.contractId)
    await creditar(b.contractId)
    // c13 · nº 5: o encerramento passou a exigir o nome digitado, conferido
    // dentro da transação. Os dois contratos são do MESMO aluno (linha acima),
    // então o nome é o mesmo — e é lido ANTES da corrida, para não somar uma ida
    // ao banco no meio da janela que este teste mede.
    const nomeA = await nomeDeConfirmacao(sql, a.contractId)
    const nomeB = await nomeDeConfirmacao(sql, b.contractId)

    // Uma terceira conexão segura as DUAS linhas: assim as duas RPCs entram na
    // fila juntas e disputam de verdade quando a porta abre. Com a ordem
    // antiga (linha da origem → advisory → linha do destino), cada uma sairia
    // segurando a sua e pedindo a da outra: ciclo, e o Postgres mataria uma
    // com 40P01.
    const seguradora = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    const segurando = seguradora.begin(async (tx) => {
      await tx`
        select 1 from contracts
         where id in (${a.contractId}, ${b.contractId})
         order by id
           for update`
      await solta
    })

    await espera(300)
    // `.then` explícito: o builder do supabase-js só dispara a requisição
    // quando alguém o consome — sem isto as duas chamadas só sairiam no
    // Promise.all, depois de a porta já ter aberto.
    const ida = admin
      .rpc('admin_end_contract', {
        p_contract: a.contractId,
        p_confirm_name: nomeA,
        p_dest_contract: b.contractId,
      })
      .then((r) => r)
    const volta = admin
      .rpc('admin_end_contract', {
        p_contract: b.contractId,
        p_confirm_name: nomeB,
        p_dest_contract: a.contractId,
      })
      .then((r) => r)
    await espera(400)

    soltar()
    await segurando
    const [rIda, rVolta] = await Promise.all([ida, volta])
    await seguradora.end()

    expect(rIda.error?.message ?? '', 'A→B').not.toMatch(/deadlock|40P01/i)
    expect(rVolta.error?.message ?? '', 'B→A').not.toMatch(/deadlock|40P01/i)

    // exatamente UMA passa; a outra falha porque o destino dela acabou de
    // virar `ended` — recusa de negócio, não erro de infraestrutura
    const ok = [rIda, rVolta].filter((r) => r.error === null)
    const falhou = [rIda, rVolta].filter((r) => r.error !== null)
    expect(ok).toHaveLength(1)
    expect(falhou[0].error?.message).toContain('destino inválido')

    // e o resultado é CONSISTENTE: quem encerrou entregou o crédito, quem
    // sobreviveu ficou com os dois
    const [ea] = await sql<{ status: string }[]>`
      select status from contracts where id = ${a.contractId}`
    const [eb] = await sql<{ status: string }[]>`
      select status from contracts where id = ${b.contractId}`
    expect([ea.status, eb.status].sort()).toEqual(['active', 'ended'])
    const encerrado = ea.status === 'ended' ? a.contractId : b.contractId
    const vivo = ea.status === 'ended' ? b.contractId : a.contractId
    expect(await saldo(encerrado), 'o encerrado zera').toBe(0)
    expect(await saldo(vivo), 'o vivo herda o crédito do outro').toBe(2)
  })

  it('a ordem está escrita no corpo vivo: as DUAS linhas, por uuid, antes do advisory', async () => {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_end_contract'`
    const src = f.src.replace(/\s+/g, ' ')

    const trava = src.indexOf('where id in (p_contract, p_dest_contract) order by id for update')
    const advisory = src.indexOf("makeup_spend:' || p_contract")
    expect(trava, 'as duas linhas são travadas juntas, ordenadas por uuid').toBeGreaterThan(-1)
    expect(advisory, 'o advisory do gasto existe').toBeGreaterThan(-1)
    expect(trava, 'linhas ANTES do advisory').toBeLessThan(advisory)

    // e nenhum lock de linha sobrou DEPOIS do advisory — era exatamente o
    // `select … from contracts where id = p_dest_contract for update` que
    // fechava o ciclo
    expect(src.slice(advisory), 'nenhum FOR UPDATE depois do advisory').not.toMatch(/for update/i)
  })
})
