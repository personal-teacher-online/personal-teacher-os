// A PROPOSTA DE RECUPERAR SENHA (Onda do Portal · P6 · emenda D11) — a segunda
// metade do conjunto em disputa.
//
// Ela existe pelo mesmo motivo que a do login: o dono compara o CONJUNTO, não
// uma tela. Quem entra pelo `/login?visual=proposta` e clica em "Esqueci minha
// senha" precisa continuar na direção clara; caindo na capa noturna no meio do
// caminho, a comparação vira uma colagem das duas.
//
// A regra continua valendo: a consolidada vence por padrão, empate ou dúvida =
// fica a consolidada. `/recuperar-senha` sem query serve a capa noturna.
//
// Função idêntica: mesma action (`requestPasswordReset`), mesmo campo `email`,
// mesmos estados (`?estado=enviado` · `?estado=email-invalido`), a mesma cópia
// e a mesma validação NATIVA do navegador (ver a nota da correção do P6 no
// cabeçalho de `src/app/login/proposta.tsx`).
// (`definir-senha` e `convite-expirado` ficam na `CapaNoturna` do kit — não
// entram na disputa.)
import Link from 'next/link'

import { AvisoClaro, CampoClaro, CapaClara, campoClaro } from '@/components/kit/capa-clara'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { requestPasswordReset } from '../login/actions'

export function RecuperarSenhaProposta({ estado }: { estado?: string }) {
  return (
    <CapaClara
      titulo="Recuperar senha"
      subtitulo="Digite seu e-mail e enviaremos um link para criar uma senha nova."
    >
      {estado === 'enviado' && (
        <AvisoClaro tom="ok">
          Se este e-mail estiver cadastrado, o link já está a caminho — vale por 60 minutos. Não
          chegou? Confira o spam ou fale com a gente no WhatsApp de sempre.
        </AvisoClaro>
      )}
      {estado === 'email-invalido' && (
        <AvisoClaro tom="erro">Confira o e-mail digitado.</AvisoClaro>
      )}

      <form action={requestPasswordReset} className="flex flex-col gap-4">
        <CampoClaro rotulo="E-mail" para="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@exemplo.com"
            className={campoClaro}
          />
        </CampoClaro>
        <button type="submit" className="btn-ac mt-1 w-full">
          Enviar link de recuperação
        </button>
        {/* A9/ADR-030: a mesma rede da consolidada, pelo mesmo motivo da
            proposta do login — comportamento idêntico é condição da disputa. */}
        <ResgateDoEnvio />
      </form>

      <p className="text-center">
        <Link href="/login?visual=proposta" className="btn-ac-ghost">
          Voltar para o login
        </Link>
      </p>
    </CapaClara>
  )
}
