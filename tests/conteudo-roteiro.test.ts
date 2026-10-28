// Parser TOLERANTE de exibição do roteiro de reel (M3) — testes PUROS, sem banco
// e sem tela (molde conteudo-compose.test.ts).
//
// A quem este parser serve: ao TEXTO EDITADO PELA DONA. A entrega da máquina já
// chega validada (JSON estrito + serializador do M2), então o que se prova aqui
// é a tolerância a edição humana — e, principalmente, que NADA SOME e que nada
// muda de dono (uma linha órfã nunca vira fala de alguém que não a disse).
//
// O contrato completo está no recorte do M3; a tabela de aceitação está espelhada
// no describe 'contrato'.
import { describe, expect, it } from 'vitest'
import {
  parseRoteiroExibicao,
  roteiroSchema,
  serializeRoteiro,
  validarTextoRoteiro,
} from '@/lib/content/roteiro'

function roteiroValido() {
  return roteiroSchema.parse({
    gancho: { principal: 'Você cantou isso sem saber', variantes: ['v1', 'v2', 'v3'] },
    cenas: [
      { fala: 'primeira fala', texto_na_tela: 'cartela 1', acao: 'corte seco' },
      { fala: 'segunda fala', texto_na_tela: 'cartela 2', acao: 'zoom' },
    ],
    cta: { fala: 'salva esse reel', texto_na_tela: 'Salvar' },
    legenda: 'legenda do post',
    hashtags: ['#ingles', '#viagem', '#reels'],
    duracao_alvo_s: 45,
    trilha: 'música do trend ⚠️ usar pela biblioteca do app',
    nota_de_producao: 'clipe precisa ser licenciado',
  })
}

/** Estreita o resultado para o caso ok, com mensagem útil quando falha. */
function ok(texto: string) {
  const r = parseRoteiroExibicao(texto)
  if (!r.ok) throw new Error(`esperava ok, veio ${r.motivo}`)
  return r
}

describe('round-trip: o que o M2 serializa, o M3 lê de volta', () => {
  it('devolve todos os blocos, na ordem, sem aviso nenhum', () => {
    const r = ok(serializeRoteiro(roteiroValido()))

    expect(r.valor.gancho).toBe('Você cantou isso sem saber')
    expect(r.valor.variantes).toEqual(['v1', 'v2', 'v3'])
    expect(r.valor.cenas).toHaveLength(2)
    expect(r.valor.cenas[0]).toMatchObject({
      numero: '1',
      fala: 'primeira fala',
      textoNaTela: 'cartela 1',
      acao: 'corte seco',
    })
    expect(r.valor.cta).toMatchObject({ fala: 'salva esse reel', textoNaTela: 'Salvar' })
    expect(r.valor.legenda).toBe('legenda do post')
    expect(r.valor.hashtags).toEqual(['#ingles', '#viagem', '#reels'])
    expect(r.valor.duracaoAlvoS).toBe(45)
    expect(r.valor.trilha).toContain('⚠️')
    expect(r.valor.notaDeProducao).toContain('licenciado')
    expect(r.avisos).toEqual([])
  })
})

describe('contrato: a fronteira entre a visão e o texto cru', () => {
  it('CENA é o único bloco obrigatório — só ela já rende visão', () => {
    const r = ok('CENA 1\nFala: só isso aqui')
    expect(r.valor.cenas).toHaveLength(1)
    expect(r.valor.gancho).toBeUndefined()
    expect(r.valor.cta).toBeUndefined()
  })

  it('gancho sem nenhuma cena → sem_cena (não dá visão de gravação)', () => {
    const r = parseRoteiroExibicao('GANCHO: um gancho solto\nVARIANTES DE GANCHO:\n1. outra')
    expect(r).toEqual({ ok: false, motivo: 'sem_cena' })
  })

  it('texto vazio → vazio', () => {
    expect(parseRoteiroExibicao('   \n\n  ')).toEqual({ ok: false, motivo: 'vazio' })
  })

  it('texto livre sem marcador → sem_cena (cai no texto cru)', () => {
    const r = parseRoteiroExibicao('a dona reescreveu tudo à mão em prosa corrida')
    expect(r).toEqual({ ok: false, motivo: 'sem_cena' })
  })

  it('cena sem nenhum campo rotulado não conta como cena', () => {
    expect(parseRoteiroExibicao('CENA 1\nCENA 2')).toEqual({ ok: false, motivo: 'sem_cena' })
  })

  it('blocos opcionais ausentes: os campos somem, sem erro', () => {
    const r = ok('CENA 1\nFala: a\nAção: b')
    expect(r.valor.legenda).toBeUndefined()
    expect(r.valor.hashtags).toBeUndefined()
    expect(r.valor.trilha).toBeUndefined()
    expect(r.valor.cenas[0].textoNaTela).toBeUndefined()
  })

  it('travessão em trilha/nota é vazio, não o caractere', () => {
    const r = ok('CENA 1\nFala: a\nTRILHA: —\nNOTA DE PRODUÇÃO: —')
    expect(r.valor.trilha).toBeUndefined()
    expect(r.valor.notaDeProducao).toBeUndefined()
  })
})

