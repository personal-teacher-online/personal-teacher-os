// A CONFERÊNCIA por máquina — o que substituiu o "gera 6 e um humano escolhe"
// (decisão do dono, 25/07 à noite).
//
// O que estes testes protegem, e por que cada um custou dinheiro:
//  • o veredito é calculado no código a partir dos ACHADOS, nunca declarado
//    pelo modelo — resposta ambígua não pode virar foto aprovada;
//  • a régua muda com o tipo do slide (facecam só em capa, faixa só em card);
//  • as duas exceções ratificadas pelo dono (palavra curta genérica PASSA;
//    borrão de fundo não é garrancho) continuam escritas no prompt;
//  • saldo esgotado ABORTA, e não fica em ciclo de retentativa calado;
//  • a rodada gera 1, confere, e só regera o que reprovou — e não regera nada
//    que já esteja na biblioteca.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Alvo, Conferente } from '../scripts/images/comum.ts'
import type { Defeito } from '../scripts/images/conferencia.ts'
import type { ImageProvider } from '../src/lib/images/provider.ts'
import { carregarSePresente, presente } from './_privado'

// `comum.ts` puxa `resolve.ts`, que resolve a pasta de marca na carga: sem o insumo privado, os casos pulam (tests/_privado.ts).
const { FAIXA_DO_CARD_PCT, ZONA_FACECAM_PCT, classifica, rodada } = await carregarSePresente(
  () => import('../scripts/images/comum.ts'),
)
const { interpretaVeredito, promptDaConferencia, reguaDe, resumo } = await carregarSePresente(
  () => import('../scripts/images/conferencia.ts'),
)

const TODOS: Defeito[] = ['marca', 'anatomia', 'emenda', 'facecam', 'faixa']

describe.skipIf(!presente)('interpretaVeredito — o veredito é do código, não do modelo', () => {
  it('lista vazia é aprovação', () => {
    const v = interpretaVeredito('{"achados":[]}', TODOS)
    expect(v).toEqual({ aprovada: true, achados: [], modelo: expect.any(String) })
  })

  it('qualquer achado reprova, e o "onde" sobrevive para o log', () => {
    const v = interpretaVeredito('{"achados":[{"defeito":"marca","onde":"visto: UNITED STATES OF AMERICA"}]}', TODOS)
    if (!('aprovada' in v)) throw new Error(`esperava veredito, veio ${v.erro}`)
    expect(v.aprovada).toBe(false)
    expect(resumo(v)).toContain('UNITED STATES OF AMERICA')
  })

  it('aceita a cerca de markdown que o modelo insiste em pôr', () => {
    const v = interpretaVeredito('```json\n{"achados":[]}\n```', TODOS)
    expect('aprovada' in v && v.aprovada).toBe(true)
  })

  it('resposta que não é JSON vira ERRO, nunca aprovação', () => {
    const v = interpretaVeredito('a foto está ótima!', TODOS)
    expect('erro' in v).toBe(true)
  })

  it('JSON sem a lista "achados" vira ERRO', () => {
    const v = interpretaVeredito('{"aprovada":true}', TODOS)
    expect('erro' in v).toBe(true)
  })

  it('defeito fora da régua desta foto vira ERRO — não é ignorado em silêncio', () => {
    const { aceitos } = reguaDe({ tipo: 'quadro' })
    const v = interpretaVeredito('{"achados":[{"defeito":"facecam","onde":"canto"}]}', aceitos)
    expect('erro' in v && v.erro).toContain('fora da régua')
  })
})

describe.skipIf(!presente)('a régua muda com o tipo do slide', () => {
  it('quadro cobra só marca, anatomia e emenda', () => {
    const { texto, aceitos } = reguaDe({ tipo: 'quadro' })
    expect(aceitos).toEqual(['marca', 'anatomia', 'emenda'])
    expect(texto).not.toContain('facecam')
    expect(texto).not.toContain('faixa')
  })

  it('capa cobra a zona da facecam, com a medida que sai do FACECAM_V2', () => {
    const { texto, aceitos } = reguaDe({ tipo: 'capa', zonaPct: ZONA_FACECAM_PCT })
    expect(aceitos).toContain('facecam')
    expect(texto).toContain(`rightmost ${ZONA_FACECAM_PCT.largura}%`)
    expect(texto).toContain(`top ${ZONA_FACECAM_PCT.altura}%`)
  })

  it('card cobra a fatia do meio, com a medida do card do template-v2', () => {
    const { texto, aceitos } = reguaDe({ tipo: 'card', faixaPct: FAIXA_DO_CARD_PCT })
    expect(aceitos).toContain('faixa')
    expect(texto).toContain(`${FAIXA_DO_CARD_PCT}% of the height`)
    // a fatia medida no card (1.975 × 0.592) sobre uma foto 3:2
    expect(FAIXA_DO_CARD_PCT).toBe(45)
  })
})

