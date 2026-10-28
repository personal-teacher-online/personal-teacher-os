import { redirect } from 'next/navigation'

// Rota velha que sobrevive só para os links salvos.
//
// Primeiro destino (reforma do zero, item 21/26 do qa/reforma.md): a Agenda —
// as janelas passaram a morar dentro dela.
//
// Destino de AGORA (Onda da Agenda · A8): `/admin/ajustes`, a seção que nasceu
// com os quatro blocos e que este endereço vinha segurando como place-holder no
// menu da conta. Quem procurava "Ajustes" e caía na Agenda agora chega em
// Ajustes — e o bloco "Janelas" de lá aponta de volta para a camada de
// disponibilidade da Agenda, que continua sendo onde a semana se edita.
export default function JanelasPage() {
  redirect('/admin/ajustes')
}
