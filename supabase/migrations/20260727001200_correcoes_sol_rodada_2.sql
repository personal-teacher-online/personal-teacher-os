-- ###########################################################################
-- LOTE c12 · AS CORREÇÕES DE BANCO DA RODADA 2 DO SOL (M4 + M5)
-- ###########################################################################
--
-- Migration NOVA (Lei 7): nada aqui edita a `20260727001100`, nem nenhuma
-- outra. Tudo entra por `create or replace` / `alter table`.
--
-- OS CINCO ACHADOS QUE ESTE ARQUIVO FECHA (numeração do relatório do Sol):
--
--  nº 1 (GRAVE) · CONFLITO ATIVO×ATIVO ALÉM DO HORIZONTE DE MATERIALIZAÇÃO.
--       `create_slot` materializa OITO SEMANAS a partir de hoje
--       (`materialize_slot`: `v_end_date := v_hoje + p_weeks*7`), e a única
--       guarda de agenda ativa×ativa é a exclusão GiST — que só enxerga aula
--       MATERIALIZADA. Dois contratos ativos com `started_on` além de hoje+56
--       nascem com o MESMO horário da MESMA professora sem que nada recuse: o
--       índice único de `recurring_slots` é por CONTRATO, e
--       `_assert_no_paused_overlap` (20260727000900:105) só olha contrato
--       PAUSADO. A escola só descobre quando o lote diário alcança a data — e
--       aí já há duas pessoas com a mesma hora vendida.
--       CORREÇÃO: `_assert_no_active_overlap`, o irmão do de pausados, com a
--       MESMA matemática de fuso (`(date + local_time) at time zone iana_tz`,
--       offset do dia específico — Lei 1) e 365 dias de expansão, chamado por
--       `create_slot`.
--
--  nº 2 (GRAVE) · ORDEM DE LOCKS NÃO DETERMINÍSTICA NA PROMOÇÃO DE TURMA.
--       `promote_lead_on_contract` (20260727000500:365) percorre os membros
--       SEM `order by`, e cada `_promote_lead` pede `students … for update`.
--       Duas turmas com membros em comum, criadas ao mesmo tempo, podem pedir
--       as linhas em ordens opostas — deadlock clássico. A migration
--       `20260727001100` (`admin_create_contract`) ASSUMIU essa premissa ao
--       argumentar que "sem ciclo possível": o argumento cobria os locks que a
--       própria função pede, e não os que o GATILHO pede por baixo dela. Aqui
--       a premissa deixa de ser suposição: o laço passa a ser `order by
--       student_id`, que é a ordem total que faltava.
--       ⚠️ E O `order by` SOZINHO NÃO BASTOU — o teste de concorrência que o
--       lote exigia deu `deadlock detected` em 4 rodadas de 4 mesmo com ele. A
--       causa medida é OUTRA, e mais funda: ESCALADA DE LOCK. A chave
--       estrangeira de `student_group_members` pega `FOR KEY SHARE`
--       (compartilhado) no aluno que as duas turmas têm em comum, as duas
--       transações o obtêm sem esperar, e só então cada uma tenta subir para o
--       `FOR UPDATE` de `_promote_lead` — cada uma esperando a outra soltar o
--       compartilhado. Nenhuma ordenação conserta isso; o que conserta é não
--       escalar. `admin_create_contract` passa a travar as linhas de `students`
--       EXCLUSIVAMENTE e em ordem total, antes de qualquer escrita (a segunda
--       parte do nº 2, lá embaixo). Com as duas correções: 20 rodadas, zero
--       deadlock.
--
--  nº 3 · DURAÇÃO SANA SÓ EXISTIA NO TYPESCRIPT (Lei 3). `15..480` era regra
--       de Zod (`src/data/admin/contrato-novo.ts:160`) e de `min`/`step` de
--       campo — o banco aceitava `duration_min = 3` ou `= 100000` por qualquer
--       outra porta (RPC direta, import, correção manual). Vira CHECK.
--       Conferido na bancada antes de escrever: `min(duration_min) = 45`,
--       `max = 60`, zero linha fora da faixa.
--
--  nº 4 · `admin_create_contract` ACEITAVA PROFESSORA ARQUIVADA. A RPC da aula
--       experimental (20260727001000:109) já recusa com nome
--       ("professora % não existe ou está arquivada"); a porta única de criar
--       contrato, não — dava para matricular um aluno com uma professora que
--       saiu da escola. Espelho exato daquela recusa.
--
--  nº 10 · `admin_renew_contract` PERMITIA VIRADA ANTES DO INÍCIO DO CONTRATO
--       VELHO. A função conferia a janela `hoje .. hoje+56`, mas não o começo
--       do que está sendo renovado: com um contrato que só começa daqui a um
--       mês, uma virada para HOJE produzia linhagem invertida — o novo
--       `started_on` antes do velho, e o velho encerrado com
--       `ended_on = greatest(virada-1, started_on)`, isto é, encerrado no dia
--       em que começa. Passa a exigir `p_switch_on >= v_old.started_on`.
--
--  nº 11 · R$0 DIVERGENTE ENTRE PORTAS — DECISÃO DO ORQUESTRADOR: cortesia
--       (valor zero) é caso LEGÍTIMO (S2-15). `admin_create_contract` já
--       aceitava 0 (`< 0` recusa); `admin_renew_contract` recusava
--       (`<= 0`). Quem fica é o zero: renovar em cortesia é o mesmo fato que
--       criar em cortesia. Negativo continua recusado nas duas.
--
-- ORDEM CANÔNICA DE LOCKS — o que este arquivo acrescenta e por que não fura.
-- A lei está em `20260727000700_ordem_global_de_locks.sql` (1 contracts →
-- 2 class_instances → 3 reschedule_windows → 4 recurring_slots → 5 advisory),
-- com o adendo do c10 (sub-ordem `makeup_spend → class → teacher_agenda →
-- materialize_slot`). `_assert_no_active_overlap` pede EXATAMENTE UM recurso: o
-- advisory `teacher_agenda:<professora>` — o mesmo que `_assert_no_paused_overlap`
-- já pediu na mesma chamada de `create_slot` (advisory transacional é
-- reentrante: a segunda tomada é no-op). Depois dele a função só LÊ, sem `for
-- update`: nenhuma linha de `contracts` ou `recurring_slots` é PEDIDA com o
-- advisory na mão, que é o que a lei proíbe.
--
-- Leis tocadas: 1 (fuso — a expansão dos 365 dias resolve o offset DAQUELE dia,
-- nunca offset fixo), 3 (a régua da duração desce para o Postgres; a guarda
-- ativa×ativa nasce no banco, não na tela), 7 (migration NOVA), 8 (a auditoria
-- das funções tocadas continua intacta), 9 (nada de dinheiro muda de unidade).


