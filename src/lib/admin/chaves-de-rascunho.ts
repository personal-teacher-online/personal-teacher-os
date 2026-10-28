// AS CHAVES DO RASCUNHO — puras, para os DOIS lados usarem a MESMA.
//
// Por que num arquivo próprio, separado de `rascunho-do-formulario.ts`: aquele
// importa `next/headers`, que é módulo SÓ de servidor — trazê-lo para um
// componente `'use client'` quebra o build (`next build` recusa, e com razão).
// Só que quem ESCREVE a chave é o formulário, no cliente (o campo oculto
// `rascunho`), e quem LÊ é a página, no servidor. As duas pontas precisam da
// mesma função, e nenhuma das duas precisa do pote de cookies para calculá-la.
//
// Regra de manutenção: aqui só entra função PURA de string. Qualquer coisa que
// toque em cookie mora no outro arquivo.

/** Cookie com o rascunho do último formulário que o banco recusou. */
export const RASCUNHO_COOKIE = 'rascunho_admin'

/**
 * Vida curta: ele existe para atravessar UM redirect e sobreviver a um F5 da
 * dona lendo o erro. 60s é folga para ler a frase e voltar ao campo, e curto
 * demais para o rascunho reaparecer numa visita seguinte.
 */
export const RASCUNHO_MAX_AGE_S = 60

/**
 * Caminho estreito: só as telas do admin recebem o cookie. O portal, o painel
 * da professora e as rotas públicas nunca o veem — nem no cabeçalho da
 * requisição.
 */
export const RASCUNHO_PATH = '/admin'

/** Balão da meia-hora vazia: a chave é o slot MAIS a intenção. */
export function chaveDoBalao(slot: string, intencao: string): string {
  return `slot:${slot}:${intencao}`
}

/**
 * Painel `?novo=…` da Agenda — MAIS o alvo que abriu o painel, quando existe.
 *
 * ── O DEFEITO QUE O ALVO CONSERTA (revisão independente do A4, médio 1) ─────
 * Os balões já tinham chave por slot + intenção (`chaveDoBalao`), mas os
 * painéis tinham uma chave por FORMULÁRIO — `painel:experimental` — e fechar o
 * painel não limpa o cookie (ele morre sozinho em 60s). Cenário medido: a
 * experimental de Maria em 04/08 14:00 é recusada; a dona fecha o painel, é
 * interrompida, e em menos de 60s abre um link salvo para 05/08 15:00. Nome,
 * professora, data e hora ANTIGOS venciam o `nd`/`nt` novo — e ela criava Maria
 * no horário errado, achando que o link tinha trazido o horário certo.
 *
 * `alvo` é a geometria que o link carrega ('yyyy-LL-ddTHH:mm', montado de
 * `nd`+`nt`). Rascunho de um alvo não preenche painel de OUTRO alvo, e painel
 * aberto pelo menu (sem alvo) não herda rascunho de slot nenhum. Painel sem
 * `nd`/`nt` mantém a chave curta de sempre.
 */
export function chaveDoPainel(qual: string, alvo?: string): string {
  return alvo ? `painel:${qual}@${alvo}` : `painel:${qual}`
}

/** Tratamento de período/férias. */
export const CHAVE_DO_PERIODO = 'periodo'

/**
 * Remarcar uma aula: a chave é DAQUELA aula (Sol · rodada 2 do A4, grave 6).
 * É por aqui que o `motivo` da cortesia — texto livre sobre a vida de alguém —
 * atravessa a tela sem passar pela barra de endereços.
 */
export function chaveDoRemarcar(instanceId: string): string {
  return `remarcar:${instanceId}`
}

/**
 * A MATRIZ DO DESFECHO daquela aula (A5/L3).
 *
 * Chave PRÓPRIA, e não a do `chaveDoRemarcar`: a mesma aula tem dois formulários
 * (remarcar e desfecho) com campos diferentes, e a tela da agenda pode ter
 * dezenas de balões — rascunho de um desfecho não pode preencher outro. O que
 * viaja aqui é o `off_note` (texto livre) e o `notified_at`, que é a hora de um
 * fato da vida de alguém: nenhum dos dois pode ir para a barra de endereços.
 */
export function chaveDoDesfecho(instanceId: string): string {
  return `desfecho:${instanceId}`
}

/**
 * O PAINEL "CANCELAR" DA FICHA daquela aula (revisão independente do A6, M2).
 *
 * Chave PRÓPRIA, e não `chaveDoDesfecho`: a mesma aula pode estar aberta no
 * balão da Agenda (matriz de cinco linhas, com `desfecho`/`off_kind`/`off_note`)
 * e no painel da ficha (seletor `cancelled_by`, sem tema) ao mesmo tempo — são
 * dois formulários com campos diferentes, e rascunho de um não pode preencher o
 * outro. O que viaja aqui é a hora do aviso (hora de um fato da vida de alguém)
 * e a escolha de canais; nada disso pode ir para a barra de endereços, que é
 * justamente onde a ponte `?msg=` da ficha ainda publica a FRASE.
 *
 * `RASCUNHO_PATH` é `/admin`, então o cookie chega a `/admin/alunos/<id>` como
 * chega a `/admin/agenda` — o transporte é o mesmo, só a gaveta é outra.
 */
export function chaveDoCancelamentoDaFicha(instanceId: string): string {
  return `ficha-cancelar:${instanceId}`
}
