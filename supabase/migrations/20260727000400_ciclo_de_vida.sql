-- CICLO DE VIDA DO ALUNO — fase 1 (spec `docs/goals/ciclo-de-vida-do-aluno.md`,
-- aprovada pelo dono em 26/07/2026).
--
-- A lista de alunos passa a carregar o FUNIL inteiro. O princípio da spec é o
-- da casa — DERIVAR > DUPLICAR:
--
--   ARMAZENADO em `students.status`: `lead` | `active` | `archived`
--   DERIVADO na leitura (nunca coluna): lead · experimental · ativo ·
--   sem contrato · pausado · arquivado
--
-- Esta migration faz só o que precisa de banco:
--   1. `lead` entra no vocabulário de `students.status`;
--   2. duas portas de mutação (Lei 3): criar lead e dar lead por perdido, as
--      duas com gate de admin e auditoria DENTRO da transação (Lei 8);
--   3. PROMOÇÃO AUTOMÁTICA lead → active quando nasce um contrato de verdade —
--      por TRIGGER, não por RPC, porque contrato nasce por mais de uma porta
--      (ver §3);
--   4. `is_trial` no jsonb do diretório: é o marcador que a derivação usa para
--      separar "experimental" de "ativo", e ele já existia — só não chegava à
--      leitura consolidada;
--   5. lead não conta como convite pendente na fila do Início (ele nunca foi
--      convidado — a fase 1 não dá portal a lead).
--
-- O QUE NÃO TEM AQUI, de propósito:
-- · nenhuma policy nova. Lead é invisível a quem não é admin POR CONSTRUÇÃO:
--   `students_teacher` recorta por `teacher_student_ids()`, que deriva de
--   CONTRATOS (lead não tem nenhum), e `students_self` recorta por
--   `my_student_ids()`, que deriva de `profile_id` (lead nunca tem login nesta
--   fase). Policy nova só poderia AFROUXAR — o teste prova as duas negativas.
-- · nenhuma mudança em `admin_create_trial_class`: quem cria a aula
--   experimental segue criando a pessoa como está hoje. A derivação de
--   "experimental" lê o marcador `is_trial`, e por isso funciona tanto para o
--   lead que ganhou uma experimental quanto para a pessoa que nasceu da
--   experimental (ver §4).
--
-- Leis tocadas: 3 (mutação por função, com gate), 4 (RLS negar-por-padrão —
-- inalterada), 7 (migration NOVA; nada antigo editado), 8 (auditoria de toda
-- mutação, incluindo a promoção automática).

-- ===========================================================================
-- 1. `lead` no vocabulário do cadastro
-- ===========================================================================
--
-- O CHECK é reemitido inteiro (é o padrão da casa desde 20260719000200, que
-- acrescentou 'archived' do mesmo jeito). Dado existente fica intocado: só
-- entra um valor NOVO na lista de permitidos.
alter table students drop constraint students_status_check;
alter table students add constraint students_status_check
  check (status = any (array['lead'::text, 'active'::text, 'paused'::text,
                             'churned'::text, 'archived'::text]));

