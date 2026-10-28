/**
 * Liga a biblioteca curada de fotos ao conteudo das aulas (Lei 11: a foto é
 * decorativa/de conteudo; o texto e SEMPRE do Slides).
 *
 * Regras (docs/goals/slides-personal-travel.md):
 *  - cover / warmup / section / tip / dialogue-sem-glossario recebem uma cena
 *    do modulo (brand/slides/library/m<N>/).
 *  - cards de vocab recebem foto so quando o termo e CONCRETO; e a linha de
 *    cima do grid inteira, nunca cards alternados (padrao do M5).
 *
 *   npx tsx scripts/slides/wire-images.ts out/estrutural/6-1-final.json
 *   npx tsx scripts/slides/wire-images.ts --todos
 *
 * ⚠️ ESTE SCRIPT É DO v1 E NÃO SABE DO v2. Os mapas `CENAS`/`VOCAB` abaixo
 * cobrem M5 e M6 do lote estrutural de julho, e a divisória usa um `PRACTICE`
 * CRAVADO, igual para o curso inteiro. O curso v2 (`content/personal-travel-v2/`)
 * é o oposto disso: cada aula tem a SUA divisória (`m5/practice-a1.jpg`,
 * `m7/practice-a3.jpg` …) — 48 fotos únicas, uma por aula, geradas e conferidas
 * uma a uma. Rodar este script sobre conteúdo v2 trocaria as 48 pela mesma
 * `shared/practice-time.jpg` **em silêncio**, e o defeito só apareceria no deck.
 *
 * A trava: **foto já declarada no conteúdo nunca é sobrescrita.** Este script
 * só PREENCHE endereço ausente; o que já existe é contado em `preservadas` e
 * aparece no log. Quem quiser mesmo trocar uma foto declarada edita o JSON —
 * é decisão de conteúdo, não efeito colateral de um utilitário de fiação.
 */
import fs from 'node:fs'
import path from 'node:path'
import { LessonSchema, type LessonDoc, type SlideSpec } from '../../src/lib/slides/lesson-schema.ts'
import { pastaDeMarca } from '../../src/lib/pastas.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const LIB = path.join(pastaDeMarca(raiz), 'slides', 'library')

/** termo do vocabulario → arquivo na biblioteca compartilhada */
const VOCAB: Record<string, string> = {
  // M6 — comida e bebida
  chicken: 'vocab/chicken.jpg',
  rice: 'vocab/rice.jpg',
  salad: 'vocab/salad.jpg',
  soup: 'vocab/soup.jpg',
  bread: 'vocab/bread.jpg',
  water: 'vocab/water.jpg',
  juice: 'vocab/juice.jpg',
  coffee: 'vocab/coffee.jpg',
  starter: 'vocab/starter.jpg',
  appetizer: 'vocab/starter.jpg',
  'main course': 'vocab/main-course.jpg',
  dessert: 'vocab/dessert.jpg',
  'side dish': 'vocab/side-dish.jpg',
  // M5 — transporte (biblioteca ja existente)
  bus: 'vocab/bus.jpg',
  subway: 'vocab/subway.jpg',
  underground: 'vocab/underground.jpg',
  train: 'vocab/train.jpg',
  tram: 'vocab/tram.jpg',
  taxi: 'vocab/taxi.jpg',
  ferry: 'vocab/ferry.jpg',
  'on foot': 'vocab/on-foot.jpg',
  ticket: 'vocab/ticket.jpg',
  'ticket machine': 'vocab/ticket-machine.jpg',
  platform: 'vocab/platform.jpg',
  'transport card': 'vocab/transport-card.jpg',
}

/**
 * A divisória PRACTICE TIME é a mesma em todo o curso: uma foto colorida e
 * genérica de alguém praticando. Antes cada módulo escolhia uma cena sua —
 * no M5 saiu uma escada rolante em roxo/teal neon, resultado da regra (hoje
 * revogada) que permitia a paleta da marca DENTRO da foto. A marca já está no
 * slide (fundo noturno, fio, tipografia); dentro da imagem, luz natural.
 */
const PRACTICE = 'shared/practice-time.jpg'

