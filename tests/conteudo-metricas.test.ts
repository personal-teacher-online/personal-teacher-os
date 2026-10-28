// MÉTRICAS DA PAUTA (M6) — o proxy lexical de reescrita e o resumo da coorte.
//
// Teste PURO (sem banco): o módulo não fala com o Postgres, e o que precisa
// ficar provado é a ARITMÉTICA que o dono vai olhar no gate — inclusive o que a
// medida NÃO enxerga (reordenação sem troca de palavra), documentado aqui de
// propósito para ninguém confundir o proxy com nota de qualidade.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  inicioDaRodada,
  normalizarParaDiff,
  percentualDeReescrita,
  REGRA_POR_RODADA,
  resumoPorRodadas,
  type PostDaCoorte,
  type TrendDaRodada,
} from '@/lib/content/metricas'

import { MetricasPainel } from '@/app/admin/conteudo/posts/metricas-painel'

describe('inicioDaRodada (Leva 0.3): a fronteira da semana ISO em UTC', () => {
  it('domingo ainda é a rodada da semana ANTERIOR (02/08/2026 23:59 UTC → seg 27/07)', () => {
    expect(inicioDaRodada(new Date('2026-08-02T23:59:59Z'))).toBe('2026-07-27T00:00:00.000Z')
  })

  it('segunda 00:00 UTC abre rodada nova (03/08/2026 → seg 03/08)', () => {
    expect(inicioDaRodada(new Date('2026-08-03T00:00:00Z'))).toBe('2026-08-03T00:00:00.000Z')
  })

  it('meio da semana aponta para a segunda da MESMA semana', () => {
    expect(inicioDaRodada(new Date('2026-08-06T15:30:00Z'))).toBe('2026-08-03T00:00:00.000Z')
  })

  it('a fronteira é UTC, não fuso do negócio: domingo 21h de Cuiabá (seg 01h UTC) já é rodada nova', () => {
    // 2026-08-09 é domingo em Cuiabá às 21h = 2026-08-10T01:00Z (segunda em UTC)
    expect(inicioDaRodada(new Date('2026-08-10T01:00:00Z'))).toBe('2026-08-10T00:00:00.000Z')
  })
})

function roteiro(cenas: string[], gancho = 'Você fala isso e o americano trava'): string {
  return [
    `GANCHO: ${gancho}`,
    'VARIANTES DE GANCHO:',
    '1. Ninguém te contou isso sobre make e do',
    '2. Pare de dizer isso em inglês',
    '3. Esse erro entrega que você é brasileiro',
    '',
    ...cenas.flatMap((fala, i) => [
      `CENA ${i + 1}`,
      `Fala: ${fala}`,
      `Texto na tela: ${fala.slice(0, 20)}`,
      'Ação: corte seco para a câmera',
      '',
    ]),
    'CTA',
    'Fala: Salva esse aqui para não esquecer',
    'Texto na tela: SALVA AÍ',
    '',
    'LEGENDA',
    'A diferença entre make e do em trinta segundos.',
    '',
    'HASHTAGS: #ingles #dicasdeingles #teachervicky',
    'DURAÇÃO-ALVO: 40s',
    'TRILHA: —',
    'NOTA DE PRODUÇÃO: —',
  ].join('\n')
}

const CENAS = [
  'Todo mundo diz make a mistake e acha que é do a mistake',
  'A regra é simples: make cria coisa nova, do executa tarefa',
  'Repete comigo: I made a mistake at work today',
]

/** Outro roteiro INTEIRO — nenhum bloco reaproveitado. Existe porque o primeiro
 *  fixture de "reescrita total" trocava só gancho e cenas: CTA, legenda e
 *  hashtags seguiam idênticos e a medida (corretamente) marcava 43%. */