-- ###########################################################################
-- nº 1 · `_assert_no_active_overlap` — o que a exclusão GiST não alcança
-- ###########################################################################
--
-- POR QUE UMA FUNÇÃO NOVA, e não uma generalização de `_assert_no_paused_overlap`:
-- as duas perguntas parecem irmãs e não são a mesma. A do PAUSADO é "existe
-- contrato parado cujo horário volta a valer quando ele for retomado?" — e a
-- resposta vale para TODO dia da janela, porque contrato pausado não tem
-- instância NENHUMA. A daqui é mais estreita: contrato ATIVO tem instância, e
-- onde há instância quem manda é a exclusão GiST. Espremer as duas numa função
-- só significaria um `if` de regime dentro de cada CTE — e um dos dois regimes
-- ficaria errado no primeiro ajuste. Elas compartilham a matemática (a expansão
-- por dia com o offset daquele dia), não a fronteira.
--
-- A FRONTEIRA, dita em uma linha: esta função só compara os dias em que a
-- exclusão GiST NÃO pôde dar palpite — isto é, os dias em que o horário fixo do
-- outro contrato AINDA NÃO TEM aula materializada. Onde já existe aula daquele
-- dia, quem decidiu foi o banco:
--   · aula `scheduled`/`completed` → a GiST já teria recusado a que colide;
--   · aula `cancelled` → o dia está LIVRE de verdade (é a mesma régua do
--     gatilho `class_instances_horario_em_pausa` e da própria GiST, que só olha
--     scheduled/completed), e reclamar dele aqui seria inventar um conflito que
--     o resto da casa não reconhece.
-- É por isso que o `not exists` abaixo não filtra por `state`: a pergunta é
-- "esse dia já passou pelo crivo da agenda?", não "esse dia está ocupado?".
--
-- 365 DIAS, e o mesmo número do irmão pausado (20260727000900:159–162): é a
-- vigência comum de um contrato de aula, e é o horizonte além do qual "reservar
-- agenda" deixa de ser uma promessa que a escola faz. Contrato que só começa
-- depois disso não tem horário fixo defensável — e o lote diário alcança a data
-- muito antes.
--
-- CUSTO: uma expansão de no máximo 366 dias × (horários vivos daquela
-- professora). Na escala-alvo (5 professoras, ~10 horários cada) são algumas
-- centenas de faixas por chamada, e `create_slot` é ato raro e interativo.

