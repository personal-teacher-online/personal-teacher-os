// M0b do cronograma — FONTE ÚNICA dos textos do briefing do portal.
// Transcrição LITERAL (19/07/2026) do Form "Briefing – Personal Teacher" e do
// Doc (Módulo 0: mapa de rotina · Módulo 1: teste Kolb). Adaptações conscientes
// e mínimas: 2 menções a "viagem" viraram neutras (o material nasceu no
// Personal Travel; o briefing atende TODOS os alunos — ordem do mantenedor).
// O GABARITO do Kolb NÃO mora aqui: vive na função _briefing_submit do banco
// (migration 20260720000100) — a UI só coleta letras.

export const BRIEFING_INTRO =
  'Este briefing vai nos ajudar a entender melhor seus objetivos e como podemos te ajudar a alcançá-los, utilizando temas do seu interesse para elaborar um material personalizado e planejar aulas realmente eficazes e funcionais, para que você veja os resultados na prática em pouco tempo.'

export const HOBBIES = [
  'Assistir filmes/séries',
  'Jogar',
  'Praticar esportes/exercícios',
  'Escutar música',
  'Tocar instrumentos',
  'Cantar',
  'Escrever',
  'Ler',
  'Desenhar',
  'Pintar',
  'Fotografar',
  'Redes sociais',
  'Cozinhar',
  'Colecionar',
  'Costurar',
  'Fazer artesanato',
  'Viajar',
  'Voluntariado',
] as const
export const HOBBIES_MIN = 6

export const VIAGEM_OPCOES = [
  'Já realizei uma/mais de uma viagem internacional',
  'Planejo realizar uma viagem internacional em breve',
  'Nenhuma das alternativas',
] as const

export const INTERCAMBIO_OPCOES = [
  'Tenho interesse em fazer um intercâmbio',
  'Tenho interesse em fazer um teste de proficiência em inglês',
  'Nenhuma das alternativas',
] as const

export const ROTINA_BLOCOS = [
  'Manhã',
  'Almoço',
  'Tarde',
  'Noite',
  'Antes de dormir',
  'No transporte',
  'Academia / caminhada',
] as const
export const ROTINA_DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const

export const IMERSAO_OPCOES = [
  'Assistir 1 episódio ou parte de filme com áudio em inglês (legenda em português ou inglês)',
  'Ouvir músicas em inglês (legenda em inglês)',
  'Ver 1 vídeo curto ou entrevista no YouTube com áudio em inglês (legenda em português ou inglês)',
  'Seguir e/ou consumir conteúdo em inglês na internet (redes sociais, sites, blogs, artigos, livros, etc.)',
  'Mudar idioma do celular ou aplicativos para inglês',
] as const

export interface KolbQuestion {
  enunciado: string
  opcoes: { letra: 'A' | 'B' | 'C' | 'D'; texto: string }[]
}

