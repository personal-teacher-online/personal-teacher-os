# Fixtures do webhook do Resend (recibo de entrega, #47)

Consumidas por `tests/m3-entrega.test.ts`. Não há produção para amostrar: o
arquivo tem a forma DOCUMENTADA pelo Resend, com a URL da documentação e a
data da leitura na chave `_fonte` (o teste a ignora). Quando o primeiro recibo
real chegar, o payload real (com os e-mails trocados por `@exemplo.com`)
substitui este.

| Arquivo | O que é |
|---|---|
| `email-delivered.json` | o corpo do evento `email.delivered`. `<email_id>` é trocado pelo teste pelo id que o envio gravou em `provider_message_id` (o id que o `POST /emails` devolveu) |

E-mails em `@exemplo.com`; o remetente é o padrão do app.
