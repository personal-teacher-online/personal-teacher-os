// O DESFECHO DA ÚLTIMA AÇÃO, NA MOLDURA — não em cada página (2ª revisão do P4).
//
// POR QUE ISTO SUBIU PARA O LAYOUT. Cada tela lia o cookie por conta própria, e
// isso deixava um buraco determinístico: o `/portal` manda para `/portal/ciencia`
// quem ainda não deu ciência do canal, e para `/portal/briefing` quem não enviou
// o briefing. Um aluno nessa situação remarcava por deep link — o crédito era
// gasto, o banco registrava tudo — e caía numa tela de gate que não lia recado
// nenhum. Ele ficava sem saber o desfecho do próprio ato. Na moldura, TODA rota
// do portal mostra o recado, gate incluído, e nenhuma tela nova precisa lembrar
// de ler o cookie.
//
// LER NÃO CONSOME (`src/lib/portal/flash.ts`): o cookie morre pelo `maxAge` de
// 15s. Consequência aceita e declarada: um F5 dentro dessa janela mostra o
// recado outra vez — o toast renasce com a página e a faixa `<noscript>`
// reaparece. Dentro da MESMA aba viva não há repetição: a `chave` é o `id` da
// escrita e o `sonner` dedupa por ele, então navegar pelo portal com o cookie
// ainda vivo não pinta um toast novo a cada rota.
//
// Server component: `cookies()` só se lê no servidor, e a moldura do portal já é
// dinâmica (a sessão do Supabase também vem de cookie).
import { lerFlash } from '@/lib/portal/flash'
import { AvisoLegado } from '@/components/kit/aviso-legado'

export async function RecadoDoPortal() {
  const recado = await lerFlash()
  if (!recado) return null
  return <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />
}
