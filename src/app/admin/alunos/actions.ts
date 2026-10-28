'use server'

import { redirect } from 'next/navigation'
import {
  concluirBloqueioDeLogin,
  mensagemDaAnonimizacaoTravada,
  mensagemDaRetomadaTravada,
} from '@/lib/admin/auth-cleanup'
import { confirmarLocalizacao } from '@/lib/admin/confirmar-localizacao'
import { ehSecaoBriefing, montarPatchDeRevisao } from '@/lib/briefing/leitura'
import { nivelValido } from '@/data/admin/alunos-grupos'
import { tipoDeAlunoValido } from '@/data/admin/ficha-gramatica'
import { requireAdminId } from '@/lib/auth/admin'
import { provisionStudent } from '@/lib/auth/provision'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * O recado da ação velha, pendurado na URL de destino (o `AvisoLegado` das
 * telas novas transforma em toast). O separador é calculado: destino que já
 * tem query — `?aba=creditos`, `?novo=1&s=4&aluno=…` — perdia o recado inteiro
 * com um `?` fixo, e a tela voltava muda.
 */
function comRecado(destino: string, msg: string): never {
  const sep = destino.includes('?') ? '&' : '?'
  redirect(`${destino}${sep}msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

function done(msg: string): never {
  comRecado('/admin/alunos', msg)
}

/**
 * Para onde a TELA que chamou quer voltar (M3-3): o convite acontece na aba
 * Convites e no wizard de admissão, não só na lista. Sem isto, quem reenvia um
 * convite pela aba Convites era jogado no hub e perdia o lugar. Prefixo
 * `/admin` obrigatório — `back` é dado de formulário, não destino confiável.
 */
function voltaPara(formData: FormData): string | null {
  const back = String(formData.get('back') ?? '')
  return back.startsWith('/admin') ? back : null
}

/**
 * Os três campos de cadastro do M3-c5 · D1, prontos para entrar no `insert`/
 * `update` de `students`. Um lugar só porque são os mesmos no wizard e na
 * edição — e porque a regra do tipo (só 'child'/'adult', espelho do CHECK do
 * banco) não pode existir em duas versões.
 *
 * Nascimento e origem são SEMPRE opcionais, inclusive para criança: não há
 * regra de negócio pendurada neles, e inventar uma exigência que ninguém pediu
 * trava a admissão de um aluno real por um dado que a dona ainda não tem.
 * Vazio grava `null` — apagar o campo é um gesto legítimo.
 */
function camposDoCadastro(formData: FormData) {
  const tipo = String(formData.get('student_type') ?? '').trim()
  const nascimento = String(formData.get('birth_date') ?? '').trim()
  const origem = String(formData.get('referral_source') ?? '').trim()
  return {
    ...(tipoDeAlunoValido(tipo) ? { student_type: tipo } : {}),
    birth_date: nascimento || null,
    referral_source: origem || null,
  }
}

export async function createStudentAction(formData: FormData) {
  await requireAdminId()
  const name = String(formData.get('display_name') ?? '').trim()
  const tz = String(formData.get('iana_tz') ?? '').trim()
  const level = String(formData.get('level') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  if (!name || !tz) done('Informe nome e fuso do aluno.')

  // Escrita com a SESSÃO da admin (policy admin_all); trigger valida a zona IANA.
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('students')
    .insert({
      display_name: name,
      iana_tz: tz,
      level: nivelValido(level) ? level : null,
      city: city || null,
      country: country || null,
      // c10 · T1: EXPLÍCITO, sempre. O default da coluna é `true` (ele existe
      // para as fichas antigas, cadastradas com cidade de verdade), e um
      // cadastro que nasce confirmado ANTES da confirmação é uma promessa que a
      // linha seguinte ainda pode não cumprir: se a RPC falhar, sobra um aluno
      // com selo de fuso conferido e nenhum ato de conferência no audit_log.
      // Nascer `false` faz a falha se corrigir sozinha — a guarda barra o
      // contrato até alguém completar a cidade.
      tz_confirmed: false,
    })
    .select('id')
    .single()
  if (error || !data) done(`Falha: ${error?.message ?? 'aluno não criado'}`)
  // c9 · S3: confirmar o fuso é ATO, e o ato tem nome, validação e auditoria.
  // O cadastro nasce a confirmar (acima) e é ESTA chamada — e só ela — que
  // registra quem conferiu a cidade, normalizando os três campos juntos.
  const { error: erroTz } = await confirmarLocalizacao(supabase, data.id, city, country, tz)
  done(erroTz ? `Aluno ${name} criado, mas a cidade não foi confirmada: ${erroTz}` : `Aluno ${name} criado.`)
}

/* -------------------------------------------------------------------------- */
/* CICLO DE VIDA DO ALUNO — fase 1 (27/07/2026)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cria um LEAD (prospecção): nome obrigatório, cidade e origem opcionais.
 *
 * Passa pela RPC `admin_create_lead`, e não por um `insert` de tabela como o
 * cadastro de aluno: o lead é um estado NOVO do funil, e o gate + a auditoria
 * dele têm de morar no banco (Leis 3 e 8). A action só traduz o formulário e
 * escolhe para onde voltar.
 *
 * A volta é o hub JÁ FILTRADO em Lead: o lead nasce fora da lista de trabalho,
 * e mandar a pessoa para uma lista onde o que ela acabou de criar não aparece
 * seria o mesmo que dizer que não deu certo.
 */
export async function createLeadAction(formData: FormData) {
  await requireAdminId()
  const name = String(formData.get('display_name') ?? '').trim()
  if (!name) comRecado('/admin/alunos?situacao=lead', 'Informe o nome do lead.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_create_lead', {
    p_name: name,
    p_iana_tz: String(formData.get('iana_tz') ?? '').trim() || null,
    p_city: String(formData.get('city') ?? '').trim() || null,
    p_country: String(formData.get('country') ?? '').trim() || null,
    p_referral_source: String(formData.get('referral_source') ?? '').trim() || null,
  })
  comRecado('/admin/alunos?situacao=lead', error ? `Falha: ${error.message}` : `Lead ${name} criado. ✓`)
}

/**
 * Lead perdido: o funil acabou sem contrato. Motivo curto e OPCIONAL (ele vai
 * para a auditoria, que é onde serve).
 *
 * Sem type-to-confirm, e a decisão é deliberada: isto não destrói dado nenhum
 * — o cadastro continua inteiro, arquivado, alcançável pela busca e pela badge
 * "Arquivado". O peso da confirmação por digitação (que a anonimização e o
 * encerramento têm) existe para o que NÃO tem volta; usá-lo aqui gastaria a
 * atenção da dona no lugar errado. O Sheet, o botão nomeado e o toast já dizem
 * o que aconteceu.
 */
export async function loseLeadAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('student_id') ?? '')
  if (!id) done('Lead não informado.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_lose_lead', {
    p_student: id,
    p_reason: String(formData.get('reason') ?? '').trim() || null,
  })
  if (error) comRecado(`/admin/alunos/${id}`, `Falha: ${error.message}`)
  done('Lead marcado como perdido — ele fica arquivado, e a busca continua alcançando. ✓')
}

export async function updateStudentAction(formData: FormData) {
  await requireAdminId()
  const id = String(formData.get('student_id') ?? '')
  const name = String(formData.get('display_name') ?? '').trim()
  const tz = String(formData.get('iana_tz') ?? '').trim()
  const level = String(formData.get('level') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const country = String(formData.get('country') ?? '').trim()
  if (!id || !name || !tz) done('Dados incompletos.')

  const supabase = await createClient()
  const { data: antes } = await supabase.from('students').select('iana_tz').eq('id', id).maybeSingle()

  // c9 · S3: cidade + país + fuso saem do `update` de tabela e viram ATO. É a
  // RPC que grava os três junto com `tz_confirmed` — e é ela que destrava
  // contrato e horário fixo. Sem cidade (só chega assim por formulário forjado:
  // o CityPicker é obrigatório) não há confirmação nenhuma; o fuso entra como o
  // palpite que é.
  //
  // A ORDEM IMPORTA, e o motivo é o c10 · T5: o gatilho `students_confirm_tz`
  // DERRUBA `tz_confirmed` em qualquer escrita que troque `iana_tz` por fora do
  // ato de confirmação. Então a RPC vem PRIMEIRO e o `update` de baixo NUNCA
  // toca o fuso — inverter as duas linhas (ou juntar `iana_tz` no update do
  // nome/nível) desfaria, no passo seguinte, a confirmação que a RPC acabou de
  // registrar. O ramo sem cidade grava o fuso de propósito: ali o flag CAI, a
  // ficha volta a mostrar "a confirmar" e o conserto é um clique no CityPicker.
  let error: { message: string } | null = null
  if (city) {
    const { error: erroTz } = await confirmarLocalizacao(supabase, id, city, country, tz)
    if (erroTz) error = { message: erroTz }
  } else {
    const r = await supabase.from('students').update({ iana_tz: tz, country: country || null }).eq('id', id)
    error = r.error
  }
  if (!error) {
    const r = await supabase
      .from('students')
      .update({
        display_name: name,
        level: nivelValido(level) ? level : null,
        // M3-c5 · D1. Tipo inválido não vira 'adult' em silêncio: o campo é um
        // Select de duas opções, então valor fora delas é URL forjada — e aí a
        // action não escreve nada nesse campo (o valor de antes fica).
        ...camposDoCadastro(formData),
      })
      .eq('id', id)
    error = r.error
  }

  // F7/M4-1: mudou o FUSO → consequência explícita (novos horários locais das
  // próximas aulas) + atalho para trocar o horário fixo se ficou ruim.
  let msg = error ? `Falha: ${error.message}` : 'Cadastro atualizado.'
  if (!error && antes?.iana_tz && antes.iana_tz !== tz) {
    const { data: proximas } = await supabase
      .from('class_instances')
      .select('starts_at_utc, contracts!inner(student_id)')
      .eq('contracts.student_id', id)
      .eq('state', 'scheduled')
      .gt('starts_at_utc', new Date().toISOString())
      .order('starts_at_utc')
      .limit(3)
    const { DateTime } = await import('luxon')
    const horarios = (proximas ?? [])
      .map((a) => DateTime.fromISO(a.starts_at_utc).setZone(tz).setLocale('pt-BR').toFormat("ccc dd/LL 'às' HH:mm"))
      .join('; ')
    msg =
      `Fuso atualizado. No relógio novo do aluno as próximas aulas caem em: ${horarios || 'nenhuma futura'}. ` +
      'Se ficou ruim para ele, troque o horário fixo em Contratos.'
  }
  const volta = voltaPara(formData)
  if (volta) comRecado(volta, msg)
  done(msg)
}

export async function inviteStudentAction(formData: FormData) {
  const actorId = await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const email = String(formData.get('email') ?? '').trim()
  // QA 14/07/2026: o WhatsApp entra no CADASTRO (o portal não tem mais opt-in).
  // CORREÇÃO 28/07 (regra do dono): ele deixou de ser OPCIONAL. O contrato
  // externo já autoriza os avisos por WhatsApp desde o início, então quem
  // ganha acesso ao portal ganha COM número — o convite é o único portão de
  // entrada, e é aqui que a invariante se sustenta. Aluno sem convite não
  // precisa de número (não recebe nada mesmo); por isso a exigência mora no
  // convite, e não no cadastro do aluno.
  const phone = String(formData.get('whatsapp_e164') ?? '').trim()
  // Só o DESTINO muda: quem convida do wizard volta para a conclusão dele, quem
  // convida da ficha continua caindo na lista, como sempre.
  const volta = voltaPara(formData)
  const fim: (m: string) => never = (m) => (volta ? comRecado(volta, m) : done(m))
  if (!studentId || !email.includes('@')) fim('Selecione o aluno e informe um e-mail válido.')
  if (!phone)
    fim('Informe o WhatsApp do aluno — é o canal de avisos previsto no contrato. Sem ele, o convite não sai.')
  if (!E164.test(phone))
    fim('Número de WhatsApp inválido — selecione o país e digite só o número local.')

  const admin = createAdminClient()
  // Correção do Sol (28/07): o número viaja DENTRO do provisionamento — o
  // perfil nasce com ele, e nos reenvios a gravação vem antes do e-mail (falha
  // segura o convite). O update best-effort que morava aqui deixava exatamente
  // o buraco que a invariante proíbe: credencial criada, gravação do número
  // falhando depois, e um aluno com acesso sem o canal que o contrato promete.
  const outcome = await provisionStudent(admin, studentId, email, actorId, phone)
  // Sem nota de rodapé sobre o número: ou ele foi gravado, ou o convite nem
  // saiu. As frases mantêm o PREFIXO enumerado em `tomDoAviso` (ponto, não
  // travessão) — fora da lista, o recado pintaria vermelho.
  fim(
    outcome.status === 'invited'
      ? 'Convite enviado! 🎉 WhatsApp no cadastro.'
      : outcome.status === 're_invited'
        ? 'Convite reenviado. WhatsApp atualizado no cadastro.'
        : outcome.status === 'already_active'
          ? 'Este aluno já está com o acesso ativo. WhatsApp atualizado no cadastro.'
          : outcome.message,
  )
}

export async function resendInviteAction(formData: FormData) {
  const actorId = await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  // Idem: só o destino. Reenviar da aba Convites tem de devolver a aba Convites.
  const volta = voltaPara(formData)
  const fim: (m: string) => never = (m) => (volta ? comRecado(volta, m) : done(m))
  if (!studentId) fim('Aluno inválido.')

  const admin = createAdminClient()
  const { data: student } = await admin
    .from('students')
    .select('profile_id')
    .eq('id', studentId)
    .single()
  if (!student?.profile_id) fim('Este aluno ainda não foi convidado.')

  // Correção do Sol (28/07): o reenvio não pode contornar a exigência do
  // convite. Aluno legado (convidado antes da regra) ou com o número limpo pela
  // ficha reenviava por aqui e ganhava acesso sem canal — a trava é do
  // servidor, e a ficha é o lugar de completar o dado. Leitura que falha NÃO
  // vira "sem número" (seria mandar a professora preencher um campo que talvez
  // esteja cheio): a falha fala com o próprio nome. Fail-closed dos dois jeitos.
  const { data: perfil, error: erroDePerfil } = await admin
    .from('profiles')
    .select('whatsapp_e164')
    .eq('id', student.profile_id)
    .maybeSingle()
  if (erroDePerfil) fim(`Falha ao ler o cadastro: ${erroDePerfil.message}`)
  if (!perfil?.whatsapp_e164)
    fim(
      'Este aluno está sem WhatsApp no cadastro — preencha na ficha antes de reenviar: o convite não sai sem o canal previsto no contrato.',
    )

  const { data: existing } = await admin.auth.admin.getUserById(student.profile_id)
  if (!existing?.user?.email) fim('Perfil sem e-mail — fale com o mantenedor.')

  const outcome = await provisionStudent(admin, studentId, existing.user.email, actorId)
  fim(
    outcome.status === 're_invited'
      ? 'Convite reenviado.'
      : outcome.status === 'already_active'
        ? 'Este aluno já está com o acesso ativo.'
        : outcome.status === 'invited'
          ? 'Convite enviado! 🎉'
          : outcome.message,
  )
}

// Armazenamento canônico de telefone: E.164 COM '+' (handoff-whatsapp;
// pino em tests/fase3-dispatch — o driver Evolution tira o '+' só no envio).
const E164 = /^\+[1-9]\d{9,14}$/

// Handoff-whatsapp item 2 + F7/M4-3: a admin corrige o TELEFONE do aluno
// (a regra é "tem número → recebe"; sem número, sem WhatsApp). profiles não
// tem policy de UPDATE — service_role com posse via students.profile_id.
//
// Rodada 3 do Sol (Leis 3+8): morreu o UPDATE direto em `profiles` — a escrita
// passa pela MESMA RPC transacional dos reenvios (`admin_update_student_
// whatsapp`, migration 95), que grava e audita COM O ATOR numa transação só.
// Isso fecha a dívida declarada na rodada anterior: a ficha era a última porta
// que mudava o número sem trilha de quem mudou. LIMPAR continua permitido
// (`phone || null` — decisão aceita: o admin é dono do dado), agora auditado.
export async function updateStudentWhatsappAction(formData: FormData) {
  const actorId = await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const phone = String(formData.get('whatsapp_e164') ?? '').trim()
  if (!studentId) done('Aluno inválido.')

  const back = (m: string): never =>
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(m)}&n=${Date.now()}`)

  const admin = createAdminClient()
  const { data: student } = await admin
    .from('students')
    .select('profile_id')
    .eq('id', studentId)
    .maybeSingle()
  if (!student) done('Aluno não encontrado.')
  if (!student.profile_id) back('Aluno ainda não tem login — convide primeiro.')

  // Antecipação de UX — a régua de verdade é a da RPC (mesma regex, no banco).
  if (phone && !E164.test(phone))
    back('Número inválido — use o formato internacional com "+", ex.: +5565999999999.')

  const { error } = await admin.rpc('admin_update_student_whatsapp', {
    p_profile: student.profile_id,
    p_e164: phone || null,
    p_actor: actorId,
  })
  back(error ? `Falha: ${error.message}` : 'WhatsApp do aluno atualizado.')
}

/**
 * M3-c5 · D1 — a NOTA INTERNA da equipe.
 *
 * A escrita passa pela RPC `admin_set_student_note` e só por ela: ninguém tem
 * insert/update na tabela (Lei 3), o gate de papel mora no banco, e a auditoria
 * (Lei 8) acontece dentro da mesma transação. Aqui não há regra — só o recado.
 */
export async function setStudentNoteAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const nota = String(formData.get('note') ?? '')
  const back = (m: string): never =>
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(m)}&n=${Date.now()}`)
  if (!studentId) done('Aluno inválido.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_student_note', {
    p_student: studentId,
    p_note: nota,
  })
  back(
    error
      ? `Falha ao salvar a nota: ${error.message}`
      : nota.trim()
        ? 'Nota interna salva. ✓'
        : 'Nota interna apagada.',
  )
}

