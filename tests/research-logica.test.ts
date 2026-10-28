// PESQUISA DE PAUTA — a lógica PURA do worker (M5).
//
// O que se prova aqui é o que não depende de rede nem de banco: o endereço que
// vira identidade no banco (`source_key`), a janela semanal que impede a
// pesquisa de congelar, o filtro pré-LLM e os dois parsings que já morderam
// antes. A corrida real prova o resto — este arquivo prova o que um teste
// consegue provar sem gastar API.

import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'

import { BUSCAS, REDES, REDES_COM_VIDEO, TOP_POR_FONTE, temVideo, type Rede } from '@/lib/research/config'
import {
  chaveDoReel,
  chaveDosTrends,
  duracaoEmSegundos,
  engajamento,
  mediana,
  numero,
  semanaIso,
  snapshotDoCriador,
  type ItemDaPesquisa,
} from '@/lib/research/tipos'
import { ehDoTema, filtrar, fraseDoFiltro } from '@/lib/research/filtro'
import { campo, dataDe, ehObjeto, estimativaUsd, numeroDe, texto } from '@/lib/research/apify'
import { estimativaDaCorrida } from '@/lib/research/estimativa'
import { textoDaTrend, velocidadeDoItem } from '@/lib/research/radar'
import { entradaDaNota, notaDeViagemSchema } from '@/lib/research/travel'

function item(over: Partial<ItemDaPesquisa> = {}): ItemDaPesquisa {
  return {
    rede: 'youtube',
    id: crypto.randomUUID().slice(0, 8),
    url: 'https://exemplo/1',
    titulo: 'Como falar inglês sem travar',
    autor: 'canal',
    publicadoEm: null,
    duracaoS: 45,
    metricas: { views: 100_000 },
    ...over,
  }
}

describe('endereços da pesquisa (o que o banco usa como identidade)', () => {
  it('a semana ISO entra no endereço dos trends — sem ela a pesquisa CONGELA', () => {
    // O achado das 3 revisões do plano: com `trends:<rede>` fixo, a corrida da
    // semana seguinte receberia de volta o resultado da anterior e `--force`
    // viraria rotina. Semana nova = fonte nova, sem force.
    const jan = DateTime.fromISO('2026-01-15T10:00:00Z')
    const fev = DateTime.fromISO('2026-02-15T10:00:00Z')
    expect(chaveDosTrends('instagram', semanaIso(jan))).not.toBe(
      chaveDosTrends('instagram', semanaIso(fev)),
    )
    // …e duas corridas da MESMA semana caem no mesmo endereço (é o que faz a
    // re-corrida devolver o ativo em vez de duplicar).
    const segunda = DateTime.fromISO('2026-01-12T23:00:00Z')
    const sexta = DateTime.fromISO('2026-01-16T02:00:00Z')
    expect(semanaIso(segunda)).toBe(semanaIso(sexta))
  })

  it('a semana é ISO de verdade: vira o ano no dia certo e sempre tem 2 dígitos', () => {
    // 31/12/2025 é quinta da semana 1 de 2026 pelo calendário ISO — usar
    // `year` em vez de `weekYear` daria "2025-W01" e criaria uma fonte errada.
    expect(semanaIso(DateTime.fromISO('2025-12-31T12:00:00Z'))).toBe('2026-W01')
    expect(semanaIso(DateTime.fromISO('2026-03-02T12:00:00Z'))).toBe('2026-W10')
    expect(semanaIso(DateTime.fromISO('2026-01-05T12:00:00Z'))).toMatch(/^\d{4}-W\d{2}$/)
  })

  it('a semana é calculada em UTC, não no fuso da máquina de quem roda', () => {
    // Domingo 23h em São Paulo já é segunda em UTC: a janela tem de seguir o
    // relógio do servidor, senão duas máquinas gravariam semanas diferentes.
    const domingoTarde = DateTime.fromISO('2026-01-11T23:30:00-03:00')
    expect(semanaIso(domingoTarde)).toBe(semanaIso(domingoTarde.setZone('utc')))
    expect(semanaIso(domingoTarde)).toBe('2026-W03')
  })

  it('o endereço de um reel é estável e por rede', () => {
    expect(chaveDoReel('tiktok', 'abc123')).toBe('reel:tiktok:abc123')
    expect(chaveDoReel('youtube', 'abc123')).not.toBe(chaveDoReel('tiktok', 'abc123'))
  })

  it('as listas de rede espelham os CHECKs da migration', () => {
    expect([...REDES]).toEqual(['youtube', 'instagram', 'tiktok', 'x', 'reddit'])
    expect([...REDES_COM_VIDEO]).toEqual(['youtube', 'instagram', 'tiktok'])
    // X e Reddit não têm reel — o banco recusa `analise_reel` nelas, e o worker
    // nem tenta (é este predicado que ele consulta).
    expect(temVideo('x' as Rede)).toBe(false)
    expect(temVideo('reddit' as Rede)).toBe(false)
    for (const rede of REDES_COM_VIDEO) expect(temVideo(rede)).toBe(true)
  })
})

