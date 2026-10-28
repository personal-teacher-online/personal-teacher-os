-- Onda da Agenda · A6 · LOTE 3 — A VALIDADE DO CRÉDITO CONGELA NA PAUSA.
--
-- DECISÃO COMERCIAL DO DONO (30/07/2026), registrada na spec fechada do A6
-- (`docs/goals/onda-agenda.md` § "Migration 100"): **o relógio da validade do
-- crédito de reposição NÃO corre enquanto o contrato está pausado.** Ponto.
--
-- O QUE ESTAVA PELA METADE. `resume_contract` (efetiva
-- `20260727000800_fronteiras_finais.sql:580`) já devolvia os dias parados — mas
-- só para o crédito nascido ANTES da pausa, por causa do filtro
-- `ml.created_at < v_pause.created_at`. O crédito nascido DURANTE a pausa (a
-- escola compensa uma aula devida a quem está parado) caía num vão cego:
--   · não podia ser GASTO      — `spend_makeup` recusa contrato não-ativo;
--   · não podia ser ESTENDIDO  — `admin_extend_credit` recusa contrato pausado;
--   · não recebia AVISO        — `enqueue_credit_expiry_notices` filtra 'active';
--   · e a tela do portal confessava isso em voz alta
--     (`src/app/portal/creditos/page.tsx`, frase morta neste lote).
-- Ele simplesmente vencia.
--
-- ---------------------------------------------------------------------------
-- A FÓRMULA UNIFICADA (§100.a da spec)
-- ---------------------------------------------------------------------------
--   extensao = p_today − greatest(pausa.paused_on, dia_civil(credito.created_at))
--
-- Lida em português: o relógio do crédito só corre quando o crédito EXISTE e o
-- contrato NÃO está pausado. Ela substitui o filtro por exclusão.
--
--   · Crédito PRÉ-PAUSA: o dia civil da concessão é anterior (ou igual) a
--     `paused_on`, então `greatest` devolve `paused_on` e a conta é
--     LITERALMENTE a de hoje (`p_today − paused_on`, o antigo `v_days`).
--     ZERO mudança de comportamento — a compensação que já existia continua
--     idêntica, crédito por crédito.
--   · Crédito NASCIDO NA PAUSA: `greatest` devolve o dia da concessão, e a
--     extensão é só pelos dias que ele passou parado. Nem um dia a mais.
--   · A DUPLA EXTENSÃO (a preocupação M3-7) morre pela ARITMÉTICA, não por
--     exclusão: o crédito que a própria retomada acabou de emitir nasce com
--     `created_at = now()`, cujo dia civil é o próprio `p_today` — extensão 0.
--     (E o laço `for … in select` materializa o replay ANTES da primeira
--     escrita, então ele nem chega a ser revisto. Duas travas, não uma.)
--
-- POR QUE ISSO É IDÊNTICO EM PRODUÇÃO, e não só "quase": `paused_on` nunca é
-- retroativo no caminho abençoado — a coluna tem `default public.business_today()`
-- (`20260713000400:20`) e `pause_contract` NUNCA a preenche à mão
-- (`20260713000400:41-74`). Logo, todo crédito criado antes da linha de pausa
-- tem dia civil ≤ `paused_on`, e o `greatest` devolve `paused_on`. As duas
-- réguas — "criado antes da linha de pausa" e "dia civil ≤ paused_on" — só se
-- separam quando alguém INSERE a pausa com data retroativa, o que hoje só
-- acontece em fixture de teste (injeção de relógio por tabela). Onde separam,
-- quem tem razão é a fórmula nova: um crédito criado depois do início da pausa
-- é, por definição, um crédito nascido na pausa.
--
-- ---------------------------------------------------------------------------
-- MEDIÇÃO OBRIGATÓRIA DO LOTE (§100.d da spec) — encerrar/renovar contrato
-- PAUSADO com crédito congelado.
-- ---------------------------------------------------------------------------
-- Os predicados de "crédito vivo a preservar" das transferências usam
-- `rc.expires_on >= business_today()` CRU. Se uma dessas portas aceitasse
-- contrato pausado, um crédito congelado que passou da data morreria na
-- transferência sem ganhar a extensão prometida. Medido nas definições
-- EFETIVAS, uma a uma:
--
--   · `admin_renew_contract` — efetiva em
--     `20260727001300_correcoes_sol_rodada_3.sql:197`, guarda na linha 248:
--         if v_old.contract_type <> 'private_1on1' or v_old.status <> 'active'
--           then raise 'renovação exige contrato particular ATIVO (pausado: retome antes)'
--     → **RECUSA contrato pausado. Nada a fazer.** (E ao recusar, força a
--     retomada, que é justamente quem aplica a extensão.)
--
--   · `admin_end_contract` — efetiva em
--     `20260727001500_correcoes_sol_rodada_5.sql:230`. As únicas guardas de
--     estado são `contract_type <> 'private_1on1'` (linha 303) e
--     `status = 'ended'` (linha 306).
--     → **ACEITA contrato pausado.** Portanto, por mandato da spec, os DOIS
--     predicados de crédito vivo desta função (o gate de destinação, linha 332,
--     e o laço de destinação, linha 366) ganham a extensão unificada NESTA
--     migration. É a única porta da casa em que o congelamento precisava
--     aparecer fora da retomada.
--
--   · `close_and_create_slot` (`20260718000600:155`) não toca em crédito —
--     conferido; os `expires_on >= business_today()` de `20260718000600:302/338`
--     e `:483` pertencem às versões ANTIGAS de end/renew, já substituídas.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO MUDA — agora por COERÊNCIA, e não por furo (§100.c)
-- ---------------------------------------------------------------------------
--   · `admin_extend_credit` (efetiva `20260727000300:126`) continua RECUSANDO
--     contrato pausado. A mensagem dela — "o crédito está congelado e a validade
--     é estendida na RETOMADA" — era verdade parcial e passa a ser verdade
--     inteira, para todo crédito do contrato. Nenhuma linha de código dela muda.
--     ⚠️ Lápide: o COMENTÁRIO dela ("ele só revive o que nasceu ANTES da pausa",
--     `20260727000300:172-175`) descreve o mundo velho. A migration é imutável
--     (Lei 7); a correção do fato mora aqui.
--   · `enqueue_credit_expiry_notices` continua filtrando `c.status = 'active'`
--     (F3-D10). Antes isso deixava o crédito nascido na pausa vencer sem aviso —
--     era o terceiro lado do furo. Com o congelamento COMPLETO, contrato pausado
--     não tem crédito que vença de verdade: não há o que avisar. O filtro deixa
--     de ser silêncio e vira consequência.
--   · `admin_credit_expiry_overview` idem.
--
-- PRÉ-VOO DE DEPLOY: NENHUM. Esta migration não cria CHECK nem índice único;
-- ela só substitui corpos de função (nada a conferir em linha existente). Os
-- lançamentos que ela passa a emitir são `manual_adjust` no ledger — append-only,
-- Lei 2 preservada em todos os caminhos.