/* ---------------- F7: fuso com consequência, pagador, LGPD ---------------- */

// P7/M11-1: gestão mínima do pagador na ficha (pré-requisito da anonimização).
export async function linkPayerAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const payerId = String(formData.get('payer_id') ?? '')
  const back = (m: string): never =>
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(m)}&n=${Date.now()}`)
  if (!payerId) back('Escolha um pagador.')
  const supabase = await createClient()
  const { error } = await supabase
    .from('student_payers')
    .insert({ student_id: studentId, payer_id: payerId })
  back(error ? `Falha: ${error.message}` : 'Pagador vinculado.')
}

export async function createPayerAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const back = (m: string): never =>
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(m)}&n=${Date.now()}`)
  if (!name) back('Informe o nome do pagador.')
  const supabase = await createClient()
  const { data: payer, error } = await supabase
    .from('payers')
    .insert({
      name,
      email: String(formData.get('email') ?? '').trim() || null,
      cpf_cnpj: String(formData.get('cpf_cnpj') ?? '').trim() || null,
    })
    .select('id')
    .single()
  if (error) back(`Falha: ${error.message}`)
  const { error: linkErr } = await supabase
    .from('student_payers')
    .insert({ student_id: studentId, payer_id: payer!.id })
  back(linkErr ? `Pagador criado, mas o vínculo falhou: ${linkErr.message}` : 'Pagador criado e vinculado.')
}

