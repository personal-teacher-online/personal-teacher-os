// Leva 5 — busca de cidade → fuso IANA (itens 1–4 do e2e). Testa o matcher
// PURO contra a base REAL (GeoNames podada): os casos exatos que motivaram a
// leva ("Milão" que não existe na IANA; "Sao Pauloensop" do print do item 3).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { criarCarregadorDeCidades } from '@/lib/geo/dataset'
import { currentTimeIn, normalize, searchCities, type GeoCity } from '@/lib/geo/search'

// fs em vez de import: a base ficou em public/ (asset estático), fora do
// grafo do TS — inferir o tipo literal de 23k entradas estourava a RAM do VPS.
const CITIES = JSON.parse(readFileSync('public/geo/cities.json', 'utf8')) as GeoCity[]

describe('normalize', () => {
  it('derruba acento e caixa ("Milão" → "milao")', () => {
    expect(normalize('Milão')).toBe('milao')
    expect(normalize('  SÃO PAULO ')).toBe('sao paulo')
    expect(normalize('Zürich')).toBe('zurich')
  })
})

describe('searchCities — a base real responde pelas cidades dos alunos', () => {
  const top = (q: string) => searchCities(CITIES, q)[0]

  it('"milao" (apelido pt, sem acento) → Milão, Itália = Europe/Rome', () => {
    const hit = top('milao')
    expect(hit?.t).toBe('Europe/Rome')
    expect(hit?.c).toBe('Itália')
  })

  it('"sao paulo" → America/Sao_Paulo (maior população vence o empate)', () => {
    expect(top('sao paulo')?.t).toBe('America/Sao_Paulo')
  })

  it('"cuiaba" → America/Cuiaba, Mato Grosso', () => {
    const hit = top('cuiaba')
    expect(hit?.t).toBe('America/Cuiaba')
    expect(hit?.a).toBe('Mato Grosso')
  })

  it('"nova york" e "nova iorque" (apelidos) → America/New_York', () => {
    expect(top('nova york')?.t).toBe('America/New_York')
    expect(top('nova iorque')?.t).toBe('America/New_York')
  })

  it('"lisboa" → Europe/Lisbon; "orlando" → America/New_York', () => {
    expect(top('lisboa')?.t).toBe('Europe/Lisbon')
    expect(top('orlando')?.t).toBe('America/New_York')
  })

  it('lixo não acha nada; 1 caractere não busca', () => {
    expect(searchCities(CITIES, 'sao pauloensop')).toHaveLength(0)
    expect(searchCities(CITIES, 'x')).toHaveLength(0)
  })

  it('limite respeitado e todos os fusos devolvidos são IANA válidos', () => {
    const hits = searchCities(CITIES, 'san', 8)
    expect(hits.length).toBeLessThanOrEqual(8)
    for (const h of hits) {
      expect(currentTimeIn(h.t)).toMatch(/^\d{2}:\d{2}$/)
    }
  })
})

describe('currentTimeIn', () => {
  it('fuso válido formata HH:mm; inválido devolve null (nunca explode)', () => {
    expect(currentTimeIn('America/Cuiaba')).toMatch(/^\d{2}:\d{2}$/)
    expect(currentTimeIn('Fuso/Inexistente')).toBeNull()
  })
})

/* ========================================================================== */
/* Lote 6 · G3 — "a lista não fecha ao escolher"                               */
/* ========================================================================== */

// A metade TESTÁVEL sem DOM do defeito: o catálogo era baixado uma vez POR
// TECLA (o `if (!DATASET)` não cobria a janela em que a primeira requisição
// ainda estava no ar), e cada resposta terminava em `setOpen(true)`. Com 1,6 MB
// e respostas fora de ordem, a continuação de uma tecla anterior chegava DEPOIS
// do clique e reabria o dropdown que a escolha tinha acabado de fechar.
describe('carregador do catálogo (a corrida que reabria a lista)', () => {
  /** duble de fetch que conta chamadas e só resolve quando mandarmos */
  function duble(payload: unknown = [{ n: 'Cuiabá', a: 'Mato Grosso', c: 'Brasil', t: 'America/Cuiaba' }]) {
    const soltar: (() => void)[] = []
    let chamadas = 0
    const buscar = async () => {
      chamadas++
      await new Promise<void>((r) => soltar.push(r))
      return { ok: true, json: async () => payload }
    }
    return {
      buscar,
      chamadas: () => chamadas,
      soltarTodas: () => soltar.splice(0).forEach((r) => r()),
    }
  }

  it('N teclas simultâneas = UMA requisição, e todas recebem a mesma base', async () => {
    const d = duble()
    const carregar = criarCarregadorDeCidades(d.buscar)
    const seis = Promise.all([1, 2, 3, 4, 5, 6].map(() => carregar()))
    d.soltarTodas()
    const respostas = await seis
    expect(d.chamadas()).toBe(1)
    expect(respostas.every((r) => r === respostas[0])).toBe(true)
    expect(respostas[0][0].t).toBe('America/Cuiaba')
  })

  it('depois de carregado, ninguém baixa de novo', async () => {
    const d = duble()
    const carregar = criarCarregadorDeCidades(d.buscar)
    const p = carregar()
    d.soltarTodas()
    await p
    await carregar()
    await carregar()
    expect(d.chamadas()).toBe(1)
  })

  it('falha devolve lista vazia SEM envenenar o cache (a próxima tecla tenta de novo)', async () => {
    let tentativas = 0
    const carregar = criarCarregadorDeCidades(async () => {
      tentativas++
      if (tentativas === 1) throw new Error('rede caiu')
      return { ok: true, json: async () => [{ n: 'Lisboa', a: '', c: 'Portugal', t: 'Europe/Lisbon' }] }
    })
    expect(await carregar()).toEqual([])
    const segunda = await carregar()
    expect(segunda).toHaveLength(1)
    expect(tentativas).toBe(2)
    // e a resposta boa fica em cache
    await carregar()
    expect(tentativas).toBe(2)
  })

  it('resposta HTTP ruim (404 do asset) devolve vazio, nunca quebra a tela', async () => {
    const carregar = criarCarregadorDeCidades(async () => ({
      ok: false,
      json: async () => {
        throw new Error('não deveria ser lido')
      },
    }))
    expect(await carregar()).toEqual([])
  })
})

