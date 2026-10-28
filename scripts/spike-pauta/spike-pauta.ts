// SPIKE de pauta (M2.0 da frente de conteúdo) — DESCARTÁVEL.
// Valida três coisas antes de qualquer migration: (a) dá para coletar Shorts de
// criadores de referência com a YouTube Data API, (b) o prompt de análise produz
// relatório legível, (c) quanto custa por item. Saída: markdown local + as 10
// ideias do sub-gate de calibração do M2.
//
// NÃO É PRODUÇÃO: nada de banco, nada de ai_prompts, nada de src/. Quando o M5
// chegar, o que sobrevive daqui é o SCHEMA da análise (candidato ao
// content_research) e os dois prompts. Descartar = apagar esta pasta.
//
// Uso (nesta ordem):
//   node --env-file=.env.local scripts/spike-pauta/spike-pauta.ts coletar
//   node --env-file=.env.local scripts/spike-pauta/spike-pauta.ts analisar
//   node --env-file=.env.local scripts/spike-pauta/spike-pauta.ts ideias
//
// Envs: YOUTUBE_API_KEY (coletar) · GEMINI_API_KEY + ANTHROPIC_API_KEY (analisar/ideias).
//
// Política de dados de terceiros (espírito do ADR-031, que o M5 formaliza):
// vídeo/áudio bruto NUNCA é baixado nem persistido — a transcrição sai de uma
// passada do Gemini sobre a URL pública. Só derivados ficam em disco
// (transcrição, análise, métricas públicas).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

// ── Criadores do spike (escolha do dono, 30/07). IDs resolvidos pela API na
// corrida; o handle é só o que se digita. ────────────────────────────────────
const CRIADORES = [
  { handle: 'carinafragozo', nome: 'English in Brazil (Carina Fragozo)', pais: 'BR' },
  { handle: 'AskJackie', nome: 'Ask Jackie', pais: 'INT' },
  { handle: 'EnglishwithLucy', nome: 'English with Lucy', pais: 'INT' },
  { handle: 'SpeakEnglishWithVanessa', nome: 'Speak English With Vanessa', pais: 'INT' },
] as const

/** Shorts = até 90s. Acima disso é vídeo longo e não serve de referência de reel. */
const MAX_SEGUNDOS = 90
/** Quantos uploads recentes varrer por criador antes de filtrar (2 páginas). */
const UPLOADS_VARRIDOS = 100
/** Top N por views que vão para a análise. */
const TOP_POR_CRIADOR = 5

const MODELO_CLAUDE = 'claude-sonnet-5'
/** Preço introdutório vigente até 31/08/2026 (US$/milhão de tokens). */
const PRECO_CLAUDE = { entrada: 2, saida: 10 }
/** Gemini com vídeo: modelo estável mais novo da família flash (conferido no
 *  endpoint /models em 30/07). Trocável por --gemini=<modelo>. */
const MODELO_GEMINI_PADRAO = 'gemini-3.6-flash'

const RAIZ = join(import.meta.dirname, '..', '..')
const SAIDA = join(RAIZ, '_rascunhos', 'spike-pauta')
const COLETA = join(SAIDA, 'coleta.json')

// ── Tipos ────────────────────────────────────────────────────────────────────

interface VideoColetado {
  id: string
  criador: string
  pais: string
  titulo: string
  publicado_em: string
  duracao_s: number
  views: number
  likes: number
  url: string
}

interface Analise {
  gancho: { texto_falado: string; tipo: string; segundos_ate_o_ponto: number }
  beats: Array<{ ordem: number; funcao: string; resumo: string; frase_chave: string }>
  texto_na_tela: { cartelas: string[]; padrao: string }
  ingles_na_fala: { modo: string; detalhe: string }
  cta: { texto: string; posicao: string; tipo: string }
  duracao_e_ritmo: string
  por_que_performou: string[]
  copia: { pilar: number; como_copiar: string; trilha: { protegida: boolean; qual: string } }
  avisos: string[]
}

interface Custo {
  entrada: number
  saida: number
  usd: number
}

// ── Utilitários ──────────────────────────────────────────────────────────────

function exigeEnv(nome: string): string {
  const v = process.env[nome]
  if (!v) {
    console.error(`${nome} ausente — defina no .env.local antes de rodar.`)
    process.exit(1)
  }
  return v
}