-- ###########################################################################
-- 0 · A ARITMÉTICA DO CONGELAMENTO, EM UM LUGAR SÓ
-- ###########################################################################
--
-- Duas funções precisam da mesma conta (`resume_contract` e
-- `admin_end_contract`), e regra de dinheiro duplicada é regra que diverge.
-- Ela nasce como helper INTERNO: quem precisa do EXECUTE são as funções DEFINER
-- que a chamam (rodam como donas), nunca o chamador de fora — padrão da casa
-- desde o c17.
--
-- Contrato da função, campo a campo:
--   p_expires_on   — a validade que o REPLAY devolve (`'infinity'` para crédito
--                    sem prazo; nunca NULL vindo de `_makeup_remaining_credits`,
--                    mas tratado assim mesmo);
--   p_criado_em    — `makeup_ledger.created_at` do lançamento +1 de origem;
--   p_pausa_em     — `contract_pauses.paused_on` da pausa ABERTA. NULL = não há
--                    pausa aberta registrada → extensão ZERO (é a leitura
--                    conservadora: contrato 'paused' sem linha de pausa é estado
--                    anômalo que `resume_contract` RECUSA, e prometer extensão
--                    ali seria prometer o que a retomada nunca fará);
--   p_today        — o "hoje" de QUEM CHAMA (relógio injetável — 20260723000100).
--                    Nunca `now()` interno.
--
-- Devolve SEMPRE >= 0. Crédito sem prazo não se estende (não vence). Crédito que
-- já estava morto no INÍCIO da pausa também não: ele não foi congelado, ele já
-- tinha acabado — é a mesma fronteira do `rc.expires_on >= v_pause.paused_on`
-- que a retomada usa desde a F3.
create or replace function public._dias_congelados_do_credito(
  p_expires_on date,
  p_criado_em timestamptz,
  p_pausa_em date,
  p_today date
) returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_pausa_em is null then 0
    when p_expires_on is null then 0
    when p_expires_on = 'infinity'::date then 0
    when p_expires_on < p_pausa_em then 0
    else greatest(
      p_today - greatest(p_pausa_em,
                         (p_criado_em at time zone public.business_tz())::date),
      0)
  end
