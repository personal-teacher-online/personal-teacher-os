import { DateTime } from 'luxon'
import { dayLabel, localParts } from '@/lib/email/class-notices'
import { tzLabel } from '@/lib/format'
import {
  parametrosEmOrdem,
  renderizarTemplate,
  templatesDaChave,
  type TemplateDeWhatsapp,
} from '@/lib/notify/whatsapp-templates'

// O aviso do outbox como TEMPLATE da Meta (ADR-038 · #43): qual variante do
// catálogo (`whatsapp-templates.ts`, a fonte única do texto) e com que valores.
// Função pura: o despachante injeta os fatos (payload, nome, links); Luxon só
// formata no fuso do destinatário (Lei 1), pelas mesmas funções do texto de
// antes (`localParts`, `dayLabel`). A escolha da variante espelha a do texto
// livre que saía pela Evolution, caso a caso.

type Payload = Record<string, unknown>

export interface FatosDoAviso {
  nome: string
  appUrl: string
  /** `https://wa.me/<número>` de atendimento, ou null sem a env */
  atendimentoUrl: string | null
}

export type WhatsappDoAviso =
  | { ok: true; template: TemplateDeWhatsapp; params: string[]; texto: string }
  | { ok: false; motivo: string }

/** Motivo da linha de WhatsApp cuja chave não tem template aprovado na Meta. */
export const SEM_TEMPLATE_NA_META = 'sem template na Meta'

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A variante do catálogo para este aviso, ou null quando a chave não tem template. */
function varianteDe(chave: string, p: Payload): string | null {
  switch (chave) {
    case 'class-reminder': {
      if (p.marco === '48h' && texto(p.instance_id)) {
        const rotulo = dayLabel(texto(p.starts_at_utc), texto(p.iana_tz))
        return rotulo === 'HOJE' ? '48h_hoje' : rotulo === 'AMANHÃ' ? '48h_amanha' : '48h_data'
      }
      if (p.marco === '2h') return texto(p.meet_url) ? '2h_com_link' : '2h_sem_link'
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
      return texto(p.meet_url) ? 'com_link' : 'sem_link'
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
function valoresDe(chave: string, variante: string | null, p: Payload, f: FatosDoAviso): Record<string, string> {
  // encontro cancelado usa `scheduled_at`; o resto, `starts_at_utc`
  const inicio = chave === 'meeting-cancelled' ? texto(p.scheduled_at) : texto(p.starts_at_utc)
  const tz = texto(p.iana_tz)
  const { time, longDate } = localParts(inicio, tz, texto(p.local_time_snapshot))
  const instancia = texto(p.instance_id)
  const linkDaAula =
    texto(p.magic_url) ||
    (instancia ? `${f.appUrl}/portal/aula/${instancia}` : variante?.startsWith('2h') ? `${f.appUrl}/portal` : '')
  const validade = texto(p.expires_on)
  const valores: Record<string, string> = {
    nome: f.nome,
    professora: texto(p.teacher_name) || 'sua professora',
    dia_e_hora: longDate,
    hora: time,
    link_da_aula: linkDaAula,
    link_da_sala: texto(p.meet_url),
    validade: validade && DateTime.fromISO(validade).isValid ? DateTime.fromISO(validade).toFormat('dd/LL/yyyy') : '',
    quantidade: String(Number(p.n_credits ?? 1)),
    numero_da_mentoria: String(Number(p.next_window ?? 1)),
    total_de_mentorias: String(Number(p.total_credits ?? 6)),
    whatsapp_atendimento: f.atendimentoUrl ?? '',
  }
  if (variante === 'escola_moveu') {
    // "Aula original: {data da aula} às {hora da aula}" — a hora é a da ORIGINAL
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

/**
 * O template e os parâmetros deste aviso, ou o motivo de ele não poder sair
 * pela Meta (a linha fica presa com o motivo, nunca sai texto livre). As
 * chaves da lista "sem template na Meta" o despachante barra antes, com o
 * motivo `SEM_TEMPLATE_NA_META`; aqui elas caem em "sem versão WhatsApp".
 */
export function whatsappDoAviso(chave: string, payload: Payload, fatos: FatosDoAviso): WhatsappDoAviso {
  const daChave = templatesDaChave(chave)
  if (daChave.length === 0) return { ok: false, motivo: `template ${chave} sem versão WhatsApp` }
  const variante = daChave.length === 1 ? daChave[0].variante : varianteDe(chave, payload)
  const template = daChave.find((t) => t.variante === variante)
  if (!template) return { ok: false, motivo: `template ${chave} sem variante de WhatsApp para este aviso` }

  const todos = valoresDe(chave, template.variante, payload, fatos)
  const valores = Object.fromEntries(template.parametros.map((p) => [p.nome, todos[p.nome] ?? '']))
  const vazio = template.parametros.find((p) => !valores[p.nome].trim())
  if (vazio) {
    return {
      ok: false,
      motivo:
        vazio.nome === 'whatsapp_atendimento'
          ? `sem o WhatsApp de atendimento na configuração (WHATSAPP_ATENDIMENTO_E164): o template ${template.nome} pede o número`
          : `falta ${vazio.nome} para o template ${template.nome}`,
    }
  }
  try {
    return {
      ok: true,
      template,
      params: parametrosEmOrdem(template, valores),
      texto: renderizarTemplate(template, valores),
    }
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) }
  }
}
