# ADR-009 — Saldo FIFO de créditos de reposição e estratégia de locks do M2

**Contexto.** A fórmula ingênua do blueprint (`sum(delta)` ignorando ganhos expirados) tem um artefato: "ganha 1 crédito (expira dia X), gasta 1 antes de X, chega o dia X" → saldo −1, porque o ganho some da soma mas o gasto fica. E o blueprint sugeria job diário de entradas `expire`, que com o filtro da função contaria a expiração duas vezes.

**Decisão.**
1. **`makeup_balance()` com semântica FIFO**: gastos consomem primeiro os créditos que expiram antes; um crédito expirado só reduz o saldo na medida em que NÃO foi consumido antes de expirar. Fórmula: `valid_earns − max(0, spends − expired_earns)`. Sem job de expiração no v1 (a expiração é derivada, como o acúmulo de mentoria — Lei 2); se um dia quisermos entradas `expire` explícitas no ledger, a função de saldo terá que ser revista em conjunto (nunca os dois mecanismos somando).
2. **Locks**: gastos e reservas serializam por **advisory lock transacional por contrato** (`pg_advisory_xact_lock`) — cobre verificação de saldo/etapa dentro da transação sem depender de lock de linhas do ledger (append-only não tem linha "do saldo" para trancar). A disputa por vaga de sessão usa `SELECT ... FOR UPDATE` na linha da sessão. As constraints (CHECK de capacidade, UNIQUE da etapa) permanecem como cinto de segurança se alguma via futura não pegar o lock.
3. **`business_tz()` = `America/Cuiaba`** (função nomeada, um ponto de mudança) para: fim-de-dia de `expires_on`, data-base do acúmulo de janelas e da vigência da mentoria.

**Consequência.** Saldo nunca fica negativo por expiração; o caso de teste 9 e o caso FIFO têm testes dedicados. Concorrência provada nos casos 5 e 23.

---

## Adendo (13/07/2026 — núcleo das Fases 4/5, migration 20260714000400)

O item 2 dizia que as constraints "permanecem como cinto de segurança se alguma
via futura não pegar o lock". Com o estorno de mentoria (goal
`nucleo-fases-4-5.md`), o cinto da etapa (`mentorship_spend_window_uniq`) foi
derrubado — o **protocolo de lock deixa de ser otimização e vira VINCULANTE**
para toda via de escrita do ledger de mentoria:

1. **Exclusão mútua por advisory lock NOMEADO** (chave literal
   `'mentorship_book:'||contract_id` via
   `pg_advisory_xact_lock(hashtextextended(...))`), **não por row lock** — o
   `FOR UPDATE` do book é na SESSÃO (disputa de vaga); quem trava contrato
   `FOR UPDATE` é `reschedule_class` (ledger de reposição, lock diferente).
   TODA via que insere ou anula `booking_spend` (book, refund avulso, cancel de
   sessão, futuros ajustes) adquire ESTE lock antes de qualquer leitura do
   ledger do contrato.
2. **Ordem global de aquisição: SESSÃO (`FOR UPDATE`) primeiro, DEPOIS
   advisory do(s) contrato(s)** — múltiplos contratos em ordem determinística
   (`ORDER BY contract_id`, contra cancel×cancel). `book_mentorship_session`
   foi reescrito nessa ordem (inversão feita antes de existir reserva real);
   `cancel_mentorship_session` trava a sessão primeiro (CONGELA o conjunto de
   reservas ativas) e então adquire os advisories; `refund_mentorship_booking`
   segue a mesma ordem. **NÃO usar contrato→sessão com coleta prévia de
   contract_ids**: a coleta sem lock tem TOCTOU e advisory xact não pode ser
   liberado para retry.
3. **Asserts redundantes DENTRO do lock:** o book verifica gasto líquido 0 da
   etapa escolhida antes de inserir (cinto contra regressão da definição de
   "próxima etapa" — a MENOR com gasto líquido 0, ver adendo ADR-008).

Concorrência coberta pelos casos 9, 13, 14, 17 e 21 do goal núcleo 4/5.