describe.skipIf(!presente)('as duas exceções ratificadas pelo dono continuam no prompt', () => {
  // Montado dentro de cada caso: o corpo do describe roda na coleta mesmo quando pulado.
  const prompt = () => promptDaConferencia({ tipo: 'quadro' })

  it('palavra curta, correta e genérica PASSA — é o conteúdo da aula', () => {
    expect(prompt()).toContain('NOTHING TO DECLARE')
    expect(prompt()).toContain('NOT a defect, and actively wanted')
  })

  it('borrão de fundo não é garrancho', () => {
    expect(prompt()).toContain('Blurred, distant or tiny background signage')
  })

  it('gosto não entra: foto banal mas correta passa', () => {
    expect(prompt()).toContain('Taste is not your business')
  })

  it('a resposta normal de uma foto boa é lista vazia', () => {
    expect(prompt()).toContain('EMPTY list')
  })
})

describe.skipIf(!presente)('classifica — saldo esgotado não é limite de taxa', () => {
  it('a mensagem literal do 429 de saldo aborta', () => {
    expect(
      classifica(
        'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage ' +
          'your project and billing.',
      ),
    ).toBe('sem-credito')
  })

  it('pico de verdade continua sendo pico', () => {
    expect(classifica('The model is overloaded. Please try again later.')).toBe('pico')
    expect(classifica('HTTP 503')).toBe('pico')
    expect(classifica('This operation was aborted due to timeout')).toBe('pico')
    expect(classifica('429 rate limit exceeded')).toBe('pico')
  })

  // O 500 do Gemini queimou 16 gerações num minuto sendo tratado como `defeito`:
  // a rodada desistia do endereço na primeira tentativa, sem recuo nenhum.
  it('o 500 do Gemini é pico, não defeito — as duas formas em que ele chega', () => {
    expect(classifica('Internal error encountered.')).toBe('pico')
    expect(classifica('HTTP 500')).toBe('pico')
  })

  it('recusa de conteúdo não se retenta', () => {
    expect(classifica('o provedor não devolveu imagem (PROHIBITED_CONTENT)')).toBe('defeito')
  })

  it('sem erro é ok', () => {
    expect(classifica(null)).toBe('ok')
  })
})

// ------------------------------------------------------------------ a rodada

/** um JPEG mínimo de verdade: os bytes não importam, o mimeType sim */
const JPEG = { data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' }

function provedorFake(): { provider: ImageProvider; chamadas: () => number } {
  let chamadas = 0
  return {
    chamadas: () => chamadas,
    provider: {
      name: 'fake',
      async start() {
        chamadas++
        return { ready: [JPEG] }
      },
      async check() {
        return { status: 'falhou', error: 'síncrono' }
      },
    },
  }
}

const aprova: Conferente = async () => ({ aprovada: true, achados: [], modelo: 'fake' })
const reprova = (vezes: number): Conferente => {
  let n = 0
  return async () =>
    n++ < vezes
      ? { aprovada: false, achados: [{ defeito: 'marca' as const, onde: 'mochila: patagonia' }], modelo: 'fake' }
      : { aprovada: true, achados: [], modelo: 'fake' }
}

function bancada(): { raiz: string; destino: string } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'conferencia-'))
  fs.mkdirSync(path.join(raiz, 'brand', 'slides', 'library'), { recursive: true })
  return { raiz, destino: path.join(raiz, 'out') }
}

const alvo = (endereco: string): Alvo => ({
  endereco,
  rotulo: 'teste',
  prompt: 'um prompt',
  framing: 'paisagem',
  regra: { tipo: 'quadro' },
})

