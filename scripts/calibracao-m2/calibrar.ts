// SUB-GATE DE CALIBRAÇÃO DO M2 — DESCARTÁVEL (mesma natureza do spike de pauta).
// v2 — RODADA 2 (31/07): o roteiro duplo foi MORTO pelo dono após a rodada 1
// (registro: docs/goals/calibracao-m2-roteiros-rodada1.md). A entrega é UM
// roteiro no registro trend. Recalibração reduzida do protocolo: 5 premissas
// SORTEADAS (1, 2, 6, 8, 9 — a 3 excluída por reprovação do dono no nível da
// premissa) × os dois braços em disputa:
//
//   (a) JSON via Structured Output → serializado por este script
//   (c) texto direto no formato de blocos (structured: false)
//
// Uso: node --env-file=.env.local scripts/calibracao-m2/calibrar.ts
// Envs: ANTHROPIC_API_KEY.
//
// CUIDADOS DE CEGAMENTO (mantidos da rodada 1):
//  1. PARIDADE ESTRUTURAL — os dois braços renderizados no MESMO formato final.
//  2. NÃO-ADJACÊNCIA — os dois braços da mesma premissa nunca consecutivos.
//  3. GABARITO ISOLADO — subpasta própria, fora do caminho do caderno.
// LIÇÕES DA RODADA 1 (código): erro fatal aborta na hora · cache por entrega ·
// caderno incompleto NUNCA é escrito · truncamento é erro nomeado.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const SAIDA = join(RAIZ, '_rascunhos', 'calibracao-m2')
const SAIDA_GABARITO = join(SAIDA, 'gabarito')
const RELATORIO = join(RAIZ, '_rascunhos', 'spike-pauta', 'relatorio-geral.md')

/** Pinado no MESMO modelo da produção — calibrar em outro não transferiria. */
const MODELO = 'claude-sonnet-5'
const USD_ENTRADA_MTOK = 3
const USD_SAIDA_MTOK = 15
const MAX_TOKENS = 16_000
/** Cache da RODADA 2 (o da rodada 1 era bi-versão — incompatível de propósito). */
const CACHE = join(SAIDA, 'cache-rodada2')

/** Sorteio da rodada 2 (31/07, `sort -R`): 5 entre as 8 premissas vivas. */
const SORTEADAS = [1, 2, 6, 8, 9]

// ── As premissas aprovadas no gate do M2.0 ──────────────────────────────────
// Fonte: docs/goals/calibracao-m2-ideias-rodada1.md. A ideia 1 na v2 (a Teacher Vicky
// NÃO canta); a 10 descartada lá; a 3 reprovada pelo dono na rodada 1 DESTA
// calibração ("não se aplica ao público-alvo").
interface Premissa {
  n: number
  titulo: string
  gancho: string
  premissa: string
  deOndeVeio: string
}