function outroRoteiro(): string {
  return [
    'GANCHO: Três phrasal verbs para sobreviver no aeroporto',
    'VARIANTES DE GANCHO:',
    '1. Seu voo atrasou e agora',
    '2. O que dizer quando perdem sua bagagem',
    '3. Aeroporto internacional sem gaguejar',
    '',
    'CENA 1',
    'Fala: Check in é apresentar documento no balcão da companhia',
    'Texto na tela: CHECK IN',
    'Ação: plano fechado no rosto, luz de janela',
    '',
    'CENA 2',
    'Fala: Take off é decolar, não tirar roupa como muita gente pensa',
    'Texto na tela: TAKE OFF',
    'Ação: zoom rápido, cartela pisca',
    '',
    'CENA 3',
    'Fala: Pick up é retirar mala na esteira depois do desembarque',
    'Texto na tela: PICK UP',
    'Ação: caminhada pelo corredor, câmera na mão',
    '',
    'CTA',
    'Fala: Comenta qual deles você já usou errado',
    'Texto na tela: CONTA AQUI',
    '',
    'LEGENDA',
    'Aeroporto internacional pede vocabulário próprio.',
    '',
    'HASHTAGS: #viagem #aeroporto #vocabulario',
    'DURAÇÃO-ALVO: 35s',
    'TRILHA: —',
    'NOTA DE PRODUÇÃO: —',
  ].join('\n')
}

describe('normalizarParaDiff', () => {
  it('tira marcador, rótulo, numeração, caixa e pontuação — sobra o que a autora escreveu', () => {
    const palavras = normalizarParaDiff('CENA 1\nFala: Olha só, ISSO aqui!\nCTA\n')
    expect(palavras).toEqual(['olha', 'só', 'isso', 'aqui'])
  })

  it('linha que é só estrutura não vira palavra nenhuma', () => {
    expect(normalizarParaDiff('CENA 1\nCTA\nLEGENDA\nVARIANTES DE GANCHO:')).toEqual([])
  })
})

describe('percentualDeReescrita', () => {
  it('texto idêntico → 0', () => {
    expect(percentualDeReescrita(roteiro(CENAS), roteiro(CENAS))).toBe(0)
  })

  it('mesmo conteúdo com espaçamento e caixa diferentes → 0 (é forma, não edição)', () => {
    const a = 'GANCHO: Você trava no aeroporto\nCENA 1\nFala: Diz layover, não connection.'
    const b = 'GANCHO:   você TRAVA no aeroporto\n\nCENA 1\nFala: diz layover  não connection'
    expect(percentualDeReescrita(a, b)).toBe(0)
  })

  it('edição leve (uma frase trocada em três cenas) fica bem abaixo do corte de 50%', () => {
    const editado = roteiro([CENAS[0], CENAS[1], 'Repete comigo: I made a huge mistake at work'])
    const pct = percentualDeReescrita(roteiro(CENAS), editado)
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThan(REGRA_POR_RODADA.reescritaPesadaAcimaDe)
    expect(pct).toBeLessThan(15)
  })

  it('reescrita total → perto de 100', () => {
    expect(percentualDeReescrita(roteiro(CENAS), outroRoteiro())).toBeGreaterThan(85)
  })

  it('trocar SÓ as cenas, com o resto intacto, marca médio — e isso é honesto', () => {
    // O roteiro tem rodapé, CTA e legenda que costumam sobreviver à edição. Uma
    // troca das três cenas mexe em ~metade das palavras, e é isso que a medida
    // diz. Fixture que ignorasse esse fato inflaria a régua do gate.
    const soCenas = roteiro(
      ['Check in é no balcão', 'Take off é decolar', 'Pick up é retirar mala'],
      'Três phrasal verbs para sobreviver no aeroporto',
    )
    const pct = percentualDeReescrita(roteiro(CENAS), soCenas)
    expect(pct).toBeGreaterThan(REGRA_POR_RODADA.reescritaPesadaAcimaDe - 20)
    expect(pct).toBeLessThan(85)
  })

  it('só REORDENAR cenas já marca alto — o proxy é lexical, não semântico', () => {
    // Documentado de propósito: nenhuma palavra mudou, mas a subsequência comum
    // encolhe. Quem lê o painel precisa saber que "% do texto trocado" não é
    // "% de qualidade perdida" — por isso o rótulo do painel diz proxy lexical.
    const invertido = roteiro([CENAS[2], CENAS[1], CENAS[0]])
    const pct = percentualDeReescrita(roteiro(CENAS), invertido)
    expect(pct).toBeGreaterThan(10)
    expect(pct).toBeLessThan(60)
  })

  it('vazios: dois vazios → 0; original apagado → 100', () => {
    expect(percentualDeReescrita('', '')).toBe(0)
    expect(percentualDeReescrita(roteiro(CENAS), '')).toBe(100)
    expect(percentualDeReescrita('', roteiro(CENAS))).toBe(100)
  })
})

