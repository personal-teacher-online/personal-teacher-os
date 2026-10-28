-- Onda do Portal · P3 (rodada de correção) — A CLASSIFICAÇÃO VOLTA PARA O BANCO.
--
-- A revisão adversarial do P3 achou quatro decisões de DINHEIRO tomadas em
-- TypeScript, cada uma com uma régua própria e cada uma divergindo do que o
-- Postgres impõe (Lei 3):
--
--   1. a validade anunciada ao aluno vinha das linhas +1 CRUAS do ledger, não
--      do replay do FIFO — crédito A (vence antes) já gasto e crédito B vivo, e
--      o cartão anunciava a validade do A;
--   2. crédito de contrato PAUSADO era tratado como usável ou como vencido —
--      mas a pausa CONGELA a validade (F3-D10.2: a retomada reemite cada
--      crédito congelado com expires_on + dias parados) e `/portal/resgatar`
--      recusa contrato não-ativo. Dizer "venceu" a quem está pausado é dar por
--      perdido um crédito que o banco vai devolver;
--   3. vencido/vivo era decidido com o "hoje" do fuso do ALUNO, enquanto o
--      ledger inteiro (makeup_balance, enqueue_credit_expiry_notices,
--      admin_credit_expiry_overview) decide por `business_today()`. Duas
--      viradas de dia diferentes = um dia por ano em que a tela e o banco
--      discordam sobre o mesmo crédito;
--   4. "mensalidade em aberto" era "tudo que não é received/confirmed/
--      received_in_cash" — o que transforma uma cobrança ESTORNADA, com
--      chargeback ou cancelada em "mensalidade em atraso" na cara do aluno. A
--      régua autoritativa já existe desde 26/07 (`payment_nao_cobravel`) e é a
--      que a admin vê nos KPIs.
--
-- Duas superfícies, nenhuma regra nova: o banco passa a ENTREGAR a
-- classificação que já usa internamente, e o TypeScript volta a só formatar.

-- ---------------------------------------------------------------------------
-- 1. student_credit_statement — o extrato de créditos do PRÓPRIO aluno, já
--    classificado. Uma leitura para as duas telas (o cartão do Início e a
--    página de créditos), para que elas não possam mais discordar.
--
--    SECURITY DEFINER por UMA razão: `contract_pauses` é admin-only na RLS
--    (F3-D10) e sem a data de início da pausa não dá para dizer o que está
--    congelado. O escopo é fechado na primeira linha por `my_contract_ids()`
--    (auth.uid()), exatamente como as views do portal — quem chama vê os
--    contratos dele e mais nada; e o PAPEL de quem pode perguntar é conferido
--    no corpo (`_extrato_de_creditos_permitido`, revisão 2 · D5).
--
--    O que cada campo significa:
--      · expires_on      — NULL quando o crédito nasceu sem prazo (o replay
--                          carimba 'infinity'; essa palavra não sai daqui);
--      · dias_restantes  — expires_on − business_today() (NULL sem prazo);
--      · vencido         — a MESMA régua do makeup_balance (expires_on <
--                          business_today()), nunca a virada de dia do cliente;
--      · congelado       — contrato pausado e crédito que a retomada vai
--                          estender. A condição é a MESMA de `resume_contract`
--                          (20260727000800), item por item, porque "congelado"
--                          na tela é uma PROMESSA de que a retomada devolve os
--                          dias parados:
--                            · tem prazo (`expires_on <> 'infinity'`),
--                            · estava vivo no início da pausa (`>= paused_on`),
--                            · e foi CRIADO ANTES dela
--                              (`makeup_ledger.created_at <`
--                               `contract_pauses.created_at`).
--                          Crédito concedido DURANTE a pausa (a escola dá um
--                          crédito a quem está parado) NÃO é reemitido pela
--                          retomada — então cai na régua normal: vence quando
--                          vence, e a tela não promete extensão que não existe
--                          (revisão adversarial 2 · D1).
--
--    p_memoria_dias corta a cauda: crédito vencido há mais que isso não
--    interessa a ninguém (a tela já tinha essa janela — ela só estava do lado
--    errado da fronteira).
--
--    `origem_autor` — QUEM desmarcou a aula que gerou o crédito (revisão
--    adversarial do P4, E3). A tela traduzia TODO `earn_cancellation` como
--    "porque a professora precisou desmarcar", o que é verdade DEPOIS da ADR-018
--    (18/07/2026) e só depois: antes dela, cancelamento do ALUNO com aviso
--    também creditava, e esses lançamentos continuam no ledger. Sem o autor, a
--    tela contava ao aluno uma história em que a escola falhou quando quem
--    desmarcou foi ele.
--
--    A derivação é a MESMA de `_fato_da_aula` (migration 20260728000600): a
--    última linha de `audit_log` da aula ligada ao lançamento
--    (`makeup_ledger.class_instance_id`), campo `cancelled_by`. Só 'student' e
--    'teacher' passam; qualquer outra coisa — e a AUSÊNCIA de audit (crédito
--    migrado, ajuste manual, aula perdida por encerramento) — sai como NULL, e a
--    tela cai na frase NEUTRA. Não determinar o autor é um resultado legítimo;
--    inventar um culpado não é.
-- ---------------------------------------------------------------------------

