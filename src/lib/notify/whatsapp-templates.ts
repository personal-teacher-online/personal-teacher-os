// TEMPLATES DE WHATSAPP PARA A CLOUD API (ADR-038, opção B · issue #41).
//
// Fora da janela de 24 h a Meta só entrega TEMPLATE aprovado: nome, idioma e
// parâmetros em ordem. Este módulo é a FONTE ÚNICA do texto de WhatsApp: o
// catálogo de Ajustes mostra o que está aqui, o gerador do JSON de submissão
// (`scripts/whatsapp-templates.ts` → `docs/whatsapp-templates.json`) lê
// daqui e, na issue do driver (#43), o despachante também. O que a dona confere
// na tela é o que a Meta aprova e o que o aluno recebe.
//
// ── DE ONDE VEM CADA CORPO ──────────────────────────────────────────────────
// Do bloco "WhatsApp" de cada variante em `docs/goals/textos-revisao-2026-09.md`
// (M3-4), escrito aqui com as MESMAS `{chaves}` do documento. O `{{n}}` que a
// Meta exige é derivado delas, na ordem em que aparecem; nada é digitado duas
// vezes. `tests/whatsapp-templates.test.ts` compara cada texto com o gerador do
// documento: palavra diferente é teste vermelho.
//
// ── POR QUE UMA VARIANTE VIRA UM TEMPLATE ───────────────────────────────────
// A Meta recusa parâmetro vazio ou com quebra de linha. Então a parte opcional
// de hoje (link da sala só quando existe, crédito só quando nasceu, HOJE ou
// AMANHÃ) não pode ser um parâmetro que some: cada caso é um template próprio.
//
// Esta issue NÃO muda o envio: até o driver (#43) o despachante segue mandando
// o texto livre de `src/lib/email/` pela Evolution.

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
/* Parâmetros                                                                  */
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
  '{hora da aula}': { nome: 'hora', exemplo: '09:00' },
  '{data da aula}': { nome: 'data_original', exemplo: '12/11' },
  '{nova data}': { nome: 'nova_data', exemplo: '14/11' },
  '{nova hora}': { nome: 'nova_hora', exemplo: '10:30' },
  '{cidade}': { nome: 'cidade', exemplo: 'Cuiabá' },
  '{link que já entra logado}': {
    nome: 'link_da_aula',
    exemplo: 'https://app.personal-teacher.com/portal/aula/00000000-0000-0000-0000-0000000000aa',
  },
  '{link da sala}': { nome: 'link_da_sala', exemplo: 'https://meet.google.com/exemplo' },
  '{data de validade}': { nome: 'validade', exemplo: '12/02/2027' },
  '{quantidade}': { nome: 'quantidade', exemplo: '2' },
  '{nº da mentoria}': { nome: 'numero_da_mentoria', exemplo: '2' },
  '{total de mentorias}': { nome: 'total_de_mentorias', exemplo: '6' },
  // O número de atendimento (src/lib/contact.ts, vem da env) é parâmetro, e o
  // último do corpo: trocar o número não pede reaprovação.
  '{WhatsApp de atendimento}': { nome: 'whatsapp_atendimento', exemplo: 'https://wa.me/5565900090009' },
}

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
}

interface Definicao {
  chave: string
  variante: string | null
  rotulo: string | null
  texto: string
}

/* ========================================================================== */
/* Os templates                                                                */
/* ========================================================================== */

const ASSINATURA = 'Equipe Personal Teacher Academy'
const RODAPE = `Dúvidas? Fale com a gente: {WhatsApp de atendimento}\n\n${ASSINATURA}`
const LINK_DA_AULA = 'Confirmar presença, remarcar ou cancelar:\n{link que já entra logado}'

