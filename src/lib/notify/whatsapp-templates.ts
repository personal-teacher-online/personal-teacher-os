// TEMPLATES DE WHATSAPP PARA A CLOUD API (ADR-038, opção B · issues #41 e #115).
//
// Fora da janela de 24 h a Meta só entrega TEMPLATE aprovado: nome, idioma e
// parâmetros em ordem. Este módulo é a FONTE ÚNICA do texto de WhatsApp: o
// catálogo de Ajustes mostra o que está aqui, o gerador do JSON de submissão
// (`scripts/whatsapp-templates.ts` → `docs/whatsapp-templates.json`) lê
// daqui e o despachante também (`src/lib/outbox/whatsapp-do-aviso.ts`). O que a
// dona confere na tela é o que a Meta aprova e o que o aluno recebe.
//
// ── DE ONDE VEM CADA CORPO ──────────────────────────────────────────────────
// Do bloco "WhatsApp" de cada variante em `docs/goals/textos-revisao-2026-09.md`
// (M3-4), escrito aqui com as MESMAS `{chaves}` do documento, revisto pelas
// decisões do dono de 31/10/2026 na #115 (botões, prazo de remarcar no toque de
// 48 h, toque de 2 h sem "remarcar ou cancelar", "a escola moveu" como
// confirmação do combinado). O `{{n}}` que a Meta exige é derivado das chaves,
// na ordem em que aparecem; nada é digitado duas vezes.
// `tests/whatsapp-templates.test.ts` compara cada texto com o gerador do
// documento: palavra diferente é teste vermelho.
//
// ── POR QUE UMA VARIANTE VIRA UM TEMPLATE ───────────────────────────────────
// A Meta recusa parâmetro vazio ou com quebra de linha. Então a parte opcional
// (link da sala só quando existe, crédito só quando nasceu, HOJE ou AMANHÃ, o
// prazo de remarcar só enquanto ele está pela frente) não pode ser um parâmetro
// que some: cada caso é um template próprio.
//
// ── BOTÕES (#115) ───────────────────────────────────────────────────────────
// O link sai do meio do texto e vira botão de URL embaixo da mensagem
// (componente BUTTONS, tipo URL). Limites da Meta, lidos em 31/10/2026 em
// developers.facebook.com/documentation/business-messaging/whatsapp/templates/components:
// no máximo 2 botões de URL por template, texto do botão com até 25
// caracteres, UMA variável `{{1}}` no FIM da URL e um exemplo. Na CRIAÇÃO do
// template o exemplo do botão é a URL COMPLETA (gate Sol da PR #117); no
// envio, o botão vai como componente `button` com `sub_type: 'url'`, `index`
// em texto ("0", "1") e só o sufixo como parâmetro `text`.
// Toda URL de botão é dinâmica (repositório público: nenhum caminho real fica
// gravado no template): o caminho inteiro do app é o sufixo.
//
// ── ATENDIMENTO É LINHA DE TEXTO, NÃO BOTÃO (#119) ──────────────────────────
// Em 01/11/2026 a Meta recusou os 19 templates que tinham o botão "Falar com a
// gente" (`https://wa.me/{{1}}`): erro 100, subcódigo 2388081, "Os botões não
// podem conter links diretos para o WhatsApp". Decisão da orquestradora no
// mesmo dia (dentro da regra do dono de 31/10, a saída é o atendimento): o
// botão sai e entra a linha `Dúvidas? Fale com a gente: {{n}}` antes da
// assinatura, com o número LEGÍVEL (o WhatsApp o torna tocável); a frase que
// já dizia "fale com a gente" (o "Imprevisto?" dos toques de 48 h de hoje e
// sem prazo, e o encontro sem sala) só troca o ponto pelo número. O toque de
// 2 h sem sala leva a linha "Dúvidas?" (o "Imprevisto?" repetiria o corpo do
// 2 h com sala, ver a definição dele). Rota do app que redireciona para o `wa.me` é proibida
// (contornaria a regra da Meta). Os dois templates aceitos naquele dia
// (`class_reminder_2h_com_link` e `meeting_reminder_com_link`) não mudam: o
// 2 h com sala segue com o link no texto, como a Meta o aceitou.

export const CATEGORIA_DOS_TEMPLATES = 'UTILITY' as const
export const IDIOMA_DOS_TEMPLATES = 'pt_BR' as const

