import type { SupabaseClient } from '@supabase/supabase-js'

// Núcleo do convite D6/F2 — framework-free (client injetado) para o Vitest exercitar
// o fluxo real. As server actions são wrappers que autenticam o chamador admin.
//
// F3-D1 (Fase 3): o MESMO motor serve aluno e professora, parametrizado por papel.
// Pinos de segurança:
//  (a) o papel é um literal server-side por fluxo ('student' | 'teacher') — nunca
//      derivado de input do request; qualquer outro valor é rejeitado em runtime e
//      'admin' JAMAIS é provisionável por convite;
//  (b) adoção de órfão vale ENTRE fluxos (órfão = auth user sem profile, sem dono),
//      mas a troca de papel é DELIBERADA e AUDITADA (papel_anterior no diff — Lei 8);
//      usuário COM profile permanece intocável (erro, como sempre);
//  (c) profiles.iana_tz é COPIADO do cadastro (students.iana_tz / teachers.iana_tz —
//      F3-D2), nunca o default.
//
// Ordem deliberada (painel de revisão do plano): o e-mail de convite é o ÚLTIMO passo —
// só sai depois de auth.users + profiles + vínculo estarem consistentes.
// Se o envio falhar, a pessoa fica "convidada (pendente)" e o reenvio repete só o e-mail.
//
// CORREÇÃO 28/07/2026 (rodada do Sol na correção "WhatsApp = canal de contrato"):
// o número de WhatsApp faz parte do PROVISIONAMENTO do aluno, não é um update
// best-effort depois dele. A regra do negócio — quem tem acesso ao portal tem
// número, porque o contrato externo já autoriza os avisos — só se sustenta se o
// perfil NASCE com o número (o rollback existente via `deleteUser` desfaz tudo
// junto) e se, nos reenvios, a gravação vem ANTES do e-mail (falhou a gravação →
// o e-mail NÃO sai). Só o fluxo de ALUNO passa o número; professora não tem essa
// exigência.
//
// ONDE ESSA REGRA MORA — ATUALIZADO NO A6 (a dívida do portão de 29/07 fechou).
// Ela vivia SÓ aqui, no TypeScript: o banco tinha a régua de FORMATO (CHECK
// E.164, que aceita NULL de propósito) e as portas transacionais, mas nenhum
// gatilho proibia perfil de aluno sem número, e chamar aquilo de "invariante
// estrutural" era mentira de comentário.
// A migration 98 (`20260730000100_a6_travas_de_agenda.sql`, item i) põe a regra
// no banco pelo gatilho `students_lead_sem_login`, que já é o porteiro do
// NASCIMENTO do vínculo (`profile_id` null→not null): perfil sem
// `whatsapp_e164` não recebe acesso, venha o vínculo por onde vier. O que o
// banco garante é exatamente o que este motor promete — acesso não NASCE sem
// número.
// O que continua sendo decisão ACEITA, e por isso NÃO virou CHECK na coluna: o
// admin pode LIMPAR o número pela ficha (ele é dono do dado), e a anonimização
// mantém `role='student'` com número nulo — um CHECK por papel quebraria a LGPD.
// Conta legada sem número também continua existindo; a decisão sobre ela é do
// rito de deploy.
//
// Rodada 2 do Sol (achado 1): a exigência DESCEU dos wrappers para cá. Enquanto
// ela morava só nas actions, uma chamada direta `provisionStudent(...)` sem
// número ainda criava usuário + perfil + vínculo e mandava o convite — o cinto
// da invariante é do motor, e a recusa vem antes de qualquer efeito no Auth.

export type ProvisionOutcome =
  | { status: 'invited'; userId: string }
  | { status: 're_invited'; userId: string }
  | { status: 'already_active'; userId: string }
  | { status: 'error'; message: string }

export type LinkOutcome = { status: 'linked'; userId: string } | { status: 'error'; message: string }

type ProvisionRole = 'student' | 'teacher'

interface Subject {
  table: 'students' | 'teachers'
  id: string
  displayName: string
  ianaTz: string
  profileId: string | null
  noun: string // para mensagens: 'aluno' / 'professora'
}

