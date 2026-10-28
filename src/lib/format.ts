import { DateTime } from 'luxon'

// Lei 1: Luxon SÓ formata instantes para exibição — nenhum cálculo de agenda aqui.
// Regra da reforma: NUNCA expor data ISO nem nome IANA cru na interface — todo
// fuso vira nome de cidade humano (tzLabel) e toda data vira pt-BR legível.

/** "sexta, 14/11 às 11:00" na zona dada, pt-BR. */
export function fmtLocal(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc).setZone(zone).setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")
}

/** "14/11/2026" na zona dada. */
export function fmtLocalDate(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc).setZone(zone).setLocale('pt-BR').toFormat('dd/LL/yyyy')
}

/** Data civil (YYYY-MM-DD, ex.: expires_on) → "dd/mm/yyyy" sem conversão de fuso. */
export function fmtCivilDate(isoDate: string): string {
  return DateTime.fromISO(isoDate).setLocale('pt-BR').toFormat('dd/LL/yyyy')
}

/** Data civil → "sex, 14/11" (curta, com dia da semana). */
export function fmtCivilShort(isoDate: string): string {
  return DateTime.fromISO(isoDate).setLocale('pt-BR').toFormat('ccc, dd/LL')
}

/** "HH:mm" na zona dada. */
export function fmtTime(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc).setZone(zone).toFormat('HH:mm')
}

/* ---------------------------------------------------------------------------
   Fusos com nome humano. O banco continua guardando IANA (Lei 1); a interface
   mostra cidade. Fora do mapa, cai no último segmento com "_" → espaço.
   ------------------------------------------------------------------------- */

const TZ_NAME: Record<string, string> = {
  'America/Cuiaba': 'Cuiabá',
  'America/Sao_Paulo': 'São Paulo',
  'America/Manaus': 'Manaus',
  'America/Fortaleza': 'Fortaleza',
  'America/Recife': 'Recife',
  'America/Bahia': 'Salvador',
  'America/Campo_Grande': 'Campo Grande',
  'America/Belem': 'Belém',
  'America/New_York': 'Nova York',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Los_Angeles': 'Los Angeles',
  'Europe/Lisbon': 'Lisboa',
  'Europe/London': 'Londres',
  'Europe/Madrid': 'Madri',
  'Europe/Paris': 'Paris',
  'Europe/Dublin': 'Dublin',
}

/** "America/Cuiaba" → "Cuiabá". Nunca mostrar o IANA cru na UI. */
export function tzLabel(iana: string): string {
  if (TZ_NAME[iana]) return TZ_NAME[iana]
  const city = iana.split('/').pop() ?? iana
  return city.replace(/_/g, ' ')
}

/** "horário de Cuiabá" — sufixo padrão para horas exibidas. */
export function tzSuffix(iana: string): string {
  return `horário de ${tzLabel(iana)}`
}

/** Hora local do ALUNO por extenso: "qui, 23/07 às 15:30 (horário de Cuiabá)".
 *  Substitui o antigo "aluno: 2026-07-23 15:30 America/Cuiaba". */
export function fmtStudentLocal(isoUtc: string, studentTz: string): string {
  const t = DateTime.fromISO(isoUtc).setZone(studentTz).setLocale('pt-BR')
  return `${t.toFormat("ccc, dd/LL 'às' HH:mm")} (${tzSuffix(studentTz)})`
}

/** Centavos → "R$ 1.234,56". Dinheiro NUNCA em float (Lei 9). */
export function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * "1 novo · nenhum encerrado" — entradas e saídas de contrato EM PALAVRAS
 * (clonagem TutorBird, 26/07/2026). A régua do dono é que o resumo se leia em
 * voz alta: "+1 · −0" é notação de planilha, e zero vira "nenhum", não "0".
 */
export function entradasSaidasEmPalavras(novos: number, encerrados: number): string {
  const parte = (n: number, singular: string, plural: string) =>
    n === 0 ? `nenhum ${singular}` : n === 1 ? `1 ${singular}` : `${n} ${plural}`
  return `${parte(novos, 'novo', 'novos')} · ${parte(encerrados, 'encerrado', 'encerrados')}`
}
