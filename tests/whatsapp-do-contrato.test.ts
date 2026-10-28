// CORREÇÃO 28/07/2026 — o WhatsApp de avisos é canal de CONTRATO, não opt-in.
//
// Regra do dono: o contrato externo já autoriza os avisos por WhatsApp desde o
// início. Logo o número nasce com a professora (no CONVITE, obrigatório) e o
// aluno apenas TROCA no portal — nunca apaga.
//
// A regra que estes testes protegem: **quem tem acesso ao portal tem número**.
// Depois da rodada do Sol ela passou a valer no PROVISIONAMENTO inteiro (o
// perfil nasce com o número; o reenvio grava ANTES do e-mail) e os dois fluxos
// de reenvio recusam aluno sem número em vez de contornar.
//
// ONDE ELA MORA (portão de deploy 29/07): no TypeScript. O banco tem a régua de
// FORMATO (CHECK E.164, que aceita NULL) e as duas portas transacionais
// (nascimento e troca), mas nenhum gatilho proíbe perfil de aluno sem número —
// endurecimento roteado para o A6. Chamá-la de "invariante estrutural", como
// dizia este cabeçalho, era mentira.
//
// ⚠️ REESCRITO NA RODADA DO SOL: a primeira versão era varredura textual — a
// pior asserção cobrava a ORDEM de `if (!phone)` × `provisionStudent(` no
// fonte, que um refactor inocente quebraria e um bug real atravessaria. Agora a
// espinha é COMPORTAMENTAL, no padrão que `onda-agenda-a1.test.ts` estabeleceu:
// clientes falsos que GRAVAM as chamadas + asserção no que foi enviado. A
// varredura de fonte sobrou onde ela é o instrumento certo (anatomia de
// formulário, fronteira da migration). A recusa do BANCO é cobrada contra o
// Postgres em `tests/f7-cadastro-lgpd.test.ts` (Lei 3: a regra mora lá).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import type { ComponentProps, FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Field } from '@/components/ui'
import { CountryPhoneField } from '@/components/CountryPhoneField'

/* ========================================================================== */
/* Mocks das ACTIONS (partes 2 e 3) — o provisionador vira gravador            */
/* ========================================================================== */

const mock = vi.hoisted(() => ({
  /** cada chamada a provisionStudent: [studentId, email, actorId, whatsapp] */
  provisoes: [] as Array<[string, string, string | null, string | undefined]>,
  desfecho: { status: 'invited', userId: 'u-novo' } as Record<string, unknown>,
  /** respostas por tabela do admin client falso das actions */
  respostas: {} as Record<string, { data?: unknown; error?: { message: string } | null }>,
  usuarioDoAuth: null as { id: string; email?: string } | null,
  respostaRpc: { data: null as unknown, error: null as { message: string } | null },
}))

/** O `redirect` do Next lança; aqui ele lança ISTO, e o teste lê a URL. */
const { Redirecionou } = vi.hoisted(() => {
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return { Redirecionou }
})

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
}))
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/auth/provision', () => ({
  provisionStudent: async (
    _admin: unknown,
    studentId: string,
    email: string,
    actorId: string | null,
    whatsapp?: string,
  ) => {
    mock.provisoes.push([studentId, email, actorId, whatsapp])
    return mock.desfecho
  },
}))
vi.mock('@/lib/supabase/admin', () => {
  const consulta = (tabela: string) => {
    const resultado = async () => ({
      data: (mock.respostas[tabela] ?? { data: null }).data ?? null,
      error: (mock.respostas[tabela] ?? { data: null }).error ?? null,
    })
    const cadeia = {
      select: () => cadeia,
      eq: () => cadeia,
      single: resultado,
      maybeSingle: resultado,
    }
    return cadeia
  }
  return {
    createAdminClient: () => ({
      from: consulta,
      auth: {
        admin: {
          getUserById: async () =>
            mock.usuarioDoAuth
              ? { data: { user: mock.usuarioDoAuth }, error: null }
              : { data: { user: null }, error: { message: 'não achei' } },
        },
      },
      rpc: async () => ({ data: mock.respostaRpc.data, error: mock.respostaRpc.error }),
    }),
  }
})

const { inviteStudentAction, resendInviteAction } = await import('@/app/admin/alunos/actions')
const { resendMyInviteAction } = await import('@/app/convite-expirado/actions')
// O provisionador REAL, por fora do mock — é ele que a parte 1 exercita.
const { provisionStudent: provisionReal } =
  await vi.importActual<typeof import('@/lib/auth/provision')>('@/lib/auth/provision')

beforeEach(() => {
  mock.provisoes = []
  mock.desfecho = { status: 'invited', userId: 'u-novo' }
  mock.respostas = {}
  mock.usuarioDoAuth = null
  mock.respostaRpc = { data: null, error: null }
})

function form(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor)
  return fd
}