// F3 (Onda Financeiro): self × terceiro — o vínculo que libera (ou não) o
// botão da fatura no portal. A regra vive na RPC (auditada, 1 self por aluno).
export async function setPayerRelationshipAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const payerId = String(formData.get('payer_id') ?? '')
  const relationship = String(formData.get('relationship') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_payer_relationship', {
    p_student: studentId,
    p_payer: payerId,
    p_relationship: relationship,
  })
  const msg = error
    ? `Falha: ${error.message}`
    : relationship === 'self'
      ? 'Pagador marcado como o próprio aluno — o botão da fatura liga no portal.'
      : 'Pagador marcado como terceiro — o portal não mostra a fatura dele.'
  redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

export async function unlinkPayerAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const payerId = String(formData.get('payer_id') ?? '')
  const supabase = await createClient()
  // F3 (Sol · P2): o desvínculo passou a ser RPC AUDITADA — remover um self
  // apaga o estado que autoriza a fatura no portal, e isso precisa de trilha.
  const { error } = await supabase.rpc('admin_unlink_payer', {
    p_student: studentId,
    p_payer: payerId,
  })
  redirect(
    `/admin/alunos/${studentId}?msg=${encodeURIComponent(error ? `Falha: ${error.message}` : 'Vínculo removido.')}&n=${Date.now()}`,
  )
}

