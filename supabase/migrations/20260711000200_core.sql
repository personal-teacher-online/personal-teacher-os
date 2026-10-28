-- M1.2 — Núcleo: pessoas, contratos, agenda recorrente, instâncias, auditoria.
-- Base: docs/research/02-blueprint-engenharia.md §1, com os refinamentos aprovados
-- (ADRs 001–005) e os endurecimentos da revisão adversarial (ADR-008), em docs/decisions/.
--
-- Convenções globais:
--   * weekday: 0=domingo, 1=segunda, ... 6=sábado (mesma convenção do JS Date.getDay()
--     e do extract(dow) do Postgres).
--   * Dinheiro SEMPRE em centavos, int, sufixo _cents (Lei 9).
--   * Instantes em timestamptz (UTC); recorrência como hora local + zona IANA (Lei 1).
--   * RLS habilitado deny-all em toda tabela já nesta migration; policies chegam no M5 (Lei 4).

-- ---------------------------------------------------------------------------
-- Guarda genérica de append-only (Lei 2 / Lei 8): usada por ledgers e audit_log.
-- Row-level para UPDATE/DELETE; statement-level para TRUNCATE (row triggers não
-- disparam em TRUNCATE). Cobre inclusive owner/service_role, que REVOKE não alcança.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% é append-only — % proibido', tg_table_name, tg_op
    using errcode = '42501'; -- insufficient_privilege
end;
$$;

-- ---------------------------------------------------------------------------
-- Validação de zona IANA (ADR-004): consulta pg_timezone_names via trigger.
-- CHECK constraint não pode consultar catálogo, e a lista de zonas evolui com o tzdata.
-- Endurecida (ADR-008): rejeita abreviações e zonas de offset fixo ('EST', 'CET',
-- 'Etc/GMT-3' — sinal invertido!), aliases legados ('Brazil/West', 'US/Eastern') e os
-- subtrees posix/right — qualquer um deles reintroduziria offset fixo, violando a Lei 1.
-- ---------------------------------------------------------------------------
create or replace function public.assert_valid_iana_tz()
returns trigger
language plpgsql
as $$
declare
  v_tz text := to_jsonb(new) ->> 'iana_tz';
begin
  if v_tz is null
     or v_tz !~ '/'
     or v_tz ~ '^(posix|right|Etc|Brazil|US|Canada|Chile|Mexico)/'
     or not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'iana_tz inválida ou não-canônica em %.%: %', tg_table_schema, tg_table_name, coalesce(v_tz, 'NULL')
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pessoas e papéis
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin', 'teacher', 'student', 'sales');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null,
  full_name text not null,
  iana_tz text not null default 'America/Sao_Paulo',
  whatsapp_e164 text,
  created_at timestamptz not null default now()
);
comment on table profiles is 'Espelho 1:1 de auth.users com papel e fuso. Autorização SEMPRE via app_metadata.role no JWT (Lei 4), nunca user_metadata; esta coluna role é referência operacional.';

create trigger profiles_valid_tz
  before insert or update of iana_tz on profiles
  for each row execute function public.assert_valid_iana_tz();

create table students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles (id),
  display_name text not null,
  iana_tz text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'churned')),
  city text,
  country text,
  created_at timestamptz not null default now()
);
comment on column students.iana_tz is 'Zona IANA do aluno (D1: horários exibidos/armazenados na hora local do ALUNO). Ex.: America/Cuiaba, America/New_York, Europe/Lisbon.';

-- Relação profile↔student é 1:1 (RLS do M5 mapeia auth.uid() → profile → student).
create unique index students_profile_uniq on students (profile_id) where profile_id is not null;

create trigger students_valid_tz
  before insert or update of iana_tz on students
  for each row execute function public.assert_valid_iana_tz();

create table payers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  cpf_cnpj text,
  asaas_customer_id text unique
);
comment on table payers is 'Pagador ≠ aluno (casal, responsável). Integração Asaas na Fase 2.';

create table student_payers (
  student_id uuid not null references students (id),
  payer_id uuid not null references payers (id),
  primary key (student_id, payer_id)
);

create table student_groups (
  id uuid primary key default gen_random_uuid(),
  label text not null
);
comment on table student_groups is 'Grupo de alunos que compartilha um contrato/slot (caso Natália+Yago).';

create table student_group_members (
  group_id uuid not null references student_groups (id),
  student_id uuid not null references students (id),
  primary key (group_id, student_id)
);

create table teachers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles (id),
  hourly_rate_cents int not null check (hourly_rate_cents >= 0),
  payment_terms text,
  is_owner boolean not null default false
);
comment on column teachers.hourly_rate_cents is 'A professora é paga por hora AUDITADA; statements na Fase 3.';

