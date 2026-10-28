'use client'

// A MATRIZ DO DESFECHO (Onda da Agenda · A5/L3) — cinco linhas e UM CTA.
//
// ── O QUE MORREU AQUI ───────────────────────────────────────────────────────
// O trio do `src/app/admin/agenda/pieces.tsx`: "✓ Aula aconteceu" + "Aluno
// faltou" + "Professora faltou" como três formulários soltos, mais um
// `<details data-popup>` chamado "Cancelar aula…" com um `<select>` NATIVO de
// "quem cancelou". Quatro defeitos num lugar só:
//   1. `<details data-popup>` é proibido em tela nova (`AGENTS.md`): sem foco
//      preso, sem Esc, sem devolução de foco;
//   2. a decisão que MOVE DINHEIRO — quem cancelou (ADR-018) — estava escondida
//      dentro do popup, no primeiro item de um select, com "o aluno" como
//      padrão silencioso;
//   3. a consequência de cada caminho não estava na tela em lugar nenhum;
//   4. o campo "Quando avisou" vinha com a frase "O crédito é decidido pela
//      regra do contrato", que descreve uma regra INEXISTENTE — a antecedência
//      não decide crédito nenhum (ver a medição em `@/lib/admin/desfecho-da-aula`).
//
// ── A FORMA VEIO DO `RegistrarDesfecho` DO INÍCIO, O CONTEÚDO NÃO ───────────
// De lá: linhas de radio com a frase da consequência embaixo, um CTA grande, o
// submit que nunca nasce desabilitado. O conteúdo é outro: são CINCO linhas (as
// duas do cancelamento entram, porque cancelar é desfecho), e as frases foram
// MEDIDAS no corpo das funções — inclusive as que viviam no Início ("libera a
// hora da professora no extrato" e "O aluno ganha um crédito de reposição."), que
// eram falsas e foram CORRIGIDAS lá também no A5/L5: duas telas com a mesma
// matriz não podem dizer coisas diferentes sobre o mesmo dinheiro, e o varredor
// de `tests/onda-agenda-a5.test.ts` §11 cobra as duas superfícies.
//
// ── DUAS PELES, UM COMPONENTE ───────────────────────────────────────────────
// `balao` (dentro do popover do evento, estreito) e `largo` (o cartão da fila de
// pendências no desktop). O trio velho tinha o mesmo `wide`, e por um bom
// motivo: são as duas superfícies em que a dona registra desfecho. Um
// componente só evita o que já aconteceu nesta onda — corrigir metade da tela e
// deixar a outra metade dizendo a frase antiga.
//
// ── AS CONSTANTES FICAM NO BUNDLE DO CLIENTE, DE PROPÓSITO ──────────────────
// A lição de custo do A4: a grade monta um balão por evento, e o conteúdo
// servido por balão não pode carregar as cinco frases longas. Aqui elas vivem no
// módulo (JS, uma vez por página) e o que atravessa a fronteira por aula são
// seis strings curtas.

import { useState } from 'react'

import { registrarDesfechoDaAulaAction } from '@/app/admin/agenda/actions'
import { Campo } from '@/components/admin/alunos/ficha/pecas'
import { FormValidado } from '@/components/kit/form-validado'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import {
  AVISO_DA_HORA,
  CONFIRMAR,
  REGRA_DA_CASA_DO_FIM,
  CONFIRMAR_SEM_ESCOLHA,
  CONSEQUENCIA,
  DECLARACAO_DO_ESTADO,
  ROTULO,
  TEMAS,
  TEMA_DO_PLANO,
  conferirHoraDoAviso,
  ehCancelamento,
  ehDesfecho,
  opcoesDaSituacao,
  pedeConfirmacao,
  type Desfecho,
  type EntregabilidadeDoAluno,
} from '@/lib/admin/desfecho-da-aula'
import type { SituacaoDaAula } from '@/data/admin/home'
import { ConfirmarDesfecho } from './ConfirmarDesfecho'

