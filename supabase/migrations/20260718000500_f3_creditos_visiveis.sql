-- F3 — Créditos visíveis (plano integrado v2, 18/07/2026; decisões M3-2, M3-6,
-- M2-2 + P6 do passe adversarial). A expiração deixa de ser silenciosa:
--   1. admin_credit_expiry_overview — a leitura em lote do painel "vencendo ≤30
--      dias / vencidos nos últimos 30" (por ENTRADA viva do FIFO, com identidade
--      — cada linha é extensível individualmente).
--   2. admin_extend_credit — o par −1/+1 via _reissue_credit (F1): preserva
--      duração + origem, motivo OBRIGATÓRIO, tudo auditado.
-- Contratos pausados ficam FORA do painel (os créditos estão congelados; a
-- retomada os estende sozinha — F3-D10).

create or replace function public.admin_credit_expiry_overview()
returns table (
  contract_id uuid,
  student_id uuid,
  who text,
  ledger_id bigint,
  expires_on date,
  duration_min int,
  situation text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_credit_expiry_overview é restrita à admin (D10)';
  end if;
  return query
  select c.id, c.student_id,
         coalesce(s.display_name, g.label, '—'),
         rc.ledger_id, rc.expires_on, rc.duration_min,
         case when rc.expires_on < public.business_today() then 'vencido' else 'vencendo' end
  from contracts c
  left join students s on s.id = c.student_id
  left join student_groups g on g.id = c.student_group_id
  cross join lateral public._makeup_remaining_credits(c.id) rc
  where c.contract_type = 'private_1on1'
    and c.status = 'active'
    and rc.expires_on <> 'infinity'::date
    and rc.expires_on >= public.business_today() - 30
    and rc.expires_on <= public.business_today() + 30
  order by rc.expires_on, 3;
end;
$$;
revoke execute on function public.admin_credit_expiry_overview() from public, anon;
grant execute on function public.admin_credit_expiry_overview() to authenticated;

create or replace function public.admin_extend_credit(
  p_ledger bigint,
  p_new_expires_on date,
  p_note text default null,  -- default só para o PostgREST resolver a chamada; a função RECUSA null/vazio
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row makeup_ledger%rowtype;
  v_new_id bigint;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_extend_credit é restrita à admin (D10)';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'estender validade exige motivo (M3-2)';
  end if;
  select * into v_row from makeup_ledger where id = p_ledger;
  if not found then
    raise exception 'lançamento % não existe', p_ledger;
  end if;
  if not exists (
    select 1 from contracts c
    where c.id = v_row.contract_id and c.contract_type = 'private_1on1'
  ) then
    raise exception 'extensão de validade é de créditos de reposição (particulares)';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_row.contract_id::text, 0));

  if exists (
    select 1 from public._makeup_remaining_credits(v_row.contract_id) rc
    where rc.ledger_id = p_ledger and rc.expires_on >= public.business_today()
  ) then
    -- crédito VIVO: par −1/+1 dirigido (preserva duração+origem, audita) — P6.
    return public._reissue_credit(p_ledger, p_new_expires_on, coalesce(auth.uid(), p_actor), p_note);
  elsif exists (
    select 1 from public._makeup_remaining_credits(v_row.contract_id) rc
    where rc.ledger_id = p_ledger
  ) then
    -- VENCIDO sem uso (últimos 30 do painel): morto para o FIFO — renasce com a
    -- validade nova SEM débito (o mesmo padrão da retomada de pausa, F1).
    if p_new_expires_on < public.business_today() then
      raise exception 'nova validade (%) no passado', p_new_expires_on;
    end if;
    insert into makeup_ledger
      (contract_id, student_id, delta, reason, class_instance_id, expires_on,
       duration_min, note, created_by)
    values
      (v_row.contract_id, v_row.student_id, 1, 'manual_adjust', v_row.class_instance_id,
       p_new_expires_on, v_row.duration_min, p_note, coalesce(auth.uid(), p_actor))
    returning id into v_new_id;
    perform public.log_audit(coalesce(auth.uid(), p_actor), 'admin_extend_credit',
      'makeup_ledger', v_new_id::text,
      jsonb_build_object('revived_from', p_ledger, 'old_expires_on', v_row.expires_on,
                         'new_expires_on', p_new_expires_on, 'note', p_note));
    return v_new_id;
  else
    raise exception 'crédito % já foi gasto — nada a estender', p_ledger;
  end if;
end;
$$;
revoke execute on function public.admin_extend_credit(bigint, date, text, uuid)
from public, anon;
grant execute on function public.admin_extend_credit(bigint, date, text, uuid) to authenticated;
