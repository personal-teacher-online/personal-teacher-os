-- Fase 3 / M4 ("Fase 3b") — Extrato da professora (F3-D3; Q2 respondida 12/07/2026).
-- Régua PROVISÓRIA até a auditoria real da Fase 4: PAGAM os estados
-- 'scheduled' (no passado), 'completed' e 'no_show_student' (aluno faltou, a
-- professora compareceu — decisão da Q2); NUNCA pagam 'no_show_teacher',
-- 'cancelled' e 'rescheduled'. Horas civis do fuso do negócio.

-- ---------------------------------------------------------------------------
-- 1) Períodos de um mesmo teacher nunca se sobrepõem (guarda estrutural; a
--    contiguidade sem lacuna é checada na RPC). btree_gist já é extensão ativa.
-- ---------------------------------------------------------------------------
alter table teacher_statements
  add constraint teacher_statements_no_overlap
  exclude using gist (
    teacher_id with =,
    daterange(period_start, period_end, '[]') with &&
  );

-- Painel final da Fase 3 (editado in-place — migrations 20260713* ainda não
-- aplicadas em ambiente compartilhado; Lei 7 preservada, ver goal §Adendos M0):
-- ajuste MANUAL (adjust_teacher_statement) vive em coluna PRÓPRIA. O recálculo
-- in-place do draft recomputa SÓ a parcela retroativa (adjustments_cents) e
-- NUNCA toca nesta — um desconto auditado (Lei 8) não pode sumir num regenerate.
alter table teacher_statements
  add column manual_adjustments_cents int not null default 0;
comment on column teacher_statements.manual_adjustments_cents is
  'Parcela de ajustes MANUAIS (adjust_teacher_statement, com motivo — Lei 8). '
  'Separada de adjustments_cents (parcela retroativa recomputada pelo generate) '
  'para o recálculo in-place do draft não apagar ajuste auditado. '
  'total_cents = round(hours*rate) + adjustments_cents + manual_adjustments_cents.';

-- ---------------------------------------------------------------------------
-- 1b) Netting da compensação retroativa (achado CRÍTICO do painel final):
--     o statement fechado é snapshot imutável, então a divergência retroativa é
--     detectada de novo a CADA generate. Sem registro persistido de quanto já
--     foi compensado, o mesmo delta seria proposto em TODO draft subsequente
--     (professora descontada/paga em dobro — erro de dinheiro). Cada linha aqui
--     diz: "o desvio do statement X foi compensado em N centavos no statement Y".
--     Só linhas cujo applied_in está CLOSED contam como compensação efetiva —
--     drafts abandonados/recalculados nunca "pagam" nada; as linhas do próprio
--     draft são substituídas (delete-e-reinsere) a cada recálculo e passam a
--     valer automaticamente quando o draft fecha (nenhum passo extra no close;
--     o trigger de imutabilidade é em teacher_statements e não bloqueia esta tabela).
-- ---------------------------------------------------------------------------
create table statement_retro_adjustments (
  id uuid primary key default gen_random_uuid(),
  -- o statement FECHADO cujo recálculo divergiu do snapshot
  divergent_statement_id uuid not null references teacher_statements (id),
  -- o statement (draft na criação) que carrega/carregou a compensação;
  -- cascade: apagar um draft (permitido) leva junto as propostas dele
  applied_in_statement_id uuid not null references teacher_statements (id) on delete cascade,
  delta_cents int not null check (delta_cents <> 0),
  created_at timestamptz not null default now(),
  unique (divergent_statement_id, applied_in_statement_id)
);
comment on table statement_retro_adjustments is
  'Netting da correção retroativa (painel final F3): quanto de cada divergência de '
  'statement FECHADO já foi compensado e em qual statement. generate_teacher_statement '
  'soma SÓ sobre applied_in com status closed e propõe apenas o delta restante. '
  'Escrita EXCLUSIVA da RPC (SECURITY DEFINER) — nenhum DML de cliente.';

alter table statement_retro_adjustments enable row level security;

-- Leitura: admin (monitoramento) + professora (itemização do PRÓPRIO extrato,
-- via posse do statement em que a compensação foi aplicada).
create policy statement_retro_adjustments_admin_read on statement_retro_adjustments
  for select to authenticated
  using ((select public.app_role()) = 'admin');
create policy statement_retro_adjustments_teacher_read on statement_retro_adjustments
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and applied_in_statement_id in (
      select s.id from teacher_statements s
      where s.teacher_id = (select public.my_teacher_id())
    )
  );

