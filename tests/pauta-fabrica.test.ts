// PAUTA — criadores de referência (M4 do ciclo 1 de conteúdo). PARTE 1 dos
// guards da fábrica de pauta: shape, unicidade, colunas do robô, DELETE,
// auditoria e RLS. A parte 2 (`content_research`, supersessão) entra NESTE
// arquivo no M5.
//
// 📌 REGRA 7 do fluxo da frente (`docs/fluxo-frente-conteudo.md`): este arquivo
// nasceu VERMELHO e foi commitado assim, ANTES da migration 20260801000100.
// Migration aplicada é imutável (Lei 7) — é aqui que o workflow "teste primeiro"
// paga o preço dele.
//
// Regra da casa: arquivos rodam em paralelo — fixtures próprias (handle único),
// NUNCA contagem global.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import {
  CASA_DA_PAUTA,
  PLATAFORMAS,
  TIERS,
  TIPOS,
  ehHandle,
  enderecoDoPainel,
  fraseDaRecusaDoBanco,
  normalizarHandle,
} from '@/data/admin/pauta-gramatica'
import { destinoDaSecao, destinoDoRecado } from '@/lib/kit/recado'

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin pauta')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Handle de fixture: único e JÁ no formato canônico (`-` é permitido). */
function hnd(prefixo: string): string {
  return `${prefixo}-${crypto.randomUUID().slice(0, 8)}`
}

async function criar(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from('content_creators')
    .insert({
      plataforma: 'youtube',
      handle: hnd('yt'),
      nome: 'Criador de teste',
      pais: 'BR',
      created_by: adminId,
      ...over,
    })
    .select('id')
    .single()
  expect(error, `INSERT recusado: ${error?.message}`).toBeNull()
  return data!.id as string
}

