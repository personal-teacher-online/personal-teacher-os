// A POLÍTICA DA ESCOLA — os três números que valem para TODO contrato.
//
// Item 12 do veredito do e2e: aviso mínimo, validade do crédito de reposição e
// validade do crédito por falha da escola são decisão DA ESCOLA, não de cada
// contrato. Por isso não são campo de formulário em lugar nenhum: os forms não
// os enviam, o servidor grava a constante e o Postgres tem os MESMOS defaults
// (`admin_create_contract`, `admin_renew_contract`, `admin_update_contract_rules`).
// Mandá-los explícitos na chamada é o que deixa a decisão visível no diff.
//
// MUDAR QUALQUER UM DELES É MUDANÇA DE POLÍTICA: vira ADR em `docs/decisions/`
// e um novo valor aqui — NUNCA um campo de tela, nem um número por contrato.
// "Remarcações por mês" (a franquia) continua sendo por aluno e por contrato:
// essa sim é negociação individual, e por isso não mora neste arquivo.
//
// M4-4: até aqui a mesma constante estava declarada TRÊS vezes
// (`admin/contratos/actions.ts`, `admin/alunos/novo/actions.ts`,
// `admin/contratos/novo/actions.ts`). Três cópias de um número que só muda por
// ADR é a receita de a quarta nascer diferente — este módulo é a única
// declaração, e o teste do M4-4 guarda essa unicidade.

export const POLICY = {
  /** horas de antecedência mínimas para remarcar/cancelar pelo portal */
  minNotice: 24,
  /** dias de validade do crédito de reposição comum */
  expiryDays: 90,
  /** dias de validade do crédito quando quem faltou foi a escola (o dobro) */
  schoolFaultDays: 180,
} as const

export type Policy = typeof POLICY