/** Roda a action e devolve a URL do redirect (que no Next é um throw). */
async function rodar(acao: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return decodeURIComponent(e.url)
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

/* ========================================================================== */
/* 1. O contrato do PROVISIONAMENTO — o número é parte dele, não um posfácio    */
/* ========================================================================== */

/**
 * Cliente falso do MOTOR (`provisionPerson`): grava o payload do insert do
 * perfil, os updates de whatsapp, os convites enviados, os users criados e
 * apagados e as linhas de auditoria — é nessas gravações que o contrato se
 * prova. Rodada 2 do Sol (achado 6): o falso passou a saber FALHAR de verdade
 * (createUser com e-mail já usado, insert de perfil quebrando, update sem
 * linha, convite recusado), porque contrato prometido em comentário e nunca
 * exercitado é contrato que um refactor quebra em silêncio.
 */
function clienteDoMotor(cfg: {
  aluno?: Record<string, unknown>
  usuario?: { id: string; email: string; email_confirmed_at: string | null } | null
  /** linha devolvida por `profiles.select(...).maybeSingle()` — a guarda do
   *  motor (perfil existente sem número no argumento) e a checagem de órfão
   *  leem daqui. `undefined`/`null` = não existe linha. */
  perfil?: Record<string, unknown> | null
  /** a LEITURA de `profiles` falhando (não "linha ausente"): o fail-closed do
   *  motor — "não sei se tem número" não pode virar "tem". */
  erroNaLeituraDePerfil?: string
  /** auth user já existente com o e-mail do convite: `createUser` falha com
   *  `email_exists` e o `listUsers` o encontra (o cenário da ADOÇÃO). */
  orfao?: { id: string; email: string } | null
  /** QUALQUER RPC do provisionamento devolvendo erro — a troca
   *  (`admin_update_student_whatsapp`, rodada 3) e, desde o portão de deploy de
   *  29/07, também o NASCIMENTO (`admin_create_student_profile`). */
  erroNaRpc?: string
  erroNoConvite?: string
}) {
  const gravado = {
    perfilInserido: null as Record<string, unknown> | null,
    /** cada chamada de RPC: [função, argumentos] */
    rpcs: [] as Array<[string, Record<string, unknown>]>,
    convites: [] as string[],
    criados: [] as string[],
    apagados: [] as string[],
    adotados: [] as string[],
    audits: [] as Record<string, unknown>[],
  }
  const aluno = cfg.aluno ?? {
    id: 's1',
    display_name: 'Sabrina Teste',
    iana_tz: 'America/Cuiaba',
    profile_id: null,
    status: 'active',
    anonymized_at: null,
  }
  const cliente = {
    from(tabela: string) {
      if (tabela === 'students') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: aluno, error: null }) }) }),
          update: () => ({
            eq: () => ({
              is: () => ({ select: async () => ({ data: [{ id: aluno.id }], error: null }) }),
            }),
          }),
        }
      }
      if (tabela === 'profiles') {
        return {
          // Só a PROFESSORA nasce por aqui desde o portão de 29/07 — o aluno
          // nasce pela RPC. O gravador fica para que `perfilInserido` seja
          // prova NEGATIVA no caminho do aluno.
          insert: async (payload: Record<string, unknown>) => {
            gravado.perfilInserido = payload
            return { error: null }
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                cfg.erroNaLeituraDePerfil
                  ? { data: null, error: { message: cfg.erroNaLeituraDePerfil } }
                  : { data: cfg.perfil ?? null, error: null },
            }),
          }),
        }
      }
      if (tabela === 'audit_log') {
        return {
          insert: async (linha: Record<string, unknown>) => {
            gravado.audits.push(linha)
            return { error: null }
          },
        }
      }
      throw new Error(`consulta inesperada: ${tabela}`)
    },
    // Rodada 3: a gravação em perfil EXISTENTE é uma RPC transacional
    // (update + audit com ator numa transação só) — o gravador registra a
    // chamada inteira, porque o CONTRATO agora é "chamou a RPC certa com o
    // ator certo", não "fez um UPDATE e depois um insert de audit".
    rpc: async (fn: string, args: Record<string, unknown>) => {
      gravado.rpcs.push([fn, args])
      return cfg.erroNaRpc
        ? { data: null, error: { message: cfg.erroNaRpc } }
        : { data: null, error: null }
    },
    auth: {
      admin: {
        createUser: async (attrs: { email: string }) => {
          if (cfg.orfao) {
            // o formato real do GoTrue: erro com `code` discriminável
            return {
              data: { user: null },
              error: { message: 'A user with this email address has already been registered', code: 'email_exists' },
            }
          }
          gravado.criados.push(attrs.email)
          return { data: { user: { id: 'user-novo' } }, error: null }
        },
        getUserById: async () =>
          cfg.usuario
            ? { data: { user: cfg.usuario }, error: null }
            : { data: { user: null }, error: { message: 'não existe' } },
        inviteUserByEmail: async (email: string) => {
          gravado.convites.push(email)
          return cfg.erroNoConvite ? { error: { message: cfg.erroNoConvite } } : { error: null }
        },
        deleteUser: async (id: string) => {
          gravado.apagados.push(id)
          return { error: null }
        },
        updateUserById: async (id: string) => {
          gravado.adotados.push(id)
          return { data: {}, error: null }
        },
        listUsers: async () => ({
          data: {
            users: cfg.orfao ? [{ id: cfg.orfao.id, email: cfg.orfao.email, app_metadata: {} }] : [],
          },
          error: null,
        }),
      },
    },
  }
  return { cliente: cliente as unknown as SupabaseClient, gravado }
}

