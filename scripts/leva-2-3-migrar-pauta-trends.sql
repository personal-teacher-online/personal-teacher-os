-- =============================================================================
-- Estúdio v2 — Leva 2.3: script de DADOS (produção). NÃO é migration.
--
-- Migra as ideias `pauta` pendentes (decisão 2 do dono, 02/08) para
-- `content_trends`, vinculadas à linha ATIVA de research de origem, na rodada
-- corrente. O post de ideia vai para `arquivado` com o motivo citando a trend
-- e `trend_id` apontando para ela — sai de "Para você" SEM perder histórico.
--
-- Rodar via psql no container do banco, DEPOIS da migration
-- 20260803000300_content_trends.sql, com dump prévio de content_posts
-- (e na janela da LEVA 3 — decisão do dono, 03/08: até a tela do radar
-- existir, as ideias pauta continuam visíveis no Portão 1):
--
--   sudo docker exec -i <db> psql -U postgres -d postgres \
--     -v ator=<uuid-do-admin-operacional> -f /tmp/leva-2-3-migrar-pauta-trends.sql
--
-- Desenho (ADR-037 decisão 9, molde da 0.2):
--   * Alvo = TODO post `ideia` com external_ref like 'pauta:%' (não um número
--     cravado: corridas semanais entre a escrita e a janela criam ideias novas
--     da mesma classe). A contagem sai no retrato — conferir com o runbook.
--   * DOIS RAMOS (ajuste da pendência do §AG, 03/08): fonte que ainda NÃO é
--     trend → CRIA a trend e arquiva o post apontando para ela (ramo A, o
--     original); fonte que JÁ é trend (o radar passou antes — estado NORMAL da
--     era de transição, a corrida de 03/08 criou 4 assim) → VINCULA o post à
--     trend EXISTENTE e arquiva com motivo próprio (ramo B). Nada sobrescreve
--     a trend: a medição dela é retrato (guard da 107), e se a dona já a
--     decidiu (descartada/roteirizada), a decisão dela sobre o TEMA já cobre a
--     ideia — o retrato do ramo B nomeia esses casos, não aborta.
--   * Fail-loud ANTES de mexer: ideia sem source_key no jsonb · fonte sem
--     linha ATIVA de research · duas ideias da MESMA fonte (source_key único
--     em trends — decisão é do dono, não do script) · created_by não-nulo no
--     alvo (ideia manual não é fornada) · publicado_em no futuro da medição
--     (só no ramo A — o ramo B não calcula nada).
--   * velocidade calculada como no worker: views/dia no momento da MEDIÇÃO
--     (coletado_em da linha de research), ÷ mediana da conta quando o creator
--     está cadastrado com "views medianas"; senão views/dia puro + flag.
--     Fonte-bundle (tipo=trends) não tem views → NULL, sem flag de conta.
--   * travel_score nasce NULL — a corrida seguinte cura (robô, ADR-037 dec. 6).
--     Embedding idem: backfill preguiçoso da 1ª corrida (script fica SQL puro).
--   * Transação única: qualquer exceção desfaz tudo. O ator entra no audit via
--     request.jwt.claims (auth.uid() lê o sub) — INSERT das trends e UPDATE dos
--     posts com autoria real.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?ator}
\else
\echo 'ERRO: rode com -v ator=<uuid-do-admin-operacional>'
-- \q sairia com código 0 e automação leria como sucesso (achado nº 17 do Sol):
-- o erro tem de ser SQL, para o ON_ERROR_STOP devolver exit code de falha.
do $$ begin raise exception 'ABORTADO: rode com -v ator=<uuid-do-admin-operacional>'; end $$;
\endif

begin;

-- A rodada é semana ISO em UTC (mesma régua do semanaIso() do worker) — sem
-- isto o to_char abaixo herdaria o TimeZone da sessão (achado nº 16 do Sol).
set local time zone 'UTC';

-- Trava escrita concorrente enquanto o script classifica e move (molde 0.2);
-- leitura segue livre; a janela dura segundos.
lock table content_posts in share row exclusive mode;
lock table content_trends in share row exclusive mode;

