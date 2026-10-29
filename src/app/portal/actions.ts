'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { sendRescheduleEmails } from '@/lib/email/notify'
import { sendEmail, sendEmailWithOutcome } from '@/lib/email/send'
import { syncTeacherCalendarSoon } from '@/lib/google/sync'
import { evolutionChannel, evolutionConfigFromEnv } from '@/lib/notify/evolution'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ResultadoDaAcao } from '@/data/admin/action-result'
import { passwordMissing } from '@/lib/auth/password'
import { FALE_COM_A_GENTE } from '@/lib/contact'
import { parseBriefingForm } from '@/lib/briefing/parse'
import { atualizacaoDeBriefingPendente } from '@/lib/portal/data'
import { gravarFlash, limparFlash } from '@/lib/portal/flash'
import {
  FINALIDADE_PROFISSIONAL,
  HOBBIES_MIN,
  TOPICOS_PROFISSIONAIS_MIN,
  enunciadoDaChave,
  type TipoAluno,
  type VersaoBriefing,
} from '@/lib/briefing/schema'

/** As telas que mudam de conteúdo quando uma aula muda de lugar ou some. */
function revalidarAsAulas(instanceId?: string | null) {
  revalidatePath('/portal')
  revalidatePath('/portal/aulas')
  if (instanceId) revalidatePath(`/portal/aula/${instanceId}`)
}

/** O resultado da porta NOVA (ADR-025): frase + para onde a tela leva depois. */
type ResultadoComDestino = ResultadoDaAcao & { para?: string }

/**
 * A FRONTEIRA DA PORTA NOVA: cookie de flash + redirect (P4 · E6).
 *
 * Devolver `ResultadoDaAcao` para o componente exibir só funcionava COM
 * JavaScript — sem ele o React descarta o retorno da Server Action e a recusa
 * ficava invisível. Agora toda ação do portal termina aqui: a frase vai num
 * cookie `httpOnly` (nada de `?msg=` forjável nem de nonce na URL) e a pessoa é
 * levada para `para` — a mesma rota quando o ato falhou, a tela de destino
 * quando deu certo. Quem lê o cookie é a MOLDURA do portal (`RecadoDoPortal`,
 * montado pelo layout); ninguém o apaga — quem limpa é a expiração
 * (`src/lib/portal/flash.ts`).
 *
 * P5: "toda ação do portal" passou a ser literal. As últimas nove — resgate de
 * reposição, reserva e cancelamento de mentoria, ciência do canal, WhatsApp,
 * senha, briefing e re-briefing — largaram o `?msg=&n=`. Com isso morre a ponte
 * do M3 no portal inteiro: nenhuma tela do aluno lê `msg` da URL, e um link
 * forjado (`/portal?msg=Aula+cancelada.+✅`) deixou de conseguir fazer o portal
 * afirmar o que não aconteceu.
 */
async function comFlash(mensagem: string, para: string): Promise<never> {
  await gravarFlash(mensagem)
  redirect(para)
}

