// O RECADO DA AÇÃO NÃO SE PERDE (Onda do Portal · P4 · E6, 2ª revisão).
//
// O DESENHO ANTERIOR perdia o desfecho em dois cenários, e o primeiro era
// determinístico:
//
//   1. GATE NO CAMINHO. O `/portal` manda para `/portal/ciencia` quem não deu
//      ciência do canal e para `/portal/briefing` quem não enviou o briefing.
//      O aluno nessa situação que remarcasse por deep link GASTAVA o crédito e
//      caía numa tela que não lia recado nenhum — o `src/proxy.ts` apagava o
//      cookie no caminho. Ato feito, desfecho invisível, sempre.
//   2. QUEM CHEGA PRIMEIRO COME. Prefetch, aba paralela, qualquer requisição sob
//      `/portal` consumia o cookie antes de a tela existir.
//
// O DESENHO NOVO: a LEITURA nunca apaga (quem limpa é o `maxAge` de 15s), o recado leva
// um `id` por escrita (chave do toast — o `sonner` dedupa por ela) e QUEM LÊ é a
// moldura do portal, não cada página. Este arquivo prende as duas metades: o
// mecanismo do cookie (comportamento, com o `next/headers` dublado) e o caminho
// do gate (a moldura desenhando a frase de verdade).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { FLASH_COOKIE, FLASH_MAX_AGE_S, gravarFlash, lerFlash, limparFlash } from '@/lib/portal/flash'
import { tomDoAviso } from '@/lib/kit/tom-do-aviso'
import { RecadoDoPortal } from '@/components/portal/RecadoDoPortal'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
import { cookies } from 'next/headers'

/* -------------------------------------------------------------------------- */
/* o pote de cookies dublê — com o mesmo fio da vida real                       */
/* -------------------------------------------------------------------------- */

type Opcoes = {
  maxAge?: number
  httpOnly?: boolean
  sameSite?: string
  path?: string
  secure?: boolean
}

/**
 * O dublê guarda o valor JÁ SERIALIZADO (`encodeURIComponent`) e o desfaz na
 * leitura — que é exatamente o que o `@edge-runtime/cookies` embutido no Next
 * faz nas duas pontas. Sem isso o teste passaria com aspas e emoji que a rede
 * real não entregaria.
 */
class Pote {
  cru = new Map<string, string>()
  escritas: { nome: string; valor: string; opcoes: Opcoes }[] = []
  apagados: string[] = []

  get(nome: string) {
    const v = this.cru.get(nome)
    return v === undefined ? undefined : { name: nome, value: decodeURIComponent(v) }
  }
  set(nome: string, valor: string, opcoes: Opcoes = {}) {
    this.cru.set(nome, encodeURIComponent(valor))
    this.escritas.push({ nome, valor, opcoes })
  }
  delete(nome: string) {
    this.cru.delete(nome)
    this.apagados.push(nome)
  }
}

let pote: Pote

beforeEach(() => {
  pote = new Pote()
  vi.mocked(cookies).mockResolvedValue(pote as never)
})

/* -------------------------------------------------------------------------- */
/* 1. o mecanismo                                                              */
/* -------------------------------------------------------------------------- */

const REMARCADA = 'Aula remarcada! ✅ (usamos 1 crédito de reposição) Você recebe a confirmação por e-mail.'

