// @vitest-environment jsdom
//
// K1 — O `required` DO HTML NA ETAPA 2 DO BRIEFING v2, MEDIDO NO DOM.
//
// POR QUE ESTE ARQUIVO EXISTE. `EtapaObjetivosV2` já trazia um comentário
// dizendo, com todas as letras, que viagem e intercâmbio ficam "SEM `required`"
// porque o banco não as cobra. O código dizia outra coisa: `Escolhas` tem
// `required = true` por DEFAULT e as duas eram chamadas sem passar a prop, então
// `required && !multipla` dava `true` e o NAVEGADOR barrava a etapa 2 antes de o
// formulário sequer sair — sem toast, sem recusa do servidor, sem pista. Quem
// mediu foi o harness e2e do P7a; a suíte inteira ficava verde.
//
// Um comentário não trava regressão. Este arquivo trava: ele monta a etapa de
// verdade e lê o atributo `required` que o navegador vai obedecer.
//
// A RÉGUA NÃO É INVENTADA AQUI — é a do Postgres (Lei 3). A lista de
// obrigatórios do ramo adulto abaixo é, campo a campo, a mesma de
// `_briefing_validate_v2_secoes` na seção 'objetivos'
// (`supabase/migrations/20260728000300_briefing_updates.sql`): finalidades (≥1),
// finalidade_principal, alvo_6_meses, onde_trava (≥1), correcao_preferida,
// tempo_diario. Viagem e intercâmbio NÃO aparecem lá — e por isso não podem
// aparecer como `required` aqui. A tela só antecipa o que o banco diria.
//
// CHECKBOX NUNCA É `required`: no HTML o atributo num grupo de checkbox exige
// TODAS marcadas, não ≥1. O mínimo dos grupos (finalidades, onde_trava) é
// cobrado pela action e pelo banco — nunca pelo navegador.
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { EtapaObjetivosV2 } from '@/components/BriefingFields'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function montarEtapa2Adulto() {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(h(EtapaObjetivosV2, { a: {}, tipo: 'adult' }))
  })
  return container
}

/** Os controles de um campo, pelo `name` do formulário. */
function campos(nome: string): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>(`[name="${nome}"]`))
}

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('briefing v2 · etapa 2 (adulto): o que o navegador barra', () => {
  it('viagem e intercâmbio NÃO são obrigatórios no HTML', async () => {
    await montarEtapa2Adulto()

    for (const nome of ['viagem', 'intercambio']) {
      const opcoes = campos(nome)
      // Sanidade: se o campo sumisse da tela, um `every` sobre lista vazia
      // passaria sozinho e o teste viraria enfeite.
      expect(opcoes.length, `${nome} sumiu da etapa 2`).toBeGreaterThan(1)
      expect(
        opcoes.filter((o) => o.required).map((o) => o.value),
        `${nome} está obrigatório no HTML — o banco não o cobra (Lei 3)`,
      ).toEqual([])
    }
  })

  it('…e os obrigatórios DE VERDADE continuam obrigatórios', async () => {
    await montarEtapa2Adulto()

    // Escolha única = radio: o navegador exige uma marcada, que é exatamente o
    // que `_briefing_validate_v2_secoes` cobra.
    for (const nome of ['finalidade_principal', 'correcao_preferida', 'tempo_diario']) {
      const opcoes = campos(nome)
      expect(opcoes.length, `${nome} sumiu da etapa 2`).toBeGreaterThan(1)
      expect(
        opcoes.every((o) => o.required),
        `${nome} deixou de ser obrigatório no HTML — o banco recusaria o envio sem ele`,
      ).toBe(true)
    }

    const alvo = container.querySelector<HTMLTextAreaElement>('[name="alvo_6_meses"]')
    expect(alvo?.required, 'alvo_6_meses deixou de ser obrigatório').toBe(true)
  })

  it('grupos de múltipla escolha nunca são `required` (exigiria TODAS marcadas)', async () => {
    await montarEtapa2Adulto()

    for (const nome of ['finalidades', 'onde_trava']) {
      const opcoes = campos(nome)
      expect(opcoes.length, `${nome} sumiu da etapa 2`).toBeGreaterThan(1)
      expect(opcoes.every((o) => o.type === 'checkbox')).toBe(true)
      expect(
        opcoes.filter((o) => o.required).map((o) => o.value),
        `${nome} é checkbox: \`required\` exigiria TODAS as opções marcadas`,
      ).toEqual([])
    }
  })
})