-- Padrão da casa (ADR-010 §4 / pino do caso 12-F1): SELECT concedido, RLS decide
-- as linhas. Nenhum grant de escrita: INSERT/DELETE só pela RPC (owner).
grant select on statement_retro_adjustments to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Imutabilidade do statement FECHADO — regra NOVA desta fase (nenhuma Lei a
--    cobre; o ATO de fechar audita pela Lei 8). Trigger próprio, NÃO o
--    forbid_mutation (que bloquearia draft→closed): rejeita UPDATE/DELETE quando
--    OLD.status = 'closed'. É a única camada que barra também admin (policy
--    admin_all é FOR ALL) e service_role.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_closed_statement_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    raise exception 'teacher_statement % está FECHADO — snapshot imutável (F3-D3)', old.id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger teacher_statements_closed_guard
  before update or delete on teacher_statements
  for each row execute function public.forbid_closed_statement_mutation();

-- ---------------------------------------------------------------------------
-- 3) Horas pagáveis de um período (helper interno — régua da Q2 num lugar SÓ).
--    Data civil do FUSO DO NEGÓCIO decide a qual período a aula pertence.
--    Painel final F3: 'scheduled' no passado NUNCA paga quando a data civil cai
--    dentro de uma janela de pausa do contrato (contract_pauses) — durante a
--    pausa nenhuma aula acontece; sem este filtro a professora seria paga por
--    aula fantasma (o resume as cancela, mas statements gerados DURANTE a pausa
--    e períodos CLOSED corrigem-se por AQUI, via recálculo retroativo).
--    'completed'/'no_show_student' seguem pagando mesmo em janela de pausa:
--    são afirmação EXPLÍCITA de que a aula/o comparecimento aconteceu.
-- ---------------------------------------------------------------------------
create or replace function public._teacher_payable_hours(
  p_teacher uuid,
  p_start date,
  p_end date
) returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    sum(extract(epoch from (i.ends_at_utc - i.starts_at_utc)) / 3600.0),
    0
  )::numeric(8, 2)
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
-- 4) generate_teacher_statement — DRAFT recalculável (admin-only, D10/F2).
--    Guardas: contiguidade sem lacuna (period_start = último period_end + 1;
--    primeiro período livre); mesmo período com DRAFT existente → recalcula
--    IN PLACE; com CLOSED → exceção (correção retroativa entra no PRÓXIMO).
--    Correção retroativa (ADR-013 §3 prevalece — a verdade da aula vem primeiro):
--    ao gerar, recalcula os períodos CLOSED do teacher; qualquer divergência vira
--    lançamento PROPOSTO em adjustments_cents deste draft, valorado ao rate
--    CONGELADO do statement divergente, com auditoria referenciando o statement e
--    as instâncias hoje não-pagáveis do período (candidatas à divergência).
--    Netting (painel final F3): o delta proposto DESCONTA o que já foi compensado
--    em statements CLOSED (statement_retro_adjustments) — nunca compensação em
--    dobro; as linhas do PRÓPRIO draft são substituídas a cada recálculo.
--    manual_adjustments_cents é PRESERVADO no recálculo (ajuste auditado nunca some).
-- ---------------------------------------------------------------------------
create or replace function public.generate_teacher_statement(
  p_teacher uuid,
  p_period_start date,
  p_period_end date,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_rate int;
  v_hours numeric;
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

  select hourly_rate_cents into v_rate from teachers where id = p_teacher;
  if not found then
    raise exception 'professora % não existe', p_teacher;
  end if;

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
       adjustments_cents, total_cents, status)
    values
      (p_teacher, p_period_start, p_period_end, v_hours, v_rate,
       0, round(v_hours * v_rate), 'draft')
    returning id into v_id;
  end if;

  -- Correção retroativa: recalcula períodos FECHADOS e propõe o diff no rate
  -- congelado de cada um, LÍQUIDO do que statements CLOSED já compensaram
  -- (soma só sobre applied_in fechado: draft abandonado não conta como pago).
  for v_retro in
    select s.id, s.period_start, s.period_end, s.audited_hours, s.rate_cents
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
      v_delta_cents :=
        round((v_now_hours - v_retro.audited_hours) * v_retro.rate_cents)
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
         adjustments_cents = v_retro_cents,
         total_cents = round(v_hours * v_rate) + v_retro_cents + manual_adjustments_cents
   where id = v_id;

  perform public.log_audit(v_actor, 'generate_teacher_statement', 'teacher_statements',
    v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'period_start', p_period_start,
                       'period_end', p_period_end, 'audited_hours', v_hours,
                       'rate_cents', v_rate, 'ajustes_retroativos', v_retro_notes));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) adjust_teacher_statement — ajuste manual com MOTIVO obrigatório (draft only).