function arg(prefixo: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${prefixo}=`))
  return hit?.slice(prefixo.length + 3)
}

/** ISO-8601 de duração do YouTube (PT1M30S) → segundos. */
function duracaoEmSegundos(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return Number.NaN
  const [, d, h, min, s] = m
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
}

async function pegaJson(url: string, contexto: string): Promise<Record<string, unknown>> {
  const r = await fetch(url)
  const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) {
    const erro = (corpo.error as { message?: string } | undefined)?.message ?? `HTTP ${r.status}`
    throw new Error(`${contexto}: ${erro}`)
  }
  return corpo
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── coletar ──────────────────────────────────────────────────────────────────

async function coletar(): Promise<void> {
  const chave = exigeEnv('YOUTUBE_API_KEY')
  const base = 'https://www.googleapis.com/youtube/v3'
  let quota = 0
  const tudo: VideoColetado[] = []

  for (const criador of CRIADORES) {
    process.stdout.write(`\n▸ ${criador.nome}\n`)

    const canal = await pegaJson(
      `${base}/channels?part=contentDetails,statistics&forHandle=${criador.handle}&key=${chave}`,
      `canal @${criador.handle}`,
    )
    quota += 1
    const itens = canal.items as
      | Array<{
          contentDetails: { relatedPlaylists: { uploads: string } }
          statistics: { subscriberCount?: string }
        }>
      | undefined
    if (!itens?.length) {
      throw new Error(
        `canal @${criador.handle} não resolveu — confira o handle em CRIADORES (o spike não adivinha).`,
      )
    }
    const playlist = itens[0].contentDetails.relatedPlaylists.uploads
    console.log(`  inscritos: ${itens[0].statistics.subscriberCount ?? '?'}`)

    // uploads recentes (playlistItems: 50 por página)
    const ids: string[] = []
    let pagina: string | undefined
    while (ids.length < UPLOADS_VARRIDOS) {
      const q = new URLSearchParams({
        part: 'contentDetails',
        playlistId: playlist,
        maxResults: '50',
        key: chave,
      })
      if (pagina) q.set('pageToken', pagina)
      const r = await pegaJson(`${base}/playlistItems?${q}`, `uploads de @${criador.handle}`)
      quota += 1
      const lote = (r.items as Array<{ contentDetails: { videoId: string } }>) ?? []
      ids.push(...lote.map((i) => i.contentDetails.videoId))
      pagina = r.nextPageToken as string | undefined
      if (!pagina || lote.length === 0) break
    }
    console.log(`  uploads varridos: ${ids.length}`)

    // detalhes (videos: até 50 IDs por chamada)
    const detalhes: VideoColetado[] = []
    for (let i = 0; i < ids.length; i += 50) {
      const r = await pegaJson(
        `${base}/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(',')}&key=${chave}`,
        `detalhes de @${criador.handle}`,
      )
      quota += 1
      const lote =
        (r.items as Array<{
          id: string
          snippet: { title: string; publishedAt: string }
          contentDetails: { duration: string }
          statistics: { viewCount?: string; likeCount?: string }
        }>) ?? []
      for (const v of lote) {
        const dur = duracaoEmSegundos(v.contentDetails.duration)
        if (!Number.isFinite(dur) || dur > MAX_SEGUNDOS || dur === 0) continue
        detalhes.push({
          id: v.id,
          criador: criador.nome,
          pais: criador.pais,
          titulo: v.snippet.title,
          publicado_em: v.snippet.publishedAt,
          duracao_s: dur,
          views: Number(v.statistics.viewCount ?? 0),
          likes: Number(v.statistics.likeCount ?? 0),
          url: `https://www.youtube.com/watch?v=${v.id}`,
        })
      }
    }

    const top = detalhes.sort((a, b) => b.views - a.views).slice(0, TOP_POR_CRIADOR)
    console.log(`  shorts (≤${MAX_SEGUNDOS}s): ${detalhes.length} · guardando top ${top.length}`)
    for (const v of top) {
      console.log(`   · ${v.views.toLocaleString('pt-BR')} views · ${v.duracao_s}s · ${v.titulo}`)
    }
    tudo.push(...top)
  }

  mkdirSync(SAIDA, { recursive: true })
  writeFileSync(COLETA, JSON.stringify(tudo, null, 2))
  console.log(`\n✔ ${tudo.length} vídeos em ${COLETA}`)
  console.log(`  quota YouTube gasta: ~${quota} unidades (cota diária padrão: 10.000)`)
}

