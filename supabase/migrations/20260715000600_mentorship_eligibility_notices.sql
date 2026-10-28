-- Construção total (14/07/2026) — notificação de elegibilidade de mentoria
-- (handoff-fase5 §v): quando o mentorado tem etapa reservável, avisa por
-- e-mail (+ WhatsApp com opt-in).
--
-- PAINEL da construção total:
--  (2/13/17/23/35) mentorship_can_book RAISA quando o threshold da etapa não
--  está configurado (semântica D2, pensada para a RESERVA) — aqui cada
--  contrato é ISOLADO em sub-bloco: um mentorado desconfigurado vira rastro
--  auditado (skip), nunca aborta o batch (o estado "sem thresholds" é o ATUAL,
--  pendência da dona).
--  (22) dedupe e template pela ETAPA RESERVÁVEL (mentorship_next_window), não
--  pelo total destravado: depois de gastar a etapa 1, a liberação da etapa 2
--  gera aviso próprio, com o número certo.
--  (7/31) sem parâmetro p_today morto — datas de teste manipulam a fixture
--  (course_start_date), padrão da suíte nucleo45.

create or replace function public.enqueue_mentorship_eligibility_notices()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_unlocked int;
  v_next int;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_row in
    select mc.contract_id, mc.total_credits, c.student_id, s.profile_id
    from mentorship_contracts mc
    join contracts c on c.id = mc.contract_id
    join students s on s.id = c.student_id
    where c.status = 'active'
      and mc.course_start_date is not null
  loop
    begin
      v_unlocked := public.mentorship_windows_unlocked(v_row.contract_id);
      if v_unlocked < 1 then
        continue;
      end if;
      v_next := public.mentorship_next_window(v_row.contract_id);
      if v_next is null or v_next > v_unlocked or v_next > v_row.total_credits then
        continue; -- nada novo reservável
      end if;
      if not public.mentorship_can_book(v_row.contract_id) then
        continue;
      end if;
    exception when others then
      -- Threshold ausente (D2) ou afim: rastro auditável, batch segue vivo.
      perform public.log_audit(null, 'mentorship_eligibility_skip',
        'mentorship_contracts', v_row.contract_id::text,
        jsonb_build_object('error', sqlerrm));
      continue;
    end;

    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values (
      'mentorship-eligible',
      v_row.profile_id,
      jsonb_build_object(
        'contract_id', v_row.contract_id,
        'student_id', v_row.student_id,
        'next_window', v_next,
        'total_credits', v_row.total_credits
      ),
      format('mentorship-eligible:%s:%s', v_row.contract_id, v_next)
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_opt_in and p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'mentorship-eligible', v_row.profile_id,
        jsonb_build_object(
          'contract_id', v_row.contract_id,
          'student_id', v_row.student_id,
          'next_window', v_next,
          'total_credits', v_row.total_credits
        ),
        format('mentorship-eligible:%s:%s:wa', v_row.contract_id, v_next)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;

revoke execute on function public.enqueue_mentorship_eligibility_notices()
from public, anon, authenticated;
grant execute on function public.enqueue_mentorship_eligibility_notices() to service_role;

select cron.schedule(
  'enqueue-mentorship-eligibility-daily',
  '5 10 * * *',
  $$select public.enqueue_mentorship_eligibility_notices()$$
);