describe('content_creators — shape e guard (parte 1)', () => {
  it('cadastra em TODAS as plataformas da gramática; nasce ativo, sem medição e com dono', async () => {
    // A lista do TypeScript e o CHECK do banco são dois lados do mesmo contrato:
    // rede acrescentada na gramática sem migration aditiva morre aqui.
    for (const plataforma of PLATAFORMAS) {
      const id = await criar({ plataforma, handle: hnd(plataforma) })
      const [row] = await sql`select * from content_creators where id = ${id}`
      expect(row.plataforma).toBe(plataforma)
      expect(row.ativo).toBe(true)
      expect(row.metricas).toEqual({})
      expect(row.medido_em).toBeNull()
      expect(row.created_by).toBe(adminId)
    }
  })

  it('recusa plataforma fora da lista, mercado fora de BR/INT e nome vazio', async () => {
    const rede = await admin.from('content_creators').insert({
      plataforma: 'linkedin', handle: hnd('li'), nome: 'X', pais: 'BR', created_by: adminId,
    })
    expect(rede.error?.message).toMatch(/content_creators_plataforma_check/)

    const pais = await admin.from('content_creators').insert({
      plataforma: 'youtube', handle: hnd('pt'), nome: 'X', pais: 'PT', created_by: adminId,
    })
    expect(pais.error?.message).toMatch(/content_creators_pais_check/)

    const nome = await admin.from('content_creators').insert({
      plataforma: 'youtube', handle: hnd('sem-nome'), nome: '   ', pais: 'BR', created_by: adminId,
    })
    expect(nome.error?.message).toMatch(/content_creators_nome_check/)
  })

  it('handle é canônico no BANCO: espaço, @ e URL colada explodem — com a frase certa na tela', async () => {
    for (const ruim of [' escola ', '@escola', 'https://youtube.com/@escola', 'duas palavras', '']) {
      const { error } = await admin.from('content_creators').insert({
        plataforma: 'youtube', handle: ruim, nome: 'X', pais: 'BR', created_by: adminId,
      })
      expect(error?.message, `o banco ACEITOU o handle «${ruim}»`).toMatch(
        /content_creators_handle_formato/,
      )
      // A frase da tela é provada contra a mensagem REAL do Postgres — regex de
      // recusa que não casa com o texto do banco vira "erro desconhecido" na cara
      // da dona, e só um teste assim pega isso.
      expect(fraseDaRecusaDoBanco(error?.message)).toMatch(/só o @ do perfil/)
    }

    // A CAIXA digitada é preservada (quem ignora caixa é o índice único).
    const h = hnd('AskJackie')
    const id = await criar({ handle: h })
    const [row] = await sql`select handle from content_creators where id = ${id}`
    expect(row.handle).toBe(h)
  })

  it('unique é case-insensitive por plataforma; o mesmo @ em outra rede passa', async () => {
    const h = hnd('EnglishInBrazil')
    await criar({ plataforma: 'youtube', handle: h })

    const dup = await admin.from('content_creators').insert({
      plataforma: 'youtube', handle: h.toLowerCase(), nome: 'Cópia', pais: 'BR', created_by: adminId,
    })
    expect(dup.error?.message).toMatch(/content_creators_plataforma_handle_unique|duplicate key/)
    expect(fraseDaRecusaDoBanco(dup.error?.message)).toMatch(/já está cadastrado nessa plataforma/)

    const outraRede = await admin.from('content_creators').insert({
      plataforma: 'instagram', handle: h, nome: 'Mesma pessoa, outra rede', pais: 'BR',
      created_by: adminId,
    })
    expect(outraRede.error).toBeNull()
  })

  it('medição: dado exige carimbo; medição VAZIA com carimbo é legítima (o caso Vanessa)', async () => {
    const id = await criar()
    const robo = serviceClient()
    const agora = new Date().toISOString()

    const semCarimbo = await robo
      .from('content_creators')
      .update({ metricas: { views: 10 } })
      .eq('id', id)
    expect(semCarimbo.error?.message).toMatch(/medicao_shape/)

    const medida = await robo
      .from('content_creators')
      .update({ metricas: { views: 10, shorts: 3 }, medido_em: agora })
      .eq('id', id)
    expect(medida.error).toBeNull()

    // SNAPSHOT: a medição nova SUBSTITUI a anterior (não acumula — decisão do goal).
    const remedida = await robo
      .from('content_creators')
      .update({ metricas: { views: 99 }, medido_em: agora })
      .eq('id', id)
    expect(remedida.error).toBeNull()
    const [row] = await sql`select metricas, medido_em from content_creators where id = ${id}`
    expect(row.metricas).toEqual({ views: 99 })
    expect(row.medido_em).not.toBeNull()

    // O CASO VANESSA (achado real do spike M2.0: canal sem NENHUM Short em 100
    // uploads). "Mediu e não achou nada" precisa ser representável — por isso o
    // check é implicação, não bicondicional.
    const vazia = await robo
      .from('content_creators')
      .update({ metricas: {}, medido_em: agora })
      .eq('id', id)
    expect(vazia.error).toBeNull()
  })

  it('as colunas de medição são do ROBÔ: humano não digita métrica, robô não edita cadastro', async () => {
    const id = await criar()
    const robo = serviceClient()

    // A regra "a tela nunca envia métrica" vive no BANCO (grant por coluna), não
    // só na action — outra porta de escrita não a contorna.
    const humano = await admin
      .from('content_creators')
      .update({ metricas: { views: 1 }, medido_em: new Date().toISOString() })
      .eq('id', id)
    expect(humano.error?.message).toMatch(/permission denied/i)
    expect(fraseDaRecusaDoBanco(humano.error?.message)).toMatch(/robô de pesquisa/)

    const roboNoCadastro = await robo
      .from('content_creators')
      .update({ nome: 'Renomeado pelo robô' })
      .eq('id', id)
    expect(roboNoCadastro.error?.message).toMatch(/permission denied/i)
  })

  it('DELETE é proibido (guard no owner; sem grant para authenticated)', async () => {
    const id = await criar()
    await expect(sql`delete from content_creators where id = ${id}`).rejects.toThrow(
      /não se apaga/,
    )
    const { error } = await admin.from('content_creators').delete().eq('id', id)
    expect(error).not.toBeNull()
  })

  it('desativar é UPDATE, e o carimbo de updated_at anda', async () => {
    const id = await criar()
    const [antes] = await sql`select updated_at from content_creators where id = ${id}`

    const { error } = await admin.from('content_creators').update({ ativo: false }).eq('id', id)
    expect(error).toBeNull()

    const [depois] = await sql`select ativo, updated_at from content_creators where id = ${id}`
    expect(depois.ativo).toBe(false)
    expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime())

    const volta = await admin.from('content_creators').update({ ativo: true }).eq('id', id)
    expect(volta.error).toBeNull()
  })

  it('auditoria registra insert e update com entidade e ação certas (Lei 8)', async () => {
    const id = await criar()
    const { error } = await admin
      .from('content_creators')
      .update({ notas: 'passou a postar 3x por semana' })
      .eq('id', id)
    expect(error).toBeNull()

    const linhas = await sql<{ action: string; n: number }[]>`
      select action, count(*)::int as n
        from audit_log
       where entity = 'content_creators' and entity_id = ${id}
       group by action`
    const porAcao = Object.fromEntries(linhas.map((l) => [l.action, l.n]))
    expect(porAcao.insert).toBe(1)
    expect(porAcao.update).toBeGreaterThanOrEqual(1)
    expect(porAcao.delete).toBeUndefined()
  })
})

