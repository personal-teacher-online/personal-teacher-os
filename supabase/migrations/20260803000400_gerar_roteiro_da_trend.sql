-- =============================================================================
-- Estúdio v2 — Leva 5.1 (ADR-032 decisão 5 · ADR-035): `gerar_roteiro_da_trend`,
-- a porta única do roteiro — e o FIM DO PORTÃO 1.
--
-- Escolher a trend no radar É a aprovação. Numa transação só:
--   post nasce `ideia` → vira `ideia_aprovada` com o carimbo da dona →
--   a trend vira `roteirizada` → e, se o dia tem folga, o post JÁ SAI
--   reivindicado (`gerando`), com a vaga do teto tomada.
-- Nada disso mexe no guard de `content_posts` (decisão 5 do ADR-032, rejeitando
-- explicitamente "fazer o post nascer aprovado"): a mesma semântica sai por
-- COMPOSIÇÃO, e a máquina de estados em produção fica intocada.
--
-- ── POR QUE `security invoker` (e não definer, como publish_brand_voice) ─────
-- A admin JÁ tem o que esta função precisa: insert/update em `content_posts` e
-- o grant POR COLUNA de `content_trends` (status, decidida_por, decidida_em —
-- as "duas mãos" da migration 107). Rodar como invoker mantém esse selo VIVO:
-- se alguém um dia tirar a coluna da mão humana, esta RPC para junto, em vez de
-- continuar escrevendo por baixo com o privilégio do dono do banco.
--
-- ── POR QUE NÃO EXISTE `SELECT … FOR UPDATE` AQUI ──────────────────────────
-- Dois motivos, e o segundo é decisivo: (1) o cadeado da casa é o UPDATE
-- CONDICIONAL (`… and status = 'nova'`), o mesmo de `claimContentPost` e do
-- descarte no radar — quem chega depois lê 0 linhas e leva frase honesta, não o
-- raise cru do guard; (2) `FOR UPDATE` exige privilégio de UPDATE no NÍVEL DA
-- TABELA, e a mão humana só tem grant por COLUNA — o lock explodiria em
-- "permission denied" justamente para quem a função serve.
--
-- ── O TETO DIÁRIO: CONTAR NÃO BASTA, TEM DE RESERVAR (Sol, achados 1 e 2) ───
-- ADR-035 decisão 3: teto de 2 roteiros por dia, somando o botão do radar e a
-- vassoura das 12:00 UTC. Estourou: o post fica em `ideia_aprovada`, na FILA, e
-- o cron pega no dia seguinte. Teto NÃO é recusa, é adiamento — a escolha da
-- dona nunca se perde.
--
-- A primeira versão deste arquivo só CONTAVA, e o passe do Sol mostrou que a
-- conta mente: N chamadas simultâneas leem a mesma contagem e todas se acham
-- dentro do teto (o excesso não é "1", é N). Por isso duas coisas aqui:
--   1. `pg_advisory_xact_lock` — a decisão do teto é serializada; quem chega
--      junto espera o COMMIT do primeiro e conta de novo, já com ele dentro.
--   2. A RESERVA é a própria reivindicação: com folga, o post sai desta
--      transação já em `gerando` (attempt 1). Contar e reservar no mesmo lugar
--      é o que faz o teto ser invariante, e não estimativa.
-- Consequência (aceita): quem chama TEM de gerar — o post reivindicado que
-- ficar órfão porque o processo caiu volta pelo botão "Destravar" do painel,
-- exatamente como já acontece hoje com um claim interrompido.
--
-- RESIDUAL NOMEADO, o que sobrou: a vassoura das 12:00 UTC calcula a folga UMA
-- vez por corrida. Se a dona clicar no radar no meio dessa corrida (09:00 no
-- Brasil), o dia pode fechar com 1 roteiro a mais. Bounded, barato e anotado no
-- goal — fechar isso exigiria mover o lote inteiro do cron para dentro do banco.
--
-- Regra 7: tests/conteudo-geracao-trend.test.ts nasceu VERMELHO (14 casos)
-- antes deste arquivo. Sol pré-apply feito ANTES do apply em produção
-- (artefato irreversível — Lei 7; precedente M5/104/105/106/107); triagem dos
-- 10 achados no goal `docs/goals/estudio-v2-radar.md`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- O teto e a contagem do dia — um número, um lugar.
-- ---------------------------------------------------------------------------
create or replace function public.teto_diario_de_roteiros()
returns int
language sql
immutable
set search_path = public, pg_temp
as $$ select 2 $$;

