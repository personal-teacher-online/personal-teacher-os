# ADR-004 — Validação de `iana_tz` por trigger contra `pg_timezone_names`

**Contexto.** Zonas IANA inválidas quebrariam a materialização timezone-correta (Lei 1). CHECK constraint não pode consultar catálogo, e um CHECK com lista hard-coded fossilizaria o tzdata.

**Decisão.** Função `assert_valid_iana_tz()` + triggers `BEFORE INSERT OR UPDATE OF iana_tz` em `profiles`, `students` e `recurring_slots`, validando contra `pg_timezone_names`.

**Consequência.** Zona inválida é rejeitada na escrita com `check_violation`; novas zonas do tzdata funcionam sem migration. Custo: consulta ao catálogo (~ms) por escrita nessas colunas — irrelevante na escala alvo.
