// Renderização MÍNIMA do `body_md` de policy_versions (correção 3 da revisão
// adversarial de 26/07).
//
// Por que existe: a tela de ciência exibia o texto MARTELADO no TSX enquanto o
// aceite apontava para uma linha do banco. Os dois podiam divergir com um
// commit — e aí o registro diria que o aluno concordou com um texto que nunca
// esteve na tela. Agora o TSX renderiza o que o banco tem, e o aceite carrega o
// id daquela versão: o aceite PROVA o texto.
//
// Deliberadamente não é um parser de Markdown. O corpo de uma política da casa
// é título + parágrafos + negrito, e é só isso que se aceita: sem HTML cru,
// sem link, sem imagem, sem lista. O que o subconjunto não entende sai como
// texto literal — nunca como marcação executada. Regra da casa (Lei 11 em
// espírito): nada que venha de dado vira markup arbitrário na tela.

export interface PedacoDeTexto {
  texto: string
  forte: boolean
}

export interface PoliticaRenderizada {
  /** Primeiro `#…` do corpo — vira o eyebrow do cartão. */
  titulo: string | null
  /** Parágrafos já com o negrito quebrado em pedaços. */
  paragrafos: PedacoDeTexto[][]
}

/** Quebra `a **b** c` em pedaços; `**` sem par fecha volta como literal. */
export function pedacos(texto: string): PedacoDeTexto[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((p) => p !== '')
    .map((p) =>
      p.length > 4 && p.startsWith('**') && p.endsWith('**')
        ? { texto: p.slice(2, -2), forte: true }
        : { texto: p, forte: false },
    )
}

export function renderPolicyMd(bodyMd: string): PoliticaRenderizada {
  let titulo: string | null = null
  const restantes: string[] = []
  for (const linha of bodyMd.split('\n')) {
    const cabecalho = /^\s*#{1,6}\s+(.+?)\s*$/.exec(linha)
    if (cabecalho && titulo === null) {
      titulo = cabecalho[1]
      continue
    }
    restantes.push(linha)
  }
  const paragrafos = restantes
    .join('\n')
    .split(/\n\s*\n/)
    // quebra simples dentro do parágrafo é fluxo de texto, não linha nova
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p !== '')
    .map(pedacos)
  return { titulo, paragrafos }
}