// ── Claude (chamada local: espelha runStructured de src/lib/ai/claude.ts, mas
// devolve `usage` — o gate do M2.0 exige custo por item) ──────────────────────

async function claudeJson(
  system: string,
  input: string,
  schema: Record<string, unknown>,
  maxTokens = 8192,
): Promise<{ json: unknown; custo: Custo }> {
  const client = new Anthropic({ apiKey: exigeEnv('ANTHROPIC_API_KEY') })
  const msg = (await client.messages.create({
    model: MODELO_CLAUDE,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: input }],
  } as Parameters<typeof client.messages.create>[0])) as Anthropic.Message

  if (msg.stop_reason === 'refusal') throw new Error('Claude recusou o pedido (stop_reason=refusal)')
  // Família 5 devolve bloco `thinking` antes do texto — pegar o primeiro texto.
  const bloco = msg.content.find((b) => b.type === 'text')
  if (!bloco || bloco.type !== 'text') throw new Error('resposta do Claude sem bloco de texto')
  const texto = bloco.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const entrada =
    msg.usage.input_tokens +
    (msg.usage.cache_creation_input_tokens ?? 0) +
    (msg.usage.cache_read_input_tokens ?? 0)
  const custo: Custo = {
    entrada,
    saida: msg.usage.output_tokens,
    usd:
      (entrada / 1_000_000) * PRECO_CLAUDE.entrada +
      (msg.usage.output_tokens / 1_000_000) * PRECO_CLAUDE.saida,
  }

  try {
    return { json: JSON.parse(texto), custo }
  } catch {
    throw new Error(`resposta não é JSON válido (começa com "${texto.slice(0, 80)}")`)
  }
}

// ── Gemini: transcrição + descrição visual numa passada, direto da URL ────────

