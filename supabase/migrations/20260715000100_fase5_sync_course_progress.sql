-- Fase 5 / Construção total (14/07/2026) — sync AUTORITATIVO de progresso.
-- Decisão (iii) do handoff-fase5: RPC SEPARADA last-write-wins para o polling,
-- mantendo apply_module_progress (20260714000500) intocada com a semântica
-- MONOTÔNICA de EVENTO. O polling lê a fonte autoritativa (Hotmart Club API),
-- que pode legitimamente REGREDIR (recontagem de páginas quando o curso muda).
--
-- Auditoria (Lei 8): toda chamada audita previous→new, inclusive regressões —
-- é exatamente a regressão que a dona vai querer explicar depois.

create or replace function public.sync_course_progress(
  p_contract uuid,
  p_pct numeric,
  p_total_pages int default null,
  p_completed_pages int default null
) returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_prev numeric;
begin
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'p_pct deve estar entre 0 e 100 (recebido: %)', p_pct;
  end if;

  -- Contrato de mentoria precisa existir; student_id derivado (mesma regra da
  -- apply_module_progress — contrato de mentoria é individual, ADR-005).
  select c.student_id into v_student
  from mentorship_contracts mc
  join contracts c on c.id = mc.contract_id
  where mc.contract_id = p_contract;
  if v_student is null then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  select completion_pct into v_prev
  from course_progress
  where contract_id = p_contract
  for update;

  insert into course_progress
    (contract_id, student_id, completion_pct, total_pages, completed_pages, last_synced_at)
  values
    (p_contract, v_student, p_pct, p_total_pages, p_completed_pages, now())
  on conflict (contract_id) do update
    set completion_pct = excluded.completion_pct,
        total_pages = coalesce(excluded.total_pages, course_progress.total_pages),
        completed_pages = coalesce(excluded.completed_pages, course_progress.completed_pages),
        last_synced_at = now();

  perform public.log_audit(null, 'sync_course_progress', 'course_progress', p_contract::text,
    jsonb_build_object(
      'previous_pct', v_prev,
      'new_pct', p_pct,
      'regressed', (v_prev is not null and p_pct < v_prev),
      'source', 'hotmart_polling'
    ));

  return p_pct;
end;
$$;

-- Grants-only para service_role (armadilha do "grant morto" do N1: NUNCA
-- combinar grant a service_role com check app_role() = 'admin' — app_role()
-- devolve 'none' em token service_role e rejeitaria o próprio chamador).
revoke execute on function public.sync_course_progress(uuid, numeric, int, int)
from public, anon, authenticated;
grant execute on function public.sync_course_progress(uuid, numeric, int, int)
to service_role;