const DEFINICOES: readonly Definicao[] = [
  // ── Lembrete de aula ─────────────────────────────────────────────────────
  {
    chave: 'class-reminder',
    variante: '48h_data',
    rotulo: 'Toque de 48h, aula daqui a mais de um dia',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *{dia e hora da aula}*.\n\n' +
      `${LINK_DA_AULA}\n\n${RODAPE}`,
  },
  {
    chave: 'class-reminder',
    variante: '48h_amanha',
    rotulo: 'Toque de 48h, aula amanhã',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *AMANHÃ às {hora da aula}*.\n\n' +
      `${LINK_DA_AULA}\n\n${RODAPE}`,
  },
  {
    chave: 'class-reminder',
    variante: '48h_hoje',
    rotulo: 'Toque de 48h, aula marcada em cima da hora (hoje)',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é *HOJE às {hora da aula}*.\n\n' +
      `${LINK_DA_AULA}\n\n${RODAPE}`,
  },
  {
    chave: 'class-reminder',
    variante: '2h_com_link',
    rotulo: 'Toque de 2h, aula hoje',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é HOJE às {hora da aula}. ⏰\n\n' +
      'Entrar na aula: {link da sala}\n\n' +
      `${LINK_DA_AULA}\n\n${ASSINATURA}`,
  },
  {
    chave: 'class-reminder',
    variante: '2h_sem_link',
    rotulo: 'Toque de 2h, aula hoje, sem link da sala cadastrado',
    texto:
      'Olá, {nome}! Lembrete: sua aula com a Teacher {professora} é HOJE às {hora da aula}. ⏰\n\n' +
      `${LINK_DA_AULA}\n\n${ASSINATURA}`,
  },
  {
    chave: 'class-reminder',
    variante: 'antigo',
    rotulo: 'Formato antigo (aviso enfileirado antes dos toques de 48h e 2h)',
    texto:
      'Olá, {nome}! Lembrete: você tem aula *{dia e hora da aula}* com a Teacher {professora}. Até já!\n\n' +
      RODAPE,
  },

  // ── Aula cancelada ───────────────────────────────────────────────────────
  {
    chave: 'class-cancelled',
    variante: 'com_credito',
    rotulo: 'Cancelamento que gera crédito',
    texto:
      'Olá, {nome}! Confirmando: a sua aula de *{dia e hora da aula}* com a Teacher {professora} foi *cancelada*.\n\n' +
      'Você ganhou 1 crédito de reposição por ela — vale até {data de validade}. É só agendar pelo portal quando quiser.\n\n' +
      RODAPE,
  },
  {
    chave: 'class-cancelled',
    variante: 'sem_credito',
    rotulo: 'Cancelamento sem crédito',
    texto:
      'Olá, {nome}! Confirmando: a sua aula de *{dia e hora da aula}* com a Teacher {professora} foi *cancelada*.\n\n' +
      'Essa aula não gera crédito de reposição.\n\n' +
      RODAPE,
  },

  // ── Confirmação de remarcação ────────────────────────────────────────────
  {
    chave: 'reschedule-confirm',
    variante: 'remarcacao',
    rotulo: 'Remarcação',
    texto:
      'Olá, {nome}! Sua remarcação está confirmada: *{dia e hora da aula}* com a Teacher {professora}. ✅\n\n' +
      RODAPE,
  },
  {
    chave: 'reschedule-confirm',
    variante: 'reposicao',
    rotulo: 'Aula de reposição (agendada com crédito)',
    texto:
      'Olá, {nome}! Sua aula de reposição está agendada: *{dia e hora da aula}* com a Teacher {professora}. ✅\n\n' +
      RODAPE,
  },
  {
    // Item 3b da issue: quando a professora remarca (moved_by = 'teacher',
    // coluna da #42; o fio é da #43). Texto da seção 22 do documento de
    // revisão (hoje o e-mail `teacherMovedEmail`), sem palavra a mais.
    chave: 'reschedule-confirm',
    variante: 'escola_moveu',
    rotulo: 'A professora remarcou a aula',
    texto:
      'Oi, {nome}!\n\n' +
      'A {professora} precisou remarcar a sua aula:\n\n' +
      '• Aula original: {data da aula} às {hora da aula}\n\n' +
      '• Nova aula: {nova data} às {nova hora} (horário de {cidade})\n\n' +
      '• Como foi descontado: nada — a mudança partiu da escola e não usa suas remarcações do mês nem crédito.\n\n' +
      'Se o novo horário não funcionar para você, fale com a gente antes da aula e a gente encontra outro.\n\n' +
      'Até lá! 👋\n\n' +
      ASSINATURA,
  },

  // ── Crédito de reposição vencendo ────────────────────────────────────────
  {
    chave: 'credit-expiry',
    variante: 'um',
    rotulo: 'Um crédito',
    texto:
      'Oi, {nome}! Passando para lembrar: você tem *1 crédito de reposição* que vence em *{data de validade}*.\n\n' +
      'Para usar, é só entrar no portal e escolher um dos horários disponíveis:\n' +
      'https://app.personal-teacher.com/portal\n\n' +
      'Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉\n\n' +
      ASSINATURA,
  },
  {
    chave: 'credit-expiry',
    variante: 'varios',
    rotulo: 'Mais de um crédito',
    texto:
      'Oi, {nome}! Passando para lembrar: você tem *{quantidade} créditos de reposição* que vencem em *{data de validade}*.\n\n' +
      'Para usar, é só entrar no portal e escolher um dos horários disponíveis:\n' +
      'https://app.personal-teacher.com/portal\n\n' +
      'Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉\n\n' +
      ASSINATURA,
  },

  // ── Briefing ─────────────────────────────────────────────────────────────
  {
    chave: 'briefing-reminder',
    variante: null,
    rotulo: null,
    texto:
      'Olá, {nome}! Falta um passo para as suas aulas começarem do seu jeito: o seu briefing (~10 min) — seus interesses, seus objetivos e como você aprende melhor. 📝\n\n' +
      'Responder agora:\n' +
      'https://app.personal-teacher.com/portal/briefing\n\n' +
      RODAPE,
  },
  {
    chave: 'briefing-update-reminder',
    variante: null,
    rotulo: null,
    texto:
      'Olá, {nome}! Começa um semestre novo das suas aulas: conte para a gente o que mudou nos seus objetivos e interesses. 🎯\n\n' +
      'São duas telas rápidas, com as suas respostas de antes já preenchidas — confirme o que continua valendo e mude só o que mudou.\n\n' +
      'Atualizar agora:\n' +
      'https://app.personal-teacher.com/portal/briefing/atualizar\n\n' +
      RODAPE,
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
      'É só entrar no portal e escolher uma das datas disponíveis:\n' +
      'https://app.personal-teacher.com/portal/mentoria\n\n' +
      RODAPE,
  },
  {
    chave: 'meeting-reminder',
    variante: 'com_link',
    rotulo: 'Com link da sala',
    texto:
      'Olá, {nome}! Lembrete: seu encontro de mentoria do Personal Travel é *{dia e hora da aula}*. ✈️\n\n' +
      'Entrar no encontro: {link da sala}\n\n' +
      'Nos vemos lá! 😊\n\n' +
      ASSINATURA,
  },
  {
    // Não está no documento de revisão (que mostra só a versão com link), mas o
    // código manda: o link do encontro pode estar vazio. Texto do código de hoje.
    chave: 'meeting-reminder',
    variante: 'sem_link',
    rotulo: 'Sem link da sala cadastrado',
    texto:
      'Olá, {nome}! Lembrete: seu encontro de mentoria do Personal Travel é *{dia e hora da aula}*. ✈️\n\n' +
      'Nos vemos lá! 😊\n\n' +
      ASSINATURA,
  },
  {
    chave: 'meeting-cancelled',
    variante: 'escola',
    rotulo: 'A escola cancelou o encontro',
    texto:
      'Olá, {nome}! O encontro de mentoria de *{dia e hora da aula}* precisou ser cancelado — desculpa o transtorno.\n\n' +
      '*Seu crédito de mentoria já voltou* — escolha outra data:\n' +
      'https://app.personal-teacher.com/portal/mentoria\n\n' +
      RODAPE,
  },
  {
    chave: 'meeting-cancelled',
    variante: 'aluno',
    rotulo: 'O aluno cancelou a própria reserva',
    texto:
      'Olá, {nome}! Confirmando: sua reserva do encontro de *{dia e hora da aula}* foi cancelada.\n\n' +
      '*Seu crédito de mentoria já voltou* — escolha outra data:\n' +
      'https://app.personal-teacher.com/portal/mentoria\n\n' +
      RODAPE,
  },
]

