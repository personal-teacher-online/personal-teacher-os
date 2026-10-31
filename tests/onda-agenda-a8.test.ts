// @vitest-environment jsdom
//
// ONDA DA AGENDA · A8 — a seção Ajustes (/admin/ajustes), quatro blocos.
//
// Na ordem do RISCO, que aqui é diferente do resto da onda: o A8 é a primeira
// tela que muda uma regra que o MOTOR aplica (a antecedência mínima entra em
// `reschedule_class` e em `book_computed_slot`; a política de feriado decide se
// a aula do feriado vira crédito). Por isso a espinha do arquivo é a RPC AO
// VIVO, contra o Postgres local, com prova de mutação nas duas direções:
//
//   1. a faixa é do BANCO, não da tela — 169 horas é recusado, 168 passa, e o
//      valor recusado não encosta na linha da professora;
//   2. o vocabulário da política de feriado é do BANCO;
//   3. ator obrigatório, e ator tem de ser admin de verdade (app_metadata);
//   4. AUDITORIA NA MESMA TRANSAÇÃO, provada pelo caminho de falha: ator sem
//      perfil quebra a FK do `audit_log` e a política NÃO muda. Se o audit
//      fosse uma segunda chamada (o padrão que a Lei 8 proíbe), a política
//      mudaria e a trilha sumiria — e este teste ficaria vermelho;
//   5. `authenticated` não executa a função (o revoke é real, medido pelo
//      PostgREST, não só pelo `grant` no arquivo).
//
// Depois vêm as camadas de cima: a gramática pura (faixa, padrão da escola,
// desvios), o CATÁLOGO de mensagens preso ao registro real do despachante
// (template novo sem entrada = vermelho), a camada de dados com a régua da
// honestidade das integrações (e a varredura de vazamento de segredo), a
// action (recusa sem tocar a RPC, shape da chamada, rascunho fora da URL) e a
// estrutura da tela pela ÁRVORE REAL — mais o stepper montado no DOM, onde se
// cobra a invariante da onda: nada invisível continua clicável.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DateTime } from 'luxon'
import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { anonClient, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createTeacher } from './helpers/db'
import { PoteDeCookies } from './pote-de-cookies'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RAIZ = path.resolve(__dirname, '..')
const codigo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')

/* ========================================================================== */
/* 1. A RPC `admin_set_teacher_policy` — ao vivo                               */
/* ========================================================================== */

