-- A6 · LOTE 1 — AS TRAVAS DA AGENDA VÃO PARA O BANCO (98ª migration)
--
-- Lei 7 respeitada ao pé da letra: NENHUMA migration anterior foi tocada — em
-- especial as 95/96/97 (`20260728001000`, `20260728001100`, `20260729000100`),
-- que nas ondas anteriores eram reescritas em place por nunca terem sido
-- aplicadas. Desta vez não: tudo aqui é arquivo NOVO, posterior à 97ª.
--
-- ⚠️ ESTE ARQUIVO FOI REESCRITO EM PLACE (passe adversarial do Lote 1), e a
-- justificativa é a mesma que valeu para as 95/96/97: ele NUNCA foi aplicado em
-- ambiente compartilhado — produção parou ANTES dele, e nem as 95/96/97
-- chegaram lá. Enquanto uma migration não tocou ambiente compartilhado ela não
-- é história, é rascunho; a partir do primeiro apply, Lei 7 fecha a porta e
-- toda mudança vira arquivo novo. As duas correções reescritas aqui:
--
--   · A6/e vira pergunta de INTERVALO (a reserva confere a aula inteira, não só
--     o instante da janela) — a "janela das 23:30" deixa de furar o bloqueio;
--   · os escritores da agenda da professora passam a ser SERIALIZADOS pelo
--     advisory `teacher_agenda:<professora>` (5º andar da ordem canônica
--     global), porque check-then-insert sem recurso em comum commita estado que
--     nenhuma das duas transações aceitaria. Ver a seção 0 logo abaixo.
--
-- Cada corpo abaixo é o corpo VIVO (a definição EFETIVA por ordem lexicográfica
-- das 97 migrations) reemitido com o MÍNIMO alterado, e a alteração vem
-- comentada no lugar dela. Onde a ASSINATURA muda, é `drop function` da
-- assinatura antiga + `create` + revokes/grants REEMITIDOS: `create or replace`
-- não troca assinatura, ele cria OVERLOAD — e overload nesta família é sorteio
-- (o helper de provas `tests/helpers/definicao-da-funcao.ts` estoura de
-- propósito quando encontra dois).
--
-- ===========================================================================
-- O QUE ESTA MIGRATION FECHA (itens a–i da spec do A6)
-- ===========================================================================
--
-- a) INSTANTE EM VEZ DE HORA CIVIL. `admin_create_single_class`,
--    `admin_create_trial_class` e `publish_reschedule_window` deixam de receber
--    `p_local_date date, p_local_time time` e passam a receber
--    `p_starts_at_utc timestamptz`. O `local_time_snapshot` (Lei 1: auditoria)
--    é DERIVADO dentro da função por `p_starts_at_utc at time zone <zona da
--    linha>`. Por que isto é a cura, e não enfeite: enquanto a RPC reconstruía o
--    instante a partir de data+hora civis, os dois dias do ano em que o relógio
--    da cidade pula ou repete a hora produziam um instante que NINGUÉM escolheu,
--    sem erro nenhum — e o porteiro em TypeScript
--    (`src/lib/admin/hora-civil.ts`) só conseguia recusar, nunca corrigir,
--    porque a informação de QUAL das duas ocorrências a dona quis já se perdia
--    antes de chegar ao banco. Some também a divergência de tzdata Node×host
--    medida no A4 (`America/Vancouver`, 15/11/2026): com o instante decidido de
--    um lado só, não há segunda conversão para divergir.
--    O porteiro do TS FICA (Lei 3, antecipação de UX): é ele que recusa hora
--    inexistente/ambígua ANTES de virar instante.
--
-- b) CHECK cortesia sem preço + recusa na RPC.
-- c) CHECK de duração sã da AULA (15..480) + recusa nas duas RPCs de criação.
-- d) `publish_reschedule_window` confere bloqueio E conflito com aula.
-- e) `book_reschedule_window` ganha o cinto do bloqueio criado DEPOIS da
--    publicação — por SOBREPOSIÇÃO da aula inteira, não pelo instante da janela
--    (correção do passe adversarial; ver a seção 5).
-- f) `add_teacher_block` fecha as janelas PUBLICADAS do período (retorno vira
--    jsonb) — e `admin_period_treatment` acompanha.
-- g) `remove_teacher_block` confere `kind = 'block'`.
-- h) As duas RPCs de criação recusam aula que SOBREPÕE bloqueio da professora.
-- i) `students_lead_sem_login` recusa vincular acesso a perfil SEM WhatsApp.
--
-- Leis tocadas: 1 (o instante passa a ser a verdade; o snapshot continua
-- auditoria e continua sendo calculado com o offset DAQUELE dia), 3 (toda régua
-- nova mora no Postgres — a UI só antecipa), 4 (revoke/grant reemitidos em cada
-- assinatura nova), 7 (migration NOVA), 8 (auditoria preservada e ampliada).
--
-- ===========================================================================
-- PRÉ-VOO OBRIGATÓRIO NO RITO DE DEPLOY (gate: ZERO linhas em cada uma)
-- ===========================================================================
--
-- Os dois `alter table ... add constraint` abaixo FALHAM e param o apply se
-- produção tiver linha fora da régua. Rodar ANTES do apply:
--
--   -- 3. cortesia com preço gravado (a trava de tela do A4 não era do banco):
--   select id from class_instances
--    where single_kind = 'courtesy' and single_price_cents is not null;
--
--   -- 4. duração de aula fora de 15..480 minutos:
--   select id from class_instances
--    where ends_at_utc - starts_at_utc
--          not between interval '15 minutes' and interval '480 minutes';
--
-- Linha encontrada = decidir com o dono ANTES do deploy (corrigir a linha ou
-- registrar a exceção). Nunca afrouxar o CHECK para o apply passar.