/**
 * As três chaves com texto de WhatsApp no despachante que NÃO vão à Meta
 * (ADR-038): o convite de remarcar por período, que hoje só é enfileirado por
 * e-mail, e os dois avisos internos à admin, de conteúdo variável demais para
 * caber num template (a decisão de 27/10/2026 manda os dois só por e-mail).
 */
export const CHAVES_SEM_TEMPLATE_NA_META: readonly string[] = Object.freeze([
  'period-reschedule-invite',
  'content-digest',
  'content-review',
])

/* ========================================================================== */
/* Parâmetros do corpo                                                         */
/* ========================================================================== */

interface Variavel {
  /** nome interno do parâmetro (o driver monta os valores por ele) */
  nome: string
  /** exemplo que vai para a Meta na submissão e que o catálogo mostra */
  exemplo: string
}

/**
 * Cada `{chave}` do documento de revisão, com o nome interno e o exemplo. Os
 * exemplos são de pessoa fictícia e de data fixa: a Meta exige um exemplo por
 * parâmetro e o JSON versionado precisa sair igual a cada geração.
 */
const VARIAVEIS: Readonly<Record<string, Variavel>> = {
  '{nome}': { nome: 'nome', exemplo: 'Marina' },
  // Sem o "Teacher": o corpo já o escreve antes do parâmetro.
  '{professora}': { nome: 'professora', exemplo: 'Vicky' },
  '{dia e hora da aula}': { nome: 'dia_e_hora', exemplo: 'quinta-feira, 12/11 às 09:00' },
  // O início da aula menos o aviso mínimo (POLICY.minNotice), no fuso do aluno.
  '{prazo}': { nome: 'prazo', exemplo: 'quarta-feira, 11/11 às 09:00' },
  '{hora da aula}': { nome: 'hora', exemplo: '09:00' },
  '{data da aula}': { nome: 'data_original', exemplo: '12/11' },
  '{nova data}': { nome: 'nova_data', exemplo: '14/11' },
  '{nova hora}': { nome: 'nova_hora', exemplo: '10:30' },
  '{cidade}': { nome: 'cidade', exemplo: 'Cuiabá' },
  '{data de validade}': { nome: 'validade', exemplo: '12/02/2027' },
  '{quantidade}': { nome: 'quantidade', exemplo: '2' },
  '{nº da mentoria}': { nome: 'numero_da_mentoria', exemplo: '2' },
  '{total de mentorias}': { nome: 'total_de_mentorias', exemplo: '6' },
  // O número de atendimento (src/lib/contact.ts, vem da env) é parâmetro, e o
  // último do corpo: trocar o número não pede reaprovação. Como LINK, só no
  // toque de 2 h com sala, aceito pela Meta em 01/11/2026 e congelado (#119).
  '{WhatsApp de atendimento}': { nome: 'whatsapp_atendimento', exemplo: 'https://wa.me/5565900090009' },
  // #119: nos outros 19, o número LEGÍVEL (o WhatsApp o torna tocável).
  '{número de atendimento}': { nome: 'numero_de_atendimento', exemplo: '+55 65 90009-0009' },
}

/** As `{chaves}` do atendimento no corpo: a linha que o cartão de Ajustes destaca. */
const MARCADORES_DE_ATENDIMENTO: readonly string[] = ['{WhatsApp de atendimento}', '{número de atendimento}']

/* ========================================================================== */
/* Botões                                                                      */
/* ========================================================================== */

/** Para onde um botão leva: o despachante monta o sufixo da URL por este nome. */
export type DestinoDoBotao =
  | 'aula'
  | 'creditos'
  | 'mentoria'
  | 'briefing'
  | 'briefing_atualizar'
  | 'sala'

interface Destino {
  /** a URL que a Meta aprova, com `{{1}}` no fim */
  url: string
  /** exemplo do sufixo (vai na submissão e no cartão de Ajustes) */
  exemplo: string
  /** o sufixo quando ele não muda de envio para envio (caminho fixo do portal) */
  fixo: string | null
  /** para onde leva, em português (o cartão de Ajustes mostra) */
  descricao: string
}

const NO_APP = 'https://app.personal-teacher.com/{{1}}'

