// GRAMÁTICA DA PAUTA (frente de conteúdo · M4) — o módulo PURO.
//
// Aqui mora o vocabulário do cadastro de criadores: as plataformas que o worker
// de pesquisa (M5) sabe coletar, o recorte de mercado BR/INT, o formato do
// handle, os endereços dos painéis e as frases — as de sucesso e as que
// traduzem uma recusa do banco em português.
//
// Por que separado da camada de dados: este arquivo não importa `server-only`
// nem o cliente do Supabase, então o formulário e os TESTES o leem sem arrastar
// o servidor junto. Mesma divisão de `ajustes-gramatica.ts` × `ajustes.ts`.
//
// 📌 O TESTE DE BANCO ITERA `PLATAFORMAS` (tests/pauta-fabrica.test.ts): esta
// lista e o CHECK da migration 20260801000100 são dois lados do mesmo contrato,
// e quem acrescentar uma rede aqui sem a migration aditiva descobre no vermelho,
// não em produção.

/* ========================================================================== */
/* Plataformas                                                                 */
/* ========================================================================== */

export const PLATAFORMAS = ['youtube', 'instagram', 'tiktok', 'x'] as const
export type PlataformaDaPauta = (typeof PLATAFORMAS)[number]

export const PLATAFORMA_ROTULO: Record<PlataformaDaPauta, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
}

export function ehPlataforma(v: string | undefined | null): v is PlataformaDaPauta {
  return typeof v === 'string' && (PLATAFORMAS as readonly string[]).includes(v)
}

/* ========================================================================== */
/* Mercado (a coluna `pais` do banco)                                          */
/* ========================================================================== */

/**
 * BR × INT é RECORTE DE MERCADO, não país de residência: o que a pauta persegue
 * é o equilíbrio entre a referência brasileira (mesma língua materna do público
 * da Teacher Vicky) e a internacional (formato e ritmo do mercado de fora). A coluna se
 * chama `pais` porque é assim que o goal do ciclo 1 a nomeou; o rótulo da tela
 * diz a verdade em português.
 */
export const PAISES = ['BR', 'INT'] as const
export type PaisDaPauta = (typeof PAISES)[number]

export const PAIS_ROTULO: Record<PaisDaPauta, string> = {
  BR: 'Brasil',
  INT: 'Internacional',
}

export function ehPais(v: string | undefined | null): v is PaisDaPauta {
  return typeof v === 'string' && (PAISES as readonly string[]).includes(v)
}

/* ========================================================================== */
/* Tipo e tier (Leva 1 do Estúdio v2 · migration 20260803000200)               */
/* ========================================================================== */

/**
 * O TIPO separa o criador-pessoa da conta de empresa/marca. A lista da Teacher Vicky
 * (pergunta 5 do radar) traz "contas grandes e empresas" — e o radar precisa
 * saber quem é quem para ler a velocidade de cada um com a régua certa.
 */
export const TIPOS = ['criador', 'empresa'] as const
export type TipoDaPauta = (typeof TIPOS)[number]

export const TIPO_ROTULO: Record<TipoDaPauta, string> = {
  criador: 'Criador',
  empresa: 'Empresa',
}

export function ehTipo(v: string | undefined | null): v is TipoDaPauta {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}

/**
 * O TIER é a faixa de ALCANCE da conta (decisão do dono, 03/08): grande, média
 * ou nicho. NULL é estado legítimo — "sem classificação" — porque classificar
 * exige OLHAR a conta (régua do M4: zero palpite), e as contas que já existiam
 * quando a coluna nasceu não ganham faixa por default.
 */
export const TIERS = ['grande', 'media', 'nicho'] as const
export type TierDaPauta = (typeof TIERS)[number]

export const TIER_ROTULO: Record<TierDaPauta, string> = {
  grande: 'Grande',
  media: 'Média',
  nicho: 'Nicho',
}

export function ehTier(v: string | undefined | null): v is TierDaPauta {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v)
}

/* ========================================================================== */
/* Handle                                                                      */
/* ========================================================================== */

/**
 * O FORMATO CANÔNICO, o mesmo do CHECK `content_creators_handle_formato`.
 *
 * Sem `@`, sem espaço, sem URL: o worker do M5 monta endereço de API a partir
 * deste texto, e ' escola ' — que passaria num simples "não vazio" — nem colide
 * com 'escola' no índice único (`lower(handle)` de dois textos diferentes é
 * diferente) nem resolve na API. A tela normaliza o que dá para normalizar
 * (`normalizarHandle`) e o banco recusa o resto.
 *
 * URL colada é RECUSADA, não adivinhada (decisão do M4): as quatro plataformas
 * têm formas distintas de endereço (`/@handle`, `/c/nome`, `/channel/UC…`), e
 * `channel/UC…` sequer é um handle. Errar a adivinhação grava lixo silencioso no
 * cadastro que alimenta a pesquisa; recusar custa dois segundos de quem cadastra.
 */
