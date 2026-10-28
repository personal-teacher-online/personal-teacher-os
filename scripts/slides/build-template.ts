// M-Slides-1 — gera o TEMPLATE OFICIAL do Personal Travel: um deck com um
// exemplar de cada um dos 15 layouts, com conteúdo de amostra que explica o
// uso. É a referência visual canônica (e o arquivo que vira o "template
// primário" no Drive — nunca editar a cópia oficial, ADR-020/CLAUDE.md).
//
// TEMPLATE V2: além do deck do v1, o script gera o exemplar do v2 — UM por
// layout, e só. O deck "Variantes" saiu na Fase 0c: cada tipo passou a ter uma
// composição única (spec §7-ter.1), então não há segunda pele para exemplificar.
//
// ATENÇÃO ao `TEMPLATE_DOC` daqui de baixo: ele é o exemplar OFICIAL do v1, que
// está em produção. O texto dele não muda por causa do v2 (spec §7-ter.3,
// achado 17) — o v2 reusa o mesmo conteúdo de amostra, sem reescrevê-lo.
// Uso: npm run slides:template
import PptxGenJS from 'pptxgenjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LessonSchema,
  LessonSchemaV2,
  type LessonDoc,
  type SlideSpec,
} from '../../src/lib/slides/lesson-schema.ts'
import { buildLesson, packDeck } from '../../src/lib/slides/build.ts'
import { defineMastersV2, renderSlideV2 } from '../../src/lib/slides/template-v2.ts'