create or replace function public._assert_no_active_overlap(
  p_teacher uuid,
  p_slot uuid)
returns void
language plpgsql
volatile              -- pede lock; lock é efeito (mesma correção do c10 · T2)
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_novo recurring_slots%rowtype;
  v_de   date;
  v_ate  date;
  v_hit  record;
begin
  if p_teacher is null or p_slot is null then
    return;
  end if;

  -- 5º andar da ordem canônica, e o MESMO recurso que `_assert_no_paused_overlap`
  -- e `pause_contract` disputam: a agenda daquela professora. Reentrante — na
  -- chamada de `create_slot` a transação já o tem na mão. Vem ANTES da leitura
  -- porque é ele que serializa duas criações simultâneas: em READ COMMITTED, a
  -- consulta que roda DEPOIS do lock abre snapshot novo e enxerga o horário que
  -- a outra transação acabou de commitar (mesmo mecanismo do P4 da revisão 8).
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  select * into v_novo from recurring_slots where id = p_slot;
  if not found then
    return;
  end if;

  -- Horário de contrato que NÃO está ativo não disputa agenda nenhuma: o
  -- pausado tem guarda própria (com mensagem própria) e o encerrado não volta.
  if not exists (
    select 1 from contracts c where c.id = v_novo.contract_id and c.status = 'active'
  ) then
    return;
  end if;

  -- PORTA BARATA: sem outro horário vivo desta professora não há o que comparar.
  if not exists (
    select 1
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id and c.status = 'active'
     where rs.teacher_id = p_teacher
       and rs.id <> p_slot
       and (rs.active_to is null or rs.active_to >= public.business_today())
  ) then
    return;
  end if;

  v_de := greatest(v_novo.active_from, public.business_today());
  v_ate := least(coalesce(v_novo.active_to, 'infinity'::date), v_de + 365);
  if v_de > v_ate then
    return;
  end if;

  with dias as (
    select g::date as dia
      from generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') g
  ),
  novo as (
    -- o horário que está nascendo, ocorrência a ocorrência, com o offset
    -- DAQUELE dia específico (Lei 1 — nada de offset fixo)
    select tstzrange(
             (d.dia + v_novo.local_time) at time zone v_novo.iana_tz,
             ((d.dia + v_novo.local_time) at time zone v_novo.iana_tz)
               + make_interval(mins => v_novo.duration_min)) as faixa
      from dias d
     where extract(dow from d.dia)::int = v_novo.weekday
  ),
  vivos as (
    select rs.contract_id,
           coalesce(s.display_name, g.label,
                    'contrato ' || left(rs.contract_id::text, 8)) as quem,
           d.dia,
           tstzrange(
             (d.dia + rs.local_time) at time zone rs.iana_tz,
             ((d.dia + rs.local_time) at time zone rs.iana_tz)
               + make_interval(mins => rs.duration_min)) as faixa
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id and c.status = 'active'
      left join students s on s.id = c.student_id
      left join student_groups g on g.id = c.student_group_id
      cross join dias d
     where rs.teacher_id = p_teacher
       and rs.id <> p_slot
       and extract(dow from d.dia)::int = rs.weekday
       and d.dia >= rs.active_from
       and (rs.active_to is null or d.dia <= rs.active_to)
       -- A FRONTEIRA (ver o cabeçalho): só o dia que a exclusão GiST ainda não
       -- pôde julgar, porque não há aula daquele horário fixo naquele dia.
       and not exists (
             select 1 from class_instances ci
              where ci.slot_id = rs.id and ci.occurrence_date = d.dia)
  )
  -- Sem `n.dia = v.dia` de propósito: fusos diferentes fazem uma terça 20:30 de
  -- Lisboa cair na terça 16:30 de Cuiabá — e, perto da meia-noite, no dia
  -- seguinte. Quem decide sobreposição é a FAIXA em UTC, nunca a data civil.
  select v.contract_id, v.quem, v.dia into v_hit
    from vivos v
    join novo n on n.faixa && v.faixa
   order by v.dia
   limit 1;

  if v_hit.contract_id is not null then
    -- `exclusion_violation` é o errcode certo: é a mesma natureza de recusa da
    -- GiST (duas coisas não cabem no mesmo lugar) e é o que o PostgREST traduz
    -- em 409. O HINT distingue ESTE choque dos outros dois para quem lê o
    -- diagnóstico (o materializador usa o mesmo mecanismo com `horario-em-pausa`).
    raise exception
      'a professora já tem este horário em outro contrato ATIVO (%) — primeiro dia de choque: %. A agenda só é materializada 8 semanas à frente, então a aula ainda não existe, mas o horário está vendido',
      v_hit.quem, to_char(v_hit.dia, 'DD/MM/YYYY')
      using errcode = 'exclusion_violation', hint = 'horario-alem-do-horizonte';
  end if;
