import { DateTime } from 'luxon'

import { instanteNaPrimeiraPassagem } from '@/lib/admin/hora-civil'

// A expansão da disponibilidade SEMANAL em ocorrências desenháveis, usada pela
// grade da dona (`src/data/admin/agenda.ts`, exibição em BUSINESS_TZ) e pelo
// painel da professora (`src/app/teacher/page.tsx`, exibição no fuso dela).
// Mora aqui desde a issue #40 (gate Sol, S1): o painel convertia a janela no
// fuso ATUAL da professora (`teachers.iana_tz`) e não no fuso GRAVADO na linha
// (`w.iana_tz`), que é o que `_teacher_available_for` usa no banco.

/** Uma linha de `teacher_weekly_availability`, na projeção que a expansão lê. */
export interface JanelaSemanalCrua {
  id: string
  /** 0 = domingo (convenção do banco) */
  weekday: number
  start_local: string
  end_local: string
  iana_tz: string
}

/** Um pedaço desenhável, recortado por dia civil de EXIBIÇÃO. */
export interface OcorrenciaDeJanela {
  id: string
  inicioUtc: string
  fimUtc: string
}

/**
 * LEI 1 — A ARMADILHA NOMEADA DO A3. A grade exibe em `zonaDeExibicao`, mas a
 * janela semanal mora na ZONA DA LINHA (`w.iana_tz` — a professora pode estar
 * em outro fuso, F3-D2). A expansão itera DIAS CIVIS na zona da janela, casa o
 * weekday na convenção do banco (Luxon 1–7 seg–dom → 0 = domingo, o mesmo
 * `% 7` de `src/lib/agenda/ocupacao-fuso.ts`) e constrói cada instante com o
 * offset DAQUELE dia (`DateTime.fromISO` na zona da linha). Offset fixo aqui
 * mostraria a janela uma hora fora durante metade do ano para professora em
 * zona com DST — e o teste de mutação do a3 cobra exatamente isso.
 *
 * Ressalva honesta (espírito de `ocupacao-fuso.ts`): em hora local AMBÍGUA ou
 * INEXISTENTE (o dia em que o relógio da zona repete ou pula), Luxon escolhe
 * uma leitura e o Postgres poderia escolher outra. Concretamente (medido, e
 * cristalizado no a3 · "DST além do caso fácil"): hora que NÃO EXISTE no
 * spring-forward é empurrada gap adiante (02:30 de NY em 14/03 vira 03:30
 * EDT — a janela daquele dia encolhe em vez de sumir ou estourar); janela
 * INTEIRA dentro do gap (02:30→03:30) tem os DOIS limites normalizados para
 * o MESMO instante e a ocorrência daquele dia é DESCARTADA pelo `a >= b` —
 * some da grade naquele domingo (residual aceito, cristalizado no a3); hora
 * AMBÍGUA no fall-back fica com a PRIMEIRA leitura do relógio (01:30 de NY em
 * 07/11 é lida no offset de verão, −4) — escolhida EXPLICITAMENTE em
 * `instanteNaPrimeiraPassagem` (issue #40): o `fromISO` sozinho parte do offset de AGORA
 * e trocava de leitura conforme a época em que o servidor roda. O `AT TIME
 * ZONE` do Postgres pode divergir na ambígua (ele prefere o offset
 * PÓS-transição). Esse residual é
 * ACEITO: não há instância do banco para ler — esta camada é ANTECIPAÇÃO
 * visual; quem decide reserva de verdade é `_teacher_available_for`, dentro
 * do banco (Lei 3), e o erro visual possível é de 1h em 2 dias/ano, no fuso
 * de professora estrangeira.
 *
 * RECORTE FINAL (Sol · rodada 1 do A3, item 1 — grave): a EXPANSÃO é por dia
 * civil na zona DA LINHA (Lei 1 intacta), mas a ocorrência sai daqui RECORTADA
 * por dia civil de EXIBIÇÃO em `zonaDeExibicao` — o mesmo tratamento de
 * `pedacosDosBloqueios`. O motor da grade indexa evento pelo DIA do início:
 * sem o recorte, Lisboa dom 02:00–06:00 no inverno (= sáb 22:00 → dom 02:00
 * em Cuiabá) era desenhada só no sábado e o domingo SUMIA.
 */