/** Pele do formulário: dentro do balão do evento, ou no cartão largo da fila. */
export type PeleDoDesfecho = 'balao' | 'largo'

/** CTA no piso de AÇÃO da régua (texto ≥ `text-sm`, alvo ≥ 44px aqui porque é o
 *  ato principal da caixa). `btn-ink` para os três registros; `btn-danger` para
 *  os dois cancelamentos.
 *
 *  A6/lote 2: os TRÊS irreversíveis (realizada + os dois cancelamentos) não
 *  enviam mais no toque — o CTA abre o `ConfirmarDesfecho`, que é quem envia.
 *  A roupa é a MESMA nos dois caminhos de propósito: o que muda é o que
 *  acontece depois do toque, não o peso visual do botão. */
const CTA_BASE = '!min-h-11 !px-4 !py-2 !text-sm font-semibold'

/** Teto do único campo de texto livre da matriz — ver a nota no campo. */
const TETO_DO_DETALHE = 300

export function DesfechoDaAula({
  aulaId,
  situacao,
  temApontamento,
  back,
  backErro,
  digitado,
  agoraNoNegocio,
  entregabilidade,
  pele,
}: {
  aulaId: string
  situacao: SituacaoDaAula
  /** `complete_class` recusa aula sem apontamento de conteúdo (D2) */
  temApontamento: boolean
  /** para onde voltar no SUCESSO (a tela, com o balão fechado) */
  back: string
  /** …e no ERRO: a mesma tela com o balão DESTA aula reaberto (`?ev=`) */
  backErro: string
  /** o que ela digitou e voltou no cookie de rascunho depois de um erro */
  digitado: Record<string, string>
  /** AGORA no fuso do negócio ('yyyy-LL-ddTHH:mm'), montado no servidor: é o
   *  `max` do campo de aviso — hora futura não é aviso (o banco recusa). */
  agoraNoNegocio: string
  /** A6/lote 2 — o que a camada de dados sabe sobre a entrega do aviso a este
   *  aluno (tem login? tem número?). É ela que decide como as caixas do
   *  diálogo NASCEM; `null` nos dois campos = aula de grupo. */
  entregabilidade: EntregabilidadeDoAluno
  pele: PeleDoDesfecho
}) {
  const opcoes = opcoesDaSituacao(situacao)
  // ══ NADA NASCE MARCADO ═══════════════════════════════════════════════════
  //
  // A versão anterior pré-marcava "A aula aconteceu" quando ela era oferecida —
  // "o desfecho mais comum de uma aula que passou". A revisão independente do A5
  // derrubou isso com o cenário da segunda-feira: nove cartões na fila de
  // pendências, cada um nascendo com realizada marcada e um CTA sólido de largura
  // cheia. UM toque errado registra realizada uma aula que era falta da professora
  // — e o aluno perde o crédito que era dele.
  //
  // E NÃO SE DESFAZ: nenhuma função das migrations devolve aula a `scheduled` (ver
  // `REGISTRO_NAO_SE_DESFAZ`). Somava-se a isso uma assimetria que condenava o
  // desenho: atestar NOVE aulas de uma vez exige `ConfirmAction` em dois passos;
  // atestar UMA não exigia nada.
  //
  // Decisão do orquestrador, declarada: perder o "um toque" no caso comum é o
  // preço de um ato irreversível sobre dinheiro. O caminho rápido do dia continua
  // sendo o LOTE, que tem confirmação. (O AlertDialog para `realizada` está
  // roteado ao A6, junto com os dois cancelamentos.)
  //
  // O que sobrevive: a escolha que voltou do RASCUNHO depois de um erro — ali ela
  // já decidiu, e reapresentar o formulário vazio seria perder o trabalho dela.
  const inicial = digitado.desfecho
  const [escolha, setEscolha] = useState<Desfecho | null>(
    ehDesfecho(inicial) && opcoes.includes(inicial) ? inicial : null,
  )

  // NADA A ESCOLHER: a tela DECLARA o estado e a consequência financeira dele.
  // Não fica muda (a dona precisa saber por que não há botão) e não inventa
  // crédito — quem sabe do crédito é a trilha, na aba ao lado.
  if (opcoes.length === 0) {
    const declaracao = DECLARACAO_DO_ESTADO[situacao]
    return declaracao ? (
      <p className="text-sm leading-snug font-medium text-ink-900">{declaracao}</p>
    ) : null
  }

  const cancelando = escolha !== null && ehCancelamento(escolha)
  const largo = pele === 'largo'

  return (
    // A6/lote 2 · C10a (Sol · rodada 2): o formulário virou `FormValidado`, a
    // MESMA postura do painel "cancelar" da ficha. Razão medida: o campo
    // "quando o aviso chegou" tem `max` (agora), e uma hora futura fechava a
    // confirmação e morria num balão nativo cinza — a dona confirmava e não
    // acontecia nada. Com `noValidate` + erro inline, a recusa aparece NO
    // CAMPO, na frase da casa, e o `ConfirmarDesfecho` nem abre o diálogo.
    <FormValidado
      action={registrarDesfechoDaAulaAction}
      className="flex flex-col gap-3"
      // Sem `key` nem `id` derivado de dado pessoal: o formulário se identifica
      // pelo id da aula, que é o que já viaja na URL do balão.
    >
      <input type="hidden" name="instance_id" value={aulaId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="back_erro" value={backErro} />
      {/* A7: `manter` e `rascunho` MORRERAM aqui, e o A5 já tinha escrito que
          morreriam ("o campo oculto continua existindo porque o contrato do
          formulário é do A7"). A lista de campos é `CAMPOS_DO_DESFECHO`, do
          servidor, e a identidade do rascunho é DERIVADA do `instance_id` que a
          própria action recebe — a fila de pendências mostra dezenas de
          formulários, e o erro de um não pode preencher o de outro. Nenhuma das
          duas coisas era negociável com o cliente; agora nem viaja. */}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">O que aconteceu com esta aula</legend>
        {/* A ressalva da hora, dita UMA vez, e SÓ em aula que já terminou: é
            ela que impede a leitura falsa de "libera a hora". Em aula futura a
            frase não se aplica — a soma do extrato exige `starts_at < now()`
            (medição no módulo do vocabulário). */}
        {situacao === 'sem_registro' && (
          <p className="pb-1 text-sm leading-snug font-medium text-ink-900">{AVISO_DA_HORA}</p>
        )}
        {/* Aula que AINDA NÃO TERMINOU (futura ou em andamento): só cancelar. A
            razão vai ESCRITA, e com a autoria certa — o corte no fim é regra da
            casa, não limite do banco (Sol · rodada 1 do A5). Sem esta linha a
            dona vê três opções a menos e nenhuma explicação. */}
        {situacao === 'agendada' && (
          <p className="pb-1 text-sm leading-snug font-medium text-ink-900">
            {REGRA_DA_CASA_DO_FIM}
          </p>
        )}
        {opcoes.map((o) => {
          const marcada = escolha === o
          return (
            <label
              key={o}
              className={`flex cursor-pointer gap-2.5 rounded-input border p-3 transition-colors duration-(--duration-hover) ease-(--ease-out) ${
                marcada ? 'border-ac-deep bg-ac-wash' : 'border-line hover:bg-paper-100'
              }`}
            >
              <input
                type="radio"
                name="desfecho"
                value={o}
                checked={marcada}
                onChange={() => setEscolha(o)}
                className="mt-1 accent-ac-deep"
              />
              <span>
                {/* rótulo e consequência são DADO (régua do AGENTS.md): os dois
                    no piso literal, distinguidos pelo PESO — nunca pela cor
                    apagada. É a frase de baixo que muda a decisão. */}
                <span className="block text-sm font-semibold text-ink-900">{ROTULO[o]}</span>
                <span className="block text-sm leading-snug font-medium text-ink-900">
                  {CONSEQUENCIA[o]}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {escolha === 'realizada' && (
        <div className={largo ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'flex flex-col gap-3'}>
          {/* SEM APONTAMENTO A OPÇÃO NÃO SE ESCONDE — ela avisa (a régua da
              casa: antecipar a recusa com frase de gente, nunca calar o
              caminho). Escolher um tema aqui satisfaz `complete_class`; deixar
              no "módulo do plano" faz o banco recusar, e a action traduz. */}
          {!temApontamento && (
            <p
              className={`text-sm leading-snug font-medium text-warn-700 ${largo ? 'sm:col-span-2' : ''}`}
            >
              A professora ainda não apontou o que foi trabalhado nesta aula. Escolha um tema aqui —
              sem apontamento, o registro é recusado.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-600">
            Tema
            {/* Select do KIT (Radix), nunca o `<select>` nativo — o menu do
                sistema operacional é o defeito nº 1 do dono em tela nova. `z-60`
                para subir acima do popover (`z-[45]`) e do véu do Sheet. */}
            <TemaDoDesfecho inicial={digitado.off_kind} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-600">
            {/* O TETO É DITO (revisão independente, menor): `maxLength` corta em
                silêncio, e um texto que desaparece sem aviso é o mesmo prejuízo do
                rascunho descartado que ele existe para evitar. */}
            Detalhe (opcional, até {TETO_DO_DETALHE} caracteres)
            {/* TETO VISÍVEL, e ele não é decoração (Sol · rodada 2 do A5): o
                rascunho da volta de erro viaja num cookie, e
                `gravarRascunho` DESCARTA em silêncio o que passa de ~3 KB
                codificados — justo depois de uma recusa, justo o texto longo que
                a dona precisaria corrigir. 300 caracteres cabem com folga
                (percent-encoding pode multiplicar por 6 em texto acentuado:
                300 × 6 = 1,8 KB, dentro do teto) e são muito mais do que um
                "detalhe" precisa. */}
            <input
              name="off_note"
              maxLength={TETO_DO_DETALHE}
              defaultValue={digitado.off_note ?? ''}
              placeholder="ex.: prova B2"
              className="min-h-11 rounded-input border border-line bg-paper-0 px-3 text-sm font-normal text-ink-900 placeholder:text-ink-400"
            />
          </label>
        </div>
      )}

      {cancelando && (
        /* O campo do aviso passou a ser o `Campo` da casa — é ele que traz o
           parágrafo do erro pronto (`data-slot="campo-erro"`) para o
           `FormValidado` acender. A FRASE ANTIGA de apoio dizia "O crédito é
           decidido pela regra do contrato", e é falso: `_cancel_class_core` não
           olha antecedência para decidir crédito. O que este campo faz de
           verdade: entra na trilha de auditoria e, em aula que já começou, é ele
           que PERMITE cancelar (a guarda exige aviso anterior ao início). */
        <Campo
          rotulo="Quando o aviso chegou (hora de Cuiabá)"
          apoio="Em branco = agora. Não muda o crédito — quem decide é quem pediu o cancelamento. Serve à auditoria e, em aula que já começou, é o que permite cancelar: o aviso precisa ser anterior ao início."
        >
          {/* `max` = AGORA no fuso do negócio, calculado no SERVIDOR (Lei 1: o
              cliente não monta data). A ficha do aluno já faz isso no MESMO campo
              (`max={ficha.agoraNoNegocio}`) e a Agenda descobria a recusa só
              depois da ida ao servidor — mesmo campo, mesma guarda de banco
              (`if p_notified_at > now() then raise`), duas superfícies com UX
              diferente (revisão independente do A5, menor).

              C10a: o `max` sozinho dava "O valor está fora do que este campo
              aceita" — genérico demais para a decisão que ele descreve. A frase
              própria entra por `setCustomValidity`, que tem precedência em
              `mensagemDoCampo`; ela é reavaliada a cada digitação E na
              montagem (o rascunho pode voltar com hora futura).

              REVISÃO INDEPENDENTE DO A6 (M3): este `max` é o CINTO, não a
              régua viva. Ele envelhece com a aba aberta — às 16h ele ainda diz
              09:12 e recusa "hoje 15:40" com a frase FALSA de hora no futuro.
              Quem renova a hora-limite é `conferirHoraDoAviso`, no fuso do
              NEGÓCIO, no momento do toque (ver a lápide no módulo). */}
          <input
            ref={conferirHoraDoAviso}
            name="notified_at"
            type="datetime-local"
            max={agoraNoNegocio}
            defaultValue={digitado.notified_at ?? ''}
            onInput={(e) => conferirHoraDoAviso(e.currentTarget)}
            className="min-h-11 rounded-input border border-line bg-paper-0 px-3 text-sm font-normal text-ink-900"
          />
        </Campo>
      )}

      {/* O CTA NUNCA NASCE DESABILITADO (régua da casa: botão desabilitado não
          diz por quê, e a recusa do servidor — "escolha o que aconteceu com esta
          aula" — já é a rede). O que muda é o PESO: sem escolha ele é `btn-paper`,
          neutro, e não convida ao toque; escolhido, veste a cor do ato (sólido
          para registro, `btn-danger` para os dois cancelamentos).

          A6/lote 2 — DOIS CAMINHOS, e a diferença é o que o toque faz:
           · os três IRREVERSÍVEIS (realizada + os dois cancelamentos) abrem o
             AlertDialog, que mostra a consequência e (nos cancelamentos) as
             caixas de aviso, e é ele quem envia;
           · as duas FALTAS continuam enviando no toque.
          A escolha de quem para para confirmar é da spec do A6 e está declarada
          em `PEDE_CONFIRMACAO` — não se decide aqui, para as duas telas que
          usam esta matriz nunca divergirem. */}
      {escolha !== null && pedeConfirmacao(escolha) ? (
        <ConfirmarDesfecho
          desfecho={escolha}
          entregabilidade={entregabilidade}
          digitado={digitado}
          className={`${cancelando ? 'btn-danger' : 'btn-ink'} ${CTA_BASE} ${largo ? 'self-start' : 'w-full'}`}
        />
      ) : (
        <button
          type="submit"
          className={`${escolha === null ? 'btn-paper' : 'btn-ink'} ${CTA_BASE} ${largo ? 'self-start' : 'w-full'}`}
        >
          {escolha ? CONFIRMAR[escolha] : CONFIRMAR_SEM_ESCOLHA}
        </button>
      )}
    </FormValidado>
  )
}

/**
 * O tema avulso. Estado próprio porque o Radix proíbe item de valor vazio: a
 * sentinela "módulo do plano" precisa de um valor para ser escolhida, e o campo
 * que a action lê (`off_kind`) recebe `''` nesse caso — o mesmo mecanismo do
 * `RegistrarDesfecho` do Início.
 */
function TemaDoDesfecho({ inicial }: { inicial?: string }) {
  const [tema, setTema] = useState(inicial && inicial !== '' ? inicial : TEMA_DO_PLANO)
  return (
    <>
      <Select value={tema} onValueChange={setTema}>
        <SelectTrigger className="min-h-11 w-full font-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-60">
          <SelectItem value={TEMA_DO_PLANO}>módulo do plano (apontado pela professora)</SelectItem>
          {TEMAS.map((t) => (
            <SelectItem key={t.valor} value={t.valor}>
              {t.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="off_kind" value={tema === TEMA_DO_PLANO ? '' : tema} />
    </>
  )
}
