// Structured Outputs da Anthropic — sanitização do JSON Schema.
//
// Fato conferido na doc oficial (21/07/2026, após 400 em produção
// "For 'integer' type, properties maximum, minimum are not supported"):
// a API NÃO aceita restrições numéricas (minimum/maximum/multipleOf), de
// string (minLength/maxLength) nem maxItems; minItems só 0 ou 1; oneOf não é
// suportado (anyOf sim). Os SDKs oficiais fazem exatamente o que esta função
// faz: removem as keywords, DESCREVEM o limite em texto para o modelo, e
// deixam a validação de verdade para o cliente — no nosso caso o
// LessonSchema/ExcerptProposalSchema (zod) no servidor, antes de gravar.

const NUMERIC = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const
const STRING = ['minLength', 'maxLength'] as const

type Node = Record<string, unknown>

function isNode(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Descreve em português o limite removido, para o modelo continuar ciente. */
function hints(node: Node): string[] {
  const out: string[] = []
  const n = (k: string) => (typeof node[k] === 'number' ? (node[k] as number) : undefined)
  const min = n('minimum') ?? n('exclusiveMinimum')
  const max = n('maximum') ?? n('exclusiveMaximum')
  if (min !== undefined && max !== undefined) out.push(`entre ${min} e ${max}`)
  else if (min !== undefined) out.push(`mínimo ${min}`)
  else if (max !== undefined) out.push(`máximo ${max}`)

  const minL = n('minLength')
  const maxL = n('maxLength')
  if (minL !== undefined && maxL !== undefined) out.push(`${minL} a ${maxL} caracteres`)
  else if (minL !== undefined) out.push(`mínimo ${minL} caracteres`)
  else if (maxL !== undefined) out.push(`máximo ${maxL} caracteres`)

  const minI = n('minItems')
  const maxI = n('maxItems')
  if (minI !== undefined && maxI !== undefined) out.push(`${minI} a ${maxI} itens`)
  else if (minI !== undefined && minI > 1) out.push(`mínimo ${minI} itens`)
  else if (maxI !== undefined) out.push(`máximo ${maxI} itens`)

  return out
}

/**
 * Limite da API (400 em 21/07): "Schemas contains too many optional
 * parameters (81) … limit: 24". Solução canônica (a mesma da OpenAI):
 * NENHUM campo opcional — todos entram em `required` e os que eram opcionais
 * passam a aceitar `null` (anyOf com {type:'null'}). O modelo responde null
 * onde não se aplica, e `stripNulls` devolve o objeto ao formato do contrato
 * antes do zod validar.
 */
export function sanitizeForAnthropic(schema: unknown): Record<string, unknown> {
  return walk(allRequired(schema)) as Record<string, unknown>
}

function allRequired(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(allRequired)
  if (!isNode(value)) return value
  const node: Node = { ...value }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'enum' || k === 'const' || k === 'required') continue
    node[k] = allRequired(v)
  }
  if (isNode(node.properties)) {
    const props = node.properties as Node
    const keys = Object.keys(props)
    const req = new Set(Array.isArray(node.required) ? (node.required as string[]) : [])
    for (const k of keys) {
      if (req.has(k)) continue
      const sub = props[k]
      // já aceita null? não empilha outro anyOf
      const already =
        isNode(sub) &&
        (sub.type === 'null' ||
          (Array.isArray(sub.type) && (sub.type as string[]).includes('null')) ||
          (Array.isArray(sub.anyOf) &&
            (sub.anyOf as unknown[]).some((o) => isNode(o) && o.type === 'null')))
      props[k] = already ? sub : { anyOf: [sub, { type: 'null' }] }
    }
    node.required = keys
  }
  return node
}

/** Remove chaves com null do retorno da IA (elas representam "ausente"),
 *  preservando as que o contrato declara nullable de verdade. */
export function stripNulls(value: unknown, keepNull: Set<string> = KEEP_NULL): unknown {
  if (Array.isArray(value)) return value.map((v) => stripNulls(v, keepNull))
  if (!isNode(value)) return value
  const out: Node = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !keepNull.has(k)) continue
    out[k] = v === null ? v : stripNulls(v, keepNull)
  }
  return out
}

/** Campos NULLABLE no contrato (null é valor legítimo, não "ausente"). */
export const KEEP_NULL = new Set(['videoUrl'])

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk)
  if (!isNode(value)) return value

  const node: Node = { ...value }
  const limits = hints(node)

  for (const k of NUMERIC) delete node[k]
  for (const k of STRING) delete node[k]
  delete node.maxItems
  // minItems: só 0 ou 1 são aceitos.
  if (typeof node.minItems === 'number' && node.minItems > 1) node.minItems = 1
  // oneOf não é suportado; anyOf tem a mesma semântica prática aqui.
  if (node.oneOf && !node.anyOf) {
    node.anyOf = node.oneOf
    delete node.oneOf
  }
  // pattern: suporte limitado (sem lookahead/backreference) — fora do nosso uso.
  delete node.pattern

  if (limits.length) {
    const prev = typeof node.description === 'string' ? node.description.trim() : ''
    node.description = [prev, `(${limits.join('; ')})`].filter(Boolean).join(' ')
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === 'enum' || k === 'const' || k === 'required') continue
    node[k] = walk(v)
  }
  return node
}
