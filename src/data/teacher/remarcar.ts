// CARREGADOR DA TELA DE REMARCAR DA PROFESSORA (M2 · A6 do gate Sol).
//
// Antes a página consultava inline e tratava QUALQUER falha de leitura como
// "conta não vinculada" ou 404: um erro de rede/banco virava mentira sobre a
// conta ou sobre a aula. Aqui os quatro desfechos são distintos e a página só
// os pinta:
//   · sem_sessao     — a sessão venceu (a página manda para o login);
//   · sem_vinculo    — leu e a conta não é de uma professora;
//   · nao_encontrada — leu e a aula não existe OU é de outra professora (404);
//   · erro           — a LEITURA falhou (nada se sabe sobre conta nem aula);
//   · ok             — professora + aula.
//
// A POSSE continua sendo da view `teacher_agenda` (filtra por my_teacher_id()
// no banco): aula de outra professora volta como "não encontrada".
// Recebe o cliente por parâmetro (sem `server-only`): testável com um falso.

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O supabase-js devolve `AuthSessionMissingError` (status 400, sem sessão) quando não há cookie. */
function ehSessaoAusente(e: { name?: string; status?: number; message: string }): boolean {
  return (
    e.name === 'AuthSessionMissingError' ||
    e.status === 401 ||
    e.status === 403 ||
    /session (from session )?missing|jwt|refresh token/i.test(e.message)
  )
}

export interface ProfessoraDaRemarcacao {
  id: string
  iana_tz: string | null
  display_name: string | null
}

export interface AulaDaRemarcacao {
  id: string
  starts_at_utc: string
  ends_at_utc: string
  state: string
  local_time_snapshot: string | null
  student_label: string | null
}

export type CarregamentoDaRemarcacao =
  | { tipo: 'sem_sessao' }
  | { tipo: 'sem_vinculo' }
  | { tipo: 'nao_encontrada' }
  | { tipo: 'erro' }
  | { tipo: 'ok'; professora: ProfessoraDaRemarcacao; aula: AulaDaRemarcacao }

export async function carregarRemarcacao(
  supabase: SupabaseClient,
  instanceId: string,
): Promise<CarregamentoDaRemarcacao> {
  // Endereço que nem é um id: 404 de verdade, sem gastar leitura (e sem o erro
  // de sintaxe de uuid do Postgres virar "falha de leitura").
  if (!UUID.test(instanceId)) return { tipo: 'nao_encontrada' }

  const {
    data: { user },
    error: erroSessao,
  } = await supabase.auth.getUser()
  if (!user) {
    // "Sem sessão" é a AUSÊNCIA de sessão (cookie sumiu/venceu). Um erro de outra
    // natureza (GoTrue fora do ar, rede) não prova que a sessão acabou: mandar
    // ao login quem está logada seria mentir — é falha de leitura.
    if (erroSessao && !ehSessaoAusente(erroSessao)) {
      console.error('[remarcar · leitura da sessão falhou]', erroSessao.message)
      return { tipo: 'erro' }
    }
    return { tipo: 'sem_sessao' }
  }

  // A própria professora — filtro EXPLÍCITO por auth.uid() (a dona é admin
  // vinculada; `limit(1)` pegaria qualquer linha).
  const { data: professora, error: erroProfessora } = await supabase
    .from('teachers')
    .select('id, iana_tz, display_name')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (erroProfessora) {
    console.error('[remarcar · leitura da professora falhou]', erroProfessora.message)
    return { tipo: 'erro' }
  }
  if (!professora) return { tipo: 'sem_vinculo' }

  const { data: aula, error: erroAula } = await supabase
    .from('teacher_agenda')
    .select('id, starts_at_utc, ends_at_utc, state, local_time_snapshot, student_label')
    .eq('id', instanceId)
    .maybeSingle()
  if (erroAula) {
    console.error('[remarcar · leitura da aula falhou]', erroAula.message)
    return { tipo: 'erro' }
  }
  if (!aula) return { tipo: 'nao_encontrada' }

  return { tipo: 'ok', professora, aula }
}