const PREMISSAS: Premissa[] = [
  {
    n: 1,
    titulo: 'A palavra que você cantou a Copa inteira sem saber o que era',
    gancho: 'Você cantou essa música o ano inteiro sem saber o que essa palavra significa.',
    premissa:
      'ATENÇÃO — execução v2 aprovada pelo dono: a Teacher Vicky NÃO canta em momento nenhum. Abre com imagem de arquivo da Copa (gol, arquibancada, festa) com a música por cima, cortando no ponto exato da palavra, e a cartela congela nela com um "???". A Teacher Vicky entra apenas para REAGIR e explicar: origem da palavra, sentido real, tradução da linha em cartela bilíngue com bandeira. O clipe volta uma segunda vez, agora já legendado, para o público reouvir entendendo. Fecha ligando a expressão a uma situação real de viagem e convidando a seguir para "inglês com música".',
    deOndeVeio:
      "cópia do formato 'O que significa DAI DAI na música da Shakira?' da English in Brazil, ancorado em trend de evento global",
  },
  {
    n: 2,
    titulo: 'O sotaque desse jogador é britânico?',
    gancho: 'Repara no sotaque desse jogador falando inglês na entrevista.',
    premissa:
      'Teacher Vicky usa um clipe real de um jogador de futebol badalado do momento falando inglês, comenta se o sotaque é britânico, americano ou outro, e traduz os trechos-chave em legenda bilíngue linha a linha. Fecha com o VEREDITO dela sobre o sotaque (feedback da rodada 1: a professora dá a palavra final, não deixa aberto para os comentários).',
    deOndeVeio:
      "cópia do formato 'O inglês do Haaland é britânico?' da English in Brazil, celebridade esportiva em alta",
  },
  {
    n: 6,
    titulo: '4 frases pra não passar vergonha no restaurante',
    gancho: 'Essas 4 frases vão salvar sua próxima viagem aos Estados Unidos.',
    premissa:
      'Lista numerada de 4 situações de restaurante ("primeira, segunda, terceira, quarta"), cada bloco no padrão 🇧🇷 frase em português → ❌ erro comum → ✅ frase certa em inglês repetida duas vezes. Fecha com CTA de link na bio para a aula experimental.',
    deOndeVeio: "cópia fiel do formato '04 frases pra usar nos restaurantes nos EUA' da Ask Jackie",
  },
  {
    n: 8,
    titulo: "'Pedir um conselho' não existe assim em inglês",
    gancho: "Você já disse 'Can I give you an advice'? Isso está errado.",
    premissa:
      "Mostra o erro clássico de tradução literal do português (advice é incontável em inglês), com cartela ❌ da frase errada seguida de ✅ 'a piece of advice' / 'some advice', com 2 exemplos falados e traduzidos. Feedback da rodada 1, obrigatório aqui: a correção sai como FRASE PRONTA de usar; proibido explicar via meta-gramática confusa tipo 'um advice, dois advices'.",
    deOndeVeio: "cópia do formato 'Como se fala conselho(s) em inglês?' da Ask Jackie",
  },
  {
    n: 9,
    titulo: '6 expressões pra parar de traduzir ao pé da letra',
    gancho: 'Essas 6 expressões vão destravar sua fala hoje mesmo.',
    premissa:
      'Estrutura repetitiva em 6 blocos: balão numerado + significado em português + frase de exemplo em inglês, com jump cuts secos entre cada item. Reel único e fechado (decisão do dono: sem "Parte N"). Feedback da rodada 1: fechamento com veredito/autoridade + CTA de salvar ou seguir — "comenta aí" não é o registro da casa. Cuidado de exatidão: se uma expressão também tem sentido literal em outro contexto (ex.: break a leg), diga "nesse contexto significa…", nunca "não significa".',
    deOndeVeio:
      "cópia do formato de lista fechada 'Start using these 6 common idioms!' da English with Lucy, 671k views",
  },
]

// ── Contrato do braço (a) ────────────────────────────────────────────────────

const SCHEMA_ROTEIRO = {
  type: 'object',
  additionalProperties: false,
  required: [
    'gancho',
    'cenas',
    'cta',
    'legenda',
    'hashtags',
    'duracao_alvo_s',
    'trilha',
    'nota_de_producao',
  ],
  properties: {
    gancho: {
      type: 'object',
      additionalProperties: false,
      required: ['principal', 'variantes'],
      properties: {
        principal: { type: 'string' },
        variantes: { type: 'array', items: { type: 'string' } },
      },
    },
    cenas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fala', 'texto_na_tela', 'acao'],
        properties: {
          fala: { type: 'string' },
          texto_na_tela: { type: 'string' },
          acao: { type: 'string' },
        },
      },
    },
    cta: {
      type: 'object',
      additionalProperties: false,
      required: ['fala', 'texto_na_tela'],
      properties: { fala: { type: 'string' }, texto_na_tela: { type: 'string' } },
    },
    legenda: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    duracao_alvo_s: { type: 'integer' },
    trilha: { type: 'string' },
    nota_de_producao: { type: 'string' },
  },
}

