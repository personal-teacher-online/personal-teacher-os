-- F1 — Ledger com memória (plano integrado v2, 18/07/2026; decisões M1-5, M3-1,
-- M3-3, M3-5 + nota técnica M3-7 + P6/P10/P11/P14 do passe adversarial).
-- O crédito de reposição passa a saber:
--   • sua DURAÇÃO (duration_min — o resgate cria a aula com a duração do crédito);
--   • sua ORIGEM (validade 90/180 conforme a culpa: aluno avisou × escola falhou);
--   • sua IDENTIDADE (o gasto grava QUAL crédito consumiu — consumes_ledger_id —
--     escolhido pelo MESMO replay FIFO do saldo, agora fonte única);
--   • seu ESTORNO formal (reason 'refund' + refund_of, com regras i/ii/iii).
-- Tudo aditivo: nenhuma linha antiga é tocada; linhas antigas sem duração valem
-- o padrão do contrato; gasto antigo sem identidade NÃO recebe estorno automático
-- (P10 — crédito só via ajuste manual, nunca validade/duração inventadas).

-- ---------------------------------------------------------------------------
-- 1. Colunas novas + CHECK recriado (ressalva M3-(b): recriação é permitida em
--    migration nova) + trilhos de idempotência.
-- ---------------------------------------------------------------------------
alter table makeup_ledger add column duration_min int
  check (duration_min is null or duration_min > 0);
comment on column makeup_ledger.duration_min is
  'Duração (min) da aula que originou o crédito (M1-5). NULL em linhas anteriores '
  'à F1 = vale o padrão do contrato (slot ativo) na hora do resgate.';

alter table makeup_ledger add column consumes_ledger_id bigint references makeup_ledger (id);
comment on column makeup_ledger.consumes_ledger_id is
  'Identidade do crédito (+1) que este débito consumiu (M3-3 caminho i), escolhido '
  'pelo MESMO FIFO do saldo. O replay honra esta coluna quando presente; NULL '
  '(linhas pré-F1) cai no comportamento antigo (menor validade ainda válida).';

alter table makeup_ledger add column refund_of bigint references makeup_ledger (id);
comment on column makeup_ledger.refund_of is
  'Estorno (reason refund): aponta o GASTO (-1) estornado. Único por gasto (P11).';

alter table makeup_ledger add column note text;
comment on column makeup_ledger.note is
  'Motivo humano do lançamento (obrigatório no ajuste manual — M3-5). Aparece no '
  'extrato de créditos do aluno (F3/M3-6).';

create unique index makeup_ledger_refund_of_uniq
  on makeup_ledger (refund_of) where refund_of is not null;
create index makeup_ledger_class_instance_idx on makeup_ledger (class_instance_id);

alter table makeup_ledger drop constraint makeup_ledger_shape;
alter table makeup_ledger add constraint makeup_ledger_shape check (
  (reason in ('earn_cancellation', 'initial_backlog') and delta > 0 and expires_on is not null)
  or (reason in ('spend_reschedule', 'expire') and delta < 0)
  or (reason = 'refund' and delta > 0 and expires_on is not null and refund_of is not null)
  or (reason = 'manual_adjust')
);

-- M3-1: validade quando a perda é culpa da ESCOLA (professora cancelou/faltou;
-- tratamento de período da F5 herda automaticamente).
alter table contracts add column school_fault_credit_expiry_days int not null default 180
  check (school_fault_credit_expiry_days > 0);
comment on column contracts.school_fault_credit_expiry_days is
  'Validade (dias, da data LOCAL da aula perdida) do crédito quando a escola causou '
  'a perda (M3-1). makeup_credit_expiry_days continua valendo para aluno-com-aviso.';