describe('o cookie de recado (gravarFlash / lerFlash)', () => {
  it('a frase atravessa inteira — emoji, acento e aspas', async () => {
    await gravarFlash(REMARCADA)
    expect((await lerFlash())?.mensagem).toBe(REMARCADA)

    await gravarFlash('Não foi possível cancelar: «horário» já começou.')
    expect((await lerFlash())?.mensagem).toBe('Não foi possível cancelar: «horário» já começou.')
  })

  it('cada escrita tem `id` próprio — duas ações iguais são dois recados', async () => {
    await gravarFlash(REMARCADA)
    const primeiro = await lerFlash()
    await gravarFlash(REMARCADA)
    const segundo = await lerFlash()
    expect(primeiro?.id).toBeTruthy()
    expect(segundo?.id).toBeTruthy()
    expect(segundo?.id).not.toBe(primeiro?.id)
  })

  it('LER NÃO CONSOME: prefetch e aba paralela não comem o recado do aluno', async () => {
    await gravarFlash(REMARCADA)

    // O prefetch do Next, o ícone, a aba aberta atrás — três leituras antes de a
    // tela existir. No desenho velho a primeira delas matava o recado.
    const leituras = [await lerFlash(), await lerFlash(), await lerFlash()]
    for (const l of leituras) expect(l?.mensagem).toBe(REMARCADA)
    // …e todas leem o MESMO ato (o `id` não muda a cada leitura: é ele que
    // impede o toast de se repetir na mesma aba).
    expect(new Set(leituras.map((l) => l?.id)).size).toBe(1)

    // A prova de que ninguém apaga: nenhum `delete`, e nenhuma escrita além da
    // do próprio ato.
    expect(pote.apagados).toEqual([])
    expect(pote.escritas).toHaveLength(1)
  })

  it('quem limpa é a EXPIRAÇÃO — 15s, httpOnly, no portal inteiro', async () => {
    await gravarFlash(REMARCADA)
    const [escrita] = pote.escritas
    expect(escrita.nome).toBe(FLASH_COOKIE)
    expect(escrita.opcoes.maxAge).toBe(FLASH_MAX_AGE_S)
    // 15s: dá para atravessar um redirect (ou dois, com gate no meio) e é curto
    // demais para o recado reaparecer numa visita seguinte.
    expect(FLASH_MAX_AGE_S).toBe(15)
    expect(escrita.opcoes.httpOnly).toBe(true)
    expect(escrita.opcoes.sameSite).toBe('lax')
    // `path: '/'` porque o destino pode ser qualquer rota — o gate inclusive.
    expect(escrita.opcoes.path).toBe('/')
  })

  it('cookie ilegível não derruba a moldura do portal', async () => {
    // O formato ANTERIOR era texto puro. Um navegador que ainda o carregue no
    // primeiro carregamento pós-deploy não pode quebrar o portal inteiro.
    pote.set(FLASH_COOKIE, 'Aula cancelada. ✅')
    expect(await lerFlash()).toBeNull()

    pote.set(FLASH_COOKIE, '{"mensagem":"sem id"}')
    expect(await lerFlash()).toBeNull()

    pote.set(FLASH_COOKIE, '{"mensagem":"","id":"x"}')
    expect(await lerFlash()).toBeNull()

    pote.cru.delete(FLASH_COOKIE)
    expect(await lerFlash()).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* 2. o cenário do achado: o aluno parado no gate                              */
/* -------------------------------------------------------------------------- */

const raiz = path.resolve(__dirname, '..')
const fonteDe = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8')

describe('o aluno bloqueado pelo gate vê o desfecho da remarcação', () => {
  it('a frase testada é a que a action realmente grava', () => {
    // Sem esta amarra o cenário abaixo provaria uma frase inventada.
    expect(fonteDe('src/app/portal/actions.ts')).toContain(REMARCADA)
  })

  it('a rota do gate é servida pela MOLDURA do portal (não tem layout próprio)', () => {
    // `/portal/ciencia` e `/portal/briefing` são o destino dos dois gates do
    // `/portal`. Elas herdam `src/app/portal/layout.tsx` — é o que faz o recado
    // chegar lá sem a tela precisar lembrar de nada.
    expect(() => fonteDe('src/app/portal/ciencia/page.tsx')).not.toThrow()
    expect(() => fonteDe('src/app/portal/briefing/page.tsx')).not.toThrow()
    expect(() => fonteDe('src/app/portal/ciencia/layout.tsx')).toThrow()
    expect(() => fonteDe('src/app/portal/briefing/layout.tsx')).toThrow()

    const layout = fonteDe('src/app/portal/layout.tsx')
    expect(layout).toContain('<RecadoDoPortal />')
    expect(layout).toContain("import { RecadoDoPortal } from '@/components/portal/RecadoDoPortal'")
  })

  it('o recado gravado pela remarcação é DESENHADO pela moldura, com a chave do ato', async () => {
    // 1. a action remarca e grava o desfecho…
    await gravarFlash(REMARCADA)
    const gravado = await lerFlash()

    // 2. …o aluno é mandado para `/portal`, que o joga no gate, e a moldura
    //    desta rota lê o mesmo cookie.
    const elemento = await RecadoDoPortal()
    expect(elemento, 'a moldura tem de renderizar algo quando há recado').not.toBeNull()

    // 3. a frase aparece na tela do gate — a faixa `<noscript>` é o caminho sem
    //    JavaScript, e é ela que sai no HTML de servidor.
    const html = renderToStaticMarkup(elemento as React.ReactElement)
    expect(html).toContain('Aula remarcada!')
    expect(html).toContain('usamos 1 crédito de reposição')
    expect(html).toContain('<noscript>')

    // 4. a chave do toast é o `id` do ato (dedupe na mesma aba).
    const props = (elemento as unknown as { props: { mensagem: string; chave: string } }).props
    expect(props.mensagem).toBe(REMARCADA)
    expect(props.chave).toBe(gravado?.id)
  })

  it('sem recado a moldura não desenha nada', async () => {
    expect(await RecadoDoPortal()).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* 3. o descarte não pode voltar                                               */
/* -------------------------------------------------------------------------- */

/**
 * A REGRA, escrita por inteiro depois da rodada 2 da revisão do P5:
 *
 *   · a LEITURA nunca apaga — nem prefetch, nem gate, nem a moldura (era o
 *     defeito de origem, e o teste de cima o prende);
 *   · o ESCRITOR apaga UMA coisa só: o recado de ERRO que o próprio ato dele
 *     acabou de tornar obsoleto (etapa avançada ⇒ a recusa da etapa anterior
 *     foi resolvida);
 *   · recado de SUCESSO nunca é apagado por ninguém. Ele pode ter nascido em
 *     outra aba, e desfecho de dinheiro engolido não se reencontra.
 */
describe('quem apaga o recado — e o que ele pode apagar', () => {
  const RECUSA = 'Falha: marque ao menos uma forma de contato que você já teve com o inglês.'

  it('erro pendente É apagado pelo escritor (o defeito: ele sobrevivia à correção)', async () => {
    await gravarFlash(RECUSA)
    expect(tomDoAviso(RECUSA)).toBe('erro')
    expect((await lerFlash())?.mensagem).toBe(RECUSA)

    await limparFlash()
    expect(await lerFlash()).toBeNull()
    // Some por EXPIRAÇÃO da própria escrita, não por `delete` — o mesmo
    // `path`/`secure` da gravação, senão o navegador não casa o cookie certo.
    const ultima = pote.escritas.at(-1)!
    expect(ultima.opcoes.maxAge).toBe(0)
    expect(ultima.opcoes.path).toBe('/')
    expect(ultima.opcoes.httpOnly).toBe(true)
    expect(pote.apagados).toEqual([])
  })

  it('SUCESSO pendente sobrevive: a aba que remarcou não perde o desfecho', async () => {
    // O cenário: a remarcação conclui numa aba e, milissegundos depois, a outra
    // aba avança uma etapa do briefing. O cookie é UM só para o navegador.
    await gravarFlash(REMARCADA)
    expect(tomDoAviso(REMARCADA)).toBe('sucesso')

    await limparFlash()

    expect((await lerFlash())?.mensagem).toBe(REMARCADA)
    // …e nem uma escrita a mais: o caminho de sucesso nem toca no cookie.
    expect(pote.escritas).toHaveLength(1)
  })

  it('sem recado nenhum, limpar é operação nula', async () => {
    await limparFlash()
    expect(await lerFlash()).toBeNull()
    expect(pote.escritas).toEqual([])
    expect(pote.apagados).toEqual([])
  })

  it('quem decide o que é erro é a MESMA função que pinta a cor', () => {
    // Sem isso, "apagar erro" e "mostrar em vermelho" viram duas listas — e a
    // frase que a moldura pinta de vermelho ficaria pendurada porque uma
    // segunda régua a considerou sucesso.
    const flash = fonteDe('src/lib/portal/flash.ts')
    expect(flash).toContain("from '@/lib/kit/tom-do-aviso'")
    expect(flash).toMatch(/tomDoAviso\(atual\.mensagem\) !== 'erro'/)
  })

  it('o proxy voltou a ter duas responsabilidades (sessão e papel), sem flash', () => {
    // Era aqui que o cookie morria antes de o gate desenhar. O arquivo de infra
    // não pode ter nada a ver com o recado do portal.
    const proxy = fonteDe('src/proxy.ts')
    expect(proxy.toLowerCase()).not.toContain('flash')
    expect(proxy).not.toContain('cookies.delete')
  })

  it('nenhum arquivo do portal apaga o cookie', () => {
    const suspeitos = [
      'src/app/portal/layout.tsx',
      'src/app/portal/page.tsx',
      'src/app/portal/actions.ts',
      'src/components/portal/RecadoDoPortal.tsx',
      'src/lib/portal/flash.ts',
    ]
    for (const arquivo of suspeitos) {
      expect(fonteDe(arquivo), arquivo).not.toMatch(/\.delete\(\s*FLASH_COOKIE/)
      expect(fonteDe(arquivo), arquivo).not.toMatch(/\.delete\(\s*['"]flash['"]/)
    }
  })
})
