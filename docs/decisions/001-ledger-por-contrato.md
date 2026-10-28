# ADR-001 — Ledger de créditos chaveado por contrato

**Contexto.** O blueprint (doc 02 §1) chaveia `makeup_ledger` e `makeup_balance()` por `student_id`, mas o casal Natália+Yago compartilha um contrato, um slot e os mesmos créditos — saldo por aluno duplicaria ou dividiria o crédito arbitrariamente.

**Decisão.** O crédito pertence ao **contrato**: `makeup_ledger.contract_id NOT NULL` é a chave do saldo; `student_id` é opcional, apenas para rastrear qual membro do grupo originou a entrada. `makeup_balance(contract_id)` (M2). A mesma chave vale para `mentorship_credit_ledger` (lá `student_id` é NOT NULL porque o contrato de mentoria é individual, mas o saldo continua derivado por contrato — consistência entre os dois ledgers).

**Consequência.** O caso do casal funciona sem duplicação; qualquer futura turma pequena compartilhando contrato herda o comportamento. Consultas de saldo "por aluno" passam a ser "por contrato do aluno".