/** cenas por aula: [cover, warmup, section, tip] — null = sem foto */
const CENAS: Record<string, Array<string | null>> = {
  '5-1': ['m5/suitcase-window.jpg', 'm5/rails-dusk.jpg', 'm5/escalator.jpg', 'm5/city-map.jpg'],
  '5-2': ['m5/street-signs.jpg', 'm5/phone-map.jpg', 'm5/exit-sign.jpg', 'm5/street-corner.jpg'],
  '5-3': ['m5/lost-tourist.jpg', 'm5/asking-directions.jpg', 'm5/info-desk.jpg', 'm5/city-map.jpg'],
  '5-4': ['m5/planning-flatlay.jpg', 'm5/bus-stop.jpg', 'm5/card-tap.jpg', 'm5/info-desk.jpg'],
  '5-5': ['m5/suitcase-window.jpg', null, null, 'm5/phone-map.jpg'],
  '6-1': ['m6/menu-reading.jpg', 'm6/cafe-counter.jpg', 'm6/waiter-order.jpg', 'm6/dinner-friends.jpg'],
  '6-2': ['m6/ordering-counter.jpg', 'm6/food-court.jpg', 'm6/waiter-order.jpg', 'm6/takeaway-bag.jpg'],
  '6-3': ['m6/wrong-dish.jpg', 'm6/allergy-talk.jpg', 'm6/dinner-friends.jpg', 'm6/allergy-talk.jpg'],
  '6-4': ['m6/paying-card.jpg', 'm6/waiter-order.jpg', 'm6/cafe-counter.jpg', 'm6/paying-card.jpg'],
  '6-5': ['m6/street-food-market.jpg', null, null, 'm6/menu-reading.jpg'],
}

/** tipos com campo `image` no contrato (lesson-schema.ts) */
const ACEITAM_FOTO = new Set<SlideSpec['type']>(['cover', 'warmup', 'dialogue', 'tip', 'section'])

const norm = (t: string): string =>
  t
    .toLowerCase()
    .replace(/\s*\/.*$/, '') // "starter / appetizer" → "starter"
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z ]/g, '')
    .trim()

export function wireImages(
  doc: LessonDoc,
  chave: string,
): { fotos: number; faltando: string[]; preservadas: string[] } {
  const cenas = CENAS[chave] ?? []
  const faltando: string[] = []
  const preservadas: string[] = []
  let fotos = 0
  const por: Record<string, string | null | undefined> = {
    cover: cenas[0],
    warmup: cenas[1],
    section: cenas[2] === null ? null : PRACTICE, // divisória: sempre a mesma
    tip: cenas[3],
  }

  for (const s of doc.slides as SlideSpec[]) {
    const arq = por[s.type]
    // Só estes tipos têm campo image no contrato (lesson-schema.ts). Testar
    // com `'image' in s` não serve: o rascunho da IA nasce SEM a chave.
    if (arq && ACEITAM_FOTO.has(s.type)) {
      // A TRAVA (ver cabeçalho): endereço já declarado é do conteúdo, não deste
      // script. Vale para todo tipo, mas quem a comprou foi a divisória: o
      // `PRACTICE` cravado trocaria as 48 practice-time únicas do v2 pela mesma
      // foto compartilhada, sem uma linha de log.
      const ja = (s as { image?: { file?: string } }).image?.file
      if (ja) preservadas.push(ja)
      else if (!fs.existsSync(path.join(LIB, arq))) faltando.push(arq)
      else {
        ;(s as { image?: { file: string } }).image = { file: arq }
        fotos++
      }
    }
    if (s.type !== 'vocab') continue
    // Linha de cima inteira com foto (padrao do M5): so aplica se TODOS os
    // termos da primeira linha (4 cards) tiverem foto na biblioteca.
    const linha = s.cards.slice(0, 4)
    const arquivos = linha.map((c) => VOCAB[norm(c.term)])
    if (arquivos.length < 4 || arquivos.some((a) => !a)) continue
    // Mesma trava, e aqui ela é tudo-ou-nada por LINHA: card com foto própria no
    // meio de cards refeitos é o slide visualmente quebrado que a regra do dono
    // proíbe. Se a linha já tem foto declarada, a linha inteira fica como está.
    const jaTem = linha.filter((c) => c.image).map((c) => c.image as string)
    if (jaTem.length) {
      preservadas.push(...jaTem)
      continue
    }
    linha.forEach((c, i) => {
      const a = arquivos[i] as string
      if (!fs.existsSync(path.join(LIB, a))) faltando.push(a)
      else {
        c.image = a
        fotos++
      }
    })
  }
  return { fotos, faltando: [...new Set(faltando)], preservadas: [...new Set(preservadas)] }
}

const isCli = process.argv[1]?.endsWith('wire-images.ts')
if (isCli) {
  const alvos = process.argv.includes('--todos')
    ? Object.keys(CENAS).map((k) => `out/estrutural/${k}-final.json`)
    : process.argv.slice(2)
  for (const rel of alvos) {
    const f = path.join(raiz, rel)
    if (!fs.existsSync(f)) {
      console.log(`${rel} — nao existe`)
      continue
    }
    const chave = path.basename(rel).replace('-final.json', '')
    const doc = LessonSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8')))
    const { fotos, faltando, preservadas } = wireImages(doc, chave)
    LessonSchema.parse(doc) // o contrato tem de continuar valendo com as fotos
    fs.writeFileSync(f, JSON.stringify(doc, null, 2))
    console.log(
      `${chave}  ${fotos} foto(s)` +
        (preservadas.length ? `  ↷ ${preservadas.length} já declarada(s), mantida(s): ${preservadas.join(', ')}` : '') +
        (faltando.length ? `  ⚠ faltando: ${faltando.join(', ')}` : ''),
    )
  }
}
