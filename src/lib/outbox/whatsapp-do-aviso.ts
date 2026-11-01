import { DateTime } from 'luxon'
import { dayLabel, localParts, prazoDoToqueDe48h } from '@/lib/email/class-notices'
import { tzLabel } from '@/lib/format'
import {
  botoesEmOrdem,
  codigoDaSalaDoMeet,
  parametrosEmOrdem,
  renderizarTemplate,
  sufixoFixo,
  templatesDaChave,
  type DestinoDoBotao,
  type TemplateDeWhatsapp,
} from '@/lib/notify/whatsapp-templates'

// O aviso do outbox como TEMPLATE da Meta (ADR-038 · #43): qual variante do
// catálogo (`whatsapp-templates.ts`, a fonte única do texto) e com que valores.
// Função pura: o despachante injeta os fatos (payload, nome, links, relógio);
// Luxon só formata no fuso do destinatário (Lei 1), pelas mesmas funções do
// texto (`localParts`, `dayLabel`, `prazoDoToqueDe48h`).
//
// #115: além do corpo, os BOTÕES de link — o sufixo da URL de cada um, na
// ordem da Meta. A aula vai pelo link que entra logado quando o despachante o
// gerou (`caminho_logado`, `wa/<hash>/aula/<id>`), senão pelo caminho comum; o
// atendimento sai do número da env; a sala, do código do Google Meet.

type Payload = Record<string, unknown>

export interface FatosDoAviso {
  nome: string
  appUrl: string
  /** `https://wa.me/<número>` de atendimento, ou null sem a env */
  atendimentoUrl: string | null
  /** o instante do envio (#115: escolhe HOJE/AMANHÃ e se o prazo de remarcar
   *  ainda está pela frente); ausente = agora */
  agora?: Date
}

export type WhatsappDoAviso =
  | {
      ok: true
      template: TemplateDeWhatsapp
      params: string[]
      /** sufixo da URL de cada botão, na ordem do `index` da Meta */
      botoes: string[]
      texto: string
      /** o que o servidor deve registrar no log (não impede o envio); null = nada */
      observacao: string | null
    }
  | {
      ok: false
      /** a frase que fica na linha e aparece na tela de Mensagens (português) */
      motivo: string
      /** chave interna, nome de parâmetro ou de variável: só para o log do servidor */
      detalhe: string
    }

/** Motivo da linha de WhatsApp cuja chave não tem template aprovado na Meta. */
export const SEM_TEMPLATE_NA_META = 'sem template na Meta'

/** Motivo da linha cujo template pede o botão "Falar com a gente" sem o número na env. */
const SEM_ATENDIMENTO = 'falta o número de atendimento da escola na configuração (o modelo pede o "fale com a gente")'

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A sala do payload é do Google Meet? (vazio ou fora do Meet = sem botão de sala) */
const salaDoMeet = (p: Payload): string | null => (texto(p.meet_url) ? codigoDaSalaDoMeet(texto(p.meet_url)) : null)

/** A variante do catálogo para este aviso, ou null quando a chave não tem template. */
function varianteDe(chave: string, p: Payload, agora: DateTime): string | null {
  switch (chave) {
    case 'class-reminder': {
      if (p.marco === '48h' && texto(p.instance_id)) {
        const inicio = texto(p.starts_at_utc)
        const tz = texto(p.iana_tz)
        const rotulo = dayLabel(inicio, tz, agora)
        if (rotulo === 'HOJE') return '48h_hoje'
        if (rotulo === 'AMANHÃ') {
          // #115: o prazo (início − aviso mínimo) contra o INSTANTE do envio
          return prazoDoToqueDe48h(inicio, tz, agora) ? '48h_amanha' : '48h_amanha_sem_prazo'
        }
        return '48h_data'
      }
      if (p.marco === '2h') return salaDoMeet(p) ? '2h_com_link' : '2h_sem_link'
      return 'antigo'
    }
    case 'class-cancelled':
      return p.credited ? 'com_credito' : 'sem_credito'
    case 'reschedule-confirm':
      if (p.moved_by === 'teacher') return 'escola_moveu'
      return p.kind === 'redeem' ? 'reposicao' : 'remarcacao'
    case 'credit-expiry':
      return Number(p.n_credits ?? 1) === 1 ? 'um' : 'varios'
    case 'meeting-reminder':
      return salaDoMeet(p) ? 'com_link' : 'sem_link'
    case 'meeting-cancelled':
      return p.self ? 'aluno' : 'escola'
    default:
      return null
  }
}