export const KOLB_QUESTIONS: KolbQuestion[] = [
  {
    enunciado:
      'Quando você precisa aprender um conteúdo novo (por exemplo: "frases para imigração"), o que mais te ajuda a começar?',
    opcoes: [
      { letra: 'A', texto: 'Ver exemplos em contexto (vídeo/diálogo) e sentir como a situação acontece na vida real.' },
      { letra: 'B', texto: 'Observar com calma, comparar exemplos e perceber padrões antes de falar.' },
      { letra: 'C', texto: 'Entender a regra/estrutura por trás (como a frase é formada) para depois aplicar.' },
      { letra: 'D', texto: 'Testar na prática na hora: falar, errar, ajustar e repetir até sair natural.' },
    ],
  },
  {
    enunciado: 'Ao assistir a uma videoaula, você aprende melhor quando:',
    opcoes: [
      { letra: 'A', texto: 'Você anota o passo a passo e organiza um mini-resumo/roteiro.' },
      { letra: 'B', texto: 'Você pausa para pensar, refletir e ligar com experiências que já viveu.' },
      { letra: 'C', texto: 'Você já coloca em ação: repete em voz alta, faz shadowing e grava sua voz.' },
      { letra: 'D', texto: 'Você se conecta com o tema e imagina a cena real (hotel, aeroporto, restaurante).' },
    ],
  },
  {
    enunciado: 'Se você esquece palavras com facilidade, o que costuma funcionar melhor?',
    opcoes: [
      { letra: 'A', texto: 'Criar uma lista por temas (hotel, transporte) e construir frases que você realmente usaria.' },
      { letra: 'B', texto: 'Fazer revisão semanal, relendo e observando suas frases para perceber evolução.' },
      { letra: 'C', texto: 'Usar em uma conversa/roleplay, mesmo com erros, para fixar de verdade.' },
      { letra: 'D', texto: 'Associar com uma lembrança, imagem mental ou situação vivida/que você quer viver.' },
    ],
  },
  {
    enunciado: 'Você está treinando para pedir informação na rua. Qual treino te anima mais?',
    opcoes: [
      { letra: 'A', texto: 'Fazer um desafio: sair dizendo as frases em voz alta no espelho e depois usar em uma simulação rápida.' },
      { letra: 'B', texto: 'Ouvir um diálogo pronto e observar como as pessoas pedem e respondem, sem pressa.' },
      { letra: 'C', texto: 'Entender a estrutura das perguntas (Wh- questions) e montar um modelo para reutilizar.' },
      { letra: 'D', texto: 'Imaginar a situação real e criar frases que combinam com o seu estilo de falar.' },
    ],
  },
  {
    enunciado: 'Em uma aula ao vivo em grupo, você aprende mais quando:',
    opcoes: [
      { letra: 'A', texto: 'Você participa e testa frases na hora, mesmo que não fique perfeito.' },
      { letra: 'B', texto: 'Você escuta os colegas, percebe erros e acertos, e aprende observando.' },
      { letra: 'C', texto: 'Você entende o porquê das correções e quais padrões você deve seguir.' },
      { letra: 'D', texto: 'Você se envolve com as histórias/situações e sente que aquilo tem significado.' },
    ],
  },
  {
    enunciado: 'Quando vai fazer shadowing (imitar áudio de música/filme), você prefere:',
    opcoes: [
      { letra: 'A', texto: 'Só começar e repetir várias vezes, ajustando a pronúncia no caminho.' },
      { letra: 'B', texto: 'Ouvir algumas vezes primeiro e só depois repetir, percebendo ritmo e entonação.' },
      { letra: 'C', texto: 'Entender quais sons/ligação de palavras estão acontecendo (regras de pronúncia) antes de praticar.' },
      { letra: 'D', texto: 'Escolher cenas que te emocionam e te fazem entrar no clima da conversa.' },
    ],
  },
  {
    enunciado: 'Para planejar sua rotina de estudos, você se sente mais seguro(a) quando:',
    opcoes: [
      { letra: 'A', texto: 'Você tem um plano claro e organizado do que fazer em cada dia.' },
      { letra: 'B', texto: 'Você observa sua semana e ajusta aos poucos, sem rigidez.' },
      { letra: 'C', texto: 'Você já define mini-missões práticas (5-10 min) e vai riscando conforme faz.' },
      { letra: 'D', texto: 'Você conecta o estudo a um objetivo emocional (viajar sem medo, se sentir confiante).' },
    ],
  },
  {
    enunciado: 'Se você erra uma frase ao falar, sua reação mais natural é:',
    opcoes: [
      { letra: 'A', texto: 'Tentar de novo imediatamente, de outro jeito, até funcionar.' },
      { letra: 'B', texto: 'Parar e pensar no que aconteceu para entender o erro.' },
      { letra: 'C', texto: 'Buscar a regra/explicação para saber como deveria ser.' },
      { letra: 'D', texto: 'Lembrar que faz parte, respirar e seguir a conversa sem travar.' },
    ],
  },
  {
    enunciado: 'Você está montando frases novas para praticar. O que mais te ajuda?',
    opcoes: [
      { letra: 'A', texto: 'Ter um modelo lógico (estrutura) e preencher com novas palavras.' },
      { letra: 'B', texto: 'Revisar suas frases e perceber quais soam mais naturais com o tempo.' },
      { letra: 'C', texto: 'Criar frases ligadas a experiências reais suas (o que você faz e o que quer viver).' },
      { letra: 'D', texto: 'Usar suas frases em voz alta e em diálogos, como se estivesse na situação real.' },
    ],
  },
  {
    enunciado: 'Ao estudar um tema (hotel, restaurante), o formato que mais te prende é:',
    opcoes: [
      { letra: 'A', texto: 'Estudo por situação real: check-in, pedir toalha extra, reclamar de barulho.' },
      { letra: 'B', texto: 'Um mapa/resumo estruturado com padrões e exemplos curtos.' },
      { letra: 'C', texto: 'Exemplos + tempo para observar e comparar antes de produzir.' },
      { letra: 'D', texto: 'Atividades práticas rápidas: roleplay, desafio de 1 minuto, gravação.' },
    ],
  },
  {
    enunciado: 'Depois de uma semana estudando, você sente que aprendeu de verdade quando:',
    opcoes: [
      { letra: 'A', texto: 'Você consegue explicar a lógica do que aprendeu e ver os padrões.' },
      { letra: 'B', texto: 'Você lembra das situações/experiências e entende o sentido sem traduzir.' },
      { letra: 'C', texto: 'Você percebe que está mais rápido(a) e mais confortável falando na prática.' },
      { letra: 'D', texto: 'Você consegue olhar para trás e notar a evolução com calma (o que melhorou).' },
    ],
  },
  {
    enunciado: 'Se você tivesse que escolher UMA estratégia principal para acelerar seu inglês, você escolheria:',
    opcoes: [
      { letra: 'A', texto: 'Mais prática em situações reais: repetir, simular, gravar e corrigir.' },
      { letra: 'B', texto: 'Mais organização: plano, estrutura, padrões, mapas mentais.' },
      { letra: 'C', texto: 'Mais observação: ouvir/assistir, comparar exemplos e refletir.' },
      { letra: 'D', texto: 'Mais conexão: histórias, contexto e motivação ligada aos seus objetivos.' },
    ],
  },
]

