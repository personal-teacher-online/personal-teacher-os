-- ###########################################################################
-- M4-3 · `admin_create_contract` — A PORTA ÚNICA DE CRIAR CONTRATO
-- ###########################################################################
--
-- O QUE ESTA MIGRATION MATA. Criar contrato era, até aqui, escrita solta do
-- app: `createContractAction` fazia um `insert into contracts` pelo PostgREST,
-- e `createGroupContractAction` fazia TRÊS escritas independentes —
-- `student_groups`, `student_group_members`, `contracts` — cada uma na sua
-- própria transação, com `done('Falha…')` no meio. Quando a segunda falhava
-- (membro repetido, aluno apagado) ficava no banco um grupo sem membros; quando
-- a terceira falhava (fuso não confirmado, plano vazio) ficava um grupo com
-- membros e sem contrato — lixo que ninguém vê e que a próxima tentativa
-- duplica. E o wizard de admissão ainda criava os horários fixos DEPOIS, num
-- laço de `create_slot` que podia deixar o contrato de pé com "ajuste depois"
-- no lugar do horário.
--
-- Agora é UMA transação: grupo + membros + contrato + horários fixos + extensão
-- de mentoria. Ou tudo existe, ou nada existe.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, de propósito (Lei 3): ela não reimplementa
-- uma linha de regra. O horário fixo continua nascendo por `public.create_slot`
-- — que é quem confere conflito de agenda (exclusão GiST), horário de contrato
-- em PAUSA (`_assert_no_paused_overlap`), fuso confirmado
-- (`_require_confirmed_tz`), âncora explícita de grupo (P1) e materialização
-- estrita das 8 semanas. A promoção lead→ativo continua sendo o gatilho
-- `contracts_promote_lead` (20260727000400/000500), que também reativa quem
-- estava arquivado e recusa ficha anonimizada. Esta função é a COSTURA, não uma
-- segunda cópia do motor.
--
-- ===========================================================================
-- A ORDEM CANÔNICA GLOBAL DE LOCKS — por que ela continua valendo aqui
-- ===========================================================================
--
-- A lei está escrita no cabeçalho de `20260727000700_ordem_global_de_locks.sql`
-- (andares 1 contracts → 2 class_instances → 3 reschedule_windows →
-- 4 recurring_slots → 5 advisory), com o adendo do c10
-- (`20260727000900_residuais_finais.sql`): dentro do 5º andar a sub-ordem é
-- `makeup_spend → class → teacher_agenda → materialize_slot`, e NENHUMA
-- transação pede linha de `contracts`/`recurring_slots` depois de ter um
-- `teacher_agenda` na mão.
--
-- ESTA FUNÇÃO NÃO PEDE LOCK NENHUM POR CONTA PRÓPRIA. Todos os locks que ela
-- provoca são os que `create_slot` (e, dentro dele, `_assert_no_paused_overlap`
-- e `materialize_slot`) já pede, na ordem que eles já observam:
--
--     contracts FOR UPDATE  →  teacher_agenda:<professora>
--       →  recurring_slots FOR UPDATE  →  materialize_slot:<slot>
--
-- Com DOIS horários fixos, o segundo `create_slot` pede a linha de `contracts`
-- (1º andar) e a de `recurring_slots` (4º) DEPOIS de a transação já ter na mão o
-- `teacher_agenda` do primeiro — o que, lido de fora, parece a inversão que a
-- lei proíbe. NÃO É, e o motivo é a ISENÇÃO já escrita no c8: *linha CRIADA pela
-- própria transação está fora da ordem, porque ninguém mais a enxerga.* As duas
-- linhas em questão são exatamente isso:
--
--   · a linha de `contracts` nasceu no `insert` DESTA função, três instruções
--     acima — nenhuma outra sessão pode estar do outro lado do par;
--   · a linha de `recurring_slots` travada dentro de `materialize_slot` é a que
--     `create_slot` acabou de inserir, na mesma transação (é a mesma isenção que
--     o c10 documenta para `materialize_slot:<slot>` no `create_slot`).
--
-- O único recurso desta transação que outra sessão disputa de verdade é o
-- advisory `teacher_agenda:<professora>` — pedido uma vez (reentrante) e sempre
-- de mãos vazias quanto a linhas de terceiros. Logo: sem ciclo possível.
--
-- ORDEM DAS ESCRITAS, e por que ela é essa:
--   1. grupo e membros ANTES do contrato — o gatilho `contracts_promote_lead`
--      promove os membros da turma lendo `student_group_members`, e o gatilho
--      `contracts_require_confirmed_tz` confere o fuso dos membros. Com o
--      contrato primeiro, os dois olhariam uma turma vazia;
--   2. contrato;
--   3. horários fixos (`create_slot`), que só existem depois de haver contrato;
--   4. extensão de mentoria, que exige o contrato-pai já do tipo certo
--      (`assert_contract_is_mentorship`, com `FOR KEY SHARE` na linha-pai).
--
-- POLÍTICA POR PARÂMETRO, NUNCA POR CAMPO DE TELA (item 12 do veredito do e2e):
-- aviso mínimo, validade do crédito e validade da falha da escola são constantes
-- da ESCOLA. A função as recebe por parâmetro (com o mesmo default que o app
-- usa) porque quem grava a coluna é o banco, mas nenhuma tela nova as pergunta.
-- "Remarcações/mês" continua sendo por aluno.
--
-- Leis tocadas: 1 (fuso — a âncora do grupo viaja explícita para `create_slot`,
-- que resolve o offset do dia; aqui não há aritmética de hora nenhuma), 3 (a
-- regra continua morando no Postgres, e esta função só chama as que já existem),
-- 7 (migration NOVA), 8 (a criação inteira vira UMA linha de `audit_log`, além
-- das que os gatilhos de linha já escrevem), 9 (dinheiro entra em CENTAVOS).