const TEMPLATE_DOC: LessonDoc = {
  course: 'personal-travel',
  module: { number: 5, title: 'Transportation Guide' },
  lesson: {
    number: 1,
    title: 'Template Oficial — Personal Travel',
    subtitle: 'Um exemplar de cada layout · capa e divisórias noturnas, conteúdo em papel',
  },
  level: 'A1',
  grammarFocus: ['(template — conteúdo de amostra)'],
  slides: [
    {
      type: 'cover',
      notes:
        'CAPA (noturna). O recorte da Teacher Vicky pode ser adicionado à direita no Slides. Eyebrow automático: PERSONAL TRAVEL · MODULE · LESSON.',
    },
    {
      type: 'objectives',
      items: [
        'Cada aula abre com **objetivos claros** (2 a 5)',
        'Use **negrito**, {{roxo da marca}} e [[teal]] no texto',
        'A zona branca no topo esquerdo é a **facecam da Teacher Vicky**',
        'Gabaritos vão para as **notas do apresentador**',
      ],
      kolb: ['abstract'],
      notes: 'Layout OBJECTIVES: metas da aula. A facecam cobre o dock branco na gravação.',
    },
    {
      type: 'warmup',
      prompt: 'Pergunta de ativação para começar a aula conversando. **Marque** o que se aplica:',
      items: ['Opção um', 'Opção dois', 'Opção três', 'Opção quatro'],
      kolb: ['concrete', 'reflective'],
      notes: 'Layout WARM UP: ativação + conversa. Checkboxes são clicáveis/preenchíveis no Slides.',
    },
    {
      type: 'vocab',
      title: 'Vocabulary cards',
      cards: [
        { term: 'bus', cue: 'BUS', pt: 'ônibus' },
        { term: 'subway', cue: 'SUB-way', pt: 'metrô' },
        { term: 'train', cue: 'TREIN', pt: 'trem' },
        { term: 'ferry', cue: 'FÉR-ri', pt: 'balsa' },
        { term: 'taxi / cab', cue: 'TÉK-si', pt: 'táxi' },
        { term: 'on foot', cue: 'on FUT', pt: 'a pé' },
      ],
      kolb: ['abstract', 'active'],
      notes: 'Layout VOCABULARY: 3–8 cards; "cue" = sílaba forte para o drill de pronúncia.',
    },
    {
      type: 'grammar',
      title: 'Grammar spotlight',
      rule: 'A regra fica neste cartão com barra roxa. Use {{destaque roxo}} para a estrutura.',
      examples: [
        'I go to work {{by bus}}.',
        'We went to the island {{by ferry}}.',
        "The hotel is close — let's go {{on foot}}.",
      ],
      table: { headers: ['by + transport', 'on foot'], rows: [['by bus · by train · by taxi', 'when you walk']] },
      watchOut: { wrong: 'by foot', right: 'on foot' },
      kolb: ['abstract'],
      notes: 'Layout GRAMMAR: regra + exemplos + tabela opcional + erro comum (✗/✓).',
    },
    {
      type: 'dialogue',
      title: 'At the ticket office',
      context: 'Diálogo curto para reading — os balões alternam as cores dos falantes.',
      lines: [
        { speaker: 'A', text: 'One **round-trip ticket**, please.' },
        { speaker: 'B', text: "Sure. That's **$4.50**." },
        { speaker: 'A', text: 'What time is the **next train**?' },
        { speaker: 'B', text: 'At **9:15**, platform 2.' },
      ],
      glossary: [
        { term: 'round-trip', pt: 'ida e volta' },
        { term: 'platform', pt: 'plataforma' },
      ],
      kolb: ['reflective'],
      notes: 'Layout DIALOGUE: 2–8 falas + glossário lateral opcional.',
    },
    {
      type: 'section',
      title: 'PRACTICE TIME',
      subtitle: 'Divisória noturna para abrir o bloco de exercícios',
      notes: 'Layout SECTION: divisória de bloco (noturna).',
    },
    {
      type: 'listening',
      task: '**Watch the video** and check what you hear:',
      videoUrl: null,
      videoHint: '► Teacher Vicky: inserir o vídeo aqui (Inserir → Vídeo → YouTube)',
      items: [
        { text: 'Item ouvido um', correct: true },
        { text: 'Item ouvido dois' },
        { text: 'Item ouvido três', correct: true },
      ],
      answers: '(gabarito do listening vai para as notas)',
      kolb: ['reflective'],
      notes:
        'Layout LISTENING: a IA nunca inventa URL — a Teacher Vicky insere o vídeo curado. Itens com correct: true geram o slide de ANSWERS seguinte (a seta "preenche" as respostas).',
    },
    {
      type: 'speaking',
      instruction: 'Repeat each phrase **out loud**. Focus on the {{stressed}} part:',
      phrases: ['How can I {{get to}} the city center?', 'Does this bus go to the {{airport}}?', 'One ticket, {{please}}.'],
      hint: 'Repita 3× cada frase — depois grave a sua versão.',
      kolb: ['active'],
      notes: 'Layout SPEAKING: drill de pronúncia com chips SAY.',
    },
    {
      type: 'writing',
      instruction: 'Exercícios de escrita — a aluna **digita nas caixas** durante a aula:',
      exercises: [
        {
          kind: 'complete',
          items: [
            { prompt: 'I go to school ___ bus.', answer: 'by' },
            { prompt: 'We like to explore the city ___ foot.', answer: 'on' },
          ],
        },
        {
          kind: 'unscramble',
          items: [{ prompt: 'time / What / is / next / the / train / ?', answer: 'What time is the next train?' }],
        },
      ],
      kolb: ['active'],
      notes: 'Layout WRITING: complete / unscramble / create. Gabarito NUNCA visível — só nas notas.',
    },
    {
      type: 'quiz',
      intro: 'Situações reais — responda em inglês:',
      questions: [
        { q: 'You want to pay less. **How do you go**: taxi or bus?', answer: 'By bus (cheaper).' },
        { q: 'The museum is 5 minutes away. **How do you go**?', answer: 'On foot.' },
      ],
      kolb: ['active'],
      notes: 'Layout QUIZ: perguntas situacionais numeradas; gabarito nas notas.',
    },
    {
      type: 'tip',
      text: 'Cartão de dica cultural/prática da viagem — use para o "insider knowledge" da Teacher Vicky. **Uma dica por aula.**',
      notes: 'Layout TIP: dica de viagem com barra âmbar.',
    },
    {
      type: 'mission',
      number: 5,
      title: 'Nome da Missão',
      briefing: 'Briefing da missão do módulo — o desafio prático que a aluna executa fora da aula.',
      steps: ['Primeiro passo', 'Segundo passo', 'Terceiro passo'],
      kolb: ['active'],
      notes: 'Layout MISSION: usado nas aulas de Missão de cada módulo (noturno).',
    },
    {
      type: 'recap',
      items: [
        'Resumo do que foi aprendido',
        'Entre 2 e 8 itens',
        'Com mais de 4, vira duas colunas',
        'Sempre com ✓ teal',
        'Feche conectando com a missão',
        'E com a próxima aula',
      ],
      kolb: ['reflective'],
      notes: 'Layout RECAP: consolidação.',
    },
    {
      type: 'closing',
      message: 'Mensagem curta de fechamento e incentivo.',
      nextClass: 'Título da próxima aula aqui',
      notes: 'Layout CLOSING (noturno): parabéns + chip da próxima aula.',
    },
  ],
}

