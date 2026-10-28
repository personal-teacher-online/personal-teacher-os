-- CORREÇÕES DA REVISÃO ADVERSARIAL Nº 7 (Sol, 27/07/2026) — a parte de banco.
--
-- Lei 7: nada de migration antiga foi tocado. Cada corpo abaixo é o corpo VIVO
-- reemitido com o MÍNIMO alterado, e a alteração vem comentada no lugar dela.
--
-- E1 — NULL não pode virar crédito eterno (`admin_extend_credit`, `_reissue_credit`).
-- E2 — extensão só em contrato ATIVO, com a mesma ordem de locks do pause/resume.
-- E3a — criação de horário fixo ATÔMICA (`materialize_slot` ganha modo estrito;
--       `create_slot` passa a usá-lo).
-- E7 — primeira nota interna sem perder versão (`admin_set_student_note`).

-- ===========================================================================
-- E1+E2 · _reissue_credit e admin_extend_credit
-- ===========================================================================
--
-- E1 — O BURACO: em SQL, `p_new_expires_on <= v_atual` com `p_new_expires_on`
-- NULL não é FALSE, é NULL — e `if NULL then` não entra. Ou seja: a guarda de
-- monotonicidade que a revisão nº 6 instalou (S2) era atravessada por baixo por
-- uma chamada com a data em branco, e o par −1/+1 nascia com `expires_on = null`.
-- Crédito com `expires_on` nulo é crédito ETERNO: `_makeup_remaining_credits`
-- troca o null por `'infinity'::date`, e o saldo, que só ignora vencidos, passa
-- a carregá-lo para sempre. Erro de crédito é erro de dinheiro (CLAUDE.md).
-- O mesmo vale para `_reissue_credit`, onde `p_new_expires_on < p_today` também
-- é NULL-transparente. A recusa entra EXPLÍCITA e ANTES de qualquer comparação,
-- nas duas funções (a de baixo é a que de fato escreve no ledger; a de cima
-- recusa mais cedo, para a admin ler a frase da AÇÃO que ela pediu).
--
-- Nenhum chamador legítimo passa NULL: os quatro call sites de `_reissue_credit`
-- (retomada de pausa, as duas transferências da F4 e o ADR-018) leem a validade
-- de `_makeup_remaining_credits`, que já devolve `'infinity'::date` no lugar de
-- null — a guarda nova é rede, não mudança de contrato. O REVIVAL DA PAUSA
-- continua intacto: ele passa `v_row.expires_on + v_days`, sempre uma data.
--
-- E2 — O BURACO: `admin_extend_credit` nunca leu `contracts.status`. Um contrato
-- PAUSADO tem o crédito congelado por decisão do dono (F3-D10: "se pausa o
-- contrato, o crédito pausa junto") e é a RETOMADA que estende a validade pelos
-- dias parados. Estender à mão durante a pausa criava um crédito NOVO
-- (`created_at` de agora) que a retomada não alcança — `resume_contract` só
-- revive o que tem `ml.created_at < v_pause.created_at`. Resultado: crédito
-- fora do congelamento, com validade menor do que a política promete.
-- E havia corrida: o pause/resume trava a LINHA do contrato antes de tudo; a
-- extensão só pegava o advisory lock do ledger, então as duas transações não se
-- viam. A ordem de locks agora é a MESMA das duas pontas —
--    1º `contracts` FOR UPDATE  →  2º advisory 'makeup_spend:<contrato>'
-- (em `pause_contract`/`resume_contract`: contrato FOR UPDATE, depois a pausa
-- FOR UPDATE, e o advisory só lá dentro do `_reissue_credit`). Mesma ordem em
-- toda transação = sem deadlock; e a leitura do status DEPOIS do lock = sem
-- decidir sobre estado velho.

create or replace function public._reissue_credit(
  p_ledger_id bigint,
  p_new_expires_on date,
  p_actor uuid,
  p_note text default null,
  p_new_contract uuid default null,
  p_today date default public.business_today()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orig makeup_ledger%rowtype;
  v_target uuid;
  v_new_id bigint;
begin
  -- E1: ANTES de qualquer comparação. `null < p_today` é NULL, não FALSE — a
  -- guarda de baixo deixaria passar, e o +1 nasceria sem prazo (= eterno).
  if p_new_expires_on is null then
    raise exception 'relançamento de crédito exige uma validade nova — nula criaria crédito sem prazo (eterno)';
  end if;

  select * into v_orig from makeup_ledger where id = p_ledger_id;
  if not found or v_orig.delta <= 0 then
    raise exception 'relançamento exige um crédito (+1) existente — ledger % inválido', p_ledger_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_orig.contract_id::text, 0));
  -- só crédito AINDA VIVO no replay (não gasto, não vencido) — vivo NA DATA DO
  -- CHAMADOR (p_today), nunca no relógio próprio (correção de 23/07)
  if not exists (
    select 1 from public._makeup_remaining_credits(v_orig.contract_id) rc
    where rc.ledger_id = p_ledger_id and rc.expires_on >= p_today
  ) then
    raise exception 'crédito % não está vivo (gasto ou vencido) — nada a relançar', p_ledger_id;
  end if;
  if p_new_expires_on < p_today then
    raise exception 'nova validade (%) no passado', p_new_expires_on;
  end if;

  v_target := coalesce(p_new_contract, v_orig.contract_id);
  if v_target <> v_orig.contract_id and not exists (
    select 1 from contracts c where c.id = v_target and c.contract_type = 'private_1on1'
  ) then
    raise exception 'contrato destino % inválido para transferência de crédito', v_target;
  end if;

  -- débito DIRIGIDO: o replay honra consumes_ledger_id e apaga exatamente este
  insert into makeup_ledger
    (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
  values
    (v_orig.contract_id, v_orig.student_id, -1, 'manual_adjust', p_ledger_id, p_note, p_actor);

  -- reemissão preservando duração + origem (aula geradora) + validade nova
  insert into makeup_ledger
    (contract_id, student_id, delta, reason, class_instance_id, expires_on,
     duration_min, note, created_by)
  values
    (v_target, v_orig.student_id, 1, 'manual_adjust', v_orig.class_instance_id,
     p_new_expires_on, v_orig.duration_min, p_note, p_actor)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reissue_credit', 'makeup_ledger', v_new_id::text,
    jsonb_build_object(
      'from_ledger', p_ledger_id, 'from_contract', v_orig.contract_id,
      'to_contract', v_target, 'old_expires_on', v_orig.expires_on,
      'new_expires_on', p_new_expires_on, 'duration_min', v_orig.duration_min,
      'note', p_note));
  return v_new_id;
