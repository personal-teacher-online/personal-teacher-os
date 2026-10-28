-- Briefing v2 — FLIP DO DEFAULT (sub-lote 2 da onda do Portal, 28/07/2026).
--
-- A migration do núcleo (20260728000100) deixou `briefings.schema_version` com
-- default 1 de propósito: o banco chegou antes da UI, e o briefing é BLOQUEANTE
-- no primeiro acesso — carimbar 2 antes das telas v2 existirem prenderia o aluno
-- novo numa tela que não consegue satisfazer a validação v2.
--
-- Esta migration acompanha a coleta v2 (dicionário + telas ramificadas por
-- students.student_type): a partir daqui linha NOVA nasce 2 e submete pela regra
-- ramificada. Linha já existente continua com o carimbo que tem — rascunho
-- começado na tela v1 termina no v1, sem backfill.
--
-- Lei 7: migration nova; a 20260728000100 não foi tocada.

alter table public.briefings alter column schema_version set default 2;

comment on column public.briefings.schema_version is
  'Versão do questionário sob a qual a linha foi COLETADA. 1 = briefing original '
  '(19/07); 2 = briefing v2 (ramo criança/adulto, 8 perguntas novas). A regra de '
  'obrigatoriedade do envio é escolhida por esta coluna — rascunho começado no v1 '
  'termina no v1. DEFAULT 2 desde 28/07 (sub-lote 2 da onda do Portal): a UI v2 '
  'entrou junto, então linha nova nasce já na régua nova.';
