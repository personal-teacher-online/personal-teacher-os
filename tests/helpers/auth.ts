import { SignJWT } from 'jose'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

// Valores padrão do Supabase local (demo). Sobrescreva por env se customizar o config.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

export type AppRole = 'admin' | 'teacher' | 'student' | 'sales'

/** JWT de teste assinado com o secret local, com app_metadata.role (Lei 4). */
export async function signTestJwt(
  userId: string,
  role: AppRole,
  opts: { forgeInUserMetadata?: boolean } = {},
): Promise<string> {
  return new SignJWT({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'supabase-demo',
    // Ataque canônico da Lei 4: papel forjado em user_metadata (editável pelo
    // usuário) NUNCA pode conceder acesso — app_metadata é a única fonte.
    ...(opts.forgeInUserMetadata ? { user_metadata: { role } } : { app_metadata: { role } }),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET))
}

/** Cliente supabase-js autenticado como um papel de teste (passa pelo PostgREST + RLS). */
export async function clientAs(
  userId: string,
  role: AppRole,
  opts: { forgeInUserMetadata?: boolean } = {},
): Promise<SupabaseClient> {
  const jwt = await signTestJwt(userId, role, opts)
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cliente anônimo (apenas anon key). */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** Cliente service-role LOCAL (demo) — exercita o mesmo caminho do servidor Next (M0+). */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cria usuário em auth.users + profile; retorna o id (== profile id).
 *  Colunas de token como '' (nunca NULL): o GoTrue escreve '' e o scanner Go dele
 *  quebra com NULL — linha manual com NULL derruba /admin/users (listUsers) inteiro.
 *
 *  ── POR QUE O ALUNO NASCE COM NÚMERO DE WHATSAPP (A6/i) ────────────────────
 *  O gatilho `students_lead_sem_login` passou a recusar vincular `profile_id` a
 *  uma ficha quando o perfil não tem `whatsapp_e164`: "quem tem acesso ao portal
 *  tem número" deixou de ser regra só do TypeScript e virou invariante do banco.
 *  Fixture de aluno representa a conta NORMAL — a que nasceu pelo convite, onde
 *  o número é obrigatório no provisionamento —, então ela nasce com número, como
 *  já acontece com `tz_confirmed` em `createStudent`.
 *  Quem precisa do outro estado (perfil SEM número, para exercitar a recusa ou a
 *  limpeza deliberada do admin) pede explicitamente: `{ whatsapp: null }`. */
export async function createAuthUser(
  sql: Sql,
  role: AppRole,
  name: string,
  opts: { whatsapp?: string | null } = {},
): Promise<string> {
  const [u] = await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data,
                            confirmation_token, recovery_token, email_change,
                            email_change_token_new, email_change_token_current,
                            phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', ${crypto.randomUUID().slice(0, 8) + '@bancada.dev'}, '',
            now(), now(), now(), ${sql.json({ role })},
            '', '', '', '', '', '', '', '')
    returning id`
  // E.164 canônico (a régua do CHECK `profiles_whatsapp_e164_formato`), único por
  // fixture para não colidir com dedupe de envio.
  const numero =
    opts.whatsapp !== undefined
      ? opts.whatsapp
      : role === 'student'
        ? '+5565' + String(Math.floor(Math.random() * 90_000_000) + 10_000_000)
        : null
  await sql`
    insert into profiles (id, role, full_name, whatsapp_e164)
    values (${u.id}, ${role}::user_role, ${name}, ${numero})`
  return u.id as string
}