/* ========================================================================== */
/* Resumo da coorte                                                            */
/* ========================================================================== */

// A rodada de um roteiro é a semana da TREND que o gerou (Leva 6.1) — nunca a
// data em que ele foi gerado. Rótulos explícitos: nada de data girando.
const W31 = '2026-W31'
const W32 = '2026-W32'
const W33 = '2026-W33'

let n = 0
function post(p: Partial<PostDaCoorte> = {}): PostDaCoorte {
  n += 1
  return {
    status: 'ideia',
    idea_approved_at: null,
    approved_at: null,
    roteiro: null,
    generation_meta: null,
    created_at: `2026-08-0${(n % 9) + 1}T12:00:00Z`,
    trend: { semana: W32 },
    ...p,
  }
}

/** Uma trend da varredura. Raiz por padrão — variação se diz explicitamente. */
function trend(semana: string, status = 'nova', variacao_de: string | null = null): TrendDaRodada {
  return { semana, status, variacao_de }
}

/** O jeito honesto de FECHAR uma rodada nos testes: a varredura seguinte
 *  existir. Sem isso a rodada mais nova nunca fecha — é a regra da Leva 6.1. */
const varreduraSeguinte = (semana: string): TrendDaRodada[] => [trend(semana)]

/** Post DECIDIDO no portão 2 (aprovado) com original guardado. */
function aprovadoEm(semana: string, editado: string): PostDaCoorte {
  return post({
    trend: { semana },
    status: 'aprovado',
    idea_approved_at: '2026-08-04T12:00:00Z',
    approved_at: '2026-08-04T12:00:00Z',
    roteiro: editado,
    generation_meta: { roteiro_original: roteiro(CENAS) },
  })
}

/** Post RECUSADO no portão 2 (gerou roteiro, terminou rejeitado). */
function recusadoEm(semana: string, motivo = 'não gostei do gancho'): PostDaCoorte {
  return post({
    trend: { semana },
    status: 'rejeitado',
    idea_approved_at: '2026-08-04T12:00:00Z',
    roteiro: roteiro(CENAS),
    rejection_reason: motivo,
    generation_meta: { roteiro_original: roteiro(CENAS) },
  })
}

describe('resumoPorRodadas — coorte e agrupamento (Leva 6.1)', () => {
  it('roteiro avulso (sem trend) fica FORA da coorte', () => {
    const r = resumoPorRodadas([post({ trend: null }), post({ trend: null }), post()])
    expect(r.total).toBe(1)
  })

  it('a rodada é a da TREND, não a semana em que o roteiro foi gerado', () => {
    const r = resumoPorRodadas([
      // gerado já na W33, mas veio da varredura da W32: conta na W32.
      post({ trend: { semana: W32 }, created_at: '2026-08-11T12:00:00Z' }),
      post({ trend: { semana: W31 } }),
    ])
    expect(r.rodadas.map((x) => x.rotulo)).toEqual([W32, W31])
    expect(r.rodadas[0].itens).toBe(1)
  })

  it('rodada que só tem trends (nenhum roteiro) aparece na tabela do mesmo jeito', () => {
    const r = resumoPorRodadas([], [trend(W31, 'descartada'), trend(W32)])
    expect(r.rodadas.map((x) => x.rotulo)).toEqual([W32, W31])
    expect(r.rodadas[1].trends).toBe(1)
    expect(r.rodadas[1].itens).toBe(0)
  })

  it('FECHADA exige varredura seguinte: a rodada mais nova nunca fecha sozinha', () => {
    const so31 = resumoPorRodadas([post({ trend: { semana: W31 }, status: 'aprovado' })])
    expect(so31.rodadas[0].fechada).toBe(false)
    expect(so31.rodadasFechadas).toBe(0)

    const com32 = resumoPorRodadas(
      [post({ trend: { semana: W31 }, status: 'aprovado' })],
      varreduraSeguinte(W32),
    )
    expect(com32.rodadas.find((x) => x.rotulo === W31)!.fechada).toBe(true)
    expect(com32.rodadasFechadas).toBe(1)
  })

  it('roteiro pendente segura a rodada ABERTA mesmo com varredura seguinte', () => {
    const r = resumoPorRodadas(
      [post({ trend: { semana: W31 }, status: 'rascunho' })],
      varreduraSeguinte(W32),
    )
    expect(r.rodadas.find((x) => x.rotulo === W31)!.fechada).toBe(false)
  })
})

