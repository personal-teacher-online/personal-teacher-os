-- Fase 2 / M1.1 — Janelas de remarcação publicadas (D1/D12/D13/D15).
-- A professora publica horários; o aluno consome um deles. O instante publicado
-- (starts_at_utc, derivado no INSERT com o offset DAQUELE dia — Lei 1) é a FONTE DE
-- VERDADE: a instância criada copia o instante byte a byte (caso de teste 15).

create type reschedule_window_state as enum ('publicada', 'consumida', 'cancelada');

create table reschedule_windows (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers (id),
  -- Hora local NA ZONA DE QUEM PUBLICA (D1; hoje as duas professoras = fuso do negócio).
  local_date date not null,
  local_time time not null,
  iana_tz text not null,
  starts_at_utc timestamptz not null,
  local_time_snapshot text not null,
  state reschedule_window_state not null default 'publicada',
  consumed_by_instance_id uuid references class_instances (id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  -- consumida ⇔ aponta para a instância que a consumiu (Lei 8: rastro do consumo)
  constraint reschedule_windows_consumed_shape check (
    (state = 'consumida') = (consumed_by_instance_id is not null)
  )
);
comment on column reschedule_windows.starts_at_utc is 'FONTE DE VERDADE do instante publicado (D1). book_reschedule_window copia este valor byte a byte para a instância — nunca reconverte via data/hora local (viradas de DST criam horas ambíguas/inexistentes).';

-- A mesma professora não publica duas janelas ativas no mesmo instante.
create unique index reschedule_windows_teacher_slot_uniq
  on reschedule_windows (teacher_id, starts_at_utc)
  where state = 'publicada';
create index reschedule_windows_teacher_time_idx
  on reschedule_windows (teacher_id, starts_at_utc);

create trigger reschedule_windows_valid_tz
  before insert or update of iana_tz on reschedule_windows
  for each row execute function public.assert_valid_iana_tz();

alter table reschedule_windows enable row level security;

-- ---------------------------------------------------------------------------
-- Helper interno: zona IANA de uma instância (cadeia de remarcações → slot;
-- fallback: zona do aluno do contrato). Mesma semântica de reschedule_class (M2).
-- ---------------------------------------------------------------------------
create or replace function public.class_instance_tz(p_instance uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select ci.* from class_instances ci where ci.id = p_instance
    union all
    select ci.* from class_instances ci join chain on chain.reschedule_of = ci.id
  )
  select coalesce(
    (select rs.iana_tz from chain join recurring_slots rs on rs.id = chain.slot_id limit 1),
    (select s.iana_tz
       from class_instances i
       join contracts c on c.id = i.contract_id
       join students s on s.id = c.student_id
      where i.id = p_instance),
    -- Contrato de GRUPO (student_id NULL — ADR-002): instância de resgate D12 não tem
    -- slot nem cadeia; a zona vem dos membros (mesmo domicílio; min() = determinístico).
    (select min(s.iana_tz)
       from class_instances i
       join contracts c on c.id = i.contract_id
       join student_group_members m on m.group_id = c.student_group_id
       join students s on s.id = m.student_id
      where i.id = p_instance)
  )
$$;

-- ---------------------------------------------------------------------------
-- reschedule_class_at: variante interna que recebe o INSTANTE alvo (D1 opção ii).
-- Nome DISTINTO de propósito: overload homônimo criaria ambiguidade de resolução
-- com literais sem tipo (Postgres escolheria a função errada em chamadas via SQL/RPC).
-- Toda a orquestração (locks, aviso mínimo, alçada lazy, crédito, flip de estado,
-- auditoria) vive AQUI; a assinatura original vira um conversor fino que delega.
-- NUNCA exposto a clientes (EXECUTE revogado no fim do arquivo).
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_class_at(
  p_instance uuid,
  p_new_starts_utc timestamptz,
  p_new_snapshot text,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old class_instances%rowtype;
  v_contract contracts%rowtype;
  v_tz text;
  v_duration interval;
  v_orig_local_date date;
  v_period text;
  v_used int;
  v_via text;
  v_new_id uuid;
begin
  select * into v_old from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_old.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_old.state;
  end if;

  -- Lock do contrato: serializa alçada + saldo por contrato.
  select * into v_contract from contracts where id = v_old.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'reschedule_class só se aplica a contratos private_1on1';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo — remarcação bloqueada', v_contract.id;
  end if;

  -- Aviso mínimo sobre a aula ORIGINAL (caso de teste 7).
  if now() > v_old.starts_at_utc - make_interval(hours => v_contract.min_notice_hours) then
    raise exception 'remarcação exige % h de aviso mínimo (aula começa em %)',
      v_contract.min_notice_hours, v_old.starts_at_utc;
  end if;

  if p_new_starts_utc <= now() then
    raise exception 'nova data/hora da remarcação já passou (%)', p_new_starts_utc;
  end if;

  -- Zona da aula original (cadeia → slot; fallback aluno) para o period_ym (ADR-008).
  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da remarcação do contrato %', v_contract.id;
  end if;

  v_duration := v_old.ends_at_utc - v_old.starts_at_utc;

  -- Alçada mensal (ADR-003 lazy; ADR-008: period = mês da data LOCAL da aula original).
  v_orig_local_date := coalesce(v_old.occurrence_date, (v_old.starts_at_utc at time zone v_tz)::date);
  v_period := to_char(v_orig_local_date, 'YYYY-MM');
  insert into reschedule_usage (contract_id, period_ym, used_count)
  values (v_contract.id, v_period, 0)
  on conflict (contract_id, period_ym) do nothing;
  update reschedule_usage
     set used_count = used_count + 1
   where contract_id = v_contract.id
     and period_ym = v_period
     and used_count < v_contract.monthly_reschedule_allowance
  returning used_count into v_used;

  if v_used is not null then
    v_via := 'allowance';
  else
    -- Alçada esgotada → consome crédito de reposição (exceção se saldo zero — caso 8).
    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, p_instance, p_actor);
    v_via := 'makeup_credit';
  end if;

  update class_instances set state = 'rescheduled' where id = p_instance;

  -- Nova instância é avulsa (slot_id NULL — ADR-008): conflito de agenda do professor
  -- estoura aqui pela constraint de exclusão e reverte a transação inteira.
  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
     local_time_snapshot, state, reschedule_of)
  values
    (v_contract.id, v_old.teacher_id, null, null, p_new_starts_utc, p_new_starts_utc + v_duration,
     p_new_snapshot, 'scheduled', p_instance)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reschedule_class', 'class_instances', v_new_id::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'old_starts_at_utc', v_old.starts_at_utc,
      'new_starts_at_utc', p_new_starts_utc,
      'iana_tz', v_tz,
      'via', v_via,
      'period_ym', v_period));

  return v_new_id;