// O aluno chama a RPC com a PRÓPRIA sessão: posse/alçada/crédito/janela são decididos
// DENTRO do banco (D1/D10). A UI só traduz o erro para gente.
//
// P4: o MIOLO saiu da action e virou esta função — as duas portas o dividem. A
// remarcação (`/portal/remarcar`) e o resgate de crédito (`/portal/resgatar`)
// entram por aqui e terminam no MESMO cookie de flash desde o P5. Uma regra,
// duas portas: o que muda é para onde a pessoa volta, nunca o que a frase diz.
async function reservarHorario(formData: FormData): Promise<ResultadoComDestino> {
  const windowId = String(formData.get('window_id') ?? '')
  const instanceId = String(formData.get('instance_id') ?? '') || null
  const contractId = String(formData.get('contract_id') ?? '') || null
  // F5/M1-4: horário COMPUTADO (sem janela publicada) — o banco materializa a
  // janela e consome na MESMA transação; o marcador de degradação vai junto.
  const computedStarts = String(formData.get('starts_at_utc') ?? '') || null
  const computedTeacher = String(formData.get('teacher_id') ?? '') || null
  const googleDegraded = String(formData.get('google_degraded') ?? '') === '1'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: newInstanceId, error } =
    windowId
      ? await supabase.rpc('book_reschedule_window', {
          p_window: windowId,
          ...(instanceId ? { p_instance: instanceId } : { p_contract: contractId }),
        })
      : await supabase.rpc('book_computed_slot', {
          p_teacher: computedTeacher,
          p_starts_at_utc: computedStarts,
          ...(instanceId ? { p_instance: instanceId } : { p_contract: contractId }),
          p_google_degraded: googleDegraded,
        })
  if (error) {
    const m = error.message
    // QA 14/07/2026: a exclusion constraint do banco (class_instances_teacher_
    // no_overlap_excl) recusa horário que conflita com outra aula da professora —
    // a UI já filtra, mas a corrida (aula marcada entre o load e o clique) cai aqui.
    const friendly = m.includes('saldo')
      ? 'Você não tem crédito suficiente para este agendamento.'
      : m.includes('não está disponível')
        ? 'Esse horário acabou de ser reservado por outra pessoa — escolha outro.'
        : m.includes('aviso mínimo')
          ? `Essa aula está perto demais para remarcar — ${FALE_COM_A_GENTE}.`
          : m.includes('no_overlap') || m.includes('exclusion')
            ? 'Esse horário conflita com outra aula da professora — escolha outro.'
            : // issue #85: o banco recusa o horário calculado colado num horário
              // que a professora abriu para reposição (ele ficaria sem uso)
              m.includes('horário de reposição já publicado')
              ? 'Esse horário encosta num horário que a professora abriu para reposição — escolha outro.'
              : m.includes('antecedência')
              ? `Esse horário está perto demais — escolha um com mais antecedência ou ${FALE_COM_A_GENTE}.`
              : `Não foi possível concluir: ${m}`
    return { ok: false, mensagem: friendly }
  }

  // D14: e-mails APÓS o commit, best-effort — falha nunca desfaz a remarcação.
  if (instanceId) {
    try {
      await sendRescheduleEmails(
        createAdminClient(),
        { newInstanceId: String(newInstanceId), actorUserId: user.id },
        sendEmail,
      )
    } catch (err) {
      console.error('[emails de remarcação falharam]', err)
    }
  }

  // Construção total (14/07/2026): espelho WhatsApp da confirmação (e-mail 3) via
  // outbox — quem decide destinatário/opt-in é SQL (enqueue_reschedule_confirmation,
  // posse D10 dentro da função; consentimento re-checado no ENVIO). Best-effort:
  // vale para remarcação E resgate (os dois criam instância nova).
  try {
    await supabase.rpc('enqueue_reschedule_confirmation', {
      p_instance: String(newInstanceId),
    })
    // QA 14/07/2026: despacho IMEDIATO — sem isto a confirmação esperava a rodada
    // diária do Scheduled Task (10:30 UTC) e chegava horas depois da remarcação.
    // Best-effort: se falhar, a linha fica pendente e a rodada diária resolve.
    await dispatchOutbox(createAdminClient(), {
      email: { send: sendEmailWithOutcome },
      whatsapp: evolutionChannel(evolutionConfigFromEnv()),
    })
  } catch (err) {
    console.error('[confirmação WhatsApp não enfileirada]', err)
  }

  // ADR-017: reflexo IMEDIATO no Google Agenda da professora (fire-and-forget —
  // a janela consumida some, a aula nova aparece; a rodada diária cobre falha).
  try {
    const admin = createAdminClient()
    const { data: inst } = await admin
      .from('class_instances')
      .select('teacher_id')
      .eq('id', String(newInstanceId))
      .maybeSingle()
    if (inst) syncTeacherCalendarSoon(admin, inst.teacher_id)
  } catch (err) {
    console.error('[gcal sync pós-remarcação]', err)
  }

  // A VIA REAL DO DESFECHO (P4 · E1). O preview é consultivo por construção: ele
  // classifica no render e `reschedule_class_at` re-decide dentro da transação,
  // serializada. Duas abas de um contrato de casal com a última remarcação do
  // mês, e a segunda sai por crédito enquanto a tela dizia "não custa reposição".
  // Não dá para travar a franquia numa aba aberta — dá para CONTAR o que
  // aconteceu, e é o que a frase abaixo faz.
  let via: string | null = null
  if (instanceId) {
    const { data: viaLida } = await supabase.rpc('via_da_remarcacao', {
      p_instance: String(newInstanceId),
    })
    via = typeof viaLida === 'string' ? viaLida : null
  }

  revalidarAsAulas(instanceId)
  return {
    ok: true,
    mensagem: instanceId ? fraseDaRemarcacao(via) : 'Reposição agendada! ✅',
    para: '/portal',
  }
}

/** O recado da remarcação, com a via que o BANCO registrou. Via desconhecida
 *  (cortesia, ou a linha de audit fora do alcance) cai na frase de sempre — sem
 *  via nenhuma é melhor do que uma via inventada. */