describe('A8 · admin_set_teacher_policy (banco)', () => {
  let sql: Sql
  let admin: string
  let teacher: string

  beforeAll(async () => {
    sql = connect(5)
    admin = await createAuthUser(sql, 'admin', 'Admin A8')
    teacher = await createTeacher(sql)
  })
  afterAll(async () => {
    await sql.end()
  })

  /** Chama a RPC como o servidor chama (conexão direta = dona das tabelas). */
  const chamar = (args: {
    teacher?: string | null
    horas?: number | null
    feriado?: string | null
    ator?: string | null
  }) =>
    sql`select public.admin_set_teacher_policy(
      ${args.teacher === undefined ? teacher : args.teacher},
      ${args.horas === undefined ? 24 : args.horas},
      ${args.feriado === undefined ? 'flag' : args.feriado},
      ${args.ator === undefined ? admin : args.ator})`

  const politica = async () => {
    const [row] = await sql`
      select min_booking_lead_hours as horas, holiday_policy as feriado
        from teachers where id = ${teacher}`
    return row as { horas: number; feriado: string }
  }

  const trilhas = async () =>
    (await sql`
      select actor, action, diff from audit_log
       where entity = 'teachers' and entity_id = ${teacher} and action = 'set_teacher_policy'
       order by id`) as unknown as Array<{ actor: string; action: string; diff: Record<string, unknown> }>

  it('grava os dois campos e AUDITA com ator, na mesma transação', async () => {
    await chamar({ horas: 36, feriado: 'cancel_credit' })
    expect(await politica()).toEqual({ horas: 36, feriado: 'cancel_credit' })

    const linhas = await trilhas()
    expect(linhas).toHaveLength(1)
    expect(linhas[0].actor).toBe(admin)
    // o diff conta as DUAS pontas — sem o "de", a trilha não responde o que mudou
    expect(linhas[0].diff).toMatchObject({
      old: { min_booking_lead_hours: 12, holiday_policy: 'flag' },
      new: { min_booking_lead_hours: 36, holiday_policy: 'cancel_credit' },
    })
  })

  it('reenvio SEM mudança não escreve nem deixa trilha (o F5 da dona)', async () => {
    const antes = (await trilhas()).length
    await chamar({ horas: 36, feriado: 'cancel_credit' })
    expect(await politica()).toEqual({ horas: 36, feriado: 'cancel_credit' })
    expect((await trilhas()).length).toBe(antes)
  })

  /* ---- prova de mutação da FAIXA: 168 passa, 169 é recusado --------------- */

  it('168 horas (7 dias) é o teto e PASSA', async () => {
    await chamar({ horas: 168, feriado: 'flag' })
    expect((await politica()).horas).toBe(168)
  })

  it('169 horas é recusado pelo BANCO e a linha não muda', async () => {
    const antes = await politica()
    await expect(chamar({ horas: 169 })).rejects.toThrow(/faixa/i)
    expect(await politica()).toEqual(antes)
  })

  it('antecedência negativa é recusada e a linha não muda', async () => {
    const antes = await politica()
    await expect(chamar({ horas: -1 })).rejects.toThrow(/faixa/i)
    expect(await politica()).toEqual(antes)
  })

  it('zero é válido (é "sem antecedência mínima", não erro)', async () => {
    await chamar({ horas: 0, feriado: 'flag' })
    expect((await politica()).horas).toBe(0)
  })

  it('antecedência ausente é recusada', async () => {
    await expect(chamar({ horas: null })).rejects.toThrow(/antecedência mínima/i)
  })

  /* ---- vocabulário da política de feriado --------------------------------- */

  it('política de feriado fora do vocabulário é recusada, e a linha não muda', async () => {
    const antes = await politica()
    await expect(chamar({ feriado: 'cancelar_tudo' })).rejects.toThrow(/política de feriado/i)
    await expect(chamar({ feriado: '' })).rejects.toThrow(/política de feriado/i)
    await expect(chamar({ feriado: null })).rejects.toThrow(/política de feriado/i)
    expect(await politica()).toEqual(antes)
  })

  it('os dois valores do vocabulário passam', async () => {
    await chamar({ horas: 24, feriado: 'cancel_credit' })
    expect((await politica()).feriado).toBe('cancel_credit')
    await chamar({ horas: 24, feriado: 'flag' })
    expect((await politica()).feriado).toBe('flag')
  })

  /* ---- ator ---------------------------------------------------------------- */

  it('sem ator não grava', async () => {
    const antes = await politica()
    await expect(chamar({ ator: null, horas: 99 })).rejects.toThrow(/ator obrigatório/i)
    expect(await politica()).toEqual(antes)
  })

  it('ator que não é admin não grava (papel lido em app_metadata)', async () => {
    const professora = await createAuthUser(sql, 'teacher', 'Teacher A8')
    const aluna = await createAuthUser(sql, 'student', 'Aluna A8')
    const antes = await politica()
    await expect(chamar({ ator: professora, horas: 99 })).rejects.toThrow(/restrita|admin/i)
    await expect(chamar({ ator: aluna, horas: 99 })).rejects.toThrow(/restrita|admin/i)
    expect(await politica()).toEqual(antes)
  })

  it('professora inexistente é recusada', async () => {
    await expect(chamar({ teacher: '00000000-0000-0000-0000-0000000000ff' })).rejects.toThrow(
      /não encontrada/i,
    )
  })

  /* ---- A PROVA DA MESMA TRANSAÇÃO ----------------------------------------- */

  it('audit que falha DESFAZ a mudança da política (Lei 8: uma transação só)', async () => {
    // Um admin de verdade em `auth.users` (a guarda de papel passa) que NÃO tem
    // linha em `profiles`: a FK `audit_log.actor → profiles.id` estoura no
    // `log_audit`. Se a auditoria fosse uma segunda chamada, a política já teria
    // mudado e ficaria sem dono; como é a mesma transação, tudo volta atrás.
    const [u] = await sql`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at, raw_app_meta_data,
                              confirmation_token, recovery_token, email_change,
                              email_change_token_new, email_change_token_current,
                              phone_change, phone_change_token, reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
              'authenticated', ${'sem-perfil-' + crypto.randomUUID().slice(0, 8) + '@bancada.dev'}, '',
              now(), now(), now(), ${sql.json({ role: 'admin' })},
              '', '', '', '', '', '', '', '')
      returning id`
    const semPerfil = u.id as string

    const antes = await politica()
    await expect(chamar({ ator: semPerfil, horas: 7, feriado: 'cancel_credit' })).rejects.toThrow()
    expect(await politica()).toEqual(antes)
  })

  /* ---- ACL ----------------------------------------------------------------- */

  it('só o service_role executa: public/anon/authenticated foram revogados', async () => {
    const assinatura = 'public.admin_set_teacher_policy(uuid, int, text, uuid)'
    const [priv] = await sql`
      select has_function_privilege('authenticated', ${assinatura}, 'EXECUTE') as autenticado,
             has_function_privilege('anon',          ${assinatura}, 'EXECUTE') as anonimo,
             has_function_privilege('service_role',  ${assinatura}, 'EXECUTE') as servico`
    expect(priv.autenticado).toBe(false)
    expect(priv.anonimo).toBe(false)
    expect(priv.servico).toBe(true)
  })

  it('pelo PostgREST: a porta pública NÃO executa; o service_role executa', async () => {
    // (O cliente com JWT de teste não entra aqui: o `jose` do helper não assina
    // sob jsdom — o revoke de `authenticated` está medido acima, no
    // `has_function_privilege`, que é a fonte da verdade do banco.)
    const publico = anonClient()
    const recusa = await publico.rpc('admin_set_teacher_policy', {
      p_teacher: teacher,
      p_lead_hours: 3,
      p_holiday_policy: 'flag',
      p_actor: admin,
    })
    expect(recusa.error).not.toBeNull()
    expect((await politica()).horas).not.toBe(3)

    const comoServico = serviceClient()
    const ok = await comoServico.rpc('admin_set_teacher_policy', {
      p_teacher: teacher,
      p_lead_hours: 3,
      p_holiday_policy: 'flag',
      p_actor: admin,
    })
    expect(ok.error).toBeNull()
    expect((await politica()).horas).toBe(3)
  })

  /* ---- O SELO: a "porta única" tem de ser única DE VERDADE ---------------- */
  /*
   * Sol · rodada 1 do A8, GRAVE 1. O comentário da migration afirmava ser a
   * única porta de escrita das duas colunas, e era falso: o grant global de
   * 20260711000700 (`grant … update … on all tables … to authenticated`) mais a
   * policy `teachers_admin_all` deixavam a sessão da dona fazer, do navegador,
   *
   *   supabase.from('teachers').update({ min_booking_lead_hours: 10000 })
   *
   * passando por fora do teto, do `for update`, da ação semântica e do diff.
   *
   * Os testes abaixo são a PROVA DE MUTAÇÃO em três direções: o UPDATE direto
   * nas duas colunas é recusado; o UPDATE legítimo nas OUTRAS colunas continua
   * passando (senão o selo teria quebrado o cadastro de professora); e a RPC
   * continua gravando. Tirar o `revoke`/`grant` da migration derruba o primeiro;
   * selar demais derruba o segundo.
   */
  describe('A8 · o selo das duas colunas (grave 1)', () => {
    /**
     * Escreve como o PostgREST escreveria: papel `authenticated` + o claim de
     * ADMIN (senão quem recusaria seria a RLS, e o teste provaria outra coisa).
     * A transação é abortada pela exceção, então a recusa não deixa resíduo.
     */
    // O `sub` é o admin REAL criado no beforeAll: o gatilho `teachers_audit`
    // grava em `audit_log` com `auth.uid()`, e a FK do ator exige perfil.
    const comoNavegador = async (set: string): Promise<{ erro: string | null; linhas: number }> => {
      const claims = JSON.stringify({ sub: admin, app_metadata: { role: 'admin' } })
      try {
        let linhas = 0
        await sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims}, true)`
          await tx`set local role authenticated`
          const r = await tx.unsafe(
            `update public.teachers set ${set} where id = '${teacher}'`,
          )
          linhas = r.count
        })
        return { erro: null, linhas }
      } catch (e) {
        return { erro: (e as { message: string }).message, linhas: 0 }
      }
    }

    it('UPDATE direto nas duas colunas seladas é RECUSADO, e a linha não muda', async () => {
      const antes = await politica()

      // (O Postgres reporta a recusa na granularidade da TABELA — "permission
      // denied for table teachers" —, mesmo quando o que faltou foi o
      // privilégio de UMA coluna. Quem prova a cirurgia é o teste do grant
      // coluna a coluna, mais abaixo.)
      const recusaHoras = await comoNavegador('min_booking_lead_hours = 10000')
      expect(recusaHoras.erro, 'o UPDATE direto passou — o selo não existe').toMatch(
        /permission denied|permissão negada/i,
      )

      const recusaFeriado = await comoNavegador("holiday_policy = 'flag'")
      expect(recusaFeriado.erro).toMatch(/permission denied|permissão negada/i)

      // e o par de uma vez só, que era o ataque exato do relatório
      const recusaAmbas = await comoNavegador(
        "min_booking_lead_hours = 10000, holiday_policy = 'flag'",
      )
      expect(recusaAmbas.erro).toMatch(/permission denied|permissão negada/i)

      expect(await politica(), 'a política mudou apesar da recusa').toEqual(antes)
    })

    it('as OUTRAS colunas de teachers continuam editáveis pela sessão (o fluxo real)', async () => {
      // `updateTeacherAction` (src/app/admin/professoras/actions.ts) escreve
      // exatamente estas pela sessão da dona; `set_teacher_archived` mexe em
      // `archived_at`. Se o selo tivesse sido largo demais, isto ficaria vermelho.
      const r = await comoNavegador(
        "display_name = 'Dona selada', iana_tz = 'America/Cuiaba', " +
          "hourly_rate_cents = 12345, payment_terms = 'mensal', cpf = '000', " +
          "contract_kind = 'PJ', fallback_meet_url = 'https://meet.example/x', " +
          'archived_at = null',
      )
      expect(r.erro, 'o selo derrubou um update legítimo de teachers').toBeNull()
      expect(r.linhas, 'o update passou no privilégio mas não alcançou a linha').toBe(1)
      const [linha] = await sql`select display_name, hourly_rate_cents from teachers where id = ${teacher}`
      expect(linha.display_name).toBe('Dona selada')
      expect(Number(linha.hourly_rate_cents)).toBe(12345)
    })

    it('e a RPC — a porta que sobrou — continua gravando', async () => {
      await chamar({ horas: 11, feriado: 'cancel_credit' })
      expect(await politica()).toEqual({ horas: 11, feriado: 'cancel_credit' })
    })

    it('o grant de coluna cobre TODA coluna de teachers menos as duas seladas', async () => {
      // A tripwire da consequência escrita na migration: coluna NOVA nasce sem
      // update para `authenticated`, e quem a adicionar precisa decidir de que
      // lado ela fica. O diff deste teste mostra o nome dela.
      const SELADAS = ['min_booking_lead_hours', 'holiday_policy']
      const colunas = (
        await sql`select column_name from information_schema.columns
                   where table_schema = 'public' and table_name = 'teachers'`
      ).map((r) => r.column_name as string)
      const concedidas = (
        await sql`select column_name from information_schema.column_privileges
                   where table_schema = 'public' and table_name = 'teachers'
                     and grantee = 'authenticated' and privilege_type = 'UPDATE'`
      ).map((r) => r.column_name as string)

      expect([...concedidas].sort()).toEqual([...colunas.filter((c) => !SELADAS.includes(c))].sort())
      for (const c of SELADAS) expect(concedidas, c).not.toContain(c)
    })

    it('e o privilégio de TABELA sumiu (era ele que tornava o selo de coluna inútil)', async () => {
      const [priv] = await sql`
        select has_table_privilege('authenticated', 'public.teachers', 'UPDATE') as tabela`
      expect(priv.tabela).toBe(false)
    })
  })
})

/* ========================================================================== */
/* 2. Gramática pura                                                           */
/* ========================================================================== */

const {
  ALCADA_PADRAO,
  ANTECEDENCIA_FORA_DA_FAIXA,
  ANTECEDENCIA_MAX,
  ANTECEDENCIA_MIN,
  ANTECEDENCIA_VAZIA,
  BLOCOS,
  BLOCO_PADRAO,
  FRASES_DE_RECUSA,
  PADRAO_DA_ESCOLA,
  POLITICAS_DE_FERIADO,
  RECUSA_DESCONHECIDA,
  avisoDePoliticaDesconhecida,
  chaveDaPolitica,
  desviosDoContrato,
  ehBloco,
  ehPoliticaDeFeriado,
  enderecoDoBloco,
  fraseDaAntecedencia,
  fraseDaRecusaDoBanco,
} = await import('@/data/admin/ajustes-gramatica')

describe('A8 · gramática da tela', () => {
  it('a faixa da tela é a MESMA que a migration valida, e no BANCO ela é UMA constante nomeada', () => {
    const migration = codigo('supabase/migrations/20260729000100_ajustes_da_escola.sql')
    // GRAVE 4 da rodada 1: o teto é limite COMERCIAL, e por isso mora num nome
    // só — mudar a política tem de ser trocar UMA linha, não caçar o número.
    expect(migration).toContain(`v_piso constant int := ${ANTECEDENCIA_MIN};`)
    expect(migration).toContain(`v_teto constant int := ${ANTECEDENCIA_MAX};`)
    expect(migration).toContain('if p_lead_hours < v_piso or p_lead_hours > v_teto then')
    // e o número não pode ter voltado a ser digitado no meio do corpo da função
    const corpo = migration.slice(migration.indexOf('create or replace function'))
    const soltos = corpo.match(new RegExp(`\\b${ANTECEDENCIA_MAX}\\b`, 'g')) ?? []
    expect(soltos, 'o teto aparece mais de uma vez no corpo da função').toHaveLength(1)
    // o comentário DIZ de quem é a decisão — o que não pode voltar é número
    // comercial sem dono declarado. O teto nasceu inventado pelo implementador,
    // foi derrubado pelo Sol (rodada 1, grave 4) e virou limite de verdade na
    // ratificação do dono (29/07/2026, commit c0dd5bb), que trocou "PROVISÓRIO /
    // AGUARDA RATIFICAÇÃO DO" por "RATIFICADO PELO DONO". Este teste acompanhou
    // a ratificação em vez de cobrar para sempre a palavra da fase anterior.
    expect(migration).toMatch(/RATIFICADO PELO DONO/i)
    // e o vocabulário da política também
    expect(migration).toContain("not in ('cancel_credit', 'flag')")
    for (const p of POLITICAS_DE_FERIADO) expect(migration).toContain(`'${p.valor}'`)
  })

  it('a recusa do banco vira frase da casa; o texto cru NUNCA passa (grave 3)', () => {
    const migration = codigo('supabase/migrations/20260729000100_ajustes_da_escola.sql')
    // Cada tradução casa com uma recusa que a migration REALMENTE escreve — se
    // alguém reescrever a frase do banco, isto fica vermelho em vez de a dona
    // passar a ler o default genérico.
    const paresReais: Array<[string, string]> = [
      ['antecedência mínima fora da faixa: use de % a % horas', `Falha: ${ANTECEDENCIA_FORA_DA_FAIXA}`],
      ['informe a antecedência mínima em horas', 'Falha: informe a antecedência mínima em horas.'],
      ['política de feriado inválida: use cancel_credit ou flag', 'Falha: escolha o que fazer com as aulas em feriado (só avisar ou cancelar e devolver o crédito).'],
      ['professora não encontrada', 'Falha: essa professora não está mais cadastrada — recarregue a página.'],
      ['professora não informada', 'Falha: professora não identificada — recarregue a página.'],
      ['a política da professora é decisão da admin', 'Falha: só a administração muda a política de uma professora. Entre de novo na sua conta e tente outra vez.'],
      ['ator obrigatório para mudar a política de uma professora', 'Falha: só a administração muda a política de uma professora. Entre de novo na sua conta e tente outra vez.'],
    ]
    for (const [cruDoBanco, esperada] of paresReais) {
      expect(migration, cruDoBanco).toContain(cruDoBanco)
      expect(fraseDaRecusaDoBanco(cruDoBanco), cruDoBanco).toBe(esperada)
    }
    // O selo de coluna (grave 1) fala a língua do Postgres — e ela também é traduzida.
    expect(
      fraseDaRecusaDoBanco('permission denied for column min_booking_lead_hours of relation teachers'),
    ).toBe('Falha: esta conta não tem permissão para mudar a política da professora. Nada foi alterado.')

    // O DEFAULT NÃO VAZA NADA: nem nome de constraint, nem de função, nem SQL.
    const cru =
      'duplicate key value violates unique constraint "teachers_pkey" in function public.admin_set_teacher_policy(uuid,int,text,uuid)'
    const traduzida = fraseDaRecusaDoBanco(cru)
    expect(traduzida).toBe(RECUSA_DESCONHECIDA)
    for (const pedaco of ['teachers_pkey', 'constraint', 'admin_set_teacher_policy', 'uuid']) {
      expect(traduzida, pedaco).not.toContain(pedaco)
    }
    // e TODA frase de recusa é vermelha
    for (const f of FRASES_DE_RECUSA) expect(tomDoAviso(f), f).toBe('erro')
  })

  it('política desconhecida NÃO é adivinhada — a tela diz o que está gravado (baixo 10)', () => {
    const aviso = avisoDePoliticaDesconhecida('politica_nova_do_banco')
    expect(aviso).toContain('politica_nova_do_banco')
    // e não afirma nenhuma das duas conhecidas
    for (const p of POLITICAS_DE_FERIADO) expect(aviso).not.toContain(p.rotulo)
    expect(avisoDePoliticaDesconhecida('')).toContain('em branco')
  })

  it('campo VAZIO não é zero: a frase do vazio não descreve regra nenhuma (médio 5)', () => {
    expect(fraseDaAntecedencia(null)).toBe(ANTECEDENCIA_VAZIA)
    expect(fraseDaAntecedencia(null)).not.toMatch(/sem antecedência mínima/i)
    expect(fraseDaAntecedencia(null)).not.toMatch(/até a hora de começar/i)
    // e a de zero continua sendo a de zero — zero é escolha válida, só explícita
    expect(fraseDaAntecedencia(0)).toMatch(/sem antecedência mínima/i)
  })

  it('o padrão da escola bate com o que o banco preenche num contrato novo', () => {
    const migration = codigo('supabase/migrations/20260727001100_admin_create_contract.sql')
    expect(migration).toContain(`coalesce(p_allowance, ${ALCADA_PADRAO})`)
    // aviso mínimo e validade vêm de `src/lib/policy.ts` (fonte única desde o M4-4)
    expect(PADRAO_DA_ESCOLA.avisoHoras).toBe(24)
    expect(PADRAO_DA_ESCOLA.validadeDias).toBe(90)
  })

  it('zero não é "0 horas": é a ausência da regra', () => {
    expect(fraseDaAntecedencia(0)).toMatch(/sem antecedência mínima/i)
    expect(fraseDaAntecedencia(0)).not.toMatch(/\b0\b/)
    expect(fraseDaAntecedencia(1)).toContain('1 hora')
    expect(fraseDaAntecedencia(24)).toContain('24 horas (1 dia)')
    expect(fraseDaAntecedencia(48)).toContain('48 horas (2 dias)')
    expect(fraseDaAntecedencia(36)).toBe('Precisa marcar com pelo menos 36 horas de antecedência.')
  })

  it('contrato no padrão não entra no índice; cada campo fora vira UM desvio', () => {
    expect(desviosDoContrato({ alcada: 4, avisoHoras: 24, validadeDias: 90 })).toEqual([])
    const um = desviosDoContrato({ alcada: 2, avisoHoras: 24, validadeDias: 90 })
    expect(um).toHaveLength(1)
    expect(um[0]).toMatchObject({ rotulo: 'Remarcações por mês', valor: '2 por mês', padrao: '4 por mês' })
    expect(desviosDoContrato({ alcada: 2, avisoHoras: 12, validadeDias: 30 })).toHaveLength(3)
  })

  it('campo NULO é ausência, não desvio (a mentoria tem os três em branco)', () => {
    expect(desviosDoContrato({ alcada: null, avisoHoras: null, validadeDias: null })).toEqual([])
  })

  it('o bloco padrão não escreve na URL; os outros três escrevem', () => {
    expect(enderecoDoBloco(BLOCO_PADRAO)).toBe('/admin/ajustes')
    for (const b of BLOCOS.filter((x) => x !== BLOCO_PADRAO)) {
      expect(enderecoDoBloco(b)).toBe(`/admin/ajustes?bloco=${b}`)
    }
    expect(ehBloco('integracoes')).toBe(true)
    expect(ehBloco('qualquer')).toBe(false)
    expect(ehBloco(undefined)).toBe(false)
  })

  it('o vocabulário da política de feriado é fechado', () => {
    expect(ehPoliticaDeFeriado('flag')).toBe(true)
    expect(ehPoliticaDeFeriado('cancel_credit')).toBe(true)
    expect(ehPoliticaDeFeriado('cancelar')).toBe(false)
    expect(ehPoliticaDeFeriado('')).toBe(false)
  })

  it('a chave do rascunho é POR professora (uma não preenche o formulário da outra)', () => {
    expect(chaveDaPolitica('a')).not.toBe(chaveDaPolitica('b'))
    expect(chaveDaPolitica('a')).toContain('a')
  })
})

/* ========================================================================== */
/* 3. Catálogo de mensagens                                                    */
/* ========================================================================== */

const {
  CASO_TEXTO_DE_HOJE,
  CHAVES_DO_CATALOGO,
  SEM_TEMPLATE_AINDA_SAI,
  SEM_TEMPLATE_SO_EMAIL,
  catalogoDeMensagens,
  textoDoHtml,
} = await import(
  '@/data/admin/ajustes-mensagens'
)
const { TEMPLATES } = await import('@/lib/outbox/dispatch')
const { CHAVES_SEM_TEMPLATE_NA_META, renderizarTemplate, templatesDaChave } = await import(
  '@/lib/notify/whatsapp-templates'
)

const AGORA = DateTime.fromISO('2026-08-03T15:00:00Z', { zone: 'utc' })

describe('A8 · catálogo de mensagens', () => {
  it('o registro EXPORTADO é imutável: ninguém troca uma mensagem em memória (baixo 9)', () => {
    // Exportar o registro cru transformou o mapa de textos do despachante num
    // objeto mutável compartilhado — qualquer import podia trocar o corpo de um
    // e-mail, e o despachante lê exatamente este objeto na hora de mandar.
    expect(Object.isFrozen(TEMPLATES)).toBe(true)
    const chave = Object.keys(TEMPLATES)[0]
    expect(Object.isFrozen(TEMPLATES[chave]), chave).toBe(true)

    // Prova de mutação AO VIVO (modo estrito do ESM: a escrita lança).
    const alvo = TEMPLATES as unknown as Record<string, unknown>
    expect(() => {
      alvo[chave] = { email: () => ({ subject: 'sequestrado', html: 'x' }) }
    }).toThrow()
    expect(() => {
      ;(TEMPLATES[chave] as unknown as Record<string, unknown>).quiet = true
    }).toThrow()
    expect(() => {
      alvo['template-injetado'] = {}
    }).toThrow()

    // e nada disso encostou no registro
    expect(Object.keys(TEMPLATES)).not.toContain('template-injetado')
  })

  it('VARREDOR: toda mensagem que o despachante sabe mandar está no catálogo', () => {
    // Template novo sem entrada no catálogo = esta diferença. É o que impede a
    // tela de dizer "isto é tudo o que a escola manda" e estar errada.
    expect([...CHAVES_DO_CATALOGO].sort()).toEqual([...Object.keys(TEMPLATES)].sort())
  })

  it('nenhuma mensagem aparece sem canal, e canal de e-mail sempre tem assunto', () => {
    for (const bloco of catalogoDeMensagens(AGORA)) {
      for (const m of bloco.mensagens) {
        expect(m.canais.length, m.nome).toBeGreaterThan(0)
        if (m.corpoEmail) expect(m.assunto, m.nome).toBeTruthy()
        expect(m.gatilho.length, m.nome).toBeGreaterThan(10)
      }
    }
  })

  it('o corpo renderizado é TEXTO: sem tag, sem entidade, sem buraco de dado', () => {
    for (const bloco of catalogoDeMensagens(AGORA)) {
      for (const m of bloco.mensagens) {
        for (const corpo of [m.corpoEmail, ...m.whatsapp.map((v) => v.corpo)]) {
          if (!corpo) continue
          expect(corpo, m.nome).not.toContain('<p')
          expect(corpo, m.nome).not.toContain('</')
          expect(corpo, m.nome).not.toContain('&nbsp;')
          // buraco de dado é o defeito clássico do exemplo montado à mão
          expect(corpo, m.nome).not.toContain('undefined')
          expect(corpo, m.nome).not.toContain('NaN')
          expect(corpo, m.nome).not.toContain('Invalid DateTime')
        }
      }
    }
  })

  it('nenhuma chave técnica de template vaza para a tela (Design.md · Linguagem)', () => {
    const tudo = catalogoDeMensagens(AGORA)
      .flatMap((b) => [b.titulo, b.explicacao, ...b.mensagens.flatMap((m) => [m.nome, m.gatilho])])
      .join(' | ')
    for (const chave of Object.keys(TEMPLATES)) {
      expect(tudo, chave).not.toContain(chave)
    }
  })

  it('os exemplos usam o RELÓGIO recebido (Lei 1: a tela não inventa data)', () => {
    // ⚠️ O relógio deste caso é RELATIVO ao de verdade, e o motivo é um defeito
    // medido em 04/08/2026: o lembrete troca a data por "HOJE"/"AMANHÃ" quando a
    // aula é hoje ou amanhã — e essa comparação (`dayLabel`, class-notices.ts)
    // usa `DateTime.now()`, o relógio REAL, que o catálogo não injeta. Com
    // `AGORA` cravado em 03/08, o dia em que o calendário chegou em 04/08 o
    // exemplo virou "AMANHÃ" e o caso ficou vermelho sem ninguém mexer em nada.
    // Ancorar o relógio longe de hoje é o que torna a asserção determinística —
    // e o que ela prova continua sendo o mesmo: relógio diferente, data
    // diferente no exemplo.
    const base = DateTime.now().setZone('utc').plus({ days: 60 }).startOf('day')
    const cedo = catalogoDeMensagens(base)
    const tarde = catalogoDeMensagens(base.plus({ days: 30 }))
    const lembrete = (bs: ReturnType<typeof catalogoDeMensagens>) =>
      bs[0].mensagens.find((m) => m.nome === 'Lembrete de aula')!.corpoEmail
    const dia = (d: DateTime) => d.setZone('America/Cuiaba').toFormat('dd/LL')
    expect(lembrete(cedo)).toContain(dia(base.plus({ days: 2 })))
    expect(lembrete(tarde)).toContain(dia(base.plus({ days: 32 })))
    expect(lembrete(cedo)).not.toBe(lembrete(tarde))
  })

  it('textoDoHtml: lista vira marcador, tag some, entidade volta a ser letra', () => {
    const t = textoDoHtml('<p>Oi, <strong>Marina</strong>!</p><ul><li>um</li><li>dois</li></ul>')
    expect(t).toContain('Oi, Marina!')
    expect(t).toContain('• um')
    expect(t).toContain('• dois')
    expect(t).not.toContain('<')
    expect(textoDoHtml('a&nbsp;b &amp; c')).toBe('a b & c')
    // <style>/<script> não viram texto para ninguém ler
    expect(textoDoHtml('<style>.x{color:red}</style><p>oi</p>')).toBe('oi')
  })

  it('#41: o WhatsApp das nove famílias vem do módulo de templates da Meta, não de spec.text', () => {
    const fila = catalogoDeMensagens(AGORA)[0].mensagens
    let familias = 0
    fila.forEach((m, i) => {
      const chave = CHAVES_DO_CATALOGO[i]
      const templates = templatesDaChave(chave)
      if (!templates.length) return
      familias++
      // um corpo por template da família, com o nome na Meta e os exemplos
      // que vão na submissão — o mesmo texto que a Meta vai aprovar
      expect(m.whatsapp, m.nome).toEqual(
        templates.map((t) => ({
          rotulo: templates.length > 1 ? t.rotulo : null,
          nomeNaMeta: t.nome,
          corpo: renderizarTemplate(t),
        })),
      )
      expect(m.avisoSemTemplate, m.nome).toBeNull()
    })
    expect(familias).toBe(9)
    // prova de origem: o exemplo de data é o do template, não o relógio do catálogo
    const lembrete = fila.find((m) => m.nome === 'Lembrete de aula')!
    expect(lembrete.whatsapp.map((v) => v.nomeNaMeta)).toContain('class_reminder_48h_amanha')
    expect(lembrete.whatsapp[0].corpo).toContain('quinta-feira, 12/11 às 09:00')
  })

  it('#41: as três sem template aparecem como "sem template na Meta", com o canal VERDADEIRO de hoje', () => {
    expect(SEM_TEMPLATE_SO_EMAIL).toBe('sem template na Meta (sai só por e-mail)')
    const fila = catalogoDeMensagens(AGORA)[0].mensagens
    const daChave = (chave: string) => fila[CHAVES_DO_CATALOGO.indexOf(chave)]
    const marcadas = CHAVES_DO_CATALOGO.filter((_, i) => fila[i].avisoSemTemplate !== null)
    expect([...marcadas].sort()).toEqual([...CHAVES_SEM_TEMPLATE_NA_META].sort())

    // S1 do gate Sol (PR #90): o convite de remarcar por período só é
    // enfileirado por e-mail — não aparece como WhatsApp, nem com corpo
    const convite = daChave('period-reschedule-invite')
    expect(convite.avisoSemTemplate).toBe(SEM_TEMPLATE_SO_EMAIL)
    expect(convite.canais).toEqual(['E-mail'])
    expect(convite.whatsapp).toEqual([])

    // …e os dois avisos internos também saem só por e-mail desde a M3-1 (#42:
    // o SQL enfileira sempre 'email'): mesmo rótulo do convite, sem corpo de
    // WhatsApp e sem o caso "texto que sai hoje"
    for (const chave of ['content-digest', 'content-review']) {
      const m = daChave(chave)
      expect(m.avisoSemTemplate, chave).toBe(SEM_TEMPLATE_SO_EMAIL)
      expect(m.avisoSemTemplate, chave).not.toBe(SEM_TEMPLATE_AINDA_SAI)
      expect(m.canais, chave).toEqual(['E-mail'])
      expect(m.whatsapp, chave).toEqual([])
      expect(m.whatsapp.map((v) => v.rotulo), chave).not.toContain(CASO_TEXTO_DE_HOJE)
    }

    // e quem não tem WhatsApp nenhum (fora as três) não ganha o rótulo
    const nomesDasTres = CHAVES_SEM_TEMPLATE_NA_META.map((chave) => daChave(chave).nome)
    for (const m of catalogoDeMensagens(AGORA).flatMap((b) => b.mensagens)) {
      if (!m.canais.includes('WhatsApp') && !nomesDasTres.includes(m.nome)) {
        expect(m.avisoSemTemplate, m.nome).toBeNull()
        expect(m.whatsapp, m.nome).toEqual([])
      }
    }
  })

  it('as três do serviço de acesso aparecem SEM corpo inventado', () => {
    const acesso = catalogoDeMensagens(AGORA).at(-1)!
    expect(acesso.titulo).toBe('Convite e senha')
    expect(acesso.explicacao).toMatch(/configurado no servidor/i)
    for (const m of acesso.mensagens) {
      expect(m.corpoEmail, m.nome).toBeNull()
      expect(m.assunto, m.nome).toBeNull()
    }
  })
})

describe('A8 · #41: o canal de hoje dos três sem template é o que o BANCO enfileira', () => {
  // O catálogo declara em TypeScript por onde estas três saem hoje (rótulo e
  // selo de canal). Quem decide é o SQL: o convite de período nasce sem
  // `channel` (= e-mail) em `admin_period_treatment`; os dois avisos internos
  // escolhem 'whatsapp' quando a admin tem número. Este caso lê a função VIVA
  // (pg_get_functiondef) e cobra o catálogo contra ela: quando a #42 mandar os
  // avisos internos só por e-mail, ele fica vermelho até os rótulos mudarem.
  let banco: Sql
  beforeAll(() => {
    banco = connect(1)
  })
  afterAll(async () => {
    await banco.end()
  })

  async function definicao(assinatura: string): Promise<string> {
    const [linha] = await banco`select pg_get_functiondef(${assinatura}::regprocedure) as def`
    return String(linha.def)
  }

  it('convite de período: o banco não enfileira WhatsApp, e o catálogo não o mostra como WhatsApp', async () => {
    const def = await definicao(
      (await banco`select p.oid::regprocedure::text as assinatura from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_period_treatment'`)[0].assinatura,
    )
    const saiPorWhatsapp = enfileiraPorWhatsapp(def, 'period-reschedule-invite')
    const fila = catalogoDeMensagens(AGORA)[0].mensagens
    const convite = fila[CHAVES_DO_CATALOGO.indexOf('period-reschedule-invite')]
    expect(convite.canais.includes('WhatsApp')).toBe(saiPorWhatsapp)
    expect(convite.avisoSemTemplate).toBe(saiPorWhatsapp ? SEM_TEMPLATE_AINDA_SAI : SEM_TEMPLATE_SO_EMAIL)
  })

  it('avisos internos: o rótulo do catálogo é o canal que o SQL VIVO enfileira (só e-mail desde a #42)', async () => {
    const fila = catalogoDeMensagens(AGORA)[0].mensagens
    for (const [chave, assinatura] of AVISOS_INTERNOS) {
      const def = await definicao(assinatura)
      const saiPorWhatsapp = enfileiraPorWhatsapp(def, chave)
      // a M3-1 (migration 20261030000100) tirou o WhatsApp destes dois
      expect(saiPorWhatsapp, chave).toBe(false)
      const m = fila[CHAVES_DO_CATALOGO.indexOf(chave)]
      expect(m.canais.includes('WhatsApp'), chave).toBe(saiPorWhatsapp)
      expect(m.avisoSemTemplate, chave).toBe(saiPorWhatsapp ? SEM_TEMPLATE_AINDA_SAI : SEM_TEMPLATE_SO_EMAIL)
    }
  })

  it('PROVA DE MUTAÇÃO do detector, sobre a definição ANTERIOR (104): comentário enganoso e case morto não enganam', () => {
    // Antes da #42 a função viva escolhia WhatsApp quando a admin tinha número;
    // a prova de que o detector enxerga isso (e não se engana) passa a ser feita
    // sobre o texto da 104, que é onde essa escolha ficou escrita.
    const [chave] = AVISOS_INTERNOS[0]
    const sql104 = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260804000100_digest_do_lote.sql'),
      'utf8',
    )
    const inicio = sql104.search(/create or replace function public\.notify_content_review\(\)/i)
    const fim = sql104.indexOf('$$;', sql104.indexOf('as $$', inicio) + 5)
    expect(inicio, 'a definição da 104 não foi achada').toBeGreaterThanOrEqual(0)
    const anterior = sql104.slice(inicio, fim + 3)
    expect(enfileiraPorWhatsapp(anterior, chave)).toBe(true)

    // (a) o case vira 'email' e a lembrança do antigo fica num COMENTÁRIO
    const comComentario = anterior.replace(
      /v_channel\s*:=\s*case[\s\S]*?end\s*;/,
      "v_channel := 'email'; -- ALTERADO (#42): era case when whatsapp_e164 is not null then 'whatsapp'",
    )
    expect(comComentario, 'a mutação (a) não pegou').not.toBe(anterior)
    expect(enfileiraPorWhatsapp(comComentario, chave)).toBe(false)

    // (b) o case fica MORTO e o insert grava 'email' direto
    const comCaseMorto = anterior.replace(/v_channel(\s*,\s*'content-review')/, "'email'$1")
    expect(comCaseMorto, 'a mutação (b) não pegou').not.toBe(anterior)
    expect(enfileiraPorWhatsapp(comCaseMorto, chave)).toBe(false)
  })

  it('PROVA DE MUTAÇÃO do detector, sobre SQL de exemplo: canal explícito no insert', () => {
    const cabeca = 'insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)'
    // canal 'email' escrito por extenso NÃO é WhatsApp (sem vermelho falso)
    expect(enfileiraPorWhatsapp(`${cabeca} select 'email', 'period-reschedule-invite', x;`, 'period-reschedule-invite')).toBe(false)
    // canal 'whatsapp' escrito por extenso é
    expect(enfileiraPorWhatsapp(`${cabeca} select 'whatsapp', 'period-reschedule-invite', x;`, 'period-reschedule-invite')).toBe(true)
    // sem coluna de canal = e-mail (o default da tabela)
    expect(
      enfileiraPorWhatsapp(
        "insert into notification_outbox (template, recipient_profile_id) select 'period-reschedule-invite', x;",
        'period-reschedule-invite',
      ),
    ).toBe(false)
    // canal por variável cuja atribuição só dá 'email' não é WhatsApp
    expect(
      enfileiraPorWhatsapp(
        `v_channel := case when true then 'email' else 'email' end; ${cabeca} values (v_channel, 'content-review', x);`,
        'content-review',
      ),
    ).toBe(false)
    // …e a mesma com um ramo 'whatsapp' é
    expect(
      enfileiraPorWhatsapp(
        `v_channel := case when n is not null then 'whatsapp' else 'email' end; ${cabeca} values (v_channel, 'content-review', x);`,
        'content-review',
      ),
    ).toBe(true)
    // o nome qualificado (`public.notification_outbox`) também é o insert do outbox
    expect(
      enfileiraPorWhatsapp(
        "insert into public.notification_outbox (channel, template) values ('whatsapp', 'content-digest');",
        'content-digest',
      ),
    ).toBe(true)
    // template que a função não enfileira é erro alto, nunca "não é WhatsApp"
    expect(() => enfileiraPorWhatsapp('select 1;', 'content-review')).toThrow()
  })
})