create or replace function public.admin_create_contract(
  -- 'individual' | 'group' | 'mentorship'
  p_kind text,
  -- 1 aluno (individual/mentoria) ou 2+ (casal/turma)
  p_students uuid[],
  p_plan_name text,
  p_hourly_rate_cents int,
  p_teacher uuid default null,
  p_started_on date default null,
  p_group_label text default null,
  p_tz_anchor uuid default null,
  p_allowance int default 4,
  -- POLICY da escola (item 12): parâmetro com o default do app, nunca campo
  p_min_notice int default 24,
  p_expiry_days int default 90,
  p_school_fault_days int default 180,
  -- [{"weekday":2,"local_time":"20:30","duration_min":45}, …]
  p_slots jsonb default '[]'::jsonb,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor     uuid;
  v_kind      text := lower(btrim(coalesce(p_kind, '')));
  v_plan      text := nullif(btrim(coalesce(p_plan_name, '')), '');
  v_label     text := nullif(btrim(coalesce(p_group_label, '')), '');
  v_started   date := coalesce(p_started_on, public.business_today());
  v_students  uuid[];
  v_quantos   int;
  v_group     uuid;
  v_contract  uuid;
  v_anchor_tz text;
  v_slot      jsonb;
  v_slot_ids  uuid[] := array[]::uuid[];
  v_antes     jsonb;
  v_promovidos jsonb;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if v_kind not in ('individual', 'group', 'mentorship') then
    raise exception
      'tipo de contrato desconhecido: % — use individual, group ou mentorship', p_kind;
  end if;

  -- Os alunos, sem nulo e sem repetido: "o casal do Yago com o Yago" não é
  -- turma, e o `distinct` aqui evita transformar isso num erro de FK lá na
  -- frente (a chave de `student_group_members` é o par grupo×aluno).
  select coalesce(array_agg(distinct s), array[]::uuid[])
    into v_students
    from unnest(coalesce(p_students, array[]::uuid[])) s
   where s is not null;
  v_quantos := coalesce(array_length(v_students, 1), 0);

  if v_plan is null then
    raise exception 'o contrato precisa do nome do plano';
  end if;
  if p_hourly_rate_cents is null or p_hourly_rate_cents < 0 then
    raise exception 'o valor da aula (em centavos) é obrigatório e não pode ser negativo';
  end if;

  if v_kind = 'group' then
    if v_quantos < 2 then
      raise exception 'contrato de casal/turma exige pelo menos DOIS alunos diferentes';
    end if;
    if v_label is null then
      raise exception 'contrato de casal/turma exige o nome da turma';
    end if;
    -- P1 (o mesmo gate de `create_slot`, dito antes de qualquer escrita): o
    -- relógio que rege os horários fixos do grupo é uma ESCOLHA declarada,
    -- nunca o `min(iana_tz)` alfabético.
    if p_tz_anchor is null or not (p_tz_anchor = any (v_students)) then
      raise exception
        'contrato de GRUPO exige a âncora de fuso, e ela precisa ser um dos alunos da turma (P1)';
    end if;
  elsif v_quantos <> 1 then
    raise exception 'contrato % é de UM aluno (recebi %)', v_kind, v_quantos;
  end if;

  if v_kind = 'mentorship' and jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) > 0 then
    raise exception
      'contrato de mentoria não tem horário fixo semanal — as sessões são datas publicadas pela escola';
  end if;
  if v_kind <> 'mentorship' and p_teacher is null then
    raise exception 'contrato particular exige a professora';
  end if;

  -- ESTADO DE ANTES, para dizer no fim quem foi PROMOVIDO. A promoção é do
  -- gatilho (`contracts_promote_lead`); o que se faz aqui é lembrar o que era
  -- para poder contar o que mudou — a tela precisa avisar "aluno promovido a
  -- Ativo", e ler o status depois do gatilho sem saber o de antes não distingue
  -- quem já era ativo de quem acabou de virar.
  select coalesce(jsonb_object_agg(s.id::text, s.status), '{}'::jsonb)
    into v_antes
    from students s
   where s.id = any (v_students);
  if (select count(*) from students s where s.id = any (v_students)) <> v_quantos then
    raise exception 'algum aluno informado não existe';
  end if;

  -- 1. grupo + membros (antes do contrato: ver o cabeçalho)
  if v_kind = 'group' then
    insert into student_groups (label) values (v_label) returning id into v_group;
    insert into student_group_members (group_id, student_id)
      select v_group, s from unnest(v_students) s;
  end if;

  -- 2. o contrato. `school_fault_credit_expiry_days` é NOT NULL no schema
  -- (20260718000300), então a mentoria também o carrega — os outros três campos
  -- de remarcação ficam NULL nela, como manda `contracts_private_fields`.
  insert into contracts (
    contract_type, student_id, student_group_id, teacher_id, plan_name,
    hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
    makeup_credit_expiry_days, school_fault_credit_expiry_days,
    started_on, group_tz_anchor_student)
  values (
    (case when v_kind = 'mentorship' then 'mentorship' else 'private_1on1' end)::contract_type,
    (case when v_kind = 'group' then null else v_students[1] end),
    v_group,
    (case when v_kind = 'mentorship' then null else p_teacher end),
    v_plan,
    p_hourly_rate_cents,
    (case when v_kind = 'mentorship' then null else coalesce(p_allowance, 4) end),
    (case when v_kind = 'mentorship' then null else p_min_notice end),
    (case when v_kind = 'mentorship' then null else p_expiry_days end),
    coalesce(p_school_fault_days, 180),
    v_started,
    (case when v_kind = 'group' then p_tz_anchor end))
  returning id into v_contract;

  -- 3. os horários fixos, PELA RPC DE SEMPRE.
  if v_kind = 'group' then
    select s.iana_tz into v_anchor_tz from students s where s.id = p_tz_anchor;
  end if;

  for v_slot in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb))
  loop
    v_slot_ids := v_slot_ids || public.create_slot(
      v_contract,
      (v_slot->>'weekday')::int,
      (v_slot->>'local_time')::time,
      -- individual: `null` faz `create_slot` cair no fuso do aluno (uma fonte
      -- só). Grupo: a âncora declarada, que é o que ele exige.
      v_anchor_tz,
      coalesce((v_slot->>'duration_min')::int, 45),
      -- Vigência do horário: nunca antes de hoje (materializar o passado não
      -- cria aula nenhuma) e nunca antes do início do contrato.
      greatest(v_started, public.business_today()),
      v_actor);
  end loop;

  -- 4. a extensão da mentoria (o gatilho `mentorship_contracts_seed_thresholds`
  -- semeia a régua de progresso padrão). `course_start_date` fica NULL: quem
  -- lança o início do curso é a tela de Mentoria — é dela a pergunta.
  if v_kind = 'mentorship' then
    insert into mentorship_contracts (contract_id) values (v_contract);
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', s.id, 'nome', s.display_name, 'de', v_antes->>s.id::text)),
           '[]'::jsonb)
    into v_promovidos
    from students s
   where s.id = any (v_students)
     and s.status = 'active'
     and coalesce(v_antes->>s.id::text, '') in ('lead', 'archived');

  perform public.log_audit(v_actor, 'admin_create_contract', 'contracts', v_contract::text,
    jsonb_build_object(
      'kind', v_kind,
      'students', to_jsonb(v_students),
      'group_id', v_group,
      'group_label', v_label,
      'tz_anchor', p_tz_anchor,
      'teacher_id', (case when v_kind = 'mentorship' then null else p_teacher end),
      'plan_name', v_plan,
      'hourly_rate_cents', p_hourly_rate_cents,
      'allowance', (case when v_kind = 'mentorship' then null else coalesce(p_allowance, 4) end),
      'policy', jsonb_build_object('min_notice', p_min_notice, 'expiry_days', p_expiry_days,
                                   'school_fault_days', coalesce(p_school_fault_days, 180)),
      'started_on', v_started,
      'slots', to_jsonb(v_slot_ids),
      'promoted', v_promovidos));

  return jsonb_build_object(
    'contract_id', v_contract,
    'group_id', v_group,
    'slot_ids', to_jsonb(v_slot_ids),
    'promoted', v_promovidos);
end;
$fn$;

comment on function public.admin_create_contract(text, uuid[], text, int, uuid, date, text, uuid,
                                                 int, int, int, int, jsonb, uuid) is
  'M4-3: cria contrato numa transação só — turma + membros (casal/grupo), o '
  'contrato (private_1on1 ou mentorship) e os horários fixos, estes CHAMANDO '
  'public.create_slot (nenhuma regra de agenda, fuso ou pausa é reimplementada '
  'aqui). Gate admin, auditoria na transação, política por parâmetro (item 12). '
  'Devolve {contract_id, group_id, slot_ids, promoted} — `promoted` é quem o '
  'gatilho tirou de lead/arquivado para ativo.';

revoke execute on function public.admin_create_contract(text, uuid[], text, int, uuid, date, text,
                                                        uuid, int, int, int, int, jsonb, uuid)
  from public, anon;
grant execute on function public.admin_create_contract(text, uuid[], text, int, uuid, date, text,
                                                       uuid, int, int, int, int, jsonb, uuid)
  to authenticated;
