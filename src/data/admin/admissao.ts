// GRAMÁTICA DA ADMISSÃO (Onda 1 · M3-3) — as etapas do wizard de "Novo aluno",
// o estado de cada bolinha do stepper e o endereço de cada passo.
//
// Módulo PURO, como `alunos-grupos.ts` e `ficha-gramatica.ts`: o wizard é um
// Server Component que lê o banco pela camada de dados, e ISTO aqui é a parte
// que se prova sem banco nenhum — o teste importa direto.
//
// POR QUE O WIZARD É FORWARD-ONLY (e o rodapé não tem "Voltar").
// A anatomia medida no TutorBird tem [Cancel | Previous · Next]: lá o wizard
// junta tudo e SALVA NO FIM. O nosso salva A CADA ETAPA — a etapa 1 cria o
// aluno, a 2 cria o contrato e os horários — porque as mutações são as mesmas
// dos fluxos avulsos e não foram reescritas (item 10 do e2e). Com isso,
// "Voltar" para uma etapa já commitada não desfaz nada: reenviar o formulário
// criaria um SEGUNDO aluno ou um SEGUNDO contrato. Um botão que promete voltar
// e na verdade duplica é pior que a ausência dele, então a vaga fantasma do
// rodapé é ocupada pelo "Pular esta etapa" — que é o gesto real que existe
// aqui (as etapas 2 e 3 sempre foram puláveis) e que antes vivia como link de
// texto de 12px, proibido pela régua de legibilidade.
// Quando a admissão virar transação única (porta nova, `ResultadoDaAcao`), o
// "Voltar" nasce junto — e aí ele será verdade.

/** Os três passos que o stepper desenha, na ordem. */
export const ETAPAS_DA_ADMISSAO = ['Dados do aluno', 'Contrato e horários', 'Convite'] as const

/**
 * 1–3 são os passos; 4 é a CONCLUSÃO (o "Student Added!" deles), que não é um
 * passo do stepper — é o estado em que todas as bolinhas já estão com ✓.
 */
export type EtapaDaAdmissao = 1 | 2 | 3 | 4

export const CONCLUSAO = 4 satisfies EtapaDaAdmissao

/**
 * Em que etapa o painel está, a partir do `?s=` da URL e da existência do
 * aluno. Sem aluno criado não existe etapa 2, 3 nem conclusão: o `?s=3` de um
 * link velho (ou de um F5 depois de o aluno ser apagado) volta ao começo em vez
 * de desenhar um formulário que não tem em quem escrever.
 */
export function etapaDaAdmissao(s: string | undefined, temAluno: boolean): EtapaDaAdmissao {
  if (!temAluno) return 1
  if (s === '4') return 4
  if (s === '3') return 3
  return 2
}

export type EstadoDaEtapa = 'feita' | 'atual' | 'futura'

/** Estado da bolinha `n` do stepper quando o painel está na etapa `atual`. */
export function estadoDaEtapa(n: number, atual: EtapaDaAdmissao): EstadoDaEtapa {
  if (n < atual) return 'feita'
  return n === atual ? 'atual' : 'futura'
}

/**
 * O endereço de uma etapa. O wizard é HOSPEDADO pelo hub (`?novo=1`) desde a
 * Leva 7 — ele navega entre etapas voltando para cá, e é por isso que o painel
 * mora na URL e não num `useState`.
 */
/* ========================================================================== */
/* Plano do contrato (M3-c5 · D2)                                              */
/* ========================================================================== */

/**
 * FASE 1 do "plano selecionável": o campo de texto livre vira uma lista das
 * opções que a escola JÁ usa, com uma saída de emergência para escrever outra.
 *
 * Por que fase 1: não existe entidade Produto no banco — plano é uma coluna de
 * texto em `contracts` (`plan_name`), e a mutação não muda nesta rodada (o
 * valor final continua indo no MESMO campo do formulário). A lista, portanto,
 * é DERIVADA do que já foi digitado: cada nome distinto que aparece em algum
 * contrato. A entidade formal ("Visão de produtos", no mapeamento) é onda
 * futura — e quando ela existir, esta função morre em vez de virar legado.
 *
 * `__outro__` é sentinela de FORMULÁRIO, nunca valor gravado: o Select do kit
 * (Radix) proíbe item de valor vazio, e "escrever um plano novo" precisa de um
 * valor para ser escolhido.
 */
export const PLANO_OUTRO = '__outro__'

