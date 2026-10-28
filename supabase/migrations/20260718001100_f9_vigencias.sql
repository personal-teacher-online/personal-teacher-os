-- F9 — Extratos com VIGÊNCIAS de valor/hora (plano integrado v2, 18/07/2026;
-- decisão M12-7 + P12 do passe adversarial). Mata a pendura M5-8:
--   • tabela de vigências (professora · vale-a-partir-de · valor), SÓ-FUTURO
--     pela RPC (a única exceção retroativa é a SEMENTE desta migration);
--   • o gerador soma POR AULA: duração real × valor vigente na DATA CIVIL da
--     aula no fuso do NEGÓCIO (Cuiabá — P12, a convenção civil da casa);
--   • acertos retroativos saem ao valor DA ÉPOCA automaticamente (vigências
--     só-futuro ⇒ o passado é estável por construção);
--   • teacher_statements.rate_cents vira INFORMATIVO; base_cents guarda a soma.

create table teacher_rate_periods (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers (id),
  valid_from date not null,
  rate_cents int not null check (rate_cents > 0),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (teacher_id, valid_from)
);
comment on table teacher_rate_periods is
  'M12-7: histórico de valor/hora. valid_from é data CIVIL do negócio (Cuiabá — '
  'P12); vale de 00:00 desse dia em diante. Escrita SÓ pela RPC (só-futuro).';

alter table teacher_rate_periods enable row level security;
create policy trp_admin_read on teacher_rate_periods
  for select to authenticated using ((select public.app_role()) = 'admin');
create policy trp_own_read on teacher_rate_periods
  for select to authenticated using (teacher_id = (select public.my_teacher_id()));
grant select on teacher_rate_periods to anon, authenticated;

-- SEMENTE (única exceção retroativa): o valor atual de cada professora vira a
-- vigência inicial — o histórico de hoje em diante nasce de graça.
insert into teacher_rate_periods (teacher_id, valid_from, rate_cents)
select id, date '1900-01-01', hourly_rate_cents
from teachers
where hourly_rate_cents is not null and hourly_rate_cents > 0;

comment on column teachers.hourly_rate_cents is
  'INFORMATIVO desde a F9 (M12-7): o valor que PAGA é o da vigência da data de '
  'cada aula (teacher_rate_periods). Mantido como fallback de professora sem '
  'vigência e como default de UI.';

-- ---------------------------------------------------------------------------
-- Valor vigente numa data (fallback: coluna informativa da professora)
-- ---------------------------------------------------------------------------
create or replace function public._teacher_rate_on(p_teacher uuid, p_date date)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select trp.rate_cents from teacher_rate_periods trp
      where trp.teacher_id = p_teacher and trp.valid_from <= p_date
      order by trp.valid_from desc limit 1),
    (select t.hourly_rate_cents from teachers t where t.id = p_teacher),
    0)
$$;

