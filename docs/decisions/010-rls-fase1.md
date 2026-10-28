# ADR-010 — Decisões de RLS da Fase 1

**Contexto.** M5 implementou as policies por papel (Lei 4). A verificação cruzada por workflow encontrou 1 vazamento real e lacunas de cobertura, corrigidos antes do gate.

**Decisões.**
1. **Aluno NÃO tem policy de leitura em `teachers`.** RLS é por linha, não por coluna: a policy "aluno vê a professora dos seus contratos" exporia `hourly_rate_cents` e `payment_terms` (custo confidencial do negócio — o que a escola paga à professora terceirizada). O portal (Fase 2) exporá a identidade da professora via **view enxuta** (id, nome) ou coluna a coluna com grants de coluna, decidido lá.
2. **Fase 1 é só-SELECT para não-admin.** Toda escrita de cliente é negada (nenhuma policy de escrita além de `admin_all`); mutações críticas passam exclusivamente pelas funções `SECURITY DEFINER` do M2/M3, cujo `EXECUTE` está revogado de `anon`/`authenticated` — e há teste pinando essa negação (o default do Postgres é `EXECUTE` a PUBLIC em função nova; um `CREATE OR REPLACE` futuro reabriria a porta em silêncio sem o teste).
3. **Subselects de policy que cruzam tabelas usam helpers `SECURITY DEFINER`** (`my_student_ids`, `my_group_ids`, `my_contract_ids`, `my_teacher_id`, `teacher_student_ids`): sem isso, o subselect roda sob o RLS do chamador e ramos silenciosamente somem (a professora não via os membros do casal) ou recursam (policy de `student_group_members` consultando a si mesma).
4. **Grants explícitos** (`SELECT` a anon+authenticated; DML a authenticated) porque o CLI atual não concede DML amplo por default privilege; as POLICIES decidem as linhas; ledgers/audit_log re-revogados por cima (Lei 2/8). Anon sem policy = zero linhas em TODAS as tabelas (teste itera `pg_tables` dinamicamente).

**Consequência.** Casos 10–12 e 26 verdes com provas positivas e negativas; ataque de `user_metadata` forjado e auto-inflação de `completion_pct` (D2) pinados por teste; suíte re-executável sem reset.
