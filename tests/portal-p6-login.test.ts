// @vitest-environment jsdom
//
// P6 · D11 — A DISPUTA DO LOGIN, provada no DOM.
//
// O dono autorizou uma proposta nova de porta de entrada na direção do site
// reestruturado, e escreveu a regra do desempate: a capa noturna consolidada
// segue em produção e **vence por padrão** — empate ou dúvida = fica a
// consolidada (`docs/PLANO-CLONAGEM-UX.md` §D11 · `docs/goals/ia-site-2026-07.md`
// §"Capa noturna"). Este arquivo cobra as cinco coisas que fazem essa disputa
// ser honesta:
//
//   1. a INCUMBENTE é o padrão — `/login` e `/recuperar-senha` sem query servem
//      a capa noturna, e só a palavra exata `proposta` desvia;
//   2. a INCUMBENTE não mudou um BYTE — o bloco dela nas duas rotas é comparado
//      contra a versão do PRÓPRIO GIT anterior ao P6 (nada de cópia escrita à
//      mão neste arquivo, que envelhece e pode ser "consertada" junto).
//      **A9 (29/07): há UMA exceção escrita** — o `<ResgateDoEnvio />` do
//      ADR-030, que não desenha nada e entrou igual nas duas variantes. O
//      normalizador `semOResgate` está documentado onde vive, e há caso próprio
//      cobrando que o resgate ESTEJA lá (a exceção não vira porta dos fundos);
//   3. a proposta tem a MESMA FUNÇÃO — mesmo formulário, mesmos `name=`, mesmo
//      `type`, mesmo `autocomplete`, e a MESMA server action, provada pelo
//      ENVIO (quem foi chamada, com que dados), não por texto de código;
//   4. a proposta tem a MESMA CÓPIA e a MESMA VALIDAÇÃO — título, subtítulo,
//      rótulos, placeholders, botão, links e recados extraídos do DOM das duas
//      variantes e comparados INTEIROS; e o envio vazio se comporta igual nas
//      duas (validação nativa), para que a única variável em julgamento seja o
//      visual;
//   5. NINGUÉM chega à proposta por link público — ela é bancada, não rota.
//
// É render de verdade (jsdom, `createRoot`), não leitura de fonte: as duas
// páginas são componentes de servidor assíncronos, então o teste os AGUARDA e
// monta o elemento devolvido. Sem isto, trocar o valor comparado no `if` — ou
// apagar a proposta inteira — deixaria a suíte verde.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * As server actions viram DUBLÊS — e é isso que permite provar a paridade de
 * ação no DOM em vez de no texto do código.
 *
 * O React chama a função de `<form action={fn}>` com o `FormData` montado pelo
 * navegador; registrando QUAL função foi chamada e COM QUE dados, a pergunta
 * "as duas capas submetem para a mesma action?" deixa de ser uma leitura de
 * `import` e passa a ser uma medição do que o servidor receberia. As actions de
 * verdade continuam intocadas — elas nem são carregadas aqui.
 */
const acoes = vi.hoisted(() => {
  const chamadas: { qual: string; dados: [string, string][] }[] = []
  const dublê = (qual: string) => async (formData: FormData) => {
    chamadas.push({
      qual,
      dados: Array.from(formData.entries()).map(([k, v]) => [k, String(v)] as [string, string]),
    })
  }
  return {
    chamadas,
    signInWithPassword: dublê('signInWithPassword'),
    requestPasswordReset: dublê('requestPasswordReset'),
  }
})

vi.mock('@/app/login/actions', () => ({
  signInWithPassword: acoes.signInWithPassword,
  requestPasswordReset: acoes.requestPasswordReset,
}))

const { default: LoginPage } = await import('@/app/login/page')
const { default: RecuperarSenhaPage } = await import('@/app/recuperar-senha/page')