describe('content_creators — RLS (padrão caso 12/F1)', () => {
  it('anon e teacher leem ZERO linhas sem erro; teacher não escreve', async () => {
    const h = hnd('rls')
    await criar({ handle: h })
    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof pauta'), 'teacher')
    const anon = anonClient()

    for (const client of [teacher, anon]) {
      const { data, error } = await client.from('content_creators').select('id').eq('handle', h)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }

    const { error: insErr } = await teacher.from('content_creators').insert({
      plataforma: 'tiktok', handle: hnd('rls-teacher'), nome: 'X', pais: 'BR',
    })
    expect(insErr).not.toBeNull()
  })

  it('admin lê e escreve normalmente', async () => {
    const h = hnd('rls-admin')
    await criar({ handle: h })
    const { data } = await admin.from('content_creators').select('id').eq('handle', h)
    expect(data).toHaveLength(1)
  })
})

describe('gramática da pauta (módulo puro)', () => {
  it('conserta o que é seguro consertar e NÃO adivinha o resto', () => {
    expect(normalizarHandle('  @Escola ')).toBe('Escola')
    expect(ehHandle(normalizarHandle('  @Escola '))).toBe(true)
    // URL colada não é "consertada" na marra: as quatro redes têm formas de
    // endereço diferentes e `channel/UC…` nem handle é. O banco recusa e a tela
    // explica — melhor que gravar lixo silencioso no cadastro da pesquisa.
    expect(ehHandle(normalizarHandle('https://youtube.com/@escola'))).toBe(false)
    expect(ehHandle(normalizarHandle('duas palavras'))).toBe(false)
    expect(ehHandle(normalizarHandle('   '))).toBe(false)
  })

  it('recusa desconhecida do banco vira frase honesta, não texto técnico', () => {
    expect(fraseDaRecusaDoBanco('deadlock detected')).toMatch(/Nada foi alterado/)
    expect(fraseDaRecusaDoBanco(null)).toMatch(/Nada foi alterado/)
  })
})

/**
 * 📌 REGRA 7 de novo (Leva 1.2 do Estúdio v2): este bloco nasceu VERMELHO,
 * ANTES da migration 20260803000200 (tier + tipo). O contrato: `tipo` NOT NULL
 * default 'criador'; `tier` NULLABLE (NULL = sem classificação — zero palpite
 * sobre as contas que já existem); as DUAS colunas são da mão HUMANA — o robô
 * mede, não classifica.
 */
