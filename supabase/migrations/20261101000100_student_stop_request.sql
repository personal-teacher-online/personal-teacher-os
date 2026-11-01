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
-- webhook da Meta (src/lib/webhooks/meta.ts) só detecta o pedido de parada
-- (nível estrito de src/lib/notify/palavras-de-parada.ts), grava na linha da
-- inbox a marca `parada: { texto }` e chama esta função com o `event_id` da
-- linha.
--
-- O QUE ELA FAZ:
--   · TRAVA A LINHA DA INBOX (`for update`) e lê dela o wamid, o número e o
--     texto GRAVADOS (first-write-wins). Sem linha (o expurgo já a apagou) ou
--     sem a marca, devolve 0 e não enfileira nada; com a linha travada, o
--     expurgo espera o aviso nascer e então o limpa também;
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
--   · DEDUPE POR (WAMID, ADMIN) (Lei 6): a chave
--     `student-stop-request:<wamid>:<admin>` com `on conflict do nothing`; o
--     advisory lock do wamid serializa duas entregas simultâneas. A admin cujo
--     perfil está travado por outra transação no instante do envio fica de
--     fora desta vez (`for key share skip locked`, para o insert não cair na
--     chave estrangeira de um perfil sendo apagado): a linha da inbox fica
--     pendente com o motivo, e a rede completa só o que falta. Quando toda
--     admin tem o seu aviso, a função fecha a linha;
--   · `audit_log` (Lei 8) só quando enfileira: a reentrega não muda nada e
--     não deixa trilha. O texto e o número da mensagem não vão para a trilha
--     (a trilha não tem expurgo; o rastro durável do desfecho é a ação da
--     admin na ficha, ADR-038 item 4).
--
-- O TEXTO E O NÚMERO NA LINHA DO OUTBOX TÊM PRAZO (ADR-038, item 3: a mensagem
-- dura 90 dias). Esta migration redefine as duas portas de expurgo da inbox
-- (corpo de 20261030000100 mais o trecho do outbox no fim):
--   · `purge_evolution_inbox` tira `texto` e `whatsapp_e164` do payload das
--     linhas `student-stop-request` NASCIDAS há mais de `p_days` dias,
--     enviadas ou presas;
--   · `admin_purge_evolution_by_phone` (apagar aluno, D10) tira os mesmos dois
--     campos das linhas daquele telefone, enviadas ou não. As formas do número
--     passam à régua simétrica do aviso (só celular perde ou ganha o 9), também
--     para a inbox da Meta.
-- Ambas devolvem a soma (linhas da inbox apagadas + linhas do outbox limpas).
-- O expurgo geral do outbox é a dívida maior da issue #138.
--
-- Devolve quantos avisos NOVOS enfileirou (0 na reentrega, sem exceção). Sem
-- wamid, sem número ou sem admin nenhuma recusa com exceção: o webhook anota o
-- erro na linha da inbox, que fica pendente, e responde 200 à Meta (que então
-- não reenvia).
--
-- A REDE (como a dos recibos, `outbox_reapply_pending_receipts`): a cada 5 min
-- o pg_cron roda `meta_retry_pending_stop_requests`, que pega a mensagem da
-- Meta ainda pendente na inbox COM A MARCA `parada` que o webhook grava no
-- payload ao detectar o pedido (a detecção é dele; sem a marca, a rede não
-- avisa ninguém) e chama esta função de novo pelo `event_id`. A função fecha a
-- linha quando completa; falha reescreve o erro e ela espera a próxima rodada. Sem isto, uma
-- falha passageira perderia o aviso: a Meta só reenvia o que não recebeu 200.