create unique index teachers_profile_uniq on teachers (profile_id) where profile_id is not null;

-- ---------------------------------------------------------------------------
-- Contratos (ADR-002: XOR aluno/grupo; ADR-005: discriminador + campos condicionais)
-- ---------------------------------------------------------------------------
create type contract_type as enum ('private_1on1', 'mentorship');

create table contracts (
  id uuid primary key default gen_random_uuid(),
  contract_type contract_type not null default 'private_1on1',
  student_id uuid references students (id),
  student_group_id uuid references student_groups (id),
  teacher_id uuid references teachers (id),
  plan_name text not null,
  hourly_rate_cents int not null check (hourly_rate_cents >= 0),
  -- Campos de remarcação: só fazem sentido em private_1on1 (NULL em mentoria).
  monthly_reschedule_allowance int check (monthly_reschedule_allowance between 0 and 10),
  min_notice_hours int check (min_notice_hours >= 0),
  makeup_credit_expiry_days int check (makeup_credit_expiry_days >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  started_on date not null,
  ended_on date,
  constraint contracts_dates_ok
    check (ended_on is null or ended_on >= started_on),
  -- ADR-002: exatamente UM entre aluno individual e grupo.
  constraint contracts_student_xor_group
    check ((student_id is null) <> (student_group_id is null)),
  -- ADR-005: particulares exigem professor e parâmetros de remarcação.
  constraint contracts_private_fields
    check (
      contract_type <> 'private_1on1'
      or (
        teacher_id is not null
        and monthly_reschedule_allowance is not null
        and min_notice_hours is not null
        and makeup_credit_expiry_days is not null
      )
    ),
  -- Mentoria é individual (ADR-001/ADR-005): nunca aponta para grupo.
  constraint contracts_mentorship_individual
    check (contract_type <> 'mentorship' or student_id is not null)
);

-- ---------------------------------------------------------------------------
-- Agenda recorrente: a REGRA fica em hora local + zona IANA (Lei 1).
-- A expansão para instâncias UTC acontece em materialize_instances() (M3),
-- calculando o offset do dia específico: (date + local_time) AT TIME ZONE iana_tz.
-- ---------------------------------------------------------------------------
create table recurring_slots (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id),
  teacher_id uuid not null references teachers (id),
  weekday int not null check (weekday between 0 and 6), -- 0=domingo ... 6=sábado
  local_time time not null,
  iana_tz text not null,
  duration_min int not null default 60 check (duration_min > 0),
  active_from date not null,
  active_to date,
  check (active_to is null or active_to >= active_from)
);
comment on column recurring_slots.weekday is '0=domingo, 1=segunda, ..., 6=sábado. Dia da semana na data civil LOCAL (iana_tz), nunca em UTC.';
comment on column recurring_slots.local_time is 'Hora LOCAL do aluno (D1), na zona iana_tz. Nunca armazenar UTC aqui. Semântica DST: starts_at_utc é SEMPRE o instante computado pelo Postgres na materialização; a camada TS (Luxon) apenas FORMATA, nunca recomputa. Horários 01:00–02:59 em zonas com DST caem em janelas ambíguas/inexistentes na transição — evitar.';

-- Um contrato não repete o mesmo slot ativo (protege a idempotência do M3).
create unique index recurring_slots_active_uniq
  on recurring_slots (contract_id, weekday, local_time, iana_tz)
  where active_to is null;

create trigger recurring_slots_valid_tz
  before insert or update of iana_tz on recurring_slots
  for each row execute function public.assert_valid_iana_tz();

-- Slot com instâncias materializadas tem horário IMUTÁVEL (ADR-008): mudar horário é
-- fechar o slot (active_to) e criar outro — senão a chave de idempotência e o histórico
-- divergem da regra que os gerou.
create or replace function public.forbid_slot_timing_change()
returns trigger
language plpgsql
as $$
begin
  if (old.weekday, old.local_time, old.iana_tz) is distinct from (new.weekday, new.local_time, new.iana_tz)
     and exists (select 1 from class_instances ci where ci.slot_id = old.id) then
    raise exception 'slot % já tem instâncias materializadas; feche-o (active_to) e crie um novo slot', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Instâncias materializadas (sempre UTC + snapshot local para auditoria)
-- ---------------------------------------------------------------------------
create type class_state as enum
  ('scheduled', 'completed', 'no_show_student', 'no_show_teacher', 'cancelled', 'rescheduled');

