// Cliente Autentique v2 (B8 — construção total 14/07/2026). Fatos conferidos
// na doc oficial (docs.autentique.com.br) em 14/07/2026:
//  - POST https://api.autentique.com.br/v2/graphql, Authorization: Bearer <token>.
//  - createDocument: GraphQL multipart (spec multipart upload): campos
//    operations (query+variables com file:null), map ({"file":["variables.file"]})
//    e file (binário). NÃO é base64.
//  - sandbox: argumento top-level `sandbox: true` na própria mutation (não
//    consome créditos; docs somem em dias) — env AUTENTIQUE_SANDBOX=1.
//  - id do documento: string hex longa (não UUID).
// Fail-closed sem envs (padrão da casa).

export interface AutentiqueConfig {
  token: string
  sandbox: boolean
}

export function autentiqueConfigFromEnv(): AutentiqueConfig | null {
  const token = process.env.AUTENTIQUE_TOKEN
  if (!token) return null
  return { token, sandbox: process.env.AUTENTIQUE_SANDBOX === '1' }
}

const GRAPHQL_URL = 'https://api.autentique.com.br/v2/graphql'

const CREATE_DOCUMENT_MUTATION = `
mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
  createDocument(sandbox: SANDBOX_FLAG, document: $document, signers: $signers, file: $file) {
    id
    name
    signatures {
      public_id
      email
      link { short_link }
    }
  }
}`

export interface CreateDocumentResult {
  documentId: string
  signLink: string | null
}

/**
 * O QUE SABEMOS SOBRE O DOCUMENTO QUANDO O ENVIO FALHA (c15 · decisão A).
 *
 * Esta é a informação que o c14 não tinha, e por isso ele errava: lá, QUALQUER
 * exceção fechava a reserva como `failed`, o que libera o próximo envio. Só que
 * "não criei" e "não sei" são fatos diferentes, e tratá-los igual transforma um
 * timeout num segundo contrato no e-mail do aluno.
 *
 *  `nao-criou` — a API RESPONDEU e a resposta diz que não criou nada: ou é um
 *                corpo GraphQL com `errors[]` (a mutation foi executada e
 *                recusada), ou é um 4xx cujo corpo conseguimos ler (a requisição
 *                foi rejeitada antes de virar documento: token inválido, PDF
 *                recusado, cota estourada). Nos dois casos NÃO há documento lá
 *                fora, e a reserva pode morrer para liberar o retry.
 *  `ambiguo`   — todo o resto: o fetch caiu, o timeout estourou, veio 5xx, o
 *                corpo não pôde ser lido/parseado, ou a resposta chegou inteira
 *                mas SEM id (a API respondeu algo que não sabemos ler). O
 *                documento pode existir. A reserva FICA ABERTA — é o estado
 *                honesto — e quem decide é gente, no painel de assinatura.
 *
 * A regra prática, para quem for mexer aqui: na dúvida, `ambiguo`. O custo de
 * errar para esse lado é uma reserva presa que um clique humano resolve; o custo
 * de errar para o outro é um documento duplicado que ninguém vê.
 */
export type CertezaDaFalha = 'nao-criou' | 'ambiguo'

export class AutentiqueEnvioError extends Error {
  readonly certeza: CertezaDaFalha
  constructor(message: string, certeza: CertezaDaFalha) {
    super(message)
    this.name = 'AutentiqueEnvioError'
    this.certeza = certeza
  }
}

/**
 * A pergunta que a action faz: dá para afirmar que o documento NÃO nasceu?
 *
 * Só um `AutentiqueEnvioError` marcado `nao-criou` responde que sim. Erro de
 * outro tipo (um bug nosso no meio do caminho, um `TypeError` lendo o arquivo)
 * cai no ambíguo de propósito: se não sabemos nem o que quebrou, não sabemos o
 * que aconteceu do outro lado.
 */
export function envioNaoCriouDocumento(err: unknown): boolean {
  return err instanceof AutentiqueEnvioError && err.certeza === 'nao-criou'
}

/*
 * PENDÊNCIA DO GATE 🔑 (token real do Autentique) — CHAVE DE IDEMPOTÊNCIA.
 *
 * O jeito canônico de matar duplicata de criação é a chave de request: o cliente
 * manda um identificador do PEDIDO e o provedor devolve o MESMO documento se a
 * chamada se repetir. Não está aqui de propósito: a doc pública do Autentique
 * v2 não descreve esse cabeçalho, e implementar às cegas seria mandar um header
 * que o provedor ignora — a aparência da proteção sem a proteção.
 *
 * O que existe hoje no lugar dela (e que basta para 20 alunos): a reserva local
 * nasce ANTES da chamada, a unicidade parcial impede um segundo pedido vivo, e
 * uma falha AMBÍGUA não libera retry nenhum sem um ato humano que exige ter
 * conferido o painel do Autentique. Duplicata só nasce se uma pessoa mandar
 * criar de novo depois de olhar — que é a decisão dela.
 *
 * QUANDO O GATE 🔑 ABRIR: conferir na API real (a) se `createDocument` aceita
 * alguma chave/`external_id` idempotente e (b) se a consulta por documento
 * permite achar um documento pelo nosso id de reserva. Se (b) existir, a reserva
 * aberta vira consulta automática e o ato humano fica só para o caso raro.
 */