/** Rótulo humano + leitura de 1 linha por estilo (ficha/painel da professora). */
export const KOLB_STYLE_LABEL: Record<string, { nome: string; leitura: string }> = {
  divergente: {
    nome: 'Divergente',
    leitura: 'Aprende com exemplos, histórias e observação — valoriza contexto e significado.',
  },
  assimilador: {
    nome: 'Assimilador',
    leitura: 'Aprende com lógica, estrutura e reflexão — valoriza entender o porquê.',
  },
  convergente: {
    nome: 'Convergente',
    leitura: 'Aprende resolvendo e aplicando — valoriza objetivos claros e treino focado.',
  },
  acomodador: {
    nome: 'Acomodador',
    leitura: 'Aprende fazendo e vivendo — valoriza desafios, prática rápida e feedback.',
  },
}

export const BRIEFING_ETAPAS = [
  { n: 1, slug: 'historia', titulo: 'Sua história com o inglês' },
  { n: 2, slug: 'objetivos', titulo: 'Seus objetivos' },
  { n: 3, slug: 'interesses', titulo: 'Seus interesses' },
  { n: 4, slug: 'rotina', titulo: 'Sua rotina' },
  { n: 5, slug: 'kolb', titulo: 'Seu estilo de aprendizagem' },
  { n: 6, slug: 'livre', titulo: 'Para fechar' },
] as const

/* ==========================================================================
 * BRIEFING v2 (spec aprovada em docs/goals/briefing-v2.md, 28/07/2026)
 * ========================================================================== */

export type VersaoBriefing = 1 | 2
export type TipoAluno = 'child' | 'adult'
export type SecaoBriefing = 'historia' | 'objetivos' | 'interesses' | 'rotina' | 'livre'
/** 'ambos' = a pergunta vale para criança E adulto (ou é de uma seção que não ramifica). */
export type RamoBriefing = TipoAluno | 'ambos'

// --- listas de opções novas do v2 ------------------------------------------
// Padrão do v1 mantido: o que fica gravado no jsonb é o RÓTULO literal (não um
// código), porque quem lê a resposta é gente — a professora na ficha e o prompt
// do plano de estudos.