create table class_instances (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id),
  teacher_id uuid not null references teachers (id),
  slot_id uuid references recurring_slots (id),
  occurrence_date date,
  starts_at_utc timestamptz not null,
  ends_at_utc timestamptz not null,
  local_time_snapshot text not null,
  state class_state not null default 'scheduled',
  google_event_id text,
  gmeet_url text,
  drive_recording_id text,
  reschedule_of uuid references class_instances (id),
  created_at timestamptz not null default now(),
  check (ends_at_utc > starts_at_utc),
  -- Instância vinda de slot carrega sua data civil LOCAL (identidade da ocorrência).
  constraint class_instances_occurrence_required
    check (slot_id is null or occurrence_date is not null),
  -- Instância criada por remarcação é avulsa (o vínculo com o slot é via reschedule_of
  -- → original); impede colisão com a chave de idempotência da ocorrência original.
  constraint class_instances_reschedule_detached
    check (reschedule_of is null or slot_id is null)
);
comment on column class_instances.local_time_snapshot is 'Ex.: ''2026-07-15 16:45 America/Cuiaba'' — snapshot textual legível para auditoria (Lei 1).';
comment on column class_instances.occurrence_date is 'Data civil LOCAL (na zona do slot) da ocorrência. É a identidade da ocorrência para idempotência do M3 — estável mesmo se tzdata ou horário do slot mudarem.';

create index class_instances_teacher_time_idx
  on class_instances (teacher_id, starts_at_utc);

create index class_instances_contract_time_idx
  on class_instances (contract_id, starts_at_utc);

-- Lei 3: conflito de agenda do professor por índice único parcial (início idêntico)...
create unique index class_instances_teacher_no_overlap
  on class_instances (teacher_id, starts_at_utc)
  where state in ('scheduled', 'completed');

-- ...complementado por exclusão de SOBREPOSIÇÃO de intervalos (ADR-008): zonas com DST
-- deslocam alunos em datas diferentes e criam overlaps parciais que a igualdade de
-- início não detecta.
alter table class_instances
  add constraint class_instances_teacher_no_overlap_excl
  exclude using gist (teacher_id with =, tstzrange(starts_at_utc, ends_at_utc) with &&)
  where (state in ('scheduled', 'completed'));

-- Idempotência da materialização (M3): um slot gera no máximo UMA instância por data
-- civil local. Instâncias remarcadas/canceladas continuam ocupando a chave, impedindo
-- re-geração.
create unique index class_instances_slot_occurrence_uniq
  on class_instances (slot_id, occurrence_date)
  where slot_id is not null;

create trigger recurring_slots_timing_immutable
  before update of weekday, local_time, iana_tz on recurring_slots
  for each row execute function public.forbid_slot_timing_change();

-- ---------------------------------------------------------------------------
-- Auditoria universal (Lei 8) — trilha imutável como os ledgers.
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid references profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  at timestamptz not null default now()
);
comment on column audit_log.actor is 'ON DELETE SET NULL: excluir um profile não pode apagar nem travar a trilha; o diff jsonb preserva o contexto.';
create index audit_log_entity_idx on audit_log (entity, entity_id);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function public.forbid_mutation();
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function public.forbid_mutation();
revoke update, delete, truncate on audit_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tabelas do blueprint para Fases 2–4 (baratas agora, migration dolorosa depois)
-- ---------------------------------------------------------------------------
create table class_audits (
  id uuid primary key default gen_random_uuid(),
  class_instance_id uuid unique references class_instances (id),
  checklist jsonb not null,
  audited_duration_min int,
  passed boolean not null,
  model text,
  raw_transcript_ref text,
  created_at timestamptz not null default now()
);
comment on table class_audits is 'Resultado do pipeline Whisper+Claude (Fase 4). O app armazena/exibe/fatura; não executa o pipeline.';

create table teacher_statements (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers (id),
  period_start date,
  period_end date,
  audited_hours numeric(6, 2),
  rate_cents int,
  adjustments_cents int default 0,
  total_cents int,
  status text default 'draft',
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  asaas_payment_id text unique not null,
  payer_id uuid references payers (id),
  amount_cents int,
  status text,
  due_date date,
  paid_at timestamptz,
  billing_type text,
  raw jsonb,
  updated_at timestamptz default now()
);
comment on table payments is 'Espelho Asaas via webhook idempotente (Lei 6): chave natural asaas_payment_id UNIQUE, payload cru em raw jsonb.';

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  whatsapp_e164 text,
  source text,
  questionnaire jsonb,
  status text default 'new',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS deny-all em TODAS as tabelas (Lei 4). Policies por papel chegam no M5.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table students enable row level security;
alter table payers enable row level security;
alter table student_payers enable row level security;
alter table student_groups enable row level security;
alter table student_group_members enable row level security;
alter table teachers enable row level security;
alter table contracts enable row level security;
alter table recurring_slots enable row level security;
alter table class_instances enable row level security;
alter table audit_log enable row level security;
alter table class_audits enable row level security;
alter table teacher_statements enable row level security;
alter table payments enable row level security;
alter table leads enable row level security;
