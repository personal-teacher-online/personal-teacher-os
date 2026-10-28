// HIGIENE DE ACL — a porta do `anon` fechada (leva própria, decisão do dono
// depois do achado da janela §AJ).
//
// 📌 REGRA 7 do fluxo da frente: este arquivo nasceu VERMELHO e foi commitado
// assim, ANTES da migration. Migration aplicada é imutável (Lei 7).
//
// ── O QUE ESTA LEVA FECHA, E POR QUE ISSO É SEGURO ──────────────────────────
// Medido em produção antes de escrever qualquer linha: das 542 funções do
// schema `public`, 306 são de EXTENSÃO (btree_gist, vector) e 236 são nossas —
// 74 delas executáveis por `anon`. Fechar é seguro porque (a) NENHUMA das 97
// policies de RLS se aplica a `anon` (todas nomeiam papel explícito), (b) não
// existe cliente de navegador no projeto, então nenhum RPC sai como anon, e
// (c) ZERO funções que `authenticated` ou `service_role` executam dependem do
// `PUBLIC` — todas têm grant explícito.
//
// ⚠️ REVOGAR DO `PUBLIC` É OBRIGATÓRIO: `anon` herda o EXECUTE do PUBLIC, então
// `revoke … from anon` sozinho não fecha nada (o inverso da lição da 109, onde
// `revoke … from public` não tirava o grant do papel nomeado).
//
// ⚠️ TESTE DE ACL NO LOCAL É FALSO-VERDE (lição da 109): aqui o default
// privilege do `postgres` não concede a anon como em produção. Por isso o caso
// da fonte estancada pina o TEXTO da migration — a prova que vale é a sonda da
// janela de deploy.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Sql } from 'postgres'
import { connect } from './helpers/db'

let sql: Sql

/** As nossas funções: tudo no `public` que NÃO pertence a uma extensão. */
const NOSSAS = `
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    -- Achado 1 do Sol: a identidade em pg_depend e (classid, objid, objsubid).
    -- Sem classid, uma funcao nossa cujo OID coincida com o de outro objeto de
    -- extensao sairia da conta -- e o guard ficaria verde por cima do buraco.
    and not exists (
      select 1 from pg_depend d
       where d.classid = 'pg_proc'::regclass
         and d.objid = p.oid
         and d.refclassid = 'pg_extension'::regclass
         and d.deptype = 'e'
    )`

const MIGRATION = new URL(
  '../supabase/migrations/20260804000200_higiene_acl_anon.sql',
  import.meta.url,
)