// O jsdom não implementa `matchMedia`, e o `FogGL` da capa consolidada pergunta
// por `prefers-reduced-motion` no efeito. Shim mínimo: sem ele, justamente a
// capa que VENCE por padrão não montaria neste arquivo.
window.matchMedia = ((consulta: string) => ({
  matches: false,
  media: consulta,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

let raiz: Root | null = null
let caixa: HTMLDivElement | null = null

async function montar(elemento: ReactElement): Promise<HTMLDivElement> {
  caixa = document.createElement('div')
  document.body.appendChild(caixa)
  await act(async () => {
    raiz = createRoot(caixa!)
    raiz.render(elemento)
  })
  return caixa
}

async function desmontar() {
  if (raiz) await act(async () => raiz!.unmount())
  caixa?.remove()
  raiz = null
  caixa = null
}

beforeEach(() => {
  acoes.chamadas.length = 0
})

afterEach(desmontar)

const login = (q: { erro?: string; next?: string; visual?: string } = {}) =>
  LoginPage({ searchParams: Promise.resolve(q) })
const recuperar = (q: { estado?: string; visual?: string } = {}) =>
  RecuperarSenhaPage({ searchParams: Promise.resolve(q) })

/** A capa consolidada se reconhece pelo vidro; a proposta, pelo marcador dela. */
const ehConsolidada = (c: HTMLElement) =>
  c.querySelector('.glass') !== null && c.querySelector('[data-visual="proposta"]') === null
const ehProposta = (c: HTMLElement) =>
  c.querySelector('[data-visual="proposta"]') !== null && c.querySelector('.glass') === null

/** Texto como a pessoa lê: quebras de linha do JSX viram um espaço só. */
const texto = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * A assinatura do formulário: o que o servidor vai RECEBER.
 *
 * Nome, tipo, obrigatoriedade e autocomplete de cada controle, na ordem do DOM.
 * É o contrato que a proposta não pode romper — a action é a mesma, e ela lê
 * `email`/`password`/`next` do `FormData`.
 */
function assinaturaDoForm(caixa: HTMLElement): string[] {
  const form = caixa.querySelector('form')
  expect(form, 'a tela precisa ter um formulário').not.toBeNull()
  return Array.from(form!.querySelectorAll('input, select, textarea')).map(
    (el) =>
      [
        el.getAttribute('name') ?? '(sem nome)',
        el.getAttribute('type') ?? '(sem tipo)',
        el.hasAttribute('required') ? 'obrigatório' : 'opcional',
        el.getAttribute('autocomplete') ?? '-',
      ].join('|'),
  )
}

/**
 * TODA a cópia visível da tela, extraída do DOM.
 *
 * Comparar isto INTEIRO (e não trechos com `toContain`) é o que garante que a
 * disputa isola a variável visual: qualquer palavra que mudar de um lado — um
 * rótulo, um placeholder, o texto do botão, o recado de erro — fica vermelho.
 * O `href` dos links fica de FORA de propósito: eles diferem por desenho (na
 * bancada o `?visual=proposta` viaja com o link), e é o TEXTO que o dono lê.
 */
function copiaDe(c: HTMLElement) {
  const h1 = c.querySelector('h1')
  expect(h1, 'a tela precisa ter um h1').not.toBeNull()
  const subtitulo = h1!.nextElementSibling
  const form = c.querySelector('form')
  expect(form, 'a tela precisa ter um formulário').not.toBeNull()
  return {
    titulo: texto(h1),
    subtitulo: texto(subtitulo),
    rotulos: Array.from(form!.querySelectorAll('label')).map(texto),
    placeholders: Array.from(form!.querySelectorAll('input')).map(
      (i) => i.getAttribute('placeholder') ?? '',
    ),
    enviar: texto(form!.querySelector('button[type="submit"]')),
    links: Array.from(c.querySelectorAll('a')).map(texto),
    // O recado de estado (erro/aviso): parágrafo fora do formulário que não é o
    // subtítulo e não é o parágrafo que embrulha um link.
    recados: Array.from(c.querySelectorAll('p'))
      .filter((p) => !p.closest('form') && p !== subtitulo && p.querySelector('a') === null)
      .map(texto),
  }
}

/** Clica no botão de envio de verdade, depois de preencher o que for pedido. */
async function enviar(c: HTMLElement, valores: Record<string, string> = {}) {
  const form = c.querySelector('form')!
  for (const [nome, valor] of Object.entries(valores)) {
    const campo = form.querySelector<HTMLInputElement>(`[name="${nome}"]`)
    expect(campo, `o campo ${nome} precisa existir`).not.toBeNull()
    campo!.value = valor
  }
  const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  await act(async () => {
    botao.click()
  })
  return botao
}

/* -------------------------------------------------------------------------- */
/* 1. a incumbente é o padrão                                                  */
/* -------------------------------------------------------------------------- */

describe('P6 · a capa consolidada vence por padrão', () => {
  it('/login sem query nenhuma serve a capa noturna', async () => {
    const c = await montar(await login())
    expect(ehConsolidada(c)).toBe(true)
    expect(c.querySelector('main')?.className).toContain('bg-bg-900')
  })

  it('/recuperar-senha sem query nenhuma serve a capa noturna', async () => {
    const c = await montar(await recuperar())
    expect(ehConsolidada(c)).toBe(true)
  })

  it('só a palavra EXATA `proposta` desvia — qualquer outro valor cai na incumbente', async () => {
    for (const visual of ['', 'nova', 'Proposta', 'proposta ', 'clara', 'noturna']) {
      const c = await montar(await login({ visual }))
      expect(ehConsolidada(c), `?visual=${visual}`).toBe(true)
      await desmontar()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 2. a proposta existe, e só na bancada                                       */
/* -------------------------------------------------------------------------- */

describe('P6 · a proposta aparece em ?visual=proposta', () => {
  it('/login?visual=proposta é a direção clara: papel, cartão do kit, sem fog', async () => {
    const c = await montar(await login({ visual: 'proposta' }))
    expect(ehProposta(c)).toBe(true)
    const main = c.querySelector('main')!
    expect(main.className).toContain('bg-paper-50')
    // A superfície é DECLARADA: é o que troca o anel de foco global do turquesa
    // da noite (1,75:1 sobre branco — invisível) para o periwinkle da marca.
    expect(main.getAttribute('data-surface')).toBe('paper')
    // o cartão do kit (`.panel-tb`) e o fio-assinatura da moldura do portal
    expect(c.querySelector('.panel-tb')).not.toBeNull()
    expect(c.querySelector('.brand-thread')).not.toBeNull()
    // a ação veste o acento periwinkle do kit, não o gradiente da noite
    expect(c.querySelector('form button[type="submit"]')?.className).toContain('btn-ac')
    expect(c.querySelector('.btn-cta')).toBeNull()
  })

  it('/recuperar-senha?visual=proposta idem', async () => {
    const c = await montar(await recuperar({ visual: 'proposta' }))
    expect(ehProposta(c)).toBe(true)
    expect(c.querySelector('.panel-tb')).not.toBeNull()
    expect(c.querySelector('main')?.getAttribute('data-surface')).toBe('paper')
  })
})

/* -------------------------------------------------------------------------- */
/* 3. mesma função: o servidor não distingue as duas capas                      */
/* -------------------------------------------------------------------------- */

describe('P6 · paridade de formulário entre as duas capas', () => {
  it('login: os mesmos campos, na mesma ordem, com o mesmo contrato', async () => {
    const noturna = assinaturaDoForm(await montar(await login()))
    await desmontar()

    const clara = assinaturaDoForm(await montar(await login({ visual: 'proposta' })))

    // O varredor está olhando de verdade (e não devolvendo lista vazia).
    expect(noturna).toEqual([
      'email|email|obrigatório|email',
      'password|password|obrigatório|current-password',
    ])
    expect(clara).toEqual(noturna)
  })

  it('login: o `next` escondido viaja igual nas duas (deep link do aviso)', async () => {
    const noturna = assinaturaDoForm(await montar(await login({ next: '/portal/aulas' })))
    await desmontar()

    const clara = assinaturaDoForm(
      await montar(await login({ next: '/portal/aulas', visual: 'proposta' })),
    )
    expect(noturna[0]).toBe('next|hidden|opcional|-')
    expect(clara).toEqual(noturna)
    expect(caixa!.querySelector('input[name="next"]')?.getAttribute('value')).toBe('/portal/aulas')
  })

  it('recuperar-senha: o mesmo campo', async () => {
    const noturna = assinaturaDoForm(await montar(await recuperar()))
    await desmontar()

    const clara = assinaturaDoForm(await montar(await recuperar({ visual: 'proposta' })))
    expect(noturna).toEqual(['email|email|obrigatório|email'])
    expect(clara).toEqual(noturna)
  })
})

describe('P6 · a ação EFETIVA do botão de envio é a mesma nas duas capas', () => {
  /**
   * O que se mede: com quem o clique no botão de envio termina.
   *
   * `HTMLButtonElement.formAction` só existiria se o botão trouxesse
   * `formaction=` próprio — a checagem de que ele NÃO traz é metade da prova
   * (nada sobrescreve a ação do formulário). A outra metade é o efeito: o React
   * chama a função de `<form action={fn}>` com o `FormData` do navegador, então
   * o dublê registra QUAL função rodou e COM QUE dados.
   */
  it('login: o mesmo dublê recebe o mesmo FormData nas duas capas', async () => {
    const dados = { next: '/portal/aulas', email: 'aluna@exemplo.com', password: 'segredo-1' }

    const b1 = await enviar(
      await montar(await login({ next: '/portal/aulas' })),
      { email: dados.email, password: dados.password },
    )
    expect(b1.hasAttribute('formaction')).toBe(false)
    const noturna = [...acoes.chamadas]
    await desmontar()
    acoes.chamadas.length = 0

    const b2 = await enviar(
      await montar(await login({ next: '/portal/aulas', visual: 'proposta' })),
      { email: dados.email, password: dados.password },
    )
    expect(b2.hasAttribute('formaction')).toBe(false)
    const clara = [...acoes.chamadas]

    expect(noturna).toEqual([
      {
        qual: 'signInWithPassword',
        dados: [
          ['next', '/portal/aulas'],
          ['email', 'aluna@exemplo.com'],
          ['password', 'segredo-1'],
        ],
      },
    ])
    expect(clara).toEqual(noturna)
  })

  it('recuperar-senha: idem, e é a OUTRA action', async () => {
    const b1 = await enviar(await montar(await recuperar()), { email: 'aluna@exemplo.com' })
    expect(b1.hasAttribute('formaction')).toBe(false)
    const noturna = [...acoes.chamadas]
    await desmontar()
    acoes.chamadas.length = 0

    const b2 = await enviar(await montar(await recuperar({ visual: 'proposta' })), {
      email: 'aluna@exemplo.com',
    })
    expect(b2.hasAttribute('formaction')).toBe(false)
    const clara = [...acoes.chamadas]

    expect(noturna).toEqual([
      { qual: 'requestPasswordReset', dados: [['email', 'aluna@exemplo.com']] },
    ])
    expect(clara).toEqual(noturna)
  })
})

/* -------------------------------------------------------------------------- */
/* 4. mesma cópia e mesma validação: a única variável é o visual                */
/* -------------------------------------------------------------------------- */

describe('P6 · paridade de CÓPIA, palavra por palavra', () => {
  it('login: título, subtítulo, rótulos, placeholders, botão e link', async () => {
    const noturna = copiaDe(await montar(await login()))
    await desmontar()
    const clara = copiaDe(await montar(await login({ visual: 'proposta' })))

    // Âncora literal: prova que o extrator está lendo a tela, e não devolvendo
    // dois objetos vazios iguais.
    expect(noturna).toEqual({
      titulo: 'Bem-vindo de volta',
      subtitulo: 'Entre para ver suas aulas.',
      rotulos: ['E-mail', 'Senha'],
      placeholders: ['voce@exemplo.com', ''],
      enviar: 'Entrar',
      links: ['Esqueci minha senha'],
      recados: [],
    })
    expect(clara).toEqual(noturna)
  })

  it('recuperar-senha: idem', async () => {
    const noturna = copiaDe(await montar(await recuperar()))
    await desmontar()
    const clara = copiaDe(await montar(await recuperar({ visual: 'proposta' })))

    expect(noturna).toEqual({
      titulo: 'Recuperar senha',
      subtitulo: 'Digite seu e-mail e enviaremos um link para criar uma senha nova.',
      rotulos: ['E-mail'],
      placeholders: ['voce@exemplo.com'],
      enviar: 'Enviar link de recuperação',
      links: ['Voltar para o login'],
      recados: [],
    })
    expect(clara).toEqual(noturna)
  })

  it('os dois estados de erro do login dizem a MESMA coisa, INTEIRA, nas duas capas', async () => {
    const esperado: Record<string, string> = {
      credenciais:
        'E-mail ou senha incorretos. Se você ainda não criou sua senha, use “Esqueci minha senha” abaixo.',
      'link-invalido':
        'Este link expirou ou já foi usado. Entre com sua senha ou peça um novo em “Esqueci minha senha”.',
    }
    for (const erro of Object.keys(esperado)) {
      const noturna = copiaDe(await montar(await login({ erro })))
      await desmontar()
      const clara = copiaDe(await montar(await login({ erro, visual: 'proposta' })))
      expect(noturna.recados, erro).toEqual([esperado[erro]])
      expect(clara, erro).toEqual(noturna)
      await desmontar()
    }
  })

  it('recuperar-senha: os dois estados dizem a mesma coisa, INTEIRA, nas duas capas', async () => {
    const esperado: Record<string, string> = {
      enviado:
        'Se este e-mail estiver cadastrado, o link já está a caminho — vale por 60 minutos. Não chegou? Confira o spam ou fale com a gente no WhatsApp de sempre.',
      'email-invalido': 'Confira o e-mail digitado.',
    }
    for (const estado of Object.keys(esperado)) {
      const noturna = copiaDe(await montar(await recuperar({ estado })))
      await desmontar()
      const clara = copiaDe(await montar(await recuperar({ estado, visual: 'proposta' })))
      expect(noturna.recados, estado).toEqual([esperado[estado]])
      expect(clara, estado).toEqual(noturna)
      await desmontar()
    }
  })
})

describe('P6 · a validação do envio vazio também é a mesma', () => {
  /**
   * Por que isto é obrigatório na disputa: a primeira versão da proposta usava
   * o `FormValidado` do kit (noValidate + frase embaixo do campo + foco no
   * primeiro erro). Visualmente é melhor — e por isso mesmo era veneno aqui: o
   * dono compararia DUAS variáveis (o visual e a experiência do envio vazio)
   * achando que comparava uma. A proposta voltou à validação nativa; este teste
   * é o cinto.
   */
  for (const [nome, tela] of [
    ['login', login],
    ['recuperar-senha', recuperar],
  ] as const) {
    it(`${nome}: nas duas capas o navegador segura o envio e a action não roda`, async () => {
      for (const visual of [undefined, 'proposta']) {
        const c = await montar(await tela({ visual }))
        const form = c.querySelector('form')!
        expect(form.hasAttribute('novalidate'), `${nome} ?visual=${visual}`).toBe(false)
        // Nenhum resto do erro inline: a marcação do `FormValidado` não sobrou.
        expect(c.querySelectorAll('[data-slot="campo-erro"]')).toHaveLength(0)
        expect(c.querySelectorAll('[data-slot="campo"]')).toHaveLength(0)

        await enviar(c)
        expect(acoes.chamadas, `${nome} ?visual=${visual}`).toHaveLength(0)
        await desmontar()
      }
    })
  }
})

/* -------------------------------------------------------------------------- */
/* 5. fonte: nada de auth na proposta, e nenhum link público para a bancada     */
/* -------------------------------------------------------------------------- */

const raizDoRepo = path.resolve(__dirname, '..')
const fonteDe = (arquivo: string) => readFileSync(path.join(raizDoRepo, arquivo), 'utf8')

/** Fonte sem comentário: o que sobra é código de verdade. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function arquivosDe(dir: string): string[] {
  const absoluto = path.join(raizDoRepo, dir)
  const achados: string[] = []
  const andar = (atual: string) => {
    for (const nome of readdirSync(atual)) {
      const cheio = path.join(atual, nome)
      if (statSync(cheio).isDirectory()) andar(cheio)
      else if (/\.tsx?$/.test(nome))
        // Bancada Windows (01/09/2026): `path.relative` devolve barra invertida;
        // PROPOSTAS e os pinos falam em "/".
        achados.push(path.relative(raizDoRepo, cheio).split(path.sep).join('/'))
    }
  }
  andar(absoluto)
  return achados
}

const PROPOSTAS = ['src/app/login/proposta.tsx', 'src/app/recuperar-senha/proposta.tsx']

/**
 * As três formas de levar alguém à bancada que valem varrer.
 *
 * A primeira versão só olhava o literal `visual=proposta` na URL — e passava
 * batido por um link montado com objeto (`{ visual: 'proposta' }`, que é como o
 * `next/link` aceita query) ou por `searchParams.set('visual', 'proposta')`.
 *
 * LIMITE CONHECIDO E ACEITO: valor vindo de variável (`href={`?visual=${v}`}`)
 * ou concatenação de pedaços não é pego — para isso seria preciso analisar o
 * fluxo do valor, e o custo não se paga num lote cujos dois arquivos morrem na
 * decisão do dono. O que protege esse flanco é a régua humana do goal doc:
 * nenhuma página servida a um usuário real aponta para a bancada.
 */
const PADROES_DE_BANCADA: RegExp[] = [
  /visual=proposta/, // literal na URL
  /\bvisual\b\s*:\s*['"`]proposta/, // objeto: { visual: 'proposta' }
  /['"`]visual['"`]\s*,\s*['"`]proposta['"`]/, // set/append: ('visual', 'proposta')
]

/** Este arquivo levaria alguém à bancada? (comentário não leva ninguém.) */
const apontaParaBancada = (fonte: string) => {
  const codigo = semComentarios(fonte)
  return PADROES_DE_BANCADA.some((p) => p.test(codigo))
}

describe('P6 · a proposta não muda nada de auth, e ninguém chega nela por link', () => {
  it('a proposta não escreve uma linha de auth: nada de Supabase, cookie ou redirect', () => {
    for (const arquivo of [...PROPOSTAS, 'src/components/kit/capa-clara.tsx']) {
      const fonte = semComentarios(fonteDe(arquivo))
      for (const proibido of ['supabase', 'createClient', 'redirect(', 'cookies(', 'auth.']) {
        expect(fonte.includes(proibido), `${arquivo} menciona ${proibido}`).toBe(false)
      }
    }
  })

  it('NENHUM link público aponta para a proposta — só ela aponta para ela mesma', () => {
    const suspeitos = arquivosDe('src/').filter((arquivo) => apontaParaBancada(fonteDe(arquivo)))
    expect(suspeitos.sort()).toEqual([...PROPOSTAS].sort())

    // …e o que cada uma aponta é a OUTRA metade do conjunto claro, para o dono
    // comparar login + recuperar sem cair na capa noturna no meio do caminho.
    expect(fonteDe('src/app/login/proposta.tsx')).toContain(
      'href="/recuperar-senha?visual=proposta"',
    )
    expect(fonteDe('src/app/recuperar-senha/proposta.tsx')).toContain('href="/login?visual=proposta"')
  })

  it('o varredor pega as três formas de escrever o link — e não pega comentário', () => {
    for (const amostra of [
      '<Link href="/login?visual=proposta">Entrar</Link>',
      "<Link href={{ pathname: '/login', query: { visual: 'proposta' } }}>Entrar</Link>",
      "const sp = new URLSearchParams(); sp.set('visual', 'proposta')",
    ]) {
      expect(apontaParaBancada(amostra), amostra).toBe(true)
    }
    expect(apontaParaBancada('// a bancada mora em /login?visual=proposta')).toBe(false)
    expect(apontaParaBancada('const visual = params.visual')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 6. a incumbente não mudou um byte                                            */
/* -------------------------------------------------------------------------- */

/**
 * A REFERÊNCIA DO CONGELAMENTO VEM DO GIT, não de uma cópia escrita aqui.
 *
 * A regra do dono não é "manter parecida": é manter a capa que está em produção
 * disponível para o portão visual sem nenhuma alteração de classe ou de cópia.
 * A primeira versão deste arquivo carregava as ~150 linhas da capa noturna
 * duplicadas numa constante — o que tem dois defeitos: envelhece, e quem
 * alterasse a capa poderia "consertar" o teste editando a cópia no mesmo commit.
 * Lendo do próprio histórico, a referência é a que está gravada e não se edita.
 *
 * QUAL commit: o ANTERIOR ao P6, achado pelo próprio alternador que o P6
 * introduziu (`git log -S`). Enquanto o lote não estiver commitado o pickaxe não
 * acha nada e a referência é o `HEAD` — que é exatamente o estado anterior.
 * Depois do commit, ela passa a ser o pai do commit que introduziu o alternador,
 * e o congelamento continua medindo a mesma distância. (Quando a disputa for
 * decidida e o alternador sair, este arquivo inteiro sai junto — é o combinado:
 * um dos dois morre, e morre inteiro.)
 */
const MARCADOR_DO_P6 = "visual === 'proposta'"

function gitEm(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

function git(...args: string[]): string {
  return gitEm(raizDoRepo, ...args)
}

/**
 * A referência do congelamento: o pai do commit que introduziu o marcador.
 * Devolve `null` quando esse commit não tem pai (repositório que nasce de um
 * commit só, como o público): não há estado anterior para comparar, e o caso
 * de congelamento é PULADO com aviso (decisão do dono, 27/10/2026, issue #57).
 * Ele segue rodando onde o histórico existe (bancada e repositório privado).
 */
function refAnteriorAoP6(arquivo: string, cwd: string = raizDoRepo): string | null {
  const introduziu = gitEm(cwd, 'log', '--format=%H', `-S${MARCADOR_DO_P6}`, '--', arquivo)
    .split('\n')
    .filter(Boolean)[0]
  if (!introduziu) return 'HEAD'
  // `--verify --quiet` sai 0 se a ref existe e 1 se não existe; qualquer outro
  // desfecho (git ausente, objeto corrompido) é falha de verdade, não "sem pai".
  const sonda = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${introduziu}^`], {
    cwd,
    encoding: 'utf8',
  })
  if (sonda.error) throw sonda.error
  if (sonda.status === 1) return null
  if (sonda.status !== 0) throw new Error(`git rev-parse falhou (${sonda.status}): ${sonda.stderr}`)
  return `${introduziu}^`
}

let avisouSemHistorico = false
function avisarSemHistorico(arquivo: string) {
  if (avisouSemHistorico) return
  avisouSemHistorico = true
  // `it` sempre ativo: o reporter padrão não mostra console de caso pulado.
  it(`congelamento pulado (${arquivo} e vizinhas): sem estado anterior no histórico`, () => {
    console.warn(
      '[congelamento do P6 pulado] o commit que introduziu o marcador não tem pai; ' +
        'não há estado anterior no histórico deste repositório para comparar',
    )
  })
}

/**
 * A ÚNICA EXCEÇÃO ESCRITA DO CONGELAMENTO (A9, 29/07/2026 — onda da Agenda).
 *
 * A dívida das capas do goal do Portal foi paga: as duas rotas em disputa
 * ganharam o `<ResgateDoEnvio />` do ADR-030 dentro do `<form>`. Ele NÃO é uma
 * mudança da capa no sentido que o dono congelou — não desenha nada (`return
 * null`), não tem classe, não tem cópia, não muda o layout nem o contraste, e
 * entrou IGUAL nas duas variantes (a proposta também o monta), de modo que a
 * comparação visual continua isolando uma única variável.
 *
 * A exceção é cirúrgica de propósito: some o mount e o comentário JSX que o
 * apresenta, e mais nada. Qualquer outro byte diferente continua vermelho — e o
 * caso `o resgate ESTÁ montado` abaixo impede que este normalizador vire porta
 * dos fundos (tirar o resgate para "consertar" o congelamento fica vermelho no
 * outro caso, e também na varredura V1 de `onda-portal-varredura.test.ts`).
 */
function semOResgate(bloco: string): string {
  const fora: string[] = []
  for (const linha of bloco.split('\n')) {
    if (linha.includes('<ResgateDoEnvio')) {
      // Come junto o comentário JSX que o apresenta — e só ele: se a linha de
      // cima não FECHA um comentário, nada acima é removido.
      if (fora.length > 0 && fora[fora.length - 1].includes('*/}')) {
        while (fora.length > 0) {
          const ultima = fora.pop()!
          if (ultima.includes('{/*')) break
        }
      }
      continue
    }
    fora.push(linha)
  }
  return fora.join('\n')
}

/** O que DESENHA a capa consolidada dentro do arquivo da rota. */
function capaConsolidada(fonte: string, ondeVem: string): string {
  const campos = fonte.indexOf('const inputClass =')
  const fim = fonte.indexOf('export default', campos)
  const abre = fonte.indexOf('<main')
  const fecha = fonte.lastIndexOf('</main>')
  for (const [oQue, onde] of [
    ['a classe dos campos', campos],
    ['o <main>', abre],
    ['o </main>', fecha],
  ] as const) {
    expect(onde, `${ondeVem}: ${oQue} sumiu do arquivo`).toBeGreaterThan(-1)
  }
  return semOResgate(
    fonte.slice(campos, fim).trimEnd() + '\n\n' + fonte.slice(abre, fecha + '</main>'.length),
  )
}

/**
 * Os imports que DESENHAM a capa noturna, na ordem em que aparecem.
 *
 * O recorte do `<main>` não os alcança, e sem eles a capa consolidada podia ser
 * esvaziada por fora do bloco congelado: trocar o `FogGL` por outro componente
 * de mesmo nome, ou reordenar as camadas do fundo, não mudaria uma vírgula do
 * JSX. O bloco de imports INTEIRO não serve de referência porque o P6 adiciona
 * um (`./proposta`) de propósito — o que se cobra é presença e ordem dos que
 * pintam.
 */
const MODULOS_QUE_DESENHAM = [
  'next/image',
  'next/link',
  '@/components/FogBackground',
  '@/components/FogGL',
]

function importsQueDesenham(fonte: string): string[] {
  return fonte
    .split('\n')
    .filter((linha) => linha.startsWith('import '))
    .filter((linha) => MODULOS_QUE_DESENHAM.some((m) => linha.includes(`'${m}'`)))
}

const ROTAS_CONGELADAS = ['src/app/login/page.tsx', 'src/app/recuperar-senha/page.tsx']

describe('P6 · a capa consolidada continua BYTE A BYTE', () => {
  for (const arquivo of ROTAS_CONGELADAS) {
    const ref = refAnteriorAoP6(arquivo)
    if (ref === null) avisarSemHistorico(arquivo)

    it.skipIf(ref === null)(`${arquivo}: nem uma classe, nem uma palavra`, () => {
      if (ref === null) return
      const antes = git('show', `${ref}:${arquivo}`)
      const agora = fonteDe(arquivo)

      // A referência precisa ser mesmo a de ANTES — se ela já tivesse o
      // alternador, o congelamento estaria se comparando consigo mesmo.
      expect(antes.includes(MARCADOR_DO_P6), `${ref} não pode conter o P6`).toBe(false)

      const congelado = capaConsolidada(antes, `${ref}:${arquivo}`)
      expect(congelado.length, 'a referência não pode vir vazia').toBeGreaterThan(1000)
      expect(capaConsolidada(agora, arquivo)).toBe(congelado)

      // PROVA DE MUTAÇÃO do próprio recorte, com o mesmo extrator: uma palavra
      // trocada na capa noturna fica vermelha.
      expect(
        capaConsolidada(agora.replace('E-mail', 'Email'), arquivo),
        'o extrator precisa reprovar uma capa alterada',
      ).not.toBe(congelado)
    })

    it.skipIf(ref === null)(`${arquivo}: os imports que desenham continuam os mesmos, na mesma ordem`, () => {
      if (ref === null) return
      const antes = importsQueDesenham(git('show', `${ref}:${arquivo}`))
      expect(antes.length, 'a referência precisa ter os imports de desenho').toBe(
        MODULOS_QUE_DESENHAM.length,
      )
      expect(importsQueDesenham(fonteDe(arquivo))).toEqual(antes)
    })
  }

  it('commit que introduziu o marcador sem pai: não há referência (o congelamento pula, não quebra)', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'p6-sem-pai-'))
    const g = (...args: string[]) =>
      gitEm(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args)
    try {
      g('init', '-q')
      writeFileSync(path.join(repo, 'a.tsx'), `if (${MARCADOR_DO_P6}) {}\n`)
      g('add', 'a.tsx')
      g('commit', '-q', '-m', 'raiz com o marcador')
      expect(refAnteriorAoP6('a.tsx', repo)).toBeNull()

      // com histórico anterior ao marcador, a referência é o pai dele
      writeFileSync(path.join(repo, 'b.tsx'), 'x\n')
      g('add', 'b.tsx')
      g('commit', '-q', '-m', 'b sem marcador')
      writeFileSync(path.join(repo, 'b.tsx'), `if (${MARCADOR_DO_P6}) {}\n`)
      g('commit', '-q', '-am', 'b ganha o marcador')
      const introduziu = g('log', '-1', '--format=%H').trim()
      expect(refAnteriorAoP6('b.tsx', repo)).toBe(`${introduziu}^`)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('a exceção é REAL nos dois lados: o resgate do ADR-030 está montado nas duas variantes', () => {
    for (const arquivo of [...ROTAS_CONGELADAS, ...PROPOSTAS]) {
      const fonte = fonteDe(arquivo)
      expect(fonte, arquivo).toContain("from '@/components/kit/ResgateDoEnvio'")
      // dentro do `<form>`, que é onde `useFormStatus` enxerga o envio
      const form = fonte.slice(fonte.indexOf('<form action={'), fonte.indexOf('</form>'))
      expect(form, `${arquivo}: o resgate precisa estar DENTRO do <form>`).toContain(
        '<ResgateDoEnvio',
      )
    }
  })

  it('o normalizador da exceção come o resgate — e NADA além dele', () => {
    const comResgate = [
      '  <form action={x}>',
      '    <button>Entrar</button>',
      '    {/* A9/ADR-030: linha 1',
      '        linha 2 */}',
      '    <ResgateDoEnvio />',
      '  </form>',
    ].join('\n')
    const semResgate = ['  <form action={x}>', '    <button>Entrar</button>', '  </form>'].join(
      '\n',
    )
    expect(semOResgate(comResgate)).toBe(semResgate)
    // idempotente: num bloco que nunca teve resgate, não tira nada
    expect(semOResgate(semResgate)).toBe(semResgate)
    // e um comentário JSX que NÃO apresenta resgate fica de pé
    const soComentario = '  {/* F0: deep link */}\n  <input name="next" />'
    expect(semOResgate(soComentario)).toBe(soComentario)
  })

  it('a proposta não tocou na CapaNoturna do kit (definir-senha e convite-expirado seguem nela)', () => {
    const kit = semComentarios(fonteDe('src/components/kit/capa-noturna.tsx'))
    expect(kit).toContain('export function CapaNoturna')
    expect(kit).not.toContain('proposta')
    for (const tela of ['src/app/definir-senha/page.tsx', 'src/app/convite-expirado/page.tsx']) {
      expect(semComentarios(fonteDe(tela))).toContain('CapaNoturna')
    }
  })
})
