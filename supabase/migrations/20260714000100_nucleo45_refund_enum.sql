-- Núcleo 4/5 / N1 — valor novo do enum credit_reason, em arquivo PRÓPRIO.
-- Goal: docs/goals/nucleo-fases-4-5.md (N45-D3).
--
-- Este arquivo contém APENAS o ALTER TYPE: o Postgres rejeita USAR um valor de
-- enum adicionado na mesma transação ("unsafe use of new value", 55P04 —
-- confirmado empiricamente no Postgres 17.6 do projeto), e o Supabase CLI roda
-- cada arquivo de migration em uma transação. CHECKs, colunas, triggers e RPCs
-- que usam 'refund' vivem nos arquivos SUBSEQUENTES da série 20260714*.
-- NÃO fundir este arquivo com os demais.

alter type credit_reason add value 'refund';
