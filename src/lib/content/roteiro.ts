import { z } from 'zod'

// Contrato do ROTEIRO DE REEL (M2, ADR-031). Uma versão só, no registro trend —
// o roteiro duplo foi morto pelo dono em 31/07 depois da calibração
// (docs/goals/calibracao-m2-roteiros-rodada1.md).
//
// O modelo devolve JSON (braço (a) da calibração, escolhido pelo dono); este
// módulo valida ESTRITAMENTE e serializa para o texto que a Teacher Vicky edita na
// coluna `roteiro`. O M3 acrescenta aqui o parser TOLERANTE de exibição — o
// texto editado por ela nunca é obrigado a passar por este validador.
//
// POR QUE O TEXTO E NÃO JSONB: `roteiro` é campo de EDIÇÃO humana (textarea do
// painel). Guardar JSON obrigaria a Teacher Vicky a editar JSON. A cópia estruturada
// íntegra do que o modelo devolveu fica em `generation_meta`.

/** Marcadores de bloco. Linha que COMEÇA com um destes abre um bloco novo —
 *  por isso o conteúdo dos campos nunca pode começar com eles (ver `umaLinha`). */
export const MARCADORES = [
  'GANCHO:',
  'VARIANTES DE GANCHO:',
  'CENA ',
  'CTA',
  'LEGENDA',
  'HASHTAGS:',
  'DURAÇÃO-ALVO:',
  'TRILHA:',
  'NOTA DE PRODUÇÃO:',
] as const

const cenaSchema = z.object({
  fala: z.string().trim().min(1).max(1200),
  texto_na_tela: z.string().trim().min(1).max(400),
  acao: z.string().trim().min(1).max(600),
})

/** Validação ESTRITA da entrega (Lei: output de máquina malformado NUNCA vira
 *  rascunho lixo — vira `failContentPost` com erro honesto). */
export const roteiroSchema = z.object({
  gancho: z.object({
    principal: z.string().trim().min(1).max(300),
    variantes: z.array(z.string().trim().min(1).max(300)).length(3),
  }),
  cenas: z.array(cenaSchema).min(2).max(12),
  cta: z.object({
    fala: z.string().trim().min(1).max(600),
    texto_na_tela: z.string().trim().min(1).max(300),
  }),
  legenda: z.string().trim().min(1).max(3000),
  hashtags: z.array(z.string().trim().min(2).max(60)).min(3).max(6),
  duracao_alvo_s: z.number().int().min(15).max(120),
  trilha: z.string().max(400).optional(),
  nota_de_producao: z.string().max(1500).optional(),
})

export type RoteiroReel = z.infer<typeof roteiroSchema>

/** JSON Schema para o `output_config` da Messages API. Deliberadamente NÃO exige
 *  `trilha` nem `nota_de_producao`: campo de texto livre obrigatório faz o modelo
 *  encher linguiça para não deixar vazio (medido na rodada 1 da calibração, onde
 *  a nota de produção obrigatória virou recitação das regras cumpridas). */
export const ROTEIRO_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['gancho', 'cenas', 'cta', 'legenda', 'hashtags', 'duracao_alvo_s'],
  properties: {
    gancho: {
      type: 'object',
      additionalProperties: false,
      required: ['principal', 'variantes'],
      properties: {
        principal: { type: 'string' },
        variantes: { type: 'array', items: { type: 'string' } },
      },
    },
    cenas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fala', 'texto_na_tela', 'acao'],
        properties: {
          fala: { type: 'string' },
          texto_na_tela: { type: 'string' },
          acao: { type: 'string' },
        },
      },
    },
    cta: {
      type: 'object',
      additionalProperties: false,
      required: ['fala', 'texto_na_tela'],
      properties: { fala: { type: 'string' }, texto_na_tela: { type: 'string' } },
    },
    legenda: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    duracao_alvo_s: { type: 'integer' },
    trilha: { type: 'string' },
    nota_de_producao: { type: 'string' },
  },
}

