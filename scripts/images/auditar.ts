/**
 * AUDITAR A CONFERÊNCIA — roda a régua em imagens que JÁ estão no disco, sem
 * gerar nada.
 *
 * É como se descobre se a conferência está calibrada, e o material de prova já
 * existe: as 87 fotos que o dono aprovou em `brand/slides/library/` (ela não
 * pode reprovar essas) e as candidatas descartadas que sobraram em `out/` (ela
 * precisa reprovar as que têm defeito grave). Falso positivo custa uma geração
 * à toa; falso negativo põe marca registrada no slide da aluna.
 *
 * Este arquivo existe separado do `conferencia.ts` por um motivo técnico, não de
 * gosto: o `comum.ts` (que tem as medidas da facecam e do card) importa o
 * `conferencia.ts`, e um `await import('./comum.ts')` de dentro dele fecharia um
 * ciclo com `await` no topo — o processo trava sem dizer nada. Aqui não há ciclo.
 *
 * Uso:
 *   node scripts/images/auditar.ts quadro out/cenas/m2/m2-arrival-hall/*.jpg
 *   node scripts/images/auditar.ts capa   out/cenas/m2/m2-arrival-hall/1.jpg
 *   node scripts/images/auditar.ts card   out/vocab/m2/vocab-customs/*.jpg
 *   node scripts/images/auditar.ts card   brand/slides/library/vocab/*.jpg
 */
import fs from 'node:fs'
import path from 'node:path'
import { FAIXA_DO_CARD_PCT, ZONA_FACECAM_PCT, carregaChaveDoArquivo } from './comum.ts'
import { MODELO, confere, resumo, type Regra } from './conferencia.ts'

const raiz = path.resolve(import.meta.dirname, '../..')

const REGRAS: Record<string, Regra> = {
  quadro: { tipo: 'quadro' },
  capa: { tipo: 'capa', zonaPct: ZONA_FACECAM_PCT },
  card: { tipo: 'card', faixaPct: FAIXA_DO_CARD_PCT },
}

/** o mimeType sai da extensão do arquivo — o mesmo princípio do `gemini.ts` */
function mime(arquivo: string): string {
  const ext = path.extname(arquivo).slice(1).toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
}

async function main(): Promise<void> {
  const [tipo, ...arquivos] = process.argv.slice(2)
  const regra = tipo ? REGRAS[tipo] : undefined
  if (!regra || !arquivos.length) {
    console.error('Uso: node scripts/images/auditar.ts <capa|card|quadro> <arquivo.jpg…>')
    process.exit(2)
  }

  carregaChaveDoArquivo(raiz)
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('Sem GEMINI_API_KEY (nem no ambiente, nem no .env.local).')
    process.exit(2)
  }

  console.log(`${arquivos.length} imagem(ns), régua "${tipo}", modelo ${MODELO}\n`)
  let passaram = 0
  let erros = 0
  for (const f of arquivos) {
    const imagem = { data: new Uint8Array(fs.readFileSync(f)), mimeType: mime(f) }
    const v = await confere({ apiKey, imagem, regra })
    if ('erro' in v) {
      erros++
      console.log(`  ⚠ ${f}\n      ERRO — ${v.erro}`)
      continue
    }
    if (v.aprovada) passaram++
    console.log(`  ${v.aprovada ? '✓ passa  ' : '✗ reprova'} ${f}\n      ${resumo(v)}`)
  }
  console.log(`\n${passaram} de ${arquivos.length} passaram${erros ? `, ${erros} sem resposta` : ''}.`)
}

await main()