const DESTINOS: Readonly<Record<DestinoDoBotao, Destino>> = {
  aula: {
    url: NO_APP,
    exemplo: 'portal/aula/00000000-0000-0000-0000-0000000000aa',
    fixo: null,
    descricao: 'a página da aula no portal (no lembrete, já entra logado)',
  },
  creditos: {
    url: NO_APP,
    exemplo: 'portal/creditos',
    fixo: 'portal/creditos',
    // #116: só o aviso de crédito vencendo entra logado; o "Agendar reposição"
    // do cancelamento segue pelo caminho comum
    descricao:
      'a tela "Seus créditos" do portal (no aviso de crédito vencendo, já entra logado; no cancelamento, pelo login comum)',
  },
  mentoria: { url: NO_APP, exemplo: 'portal/mentoria', fixo: 'portal/mentoria', descricao: 'a tela da mentoria no portal' },
  briefing: { url: NO_APP, exemplo: 'portal/briefing', fixo: 'portal/briefing', descricao: 'o briefing no portal' },
  briefing_atualizar: {
    url: NO_APP,
    exemplo: 'portal/briefing/atualizar',
    fixo: 'portal/briefing/atualizar',
    descricao: 'a atualização do briefing no portal',
  },
  sala: { url: 'https://meet.google.com/{{1}}', exemplo: 'abc-defg-hij', fixo: null, descricao: 'a sala no Google Meet' },
}

/**
 * O código da sala, quando o link é do Google Meet (`https://meet.google.com/<código>`);
 * null fora do Meet. O botão de sala aprovado na Meta tem a parte fixa
 * `https://meet.google.com/`, então sala de outro serviço não cabe nele: o
 * despachante manda a variante sem botão de sala (decisão do dono, #115).
 */
export function codigoDaSalaDoMeet(link: string): string | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com') return null
  const codigo = url.pathname.replace(/^\/+|\/+$/g, '')
  return /^[A-Za-z0-9-]+$/.test(codigo) ? codigo : null
}

/** O sufixo fixo de um destino (null quando ele muda a cada envio). */
export function sufixoFixo(destino: DestinoDoBotao): string | null {
  return DESTINOS[destino].fixo
}

export interface BotaoDeTemplate {
  /** posição do botão na Meta: o `index` do componente no envio */
  indice: number
  /** o texto do botão (até 25 caracteres) */
  texto: string
  destino: DestinoDoBotao
  url: string
  exemplo: string
  descricao: string
}

/** Limites da Meta para botão de URL (ver o cabeçalho). */
export const MAXIMO_DE_BOTOES_DE_URL = 2
export const MAXIMO_DO_TEXTO_DO_BOTAO = 25

/* ========================================================================== */
/* Vocabulário                                                                 */
/* ========================================================================== */

export interface ParametroDeTemplate {
  /** o n de `{{n}}` */
  posicao: number
  nome: string
  exemplo: string
  /** a `{chave}` do documento de revisão */
  marcador: string
}

export interface TemplateDeWhatsapp {
  /** a chave do outbox (`notification_outbox.template`) */
  chave: string
  /** sufixo da variante no nome; null quando a família tem um template só */
  variante: string | null
  /** o caso, em português (o título da variante no documento de revisão) */
  rotulo: string | null
  /** nome do template na Meta */
  nome: string
  /** o corpo com as `{chaves}` do documento */
  textoDoDocumento: string
  /** o corpo que vai para a Meta, com `{{1}}`, `{{2}}`, … */
  corpo: string
  parametros: readonly ParametroDeTemplate[]
  /** os botões de link, na ordem da Meta (vazio = mensagem sem botão) */
  botoes: readonly BotaoDeTemplate[]
}

interface Definicao {
  chave: string
  variante: string | null
  rotulo: string | null
  texto: string
  botoes: readonly (readonly [texto: string, destino: DestinoDoBotao])[]
}

/* ========================================================================== */
/* Os templates                                                                */
/* ========================================================================== */

const ASSINATURA = 'Equipe Personal Teacher Academy'
/** #119: o atendimento antes da assinatura (era o botão "Falar com a gente"). */
const DUVIDAS = 'Dúvidas? Fale com a gente: {número de atendimento}'
/** Assinatura precedida da linha de atendimento (#119). */
const FECHO = `${DUVIDAS}\n\n${ASSINATURA}`
const PRAZO = 'Precisa mudar? Dá para remarcar até *{prazo}*.'
const IMPREVISTO = 'Imprevisto? Fale com a gente: {número de atendimento}'
const CONFIRME = 'Confirme sua presença no botão abaixo.'

