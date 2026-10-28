-- Fase 2 / M2 — Crédito manual pela admin (D8). earn_makeup/spend_makeup continuam
-- revogadas de clientes (ADR-010 §2); este wrapper admin-only (D10, auditado) é a
-- ÚNICA superfície de ajuste manual do ledger via UI. Delta ±N em chamadas unitárias
-- às primitivas (o ledger é linha a linha ±1 — Lei 2).

create or replace function public.admin_makeup_adjust(
  p_contract uuid,
  p_delta int,
  p_expires_on date default null,
  p_note text default null,
  p_actor uuid default null
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

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'crédito de reposição é de contratos private_1on1';
  end if;

  if p_delta > 0 then
    -- Crédito manual SEMPRE nasce com validade (ADR-008: ganhos expiram; manual_adjust
    -- é livre no CHECK, mas a superfície da admin não cria crédito eterno).
    if p_expires_on is null then
      raise exception 'crédito manual exige expires_on (validade do crédito)';
    end if;
    if p_expires_on < current_date then
      raise exception 'expires_on (%) no passado', p_expires_on;
    end if;
    for i in 1 .. p_delta loop
      perform public.earn_makeup(p_contract, 'manual_adjust', p_expires_on,
                                 v_contract.student_id, null, v_actor);
    end loop;
  else
    for i in 1 .. -p_delta loop
      -- spend_makeup verifica saldo DENTRO da transação (Lei 2) — estoura se zerar.
      perform public.spend_makeup(p_contract, 'manual_adjust',
                                  v_contract.student_id, null, v_actor);
    end loop;
  end if;

  perform public.log_audit(v_actor, 'admin_makeup_adjust', 'makeup_ledger', p_contract::text,
    jsonb_build_object('delta', p_delta, 'expires_on', p_expires_on, 'note', p_note));

  return public.makeup_balance(p_contract);
end;
$$;

revoke execute on function public.admin_makeup_adjust(uuid, int, date, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_makeup_adjust(uuid, int, date, text, uuid)
to authenticated;
