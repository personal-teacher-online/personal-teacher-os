// M-H2 — identidade opaca e estável dos cards de vocabulário (`anchorId`).
//
// PONTO DE ATRIBUIÇÃO — decisão e justificativa:
// um card de vocabulário "ganha existência" por três caminhos que NÃO
// compartilham um único ponto de código:
//   (a) a IA rascunha a aula inteira (draft.ts) — o JSON não traz anchorId;
//   (b) a admin adiciona uma linha no editor de seções (applyFields);
//   (c) conteúdo legado/semeado (M5–M12) já existe sem anchorId.
// Por isso a identidade é atribuída no ato da PERSISTÊNCIA: todo save de rascunho
// passa o conteúdo por `ensureVocabAnchors`, que dá um id a qualquer card que
// ainda não tenha. É idempotente (re-salvar não muda ids), cobre os três
// caminhos, e mantém o id OPACO (aleatório, nunca derivado do termo — renomear o
// termo não pode mexer na identidade). Cards legados ganham id no PRIMEIRO save
// e seguem válidos até lá (o schema torna anchorId opcional).
//
// O editor (applyFields) é o lugar onde reordenar/renomear/adicionar acontecem e
// carrega o anchorId por linha no formulário; este módulo é a rede que cobre os
// saves que NÃO passam pelo editor (JSON avançado, rascunho por IA, aprovação de
// foto).

/** formato canônico do anchorId: 8 hex minúsculos. É o que a RPC de aprovação e
 *  o endereço da imagem esperam; qualquer coisa fora disso é reescrita. */
export const ANCHOR_RE = /^[0-9a-f]{8}$/

/** id opaco de 8 hex (crypto.randomUUID().slice(0,8)). Casa com o CHECK do banco
 *  para o nome da imagem (`^[a-z0-9-]+$`): os 8 primeiros chars do uuid são hex,
 *  sem hífen (o 1º hífen do uuid está no índice 8). */
export function newAnchorId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** Gera um id que não colide com os já usados neste documento. */
export function freshAnchor(used: Set<string>): string {
  let id = newAnchorId()
  while (used.has(id)) id = newAnchorId()
  used.add(id)
  return id
}

/**
 * Remove TODA ocorrência de `anchorId` do conteúdo (recursivo). Usado antes de
 * enviar o conteúdo à IA e ao receber a resposta BRUTA: a IA nunca deve ver nem
 * ecoar identidade (item 2). A ÚNICA fonte de anchorId pós-rascunho é
 * preserveAnchorsOnRedraft (posição+termo). Devolve um valor novo; não muta.
 */
export function stripAnchorIds<T>(content: T): T {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk)
    if (!n || typeof n !== 'object') return n
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === 'anchorId') continue
      out[k] = walk(v)
    }
    return out
  }
  return walk(content) as T
}

/** Coleta todos os anchorId já presentes nos cards de vocab do conteúdo. */
export function anchorsUsados(content: unknown): Set<string> {
  const used = new Set<string>()
  const doc = content as { slides?: Array<Record<string, unknown>> }
  for (const s of doc?.slides ?? []) {
    if (s?.type !== 'vocab' || !Array.isArray(s.cards)) continue
    for (const c of s.cards as Array<Record<string, unknown>>) {
      if (typeof c?.anchorId === 'string' && c.anchorId) used.add(c.anchorId)
    }
  }
  return used
}

/**
 * Garante anchorId VÁLIDO e ÚNICO em TODO card de vocabulário do conteúdo.
 * Preserva um id só quando ele bate o formato (`^[0-9a-f]{8}$`) E ainda não
 * apareceu no documento; id ausente, malformado ou DUPLICADO ganha um novo
 * (item 5). Não valida o resto do documento — tolerante a conteúdo cru. Devolve
 * um conteúdo NOVO (imutável); se nada muda, devolve o mesmo objeto.
 */