// A outra metade vive no componente e depende de DOM. O repo NÃO tem harness de
// DOM (vitest roda em `environment: 'node'`, sem jsdom nem testing-library) e o
// Playwright que existe serve aos scripts de print — montar um só para isto
// seria inventar infraestrutura fora do escopo. Então o que dá para provar sem
// teatro é a ESTRUTURA da correção, por leitura de fonte; o gesto (clicar,
// tocar, Enter) fica para o e2e do M5, junto do TODO do trilho.
// TODO(M5/e2e): escolher cidade por mouse, por toque e por Enter e conferir que
// a lista fecha e o foco volta ao campo.
describe('CityPicker — a escolha fecha a lista (estrutura)', () => {
  const FONTE = readFileSync('src/components/CityPicker.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('escolher fecha, devolve o foco ao campo e invalida a busca no ar', () => {
    const escolher = FONTE.slice(FONTE.indexOf('function choose'), FONTE.indexOf('function onKeyDown'))
    expect(escolher).toContain('geracao.current++')
    expect(escolher).toContain('setOpen(false)')
    expect(escolher).toContain('inputRef.current?.focus()')
    // Revisão nº 5 do Sol: a marca de supressão é SÍNCRONA (ref) e é firmada
    // ANTES do `focus()` — o `onFocus` que o próprio `focus()` dispara roda no
    // mesmo tique, e nele o estado `sel` ainda não existe.
    expect(escolher).toContain('escolhaFirmada.current = true')
    expect(escolher.indexOf('escolhaFirmada.current = true')).toBeLessThan(
      escolher.indexOf('inputRef.current?.focus()'),
    )
  })

  it('resposta atrasada não mexe na tela (é o que reabria a lista)', () => {
    const busca = FONTE.slice(FONTE.indexOf('async function onChange'), FONTE.indexOf('function choose'))
    expect(busca).toContain('const minha = ++geracao.current')
    expect(busca).toMatch(/if \(minha !== geracao\.current\) return[\s\S]*setOpen\(true\)/)
    // e o carregador com dedupe é o do módulo, não um `if (!DATASET)` local
    expect(FONTE).toContain("from '@/lib/geo/dataset'")
    expect(FONTE).not.toContain('let DATASET')
  })

  it('o foco não reabre a lista quando já há cidade escolhida', () => {
    // O guarda do foco consulta o REF, não o estado (que chega tarde demais no
    // clique virtual do leitor de tela e no toque).
    expect(FONTE).toContain('if (!escolhaFirmada.current && !sel && results.length) setOpen(true)')
    // …e só DIGITAR desarma a supressão.
    const busca = FONTE.slice(FONTE.indexOf('async function onChange'), FONTE.indexOf('function choose'))
    expect(busca).toContain('escolhaFirmada.current = false')
  })

  it('a corrida blur×click morre no mousedown; a opção não é tab stop', () => {
    expect(FONTE).toContain('onMouseDown={(e) => e.preventDefault()}')
    expect(FONTE).toContain('onClick={() => choose(c)}')
    expect(FONTE).toContain('tabIndex={-1}')
  })

  it('Enter escolhe (sem enviar o formulário) e Esc fecha', () => {
    const teclas = FONTE.slice(FONTE.indexOf('function onKeyDown'), FONTE.indexOf('const hora ='))
    expect(teclas).toMatch(/Escape[\s\S]*setOpen\(false\)/)
    expect(teclas).toMatch(/'Enter'[\s\S]*e\.preventDefault\(\)[\s\S]*choose\(results\[/)
    expect(teclas).toContain("e.key === 'ArrowDown'")
    expect(teclas).toContain("e.key === 'ArrowUp'")
  })

  it('a lista é combobox de verdade (o teclado navega pelo campo)', () => {
    expect(FONTE).toContain("role=\"combobox\"")
    expect(FONTE).toContain('aria-expanded={listaAberta}')
    expect(FONTE).toContain('aria-activedescendant')
    expect(FONTE).toContain('role="listbox"')
    expect(FONTE).toContain('role="option"')
  })
})
