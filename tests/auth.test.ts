// M0 (Fase 2) — auth: provisionamento por papel (D6/D10/D14) + login por SENHA
// (ADR-014: link por e-mail só para ativar convite e redefinir senha).
// Exige supabase local com o config.toml aplicado (signup global OFF, senha mínima 8).
// Padrão da suíte: fixtures próprias com e-mail aleatório — re-executável sem reset.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { HOME_BY_ROLE, isPublicPath, resolveAccess, roleFromUser } from '../src/lib/auth/gate'
import { MIN_PASSWORD_LENGTH, validatePasswordPair } from '../src/lib/auth/password'
import { firstNameOf, provisionStudent } from '../src/lib/auth/provision'
import { anonClient, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent } from './helpers/db'

const service = serviceClient()

function randomEmail(): string {
  return `m0-${crypto.randomUUID().slice(0, 12)}@bancada.dev`
}

let sql: Sql
/**
 * O ATOR do convite (portão de deploy 29/07): o nascimento do perfil do aluno
 * passou a ser a RPC transacional `admin_create_student_profile`, que EXIGE
 * ator — a trilha "quem convidou e cadastrou este número" era fail-open e podia
 * sumir (Lei 8). Em produção o ator é o admin da action (`requireAdminId`);
 * aqui é um admin de fixture, porque a FK de `audit_log.actor` cobra perfil
 * real. `null` neste argumento agora é RECUSA — e é o que o caso próprio,
 * abaixo, prova.
 */
let atorDoConvite: string
beforeAll(async () => {
  sql = connect(2)
  atorDoConvite = await createAuthUser(sql, 'admin', 'Admin M0')
})
afterAll(async () => {
  await sql.end()
})

// ---------------------------------------------------------------------------
// Gate puro (unit) — a EXTRAÇÃO do papel e a matriz de acesso
// ---------------------------------------------------------------------------
describe('gate: roleFromUser (Lei 4)', () => {
  it('lê o papel de app_metadata', () => {
    expect(roleFromUser({ app_metadata: { role: 'student' } })).toBe('student')
    expect(roleFromUser({ app_metadata: { role: 'admin' } })).toBe('admin')
  })

  it('IGNORA papel forjado em user_metadata (caso 3 — unit)', () => {
    const forged = {
      user_metadata: { role: 'admin' },
      app_metadata: {},
    } as { app_metadata?: Record<string, unknown> }
    expect(roleFromUser(forged)).toBeNull()
  })

  it('papel desconhecido, ausente ou usuário nulo → null', () => {
    expect(roleFromUser({ app_metadata: { role: 'superuser' } })).toBeNull()
    expect(roleFromUser({ app_metadata: {} })).toBeNull()
    expect(roleFromUser(null)).toBeNull()
  })
})

