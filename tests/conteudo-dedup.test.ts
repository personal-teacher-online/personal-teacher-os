// DEDUP TEMÁTICA (Leva 0.4, ADR-034) — o LIMIAR provado com vetores REAIS.
//
// Os vetores vêm de `tests/fixtures/dedup-vetores.json`: o acervo REAL
// parqueado na Leva 0.2 (44 temas+premissas) + 2 pares EN sintéticos,
// embedados UMA vez por `scripts/dedup-fixtures.ts` com o MESMO texto da
// produção (tema + premissa). Nenhum teste chama API.
//
// A parte que rodava contra o banco morreu na Leva 6.2 com o Portão 1 — ver a
// nota no fim do arquivo.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cosseno, LIMIAR_DEDUP } from '@/lib/research/dedup'

interface CasoFixture {
  id: string
  familia: string
  tema: string
  premissa: string
}
interface Fixture {
  casos: CasoFixture[]
  vetores: Record<string, number[]>
}

const fx: Fixture = JSON.parse(
  readFileSync(new URL('./fixtures/dedup-vetores.json', import.meta.url), 'utf8'),
)
const v = (id: string): number[] => fx.vetores[id]

// As duplicatas FLAGRANTES — um par por família real do acervo (a reclamação
// que motivou a leva), mais os DOIS pares PT×EN (a tese cross-language do
// ADR-034, provada em ato — achado nº 3 do Sol).
const FLAGRANTES: Array<[string, string]> = [
  ['what-1', 'what-3'],
  ['iwant-1', 'iwant-3'],
  ['rotina-2', 'rotina-4'],
  ['imigracao-2', 'imigracao-3'],
  ['hotel-1', 'hotel-2'],
  ['what-1', 'what-en'],
  ['iwant-1', 'iwant-en'],
]

describe('o limiar, contra os vetores reais (medição de 03/08/2026)', () => {
  it('o valor está CRAVADO — mudar o limiar exige remedir, não só editar a constante', () => {
    expect(LIMIAR_DEDUP).toBe(0.83)
  })

  it('as duplicatas flagrantes (incl. os pares PT×EN) ficam acima do limiar', () => {
    for (const [a, b] of FLAGRANTES) {
      const sim = cosseno(v(a), v(b))
      expect(sim, `${a} × ${b} = ${sim.toFixed(3)}`).toBeGreaterThanOrEqual(LIMIAR_DEDUP)
    }
  })

  it('NENHUM par de famílias distintas alcança o limiar (teto inter medido: 0,822)', () => {
    for (let i = 0; i < fx.casos.length; i++) {
      for (let j = i + 1; j < fx.casos.length; j++) {
        const a = fx.casos[i]
        const b = fx.casos[j]
        if (a.familia === b.familia) continue
        const sim = cosseno(v(a.id), v(b.id))
        expect(sim, `${a.id} × ${b.id} = ${sim.toFixed(3)}`).toBeLessThan(LIMIAR_DEDUP)
      }
    }
  })

  it('ESCOLHA DECLARADA: família de MECANISMO (aprender com séries) fica abaixo — cartões separados', () => {
    // series-1 (cumprimentar com Friends) × series-5 (restaurante com Emily in
    // Paris): mesmo mecanismo, temas diferentes — falso-merge esconderia ideia.
    expect(cosseno(v('series-1'), v('series-5'))).toBeLessThan(LIMIAR_DEDUP)
  })

  it('cosseno: recusa dimensões incompatíveis; idêntico = 1', () => {
    expect(() => cosseno([1, 2], [1, 2, 3])).toThrow(/dimensões/)
    expect(cosseno(v('what-1'), v('what-1'))).toBeCloseTo(1, 6)
  })
})

/* ========================================================================== */
/* A aplicação contra o banco morreu com o Portão 1 (Leva 6.2)                 */
/* ========================================================================== */

// `aplicarDedupDeIdeias` — e os casos que provavam anexa/suprime/cria contra o
// banco — foram embora com o worker `ideias`: aquela dedup lia a coorte
// `pauta:`, que não nasce mais. A memória vetorial continua viva e é o RADAR
// que a aplica hoje (trend × trend, pendurando a repetida como `variacao_de`).
// O que este arquivo guarda, e é o que não pode se perder, é a CALIBRAÇÃO do
// limiar contra os vetores reais do acervo — os testes puros acima.
