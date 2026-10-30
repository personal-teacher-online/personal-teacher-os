-- =============================================================================
-- Onda Agenda e Mensagens · M3-1, issue #42 (30/10/2026) — ENTREGA E REENVIO,
-- revisada para a Cloud API da Meta (ADR-038, aceito em 26/10/2026).
--
-- O outbox passa a saber QUEM entregou cada mensagem (provedor + id da
-- mensagem no provedor) e QUANDO ela foi entregue e lida; a dona ganha um
-- "reenviar" auditado; e o despachante ganha uma reserva, para que duas
-- corridas não mandem a mesma mensagem (com a Meta, duplicata custa dinheiro
-- e rebaixa a nota do número).
--
-- O que esta migration faz, na ordem do arquivo:
--   1. Colunas novas no outbox: provider, provider_message_id, delivered_at,
--      read_at (plano M3-1), claimed_at (reserva, ajuste 10 da issue),
--      attempt_id/attempt_started_at (a tentativa de envio aberta antes do
--      POST, gate Sol da PR #102) e resent_as (de qual linha nova esta é a
--      origem, quando reenviada).
--      Índice ÚNICO parcial por (provider, provider_message_id): um id do
--      provedor é UMA mensagem, e o recibo acha a linha por ele.
--   2. A reserva sai quando a linha fecha ou falha (gatilho): `outbox_mark_sent`
--      e o `fail` do despachante (UPDATE de `error`) soltam a linha — menos a
--      que tem tentativa em aberto (resultado incerto não vira retry).
--   3. `_outbox_apply_receipt`: o mapa status → linha, monotônico.
--      `sent` = nada · `delivered` = delivered_at se nulo · `read` = read_at e
--      delivered_at se nulos · `failed` = motivo em `error`, `sent_at` intacto
--      (a linha fica PRESA e reenviável; ajuste 8 do ADR-038). Horário sempre
--      `now()` do banco, nunca o do envelope (Lei 1): a Meta reentrega recibo
--      horas depois, e o `timestamp` do envelope fica no objeto guardado na
--      inbox, para auditoria.
--   4. `_outbox_apply_pending_receipts`: recibo que chegou ANTES do id
--      (inbox `meta`, chave `<wamid>:<status>`, processed_at nulo) é aplicado
--      quando o id entra, na MESMA transação, e marcado processado.
--   5. RPCs do servidor (só service_role): `apply_delivery_receipt` (o
--      webhook, #44, chama com o status já normalizado), `outbox_mark_sent`
--      (o despachante, #43, fecha o envio), `outbox_claim_pending` (o
--      despachante reserva antes de enviar), `outbox_begin_attempt` e
--      `outbox_fail_attempt` (a tentativa: aberta antes do POST, fechada pela
--      falha definitiva; a falha incerta deixa a linha presa, sem retry) e
--      `outbox_reapply_pending_receipts` (rede do pg_cron, a cada 5 min).
--      Corrida webhook × despachante: em READ COMMITTED nenhum vê a escrita
--      não confirmada do outro. `apply_delivery_receipt` e `outbox_mark_sent`
--      tomam `pg_advisory_xact_lock(hashtext(<id da mensagem>))` ANTES de ler:
--      quem chega depois espera o outro confirmar e lê o estado novo. O job do
--      cron é a rede para o recibo gravado na inbox depois que o webhook já
--      leu "sem linha".
--   6. `admin_resend_outbox` (admin): clona a linha com chave de dedupe nova,
--      fecha a de origem (resent_as) e registra em audit_log (Lei 8). Recusa
--      linha aguardando envio e linha reservada pelo despachante.
--      `admin_resolve_outbox` (base f6) passa a respeitar a reserva e a
--      resolver também a presa que falhou depois do envio.
--   7. View `outbox_admin` (invoker): a situação calculada no banco, régua
--      única da tela Mensagens e do badge (M3-3b). Vocabulário = o da tela de
--      hoje (`SituacaoDaMensagem`) mais 'entregue'.
--   8. `enqueue_reschedule_confirmation` grava quem moveu (`moved_by`), dívida
--      do M2. Base: a definição VIGENTE, da 118 (20260901000100).
--   9. Avisos internos à admin (`content-review`, `content-digest`) saem só
--      por e-mail (decisão do ADR-038 de 27/10/2026: não há template na Meta
--      para conteúdo variável). Base: 20260804000100 (104). As linhas desses
--      dois que ainda aguardam envio pelo WhatsApp, sem erro, viram e-mail.
--  10. Expurgo LGPD cobre a origem `meta`: `purge_evolution_inbox` (base f6,
--      20260718000800) e `admin_purge_evolution_by_phone` (base f7,
--      20260718000900). Mesmos nomes: o job do cron não muda.
--
-- ACL: toda função NOVA revoga EXECUTE nominalmente de public, anon e
-- authenticated (em produção o default privilege do `postgres` concede a anon
-- e authenticated; teste local de ACL é FALSO-VERDE — CLAUDE.md "Armadilhas").
-- As portas do servidor também recusam no CORPO quem não é service_role.
-- `create or replace` preserva a ACL antiga; as recriadas reemitem a delas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table public.notification_outbox
  add column provider text,
  add column provider_message_id text,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column claimed_at timestamptz,
  add column attempt_id uuid,
  add column attempt_started_at timestamptz,
  -- `on delete set null`: a cópia pendente pode ser apagada por quem já apaga
  -- aviso que ficou falso (update_my_whatsapp, 20260730000400) — a de origem
  -- não pode travar esse delete (revisor da PR #102, R1).
  add column resent_as uuid references public.notification_outbox (id) on delete set null,
  add constraint notification_outbox_tentativa_inteira
    check ((attempt_id is null) = (attempt_started_at is null)),
  add constraint notification_outbox_provider_conhecido
    check (provider is null or provider in ('meta', 'resend', 'evolution')),
  -- provedor e id andam juntos: um sem o outro é recibo que nunca casa
  add constraint notification_outbox_provider_com_id
    check ((provider is null) = (provider_message_id is null)),
  -- id do provedor só existe em linha enviada (quem grava é outbox_mark_sent)
  add constraint notification_outbox_id_so_enviada
    check (provider_message_id is null or sent_at is not null),
  -- lido implica entregue (o mapa do recibo garante; o CHECK prende)
  add constraint notification_outbox_lido_implica_entregue
    check (read_at is null or delivered_at is not null);

comment on column public.notification_outbox.provider is
  'Quem entregou (meta | resend | evolution). Gravado só por outbox_mark_sent (M3-1).';
comment on column public.notification_outbox.provider_message_id is
  'Id da mensagem no provedor (wamid da Meta). Chave do recibo; único por provedor.';
comment on column public.notification_outbox.delivered_at is
  'Entregue, pelo recibo do provedor. now() do banco ao aplicar (Lei 1), nunca o horário do envelope.';
comment on column public.notification_outbox.read_at is
  'Lida, pelo recibo do provedor. Lido implica entregue. now() do banco ao aplicar (Lei 1).';
comment on column public.notification_outbox.claimed_at is
  'Reserva do despachante (outbox_claim_pending). Vale 10 min; sai quando a linha fecha ou falha.';
comment on column public.notification_outbox.resent_as is
  'Linha nova criada por admin_resend_outbox a partir desta. Linha com resent_as não é mais "presa".';
comment on column public.notification_outbox.attempt_id is
  'Tentativa de envio em aberto (outbox_begin_attempt, gravada ANTES do POST ao provedor). '
  'O despachante manda este id junto da mensagem (na Meta, biz_opaque_callback_data), e o '
  'recibo que chega sem o wamid conhecido acha a linha por ele. Linha com tentativa em '
  'aberto nunca volta sozinha para a fila: resultado incerto é decisão da dona, não retry.';
comment on column public.notification_outbox.attempt_started_at is
  'Quando a tentativa em aberto começou. Sem resposta em 10 min, o job do cron marca a '
  'linha presa com "resultado incerto".';

create unique index notification_outbox_provider_msg_uniq
  on public.notification_outbox (provider, provider_message_id)
  where provider_message_id is not null;
create unique index notification_outbox_attempt_uniq
  on public.notification_outbox (attempt_id)
  where attempt_id is not null;

-- ---------------------------------------------------------------------------
-- 2. A reserva sai quando a linha fecha ou falha.
--
-- Dispara quando o UPDATE escreve `sent_at` ou `error` (mesmo com o valor
-- igual: a mesma falha repetida também solta a linha para a próxima corrida).
-- `outbox_claim_pending` escreve só `claimed_at` e não dispara.
-- EXCEÇÃO (gate Sol da PR #102, S1): linha com tentativa em aberto não solta.
-- Erro gravado depois de um POST que pode ter sido aceito (timeout, resposta
-- perdida) não é falha definitiva; soltar a reserva faria a próxima rodada
-- mandar a MESMA mensagem de novo. Só outbox_fail_attempt com p_definitivo
-- (que fecha a tentativa) ou o fechamento do envio soltam.
-- ---------------------------------------------------------------------------
create or replace function public._outbox_solta_reserva()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.attempt_id is null then
    new.claimed_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public._outbox_solta_reserva() from public, anon, authenticated, service_role;

create trigger notification_outbox_solta_reserva
  before update of sent_at, error on public.notification_outbox
  for each row execute function public._outbox_solta_reserva();

-- ---------------------------------------------------------------------------
-- 3. O mapa status → linha (interno; chamado só pelas RPCs abaixo, que já
--    seguram o advisory do id da mensagem).
-- ---------------------------------------------------------------------------
create or replace function public._outbox_apply_receipt(p_outbox_id uuid, p_status text, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivered timestamptz;
  v_copia uuid;
begin
  select delivered_at, resent_as into v_delivered, v_copia
    from notification_outbox
   where id = p_outbox_id
     for update;
  if not found then
    return 'sem_linha';
  end if;

  case p_status
    when 'sent' then
      -- é o "enviado" que o despachante já gravou em outbox_mark_sent
      return 'ignorado';
    -- Entregue é estado final, chegue na ordem que chegar: a falha que veio
    -- ANTES da entrega (recibos fora de ordem) sai da linha, e o par
    -- failed+delivered termina "entregue" nas duas ordens. Só sai a falha
    -- escrita por este mapa; a nota de uma resolução da dona fica (e a view
    -- mostra "entregue" mesmo assim: a entrega prevalece).
    when 'delivered', 'read' then
      update notification_outbox
         set delivered_at = coalesce(delivered_at, now()),
             read_at = case when p_status = 'read' then coalesce(read_at, now()) else read_at end,
             error = case when error like 'falhou depois do envio:%' then null else error end
       where id = p_outbox_id;

      -- Gate Sol da PR #102 (S2): a dona reenviou entre a falha e a entrega
      -- tardia. A original chegou; a cópia que ainda não saiu (sem tentativa
      -- aberta) é cancelada aqui, na mesma transação, e o despachante a recusa
      -- em outbox_begin_attempt. Cópia que já está saindo não tem como voltar.
      if v_copia is not null then
        update notification_outbox
           set sent_at = now(),
               error = 'cancelado sem envio: a mensagem original foi entregue depois do reenvio'
         where id = v_copia
           and sent_at is null
           and attempt_id is null;
        if found then
          perform public.log_audit(null, 'resend_cancelled_by_delivery', 'notification_outbox',
            v_copia::text, jsonb_build_object('original', p_outbox_id, 'status', p_status));
        end if;
      end if;
      return 'aplicado';
    when 'failed' then
      -- Entregue é estado final: falha que chega depois da entrega não desfaz
      -- (entregue nunca volta). O recibo fica na inbox para auditoria.
      if v_delivered is not null then
        return 'ignorado';
      end if;
      -- `sent_at` fica (auditoria: o envio aconteceu); o motivo vai em `error`
      -- e a linha passa a ser "presa" na outbox_admin. A primeira falha vence.
      update notification_outbox
         set error = coalesce(error, 'falhou depois do envio: '
                       || coalesce(nullif(btrim(p_motivo), ''), 'o provedor não informou o motivo'))
       where id = p_outbox_id;
      return 'aplicado';
    else
      raise exception 'status de recibo desconhecido: % (esperado sent, delivered, read ou failed)',
        coalesce(p_status, '<nulo>')
        using errcode = '22023';
  end case;
end;
$$;
revoke execute on function public._outbox_apply_receipt(uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Recibos da Meta que chegaram antes do id (interno).
--
-- Contrato da inbox `meta` (a #44 grava assim; ADR-038, decisão 5): uma linha
-- por recibo, `event_id = '<wamid>:<status>'` (o wamid não tem ':'; o status
-- é o da Meta: sent | delivered | read | failed), payload = o objeto
-- `statuses[i]` mais o `metadata` do número. O motivo da falha é o primeiro
-- item de `errors`, em qualquer nível do payload.
-- O vocabulário é fechado, então os recibos de um wamid são achados pelas
-- quatro chaves exatas, pelo índice UNIQUE(source, event_id). Linha com outro
-- status nunca casa e sai no expurgo de 90 dias.
-- Quem chama segura o advisory do wamid.
-- ---------------------------------------------------------------------------
create or replace function public._outbox_apply_pending_receipts(p_wamid text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox uuid;
  r record;
  v_status text;
  v_erro jsonb;
  v_motivo text;
  v_n int := 0;
begin
  select id into v_outbox
    from notification_outbox
   where provider = 'meta' and provider_message_id = p_wamid;
  if v_outbox is null then
    return 0;
  end if;

  for r in
    select w.id, w.event_id, w.payload
      from webhook_inbox w
     where w.source = 'meta'
       and w.event_id = any (array[
             p_wamid || ':sent', p_wamid || ':delivered', p_wamid || ':read', p_wamid || ':failed'])
       and w.processed_at is null
     order by w.id
       for update
  loop
    v_status := substring(r.event_id from ':([^:]*)$');
    v_motivo := null;
    if v_status = 'failed' then
      v_erro := jsonb_path_query_first(r.payload, 'lax $.**.errors[0]');
      if v_erro is not null and jsonb_typeof(v_erro) = 'object' then
        v_motivo := concat_ws(' ',
          coalesce(v_erro ->> 'title', v_erro ->> 'message'),
          case when v_erro ? 'code' then '(código ' || (v_erro ->> 'code') || ')' end);
      end if;
    end if;

    perform public._outbox_apply_receipt(v_outbox, v_status, v_motivo);
    update webhook_inbox
       set processed_at = now(), error = null
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public._outbox_apply_pending_receipts(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4b. Recibo que acha a linha pela TENTATIVA (interno; gate Sol da PR #102,
--     S1).
--
-- O POST foi aceito pela Meta mas a resposta (com o wamid) se perdeu: a linha
-- tem tentativa em aberto e nenhum wamid. O primeiro recibo traz o wamid e o
-- id da tentativa (o despachante o manda em `biz_opaque_callback_data`, que a
-- Meta devolve no recibo). Aqui a linha recebe o wamid, fica enviada e a
-- tentativa fecha — o mesmo que outbox_mark_sent teria feito. Devolve o id da
-- linha, ou nulo quando nenhuma tentativa em aberto tem esse id.
-- Quem chama segura o advisory do wamid.
-- ---------------------------------------------------------------------------
create or replace function public._outbox_correlate_attempt(p_attempt_id uuid, p_provider text, p_wamid text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_attempt_id is null then
    return null;
  end if;
  select id into v_id
    from notification_outbox
   where attempt_id = p_attempt_id
     and provider_message_id is null
     for update;
  if v_id is null then
    return null;
  end if;
  update notification_outbox
     set provider = p_provider,
         provider_message_id = p_wamid,
         sent_at = coalesce(sent_at, now()),
         attempt_id = null,
         attempt_started_at = null,
         error = case when error like 'resultado incerto:%' then null else error end
   where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public._outbox_correlate_attempt(uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5a. apply_delivery_receipt — o webhook aplica um recibo.
--
-- Devolve 'aplicado' | 'ignorado' | 'sem_linha'. 'sem_linha' = o id ainda não
-- está no outbox: o webhook deixa a linha da inbox com processed_at nulo, e
-- outbox_mark_sent (ou o job do cron) aplica depois. Idempotente: o mesmo
-- recibo duas vezes não muda nada (coalesce em cada coluna).
-- `p_attempt_id` (opcional): o id da tentativa que veio no recibo
-- (`biz_opaque_callback_data`). Sem linha pelo wamid, a linha da tentativa em
-- aberto é achada por ele (4b).
-- ---------------------------------------------------------------------------
create or replace function public.apply_delivery_receipt(
  p_provider text,
  p_provider_message_id text,
  p_status text,
  p_error text default null,
  p_attempt_id uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox uuid;
  v_resultado text;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'apply_delivery_receipt é porta do servidor: só o service_role aplica recibo'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_provider), '') = '' or coalesce(btrim(p_provider_message_id), '') = '' then
    raise exception 'recibo sem provedor ou sem id da mensagem' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'status de recibo desconhecido: % (esperado sent, delivered, read ou failed)',
      coalesce(p_status, '<nulo>')
      using errcode = '22023';
  end if;

  -- ANTES de ler: serializa com outbox_mark_sent do mesmo id
  perform pg_advisory_xact_lock(hashtext(p_provider_message_id));

  select id into v_outbox
    from notification_outbox
   where provider = p_provider and provider_message_id = p_provider_message_id;
  if v_outbox is null then
    v_outbox := public._outbox_correlate_attempt(p_attempt_id, p_provider, p_provider_message_id);
    if v_outbox is null then
      return 'sem_linha';
    end if;
  end if;
  v_resultado := public._outbox_apply_receipt(v_outbox, p_status, p_error);
  if p_provider = 'meta' then
    -- outros recibos do mesmo wamid que chegaram antes e ficaram pendentes
    perform public._outbox_apply_pending_receipts(p_provider_message_id);
  end if;
  return v_resultado;
end;
$$;
revoke execute on function public.apply_delivery_receipt(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_delivery_receipt(text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5b. outbox_mark_sent — o despachante fecha o envio.
--
-- Grava sent_at, provider e provider_message_id, limpa error, a reserva e a
-- tentativa e, na MESMA transação, aplica os recibos `meta` pendentes daquele
-- id (devolve quantos). Repetir com o mesmo id é idempotente (inclusive
-- depois de um recibo ter fechado a linha pela tentativa, 4b); linha já
-- fechada com outro id (ou resolvida) recusa.
-- ---------------------------------------------------------------------------
create or replace function public.outbox_mark_sent(
  p_outbox_id uuid,
  p_provider text,
  p_provider_message_id text
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'outbox_mark_sent é porta do servidor: só o service_role fecha o envio'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_provider), '') = '' or coalesce(btrim(p_provider_message_id), '') = '' then
    raise exception 'envio sem provedor ou sem id da mensagem' using errcode = '22023';
  end if;
  if p_provider not in ('meta', 'resend', 'evolution') then
    raise exception 'provedor desconhecido: % (esperado meta, resend ou evolution)', p_provider
      using errcode = '22023';
  end if;

  -- ANTES de ler: serializa com apply_delivery_receipt do mesmo id
  perform pg_advisory_xact_lock(hashtext(p_provider_message_id));

  select id, sent_at, provider, provider_message_id into v_row
    from notification_outbox
   where id = p_outbox_id
     for update;
  if not found then
    raise exception 'aviso % não existe', p_outbox_id;
  end if;

  if v_row.provider = p_provider and v_row.provider_message_id = p_provider_message_id then
    -- repetição do mesmo fechamento (retry do despachante, ou o recibo chegou
    -- antes e fechou pela tentativa): nada a regravar
    if p_provider = 'meta' then
      return public._outbox_apply_pending_receipts(p_provider_message_id);
    end if;
    return 0;
  end if;
  if v_row.sent_at is not null then
    raise exception 'aviso % já está fechado (enviado ou resolvido): o id do provedor não é regravado', p_outbox_id;
  end if;

  update notification_outbox
     set sent_at = now(),
         error = null,
         claimed_at = null,
         attempt_id = null,
         attempt_started_at = null,
         provider = p_provider,
         provider_message_id = p_provider_message_id
   where id = p_outbox_id;

  if p_provider = 'meta' then
    return public._outbox_apply_pending_receipts(p_provider_message_id);
  end if;
  return 0;
end;
$$;
revoke execute on function public.outbox_mark_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.outbox_mark_sent(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5c. outbox_claim_pending — o despachante reserva antes de enviar.
--
-- Linhas pendentes (`sent_at` nulo, já agendadas, sem tentativa em aberto),
-- mais velhas primeiro, `for update skip locked`: duas corridas ao mesmo tempo
-- recebem conjuntos disjuntos. Linha reservada há menos de 10 min não volta
-- para ninguém; a reserva sai com outbox_mark_sent ou com a falha (gatilho do
-- item 2). Linha com tentativa em aberto (resultado incerto) não volta NUNCA
-- sozinha (S1 do gate Sol): sai pelo recibo, pela falha definitiva ou pela
-- mão da dona.
-- `p_key_like` recorta por prefixo de dedupe_key — o mesmo `keyLike` que o
-- despachante já usa nos testes (arquivos paralelos não disputam linhas);
-- em produção fica nulo (fila inteira).
-- ---------------------------------------------------------------------------
create or replace function public.outbox_claim_pending(p_limit int, p_key_like text default null)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'outbox_claim_pending é porta do servidor: só o service_role reserva'
      using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limite da reserva fora de 1–500: %', coalesce(p_limit::text, '<nulo>')
      using errcode = '22023';
  end if;

  return query
  with alvo as (
    select o.id
      from notification_outbox o
     where o.sent_at is null
       and o.attempt_id is null
       and o.scheduled_for <= now()
       and (o.claimed_at is null or o.claimed_at <= now() - interval '10 minutes')
       and (p_key_like is null or o.dedupe_key like p_key_like)
     order by o.created_at, o.id
     limit p_limit
       for update skip locked
  )
  update notification_outbox o
     set claimed_at = now()
    from alvo
   where o.id = alvo.id
  returning o.*;
end;
$$;
revoke execute on function public.outbox_claim_pending(int, text) from public, anon, authenticated;
grant execute on function public.outbox_claim_pending(int, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5e. outbox_begin_attempt — o despachante abre a tentativa ANTES do POST.
--
-- É o portão do envio: linha fechada (enviada, resolvida, cancelada pela
-- entrega da original) ou com tentativa já aberta recusa, e o despachante não
-- manda. Devolve o id da tentativa, que vai junto da mensagem
-- (`biz_opaque_callback_data`) para o recibo achar a linha sem o wamid.
-- ---------------------------------------------------------------------------
create or replace function public.outbox_begin_attempt(p_outbox_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_tentativa uuid := gen_random_uuid();
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'outbox_begin_attempt é porta do servidor: só o service_role abre tentativa'
      using errcode = '42501';
  end if;
  select id, sent_at, attempt_id into v_row
    from notification_outbox
   where id = p_outbox_id
     for update;
  if not found then
    raise exception 'aviso % não existe', p_outbox_id;
  end if;
  if v_row.sent_at is not null then
    raise exception 'aviso % já está fechado: não enviar', p_outbox_id;
  end if;
  if v_row.attempt_id is not null then
    raise exception 'aviso % já tem tentativa em aberto: não enviar de novo', p_outbox_id;
  end if;
  update notification_outbox
     set attempt_id = v_tentativa,
         attempt_started_at = now(),
         claimed_at = coalesce(claimed_at, now())
   where id = p_outbox_id;
  return v_tentativa;
end;
$$;
revoke execute on function public.outbox_begin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.outbox_begin_attempt(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5f. outbox_fail_attempt — o despachante registra a falha da tentativa.
--
-- `p_definitivo = true`: o provedor recusou (a mensagem certamente não saiu);
-- a tentativa fecha, o motivo vai em `error` e a reserva sai (retry na próxima
-- rodada). `p_definitivo = false`: resultado incerto (timeout, resposta
-- perdida, 5xx depois do envio); a tentativa FICA aberta, a linha fica presa
-- com "resultado incerto" e não volta sozinha para a fila. Linha já fechada
-- (o recibo chegou antes e fechou pela tentativa) não muda.
-- ---------------------------------------------------------------------------
create or replace function public.outbox_fail_attempt(p_outbox_id uuid, p_error text, p_definitivo boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_motivo text;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'outbox_fail_attempt é porta do servidor: só o service_role registra falha'
      using errcode = '42501';
  end if;
  v_motivo := nullif(btrim(coalesce(p_error, '')), '');
  if v_motivo is null or p_definitivo is null then
    raise exception 'falha de envio exige motivo e se é definitiva' using errcode = '22023';
  end if;
  select id, sent_at into v_row
    from notification_outbox
   where id = p_outbox_id
     for update;
  if not found then
    raise exception 'aviso % não existe', p_outbox_id;
  end if;
  if v_row.sent_at is not null then
    return;
  end if;
  if p_definitivo then
    update notification_outbox
       set attempt_id = null,
           attempt_started_at = null,
           error = v_motivo
     where id = p_outbox_id;
  else
    update notification_outbox
       set error = 'resultado incerto: ' || v_motivo
                   || ' (a mensagem pode ter saído; confira antes de reenviar)'
     where id = p_outbox_id;
  end if;
end;
$$;
revoke execute on function public.outbox_fail_attempt(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.outbox_fail_attempt(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5d. outbox_reapply_pending_receipts — a rede do pg_cron.
--
-- Três redes, a cada 5 min:
--   (a) recibos `meta` pendentes cujo wamid já está no outbox (o recibo
--       gravado na inbox depois que o webhook leu "sem linha");
--   (b) recibos `meta` pendentes que trazem o id de uma tentativa em aberto
--       (`biz_opaque_callback_data`) e cujo wamid o outbox não conhece: a
--       linha recebe o wamid pela tentativa (4b);
--   (c) tentativa em aberto há mais de 10 min sem resposta nenhuma: a linha
--       fica presa com "resultado incerto" (não volta para a fila).
-- Um advisory por wamid, em ordem: a mesma chave de apply_delivery_receipt e
-- outbox_mark_sent. O cron roda sem JWT; quem chama por fora precisa ser
-- service_role.
-- ---------------------------------------------------------------------------
create or replace function public.outbox_reapply_pending_receipts()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n int := 0;
begin
  if (auth.jwt() ->> 'role') is not null and (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'outbox_reapply_pending_receipts é porta do servidor (cron ou service_role)'
      using errcode = '42501';
  end if;

  -- (b) primeiro: depois dele, (a) aplica os recibos do wamid que entrou
  for r in
    select distinct regexp_replace(w.event_id, ':[^:]*$', '') as wamid,
           o.attempt_id
      from webhook_inbox w
      join notification_outbox o
        on o.attempt_id::text = jsonb_path_query_first(w.payload, 'lax $.**.biz_opaque_callback_data') #>> '{}'
     where w.source = 'meta'
       and w.processed_at is null
       and substring(w.event_id from ':([^:]*)$') in ('sent', 'delivered', 'read', 'failed')
       and o.provider_message_id is null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(r.wamid));
    perform public._outbox_correlate_attempt(r.attempt_id, 'meta', r.wamid);
  end loop;

  -- (a)
  for r in
    select distinct regexp_replace(w.event_id, ':[^:]*$', '') as wamid
      from webhook_inbox w
     where w.source = 'meta'
       and w.processed_at is null
       and substring(w.event_id from ':([^:]*)$') in ('sent', 'delivered', 'read', 'failed')
       and exists (
         select 1
           from notification_outbox o
          where o.provider = 'meta'
            and o.provider_message_id = regexp_replace(w.event_id, ':[^:]*$', '')
       )
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(r.wamid));
    v_n := v_n + public._outbox_apply_pending_receipts(r.wamid);
  end loop;

  -- (c)
  update notification_outbox
     set error = 'resultado incerto: a tentativa de envio não teve resposta em 10 min'
                 || ' (a mensagem pode ter saído; confira antes de reenviar)'
   where attempt_id is not null
     and sent_at is null
     and error is null
     and attempt_started_at < now() - interval '10 minutes';

  return v_n;
end;
$$;
revoke execute on function public.outbox_reapply_pending_receipts() from public, anon, authenticated;
grant execute on function public.outbox_reapply_pending_receipts() to service_role;

select cron.schedule(
  'outbox-reapply-meta-receipts',
  '*/5 * * * *',
  $$select public.outbox_reapply_pending_receipts()$$
);

-- ---------------------------------------------------------------------------
-- 7. outbox_admin — a situação calculada no banco (régua única).
--
--   pendente  · sent_at nulo, sem erro (aguardando envio)
--   preso     · sent_at nulo com erro, OU falhou depois do envio (a falha que
--               o mapa do recibo escreve, "falhou depois do envio: …") e a
--               dona ainda não reenviou nem resolveu
--   resolvido · fechada com motivo sem ter sido entregue: resolvida sem envio
--               (ou sem reenviar), obsoleta, ou presa que a dona já reenviou
--   entregue  · enviada e com recibo de entrega (lida também é entregue);
--               prevalece sobre falha e sobre resolução anteriores
--   enviado   · enviada, sem recibo de entrega ainda
-- Para as linhas sem provedor (o que existe hoje), é a régua de
-- `situacaoDaLinha` da tela Mensagens, sem mudança.
-- (Vem antes do reenviar porque admin_resend_outbox lê a situação daqui.)
-- ---------------------------------------------------------------------------
create or replace view public.outbox_admin
with (security_invoker = true) as
select
  o.id,
  o.channel,
  o.template,
  o.recipient_profile_id,
  o.payload,
  o.dedupe_key,
  o.scheduled_for,
  o.sent_at,
  o.error,
  o.created_at,
  o.provider,
  o.provider_message_id,
  o.delivered_at,
  o.read_at,
  o.claimed_at,
  o.resent_as,
  o.attempt_id,
  o.attempt_started_at,
  case
    when o.sent_at is null then
      case when o.error is null then 'pendente' else 'preso' end
    -- a entrega prevalece sobre qualquer nota (gate Sol da PR #102, S3): a
    -- falha que veio fora de ordem ou a resolução da dona antes da entrega
    -- tardia não escondem que a mensagem chegou
    when o.delivered_at is not null then 'entregue'
    when o.provider_message_id is not null
         and o.error like 'falhou depois do envio:%'
         and o.resent_as is null then 'preso'
    when o.error is not null then 'resolvido'
    else 'enviado'
  end as situacao
from public.notification_outbox o;

comment on view public.outbox_admin is
  'Outbox com a situação calculada no banco (pendente | preso | enviado | entregue | '
  'resolvido): régua única da tela Mensagens e do badge (M3-1). security_invoker: '
  'quem protege é a RLS de notification_outbox (leitura só da admin).';

-- Revoke nominal de todos (em produção o default privilege do owner dá ALL a
-- authenticated e service_role em objeto novo; view de uma tabela só é
-- atualizável) e só SELECT de volta, para quem lê a tela.
revoke all on public.outbox_admin from public, anon, authenticated, service_role;
grant select on public.outbox_admin to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_resend_outbox — a dona reenvia.
--
-- Vale para linha presa, enviada, entregue ou resolvida; nunca para a que
-- ainda está aguardando envio (o despachante vai mandá-la). A linha nova
-- nasce pendente, com o mesmo canal (salvo os avisos internos à admin, que
-- saem só por e-mail desde esta migration: a cópia nasce no e-mail, senão
-- seria presa de novo — revisor da PR #102, R2), template, destinatário e
-- payload, e chave de dedupe nova. A de origem fecha: ganha resent_as e, se
-- ainda não tinha sent_at (presa antes de enviar), recebe sent_at — senão o
-- despachante mandaria as duas. Reenviar a mesma linha duas vezes recusa:
-- reenvia-se a linha nova. Se a original for entregue depois (recibo tardio),
-- a cópia que ainda não saiu é cancelada pelo mapa do recibo (item 3).
-- ---------------------------------------------------------------------------
create or replace function public.admin_resend_outbox(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row notification_outbox%rowtype;
  v_situacao text;
  v_nova uuid := gen_random_uuid();
  v_chave text;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'reenviar aviso é restrito à admin (D10)' using errcode = '42501';
  end if;

  select * into v_row from notification_outbox where id = p_id for update;
  if not found then
    raise exception 'aviso % não existe', p_id;
  end if;
  if v_row.sent_at is null and v_row.error is null then
    raise exception 'reenviar recusado: o aviso % ainda está aguardando envio', p_id;
  end if;
  -- Presa que o despachante reservou para nova tentativa: o envio pode estar
  -- em voo, e a cópia sairia junto (a mensagem duas vezes).
  if v_row.sent_at is null and v_row.claimed_at > now() - interval '10 minutes' then
    raise exception 'reenviar recusado: o aviso % está sendo enviado agora; tente de novo em alguns minutos', p_id;
  end if;
  if v_row.resent_as is not null then
    raise exception 'reenviar recusado: o aviso % já foi reenviado (linha nova %); reenvie a linha nova',
      p_id, v_row.resent_as;
  end if;

  select situacao into v_situacao from public.outbox_admin where id = p_id;
  v_chave := format('%s:reenvio:%s', v_row.dedupe_key, v_nova);

  insert into notification_outbox (id, channel, template, recipient_profile_id, payload, dedupe_key, scheduled_for)
  values (v_nova,
          case when v_row.template in ('content-review', 'content-digest') then 'email' else v_row.channel end,
          v_row.template, v_row.recipient_profile_id, v_row.payload, v_chave, now());

  update notification_outbox
     set resent_as = v_nova,
         sent_at = coalesce(sent_at, now())
   where id = p_id;

  perform public.log_audit(auth.uid(), 'resend_outbox', 'notification_outbox', p_id::text,
    jsonb_build_object(
      'nova_linha', v_nova,
      'template', v_row.template,
      'channel', v_row.channel,
      'dedupe_key', v_row.dedupe_key,
      'nova_dedupe_key', v_chave,
      'situacao_anterior', v_situacao,
      'error', v_row.error));
  return v_nova;
end;
$$;
revoke execute on function public.admin_resend_outbox(uuid) from public, anon, authenticated;
grant execute on function public.admin_resend_outbox(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. admin_resolve_outbox — "resolver sem enviar" conhece a reserva e a
--     presa nova.
--
-- Base: f6 (20260718000800). Duas mudanças, as duas consequência da reserva
-- e do `failed` depois do envio desta migration:
--   · linha reservada pelo despachante há menos de 10 min recusa (o envio pode
--     estar em voo; fechar agora faria outbox_mark_sent recusar o id de uma
--     mensagem que saiu);
--   · a presa que falhou depois do envio também se resolve sem reenviar:
--     sent_at fica (o envio aconteceu), e o motivo da falha fica junto da nota.
--     Sem isso, a única saída dela do "Presos" seria reenviar o que a dona não
--     quer mandar.
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_outbox(
  p_id uuid,
  p_note text default null,  -- default só p/ resolução do PostgREST; a função RECUSA vazio
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row notification_outbox%rowtype;
  v_falhou_depois boolean;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_resolve_outbox é restrita à admin (D10)';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'resolver sem enviar exige motivo (M8-5)';
  end if;
  select * into v_row from notification_outbox where id = p_id for update;
  if not found then
    raise exception 'aviso % não existe', p_id;
  end if;
  -- coalesce: `error like` com error nulo é nulo, e "not nulo" deixaria passar
  -- uma linha enviada (o teste da M3-1 prende)
  v_falhou_depois := coalesce(
    v_row.sent_at is not null
      and v_row.provider_message_id is not null
      and v_row.error like 'falhou depois do envio:%'
      and v_row.resent_as is null,
    false);
  if v_row.sent_at is not null and not v_falhou_depois then
    raise exception 'aviso % já está resolvido/enviado', p_id;
  end if;
  if v_row.sent_at is null
     and (v_row.claimed_at > now() - interval '10 minutes'
          or (v_row.attempt_id is not null and v_row.error is null)) then
    raise exception 'aviso % está sendo enviado agora; tente de novo em alguns minutos', p_id;
  end if;

  if v_falhou_depois then
    update notification_outbox
       set error = 'resolvido sem reenviar: ' || p_note || ' · ' || v_row.error
     where id = p_id;
  else
    update notification_outbox
       set sent_at = now(), error = 'resolvido sem envio: ' || p_note
     where id = p_id;
  end if;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'resolve_outbox',
    'notification_outbox', p_id::text,
    jsonb_build_object('template', v_row.template, 'channel', v_row.channel,
                       'dedupe_key', v_row.dedupe_key, 'note', p_note,
                       'error_anterior', v_row.error));
end;
$$;
revoke execute on function public.admin_resolve_outbox(uuid, text, uuid) from public, anon;
grant execute on function public.admin_resolve_outbox(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. enqueue_reschedule_confirmation — grava quem moveu (`moved_by`).
--
-- Base: a definição VIGENTE, da 118 (20260901000100), byte a byte, com uma
-- variável e uma chave a mais no payload. 'teacher' quando a professora
-- remarcou (teacher_reschedule_own_class), 'admin' quando a administração (ou
-- o servidor em nome dela) moveu, 'student' quando o aluno remarcou pelo
-- portal. O despachante (#43) escolhe o texto "a escola moveu" por ele.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_reschedule_confirmation(p_instance uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract uuid;
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
  v_moved_by text;
begin
  select ci.contract_id into v_contract
  from class_instances ci where ci.id = p_instance;
  if v_contract is null then
    raise exception 'instância % não existe', p_instance;
  end if;

  if not ((auth.jwt() ->> 'role') = 'service_role'
          or public.app_role() = 'admin'
          or v_contract in (select public.my_contract_ids())
          -- M2 (01/09/2026): a PROFESSORA da aula também enfileira — é a RPC
          -- teacher_reschedule_own_class que chama, depois de conferir a posse.
          -- Gate Sol (26/10): só com papel de professora e só para aula que É
          -- uma remarcação — numa aula comum o WhatsApp diria "reposição
          -- agendada" sem nada ter mudado.
          or (coalesce(public.app_role(), '') in ('teacher', 'admin')
              and exists (select 1 from class_instances ci2
                           where ci2.id = p_instance
                             and ci2.reschedule_of is not null
                             and ci2.state = 'scheduled'
                             and ci2.starts_at_utc > now()
                             and ci2.teacher_id = public.my_teacher_id()))) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  -- M3-1 (#42): quem moveu. O papel vem do JWT (app_metadata, Lei 4).
  v_moved_by := case
    when public.app_role() = 'teacher' then 'teacher'
    when public.app_role() = 'admin' or (auth.jwt() ->> 'role') = 'service_role' then 'admin'
    else 'student'
  end;

  for v_row in
    select ci.id as instance_id,
           ci.starts_at_utc,
           ci.local_time_snapshot,
           s.id as student_id,
           s.profile_id,
           s.iana_tz,
           t.display_name as teacher_name
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    join teachers t on t.id = ci.teacher_id
    join lateral (
      select st.id, st.profile_id, st.iana_tz
      from students st
      where st.id = c.student_id
      union
      select st.id, st.profile_id, st.iana_tz
      from student_group_members m
      join students st on st.id = m.student_id
      where m.group_id = c.student_group_id
    ) s on true
    where ci.id = p_instance
      and c.status = 'active'
  loop
    -- Só WhatsApp: o e-mail 3 (aprovado) sai pela action do portal.
    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'reschedule-confirm', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id,
          'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz,
          'teacher_name', v_row.teacher_name,
          'moved_by', v_moved_by
        ),
        format('reschedule-confirm:%s:%s:wa', v_row.instance_id, v_row.student_id)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$function$
;
revoke execute on function public.enqueue_reschedule_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_reschedule_confirmation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9a. notify_content_review — o aviso do portão 2 sai só por e-mail.
--
-- Base: 20260804000100 (104). Única mudança: o canal. Era "WhatsApp se o
-- perfil admin tem número"; não há template na Meta para este conteúdo
-- (ADR-038, decisão de 27/10/2026), e a linha de WhatsApp ficaria presa.
-- ---------------------------------------------------------------------------
create or replace function public.notify_content_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin record;
begin
  -- Só o portão 2. A etapa 'ideias' morreu com o Portão 1 (Leva 6.2): o post do
  -- radar nasce e morre `ideia` no mesmo commit, e o roteiro avulso é ato da
  -- própria admin — avisá-la do que ela acabou de escrever é ruído.
  if not (tg_op = 'UPDATE' and new.status = 'rascunho' and old.status = 'gerando') then
    return new;
  end if;

  for v_admin in
    select p.id
    from profiles p
    where p.role = 'admin'
    -- Ordem FIXA (achado 17 do Sol): duas transações percorrendo os mesmos
    -- admins em ordens opostas podem se travar no conflito de chave. Custa
    -- nada e tira a possibilidade da mesa.
    order by p.id
  loop
    -- M3-1 (#42): aviso interno à admin sai só por e-mail (ADR-038).
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (
      'email',
      'content-review',
      v_admin.id,
      jsonb_build_object('stage', 'rascunhos'),
      format('content-review:%s:%s:%s', 'rascunhos', v_admin.id, public.business_today())
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

comment on function public.notify_content_review() is
  'Portão 2: rascunho pronto → 1 toque por admin por dia civil, só por e-mail '
  '(M3-1, ADR-038). A etapa `ideias` morreu na Leva 6.2 com o Portão 1 '
  '(ADR-036). O aviso do LOTE é o enqueue_content_digest.';

revoke execute on function public.notify_content_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9b. enqueue_content_digest — o digest do lote sai só por e-mail.
--
-- Base: 20260804000100 (104). Mudanças: o canal é sempre 'email'; a
-- correção de números de uma corrida repetida (linha ainda não enviada)
-- também acerta o canal de uma linha de WhatsApp da mesma rodada; e linha
-- reservada ou com tentativa em aberto não é reescrita.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_content_digest(p_semana text, p_limiar int)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_novas int;
  v_destaque int;
  v_rascunhos int;
  v_admin record;
  v_payload jsonb;
  v_linhas int := 0;
  v_mexeu int;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'digest do lote é porta do robô: só o service_role enfileira';
  end if;

  -- O mesmo formato do CHECK de `content_trends.semana` (migration 107). Rodada
  -- torta entraria como semana que não existe e o toque sairia sobre o vazio.
  if p_semana is null or p_semana !~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$' then
    raise exception 'rodada em formato inválido (esperado AAAA-Wss): %', coalesce(p_semana, '<null>');
  end if;
  if p_limiar is null or p_limiar < 0 or p_limiar > 100 then
    raise exception 'limiar do destaque fora de 0–100: %', coalesce(p_limiar::text, '<null>');
  end if;

  -- CARTÕES da rodada, decididos ou não: o lote é o que a VARREDURA trouxe, e a
  -- unidade é a DECISÃO — exatamente o que o deck do radar desenha
  -- (`montarDeck`, src/data/admin/radar-gramatica.ts).
  --
  -- Cartão = raiz OU variação ÓRFÃ (a mãe não está no deck, isto é, não é mais
  -- `nova`). Contar só `variacao_de is null` era o achado nº 2 do Sol: uma
  -- rodada que trouxesse SÓ órfãs — cartões clicáveis, com nota, esperando
  -- decisão — devolveria zero e não avisaria ninguém. Variação pendurada em mãe
  -- `nova` continua fora: descartar a mãe resolve as filhas pela cascata.
  -- Destaque = a nota que a tela mostra: a da dona vence a do robô.
  select count(*),
         count(*) filter (
           where coalesce(t.travel_score_ajustado, t.travel_score) >= p_limiar
         )
    into v_novas, v_destaque
    from public.content_trends t
   where t.semana = p_semana
     and (
       t.variacao_de is null
       or not exists (
         select 1
           from public.content_trends mae
          where mae.id = t.variacao_de
            and mae.status = 'nova'
       )
     );

  -- Varredura que não trouxe nada não bate na porta de ninguém. O worker
  -- imprime o motivo no relatório da corrida; toque vazio é ruído que ensina a
  -- dona a ignorar o aviso.
  if v_novas = 0 then
    return 0;
  end if;

  select count(*)
    into v_rascunhos
    from public.content_posts
   where status = 'rascunho';

  v_payload := jsonb_build_object(
    'semana', p_semana,
    'novas', v_novas,
    'destaque', v_destaque,
    'rascunhos', v_rascunhos
  );

  for v_admin in
    select p.id
    from public.profiles p
    where p.role = 'admin'
    order by p.id -- ordem fixa: sem ela, duas corridas podem se travar (achado 17)
  loop
    -- M3-1 (#42): aviso interno à admin sai só por e-mail (ADR-038).
    insert into public.notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (
      'email',
      'content-digest',
      v_admin.id,
      v_payload,
      format('content-digest:%s:%s', p_semana, v_admin.id)
    )
    -- Corrida repetida na mesma rodada corrige os números ENQUANTO o toque não
    -- saiu. Depois de enviado, a linha é histórico: reescrevê-la faria o
    -- registro afirmar um número que a dona nunca leu.
    -- Também não mexe na linha que o despachante reservou ou está enviando
    -- (gate Sol da PR #102, S4): o provedor receberia os números velhos e o
    -- histórico guardaria os novos.
    on conflict (dedupe_key) do update
      set payload = excluded.payload,
          channel = excluded.channel
      where public.notification_outbox.sent_at is null
        and public.notification_outbox.attempt_id is null
        and (public.notification_outbox.claimed_at is null
             or public.notification_outbox.claimed_at <= now() - interval '10 minutes');
    -- Conta a linha que REALMENTE mexeu: admin cujo toque da rodada já saiu não
    -- recebe nada, e devolver "2 toques" nesse caso faria o log do worker
    -- afirmar um envio que não existe.
    get diagnostics v_mexeu = row_count;
    v_linhas := v_linhas + v_mexeu;
  end loop;

  return v_linhas;
end;
$$;

comment on function public.enqueue_content_digest(text, int) is
  'Digest do LOTE (ADR-036): ao fim da varredura, 1 toque por admin por RODADA '
  '(semana ISO) com trends novas, em destaque (nota >= p_limiar, ajustada '
  'vencendo) e rascunhos parados no portão 2. Sai só por e-mail (M3-1, ADR-038). '
  'Conta na mesma fonte que a tela lê. Porta do robô: recusa quem não é '
  'service_role, além do grant nominal.';

revoke execute on function public.enqueue_content_digest(text, int) from public, anon, authenticated;
grant execute on function public.enqueue_content_digest(text, int) to service_role;

-- 9c. Os dois avisos que ainda AGUARDAM envio pelo WhatsApp passam ao e-mail
-- (mexe em dados). Só os que nunca foram tentados (sem erro): a dedupe do dia
-- / da rodada faria um aviso novo cair em `on conflict` e herdar o canal
-- velho. Os presos (com erro) ficam como estão: virar e-mail agora mandaria
-- de uma vez avisos velhos que a dona não pediu; ela os resolve pela tela.
update public.notification_outbox
   set channel = 'email'
 where template in ('content-review', 'content-digest')
   and channel = 'whatsapp'
   and sent_at is null
   and error is null;

-- ---------------------------------------------------------------------------
-- 10a. purge_evolution_inbox — a retenção de 90 dias cobre a origem `meta`.
--
-- Base: f6 (20260718000800). Evolution: mensagens velhas saem, como antes, e
-- agora também os recibos (`messages.update`) já PROCESSADOS — o plano M3-1
-- aprovado em 01/09/2026 ("expurgo da inbox inclui updates aplicados"): o
-- recibo guarda o `remoteJid` (telefone do aluno), e o fato que ele provava
-- passa a morar no outbox (delivered_at/read_at). Recibo da Evolution ainda
-- não processado fica, como na f6 (revisor da PR #102, R3). Meta: tudo que
-- passou dos 90 dias sai, recibo aplicado ou não — o recibo traz o telefone
-- do aluno em `recipient_id`, e o que nunca casou (envio que não é nosso)
-- some aqui.
-- ---------------------------------------------------------------------------
create or replace function public.purge_evolution_inbox(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  delete from webhook_inbox
  where source in ('evolution', 'meta')
    and received_at < now() - make_interval(days => p_days)
    and (
      source = 'meta'
      or coalesce(payload->>'event', '') <> 'messages.update'
      or processed_at is not null
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_evolution_inbox(int) from public, anon, authenticated;
grant execute on function public.purge_evolution_inbox(int) to service_role;

-- ---------------------------------------------------------------------------
-- 10b. admin_purge_evolution_by_phone — apagar aluno (D10) cobre a origem
--      `meta`.
--
-- Base: f7 (20260718000900). Evolution: a regra de antes (o número aparece em
-- `remoteJid`/`from`, dentro do texto do payload). Meta: `recipient_id` (o
-- recibo), `from` ou `wa_id` (mensagem recebida e contato, se a #44 vier a
-- guardá-los), só dígitos, em qualquer nível do payload, igual ao telefone
-- dado — casamento exato, nunca "contém", para não apagar recibo de outro
-- aluno. Celular do
-- Brasil casa também sem o 9 da frente do assinante: o id do WhatsApp de
-- número antigo do Brasil vem nessa forma, e é a mesma linha.
-- ---------------------------------------------------------------------------
create or replace function public.admin_purge_evolution_by_phone(p_phone text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digits text;
  v_formas text[];
  v_count int;
begin
  if not ((auth.jwt() ->> 'role') = 'service_role' or public.app_role() = 'admin') then
    raise exception 'admin_purge_evolution_by_phone é restrita a admin/service (D10)';
  end if;
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) < 8 then
    raise exception 'telefone inválido para expurgo';
  end if;
  v_formas := array[v_digits];
  if v_digits ~ '^55[0-9]{2}9[0-9]{8}$' then
    v_formas := v_formas || (substr(v_digits, 1, 4) || substr(v_digits, 6));
  end if;

  delete from webhook_inbox w
  where (w.source = 'evolution' and w.payload::text like '%' || v_digits || '%')
     or (w.source = 'meta'
         and exists (
           select 1
             from jsonb_path_query(w.payload, 'lax $.**.recipient_id') as r (v)
            where r.v #>> '{}' = any (v_formas)
           union all
           select 1
             from jsonb_path_query(w.payload, 'lax $.**.from') as r (v)
            where r.v #>> '{}' = any (v_formas)
           union all
           select 1
             from jsonb_path_query(w.payload, 'lax $.**.wa_id') as r (v)
            where r.v #>> '{}' = any (v_formas)
         ));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.admin_purge_evolution_by_phone(text) from public, anon;
grant execute on function public.admin_purge_evolution_by_phone(text) to authenticated, service_role;