export const CONTATO_OPCOES = [
  'Aulas particulares',
  'Escola / curso em grupo',
  'Intercâmbio',
  'Morei fora do país',
  'Estudei por conta própria',
  'Nunca estudei antes',
] as const

/**
 * Rótulo LITERAL da finalidade profissional. A régua mora no BANCO — é a função
 * `briefing_v2_finalidade_profissional()` que decide quando os tópicos
 * profissionais passam a ser obrigatórios (Lei 3). Esta constante ESPELHA o
 * texto de lá; `tests/briefing-dicionario.test.ts` compara os dois e fica
 * vermelho se alguém mexer só em um.
 */
export const FINALIDADE_PROFISSIONAL = 'Trabalho / carreira'

export const FINALIDADES_OPCOES = [
  FINALIDADE_PROFISSIONAL,
  'Viagens',
  'Imigração',
  'Entender filmes e séries',
  'Amizades e conversas do dia a dia',
] as const

export const ONDE_TRAVA_OPCOES = [
  'Falar',
  'Entender de ouvido',
  'Ler',
  'Escrever',
  'Gramática',
  'Vocabulário',
] as const

export const CORRECAO_OPCOES = [
  'Na hora, sempre',
  'No fim da fala',
  'Só nos erros que travam a comunicação',
] as const

export const TEMPO_DIARIO_OPCOES = ['5 min/dia', '10 min/dia', '20 min/dia', '30+ min/dia'] as const

export const PARA_QUE_INGLES_OPCOES = [
  'Escola / provas',
  'Viagens em família',
  'Jogos e vídeos',
  'Futuro (faculdade, carreira)',
] as const

/** As três perguntas de interesse do v2 são sim-não + detalhe quando "sim". */
export const SIM_NAO = ['sim', 'não'] as const

/** Quantos campos curtos de tópico profissional a tela oferece (o banco exige 3). */
export const TOPICOS_PROFISSIONAIS_CAMPOS = 6
export const TOPICOS_PROFISSIONAIS_MIN = 3

// --- o dicionário ----------------------------------------------------------

export interface EntradaDoDicionario {
  /** Nome da chave DENTRO da seção, como fica gravado no jsonb de `answers`. */
  chave: string
  /** A pergunta por extenso — é isto que a tela mostra e a ficha lê de volta. */
  enunciado: string
  secao: SecaoBriefing
  ramo: RamoBriefing
  /** Primeira versão do questionário em que a pergunta existe. */
  desde: VersaoBriefing
  /** Última versão em que existe (ausente = ainda vale). */
  ate?: 1
  /**
   * v2: o BANCO recusa o envio sem esta resposta (`_briefing_validate_v2`).
   * Espelho, não fonte — o teste de drift prova chave a chave que o banco
   * concorda. Obrigatoriedade CONDICIONAL (tópicos profissionais só quando a
   * finalidade de trabalho está marcada; detalhe só quando a resposta é "sim")
   * NÃO entra aqui: a condição vive no banco e a tela só a antecipa.
   */
  obrigatoria?: boolean
}

/**
 * FONTE ÚNICA de "que pergunta é essa chave" — v1 e v2 no mesmo lugar. A tela do
 * portal renderiza iterando por aqui (nenhum enunciado v2 é escrito no JSX) e a
 * retaguarda/ficha lê o enunciado de volta a partir da chave crua do jsonb.
 *
 * A CHAVE DO RECORD é o nome da chave na seção (não há colisão entre seções).
 * Exceção declarada: seis perguntas do v1 foram REESCRITAS no v2 reaproveitando
 * o mesmo nome de chave (`contato`, `finalidades`, `topicos_profissionais`,
 * `leitura`, `filmes_series`, `musicas` — de texto livre para múltipla escolha
 * ou sim-não). Como um Record não guarda duas entradas no mesmo nome, a variante
 * aposentada mora sob `<chave>@v1` e carrega `chave` + `ate: 1`. Quem procura
 * por chave usa `entradaDaChave(chave, versao)`, que resolve isso.
 */