-- O PORTEIRO DE PAPEL, em um lugar só (revisão 2 · D5). SECURITY DEFINER sem
-- conferência de papel entregava o extrato a QUALQUER autenticado: a conta
-- `teacher` que também esteja vinculada a uma linha de `students` (a professora
-- que faz aula na escola) passava por `my_contract_ids()` e recebia o extrato
-- pelo caminho do portal. O escopo por `auth.uid()` diz QUAIS linhas; o papel
-- diz QUEM tem direito a perguntar — e as duas funções abaixo perguntam igual.
create or replace function public._extrato_de_creditos_permitido()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.app_role() not in ('student', 'admin') then
    raise exception 'sem acesso ao extrato de créditos';
  end if;
end;
$$;

-- Helper INTERNO: quem precisa do EXECUTE é a função DEFINER que o chama (ela
-- roda como dona), nunca o chamador de fora. Padrão da casa desde o c17.
revoke execute on function public._extrato_de_creditos_permitido()
  from public, anon, authenticated;

create or replace function public.student_credit_statement(
  p_memoria_dias int default 60
)
returns table (
  contract_id uuid,
  contract_status text,
  ord int,
  ledger_id bigint,
  expires_on date,
  dias_restantes int,
  vencido boolean,
  congelado boolean,
  duration_min int,
  reason text,
  created_at timestamptz,
  note text,
  class_starts_at_utc timestamptz,
  origem_autor text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := public.business_today();
  -- TETO NO PARÂMETRO (revisão 2 · D7): sem ele, `p_memoria_dias = 10^9` estoura
  -- o tipo `date` na conta `v_hoje - v_memoria` e a função morre com "date out
  -- of range" em vez de responder. 365 é muito além do que a tela pede (60).
  v_memoria int := least(greatest(coalesce(p_memoria_dias, 0), 0), 365);
begin
  perform public._extrato_de_creditos_permitido();

  return query
  with meus as (
    select c.id as cid,
           c.status as cstatus,
           -- Contrato pausado SEM pausa aberta é anomalia (resume_contract
           -- recusa esse estado): o coalesce lá embaixo congela o que ainda
           -- está vivo hoje, que é a leitura conservadora — nunca dar um
           -- crédito por perdido.
           p.paused_on as pausa_em,
           p.criada_em as pausa_criada_em
      from contracts c
      left join lateral (
        select cp.paused_on, cp.created_at as criada_em
          from contract_pauses cp
         where cp.contract_id = c.id and cp.resumed_on is null
         order by cp.paused_on
         limit 1
      ) p on true
     where c.id in (select public.my_contract_ids())
       and c.contract_type = 'private_1on1'
       and c.status <> 'ended'
  ),
  replay as (
    select m.cid, m.cstatus, m.pausa_em, m.pausa_criada_em,
           rc.ord as rord, rc.ledger_id as rledger, rc.expires_on as rexp,
           rc.duration_min as rdur,
           ml.created_at as rcriado, ml.reason::text as rreason, ml.note as rnote,
           ci.starts_at_utc as raula,
           -- QUEM desmarcou a aula que originou o crédito (E3 do P4). Mesmo
           -- padrão de `_fato_da_aula`: a última linha de audit da aula ligada.
           -- Sem aula ligada, sem audit, ou autor fora do par conhecido → NULL.
           case when au.autor in ('student', 'teacher') then au.autor end as rautor
      from meus m
      cross join lateral public._makeup_remaining_credits(m.cid) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
      left join class_instances ci on ci.id = ml.class_instance_id
      left join lateral (
        select a.diff ->> 'cancelled_by' as autor
          from audit_log a
         where ml.class_instance_id is not null
           and a.entity = 'class_instances'
           and a.entity_id = ml.class_instance_id::text
           and a.action in ('cancel_class', 'no_show_student', 'no_show_teacher')
         order by a.at desc, a.id desc
         limit 1
      ) au on true
  ),
  classificado as (
    select r.*,
           -- Congelado SÓ com pausa ABERTA registrada, nas mesmas condições que
           -- resume_contract reemite (fronteiras_finais:653-663). Contrato
           -- 'paused' SEM linha de pausa aberta é estado anômalo que
           -- resume_contract RECUSA — prometer congelamento aqui seria
           -- prometer extensão que a retomada nunca fará; classifica pela
           -- régua normal (Sol P3 r3, achado 1).
           (r.cstatus = 'paused'
            and r.pausa_em is not null
            and r.rexp <> 'infinity'::date
            and r.rexp >= r.pausa_em
            and r.rcriado < r.pausa_criada_em) as rcongelado
      from replay r
  )
  select cl.cid,
         cl.cstatus,
         cl.rord,
         cl.rledger,
         nullif(cl.rexp, 'infinity'::date),
         case when cl.rexp = 'infinity'::date then null else (cl.rexp - v_hoje) end,
         (not cl.rcongelado and cl.rexp <> 'infinity'::date and cl.rexp < v_hoje),
         cl.rcongelado,
         cl.rdur,
         cl.rreason,
         cl.rcriado,
         cl.rnote,
         cl.raula,
         cl.rautor
    from classificado cl
   where cl.rcongelado
      or cl.rexp = 'infinity'::date
      or cl.rexp >= v_hoje - v_memoria
   order by cl.cid, cl.rexp, cl.rord;
end;
$$;

comment on function public.student_credit_statement(int) is
  'Extrato de créditos de reposição do PRÓPRIO aluno (my_contract_ids), já '
  'classificado pelo banco: vencido/congelado/dias_restantes por business_today() '
  'e pelo replay do FIFO (_makeup_remaining_credits), mais origem_autor (quem '
  'desmarcou a aula que gerou o crédito, lido do audit; NULL = indeterminado). '
  'O portal formata, não decide.';

revoke execute on function public.student_credit_statement(int) from public, anon;
grant execute on function public.student_credit_statement(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. student_credit_totals — o SALDO e a PRÓXIMA VALIDADE, somados NO BANCO.
--
--     Por que uma segunda função em vez de somar o extrato em TypeScript
--     (revisão 2 · D2): o PostgREST corta toda resposta em `max_rows`
--     (supabase/config.toml:16, hoje 1000) e devolve o corte como SUCESSO. Um
--     aluno com muitos créditos veria um saldo silenciosamente menor que o
--     real — o número que ele lê como "quantas aulas a escola me deve". Um
--     agregado devolve UMA linha por contrato e é imune ao teto por construção.
--
--     Mesmo escopo (my_contract_ids), mesmo porteiro de papel e MESMA
--     classificação da statement — é a mesma CTE, para que o cartão do Início e
--     a página de créditos não possam divergir.
--
--     "Vivo" = o que o aluno pode gastar hoje: nem vencido nem congelado. É a
--     mesma contagem de `makeup_balance` para contrato ativo.
-- ---------------------------------------------------------------------------
create or replace function public.student_credit_totals()
returns table (
  contract_id uuid,
  saldo int,
  proxima_validade date,
  proxima_validade_dias int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := public.business_today();
begin
  perform public._extrato_de_creditos_permitido();

  return query
  with meus as (
    select c.id as cid,
           c.status as cstatus,
           p.paused_on as pausa_em,
           p.criada_em as pausa_criada_em
      from contracts c
      left join lateral (
        select cp.paused_on, cp.created_at as criada_em
          from contract_pauses cp
         where cp.contract_id = c.id and cp.resumed_on is null
         order by cp.paused_on
         limit 1
      ) p on true
     where c.id in (select public.my_contract_ids())
       and c.contract_type = 'private_1on1'
       and c.status <> 'ended'
  ),
  replay as (
    select m.cid, m.cstatus, m.pausa_em, m.pausa_criada_em,
           rc.expires_on as rexp, ml.created_at as rcriado
      from meus m
      left join lateral public._makeup_remaining_credits(m.cid) rc on true
      left join makeup_ledger ml on ml.id = rc.ledger_id
  ),
  classificado as (
    select r.cid, r.rexp,
           -- Congelado SÓ com pausa ABERTA registrada, nas mesmas condições que
           -- resume_contract reemite (fronteiras_finais:653-663). Contrato
           -- 'paused' SEM linha de pausa aberta é estado anômalo que
           -- resume_contract RECUSA — prometer congelamento aqui seria
           -- prometer extensão que a retomada nunca fará; classifica pela
           -- régua normal (Sol P3 r3, achado 1).
           (r.cstatus = 'paused'
            and r.pausa_em is not null
            and r.rexp <> 'infinity'::date
            and r.rexp >= r.pausa_em
            and r.rcriado < r.pausa_criada_em) as rcongelado
      from replay r
  ),
  vivo as (
    select cl.cid, cl.rexp
      from classificado cl
     where cl.rexp is not null
       and not cl.rcongelado
       and (cl.rexp = 'infinity'::date or cl.rexp >= v_hoje)
  )
  -- `left join` para que contrato SEM crédito volte com saldo 0 em vez de
  -- sumir: quem chama não precisa saber a diferença entre "não tem" e "não veio".
  select m.cid,
         count(v.rexp)::int,
         min(v.rexp) filter (where v.rexp <> 'infinity'::date),
         (min(v.rexp) filter (where v.rexp <> 'infinity'::date) - v_hoje)::int
    from meus m
    left join vivo v on v.cid = m.cid
   group by m.cid;
end;
$$;

comment on function public.student_credit_totals() is
  'Saldo e próxima validade por contrato do PRÓPRIO aluno, AGREGADOS no banco — '
  'imunes ao corte de max_rows do PostgREST (config.toml). Mesma classificação '
  'da student_credit_statement (vencido/congelado por business_today + FIFO).';

revoke execute on function public.student_credit_totals() from public, anon;
grant execute on function public.student_credit_totals() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Cobrança em aberto — a régua do dinheiro, em UM lugar.
--    "Em aberto" = cobrável (payment_nao_cobravel diz o contrário) E não paga
--    pela mesma régua do painel da admin (paid_at OU status pago do Asaas).
--    Estornada/chargeback/cancelada/apagada NÃO é dívida do aluno.
-- ---------------------------------------------------------------------------
create or replace function public.payment_em_aberto(
  p_status text,
  p_paid_at timestamptz
) returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select not public.payment_nao_cobravel(p_status)
     and p_paid_at is null
     and lower(coalesce(p_status, '')) not in ('received', 'confirmed', 'received_in_cash')
$$;

comment on function public.payment_em_aberto(text, timestamptz) is
  'Cobrança que ainda pede algo do pagador. Mesma régua do em-atraso dos KPIs '
  '(_admin_kpis_compute), agora nomeada: o portal a LÊ em vez de reimplementar '
  'a lista de status em TypeScript (revisão adversarial do P3).';

-- A view do aluno passa a carregar a classificação junto do dado. `create or
-- replace view` acrescenta colunas NO FIM — as antigas seguem no mesmo lugar,
-- com o mesmo tipo (Lei 7: migration nova, nunca edição da de 12/07).
-- `em_atraso` usa business_today(): o dia civil do NEGÓCIO decide atraso, não o
-- relógio do dispositivo nem o fuso de quem está olhando.
create or replace view payments_student as
  select p.id, p.contract_id, p.amount_cents, p.status, p.due_date, p.reference_ym,
         public.payment_em_aberto(p.status, p.paid_at) as em_aberto,
         (public.payment_em_aberto(p.status, p.paid_at)
          and p.due_date is not null
          and p.due_date < public.business_today()) as em_atraso
    from payments p
   where p.contract_id in (select public.my_contract_ids());

comment on view payments_student is
  'Espelho enxuto por contrato do chamador (my_contract_ids usa auth.uid()). '
  'raw/payer_id NUNCA nesta view (ADR-010 §1). em_aberto/em_atraso são a régua '
  'do banco (payment_em_aberto + business_today), não uma lista de status em TS.';
