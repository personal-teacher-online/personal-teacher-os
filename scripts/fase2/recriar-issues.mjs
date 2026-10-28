// Fase 2 do fluxo orquestrado (corte público, passo 7): recria no repositório
// público as issues do privado PRESERVANDO A NUMERAÇÃO (plano
// docs/plano-repositorio-publico-2026-10.md §6). O GitHub não transfere issue
// entre contas diferentes e numera issues e PRs na mesma sequência; então, de
// 1 até N, cada número vira:
//   - issue ABERTA no privado  → issue recriada (título, corpo, labels, comentários);
//   - PR, issue fechada ou gap → issue-stub criada e fechada ("número reservado").
// Assim todo `#N` em docs, goals e mensagens de commit continua apontando para
// a coisa certa (ou para o aviso de que ela mora no arquivo).
//
// Uso (dry-run é o padrão; nada é gravado sem --executar):
//   node scripts/fase2/recriar-issues.mjs --origem leoppraeiro-netizen/personal-teacher-os \
//        --destino personal-teacher-online/personal-teacher-os [--ate 51] [--executar]
//
// Pré-condições que o script confere antes de gravar: o destino não tem issue
// nem PR (qualquer uma desloca a numeração) e cada número devolvido pela API é
// o esperado — divergiu, para na hora. Pausa de 1,5 s entre criações: o GitHub
// aplica limite secundário a quem cria conteúdo em rajada. Só Node + `gh`
// (autenticado como o dono); nenhuma dependência do projeto.
//
// Retomada: se a execução morrer no meio (502 do GitHub, rede), o destino fica
// com as issues 1..K criadas. `--a-partir-de K+1` pula a exigência de destino
// vazio e exige, em vez dela, que a maior issue do destino seja exatamente K.
// `--dry-run` sempre vence `--executar`.
//
// Texto das issues também vira público: `--exportar <arquivo>` grava títulos,
// corpos e comentários de tudo que o script criaria, para o `vazamento.py` e a
// leitura humana (auditoria-final.md, item A) ANTES de `--executar`.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PAUSA_MS = 1500
const FUSO_DATA = 'America/Sao_Paulo' // só para o rótulo DD/MM/AAAA dos comentários

const args = process.argv.slice(2)
const opcao = (nome) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 ? args[i + 1] : undefined
}
const origem = opcao('origem')
const destino = opcao('destino')
const ateArg = opcao('ate')
const aPartirDeArg = opcao('a-partir-de')
const exportar = opcao('exportar')
const executar = args.includes('--executar') && !args.includes('--dry-run')

if (!origem || !destino || !/^[\w.-]+\/[\w.-]+$/.test(origem) || !/^[\w.-]+\/[\w.-]+$/.test(destino)) {
  console.error('uso: node scripts/fase2/recriar-issues.mjs --origem dono/repo --destino org/repo [--ate N] [--a-partir-de K] [--exportar arquivo.md] [--executar | --dry-run]')
  process.exit(2)
}
if (origem === destino) {
  console.error('origem e destino são o mesmo repositório; nada a fazer.')
  process.exit(2)
}

// `gh(args, { input })`: `input` vai para o stdin (corpo JSON com `--input -`).
const gh = (a, opcoes = {}) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opcoes })
const ghJson = (a, opcoes) => JSON.parse(gh(['api', ...a], opcoes))
const ghPaginado = (rota) => ghJson(['--paginate', '--slurp', rota]).flat()
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const dataBr = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO_DATA })

// 1. Inventário do privado: a rota /issues devolve issues E PRs (as PRs trazem
//    o campo `pull_request`), que é exatamente a sequência de números.
const itens = ghPaginado(`repos/${origem}/issues?state=all&per_page=100&direction=asc`)
const porNumero = new Map(itens.map((i) => [i.number, i]))
const maior = Math.max(0, ...porNumero.keys())
const ate = ateArg ? Number(ateArg) : maior
if (!Number.isInteger(ate) || ate < 1) {
  console.error(`--ate inválido: ${ateArg}`)
  process.exit(2)
}
const aPartirDe = aPartirDeArg ? Number(aPartirDeArg) : 1
if (!Number.isInteger(aPartirDe) || aPartirDe < 1 || aPartirDe > ate) {
  console.error(`--a-partir-de inválido: ${aPartirDeArg} (precisa estar entre 1 e ${ate})`)
  process.exit(2)
}

// 2. Plano número a número.
const plano = []
for (let n = aPartirDe; n <= ate; n++) {
  const item = porNumero.get(n)
  if (!item) {
    plano.push({ n, tipo: 'gap', acao: 'stub', titulo: '(número sem issue nem PR no privado)' })
  } else if (item.pull_request) {
    plano.push({ n, tipo: 'PR', acao: 'stub', titulo: item.title })
  } else if (item.state === 'open') {
    plano.push({ n, tipo: 'issue aberta', acao: 'recriar', titulo: item.title, item })
  } else {
    plano.push({ n, tipo: 'issue fechada', acao: 'stub', titulo: item.title })
  }
}
const recriar = plano.filter((p) => p.acao === 'recriar').length
const stubs = plano.length - recriar

