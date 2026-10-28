-- M1.3 — Créditos de reposição (particulares): ledger append-only + alçada mensal.
-- Lei 2: dupla entrada, delta ±N nunca 0, saldo SEMPRE derivado por função (M2),
-- PROIBIDO UPDATE/DELETE/TRUNCATE (revoke + triggers de guarda), sem coluna de saldo.

create type ledger_reason as enum
  ('earn_cancellation', 'spend_reschedule', 'expire', 'manual_adjust', 'initial_backlog');

-- ADR-001: o crédito pertence ao CONTRATO (casal Natália+Yago compartilha contrato e
-- créditos); student_id é opcional, só para rastrear qual membro do grupo originou a entrada.
create table makeup_ledger (
  id bigint generated always as identity primary key,
  contract_id uuid not null references contracts (id),
  student_id uuid references students (id),
  delta int not null check (delta <> 0),
  reason ledger_reason not null,
  class_instance_id uuid references class_instances (id),
  expires_on date,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  -- Shape por reason (ADR-008): ganhos são positivos e SEMPRE expiram; gastos e
  -- expirações são negativos; manual_adjust é livre (±, delta≠0 já garantido).
  constraint makeup_ledger_shape check (
    (reason in ('earn_cancellation', 'initial_backlog') and delta > 0 and expires_on is not null)
    or (reason in ('spend_reschedule', 'expire') and delta < 0)
    or (reason = 'manual_adjust')
  )
);
create index makeup_ledger_contract_idx on makeup_ledger (contract_id);
comment on column makeup_ledger.expires_on is 'ÚLTIMO dia em que o crédito vale, avaliado na data civil do FUSO DO NEGÓCIO (função business_tz() no M2; América/Cuiabá). makeup_balance() (M2) ignora entradas com expires_on anterior a hoje-no-fuso-do-negócio.';

create trigger makeup_ledger_append_only
  before update or delete on makeup_ledger
  for each row execute function public.forbid_mutation();
create trigger makeup_ledger_no_truncate
  before truncate on makeup_ledger
  for each statement execute function public.forbid_mutation();

revoke update, delete, truncate on makeup_ledger from anon, authenticated, service_role;

-- Alçada mensal de remarcação (contagem, não ledger).
-- ADR-003: criação LAZY — a linha (contract_id, period_ym) nasce por upsert dentro de
-- reschedule_class() (M2) no primeiro uso do mês. Não existe job de reset mensal.
create table reschedule_usage (
  contract_id uuid not null references contracts (id),
  period_ym text not null check (period_ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  used_count int not null default 0 check (used_count >= 0),
  primary key (contract_id, period_ym)
);
comment on column reschedule_usage.period_ym is '''YYYY-MM'' = mês civil da data LOCAL (zona do slot) da INSTÂNCIA ORIGINAL remarcada — não do momento do pedido (ADR-008). Linha criada lazy por reschedule_class() (M2); ausência de linha = 0 usos.';

alter table makeup_ledger enable row level security;
alter table reschedule_usage enable row level security;
