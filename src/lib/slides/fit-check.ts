// FS-M5 — checagem de espaço ANTES de gerar o deck. Todos os defeitos da
// produção do M6 (21/07) foram de transbordo; o painel avisa no editor, com o
// motivo, em vez de o problema aparecer no Google Slides.
import { COURSE_V2_PREFIX, type LessonDoc, type SlideSpec } from './lesson-schema.ts'
import {
  AGRUPAMENTO,
  BODY_BOTTOM,
  BOTTOM_PAD,
  planCover,
  planGrammar,
  planMission,
  planWriting,
} from './layout.ts'
import { dialoguePages, missionSteps, writingPageCount } from './template-v2.ts'
import { revealCount } from './template.ts'

export interface FitWarning {
  /** posição do slide no documento (1-based) */
  slide: number
  type: SlideSpec['type']
  /** o que apertou */
  what: string
  /** o que fazer — em português, para a professora */
  fix: string
  /**
   * `aperto` cabe mas está no limite · `estouro` não cabe · `paginação` cabe,
   * PORÉM em mais de uma tela (o deck cresce). Paginar é comportamento
   * legítimo do template (Fase 0e, item 21) — o defeito era ser silencioso.
   */
  severity: 'aperto' | 'estouro' | 'paginação'
}

const plain = (s: string): string => s.replace(/\*\*|\{\{|\}\}|\[\[|\]\]|__/g, '')

/**
 * Conta as páginas PELO RENDERER (a mesma função que desenha — nunca uma
 * segunda conta). Quando nem um item cabe sozinho, o renderer estoura de
 * propósito: aqui isso vira aviso de `estouro`, não uma exceção engolida nem
 * uma tela de erro no editor.
 */
