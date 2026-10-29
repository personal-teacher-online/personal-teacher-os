// Identidade da tela âncora (Design.md): fog CSS pleno + vidro + Bricolage.
// Mecânica ADR-014 intacta: action setPassword, erros via searchParams.
//
// Onda do Portal · P5: a moldura saiu do arquivo e virou `CapaNoturna` (kit) —
// o mesmo bloco que quatro telas copiavam à mão. Pixel por pixel é a capa de
// sempre; o que muda é ter UM lugar onde ela mora, o que o P6 (D11) vai precisar.
//
// O erro continua na URL, e de propósito: aqui não há sessão de portal nem
// moldura que leia cookie de flash, e `?erro=` é um CÓDIGO fechado
// (curta · nao-confere · fraca · recusada) traduzido nesta página — não uma
// frase forjável escrita por quem monta o link.
import Link from 'next/link'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { setPassword } from './actions'
import { AvisoNoturno, CapaNoturna, campoNoturno } from '@/components/kit/capa-noturna'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { PasswordField } from '@/components/PasswordField'

export const metadata = { title: 'Criar senha — Personal Teacher Academy' }

const ERROR_MESSAGES: Record<string, string> = {
  curta: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  'nao-confere': 'As duas senhas não são iguais — digite a mesma senha nos dois campos.',
  fraca: 'A senha ainda não cumpre todos os requisitos da lista — confira os itens.',
  recusada: 'Não foi possível salvar esta senha. Tente outra um pouco mais longa.',
}

export default async function DefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams
  const mensagem = erro ? ERROR_MESSAGES[erro] : null

  return (
    <CapaNoturna
      titulo="Crie sua senha"
      subtitulo={`É com ela que você vai entrar daqui para frente. Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`}
      fogGL
    >
      {mensagem && <AvisoNoturno tom="erro">{mensagem}</AvisoNoturno>}

      <form action={setPassword} className="mt-6 flex flex-col gap-3">
        <label className="text-sm font-medium text-text-mid" htmlFor="password">
          Nova senha
        </label>
        <PasswordField
          id="password"
          name="password"
          minLength={MIN_PASSWORD_LENGTH}
          className={campoNoturno}
          dark
        />
        <label className="mt-1 text-sm font-medium text-text-mid" htmlFor="confirm">
          Repita a senha
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={campoNoturno}
        />
        <button type="submit" className="btn-cta mt-3 w-full">
          Salvar senha e entrar
        </button>
        {/* A9/ADR-030: os QUATRO erros desta tela voltam para
            `/definir-senha?erro=…` — e a pessoa que erra duas vezes seguidas
            (senha curta, depois senhas diferentes) já está numa url `?erro=`,
            que é a condição medida da corrida. É a pior tela para ficar muda:
            quem chega aqui veio de um link de e-mail e não tem outra porta. */}
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
    </CapaNoturna>
  )
}
