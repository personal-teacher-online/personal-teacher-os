-- M1.1 — Extensões
-- pg_cron: agendamento de jobs internos (materialização de instâncias no M3,
-- expiração explícita de créditos em fase futura). Lei 5: pg_cron + pgmq + pg_net;
-- pgmq e pg_net entram na Fase 3 (worker/webhooks), não são necessários na fundação.
create extension if not exists pg_cron;

-- btree_gist: suporte à constraint de EXCLUSÃO por intervalo que impede sobreposição
-- de agenda do professor (ADR-008; complementa o índice único parcial da Lei 3).
create extension if not exists btree_gist;
