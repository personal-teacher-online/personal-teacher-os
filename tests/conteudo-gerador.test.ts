// Miolos de domínio do gerador in-app (M2, Etapa 1) — claim/entrega/erro/rejeição
// extraídos de handle.ts para serem chamados TAMBÉM de dentro do app (action
// "Gerar agora" e rota de cron), não só das rotas /api/content/* do ADR-021.
//
// O contrato aqui é de DOMÍNIO ({ ok } | not_found | conflict), não HTTP: quem
// prova status 401/400/404/409 é tests/conteudo-api.test.ts, pelos adaptadores.
// A máquina de estados continua sendo do BANCO (Lei 3) — estes testes provam que
// o miolo respeita o cadeado, não que o TypeScript reimplementa a regra.
//
// Etapa 3 acrescentou os casos de generateReelScript (sem-voz, feedback da
// rejeição no prompt, validação estrita, teto de tentativas) com o Claude
// MOCKADO — o espião guarda o input montado, no molde de briefing-updates.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

// O mock precisa existir ANTES do import do consumidor real (generate.ts).
const espiao = vi.hoisted(() => ({
  input: '',
  resposta: null as unknown,
  chamadas: 0,
}))
vi.mock('@/lib/ai/claude', () => ({
  getActivePrompt: async () => ({
    name: 'content-reel-script',
    version: 1,
    content: 'prompt de teste',
    model: 'claude-sonnet-5',
    params: {},
  }),
  runStructured: async ({ input }: { input: string }) => {
    espiao.input = input
    espiao.chamadas += 1
    if (espiao.resposta instanceof Error) throw espiao.resposta
    return espiao.resposta
  },
}))

import { generateReelScript } from '@/lib/content/generate'
import { serializeRoteiro, validarTextoRoteiro, roteiroSchema } from '@/lib/content/roteiro'
import {
  claimContentPost,
  deliverContentPost,
  failContentPost,
  rejectContentPost,
} from '@/lib/content/handle'
import { getActiveBrandVoice } from '@/lib/content/voice'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let db: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(3)
  db = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin gerador M2')
})
afterAll(async () => {
  await sql.end()
})

/** Fixture própria com external_ref único (convenção da casa: nunca contagem global). */
async function postAprovado(prefixo: string): Promise<string> {
  const externalRef = `m2-${prefixo}-${crypto.randomUUID().slice(0, 8)}`
  const [criado] = await sql`
    insert into content_posts (external_ref, kind, tema, gancho)
    values (${externalRef}, 'roteiro_reel', ${'Tema ' + prefixo}, 'gancho de teste')
    returning id`
  await sql`
    update content_posts
       set status = 'ideia_aprovada', idea_approved_by = ${adminId}, idea_approved_at = now()
     where id = ${criado.id}`
  return criado.id as string
}

async function estado(id: string) {
  const [row] = await sql`
    select status, generation_attempts, generation_error, rejection_reason, roteiro, legenda,
           generation_meta
      from content_posts where id = ${id}`
  return row
}

describe('claimContentPost — o cadeado do gerador', () => {
  it('reivindica uma vez; a segunda chamada dá conflito (duplo clique morre aqui)', async () => {
    const id = await postAprovado('claim')

    const primeira = await claimContentPost(db, id)
    expect(primeira).toEqual({ ok: true, attempt: 1 })

    const segunda = await claimContentPost(db, id)
    expect(segunda.ok).toBe(false)
    if (segunda.ok) throw new Error('inalcançável')
    expect(segunda.reason).toBe('conflict')

    const row = await estado(id)
    expect(row.status).toBe('gerando')
    expect(row.generation_attempts).toBe(1)
  })

  it('post inexistente → not_found (não é conflito)', async () => {
    const res = await claimContentPost(db, crypto.randomUUID())
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('not_found')
  })

  it('post fora de ideia_aprovada → conflict', async () => {
    const id = await postAprovado('claim-fora')
    await sql`update content_posts set status = 'descartado' where id = ${id}`
    const res = await claimContentPost(db, id)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('conflict')
  })
})