const VER_AULA = ['Ver minha aula', 'aula'] as const
const CONFIRMAR = ['Confirmar presença', 'aula'] as const

const DEFINICOES: readonly Definicao[] = [
  // ── Lembrete de aula ─────────────────────────────────────────────────────
  {
    chave: 'class-reminder',
    variante: '48h_data',
    rotulo: 'Toque de 48h, aula daqui a mais de um dia',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *{dia e hora da aula}*.\n\n' +
      `${PRAZO}\n\n${FECHO}`,
    botoes: [VER_AULA],
  },
  {
    chave: 'class-reminder',
    variante: '48h_amanha',
    rotulo: 'Toque de 48h, aula amanhã',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *AMANHÃ às {hora da aula}*.\n\n' +
      `${PRAZO}\n\n${FECHO}`,
    botoes: [VER_AULA],
  },
  {
    // #115 (decisão do dono, 31/10/2026): aula criada depois do horário dela no
    // dia anterior — o prazo de remarcar já passou quando o toque sai, e a
    // mensagem não promete o que o portal recusaria.
    chave: 'class-reminder',
    variante: '48h_amanha_sem_prazo',
    rotulo: 'Toque de 48h, aula amanhã, prazo de remarcar já vencido',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *AMANHÃ às {hora da aula}*.\n\n' +
      `${IMPREVISTO}\n\n${ASSINATURA}`,
    botoes: [VER_AULA],
  },
  {
    // O prazo de uma aula de hoje sempre já passou: sem a linha (#115).
    chave: 'class-reminder',
    variante: '48h_hoje',
    rotulo: 'Toque de 48h, aula marcada em cima da hora (hoje)',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *HOJE às {hora da aula}*.\n\n' +
      `${IMPREVISTO}\n\n${ASSINATURA}`,
    botoes: [VER_AULA],
  },
  {
    // Os dois botões já são a sala e a presença: o atendimento fica no texto.
    // #119: aceito pela Meta em 01/11/2026 com o LINK no texto; não muda (o
    // teste o compara com tests/fixtures/meta/templates-aceitos-2026-11-01.json).
    chave: 'class-reminder',
    variante: '2h_com_link',
    rotulo: 'Toque de 2h, aula hoje',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é HOJE às {hora da aula}. ⏰\n\n' +
      `${CONFIRME}\n\n` +
      'Imprevisto? Fale com a gente: {WhatsApp de atendimento}\n\n' +
      ASSINATURA,
    botoes: [['Entrar na aula', 'sala'], CONFIRMAR],
  },
  {
    // Revisão da PR #126: com "Imprevisto? Fale com a gente: {{4}}" o corpo
    // que vai à Meta seria IGUAL ao do 2 h com sala (lá o parâmetro é o link,
    // aqui o número, mas os dois viram `{{4}}`), e a Meta recusa conteúdo
    // duplicado na mesma conta e idioma. Por isso a linha "Dúvidas?".
    chave: 'class-reminder',
    variante: '2h_sem_link',
    rotulo: 'Toque de 2h, aula hoje, sem link da sala cadastrado',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é HOJE às {hora da aula}. ⏰\n\n' +
      `${CONFIRME}\n\n${FECHO}`,
    botoes: [CONFIRMAR],
  },
  {
    chave: 'class-reminder',
    variante: 'antigo',
    rotulo: 'Formato antigo (aviso enfileirado antes dos toques de 48h e 2h)',
    texto:
      'Olá, {nome}! Lembrete: você tem aula *{dia e hora da aula}* com a Teacher {professora}. Até já!\n\n' +
      FECHO,
    botoes: [],
  },

  // ── Aula cancelada ───────────────────────────────────────────────────────
  {
    chave: 'class-cancelled',
    variante: 'com_credito',
    rotulo: 'Cancelamento que gera crédito',
    texto:
      'Olá, {nome}! Confirmando: a sua aula de *{dia e hora da aula}* com a Teacher {professora} foi *cancelada*.\n\n' +
      'Você ganhou 1 crédito de reposição por ela — vale até {data de validade}. É só agendar pelo portal quando quiser.\n\n' +
      FECHO,
    botoes: [['Agendar reposição', 'creditos']],
  },
  {
    chave: 'class-cancelled',
    variante: 'sem_credito',
    rotulo: 'Cancelamento sem crédito',
    texto:
      'Olá, {nome}! Confirmando: a sua aula de *{dia e hora da aula}* com a Teacher {professora} foi *cancelada*.\n\n' +
      'Essa aula não gera crédito de reposição.\n\n' +
      FECHO,
    botoes: [],
  },

  // ── Confirmação de remarcação ────────────────────────────────────────────
  {
    chave: 'reschedule-confirm',
    variante: 'remarcacao',
    rotulo: 'Remarcação',
    texto:
      'Olá, {nome}! Sua remarcação está confirmada: *{dia e hora da aula}* com a Teacher {professora}. ✅\n\n' +
      FECHO,
    botoes: [VER_AULA],
  },
  {
    chave: 'reschedule-confirm',
    variante: 'reposicao',
    rotulo: 'Aula de reposição (agendada com crédito)',
    texto:
      'Olá, {nome}! Sua aula de reposição está agendada: *{dia e hora da aula}* com a Teacher {professora}. ✅\n\n' +
      FECHO,
    botoes: [VER_AULA],
  },
  {
    // Quando a professora remarca (moved_by = 'teacher'). Texto aprovado pelo
    // dono em 31/10/2026 (#115, item 3); o e-mail `teacherMovedEmail` diz o mesmo.
    chave: 'reschedule-confirm',
    variante: 'escola_moveu',
    rotulo: 'A professora remarcou a aula',
    texto:
      'Oi, {nome}! Confirmando a remarcação combinada com a Teacher {professora}: sua aula de ' +
      '*{data da aula} às {hora da aula}* passou para *{nova data} às {nova hora}* (horário de {cidade}). ✅\n\n' +
      'Essa mudança partiu da escola: não usa suas remarcações do mês nem crédito.\n\n' +
      FECHO,
    botoes: [VER_AULA],
  },

  // ── Crédito de reposição vencendo ────────────────────────────────────────
  {
    chave: 'credit-expiry',
    variante: 'um',
    rotulo: 'Um crédito',
    texto:
      'Oi, {nome}! Passando para lembrar: você tem *1 crédito de reposição* que vence em *{data de validade}*.\n\n' +
      'Para usar, é só entrar no portal e escolher um dos horários disponíveis.\n\n' +
      'Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉\n\n' +
      FECHO,
    botoes: [['Usar meu crédito', 'creditos']],
  },
  {
    chave: 'credit-expiry',
    variante: 'varios',
    rotulo: 'Mais de um crédito',
    texto:
      'Oi, {nome}! Passando para lembrar: você tem *{quantidade} créditos de reposição* que vencem em *{data de validade}*.\n\n' +
      'Para usar, é só entrar no portal e escolher um dos horários disponíveis.\n\n' +
      'Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉\n\n' +
      FECHO,
    botoes: [['Usar meu crédito', 'creditos']],
  },

  // ── Briefing ─────────────────────────────────────────────────────────────
  {
    chave: 'briefing-reminder',
    variante: null,
    rotulo: null,
    texto:
      'Olá, {nome}! Falta um passo para as suas aulas começarem do seu jeito: o seu briefing (~10 min) — seus interesses, seus objetivos e como você aprende melhor. 📝\n\n' +
      FECHO,
    botoes: [['Responder briefing', 'briefing']],
  },
  {
    chave: 'briefing-update-reminder',
    variante: null,
    rotulo: null,
    texto:
      'Olá, {nome}! Começa um semestre novo das suas aulas: conte para a gente o que mudou nos seus objetivos e interesses. 🎯\n\n' +
      'São duas telas rápidas, com as suas respostas de antes já preenchidas — confirme o que continua valendo e mude só o que mudou.\n\n' +
      FECHO,
    botoes: [['Atualizar briefing', 'briefing_atualizar']],
  },

  // ── Mentoria ─────────────────────────────────────────────────────────────
  {
    // O de maior risco de a Meta reclassificar para marketing: fica só no fato
    // (crédito liberado + como agendar), sem convite a comprar nada.
    chave: 'mentorship-eligible',
    variante: null,
    rotulo: null,
    texto:
      'Olá, {nome}! Boa notícia: a sua *mentoria nº {nº da mentoria}* (de {total de mentorias} do programa Personal Travel) já está liberada para agendamento. 🎉\n\n' +
      'É só entrar no portal e escolher uma das datas disponíveis.\n\n' +
      FECHO,
    botoes: [['Escolher data', 'mentoria']],
  },
  {
    chave: 'meeting-reminder',
    variante: 'com_link',
    rotulo: 'Com link da sala',
    texto:
      'Olá, {nome}! Lembrete: seu encontro de mentoria do Personal Travel é *{dia e hora da aula}*. ✈️\n\n' +
      'Nos vemos lá! 😊\n\n' +
      ASSINATURA,
    botoes: [['Entrar no encontro', 'sala']],
  },
  {
    // Não está no documento de revisão (que mostra só a versão com link), mas o
    // código manda: o link do encontro pode estar vazio ou fora do Google Meet.
    // Decisão da orquestradora (31/10/2026, revisão da PR #117): a saída é o
    // atendimento, verdadeira em todos os casos (com a sessão lotada a tela da
    // mentoria não mostra o link, e sem link não há o que mostrar). A frase
    // deixa o corpo diferente do "com link" (a Meta recusa conteúdo duplicado
    // na mesma conta e idioma). #119: termina com o número, no lugar do botão.
    chave: 'meeting-reminder',
    variante: 'sem_link',
    rotulo: 'Sem link da sala cadastrado',
    texto:
      'Olá, {nome}! Lembrete: seu encontro de mentoria do Personal Travel é *{dia e hora da aula}*. ✈️\n\n' +
      'Qualquer dúvida sobre a sala, fale com a gente: {número de atendimento}\n\n' +
      ASSINATURA,
    botoes: [],
  },
  {
    chave: 'meeting-cancelled',
    variante: 'escola',
    rotulo: 'A escola cancelou o encontro',
    texto:
      'Olá, {nome}! O encontro de mentoria de *{dia e hora da aula}* precisou ser cancelado — desculpa o transtorno.\n\n' +
      '*Seu crédito de mentoria já voltou* — escolha outra data.\n\n' +
      FECHO,
    botoes: [['Escolher outra data', 'mentoria']],
  },
  {
    chave: 'meeting-cancelled',
    variante: 'aluno',
    rotulo: 'O aluno cancelou a própria reserva',
    texto:
      'Olá, {nome}! Confirmando: sua reserva do encontro de *{dia e hora da aula}* foi cancelada.\n\n' +
      '*Seu crédito de mentoria já voltou* — escolha outra data.\n\n' +
      FECHO,
    botoes: [['Escolher outra data', 'mentoria']],
  },
]