-- ###########################################################################
-- 0 · O ADVISORY DA AGENDA DA PROFESSORA — onde ele entra, e por quê ALI
-- ###########################################################################
--
-- Todas as travas novas desta migration são CHECK-THEN-INSERT: leem um estado
-- (existe bloqueio? existe aula? existe janela publicada?) e escrevem outro na
-- sequência. Sem recurso em comum, duas transações concorrentes se cruzam e
-- commitam um estado que NENHUMA das duas teria aceitado sozinha — janela
-- publicada dentro de um bloqueio que nasceu no mesmo segundo, aula avulsa
-- criada em cima de um bloqueio idem.
--
-- O recurso em comum já existe nesta casa e é o certo: o advisory
-- `teacher_agenda:<professora>`, criado no c10 · T2 (`20260727000900`) e usado
-- por `_assert_no_paused_overlap`, `_assert_no_active_overlap` e
-- `pause_contract`. A chave é copiada LETRA POR LETRA de `pause_contract`
-- (`20260727001000`, linha 307):
--
--     pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || <uuid>::text, 0))
--
-- ── A ORDEM CANÔNICA GLOBAL (cabeçalho de `20260727000700`, com o adendo do
--    c10) manda o advisory ser o 5º andar, DEPOIS de contracts (1),
--    class_instances (2), reschedule_windows (3) e recurring_slots (4); e,
--    dentro do 5º, a sub-ordem é `makeup_spend → class → teacher_agenda →
--    materialize_slot`. Nenhum par pré-existente foi invertido aqui. Onde cada
--    um entrou, e o que precede:
--
--   · `admin_create_single_class` — depois do `contracts … for update` (1) que
--     ela já pedia, e ANTES da leitura do bloqueio. Nada nos andares 2–4.
--   · `admin_create_trial_class` — não pede linha nenhuma dos andares 1–4; o
--     advisory abre a seção e ANTES da leitura do bloqueio. Os `insert` de
--     `students`/`contracts` que vêm depois são linhas CRIADAS pela própria
--     transação — isenção EXPLÍCITA do cabeçalho ("ninguém mais a enxerga,
--     então ninguém pode disputá-la").
--   · `publish_reschedule_window` — idem: nenhum andar 1–4, advisory antes das
--     duas leituras (bloqueio e aula), e o `insert` da janela é linha nova.
--   · `add_teacher_block` — o fechamento das janelas (3) SUBIU para antes do
--     advisory (5), que é a ordem que o cabeçalho manda; o `insert` da exceção
--     desceu para depois do advisory, porque é ELE o estado que
--     `publish_reschedule_window` lê do outro lado.
--   · `book_reschedule_window` — depois dos três locks de linha que ela já
--     pedia (1→2→3) e depois de `makeup_spend` (sub-ordem do 5º andar), porque
--     é o `insert` da aula que já pedia `teacher_agenda` pelo gatilho
--     `class_instances_horario_em_pausa`. Tomá-lo antes de `makeup_spend`
--     inverteria o par contra `book_computed_slot`, que segura `makeup_spend` e
--     chama esta função.
--
-- ── O QUE ESTE ARRANJO **NÃO** FECHA (dívida declarada, não descuido) ────────
-- Sobra UM entrelaçamento em `add_teacher_block`: a publicação segura o
-- advisory e insere a janela; o bloqueio, que varre as janelas ANTES de pedir o
-- advisory (é o que a ordem canônica manda), não enxerga a linha ainda não
-- commitada e depois cria o bloqueio sem fechá-la. Resultado: uma janela fica
-- `publicada` dentro do bloqueio.
--
-- Por que não se conserta aqui: fechar isso exige o advisory ANTES da varredura
-- das janelas — 5 → 3 —, e `book_reschedule_window`/`book_computed_slot` fazem
-- 3 → 5 (seguram a janela e pedem `teacher_agenda` no `insert` da aula). O par
-- invertido é deadlock 40P01 na cara da dona no meio de uma reserva, que é
-- exatamente o que a ordem canônica existe para proibir.
--
-- O DINHEIRO ESTÁ COBERTO mesmo nesse entrelaçamento: quem tentar reservar a
-- janela órfã bate no cinto do A6/e (seção 5), que confere o bloqueio no ato da
-- reserva. O residual é uma OFERTA FANTASMA na grade e no portal — o aluno vê o
-- horário e leva "esse horário foi bloqueado pela professora" ao clicar. Caso
-- para o harness e2e e para o portão do dono; não é estado de dinheiro errado.


-- ###########################################################################
-- 1 · AS DUAS TRAVAS ESTRUTURAIS DE `class_instances` (itens b e c)
-- ###########################################################################

-- (b) Cortesia é gratuita DE VERDADE. Até aqui isso era promessa de TELA: o
-- formulário desmontava o campo de preço, e o banco aceitava o valor por
-- qualquer outra porta (envio forjado, SQL manual, action nova). A frase da
-- matriz do A4 dizia isso em voz alta ("quem garante isso é a tela") — agora
-- ela pode voltar a prometer, porque a garantia é estrutural.
alter table class_instances
  add constraint class_instances_courtesy_sem_preco
  check (single_kind is distinct from 'courtesy' or single_price_cents is null);

comment on constraint class_instances_courtesy_sem_preco on class_instances is
  'A6/b: cortesia NÃO carrega preço. `is distinct from` de propósito — '
  '`single_kind` é NULL na aula de horário fixo, e `<>` deixaria a linha passar '
  'por comparação com NULL em vez de por ser aula normal.';

-- (c) Duração sã da AULA. A régua 15..480 já existia em dois lugares — o CHECK
-- `recurring_slots_duration_sane` (horário FIXO, migration 20260727001200) e o
-- TypeScript da agenda (`DURACAO_MIN_MINUTOS`/`DURACAO_MAX_MINUTOS`, régua
-- RATIFICADA pelo dono em 29/07) —, e não valia para a aula avulsa,
-- experimental ou remarcada. `class_instances` não tem coluna de duração: ela é
-- a diferença entre os dois instantes, e é sobre ela que o CHECK fala.
-- Por que isto é dinheiro: a duração da aula é HORA PAGA no extrato da
-- professora (`_teacher_payable_hours` soma o intervalo).
alter table class_instances
  add constraint class_instances_duration_sane
  check (ends_at_utc - starts_at_utc between interval '15 minutes' and interval '480 minutes');

comment on constraint class_instances_duration_sane on class_instances is
  'A6/c: a mesma régua 15..480 do horário fixo (recurring_slots_duration_sane) '
  'e da tela da agenda, agora valendo para TODA aula — avulsa, experimental e '
  'remarcada incluídas. A duração é hora paga no extrato da professora.';


-- ###########################################################################
-- 2 · `admin_create_single_class` — instante, cortesia, duração, bloqueio
-- ###########################################################################
--
-- Reemissão do corpo VIVO (20260718000400_f2_acoes_de_aula.sql) com quatro
-- mudanças, todas comentadas no lugar:
--   · a assinatura recebe o INSTANTE (item a);
--   · cortesia com preço é recusada com frase (item b);
--   · duração fora de 15..480 é recusada com frase (item c);
--   · aula que SOBREPÕE bloqueio da professora é recusada (item h).
--
-- O que NÃO muda: papel, contrato particular ATIVO, a escada da zona (slot
-- vigente → cadastro do aluno), a exigência de valor na extra cobrada, o futuro,
-- a tradução do `exclusion_violation` e a auditoria (mesmas chaves no diff).
--
-- A ESCADA DA ZONA CONTINUA VIVA, e agora serve só ao SNAPSHOT: o instante já
-- vem decidido, mas o snapshot textual precisa dizer que hora era ALI, no
-- relógio do aluno — que é a única coisa que a auditoria consegue reler daqui a
-- um ano (Lei 1). Zona indeterminada continua sendo exceção, porque snapshot
-- inventado é pior que recusa.

drop function public.admin_create_single_class(uuid, date, time, int, text, int, uuid);

create function public.admin_create_single_class(
  p_contract uuid,
  p_starts_at_utc timestamptz,
  p_duration_min int,
  p_kind text,
  p_price_cents int default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_contract contracts%rowtype;
  v_actor uuid;
  v_tz text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_local timestamp;
  v_block text;
  v_new_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_single_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if p_kind not in ('extra_paid', 'courtesy') then
    raise exception 'tipo de avulsa em contrato existente deve ser extra_paid ou courtesy (experimental usa admin_create_trial_class)';
  end if;
  if p_kind = 'extra_paid' and (p_price_cents is null or p_price_cents <= 0) then
    raise exception 'aula extra cobrada exige valor (p_price_cents)';
  end if;
  -- ALTERADO (A6/b): a cortesia é gratuita DE VERDADE. O CHECK da tabela já
  -- recusaria a linha; a recusa aqui existe para a dona ler português em vez do
  -- nome do constraint.
  if p_kind = 'courtesy' and p_price_cents is not null then
    raise exception 'aula cortesia não leva valor: ela é gratuita para o aluno (recebido: % centavos)', p_price_cents;
  end if;
  -- ALTERADO (A6/c): a régua 15..480 passou a ser do banco.
  if p_duration_min is null or p_duration_min < 15 or p_duration_min > 480 then
    raise exception 'duração inválida (%): a aula precisa ter entre 15 e 480 minutos', p_duration_min;
  end if;
  -- ALTERADO (A6/a): o instante é obrigatório e é ele que decide a aula.
  if p_starts_at_utc is null then
    raise exception 'informe o instante de início da aula (p_starts_at_utc)';
  end if;

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' or v_contract.status <> 'active' then
    raise exception 'aula avulsa exige contrato particular ATIVO';
  end if;

  -- zona: slot ativo do contrato → aluno do contrato. Agora ela serve ao
  -- SNAPSHOT (Lei 1: "que hora era ali"), não mais à conversão — o instante
  -- chega decidido.
  select rs.iana_tz into v_tz
  from recurring_slots rs
  where rs.contract_id = p_contract
    and rs.active_from <= current_date
    and (rs.active_to is null or rs.active_to >= current_date)
  order by rs.active_from desc limit 1;
  if v_tz is null then
    select s.iana_tz into v_tz from students s where s.id = v_contract.student_id;
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da avulsa do contrato %', p_contract;
  end if;

  v_starts := p_starts_at_utc;
  v_ends := v_starts + make_interval(mins => p_duration_min);
  v_local := v_starts at time zone v_tz;
  if v_starts <= now() then
    raise exception 'a aula avulsa precisa ser no futuro (% em %)', v_starts, v_tz;
  end if;

  -- ALTERADO (A6/h): bloqueio da professora é PROIBITIVO, e a pergunta é de
  -- SOBREPOSIÇÃO de intervalo — a aula de 60 min que começa 10 min antes do
  -- bloqueio invade o bloqueio. Borda EXCLUSIVA no fim (no instante exato de
  -- `ends_at_utc` o bloqueio já acabou), a mesma convenção de
  -- `_teacher_available_for` e da camada de dados do A3.
  -- A JANELA SEMANAL (`kind='open'`/`teacher_weekly_availability`) NÃO entra:
  -- régua do A3, ratificada aqui — ela é INFORMATIVA (a professora atende fora
  -- dela a combinar), e só a PROIBIÇÃO explícita é invariante. A `note` do
  -- bloqueio não é lida de propósito: é onde se escreve "consulta médica", e
  -- mensagem de erro vira log e barra de endereços.
  --
  -- ALTERADO (passe adversarial do Lote 1): 5º andar da ordem canônica global,
  -- depois do `contracts … for update` que esta função já pediu e ANTES da
  -- leitura — é a leitura que precisa ser indivisível em relação ao bloqueio
  -- que outra transação está prestes a criar. Reentrante: o `insert` de
  -- `class_instances` logo abaixo pede o MESMO advisory pelo gatilho
  -- `class_instances_horario_em_pausa`.
  perform pg_advisory_xact_lock(
    hashtextextended('teacher_agenda:' || v_contract.teacher_id::text, 0));

  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = v_contract.teacher_id
    and e.kind = 'block'
    and e.starts_at_utc < v_ends
    and e.ends_at_utc > v_starts
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'a professora está com bloqueio de agenda nesse período (%) — remova o bloqueio antes de criar a aula', v_block;
  end if;

  begin
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, single_kind, single_price_cents)
    values
      (p_contract, v_contract.teacher_id, null, v_local::date, v_starts,
       v_ends,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz,
       'scheduled', p_kind, p_price_cents)
    returning id into v_new_id;
  exception when exclusion_violation or unique_violation then
    -- a guarda anti-sobreposição do professor aparece como unique/exclusion
    raise exception 'conflito de agenda: a professora já tem compromisso nesse horário';
  end;

  perform public.log_audit(v_actor, 'admin_create_single_class', 'class_instances', v_new_id::text,
    jsonb_build_object('contract_id', p_contract, 'kind', p_kind,
                       'price_cents', p_price_cents, 'starts_at_utc', v_starts,
                       'duration_min', p_duration_min, 'iana_tz', v_tz));
  return v_new_id;
end;
$fn$;

comment on function public.admin_create_single_class(uuid, timestamptz, int, text, int, uuid) is
  'A6/a: recebe o INSTANTE (p_starts_at_utc), nunca data+hora civis — a '
  'conversão civil→instante acontece UMA vez, em quem fala com a dona '
  '(src/lib/admin/hora-civil.ts), e o snapshot textual é derivado aqui com o '
  'offset DAQUELE dia na zona do aluno (Lei 1). Recusa cortesia com preço (b), '
  'duração fora de 15..480 (c) e aula que sobrepõe bloqueio da professora (h).';

revoke execute on function public.admin_create_single_class(uuid, timestamptz, int, text, int, uuid)
from public, anon, authenticated;
grant execute on function public.admin_create_single_class(uuid, timestamptz, int, text, int, uuid)
to authenticated;


-- ###########################################################################
-- 3 · `admin_create_trial_class` — instante, duração, bloqueio
-- ###########################################################################
--
-- Reemissão do corpo VIVO (20260727001000_default_seguro_e_posse.sql, que já
-- era reemissão do de 20260718000400 com `tz_confirmed = false` explícito).
-- Muda o mesmo que na irmã, menos a cortesia (aqui o tipo é sempre 'trial', e
-- valor em branco = aula gratuita, que é regra de PRODUTO e continua).
--
-- `p_iana_tz` FICA: esta RPC cria a pessoa, e a zona é dado do cadastro dela —
-- não é um jeito de reconverter o horário.

drop function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid);

