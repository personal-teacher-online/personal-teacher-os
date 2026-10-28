// FONTE ÚNICA DE MARCA (Onda 1 · M1, item 5 das Fundações transversais).
//
// Os hexes da paleta oficial da dona (brand/Paleta de Cores.jpg), as
// derivações usadas sobre papel e as strings que se repetem em tela moram
// AQUI. O `globals.css` não pode importar TypeScript, então a garantia de que
// as duas pontas dizem a mesma coisa é MECÂNICA: `tests/onda1-fundacoes.test.ts`
// lê o `:root` do CSS e falha se um hex divergir deste arquivo. Mudar a cor em
// um lugar só = suíte vermelha.
//
// MARTELO DE 26/07 (D10 e D7): o dono decidiu VENDO, na bancada, e a bancada
// morreu junto com a decisão. O acento é o DUO **Periwinkle + Turquesa**
// (base periwinkle no texto/ação, turquesa como 2º acento de realce) e a
// variante é a **B, "mais marca"** — que deixou de ser variante e virou o
// comportamento único do admin. Não existem mais temas alternativos, atributo
// `[data-ac]`, `[data-variant]` nem alternador: o tema é este.
//
// E-mails migram em onda futura (eles exigem hex inline por limitação dos
// clientes; hoje repetem estes valores à mão).

/** As 4 cores da paleta oficial, no tom VIVO como saíram do arquivo da marca. */
export const PALETA_OFICIAL = {
  roxo: '#B35BD9',
  periwinkle: '#8488D9',
  ceu: '#48BED9',
  turquesa: '#2BD9D9',
} as const

/**
 * O TEMA — quatro papéis por acento, nunca intercambiáveis:
 *
 * · `deep`  — TEXTO, link, ação primária, número-chave. Contraste AA (≥ 4,5:1)
 *   garantido sobre `--paper-0`, sobre `--paper-50` E sobre o próprio `tint`
 *   (há texto deep sobre tint: o cartão-destaque e o número-chave da variante
 *   que virou padrão). Conferido por teste.
 * · `deepHover` — o `deep` ESCURECIDO, para o hover da ação primária (revisão
 *   adversarial nº 1, C7). O hover era `filter: brightness(1.15)`, que CLAREIA:
 *   com texto branco por cima, o contraste caía abaixo de AA justo no estado em
 *   que o dedo está no botão. Escurecer nunca piora contraste, então o realce
 *   virou token explícito e o `filter` morreu.
 * · `vivid` — PREENCHIMENTO e realce (marca de nav ativa, barra, bolinha).
 *   Nunca texto: o tom vivo da marca não passa AA sobre papel.
 * · `tint`  — LAVAGEM de fundo (cabeçalho de grupo, cartão-destaque, nav ativa).
 *
 * `ac2` é o SEGUNDO acento do duo: entra só como realce (tendência, etiqueta de
 * nível), nunca como ação primária.
 */
export interface TemaDeAcento {
  readonly deep: string
  readonly deepHover: string
  readonly vivid: string
  readonly tint: string
  readonly ac2: {
    readonly deep: string
    readonly deepHover: string
    readonly vivid: string
    readonly tint: string
  }
}

// `deepHover` = o deep com 85% da luminância de cada canal (mesmo matiz, um
// degrau mais escuro). Contrastes conferidos por teste, nos três fundos e com
// branco por cima.
//
// Nota de AA preservada do estudo de D10: turquesa foi escurecido de #0B7F7F
// (4,51:1 sobre --paper-50 e 4,30:1 sobre o próprio tint — reprovado) para
// #0B7979 → 5,22 / 4,88 / 4,65, mesmo matiz e saturação, só luminância. O
// periwinkle passou como proposto e ficou intocado.
const PERI = { deep: '#4A50B5', deepHover: '#3F449A', vivid: PALETA_OFICIAL.periwinkle, tint: '#EDEEFA' } as const
const TUR = { deep: '#0B7979', deepHover: '#096767', vivid: PALETA_OFICIAL.turquesa, tint: '#E2F6F5' } as const

/** O tema do produto (D10 martelada em 26/07): Periwinkle + Turquesa. */
export const TEMA: TemaDeAcento = { ...PERI, ac2: TUR }

