// SEU PERFIL (Onda do Portal · P5) — o que a escola sabe sobre você e as duas
// coisas que você mesmo muda: o número do WhatsApp e a senha.
//
// O QUE ENTRA NA REFORMA (D8, da IA): a cidade e o FUSO do cadastro passam a
// aparecer, com a hora que o portal está usando para você. Sem isso, o aluno que
// viaja (ou o que mudou de país) não tinha onde conferir por que os horários
// parecem "errados" — e o aviso de fuso, que só acende na exceção, não tinha uma
// tela para onde apontar.
//
// O AVISO DE FUSO NÃO É REDESENHADO AQUI, de propósito. `TzMismatch` já mora na
// MOLDURA do portal (`PortalShell`), acima do conteúdo de TODA rota: repeti-lo
// dentro do cartão faria a mesma frase aparecer duas vezes nesta página, e a
// segunda ensina a ignorar a primeira. O que esta tela acrescenta é o outro lado
// da conversa — QUAL fuso está valendo e que horas são nele agora.
//
// LEI 1: nenhuma hora é montada no cliente. A hora do cadastro é formatada no
// servidor, na zona do aluno, por `Intl` — o mesmo caminho de `fmtLocal`.
//
// O recado das ações vem da MOLDURA (`RecadoDoPortal`): esta tela não lê `msg`
// da URL, e as duas actions dela gravam a frase no cookie de flash (P5).
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { tzSuffix } from '@/lib/format'
import { aceitesDoAluno, contatoDoAluno, portalStudent } from '@/lib/portal/data'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { input, Field } from '@/components/ui'
import { CountryPhoneField } from '@/components/CountryPhoneField'
import { PasswordField } from '@/components/PasswordField'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { updateMyWhatsappAction, updateMyPasswordAction } from '../actions'

export const metadata = { title: 'Seu perfil — Personal Teacher' }

/** Rótulo de seção do cartão: nomeia o dado sem competir com ele (P3). */
function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-ink-600">{children}</span>
}

/** Que horas são AGORA no fuso cadastrado — escrito no servidor (Lei 1). */
function horaNoFuso(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date())
  } catch {
    return null
  }
}

