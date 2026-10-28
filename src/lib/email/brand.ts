// Moldura de MARCA dos e-mails (Design.md §Escopo item 4 — degrau 4):
// clientes de e-mail não suportam animação/fontes externas, então a identidade
// vira: faixa de GRADIENTE ESTÁTICO #B35BD9→#2BD9D9 no topo, wordmark sobre a
// base escura da marca, corpo claro (deliverability + leitura), botão no
// gradiente do CTA. Tabelas + estilos inline (Outlook não lê <style>).
// Os TEXTOS dos e-mails são os aprovados pela dona — esta moldura só
// embrulha; nunca alterar copy aqui.

/** Estilo inline do botão de ação (o CTA da marca em versão e-mail).
 *  background-color sólido = fallback para clientes sem gradiente (Outlook). */
export const BRAND_BTN_STYLE =
  'display: inline-block; padding: 12px 24px; background-color: #B35BD9; ' +
  'background-image: linear-gradient(120deg, #B35BD9, #2BD9D9); color: #0A0A0F; ' +
  'text-decoration: none; border-radius: 10px; font-weight: bold;'

/** Embrulha o conteúdo (já aprovado) na moldura da marca. */
export function brandEmail(inner: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background-color: #F5F6FF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F5F6FF; padding: 24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 100%; background-color: #F5F6FF; border-radius: 12px; overflow: hidden; border: 1px solid rgba(132,136,217,0.25);">
            <tr>
              <td style="height: 6px; background-color: #B35BD9; background-image: linear-gradient(120deg, #B35BD9, #2BD9D9); font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="background-color: #0A0A0F; padding: 18px 32px;">
                <span style="font-family: 'Hanken Grotesk', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 17px; font-weight: bold; color: #F5F6FF;">Personal&#8202;Teacher</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 32px; font-family: 'Hanken Grotesk', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #121218;">
${inner}
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 32px 20px; border-top: 1px solid rgba(132,136,217,0.25); font-family: 'Hanken Grotesk', -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 12px; color: #7A7C8C;">
                Personal Teacher Online · aulas de inglês do seu jeito
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