-- ---------------------------------------------------------------------------
-- 2. FIFO com identidade — a NOVA fonte única do replay.
--    Mesmo algoritmo de makeup_remaining_expiries (20260713000200), com dois
--    acréscimos: cada entrada carrega (ledger_id, duration_min), e um débito com
--    consumes_ledger_id preenchido remove EXATAMENTE aquela entrada (se ainda
--    presente) em vez do pick por menor validade. Para linhas orgânicas isso é
--    idêntico ao antigo (o gravador escolheu pelo mesmo critério no mesmo
--    estado); para pares -1/+1 dirigidos (pausa/extensão/transferência) torna o
--    alvo exato — era a armadilha da ordem que o comentário da pausa descrevia.
-- ---------------------------------------------------------------------------
create or replace function public._makeup_remaining_credits(p_contract uuid)
returns table (ord int, ledger_id bigint, expires_on date, duration_min int)
language plpgsql
stable
as $$
declare
  r record;
  v_ids bigint[] := array[]::bigint[];
  v_exps date[] := array[]::date[];
  v_durs int[] := array[]::int[];
  v_spend_date date;
  v_pick int;
  i int;
begin
  for r in
    -- colunas QUALIFICADAS: expires_on/duration_min/ledger_id também são
    -- variáveis de saída da função (plpgsql acusaria ambiguidade)
    select ml.id, ml.delta, ml.expires_on, ml.duration_min, ml.consumes_ledger_id, ml.created_at
    from makeup_ledger ml
    where ml.contract_id = p_contract
    order by ml.created_at, ml.id
  loop
    if r.delta > 0 then
      for i in 1 .. r.delta loop
        v_ids := v_ids || r.id;
        v_exps := v_exps || coalesce(r.expires_on, 'infinity'::date);
        v_durs := v_durs || r.duration_min;
      end loop;
    else
      v_spend_date := (r.created_at at time zone public.business_tz())::date;
      for i in 1 .. -r.delta loop
        v_pick := null;
        if r.consumes_ledger_id is not null then
          select idx into v_pick
          from unnest(v_ids) with ordinality as t (lid, idx)
          where t.lid = r.consumes_ledger_id
          order by t.idx
          limit 1;
        end if;
        if v_pick is null then
          -- comportamento pré-F1: menor validade ainda válida na data do gasto
          select idx into v_pick
          from unnest(v_exps) with ordinality as t (exp, idx)
          where t.exp >= v_spend_date
          order by t.exp, t.idx
          limit 1;
        end if;
        if v_pick is not null then
          v_ids := v_ids[1:v_pick - 1] || v_ids[v_pick + 1:];
          v_exps := v_exps[1:v_pick - 1] || v_exps[v_pick + 1:];
          v_durs := v_durs[1:v_pick - 1] || v_durs[v_pick + 1:];
        end if;
        -- Sem crédito válido na época (anomalia via manual_adjust): o gasto
        -- excedente cai no vazio — mesma regra de sempre.
      end loop;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    ord := i; ledger_id := v_ids[i]; expires_on := v_exps[i]; duration_min := v_durs[i];
    return next;
  end loop;
end;
$$;
grant execute on function public._makeup_remaining_credits(uuid) to authenticated;

-- makeup_remaining_expiries delega — UMA fonte de FIFO (makeup_balance já
-- delegava a ela; a cadeia inteira converge no replay com identidade).
create or replace function public.makeup_remaining_expiries(p_contract uuid)
returns setof date
language sql
stable
as $$
  select expires_on from public._makeup_remaining_credits(p_contract) order by ord
$$;

