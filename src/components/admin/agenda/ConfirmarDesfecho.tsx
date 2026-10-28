'use client'

// A CONFIRMAÇÃO DO ATO IRREVERSÍVEL (Onda da Agenda · A6/lote 2) — o primeiro
// consumidor do `kit/alert-dialog.tsx`.
//
// ── O QUE ELE RESOLVE ───────────────────────────────────────────────────────
// Três desfechos da matriz do ADR-018 NÃO SE DESFAZEM (nenhuma função das
// migrations devolve uma aula a `scheduled`) e dois deles mandam recado para o
// aluno no mesmo ato. Até aqui, o gesto era um toque só — e a assimetria estava
// escrita no próprio código: atestar NOVE aulas de uma vez exigia confirmação em
// dois passos; atestar UMA, nada.
//
// ── AS TRÊS REGRAS DO CABEÇALHO DO PRIMITIVO, UMA A UMA ─────────────────────
// 1. «o <form> por FORA do rodapé, `AlertDialogAction asChild` + submit». Aqui o
//    formulário é o da MATRIZ (ou o do painel da ficha), e ele já embrulha o
//    gatilho — o diálogo mora DENTRO dele. Ver "o envio não depende do portal".
// 2. «z-index 50»: quem decide é o primitivo; esta peça não passa `className` de
//    empilhamento nenhum.
// 3. «NUNCA `container` apontando para dentro do Sheet»: o `container` não é
//    usado. O painel da ficha abre este diálogo de DENTRO de um Sheet, e é
//    exatamente por isso que ele precisa continuar no portal do `<body>` — o
//    conteúdo do Sheet é `overflow-hidden` e cortaria a caixa.
//
// ── O ENVIO NÃO DEPENDE DO PORTAL (e isso não é preciosismo) ────────────────
// O conteúdo do AlertDialog vive num portal, fora da árvore do `<form>`. Duas
// consequências, e as duas estão tratadas aqui:
//
//   · CAMPO no portal não é enviado. Por isso as caixas de aviso são estado de
//     React e o que viaja no envio são INPUTS ESCONDIDOS, renderizados junto ao
//     gatilho — ou seja, dentro do formulário. Uma caixa `name=…` desenhada
//     dentro do diálogo simplesmente não chegaria à action.
//   · BOTÃO que some no meio do clique pode não enviar. O `AlertDialogAction`
//     do Radix fecha o diálogo no próprio `onClick`, e o conteúdo é desmontado
//     antes de o navegador executar a ação padrão do submit. Então o envio é
//     EXPLÍCITO: `preventDefault()` + `requestSubmit()` na hora, com o
//     formulário lido a partir do gatilho (`button.form`), que continua montado.
//     `requestSubmit` (e não `submit`) porque ele respeita a validação dos
//     campos e dispara o evento que o React intercepta para a server action.
//
// ── O CONTEÚDO É A MATRIZ, NÃO UM TEXTO NOVO ────────────────────────────────
// Título = o texto do CTA; corpo = a consequência MEDIDA no corpo das RPCs
// (`@/lib/admin/desfecho-da-aula`) + o aviso de irreversibilidade. Escrever
// frase nova aqui seria abrir a quarta superfície que fala de dinheiro com
// palavras próprias — o defeito que o A5 passou o milestone inteiro matando.

import { useRef, useState, type MouseEvent } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/kit/alert-dialog'
import {
  CAMPO_DA_ENTREGA,
  CONFIRMAR,
  CONSEQUENCIA,
  LEGENDA_DOS_CANAIS,
  REGISTRO_NAO_SE_DESFAZ,
  ROTULO_DO_CANAL,
  VOLTAR_DA_CONFIRMACAO,
  canaisDoAviso,
  conferirHoraDoAviso,
  ehCancelamento,
  marcaDaEntrega,
  type Desfecho,
  type EntregabilidadeDoAluno,
} from '@/lib/admin/desfecho-da-aula'

