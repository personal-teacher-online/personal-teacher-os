import { describe, expect, it } from 'vitest'
import { agruparCreditos, type CreditoVencendo } from '../src/lib/credit-groups.ts'

const cr = (p: Partial<CreditoVencendo> & { ledger_id: number }): CreditoVencendo => ({
  contract_id: 'c1',
  student_id: 's1',
  who: 'Murilo Fonseca',
  expires_on: '2026-07-31',
  duration_min: 50,
  situation: 'vencendo',
  ...p,
})

describe('agrupamento dos créditos vencendo', () => {
  it('junta os 4 créditos do mesmo aluno numa linha só — o ruído da varredura', () => {
    const g = agruparCreditos([cr({ ledger_id: 1 }), cr({ ledger_id: 2 }), cr({ ledger_id: 3 }), cr({ ledger_id: 4 })])
    expect(g).toHaveLength(1)
    expect(g[0].total).toBe(4)
    expect(g[0].mesmaData).toBe(true)
  })

  it('NÃO funde os lançamentos — cada crédito segue com o seu ledger_id', () => {
    const g = agruparCreditos([cr({ ledger_id: 1 }), cr({ ledger_id: 2 })])
    expect(g[0].itens.map((i) => i.ledger_id)).toEqual([1, 2])
  })

  it('datas diferentes: o cabeçalho não pode fingir uma só', () => {
    const g = agruparCreditos([
      cr({ ledger_id: 1, expires_on: '2026-07-31' }),
      cr({ ledger_id: 2, expires_on: '2026-08-15' }),
    ])
    expect(g[0].mesmaData).toBe(false)
    expect(g[0].proximaData).toBe('2026-07-31')
  })

  it('vencido vem primeiro, depois por data, depois por nome', () => {
    const g = agruparCreditos([
      cr({ ledger_id: 1, student_id: 'b', who: 'Zeca', expires_on: '2026-08-01' }),
      cr({ ledger_id: 2, student_id: 'a', who: 'Ana', expires_on: '2026-07-25' }),
      cr({ ledger_id: 3, student_id: 'c', who: 'Bia', expires_on: '2026-09-01', situation: 'vencido' }),
    ])
    expect(g.map((x) => x.who)).toEqual(['Bia', 'Ana', 'Zeca'])
    expect(g[0].algumVencido).toBe(true)
  })

  it('aluno sem id (contrato de grupo) agrupa pelo nome, sem misturar com outro', () => {
    const g = agruparCreditos([
      cr({ ledger_id: 1, student_id: null, who: 'Natália e Yago (casal)' }),
      cr({ ledger_id: 2, student_id: null, who: 'Natália e Yago (casal)' }),
      cr({ ledger_id: 3, student_id: null, who: 'Outro casal' }),
    ])
    expect(g).toHaveLength(2)
    expect(g.find((x) => x.who.startsWith('Natália'))?.total).toBe(2)
  })

  it('lista vazia não quebra', () => {
    expect(agruparCreditos([])).toEqual([])
  })
})