export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? ''
}

export async function provisionStudent(
  admin: SupabaseClient,
  studentId: string,
  email: string,
  actorId: string | null,
  // Correção 28/07: o número entra no provisionamento (ver o cabeçalho). Fica
  // opcional no TIPO porque os REENVIOS chamam sem número — nesses caminhos o
  // perfil já existe e a guarda abaixo exige o número NELE (achado 1 da rodada
  // 2: a régua é do motor, não confiança no chamador).
  whatsappE164?: string,
): Promise<ProvisionOutcome> {
  const { data: student, error } = await admin
    .from('students')
    .select('id, display_name, iana_tz, profile_id, status, anonymized_at')
    .eq('id', studentId)
    .single()
  if (error || !student) return { status: 'error', message: 'Aluno não encontrado.' }
  // P7 da revisão nº 8 — LEAD NÃO TEM PORTAL, e a guarda é aqui, no motor:
  // esconder o botão na tela nunca impediu ninguém de chamar a action com um
  // `student_id` na mão. A recusa vem ANTES de qualquer efeito no Auth (nada de
  // usuário criado e depois apagado), e o banco tem o mesmo cinto no gatilho
  // `students_lead_sem_login`, para o caso de alguém escrever direto na tabela.
  if (student.status === 'lead') {
    return {
      status: 'error',
      message:
        'Este cadastro ainda é um LEAD — ele vira aluno quando o primeiro contrato nasce, ' +
        'e só então o portal faz sentido. Crie o contrato e convide depois.',
    }
  }
  // R2 (revisão nº 9) — ANONIMIZADO NUNCA GANHA LOGIN. A ficha desidentificada é
  // terminal (P5 da revisão nº 8): dar portal a ela é ressuscitar o que a LGPD
  // mandou apagar. E a régua passa a ser POSITIVA — só `active` convida —, em vez
  // de uma lista de status proibidos que a próxima situação nova atravessa por
  // omissão (`archived`, `churned`, `paused` já entrariam hoje).
  //
  // Esta é a antecipação com a mensagem boa; o CINTO que fecha o TOCTOU está no
  // banco (gatilho `students_lead_sem_login`), porque entre este SELECT e o
  // UPDATE do vínculo cabe uma anonimização inteira commitando ao lado.
  if (student.anonymized_at) {
    return {
      status: 'error',
      message:
        'Esta ficha foi anonimizada e não recebe mais acesso ao portal. ' +
        'Se a pessoa voltou, cadastre-a de novo.',
    }
  }
  if (student.status !== 'active') {
    return {
      status: 'error',
      message:
        `Este cadastro está como "${student.status}" — só aluno ATIVO recebe o portal. ` +
        'Reative (o contrato novo faz isso) e convide depois.',
    }
  }
  // Achado 1 (rodada 2 do Sol): a invariante mora AQUI, depois das réguas de
  // status (lead/anonimizado/inativo respondem primeiro — são recusas mais
  // específicas) e antes de qualquer efeito no Auth. Dois caminhos, uma régua:
  //   · CRIAÇÃO (aluno sem perfil — inclui a adoção de órfão): número
  //     obrigatório no argumento, porque o perfil vai NASCER agora;
  //   · perfil EXISTENTE (reenvio / já ativo): serve o número do argumento OU o
  //     que já está no perfil; ambos vazios = recusa sem e-mail. Leitura que
  //     falha também recusa (fail-closed): "não sei se tem número" não é "tem".
  const numero = whatsappE164?.trim() || undefined
  if (!student.profile_id && !numero) {
    return {
      status: 'error',
      message:
        'Informe o WhatsApp do aluno — é o canal de avisos previsto no contrato. Sem ele, o convite não sai.',
    }
  }
  if (student.profile_id && !numero) {
    const { data: perfil, error: erroDePerfil } = await admin
      .from('profiles')
      .select('whatsapp_e164')
      .eq('id', student.profile_id)
      .maybeSingle()
    if (erroDePerfil) {
      return {
        status: 'error',
        message: `Falha ao ler o cadastro do aluno (${erroDePerfil.message}) — o convite não saiu.`,
      }
    }
    if (!perfil?.whatsapp_e164) {
      return {
        status: 'error',
        message:
          'Este aluno está sem WhatsApp no cadastro — preencha na ficha antes: o convite não sai sem o canal previsto no contrato.',
      }
    }
  }
  return provisionPerson(admin, 'student', {
    table: 'students',
    id: student.id,
    displayName: student.display_name,
    ianaTz: student.iana_tz,
    profileId: student.profile_id,
    noun: 'aluno',
  }, email, actorId, numero)
}

