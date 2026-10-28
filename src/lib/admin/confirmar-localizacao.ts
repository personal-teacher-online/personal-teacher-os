// CONFIRMAR A LOCALIZAÇÃO DO ALUNO — o chamador único da RPC (c9 · S3).
//
// Cidade, país e zona IANA são UM dado só: é a cidade que sustenta a zona, e é
// a zona que decide em que instante a aula acontece (Lei 1). Até o c8, gravar
// qualquer um dos dois por `update` de tabela ligava `tz_confirmed` sozinho —
// então gravar só a cidade (com o fuso ainda no palpite herdado da escola)
// confirmava um relógio que ninguém olhou.
//
// Agora confirmar é ATO: `confirm_student_location` grava os três campos e o
// flag na MESMA transação, valida a zona contra `pg_timezone_names` e audita
// (Leis 3 e 8). O gatilho `students_confirm_tz` recusa qualquer outra ligação
// do flag, então este módulo é o único caminho do app.
//
// Sem `server-only` e com o cliente INJETADO pelo mesmo motivo de
// `auth-cleanup.ts`: não há chave nem query aqui, só a tradução do formulário
// para a RPC — e assim a suíte exercita o caminho contra o banco local, com a
// sessão de verdade da admin, sem harness de Next.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Grava cidade + país + fuso do aluno e confirma o fuso.
 *
 * Devolve `{ error }` com a mensagem do banco (que já vem em gente: zona
 * inválida, cidade ausente, aluno inexistente) ou `null` no caminho feliz.
 */
export async function confirmarLocalizacao(
  supabase: SupabaseClient,
  studentId: string,
  city: string,
  country: string,
  ianaTz: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('confirm_student_location', {
    p_student: studentId,
    p_city: city,
    p_country: country || null,
    p_iana_tz: ianaTz,
  })
  return { error: error?.message ?? null }
}