// A sequência ban → baixa/registro mora em `@/lib/admin/auth-cleanup` (F2): lá
// os clientes são injetados e a suíte consegue exercitar os quatro desfechos.

// M4-5: anonimizar ex-aluno — o mapa vive no banco; aqui destruímos o LOGIN
// (ban + e-mail embaralhado via API do Auth) e expurgamos a caixa Evolution
// pelo telefone devolvido pela RPC.
export async function anonymizeStudentAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const confirm = String(formData.get('confirm_name') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_anonymize_student', {
    p_student: studentId,
    p_confirm: confirm,
  })
  if (error)
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(`Falha: ${error.message}`)}&n=${Date.now()}`)

  // `profile_id` = O LOGIN A DESTRUIR. A RPC devolve o pendente
  // (`auth_cleanup_profile_id`) quando o aluno JÁ estava anonimizado com o ban
  // em aberto — antes disto a re-submissão recebia `null`, PULAVA o ban e a
  // tela ainda assim dizia "login destruído" (revisão adversarial nº 3, S1).
  const r = data as {
    profile_id: string | null
    phone: string | null
    payers_fiscal: number
  }
  const admin = createAdminClient()

  // FAIL-CLOSED (revisão adversarial retroativa nº 2, B3). Isto era fail-OPEN:
  // o erro caía num `console.error` e a admin lia "aluno anonimizado" com o
  // LOGIN da pessoa vivo — o oposto do que a tela prometia.
  let cleanupNote = ''
  if (r.profile_id) {
    // A ficha JÁ foi desidentificada (a RPC commitou); o que pode ficar de fora
    // é a destruição do login — e aí a pendência (gravada na ficha) segura a
    // retomada, com a falha registrada em auditoria.
    const res = await concluirBloqueioDeLogin({
      admin,
      db: supabase,
      studentId,
      profileId: r.profile_id,
    })
    if (!res.ok) {
      console.error('[anonimização: ban do auth falhou]', res.falha, res.erroDoRegistro ?? '')
      redirect(
        `/admin/alunos/${studentId}?msg=${encodeURIComponent(
          mensagemDaAnonimizacaoTravada(res),
        )}&n=${Date.now()}`,
      )
    }
    if (res.erroDaBaixa)
      cleanupNote =
        ' (o aviso de bloqueio pendente pode continuar na ficha — o botão “Concluir bloqueio de login” é idempotente)'
  }
  let purged = 0
  if (r.phone) {
    const { data: n } = await admin.rpc('admin_purge_evolution_by_phone', { p_phone: r.phone })
    purged = Number(n ?? 0)
  }
  done(
    `Aluno anonimizado: ${r.profile_id ? 'login destruído' : 'não havia login para destruir'}, ` +
      `${purged} registro(s) do WhatsApp expurgado(s)` +
      (r.payers_fiscal > 0
        ? `; ${r.payers_fiscal} pagador(es) preservado(s) por 5 anos (obrigação fiscal — expurgo manual futuro).`
        : '.') +
      cleanupNote,
  )
}

/**
 * S1: retomada do bloqueio de login que ficou pendente (a ficha já está
 * anonimizada, o Auth é que não respondeu). Idempotente: pode ser clicado
 * quantas vezes for preciso — o ban é o mesmo, e a pendência só é baixada
 * depois do sucesso.
 */
export async function finishAuthBlockAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  // Anotação no CONST (não só no retorno): é o que faz o TS entender que depois
  // de `back(...)` o fluxo acabou — e narrar o `pendente` como string.
  const back: (m: string) => never = (m) =>
    redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(m)}&n=${Date.now()}`)
  if (!studentId) done('Aluno inválido.')

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('students')
    .select('auth_cleanup_profile_id')
    .eq('id', studentId)
    .maybeSingle()
  if (error) back(`Falha ao ler a pendência: ${error.message}`)
  const pendente = row?.auth_cleanup_profile_id as string | null | undefined
  if (!pendente) back('Não há bloqueio de login pendente neste aluno.')

  const res = await concluirBloqueioDeLogin({
    admin: createAdminClient(),
    db: supabase,
    studentId,
    profileId: pendente,
    prefixoDoDetalhe: 'retomada: ',
  })
  if (!res.ok) {
    console.error('[retomada do ban do auth falhou]', res.falha, res.erroDoRegistro ?? '')
    back(mensagemDaRetomadaTravada(res))
  }
  back(
    res.erroDaBaixa
      ? `Login bloqueado, mas o aviso não foi baixado: ${res.erroDaBaixa} — clique de novo.`
      : 'Login bloqueado e credenciais embaralhadas. Anonimização concluída. ✓',
  )
}