create function public.admin_create_trial_class(
  p_student_name text,
  p_iana_tz text,
  p_teacher uuid,
  p_starts_at_utc timestamptz,
  p_duration_min int,
  p_price_cents int default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_student uuid;
  v_contract uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_local timestamp;
  v_block text;
  v_new_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_trial_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if btrim(coalesce(p_student_name, '')) = '' then
    raise exception 'nome da pessoa é obrigatório';
  end if;
  -- ALTERADO (A6/c): mesma régua da irmã.
  if p_duration_min is null or p_duration_min < 15 or p_duration_min > 480 then
    raise exception 'duração inválida (%): a aula precisa ter entre 15 e 480 minutos', p_duration_min;
  end if;
  -- ALTERADO (A6/a)
  if p_starts_at_utc is null then
    raise exception 'informe o instante de início da aula (p_starts_at_utc)';
  end if;
  if not exists (select 1 from teachers t where t.id = p_teacher and t.archived_at is null) then
    raise exception 'professora % não existe ou está arquivada', p_teacher;
  end if;

  v_starts := p_starts_at_utc;
  v_ends := v_starts + make_interval(mins => p_duration_min);
  -- O snapshot (e a data civil da ocorrência) na zona DA PESSOA NOVA, que é a
  -- que o parâmetro traz — offset daquele dia (Lei 1). Zona inválida estoura
  -- aqui, como antes.
  v_local := v_starts at time zone p_iana_tz;
  if v_starts <= now() then
    raise exception 'a aula experimental precisa ser no futuro (% em %)', v_starts, p_iana_tz;
  end if;

  -- ALTERADO (A6/h): o mesmo porteiro de bloqueio da irmã. Aqui a professora vem
  -- do parâmetro (é a tela que a escolhe), e a assimetria medida no A4 morre: o
  -- caminho da experimental não tinha porteiro NENHUM no banco.
  --
  -- ALTERADO (passe adversarial do Lote 1): o advisory da agenda dela, antes da
  -- leitura. Esta função não pede linha NENHUMA dos andares 1–4 — os `insert`
  -- de `students` e `contracts` abaixo criam linhas que só esta transação
  -- enxerga, e o cabeçalho da ordem canônica as isenta explicitamente.
  perform pg_advisory_xact_lock(
    hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = p_teacher
    and e.kind = 'block'
    and e.starts_at_utc < v_ends
    and e.ends_at_utc > v_starts
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'a professora está com bloqueio de agenda nesse período (%) — remova o bloqueio antes de criar a aula', v_block;
  end if;

  -- `tz_confirmed` EXPLÍCITO (c11 · U1): sem cidade não há confirmação; a ficha
  -- nasce dizendo "a confirmar", e o contrato de verdade (o não-experimental) só
  -- sai depois que alguém completar o cadastro.
  insert into students (display_name, iana_tz, tz_confirmed)
  values (btrim(p_student_name), p_iana_tz, false)
  returning id into v_student;

  insert into contracts
    (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
     monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
     started_on, is_trial)
  values
    ('private_1on1', v_student, p_teacher, 'Aula experimental',
     coalesce(p_price_cents, 0), 0, 24, 90, v_local::date, true)
  returning id into v_contract;

  begin
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, single_kind, single_price_cents)
    values
      (v_contract, p_teacher, null, v_local::date, v_starts,
       v_ends,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || p_iana_tz,
       'scheduled', 'trial', p_price_cents)
    returning id into v_new_id;
  exception when exclusion_violation or unique_violation then
    raise exception 'conflito de agenda: a professora já tem compromisso nesse horário';
  end;

  perform public.log_audit(v_actor, 'admin_create_trial_class', 'class_instances', v_new_id::text,
    jsonb_build_object('student_id', v_student, 'contract_id', v_contract,
                       'teacher_id', p_teacher, 'price_cents', p_price_cents,
                       'starts_at_utc', v_starts, 'duration_min', p_duration_min,
                       'iana_tz', p_iana_tz, 'tz_confirmed', false));
  return v_new_id;
end;
$fn$;

comment on function public.admin_create_trial_class(text, text, uuid, timestamptz, int, int, uuid) is
  'Experimental num ato só: pessoa nova + contrato leve (is_trial) + aula. A '
  'pessoa nasce com `tz_confirmed = false` EXPLÍCITO (c11 · U1) — a RPC recebe '
  'a zona, não a cidade, e é a cidade que sustenta a zona. O contrato '
  'experimental é isento da guarda de fuso de propósito (c7 · P6). A6/a: '
  'recebe o INSTANTE; `p_iana_tz` continua porque é o CADASTRO da pessoa nova, '
  'e é dela que sai o snapshot (Lei 1). A6/c+h: duração 15..480 e bloqueio da '
  'professora são recusados no banco.';

revoke execute on function public.admin_create_trial_class(text, text, uuid, timestamptz, int, int, uuid)
  from public, anon;
grant execute on function public.admin_create_trial_class(text, text, uuid, timestamptz, int, int, uuid)
  to authenticated;


-- ###########################################################################
-- 4 · `publish_reschedule_window` — instante, bloqueio e conflito (a + d)
-- ###########################################################################
--
-- Reemissão do corpo VIVO (20260713000300_fase3_teacher_windows_rls.sql) com:
--   · a assinatura por INSTANTE (item a) — `local_date`/`local_time`/
--     `local_time_snapshot` da tabela passam a ser DERIVADOS da zona de quem
--     publica, e não mais a fonte;
--   · a recusa de publicar DENTRO de bloqueio da professora (item d);
--   · a recusa de publicar EM CIMA de aula agendada dela (item d) — uma janela
--     assim é impossível de consumir (a exclusão GiST recusa na reserva), então
--     publicá-la é oferecer ao aluno um horário que vai falhar na cara dele.
--     Isto existia só como antecipação de UX no TS (`src/lib/windows.ts`, e
--     nem no caminho do admin).
--
-- A janela é um PONTO na grade — a duração real só se decide quando alguém a
-- consome —, por isso as duas perguntas são sobre o INSTANTE publicado, e não
-- sobre um intervalo. A travessia de meia-noite continua dívida do A9.
--
-- O que NÃO muda: posse da professora (F3-D6), a proibição de `p_iana_tz` para
-- o papel teacher, a fonte única do fuso (`teachers.iana_tz`, F3-D2), o futuro,
-- e a auditoria.

drop function public.publish_reschedule_window(uuid, date, time, text, uuid);

create function public.publish_reschedule_window(
  p_teacher uuid,
  p_starts_at_utc timestamptz,
  p_iana_tz text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role text := public.app_role();
  v_teacher_tz text;
  v_tz text;
  v_starts timestamptz;
  v_local timestamp;
  v_block text;
  v_clash timestamptz;
  v_id uuid;
  v_actor uuid;
begin
  if v_role = 'teacher' then
    if p_teacher is distinct from public.my_teacher_id() then
      raise exception 'professora só publica janela PARA SI (F3-D6)';
    end if;
    if p_iana_tz is not null then
      raise exception 'fuso da professora vem de teachers.iana_tz — não informe p_iana_tz (F3-D6)';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'publish_reschedule_window é restrita a admin/professora (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  -- ALTERADO (A6/a)
  if p_starts_at_utc is null then
    raise exception 'informe o instante do horário a publicar (p_starts_at_utc)';
  end if;

  select t.iana_tz into v_teacher_tz from teachers t where t.id = p_teacher;
  if not found then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- Zona de quem publica (D1/F2 + F3-D2): fonte única = teachers.iana_tz;
  -- p_iana_tz é override explícito EXCLUSIVO da admin. ALTERADO (A6/a): ela já
  -- não CONVERTE nada — só nomeia o relógio em que o snapshot é lido.
  v_tz := coalesce(p_iana_tz, v_teacher_tz);
  v_starts := p_starts_at_utc;
  v_local := v_starts at time zone v_tz;
  if v_starts <= now() then
    raise exception 'janela % (%) já passou', v_local, v_tz;
  end if;

  -- ALTERADO (passe adversarial do Lote 1): o advisory da agenda da professora
  -- abre a região crítica. As DUAS leituras abaixo (bloqueio e aula) e o
  -- `insert` da janela viram um ato só em relação a `add_teacher_block` e às
  -- outras portas que escrevem na agenda dela. Esta função não pede linha
  -- nenhuma dos andares 1–4; a janela que ela insere é linha nova (isenção
  -- explícita do cabeçalho da ordem canônica).
  perform pg_advisory_xact_lock(
    hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  -- ALTERADO (A6/d, bloqueio): publicar dentro do próprio bloqueio era possível
  -- — a dona fechava o período e a grade continuava ofertando horário ali.
  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = p_teacher
    and e.kind = 'block'
    and e.starts_at_utc <= v_starts
    and e.ends_at_utc > v_starts
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'esse horário está dentro de um bloqueio da professora (%) — remova o bloqueio antes de publicar', v_block;
  end if;

  -- ALTERADO (A6/d, conflito): janela em cima de aula agendada dela.
  select ci.starts_at_utc into v_clash
  from class_instances ci
  where ci.teacher_id = p_teacher
    and ci.state = 'scheduled'
    and ci.starts_at_utc <= v_starts
    and ci.ends_at_utc > v_starts
  order by ci.starts_at_utc, ci.id
  limit 1;
  if v_clash is not null then
    raise exception 'a professora já tem aula marcada nesse horário (%) — nenhum aluno conseguiria reservar essa janela', v_clash;
  end if;

  insert into reschedule_windows
    (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
  values
    (p_teacher, v_local::date, v_local::time, v_tz, v_starts,
     to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz,
     v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'publish_reschedule_window', 'reschedule_windows', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'starts_at_utc', v_starts, 'iana_tz', v_tz));
  return v_id;
end;
$fn$;

comment on function public.publish_reschedule_window(uuid, timestamptz, text, uuid) is
  'A6/a: recebe o INSTANTE; local_date/local_time/local_time_snapshot são '
  'derivados da zona de quem publica (Lei 1). A6/d: recusa horário dentro de '
  'bloqueio da professora e horário em cima de aula agendada dela — janela '
  'assim é impossível de consumir (exclusão GiST na reserva).';

revoke execute on function public.publish_reschedule_window(uuid, timestamptz, text, uuid)
from public, anon, authenticated;
grant execute on function public.publish_reschedule_window(uuid, timestamptz, text, uuid)
to authenticated;


-- ###########################################################################
-- 5 · `book_reschedule_window` — o cinto do bloqueio (item e)
-- ###########################################################################
--
-- ASSINATURA INTOCADA (o site em produção chama esta função) ⇒ `create or
-- replace`. Reemissão do corpo VIVO (20260727000700_ordem_global_de_locks.sql)
-- com UMA validação a mais.
--
-- O buraco que ela fecha: a janela é publicada quando o período está livre, a
-- professora bloqueia o período DEPOIS, e o aluno que já estava com a tela de
-- confirmação aberta reserva dentro do dia bloqueado — gastando franquia ou
-- crédito. `add_teacher_block` passa a cancelar as janelas publicadas do período
-- (item f), o que resolve o caso normal; este cinto cobre a corrida (janela
-- republicada, bloqueio criado por outra porta, transação concorrente).
--
-- ── A PERGUNTA É DE INTERVALO, NÃO DE INSTANTE (passe adversarial do Lote 1) ─
-- A primeira versão deste cinto comparava só `v_win.starts_at_utc` contra o
-- bloqueio, com o argumento de que "a janela é um ponto na grade". O argumento
-- vale para a PUBLICAÇÃO (lá ninguém sabe quanto vai durar a aula), e não vale
-- aqui: no ato da reserva a duração JÁ está decidida — é a mesma que a função
-- deriva logo abaixo para criar a instância. Com a comparação por instante, a
-- janela publicada às 23:30 do dia anterior consumia uma aula de 60 min que
-- entrava 30 minutos DENTRO do dia bloqueado, e passava. É a "janela das 23:30"
-- que estava roteada como dívida ao A9 — morre aqui.
--
-- Por isso a derivação da duração SOBE para antes do cinto (e é a MESMA
-- derivação que o `insert` do resgate usa — uma conta só, não duas que podem
-- divergir), e a pergunta passa a ser de sobreposição de faixas:
-- `tstzrange(v_starts, v_ends) && tstzrange(e.starts_at_utc, e.ends_at_utc)`.
-- Borda EXCLUSIVA no fim (o `[)` padrão do `tstzrange`), a MESMA convenção dos
-- irmãos `admin_create_single_class`/`admin_create_trial_class` e de
-- `_teacher_available_for`: a aula que termina no instante exato em que o
-- bloqueio começa não invade nada.
--
-- ORDEM CANÔNICA GLOBAL DE LOCKS respeitada: os três locks de linha continuam
-- exatamente onde estavam (contrato → instância → janela), e o 5º andar entra
-- na sub-ordem que o adendo do c10 fixou — `makeup_spend` ANTES de
-- `teacher_agenda`. Tomar `teacher_agenda` primeiro inverteria o par contra
-- `book_computed_slot`, que segura `makeup_spend` e chama esta função.
-- `makeup_spend` passa a ser pedido nos DOIS caminhos: no resgate ele já era
-- pedido (é sob ele que a duração do crédito se lê), e na remarcação ele já
-- aparecia lá dentro, em `spend_makeup`, quando a franquia acaba — antecipá-lo
-- não muda contenção (a linha do contrato já está travada desde o topo) e é o
-- que mantém a sub-ordem verdadeira também quando a franquia cobre.
--
-- Por que NÃO `_teacher_available_for`: aquela função exige estar DENTRO de
-- janela semanal, e janela semanal é INFORMATIVA nesta casa (régua do A3) — usá-la
-- aqui recusaria toda reserva de professora que não tenha agenda semanal
-- cadastrada. A pergunta certa é só sobre a PROIBIÇÃO (`kind = 'block'`).

CREATE OR REPLACE FUNCTION public.book_reschedule_window(p_window uuid, p_instance uuid DEFAULT NULL::uuid, p_contract uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_win reschedule_windows%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_inst_teacher uuid;
  v_inst_starts timestamptz;
  v_actor uuid;
  v_credit_dur int;
  v_slot_dur int;
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
  v_lead int;
  v_block text;
  -- NOVO (passe adversarial do Lote 1): o FIM da aula que vai nascer. O cinto do
  -- bloqueio pergunta pela faixa `[v_win.starts_at_utc, v_ends)`, não pelo ponto.
  v_ends timestamptz;
  -- NOVO (Sol · rodada 2 do Lote 1): a duração EXATA, como intervalo. É ela que
  -- fecha a faixa; `v_duration_min` (arredondado) segue só para o audit.
  v_dur interval;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  if (p_courtesy or p_bypass_lead) and public.app_role() <> 'admin' then
    raise exception 'cortesia e bypass de antecedência são só da administração (D10)';
  end if;
  if p_courtesy and p_instance is null then
    raise exception 'cortesia é da REMARCAÇÃO — resgate consome crédito por definição';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ALTERADO (c8 · R1): os TRÊS locks, na ordem canônica, ANTES de qualquer
  -- validação. Antes a JANELA era travada primeiro e a linha do contrato só
  -- depois — o outro lado do ciclo com `book_computed_slot`.
  -- A pré-leitura sem lock só descobre o endereço do contrato (a instância
  -- nunca troca de contrato); o estado que decide é o relido depois dos locks.
  if p_instance is not null then
    select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  else
    v_contract_id := p_contract;
  end if;
  perform 1 from contracts where id = v_contract_id for update;
  if p_instance is not null then
    perform 1 from class_instances where id = p_instance for update;
  end if;
  select * into v_win from reschedule_windows where id = p_window for update;

  if v_win.id is null then
    raise exception 'janela % não existe', p_window;
  end if;
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está disponível (estado: %)', p_window, v_win.state;
  end if;
  if v_win.starts_at_utc <= now() then
    raise exception 'janela % já passou', p_window;
  end if;
  if v_win.starts_at_utc > now() + interval '14 days' then
    raise exception 'janela % está a mais de 2 semanas (%)', p_window, v_win.starts_at_utc;
  end if;

  -- M2-1: antecedência mínima da PROFESSORA no destino (remarcação E resgate).
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_win.teacher_id;
  if not p_bypass_lead
     and v_win.starts_at_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'esse horário exige % h de antecedência — escolha um mais à frente',
      coalesce(v_lead, 12);
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

  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
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

  -- ALTERADO (passe adversarial do Lote 1): 5º andar da ordem canônica, na
  -- sub-ordem do adendo do c10 — `makeup_spend` (do contrato) ANTES de
  -- `teacher_agenda` (da professora). Os dois são reentrantes: `spend_makeup`
  -- pede o primeiro adiante e o `insert` da aula pede o segundo pelo gatilho
  -- `class_instances_horario_em_pausa`.
  -- `v_contract.id` (e não `v_contract_id`) de propósito: é a grafia que o
  -- teste-guarda da ordem canônica lê em `m3-c8-revisao-9.test.ts` — as duas
  -- valem o mesmo uuid (a linha foi lida logo acima), e trocar a grafia cegaria
  -- a prova de que a janela é travada ANTES do advisory.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || v_win.teacher_id::text, 0));

  -- ALTERADO (passe adversarial do Lote 1): A DURAÇÃO DA AULA QUE VAI NASCER,
  -- derivada UMA vez, aqui, para os dois caminhos — é ela que fecha a faixa que
  -- o cinto do bloqueio examina, e no resgate é a MESMA que o `insert` usa.
  --
  -- ── O INTERVALO É EXATO, E O MINUTO É SÓ PARA O AUDIT (Sol · rodada 2) ────
  -- A primeira versão derivava MINUTOS INTEIROS por `round(epoch/60)` e
  -- reconstruía a faixa com `make_interval(mins => …)`. Só que
  -- `reschedule_class_at` preserva `v_old.ends_at_utc - v_old.starts_at_utc`
  -- EXATO, e a coluna aceita duração com segundos (o CHECK novo desta migration
  -- é de FAIXA — 15..480 min —, não de granularidade). Uma aula de 30m20s às
  -- 23:30 era medida como "30 min", passava pelo cinto e renascia 20 segundos
  -- DENTRO do bloqueio. O cinto voltava a mentir exatamente no caso que ele
  -- existe para pegar. Agora a faixa é fechada pelo intervalo REAL; o inteiro
  -- continua existindo só onde ele é rótulo (o `duration_min` do audit).
  if p_instance is not null then
    -- remarcação: a aula herda a duração da original (é o que
    -- `reschedule_class_at` faz com `v_old.ends_at_utc - v_old.starts_at_utc`).
    select ci.ends_at_utc - ci.starts_at_utc
      into v_dur
      from class_instances ci where ci.id = p_instance;
    v_duration_min := round(extract(epoch from v_dur) / 60)::int;
  else
    -- ALTERADO (c8 · R1): a linha já está travada lá em cima; aqui é só a
    -- releitura do estado sobre o qual esta transação decide.
    -- As validações do resgate SOBEM junto com a leitura da duração porque são
    -- a mesma decisão (qual aula vai nascer), e a ordem RELATIVA entre elas —
    -- tipo → status → duração — é a de antes: nenhuma mensagem de erro do
    -- resgate troca de lugar com outra do resgate.
    select * into v_contract from contracts where id = v_contract_id;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;

    select rc.duration_min into v_credit_dur
    from public._makeup_remaining_credits(v_contract.id) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord
    limit 1;

    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;

    v_duration_min := coalesce(v_credit_dur, v_slot_dur);
    if v_duration_min is null then
      raise exception 'contrato % não tem duração para o resgate (crédito sem duração e sem slot ativo)', v_contract.id;
    end if;
    -- No resgate a duração NASCE em minutos inteiros (a coluna `duration_min` do
    -- crédito e a do slot), então aqui o intervalo exato É o minuto — e é este
    -- mesmo valor que o `insert` lá embaixo usa, uma conta só.
    v_dur := make_interval(mins => v_duration_min);
  end if;

  -- ALTERADO (A6/e, corrigido no passe adversarial do Lote 1): o bloqueio criado
  -- DEPOIS da publicação fecha o horário — e a pergunta é da AULA INTEIRA, não
  -- do instante da janela. Faixa `[início, fim)` contra faixa `[início, fim)` do
  -- bloqueio: a aula de 60 min que começa às 23:30 da véspera invade o dia
  -- bloqueado e é recusada; a de 30 min que termina 00:00 em ponto, não.
  v_ends := v_win.starts_at_utc + v_dur;
  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = v_win.teacher_id
    and e.kind = 'block'
    and tstzrange(v_win.starts_at_utc, v_ends) && tstzrange(e.starts_at_utc, e.ends_at_utc)
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'esse horário foi bloqueado pela professora (%) — escolha outro', v_block;
  end if;

  if p_instance is not null then
    v_new_id := public.reschedule_class_at(
      p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor,
      p_courtesy, p_courtesy_note, true);  -- lead já checado sobre a janela
  else
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       -- o MESMO fim que o cinto acabou de examinar (uma conta só)
       v_ends,
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

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
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc,
      'duration_min', v_duration_min,
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead));

  return v_new_id;