describe('resumoPorRodadas — conversão radar→roteiro', () => {
  it('conversão = roteirizadas ÷ DECIDIDAS; trend pulada (nova) fica fora do denominador', () => {
    const r = resumoPorRodadas(
      [],
      [
        trend(W31, 'roteirizada'),
        trend(W31, 'roteirizada'),
        trend(W31, 'descartada'),
        trend(W31), // pulada, sem decisão
        trend(W32),
      ],
    )
    const w31 = r.rodadas.find((x) => x.rotulo === W31)!
    expect(w31.trends).toBe(4)
    expect(w31.decididas).toBe(3)
    expect(w31.roteirizadas).toBe(2)
    expect(w31.naoDecididas).toBe(1)
    expect(w31.taxaConversao).toBeCloseTo(66.7, 1)
  })

  it('variação pendurada não conta como trend — o deck decide por CARTÃO', () => {
    const r = resumoPorRodadas(
      [],
      [trend(W31, 'roteirizada'), trend(W31, 'descartada', 'id-da-mae'), trend(W32)],
    )
    expect(r.rodadas.find((x) => x.rotulo === W31)!.trends).toBe(1)
    expect(r.totalTrends).toBe(2)
  })

  it('nenhuma trend decidida → conversão null, nunca 0% de mentira', () => {
    const r = resumoPorRodadas([], [trend(W31), trend(W32)])
    expect(r.rodadas.find((x) => x.rotulo === W31)!.taxaConversao).toBeNull()
    expect(r.taxaConversao).toBeNull()
  })

  it('o agregado da conversão só olha rodadas FECHADAS', () => {
    const r = resumoPorRodadas(
      [post({ trend: { semana: W32 }, status: 'rascunho' })], // abre a W32
      [trend(W31, 'roteirizada'), trend(W31, 'descartada'), trend(W32, 'roteirizada'), trend(W33)],
    )
    expect(r.decididasNoRadar).toBe(2) // só a W31
    expect(r.roteirizadas).toBe(1)
    expect(r.taxaConversao).toBe(50)
  })
})

describe('resumoPorRodadas — o portão 2', () => {
  it('decidido no P2 EXIGE roteiro gerado: descartado sem roteiro não entra na taxa', () => {
    const r = resumoPorRodadas(
      [
        aprovadoEm(W31, roteiro(CENAS)),
        recusadoEm(W31),
        post({ trend: { semana: W31 }, status: 'descartado' }), // morreu ANTES do gerador
      ],
      varreduraSeguinte(W32),
    )
    const rodada = r.rodadas.find((x) => x.rotulo === W31)!
    expect(rodada.aprovadosP2).toBe(1)
    expect(rodada.recusadosP2).toBe(1)
    expect(rodada.fechada).toBe(true)
  })

  it('motivos registrados aparecem por rodada (insumo editorial)', () => {
    const r = resumoPorRodadas([recusadoEm(W31, 'gancho fraco'), recusadoEm(W31, 'fora do tema')])
    expect(r.rodadas[0].motivos.sort()).toEqual(['fora do tema', 'gancho fraco'])
  })

  it('reescrita pesada conta só sobre aprovados com original', () => {
    const r = resumoPorRodadas([aprovadoEm(W31, roteiro(CENAS)), aprovadoEm(W31, outroRoteiro())])
    const rodada = r.rodadas[0]
    expect(rodada.comOriginalAprovado).toBe(2)
    expect(rodada.reescritasPesadas).toBe(1)
  })
})