/**
 * CLONAGEM TUTORBIRD (26/07/2026) — os tons que a anatomia clonada exigiu e que
 * o tema de acento não tinha. Mesma mecânica dos hexes acima: a outra ponta é o
 * `:root` do `globals.css`, e `tests/onda1-fundacoes.test.ts` falha se as duas
 * divergirem ou se o contraste cair.
 *
 * TRILHO (`bg`/`hover`) — o TutorBird pinta a sidebar de teal sólido `#25A3AF`
 * e escreve branco por cima: ~3:1, reprovado em AA. Clonamos a anatomia e
 * consertamos o contraste. O fundo é um periwinkle MÉDIO entre o vivo da marca
 * (#8488D9) e o deep do tema (#4A50B5), escolhido por cálculo:
 *
 *   #5A5FC4 → L = 0,1434 → branco = 1,05 / 0,1934 = **5,43:1**  (fundo)
 *   #6469C8 → L = 0,1698 → branco = **4,78:1**                  (hover, mais
 *             claro que o fundo — a mesma relação medida no TutorBird)
 *   #4A50B5 → L = 0,1053 → branco = **6,76:1**                  (ATIVO; é o
 *             próprio `TEMA.deep`, ~27% menos luminância que o fundo, que é o
 *             "≈20% mais escuro" deles em termos perceptuais)
 *
 * Por isso o ativo NÃO ganha hex novo: reusar o `deep` mantém uma cor só
 * mandando no "isto está selecionado" — trilho, botão e número-chave.
 *
 * BANDA — a faixa de topo deles é `#DCF5F7`, ~13–16% do teal sólido dissolvido
 * em branco. Repetir a proporção com o nosso periwinkle daria ~#EFEFFA, ou
 * seja, o próprio `tint` (#EDEEFA), que ao lado de cartões brancos desaparece
 * (o periwinkle tem menos croma que o teal). A banda ganhou tom próprio, ~22%
 * do vivo sobre branco: ink-900 14,5:1 · ink-600 7,0:1 · ac-deep 5,4:1.
 */
export const CLONE = {
  railBg: '#5A5FC4',
  railHover: '#6469C8',
  /** o item ativo do trilho é o `deep` do tema, não um tom novo */
  railActive: PERI.deep,
  band: '#E3E4F8',
} as const

/**
 * PONTE DE COR (Lote 6 · G2, 26/07/2026) — o roxo herdado morreu no PAPEL.
 *
 * As telas ainda não reconstruídas só falam os tokens legados `--brand-*`, e
 * eles carregavam o roxo antigo (#7E36A3 texto / #9333C9 realce): botão
 * "＋ Cadastrar aluno", stepper do wizard e anel de foco do CityPicker
 * destoavam do shell periwinkle novo, tela por tela. A correção não mexe em
 * JSX nenhum — muda o VALOR dos tokens no `globals.css`, que passam a apontar
 * para esta mesma família:
 *
 *   --brand-700 → TEMA.deep    (#4A50B5)  texto/link/ação primária
 *   --brand-600 → CLONE.railBg (#5A5FC4)  realce, hover e anel de foco
 *
 * As sombras (`--shadow-card`/`--shadow-pop`) e o `--glow-brand` foram
 * retintados na mesma família. `tests/onda1-fundacoes.test.ts` (§ponte de cor)
 * é quem trava as duas pontas e confere o contraste AA de cada par usado.
 *
 * O QUE NÃO ENTRA NA PONTE: `PALETA_OFICIAL` (acima) é fato da marca e não
 * muda; o roxo #B35BD9 segue vivo como `--accent-purple` na capa noturna, no
 * fio-assinatura e nos e-mails (que repetem hex à mão e migram em onda futura).
 * As tintas por professora (`--t0-fill` roxo da dona, etc.) são escala
 * CATEGÓRICA, não marca: ficaram como estavam.
 */

/* ---------------------------------------------------------------- strings */

export const MARCA = {
  escola: 'Personal Teacher',
  /** subtítulo do trilho do admin */
  admin: 'Administração',
  simboloBranco: '/brand/simbolo-branco.png',
} as const

/** Fuso do NEGÓCIO (Lei 1): a escola opera em Cuiabá. */
export const BUSINESS_TZ = 'America/Cuiaba'
