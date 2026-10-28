-- Fase 5 / Construção total (14/07/2026) — wrapper de POSSE do auto-agendamento
-- de mentoria (handoff-fase5 §v): book_mentorship_session teve EXECUTE revogado
-- de authenticated desde a F1 e NUNCA recebe grant direto — o aluno chama ESTE
-- wrapper, que resolve o contrato de mentoria ATIVO do próprio auth.uid()
-- (padrão book_reschedule_window: SECURITY DEFINER ignora RLS ⇒ autorização
-- EXPLÍCITA aqui dentro) e delega ao motor, que revalida tudo DENTRO dos locks.

create or replace function public.book_my_mentorship_session(p_session uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract uuid;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'sessão sem usuário autenticado';
  end if;

  -- Contrato de mentoria ATIVO do próprio aluno (ADR-005: mentoria é individual —
  -- mais de um ativo é anomalia e PARA, nunca escolhe silenciosamente).
  select count(*) into v_count
  from mentorship_contracts mc
  join contracts c on c.id = mc.contract_id
  where c.status = 'active'
    and mc.contract_id in (select public.my_contract_ids());
  if v_count = 0 then
    raise exception 'você não tem um programa de mentoria ativo';
  end if;
  if v_count > 1 then
    raise exception 'mais de um contrato de mentoria ativo — fale com a administração';
  end if;

  select mc.contract_id into v_contract
  from mentorship_contracts mc
  join contracts c on c.id = mc.contract_id
  where c.status = 'active'
    and mc.contract_id in (select public.my_contract_ids());

  return public.book_mentorship_session(p_session, v_contract, auth.uid());
end;
$$;

revoke execute on function public.book_my_mentorship_session(uuid)
from public, anon;
grant execute on function public.book_my_mentorship_session(uuid) to authenticated;