function paginas(f: () => number): { n: number } | { erro: string } {
  try {
    return { n: f() }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Checagem de espaço de UMA aula.
 *
 * `course` decide se as regras de PAGINAÇÃO valem: quem pagina é o template v2
 * (`personal-travel-v2`). Sem `course`, vale o do documento — que é como o
 * editor da Teacher Vicky chama.
 */
export function checkFit(doc: LessonDoc, course?: string | null): FitWarning[] {
  const out: FitWarning[] = []
  const v2 = (course ?? doc.course ?? '').startsWith(COURSE_V2_PREFIX)
  doc.slides.forEach((s, i) => {
    const slide = i + 1
    if (s.type === 'cover') {
      const c = planCover(plain(s.title ?? doc.lesson.title), Boolean(s.image))
      if (c.titleFont <= 26) {
        out.push({
          slide,
          type: s.type,
          what: `título muito longo (fonte caiu para ${c.titleFont}pt)`,
          fix: 'encurte o título da aula para caber grande na capa',
          severity: 'aperto',
        })
      }
    }
    if (s.type === 'grammar') {
      const p = planGrammar({
        rule: plain(s.rule),
        tableHeaders: s.table?.headers,
        tableCells: s.table?.rows,
        examples: s.examples.map(plain),
        hasWatchOut: Boolean(s.watchOut),
      })
      const rows = (s.table?.rows.length ?? 0) + (s.table ? 1 : 0)
      if (rows > 0 && p.tableY + rows * p.tableRowH > BODY_BOTTOM - BOTTOM_PAD + 0.01) {
        out.push({
          slide,
          type: s.type,
          what: 'a tabela não cabe embaixo da regra',
          fix: 'tire uma linha da tabela ou encurte a regra',
          severity: 'estouro',
        })
      } else if (p.tableFont <= 9.5 || p.ruleFont <= 9.5) {
        out.push({
          slide,
          type: s.type,
          what: 'regra e tabela ficaram na fonte mínima',
          fix: 'encurte a regra (2 frases) ou as células da tabela',
          severity: 'aperto',
        })
      }
      if (s.examples.length > 6) {
        out.push({ slide, type: s.type, what: 'exemplos demais', fix: 'até 6 exemplos', severity: 'aperto' })
      }
    }
    if (s.type === 'writing') {
      const total = s.exercises.reduce((n, e) => n + e.items.length, 0)
      const p = planWriting(s.exercises, () => 1)
      if (p.k < 0.72) {
        out.push({
          slide,
          type: s.type,
          what: `${total} itens espremem o slide`,
          fix: 'até 5 itens somando os exercícios deixa o slide respirar',
          severity: p.k < 0.6 ? 'estouro' : 'aperto',
        })
      }
      // O DECK CRESCE EM SILÊNCIO (defeito 3 do lote de 14 aulas, 24/07): a
      // paginação do writing é geométrica e CADA nível de revelação repete
      // todas as páginas, então um item a mais pode custar vários slides. Os
      // três autores do lote esbarraram nisto sem nenhum aviso.
      if (v2) {
        const r = paginas(() => writingPageCount(s))
        const telas = 1 + revealCount(s)
        if ('erro' in r) {
          out.push({ slide, type: s.type, what: r.erro, fix: 'encurte o enunciado deste item', severity: 'estouro' })
        } else if (r.n > 1) {
          out.push({
            slide,
            type: s.type,
            what:
              `os ${total} itens não cabem em uma tela: viram ${r.n} telas ` +
              `— +${(r.n - 1) * telas} slides no deck`,
            fix:
              `cada nível de gabarito repete as ${r.n} telas (${telas} × ${r.n} = ${telas * r.n} slides). ` +
              'Para ficar em uma tela só, tire itens deste slide ou abra um segundo writing.',
            severity: 'paginação',
          })
        }
      }
    }
    if (s.type === 'dialogue' && v2) {
      // mesma régua do writing: a pastilha agora é medida pelo texto real e o
      // que não cabe continua em outro slide — com aviso, nunca em silêncio
      const r = paginas(() => dialoguePages(doc, s).length)
      if ('erro' in r) {
        out.push({ slide, type: s.type, what: r.erro, fix: 'encurte esta fala', severity: 'estouro' })
      } else if (r.n > 1) {
        out.push({
          slide,
          type: s.type,
          what: `as ${s.lines.length} falas não cabem em uma tela: viram ${r.n} telas (+${r.n - 1} slides)`,
          fix: 'encurte as falas mais longas ou divida a cena em dois diálogos',
          severity: 'paginação',
        })
      }
    }
    if (s.type === 'quiz' && s.questions.length > 5) {
      out.push({
        slide,
        type: s.type,
        what: `${s.questions.length} perguntas`,
        fix: 'até 5 perguntas curtas',
        severity: 'aperto',
      })
    }
    if (s.type === 'mission' && v2) {
      // AGRUPAMENTO NO CARTAZ (24/07): o aviso daqui dizia "passos longos demais
      // para o cartaz" e mandava encurtar o passo — descrição errada da causa,
      // medida no planejador do v1 (que não é quem desenha o cartaz v2). Foi por
      // isso que o defeito atravessou as quatro missões: nada estourava e nada
      // colidia; o que quebrava era a RAZÃO entre o vão que separa dois passos e
      // o vão que separa as duas linhas do mesmo passo (1.9× medido, mínimo
      // 2.5×), e "encurte o passo" cobrava em conteúdo um problema de
      // espaçamento. Agora a conta é a razão, medida no MESMO plano que desenha.
      const r = paginas(() => {
        const razoes = missionSteps(s).map((p) => p.gapEntre / Math.max(1e-9, p.gapDentro))
        return Math.min(...razoes)
      })
      if ('erro' in r) {
        out.push({ slide, type: s.type, what: r.erro, fix: 'encurte este passo', severity: 'estouro' })
      } else if (r.n < AGRUPAMENTO - 1e-9) {
        out.push({
          slide,
          type: s.type,
          what:
            `os passos ficam colados: razão de agrupamento ${r.n.toFixed(2)}× ` +
            `(mínimo ${AGRUPAMENTO}×) — o cartaz lê como um parágrafo, não como uma lista`,
          fix:
            'o vão ENTRE passos precisa ser ' +
            `${AGRUPAMENTO}× o vão entre as linhas do mesmo passo; o cartaz não tem altura ` +
            'para isso com estes passos — tire um passo ou encurte o mais longo',
          severity: 'estouro',
        })
      }
    }
    if (s.type === 'mission' && !v2) {
      // v1 (template.ts, em produção e congelado): quem planeja o cartaz lá é o
      // `planMission`, com geometria própria — o aviso dele fica como estava.
      const p = planMission({ briefing: plain(s.briefing), steps: (s.steps ?? []).map(plain) })
      if (p.stepFont <= 10.5) {
        out.push({
          slide,
          type: s.type,
          what: 'passos longos demais para o cartaz',
          fix: 'deixe cada passo em uma linha; o detalhe vai nas notas',
          severity: p.stepFont < 10 ? 'estouro' : 'aperto',
        })
      }
    }
    if (s.type === 'listening' && (s.items?.length ?? 0) > 7) {
      out.push({
        slide,
        type: s.type,
        what: `${s.items?.length} frases para marcar`,
        fix: 'até 7 frases',
        severity: 'aperto',
      })
    }
    if (s.type === 'speaking' && s.phrases.length > 5) {
      out.push({ slide, type: s.type, what: `${s.phrases.length} frases`, fix: 'até 5 frases', severity: 'aperto' })
    }
    if (s.type === 'vocab' && s.cards.length > 8) {
      out.push({ slide, type: s.type, what: `${s.cards.length} cards`, fix: 'até 8 cards', severity: 'aperto' })
    }
  })
  return out
}