interface Roteiro {
  gancho: { principal: string; variantes: string[] }
  cenas: Array<{ fala: string; texto_na_tela: string; acao: string }>
  cta: { fala: string; texto_na_tela: string }
  legenda: string
  hashtags: string[]
  duracao_alvo_s: number
  trilha: string
  nota_de_producao: string
}

/** Serializa o JSON do braço (a) no MESMO formato que o braço (c) escreve à mão
 *  (paridade estrutural: a forma não pode denunciar o braço). */
function renderRoteiro(v: Roteiro): string {
  return [
    `GANCHO: ${v.gancho.principal}`,
    'VARIANTES DE GANCHO:',
    ...v.gancho.variantes.map((t, i) => `${i + 1}. ${t}`),
    '',
    ...v.cenas.flatMap((c, i) => [
      `CENA ${i + 1}`,
      `Fala: ${c.fala}`,
      `Texto na tela: ${c.texto_na_tela}`,
      `Ação: ${c.acao}`,
      '',
    ]),
    'CTA',
    `Fala: ${v.cta.fala}`,
    `Texto na tela: ${v.cta.texto_na_tela}`,
    '',
    'LEGENDA',
    v.legenda,
    '',
    `HASHTAGS: ${v.hashtags.join(' ')}`,
    `DURAÇÃO-ALVO: ${v.duracao_alvo_s}s`,
    `TRILHA: ${v.trilha?.trim() || '—'}`,
    `NOTA DE PRODUÇÃO: ${v.nota_de_producao?.trim() || '—'}`,
  ].join('\n')
}

// ── Chamada ao Claude ────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
let usdTotal = 0

function contabiliza(u: { input_tokens: number; output_tokens: number }): void {
  usdTotal += (u.input_tokens / 1e6) * USD_ENTRADA_MTOK + (u.output_tokens / 1e6) * USD_SAIDA_MTOK
}

function primeiroTexto(blocos: Array<{ type: string; text?: string }>): string {
  // Família 5 emite `thinking` antes do texto — pegar o primeiro bloco de texto.
  const bloco = blocos.find((b) => b.type === 'text')
  if (!bloco?.text) throw new Error('resposta sem bloco de texto')
  return bloco.text.trim()
}

/** Erro que ABORTA a corrida em vez de virar entrega inválida: sem crédito ou
 *  sem credencial, insistir só queima as chamadas seguintes (lição da rodada 1). */
class Fatal extends Error {}

function ehFatal(err: unknown): boolean {
  const m = String((err as Error)?.message ?? '')
  return /credit balance|authentication|invalid x-api-key|permission/i.test(m)
}

async function gera(system: string, entrada: string, braco: 'a' | 'c'): Promise<string> {
  const req = {
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: entrada }],
    ...(braco === 'a'
      ? { output_config: { format: { type: 'json_schema' as const, schema: SCHEMA_ROTEIRO } } }
      : {}),
  }
  // O SDK ainda não tipa output_config; o contrato é o da API.
  let res
  try {
    res = await (anthropic.messages.create as (r: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string
    }>)(req)
  } catch (err) {
    if (ehFatal(err)) throw new Fatal((err as Error).message)
    throw err
  }
  contabiliza(res.usage)
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`resposta truncada em ${MAX_TOKENS} tokens (aumente MAX_TOKENS)`)
  }
  const texto = primeiroTexto(res.content)
  if (braco === 'c') return texto.replace(/^```[a-z]*\n?|```$/g, '').trim()
  const limpo = texto.replace(/^```(?:json)?\n?|```$/g, '').trim()
  return renderRoteiro(JSON.parse(limpo))
}

// ── Embaralhamento cego ──────────────────────────────────────────────────────

interface Entrega {
  premissa: number
  braco: 'a' | 'c'
  roteiro: string
}

/** Embaralha com a restrição de NÃO-ADJACÊNCIA: os dois braços da mesma premissa
 *  nunca saem em entradas consecutivas (a segunda nota ancoraria na primeira). */
