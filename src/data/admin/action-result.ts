// Resultado de uma ação da porta nova (Onda 1 · M1, item 1).
//
// Módulo SEPARADO de `actions.ts` de propósito: um arquivo `'use server'` só
// pode exportar funções assíncronas — tipo mora fora.
//
// A tela velha devolve feedback por `?msg=` na URL (com nonce para o toast não
// se repetir). A tela NOVA não faz isso: a ação devolve este objeto, o cliente
// mostra o toast do kit e a URL fica limpa (ADR-025 · "o que morre").

export interface ResultadoDaAcao {
  ok: boolean
  mensagem: string
}
