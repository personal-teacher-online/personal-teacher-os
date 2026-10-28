// O POTE DE COOKIES DUBLÊ — usado por qualquer teste que exercite uma tela ou
// action que leia/escreva cookie (o recado do portal, o rascunho do admin).
//
// Nasceu duplicado em `tests/portal-flash.test.ts` e voltou a ser necessário na
// onda da Agenda (A4/grave 5: o que a dona digita atravessa o erro num cookie,
// não mais na URL). Uma cópia só, para as duas pontas envelhecerem juntas.
//
// O dublê guarda o valor JÁ SERIALIZADO (`encodeURIComponent`) e o desfaz na
// leitura — que é exatamente o que o `@edge-runtime/cookies` embutido no Next
// faz nas duas pontas. Sem isso o teste passaria com aspas e emoji que a rede
// real não entregaria. E `maxAge: 0` APAGA, porque é assim que a casa deleta
// (mesmo `path`/`secure` da escrita, em vez de um `delete` que pode não casar).

export interface OpcoesDeCookie {
  maxAge?: number
  httpOnly?: boolean
  sameSite?: string
  path?: string
  secure?: boolean
}

export class PoteDeCookies {
  cru = new Map<string, string>()
  escritas: { nome: string; valor: string; opcoes: OpcoesDeCookie }[] = []
  apagados: string[] = []

  get(nome: string) {
    const v = this.cru.get(nome)
    return v === undefined ? undefined : { name: nome, value: decodeURIComponent(v) }
  }
  set(nome: string, valor: string, opcoes: OpcoesDeCookie = {}) {
    if (opcoes.maxAge === 0) {
      this.cru.delete(nome)
      this.apagados.push(nome)
    } else {
      this.cru.set(nome, encodeURIComponent(valor))
    }
    this.escritas.push({ nome, valor, opcoes })
  }
  delete(nome: string) {
    this.cru.delete(nome)
    this.apagados.push(nome)
  }

  /**
   * O TAMANHO REAL que o cabeçalho `Set-Cookie` levaria — em BYTES, não em
   * caracteres (Sol · rodada 2 do A4, médio 3).
   *
   * O código media `corpo.length` e deixava passar rascunho de 2.990
   * caracteres acentuados, que percent-encodado vira ~18 KB e é DESCARTADO
   * pelo navegador (limite de ~4 KB): a dona perdia em silêncio justamente o
   * texto longo que o mecanismo prometia salvar. O dublê guarda o valor já
   * codificado, então contar aqui é contar o que sai na rede.
   */
  tamanhoCodificado(nome: string): number {
    return this.cru.get(nome)?.length ?? 0
  }
}