/** Campo de uma linha: quebra de linha some. Elimina de raiz a ambiguidade de o
 *  conteúdo abrir um bloco falso — não há o que escapar se não há linha nova. */
function umaLinha(texto: string): string {
  return texto.replace(/\s*\n\s*/g, ' ').trim()
}

/** A legenda é multi-linha por natureza; aqui a linha que imitaria um marcador
 *  ganha um espaço à frente (invisível para quem lê, inerte para o parser). */
function legendaSegura(texto: string): string {
  return texto
    .split('\n')
    .map((linha) => (MARCADORES.some((m) => linha.startsWith(m)) ? ` ${linha}` : linha))
    .join('\n')
    .trim()
}

/** JSON validado → o texto que a Teacher Vicky edita. */
export function serializeRoteiro(r: RoteiroReel): string {
  return [
    `GANCHO: ${umaLinha(r.gancho.principal)}`,
    'VARIANTES DE GANCHO:',
    ...r.gancho.variantes.map((t, i) => `${i + 1}. ${umaLinha(t)}`),
    '',
    ...r.cenas.flatMap((c, i) => [
      `CENA ${i + 1}`,
      `Fala: ${umaLinha(c.fala)}`,
      `Texto na tela: ${umaLinha(c.texto_na_tela)}`,
      `Ação: ${umaLinha(c.acao)}`,
      '',
    ]),
    'CTA',
    `Fala: ${umaLinha(r.cta.fala)}`,
    `Texto na tela: ${umaLinha(r.cta.texto_na_tela)}`,
    '',
    'LEGENDA',
    legendaSegura(r.legenda),
    '',
    `HASHTAGS: ${r.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`,
    `DURAÇÃO-ALVO: ${r.duracao_alvo_s}s`,
    `TRILHA: ${umaLinha(r.trilha ?? '') || '—'}`,
    `NOTA DE PRODUÇÃO: ${umaLinha(r.nota_de_producao ?? '') || '—'}`,
  ].join('\n')
}

// ── MODO TOLERANTE: exibição do texto EDITADO (M3) ──────────────────────────
// O modo estrito acima guarda a ENTREGA DA MÁQUINA. Este guarda a EXIBIÇÃO do
// que a Teacher Vicky editou à mão — outro problema, outra régua. Função PURA (nada de
// React, nada de banco): o Vitest prova cada forma sem levantar tela, no
// precedente de briefing/leitura.ts e policy/markdown.ts.
//
// Duas invariantes de desenho, nesta ordem de prioridade:
//   1. NADA SOME. Linha que o parser não entende é preservada — continuando o
//      campo aberto, ou como `extras` visíveis no cartão.
//   2. NADA MUDA DE DONO. Uma linha órfã NUNCA é atribuída a um campo que não
//      estava aberto: "vira sempre fala" corromperia o sentido do roteiro
//      (uma instrução de câmera viraria texto na boca da apresentadora).
// Quem não puder ser exibido cai em texto cru na tela — nunca tela branca.

export interface CenaExibicao {
  numero: string
  fala?: string
  textoNaTela?: string
  acao?: string
  /** Linhas sem dono, preservadas na ordem (invariante 1). */
  extras: string[]
}

export interface RoteiroExibicao {
  gancho?: string
  variantes: string[]
  cenas: CenaExibicao[]
  cta?: { fala?: string; textoNaTela?: string; extras: string[] }
  legenda?: string
  hashtags?: string[]
  duracaoAlvoS?: number
  trilha?: string
  notaDeProducao?: string
  /** Texto antes de qualquer marcador (invariante 1). */
  extrasDoTopo: string[]
}

export type ParseExibicao =
  | { ok: true; valor: RoteiroExibicao; avisos: string[] }
  | { ok: false; motivo: 'vazio' | 'sem_cena' }

/** Campos rotulados de dentro de CENA/CTA. Case e acento exatos: quase-marcador
 *  é linha comum, nunca bloco fantasma. */
