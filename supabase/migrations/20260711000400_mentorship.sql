-- M1.4 — Programa de Mentoria "Personal Travel".
-- Base: docs/research/04-mentoria-hotmart.md §4, ajustado pelas decisões D2/D3 do goal
-- (escada de thresholds por janela — ADR-006), ADR-001 (ledger chaveado por contrato)
-- e endurecimentos da revisão adversarial (ADR-008).
--
-- Regras centrais (implementadas como funções no M2):
--   * Acúmulo COMPUTADO sob demanda a partir de course_start_date (Lei 2) —
--     min(total_credits, floor(meses/2)+1); NUNCA materializado por job nem lançado
--     no ledger (constraint impede reason='accrual_window').
--   * O ledger registra apenas gastos (booking_spend, com window_index) e ajustes manuais.
--   * Reserva nº N consome o crédito da etapa N e exige o threshold da etapa N (D2);
--     threshold NULL/ausente → exceção clara, nunca liberação silenciosa.

create type course_platform as enum ('hotmart', 'manual', 'self_hosted');
create type credit_reason as enum ('accrual_window', 'booking_spend', 'manual_adjust', 'expiry');
create type mentorship_session_status as enum ('scheduled', 'open', 'full', 'done', 'cancelled');

-- ---------------------------------------------------------------------------
-- Extensão 1:1 do contrato (ADR-005)
-- ---------------------------------------------------------------------------
create table mentorship_contracts (
  contract_id uuid primary key references contracts (id),
  platform course_platform not null default 'hotmart',
  external_user_ref text,
  external_subdomain text,
  course_start_date date,
  term_months int not null default 12 check (term_months > 0),
  total_credits int not null default 6 check (total_credits > 0),
  window_months int not null default 2 check (window_months > 0),
  expiry_grace_days int not null default 90 check (expiry_grace_days >= 0)
);
comment on column mentorship_contracts.course_start_date is 'Início do curso: na Fase 5 setado pelo webhook CLUB_FIRST_ACCESS (convertendo o instante do evento para data civil no fuso do ALUNO); até lá, lançado manualmente pela admin. NULL = aluno nunca acessou → nenhuma janela destravada.';
comment on column mentorship_contracts.expiry_grace_days is 'Carência após o fim do curso (doc 04 §5: 60–90 dias; texto contratual a validar com advogado). Créditos expiram em course_start_date + term_months + carência.';

-- O contrato-pai precisa ser do tipo mentorship (integridade entre discriminador e
-- extensão). FOR KEY SHARE tranca a linha-pai contra flip concorrente do tipo.
create or replace function public.assert_contract_is_mentorship()
returns trigger
language plpgsql
as $$
begin
  perform 1 from contracts c
    where c.id = new.contract_id and c.contract_type = 'mentorship'
    for key share of c;
  if not found then
    raise exception 'contrato % não é do tipo mentorship', new.contract_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mentorship_contracts_type_check
  before insert or update of contract_id on mentorship_contracts
  for each row execute function public.assert_contract_is_mentorship();

-- E o inverso (ADR-008): contract_type é imutável enquanto existir extensão de mentoria
-- ou qualquer entrada em ledger — impede contrato "híbrido" incoerente.
create or replace function public.forbid_contract_type_flip()
returns trigger
language plpgsql
as $$
begin
  if old.contract_type is distinct from new.contract_type and (
       exists (select 1 from mentorship_contracts mc where mc.contract_id = old.id)
       or exists (select 1 from makeup_ledger ml where ml.contract_id = old.id)
       or exists (select 1 from mentorship_credit_ledger mcl where mcl.contract_id = old.id)
     ) then
    raise exception 'contract_type de % é imutável: contrato já tem extensão de mentoria ou histórico em ledger', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger contracts_type_immutable
  before update of contract_type on contracts
  for each row execute function public.forbid_contract_type_flip();

-- ---------------------------------------------------------------------------
-- Escada de progresso por janela (D2 / ADR-006)
-- Etapa sem linha OU com threshold_pct NULL = regras não configuradas → M2 bloqueia
-- a reserva com exceção explícita. Os percentuais da dona entram por INSERT/UPDATE
-- nesta tabela, sem migration.
-- ---------------------------------------------------------------------------
create table mentorship_window_rules (
  contract_id uuid not null references mentorship_contracts (contract_id),
  window_index int not null check (window_index >= 1),
  threshold_pct numeric check (threshold_pct between 0 and 100),
  primary key (contract_id, window_index)
);

-- ---------------------------------------------------------------------------
-- Espelho de progresso do curso (Fase 5: polling Hotmart; até lá, bridge manual).
-- UMA linha por contrato (o contrato de mentoria é individual — ADR-005/ADR-008):
-- o gate D2 do M2 não pode ter completion_pct ambíguo.
-- ---------------------------------------------------------------------------
create table course_progress (
  contract_id uuid primary key references mentorship_contracts (contract_id),
  student_id uuid not null references students (id),
  completion_pct numeric not null default 0 check (completion_pct between 0 and 100),
  total_pages int check (total_pages >= 0),
  completed_pages int check (completed_pages >= 0),
  last_synced_at timestamptz not null default now(),
  constraint course_progress_pages_ok
    check (completed_pages is null or total_pages is null or completed_pages <= total_pages)
);

