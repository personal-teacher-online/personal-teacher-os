// AFIRMAR "NÃO HÁ NADA" EXIGE TER CONSEGUIDO OLHAR (Onda do Portal · P3).
//
// O padrão `{ dado, erro }` deu às telas a informação de que a leitura falhou —
// e elas passaram a mostrar o aviso. Mas continuavam mostrando, LOGO ABAIXO
// dele, o mesmo estado vazio afirmativo de sempre: "Nenhuma aula agendada",
// "Nenhum pagamento registrado por aqui ainda". Um aviso de falha ao lado de
// uma afirmação categórica sobre o que o aluno tem — e a frase grande, positiva
// e tranquilizadora ganha do aviso pequeno toda vez.
//
// A regra: lista vazia só vira frase quando a leitura DEU CERTO. Se falhou,
// sobra o aviso — que é a única coisa verdadeira que a tela sabe naquele
// momento.
export function mostrarVazioAfirmativo({ erro, itens }: { erro: boolean; itens: number }): boolean {
  return !erro && itens === 0
}
