import type { SupabaseClient } from '@supabase/supabase-js'
import { AULA_MAX_MIN, janelaEncosta } from '@/lib/windows'
import { googleBusyForTeacher } from './sync'

// HÁ COMPROMISSO DO GOOGLE NO HORÁRIO QUE A DONA VAI PUBLICAR? (issue #190)
//
// A LEITURA É A MESMA DO PORTAL: `googleBusyForTeacher`, a que
// `availableSlots` usa para tirar da grade da aluna o que cruza a agenda
// pessoal da professora. Não há segunda régua do Google aqui.
//
// O TAMANHO DO HORÁRIO É O DO BANCO. O horário aberto não guarda duração: quem
// o consome é que tem. O portal mede com a aula de cada aluna; aqui ainda não
// há aluna, então vale a medida que o banco dá ao horário aberto desde a issue
// #85 (`teacher_window_span_min`: a maior duração da agenda da professora).
// Com ela o aviso aparece sempre que alguma aluna deixaria de ver o horário;
// uma aluna de aula mais curta pode ainda vê-lo, e o aviso erra para o lado de
// perguntar. Sem medida (professora sem horário fixo nem aula futura) valem os
// 45 minutos que a publicação pela professora já presume (`googleWindowClash`).
//
// FAIL-OPEN, como no portal e no painel da professora: sem Google conectado ou
// com o Google fora do ar não dá para conferir, e a publicação segue. Quem chama
// não pode ler `nao_conferido` como "livre".
//
// A LEITURA TEM TETO DE TEMPO PRÓPRIO. Publicar pelo admin nunca esperou o
// Google; o adaptador repete a chamada com espera crescente quando a conta
// responde 403 ou 429, e isso pode passar de meio minuto. Passado o teto, vale
// `nao_conferido` e a publicação segue.
//
// A leitura alcança até o teto da duração de uma aula (`AULA_MAX_MIN`, o CHECK
// 15..480 do banco): nenhuma medida passa disso.

export type CompromissoAoPublicar = 'ocupado' | 'livre' | 'nao_conferido'

/** A medida presumida quando o banco não tem nenhuma para a professora. */
const MEDIDA_PRESUMIDA_MIN = 45

/** Quanto a publicação espera pelo Google antes de seguir sem conferir. */
const TETO_DA_LEITURA_MS = 4_000

/** `promessa`, ou `null` se ela não responder dentro de `tetoMs`. */
async function comTeto<T>(promessa: Promise<T>, tetoMs: number): Promise<T | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const estouro = new Promise<null>((resolve) => {
    relogio = setTimeout(() => resolve(null), tetoMs)
  })
  try {
    return await Promise.race([promessa, estouro])
  } finally {
    clearTimeout(relogio)
  }
}

export async function compromissoDoGoogleAoPublicar(
  /** cliente do servidor: lê a credencial do Google da professora */
  admin: SupabaseClient,
  /** cliente de quem publica: lê a medida do horário aberto (admin tem a porta) */
  cliente: SupabaseClient,
  teacherId: string,
  instanteUtc: string,
  /** só o teste troca: quanto esperar pelo Google */
  tetoMs: number = TETO_DA_LEITURA_MS,
): Promise<CompromissoAoPublicar> {
  const inicioMs = Date.parse(instanteUtc)
  if (Number.isNaN(inicioMs)) return 'nao_conferido'

  let blocos: { startUtc: string; endUtc: string }[]
  try {
    const busy = await comTeto(
      googleBusyForTeacher(admin, teacherId, {
        fromUtcISO: new Date(inicioMs).toISOString(),
        toUtcISO: new Date(inicioMs + AULA_MAX_MIN * 60_000).toISOString(),
      }),
      tetoMs,
    )
    if (!busy || busy.status !== 'ok') return 'nao_conferido'
    blocos = busy.blocks
  } catch {
    return 'nao_conferido'
  }
  if (blocos.length === 0) return 'livre'

  // A medida só é lida quando há compromisso por perto a conferir. Falhando a
  // leitura, vale a presumida: o aviso é antecipação, não recusa.
  const { data: medida } = await cliente.rpc('teacher_window_span_min', { p_teacher: teacherId })
  const medidaMin =
    typeof medida === 'number' && medida > 0 ? Math.min(medida, AULA_MAX_MIN) : MEDIDA_PRESUMIDA_MIN
  const medidaMs = medidaMin * 60_000

  return blocos.some((b) =>
    janelaEncosta(inicioMs, medidaMs, Date.parse(b.startUtc), Date.parse(b.endUtc)),
  )
    ? 'ocupado'
    : 'livre'
}
