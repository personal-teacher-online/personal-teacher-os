import { describe, expect, it } from 'vitest'
import { carregarSePresente, presente } from './_privado'

// `build.ts` resolve a pasta de marca na carga: sem o insumo privado, os casos pulam (tests/_privado.ts).
const { variantLabel } = await carregarSePresente(() => import('../src/lib/slides/build.ts'))

describe.skipIf(!presente)('nome do deck por variante de curso', () => {
  it('curso base nao ganha sufixo (decks ja publicados mantem o nome)', () => {
    expect(variantLabel('personal-travel')).toBe('')
    expect(variantLabel(null)).toBe('')
    expect(variantLabel(undefined)).toBe('')
  })

  it('variante vira sufixo legivel', () => {
    expect(variantLabel('personal-travel-estrutural')).toBe(' (Estrutural)')
  })

  it('variante com varias palavras', () => {
    expect(variantLabel('personal-travel-so-gramatica')).toBe(' (So gramatica)')
  })
})
