-- CAMPOS NOVOS DO ALUNO (M3-c5 · D1) — o que a dona pede na admissão e que a
-- ficha ainda não sabia guardar: se o aluno é CRIANÇA ou ADULTO, a data de
-- nascimento, como ele chegou até a escola, e a NOTA INTERNA da equipe.
--
-- Leis tocadas: 3 (a nota só muda por RPC, com gate e auditoria dentro do
-- banco), 4 (RLS negar-por-padrão; o aluno NUNCA lê a nota), 7 (migration nova
-- — nada de anterior foi editado), 8 (auditoria de toda mutação).
--
-- POR QUE A NOTA NÃO É COLUNA DE `students`.
-- O portal lê a PRÓPRIA linha do aluno (`students_self`, RLS de 20260711000700)
-- e RLS não filtra COLUNA: qualquer coisa gravada em `students` é legível pelo
-- dono da ficha no dia em que alguém der um `select *` no portal. A nota
-- interna é justamente o campo que não pode chegar a ele ("mãe difícil",
-- "atrasa sempre", "avaliar troca de professora"). Tabela própria, sem policy
-- de aluno = a única forma de a promessa da tela ser verdade no banco.
--
-- Tipo, nascimento e "como conheceu" SEGUEM em `students`, de propósito: são
-- dados do cadastro que o próprio aluno pode ver sobre si (e que o portal um
-- dia mostrará no perfil dele).

-- ===========================================================================
-- 1. Três campos no cadastro do aluno
-- ===========================================================================

alter table students
  add column student_type text not null default 'adult'
    check (student_type in ('child', 'adult')),
  add column birth_date date,
  add column referral_source text;

comment on column students.student_type is
  'Criança ou adulto. Default ''adult'' porque a base da escola é '
  'majoritariamente adulta — as 20 fichas que já existem nascem corretas sem '
  'backfill, e o wizard passa a PERGUNTAR (M3-c5 · D1).';

comment on column students.birth_date is
  'Data de nascimento (opcional, inclusive para criança — não há regra de '
  'negócio pendurada nela hoje; é dado de relacionamento).';

comment on column students.referral_source is
  'Como o aluno conheceu a escola, em texto curto e livre (indicação de '
  'fulana, Instagram, busca…). Texto livre de propósito: virar lista fechada '
  'exigiria saber a lista, e ninguém sabe ainda.';

-- ===========================================================================
-- 2. Nota interna — tabela própria, sem policy de aluno
-- ===========================================================================

create table student_notes (
  student_id uuid primary key references students (id),
  note text not null,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

comment on table student_notes is
  'Nota interna da equipe sobre o aluno. UMA por aluno (a chave primária é o '
  'aluno): é um bilhete vivo, não um histórico — quem quer histórico tem o '
  'audit_log, que guarda cada versão. NÃO existe policy de aluno aqui, e é '
  'esse o motivo de a nota não ser coluna de students (RLS não filtra coluna).';

alter table student_notes enable row level security;

-- LEITURA: a admin, e a professora só dos alunos DELA (o mesmo universo de
-- `students_teacher`). Aluno e vendas não têm policy — negar por padrão (Lei 4).
create policy student_notes_admin on student_notes
  for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy student_notes_teacher on student_notes
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and student_id in (select public.teacher_student_ids())
  );

-- ESCRITA: só pela RPC (Lei 3). Nenhum papel recebe insert/update/delete na
-- tabela — nem o service_role —, então não existe caminho que escreva a nota
-- por fora do gate e da auditoria. A RPC é SECURITY DEFINER e roda como dona
-- da tabela, então ela continua escrevendo.
revoke insert, update, delete, truncate on student_notes
  from anon, authenticated, service_role;
grant select on student_notes to anon, authenticated, service_role;

/**
 * Grava (ou apaga) a nota interna de um aluno.
 *
 * Gate: admin ou professora — e a professora só nos alunos dela, o mesmo
 * recorte da leitura (sem isso ela leria só os seus e escreveria em todos).
 * Nota em branco APAGA a linha: "sem nota" é a ausência do registro, não uma
 * string vazia guardada para sempre.
 */
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
  if not exists (select 1 from students where id = p_student) then
    raise exception 'aluno % não existe', p_student;
  end if;

  -- Lê o estado ANTERIOR sob lock da própria linha: duas pessoas salvando
  -- juntas não fazem a auditoria contar a mesma versão velha duas vezes.
  select note into v_antes from student_notes where student_id = p_student for update;

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
  'upsert, apagar por nota em branco e auditoria dentro da transação.';

revoke execute on function public.admin_set_student_note(uuid, text) from public, anon;
grant execute on function public.admin_set_student_note(uuid, text) to authenticated;