export function ensureVocabAnchors<T>(content: T): T {
  const doc = content as { slides?: Array<Record<string, unknown>> }
  if (!doc || !Array.isArray(doc.slides)) return content
  const used = new Set<string>() // ids já ACEITOS neste passe (garante unicidade)
  let mudou = false

  const slides = doc.slides.map((s) => {
    if (s?.type !== 'vocab' || !Array.isArray(s.cards)) return s
    let slideMudou = false
    const cards = (s.cards as Array<Record<string, unknown>>).map((c) => {
      const atual = c && typeof c === 'object' ? c.anchorId : undefined
      if (typeof atual === 'string' && ANCHOR_RE.test(atual) && !used.has(atual)) {
        used.add(atual)
        return c
      }
      slideMudou = true
      mudou = true
      return { ...c, anchorId: freshAnchor(used) }
    })
    return slideMudou ? { ...s, cards } : s
  })

  return mudou ? ({ ...doc, slides } as T) : content
}

/** cards de vocab de um conteúdo, na ordem dos slides de vocab. */
function vocabSlidesDe(content: unknown): Array<Array<Record<string, unknown>>> {
  const doc = content as { slides?: Array<Record<string, unknown>> }
  const out: Array<Array<Record<string, unknown>>> = []
  for (const s of doc?.slides ?? []) {
    if (s?.type === 'vocab' && Array.isArray(s.cards)) {
      out.push(s.cards as Array<Record<string, unknown>>)
    }
  }
  return out
}

const normTermo = (t: unknown): string => (typeof t === 'string' ? t.trim().toLowerCase() : '')

/**
 * Re-rascunho da MESMA aula (item 5): a IA devolve um doc NOVO, sem anchorId nem
 * foto. Aqui preservamos anchorId E foto dos cards por POSIÇÃO (mesmo slide de
 * vocab, mesmo índice) QUANDO o termo bate (case-insensitive) — assim a foto já
 * aprovada sobrevive ao re-rascunho. E devolvemos os TERMOS ÓRFÃOS: cards do doc
 * antigo que tinham foto e cujo termo NÃO foi preservado (a foto ficaria órfã).
 * Não bloqueia — quem chama avisa.
 */
export function preserveAnchorsOnRedraft<T>(
  oldContent: unknown,
  newDoc: T,
): { doc: T; orphanTerms: string[] } {
  const doc = newDoc as { slides?: Array<Record<string, unknown>> }
  const oldVocab = vocabSlidesDe(oldContent)
  if (!doc || !Array.isArray(doc.slides) || oldVocab.length === 0) {
    return { doc: newDoc, orphanTerms: [] }
  }

  const preservado = new Set<string>() // 'k:i' dos cards antigos aproveitados
  let k = -1
  const slides = doc.slides.map((s) => {
    if (s?.type !== 'vocab' || !Array.isArray(s.cards)) return s
    k += 1
    const oldCards = oldVocab[k] ?? []
    const cards = (s.cards as Array<Record<string, unknown>>).map((c, i) => {
      const oc = oldCards[i]
      if (oc && normTermo(oc.term) && normTermo(oc.term) === normTermo(c.term)) {
        preservado.add(`${k}:${i}`)
        const anchorId = typeof oc.anchorId === 'string' && ANCHOR_RE.test(oc.anchorId) ? oc.anchorId : undefined
        const image = typeof oc.image === 'string' && oc.image ? oc.image : undefined
        return { ...c, ...(anchorId ? { anchorId } : {}), ...(image ? { image } : {}) }
      }
      return c
    })
    return { ...s, cards }
  })

  const orphanTerms: string[] = []
  oldVocab.forEach((cards, kk) => {
    cards.forEach((c, i) => {
      if (typeof c.image === 'string' && c.image && !preservado.has(`${kk}:${i}`)) {
        orphanTerms.push(typeof c.term === 'string' ? c.term : '(sem termo)')
      }
    })
  })

  return { doc: { ...doc, slides } as T, orphanTerms }
}