comment on column students.status is
  'Situação ARMAZENADA do cadastro. A fase 1 do ciclo de vida usa três: '
  '''lead'' (prospecção — sem contrato, sem convite, sem portal), ''active'' '
  '(aluno da escola) e ''archived'' (saiu). ''paused''/''churned'' seguem no '
  'CHECK por compatibilidade com o histórico, mas ninguém escreve os dois: '
  'pausa é estado do CONTRATO (contracts.status = ''paused'') e a lista '
  'DERIVA a badge "pausado" de lá — estado não se duplica.';

-- ===========================================================================
-- 2. As duas portas do lead (Lei 3: mutação crítica só por função)
-- ===========================================================================

/**
 * Cria um LEAD: o cadastro mínimo de quem ainda não é aluno.
 *
 * Nome é o único obrigatório — é o que a pessoa que atende o WhatsApp tem na
 * mão. Cidade/país/fuso vêm pelo MESMO caminho do cadastro de aluno (o
 * CityPicker manda os três juntos); sem cidade, o fuso cai no do NEGÓCIO
 * (`business_tz()`), porque `students.iana_tz` é NOT NULL e inventar um
 * offset seria violar a Lei 1 — o fuso do negócio é um palpite HONESTO e
 * corrigível na hora em que a cidade aparecer.
 *
 * Lead NUNCA ganha profile nem convite nesta fase: não há nada aqui que crie
 * usuário. É o que faz o lead ser invisível ao portal por construção.
 */
create or replace function public.admin_create_lead(
  p_name text,
  p_iana_tz text default null,
  p_city text default null,
  p_country text default null,
  p_referral_source text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id      uuid;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_tz      text := coalesce(nullif(btrim(coalesce(p_iana_tz, '')), ''), public.business_tz());
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_origem  text := nullif(btrim(coalesce(p_referral_source, '')), '');
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_lead é restrita à admin (D10)';
  end if;
  if v_name is null then
    raise exception 'o nome do lead é obrigatório';
  end if;

  -- O trigger `students_valid_tz` (20260711000200) confere a zona IANA: fuso
  -- inventado recusa aqui, não vira aula em horário errado depois.
  insert into students (display_name, iana_tz, city, country, referral_source, status)
  values (v_name, v_tz, v_city, v_country, v_origem, 'lead')
  returning id into v_id;

  perform public.log_audit(auth.uid(), 'admin_create_lead', 'students', v_id::text,
    jsonb_build_object('display_name', v_name, 'iana_tz', v_tz, 'city', v_city,
                       'country', v_country, 'referral_source', v_origem,
                       'status', 'lead'));
  return v_id;
end;
$fn$;

comment on function public.admin_create_lead is
  'Fase 1 do ciclo de vida: cria o cadastro mínimo de um LEAD (status ''lead'', '
  'sem contrato, sem convite). Gate admin + auditoria na transação.';

revoke execute on function public.admin_create_lead(text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_lead(text, text, text, text, text)
  to authenticated;

/**
 * Lead perdido: o funil acabou sem contrato.
 *
 * Vira 'archived' — o MESMO balde de quem saiu da escola, porque a pergunta
 * que a lista faz é a mesma ("está fora"), e inventar um quarto estado
 * armazenado para dizer isso duplicaria vocabulário sem responder nada novo. O
 * motivo é opcional e vai para a auditoria: é lá que ele serve (analisar
 * perda), não numa coluna que ninguém lê.
 *
 * Exige status 'lead': arquivar ALUNO é outro fluxo (o de encerramento, que
 * mexe em contrato e crédito), e deixar esta porta arquivar qualquer um seria
 * um atalho que pula aquelas regras.
 */
create or replace function public.admin_lose_lead(
  p_student uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_lose_lead é restrita à admin (D10)';
  end if;

  -- Lock da linha: dois cliques simultâneos não fazem a auditoria contar a
  -- mesma transição duas vezes.
  select status into v_status from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;
  if v_status <> 'lead' then
    raise exception 'só um lead pode ser dado como perdido (situação atual: %)', v_status;
  end if;

  update students set status = 'archived' where id = p_student;

  perform public.log_audit(auth.uid(), 'admin_lose_lead', 'students', p_student::text,
    jsonb_build_object('old', 'lead', 'new', 'archived', 'reason', v_reason));
end;
$fn$;

comment on function public.admin_lose_lead is
  'Fase 1 do ciclo de vida: lead perdido → ''archived'', com motivo curto '
  'opcional na auditoria. Gate admin; recusa quem não é lead.';

revoke execute on function public.admin_lose_lead(uuid, text) from public, anon;
grant execute on function public.admin_lose_lead(uuid, text) to authenticated;

-- ===========================================================================
-- 3. Promoção automática: lead → active quando nasce o contrato
-- ===========================================================================
--
-- POR QUE TRIGGER, E NÃO "reemitir a RPC de criar contrato": não existe UMA.
-- Os caminhos por onde um contrato nasce hoje são três, e nenhum passa por uma
-- porta comum:
--   a) o WIZARD de admissão e a tela de contratos escrevem por PostgREST,
--      `insert into contracts` com a sessão da admin (policy `contracts_admin`);
--   b) `admin_create_trial_class` (20260718000400) cria o contrato leve da
--      aula experimental;
--   c) `admin_renew_contract` (20260718000600) cria a renovação.
-- Um gatilho na TABELA cobre os três (e cobre o próximo, que ainda não existe)
-- — é a mesma escolha que a casa já fez para conflito de agenda e para
-- auditoria de linha: a invariante mora onde o dado mora (Lei 3).
--
-- O CONTRATO EXPERIMENTAL NÃO PROMOVE. `is_trial` é a aula experimental do
-- funil, não a matrícula: promover ali apagaria justamente a etapa que a spec
-- quer ver na lista ("experimental"). Quem promove é contrato de verdade.

create or replace function public._promote_lead(
  p_student uuid,
  p_via text,
  p_contract uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_student is null then
    return;
  end if;

  -- O `and status = 'lead'` é a guarda: aluno que já era 'active' (o caso
  -- normal, 20 dos 20 de hoje) não é tocado, e nada é auditado à toa.
  update students set status = 'active' where id = p_student and status = 'lead';
  if found then
    perform public.log_audit(auth.uid(), 'lead_promoted', 'students', p_student::text,
      jsonb_build_object('old', 'lead', 'new', 'active', 'via', p_via,
                         'contract_id', p_contract));
  end if;
end;
$fn$;

comment on function public._promote_lead is
  'Promove um LEAD a aluno ativo na MESMA transação do contrato que o promoveu, '
  'com auditoria (ação ''lead_promoted''). Idempotente: quem não é lead não é tocado.';

create or replace function public.promote_lead_on_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_member uuid;
begin
  -- experimental é ETAPA do funil, não matrícula (ver o bloco acima)
  if coalesce(new.is_trial, false) then
    return new;
  end if;

  if new.student_id is not null then
    perform public._promote_lead(new.student_id, 'contract', new.id);
  elsif new.student_group_id is not null then
    -- Contrato de TURMA: promove quem já está na turma. Quem entrar depois é
    -- pego pelo gatilho de `student_group_members`, logo abaixo.
    for v_member in
      select m.student_id from student_group_members m where m.group_id = new.student_group_id
    loop
      perform public._promote_lead(v_member, 'group_contract', new.id);
    end loop;
  end if;

  return new;
end;
$fn$;

create trigger contracts_promote_lead
  after insert on contracts
  for each row execute function public.promote_lead_on_contract();

create or replace function public.promote_lead_on_group_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_contract uuid;
begin
  -- Só promove se a TURMA já tem contrato vivo de verdade: entrar numa turma
  -- sem contrato não matricula ninguém.
  select c.id into v_contract
    from contracts c
   where c.student_group_id = new.group_id
     and c.status <> 'ended'
     and not coalesce(c.is_trial, false)
   limit 1;

  if v_contract is not null then
    perform public._promote_lead(new.student_id, 'group_member', v_contract);
  end if;

  return new;
end;
$fn$;

create trigger student_group_members_promote_lead
  after insert on student_group_members
  for each row execute function public.promote_lead_on_group_member();

-- ===========================================================================
-- 4. `is_trial` chega ao diretório (o marcador que a derivação lê)
-- ===========================================================================
--
-- `admin_student_directory` é a leitura consolidada do hub e da ficha. Ela já
-- devolve tudo que a derivação precisa — contrato vivo (status <> 'ended') e
-- pausa (status = 'paused') — MENOS o marcador de experimental, que existe em
-- `contracts.is_trial` desde a F2 e nunca subiu para a leitura.
--
-- Corpo COPIADO de 20260718000900 (Lei 7: a migration antiga não foi tocada)
-- com UMA linha a mais no jsonb. Assinatura idêntica ⇒ `create or replace`.
create or replace function public.admin_student_directory(p_student uuid default null)
returns table(id uuid, display_name text, iana_tz text, status text, city text,
              country text, level text, profile_id uuid, whatsapp_e164 text,
              whatsapp_channel_ack_at timestamptz, email_bounced_at timestamptz,
              invited_at timestamptz, email text, email_confirmed boolean,
              last_sign_in_at timestamptz, contracts jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: diretório de alunos é só da administração';
  end if;

  return query
  select s.id, s.display_name, s.iana_tz, s.status, s.city, s.country, s.level,
         s.profile_id, p.whatsapp_e164, p.whatsapp_channel_ack_at, p.email_bounced_at, au.created_at,
         au.email::text,
         (au.email_confirmed_at is not null),
         au.last_sign_in_at,
         coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'contract_id', c.id,
                        'contract_type', c.contract_type,
                        'plan_name', c.plan_name,
                        'status', c.status,
                        -- CICLO DE VIDA (fase 1): o marcador da aula
                        -- experimental. É ele que separa "experimental" de
                        -- "ativo" na badge derivada da lista.
                        'is_trial', coalesce(c.is_trial, false),
                        'teacher_id', c.teacher_id,
                        'teacher_name', t.display_name,
                        'group_label', g.label,
                        'monthly_reschedule_allowance', c.monthly_reschedule_allowance,
                        'min_notice_hours', c.min_notice_hours,
                        'makeup_credit_expiry_days', c.makeup_credit_expiry_days,
                        'started_on', c.started_on,
                        'balance', case when c.contract_type = 'private_1on1'
                                        then public.makeup_balance(c.id) end,
                        'next_expiry', case when c.contract_type = 'private_1on1'
                                            then (select min(d) from public.makeup_remaining_expiries(c.id) d) end
                      )
                      order by c.started_on
                    )
             from contracts c
             left join teachers t on t.id = c.teacher_id
             left join student_groups g on g.id = c.student_group_id
             where c.status <> 'ended'
               and (c.student_id = s.id
                    or c.student_group_id in (
                         select m.group_id from student_group_members m where m.student_id = s.id))
           ),
           '[]'::jsonb
         )
  from students s
  left join profiles p on p.id = s.profile_id
  left join auth.users au on au.id = s.profile_id
  where p_student is null or s.id = p_student
  order by s.display_name;
end;
$fn$;

revoke execute on function public.admin_student_directory(uuid) from public;
grant execute on function public.admin_student_directory(uuid) to authenticated;

-- ===========================================================================
-- 5. Lead não é convite pendente
-- ===========================================================================
--
-- A fila de pendências do Início conta "quem ainda não entra no portal" como
-- "não arquivado e sem login confirmado". Lead casa com os dois — e não é
-- pendência nenhuma: a fase 1 não dá portal a lead, por decisão da spec. Sem
-- este recorte, criar dez leads acenderia dez convites falsos na home da dona.
--
-- Corpo COPIADO de 20260726000200 com UMA condição a mais em cada contagem.
create or replace function public.admin_home_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
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
   where s.status not in ('archived', 'lead')
     and (s.profile_id is null or au.email_confirmed_at is null);

  select count(*) into v_briefings
    from students s
   where s.status not in ('archived', 'lead')
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
$fn$;

comment on function public.admin_home_counts is
  'As DUAS contagens da fila de pendências do Início (sem acesso ao portal / '
  'briefing travado), set-based e sem dado pessoal. LEAD fica de fora das duas: '
  'ele não tem portal nem plano na fase 1 do ciclo de vida.';

revoke execute on function public.admin_home_counts() from public, anon;
grant execute on function public.admin_home_counts() to authenticated, service_role;