// ---------------------------------------------------------------- TEMPLATE V2
// Mesmo conteúdo de amostra, com FOTOS reais da biblioteca commitada — sem foto
// as variantes A/B cairiam na variante sem-foto e o exemplar não mostraria o que
// precisa mostrar.
const FOTO_CAPA = 'm5/suitcase-window.jpg'
const FOTO_CENA = 'm5/rails-dusk.jpg'
// A divisória usa foto GENÉRICA de luz normal (spec §6 regra 6 e §7-bis defeito
// 5): cena de módulo com grading na divisória é proibida — foi o que produziu a
// escada rolante em roxo/teal neon reprovada pelo dono.
const FOTO_SECAO = 'shared/practice-time.jpg'
const FOTO_TIP = 'vocab/transport-card.jpg'

/**
 * A divisória do v2 é de PAPEL (Fase 0b, defeito 5), então a AMOSTRA do v2
 * troca o subtítulo herdado do v1 ("noturna") — o exemplar do v1 fica intacto,
 * que é o que o achado 17 exige.
 */
const SUB_SECAO_V2 = 'Agora é a sua vez — listening, speaking e writing'

const slideDo = (type: SlideSpec['type']): SlideSpec => {
  const found = TEMPLATE_DOC.slides.find((s) => s.type === type)
  if (!found) throw new Error(`o template do v1 não tem exemplar de ${type}`)
  return found
}

/** amostra do v2: o layout do v1 + a foto que a variante precisa */
const comFoto = (type: SlideSpec['type']): SlideSpec => {
  const s = slideDo(type)
  if (s.type === 'cover') return { ...s, image: { file: FOTO_CAPA } }
  if (s.type === 'warmup') return { ...s, image: { file: FOTO_CENA } }
  if (s.type === 'tip') return { ...s, image: { file: FOTO_TIP } }
  if (s.type === 'section') {
    return {
      ...s,
      subtitle: SUB_SECAO_V2,
      image: { file: FOTO_SECAO },
      notes:
        'Layout SECTION: divisória de bloco. É slide de PAPEL: título na faixa de cabeçalho, foto genérica de shared/ na coluna da câmera, sem véu.',
    }
  }
  if (s.type === 'vocab') {
    return {
      ...s,
      cards: s.cards.map((c, i) =>
        i < 3 ? { ...c, image: ['vocab/bus.jpg', 'vocab/subway.jpg', 'vocab/train.jpg'][i] } : c,
      ),
    }
  }
  return s
}

// o exemplar do v2 é validado pelo contrato do v2 (Fase 0d, item 19): é aqui
// que os tetos de `LEN` têm de valer, não no v1 em produção
const V2_DOC: LessonDoc = LessonSchemaV2.parse({
  ...TEMPLATE_DOC,
  lesson: {
    ...TEMPLATE_DOC.lesson,
    title: 'Template v2 — Personal Travel',
    subtitle: 'Um layout por tipo · facecam ampliada à direita · clima da PARTE 3',
  },
  slides: TEMPLATE_DOC.slides.map((s) => comFoto(s.type)),
})

/** monta o deck v2 de exemplares — um slide por layout */
function buildV2(doc: LessonDoc): PptxGenJS {
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_16x9'
  pres.author = 'Personal Teacher'
  pres.company = 'Personal Teacher'
  pres.title = doc.lesson.title
  defineMastersV2(pres, doc)
  for (const spec of doc.slides) renderSlideV2(pres, doc, spec)
  return pres
}

const outDir = join(process.cwd(), 'out', 'slides')
mkdirSync(outDir, { recursive: true })

const alvos: Array<{ file: string; pres: () => PptxGenJS; nota: string }> = [
  {
    file: 'Personal Travel — Template Oficial.pptx',
    pres: () => buildLesson(TEMPLATE_DOC),
    nota: `${TEMPLATE_DOC.slides.length} layouts (v1)`,
  },
  {
    file: 'Personal Travel v2 — Template Oficial.pptx',
    pres: () => buildV2(V2_DOC),
    nota: `${V2_DOC.slides.length} layouts (v2 — um por tipo)`,
  },
]

for (const alvo of alvos) {
  const caminho = join(outDir, alvo.file)
  packDeck(alvo.pres()).then((buf) => {
    writeFileSync(caminho, buf)
    console.log(`✓ ${caminho} — ${alvo.nota}`)
  })
}