describe('filtro pré-LLM (barato, antes de qualquer token)', () => {
  it('descarta fora de tema, fraco e repetido — e conta cada motivo', () => {
    const repetido = item({ id: 'igual', titulo: 'dicas de inglês' })
    const r = filtrar('youtube', [
      item({ titulo: 'Phrasal verbs que você usa todo dia' }),
      item({ titulo: 'Receita de bolo de cenoura' }),
      item({ titulo: 'Aprender inglês rápido', metricas: { views: 12 } }),
      repetido,
      repetido,
    ])
    expect(r.itens).toHaveLength(2)
    expect(r.descartados).toEqual({ foraDoTema: 1, fracos: 1, repetidos: 1 })
  })

  it('acento não decide nada: "ingles" e "inglês" são a mesma palavra', () => {
    expect(ehDoTema(item({ titulo: 'DICAS DE INGLES PARA INICIANTES' }))).toBe(true)
    expect(ehDoTema(item({ titulo: 'Dicas de inglês' }))).toBe(true)
    expect(ehDoTema(item({ titulo: 'Como fazer pão caseiro' }))).toBe(false)
  })

  it('o autor também conta como sinal de tema', () => {
    expect(ehDoTema(item({ titulo: 'Vem comigo', autor: 'English with Lucy' }))).toBe(true)
  })

  it('dedupe ANTES do corte: o mesmo vídeo não ocupa duas vagas do topo', () => {
    const dobrado = Array.from({ length: 6 }, () =>
      item({ id: 'x', titulo: 'inglês', metricas: { views: 999_999 } }),
    )
    const r = filtrar('youtube', [...dobrado, item({ titulo: 'inglês na prática' })], 2)
    expect(r.itens).toHaveLength(2)
    expect(new Set(r.itens.map((i) => i.id)).size).toBe(2)
  })

  it('ordena por engajamento e corta no limite pedido', () => {
    const r = filtrar(
      'youtube',
      [
        item({ titulo: 'inglês A', metricas: { views: 10_000 } }),
        item({ titulo: 'inglês B', metricas: { views: 900_000 } }),
        item({ titulo: 'inglês C', metricas: { views: 300_000 } }),
      ],
      2,
    )
    expect(r.itens.map((i) => i.titulo)).toEqual(['inglês B', 'inglês C'])
  })

  it('cada rede tem o próprio piso: o mesmo post passa no X e reprova no TikTok', () => {
    const post = item({ titulo: 'english tips', metricas: { likes: 120 } })
    expect(filtrar('x', [{ ...post, rede: 'x' }]).itens).toHaveLength(1)
    expect(filtrar('tiktok', [{ ...post, rede: 'tiktok' }]).itens).toHaveLength(0)
  })

  it('Reddit não tem número público: nada é cortado por piso e a ORDEM do feed sobrevive', () => {
    // O feed Atom (a única porta que o Reddit ainda abre sem OAuth) não traz
    // upvote nem comentário — piso sobre número inexistente zeraria a fonte. Lá
    // o ranking é a própria ordem do "top da semana", e a ordenação estável a
    // preserva.
    const posts = [1, 2, 3].map((n) =>
      item({
        rede: 'reddit',
        titulo: `[r/EnglishLearning] dúvida ${n}`,
        metricas: { posicao_no_top: n },
      }),
    )
    const r = filtrar('reddit', posts)
    expect(r.itens).toHaveLength(3)
    expect(r.itens.map((i) => i.metricas.posicao_no_top)).toEqual([1, 2, 3])
  })

  it('o engajamento é o maior número público — cada rede conta a sua moeda', () => {
    expect(engajamento(item({ metricas: { upvotes: 300, comentarios: 12 } }))).toBe(300)
    expect(engajamento(item({ metricas: {} }))).toBe(0)
  })

  it('a frase do terminal diz o que entrou e o que ficou de fora', () => {
    const r = filtrar('reddit', [item({ rede: 'reddit', titulo: 'bolo' })])
    expect(fraseDoFiltro('reddit', 1, r)).toMatch(/1 coletados → 0 guardados/)
    expect(fraseDoFiltro('reddit', 1, r)).toMatch(/fora de tema 1/)
  })
})

