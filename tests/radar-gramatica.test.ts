// RADAR — a gramática pura da tela de triagem (Estúdio v2 · Leva 3).
//
// O que este arquivo prova, sem banco:
// · `semanaDaRodada` ≡ `semanaIso` do worker (a UI REIMPLEMENTA a fórmula de
//   propósito — módulo do worker não atravessa para a tela — e este teste é o
//   que impede as duas de divergirem em virada de ano ISO);
// · `ehRodada` espelha o CHECK `content_trends_semana_check` (W01–W53);
// · a ordem do deck é TOTAL (desempate por id — sem isso o contador pulsa);
// · a montagem mãe×variação (raiz, pendurada, órfã);
// · o "De onde veio" e as frases de número;
// · as traduções de recusa, casadas com os textos EXATOS dos `raise` do guard
//   da migration 20260803000300;
// · o porteiro do recado conhece a subrota nova (sem isso o toast do descarte
//   some em silêncio — o defeito mais provável da leva);
// · a aba PT (Leva 4): a precedência da válvula (`ajustado ?? score`), o corte
//   do limiar com NULL fora, a ordem por nota com empate caindo na triagem, e
//   os endereços com `ver=pt` atravessando o porteiro — com REGRESSÃO de que o
//   default `triagem` continua byte a byte igual.

import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'

import {
  CASA_DO_RADAR,
  FRASES_DE_RECUSA,
  LIMIAR_ABA_PT,
  NOTA_MAXIMA,
  NOTA_MINIMA,
  RECUSA_DESCONHECIDA,
  RODADA_FORMATO,
  casaDaVista,
  chaveDaNota,
  chaveDoDescarte,
  ehPainelDoRadar,
  ehRodada,
  ehVariacaoOrfa,
  ehVistaDoRadar,
  enderecoDaVistaTodos,
  enderecoDoCartao,
  enderecoDoPainelDescartar,
  enderecoDoPainelNota,
  notaDaTrend,
  ordenarDeckPT,
  ordenarGrupoComVariacoes,
  passaNaAbaPT,
  fraseDaRecusaDoBanco,
  fraseDaVelocidade,
  fraseDeOndeVeio,
  fraseDeViews,
  idDoYoutube,
  montarDeck,
  ordenarDeck,
  rotuloDaRodada,
  semanaDaRodada,
} from '@/data/admin/radar-gramatica'
import { semanaIso } from '@/lib/research/tipos'
import { destinoDaSecao } from '@/lib/kit/recado'

describe('semanaDaRodada — o espelho da fórmula do worker', () => {
  it('bate com semanaIso nas datas-armadilha de virada de ano ISO', () => {
    const datas = [
      DateTime.utc(2026, 12, 28), // segunda da W53 de 2026
      DateTime.utc(2027, 1, 1), // sexta que ainda é W53 de 2026
      DateTime.utc(2025, 12, 29), // segunda que já é W01 de 2026
      DateTime.utc(2026, 1, 4), // domingo da W01
      DateTime.utc(2024, 2, 29), // bissexto
      DateTime.utc(2026, 8, 3), // uma segunda comum (W32)
    ]
    for (const d of datas) {
      expect(semanaDaRodada(d), d.toISO()!).toBe(semanaIso(d))
    }
  })

  it('sai no formato do CHECK do banco', () => {
    expect(semanaDaRodada(DateTime.utc(2026, 8, 3))).toBe('2026-W32')
    expect(RODADA_FORMATO.test(semanaDaRodada())).toBe(true)
  })
})

describe('ehRodada — espelho do content_trends_semana_check', () => {
  it('aceita as bordas reais', () => {
    expect(ehRodada('2026-W01')).toBe(true)
    expect(ehRodada('2026-W53')).toBe(true)
    expect(ehRodada('2026-W32')).toBe(true)
  })
  it('recusa o que o CHECK recusa', () => {
    expect(ehRodada('2026-W00')).toBe(false)
    expect(ehRodada('2026-W54')).toBe(false)
    expect(ehRodada('2026-W5')).toBe(false)
    expect(ehRodada('26-W05')).toBe(false)
    expect(ehRodada('')).toBe(false)
    expect(ehRodada(null)).toBe(false)
  })
})

