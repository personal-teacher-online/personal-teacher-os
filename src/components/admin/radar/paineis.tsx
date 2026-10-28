// OS PAINÉIS DO RADAR (Estúdio v2 · Levas 3 e 4) — descartar uma trend com
// motivo e ajustar a nota de viagem, no Sheet do kit com o rodapé fixo da
// anatomia medida.
//
// AS REGRAS QUE ESTE ARQUIVO CARREGA (as mesmas dos painéis da Pauta):
// 1. O PAINEL É ENDEREÇO (`?alvo=…&painel=…`): sobrevive ao F5, ao voltar do
//    navegador e ao link colado — e carrega a vista (`?ver=pt`) para o
//    round-trip devolver à aba de origem.
// 2. SUCESSO E FALHA TÊM DESTINOS DIFERENTES: `back` (descartar: o próximo
//    cartão — a fila anda; ajustar nota: o MESMO cartão — ajustar não decide)
//    e `back_erro` (o próprio painel, com o que foi digitado de volta).
// 3. ENDEREÇO QUE SÓ PODE FALHAR NÃO VIRA FORMULÁRIO: alvo inexistente ou já
//    decidido devolve para a casa (quem faz isso é a página).
//
// O MOTIVO É OBRIGATÓRIO PELO BANCO (`content_trends_descartada_shape`), não
// por delicadeza — o required daqui só antecipa a frase. E a CASCATA às
// variações é do banco: o painel AVISA o que a decisão arrasta, nunca executa.

import { TriangleAlert } from 'lucide-react'

import { CAMPO, Campo } from '@/components/admin/alunos/ficha/pecas'
import { FormValidado } from '@/components/kit/form-validado'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { SheetBody, SheetFooter } from '@/components/kit/sheet'
import type { VariacaoDoCartao } from '@/data/admin/radar'
import {
  NOTA_MAXIMA,
  NOTA_MINIMA,
  chaveDaNota,
  chaveDoDescarte,
  enderecoDoCartao,
  enderecoDoPainelDescartar,
  enderecoDoPainelNota,
  type VistaDeTriagem,
} from '@/data/admin/radar-gramatica'
import { ajustarNotaAction, descartarTrendAction } from '@/app/admin/conteudo/actions'

/** Os campos que voltam preenchidos depois de uma recusa. */
const MANTER = 'motivo'