function fraseDaRemarcacao(via: string | null): string {
  if (via === 'allowance')
    return 'Aula remarcada! ✅ (dentro da franquia do mês) Você recebe a confirmação por e-mail.'
  if (via === 'makeup_credit')
    return 'Aula remarcada! ✅ (usamos 1 crédito de reposição) Você recebe a confirmação por e-mail.'
  return 'Aula remarcada! ✅ Você recebe a confirmação por e-mail.'
}

/**
 * O RESGATE DE REPOSIÇÃO (`/portal/resgatar`) — a mesma porta das outras (P5).
 *
 * Era a última ação do portal a terminar em `?msg=` + nonce. O miolo continua
 * sendo `reservarHorario` (uma regra, duas portas); o que muda é que o recado
 * agora atravessa por cookie, como o das aulas — inclusive quando o acerto joga
 * o aluno em `/portal` e de lá num gate, que era onde a frase se perdia.
 *
 * A RPC que gasta o crédito (`book_reschedule_window`) segue INTOCADA: a
 * assinatura dela é chamada pelo site velho em produção (nota do P4 · E1).
 */
export async function bookWindowAction(formData: FormData): Promise<void> {
  const instanceId = String(formData.get('instance_id') ?? '') || null
  const contractId = String(formData.get('contract_id') ?? '') || null
  const back = instanceId ? `/portal/remarcar/${instanceId}` : `/portal/resgatar/${contractId}`
  const r = await reservarHorario(formData)
  await comFlash(r.mensagem, r.ok ? (r.para ?? '/portal') : back)
}

/** A PORTA NOVA da remarcação (P4): grava o recado em cookie e redireciona —
 *  o mesmo caminho com e sem JavaScript. */
export async function remarcarAulaAction(formData: FormData): Promise<void> {
  const instanceId = String(formData.get('instance_id') ?? '') || null
  const r = await reservarHorario(formData)
  // A recusa volta para a MESMA rota, SEM o horário escolhido: o motivo mais
  // comum dela é o horário ter sido tomado no meio do caminho, e reabrir a tela
  // na escolha antiga seria oferecer de novo o que acabou de falhar.
  await comFlash(
    r.mensagem,
    r.ok ? (r.para ?? '/portal') : instanceId ? `/portal/remarcar/${instanceId}` : '/portal',
  )
}

// F2/M2-3: o aluno cancela a PRÓPRIA aula. O clique é o aviso; a matriz D2 (no
// banco) decide crédito × perda. A tela de consequência já mostrou o desfecho
// esperado — aqui só executa, dispara o aviso e espelha o Google.
//
// P4: porta nova — cookie de uso único + redirect, sem `?msg=` na URL.
export async function cancelarMinhaAulaAction(formData: FormData): Promise<void> {
  const instanceId = String(formData.get('instance_id') ?? '')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.rpc('cancel_my_class', { p_instance: instanceId })
  if (error) {
    const m = error.message
    const friendly = m.includes('não está agendada')
      ? 'Essa aula já não está mais agendada.'
      : m.includes('já começou')
        ? `Essa aula já começou — ${FALE_COM_A_GENTE}.`
        : m.includes('acesso')
          ? 'Você não tem acesso a essa aula.'
          : `Não foi possível cancelar: ${m}`
    await comFlash(friendly, `/portal/cancelar/${instanceId}`)
  }

  // Aviso imediato (mesmo padrão da remarcação) + espelho no Google da professora.
  try {
    await dispatchOutbox(createAdminClient(), {
      email: { send: sendEmailWithOutcome },
      whatsapp: evolutionChannel(evolutionConfigFromEnv()),
    })
  } catch (err) {
    console.error('[aviso de cancelamento não despachado]', err)
  }
  try {
    const admin = createAdminClient()
    const { data: inst } = await admin
      .from('class_instances')
      .select('teacher_id')
      .eq('id', instanceId)
      .maybeSingle()
    if (inst) syncTeacherCalendarSoon(admin, inst.teacher_id)
  } catch (err) {
    console.error('[gcal sync pós-cancelamento]', err)
  }

  revalidarAsAulas(instanceId)
  await comFlash('Aula cancelada. Você recebe a confirmação por e-mail. ✅', '/portal/aulas')
}