end;
$$;

comment on function public._reissue_credit(bigint, date, uuid, text, uuid, date) is
  'Par −1/+1 dirigido que relança UM crédito vivo com validade nova (Lei 2). '
  'Recusa validade NULA (criaria crédito eterno — E1 da revisão nº 7).';

create or replace function public.admin_extend_credit(
  p_ledger bigint,
  p_new_expires_on date,
  p_note text default null,  -- default só para o PostgREST resolver a chamada; a função RECUSA null/vazio
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row makeup_ledger%rowtype;
  v_contract contracts%rowtype;
  v_atual date;
  v_new_id bigint;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_extend_credit é restrita à admin (D10)';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'estender validade exige motivo (M3-2)';
  end if;
  -- E1: a data em branco é recusada AQUI, antes de qualquer comparação — em SQL
  -- `p_new_expires_on <= v_atual` com NULL não é falso, é NULL, e a guarda de
  -- monotonicidade lá embaixo seria atravessada por baixo.
  if p_new_expires_on is null then
    raise exception 'informe a nova data de validade — em branco criaria um crédito sem prazo';
  end if;

  select * into v_row from makeup_ledger where id = p_ledger;
  if not found then
    raise exception 'lançamento % não existe', p_ledger;
  end if;

  -- E2 · PRIMEIRO LOCK: a linha do CONTRATO, exatamente como pause_contract e
  -- resume_contract fazem antes de qualquer outra coisa. Mesma ordem em toda
  -- transação = sem deadlock; e o status lido DEPOIS do lock é o status sobre o
  -- qual esta transação decide (sem ele, a extensão passava por dentro de uma
  -- pausa que estava commitando ao lado).
  select * into v_contract from contracts where id = v_row.contract_id for update;
  if not found then
    raise exception 'contrato % do lançamento % não existe', v_row.contract_id, p_ledger;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'extensão de validade é de créditos de reposição (particulares)';
  end if;
  -- E2 · e o crédito de contrato PAUSADO está congelado por decisão do dono
  -- (F3-D10): quem estende é a RETOMADA, pelos dias parados. Estender à mão
  -- durante a pausa cria um lançamento novo que o revival não alcança (ele só
  -- revive o que nasceu ANTES da pausa) — crédito fora do congelamento.
  if v_contract.status = 'paused' then
    raise exception
      'contrato pausado: o crédito está congelado e a validade é estendida na RETOMADA — retome antes de estender (contrato %)',
      v_contract.id;
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato encerrado não se estende (contrato %, estado %)',
      v_contract.id, v_contract.status;
  end if;

  -- SEGUNDO LOCK: o do gasto ('makeup_spend:<contrato>'), de transação — o
  -- `_reissue_credit` o repega adiante sem se bloquear. A validade atual do
  -- alvo é lida DEPOIS dele: é estado sobre o qual esta transação vai decidir.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_row.contract_id::text, 0));

  select rc.expires_on into v_atual
  from public._makeup_remaining_credits(v_row.contract_id) rc
  where rc.ledger_id = p_ledger
  order by rc.ord
  limit 1;

  if v_atual is null then
    raise exception 'crédito % já foi gasto — nada a estender', p_ledger;
  end if;
  if v_atual = 'infinity'::date then
    raise exception 'crédito % não tem prazo de validade — não há o que estender', p_ledger;
  end if;
  if v_atual < public.business_today() then
    raise exception
      'crédito vencido não se estende; reativação é operação distinta e não existe hoje '
      '(crédito %, venceu em %) — para devolver crédito a este aluno, use o ajuste manual',
      p_ledger, v_atual;
  end if;
  if p_new_expires_on <= v_atual then
    raise exception
      'estender só empurra a validade para FRENTE: a nova (%) precisa ser posterior à atual (%)',
      p_new_expires_on, v_atual;
  end if;

  -- crédito VIVO: par −1/+1 dirigido (preserva duração+origem, audita) — P6.
  v_new_id := public._reissue_credit(p_ledger, p_new_expires_on,
                                     coalesce(auth.uid(), p_actor), p_note);
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'admin_extend_credit',
    'makeup_ledger', v_new_id::text,
    jsonb_build_object('from_ledger', p_ledger, 'contract_id', v_row.contract_id,
                       'old_expires_on', v_atual, 'new_expires_on', p_new_expires_on,
                       'note', p_note));
  return v_new_id;