/* ========================================================================== */
/* Montagem                                                                    */
/* ========================================================================== */

/** Os botões de uma definição, conferidos contra os limites da Meta. */
function montarBotoes(d: Definicao, nome: string): readonly BotaoDeTemplate[] {
  if (d.botoes.length > MAXIMO_DE_BOTOES_DE_URL) {
    throw new Error(`whatsapp-templates: ${nome} tem mais de ${MAXIMO_DE_BOTOES_DE_URL} botões de link`)
  }
  return Object.freeze(
    d.botoes.map(([texto, destino], indice) => {
      if (!texto.trim() || texto.length > MAXIMO_DO_TEXTO_DO_BOTAO) {
        throw new Error(`whatsapp-templates: texto de botão inválido em ${nome}: "${texto}"`)
      }
      const { url, exemplo, descricao } = DESTINOS[destino]
      return Object.freeze({ indice, texto, destino, url, exemplo, descricao })
    }),
  )
}

/** Troca cada `{chave}` do documento por `{{n}}`, na ordem em que aparece. */
function montar(d: Definicao): TemplateDeWhatsapp {
  const parametros: ParametroDeTemplate[] = []
  const corpo = d.texto.replace(/\{[^{}\n]+\}/g, (marcador) => {
    const variavel = VARIAVEIS[marcador]
    if (!variavel) throw new Error(`whatsapp-templates: variável sem definição: ${marcador}`)
    if (parametros.some((p) => p.marcador === marcador)) {
      throw new Error(`whatsapp-templates: ${marcador} aparece duas vezes em ${d.chave}`)
    }
    parametros.push(Object.freeze({ posicao: parametros.length + 1, marcador, ...variavel }))
    return `{{${parametros.length}}}`
  })
  const base = d.chave.replace(/-/g, '_')
  const nome = d.variante ? `${base}_${d.variante}` : base
  return Object.freeze({
    chave: d.chave,
    variante: d.variante,
    rotulo: d.rotulo,
    nome,
    textoDoDocumento: d.texto,
    corpo,
    parametros: Object.freeze(parametros),
    botoes: montarBotoes(d, nome),
  })
}