/** O nome que a escola usa hoje na esmagadora maioria dos contratos. */
export const PLANO_PADRAO = 'Aulas particulares'

/** Os nomes distintos, limpos e em ordem alfabética (pt-BR, sem caso). */
export function planosDoSeletor(nomes: (string | null | undefined)[]): string[] {
  const vistos = new Map<string, string>()
  for (const bruto of nomes) {
    const nome = (bruto ?? '').trim()
    if (!nome) continue
    // Distinto por TEXTO, e o primeiro a chegar dá a grafia: "aulas
    // particulares" e "Aulas Particulares" são o mesmo plano para quem lê a
    // lista, e duas linhas quase iguais num menu é a definição de ruído.
    const chave = nome.toLocaleLowerCase('pt-BR')
    if (!vistos.has(chave)) vistos.set(chave, nome)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Qual opção já vem escolhida: o plano padrão quando ele está entre os usados,
 * senão o primeiro da lista — e "Outro…" quando não há lista nenhuma (escola
 * sem contrato ainda, que é o estado de um banco novo).
 */
export function planoInicial(planos: string[]): string {
  if (planos.includes(PLANO_PADRAO)) return PLANO_PADRAO
  return planos[0] ?? PLANO_OUTRO
}

export function enderecoDaAdmissao(
  etapa: EtapaDaAdmissao,
  aluno?: string | null,
  /** o rascunho da etapa 2, quando ela precisa voltar preenchida (c12 · nº 12) */
  rascunho?: string | null,
): string {
  const q = new URLSearchParams({ novo: '1' })
  // A etapa 1 é o endereço limpo: `?s=1` não acrescenta informação nenhuma.
  if (etapa > 1 && aluno) {
    q.set('s', String(etapa))
    q.set('aluno', aluno)
  }
  if (rascunho) q.set('rasc', rascunho)
  return `/admin/alunos?${q.toString()}`
}

/* ========================================================================== */
/* O RASCUNHO DA ETAPA 2 (c12 · nº 12)                                         */
/* ========================================================================== */

/**
 * POR QUE ISTO EXISTE. Desde o M4-4 a etapa 2 cria contrato e horários numa
 * transação só (`admin_create_contract`): se um horário conflita, NADA nasce.
 * Foi a escolha certa — meio contrato era um estado que ninguém pedia. Só que a
 * volta era brutal: a action redirecionava para `?s=2` com o motivo no toast, e
 * a etapa remontava EM BRANCO. A pessoa acabava de escolher professora, plano,
 * valor, franquia, início e dois horários para ouvir "a professora já tem aula
 * nesse horário" e ter de digitar tudo de novo — sendo que só UM campo estava
 * errado.
 *
 * O MECANISMO, e por que é o mais simples que preserva tudo. O wizard já mora
 * inteiro na URL (`?novo=1&s=2&aluno=…`): é assim que ele sobrevive ao F5 e ao
 * botão de voltar, e é da URL que o servidor monta a etapa. Então o rascunho vai
 * pelo MESMO caminho — um parâmetro `?rasc=` com os campos que a pessoa
 * digitou. Nada de sessão, nada de cookie, nada de tabela de rascunho, nada de
 * transformar a etapa 1 em cliente: o estado continua num lugar só, e ele
 * continua sendo o endereço.
 *
 * O QUE NÃO ENTRA AQUI: o `aluno` (já está na URL) e qualquer coisa que não seja
 * campo digitado. E o rascunho é DESCARTÁVEL por definição — chegou torto, a
 * etapa nasce vazia, exatamente como antes.
 */
export interface RascunhoDoContrato {
  professora: string
  plano: string
  valor: string
  remarcacoes: string
  inicio: string
  /** os DOIS horários que a etapa oferece, na ordem em que ela os desenha */
  horarios: { weekday: number; hora: string; duracao: number }[]
}

/** Quantos horários a etapa 2 oferece (e portanto guarda no rascunho). */
export const HORARIOS_DA_ADMISSAO = 2

/**
 * Quanto do endereço o rascunho pode ocupar, JÁ PERCENTO-CODIFICADO (c13 · nº 8).
 *
 * 2 KB é o teto porque o rascunho não é o endereço inteiro: ele divide a URL com
 * `?novo=1&s=2&aluno=<uuid>&msg=<a frase do erro>&n=<agora>`, e a frase de erro
 * do Postgres é longa. Com 2 KB aqui, o endereço fica confortavelmente abaixo
 * dos ~8 KB que servidor e proxy aceitam sem discutir (o Cloudflare na frente é
 * o mais apertado da fila) — e um campo de tamanho livre nunca derruba a etapa
 * inteira com um 414.
 *
 * QUEM PODE ESTOURAR ISSO, na prática: só o nome do plano, que era o único campo
 * sem teto — e ganhou `maxLength={80}` no mesmo lote. Este teto, portanto, é
 * cinto: se algum campo crescer amanhã (ou se alguém colar um texto num campo
 * que hoje não existe), a etapa volta VAZIA com um aviso honesto em vez de
 * voltar quebrada.
 */
export const TETO_DO_RASCUNHO = 2048

/**
 * Quanto este rascunho ocupa no endereço — medido com o MESMO codificador que
 * PRODUZ o endereço (c14 · Sol 7.2).
 *
 * O c13 media com `encodeURIComponent`, e quem monta a URL é
 * `enderecoDaAdmissao`, que usa `URLSearchParams`. Os dois codificam conjuntos
 * DIFERENTES de caracteres: `URLSearchParams` percent-codifica `!`, `'`, `(`,
 * `)` e `~` (que `encodeURIComponent` deixa passar) e, na outra direção, manda
 * espaço como `+` (um byte, contra os três de `%20`). Nenhum dos dois é teto do
 * outro — então medir com um e enviar pelo outro é medir a coisa errada, que é
 * exatamente o defeito de um teto. Aqui a conta é feita pelo produtor: monta-se
 * o par `rasc=<valor>` e desconta-se o `rasc=`.
 */
export function tamanhoNoEndereco(texto: string): number {
  return new URLSearchParams({ rasc: texto }).toString().length - 'rasc='.length
}

/**
 * O rascunho como um pedaço de URL. JSON compactado em chaves de uma letra —
 * o endereço é para o navegador, não para leitura humana, e o formulário tem
 * onze campos.
 *
 * Devolve STRING VAZIA quando não cabe (c13 · nº 8): é o sinal de "não deu",
 * e quem chama transforma isso num aviso — nunca numa URL gigante. Rascunho é
 * conveniência; endereço quebrado é defeito.
 */
export function rascunhoDoContrato(r: RascunhoDoContrato): string {
  const texto = JSON.stringify({
    t: r.professora,
    p: r.plano,
    v: r.valor,
    a: r.remarcacoes,
    i: r.inicio,
    h: r.horarios.map((h) => [h.weekday, h.hora, h.duracao]),
  })
  // O que viaja é a forma CODIFICADA (aspas e chaves viram %22/%7B), e é ela
  // que precisa caber — medir o JSON cru subestimaria o endereço em ~40%.
  return tamanhoNoEndereco(texto) > TETO_DO_RASCUNHO ? '' : texto
}

/**
 * De volta a rascunho — ou `null` se o que veio não serve.
 *
 * TOLERANTE DE PROPÓSITO: `?rasc=` é dado de fora (link colado, URL mexida à
 * mão, versão antiga do formato depois de um deploy). Nada aqui é gravado em
 * lugar nenhum; o pior caso de um rascunho estranho é um campo pré-preenchido
 * com bobagem, que a pessoa vê e corrige — e que o Zod da action e o Postgres
 * recusam de qualquer jeito. Estourar seria pior: derrubaria a etapa 2 inteira.
 */
export function lerRascunhoDoContrato(
  bruto: string | string[] | undefined | null,
): RascunhoDoContrato | null {
  const um = Array.isArray(bruto) ? bruto[0] : bruto
  if (!um) return null
  let cru: unknown
  try {
    cru = JSON.parse(um)
  } catch {
    return null
  }
  if (typeof cru !== 'object' || cru === null) return null
  const o = cru as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')
  const horarios: RascunhoDoContrato['horarios'] = []
  for (const linha of Array.isArray(o.h) ? o.h : []) {
    if (!Array.isArray(linha)) continue
    const [w, hora, dur] = linha
    horarios.push({
      weekday: Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 6 ? (w as number) : 1,
      hora: /^\d{2}:\d{2}$/.test(texto(hora)) ? texto(hora) : '',
      duracao: typeof dur === 'number' && dur > 0 ? dur : 45,
    })
  }
  return {
    professora: texto(o.t),
    plano: texto(o.p),
    valor: texto(o.v),
    remarcacoes: texto(o.a),
    inicio: texto(o.i),
    horarios,
  }
}