-- O ator tem de ser um admin REAL (achado nº 7 do Sol na 0.2). Nota psql:
-- variável não interpola dentro de $$…$$ — o valor viaja por GUC.
select set_config('leva23.ator', :'ator', true);
do $$
declare v_ator uuid; v_role text;
begin
  v_ator := current_setting('leva23.ator')::uuid;
  select raw_app_meta_data ->> 'role' into v_role
    from auth.users where id = v_ator;
  if v_role is distinct from 'admin' then
    raise exception 'ABORTADO: ator % não é admin (role=%)', v_ator, coalesce(v_role, 'inexistente');
  end if;
end $$;

-- Ator do audit (auth.uid() = claims->>'sub') — padrão §AB.1.
select set_config('request.jwt.claims',
  json_build_object('sub', :'ator', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Retrato ANTES (colar no runbook).
-- ---------------------------------------------------------------------------
select status, count(*)::int as n
  from content_posts where external_ref like 'pauta:%' group by 1 order by 1;
select count(*)::int as trends_ja_existentes from content_trends;

-- ---------------------------------------------------------------------------
-- Guardas fail-loud (nenhuma escrita antes de TODAS passarem).
-- ---------------------------------------------------------------------------
do $$
declare v int;
begin
  -- Alvo vazio = janela errada (nada a migrar não é sucesso silencioso).
  select count(*) into v from content_posts
   where status = 'ideia' and external_ref like 'pauta:%';
  if v = 0 then
    raise exception 'ABORTADO: nenhuma ideia pauta pendente — nada a migrar (janela errada?)';
  end if;

  -- Ideia manual no alvo: fornada é do robô; criação humana vai ao dono.
  select count(*) into v from content_posts
   where status = 'ideia' and external_ref like 'pauta:%' and created_by is not null;
  if v > 0 then
    raise exception 'ABORTADO: % ideia(s) pauta com created_by não-nulo — levar ao dono', v;
  end if;

  -- Proveniência: toda ideia do alvo precisa do source_key no jsonb…
  select count(*) into v from content_posts
   where status = 'ideia' and external_ref like 'pauta:%'
     and btrim(coalesce(idea ->> 'source_key', '')) = '';
  if v > 0 then
    raise exception 'ABORTADO: % ideia(s) pauta sem source_key no idea jsonb', v;
  end if;

  -- …e a fonte precisa de linha ATIVA em research (1 por fonte, índice parcial).
  select count(*) into v
    from content_posts p
   where p.status = 'ideia' and p.external_ref like 'pauta:%'
     and not exists (
       select 1 from content_research cr
        where cr.source_key = p.idea ->> 'source_key'
          and cr.superseded_by is null);
  if v > 0 then
    raise exception 'ABORTADO: % ideia(s) pauta cuja fonte não tem research ATIVO', v;
  end if;

  -- Duas ideias da MESMA fonte: trends têm source_key ÚNICO; qual das duas é a
  -- trend (e qual seria variação) é decisão do dono, não do script.
  select count(*) into v from (
    select idea ->> 'source_key'
      from content_posts
     where status = 'ideia' and external_ref like 'pauta:%'
     group by 1 having count(*) > 1) d;
  if v > 0 then
    raise exception 'ABORTADO: % fonte(s) com mais de uma ideia pauta pendente — levar ao dono', v;
  end if;

  -- Fonte que JÁ virou trend NÃO aborta mais (ajuste do §AG): vira o ramo B,
  -- que vincula em vez de criar. O que era anomalia virou o estado normal da
  -- era de transição — o worker roda toda semana entre a escrita e a janela.

  -- Post do alvo com trend_id JÁ preenchido é estado anômalo (achados nº 2/5
  -- do Sol no ramo B): nenhum caminho legítimo deixa uma ideia pendente com
  -- vínculo — e sem esta guarda o caso só estouraria TARDE, no guard do banco,
  -- depois dos INSERTs do ramo A (fail-fast de volta) ou passaria por
  -- "vinculada" sem o script ter vinculado nada (contagem mentirosa).
  select count(*) into v from content_posts
   where status = 'ideia' and external_ref like 'pauta:%' and trend_id is not null;
  if v > 0 then
    raise exception 'ABORTADO: % ideia(s) pauta com trend_id já preenchido — levar ao dono', v;
  end if;

  -- Publicação no futuro da medição é dado inválido — vira erro, não
  -- denominador silencioso (achado nº 15 do Sol). SÓ no ramo A: o ramo B não
  -- calcula velocidade nenhuma (a trend existente já tem a dela).
  select count(*) into v
    from content_posts p
    join content_research cr
      on cr.source_key = p.idea ->> 'source_key' and cr.superseded_by is null
   where p.status = 'ideia' and p.external_ref like 'pauta:%'
     and not exists (select 1 from content_trends t
                      where t.source_key = p.idea ->> 'source_key')
     and cr.publicado_em is not null and cr.publicado_em > cr.coletado_em;
  if v > 0 then
    raise exception 'ABORTADO: % fonte(s) com publicado_em depois de coletado_em', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Ideias pauta → trends da rodada corrente (INSERT auditado com ator).
-- ---------------------------------------------------------------------------
-- post_id na memória do lote (achados nº 18/19 do Sol): o UPDATE e a sanidade
-- final falam de POSTS EXATOS, nunca de "qualquer pauta com o mesmo source_key"
-- — um post pauta antigo (arquivado na 0.2) da mesma fonte não aborta o lote
-- nem passa por migrado. O `ramo` separa criada de vinculada em toda contagem
-- daqui para baixo — notice que soma os dois estaria mentindo.
-- `status_da_trend` é retrato da CLASSIFICAÇÃO (os locks seguram o status até
-- o COMMIT) — é ele que entra no archived_reason (achado nº 4 do Sol).
create temp table _migradas (
  post_id uuid, trend_id uuid, source_key text, ramo text, status_da_trend text
) on commit drop;

-- Ramo B primeiro: fonte que JÁ é trend vincula à trend EXISTENTE (§AG).
insert into _migradas (post_id, trend_id, source_key, ramo, status_da_trend)
select p.id, t.id, p.idea ->> 'source_key', 'vinculada', t.status
  from content_posts p
  join content_trends t on t.source_key = p.idea ->> 'source_key'
 where p.status = 'ideia' and p.external_ref like 'pauta:%';

-- Retrato do ramo B com o TEMA do post ao lado do status da trend (achado
-- nº 1 do Sol, parcial): a equivalência fonte→tema é o desenho da transição
-- (decisão 2 do dono — a trend é o objeto), mas quem opera a janela confere a
-- olho se a decisão da trend cobre mesmo a ideia que sai de cena. 'descartada'
-- aqui é caso nomeado, nunca erro.
select t.status as status_da_trend_vinculada, p.tema as tema_do_post, p.external_ref
  from _migradas m
  join content_trends t on t.id = m.trend_id
  join content_posts p on p.id = m.post_id
 where m.ramo = 'vinculada'
 order by t.status, p.external_ref;

-- Ramo A: o pipeline original, agora só sobre as fontes que ainda não são trend.
with alvo as (
  select p.id as post_id, p.idea ->> 'source_key' as source_key
    from content_posts p
   where p.status = 'ideia' and p.external_ref like 'pauta:%'
     and not exists (select 1 from _migradas m where m.post_id = p.id)
),
fonte as (
  select a.post_id, cr.id as research_id, cr.source_key, cr.plataforma, cr.tipo,
         cr.url, cr.payload ->> 'autor' as autor,
         nullif(cr.metricas ->> 'views', '')::bigint as views,
         cr.publicado_em, cr.coletado_em, cr.creator_id
    from alvo a
    join content_research cr
      on cr.source_key = a.source_key and cr.superseded_by is null
),
conta as (
  select f.*,
         nullif(cc.metricas ->> 'views medianas', '')::numeric as mediana
    from fonte f
    left join content_creators cc on cc.id = f.creator_id
),
calculo as (
  -- views/dia no momento da MEDIÇÃO, com piso de 1 dia por desenho (achado
  -- nº 14 do Sol, confirmado): item com menos de 24h não extrapola — mesmo
  -- piso da velocidadeDoItem() do worker, para as duas contas nunca divergirem.
  select c.*,
         case when c.views is not null and c.publicado_em is not null then
           round(c.views / greatest(1, extract(epoch from (c.coletado_em - c.publicado_em)) / 86400)::numeric, 4)
         end as views_dia
    from conta c
),
ins as (
  insert into content_trends
    (research_id, source_key, plataforma, url, autor, views, velocidade,
     velocidade_sem_conta, semana, travel_score, travel_meta)
  select
    research_id, source_key, plataforma, url, autor, views,
    case when views_dia is null then null
         when mediana is not null and mediana > 0 then round(views_dia / mediana, 4)
         else views_dia end,
    -- flag só faz sentido onde HÁ velocidade: bundle sem views fica false.
    (views_dia is not null and (mediana is null or mediana <= 0)),
    to_char(now(), 'IYYY-"W"IW'),
    null, '{}'::jsonb
  from calculo
  returning id, source_key
)
insert into _migradas (post_id, trend_id, source_key, ramo, status_da_trend)
select c.post_id, i.id, i.source_key, 'criada', 'nova'
  from ins i
  join calculo c on c.source_key = i.source_key;

select count(*) filter (where ramo = 'criada')::int as trends_criadas,
       count(*) filter (where ramo = 'vinculada')::int as ideias_vinculadas
  from _migradas;

-- ---------------------------------------------------------------------------
-- 2) O post de ideia aponta para a trend e vai para o arquivo (UPDATE auditado).
--    O motivo diz a verdade de cada ramo — é o registro auditável do porquê.
-- ---------------------------------------------------------------------------
with movidos as (
  update content_posts p
     set trend_id = m.trend_id,
         status = 'arquivado',
         -- O ramo B carimba o STATUS da trend no momento do vínculo (achado
         -- nº 4 do Sol): "movida para o novo portão", "já roteirizada" e
         -- "tema já descartado" são três verdades diferentes, e o post é o
         -- registro auditável de qual delas valeu.
         archived_reason = case m.ramo
           when 'criada' then 'migrada para o radar (trend ' || m.trend_id || ')'
           else 'vinculada a trend existente do radar (trend ' || m.trend_id
                || ', ' || m.status_da_trend || ' no vínculo)'
         end
    from _migradas m
   where p.id = m.post_id
  returning 1)
select count(*)::int as posts_arquivados from movidos;

-- ---------------------------------------------------------------------------
-- Retrato DEPOIS + sanidade fail-loud.
-- ---------------------------------------------------------------------------
select status, count(*)::int as n
  from content_posts where external_ref like 'pauta:%' group by 1 order by 1;
select semana, status, count(*)::int as n
  from content_trends group by 1, 2 order by 1, 2;

do $$
declare v_pendentes int; v_linhas int; v_posts int; v_criadas int; v_vinculadas int; v_tortos int;
begin
  -- Nenhuma ideia pauta pode ter sobrado pendente.
  select count(*) into v_pendentes from content_posts
   where status = 'ideia' and external_ref like 'pauta:%';
  if v_pendentes > 0 then
    raise exception 'ABORTADO: % ideia(s) pauta ainda pendentes após a migração', v_pendentes;
  end if;

  -- Contagens fecham: cada post do lote aparece UMA vez, num único ramo.
  select count(*), count(distinct post_id),
         count(*) filter (where ramo = 'criada'),
         count(*) filter (where ramo = 'vinculada')
    into v_linhas, v_posts, v_criadas, v_vinculadas from _migradas;
  if v_linhas <> v_posts then
    raise exception 'ABORTADO: lote torto — % linha(s) para % post(s)', v_linhas, v_posts;
  end if;
  if v_criadas + v_vinculadas <> v_linhas then
    raise exception 'ABORTADO: ramo desconhecido no lote (% + % <> %)', v_criadas, v_vinculadas, v_linhas;
  end if;

  -- Cada post do LOTE aponta para a trend DELE (achados nº 18/19 do Sol:
  -- comparação exata por post_id + trend_id, não por source_key solto) — e a
  -- trend, em QUALQUER ramo, fala da MESMA fonte que o post.
  select count(*) into v_tortos from _migradas m
    join content_posts p on p.id = m.post_id
    join content_trends t on t.id = m.trend_id
   where p.status <> 'arquivado'
      or p.trend_id is distinct from m.trend_id
      or t.source_key is distinct from m.source_key;
  if v_tortos > 0 then
    raise exception 'ABORTADO: % post(s) do lote sem vínculo/arquivo exatos', v_tortos;
  end if;
  raise notice 'migração ok: % trend(s) criadas + % ideia(s) vinculadas a trends existentes',
    v_criadas, v_vinculadas;
end $$;

-- "De onde veio" íntegro: cada trend do lote lê a dissecação/título pela FK.
select m.ramo, t.id, t.source_key, t.plataforma, t.status, t.views, t.velocidade,
       t.velocidade_sem_conta, cr.titulo
  from content_trends t
  join content_research cr on cr.id = t.research_id
  join _migradas m on m.trend_id = t.id
 order by m.ramo, t.source_key;

commit;