// ---------------------------------------------------------------------------
// Cronograma M0c (20/07/2026) — retaguarda do briefing na ficha do aluno.
// ---------------------------------------------------------------------------

export async function adminFillBriefingAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const finalize = String(formData.get('finalize') ?? '') === '1'

  const supabase = await createClient()
  // Briefing v2: a régua da montagem é a da LINHA (rascunho começado no v1
  // termina no v1) mais o ramo do aluno. Aluno sem linha ainda cai no v2 — é o
  // que o default da coluna carimba no primeiro `admin_fill_briefing`.
  // Leitura que falha PARA a action: montar com a régua errada gravaria a seção
  // inteira com as chaves erradas.
  const [{ data: linhas, error: erroBriefing }, { data: alunos, error: erroAluno }] =
    await Promise.all([
      supabase.from('briefings').select('schema_version').eq('student_id', studentId).limit(1),
      supabase.from('students').select('student_type').eq('id', studentId).limit(1),
    ])
  if (erroBriefing || erroAluno) {
    const m = (erroBriefing ?? erroAluno)!.message
    redirect(
      `/admin/alunos/${studentId}?msg=${encodeURIComponent(`Falha no briefing: ${m}`)}&n=${Date.now()}`,
    )
  }
  const { parseBriefingForm } = await import('@/lib/briefing/parse')
  const { answers, kolb } = parseBriefingForm(formData, {
    versao: linhas?.[0]?.schema_version === 1 ? 1 : 2,
    tipo: alunos?.[0]?.student_type === 'child' ? 'child' : 'adult',
  })

  const { error } = await supabase.rpc('admin_fill_briefing', {
    p_student: studentId,
    p_answers: answers,
    p_kolb_answers: kolb,
    p_finalize: finalize,
  })
  const msg = error
    ? `Falha no briefing: ${error.message}`
    : finalize
      ? 'Briefing preenchido e finalizado em nome do aluno. ✓'
      : 'Briefing salvo como rascunho (não finalizado). ✓'
  redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