// F6/M8-3: confirmar presença — flag INFORMATIVA (nunca trava nada).
// P4: porta nova (a página da aula não tem mais `?msg=`) e a pessoa fica ONDE
// está — confirmar presença não muda de tela, então acerto e recusa voltam para
// a própria aula.
export async function confirmarMinhaPresencaAction(formData: FormData): Promise<void> {
  const instanceId = String(formData.get('instance_id') ?? '')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { error } = await supabase.rpc('confirm_my_class', { p_instance: instanceId })
  if (error) await comFlash(`Não deu: ${error.message}`, `/portal/aula/${instanceId}`)
  revalidarAsAulas(instanceId)
  await comFlash('Presença confirmada — até lá! ✓', `/portal/aula/${instanceId}`)
}

// F10/M6-4: o mentorado cancela a PRÓPRIA reserva (até 24h antes) — o estorno
// formal e o aviso acontecem no banco; aqui só despacho imediato.
// P5: porta nova (cookie + redirect), sem `?msg=` na URL.
export async function cancelMyMentorshipBookingAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { error } = await supabase.rpc('cancel_my_mentorship_booking', {
    p_booking: String(formData.get('booking_id') ?? ''),
  })
  if (error) {
    const m = error.message
    const friendly = m.includes('24h')
      ? `Faltam menos de 24h para o encontro — ${FALE_COM_A_GENTE} para resolver isso junto.`
      : `Não deu: ${m}`
    await comFlash(friendly, '/portal/mentoria')
  }
  try {
    await dispatchOutbox(createAdminClient(), {
      email: { send: sendEmailWithOutcome },
      whatsapp: evolutionChannel(evolutionConfigFromEnv()),
    })
  } catch (err) {
    console.error('[aviso de cancelamento de mentoria]', err)
  }
  await comFlash('Reserva cancelada — seu crédito voltou. ✓', '/portal/mentoria')
}

// F7/M4-3: ciência do canal oficial no 1º acesso (timestamp auditado).
// Lote 26/07 (correção 3): o formulário devolve o `policy_version_id` do texto
// que a página RENDERIZOU e a RPC recusa se ele não for mais o vigente — o
// aceite prova o texto, não só o clique. Recusa = recarregar a tela com a
// versão nova, nunca gravar aceite de texto não lido.
export async function ackChannelNoticeAction(formData: FormData): Promise<void> {
  const policyVersionId = String(formData.get('policy_version_id') ?? '') || null
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { error } = await supabase.rpc('ack_channel_notice', {
    p_policy_version_id: policyVersionId,
  })
  if (error) {
    const amigavel = error.message.includes('politica-desatualizada')
      ? 'O combinado foi atualizado — leia o texto novo antes de continuar.'
      : 'Não deu para registrar agora. Tente de novo em instantes.'
    await comFlash(amigavel, '/portal/ciencia')
  }
  // SUCESSO APAGA A RECUSA QUE ELE RESOLVEU (varredura de onda, V2) — a mesma
  // régua de `briefingBack`/`atualizarBack`. O aceite recusado por política
  // desatualizada grava "leia o texto novo antes de continuar" num cookie de
  // 15s; quem relê e aceita em cinco segundos chegava ao `/portal` com essa
  // frase ainda pendurada, e a moldura a repintava — a pessoa via a recusa de
  // um ato que acabou de dar certo. `limparFlash` só apaga recado de tom ERRO,
  // então um sucesso vindo de outra aba continua intocado.
  await limparFlash()
  // e2e 19/07: sem número cadastrado, o aceite desemboca DIRETO no campo de
  // WhatsApp — levado até lá, o aluno preenche; "adicionar depois" não acontece.
  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_e164')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.whatsapp_e164) redirect('/portal/perfil?foco=whatsapp')
  redirect('/portal')
}

// F7/M4-4: o aluno edita o PRÓPRIO número (auditado no banco).
// P5: porta nova (cookie + redirect).
export async function updateMyWhatsappAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { error } = await supabase.rpc('update_my_whatsapp', {
    p_e164: String(formData.get('whatsapp_e164') ?? '').trim() || null,
  })
  // Correção 28/07: quem fala português com o aluno é aqui. O banco devolve
  // CHAVE (`whatsapp-obrigatorio`) ou frase técnica de formato; nenhuma das
  // duas pode chegar crua ao portal — é o padrão de `politica-desatualizada`
  // no aceite, agora também para este campo.
  await comFlash(
    !error
      ? 'Número atualizado. ✓'
      : error.message.includes('whatsapp-obrigatorio')
        ? 'Escreva o seu número — é por ele que a escola te avisa das aulas. Se você não quiser mais receber por aqui, fale com a gente.'
        : error.message.includes('número inválido')
          ? 'Confira o número: escolha o país e digite só o número local, com DDD.'
          : 'Não deu para salvar agora. Tente de novo em instantes.',
    '/portal/perfil',
  )
}

