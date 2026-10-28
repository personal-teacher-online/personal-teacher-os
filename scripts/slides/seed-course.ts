// FS-M4 — semeia as aulas de M6–M12 na Fábrica de Slides a partir da planilha
// da Teacher Vicky (docs/research/personal-travel-contents.pdf, extraída 21/07) + a
// escada gramatical aprovada (docs/goals/slides-personal-travel.md).
// Idempotente: ON CONFLICT (course, module, lesson) DO NOTHING — rodar de novo
// nunca duplica nem sobrescreve revisões. O content inicial carrega level,
// grammarFocus e seedNotes (diretrizes que o "✨ Rascunhar com IA" usa como
// contexto e substitui pelo LessonDoc completo).
// Uso: node --env-file=.env.local scripts/slides/seed-course.ts  (DATABASE_URL opcional)
import postgres from 'postgres'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

type SeedLesson = { lesson: number; title: string; notes: string }
type SeedModule = { module: number; theme: string; level: string; grammar: string[]; lessons: SeedLesson[] }

const MODULES: SeedModule[] = [
  {
    module: 6,
    theme: 'Time to Eat & Drink',
    level: 'A1',
    grammar: ['countable/uncountable, some/any, how much/many', 'eat/drink/have + likes/dislikes + demonstrativos'],
    lessons: [
      { lesson: 1, title: 'Menu Sem Segredos: Vocabulário Essencial e Atual', notes: 'Palavras-chave do cardápio; comida/bebida do dia a dia da viagem.' },
      { lesson: 2, title: 'Estruturas Práticas para Pedir Comida Sem Pensar Demais', notes: 'Menu por partes, tipos de comida e restaurantes; frases prontas de pedido.' },
      { lesson: 3, title: 'Problemas no Restaurante? Resolva com Educação e Segurança', notes: 'Possíveis situações: pedido errado, conta, alergia; reclamar com educação.' },
      { lesson: 4, title: 'Diálogos Reais: Do Pedido à Conta Sem Travar', notes: 'Listening comprehension: diálogo completo do pedido à conta.' },
      { lesson: 5, title: 'Mission 6: Menu Sem Mistérios', notes: 'Mission (slides mission): estudo de menu real + sites de avaliações; IA indica restaurantes.' },
    ],
  },
  {
    module: 7,
    theme: 'Time to Shop',
    level: 'A1',
    grammar: ['demonstrativos, comparativos/superlativos, too/enough', 'main verbs e expressões + números'],
    lessons: [
      { lesson: 1, title: 'Supermercado Sem Medo: Vocabulário da Vida Real', notes: 'Vocabulário + chunks para frases com modais no supermercado.' },
      { lesson: 2, title: 'Shopping no Exterior: Tamanhos, Provadores e Atendimento', notes: 'Vocabulário + chunks com modais; tamanhos e provador.' },
      { lesson: 3, title: 'Trocas, Devoluções e Reclamações Sem Constrangimento', notes: 'Tip da planilha: em muitos países devolve-se e recebe-se o dinheiro de volta.' },
      { lesson: 4, title: 'Diálogos Reais de Compra: Na Prática, no Seu Ritmo', notes: 'Listening comprehension de compra completa.' },
      { lesson: 5, title: 'Mission 7: Guia de Compras Inteligentes', notes: 'Mission: estudar lojas do destino + vocabulário real.' },
    ],
  },
  {
    module: 8,
    theme: 'Making Friends and Networking',
    level: 'A1',
    grammar: ['subject pronouns + possessive adjectives', 'família, frequência e hobbies'],
    lessons: [
      { lesson: 1, title: 'Small Talk Sem Medo: Como Puxar Conversa em Qualquer Lugar', notes: 'Puxar conversa em pontos turísticos; aberturas seguras.' },
      { lesson: 2, title: 'Como Fazer Conexões com Pessoas do Mundo Todo', notes: 'Apresentar-se, de onde vem, o que faz; trocar contatos.' },
      { lesson: 3, title: 'Assuntos que Conectam: Hobbies, Cultura e Conversas Naturais', notes: 'Hobbies, cultura, gostos; frequência (always/sometimes).' },
      { lesson: 4, title: 'Diálogos Reais de Socialização: Do Oi à Amizade Internacional', notes: 'Listening comprehension de socialização.' },
      { lesson: 5, title: 'Mission 8: Perfil Internacional', notes: 'Mission: briefing das áreas da vida que viram assunto — adaptar com as infos da aluna.' },
    ],
  },
  {
    module: 9,
    theme: 'Speaking Fluently',
    level: 'A2',
    grammar: ['fillers e ganho de tempo', 'review das estruturas; pronúncia, ritmo e entonação'],
    lessons: [
      { lesson: 1, title: 'Nunca Mais Trave: Técnicas para Ganhar Tempo e Naturalidade', notes: 'Fillers (well, let me see…), estratégias anti-trava.' },
      { lesson: 2, title: 'Estruturas Essenciais que Mantêm Qualquer Conversa Viva', notes: 'Review das estruturas do curso aplicadas em conversa.' },
      { lesson: 3, title: 'Pronúncia, Ritmo e Entonação: Como Soar Mais Natural', notes: 'Alphabet pronunciation, ritmo e entonação.' },
      { lesson: 4, title: 'Fluência Instantânea: Mais de 100 Chunks que Mudam Tudo', notes: 'Os 123 chunks de alta frequência do curso (PDF da Mission 9).' },
      { lesson: 5, title: 'Mission 9: Diálogos Imediatos', notes: 'Mission: PDF de chunks; diálogos de resposta imediata.' },
    ],
  },
  {
    module: 10,
    theme: 'Emergencies and Health Care',
    level: 'A2',
    grammar: ['should/must (conselho/obrigação)', 'descrever sintomas; pedir ajuda'],
    lessons: [
      { lesson: 1, title: 'Vocabulário Médico Essencial Para Você e Sua Família', notes: 'Corpo, sintomas, farmácia; família.' },
      { lesson: 2, title: 'Como Falar em Emergências: Ambulância, Polícia e Hospital', notes: 'Números de emergência internacionais; frases vitais.' },
      { lesson: 3, title: 'Seguro Viagem: Como Usar e o Que Falar', notes: 'Como acionar o seguro; o que dizer.' },
      { lesson: 4, title: 'Diálogos Vitais: Descrevendo Sintomas em Inglês', notes: 'Listening comprehension: consulta/atendimento.' },
      { lesson: 5, title: 'Mission 10: Plano de Segurança da Viagem', notes: 'Mission: checklist de seguro, números, doenças e intolerâncias.' },
    ],
  },
  {
    module: 11,
    theme: 'Unexpected Situations & Solutions',
    level: 'A2',
    grammar: ['past simple funcional (o que aconteceu)', 'going to/will para replanejar'],
    lessons: [
      { lesson: 1, title: 'Cancelamentos e Remarcações Sem Pânico', notes: 'Voo/reserva cancelados; remarcar com calma.' },
      { lesson: 2, title: 'Perdi Documentos: O Que Falar e Como Resolver', notes: 'Documentos perdidos: consulado, boletim, frases prontas.' },
      { lesson: 3, title: 'Fraudes, Golpes e Situações de Risco: Como Se Defender', notes: 'Golpes comuns com turistas; como recusar e se defender.' },
      { lesson: 4, title: 'Diálogos Reais de Imprevistos: Treine Antes de Precisar', notes: 'Listening comprehension de imprevistos.' },
      { lesson: 5, title: 'Mission 11: Plano B (e C!) da Viagem', notes: 'Mission: checklist + preparação emocional.' },
    ],
  },
  {
    module: 12,
    theme: 'Your Full Journey — Final Simulation',
    level: 'A2',
    grammar: ['revisão geral aplicada em simulação'],
    lessons: [
      { lesson: 1, title: 'Simulação Total 1: Aeroporto, Imigração e Check-in de Hotel', notes: 'Role-play integrando M2–M4.' },
      { lesson: 2, title: 'Simulação Total 2: Transporte, Restaurante e Compras no Exterior', notes: 'Role-play integrando M5–M7.' },
      { lesson: 3, title: 'Simulação Total 3: Socialização, Emergências e Imprevistos', notes: 'Role-play integrando M8–M11.' },
      { lesson: 4, title: 'Avaliação Final: Sua Conversação 100% Destravada', notes: 'Avaliação de conversação completa.' },
      { lesson: 5, title: 'Final Mission: Sua Viagem dos Sonhos', notes: 'Mission final: role-play + checklist da viagem dos sonhos.' },
    ],
  },
]

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })
let inserted = 0
for (const mod of MODULES) {
  for (const l of mod.lessons) {
    const content = {
      level: mod.level,
      grammarFocus: mod.grammar,
      seedNotes: `Módulo ${mod.module} — ${mod.theme}. ${l.notes}`,
    }
    const rows = await sql`
      insert into slide_lessons (course, module, lesson, title, content)
      values ('personal-travel', ${mod.module}, ${l.lesson}, ${l.title}, ${sql.json(content)})
      on conflict (course, module, lesson) do nothing
      returning id`
    inserted += rows.length
  }
}
const [{ count }] = await sql`
  select count(*)::int as count from slide_lessons where course = 'personal-travel'`
console.log(`✓ seed: ${inserted} aulas novas; total personal-travel no banco: ${count}`)
await sql.end()
