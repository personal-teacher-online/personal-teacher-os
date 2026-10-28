import { z } from 'zod'

// A DISSECAÇÃO DO REEL DE REFERÊNCIA — schema tolerante e as duas leituras.
//
// Nasceu dentro de `src/data/admin/radar.ts` (Leva 3) para o cartão de triagem;
// a Leva 5 a promoveu a módulo PURO porque o gerador passou a precisar dela: o
// roteiro que a Teacher Vicky pede no radar é a cópia do mecanismo do vídeo que
// performou, e esse mecanismo é exatamente o que está aqui.
//
// ── POR QUE NÃO IMPORTAR `AnaliseSchema` de `src/lib/research/analise.ts` ────
// Aquele módulo carrega o cliente Gemini/env do worker — arrastá-lo para dentro
// do Next (e do Vitest) seria pagar o worker inteiro por um shape.
//
// ── POR QUE TOLERANTE ───────────────────────────────────────────────────────
// Trend sem dissecação EXISTE: research `tipo='trends'` é apanhado sem análise,
// e as linhas migradas pelo script 2.3 também não têm. Payload ilegível vira o
// estado honesto "sem dissecação", nunca uma tela quebrada nem um prompt com
// "undefined" dentro.

export const DissecacaoSchema = z.object({
  gancho: z
    .object({
      texto_falado: z.string(),
      tipo: z.string().optional(),
      segundos_ate_o_ponto: z.number().optional(),
    })
    .optional(),
  beats: z
    .array(
      z.object({
        funcao: z.string().optional(),
        resumo: z.string(),
        frase_chave: z.string().optional(),
      }),
    )
    .optional(),
  texto_na_tela: z
    .object({ cartelas: z.array(z.string()).optional(), padrao: z.string().optional() })
    .optional(),
  por_que_performou: z.array(z.string()).optional(),
  copia: z
    .object({
      como_copiar: z.string().optional(),
      trilha: z.object({ protegida: z.boolean().optional(), qual: z.string().optional() }).optional(),
    })
    .optional(),
  avisos: z.array(z.string()).optional(),
})
export type Dissecacao = z.infer<typeof DissecacaoSchema>

/** Análise sem NENHUM bloco desenhável é "sem dissecação", não um cartão vazio. */
function temAlgo(d: Dissecacao): boolean {
  return Boolean(
    d.gancho || d.beats?.length || d.texto_na_tela || d.por_que_performou?.length || d.copia,
  )
}

/** A dissecação dentro de `content_research.payload` (o retrato da captura). */
export function lerDissecacao(payload: unknown): Dissecacao | null {
  if (typeof payload !== 'object' || payload === null) return null
  const analise = (payload as Record<string, unknown>).analise
  const lida = DissecacaoSchema.safeParse(analise)
  if (!lida.success) return null
  return temAlgo(lida.data) ? lida.data : null
}

/** A dissecação que a RPC congelou dentro de `content_posts.idea` (Leva 5). */
export function lerDissecacaoDaIdeia(idea: unknown): Dissecacao | null {
  if (typeof idea !== 'object' || idea === null) return null
  const lida = DissecacaoSchema.safeParse((idea as Record<string, unknown>).dissecacao)
  if (!lida.success) return null
  return temAlgo(lida.data) ? lida.data : null
}

/** O vocabulário do worker em português corrido (o mesmo do cartão). */
const FUNCAO_DA_BATIDA: Record<string, string> = {
  gancho: 'gancho',
  desenvolvimento: 'desenvolvimento',
  demonstracao: 'demonstração',
  virada: 'virada',
  cta: 'CTA',
}

/**
 * O bloco da ENTRADA do gerador: o mecanismo do vídeo de referência, escrito por
 * CÓDIGO a partir da captura. O prompt `content-reel-script` já manda copiar o
 * mecanismo do vídeo que a ideia cita — antes ele recebia uma frase de segunda
 * mão ("de onde veio"); agora recebe a dissecação inteira.
 *
 * Retorna `[]` quando não há dissecação: bloco vazio não entra na entrada (o
 * prompt não precisa saber que existe um bloco que não veio).
 */
export function blocoDaDissecacao(d: Dissecacao | null): string[] {
  if (!d) return []
  const linhas: string[] = ['=== O VÍDEO DE REFERÊNCIA, DISSECADO (copie ESTE mecanismo) ===']

  if (d.gancho) {
    const detalhe = [
      d.gancho.tipo,
      d.gancho.segundos_ate_o_ponto != null ? `${d.gancho.segundos_ate_o_ponto}s até o ponto` : null,
    ]
      .filter(Boolean)
      .join(', ')
    linhas.push(`Gancho do original: "${d.gancho.texto_falado}"${detalhe ? ` (${detalhe})` : ''}`)
  }

  if (d.beats?.length) {
    linhas.push('Batidas do original, na ordem:')
    d.beats.forEach((b, i) => {
      const funcao = b.funcao ? `${FUNCAO_DA_BATIDA[b.funcao] ?? b.funcao}: ` : ''
      const frase = b.frase_chave ? ` — "${b.frase_chave}"` : ''
      linhas.push(`  ${i + 1}. ${funcao}${b.resumo}${frase}`)
    })
  }

  if (d.texto_na_tela?.cartelas?.length) {
    linhas.push(`Cartelas do original: ${d.texto_na_tela.cartelas.join(' | ')}`)
  }
  if (d.texto_na_tela?.padrao) linhas.push(`Padrão de cartela: ${d.texto_na_tela.padrao}`)

  if (d.por_que_performou?.length) {
    linhas.push(`Por que performou: ${d.por_que_performou.join('; ')}`)
  }
  if (d.copia?.como_copiar) linhas.push(`Como adaptar para a Vicky: ${d.copia.como_copiar}`)
  if (d.copia?.trilha?.protegida) {
    linhas.push(
      `Trilha protegida${d.copia.trilha.qual ? ` (${d.copia.trilha.qual})` : ''} — preencha \`trilha\` com o aviso de biblioteca.`,
    )
  }
  if (d.avisos?.length) linhas.push(`Avisos da análise: ${d.avisos.join('; ')}`)

  return linhas
}
