// Gate de autorização por papel — funções PURAS, sem dependência de Next/Supabase,
// para o proxy usar e o Vitest testar diretamente.

export const ROLES = ['admin', 'teacher', 'student', 'sales'] as const
export type Role = (typeof ROLES)[number]

// ⚠️ Cada home DEVE ser uma página real, nunca uma rota que só redirect()a:
// server action que redireciona para rota-que-redireciona trava a resposta no
// Next 16 — o navegador mostra "This page couldn't load" (bug reproduzido
// local e em produção, ADR-014). Desde a rodada 2 do re-layout, /admin é uma
// página real (dashboard "Início").
export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/admin',
  teacher: '/teacher',
  student: '/portal',
  sales: '/sales',
}

// /api/webhooks: endpoints máquina-a-máquina (Asaas etc.) — autenticados por TOKEN
// próprio dentro da rota (Lei 6/D7), nunca por sessão; o gate não pode redirecionar.
const PUBLIC_PATHS = [
  '/login',
  '/recuperar-senha',
  '/convite-expirado', // F7/M4-2: página do link vencido + reenvio neutro
  '/auth/confirm',
  '/auth/signout',
  '/wa', // ADR-019: troca o magic link do WhatsApp por sessão (uso único)
  // Entrada automática de BANCADA (pedido do dono, 26/07): a rota inteira só
  // existe quando BANCADA_AUTOLOGIN=1 (env que mora SÓ no .env.local) e o host
  // é localhost — em produção devolve 404 antes de qualquer efeito.
  '/dev-entrar',
  '/api/webhooks',
  // ADR-021: superfície do pipeline n8n da fábrica de conteúdo — PREFIXO (como
  // /api/webhooks): todas as rotas sob /api/content compartilham o mesmo guard
  // fail-closed de token (CONTENT_API_TOKEN) em src/lib/content/handle.ts.
  '/api/content',
]

/**
 * Público por IGUALDADE EXATA — `/api/beacon` é público, `/api/beacon/x` não.
 *
 * A lista de cima casa por PREFIXO, o que é certo para famílias de rota
 * (`/api/webhooks/*` inteira usa o mesmo guard de token). Para caminho único
 * o prefixo é generoso demais: qualquer rota futura pendurada embaixo herdaria
 * a isenção sem ninguém decidir isso — e a isenção aqui NÃO significa "aberto",
 * significa "o gate por papel não decide; quem decide é a rota". Uma rota nova
 * sob esse caminho que esquecesse de decidir ficaria aberta em silêncio.
 * (Correção 10 da revisão adversarial de 26/07.)
 */
const PUBLIC_EXACT = [
  // Telemetria (lote 26/07): /api/beacon valida a sessão dentro da rota (sem
  // sessão, descarta) e /api/client-error precisa aceitar erro de página
  // pública. Sem a isenção, o beacon de um aluno cairia no redirect para
  // /portal, que é a home dele, e nada seria gravado.
  '/api/beacon',
  '/api/client-error',
  // Rotas de job (cron/wget com token próprio, fail-closed): os comentários
  // SEMPRE disseram "caminho exato", mas viviam na lista de prefixo — mesma
  // classe do achado 10 da revisão de 26/07. Movidas para cá: /api/jobs/x/y
  // não herda isenção em silêncio.
  '/api/jobs/dispatch-outbox',
  '/api/jobs/sync-hotmart',
  '/api/jobs/sync-gcal',
  '/api/jobs/audit-recordings',
  '/api/jobs/generate-content',
]

// Autenticado de QUALQUER papel (ADR-014): /definir-senha atende convite recém-aceito
// e redefinição — o usuário tem sessão mas ainda não deve cair no home do papel.
const ANY_ROLE_PATHS = ['/definir-senha']

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Papel do usuário — lido EXCLUSIVAMENTE de app_metadata (Lei 4).
 * user_metadata é editável pelo próprio usuário e NUNCA é consultado:
 * um papel forjado ali não concede nada (caso de teste 3 do goal).
 */
export function roleFromUser(
  user: { app_metadata?: Record<string, unknown> } | null | undefined,
): Role | null {
  const role = user?.app_metadata?.role
  return typeof role === 'string' && (ROLES as readonly string[]).includes(role)
    ? (role as Role)
    : null
}

export type Access = { kind: 'allow' } | { kind: 'redirect'; to: string }

/**
 * Matriz de acesso: cada papel vive no seu prefixo; admin acessa tudo;
 * sem papel (não autenticado OU sem role válido em app_metadata) → /login.
 */
export function resolveAccess(role: Role | null, pathname: string): Access {
  if (isPublicPath(pathname)) return { kind: 'allow' }
  if (role === null) return { kind: 'redirect', to: '/login' }
  if (ANY_ROLE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')))
    return { kind: 'allow' }
  if (pathname === '/') return { kind: 'redirect', to: HOME_BY_ROLE[role] }
  if (role === 'admin') return { kind: 'allow' }
  const home = HOME_BY_ROLE[role]
  if (pathname === home || pathname.startsWith(home + '/')) return { kind: 'allow' }
  return { kind: 'redirect', to: home }
}

/**
 * Deep link pós-login (F0/M8-3): honra `next` SÓ se for caminho interno que a
 * própria matriz de acesso permite ao papel — resolveAccess É a allowlist,
 * nada duplicado. Rotas públicas (/login etc.), URLs externas e formas
 * degeneradas (//host, backslash) caem no home do papel.
 */
export function resolveNextPath(role: Role, next: string | null | undefined): string {
  const home = HOME_BY_ROLE[role]
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return home
  const pathname = next.split('?')[0].split('#')[0]
  if (isPublicPath(pathname)) return home
  return resolveAccess(role, pathname).kind === 'allow' ? next : home
}