end;
$$;

comment on function public.admin_extend_credit(bigint, date, text, uuid) is
  'Empurra para FRENTE a validade de UM crédito de reposição AINDA VIVO, de '
  'contrato ATIVO, pelo par −1/+1 do _reissue_credit. Ordem de locks igual à do '
  'pause/resume (contrato FOR UPDATE → advisory do ledger). Recusa: data nula, '
  'contrato pausado ou encerrado, alvo gasto, alvo vencido, alvo sem prazo e '
  'data nova <= validade atual. Motivo obrigatório; auditada (revisões nº 6 e 7).';

revoke execute on function public.admin_extend_credit(bigint, date, text, uuid)
from public, anon;
grant execute on function public.admin_extend_credit(bigint, date, text, uuid) to authenticated;

-- ===========================================================================
-- E3a · criação de horário fixo ATÔMICA
-- ===========================================================================
--
-- O BURACO: `materialize_slot` captura `exclusion_violation`/`unique_violation`,
-- registra WARNING + `audit_log` e SEGUE para a próxima ocorrência. Isso é o
-- comportamento CERTO da rotina em massa (cron de domingo, retomada de pausa,
-- backfill): um slot problemático não pode derrubar a materialização da escola
-- inteira. É o comportamento ERRADO no caminho interativo: a admin cria o
-- horário fixo no wizard, `create_slot` devolve sucesso, a tela diz "Contrato e
-- horários criados. ✓" — e faltam semanas de aula na agenda, silenciosamente.
--
-- A FORMA ESCOLHIDA, e por que é a mais simples: um parâmetro `p_strict` com
-- DEFAULT FALSE. Só existem DOIS chamadores diretos vivos de `materialize_slot`:
-- `resume_contract` (caminho em massa — re-materializa todos os slots do
-- contrato depois de uma pausa longa) chama com 2 argumentos e continua caindo
-- no default, zero alteração e zero risco; e `create_slot`, que passa `true`.
-- Aí o primeiro conflito vira exceção que propaga: a transação inteira da RPC
-- reverte (o `recurring_slots` não fica, as instâncias já inseridas somem) e a
-- criação é atômica de verdade. `close_and_create_slot` delega a `create_slot`,
-- então a troca de horário — que também é gesto interativo da admin — herda o
-- modo estrito de graça, que é o certo: trocar para um horário ocupado tem de
-- falhar inteiro, sem fechar o horário antigo.
-- O `materialize_instances` do cron de domingo é OUTRA função e não foi tocado.
-- A alternativa "create_slot confere criadas = esperadas" exigiria repetir em
-- `create_slot` a mesma caminhada de datas com offset por dia — duas cópias da
-- Lei 1 para manter em dia. Um booleano custa menos.
--
-- DROP + CREATE (não CREATE OR REPLACE): parâmetro novo = assinatura nova. Com
-- as duas versões vivas, `materialize_slot(x, 8)` ficaria ambíguo. Chamada em
-- plpgsql resolve em runtime, então os call sites existentes seguem válidos.