describe('parsings que já morderam antes', () => {
  it('duração ISO-8601 do YouTube', () => {
    expect(duracaoEmSegundos('PT1M30S')).toBe(90)
    expect(duracaoEmSegundos('PT45S')).toBe(45)
    expect(duracaoEmSegundos('PT1H2M3S')).toBe(3723)
    // `P0D`/`PT0S` são live ou vídeo sem duração: NaN, para o filtro de 90s não
    // aceitar como "curtíssimo".
    expect(duracaoEmSegundos('PT0S')).toBeNaN()
    expect(duracaoEmSegundos('meia hora')).toBeNaN()
    expect(duracaoEmSegundos(undefined)).toBeNaN()
  })

  it('número que veio como string, com pontuação ou ausente', () => {
    expect(numero('1234')).toBe(1234)
    expect(numero(12)).toBe(12)
    expect(numero(undefined)).toBe(0)
    expect(numero('n/d')).toBe(0)
    expect(numero(Number.NaN)).toBe(0)
  })

  it('data em ISO, epoch de segundos e epoch de milissegundos', () => {
    expect(dataDe({ a: '2026-08-01T10:00:00Z' }, 'a')).toBe('2026-08-01T10:00:00.000Z')
    expect(dataDe({ a: 1767225600 }, 'a')).toBe(dataDe({ a: 1767225600000 }, 'a'))
    expect(dataDe({ a: 'ontem' }, 'a')).toBeNull()
    expect(dataDe({}, 'a')).toBeNull()
  })
})

describe('tradutor tolerante do Apify (o que sobrevive a drift de ator)', () => {
  it('pega o primeiro caminho que existir, inclusive aninhado', () => {
    const bruto = { stats: { playCount: 42 }, authorMeta: { name: 'lucy' } }
    expect(numeroDe(bruto, 'playCount', 'stats.playCount')).toBe(42)
    expect(texto(bruto, 'author.uniqueId', 'authorMeta.name')).toBe('lucy')
    expect(campo(bruto, 'nao.existe')).toBeUndefined()
  })

  it('vazio e nulo NÃO contam como valor presente — o sinônimo seguinte assume', () => {
    expect(texto({ a: '', b: 'valeu' }, 'a', 'b')).toBe('valeu')
    expect(numeroDe({ a: null, b: 7 }, 'a', 'b')).toBe(7)
  })

  it('item que não é objeto (o ator devolve string de erro) é reconhecido', () => {
    expect(ehObjeto({ a: 1 })).toBe(true)
    expect(ehObjeto([1, 2])).toBe(false)
    expect(ehObjeto(null)).toBe(false)
    expect(ehObjeto('erro do ator')).toBe(false)
  })

  it('a estimativa de custo do Apify é por mil resultados', () => {
    expect(estimativaUsd({ id: 'x', usdPorMil: 4 }, 500)).toBeCloseTo(2)
    expect(estimativaUsd({ id: 'x', usdPorMil: 4 }, 0)).toBe(0)
  })
})

describe('snapshot do criador (as chaves SÃO a frase da ficha)', () => {
  it('a mediana descreve o canal melhor que a média — um viral não define ninguém', () => {
    expect(mediana([10, 20, 1_000_000])).toBe(20)
    expect(mediana([10, 20])).toBe(15)
    expect(mediana([])).toBe(0)
  })

  it('só entra número finito: null, undefined e NaN somem do snapshot', () => {
    const s = snapshotDoCriador({
      inscritos: 1000,
      'views medianas': Number.NaN,
      'curtos recentes': null,
      seguidores: undefined,
    })
    expect(s).toEqual({ inscritos: 1000 })
  })

  it('snapshot vazio continua representável — é o caso Vanessa do M2.0', () => {
    // "Mediu e não achou nada" precisa existir: o CHECK `medicao_shape` do M4 é
    // implicação, não bicondicional, e a ficha diz "nada encontrado".
    expect(snapshotDoCriador({ inscritos: Number.NaN })).toEqual({})
  })
})

