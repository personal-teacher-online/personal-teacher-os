// ACEITES FINAIS DA ONDA 1 (M5) — a varredura GLOBAL, sobre a superfície
// inteira da onda.
//
// POR QUE ELA EXISTE, se cada milestone já tem os seus greps: os testes de M2,
// M3-* e M4-* varrem LISTAS CHUMBADAS de arquivos, escritas quando aquele
// milestone terminou. Arquivo novo que entra depois (um lote de correção, uma
// peça extraída para o kit) não aparece em nenhuma dessas listas e passa por
// baixo de todas elas. Aqui a lista é ENUMERADA DO DISCO: nasce coberto quem
// nascer dentro da superfície da onda.
//
// A RÉGUA É A DA SPEC, literal (`docs/goals/onda-1-admin.md` §Aceites finais):
//   · nenhuma query inline em página nova (quem lê é `src/data/`);
//   · nenhum `<details data-popup>`, `?msg=` novo ou nonce em TELA nova;
//   · nenhuma cor fora de `--ac*`/neutros/estados.
// Nada além disso — este arquivo é portão de aceite, não lugar de inventar
// regra nova no fim da onda.
//
// O QUE FICA DE FORA, e por quê: os `actions.ts`. Eles não são tela, e as
// actions VELHAS de aluno ainda terminam em `redirect('…?msg=…&n=…')` — é
// convivência declarada (o `AvisoLegado` transforma o recado em toast até a
// porta nova em `src/data/admin/actions.ts` engolir todas). Proibir `?msg=` ali
// seria reprovar a decisão que a onda tomou de propósito.
//
// Este teste é de UNIDADE (sem navegador, sem banco): roda em `npm test`, junto
// com o resto. O e2e do M5 mora em `tests/e2e/*.spec.ts`, com config própria.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = path.resolve(__dirname, '..')

/** As pastas que a Onda 1 criou ou reconstruiu por inteiro. */
const PASTAS_DA_ONDA = [
  'src/app/admin/alunos',
  'src/app/admin/contratos',
  'src/components/admin/inicio',
  'src/components/admin/alunos',
  'src/components/admin/contratos',
  'src/components/kit',
]

/** Peças soltas da onda que não moram numa pasta só dela. */
const AVULSOS = [
  'src/app/admin/page.tsx',
  'src/components/admin/AdminShell.tsx',
  'src/components/admin/AdminNavClient.tsx',
  'src/components/admin/nav.ts',
]

function varrer(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(path.join(RAIZ, dir))) {
    // Bancada Windows (01/09/2026): `path.join` devolve barra invertida e o
    // regex de PAGINAS fala em "/" — normalizar mantém o teste igual nos dois.
    const rel = path.join(dir, entrada).split(path.sep).join('/')
    if (statSync(path.join(RAIZ, rel)).isDirectory()) varrer(rel, acc)
    else if (/\.tsx?$/.test(entrada)) acc.push(rel)
  }
  return acc
}

const TODOS = [...PASTAS_DA_ONDA.flatMap((d) => varrer(d)), ...AVULSOS].sort()
/** TELA = o que desenha. `actions.ts`/`.ts` de apoio ficam de fora (ver acima). */
const TELAS = TODOS.filter((r) => r.endsWith('.tsx'))
/** As PÁGINAS da onda — as que a regra "zero query inline" endereça. */
const PAGINAS = TODOS.filter((r) => /(^|\/)page\.tsx$/.test(r))

/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  readFileSync(path.join(RAIZ, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('aceites finais da Onda 1 — varredura global', () => {
  // FALSO-VERDE É O RISCO DESTE ARQUIVO: um `readdir` apontado para o lugar
  // errado devolve lista vazia e todo `it.each` abaixo simplesmente não roda,
  // com relatório verde. Estes dois testes são a prova de que a varredura
  // enxerga a onda.
  it('a varredura enxerga a superfície da onda (nada de lista vazia)', () => {
    expect(TELAS.length).toBeGreaterThanOrEqual(40)
    expect(PAGINAS.length).toBeGreaterThanOrEqual(6)
    // as seis telas do harness estão dentro da varredura
    for (const rota of [
      'src/app/admin/page.tsx',
      'src/app/admin/alunos/page.tsx',
      'src/app/admin/alunos/contratos/page.tsx',
      'src/app/admin/alunos/convites/page.tsx',
      'src/app/admin/contratos/[id]/page.tsx',
      'src/app/admin/contratos/novo/page.tsx',
    ]) {
      expect(PAGINAS, rota).toContain(rota)
    }
  })

  it.each(PAGINAS)('%s não faz query inline — quem lê é src/data/', (rel) => {
    const p = codigo(rel)
    expect(p, `${rel}: importou o cliente Supabase`).not.toContain('@/lib/supabase')
    expect(p, `${rel}: tem .from(`).not.toMatch(/\.from\(/)
    expect(p, `${rel}: tem .rpc(`).not.toMatch(/\.rpc\(/)
  })

  it.each(TELAS)('%s não usa `<details data-popup>` (overlay é do kit)', (rel) => {
    expect(codigo(rel)).not.toContain('data-popup')
  })

  it.each(TELAS)('%s não fabrica `?msg=` nem nonce (o feedback é toast, ADR-025)', (rel) => {
    expect(codigo(rel)).not.toMatch(/[?&]msg=/)
    expect(codigo(rel)).not.toMatch(/&n=\$\{Date\.now\(\)\}/)
  })

  it.each(TELAS)('%s não usa cor fora de --ac*/neutros/estados', (rel) => {
    // A paleta da onda é o acento (`ac-*`), os neutros (`ink-*`/`paper-*`/
    // `line*`) e os tokens de estado (`situacao-*`, `nivel-*`, `danger`, `ok`).
    // O que aparece aqui é escala de Tailwind ou token de marca ANTIGO — os dois
    // marcaram o "design velho" que o dono rejeitou.
    expect(codigo(rel)).not.toMatch(
      /\b(?:brand-[3-9]00|teal-\d{3}|amber-\d{3}|sky-\d{3}|indigo-\d{3}|violet-\d{3}|emerald-\d{3}|rose-\d{3})\b/,
    )
  })
})
