// A HORA CIVIL QUE O RELÓGIO DAQUELA CIDADE TEM — conferida ANTES de gravar.
//
// ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 2 do A4, grave 1) ──────────────
// O caminho de criação da agenda faz uma volta completa: o servidor manda o
// INSTANTE do slot em UTC, o balão o converte para os campos civis do fuso do
// aluno (`equivalente-no-fuso.ts`), a dona confirma, e a RPC reconstrói o
// instante com `(p_local_date + p_local_time) at time zone v_tz`. Nos dois dias
// do ano em que o relógio daquela cidade pula ou repete, essa volta NÃO fecha:
//
//   · HORA REPETIDA (fim do horário de verão). A dona toca 24/10/2026 20:30 em
//     Cuiabá — instante 25/10 00:30Z, que em Lisboa ainda é 01:30 de GMT+1. O
//     campo mostra "25/10 01:30". Só que 01:30 acontece DUAS vezes em Lisboa
//     naquela madrugada, e o `AT TIME ZONE` do Postgres resolve a ambiguidade
//     pelo offset PADRÃO (a segunda ocorrência): a aula nasce 01:30Z e aparece
//     21:30 em Cuiabá — uma hora DEPOIS do ponto que ela tocou.
//   · HORA INEXISTENTE (início do horário de verão). Se ela DIGITAR 29/03/2026
//     01:30 em Lisboa — hora que não existe, o relógio vai de 00:59 para 02:00 —
//     o Postgres aceita e a aula nasce às 02:30.
//
// Em ambos, o banco grava um instante que ninguém escolheu, sem erro nenhum.
//
// ── O QUE ESTE MÓDULO FAZ ───────────────────────────────────────────────────
// Refaz, no servidor e com Luxon, a MESMA conta que o Postgres faria — e recusa
// quando ela não tem resposta única. A conferência é de UNICIDADE do civil, e
// não de igualdade com o ponto tocado na grade: os campos de data e hora são
// EDITÁVEIS de propósito (a dona corrige o horário do aluno ali mesmo), então
// exigir que o resultado bata com o slot original reprovaria toda edição
// legítima. Hora ambígua e hora inexistente são exatamente os dois casos em que
// "converter de volta" não devolve o instante pretendido — que é o teste que o
// revisor pediu, escrito de um jeito que não pune quem edita.
//
// ── POR QUE AQUI, E NÃO NA RPC — LÁPIDE (a cura chegou na migration 98) ─────
// A CURA DE VERDADE ERA A RPC RECEBER O INSTANTE (`timestamptz`) EM VEZ DE DATA
// E HORA CIVIS, e ela FOI FEITA (A6/a, `20260730000100_a6_travas_de_agenda.sql`):
// `admin_create_single_class`, `admin_create_trial_class` e
// `publish_reschedule_window` recebem `p_starts_at_utc` e derivam o
// `local_time_snapshot` lá dentro. Enquanto a assinatura pedia
// `p_local_date`/`p_local_time`, a informação de QUAL das duas ocorrências a
// dona quis se perdia antes de chegar ao banco, e nenhuma trava do lado de cá
// recuperava — este módulo só conseguia RECUSAR.
//
// O QUE MUDA NO PAPEL DELE: de porteiro opcional a etapa OBRIGATÓRIA do ato. É
// aqui que a conversão civil→instante acontece, uma vez só, e é daqui que sai o
// valor que a RPC grava. Recusar hora inexistente/ambígua continua sendo o
// serviço (Lei 3: a UI antecipa, o banco decide) — o que deixou de existir é o
// caminho em que a recusa falha e o banco grava um instante que ninguém escolheu.
//
// Lei 1 preservada: nada de offset fixo, nada de aritmética manual de horas — o
// offset é sempre o DAQUELE instante, lido da base IANA pelo Luxon, e a zona
// chega SEMPRE explícita (nunca a do processo).
//
// ── RISCO QUE ERA CONHECIDO E FOI FECHADO NA RAIZ: tzdata DIVERGENTE ────────
// (revisão independente do A4, 29/07 — medido lá, curado no A6.) O veredicto
// deste módulo sai da base IANA que o NODE carrega (ICU embutido); a RPC
// RECONSTRUÍA o instante com a base IANA do HOST do Postgres (zoneinfo do
// sistema), e as duas podem estar em versões diferentes. Caso medido:
// `America/Vancouver` em 15/11/2026 — Node/ICU 2026a devolveu UTC−8 e a
// zoneinfo do host devolveu UTC−7. Nenhuma trava DESTE lado resolvia: as duas
// metades da conta usavam bases diferentes por construção.
// A cura foi eliminar a segunda metade — as RPCs recebem o INSTANTE (A6/a). O
// Postgres continua usando a zoneinfo dele para o SNAPSHOT textual (que é
// auditoria, não decisão) e para a expansão de recorrência; o instante da aula
// avulsa, da experimental e da janela publicada é decidido de um lado só.

