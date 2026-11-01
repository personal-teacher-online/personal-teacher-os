-- Issue #127 — ALUNO QUE ESCREVE "PARAR" NO WHATSAPP GERA E-MAIL INTERNO À
-- ADMIN.
--
-- REGRA (ADR-038, item 4, decisão do dono de 31/10/2026): o aluno não tem
-- opção de parar (o WhatsApp é canal de contrato, M4-3), mas um "PARAR" não é
-- ignorado: a admin recebe um e-mail interno e age no mesmo dia útil, pela
-- ficha. NADA muda no perfil nem no aluno por causa da mensagem.
--
-- POR QUE UMA FUNÇÃO SQL (Lei 3): quem decide quem recebe é o banco, e o
-- servidor não tem INSERT em `notification_outbox` (20260713000200); só
-- funções do owner enfileiram (20260720000400, `notify_content_review`). O
-- webhook da Meta (src/lib/webhooks/meta.ts) só detecta a palavra de parada
-- (src/lib/notify/palavras-de-parada.ts) e chama esta função depois de gravar
-- a mensagem na inbox.
--
-- O QUE ELA FAZ:
--   · acha o aluno pelo número: o perfil cujo `whatsapp_e164`, só dígitos (é o
--     que o despachante manda à Meta, src/lib/notify/cloud-api.ts), é o número
--     de quem escreveu. Celular do Brasil casa também com e sem o 9 da frente
--     do assinante: o WhatsApp identifica número antigo do Brasil sem ele.
--     Só CELULAR (assinante de 8 dígitos começando com 6 a 9) ganha ou perde
--     o 9: fixo (2 a 5) nunca casa com o celular de outra pessoa, nem o
--     celular de alguém com o fixo de outra pessoa na ficha;
--   · número de NENHUM aluno avisa assim mesmo, e número em MAIS DE UMA ficha
--     também (com os nomes das fichas), sem escolher aluno por palpite: a
--     admin precisa saber do pedido. Número de nenhum aluno mas de alguém da
--     casa diz de quem é: professora (pelo perfil ligado a `teachers`, com o
--     nome) ou equipe (outro perfil não aluno, como admin); de ninguém,
--     "número não cadastrado";
--   · UM e-mail por admin (`profiles.role = 'admin'`), template
--     `student-stop-request`, SÓ e-mail (avisos internos saem por e-mail desde
--     27/10/2026, ADR-038), com `recipient_profile_id` preenchido: linha sem
--     destinatário seria resolvida tarde pelo despachante pelo `student_id` do
--     payload, e o e-mail interno iria ao próprio aluno;
--   · DEDUPE PELO WAMID (Lei 6): a Meta reentrega o mesmo POST; com o aviso
--     daquela mensagem já na fila (para qualquer admin), a chamada não faz
--     nada. O advisory lock do wamid serializa duas entregas simultâneas, e a
--     chave `student-stop-request:<wamid>:<admin>` segura o resto. Uma admin
--     criada entre a entrega e a reentrega não ganha aviso velho;
--   · `audit_log` (Lei 8) só quando enfileira: a reentrega não muda nada e
--     não deixa trilha. O texto e o número da mensagem não vão para a trilha
--     (a trilha não tem expurgo; o rastro durável do desfecho é a ação da
--     admin na ficha, ADR-038 item 4).
--
-- O TEXTO E O NÚMERO NA LINHA DO OUTBOX TÊM PRAZO (ADR-038, item 3: a mensagem
-- dura 90 dias). Esta migration redefine as duas portas de expurgo da inbox
-- (corpo de 20261030000100 verbatim, mais o trecho do outbox no fim):
--   · `purge_evolution_inbox` tira `texto` e `whatsapp_e164` do payload das
--     linhas `student-stop-request` JÁ ENVIADAS há mais de `p_days` dias;
--   · `admin_purge_evolution_by_phone` (apagar aluno, D10) tira os mesmos dois
--     campos das linhas daquele telefone (com e sem o 9), enviadas ou não.
-- Ambas devolvem a soma (linhas da inbox apagadas + linhas do outbox limpas).
-- O expurgo geral do outbox é a dívida maior da issue #138.
--
-- Devolve quantos avisos enfileirou (0 na reentrega). Sem wamid, sem número ou
-- sem admin recusa com exceção: o webhook anota o erro na linha da inbox, que
-- fica pendente, e responde 200 à Meta (que então não reenvia).
--
-- A REDE (como a dos recibos, `outbox_reapply_pending_receipts`): a cada 5 min
-- o pg_cron roda `meta_retry_pending_stop_requests`, que pega a mensagem da
-- Meta ainda pendente na inbox COM A MARCA `parada: true` que o webhook grava
-- no payload ao detectar a palavra (a detecção é dele; sem a marca, a rede não
-- avisa ninguém) e chama esta função de novo, pelo payload GRAVADO. Sucesso fecha a
-- linha; falha reescreve o erro e ela espera a próxima rodada. Sem isto, uma
-- falha passageira perderia o aviso: a Meta só reenvia o que não recebeu 200.

