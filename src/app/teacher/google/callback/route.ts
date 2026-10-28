import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { exchangeGoogleCode, googleOAuthConfigFromEnv } from '@/lib/google/oauth'
import { syncTeacherCalendarSoon } from '@/lib/google/sync'
import { encryptToken, tokenKeyFromEnv } from '@/lib/google/token-crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { cookieDoFlash } from '@/lib/portal/flash'

// ADR-017/M3: retorno do consentimento Google. Valida sessão + CSRF (state ==
// cookie httpOnly), troca o code por refresh_token, CIFRA e grava via
// service_role. O redirect de volta é sempre para /teacher com mensagem
// amigável — nunca stack trace na cara da professora.

export async function GET(request: Request) {
  const url = new URL(request.url)
  const cfg = googleOAuthConfigFromEnv()
  const key = tokenKeyFromEnv()

  // Base do redirect de volta: NUNCA request.url — dentro do container ele é
  // http://0.0.0.0:3000 (bind interno) e o Safari bloqueia essa porta. Usamos a
  // origem do redirectUrl do OAuth, que é o domínio público por onde o Google
  // devolveu a professora (app.personal-teacher.com em produção).
  const base = cfg
    ? new URL(cfg.redirectUrl).origin
    : process.env.NODE_ENV === 'production'
      ? 'https://app.personal-teacher.com'
      : url.origin
  const back = (msg: string) => {
    // O desfecho vai num cookie de flash (nunca na URL: link forjado não afirma nada).
    const res = NextResponse.redirect(new URL('/teacher', base))
    const { nome, valor, opcoes } = cookieDoFlash(msg)
    res.cookies.set(nome, valor, opcoes)
    res.cookies.delete({ name: 'gcal-oauth-state', path: '/teacher/google' })
    return res
  }

  if (!cfg || !key) return back('Integração com o Google ainda não está configurada no servidor.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id, display_name')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  if (!teacher || !user) return back('Sua conta não está vinculada a uma professora.')

  // Professora clicou "cancelar" na tela do Google — não é erro nosso.
  if (url.searchParams.get('error')) {
    return back('Conexão cancelada — nada foi alterado.')
  }

  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const jar = await cookies()
  const saved = jar.get('gcal-oauth-state')?.value
  if (!code || !state || !saved || state !== saved) {
    return back('A conexão expirou ou veio de outra aba — tente de novo pelo botão.')
  }

  let tokens: Awaited<ReturnType<typeof exchangeGoogleCode>>
  try {
    tokens = await exchangeGoogleCode(cfg, code)
  } catch {
    return back('O Google recusou a troca de credenciais — tente de novo em instantes.')
  }
  if ('error' in tokens) return back(tokens.error) // texto NOSSO (oauth.ts), nunca do Google

  // Upsert: reconectar (mesma professora, conta igual ou trocada) substitui a
  // credencial e zera o bookkeeping de sync. O trigger audita a linha; o insert
  // explícito abaixo registra o ATOR (Lei 8, padrão provision.ts).
  const admin = createAdminClient()
  const { error: upsertErr } = await admin.from('teacher_google_accounts').upsert(
    {
      teacher_id: teacher.id,
      google_email: tokens.email || '(e-mail não informado)',
      refresh_token_cipher: encryptToken(tokens.refreshToken, key),
      connected_at: new Date().toISOString(),
      last_sync_at: null,
      last_sync_error: null,
    },
    { onConflict: 'teacher_id' },
  )
  if (upsertErr) {
    console.error('[professora · conexão do Google não salva]', upsertErr.message)
    return back('Falha ao salvar a conexão: não consegui gravar agora. Tente de novo em instantes.')
  }

  // Retomada 01/09/2026 (onda Agenda e Mensagens · M1): a PRIMEIRA sincronização
  // nasce aqui, no ato de conectar. Antes, nada rodava até a próxima ação ou o
  // job diário, e o painel ficava em "primeira sincronização ainda não rodou"
  // com a agenda dela vazia. Fire-and-forget deliberado — o mesmo gancho das
  // actions: a professora não espera o Google, e a rodada diária corrige
  // qualquer perda. Nunca lança.
  syncTeacherCalendarSoon(admin, teacher.id)

  const { error: auditErr } = await admin.from('audit_log').insert({
    actor: user.id,
    action: 'connect_google_calendar',
    entity: 'teachers',
    entity_id: teacher.id,
    diff: { google_email: tokens.email || null },
  })
  if (auditErr) {
    // Lei 8: obrigatória — mas a conexão já persistiu; logar alto e seguir
    // (mesmo trade-off documentado em provision.ts).
    console.error(`audit_log falhou para connect_google_calendar/${teacher.id}:`, auditErr.message)
  }

  return back(
    tokens.email
      ? `Google Agenda conectada como ${tokens.email}. ✅ Suas aulas aparecem lá em instantes.`
      : 'Google Agenda conectada. ✅ Suas aulas aparecem lá em instantes.',
  )
}