import { DateTime, IANAZone } from 'luxon'

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^\d{2}:\d{2}$/
const UM_DIA_MS = 86_400_000

export type VeredictoDoCivil =
  /** a data+hora existe uma vez só naquela zona: este é o instante que o banco vai gravar */
  | { ok: true; instanteUtc: string }
  /** data/hora fora do formato, ou dia que não existe no calendário (30/02) */
  | { ok: false; motivo: 'formato' }
  /** zona IANA desconhecida */
  | { ok: false; motivo: 'zona' }
  /** o relógio daquela cidade PULOU essa hora (início do horário de verão) */
  | { ok: false; motivo: 'inexistente'; viraria: string }
  /** o relógio daquela cidade REPETE essa hora (fim do horário de verão) */
  | { ok: false; motivo: 'ambigua'; primeiro: string; segundo: string }

/**
 * A data e a hora civis `data`/`hora` na zona `iana` — se elas existirem lá uma
 * vez só.
 *
 * O algoritmo é o padrão da conversão civil→instante com base IANA (o mesmo que
 * `js-joda` e `date-fns-tz` usam): tomar a hora civil como se fosse UTC, provar
 * os DOIS offsets vizinhos (o do dia anterior e o do dia seguinte) e verificar
 * qual dos dois candidatos é consistente consigo mesmo.
 *   · nenhum consistente  → a hora não existe (o relógio pulou por cima);
 *   · os dois, e distintos → a hora acontece duas vezes (o relógio repetiu);
 *   · um só               → resposta única, que é o caso de 363 dias por ano.
 *
 * ── QUANDO A SONDA DE ±24h VALE (o fato medido, não a hipótese) ─────────────
 * A versão anterior deste comentário deixava implícito que uma transição a mais
 * de 24h de distância quebraria a sonda. NÃO quebra: as duas provas são
 * INDEPENDENTES uma da outra, e basta que cada offset vizinho seja o offset
 * REALMENTE vigente na sua ponta. A sonda só erra quando existem DUAS
 * transições dentro da janela de 48h (regua−24h … regua+24h) — aí o regime
 * INTERMEDIÁRIO (o que vale na hora consultada) não aparece em nenhuma das duas
 * pontas e fica invisível.
 *
 * Isso foi MEDIDO, não suposto (revisão independente do A4, 29/07): 418 zonas
 * IANA varridas entre 1800 e 2100, incluindo os casos que costumam quebrar
 * implementação (Lord Howe com 30min, Chatham com 45min, Índia, Nepal — com a
 * sobreposição histórica de 11min16s —, o salto de 8min50s de Kolkata, Samoa e
 * Kwajalein pulando um dia inteiro, Lisboa, Marrocos e Irã). NENHUMA zona real
 * foi classificada errado, e a MENOR separação entre duas transições
 * consecutivas em toda a varredura foi de 166 HORAS (`America/Cambridge_Bay`) —
 * quase 3,5× a janela de 48h. A margem é grande e histórica; se um dia a base
 * IANA ganhar duas transições em menos de 48h, a sonda precisa virar busca
 * binária de transição.
 */