$$;

comment on function public._dias_congelados_do_credito(date, timestamptz, date, date) is
  'Dias que a validade de UM crédito passou parada por causa da pausa do '
  'contrato (A6/lote 3, decisão do dono 30/07): p_today − greatest(paused_on, '
  'dia civil da concessão). Pré-pausa devolve exatamente os dias parados (a conta '
  'histórica da F3-D10.2); nascido na pausa devolve só os dias desde a concessão — '
  'nunca extensão dupla. Zero para crédito sem prazo, sem pausa aberta, ou já '
  'morto antes da pausa começar.';

revoke execute on function public._dias_congelados_do_credito(date, timestamptz, date, date)
  from public, anon, authenticated;

-- ###########################################################################
-- 1 · resume_contract — a extensão unificada (§100.a)
-- ###########################################################################
--
-- Reemissão INTEGRAL da versão efetiva (`20260727000800:580`). A assinatura não
-- muda, então `create or replace` basta (grants e revokes seguem intactos).
-- MUDANÇA, e só ela: o laço de extensão. Tudo o mais — a ordem de locks (c8·R1 /
-- c9·S1), o cancelamento das aulas da janela, a re-materialização dos slots, a
-- auditoria — é a mesma linha da versão anterior.
CREATE OR REPLACE FUNCTION public.resume_contract(p_contract uuid, p_actor uuid DEFAULT NULL::uuid, p_today date DEFAULT business_today())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract contracts%rowtype;
  v_pause contract_pauses%rowtype;
  v_actor uuid;
  v_days int;
  v_row record;
  v_extended int := 0;
  v_cancelled_ids uuid[] := array[]::uuid[];
  v_slot_ids uuid[] := array[]::uuid[];
  v_slot uuid;
  v_materialized int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'resume_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.status <> 'paused' then
    raise exception 'contrato % não está pausado (estado: %)', p_contract, v_contract.status;
  end if;

  select * into v_pause
  from contract_pauses
  where contract_id = p_contract and resumed_on is null
  for update;
  if not found then
    raise exception 'contrato % pausado sem registro de pausa aberto — corrigir via manual_adjust', p_contract;
  end if;

  v_days := p_today - v_pause.paused_on;
  if v_days < 0 then
    raise exception 'retomada (%) anterior ao início da pausa (%)', p_today, v_pause.paused_on;
  end if;

  -- c8 · R1: andares 2 e 4 ANTES de qualquer advisory (o da extensão de crédito
  -- mora dentro de `_reissue_credit`; o da materialização, dentro de
  -- `materialize_slot`).
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
     and (starts_at_utc at time zone public.business_tz())::date < p_today
   order by id
     for update;
  -- ALTERADO (c9 · S1): trava e GUARDA a lista — a materialização lá embaixo
  -- percorre exatamente estes ids.
  select coalesce(array_agg(id order by id), array[]::uuid[]) into v_slot_ids
  from (
    select id from recurring_slots
     where contract_id = p_contract and (active_to is null or active_to >= p_today)
     order by id
       for update
  ) travados;

  select coalesce(array_agg(i.id), array[]::uuid[]) into v_cancelled_ids
  from class_instances i
  where i.contract_id = p_contract
    and i.state = 'scheduled'
    and (i.starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
    and (i.starts_at_utc at time zone public.business_tz())::date < p_today;
  if coalesce(array_length(v_cancelled_ids, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled_ids);
  end if;

  if v_days > 0 then
    -- A6 · LOTE 3 — O FILTRO DE NASCIMENTO PRÉ-PAUSA MORREU AQUI (o literal
    -- dele está citado no cabeçalho desta migration; não repeti-lo no corpo é
    -- de propósito — o dump do banco inclui comentários, e o teste estrutural
    -- varre o dump). Ele decidia por EXCLUSÃO quem tinha compensação, e a exclusão
    -- era o furo: o crédito nascido durante a pausa ficava de fora e vencia
    -- calado. Agora quem decide é a aritmética, crédito a crédito
    -- (`_dias_congelados_do_credito`, seção 0 desta migration).
    --
    -- `v_days > 0` continua como porta de entrada porque é EQUIVALENTE: com
    -- `p_today = paused_on`, toda extensão individual seria 0 de qualquer jeito
    -- (o `greatest` nunca devolve data anterior a `paused_on`).
    for v_row in
      select rc.ledger_id, rc.expires_on, rc.duration_min, ml.class_instance_id, ml.student_id,
             public._dias_congelados_do_credito(rc.expires_on, ml.created_at,
                                                v_pause.paused_on, p_today) as extensao
      from public._makeup_remaining_credits(p_contract) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
      where rc.expires_on >= v_pause.paused_on
        and rc.expires_on <> 'infinity'::date
      order by rc.ord
    loop
      -- Extensão zero não gera lançamento: crédito concedido HOJE (inclusive o
      -- que este mesmo laço acabou de emitir) não perdeu dia nenhum, e o ledger
      -- não recebe par −1/+1 que não muda nada (Lei 2: movimento é fato, não
      -- enfeite).
      if v_row.extensao <= 0 then
        continue;
      end if;
      if v_row.expires_on >= p_today then
        perform public._reissue_credit(v_row.ledger_id, v_row.expires_on + v_row.extensao,
                                       v_actor, 'pausa: validade estendida (' || v_row.extensao || ' dias)',
                                       null, p_today);
      else
        -- expirou durante a pausa: morto para o FIFO (sem débito); renasce com
        -- a validade estendida, preservando duração + origem.
        insert into makeup_ledger
          (contract_id, student_id, delta, reason, class_instance_id, expires_on,
           duration_min, note, created_by)
        values
          (p_contract, v_row.student_id, 1, 'manual_adjust', v_row.class_instance_id,
           v_row.expires_on + v_row.extensao, v_row.duration_min,
           'pausa: validade estendida (' || v_row.extensao || ' dias)', v_actor);
      end if;
      v_extended := v_extended + 1;
    end loop;
  end if;

  update contracts set status = 'active' where id = p_contract;
  update contract_pauses set resumed_on = p_today where id = v_pause.id;

  foreach v_slot in array v_slot_ids loop
    v_materialized := v_materialized + public.materialize_slot(v_slot, 8);
  end loop;

  perform public.log_audit(v_actor, 'resume_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_pause.id, 'dias_pausados', v_days,
                       'creditos_estendidos', v_extended,
                       'aulas_canceladas_na_pausa', to_jsonb(v_cancelled_ids),
                       'aulas_materializadas', v_materialized));
  return v_extended;
end;
$function$;

comment on function public.resume_contract(uuid, uuid, date) is
  'Retomada de contrato pausado (F3-D10) + A6/lote 3: a validade CONGELA na '
  'pausa para TODO crédito, não só para o de antes dela. A compensação é '
  'p_today − greatest(paused_on, dia civil da concessão), por crédito — idêntica '
  'à conta histórica para o pré-pausa, e sem extensão dupla por construção.';

-- ###########################################################################
-- 2 · admin_end_contract — o congelado sobrevive ao encerramento (§100.d)
-- ###########################################################################
--
-- Reemissão INTEGRAL da versão efetiva (`20260727001500:230`). Assinatura
-- inalterada. MUDANÇAS, e só elas:
--   (i)  lê a pausa ABERTA do contrato (o encerramento aceita contrato pausado —
--        ver a MEDIÇÃO no cabeçalho);
--   (ii) os dois predicados de "crédito vivo" passam a olhar a validade EFETIVA
--        (a do papel + os dias congelados), em vez de `expires_on` cru;
--   (iii) a destinação preserva a validade EFETIVA, e o crédito congelado que já
--        passou da data no papel renasce no contrato destino em vez de sumir;
--   (iv) esse par escrito à mão emite o MESMO `log_audit('reissue_credit', …)`
--        que `_reissue_credit` emite no ramo vivo (Sol · rodada 2) — sem isso, o
--        mesmo encerramento deixava trilhas diferentes para créditos idênticos,
--        conforme a data de validade no papel.
--
-- POR QUE (iii) PRECISA DE UM RAMO PRÓPRIO: `_reissue_credit` recusa relançar
-- crédito que não esteja vivo NA DATA DO CHAMADOR ("crédito % não está vivo") —
-- e o congelado-vencido não está, aos olhos crus do replay. É exatamente a mesma
-- fronteira que a retomada atravessa com um `+1` sem débito
-- (`20260727000800:661-670`), e o caminho aqui é o mesmo, pelo mesmo motivo.
-- A BAIXA (`p_writeoff_note`) não precisa de ramo: o `−1` com
-- `consumes_ledger_id` acerta a linha por IDENTIDADE, viva ou vencida
-- (`_makeup_remaining_credits`, 20260718000300:98-105), e o saldo não fica
-- negativo porque o crédito vencido já não contava para ele.
--
-- LOCK: a pausa é travada logo depois da linha do contrato — a MESMA posição em
-- que `pause_contract`/`resume_contract` a travam (contrato → pausa → aulas →
-- horários → advisory). Nenhuma ordem nova entra na casa.
create or replace function public.admin_end_contract(
  p_contract uuid,
  p_confirm_name text,
  p_dest_contract uuid default null::uuid,
  p_writeoff_note text default null::text,
  p_actor uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old contracts%rowtype;
  v_dest contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_cancelled uuid[] := array[]::uuid[];
  v_slots int := 0;
  v_live record;
  v_transferred int := 0;
  v_writeoff int := 0;
  v_nome text;
  -- A6 · lote 3
  v_hoje date := public.business_today();
  v_pausa_em date;
  -- …e o id do +1 escrito à mão no ramo do congelado-vencido: ele existe para a
  -- linha de auditoria ter a MESMA entidade que `_reissue_credit` registra.
  v_novo_credito bigint;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_end_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- c14 · Sol 4.1 · ANDAR 0: o dono do NOME é travado antes de tudo, para que a
  -- linha de onde sai a confirmação não mude embaixo desta transação enquanto
  -- ela espera pelos locks de baixo.
  perform 1
    from students s
   where s.id = (select c.student_id from contracts c where c.id = p_contract)
   order by s.id
     for update;
  perform 1
    from student_groups g
   where g.id = (select c.student_group_id from contracts c where c.id = p_contract)
   order by g.id
     for update;

  -- (c7b · Q2): TODAS as linhas de contrato deste encerramento, de uma vez e em
  -- ordem determinística por uuid, ANTES de qualquer advisory.
  perform 1 from contracts
   where id in (p_contract, p_dest_contract)
   order by id
     for update;

  select * into v_old from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;

  -- c13 · nº 5: a confirmação acontece DENTRO da transação, contra a linha já
  -- travada — o nome é o de AGORA, e "agora" vale até o commit.
  select coalesce(s.display_name, g.label) into v_nome
    from contracts c
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where c.id = p_contract;

  if coalesce(btrim(v_nome), '') = '' then
    raise exception
      'este contrato não tem nome de confirmação (nem aluno, nem turma) — corrija o cadastro antes de encerrar';
  end if;
  -- c15 · Sol 12: a régua saiu daqui e virou `_confirmacao_bate` (NFC + caixa +
  -- espaço interno dobrado). Um lugar só, para os dois portões que a usam.
  if not public._confirmacao_bate(p_confirm_name, v_nome) then
    raise exception
      'confirmação não confere — digite o nome exato (%) para encerrar', v_nome;
  end if;

  if v_old.contract_type <> 'private_1on1' then
    raise exception 'encerramento estendido é de contratos particulares';
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato % já está encerrado', p_contract;
  end if;

  -- A6 · LOTE 3 · a pausa ABERTA, travada aqui (contrato → pausa, a ordem de
  -- pause/resume). Esta porta é a ÚNICA da casa que ACEITA contrato pausado —
  -- a renovação recusa e manda retomar antes. Sem esta leitura, o crédito
  -- congelado que passou da data no papel morreria caladinho no encerramento,
  -- que é o oposto exato do que a pausa promete ao aluno.
  -- Contrato 'paused' SEM pausa aberta é estado anômalo (o mesmo que
  -- `resume_contract` recusa): v_pausa_em fica NULL e a régua normal vale.
  if v_old.status = 'paused' then
    select cp.paused_on into v_pausa_em
      from contract_pauses cp
     where cp.contract_id = p_contract and cp.resumed_on is null
     order by cp.paused_on
     limit 1
       for update;
  end if;

  -- GATE DURO (M5-3): pendências exigem desfecho antes (o lote M1-3 é o atalho).
  v_pending := public._contract_pending_count(p_contract);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho neste contrato — registre antes (o botão "todas aconteceram" resolve as positivas)', v_pending;
  end if;

  -- c8 · R1: andares 2 e 4 da ordem canônica, ordenados por uuid, ainda ANTES
  -- do advisory.
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled' and starts_at_utc > now()
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today())
   order by id
     for update;

  -- destinação obrigatória quando há saldo vivo (escolha EXPLÍCITA)
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  -- A6 · lote 3: "vivo" passa a ser medido pela validade EFETIVA (papel + dias
  -- congelados). Fora de pausa a extensão é 0 e a condição é a de sempre.
  if exists (
    select 1
      from public._makeup_remaining_credits(p_contract) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
     where rc.expires_on
           + public._dias_congelados_do_credito(rc.expires_on, ml.created_at, v_pausa_em, v_hoje)
           >= v_hoje
  ) then
    if p_dest_contract is null and btrim(coalesce(p_writeoff_note, '')) = '' then
      raise exception 'este contrato tem créditos vivos — transfira para outro contrato do aluno OU dê baixa com motivo';
    end if;
  end if;
  if p_dest_contract is not null then
    select * into v_dest from contracts where id = p_dest_contract;
    if not found or v_dest.contract_type <> 'private_1on1' or v_dest.status <> 'active' then
      raise exception 'contrato destino inválido (precisa ser particular ATIVO)';
    end if;
    if p_dest_contract = p_contract then
      raise exception 'destino não pode ser o próprio contrato';
    end if;
    if not public._contracts_same_people(v_old, v_dest) then
      raise exception 'o destino precisa ser do MESMO aluno/grupo (M3-4)';
    end if;
  end if;

  -- futuras saem SEM crédito e SEM aviso (P4: deliberado — conversa humana).
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_contract and ci.state = 'scheduled' and ci.starts_at_utc > now();
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  update recurring_slots
     set active_to = greatest(active_from, public.business_today())
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today());
  get diagnostics v_slots = row_count;

  -- destinação dos créditos vivos (validade e duração PRESERVADAS — M3-4/P6;
  -- e, sob pausa, a validade preservada é a EFETIVA — A6 · lote 3)
  for v_live in
    select rc.ledger_id,
           rc.expires_on,
           rc.duration_min,
           ml.class_instance_id,
           ml.student_id,
           (rc.expires_on
            + public._dias_congelados_do_credito(rc.expires_on, ml.created_at, v_pausa_em, v_hoje))
             as validade_efetiva
      from public._makeup_remaining_credits(p_contract) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
     where rc.expires_on
           + public._dias_congelados_do_credito(rc.expires_on, ml.created_at, v_pausa_em, v_hoje)
           >= v_hoje
     order by rc.ord
  loop
    if p_dest_contract is not null then
      if v_live.expires_on >= v_hoje then
        perform public._reissue_credit(v_live.ledger_id, v_live.validade_efetiva, v_actor,
          'encerramento: crédito transferido', p_dest_contract);
      else
        -- CONGELADO que passou da data no papel: morto para o replay, então não
        -- há o que `_reissue_credit` relance (ele recusaria). O par é escrito à
        -- mão, com a mesma forma que ele usaria — e o débito FICA, diferente do
        -- revival da retomada: lá o `+1` nasce no MESMO contrato (deixar o
        -- vencido de pé não confunde ninguém, o saldo já o ignorava); aqui ele
        -- nasce em OUTRO, e um `+1` que teleporta sem contrapartida é
        -- exatamente o que a dupla entrada existe para impedir (Lei 2).
        -- `consumes_ledger_id` acerta a linha por identidade, viva ou vencida.
        insert into makeup_ledger
          (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
        values
          (p_contract, v_live.student_id, -1, 'manual_adjust', v_live.ledger_id,
           'encerramento durante pausa: crédito congelado transferido', v_actor);
        insert into makeup_ledger
          (contract_id, student_id, delta, reason, class_instance_id, expires_on,
           duration_min, note, created_by)
        values
          (p_dest_contract, v_live.student_id, 1, 'manual_adjust', v_live.class_instance_id,
           v_live.validade_efetiva, v_live.duration_min,
           'encerramento durante pausa: crédito congelado transferido', v_actor)
        returning id into v_novo_credito;

        -- PARIDADE DE AUDITORIA (Sol · rodada 2 do lote 3, C10b · Lei 8).
        -- O ramo VIVO deste mesmo laço chama `_reissue_credit`, que emite UM
        -- `log_audit('reissue_credit', 'makeup_ledger', <novo id>)` por crédito
        -- movido. O ramo do congelado-vencido escrevia o par −1/+1 à mão e não
        -- emitia nada: dois créditos transferidos no MESMO encerramento
        -- deixavam trilhas diferentes conforme a data de validade no papel, e a
        -- linha agregada de `end_contract` só conta quantos foram. Mesma ação,
        -- mesma entidade, mesmas chaves do `diff` — quem for reconstituir seis
        -- meses depois lê uma coisa só.
        perform public.log_audit(v_actor, 'reissue_credit', 'makeup_ledger', v_novo_credito::text,
          jsonb_build_object(
            'from_ledger', v_live.ledger_id, 'from_contract', p_contract,
            'to_contract', p_dest_contract, 'old_expires_on', v_live.expires_on,
            'new_expires_on', v_live.validade_efetiva, 'duration_min', v_live.duration_min,
            'note', 'encerramento durante pausa: crédito congelado transferido'));
      end if;
      v_transferred := v_transferred + 1;
    else
      insert into makeup_ledger
        (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
      values
        (p_contract, v_old.student_id, -1, 'manual_adjust', v_live.ledger_id,
         'encerramento: baixa — ' || p_writeoff_note, v_actor);
      v_writeoff := v_writeoff + 1;
    end if;
  end loop;

  -- greatest: contrato com started_on futuro nunca viola o CHECK ended>=started
  update contracts
     set status = 'ended', ended_on = greatest(public.business_today(), started_on)
   where id = p_contract;

  perform public.log_audit(v_actor, 'end_contract', 'contracts', p_contract::text,
    jsonb_build_object(
      'razao', 'encerramento',
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_closed', v_slots,
      'credits_transferred', v_transferred,
      'credits_written_off', v_writeoff,
      'dest_contract', p_dest_contract,
      'writeoff_note', p_writeoff_note,
      -- A6 · lote 3: se o contrato estava pausado, o audit guarda a data que
      -- governou a extensão dos congelados (Lei 8 — o número precisa ser
      -- reconstituível depois).
      'pausa_em', v_pausa_em,
      -- Lei 8: o portão da destrutiva grande deixa rastro do que foi conferido.
      'confirm_name', v_nome));

  return jsonb_build_object('cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'slots_closed', v_slots,
                            'transferred', v_transferred, 'written_off', v_writeoff);
end;
$function$;

comment on function public.admin_end_contract(uuid, text, uuid, text, uuid) is
  'M5-3/M3-4 + c13 · nº 5 + c14 · Sol 4.1/4.2 + c15 · Sol 12 + A6 · lote 3: '
  'encerramento estendido com type-to-confirm dentro da transação, com a linha do '
  'NOME travada (andar 0) e com a comparação feita pela régua única '
  '`_confirmacao_bate`. É a única porta que aceita contrato PAUSADO — e por isso '
  'ela mede o crédito pela validade EFETIVA (papel + dias congelados), '
  'transferindo o congelado em vez de deixá-lo morrer no encerramento.';

-- ###########################################################################
-- 3 · O CONGELADO VIRA VERDADE ESTRUTURAL NO EXTRATO DO ALUNO (§100.b)
-- ###########################################################################
--
-- `student_credit_statement` e `student_credit_totals` são reemitidas INTEIRAS
-- aqui porque a migration que as definiu (`20260728000500_portal_creditos_do_banco.sql`)
-- JÁ ESTÁ APLICADA em produção e é imutável (Lei 7).
--
-- MUDANÇA ÚNICA, nas duas: o predicado `congelado` perde a condição
-- `rcriado < pausa_criada_em`. Ela existia porque a retomada de fato NÃO
-- reemitia o crédito nascido na pausa — e o comentário original dizia isso com
-- todas as letras ("a tela não promete extensão que não existe"). A retomada
-- agora reemite. A tela volta a poder prometer, porque a promessa virou verdade.
--
-- As demais condições FICAM, uma a uma, porque continuam sendo exatamente as de
-- `resume_contract`:
--   · contrato 'paused' com pausa ABERTA registrada (`pausa_em is not null`);
--   · crédito com prazo (`rexp <> 'infinity'`);
--   · crédito ainda vivo no início da pausa (`rexp >= pausa_em`) — quem já tinha
--     morrido antes da pausa não foi congelado, foi enterrado.
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
           -- A6 · LOTE 3 (decisão do dono, 30/07): a condição de NASCIMENTO
           -- PRÉ-PAUSA morreu (literal citado no cabeçalho, fora do corpo —
           -- o dump inclui comentários). Ela dizia que só o crédito
           -- nascido antes da pausa era congelado — o que era verdade sobre o
           -- banco velho, e é falso sobre este. `resume_contract` agora estende
           -- TODO crédito parado, inclusive o concedido durante a pausa (pelos
           -- dias desde a concessão). Congelar aqui deixou de ser promessa vazia.
           --
           -- O resto da régua fica intacto e continua sendo, item por item, o de
           -- `resume_contract`: pausa ABERTA registrada (contrato 'paused' sem
           -- linha de pausa é anomalia que a retomada RECUSA — classifica pela
           -- régua normal, Sol P3 r3 achado 1), crédito COM prazo, e crédito
           -- ainda vivo no início da pausa.
           (r.cstatus = 'paused'
            and r.pausa_em is not null
            and r.rexp <> 'infinity'::date
            and r.rexp >= r.pausa_em) as rcongelado
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
  'A6/lote 3: congelado vale para TODO crédito de contrato pausado — inclusive o '
  'concedido durante a pausa, que a retomada passou a estender. O portal formata, '
  'não decide.';

revoke execute on function public.student_credit_statement(int) from public, anon;
grant execute on function public.student_credit_statement(int) to authenticated, service_role;

-- Mesma mudança, mesma justificativa, na irmã agregada. O `join makeup_ledger`
-- FICA de propósito, mesmo agora que `rcriado` não é mais lido pelo predicado:
-- as duas CTEs precisam continuar sendo a imagem uma da outra, para que o cartão
-- do Início e a página de créditos não possam divergir — que é a razão de esta
-- função existir separada.
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
           -- A6 · LOTE 3: a condição de nascimento pré-pausa morreu aqui também —
           -- a régua do saldo e a do extrato são a MESMA régua, e uma tela não
           -- pode congelar o que a outra conta como vivo. Ver o bloco irmão em
           -- `student_credit_statement`.
           (r.cstatus = 'paused'
            and r.pausa_em is not null
            and r.rexp <> 'infinity'::date
            and r.rexp >= r.pausa_em) as rcongelado
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
  'da student_credit_statement (vencido/congelado por business_today + FIFO), '
  'incluindo o congelamento COMPLETO da pausa (A6/lote 3).';

revoke execute on function public.student_credit_totals() from public, anon;
grant execute on function public.student_credit_totals() to authenticated, service_role;