/** As duas funções que enfileiram os avisos internos, com a chave de cada uma. */
const AVISOS_INTERNOS: ReadonlyArray<readonly [string, string]> = [
  ['content-review', 'public.notify_content_review()'],
  ['content-digest', 'public.enqueue_content_digest(text, integer)'],
]

/** O corpo sem os comentários de linha (`-- …`): comentário não é código. */
function semComentarios(def: string): string {
  return def.replace(/--[^\n]*/g, '')
}

/**
 * O banco enfileira ESTE template por WhatsApp? Lê só código (sem comentário) e
 * só o `insert` do outbox que leva o template (do último `insert into` antes da
 * chave até ela). É WhatsApp quando esse insert escreve `'whatsapp'`, ou quando
 * ele usa `v_channel` e a atribuição de `v_channel` tem um ramo `then 'whatsapp'`.
 * Sem coluna de canal, ou com outro literal (`'email'`), não é.
 */
function enfileiraPorWhatsapp(definicaoDaFuncao: string, template: string): boolean {
  const def = semComentarios(definicaoDaFuncao)
  const posicao = def.indexOf(`'${template}'`)
  if (posicao < 0) throw new Error(`${template} não aparece no código da função`)
  // `public.` opcional: o digest escreve o nome qualificado, o convite não
  const inserts = [...def.slice(0, posicao).matchAll(/insert\s+into\s+(?:public\.)?notification_outbox\b/gi)]
  const inicio = inserts.at(-1)?.index ?? -1
  if (inicio < 0) throw new Error(`${template} sem insert no outbox`)
  const insert = def.slice(inicio, posicao)
  if (/'whatsapp'/.test(insert)) return true
  if (!/\bv_channel\b/.test(insert)) return false
  return [...def.matchAll(/v_channel\s*:=([\s\S]*?);/g)].some((m) => /then\s+'whatsapp'/.test(m[1]))
}