describe.skipIf(!presente)('a rodada — gera 1, confere, e só regera o que reprovou', () => {
  it('candidata aprovada de primeira custa UMA geração e vai para a biblioteca', async () => {
    const { raiz, destino } = bancada()
    const { provider, chamadas } = provedorFake()
    const r = await rodada({ provider, destino, raiz, alvos: [alvo('m9/teste.jpg')], conferente: aprova })

    expect(chamadas()).toBe(1)
    expect(r.geracoes).toBe(1)
    expect(r.conferencias).toBe(1)
    expect(r.entregues).toEqual(['m9/teste.jpg'])
    expect(r.falhas).toEqual([])
    expect(fs.existsSync(path.join(raiz, 'brand/slides/library/m9/teste.jpg'))).toBe(true)
  })

  it('duas reprovações custam três gerações — e as reprovadas ficam gravadas com o veredito', async () => {
    const { raiz, destino } = bancada()
    const { provider } = provedorFake()
    const r = await rodada({ provider, destino, raiz, alvos: [alvo('m9/teste.jpg')], conferente: reprova(2) })

    expect(r.geracoes).toBe(3)
    expect(r.entregues).toEqual(['m9/teste.jpg'])
    const dir = path.join(destino, 'm9-teste')
    expect(fs.readdirSync(dir).sort()).toEqual([
      '1.jpg',
      '1.veredito.json',
      '2.jpg',
      '2.veredito.json',
      '3.jpg',
      '3.veredito.json',
      'prompt.txt',
    ])
    const primeiro = JSON.parse(fs.readFileSync(path.join(dir, '1.veredito.json'), 'utf8'))
    expect(primeiro.aprovada).toBe(false)
    expect(primeiro.achados[0].onde).toContain('patagonia')
  })

  it('estourado o teto de 4, o endereço entra na lista de falhas e NADA é entregue', async () => {
    const { raiz, destino } = bancada()
    const { provider } = provedorFake()
    const r = await rodada({ provider, destino, raiz, alvos: [alvo('m9/teste.jpg')], conferente: reprova(99) })

    expect(r.geracoes).toBe(4)
    expect(r.entregues).toEqual([])
    expect(r.falhas).toEqual([{ endereco: 'm9/teste.jpg', motivo: expect.stringContaining('4 tentativas') }])
    expect(fs.existsSync(path.join(raiz, 'brand/slides/library/m9/teste.jpg'))).toBe(false)
  })

  it('conferência sem resposta NÃO aprova no escuro e NÃO regera', async () => {
    const { raiz, destino } = bancada()
    const { provider } = provedorFake()
    const r = await rodada({
      provider,
      destino,
      raiz,
      alvos: [alvo('m9/teste.jpg')],
      conferente: async () => ({ erro: 'o modelo devolveu SAFETY' }),
    })

    expect(r.geracoes).toBe(1)
    expect(r.entregues).toEqual([])
    expect(r.falhas[0]?.motivo).toContain('conferência sem resposta')
  })
})

describe.skipIf(!presente)('as duas deduplicações de endereço', () => {
  it('endereço que já está na biblioteca não é regerado — nem entre módulos', async () => {
    const { raiz, destino } = bancada()
    const { provider, chamadas } = provedorFake()
    // o `vocab/pillow.jpg` do M3 é o `vocab/pillow.jpg` do M4
    fs.mkdirSync(path.join(raiz, 'brand/slides/library/vocab'), { recursive: true })
    fs.writeFileSync(path.join(raiz, 'brand/slides/library/vocab/pillow.jpg'), Buffer.from(JPEG.data))

    const r = await rodada({
      provider,
      destino,
      raiz,
      alvos: [alvo('vocab/pillow.jpg'), alvo('vocab/blanket.jpg')],
      conferente: aprova,
    })

    expect(chamadas()).toBe(1)
    expect(r.entregues).toEqual(['vocab/blanket.jpg'])
    expect(r.pulados).toEqual(['vocab/pillow.jpg (já está na biblioteca)'])
  })

  it('endereço repetido no mesmo lote gera UMA vez só', async () => {
    const { raiz, destino } = bancada()
    const { provider, chamadas } = provedorFake()
    const r = await rodada({
      provider,
      destino,
      raiz,
      alvos: [alvo('m4/key-card.jpg'), alvo('m4/key-card.jpg')],
      conferente: aprova,
    })

    expect(chamadas()).toBe(1)
    expect(r.pulados).toEqual(['m4/key-card.jpg (repetido neste lote)'])
  })

  it('--refazer derruba a guarda e sobrescreve o que está na biblioteca', async () => {
    const { raiz, destino } = bancada()
    const { provider, chamadas } = provedorFake()
    const arquivo = path.join(raiz, 'brand/slides/library/m9/teste.jpg')
    fs.mkdirSync(path.dirname(arquivo), { recursive: true })
    fs.writeFileSync(arquivo, 'a foto antiga')

    const r = await rodada({
      provider,
      destino,
      raiz,
      refazer: true,
      alvos: [alvo('m9/teste.jpg')],
      conferente: aprova,
    })

    expect(chamadas()).toBe(1)
    expect(r.entregues).toEqual(['m9/teste.jpg'])
    expect(fs.readFileSync(arquivo)).toEqual(Buffer.from(JPEG.data))
  })
})

describe.skipIf(!presente)('saldo esgotado aborta a rodada', () => {
  it(
    'confirma uma vez, para de gerar e devolve a mensagem do provedor',
    { timeout: 20_000 },
    async () => {
      const { raiz, destino } = bancada()
      const semSaldo =
        'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage ' +
        'your project and billing.'
      let chamadas = 0
      const provider: ImageProvider = {
        name: 'fake',
        async start() {
          chamadas++
          return { error: semSaldo }
        },
        async check() {
          return { status: 'falhou', error: 'síncrono' }
        },
      }

      const r = await rodada({ provider, destino, raiz, alvos: [alvo('m9/a.jpg')], conferente: aprova })

      expect(r.semCredito).toBe(semSaldo)
      expect(r.entregues).toEqual([])
      expect(r.falhas).toHaveLength(1)
      // DUAS chamadas: a original e a segunda opinião. O desenho antigo tratava
      // esta mensagem como pico e gastava as 4 tentativas com recuo de 4s, 12s e
      // 36s — calada. É o ciclo que custou tempo de diagnóstico ao dono.
      expect(chamadas).toBe(2)
    },
  )
})
