-- QA da construção total (decisão do mantenedor, 14/07/2026): o aluno NÃO pode
-- ADIANTAR aula — remarcação é só para horário DEPOIS da aula original (Lei 3:
-- a regra vive no banco; a UI apenas filtra as janelas). O modo RESGATE (crédito
-- → aula avulsa) não muda: não há aula sendo movida.
-- Trade-off registrado: isso também impede antecipação desejada ("posso ir
-- amanhã em vez de sexta?") — se incomodar um dia, vira flag por contrato.
--
-- Recreate integral de book_reschedule_window (20260712000100) com o check novo;
-- todo o resto é byte a byte o comportamento vigente (casos 8/15/16/D1/D10/D12).

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
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- Consumo atômico: lock da janela primeiro (corrida de 2 alunos → um vence, caso 8).
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
  -- Janela máxima de 2 semanas (D1) — regra avaliada NO CONSUMO.
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

  -- D10: posse do chamador — dono do contrato OU admin. SECURITY DEFINER ignora RLS,
  -- então a autorização é EXPLÍCITA aqui dentro.
  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
  -- Caso 16 (D1): a janela precisa ser da professora da AULA remarcada — âncora na
  -- INSTÂNCIA; no resgate (sem aula), na professora do contrato. Instância divergente
  -- do contrato = estado inconsistente (admin trocou teacher_id?): falhar cedo.
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
    -- QA 14/07/2026: remarcação só ADIA — nunca antecipa a aula original.
    if v_win.starts_at_utc <= v_inst_starts then
      raise exception 'a nova data precisa ser depois da aula original — para antecipar, fale com a escola';
    end if;
    -- Modo REMARCAÇÃO: o overload copia o instante publicado BYTE A BYTE (invariante D1).
    v_new_id := public.reschedule_class_at(p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor);
  else
    -- Modo RESGATE (D12): crédito de reposição vira aula avulsa. Sem alçada — resgate
    -- SEMPRE consome crédito. Sem aviso mínimo — não há aula sendo movida.
    select * into v_contract from contracts where id = v_contract_id for update;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;
    -- Duração: a do slot ativo do contrato (decisão do plano do M1).
    select rs.duration_min into v_duration_min
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;
    if v_duration_min is null then
      raise exception 'contrato % não tem slot ativo para definir a duração do resgate', v_contract.id;
    end if;

    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       v_win.starts_at_utc + make_interval(mins => v_duration_min),
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    -- Saldo verificado DENTRO da transação, com lock por contrato (Lei 2).
    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

  -- INVARIANTE D1 (caso 15): o instante da instância criada É o publicado, byte a byte.
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
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc));

  return v_new_id;
end;
$$;

-- CREATE OR REPLACE preserva ACLs, mas re-afirmar documenta (ADR-010 §2).
revoke execute on function public.book_reschedule_window(uuid, uuid, uuid, uuid)
from public, anon;
grant execute on function public.book_reschedule_window(uuid, uuid, uuid, uuid)
to authenticated;
