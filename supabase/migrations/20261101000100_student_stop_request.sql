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
--     do assinante: o WhatsApp identifica número antigo do Brasil sem ele (a
--     mesma régua de `admin_purge_evolution_by_phone`, 20261030000100);
--   · número de NENHUM aluno avisa assim mesmo ("número não cadastrado"), e
--     número em MAIS DE UMA ficha também, sem escolher aluno por palpite: a
--     decisão é da admin, e ela precisa saber do pedido;
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
--     (ficam na inbox e na linha do outbox; a trilha não tem expurgo).
--
-- Devolve quantos avisos enfileirou (0 na reentrega). Sem wamid ou sem número
-- recusa com exceção: o webhook anota o erro na linha da inbox, que fica
-- pendente, e a reentrega tenta de novo.

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
  if v_digitos ~ '^55[0-9]{2}9[0-9]{8}$' then
    v_formas := v_formas || (substr(v_digitos, 1, 4) || substr(v_digitos, 6));
  elsif v_digitos ~ '^55[0-9]{2}[0-9]{8}$' then
    v_formas := v_formas || (substr(v_digitos, 1, 4) || '9' || substr(v_digitos, 5));
  end if;

  select count(*)::int, (array_agg(s.id order by s.id))[1], (array_agg(s.display_name order by s.id))[1]
    into v_alunos, v_student, v_nome
    from students s
    join profiles p on p.id = s.profile_id
   where regexp_replace(coalesce(p.whatsapp_e164, ''), '[^0-9]', '', 'g') = any (v_formas);
  -- ficha única ou nenhuma: só a única identifica o aluno
  if v_alunos <> 1 then
    v_student := null;
    v_nome := null;
  end if;

  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select 'email', 'student-stop-request', a.id,
         jsonb_build_object(
           'student_id', v_student,
           'student_name', v_nome,
           'alunos_com_o_numero', v_alunos,
           'whatsapp_e164', '+' || v_digitos,
           'texto', coalesce(p_texto, ''),
           'wamid', v_wamid),
         v_prefixo || a.id
    from profiles a
   where a.role = 'admin'
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