export const HANDLE_FORMATO = /^[A-Za-z0-9._-]+$/

/** O que a tela conserta sozinha: espaço em volta e o `@` que todo mundo copia junto. */
export function normalizarHandle(cru: string | undefined | null): string {
  return (cru ?? '').trim().replace(/^@+/, '').trim()
}

export function ehHandle(v: string | undefined | null): boolean {
  return typeof v === 'string' && HANDLE_FORMATO.test(v)
}

/* ========================================================================== */
/* Endereços e painéis                                                         */
/* ========================================================================== */

export const CASA_DA_PAUTA = '/admin/conteudo/pauta'

export const PAINEIS = ['novo', 'editar'] as const
export type PainelDaPauta = (typeof PAINEIS)[number]

export function ehPainelDaPauta(v: string | undefined | null): v is PainelDaPauta {
  return typeof v === 'string' && (PAINEIS as readonly string[]).includes(v)
}

/** Painel É endereço (régua dos painéis da casa): abrir é navegar, fechar é voltar. */
export function enderecoDoPainel(painel: PainelDaPauta, alvo?: string): string {
  const base = `${CASA_DA_PAUTA}?painel=${painel}`
  return alvo ? `${base}&alvo=${encodeURIComponent(alvo)}` : base
}

/** A chave do rascunho do formulário (o que sobrevive a uma volta de erro). */
export function chaveDoCriador(alvo: string): string {
  return `pauta-criador:${alvo}`
}

/**
 * As frases de DESFECHO não moram aqui, e é de propósito: quem as escreve é
 * `src/app/admin/conteudo/pauta/actions.ts`, em literais, porque o varredor de
 * `tests/portal-nav.test.ts` lê a FONTE daquele módulo para cobrar a
 * classificação de cada uma em `tom-do-aviso.ts`. Frase importada de cá sairia
 * do alcance do varredor — e frase de acerto fora da lista de tom sai VERMELHA.
 */

/* ========================================================================== */
/* Recusas do banco                                                            */
/* ========================================================================== */

const RECUSAS_DO_BANCO: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /content_creators_plataforma_handle_unique|duplicate key/i,
    'Falha: esse @ já está cadastrado nessa plataforma. Procure-o na lista — pode estar desativado.',
  ],
  [
    /content_creators_handle_formato/i,
    'Falha: escreva só o @ do perfil, sem link e sem espaços (ex.: englishinbrazil).',
  ],
  [
    /content_creators_plataforma_check/i,
    'Falha: escolha uma das plataformas da lista.',
  ],
  [/content_creators_pais_check/i, 'Falha: escolha se o criador é do Brasil ou internacional.'],
  [/content_creators_nome_check/i, 'Falha: escreva o nome do criador.'],
  [
    // O NOT NULL recusa ANTES do CHECK nomeado (achado 7 do Sol pré-apply):
    // `tipo` explícito em NULL produz "null value in column tipo", e sem esta
    // alternativa a frase cairia na recusa desconhecida.
    /content_creators_tipo_check|null value in column "?tipo"?/i,
    'Falha: o tipo é criador ou empresa — escolha um dos dois.',
  ],
  [
    /content_creators_tier_check/i,
    'Falha: o tier é grande, média ou nicho — ou fica sem classificação.',
  ],
  [
    // As colunas de medição são do robô (grant por coluna na migration). Se esta
    // frase aparecer, alguém tentou digitar número no cadastro.
    /permission denied|medicao_shape/i,
    'Falha: as métricas são preenchidas pelo robô de pesquisa — o cadastro não as edita.',
  ],
  [
    /não se apaga/i,
    'Falha: criador não se apaga. Desative-o — o histórico da pauta continua de pé.',
  ],
]

export const RECUSA_DESCONHECIDA =
  'Falha: não consegui salvar agora. Nada foi alterado — tente de novo em alguns instantes.'

/** Todas as frases que esta tela pode dizer quando o banco recusa (para teste). */
export const FRASES_DE_RECUSA: readonly string[] = [
  ...RECUSAS_DO_BANCO.map(([, frase]) => frase),
  RECUSA_DESCONHECIDA,
]

export function fraseDaRecusaDoBanco(cru: string | null | undefined): string {
  const texto = (cru ?? '').trim()
  for (const [marca, frase] of RECUSAS_DO_BANCO) if (marca.test(texto)) return frase
  return RECUSA_DESCONHECIDA
}