describe('resumoPorRodadas — os três estados do veredito', () => {
  it('1 rodada fechada só → AINDA SEM VEREDITO (números à mostra)', () => {
    const r = resumoPorRodadas(
      [aprovadoEm(W31, roteiro(CENAS)), recusadoEm(W31)],
      varreduraSeguinte(W32),
    )
    expect(r.rodadasFechadas).toBe(1)
    expect(r.taxaAprovacaoP2).toBe(50)
    expect(r.veredito).toBeNull()
  })

  it('2 fechadas mas P2 sem decisão → ainda sem veredito (taxa null, nunca 0% de mentira)', () => {
    const r = resumoPorRodadas(
      [
        post({ trend: { semana: W31 }, status: 'descartado' }),
        post({ trend: { semana: W32 }, status: 'descartado' }),
      ],
      varreduraSeguinte(W33),
    )
    expect(r.rodadasFechadas).toBe(2)
    expect(r.taxaAprovacaoP2).toBeNull()
    expect(r.veredito).toBeNull()
  })

  it('2 fechadas, os dois critérios passam → escala', () => {
    const r = resumoPorRodadas(
      [
        aprovadoEm(W31, roteiro(CENAS)),
        aprovadoEm(W31, roteiro(CENAS)),
        recusadoEm(W31),
        aprovadoEm(W32, roteiro(CENAS)),
      ],
      varreduraSeguinte(W33),
    )
    expect(r.rodadasFechadas).toBe(2)
    expect(r.taxaAprovacaoP2).toBe(75)
    expect(r.taxaReescritaPesada).toBe(0)
    expect(r.veredito).toBe('escala')
  })

  it('aprovação reprovada já congela — sem depender do denominador de reescrita', () => {
    const r = resumoPorRodadas(
      [
        recusadoEm(W31),
        recusadoEm(W31),
        aprovadoEm(W32, roteiro(CENAS)),
        recusadoEm(W32),
        recusadoEm(W32),
      ],
      varreduraSeguinte(W33),
    )
    expect(r.rodadasFechadas).toBe(2)
    expect(r.taxaAprovacaoP2).toBe(20)
    expect(r.veredito).toBe('congela')
  })

  it('reescrita acima do teto → congela, mesmo com aprovação ótima (E lógico)', () => {
    const r = resumoPorRodadas(
      [
        aprovadoEm(W31, outroRoteiro()),
        aprovadoEm(W31, outroRoteiro()),
        aprovadoEm(W32, roteiro(CENAS)),
      ],
      varreduraSeguinte(W33),
    )
    expect(r.taxaAprovacaoP2).toBe(100)
    expect(r.taxaReescritaPesada).toBeGreaterThan(REGRA_POR_RODADA.reescritaMaxima)
    expect(r.veredito).toBe('congela')
  })

  it('rodada ABERTA não entra no agregado da régua', () => {
    const r = resumoPorRodadas(
      [
        aprovadoEm(W31, roteiro(CENAS)),
        recusadoEm(W32),
        post({ trend: { semana: W32 }, status: 'ideia' }), // abre a W32
      ],
      varreduraSeguinte(W33),
    )
    expect(r.rodadasFechadas).toBe(1)
    expect(r.decididosP2).toBe(1) // só a W31 fechada
    expect(r.taxaAprovacaoP2).toBe(100)
  })

  it('a régua é PARÂMETRO: exigir 3 fechadas devolve o veredito para null', () => {
    const dados = [aprovadoEm(W31, roteiro(CENAS)), aprovadoEm(W32, roteiro(CENAS))]
    const trends = varreduraSeguinte(W33)
    expect(resumoPorRodadas(dados, trends).veredito).toBe('escala')
    expect(
      resumoPorRodadas(dados, trends, { ...REGRA_POR_RODADA, minimoRodadasFechadas: 3 }).veredito,
    ).toBeNull()
  })
})