function embaralhaSemVizinhos(itens: Entrega[]): Entrega[] {
  for (let tentativa = 0; tentativa < 500; tentativa++) {
    const ordem = itens.slice()
    for (let i = ordem.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ordem[i], ordem[j]] = [ordem[j], ordem[i]]
    }
    const colado = ordem.some((e, i) => i > 0 && ordem[i - 1].premissa === e.premissa)
    if (!colado) return ordem
  }
  throw new Error('não consegui embaralhar sem vizinhos da mesma premissa')
}

// ── Corrida ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY ausente — rode com node --env-file=.env.local')
    process.exit(1)
  }
  if (!existsSync(RELATORIO)) {
    console.error(`${RELATORIO} não existe — o spike M2.0 precisa ter rodado.`)
    process.exit(1)
  }
  mkdirSync(SAIDA, { recursive: true })
  mkdirSync(SAIDA_GABARITO, { recursive: true })
  mkdirSync(CACHE, { recursive: true })

  const relatorio = readFileSync(RELATORIO, 'utf8')
  const voz = readFileSync(join(RAIZ, 'brand', 'voice', 'voz-v1.md'), 'utf8')
  const systemA = readFileSync(join(AQUI, 'prompt-braco-a.md'), 'utf8')
  const systemC = readFileSync(join(AQUI, 'prompt-braco-c.md'), 'utf8')

  const rodada = PREMISSAS.filter((p) => SORTEADAS.includes(p.n))
  const entregas: Entrega[] = []
  for (const p of rodada) {
    const entrada = [
      '=== PREMISSA APROVADA (roteirize ESTA) ===',
      `Título: ${p.titulo}`,
      `Gancho falado da premissa: "${p.gancho}"`,
      `O que acontece no reel: ${p.premissa}`,
      `De onde veio (vídeo de referência a ser copiado): ${p.deOndeVeio}`,
      '',
      '=== RELATÓRIO DE PADRÕES DOS CRIADORES DE REFERÊNCIA ===',
      relatorio,
      '',
      '=== VOZ DA MARCA v1 (CONTEXTO: identidade + fatos canônicos do §7 — NÃO é régua de reescrita) ===',
      voz,
    ].join('\n')

    for (const braco of ['a', 'c'] as const) {
      const emCache = join(CACHE, `${p.n}-${braco}.txt`)
      if (existsSync(emCache)) {
        entregas.push({ premissa: p.n, braco, roteiro: readFileSync(emCache, 'utf8') })
        console.log(`  premissa ${p.n} · braço ${braco} … cache`)
        continue
      }
      process.stdout.write(`  premissa ${p.n} · braço ${braco} … `)
      try {
        const roteiro = await gera(braco === 'a' ? systemA : systemC, entrada, braco)
        writeFileSync(emCache, roteiro)
        entregas.push({ premissa: p.n, braco, roteiro })
        console.log('ok')
      } catch (err) {
        if (err instanceof Fatal) {
          console.log('FATAL')
          console.error(`\n✖ corrida abortada: ${err.message}`)
          console.error(`  ${entregas.length}/${rodada.length * 2} em cache — resolva e rode de novo.`)
          console.error(`  gasto até aqui: US$ ${usdTotal.toFixed(4)}`)
          process.exit(1)
        }
        // Falha de formato é DADO — mas não vira entrega de mentira no caderno.
        console.log(`FALHOU: ${(err as Error).message}`)
      }
    }
  }

  if (entregas.length !== rodada.length * 2) {
    const faltam = rodada.flatMap((p) =>
      (['a', 'c'] as const)
        .filter((b) => !entregas.some((e) => e.premissa === p.n && e.braco === b))
        .map((b) => `${p.n}-${b}`),
    )
    console.error(`\n✖ caderno NÃO escrito: faltam ${faltam.length} entregas (${faltam.join(', ')}).`)
    console.error('  Caderno incompleto invalida a comparação pareada — rode de novo (o cache poupa o resto).')
    console.error(`  gasto nesta corrida: US$ ${usdTotal.toFixed(4)}`)
    process.exit(1)
  }

  const ordem = embaralhaSemVizinhos(entregas)
  const tituloDe = (n: number): string => PREMISSAS.find((p) => p.n === n)!.titulo

  const caderno = [
    '# Caderno cego — calibração do M2 · RODADA 2 (roteiro único)',
    '',
    `${ordem.length} entregas, embaralhadas e SEM rótulo de origem. Cada premissa aparece DUAS vezes, escrita por dois motores diferentes — não dá para saber qual é qual, e é essa a ideia. Desta vez cada entrega é UM roteiro só, no registro trend (o roteiro duplo morreu na rodada 1).`,
    '',
    '## Como pontuar',
    '',
    'Uma nota por entrega: **"com este roteiro na mão, quão perto estou de postar?"**',
    '',
    '| Nota | Significa |',
    '|---|---|',
    '| 5 | Postaria como está |',
    '| 4 | Ajustes leves |',
    '| 3 | Reescrita parcial |',
    '| 2 | Reescrita pesada |',
    '| 1 | Inutilizável |',
    '',
    'E marque as caixas que se aplicarem. **Qualquer caixa marcada desclassifica a entrega**, independente da nota:',
    '',
    '- `[ ] inventou fato/cena da vida da Teacher Vicky` (o certo é aparecer `[SUA HISTÓRIA AQUI]`)',
    '- `[ ] usou dado ou história de aluno`',
    '- `[ ] roteiro incompleto (faltam blocos: gancho, cenas, CTA ou legenda)`',
    '- `[ ] formato quebrado (não dá para ler como roteiro)`',
    '- `[ ] usa música de terceiro sem o aviso da biblioteca`',
    '',
    '---',
    '',
    ...ordem.flatMap((e, i) => [
      `## Entrega ${String(i + 1).padStart(2, '0')} — ${tituloDe(e.premissa)}`,
      '',
      '**Nota (1–5):** ______   ',
      '**Desclassificam:** `[ ] fato inventado` `[ ] dado de aluno` `[ ] incompleto` `[ ] formato quebrado` `[ ] trilha sem aviso`',
      '',
      '**Comentário livre:**',
      '',
      '```',
      e.roteiro,
      '```',
      '',
      '---',
      '',
    ]),
  ].join('\n')

  const gabarito = [
    '# Gabarito — calibração do M2 · RODADA 2 (NÃO ABRIR ANTES DO JULGAMENTO)',
    '',
    '| Entrega | Premissa | Braço |',
    '|---|---|---|',
    ...ordem.map(
      (e, i) =>
        `| ${String(i + 1).padStart(2, '0')} | ${e.premissa}. ${tituloDe(e.premissa)} | ${
          e.braco === 'a' ? '(a) JSON estruturado' : '(c) texto direto'
        } |`,
    ),
    '',
    `Custo real da corrida: US$ ${usdTotal.toFixed(4)}.`,
    '',
    '## Regra de vitória (fechada ANTES de ver as notas; herdada do protocolo)',
    '',
    '1. Braço ELEGÍVEL = maioria das suas 5 entregas com nota ≥4 (desclassificada conta como abaixo de 4 e sai da média).',
    '2. Vencedor = entre os elegíveis, o de maior média.',
    '3. Empate prático (diferença de média < 0,5): decide o custo real; persistindo, decide o dono.',
    '4. Nenhum braço elegível → SEGUNDA reprovação: o milestone PARA e volta ao dono.',
  ].join('\n')

  writeFileSync(join(SAIDA, 'caderno-cego-r2.md'), caderno)
  writeFileSync(join(SAIDA_GABARITO, 'gabarito-r2.md'), gabarito)

  console.log(`\n✔ caderno cego: ${join(SAIDA, 'caderno-cego-r2.md')} (${ordem.length} entregas)`)
  console.log(`✔ gabarito (separado): ${join(SAIDA_GABARITO, 'gabarito-r2.md')}`)
  console.log(`  custo total: US$ ${usdTotal.toFixed(4)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
