// AS QUATRO INTENÇÕES DO SLOT VAZIO — o vocabulário, separado da peça.
//
// Ele nasceu dentro de `components/admin/agenda/IntencoesDoSlot.tsx`, que é
// `'use client'`. No A7 o SERVIDOR passou a precisar da mesma lista: `si` é
// geometria de URL, e a allowlist do transporte valida o valor contra o conjunto
// fechado antes de reabrir balão nenhum. Importar o componente cliente só para
// ler quatro strings arrastaria a peça inteira para o grafo do servidor.
//
// Mesma régua do `chaves-de-rascunho.ts`: aqui só entra vocabulário puro.

/** As quatro portas do balão. "Aula" é UMA intenção com DOIS caminhos — cada
 *  caminho tem RPC própria, e por isso consequência própria. */
export type IntencaoDoSlot = 'avulsa' | 'experimental' | 'horario' | 'bloqueio'

export const INTENCOES_DO_SLOT: readonly IntencaoDoSlot[] = [
  'avulsa',
  'experimental',
  'horario',
  'bloqueio',
] as const

export function ehIntencaoDoSlot(v: string | undefined): v is IntencaoDoSlot {
  return INTENCOES_DO_SLOT.includes((v ?? '') as IntencaoDoSlot)
}
