// Tela âncora da identidade visual (Design.md): fog CSS + card de vidro + CTA
// gradiente. O fundo PREMIUM do login será um VÍDEO em loop gerado por IA
// (docs/design-video-kit.md — o shader WebGL foi testado e descartado em
// 13/07/2026: fBm lê como nuvens, não aurora); até o vídeo ser aprovado, o
// fog CSS pleno segura a tela. A MECÂNICA de auth é a da ADR-014 e não mudou:
// form action signInWithPassword, erros via searchParams.
//
// D11 · P6 (28/07/2026) — ESTA ROTA ESTÁ EM DISPUTA, E A CAPA ABAIXO GANHA POR
// PADRÃO. O dono autorizou uma PROPOSTA NOVA de login na direção do site
// reestruturado (`./proposta.tsx`), mas a regra que ele escreveu é explícita: a
// consolidada segue em produção e só sai se a nova a superar aos olhos dele —
// **empate ou dúvida = fica a consolidada** (`docs/PLANO-CLONAGEM-UX.md` §D11 ·
// `docs/goals/ia-site-2026-07.md` §"Capa noturna"). Por isso o padrão é ela: a
// proposta só aparece com `?visual=proposta`, lido no servidor, sem flag de
// ambiente e sem link público apontando para lá — é a bancada do dono e nada
// mais. Um dos dois arquivos morre depois da decisão; enquanto isso, a
// consolidada abaixo fica BYTE A BYTE como estava (a suíte cobra isso).
import Image from 'next/image'
import Link from 'next/link'
import { signInWithPassword } from './actions'
import { FogBackground } from '@/components/FogBackground'
import { FogGL } from '@/components/FogGL'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { LoginProposta } from './proposta'

export const metadata = { title: 'Entrar — Personal Teacher Academy' }

const inputClass =
  'w-full rounded-input border border-hairline bg-wash px-4 py-3 text-text-hi ' +
  'placeholder:text-text-mid outline-none transition-colors focus:border-accent-turquoise'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string; visual?: string }>
}) {
  const { erro, next, visual } = await searchParams

  // O desvio é EXATO: só a palavra `proposta` sai da capa consolidada. Qualquer
  // outro valor (ou nenhum) continua na incumbente.
  if (visual === 'proposta') return <LoginProposta erro={erro} next={next} />

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-bg-900 px-4 py-10 [color-scheme:dark]">
      <FogBackground rich vignette={false} />
      <FogGL />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Image
            src="/brand/logo-branco.png"
            alt="Personal Teacher Academy"
            width={210}
            height={105}
            className="h-auto w-44"
            priority
          />
        </div>

        <div className="glass p-8">
          <h1 className="font-display text-3xl font-extralight text-text-hi">
            Bem-vindo de volta
          </h1>
          <p className="mt-1 text-sm text-text-mid">Entre para ver suas aulas.</p>

          {erro === 'credenciais' && (
            <p className="mt-4 rounded-card border border-night-danger/35 bg-night-danger/12 p-3 text-sm text-text-hi">
              E-mail ou senha incorretos. Se você ainda não criou sua senha, use
              &ldquo;Esqueci minha senha&rdquo; abaixo.
            </p>
          )}
          {erro === 'link-invalido' && (
            <p className="mt-4 rounded-card border border-night-danger/35 bg-night-danger/12 p-3 text-sm text-text-hi">
              Este link expirou ou já foi usado. Entre com sua senha ou peça um novo em
              &ldquo;Esqueci minha senha&rdquo;.
            </p>
          )}

          <form action={signInWithPassword} className="mt-6 flex flex-col gap-3">
            {/* F0 (M8-3): deep link do aviso — a action valida pela allowlist */}
            {next && <input type="hidden" name="next" value={next} />}
            <label className="text-sm font-medium text-text-mid" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
              className={inputClass}
            />
            <label className="mt-1 text-sm font-medium text-text-mid" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
            <button type="submit" className="btn-cta mt-3 w-full">
              Entrar
            </button>
            {/* A9/ADR-030: a RECUSA volta para `/login?erro=credenciais` — e
                quem erra a senha duas vezes já está NESSA url, que é a condição
                exata da corrida (redirect para o endereço atual). Nada nesta
                tela desenha contador que force o commit, então sem esta rede a
                segunda tentativa errada não diz nada: a pessoa fica olhando o
                formulário sem saber se enviou. Não desenha nada e não muda a
                cópia — o desfecho continua vindo do servidor, pela URL. */}
            <ResgateDoEnvio />
          </form>

          <p className="mt-5 text-center text-sm">
            <Link
              href="/recuperar-senha"
              className="text-accent-turquoise hover:underline focus-visible:outline-2 focus-visible:outline-accent-turquoise"
            >
              Esqueci minha senha
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
