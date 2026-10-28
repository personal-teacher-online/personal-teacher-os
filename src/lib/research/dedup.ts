// DEDUP TEMÁTICA (Estúdio v2 — Leva 0.4, ADR-034).
//
// O problema medido no acervo de 02/08: o mesmo TEMA entrando por fontes
// diferentes ("substituir o WHAT?" 3× · "pedir café sem I want" 5× ·
// "role-play de imigração" 8×), porque a dedup era por FONTE (link) e as
// famílias são bilíngues — léxico não pega "pedir café" × "ordering coffee".
//
// O desenho: embedding (Gemini, 768d) de cada ideia da pauta, guardado em
// `content_embeddings`; antes de criar ideia nova, vizinho mais próximo por
// cosseno contra TODAS as já embedadas — vivas, descartadas e arquivadas.
//   · similar a mãe VIVA (`ideia`/`ideia_aprovada`) → vira VARIAÇÃO anexada
//     (`idea.variacoes[]` da mãe) — não nasce post novo;
//   · similar a mãe fechada (descartada/arquivada/congelada) → SUPRIMIDA:
//     o descarte da Teacher Vicky vale para o TEMA, não só para a linha;
//   · distinta → nasce, e o vetor entra na memória.
//
// A comparação roda em TS (dezenas de vetores — scan exato instantâneo); o
// pgvector é o STORAGE tipado e a porta para a era das trends (Leva 2+), em
// que a busca vira SQL. FAIL-OPEN declarado: embedding que falha loga e a
// ideia nasce sem dedup — a captura nunca trava por causa da memória.
//
// Módulo do WORKER (Node puro): imports relativos com `.ts`, sem alias `@/`.

import type { SupabaseClient } from '@supabase/supabase-js'


export const MODELO_EMBEDDING = 'gemini-embedding-001'
export const DIMENSOES = 768

/**
 * A ASSINATURA do espaço vetorial gravado em `content_embeddings.modelo`.
 * Vetor só compara com vetor da MESMA assinatura (o filtro de `lerVetores`);
 * quando o payload/modelo mudar de verdade, muda-se ESTA constante e o legado
 * se re-embeda sozinho pelo backfill preguiçoso (upsert por escopo+ref).
 *
 * Hoje ela é IGUAL ao nome do modelo, e isso é uma DECISÃO MEDIDA (Leva 2.2,
 * 03/08/2026 — fechamento da dívida 3 da 0.4, "payload com campo depreciado"):
 *   · o substituto da doc (`embedContentConfig`) é ACEITO e IGNORADO pela API
 *     — devolve 3072 dims normalizadas, que o `vector(768)` recusaria; migrar
 *     para ele hoje quebraria a dedup em silêncio;
 *   · `taskType SEMANTIC_SIMILARITY` (top-level, funcional) foi MEDIDO no
 *     corpus real e REPROVADO: o teto inter-família saltou de 0,822 para
 *     0,918 (o híbrido what×imigração passou por cima das duplicatas
 *     flagrantes) com piso intra 0,792 — o vão INVERTE e falso-merge, que a
 *     escolha declarada da 0.4 proíbe, viraria rotina;
 *   · decisão: manter o payload que funciona (deprecated na doc, único
 *     honrado pela API). A validação de 768 dims em `embedarTexto` é o
 *     TRIPWIRE — se o Google inverter o comportamento, a corrida acusa em vez
 *     de gravar lixo (fail-open: captura nunca trava).
 */
export const ASSINATURA_EMBEDDING = MODELO_EMBEDDING

/**
 * O limiar de "mesmo tema", DECIDIDO POR MEDIÇÃO com o acervo REAL parqueado
 * na Leva 0.2 (script `scripts/dedup-fixtures.ts`; prova em
 * `tests/conteudo-dedup.test.ts` com os vetores commitados).
 *
 * Medido em 03/08/2026 — 46 casos (44 reais + 2 EN sintéticos), 1035 pares,
 * embedando o MESMO texto da produção (tema + premissa; achado nº 1 do Sol):
 *   · duplicatas FLAGRANTES da mesma família: 0,832–0,911 (incl. os pares
 *     PT×EN: 0,873 e 0,893 — a tese cross-language provada em ato);
 *   · par mais alto de famílias DISTINTAS: 0,822 (um híbrido legítimo,
 *     what-mecanismo em cenário de imigração). 0,83 cai no vão limpo.
 * A própria medição corrigiu a classificação 3×: apostila-2/3→iwant,
 * apostila-1→series, imigração-7→what, farmácia unificada — quando o
 * "falso positivo" apareceu, era rótulo meu errado, não o modelo.
 *
 * ESCOLHAS DECLARADAS: (a) o vão é FINO (0,822→0,832) — o corpus é o acervo
 * inteiro, não amostra; a régua por rodada acompanha o comportamento real e o
 * limiar é parâmetro de engenharia, revisável com evidência nova; (b) híbrido
 * e sub-variante ficam ABAIXO do limiar e viram cartões separados, de
 * propósito: falso-merge esconde ideia legítima; falso-negativo custa um
 * cartão a mais para a Teacher Vicky pular.
 *
 * RE-MEDIDO em 03/08/2026 (Leva 2.2, fechando a dívida 4 da 0.4): a
 * recalibração ganhou HOLDOUT — a família 'hotel' fica FORA do relatório que
 * escolhe o limiar e é verificada depois. Resultado: teto inter 0,822 na
 * calibração E no corpus inteiro (o holdout não mexeu no vão), e o par
 * flagrante retido (hotel-1×hotel-2) segue acima de 0,83 — o limiar separa
 * pares que nunca viu. O mesmo passe mediu e REPROVOU `taskType
 * SEMANTIC_SIMILARITY` (vão invertido: inter 0,918 × intra 0,792) — ver a
 * nota da ASSINATURA_EMBEDDING.
 */