/* ========================================================================== */
/* 4. Camada de dados — cliente falso                                          */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

const mock = vi.hoisted(() => ({
  respostas: {} as Record<string, Resposta>,
  chamadas: {} as Record<string, Array<[string, ...unknown[]]>>,
  rpcs: [] as Array<[string, unknown]>,
  respostaRpc: { data: null, error: null } as Resposta,
}))

const { Redirecionou } = vi.hoisted(() => {
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return { Redirecionou }
})

/**
 * Consulta falsa: grava método + argumentos e resolve pela CHAVE da leitura.
 * A chave é a tabela — exceto em `webhook_inbox`, onde a mesma tabela é lida
 * uma vez por parceiro e o que distingue é o `eq('source', …)`.
 */
class ConsultaFalsa {
  private chamadas: Array<[string, ...unknown[]]> = []
  private single = false
  constructor(
    private readonly tabela: string,
    private readonly registrar: (c: [string, ...unknown[]]) => void,
  ) {}
  private marca(nome: string, args: unknown[]) {
    const c: [string, ...unknown[]] = [nome, ...args]
    this.chamadas.push(c)
    this.registrar(c)
    return this
  }
  select(...a: unknown[]) { return this.marca('select', a) }
  eq(...a: unknown[]) { return this.marca('eq', a) }
  neq(...a: unknown[]) { return this.marca('neq', a) }
  not(...a: unknown[]) { return this.marca('not', a) }
  is(...a: unknown[]) { return this.marca('is', a) }
  order(...a: unknown[]) { return this.marca('order', a) }
  limit(...a: unknown[]) { return this.marca('limit', a) }
  maybeSingle() {
    this.single = true
    return this.marca('maybeSingle', [])
  }
  /**
   * A chave da leitura. Desde a correção do grave 2, cada caixa é lida DUAS
   * vezes — a última linha PROCESSADA COM SUCESSO (a prova do verde) e a última
   * que FALHOU (o gatilho do vermelho) —, então a tabela sozinha não distingue
   * mais nada. O sufixo sai do próprio filtro: quem pede `not('error', 'is',
   * null)` está caçando falha; o resto é a leitura boa.
   */
  private chave(): string {
    const fonte = this.chamadas.find((c) => c[0] === 'eq' && c[1] === 'source')?.[2]
    const caçandoFalha = this.chamadas.some((c) => c[0] === 'not' && c[1] === 'error')
    const lado = caçandoFalha ? 'falha' : 'ok'
    if (this.tabela === 'webhook_inbox') return `webhook_inbox:${String(fonte)}:${lado}`
    if (this.tabela === 'notification_outbox') return `notification_outbox:${lado}`
    return this.tabela
  }
  then<A, B>(ok: (v: { data: unknown; error: unknown }) => A, falha?: (e: unknown) => B) {
    const r = mock.respostas[this.chave()] ?? {}
    return Promise.resolve({
      data: r.data ?? (this.single ? null : []),
      error: r.error ?? null,
    }).then(ok, falha)
  }
}

function clienteFalso() {
  return {
    from: (tabela: string) => {
      mock.chamadas[tabela] ??= []
      return new ConsultaFalsa(tabela, (c) => mock.chamadas[tabela].push(c))
    },
    rpc: async (fn: string, args: unknown) => {
      mock.rpcs.push([fn, args])
      return { data: mock.respostaRpc.data ?? null, error: mock.respostaRpc.error ?? null }
    },
  }
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => clienteFalso() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => clienteFalso() }))
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
}))

const { cookies } = await import('next/headers')

