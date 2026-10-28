// O VOCABULÁRIO PROIBIDO NAS TELAS DO ALUNO (Onda do Portal · P3).
//
// A lista nasceu varrendo o CÓDIGO-FONTE das telas — o que pegava a palavra
// escrita à mão no JSX, mas não a que chega à tela por uma função ("Crédito
// registrado em…", o rótulo do botão de entrar, o aviso de leitura). A revisão
// adversarial do P3 apontou o buraco: o varredor tem de passar TAMBÉM no texto
// que os testes renderizam.
//
// Por isso a lista mora aqui, num lugar só, e os dois testes a aplicam: o de
// fonte (portal-inicio-creditos) e o de DOM (portal-botao-entrar-dom).
export const PROIBIDO: ReadonlyArray<readonly [string, RegExp]> = [
  ['jargão de contabilidade: "lançamento"', /lançament/i],
  ['jargão de contabilidade: "auditado"', /auditad/i],
  ['nome da tabela: "ledger"', /ledger/i],
  ['notação de dupla entrada: "+1" / "−1"', /[+−]\s?1\b/],
  ['data em formato de máquina (aaaa-mm-dd)', /\d{4}-\d{2}-\d{2}/],
]

/** Os achados de vocabulário proibido num texto — vazio quando está limpo. */
export function varrerVocabulario(texto: string): string[] {
  return PROIBIDO.filter(([, regex]) => regex.test(texto)).map(([oQue]) => oQue)
}