export async function createDocumentForSignature(
  cfg: AutentiqueConfig,
  // F4/M5-4: múltiplos signatários (grupo = 2 e-mails) — a API já aceita lista.
  opts: { name: string; pdf: Buffer; signerEmail: string; extraSignerEmails?: string[] },
): Promise<CreateDocumentResult> {
  const emails = [opts.signerEmail, ...(opts.extraSignerEmails ?? [])].filter(Boolean)
  const operations = JSON.stringify({
    query: CREATE_DOCUMENT_MUTATION.replace('SANDBOX_FLAG', cfg.sandbox ? 'true' : 'false'),
    variables: {
      document: { name: opts.name },
      signers: emails.map((email) => ({ email, action: 'SIGN' })),
      file: null,
    },
  })
  const form = new FormData()
  form.append('operations', operations)
  form.append('map', JSON.stringify({ file: ['variables.file'] }))
  form.append('file', new Blob([new Uint8Array(opts.pdf)], { type: 'application/pdf' }), `${opts.name}.pdf`)

  // c15 · decisão A: a rede que cai é AMBÍGUA. A requisição pode ter chegado
  // inteira e a resposta ter se perdido na volta — o documento existiria, e nós
  // nunca saberíamos por aqui.
  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: form,
    })
  } catch (err) {
    throw new AutentiqueEnvioError(
      `não deu para falar com o Autentique (${String(err)})`,
      'ambiguo',
    )
  }

  // O corpo é lido como TEXTO primeiro: é ele que separa "a API recusou" de "a
  // API respondeu algo que não sabemos ler".
  let texto: string
  try {
    texto = await res.text()
  } catch (err) {
    throw new AutentiqueEnvioError(
      `a resposta do Autentique (HTTP ${res.status}) não pôde ser lida: ${String(err)}`,
      'ambiguo',
    )
  }

  interface RespostaDaCriacao {
    data?: { createDocument?: { id?: string; signatures?: { link?: { short_link?: string } }[] } }
    errors?: { message?: string }[]
  }
  let body: RespostaDaCriacao | null = null
  try {
    body = JSON.parse(texto) as RespostaDaCriacao
  } catch {
    body = null
  }

  if (body?.errors?.length && !body.data?.createDocument?.id && res.status < 500) {
    // A mutation rodou e foi recusada com motivo: não há documento.
    // `res.status < 500` é deliberado (Sol r6 nº 2): o GraphQL admite `errors[]`
    // com execução PARCIAL, e um 5xx pode ter quebrado DEPOIS de criar — 5xx
    // com corpo de erros cai no ramo de baixo e fica AMBÍGUO. A semântica fina
    // da API real é pendência do gate 🔑 (ADR-029).
    throw new AutentiqueEnvioError(
      `o Autentique recusou a criação: ${body.errors.map((e) => e.message).join('; ')}`,
      'nao-criou',
    )
  }
  if (!res.ok) {
    // 4xx = a requisição foi rejeitada ANTES de virar documento (token, cota,
    // arquivo). 5xx = o servidor quebrou no meio, e o meio pode ser depois da
    // criação.
    throw new AutentiqueEnvioError(
      `Autentique respondeu HTTP ${res.status}: ${texto.slice(0, 300) || '(corpo vazio)'}`,
      res.status >= 400 && res.status < 500 ? 'nao-criou' : 'ambiguo',
    )
  }
  if (body === null) {
    throw new AutentiqueEnvioError(
      `a resposta do Autentique não é JSON (HTTP ${res.status}): ${texto.slice(0, 300)}`,
      'ambiguo',
    )
  }
  const doc = body.data?.createDocument
  if (!doc?.id) {
    // 200 sem id e sem erro declarado: a API respondeu e não entendemos. Pode
    // ter criado.
    throw new AutentiqueEnvioError(
      'o Autentique respondeu sem id de documento — não dá para afirmar que ele não foi criado',
      'ambiguo',
    )
  }
  return {
    documentId: doc.id,
    signLink: doc.signatures?.[0]?.link?.short_link ?? null,
  }
}

/** Consulta o estado atual de um documento (fallback do webhook). */
export async function getDocumentSignatures(
  cfg: AutentiqueConfig,
  documentId: string,
): Promise<{ viewed: boolean; signed: boolean; rejected: boolean }> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($id: UUID!) { document(id: $id) { id signatures { viewed { created_at } signed { created_at } rejected { created_at } } } }`,
      variables: { id: documentId },
    }),
  })
  if (!res.ok) throw new Error(`autentique document: HTTP ${res.status}`)
  const body = (await res.json()) as {
    data?: { document?: { signatures?: { viewed?: unknown; signed?: unknown; rejected?: unknown }[] } }
  }
  const sigs = body.data?.document?.signatures ?? []
  return {
    viewed: sigs.some((s) => s.viewed),
    signed: sigs.length > 0 && sigs.every((s) => s.signed),
    rejected: sigs.some((s) => s.rejected),
  }
}
