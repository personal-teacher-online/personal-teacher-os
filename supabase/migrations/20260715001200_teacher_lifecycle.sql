-- Ciclo de vida da professora no admin (15/07/2026) — pedido do mantenedor após
-- a lista de professoras virar um lixão de testes sem caminho para limpar.
-- Decisões: apagar SÓ quem não tem história; arquivar quem já tem (dinheiro e
-- auditoria nunca somem). Regras NO BANCO (Lei 3), toda mutação auditada (Lei 8),
-- posse validada dentro da função (D10 — admin apenas).

-- Arquivamento: soft-hide para professora COM história (contratos/aulas/extratos).
alter table teachers add column archived_at timestamptz;
comment on column teachers.archived_at is
  'Professora arquivada (soft): some das listas de gestão, mas contratos/aulas/'
  'extratos passados continuam íntegros. NULL = ativa. delete_teacher só apaga '
  'quem NÃO tem história; o resto arquiva.';

-- ---------------------------------------------------------------------------
-- delete_teacher: apaga DE VERDADE, mas só quem não deixou rastro financeiro/
-- de agenda. Retorna o profile_id (ou NULL) para a server action remover o
-- usuário órfão do Auth (convite pendente que nunca virou aula).
-- ---------------------------------------------------------------------------
create or replace function public.delete_teacher(p_teacher uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_name text;
  v_owner boolean;
  v_deps int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: só a administração remove professora';
  end if;

  select profile_id, display_name, is_owner into v_profile, v_name, v_owner
  from teachers where id = p_teacher;
  if not found then
    raise exception 'professora não encontrada';
  end if;
  if v_owner then
    raise exception 'a dona da escola não pode ser removida';
  end if;

  -- Qualquer história = dinheiro/agenda: NUNCA apagar em cascata (Lei 8).
  select count(*) into v_deps from (
    select 1 from contracts where teacher_id = p_teacher
    union all select 1 from class_instances where teacher_id = p_teacher
    union all select 1 from reschedule_windows where teacher_id = p_teacher
    union all select 1 from teacher_statements where teacher_id = p_teacher
  ) d;
  if v_deps > 0 then
    -- código estável para a action traduzir em "arquive em vez de apagar"
    raise exception 'PROFESSORA_COM_HISTORICO';
  end if;

  delete from teacher_google_accounts where teacher_id = p_teacher; -- (FK já é cascade; explícito por clareza)
  delete from teachers where id = p_teacher;

  insert into audit_log (actor, action, entity, entity_id, diff)
  values (auth.uid(), 'delete_teacher', 'teachers', p_teacher,
          jsonb_build_object('display_name', v_name, 'profile_id', v_profile));

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_teacher_archived: arquivar / reativar (o caminho para quem tem história).
-- ---------------------------------------------------------------------------
create or replace function public.set_teacher_archived(p_teacher uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner boolean;
  v_name text;
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: só a administração arquiva professora';
  end if;
  select is_owner, display_name into v_owner, v_name from teachers where id = p_teacher;
  if not found then
    raise exception 'professora não encontrada';
  end if;
  if v_owner and p_archived then
    raise exception 'a dona da escola não pode ser arquivada';
  end if;

  update teachers
    set archived_at = case when p_archived then now() else null end
  where id = p_teacher;

  insert into audit_log (actor, action, entity, entity_id, diff)
  values (auth.uid(),
          case when p_archived then 'archive_teacher' else 'unarchive_teacher' end,
          'teachers', p_teacher, jsonb_build_object('display_name', v_name));
end;
$$;

-- D10/F2: posse validada DENTRO das funções (definer); chamáveis por authenticated.
revoke execute on function public.delete_teacher(uuid) from public;
revoke execute on function public.set_teacher_archived(uuid, boolean) from public;
grant execute on function public.delete_teacher(uuid) to authenticated;
grant execute on function public.set_teacher_archived(uuid, boolean) to authenticated;
