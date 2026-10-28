'use client'

// O PAINEL "CANCELAR" DA FICHA (Onda da Agenda · A6/lote 2).
//
// ── POR QUE ELE VIROU CLIENTE ───────────────────────────────────────────────
// Duas coisas do painel passaram a depender da escolha feita NA HORA:
//   · a consequência mostrada na confirmação depende de QUEM pediu o
//     cancelamento (ADR-018: é esse campo que decide o crédito), e quem pede é
//     escolhido aqui mesmo, no seletor;
//   · as caixas de aviso do diálogo são estado, não campo do portal (ver o
//     cabeçalho de `ConfirmarDesfecho`).
// O resto do painel — o Sheet, o endereço `?painel=cancelar`, o `FormValidado`
// e a action — continua exatamente onde estava.
//
// ── É ESTE PAR QUE FECHA O ACEITE DO ADR-028 ────────────────────────────────
// AlertDialog aberto de DENTRO de um Sheet visível: o diálogo entra depois no
// `<body>`, na mesma camada (z-50), e por isso pinta por cima sem número novo
// na escala. Nada de `container` apontando para o Sheet — o conteúdo dele é
// `overflow-hidden` e cortaria a caixa. O e2e do par é caso obrigatório do A9.
//
// ── A MESMA MATRIZ DA AGENDA, DE PROPÓSITO ──────────────────────────────────
// As frases de consequência vêm de `@/lib/admin/desfecho-da-aula`, o mesmo
// módulo que a Agenda usa. Duas telas que falam do mesmo dinheiro não podem
// dizer coisas diferentes — foi assim que o A5 achou sete famílias de frase
// falsa em nove telas.

import { useState } from 'react'

import { ConfirmarDesfecho } from '@/components/admin/agenda/ConfirmarDesfecho'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import { SheetBody, SheetFooter, SheetSection } from '@/components/kit/sheet'
import {
  conferirHoraDoAviso,
  type Desfecho,
  type EntregabilidadeDoAluno,
} from '@/lib/admin/desfecho-da-aula'
import { CAMPO, Campo } from './pecas'

/** O que o seletor grava em `cancelled_by` × a linha da matriz que ele é. */
const DESFECHO_DE: Record<'student' | 'teacher', Desfecho> = {
  student: 'cancelada_aluno',
  teacher: 'cancelada_professora',
}

function ehQuem(v: string | undefined): v is 'student' | 'teacher' {
  return v === 'student' || v === 'teacher'
}