// F7/M4-4: troca de senha (a sessão atual autoriza — padrão do Supabase Auth).
export async function updateMyPasswordAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const password = String(formData.get('password') ?? '')
  // Item 6: a MESMA política do checklist vale aqui (UI nunca mente)
  const faltam = passwordMissing(password)
  if (faltam.length > 0)
    await comFlash(`Falha: a senha ainda precisa de ${faltam.join(', ')}.`, '/portal/perfil')
  const { error } = await supabase.auth.updateUser({ password })
  await comFlash(error ? `Não deu: ${error.message}` : 'Senha trocada. ✓', '/portal/perfil')
}

// QA 14/07/2026: updateWhatsappPrefsAction removida — o telefone/opt-in do aluno
// agora é lançado pelo admin no CADASTRO (convite/ficha), não no portal.

// Mentoria Personal Travel (handoff-fase5 §v): o aluno chama o wrapper de POSSE
// book_my_mentorship_session com a PRÓPRIA sessão — contrato, elegibilidade,
// capacidade e escada são decididos DENTRO do banco, sob os locks do motor.
// A UI só traduz o erro para gente (Lei 3).
export async function bookMentorshipSessionAction(formData: FormData): Promise<void> {
  const sessionId = String(formData.get('session_id') ?? '')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // P5: o recado vai por cookie e a pessoa volta para a lista de datas — o
  // mesmo caminho com e sem JavaScript.
  const back = (m: string): Promise<never> => comFlash(m, '/portal/mentoria')

  const { error } = await supabase.rpc('book_my_mentorship_session', { p_session: sessionId })
  if (error) {
    const m = error.message
    // 'status: full': quem chega depois do flip open→full recebe esse texto —
    // para o aluno é o mesmo "acabou de lotar".
    const friendly =
      m.includes('lotada') || m.includes('status: full')
        ? 'Essa data acabou de lotar — escolha outra.'
        : m.includes('elegível')
          ? 'Sua próxima mentoria ainda não está liberada.'
          : m.includes('threshold') || m.includes('regras de progresso')
            ? 'Falta definir o critério desta etapa — fale com a gente.'
            : `Não foi possível reservar: ${m}`
    await back(friendly)
  }
  await back('Mentoria reservada! ✅')
}

// ---------------------------------------------------------------------------
// M0b do cronograma (19/07/2026) — BRIEFING integrado: cada etapa salva um
// rascunho via RPC; o envio final valida TUDO no banco (etapas obrigatórias +
// Kolb completo) e calcula o estilo lá dentro (Lei 3). A action só monta o
// jsonb da etapa e traduz erros.
//
// Briefing v2 (28/07/2026): a montagem saiu daqui e virou chamada ao ÚNICO
// montador (`parseBriefingForm`) — o mesmo que a retaguarda da admin usa. O que
// sobra nesta action é o que ela sempre foi boa em fazer: antecipar o erro do
// banco com a linguagem da etapa em que a pessoa está. Antecipação NÃO é
// validação (Lei 3): quem recusa de verdade é `_briefing_validate_v2`.
// ---------------------------------------------------------------------------

const BRIEFING_URL = '/portal/briefing'

/**
 * Volta para a etapa — e, quando há recusa, com a frase no COOKIE (P5).
 *
 * A `?etapa=` continua na URL de propósito: ela não é recado, é ESTADO do
 * formulário (a pessoa recarrega a página e continua na etapa certa, e o botão
 * "voltar" do navegador faz o que promete). O que saiu da URL foi o `msg=&n=`,
 * que era recado — forjável por link e obrigado a carregar um nonce só para o
 * toast não se repetir.
 */
async function briefingBack(etapa: string | number, recado?: string): Promise<never> {
  // SEM recado é SUCESSO — e sucesso APAGA o recado velho (correção do P5). Sem
  // isto, quem errava na etapa 1, corrigia e avançava chegava na etapa 2 com a
  // frase da recusa que acabou de resolver: o cookie tem 15s de vida e a moldura
  // repinta o que encontrar. A proibição segue sendo apagar na LEITURA; aqui
  // quem limpa é o escritor, sobre o próprio recado.
  if (recado) await gravarFlash(recado)
  else await limparFlash()
  redirect(`${BRIEFING_URL}?etapa=${etapa}`)
}

