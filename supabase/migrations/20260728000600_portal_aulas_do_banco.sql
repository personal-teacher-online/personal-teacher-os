-- Onda do Portal · P4 — AS AULAS DO ALUNO, E O QUE ACONTECE SE ELE AGIR AGORA.
--
-- A tela de aulas e as duas ações (remarcar/cancelar) precisavam de três coisas
-- que o TypeScript vinha adivinhando:
--
--   1. o ESTADO de uma aula passada em linguagem de gente. `class_instances`
--      guarda seis estados (`class_state`), e "cancelled" não diz QUEM cancelou
--      nem se veio em cima da hora — esse fato mora no `audit_log` que
--      `_cancel_class_core` escreve, e o `audit_log` é fechado ao aluno pela
--      RLS. Sem ele, a tela só sabia dizer "cancelada" e a IA pediu "a
--      professora cancelou" / "você cancelou em cima da hora";
--
--   2. o EFEITO de remarcar agora (D4 — a consequência explicada NA TELA). A
--      página montava a régua sozinha: `min_notice_hours` comparado com
--      `DateTime.diffNow()`, franquia lida por fora, crédito por outra query.
--      Três cópias em TypeScript de uma classificação que `reschedule_class_at`
--      já faz — e que decide dinheiro (franquia × crédito × recusa);
--
--   3. o EFEITO de cancelar agora. Desde o ADR-018 (ratificado em 18/07/2026)
--      cancelamento PELO ALUNO nunca credita, em qualquer antecedência; a tela
--      dizia isso de memória, com o risco de a regra mudar no banco e o aviso
--      continuar prometendo o que era verdade no ano passado.
--
-- Nenhuma regra nova nasce aqui. As três funções LEEM as mesmas linhas que as
-- RPCs de escrita leem, na MESMA ordem de decisão, e devolvem a classificação —
-- o portal formata (Lei 3).
--
-- Leis: 1 (nenhuma data civil decidida fora do banco: `business_today()` e o
-- fuso da instância por `class_instance_tz`), 2 (ledger só lido, pelo replay do
-- FIFO), 3 (a régua continua no Postgres), 4 (REVOKE + porteiro de papel + posse
-- por `my_contract_ids()`), 7 (migration nova; nada editado).

-- ---------------------------------------------------------------------------
-- 0. O porteiro de papel, em um lugar só — o padrão que a revisão do P3 fixou
--    (`_extrato_de_creditos_permitido`). SECURITY DEFINER ignora RLS: o escopo
--    por `auth.uid()` diz QUAIS linhas, e o papel diz QUEM pode perguntar. A
--    conta `teacher` que também é aluna da escola passa por `my_contract_ids()`
--    e não pode entrar por esta porta.
-- ---------------------------------------------------------------------------
create or replace function public._aulas_do_aluno_permitido()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.app_role() not in ('student', 'admin') then
    raise exception 'sem acesso às aulas do aluno';
  end if;
end;
$$;

