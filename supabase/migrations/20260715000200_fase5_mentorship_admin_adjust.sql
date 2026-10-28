-- Fase 5 / Construção total (14/07/2026) — ajuste manual do ledger de MENTORIA.
-- Handoff-fase5 (v): o REVOKE INSERT no ledger (adendo ADR-011) fechou a última
-- via de escrita direta — este wrapper admin-only é a ÚNICA superfície de ajuste
-- manual, espelhando admin_makeup_adjust (D10, ±1 por linha, auditado).
--
-- ⚠️ PROTOCOLO DE LOCK VINCULANTE (adendo ADR-009): TODA via de escrita do
-- ledger de mentoria adquire o advisory do contrato ANTES de ler/escrever —
-- a MESMA chave literal do motor ('mentorship_book:'||contract). Sem sessão
-- envolvida aqui, a ordem global sessão→contrato é trivialmente satisfeita.
--
-- SEMÂNTICA (registrada de propósito, para ninguém se enganar depois): o ajuste
-- manual NÃO altera a elegibilidade da escada — reservas continuam decididas por
-- janelas destravadas (datas) + thresholds + gasto líquido (N45-D3). manual_adjust
-- serve a COMPENSAÇÕES e registro auditável (Lei 2: "gastos e ajustes manuais").
-- Se um dia o ajuste manual precisar destravar/travar etapas, é goal próprio.

create or replace function public.admin_mentorship_adjust(
  p_contract uuid,
  p_delta int,
  p_note text default null,
  p_actor uuid default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_actor uuid;
  v_net int;
  i int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_mentorship_adjust é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if p_delta = 0 or p_delta is null then
    raise exception 'p_delta deve ser ±N (recebido: %)', p_delta;
  end if;
  -- Sanidade: o programa inteiro tem 6 créditos (doc 04) — 12 cobre qualquer
  -- correção legítima com folga.
  if abs(p_delta) > 12 then
    raise exception 'ajuste de % créditos de mentoria de uma vez? Limite de sanidade: 12', p_delta;
  end if;

  select c.student_id into v_student
  from mentorship_contracts mc
  join contracts c on c.id = mc.contract_id
  where mc.contract_id = p_contract;
  if v_student is null then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  -- Lock VINCULANTE antes de qualquer leitura/escrita do ledger.
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || p_contract::text, 0));

  -- Lei 2 (dupla entrada): ±1 por linha; window_index/session NULL (não é gasto
  -- de etapa — o CHECK mentorship_ledger_spend_shape só vale para booking_spend).
  for i in 1 .. abs(p_delta) loop
    insert into mentorship_credit_ledger
      (contract_id, student_id, delta, reason, created_by)
    values
      (p_contract, v_student, sign(p_delta), 'manual_adjust', v_actor);
  end loop;

  perform public.log_audit(v_actor, 'admin_mentorship_adjust', 'mentorship_credit_ledger',
    p_contract::text,
    jsonb_build_object('delta', p_delta, 'note', p_note));

  -- Devolve o líquido de ajustes manuais (visibilidade — NÃO é elegibilidade).
  select coalesce(sum(delta), 0) into v_net
  from mentorship_credit_ledger
  where contract_id = p_contract and reason = 'manual_adjust';
  return v_net;
end;
$$;

revoke execute on function public.admin_mentorship_adjust(uuid, int, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_mentorship_adjust(uuid, int, text, uuid)
to authenticated;