/**
 * A régua desta linha: versão do questionário (rascunho v1 termina no v1) + ramo
 * do aluno. Leitura que FALHA não vira "adulto v2" por omissão — com a régua
 * errada a etapa inteira seria montada com as chaves erradas, então a action
 * para e devolve o erro.
 */
async function reguaDoBriefing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  etapa: number,
): Promise<{ versao: VersaoBriefing; tipo: TipoAluno }> {
  const [{ data: rows, error: erroB }, { data: eu, error: erroS }] = await Promise.all([
    supabase.from('briefings').select('schema_version').limit(1),
    supabase.from('students').select('student_type').limit(1),
  ])
  if (erroB || erroS)
    await briefingBack(etapa, `Falha ao abrir seu briefing: ${(erroB ?? erroS)!.message}`)
  return {
    versao: rows?.[0]?.schema_version === 1 ? 1 : 2,
    tipo: eu?.[0]?.student_type === 'child' ? 'child' : 'adult',
  }
}

/**
 * A TELA E A LINHA FALAM A MESMA VERSÃO? (revisão de integração, médio 3.)
 *
 * `/portal/briefing` renderiza os campos do v1 OU do v2 conforme a linha; a
 * action parseia o formulário com a régua que ela própria releu. Se a linha
 * mudou de versão no intervalo — a correção da admin, uma aba velha aberta
 * ontem, o botão "voltar" do navegador —, os dois lados discordam e o parse cai
 * na régua errada: o v2 procura `facil`/`dificil` num formulário que mandou
 * `facil_dificil`, e a resposta da pessoa some sem erro nenhum.
 *
 * A tela DIZ sob que versão foi desenhada (campo escondido) e a action confere.
 * Campo ausente também é divergência: não existe formulário legítimo do briefing
 * sem ele desde este lote.
 */
async function conferirVersaoDaTela(
  formData: FormData,
  versaoDaLinha: VersaoBriefing,
  etapa: number,
): Promise<void> {
  const daTela = Number(formData.get('versao') ?? 0)
  if (daTela !== versaoDaLinha)
    await briefingBack(etapa, 'Falha: a página estava desatualizada — recarregue e tente de novo.')
}

