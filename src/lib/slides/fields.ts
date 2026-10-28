// FS-M5 — descrição declarativa dos campos EDITÁVEIS de cada tipo de slide.
// O editor do painel monta o formulário a partir daqui e devolve o slide
// atualizado; a professora nunca vê o documento cru.
import type { SlideSpec } from './lesson-schema.ts'
import { freshAnchor } from './anchors.ts'

export type FieldKind = 'text' | 'longtext' | 'list' | 'pairs' | 'lines' | 'answers' | 'checks'

export interface Field {
  /** nome no formulário (único dentro do slide) */
  name: string
  label: string
  kind: FieldKind
  hint?: string
  /** rótulos das duas colunas em `pairs`/`lines`/`answers` */
  cols?: [string, string]
  value: unknown
}

const TITULO_TIPO: Record<SlideSpec['type'], string> = {
  cover: 'Capa',
  objectives: 'Objetivos',
  warmup: 'Aquecimento',
  vocab: 'Vocabulário',
  grammar: 'Gramática',
  dialogue: 'Diálogo',
  listening: 'Listening (vídeo)',
  speaking: 'Fala (drill)',
  writing: 'Escrita',
  quiz: 'Quiz',
  tip: 'Dica',
  section: 'Divisória',
  mission: 'Missão',
  recap: 'Recapitulação',
  closing: 'Encerramento',
}

export function slideLabel(s: SlideSpec): string {
  return TITULO_TIPO[s.type] ?? s.type
}

/** Um resumo de uma linha para a lista de slides. */
export function slideSummary(s: SlideSpec): string {
  switch (s.type) {
    case 'cover':
      return s.subtitle ?? s.title ?? '—'
    case 'objectives':
    case 'recap':
      return s.items.join(' · ')
    case 'warmup':
      return s.prompt
    case 'vocab':
      return s.cards.map((c) => c.term).join(', ')
    case 'grammar':
      return s.title
    case 'dialogue':
      return `${s.lines.length} falas · ${s.title}`
    case 'listening':
      return s.videoUrl ? `vídeo escolhido · ${s.items?.length ?? 0} frases` : 'sem vídeo ainda'
    case 'speaking':
      return s.phrases.join(' · ')
    case 'writing':
      return `${s.exercises.reduce((n, e) => n + e.items.length, 0)} exercícios`
    case 'quiz':
      return `${s.questions.length} perguntas`
    case 'tip':
      return s.text
    case 'section':
      return s.subtitle ?? s.title
    case 'mission':
      return s.briefing
    case 'closing':
      return s.message ?? s.headline ?? '—'
    default:
      return ''
  }
}

