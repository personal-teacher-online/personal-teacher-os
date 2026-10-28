// Bootstrap do PRIMEIRO admin (ovo-e-galinha: /admin exige admin, mas ninguém existe).
// Idempotente: rodar de novo só garante papel/perfil. Cria já CONFIRMADO (convidado
// não-confirmado não consegue pedir magic link — o admin loga direto pelo /login).
//
// Uso (local):  npm run bootstrap:admin -- dona@exemplo.com "Dona"
// Uso (prod):   node --env-file=.env.production scripts/bootstrap-admin.ts email "Nome"
// Requer: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente.
// (Node ≥ 23 roda .ts nativamente; sem enums/decorators aqui de propósito.)

import { createClient } from '@supabase/supabase-js'

const BUSINESS_TZ = 'America/Cuiaba'

async function main() {
  const [email, fullName] = process.argv.slice(2)
  if (!email || !fullName) {
    console.error('Uso: node --env-file=.env.local scripts/bootstrap-admin.ts <email> "<Nome Completo>"')
    process.exit(1)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente.')
    process.exit(1)
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const firstName = fullName.trim().split(/\s+/)[0]

  // Já existe? (idempotência)
  const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) throw listErr
  let user = page.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { role: 'admin' },
      user_metadata: { first_name: firstName },
    })
    if (error) throw error
    user = data.user
    console.log(`Usuário já existia (${user.id}) — papel admin garantido.`)
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: 'admin' },
      user_metadata: { first_name: firstName },
    })
    if (error) throw error
    user = data.user!
    console.log(`Usuário admin criado (${user.id}).`)
  }

  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: user.id, role: 'admin', full_name: fullName, iana_tz: BUSINESS_TZ })
  if (profileErr) throw profileErr

  const { error: auditErr } = await admin.from('audit_log').insert({
    actor: user.id,
    action: 'bootstrap_admin',
    entity: 'profiles',
    entity_id: user.id,
    diff: { email, full_name: fullName },
  })
  if (auditErr) console.error('audit_log falhou:', auditErr.message)

  console.log(`OK: ${email} é admin. Login: /login → magic link.`)
}

main().catch((err) => {
  console.error('Bootstrap falhou:', err)
  process.exit(1)
})
