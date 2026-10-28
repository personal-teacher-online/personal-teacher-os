-- PORTEIRO DE PAPEL NAS DUAS PORTAS DO BRIEFING BASE (varredura de onda do
-- Portal, achado V3 — 28/07/2026).
--
-- O DEFEITO. `save_briefing_draft()` e `submit_briefing()` nasceram em
-- 20260720000100 confiando inteiramente em `_briefing_session_student()`, que
-- pergunta uma coisa só: "esta conta tem linha em `students`?". Quem responde
-- "sim" escreve. Só que TER linha em `students` não é o mesmo que SER aluno: a
-- professora que também estuda na escola, ou a conta de vendas cadastrada como
-- aluna para testar o portal, tem as duas coisas — e escrevia o briefing pela
-- porta do aluno com um JWT de `teacher`/`sales`. É exatamente o buraco que o
-- P3 fechou no extrato de créditos (`_extrato_de_creditos_permitido`, migration
-- 20260728000500) e que esta onda fechou nas RPCs do re-briefing
-- (20260728000300): o escopo por `auth.uid()` decide QUAIS linhas; o PAPEL
-- decide quem tem direito de perguntar. Faltavam estas duas.
--
-- O QUE MUDA: uma guarda de papel no topo de cada função. Nada mais. A
-- validação, o merge do rascunho, o gabarito do Kolb, a auditoria e as mensagens
-- continuam LETRA POR LETRA como estavam — quem escreve regra de briefing é a
-- 20260720000100 e a 20260728000100 (`_briefing_submit`), não esta migration.
--
-- Por que 'student' e não ('student','admin'): a retaguarda da admin já existe e
-- é OUTRA função — `admin_fill_briefing(p_student, …)`, que recebe de QUEM é o
-- briefing. `submit_briefing()` não tem parâmetro: ela submeteria o briefing da
-- linha de `students` da PRÓPRIA admin, que não existe. Deixar a admin entrar
-- por aqui seria abrir uma porta que não leva a lugar nenhum.
--
-- Lei 7: migration NOVA. A 20260720000100 é imutável (aplicada em produção) e
-- não foi tocada — as duas funções abaixo são CREATE OR REPLACE do corpo vivo.

-- ---------------------------------------------------------------------------
-- RPC: rascunho do PRÓPRIO aluno (merge por etapa; livre até o envio)
-- ---------------------------------------------------------------------------
create or replace function public.save_briefing_draft(
  p_answers jsonb default null,
  p_kolb_answers jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
begin
  -- ↓ a ÚNICA linha nova (com a atribuição de v_student movida para depois dela,
  --   para o papel ser conferido antes de qualquer leitura de cadastro).
  if (select public.app_role()) <> 'student' then
    raise exception 'sem acesso ao briefing';
  end if;
  v_student := public._briefing_session_student();

  insert into briefings (student_id, answers, kolb_answers, filled_by)
  values (v_student, coalesce(p_answers, '{}'::jsonb), coalesce(p_kolb_answers, '{}'::jsonb), auth.uid())
  on conflict (student_id) do update
    set answers = briefings.answers || coalesce(excluded.answers, '{}'::jsonb),
        kolb_answers = briefings.kolb_answers || coalesce(excluded.kolb_answers, '{}'::jsonb),
        filled_by = auth.uid(),
        updated_at = now()
    where briefings.status = 'draft';
  if exists (select 1 from briefings where student_id = v_student and status = 'submitted') then
    raise exception 'briefing já enviado — alterações só pelo atendimento';
  end if;
end;
$$;
revoke execute on function public.save_briefing_draft(jsonb, jsonb) from public, anon;
grant execute on function public.save_briefing_draft(jsonb, jsonb) to authenticated;

comment on function public.save_briefing_draft(jsonb, jsonb) is
  'Rascunho do briefing do PRÓPRIO aluno (merge por etapa). Porteiro de papel desde 28/07/2026: exige app_role() = ''student'' — ter linha em students não basta (conta teacher/sales com cadastro duplo). A retaguarda da admin é admin_fill_briefing.';

-- ---------------------------------------------------------------------------
-- RPC: envio do PRÓPRIO aluno (valida tudo, calcula Kolb, trava)
-- ---------------------------------------------------------------------------
create or replace function public.submit_briefing()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select public.app_role()) <> 'student' then
    raise exception 'sem acesso ao briefing';
  end if;
  return public._briefing_submit(public._briefing_session_student(), auth.uid());
end;
$$;
revoke execute on function public.submit_briefing() from public, anon;
grant execute on function public.submit_briefing() to authenticated;

comment on function public.submit_briefing() is
  'Envio do briefing do PRÓPRIO aluno (valida, tabula o Kolb e trava). Porteiro de papel desde 28/07/2026: exige app_role() = ''student''. Admin envia pelo admin_fill_briefing(p_student, …, p_finalize => true).';