-- Soma POR AULA do período (mesmo predicado de _teacher_payable_hours,
-- 20260713000600 — mantê-los em ESPELHO; a suíte pina a paridade).
create or replace function public._teacher_payable_cents(
  p_teacher uuid,
  p_start date,
  p_end date
) returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    round(extract(epoch from (i.ends_at_utc - i.starts_at_utc)) / 3600.0
          * public._teacher_rate_on(
              p_teacher, (i.starts_at_utc at time zone public.business_tz())::date))
  ), 0)::int
  from class_instances i
  where i.teacher_id = p_teacher
    and i.starts_at_utc < now()
    and (i.starts_at_utc at time zone public.business_tz())::date between p_start and p_end
    and (
      i.state in ('completed', 'no_show_student')
      or (
        i.state = 'scheduled'
        and not exists (
          select 1
          from contract_pauses cp
          where cp.contract_id = i.contract_id
            and (i.starts_at_utc at time zone public.business_tz())::date >= cp.paused_on
            and (cp.resumed_on is null
                 or (i.starts_at_utc at time zone public.business_tz())::date < cp.resumed_on)
        )
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- Gestão das vigências: SÓ-FUTURO (ratificado) — efeito passado é RECUSADO.
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_rate_period(
  p_teacher uuid,
  p_valid_from date,
  p_rate_cents int,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_add_rate_period é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if not exists (select 1 from teachers t where t.id = p_teacher) then
    raise exception 'professora % não existe', p_teacher;
  end if;
  if p_rate_cents is null or p_rate_cents <= 0 then
    raise exception 'valor/hora inválido';
  end if;
  -- P12/M12-(a): SÓ-FUTURO estrito — nada reescreve extrato passado ou o mês corrente.
  if p_valid_from <= public.business_today() then
    raise exception 'vigência com efeito passado é recusada — valid_from precisa ser DEPOIS de hoje (%)',
      public.business_today();
  end if;

  insert into teacher_rate_periods (teacher_id, valid_from, rate_cents, created_by)
  values (p_teacher, p_valid_from, p_rate_cents, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'add_rate_period', 'teacher_rate_periods', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'valid_from', p_valid_from,
                       'rate_cents', p_rate_cents));
  return v_id;
end;
$$;
revoke execute on function public.admin_add_rate_period(uuid, date, int, uuid) from public, anon;
grant execute on function public.admin_add_rate_period(uuid, date, int, uuid) to authenticated;

create or replace function public.admin_remove_rate_period(p_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row teacher_rate_periods%rowtype;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_remove_rate_period é restrita à admin (D10)';
  end if;
  select * into v_row from teacher_rate_periods where id = p_id;
  if not found then
    raise exception 'vigência % não existe', p_id;
  end if;
  -- só vigência ainda FUTURA pode sair (errou o valor antes de valer)
  if v_row.valid_from <= public.business_today() then
    raise exception 'vigência já em vigor não sai — crie uma nova daqui para a frente';
  end if;
  delete from teacher_rate_periods where id = p_id;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'remove_rate_period',
    'teacher_rate_periods', p_id::text,
    jsonb_build_object('teacher_id', v_row.teacher_id, 'valid_from', v_row.valid_from,
                       'rate_cents', v_row.rate_cents));
end;
$$;
revoke execute on function public.admin_remove_rate_period(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_rate_period(uuid, uuid) to authenticated;

-- base POR AULA gravada no statement (pré-F9: NULL ⇒ horas × rate congelado)
alter table teacher_statements add column base_cents int;
comment on column teacher_statements.base_cents is
  'F9/M12-7: soma POR AULA (duração × vigência da data). NULL em statements '
  'pré-F9 — o netting usa horas × rate congelado para eles.';

-- ---------------------------------------------------------------------------
-- Gerador recriado (def viva + valoração por aula; nada mais mudou)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_teacher_statement(p_teacher uuid, p_period_start date, p_period_end date, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_rate int;
  v_hours numeric;
  v_base_cents int;
  v_last_end date;
  v_existing teacher_statements%rowtype;
  v_retro record;
  v_retro_cents int := 0;
  v_retro_notes jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'generate_teacher_statement é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if p_period_end < p_period_start then
    raise exception 'período invertido (% > %)', p_period_start, p_period_end;
  end if;

  -- F9/M12-7: rate_cents vira INFORMATIVO (vigente no início do período);
  -- o valor pago é POR AULA, pela vigência da data de cada uma.
  if not exists (select 1 from teachers t where t.id = p_teacher) then
    raise exception 'professora % não existe', p_teacher;
  end if;
  v_rate := public._teacher_rate_on(p_teacher, p_period_start);

  -- Mesmo período: draft recalcula in place; closed é intocável.
  select * into v_existing
  from teacher_statements
  where teacher_id = p_teacher
    and period_start = p_period_start and period_end = p_period_end;
  if found and v_existing.status = 'closed' then
    raise exception 'período %–% já está FECHADO — correção retroativa entra no próximo draft (F3-D3)',
      p_period_start, p_period_end;
  end if;

  -- Contiguidade sem lacuna (caso 29): todo dia com aula pertence a exatamente
  -- um statement. Primeiro período do teacher: início livre.
  if not found then
    select max(period_end) into v_last_end
    from teacher_statements where teacher_id = p_teacher;
    if v_last_end is not null and p_period_start <> v_last_end + 1 then
      raise exception 'lacuna/sobreposição: o período deve começar em % (último fechado terminou em %)',
        v_last_end + 1, v_last_end;
    end if;
  end if;

  v_hours := public._teacher_payable_hours(p_teacher, p_period_start, p_period_end);
  -- soma POR AULA: duração real × valor vigente na DATA CIVIL (Cuiabá — P12)
  v_base_cents := public._teacher_payable_cents(p_teacher, p_period_start, p_period_end);

  -- A LINHA do draft nasce/é localizada ANTES do loop retroativo: o id ancora as
  -- linhas de netting. No recálculo in-place, as linhas do PRÓPRIO draft são
  -- descartadas e reinseridas (substituídas, nunca acumuladas); as de statements
  -- CLOSED jamais são tocadas.
  if v_existing.id is not null then
    v_id := v_existing.id;
    delete from statement_retro_adjustments where applied_in_statement_id = v_id;
  else
    insert into teacher_statements
      (teacher_id, period_start, period_end, audited_hours, rate_cents,
       base_cents, adjustments_cents, total_cents, status)
    values
      (p_teacher, p_period_start, p_period_end, v_hours, v_rate,
       v_base_cents, 0, v_base_cents, 'draft')
    returning id into v_id;
  end if;

  -- Correção retroativa: recalcula períodos FECHADOS e propõe o diff no rate
  -- congelado de cada um, LÍQUIDO do que statements CLOSED já compensaram
  -- (soma só sobre applied_in fechado: draft abandonado não conta como pago).
  for v_retro in
    select s.id, s.period_start, s.period_end, s.audited_hours, s.rate_cents,
           s.base_cents
    from teacher_statements s
    where s.teacher_id = p_teacher and s.status = 'closed'
  loop
    declare
      v_now_hours numeric;
      v_compensated_cents int;
      v_delta_cents int;
    begin
      v_now_hours := public._teacher_payable_hours(p_teacher, v_retro.period_start, v_retro.period_end);
      select coalesce(sum(sra.delta_cents), 0) into v_compensated_cents
      from statement_retro_adjustments sra
      join teacher_statements ap on ap.id = sra.applied_in_statement_id
      where sra.divergent_statement_id = v_retro.id
        and ap.status = 'closed';
      -- F9: a verdade recomputada usa a VIGÊNCIA da data de cada aula (as
      -- vigências são só-futuro ⇒ o passado é estável por construção); a base
      -- PAGA de statements pré-F9 é horas × rate congelado.
      v_delta_cents :=
        public._teacher_payable_cents(p_teacher, v_retro.period_start, v_retro.period_end)
        - coalesce(v_retro.base_cents, round(v_retro.audited_hours * v_retro.rate_cents)::int)
        - v_compensated_cents;
      if v_delta_cents <> 0 then
        insert into statement_retro_adjustments
          (divergent_statement_id, applied_in_statement_id, delta_cents)
        values (v_retro.id, v_id, v_delta_cents);
        v_retro_cents := v_retro_cents + v_delta_cents;
        v_retro_notes := v_retro_notes || jsonb_build_object(
          'statement_id', v_retro.id,
          'periodo', v_retro.period_start || '..' || v_retro.period_end,
          'horas_antes', v_retro.audited_hours,
          'horas_agora', v_now_hours,
          'rate_congelado_cents', v_retro.rate_cents,
          'delta_cents', v_delta_cents,
          -- Lei 8 (painel final): o quanto JÁ estava compensado em statements
          -- fechados entra no motivo — o total pago acumulado fica auditável.
          'ja_compensado_cents', v_compensated_cents,
          'instancias_nao_pagaveis_no_periodo', (
            select coalesce(jsonb_agg(i.id), '[]'::jsonb)
            from class_instances i
            where i.teacher_id = p_teacher
              and i.state in ('cancelled', 'no_show_teacher', 'rescheduled')
              and (i.starts_at_utc at time zone public.business_tz())::date
                  between v_retro.period_start and v_retro.period_end
          )
        );
      end if;
    end;
  end loop;

  -- manual_adjustments_cents NÃO é recomputado: parcela manual auditada persiste.
  update teacher_statements
     set audited_hours = v_hours,
         rate_cents = v_rate,
         base_cents = v_base_cents,
         adjustments_cents = v_retro_cents,
         total_cents = v_base_cents + v_retro_cents + manual_adjustments_cents
   where id = v_id;

  perform public.log_audit(v_actor, 'generate_teacher_statement', 'teacher_statements',
    v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'period_start', p_period_start,
                       'period_end', p_period_end, 'audited_hours', v_hours,
                       'base_cents', v_base_cents,
                       'rate_cents', v_rate, 'ajustes_retroativos', v_retro_notes));
  return v_id;
end;
$function$;
