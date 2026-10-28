-- CORREÇÕES DA REVISÃO ADVERSARIAL Nº 8 (Sol, 27/07/2026) — a parte de banco.
--
-- Lei 7: nada de migration antiga foi tocado. Cada corpo abaixo é o corpo VIVO
-- (lido do banco com `pg_get_functiondef`) reemitido com o MÍNIMO alterado, e a
-- alteração vem comentada no lugar dela.
--
-- P1 — `_promote_lead` era EXECUTÁVEL POR QUALQUER UM (crítico de segurança).
-- P2 — DEADLOCK: `book_computed_slot` pegava o advisory do gasto ANTES de
--      travar a linha do contrato — ordem inversa à do resto da casa.
-- P3 — "agendados" perdia a remarcação: o débito fica preso à aula ORIGINAL.
-- P4 — corrida contrato × membro de turma deixava lead com contrato de verdade.
-- P5 — lead perdido que VOLTA ficava arquivado para sempre.
-- P6 — fuso PROVISÓRIO do lead virava definitivo em silêncio.
-- P7 — convite de LEAD barrado também no banco (a fronteira é o motor; aqui
--      fica o cinto).
-- P8 — o gatilho promovia por contrato que já nasce `ended`.
--
-- Leis tocadas: 1 (fuso — P6 é justamente a defesa dela), 2 (crédito — P3 é
-- leitura, não escreve ledger), 3 (toda regra nova mora aqui, não no TS), 4
-- (RLS/gates — P1), 7 (migration NOVA), 8 (auditoria de toda mutação, incluindo
-- a reativação do P5).

-- ===========================================================================
-- P1 · O CRÍTICO: função SECURITY DEFINER sem gate e sem REVOKE
-- ===========================================================================
--
-- O BURACO: função nova nasce com EXECUTE para PUBLIC. `_promote_lead` é
-- SECURITY DEFINER (roda como dona do schema, passando por cima da RLS), não
-- tem gate de papel — é helper de gatilho, o gate mora em quem cria contrato —
-- e não recebeu REVOKE na 20260727000400. Resultado: anon e authenticated
-- podiam promover QUALQUER cadastro a partir do UUID e ainda escolher o texto
-- de `p_via`/`p_contract` que ia para a auditoria — falsificando a trilha que
-- a Lei 8 existe para garantir.
--
-- POR QUE O REVOKE BASTA (e por que não entra gate de papel): os dois gatilhos
-- que a chamam são SECURITY DEFINER e rodam como a MESMA dona (postgres), que
-- é quem mantém o EXECUTE. Ninguém mais precisa do privilégio — nem
-- `service_role`, que nunca chama a função direto. Um gate de papel dentro dela
-- quebraria o caso legítimo (o gatilho roda na sessão de quem inseriu o
-- contrato, que pode ser a admin, mas também o `service_role` de um import).
--
-- A VARREDURA (todas as funções criadas nas migrations desta sessão,
-- 20260726* e 20260727*): as únicas com `proacl` nulo — isto é, EXECUTE para
-- PUBLIC — eram `_promote_lead` e as duas funções de gatilho irmãs. As duas de
-- gatilho não são chamáveis por fora (`ERROR: trigger functions can only be
-- called as triggers`), mas levam o mesmo tratamento: privilégio que ninguém
-- usa não fica de pé. Todas as outras (`admin_*`, `_reissue_credit`,
-- `_accept_policy_locked`, `_admin_kpis_compute`, `materialize_slot`,
-- `capture_kpi_snapshot`, `record_*`, `policy_*`) já tinham REVOKE explícito.
-- Fora da varredura, de propósito: `payment_nao_cobravel` é PUBLIC mas NÃO é
-- SECURITY DEFINER (roda como o chamador, é predicado de leitura) — revogá-la
-- quebraria quem a usa em expressão de tabela sem ganhar segurança nenhuma.