export function expandirJanelasSemanais(
  janelas: JanelaSemanalCrua[],
  inicio: DateTime,
  fim: DateTime,
  zonaDeExibicao: string,
): OcorrenciaDeJanela[] {
  const saida: OcorrenciaDeJanela[] = []
  for (const w of janelas) {
    // Um dia de folga de cada lado: o dia civil na zona da linha pode começar
    // antes (ou depois) do intervalo visível na exibição e ainda produzir
    // ocorrência que o recorte aproveita.
    let dia = inicio.setZone(w.iana_tz).startOf('day').minus({ days: 1 })
    const ultimo = fim.setZone(w.iana_tz).startOf('day').plus({ days: 1 })
    if (!dia.isValid || !ultimo.isValid)
      throw new Error(`Agenda: fuso inválido na janela semanal ${w.id}: "${w.iana_tz}"`)
    for (; dia <= ultimo; dia = dia.plus({ days: 1 })) {
      if (dia.weekday % 7 !== w.weekday) continue
      const ini = instanteNaPrimeiraPassagem(dia.toISODate()!, w.start_local, w.iana_tz)
      const fimJanela = instanteNaPrimeiraPassagem(dia.toISODate()!, w.end_local, w.iana_tz)
      // O Zod já garantiu a FORMA (HH:MM[:SS[.fff]]); o que ainda invalidaria
      // o instante é hora fora da faixa DE VERDADE ('25:00', '99:99'). '24:00'
      // — que o `time` do Postgres aceita — NÃO cai aqui: medido no Luxon
      // 3.7.2 (Sol · rodada 4), `T24:00` é VÁLIDO e normaliza para a meia-noite
      // do dia SEGUINTE, exatamente a semântica de uma janela que termina no
      // fim do dia. O `continue` silencioso morreu (Sol · rodada 3 do A3):
      // linha que não dá para desenhar ESTOURA, nunca some da grade.
      if (!ini.isValid || !fimJanela.isValid)
        throw new Error(
          `Agenda: hora local inválida na janela semanal ${w.id}: "${w.start_local}"–"${w.end_local}"`,
        )
      // recorte ao intervalo visível [inicio, fim) — fim EXCLUSIVO, a
      // convenção única da seção
      const a = DateTime.max(ini, inicio)
      const b = DateTime.min(fimJanela, fim)
      if (a >= b) continue
      // pedaços por dia civil de EXIBIÇÃO (ver o cabeçalho): o id carrega o
      // dia de `zonaDeExibicao` — ocorrências semanais distam 7 dias, então
      // não colidem
      let corte = a
      while (corte < b) {
        const dataExib = corte.setZone(zonaDeExibicao).toISODate()!
        // A borda é a meia-noite do DIA CIVIL seguinte, calculada pela data e
        // não somando 24h ao `startOf('day')`: no dia em que o relógio de
        // exibição pula a meia-noite (Cairo, 28/04/2028 começa às 01:00), o
        // `startOf` cai às 01:00 e "+1 dia" passava da meia-noite seguinte
        // (gate Sol, rodada 2 do #40).
        const dataSeguinte = DateTime.fromISO(dataExib, { zone: 'utc' }).plus({ days: 1 }).toISODate()!
        const z = DateTime.min(instanteNaPrimeiraPassagem(dataSeguinte, '00:00', zonaDeExibicao), b)
        saida.push({
          id: `${w.id}:${dataExib}`,
          inicioUtc: corte.toUTC().toISO()!,
          fimUtc: z.toUTC().toISO()!,
        })
        corte = z
      }
    }
  }
  return saida
}