async function transcrever(url: string): Promise<{ texto: string; tokens: number }> {
  const chave = exigeEnv('GEMINI_API_KEY')
  const modelo = arg('gemini') ?? MODELO_GEMINI_PADRAO
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${chave}`
  const pedido = {
    contents: [
      {
        parts: [
          { file_data: { file_uri: url } },
          {
            text:
              'Transcreva este vídeo curto em PT-BR/EN conforme falado, marcando o tempo a cada ' +
              'fala (formato "[0:03] fala"). Depois, sob o título "TEXTO NA TELA", liste as ' +
              'cartelas de texto sobrepostas que aparecem, na ordem, com o tempo. Por fim, sob ' +
              '"VISUAL", descreva em 2-3 frases o enquadramento, os cortes e o cenário. ' +
              'Não interprete nem opine — só registre o que está no vídeo.',
          },
        ],
      },
    ],
  }

  let ultimoErro = ''
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const controle = AbortSignal.timeout(240_000)
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pedido),
      signal: controle,
    })
    const corpo = (await r.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { totalTokenCount?: number }
      error?: { message?: string }
    }
    if (r.ok) {
      const texto = (corpo.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim()
      if (!texto) throw new Error('Gemini devolveu resposta vazia (vídeo privado ou bloqueado?)')
      return { texto, tokens: corpo.usageMetadata?.totalTokenCount ?? 0 }
    }
    ultimoErro = corpo.error?.message ?? `HTTP ${r.status}`
    if (r.status < 500 && r.status !== 429) break
    await esperar(3000 * tentativa)
  }
  throw new Error(`Gemini (${modelo}): ${ultimoErro}`)
}

// ── analisar ─────────────────────────────────────────────────────────────────

const SCHEMA_ANALISE = {
  type: 'object',
  additionalProperties: false,
  required: [
    'gancho',
    'beats',
    'texto_na_tela',
    'ingles_na_fala',
    'cta',
    'duracao_e_ritmo',
    'por_que_performou',
    'copia',
    'avisos',
  ],
  properties: {
    gancho: {
      type: 'object',
      additionalProperties: false,
      required: ['texto_falado', 'tipo', 'segundos_ate_o_ponto'],
      properties: {
        texto_falado: { type: 'string' },
        tipo: {
          type: 'string',
          enum: ['pergunta_direta', 'afirmacao_forte', 'historia', 'demonstracao', 'outro'],
        },
        segundos_ate_o_ponto: { type: 'number' },
      },
    },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ordem', 'funcao', 'resumo', 'frase_chave'],
        properties: {
          ordem: { type: 'integer' },
          funcao: {
            type: 'string',
            enum: ['gancho', 'desenvolvimento', 'demonstracao', 'virada', 'cta'],
          },
          resumo: { type: 'string' },
          frase_chave: { type: 'string' },
        },
      },
    },
    texto_na_tela: {
      type: 'object',
      additionalProperties: false,
      required: ['cartelas', 'padrao'],
      properties: {
        cartelas: { type: 'array', items: { type: 'string' } },
        padrao: { type: 'string' },
      },
    },
    ingles_na_fala: {
      type: 'object',
      additionalProperties: false,
      required: ['modo', 'detalhe'],
      properties: {
        modo: {
          type: 'string',
          enum: ['demonstracao_traduzida', 'imersao_total', 'misto', 'so_pt'],
        },
        detalhe: { type: 'string' },
      },
    },
    cta: {
      type: 'object',
      additionalProperties: false,
      required: ['texto', 'posicao', 'tipo'],
      properties: {
        texto: { type: 'string' },
        posicao: { type: 'string', enum: ['inicio', 'meio', 'fim', 'ausente'] },
        tipo: {
          type: 'string',
          enum: ['salvar', 'comentar', 'seguir', 'link', 'compartilhar', 'outro'],
        },
      },
    },
    duracao_e_ritmo: { type: 'string' },
    por_que_performou: { type: 'array', items: { type: 'string' } },
    copia: {
      type: 'object',
      additionalProperties: false,
      required: ['pilar', 'como_copiar', 'trilha'],
      properties: {
        pilar: { type: 'integer' },
        como_copiar: { type: 'string' },
        trilha: {
          type: 'object',
          additionalProperties: false,
          required: ['protegida', 'qual'],
          properties: {
            protegida: { type: 'boolean' },
            qual: { type: 'string' },
          },
        },
      },
    },
    avisos: { type: 'array', items: { type: 'string' } },
  },
}

/** Extrai só o "## System" do arquivo de prompt (o resto é documentação da spec). */
function carregaPrompt(arquivo: string): string {
  const raw = readFileSync(join(import.meta.dirname, arquivo), 'utf8')
  const m = /^## System\n([\s\S]*)$/m.exec(raw)
  if (!m) throw new Error(`${arquivo}: seção "## System" não encontrada`)
  return m[1].trim()
}

function fatiaAnalise(v: VideoColetado, a: Analise): string {
  return [
    `## ${v.titulo}`,
    '',
    `- **Criador:** ${v.criador} (${v.pais}) · [${v.id}](${v.url})`,
    `- **Métricas públicas:** ${v.views.toLocaleString('pt-BR')} views · ${v.likes.toLocaleString('pt-BR')} likes · ${v.duracao_s}s · publicado ${v.publicado_em.slice(0, 10)}`,
    '',
    `**Gancho (${a.gancho.tipo}, ponto claro em ${a.gancho.segundos_ate_o_ponto}s):** "${a.gancho.texto_falado}"`,
    '',
    '**Estrutura:**',
    ...a.beats.map(
      (b) => `${b.ordem}. *(${b.funcao})* ${b.resumo}${b.frase_chave ? ` — "${b.frase_chave}"` : ''}`,
    ),
    '',
    `**Texto na tela:** ${a.texto_na_tela.padrao}`,
    ...(a.texto_na_tela.cartelas.length
      ? [a.texto_na_tela.cartelas.map((c) => `\`${c}\``).join(' · ')]
      : ['(nenhuma cartela registrada)']),
    '',
    `**Inglês na fala (${a.ingles_na_fala.modo}):** ${a.ingles_na_fala.detalhe}`,
    '',
    `**CTA (${a.cta.posicao}, ${a.cta.tipo}):** ${a.cta.texto || '—'}`,
    '',
    `**Duração e ritmo:** ${a.duracao_e_ritmo}`,
    '',
    '**Hipóteses de desempenho:**',
    ...a.por_que_performou.map((h) => `- ${h}`),
    '',
    `**Como copiar (pilar ${a.copia.pilar}):** ${a.copia.como_copiar}`,
    ...(a.copia.trilha.protegida
      ? ['', `⚠️ **Trilha protegida:** ${a.copia.trilha.qual} — se copiar, usar pela biblioteca do próprio app.`]
      : []),
    ...(a.avisos.length ? ['', `**Avisos do insumo:** ${a.avisos.join(' · ')}`] : []),
    '',
  ].join('\n')
}

