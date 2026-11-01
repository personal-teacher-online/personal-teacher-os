// Issue #113 — a aba Recebidas da tela Mensagens: o que os alunos escreveram ao
// número de envio do WhatsApp (linhas `meta` / `<wamid>:message` da
// `webhook_inbox`, gravadas pela #44). SÓ LEITURA.
//
// Três blocos:
// 1. O DETECTOR de palavra de parada (puro) — a lista e os falsos positivos óbvios.
// 2. A LEITURA da mensagem do payload (puro) — texto, mídia, toque em botão.
// 3. A CAMADA DE DADOS contra o banco (`lerMensagens`, a mesma função da página, e
//    `lerRecebidas`): só mensagem (recibo e `account_update` ficam de fora), o
//    aluno pelo número com e sem `+`, "Número desconhecido", o aviso respondido,
//    selo e contagem das paradas, mídia sem texto, janela de 90 dias, período,
//    filtro por aluno, paginação e contagem exata.
//
// HIGIENE (arquivos rodam em PARALELO no mesmo banco): todo wamid daqui leva o
// sufixo da rodada; toda linha de outbox nasce com `m3rec:<rodada>:`; a limpeza do
// fim apaga SÓ o que este arquivo criou. As asserções sobre a lista GLOBAL só
// dizem o que é verdade mesmo com linhas de outros arquivos ao lado; as de
// contagem usam o filtro de aluno, que isola os números desta rodada.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'
import { DateTime } from 'luxon'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent } from './helpers/db'
import { FRASES_DE_PARADA, PALAVRAS_DE_PARADA, normalizarTexto, pedeParaParar } from '@/lib/notify/palavras-de-parada'
import { lerMensagemRecebida, numeroComMais, soDigitos } from '@/data/admin/recebidas-gramatica'
import type { FiltrosDasMensagens } from '@/data/admin/mensagens-gramatica'
import { POR_PAGINA } from '@/data/admin/mensagens-gramatica'

// `mensagens.ts` é `server-only` e importa o cliente de cookies do Next; o teste
// chama `lerMensagens` com clientes próprios.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { lerMensagens } = await import('@/data/admin/mensagens')
const { lerRecebidas } = await import('@/data/admin/recebidas')

const PADRAO: FiltrosDasMensagens = { aba: 'recebida', periodo: 'tudo', aluno: null, pagina: 1, ver: null }

/* ========================================================================== */
/* 1. O detector de palavra de parada                                          */
/* ========================================================================== */

describe('palavra de parada (só destaca; nunca desliga)', () => {
  it('pega a palavra solta, com maiúsculas, acentos, pontuação e cortesia ao redor', () => {
    for (const t of [
      'PARAR',
      'parar',
      'Pare!',
      'PÁRE',
      'SAIR',
      'Sair.',
      'STOP',
      'stop',
      ' Stop... ',
      'sair por favor',
      'Por favor, parar',
      'parar obrigada',
      'descadastrar',
    ]) {
      expect(pedeParaParar(t), t).toBe(true)
    }
  })

  it('pega as frases que só se dizem para pedir o fim das mensagens, em qualquer lugar do texto', () => {
    for (const t of [
      'não quero mais',
      'NAO QUERO MAIS',
      'Oi, não quero mais receber essas mensagens',
      'Quero parar de receber os avisos',
      'pare de me mandar mensagem, por favor',
      'Podem tirar meu número da lista?',
      'me tire da lista: sair da lista, por favor',
    ]) {
      expect(pedeParaParar(t), t).toBe(true)
    }
  })

  it('NÃO pega o falso positivo óbvio: a palavra no meio de uma frase de aula', () => {
    for (const t of [
      'parar de remarcar',
      'Quero parar de remarcar as aulas',
      'Posso sair mais cedo hoje?',
      'Vou sair do trabalho às 18h, posso entrar atrasada?',
      'Oi! Posso trocar a aula de quinta?',
      'Pode parar na página 12?',
      'stop motion foi o tema da aula',
      'Preciso parar um pouco, estou viajando',
    ]) {
      expect(pedeParaParar(t), t).toBe(false)
    }
  })

  it('texto vazio, ausente ou só pontuação nunca é parada', () => {
    for (const t of [null, undefined, '', '   ', '!!!', '🙂']) expect(pedeParaParar(t), String(t)).toBe(false)
  })

  it('a lista está em forma normalizada (senão a frase nunca casaria)', () => {
    for (const x of [...PALAVRAS_DE_PARADA, ...FRASES_DE_PARADA]) expect(normalizarTexto(x), x).toBe(x)
  })
})