/* ========================================================================== */
/* O painel renderizado (server-safe) — o que o screenshot não prova           */
/* ========================================================================== */

function painel(resumo: ReturnType<typeof resumoPorRodadas>): string {
  return renderToStaticMarkup(createElement(MetricasPainel, { resumo, regra: REGRA_POR_RODADA }))
}

describe('MetricasPainel — por rodada', () => {
  it('sem varredura nenhuma, explica o que vai acontecer — sem número inventado', () => {
    const out = painel(resumoPorRodadas([]))
    expect(out).toContain('Nenhuma varredura mediu nada ainda')
    expect(out).toContain('RODADA')
    expect(out).not.toContain('Aprovação no portão 2')
  })

  it('estado 1: AINDA SEM VEREDITO, com o que falta dito em palavras', () => {
    const out = painel(resumoPorRodadas([aprovadoEm(W31, roteiro(CENAS))], varreduraSeguinte(W32)))
    expect(out).toContain('Ainda sem veredito')
    expect(out).toContain('há 1 fechada')
    expect(out).not.toContain('A esteira está entregando')
    expect(out).not.toContain('Segura o volume')
  })

  it('estado 2: escala, com a frase certa', () => {
    const out = painel(
      resumoPorRodadas(
        [aprovadoEm(W31, roteiro(CENAS)), aprovadoEm(W32, roteiro(CENAS))],
        varreduraSeguinte(W33),
      ),
    )
    expect(out).toContain('A esteira está entregando')
  })

  it('estado 3: congela, com a frase certa', () => {
    const out = painel(
      resumoPorRodadas(
        [recusadoEm(W31), recusadoEm(W31), recusadoEm(W32), aprovadoEm(W32, roteiro(CENAS))],
        varreduraSeguinte(W33),
      ),
    )
    expect(out).toContain('Segura o volume')
  })

  it('a tabela mostra o rótulo da rodada e a situação aberta/fechada', () => {
    const out = painel(
      resumoPorRodadas(
        [aprovadoEm(W31, roteiro(CENAS)), post({ trend: { semana: W32 }, status: 'ideia' })],
        varreduraSeguinte(W33),
      ),
    )
    expect(out).toContain(W31)
    expect(out).toContain(W32)
    expect(out).toContain('fechada')
    expect(out).toContain('aberta')
  })

  it('rodada aberta SEM pendência diz que está esperando a próxima varredura', () => {
    const out = painel(resumoPorRodadas([aprovadoEm(W32, roteiro(CENAS))]))
    expect(out).toContain('aguardando a próxima varredura')
  })

  it('a conversão radar→roteiro aparece com NÚMERO e denominador em palavras', () => {
    const out = painel(
      resumoPorRodadas(
        [aprovadoEm(W31, roteiro(CENAS))],
        [trend(W31, 'roteirizada'), trend(W31, 'descartada'), trend(W32)],
      ),
    )
    expect(out).toContain('Radar→roteiro (rodadas fechadas)')
    expect(out).toContain('50%')
    expect(out).toContain('1 viraram roteiro de 2 decididas')
    expect(out).toContain('A conversão é INSUMO, não nota')
  })

  it('trend pulada aparece nomeada na tabela — não some, e não entra na conta', () => {
    const out = painel(resumoPorRodadas([], [trend(W31, 'roteirizada'), trend(W31), trend(W32)]))
    expect(out).toContain('1 sem decisão')
  })

  it('a régua combinada aparece em todos os estados e fala de RODADAS FECHADAS', () => {
    expect(painel(resumoPorRodadas([]))).toContain('A régua combinada antes dos números')
    const out = painel(resumoPorRodadas([post({ trend: { semana: W32 }, status: 'ideia' })]))
    expect(out).toContain('rodadas de varredura FECHADAS')
    expect(out).toContain('medida de PALAVRA')
  })
})