-- ---------------------------------------------------------------------------
create or replace function public.adjust_teacher_statement(
  p_statement uuid,
  p_delta_cents int,
  p_reason text,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_st teacher_statements%rowtype;
begin
  if public.app_role() <> 'admin' then
    raise exception 'adjust_teacher_statement é restrita à admin (D10)';
  end if;
  if p_delta_cents = 0 or p_reason is null or btrim(p_reason) = '' then
    raise exception 'ajuste exige delta ≠ 0 e MOTIVO (Lei 8)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_st from teacher_statements where id = p_statement for update;
  if not found then
    raise exception 'statement % não existe', p_statement;
  end if;
  if v_st.status <> 'draft' then
    raise exception 'statement % não é draft (estado: %)', p_statement, v_st.status;
  end if;

  -- Parcela MANUAL própria (painel final F3): o recálculo in-place do generate
  -- recomputa só adjustments_cents (retro) e preserva esta — o desconto auditado
  -- sobrevive a um regenerate do mesmo período.
  update teacher_statements
     set manual_adjustments_cents = manual_adjustments_cents + p_delta_cents,
         total_cents = total_cents + p_delta_cents
   where id = p_statement;

  perform public.log_audit(v_actor, 'adjust_teacher_statement', 'teacher_statements',
    p_statement::text, jsonb_build_object('delta_cents', p_delta_cents, 'motivo', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) close_teacher_statement — snapshot. Guarda: só período civilmente ENCERRADO
--    (period_end < business_today) — sem isso, aulas do fim do período nunca
--    seriam pagas (caso 29). O rate é re-congelado no fechamento (F3-D3).
-- ---------------------------------------------------------------------------
create or replace function public.close_teacher_statement(
  p_statement uuid,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_st teacher_statements%rowtype;
  v_rate int;
  v_hours numeric;
begin
  if public.app_role() <> 'admin' then
    raise exception 'close_teacher_statement é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_st from teacher_statements where id = p_statement for update;
  if not found then
    raise exception 'statement % não existe', p_statement;
  end if;
  if v_st.status <> 'draft' then
    raise exception 'statement % não é draft (estado: %)', p_statement, v_st.status;
  end if;
  if v_st.period_end >= public.business_today() then
    raise exception 'período só fecha depois de ENCERRADO no fuso do negócio (termina %, hoje é %)',
      v_st.period_end, public.business_today();
  end if;

  -- Recongela horas e rate NO FECHAMENTO (o draft pode estar velho). As duas
  -- parcelas de ajuste (retro + manual) entram no total como estão no draft;
  -- as linhas de netting deste draft passam a valer (status closed) sem passo extra.
  select hourly_rate_cents into v_rate from teachers where id = v_st.teacher_id;
  v_hours := public._teacher_payable_hours(v_st.teacher_id, v_st.period_start, v_st.period_end);

  update teacher_statements
     set audited_hours = v_hours,
         rate_cents = v_rate,
         total_cents = round(v_hours * v_rate) + adjustments_cents + manual_adjustments_cents,
         status = 'closed'
   where id = p_statement;

  perform public.log_audit(v_actor, 'close_teacher_statement', 'teacher_statements',
    p_statement::text,
    jsonb_build_object('audited_hours', v_hours, 'rate_cents', v_rate,
                       'total_cents', round(v_hours * v_rate) + v_st.adjustments_cents
                                      + v_st.manual_adjustments_cents));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Privilégio de DML (painel final F3): teacher_statements só muda pelas RPCs.
--    O grant amplo da Fase 1 (20260711000700: insert/update/delete a authenticated)
--    deixava um JWT admin via PostgREST fechar/alterar/inserir statement direto,
--    driblando as guardas (period_end < business_today, re-congelamento) e o
--    audit_log (Lei 3/Lei 8) — o trigger de imutabilidade só protege linhas JÁ
--    fechadas. Revoga também de service_role (paridade com makeup_ledger/audit_log;
--    nada no servidor escreve nesta tabela fora das RPCs SECURITY DEFINER).
--    SELECT permanece (policies decidem as linhas).
-- ---------------------------------------------------------------------------
revoke insert, update, delete on teacher_statements from anon, authenticated, service_role;

-- F3-D9/ADR-010 §2: EXECUTE mínimo — validação interna decide (D10).
revoke execute on function
  public._teacher_payable_hours(uuid, date, date),
  public.generate_teacher_statement(uuid, date, date, uuid),
  public.adjust_teacher_statement(uuid, int, text, uuid),
  public.close_teacher_statement(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.generate_teacher_statement(uuid, date, date, uuid),
  public.adjust_teacher_statement(uuid, int, text, uuid),
  public.close_teacher_statement(uuid, uuid)
to authenticated, service_role;
