-- Fase 3 / M2 — Agenda da professora via VIEW ENXUTA do owner (ADR-010 §1).
-- O painel precisa do NOME do aluno, e o caminho natural (embed via contracts)
-- morreu com o DROP de contracts_teacher (M0.4 — a linha de contracts carrega
-- hourly_rate_cents/plan_name). Esta view expõe SÓ o que a agenda mostra,
-- filtrada por my_teacher_id() (avaliado com o JWT do CHAMADOR) — mesmo padrão
-- de payments_student/teacher_public. NUNCA reabrir a tabela contracts.

-- Painel final F3 (editado in-place — 20260713* não aplicadas; Lei 7 ok):
--  (a) papel exigido: my_teacher_id() sozinho deixaria uma conta de QUALQUER papel
--      vinculada por engano a teachers ler a agenda; admin permanece no predicado
--      (a dona é admin vinculada — F3-D1b);
--  (b) aula 'scheduled' de contrato PAUSADO some da agenda — a instância só volta
--      (ou é cancelada) na retomada; mostrá-la afirmaria uma aula que a pausa
--      suspendeu (mesma verdade do extrato: _teacher_payable_hours não a paga).
create view teacher_agenda as
  select i.id,
         i.starts_at_utc,
         i.ends_at_utc,
         i.state,
         i.local_time_snapshot,
         i.contract_id,
         coalesce(s.display_name, g.label) as student_label
    from class_instances i
    join contracts c on c.id = i.contract_id
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where i.teacher_id = (select public.my_teacher_id())
     and (select public.app_role()) in ('teacher', 'admin')
     and not (i.state = 'scheduled' and c.status = 'paused');

comment on view teacher_agenda is
  'Agenda enxuta da professora logada (F3-D7/M2). Sem dados de contrato — '
  'hourly_rate_cents/plan_name jamais nesta view (ADR-010 §1). Exige papel '
  'teacher/admin e esconde scheduled de contrato pausado (painel final F3).';

grant select on teacher_agenda to authenticated;
