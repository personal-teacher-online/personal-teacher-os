// F7/M4-3 — tela de CIÊNCIA do canal oficial, no primeiro acesso: o aluno
// reconhece que e-mail e WhatsApp são os canais de aviso da escola. O aceite
// grava timestamp (auditado). Informativa — não muda regra nenhuma.
//
// ⚠️ Lote 26/07 (correção 3 da revisão): o texto NÃO mora mais aqui. Ele vem de
// policy_versions (kind='ciencia-canais') pela função policy_vigente, e o
// formulário devolve o `policy_version_id` que ESTA renderização mostrou. A RPC
// confere que aquele id ainda é o vigente no instante do INSERT — se uma v2
// entrou em vigor com a página aberta, o aceite é recusado e o aluno relê. Sem
// isso, o registro provaria só "clicou no botão", não "concordou com ISTO".
//
// Onda do Portal · P5: esqueleto novo (o mesmo cartão das telas do aluno), TEXTO
// intocado — ele é jurídico e mora no banco. A action passou ao cookie de flash
// e esta página deixou de ler `msg` da URL: quem pinta o recado é a moldura
// (`RecadoDoPortal`), que serve inclusive esta rota — ela É um dos dois gates.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { renderPolicyMd } from '@/lib/policy/markdown'
import { FALE_COM_A_GENTE_INICIAL } from '@/lib/contact'
import { ackChannelNoticeAction } from '../actions'

export const metadata = { title: 'Bem-vindo — Personal Teacher Academy' }

interface PolicyVigente {
  id: string
  version: number
  body_md: string
}

export default async function CienciaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_channel_ack_at, whatsapp_e164')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.whatsapp_channel_ack_at) redirect('/portal')

  const { data: vigentes } = await supabase.rpc('policy_vigente', { p_kind: 'ciencia-canais' })
  const politica = ((vigentes ?? []) as PolicyVigente[])[0] ?? null
  const texto = politica ? renderPolicyMd(politica.body_md) : null

  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="title-page text-ink-900">Bem-vindo(a)! 👋</h1>
        <p className="mt-1 text-sm text-ink-600">Antes de começar, um combinado rápido:</p>
      </header>

      <section className="card-ac flex flex-col gap-4 p-5">
        {texto?.titulo ? (
          <span className="text-sm font-medium text-ink-600">{texto.titulo}</span>
        ) : null}
        {texto ? (
          texto.paragrafos.map((paragrafo, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink-900">
              {paragrafo.map((pedaco, j) =>
                pedaco.forte ? <strong key={j}>{pedaco.texto}</strong> : pedaco.texto,
              )}
            </p>
          ))
        ) : (
          // Sem versão vigente não há o que aceitar — e aceitar "nada" seria o
          // pior desfecho: registro em branco com cara de consentimento.
          <p className="text-sm leading-relaxed text-danger-700">
            Não conseguimos carregar o combinado agora. {FALE_COM_A_GENTE_INICIAL} para resolver isso.
          </p>
        )}
        {profile?.whatsapp_e164 ? (
          <p className="text-sm text-ink-600">
            Seu WhatsApp cadastrado: <strong className="text-ink-900">{profile.whatsapp_e164}</strong> — dá
            para mudar depois em &ldquo;Seu perfil&rdquo;.
          </p>
        ) : (
          /* Correção 28/07: com o número nascendo no convite (obrigatório), este
             ramo virou EXCEÇÃO — aluno legado, ou convite em que a gravação do
             telefone falhou. A frase deixou de sugerir que faltava uma escolha
             do aluno: o que falta é um dado que a escola deveria ter. */
          <p className="text-sm text-ink-600">
            Não encontramos o seu WhatsApp no cadastro — ao continuar, você cai direto no
            campo para escrever o número.
          </p>
        )}
        {politica ? (
          <form action={ackChannelNoticeAction}>
            {/* o id do texto EXIBIDO viaja com o aceite */}
            <input type="hidden" name="policy_version_id" value={politica.id} />
            <button type="submit" className="btn-ac btn-ac-lg w-full">
              Entendi, vamos lá
            </button>
            {/* K2/ADR-030: a RECUSA desta action ("o combinado foi atualizado —
                leia o texto novo") volta para `/portal/ciencia`, a mesma URL. Sem
                a rede de segurança, o aluno fica olhando a mesma tela sem saber
                que o aceite não foi registrado — e esta é uma das duas telas de
                GATE, de onde ele não sai por conta própria. */}
            <ResgateDoEnvio />
          </form>
        ) : null}
      </section>
    </main>
  )
}