/* ========================================================================== */
/* 2. Ler a mensagem do payload                                                */
/* ========================================================================== */

describe('lerMensagemRecebida', () => {
  const msg = (message: Record<string, unknown>) => ({ message, metadata: { phone_number_id: '1' } })

  it('texto: o corpo, o tipo e o remetente só em dígitos', () => {
    const r = lerMensagemRecebida(msg({ from: '5565999990001', id: 'w', type: 'text', text: { body: 'Oi!' } }))
    expect(r).toMatchObject({ numero: '5565999990001', tipoDaMeta: 'text', tipo: 'Texto', texto: 'Oi!' })
  })

  it('o `+` do remetente não atrapalha (e `numeroComMais` o devolve)', () => {
    const r = lerMensagemRecebida(msg({ from: '+5565999990001', type: 'text', text: { body: 'a' } }))
    expect(r.numero).toBe('5565999990001')
    expect(numeroComMais(r.numero!)).toBe('+5565999990001')
    expect(soDigitos('+55 (65) 99999-0001')).toBe('5565999990001')
  })

  it('áudio, imagem e figurinha: mostra o tipo e NENHUM texto (a Meta manda só ids)', () => {
    const casos: Array<[string, string]> = [
      ['audio', 'Áudio'],
      ['image', 'Imagem'],
      ['sticker', 'Figurinha'],
      ['video', 'Vídeo'],
      ['document', 'Documento'],
    ]
    for (const [type, rotulo] of casos) {
      const r = lerMensagemRecebida(msg({ from: '1', type, [type]: { id: '300', caption: 'legenda' } }))
      expect(r.tipo, type).toBe(rotulo)
      expect(r.texto, type).toBeNull()
    }
  })

  it('toque em botão: o rótulo do botão é o texto, nas três formas que a Meta usa', () => {
    expect(lerMensagemRecebida(msg({ from: '1', type: 'button', button: { text: 'Parar', payload: 'p' } })).texto).toBe(
      'Parar',
    )
    const resposta = { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'a', title: 'Sim' } } }
    expect(lerMensagemRecebida(msg({ from: '1', ...resposta })).texto).toBe('Sim')
    const lista = { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'a', title: 'Quinta' } } }
    expect(lerMensagemRecebida(msg({ from: '1', ...lista })).texto).toBe('Quinta')
  })

  it('resposta a um aviso nosso traz o `context.id`; mensagem solta, não', () => {
    expect(lerMensagemRecebida(msg({ from: '1', type: 'text', text: { body: 'a' }, context: { id: 'wamid.X' } })).respondeAoWamid).toBe(
      'wamid.X',
    )
    expect(lerMensagemRecebida(msg({ from: '1', type: 'text', text: { body: 'a' } })).respondeAoWamid).toBeNull()
  })

  it('payload sem a forma esperada não estoura: tipo não reconhecido, sem remetente', () => {
    for (const p of [null, 'x', {}, { message: 'x' }, { message: { type: 'holograma' } }]) {
      const r = lerMensagemRecebida(p)
      expect(r.tipo).toBe('Tipo não reconhecido')
      expect(r.texto).toBeNull()
      expect(r.numero).toBeNull()
    }
  })
})

/* ========================================================================== */
/* 3. A camada de dados contra o banco                                         */
/* ========================================================================== */