console.log(`${executar ? 'EXECUTANDO' : 'DRY-RUN'}: ${origem} → ${destino}, números ${aPartirDe}..${ate} (${recriar} recriadas, ${stubs} stubs)`)
console.log('')
console.log('  nº  | tipo           | ação    | título')
for (const p of plano) {
  console.log(`  ${String(p.n).padStart(3)} | ${p.tipo.padEnd(14)} | ${p.acao.padEnd(7)} | ${p.titulo}`)
}
console.log('')

// 3. Pré-condição: a maior issue/PR do destino é exatamente aPartirDe-1 (zero
//    numa execução do início; K numa retomada). Qualquer outra coisa desloca a
//    numeração. A rota devolve em ordem decrescente de número por padrão.
let noDestino
try {
  noDestino = ghJson([`repos/${destino}/issues?state=all&per_page=1&sort=created&direction=desc`], { stdio: ['ignore', 'pipe', 'ignore'] })
} catch {
  console.error(`aviso: não consegui ler ${destino} (ainda não existe, ou sem acesso).`)
  if (executar) process.exit(1)
  noDestino = []
}
const maiorNoDestino = noDestino.length > 0 ? noDestino[0].number : 0
if (maiorNoDestino !== aPartirDe - 1) {
  console.error(
    aPartirDe === 1
      ? `PARE: ${destino} já tem issue ou PR (#${maiorNoDestino}); a numeração não bateria. Destino precisa nascer vazio (ou use --a-partir-de para retomar).`
      : `PARE: para retomar de #${aPartirDe} a maior issue/PR de ${destino} precisa ser #${aPartirDe - 1}; lá está #${maiorNoDestino}.`,
  )
  process.exit(executar ? 1 : 0)
}

// 3b. Exportação do texto que vai virar público (títulos, corpos, comentários),
//     para a varredura e a leitura humana antes de gravar.
if (exportar) {
  const partes = []
  for (const p of plano) {
    partes.push(`\n\n# #${p.n} [${p.tipo} → ${p.acao}] ${p.titulo}\n`)
    if (p.acao !== 'recriar') continue
    partes.push(p.item.body ?? '')
    const comentarios = ghPaginado(`repos/${origem}/issues/${p.n}/comments?per_page=100`)
    for (const c of comentarios) partes.push(`\n\n## comentário de @${c.user?.login ?? 'ghost'}, ${dataBr(c.created_at)}\n\n${c.body ?? ''}`)
  }
  writeFileSync(exportar, partes.join(''), 'utf8')
  console.log(`Texto exportado para ${exportar}: passe o vazamento.py e leia antes de --executar.`)
}

if (!executar) {
  console.log('Dry-run: nada gravado. Para gravar, repita com --executar.')
  process.exit(0)
}

// 4. Labels antes das issues (a criação de issue referencia label pelo nome).
console.log('Clonando labels…')
gh(['label', 'clone', origem, '--repo', destino, '--force'])
await dormir(PAUSA_MS)

// 5. Criação em ordem, conferindo o número devolvido a cada passo.
const corpoStub = (p) =>
  `Número reservado: usado por ${p.tipo} no repositório de origem (${origem}#${p.n}).\n\n` +
  `Título lá: ${p.titulo}\n\n` +
  `O repositório de origem é privado e está arquivado; esta issue só existe para que \`#${p.n}\` em docs, goals e mensagens de commit continue apontando para o número certo.`

const prefixoRecriada = (p) =>
  `> Recriada de ${origem}#${p.n} em ${dataBr(new Date().toISOString())} (corte público, Fase 2). Aberta lá em ${dataBr(p.item.created_at)}.\n\n`

for (const p of plano) {
  const criada =
    p.acao === 'recriar'
      ? ghJson(['-X', 'POST', `repos/${destino}/issues`, '--input', '-'], {
          input: JSON.stringify({
            title: p.titulo,
            body: prefixoRecriada(p) + (p.item.body ?? ''),
            labels: p.item.labels.map((l) => l.name),
          }),
        })
      : ghJson(['-X', 'POST', `repos/${destino}/issues`, '--input', '-'], {
          input: JSON.stringify({ title: `[reservado] #${p.n}: ${p.tipo} no repositório de origem`, body: corpoStub(p) }),
        })

  if (criada.number !== p.n) {
    console.error(`PARE: esperava #${p.n}, o GitHub devolveu #${criada.number}. A numeração desalinhou; investigue antes de continuar (nada mais será criado).`)
    process.exit(1)
  }
  await dormir(PAUSA_MS)

  if (p.acao === 'stub') {
    gh(['api', '-X', 'PATCH', `repos/${destino}/issues/${p.n}`, '-f', 'state=closed', '-f', 'state_reason=not_planned'])
    console.log(`  #${p.n} stub fechada (${p.tipo})`)
    await dormir(PAUSA_MS)
    continue
  }

  const comentarios = ghPaginado(`repos/${origem}/issues/${p.n}/comments?per_page=100`)
  for (const c of comentarios) {
    gh(['api', '-X', 'POST', `repos/${destino}/issues/${p.n}/comments`, '--input', '-'], {
      input: JSON.stringify({ body: `**@${c.user?.login ?? 'ghost'}, ${dataBr(c.created_at)}:**\n\n${c.body ?? ''}` }),
    })
    await dormir(PAUSA_MS)
  }
  console.log(`  #${p.n} recriada com ${p.item.labels.length} label(s) e ${comentarios.length} comentário(s)`)
}

console.log('')
console.log(`Pronto: ${recriar} issues recriadas, ${stubs} números reservados em ${destino}.`)