export async function provisionTeacher(
  admin: SupabaseClient,
  teacherId: string,
  email: string,
  actorId: string | null,
): Promise<ProvisionOutcome> {
  const { data: teacher, error } = await admin
    .from('teachers')
    .select('id, display_name, iana_tz, profile_id')
    .eq('id', teacherId)
    .single()
  if (error || !teacher) return { status: 'error', message: 'Professora não encontrada.' }
  return provisionPerson(admin, 'teacher', {
    table: 'teachers',
    id: teacher.id,
    displayName: teacher.display_name ?? 'Professora',
    ianaTz: teacher.iana_tz,
    profileId: teacher.profile_id,
    noun: 'professora',
  }, email, actorId)
}

async function provisionPerson(
  admin: SupabaseClient,
  role: ProvisionRole,
  subject: Subject,
  email: string,
  actorId: string | null,
  whatsappE164?: string,
): Promise<ProvisionOutcome> {
  // F3-D1a: literal server-side; 'admin' (ou qualquer outro valor) jamais passa.
  if (role !== 'student' && role !== 'teacher') {
    throw new Error(`papel não provisionável por convite: ${String(role)}`)
  }
  const inviteAction = role === 'student' ? 'invite_student' : 'invite_teacher'
  const reInviteAction = role === 'student' ? 're_invite_student' : 're_invite_teacher'

  // Já vinculado: reenvia o convite se nunca ativou; senão, já está ativo.
  if (subject.profileId) {
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(subject.profileId)
    if (getErr || !existing?.user) {
      return { status: 'error', message: `Perfil vinculado não existe no Auth (${subject.noun}).` }
    }
    if (existing.user.email_confirmed_at) {
      // Correção 28/07: o admin é dono do dado — o número enviado no formulário
      // atualiza também quem já ativou, e a falha é ERRO VISÍVEL, nunca um
      // "acesso ativo ✔" com o número enviado indo para o lixo em silêncio.
      if (whatsappE164) {
        const erroDoNumero = await gravarWhatsappAuditado(
          admin, existing.user.id, whatsappE164, actorId,
        )
        if (erroDoNumero) {
          return {
            status: 'error',
            message: `O acesso já está ativo, mas o WhatsApp NÃO foi atualizado (${erroDoNumero}). Tente de novo.`,
          }
        }
      }
      return { status: 'already_active', userId: existing.user.id }
    }
    if (existing.user.email?.toLowerCase() !== email.trim().toLowerCase()) {
      return {
        status: 'error',
        message: `Já existe convite com outro e-mail (${existing.user.email}). Troca de e-mail fica fora deste fluxo — fale com o mantenedor.`,
      }
    }
    // Correção 28/07: o número ANTES do e-mail. Se a gravação falhar, o convite
    // NÃO sai — reenviar primeiro e reclamar depois deixaria um aluno com
    // acesso a caminho e sem o canal que o contrato promete.
    if (whatsappE164) {
      const erroDoNumero = await gravarWhatsappAuditado(
        admin, existing.user.id, whatsappE164, actorId,
      )
      if (erroDoNumero) {
        return {
          status: 'error',
          message: `Falha ao gravar o WhatsApp (${erroDoNumero}) — o convite NÃO foi reenviado. Tente de novo.`,
        }
      }
    }
    const { error: resendErr } = await admin.auth.admin.inviteUserByEmail(existing.user.email)
    if (resendErr) {
      // Achado 3 (rodada 2): sucesso parcial DESCRITO, não escondido — o número
      // já persistiu (e foi auditado acima); só o e-mail falhou. Uma frase que
      // dissesse só "falha ao reenviar" faria a admin redigitar o número achando
      // que nada gravou.
      return {
        status: 'error',
        message: whatsappE164
          ? `O WhatsApp foi atualizado no cadastro, mas o e-mail de convite falhou (${resendErr.message}). Reenvie o convite — o número já está gravado.`
          : `Falha ao reenviar o convite: ${resendErr.message}`,
      }
    }
    await audit(admin, actorId, reInviteAction, subject, {
      email: existing.user.email,
      profile_id: existing.user.id,
    })
    return { status: 're_invited', userId: existing.user.id }
  }

  // Papel em app_metadata (Lei 4 — inviteUserByEmail não aceita app_metadata, por isso
  // createUser primeiro); first_name em user_metadata é SÓ exibição nos e-mails.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email.trim(),
    app_metadata: { role },
    user_metadata: { first_name: firstNameOf(subject.displayName) },
  })
  let userId: string
  let previousRole: string | null = null
  if (createErr || !created?.user) {
    if (createErr && 'code' in createErr && createErr.code === 'email_exists') {
      // Pode ser um ÓRFÃO de execução anterior que morreu entre createUser e o vínculo
      // (auth user existe, profile não) — inclusive de OUTRO fluxo (F3-D1b). Sem esta
      // adoção, o e-mail ficaria travado para sempre. Usuário com profile = pertence a
      // alguém de verdade → erro.
      const orphan = await findUserByEmail(admin, email.trim())
      if (!orphan) {
        return { status: 'error', message: 'Este e-mail já pertence a outra conta.' }
      }
      const { data: profileRow } = await admin
        .from('profiles')
        .select('id')
        .eq('id', orphan.id)
        .maybeSingle()
      if (profileRow) {
        return { status: 'error', message: 'Este e-mail já pertence a outra conta.' }
      }
      previousRole = orphan.role ?? null
      const { error: adoptErr } = await admin.auth.admin.updateUserById(orphan.id, {
        app_metadata: { role },
        user_metadata: { first_name: firstNameOf(subject.displayName) },
      })
      if (adoptErr) {
        return { status: 'error', message: `Falha ao recuperar convite anterior: ${adoptErr.message}` }
      }
      userId = orphan.id
    } else {
      return {
        status: 'error',
        message: `Falha ao criar o usuário: ${createErr?.message ?? 'resposta vazia'}`,
      }
    }
  } else {
    userId = created.user.id
  }

  // profiles espelha auth.users 1:1; iana_tz copiado do cadastro (nunca o default).
  //
  // Correção 28/07: o perfil do aluno NASCE com o número. PORTÃO DE DEPLOY
  // 29/07 (bloqueador 2): esse nascimento deixou de ser um INSERT em TS com
  // `audit()` fail-open ao lado e passou pela MESMA porta transacional da
  // troca — `admin_create_student_profile` (migration 95) faz insert + audit
  // com ator na mesma transação e RECUSA ator nulo. Antes existia um mundo com
  // aluno criado, número gravado, convite enviado e ZERO trilha de quem
  // cadastrou o número (Lei 8). Falhando, o `deleteUser` abaixo desfaz tudo
  // junto: nunca existe credencial válida com perfil sem número.
  //
  // A professora segue no INSERT comum: não há número em jogo no papel dela, e
  // a RPC é deliberadamente só de aluno (papel literal dentro do banco, Lei 4).
  let profileErr: { message: string } | null
  if (role === 'student') {
    if (!whatsappE164) {
      // Cinto do MOTOR (a guarda de `provisionStudent` já recusa antes de
      // tocar no Auth): perfil de aluno nunca nasce sem número, nem por uma
      // chamada nova que esqueça a régua.
      await admin.auth.admin.deleteUser(userId)
      return {
        status: 'error',
        message:
          'Informe o WhatsApp do aluno — é o canal de avisos previsto no contrato. Sem ele, o convite não sai.',
      }
    }
    const { error } = await admin.rpc('admin_create_student_profile', {
      p_profile: userId,
      p_full_name: subject.displayName,
      p_iana_tz: subject.ianaTz,
      p_e164: whatsappE164,
      p_actor: actorId,
    })
    profileErr = error
  } else {
    const { error } = await admin.from('profiles').insert({
      id: userId,
      role,
      full_name: subject.displayName,
      iana_tz: subject.ianaTz,
    })
    profileErr = error
  }
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId)
    return { status: 'error', message: `Falha ao criar o perfil: ${profileErr.message}` }
  }

  // Guarda contra corrida/sobrescrita: só vincula se ainda estiver desvinculado
  // (os índices *_profile_uniq garantem o 1:1, mas não impedem trocar o vínculo).
  const { data: linked, error: linkErr } = await admin
    .from(subject.table)
    .update({ profile_id: userId })
    .eq('id', subject.id)
    .is('profile_id', null)
    .select('id')
  if (linkErr || !linked || linked.length === 0) {
    await admin.auth.admin.deleteUser(userId) // cascade remove o profile
    return {
      status: 'error',
      message: linkErr
        ? `Falha ao vincular: ${linkErr.message}`
        : `Vínculo criado por outra execução enquanto o convite era processado (${subject.noun}).`,
    }
  }

  // Lei 8: a mutação (user+profile+vínculo) JÁ persistiu — audita ANTES do e-mail,
  // senão uma falha de envio deixaria o provisionamento sem trilha com ator.
  // Adoção cross-flow (F3-D1b): o papel anterior fica gravado no diff.
  await audit(admin, actorId, inviteAction, subject, {
    email: email.trim(),
    profile_id: userId,
    iana_tz: subject.ianaTz,
    // O número também no diff do convite — CONTEXTO, não a trilha. A trilha
    // garantida do nascimento é a da RPC (`create_student_whatsapp`), que
    // commita junto com o perfil; esta linha aqui é best-effort por natureza
    // (o `audit()` abaixo é fail-open) e serve para ler o convite inteiro num
    // registro só.
    ...(whatsappE164 ? { whatsapp_e164: whatsappE164 } : {}),
    ...(previousRole !== null && previousRole !== role
      ? { adotado: true, papel_anterior: previousRole }
      : {}),
  })

  // E-mail por último: falha aqui NÃO desfaz nada — o estado "convidado (pendente)"
  // é válido e o reenvio resolve.
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.trim())
  if (inviteErr) {
    return {
      status: 'error',
      message: `Acesso criado, mas o e-mail de convite falhou (${inviteErr.message}). Use "reenviar convite".`,
    }
  }
  return { status: 'invited', userId }
}