export function describeSlide(s: SlideSpec): Field[] {
  const f: Field[] = []
  const add = (name: string, label: string, kind: FieldKind, value: unknown, extra: Partial<Field> = {}) =>
    f.push({ name, label, kind, value, ...extra })

  switch (s.type) {
    case 'cover':
      add('title', 'Título', 'text', s.title)
      add('subtitle', 'Subtítulo', 'text', s.subtitle)
      break
    case 'objectives':
      add('title', 'Título', 'text', s.title)
      add('items', 'Objetivos (um por linha)', 'list', s.items)
      break
    case 'warmup':
      add('title', 'Título', 'text', s.title)
      add('prompt', 'Pergunta de abertura', 'longtext', s.prompt)
      add('items', 'Opções (uma por linha)', 'list', s.items ?? [])
      break
    case 'vocab':
      add('title', 'Título', 'text', s.title)
      add('intro', 'Introdução', 'text', s.intro)
      // M-H2: 4ª coluna = anchorId; 5ª = índice de ORIGEM. Ambos ocultos no
      // editor e viajam com a linha. anchorId casa a foto por IDENTIDADE; o
      // índice de origem é o fallback dos cards LEGADOS (ainda sem âncora), para
      // uma linha legada reordenada herdar a SUA foto, não a do vizinho ancorado.
      add(
        'cards',
        'Palavras',
        'pairs',
        s.cards.map((c, i) => [c.term, c.pt, c.cue ?? '', c.anchorId ?? '', String(i)]),
        {
          cols: ['Inglês', 'Português'],
          hint: 'a 3ª coluna é a dica de pronúncia (sílaba forte)',
        },
      )
      break
    case 'grammar':
      add('title', 'Título', 'text', s.title)
      add('rule', 'Regra (até 2 frases)', 'longtext', s.rule)
      add('examples', 'Exemplos (um por linha)', 'list', s.examples)
      add('table', 'Tabela', 'pairs', s.table ? s.table.rows.map((r) => r) : [], {
        cols: [s.table?.headers[0] ?? 'Coluna 1', s.table?.headers[1] ?? 'Coluna 2'],
      })
      add('watchOut', 'Atenção (errado / certo)', 'pairs', s.watchOut ? [[s.watchOut.wrong, s.watchOut.right]] : [], {
        cols: ['✗ errado', '✓ certo'],
      })
      break
    case 'dialogue':
      add('title', 'Título', 'text', s.title)
      add('context', 'Contexto', 'text', s.context)
      add('lines', 'Falas', 'lines', s.lines.map((l) => [l.speaker, l.text]), { cols: ['Quem', 'Fala'] })
      add('glossary', 'Glossário', 'pairs', (s.glossary ?? []).map((g) => [g.term, g.pt]), {
        cols: ['Inglês', 'Português'],
      })
      break
    case 'listening':
      add('title', 'Título', 'text', s.title)
      add('task', 'Instrução', 'longtext', s.task)
      add('items', 'Frases para marcar', 'checks', (s.items ?? []).map((i) => [i.text, i.correct ? 'x' : '']), {
        hint: 'marque as que aparecem no trecho do vídeo',
      })
      break
    case 'speaking':
      add('title', 'Título', 'text', s.title)
      add('instruction', 'Instrução', 'longtext', s.instruction)
      add('phrases', 'Frases (uma por linha)', 'list', s.phrases)
      add('hint', 'Dica', 'text', s.hint)
      break
    case 'writing':
      add('title', 'Título', 'text', s.title)
      add('instruction', 'Instrução', 'longtext', s.instruction)
      s.exercises.forEach((ex, i) => {
        add(
          `ex${i}`,
          `Exercício ${i + 1} — ${ex.kind}`,
          'answers',
          ex.items.map((it) => [it.prompt, it.answer ?? '']),
          { cols: ['Enunciado', 'Resposta'] },
        )
      })
      break
    case 'quiz':
      add('title', 'Título', 'text', s.title)
      add('intro', 'Introdução', 'text', s.intro)
      add('questions', 'Perguntas', 'answers', s.questions.map((q) => [q.q, q.answer ?? '']), {
        cols: ['Pergunta', 'Resposta'],
      })
      break
    case 'tip':
      add('title', 'Título', 'text', s.title)
      add('text', 'Dica', 'longtext', s.text)
      break
    case 'section':
      add('kicker', 'Etiqueta', 'text', s.kicker)
      add('title', 'Título', 'text', s.title)
      add('subtitle', 'Subtítulo', 'text', s.subtitle)
      break
    case 'mission':
      add('title', 'Título', 'text', s.title)
      add('briefing', 'Briefing', 'longtext', s.briefing)
      add('steps', 'Passos (um por linha)', 'list', s.steps ?? [])
      break
    case 'recap':
      add('title', 'Título', 'text', s.title)
      add('items', 'Itens (um por linha)', 'list', s.items)
      break
    case 'closing':
      add('headline', 'Chamada', 'text', s.headline)
      add('message', 'Mensagem', 'longtext', s.message)
      add('nextClass', 'Próxima aula', 'text', s.nextClass)
      break
  }
  add('notes', 'Notas da professora (não aparecem no slide)', 'longtext', s.notes)
  return f
}

