/**
 * Agrupa os créditos que estão vencendo POR ALUNO, para a home do admin.
 *
 * Motivo (varredura de 22/07/2026): a lista mostrava uma linha por lançamento,
 * e um aluno com 4 créditos aparecia 4 vezes seguidas com texto idêntico —
 * "Murilo Fonseca · 1 crédito · vale até 31/07/2026", quatro vezes. Para quem
 * lê, isso é ruído: a pergunta é "quem tem crédito vencendo, e quantos".
 *
 * O que este agrupamento NÃO faz, de propósito: fundir os lançamentos. Cada
 * crédito é uma entrada do ledger com validade e duração próprias (Lei 2), e
 * "estender validade" age num `ledger_id` específico. Aqui é só apresentação —
 * o nome aparece uma vez, e cada crédito continua com a sua própria ação.
 */
export interface CreditoVencendo {
  contract_id: string
  student_id: string | null
  who: string
  ledger_id: number
  expires_on: string
  duration_min: number | null
  situation: 'vencendo' | 'vencido'
}

export interface GrupoCredito {
  /** chave estável para o React */
  key: string
  who: string
  student_id: string | null
  /** quantos créditos este aluno tem na lista */
  total: number
  /** true quando TODOS vencem no mesmo dia — deixa o cabeçalho dizer a data */
  mesmaData: boolean
  /** a data mais próxima do grupo (a que importa para agir) */
  proximaData: string
  /** algum já venceu? o cabeçalho fica em tom de perigo */
  algumVencido: boolean
  itens: CreditoVencendo[]
}

export function agruparCreditos(creditos: CreditoVencendo[]): GrupoCredito[] {
  const porAluno = new Map<string, CreditoVencendo[]>()
  for (const c of creditos) {
    // aluno sem id (contrato de grupo, p.ex.) agrupa pelo nome exibido
    const chave = c.student_id ?? `nome:${c.who}`
    const lista = porAluno.get(chave)
    if (lista) lista.push(c)
    else porAluno.set(chave, [c])
  }

  const grupos: GrupoCredito[] = []
  for (const [key, itens] of porAluno) {
    const datas = itens.map((i) => i.expires_on)
    grupos.push({
      key,
      who: itens[0].who,
      student_id: itens[0].student_id,
      total: itens.length,
      mesmaData: new Set(datas).size === 1,
      proximaData: datas.slice().sort()[0],
      algumVencido: itens.some((i) => i.situation === 'vencido'),
      itens,
    })
  }

  // o que vence antes vem antes; empate desempata por nome, para a ordem não
  // dançar entre recarregamentos
  return grupos.sort(
    (a, b) =>
      Number(a.algumVencido !== b.algumVencido) * (a.algumVencido ? -1 : 1) ||
      a.proximaData.localeCompare(b.proximaData) ||
      a.who.localeCompare(b.who),
  )
}