describe('a aba Recebidas (contra o banco)', () => {
  let sql: Sql
  let admin: SupabaseClient
  let servico: SupabaseClient
  const rodada = crypto.randomUUID().slice(0, 8)
  const PREFIXO_DO_WAMID = `wamid.TESTE${rodada}`
  let n = 0

  /** Número fictício desta rodada, só dígitos, que nenhum perfil de fixture usa. */
  const numeroNovo = () => `55657${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

  let alunoA: string
  let nomeA: string
  let numeroA: string
  let alunoSemNumero: string
  let alunoB: string
  let numeroB: string
  let perfilA: string
  const desconhecido = numeroNovo()
  const ids: Record<string, number> = {}

  /** Uma mensagem do aluno na inbox da Meta, do jeito que a #44 grava. */
  async function receber(o: {
    nome?: string
    from: string
    tipo?: string
    texto?: string
    contextId?: string
    minutosAtras?: number
    diasAtras?: number
    sufixo?: string
  }): Promise<number> {
    n += 1
    const wamid = `${PREFIXO_DO_WAMID}${n}`
    const tipo = o.tipo ?? 'text'
    const message: Record<string, unknown> = { from: o.from, id: wamid, timestamp: '1761990180', type: tipo }
    if (tipo === 'text') message.text = { body: o.texto ?? 'Oi!' }
    else message[tipo] = { id: `3000${n}`, mime_type: 'x/y' }
    if (o.contextId) message.context = { from: '5565999990001', id: o.contextId }
    const payload = { message, metadata: { display_phone_number: '5565999990001', phone_number_id: '100000000000001' } }
    const [r] = await sql`
      insert into webhook_inbox (source, event_id, payload, processed_at, received_at)
      values ('meta', ${`${wamid}:${o.sufixo ?? 'message'}`}, ${sql.json(payload as never)}, now(),
              now() - make_interval(mins => ${o.minutosAtras ?? 0}) - make_interval(days => ${o.diasAtras ?? 0})
                    - make_interval(secs => ${n}))
      returning id`
    const id = Number(r.id)
    if (o.nome) ids[o.nome] = id
    return id
  }

  /** Uma linha do outbox que SAIU pela Meta com este wamid. */
  async function avisoNosso(o: { wamid: string; perfil: string; provider?: string; template?: string; extra?: object }) {
    n += 1
    await sql`
      insert into notification_outbox
        (template, recipient_profile_id, payload, dedupe_key, scheduled_for, sent_at, provider, provider_message_id)
      values (${o.template ?? 'class-reminder'}, ${o.perfil}, ${sql.json((o.extra ?? {}) as never)},
              ${`m3rec:${rodada}:${n}`}, now() + interval '30 days', now(), ${o.provider ?? 'meta'}, ${o.wamid})`
  }

  const ler = (f: Partial<FiltrosDasMensagens>) => lerMensagens(admin, servico, { ...PADRAO, ...f })

  /** Todas as páginas da aba, para achar uma linha mesmo com outros arquivos escrevendo ao lado. */
  async function todasAsRecebidas(f: Partial<FiltrosDasMensagens> = {}) {
    const primeira = await ler({ ...f, pagina: 1 })
    const linhas = [...(primeira.recebidas?.linhas ?? [])]
    for (let pg = 2; pg <= primeira.totalDePaginas; pg++) {
      linhas.push(...((await ler({ ...f, pagina: pg })).recebidas?.linhas ?? []))
    }
    return linhas
  }

  beforeAll(async () => {
    sql = connect(2)
    const adminId = await createAuthUser(sql, 'admin', 'Admin Recebidas')
    admin = await clientAs(adminId, 'admin')
    servico = serviceClient()

    // A: aluno com login e número
    numeroA = numeroNovo()
    alunoA = await createStudent(sql)
    perfilA = await createAuthUser(sql, 'student', `Aluno A ${rodada}`, { whatsapp: `+${numeroA}` })
    await sql`update students set profile_id = ${perfilA} where id = ${alunoA}`
    nomeA = (await sql`select display_name from students where id = ${alunoA}`)[0].display_name as string

    // B: outro aluno (para provar que o filtro não vaza) e um terceiro sem login (logo, sem número)
    numeroB = numeroNovo()
    alunoB = await createStudent(sql)
    const perfilB = await createAuthUser(sql, 'student', `Aluno B ${rodada}`, { whatsapp: `+${numeroB}` })
    await sql`update students set profile_id = ${perfilB} where id = ${alunoB}`
    alunoSemNumero = await createStudent(sql)

    // Mensagens do A (a mais recente é a última criada: o desempate é pelos segundos de `receber`)
    await receber({ nome: 'texto', from: numeroA, texto: 'Oi! Posso trocar a aula de quinta?' })
    await receber({ nome: 'parar', from: numeroA, texto: 'PARAR' })
    await receber({ nome: 'naoParar', from: numeroA, texto: 'parar de remarcar' })
    await receber({ nome: 'comMais', from: `+${numeroA}`, texto: 'Mensagem com o plus' })
    await receber({ nome: 'audio', from: numeroA, tipo: 'audio' })
    await receber({ nome: 'imagem', from: numeroA, tipo: 'image' })
    // resposta a um aviso nosso
    const wamidDoAviso = `wamid.NOSSO${rodada}a`
    await avisoNosso({
      wamid: wamidDoAviso,
      perfil: perfilA,
      template: 'class-reminder',
      extra: { starts_at_utc: DateTime.utc().plus({ days: 3 }).toISO() },
    })
    await receber({ nome: 'resposta', from: numeroA, texto: 'Confirmo!', contextId: wamidDoAviso })
    // context.id que não é de ninguém nosso, e que é de outro provedor
    await receber({ nome: 'respostaSolta', from: numeroA, texto: 'Ok', contextId: `wamid.DESCONHECIDO${rodada}` })
    await avisoNosso({ wamid: `wamid.OUTRO${rodada}`, perfil: perfilA, provider: 'resend' })
    await receber({ nome: 'respostaOutroProvedor', from: numeroA, texto: 'Ok 2', contextId: `wamid.OUTRO${rodada}` })

    // um número que ninguém tem
    await receber({ nome: 'desconhecido', from: desconhecido, texto: 'Quem são vocês?' })
    // do B
    await receber({ nome: 'doB', from: numeroB, texto: 'Sou o B' })
    // recibos e account_update da mesma rodada: NÃO podem aparecer
    for (const s of ['sent', 'delivered', 'read', 'failed']) {
      await receber({ nome: `recibo-${s}`, from: numeroA, sufixo: s })
    }
    await sql`
      insert into webhook_inbox (source, event_id, payload, processed_at)
      values ('meta', ${`account_update:${PREFIXO_DO_WAMID}`},
              ${sql.json({ field: 'account_update', value: { event: 'VERIFIED_ACCOUNT', from: numeroA } })}, now())`
    ids['account_update'] = Number(
      (await sql`select id from webhook_inbox where source = 'meta' and event_id = ${`account_update:${PREFIXO_DO_WAMID}`}`)[0].id,
    )
    // fora da janela e fora do período
    await receber({ nome: 'de100dias', from: numeroA, texto: 'Muito antiga', diasAtras: 100 })
    await receber({ nome: 'de10dias', from: numeroA, texto: 'De dez dias', diasAtras: 10 })
  })

  afterAll(async () => {
    await sql`delete from webhook_inbox where source = 'meta' and event_id like ${`${PREFIXO_DO_WAMID}%`}`
    await sql`delete from webhook_inbox where source = 'meta' and event_id = ${`account_update:${PREFIXO_DO_WAMID}`}`
    await sql`delete from notification_outbox where dedupe_key like ${`m3rec:${rodada}:%`}`
    await sql.end()
  })

  const doA = (nome: string, linhas: Awaited<ReturnType<typeof todasAsRecebidas>>) =>
    linhas.find((l) => l.id === String(ids[nome]))

  it('lista só mensagens: recibo (sent/delivered/read/failed) e account_update ficam de fora', async () => {
    const todas = await todasAsRecebidas()
    const aparecem = new Set(todas.map((l) => l.id))
    for (const s of ['sent', 'delivered', 'read', 'failed']) {
      expect(aparecem.has(String(ids[`recibo-${s}`])), s).toBe(false)
    }
    expect(aparecem.has(String(ids.account_update))).toBe(false)
    // e as mensagens desta rodada estão lá
    expect(aparecem.has(String(ids.texto))).toBe(true)
    expect(aparecem.has(String(ids.desconhecido))).toBe(true)
  })

  it('com o filtro do aluno A, a aba é exatamente as mensagens dele — recibo, account_update e antigas de fora', async () => {
    const d = await ler({ aluno: alunoA })
    // texto, parar, naoParar, comMais, audio, imagem, resposta, respostaSolta, respostaOutroProvedor, de10dias
    expect(d.contagens.recebida).toBe(10)
    expect(d.recebidas!.linhas).toHaveLength(10)
    const nomes = new Set(d.recebidas!.linhas.map((l) => l.id))
    expect(nomes.has(String(ids.doB))).toBe(false)
    expect(nomes.has(String(ids.desconhecido))).toBe(false)
    expect(nomes.has(String(ids.de100dias))).toBe(false)
  })

  it('casa o `from` com o número do aluno, com e sem `+`, e mostra o nome dele', async () => {
    const linhas = (await ler({ aluno: alunoA })).recebidas!.linhas
    for (const nome of ['texto', 'comMais']) {
      const l = doA(nome, linhas)!
      expect(l.alunos, nome).toEqual([{ id: alunoA, nome: nomeA }])
      expect(l.numero, nome).toBe(`+${numeroA}`)
    }
  })

  it('número que nenhum aluno tem: lista sem aluno (a tela diz "Número desconhecido") e com o número', async () => {
    const l = doA('desconhecido', await todasAsRecebidas())!
    expect(l).toBeDefined()
    expect(l.alunos).toEqual([])
    expect(l.numero).toBe(`+${desconhecido}`)
    expect(l.texto).toBe('Quem são vocês?')
  })

  it('dois alunos no mesmo número (família): a linha mostra os dois', async () => {
    const irmao = await createStudent(sql)
    const perfilIrmao = await createAuthUser(sql, 'student', `Irmão ${rodada}`, { whatsapp: `+${numeroA}` })
    await sql`update students set profile_id = ${perfilIrmao} where id = ${irmao}`
    const l = doA('texto', (await ler({ aluno: alunoA })).recebidas!.linhas)!
    expect(l.alunos.map((a) => a.id).sort()).toEqual([alunoA, irmao].sort())
  })

  it('o aviso nosso respondido aparece pelo `context.id` ↔ `provider_message_id` (provedor meta)', async () => {
    const linhas = (await ler({ aluno: alunoA })).recebidas!.linhas
    const casada = doA('resposta', linhas)!
    expect(casada.respondeA).toMatch(/^Lembrete de aula · aula \d{2}\/\d{2} às \d{2}:\d{2}$/)
    expect(doA('texto', linhas)!.respondeA).toBeNull()
    // id que não é nosso, e id de outro provedor: sem aviso respondido, só a mensagem
    expect(doA('respostaSolta', linhas)!.respondeA).toBeNull()
    expect(doA('respostaOutroProvedor', linhas)!.respondeA).toBeNull()
  })

  it('palavra de parada: só a linha certa leva o selo, e a contagem do topo bate', async () => {
    const d = await ler({ aluno: alunoA })
    const com = d.recebidas!.linhas.filter((l) => l.pediuParaParar).map((l) => l.id)
    expect(com).toEqual([String(ids.parar)])
    expect(d.recebidas!.paradas).toBe(1)
    expect(doA('naoParar', d.recebidas!.linhas)!.pediuParaParar).toBe(false)
    expect(doA('texto', d.recebidas!.linhas)!.pediuParaParar).toBe(false)
  })

  it('a contagem de paradas é do recorte inteiro, não só da página', async () => {
    // 52 linhas só do A para empurrar a "PARAR" para a página 2 (mais antiga = fim da lista)
    await sql`
      insert into webhook_inbox (source, event_id, payload, processed_at, received_at)
      select 'meta', ${`${PREFIXO_DO_WAMID}massa`}::text || g::text || ':message',
             jsonb_build_object('message', jsonb_build_object('from', ${numeroA}::text, 'type', 'text', 'id', 'x',
                                                              'text', jsonb_build_object('body', 'Ok ' || g::text))),
             now(), now() + make_interval(secs => g)
        from generate_series(1, 52) g`
    const p1 = await ler({ aluno: alunoA, pagina: 1 })
    const p2 = await ler({ aluno: alunoA, pagina: 2 })
    expect(p1.contagens.recebida).toBe(62)
    expect(p1.recebidas!.linhas).toHaveLength(POR_PAGINA)
    expect(p2.recebidas!.linhas).toHaveLength(12)
    expect(p1.recebidas!.paradas).toBe(1)
    expect(p2.recebidas!.paradas).toBe(1)
    expect([p1.primeira, p1.ultima, p2.primeira, p2.ultima]).toEqual([1, 50, 51, 62])
    expect(p1.totalDePaginas).toBe(2)
    // a lista paginada não repete nem perde linha
    const vistas = [...p1.recebidas!.linhas, ...p2.recebidas!.linhas].map((l) => l.id)
    expect(new Set(vistas).size).toBe(62)
    await sql`delete from webhook_inbox where source = 'meta' and event_id like ${`${PREFIXO_DO_WAMID}massa%`}`
  })

  it('áudio e imagem: mostram o tipo e nenhum texto', async () => {
    const linhas = (await ler({ aluno: alunoA })).recebidas!.linhas
    expect(doA('audio', linhas)).toMatchObject({ tipo: 'Áudio', texto: null, pediuParaParar: false })
    expect(doA('imagem', linhas)).toMatchObject({ tipo: 'Imagem', texto: null, pediuParaParar: false })
  })

  it('a hora sai como texto no fuso da escola (o cliente não formata)', async () => {
    const l = doA('texto', (await ler({ aluno: alunoA })).recebidas!.linhas)!
    expect(l.quando).toMatch(/^\d{2}\/\d{2} às \d{2}:\d{2}$/)
  })

  it('a janela é de 90 dias, mesmo em "Tudo"; o período de 7 dias corta o de 10', async () => {
    const tudo = await ler({ aluno: alunoA, periodo: 'tudo' })
    expect(doA('de100dias', tudo.recebidas!.linhas)).toBeUndefined()
    expect(doA('de10dias', tudo.recebidas!.linhas)).toBeDefined()
    const sete = await ler({ aluno: alunoA, periodo: '7' })
    expect(doA('de10dias', sete.recebidas!.linhas)).toBeUndefined()
    expect(sete.contagens.recebida).toBe(9)
    const trinta = await ler({ aluno: alunoA, periodo: '30' })
    expect(doA('de10dias', trinta.recebidas!.linhas)).toBeDefined()
  })

  it('filtro por aluno: o A não vê o B, o B vê só o dele, e aluno sem número ou inexistente fica vazio', async () => {
    const b = await ler({ aluno: alunoB })
    expect(b.contagens.recebida).toBe(1)
    expect(b.recebidas!.linhas.map((l) => l.id)).toEqual([String(ids.doB)])
    const sem = await ler({ aluno: alunoSemNumero })
    expect(sem.contagens.recebida).toBe(0)
    expect(sem.recebidas!.linhas).toEqual([])
    const fantasma = await ler({ aluno: crypto.randomUUID() })
    expect(fantasma.contagens.recebida).toBe(0)
    expect(fantasma.recebidas!.linhas).toEqual([])
  })

  it('a contagem da aba aparece nas outras abas e bate com a lista', async () => {
    const naAbaTodos = await ler({ aba: 'todos', aluno: alunoA })
    const naAbaRecebida = await ler({ aba: 'recebida', aluno: alunoA })
    expect(naAbaTodos.contagens.recebida).toBe(10)
    expect(naAbaTodos.recebidas).toBeNull()
    expect(naAbaRecebida.contagens.recebida).toBe(naAbaRecebida.recebidas!.linhas.length)
    // as abas do outbox não mudam por causa da inbox
    const semRecebida = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'recebida'))
    const outrasTodos = semRecebida(naAbaTodos.contagens)
    const outrasRecebida = semRecebida(naAbaRecebida.contagens)
    expect(outrasRecebida).toEqual(outrasTodos)
    expect(outrasTodos.todos).toBe(2) // os dois avisos nossos do A (meta e resend)
  })

  it('a aba não grava nada: a inbox fica do jeito que estava', async () => {
    const antes = await sql`select count(*)::int as n, count(processed_at)::int as p from webhook_inbox where source = 'meta' and event_id like ${`${PREFIXO_DO_WAMID}%`}`
    await ler({ aluno: alunoA })
    await ler({ aba: 'todos' })
    const depois = await sql`select count(*)::int as n, count(processed_at)::int as p from webhook_inbox where source = 'meta' and event_id like ${`${PREFIXO_DO_WAMID}%`}`
    expect(depois[0]).toEqual(antes[0])
  })

  it('lerRecebidas sozinha: recorte sem número aceito devolve vazio sem consultar a escola inteira', async () => {
    const r = await lerRecebidas(servico, { desde: DateTime.utc().minus({ days: 90 }).toISO()!, numeros: [] }, 1)
    expect(r.linhas).toEqual([])
    expect(r.paradas).toBe(0)
  })
})