const linhas = (v: FormDataEntryValue | null): string[] =>
  String(v ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

/** Aplica o formulário do editor sobre o slide, preservando o resto. */
export function applyFields(spec: SlideSpec, form: {
  get(name: string): FormDataEntryValue | null
  getAll(name: string): FormDataEntryValue[]
}): SlideSpec {
  const s = structuredClone(spec) as Record<string, unknown>
  const txt = (n: string): string | undefined => {
    const v = String(form.get(n) ?? '').trim()
    return v || undefined
  }
  const pares = (n: string): string[][] => {
    const a = form.getAll(`${n}__1`).map((x) => String(x).trim())
    const b = form.getAll(`${n}__2`).map((x) => String(x).trim())
    const c = form.getAll(`${n}__3`).map((x) => String(x).trim())
    return a
      .map((_, i) => [a[i] ?? '', b[i] ?? '', c[i] ?? ''])
      .filter((r) => r[0] || r[1])
  }

  switch (spec.type) {
    case 'cover':
      s.title = txt('title')
      s.subtitle = txt('subtitle')
      break
    case 'objectives':
    case 'recap':
      s.title = txt('title')
      s.items = linhas(form.get('items'))
      break
    case 'warmup':
      s.title = txt('title')
      s.prompt = String(form.get('prompt') ?? '').trim()
      s.items = linhas(form.get('items'))
      if ((s.items as string[]).length === 0) delete s.items
      break
    case 'vocab': {
      s.title = String(form.get('title') ?? '').trim()
      s.intro = txt('intro')
      // M-H2: merge por anchorId QUANDO PRESENTE (corrige a limitação do M-H1);
      // fallback por ÍNDICE (M-H1) para a linha sem âncora — conteúdo legado
      // ainda não migrado. A foto ancorada (card.image) não trafega pelo editor;
      // o anchorId, sim (campo oculto cards__anchor), e é ele que reancora a foto.
      const orig = spec.cards
      const porAnchor = new Map(
        orig.filter((c) => c.anchorId).map((c) => [c.anchorId as string, c]),
      )
      const usados = new Set<string>(porAnchor.keys())
      const anchors = form.getAll('cards__anchor').map((x) => String(x).trim())
      const sources = form.getAll('cards__source').map((x) => String(x).trim())
      const temSource = sources.length > 0 // editor novo emite o índice de origem
      const col = (n: number) => form.getAll(`cards__${n}`).map((x) => String(x).trim())
      const [a, b, cu] = [col(1), col(2), col(3)]
      const vistos = new Set<string>()
      s.cards = a
        .map((_, i) => ({
          term: a[i] ?? '',
          pt: b[i] ?? '',
          cue: cu[i] ?? '',
          anchor: anchors[i] ?? '',
          source: sources[i] ?? '',
          i,
        }))
        .filter((r) => r.term || r.pt)
        .map((r) => {
          const daAncora = r.anchor ? porAnchor.get(r.anchor) : undefined
          let anchorId: string
          let image: string | undefined
          if (r.anchor && daAncora && !vistos.has(r.anchor)) {
            // linha identificada: preserva foto e id, resiste a reordenação/renome
            anchorId = r.anchor
            image = daAncora.image
          } else if (!r.anchor && temSource) {
            // legado sem âncora, editor NOVO: fallback pelo índice de ORIGEM
            // (não a posição atual) — reordenar não rouba a foto do vizinho.
            // source vazio = linha nova → sem foto.
            image = r.source === '' ? undefined : orig[Number(r.source)]?.image
            anchorId = freshAnchor(usados)
          } else if (!r.anchor) {
            // legado sem âncora, editor ANTIGO (sem source): fallback por posição
            // (M-H1) — mantém a compat de quem não manda cards__source.
            image = orig[r.i]?.image
            anchorId = freshAnchor(usados)
          } else {
            // âncora duplicada (linha copiada) ou desconhecida: id novo, sem foto
            anchorId = freshAnchor(usados)
            image = undefined
          }
          vistos.add(anchorId)
          return { term: r.term, pt: r.pt, ...(r.cue ? { cue: r.cue } : {}), anchorId, ...(image ? { image } : {}) }
        })
      break
    }
    case 'grammar': {
      s.title = String(form.get('title') ?? '').trim()
      s.rule = String(form.get('rule') ?? '').trim()
      s.examples = linhas(form.get('examples'))
      const rows = pares('table').map(([a, b]) => [a, b])
      if (rows.length) {
        const headers = (spec.table?.headers ?? ['Estrutura', 'Exemplo']).slice(0, 2)
        s.table = { headers, rows }
      } else delete s.table
      const wo = pares('watchOut')[0]
      if (wo && wo[0] && wo[1]) s.watchOut = { wrong: wo[0], right: wo[1] }
      else delete s.watchOut
      break
    }
    case 'dialogue': {
      s.title = String(form.get('title') ?? '').trim()
      s.context = txt('context')
      s.lines = pares('lines').map(([speaker, text]) => ({ speaker, text }))
      const gl = pares('glossary').map(([term, pt]) => ({ term, pt }))
      if (gl.length) s.glossary = gl
      else delete s.glossary
      break
    }
    case 'listening': {
      s.title = txt('title')
      s.task = String(form.get('task') ?? '').trim()
      const marcados = new Set(form.getAll('items__check').map((x) => String(x)))
      s.items = form
        .getAll('items__1')
        .map((x, i) => ({ text: String(x).trim(), ...(marcados.has(String(i)) ? { correct: true } : {}) }))
        .filter((i) => i.text)
      break
    }
    case 'speaking':
      s.title = txt('title')
      s.instruction = String(form.get('instruction') ?? '').trim()
      s.phrases = linhas(form.get('phrases'))
      s.hint = txt('hint')
      break
    case 'writing':
      s.title = txt('title')
      s.instruction = String(form.get('instruction') ?? '').trim()
      s.exercises = spec.exercises.map((ex, i) => ({
        kind: ex.kind,
        items: pares(`ex${i}`).map(([prompt, answer]) => ({ prompt, ...(answer ? { answer } : {}) })),
      }))
      break
    case 'quiz':
      s.title = txt('title')
      s.intro = txt('intro')
      s.questions = pares('questions').map(([q, answer]) => ({ q, ...(answer ? { answer } : {}) }))
      break
    case 'tip':
      s.title = txt('title')
      s.text = String(form.get('text') ?? '').trim()
      break
    case 'section':
      s.kicker = txt('kicker')
      s.title = String(form.get('title') ?? '').trim()
      s.subtitle = txt('subtitle')
      break
    case 'mission':
      s.title = String(form.get('title') ?? '').trim()
      s.briefing = String(form.get('briefing') ?? '').trim()
      s.steps = linhas(form.get('steps'))
      if ((s.steps as string[]).length === 0) delete s.steps
      break
    case 'closing':
      s.headline = txt('headline')
      s.message = txt('message')
      s.nextClass = txt('nextClass')
      break
  }
  const notes = txt('notes')
  if (notes) s.notes = notes
  else delete s.notes
  return s as SlideSpec
}
