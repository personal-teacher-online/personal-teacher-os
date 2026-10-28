# ADR-002 — Contrato aponta para aluno OU grupo (XOR)

**Contexto.** O blueprint tem `contracts.student_id` simples e, separadamente, `student_groups`; o casal Natália+Yago compartilha um único contrato.

**Decisão.** `contracts` ganha `student_group_id` e a constraint `CHECK ((student_id IS NULL) <> (student_group_id IS NULL))` — exatamente um preenchido. Membros do grupo via `student_group_members` do blueprint.

**Consequência.** Um contrato de casal é uma linha só (uma cobrança, um saldo de créditos — ver ADR-001). Joins que hoje assumem `student_id` precisam considerar o caminho via grupo (funções do M2 e policies do M5 tratam os dois casos).
