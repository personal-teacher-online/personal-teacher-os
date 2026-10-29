// Issue #40 · gate Sol, rodada 2 — o recorte por dia civil de EXIBIÇÃO da
// expansão semanal compartilhada (`src/lib/agenda/janelas-semanais.ts`).
//
// A grade indexa evento pelo dia do INÍCIO: uma ocorrência que atravessa a
// meia-noite do fuso de exibição tem de sair em dois pedaços, cortados na
// meia-noite DE VERDADE do dia seguinte, também no dia em que o relógio de
// exibição pula a meia-noite. Função pura, datas de exemplo fixas no futuro
// (é a tabela IANA que se testa, não o relógio).
import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'

import { expandirJanelasSemanais } from '@/lib/agenda/janelas-semanais'

const pedacos = (
  w: { weekday: number; start_local: string; end_local: string; iana_tz: string },
  semanaDe: string,
  zonaDeExibicao: string,
) => {
  const inicio = DateTime.fromISO(semanaDe, { zone: zonaDeExibicao })
  const fim = inicio.plus({ days: 7 })
  return expandirJanelasSemanais([{ id: 'w', ...w }], inicio, fim, zonaDeExibicao).map((o) => ({
    id: o.id,
    de: DateTime.fromISO(o.inicioUtc).toUTC().toISO(),
    ate: DateTime.fromISO(o.fimUtc).toUTC().toISO(),
  }))
}

describe('#40 · recorte por dia de exibição', () => {
  it('Cairo pula a meia-noite (28/04/2028 começa às 01:00): sexta 23:30 → sábado 00:30 vira dois pedaços', () => {
    // Janela gravada em UTC, sexta 20:30–21:30. No Cairo (EEST, +3 desde a
    // 01:00 de sexta) é sexta 23:30 → sábado 00:30; a meia-noite de sábado é
    // 21:00Z. Somar um dia ao `startOf('day')` de sexta (que cai às 01:00)
    // cortava às 22:00Z: um pedaço só, preso à sexta.
    const saida = pedacos(
      { weekday: 5, start_local: '20:30:00', end_local: '21:30:00', iana_tz: 'UTC' },
      '2028-04-24',
      'Africa/Cairo',
    )
    expect(saida).toEqual([
      { id: 'w:2028-04-28', de: '2028-04-28T20:30:00.000Z', ate: '2028-04-28T21:00:00.000Z' },
      { id: 'w:2028-04-29', de: '2028-04-28T21:00:00.000Z', ate: '2028-04-28T21:30:00.000Z' },
    ])
  })

  it('janela de NY vista em Lisboa (Lisboa à frente): terça 18:30–19:30 EST = 23:30 → 00:30 em Lisboa', () => {
    const saida = pedacos(
      { weekday: 2, start_local: '18:30:00', end_local: '19:30:00', iana_tz: 'America/New_York' },
      '2028-01-10',
      'Europe/Lisbon',
    )
    expect(saida).toEqual([
      { id: 'w:2028-01-11', de: '2028-01-11T23:30:00.000Z', ate: '2028-01-12T00:00:00.000Z' },
      { id: 'w:2028-01-12', de: '2028-01-12T00:00:00.000Z', ate: '2028-01-12T00:30:00.000Z' },
    ])
  })

  it('janela de Lisboa vista em NY (NY atrás): quarta 04:30–05:30 WET = 23:30 → 00:30 em NY', () => {
    const saida = pedacos(
      { weekday: 3, start_local: '04:30:00', end_local: '05:30:00', iana_tz: 'Europe/Lisbon' },
      '2028-01-10',
      'America/New_York',
    )
    expect(saida).toEqual([
      { id: 'w:2028-01-11', de: '2028-01-12T04:30:00.000Z', ate: '2028-01-12T05:00:00.000Z' },
      { id: 'w:2028-01-12', de: '2028-01-12T05:00:00.000Z', ate: '2028-01-12T05:30:00.000Z' },
    ])
  })
})
