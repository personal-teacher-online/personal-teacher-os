// LEITURA QUE FALHOU TEM DE APARECER (Onda do Portal · P3 — dívida c14).
//
// Quando o PostgREST não responde, a tela do aluno tem duas saídas: mentir
// ("você não tem crédito nenhum") ou dizer a verdade ("não deu para carregar
// agora"). Este é o segundo caminho, num bloco de aviso do kit — server
// component, sem JS, porque a falha acontece no desenho da página.
//
// Não é toast: toast é recado de AÇÃO (some sozinho). Isto é o estado da tela
// enquanto ela estiver assim, e some quando a leitura voltar a funcionar.
//
// O BOTÃO DE TENTAR DE NOVO (rodada de correção do P5). "Atualize a página" é
// uma instrução que a pessoa no celular tem de saber executar — e no aplicativo
// do WhatsApp, dentro do navegador embutido, nem sempre há botão de recarregar à
// vista. Quando quem chama sabe a rota, ele passa `tentarEm` e o aviso ganha um
// link para ela própria: no servidor, uma navegação nova refaz a leitura. É
// `<a>` e não `<Link>` de propósito — o `Link` do Next serve cache de rota, e
// reservir a mesma página falha do cache seria oferecer o botão que não tenta.
import { TriangleAlert } from 'lucide-react'

export function AvisoDeLeitura({ oQue, tentarEm }: { oQue: string; tentarEm?: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-panel border border-warn-700/40 bg-warn-wash px-4 py-3 text-sm font-medium text-warn-700"
    >
      <p className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Não deu para carregar {oQue} agora. Atualize a página em instantes — nada seu foi
          perdido.
        </span>
      </p>
      {tentarEm && (
        <a href={tentarEm} className="btn-ac-soft self-start">
          Tentar de novo
        </a>
      )}
    </div>
  )
}
