// Matching da semeadura de externalReference (F4) — lógica PURA, sem IO.
// O script scripts/asaas-semear-external-reference.ts monta o índice local
// (banco) e busca assinaturas/clientes (API); AQUI só se decide a classe de
// cada assinatura. Regra de ouro do PLAN-APPROVED: ambiguidade NUNCA é
// aplicada automaticamente — só `inequivoca` recebe --apply.
//
// A chave real de matching é o E-MAIL do cliente Asaas contra o e-mail de
// login do aluno (auth.users): students não tem CPF e payers está vazio em
// produção (baseline F0) — não existe outra âncora local hoje. Sobras são
// resolvidas à mão no painel (risco 4 aceito no plano).

export interface AlunoLocal {
  studentId: string
  nome: string
  email: string
}

export interface ContratoLocal {
  id: string
  /** 'individual' recebe auto-vínculo de pagador (terceiro — F3); 'grupo' nunca. */
  tipo: 'individual' | 'grupo'
  planName: string
  studentIds: string[]
}

export interface IndiceLocal {
  /** e-mail (lowercase) → aluno */
  alunosPorEmail: Map<string, AlunoLocal>
  /** studentId → contratos VIGENTES hoje (started_on ≤ hoje ≤ ended_on/∞) */
  contratosPorStudent: Map<string, ContratoLocal[]>
  /** contratoId → contrato (reconhecer externalReference já semeada) */
  contratosPorId: Map<string, ContratoLocal>
}

export type Classificacao =
  | { tipo: 'ja-semeada'; contrato: ContratoLocal }
  /** externalReference preenchida mas NÃO é contrato local — nunca tocar. */
  | { tipo: 'referencia-estranha'; referencia: string }
  | { tipo: 'inequivoca'; aluno: AlunoLocal; contrato: ContratoLocal }
  | { tipo: 'ambigua'; aluno: AlunoLocal; contratos: ContratoLocal[] }
  | { tipo: 'sem-contrato-vigente'; aluno: AlunoLocal }
  | { tipo: 'sem-aluno'; email: string | null }

export function classificarAssinatura(
  assinatura: { externalReference?: string | null },
  cliente: { email?: string | null },
  indice: IndiceLocal
): Classificacao {
  const ref = assinatura.externalReference?.trim()
  if (ref) {
    const contrato = indice.contratosPorId.get(ref)
    return contrato ? { tipo: 'ja-semeada', contrato } : { tipo: 'referencia-estranha', referencia: ref }
  }

  const email = cliente.email?.trim().toLowerCase() || null
  const aluno = email ? indice.alunosPorEmail.get(email) : undefined
  if (!aluno) return { tipo: 'sem-aluno', email }

  const contratos = indice.contratosPorStudent.get(aluno.studentId) ?? []
  if (contratos.length === 0) return { tipo: 'sem-contrato-vigente', aluno }
  if (contratos.length > 1) return { tipo: 'ambigua', aluno, contratos }
  return { tipo: 'inequivoca', aluno, contrato: contratos[0] }
}