describe('idDoYoutube — embed só quando a URL é reconhecível', () => {
  it('resolve as quatro formas do YouTube', () => {
    expect(idDoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(idDoYoutube('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(idDoYoutube('https://www.youtube.com/shorts/xvFZjo5PgG0')).toBe('xvFZjo5PgG0')
    expect(idDoYoutube('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(idDoYoutube('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ')
  })
  it('devolve null para o resto — cartão-link, nunca palpite', () => {
    expect(idDoYoutube('https://www.instagram.com/reel/abc123/')).toBeNull()
    expect(idDoYoutube('https://www.youtube.com/watch')).toBeNull()
    expect(idDoYoutube('não é url')).toBeNull()
    expect(idDoYoutube(null)).toBeNull()
    expect(idDoYoutube('')).toBeNull()
  })
})

describe('ordenarDeck — ordem total e estável', () => {
  const linha = (
    id: string,
    semana: string,
    velocidade: number | null,
    semConta = false,
    capturada = '2026-08-03T10:00:00Z',
  ) => ({ id, semana, velocidade, velocidade_sem_conta: semConta, capturada_em: capturada })

  it('rodada nova primeiro; dentro dela velocidade desc com NULL por último', () => {
    const deck = [
      linha('a', '2026-W31', 9),
      linha('b', '2026-W32', null),
      linha('c', '2026-W32', 1.5),
      linha('d', '2026-W32', 4.2),
    ].sort(ordenarDeck)
    expect(deck.map((l) => l.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('velocidade SEM régua não fura a fila das com régua — unidades diferentes', () => {
    // 6.600 views/dia cru contra 4,2× a mediana: sem esta faixa, o cru venceria
    // sempre (medido na bancada — a órfã de 6.600 abria o deck).
    const deck = [
      linha('cru', '2026-W32', 6_600, true),
      linha('regua', '2026-W32', 4.2),
      linha('nulo', '2026-W32', null),
      linha('regua2', '2026-W32', 1.5),
    ].sort(ordenarDeck)
    expect(deck.map((l) => l.id)).toEqual(['regua', 'regua2', 'cru', 'nulo'])
  })

  it('desempata por captura mais antiga e, por fim, por id — nunca empate', () => {
    const deck = [
      linha('b', '2026-W32', 2, false, '2026-08-03T12:00:00Z'),
      linha('c', '2026-W32', 2, false, '2026-08-03T09:00:00Z'),
      linha('a', '2026-W32', 2, false, '2026-08-03T09:00:00Z'),
    ].sort(ordenarDeck)
    expect(deck.map((l) => l.id)).toEqual(['a', 'c', 'b'])
    // ordem total: nenhum par devolve 0
    expect(ordenarDeck(deck[0], deck[1])).not.toBe(0)
  })
})

describe('montarDeck — raiz, variação pendurada e órfã', () => {
  const t = (id: string, variacao_de: string | null) => ({ id, variacao_de })

  it('pendura a variação cuja mãe está no deck', () => {
    const { raizes, variacoesPor } = montarDeck([t('mae', null), t('filha', 'mae')])
    expect(raizes.map((r) => r.id)).toEqual(['mae'])
    expect(variacoesPor.get('mae')!.map((v) => v.id)).toEqual(['filha'])
  })

  it('a filha de mãe já decidida vira cartão próprio (órfã)', () => {
    const { raizes, variacoesPor } = montarDeck([t('filha', 'mae-roteirizada'), t('solta', null)])
    expect(raizes.map((r) => r.id).sort()).toEqual(['filha', 'solta'])
    expect(variacoesPor.size).toBe(0)
    expect(ehVariacaoOrfa(t('filha', 'mae-roteirizada'))).toBe(true)
    expect(ehVariacaoOrfa(t('solta', null))).toBe(false)
  })
})

describe('frases de número — a régua dita por extenso', () => {
  it('views em pt-BR, null vira null', () => {
    expect(fraseDeViews(128_400)).toBe('128.400 views')
    expect(fraseDeViews(null)).toBeNull()
  })
  it('velocidade normalizada × velocidade sem conta', () => {
    expect(fraseDaVelocidade(1.8, false)).toBe('1,8× a mediana da conta')
    expect(fraseDaVelocidade(5000, true)).toBe('5.000 views/dia — sem a régua da conta')
    expect(fraseDaVelocidade(null, false)).toBeNull()
    expect(fraseDaVelocidade(null, true)).toBeNull()
  })
})

describe('fraseDeOndeVeio — proveniência por código, com a regra do desvio', () => {
  const base = {
    plataforma: 'youtube' as const,
    semana: '2026-W32',
    rodadaCorrente: '2026-W32',
    viewsFrase: '128.400 views',
    velocidadeFrase: '4,2× a mediana da conta',
  }

  it('criador cadastrado sem desvio: nome, @ e rede — sem ruído de tipo/tier', () => {
    const frase = fraseDeOndeVeio({
      ...base,
      criador: { nome: 'English in Brazil', handle: 'carinafragozo', tipo: 'criador', tier: null },
      autor: null,
    })
    expect(frase).toBe(
      'De English in Brazil (@carinafragozo) no YouTube · rodada 2026-W32 (corrente) · 128.400 views · 4,2× a mediana da conta',
    )
  })

  it('o DESVIO aparece: empresa e tier definido', () => {
    const frase = fraseDeOndeVeio({
      ...base,
      criador: { nome: 'BBC Learning', handle: 'bbclearning', tipo: 'empresa', tier: 'grande' },
      autor: null,
    })
    expect(frase).toContain('empresa · alcance grande')
  })

  it('sem criador cadastrado, o autor da captura fala — e se anuncia fora da pauta', () => {
    const frase = fraseDeOndeVeio({ ...base, criador: null, autor: 'Random Teacher' })
    expect(frase).toContain('De Random Teacher no YouTube — fora da pauta de criadores')
  })

  it('sem autor nenhum, a frase diz isso — nunca inventa', () => {
    const frase = fraseDeOndeVeio({
      ...base,
      criador: null,
      autor: null,
      viewsFrase: null,
      velocidadeFrase: null,
      semana: '2026-W30',
    })
    expect(frase).toBe('Autor não identificado na captura do YouTube · rodada 2026-W30')
  })

  it('rodada passada sai sem a marca de corrente', () => {
    expect(rotuloDaRodada('2026-W30', '2026-W32')).toBe('rodada 2026-W30')
    expect(rotuloDaRodada('2026-W32', '2026-W32')).toBe('rodada 2026-W32 (corrente)')
  })
})

describe('fraseDaRecusaDoBanco — os raise EXATOS da migration 107', () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    [
      'new row for relation "content_trends" violates check constraint "content_trends_descartada_shape"',
      'Falha: o descarte precisa de um motivo — escreva por que essa trend sai de cena.',
    ],
    [
      'trend 5f0e… está descartada — imutável (Lei 8)',
      'Falha: essa trend já foi decidida — a decisão não se desfaz. Recarregue a página.',
    ],
    [
      'transição inválida de nova para gerando na trend 5f0e…',
      'Falha: essa mudança de estado não existe no radar — recarregue a página.',
    ],
    [
      'new row for relation "content_trends" violates check constraint "content_trends_decidida_shape"',
      'Falha: não consegui carimbar quem decidiu — saia, entre de novo e tente outra vez.',
    ],
    [
      'medição da trend 5f0e… é retrato da captura — congelada',
      'Falha: a medição da trend é do robô — esta tela só decide o destino dela.',
    ],
    [
      'permission denied for table content_trends',
      'Falha: a medição da trend é do robô — esta tela só decide o destino dela.',
    ],
    [
      'trend 5f0e… não se apaga (Lei 8) — descartar é estado',
      'Falha: trend não se apaga — descartar com motivo é o caminho, e o histórico fica.',
    ],
  ]

  it('cada marca sai com a frase da dona', () => {
    for (const [cru, frase] of casos) {
      expect(fraseDaRecusaDoBanco(cru), cru).toBe(frase)
      expect(FRASES_DE_RECUSA).toContain(frase)
    }
  })

  it('recusa desconhecida cai na frase honesta', () => {
    expect(fraseDaRecusaDoBanco('deadlock detected')).toBe(RECUSA_DESCONHECIDA)
    expect(fraseDaRecusaDoBanco(null)).toBe(RECUSA_DESCONHECIDA)
  })
})

describe('vista Todos — endereço e ordem do grupo', () => {
  it('enderecoDaVistaTodos carrega só os filtros presentes', () => {
    expect(enderecoDaVistaTodos()).toBe('/admin/conteudo?ver=todos')
    expect(enderecoDaVistaTodos({ plataforma: 'youtube', rodada: '2026-W32' })).toBe(
      '/admin/conteudo?ver=todos&plataforma=youtube&rodada=2026-W32',
    )
    expect(enderecoDaVistaTodos({ criador: 'fora' })).toBe(
      '/admin/conteudo?ver=todos&criador=fora',
    )
  })

  it('a variação sobe para logo depois da mãe; sem mãe no grupo, fica onde a ordem pôs', () => {
    const linha = (id: string, velocidade: number | null, variacao_de: string | null = null) => ({
      id,
      semana: '2026-W32',
      velocidade,
      velocidade_sem_conta: false,
      capturada_em: '2026-08-03T10:00:00Z',
      variacao_de,
    })
    // Sem a pendura, a ordem seria rapida(9) > filha(5) > mae(4) > lenta(1).
    const grupo = ordenarGrupoComVariacoes([
      linha('mae', 4),
      linha('filha', 5, 'mae'),
      linha('rapida', 9),
      linha('lenta', 1),
      linha('orfa', 0.5, 'mae-fora-do-grupo'),
    ])
    expect(grupo.map((l) => l.id)).toEqual(['rapida', 'mae', 'filha', 'lenta', 'orfa'])
  })
})

describe('nota de viagem e a aba PT (Leva 4)', () => {
  const nota = (score: number | null, ajustado: number | null = null) => ({
    travel_score: score,
    travel_score_ajustado: ajustado,
  })

  it('notaDaTrend: a válvula da dona vence sempre — inclusive com ajuste 0', () => {
    expect(notaDaTrend(nota(10, 95))).toBe(95)
    expect(notaDaTrend(nota(80, 0))).toBe(0)
    expect(notaDaTrend(nota(72))).toBe(72)
    expect(notaDaTrend(nota(null))).toBeNull()
    expect(notaDaTrend(nota(null, 60))).toBe(60)
  })

  it('passaNaAbaPT: o limiar é inclusivo e NULL fica fora por construção', () => {
    expect(passaNaAbaPT(nota(LIMIAR_ABA_PT))).toBe(true)
    expect(passaNaAbaPT(nota(LIMIAR_ABA_PT - 1))).toBe(false)
    expect(passaNaAbaPT(nota(null))).toBe(false)
  })

  it('a reclassificação corta nos DOIS sentidos — puxar para dentro e expulsar', () => {
    expect(passaNaAbaPT(nota(80, 10))).toBe(false)
    expect(passaNaAbaPT(nota(10, 60))).toBe(true)
    expect(passaNaAbaPT(nota(null, 60))).toBe(true)
  })

  it('o limiar é injetável — apertar a régua muda o corte', () => {
    expect(passaNaAbaPT(nota(79), 80)).toBe(false)
    expect(passaNaAbaPT(nota(80), 80)).toBe(true)
  })

  it('ordenarDeckPT: nota desc; empate cai na ordem da triagem; ordem total', () => {
    const linha = (
      id: string,
      score: number | null,
      ajustado: number | null = null,
      velocidade: number | null = null,
    ) => ({
      id,
      semana: '2026-W32',
      velocidade,
      velocidade_sem_conta: false,
      capturada_em: '2026-08-03T10:00:00Z',
      ...nota(score, ajustado),
    })
    // O ajuste manda na posição: 'puxada' (score 10, ajustado 90) abre o deck.
    const deck = [
      linha('media', 70, null, 9),
      linha('puxada', 10, 90),
      linha('alta', 85),
      linha('empate-lenta', 70, null, 1.5),
    ].sort(ordenarDeckPT)
    expect(deck.map((l) => l.id)).toEqual(['puxada', 'alta', 'media', 'empate-lenta'])
    // ordem total: nenhum par devolve 0 (o empate desce até o id)
    for (let i = 0; i < deck.length - 1; i++) {
      expect(ordenarDeckPT(deck[i], deck[i + 1]), deck[i].id).not.toBe(0)
    }
    expect(ordenarDeckPT(linha('a', 70), linha('b', 70))).toBeLessThan(0)
  })
})

describe('a vista pt — endereço, chip e round-trip', () => {
  it('pt é vista; a casa dela carrega ver=pt', () => {
    expect(ehVistaDoRadar('pt')).toBe(true)
    expect(casaDaVista('pt')).toBe('/admin/conteudo?ver=pt')
    expect(casaDaVista('triagem')).toBe(CASA_DO_RADAR)
  })

  it('os endereços da vista pt carregam ver=pt na frente', () => {
    expect(enderecoDoCartao('abc', 'pt')).toBe('/admin/conteudo?ver=pt&alvo=abc')
    expect(enderecoDoPainelDescartar('abc', 'pt')).toBe(
      '/admin/conteudo?ver=pt&alvo=abc&painel=descartar',
    )
  })

  it('REGRESSÃO: o default triagem sai byte a byte igual ao endereço de sempre', () => {
    expect(enderecoDoCartao('abc')).toBe('/admin/conteudo?alvo=abc')
    expect(enderecoDoCartao()).toBe(CASA_DO_RADAR)
    expect(enderecoDoPainelDescartar('abc')).toBe(
      '/admin/conteudo?alvo=abc&painel=descartar',
    )
  })

  it('o porteiro deixa a vista pt atravessar intacta', () => {
    expect(destinoDaSecao('conteudo', casaDaVista('pt'))).toBe(casaDaVista('pt'))
    expect(destinoDaSecao('conteudo', enderecoDoCartao('abc', 'pt'))).toBe(
      enderecoDoCartao('abc', 'pt'),
    )
    expect(destinoDaSecao('conteudo', enderecoDoPainelDescartar('abc', 'pt'))).toBe(
      enderecoDoPainelDescartar('abc', 'pt'),
    )
  })
})

describe('painel de ajuste de nota (Leva 4.2) — endereço, chave e faixa', () => {
  it('nota é painel; o endereço carrega a vista', () => {
    expect(ehPainelDoRadar('nota')).toBe(true)
    expect(enderecoDoPainelNota('abc')).toBe('/admin/conteudo?alvo=abc&painel=nota')
    expect(enderecoDoPainelNota('abc', 'pt')).toBe(
      '/admin/conteudo?ver=pt&alvo=abc&painel=nota',
    )
  })

  it('a chave do rascunho é POR TREND e não colide com a do descarte', () => {
    expect(chaveDaNota('abc')).toBe('radar-nota:abc')
    expect(chaveDaNota('abc')).not.toBe(chaveDoDescarte('abc'))
  })

  it('a faixa espelha o CHECK 0–100 da migration 107', () => {
    expect(NOTA_MINIMA).toBe(0)
    expect(NOTA_MAXIMA).toBe(100)
  })

  it('o porteiro deixa o painel de nota atravessar nas duas vistas', () => {
    expect(destinoDaSecao('conteudo', enderecoDoPainelNota('abc'))).toBe(
      enderecoDoPainelNota('abc'),
    )
    expect(destinoDaSecao('conteudo', enderecoDoPainelNota('abc', 'pt'))).toBe(
      enderecoDoPainelNota('abc', 'pt'),
    )
  })
})

describe('recado da seção conteudo — o porteiro conhece o radar', () => {
  it('a geometria da triagem sobrevive ao porteiro', () => {
    expect(destinoDaSecao('conteudo', CASA_DO_RADAR)).toBe(CASA_DO_RADAR)
    expect(destinoDaSecao('conteudo', enderecoDoCartao('abc'))).toBe(enderecoDoCartao('abc'))
    expect(destinoDaSecao('conteudo', enderecoDoPainelDescartar('abc'))).toBe(
      enderecoDoPainelDescartar('abc'),
    )
  })
  it('subrota inventada continua caindo na casa da seção', () => {
    expect(destinoDaSecao('conteudo', '/admin/conteudo/radarx')).toBe('/admin/conteudo')
    expect(destinoDaSecao('conteudo', '/admin/conteudo/radar/fundo')).toBe('/admin/conteudo')
  })
})