drop function public.materialize_slot(uuid, int);

create function public.materialize_slot(
  p_slot uuid,
  p_weeks int default 8,
  p_strict boolean default false
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_date date;
  v_end_date date;
  v_starts timestamptz;
  v_created int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('materialize_slot:' || p_slot::text, 0));

  select rs.* into r
  from recurring_slots rs
  join contracts c on c.id = rs.contract_id
  where rs.id = p_slot and c.status = 'active';
  if not found then
    return 0;
  end if;

  v_date := (now() at time zone r.iana_tz)::date;
  v_end_date := v_date + (p_weeks * 7);
  v_date := v_date + ((r.weekday - extract(dow from v_date)::int + 7) % 7);

  while v_date <= v_end_date loop
    if v_date >= r.active_from and (r.active_to is null or v_date <= r.active_to) then
      v_starts := (v_date + r.local_time) at time zone r.iana_tz;
      if v_starts > now() then
        begin
          insert into class_instances
            (contract_id, teacher_id, slot_id, occurrence_date,
             starts_at_utc, ends_at_utc, local_time_snapshot)
          values
            (r.contract_id, r.teacher_id, r.id, v_date,
             v_starts, v_starts + make_interval(mins => r.duration_min),
             to_char(v_date, 'YYYY-MM-DD') || ' ' || to_char(r.local_time, 'HH24:MI') || ' ' || r.iana_tz)
          on conflict (slot_id, occurrence_date) where slot_id is not null
          do nothing;
          if found then
            v_created := v_created + 1;
          end if;
        exception
          when exclusion_violation or unique_violation then
            -- E3a: no caminho INTERATIVO o conflito é fatal e nomeado — quem
            -- pediu o horário precisa saber que ele não existe, e a transação
            -- inteira reverte (nada de slot criado com semanas faltando).
            if p_strict then
              raise exception
                'a professora já tem aula em % às % (%) — o horário fixo NÃO foi criado',
                to_char(v_date, 'DD/MM/YYYY'), to_char(r.local_time, 'HH24:MI'), r.iana_tz
                using errcode = 'exclusion_violation';
            end if;
            -- Caminho em MASSA (cron, retomada de pausa, backfill): pula ESTA
            -- ocorrência, segue o lote, e deixa o problema visível (Lei 8).
            raise warning 'conflito de agenda ao materializar slot % em %: %', r.id, v_date, sqlerrm;
            insert into audit_log (action, entity, entity_id, diff)
            values ('materialize_conflict', 'recurring_slots', r.id::text,
                    jsonb_build_object('occurrence_date', v_date, 'error', sqlerrm));
        end;
      end if;
    end if;
    v_date := v_date + 7;
  end loop;

  return v_created;
end;
$$;