let pote: PoteDeCookies
beforeEach(() => {
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  mock.respostas = {}
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const { FRESCOR_DIAS, FRESCOR_DIAS_HOTMART, getAjustes } = await import('@/data/admin/ajustes')

const DONA = {
  id: 't-dona',
  display_name: 'Teacher Vicky',
  is_owner: true,
  iana_tz: 'America/Cuiaba',
  min_booking_lead_hours: 12,
  holiday_policy: 'cancel_credit',
}
const ANA = {
  id: 't-ana',
  display_name: 'Teacher Ana',
  is_owner: false,
  iana_tz: 'America/New_York',
  min_booking_lead_hours: 48,
  holiday_policy: 'flag',
}

function contratoCru(campos: {
  id: string
  alcada?: number | null
  aviso?: number | null
  validade?: number | null
  aluno?: string
  status?: string
}) {
  return {
    id: campos.id,
    plan_name: 'Plano mensal',
    status: campos.status ?? 'active',
    monthly_reschedule_allowance: campos.alcada === undefined ? 4 : campos.alcada,
    min_notice_hours: campos.aviso === undefined ? 24 : campos.aviso,
    makeup_credit_expiry_days: campos.validade === undefined ? 90 : campos.validade,
    students: { display_name: campos.aluno ?? 'Marina Alves' },
    student_groups: null,
  }
}

function semear(extras: Record<string, Resposta> = {}) {
  mock.respostas = {
    teachers: { data: [DONA, ANA] },
    contracts: { data: [] },
    teacher_google_accounts: { data: [] },
    'notification_outbox:ok': { data: null },
    'notification_outbox:falha': { data: null },
    ...extras,
  }
}

/** Um aviso PROCESSADO COM SUCESSO daquele parceiro, na data dada. */
const avisoBom = (fonte: string, quando: string) => ({
  [`webhook_inbox:${fonte}:ok`]: { data: { received_at: quando } },
})
/** Um aviso que chegou e NÃO pôde ser processado. */
const avisoRuim = (fonte: string, quando: string) => ({
  [`webhook_inbox:${fonte}:falha`]: { data: { received_at: quando } },
})

describe('A8 · camada de dados', () => {
  it('a política de cada professora chega pronta, com a cidade em vez do IANA cru', async () => {
    semear()
    const d = await getAjustes(AGORA)
    expect(d.professoras).toEqual([
      {
        id: 't-dona',
        nome: 'Teacher Vicky',
        ehDona: true,
        cidade: 'Cuiabá',
        antecedenciaHoras: 12,
        feriado: 'cancel_credit',
        feriadoCru: 'cancel_credit',
      },
      {
        id: 't-ana',
        nome: 'Teacher Ana',
        ehDona: false,
        cidade: 'Nova York',
        antecedenciaHoras: 48,
        feriado: 'flag',
        feriadoCru: 'flag',
      },
    ])
  })

  it('política que a tela não conhece chega como É — não vira "flag" (baixo 10)', async () => {
    semear({ teachers: { data: [{ ...DONA, holiday_policy: 'politica_nova_do_banco' }] } })
    const [p] = (await getAjustes(AGORA)).professoras
    expect(p.feriado, 'o valor desconhecido foi ADIVINHADO').toBeNull()
    expect(p.feriadoCru).toBe('politica_nova_do_banco')
  })

  it('professora arquivada não entra, e a ordem é dona primeiro (contrato da consulta)', async () => {
    semear()
    await getAjustes(AGORA)
    const chamadas = mock.chamadas['teachers'] ?? []
    expect(chamadas).toContainEqual(['is', 'archived_at', null])
    expect(chamadas).toContainEqual(['order', 'is_owner', { ascending: false }])
  })

  it('só os contratos FORA do padrão entram; o denominador conta todos os vivos', async () => {
    semear({
      contracts: {
        data: [
          contratoCru({ id: 'c1' }), // no padrão
          contratoCru({ id: 'c2', alcada: 2, aluno: 'Rafael' }),
          contratoCru({ id: 'c3', validade: 180, aluno: 'Bia', status: 'paused' }),
        ],
      },
    })
    const d = await getAjustes(AGORA)
    expect(d.contratosConferidos).toBe(3)
    expect(d.contratosForaDoPadrao.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(d.contratosForaDoPadrao[0].quem).toBe('Rafael')
    expect(d.contratosForaDoPadrao[1].pausado).toBe(true)
    expect(d.contratosForaDoPadrao[1].desvios[0].rotulo).toBe('Validade do crédito')
  })

  it('contrato encerrado nem é lido (a consulta pede vivo)', async () => {
    semear()
    await getAjustes(AGORA)
    expect(mock.chamadas['contracts']).toContainEqual(['neq', 'status', 'ended'])
    expect(mock.chamadas['contracts']).toContainEqual(['eq', 'contract_type', 'private_1on1'])
  })

  it('FALHA NUNCA VIRA VAZIO: erro do PostgREST estoura', async () => {
    semear({ contracts: { error: { message: 'boom' } } })
    await expect(getAjustes(AGORA)).rejects.toThrow(/Ajustes: falha ao ler os contratos/)
  })

  /* ---- integrações: a régua da honestidade -------------------------------- */

  const ligaTudo = () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'cliente-secreto-google')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'segredo-google-xyz')
    vi.stubEnv('EVOLUTION_URL', 'https://evo.interno.exemplo')
    vi.stubEnv('EVOLUTION_API_KEY', 'chave-evolution-xyz')
    vi.stubEnv('EVOLUTION_INSTANCE', 'instancia-1')
    vi.stubEnv('WHATSAPP_CLOUD_TOKEN', 'token-meta-xyz')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'numero-meta-xyz')
    vi.stubEnv('ASAAS_WEBHOOK_TOKEN', 'token-asaas-xyz')
    vi.stubEnv('RESEND_API_KEY', 'chave-resend-xyz')
    vi.stubEnv('HOTMART_CLIENT_ID', 'hot-id')
    vi.stubEnv('HOTMART_CLIENT_SECRET', 'hot-secret-xyz')
    vi.stubEnv('HOTMART_BASIC', 'hot-basic-xyz')
    vi.stubEnv('HOTMART_SUBDOMAIN', 'subdominio-hotmart-xyz')
  }
  const desligaTudo = () => {
    for (const k of [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'EVOLUTION_URL',
      'EVOLUTION_API_KEY',
      'EVOLUTION_INSTANCE',
      'WHATSAPP_CLOUD_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'ASAAS_WEBHOOK_TOKEN',
      'RESEND_API_KEY',
      'HOTMART_CLIENT_ID',
      'HOTMART_CLIENT_SECRET',
      'HOTMART_BASIC',
      'HOTMART_SUBDOMAIN',
    ]) {
      vi.stubEnv(k, '')
    }
  }
  /** A lista, cobrando que o bloco tenha sido LIDO com sucesso. */
  const lista = (d: Awaited<ReturnType<typeof getAjustes>>) => {
    if (!d.integracoes.ok) throw new Error(`o bloco falhou: ${d.integracoes.motivo}`)
    return d.integracoes.lista
  }
  const porNome = (d: Awaited<ReturnType<typeof getAjustes>>, nome: string) =>
    lista(d).find((i) => i.nome === nome)!

  const TODAS = ['Google Agenda', 'WhatsApp', 'Asaas', 'E-mail', 'Hotmart']

  it('chave no ambiente SEM prova de vida = "não verificado", nunca verde', async () => {
    ligaTudo()
    semear()
    const d = await getAjustes(AGORA)
    for (const nome of TODAS) {
      const i = porNome(d, nome)
      expect(i.situacao, nome).toBe('nao_verificada')
      expect(i.frase, nome).toMatch(/não|ainda|nenhum/i)
      expect(i.evidencia, nome).toBeNull()
    }
  })

  it('com PROVA DE PROCESSAMENTO recente vira "funcionando", e a prova aparece com data', async () => {
    ligaTudo()
    semear({
      teacher_google_accounts: {
        data: [{ teacher_id: 't-dona', last_sync_at: '2026-08-03T12:00:00Z', last_sync_error: null }],
      },
      ...avisoBom('asaas', '2026-08-02T18:30:00Z'),
      ...avisoBom('meta', '2026-08-03T09:00:00Z'),
      ...avisoBom('hotmart', '2026-07-20T09:00:00Z'),
      'notification_outbox:ok': { data: { sent_at: '2026-08-03T10:00:00Z' } },
    })
    const d = await getAjustes(AGORA)
    for (const nome of TODAS) {
      expect(porNome(d, nome).situacao, nome).toBe('ligada')
      expect(porNome(d, nome).evidencia, nome).toBeTruthy()
      expect(porNome(d, nome).alerta, nome).toBeNull()
    }
    // datas em português, nunca ISO cru na tela
    expect(porNome(d, 'Asaas').evidencia).toContain('ontem às')
    expect(porNome(d, 'WhatsApp').evidencia).toContain('hoje às')
    expect(porNome(d, 'Hotmart').evidencia).toContain('20/07')
  })

  it('#43 · cartão WhatsApp lê a Cloud API: sem chaves, configurado sem sinal, e funcionando com sinal da Meta', async () => {
    // 1. sem as chaves da Cloud API (mesmo com as da Evolution, que saiu de uso)
    desligaTudo()
    vi.stubEnv('EVOLUTION_URL', 'https://evo.interno.exemplo')
    vi.stubEnv('EVOLUTION_API_KEY', 'chave-evolution-xyz')
    vi.stubEnv('EVOLUTION_INSTANCE', 'instancia-1')
    semear()
    const sem = porNome(await getAjustes(AGORA), 'WhatsApp')
    expect(sem.situacao).toBe('desligada')
    expect(sem.frase).toContain('Sem as chaves do WhatsApp neste ambiente')

    // 2. com as chaves, e a inbox sem nada de origem `meta` (só da Evolution)
    vi.stubEnv('WHATSAPP_CLOUD_TOKEN', 'token-meta-xyz')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'numero-meta-xyz')
    semear({ ...avisoBom('evolution', '2026-08-03T09:00:00Z') })
    const semSinal = porNome(await getAjustes(AGORA), 'WhatsApp')
    expect(semSinal.situacao).toBe('nao_verificada')
    expect(semSinal.frase).toMatch(/nenhum sinal da Meta/)
    expect(semSinal.frase).toContain('número da escola')
    expect(semSinal.frase).not.toMatch(/aparelho/i)
    expect(mock.chamadas['webhook_inbox'], 'o cartão lê a origem meta').toContainEqual(['eq', 'source', 'meta'])

    // 3. com uma linha `meta` processada dentro da janela
    semear({ ...avisoBom('meta', '2026-08-02T09:00:00Z') })
    const com = porNome(await getAjustes(AGORA), 'WhatsApp')
    expect(com.situacao).toBe('ligada')
    expect(com.frase).toContain('número da escola na Meta')
    expect(com.evidencia).toContain('ontem às')
  })

  it('sem chave nenhuma = "não ligada" (e a Hotmart diz que o progresso é manual)', async () => {
    desligaTudo()
    semear()
    const d = await getAjustes(AGORA)
    for (const i of lista(d)) expect(i.situacao, i.nome).toBe('desligada')
    expect(porNome(d, 'Hotmart').frase).toMatch(/à mão/i)
  })

  /* ======================================================================== */
  /* GRAVE 2 — "funcionando" podia ser mentira. Um teste por cenário.          */
  /* ======================================================================== */

  it('CENÁRIO 1 · aviso do Asaas com ERRO na inbox: o estado é FALHA, não verde', async () => {
    // O cenário literal do revisor: chega um pagamento que não casa com
    // contrato, a inbox grava `error`, e a dona lia "funcionando — os avisos de
    // cobrança estão chegando" enquanto o pagamento não entrou.
    ligaTudo()
    semear({ ...avisoRuim('asaas', '2026-08-03T08:00:00Z') })
    const a = porNome(await getAjustes(AGORA), 'Asaas')
    expect(a.situacao).toBe('falhando')
    expect(a.frase).toMatch(/não entrou no sistema/i)
    expect(a.frase).not.toMatch(/estão chegando/i)
    expect(a.alerta).toContain('hoje às')
  })

  it('CENÁRIO 2 · aviso RECEBIDO mas nunca processado não pinta de verde', async () => {
    // A régua velha lia só `received_at`. A nova só chama de prova a linha com
    // `processed_at` preenchido E `error` nulo — e é ISSO que a consulta pede.
    ligaTudo()
    semear() // nenhuma linha "ok": há avisos crus na caixa, mas nenhum digerido
    const a = porNome(await getAjustes(AGORA), 'Asaas')
    expect(a.situacao).toBe('nao_verificada')

    const chamadas = mock.chamadas['webhook_inbox'] ?? []
    expect(chamadas, 'a consulta não exige processed_at').toContainEqual([
      'not',
      'processed_at',
      'is',
      null,
    ])
    expect(chamadas, 'a consulta não exige error nulo').toContainEqual(['is', 'error', null])
  })

  it('CENÁRIO 3 · Google com linha de conta mas SEM sincronização não é "funcionando"', async () => {
    // O callback do OAuth cria a linha com `last_sync_at = null`. Antes, existir
    // linha bastava para o verde: conectar nunca foi sincronizar.
    ligaTudo()
    semear({
      teacher_google_accounts: {
        data: [{ teacher_id: 't-dona', last_sync_at: null, last_sync_error: null }],
      },
    })
    const g = porNome(await getAjustes(AGORA), 'Google Agenda')
    expect(g.situacao).toBe('nao_verificada')
    expect(g.frase).toMatch(/nenhuma sincronização aconteceu ainda/i)
    expect(g.evidencia).toBeNull()
  })

  it('CENÁRIO 4 · Google com last_sync_error é FALHA — nunca verde com alerta embaixo', async () => {
    ligaTudo()
    semear({
      teacher_google_accounts: {
        data: [
          {
            teacher_id: 't-dona',
            last_sync_at: '2026-08-03T12:00:00Z',
            last_sync_error: 'invalid_grant: token revogado (segredo-google-xyz)',
          },
        ],
      },
    })
    const g = porNome(await getAjustes(AGORA), 'Google Agenda')
    // O par que o revisor achou — pílula verde + "a última sincronização
    // falhou" na mesma tela — deixa de ser possível.
    expect(g.situacao).toBe('falhando')
    expect(g.situacao).not.toBe('ligada')
    expect(g.frase).toMatch(/última sincronização falhou/i)
    // e o texto cru do erro continua fora da tela
    expect(JSON.stringify(g)).not.toContain('invalid_grant')
    expect(JSON.stringify(g)).not.toContain('segredo-google-xyz')
  })

  it('CENÁRIO 5 · sinal VELHO não sustenta "funcionando" — e a data aparece como DADO', async () => {
    ligaTudo()
    semear({
      teacher_google_accounts: {
        data: [{ teacher_id: 't-dona', last_sync_at: '2026-05-01T12:00:00Z', last_sync_error: null }],
      },
      // fora dos 7 dias do Asaas, mas DENTRO dos 30 da Hotmart
      ...avisoBom('asaas', '2026-06-01T12:00:00Z'),
      ...avisoBom('hotmart', '2026-07-20T09:00:00Z'),
    })
    const d = await getAjustes(AGORA)

    const a = porNome(d, 'Asaas')
    expect(a.situacao).toBe('nao_verificada')
    expect(a.frase).toContain(String(FRESCOR_DIAS))
    expect(a.evidencia, 'a data do último sinal sumiu').toContain('01/06')

    const g = porNome(d, 'Google Agenda')
    expect(g.situacao).toBe('nao_verificada')
    expect(g.evidencia).toContain('01/05')

    // A janela da Hotmart é OUTRA de propósito (curso de 12 meses, avisos de
    // progresso): 14 dias de silêncio ali é funcionamento normal.
    expect(FRESCOR_DIAS_HOTMART).toBeGreaterThan(FRESCOR_DIAS)
    expect(porNome(d, 'Hotmart').situacao).toBe('ligada')
  })

  it('falha ANTIGA já superada por um processamento novo não pinta de vermelho', async () => {
    // A outra ponta da prova de mutação: se o vermelho fosse "existe falha
    // alguma vez", um tropeço de maio deixaria a tela vermelha para sempre.
    ligaTudo()
    semear({
      ...avisoBom('asaas', '2026-08-03T10:00:00Z'),
      ...avisoRuim('asaas', '2026-06-01T10:00:00Z'),
    })
    const a = porNome(await getAjustes(AGORA), 'Asaas')
    expect(a.situacao).toBe('ligada')
    expect(a.alerta).toBeNull()
  })

  it('e-mail PARADO na fila com erro é falha, não silêncio', async () => {
    ligaTudo()
    semear({ 'notification_outbox:falha': { data: { created_at: '2026-08-03T07:00:00Z' } } })
    const e = porNome(await getAjustes(AGORA), 'E-mail')
    expect(e.situacao).toBe('falhando')
    expect(e.frase).toMatch(/parado na fila/i)
  })

  /* ======================================================================== */
  /* MÉDIO 7 — a falha das integrações não derruba as outras abas             */
  /* ======================================================================== */

  it('uma falha de leitura fica CONTIDA no bloco: professoras e contratos chegam inteiros', async () => {
    // O detalhe do erro vai para o log do SERVIDOR (é lá que ele serve); aqui a
    // saída é silenciada para o relatório do teste não parecer uma falha.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    ligaTudo()
    semear({
      contracts: { data: [contratoCru({ id: 'c9', alcada: 1, aluno: 'Bia' })] },
      'webhook_inbox:asaas:ok': { error: { message: 'inbox pegou fogo' } },
    })
    const d = await getAjustes(AGORA)

    // o que a dona veio fazer continua na tela
    expect(d.professoras).toHaveLength(2)
    expect(d.contratosForaDoPadrao.map((c) => c.id)).toEqual(['c9'])

    // e o bloco quebrado diz que QUEBROU — não "não verificado", que seria a
    // mentira que ele existe para não contar
    expect(d.integracoes.ok).toBe(false)
    if (d.integracoes.ok) throw new Error('era para o bloco ter falhado')
    expect(d.integracoes.motivo).toMatch(/não consegui ler/i)
    expect(d.integracoes.motivo).not.toMatch(/não verificad/i)
    // e o texto cru do erro não vai para a tela — mas VAI para o log
    expect(d.integracoes.motivo).not.toContain('inbox pegou fogo')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('mas a falha das OUTRAS leituras continua estourando (Lei: falha nunca vira vazio)', async () => {
    semear({ teachers: { error: { message: 'boom' } } })
    await expect(getAjustes(AGORA)).rejects.toThrow(/Ajustes: falha ao ler as professoras/)
  })

  it('NENHUM segredo do ambiente aparece em campo nenhum da tela', async () => {
    ligaTudo()
    semear({
      ...avisoBom('asaas', '2026-08-02T18:30:00Z'),
      teacher_google_accounts: {
        data: [{ teacher_id: 't-dona', last_sync_at: '2026-08-03T12:00:00Z', last_sync_error: null }],
      },
    })
    const d = await getAjustes(AGORA)
    const tudo = JSON.stringify(d.integracoes)
    for (const segredo of [
      'cliente-secreto-google',
      'segredo-google-xyz',
      'https://evo.interno.exemplo',
      'chave-evolution-xyz',
      'instancia-1',
      'token-meta-xyz',
      'numero-meta-xyz',
      'token-asaas-xyz',
      'chave-resend-xyz',
      'hot-secret-xyz',
      'hot-basic-xyz',
      'subdominio-hotmart-xyz',
    ]) {
      expect(tudo, segredo).not.toContain(segredo)
    }
  })
})