-- ---------------------------------------------------------------------------
-- Sessões em grupo: datas avulsas pré-definidas pela dona (NÃO passam pela
-- materialização de recorrência do M3). Capacidade garantida por CHECK + lock na
-- reserva (M2).
-- ---------------------------------------------------------------------------
create table mentorship_sessions (
  id uuid primary key default gen_random_uuid(),
  scheduled_at timestamptz not null,
  local_time_snapshot text not null,
  duration_min int not null default 60 check (duration_min > 0),
  capacity int not null default 6 check (capacity > 0),
  booked_count int not null default 0,
  status mentorship_session_status not null default 'open',
  google_event_id text,
  gmeet_url text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  constraint mentorship_sessions_cap_ok check (booked_count between 0 and capacity)
);
comment on column mentorship_sessions.local_time_snapshot is 'Ex.: ''2026-12-15 19:00 America/Cuiaba'' — hora local em que a admin concebeu a sessão (Lei 1: toda instância guarda snapshot textual).';
comment on column mentorship_sessions.status is 'Ciclo: scheduled = criada, ainda não reservável; open = aberta para reserva; full = lotada (mantido pelo M2 ao atingir capacity); done/cancelled = encerramento. Reserva só em open.';

-- ---------------------------------------------------------------------------
-- Ledger de créditos de mentoria (Lei 2: append-only, saldo derivado).
-- ADR-001: chaveado por contrato; student_id NOT NULL (contrato de mentoria é individual,
-- mas mantemos a mesma chave de saldo dos dois ledgers por consistência).
-- ---------------------------------------------------------------------------
create table mentorship_credit_ledger (
  id bigint generated always as identity primary key,
  contract_id uuid not null references mentorship_contracts (contract_id),
  student_id uuid not null references students (id),
  delta int not null check (delta <> 0),
  reason credit_reason not null,
  window_index int check (window_index >= 1),
  expires_at timestamptz,
  session_id uuid references mentorship_sessions (id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  -- Lei 2/D3: acúmulo é COMPUTADO, nunca lançado — materializar accrual duplicaria
  -- o crédito no saldo derivado do M2.
  constraint mentorship_ledger_no_accrual check (reason <> 'accrual_window'),
  -- Gasto de reserva: exatamente 1 crédito, sempre com a etapa consumida e a sessão (D2).
  constraint mentorship_ledger_spend_shape
    check (reason <> 'booking_spend' or (window_index is not null and session_id is not null and delta = -1))
);
create index mentorship_credit_ledger_contract_idx on mentorship_credit_ledger (contract_id);
comment on constraint mentorship_ledger_no_accrual on mentorship_credit_ledger is 'O valor ''accrual_window'' permanece no enum por compatibilidade com o doc 04, mas é proibido: janelas destravadas vêm de mentorship_windows_unlocked() (M2). ''expiry'' idem: a expiração v1 é derivada da vigência; lançamentos ''expiry'' são reservados a baixa explícita futura e NÃO podem ser somados duas vezes pelo saldo.';

-- Escada D2 como constraint (ADR-008): cada etapa é consumida NO MÁXIMO uma vez —
-- fecha a corrida de duplo gasto entre sessões diferentes do mesmo contrato.
create unique index mentorship_spend_window_uniq
  on mentorship_credit_ledger (contract_id, window_index)
  where reason = 'booking_spend';

create trigger mentorship_credit_ledger_append_only
  before update or delete on mentorship_credit_ledger
  for each row execute function public.forbid_mutation();
create trigger mentorship_credit_ledger_no_truncate
  before truncate on mentorship_credit_ledger
  for each statement execute function public.forbid_mutation();

revoke update, delete, truncate on mentorship_credit_ledger from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reservas: 1 vaga por aluno por sessão; cada reserva aponta a entrada de gasto no
-- ledger. FK composta (ADR-008): a entrada do ledger referenciada É do mesmo contrato
-- e da mesma sessão — consistência por constraint, não por disciplina do M2.
-- ---------------------------------------------------------------------------
alter table mentorship_credit_ledger
  add constraint mentorship_ledger_booking_ref_uniq unique (id, contract_id, session_id);

create table mentorship_bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mentorship_sessions (id),
  student_id uuid not null references students (id),
  contract_id uuid not null references mentorship_contracts (contract_id),
  ledger_id bigint not null unique,
  created_at timestamptz not null default now(),
  unique (session_id, student_id),
  foreign key (ledger_id, contract_id, session_id)
    references mentorship_credit_ledger (id, contract_id, session_id)
);

-- RLS deny-all (Lei 4); policies no M5.
alter table mentorship_contracts enable row level security;
alter table mentorship_window_rules enable row level security;
alter table course_progress enable row level security;
alter table mentorship_sessions enable row level security;
alter table mentorship_credit_ledger enable row level security;
alter table mentorship_bookings enable row level security;
