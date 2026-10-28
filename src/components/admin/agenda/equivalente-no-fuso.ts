'use client'

// fuso-ok-arquivo: converter um INSTANTE (UTC, vindo pronto do servidor) para os
// campos civis de uma zona IANA EXPLÍCITA é a função deste módulo — não há como
// fazê-la no servidor, porque ela roda quando a dona TROCA o contrato ou a
// cidade dentro do balão, sem ida e volta. A régua da Lei 1 está preservada em
// tudo o que importa: (1) nada aqui lê o fuso do NAVEGADOR — a zona chega sempre
// como parâmetro (`America/Sao_Paulo`, `Europe/Lisbon`); (2) nada aqui usa
// offset fixo — o `Intl.DateTimeFormat` com `timeZone` resolve o offset DAQUELE
// instante, atravessando DST corretamente; (3) o instante UTC de origem é
// calculado no SERVIDOR com Luxon (`slotEmUtc` em src/data/admin/agenda.ts é a
// mesma conta do banco: `(date + time) at time zone tz`), porque a conversão
// inversa (civil → instante) é a que exige biblioteca.
//
// O DEFEITO QUE ISTO CONSERTA (Sol · rodada 1 do A4, grave 3). Os campos de
// data/hora da avulsa e da experimental nasciam com os MESMOS ALGARISMOS do slot
// de Cuiabá. A dona tocava 14:00, escolhia um contrato de São Paulo e
// confirmava: os campos valem no fuso do ALUNO (desde o A6 quem converte
// civil→instante é a action, na zona do contrato; a RPC recebe o instante), então
// a aula nascia às 14:00 de São Paulo — 13:00 no ponto da grade que ela tocou.
// O cabeçalho, enquanto isso, continuava dizendo "14:00 (Cuiabá)".

/** Os campos civis de um instante numa zona: o que vai nos campos do formulário. */
export interface CamposLocais {
  /** 'yyyy-LL-dd' */
  data: string
  /** 'HH:mm' */
  hora: string
}

/**
 * O instante `instanteUtc` visto na zona `iana` — em data e hora civis.
 *
 * Zona desconhecida/inválida devolve `null` (o chamador então NÃO mexe nos
 * campos): mentir um horário é pior que não recalcular.
 */
export function equivalenteNoFuso(instanteUtc: string, iana: string): CamposLocais | null {
  if (!instanteUtc || !iana) return null
  const ms = Date.parse(instanteUtc)
  if (Number.isNaN(ms)) return null
  let partes: Intl.DateTimeFormatPart[]
  try {
    partes = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // `hourCycle: 'h23'` e não `hour12: false`: em ICU antigo o segundo produz
      // "24" na meia-noite, e "24:00" não é hora válida para o `TimeField`.
      hourCycle: 'h23',
    }).formatToParts(new Date(ms))
  } catch {
    return null
  }
  const de = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? ''
  const [ano, mes, dia, hora, minuto] = [de('year'), de('month'), de('day'), de('hour'), de('minute')]
  if (!ano || !mes || !dia || !hora || !minuto) return null
  return { data: `${ano}-${mes}-${dia}`, hora: `${hora}:${minuto}` }
}

/** Só o dia civil (o bloqueio é diário — a hora do slot não participa). */
export function diaCivilNoFuso(instanteUtc: string, iana: string): string | null {
  return equivalenteNoFuso(instanteUtc, iana)?.data ?? null
}

/** 'yyyy-LL-dd' → 'dd/mm/aaaa'. Remontagem de string, não formatação de data:
 *  nenhum calendário, nenhum locale, nenhum relógio do navegador envolvido. */
export function diaEmBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