describe('gate: resolveAccess', () => {
  it('sem papel → /login (inclusive autenticado sem role — janela de provisionamento)', () => {
    expect(resolveAccess(null, '/portal')).toEqual({ kind: 'redirect', to: '/login' })
    expect(resolveAccess(null, '/admin')).toEqual({ kind: 'redirect', to: '/login' })
    expect(resolveAccess(null, '/')).toEqual({ kind: 'redirect', to: '/login' })
  })

  it('rotas públicas liberadas para qualquer estado', () => {
    expect(resolveAccess(null, '/login')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/recuperar-senha')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/auth/confirm')).toEqual({ kind: 'allow' })
    expect(resolveAccess('student', '/auth/signout')).toEqual({ kind: 'allow' })
    // Webhooks são máquina-a-máquina (token na rota) — o gate NUNCA redireciona (M5).
    expect(resolveAccess(null, '/api/webhooks/asaas')).toEqual({ kind: 'allow' })
    // Telemetria (lote 26/07): o gate por PAPEL não serve — quem valida a
    // sessão é a própria rota. Sem isto, o beacon do aluno viraria redirect
    // para /portal e nada seria gravado.
    expect(resolveAccess('student', '/api/beacon')).toEqual({ kind: 'allow' })
    expect(resolveAccess('teacher', '/api/beacon')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/api/client-error')).toEqual({ kind: 'allow' })
    expect(resolveAccess('student', '/api/client-error')).toEqual({ kind: 'allow' })
    // Prefixo parecido não vaza a exceção.
    expect(resolveAccess('student', '/api/beacons')).toEqual({ kind: 'redirect', to: '/portal' })
  })

  it('telemetria é pública por IGUALDADE, não por prefixo (correção 10)', () => {
    // Uma rota futura pendurada sob /api/beacon/… herdaria a isenção se a
    // lista casasse por prefixo — e a isenção NÃO quer dizer "aberto", quer
    // dizer "quem decide é a rota". Rota nova que esquecesse de decidir
    // ficaria aberta em silêncio.
    expect(isPublicPath('/api/beacon')).toBe(true)
    expect(isPublicPath('/api/client-error')).toBe(true)
    expect(isPublicPath('/api/beacon/x')).toBe(false)
    expect(isPublicPath('/api/client-error/x')).toBe(false)
    expect(resolveAccess('student', '/api/beacon/x')).toEqual({ kind: 'redirect', to: '/portal' })
    expect(resolveAccess(null, '/api/client-error/x')).toEqual({ kind: 'redirect', to: '/login' })
    // A família de webhooks CONTINUA por prefixo (é o desenho dela).
    expect(isPublicPath('/api/webhooks/asaas')).toBe(true)
  })

  it('/definir-senha: qualquer papel autenticado entra; anônimo → /login (ADR-014)', () => {
    expect(resolveAccess('student', '/definir-senha')).toEqual({ kind: 'allow' })
    expect(resolveAccess('admin', '/definir-senha')).toEqual({ kind: 'allow' })
    expect(resolveAccess('teacher', '/definir-senha')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/definir-senha')).toEqual({ kind: 'redirect', to: '/login' })
    // Prefixo parecido não vaza a exceção.
    expect(resolveAccess('student', '/definir-senhax')).toEqual({
      kind: 'redirect',
      to: '/portal',
    })
  })

  it('cada papel vive no seu prefixo; prefixo errado redireciona para o home', () => {
    expect(resolveAccess('student', '/portal')).toEqual({ kind: 'allow' })
    expect(resolveAccess('student', '/portal/aulas')).toEqual({ kind: 'allow' })
    expect(resolveAccess('student', '/admin')).toEqual({ kind: 'redirect', to: '/portal' })
    expect(resolveAccess('teacher', '/portal')).toEqual({ kind: 'redirect', to: '/teacher' })
    expect(resolveAccess('sales', '/admin/x')).toEqual({ kind: 'redirect', to: '/sales' })
    // Caso 12 da Fase 3 (letra do gate): aluno/sales nunca entram em /teacher.
    expect(resolveAccess('student', '/teacher')).toEqual({ kind: 'redirect', to: '/portal' })
    expect(resolveAccess('sales', '/teacher/x')).toEqual({ kind: 'redirect', to: '/sales' })
  })

  it('admin acessa todos os prefixos; "/" redireciona pelo papel', () => {
    expect(resolveAccess('admin', '/admin')).toEqual({ kind: 'allow' })
    expect(resolveAccess('admin', '/portal')).toEqual({ kind: 'allow' })
    // Home do admin é /admin — desde a rodada 2 do re-layout uma PÁGINA REAL
    // (dashboard), o que satisfaz a regra do Next 16: redirect de action para
    // rota-que-só-redireciona trava a resposta (ADR-014).
    expect(resolveAccess('admin', '/')).toEqual({ kind: 'redirect', to: '/admin' })
    expect(resolveAccess('student', '/')).toEqual({ kind: 'redirect', to: '/portal' })
  })

  it('prefixo parecido não vaza (/portalx não é /portal)', () => {
    expect(resolveAccess('student', '/portalx')).toEqual({ kind: 'redirect', to: '/portal' })
  })
})

// ---------------------------------------------------------------------------
// PINO de comportamento do GoTrue local (decide a ordem do provisionamento):
// convite para usuário EXISTENTE não-confirmado deve REENVIAR, não falhar.
// Se este teste quebrar numa atualização do GoTrue, a ordem createUser→invite
// do provisionStudent precisa ser revista.
// ---------------------------------------------------------------------------
describe('pino GoTrue: invite após createUser', () => {
  it('inviteUserByEmail reenvia para usuário não-confirmado (sem 422)', async () => {
    const email = randomEmail()
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email,
      app_metadata: { role: 'student' },
    })
    expect(createErr).toBeNull()

    const { error: inviteErr } = await service.auth.admin.inviteUserByEmail(email)
    expect(inviteErr).toBeNull()

    const [{ count }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(count).toBe(1)

    await service.auth.admin.deleteUser(created!.user!.id)
  })
})

