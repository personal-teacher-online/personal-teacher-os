-- Fase 2 / M1.3 — Retaguarda financeira: inbox de webhooks (Lei 6) + espelho de
-- pagamentos ligado a contrato/competência (D4).

-- Inbox genérica (Asaas agora; WhatsApp/Autentique/Hotmart nas fases seguintes).
-- First-write-wins: replay com payload divergente NÃO sobrescreve (caso de teste 19).
create table webhook_inbox (
  id bigint generated always as identity primary key,
  source text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  constraint webhook_inbox_event_uniq unique (source, event_id)
);
comment on table webhook_inbox is 'Lei 6: idempotência por UNIQUE(source, event_id) com ON CONFLICT DO NOTHING; payload cru SEMPRE persistido; o endpoint responde 200 rápido e o processamento marca processed_at/error.';

alter table webhook_inbox enable row level security;

-- Espelho Asaas → contrato/competência (D4):
-- externalReference = SÓ o UUID do contrato (o Asaas propaga valor ESTÁTICO da
-- assinatura); reference_ym DERIVADO do dueDate (string YYYY-MM-DD → 7 chars, sem
-- aritmética de timezone). NUNCA paymentDate (atraso cairia na competência errada).
alter table payments
  add column contract_id uuid references contracts (id),
  add column reference_ym text
    check (reference_ym is null or reference_ym ~ '^\d{4}-(0[1-9]|1[0-2])$');

comment on column payments.contract_id is 'Casado pelo externalReference (= contract_id UUID, estático por assinatura — D4). NULL quando o externalReference é desconhecido (caso 12: inbox registra o erro, nada corrompe).';
comment on column payments.reference_ym is 'Competência YYYY-MM derivada do dueDate da cobrança (D4; corrige ADR-011 §10). Nunca derivar de paymentDate.';

create index payments_contract_ym_idx on payments (contract_id, reference_ym);