/* ========================================================================== */
/* 5. A action                                                                 */
/* ========================================================================== */

const { setTeacherPolicyAction } = await import('@/app/admin/ajustes/actions')
const { tomDoAviso } = await import('@/lib/kit/tom-do-aviso')

/** Roda a action e devolve a URL do redirect (a action sempre termina nela). */
async function rodar(campos: Record<string, string>): Promise<string> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  try {
    await setTeacherPolicyAction(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return e.url
    throw e
  }
  throw new Error('a action não redirecionou')
}

/**
 * A FRASE VEM DO COOKIE, NÃO DA URL (Sol · rodada 1 do A8, grave 3).
 *
 * A versão anterior deste helper era `searchParams.get('msg')` — ou seja, o
 * próprio teste CRISTALIZAVA o padrão proibido: ele passaria a exigir para
 * sempre que a tela nova usasse a ponte das telas velhas. Agora ele lê o
 * cookie de recado, e o padrão antigo é REPROVADO no teste logo abaixo.
 */
const fraseDe = (): string => {
  const cru = pote.get('recado_ajustes')?.value
  return cru ? (JSON.parse(cru).mensagem as string) : ''
}

const BASE = {
  teacher_id: 't-dona',
  lead_hours: '24',
  holiday_policy: 'flag',
  back: '/admin/ajustes',
  back_erro: '/admin/ajustes',
  manter: 'lead_hours,holiday_policy',
  rascunho: 'ajustes-politica:t-dona',
}

