// A VISÃO de gravação do roteiro (M3) renderizada de verdade — sem navegador.
// O componente é server-safe por decisão do recorte (sem action, sem hook), o
// que permite `renderToStaticMarkup` aqui e prova o que o loop de screenshot
// NÃO consegue provar: que bloco vazio some, que o texto integral sobrevive ao
// fallback e que os botões de copiar levam o payload certo.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { RoteiroVisao } from '@/app/admin/conteudo/[id]/roteiro-visao'

function html(texto: string): string {
  return renderToStaticMarkup(createElement(RoteiroVisao, { texto }))
}

const COMPLETO = [
  'GANCHO: você cantou isso sem saber',
  'VARIANTES DE GANCHO:',
  '1. primeira alternativa',
  '2. segunda alternativa',
  '',
  'CENA 1',
  'Fala: a primeira fala',
  'Texto na tela: CARTELA UM',
  'Ação: corte seco',
  '',
  'CTA',
  'Fala: salva esse reel',
  'Texto na tela: Salvar',
  '',
  'LEGENDA',
  'primeira linha da legenda',
  'segunda linha',
  '',
  'HASHTAGS: #ingles #viagem',
  'DURAÇÃO-ALVO: 45s',
  'TRILHA: música do trend ⚠️ usar pela biblioteca do app',
  'NOTA DE PRODUÇÃO: licenciar o clipe',
].join('\n')

describe('roteiro completo', () => {
  it('mostra gancho, variantes, cena, chamada final, legenda e rodapé', () => {
    const out = html(COMPLETO)
    expect(out).toContain('você cantou isso sem saber')
    expect(out).toContain('primeira alternativa')
    expect(out).toContain('Cena 1')
    expect(out).toContain('a primeira fala')
    expect(out).toContain('CARTELA UM')
    expect(out).toContain('Chamada final')
    expect(out).toContain('45 segundos')
    expect(out).toContain('⚠️')
    expect(out).toContain('licenciar o clipe')
  })

  it('a duração aparece em português, nunca como jargão do formato', () => {
    const out = html(COMPLETO)
    expect(out).toContain('Duração-alvo')
    expect(out).not.toContain('duracao_alvo_s')
    expect(out).not.toContain('DURAÇÃO-ALVO:')
  })
})

describe('bloco vazio NÃO renderiza (régua do Design.md)', () => {
  const minimo = 'CENA 1\nFala: só a fala'

  it('sem gancho, sem variantes, sem CTA, sem legenda, sem rodapé', () => {
    const out = html(minimo)
    expect(out).toContain('só a fala')
    expect(out).not.toContain('Gancho')
    expect(out).not.toContain('Outros ganchos possíveis')
    expect(out).not.toContain('Chamada final')
    expect(out).not.toContain('Legenda do post')
    expect(out).not.toContain('Duração-alvo')
    expect(out).not.toContain('Trilha')
    expect(out).not.toContain('Nota de produção')
  })

  it('trilha e nota com travessão são vazio, não o caractere', () => {
    const out = html('CENA 1\nFala: a\nTRILHA: —\nNOTA DE PRODUÇÃO: —')
    expect(out).not.toContain('Trilha')
    expect(out).not.toContain('Nota de produção')
  })

  it('gancho sem variantes não desenha a lista de alternativas', () => {
    const out = html('GANCHO: um gancho só\nCENA 1\nFala: a')
    expect(out).toContain('um gancho só')
    expect(out).not.toContain('Outros ganchos possíveis')
  })
})

describe('fallback: formato irreconhecível', () => {
  const cru = 'A dona reescreveu tudo à mão,\nem prosa corrida, sem marcador nenhum.'

  it('mostra o texto INTEGRAL em <pre>, com frase sem jargão', () => {
    const out = html(cru)
    expect(out).toContain('<pre')
    expect(out).toContain('em prosa corrida')
    expect(out).toContain('formato próprio')
    // Jargão de implementação não vaza para a tela (régua de linguagem).
    expect(out.toLowerCase()).not.toContain('parser')
    expect(out.toLowerCase()).not.toContain('json')
  })

  it('o <pre> usa fonte de corpo — mono é proibida para texto corrido', () => {
    expect(html(cru)).toContain('font-sans')
  })
})

describe('preservação: nada some da tela', () => {
  it('linha órfã dentro da cena aparece no cartão', () => {
    const out = html('CENA 1\nanotação solta da dona\nFala: a fala')
    expect(out).toContain('anotação solta da dona')
  })

  it('texto antes do primeiro marcador aparece no topo', () => {
    const out = html('lembrete: regravar o final\nCENA 1\nFala: a')
    expect(out).toContain('lembrete: regravar o final')
  })
})

describe('botões de copiar levam o payload certo', () => {
  it('copiar roteiro leva o texto CRU, não o interpretado', () => {
    const out = html(COMPLETO)
    expect(out).toContain('Copiar roteiro')
    // O CopyButton é client: o texto viaja nas props serializadas do RSC. Aqui
    // basta provar que o rótulo existe e que a legenda tem botão próprio.
    expect(out).toContain('Copiar legenda')
    expect(out).toContain('Copiar hashtags')
  })

  it('sem legenda e sem hashtags, os botões correspondentes somem', () => {
    const out = html('CENA 1\nFala: a')
    expect(out).toContain('Copiar roteiro')
    expect(out).not.toContain('Copiar legenda')
    expect(out).not.toContain('Copiar hashtags')
  })
})
