// TELAS DA PROFESSORA SEM ERRO CRU E SEM RECADO FORJÁVEL (issue #32 · A4 e A6
// do gate Sol do M2). Sem banco: o mapeamento de recusas é puro e o carregador
// recebe o cliente por parâmetro.
//
// · A4: recusa que ninguém mapeou NUNCA mostra o texto do banco (SQL, nome
//   interno, inglês) — vira frase genérica em português, de tom "erro".
// · A4: as ações de cancelar/remarcar não confirmam mais por `?msg=` (link
//   forjado mostrava "Aula remarcada ✅" sem nada ter acontecido).
// · A6: falha de LEITURA na tela de remarcar é "erro", distinto de "conta não
//   vinculada" e de 404.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { carregarRemarcacao } from '@/data/teacher/remarcar'
import { fraseDaRecusa, recusaParaTela, RECUSA_DESCONHECIDA } from '@/data/teacher/recusas'
import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

describe('fraseDaRecusa — texto cru nunca aparece', () => {
  const CRUS = [
    'duplicate key value violates unique constraint "class_instances_pkey"',
    'permission denied for table class_instances',
    'deadlock detected',
    'null value in column "reason" of relation "audit_log" violates not-null constraint',
    'FetchError: fetch failed (ECONNRESET)',
    '',
  ]

  it('erro não mapeado vira a frase genérica, sem uma palavra do original', () => {
    for (const cru of CRUS) {
      const frase = fraseDaRecusa(cru)
      expect(frase, cru).toBe(RECUSA_DESCONHECIDA)
      if (cru) expect(frase).not.toContain(cru)
    }
  })

  it('a frase genérica é português e pinta de erro no toast', () => {
    expect(RECUSA_DESCONHECIDA).not.toMatch(/constraint|violates|permission|denied|error|null/i)
    expect(tomDoAviso(RECUSA_DESCONHECIDA)).toBe('erro')
  })

  it('as recusas que a regra conhece continuam saindo com a frase da dona', () => {
    expect(fraseDaRecusa('aula 5f0e… não é sua')).toBe('Essa aula não é sua.')
    expect(fraseDaRecusa('teacher_reschedule_own_class exige motivo')).toBe(
      'Escreva o motivo — ele vai para a administração.',
    )
    expect(fraseDaRecusa('conflicting key value violates exclusion constraint "teacher_no_overlap"')).toBe(
      'Você já tem aula nesse horário.',
    )
    expect(fraseDaRecusa('a aula já começou')).toBe('Essa aula já começou — registre o desfecho com a administração.')
  })
})

describe('recusas determinísticas dizem o motivo (raise EXATOS das migrations)', () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    [
      'a professora tem este horário reservado por um contrato EM PAUSA (5f0e…) — primeiro dia de choque: 2026-11-03. Retome ou encerre aquele contrato antes de usar o horário',
      'Esse horário é de um contrato em pausa — escolha outro.',
    ],
    ['instância 5f0e7a3c-9b1d-4c2e-8a6f-1d2e3f4a5b6c não existe', 'Essa aula não existe mais.'],
    ['cancel_class só se aplica a contratos private_1on1', 'Essa ação só vale para aulas particulares.'],
    ['janela 5f0e… não existe', 'Essa janela já não existe — recarregue a página.'],
    ['período invertido (2026-11-05 → 2026-11-01)', 'O período está invertido: a data final vem antes da inicial.'],
    [
      'a professora já tem aula marcada nesse horário (2026-11-03 20:00) — nenhum aluno conseguiria reservar essa janela',
      'Você já tem aula marcada nesse horário — nenhum aluno conseguiria reservar essa janela.',
    ],
    [
      'duplicate key value violates unique constraint "reschedule_windows_teacher_slot_uniq"',
      'Você já publicou uma janela nesse horário.',
    ],
    [
      'new row for relation "teacher_weekly_availability" violates check constraint "tw_avail_order"',
      'O fim precisa vir depois do início. Janela que passa da meia-noite: divida em duas.',
    ],
    ['janela semanal 5f0e… não existe', 'Essa janela semanal já não existe — recarregue a página.'],
    ['defina o nível do aluno na ficha antes de gerar o plano', 'Defina o nível do aluno na ficha antes de gerar o plano.'],
    [
      // migration 20261029000100: a janela vem no relógio de quem publicou
      'esse horário encosta no horário publicado para reposição de 2026-11-03 19:00 America/Sao_Paulo — despublique antes ou escolha outro',
      'Esse horário encosta no seu horário de reposição publicado de 03/11 às 19:00 — despublique antes ou escolha outro.',
    ],
  ]
  it('cada uma sai com a frase que explica, nunca a genérica', () => {
    for (const [cru, frase] of casos) {
      expect(fraseDaRecusa(cru), cru).toBe(frase)
      expect(fraseDaRecusa(cru)).not.toBe(RECUSA_DESCONHECIDA)
    }
  })
})