revoke execute on function public._promote_lead(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.promote_lead_on_contract()
  from public, anon, authenticated, service_role;
revoke execute on function public.promote_lead_on_group_member()
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- P5+P6 · as duas colunas novas do cadastro
-- ===========================================================================

-- P5 — O MARCADOR DE ANONIMIZAÇÃO. Não existia um: `admin_anonymize_student`
-- carimba `profiles.anonymized_at`, mas na mesma transação apaga
-- `students.profile_id` (o vínculo vira `auth_cleanup_profile_id`, que é
-- ZERADO assim que o ban do Auth conclui). Ou seja: depois do fluxo feliz não
-- sobra, na ficha, nenhum campo que diga "esta pessoa exerceu o direito ao
-- esquecimento" — só o `audit_log`. Para a reativação do P5 poder recusar o
-- caso perigoso, o fato passa a morar na própria linha.
alter table students add column anonymized_at timestamptz;

comment on column students.anonymized_at is
  'Quando esta ficha foi DESIDENTIFICADA (`admin_anonymize_student`). É o '
  'marcador durável que faltava: `profiles.anonymized_at` some do alcance da '
  'ficha (o vínculo é desfeito) e `auth_cleanup_profile_id` é zerado no fim do '
  'bloqueio de login. Quem tem esta data NUNCA volta a ''active'' — a '
  'reativação automática do ciclo de vida recusa com erro (revisão nº 8, P5).';

-- Backfill do que já aconteceu: a trilha do `audit_log` é append-only (Lei 8),
-- então ela é a fonte histórica honesta. Sem isto, um aluno anonimizado ANTES
-- desta migration poderia ser reativado pelo gatilho novo.
update students s
   set anonymized_at = a.quando
  from (
    select entity_id, min(at) as quando
      from audit_log
     where action = 'anonymize_student' and entity = 'students'
     group by entity_id
  ) a
 where a.entity_id = s.id::text;

-- P6 — O FUSO A CONFIRMAR. `admin_create_lead` (20260727000400) cai em
-- `business_tz()` quando ninguém informou cidade — o que é a decisão certa
-- (Lei 1: `students.iana_tz` é NOT NULL e inventar offset é proibido), mas
-- nasce um PALPITE indistinguível de um fato. Duas semanas depois, `create_slot`
-- materializa 8 semanas de aula no relógio de Cuiabá para um aluno que mora em
-- Lisboa, e a Lei 1 é violada por dado, não por código.
--
-- DEFAULT TRUE: as fichas que já existem foram cadastradas com cidade/fuso de
-- verdade (o CityPicker manda os três juntos desde a Leva 5) — marcar todo
-- mundo como "a confirmar" seria trocar um dado verdadeiro por um alarme falso
-- e travar a escola inteira. Quem nasce a confirmar é só o lead sem cidade,
-- daqui para a frente.
alter table students add column tz_confirmed boolean not null default true;

comment on column students.tz_confirmed is
  'O fuso desta ficha é FATO (true) ou PALPITE do cadastro mínimo (false)? '
  'Nasce false só quando `admin_create_lead` cai no fuso do negócio por falta '
  'de cidade. Vira true sozinho ao gravar cidade ou fuso pelo cadastro '
  '(gatilho `students_confirm_tz`). Contrato e horário fixo NÃO-experimentais '
  'são recusados enquanto for false (revisão nº 8, P6).';

/**
 * P6 · confirmar é um EFEITO de gravar cidade/fuso, não um checkbox.
 *
 * O gatilho mora no banco (e não nas actions) porque `students` é escrita por
 * mais de uma porta — wizard, ficha, PostgREST — e a promessa "quem completou
 * o cadastro confirmou o fuso" não pode depender de cada porta lembrar disso.
 * É a mesma escolha do `students_valid_tz`, que já vive aqui ao lado.
 *
 * Cidade que vira NULL não confirma nada (é o que a anonimização faz).
 */
create or replace function public.students_confirm_tz()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.iana_tz is distinct from old.iana_tz
     or (new.city is not null and new.city is distinct from old.city) then
    new.tz_confirmed := true;
  end if;
  return new;
end;
$fn$;

create trigger students_confirm_tz
  before update on students
  for each row execute function public.students_confirm_tz();

-- Mesma higiene do P1: função nova nasce com EXECUTE para PUBLIC e ninguém
-- além do gatilho precisa dela (chamada direta nem seria possível — `ERROR:
-- trigger functions can only be called as triggers`).
revoke execute on function public.students_confirm_tz()
  from public, anon, authenticated, service_role;

/**
 * P6 · a GUARDA. Contrato ou horário fixo de verdade exige fuso confirmado.
 *
 * A aula EXPERIMENTAL fica de fora de propósito: ela é uma hora só, marcada a
 * dedo pela dona junto com o lead ao telefone, e é justamente o gesto em que
 * a cidade costuma aparecer. Travá-la travaria o funil no ponto onde ele mais
 * anda.
 */
create or replace function public._require_confirmed_tz(p_student uuid, p_group uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_nome text;
begin
  select s.display_name into v_nome
    from students s
   where not s.tz_confirmed
     and (s.id = p_student
          or (p_group is not null
              and exists (select 1 from student_group_members m
                           where m.group_id = p_group and m.student_id = s.id)))
   limit 1;

  if found then
    raise exception
      'o fuso de % ainda é um palpite: o cadastro nasceu sem cidade e herdou o fuso da escola. '
      'Complete cidade/fuso no cadastro antes de criar contrato ou horário fixo — '
      'senão as aulas nascem no relógio errado (Lei 1)', v_nome;
  end if;
end;
$fn$;

comment on function public._require_confirmed_tz(uuid, uuid) is
  'Recusa quando o aluno (ou algum membro da turma) ainda tem `tz_confirmed = '
  'false`. Chamada pelo gatilho de contrato e por `create_slot` (revisão nº 8, P6).';

revoke execute on function public._require_confirmed_tz(uuid, uuid)
  from public, anon, authenticated, service_role;

/**
 * P7 (cinto) · LEAD NÃO TEM LOGIN.
 *
 * A fronteira de verdade é o motor do convite (`provisionStudent`), que recusa
 * ANTES de criar qualquer coisa no Auth — esconder o botão nunca protegeu nada.
 * Aqui fica a mesma regra onde o dado mora: nenhum caminho vincula `profile_id`
 * a quem o banco chama de lead. Se um dia alguém escrever direto na tabela, a
 * promessa "lead é invisível ao portal" continua verdadeira.
 */
create or replace function public.students_lead_sem_login()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.profile_id is not null and old.profile_id is null and new.status = 'lead' then
    raise exception
      'lead não tem portal (%): o cadastro vira aluno quando o contrato nasce — convide depois disso',
      new.display_name;
  end if;
  return new;
end;
$fn$;

create trigger students_lead_sem_login
  before update on students
  for each row execute function public.students_lead_sem_login();

revoke execute on function public.students_lead_sem_login()
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- P5+P8+P4 · os gatilhos do ciclo de vida
-- ===========================================================================

/**
 * P5 · quem VOLTA sai do arquivo morto.
 *
 * O BURACO: a promoção só olhava `status = 'lead'`. Lead dado por perdido vira
 * `archived` (a decisão da fase 1: quem está fora é um balde só). Quando ele
 * volta meses depois e fecha, o contrato nasce, a aula aparece na agenda… e a
 * ficha continua dizendo "arquivado" — a pessoa some da lista de trabalho, da
 * fila de convites e das contagens, com contrato vivo. O mesmo vale para o
 * ex-aluno que retorna.
 *
 * A TRANSIÇÃO É AUDITADA E TEM NOME PRÓPRIO (`lead_reactivated`, não
 * `lead_promoted`): promover é a primeira vez; reativar é uma volta, e quem lê
 * a auditoria depois precisa distinguir as duas — a segunda merece pergunta.
 *
 * ANONIMIZADO NUNCA VOLTA. A ficha desidentificada não é a pessoa: o nome é
 * "Ex-aluno(a) 1a2b", cidade/nascimento/nota foram apagados e o login foi
 * destruído. Reativá-la faria a escola operar em cima de um esqueleto — e
 * ressuscitaria na lista de trabalho alguém que exerceu o direito ao
 * esquecimento. Aqui a recusa é EXPLÍCITA e derruba a transação inteira: quem
 * voltou de verdade tem cadastro novo.
 */
create or replace function public._promote_lead(
  p_student uuid,
  p_via text,
  p_contract uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
  v_anon   timestamptz;
begin
  if p_student is null then
    return;
  end if;

  -- Lock da linha ANTES de decidir: o estado sobre o qual esta transação
  -- decide não pode mudar por baixo dela (dois contratos nascendo juntos para
  -- a mesma pessoa auditariam a transição duas vezes).
  select status, anonymized_at into v_status, v_anon
    from students where id = p_student for update;
  if not found then
    return;
  end if;

  if v_status = 'lead' then
    update students set status = 'active' where id = p_student;
    perform public.log_audit(auth.uid(), 'lead_promoted', 'students', p_student::text,
      jsonb_build_object('old', 'lead', 'new', 'active', 'via', p_via,
                         'contract_id', p_contract));

  elsif v_status = 'archived' then
    -- P5: a ficha ANONIMIZADA é terminal. Erro claro, e não silêncio: quem
    -- tentou precisa saber que o caminho certo é um cadastro novo.
    if v_anon is not null then
      raise exception
        'esta ficha foi anonimizada em % e não volta a ser aluno — cadastre a pessoa de novo (aluno %)',
        v_anon, p_student;
    end if;
    update students set status = 'active' where id = p_student;
    perform public.log_audit(auth.uid(), 'lead_reactivated', 'students', p_student::text,
      jsonb_build_object('old', 'archived', 'new', 'active', 'via', p_via,
                         'contract_id', p_contract));
  end if;
  -- Quem já era 'active' (o caso normal) não é tocado nem auditado à toa.
end;
$fn$;

comment on function public._promote_lead is
  'Põe o cadastro em ''active'' na MESMA transação do contrato que o promoveu: '
  'de ''lead'' (ação ''lead_promoted'') ou de ''archived'' (''lead_reactivated'' '
  '— o lead perdido que voltou, revisão nº 8 P5). Ficha ANONIMIZADA recusa. '
  'Idempotente: quem já é ativo não é tocado. Sem EXECUTE para ninguém além da '
  'dona — os gatilhos rodam como definer (P1).';

revoke execute on function public._promote_lead(uuid, text, uuid)
  from public, anon, authenticated, service_role;

/**
 * P8 · contrato que já NASCE encerrado não promove ninguém.
 *
 * Import histórico e correção pelo `service_role` inserem contratos com
 * `status = 'ended'` — é o jeito de registrar o que já acabou. Promover por
 * causa deles ressuscitaria gente na lista de trabalho por um fato do passado.
 * O gatilho do MEMBRO já exigia `status <> 'ended'` no contrato da turma; este
 * passa a exigir o mesmo do contrato que está nascendo — os dois lados falando
 * a mesma frase.
 *
 * P4 · a CORRIDA contrato × membro (o mesmo gatilho, o mesmo lock).
 *
 * O BURACO: os dois gatilhos consultam a tabela do OUTRO. Duas transações
 * simultâneas — uma criando o contrato da turma, outra pondo o segundo membro
 * nela — não enxergam a linha não-commitada uma da outra: a do contrato lê
 * `student_group_members` e não vê o membro novo; a do membro lê `contracts` e
 * não vê o contrato novo. As duas commitam, e sobra um LEAD com contrato de
 * verdade — exatamente o estado que a fase 1 do ciclo de vida veio matar.
 *
 * MECANISMO ESCOLHIDO: `pg_advisory_xact_lock` com chave do GRUPO nos dois
 * gatilhos, ANTES da consulta. A segunda transação espera a primeira commitar
 * e, como a casa roda em READ COMMITTED, a consulta que vem DEPOIS do lock abre
 * um snapshot novo e enxerga o que a outra acabou de gravar.
 *
 * POR QUE NÃO `CONSTRAINT TRIGGER ... DEFERRED`: adiar para o fim da transação
 * não muda o que ela ENXERGA. Cada uma continuaria vendo só o próprio trabalho,
 * e as duas continuariam commitando cegas. Diferir resolve ordem DENTRO de uma
 * transação; aqui o problema é entre DUAS — e para isso só serve uma porta
 * comum. O advisory lock é a porta mais barata que existe (nada de linha de
 * bloqueio inventada) e é o mesmo mecanismo que a casa já usa para serializar
 * gasto de crédito e materialização de slot.
 */
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

revoke execute on function public.promote_lead_on_contract()
  from public, anon, authenticated, service_role;

create or replace function public.promote_lead_on_group_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_contract uuid;
begin
  -- P4: a MESMA porta, na mesma ordem — quem chegar depois espera e enxerga.
  perform pg_advisory_xact_lock(
    hashtextextended('student_group:' || new.group_id::text, 0));

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

revoke execute on function public.promote_lead_on_group_member()
  from public, anon, authenticated, service_role;

/**
 * P6 · a guarda do fuso pendurada onde o contrato nasce.
 *
 * Gatilho, e não checagem dentro de uma RPC, pela mesma razão que a promoção é
 * gatilho (20260727000400 §3): contrato nasce por três portas — PostgREST do
 * wizard/tela, `admin_create_trial_class` e `admin_renew_contract` — e não há
 * uma porta comum onde pendurar a regra. A invariante mora onde o dado mora.
 */
create or replace function public.contracts_require_confirmed_tz()
returns trigger
language plpgsql
security definer   -- para alcançar `_require_confirmed_tz`, que não tem EXECUTE público
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(new.is_trial, false) then
    return new;
  end if;
  perform public._require_confirmed_tz(new.student_id, new.student_group_id);
  return new;
end;
$fn$;

create trigger contracts_require_confirmed_tz
  before insert on contracts
  for each row execute function public.contracts_require_confirmed_tz();

revoke execute on function public.contracts_require_confirmed_tz()
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- P6 · o lead nasce dizendo se o fuso é fato ou palpite
-- ===========================================================================
--
-- Corpo COPIADO de 20260727000400 com DUAS linhas a mais (a variável e a
-- coluna no insert). Lei 7: a migration antiga não foi tocada.
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
  v_informado text := nullif(btrim(coalesce(p_iana_tz, '')), '');
  v_tz      text := coalesce(v_informado, public.business_tz());
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
  --
  -- P6: quando o fuso veio do CityPicker ele é FATO; quando caiu no fuso do
  -- negócio por falta de cidade é PALPITE, e a ficha passa a dizer isso em vez
  -- de deixá-lo endurecer em horário de aula.
  insert into students (display_name, iana_tz, city, country, referral_source, status,
                        tz_confirmed)
  values (v_name, v_tz, v_city, v_country, v_origem, 'lead',
          v_informado is not null)
  returning id into v_id;

  perform public.log_audit(auth.uid(), 'admin_create_lead', 'students', v_id::text,
    jsonb_build_object('display_name', v_name, 'iana_tz', v_tz, 'city', v_city,
                       'country', v_country, 'referral_source', v_origem,
                       'status', 'lead', 'tz_confirmed', v_informado is not null));
  return v_id;
end;
$fn$;

comment on function public.admin_create_lead is
  'Fase 1 do ciclo de vida: cria o cadastro mínimo de um LEAD (status ''lead'', '
  'sem contrato, sem convite). Gate admin + auditoria na transação. Sem fuso '
  'informado, o do negócio entra como PALPITE (`tz_confirmed = false`) e trava '
  'contrato/horário até alguém completar o cadastro (revisão nº 8, P6).';

revoke execute on function public.admin_create_lead(text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_lead(text, text, text, text, text)
  to authenticated;

-- ===========================================================================
-- P6 · create_slot também pergunta pelo fuso
-- ===========================================================================
--
-- Corpo COPIADO de 20260727000300 com UMA chamada a mais. O gatilho de
-- contrato não alcança este caso: dá para criar horário fixo num contrato que
-- já existe, e o slot é justamente onde o palpite de fuso vira 8 semanas de
-- aula no relógio errado.
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
-- P5 · a anonimização carimba o marcador novo
-- ===========================================================================
--
-- Corpo COPIADO de 20260727000200 com UMA linha a mais no UPDATE de students.
-- Sem ela, a coluna nasceria já desatualizada na primeira anonimização depois
-- do deploy — e a recusa do P5 seria uma promessa vazia.
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

  update students
     set display_name = 'Ex-aluno(a) ' || left(p_student::text, 4),
         status = 'archived',
         city = null,
         country = null,
         level = null,
         birth_date = null,
         referral_source = null,
         profile_id = null,
         -- P5 (revisão nº 8): o carimbo que a ficha guarda para sempre. É ele
         -- que faz a reativação automática do ciclo de vida recusar esta
         -- pessoa — desidentificado não volta a ser aluno.
         anonymized_at = coalesce(anonymized_at, now()),
         auth_cleanup_profile_id = v_profile
   where id = p_student;

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

  delete from student_notes where student_id = p_student;
  get diagnostics v_notes = row_count;

  perform public.log_audit(v_actor, 'anonymize_student', 'students', p_student::text,
    jsonb_build_object('profile_id', v_profile, 'payers_fiscal_5anos', v_fiscal,
                       'payers_scrubbed', v_scrubbed,
                       'ui_events_desidentificados', v_events,
                       'client_errors_desidentificados', v_errors,
                       'notas_internas_apagadas', v_notes));

  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed,
                            'ui_events', v_events, 'client_errors', v_errors,
                            'auth_cleanup_pending', v_profile is not null);
end;
$$;

-- ===========================================================================
-- P2 · a ordem dos locks no resgate de crédito
-- ===========================================================================
--
-- O BURACO: `book_computed_slot` pegava `pg_advisory_xact_lock('makeup_spend:
-- <contrato>')` para ler a duração do crédito e SÓ DEPOIS chamava
-- `book_reschedule_window`, que trava a LINHA do contrato (`for update`) antes
-- de repegar o mesmo advisory. Ou seja: advisory → linha. Toda a outra ponta da
-- casa faz linha → advisory (`pause_contract`, `resume_contract`,
-- `admin_end_contract`, `admin_renew_contract` e, desde a revisão nº 7,
-- `admin_extend_credit`). Duas transações simultâneas — uma estendendo a
-- validade de um crédito, outra resgatando outro crédito do MESMO contrato —
-- fechavam o ciclo e o Postgres matava uma delas com `deadlock detected`. Para
-- a dona, é a tela dizendo "erro inesperado" no meio de um gesto de dinheiro.
--
-- A CORREÇÃO: travar a linha do contrato ANTES do advisory, aqui também. O
-- `for update` que `book_reschedule_window` faz adiante repega a MESMA linha
-- sem se bloquear, e o advisory idem — nada de trabalho dobrado, só ordem.
--
-- VARREDURA das outras consumidoras do advisory `makeup_spend:*` (todas lidas
-- do banco vivo): `spend_makeup` e `_reissue_credit` pegam só o advisory e
-- nenhuma linha de contrato antes — não fecham ciclo, e por isso ficam como
-- estão; `book_reschedule_window`, `admin_end_contract`, `admin_renew_contract`
-- e `admin_extend_credit` já estavam na ordem certa. `book_computed_slot` era a
-- única invertida.
create or replace function public.book_computed_slot(
  p_teacher uuid,
  p_starts_at_utc timestamp with time zone,
  p_instance uuid default null::uuid,
  p_contract uuid default null::uuid,
  p_actor uuid default null::uuid,
  p_courtesy boolean default false,
  p_courtesy_note text default null::text,
  p_bypass_lead boolean default false,
  p_google_degraded boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_tz text;
  v_dur int;
  v_slot_dur int;
  v_contract_id uuid;
  v_win uuid;
  v_local timestamp;
  v_new uuid;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- duração REAL (F1/M1-5): remarcação herda da aula; resgate usa o crédito da vez
  if p_instance is not null then
    select round(extract(epoch from (ci.ends_at_utc - ci.starts_at_utc)) / 60)::int, ci.contract_id
      into v_dur, v_contract_id
    from class_instances ci where ci.id = p_instance;
    if v_dur is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
    -- P2 (revisão nº 8): PRIMEIRO a linha do contrato, DEPOIS o advisory do
    -- gasto — a mesma ordem de toda a casa. Sem isto o resgate fechava ciclo
    -- de deadlock com a extensão de validade.
    perform 1 from contracts where id = p_contract for update;
    if not found then
      raise exception 'contrato % não existe', p_contract;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
    select rc.duration_min into v_dur
    from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord limit 1;
    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = p_contract
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc limit 1;
    v_dur := coalesce(v_dur, v_slot_dur, 45);
  end if;

  -- a camada do banco decide a disponibilidade (Google é antecipação do app)
  if not public._teacher_available_for(p_teacher, p_starts_at_utc,
        p_starts_at_utc + make_interval(mins => v_dur)) then
    raise exception 'a professora não está disponível nesse horário — escolha outro';
  end if;

  -- reaproveita janela publicada no MESMO instante (união sem duplicata);
  -- senão materializa uma janela nova, e consome na mesma transação
  select w.id into v_win from reschedule_windows w
  where w.teacher_id = p_teacher and w.starts_at_utc = p_starts_at_utc and w.state = 'publicada'
  for update;
  if v_win is null then
    v_local := p_starts_at_utc at time zone v_tz;
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
    values
      (p_teacher, v_local::date, v_local::time, v_tz, p_starts_at_utc,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz, v_actor)
    returning id into v_win;
  end if;

  v_new := public.book_reschedule_window(
    v_win, p_instance, p_contract, v_actor, p_courtesy, p_courtesy_note, p_bypass_lead);

  perform public.log_audit(v_actor, 'book_computed_slot', 'reschedule_windows', v_win::text,
    jsonb_build_object(
      'teacher_id', p_teacher, 'starts_at_utc', p_starts_at_utc,
      'duration_min', v_dur, 'contract', v_contract_id,
      'new_instance', v_new,
      -- marcador da reserva degradada (fail-open do Google — decisão M1-4)
      'google_degraded', p_google_degraded));
  return v_new;
end;
$function$;

comment on function public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean) is
  'Reserva um horário calculado (remarcação ou resgate de crédito). Ordem de '
  'locks padronizada com o resto da casa: contrato FOR UPDATE → advisory '
  '''makeup_spend:<contrato>'' (revisão nº 8, P2).';

-- ===========================================================================
-- P3 · "agendados" tem de seguir a remarcação
-- ===========================================================================
--
-- O BURACO: o cartão de créditos da ficha diz "Total = disponíveis +
-- agendados", e "agendados" era contado no TS procurando o débito de crédito
-- cuja aula está `scheduled` no futuro. Só que a aula do débito é a ORIGINAL —
-- e remarcar a reposição põe a original em `rescheduled` e cria OUTRA linha,
-- que aponta para trás por `reschedule_of`. O débito continua onde estava, a
-- aula existe e vai acontecer, e o número da tela cai para zero: o Total passa
-- a mentir para baixo justamente para quem mexeu na agenda.
--
-- A CORREÇÃO mora no banco (Lei 3) e SEGUE A CADEIA: remarcar a remarcada
-- encadeia `reschedule_of` mais um degrau, e a conta tem de chegar na ponta.
-- `with recursive` com teto de passos — a cadeia é linear por construção (a
-- instância remarcada sai de `scheduled` e não se remarca de novo), e o teto é
-- cinto contra ciclo em dado corrompido, não regra.
--
-- Só débito COM aula entra: o −1 do par de relançamento (`_reissue_credit`,
-- ajuste manual) não tem `class_instance_id` e não é reserva de nada.
create or replace function public.admin_reserved_credits(p_contract_ids uuid[])
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_total int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_reserved_credits é da administração (D10)';
  end if;
  if p_contract_ids is null or array_length(p_contract_ids, 1) is null then
    return 0;
  end if;

  with recursive debito as (
    select ml.id as ledger_id, (-ml.delta) as creditos, ml.class_instance_id as instancia
      from makeup_ledger ml
     where ml.delta < 0
       and ml.class_instance_id is not null
       and ml.contract_id = any (p_contract_ids)
  ),
  cadeia as (
    select d.ledger_id, d.creditos, ci.id, ci.state, ci.starts_at_utc, 1 as passo
      from debito d
      join class_instances ci on ci.id = d.instancia
    union all
    select c.ledger_id, c.creditos, f.id, f.state, f.starts_at_utc, c.passo + 1
      from cadeia c
      join class_instances f on f.reschedule_of = c.id
     where c.passo < 25
  )
  select coalesce(sum(q.creditos), 0)::int into v_total
    from (
      select distinct ledger_id, creditos
        from cadeia
       where state = 'scheduled'
         and starts_at_utc >= now()
    ) q;

  return v_total;
end;
$fn$;

comment on function public.admin_reserved_credits(uuid[]) is
  'Quantos créditos de reposição estão RESERVADOS nestes contratos: débito de '
  'crédito preso a uma aula que ainda vai acontecer — seguindo a cadeia de '
  '`reschedule_of`, porque remarcar a reposição deixa o débito na aula ORIGINAL '
  '(revisão nº 8, P3). Gate admin.';

revoke execute on function public.admin_reserved_credits(uuid[]) from public, anon;
grant execute on function public.admin_reserved_credits(uuid[]) to authenticated;