beforeAll(async () => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

describe('a porta do anon', () => {
  it('NENHUMA função nossa é executável por anon', async () => {
    // A conta sai do catálogo, não de uma lista escrita à mão: função nova
    // entra aqui sozinha, e é isso que faz este caso valer daqui para a frente.
    const expostas = (await sql`
      select p.proname::text as nome,
             p.prosecdef as definer,
             p.prorettype = 'trigger'::regtype as gatilho
        ${sql.unsafe(NOSSAS)}
         and has_function_privilege('anon', p.oid, 'execute')
       order by 1`) as unknown as Array<{ nome: string; definer: boolean; gatilho: boolean }>

    expect(
      expostas.map((f) => f.nome),
      `funções expostas a anon: ${expostas.length}`,
    ).toEqual([])
  })

  it('as 5 que vazavam leitura recusam o anônimo — e as 2 internas recusam até o logado', async () => {
    const acl = (await sql`
      select p.proname::text as nome,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as autenticado
        ${sql.unsafe(NOSSAS)}
         and p.proname in ('_teacher_payable_cents', '_teacher_rate_on',
                           'my_contract_ids', 'my_group_ids', 'teacher_student_ids')
       order by 1`) as unknown as Array<{ nome: string; anon: boolean; autenticado: boolean }>

    expect(acl).toHaveLength(5)
    for (const f of acl) expect(f.anon, `${f.nome} exposta a anon`).toBe(false)

    // Os dois helpers com `_` são chamados só de dentro de funções `definer`
    // (que rodam como o dono), então nem o usuário logado precisa deles — e são
    // eles que vazam taxa horária de professora.
    const internas = acl.filter((f) => f.nome.startsWith('_teacher_'))
    for (const f of internas) expect(f.autenticado, `${f.nome} exposta a authenticated`).toBe(false)

    // As três de RLS continuam de pé para quem consulta: são elas que as
    // policies chamam, e sem EXECUTE toda leitura do portal viraria erro.
    const deRls = acl.filter((f) => !f.nome.startsWith('_teacher_'))
    for (const f of deRls) expect(f.autenticado, `${f.nome} perdeu o authenticated`).toBe(true)
  })

  it('função nova NASCE exposta — a fonte não fecha, e é por isso que o guard acima existe', async () => {
    // ⚠️ Este caso documenta uma REALIDADE MEDIDA, não um desejo.
    //
    // `alter default privileges … revoke execute … from public` NÃO faz função
    // nova nascer fechada: o EXECUTE do PUBLIC vem do default EMBUTIDO do
    // Postgres, que aquele comando não remove (testado nas duas formas, com e
    // sem `for role`). Fechar na raiz pediria um EVENT TRIGGER, e criar um
    // exige SUPERUSUÁRIO — que o papel `postgres` não é neste Supabase.
    //
    // Logo: toda migration que cria função precisa revogar NOMINALMENTE, e é o
    // primeiro caso deste arquivo que cobra. No dia em que o Postgres ou o
    // Supabase mudarem isso, ESTE caso fica vermelho — e aí a disciplina manual
    // pode ser aposentada.
    const texto = readFileSync(MIGRATION, 'utf8')
    expect(texto).toMatch(/alter default privileges/i)
    expect(texto).toMatch(/NÃO faz função nova nascer fechada/i)

    await sql`create or replace function public._acl_fixture_nova() returns int
              language sql immutable as $$ select 1 $$`
    try {
      const [f] = (await sql`
        select has_function_privilege('anon', 'public._acl_fixture_nova()', 'execute') as anon`) as unknown as {
        anon: boolean
      }[]
      expect(f.anon, 'o Postgres mudou: função nova já nasce fechada').toBe(true)
    } finally {
      await sql`drop function if exists public._acl_fixture_nova()`
    }
  })
})

describe('o que NÃO pode quebrar junto', () => {
  it('o MCP continua com EXECUTE no FECHO das três funções que ele chama', async () => {
    // Achado 7 do Sol: provar chamando é falso-verde aqui — `mentorship_can_book`
    // levanta "contrato não existe" ANTES de tocar `business_today`,
    // `mentorship_validity_end` e as outras, então a chamada não exercita o fecho.
    // A prova é privilégio, função a função. Achado 10: não se concede o papel ao
    // `postgres` só para conseguir `set role` — isso seria membership permanente
    // criada por conveniência de teste.
    const fecho = [
      'makeup_balance',
      'mentorship_windows_unlocked',
      'mentorship_can_book',
      'makeup_remaining_expiries',
      '_makeup_remaining_credits',
      'mentorship_next_window',
      'mentorship_validity_end',
      'business_today',
      'business_tz',
    ]
    const acl = (await sql`
      select p.proname::text as nome,
             has_function_privilege('ptos_mcp_ro', p.oid, 'execute') as ok
        ${sql.unsafe(NOSSAS)}
         and p.proname = any(${fecho})
       order by 1`) as unknown as Array<{ nome: string; ok: boolean }>

    expect(acl.length, 'alguma função do fecho sumiu do banco').toBe(fecho.length)
    expect(acl.filter((f) => !f.ok).map((f) => f.nome), 'o MCP perdeu o EXECUTE').toEqual([])
  })

  it('as funções que o app chama por sessão continuam executáveis por authenticated', async () => {
    // Amostra que cobre as cadeias transitivas de função `invoker` (a que
    // depende do EXECUTE do papel CHAMADOR, não do dono).
    const nomes = [
      'makeup_balance',
      'makeup_remaining_expiries',
      '_makeup_remaining_credits',
      'contract_active_slot_duration',
      'contract_credit_summary',
      'student_credit_totals',
      'mentorship_can_book',
      'mentorship_windows_unlocked',
      'mentorship_next_window',
      'mentorship_validity_end',
      'business_today',
      'business_tz',
      'app_role',
      'my_student_ids',
      'my_teacher_id',
      'teacher_contract_ids',
      'roteiros_gerados_hoje',
      'teto_diario_de_roteiros',
      'payment_situacao',
    ]
    const acl = (await sql`
      select p.proname::text as nome,
             has_function_privilege('authenticated', p.oid, 'execute') as ok
        ${sql.unsafe(NOSSAS)}
         and p.proname = any(${nomes})
       order by 1`) as unknown as Array<{ nome: string; ok: boolean }>

    const faltando = acl.filter((f) => !f.ok).map((f) => f.nome)
    expect(faltando, 'perderam o EXECUTE de authenticated').toEqual([])
    expect(acl.length, 'alguma função da amostra sumiu do banco').toBe(nomes.length)
  })

  it('as 16 que dependiam de herança agora têm grant EXPLÍCITO (achado 8 do Sol)', async () => {
    // Não basta a suíte cheia passar: estas 16 precisam de guard determinístico,
    // porque várias (a família slide_image_*, os CHECK de briefing) só aparecem
    // em formas específicas de INSERT/UPDATE que nem todo caminho exercita.
    const dezesseis = [
      '_briefing_em_branco', '_briefing_update_secoes_ok',
      'cancel_class', 'complete_class', 'contract_active_slot_duration',
      'payment_em_aberto', 'payment_nao_cobravel', 'payment_situacao',
      'slide_image_approve', 'slide_image_approve_and_link', 'slide_image_failed',
      'slide_image_ready', 'slide_image_reject', 'slide_image_request',
      'slide_image_started', 'slide_image_supersede',
    ]
    const acl = (await sql`
      select p.proname::text as nome,
             has_function_privilege('authenticated', p.oid, 'execute') as ok,
             array_to_string(coalesce(p.proacl, '{}'), ' ') ~ 'authenticated=X' as explicito
        ${sql.unsafe(NOSSAS)}
         and p.proname = any(${dezesseis})
       order by 1`) as unknown as Array<{ nome: string; ok: boolean; explicito: boolean }>

    expect(acl.length).toBe(dezesseis.length)
    expect(acl.filter((f) => !f.ok).map((f) => f.nome), 'sem EXECUTE').toEqual([])
    expect(
      acl.filter((f) => !f.explicito).map((f) => f.nome),
      'com EXECUTE mas por HERANÇA, não por grant explícito',
    ).toEqual([])
  })

  it('nenhuma função NOVA fica exposta ao logado sem checar quem chamou', async () => {
    // A leva do `authenticated` foi MEDIDA em 04/08 e morreu aí: das 171 nossas
    // que o logado executa, 109 são `definer` que checam quem chama, 30 são
    // `invoker` (a RLS protege), 28 são gatilho e 4 pareciam sem checagem — mas
    // três delas (`student_*`) chamam um guarda (`_..._permitido()`) e filtram
    // por `my_contract_ids()`, que lê o JWT. Não havia o que revogar.
    //
    // O que fica no lugar da dívida é este tripwire: função `definer` nova,
    // chamável pelo logado e SEM nenhuma checagem de chamador acende vermelho —
    // e aí se decide caso a caso, com o corpo na mão.
    const CHECAGENS =
      'app_role\\(\\)|auth\\.jwt\\(\\)|auth\\.uid\\(\\)|current_setting\\(.request' +
      '|_permitido\\(\\)|my_contract_ids\\(\\)|my_student_ids\\(\\)|my_teacher_id\\(\\)' +
      '|teacher_contract_ids\\(\\)|teacher_student_ids\\(\\)|_can_manage'

    // Declarado e revisto: devolve o texto da política vigente da escola, que
    // todo usuário logado precisa ler (tela /portal/ciencia). Não é dado de
    // ninguém em particular.
    const DELIBERADAS = ['policy_vigente']

    const sem = (await sql`
      select p.proname::text as nome
        ${sql.unsafe(NOSSAS)}
         and has_function_privilege('authenticated', p.oid, 'execute')
         and p.prosecdef
         and p.prorettype <> 'trigger'::regtype
         and pg_get_functiondef(p.oid) !~* ${CHECAGENS}
       order by 1`) as unknown as Array<{ nome: string }>

    expect(sem.map((f) => f.nome), 'definer sem checagem de chamador').toEqual(DELIBERADAS)
  })

  it('as funções de EXTENSÃO não foram tocadas', async () => {
    // Revogar `vector`/`btree_gist` quebraria embeddings e as constraints de
    // exclusão. O laço da migration exclui tudo que tem dependência de extensão.
    // Achado 9 do Sol: "mais de 200" passaria mesmo perdendo dezenas. A conta
    // certa é: TODAS as funções de extensão continuam executáveis — o total e o
    // executável têm de ser o MESMO número.
    const [ext] = (await sql`
      select count(*)::int as total,
             count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))::int as executaveis
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and exists (
           select 1 from pg_depend d
            where d.classid = 'pg_proc'::regclass
              and d.objid = p.oid
              and d.refclassid = 'pg_extension'::regclass
              and d.deptype = 'e'
         )`) as unknown as { total: number; executaveis: number }[]
    expect(ext.total).toBeGreaterThan(200)
    expect(ext.executaveis, 'alguma função de extensão perdeu o EXECUTE').toBe(ext.total)
  })
})

// ── VIEWS (Onda Financeiro · F1) ────────────────────────────────────────────
// A view roda com os direitos do DONO por default — que aqui é `postgres` e
// ATRAVESSA a RLS das tabelas de baixo. As três primeiras views da casa são
// definer DE PROPÓSITO (filtram por `my_*()`/colunas mínimas e são a porta de
// leitura do aluno/professora); qualquer view NOVA nasce `security_invoker`,
// para que a proteção seja a RLS de quem chama — `payments_admin` é a
// primeira. View nova sem a opção acende vermelho AQUI, e aí se decide com o
// corpo na mão (e entra na allowlist por nome, com o porquê).
describe('a porta das views', () => {
  const DEFINER_POR_DESENHO = ['payments_student', 'teacher_agenda', 'teacher_public']

  it('view nova é security_invoker — definer é allowlist nominal', async () => {
    const views = (await sql`
      select c.relname::text as nome,
             coalesce(array_to_string(c.reloptions, ','), '') ~ 'security_invoker=(true|on)' as invoker
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
       order by 1`) as unknown as Array<{ nome: string; invoker: boolean }>

    const definerForaDaLista = views
      .filter((v) => !v.invoker && !DEFINER_POR_DESENHO.includes(v.nome))
      .map((v) => v.nome)
    expect(definerForaDaLista, 'view DEFINER fora da allowlist (atravessa RLS)').toEqual([])

    // A allowlist não pode virar letra morta: as três continuam existindo.
    const nomes = views.map((v) => v.nome)
    for (const esperada of DEFINER_POR_DESENHO) expect(nomes).toContain(esperada)
  })
})