function contagem(valores: string[]): string {
  const mapa = new Map<string, number>()
  for (const v of valores) mapa.set(v, (mapa.get(v) ?? 0) + 1)
  return [...mapa.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} (${n})`)
    .join(' · ')
}

async function analisar(): Promise<void> {
  if (!existsSync(COLETA)) {
    console.error(`${COLETA} não existe — rode o subcomando "coletar" primeiro.`)
    process.exit(1)
  }
  const videos = JSON.parse(readFileSync(COLETA, 'utf8')) as VideoColetado[]
  const system = carregaPrompt('prompt-analise.md')

  const feitos: Array<{ v: VideoColetado; a: Analise }> = []
  let usdTotal = 0
  let tokensGemini = 0

  for (const [i, v] of videos.entries()) {
    process.stdout.write(`\n[${i + 1}/${videos.length}] ${v.criador} — ${v.titulo}\n`)
    const destino = join(SAIDA, `analise-${v.id}.md`)
    const jsonDestino = join(SAIDA, `analise-${v.id}.json`)

    if (existsSync(jsonDestino)) {
      console.log('  já analisado — reaproveitando (apague o .json para refazer)')
      feitos.push({ v, a: JSON.parse(readFileSync(jsonDestino, 'utf8')) as Analise })
      continue
    }

    try {
      const transcricaoPath = join(SAIDA, `transcricao-${v.id}.md`)
      let texto: string
      if (existsSync(transcricaoPath)) {
        texto = readFileSync(transcricaoPath, 'utf8')
        console.log(`  transcrição reaproveitada do disco (${texto.length} caracteres)`)
      } else {
        const t0 = Date.now()
        const r = await transcrever(v.url)
        texto = r.texto
        tokensGemini += r.tokens
        console.log(`  transcrição: ${texto.length} caracteres · ${r.tokens} tokens Gemini · ${Math.round((Date.now() - t0) / 1000)}s`)
        writeFileSync(transcricaoPath, texto)
      }

      const entrada = [
        `CANAL: ${v.criador} (${v.pais})`,
        `TÍTULO: ${v.titulo}`,
        `PUBLICADO: ${v.publicado_em}`,
        `DURAÇÃO: ${v.duracao_s}s`,
        `MÉTRICAS PÚBLICAS: ${v.views} views, ${v.likes} likes`,
        '',
        'TRANSCRIÇÃO E DESCRIÇÃO VISUAL (gerada por máquina):',
        texto,
      ].join('\n')

      const { json, custo } = await claudeJson(system, entrada, SCHEMA_ANALISE)
      const a = json as Analise
      usdTotal += custo.usd
      console.log(
        `  análise: ${custo.entrada} in / ${custo.saida} out = US$ ${custo.usd.toFixed(4)} (Claude)`,
      )

      writeFileSync(jsonDestino, JSON.stringify(a, null, 2))
      writeFileSync(destino, fatiaAnalise(v, a))
      feitos.push({ v, a })
    } catch (e) {
      console.error(`  ✗ FALHOU: ${(e as Error).message}`)
    }
  }

  if (!feitos.length) {
    console.error('\nNenhuma análise concluída — nada a consolidar.')
    process.exit(1)
  }

  // relatório por criador
  for (const c of CRIADORES) {
    const meus = feitos.filter((f) => f.v.criador === c.nome)
    if (!meus.length) continue
    const corpo = [
      `# ${c.nome} — análises do spike (${c.pais})`,
      '',
      `${meus.length} Shorts analisados, os mais vistos dos ${UPLOADS_VARRIDOS} uploads mais recentes.`,
      '',
      `**Ganchos:** ${contagem(meus.map((m) => m.a.gancho.tipo))}`,
      `**CTA:** ${contagem(meus.map((m) => m.a.cta.tipo))} · posição: ${contagem(meus.map((m) => m.a.cta.posicao))}`,
      `**Inglês na fala:** ${contagem(meus.map((m) => m.a.ingles_na_fala.modo))}`,
      '',
      '---',
      '',
      ...meus.map((m) => fatiaAnalise(m.v, m.a)),
    ].join('\n')
    writeFileSync(join(SAIDA, `relatorio-${c.handle}.md`), corpo)
  }

  // relatório geral — agregação determinística (nenhum LLM opina aqui: os
  // padrões saem da contagem, e as hipóteses vêm citadas com a fonte)
  const medias = {
    duracao: Math.round(feitos.reduce((s, f) => s + f.v.duracao_s, 0) / feitos.length),
    ate_o_ponto:
      Math.round(
        (feitos.reduce((s, f) => s + f.a.gancho.segundos_ate_o_ponto, 0) / feitos.length) * 10,
      ) / 10,
    cartelas:
      Math.round(
        (feitos.reduce((s, f) => s + f.a.texto_na_tela.cartelas.length, 0) / feitos.length) * 10,
      ) / 10,
  }
  const geral = [
    '# Relatório geral — padrões observados (spike M2.0)',
    '',
    `Insumo: ${feitos.length} Shorts de ${new Set(feitos.map((f) => f.v.criador)).size} criadores de ensino de inglês, os mais vistos entre os uploads recentes de cada um. Análises individuais nos arquivos \`analise-*.md\`.`,
    '',
    '## Números',
    '',
    `- Duração média: **${medias.duracao}s** (faixa ${Math.min(...feitos.map((f) => f.v.duracao_s))}–${Math.max(...feitos.map((f) => f.v.duracao_s))}s)`,
    `- Tempo médio até o assunto ficar claro: **${medias.ate_o_ponto}s**`,
    `- Cartelas de texto na tela por vídeo: **${medias.cartelas}** em média`,
    `- Views: mediana ${[...feitos.map((f) => f.v.views)].sort((a, b) => a - b)[Math.floor(feitos.length / 2)].toLocaleString('pt-BR')}`,
    '',
    '## Distribuições',
    '',
    `- **Tipo de gancho:** ${contagem(feitos.map((f) => f.a.gancho.tipo))}`,
    `- **Tipo de CTA:** ${contagem(feitos.map((f) => f.a.cta.tipo))}`,
    `- **Posição do CTA:** ${contagem(feitos.map((f) => f.a.cta.posicao))}`,
    `- **Como o inglês entra:** ${contagem(feitos.map((f) => f.a.ingles_na_fala.modo))}`,
    `- **Pilar da marca que a ideia serviria (metadado):** ${contagem(feitos.map((f) => `pilar ${f.a.copia.pilar}`))}`,
    `- **Funções de batida mais usadas:** ${contagem(feitos.flatMap((f) => f.a.beats.map((b) => b.funcao)))}`,
    '',
    '## Hipóteses de desempenho (cada uma amarrada ao vídeo de origem)',
    '',
    ...feitos.flatMap((f) => f.a.por_que_performou.map((h) => `- ${h} — *${f.v.criador}, "${f.v.titulo}"*`)),
    '',
    '## Padrões de texto na tela',
    '',
    ...feitos.map((f) => `- *${f.v.criador}:* ${f.a.texto_na_tela.padrao}`),
    '',
    '## Como copiar cada um (fielmente, com a Teacher Vicky no lugar do criador)',
    '',
    ...feitos.map((f) => `- **${f.v.criador} — "${f.v.titulo}":** ${f.a.copia.como_copiar}`),
    '',
    '## Trilhas protegidas (aviso — se copiar, usar pela biblioteca do próprio app)',
    '',
    ...(feitos.some((f) => f.a.copia.trilha.protegida)
      ? feitos
          .filter((f) => f.a.copia.trilha.protegida)
          .map((f) => `- *${f.v.criador}, "${f.v.titulo}":* ${f.a.copia.trilha.qual}`)
      : ['- Nenhum dos vídeos analisados depende de trilha protegida.']),
    '',
  ].join('\n')
  writeFileSync(join(SAIDA, 'relatorio-geral.md'), geral)

  console.log(`\n✔ ${feitos.length} análises + relatórios em ${SAIDA}`)
  console.log(`  custo Claude total: US$ ${usdTotal.toFixed(4)} (US$ ${(usdTotal / feitos.length).toFixed(4)}/item)`)
  console.log(`  Gemini: ${tokensGemini} tokens no total (preço não calculado aqui — conferir no painel)`)
}