describe('recusaParaTela — o que vai para a tela e o que vai para o log', () => {
  it('não mapeada: genérica na tela, texto cru só no log, tom de erro', () => {
    const log = vi.fn()
    const cru = 'duplicate key value violates unique constraint "x_pkey"'
    const tela = recusaParaTela({ message: cru }, 'Falha ao apontar', log)
    expect(tela).toBe(RECUSA_DESCONHECIDA)
    expect(tela.startsWith('Falha')).toBe(true)
    expect(tela).not.toContain('constraint')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toContain(cru)
    expect(tomDoAviso(tela)).toBe('erro')
  })

  it('mapeada: usa o contexto no lugar de "Falha" e não loga', () => {
    const log = vi.fn()
    expect(recusaParaTela({ message: 'aula não encontrada' }, 'Falha ao apontar', log)).toBe(
      'Falha ao apontar: Essa aula não existe mais.',
    )
    expect(recusaParaTela({ message: 'aula não encontrada' }, undefined, log)).toBe('Falha: Essa aula não existe mais.')
    expect(log).not.toHaveBeenCalled()
  })
})

describe('nada da professora confirma por ?msg= nem mostra erro cru', () => {
  const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
  const ARQUIVOS = [
    'src/app/teacher/actions.ts',
    'src/app/teacher/page.tsx',
    'src/app/teacher/alunos/[contract]/page.tsx',
    'src/app/teacher/remarcar/[instance]/page.tsx',
    'src/app/teacher/google/conectar/route.ts',
    'src/app/teacher/google/callback/route.ts',
  ]

  it('nenhum arquivo produz ou lê `msg` da URL', () => {
    for (const rel of ARQUIVOS) {
      const fonte = ler(rel)
      expect(fonte, rel).not.toMatch(/\bmsg=/)
      expect(fonte, rel).not.toMatch(/\bmsg\?:/)
      expect(fonte, rel).not.toContain('FlashMsg')
    }
  })

  it('o texto cru do erro só aparece em console.*, nunca numa frase para a tela', () => {
    for (const rel of ARQUIVOS) {
      const linhas = ler(rel)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      for (const linha of linhas) {
        if (linha.includes('console.')) continue
        expect(linha, `${rel}: ${linha.trim()}`).not.toMatch(/\.message\b/)
        expect(linha, `${rel}: ${linha.trim()}`).not.toMatch(/\$\{\s*(?:error|err|e)\s*\}|String\((?:error|err|e)\)/)
      }
    }
  })

  it('as ações gravam o desfecho no cookie de flash', () => {
    expect(ler('src/app/teacher/actions.ts')).toContain('gravarFlash(')
    expect(ler('src/app/teacher/google/callback/route.ts')).toContain('cookieDoFlash(')
  })
})