end;
$function$;


-- ###########################################################################
-- 6 · `add_teacher_block` fecha as janelas publicadas do período (item f)
-- ###########################################################################
--
-- O retorno muda (`uuid` → `jsonb`) ⇒ DROP + CREATE + grants reemitidos.
--
-- A frase que a tela dizia — "horário de remarcação já publicado segue
-- reservável pelo aluno: despublique-o na grade para fechar de vez" — era
-- VERDADE e agora deixa de ser: o bloqueio fecha a oferta de uma vez, na mesma
-- transação. Quem prometia demais era a frase da professora ("nenhum horário
-- será ofertado no período"); ela passa a ser verdade para JANELAS.
--
-- O que continua FORA, de propósito:
--   · AULA já marcada não é tocada (o destino dela é o tratamento de período —
--     cancelar com crédito, convidar a remarcar, ou só bloquear);
--   · janela `consumida` não volta atrás: ela já virou aula, e aula é do
--     tratamento de período.
--
-- LOCKS: as linhas de janela são travadas em ordem determinística de `id` antes
-- do update — duas chamadas concorrentes para a mesma professora pediriam as
-- mesmas linhas em ordem de varredura (que o Postgres não garante) e podiam
-- travar uma na outra. `reschedule_windows` é o 3º andar da ordem canônica
-- global e esta função não pede NADA dos andares 1 e 2; depois dele vem o
-- advisory `teacher_agenda:<professora>` (5º andar), e só então o `insert` da
-- exceção. O alcance e o limite dessa serialização estão na seção 0.

drop function public.add_teacher_block(uuid, date, date, text, uuid);

create function public.add_teacher_block(
  p_teacher uuid,
  p_from date,
  p_to date,
  p_note text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tz text;
  v_id uuid;
  v_actor uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_closed int;
begin
  if not public._can_manage_teacher(p_teacher) then
    raise exception 'bloqueio de agenda é da própria professora ou da admin (D10)';
  end if;
  if p_to < p_from then
    raise exception 'período invertido (% → %)', p_from, p_to;
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- As MESMAS fronteiras civis de sempre (dia inteiro na zona DELA, com o
  -- offset daquele dia — Lei 1), agora nomeadas para servirem duas vezes.
  v_starts := (p_from + time '00:00') at time zone v_tz;
  v_ends := ((p_to + 1) + time '00:00') at time zone v_tz;

  -- ALTERADO (A6/f): as janelas PUBLICADAS do período saem da oferta na MESMA
  -- transação. `state = 'cancelada'` é o mesmo estado que a despublicação manual
  -- grava (`cancel_reschedule_window`), e o CHECK `..._consumed_shape` continua
  -- satisfeito (só `consumida` exige instância).
  --
  -- ALTERADO (passe adversarial do Lote 1): este bloco SUBIU para antes do
  -- `insert` da exceção. Ele é o 3º andar da ordem canônica global e o advisory
  -- da agenda é o 5º — pedir o advisory primeiro inverteria o par contra
  -- `book_reschedule_window`/`book_computed_slot`, que seguram a janela e pedem
  -- `teacher_agenda` no `insert` da aula (deadlock 40P01 no meio de uma
  -- reserva). Ver o que ISSO deixa em aberto na seção 0 do cabeçalho.
  with alvo as (
    select w.id
      from reschedule_windows w
     where w.teacher_id = p_teacher
       and w.state = 'publicada'
       and w.starts_at_utc >= v_starts
       and w.starts_at_utc < v_ends
     order by w.id
       for update
  )
  update reschedule_windows w
     set state = 'cancelada'
   where w.id in (select id from alvo);
  get diagnostics v_closed = row_count;

  -- ALTERADO (passe adversarial do Lote 1): 5º andar, depois do 3º. Daqui até o
  -- commit, nenhuma outra porta desta professora decide sobre a agenda dela: a
  -- publicação de horário (que LÊ os bloqueios) e as duas portas de criação de
  -- aula esperam. É por isso que o `insert` da exceção desceu para depois dele —
  -- é este `insert` o estado que os outros leem do outro lado.
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  insert into teacher_availability_exceptions
    (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot, note, created_by)
  values
    (p_teacher, 'block', v_starts, v_ends,
     p_from || ' → ' || p_to || ' ' || v_tz, p_note, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'add_teacher_block', 'teacher_availability_exceptions', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'from', p_from, 'to', p_to, 'note', p_note,
                       'closed_windows', v_closed));
  return jsonb_build_object('exception_id', v_id, 'closed_windows', v_closed);
end;
$fn$;

comment on function public.add_teacher_block(uuid, date, date, text, uuid) is
  'A6/f: além de gravar a exceção `block` do dia civil inteiro (na zona da '
  'professora, offset daquele dia — Lei 1), CANCELA as janelas de remarcação '
  'PUBLICADAS do período, na mesma transação. Devolve '
  '{exception_id, closed_windows}. Aula já marcada continua de pé de propósito '
  '— o destino dela é `admin_period_treatment`.';

revoke execute on function public.add_teacher_block(uuid, date, date, text, uuid) from public, anon;
grant execute on function public.add_teacher_block(uuid, date, date, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 6.1 · `admin_period_treatment` acompanha o retorno novo
-- ---------------------------------------------------------------------------
--
-- Reemissão integral do corpo VIVO (20260718000700_f5_disponibilidade.sql) com
-- DUAS mudanças mínimas:
--
--   1. `v_block` passa a sair de `add_teacher_block(...) ->> 'exception_id'`.
--      O contrato de retorno da função (`{block, cancelled, invited}`) NÃO muda
--      aqui — as chaves de desfecho (`credited`/`refund_blocked`) são do lote 2.
--
--   2. A CHAMADA DO BLOQUEIO DESCE PARA DEPOIS DO LAÇO, e isso não é
--      cosmético: com o item f, `add_teacher_block` passou a travar linhas de
--      `reschedule_windows` (3º andar da ordem canônica global de locks), e o
--      laço abaixo chama `_cancel_class_core`, que pede `contracts` (1º) e
--      `class_instances` (2º). Fazer 3 → 1 é exatamente o ciclo que a ordem
--      canônica existe para proibir: uma transação segurando a janela e pedindo
--      o contrato, outra (`book_reschedule_window`) segurando o contrato e
--      pedindo a janela = deadlock na cara da dona no meio de uma reserva.
--      Tudo continua numa transação só, então "fecha a oferta SEMPRE" continua
--      literal: se qualquer cancelamento estourar, o bloqueio também não existe.

create or replace function public.admin_period_treatment(
  p_teacher uuid,
  p_from date,
  p_to date,
  p_mode text,
  p_note text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_tz text;
  v_block uuid;
  v_row record;
  v_cancelled uuid[] := array[]::uuid[];
  v_invited uuid[] := array[]::uuid[];
  v_rows int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_period_treatment é restrita à admin (D10)';
  end if;
  if p_mode not in ('cancel_credit', 'invite_reschedule', 'block_only') then
    raise exception 'modo % inválido (cancel_credit | invite_reschedule | block_only)', p_mode;
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  for v_row in
    select ci.id, ci.starts_at_utc, ci.local_time_snapshot, c.id as contract_id
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    where ci.teacher_id = p_teacher
      and ci.state = 'scheduled'
      and ci.starts_at_utc > now()
      and (ci.starts_at_utc at time zone v_tz)::date between p_from and p_to
    order by ci.starts_at_utc
  loop
    if p_mode = 'cancel_credit' then
      -- culpa da escola: crédito com validade-180 (M3-1), estorno-aware, AVISA (P4)
      perform public._cancel_class_core(v_row.id, 'teacher', now(), v_actor, 'period');
      v_cancelled := v_cancelled || v_row.id;
    elsif p_mode = 'invite_reschedule' then
      -- P5: comunicação em lote com deep link — a aula PERMANECE; nada de
      -- franquia/crédito tocado; quem age é o aluno pelo fluxo normal.
      insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
      select 'period-reschedule-invite', s.profile_id,
             jsonb_build_object(
               'instance_id', v_row.id, 'student_id', s.id,
               'starts_at_utc', v_row.starts_at_utc,
               'local_time_snapshot', v_row.local_time_snapshot,
               'iana_tz', s.iana_tz,
               'teacher_name', (select t.display_name from teachers t where t.id = p_teacher),
               'note', p_note),
             format('period-invite:%s:%s', v_row.id, s.id)
      from (
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        left join students st on st.id = c2.student_id
        where c2.id = v_row.contract_id and c2.student_id is not null
        union
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        join student_group_members m on m.group_id = c2.student_group_id
        join students st on st.id = m.student_id
        where c2.id = v_row.contract_id
      ) s
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_invited := v_invited || v_row.id;
      end if;
    end if;
  end loop;

  -- fecha a oferta SEMPRE (o período é indisponível de qualquer modo) — e, desde
  -- o A6/f, isso inclui cancelar as janelas publicadas do período.
  v_block := (public.add_teacher_block(p_teacher, p_from, p_to,
    coalesce(p_note, 'tratamento de período'), v_actor) ->> 'exception_id')::uuid;

  perform public.log_audit(v_actor, 'period_treatment', 'teachers', p_teacher::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'mode', p_mode, 'note', p_note,
                       'block_exception', v_block,
                       'cancelled_instances', to_jsonb(v_cancelled),
                       'invited_instances', to_jsonb(v_invited)));

  return jsonb_build_object('block', v_block,
                            'cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'invited', coalesce(array_length(v_invited, 1), 0));
end;
$fn$;


-- ###########################################################################
-- 7 · `remove_teacher_block` confere `kind` (item g)
-- ###########################################################################
--
-- Assinatura intocada ⇒ `create or replace`. A função da F5 apagava QUALQUER
-- exceção pelo id: um uuid de `kind = 'open'` saía apagado com a frase verde de
-- bloqueio, e o painel da professora (`src/app/teacher/actions.ts`) chamava sem
-- ler `kind` nenhum. A antecipação em TS do admin FICA (Lei 3 — ela dá a frase
-- em português antes da ida ao banco); o que muda é que agora existe o cinto.

create or replace function public.remove_teacher_block(p_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row teacher_availability_exceptions%rowtype;
begin
  select * into v_row from teacher_availability_exceptions where id = p_id;
  if not found then
    raise exception 'exceção % não existe', p_id;
  end if;
  if not public._can_manage_teacher(v_row.teacher_id) then
    raise exception 'bloqueio de agenda é da própria professora ou da admin (D10)';
  end if;
  -- ALTERADO (A6/g): esta porta é a do BLOQUEIO. Exceção `open` se remove por
  -- onde ela é criada — remover pela porta errada apagava disponibilidade
  -- aberta dizendo "bloqueio removido".
  if v_row.kind <> 'block' then
    raise exception 'a exceção % não é um bloqueio (kind = %) — esta porta remove bloqueio, e apagar disponibilidade aberta por aqui seria remover a coisa errada', p_id, v_row.kind;
  end if;
  delete from teacher_availability_exceptions where id = p_id;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'remove_teacher_block',
    'teacher_availability_exceptions', p_id::text,
    jsonb_build_object('teacher_id', v_row.teacher_id, 'snapshot', v_row.local_snapshot));
end;
$fn$;


-- ###########################################################################
-- 8 · ACESSO AO PORTAL NÃO NASCE SEM WHATSAPP (item i)
-- ###########################################################################
--
-- A correção do dono de 28/07 tornou o WhatsApp canal de CONTRATO: quem tem
-- acesso ao portal tem número. Até aqui essa regra vivia SÓ no TypeScript (o
-- motor `provisionStudent` e a RPC `admin_create_student_profile`), e o
-- comentário da migration 95 dizia isso sem eufemismo — o CHECK da coluna
-- aceita NULL de propósito e não havia gatilho proibindo o estado.
--
-- O gatilho `students_lead_sem_login` já é o porteiro do NASCIMENTO do vínculo
-- (dispara em `profile_id` null→not null) e já recusa lead, arquivado e
-- anonimizado. Ganha a quarta recusa.
--
-- POR QUE NÃO UM CHECK EM `profiles` (decisão registrada, não esquecimento):
--   · a ANONIMIZAÇÃO mantém `role = 'student'` e limpa o número — um CHECK
--     condicional ao papel quebraria a LGPD;
--   · a LIMPEZA deliberada pelo admin pela ficha é decisão ACEITA
--     (migration 95, cabeçalho): ele é dono do dado e precisa poder corrigir.
-- O que o banco passa a garantir é EXATAMENTE o que o TS promete: acesso não
-- NASCE sem número. Conta legada sem número continua existindo — a decisão do
-- dono sobre elas é do rito de deploy (pré-voo da 95 lista quantas são).
--
-- `security definer`: o gatilho lê `profiles`, que tem RLS. Sem isto a leitura
-- dependeria de quem executa o UPDATE (hoje é `service_role`, que passa; amanhã
-- pode ser a admin autenticada) e uma linha invisível viraria recusa de um
-- vínculo legítimo. O `set search_path` já estava aqui.

create or replace function public.students_lead_sem_login()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_numero text;
begin
  if new.profile_id is not null and old.profile_id is null then
    -- ALTERADO (c8 · R2): a ficha ANONIMIZADA é terminal (P5 da revisão nº 8) —
    -- e a checagem vem antes da de status porque é a mais grave: dar login a ela
    -- é ressuscitar dado que a LGPD mandou apagar.
    if new.anonymized_at is not null then
      raise exception
        'ficha anonimizada em % não recebe acesso ao portal (%): cadastre a pessoa de novo',
        new.anonymized_at, new.display_name;
    end if;
    if new.status = 'lead' then
      raise exception
        'lead não tem portal (%): o cadastro vira aluno quando o contrato nasce — convide depois disso',
        new.display_name;
    end if;
    -- ALTERADO (c8 · R2): arquivado é ex-aluno; reative (contrato novo promove)
    -- antes de convidar.
    if new.status = 'archived' then
      raise exception
        'cadastro arquivado não recebe acesso ao portal (%): reative antes de convidar',
        new.display_name;
    end if;
    -- ALTERADO (A6/i): o número é canal de CONTRATO.
    select p.whatsapp_e164 into v_numero from profiles p where p.id = new.profile_id;
    if v_numero is null then
      raise exception
        'aluno com acesso precisa de número de WhatsApp — regra do contrato (%): cadastre o número no perfil antes de vincular o acesso',
        new.display_name;
    end if;
  end if;
  return new;
end;
$fn$;

revoke execute on function public.students_lead_sem_login()
  from public, anon, authenticated, service_role;


-- ###########################################################################
-- 9 · `reschedule_class` (a conversora civil de 7 args) — FICA, com lápide
-- ###########################################################################
--
-- A spec do A6 mandava DROPar SE a varredura provasse que nenhuma função do
-- banco a chama. A varredura foi feita e o resultado é misto, então fica
-- registrado por escrito em vez de decidido no escuro:
--
--   · nenhuma função de migration a chama (o grep por `reschedule_class(`,
--     descontando `reschedule_class_at(`, só encontra a própria definição, o
--     `drop` da assinatura da Fase 1 e os revokes);
--   · nenhum arquivo de `src/` a chama (as ocorrências lá são o NOME DA AÇÃO no
--     `audit_log`, gravado por `reschedule_class_at`, não a função);
--   · MAS a suíte a exercita em ~12 lugares (`tests/makeup.test.ts`, um
--     `describe` inteiro, e `tests/f2-acoes-aula.test.ts`), e nenhum desses
--     arquivos estava na lista de testes que a spec autorizou reescrever.
--
-- Dropar exigiria reescrever aquele bloco para `reschedule_class_at`, o que é
-- mecânico mas amplia o lote sem necessidade: a função é `security definer`,
-- está REVOGADA de `public`/`anon`/`authenticated` (nenhum cliente a alcança) e
-- a conversão que ela faz é a canônica da Lei 1 no Postgres
-- (`(date + time) at time zone tz`) — ela não é um caminho que possa gravar um
-- instante que ninguém escolheu por conta própria, porque quem a chama passa
-- data e hora explícitas.
--
-- ⚠️ O QUE ELA NÃO É, para não confundir quem chegar depois: ela NÃO é porta de
-- produto. As portas vivas da remarcação são `reschedule_class_at` (instante) e
-- `book_reschedule_window` (janela). Se um dia a suíte deixar de chamá-la, o
-- gesto certo é DROPar — não reanimá-la.