describe('content_creators — tier e tipo (parte 3 · guards da Leva 1)', () => {
  it('tipo nasce "criador" sem ninguém digitar; a lista da gramática entra inteira', async () => {
    const id = await criar()
    const [row] = await sql`select tipo, tier from content_creators where id = ${id}`
    expect(row.tipo).toBe('criador')
    expect(row.tier).toBeNull()

    // Dois lados do mesmo contrato (mesmo desenho de PLATAFORMAS ↔ CHECK).
    for (const tipo of TIPOS) {
      const outro = await criar({ tipo, handle: hnd(`tipo-${tipo}`) })
      const [r] = await sql`select tipo from content_creators where id = ${outro}`
      expect(r.tipo).toBe(tipo)
    }
  })

  it('tier aceita as 3 faixas da gramática e VOLTA para sem classificação', async () => {
    for (const tier of TIERS) {
      const id = await criar({ tier, handle: hnd(`tier-${tier}`) })
      const [r] = await sql`select tier from content_creators where id = ${id}`
      expect(r.tier).toBe(tier)
    }
    // Desclassificar é legítimo: NULL é estado normal da coluna, não erro.
    const id = await criar({ tier: 'grande', handle: hnd('tier-volta') })
    const { error } = await admin.from('content_creators').update({ tier: null }).eq('id', id)
    expect(error).toBeNull()
    const [r] = await sql`select tier from content_creators where id = ${id}`
    expect(r.tier).toBeNull()
  })

  it('recusa tipo e tier fora da lista — com a frase certa na tela', async () => {
    // Inclui caixa errada e vazio (achado 5 do Sol: um inválido só não prova
    // fronteira) — o domínio EXATO é provado no teste de constraintdef abaixo.
    for (const tipo of ['banda', 'Criador', '']) {
      const { error } = await admin.from('content_creators').insert({
        plataforma: 'youtube', handle: hnd('tipo-ruim'), nome: 'X', pais: 'BR',
        created_by: adminId, tipo,
      })
      expect(error?.message, `o banco ACEITOU tipo «${tipo}»`).toMatch(/content_creators_tipo_check/)
      expect(fraseDaRecusaDoBanco(error?.message)).toMatch(/criador ou empresa/)
    }

    for (const tier of ['medio', 'Grande', '']) {
      const { error } = await admin.from('content_creators').insert({
        plataforma: 'youtube', handle: hnd('tier-ruim'), nome: 'X', pais: 'BR',
        created_by: adminId, tier,
      })
      expect(error?.message, `o banco ACEITOU tier «${tier}»`).toMatch(/content_creators_tier_check/)
      expect(fraseDaRecusaDoBanco(error?.message)).toMatch(/grande, média ou nicho/)
    }

    // `tipo` explícito em NULL viola o NOT NULL antes do CHECK nomeado (achado
    // 7): a tradução tem de casar com a mensagem de null value também.
    const tipoNulo = await admin.from('content_creators').insert({
      plataforma: 'youtube', handle: hnd('tipo-nulo'), nome: 'X', pais: 'BR',
      created_by: adminId, tipo: null,
    })
    expect(tipoNulo.error?.message).toMatch(/null value/i)
    expect(fraseDaRecusaDoBanco(tipoNulo.error?.message)).toMatch(/criador ou empresa/)
  })

  it('o domínio dos CHECKs é EXATAMENTE o da gramática (pg_get_constraintdef)', async () => {
    // Achado 5 do Sol pré-apply: testar 'banda' e 'medio' não prova que o CHECK
    // não aceita um terceiro valor. Os literais do constraint são extraídos e
    // comparados um a um com a lista do TypeScript — dois lados, mesmo contrato.
    const defs = await sql<{ conname: string; def: string; convalidated: boolean }[]>`
      select conname, pg_get_constraintdef(oid) as def, convalidated
        from pg_constraint
       where conrelid = 'public.content_creators'::regclass
         and conname in ('content_creators_tipo_check', 'content_creators_tier_check')`
    expect(defs).toHaveLength(2)
    for (const d of defs) expect(d.convalidated, `${d.conname} não validado`).toBe(true)

    const literais = (def: string) => [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort()
    const porNome = Object.fromEntries(defs.map((d) => [d.conname, d.def]))
    expect(literais(porNome.content_creators_tipo_check)).toEqual([...TIPOS].sort())
    expect(literais(porNome.content_creators_tier_check)).toEqual([...TIERS].sort())
  })

  it('classificar pela tela deixa rastro: audit de update e updated_at andam', async () => {
    // Achado 8 do Sol (parcial aceito): o trigger de audit e o carimbo valem
    // para as colunas novas como para as velhas — provado em ato.
    const id = await criar({ handle: hnd('tier-rastro') })
    const [antes] = await sql`select updated_at from content_creators where id = ${id}`

    const { error } = await admin
      .from('content_creators')
      .update({ tipo: 'empresa', tier: 'nicho' })
      .eq('id', id)
    expect(error).toBeNull()

    const [depois] = await sql`select tipo, tier, updated_at from content_creators where id = ${id}`
    expect(depois.tipo).toBe('empresa')
    expect(depois.tier).toBe('nicho')
    expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime())

    const [aud] = await sql`
      select count(*)::int as n from audit_log
       where entity = 'content_creators' and entity_id = ${id} and action = 'update'`
    expect(aud.n).toBeGreaterThanOrEqual(1)
  })

  it('classificar é da mão HUMANA: o robô não escreve tier nem tipo', async () => {
    const id = await criar()
    const robo = serviceClient()
    for (const mudanca of [{ tipo: 'empresa' }, { tier: 'grande' }]) {
      const { error } = await robo.from('content_creators').update(mudanca).eq('id', id)
      expect(error?.message, `o robô ESCREVEU ${JSON.stringify(mudanca)}`).toMatch(
        /permission denied/i,
      )
    }
  })

  it('o catálogo confirma as duas mãos COLUNA A COLUNA (aceite da Leva 1.2)', async () => {
    // Molde do tripwire do A8 (`onda-agenda-a8.test.ts`): coluna nova sem
    // decisão explícita de grant sai VERMELHA aqui, com o nome dela no diff.
    const colunas = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'content_creators'`
    ).map((r) => r.column_name)

    const privilegio = async (grantee: string, tipo: string) =>
      (
        await sql<{ column_name: string }[]>`
          select column_name from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'content_creators'
             and grantee = ${grantee} and privilege_type = ${tipo}`
      ).map((r) => r.column_name).sort()

    // Mão humana: edita tudo MENOS as seladas (autoria, carimbos e medição).
    const SELADAS_NO_UPDATE = ['id', 'created_by', 'created_at', 'updated_at', 'metricas', 'medido_em']
    expect(await privilegio('authenticated', 'UPDATE')).toEqual(
      colunas.filter((c) => !SELADAS_NO_UPDATE.includes(c)).sort(),
    )
    // No INSERT a autoria entra (created_by); id/carimbos/medição continuam fora.
    const SELADAS_NO_INSERT = ['id', 'created_at', 'updated_at', 'metricas', 'medido_em']
    expect(await privilegio('authenticated', 'INSERT')).toEqual(
      colunas.filter((c) => !SELADAS_NO_INSERT.includes(c)).sort(),
    )
    // Mão do robô: SÓ a medição — classificar não é medir.
    expect(await privilegio('service_role', 'UPDATE')).toEqual(['medido_em', 'metricas'])
    expect(await privilegio('service_role', 'INSERT')).toEqual([])

    // E o privilégio de TABELA continua ausente — era ele que tornaria o selo
    // de coluna inútil (lição da 20260729000100). INSERT entra na cobrança
    // (achado 6 do Sol): um grant a PUBLIC apareceria aqui como TRUE herdado.
    for (const tipo of ['UPDATE', 'INSERT'] as const) {
      const [priv] = await sql`
        select has_table_privilege('authenticated', 'public.content_creators', ${tipo}) as humano,
               has_table_privilege('service_role', 'public.content_creators', ${tipo}) as robo`
      expect(priv.humano, `authenticated com ${tipo} de tabela`).toBe(false)
      expect(priv.robo, `service_role com ${tipo} de tabela`).toBe(false)
    }
  })
})

/**
 * O PORTEIRO DA SEÇÃO `conteudo`, que nasceu neste milestone.
 *
 * Por que isto merece teste: a Pauta é a PRIMEIRA subrota de Conteúdo a falar
 * por cookie, e o porteiro só devolve a um endereço listado em `SUBROTAS`.
 * Esquecer o `/^pauta$/` não quebra nada visivelmente — o desfecho apenas
 * acontece e some, porque a dona é mandada para o Estúdio, que não lê este
 * cookie. Falha silenciosa de recado é exatamente o defeito que o A5 pagou caro
 * para descobrir.
 */
describe('recado da seção conteudo (porteiro)', () => {
  it('a casa e a subrota pauta sobrevivem, com a geometria intacta', () => {
    expect(destinoDaSecao('conteudo', '/admin/conteudo')).toBe('/admin/conteudo')
    expect(destinoDaSecao('conteudo', CASA_DA_PAUTA)).toBe(CASA_DA_PAUTA)
    expect(destinoDaSecao('conteudo', enderecoDoPainel('novo'))).toBe(enderecoDoPainel('novo'))
  })

  it('subrota que não existe e origem de fora caem na casa da seção', () => {
    // 404 não pinta recado: destino inventado volta para onde alguém lê.
    expect(destinoDaSecao('conteudo', '/admin/conteudo/inventada')).toBe('/admin/conteudo')
    expect(destinoDaSecao('conteudo', '/admin/agenda')).toBe('/admin/conteudo')
    expect(destinoDaSecao('conteudo', 'https://evil.example/admin/conteudo/pauta')).toBe(
      '/admin/conteudo',
    )
    expect(destinoDaSecao('conteudo', '//evil.example/admin/conteudo/pauta')).toBe(
      '/admin/conteudo',
    )
  })

  it('a ponte legada ?msg=/&n= é higienizada e o resto da query fica de pé', () => {
    // Sem isto a tela pintaria DOIS recados: o do cookie e o da ponte velha.
    expect(destinoDoRecado('conteudo', `${CASA_DA_PAUTA}?msg=oi&n=9`)).toBe(CASA_DA_PAUTA)
    expect(destinoDoRecado('conteudo', `${CASA_DA_PAUTA}?msg=oi&painel=novo`)).toBe(
      `${CASA_DA_PAUTA}?painel=novo`,
    )
    expect(destinoDoRecado('conteudo', enderecoDoPainel('novo'))).toBe(enderecoDoPainel('novo'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 2 — `content_research` (M5): porta única, supersessão e histórico.
//
// 📌 REGRA 7 de novo: este bloco nasceu VERMELHO (`relation does not exist`) e
// foi commitado assim, ANTES da migration 20260801000200. O contrato que ele
// prova: escrita SÓ pela RPC `record_content_research` (nem `service_role` tem
// DML direto); re-corrida sem force devolve o ativo sem criar linha; force cria
// run novo e supera o antigo NA MESMA transação; fora `superseded_by null→uuid`
// nada se reescreve e nada se apaga; análise de reel só em rede com vídeo.
// ═══════════════════════════════════════════════════════════════════════════

interface LinhaDaRpc {
  id: string
  run: number
  foi_criado: boolean
}

describe('content_research — porta única e supersessão (parte 2)', () => {
  /** Endereço de fixture: único por teste (arquivos rodam em paralelo). */
  function chave(prefixo = 'reel:youtube'): string {
    return `${prefixo}:${crypto.randomUUID().slice(0, 12)}`
  }

  async function gravar(sk: string, over: Record<string, unknown> = {}) {
    const { data, error } = await serviceClient().rpc('record_content_research', {
      p_tipo: 'analise_reel',
      p_plataforma: 'youtube',
      p_source_key: sk,
      p_payload: { analise: { gancho: 'fixture' } },
      p_metricas: { views: 100 },
      ...over,
    })
    return { linha: (data as LinhaDaRpc[] | null)?.[0], error }
  }

  it('a escrita é SÓ pela RPC: DML direto nega até para o robô, e a admin nem executa a função', async () => {
    const sk = chave()
    const linhaDireta = {
      tipo: 'analise_reel', plataforma: 'youtube', source_key: sk, run: 1,
      payload: {}, metricas: {},
    }

    // A regra do plano: "nenhum DML direto (nem service_role)" — outra porta de
    // escrita não contorna a numeração de runs nem a supersessão.
    const robo = await serviceClient().from('content_research').insert(linhaDireta)
    expect(robo.error?.message).toMatch(/permission denied/i)
    const humano = await admin.from('content_research').insert(linhaDireta)
    expect(humano.error).not.toBeNull()

    // Executar a RPC é privilégio do robô; a admin lê, não grava pesquisa.
    const negada = await admin.rpc('record_content_research', {
      p_tipo: 'trends', p_plataforma: 'reddit', p_source_key: chave('trends:reddit'),
      p_payload: { itens: [] },
    })
    expect(negada.error?.message).toMatch(/permission denied/i)

    // O caminho legítimo: run 1, ativo, com dono (creator_id) e carimbo.
    const criadorId = await criar()
    const { linha, error } = await gravar(sk, { p_creator_id: criadorId })
    expect(error, `RPC recusou: ${error?.message}`).toBeNull()
    expect(linha).toMatchObject({ run: 1, foi_criado: true })
    const [row] = await sql`select * from content_research where id = ${linha!.id}`
    expect(row.source_key).toBe(sk)
    expect(row.creator_id).toBe(criadorId)
    expect(row.superseded_by).toBeNull()
    expect(row.coletado_em).not.toBeNull()
  })

  it('sem force, re-corrida devolve o ativo: mesmo id, 0 linha nova', async () => {
    const sk = chave()
    const primeira = await gravar(sk)
    const segunda = await gravar(sk, { p_payload: { analise: { gancho: 'ignorado' } } })
    expect(segunda.error).toBeNull()
    expect(segunda.linha).toMatchObject({
      id: primeira.linha!.id, run: 1, foi_criado: false,
    })
    const [{ n }] = await sql`
      select count(*)::int as n from content_research where source_key = ${sk}`
    expect(n).toBe(1)
  })

  it('com force: run novo supera o antigo na MESMA transação; sempre 1 ativo por fonte', async () => {
    const sk = chave()
    const r1 = await gravar(sk)
    const r2 = await gravar(sk, { p_force: true, p_payload: { analise: { gancho: 'v2' } } })
    expect(r2.error).toBeNull()
    expect(r2.linha).toMatchObject({ run: 2, foi_criado: true })

    const [antigo] = await sql`
      select superseded_by from content_research where id = ${r1.linha!.id}`
    expect(antigo.superseded_by).toBe(r2.linha!.id)

    const ativos = await sql`
      select id from content_research where source_key = ${sk} and superseded_by is null`
    expect(ativos).toHaveLength(1)
    expect(ativos[0].id).toBe(r2.linha!.id)

    // A cadeia segue: força de novo → run 3, e o meio aponta para a ponta.
    const r3 = await gravar(sk, { p_force: true })
    expect(r3.linha!.run).toBe(3)
    const [meio] = await sql`
      select superseded_by from content_research where id = ${r2.linha!.id}`
    expect(meio.superseded_by).toBe(r3.linha!.id)
  })

  it('o histórico é imutável: conteúdo congelado, cadeia não se reescreve, DELETE explode', async () => {
    const sk = chave()
    const r1 = await gravar(sk)
    const r2 = await gravar(sk, { p_force: true })
    const outra = await gravar(chave())

    // Nem o OWNER reescreve conteúdo — o guard segura o que o grant não alcança.
    await expect(
      sql`update content_research set titulo = 'reescrito' where id = ${r2.linha!.id}`,
    ).rejects.toThrow(/imutável/)
    // Reescrever o SUCESSOR de quem já foi superado (uuid → OUTRO uuid — achado
    // do Sol: repetir o MESMO uuid era no-op e não provava nada).
    await expect(
      sql`update content_research set superseded_by = ${outra.linha!.id} where id = ${r1.linha!.id}`,
    ).rejects.toThrow(/não se reescreve/)
    await expect(
      sql`update content_research set superseded_by = null where id = ${r1.linha!.id}`,
    ).rejects.toThrow(/não se reescreve/)
    await expect(
      sql`delete from content_research where id = ${r1.linha!.id}`,
    ).rejects.toThrow(/não se apaga/)

    // Supersessão é para OUTRO run: apontar para si mesmo é recusado.
    const solo = await gravar(chave())
    await expect(
      sql`update content_research set superseded_by = ${solo.linha!.id} where id = ${solo.linha!.id}`,
    ).rejects.toThrow(/a si mesma/)

    // E TRUNCATE não é atalho: o histórico não se esvazia nem pelo owner.
    // CASCADE desde a Leva 2.1: a FK de content_trends recusa o truncate
    // simples ANTES de o trigger falar — o caminho perigoso agora é o cascade
    // (arrastaria a curadoria junto). Qual dos dois anti-truncate grita
    // primeiro é ordem interna do Postgres; qualquer um provando o bloqueio
    // serve, e os dois têm teste próprio no caminho direto.
    await expect(sql`truncate content_research cascade`).rejects.toThrow(
      /não se trunca|TRUNCATE proibido/,
    )
  })

  it('a cadeia não atravessa fontes: sucessor de outra source_key é recusado no COMMIT', async () => {
    // O guard de UPDATE deixa passar null→uuid (é a transição legítima); quem
    // confere que o alvo é run posterior da MESMA fonte é o constraint trigger
    // DEFERRED — no instante do UPDATE da RPC o sucessor ainda nem existe.
    const a = await gravar(chave())
    const b = await gravar(chave())
    await expect(
      sql`update content_research set superseded_by = ${b.linha!.id} where id = ${a.linha!.id}`,
    ).rejects.toThrow(/MESMA fonte/)
  })

  it('p_force NULO não é force: o null do JSON devolve o ativo, não supera (3 estados do SQL)', async () => {
    const sk = chave()
    const r1 = await gravar(sk)
    const r2 = await gravar(sk, { p_force: null })
    expect(r2.error).toBeNull()
    expect(r2.linha).toMatchObject({ id: r1.linha!.id, run: 1, foi_criado: false })
  })

  it('a fonte não muda de identidade entre runs: force com outro tipo/plataforma é recusado', async () => {
    const sk = chave()
    await gravar(sk)
    const outraRede = await gravar(sk, { p_force: true, p_plataforma: 'tiktok' })
    expect(outraRede.error?.message).toMatch(/identidade/)
    const outroTipo = await gravar(sk, { p_force: true, p_tipo: 'trends' })
    expect(outroTipo.error?.message).toMatch(/identidade/)
  })

  it('supersessão que falha no INSERT desfaz TUDO: o antigo segue ativo (transação de verdade)', async () => {
    const sk = chave()
    const r1 = await gravar(sk)
    // payload null passa da identidade e do UPDATE e explode só no INSERT — se
    // a transação não fosse uma, o run 1 ficaria superado sem sucessor.
    const quebrada = await gravar(sk, { p_force: true, p_payload: null })
    expect(quebrada.error).not.toBeNull()

    const [row] = await sql`
      select superseded_by from content_research where id = ${r1.linha!.id}`
    expect(row.superseded_by).toBeNull()
    const [{ n }] = await sql`
      select count(*)::int as n from content_research where source_key = ${sk}`
    expect(n).toBe(1)
  })

  it('dois force SIMULTÂNEOS serializam no advisory lock: runs 2 e 3, cadeia 1→2→3, 1 ativo', async () => {
    const sk = chave()
    await gravar(sk)
    const [a, b] = await Promise.all([
      gravar(sk, { p_force: true }),
      gravar(sk, { p_force: true }),
    ])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(new Set([a.linha!.run, b.linha!.run])).toEqual(new Set([2, 3]))

    const linhas = await sql`
      select id, run, superseded_by from content_research
       where source_key = ${sk} order by run`
    expect(linhas).toHaveLength(3)
    expect(linhas[0].superseded_by).toBe(linhas[1].id)
    expect(linhas[1].superseded_by).toBe(linhas[2].id)
    expect(linhas[2].superseded_by).toBeNull()
  })

  it('unique(source_key, run) e 1-ativo-por-fonte seguram até o owner', async () => {
    const sk = chave()
    const r1 = await gravar(sk)

    // Run duplicado (nasce já superado, para provar o UNIQUE e não o parcial).
    await expect(sql`
      insert into content_research (tipo, plataforma, source_key, run, payload, superseded_by)
      values ('analise_reel', 'youtube', ${sk}, 1, '{}'::jsonb, ${r1.linha!.id})
    `).rejects.toThrow(/content_research_source_key_run|duplicate key/)

    // Segundo ATIVO na mesma fonte: o índice parcial é o invariante do desenho.
    await expect(sql`
      insert into content_research (tipo, plataforma, source_key, run, payload)
      values ('analise_reel', 'youtube', ${sk}, 99, '{}'::jsonb)
    `).rejects.toThrow(/um_ativo_por_fonte|duplicate key/)

    // Run começa em 1.
    await expect(sql`
      insert into content_research (tipo, plataforma, source_key, run, payload)
      values ('analise_reel', 'youtube', ${chave()}, 0, '{}'::jsonb)
    `).rejects.toThrow(/content_research_run/)
  })

  it('análise de reel exige rede com vídeo: x e reddit só entram como trends', async () => {
    for (const plataforma of ['x', 'reddit']) {
      const errada = await gravar(chave(`reel:${plataforma}`), { p_plataforma: plataforma })
      expect(errada.error?.message, `o banco ACEITOU analise_reel em ${plataforma}`).toMatch(
        /tipo_plataforma/,
      )
    }
    // As três redes COM vídeo passam (achado do Sol: só o youtube estava provado).
    for (const plataforma of ['youtube', 'instagram', 'tiktok']) {
      const reel = await gravar(chave(`reel:${plataforma}`), { p_plataforma: plataforma })
      expect(reel.error, `analise_reel em ${plataforma} recusada`).toBeNull()
    }
    const certa = await gravar(chave('trends:reddit'), {
      p_tipo: 'trends', p_plataforma: 'reddit', p_metricas: { itens_apos_filtro: 12 },
    })
    expect(certa.error).toBeNull()
  })

  it('RLS: admin lê a pesquisa; teacher e anon leem 0 linhas sem erro', async () => {
    const sk = chave()
    await gravar(sk)

    const daAdmin = await admin.from('content_research').select('id').eq('source_key', sk)
    expect(daAdmin.error).toBeNull()
    expect(daAdmin.data).toHaveLength(1)

    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof pesquisa'), 'teacher')
    for (const client of [teacher, anonClient()]) {
      const { data, error } = await client.from('content_research').select('id').eq('source_key', sk)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
  })
})
