-- Correção de relógio na retomada de pausa (achado de 23/07/2026: o teste
-- F3-D10 "FIFO preservado com DOIS créditos" quebrou SOZINHO pelo calendário).
--
-- O bug: resume_contract decide "crédito vivo" pelo p_today INJETADO (injeção
-- de relógio, padrão do motor), mas _reissue_credit re-verificava a vida do
-- crédito com public.business_today() REAL. Quando os relógios divergem —
-- retomada RETROATIVA com crédito vivo em p_today porém vencido até hoje — a
-- _reissue_credit recusa ("crédito não está vivo") e a retomada INTEIRA
-- falha. Em produção: a admin retomando uma pausa com data retroativa veria a
-- exceção críptica em vez do crédito estendido (o propósito do congelamento).
--
-- Mudança mínima, comportamento dos demais chamadores intacto:
--  • _reissue_credit ganha p_today (default business_today() — extensão de
--    validade F3, transferências F4 e ADR-018 agem "agora" e ficam idênticas);
--  • resume_contract passa o próprio p_today adiante.
--
-- DROP + CREATE (não CREATE OR REPLACE) na _reissue_credit: parâmetro novo =
-- assinatura nova = OVERLOAD novo — as chamadas existentes de 4 argumentos
-- ficariam ambíguas entre as duas versões.

drop function public._reissue_credit(bigint, date, uuid, text, uuid);

create function public._reissue_credit(
  p_ledger_id bigint,
  p_new_expires_on date,
  p_actor uuid,
  p_note text default null,
  p_new_contract uuid default null,
  p_today date default public.business_today()
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
  -- só crédito AINDA VIVO no replay (não gasto, não vencido) — vivo NA DATA DO
  -- CHAMADOR (p_today), nunca no relógio próprio (a correção deste arquivo)
  if not exists (
    select 1 from public._makeup_remaining_credits(v_orig.contract_id) rc
    where rc.ledger_id = p_ledger_id and rc.expires_on >= p_today
  ) then
    raise exception 'crédito % não está vivo (gasto ou vencido) — nada a relançar', p_ledger_id;
  end if;
  if p_new_expires_on < p_today then
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
revoke execute on function public._reissue_credit(bigint, date, uuid, text, uuid, date)
from public, anon, authenticated;

-- resume_contract: recreate integral da versão F1 §9. ÚNICA mudança: o
-- p_today segue adiante para a _reissue_credit (relógio do chamador).
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
                                       v_actor, 'pausa: validade estendida (' || v_days || ' dias)',
                                       null, p_today);
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
