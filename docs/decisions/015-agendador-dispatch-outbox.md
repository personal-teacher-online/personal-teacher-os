# ADR-015 — Agendador do despacho do outbox: Scheduled Task do Coolify (desvio da Lei 5)

**Data:** 12/07/2026 · **Decisor:** O mantenedor (decisão P3 do gate do goal da Fase 3)

**Contexto.** A Lei 5 pina o mecanismo de jobs em background: pg_cron + pgmq + pg_net
+ worker Node. O DECIDIR do e-mail 5 segue a Lei (pg_cron roda
`enqueue_credit_expiry_notices()` diária — quem recebe é decidido em SQL, Lei 3). O
ENVIAR precisa sair do banco para o app (Resend). Dois caminhos para acionar a rota
`/api/jobs/dispatch-outbox`:

- **(a) Scheduled Task do Coolify** chamando a rota por HTTP — desvio do stack da
  Lei 5. **← ESCOLHIDO**
- (b) pg_cron + pg_net POST de dentro do banco — fica no stack pinado, mas o token e
  a URL do app teriam de ser configurados DENTRO do Postgres (não podem ir em
  migration — "nada no repo"), com passo manual equivalente e observabilidade de
  falha pior (erro de HTTP do pg_net fica em tabela interna que ninguém olha).

**Decisão.** Coolify Scheduled Task, DEPOIS do horário do enqueue (que roda 10:00
UTC): `curl -X POST -H "outbox-dispatch-token: $OUTBOX_DISPATCH_TOKEN"
https://app.personal-teacher.com/api/jobs/dispatch-outbox`, diário (~10:30 UTC).
Token nasce no Bitwarden + env do Coolify (mesmo trato do ASAAS_WEBHOOK_TOKEN);
fail-closed: sem env configurada a rota é INOPERANTE (401). Logs do task visíveis
no painel do Coolify — falha de agendamento é observável por quem opera.

**Fronteira do desvio.** Vale para ESTE acionador HTTP fino. O worker pgmq da Lei 5
continua sendo o alvo para processamento assíncrono de verdade (webhook_inbox tem
processed_at/error prontos); quando ele nascer, pode absorver o despacho do outbox e
este ADR é revisitado.

**Consequências.** Rota com caminho EXATO em PUBLIC_PATHS (teste-pino: qualquer outra
rota sob /api/jobs continua atrás do gate); smoke pós-deploy no runbook (200 com
token; 401 sem); a entrega é at-least-once (F3-D4) com Idempotency-Key do Resend
como estreitamento de janela.