export const LIMIAR_DEDUP = 0.83

/* ========================================================================== */
/* Aritmética                                                                  */
/* ========================================================================== */

export function cosseno(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`cosseno: dimensões incompatíveis (${a.length} × ${b.length})`)
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** O texto que representa a ideia na memória: tema + premissa (quando houver). */
export function textoDaIdeia(i: { tema: string; premissa?: string }): string {
  return [i.tema, i.premissa ?? ''].join('\n').trim()
}

/* ========================================================================== */
/* Embedding (Gemini REST — mesmo padrão do restante do pipeline)              */
/* ========================================================================== */

function chaveGemini(): string {
  const chave = process.env.GEMINI_API_KEY
  if (!chave) throw new Error('GEMINI_API_KEY ausente — dedup precisa dela (fail-open: a corrida segue sem dedup)')
  return chave
}

export async function embedarTexto(texto: string): Promise<number[]> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EMBEDDING}` +
    `:embedContent?key=${chaveGemini()}`
  let ultimoErro = ''
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    // Erro de REDE (DNS, timeout, conexão) também é retentável — o fetch
    // rejeita em vez de responder, e sair na 1ª tentativa era mentir sobre
    // "3 tentativas" (achado nº 17 do Sol).
    let r: Response
    try {
      r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: texto }] },
          // Top-level de propósito, SEM taskType — as duas sondas de 03/08
          // estão na nota da ASSINATURA_EMBEDDING (o substituto da doc ignora
          // o valor; SEMANTIC_SIMILARITY inverte o vão no corpus real).
          outputDimensionality: DIMENSOES,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e)
      await new Promise((ok) => setTimeout(ok, tentativa * 1500))
      continue
    }
    const corpo = (await r.json().catch(() => ({}))) as {
      embedding?: { values?: number[] }
      error?: { message?: string }
    }
    const valores = corpo.embedding?.values
    if (r.ok && Array.isArray(valores) && valores.length === DIMENSOES) return valores
    ultimoErro = corpo.error?.message ?? `HTTP ${r.status} (${valores?.length ?? 0} dims)`
    if (r.status >= 400 && r.status < 500 && r.status !== 429) break
    await new Promise((ok) => setTimeout(ok, tentativa * 1500))
  }
  throw new Error(`embedding falhou: ${ultimoErro}`)
}

/* ========================================================================== */
/* Memória no banco                                                            */
/* ========================================================================== */

export type EscopoDoEmbedding = 'ideia' | 'trend'

export interface VetorGuardado {
  refId: string
  vetor: number[]
}

function parseVetor(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') {
    try {
      const arr = JSON.parse(v) as unknown
      return Array.isArray(arr) ? (arr as number[]) : null
    } catch {
      return null
    }
  }
  return null
}

export async function lerVetores(
  db: SupabaseClient,
  escopo: EscopoDoEmbedding,
): Promise<{ vetores: VetorGuardado[]; malformados: number; janelaCheia: boolean }> {
  const { data, error } = await db
    .from('content_embeddings')
    .select('ref_id, embedding')
    .eq('escopo', escopo)
    // Espaços vetoriais não se misturam (achado nº 2 do Sol): cosseno entre
    // assinaturas diferentes não significa nada — troca de payload/modelo re-
    // embeda tudo pelo backfill (o legado sem taskType fica fora deste filtro).
    .eq('modelo', ASSINATURA_EMBEDDING)
    .limit(5000)
  if (error) throw new Error(`dedup: falha ao ler a memória: ${error.message}`)
  const linhas = (data ?? []) as Array<{ ref_id: string; embedding: unknown }>
  const out: VetorGuardado[] = []
  let malformados = 0
  for (const linha of linhas) {
    const vetor = parseVetor(linha.embedding)
    // Vetor de dimensão errada ou não-finito seria lixo silencioso no cosseno
    // (achado nº 18 do Sol) — conta como malformado e aparece no relatório.
    if (vetor && vetor.length === DIMENSOES && vetor.every(Number.isFinite)) {
      out.push({ refId: linha.ref_id, vetor })
    } else {
      malformados += 1
    }
  }
  // O PostgREST corta em max_rows (1000 no padrão da casa) SEM erro — a partir
  // daí "comparar contra todas" seria mentira silenciosa (achado nº 11).
  return { vetores: out, malformados, janelaCheia: linhas.length >= 1000 }
}

export async function gravarEmbedding(
  db: SupabaseClient,
  escopo: EscopoDoEmbedding,
  refId: string,
  vetor: readonly number[],
): Promise<void> {
  const { error } = await db.from('content_embeddings').upsert(
    {
      escopo,
      ref_id: refId,
      embedding: JSON.stringify(vetor),
      modelo: ASSINATURA_EMBEDDING,
    },
    { onConflict: 'escopo,ref_id' },
  )
  if (error) throw new Error(`dedup: falha ao gravar embedding: ${error.message}`)
}

/* ========================================================================== */
/* A decisão                                                                   */
/* ========================================================================== */

// A APLICAÇÃO da dedup sobre um LOTE DE IDEIAS morreu na Leva 6.2, junto com o
// worker `ideias` e o Portão 1 que ele abastecia (`aplicarDedupDeIdeias` lia
// `content_posts` com prefixo `pauta:` — uma coorte que não nasce mais). O que
// ficou aqui é a memória vetorial em si: quem a aplica hoje é o RADAR
// (`src/lib/research/radar.ts`), que compara TREND com TREND e pendura a
// repetida como `variacao_de`. O limiar e a sua calibração contra o acervo real
// seguem provados em `tests/conteudo-dedup.test.ts`.