-- ---------------------------------------------------------------------------
-- 3. Primitivas com memória: earn ganha duração+nota; spend grava a identidade
--    do crédito consumido (assinaturas estendidas ⇒ DROP + CREATE; corpos
--    plpgsql resolvem chamadas em runtime, então call sites antigos seguem
--    válidos pelos defaults).
-- ---------------------------------------------------------------------------
drop function public.earn_makeup(uuid, ledger_reason, date, uuid, uuid, uuid);
create function public.earn_makeup(
  p_contract uuid,
  p_reason ledger_reason,
  p_expires_on date,
  p_student uuid default null,
  p_class_instance uuid default null,
  p_actor uuid default null,
  p_duration_min int default null,
  p_note text default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id bigint;
begin
  if p_reason not in ('earn_cancellation', 'initial_backlog', 'manual_adjust') then
    raise exception 'earn_makeup não aceita reason %', p_reason;
  end if;
  insert into makeup_ledger
    (contract_id, student_id, delta, reason, class_instance_id, expires_on,
     duration_min, note, created_by)
  values
    (p_contract, p_student, 1, p_reason, p_class_instance, p_expires_on,
     p_duration_min, p_note, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

drop function public.spend_makeup(uuid, ledger_reason, uuid, uuid, uuid);
create function public.spend_makeup(
  p_contract uuid,
  p_reason ledger_reason default 'spend_reschedule',
  p_student uuid default null,
  p_class_instance uuid default null,
  p_actor uuid default null,
  p_note text default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_consumes bigint;
begin
  if p_reason not in ('spend_reschedule', 'manual_adjust') then
    raise exception 'spend_makeup não aceita reason %', p_reason;
  end if;
  if not exists (select 1 from contracts c where c.id = p_contract and c.status = 'active') then
    raise exception 'contrato % não está ativo — gasto de crédito bloqueado', p_contract;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if public.makeup_balance(p_contract) < 1 then
    raise exception 'saldo de créditos de reposição insuficiente no contrato %', p_contract;
  end if;
  -- M3-3 (i): a identidade do crédito consumido — o MESMO pick do replay
  -- (menor validade ainda válida hoje; empate = ordem de entrada), sob o lock.
  select rc.ledger_id into v_consumes
  from public._makeup_remaining_credits(p_contract) rc
  where rc.expires_on >= public.business_today()
  order by rc.expires_on, rc.ord
  limit 1;

  insert into makeup_ledger
    (contract_id, student_id, delta, reason, class_instance_id, consumes_ledger_id,
     note, created_by)
  values
    (p_contract, p_student, -1, p_reason, p_class_instance, v_consumes,
     p_note, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function
  public.earn_makeup(uuid, ledger_reason, date, uuid, uuid, uuid, int, text),
  public.spend_makeup(uuid, ledger_reason, uuid, uuid, uuid, text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. _reissue_credit — o helper ÚNICO de relançamento −1/+1 (P6): pausa (aqui),
--    extensão de validade (F3) e transferência entre contratos (F4) copiam
--    duração + origem + nota da linha viva. Interno (revogado de clientes);
--    NÃO checa status do contrato (a retomada de pausa roda antes do flip).
-- ---------------------------------------------------------------------------
create or replace function public._reissue_credit(
  p_ledger_id bigint,
  p_new_expires_on date,
  p_actor uuid,
  p_note text default null,
  p_new_contract uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orig makeup_ledger%rowtype;
  v_target uuid;
  v_new_id bigint;
begin
  select * into v_orig from makeup_ledger where id = p_ledger_id;
  if not found or v_orig.delta <= 0 then
    raise exception 'relançamento exige um crédito (+1) existente — ledger % inválido', p_ledger_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_orig.contract_id::text, 0));
  -- só crédito AINDA VIVO no replay (não gasto, não vencido)
  if not exists (
    select 1 from public._makeup_remaining_credits(v_orig.contract_id) rc
    where rc.ledger_id = p_ledger_id and rc.expires_on >= public.business_today()
  ) then
    raise exception 'crédito % não está vivo (gasto ou vencido) — nada a relançar', p_ledger_id;
  end if;
  if p_new_expires_on < public.business_today() then
    raise exception 'nova validade (%) no passado', p_new_expires_on;
  end if;

  v_target := coalesce(p_new_contract, v_orig.contract_id);
  if v_target <> v_orig.contract_id and not exists (
    select 1 from contracts c where c.id = v_target and c.contract_type = 'private_1on1'
  ) then
    raise exception 'contrato destino % inválido para transferência de crédito', v_target;
  end if;

  -- débito DIRIGIDO: o replay honra consumes_ledger_id e apaga exatamente este
  insert into makeup_ledger
    (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
  values
    (v_orig.contract_id, v_orig.student_id, -1, 'manual_adjust', p_ledger_id, p_note, p_actor);

  -- reemissão preservando duração + origem (aula geradora) + validade nova
  insert into makeup_ledger
    (contract_id, student_id, delta, reason, class_instance_id, expires_on,
     duration_min, note, created_by)
  values
    (v_target, v_orig.student_id, 1, 'manual_adjust', v_orig.class_instance_id,
     p_new_expires_on, v_orig.duration_min, p_note, p_actor)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reissue_credit', 'makeup_ledger', v_new_id::text,
    jsonb_build_object(
      'from_ledger', p_ledger_id, 'from_contract', v_orig.contract_id,
      'to_contract', v_target, 'old_expires_on', v_orig.expires_on,
      'new_expires_on', p_new_expires_on, 'duration_min', v_orig.duration_min,
      'note', p_note));
  return v_new_id;
end;
$$;
revoke execute on function public._reissue_credit(bigint, date, uuid, text, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Causa no ganho (M3-1): aluno-com-aviso → makeup_credit_expiry_days (90);
--    escola falhou → school_fault_credit_expiry_days (180). Sempre da data
--    LOCAL da aula perdida. A duração da aula perdida vira a do crédito (M1-5).
-- ---------------------------------------------------------------------------
drop function public._earn_for_lost_class(uuid, uuid);
create function public._earn_for_lost_class(
  p_instance uuid,
  p_actor uuid,
  p_fault text default 'student'  -- 'student' | 'school'
) returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_tz text;
  v_local_date date;
  v_expires date;
  v_dur int;
begin
  if p_fault not in ('student', 'school') then
    raise exception '_earn_for_lost_class: fault deve ser student ou school (recebido %)', p_fault;
  end if;
  select * into v_inst from class_instances where id = p_instance;
  select * into v_contract from contracts where id = v_inst.contract_id;

  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da instância %', p_instance;
  end if;
  v_local_date := coalesce(v_inst.occurrence_date, (v_inst.starts_at_utc at time zone v_tz)::date);
  v_expires := v_local_date + case when p_fault = 'school'
                                   then v_contract.school_fault_credit_expiry_days
                                   else v_contract.makeup_credit_expiry_days end;
  v_dur := greatest(1, round(extract(epoch from (v_inst.ends_at_utc - v_inst.starts_at_utc)) / 60)::int);

  perform public.earn_makeup(
    v_contract.id, 'earn_cancellation', v_expires, v_contract.student_id, p_instance,
    p_actor, v_dur, null);
  return v_expires;
end;
$$;
revoke execute on function public._earn_for_lost_class(uuid, uuid, text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Estorno formal (M3-3): quando a aula cancelada NASCEU de crédito (resgate:
--    gasto aponta a aula criada; remarcação a crédito: gasto aponta a aula
--    movida), o crédito volta como 'refund' — nunca como crédito genérico novo.
--    (i)  aluno com aviso → validade ORIGINAL do crédito consumido, piso hoje+7;
--    (ii) escola falhou   → data LOCAL da reposição cancelada + prazo-escola
--         (P14: a âncora é a reposição cancelada — "a aula que o originou", M3-1);
--    (iii) sem aviso      → perdido (nenhum lançamento).
--    Gasto sem identidade (pré-F1): estorno automático RECUSADO (P10) — o
--    cancelamento acontece, nada é creditado, e o audit marca o motivo; crédito
--    só via ajuste manual. Duplo estorno: refund_of é ÚNICO (P11).
--    Retorna o expires_on do estorno, ou NULL se nada foi creditado.
-- ---------------------------------------------------------------------------
create or replace function public._refund_for_credit_born_class(
  p_instance uuid,
  p_fault text,        -- 'student' (regra i) | 'school' (regra ii)
  p_actor uuid,
  out o_expires date,
  out o_blocked text
) returns record
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_spend makeup_ledger%rowtype;
  v_orig makeup_ledger%rowtype;
  v_tz text;
  v_local_date date;
begin
  o_expires := null;
  o_blocked := null;
  select * into v_inst from class_instances where id = p_instance;
  select * into v_contract from contracts where id = v_inst.contract_id;

  -- o gasto que PAGOU esta aula (resgate → aponta a criada; remarcação → a movida)
  select * into v_spend from makeup_ledger l
  where l.delta < 0 and l.reason = 'spend_reschedule'
    and (l.class_instance_id = p_instance
         or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of))
  order by l.id desc
  limit 1;
  if not found then
    raise exception 'aula % não nasceu de crédito — estorno não se aplica', p_instance;
  end if;

  if v_spend.consumes_ledger_id is null then
    -- P10: nunca inventar validade/duração em caminho de dinheiro.
    o_blocked := 'gasto sem identidade (anterior à F1) — crédito só via ajuste manual';
    return;
  end if;
  select * into v_orig from makeup_ledger where id = v_spend.consumes_ledger_id;

  if p_fault = 'school' then
    v_tz := public.class_instance_tz(p_instance);
    v_local_date := coalesce(v_inst.occurrence_date, (v_inst.starts_at_utc at time zone v_tz)::date);
    o_expires := v_local_date + v_contract.school_fault_credit_expiry_days;
  else
    o_expires := greatest(v_orig.expires_on, public.business_today() + 7);
  end if;

  insert into makeup_ledger
    (contract_id, student_id, delta, reason, class_instance_id, expires_on,
     duration_min, refund_of, created_by)
  values
    (v_contract.id, v_contract.student_id, 1, 'refund', p_instance, o_expires,
     v_orig.duration_min, v_spend.id, p_actor);
end;
$$;
revoke execute on function public._refund_for_credit_born_class(uuid, text, uuid)
from public, anon, authenticated;

-- cancel_class integra o estorno: aula nascida de crédito estorna (i/ii/iii);
-- aula comum segue a matriz D2 com a causa nova (professora → prazo-escola).
create or replace function public.cancel_class(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz default now(),
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_actor uuid;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if p_cancelled_by not in ('student', 'teacher') then
    raise exception 'p_cancelled_by deve ser student ou teacher (recebido: %)', p_cancelled_by;
  end if;
  if p_notified_at > now() then
    raise exception 'notified_at no futuro (%) — o aviso já deve ter acontecido', p_notified_at;
  end if;

  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then
    raise exception 'aula % já começou e o aviso não a precedeu — use no_show_student/no_show_teacher', p_instance;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'cancel_class só se aplica a contratos private_1on1';
  end if;

  update class_instances set state = 'cancelled' where id = p_instance;

  v_credit_born := exists (
    select 1 from makeup_ledger l
    where l.delta < 0 and l.reason = 'spend_reschedule'
      and (l.class_instance_id = p_instance
           or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));

  if p_cancelled_by = 'teacher'
     or p_notified_at <= v_inst.starts_at_utc - make_interval(hours => v_contract.min_notice_hours)
  then
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(
        p_instance, case when p_cancelled_by = 'teacher' then 'school' else 'student' end, v_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(
        p_instance, v_actor, case when p_cancelled_by = 'teacher' then 'school' else 'student' end);
      v_credited := true;
    end if;
  end if;

  perform public.log_audit(v_actor, 'cancel_class', 'class_instances', p_instance::text,
    jsonb_build_object(
      'cancelled_by', p_cancelled_by,
      'notified_at', p_notified_at,
      'starts_at_utc', v_inst.starts_at_utc,
      'min_notice_hours', v_contract.min_notice_hours,
      'credited', v_credited,
      'credit_born', v_credit_born,
      'refund_blocked', v_blocked,
      'expires_on', v_expires));
end;
$$;

-- No-show com causa: professora faltou → prazo-escola; sobre reposição → estorno (ii).
create or replace function public._mark_no_show(
  p_instance uuid,
  p_who text,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() <= v_inst.starts_at_utc then
    raise exception 'aula % ainda não começou (%) — no-show é retrospectivo', p_instance, v_inst.starts_at_utc;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'no-show só se aplica a contratos private_1on1';
  end if;

  if p_who = 'student' then
    update class_instances set state = 'no_show_student' where id = p_instance;
  else
    update class_instances set state = 'no_show_teacher' where id = p_instance;
    v_credit_born := exists (
      select 1 from makeup_ledger l
      where l.delta < 0 and l.reason = 'spend_reschedule'
        and (l.class_instance_id = p_instance
             or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(p_instance, 'school', p_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(p_instance, p_actor, 'school');
      v_credited := true;
    end if;
  end if;

  perform public.log_audit(p_actor, 'no_show_' || p_who, 'class_instances', p_instance::text,
    jsonb_build_object('credited', v_credited, 'expires_on', v_expires,
                       'refund_blocked', v_blocked,
                       'starts_at_utc', v_inst.starts_at_utc));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Ajuste manual: motivo OBRIGATÓRIO + duração opcional (M3-5). Assinatura
--    estendida ⇒ DROP + CREATE (posicionais antigos seguem válidos).
-- ---------------------------------------------------------------------------
drop function public.admin_makeup_adjust(uuid, int, date, text, uuid);
create function public.admin_makeup_adjust(
  p_contract uuid,
  p_delta int,
  p_expires_on date default null,
  p_note text default null,
  p_actor uuid default null,
  p_duration_min int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_actor uuid;
  i int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_makeup_adjust é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if p_delta = 0 or p_delta is null then
    raise exception 'p_delta deve ser ±N (recebido: %)', p_delta;
  end if;
  if abs(p_delta) > 30 then
    raise exception 'ajuste de % créditos de uma vez? Limite de sanidade: 30', p_delta;
  end if;
  -- M3-5: todo ajuste manual carrega o PORQUÊ.
  if p_note is null or btrim(p_note) = '' then
    raise exception 'ajuste manual exige motivo (p_note) — M3-5';
  end if;

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'crédito de reposição é de contratos private_1on1';
  end if;

  if p_delta > 0 then
    if p_expires_on is null then
      raise exception 'crédito manual exige expires_on (validade do crédito)';
    end if;
    if p_expires_on < current_date then
      raise exception 'expires_on (%) no passado', p_expires_on;
    end if;
    for i in 1 .. p_delta loop
      perform public.earn_makeup(p_contract, 'manual_adjust', p_expires_on,
                                 v_contract.student_id, null, v_actor,
                                 p_duration_min, p_note);
    end loop;
  else
    for i in 1 .. -p_delta loop
      perform public.spend_makeup(p_contract, 'manual_adjust',
                                  v_contract.student_id, null, v_actor, p_note);
    end loop;
  end if;

  perform public.log_audit(v_actor, 'admin_makeup_adjust', 'makeup_ledger', p_contract::text,
    jsonb_build_object('delta', p_delta, 'expires_on', p_expires_on,
                       'duration_min', p_duration_min, 'note', p_note));

  return public.makeup_balance(p_contract);
end;
$$;
revoke execute on function public.admin_makeup_adjust(uuid, int, date, text, uuid, int)
from public, anon, authenticated;
grant execute on function public.admin_makeup_adjust(uuid, int, date, text, uuid, int)
to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Resgate usa a duração DO CRÉDITO (M1-5). Recreate integral do
--    book_reschedule_window (20260715001000); as ÚNICAS mudanças estão no modo
--    resgate: lock antes de espiar o crédito da vez, duração = crédito →
--    fallback slot ativo (linhas antigas) → exceção.
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
  v_inst_starts timestamptz;
  v_actor uuid;
  v_credit_dur int;
  v_slot_dur int;
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

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
  if v_win.starts_at_utc > now() + interval '14 days' then
    raise exception 'janela % está a mais de 2 semanas (%)', p_window, v_win.starts_at_utc;
  end if;

  if p_instance is not null then
    select ci.contract_id, ci.teacher_id, ci.starts_at_utc
      into v_contract_id, v_inst_teacher, v_inst_starts
      from class_instances ci where ci.id = p_instance;
    if v_contract_id is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
  end if;

  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
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
    if v_win.starts_at_utc <= v_inst_starts then
      raise exception 'a nova data precisa ser depois da aula original — para antecipar, fale com a escola';
    end if;
    v_new_id := public.reschedule_class_at(p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor);
  else
    select * into v_contract from contracts where id = v_contract_id for update;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;

    -- M1-5: a aula nasce com a duração do CRÉDITO da vez. Lock ANTES de espiar,
    -- para o pick do spend logo abaixo ser o mesmo (lock é reentrante na txn).
    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract.id::text, 0));
    select rc.duration_min into v_credit_dur
    from public._makeup_remaining_credits(v_contract.id) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord
    limit 1;

    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;

    v_duration_min := coalesce(v_credit_dur, v_slot_dur);
    if v_duration_min is null then
      raise exception 'contrato % não tem duração para o resgate (crédito sem duração e sem slot ativo)', v_contract.id;
    end if;

    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       v_win.starts_at_utc + make_interval(mins => v_duration_min),
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

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
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc,
      'duration_min', v_duration_min));

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Retomada de pausa preserva duração + origem (P6): recreate integral de
--    resume_contract (20260713000400). Mudanças, e só elas:
--    • o par −1/+1 de cada crédito vivo passa por _reissue_credit (duração e
--      aula de origem preservadas; o −1 é DIRIGIDO — intercalar é seguro);
--    • crédito que expirou durante a pausa: +1 direto copiando os metadados;
--    • crédito criado DURANTE a pausa NÃO é estendido (sem dobro — M3-7),
--      agora possível de garantir pela identidade (created_at < início da pausa).
-- ---------------------------------------------------------------------------
create or replace function public.resume_contract(
  p_contract uuid,
  p_actor uuid default null,
  p_today date default public.business_today()
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_pause contract_pauses%rowtype;
  v_actor uuid;
  v_days int;
  v_row record;
  v_extended int := 0;
  v_cancelled_ids uuid[] := array[]::uuid[];
  v_slot record;
  v_materialized int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'resume_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.status <> 'paused' then
    raise exception 'contrato % não está pausado (estado: %)', p_contract, v_contract.status;
  end if;

  select * into v_pause
  from contract_pauses
  where contract_id = p_contract and resumed_on is null
  for update;
  if not found then
    raise exception 'contrato % pausado sem registro de pausa aberto — corrigir via manual_adjust', p_contract;
  end if;

  v_days := p_today - v_pause.paused_on;
  if v_days < 0 then
    raise exception 'retomada (%) anterior ao início da pausa (%)', p_today, v_pause.paused_on;
  end if;

  if v_days > 0 then
    for v_row in
      select rc.ledger_id, rc.expires_on, rc.duration_min, ml.class_instance_id, ml.student_id
      from public._makeup_remaining_credits(p_contract) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
      where rc.expires_on >= v_pause.paused_on
        and rc.expires_on <> 'infinity'::date
        and ml.created_at < v_pause.created_at
      order by rc.ord
    loop
      if v_row.expires_on >= p_today then
        perform public._reissue_credit(v_row.ledger_id, v_row.expires_on + v_days,
                                       v_actor, 'pausa: validade estendida (' || v_days || ' dias)');
      else
        -- expirou durante a pausa: morto para o FIFO (sem débito); renasce com
        -- a validade estendida, preservando duração + origem.
        insert into makeup_ledger
          (contract_id, student_id, delta, reason, class_instance_id, expires_on,
           duration_min, note, created_by)
        values
          (p_contract, v_row.student_id, 1, 'manual_adjust', v_row.class_instance_id,
           v_row.expires_on + v_days, v_row.duration_min,
           'pausa: validade estendida (' || v_days || ' dias)', v_actor);
      end if;
      v_extended := v_extended + 1;
    end loop;
  end if;

  select coalesce(array_agg(i.id), array[]::uuid[]) into v_cancelled_ids
  from class_instances i
  where i.contract_id = p_contract
    and i.state = 'scheduled'
    and (i.starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
    and (i.starts_at_utc at time zone public.business_tz())::date < p_today;
  if coalesce(array_length(v_cancelled_ids, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled_ids);
  end if;

  update contracts set status = 'active' where id = p_contract;
  update contract_pauses set resumed_on = p_today where id = v_pause.id;

  for v_slot in
    select rs.id from recurring_slots rs
    where rs.contract_id = p_contract
      and (rs.active_to is null or rs.active_to >= p_today)
  loop
    v_materialized := v_materialized + public.materialize_slot(v_slot.id, 8);
  end loop;

  perform public.log_audit(v_actor, 'resume_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_pause.id, 'dias_pausados', v_days,
                       'creditos_estendidos', v_extended,
                       'aulas_canceladas_na_pausa', to_jsonb(v_cancelled_ids),
                       'aulas_materializadas', v_materialized));
  return v_extended;
end;
$$;