/**
 * Briefing v2 (28/07) — CORREÇÃO pós-envio de UMA etapa.
 *
 * O formulário reenvia a etapa inteira (são os mesmos campos da coleta,
 * pré-preenchidos); o patch que vai para o banco leva SÓ o que mudou, comparado
 * aqui contra o que está gravado. Nada de regra própria: quem valida o motivo, o
 * resultado e a intocabilidade do Kolb é `admin_revise_briefing` (Lei 3) — e é a
 * frase DELA que vira o recado da tela, inclusive a de "nada mudou".
 */
export async function adminReviseBriefingAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const secao = String(formData.get('secao') ?? '')
  const motivo = String(formData.get('motivo') ?? '')
  const destino = `/admin/alunos/${studentId}?aba=briefing`
  if (!studentId) done('Aluno inválido.')
  if (!ehSecaoBriefing(secao))
    comRecado(destino, 'Correção sem etapa — abra pelo botão “Corrigir resposta”.')

  const supabase = await createClient()
  // A régua da montagem é a da LINHA + o ramo do aluno, como no preenchimento
  // por telefone. Leitura que falha PARA a action: montar com a régua errada
  // compararia chaves de outra versão e "corrigiria" o briefing inteiro.
  const [{ data: linhas, error: erroBriefing }, { data: alunos, error: erroAluno }] =
    await Promise.all([
      supabase
        .from('briefings')
        .select('schema_version, answers')
        .eq('student_id', studentId)
        .limit(1),
      supabase.from('students').select('student_type').eq('id', studentId).limit(1),
    ])
  if (erroBriefing || erroAluno)
    comRecado(destino, `Falha na correção: ${(erroBriefing ?? erroAluno)!.message}`)
  const linha = linhas?.[0]
  if (!linha) comRecado(destino, 'Este aluno ainda não tem briefing para corrigir.')

  const { parseBriefingForm } = await import('@/lib/briefing/parse')
  const { answers } = parseBriefingForm(formData, {
    versao: linha.schema_version === 1 ? 1 : 2,
    tipo: alunos?.[0]?.student_type === 'child' ? 'child' : 'adult',
  })
  const atual = (linha.answers ?? {}) as Record<string, unknown>
  // Patch vazio segue para a RPC assim mesmo: quem diz "os valores enviados são
  // iguais aos atuais" é ela, e a tela não inventa uma recusa própria.
  const patch = montarPatchDeRevisao(atual[secao], answers[secao])

  const { error } = await supabase.rpc('admin_revise_briefing', {
    p_student: studentId,
    p_patch: { [secao]: patch },
    p_reason: motivo,
  })
  comRecado(
    destino,
    error
      ? `Falha na correção: ${error.message}`
      : 'Correção registrada — ela fica no histórico do briefing, com o de/para. ✓',
  )
}