describe('o toast pinta cada desfecho do M2 com o tom certo', () => {
  it('sucesso é verde; e-mail que não saiu e recusa são vermelhos', () => {
    expect(tomDoAviso('Aula cancelada. Os avisos ao aluno e à administração estão a caminho. ✅')).toBe('sucesso')
    expect(tomDoAviso('Aula remarcada. O e-mail ao aluno saiu; os demais avisos estão a caminho. ✅')).toBe('sucesso')
    expect(
      tomDoAviso('Aula remarcada. ⚠️ O e-mail ao aluno não saiu — avise-o por outro canal. A administração recebe o seu motivo.'),
    ).toBe('erro')
    expect(tomDoAviso(`Falha: ${fraseDaRecusa('Essa aula não é sua')}`)).toBe('erro')
  })
})

describe('carregarRemarcacao — a falha de leitura não vira "não vinculada" nem 404', () => {
  const ID = '5f0e7a3c-9b1d-4c2e-8a6f-1d2e3f4a5b6c'
  const PROF = { id: 't1', iana_tz: 'America/Cuiaba', display_name: 'Prof' }
  const AULA = {
    id: ID,
    starts_at_utc: '2099-01-01T12:00:00Z',
    ends_at_utc: '2099-01-01T13:00:00Z',
    state: 'scheduled',
    local_time_snapshot: null,
    student_label: 'Aluno',
  }
  type Resp = { data: unknown; error: { message: string } | null }

  /** Cliente falso: cada tabela devolve a resposta combinada. */
  function falso(porTabela: Record<string, Resp>) {
    const lidas: string[] = []
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (tabela: string) => {
        lidas.push(tabela)
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => porTabela[tabela],
        }
        return chain
      },
    } as unknown as SupabaseClient
    return { client, lidas }
  }

  it('lê as duas e devolve ok', async () => {
    const { client } = falso({
      teachers: { data: PROF, error: null },
      teacher_agenda: { data: AULA, error: null },
    })
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'ok', professora: PROF, aula: AULA })
  })

  it('leu e não há professora: sem_vinculo', async () => {
    const { client } = falso({ teachers: { data: null, error: null }, teacher_agenda: { data: null, error: null } })
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'sem_vinculo' })
  })

  it('leu e a aula não é visível (outra professora): nao_encontrada', async () => {
    const { client } = falso({ teachers: { data: PROF, error: null }, teacher_agenda: { data: null, error: null } })
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'nao_encontrada' })
  })

  it('falha ao ler a professora: erro (e não sem_vinculo)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = falso({
      teachers: { data: null, error: { message: 'connection reset' } },
      teacher_agenda: { data: null, error: null },
    })
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'erro' })
    // o texto cru vai para o log do servidor
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('falha ao ler a aula: erro (e não nao_encontrada)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = falso({
      teachers: { data: PROF, error: null },
      teacher_agenda: { data: null, error: { message: 'timeout' } },
    })
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'erro' })
    spy.mockRestore()
  })

  it('sem usuário na sessão: sem_sessao, sem ler nada', async () => {
    const { lidas } = falso({})
    const semUsuario = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => {
        lidas.push('lida')
        throw new Error('não deveria ler')
      },
    } as unknown as SupabaseClient
    expect(await carregarRemarcacao(semUsuario, ID)).toEqual({ tipo: 'sem_sessao' })
    expect(lidas).toEqual([])
  })

  it('GoTrue fora do ar (user null + erro de rede): erro, não sem_sessao', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = {
      auth: { getUser: async () => ({ data: { user: null }, error: { message: 'fetch failed', status: 502 } }) },
    } as unknown as SupabaseClient
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'erro' })
    spy.mockRestore()
  })

  it('sessão ausente de verdade (AuthSessionMissingError): sem_sessao', async () => {
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 },
        }),
      },
    } as unknown as SupabaseClient
    expect(await carregarRemarcacao(client, ID)).toEqual({ tipo: 'sem_sessao' })
  })

  it('endereço que não é um id: nao_encontrada, sem ler nada', async () => {
    const { client, lidas } = falso({})
    expect(await carregarRemarcacao(client, 'nao-e-uuid')).toEqual({ tipo: 'nao_encontrada' })
    expect(lidas).toEqual([])
  })
})