export const TEMPLATES_DE_WHATSAPP: readonly TemplateDeWhatsapp[] = Object.freeze(DEFINICOES.map(montar))

/** Os templates de uma chave do outbox, na ordem do catálogo (vazio = sem template). */
export function templatesDaChave(chave: string): TemplateDeWhatsapp[] {
  return TEMPLATES_DE_WHATSAPP.filter((t) => t.chave === chave)
}

/** Os valores de um template, POR NOME de parâmetro (a ordem é do módulo). */
export type ValoresDoTemplate = Readonly<Record<string, string>>

/** Os exemplos de um template (os que vão na submissão e que o catálogo mostra). */
export function exemplosDoTemplate(t: TemplateDeWhatsapp): ValoresDoTemplate {
  return Object.fromEntries(t.parametros.map((p) => [p.nome, p.exemplo]))
}

/**
 * O nome da professora como o parâmetro `professora` deste template pede. Onde
 * o corpo já escreve "Teacher {professora}" (todos, desde a #115), o prefixo
 * sai do nome ("Teacher Vicky" → "Vicky"), a mesma regra do `teacherLabel`
 * (`src/lib/email/class-notices.ts`), que nunca escreve "Teacher Teacher".
 * Onde o corpo não escreve "Teacher", o nome entra como está.
 */