// ── ideias ───────────────────────────────────────────────────────────────────

const SCHEMA_IDEIAS = {
  type: 'object',
  additionalProperties: false,
  required: ['ideias'],
  properties: {
    ideias: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'pilar', 'gancho_falado', 'premissa', 'de_onde_veio', 'pergunta_a_vicky'],
        properties: {
          titulo: { type: 'string' },
          pilar: { type: 'integer' },
          gancho_falado: { type: 'string' },
          premissa: { type: 'string' },
          de_onde_veio: { type: 'string' },
          pergunta_a_vicky: { type: 'string' },
        },
      },
    },
  },
}

async function ideias(): Promise<void> {
  const geral = join(SAIDA, 'relatorio-geral.md')
  if (!existsSync(geral)) {
    console.error(`${geral} não existe — rode "analisar" primeiro.`)
    process.exit(1)
  }
  const voz = readFileSync(join(RAIZ, 'brand', 'voice', 'voz-v1.md'), 'utf8')
  const system = carregaPrompt('prompt-ideias.md')

  const entrada = [
    '=== RELATÓRIO GERAL DE PADRÕES ===',
    readFileSync(geral, 'utf8'),
    '',
    '=== VOZ DA MARCA v1 (CONTEXTO: quem é a marca + fatos canônicos do §7 — NÃO restringe as ideias) ===',
    voz,
    '',
    'Proponha as 10 ideias conforme o system: a pauta espelha os trends do relatório.',
  ].join('\n')

  const { json, custo } = await claudeJson(system, entrada, SCHEMA_IDEIAS, 12_000)
  const lista = (json as { ideias: Array<Record<string, string | number>> }).ideias

  const md = [
    '# 10 ideias de reel — insumo do sub-gate de calibração (M2)',
    '',
    `Geradas pelo spike M2.0 a partir de \`relatorio-geral.md\` + voz v1 como contexto (${MODELO_CLAUDE}; regras v2 — pauta espelha os trends). São PREMISSAS, não roteiros: a Teacher Vicky aprova a ideia antes de qualquer roteiro existir. Distribuição por pilar (metadado): ${contagem(lista.map((i) => `pilar ${i.pilar}`))}.`,
    '',
    ...lista.flatMap((i, n) => [
      `## ${n + 1}. ${i.titulo}  *(pilar ${i.pilar})*`,
      '',
      `**Gancho falado:** "${i.gancho_falado}"`,
      '',
      `${i.premissa}`,
      '',
      `- *De onde veio:* ${i.de_onde_veio}`,
      ...(typeof i.pergunta_a_vicky === 'string' && i.pergunta_a_vicky.trim()
        ? [`- ❓ *Pergunta à Teacher Vicky (história pessoal necessária):* ${i.pergunta_a_vicky}`]
        : []),
      '',
    ]),
  ].join('\n')

  writeFileSync(join(SAIDA, 'ideias-calibracao.md'), md)
  console.log(`✔ ${lista.length} ideias em ${join(SAIDA, 'ideias-calibracao.md')}`)
  console.log(`  custo: ${custo.entrada} in / ${custo.saida} out = US$ ${custo.usd.toFixed(4)}`)
}

// ── main ─────────────────────────────────────────────────────────────────────

const comando = process.argv[2]
mkdirSync(SAIDA, { recursive: true })

try {
  if (comando === 'coletar') await coletar()
  else if (comando === 'analisar') await analisar()
  else if (comando === 'ideias') await ideias()
  else {
    console.error('uso: spike-pauta.ts <coletar|analisar|ideias> [--gemini=<modelo>]')
    process.exit(1)
  }
} catch (e) {
  console.error(`\n✗ ${(e as Error).message}`)
  process.exit(1)
}
