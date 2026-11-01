// Link discreto "Privacidade" das capas públicas (login e recuperar senha, na
// noturna e na proposta clara). Fica FORA do `<main>` da capa, que é congelada
// byte a byte (`tests/portal-p6-login.test.ts`): a margem negativa o puxa para
// dentro do `py-10` do `<main>`, então ele aparece no pé da primeira tela sem
// criar rolagem e sem nunca cobrir o formulário (o `py-10` reserva o espaço).
import Link from 'next/link'

export function LinkPrivacidade({ tom = 'noturno' }: { tom?: 'noturno' | 'claro' }) {
  const cor =
    tom === 'noturno'
      ? 'text-text-mid hover:text-text-hi focus-visible:outline-accent-turquoise'
      : 'text-ink-600 hover:text-ink-900 focus-visible:outline-brand-600'
  return (
    <p className="relative z-20 -mt-9 h-9 text-center">
      <Link
        href="/privacidade"
        className={`inline-flex min-h-6 items-center text-sm underline underline-offset-2 focus-visible:outline-2 ${cor}`}
      >
        Privacidade
      </Link>
    </p>
  )
}