end;
$fn$;

comment on function public._assert_no_active_overlap(uuid, uuid) is
  'c12 · achado nº 1 do Sol: recusa horário fixo que choca com o horário fixo de '
  'outro contrato ATIVO da mesma professora nos dias que a exclusão GiST não '
  'alcança — os que ainda não têm aula materializada (o horizonte de `create_slot` '
  'é de 8 semanas; a vigência de um contrato, não). Expande 365 dias com o offset '
  'do dia específico (Lei 1) e pede o advisory `teacher_agenda:<professora>`, o '
  'mesmo recurso do irmão pausado.';

revoke execute on function public._assert_no_active_overlap(uuid, uuid)
  from public, anon, authenticated, service_role;


-- ###########################################################################
-- nº 1 (parte 2) · `create_slot` passa pela guarda nova
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (20260727000800 · c8 · R1, com o P6 da revisão
-- nº 8) com UMA chamada a mais. Lei 7: as migrations antigas não foram tocadas.
--
-- A CHAMADA VEM DEPOIS DE `materialize_slot`, e a ordem é deliberada: dentro do
-- horizonte quem recusa é a exclusão GiST, com a mensagem que a dona já
-- conhece ("a professora já tem aula em DD/MM às HH:MM"). Pôr a guarda nova
-- antes trocaria a mensagem do caso comum por outra, sem ganhar nada — a nova
-- só tem o que dizer sobre o que a GiST não viu.