/** Data e hora de um instante, na zona do aluno — sem formato de máquina. */
function quando(iso: string, tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ foco?: string }>
}) {
  // foco=whatsapp: chegada guiada da tela de ciência — cartão em destaque e
  // campo já focado (e2e 19/07: o aluno é LEVADO ao número, não convidado).
  const { foco } = await searchParams
  const focoWhatsapp = foco === 'whatsapp'
  // A PRÓPRIA rota, com o estado que a pessoa estava vendo — é para cá que o
  // botão "Tentar de novo" aponta quando uma leitura falha.
  const estaRota = focoWhatsapp ? '/portal/perfil?foco=whatsapp' : '/portal/perfil'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [aluno, contato, aceites] = await Promise.all([
    portalStudent(supabase),
    contatoDoAluno(supabase, user.id),
    aceitesDoAluno(supabase),
  ])

  // `tz` é o fuso CADASTRADO (nulo quando a leitura falhou — e aí o cartão de
  // localização não afirma nada); `tzDeLeitura` é o que FORMATA datas na tela,
  // com o mesmo padrão das demais telas do portal. Uma data de aceite que
  // existe não pode sumir só porque o cadastro do aluno não veio.
  const tz = aluno.dado?.ianaTz ?? null
  const tzDeLeitura = tz ?? 'America/Cuiaba'
  const agora = tz ? horaNoFuso(tz) : null
  const lugar = [aluno.dado?.city, aluno.dado?.country].filter(Boolean).join(' · ')

  return (
    <main className="flex flex-col gap-5">
      <header>
        <Link href="/portal" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Início
        </Link>
        <h1 className="mt-1 title-page text-ink-900">Seu perfil</h1>
      </header>

      {aluno.erro && <AvisoDeLeitura oQue="seus dados" />}

      {/* ------------------------------------------------- 1. onde você está */}
      <section className="card-ac flex flex-col gap-3 p-5">
        <Rotulo>Onde você está</Rotulo>
        {/* SOB ERRO, NENHUMA AFIRMAÇÃO DE AUSÊNCIA (correção do P5). Com a
            leitura do cadastro falhando, `lugar` vem vazio pelo mesmo caminho de
            quem realmente não tem cidade — e a tela dizia "Cidade ainda não
            cadastrada" a quem tem. O aviso de leitura já está no topo da página;
            aqui o cartão apenas se cala. */}
        {aluno.erro ? (
          <p className="text-sm text-ink-600">
            Sua cidade e o seu fuso não carregaram agora.
          </p>
        ) : (
          <p className="text-base font-semibold text-ink-900">
            {lugar || 'Cidade ainda não cadastrada'}
          </p>
        )}
        {tz && (
          <p className="text-sm text-ink-600">
            Os horários do portal seguem o seu fuso ({tzSuffix(tz)})
            {agora ? ` — aí são ${agora} agora` : ''}.
          </p>
        )}
        {/* Mudar cidade/fuso mexe em aula já marcada (a materialização é feita
            na hora local do aluno), então não é auto-serviço: é conversa. */}
        {WHATSAPP_ATENDIMENTO_URL ? (
          <a
            href={WHATSAPP_ATENDIMENTO_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-ac-soft self-start"
          >
            Mudei de cidade — avisar a escola
          </a>
        ) : (
          <p className="text-sm text-ink-600">Mudou de cidade? Avise a escola.</p>
        )}
      </section>

      {/* ------------------------------------------------------ 2. WhatsApp */}
      <section
        className={`card-ac flex flex-col gap-3 p-5 ${
          focoWhatsapp ? '[--card-edge:transparent] [--card-state:var(--glow-brand)]' : ''
        }`}
      >
        <Rotulo>WhatsApp para avisos</Rotulo>
        {/* Com a leitura do contato falhando o formulário SOME (ver abaixo), e
            sem ele a pessoa fica sem caminho nenhum nesta seção. O botão leva à
            própria rota: no servidor, a navegação refaz a leitura. */}
        {contato.erro && <AvisoDeLeitura oQue="seu contato" tentarEm={estaRota} />}
        {focoWhatsapp && (
          <p className="text-base font-semibold text-ink-900">
            Falta só isto: com o seu número aqui, os lembretes de aula chegam direto no seu
            WhatsApp.
          </p>
        )}
        {/* Correção 28/07 (regra do dono): o WhatsApp não é opt-in do portal —
            o contrato já prevê os avisos por lá, e a escola cadastra o número
            no seu cadastro. Aqui o aluno TROCA; a voz da tela mudou de "se
            você quiser receber" para "é este o número que temos". */}
        <p className="text-sm text-ink-600">
          É neste número que a escola te avisa: lembrete de aula, crédito vencendo, recado da
          professora. Trocou de número? Escreva o novo aqui. Toda mudança fica registrada.
        </p>
        {/* Com a leitura falhando, o campo nasce VAZIO — e um "salvar" em cima
            de um campo vazio apagaria o número que existe. O aviso acima já
            está na tela; o formulário some junto com a certeza. */}
        {!contato.erro && (
          <form action={updateMyWhatsappAction} className="flex flex-wrap items-end gap-3">
            {/* `para` → `id` (achado 8 do Sol): sem eles, o rótulo focava o
                seletor de PAÍS (primeiro rotulável do campo composto) em vez
                do telefone — mesma raiz do M3-c4 · B1 nos formulários do admin. */}
            <Field label="Seu número de WhatsApp" para="whatsapp-do-perfil">
              {/* `required`: trocar sim, APAGAR não. O banco recusa vazio
                  (`update_my_whatsapp`, migration 20260728001000) — isto aqui é
                  só a antecipação da recusa, no campo, como manda a Lei 3. */}
              {/* `ariaLabel={null}` (rodada 3 do Sol, WCAG 2.5.3): o rótulo
                  visível acima já aponta o campo por `para`→`id` — um
                  aria-label interno o SOBREPORIA, e quem dita por voz fala o
                  texto que vê. O nome acessível é o do label; a dica do DDI
                  vira aria-describedby dentro do componente. */}
              <CountryPhoneField
                id="whatsapp-do-perfil"
                name="whatsapp_e164"
                defaultValue={contato.dado?.whatsappE164 ?? undefined}
                autoFocus={focoWhatsapp}
                required
                ariaLabel={null}
              />
            </Field>
            <button type="submit" className="btn-ac">
              Salvar número
            </button>
            {/* K2/ADR-030: as duas actions desta tela voltam para `/portal/perfil`
                — a MESMA URL de onde o envio saiu, que é a única condição em que
                a corrida do commit perdido foi observada. Sem esta rede, o
                "Número atualizado. ✓" (e a recusa) nunca chega ao aluno: nada
                nesta página desenha contador que force o React a terminar. */}
            <ResgateDoEnvio />
          </form>
        )}
      </section>

      {/* --------------------------------------------- 3. o combinado aceito */}
      <section className="card-ac flex flex-col gap-3 p-5">
        <Rotulo>O combinado da escola</Rotulo>
        {aceites.erro ? (
          <AvisoDeLeitura oQue="o seu aceite" />
        ) : aceites.dado.length === 0 ? (
          <p className="text-sm text-ink-600">
            Você ainda não registrou o aceite do combinado de avisos.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {aceites.dado.map((a) => (
              <li key={`${a.kind}-${a.version}`} className="text-sm text-ink-900">
                <span className="font-semibold">Combinado de avisos (versão {a.version})</span>
                <span className="text-ink-600">
                  {' '}
                  — aceito por você em {quando(a.aceitoEm, tzDeLeitura) ?? 'data não registrada'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-600">
          Guardamos o texto que você leu, e não só a data: se ele mudar, a gente pede o aceite de
          novo em vez de reaproveitar o antigo.
        </p>
      </section>

      {/* ---------------------------------------------------- 4. sua senha */}
      <section className="card-ac flex flex-col gap-3 p-5">
        <Rotulo>Sua senha</Rotulo>
        <form action={updateMyPasswordAction} className="flex flex-col gap-3 sm:max-w-xs">
          <Field label="Senha nova (mín. 8 caracteres)">
            <PasswordField name="password" minLength={8} className={input} />
          </Field>
          <button type="submit" className="btn-ac self-start">
            Trocar senha
          </button>
          {/* idem ao cartão do WhatsApp — e aqui o silêncio custa mais: quem não
              vê "Senha trocada. ✓" não sabe com qual senha vai voltar. */}
          <ResgateDoEnvio />
        </form>
      </section>
    </main>
  )
}