export function PainelDescartar({
  alvo,
  variacoes,
  back,
  rascunho,
  vista,
}: {
  alvo: string
  /** as variações NOVAS que a cascata do banco vai arrastar junto */
  variacoes: VariacaoDoCartao[]
  /** para onde o sucesso devolve (o próximo cartão; a casa quando é o último) */
  back: string
  rascunho: Record<string, string>
  /** a aba de origem — sucesso, erro e cancelar devolvem para ela */
  vista: VistaDeTriagem
}) {
  return (
    <PainelDeUrl
      titulo="Descartar trend"
      descricao="O motivo fica no histórico — trend não se apaga."
      voltarPara={enderecoDoCartao(alvo, vista)}
      bruto
    >
      <FormValidado action={descartarTrendAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="alvo" value={alvo} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="back_erro" value={enderecoDoPainelDescartar(alvo, vista)} />
        <input type="hidden" name="rascunho" value={chaveDoDescarte(alvo)} />
        <input type="hidden" name="manter" value={MANTER} />
        <SheetBody>
          <div className="flex flex-col gap-4">
            <Campo
              rotulo="Motivo do descarte"
              apoio="Por que essa trend sai de cena — é o que o histórico e a régua da pauta leem."
              exigencia="Escreva o motivo do descarte"
              largo
            >
              <textarea
                name="motivo"
                required
                rows={3}
                maxLength={600}
                placeholder="ex.: tema fora do público da Teacher Vicky; já gravamos variação melhor"
                defaultValue={rascunho.motivo ?? ''}
                className={`${CAMPO} min-h-24 resize-y`}
              />
            </Campo>

            {variacoes.length > 0 && (
              <p className="flex items-start gap-1.5 rounded-card bg-warn-wash p-3 text-sm font-medium text-warn-700">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {variacoes.length === 1
                    ? 'Descartar esta trend descarta também a variação pendente do tema — ela herda este motivo.'
                    : `Descartar esta trend descarta também as ${variacoes.length} variações pendentes do tema — elas herdam este motivo.`}
                </span>
              </p>
            )}
          </div>
        </SheetBody>
        <SheetFooter
          cancel={
            <a href={enderecoDoCartao(alvo, vista)} className="btn-ac-soft btn-ac-lg">
              Cancelar
            </a>
          }
        >
          <button type="submit" className="btn-ac btn-ac-lg">
            Descartar trend
          </button>
        </SheetFooter>
      </FormValidado>
    </PainelDeUrl>
  )
}

/** Os campos do ajuste que voltam preenchidos depois de uma recusa. */
const MANTER_NOTA = 'nota'

/**
 * A válvula da Teacher Vicky (ADR-033 decisão 4): a nota manual vence SEMPRE; limpar o
 * ajuste devolve a palavra ao robô. DOIS SUBMITS de propósito — "campo vazio =
 * limpar" apagaria a válvula num Enter afobado; a intenção é declarada no
 * botão. O campo vai SEM `required`: o `FormValidado` valida no submit sem
 * olhar qual botão disparou, e um required barraria o Limpar — vazio no Salvar
 * vira frase do servidor (a antecipação que se perde é só essa).
 */
export function PainelNota({
  alvo,
  nota,
  notaAjustada,
  notaDoRobo,
  rascunho,
  vista,
}: {
  alvo: string
  /** a nota que VALE hoje (`ajustado ?? robô`) — pré-preenche quando é ajuste */
  nota: number | null
  notaAjustada: boolean
  /** a nota crua do robô — o contexto que o apoio do campo conta */
  notaDoRobo: number | null
  rascunho: Record<string, string>
  /** a aba de origem — sucesso, erro e cancelar devolvem para ela */
  vista: VistaDeTriagem
}) {
  return (
    <PainelDeUrl
      titulo="Ajustar nota de viagem"
      descricao="A nota manual vence a do robô — limpar o ajuste devolve a palavra a ele."
      voltarPara={enderecoDoCartao(alvo, vista)}
      bruto
    >
      <FormValidado action={ajustarNotaAction} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="alvo" value={alvo} />
        {/* Ajustar não decide: o sucesso volta ao MESMO cartão. Se a nota nova
            tirar a trend da aba corrente, a página redireciona para a casa da
            vista — e o toast sobrevive ao redirect. */}
        <input type="hidden" name="back" value={enderecoDoCartao(alvo, vista)} />
        <input type="hidden" name="back_erro" value={enderecoDoPainelNota(alvo, vista)} />
        <input type="hidden" name="rascunho" value={chaveDaNota(alvo)} />
        <input type="hidden" name="manter" value={MANTER_NOTA} />
        <SheetBody>
          <Campo
            rotulo={`Nota de viagem (${NOTA_MINIMA} a ${NOTA_MAXIMA})`}
            apoio={
              notaDoRobo != null
                ? `O robô deu ${notaDoRobo}. O número que você salvar vale no lugar dele.`
                : 'O robô não deu nota a esta trend — a que você salvar passa a valer.'
            }
            largo
          >
            <input
              name="nota"
              type="number"
              inputMode="numeric"
              min={NOTA_MINIMA}
              max={NOTA_MAXIMA}
              step={1}
              placeholder="ex.: 75"
              defaultValue={rascunho.nota ?? (notaAjustada && nota != null ? String(nota) : '')}
              className={CAMPO}
            />
          </Campo>
        </SheetBody>
        <SheetFooter
          cancel={
            <a href={enderecoDoCartao(alvo, vista)} className="btn-ac-soft btn-ac-lg">
              Cancelar
            </a>
          }
        >
          {notaAjustada && (
            <button
              type="submit"
              name="acao"
              value="limpar"
              className="btn-ac-soft btn-ac-lg"
            >
              Limpar ajuste
            </button>
          )}
          <button type="submit" name="acao" value="definir" className="btn-ac btn-ac-lg">
            Salvar nota
          </button>
        </SheetFooter>
      </FormValidado>
    </PainelDeUrl>
  )
}