export function CancelarAula({
  voltar,
  agoraNoNegocio,
  entregabilidade,
  digitado,
}: {
  /** para onde o "Cancelar" do rodapé volta (a aba de histórico da ficha) */
  voltar: string
  /** AGORA no fuso do negócio, montado no SERVIDOR (Lei 1) — o `max` do campo */
  agoraNoNegocio: string
  entregabilidade: EntregabilidadeDoAluno
  /**
   * O RASCUNHO DA VOLTA DE ERRO (revisão independente do A6, M2).
   *
   * Este painel não tinha nenhum: a recusa do servidor fechava o Sheet e o
   * segundo envio nascia com o seletor em "o aluno" e as caixas de aviso
   * RELIGADAS pela entregabilidade — religamento silencioso do canal que a
   * dona tinha desmarcado, que é o mesmo P2 que a Agenda fechou no A6. Agora
   * o erro reabre o painel (`?painel=cancelar&alvo=<aula>`) e o que ela
   * escolheu volta com ele: quem cancelou, a hora do aviso e os dois canais.
   */
  digitado?: Record<string, string>
}) {
  // O default continua sendo "o aluno", como sempre foi neste painel — o que
  // mudou é que a consequência dessa escolha agora aparece antes do ato. E o
  // que voltou do RASCUNHO vence o default: ali ela já decidiu.
  const [quem, setQuem] = useState<'student' | 'teacher'>(
    ehQuem(digitado?.cancelled_by) ? digitado.cancelled_by : 'student',
  )

  return (
    <>
      <SheetBody>
        <SheetSection
          title="Quem cancelou"
          hint="Quem cancela decide a consequência: cancelamento do ALUNO nunca gera crédito, em qualquer antecedência (ADR-018); pedido da professora gera — a exceção é a aula que nasceu de um crédito antigo sem identidade, em que o sistema não devolve sozinho. Quem decide é o banco — esta tela só relata."
        >
          <Campo rotulo="Cancelado por" para="quem-cancelou">
            {/* Controlado (era `defaultValue`): é este valor que escolhe a
                consequência mostrada na confirmação. O `name` continua no
                Select — é o `<select>` escondido do Radix que fala com o
                formulário, não a nossa pele. */}
            <Select
              name="cancelled_by"
              value={quem}
              onValueChange={(v) => setQuem(v as 'student' | 'teacher')}
            >
              <SelectTrigger id="quem-cancelou" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-60">
                <SelectItem value="student">o aluno</SelectItem>
                <SelectItem value="teacher">a professora</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </SheetSection>
        <SheetSection
          title="Quando avisou"
          hint="Horário de Cuiabá. Em branco = agora. Não muda o crédito — quem decide é quem pediu o cancelamento. Serve à auditoria e, em aula que já começou, é o que permite cancelar: o aviso precisa ser anterior ao início."
        >
          {/* A5/L5 (Sol · rodada 2, grave): o hint desta seção descrevia a
              REGRA INEXISTENTE que aquele milestone existe para matar — "é esta
              hora que o banco compara com o aviso mínimo do contrato" e "o
              crédito que nasce (ou não) da antecedência". `_cancel_class_core`
              decide crédito por `p_cancelled_by`; `min_notice_hours` entra no
              `diff` do audit como CONTEXTO. A hora do aviso tem DOIS usos
              reais: a auditoria e a guarda de estado (`if now() >=
              starts_at_utc and p_notified_at >= starts_at_utc then raise … use
              no_show…`) — é ela que permite cancelar aula que já começou.
              B6 · item 4: o teto é AGORA, no fuso do negócio, calculado no
              servidor (Lei 1). Aviso no futuro não é aviso.
              M3 da revisão independente do A6: esse teto do servidor é o
              CINTO — com o Sheet aberto há horas ele recusaria uma hora
              passada como se fosse futura. Quem renova a hora-limite no
              momento do toque é `conferirHoraDoAviso`. */}
          <Campo rotulo="Data e hora do aviso" apoio="opcional — não pode ser no futuro">
            {/* A6 · rodada 2 (C10a): a frase do erro é a MESMA das duas telas.
                Sem `setCustomValidity`, o `max` estourado cai no genérico do
                `mensagemDoCampo` ("o valor está fora do que este campo
                aceita") — que não diz o que a dona precisa saber, e diverge da
                matriz da Agenda, que fala em português do fato. */}
            <input
              ref={conferirHoraDoAviso}
              name="notified_at"
              type="datetime-local"
              max={agoraNoNegocio}
              defaultValue={digitado?.notified_at ?? ''}
              onInput={(e) => conferirHoraDoAviso(e.currentTarget)}
              className={CAMPO}
            />
          </Campo>
        </SheetSection>
      </SheetBody>
      <SheetFooter
        cancel={
          // Volta é NAVEGAÇÃO (âncora de verdade), com cara de botão — a mesma
          // do `Rodape` dos outros painéis da ficha.
          <a href={voltar} className="btn-ac-soft btn-ac-lg">
            Cancelar
          </a>
        }
      >
        {/* O rodapé não envia mais direto: quem envia é a confirmação, que
            mostra a consequência e as caixas de aviso. `btn-ac-lg` mantém a
            altura do rodapé da casa. */}
        <ConfirmarDesfecho
          desfecho={DESFECHO_DE[quem]}
          entregabilidade={entregabilidade}
          digitado={digitado}
          className="btn-danger btn-ac-lg"
        />
      </SheetFooter>
    </>
  )
}