describe('provisionamento — o perfil do aluno NASCE com o número', () => {
  it('convite novo: o perfil nasce pela RPC transacional, com o número e o ATOR', async () => {
    const { cliente, gravado } = clienteDoMotor({})
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('invited')
    // PORTÃO DE DEPLOY 29/07 (bloqueador 2): o contrato deixou de ser "INSERT em
    // TS com o número no payload" — porque a auditoria com ator ficava numa
    // chamada separada e fail-open — e passou a ser UMA chamada transacional,
    // com o ator dentro dela (o mesmo desenho da troca).
    expect(gravado.rpcs).toEqual([
      [
        'admin_create_student_profile',
        {
          p_profile: 'user-novo',
          p_full_name: 'Sabrina Teste',
          p_iana_tz: 'America/Cuiaba',
          p_e164: '+5565999990000',
          p_actor: 'admin-1',
        },
      ],
    ])
    // …e o INSERT direto em `profiles` MORREU no caminho do aluno: se ele
    // voltar, a trilha do nascimento volta a poder sumir.
    expect(gravado.perfilInserido).toBeNull()
    expect(gravado.convites).toEqual(['sabrina@x.com'])
    // Achado 3 (rodada 2): o diff do audit de convite carrega o número — a
    // trilha "de onde veio este número" começa no nascimento do perfil.
    const convite = gravado.audits.find((a) => a.action === 'invite_student')
    expect((convite?.diff as Record<string, unknown> | undefined)?.whatsapp_e164).toBe(
      '+5565999990000',
    )
  })

  it('achado 1: chamada DIRETA sem número, aluno sem perfil → recusa antes de criar qualquer coisa', async () => {
    // O buraco da rodada 2: os wrappers exigiam o número, mas
    // `provisionStudent(admin, id, email, actor)` na mão ainda criava
    // usuário + perfil + vínculo sem número e mandava o convite. A invariante
    // é do MOTOR: erro ANTES de qualquer efeito no Auth.
    const { cliente, gravado } = clienteDoMotor({})
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('convite não sai')
    expect(gravado.criados).toHaveLength(0)
    expect(gravado.perfilInserido).toBeNull()
    expect(gravado.convites).toHaveLength(0)
  })

  it('achado 1: perfil existente SEM número no cadastro e sem argumento → recusa sem e-mail', async () => {
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      perfil: { whatsapp_e164: null },
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1')
    expect(r.status).toBe('error')
    expect(gravado.convites).toHaveLength(0)
  })

  it('leitura de profiles FALHANDO dentro do motor → erro, sem e-mail (fail-closed)', async () => {
    // A lacuna da rodada 3: a action de reenvio tinha este teste, o MOTOR não —
    // e a guarda que importa é a dele (chamada direta não passa pela action).
    // "Não sei se tem número" não é "tem": a falha de leitura responde com o
    // próprio nome e NADA sai.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      erroNaLeituraDePerfil: 'rede caiu',
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('rede caiu')
    expect(gravado.convites).toHaveLength(0)
    expect(gravado.rpcs).toHaveLength(0)
  })

  it('adoção de órfão: o nascimento do perfil HERDA o número (o contrato que o comentário promete)', async () => {
    // Órfão = auth user de execução anterior que morreu entre createUser e o
    // vínculo. O caminho de adoção também é CRIAÇÃO de perfil — se ele não
    // herdasse o número, a invariante teria uma porta lateral.
    const { cliente, gravado } = clienteDoMotor({
      orfao: { id: 'orfao-1', email: 'sabrina@x.com' },
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('invited')
    expect(gravado.adotados).toEqual(['orfao-1']) // o papel foi re-carimbado
    expect(gravado.rpcs).toEqual([
      [
        'admin_create_student_profile',
        {
          p_profile: 'orfao-1',
          p_full_name: 'Sabrina Teste',
          p_iana_tz: 'America/Cuiaba',
          p_e164: '+5565999990000',
          p_actor: 'admin-1',
        },
      ],
    ])
    expect(gravado.perfilInserido).toBeNull()
    expect(gravado.convites).toEqual(['sabrina@x.com'])
  })

  it('nascimento do perfil FALHANDO: o rollback via deleteUser desfaz tudo junto', async () => {
    // A frase "o rollback existente desfaz tudo junto" tem prova: falhou o
    // perfil → o user recém-criado morre e o convite nunca sai. Desde o portão
    // de 29/07 a falha vem da RPC do nascimento (é ela quem grava), e a recusa
    // de ATOR NULO dentro dela cai exatamente por aqui.
    const { cliente, gravado } = clienteDoMotor({ erroNaRpc: 'ator obrigatório para cadastrar o WhatsApp de um aluno' })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', null, '+5565999990000')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('ator obrigatório')
    expect(gravado.apagados).toEqual(['user-novo'])
    expect(gravado.convites).toHaveLength(0)
  })

  it('re_invited: RPC falhando SEGURA o e-mail (substitui o antigo teste de audit separado)', async () => {
    // Rodada 3: a gravação virou a RPC transacional — o erro dela (rede,
    // perfil sumido, formato) responde como ERRO e o convite NÃO sai. A ordem
    // é a regra: número ANTES do e-mail; convite enviado com a gravação
    // falhando seria o buraco antigo (acesso sem canal) de volta.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      erroNaRpc: 'rede caiu',
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('rede caiu')
    expect(gravado.convites).toHaveLength(0)
  })

  it('re_invited: com a gravação ok, a RPC levou o ATOR e o e-mail saiu', async () => {
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('re_invited')
    // Rodada 3 (Leis 3+8): o contrato deixou de ser "UPDATE + audit separado"
    // (o audit era fail-open — engolia a falha) e passou a ser UMA chamada
    // transacional, com o ator dentro dela.
    expect(gravado.rpcs).toEqual([
      [
        'admin_update_student_whatsapp',
        { p_profile: 'u-antigo', p_e164: '+5565999990000', p_actor: 'admin-1' },
      ],
    ])
    expect(gravado.convites).toEqual(['sabrina@x.com'])
    // …e o TS não insere mais uma linha própria de audit para a troca: a
    // trilha é a da RPC. Duas linhas para uma escrita seria ruído na leitura.
    expect(gravado.audits.filter((a) => a.action === 'update_student_whatsapp')).toHaveLength(0)
  })

  it('re_invited: perfil sumido responde pela RPC ("perfil não encontrado"), sem e-mail', async () => {
    // O cenário que era o "UPDATE com ZERO linha" mudou de casa: a régua de
    // linha atingida agora é o `if not found` DENTRO da RPC (migration 95, e
    // é lá que f7-cadastro-lgpd a cobra contra o Postgres). Aqui fica a metade
    // do motor: o erro que a RPC devolve NÃO vira sucesso nem solta o convite.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      erroNaRpc: 'perfil não encontrado',
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('perfil não encontrado')
    expect(gravado.convites).toHaveLength(0)
  })

  it('re_invited: número gravado + e-mail falhando → sucesso parcial DESCRITO, com a RPC já rodada', async () => {
    // Achado 3 (rodada 2): a mensagem tem de dizer que o número persistiu e SÓ
    // o e-mail falhou — "falha ao reenviar" seco faria a admin redigitar o
    // número achando que nada gravou. E a trilha do número não depende do
    // e-mail sair: a RPC (que grava E audita) roda ANTES do envio.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      erroNoConvite: 'smtp fora do ar',
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toContain('WhatsApp foi atualizado')
    expect(r.status === 'error' && r.message).toContain('smtp fora do ar')
    expect(gravado.rpcs).toEqual([
      [
        'admin_update_student_whatsapp',
        { p_profile: 'u-antigo', p_e164: '+5565999990000', p_actor: 'admin-1' },
      ],
    ])
  })

  it('already_active feliz: a RPC leva o ATOR e NENHUM e-mail sai (não é reenvio)', async () => {
    // A lacuna da rodada 3: o caminho feliz do "já ativo" só tinha o teste da
    // falha. O contrato dele: o número do formulário atualiza quem já ativou
    // (via RPC, com o ator), e convite NÃO sai — a pessoa já tem acesso.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: '2026-07-01T00:00:00Z' },
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('already_active')
    expect(gravado.rpcs).toEqual([
      [
        'admin_update_student_whatsapp',
        { p_profile: 'u-antigo', p_e164: '+5565999990000', p_actor: 'admin-1' },
      ],
    ])
    expect(gravado.convites).toHaveLength(0)
  })

  it('already_active: falha na gravação vira ERRO visível, não "ativo ✔"', async () => {
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: '2026-07-01T00:00:00Z' },
      erroNaRpc: 'rede caiu',
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1', '+5565999990000')
    expect(r.status).toBe('error')
    expect(gravado.convites).toHaveLength(0)
  })

  it('sem número (reenvios), o motor não toca no perfil que JÁ tem número', async () => {
    // Os reenvios chamam sem número — e a guarda do achado 1 verifica que o
    // PERFIL já o tem (não confia no chamador). Satisfeita a guarda, o
    // parâmetro opcional não pode virar um update de NULL por cima do que
    // existe.
    const { cliente, gravado } = clienteDoMotor({
      aluno: {
        id: 's1',
        display_name: 'Sabrina Teste',
        iana_tz: 'America/Cuiaba',
        profile_id: 'u-antigo',
        status: 'active',
        anonymized_at: null,
      },
      usuario: { id: 'u-antigo', email: 'sabrina@x.com', email_confirmed_at: null },
      perfil: { whatsapp_e164: '+5565999990000' },
    })
    const r = await provisionReal(cliente, 's1', 'sabrina@x.com', 'admin-1')
    expect(r.status).toBe('re_invited')
    expect(gravado.rpcs).toHaveLength(0)
    expect(gravado.convites).toEqual(['sabrina@x.com'])
  })
})

/* ========================================================================== */
/* 2. As actions do admin — a trava é do SERVIDOR                              */
/* ========================================================================== */

describe('inviteStudentAction — sem número, o provisionamento NEM acontece', () => {
  it('recusa convite sem número e não provisiona', async () => {
    const url = await rodar(
      inviteStudentAction,
      form({ student_id: 'aluno-1', email: 'vi@x.com' }),
    )
    expect(url).toContain('Informe o WhatsApp do aluno')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('recusa número fora do E.164 canônico e não provisiona', async () => {
    const url = await rodar(
      inviteStudentAction,
      form({ student_id: 'aluno-1', email: 'vi@x.com', whatsapp_e164: '65900000000' }),
    )
    expect(url).toContain('Número de WhatsApp inválido')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('com número válido, ele viaja DENTRO da chamada de provisionamento', async () => {
    mock.desfecho = { status: 'invited', userId: 'u1' }
    const url = await rodar(
      inviteStudentAction,
      form({ student_id: 'aluno-1', email: 'vi@x.com', whatsapp_e164: '+5565900000000' }),
    )
    // O contrato da correção: nada de update pós-provisionamento — o número é
    // o 5º argumento, e o motor decide onde gravá-lo.
    expect(mock.provisoes).toEqual([['aluno-1', 'vi@x.com', 'admin-de-teste', '+5565900000000']])
    expect(url).toContain('Convite enviado! 🎉 WhatsApp no cadastro.')
  })
})

describe('resendInviteAction — o reenvio não contorna a exigência', () => {
  it('aluno com perfil SEM número: recusa e não provisiona', async () => {
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: { whatsapp_e164: null } },
    }
    const url = await rodar(resendInviteAction, form({ student_id: 'aluno-1' }))
    expect(url).toContain('sem WhatsApp no cadastro')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('leitura do perfil FALHANDO: recusa fail-closed, com a falha pelo nome', async () => {
    // "Não sei se tem número" não é "não tem": mandar a professora preencher um
    // campo que talvez esteja cheio seria mentira — e seguir adiante seria o
    // contorno. A falha fala com o próprio nome e NADA é provisionado.
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: null, error: { message: 'rede caiu' } },
    }
    const url = await rodar(resendInviteAction, form({ student_id: 'aluno-1' }))
    expect(url).toContain('Falha ao ler o cadastro')
    expect(url).toContain('rede caiu')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('aluno com número: o reenvio segue pelo provisionamento de sempre', async () => {
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: { whatsapp_e164: '+5565900000000' } },
    }
    mock.usuarioDoAuth = { id: 'p1', email: 'sabrina@x.com' }
    mock.desfecho = { status: 're_invited', userId: 'p1' }
    const url = await rodar(resendInviteAction, form({ student_id: 'aluno-1' }))
    expect(mock.provisoes).toEqual([['aluno-1', 'sabrina@x.com', 'admin-de-teste', undefined]])
    expect(url).toContain('Convite reenviado.')
  })
})

/* ========================================================================== */
/* 3. O reenvio PÚBLICO (/convite-expirado) — o outro contorno fechado          */
/* ========================================================================== */

describe('resendMyInviteAction — formulário público não cria acesso sem número', () => {
  // Rodada 2 do Sol (achado 2): o desfecho `fale-com-a-escola` MORREU. Ele
  // respondia diferente para "aluno cadastrado sem número" — e resposta
  // diferente num formulário público é enumeração por comportamento. Todos os
  // caminhos que não provisionam caem no MESMO `enviado` neutro (cuja cópia já
  // aponta o balcão humano); a invariante fica intacta porque NADA é
  // provisionado nesses caminhos.
  it('aluno com perfil sem número: resposta neutra, sem provisionar', async () => {
    mock.respostaRpc = { data: 'aluno-1', error: null }
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: { whatsapp_e164: null } },
    }
    const url = await rodar(resendMyInviteAction, form({ email: 'sabrina@x.com' }))
    expect(url).toBe('/convite-expirado?estado=enviado')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('aluno que NUNCA foi convidado: idem — provisionar daqui criaria acesso sem número', async () => {
    mock.respostaRpc = { data: 'aluno-1', error: null }
    mock.respostas = { students: { data: { profile_id: null } } }
    const url = await rodar(resendMyInviteAction, form({ email: 'sabrina@x.com' }))
    expect(url).toBe('/convite-expirado?estado=enviado')
    expect(mock.provisoes).toHaveLength(0)
  })

  it('anti-enumeração COMPORTAMENTAL: aluno sem número e e-mail desconhecido respondem IGUAL', async () => {
    // O teste que substitui o do estado morto: não basta cada caminho ser
    // "neutro" na frase — os dois têm de produzir a MESMA resposta, senão a
    // diferença é o vazamento.
    mock.respostaRpc = { data: 'aluno-1', error: null }
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: { whatsapp_e164: null } },
    }
    const alunoSemNumero = await rodar(resendMyInviteAction, form({ email: 'sabrina@x.com' }))

    mock.respostaRpc = { data: null, error: null }
    mock.respostas = {}
    const desconhecido = await rodar(resendMyInviteAction, form({ email: 'estranho@x.com' }))

    expect(alunoSemNumero).toBe(desconhecido)
    expect(mock.provisoes).toHaveLength(0)
    // e o CÓDIGO da tela/action não tem mais o quarto estado para denunciar a
    // diferença (os comentários contam a história dele — varredura sem eles,
    // como no teste da regex da migration)
    expect(codigo('src/app/convite-expirado/page.tsx')).not.toContain('fale-com-a-escola')
    expect(codigo('src/app/convite-expirado/actions.ts')).not.toContain('fale-com-a-escola')
  })

  it('aluno com número: reenvia como sempre (sem passar número novo)', async () => {
    mock.respostaRpc = { data: 'aluno-1', error: null }
    mock.respostas = {
      students: { data: { profile_id: 'p1' } },
      profiles: { data: { whatsapp_e164: '+5565900000000' } },
    }
    mock.desfecho = { status: 're_invited', userId: 'p1' }
    const url = await rodar(resendMyInviteAction, form({ email: 'sabrina@x.com' }))
    expect(url).toBe('/convite-expirado?estado=enviado')
    expect(mock.provisoes).toEqual([['aluno-1', 'sabrina@x.com', null, undefined]])
  })

  it('e-mail que não é de cliente: resposta NEUTRA de sempre, sem provisionar', async () => {
    // A fronteira anti-enumeração continua inteira: quem não existe recebe o
    // mesmo "enviado" — a checagem do número só acontece para quem existe.
    mock.respostaRpc = { data: null, error: null }
    const url = await rodar(resendMyInviteAction, form({ email: 'estranho@x.com' }))
    expect(url).toBe('/convite-expirado?estado=enviado')
    expect(mock.provisoes).toHaveLength(0)
  })
})

/* ========================================================================== */
/* 4. Varredura de fonte — só onde ela é o instrumento certo                    */
/* ========================================================================== */

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const WIZARD = 'src/app/admin/alunos/novo/AdmissionWizard.tsx'
const PAINEIS = 'src/components/admin/alunos/ficha/paineis.tsx'
const ACTIONS_ADMIN = 'src/app/admin/alunos/actions.ts'
const PERFIL = 'src/app/portal/perfil/page.tsx'
const ACTIONS_PORTAL = 'src/app/portal/actions.ts'
const MIGRATION = 'supabase/migrations/20260728001000_whatsapp_do_contrato.sql'

/** Os dois formulários que CONVIDAM — as únicas portas de entrada do portal. */
const FORMS_DE_CONVITE = [
  { arquivo: WIZARD, id: 'whatsapp-do-novo-aluno' },
  { arquivo: PAINEIS, id: 'whatsapp-do-convite' },
] as const

describe('anatomia dos formulários de convite', () => {
  it.each(FORMS_DE_CONVITE)('o campo do convite em $arquivo é obrigatório', ({ arquivo, id }) => {
    const fonte = codigo(arquivo)
    // O campo existe, com o id que o rótulo aponta (a régua do M3-c4 · B1)…
    expect(fonte).toContain(`id="${id}"`)
    // …e nasce `required`. Prova de mutação: apagar o `required` derruba isto.
    const campo = fonte.slice(fonte.indexOf(`id="${id}"`))
    const fim = campo.indexOf('/>')
    expect(fim, 'o CountryPhoneField deve fechar em />').toBeGreaterThan(0)
    expect(campo.slice(0, fim)).toContain('required')
  })

  it.each(FORMS_DE_CONVITE)('$arquivo não chama mais o número de opcional', ({ arquivo, id }) => {
    // O texto é o que a professora lê: enquanto ele disser "opcional", ela vai
    // pular o campo — e o `required` vira armadilha em vez de regra. A janela é
    // o `<Campo>` DESTE campo: o arquivo tem outros campos legitimamente
    // opcionais (nascimento, "como conheceu"), e varrer o arquivo inteiro
    // transformaria este teste em ruído.
    const fonte = codigo(arquivo)
    const idx = fonte.indexOf(`id="${id}"`)
    const bloco = fonte.slice(fonte.lastIndexOf('<Campo', idx), idx)
    expect(bloco).not.toContain('opcional')
    // e diz o que passou a valer: o aluno TROCA depois, no portal
    expect(bloco).toContain('trocar no portal')
  })
})

describe('no portal o aluno TROCA, não apaga', () => {
  it('o campo do perfil é obrigatório, pré-preenchido e com o rótulo no TELEFONE', () => {
    const fonte = codigo(PERFIL)
    const campo = fonte.slice(fonte.indexOf('<CountryPhoneField'))
    const fim = campo.indexOf('/>')
    expect(fim).toBeGreaterThan(0)
    const aberto = campo.slice(0, fim)
    // pré-preenchido com o que a escola cadastrou E obrigatório
    expect(aberto).toContain('defaultValue=')
    expect(aberto).toContain('required')
    // Achado 8 do Sol: sem `para`→`id`, o rótulo focava o seletor de PAÍS
    // (primeiro rotulável do campo composto) em vez do telefone.
    expect(aberto).toContain('id="whatsapp-do-perfil"')
    expect(fonte).toContain('para="whatsapp-do-perfil"')
  })

  it('a migration faz o BANCO recusar vazio (Lei 3), com chave e não com frase', () => {
    const sql = corpo(MIGRATION)
    expect(sql).toContain('create or replace function public.update_my_whatsapp')
    expect(sql).toContain("raise exception 'whatsapp-obrigatorio'")
    // A chave existe para a action traduzir: frase de banco no portal é jargão.
    expect(codigo(ACTIONS_PORTAL)).toContain("includes('whatsapp-obrigatorio')")
  })

  it('a régua do banco é a MESMA da action — E.164 canônico COM "+"', () => {
    // Achado 4 do Sol: a RPC aceitava `^\+?[0-9]{10,15}$` — passava número sem
    // '+' e até '0000000000', que o driver Evolution e o `splitE164` não sabem
    // ler. As duas portas têm de recusar o MESMO conjunto; o comportamento é
    // cobrado contra o Postgres em f7-cadastro-lgpd.
    // O cabeçalho da migration CITA a regex velha ao contar a história — a
    // varredura negativa vale só para o código, sem os comentários `--`.
    const sqlSemComentario = corpo(MIGRATION).replace(/^\s*--.*$/gm, '')
    const regua = String.raw`^\+[1-9]\d{9,14}$`
    expect(codigo(ACTIONS_ADMIN)).toContain(`/${regua}/`)
    expect(sqlSemComentario).toContain(`'${regua}'`)
    expect(sqlSemComentario).not.toContain(String.raw`\+?`)
  })

  it('update sem linha atingida não é sucesso: exceção ANTES do audit', () => {
    // Achado 5 do Sol: conta autenticada sem perfil recebia "salvo ✔" + registro
    // de auditoria de uma escrita que nunca aconteceu.
    const sql = corpo(MIGRATION)
    const update = sql.indexOf('update profiles set whatsapp_e164')
    const guarda = sql.indexOf('if not found then')
    const audit = sql.indexOf('log_audit')
    expect(update).toBeGreaterThan(0)
    expect(guarda).toBeGreaterThan(update)
    expect(audit).toBeGreaterThan(guarda)
  })

  it('nenhuma mensagem crua do Postgres chega ao aluno neste campo', () => {
    const fonte = codigo(ACTIONS_PORTAL)
    const acao = fonte.slice(fonte.indexOf('export async function updateMyWhatsappAction'))
    const fim = acao.indexOf('export async function updateMyPasswordAction')
    const corpoDaAcao = acao.slice(0, fim > 0 ? fim : undefined)
    // O `Não deu: ${error.message}` que existia aqui era o vazamento.
    expect(corpoDaAcao).not.toContain('${error.message}')
  })

  it('a voz do perfil deixou de pedir permissão — o contrato já deu', () => {
    const tela = corpo(PERFIL)
    expect(tela).not.toContain('Sem número, só por e-mail')
    expect(tela).toContain('É neste número que a escola te avisa')
  })
})

describe('CountryPhoneField — o nome acessível vem do label visível (rodada 4)', () => {
  // WCAG 2.5.3: o aria-label interno tem PRECEDÊNCIA sobre o label visível
  // ligado por htmlFor — a tela mostrava um nome e a tecnologia assistiva
  // anunciava outro. Sem esta regressão coberta, reintroduzir o default no
  // portal restauraria o defeito em silêncio (achado 4 da rodada 4 do Sol).
  it('ariaLabel={null} tira o rótulo interno do NÚMERO e liga a dica por describedby', () => {
    // Rodada 5: as asserções miram o INPUT do telefone, não o HTML inteiro —
    // "não contém o prefixo antigo" deixaria passar um aria-label divergente.
    const telDe = (html: string) => html.match(/<input[^>]*type="tel"[^>]*>/)?.[0] ?? ''
    const sem = renderToStaticMarkup(
      createElement(CountryPhoneField, { name: 'whatsapp_e164', ariaLabel: null }),
    )
    const telSem = telDe(sem)
    expect(telSem).not.toContain('aria-label')
    // …e o describedby do telefone aponta uma dica que EXISTE no documento
    const dicaId = telSem.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(dicaId).toBeTruthy()
    expect(sem).toContain(`id="${dicaId}"`)
    // O default segue nomeando o campo para chamador SEM label externo…
    const com = renderToStaticMarkup(createElement(CountryPhoneField, { name: 'whatsapp_e164' }))
    expect(telDe(com)).toContain('aria-label="Número de WhatsApp')
    // …e o seletor de país tem nome próprio nos DOIS modos.
    expect(sem).toContain('aria-label="País:')
    expect(com).toContain('aria-label="País:')
  })

  it('o perfil do portal usa o modo de label externo', () => {
    const fonte = codigo(PERFIL)
    const campo = fonte.slice(fonte.indexOf('<CountryPhoneField'))
    expect(campo).toContain('ariaLabel={null}')
  })
})

describe('Field — o rótulo do campo composto (achado 5, por RENDER)', () => {
  // O contrato é do COMPONENTE, não dos chamadores: renderizamos o Field de
  // verdade em vez de varrer quem o usa — varredura de chamador não pega um
  // refactor que devolva o embrulho antigo.
  //
  // O filho vai no 3º argumento do createElement (regra react/no-children-prop).
  // A tipagem vem do PRÓPRIO componente (`ComponentProps<typeof Field>`), não de
  // uma cópia manual que apagaria o contrato: o único ajuste é tornar o
  // `children` opcional NAS PROPS — ele é obrigatório no Field, mas chega pelo
  // 3º argumento, posição que o @types/react não desconta do objeto de props.
  type PropsDoField = ComponentProps<typeof Field>
  const renderField = (props: Omit<PropsDoField, 'children'>, filho: PropsDoField['children']) =>
    renderToStaticMarkup(
      createElement(
        Field as FC<Omit<PropsDoField, 'children'> & { children?: PropsDoField['children'] }>,
        props,
        filho,
      ),
    )

  it('com `para`, o htmlFor aponta o controle e o label vira IRMÃO dos filhos', () => {
    const html = renderField(
      { label: 'WhatsApp', para: 'tel-x' },
      createElement('input', { id: 'tel-x' }),
    )
    expect(html).toContain('for="tel-x"')
    // O label FECHA antes do input: o controle não é descendente do rótulo.
    // Antes, um <label htmlFor> que ainda CONTINHA outro rotulável (o botão de
    // país) era HTML inválido/ambíguo para tecnologia assistiva.
    expect(html).toMatch(/<\/label><input/)
  })

  it('sem `para`, o comportamento antigo fica intacto: o label embrulha os filhos', () => {
    const html = renderField({ label: 'Nome' }, createElement('input', { name: 'n' }))
    expect(html).toMatch(/<label[^>]*>[\s\S]*<input[\s\S]*<\/label>/)
    expect(html).not.toContain('for=')
  })
})

describe('a bancada respeita a invariante', () => {
  it('os 3 alunos de preview nascem com número E.164 válido', () => {
    // Varredura simples: se alguém tirar (ou estragar) um dos números de
    // `preview-logins`, a bancada nasceria violando "quem tem portal tem
    // número" — e o portão visual do dono testaria um mundo que não existe.
    const fonte = corpo('scripts/preview-logins.ts')
    const numeros = fonte.match(/'\+\d+'/g) ?? []
    expect(numeros).toHaveLength(3)
    for (const n of numeros) {
      expect(n.slice(1, -1), n).toMatch(/^\+[1-9]\d{9,14}$/)
    }
  })
})

describe('o que a correção NÃO mexeu (fronteira deliberada)', () => {
  it('o admin continua podendo limpar o número pela ficha — agora COM trilha', () => {
    // Ele é dono do dado, precisa corrigir número errado, e há alunos legados
    // sem número nenhum. Travar aqui quebraria a correção de um número errado.
    // Rodada 3: a limpeza continua (`phone || null`), mas viaja pela RPC
    // transacional — vazio vira NULL dentro dela, e a limpeza fica auditada.
    const fonte = codigo(ACTIONS_ADMIN)
    // a janela é SÓ esta action: do seu export até o próximo (outra action
    // ler `profiles` é legítimo; esta escrever direto é que não é)
    const inicio = fonte.indexOf('export async function updateStudentWhatsappAction')
    const fim = fonte.indexOf('export async function', inicio + 1)
    const acao = fonte.slice(inicio, fim > 0 ? fim : undefined)
    expect(acao).toContain('phone || null')
    expect(acao).toContain("rpc('admin_update_student_whatsapp'")
    // Rodada 5: o VALOR importa — `p_actor: null` conteria "p_actor" e a RPC
    // derrubaria todos os salvamentos da ficha sem o teste perceber.
    expect(acao).toContain('p_actor: actorId')
    // o UPDATE direto em profiles morreu desta action (Leis 3+8)
    expect(acao).not.toContain(".from('profiles')")
  })

  it('a migration define exatamente as TRÊS portas — o aluno, a troca e o nascimento', () => {
    // Rodada 3: a porta do admin virou RPC também. Portão de deploy 29/07: o
    // NASCIMENTO ganhou a dele (`admin_create_student_profile`) — a lista
    // continua fechada, e função nova aparecendo aqui é desvio de escopo.
    const sql = corpo(MIGRATION)
    const funcoes = sql.match(/create or replace function public\.(\w+)/g) ?? []
    expect(funcoes).toEqual([
      'create or replace function public.update_my_whatsapp',
      'create or replace function public.admin_update_student_whatsapp',
      'create or replace function public.admin_create_student_profile',
    ])
  })

  it('as portas de SERVIDOR não são executáveis por conta logada (nem anon)', () => {
    // A do aluno é `authenticated`; as duas do servidor, só `service_role`. Sem
    // isto, qualquer conta logada trocaria o número de qualquer perfil — ou
    // criaria perfil de aluno com o papel carimbado pelo banco.
    const sql = corpo(MIGRATION)
    for (const fn of ['admin_update_student_whatsapp', 'admin_create_student_profile']) {
      const revoke = new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated`)
      const grant = new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*to service_role`)
      expect(revoke.test(sql), `${fn}: revoke`).toBe(true)
      expect(grant.test(sql), `${fn}: grant`).toBe(true)
    }
  })
})