-- Helper INTERNO: quem precisa do EXECUTE é a função DEFINER que o chama (ela
-- roda como dona), nunca o chamador de fora. Padrão da casa desde o c17.
revoke execute on function public._aulas_do_aluno_permitido()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 0b. O FATO que explica o estado de UMA aula, lido do `audit_log`.
--
--     Fica numa função só porque duas superfícies precisam da mesma resposta: a
--     lista de aulas passadas e a página de UMA aula (N3). Duplicar a leitura do
--     audit seria duplicar a régua de "em cima da hora".
--
--     `cancel_class` grava `cancelled_by`, `notified_at`, `starts_at_utc`,
--     `min_notice_hours` e `credited`; `no_show_*` grava `credited`. Aula sem
--     registro (cancelamento por encerramento de contrato, troca de horário ou
--     pausa — que cancelam por caminho direto, deliberadamente silenciosos)
--     devolve tudo NULL, e a tela diz só "cancelada": o banco não sabe quem foi.
-- ---------------------------------------------------------------------------
create or replace function public._fato_da_aula(p_instance uuid, p_estado text)
returns table (
  cancelado_por text,
  fora_do_aviso boolean,
  gerou_credito boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with registro as (
    select a.diff
      from audit_log a
     where a.entity = 'class_instances'
       and a.entity_id = p_instance::text
       and a.action in ('cancel_class', 'no_show_student', 'no_show_teacher')
     order by a.at desc, a.id desc
     limit 1
  )
  select r.diff ->> 'cancelled_by',
         -- "Em cima da hora" é a fronteira que o próprio cancelamento gravou: o
         -- aviso veio DEPOIS do prazo mínimo do contrato. Só existe para
         -- cancelamento (no-show não tem aviso).
         case
           when p_estado = 'cancelled'
            and (r.diff ? 'notified_at')
            and (r.diff ? 'min_notice_hours')
           then (r.diff ->> 'notified_at')::timestamptz
                  > (r.diff ->> 'starts_at_utc')::timestamptz
                    - make_interval(hours => (r.diff ->> 'min_notice_hours')::int)
         end,
         (r.diff ->> 'credited')::boolean
    from registro r
$$;

revoke execute on function public._fato_da_aula(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. student_class_history — o HISTÓRICO de aulas do próprio aluno, já com o
--    fato que explica o estado.
--
--    O balde é a aula que já terminou OU que saiu de 'scheduled' (remarcada,
--    cancelada, falta). ⚠️ ELE NÃO É O COMPLEMENTO EXATO das "próximas" (a
--    afirmação que estava escrita aqui e que a revisão do P4 derrubou): uma aula
--    FUTURA cancelada satisfaz `state <> 'scheduled'` e cai aqui, junto das
--    passadas — por isso a tela chama esta lista de "Histórico", e não de
--    "Passadas". A garantia que vale é a outra, e é a que importa: nenhuma aula
--    do aluno fica invisível entre os dois baldes.
--
--    O fato que explica cada estado vem de `_fato_da_aula` (a MESMA linha de
--    audit que a ação de cancelar escreveu — não há segunda derivação).
--
--    `total` viaja em toda linha (window count) para a paginação da tela não
--    precisar de uma segunda ida ao banco — e porque contar página por página é
--    como se descobre, tarde, que a última página não existe.
--
--    ⚠️ O TOTAL SOBREVIVE À PÁGINA VAZIA (revisão do P4). Antes o total viajava
--    NAS linhas: `?p=99` devolvia zero linha, e com ela zero total — a tela lia
--    "não há aulas" para quem tem cem. Agora quem dirige a consulta é `contadas`
--    (sempre UMA linha) e a página entra por `left join`: página fora do
--    intervalo devolve UMA linha com `id` nulo e o total certo, e quem chama
--    descarta a linha-sentinela e reposiciona a paginação.
--
--    ⚠️ PAGINAÇÃO POR DESLOCAMENTO, com o defeito conhecido dela: se o conjunto
--    CRESCER entre a página 1 e a página 2 (uma aula nova entra no topo da
--    ordem), a última linha da página 1 reaparece na 2. Aceito e documentado: o
--    histórico do aluno cresce de uma aula por semana, e ele o lê em segundos —
--    trocar por keyset (cursor por `starts_at_utc, id`) custaria uma URL com
--    cursor e um `Mais recentes` que não sabe voltar. Se um dia a lista virar
--    fluxo de alta cadência, é aqui que a troca acontece.
--
--    O teto de `p_limit` protege o `max_rows` do PostgREST (config.toml): a tela
--    pagina de 15 em 15; 50 é folga, não porta.
-- ---------------------------------------------------------------------------
create or replace function public.student_class_history(
  p_limit int default 15,
  p_offset int default 0
)
returns table (
  id uuid,
  starts_at_utc timestamptz,
  ends_at_utc timestamptz,
  state text,
  teacher_name text,
  cancelado_por text,
  fora_do_aviso boolean,
  gerou_credito boolean,
  total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 15), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public._aulas_do_aluno_permitido();

  return query
  with minhas as (
    select ci.id as iid,
           ci.starts_at_utc as inicio,
           ci.ends_at_utc as fim,
           ci.state::text as estado,
           ci.teacher_id as prof
      from class_instances ci
     where ci.contract_id in (select public.my_contract_ids())
       and (ci.ends_at_utc < now() or ci.state <> 'scheduled')
  ),
  contadas as (select count(*) as n from minhas),
  pagina as (
    select m.* from minhas m
     order by m.inicio desc, m.iid
     limit v_limit offset v_offset
  )
  -- `contadas` DIRIGE (uma linha sempre) e a página entra por `left join`: com a
  -- página vazia sobra a linha-sentinela — `id` nulo e o total verdadeiro.
  select p.iid,
         p.inicio,
         p.fim,
         p.estado,
         t.display_name,
         f.cancelado_por,
         f.fora_do_aviso,
         f.gerou_credito,
         c.n
    from contadas c
    left join pagina p on true
    left join lateral public._fato_da_aula(p.iid, p.estado) f on true
    left join teachers t on t.id = p.prof
   order by p.inicio desc nulls last, p.iid;
end;
$$;

comment on function public.student_class_history(int, int) is
  'Histórico de aulas do PRÓPRIO aluno (my_contract_ids), com o fato que explica '
  'o estado: quem cancelou, se o aviso veio fora do prazo e se nasceu crédito — '
  'lidos do audit_log que _cancel_class_core/_mark_no_show escreveram. Página '
  'fora do intervalo devolve UMA linha com id nulo e o total certo. O portal '
  'traduz para português; a classificação é do banco.';

revoke execute on function public.student_class_history(int, int) from public, anon;
grant execute on function public.student_class_history(int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. student_class_state — o mesmo fato, para UMA aula (a página N3).
--
--     A página da aula precisa dizer, com as mesmas palavras da lista, por que
--     aquela aula não está mais agendada. Sem isto ela só teria o `state` cru e
--     voltaria a inventar ("cancelada") onde a lista sabe dizer "a professora
--     precisou cancelar".
--
--     ⚠️ UMA FRASE SÓ PARA OS DOIS "NÃO" (revisão do P4). As três funções
--     unitárias deste arquivo respondiam 'instância % não existe' quando o UUID
--     era desconhecido e 'você não tem acesso a esta aula (D10)' quando ele era
--     de outra pessoa — um ORÁCULO: com uma lista de UUIDs, a diferença entre as
--     duas frases confirma quais aulas EXISTEM na escola. Agora as duas portas
--     dizem a mesma coisa, 'aula não encontrada', e quem pergunta não aprende
--     nada com a resposta. (As funções de ESCRITA continuam com as mensagens
--     delas: lá quem chama já provou a posse.)
-- ---------------------------------------------------------------------------
create or replace function public.student_class_state(p_instance uuid)
returns table (
  state text,
  cancelado_por text,
  fora_do_aviso boolean,
  gerou_credito boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
begin
  perform public._aulas_do_aluno_permitido();

  select * into v_inst from class_instances where id = p_instance;
  if not found
     or (public.app_role() <> 'admin'
         and v_inst.contract_id not in (select public.my_contract_ids())) then
    raise exception 'aula não encontrada';
  end if;

  -- `left join lateral`: aula SEM registro de audit continua devolvendo UMA
  -- linha (com os fatos nulos). Sem isso, "não há registro" viraria "não há
  -- aula" para quem chama.
  return query
  select v_inst.state::text, f.cancelado_por, f.fora_do_aviso, f.gerou_credito
    from (select 1) as sempre
    left join lateral public._fato_da_aula(p_instance, v_inst.state::text) f on true;
end;
$$;

comment on function public.student_class_state(uuid) is
  'Estado de UMA aula do próprio aluno com o fato que o explica (quem cancelou, '
  'se veio fora do prazo, se nasceu crédito) — mesma fonte da student_class_history.';

revoke execute on function public.student_class_state(uuid) from public, anon;
grant execute on function public.student_class_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. preview_reschedule_effect — a MESMA classificação que `reschedule_class_at`
--    aplicaria se a pessoa confirmasse agora.
--
--    A ordem das decisões é a da função de escrita, linha por linha:
--      estado da instância → tipo/status do contrato → aviso mínimo sobre a aula
--      ORIGINAL → franquia do mês da data LOCAL da aula → crédito.
--    Divergir dessa ordem faria a tela prometer "sem custo" a quem o banco vai
--    recusar por outro motivo.
--
--    `franquia_restante` e `saldo_creditos` saem juntos porque a tela de
--    remarcação RE-EXPÕE os dois ANTES da escolha (a IA: "saldo re-exposto antes
--    de gastar"), e `validade_do_credito` é a validade do crédito que o FIFO
--    gastaria — a mesma escolha de `spend_makeup`.
--
--    Efeitos possíveis:
--      'franquia'          — cabe na franquia do mês (sem custo de crédito);
--      'credito'           — franquia esgotada, sai 1 crédito de reposição;
--      'sem_saldo'         — franquia esgotada e sem crédito: o banco recusaria;
--      'fora_do_aviso'     — passou do aviso mínimo do contrato;
--      'contrato_inativo'  — contrato pausado/encerrado (a RPC recusa);
--      'nao_remarcavel'    — contrato que não é particular 1:1;
--      'nao_agendada'      — a aula já saiu de 'scheduled'.
--
--    `limite_ts` É A FRONTEIRA QUE ESTA CLASSIFICAÇÃO USA (revisão do P4): o
--    instante em que o aviso mínimo do contrato expira
--    (`starts_at_utc − min_notice_hours`). O preview é uma foto do agora; quem
--    abre a tela faltando 3 minutos para essa fronteira e confirma depois recebe
--    a recusa do banco — correta, mas surpreendente. Devolvendo a fronteira, a
--    tela consegue dizer "isso vale se você confirmar até HH:MM" no fuso do
--    aluno, e a surpresa vira contagem regressiva anunciada. É DADO, não regra:
--    quem recusa continua sendo `reschedule_class_at`.
-- ---------------------------------------------------------------------------
create or replace function public.preview_reschedule_effect(p_instance uuid)
returns table (
  efeito text,
  franquia_restante int,
  saldo_creditos int,
  min_notice_hours int,
  validade_do_credito date,
  limite_ts timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_period text;
  v_used int;
  v_franquia int;
  v_saldo int;
  v_validade date;
  v_efeito text;
  v_limite timestamptz;
begin
  perform public._aulas_do_aluno_permitido();

  -- Posse (D10) e existência dizem a MESMA frase — ver a nota do oráculo acima.
  select * into v_inst from class_instances where id = p_instance;
  if not found
     or (public.app_role() <> 'admin'
         and v_inst.contract_id not in (select public.my_contract_ids())) then
    raise exception 'aula não encontrada';
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id;

  -- O período da franquia é o do banco: data civil da OCORRÊNCIA quando existe,
  -- senão o instante na zona da instância (class_instance_tz) — nunca o fuso
  -- atual de quem está olhando (o aluno pode ter mudado de país).
  v_period := to_char(
    coalesce(
      v_inst.occurrence_date,
      (v_inst.starts_at_utc at time zone coalesce(public.class_instance_tz(p_instance), public.business_tz()))::date
    ), 'YYYY-MM');

  select ru.used_count into v_used
    from reschedule_usage ru
   where ru.contract_id = v_contract.id and ru.period_ym = v_period;

  v_franquia := greatest(0, coalesce(v_contract.monthly_reschedule_allowance, 0) - coalesce(v_used, 0));
  v_saldo := public.makeup_balance(v_contract.id);

  -- O crédito que SAIRIA: o primeiro do replay do FIFO ainda válido hoje — a
  -- mesma escolha que `spend_makeup` fará. 'infinity' (crédito sem prazo) nunca
  -- sai daqui como palavra do Postgres.
  select nullif(rc.expires_on, 'infinity'::date) into v_validade
    from public._makeup_remaining_credits(v_contract.id) rc
   where rc.expires_on >= public.business_today()
   order by rc.expires_on, rc.ord
   limit 1;

  -- A fronteira do aviso mínimo, exatamente a que a linha `fora_do_aviso`
  -- compara com `now()` logo abaixo.
  v_limite := v_inst.starts_at_utc - make_interval(hours => v_contract.min_notice_hours);

  if v_inst.state <> 'scheduled' then
    v_efeito := 'nao_agendada';
  elsif v_contract.contract_type <> 'private_1on1' then
    v_efeito := 'nao_remarcavel';
  elsif v_contract.status <> 'active' then
    v_efeito := 'contrato_inativo';
  elsif now() > v_limite then
    v_efeito := 'fora_do_aviso';
  elsif v_franquia > 0 then
    v_efeito := 'franquia';
  elsif v_saldo > 0 then
    v_efeito := 'credito';
  else
    v_efeito := 'sem_saldo';
  end if;

  return query select
    v_efeito,
    v_franquia,
    v_saldo,
    v_contract.min_notice_hours,
    case when v_efeito = 'credito' then v_validade end,
    v_limite;
end;
$$;

comment on function public.preview_reschedule_effect(uuid) is
  'O que reschedule_class_at faria com ESTA aula se o aluno confirmasse agora: '
  'franquia, crédito, sem saldo ou recusa — mesma ordem de decisão da função de '
  'escrita, mais o instante (limite_ts) em que essa resposta expira. Leitura '
  'pura (D4: a consequência explicada na tela).';

revoke execute on function public.preview_reschedule_effect(uuid) from public, anon;
grant execute on function public.preview_reschedule_effect(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. preview_cancel_effect — o mesmo para `cancel_my_class`.
--
--    O aluno cancela com `p_cancelled_by = 'student'` e `notified_at = now()`
--    (o clique É o aviso). Sob essas duas constantes, o miolo da matriz D2 tem
--    UMA porta de crédito: `p_cancelled_by = 'teacher'` (ADR-018). Escrevemos a
--    condição na MESMA forma, com a constante do aluno — o dia em que a matriz
--    voltar a creditar cancelamento com aviso, esta linha muda junto com ela em
--    vez de continuar prometendo o contrário.
--
--    `dentro_do_aviso` não é sobre cancelar (cancelar é permitido a qualquer
--    hora, com a consequência): é sobre REMARCAR ainda ser um caminho — é ele
--    que decide se a tela oferece "quer só mudar o horário?".
--
--    Efeitos: 'sem_reposicao' (o cancelamento vale e a aula não é reposta),
--    'ja_comecou' (o banco manda usar no-show), 'nao_agendada', 'nao_cancelavel'.
--
--    `limite_ts` É A PRÓXIMA FRONTEIRA QUE MUDA ESTA RESPOSTA (revisão do P4).
--    Aqui há duas, e a que interessa depende de onde o relógio está:
--      · enquanto `dentro_do_aviso`, a fronteira é
--        `starts_at_utc − min_notice_hours` — passando dela, a tela para de
--        oferecer "quer só mudar o horário?" e a frase troca para "dada como
--        usada";
--      · depois dela, a fronteira é `starts_at_utc`: passando daí, o banco
--        recusa o cancelamento (é caso de no-show).
--    Devolvida a fronteira, a tela de confirmação diz "isso vale se você
--    confirmar até HH:MM" no fuso do aluno em vez de deixar o desfecho trocar em
--    silêncio entre o render e o clique.
-- ---------------------------------------------------------------------------
create or replace function public.preview_cancel_effect(p_instance uuid)
returns table (
  efeito text,
  gera_credito boolean,
  min_notice_hours int,
  dentro_do_aviso boolean,
  limite_ts timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  -- as duas constantes com que o portal chama `cancel_my_class`
  v_quem constant text := 'student';
  v_aviso timestamptz := now();
  v_efeito text;
  v_dentro boolean;
begin
  perform public._aulas_do_aluno_permitido();

  -- Posse (D10) e existência dizem a MESMA frase — ver a nota do oráculo acima.
  select * into v_inst from class_instances where id = p_instance;
  if not found
     or (public.app_role() <> 'admin'
         and v_inst.contract_id not in (select public.my_contract_ids())) then
    raise exception 'aula não encontrada';
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id;

  v_dentro := v_aviso <= v_inst.starts_at_utc
                - make_interval(hours => v_contract.min_notice_hours);

  if v_inst.state <> 'scheduled' then
    v_efeito := 'nao_agendada';
  elsif now() >= v_inst.starts_at_utc and v_aviso >= v_inst.starts_at_utc then
    v_efeito := 'ja_comecou';
  elsif v_contract.contract_type <> 'private_1on1' then
    v_efeito := 'nao_cancelavel';
  else
    v_efeito := 'sem_reposicao';
  end if;

  return query select
    v_efeito,
    -- a MESMA porta de crédito do miolo, com a constante do aluno
    (v_quem = 'teacher'),
    v_contract.min_notice_hours,
    v_dentro,
    -- a próxima fronteira a mudar esta resposta (ver o cabeçalho)
    case
      when v_dentro then v_inst.starts_at_utc
                           - make_interval(hours => v_contract.min_notice_hours)
      else v_inst.starts_at_utc
    end;
end;
$$;

comment on function public.preview_cancel_effect(uuid) is
  'O que cancel_my_class faria com ESTA aula agora: se o cancelamento vale, se '
  'nasce crédito (ADR-018: pelo aluno, nunca), se remarcar ainda é caminho e o '
  'instante (limite_ts) em que essa resposta muda. Leitura pura — a decisão '
  'continua sendo do miolo da matriz D2.';

revoke execute on function public.preview_cancel_effect(uuid) from public, anon;
grant execute on function public.preview_cancel_effect(uuid) to authenticated, service_role;
