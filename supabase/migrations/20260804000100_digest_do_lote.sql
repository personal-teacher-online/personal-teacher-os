-- ===========================================================================
-- Estúdio v2 — Leva 6.2 (ADR-036 decisão 1): O DIGEST DO LOTE
--
-- Até aqui o aviso da fábrica de conteúdo era por EVENTO e sem número: "há
-- ideias novas", "há rascunhos". Com o Portão 1 morto no cutover (Leva 5), a
-- etapa `ideias` só sobrevivia para o roteiro AVULSO — um aviso que a própria
-- dona provoca ao clicar em "Roteiro avulso". Ela morre aqui.
--
-- No lugar dela entra o aviso que faltava: ao FIM da varredura semanal, o
-- worker enfileira UM toque por admin com os números do LOTE — quantas trends
-- aquela varredura trouxe, quantas estão em destaque para o Personal Travel, e
-- quantos rascunhos estão parados no portão 2.
--
-- ── DUAS DECISÕES QUE ESTÃO NO CÓDIGO, E NÃO NO COMENTÁRIO ──────────────────
--
-- 1. OS NÚMEROS SÃO CONTADOS AQUI, no banco, e não recebidos do worker. O
--    relatório da corrida tem os números na memória do processo, mas eles
--    contam o que AQUELA corrida fez; o que a dona vai abrir é a TELA, que lê
--    a tabela. Contar na mesma fonte que a tela lê é o que faz o aviso e o
--    radar dizerem a mesma coisa. O limiar do destaque é PARÂMETRO
--    (`LIMIAR_ABA_PT` do app) — uma fonte só para os dois lados.
--
-- 2. DEDUPE POR RODADA, não por dia civil (o `business_today()` do
--    `notify_content_review`). A varredura é semanal: um toque por semana ISO
--    por admin. Rodar de novo na mesma semana (`--force`) ATUALIZA os números
--    da linha enquanto ela não saiu — e não toca em nada depois que saiu, senão
--    o histórico diria um número que ninguém recebeu.
--
-- O canal segue a régua M4-3 (tem número → WhatsApp, senão e-mail) e o silêncio
-- de 21h–8h continua sendo do DESPACHANTE (`quiet: true` no template) — este
-- lado só enfileira.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A etapa `ideias` morre; `rascunhos` fica.
--
-- O portão 2 é o único portão que sobrou, e ele continua avisando exatamente
-- como antes: `gerando → rascunho`, 1 toque por admin por dia civil.
-- ---------------------------------------------------------------------------
create or replace function public.notify_content_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin record;
  v_channel text;
begin
  -- Só o portão 2. A etapa 'ideias' morreu com o Portão 1 (Leva 6.2): o post do
  -- radar nasce e morre `ideia` no mesmo commit, e o roteiro avulso é ato da
  -- própria admin — avisá-la do que ela acabou de escrever é ruído.
  if not (tg_op = 'UPDATE' and new.status = 'rascunho' and old.status = 'gerando') then
    return new;
  end if;

  for v_admin in
    select p.id, p.whatsapp_e164
    from profiles p
    where p.role = 'admin'
    -- Ordem FIXA (achado 17 do Sol): duas transações percorrendo os mesmos
    -- admins em ordens opostas podem se travar no conflito de chave. Custa
    -- nada e tira a possibilidade da mesa.
    order by p.id
  loop
    v_channel := case
      when v_admin.whatsapp_e164 is not null then 'whatsapp'
      else 'email'
    end;
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (
      v_channel,
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
  'Portão 2: rascunho pronto → 1 toque por admin por dia civil. A etapa `ideias` '
  'morreu na Leva 6.2 com o Portão 1 (ADR-036). O aviso do LOTE é o '
  'enqueue_content_digest, disparado pelo worker ao fim da varredura.';

-- Achado 16 do Sol: `create or replace` PRESERVA a ACL antiga, e em produção
-- toda função nasceu com EXECUTE para anon/authenticated (default privilege do
-- `postgres`). Função de gatilho não é chamável como RPC, e o disparo pelo
-- trigger não consulta este grant — mas deixar EXECUTE aberto numa definer que
-- escreve na fila de avisos é superfície que ninguém precisa. Mesma disciplina
-- nominal da 109.
revoke execute on function public.notify_content_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. O digest do lote.
--
-- Porta do ROBÔ: `service_role` é quem chama, ao fim da corrida semanal.
--
-- ⚠️ A LIÇÃO DA MIGRATION 109, aplicada aqui de nascença: em produção o
-- `postgres` tem default privilege de FUNÇÃO concedendo EXECUTE a `anon`,
-- `authenticated` e `service_role`, e `revoke ... from public` NÃO remove grant
-- de papel NOMEADO. Toda função nova nasce exposta lá, e o teste local de ACL é
-- FALSO-VERDE. Por isso são duas camadas, nesta ordem de importância:
--   (a) o corpo recusa quem não é o robô — vale nos dois ambientes;
--   (b) o grant é revogado NOMINALMENTE de public, anon e authenticated.
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
  v_channel text;
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
    select p.id, p.whatsapp_e164
    from public.profiles p
    where p.role = 'admin'
    order by p.id -- ordem fixa: sem ela, duas corridas podem se travar (achado 17)
  loop
    v_channel := case
      when v_admin.whatsapp_e164 is not null then 'whatsapp'
      else 'email'
    end;
    insert into public.notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (
      v_channel,
      'content-digest',
      v_admin.id,
      v_payload,
      format('content-digest:%s:%s', p_semana, v_admin.id)
    )
    -- Corrida repetida na mesma rodada corrige os números ENQUANTO o toque não
    -- saiu. Depois de enviado, a linha é histórico: reescrevê-la faria o
    -- registro afirmar um número que a dona nunca leu.
    on conflict (dedupe_key) do update
      set payload = excluded.payload
      where public.notification_outbox.sent_at is null;
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
  'vencendo) e rascunhos parados no portão 2. Conta na mesma fonte que a tela lê. '
  'Porta do robô: recusa quem não é service_role, além do grant nominal.';

revoke execute on function public.enqueue_content_digest(text, int) from public, anon, authenticated;
grant execute on function public.enqueue_content_digest(text, int) to service_role;
