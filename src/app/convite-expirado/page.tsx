// F7/M4-2 — o link do convite venceu ou já foi usado: página ACOLHEDORA com
// reenvio NEUTRO (nunca revela se o e-mail é de cliente — mesma postura da
// recuperação de senha). Visual da família das telas públicas (noite + fog).
//
// Onda do Portal · P5: a moldura virou `CapaNoturna` (kit) e a tela ganhou o
// TERCEIRO estado que faltava. Antes havia só "enviado": quando a leitura do
// banco falhava, o convite não saía e a página afirmava que tinha saído (dívida
// c14). Agora `nao-deu` tem voz própria — e ela não conta nada sobre o e-mail
// digitado, porque essa falha acontece igual para cliente e para estranho
// (a régua está em `src/lib/auth/reenvio.ts`).
import Link from 'next/link'
import { AvisoNoturno, CapaNoturna, campoNoturno } from '@/components/kit/capa-noturna'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { resendMyInviteAction } from './actions'

export const metadata = { title: 'Link expirado — Personal Teacher Academy' }

export default async function ConviteExpiradoPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  const { estado } = await searchParams
  const enviado = estado === 'enviado'
  const naoDeu = estado === 'nao-deu'
  // Rodada 2 do Sol (achado 2): NÃO existe quarto estado. O "fale-com-a-escola"
  // que a rodada anterior criou respondia diferente para aluno sem número — e
  // resposta diferente é enumeração, por comportamento em vez de por frase.
  // Quem não pode receber o reenvio automático cai no MESMO `enviado` neutro,
  // que já oferece o WhatsApp da escola como porta humana.

  return (
    <CapaNoturna
      titulo="Seu convite expirou"
      subtitulo="Por segurança, links de convite valem por pouco tempo. Informe seu e-mail para pedir um novo."
    >
      {enviado ? (
        /* A CÓPIA NÃO AFIRMA NADA que este caminho não saiba (correção do P5 +
           rodada 3 do Sol): "se estiver cadastrado, chega em instantes" era
           promessa FALSA para o cadastrado sem número no perfil — nesse caso o
           código decide NÃO enviar, e a frase deixava a pessoa esperando um
           e-mail que nunca viria. A frase abaixo é verdadeira em TODOS os
           caminhos (enviado, não-cadastrado, cadastrado sem número): confirma
           só o pedido, não afirma cadastro nem entrega, e aponta a porta
           humana para quem ficar sem resposta. */
        <AvisoNoturno tom="ok">
          Pedido recebido. Confira sua caixa de entrada nos próximos minutos
          {WHATSAPP_ATENDIMENTO_URL ? (
            <>
              {' '}
              — se nada chegar,{' '}
              <a
                href={WHATSAPP_ATENDIMENTO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                fale com a gente no WhatsApp
              </a>
              .
            </>
          ) : (
            '.'
          )}
        </AvisoNoturno>
      ) : (
        <>
          {naoDeu && (
            <AvisoNoturno tom="erro">
              Não deu para enviar agora — o problema é do nosso lado, e nada foi perdido. Tente
              de novo em instantes.
            </AvisoNoturno>
          )}
          <form action={resendMyInviteAction} className="mt-5 flex flex-col gap-3">
            <label className="text-sm font-medium text-text-mid" htmlFor="email">
              Seu e-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
              className={campoNoturno}
            />
            <button type="submit" className="btn-cta mt-2 w-full">
              Reenviar meu convite
            </button>
            {/* A9/ADR-030: `nao-deu` volta para `/convite-expirado?estado=nao-deu`
                — o próprio endereço de quem está vendo o formulário depois de
                uma falha, que é a condição medida da corrida. Mesmo resíduo
                declarado da recuperação de senha (o provisionamento fala com o
                SMTP dentro da requisição); mesma razão para aceitá-lo: o
                resgate não escolhe frase nem responde diferente por e-mail. */}
            <ResgateDoEnvio />
          </form>
        </>
      )}

      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="text-accent-turquoise hover:underline">
          Já tenho senha — entrar
        </Link>
      </p>
    </CapaNoturna>
  )
}