export async function sendBriefingReminderAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const supabase = await createClient()
  const { data: n, error } = await supabase.rpc('enqueue_briefing_reminder', {
    p_student: studentId,
  })
  if (!error && Number(n) > 0) {
    // despacho imediato, padrão das confirmações — falha deixa para a rodada horária
    try {
      const { dispatchOutbox } = await import('@/lib/outbox/dispatch')
      const { sendEmailWithOutcome } = await import('@/lib/email/send')
      const { evolutionChannel, evolutionConfigFromEnv } = await import('@/lib/notify/evolution')
      await dispatchOutbox(createAdminClient(), {
        email: { send: sendEmailWithOutcome },
        whatsapp: evolutionChannel(evolutionConfigFromEnv()),
      })
    } catch (err) {
      console.error('[lembrete de briefing não despachado]', err)
    }
  }
  const msg = error
    ? `Falha no lembrete: ${error.message}`
    : Number(n) > 0
      ? 'Lembrete de briefing a caminho (e-mail e WhatsApp, se houver número). ✓'
      : 'Lembrete de hoje já tinha sido enviado — amanhã pode de novo.'
  redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

/**
 * Briefing v2 · sub-lote 5 — o mesmo toque, para o RE-BRIEFING SEMESTRAL.
 *
 * Irmão de `sendBriefingReminderAction` em tudo (RPC → despacho imediato →
 * recado), com duas diferenças: o template é outro e a régua da recusa é a do
 * UPDATE (sem plano vigente, semestre 1, atualização já enviada) — quem a impõe
 * é `enqueue_briefing_update_reminder`, e é a frase DELA que a tela mostra.
 *
 * A volta é para a aba Briefing: é de lá que o botão sai.
 */
export async function sendBriefingUpdateReminderAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const destino = `/admin/alunos/${studentId}?aba=briefing`
  const supabase = await createClient()
  const { data: n, error } = await supabase.rpc('enqueue_briefing_update_reminder', {
    p_student: studentId,
  })
  if (!error && Number(n) > 0) {
    // despacho imediato, padrão das confirmações — falha deixa para a rodada horária
    try {
      const { dispatchOutbox } = await import('@/lib/outbox/dispatch')
      const { sendEmailWithOutcome } = await import('@/lib/email/send')
      const { evolutionChannel, evolutionConfigFromEnv } = await import('@/lib/notify/evolution')
      await dispatchOutbox(createAdminClient(), {
        email: { send: sendEmailWithOutcome },
        whatsapp: evolutionChannel(evolutionConfigFromEnv()),
      })
    } catch (err) {
      console.error('[lembrete de atualização de briefing não despachado]', err)
    }
  }
  comRecado(
    destino,
    error
      ? `Falha no lembrete: ${error.message}`
      : Number(n) > 0
        ? 'Lembrete de atualização a caminho (e-mail e WhatsApp, se houver número). ✓'
        : 'Lembrete de hoje já tinha sido enviado — amanhã pode de novo.',
  )
}

export async function adminGeneratePlanAction(formData: FormData) {
  await requireAdminId()
  const studentId = String(formData.get('student_id') ?? '')
  const contractId = String(formData.get('contract_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('generate_study_plan', { p_contract: contractId })
  const msg = error
    ? `Falha ao gerar o plano: ${error.message}`
    : 'Plano do semestre gerado — a professora personaliza no painel dela. ✓'
  redirect(`/admin/alunos/${studentId}?msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}