export function nomeDaProfessoraNoTemplate(t: TemplateDeWhatsapp, nome: string): string {
  const limpo = nome.trim()
  if (!t.textoDoDocumento.includes('Teacher {professora}')) return limpo
  return limpo.replace(/^teacher\s+/i, '')
}

/**
 * O corpo como o aluno lê. Os valores vêm POR NOME (os exemplos, quando nada é
 * passado), e cada um vai para o seu `{{n}}`: trocar a ordem das chaves não
 * troca o lugar do valor. Recusa o que a Meta recusaria ou o que seria engano
 * silencioso: parâmetro faltando ou sobrando, valor vazio, com quebra de linha
 * ou tabulação, com mais de três espaços seguidos. O nome da professora passa
 * por `nomeDaProfessoraNoTemplate`.
 */
export function renderizarTemplate(t: TemplateDeWhatsapp, valores: ValoresDoTemplate = exemplosDoTemplate(t)): string {
  const emOrdem = parametrosEmOrdem(t, valores)
  return t.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => emOrdem[Number(n) - 1])
}

/**
 * Os valores na ordem de `{{1}}`, `{{2}}`, …: o que o driver da Cloud API
 * manda à Meta (#43). Mesmas recusas de `renderizarTemplate`, que usa esta.
 */
export function parametrosEmOrdem(t: TemplateDeWhatsapp, valores: ValoresDoTemplate): string[] {
  const esperados = t.parametros.map((p) => p.nome)
  const recebidos = Object.keys(valores)
  const faltam = esperados.filter((n) => !recebidos.includes(n))
  const sobram = recebidos.filter((n) => !esperados.includes(n))
  if (faltam.length || sobram.length) {
    throw new Error(
      `whatsapp-templates: ${t.nome} · faltam [${faltam.join(', ')}] · sobram [${sobram.join(', ')}]`,
    )
  }
  return t.parametros.map((p) => {
    const bruto = valores[p.nome]
    const v = p.nome === 'professora' ? nomeDaProfessoraNoTemplate(t, bruto) : bruto
    if (!v.trim() || /[\n\r\t]/.test(v) || / {4,}/.test(v)) {
      throw new Error(`whatsapp-templates: valor inválido para ${t.nome} · ${p.nome}`)
    }
    return v
  })
}

/**
 * O parágrafo do corpo que aponta o atendimento, renderizado com o exemplo
 * (#119: o cartão de Ajustes o mostra ao lado dos botões); null quando o
 * template não fala do atendimento.
 */
export function linhaDeAtendimento(t: TemplateDeWhatsapp): string | null {
  const p = t.parametros.find((x) => MARCADORES_DE_ATENDIMENTO.includes(x.marcador))
  if (!p) return null
  const paragrafo = t.textoDoDocumento.split('\n\n').find((x) => x.includes(p.marcador))
  return paragrafo ? paragrafo.replace(p.marcador, p.exemplo) : null
}

