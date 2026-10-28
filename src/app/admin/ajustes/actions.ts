'use server'

// AS AÇÕES DE /admin/ajustes (Onda da Agenda · A8).
//
// Uma só, por enquanto: mudar a política de remarcação de UMA professora. Os
// outros três blocos da tela são leitura (decisão do dono, registrada no goal)
// — janelas apontam para a agenda, mensagens são catálogo, integrações são
// estado.
//
// ── O QUE ESTA ACTION NÃO FAZ (Lei 3) ───────────────────────────────────────
// Ela não valida a faixa para decidir se grava: quem recusa 10000 horas é o
// banco, dentro de `admin_set_teacher_policy`. O que ela faz antes de chamar é
// só o suficiente para dar uma FRASE melhor do que a do banco quando a recusa é
// óbvia (campo vazio, número não numérico) — e, mesmo aí, a chamada seria
// recusada igual se a antecipação falhasse. Segunda gramática de validação não
// existe nesta casa.
//
// ── POR QUE `createAdminClient` E NÃO A SESSÃO ──────────────────────────────
// A RPC é `security definer` com `execute` REVOGADO de `authenticated`: só o
// `service_role` a executa (ver o cabeçalho da migration 20260729000100). O
// ator vai explícito no argumento — é ele que a trilha registra —, e quem o
// produz é `requireAdminId()`, que revalida o chamador a cada envio (D10:
// server action é endpoint público).
//
// ── O DESFECHO É TOAST, E NADA DELE ENCOSTA NA URL ──────────────────────────
// (Sol · rodada 1 do A8, grave 3.) A primeira versão terminava em
// `redirect('…?msg=…&n=Date.now()')`. `?msg=` é a PONTE DE CONVIVÊNCIA das telas
// velhas — tela nova não a usa —, e no caminho de falha o que ia para a barra de
// endereços era o erro cru do Postgres. Agora:
//   · a frase vai num cookie de vida curta (`@/lib/kit/recado` — peça do kit
//     desde o A5, parametrizada por SEÇÃO), e quem a pinta é o mesmo
//     `AvisoLegado` do kit (toast com JS, faixa `<noscript>` sem ele);
//   · a recusa do banco é TRADUZIDA por `fraseDaRecusaDoBanco` (módulo puro):
//     nome de coluna, de constraint e de função não são assunto da dona;
//   · a URL de volta fica limpa — nem recado, nem nonce, nem o que foi digitado.
//
// ── VOLTA DE ERRO ───────────────────────────────────────────────────────────
// O que a dona escolheu sobrevive à recusa pelo mecanismo de rascunho que a
// agenda já usa (`manter` + cookie `httpOnly`, `src/lib/admin/rascunho-do-
// formulario.ts`). A chave é POR PROFESSORA (`chaveDaPolitica`): a tela tem N
// formulários abertos, e o erro de um não pode preencher o outro.

import { redirect } from 'next/navigation'

import { requireAdminId } from '@/lib/auth/admin'
import { esquecerRascunho, gravarRascunho } from '@/lib/admin/rascunho-do-formulario'
import { createAdminClient } from '@/lib/supabase/admin'
import { ehPoliticaDeFeriado, fraseDaRecusaDoBanco } from '@/data/admin/ajustes-gramatica'
import {
  PONTE_LEGADA,
  destinoDaSecao,
  destinoDoRecado,
  gravarRecado,
} from '@/lib/kit/recado'

/** A seção desta tela — ela decide o cookie e o `path` estreito do recado. */
const SECAO = 'ajustes' as const

/** Volta com o desfecho no cookie. A URL não carrega recado nenhum. */
async function backTo(formData: FormData, msg: string): Promise<never> {
  // Ato CONCLUÍDO não deixa rascunho para trás: sem isto, um erro seguido de
  // acerto deixaria o cookie vivo e o próximo formulário nasceria preenchido.
  //
  // ⚠️ E APAGA SÓ O DELE (dívida (a) do A7). A faxina era cega: um acerto aqui
  // varria o cookie inteiro, inclusive o rascunho que a dona tinha deixado num
  // formulário da AGENDA noutra aba. O cookie é um só para o `/admin` todo, e
  // por isso "sucesso meu, gaveta minha" tem de valer também atravessando
  // seção. A chave é a mesma que o `falhou()` desta tela usa para GRAVAR.
  await esquecerRascunho(String(formData.get('rascunho') ?? '').trim())
  await gravarRecado(SECAO, msg)
  redirect(destinoDoRecado(SECAO, String(formData.get('back') ?? '')))
}

