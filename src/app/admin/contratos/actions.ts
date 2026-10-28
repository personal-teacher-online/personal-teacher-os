'use server'

import { redirect } from 'next/navigation'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'
import { requireAdminId } from '@/lib/auth/admin'
import { assinaturaLigada } from '@/lib/autentique/gate'
import { AVISO_DA_ASSINATURA_DESLIGADA } from '@/data/admin/contratos-gramatica'
import { POLICY } from '@/lib/policy'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * O recado da ação, pendurado na URL de destino. O separador é calculado:
 * destino que já tem query (`/admin/contratos/<id>?painel=…`) perderia o recado
 * inteiro com um `?` fixo, e a tela voltaria muda. Quem transforma isso em toast
 * é o `AvisoLegado` das telas novas (mesma convivência do M3).
 *
 * r7 nº 3 — ESTA PONTE É A SANCIONADA, e não um mecanismo velho sobrevivente.
 * `?msg=&n=` + `AvisoLegado` é exatamente o par aprovado no M3 para a ficha do
 * aluno (`src/app/admin/alunos/actions.ts` · `alunos/[id]/page.tsx`); o que o
 * aceite da onda proíbe são os popups de antes (`<details data-popup>`), não
 * esta travessia de recado entre a action e a tela.
 */
function comRecado(destino: string, msg: string): never {
  const sep = destino.includes('?') ? '&' : '?'
  redirect(`${destino}${sep}msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

/**
 * PARA ONDE A TELA QUE CHAMOU QUER VOLTAR (M4-2).
 *
 * As ações deste módulo nasceram servindo UMA tela (a lista velha), e por isso
 * terminavam num `redirect` fixo. O detalhe `/admin/contratos/[id]` usa os
 * MESMOS formulários e as MESMAS RPCs — só precisa voltar para si mesmo, senão
 * quem ajusta um crédito na ficha do contrato é cuspido na lista antiga.
 *
 * Nada de mutação mudou: o campo `back` é OPCIONAL. Hoje todos os painéis do
 * detalhe o mandam; o padrão continua sendo `/admin/contratos` porque ele é o
 * destino honesto de qualquer chamador que ainda não o mande — e, desde o M4-4,
 * esse endereço é um 308 para `/admin/alunos/contratos` que PRESERVA o `msg`
 * (mapa em `data/admin/contratos-legado.ts`), então o recado chega igual. O
 * prefixo `/admin` é obrigatório — `back` é dado de formulário, não destino
 * confiável (mesma régua de `voltaPara` em `alunos/actions.ts`).
 */
/*
 * A ANOTAÇÃO `const done: Responder` no início de cada ação não é enfeite: é ela
 * que faz o TypeScript entender que `done` interrompe o fluxo (ela redireciona).
 * Sem a anotação explícita — e num IDENTIFICADOR simples, não num objeto
 * desestruturado, que o compilador não aceita para isto — nada é estreitado
 * depois de `if (…) done(…)`, e o código seguinte volta a enxergar valores que
 * aquele caminho já descartou.
 */
type Responder = (msg: string, quando?: typeof FALHOU) => never

/**
 * O segundo argumento de `done`, e a única coisa que muda o destino (c12 · nº 8).
 *
 * Constante nomeada em vez de um `true` solto porque, na leitura,
 * `done('Falha: …', FALHOU)` diz o que aconteceu e `done('…', true)` não diz
 * nada.
 */
const FALHOU = { falhou: true } as const

/**
 * DOIS DESTINOS, e não um (c12 · nº 8).
 *
 * Antes havia só `back` — o detalhe limpo —, e a falha voltava para lá também. O
 * resultado é o defeito que o Sol pegou: a pessoa preenchia o Sheet de
 * encerramento (destino dos créditos, motivo, nome exato), errava uma letra na
 * confirmação, e a tela devolvia o DETALHE com um toast vermelho e o formulário
 * inteiro apagado. O recado dizia o que houve; a tela não dava onde consertar.
 *
 * Agora o formulário carrega dois endereços: `back` (o detalhe) e `back_erro`
 * (o próprio painel, com `?painel=…&alvo=…`). Sucesso vai para o primeiro,
 * falha para o segundo — e o Sheet reabre porque o painel É o endereço (regra 2
 * de `paineis.tsx`). O que ele NÃO faz é repovoar os campos: o painel do detalhe
 * é curto e a informação que ele pede está toda na tela de trás; guardar
 * rascunho de seis campos na URL para isso seria pagar caro por pouco. Quem
 * precisava disso era a etapa 2 da admissão, e lá o rascunho existe (c12 · nº 12).
 *
 * Sem `back_erro`, a falha cai no mesmo destino de sempre — os chamadores
 * antigos não quebram.
 */
function respondedor(formData: FormData): Responder {
  // `back` é dado de formulário, não destino confiável: o prefixo `/admin/` é
  // obrigatório nos dois campos (mesma régua de `voltaPara` em `alunos/actions.ts`).
  const limpar = (v: string, padrao: string) => (v.startsWith('/admin/') ? v : padrao)
  const destino = limpar(String(formData.get('back') ?? ''), '/admin/contratos')
  const destinoDoErro = limpar(String(formData.get('back_erro') ?? ''), destino)
  return (msg, quando) => comRecado(quando?.falhou ? destinoDoErro : destino, msg)
}

// CRIAR CONTRATO NÃO MORA MAIS AQUI (M4-4).
//
// `createContractAction` e `createGroupContractAction` morreram junto com a tela
// velha. As duas escreviam SOLTAS: a individual dava um `insert` direto em
// `contracts` (sem horário — "cria e ajusta depois"), e a de grupo fazia TRÊS
// escritas sem transação (grupo → membros → contrato), de modo que uma falha no
// meio deixava turma órfã no banco. A criação inteira é uma coisa só e virou uma
// coisa só: a RPC `admin_create_contract` (migration `20260727001100`), chamada
// pelo wizard (`admin/contratos/novo/actions.ts`) e pela admissão
// (`admin/alunos/novo/actions.ts`). Uma porta, uma transação, um `audit_log`.
//
// O que sobrou neste arquivo são as ações que o DETALHE do contrato usa —
// regras, renovar, encerrar, pausa/retomada, crédito, horários e assinatura.

/**
 * O nome do plano cabe em `TETO_DO_PLANO` caracteres (c14 · Sol 7.1).
 *
 * A REGRA é o CHECK `contracts_plan_name_len`; isto aqui só ANTECIPA a recusa
 * com uma frase legível — sem ele o painel devolveria o texto cru do Postgres.
 * `[...texto].length` conta caracteres, como o `char_length` do banco.
 */
function planoLongoDemais(plano: string): boolean {
  return [...plano].length > TETO_DO_PLANO
}

const RECADO_DO_PLANO_LONGO =
  `Falha: o nome do plano cabe em ${TETO_DO_PLANO} caracteres.`

// F4/M5-2: editar regras (prospectivo, auditado no banco).
export async function updateContractRulesAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const plano = String(formData.get('plan_name') ?? '').trim()
  if (planoLongoDemais(plano)) done(RECADO_DO_PLANO_LONGO, FALHOU)
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_update_contract_rules', {
    p_contract: String(formData.get('contract_id') ?? ''),
    p_plan_name: plano,
    p_allowance: Number(formData.get('allowance') ?? 0),
    p_min_notice: POLICY.minNotice,
    p_expiry_days: POLICY.expiryDays,
    p_school_fault_days: POLICY.schoolFaultDays,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done('Regras atualizadas (valem para os próximos atos).')
}

// F2 (Onda Financeiro): a mensalidade fixa que o previsto v3 soma. Vazio =
// despublicar (NULL explícito — o contrato volta à lista dos sem-mensalidade).
export async function setContractMonthlyValueAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const cru = String(formData.get('mensalidade') ?? '').trim()
  let cents: number | null = null
  if (cru !== '') {
    // "1.234,56" e "1234.56" valem; letra ou negativo, não (Lei 9: int cents).
    const reais = Number(cru.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
    if (!Number.isFinite(reais) || reais < 0) {
      done('Falha: informe a mensalidade em reais (ex.: 599,00) — ou deixe vazio para despublicar.', FALHOU)
    }
    cents = Math.round(reais * 100)
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_contract_monthly_value', {
    p_contract: String(formData.get('contract_id') ?? ''),
    p_cents: cents,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done(cents === null ? 'Mensalidade despublicada — o previsto deste contrato volta a 0.' : 'Mensalidade salva.')
}

// F4/M5-3 + M3-4: encerramento estendido com destinação explícita dos créditos.
export async function endContractAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const contractId = String(formData.get('contract_id') ?? '')
  const supabase = await createClient()

  // S2-12 (e2e): a destrutiva GRANDE exige digitar o nome exato — mesmo padrão
  // da anonimização.
  //
  // c13 · nº 5 — A COMPARAÇÃO SAIU DAQUI (Lei 3). O c12 já tinha tirado o nome
  // esperado do formulário (era um hidden: quem montava o POST escolhia os DOIS
  // lados) e o buscava no banco — mas em OUTRA consulta, fora da transação que
  // encerra. Entre ler o nome e encerrar cabe um `update students set
  // display_name`: quem digitou o nome de ontem passava, e quem digitou o de
  // hoje era recusado se a ficha tivesse sido renomeada. Agora o que a pessoa
  // digitou viaja como `p_confirm_name` e é conferido DENTRO da transação,
  // contra a linha já travada — e a frase da recusa (com o nome atual) é a do
  // banco. Um lugar só, sem janela.
  const dest = String(formData.get('dest_contract') ?? '') || null
  const writeoff = String(formData.get('writeoff_note') ?? '').trim() || null
  const { data, error } = await supabase.rpc('admin_end_contract', {
    p_contract: contractId,
    p_confirm_name: String(formData.get('confirm_name') ?? ''),
    p_dest_contract: dest,
    p_writeoff_note: dest ? null : writeoff,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  const r = data as { cancelled: number; transferred: number; written_off: number }
  done(
    `Contrato encerrado — ${r.cancelled} aula(s) futura(s) cancelada(s), ` +
      `${r.transferred} crédito(s) transferido(s), ${r.written_off} baixado(s).`,
  )
}

// F4/M5-1: renovação guiada — a costura acontece inteira no banco (ordem M5-a).
export async function renewContractAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const supabase = await createClient()

  /**
   * c13 · nº 6 — CAMPO VAZIO NÃO É CORTESIA.
   *
   * `Number(formData.get('hourly_rate') ?? 0)` transformava campo AUSENTE e
   * campo VAZIO em `0` — e desde o c12 o zero é caso legítimo (cortesia), então
   * o banco aceitava sem piscar. Resultado: um POST sem o campo (extensão que
   * come o input, formulário montado à mão, `required` do HTML contornado)
   * renovava o contrato de graça, em silêncio, e a próxima fatura é que
   * contaria a história. Cortesia é uma DECISÃO, e decisão se digita: só o "0"
   * escrito vale. Mesma régua já em vigor na etapa 2 da admissão (c12 · nº 11).
   */
  const valorBruto = String(formData.get('hourly_rate') ?? '').trim()
  const valor = Number(valorBruto.replace(',', '.'))
  if (valorBruto === '' || !Number.isFinite(valor) || valor < 0) {
    done('Falha: informe o valor da aula — cortesia é 0 explícito, não campo em branco.', FALHOU)
  }

  const plano = String(formData.get('plan_name') ?? '').trim()
  if (planoLongoDemais(plano)) done(RECADO_DO_PLANO_LONGO, FALHOU)

  const { error } = await supabase.rpc('admin_renew_contract', {
    p_old: String(formData.get('contract_id') ?? ''),
    p_switch_on: String(formData.get('switch_on') ?? ''),
    p_plan_name: plano,
    // Lei 9: dinheiro em CENTAVOS.
    p_hourly_rate_cents: Math.round(valor * 100),
    p_allowance: Number(formData.get('allowance') ?? 4),
    p_min_notice: POLICY.minNotice,
    p_expiry_days: POLICY.expiryDays,
    p_school_fault_days: POLICY.schoolFaultDays,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done('Contrato renovado — horários emendados na virada e créditos transferidos. ✓')
}

export async function createSlotAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const ianaTz = String(formData.get('iana_tz') ?? '').trim() || null
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_slot', {
    p_contract: String(formData.get('contract_id') ?? ''),
    p_weekday: Number(formData.get('weekday')),
    p_local_time: String(formData.get('local_time') ?? ''),
    p_duration_min: Number(formData.get('duration_min') ?? 45),
    // P1: grupo manda a âncora explícita; individual pode omitir (fuso do aluno)
    ...(ianaTz ? { p_iana_tz: ianaTz } : {}),
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done('Slot criado e aulas materializadas.')
}

export async function closeAndCreateSlotAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const supabase = await createClient()
  const newTz = String(formData.get('iana_tz') ?? '').trim() || null
  const { error } = await supabase.rpc('close_and_create_slot', {
    p_slot: String(formData.get('slot_id') ?? ''),
    p_new_weekday: Number(formData.get('weekday')),
    p_new_local_time: String(formData.get('local_time') ?? ''),
    // P1: troca de horário de grupo manda a âncora explícita
    ...(newTz ? { p_new_iana_tz: newTz } : {}),
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done(
    'Horário alterado: slot antigo fechado, aulas futuras dele canceladas (sem crédito) e novo horário materializado.',
  )
}

export async function adjustCreditAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const supabase = await createClient()
  const delta = Number(formData.get('delta'))
  const expires = String(formData.get('expires_on') ?? '')
  // F1 (M3-5): motivo obrigatório (o banco recusa sem) + duração do crédito.
  const durationRaw = Number(formData.get('duration_min'))
  const { data, error } = await supabase.rpc('admin_makeup_adjust', {
    p_contract: String(formData.get('contract_id') ?? ''),
    p_delta: delta,
    // c13 · nº 11: lançamento NEGATIVO não tem validade a informar — e mandá-la
    // assim mesmo punha no `audit_log` um `expires_on` que a RPC ignora, isto é,
    // um dado que parece decisão e não teve efeito nenhum. A tela esconde o
    // campo no negativo (`campos-reativos.tsx`); aqui fica a rede de baixo, para
    // o POST montado à mão.
    p_expires_on: delta > 0 ? expires || null : null,
    p_note: String(formData.get('note') ?? '').trim() || null,
    p_duration_min: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done(`Crédito ajustado (${delta > 0 ? '+' : ''}${delta}). Saldo novo: ${data}.`)
}


// F3-D10 (decisão do mantenedor, 12/07/2026): o crédito PAUSA junto com o contrato.
// As RPCs são o caminho abençoado para mexer em contracts.status; a retomada
// estende a validade dos créditos pelos dias pausados (tudo auditado no banco).
export async function pauseContractAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const supabase = await createClient()
  const { error } = await supabase.rpc('pause_contract', {
    p_contract: String(formData.get('contract_id') ?? ''),
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  // Painel final F3: mensagem fiel à semântica real — a pausa NÃO cancela as
  // aulas já criadas (somem do portal/agenda e não entram no extrato; a
  // retomada as cancela de vez e re-materializa a agenda).
  done(
    'Contrato pausado — novas aulas deixam de ser criadas e as já agendadas ficam ' +
      'suspensas (saem da agenda e do extrato; a retomada resolve). Créditos ' +
      'congelados, sem avisos de vencimento.',
  )
}

export async function resumeContractAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const supabase = await createClient()
  const { data: extended, error } = await supabase.rpc('resume_contract', {
    p_contract: String(formData.get('contract_id') ?? ''),
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done(
    `Contrato reativado — ${Number(extended ?? 0)} crédito(s) com validade estendida ` +
      'pelos dias pausados; aulas da janela da pausa canceladas (sem crédito) e a ' +
      'agenda futura re-materializada.',
  )
}

// B8 (construção total 14/07/2026): envio de contrato para assinatura via
// Autentique (client em src/lib/autentique — multipart GraphQL, sandbox por
// env). O espelho local nasce AQUI — desde o c14, pela RPC `admin_begin_signature`
// e ANTES da chamada externa (a admin perdeu o INSERT direto na tabela). Depois
// da reserva, o status evolui só por RPC: `admin_finish_signature` fecha o
// pedido (sent|failed) e `apply_autentique_event` (service_role) aplica o que o
// provedor disser — a admin não reescreve história de assinatura na mão.
export async function sendContractForSignatureAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  const actorId = await requireAdminId()
  const contractId = String(formData.get('contract_id') ?? '')
  const signerEmail = String(formData.get('signer_email') ?? '').trim().toLowerCase()
  // F4/M5-4: grupo assina em 2 e-mails
  const signerEmail2 = String(formData.get('signer_email_2') ?? '').trim().toLowerCase()
  const pdf = formData.get('pdf')
  if (!contractId || !signerEmail.includes('@')) done('Informe o contrato e um e-mail válido.', FALHOU)
  if (signerEmail2 && !signerEmail2.includes('@'))
    done('O segundo e-mail de signatário é inválido.', FALHOU)
  if (!(pdf instanceof File) || pdf.size === 0) done('Anexe o PDF do contrato.', FALHOU)
  if (pdf.size > 8 * 1024 * 1024) done('PDF grande demais (limite 8MB).', FALHOU)

  const { autentiqueConfigFromEnv, createDocumentForSignature, envioNaoCriouDocumento } =
    await import('@/lib/autentique/client')
  const cfg = autentiqueConfigFromEnv()
  if (!cfg) done('AUTENTIQUE_TOKEN ausente — configure no deploy (runbook §N).', FALHOU)

  const supabase = await createClient()
  // c14 · Sol 2.2: o `error` desta leitura NÃO é descartável. Sem ele, PostgREST
  // fora do ar (ou uma policy que mudou) devolvia `data = null`, e a ação dizia
  // "Contrato não encontrado" para um contrato que existe — diagnóstico errado
  // no lugar exato onde a pessoa precisa saber o que houve.
  const { data: contract, error: erroDoContrato } = await supabase
    .from('contracts')
    .select('id, plan_name, students!contracts_student_id_fkey(display_name)')
    .eq('id', contractId)
    .maybeSingle()
  if (erroDoContrato) done(`Falha ao ler o contrato: ${erroDoContrato.message}`, FALHOU)
  if (!contract) done('Contrato não encontrado.', FALHOU)

  /**
   * c14 · Sol 2.1 + 2.2 — RESERVA ANTES DE CHAMAR (o pré-check do c13 morreu).
   *
   * O QUE ESTAVA ERRADO. O c13 perguntava ao espelho se havia documento em
   * andamento e só então chamava o Autentique. É check-then-act: dois cliques
   * simultâneos passam os DOIS pela pergunta (nenhum enxerga a linha do outro,
   * que ainda não existe) e nascem dois documentos externos — dois e-mails, dois
   * contratos para o mesmo aluno assinar. E a leitura descartava o `error`:
   * falha de leitura virava "não há nada em andamento", isto é, permissão de
   * duplicar.
   *
   * O DESENHO NOVO, nos três atos que as RPCs da migration `20260727001400`
   * desenham:
   *   1. `admin_begin_signature` INSERE a reserva (`pending`, ainda sem id de
   *      documento). Quem arbitra a corrida é o índice único parcial do banco —
   *      um pedido VIVO por contrato —, não um `if` daqui: o segundo
   *      concorrente colide e recebe a recusa nomeada;
   *   2. só então o Autentique é chamado. O rastro local do que estamos fazendo
   *      já existe ANTES da criação externa, e é por isso que "documento criado
   *      lá fora sem registro aqui" deixou de ser possível — não é mais uma
   *      janela pequena, é uma ordem invertida;
   *   3. `admin_finish_signature` fecha a reserva: com o id do documento ela
   *      vira `sent`; sem ele (o Autentique recusou) vira `failed`, terminal, o
   *      que LIBERA a próxima tentativa — a que falhou não criou documento
   *      nenhum, então tentar de novo não duplica coisa alguma.
   */
  const { data: reserva, error: erroDaReserva } = await supabase.rpc('admin_begin_signature', {
    p_contract: contractId,
    p_actor: actorId,
  })
  if (erroDaReserva) done(`Falha: ${erroDaReserva.message}`, FALHOU)

  let doc: { documentId: string; signLink: string | null }
  try {
    doc = await createDocumentForSignature(cfg!, {
      name: `Contrato Personal Teacher — ${String(formData.get('doc_name') ?? '').trim() || contract!.plan_name}`,
      pdf: Buffer.from(await (pdf as File).arrayBuffer()),
      signerEmail,
      extraSignerEmails: signerEmail2 ? [signerEmail2] : [],
    })
  } catch (err) {
    /**
     * c15 · decisão A — ERRO AMBÍGUO NÃO MATA A RESERVA.
     *
     * O c14 fechava a reserva como `failed` em QUALQUER exceção, e `failed` é
     * terminal: ele LIBERA o próximo envio. Só que "o Autentique recusou" e "não
     * sei o que aconteceu lá fora" são fatos diferentes — um timeout, uma
     * conexão que cai na volta ou uma resposta truncada podem ter deixado um
     * documento criado, com e-mail já a caminho do aluno. Liberar o retry nessa
     * hora é fabricar o segundo contrato que a reserva existe para impedir.
     *
     * Agora só a recusa INEQUÍVOCA (a API respondeu, com corpo interpretado, que
     * não criou — ver `AutentiqueEnvioError` em `lib/autentique/client.ts`) vira
     * `failed`. O ambíguo deixa a reserva ABERTA, e a resolução é humana: o
     * painel de assinatura oferece anexar o id do documento (se ele existir no
     * Autentique) ou cancelar a reserva (se não existir).
     */
    if (!envioNaoCriouDocumento(err)) {
      done(
        `Não deu para saber o que aconteceu no Autentique: ${String(err)}. ` +
          'A reserva deste contrato ficou ABERTA de propósito — o documento pode ter sido criado. ' +
          'Abra o painel do Autentique: se o documento existir, anexe o id dele à reserva; se não existir, cancele a reserva. As duas coisas estão na seção Assinatura deste contrato.',
        FALHOU,
      )
    }
    // Recusa nomeada: não há documento lá fora. A reserva morre e o próximo
    // envio nasce limpo.
    const { error: erroDaLiberacao } = await supabase.rpc('admin_finish_signature', {
      p_signature: reserva as string,
      p_error: String(err),
      p_actor: actorId,
    })
    done(
      `O Autentique recusou o envio (nenhum documento foi criado): ${String(err)}` +
        (erroDaLiberacao
          ? ` — e a reserva local não pôde ser liberada (${erroDaLiberacao.message}): o próximo envio deste contrato vai recusar até isso ser resolvido pelo painel de assinatura.`
          : ' — pode tentar de novo.'),
      FALHOU,
    )
  }

  const { error } = await supabase.rpc('admin_finish_signature', {
    p_signature: reserva as string,
    p_document_id: doc!.documentId,
    p_actor: actorId,
  })
  // O documento JÁ existe no Autentique e o espelho não conseguiu anexá-lo. A
  // reserva fica ABERTA de propósito: ela é o estado honesto de "o documento
  // existe e o espelho não sabe" e trava um segundo envio às cegas. O id no
  // recado é a trilha para resolver — e resolver é COLAR esse id em "Anexar id
  // do documento", no painel de assinatura (c15: não há mais relógio que
  // reclame a reserva sozinho, e é bom que não haja).
  if (error) {
    done(
      `Documento criado no Autentique (${doc!.documentId}) mas o espelho local não anexou o id: ${error.message}. ` +
        'A reserva deste contrato continua aberta — copie esse id e use “Anexar id do documento” na seção Assinatura.',
      FALHOU,
    )
  }
  done(
    `Contrato enviado para assinatura ✔ (${signerEmail}${signerEmail2 ? ` + ${signerEmail2}` : ''})${cfg!.sandbox ? ' [sandbox]' : ''}`,
  )
}

/**
 * OS DOIS ATOS HUMANOS SOBRE UMA RESERVA ABERTA (c15 · decisão B).
 *
 * O c14 resolvia reserva presa com um relógio: passados 30 minutos, o próximo
 * envio a reclamava sozinho. O relógio morreu porque ele roubava reserva VIVA —
 * um envio lento (PDF grande, fila do provedor) que passasse do prazo tinha a
 * vaga tomada pelo clique seguinte, e aí nasciam dois documentos com a bênção do
 * banco. Trocar "documento duplicado" por "reserva presa" foi negócio ruim:
 * reserva presa é visível, chata e reversível.
 *
 * No lugar dele, duas portas — e as duas exigem que alguém tenha OLHADO o painel
 * do Autentique, porque é lá que está o fato que o app não tem:
 *   · o documento existe   → anexar o id à reserva (`admin_finish_signature`,
 *     a mesma RPC do caminho automático: o ato é o mesmo, casar reserva com
 *     documento, e por isso a regra é uma só — inclusive a reaplicação dos
 *     eventos de webhook que chegaram antes);
 *   · o documento não existe → cancelar a reserva (`admin_cancel_signature`,
 *     com frase de confirmação e motivo, os dois no `audit_log`).
 *
 * r7 nº 1 (GRAVE) — O GATE DESCE ATÉ AQUI. A ADR-029 §1 desligou a superfície de
 * assinatura na TELA (a seção some, os painéis redirecionam), e isso bastava
 * para quem clica. Só que Server Action é endpoint POST direto: um formulário
 * montado à mão, um `fetch` com o id da action ou uma aba aberta antes de a env
 * cair chegam nestas duas funções sem passar por tela nenhuma. Painel escondido
 * não é fronteira — a fronteira é a própria ação, e é ela que recusa. `send` e
 * `refresh` já recusavam (o `if (!cfg)` de `autentiqueConfigFromEnv()`, que lê a
 * MESMA env); estas duas não liam nada e iam direto para a RPC.
 */
export async function attachSignatureDocumentAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  const actorId = await requireAdminId()
  if (!assinaturaLigada()) done(`Falha: ${AVISO_DA_ASSINATURA_DESLIGADA}`, FALHOU)
  const documento = String(formData.get('provider_document_id') ?? '').trim()
  if (!documento) done('Falha: cole o id do documento que está no Autentique.', FALHOU)
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_finish_signature', {
    p_signature: String(formData.get('signature_id') ?? ''),
    p_document_id: documento,
    p_actor: actorId,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done('Documento anexado à reserva ✔ — o estado agora acompanha o Autentique.')
}

export async function cancelSignatureReservationAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  const actorId = await requireAdminId()
  // r7 nº 1: mesma guarda da irmã acima — a recusa é da AÇÃO, não da tela.
  if (!assinaturaLigada()) done(`Falha: ${AVISO_DA_ASSINATURA_DESLIGADA}`, FALHOU)
  const supabase = await createClient()
  // A frase e o motivo viajam CRUS: quem confere é `admin_cancel_signature`,
  // dentro da transação (Lei 3 — a tela antecipa, o banco decide).
  const { error } = await supabase.rpc('admin_cancel_signature', {
    p_signature: String(formData.get('signature_id') ?? ''),
    p_confirm: String(formData.get('confirm_phrase') ?? ''),
    p_reason: String(formData.get('reason') ?? ''),
    p_actor: actorId,
  })
  if (error) done(`Falha: ${error.message}`, FALHOU)
  done('Reserva cancelada — o contrato pode ser enviado de novo quando você quiser.')
}

// Opção A (14/07/2026 — a autenticação HMAC do webhook Autentique é Pro): em vez
// do webhook automático, a admin ATUALIZA o status sob demanda. Consulta o
// documento na API do Autentique (getDocumentSignatures) e aplica a transição
// pela MESMA RPC monotônica do webhook (apply_autentique_event) — o caminho de
// escrita continua sendo só o do banco (Lei 3/8). Custo zero, sem furar segurança.
export async function refreshSignatureStatusAction(formData: FormData) {
  const done: Responder = respondedor(formData)
  await requireAdminId()
  const documentId = String(formData.get('provider_document_id') ?? '')
  if (!documentId) done('Documento não informado.', FALHOU)

  const { autentiqueConfigFromEnv, getDocumentSignatures } = await import('@/lib/autentique/client')
  const cfg = autentiqueConfigFromEnv()
  if (!cfg) done('AUTENTIQUE_TOKEN ausente — configure no deploy (runbook §N).', FALHOU)

  let sig: { viewed: boolean; signed: boolean; rejected: boolean }
  try {
    sig = await getDocumentSignatures(cfg!, documentId)
  } catch (err) {
    done(`Não consegui consultar o Autentique: ${String(err)}`, FALHOU)
  }
  // Prioridade dos estados terminais (mesma da matriz do banco): assinado >
  // recusado > visualizado; nenhum → segue 'sent' (a RPC é no-op monotônica).
  const novo = sig!.signed ? 'signed' : sig!.rejected ? 'refused' : sig!.viewed ? 'viewed' : null
  // "Nada mudou" não é falha — é a resposta honesta de uma consulta. Volta para
  // o detalhe limpo, como qualquer outro sucesso.
  if (!novo) done('Ainda sem movimento nesta assinatura (nem visualizada).')

  // apply_autentique_event é service_role-only (a matriz de transição vive no
  // banco — migration 000400); a sessão admin não a executa, o admin client sim.
  const { data, error } = await createAdminClient().rpc('apply_autentique_event', {
    p_provider_document_id: documentId,
    p_new_status: novo,
    p_event: { source: 'manual_refresh', at: new Date().toISOString() },
  })
  if (error) done(`Falha ao aplicar: ${error.message}`, FALHOU)
  if (data === null) done('Este documento não está espelhado localmente.', FALHOU)
  const label: Record<string, string> = {
    signed: 'assinado ✓', refused: 'recusado', viewed: 'visualizado',
  }
  done(`Status atualizado: ${label[String(data)] ?? String(data)}.`)
}