/** Sufixo de URL que a Meta aceita no fim do botão: não vazio e sem espaço. */
export function sufixoDeBotaoValido(sufixo: string): boolean {
  return sufixo.length > 0 && !/\s/.test(sufixo)
}

/**
 * Os sufixos dos botões, na ordem do `index` da Meta, a partir dos valores POR
 * DESTINO. Recusa destino faltando e sufixo vazio ou com espaço — o mesmo
 * cuidado do corpo: a Meta recusaria, ou o botão abriria um endereço quebrado.
 */
export function botoesEmOrdem(
  t: TemplateDeWhatsapp,
  sufixos: Readonly<Partial<Record<DestinoDoBotao, string>>>,
): string[] {
  return t.botoes.map((b) => {
    const s = sufixos[b.destino] ?? ''
    if (!sufixoDeBotaoValido(s)) {
      throw new Error(`whatsapp-templates: sufixo inválido para ${t.nome} · botão ${b.indice} (${b.destino})`)
    }
    return s
  })
}

/* ========================================================================== */
/* Submissão à Meta                                                            */
/* ========================================================================== */

interface ComponenteDeCorpo {
  type: 'BODY'
  text: string
  example: { body_text: string[][] }
}

interface ComponenteDeBotoes {
  type: 'BUTTONS'
  buttons: { type: 'URL'; text: string; url: string; example: string[] }[]
}

export interface SubmissaoDeTemplate {
  name: string
  language: typeof IDIOMA_DOS_TEMPLATES
  category: typeof CATEGORIA_DOS_TEMPLATES
  components: (ComponenteDeCorpo | ComponenteDeBotoes)[]
}

/**
 * A lista de submissão: um elemento por template, e cada elemento é o corpo de
 * UMA chamada `POST /{waba}/message_templates` (a Meta cria um template por
 * chamada; mandar a lista inteira de uma vez falha). O exemplo do botão é a
 * URL completa com o exemplo no lugar de `{{1}}`.
 */
export function payloadDeSubmissao(): SubmissaoDeTemplate[] {
  return TEMPLATES_DE_WHATSAPP.map((t) => ({
    name: t.nome,
    language: IDIOMA_DOS_TEMPLATES,
    category: CATEGORIA_DOS_TEMPLATES,
    components: [
      { type: 'BODY', text: t.corpo, example: { body_text: [t.parametros.map((p) => p.exemplo)] } },
      ...(t.botoes.length
        ? [
            {
              type: 'BUTTONS' as const,
              buttons: t.botoes.map((b) => ({
                type: 'URL' as const,
                text: b.texto,
                url: b.url,
                // na criação, a Meta quer a URL completa de exemplo
                example: [b.url.replace('{{1}}', b.exemplo)],
              })),
            },
          ]
        : []),
    ],
  }))
}

/** Um template que já está na conta da Meta (`GET /{waba}/message_templates?fields=name,status`). */
export interface TemplateNaConta {
  name: string
  status: string
  /** o idioma (`fields=name,status,language`); ausente = tratado como o do catálogo */
  language?: string
}

/**
 * O que o rito de submissão manda (#119): só o template cujo par (NOME,
 * IDIOMA) ainda não existe na conta, na ordem do catálogo. O que já existe é
 * pulado em qualquer estado: o aceito (PENDING, APPROVED) não se submete de
 * novo, e um recusado com o mesmo nome a Meta não deixaria criar outra vez
 * (mudar o texto de um template existente é edição, não criação). Gate Sol da
 * PR #126: a Meta aceita o mesmo nome em idiomas diferentes, então o nome em
 * outro idioma não conta, e TODA ocorrência no idioma volta em `pular` (um
 * recusado nunca some atrás de outro registro do mesmo nome).
 */
export function templatesParaSubmeter(
  lista: readonly SubmissaoDeTemplate[],
  conta: readonly TemplateNaConta[],
): { submeter: SubmissaoDeTemplate[]; pular: TemplateNaConta[] } {
  const existentes = (s: SubmissaoDeTemplate) =>
    conta.filter((t) => t.name === s.name && (t.language ?? s.language) === s.language)
  return {
    submeter: lista.filter((s) => existentes(s).length === 0),
    pular: lista.flatMap(existentes),
  }
}

/** O JSON exato de `docs/whatsapp-templates.json` (o teste compara byte a byte). */
export function jsonDeSubmissao(): string {
  return `${JSON.stringify(payloadDeSubmissao(), null, 2)}\n`
}
