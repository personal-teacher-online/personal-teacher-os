// F1 (Onda Financeiro) — a tradução nome → frase da tela do ADMIN é pura e
// cobre o vocabulário INTEIRO do banco. O contrato espelha o do portal
// (`portal-p5`): a tela não decide nada; nome fora do vocabulário cai em
// "situação a confirmar", nunca herda outro desfecho.
import { describe, expect, it } from 'vitest'
import {
  rotuloAdminDaCobranca,
  situacaoDaView,
  type SituacaoDaCobranca,
} from '@/lib/admin/financeiro-rotulos'

const VOZES_DO_BANCO: SituacaoDaCobranca[] = [
  'paga',
  'em_aberto',
  'em_atraso',
  'estornada',
  'estorno_parcial',
  'estorno_em_andamento',
  'em_disputa',
  'cancelada',
]

describe('rótulos do Financeiro (admin)', () => {
  it('toda voz do banco tem frase própria — nenhuma herda de outra', () => {
    const frases = VOZES_DO_BANCO.map((v) => rotuloAdminDaCobranca(v).frase)
    expect(new Set(frases).size).toBe(VOZES_DO_BANCO.length)
  })

  it('só "paga" é verde; só "em_atraso" é vermelha; disputa é o único aviso', () => {
    for (const v of VOZES_DO_BANCO) {
      const r = rotuloAdminDaCobranca(v)
      expect(r.tom === 'ok').toBe(v === 'paga')
      expect(r.tom === 'danger').toBe(v === 'em_atraso')
      expect(r.tom === 'warn').toBe(v === 'em_disputa')
    }
  })

  it('nome desconhecido da view NUNCA vira desfecho — cai em "a confirmar"', () => {
    expect(situacaoDaView('status_que_o_asaas_inventou')).toBe('desconhecida')
    expect(situacaoDaView(null)).toBe('desconhecida')
    expect(situacaoDaView(undefined)).toBe('desconhecida')
    expect(rotuloAdminDaCobranca('desconhecida').frase).toBe('situação a confirmar')
  })

  it('nomes do banco passam intactos pelo normalizador', () => {
    for (const v of VOZES_DO_BANCO) expect(situacaoDaView(v)).toBe(v)
  })
})