describe('tolerância: a dona editou à mão', () => {
  it('cena apagada e variante removida continuam rendendo visão', () => {
    const texto = serializeRoteiro(roteiroValido())
      .replace(/CENA 2\nFala: segunda fala\nTexto na tela: cartela 2\nAção: zoom\n\n/, '')
      .replace('3. v3\n', '')
    const r = ok(texto)
    expect(r.valor.cenas).toHaveLength(1)
    expect(r.valor.variantes).toEqual(['v1', 'v2'])
  })

  it('LINHA ÓRFÃ CONTINUA O ÚLTIMO CAMPO ABERTO — nunca vira fala de outro', () => {
    const r = ok(['CENA 1', 'Fala: ele diz oi', 'Ação: câmera afasta', 'e some no corte'].join('\n'))
    expect(r.valor.cenas[0].acao).toBe('câmera afasta e some no corte')
    expect(r.valor.cenas[0].fala).toBe('ele diz oi')
  })

  it('linha órfã SEM campo aberto vira extra da cena + aviso — não some', () => {
    const r = ok(['CENA 1', 'anotação solta da dona', 'Fala: a fala'].join('\n'))
    expect(r.valor.cenas[0].extras).toEqual(['anotação solta da dona'])
    expect(r.valor.cenas[0].fala).toBe('a fala')
    expect(r.avisos.length).toBeGreaterThan(0)
  })

  it('texto antes do primeiro marcador vira extra do topo + aviso', () => {
    const r = ok(['rascunho: pensar no gancho depois', 'CENA 1', 'Fala: a'].join('\n'))
    expect(r.valor.extrasDoTopo).toEqual(['rascunho: pensar no gancho depois'])
    expect(r.avisos.length).toBeGreaterThan(0)
  })

  it('QUASE-MARCADOR não vira bloco fantasma (o caso que corrompia sentido)', () => {
    // 'CTA:' com dois-pontos e 'cena 2' minúscula NÃO são marcadores.
    const r = ok(['CENA 1', 'Fala: a fala', 'CTA:', 'cena 2', 'Ação: b'].join('\n'))
    expect(r.valor.cenas).toHaveLength(1) // 'cena 2' não abriu cena nova
    expect(r.valor.cta).toBeUndefined() // 'CTA:' não abriu CTA
    expect(r.valor.cenas[0].fala).toBe('a fala CTA: cena 2') // continuou a fala aberta
    expect(r.valor.cenas[0].acao).toBe('b')
  })

  it('bloco duplicado: o primeiro vale, o segundo vira aviso', () => {
    const r = ok(['GANCHO: o bom', 'CENA 1', 'Fala: a', 'GANCHO: o velho colado'].join('\n'))
    expect(r.valor.gancho).toBe('o bom')
    expect(r.avisos.some((a) => a.includes('GANCHO'))).toBe(true)
  })

  it('CRLF e espaços à borda não quebram nada', () => {
    const r = ok('  CENA 1  \r\n  Fala: com espaço  \r\nTexto na tela: x\r\n')
    expect(r.valor.cenas[0].fala).toBe('com espaço')
    expect(r.valor.cenas[0].textoNaTela).toBe('x')
  })

  it('hashtags separadas por vírgula ou sem # são normalizadas', () => {
    const r = ok('CENA 1\nFala: a\nHASHTAGS: ingles, #viagem  reels')
    expect(r.valor.hashtags).toEqual(['#ingles', '#viagem', '#reels'])
  })

  it('legenda multi-linha preserva as quebras', () => {
    const r = ok(['CENA 1', 'Fala: a', 'LEGENDA', 'primeira linha', 'segunda linha', '', 'HASHTAGS: #x #y #z'].join('\n'))
    expect(r.valor.legenda).toBe('primeira linha\nsegunda linha')
  })

  it('duração ilegível não derruba o roteiro — só o campo some', () => {
    const r = ok('CENA 1\nFala: a\nDURAÇÃO-ALVO: uns 40 segundos aí')
    expect(r.valor.duracaoAlvoS).toBeUndefined()
    expect(r.valor.cenas).toHaveLength(1)
  })

  it('parse é ESTÁVEL: reparsear a mesma entrada dá o mesmo resultado', () => {
    const texto = ['CENA 1', 'Fala: a', 'órfã', 'Ação: b'].join('\n')
    expect(parseRoteiroExibicao(texto)).toEqual(parseRoteiroExibicao(texto))
  })
})

describe('o validador ESTRITO do M2 segue intocado', () => {
  it('continua exigindo todos os blocos da entrega da máquina', () => {
    expect(validarTextoRoteiro(serializeRoteiro(roteiroValido()))).toEqual({ ok: true })
    const res = validarTextoRoteiro('CENA 1\nFala: a')
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('inalcançável')
    expect(res.detalhe).toContain('GANCHO:')
  })
})