comment on function public.teto_diario_de_roteiros() is
  'Teto DIÁRIO de roteiros gerados, somando o botão do radar e a vassoura das '
  '12:00 UTC (ADR-035 decisão 3 — número escolhido pelo dono). Espelhado em '
  'TETO_DIARIO_DE_ROTEIROS (src/lib/content/generate.ts), com teste comparando '
  'os dois literalmente.';

create or replace function public.roteiros_gerados_hoje()
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  -- `business_today()`, NUNCA a data do servidor: ele roda em TZ=UTC e das 20h
  -- à meia-noite de Cuiabá o dia UTC já virou — a mesma armadilha que
  -- tests/helpers/db.ts documenta. O que conta é a reivindicação (o instante em
  -- que a vaga é tomada), não a aprovação nem a entrega.
  select count(*)::int
    from public.content_posts p
   where p.kind = 'roteiro_reel'
     and p.generation_started_at is not null
     and (p.generation_started_at at time zone public.business_tz())::date
         = public.business_today()
$$;

comment on function public.roteiros_gerados_hoje() is
  'Quantos roteiros entraram em geração no dia civil do NEGÓCIO (business_tz). '
  'Conta a REIVINDICAÇÃO (generation_started_at) — por post, não por tentativa: '
  'o retry do mesmo post no mesmo dia não conta duas vezes (o orçamento de '
  'tentativas é o generation_attempts). INVOKER: responde o que o chamador '
  'ENXERGA — admin e service_role veem tudo; outro papel vê 0 e também não gera '
  '(achado 10 do Sol, aceito como limitação declarada).';

revoke execute on function public.teto_diario_de_roteiros(),
  public.roteiros_gerados_hoje() from public;
grant execute on function public.teto_diario_de_roteiros(),
  public.roteiros_gerados_hoje() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A notificação de "ideias novas" não vale para o radar (Sol, achado 7).
--
-- `notify_content_review` (migration 20260720000400) enfileira um aviso à admin
-- quando um post NASCE como `ideia` — o digest do Portão 1. O post do radar
-- nasce `ideia` e morre `ideia` no mesmo COMMIT: avisar a dona para revisar
-- uma ideia que ela mesma acabou de aprovar seria mentira — e pior, a
-- `dedupe_key` do dia ficaria queimada, suprimindo o aviso legítimo de uma
-- ideia de verdade. Única mudança: ideia COM `trend_id` não notifica.
-- O roteiro avulso e o que o worker de ideias criar continuam avisando como
-- sempre; matar a etapa `ideias` inteira é assunto da Leva 6.2 (ADR-036).
-- ---------------------------------------------------------------------------
create or replace function public.notify_content_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_admin record;
  v_channel text;