comment on function public.materialize_slot(uuid, int, boolean) is
  'Materializa as ocorrências de UM slot. p_strict=false (default, caminho em '
  'massa): conflito de agenda vira warning + audit_log e o lote segue. '
  'p_strict=true (caminho interativo, create_slot): o primeiro conflito vira '
  'exceção nomeada e a transação inteira reverte — criação atômica (E3a da '
  'revisão nº 7).';

revoke execute on function public.materialize_slot(uuid, int, boolean)
from public, anon, authenticated;

-- create_slot: corpo VIVO (20260719000100) reemitido com UMA mudança — o
-- `true` do modo estrito. Sem ele a RPC dizia "criado" com a agenda furada.
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

  select * into v_contract from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'slots são de contratos private_1on1';
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

  -- E3a: ESTRITO. Este é o caminho interativo (wizard de admissão e ação avulsa
  -- da ficha): conflito de agenda derruba a transação inteira em vez de deixar
  -- um horário fixo com semanas faltando e a tela dizendo "criado ✓".
  perform public.materialize_slot(v_id, 8, true);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$function$;

-- ===========================================================================
-- E7 · primeira nota interna sem perder versão
-- ===========================================================================
--
-- O BURACO: `select ... from student_notes where student_id = p_student for
-- update` não trava NADA quando a linha ainda não existe — `FOR UPDATE` tranca
-- linhas encontradas, e não há linha na PRIMEIRA gravação. Duas pessoas
-- salvando a primeira nota ao mesmo tempo liam ambas `v_antes = null`, o upsert
-- serializava sozinho (chave primária), e a auditoria ficava com DUAS entradas
-- `old = null`: a cadeia old→new perdia um elo, e o histórico — que é a única
-- razão de a tabela guardar uma linha só — passava a mentir.
--
-- A CORREÇÃO: serializar ANTES da leitura, na linha do ALUNO, que sempre
-- existe. `students` é o pai natural do bilhete; travar o pai é o padrão para
-- serializar a criação de um filho que ainda não nasceu.
create or replace function public.admin_set_student_note(
  p_student uuid,
  p_note text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role  text := public.app_role();
  v_nova  text := nullif(btrim(coalesce(p_note, '')), '');
  v_antes text;
begin
  if v_role not in ('admin', 'teacher') then
    raise exception 'a nota interna é da equipe (admin e professora)';
  end if;
  if v_role = 'teacher'
     and not exists (select 1 from public.teacher_student_ids() t where t = p_student) then
    raise exception 'esta professora não dá aula para este aluno';
  end if;

  -- E7: o lock é na linha do ALUNO (que sempre existe) e vem ANTES da leitura
  -- da nota. Trancar `student_notes` não servia: na PRIMEIRA gravação não há
  -- linha para trancar, e duas transações liam `old = null` ao mesmo tempo.
  -- Isto também substitui o `exists` de existência do aluno: quem não existe
  -- não é encontrado aqui.
  perform 1 from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;

  select note into v_antes from student_notes where student_id = p_student;

  if v_nova is null then
    delete from student_notes where student_id = p_student;
  else
    insert into student_notes (student_id, note, updated_by, updated_at)
    values (p_student, v_nova, auth.uid(), now())
    on conflict (student_id) do update
       set note = excluded.note,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at;
  end if;

  -- Lei 8. A nota é texto sobre uma PESSOA, então o diff guarda as duas
  -- versões: é o histórico que a tabela (uma linha por aluno) não guarda.
  perform public.log_audit(auth.uid(), 'set_student_note', 'student_notes',
    p_student::text, jsonb_build_object('old', v_antes, 'new', v_nova));
end;
$fn$;

comment on function public.admin_set_student_note is
  'Única porta de escrita da nota interna (M3-c5 · D1): gate admin/professora, '
  'upsert, apagar por nota em branco e auditoria dentro da transação. Serializa '
  'na linha do ALUNO antes de ler a nota, para a cadeia old→new da auditoria '
  'não perder elo na PRIMEIRA gravação concorrente (E7 da revisão nº 7).';

revoke execute on function public.admin_set_student_note(uuid, text) from public, anon;
grant execute on function public.admin_set_student_note(uuid, text) to authenticated;
