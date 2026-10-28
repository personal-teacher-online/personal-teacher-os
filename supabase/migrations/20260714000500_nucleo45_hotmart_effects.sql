-- Núcleo 4/5 / N1 — efeitos Hotmart em RPCs SQL testadas AGORA (N45-D4; padrão
-- Asaas, Lei 6). A rota /api/webhooks/hotmart INTEIRA (header de autenticidade,
-- event_id natural, parser) fica no handoff-fase5.md — campos [VERIFICAR] na doc
-- oficial. Convenção de inbox pinada: webhook_inbox (source='hotmart', event_id,
-- payload) first-write-wins — mecanismo UNIQUE(source, event_id) já provado na
-- F2 (source='asaas').
--
-- Chamador (N45-D4/D5): ambas grants-only — GRANT EXECUTE só a service_role,
-- SEM check app_role() interno (precedente enqueue_credit_expiry_notices,
-- 20260713000200). Armadilha a NÃO copiar: o padrão F3 de grant a service_role
-- + check app_role() <> 'admin' rejeita o próprio service_role (app_role() lê
-- app_metadata do JWT e devolve 'none' num token service_role) — grant morto.

-- ---------------------------------------------------------------------------
-- apply_course_first_access — efeito do CLUB_FIRST_ACCESS.
-- Recebe o INSTANTE CRU do evento; a data civil é derivada AQUI, no fuso do
-- ALUNO (ADR-008 §12 + comment de mentorship_contracts.course_start_date):
-- (p_event_at AT TIME ZONE s.iana_tz)::date — nunca UTC nem fuso do negócio.
-- Isso tira a lógica de Lei 1 do parser [VERIFICAR] da Fase 5 e a torna
-- testável já no N1 (evento noturno que cruza a meia-noite local).
-- Seta course_start_date se NULL; idempotente (2ª chamada = no-op auditável).
-- ---------------------------------------------------------------------------
create or replace function public.apply_course_first_access(
  p_contract uuid,
  p_event_at timestamptz
) returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_current date;
  v_date date;
begin
  if p_event_at is null then
    raise exception 'p_event_at é obrigatório (instante cru do evento CLUB_FIRST_ACCESS)';
  end if;

  -- Lock da extensão de mentoria: serializa first_access repetido (replay de
  -- webhook) — a idempotência precisa ler o valor commitado.
  select s.iana_tz, mc.course_start_date
    into v_tz, v_current
  from mentorship_contracts mc
  join contracts c on c.id = mc.contract_id
  join students s on s.id = c.student_id
  where mc.contract_id = p_contract
  for update of mc;
  if not found then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  -- Data CIVIL no fuso do ALUNO (students.iana_tz é NOT NULL — core.sql).
  v_date := (p_event_at at time zone v_tz)::date;

  if v_current is not null then
    -- No-op idempotente AUDITÁVEL (Lei 8): registra o instante rejeitado.
    perform public.log_audit(null, 'apply_course_first_access', 'mentorship_contracts', p_contract::text,
      jsonb_build_object(
        'outcome', 'skipped_already_set',
        'course_start_date', v_current,
        'rejected_date', v_date,
        'event_at', p_event_at,
        'iana_tz', v_tz));
    return v_current;
  end if;

  update mentorship_contracts
     set course_start_date = v_date
   where contract_id = p_contract;

  perform public.log_audit(null, 'apply_course_first_access', 'mentorship_contracts', p_contract::text,
    jsonb_build_object(
      'outcome', 'applied',
      'course_start_date', v_date,
      'event_at', p_event_at,
      'iana_tz', v_tz));

  return v_date;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_module_progress — efeito do CLUB_MODULE_COMPLETED.
-- MONOTÔNICO como semântica de EVENTO (proteção contra webhook atrasado): pct
-- só sobe. O sync AUTORITATIVO do polling F5 (que pode legitimamente REGREDIR
-- pct quando a Hotmart reconta páginas) é decisão em aberto da Fase 5 — a
-- monotonicidade é contrato DESTA RPC, NÃO constraint: correção regressiva
-- legítima é UPDATE direto da admin (policy admin_all / bridge manual do
-- CLAUDE.md), auditável, fora da RPC.
-- UPSERT: contratos sem linha em course_progress existem (mentorship_can_book
-- tolera com coalesce(pct,0)) → INSERT com student_id derivado de
-- contracts.student_id (NOT NULL garantido por contracts_mentorship_individual).
-- last_synced_at avança em TODA aplicação, INCLUSIVE no no-op monotônico (o
-- sync aconteceu); o no-op é auditado com o pct rejeitado no diff (Lei 8).
-- ---------------------------------------------------------------------------
create or replace function public.apply_module_progress(
  p_contract uuid,
  p_pct numeric
) returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_old numeric;
  v_new numeric;
begin
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'p_pct deve estar entre 0 e 100 (recebido: %)', p_pct;
  end if;
  if not exists (select 1 from mentorship_contracts mc where mc.contract_id = p_contract) then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  select cp.completion_pct into v_old
  from course_progress cp
  where cp.contract_id = p_contract
  for update;

  if not found then
    select c.student_id into v_student from contracts c where c.id = p_contract;
    -- ON CONFLICT cobre a corrida rara de dois primeiros-syncs simultâneos:
    -- greatest() mantém a monotonicidade mesmo se outro INSERT commitou antes.
    -- Painel do gate N1 (13/07/2026): auditar/retornar o valor EFETIVO
    -- (RETURNING) — no perdedor da corrida, dizer 'applied p_pct' quando a
    -- linha guarda o pct concorrente maior seria trilha de auditoria falsa
    -- (Lei 8); o mesmo evento no ramo com linha é 'skipped_regression'.
    insert into course_progress (contract_id, student_id, completion_pct, last_synced_at)
    values (p_contract, v_student, p_pct, now())
    on conflict (contract_id) do update
      set completion_pct = greatest(course_progress.completion_pct, excluded.completion_pct),
          last_synced_at = now()
    returning completion_pct into v_new;

    if v_new = p_pct then
      perform public.log_audit(null, 'apply_module_progress', 'course_progress', p_contract::text,
        jsonb_build_object('outcome', 'applied', 'old_pct', null, 'new_pct', p_pct));
    else
      perform public.log_audit(null, 'apply_module_progress', 'course_progress', p_contract::text,
        jsonb_build_object('outcome', 'skipped_regression', 'current_pct', v_new, 'rejected_pct', p_pct));
    end if;
    return v_new;
  end if;

  if p_pct < v_old then
    -- No-op monotônico: pct fica, last_synced_at avança (o sync aconteceu).
    update course_progress
       set last_synced_at = now()
     where contract_id = p_contract;

    perform public.log_audit(null, 'apply_module_progress', 'course_progress', p_contract::text,
      jsonb_build_object('outcome', 'skipped_regression', 'current_pct', v_old, 'rejected_pct', p_pct));
    return v_old;
  end if;

  update course_progress
     set completion_pct = p_pct,
         last_synced_at = now()
   where contract_id = p_contract;

  perform public.log_audit(null, 'apply_module_progress', 'course_progress', p_contract::text,
    jsonb_build_object('outcome', 'applied', 'old_pct', v_old, 'new_pct', p_pct));
  return p_pct;
end;
$$;

-- Grants-only (N45-D4): só o servidor (service_role) chama; nenhum check interno.
revoke execute on function
  public.apply_course_first_access(uuid, timestamptz),
  public.apply_module_progress(uuid, numeric)
from public, anon, authenticated;
grant execute on function
  public.apply_course_first_access(uuid, timestamptz),
  public.apply_module_progress(uuid, numeric)
to service_role;
