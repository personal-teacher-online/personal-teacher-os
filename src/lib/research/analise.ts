// PESQUISA DE PAUTA — transcrever e analisar um reel de terceiro (M5).
//
// O caminho: vídeo público → transcrição com descrição visual (Gemini numa
// passada; whisper como rede) → prompt ATIVO `content-reel-analysis` → JSON
// validado → `payload` do registro.
//
// ── O QUE FICA EM DISCO (ADR-031, adendo de 01/08) ──────────────────────────
// Decisão do dono: NADA é apagado e o pipeline não impõe limitação. A mídia
// baixada de Instagram/TikTok fica em `_rascunhos/research-midia/<rede>/`, para
// sempre. O YouTube nem precisa de download — o Gemini lê a URL pública
// (validado no spike M2.0, ~7k tokens por Short).
//
// ── PROVENIÊNCIA (achado das revisões do plano) ─────────────────────────────
// Toda análise carimba COMO nasceu em `payload.meta`: versão do prompt, modelo,
// por onde saiu a transcrição, tokens e custo. Sem isso, duas análises
// diferentes do mesmo vídeo seriam um mistério — e o histórico é imutável.

import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { z } from 'zod'

import { getActivePrompt, runStructured } from '../ai/claude.ts'
import { MODELO_GEMINI, PASTA_MIDIA, PRECO_CLAUDE } from './config.ts'
import type { ItemDaPesquisa } from './tipos.ts'

export const NOME_DO_PROMPT = 'content-reel-analysis'

/* ========================================================================== */
/* O contrato da análise                                                       */
/* ========================================================================== */

export const SCHEMA_ANALISE = {
  type: 'object',
  additionalProperties: false,
  required: [
    'gancho', 'beats', 'texto_na_tela', 'ingles_na_fala', 'cta',
    'duracao_e_ritmo', 'por_que_performou', 'copia', 'avisos',
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
          properties: { protegida: { type: 'boolean' }, qual: { type: 'string' } },
        },
      },
    },
    avisos: { type: 'array', items: { type: 'string' } },
  },
} as const

/** A validação de verdade é do CHAMADOR (regra da casa em `claude.ts`). */
export const AnaliseSchema = z.object({
  gancho: z.object({
    texto_falado: z.string(),
    tipo: z.string(),
    segundos_ate_o_ponto: z.number(),
  }),
  beats: z.array(
    z.object({
      ordem: z.number(),
      funcao: z.string(),
      resumo: z.string(),
      frase_chave: z.string().optional().default(''),
    }),
  ),
  texto_na_tela: z.object({ cartelas: z.array(z.string()), padrao: z.string() }),
  ingles_na_fala: z.object({ modo: z.string(), detalhe: z.string() }),
  cta: z.object({ texto: z.string(), posicao: z.string(), tipo: z.string() }),
  duracao_e_ritmo: z.string(),
  por_que_performou: z.array(z.string()),
  copia: z.object({
    pilar: z.number(),
    como_copiar: z.string(),
    trilha: z.object({ protegida: z.boolean(), qual: z.string() }),
  }),
  avisos: z.array(z.string()),
})
export type Analise = z.infer<typeof AnaliseSchema>

/* ========================================================================== */
/* Transcrição                                                                 */
/* ========================================================================== */

export type ViaDaTranscricao = 'gemini-url' | 'gemini-arquivo' | 'whisper'

export interface Transcricao {
  texto: string
  via: ViaDaTranscricao
  tokensGemini: number
}

const PEDIDO_AO_GEMINI =
  'Transcreva este vídeo curto em PT-BR/EN conforme falado, marcando o tempo a cada ' +
  'fala (formato "[0:03] fala"). Depois, sob o título "TEXTO NA TELA", liste as ' +
  'cartelas de texto sobrepostas que aparecem, na ordem, com o tempo. Por fim, sob ' +
  '"VISUAL", descreva em 2-3 frases o enquadramento, os cortes e o cenário. ' +
  'Não interprete nem opine — só registre o que está no vídeo.'

function chaveGemini(): string {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new Error('GEMINI_API_KEY ausente')
  return k
}