export const DICIONARIO_BRIEFING: Record<string, EntradaDoDicionario> = {
  // ----------------------------------------------------- etapa 1 · história
  cidade_vida: {
    chave: 'cidade_vida',
    enunciado: 'Em que cidade passou a maior parte da sua vida?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 1,
    obrigatoria: true,
  },
  facil_dificil: {
    chave: 'facil_dificil',
    enunciado: 'O que você acha mais fácil na língua inglesa? E qual é a sua maior dificuldade?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  facil: {
    chave: 'facil',
    enunciado: 'O que é mais FÁCIL para você na língua inglesa?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  dificil: {
    chave: 'dificil',
    enunciado: 'E qual é a sua maior DIFICULDADE no inglês?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  'contato@v1': {
    chave: 'contato',
    enunciado:
      'Conte como foi seu contato com o inglês até hoje. Já fez aulas particulares ou em grupo antes? Já fez intercâmbio ou morou fora? Teve alguma experiência marcante com o idioma?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  contato: {
    chave: 'contato',
    enunciado: 'Como foi seu contato com o inglês até hoje? (marque tudo o que já aconteceu)',
    secao: 'historia',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  experiencia_marcante: {
    chave: 'experiencia_marcante',
    enunciado: 'Teve alguma experiência marcante com o idioma?',
    secao: 'historia',
    ramo: 'ambos',
    desde: 2,
  },

  // ---------------------------------------------------- etapa 2 · objetivos
  'finalidades@v1': {
    chave: 'finalidades',
    enunciado:
      'Para quais finalidades você quer praticar a conversação? (ex.: trabalho, viagens, imigração, entender filmes/séries, amizades, etc.)',
    secao: 'objetivos',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  finalidades: {
    chave: 'finalidades',
    enunciado: 'Para quais finalidades você quer praticar a conversação? (marque quantas quiser)',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  finalidade_principal: {
    chave: 'finalidade_principal',
    enunciado: 'Dessas, qual é a MAIS importante para você?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  'topicos_profissionais@v1': {
    chave: 'topicos_profissionais',
    enunciado:
      'Descreva pelo menos 6 tópicos de sua vida profissional para os quais você precisa aprender vocabulário em inglês. (ex: reuniões, emails, apresentações, atendimento ao cliente, conferências, etc.)',
    secao: 'objetivos',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  topicos_profissionais: {
    chave: 'topicos_profissionais',
    enunciado:
      'Tópicos da sua vida profissional para os quais você precisa de vocabulário em inglês (ex.: reuniões, e-mails, apresentações)',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
  },
  alvo_6_meses: {
    chave: 'alvo_6_meses',
    enunciado: 'Daqui a 6 meses, o que você quer conseguir FAZER em inglês?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  onde_trava: {
    chave: 'onde_trava',
    enunciado: 'Onde você mais trava hoje? (marque quantos quiser)',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  correcao_preferida: {
    chave: 'correcao_preferida',
    enunciado: 'Como você prefere ser corrigido(a) durante a aula?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  tempo_diario: {
    chave: 'tempo_diario',
    enunciado: 'Quanto tempo por dia você tem para estudar inglês?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 2,
    obrigatoria: true,
  },
  viagem: {
    chave: 'viagem',
    enunciado: 'Você já realizou alguma viagem internacional e/ou planeja realizar em breve?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 1,
  },
  intercambio: {
    chave: 'intercambio',
    enunciado: 'Você tem interesse em fazer um intercâmbio ou teste de proficiência em inglês?',
    secao: 'objetivos',
    ramo: 'adult',
    desde: 1,
  },
  para_que_ingles: {
    chave: 'para_que_ingles',
    enunciado: 'Para que o inglês vai servir na vida dele(a)? (marque quantos quiser)',
    secao: 'objetivos',
    ramo: 'child',
    desde: 2,
    obrigatoria: true,
  },
  temas_escola: {
    chave: 'temas_escola',
    enunciado: 'Quais são os temas favoritos dele(a) na escola?',
    secao: 'objetivos',
    ramo: 'child',
    desde: 2,
    obrigatoria: true,
  },
  favoritos_midia: {
    chave: 'favoritos_midia',
    enunciado: 'Quais são os desenhos, jogos ou youtubers favoritos dele(a)?',
    secao: 'objetivos',
    ramo: 'child',
    desde: 2,
    obrigatoria: true,
  },
  quem_acompanha: {
    chave: 'quem_acompanha',
    enunciado: 'Quem acompanha as tarefas em casa?',
    secao: 'objetivos',
    ramo: 'child',
    desde: 2,
    obrigatoria: true,
  },
  temperamento: {
    chave: 'temperamento',
    enunciado: 'Como ele(a) é com pessoas novas?',
    secao: 'objetivos',
    ramo: 'child',
    desde: 2,
    obrigatoria: true,
  },

  // --------------------------------------------------- etapa 3 · interesses
  hobbies: {
    chave: 'hobbies',
    enunciado: `Escolha pelo menos ${HOBBIES_MIN} coisas que você gosta de fazer em seu tempo livre`,
    secao: 'interesses',
    ramo: 'ambos',
    desde: 1,
    obrigatoria: true,
  },
  'leitura@v1': {
    chave: 'leitura',
    enunciado: 'Você gosta de ler? Quais são os seus autores/blogs/sites favoritos?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  leitura: {
    chave: 'leitura',
    enunciado: 'Você gosta de ler?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  leitura_detalhe: {
    chave: 'leitura_detalhe',
    enunciado: 'Se sim, quais autores, blogs ou sites?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
  },
  'filmes_series@v1': {
    chave: 'filmes_series',
    enunciado: 'Você prefere filmes ou séries? De quais gêneros você mais gosta?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  filmes_series: {
    chave: 'filmes_series',
    enunciado: 'Você gosta de filmes e séries?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  filmes_series_detalhe: {
    chave: 'filmes_series_detalhe',
    enunciado: 'Se sim, de quais gêneros?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
  },
  'musicas@v1': {
    chave: 'musicas',
    enunciado: 'Você gosta de músicas em inglês?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 1,
    ate: 1,
  },
  musicas: {
    chave: 'musicas',
    enunciado: 'Você gosta de músicas em inglês?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
    obrigatoria: true,
  },
  musicas_detalhe: {
    chave: 'musicas_detalhe',
    enunciado: 'Se sim, quais artistas ou estilos?',
    secao: 'interesses',
    ramo: 'ambos',
    desde: 2,
  },

  // ------------------------------------------------------- etapa 4 · rotina
  blocos: {
    chave: 'blocos',
    enunciado: 'Em quais momentos da semana você costuma ter um tempo para o inglês?',
    secao: 'rotina',
    ramo: 'ambos',
    desde: 1,
    obrigatoria: true,
  },
  imersao: {
    chave: 'imersao',
    enunciado: 'Qual imersão semanal combina mais com você?',
    secao: 'rotina',
    ramo: 'ambos',
    desde: 1,
    obrigatoria: true,
  },

  // ------------------------------------------------- etapa 6 · para fechar
  obs: {
    chave: 'obs',
    enunciado: 'Se tiver alguma dúvida ou quiser acrescentar algo especial, é só contar aqui embaixo',
    secao: 'livre',
    ramo: 'ambos',
    desde: 1,
  },
  apoio: {
    chave: 'apoio',
    enunciado:
      'Tem algo que devemos saber para as aulas renderem mais? (ex.: TDAH, dislexia, ansiedade, preferências de ritmo)',
    secao: 'livre',
    ramo: 'ambos',
    desde: 2,
  },
}

/** A entrada vale para esta versão do questionário? */
function valeNaVersao(e: EntradaDoDicionario, versao: VersaoBriefing): boolean {
  return e.desde <= versao && (e.ate === undefined || e.ate >= versao)
}

/**
 * As perguntas de uma seção, na ordem do dicionário, já filtradas pela versão da
 * LINHA e pelo ramo do aluno. No v1 o questionário não ramifica (era um só para
 * todo mundo), então o ramo é ignorado — filtrar por ele esconderia pergunta que
 * a pessoa de fato respondeu.
 */
export function entradasDaSecao(
  secao: SecaoBriefing,
  ramo: RamoBriefing,
  versao: VersaoBriefing,
): EntradaDoDicionario[] {
  return Object.values(DICIONARIO_BRIEFING).filter(
    (e) =>
      e.secao === secao &&
      valeNaVersao(e, versao) &&
      (versao === 1 || ramo === 'ambos' || e.ramo === 'ambos' || e.ramo === ramo),
  )
}

/** A entrada de uma chave crua do jsonb, na versão da linha (v1 e v2 num caminho só). */
export function entradaDaChave(
  chave: string,
  versao: VersaoBriefing,
): EntradaDoDicionario | undefined {
  const aposentada = DICIONARIO_BRIEFING[`${chave}@v1`]
  if (aposentada && valeNaVersao(aposentada, versao)) return aposentada
  const atual = DICIONARIO_BRIEFING[chave]
  return atual && valeNaVersao(atual, versao) ? atual : undefined
}

/** O enunciado por extenso — cai na própria chave quando ela não está no dicionário. */
export function enunciadoDaChave(chave: string, versao: VersaoBriefing): string {
  return entradaDaChave(chave, versao)?.enunciado ?? chave
}

/**
 * As chaves que o BANCO cobra na seção, para este ramo (v2). Usada pela tela para
 * marcar a etapa como feita e para antecipar o erro — nunca para substituir a
 * validação, que é do Postgres (Lei 3).
 */
export function chavesObrigatorias(secao: SecaoBriefing, ramo: TipoAluno): string[] {
  return entradasDaSecao(secao, ramo, 2)
    .filter((e) => e.obrigatoria)
    .map((e) => e.chave)
}

/**
 * Os pares chave→valor de uma seção que o DICIONÁRIO reconhece naquela versão,
 * na ordem do dicionário e só os respondidos.
 *
 * Existe para os dois lugares em que o jsonb cru não serve: o input do prompt do
 * plano de estudos (que precisa de chaves estáveis e nomeadas — espalhar
 * `...answers` mandava para a IA o que estivesse lá, com o nome que estivesse) e
 * o pré-preenchimento do re-briefing semestral a partir do briefing efetivo
 * anterior (que pode ser de um aluno v1: as chaves v1 não existem no formulário
 * v2, então elas ficam de fora e o campo nasce em branco).
 *
 * O que o dicionário não conhece NÃO entra: a régua de quem quiser acrescentar
 * pergunta é acrescentar a entrada — a mesma disciplina de drift do resto do
 * lote. Para LER resposta desconhecida (a ficha da admin) o caminho é outro:
 * `paresDaSecao`, em lib/briefing/leitura.ts, que nunca esconde nada.
 *
 * DUAS VERSÕES, UMA PASSADA (revisão de integração, médio 1): a chave é
 * procurada na versão pedida e, se não existir lá, na v1. Um jsonb HÍBRIDO —
 * possível por dado legado, por correção antiga ou por migração pela metade —
 * tinha as chaves aposentadas (`facil_dificil`) descartadas em silêncio do input
 * da IA justamente quando elas eram a única resposta que o aluno deu. Chave
 * conhecida em QUALQUER versão do dicionário entra; a ordem continua a do
 * dicionário, com a versão pedida na frente.
 */
export function paresConhecidos(
  secao: SecaoBriefing,
  valores: unknown,
  versao: VersaoBriefing,
): Record<string, unknown> {
  const v = (valores && typeof valores === 'object' ? valores : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const vistas = new Set<string>()
  // ramo 'ambos' = sem filtro de ramo: as respostas gravadas já são as do ramo
  // que a pessoa respondeu, e esconder pergunta de criança de um aluno criança
  // seria o oposto do que se quer.
  const versoes: VersaoBriefing[] = versao === 1 ? [1] : [versao, 1]
  for (const ver of versoes) {
    for (const e of entradasDaSecao(secao, 'ambos', ver)) {
      if (vistas.has(e.chave)) continue
      vistas.add(e.chave)
      if (respondido(v[e.chave])) out[e.chave] = v[e.chave]
    }
  }
  return out
}

/** Alguém escreveu alguma coisa aqui? (mesma pergunta que o banco faz, em TS.) */
export function respondido(valor: unknown): boolean {
  if (typeof valor === 'string') return valor.replace(/\s/g, '') !== ''
  if (Array.isArray(valor)) return valor.some(respondido)
  if (valor && typeof valor === 'object') return Object.values(valor).some(respondido)
  return false
}
