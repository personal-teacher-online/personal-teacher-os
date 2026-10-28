import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// ADR-036 decisão 1 — o DIGEST DO LOTE: o toque que a varredura semanal dá na
// dona quando fecha a corrida. Aviso INTERNO (a destinatária é da casa), sem
// rodapé de atendimento, no mesmo tom direto do `content-review`.
//
// ── POR QUE O TEXTO NÃO DIZ TUDO O QUE SABE ─────────────────────────────────
// A frase do portão 2 só aparece quando há rascunho parado: "0 rascunhos para
// revisar" é ruído que ensina a ignorar o aviso. Mesma disciplina do painel —
// número que não existe não vira zero de enfeite.
//
// O destino é o RADAR (`/admin/conteudo` desde o cutover da Leva 5): o toque é
// sobre trends, e mandar para a fila de posts faria a dona procurar o lote na
// tela errada.

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

export interface ContentDigestFacts {
  /** Rodada da varredura (`AAAA-Wss`) — vai no assunto do e-mail. */
  semana: string
  /** Trends que a varredura trouxe (raízes). */
  novas: number
  /** Quantas passam do limiar do Personal Travel. */
  destaque: number
  /** Rascunhos parados no portão 2, no instante do enfileiramento. */
  rascunhos: number
  firstName: string
  appUrl?: string
}

const plural = (n: number, um: string, muitos: string): string => (n === 1 ? um : muitos)

/** "6 trends novas, 2 em destaque para o Personal Travel." */
function frasedoLote(f: ContentDigestFacts): string {
  const trends = `${f.novas} ${plural(f.novas, 'trend nova', 'trends novas')} nesta varredura`
  return f.destaque > 0
    ? `${trends}, ${f.destaque} em destaque para o Personal Travel.`
    : `${trends} — nenhuma passou do corte do Personal Travel desta vez.`
}

/** A pendência do outro portão, só quando ela existe. */
function frasedoPortao2(f: ContentDigestFacts): string {
  if (f.rascunhos <= 0) return ''
  return ` Além disso, ${f.rascunhos} ${plural(f.rascunhos, 'rascunho está parado', 'rascunhos estão parados')} esperando a sua revisão.`
}

export function contentDigestEmail(f: ContentDigestFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return {
    subject:
      f.destaque > 0
        ? `${f.novas} ${plural(f.novas, 'trend nova', 'trends novas')} no radar — ${f.destaque} de viagem 📡`
        : `${f.novas} ${plural(f.novas, 'trend nova', 'trends novas')} no radar 📡`,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>${escapeHtml(frasedoLote(f))}${escapeHtml(frasedoPortao2(f))}</p>
<p>
  <a href="${escapeHtml(appUrl)}/admin/conteudo" style="${BRAND_BTN_STYLE}">Abrir o radar</a>
</p>
<p style="color:#6b6875;font-size:13px">Varredura ${escapeHtml(f.semana)}. Escolher a trend já é a aprovação — o que você não quiser, descarte com o motivo.</p>`),
  }
}

export function contentDigestText(f: ContentDigestFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return `Oi, ${f.firstName}! ${frasedoLote(f)}${frasedoPortao2(f)}\n\nAbrir o radar:\n${appUrl}/admin/conteudo`
}