begin
  if tg_op = 'INSERT' and new.status = 'ideia' and new.trend_id is null then
    v_stage := 'ideias';
  elsif tg_op = 'UPDATE' and new.status = 'rascunho' and old.status = 'gerando' then
    v_stage := 'rascunhos';
  else
    return new;
  end if;

  for v_admin in
    select p.id, p.whatsapp_e164
    from profiles p
    where p.role = 'admin'
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
      jsonb_build_object('stage', v_stage),
      format('content-review:%s:%s:%s', v_stage, v_admin.id, public.business_today())
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A porta única: trend → roteiro.
-- ---------------------------------------------------------------------------
create or replace function public.gerar_roteiro_da_trend(
  p_trend_id uuid,
  p_contexto text,
  p_tema     text,
  p_gancho   text  default null,
  p_idea     jsonb default '{}'::jsonb
) returns table (post_id uuid, gerar_agora boolean, ja_hoje int, teto int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ator   uuid := auth.uid();
  v_papel  text := public.app_role();
  v_status text;
  v_tema   text := btrim(coalesce(p_tema, ''));
  v_gancho text := nullif(btrim(coalesce(p_gancho, '')), '');
  v_prefixo text;
  v_n      int;
  v_post   uuid;
  v_hoje   int;
  v_teto   int := public.teto_diario_de_roteiros();
  v_gerar  boolean;
begin
  -- Decidir é da MÃO HUMANA (ADR-032 decisão 4): o robô captura e mede, e
  -- nenhum outro papel escolhe pauta.
  if v_papel is distinct from 'admin' then
    raise exception 'gerar roteiro é da mão admin — papel % não decide pauta',
      coalesce(v_papel, 'nenhum');
  end if;
  if v_ator is null then
    raise exception 'gerar roteiro exige sessão com ator — decisão sem autor não é decisão';
  end if;

  if p_contexto is null or p_contexto not in ('geral', 'travel') then
    raise exception 'o contexto do roteiro é geral ou travel (recebido: %)',
      coalesce(nullif(p_contexto, ''), 'vazio');
  end if;
  -- O `tema` do post é NOT NULL e não-branco no banco; recusar aqui devolve
  -- frase de gente em vez do texto do CHECK.
  if v_tema = '' then
    raise exception 'o roteiro precisa de tema — a captura não disse do que ele fala';
  end if;

  -- A partir daqui a transação decide teto e sequência: uma de cada vez. O lock
  -- morre no COMMIT/ROLLBACK e nunca espera I/O — a geração acontece fora daqui.
  perform pg_advisory_xact_lock(hashtext('gerar_roteiro_da_trend'));

  select t.status into v_status from public.content_trends t where t.id = p_trend_id;
  if v_status is null then
    raise exception 'trend % não existe', p_trend_id;
  end if;
  if v_status = 'descartada' then
    raise exception 'trend % está descartada — tema descartado não vira roteiro', p_trend_id;
  end if;

  -- Trend NOVA: a escolha da dona é a aprovação, e o carimbo vem AGORA. Trend
  -- já `roteirizada` (o 2º contexto do mesmo tema) NÃO se toca: `roteirizada` é
  -- terminal de linha — a 2ª geração cria outro POST (nota 3 da migration 107).
  if v_status = 'nova' then
    update public.content_trends
       set status = 'roteirizada', decidida_por = v_ator, decidida_em = now()
     where id = p_trend_id and status = 'nova';
    if not found then
      raise exception 'trend % já foi decidida em outra aba', p_trend_id;
    end if;
  end if;

  v_hoje  := public.roteiros_gerados_hoje();
  v_gerar := v_hoje < v_teto;

  -- Sequência pelo PREFIXO da chave natural, não por (trend, contexto): a
  -- unicidade de `external_ref` é GLOBAL, então contar linhas relacionadas
  -- deixaria uma chave já ocupada derrubar a geração para sempre (achado 9 do
  -- Sol). Contando o que existe com o mesmo prefixo, a sequência pula por cima.
  v_prefixo := 'trend:' || p_trend_id::text || ':' || p_contexto || ':';
  select count(*)::int + 1 into v_n
    from public.content_posts p
   where p.external_ref like v_prefixo || '%';

  insert into public.content_posts
    (external_ref, kind, tema, gancho, idea, trend_id, contexto, created_by)
  values
    (v_prefixo || v_n::text, 'roteiro_reel', v_tema, v_gancho,
     coalesce(p_idea, '{}'::jsonb), p_trend_id, p_contexto, v_ator)
  returning id into v_post;

  -- O Portão 1 morre aqui: a aprovação é a mesma transição de sempre, com o
  -- carimbo de quem escolheu a trend.
  update public.content_posts
     set status = 'ideia_aprovada', idea_approved_by = v_ator, idea_approved_at = now()
   where id = v_post;

  -- A RESERVA (ver o cabeçalho): com folga no dia, o post já sai reivindicado —
  -- é isso que impede duas chamadas de acharem que cabem na mesma vaga. Sem
  -- folga ele fica em `ideia_aprovada`, que é a fila da vassoura.
  if v_gerar then
    update public.content_posts
       set status = 'gerando', generation_started_at = now(), generation_attempts = 1
     where id = v_post;
  end if;

  return query select v_post, v_gerar, v_hoje, v_teto;
end;
$$;

comment on function public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) is
  'Porta única do roteiro (ADR-032 decisão 5 · ADR-035): numa transação, cria o '
  'post (ideia → ideia_aprovada, carimbo da admin), carimba a trend NOVA como '
  'roteirizada e, se o dia tem folga, JÁ REIVINDICA o post (gerando, attempt 1) '
  '— contar e reservar no mesmo lugar é o que faz o teto ser invariante. Trend '
  'já roteirizada gera OUTRO post sem tocá-la (o 2º contexto); descartada é '
  'recusada. gerar_agora=false não é erro: o post fica na fila e a vassoura das '
  '12:00 UTC gera. gerar_agora=true OBRIGA o chamador a gerar (post preso em '
  'gerando volta pelo botão Destravar). security invoker de propósito: mantém '
  'vivo o grant por coluna da 107.';

revoke execute on function
  public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) from public;
-- Só a mão humana: service_role (o robô da captura) fica de FORA de propósito.
grant execute on function
  public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) to authenticated;

-- Reload do schema cache do PostgREST (precedente da 106/107).
notify pgrst, 'reload schema';