/** dd/LL e HH:mm no fuso do destinatário; vazio quando o instante não vale. */
function diaEHora(isoUtc: string, tz: string): { dia: string; hora: string } {
  const dt = DateTime.fromISO(isoUtc).setZone(tz)
  return dt.isValid ? { dia: dt.toFormat('dd/LL'), hora: dt.toFormat('HH:mm') } : { dia: '', hora: '' }
}

/** Os valores possíveis, por NOME de parâmetro do catálogo. */
function valoresDe(
  chave: string,
  variante: string | null,
  p: Payload,
  f: FatosDoAviso,
  agora: DateTime,
): Record<string, string> {
  // encontro cancelado usa `scheduled_at`; o resto, `starts_at_utc`
  const inicio = chave === 'meeting-cancelled' ? texto(p.scheduled_at) : texto(p.starts_at_utc)
  const tz = texto(p.iana_tz)
  const { time, longDate } = localParts(inicio, tz, texto(p.local_time_snapshot))
  const validade = texto(p.expires_on)
  const valores: Record<string, string> = {
    nome: f.nome,
    professora: texto(p.teacher_name) || 'sua professora',
    dia_e_hora: longDate,
    hora: time,
    prazo: variante?.startsWith('48h') ? (prazoDoToqueDe48h(inicio, tz, agora) ?? '') : '',
    validade: validade && DateTime.fromISO(validade).isValid ? DateTime.fromISO(validade).toFormat('dd/LL/yyyy') : '',
    quantidade: String(Number(p.n_credits ?? 1)),
    numero_da_mentoria: String(Number(p.next_window ?? 1)),
    total_de_mentorias: String(Number(p.total_credits ?? 6)),
    whatsapp_atendimento: f.atendimentoUrl ?? '',
  }
  if (variante === 'escola_moveu') {
    // "sua aula de {data da aula} às {hora da aula}" — a hora é a da ORIGINAL
    const original = diaEHora(texto(p.original_starts_at_utc), tz)
    const nova = diaEHora(inicio, tz)
    valores.data_original = original.dia
    valores.hora = original.hora
    valores.nova_data = nova.dia
    valores.nova_hora = nova.hora
    // o nome humano da cidade (Cuiabá, Lisboa, Nova York), o mesmo da tela
    valores.cidade = tz ? tzLabel(tz) : ''
  }
  return valores
}