create or replace function public.enqueue_student_stop_request(
  p_wamid text,
  p_from text,
  p_texto text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wamid text := nullif(btrim(coalesce(p_wamid, '')), '');
  v_digitos text := regexp_replace(coalesce(p_from, ''), '[^0-9]', '', 'g');
  v_prefixo text;
  v_formas text[];
  v_alunos int;
  v_student uuid;
  v_nome text;
  v_nomes jsonb;
  v_equipe text;
  v_equipe_nome text;
  v_n int;
begin
  -- a porta é do servidor (o webhook, com service_role); a ACL já fecha, e
  -- isto segura uma chamada logada se a ACL um dia abrir
  if (auth.jwt() ->> 'role') is not null and (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'enqueue_student_stop_request é porta do servidor (service_role)'
      using errcode = '42501';
  end if;
  if v_wamid is null then
    raise exception 'aviso de parada sem o wamid da mensagem';
  end if;
  if v_digitos = '' then
    raise exception 'aviso de parada sem o número de quem mandou';
  end if;

  v_prefixo := 'student-stop-request:' || v_wamid || ':';
  perform pg_advisory_xact_lock(hashtext(v_prefixo));
  -- `left(...) =` e não `like`: o wamid pode trazer `_`, que no like é curinga
  if exists (
    select 1 from notification_outbox o
     where o.template = 'student-stop-request'
       and left(o.dedupe_key, length(v_prefixo)) = v_prefixo
  ) then
    return 0;
  end if;

  v_formas := array[v_digitos];
  if v_digitos ~ '^55[0-9]{2}9[6-9][0-9]{7}$' then
    v_formas := v_formas || (substr(v_digitos, 1, 4) || substr(v_digitos, 6));
  elsif v_digitos ~ '^55[0-9]{2}[6-9][0-9]{7}$' then
    v_formas := v_formas || (substr(v_digitos, 1, 4) || '9' || substr(v_digitos, 5));
  end if;

  select count(*)::int, (array_agg(s.id order by s.id))[1], (array_agg(s.display_name order by s.id))[1],
         coalesce(jsonb_agg(s.display_name order by s.display_name, s.id), '[]'::jsonb)
    into v_alunos, v_student, v_nome, v_nomes
    from students s
    join profiles p on p.id = s.profile_id
   where regexp_replace(coalesce(p.whatsapp_e164, ''), '[^0-9]', '', 'g') = any (v_formas);
  -- só a ficha única identifica o aluno; os nomes só servem a "mais de uma"
  if v_alunos <> 1 then
    v_student := null;
    v_nome := null;
  end if;
  if v_alunos < 2 then
    v_nomes := '[]'::jsonb;
  end if;

  -- de nenhum aluno: é de alguém da casa? Professora tem precedência (a dona
  -- pode ser admin e professora ao mesmo tempo).
  if v_alunos = 0 then
    select case when t.id is not null then 'professora' else 'equipe' end,
           case when t.id is not null then coalesce(t.display_name, p.full_name) end
      into v_equipe, v_equipe_nome
      from profiles p
      left join teachers t on t.profile_id = p.id
     where p.role <> 'student'
       and regexp_replace(coalesce(p.whatsapp_e164, ''), '[^0-9]', '', 'g') = any (v_formas)
     order by (t.id is null), p.id
     limit 1;
  end if;

  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select 'email', 'student-stop-request', a.id,
         jsonb_build_object(
           'student_id', v_student,
           'student_name', v_nome,
           'alunos_com_o_numero', v_alunos,
           'alunos_nomes', v_nomes,
           'equipe', v_equipe,
           'equipe_nome', v_equipe_nome,
           'whatsapp_e164', '+' || v_digitos,
           'texto', coalesce(p_texto, ''),
           'wamid', v_wamid),
         v_prefixo || a.id
    from profiles a
   where a.role = 'admin'
   -- perfil de admin sendo apagado agora fica de fora em vez de derrubar o
   -- insert pela chave estrangeira (e o apagado não volta a ser lido)
     for key share of a skip locked
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'nenhuma admin para avisar do pedido de parada';
  end if;

  perform public.log_audit(null, 'enqueue_student_stop_request', 'notification_outbox', v_wamid,
    jsonb_build_object('student_id', v_student, 'alunos_com_o_numero', v_alunos, 'avisos', v_n));
  return v_n;
end;
$$;

revoke execute on function public.enqueue_student_stop_request(text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_student_stop_request(text, text, text) to service_role;

comment on function public.enqueue_student_stop_request(text, text, text) is
  'Issue #127 (ADR-038, item 4): aluno mandou palavra de parada ao número de envio. '
  'Enfileira UM e-mail interno por admin (template student-stop-request), uma vez por '
  'wamid; acha o aluno pelo número (com e sem o 9 do celular do Brasil); número de '
  'ninguém ou de mais de uma ficha avisa sem aluno. Nada no perfil muda. Só service_role.';

-- ---------------------------------------------------------------------------
-- A rede: mensagem de parada pendente na inbox é avisada de novo (ver o
-- cabeçalho). Só a que chegou há mais de 1 minuto: a mais nova ainda está nas
-- mãos do webhook. Uma linha por vez, cada uma no seu bloco: a falha de uma não
-- impede as outras. O cron roda sem JWT; por fora, só service_role.
-- ---------------------------------------------------------------------------
create or replace function public.meta_retry_pending_stop_requests()
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
    raise exception 'meta_retry_pending_stop_requests é porta do servidor (cron ou service_role)'
      using errcode = '42501';
  end if;

  for r in
    select w.id,
           w.payload #>> '{message,id}' as wamid,
           w.payload #>> '{message,from}' as remetente,
           w.payload #>> '{message,text,body}' as texto
      from webhook_inbox w
     where w.source = 'meta'
       and w.processed_at is null
       and right(w.event_id, length(':message')) = ':message'
       -- só o que o webhook marcou como pedido de parada
       and w.payload ->> 'parada' = 'true'
       -- a que chegou agora é do webhook, que ainda está chamando a função
       and w.received_at < now() - interval '1 minute'
     order by w.id
       for update skip locked
  loop
    begin
      perform public.enqueue_student_stop_request(r.wamid, r.remetente, r.texto);
      update webhook_inbox set processed_at = now(), error = null where id = r.id;
      v_n := v_n + 1;
    exception when others then
      update webhook_inbox
         set error = 'aviso de parada não enfileirado: ' || sqlerrm
       where id = r.id;
    end;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.meta_retry_pending_stop_requests() from public, anon, authenticated, service_role;

comment on function public.meta_retry_pending_stop_requests() is
  'Issue #127: a rede do aviso de parada. Mensagem da Meta pendente na inbox com a marca '
  'parada=true (gravada pelo webhook) chama enqueue_student_stop_request de novo '
  'pelo payload gravado; sucesso fecha a linha, falha reescreve o erro. pg_cron, 5 min.';

select cron.schedule(
  'meta-retry-pending-stop-requests',
  '*/5 * * * *',
  $$select public.meta_retry_pending_stop_requests()$$
);

-- ---------------------------------------------------------------------------
-- O prazo do texto e do número do pedido de parada (ver o cabeçalho). As duas
-- funções abaixo são as de 20261030000100 com o corpo VERBATIM e o trecho do
-- outbox no fim; a assinatura é a mesma, e a ACL é reemitida igual.
-- ---------------------------------------------------------------------------
create or replace function public.purge_evolution_inbox(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_limpas int;
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

  -- #127: o texto e o número do pedido de parada têm o mesmo prazo da inbox
  -- (ADR-038, item 3). Só linha JÁ ENVIADA: a pendente ainda vai virar e-mail.
  update notification_outbox
     set payload = payload - 'texto' - 'whatsapp_e164'
   where template = 'student-stop-request'
     and sent_at is not null
     and sent_at < now() - make_interval(days => p_days)
     and (payload ? 'texto' or payload ? 'whatsapp_e164');
  get diagnostics v_limpas = row_count;
  return v_count + v_limpas;
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
  v_limpas int;
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

  -- #127: o pedido de parada daquele telefone perde o texto e o número na
  -- linha do outbox, enviada ou não (apagar o aluno vence o aviso pendente,
  -- que sai sem o número).
  update notification_outbox
     set payload = payload - 'texto' - 'whatsapp_e164'
   where template = 'student-stop-request'
     and regexp_replace(coalesce(payload ->> 'whatsapp_e164', ''), '[^0-9]', '', 'g') = any (v_formas);
  get diagnostics v_limpas = row_count;
  return v_count + v_limpas;
end;
$$;
revoke execute on function public.admin_purge_evolution_by_phone(text) from public, anon;
grant execute on function public.admin_purge_evolution_by_phone(text) to authenticated, service_role;