describe('deliverContentPost — gerando → rascunho', () => {
  it('grava roteiro, legenda e meta, e limpa o erro anterior', async () => {
    const id = await postAprovado('entrega')
    await claimContentPost(db, id)

    const res = await deliverContentPost(db, {
      postId: id,
      legenda: 'Legenda da versão voz ✨',
      roteiro: '=== VERSÃO TREND ===\nGANCHO: x\n=== VERSÃO VOZ ===\nGANCHO: y',
      generationMeta: { modelo: 'claude-sonnet-5', tentativa: 1 },
      brandVoiceVersion: 1,
    })
    expect(res).toEqual({ ok: true })

    const row = await estado(id)
    expect(row.status).toBe('rascunho')
    expect(row.legenda).toContain('versão voz')
    expect(row.roteiro).toContain('=== VERSÃO TREND ===')
    expect(row.generation_error).toBeNull()
    expect(row.generation_meta.modelo).toBe('claude-sonnet-5')
  })

  it('post que não está gerando → conflict (nada é sobrescrito)', async () => {
    const id = await postAprovado('entrega-conflito')
    const res = await deliverContentPost(db, { postId: id, legenda: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('conflict')
    expect((await estado(id)).status).toBe('ideia_aprovada')
  })
})

describe('failContentPost — devolve à fila com o erro visível', () => {
  it('gerando → ideia_aprovada com generation_error', async () => {
    const id = await postAprovado('falha')
    await claimContentPost(db, id)

    const res = await failContentPost(db, { postId: id, error: 'Claude devolveu roteiro inválido' })
    expect(res).toEqual({ ok: true })

    const row = await estado(id)
    expect(row.status).toBe('ideia_aprovada')
    expect(row.generation_error).toContain('inválido')
  })

  it('post fora de gerando → conflict', async () => {
    const id = await postAprovado('falha-conflito')
    const res = await failContentPost(db, { postId: id, error: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('conflict')
  })
})

describe('semântica do contador de tentativas (decisão do recorte M2)', () => {
  it('erro técnico CONSOME tentativa: falhar e reivindicar de novo chega na 2ª', async () => {
    const id = await postAprovado('contador')

    expect(await claimContentPost(db, id)).toEqual({ ok: true, attempt: 1 })
    await failContentPost(db, { postId: id, error: 'timeout' })
    expect(await claimContentPost(db, id)).toEqual({ ok: true, attempt: 2 })

    expect((await estado(id)).generation_attempts).toBe(2)
  })

  it('rejeição humana ZERA o contador: a rodada recomeça com o motivo como feedback', async () => {
    const id = await postAprovado('reset')
    await claimContentPost(db, id)
    await deliverContentPost(db, { postId: id, legenda: 'rascunho a ser rejeitado' })
    expect((await estado(id)).generation_attempts).toBe(1)

    const res = await rejectContentPost(db, {
      postId: id,
      motivo: 'o gancho não é da voz da dona',
    })
    expect(res).toEqual({ ok: true })

    const row = await estado(id)
    expect(row.status).toBe('rejeitado')
    expect(row.rejection_reason).toContain('gancho')
    // O contador significa "tentativas desde a última rejeição" — o histórico
    // integral sobrevive em generation_meta e no audit_log.
    expect(row.generation_attempts).toBe(0)
  })
})

describe('getActiveBrandVoice — leitura única da voz ativa', () => {
  it('devolve exatamente a versão marcada como ativa no banco (ou null)', async () => {
    const [ativa] = await sql`
      select version, content_md from brand_voice_docs where active = true limit 1`
    const voz = await getActiveBrandVoice(db)
    if (ativa) {
      expect(voz?.version).toBe(ativa.version)
      expect(voz?.content_md).toBe(ativa.content_md)
    } else {
      expect(voz).toBeNull()
    }
  })
})

// ── Etapa 3: o gerador ──────────────────────────────────────────────────────

/** Roteiro válido mínimo, no contrato do prompt de produção. */
function roteiroValido(marca = 'gancho de teste') {
  return {
    gancho: { principal: marca, variantes: ['v1', 'v2', 'v3'] },
    cenas: [
      { fala: 'primeira fala', texto_na_tela: 'cartela 1', acao: 'corte seco' },
      { fala: 'segunda fala', texto_na_tela: 'cartela 2', acao: 'zoom' },
    ],
    cta: { fala: 'salva esse reel', texto_na_tela: 'Salvar' },
    legenda: 'legenda do post',
    hashtags: ['#ingles', '#viagem', '#reels'],
    duracao_alvo_s: 45,
  }
}

/** Garante uma voz ativa para os casos de sucesso. A tabela é append-only, a
 *  publicação é SÓ pela RPC e a RPC é restrita à admin (ADR-021) — por isso o
 *  client de admin, não a conexão SQL direta. */
async function garanteVozAtiva(): Promise<void> {
  const [ativa] = await sql`select 1 from brand_voice_docs where active = true limit 1`
  if (!ativa) {
    const adminClient = await clientAs(adminId, 'admin')
    const { error } = await adminClient.rpc('publish_brand_voice', {
      p_content_md: '# Voz de teste do gerador M2',
      p_notes: 'fixture conteudo-gerador',
    })
    if (error) throw new Error(`fixture de voz: ${error.message}`)
  }
}

describe('generateReelScript — o gerador in-app', () => {
  it('ideia_aprovada → rascunho: grava roteiro serializado, legenda e meta', async () => {
    await garanteVozAtiva()
    espiao.resposta = roteiroValido('Você cantou isso sem saber')
    const id = await postAprovado('gera-ok')

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(true)

    const row = await estado(id)
    expect(row.status).toBe('rascunho')
    expect(row.roteiro).toContain('GANCHO: Você cantou isso sem saber')
    expect(row.roteiro).toContain('CENA 1')
    expect(row.roteiro).toContain('HASHTAGS:')
    expect(row.legenda).toBe('legenda do post')
    expect(row.generation_meta.modelo).toBe('claude-sonnet-5')
    expect(row.generation_meta.prompt_versao).toBe(1)
    expect(row.generation_meta.tentativa).toBe(1)
    expect(row.generation_meta.legenda_source).toBe('roteiro_gerado')
    expect(row.generation_meta.roteiro_original).toBe(row.roteiro)
  })

  it('SEM voz visível: recusa ANTES do claim — não consome tentativa', async () => {
    // Desativar a voz global seria o teste literal, mas a tabela é append-only
    // (reativar é PROIBIDO por trigger) e conteudo-fabrica.test.ts roda em
    // paralelo afirmando "exatamente 1 ativa" — deixá-la desativada faria
    // aquele arquivo flakear. O mesmo estado (`getActiveBrandVoice` devolve
    // null) se produz com um client que a RLS não deixa ler a tabela: o que
    // está sob teste é a RECUSA ANTES DO CLAIM, idêntica nos dois caminhos.
    const semAcesso = await clientAs(adminId, 'student')
    const id = await postAprovado('gera-sem-voz')

    const res = await generateReelScript(semAcesso, id)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('sem_voz')

    const row = await estado(id)
    expect(row.status).toBe('ideia_aprovada')
    expect(row.generation_attempts).toBe(0)
  })

  it('o motivo da rejeição entra no prompt como feedback da revisora', async () => {
    await garanteVozAtiva()
    espiao.resposta = roteiroValido()
    const id = await postAprovado('gera-feedback')
    await sql`update content_posts set rejection_reason = 'o gancho ficou longo demais' where id = ${id}`

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(true)
    expect(espiao.input).toContain('FEEDBACK DA REVISORA')
    expect(espiao.input).toContain('o gancho ficou longo demais')
  })

  it('o roteiro do radar leva a DISSECAÇÃO e o CONTEXTO DE DESTINO no prompt (Leva 5)', async () => {
    await garanteVozAtiva()
    espiao.resposta = roteiroValido()
    const id = await postAprovado('gera-radar')
    await sql`
      update content_posts
         set contexto = 'travel',
             idea = ${sql.json({
               de_onde_veio: 'De Canal X no YouTube · 120.000 views',
               dissecacao: {
                 gancho: { texto_falado: 'Você fala isso errado no aeroporto', tipo: 'pergunta' },
                 beats: [{ funcao: 'gancho', resumo: 'abre com o erro', frase_chave: 'todo mundo erra' }],
                 por_que_performou: ['vergonha embutida'],
                 copia: { como_copiar: 'trocar o cenário para a sala da dona' },
               },
             })}
       where id = ${id}`

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(true)

    // O mecanismo do vídeo que performou entra INTEIRO — é ele que o prompt
    // manda copiar, e antes chegava só como frase de segunda mão.
    expect(espiao.input).toContain('O VÍDEO DE REFERÊNCIA, DISSECADO')
    expect(espiao.input).toContain('Você fala isso errado no aeroporto')
    expect(espiao.input).toContain('1. gancho: abre com o erro')
    expect(espiao.input).toContain('trocar o cenário para a sala da dona')
    // E o destino: da aba Personal Travel sai roteiro com o convite.
    expect(espiao.input).toContain('=== CONTEXTO DE DESTINO ===')
    expect(espiao.input).toContain('PERSONAL TRAVEL')

    const row = await estado(id)
    expect(row.generation_meta.contexto).toBe('travel')
  })

  it('post SEM contexto (avulso e legado) entra no prompt como entrava antes', async () => {
    await garanteVozAtiva()
    espiao.resposta = roteiroValido()
    const id = await postAprovado('gera-avulso')

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(true)
    // Silêncio é o comportamento de ontem: bloco vazio não entra, e ausente é
    // diferente de "geral" — inventar destino mudaria roteiro que já existia.
    expect(espiao.input).not.toContain('CONTEXTO DE DESTINO')
    expect(espiao.input).not.toContain('DISSECADO')
    const row = await estado(id)
    expect(row.generation_meta.contexto).toBeUndefined()
  })

  it('post já REIVINDICADO pela RPC não reivindica de novo — e devolve à fila se falhar', async () => {
    await garanteVozAtiva()
    const id = await postAprovado('gera-reivindicado')
    // A RPC do radar faz isto dentro da transação dela (a reserva da vaga do
    // teto); aqui a fixture reproduz o estado com que o gerador é chamado.
    await sql`
      update content_posts
         set status = 'gerando', generation_started_at = now(), generation_attempts = 1
       where id = ${id}`

    espiao.resposta = { gancho: { principal: 'só isso' } } // roteiro inválido
    const res = await generateReelScript(db, id, { jaReivindicado: 1 })
    expect(res.ok).toBe(false)

    // O post NÃO pode ficar preso em `gerando`: com a vaga já consumida, todo
    // caminho de erro devolve à fila — senão só o botão "Destravar" o salva.
    const row = await estado(id)
    expect(row.status).toBe('ideia_aprovada')
    expect(row.generation_attempts).toBe(1)
    expect(row.generation_error).toContain('fora do contrato')
  })

  // ⚠️ O PRÉ-VOO com post já reivindicado também devolve à fila (`desistir` em
  // generate.ts), e esse caminho NÃO tem teste — de propósito, não por
  // esquecimento: "sem voz" só é alcançável com um client que a RLS impede de
  // LER `brand_voice_docs`, e esse mesmo client também não consegue ESCREVER em
  // `content_posts` para devolver. Simular com ele provaria o contrário do que
  // se quer. Com a sessão admin real (o único caminho do radar) a voz sempre é
  // legível, então o par reivindicado × sem-voz não acontece em produção.
  // Anotado no goal da leva como limitação declarada.

  it('roteiro fora do contrato → post volta à fila com o erro, nunca vira rascunho lixo', async () => {
    await garanteVozAtiva()
    espiao.resposta = { gancho: { principal: 'só isso' } } // sem cenas, cta, legenda…
    const id = await postAprovado('gera-invalido')

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(false)

    const row = await estado(id)
    expect(row.status).toBe('ideia_aprovada')
    expect(row.roteiro).toBeNull()
    expect(row.generation_error).toContain('fora do contrato')
    // O erro CONSOME a tentativa (semântica declarada no recorte).
    expect(row.generation_attempts).toBe(1)
  })

  it('erro da API devolve o post à fila com o erro visível', async () => {
    await garanteVozAtiva()
    espiao.resposta = new Error('529 overloaded')
    const id = await postAprovado('gera-erro-api')

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(false)

    const row = await estado(id)
    expect(row.status).toBe('ideia_aprovada')
    expect(row.generation_error).toContain('529')
  })

  it('post que não está em ideia_aprovada → conflict, sem chamar o Claude', async () => {
    await garanteVozAtiva()
    espiao.resposta = roteiroValido()
    const id = await postAprovado('gera-conflito')
    await claimContentPost(db, id) // já está gerando
    const antes = espiao.chamadas

    const res = await generateReelScript(db, id)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.reason).toBe('conflict')
    expect(espiao.chamadas).toBe(antes)
  })
})

describe('roteiro.ts — contrato do formato', () => {
  it('serializa e o texto passa na conferência final', () => {
    const r = roteiroSchema.parse(roteiroValido())
    const texto = serializeRoteiro(r)
    expect(validarTextoRoteiro(texto)).toEqual({ ok: true })
  })

  it('conteúdo que imita marcador não quebra o formato', () => {
    const r = roteiroSchema.parse({
      ...roteiroValido(),
      // Uma fala multi-linha cujo miolo começaria um bloco falso.
      cenas: [
        { fala: 'olha isso\nCENA 9\nna real é a mesma cena', texto_na_tela: 'x', acao: 'y' },
        { fala: 'segunda', texto_na_tela: 'z', acao: 'w' },
      ],
      legenda: 'primeira linha\nCTA\nsegunda linha',
    })
    const texto = serializeRoteiro(r)
    expect(validarTextoRoteiro(texto)).toEqual({ ok: true })
    // Só existem as DUAS cenas reais — a "CENA 9" virou texto da fala.
    expect(texto.match(/^CENA \d+$/gm)).toEqual(['CENA 1', 'CENA 2'])
    // E só um bloco CTA (o da legenda ficou inerte).
    expect(texto.match(/^CTA$/gm)).toHaveLength(1)
  })

  it('roteiro sem os blocos obrigatórios é recusado pela conferência', () => {
    const res = validarTextoRoteiro('GANCHO: só o gancho e mais nada')
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.detalhe).toContain('CENA 1')
  })
})