create or replace function public.enqueue_student_stop_request(p_event_id text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linha record;
  v_wamid text;
  v_digitos text;
  v_texto text;
  v_prefixo text;
  v_formas text[];
  v_alunos int;
  v_student uuid;
  v_nome text;
  v_nomes jsonb;
  v_equipe text;
  v_equipe_nome text;
  v_n int;
  v_faltam int;
begin
  -- a porta é do servidor (o webhook, com service_role); a ACL já fecha, e
  -- isto segura uma chamada logada se a ACL um dia abrir
  if (auth.jwt() ->> 'role') is not null and (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'enqueue_student_stop_request é porta do servidor (service_role)'
      using errcode = '42501';
  end if;

  -- A LINHA DA INBOX, TRAVADA: o expurgo (90 dias ou por telefone) espera por
  -- ela, e linha que o expurgo já apagou não vira aviso com o texto e o número
  -- que ele acabou de tirar.
  select w.id, w.payload into v_linha
    from webhook_inbox w
   where w.source = 'meta' and w.event_id = p_event_id
     for update;
  if not found then
    return 0;
  end if;
  -- só o que o webhook marcou como pedido de parada inequívoco
  if not (v_linha.payload ? 'parada') then
    return 0;
  end if;
  v_wamid := nullif(btrim(coalesce(v_linha.payload #>> '{message,id}', '')), '');
  v_digitos := regexp_replace(coalesce(v_linha.payload #>> '{message,from}', ''), '[^0-9]', '', 'g');
  v_texto := coalesce(v_linha.payload #>> '{parada,texto}', '');

  if v_wamid is null then
    raise exception 'aviso de parada sem o wamid da mensagem';
  end if;
  if v_digitos = '' then
    raise exception 'aviso de parada sem o número de quem mandou';
  end if;

  v_prefixo := 'student-stop-request:' || v_wamid || ':';
  perform pg_advisory_xact_lock(hashtext(v_prefixo));

  if not exists (select 1 from profiles where role = 'admin') then
    raise exception 'nenhuma admin para avisar do pedido de parada';
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
           'texto', v_texto,
           'wamid', v_wamid),
         v_prefixo || a.id
    from profiles a
   where a.role = 'admin'
   -- perfil de admin sendo apagado agora fica de fora em vez de derrubar o
   -- insert pela chave estrangeira (e o apagado não volta a ser lido)
     for key share of a skip locked
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;

  -- A LINHA SÓ FECHA QUANDO TODA ADMIN TEM O SEU AVISO. A que ficou de fora
  -- (perfil travado por outra transação no instante do envio) deixa a linha
  -- pendente com o motivo, e a rede de 5 min completa só o que falta: a chave
  -- por (wamid, admin) não deixa repetir quem já foi avisada.
  select count(*)::int into v_faltam
    from profiles a
   where a.role = 'admin'
     and not exists (select 1 from notification_outbox o where o.dedupe_key = v_prefixo || a.id);
  if v_faltam = 0 then
    update webhook_inbox set processed_at = now(), error = null where id = v_linha.id;
  else
    update webhook_inbox
       set error = format('aviso de parada incompleto: %s admin(s) sem aviso; a rede tenta de novo', v_faltam)
     where id = v_linha.id;
  end if;

  if v_n > 0 then
    perform public.log_audit(null, 'enqueue_student_stop_request', 'notification_outbox', v_wamid,
      jsonb_build_object('student_id', v_student, 'alunos_com_o_numero', v_alunos, 'avisos', v_n));
  end if;
  return v_n;
end;
$$;

revoke execute on function public.enqueue_student_stop_request(text) from public, anon, authenticated;
grant execute on function public.enqueue_student_stop_request(text) to service_role;

comment on function public.enqueue_student_stop_request(text) is
  'Issue #127 (ADR-038, item 4): aluno mandou pedido de parada ao número de envio. '
  'Recebe o event_id da linha da inbox, trava a linha (sem linha, 0) e enfileira UM '
  'e-mail interno por admin (template student-stop-request), uma vez por (wamid, admin); '
  'fecha a linha quando toda admin tem o seu. Acha o aluno pelo número (com e sem o 9 '
  'do celular do Brasil). Nada no perfil muda. Só service_role.';

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
    select w.id, w.event_id
      from webhook_inbox w
     where w.source = 'meta'
       and w.processed_at is null
       and right(w.event_id, length(':message')) = ':message'
       -- só o que o webhook marcou como pedido de parada
       and w.payload ? 'parada'
       -- a que chegou agora é do webhook, que ainda está chamando a função
       and w.received_at < now() - interval '1 minute'
     order by w.id
       for update skip locked
  loop
    begin
      -- a função fecha a linha (ou a deixa pendente com o motivo) ela mesma
      v_n := v_n + public.enqueue_student_stop_request(r.event_id);
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
  'parada (gravada pelo webhook) chama enqueue_student_stop_request de novo pelo '
  'event_id; devolve quantos avisos novos saíram. Falha reescreve o erro. pg_cron, 5 min.';

select cron.schedule(
  'meta-retry-pending-stop-requests',
  '*/5 * * * *',
  $$select public.meta_retry_pending_stop_requests()$$
);

-- ---------------------------------------------------------------------------
-- O prazo do texto e do número do pedido de parada (ver o cabeçalho). As duas
-- funções abaixo são as de 20261030000100 com o trecho do outbox no fim e, na
-- por telefone, as formas do número na régua simétrica do aviso (só celular
-- perde ou ganha o 9); o ramo da Evolution (`like`) fica como estava, porque
-- o canal está de saída. A assinatura é a mesma, e a ACL é reemitida igual.
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
  -- (ADR-038, item 3), contado de quando o aviso NASCEU. Vale também para a
  -- linha presa que nunca saiu: o e-mail dela, se um dia sair, mostra
  -- "(número apagado)" e "(mensagem apagada)".
  update notification_outbox
     set payload = payload - 'texto' - 'whatsapp_e164'
   where template = 'student-stop-request'
     and created_at < now() - make_interval(days => p_days)
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
  -- #127: a MESMA régua da busca do aviso de parada, nos dois sentidos. Só
  -- celular (assinante de 8 dígitos começando com 6 a 9) perde ou ganha o 9:
  -- o fixo de uma pessoa não apaga as linhas do celular de outra. (Antes, o 9
  -- saía de qualquer número de 13 dígitos e nunca era acrescentado.)
  v_formas := array[v_digits];
  if v_digits ~ '^55[0-9]{2}9[6-9][0-9]{7}$' then
    v_formas := v_formas || (substr(v_digits, 1, 4) || substr(v_digits, 6));
  elsif v_digits ~ '^55[0-9]{2}[6-9][0-9]{7}$' then
    v_formas := v_formas || (substr(v_digits, 1, 4) || '9' || substr(v_digits, 5));
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
