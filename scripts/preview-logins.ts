// Logins de PREVIEW local (pós `supabase db reset`): admin + professora + aluno
// com senha fixa, ligados aos dados REAIS do seed (a professora / Sabrina).
// NUNCA rodar contra produção — é ferramenta de bancada.
//
// Uso: node --env-file=.env.local scripts/preview-logins.ts
// Cria/garante (idempotente):
//   teste-senha@local.dev  / Senha-local-12345   (admin)
//   prof-preview@local.dev / Preview-12345       (teacher → a professora)
//   aluno-preview@local.dev/ Preview-12345       (student → Sabrina)
//   aluno2-preview@local.dev / Preview-12345     (student → "Briefing Pendente
//                                                 (bancada)", criado pelo
//                                                 preview-seed)
//   aluno3-preview@local.dev / Preview-12345     (student → "Re-briefing
//                                                 (bancada)", criado pelo
//                                                 preview-seed)
//
// ⚠️ O SEGUNDO ALUNO NÃO É LIGADO A NINGUÉM AQUI, e isso é ordem de execução,
// não esquecimento: o aluno dele não existe no seed real — quem cria a linha de
// `students` (e a aponta para este perfil) é `scripts/preview-seed.ts`, que roda
// DEPOIS deste script. Aqui nasce só a conta de Auth + o perfil.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes.')
  process.exit(1)
}
if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
  console.error(`URL não é local (${url}) — este script é só de bancada. Abortando.`)
  process.exit(1)
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// Correção 28/07 (WhatsApp = canal de contrato): conta de ALUNO confirmada
// nasce com número — a bancada respeita a invariante desde a criação, em vez
// de depender do conserto posterior do preview-seed.
async function ensureUser(
  email: string,
  password: string,
  role: string,
  fullName: string,
  tz: string,
  whatsapp?: string,
) {
  let user
  for (let p = 1; p <= 20 && !user; p++) {
    const { data: page, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 })
    if (error) throw error
    user = page.users.find((u) => u.email?.toLowerCase() === email)
    if (page.users.length < 200) break
  }
  if (user) {
    const { data, error: e } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { first_name: fullName.split(' ')[0] },
    })
    if (e) throw e
    user = data.user
  } else {
    const { data, error: e } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { first_name: fullName.split(' ')[0] },
    })
    if (e) throw e
    user = data.user!
  }
  const { error: pe } = await admin
    .from('profiles')
    .upsert({ id: user.id, role, full_name: fullName, iana_tz: tz, ...(whatsapp ? { whatsapp_e164: whatsapp } : {}) })
  if (pe) throw pe
  console.log(`${email} ok (${role}, ${user.id})`)
  return user.id
}

async function main() {
  await ensureUser('teste-senha@local.dev', 'Senha-local-12345', 'admin', 'Teste Senha', 'America/Cuiaba')

  const profId = await ensureUser(
    'prof-preview@local.dev', 'Preview-12345', 'teacher', 'Renata (preview)', 'America/Sao_Paulo',
  )
  const { error: te } = await admin
    .from('teachers')
    .update({ profile_id: profId })
    .eq('display_name', 'Renata')
  if (te) throw te
  console.log('teachers.Renata ← prof-preview')

  const alunoId = await ensureUser(
    'aluno-preview@local.dev', 'Preview-12345', 'student', 'Sabrina (preview)', 'America/Cuiaba',
    '+5565900030003',
  )
  const { error: se } = await admin
    .from('students')
    .update({ profile_id: alunoId })
    .eq('display_name', 'Sabrina')
  if (se) throw se
  console.log('students.Sabrina ← aluno-preview')

  await ensureUser(
    'aluno2-preview@local.dev', 'Preview-12345', 'student', 'Briefing Pendente (preview)', 'America/Cuiaba',
    '+5565900040004',
  )
  console.log('aluno2-preview criado — o vínculo com students é do preview-seed')

  await ensureUser(
    'aluno3-preview@local.dev', 'Preview-12345', 'student', 'Re-briefing (preview)', 'America/Cuiaba',
    '+5565900050005',
  )
  console.log('aluno3-preview criado — o vínculo com students é do preview-seed')
}

main().catch((err) => {
  console.error('preview-logins falhou:', err)
  process.exit(1)
})
