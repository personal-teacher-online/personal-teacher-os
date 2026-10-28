# ADR-007 — Desvios menores dos blueprints (consolidado)

**Contexto.** Ajustes pontuais feitos no M1 que divergem do texto literal dos docs 02/04, agrupados para rastreabilidade sem inflar a pasta de ADRs.

**Decisões.**
1. **`recurring_slots.rrule` omitido.** O blueprint listava a coluna como opcional; a Lei 1 proíbe expansão via rrule através de DST. Coluna não criada — evita o footgun. Se um dia precisar de recorrência não-semanal, nova migration.
2. **`class_instances` ganhou chave de idempotência da materialização (M3).** Originalmente `(slot_id, starts_at_utc)`; a revisão adversarial trocou a identidade da ocorrência para a data civil local — ver ADR-008 item 3 (`UNIQUE (slot_id, occurrence_date)`).
3. **`mentorship_sessions.duration_min` (default 60) adicionado.** O doc 04 não trazia duração; necessária para exibição e para o preço de referência por hora.
4. **RLS habilitado deny-all já no M1** em todas as tabelas (policies no M5). Nascer negado é mais seguro do que habilitar depois (Lei 4, negar por padrão).
5. **Guarda append-only dos ledgers por trigger além do REVOKE.** REVOKE não alcança o owner; os triggers `forbid_mutation()` (UPDATE/DELETE row-level + TRUNCATE statement-level — row triggers não disparam em TRUNCATE) garantem a Lei 2 em qualquer via, e o REVOKE inclui `service_role` (ver ADR-008 item 1).
6. **Tabelas de Fases 2–4 (`payments`, `leads`, `class_audits`, `teacher_statements`) criadas no M1**, conforme aprovado — schema barato agora, migration dolorosa depois. **Inbox de webhooks — avaliado no M6:** NÃO é lacuna dolorosa; `webhook_inbox(source, event_id, payload, ...)` com `UNIQUE(source, event_id)` é tabela nova standalone e entra na Fase 2 junto com o primeiro endpoint (Asaas), sem retrofit.

**Consequência.** Nenhuma mudança de comportamento frente ao especificado; apenas endurecimento de invariantes e antecipação de estrutura estável.