end;
$$;

-- Assinatura original (Fase 1) vira conversor: resolve a zona, calcula o instante
-- DAQUELE dia (Lei 1) e delega. Comportamento e testes da Fase 1 permanecem intactos.
create or replace function public.reschedule_class(
  p_instance uuid,
  p_new_local_date date,
  p_new_local_time time,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
begin
  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da instância %', p_instance;
  end if;
  return public.reschedule_class_at(
    p_instance,
    (p_new_local_date + p_new_local_time) at time zone v_tz,
    to_char(p_new_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_new_local_time, 'HH24:MI') || ' ' || v_tz,
    p_actor);
end;
$$;

-- ---------------------------------------------------------------------------
-- Publicar / cancelar janela (admin-only no M1; painel da professora = Fase 3).
-- ---------------------------------------------------------------------------
create or replace function public.publish_reschedule_window(
  p_teacher uuid,
  p_local_date date,
  p_local_time time,
  p_iana_tz text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_starts timestamptz;
  v_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'publish_reschedule_window é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if not exists (select 1 from teachers t where t.id = p_teacher) then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- Zona de quem publica (D1): hoje ambas as professoras operam no fuso do negócio.
  v_tz := coalesce(p_iana_tz, public.business_tz());
  v_starts := (p_local_date + p_local_time) at time zone v_tz;
  if v_starts <= now() then
    raise exception 'janela % % (%) já passou', p_local_date, p_local_time, v_tz;
  end if;

  insert into reschedule_windows
    (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
  values
    (p_teacher, p_local_date, p_local_time, v_tz, v_starts,
     to_char(p_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_local_time, 'HH24:MI') || ' ' || v_tz,
     v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'publish_reschedule_window', 'reschedule_windows', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'starts_at_utc', v_starts, 'iana_tz', v_tz));
  return v_id;
end;
$$;

create or replace function public.cancel_reschedule_window(
  p_window uuid,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_win reschedule_windows%rowtype;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_reschedule_window é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_win from reschedule_windows where id = p_window for update;
  if not found then
    raise exception 'janela % não existe', p_window;
  end if;
  -- D15: consumida NÃO reabre nem cancela — a republicação é manual (janela nova).
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está publicada (estado: %)', p_window, v_win.state;
  end if;

  update reschedule_windows set state = 'cancelada' where id = p_window;
  perform public.log_audit(v_actor, 'cancel_reschedule_window', 'reschedule_windows', p_window::text, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Consumo de janela pelo aluno (ou admin por ele) — D1/D10/D12/D13.
-- Modo remarcação: p_instance (aula a remarcar). Modo resgate (D12): p_contract
-- (crédito vira aula avulsa; caso dominante do lançamento — backlog).
-- ---------------------------------------------------------------------------
create or replace function public.book_reschedule_window(
  p_window uuid,
  p_instance uuid default null,
  p_contract uuid default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_win reschedule_windows%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_inst_teacher uuid;
  v_actor uuid;
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- Consumo atômico: lock da janela primeiro (corrida de 2 alunos → um vence, caso 8).
  select * into v_win from reschedule_windows where id = p_window for update;
  if not found then
    raise exception 'janela % não existe', p_window;
  end if;
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está disponível (estado: %)', p_window, v_win.state;
  end if;
  if v_win.starts_at_utc <= now() then
    raise exception 'janela % já passou', p_window;
  end if;
  -- Janela máxima de 2 semanas (D1) — regra avaliada NO CONSUMO.
  if v_win.starts_at_utc > now() + interval '14 days' then
    raise exception 'janela % está a mais de 2 semanas (%)', p_window, v_win.starts_at_utc;
  end if;

  if p_instance is not null then
    select ci.contract_id, ci.teacher_id into v_contract_id, v_inst_teacher
      from class_instances ci where ci.id = p_instance;
    if v_contract_id is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
  end if;

  -- D10: posse do chamador — dono do contrato OU admin. SECURITY DEFINER ignora RLS,
  -- então a autorização é EXPLÍCITA aqui dentro.
  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
  -- Caso 16 (D1): a janela precisa ser da professora da AULA remarcada — âncora na
  -- INSTÂNCIA; no resgate (sem aula), na professora do contrato. Instância divergente
  -- do contrato = estado inconsistente (admin trocou teacher_id?): falhar cedo.
  if p_instance is not null then
    if v_inst_teacher <> v_win.teacher_id then
      raise exception 'janela % pertence a outra professora (D1)', p_window;
    end if;
    if v_inst_teacher <> v_contract.teacher_id then
      raise exception 'instância % (professora %) diverge do contrato % (professora %) — corrigir antes de remarcar',
        p_instance, v_inst_teacher, v_contract.id, v_contract.teacher_id;
    end if;
  elsif v_contract.teacher_id <> v_win.teacher_id then
    raise exception 'janela % pertence a outra professora (D1)', p_window;
  end if;

  if p_instance is not null then
    -- Modo REMARCAÇÃO: o overload copia o instante publicado BYTE A BYTE (invariante D1).
    v_new_id := public.reschedule_class_at(p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor);
  else
    -- Modo RESGATE (D12): crédito de reposição vira aula avulsa. Sem alçada — resgate
    -- SEMPRE consome crédito. Sem aviso mínimo — não há aula sendo movida.
    select * into v_contract from contracts where id = v_contract_id for update;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;
    -- Duração: a do slot ativo do contrato (decisão do plano do M1).
    select rs.duration_min into v_duration_min
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;
    if v_duration_min is null then
      raise exception 'contrato % não tem slot ativo para definir a duração do resgate', v_contract.id;
    end if;

    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       v_win.starts_at_utc + make_interval(mins => v_duration_min),
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    -- Saldo verificado DENTRO da transação, com lock por contrato (Lei 2).
    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

  -- INVARIANTE D1 (caso 15): o instante da instância criada É o publicado, byte a byte.
  select starts_at_utc into v_new_starts from class_instances where id = v_new_id;
  if v_new_starts <> v_win.starts_at_utc then
    raise exception 'invariante violado: instância criada em % ≠ janela publicada em %',
      v_new_starts, v_win.starts_at_utc;
  end if;

  update reschedule_windows
     set state = 'consumida', consumed_by_instance_id = v_new_id
   where id = p_window;

  perform public.log_audit(v_actor, 'book_reschedule_window', 'reschedule_windows', p_window::text,
    jsonb_build_object(
      'mode', case when p_instance is not null then 'reschedule' else 'redeem' end,
      'instance', p_instance, 'contract', v_contract_id,
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc));

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exposição (ADR-010 §2: revogar SEMPRE — função nova nasce com EXECUTE a PUBLIC).
-- book/publish/cancel são chamáveis por authenticated (D10 valida DENTRO);
-- o overload por instante e o helper de zona são internos.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.reschedule_class_at(uuid, timestamptz, text, uuid),
  public.class_instance_tz(uuid),
  public.publish_reschedule_window(uuid, date, time, text, uuid),
  public.cancel_reschedule_window(uuid, uuid),
  public.book_reschedule_window(uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.publish_reschedule_window(uuid, date, time, text, uuid),
  public.cancel_reschedule_window(uuid, uuid),
  public.book_reschedule_window(uuid, uuid, uuid, uuid)
to authenticated;