/* ========================================================================== */
/* Montagem                                                                    */
/* ========================================================================== */

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
  return Object.freeze({
    chave: d.chave,
    variante: d.variante,
    rotulo: d.rotulo,
    nome: d.variante ? `${base}_${d.variante}` : base,
    textoDoDocumento: d.texto,
    corpo,
    parametros: Object.freeze(parametros),
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
 * o corpo já escreve "Teacher {professora}", o prefixo sai do nome ("Teacher
 * Vicky" → "Vicky"), a mesma regra do `teacherLabel` de hoje
 * (`src/lib/email/class-notices.ts`), que nunca escreve "Teacher Teacher".
 * Onde o corpo não escreve "Teacher" (a variante "a escola moveu", que vem do
 * e-mail `teacherMovedEmail`), o nome entra como está, como no e-mail de hoje.
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
  const esperados = t.parametros.map((p) => p.nome)
  const recebidos = Object.keys(valores)
  const faltam = esperados.filter((n) => !recebidos.includes(n))
  const sobram = recebidos.filter((n) => !esperados.includes(n))
  if (faltam.length || sobram.length) {
    throw new Error(
      `whatsapp-templates: ${t.nome} · faltam [${faltam.join(', ')}] · sobram [${sobram.join(', ')}]`,
    )
  }
  const emOrdem = t.parametros.map((p) => {
    const bruto = valores[p.nome]
    const v = p.nome === 'professora' ? nomeDaProfessoraNoTemplate(t, bruto) : bruto
    if (!v.trim() || /[\n\r\t]/.test(v) || / {4,}/.test(v)) {
      throw new Error(`whatsapp-templates: valor inválido para ${t.nome} · ${p.nome}`)
    }
    return v
  })
  return t.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => emOrdem[Number(n) - 1])
}

/* ========================================================================== */
/* Submissão à Meta                                                            */
/* ========================================================================== */

export interface SubmissaoDeTemplate {
  name: string
  language: typeof IDIOMA_DOS_TEMPLATES
  category: typeof CATEGORIA_DOS_TEMPLATES
  components: { type: 'BODY'; text: string; example: { body_text: string[][] } }[]
}

/**
 * A lista de submissão: um elemento por template, e cada elemento é o corpo de
 * UMA chamada `POST /{waba}/message_templates` (a Meta cria um template por
 * chamada; mandar a lista inteira de uma vez falha).
 */
export function payloadDeSubmissao(): SubmissaoDeTemplate[] {
  return TEMPLATES_DE_WHATSAPP.map((t) => ({
    name: t.nome,
    language: IDIOMA_DOS_TEMPLATES,
    category: CATEGORIA_DOS_TEMPLATES,
    components: [{ type: 'BODY', text: t.corpo, example: { body_text: [t.parametros.map((p) => p.exemplo)] } }],
  }))
}

/** O JSON exato de `docs/whatsapp-templates.json` (o teste compara byte a byte). */
export function jsonDeSubmissao(): string {
  return `${JSON.stringify(payloadDeSubmissao(), null, 2)}\n`
}