async function gerarComGemini(
  parteDoArquivo: Record<string, unknown>,
): Promise<{ texto: string; tokens: number }> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}` +
    `:generateContent?key=${chaveGemini()}`
  const pedido = {
    contents: [{ parts: [parteDoArquivo, { text: PEDIDO_AO_GEMINI }] }],
  }

  let ultimoErro = ''
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(240_000),
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
    await new Promise((res) => setTimeout(res, 3000 * tentativa))
  }
  throw new Error(`Gemini (${MODELO_GEMINI}): ${ultimoErro}`)
}

/** Baixa a mídia e GUARDA (nada se apaga). Devolve o caminho no disco. */
export async function baixarMidia(item: ItemDaPesquisa): Promise<string> {
  if (!item.midiaUrl) throw new Error(`${item.rede}:${item.id} sem URL de mídia`)
  const dir = join(process.cwd(), PASTA_MIDIA, item.rede)
  mkdirSync(dir, { recursive: true })
  const destino = join(dir, `${item.id}.mp4`)
  if (existsSync(destino) && statSync(destino).size > 0) return destino

  // MEDIDO (01/08): o TikTok não expõe endereço de vídeo próprio — o ator baixa
  // e guarda no key-value store DELE, que é privado e responde 403 a quem chega
  // sem credencial. O endereço volta cru no dataset; o token entra aqui.
  const endereco = item.midiaUrl.startsWith('https://api.apify.com/')
    ? `${item.midiaUrl}${item.midiaUrl.includes('?') ? '&' : '?'}token=${process.env.APIFY_TOKEN ?? ''}`
    : item.midiaUrl

  const r = await fetch(endereco, { signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`download da mídia falhou: HTTP ${r.status}`)
  writeFileSync(destino, Buffer.from(await r.arrayBuffer()))
  return destino
}

/** Sobe o arquivo ao Gemini Files e espera ficar ATIVO. */
async function subirAoGemini(caminho: string): Promise<string> {
  const chave = chaveGemini()
  const bytes = statSync(caminho).size
  const inicio = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${chave}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes),
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: caminho.split('/').pop() } }),
    },
  )
  const enderecoDeUpload = inicio.headers.get('x-goog-upload-url')
  if (!inicio.ok || !enderecoDeUpload) {
    throw new Error(`Gemini Files (start): HTTP ${inicio.status}`)
  }

  const envio = await fetch(enderecoDeUpload, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'content-length': String(bytes),
    },
    body: await (await import('node:fs/promises')).readFile(caminho),
    signal: AbortSignal.timeout(300_000),
  })
  const corpo = (await envio.json().catch(() => ({}))) as {
    file?: { uri?: string; name?: string; state?: string }
  }
  if (!envio.ok || !corpo.file?.uri || !corpo.file?.name) {
    throw new Error(`Gemini Files (upload): HTTP ${envio.status}`)
  }

  // O arquivo entra em PROCESSING; usar antes de ATIVO devolve 400.
  let estado = corpo.file.state ?? 'PROCESSING'
  for (let i = 0; i < 30 && estado !== 'ACTIVE'; i++) {
    await new Promise((res) => setTimeout(res, 3000))
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${corpo.file.name}?key=${chave}`,
    )
    const atual = (await r.json().catch(() => ({}))) as { state?: string }
    estado = atual.state ?? estado
    if (estado === 'FAILED') throw new Error('Gemini Files: processamento do vídeo falhou')
  }
  if (estado !== 'ACTIVE') throw new Error('Gemini Files: vídeo não ficou pronto a tempo')
  return corpo.file.uri
}

