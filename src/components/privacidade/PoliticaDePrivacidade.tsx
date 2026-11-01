// O TEXTO da política de privacidade (`/privacidade`), página de leitura:
// uma coluna, largura de texto confortável (~65 caracteres), papel e tinta.
//
// REGRA DE CONTEÚDO: a página só afirma o que o sistema faz hoje. Cada item
// abaixo tem fonte no código ou no ADR-038 (mensagens guardadas inteiras por
// 90 dias, expurgo por telefone, exportação da ficha, canal de avisos como
// parte do contrato). Promessa que o sistema não cumpre não entra aqui.
//
// É um server component puro: recebe a controladora por prop (a página lê as
// envs), para o teste renderizá-lo com e sem razão social/CNPJ.
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { MARCA } from '@/lib/brand/constants'
import {
  PRIVACIDADE_ATUALIZADA_EM,
  PRIVACIDADE_EMAIL,
  type Controladora,
} from '@/lib/privacidade'

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="font-display text-xl font-bold text-ink-900">{titulo}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Lista({ children }: { children: ReactNode }) {
  return <ul className="ml-5 flex list-disc flex-col gap-1.5 marker:text-ink-400">{children}</ul>
}

const linkClass =
  'font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600'

export function PoliticaDePrivacidade({ controladora }: { controladora: Controladora }) {
  return (
    <div
      data-surface="paper"
      className="flex min-h-dvh w-full flex-col bg-paper-50 text-ink-900 [color-scheme:light]"
    >
      <header className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3 md:px-8">
        <span className="flex items-center gap-2.5">
          <Image
            src={MARCA.simboloBranco}
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] opacity-90"
          />
          <span className="font-display text-[15px] font-bold text-white">{MARCA.escola}</span>
        </span>
      </header>
      <div className="brand-thread" aria-hidden />

      <main className="mx-auto w-full max-w-[42rem] flex-1 px-4 py-8 text-base leading-7 md:py-12">
        <article className="flex flex-col gap-8">
          <header>
            <h1 className="font-display text-3xl font-bold text-ink-900">Política de Privacidade</h1>
            <p className="mt-2 text-sm font-medium text-ink-600">
              Última atualização: {PRIVACIDADE_ATUALIZADA_EM}
            </p>
            <p className="mt-4">
              Aqui você lê, em palavras simples, quais dados a {MARCA.escola} guarda sobre alunas,
              professoras e responsáveis, para que usamos, por quanto tempo guardamos, com quem
              compartilhamos e como você pede cópia ou exclusão. Seguimos a Lei Geral de Proteção
              de Dados (LGPD, Lei 13.709/2018).
            </p>
          </header>

          <Secao id="quem-somos" titulo="Quem cuida dos seus dados">
            <p>
              A {MARCA.escola} (aulas de inglês online, uma pessoa por vez) é a responsável pelos
              dados tratados aqui.
            </p>
            {(controladora.razaoSocial || controladora.cnpj) && (
              <Lista>
                {controladora.razaoSocial && <li>Razão social: {controladora.razaoSocial}</li>}
                {controladora.cnpj && <li>CNPJ: {controladora.cnpj}</li>}
              </Lista>
            )}
            <p>
              Para qualquer assunto sobre seus dados, escreva para{' '}
              <a href={`mailto:${PRIVACIDADE_EMAIL}`} className={linkClass}>
                {PRIVACIDADE_EMAIL}
              </a>
              .
            </p>
          </Secao>

          <Secao id="o-que-guardamos" titulo="O que guardamos">
            <Lista>
              <li>
                <strong>Cadastro:</strong> nome, e-mail, número de WhatsApp, fuso horário e, quando
                informados, cidade e país.
              </li>
              <li>
                <strong>Aulas:</strong> horários, remarcações e cancelamentos, créditos de reposição
                e de mentoria e, na mentoria, o andamento no curso.
              </li>
              <li>
                <strong>Quem paga a mensalidade:</strong> nome, e-mail e CPF ou CNPJ, quando
                informados.
              </li>
              <li>
                <strong>Mensagens:</strong> os avisos que enviamos por WhatsApp e por e-mail, as
                mensagens que você manda para o número de WhatsApp da escola (guardadas inteiras) e
                os recibos de entrega (entregue, lida ou não entregue).
              </li>
              <li>
                <strong>Professoras:</strong> nome, e-mail, fuso horário, aulas dadas, horas e
                valores a receber.
              </li>
              <li>
                <strong>Registro das alterações:</strong> o sistema anota quem fez cada alteração
                importante (por exemplo, remarcar uma aula ou ajustar um crédito) e quando.
              </li>
              <li>
                <strong>Aulas gravadas:</strong> quando uma aula é gravada, a gravação fica no
                Google Drive da escola.
              </li>
              <li>
                <strong>Registros técnicos:</strong> erros e uso das telas do sistema, para
                corrigirmos defeitos.
              </li>
            </Lista>
          </Secao>

          <Secao id="para-que-usamos" titulo="Para que usamos">
            <Lista>
              <li>
                Dar as aulas contratadas: agendar, remarcar, controlar créditos e acompanhar o
                progresso. É a execução do contrato.
              </li>
              <li>
                Avisar sobre aulas por WhatsApp e por e-mail (confirmações, lembretes e mudanças).
                O aviso de aula faz parte do contrato.
              </li>
              <li>Cobrar a mensalidade e pagar as professoras.</li>
              <li>
                Manter o sistema seguro e funcionando, e responder a dúvidas e pedidos. É o
                interesse legítimo da escola em operar o serviço.
              </li>
              <li>Cumprir obrigações legais, como as fiscais.</li>
            </Lista>
            <p>Não vendemos seus dados e não os usamos para propaganda de terceiros.</p>
          </Secao>

          <Secao id="por-quanto-tempo" titulo="Por quanto tempo guardamos">
            <Lista>
              <li>
                <strong>Mensagens que você manda ao número de WhatsApp da escola e recibos de
                entrega:</strong> 90 dias. Depois disso, são apagados automaticamente.
              </li>
              <li>
                <strong>Cadastro, aulas e créditos:</strong> enquanto você for aluna ou professora
                da escola e, depois, apenas o que a lei exige que guardemos (veja a seção sobre
                exclusão).
              </li>
              <li>
                <strong>Notas e contratos:</strong> pelo prazo que a lei fiscal exige, em regra 5
                anos.
              </li>
            </Lista>
          </Secao>

          <Secao id="com-quem-compartilhamos" titulo="Com quem compartilhamos">
            <p>
              Usamos estas ferramentas para prestar o serviço. Cada uma recebe só o que precisa
              para a sua parte:
            </p>
            <Lista>
              <li>
                <strong>Meta (WhatsApp Cloud API):</strong> envia e recebe as mensagens de
                WhatsApp. Recebe seu número e o texto das mensagens.
              </li>
              <li>
                <strong>Resend:</strong> envia os e-mails. Recebe seu e-mail e o texto da
                mensagem.
              </li>
              <li>
                <strong>Google (Agenda, Drive e Meet):</strong> agenda das aulas, sala da aula
                online e arquivos, como a gravação, quando existe.
              </li>
              <li>
                <strong>Hotmart:</strong> hospeda o curso da mentoria. Trocamos com ela seu e-mail
                e o andamento no curso.
              </li>
              <li>
                <strong>Autentique:</strong> assinatura dos contratos, quando usada. Recebe seu
                nome, seu e-mail e o contrato.
              </li>
              <li>
                <strong>Asaas:</strong> cobranças e pagamentos, quando a cobrança pelo sistema
                estiver ligada.
              </li>
              <li>
                <strong>Supabase, em servidor na Alemanha (Hetzner), com Cloudflare na frente:</strong>{' '}
                onde o sistema e o banco de dados rodam.
              </li>
              <li>
                <strong>Claude (Anthropic):</strong> podemos usar para rotinas de análise, como
                revisar aulas e preparar relatórios de progresso.
              </li>
            </Lista>
            <p>
              Alguns desses serviços ficam fora do Brasil, então seus dados podem ser tratados em
              outros países. Fora essas ferramentas, só compartilhamos dados se a lei mandar ou
              se uma autoridade fizer um pedido legal.
            </p>
          </Secao>

          <Secao id="seus-direitos" titulo="Seus direitos">
            <p>Pela LGPD, você pode pedir à escola, a qualquer momento:</p>
            <Lista>
              <li>confirmar se tratamos seus dados e ter acesso a eles;</li>
              <li>corrigir dado incompleto, errado ou desatualizado;</li>
              <li>receber uma cópia dos seus dados em arquivo legível (portabilidade);</li>
              <li>apagar os dados que não precisamos guardar por lei;</li>
              <li>saber com quem compartilhamos seus dados;</li>
              <li>parar de receber os avisos por WhatsApp. A equipe da escola desliga o canal.</li>
            </Lista>
            <p>
              Peça por e-mail, para{' '}
              <a href={`mailto:${PRIVACIDADE_EMAIL}`} className={linkClass}>
                {PRIVACIDADE_EMAIL}
              </a>
              . Se achar que seus dados foram tratados de forma errada, você também pode reclamar à
              Autoridade Nacional de Proteção de Dados (ANPD).
            </p>
          </Secao>

          <Secao id="exclusao" titulo="Como pedir a exclusão dos seus dados">
            <ol className="ml-5 flex list-decimal flex-col gap-1.5 marker:text-ink-600">
              <li>
                Envie um e-mail para{' '}
                <a
                  href={`mailto:${PRIVACIDADE_EMAIL}?subject=Exclus%C3%A3o%20de%20dados`}
                  className={linkClass}
                >
                  {PRIVACIDADE_EMAIL}
                </a>{' '}
                com o assunto &ldquo;Exclusão de dados&rdquo;.
              </li>
              <li>
                Escreva seu nome completo e o número de WhatsApp (com DDD) que usa com a escola. É
                com ele que achamos e apagamos as mensagens ligadas a você.
              </li>
              <li>
                Respondemos em até 15 dias, dizendo o que foi apagado e o que precisa ser mantido.
                Se o pedido vier de um e-mail diferente do seu cadastro, podemos pedir uma
                confirmação.
              </li>
            </ol>
            <p>
              <strong>O que não podemos apagar na hora:</strong> notas e documentos fiscais e
              contratos, que a lei manda guardar por 5 anos, em regra. Esses ficam guardados só para
              esse fim e são apagados quando o prazo termina. O restante (cadastro, aulas, créditos
              e mensagens) é apagado ou anonimizado, isto é, deixa de poder ser ligado a você.
            </p>
          </Secao>

          <Secao id="contato" titulo="Contato">
            <p>
              Dúvidas sobre esta política ou sobre seus dados:{' '}
              <a href={`mailto:${PRIVACIDADE_EMAIL}`} className={linkClass}>
                {PRIVACIDADE_EMAIL}
              </a>
              . Se mudarmos este texto, a data de atualização no começo da página muda junto.
            </p>
          </Secao>

          <p className="border-t border-line pt-4 text-sm text-ink-600">
            <Link href="/login" className={linkClass}>
              Ir para o login
            </Link>
          </p>
        </article>
      </main>
    </div>
  )
}