-- ===========================================================================
-- 3. A anonimização alcança o que nasceu hoje
-- ===========================================================================
--
-- Dado pessoal novo que a anonimização não apaga é vazamento com data marcada.
-- `birth_date` e `referral_source` entram na desidentificação da ficha, e a
-- nota interna é APAGADA (ela é opinião da equipe sobre a pessoa — não há
-- esqueleto operacional a preservar ali; o audit_log guarda que existiu).
--
-- `student_type` FICA: criança/adulto não identifica ninguém sozinho, é a
-- categoria operacional da ficha arquivada, e a coluna é NOT NULL — forçá-la a
-- 'adult' seria trocar um dado verdadeiro por um falso.
--
-- O corpo abaixo é o da migration 20260726000400 (S1 da revisão nº 3), COPIADO
-- inteiro com três linhas a mais. Lei 7: a migration antiga não foi tocada.
create or replace function public.admin_anonymize_student(
  p_student uuid,
  p_confirm text,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student students%rowtype;
  v_actor uuid;
  v_phone text;
  v_profile uuid;
  v_payer record;
  v_fiscal int := 0;
  v_scrubbed int := 0;
  v_events int := 0;
  v_errors int := 0;
  v_notes int := 0;   -- M3-c5 · D1
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

  -- S1: numa REPETIÇÃO (a 1ª tentativa anonimizou mas o ban falhou) o
  -- profile_id já é null — o alvo do login é o que ficou pendente.
  v_profile := coalesce(v_student.profile_id, v_student.auth_cleanup_profile_id);
  if v_profile is not null then
    select whatsapp_e164 into v_phone from profiles where id = v_profile;
    -- B3 (retroativa nº 2): o CARIMBO entra na mesma transação que desidentifica
    -- as linhas existentes, e ANTES da limpeza da telemetria (a ordem importa:
    -- é ela que garante que tudo que passar depois do carimbo já nasce anônimo
    -- e tudo que passou antes é alcançado pela limpeza abaixo). Sem ele havia
    -- uma janela — daqui até o ban do Auth, que acontece FORA desta transação —
    -- em que uma aba ainda aberta gravava telemetria NOVA com o user_id da
    -- pessoa, reidentificando quem acabara de ser esquecido.
    update profiles
       set full_name = 'Ex-aluno(a)',
           whatsapp_e164 = null,
           email_bounced_at = null,
           email_bounce_reason = null,
           anonymized_at = coalesce(anonymized_at, now())
     where id = v_profile;

    -- Telemetria: o EVENTO fica (série histórica sem buraco), a pessoa sai.
    update ui_events set user_id = null where user_id = v_profile;
    get diagnostics v_events = row_count;

    -- client_errors tem UM BALDE POR PESSOA e a chave (hash, user_id) é única
    -- com NULLS NOT DISTINCT: um `set user_id = null` seco violaria a chave
    -- sempre que o mesmo defeito já tivesse balde anônimo. Então o balde da
    -- pessoa é FUNDIDO no anônimo (a contagem do defeito não pode encolher só
    -- porque alguém exerceu o direito ao esquecimento) e, quando não há
    -- anônimo ainda, ele simplesmente vira o anônimo.
    select count(*)::int into v_errors from client_errors where user_id = v_profile;

    update client_errors anonimo
       set count    = anonimo.count + meu.count,
           first_at = least(anonimo.first_at, meu.first_at),
           last_at  = greatest(anonimo.last_at, meu.last_at)
      from client_errors meu
     where meu.user_id = v_profile
       and anonimo.user_id is null
       and anonimo.hash = meu.hash;

    delete from client_errors meu
     where meu.user_id = v_profile
       and exists (select 1 from client_errors a
                    where a.user_id is null and a.hash = meu.hash);

    update client_errors set user_id = null where user_id = v_profile;
  end if;

  -- esqueleto operacional preservado (aulas, ledger, extratos, auditoria);
  -- relatórios ENVIADOS ficam (exceção controlada da decisão M4-5)
  update students
     set display_name = 'Ex-aluno(a) ' || left(p_student::text, 4),
         status = 'archived',  -- S2-13: sai da lista de trabalho (filtro Arquivados)
         city = null,
         country = null,
         level = null,
         -- M3-c5 · D1: os campos que nasceram hoje saem junto com os antigos.
         birth_date = null,
         referral_source = null,
         profile_id = null,
         -- S1: o login que ainda precisa morrer não some junto com o vínculo.
         auth_cleanup_profile_id = v_profile
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

  -- M3-c5 · D1: a nota interna é opinião da equipe sobre a pessoa — some
  -- inteira. O que existiu fica registrado no audit_log da própria nota.
  delete from student_notes where student_id = p_student;
  get diagnostics v_notes = row_count;

  perform public.log_audit(v_actor, 'anonymize_student', 'students', p_student::text,
    jsonb_build_object('profile_id', v_profile, 'payers_fiscal_5anos', v_fiscal,
                       'payers_scrubbed', v_scrubbed,
                       'ui_events_desidentificados', v_events,
                       'client_errors_desidentificados', v_errors,
                       'notas_internas_apagadas', v_notes));

  -- `profile_id` no retorno = O LOGIN A DESTRUIR (o vínculo da ficha já foi
  -- desfeito). `auth_cleanup_pending` diz se sobrou trabalho fora daqui.
  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed,
                            'ui_events', v_events, 'client_errors', v_errors,
                            'auth_cleanup_pending', v_profile is not null);
end;
$$;