describe('estimativa da corrida (Leva 1.1 — o número impresso é sobre o cadastro REAL)', () => {
  const canais = (n: number, plataforma: Rede) => Array.from({ length: n }, () => ({ plataforma }))

  /** O termo fixo de TRENDS com as sementes de hoje: 100 itens de IG × 2,30/mil
   *  + 100 de TikTok × 4,00/mil + 60 de X × 0,40/mil. Sai da mesma fonte que o
   *  código, para o teste continuar verdadeiro quando a dona girar as sementes. */
  const TRENDS =
    (TOP_POR_FONTE * 2 * BUSCAS.instagram.length * 2.3) / 1000 +
    (TOP_POR_FONTE * 2 * BUSCAS.tiktok.length * 4) / 1000 +
    (TOP_POR_FONTE * 2 * BUSCAS.x.length * 0.4) / 1000

  it('o "7" morreu: 20 criadores em redes com vídeo → até 46 reels (aceite da leva)', () => {
    // 2 reels × 3 redes com vídeo (trends) + 2 reels × 20 criadores.
    const e = estimativaDaCorrida([...canais(10, 'youtube'), ...canais(10, 'instagram')])
    expect(e.reels).toBe(46)
  })

  it('as chamadas de PERFIL entram na conta — era o buraco que dominava a fatura', () => {
    // Perfil IG: 30 itens × 2,30/mil = 0,069 por criador. A conta antiga parava
    // no termo de trends e ignorava isto.
    const e = estimativaDaCorrida(canais(10, 'instagram'))
    expect(e.usdApify).toBeCloseTo(TRENDS + 10 * 0.069, 3)
  })

  it('CALIBRAÇÃO 04/08: o teto da busca é por SEMENTE, não por rede', () => {
    // O número impresso mentia por 63% (0,82 impresso × 1,34 cobrado). Causa:
    // a conta usava `TOP_POR_FONTE * 2` UMA vez por rede, mas cada rede manda
    // todas as sementes de uma vez e o ator aplica o teto a CADA uma —
    // medido em produção (W31/W32): IG 60 e 100, TikTok 35 e 70, X 40 e 60.
    const e = estimativaDaCorrida([])
    expect(e.usdApify, 'trends com as 13 sementes de hoje').toBeCloseTo(TRENDS, 3)
    // E a linha diz de onde vem o número, para ninguém ter de reconstruir a conta.
    expect(e.linhas[0]).toContain('260 itens')
    expect(e.linhas[0]).toContain('Instagram 5')

    // A prova de que acompanha o cadastro editorial: girar sementes muda o custo.
    const itensIG = TOP_POR_FONTE * 2 * BUSCAS.instagram.length
    expect(itensIG).toBe(100)
  })

  it('criador do X custa Apify mas NÃO gera análise (o banco recusa reel de X)', () => {
    const e = estimativaDaCorrida(canais(1, 'x'))
    expect(e.usdApify).toBeCloseTo(TRENDS + 0.008, 3)
    expect(e.reels).toBe(6)
    expect(e.linhas.join('\n')).toContain('sem reel para analisar')
  })

  it('YouTube é API oficial: criador lá não soma Apify, e a linha diz isso', () => {
    const e = estimativaDaCorrida(canais(10, 'youtube'))
    expect(e.usdApify).toBeCloseTo(TRENDS, 3)
    expect(e.reels).toBe(26)
    expect(e.linhas.join('\n')).toContain('API oficial')
  })

  it('--so=trends tira os criadores da conta; --so=criadores tira os trends', () => {
    const cadastro = canais(10, 'instagram')
    const soTrends = estimativaDaCorrida(cadastro, { so: 'trends' })
    expect(soTrends.usdApify).toBeCloseTo(TRENDS, 3)
    expect(soTrends.reels).toBe(6)

    const soCriadores = estimativaDaCorrida(cadastro, { so: 'criadores' })
    expect(soCriadores.usdApify).toBeCloseTo(10 * 0.069, 3)
    expect(soCriadores.reels).toBe(20)
  })

  it('--rede limita os trends (e os reels de trend) à rede pedida', () => {
    const e = estimativaDaCorrida([], { rede: 'instagram' })
    // Só o Instagram: 5 sementes × 20 itens × 2,30/mil.
    expect(e.usdApify).toBeCloseTo((TOP_POR_FONTE * 2 * BUSCAS.instagram.length * 2.3) / 1000, 3)
    expect(e.reels).toBe(2)
  })

  it('cadastro vazio não vira silêncio: a linha diz que não há criador no recorte', () => {
    const e = estimativaDaCorrida([])
    expect(e.linhas.join('\n')).toContain('nenhum no recorte')
  })
})