/** A rede de segurança: áudio por ffmpeg + whisper-1 (molde do audit-pipeline). */
async function transcreverComWhisper(caminho: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente (fallback whisper)')
  const audio = `${caminho}.m4a`
  if (!existsSync(audio)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', caminho, '-vn', '-ac', '1', '-b:a', '48k', audio], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  }
  const openai = new OpenAI()
  const res = await openai.audio.transcriptions.create({
    file: createReadStream(audio),
    model: 'whisper-1',
    response_format: 'verbose_json',
    prompt: 'Vídeo curto de ensino de inglês, alternando inglês e português.',
  })
  const texto = ((res as { text?: string }).text ?? '').trim()
  if (!texto) throw new Error('whisper devolveu transcrição vazia')
  // Honestidade com quem lê a análise depois: sem imagem, não há cartela.
  return `${texto}\n\nTEXTO NA TELA\n(não disponível: transcrição só de áudio)\n\nVISUAL\n(não disponível: transcrição só de áudio)`
}

/**
 * A transcrição de um item, pelo caminho mais barato que funcionar.
 *
 * YouTube: o Gemini lê a URL pública, sem download. Instagram/TikTok: baixa
 * (e guarda) o arquivo, sobe ao Gemini; se o Gemini recusar, cai para
 * ffmpeg+whisper, que enxerga só o áudio — por isso a `via` fica carimbada na
 * proveniência: análise sem visual não é a mesma análise.
 */
export async function transcrever(item: ItemDaPesquisa): Promise<Transcricao> {
  if (item.rede === 'youtube') {
    const r = await gerarComGemini({ file_data: { file_uri: item.url } })
    return { texto: r.texto, via: 'gemini-url', tokensGemini: r.tokens }
  }

  const caminho = await baixarMidia(item)
  try {
    const uri = await subirAoGemini(caminho)
    const r = await gerarComGemini({ file_data: { file_uri: uri, mime_type: 'video/mp4' } })
    return { texto: r.texto, via: 'gemini-arquivo', tokensGemini: r.tokens }
  } catch (e) {
    console.warn(`  Gemini falhou (${(e as Error).message}) — caindo para whisper (só áudio)`)
    return { texto: await transcreverComWhisper(caminho), via: 'whisper', tokensGemini: 0 }
  }
}

/* ========================================================================== */
/* Análise                                                                     */
/* ========================================================================== */

export interface AnaliseComProveniencia {
  analise: Analise
  meta: Record<string, unknown>
  custoUsd: number
}

export async function analisarReel(
  admin: SupabaseClient,
  item: ItemDaPesquisa,
  transcricao: Transcricao,
): Promise<AnaliseComProveniencia> {
  const prompt = await getActivePrompt(admin, NOME_DO_PROMPT)
  const entrada = [
    `REDE: ${item.rede}`,
    `CANAL/AUTOR: ${item.autor}`,
    `TÍTULO: ${item.titulo}`,
    `PUBLICADO: ${item.publicadoEm ?? 'desconhecido'}`,
    `DURAÇÃO: ${item.duracaoS ?? '?'}s`,
    `MÉTRICAS PÚBLICAS: ${JSON.stringify(item.metricas)}`,
    '',
    'TRANSCRIÇÃO E DESCRIÇÃO VISUAL (gerada por máquina):',
    transcricao.texto,
  ].join('\n')

  const t0 = Date.now()
  const cru = await runStructured({ prompt, input: entrada, schema: SCHEMA_ANALISE })
  const analise = AnaliseSchema.parse(cru)

  return {
    analise,
    // A PROVENIÊNCIA: sem ela, duas análises diferentes do mesmo vídeo num
    // histórico imutável viram mistério.
    meta: {
      prompt: prompt.name,
      prompt_versao: prompt.version,
      modelo: prompt.model,
      transcricao_via: transcricao.via,
      transcricao_caracteres: transcricao.texto.length,
      tokens_gemini: transcricao.tokensGemini,
      latencia_ms: Date.now() - t0,
      schema_versao: 1,
      analisado_em: new Date().toISOString(),
    },
    // O SDK não devolve `usage` por este caminho; a conta fina do Claude sai do
    // painel. O que o worker soma é a estimativa pelo tamanho da entrada — e
    // ela é impressa como ESTIMATIVA, nunca como fatura.
    custoUsd:
      (entrada.length / 4 / 1_000_000) * PRECO_CLAUDE.entrada +
      (2_500 / 1_000_000) * PRECO_CLAUDE.saida,
  }
}
