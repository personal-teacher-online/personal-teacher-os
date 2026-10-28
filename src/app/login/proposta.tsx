// A PROPOSTA DE LOGIN (Onda do Portal · P6 · emenda D11) — em disputa com a
// capa noturna consolidada, que **vence por padrão**.
//
// Regra do dono, escrita: a capa consolidada segue em produção e só sai se a
// nova a superar AOS OLHOS DELE; empate ou dúvida = fica a consolidada
// (`docs/PLANO-CLONAGEM-UX.md` §D11 · `docs/goals/ia-site-2026-07.md` §Capa
// noturna). Por isso `/login` sem query serve a consolidada, e esta tela só
// aparece em `/login?visual=proposta` — a bancada do dono, e nada além dela.
//
// FUNÇÃO IDÊNTICA. Mesma server action (`signInWithPassword`), mesmos campos
// (`email`, `password`, o `next` escondido), mesmos códigos de erro
// (`?erro=credenciais` · `?erro=link-invalido`), a MESMA CÓPIA palavra por
// palavra — e a MESMA VALIDAÇÃO: `<form>` comum, validação nativa do
// navegador, os mesmos `required`. Nada de auth muda aqui, e nada de
// COMPORTAMENTO também: o que está em julgamento é só o visual, e a comparação
// tem de isolar essa variável.
//
// (Correção do P6, 28/07: a primeira versão desta tela usava o `FormValidado`
// do kit — noValidate + frase embaixo do campo + foco no primeiro erro. Era uma
// segunda variável escondida na disputa: no envio vazio o dono veria duas
// experiências diferentes e atribuiria a diferença ao visual. O erro inline
// continua sendo o padrão do admin; se a proposta vencer, ele entra aqui em
// lote próprio.)
//
// O QUE MUDA: papel no lugar da noite. Fundo `--paper-50`, cartão `.panel-tb`
// com a moldura de tinta do `PortalShell` no topo (símbolo + nome + fio-
// assinatura), tipografia e raios do kit, periwinkle (`--ac-deep`) na ação.
import Link from 'next/link'

import { AvisoClaro, CampoClaro, CapaClara, campoClaro } from '@/components/kit/capa-clara'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { signInWithPassword } from './actions'

export function LoginProposta({ erro, next }: { erro?: string; next?: string }) {
  return (
    <CapaClara titulo="Bem-vindo de volta" subtitulo="Entre para ver suas aulas.">
      {erro === 'credenciais' && (
        <AvisoClaro tom="erro">
          E-mail ou senha incorretos. Se você ainda não criou sua senha, use &ldquo;Esqueci minha
          senha&rdquo; abaixo.
        </AvisoClaro>
      )}
      {erro === 'link-invalido' && (
        <AvisoClaro tom="erro">
          Este link expirou ou já foi usado. Entre com sua senha ou peça um novo em &ldquo;Esqueci
          minha senha&rdquo;.
        </AvisoClaro>
      )}

      <form action={signInWithPassword} className="flex flex-col gap-4">
        {/* F0 (M8-3): deep link do aviso — a action valida pela allowlist */}
        {next && <input type="hidden" name="next" value={next} />}
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
        <CampoClaro rotulo="Senha" para="password">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={campoClaro}
          />
        </CampoClaro>
        <button type="submit" className="btn-ac mt-1 w-full">
          Entrar
        </button>
        {/* A9/ADR-030: a mesma rede da consolidada. Ela entra AQUI TAMBÉM por
            obrigação da disputa — "nada de COMPORTAMENTO muda entre as duas"
            (cabeçalho): uma capa que resgata o desfecho e outra que não seria
            uma segunda variável escondida no julgamento do dono. */}
        <ResgateDoEnvio />
      </form>

      {/* O `?visual=proposta` viaja com o link para o dono comparar o CONJUNTO
          claro (login + recuperar) sem cair no meio na capa noturna. Ninguém
          entra aqui por link público: nenhuma página servida a um usuário real
          aponta para esta tela. */}
      <p className="text-center">
        <Link href="/recuperar-senha?visual=proposta" className="btn-ac-ghost">
          Esqueci minha senha
        </Link>
      </p>
    </CapaClara>
  )
}