/** Antecipação por etapa — devolve a frase da recusa, ou null se pode salvar. */
function faltaNaEtapa(
  etapa: number,
  answers: Record<string, unknown>,
  versao: VersaoBriefing,
  tipo: TipoAluno,
): string | null {
  const secao = (chave: string) => (answers[chave] ?? {}) as Record<string, unknown>
  const lista = (o: Record<string, unknown>, k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((v) => typeof v === 'string' && v.trim()) : []
  const texto = (o: Record<string, unknown>, k: string) =>
    typeof o[k] === 'string' ? (o[k] as string).trim() : ''

  if (etapa === 3) {
    const i = secao('interesses')
    if (lista(i, 'hobbies').length < HOBBIES_MIN)
      return `Falha: escolha pelo menos ${HOBBIES_MIN} coisas que você gosta de fazer.`
    if (versao >= 2)
      for (const campo of ['leitura', 'filmes_series', 'musicas']) {
        if (texto(i, campo) === 'sim' && !texto(i, `${campo}_detalhe`))
          return `Falha: você respondeu “sim” em “${enunciadoDaChave(campo, versao)}” — conte quais.`
      }
    return null
  }

  if (etapa === 4) {
    const blocos = (secao('rotina').blocos ?? {}) as Record<string, unknown>
    if (Object.keys(blocos).length === 0)
      return 'Falha: marque pelo menos um horário em que você costuma ter tempo.'
    return null
  }

  if (versao < 2) return null

  if (etapa === 1) {
    if (lista(secao('historia'), 'contato').length === 0)
      return 'Falha: marque ao menos uma forma de contato que você já teve com o inglês.'
    return null
  }

  if (etapa === 2) {
    const o = secao('objetivos')
    if (tipo === 'child') {
      if (lista(o, 'para_que_ingles').length === 0)
        return 'Falha: marque ao menos uma resposta sobre para que o inglês vai servir.'
      return null
    }
    const finalidades = lista(o, 'finalidades') as string[]
    if (finalidades.length === 0) return 'Falha: marque ao menos uma finalidade para praticar inglês.'
    const principal = texto(o, 'finalidade_principal')
    if (!principal) return 'Falha: diga qual finalidade é a MAIS importante.'
    if (!finalidades.includes(principal))
      return `Falha: “${principal}” precisa estar entre as finalidades marcadas acima.`
    if (lista(o, 'onde_trava').length === 0)
      return 'Falha: marque ao menos um ponto onde você mais trava.'
    if (!texto(o, 'tempo_diario')) return 'Falha: diga quanto tempo por dia você tem para estudar.'
    if (
      finalidades.includes(FINALIDADE_PROFISSIONAL) &&
      lista(o, 'topicos_profissionais').length < TOPICOS_PROFISSIONAIS_MIN
    )
      return `Falha: você marcou “${FINALIDADE_PROFISSIONAL}” — descreva ao menos ${TOPICOS_PROFISSIONAIS_MIN} tópicos da sua vida profissional.`
    return null
  }

  return null
}

export async function saveBriefingStepAction(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const etapa = Number(formData.get('etapa') ?? 0)
  if (etapa < 1 || etapa > 5) await briefingBack(1)

  const { versao, tipo } = await reguaDoBriefing(supabase, etapa)
  await conferirVersaoDaTela(formData, versao, etapa)
  const { answers, kolb } = parseBriefingForm(formData, { versao, tipo })

  if (etapa === 5 && Object.keys(kolb ?? {}).length < 12)
    await briefingBack(5, 'Falha: responda as 12 perguntas do teste para continuar.')
  const falta = faltaNaEtapa(etapa, answers, versao, tipo)
  if (falta) await briefingBack(etapa, falta)

  const { error } = await supabase.rpc('save_briefing_draft', {
    // a etapa 5 só traz Kolb; mandar `{}` de respostas mergiria nada, mas null diz
    // a verdade ao banco (e é o que a RPC espera de "não mexi nas respostas")
    p_answers: Object.keys(answers).length ? answers : null,
    p_kolb_answers: kolb,
  })
  if (error) await briefingBack(etapa, `Falha ao salvar: ${error.message}`)
  await briefingBack(etapa + 1)
}

/* ---------------------------------------------------------------------------
 * RE-BRIEFING SEMESTRAL (sub-lote 4) — duas etapas, as mesmas peças da coleta.
 *
 * O contrato e o semestre NÃO vêm do formulário: são derivados aqui, da mesma
 * função que decide o card do Início (`atualizacaoDeBriefingPendente`). Campo
 * escondido com contract_id seria uma escolha de servidor devolvida pelo cliente
 * — e a posse teria de ser reconferida assim mesmo (o banco a confere de novo,
 * Lei 3; isto só evita a viagem inútil).
 * ------------------------------------------------------------------------- */

const ATUALIZAR_URL = '/portal/briefing/atualizar'

/**
 * A NUMERAÇÃO DA TELA (polimento do sub-lote 5).
 *
 * O banco recusa na numeração do BRIEFING COMPLETO — "etapa 2 (objetivos)",
 * "etapa 3 (interesses)" —, e está certo: `_briefing_validate_v2_secoes` é a
 * régua ÚNICA dos dois envios, e a frase dela serve às seis etapas da coleta.
 * Só que a atualização tem duas telas, 1 e 2: repassar a frase crua mandaria o
 * aluno procurar uma "etapa 3" que não existe aqui. Quem traduz é a TELA (o
 * banco não muda por causa de layout); os nomes das seções ficam, porque é por
 * eles que a pessoa se localiza.
 */
function naNumeracaoDaAtualizacao(msg: string): string {
  return msg
    .replace(/etapa 2 \(objetivos\)/g, 'etapa 1 (objetivos)')
    .replace(/etapa 3 \(interesses\)/g, 'etapa 2 (interesses)')
}

async function atualizarBack(etapa: 1 | 2, recado?: string): Promise<never> {
  // A tradução mora AQUI, e não em cada `if (error)`: nenhuma recusa do banco
  // chega à tela por outra porta, e caminho novo já nasce traduzido.
  // Sem recado é sucesso — e sucesso apaga o recado velho (mesma régua de
  // `briefingBack`: o erro da etapa 1 não pode sobreviver à correção dela).
  if (recado) await gravarFlash(naNumeracaoDaAtualizacao(recado))
  else await limparFlash()
  redirect(`${ATUALIZAR_URL}?etapa=${etapa}`)
}

async function reguaDaAtualizacao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  etapa: 1 | 2,
): Promise<{ contractId: string; tipo: TipoAluno }> {
  const [pendencia, { data: eu, error: erroAluno }] = await Promise.all([
    atualizacaoDeBriefingPendente(supabase),
    supabase.from('students').select('student_type').limit(1),
  ])
  if (pendencia.erro || erroAluno)
    await atualizarBack(etapa, 'Falha ao abrir sua atualização — tente de novo em instantes.')
  // `comFlash` termina em `redirect`, que LANÇA — mas o TypeScript não enxerga
  // isso através do `await` (o estreitamento por retorno `never` só vale para
  // chamada síncrona). Daí a variável: ela guarda o que já foi conferido.
  const pendente = pendencia.pendente
  if (!pendente) await comFlash('Não há atualização pendente por aqui.', '/portal')
  return {
    contractId: pendente!.contractId,
    tipo: eu?.[0]?.student_type === 'child' ? 'child' : 'adult',
  }
}

