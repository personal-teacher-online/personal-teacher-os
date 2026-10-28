# Fixtures Asaas — capturadas no SANDBOX em 07/08/2026 (gate F0 da onda Financeiro)

Payloads REAIS do sandbox (`https://api-sandbox.asaas.com/v3`), capturados pela
sonda do F0 (webhooks entregues a webhook.site e salvos verbatim). Sanitização
única: `account.id` zerado. Cliente/CPF são sintéticos, criados para o teste.

O que cada arquivo PROVA (checklist de contrato, PLAN-APPROVED §F0):

| arquivo | item | fato provado |
| --- | --- | --- |
| `webhook-PAYMENT_{CREATED,RECEIVED,DELETED}.json` | 1 | `payment.customer` é string `cus_…` em todos os eventos capturados |
| idem | 2 | link da fatura em `payment.invoiceUrl` (no nosso espelho: `raw -> 'payment' ->> 'invoiceUrl'`); domínio `sandbox.asaas.com` casa com a guarda de origem |
| `payment-created-response.json` | 4 | resposta do `POST /payments`; 2 POSTs idênticos criaram 2 cobranças e o header `Idempotency-Key` foi ignorado — **sem idempotência nativa** |
| `payments-by-extref.json` | 6 | `GET /payments?externalReference=` imediato devolveu as 3 criadas — read-your-writes |
| `subscription-before/after.json` | 5 | `PUT /subscriptions/{id}` só com `externalReference` → diff campo a campo mostra SÓ `externalReference` alterado — **MERGE, PUT seguro** (libera o `--apply` do script de semeadura, F4) |
| `customer.json` | — | forma do objeto customer (`cus_…`) para o enriquecimento do F4 |

Fatos colaterais medidos (valem para F3/F5/F6):
- Header de entrega do webhook: `asaas-access-token` (nome confirmado — é o que
  a rota já lê).
- `PAYMENT_RECEIVED` via `receiveInCash` vem com `status: RECEIVED_IN_CASH` e
  `paymentDate` + `clientPaymentDate` preenchidos (contrato que
  `src/lib/webhooks/asaas.ts` já assume).
- `id` do EVENTO tem forma `evt_…&NNNNN` (string opaca — nunca parsear).
- **PIX indisponível no sandbox sem aprovação da conta** (`invalid_billingType`)
  — portão visual do F5 em sandbox usa BOLETO.
