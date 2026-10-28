/**
 * O CORTE DA ABA PERSONAL TRAVEL — uma constante, dois consumidores.
 *
 * Nota ≥ limiar entra na aba PT (ADR-033 decisão 3, régua ancorada: 80–100
 * nativa, 60–79 adaptável, <60 forçada/irrelevante). Parâmetro de engenharia
 * com decisão declarada, no molde do `LIMIAR_DEDUP`: revisável aqui, numa
 * linha, quando a régua real da conta pedir.
 *
 * ── POR QUE ELE MORA NUM ARQUIVO SÓ PARA ELE (Leva 6.2) ─────────────────────
 * A tela lê o limiar por `src/data/admin/radar-gramatica.ts`, que reexporta
 * daqui; o WORKER passa o mesmo número à RPC do digest, para o aviso do lote
 * contar "em destaque" exatamente como o radar conta. O worker é Node puro
 * (imports relativos, sem o alias `@/`), então ele não consegue importar a
 * gramática — e arrastar a config do robô para dentro da gramática colocaria o
 * catálogo de atores do Apify no bundle do navegador. Um módulo sem imports
 * resolve os dois lados sem mentir sobre a fonte.
 */
export const LIMIAR_ABA_PT = 60