create or replace function public.create_slot(
  p_contract uuid,
  p_weekday integer,
  p_local_time time without time zone,
  p_iana_tz text default null::text,
  p_duration_min integer default 45,
  p_active_from date default public.business_today(),
  p_actor uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_contract contracts%rowtype;
  v_tz text;
  v_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- c8 · R1: a linha do contrato é o 1º andar da ordem canônica.
  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'slots são de contratos private_1on1';
  end if;

  -- P6 (revisão nº 8): horário fixo de contrato de verdade exige fuso
  -- confirmado. O experimental fica de fora, como no gatilho de contrato.
  if not coalesce(v_contract.is_trial, false) then
    perform public._require_confirmed_tz(v_contract.student_id, v_contract.student_group_id);
  end if;

  -- P1: individual cai no fuso do aluno; GRUPO exige âncora explícita — o
  -- min(iana_tz) alfabético saiu (a UI oferece o fuso do membro-âncora).
  v_tz := coalesce(
    p_iana_tz,
    (select s.iana_tz from students s where s.id = v_contract.student_id));
  if v_tz is null and v_contract.student_group_id is not null then
    raise exception 'contrato de GRUPO exige a âncora de fuso explícita (p_iana_tz) — P1/M4-1';
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA do slot — informe p_iana_tz';
  end if;

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  -- c9 · S2: a guarda do horário PAUSADO, em modo RECORRENTE (12 meses),
  -- excluindo só o slot recém-criado.
  perform public._assert_no_paused_overlap(v_contract.teacher_id, v_id);

  -- E3a: ESTRITO. Este é o caminho interativo (wizard de admissão e ação avulsa
  -- da ficha): conflito de agenda derruba a transação inteira em vez de deixar
  -- um horário fixo com semanas faltando e a tela dizendo "criado ✓".
  perform public.materialize_slot(v_id, 8, true);

  -- NOVO (c12 · nº 1): e a guarda do horário ATIVO ALÉM DO HORIZONTE, que é o
  -- que sobra depois que a GiST falou sobre as 8 semanas materializadas.
  perform public._assert_no_active_overlap(v_contract.teacher_id, v_id);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$function$;

comment on function public.create_slot(uuid, integer, time without time zone, text, integer, date, uuid) is
  'Cria o horário fixo e materializa as 8 semanas em modo ESTRITO. Três guardas '
  'de agenda, nesta ordem: contrato em PAUSA (`_assert_no_paused_overlap`), '
  'exclusão GiST via `materialize_slot` (o que já é aula) e contrato ATIVO além '
  'do horizonte materializado (`_assert_no_active_overlap`, c12 · nº 1).';


-- ###########################################################################
-- nº 2 · A PROMOÇÃO DE TURMA PEDE AS LINHAS EM ORDEM TOTAL
-- ###########################################################################
--
-- Corpo COPIADO de 20260727000500:339 com UMA cláusula a mais (`order by
-- m.student_id`). O laço chama `_promote_lead`, que faz `select … from students
-- … for update` — sem ordem, duas transações criando turmas com membros em
-- comum podem pedir as mesmas linhas em ordens opostas e travar uma na outra.
--
-- Por que `student_id` e não outra chave: é a coluna que `_promote_lead`
-- efetivamente trava, e ordem de lock tem de ser a ordem DO RECURSO, não a de
-- quem o pede. `uuid` tem ordem total no Postgres, então qualquer par de
-- transações concorrentes concorda sobre quem vem primeiro.
--
-- ISTO CONSERTA A PREMISSA QUE A `20260727001100` ASSUMIU. O cabeçalho daquela
-- migration prova "sem ciclo possível" para os locks que `admin_create_contract`
-- pede por conta própria — e a prova está certa. O que ela não cobria é o que os
-- GATILHOS pedem por baixo: `contracts_promote_lead` dispara no `insert into
-- contracts` da própria função e, a partir dali, trava uma linha de `students`
-- por membro. Com duas turmas compartilhando alunos (o casal que também estuda
-- num trio, caso real da escola), a criação simultânea batia. Depois desta
-- migration a afirmação daquele cabeçalho passa a valer inteira.

create or replace function public.promote_lead_on_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_member uuid;
begin
  -- experimental é ETAPA do funil, não matrícula
  if coalesce(new.is_trial, false) then
    return new;
  end if;
  -- P8: contrato que nasce encerrado é registro de passado, não matrícula.
  if new.status = 'ended' then
    return new;
  end if;

  if new.student_id is not null then
    perform public._promote_lead(new.student_id, 'contract', new.id);
  elsif new.student_group_id is not null then
    -- P4: a porta comum com o gatilho de membros.
    perform pg_advisory_xact_lock(
      hashtextextended('student_group:' || new.student_group_id::text, 0));
    -- Contrato de TURMA: promove quem já está na turma. Quem entrar depois é
    -- pego pelo gatilho de `student_group_members`.
    for v_member in
      select m.student_id from student_group_members m
       where m.group_id = new.student_group_id
       -- NOVO (c12 · nº 2): ordem TOTAL das linhas de `students` que
       -- `_promote_lead` vai travar. Sem ela, duas turmas com membros em comum
       -- criadas ao mesmo tempo podem pedi-las em ordens opostas.
       order by m.student_id
    loop
      perform public._promote_lead(v_member, 'group_contract', new.id);
    end loop;
  end if;

  return new;
end;
$fn$;

comment on function public.promote_lead_on_contract() is
  'Gatilho que promove lead→ativo quando nasce contrato de verdade. Percorre os '
  'membros da turma em `order by student_id` (c12 · nº 2): é a ordem total das '
  'linhas de `students` que `_promote_lead` trava, e sem ela duas turmas com '
  'membros em comum podiam deadlockar.';

revoke execute on function public.promote_lead_on_contract()
  from public, anon, authenticated, service_role;


-- ###########################################################################
-- nº 3 · DURAÇÃO SANA VIRA REGRA DO BANCO (Lei 3)
-- ###########################################################################
--
-- `15..480` (quinze minutos a oito horas) é a mesma faixa que o Zod do wizard já
-- exige. A diferença é que agora ela vale para TODA porta — RPC chamada direto,
-- import, correção manual —, e não só para quem passa pela tela.
--
-- Conferido na bancada ANTES de escrever (`select min, max, count(*) filter
-- (where duration_min not between 15 and 480) from recurring_slots`): 22 linhas,
-- mínimo 45, máximo 60, ZERO fora da faixa. Nada foi afrouxado para caber.

alter table recurring_slots
  add constraint recurring_slots_duration_sane
  check (duration_min between 15 and 480);

comment on constraint recurring_slots_duration_sane on recurring_slots is
  'c12 · nº 3: a faixa que só existia no Zod do wizard (15 min a 8 h) desce para '
  'o Postgres, onde regra mora (Lei 3).';


-- ###########################################################################
-- nº 4 + nº 11 · `admin_create_contract` recusa professora ARQUIVADA
-- ###########################################################################
--
-- Corpo COPIADO de 20260727001100 com UM bloco a mais (e um comentário no
-- lugar onde o zero é decidido). Lei 7: aquela migration não foi tocada.

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
  -- nº 11 (decisão do orquestrador, c12): ZERO é CORTESIA, e cortesia é caso
  -- legítimo da escola (S2-15) — aula de graça para indicação, mês de ajuste,
  -- aluno de teste da dona. Só o NEGATIVO é recusado, e a mesma régua passa a
  -- valer em `admin_renew_contract` (que recusava o zero) e na admissão.
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

  -- NOVO (c12 · nº 4): PROFESSORA ARQUIVADA NÃO RECEBE ALUNO. `teachers` tem
  -- `archived_at` desde a saída documentada de professora, e a RPC da aula
  -- experimental (20260727001000) já recusava com esta mesma frase — a porta
  -- ÚNICA de criar contrato não podia ser a mais frouxa das duas. Sem isto,
  -- matricular alguém com quem já saiu da escola era um `insert` bem-sucedido
  -- que só aparecia na primeira aula sem professora.
  if p_teacher is not null and not exists (
    select 1 from teachers t where t.id = p_teacher and t.archived_at is null
  ) then
    raise exception 'professora % não existe ou está arquivada', p_teacher;
  end if;

  -- =========================================================================
  -- nº 2 (parte 2) · AS LINHAS DE `students` SÃO TRAVADAS AQUI, EM ORDEM, E
  --                  ANTES DE QUALQUER ESCRITA
  -- =========================================================================
  --
  -- O `order by` do gatilho (parte 1) era necessário e NÃO era suficiente. O
  -- deadlock medido na bancada (4 rodadas em 4, duas turmas com um aluno em
  -- comum criadas em paralelo) é de ESCALADA DE LOCK, e escalada não se conserta
  -- com ordem:
  --
  --   1. `insert into student_group_members` dispara a checagem de chave
  --      estrangeira, que pega `FOR KEY SHARE` na linha do aluno. Lock
  --      COMPARTILHADO: as duas transações o obtêm ao mesmo tempo no aluno que
  --      as duas turmas têm em comum, e nenhuma espera;
  --   2. logo depois, o gatilho `contracts_promote_lead` chama `_promote_lead`,
  --      que faz `select … for update` NA MESMA LINHA. Lock EXCLUSIVO: cada uma
  --      precisa que a OUTRA solte o compartilhado que já tem na mão;
  --   3. as duas esperam a outra commitar. `deadlock detected`
  --      (*"Process A waits for ShareLock on transaction B; blocked by process
  --      B"* e o simétrico).
  --
  -- Nenhuma ordenação resolve isso: quando a primeira tenta subir de
  -- compartilhado para exclusivo, a segunda JÁ TEM o compartilhado. O que
  -- resolve é não escalar — pegar o lock EXCLUSIVO primeiro, antes do
  -- compartilhado, e em ordem total (`order by s`), que é o que esta consulta
  -- faz. Depois disso o `FOR KEY SHARE` da FK e o `FOR UPDATE` do gatilho são
  -- reaquisições da mesma transação, e não esperam por ninguém.
  --
  -- VALE PARA TODO TIPO, não só grupo: no contrato individual a FK
  -- `contracts.student_id` pega o mesmo `FOR KEY SHARE`, e dois contratos
  -- nascendo ao mesmo tempo para o MESMO aluno (a segunda matrícula, o contrato
  -- de mentoria criado junto do particular) fecham o mesmo ciclo.
  --
  -- ORDEM CANÔNICA: `students` não está na escada (1 contracts → … → 5 advisory),
  -- e este é o PRIMEIRO lock que a função pede — antes da linha de `contracts`
  -- que ela mesma vai criar e antes de qualquer advisory. Andar novo no topo não
  -- inverte nada do que existe; o que ele exige é que ninguém pegue `students`
  -- DEPOIS de um andar de baixo, e a única função que o faz é `_promote_lead`,
  -- chamada pelos gatilhos DESTA transação, que já os têm.
  perform 1 from students where id = any (v_students) order by id for update;

  -- ESTADO DE ANTES, para dizer no fim quem foi PROMOVIDO.
  select coalesce(jsonb_object_agg(s.id::text, s.status), '{}'::jsonb)
    into v_antes
    from students s
   where s.id = any (v_students);
  if (select count(*) from students s where s.id = any (v_students)) <> v_quantos then
    raise exception 'algum aluno informado não existe';
  end if;

  -- 1. grupo + membros (antes do contrato: ver o cabeçalho da 20260727001100)
  if v_kind = 'group' then
    insert into student_groups (label) values (v_label) returning id into v_group;
    insert into student_group_members (group_id, student_id)
      select v_group, s from unnest(v_students) s;
  end if;

  -- 2. o contrato.
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
      v_anchor_tz,
      coalesce((v_slot->>'duration_min')::int, 45),
      greatest(v_started, public.business_today()),
      v_actor);
  end loop;

  -- 4. a extensão da mentoria.
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
  'M4-3 + c12: cria contrato numa transação só — turma + membros (casal/grupo), o '
  'contrato (private_1on1 ou mentorship) e os horários fixos, estes CHAMANDO '
  'public.create_slot. Gate admin, auditoria na transação, política por parâmetro '
  '(item 12). Recusa professora ARQUIVADA (c12 · nº 4) e aceita valor ZERO como '
  'cortesia, recusando só o negativo (c12 · nº 11).';


-- ###########################################################################
-- nº 10 + nº 11 · `admin_renew_contract`: virada nunca antes do início, e
--                 cortesia (R$0) aceita
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (c8 · R1 + P13) com DUAS mudanças, ambas
-- marcadas no lugar.

create or replace function public.admin_renew_contract(
  p_old uuid,
  p_switch_on date,
  p_plan_name text,
  p_hourly_rate_cents integer,
  p_allowance integer,
  p_min_notice integer,
  p_expiry_days integer,
  p_school_fault_days integer,
  p_actor uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_new uuid;
  v_slot record;
  v_slots_copied int := 0;
  v_cancelled uuid[] := array[]::uuid[];
  v_live record;
  v_transferred int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_renew_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_old for update;
  if not found then
    raise exception 'contrato % não existe', p_old;
  end if;
  if v_old.contract_type <> 'private_1on1' or v_old.status <> 'active' then
    raise exception 'renovação exige contrato particular ATIVO (pausado: retome antes)';
  end if;
  if p_switch_on < public.business_today() then
    raise exception 'a virada (%) não pode ficar no passado', p_switch_on;
  end if;
  -- P13: o limite documentado vira comportamento PROVADO.
  if p_switch_on > public.business_today() + 56 then
    raise exception 'a virada precisa estar a no máximo 8 semanas (recebido %)', p_switch_on;
  end if;
  -- NOVO (c12 · nº 10): a virada também não pode ficar antes do INÍCIO do
  -- contrato que está sendo renovado. Sem isto, renovar hoje um contrato que só
  -- começa daqui a um mês produzia linhagem invertida — o contrato NOVO com
  -- `started_on` anterior ao do velho, e o velho encerrado com
  -- `ended_on = greatest(virada - 1, started_on)`, ou seja, encerrado no mesmo
  -- dia em que começa. A régua da janela (hoje .. hoje+56) continua valendo
  -- inteira; esta é a terceira ponta.
  if p_switch_on < v_old.started_on then
    raise exception
      'a virada (%) não pode ser anterior ao início do contrato atual (%)',
      p_switch_on, v_old.started_on;
  end if;
  -- ALTERADO (c12 · nº 11): era `<= 0`. ZERO é CORTESIA — caso legítimo da
  -- escola (S2-15) e já aceito por `admin_create_contract`. Duas portas com
  -- réguas diferentes para o mesmo fato é como um contrato de cortesia deixava
  -- de poder ser renovado. Negativo continua recusado.
  if p_hourly_rate_cents is null or p_hourly_rate_cents < 0 then
    raise exception 'valor da aula inválido';
  end if;

  v_pending := public._contract_pending_count(p_old);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho — registre antes de renovar', v_pending;
  end if;

  -- c8 · R1: andares 2 e 4, ordenados por uuid, antes do advisory.
  perform 1 from class_instances
   where contract_id = p_old and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= p_switch_on
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_old and (active_to is null or active_to >= p_switch_on)
   order by id
     for update;

  -- (a) cancelar futuras do velho a partir da virada — SEM crédito, SEM aviso
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_old and ci.state = 'scheduled'
    and (ci.starts_at_utc at time zone public.business_tz())::date >= p_switch_on;
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  -- (b) criar o novo (antes de fechar os slots, para copiá-los da foto viva)
  insert into contracts
    (contract_type, student_id, student_group_id, teacher_id, plan_name,
     hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
     makeup_credit_expiry_days, school_fault_credit_expiry_days,
     started_on, status, renewed_from, group_tz_anchor_student)
  values
    ('private_1on1', v_old.student_id, v_old.student_group_id, v_old.teacher_id,
     p_plan_name, p_hourly_rate_cents, p_allowance, p_min_notice,
     p_expiry_days, p_school_fault_days, p_switch_on, 'active', p_old,
     v_old.group_tz_anchor_student)
  returning id into v_new;

  -- (c) fechar horários do velho na véspera e recriá-los no novo desde a virada
  for v_slot in
    select rs.* from recurring_slots rs
    where rs.contract_id = p_old
      and (rs.active_to is null or rs.active_to >= p_switch_on)
  loop
    update recurring_slots set active_to = p_switch_on - 1 where id = v_slot.id;
    perform public.create_slot(
      v_new, v_slot.weekday, v_slot.local_time, v_slot.iana_tz,
      v_slot.duration_min, p_switch_on, v_actor);
    v_slots_copied := v_slots_copied + 1;
  end loop;

  -- (d) encerrar o velho na véspera da virada (greatest: virada no dia do
  -- próprio started_on não viola o CHECK ended>=started)
  update contracts
     set status = 'ended', ended_on = greatest(p_switch_on - 1, v_old.started_on)
   where id = p_old;

  -- c8 · R1: o advisory do gasto no último andar.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_old::text, 0));

  -- (e) créditos vivos migram preservando validade + duração (M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_old) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
      'renovação: crédito transferido', v_new);
    v_transferred := v_transferred + 1;
  end loop;

  perform public.log_audit(v_actor, 'renew_contract', 'contracts', v_new::text,
    jsonb_build_object(
      'renewed_from', p_old, 'switch_on', p_switch_on,
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_copied', v_slots_copied,
      'credits_transferred', v_transferred,
      'hourly_rate_cents', p_hourly_rate_cents));

  return v_new;
end;
$function$;

comment on function public.admin_renew_contract(uuid, date, text, integer, integer, integer, integer, integer, uuid) is
  'F4/M5-1 + c12: renovação guiada, toda no banco. A virada tem TRÊS pontas — '
  'não no passado, no máximo 8 semanas à frente e nunca antes do `started_on` do '
  'contrato renovado (c12 · nº 10). Valor ZERO é cortesia e passa; negativo, não '
  '(c12 · nº 11).';