describe('A8 · setTeacherPolicyAction', () => {
  it('o caminho bom chama a RPC com o ator e volta com a frase VERDE', async () => {
    const url = await rodar(BASE)
    expect(mock.rpcs).toEqual([
      [
        'admin_set_teacher_policy',
        { p_teacher: 't-dona', p_lead_hours: 24, p_holiday_policy: 'flag', p_actor: 'admin-de-teste' },
      ],
    ])
    const frase = fraseDe()
    expect(frase).toBe('Política da professora atualizada.')
    expect(tomDoAviso(frase)).toBe('sucesso')
    expect(url).toBe('/admin/ajustes')
  })

  /* ---- GRAVE 3: a ponte `?msg=` das telas velhas é REPROVADA aqui --------- */

  it('a URL de volta NÃO carrega recado nenhum — nem msg, nem nonce', async () => {
    const casos = [
      BASE, // sucesso
      { ...BASE, teacher_id: '' }, // recusa antes do banco
    ]
    for (const campos of casos) {
      const url = await rodar(campos)
      const q = new URL(url, 'https://x').searchParams
      expect(q.get('msg'), url).toBeNull()
      expect(q.get('n'), url).toBeNull()
      expect(url, url).not.toContain('msg=')
    }
    // e com a RPC recusando
    mock.respostaRpc = { error: { message: 'boom' } }
    const url = await rodar(BASE)
    expect(url).not.toContain('msg=')
    expect(url).not.toContain('&n=')
  })

  it('VARREDOR: esta tela não escreve `?msg=` nem nonce em lugar nenhum do código', () => {
    // O padrão morreu por FORMULÁRIO nesta onda; nascer usando a ponte das telas
    // velhas é nascer legado. Aqui a proibição fica escrita na fonte.
    for (const arquivo of [
      'src/app/admin/ajustes/actions.ts',
      'src/app/admin/ajustes/page.tsx',
      // peça do kit desde o A5 (era `src/app/admin/ajustes/recado.ts`)
      'src/lib/kit/recado.ts',
      'src/components/admin/ajustes/blocos.tsx',
    ]) {
      const fonte = codigo(arquivo)
      // só o CÓDIGO: os comentários explicam justamente por que ele morreu.
      const semComentario = fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//'))
        .join('\n')
      expect(semComentario, arquivo).not.toMatch(/msg=/)
      expect(semComentario, arquivo).not.toMatch(/Date\.now\(\)/)
      expect(semComentario, arquivo).not.toMatch(/searchParams\.get\(['"]msg/)
    }
  })

  it('o desfecho viaja em cookie httpOnly de vida curta, com caminho estreito', async () => {
    await rodar(BASE)
    const escrita = pote.escritas.findLast((e) => e.nome === 'recado_ajustes')!
    expect(escrita.opcoes.httpOnly).toBe(true)
    expect(escrita.opcoes.sameSite).toBe('lax')
    expect(escrita.opcoes.path).toBe('/admin/ajustes')
    expect(escrita.opcoes.maxAge).toBe(15)
    // cada escrita leva um id próprio: dois envios com a MESMA frase continuam
    // sendo dois avisos (é ele que vira a chave do toast)
    const primeiro = JSON.parse(pote.get('recado_ajustes')!.value).id
    await rodar(BASE)
    expect(JSON.parse(pote.get('recado_ajustes')!.value).id).not.toBe(primeiro)
  })

  it('recusa ANTES de tocar o banco: sem professora, sem horas, horas não inteiras, feriado inválido', async () => {
    const casos: Array<[Record<string, string>, RegExp]> = [
      [{ ...BASE, teacher_id: '' }, /professora não identificada/i],
      // MÉDIO 5: campo esvaziado é recusa — não vira zero, que DESLIGARIA a
      // antecedência mínima sem ninguém ter pedido.
      [{ ...BASE, lead_hours: '' }, /informe a antecedência/i],
      [{ ...BASE, lead_hours: '   ' }, /informe a antecedência/i],
      [{ ...BASE, lead_hours: '12abc' }, /número inteiro/i],
      [{ ...BASE, lead_hours: '2,5' }, /número inteiro/i],
      [{ ...BASE, holiday_policy: 'cancelar' }, /escolha o que fazer/i],
      [{ ...BASE, holiday_policy: '' }, /escolha o que fazer/i],
    ]
    for (const [campos, esperado] of casos) {
      mock.rpcs = []
      await rodar(campos)
      const frase = fraseDe()
      expect(frase, JSON.stringify(campos)).toMatch(esperado)
      expect(tomDoAviso(frase), frase).toBe('erro')
      expect(mock.rpcs, 'a RPC foi chamada num caminho de recusa').toHaveLength(0)
    }
  })

  it('ZERO continua sendo escolha possível — só precisa ser digitado (médio 5)', async () => {
    await rodar({ ...BASE, lead_hours: '0' })
    expect(mock.rpcs[0][1]).toMatchObject({ p_lead_hours: 0 })
    expect(fraseDe()).toBe('Política da professora atualizada.')
  })

  it('{error} da RPC nunca vira sucesso — e o texto CRU do banco não passa', async () => {
    mock.respostaRpc = {
      error: {
        message:
          'permission denied for column min_booking_lead_hours of relation teachers (public.admin_set_teacher_policy)',
      },
    }
    await rodar({ ...BASE, lead_hours: '900' })
    const frase = fraseDe()
    expect(mock.rpcs).toHaveLength(1)
    expect(frase).toContain('Falha:')
    expect(frase).not.toContain('atualizada')
    expect(tomDoAviso(frase)).toBe('erro')
    // nada de nome de coluna, de relação ou de função na cara da dona
    for (const pedaco of ['min_booking_lead_hours', 'relation', 'admin_set_teacher_policy']) {
      expect(frase, pedaco).not.toContain(pedaco)
    }

    // e a recusa de FAIXA sai com a frase da casa, não com a do Postgres
    mock.respostaRpc = { error: { message: 'antecedência mínima fora da faixa: use de 0 a 168 horas' } }
    await rodar({ ...BASE, lead_hours: '900' })
    expect(fraseDe()).toBe(`Falha: ${ANTECEDENCIA_FORA_DA_FAIXA}`)
  })

  it('o erro reabre com o que ela escolheu — no COOKIE, nunca na URL', async () => {
    mock.respostaRpc = { error: { message: 'boom' } }
    const url = await rodar({ ...BASE, lead_hours: '48', holiday_policy: 'cancel_credit' })
    const q = new URL(url, 'https://x').searchParams
    expect(q.get('lead_hours')).toBeNull()
    expect(q.get('holiday_policy')).toBeNull()
    const gravado = JSON.parse(pote.get('rascunho_admin')!.value)
    expect(gravado).toEqual({
      chave: 'ajustes-politica:t-dona',
      campos: { lead_hours: '48', holiday_policy: 'cancel_credit' },
    })
  })

  it('o SUCESSO apaga o rascunho (o próximo formulário nasce limpo)', async () => {
    mock.respostaRpc = { error: { message: 'boom' } }
    await rodar(BASE)
    expect(pote.get('rascunho_admin')).toBeDefined()
    mock.respostaRpc = { data: null, error: null }
    await rodar(BASE)
    expect(pote.get('rascunho_admin')).toBeUndefined()
  })

  it('`back` forjado não é obedecido — nem para fora do site, nem para outra tela do admin', async () => {
    // Sair de /admin/ajustes engoliria o desfecho em silêncio: o cookie do
    // recado tem `path` estreito e nem seria enviado lá.
    for (const forjado of [
      'https://malicioso.exemplo/roubo',
      '//malicioso.exemplo/roubo',
      '/admin/alunos',
    ]) {
      const url = await rodar({ ...BASE, back: forjado })
      expect(url, forjado).toBe('/admin/ajustes')
    }
    // e a aba escolhida, que É desta tela, sobrevive
    expect(await rodar({ ...BASE, back: '/admin/ajustes?bloco=integracoes' })).toBe(
      '/admin/ajustes?bloco=integracoes',
    )
  })
})

/* ========================================================================== */
/* 6. A tela: navegação, abas e estrutura da árvore real                       */
/* ========================================================================== */

const { AJUSTES, tituloDaRota } = await import('@/components/admin/nav')
const {
  BlocoDaPolitica,
  BlocoDasIntegracoes,
  BlocoDasJanelas,
  BlocoDasMensagens,
  CartaoDaIntegracao,
  CorpoDaMensagem,
  ContratosForaDoPadrao,
  LinhaDeAjuste,
  PoliticaDaProfessoraCard,
} = await import('@/components/admin/ajustes/blocos')
type SituacaoDaIntegracao = import('@/data/admin/ajustes').SituacaoDaIntegracao
const { default: AjustesPage } = await import('@/app/admin/ajustes/page')

interface ElementoDaArvore {
  type: unknown
  props: { children?: unknown } & Record<string, unknown>
}
function ehElemento(no: unknown): no is ElementoDaArvore {
  return typeof no === 'object' && no !== null && 'props' in no && 'type' in no
}
function* percorrer(no: unknown): Generator<ElementoDaArvore> {
  if (no == null || typeof no !== 'object') return
  if (Array.isArray(no)) {
    for (const filho of no) yield* percorrer(filho)
    return
  }
  if (!ehElemento(no)) return
  yield no
  yield* percorrer(no.props.children)
}
function textoDe(no: unknown): string {
  if (no == null || typeof no === 'boolean') return ''
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  if (Array.isArray(no)) return no.map(textoDe).join('')
  return ehElemento(no) ? textoDe(no.props.children) : ''
}

describe('A8 · a tela aparece na navegação', () => {
  it('o item Ajustes do menu da conta aponta para a tela nova', () => {
    expect(AJUSTES.href).toBe('/admin/ajustes')
    expect(tituloDaRota('/admin/ajustes')).toBe('Ajustes')
  })

  it('o link salvo de /admin/janelas continua chegando — agora em Ajustes', () => {
    const fonte = codigo('src/app/admin/janelas/page.tsx')
    expect(fonte).toContain("redirect('/admin/ajustes')")
  })
})

describe('A8 · estrutura da página', () => {
  it('as quatro abas existem, e a da URL é a marcada', async () => {
    semear()
    const arvore: unknown = await AjustesPage({
      searchParams: Promise.resolve({ bloco: 'integracoes' }),
    })
    const abas = [...percorrer(arvore)].find((el) => Array.isArray(el.props.tabs))!.props
      .tabs as Array<{ label: string; href: string; active?: boolean }>
    expect(abas.map((t) => t.label)).toEqual([
      'Política de remarcação',
      'Janelas',
      'Mensagens',
      'Integrações',
    ])
    expect(abas.filter((t) => t.active).map((t) => t.label)).toEqual(['Integrações'])
  })

  it('aba desconhecida na URL cai na política, não numa tela vazia', async () => {
    semear()
    const arvore: unknown = await AjustesPage({ searchParams: Promise.resolve({ bloco: 'xpto' }) })
    const els = [...percorrer(arvore)]
    expect(els.some((el) => el.type === BlocoDaPolitica)).toBe(true)
    expect(els.some((el) => el.type === BlocoDasIntegracoes)).toBe(false)
  })

  it('o recado vem do COOKIE e vira toast (AvisoLegado) — a URL não participa', async () => {
    semear()
    pote.set(
      'recado_ajustes',
      JSON.stringify({ mensagem: 'Política da professora atualizada.', id: 'r-7' }),
    )
    const arvore: unknown = await AjustesPage({ searchParams: Promise.resolve({}) })
    const aviso = [...percorrer(arvore)].find((el) => el.props.mensagem !== undefined)!
    expect(aviso.props.mensagem).toBe('Política da professora atualizada.')
    // a chave do toast é o id da ESCRITA, não um nonce vindo da barra de endereços
    expect(aviso.props.chave).toBe('r-7')
  })

  it('sem cookie não há aviso nenhum — e um `?msg=` colado na URL NÃO pinta recado', async () => {
    semear()
    // Recado forjável era um dos defeitos da ponte antiga: qualquer um montava
    // um link que fazia a tela afirmar "Política da professora atualizada.".
    const arvore: unknown = await AjustesPage({
      searchParams: Promise.resolve({
        msg: 'Política da professora atualizada.',
        n: '7',
      } as never),
    })
    expect([...percorrer(arvore)].some((el) => el.props.mensagem !== undefined)).toBe(false)
  })

  it('cookie ilegível não derruba a tela (vira silêncio, não exceção)', async () => {
    semear()
    pote.set('recado_ajustes', 'isto não é json')
    const arvore: unknown = await AjustesPage({ searchParams: Promise.resolve({}) })
    expect([...percorrer(arvore)].some((el) => el.props.mensagem !== undefined)).toBe(false)
  })
})

describe('A8 · o formulário da política', () => {
  const PROFESSORA = {
    id: 't-dona',
    nome: 'Teacher Vicky',
    ehDona: true,
    cidade: 'Cuiabá',
    antecedenciaHoras: 12,
    feriado: 'cancel_credit' as const,
    feriadoCru: 'cancel_credit',
  }

  it('o form aponta para a action da política e leva os campos de volta do erro', async () => {
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const els = [...percorrer(cartao)]
    const form = els.find((el) => el.props.action !== undefined)!
    expect(form.props.action).toBe(setTeacherPolicyAction)
    const escondido = (nome: string) =>
      els.find((el) => el.props.type === 'hidden' && el.props.name === nome)?.props.value
    expect(escondido('teacher_id')).toBe('t-dona')
    expect(escondido('manter')).toBe('lead_hours,holiday_policy')
    expect(escondido('rascunho')).toBe(chaveDaPolitica('t-dona'))
    expect(escondido('back_erro')).toBe('/admin/ajustes')
  })

  it('o rascunho DAQUELA professora reabre o formulário; o da outra não', async () => {
    pote.set(
      'rascunho_admin',
      JSON.stringify({
        chave: chaveDaPolitica('t-ana'),
        campos: { lead_hours: '99', holiday_policy: 'flag' },
      }),
    )
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const stepper = [...percorrer(cartao)].find((el) => el.props.name === 'lead_hours')!
    // chave de OUTRA professora: o campo nasce com o valor do banco
    expect(stepper.props.valorInicial).toBe(12)

    pote.set(
      'rascunho_admin',
      JSON.stringify({
        chave: chaveDaPolitica('t-dona'),
        campos: { lead_hours: '99', holiday_policy: 'flag' },
      }),
    )
    const dela: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const meu = [...percorrer(dela)].find((el) => el.props.name === 'lead_hours')!
    expect(meu.props.valorInicial).toBe(99)
    const marcado = [...percorrer(dela)].find(
      (el) => el.props.type === 'radio' && el.props.defaultChecked === true,
    )!
    expect(marcado.props.value).toBe('flag')
  })

  it('as duas políticas de feriado são RÁDIO com a consequência escrita', async () => {
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const els = [...percorrer(cartao)]
    const radios = els.filter((el) => el.props.type === 'radio')
    expect(radios.map((r) => r.props.value)).toEqual(['flag', 'cancel_credit'])
    expect(radios.filter((r) => r.props.defaultChecked).map((r) => r.props.value)).toEqual([
      'cancel_credit',
    ])
    // nenhum <select> nativo (régua da casa para escolha entre poucos)
    expect(els.some((el) => el.type === 'select')).toBe(false)
    const texto = textoDe(cartao)
    expect(texto).toContain('crédito de reposição')
    expect(texto).toContain('continua de pé')
  })

  it('POLÍTICA DESCONHECIDA: nenhum rádio nasce marcado, e a tela diz o que está gravado (baixo 10)', async () => {
    // O banco ganhou um terceiro valor que esta versão da tela não conhece. A
    // versão anterior mostrava "Só avisar" marcado e, ao salvar outro campo,
    // gravava `flag` POR CIMA da política nova.
    const cartao: unknown = await PoliticaDaProfessoraCard({
      professora: { ...PROFESSORA, feriado: null, feriadoCru: 'politica_nova_do_banco' },
    })
    const els = [...percorrer(cartao)]
    const radios = els.filter((el) => el.props.type === 'radio')
    expect(radios).toHaveLength(2)
    expect(radios.some((r) => r.props.defaultChecked)).toBe(false)
    // e o envio fica travado até ela escolher: `required` no rádio
    expect(radios.every((r) => r.props.required === true)).toBe(true)
    // a tela mostra o valor cru, sem traduzir para nenhuma das duas conhecidas
    expect(textoDe(cartao)).toContain('politica_nova_do_banco')
  })

  it('o rádio tem onde acender o erro, e a frase está escrita no HTML (médio 6)', async () => {
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const els = [...percorrer(cartao)]
    const erro = els.find((el) => el.props['data-slot'] === 'campo-erro')
    expect(erro, 'sem data-slot="campo-erro" o FormValidado não tem onde escrever').toBeDefined()
    expect(erro!.props['data-exigencia']).toMatch(/feriado/i)
    expect(els.some((el) => el.props['data-slot'] === 'campo')).toBe(true)
  })

  it('PISO DE DADO: o que responde a pergunta da tela não vive em text-xs (médio 8)', async () => {
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const els = [...percorrer(cartao)]
    // a pílula "dona" é DADO (diz de quem é a política)
    const pill = els.find((el) => el.props.tone === 'ac')!
    expect(String(pill.props.className)).toContain('text-sm')
    // o fuso também: é ele que decide a que horas a regra vale
    expect(textoDe(cartao)).toContain('fuso de Cuiabá')
    const linhaDoFuso = els.find(
      (el) => Array.isArray(el.props.children) && el.props.children.includes('fuso de '),
    )!
    expect(String(linhaDoFuso.props.className)).toContain('text-sm')
    expect(String(linhaDoFuso.props.className)).not.toContain('text-ink-600')
  })

  it('LINHA EXPLICADA, não formulário cru: cada ajuste tem nome + o que ele faz', async () => {
    const cartao: unknown = await PoliticaDaProfessoraCard({ professora: PROFESSORA })
    const linhas = [...percorrer(cartao)].filter((el) => el.type === LinhaDeAjuste)
    expect(linhas.map((l) => l.props.titulo)).toEqual([
      'Antecedência mínima para marcar',
      'Aulas em feriado',
    ])
    // a explicação é frase de verdade, não rótulo de duas palavras
    for (const l of linhas) expect(String(l.props.explicacao).length).toBeGreaterThan(40)
    expect(textoDe(cartao)).toContain('Salvar política')
  })
})

describe('A8 · os blocos que NÃO editam', () => {
  it('Janelas aponta para a Agenda com a professora filtrada e o painel aberto', () => {
    const arvore: unknown = BlocoDasJanelas({
      professoras: [
        {
          id: 't-ana',
          nome: 'Ana',
          ehDona: false,
          cidade: 'Nova York',
          antecedenciaHoras: 12,
          feriado: 'flag',
          feriadoCru: 'flag',
        },
      ],
    })
    const links = [...percorrer(arvore)].filter((el) => typeof el.props.href === 'string')
    expect(links.map((l) => l.props.href)).toEqual(['/admin/agenda?prof=t-ana&novo=disponibilidade'])
    // e diz, por escrito, que o editor mora lá
    expect(textoDe(arvore)).toMatch(/moram na Agenda/i)
  })

  it('o índice de contratos é LEITURA: link para a ficha, nenhum form', async () => {
    semear({ contracts: { data: [contratoCru({ id: 'c9', alcada: 1, aluno: 'Bia' })] } })
    const dados = await getAjustes(AGORA)
    // o bloco monta o índice como filho; aqui ele é invocado direto, que é o
    // único jeito de varrer a árvore DELE (Server Component não se expande
    // sozinho na travessia)
    const arvore: unknown = ContratosForaDoPadrao({
      contratos: dados.contratosForaDoPadrao,
      conferidos: dados.contratosConferidos,
    })
    expect([...percorrer(BlocoDaPolitica({ dados }))].some((el) => el.type === ContratosForaDoPadrao)).toBe(true)
    const els = [...percorrer(arvore)]
    const link = els.find((el) => el.props.href === '/admin/contratos/c9')
    expect(link, 'o índice não aponta para a ficha do contrato').toBeDefined()
    // o índice não desenha editor nenhum: nenhum campo de regra de contrato
    expect(els.some((el) => el.props.name === 'allowance')).toBe(false)
    const texto = textoDe(arvore)
    expect(texto).toContain('1 por mês')
    expect(texto).toContain('(padrão: 4 por mês)')
  })

  const integracao = (situacao: SituacaoDaIntegracao) => ({
    nome: 'WhatsApp',
    paraQue: 'manda lembrete',
    situacao,
    frase: 'As chaves estão no ambiente.',
    evidencia: 'Último sinal processado hoje às 09:00.',
    alerta: null,
  })

  it('cada situação tem o tom certo — e só a FALHA é vermelha', () => {
    const esperado: Array<[SituacaoDaIntegracao, string, string]> = [
      ['ligada', 'ok', 'funcionando'],
      ['falhando', 'danger', 'com falha'],
      ['nao_verificada', 'neutral', 'não verificado'],
      ['desligada', 'muted', 'não ligada'],
    ]
    for (const [situacao, tom, rotulo] of esperado) {
      const arvore: unknown = CartaoDaIntegracao({ integracao: integracao(situacao) })
      const pill = [...percorrer(arvore)].find((el) => el.props.tone !== undefined)!
      expect(pill.props.tone, situacao).toBe(tom)
      expect(textoDe(pill), situacao).toBe(rotulo)
      // MÉDIO 8: a pílula É a resposta da tela — piso de DADO, nunca text-xs
      expect(String(pill.props.className), situacao).toContain('text-sm')
    }
  })

  it('a data do último sinal é DADO, não apoio (médio 8)', () => {
    const arvore: unknown = CartaoDaIntegracao({ integracao: integracao('ligada') })
    const linha = [...percorrer(arvore)].find(
      (el) => el.props.children === 'Último sinal processado hoje às 09:00.',
    )!
    expect(String(linha.props.className)).toContain('text-ink-900')
    expect(String(linha.props.className)).not.toContain('text-ink-600')
  })

  it('#41: o cartão de WhatsApp mostra o nome do template na Meta, como DADO', () => {
    const arvore: unknown = BlocoDasMensagens({ agora: AGORA })
    const corpos = [...percorrer(arvore)].filter((el) => el.type === CorpoDaMensagem)
    const nomes = corpos.map((el) => el.props.nomeNaMeta).filter(Boolean)
    expect(nomes).toContain('class_reminder_48h_amanha')
    expect(nomes).toContain('reschedule_confirm_escola_moveu')
    // as três sem template dizem isso por escrito: as três saem só por e-mail
    // desde a M3-1 (#42), e nenhuma diz mais que "ainda sai pelo WhatsApp"
    const texto = textoDe(arvore)
    expect(texto.split(SEM_TEMPLATE_SO_EMAIL)).toHaveLength(4)
    expect(texto.split(SEM_TEMPLATE_AINDA_SAI)).toHaveLength(1)
    // R3 do revisor (PR #90): o título pequeno é só "WhatsApp"; o caso vai como prop própria
    expect(corpos.filter((el) => el.props.titulo !== 'WhatsApp' && el.props.titulo !== 'E-mail')).toEqual([])
    expect(corpos.map((el) => el.props.caso)).toContain('Toque de 48h, aula amanhã')

    const cartao: unknown = CorpoDaMensagem({
      titulo: 'WhatsApp',
      caso: 'Toque de 48h, aula amanhã',
      texto: 'Olá, Marina!',
      nomeNaMeta: 'class_reminder_48h_amanha',
    })
    // o caso é o único nome que distingue os seis corpos do lembrete: RÓTULO, não apoio
    const caso = [...percorrer(cartao)].find((el) => el.props.children === 'Toque de 48h, aula amanhã')!
    expect(caso, 'o caso sumiu do cartão').toBeDefined()
    expect(String(caso.props.className)).toContain('text-sm')
    expect(String(caso.props.className)).not.toContain('text-xs')
    expect(String(caso.props.className)).not.toContain('text-ink-400')
    expect(textoDe(cartao)).toContain('class_reminder_48h_amanha')
    const nome = [...percorrer(cartao)].find((el) => el.props.children === 'class_reminder_48h_amanha')!
    expect(String(nome.props.className)).toContain('text-ink-900')
    expect(String(nome.props.className)).toContain('text-sm')
    // sem nome na Meta, nenhuma linha de nome
    expect(textoDe(CorpoDaMensagem({ titulo: 'WhatsApp', texto: 'oi', nomeNaMeta: null }))).not.toContain('Meta')
  })

  it('bloco de integrações que FALHOU ao ler mostra a falha, não uma lista vazia (médio 7)', () => {
    const arvore: unknown = BlocoDasIntegracoes({
      bloco: { ok: false, motivo: 'Não consegui ler o estado das integrações agora.' },
    })
    const els = [...percorrer(arvore)]
    expect(els.some((el) => el.props.tone !== undefined), 'pintou pílula de estado sem ter lido').toBe(
      false,
    )
    const alerta = els.find((el) => el.props.role === 'alert')!
    expect(textoDe(alerta)).toContain('Não consegui ler')
  })
})

/* ========================================================================== */
/* 7. O stepper no DOM — nada invisível continua clicável                      */
/* ========================================================================== */

const { PassoDeHoras } = await import('@/components/admin/ajustes/PassoDeHoras')

let root: Root | undefined
let container: HTMLDivElement | undefined

async function montar(valorInicial: number): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(h(PassoDeHoras, { name: 'lead_hours', valorInicial, rotulo: 'antecedência da dona' }))
  })
  return el
}

