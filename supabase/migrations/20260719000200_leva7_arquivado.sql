-- Leva 7 (S2-13 do e2e): anonimizado vira ARQUIVADO — sai da lista de
-- trabalho do admin (filtro próprio), sem sumir do histórico. Função recriada
-- do dump vivo; retroativo cobre quem já foi anonimizado.

-- 'archived' entra no vocabulário de status do aluno
alter table public.students drop constraint students_status_check;
alter table public.students add constraint students_status_check
  check (status = any (array['active'::text, 'paused'::text, 'churned'::text, 'archived'::text]));

CREATE OR REPLACE FUNCTION public.admin_anonymize_student(p_student uuid, p_confirm text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student students%rowtype;
  v_actor uuid;
  v_phone text;
  v_profile uuid;
  v_payer record;
  v_fiscal int := 0;
  v_scrubbed int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_anonymize_student é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_student from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;
  -- dupla confirmação: digitar o NOME exato
  if btrim(coalesce(p_confirm, '')) <> v_student.display_name then
    raise exception 'confirmação não confere — digite o nome exato do aluno';
  end if;
  -- só ex-aluno: TODOS os contratos (diretos e de grupo) encerrados
  if exists (
    select 1 from contracts c
    where c.status <> 'ended'
      and (c.student_id = p_student
           or c.student_group_id in (
                select m.group_id from student_group_members m where m.student_id = p_student))
  ) then
    raise exception 'aluno ainda tem contrato não-encerrado — encerre antes de anonimizar';
  end if;

  v_profile := v_student.profile_id;
  if v_profile is not null then
    select whatsapp_e164 into v_phone from profiles where id = v_profile;
    update profiles
       set full_name = 'Ex-aluno(a)',
           whatsapp_e164 = null,
           email_bounced_at = null,
           email_bounce_reason = null
     where id = v_profile;
  end if;

  -- esqueleto operacional preservado (aulas, ledger, extratos, auditoria);
  -- relatórios ENVIADOS ficam (exceção controlada da decisão M4-5)
  update students
     set display_name = 'Ex-aluno(a) ' || left(p_student::text, 4),
         status = 'archived',  -- S2-13: sai da lista de trabalho (filtro Arquivados)
         city = null,
         country = null,
         level = null,
         profile_id = null
   where id = p_student;

  -- M11-4: pagador EXCLUSIVO deste aluno — com cobrança real (Asaas) preserva
  -- 5 anos (obrigação fiscal, expurgo manual futuro registrado); sem, é limpo.
  for v_payer in
    select py.* from payers py
    join student_payers sp on sp.payer_id = py.id and sp.student_id = p_student
    where not exists (
      select 1 from student_payers sp2
      where sp2.payer_id = py.id and sp2.student_id <> p_student)
  loop
    if v_payer.asaas_customer_id is not null then
      v_fiscal := v_fiscal + 1;
    else
      update payers set name = 'Pagador removido', email = null, cpf_cnpj = null
       where id = v_payer.id;
      v_scrubbed := v_scrubbed + 1;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'anonymize_student', 'students', p_student::text,
    jsonb_build_object('profile_id', v_profile, 'payers_fiscal_5anos', v_fiscal,
                       'payers_scrubbed', v_scrubbed));

  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed);
end;
$function$;

update students set status = 'archived'
where display_name like 'Ex-aluno(a) %' and status <> 'archived';