/** O sufixo de cada destino de botão (vazio quando o fato falta). */
function sufixosDe(p: Payload, f: FatosDoAviso): Record<DestinoDoBotao, string> {
  const instancia = texto(p.instance_id)
  // `https://wa.me/<número>` → `<número>`: só dígitos, ou nada
  const numero = (f.atendimentoUrl ?? '').replace(/^https:\/\/wa\.me\//, '')
  return {
    aula: texto(p.caminho_logado) || (instancia ? `portal/aula/${instancia}` : 'portal'),
    creditos: sufixoFixo('creditos') ?? '',
    mentoria: sufixoFixo('mentoria') ?? '',
    briefing: sufixoFixo('briefing') ?? '',
    briefing_atualizar: sufixoFixo('briefing_atualizar') ?? '',
    atendimento: /^\d+$/.test(numero) ? numero : '',
    sala: salaDoMeet(p) ?? '',
  }
}

/**
 * O template, os parâmetros e os botões deste aviso, ou o motivo de ele não
 * poder sair pela Meta (a linha fica presa com o motivo, nunca sai texto livre
 * nem mensagem sem o botão). As chaves da lista "sem template na Meta" o
 * despachante barra antes, com o motivo `SEM_TEMPLATE_NA_META`; aqui elas caem
 * em "sem modelo de WhatsApp".
 */
export function whatsappDoAviso(chave: string, payload: Payload, fatos: FatosDoAviso): WhatsappDoAviso {
  const daChave = templatesDaChave(chave)
  if (daChave.length === 0) {
    return { ok: false, motivo: 'este aviso não tem modelo de WhatsApp', detalhe: `chave ${chave} sem template no catálogo` }
  }
  const agora = fatos.agora ? DateTime.fromJSDate(fatos.agora) : DateTime.now()
  const variante = daChave.length === 1 ? daChave[0].variante : varianteDe(chave, payload, agora)
  const template = daChave.find((t) => t.variante === variante)
  if (!template) {
    return {
      ok: false,
      motivo: 'este aviso não tem modelo de WhatsApp para este caso',
      detalhe: `chave ${chave} sem a variante ${String(variante)}`,
    }
  }

  const todos = valoresDe(chave, template.variante, payload, fatos, agora)
  const valores = Object.fromEntries(template.parametros.map((p) => [p.nome, todos[p.nome] ?? '']))
  const vazio = template.parametros.find((p) => !valores[p.nome].trim())
  if (vazio) {
    const detalhe = `${template.nome}: parâmetro ${vazio.nome} vazio`
    if (vazio.nome === 'whatsapp_atendimento') {
      // a env é WHATSAPP_ATENDIMENTO_E164 (o nome fica no log, não na tela)
      return { ok: false, motivo: SEM_ATENDIMENTO, detalhe: `${detalhe} (WHATSAPP_ATENDIMENTO_E164 ausente)` }
    }
    if (vazio.nome === 'data_original' || (template.variante === 'escola_moveu' && vazio.nome === 'hora')) {
      return { ok: false, motivo: 'falta o horário da aula original para o aviso de aula remarcada pela escola', detalhe }
    }
    return { ok: false, motivo: 'falta um dado do aviso para montar o modelo da Meta', detalhe }
  }

  // #115: botão sem endereço não sai — o "Falar com a gente" sem o número na
  // env prende a linha (fail-closed), nunca manda a mensagem sem o botão
  const sufixos = sufixosDe(payload, fatos)
  const botaoVazio = template.botoes.find((b) => !sufixos[b.destino])
  if (botaoVazio) {
    const detalhe = `${template.nome}: botão ${botaoVazio.indice} (${botaoVazio.destino}) sem endereço`
    if (botaoVazio.destino === 'atendimento') {
      return { ok: false, motivo: SEM_ATENDIMENTO, detalhe: `${detalhe} (WHATSAPP_ATENDIMENTO_E164 ausente)` }
    }
    return { ok: false, motivo: 'falta o endereço de um botão do modelo da Meta', detalhe }
  }

  // Sala fora do Google Meet (decisão do dono, #115): o aviso sai na variante
  // sem botão de sala — a página da aula mostra o link — e o caso vai ao log.
  const observacao =
    texto(payload.meet_url) && !salaDoMeet(payload)
      ? `${template.nome}: o link da sala não é do Google Meet; saiu sem o botão de sala`
      : null

  try {
    return {
      ok: true,
      template,
      params: parametrosEmOrdem(template, valores),
      botoes: botoesEmOrdem(template, sufixos),
      texto: renderizarTemplate(template, valores),
      observacao,
    }
  } catch (err) {
    return {
      ok: false,
      motivo: 'um dado do aviso não cabe no modelo da Meta (vazio, com espaço ou com quebra de linha)',
      detalhe: err instanceof Error ? err.message : String(err),
    }
  }
}