afterEach(async () => {
  if (root) {
    const r = root
    root = undefined
    await act(async () => r.unmount())
  }
  container?.remove()
  container = undefined
  document.body.innerHTML = ''
})

describe('A8 · stepper da antecedência', () => {
  it('o [−]/[+] anda de uma em uma e a frase da consequência acompanha', async () => {
    const c = await montar(23)
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!
    const [menos, mais] = [...c.querySelectorAll('button')]
    expect(campo.value).toBe('23')
    await act(async () => mais.click())
    expect(campo.value).toBe('24')
    expect(c.textContent).toContain('24 horas (1 dia)')
    await act(async () => menos.click())
    expect(campo.value).toBe('23')
  })

  it('no limite o botão fica VISÍVEL e desabilitado — nunca invisível e clicável', async () => {
    const c = await montar(ANTECEDENCIA_MIN)
    const [menos, mais] = [...c.querySelectorAll('button')]
    expect(menos.disabled).toBe(true)
    expect(mais.disabled).toBe(false)
    // visível: sem `hidden`, sem opacidade zero, sem sumiço por classe
    expect(menos.hasAttribute('hidden')).toBe(false)
    expect(menos.className).not.toMatch(/\bopacity-0\b|\binvisible\b|\bhidden\b|\bsr-only\b/)
    // e o clique no desabilitado não anda com o valor
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!
    await act(async () => menos.click())
    expect(campo.value).toBe(String(ANTECEDENCIA_MIN))
  })

  it('no teto o [+] desabilita, e o campo carrega a faixa do banco', async () => {
    const c = await montar(ANTECEDENCIA_MAX)
    const [, mais] = [...c.querySelectorAll('button')]
    expect(mais.disabled).toBe(true)
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!
    expect(campo.min).toBe(String(ANTECEDENCIA_MIN))
    expect(campo.max).toBe(String(ANTECEDENCIA_MAX))
    expect(campo.required).toBe(true)
  })

  it('os alvos de toque têm 44px (a tela é usada no celular)', async () => {
    const c = await montar(12)
    for (const b of c.querySelectorAll('button')) expect(b.className).toContain('h-11')
    expect(c.querySelector('input[name="lead_hours"]')!.className).toContain('h-11')
  })

  /* ---- MÉDIO 5: apagar o número NÃO vira zero silencioso ------------------ */

  /** Digita no campo como a pessoa digita (React ouve o evento nativo). */
  async function digitar(campo: HTMLInputElement, texto: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(campo, texto)
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('apagar o campo o deixa VAZIO — nunca 0 (que desligaria a antecedência)', async () => {
    const c = await montar(24)
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!

    await digitar(campo, '')
    // O defeito: `Number('')` é 0, e o campo aparecia "0" na tela.
    expect(campo.value).toBe('')
    expect(campo.value).not.toBe('0')
    // e a frase da consequência NÃO afirma a regra de zero
    expect(c.textContent).not.toContain('até a hora de começar')
    expect(c.textContent).toContain(ANTECEDENCIA_VAZIA)
    // o envio é recusado pelo navegador (e, se passasse, pela action e pelo banco)
    expect(campo.checkValidity()).toBe(false)
    expect(campo.validity.valueMissing).toBe(true)

    // ZERO continua possível — mas digitado, e aí a frase muda
    await digitar(campo, '0')
    expect(campo.value).toBe('0')
    expect(c.textContent).toContain('até a hora de começar')
    expect(campo.checkValidity()).toBe(true)
  })

  it('com o campo vazio os dois botões ficam VISÍVEIS e inertes (nada invisível clicável)', async () => {
    const c = await montar(24)
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!
    await digitar(campo, '')
    const [menos, mais] = [...c.querySelectorAll('button')]
    for (const b of [menos, mais]) {
      expect(b.disabled).toBe(true)
      expect(b.hasAttribute('hidden')).toBe(false)
      expect(b.className).not.toMatch(/\bopacity-0\b|\binvisible\b|\bhidden\b|\bsr-only\b/)
    }
    // e clicar no inerte não inventa número nenhum
    await act(async () => mais.click())
    expect(campo.value).toBe('')
  })

  /* ---- MÉDIO 6: a faixa estourada DIZ o que está errado ------------------- */

  it('169 explica o que está errado — na tela e para o leitor de tela', async () => {
    const c = await montar(24)
    const campo = c.querySelector<HTMLInputElement>('input[name="lead_hours"]')!
    await digitar(campo, String(ANTECEDENCIA_MAX + 1))

    // 1. o envio é bloqueado…
    expect(campo.checkValidity()).toBe(false)
    // 2. …e agora COM frase — `setCustomValidity` é a causa de maior
    //    precedência em `mensagemDoCampo`, então ela ganha da genérica
    expect(campo.validationMessage).toBe(ANTECEDENCIA_FORA_DA_FAIXA)
    // 3. a consequência escrita para de mentir uma regra que não existe
    expect(c.textContent).toContain(ANTECEDENCIA_FORA_DA_FAIXA)
    expect(c.textContent).not.toMatch(/Precisa marcar com pelo menos 169/)

    // 4. e o campo mora num `data-slot="campo"` com o parágrafo do erro pronto —
    //    sem isso o `FormValidado` põe `aria-invalid` e não tem onde escrever
    const no = campo.closest('[data-slot="campo"]')
    expect(no, 'o stepper não está num data-slot="campo"').not.toBeNull()
    const erro = no!.querySelector('[data-slot="campo-erro"]')
    expect(erro).not.toBeNull()
    expect(erro!.getAttribute('role')).toBe('alert')
    expect(erro!.querySelector('[data-slot="campo-erro-texto"]')!.textContent).toBe(
      ANTECEDENCIA_VAZIA,
    )

    // 5. voltando à faixa, a recusa some (prova de mutação na outra direção)
    await digitar(campo, String(ANTECEDENCIA_MAX))
    expect(campo.checkValidity()).toBe(true)
    expect(campo.validationMessage).toBe('')
  })

  it('cada botão tem nome acessível próprio (dois "−" na tela não se confundem)', async () => {
    const c = await montar(12)
    const [menos, mais] = [...c.querySelectorAll('button')]
    expect(menos.getAttribute('aria-label')).toBe('Diminuir antecedência da dona')
    expect(mais.getAttribute('aria-label')).toBe('Aumentar antecedência da dona')
  })
})