export function conferirHoraCivil(data: string, hora: string, iana: string): VeredictoDoCivil {
  if (!RE_DATA.test(data) || !RE_HORA.test(hora)) return { ok: false, motivo: 'formato' }
  if (!iana) return { ok: false, motivo: 'zona' }
  const zona = IANAZone.create(iana)
  if (!zona.isValid) return { ok: false, motivo: 'zona' }

  const [ano, mes, dia] = data.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  // A hora civil LIDA COMO SE FOSSE UTC: é só um número de milissegundos usado
  // como régua, nunca um instante que alguém vá gravar. `DateTime.utc` recusa
  // 30/02 e 25:00, que é a validação de calendário que falta ao regex.
  const comoUtc = DateTime.utc(ano, mes, dia, hh, mm)
  if (!comoUtc.isValid) return { ok: false, motivo: 'formato' }
  const regua = comoUtc.toMillis()

  const offAntes = zona.offset(regua - UM_DIA_MS)
  const offDepois = zona.offset(regua + UM_DIA_MS)
  const candidatoAntes = regua - offAntes * 60_000
  const candidatoDepois = regua - offDepois * 60_000
  const valeAntes = zona.offset(candidatoAntes) === offAntes
  const valeDepois = zona.offset(candidatoDepois) === offDepois

  if (!valeAntes && !valeDepois) {
    // O relógio pulou por cima desta hora. `viraria` é onde ela CAI se alguém
    // gravar assim mesmo — é o número que a dona veria na agenda depois.
    const viraria = DateTime.fromMillis(candidatoAntes, { zone: iana }).toFormat('HH:mm')
    return { ok: false, motivo: 'inexistente', viraria }
  }
  if (valeAntes && valeDepois && candidatoAntes !== candidatoDepois) {
    const [a, b] = [candidatoAntes, candidatoDepois].sort((x, y) => x - y)
    return {
      ok: false,
      motivo: 'ambigua',
      primeiro: DateTime.fromMillis(a, { zone: 'utc' }).toISO()!,
      segundo: DateTime.fromMillis(b, { zone: 'utc' }).toISO()!,
    }
  }
  const escolhido = valeAntes ? candidatoAntes : candidatoDepois
  return { ok: true, instanteUtc: DateTime.fromMillis(escolhido, { zone: 'utc' }).toISO()! }
}

/**
 * A FRASE que a tela mostra quando a conferência recusa — no tom da casa
 * ("Falha: …" é responsabilidade de quem chama), dizendo o que aconteceu e o que
 * fazer. `cidade` é o nome humano da zona ("Lisboa"), nunca o IANA cru.
 */
export function recusaDaHoraCivil(v: VeredictoDoCivil, cidade: string, hora: string): string | null {
  if (v.ok) return null
  if (v.motivo === 'formato') return 'data ou hora inválida — confira os dois campos.'
  if (v.motivo === 'zona') return 'não deu para saber o fuso desta aula — recarregue a página.'
  if (v.motivo === 'inexistente')
    return (
      `nesse dia o horário de verão COMEÇA em ${cidade} e o relógio de lá pula essa hora — ` +
      `${hora} não existe em ${cidade}, e a aula nasceria às ${v.viraria}. ` +
      'Escolha outro horário. Nada foi criado.'
    )
  return (
    `em ${cidade} o horário de verão termina nesse dia e ${hora} acontece DUAS vezes — ` +
    'não dá para saber qual das duas você quis, e o banco escolheria a segunda (uma hora ' +
    'depois do ponto que você tocou na grade). Escolha um horário fora dessa madrugada. ' +
    'Nada foi criado.'
  )
}