// ---------------------------------------------------------------------------
// Fluxo D6: provisionStudent (o mesmo núcleo que a server action usa)
// ---------------------------------------------------------------------------
describe('D6: convite de aluno existente', () => {
  it('cria auth user + profile (iana_tz COPIADO, nunca default) + vincula + audita', async () => {
    // Lisboa de propósito: prova que o fuso vem do aluno, não do default do profiles.
    const studentId = await createStudent(sql, 'Europe/Lisbon')
    const email = randomEmail()

    const outcome = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    expect(outcome.status).toBe('invited')
    const userId = (outcome as { userId: string }).userId

    const { data: got } = await service.auth.admin.getUserById(userId)
    expect(got?.user?.app_metadata?.role).toBe('student')
    expect(got?.user?.user_metadata?.first_name).toBe('Aluno')
    expect(got?.user?.email_confirmed_at ?? null).toBeNull() // ativa só no clique

    const [profile] = await sql`
      select role, full_name, iana_tz from profiles where id = ${userId}`
    expect(profile.role).toBe('student')
    expect(profile.iana_tz).toBe('Europe/Lisbon')

    const [student] = await sql`
      select profile_id, display_name from students where id = ${studentId}`
    expect(student.profile_id).toBe(userId)
    expect(profile.full_name).toBe(student.display_name)

    const [auditRow] = await sql`
      select actor, diff from audit_log
      where action = 'invite_student' and entity_id = ${studentId}`
    expect(auditRow).toBeDefined()
    expect(auditRow.diff.email).toBe(email)

    // PORTÃO DE DEPLOY 29/07 (bloqueador 2, Lei 8): o número não nasce mais por
    // um INSERT em TS com auditoria fail-open ao lado. A trilha do NASCIMENTO
    // commitou junto com o perfil, e ela tem ATOR — antes, uma falha do audit
    // deixava usuário, perfil, número e convite de pé sem ninguém responder por
    // "quem cadastrou este número".
    const [nascimento] = await sql`
      select actor, diff from audit_log
      where action = 'create_student_whatsapp' and entity_id = ${userId}::text`
    expect(nascimento).toBeDefined()
    expect(nascimento.actor).toBe(atorDoConvite)
    expect(nascimento.diff.whatsapp_e164).toBe('+5565900000001')
    const [comNumero] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(comNumero.whatsapp_e164).toBe('+5565900000001')
  })

  it('PROVA DE MUTAÇÃO do nascimento: sem ator NADA nasce (nem user, nem perfil, nem convite)', async () => {
    // A régua vive no banco (a RPC recusa `p_actor` nulo), e o motor devolve o
    // erro em vez de seguir. Se alguém reabrir o INSERT direto em TS para "não
    // depender do ator", este caso fica vermelho: hoje um convite sem ator é
    // impossível, não é "auditado depois".
    const studentId = await createStudent(sql)
    const email = randomEmail()

    const outcome = await provisionStudent(service, studentId, email, null, '+5565900000001')
    expect(outcome.status).toBe('error')
    expect(outcome.status === 'error' && outcome.message).toMatch(/ator obrigatório/i)

    // o usuário criado no meio do caminho foi desfeito pelo rollback compensado
    const [{ count: users }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(users).toBe(0)
    const [student] = await sql`select profile_id from students where id = ${studentId}`
    expect(student.profile_id).toBeNull()
  })

  it('re-convite: reenvia sem duplicar nada (1 user, 1 profile, vínculo intacto)', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()

    const first = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    expect(first.status).toBe('invited')
    const userId = (first as { userId: string }).userId
    // Correção 28/07 (rodadas 3/4, caracterização honesta): este 5º argumento
    // no RE-convite não é enchimento de assinatura — com o perfil já existente,
    // ele dispara a RPC transacional `admin_update_student_whatsapp`, que
    // EXIGE ator (a FK do audit_log cobra profile real; em produção é o admin
    // da action — aqui o próprio perfil serve para provar o mecanismo).
    const again = await provisionStudent(service, studentId, email, userId, '+5565900000001')
    expect(again.status).toBe('re_invited')

    const [{ count: users }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(users).toBe(1)
    const [{ count: profiles }] = await sql`
      select count(*)::int as count from profiles p
      join students s on s.profile_id = p.id where s.id = ${studentId}`
    expect(profiles).toBe(1)
    // …e a prova do efeito novo: o número persistiu e a trilha tem AUTOR
    // (rodada 4: a RPC recusa p_actor NULL — trilha sem autor era o defeito).
    const [p] = await sql`select whatsapp_e164 from profiles where id = ${userId}`
    expect(p.whatsapp_e164).toBe('+5565900000001')
    const trilha = await sql`
      select 1 from audit_log
       where action = 'update_student_whatsapp'
         and entity_id = ${userId}::text and actor = ${userId}`
    expect(trilha.length).toBeGreaterThanOrEqual(1)
  })

  it('re-convite com OUTRO e-mail → erro claro, nada muda', async () => {
    const studentId = await createStudent(sql)
    await provisionStudent(service, studentId, randomEmail(), atorDoConvite, '+5565900000001')

    const outcome = await provisionStudent(service, studentId, randomEmail(), atorDoConvite, '+5565900000001')
    expect(outcome.status).toBe('error')
    expect((outcome as { message: string }).message).toContain('outro e-mail')
  })

  it('aluno que já ativou → already_active (não reenvia)', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    const first = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    const userId = (first as { userId: string }).userId
    await sql`update auth.users set email_confirmed_at = now() where id = ${userId}`

    // Correção 28/07 (rodadas 3/4, caracterização honesta): no "já ativo" o 5º
    // argumento TAMBÉM escreve — o número do formulário atualiza o perfil pela
    // mesma RPC transacional, que agora EXIGE ator (aqui o próprio perfil
    // serve; em produção é o admin da action). Só o e-mail é que não sai.
    const outcome = await provisionStudent(service, studentId, email, userId, '+5565900000001')
    expect(outcome.status).toBe('already_active')
    const trilha = await sql`
      select 1 from audit_log
       where action = 'update_student_whatsapp'
         and entity_id = ${userId}::text and actor = ${userId}`
    expect(trilha.length).toBeGreaterThanOrEqual(1)
  })

  it('e-mail que já pertence a outra conta → erro claro', async () => {
    const email = randomEmail()
    const studentA = await createStudent(sql)
    const studentB = await createStudent(sql)
    await provisionStudent(service, studentA, email, atorDoConvite, '+5565900000001')

    const outcome = await provisionStudent(service, studentB, email, atorDoConvite, '+5565900000001')
    expect(outcome.status).toBe('error')
    expect((outcome as { message: string }).message).toContain('já pertence')
  })

  it('firstNameOf pega o primeiro nome', () => {
    expect(firstNameOf('Bianca Bastos')).toBe('Bianca')
    expect(firstNameOf('  Tomás  Estevão ')).toBe('Tomás')
  })

  it('recupera ÓRFÃO de execução interrompida (auth user sem profile) em vez de travar o e-mail', async () => {
    const email = randomEmail()
    // Simula crash de execução anterior: usuário existe, profile/vínculo não.
    await service.auth.admin.createUser({ email, app_metadata: { role: 'student' } })

    const studentId = await createStudent(sql)
    const outcome = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    expect(outcome.status).toBe('invited')
    const userId = (outcome as { userId: string }).userId

    const [{ count }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(count).toBe(1) // adotou, não duplicou
    const [student] = await sql`select profile_id from students where id = ${studentId}`
    expect(student.profile_id).toBe(userId)
  })

  it('auditoria existe MESMO se o e-mail de convite falhar (Lei 8 antes do envio)', async () => {
    // Não dá para derrubar o SMTP no teste; provamos a ordem pelo código-fonte do fluxo
    // (audit antes de inviteUserByEmail) + o caminho feliz já assevera a linha de audit.
    // Este teste pina a POSIÇÃO: o audit de invite_student nunca depende do envio.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/lib/auth/provision.ts', 'utf8'),
    )
    const auditPos = src.indexOf("'invite_student'")
    const invitePos = src.indexOf('inviteUserByEmail(email.trim())')
    expect(auditPos).toBeGreaterThan(0)
    expect(invitePos).toBeGreaterThan(0)
    expect(auditPos).toBeLessThan(invitePos)
  })
})