const CAMPOS = [
  ['Fala:', 'fala'],
  ['Texto na tela:', 'textoNaTela'],
  ['Ação:', 'acao'],
] as const

type ChaveCampo = (typeof CAMPOS)[number][1]

/** `—` (e vazio) significam "não preenchido" — é o que o serializador escreve. */
function valorOuNada(texto: string): string | undefined {
  const t = texto.trim()
  return t && t !== '—' ? t : undefined
}

export function parseRoteiroExibicao(texto: string): ParseExibicao {
  if (!texto || !texto.trim()) return { ok: false, motivo: 'vazio' }

  const avisos: string[] = []
  const v: RoteiroExibicao = { variantes: [], cenas: [], extrasDoTopo: [] }

  // Onde a próxima linha solta cai: o campo aberto (invariante 2) ou o balde
  // de extras do bloco corrente.
  let cena: CenaExibicao | null = null
  let cta: NonNullable<RoteiroExibicao['cta']> | null = null
  let campoAberto: ChaveCampo | null = null
  let secao: 'topo' | 'cena' | 'cta' | 'variantes' | 'legenda' = 'topo'
  const legenda: string[] = []

  const soltaEm = (linha: string): void => {
    if (campoAberto) {
      const alvo = secao === 'cta' ? cta : cena
      if (alvo) {
        const atual = (alvo as Record<string, unknown>)[campoAberto]
        ;(alvo as Record<string, unknown>)[campoAberto] =
          typeof atual === 'string' && atual ? `${atual} ${linha}` : linha
        return
      }
    }
    // Sem campo aberto: preserva como extra do bloco corrente + avisa.
    if (secao === 'cena' && cena) cena.extras.push(linha)
    else if (secao === 'cta' && cta) cta.extras.push(linha)
    else v.extrasDoTopo.push(linha)
    avisos.push(`linha sem bloco reconhecido preservada: "${linha.slice(0, 60)}"`)
  }

  const duplicado = (nome: string, linha: string): void => {
    avisos.push(`${nome} repetido — o primeiro vale; o segundo foi preservado como texto`)
    soltaEm(linha)
  }

  const fecharLegenda = (): void => {
    if (legenda.length > 0 && v.legenda === undefined) {
      v.legenda = legenda.join('\n').trim() || undefined
    }
  }

  for (const bruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = bruta.trim()

    // Dentro da LEGENDA, linha vazia não fecha nada e o texto é literal — só um
    // marcador de rodapé encerra o bloco.
    if (secao === 'legenda' && !/^(HASHTAGS:|DURAÇÃO-ALVO:|TRILHA:|NOTA DE PRODUÇÃO:|CENA \d|CTA$|GANCHO:)/.test(linha)) {
      legenda.push(bruta.trimEnd())
      continue
    }
    if (!linha) continue

    const cenaNova = /^CENA\s+(\d+)$/.exec(linha)
    if (cenaNova) {
      fecharLegenda()
      cena = { numero: cenaNova[1], extras: [] }
      v.cenas.push(cena)
      cta = null
      campoAberto = null
      secao = 'cena'
      continue
    }

    if (linha === 'CTA') {
      fecharLegenda()
      if (v.cta) {
        duplicado('CTA', linha)
        continue
      }
      cta = { extras: [] }
      v.cta = cta
      cena = null
      campoAberto = null
      secao = 'cta'
      continue
    }

    if (linha === 'LEGENDA') {
      if (v.legenda !== undefined || legenda.length > 0) {
        duplicado('LEGENDA', linha)
        continue
      }
      cena = null
      cta = null
      campoAberto = null
      secao = 'legenda'
      continue
    }

    const gancho = /^GANCHO:\s*(.*)$/.exec(linha)
    if (gancho) {
      fecharLegenda()
      if (v.gancho !== undefined) {
        duplicado('GANCHO', linha)
        continue
      }
      v.gancho = valorOuNada(gancho[1])
      cena = null
      cta = null
      campoAberto = null
      secao = 'topo'
      continue
    }

    if (linha === 'VARIANTES DE GANCHO:') {
      fecharLegenda()
      cena = null
      cta = null
      campoAberto = null
      secao = 'variantes'
      continue
    }

    const rodape = /^(HASHTAGS:|DURAÇÃO-ALVO:|TRILHA:|NOTA DE PRODUÇÃO:)\s*(.*)$/.exec(linha)
    if (rodape) {
      fecharLegenda()
      const valor = valorOuNada(rodape[2])
      if (rodape[1] === 'HASHTAGS:' && valor) {
        // Vírgula, espaço ou os dois; `#` opcional (a Teacher Vicky digita como quiser).
        v.hashtags = valor
          .split(/[,\s]+/)
          .map((h) => h.trim())
          .filter(Boolean)
          .map((h) => (h.startsWith('#') ? h : `#${h}`))
      } else if (rodape[1] === 'DURAÇÃO-ALVO:' && valor) {
        const n = /^(\d+)\s*s?$/.exec(valor)
        // Duração ilegível não derruba o roteiro: o campo some, o resto fica.
        if (n) v.duracaoAlvoS = Number(n[1])
        else avisos.push(`duração-alvo ilegível: "${valor}"`)
      } else if (rodape[1] === 'TRILHA:') {
        v.trilha = valor
      } else if (rodape[1] === 'NOTA DE PRODUÇÃO:') {
        v.notaDeProducao = valor
      }
      cena = null
      cta = null
      campoAberto = null
      secao = 'topo'
      continue
    }

    if (secao === 'variantes') {
      const item = /^\d+\.\s*(.*)$/.exec(linha)
      if (item) {
        const t = valorOuNada(item[1])
        if (t) v.variantes.push(t)
        continue
      }
      soltaEm(linha)
      continue
    }

    if (secao === 'cena' || secao === 'cta') {
      const campo = CAMPOS.find(([rotulo]) => linha.startsWith(rotulo))
      if (campo) {
        const alvo = secao === 'cta' ? cta : cena
        const chave = campo[1]
        if (alvo && (secao !== 'cta' || chave !== 'acao')) {
          const valor = valorOuNada(linha.slice(campo[0].length))
          const jaTem = (alvo as Record<string, unknown>)[chave]
          if (typeof jaTem === 'string' && jaTem) {
            avisos.push(`campo "${campo[0]}" repetido na mesma cena — preservado como texto`)
            campoAberto = chave
            soltaEm(linha)
            continue
          }
          if (valor !== undefined) (alvo as Record<string, unknown>)[chave] = valor
          campoAberto = chave
          continue
        }
      }
    }

    soltaEm(linha)
  }
  fecharLegenda()

  // CENA é o único bloco obrigatório: sem ela não há visão de gravação a montar.
  const temCenaUtil = v.cenas.some(
    (c) => c.fala !== undefined || c.textoNaTela !== undefined || c.acao !== undefined,
  )
  if (!temCenaUtil) return { ok: false, motivo: 'sem_cena' }

  return { ok: true, valor: v, avisos }
}

/** Conferência final do texto serializado — rede contra defeito no serializador,
 *  não contra o modelo (o modelo já passou pelo zod). Barato e fail-loud. */
export function validarTextoRoteiro(texto: string): { ok: true } | { ok: false; detalhe: string } {
  const faltando = [
    ['GANCHO:', /^GANCHO: \S/m],
    ['CENA 1', /^CENA 1$/m],
    ['CTA', /^CTA$/m],
    ['LEGENDA', /^LEGENDA$/m],
    ['HASHTAGS:', /^HASHTAGS: \S/m],
  ].filter(([, re]) => !(re as RegExp).test(texto))
  if (faltando.length > 0) {
    return { ok: false, detalhe: `roteiro sem os blocos: ${faltando.map(([n]) => n).join(', ')}` }
  }
  return { ok: true }
}
