// BLOQUEIO DO LOGIN NA ANONIMIZAÇÃO — coordenador puro (revisão adversarial
// nº 4, F2).
//
// O que este módulo é: a sequência `ban → baixa da pendência → registro da
// falha`, com os clientes INJETADOS. Sem `server-only` de propósito — não há
// chave nem query aqui dentro, só ordem e texto, e é isso que permite à suíte
// exercitar os quatro caminhos (ban recusado com registro OK, ban recusado com
// registro falhando, ban OK com baixa falhando, retomada idempotente) sem
// harness de Next e sem Auth de verdade.
//
// O DEFEITO QUE ELE FECHA: as duas actions chamavam
// `admin_report_anonymize_failure` e jogavam fora o `error` — a tela dizia "o
// caso ficou registrado na auditoria" mesmo quando o registro não aconteceu.
// Registro de auditoria que talvez não exista é pior que registro ausente: ele
// convence a dona de que há rastro. Agora, se o registro falhar, a mensagem
// diz isso com todas as letras. A pendência em si NÃO depende deste registro:
// quem garante a retomada é o `auth_cleanup_profile_id` gravado na ficha pela
// própria RPC de anonimização (append da falha é AUDITORIA, não estado).

/** O pedaço do cliente admin que interessa: só o ban do Auth. */
export interface ClienteDeAuthAdmin {
  auth: {
    admin: {
      updateUserById(
        id: string,
        attrs: { email?: string; password?: string; ban_duration?: string },
      ): PromiseLike<{ error: { message: string } | null }>
    }
  }
}

/** O pedaço do cliente de sessão que interessa: só as duas RPCs. */
export interface ClienteDeRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
}

export type ResultadoDoBloqueio =
  | {
      ok: true
      /** a pendência da ficha foi baixada? (`admin_clear_auth_cleanup`) */
      pendenciaBaixada: boolean
      /** motivo, quando a baixa falhou — o ban JÁ está feito */
      erroDaBaixa: string | null
    }
  | {
      ok: false
      /** o que o Auth respondeu */
      falha: string
      /** a falha entrou no registro de auditoria? */
      registrado: boolean
      /** motivo, quando nem o registro passou */
      erroDoRegistro: string | null
    }

/**
 * Destrói o LOGIN de um perfil: ban permanente + credenciais embaralhadas.
 *
 * Deletar `auth.users` é BLOQUEADO pelos FKs do esqueleto (de propósito), então
 * a morte do acesso é esta. Devolve a mensagem da falha, ou `null` no sucesso —
 * o `updateUserById` do supabase-js DEVOLVE `{ error }` em vez de lançar, então
 * o caminho mais provável de falha nem passa pelo `catch`.
 */
export async function destruirLogin(
  admin: ClienteDeAuthAdmin,
  profileId: string,
): Promise<string | null> {
  try {
    const { error } = await admin.auth.admin.updateUserById(profileId, {
      email: `anon-${profileId.slice(0, 8)}@invalid.local`,
      password: crypto.randomUUID() + crypto.randomUUID(),
      ban_duration: '876000h',
    })
    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Ban → e então, conforme o desfecho, baixa da pendência OU registro da falha.
 *
 * Idempotente por construção: o ban é o mesmo em toda tentativa e a pendência
 * só é baixada DEPOIS do sucesso, então clicar de novo é sempre seguro.
 *
 * `prefixoDoDetalhe` distingue a 1ª passagem da retomada no registro de
 * auditoria (é o que permite ler, depois, quantas vezes o Auth recusou).
 */
export async function concluirBloqueioDeLogin(params: {
  admin: ClienteDeAuthAdmin
  db: ClienteDeRpc
  studentId: string
  profileId: string
  prefixoDoDetalhe?: string
}): Promise<ResultadoDoBloqueio> {
  const { admin, db, studentId, profileId, prefixoDoDetalhe = '' } = params

  const falha = await destruirLogin(admin, profileId)
  if (falha) {
    const { error } = await db.rpc('admin_report_anonymize_failure', {
      p_student: studentId,
      p_detail: `${prefixoDoDetalhe}${falha}`,
    })
    return {
      ok: false,
      falha,
      registrado: !error,
      erroDoRegistro: error ? error.message : null,
    }
  }

  const { error } = await db.rpc('admin_clear_auth_cleanup', { p_student: studentId })
  return { ok: true, pendenciaBaixada: !error, erroDaBaixa: error ? error.message : null }
}

/**
 * A frase sobre o RASTRO, que muda com o desfecho do registro. É o coração do
 * F2: "registrado" só pode ser dito quando o registro voltou sem erro.
 */
export function fraseDoRastro(res: Extract<ResultadoDoBloqueio, { ok: false }>): string {
  return res.registrado
    ? 'O caso ficou registrado na auditoria e a pendência continua marcada na ficha.'
    : `A falha do login NÃO pôde ser registrada na auditoria (${res.erroDoRegistro ?? 'motivo desconhecido'}) — ` +
        'mas a pendência continua marcada na ficha, e o botão pode ser clicado de novo.'
}

/** Mensagem da 1ª passagem: a ficha já foi desidentificada, o login não caiu. */
export function mensagemDaAnonimizacaoTravada(
  res: Extract<ResultadoDoBloqueio, { ok: false }>,
): string {
  return (
    `A ficha foi anonimizada, mas o login AINDA está ativo: ${res.falha}. ` +
    'Conclua o bloqueio na ficha (botão “Concluir bloqueio de login”) — a ' +
    `anonimização só está completa depois disso. ${fraseDoRastro(res)}`
  )
}

/** Mensagem da retomada pelo botão da ficha. */
export function mensagemDaRetomadaTravada(
  res: Extract<ResultadoDoBloqueio, { ok: false }>,
): string {
  return (
    `O login AINDA está ativo: ${res.falha}. Tente de novo ou chame o suporte técnico. ` +
    fraseDoRastro(res)
  )
}