/** Volta de ERRO: o formulário reabre com o que ela escolheu (ver o cabeçalho). */
async function falhou(formData: FormData, msg: string): Promise<never> {
  // `destinoDaSecao` (porteiro puro) e não `destinoDoRecado`: quem tira `msg`/`n`
  // da query é o ramo de cima. Aqui a query é DESMONTADA logo abaixo para tirar
  // os campos do `manter`, e passar duas vezes pelo `URLSearchParams` reescreve
  // um endereço que já estava certo.
  const alvo = destinoDaSecao(
    SECAO,
    String(formData.get('back_erro') ?? '') || String(formData.get('back') ?? ''),
  )
  const [caminho, queryCrua = ''] = alvo.split('?')
  const p = new URLSearchParams(queryCrua)
  // A mesma higienização que `destinoDoRecado` faz no ramo de sucesso, aqui à
  // mão porque a query já está desmontada: voltar com o cookie escrito para um
  // endereço que ainda carrega a ponte legada pintaria DOIS recados. Em Ajustes
  // é no-op (o `back` desta tela não tem `msg`/`n`); a lista vem da peça do kit
  // para as duas pontas não divergirem.
  for (const k of PONTE_LEGADA) p.delete(k)

  const chave = String(formData.get('rascunho') ?? '').trim()
  const guardados: Record<string, string> = {}
  for (const campo of String(formData.get('manter') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const v = formData.get(campo)
    // Nada do que foi digitado encosta na URL (mesma régua do A4): o campo sai
    // da query e vai para o cookie de vida curta.
    p.delete(campo)
    if (typeof v === 'string' && v.trim() !== '') guardados[campo] = v
  }
  // Sempre escreve (mesmo vazio): a chamada com `{}` APAGA o rascunho anterior.
  if (chave) await gravarRascunho(chave, guardados)
  else await esquecerRascunho('')

  await gravarRecado(SECAO, msg)
  const query = p.toString().replace(/\+/g, '%20')
  // Concatenação e não template: o varredor de frases de `tests/portal-nav.test.ts`
  // lê os literais deste módulo, e `«…»?«…»` entraria na lista como se fosse
  // recado de tela.
  redirect(query ? caminho + '?' + query : caminho)
}

/**
 * Grava a política de remarcação de uma professora.
 *
 * Sucesso: "Política da professora atualizada." — frase ENUMERADA em
 * `src/lib/kit/tom-do-aviso.ts` (sem isso, o acerto sairia vermelho).
 */
export async function setTeacherPolicyAction(formData: FormData) {
  const ator = await requireAdminId()

  const teacher = String(formData.get('teacher_id') ?? '').trim()
  if (!teacher) {
    await falhou(formData, 'Falha: professora não identificada — recarregue a página.')
  }

  // CAMPO VAZIO NÃO É ZERO (médio 5 da rodada 1). `Number('')` é 0, e zero é uma
  // escolha VÁLIDA aqui — ela desliga a antecedência mínima. Apagar o campo para
  // redigitar e salvar por engano não pode publicar "dá para marcar até a hora
  // de começar": vazio é recusa, e zero continua possível, mas digitado.
  const cruDeHoras = String(formData.get('lead_hours') ?? '').trim()
  if (cruDeHoras === '') {
    await falhou(formData, 'Falha: informe a antecedência mínima em horas.')
  }
  // `Number` e não `parseInt`: "12abc" tem de ser recusado, não virar 12.
  const horas = Number(cruDeHoras)
  if (!Number.isInteger(horas)) {
    await falhou(formData, 'Falha: a antecedência mínima é um número inteiro de horas.')
  }

  const feriado = String(formData.get('holiday_policy') ?? '').trim()
  if (!ehPoliticaDeFeriado(feriado)) {
    await falhou(formData, 'Falha: escolha o que fazer com as aulas em feriado.')
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_set_teacher_policy', {
    p_teacher: teacher,
    p_lead_hours: horas,
    p_holiday_policy: feriado,
    p_actor: ator,
  })
  // O texto cru do banco NÃO chega à dona nem ao histórico do navegador.
  if (error) await falhou(formData, fraseDaRecusaDoBanco(error.message))

  await backTo(formData, 'Política da professora atualizada.')
}