// ---------------------------------------------------------------------------
// Regras de senha (ADR-014) — validador puro que a action de /definir-senha usa
// ---------------------------------------------------------------------------
describe('ADR-014: validatePasswordPair', () => {
  // Item 6 do e2e (Leva 0 ratificada): checklist clássico — 'fraca' entra na
  // escada ANTES de comparar o par (a UI mostra o checklist no 1º campo).
  it('curta → curta; sem os 5 requisitos → fraca; pares diferentes → nao-confere; válido → null', () => {
    expect(validatePasswordPair('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'x')).toBe('curta')
    expect(validatePasswordPair('a'.repeat(MIN_PASSWORD_LENGTH), 'a'.repeat(MIN_PASSWORD_LENGTH))).toBe('fraca')
    expect(validatePasswordPair('Senha-boa-123', 'Senha-outra-123')).toBe('nao-confere')
    expect(validatePasswordPair('Senha-boa-123', 'Senha-boa-123')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Casos 1–3 do goal (fluxo real de sessão, sem e-mail — generateLink/verifyOtp)
// ---------------------------------------------------------------------------
describe('caso 1: ativação por convite e login por SENHA (ADR-014)', () => {
  it('link de convite (token_hash real do banco) ativa e loga com papel student', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')

    // O e-mail carrega {{ .TokenHash }} — que é exatamente o confirmation_token salvo.
    const [{ confirmation_token }] = await sql`
      select confirmation_token from auth.users where email = ${email}`
    expect(confirmation_token).toBeTruthy()

    const client = anonClient()
    const { data, error } = await client.auth.verifyOtp({
      type: 'invite',
      token_hash: confirmation_token,
    })
    expect(error).toBeNull()
    expect(roleFromUser(data.user)).toBe('student')
    expect(HOME_BY_ROLE[roleFromUser(data.user)!]).toBe('/portal')

    const [{ email_confirmed_at }] = await sql`
      select email_confirmed_at from auth.users where email = ${email}`
    expect(email_confirmed_at).not.toBeNull()
  })

  it('fluxo completo: convite → cria senha → sai → volta com e-mail+senha', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    const password = `Pt0-os-${crypto.randomUUID().slice(0, 12)}`
    await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')

    // Ativa pelo link do convite (sessão nasce aqui) e define a senha — o mesmo
    // updateUser({password}) da action de /definir-senha.
    const [{ confirmation_token }] = await sql`
      select confirmation_token from auth.users where email = ${email}`
    const activation = anonClient()
    const { error: verifyErr } = await activation.auth.verifyOtp({
      type: 'invite',
      token_hash: confirmation_token,
    })
    expect(verifyErr).toBeNull()
    const { error: setErr } = await activation.auth.updateUser({ password })
    expect(setErr).toBeNull()
    await activation.auth.signOut()

    // Login corrente: e-mail + senha, cliente novo (celular de amanhã).
    const client = anonClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    expect(error).toBeNull()
    expect(roleFromUser(data.user)).toBe('student')
    expect(HOME_BY_ROLE[roleFromUser(data.user)!]).toBe('/portal')
  })

  it('senha errada → invalid_credentials; senha < 8 é recusada pelo GOTRUE', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    const password = `Pt0-os-${crypto.randomUUID().slice(0, 12)}`
    await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')

    const [{ confirmation_token }] = await sql`
      select confirmation_token from auth.users where email = ${email}`
    const activation = anonClient()
    await activation.auth.verifyOtp({ type: 'invite', token_hash: confirmation_token })

    // Quem barra senha fraca de verdade é o GoTrue (minimum_password_length = 8) —
    // a validação da action é só UX, um request forjado não passa por ela.
    const { error: weakErr } = await activation.auth.updateUser({ password: 'curta12' })
    expect(weakErr).not.toBeNull()

    const { error: setErr } = await activation.auth.updateUser({ password })
    expect(setErr).toBeNull()
    await activation.auth.signOut()

    const { data, error } = await anonClient().auth.signInWithPassword({
      email,
      password: 'senha-errada-999',
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('invalid_credentials')
    expect(data?.session ?? null).toBeNull()
  })
})

describe('ADR-014: esqueci minha senha (recovery)', () => {
  it('link de recovery abre sessão; senha nova vale, a velha morre', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    const oldPassword = `Pt0-old-${crypto.randomUUID().slice(0, 8)}`
    const newPassword = `Pt0-new-${crypto.randomUUID().slice(0, 8)}`
    await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    await sql`update auth.users set email_confirmed_at = now() where email = ${email}`
    await service.auth.admin.updateUserById(
      (await service.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find(
        (u) => u.email === email,
      )!.id,
      { password: oldPassword },
    )

    // O e-mail de recovery carrega {{ .TokenHash }} → /auth/confirm?type=recovery.
    const { data: link, error: linkErr } = await service.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    expect(linkErr).toBeNull()

    const recovery = anonClient()
    const { error: verifyErr } = await recovery.auth.verifyOtp({
      type: 'recovery',
      token_hash: link!.properties!.hashed_token,
    })
    expect(verifyErr).toBeNull()
    const { error: setErr } = await recovery.auth.updateUser({ password: newPassword })
    expect(setErr).toBeNull()
    await recovery.auth.signOut()

    const { error: oldErr } = await anonClient().auth.signInWithPassword({
      email,
      password: oldPassword,
    })
    expect(oldErr).not.toBeNull()

    const { data, error } = await anonClient().auth.signInWithPassword({
      email,
      password: newPassword,
    })
    expect(error).toBeNull()
    expect(roleFromUser(data.user)).toBe('student')
  })
})

describe('caso 2: e-mail não cadastrado NUNCA cria conta (D6 no servidor)', () => {
  it('signInWithOtp com shouldCreateUser:false → recusado, zero usuários', async () => {
    const email = randomEmail()
    const { error } = await anonClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    expect(error).not.toBeNull()
    const [{ count }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(count).toBe(0)
  })

  it('mesmo FORJANDO shouldCreateUser:true, o GoTrue barra (signup global OFF)', async () => {
    const email = randomEmail()
    const { error } = await anonClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    expect(error).not.toBeNull()
    const [{ count }] = await sql`
      select count(*)::int as count from auth.users where email = ${email}`
    expect(count).toBe(0)
  })

  it('convidado que NUNCA ativou também não recebe magic link (usa o reenvio do admin)', async () => {
    const studentId = await createStudent(sql)
    const email = randomEmail()
    await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001') // não-confirmado

    const { data, error } = await anonClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    expect(error).not.toBeNull()
    expect(data?.session ?? null).toBeNull()
  })
})

describe('caso 3: papel forjado em user_metadata não concede NADA', () => {
  it('sessão real: app_metadata student + user_metadata admin → gate nega /admin', async () => {
    const email = randomEmail()
    const { data: created } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: 'student' },
      user_metadata: { role: 'admin' }, // ataque canônico da Lei 4
    })
    expect(created?.user).toBeTruthy()

    const { data: link } = await service.auth.admin.generateLink({ type: 'magiclink', email })
    const client = anonClient()
    const { data, error } = await client.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link!.properties!.hashed_token,
    })
    expect(error).toBeNull()

    const role = roleFromUser(data.user)
    expect(role).toBe('student')
    expect(resolveAccess(role, '/admin')).toEqual({ kind: 'redirect', to: '/portal' })

    await service.auth.admin.deleteUser(created!.user!.id)
  })
})
