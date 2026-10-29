// Identidade da tela âncora (Design.md): fog CSS pleno + vidro + Bricolage.
// Mecânica ADR-014 intacta: action requestPasswordReset, estados via searchParams.
//
// D11 · P6 (28/07/2026) — a outra metade do conjunto em disputa (ver o
// cabeçalho de `src/app/login/page.tsx`). A capa noturna abaixo VENCE POR
// PADRÃO: empate ou dúvida = fica a consolidada. A proposta clara só aparece em
// `?visual=proposta`, para o dono comparar login + recuperar no mesmo tom.
import Image from 'next/image'
import Link from 'next/link'
import { requestPasswordReset } from '../login/actions'
import { FogBackground } from '@/components/FogBackground'
import { FogGL } from '@/components/FogGL'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { RecuperarSenhaProposta } from './proposta'

export const metadata = { title: 'Recuperar senha — Personal Teacher Academy' }

const inputClass =
  'w-full rounded-input border border-hairline bg-wash px-4 py-3 text-text-hi ' +
  'placeholder:text-text-mid outline-none transition-colors focus:border-accent-turquoise'

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; visual?: string }>
}) {
  const { estado, visual } = await searchParams

  if (visual === 'proposta') return <RecuperarSenhaProposta estado={estado} />

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
          <h1 className="font-display text-3xl font-extralight text-text-hi">Recuperar senha</h1>
          <p className="mt-1 text-sm text-text-mid">
            Digite seu e-mail e enviaremos um link para criar uma senha nova.
          </p>

          {estado === 'enviado' && (
            <p className="mt-4 rounded-card border border-hairline bg-accent-turquoise/10 p-3 text-sm text-text-hi">
              Se este e-mail estiver cadastrado, o link já está a caminho — vale por 60
              minutos. Não chegou? Confira o spam ou fale com a gente no WhatsApp de
              sempre.
            </p>
          )}
          {estado === 'email-invalido' && (
            <p className="mt-4 rounded-card border border-night-danger/35 bg-night-danger/12 p-3 text-sm text-text-hi">
              Confira o e-mail digitado.
            </p>
          )}

          <form action={requestPasswordReset} className="mt-6 flex flex-col gap-3">
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
            <button type="submit" className="btn-cta mt-3 w-full">
              Enviar link de recuperação
            </button>
            {/* A9/ADR-030: os dois desfechos voltam para `/recuperar-senha` —
                `?estado=enviado` e `?estado=email-invalido`. Quem pede o link
                duas vezes já está no endereço de destino, que é a condição
                medida da corrida.

                A NEUTRALIDADE FICA INTACTA no caminho normal: o resgate não
                desenha nada, não escolhe frase e não muda o tempo de resposta —
                ele só existe quando o desfecho JÁ chegou do servidor e o React
                não o comitou. O caminho anormal está declarado como resíduo no
                §A9 do goal: `resetPasswordForEmail` fala com o SMTP DENTRO da
                requisição, então um envio que passe de `RESGATE_DO_ENVIO_MS`
                leva recarga e a pessoa volta ao formulário sem o aviso. Esse
                atraso já é hoje um canal por TEMPO (só e-mail cadastrado manda
                mensagem) e é medido de fora com `curl`, sem JavaScript nenhum —
                o resgate não dá capacidade nova a quem enumera; o que ele custa
                é o aviso de UMA tentativa lenta. */}
            <ResgateDoEnvio />
          </form>

          <p className="mt-5 text-center text-sm">
            <Link
              href="/login"
              className="text-accent-turquoise hover:underline focus-visible:outline-2 focus-visible:outline-accent-turquoise"
            >
              Voltar para o login
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