/**
 * F3-D1b (decisão P1): professora que JÁ é usuária (a dona, dona E admin) — vincula
 * teachers.profile_id ao auth user EXISTENTE, sem createUser e SEM tocar em
 * app_metadata.role/profiles.role (admin ≥ teacher no gate; RLS por profile_id cobre).
 */
export async function linkTeacherToExistingProfile(
  admin: SupabaseClient,
  teacherId: string,
  email: string,
  actorId: string | null,
): Promise<LinkOutcome> {
  const { data: teacher, error } = await admin
    .from('teachers')
    .select('id, display_name, iana_tz, profile_id')
    .eq('id', teacherId)
    .single()
  if (error || !teacher) return { status: 'error', message: 'Professora não encontrada.' }
  if (teacher.profile_id) {
    return { status: 'error', message: 'Esta professora já está vinculada a uma conta.' }
  }

  const user = await findUserByEmail(admin, email.trim())
  if (!user) {
    return { status: 'error', message: 'Nenhuma conta com este e-mail — use o CONVITE.' }
  }
  const { data: profileRow } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profileRow) {
    return {
      status: 'error',
      message: 'Esta conta existe mas está incompleta (sem perfil) — use o CONVITE, que a adota.',
    }
  }
  // Painel final F3: o vínculo dá à conta as superfícies filtradas só por
  // my_teacher_id() (teacher_agenda, teachers_self — inclui hourly_rate_cents).
  // F3-D1b foi decidido para a dona (admin); conta de aluno/vendas digitada por
  // engano seria vazamento — recusar ANTES do UPDATE. Troca de papel não é daqui.
  if (profileRow.role !== 'admin' && profileRow.role !== 'teacher') {
    return {
      status: 'error',
      message:
        `A conta encontrada tem papel '${profileRow.role}' (aluno/vendas) — professora só ` +
        'se vincula a conta admin ou teacher. Troca de papel fica fora deste fluxo; ' +
        'confira o e-mail ou fale com o mantenedor.',
    }
  }

  const { data: linked, error: linkErr } = await admin
    .from('teachers')
    .update({ profile_id: user.id })
    .eq('id', teacherId)
    .is('profile_id', null)
    .select('id')
  if (linkErr || !linked || linked.length === 0) {
    return {
      status: 'error',
      message: linkErr ? `Falha ao vincular: ${linkErr.message}` : 'Vínculo mudou durante a operação.',
    }
  }

  // F3-D2b: o profile espelha o fuso operacional da professora (fonte: teachers).
  await admin.from('profiles').update({ iana_tz: teacher.iana_tz }).eq('id', user.id)

  await audit(admin, actorId, 'link_teacher_profile', {
    table: 'teachers', id: teacherId, displayName: teacher.display_name ?? '',
    ianaTz: teacher.iana_tz, profileId: user.id, noun: 'professora',
  }, {
    email: email.trim(),
    profile_id: user.id,
    papel_do_perfil: profileRow.role, // intocado — pino F3-D1b
  })
  return { status: 'linked', userId: user.id }
}

