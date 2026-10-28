-- =============================================================================
-- Estúdio v2 — Leva 1.2: `tipo` e `tier` em content_creators.
--
--   tipo  criador|empresa — a lista da dona (pergunta 5 do radar) traz contas
--         grandes e empresas; o radar lê a velocidade de cada um com a régua
--         certa sabendo quem é quem. NOT NULL default 'criador'.
--   tier  faixa de ALCANCE (decisão do dono, 03/08): grande|media|nicho.
--         NULLABLE de propósito — NULL = "sem classificação". Classificar
--         exige OLHAR a conta (régua do M4: zero palpite), então as contas
--         existentes nascem sem faixa e alguém as classifica pela tela.
--
-- Notas de ordem (as numeradas vêm do ataque do Sol PRÉ-APPLY, 03/08 —
-- triagem registrada em docs/goals/estudio-v2-radar.md):
-- 1. `tipo` nasce NULLABLE e as linhas existentes ganham 'criador' por UPDATE,
--    não por DEFAULT do ALTER (achados 1 e 2 do Sol): ALTER..DEFAULT não
--    dispara trigger de linha — a classificação inicial ficaria FORA do
--    audit_log e o updated_at não andaria. Via UPDATE, o audit registra a
--    atribuição (ator NULL = migração, como no seed) e o carimbo anda. Só
--    depois a coluna vira NOT NULL com default.
-- 2. Migration ADITIVA sobre a 20260801000100 (imutável, Lei 7): nenhum
--    constraint existente é tocado; os dois CHECKs novos são nomeados à mão
--    porque a tela traduz recusa POR NOME (pauta-gramatica.ts).
-- 3. Grants de coluna OBRIGATÓRIOS: a 20260801000100 revogou INSERT/UPDATE de
--    tabela e concedeu coluna a coluna — coluna nova nasce sem grant nenhum, e
--    sem as linhas abaixo a admin veria `permission denied` no formulário.
-- 4. As duas colunas são da mão HUMANA. NADA para service_role: o robô mede
--    (metricas/medido_em), não classifica cadastro.
-- 5. Cinto do PUBLIC (achado 6): o Postgres não dá DML de tabela a PUBLIC por
--    padrão, mas revogar custa nada e o guard passa a cobrar INSERT de tabela
--    ausente para todo papel.
-- 6. Guards de teste em tests/pauta-fabrica.test.ts (parte 3) nasceram
--    VERMELHOS antes deste arquivo (regra 7), incluindo o catálogo coluna a
--    coluna e o domínio EXATO dos CHECKs por pg_get_constraintdef.
-- 7. Conferência pós-apply em produção (rejeição fundamentada do achado 4: o
--    harness local não representa upgrade path — `db reset` aplica tudo antes
--    da suíte): query no rito de deploy confere 20 linhas tipo='criador',
--    tier NULL e os updates correspondentes no audit_log.
-- =============================================================================

alter table content_creators
  add column tipo text
    constraint content_creators_tipo_check check (tipo in ('criador', 'empresa')),
  add column tier text
    constraint content_creators_tier_check
    check (tier is null or tier in ('grande', 'media', 'nicho'));

-- Backfill AUDITÁVEL (nota 1): quem já estava no cadastro É criador — fato
-- decidido pelo dono, não palpite de faixa (tier continua NULL de propósito).
update content_creators set tipo = 'criador' where tipo is null;

alter table content_creators
  alter column tipo set default 'criador',
  alter column tipo set not null;

comment on column content_creators.tipo is
  'criador (pessoa) ou empresa (conta de marca). Quem classifica é a mão '
  'humana; o worker só lê.';

comment on column content_creators.tier is
  'Faixa de alcance: grande, media ou nicho. NULL = sem classificação — '
  'estado legítimo até alguém olhar a conta (zero palpite, régua do M4).';

-- A descrição agregada da tabela é reemitida COM as colunas novas (achado 9):
-- ela enumera a mão humana, e uma enumeração incompleta mentiria sobre tipo/tier.
comment on table content_creators is
  'Criadores de referência da pauta de conteúdo (M4/ADR-031): de quem a pesquisa '
  'aprende. A admin cadastra e cura (plataforma, handle, nome, mercado BR/INT, '
  'notas, ativo, tipo criador|empresa, tier de alcance); o worker de pesquisa '
  'escreve APENAS metricas+medido_em, por grant de coluna. metricas é snapshot '
  'SUBSTITUÍDO, com {} + carimbo significando "mediu e não achou nada". DELETE '
  'proibido (Lei 8): desative.';

-- Cinto do PUBLIC (nota 5), antes dos grants cirúrgicos.
revoke insert, update, delete, truncate on content_creators from public;

-- Mão humana (padrão duas mãos do M4 — ver nota 3).
grant insert (tipo, tier) on content_creators to authenticated;
grant update (tipo, tier) on content_creators to authenticated;

-- Reload do schema cache do PostgREST (achado 3): redundante onde o watcher de
-- DDL existe, inofensivo onde não existe.
notify pgrst, 'reload schema';
