# ADR-003 — `reschedule_usage` com criação lazy (sem job de reset mensal)

**Contexto.** O blueprint previa job pg_cron mensal para "resetar" a alçada de remarcação.

**Decisão.** Nenhum job: a linha `(contract_id, period_ym)` nasce no primeiro uso do mês, via upsert dentro de `reschedule_class()` (M2), na mesma transação que valida a alçada.

**Consequência.** Menos um job para operar e zero risco de drift entre job e uso; ausência de linha significa "0 usos no mês". O invariante (alçada mensal) permanece idêntico, imposto dentro da transação.
