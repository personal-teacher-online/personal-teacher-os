# ADR-013 — Semânticas pinadas no M1 da Fase 2 (janelas, matriz D2, slots)

**Contexto.** M1 entregou as migrations 20260712000100–000500. O painel adversarial do
gate (15 agentes, 4 lentes × júri) confirmou 6 achados — todos corrigidos antes da
aprovação. Este ADR pina as semânticas decididas na implementação e nas correções.

**Decisões.**
1. **`reschedule_class_at` (nome distinto, não overload).** A D1 (ii) sugeria overload de
   `reschedule_class`; overload homônimo criou ambiguidade real de resolução com literais
   sem tipo (o Postgres escolhia a função errada). A variante por instante tem nome
   próprio, é interna (EXECUTE revogado) e concentra TODA a orquestração; a assinatura
   original virou conversor fino — comportamento da Fase 1 intacto.
2. **Zona de instância cobre contrato de GRUPO** (achado major do painel): o resgate D12
   cria a primeira instância sem slot e sem cadeia; `class_instance_tz` ganhou terceiro
   fallback via `student_group_members` (membros do casal = mesmo domicílio; `min()` =
   determinístico). Sem isso, cancelar/re-remarcar a aula resgatada do casal quebrava.
3. **Cancelamento retroativo permitido quando o AVISO precedeu a aula** (achado do
   painel): a D2 decide o efeito por `notified_at × starts × min_notice`, não pelo
   momento do registro — a dona pode registrar depois da aula. Aviso inexistente ou
   pós-início continua sendo no-show.
4. **Caso 16 ancorado na professora da INSTÂNCIA** (D1 literal); divergência
   instância×contrato (admin trocou `teacher_id`?) falha cedo com mensagem explícita.
5. **Resgate D12:** sempre consome crédito (sem alçada — não há aula sendo movida), sem
   exigência de aviso mínimo, duração = a do slot ativo do contrato (exceção clara se
   não houver). Janela consumida aponta `consumed_by_instance_id` (rastro Lei 8).
6. **Janela de 2 semanas avaliada NO CONSUMO** (D1): publicar além disso é permitido —
   a janela fica "latente" até entrar no horizonte.
7. **Zona da publicação da janela**: professoras não têm fuso próprio no schema; default
   = `business_tz()` com override explícito `p_iana_tz` (revisitar se uma professora
   operar de outro fuso).
8. **Slots (D8/item 6c):** `create_slot` e `close_and_create_slot` admin-only;
   fechar-e-criar cancela futuras SEM crédito (mudança acordada ≠ matriz D2) e
   materializa na mesma transação. **Adendo (M2):** a materialização das RPCs é
   POR-SLOT (`materialize_slot`, migration 000700) — a varredura global sob demanda
   deadlockava com transações concorrentes; `materialize_instances` global ficou
   exclusiva do cron, serializada por advisory lock.

**Consequência.** Casos 5–8, 10, 15–17, 20 + resgate/casal/slots cobertos por testes
(suíte 114/114, 2× consecutivas). Produção recebe as migrations junto com o deploy do
app (após o item F do runbook).

**Adendo (Fase 3 / M6, 12/07/2026) — §7 revisitado pela F3-D2:** professoras GANHARAM
fuso próprio (`teachers.iana_tz`, migration 20260713000100; a dona = Cuiabá, a professora
= São Paulo — Q1). É a fonte ÚNICA do fuso operacional da professora: painel /teacher,
caminho teacher das RPCs de janela e e-mails leem dela; o provisionamento/vínculo
espelha em `profiles.iana_tz`. O DEFAULT do caminho ADMIN de
`publish_reschedule_window` também passou a ser `teachers.iana_tz` (confirmado pelo
mantenedor no gate do M0 — adendo 1 do goal da Fase 3); `p_iana_tz` segue como override
exclusivo da admin. O texto original do §7 fica superado.
