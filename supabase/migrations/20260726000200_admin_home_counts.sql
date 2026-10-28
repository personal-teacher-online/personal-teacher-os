-- CONTAGENS DA HOME SEM CARREGAR O DIRETÓRIO INTEIRO
-- (revisão adversarial nº 1 da Onda 1 · M1+M2, item C2).
--
-- O Início mostra duas contagens na fila de pendências: quantos alunos ainda
-- não têm acesso ao portal e quantos estão travados no briefing. Até aqui, os
-- dois números vinham de `admin_student_directory()` — a leitura MAIS CARA do
-- admin: ela devolve a ficha inteira de todo mundo e, para cada contrato
-- particular, faz o replay FIFO do ledger de créditos DUAS vezes
-- (`makeup_balance` + `makeup_remaining_expiries`). Pagar isso para contar duas
-- coisas é caro e, pior, traz para a memória do processo dado pessoal (e-mail,
-- telefone, cidade) que a tela não desenha.
--
-- Esta função responde exatamente as duas perguntas, set-based, sem tocar em
-- ledger e sem devolver um único dado pessoal.
--
-- SEMÂNTICA IDÊNTICA à que o diretório entregava (nada de número novo):
--  · convites_pendentes — aluno não arquivado SEM profile vinculado OU com
--    e-mail ainda não confirmado. O "confirmado" mora em auth.users
--    (email_confirmed_at) e por isso a função é security definer: o mesmo
--    caminho que o diretório já usava.
--  · briefings_travados — aluno não arquivado, com contrato ATIVO (direto ou
--    pelo grupo), sem briefing 'submitted'.
--
-- Leis: 3 (a definição do número mora no Postgres), 4 (gate por app_metadata,
-- via public.app_role(), idêntico ao de admin_kpis).

create or replace function public.admin_home_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_convites  int;
  v_briefings int;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'admin_home_counts é restrita à admin';
  end if;

  select count(*) into v_convites
    from students s
    left join auth.users au on au.id = s.profile_id
   where s.status <> 'archived'
     and (s.profile_id is null or au.email_confirmed_at is null);

  select count(*) into v_briefings
    from students s
   where s.status <> 'archived'
     and exists (
       select 1
         from contracts c
         left join student_group_members m on m.group_id = c.student_group_id
        where c.status = 'active'
          and (c.student_id = s.id or m.student_id = s.id))
     and not exists (
       select 1 from briefings b
        where b.student_id = s.id and b.status = 'submitted');

  return jsonb_build_object(
    'convites_pendentes', v_convites,
    'briefings_travados', v_briefings
  );
end;
$$;

comment on function public.admin_home_counts is
  'As DUAS contagens da fila de pendências do Início (sem acesso ao portal / '
  'briefing travado), set-based e sem dado pessoal. Existe para a home não '
  'pagar admin_student_directory() — que faz replay de ledger por contrato — '
  'só para contar.';

revoke execute on function public.admin_home_counts() from public, anon;
grant execute on function public.admin_home_counts() to authenticated, service_role;