export async function saveBriefingUpdateStepAction(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { contractId, tipo } = await reguaDaAtualizacao(supabase, 1)
  // A atualização é SEMPRE v2 (as chaves e a régua são as do v2).
  const { answers } = parseBriefingForm(formData, { versao: 2, tipo })
  // A etapa 2 do briefing é "objetivos" — a antecipação de erro é a MESMA.
  const falta = faltaNaEtapa(2, answers, 2, tipo)
  if (falta) await atualizarBack(1, falta)

  const { error } = await supabase.rpc('save_briefing_update_draft', {
    p_contract: contractId,
    // só a seção desta etapa vai ao banco: campo perdido de outra etapa não
    // reescreve uma seção que esta tela nem mostrou
    p_answers: { objetivos: answers.objetivos ?? {} },
  })
  if (error) await atualizarBack(1, `Falha ao salvar: ${error.message}`)
  await atualizarBack(2)
}

export async function submitBriefingUpdateAction(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { contractId, tipo } = await reguaDaAtualizacao(supabase, 2)
  const { answers } = parseBriefingForm(formData, { versao: 2, tipo })
  // A etapa 3 do briefing é "interesses" — mesma antecipação.
  const falta = faltaNaEtapa(3, answers, 2, tipo)
  if (falta) await atualizarBack(2, falta)

  const salvo = await supabase.rpc('save_briefing_update_draft', {
    p_contract: contractId,
    p_answers: { interesses: answers.interesses ?? {} },
  })
  if (salvo.error) await atualizarBack(2, `Falha ao salvar: ${salvo.error.message}`)

  const { error } = await supabase.rpc('submit_briefing_update', { p_contract: contractId })
  if (error) {
    // O banco escreve a recusa na língua do aluno ("etapa 2 (objetivos): …") e
    // nomeia a SEÇÃO — é ela que decide para qual etapa a pessoa volta (o número
    // que vem na frase é o do briefing completo; `atualizarBack` o traduz).
    const m = error.message
    await atualizarBack(m.includes('(objetivos)') ? 1 : 2, `Falha: ${m}`)
  }
  await comFlash('Atualização enviada! Sua professora já vai ver. ✅', '/portal')
}

export async function submitBriefingAction(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { versao, tipo } = await reguaDoBriefing(supabase, 6)
  await conferirVersaoDaTela(formData, versao, 6)
  const { answers } = parseBriefingForm(formData, { versao, tipo })
  if (answers.livre) {
    const { error } = await supabase.rpc('save_briefing_draft', {
      p_answers: { livre: answers.livre },
    })
    if (error) await briefingBack(6, `Falha ao salvar: ${error.message}`)
  }

  const { error } = await supabase.rpc('submit_briefing')
  if (error) {
    const m = error.message
    // etapa faltando → leva a pessoa direto para ela. O v2 já nomeia a etapa na
    // própria mensagem ("etapa 2 (objetivos): …"); o v1 só cita a seção.
    const etapaDe = (s: string) => {
      const numerada = s.match(/etapa ([1-4])/)
      if (numerada) return Number(numerada[1])
      if (s.includes('questão')) return 5
      return s.includes('historia') ? 1 : s.includes('objetivos') ? 2 : s.includes('interesses') ? 3 : s.includes('rotina') ? 4 : 6
    }
    const friendly = m.startsWith('etapa ')
      ? // o v2 escreve a recusa na língua do aluno — repassar é melhor que resumir
        `Falha: ${m}`
      : m.includes('etapa obrigatória')
        ? 'Falha: ainda falta uma etapa — complete os campos abaixo.'
        : m.includes('questão')
          ? 'Falha: o teste de estilo está incompleto — responda as 12 perguntas.'
          : `Falha ao enviar: ${m}`
    await briefingBack(etapaDe(m), friendly)
  }
  await comFlash('Briefing enviado! Obrigado. ✅', BRIEFING_URL)
}
