// A DECISÃO SOBRE QUEM ESTÁ NA PORTA (c13 · nº 7) — módulo PURO.
//
// POR QUE SEPARADO DE `servidor.ts`: lá a decisão vivia embaralhada com `fetch`,
// `spawn` e `console.log` — e por isso nunca foi testada. O que ela decide, no
// entanto, é a coisa mais cara de errar do harness inteiro: reusar o servidor
// errado faz a suíte de e2e passar contra CÓDIGO QUE NÃO É O DO DISCO, e um
// verde falso é pior que um vermelho. Aqui não há efeito nenhum — entra o que se
// observou na porta, sai o que fazer —, então o teste do lote prova
// COMPORTAMENTO (cada estado leva à decisão certa) em vez de procurar palavras
// no arquivo.
//
// O QUE MUDOU DE VERDADE NESTA RODADA: o servidor em modo DESENVOLVIMENTO
// deixou de ser reusável. O c12 o aceitava com o argumento "o dev server compila
// o que está no disco AGORA", e o argumento é meia-verdade: ele compila o disco,
// mas não é o bundle que vai para o Coolify (é o que o cabeçalho do `servidor.ts`
// sempre disse), roda com outro NODE_ENV, outro tratamento de erro, sem
// minificação e com HMR no meio — e, o que decide, ele NÃO tem BUILD_ID para
// comparar com nada. "Passou no dev" nunca foi a promessa deste harness.

/** O que respondeu (ou não) em `GET /login` na porta da bancada. */
export type NaPorta =
  | { estado: 'fora' }
  | { estado: 'estranho'; status: number }
  | { estado: 'dev' }
  | { estado: 'build'; buildId: string }

/** O que o harness faz com isso. */
export type Decisao =
  | { tipo: 'reusar'; buildId: string }
  | { tipo: 'subir' }
  | { tipo: 'parar'; motivo: string }

/**
 * O `BUILD_ID` dentro do payload de flight, que chega ESCAPADO no HTML
 * (`self.__next_f.push([1,"…\"b\":\"<id>\"…"])`).
 *
 * A classe de caracteres é a do id do Next (nanoid: letras, dígitos, `_`, `-`),
 * e não um `[^"]+`: o valor está dentro de uma string JSON dentro de uma string
 * JS, e contar barras invertidas para achar o fim é a receita de um casamento
 * que falha calado na próxima versão do framework.
 */
const B_DO_FLIGHT = /\\?"b\\?":\\?"([A-Za-z0-9_-]+)/

/**
 * Que espécie de servidor respondeu isto.
 *
 * `/login` é rota do app e responde 200. 404 (ou 5xx) significa OUTRA coisa na
 * porta — ou o app subindo sem `.env.local`, que é o caso medido no c12. Nenhum
 * dos dois é "no ar". Resposta sem payload do Next também não é este app.
 */
export function oQueAtende(status: number, html: string): NaPorta {
  if (status === 404 || status >= 500) return { estado: 'estranho', status }
  const achado = B_DO_FLIGHT.exec(html)?.[1]
  if (!achado) return { estado: 'estranho', status }
  // `next dev` usa a constante `development` no lugar do id do build.
  return achado === 'development' ? { estado: 'dev' } : { estado: 'build', buildId: achado }
}

/**
 * O que fazer com quem está na porta, dado o build que está no disco.
 *
 * A ÚNICA reutilização aceita é build de PRODUÇÃO com o BUILD_ID igual ao do
 * disco — isto é, o servidor que `npm run e2e:bancada` acabou de gerar e alguém
 * deixou no ar. Todo o resto para a suíte com um motivo dizível: passar aqui
 * seria testar outro código e chamar isso de verde.
 */
export function decidirSobreAPorta(quem: NaPorta, noDisco: string | null): Decisao {
  if (quem.estado === 'dev') {
    return {
      tipo: 'parar',
      motivo:
        'há um servidor de DESENVOLVIMENTO na porta da bancada. O e2e exige o build de ' +
        'produção (`next start`): é ele que vai para o Coolify, e é só ele que tem BUILD_ID ' +
        'para conferir contra o disco.',
    }
  }
  if (quem.estado === 'estranho') {
    return {
      tipo: 'parar',
      motivo:
        `alguma coisa atende na porta e não é este app (GET /login respondeu ${quem.status} ` +
        'ou sem payload do Next).',
    }
  }
  if (quem.estado === 'build') {
    if (noDisco && quem.buildId === noDisco) return { tipo: 'reusar', buildId: noDisco }
    return {
      tipo: 'parar',
      motivo:
        'há um servidor na porta servindo OUTRO build.\n' +
        `  servido: ${quem.buildId}\n` +
        `  no disco: ${noDisco ?? '(nenhum — .next/BUILD_ID ausente)'}\n` +
        'Ele testaria o código de outra sessão.',
    }
  }
  // porta livre: subir é possível se — e só se — existe build no disco.
  if (!noDisco) {
    return { tipo: 'parar', motivo: 'não há build para servir (.next/BUILD_ID ausente).' }
  }
  return { tipo: 'subir' }
}