/**
 * Grava o WhatsApp no perfil EXISTENTE (caminhos re_invited/already_active) e
 * devolve a mensagem de erro, ou null no sucesso.
 *
 * Rodada 3 do Sol (achado 1, Leis 3+8): gravação e auditoria viraram UMA
 * transação — a RPC `admin_update_student_whatsapp` (migration 95) faz o
 * update, recusa perfil inexistente (`if not found`) e registra o ator no
 * `audit_log` sem chance de a trilha se perder. O par antigo (UPDATE em TS +
 * `audit()` separado, que é fail-open) admitia um mundo com número trocado e
 * ZERO registro de quem trocou.
 *
 * O caminho de CRIAÇÃO tem a irmã dela — `admin_create_student_profile`,
 * chamada em `provisionPerson` (portão de deploy 29/07). As duas exigem ator:
 * trilha sem autor era o defeito que esta família de RPCs veio matar.
 */
async function gravarWhatsappAuditado(
  admin: SupabaseClient,
  profileId: string,
  e164: string,
  actorId: string | null,
): Promise<string | null> {
  const { error } = await admin.rpc('admin_update_student_whatsapp', {
    p_profile: profileId,
    p_e164: e164,
    p_actor: actorId,
  })
  return error ? error.message : null
}

/** Busca por e-mail via listUsers paginado (não há endpoint direto; escala-alvo ≤50). */
async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; role: string | null } | null> {
  const target = email.toLowerCase()
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data.users.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === target)
    if (hit) {
      const role = (hit.app_metadata as Record<string, unknown> | null)?.role
      return { id: hit.id, role: typeof role === 'string' ? role : null }
    }
    if (data.users.length < 200) return null
  }
  return null
}

/** Lei 8: registro explícito com o ATOR (o trigger de linha loga os inserts, mas sem actor). */
async function audit(
  admin: SupabaseClient,
  actorId: string | null,
  action: string,
  subject: Subject,
  diff: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    actor: actorId,
    action,
    entity: subject.table,
    entity_id: subject.id,
    diff,
  })
  if (error) {
    // Auditoria é obrigatória (Lei 8) — mas o convite já aconteceu; logar alto e seguir.
    console.error(`audit_log falhou para ${action}/${subject.id}:`, error.message)
  }
}