export function ConfirmarDesfecho({
  desfecho,
  entregabilidade,
  digitado,
  className,
}: {
  /** o desfecho ESCOLHIDO — é ele que decide título, consequência e caixas */
  desfecho: Desfecho
  /** o que a tela sabe sobre a entrega do aviso a ESTE aluno */
  entregabilidade: EntregabilidadeDoAluno
  /**
   * O RASCUNHO DA VOLTA DE ERRO (Sol · rodada 2 do A6, P2).
   *
   * A escolha de canais é decisão da dona, e decisão não pode ser desfeita por
   * uma recusa do servidor: quando o rascunho traz `avisar_email`/
   * `avisar_whatsapp`, são ELES que decidem como as caixas nascem — a
   * entregabilidade só responde quando não houve escolha ainda. Sem isto, a
   * recusa (hora do aviso no futuro, aula que já tem desfecho) religava em
   * silêncio o canal que ela tinha desmarcado.
   *
   * O painel "cancelar" da FICHA passou a ter rascunho também (revisão
   * independente do A6, M2 — lá a recusa fechava o Sheet e religava o canal
   * desmarcado). Ausente = formulário sem gaveta: aí vale a entregabilidade,
   * que é o comportamento de sempre.
   */
  digitado?: Record<string, string>
  /** a roupa do CTA, que é de quem chama (as peles `balao`/`largo` diferem) */
  className: string
}) {
  const gatilho = useRef<HTMLButtonElement>(null)
  // ABERTURA CONTROLADA, e não por gosto: `preventDefault()` no clique de
  // confirmar (ver abaixo) FAZ O RADIX NÃO FECHAR — o `AlertDialogAction` compõe
  // o fechamento com `checkForDefaultPrevented`. Sem fechar à mão, a caixa
  // ficaria aberta com o botão vivo durante o envio, e um segundo toque mandaria
  // um segundo cancelamento da MESMA aula (que o banco recusa com "não está
  // agendada" — susto de recusa em cima de um ato que deu certo).
  const [aberto, setAberto] = useState(false)
  const canais = canaisDoAviso(entregabilidade)
  // ESTADO, não campo do diálogo: ver o cabeçalho ("o envio não depende do
  // portal"). O valor inicial é o que a DONA escolheu (rascunho da volta de
  // erro) e, na falta dele, a ENTREGABILIDADE REAL — nada nasce marcado
  // prometendo um aviso que o banco não registraria.
  const [avisarEmail, setAvisarEmail] = useState(
    doRascunho(digitado?.avisar_email, canais.email.nasceMarcado),
  )
  const [avisarWhatsapp, setAvisarWhatsapp] = useState(
    doRascunho(digitado?.avisar_whatsapp, canais.whatsapp.nasceMarcado),
  )
  const cancelando = ehCancelamento(desfecho)

  /**
   * O CAMPO INVÁLIDO PARA A CONFIRMAÇÃO ANTES DE ELA ABRIR (Sol · rodada 2 do
   * A6, C10a).
   *
   * O que acontecia: `notified_at` no futuro (o `max` do campo) fechava o
   * diálogo e morria num balão nativo cinza — a dona "confirmava" e não
   * acontecia nada. Agora a validade é conferida no TOQUE do CTA: se o
   * formulário está inválido, o diálogo NÃO abre (o Radix compõe o
   * `onOpenToggle` com `checkForDefaultPrevented`) e o envio é pedido ao
   * próprio formulário — que é um `FormValidado` nas DUAS superfícies (a
   * matriz da Agenda e o painel "cancelar" da ficha). Ele acende o erro
   * inline no campo, com a frase da casa, e não envia nada.
   *
   * Uma gramática só, portanto: quem valida é o navegador (`checkValidity`),
   * quem escolhe a frase é `mensagemDoCampo`, e quem pinta é o `FormValidado`.
   * Aqui não nasce validação nova nem frase nova.
   *
   * ── …E A HORA-LIMITE É RENOVADA ANTES DE PERGUNTAR (revisão independente do
   * A6, M3) ─────────────────────────────────────────────────────────────────
   * O `max` do campo é montado no SERVIDOR e envelhece com a aba aberta: com a
   * agenda aberta desde as 9h, "hoje 15:40" batia em `rangeOverflow` e a tela
   * dizia que a hora estava no FUTURO — recusa falsa, e sem saída visível
   * (nada sugeria recarregar, e o diálogo não abria). `conferirHoraDoAviso`
   * renova o `max` pelo relógio do NEGÓCIO no momento do toque e só então
   * reavalia a frase; o `max` do servidor fica como cinto.
   *
   * ⚠️ Isto é hora-limite de UI e nada mais: nenhuma tela nova decide dia civil
   * (Lei 1 — a zona vem do servidor, só o instante é do cliente), e quem
   * decide de verdade continua sendo o banco (`p_notified_at > now()` em
   * `_cancel_class_core`), com a action traduzindo a recusa.
   */
  function tentarAbrir(e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form
    if (!form) return
    const campo = form.elements.namedItem('notified_at')
    if (campo instanceof HTMLInputElement) conferirHoraDoAviso(campo)
    if (form.checkValidity()) return
    e.preventDefault()
    form.requestSubmit()
  }

  function confirmar(e: MouseEvent<HTMLButtonElement>) {
    // A ação padrão do submit não sobrevive ao fechamento do diálogo: envia-se
    // à mão, AGORA, com o formulário dono do gatilho. `requestSubmit` dispara o
    // evento de submit SÍNCRONO — ele acontece antes de qualquer desmonte.
    e.preventDefault()
    setAberto(false)
    gatilho.current?.form?.requestSubmit()
  }

  return (
    <>
      {/* Os campos que a action lê. Ficam junto ao gatilho — dentro do
          formulário —, e não dentro do diálogo. `canais=1` é o que distingue
          "ela decidiu não avisar" de "este formulário nem pergunta": sem esta
          marca, a action mantém os dois avisos, que é o comportamento de
          sempre e o default da RPC. */}
      {cancelando && (
        <>
          <input type="hidden" name="canais" value="1" />
          <input type="hidden" name="avisar_email" value={avisarEmail ? '1' : '0'} />
          <input type="hidden" name="avisar_whatsapp" value={avisarWhatsapp ? '1' : '0'} />
          {/* …e o que a TELA SABIA sobre a entrega, para a frase de sucesso não
              afirmar envio onde não há destinatário (ver `CAMPO_DA_ENTREGA`).
              Estes dois NÃO entram no rascunho: são derivados do cadastro,
              recalculados a cada render pelo servidor — guardá-los faria um
              retrato velho sobreviver a uma correção do cadastro. */}
          <input
            type="hidden"
            name={CAMPO_DA_ENTREGA.email}
            value={marcaDaEntrega(entregabilidade.temLogin)}
          />
          <input
            type="hidden"
            name={CAMPO_DA_ENTREGA.whatsapp}
            value={marcaDaEntrega(
              entregabilidade.temLogin === null || entregabilidade.temWhatsapp === null
                ? null
                : entregabilidade.temLogin && entregabilidade.temWhatsapp,
            )}
          />
        </>
      )}

      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogTrigger asChild>
          {/* `type="button"`: dentro de um `<form>`, botão sem tipo É submit —
              e este abre a caixa, não registra nada. */}
          <button ref={gatilho} type="button" className={className} onClick={tentarAbrir}>
            {CONFIRMAR[desfecho]}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRMAR[desfecho]}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* A consequência da matriz + a irreversibilidade. `text-ink-900`
                  no piso da casa: isto é DADO que decide, não texto de apoio. */}
              <span className="block text-sm leading-snug font-medium text-ink-900">
                {CONSEQUENCIA[desfecho]}
              </span>
              <span className="mt-2 block text-sm leading-snug font-medium text-ink-900">
                {REGISTRO_NAO_SE_DESFAZ}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {cancelando && (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1 text-sm font-semibold text-ink-900">
                {LEGENDA_DOS_CANAIS}
              </legend>
              <CaixaDoAviso
                rotulo={ROTULO_DO_CANAL.email}
                marcada={avisarEmail}
                aoMudar={setAvisarEmail}
                porque={canais.email.porque}
              />
              <CaixaDoAviso
                rotulo={ROTULO_DO_CANAL.whatsapp}
                marcada={avisarWhatsapp}
                aoMudar={setAvisarWhatsapp}
                porque={canais.whatsapp.porque}
              />
            </fieldset>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>{VOLTAR_DA_CONFIRMACAO}</AlertDialogCancel>
            <AlertDialogAction asChild>
              {/* A COR DO ATO, não a cor do diálogo: cancelamento é vermelho,
                  registro de aula realizada é sólido de tinta. O primitivo veste
                  `btn-ink` por padrão e deixa o tom para quem usa. */}
              <button
                type="submit"
                className={cancelando ? 'btn-danger' : 'btn-ink'}
                onClick={confirmar}
              >
                {CONFIRMAR[desfecho]}
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * O que o rascunho disse — e `padrao` quando ele não disse nada.
 *
 * `'1'`/`'0'` são os valores que o campo escondido escreve. Qualquer outra
 * coisa (campo ausente, formulário sem rascunho, envio forjado) cai no padrão,
 * que é a entregabilidade real.
 */
function doRascunho(valor: string | undefined, padrao: boolean): boolean {
  if (valor === '1') return true
  if (valor === '0') return false
  return padrao
}

/**
 * Uma caixa de aviso — com o PORQUÊ quando ela nasce desmarcada.
 *
 * A caixa NÃO é desabilitada de propósito (régua da casa: controle desabilitado
 * não diz por que está assim). Marcar mesmo sem login continua sendo um gesto
 * possível, e o que ele produz — a linha presa em Mensagens — está escrito na
 * própria frase.
 */
function CaixaDoAviso({
  rotulo,
  marcada,
  aoMudar,
  porque,
}: {
  rotulo: string
  marcada: boolean
  aoMudar: (v: boolean) => void
  porque: string | null
}) {
  return (
    <label className="flex cursor-pointer gap-2.5 rounded-input border border-line p-3 hover:bg-paper-100">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => aoMudar(e.target.checked)}
        className="mt-1 h-4 w-4 accent-ac-deep"
      />
      <span>
        <span className="block text-sm font-semibold text-ink-900">{rotulo}</span>
        {porque && (
          <span className="block text-sm leading-snug font-medium text-ink-900">{porque}</span>
        )}
      </span>
    </label>
  )
}
