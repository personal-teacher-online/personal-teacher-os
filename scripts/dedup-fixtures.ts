// GERADOR DAS FIXTURES DA DEDUP (Estúdio v2 — Leva 0.4, ADR-034).
//
// Roda UMA vez (dev-time), com a chave Gemini real:
//   node --env-file=.env.local scripts/dedup-fixtures.ts
//
// Corpus: os TEMAS REAIS do acervo arquivado em produção na Leva 0.2 (03/08),
// classificados à mão em famílias de duplicata — as mesmas que motivaram a
// dedup ("substituir o WHAT?" 3× · "pedir café sem I want" 5× · "rotina
// corrida" 6× · "role-play de imigração" 8×) — mais temas DISTINTOS para o
// caso negativo. Saída: tests/fixtures/dedup-vetores.json (vetores commitados
// — os testes provam o limiar SEM chamar API) + relatório de medição no
// terminal (mín. intra-família · máx. inter-família · o vão onde o limiar
// mora). O LIMIAR_DEDUP em src/lib/research/dedup.ts é cravado a partir do
// relatório e provado pelo teste.

import { readFileSync, writeFileSync } from 'node:fs'

import {
  ASSINATURA_EMBEDDING,
  DIMENSOES,
  cosseno,
  embedarTexto,
  textoDaIdeia,
} from '../src/lib/research/dedup.ts'

interface Caso {
  id: string
  familia: string
  tema: string
  premissa: string
}

/**
 * HOLDOUT (dívida 4 da 0.4, morta na Leva 2.2): estas famílias ficam FORA do
 * relatório de calibração — o limiar é escolhido sem vê-las — e depois são
 * verificadas contra o limiar escolhido. Separação que também vale no holdout
 * é evidência de generalização, não de ajuste ao corpus. A escolha é
 * determinística (família inteira, com par flagrante conhecido) para a
 * medição ser reprodutível.
 */
const HOLDOUT_FAMILIAS = new Set(['hotel'])

// O corpus vive em tests/fixtures/dedup-corpus.json: os 44 temas+premissas
// REAIS do acervo arquivado/parqueado em producao (snapshot 03/08, Leva 0.2)
// classificados em familias, + 2 pares EN sinteticos para a prova
// cross-language (achado nº 3 do Sol na rodada da 0.4). O texto embedado e o
// MESMO da producao: textoDaIdeia (tema + premissa) — achado nº 1 do Sol.
const CORPUS: Caso[] = (
  JSON.parse(readFileSync('tests/fixtures/dedup-corpus.json', 'utf8')) as { casos: Caso[] }
).casos

async function main(): Promise<void> {
  console.log(`Embedando ${CORPUS.length} temas reais…`)
  const vetores: Record<string, number[]> = {}
  for (const caso of CORPUS) {
    vetores[caso.id] = await embedarTexto(textoDaIdeia({ tema: caso.tema, premissa: caso.premissa }))
    process.stdout.write('.')
  }
  console.log(' ok\n')

  // Medição em DOIS conjuntos: calibração (escolhe o limiar) × holdout
  // (verifica a escolha sem ter participado dela).
  const medir = (casos: readonly Caso[], rotulo: string) => {
    let minIntra = { sim: 1, par: '' }
    let maxInter = { sim: -1, par: '' }
    const intras: number[] = []
    const inters: number[] = []
    for (let i = 0; i < casos.length; i++) {
      for (let j = i + 1; j < casos.length; j++) {
        const a = casos[i]
        const b = casos[j]
        const sim = cosseno(vetores[a.id], vetores[b.id])
        const par = `${a.id} × ${b.id}`
        if (a.familia === b.familia) {
          intras.push(sim)
          if (sim < minIntra.sim) minIntra = { sim, par }
        } else {
          inters.push(sim)
          if (sim > maxInter.sim) maxInter = { sim, par }
        }
      }
    }
    intras.sort((x, y) => x - y)
    inters.sort((x, y) => y - x)
    console.log(`\n[${rotulo}]`)
    console.log(`pares INTRA-família: ${intras.length} · mínimo ${minIntra.sim.toFixed(3)} (${minIntra.par})`)
    console.log(`  piores 5: ${intras.slice(0, 5).map((s) => s.toFixed(3)).join(' · ')}`)
    console.log(`pares INTER-família: ${inters.length} · máximo ${maxInter.sim.toFixed(3)} (${maxInter.par})`)
    console.log(`  piores 5: ${inters.slice(0, 5).map((s) => s.toFixed(3)).join(' · ')}`)
    console.log(`O VÃO: ${maxInter.sim.toFixed(3)} (teto inter) … ${minIntra.sim.toFixed(3)} (piso intra)`)
  }

  const calibracao = CORPUS.filter((c) => !HOLDOUT_FAMILIAS.has(c.familia))
  medir(calibracao, `CALIBRAÇÃO (${calibracao.length} casos — o limiar sai DAQUI)`)
  // Holdout: os pares da(s) família(s) retida(s) entre si E contra o resto —
  // exatamente os pares que o limiar nunca viu.
  medir(CORPUS, `CORPUS INTEIRO (${CORPUS.length} casos — holdout ${[...HOLDOUT_FAMILIAS].join(', ')} incluído; compare com a calibração)`)

  const destino = 'tests/fixtures/dedup-vetores.json'
  writeFileSync(
    destino,
    JSON.stringify(
      {
        gerado_em: new Date().toISOString(),
        modelo: ASSINATURA_EMBEDDING,
        dimensoes: DIMENSOES,
        holdout_familias: [...HOLDOUT_FAMILIAS],
        casos: CORPUS,
        vetores,
      },
      null,
      1,
    ),
  )
  console.log(`\nfixtures gravadas em ${destino}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
