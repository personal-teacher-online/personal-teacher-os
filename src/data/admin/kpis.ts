// CONTRATO DOS 8 NÚMEROS DA HOME (Onda 1 · M1) — schema PURO.
//
// Vive fora de `home.ts` de propósito: aquele arquivo é `server-only` (e tem
// que ser), e este contrato é justamente o que a suíte precisa confrontar com
// o payload REAL da `admin_kpis()`. Mesmo padrão dos núcleos testáveis da casa
// (`lib/telemetry/handle.ts`).
//
// Fonte da fórmula: migration 20260726000100, refinada pela 20260726000300 —
// `definitions_version` 2 (entradas e saídas do mês passaram a cortar em HOJE:
// contrato que começa no futuro não é entrada de agora). Se a FORMA mudar no
// banco sem mudar aqui, o `parse` estoura na leitura — que é o ponto: número
// errado na tela da dona é pior do que tela quebrada. Já a mudança de FÓRMULA
// não estoura nada: ela vira versão nova, e a comparação só cruza pontos da
// mesma versão.
import { z } from 'zod'

const numero = z.coerce.number()

export const AdminKpisSchema = z.object({
  definitions_version: z.number().int(),
  generated_at: z.string(),
  business_date: z.string(),
  month: z.string(),
  week_start: z.string(),
  recebido_no_mes_cents: numero,
  previsto_no_mes_cents: numero,
  previsto_mentoria_cents: numero,
  em_atraso_cents: numero,
  familias_em_atraso: numero,
  alunos_ativos: z.object({
    total: numero,
    particulares: numero,
    travel: numero,
  }),
  aulas_da_semana: z.object({ restantes: numero, total: numero }),
  entradas_saidas_do_mes: z.object({ novos: numero, encerrados: numero }),
  ocupacao_por_professora: z.array(
    z.object({
      teacher_id: z.string(),
      teacher: z.string().nullable(),
      horas_janela: numero,
      horas_ocupadas: numero,
      ocupacao_pct: numero.nullable(),
    }),
  ),
  alunos_por_nivel: z.array(z.object({ nivel: z.string(), alunos: numero })),
})

export type AdminKpis = z.infer<typeof AdminKpisSchema>
