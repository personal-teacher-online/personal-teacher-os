-- Briefing v2 — LEMBRETE DO RE-BRIEFING SEMESTRAL (sub-lote 5, o último do P2;
-- spec em docs/goals/briefing-v2.md §Implementação 5).
--
-- O card do Início convida, mas não persegue: quem não abre o portal nunca lê o
-- convite. Este é o toque manual da dona na ficha do aluno — o irmão exato do
-- `enqueue_briefing_reminder` (migration 20260720000300), com a MESMA mecânica
-- (admin-only, exige login, 1 toque por dia por aluno, e-mail + WhatsApp quando
-- há número).
--
-- A RÉGUA NÃO É DELE. Quem decide se há atualização a fazer — e de qual
-- (contrato, semestre) — é `briefing_update_pendente` (migration
-- 20260728000300), a mesma função que acende o card do Início do aluno, abre a
-- rota /portal/briefing/atualizar e mostra o botão na ficha. O lembrete
-- pergunta e obedece: pendência existe, enfileira; não existe, recusa.
--
-- A primeira versão desta RPC tinha régua PRÓPRIA (plano vigente + semestre ≥ 2
-- + update não enviado) e escolhia contrato por conta — inclusive contrato de
-- grupo, que as RPCs de escrita nunca aceitaram. Duas cópias da mesma pergunta
-- discordando: o botão prometia um e-mail que o portal não conseguiria cumprir
-- (revisão de integração, achados 4 e 5). Régua única, uma frase de recusa.
--
-- Leis: 4 (admin lido de `app_role()`, que sai do app_metadata), 6/idempotência
-- (dedupe_key diária, mesmo desenho do irmão), 7 (migration nova), 8 (log_audit).

create or replace function public.enqueue_briefing_update_reminder(p_student uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_has_wa boolean;
  v_hoje date := public.business_today();
  v_n int := 0;
  v_rows int;
  v_contract uuid;
  v_semestre int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'apenas admin';
  end if;
  select profile_id into v_profile from students where id = p_student;
  if v_profile is null then
    raise exception 'o aluno ainda não tem login — envie o convite primeiro';
  end if;

  -- A pergunta inteira, num lugar só. Zero linhas = não há o que lembrar, e a
  -- frase enumera os porquês possíveis em vez de repetir aqui as verificações
  -- (que voltariam a divergir na primeira mudança).
  select p.contract_id, p.semester_no
    into v_contract, v_semestre
    from public.briefing_update_pendente(p_student) p;

  if v_contract is null then
    raise exception 'este aluno não tem atualização de briefing pendente — é preciso contrato individual ativo, plano de estudos vigente do 2º semestre em diante, briefing completo já enviado no formulário novo, e a atualização daquele semestre ainda não enviada';
  end if;

  -- O payload leva contrato e semestre por RASTRO (o texto do aviso é o mesmo
  -- para todo semestre — nada do que se lê na mensagem depende deles, e por isso
  -- nada envelhece entre o enfileiramento e o despacho).
  insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
  values ('briefing-update-reminder', v_profile,
          jsonb_build_object('student_id', p_student, 'contract_id', v_contract,
                             'semester_no', v_semestre),
          format('briefing-update-reminder:%s:%s', p_student, v_hoje))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  select p.whatsapp_e164 is not null into v_has_wa from profiles p where p.id = v_profile;
  if coalesce(v_has_wa, false) then
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values ('whatsapp', 'briefing-update-reminder', v_profile,
            jsonb_build_object('student_id', p_student, 'contract_id', v_contract,
                               'semester_no', v_semestre),
            format('briefing-update-reminder:wa:%s:%s', p_student, v_hoje))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;

  perform public.log_audit(auth.uid(), 'enqueue_briefing_update_reminder', 'briefing_updates',
    p_student::text,
    jsonb_build_object('enfileirados', v_n, 'contract_id', v_contract, 'semester_no', v_semestre));
  return v_n;
end;
$$;
revoke execute on function public.enqueue_briefing_update_reminder(uuid) from public, anon;
grant execute on function public.enqueue_briefing_update_reminder(uuid) to authenticated;

comment on function public.enqueue_briefing_update_reminder(uuid) is
  'Toque manual da admin lembrando o aluno de ATUALIZAR o briefing do semestre (template briefing-update-reminder, 1 por dia por aluno). Quem decide se há o que lembrar é briefing_update_pendente — a MESMA função do card do Início e do botão da ficha; sem pendência, recusa.';