/* ══════════════════════════════════════════════════════════════════════════ */
/* Radar (Leva 2.2) — velocidade, texto embedado e a nota de viagem           */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('velocidadeDoItem — a conta da velocidade (ADR-032 decisão 2)', () => {
  const T0 = '2026-08-03T12:00:00.000Z'
  const diasAntes = (n: number) => new Date(Date.parse(T0) - n * 86_400_000).toISOString()

  it('com conta cadastrada: views/dia ÷ mediana', () => {
    const v = velocidadeDoItem({
      views: 3000, publicadoEm: diasAntes(3), medidoEm: T0, medianaDaConta: 100,
    })
    expect(v).toEqual({ velocidade: 10, semConta: false })
  })

  it('sem conta (ou mediana 0): views/dia puro com a flag ligada', () => {
    const semMediana = velocidadeDoItem({
      views: 3000, publicadoEm: diasAntes(3), medidoEm: T0, medianaDaConta: null,
    })
    expect(semMediana).toEqual({ velocidade: 1000, semConta: true })
    const medianaZero = velocidadeDoItem({
      views: 3000, publicadoEm: diasAntes(3), medidoEm: T0, medianaDaConta: 0,
    })
    expect(medianaZero.semConta).toBe(true)
  })

  it('piso de 1 dia por desenho: item de 6 horas não extrapola ×4 (mesma conta do script 2.3)', () => {
    const v = velocidadeDoItem({
      views: 2400, publicadoEm: diasAntes(0.25), medidoEm: T0, medianaDaConta: null,
    })
    expect(v.velocidade).toBe(2400)
  })

  it('dado que não dá conta honesta vira NULL, nunca número inventado', () => {
    // publicado DEPOIS de medido (achado nº 15 do Sol: no script isso aborta;
    // no worker é fail-open com aviso do chamador)
    expect(
      velocidadeDoItem({ views: 100, publicadoEm: diasAntes(-1), medidoEm: T0, medianaDaConta: 5 }),
    ).toEqual({ velocidade: null, semConta: false })
    expect(
      velocidadeDoItem({ views: null, publicadoEm: diasAntes(3), medidoEm: T0, medianaDaConta: 5 }),
    ).toEqual({ velocidade: null, semConta: false })
    expect(
      velocidadeDoItem({ views: 100, publicadoEm: null, medidoEm: T0, medianaDaConta: 5 }),
    ).toEqual({ velocidade: null, semConta: false })
    expect(
      velocidadeDoItem({ views: 100, publicadoEm: 'não-é-data', medidoEm: T0, medianaDaConta: 5 }),
    ).toEqual({ velocidade: null, semConta: false })
  })
})

describe('textoDaTrend e entradaDaNota — o que vai ao Gemini e ao Haiku', () => {
  it('texto embedado = título + trecho da transcrição (ADR-034)', () => {
    expect(textoDaTrend({ titulo: 'Pedir café no aeroporto' })).toBe('Pedir café no aeroporto')
    const t = textoDaTrend({ titulo: 'T', transcricao: 'x'.repeat(5000) })
    expect(t.length).toBe(1 + 1 + 1500) // título + \n + trecho cortado
  })

  it('entrada da nota traz o título sempre e a transcrição só quando existe', () => {
    const so = entradaDaNota({ titulo: 'Pedir café', transcricao: '  ' })
    expect(so).toContain('TÍTULO: Pedir café')
    expect(so).not.toContain('TRANSCRIÇÃO')
    const com = entradaDaNota({ titulo: 'Pedir café', transcricao: 'y'.repeat(9000) })
    expect(com).toContain('TRANSCRIÇÃO')
    expect(com.length).toBeLessThan(1800)
  })
})

describe('notaDeViagemSchema — o contrato do Haiku é estrito', () => {
  it('aceita a saída combinada e rejeita as tortas', () => {
    expect(notaDeViagemSchema.parse({ nota: 84, justificativa: 'nativa de viagem: aeroporto' }))
      .toEqual({ nota: 84, justificativa: 'nativa de viagem: aeroporto' })
    for (const torta of [
      { nota: 101, justificativa: 'x' },
      { nota: -1, justificativa: 'x' },
      { nota: 50.5, justificativa: 'x' },
      { nota: 50, justificativa: '   ' },
      { nota: 50, justificativa: 'x', extra: true },
      { justificativa: 'x' },
    ]) {
      expect(() => notaDeViagemSchema.parse(torta), JSON.stringify(torta)).toThrow()
    }
  })
})
